import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getPronunciationConfig } from '@/lib/ai/providers';
import { recordSpeechReliabilityEvent } from '@/lib/actions/speech-reliability-actions';

/**
 * POST /api/pronunciation/assess
 * Azure AI Speech — Pronunciation Assessment. Accepts a multipart form with a
 * 16 kHz mono PCM WAV `file` and the `referenceText` the learner was asked to
 * say. Returns Azure's phoneme-level assessment (accuracy / fluency /
 * completeness / prosody + per-word + per-phoneme scores). The key stays
 * server-side. Returns 503 {configured:false} when no Azure key is set so the
 * client falls back to transcript-based scoring.
 */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { apiKey, region } = getPronunciationConfig();
  const record = (event: { success: boolean; statusCode?: number; errorCode?: string; noSpeech?: boolean; fallbackUsed?: boolean }) => {
    try {
      recordSpeechReliabilityEvent({
        userId: user.id,
        studentId: user.studentId,
        eventType: 'pronunciation',
        provider: 'azure-pronunciation',
        route: '/api/pronunciation/assess',
        success: event.success,
        statusCode: event.statusCode,
        errorCode: event.errorCode,
        latencyMs: Date.now() - startedAt,
        noSpeech: !!event.noSpeech,
        fallbackUsed: !!event.fallbackUsed,
        metadata: { region },
      });
    } catch { /* telemetry must not break pronunciation assessment */ }
  };
  if (!apiKey) {
    record({ success: false, statusCode: 503, errorCode: 'no-key', fallbackUsed: true });
    return Response.json({ configured: false }, { status: 503 });
  }

  let form: FormData;
  try { form = await req.formData(); } catch {
    record({ success: false, statusCode: 400, errorCode: 'bad-request' });
    return Response.json({ error: 'bad-request' }, { status: 400 });
  }
  const file = form.get('file');
  const referenceText = String(form.get('referenceText') ?? '').trim();
  if (!(file instanceof Blob)) {
    record({ success: false, statusCode: 400, errorCode: 'no-file' });
    return Response.json({ error: 'no-file' }, { status: 400 });
  }
  if (!referenceText) {
    record({ success: false, statusCode: 400, errorCode: 'no-reference' });
    return Response.json({ error: 'no-reference' }, { status: 400 });
  }

  // Pronunciation Assessment config (base64 JSON in a header).
  const paConfig = {
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    Dimension: 'Comprehensive',
    EnableProsodyAssessment: true,
  };
  const paHeader = Buffer.from(JSON.stringify(paConfig), 'utf-8').toString('base64');

  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`;

  try {
    const audioBuf = Buffer.from(await file.arrayBuffer());
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        'Pronunciation-Assessment': paHeader,
        Accept: 'application/json',
      },
      body: audioBuf,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      record({ success: false, statusCode: 502, errorCode: `azure-${res.status}`, fallbackUsed: true });
      return Response.json({ error: 'azure-failed', status: res.status, detail: detail.slice(0, 300) }, { status: 502 });
    }
    const data = await res.json();
    const status = String(data.RecognitionStatus ?? data.recognitionStatus ?? '');
    const noSpeech = /NoMatch|InitialSilenceTimeout|BabbleTimeout/i.test(status);
    record({ success: !noSpeech, statusCode: 200, errorCode: noSpeech ? 'no-speech' : undefined, noSpeech });
    return Response.json(data);
  } catch (e) {
    record({ success: false, statusCode: 502, errorCode: 'network', fallbackUsed: true });
    return Response.json({ error: 'network', message: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
