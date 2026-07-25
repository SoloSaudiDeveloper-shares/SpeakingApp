import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { downloadAudioObject } from '@/lib/storage/audio-storage';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const token = (await cookies()).get('session-token')?.value;
    if (!token || !await getSessionFromToken(token)) {
      return new Response('Not authenticated', { status: 401 });
    }
    const { path } = await params;
    const object = await downloadAudioObject(path.join('/'));
    return new Response(object.data, {
      headers: {
        'Content-Type': object.contentType,
        'Content-Length': String(object.data.length),
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) {
      return new Response('Not found', { status: 404 });
    }
    console.error('[audio] Download failed:', error instanceof Error ? error.message : 'unknown error');
    return new Response('Audio unavailable', { status: 503 });
  }
}
