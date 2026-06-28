import fs from 'node:fs';
import path from 'node:path';
import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

/**
 * GET /api/dev/test-audio
 * Serves the JFK test audio so the in-browser test can fetch it.
 * Safe for any authenticated user; it contains only a public diagnostic clip.
 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return new Response('Unauthorized', { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const audioPath = path.join(process.cwd(), '.test-cache', 'jfk.wav');
  if (!fs.existsSync(audioPath)) {
    return new Response('Test audio not found. Run scripts/test-transformers-stt.mjs first.', { status: 404 });
  }
  const buf = fs.readFileSync(audioPath);
  return new Response(buf, {
    headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' },
  });
}
