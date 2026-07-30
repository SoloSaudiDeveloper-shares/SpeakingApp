import { afterEach, describe, expect, test, vi } from 'vitest';
import { BrowserTtsEngine } from '@/lib/speech/tts-engines/browser-tts-engine';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser/system TTS failures', () => {
  test('rejects instead of reporting success when speech synthesis is unavailable', async () => {
    vi.stubGlobal('window', {});
    await expect(
      new BrowserTtsEngine().speak('Hello'),
    ).rejects.toThrow('unavailable');
  });

  test('rejects the utterance when the browser reports an error', async () => {
    class Utterance {
      lang = '';
      rate = 1;
      volume = 1;
      voice: SpeechSynthesisVoice | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;

      constructor(public readonly text: string) {}
    }
    const speechSynthesis = {
      cancel: vi.fn(),
      getVoices: vi.fn(() => []),
      speak: vi.fn((utterance: Utterance) => {
        utterance.onerror?.({ error: 'network' });
      }),
    };
    vi.stubGlobal('window', { speechSynthesis });
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);

    await expect(
      new BrowserTtsEngine().speak('Hello'),
    ).rejects.toThrow('network');
  });

  test('settles as cancelled when its abort signal fires', async () => {
    class Utterance {
      lang = '';
      rate = 1;
      volume = 1;
      voice: SpeechSynthesisVoice | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
    }
    const speechSynthesis = {
      cancel: vi.fn(),
      getVoices: vi.fn(() => []),
      speak: vi.fn(),
    };
    vi.stubGlobal('window', { speechSynthesis });
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    const abort = new AbortController();
    const speaking = new BrowserTtsEngine().speak('Hello', { signal: abort.signal });
    const rejection = expect(speaking).rejects.toMatchObject({ name: 'AbortError' });

    abort.abort(new DOMException('cancelled', 'AbortError'));

    await rejection;
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(2);
  });
});
