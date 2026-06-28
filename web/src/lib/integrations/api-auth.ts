import { timingSafeEqual } from 'crypto';

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function requireIntegrationApiKey(request: Request): Response | null {
  const expected = process.env.INTEGRATION_API_KEY ?? '';
  if (!expected) {
    return Response.json({ error: 'Integration API is not configured.' }, { status: 503 });
  }

  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return Response.json({ error: 'Missing integration API bearer token.' }, { status: 401 });
  }

  if (!constantTimeEqual(match[1], expected)) {
    return Response.json({ error: 'Invalid integration API bearer token.' }, { status: 403 });
  }

  return null;
}
