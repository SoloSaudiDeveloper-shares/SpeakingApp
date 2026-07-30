import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  fetchTtsAudioResponseWithDeadline,
  readTtsAudioResponse,
  TtsBrowserStreamError,
  type TtsBrowserStreamTelemetry,
} from '@/lib/speech/tts-audio-stream-client';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('browser TTS audio stream reader', () => {
  test('aborts a fetch that never returns response headers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T12:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    ));
    const telemetry = vi.fn<(value: TtsBrowserStreamTelemetry) => void>();
    const startedAt = Date.now();
    const result = fetchTtsAudioResponseWithDeadline('/api/tts/speech', {
      method: 'POST',
    }, {
      provider: 'openai-tts',
      requestStartedAt: startedAt,
      headerTimeoutMs: 12_000,
      hardTimeoutMs: 60_000,
      onTelemetry: telemetry,
    });
    const rejection = expect(result).rejects.toMatchObject({
      outcome: 'stalled',
    } satisfies Partial<TtsBrowserStreamError>);

    await vi.advanceTimersByTimeAsync(12_001);
    await rejection;
    expect(telemetry).toHaveBeenCalledWith({
      provider: 'openai-tts',
      outcome: 'stalled',
      ttfbMs: 12_000,
      totalMs: 12_000,
      audioBytes: 0,
    });
  });

  test('reads chunks and reports only bounded timing and byte telemetry', async () => {
    const telemetry = vi.fn<(value: TtsBrowserStreamTelemetry) => void>();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    }), {
      headers: { 'Content-Type': 'audio/mpeg' },
    });
    const now = Date.now();

    const blob = await readTtsAudioResponse(response, {
      provider: 'openai-tts',
      requestStartedAt: now - 25,
      responseReceivedAt: now - 5,
      onTelemetry: telemetry,
    });

    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(telemetry).toHaveBeenCalledOnce();
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai-tts',
      outcome: 'completed',
      ttfbMs: 20,
      audioBytes: 3,
    }));
    expect(Object.keys(telemetry.mock.calls[0]![0]).sort()).toEqual([
      'audioBytes',
      'outcome',
      'provider',
      'totalMs',
      'ttfbMs',
    ]);
  });

  test('fails loudly after a rearmed no-progress deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T12:00:00Z'));
    const telemetry = vi.fn<(value: TtsBrowserStreamTelemetry) => void>();
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
    }), {
      headers: { 'Content-Type': 'audio/mpeg' },
    });
    const startedAt = Date.now();
    const result = readTtsAudioResponse(response, {
      provider: 'azure-speech',
      requestStartedAt: startedAt,
      responseReceivedAt: startedAt,
      stallTimeoutMs: 12_000,
      hardTimeoutMs: 60_000,
      onTelemetry: telemetry,
    });
    const rejection = expect(result).rejects.toMatchObject({
      outcome: 'stalled',
    } satisfies Partial<TtsBrowserStreamError>);

    await vi.advanceTimersByTimeAsync(12_001);
    await rejection;
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'stalled',
      totalMs: 12_000,
      audioBytes: 0,
    }));
  });

  test('restarts the no-progress deadline after every received chunk', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T12:00:00Z'));
    const telemetry = vi.fn<(value: TtsBrowserStreamTelemetry) => void>();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    }), {
      headers: { 'Content-Type': 'audio/mpeg' },
    });
    const startedAt = Date.now();
    const result = readTtsAudioResponse(response, {
      provider: 'openai-tts',
      requestStartedAt: startedAt,
      responseReceivedAt: startedAt,
      stallTimeoutMs: 12_000,
      hardTimeoutMs: 60_000,
      onTelemetry: telemetry,
    });
    const rejection = expect(result).rejects.toMatchObject({
      outcome: 'stalled',
    } satisfies Partial<TtsBrowserStreamError>);

    await vi.advanceTimersByTimeAsync(8_000);
    if (!streamController) throw new Error('Stream controller was not initialized.');
    (streamController as ReadableStreamDefaultController<Uint8Array>)
      .enqueue(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(11_999);
    expect(telemetry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'stalled',
      totalMs: 20_000,
      audioBytes: 1,
    }));
  });

  test('enforces the absolute request-to-completion cap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T12:00:00Z'));
    const telemetry = vi.fn<(value: TtsBrowserStreamTelemetry) => void>();
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
    }), {
      headers: { 'Content-Type': 'audio/mpeg' },
    });
    const startedAt = Date.now();
    const result = readTtsAudioResponse(response, {
      provider: 'windows-companion',
      requestStartedAt: startedAt,
      responseReceivedAt: startedAt,
      stallTimeoutMs: 100,
      hardTimeoutMs: 25,
      onTelemetry: telemetry,
    });
    const rejection = expect(result).rejects.toMatchObject({
      outcome: 'hard-timeout',
    } satisfies Partial<TtsBrowserStreamError>);

    await vi.advanceTimersByTimeAsync(26);
    await rejection;
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'hard-timeout',
      totalMs: 25,
    }));
  });

  test('bounds accumulated audio before constructing a Blob', async () => {
    const telemetry = vi.fn<(value: TtsBrowserStreamTelemetry) => void>();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      },
    }), {
      headers: { 'Content-Type': 'audio/mpeg' },
    });
    const now = Date.now();

    await expect(readTtsAudioResponse(response, {
      provider: 'custom-local',
      requestStartedAt: now,
      responseReceivedAt: now,
      maxAudioBytes: 3,
      onTelemetry: telemetry,
    })).rejects.toMatchObject({
      outcome: 'too-large',
    } satisfies Partial<TtsBrowserStreamError>);
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'too-large',
      audioBytes: 4,
    }));
  });
});
