import { synthesizeCloudSpeech, TtsProviderError } from '@/lib/speech/tts-cloud-server';
import {
  getAzureSpeechRegion,
  getCloudTtsSecret,
  getTtsProviderPolicy,
} from '@/lib/speech/tts-config-server';
import { rejectCrossOriginMutation, requireTtsUser } from '@/lib/speech/tts-route-auth';
import {
  consumeTtsRateLimit,
  releaseTtsUsage,
  reserveTtsUsage,
  TtsQuotaExceededError,
  TtsRateLimitError,
} from '@/lib/speech/tts-usage-server';
import type { CloudTtsProviderId } from '@/lib/speech/tts-policy';
import { recordSpeechReliabilityEvent } from '@/lib/actions/speech-reliability-actions';

const CLOUD_PROVIDERS = new Set<CloudTtsProviderId>(['azure-speech', 'openai-tts']);

function parseRequestBody(value: unknown): {
  providerId: CloudTtsProviderId;
  input: string;
  voiceId?: string;
  rate?: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON body.');
  const body = value as Record<string, unknown>;
  const unknownKey = Object.keys(body).find((key) =>
    !['providerId', 'input', 'voiceId', 'rate'].includes(key));
  if (unknownKey) throw new Error(`Unsupported field "${unknownKey}".`);
  if (typeof body.providerId !== 'string' || !CLOUD_PROVIDERS.has(body.providerId as CloudTtsProviderId)) {
    throw new Error('Only paid cloud TTS providers are accepted by this route.');
  }
  if (typeof body.input !== 'string') throw new Error('input must be text.');
  const input = body.input.trim();
  const length = Array.from(input).length;
  if (length < 1 || length > 1_000 || input.includes('\0')) {
    throw new Error('input must contain between 1 and 1,000 characters.');
  }
  if (body.voiceId !== undefined && (typeof body.voiceId !== 'string' || body.voiceId.length > 100)) {
    throw new Error('voiceId is invalid.');
  }
  if (
    body.rate !== undefined &&
    (typeof body.rate !== 'number' || !Number.isFinite(body.rate) || body.rate < 0.5 || body.rate > 2)
  ) {
    throw new Error('rate must be between 0.5 and 2.');
  }
  return {
    providerId: body.providerId as CloudTtsProviderId,
    input,
    voiceId: body.voiceId as string | undefined,
    rate: body.rate as number | undefined,
  };
}

export async function POST(request: Request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const auth = await requireTtsUser();
  if ('response' in auth) return auth.response;

  let body: ReturnType<typeof parseRequestBody>;
  try {
    body = parseRequestBody(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid request.' },
      { status: 400 },
    );
  }

  const { policy } = await getTtsProviderPolicy();
  const definition = policy.providers[body.providerId];
  if (!definition.enabled) {
    return Response.json({ error: 'The selected TTS provider is disabled.' }, { status: 409 });
  }
  const requestedVoice = body.voiceId?.trim();
  if (requestedVoice && !policy.allowStudentVoiceChoice) {
    return Response.json({ error: 'Voice selection is managed by the administrator.' }, { status: 403 });
  }
  if (requestedVoice && !definition.allowedVoiceIds.includes(requestedVoice)) {
    return Response.json({ error: 'The selected voice is not allowed.' }, { status: 400 });
  }
  const voice = requestedVoice || definition.voiceId;
  // Playback speed is organization-owned. Keep accepting the legacy request
  // field for wire compatibility, but never let it override policy.
  const rate = policy.rate;
  const characterCount = Array.from(body.input).length;
  let reserved = false;
  let reservationPeriod = '';
  try {
    await consumeTtsRateLimit(auth.user.id, body.providerId);
    const usage = await reserveTtsUsage(
      body.providerId,
      characterCount,
      definition.monthlyCharacterCap,
    );
    reserved = true;
    reservationPeriod = usage.periodMonth;
    const apiKey = await getCloudTtsSecret(body.providerId);
    if (!apiKey) throw new TtsProviderError(body.providerId, 'not-configured');
    const response = await synthesizeCloudSpeech({
      provider: body.providerId,
      input: body.input,
      voice,
      rate,
      definition,
      apiKey,
      azureRegion: body.providerId === 'azure-speech' ? await getAzureSpeechRegion() : undefined,
      signal: request.signal,
      onStreamOutcome: (outcome) => recordSpeechReliabilityEvent({
        userId: auth.user.id,
        studentId: auth.user.studentId,
        eventType: 'tts',
        provider: body.providerId,
        route: '/api/tts/speech',
        success: outcome.outcome === 'completed',
        errorCode: outcome.outcome === 'completed' ? null : outcome.outcome,
        latencyMs: outcome.elapsedMs,
        metadata: {
          characters: characterCount,
          audio_bytes: outcome.audioBytes,
          stream_outcome: outcome.outcome,
        },
      }).then(() => undefined).catch(() => undefined),
    });
    response.headers.set('X-TTS-Provider', body.providerId);
    response.headers.set('X-TTS-Characters-Used', String(usage.characters));
    response.headers.set(
      'X-TTS-Characters-Remaining',
      String(Math.max(0, definition.monthlyCharacterCap - usage.characters)),
    );
    return response;
  } catch (error) {
    if (
      reserved &&
      (!(error instanceof TtsProviderError) || error.reason === 'not-configured')
    ) {
      await releaseTtsUsage(body.providerId, characterCount, reservationPeriod).catch(() => undefined);
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
      const status = error.reason === 'not-configured' ? 503 : 502;
      void recordSpeechReliabilityEvent({
        userId: auth.user.id,
        studentId: auth.user.studentId,
        eventType: 'tts',
        provider: body.providerId,
        route: '/api/tts/speech',
        success: false,
        statusCode: status,
        errorCode: error.reason,
        metadata: {
          characters: characterCount,
          audio_bytes: 0,
          stream_outcome: 'request-error',
        },
      }).catch(() => undefined);
      return Response.json(
        { error: error.message, reason: error.reason },
        { status, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return Response.json({ error: 'Speech synthesis failed.' }, { status: 500 });
  }
}
