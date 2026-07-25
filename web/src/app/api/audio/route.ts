import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { uploadAudioObject } from '@/lib/storage/audio-storage';

const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

function extensionFor(contentType: string) {
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'mp3';
  if (contentType.includes('mp4')) return 'm4a';
  return 'webm';
}

export async function POST(request: Request) {
  try {
    const token = (await cookies()).get('session-token')?.value;
    const user = token ? await getSessionFromToken(token) : null;
    if (!user?.studentId) return Response.json({ error: 'Student only.' }, { status: 403 });
    const form = await request.formData();
    const file = form.get('audio');
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_AUDIO_BYTES) {
      return Response.json({ error: 'Audio file is missing or too large.' }, { status: 400 });
    }
    const date = new Date();
    const key = [
      String(user.studentId),
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.${extensionFor(file.type)}`,
    ].join('/');
    await uploadAudioObject(key, Buffer.from(await file.arrayBuffer()), file.type);
    return Response.json({ key }, { status: 201 });
  } catch (error) {
    console.error('[audio] Upload failed:', error instanceof Error ? error.message : 'unknown error');
    return Response.json({ error: 'Audio upload failed.' }, { status: 503 });
  }
}
