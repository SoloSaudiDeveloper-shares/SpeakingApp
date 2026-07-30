import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDefaultTtsProviderPolicy } from '@/lib/speech/tts-policy';
import { synthesizeCloudSpeech, TtsProviderError } from '@/lib/speech/tts-cloud-server';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloud TTS adapters', () => {
  test('uses the fixed OpenAI speech endpoint and streams MP3 audio', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const definition = createDefaultTtsProviderPolicy().providers['openai-tts'];
    const outcome = vi.fn();
    const requestAbort = new AbortController();
    const removeListener = vi.spyOn(requestAbort.signal, 'removeEventListener');
    const response = await synthesizeCloudSpeech({
      provider: 'openai-tts',
      input: 'Hello',
      voice: 'alloy',
      rate: 1.1,
      definition,
      apiKey: 'test-key',
      signal: requestAbort.signal,
      onStreamOutcome: outcome,
    });
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
    await Promise.resolve();
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'completed',
      audioBytes: 3,
    }));
    expect(removeListener).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init).toBeDefined();
    const requestInit = init!;
    const headers = requestInit.headers as Record<string, string>;
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(requestInit.redirect).toBe('error');
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(String(requestInit.body))).toEqual({
      model: 'gpt-4o-mini-tts',
      input: 'Hello',
      voice: 'alloy',
      response_format: 'mp3',
      speed: 1.1,
    });
  });

  test('escapes learner text in Azure SSML and keeps the key in a header', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(new Uint8Array([4]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const definition = createDefaultTtsProviderPolicy().providers['azure-speech'];
    const response = await synthesizeCloudSpeech({
      provider: 'azure-speech',
      input: '<break /> & "hello"',
      voice: 'en-US-JennyNeural',
      rate: 0.9,
      definition,
      apiKey: 'azure-test-key',
      azureRegion: 'eastus',
    });
    await response.arrayBuffer();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init).toBeDefined();
    const requestInit = init!;
    const headers = requestInit.headers as Record<string, string>;
    expect(url).toBe('https://eastus.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('azure-test-key');
    expect(String(requestInit.body)).toContain('&lt;break /&gt; &amp; &quot;hello&quot;');
    expect(String(requestInit.body)).not.toContain('<break />');
  });

  test('returns a sanitized provider error without reading the upstream body', async () => {
    const text = vi.fn(async () => 'secret provider diagnostic');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: null,
      text,
    })));
    const definition = createDefaultTtsProviderPolicy().providers['openai-tts'];
    await expect(synthesizeCloudSpeech({
      provider: 'openai-tts',
      input: 'Hello',
      voice: 'alloy',
      rate: 1,
      definition,
      apiKey: 'bad-key',
    })).rejects.toMatchObject({
      provider: 'openai-tts',
      reason: 'upstream-rejected',
      upstreamStatus: 401,
    } satisfies Partial<TtsProviderError>);
    expect(text).not.toHaveBeenCalled();
  });

  test('fails loudly and records a stalled stream after 12 seconds without progress', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn(async () =>
        new Response(new ReadableStream<Uint8Array>({
          pull() {
            return new Promise<void>(() => undefined);
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        })));
      const outcome = vi.fn();
      const definition = createDefaultTtsProviderPolicy().providers['openai-tts'];
      const response = await synthesizeCloudSpeech({
        provider: 'openai-tts',
        input: 'Hello',
        voice: 'alloy',
        rate: 1,
        definition,
        apiKey: 'test-key',
        onStreamOutcome: outcome,
      });
      const audio = expect(response.arrayBuffer()).rejects.toThrow('no progress');
      await vi.advanceTimersByTimeAsync(12_001);
      await audio;
      expect(outcome).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'stalled',
        audioBytes: 0,
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});
