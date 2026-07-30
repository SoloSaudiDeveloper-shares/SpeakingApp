import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type FakeSource = {
  buffer: unknown;
  playbackRate: { value: number };
  onended: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
};

const sources: FakeSource[] = [];

beforeEach(() => {
  sources.length = 0;
  vi.resetModules();
  class FakeAudioContext {
    state = 'running';
    destination = {};
    resume = vi.fn(async () => undefined);
    createBuffer = vi.fn((_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }));
    createGain = vi.fn(() => {
      const gain = {
        gain: { value: 1 },
        connect: vi.fn(() => gain),
      };
      return gain;
    });
    createBufferSource = vi.fn(() => {
      const source: FakeSource = {
        buffer: null,
        playbackRate: { value: 1 },
        onended: null,
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn((node) => node),
      };
      sources.push(source);
      return source;
    });
    decodeAudioData = vi.fn();
  }
  vi.stubGlobal('window', { AudioContext: FakeAudioContext });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('neural TTS audio playback ownership', () => {
  test('stopPlayback rejects rather than leaving the old promise pending', async () => {
    const { playPcm, stopPlayback } = await import(
      '@/lib/speech/tts-engines/audio-player'
    );
    const speaking = playPcm(new Float32Array(100), 24_000);
    await vi.waitFor(() => expect(sources).toHaveLength(1));
    const rejection = expect(speaking).rejects.toMatchObject({ name: 'AbortError' });

    stopPlayback();

    await rejection;
    expect(sources[0]!.stop).toHaveBeenCalledOnce();
  });

  test('new playback cancels the previous generation and becomes the sole owner', async () => {
    const { playPcm } = await import('@/lib/speech/tts-engines/audio-player');
    const first = playPcm(new Float32Array(100), 24_000);
    await vi.waitFor(() => expect(sources).toHaveLength(1));
    const firstRejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });

    const second = playPcm(new Float32Array(100), 24_000);
    await firstRejection;
    await vi.waitFor(() => expect(sources).toHaveLength(2));
    sources[1]!.onended?.();

    await expect(second).resolves.toBeUndefined();
    expect(sources[0]!.stop).toHaveBeenCalledOnce();
    expect(sources[1]!.stop).not.toHaveBeenCalled();
  });
});
