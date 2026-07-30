import { Readable } from 'node:stream';

export const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

const SAFE_AUDIO_TYPES = new Set([
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
]);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

export function detectAudioContentType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 12) === 'WAVE'
  ) {
    return 'audio/wav';
  }
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'OggS') return 'audio/ogg';
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'audio/webm';
  }
  if (
    bytes.length >= 3 &&
    ascii(bytes, 0, 3) === 'ID3'
  ) {
    return 'audio/mpeg';
  }
  if (
    bytes.length >= 2 &&
    bytes[0] === 0xff &&
    (bytes[1] & 0xe0) === 0xe0
  ) {
    return 'audio/mpeg';
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (['M4A ', 'M4B ', 'isom', 'iso2', 'mp41', 'mp42'].includes(brand)) {
      return 'audio/mp4';
    }
  }
  return null;
}

export function safeStoredAudioContentType(value: string | undefined): string {
  const normalized = value?.split(';')[0]?.trim().toLowerCase() ?? '';
  return SAFE_AUDIO_TYPES.has(normalized) ? normalized : 'application/octet-stream';
}

export function audioExtension(contentType: string): string {
  switch (contentType) {
    case 'audio/wav': return 'wav';
    case 'audio/ogg': return 'ogg';
    case 'audio/mpeg': return 'mp3';
    case 'audio/mp4': return 'm4a';
    default: return 'webm';
  }
}

export type ParsedByteRange =
  | { kind: 'none' }
  | { kind: 'valid'; start: number; end: number }
  | { kind: 'invalid' };

export function parseSingleByteRange(
  header: string | null,
  totalLength: number,
): ParsedByteRange {
  if (!header) return { kind: 'none' };
  if (!Number.isSafeInteger(totalLength) || totalLength < 0) return { kind: 'invalid' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || totalLength === 0) {
    return { kind: 'invalid' };
  }

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: 'invalid' };
    const length = Math.min(suffixLength, totalLength);
    return { kind: 'valid', start: totalLength - length, end: totalLength - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : totalLength - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= totalLength ||
    requestedEnd < start
  ) {
    return { kind: 'invalid' };
  }
  return {
    kind: 'valid',
    start,
    end: Math.min(requestedEnd, totalLength - 1),
  };
}

export async function validatedAudioRequestStream(request: Request): Promise<{
  stream: Readable;
  contentLength: number;
  contentType: string;
}> {
  const contentLength = Number(request.headers.get('content-length'));
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 1 ||
    contentLength > MAX_AUDIO_BYTES
  ) {
    throw new Error('A valid Content-Length within the audio limit is required.');
  }
  if (!request.body) throw new Error('Audio body is required.');

  const reader = request.body.getReader();
  const initialChunks: Uint8Array[] = [];
  let initialLength = 0;
  while (initialLength < 16) {
    const part = await reader.read();
    if (part.done) break;
    initialChunks.push(part.value);
    initialLength += part.value.byteLength;
  }
  const signature = new Uint8Array(initialLength);
  let signatureOffset = 0;
  for (const chunk of initialChunks) {
    signature.set(chunk, signatureOffset);
    signatureOffset += chunk.byteLength;
  }
  const contentType = detectAudioContentType(signature);
  if (!contentType) {
    await reader.cancel('Unsupported audio signature.');
    throw new Error('Unsupported audio format.');
  }

  async function* chunks() {
    let received = 0;
    try {
      for (const chunk of initialChunks) {
        received += chunk.byteLength;
        if (received > MAX_AUDIO_BYTES) throw new Error('Audio body exceeds the size limit.');
        if (received > contentLength) throw new Error('Audio body length did not match Content-Length.');
        yield chunk;
      }
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        received += part.value.byteLength;
        if (received > MAX_AUDIO_BYTES) throw new Error('Audio body exceeds the size limit.');
        if (received > contentLength) throw new Error('Audio body length did not match Content-Length.');
        yield part.value;
      }
      if (received !== contentLength) throw new Error('Audio body length did not match Content-Length.');
    } finally {
      reader.releaseLock();
    }
  }

  return {
    stream: Readable.from(chunks()),
    contentLength,
    contentType,
  };
}
