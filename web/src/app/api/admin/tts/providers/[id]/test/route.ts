import { synthesizeCloudSpeech, TtsProviderError } from '@/lib/speech/tts-cloud-server';
import {
  getAzureSpeechRegion,
  getCloudTtsSecret,
  getTtsProviderPolicy,
} from '@/lib/speech/tts-config-server';
import { rejectCrossOriginMutation, requireTtsAdmin } from '@/lib/speech/tts-route-auth';
import {
  consumeTtsRateLimit,
  releaseTtsUsage,
  reserveTtsUsage,
  TtsQuotaExceededError,
  TtsRateLimitError,
} from '@/lib/speech/tts-usage-server';
import type { CloudTtsProviderId } from '@/lib/speech/tts-policy';
import { recordSpeechReliabilityEvent } from '@/lib/actions/speech-reliability-actions';

const TEST_TEXT = 'Hello. This is the Speaking Lab voice test.';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const auth = await requireTtsAdmin();
  if ('response' in auth) return auth.response;
  const { id } = await params;
  if (id !== 'azure-speech' && id !== 'openai-tts') {
    return Response.json({ error: 'Unsupported TTS provider.' }, { status: 404 });
  }
  const provider = id as CloudTtsProviderId;
  const { policy } = await getTtsProviderPolicy();
  const definition = policy.providers[provider];
  const characters = Array.from(TEST_TEXT).length;
  let reserved = false;
  let reservationPeriod = '';
  try {
    await consumeTtsRateLimit(auth.user.id, provider);
    const usage = await reserveTtsUsage(provider, characters, definition.monthlyCharacterCap);
    reserved = true;
    reservationPeriod = usage.periodMonth;
    const apiKey = await getCloudTtsSecret(provider);
    if (!apiKey) throw new TtsProviderError(provider, 'not-configured');
    const response = await synthesizeCloudSpeech({
      provider,
      input: TEST_TEXT,
      voice: definition.voiceId,
      rate: policy.rate,
      definition,
      apiKey,
      azureRegion: provider === 'azure-speech' ? await getAzureSpeechRegion() : undefined,
      signal: request.signal,
      onStreamOutcome: (outcome) => recordSpeechReliabilityEvent({
        userId: auth.user.id,
        eventType: 'tts',
        provider,
        route: `/api/admin/tts/providers/${provider}/test`,
        success: outcome.outcome === 'completed',
        errorCode: outcome.outcome === 'completed' ? null : outcome.outcome,
        latencyMs: outcome.elapsedMs,
        metadata: {
          characters,
          audio_bytes: outcome.audioBytes,
          stream_outcome: outcome.outcome,
        },
      }).then(() => undefined).catch(() => undefined),
    });
    response.headers.set('X-TTS-Provider', provider);
    response.headers.set('X-TTS-Characters-Used', String(usage.characters));
    response.headers.set('X-TTS-Test-Counted', 'true');
    return response;
  } catch (error) {
    if (
      reserved &&
      (!(error instanceof TtsProviderError) || error.reason === 'not-configured')
    ) {
      await releaseTtsUsage(provider, characters, reservationPeriod).catch(() => undefined);
    }
    if (error instanceof TtsRateLimitError) {
      return Response.json(
        { error: error.message },
        { status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds) } },
      );
    }
    if (error instanceof TtsQuotaExceededError) {
      return Response.json({ error: error.message, cap: error.cap }, { status: 429 });
    }
    if (error instanceof TtsProviderError) {
      return Response.json(
        { error: error.message, reason: error.reason },
        { status: error.reason === 'not-configured' ? 503 : 502 },
      );
    }
    return Response.json({ error: 'Provider test failed.' }, { status: 500 });
  }
}
