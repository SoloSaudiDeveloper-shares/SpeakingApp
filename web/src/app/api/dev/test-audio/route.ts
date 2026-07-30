import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

const PUBLIC_DIAGNOSTIC_AUDIO =
  'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav';

/**
 * GET /api/dev/test-audio
 * Serves the JFK test audio so the in-browser test can fetch it.
 * Safe for any authenticated user; it contains only a public diagnostic clip.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return new Response('Unauthorized', { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user) return new Response('Unauthorized', { status: 401 });

  try {
    const upstream = await fetch(PUBLIC_DIAGNOSTIC_AUDIO, { cache: 'no-store' });
    if (!upstream.ok) {
      return new Response('Public diagnostic audio is unavailable.', { status: 502 });
    }
    return new Response(await upstream.arrayBuffer(), {
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response('Public diagnostic audio is unavailable.', { status: 502 });
  }
}
