import {
  getAuthorizedAttemptByAudioPath,
  requireAuthenticated,
} from '@/lib/auth/authorization';
import { normalizeAudioObjectKey } from '@/lib/storage/audio-storage';
import { audioObjectResponse } from '@/lib/storage/audio-response';

async function serve(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
  head: boolean,
) {
  try {
    const auth = await requireAuthenticated();
    if (!auth.ok) return auth.response;
    const { path } = await params;
    const key = normalizeAudioObjectKey(path.join('/'));
    const authorized = await getAuthorizedAttemptByAudioPath(auth.user, key);
    if (!authorized) return new Response('Not found', { status: 404 });
    return audioObjectResponse(request, key, { head });
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) {
      return new Response('Not found', { status: 404 });
    }
    console.error('[audio] Download failed.', {
      statusCode: (error as { statusCode?: number }).statusCode ?? null,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return new Response('Audio unavailable', { status: 503 });
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return serve(request, context, false);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return serve(request, context, true);
}
