'use client';

export const TTS_BROWSER_STALL_TIMEOUT_MS = 12_000;
export const TTS_BROWSER_HARD_TIMEOUT_MS = 60_000;
export const TTS_BROWSER_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export type TtsBrowserStreamOutcome =
  | 'completed'
  | 'stalled'
  | 'hard-timeout'
  | 'cancelled'
  | 'too-large'
  | 'invalid-response'
  | 'http-error'
  | 'network-error'
  | 'error';

export interface TtsBrowserStreamTelemetry {
  provider: string;
  outcome: TtsBrowserStreamOutcome;
  ttfbMs: number;
  totalMs: number;
  audioBytes: number;
}

export class TtsBrowserStreamError extends Error {
  constructor(public readonly outcome: Exclude<TtsBrowserStreamOutcome, 'completed'>) {
    super(
      outcome === 'stalled'
        ? 'Speech audio made no progress for 12 seconds.'
        : outcome === 'hard-timeout'
          ? 'Speech audio exceeded its 60-second time limit.'
          : outcome === 'too-large'
            ? 'Speech audio exceeded the allowed response size.'
            : outcome === 'cancelled'
              ? 'Speech audio was cancelled.'
              : 'Speech audio could not be read.',
    );
  }
}

export interface ReadTtsAudioResponseOptions {
  provider: string;
  requestStartedAt: number;
  responseReceivedAt: number;
  signal?: AbortSignal;
  stallTimeoutMs?: number;
  hardTimeoutMs?: number;
  maxAudioBytes?: number;
  onTelemetry?: (telemetry: TtsBrowserStreamTelemetry) => void;
}

export interface FetchTtsAudioResponseOptions {
  provider: string;
  requestStartedAt: number;
  signal?: AbortSignal;
  headerTimeoutMs?: number;
  hardTimeoutMs?: number;
  onTelemetry?: (telemetry: TtsBrowserStreamTelemetry) => void;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  timeoutOutcome: 'stalled' | 'hard-timeout',
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () =>
      finish(() => reject(new TtsBrowserStreamError('cancelled')));
    const timeout = setTimeout(
      () => finish(() => reject(new TtsBrowserStreamError(timeoutOutcome))),
      timeoutMs,
    );
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      (result) => finish(() => resolve(result)),
      (error) => finish(() => reject(error)),
    );
  });
}

export async function fetchTtsAudioResponseWithDeadline(
  input: RequestInfo | URL,
  init: Omit<RequestInit, 'signal'>,
  options: FetchTtsAudioResponseOptions,
): Promise<{ response: Response; responseReceivedAt: number }> {
  const headerTimeoutMs = positiveLimit(
    options.headerTimeoutMs,
    TTS_BROWSER_STALL_TIMEOUT_MS,
  );
  const hardTimeoutMs = positiveLimit(
    options.hardTimeoutMs,
    TTS_BROWSER_HARD_TIMEOUT_MS,
  );
  const hardRemaining = hardTimeoutMs - (Date.now() - options.requestStartedAt);
  if (hardRemaining <= 0) {
    const error = new TtsBrowserStreamError('hard-timeout');
    options.onTelemetry?.({
      provider: options.provider,
      outcome: error.outcome,
      ttfbMs: Math.max(0, Date.now() - options.requestStartedAt),
      totalMs: Math.max(0, Date.now() - options.requestStartedAt),
      audioBytes: 0,
    });
    throw error;
  }

  const abort = new AbortController();
  const forwardAbort = () => abort.abort(options.signal?.reason);
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener('abort', forwardAbort, { once: true });
  let timeoutOutcome: 'stalled' | 'hard-timeout' | null = null;
  const deadlineMs = Math.min(headerTimeoutMs, hardRemaining);
  const timeout = setTimeout(() => {
    timeoutOutcome = hardRemaining <= headerTimeoutMs ? 'hard-timeout' : 'stalled';
    abort.abort(new TtsBrowserStreamError(timeoutOutcome));
  }, deadlineMs);

  try {
    const response = await fetch(input, { ...init, signal: abort.signal });
    return { response, responseReceivedAt: Date.now() };
  } catch (error) {
    const outcome: TtsBrowserStreamOutcome = timeoutOutcome ??
      (options.signal?.aborted ? 'cancelled' : 'network-error');
    const elapsed = Math.max(0, Date.now() - options.requestStartedAt);
    options.onTelemetry?.({
      provider: options.provider,
      outcome,
      ttfbMs: elapsed,
      totalMs: elapsed,
      audioBytes: 0,
    });
    if (timeoutOutcome) throw new TtsBrowserStreamError(timeoutOutcome);
    if (options.signal?.aborted) throw new TtsBrowserStreamError('cancelled');
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

export async function readTtsAudioResponse(
  response: Response,
  options: ReadTtsAudioResponseOptions,
): Promise<Blob> {
  const stallTimeoutMs = positiveLimit(
    options.stallTimeoutMs,
    TTS_BROWSER_STALL_TIMEOUT_MS,
  );
  const hardTimeoutMs = positiveLimit(
    options.hardTimeoutMs,
    TTS_BROWSER_HARD_TIMEOUT_MS,
  );
  const maxAudioBytes = positiveLimit(
    options.maxAudioBytes,
    TTS_BROWSER_MAX_AUDIO_BYTES,
  );
  const requestStartedAt = options.requestStartedAt;
  const ttfbMs = Math.max(0, options.responseReceivedAt - requestStartedAt);
  const chunks: ArrayBuffer[] = [];
  let audioBytes = 0;
  let outcome: TtsBrowserStreamOutcome = 'error';
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    if (!response.body) throw new TtsBrowserStreamError('invalid-response');
    reader = response.body.getReader();
    while (true) {
      const hardRemaining = hardTimeoutMs - (Date.now() - requestStartedAt);
      if (hardRemaining <= 0) throw new TtsBrowserStreamError('hard-timeout');
      const timeoutOutcome = hardRemaining <= stallTimeoutMs
        ? 'hard-timeout'
        : 'stalled';
      const result = await readWithDeadline(
        reader,
        Math.min(stallTimeoutMs, hardRemaining),
        timeoutOutcome,
        options.signal,
      );
      if (result.done) break;
      audioBytes += result.value.byteLength;
      if (audioBytes > maxAudioBytes) throw new TtsBrowserStreamError('too-large');
      const chunk = new Uint8Array(result.value.byteLength);
      chunk.set(result.value);
      chunks.push(chunk.buffer);
    }
    outcome = 'completed';
    return new Blob(chunks, {
      type: response.headers.get('content-type') || 'audio/mpeg',
    });
  } catch (error) {
    outcome = error instanceof TtsBrowserStreamError
      ? error.outcome
      : options.signal?.aborted
        ? 'cancelled'
        : 'error';
    if (reader) {
      void reader.cancel(error).catch(() => undefined);
    }
    throw error;
  } finally {
    options.onTelemetry?.({
      provider: options.provider,
      outcome,
      ttfbMs: Math.round(ttfbMs),
      totalMs: Math.max(0, Math.round(Date.now() - requestStartedAt)),
      audioBytes,
    });
  }
}
