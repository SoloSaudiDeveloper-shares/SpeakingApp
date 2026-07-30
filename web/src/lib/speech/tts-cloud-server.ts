import 'server-only';

import type { CloudTtsProviderId, TtsProviderDefinition } from './tts-policy';

export class TtsProviderError extends Error {
  constructor(
    public readonly provider: CloudTtsProviderId,
    public readonly reason:
      | 'not-configured'
      | 'timeout'
      | 'upstream-rejected'
      | 'invalid-response'
      | 'network',
    public readonly upstreamStatus?: number,
  ) {
    super(`The ${provider} speech provider could not complete the request.`);
  }
}

export interface CloudTtsRequest {
  provider: CloudTtsProviderId;
  input: string;
  voice: string;
  rate: number;
  definition: TtsProviderDefinition;
  apiKey: string;
  azureRegion?: string;
  signal?: AbortSignal;
  onStreamOutcome?: (outcome: CloudTtsStreamOutcome) => void | Promise<void>;
}

export interface CloudTtsStreamOutcome {
  outcome: 'completed' | 'stalled' | 'hard-timeout' | 'cancelled' | 'error';
  audioBytes: number;
  elapsedMs: number;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function upstreamRequest(request: CloudTtsRequest): { url: string; init: RequestInit } {
  if (request.provider === 'openai-tts') {
    return {
      url: 'https://api.openai.com/v1/audio/speech',
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          model: request.definition.modelId,
          input: request.input,
          voice: request.voice,
          response_format: 'mp3',
          speed: request.rate,
        }),
      },
    };
  }

  const region = request.azureRegion;
  if (!region || !/^[a-z0-9-]{2,40}$/.test(region)) {
    throw new TtsProviderError('azure-speech', 'not-configured');
  }
  const ratePercent = Math.round((request.rate - 1) * 100);
  const ssml = [
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">',
    `<voice name="${escapeXml(request.voice)}">`,
    `<prosody rate="${ratePercent >= 0 ? '+' : ''}${ratePercent}%">`,
    escapeXml(request.input),
    '</prosody></voice></speak>',
  ].join('');
  return {
    url: `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    init: {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': request.apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
        'User-Agent': 'Speaking-Lab',
        Accept: 'audio/mpeg',
      },
      body: ssml,
    },
  };
}

function monitoredBody(
  body: ReadableStream<Uint8Array>,
  abort: AbortController,
  options: {
    startedAt: number;
    hardTimeoutMs: number;
    removeRequestAbortListener: () => void;
    onStreamOutcome?: CloudTtsRequest['onStreamOutcome'];
  },
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let audioBytes = 0;
  let finished = false;
  let timeoutReason: 'stalled' | 'hard-timeout' | null = null;
  let stallTimeout: ReturnType<typeof setTimeout>;
  let hardTimeout: ReturnType<typeof setTimeout>;
  let outputController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const finish = (outcome: CloudTtsStreamOutcome['outcome']) => {
    if (finished) return;
    finished = true;
    clearTimeout(stallTimeout);
    clearTimeout(hardTimeout);
    options.removeRequestAbortListener();
    const result: CloudTtsStreamOutcome = {
      outcome,
      audioBytes,
      elapsedMs: Math.max(0, Date.now() - options.startedAt),
    };
    try {
      void Promise.resolve(options.onStreamOutcome?.(result)).catch(() => undefined);
    } catch {
      // Operational telemetry must never change audio delivery.
    }
  };
  const timeoutStream = (outcome: 'stalled' | 'hard-timeout', message: string) => {
    timeoutReason = outcome;
    const error = new Error(message);
    finish(outcome);
    abort.abort(error);
    void reader.cancel(error).catch(() => undefined);
    outputController?.error(error);
  };
  const armStallTimeout = () => {
    clearTimeout(stallTimeout);
    stallTimeout = setTimeout(
      () => timeoutStream('stalled', 'TTS stream made no progress for 12 seconds.'),
      12_000,
    );
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      outputController = controller;
      hardTimeout = setTimeout(
        () => timeoutStream('hard-timeout', 'TTS stream exceeded its hard timeout.'),
        options.hardTimeoutMs,
      );
      armStallTimeout();
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          finish('completed');
          outputController = null;
          controller.close();
          return;
        }
        audioBytes += result.value.byteLength;
        armStallTimeout();
        controller.enqueue(result.value);
      } catch (error) {
        finish(timeoutReason ?? (abort.signal.aborted ? 'cancelled' : 'error'));
        if (!timeoutReason) controller.error(error);
      }
    },
    async cancel(reason) {
      finish(timeoutReason ?? 'cancelled');
      outputController = null;
      abort.abort(reason);
      await reader.cancel(reason);
    },
  });
}

export async function synthesizeCloudSpeech(request: CloudTtsRequest): Promise<Response> {
  if (!request.apiKey) throw new TtsProviderError(request.provider, 'not-configured');
  const startedAt = Date.now();
  const upstream = upstreamRequest(request);
  const abort = new AbortController();
  const forwardAbort = () => abort.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', forwardAbort, { once: true });
  let timeout = setTimeout(() => abort.abort(new Error('first-byte-timeout')), 15_000);
  let response: Response;
  try {
    response = await fetch(upstream.url, {
      ...upstream.init,
      redirect: 'error',
      signal: abort.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    request.signal?.removeEventListener('abort', forwardAbort);
    const timedOut = abort.signal.aborted && !request.signal?.aborted;
    throw new TtsProviderError(request.provider, timedOut ? 'timeout' : 'network');
  }
  clearTimeout(timeout);
  if (!response.ok) {
    request.signal?.removeEventListener('abort', forwardAbort);
    throw new TtsProviderError(request.provider, 'upstream-rejected', response.status);
  }
  if (!response.body || !(response.headers.get('content-type') ?? '').match(/^(audio\/|application\/octet-stream)/i)) {
    request.signal?.removeEventListener('abort', forwardAbort);
    throw new TtsProviderError(request.provider, 'invalid-response');
  }
  const elapsedBeforeStreaming = Date.now() - startedAt;
  const hardTimeoutMs = Math.max(1, 60_000 - elapsedBeforeStreaming);
  const body = monitoredBody(response.body, abort, {
    startedAt,
    hardTimeoutMs,
    removeRequestAbortListener: () =>
      request.signal?.removeEventListener('abort', forwardAbort),
    onStreamOutcome: request.onStreamOutcome,
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
