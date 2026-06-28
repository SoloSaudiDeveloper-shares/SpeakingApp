import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getAzureSpeechTranscriptionConfig } from '@/lib/ai/providers';
import { recordSpeechReliabilityEvent } from '@/lib/actions/speech-reliability-actions';

/**
 * POST /api/stt/azure-transcribe
 * Azure AI Speech short-audio speech-to-text.
 *
 * Accepts a multipart form with a 16 kHz mono PCM WAV `file`. The Azure Speech
 * key remains server-side. Returns 503 when Azure Speech is not configured so
 * the browser engine can fall back to the bundled offline model.
 */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { apiKey, region, language } = getAzureSpeechTranscriptionConfig();
  const record = (event: { success: boolean; statusCode?: number; errorCode?: string; noSpeech?: boolean; fallbackUsed?: boolean }) => {
    try {
      recordSpeechReliabilityEvent({
        userId: user.id,
        studentId: user.studentId,
        eventType: 'stt',
        provider: 'azure-speech',
        route: '/api/stt/azure-transcribe',
        success: event.success,
        statusCode: event.statusCode,
        errorCode: event.errorCode,
        latencyMs: Date.now() - startedAt,
        noSpeech: !!event.noSpeech,
        fallbackUsed: !!event.fallbackUsed,
        metadata: { region, language },
      });
    } catch { /* telemetry must not break STT */ }
  };
  if (!apiKey) {
    record({ success: false, statusCode: 503, errorCode: 'no-key', fallbackUsed: true });
    return Response.json({ error: 'no-key', message: 'Azure Speech is not configured.' }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    record({ success: false, statusCode: 400, errorCode: 'bad-request' });
    return Response.json({ error: 'bad-request' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) {
    record({ success: false, statusCode: 400, errorCode: 'no-file' });
    return Response.json({ error: 'no-file' }, { status: 400 });
  }

  const url =
    `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
    `?language=${encodeURIComponent(language || 'en-US')}&format=detailed`;

  try {
    const audioBuf = Buffer.from(await file.arrayBuffer());
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        Accept: 'application/json',
      },
      body: audioBuf,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      record({ success: false, statusCode: 502, errorCode: `azure-${res.status}`, fallbackUsed: true });
      return Response.json(
        { error: 'azure-failed', status: res.status, detail: detail.slice(0, 300) },
        { status: 502 },
      );
    }

    const data = await res.json();
    const recognitionStatus = String(data.RecognitionStatus ?? data.recognitionStatus ?? '');
    const best = Array.isArray(data.NBest) ? data.NBest[0] : null;
    const transcript = String(best?.Display ?? data.DisplayText ?? best?.Lexical ?? '').trim();
    const confidence = typeof best?.Confidence === 'number' ? best.Confidence : null;
    const noSpeech = !transcript || /NoMatch|InitialSilenceTimeout|BabbleTimeout/i.test(recognitionStatus);
    record({ success: !noSpeech, statusCode: 200, errorCode: noSpeech ? 'no-speech' : undefined, noSpeech });

    return Response.json({
      transcript,
      confidence,
      recognitionStatus,
      provider: 'azure-speech',
      language,
    });
  } catch (e) {
    record({ success: false, statusCode: 502, errorCode: 'network', fallbackUsed: true });
    return Response.json({ error: 'network', message: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
