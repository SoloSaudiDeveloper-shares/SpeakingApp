import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getTranscriptionConfig } from '@/lib/ai/providers';
import { recordSpeechReliabilityEvent } from '@/lib/actions/speech-reliability-actions';

/**
 * POST /api/stt/transcribe
 * Cloud speech-to-text via Groq's hosted Whisper (whisper-large-v3-turbo).
 * Accepts a multipart form with an audio `file`. The Groq key stays server-side.
 * Returns 503 (no key) or 502 (Groq error/offline) so the client can fall back
 * to the bundled offline Whisper engine.
 */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { apiKey, baseUrl, model } = getTranscriptionConfig();
  const record = (event: { success: boolean; statusCode?: number; errorCode?: string; noSpeech?: boolean; fallbackUsed?: boolean }) => {
    try {
      recordSpeechReliabilityEvent({
        userId: user.id,
        studentId: user.studentId,
        eventType: 'stt',
        provider: 'groq-whisper',
        route: '/api/stt/transcribe',
        success: event.success,
        statusCode: event.statusCode,
        errorCode: event.errorCode,
        latencyMs: Date.now() - startedAt,
        noSpeech: !!event.noSpeech,
        fallbackUsed: !!event.fallbackUsed,
        metadata: { model },
      });
    } catch { /* telemetry must not break STT */ }
  };
  if (!apiKey) {
    record({ success: false, statusCode: 503, errorCode: 'no-key', fallbackUsed: true });
    return Response.json({ error: 'no-key', message: 'Cloud transcription is not configured.' }, { status: 503 });
  }

  let form: FormData;
  try { form = await req.formData(); } catch {
    record({ success: false, statusCode: 400, errorCode: 'bad-request' });
    return Response.json({ error: 'bad-request' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    record({ success: false, statusCode: 400, errorCode: 'no-file' });
    return Response.json({ error: 'no-file' }, { status: 400 });
  }

  const groqForm = new FormData();
  const suppliedName = typeof (file as File).name === 'string' ? (file as File).name : 'audio.webm';
  groqForm.append('file', file, suppliedName || 'audio.webm');
  groqForm.append('model', model);
  groqForm.append('language', 'en');
  groqForm.append('response_format', 'verbose_json');
  groqForm.append('timestamp_granularities[]', 'word');
  groqForm.append('timestamp_granularities[]', 'segment');
  groqForm.append('temperature', '0');

  try {
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: groqForm,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      record({ success: false, statusCode: 502, errorCode: `provider-${res.status}`, fallbackUsed: true });
      return Response.json(
        { error: 'provider-failed', status: res.status, detail: detail.slice(0, 200) },
        { status: 502 },
      );
    }
    const data = await res.json();
    const transcript = String(data.text ?? '').trim();
    record({ success: !!transcript, statusCode: 200, errorCode: transcript ? undefined : 'no-speech', noSpeech: !transcript });
    const words = Array.isArray(data.words) ? data.words.flatMap((word: unknown) => {
      if (!word || typeof word !== 'object') return [];
      const item = word as Record<string, unknown>;
      const text = String(item.word ?? '').trim();
      const start = Number(item.start);
      const end = Number(item.end);
      return text && Number.isFinite(start) && Number.isFinite(end) ? [{ word: text, start, end }] : [];
    }) : [];
    const segments = Array.isArray(data.segments) ? data.segments : [];
    return Response.json({ transcript, words, segments, duration: Number(data.duration) || null });
  } catch (e) {
    record({ success: false, statusCode: 502, errorCode: 'network', fallbackUsed: true });
    return Response.json({ error: 'network', message: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
