export class RequestBodyError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413 | 415,
  ) {
    super(message);
    this.name = 'RequestBodyError';
  }
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('maxBytes must be a positive integer.');
  }

  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new RequestBodyError('Content-Type must be application/json.', 415);
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new RequestBodyError('Content-Length is invalid.', 400);
    }
    if (parsedLength > maxBytes) {
      throw new RequestBodyError('Request body is too large.', 413);
    }
  }

  if (!request.body) throw new RequestBodyError('A JSON request body is required.', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError('Request body is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let jsonText: string;
  try {
    jsonText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new RequestBodyError('Request body must be valid UTF-8 JSON.', 400);
  }
  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    throw new RequestBodyError('Request body must be valid JSON.', 400);
  }
}

export function jsonBodyErrorResponse(error: unknown): Response | null {
  if (!(error instanceof RequestBodyError)) return null;
  return Response.json(
    { error: error.message },
    {
      status: error.status,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
