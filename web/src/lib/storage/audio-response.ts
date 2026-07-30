import {
  getAudioObjectProperties,
  streamAudioObject,
} from '@/lib/storage/audio-storage';
import {
  parseSingleByteRange,
  safeStoredAudioContentType,
} from '@/lib/storage/audio-validation';

export async function audioObjectResponse(
  request: Request,
  key: string,
  options: { head?: boolean } = {},
): Promise<Response> {
  const properties = await getAudioObjectProperties(key);
  const totalLength = properties.contentLength;
  const range = parseSingleByteRange(request.headers.get('range'), totalLength);
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Type': safeStoredAudioContentType(properties.contentType),
    'X-Content-Type-Options': 'nosniff',
  });
  if (properties.etag) headers.set('ETag', properties.etag);
  if (properties.lastModified) headers.set('Last-Modified', properties.lastModified.toUTCString());

  if (range.kind === 'invalid') {
    headers.set('Content-Range', `bytes */${totalLength}`);
    return new Response(null, { status: 416, headers });
  }

  const start = range.kind === 'valid' ? range.start : 0;
  const end = range.kind === 'valid' ? range.end : Math.max(0, totalLength - 1);
  const contentLength = totalLength === 0 ? 0 : end - start + 1;
  headers.set('Content-Length', String(contentLength));
  if (range.kind === 'valid') headers.set('Content-Range', `bytes ${start}-${end}/${totalLength}`);

  const status = range.kind === 'valid' ? 206 : 200;
  if (options.head || totalLength === 0) return new Response(null, { status, headers });
  const body = await streamAudioObject(key, {
    offset: start,
    count: contentLength,
  });
  return new Response(body, { status, headers });
}
