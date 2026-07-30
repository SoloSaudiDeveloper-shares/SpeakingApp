import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import nextConfig from '../next.config';

const { getTtsEngineMock, speakMock } = vi.hoisted(() => ({
  getTtsEngineMock: vi.fn(),
  speakMock: vi.fn(),
}));

vi.mock('@/lib/speech/tts-factory', () => ({
  getTtsEngine: getTtsEngineMock,
}));

import {
  createDefaultTtsProviderPolicy,
  ttsProviderChain,
} from '@/lib/speech/tts-policy';
import {
  probeLocalTtsEndpoint,
  invalidateTtsProviderConfigCache,
  resolveLocalTtsConnection,
  speakWithTtsProviderFallback,
  validateCustomLocalTtsOrigin,
  validateWindowsCompanionOrigin,
} from '@/lib/speech/tts-provider-client';

function storageStub(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

beforeEach(() => {
  getTtsEngineMock.mockReset();
  getTtsEngineMock.mockReturnValue({
    speak: speakMock,
  });
  speakMock.mockReset();
  vi.stubGlobal('localStorage', storageStub());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TTS browser/local boundaries', () => {
  test('custom-local accepts only user-facing loopback ports', () => {
    expect(validateCustomLocalTtsOrigin('http://127.0.0.1:8000')).toBe(
      'http://127.0.0.1:8000',
    );
    expect(validateCustomLocalTtsOrigin('https://localhost:8880')).toBe(
      'https://localhost:8880',
    );
    expect(() => validateCustomLocalTtsOrigin('http://127.0.0.1:17841')).toThrow();
    expect(() => validateCustomLocalTtsOrigin('http://127.0.0.1:17842')).toThrow();
    expect(() => validateCustomLocalTtsOrigin('http://192.168.1.5:8000')).toThrow();
  });

  test('companion uses only its fixed origin and requires a pairing token to probe', async () => {
    expect(validateWindowsCompanionOrigin('http://127.0.0.1:17841')).toBe(
      'http://127.0.0.1:17841',
    );
    expect(() => validateWindowsCompanionOrigin('http://localhost:17841')).toThrow();
    await expect(
      probeLocalTtsEndpoint('http://127.0.0.1:17841'),
    ).rejects.toThrow('Pair this browser');
  });

  test('default policy executes through paired companion credentials without provider overrides', () => {
    const policy = createDefaultTtsProviderPolicy();
    expect(policy.allowDeviceOverrides).toBe(false);

    const device = {
      selection: { providerId: 'custom-local' as const },
      companionEndpoint: 'http://127.0.0.1:17841',
      companionToken: 'paired-token',
      customLocalEndpoint: 'http://127.0.0.1:8000',
    };
    const [selected] = ttsProviderChain(policy, device);
    expect(selected.providerId).toBe('windows-companion');
    expect(resolveLocalTtsConnection(selected, device)).toEqual({
      origin: 'http://127.0.0.1:17841',
      token: 'paired-token',
      responseFormat: 'wav',
    });
  });

  test('CSP exposes the paired companion and user ports but not worker port 17842', async () => {
    if (typeof nextConfig.headers !== 'function') throw new Error('Next headers are unavailable.');
    const rules = await nextConfig.headers();
    const csp = rules
      .flatMap((rule) => rule.headers)
      .find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(csp).toContain('http://127.0.0.1:17841');
    expect(csp).toContain('http://127.0.0.1:8000');
    expect(csp).toContain('http://localhost:8880');
    expect(csp).not.toContain('17842');
  });
});

describe('production provider execution', () => {
  test.each(['windows-companion', 'openai-tts'] as const)(
    '%s selection does not import or prepare bundled browser models',
    async (providerId) => {
      const policy = createDefaultTtsProviderPolicy();
      policy.organizationDefault = providerId === 'windows-companion'
        ? { providerId, modelId: 'kokoro' }
        : { providerId, modelId: 'gpt-4o-mini-tts', voiceId: 'alloy' };
      policy.fallbacks = [];
      policy.providers[providerId].enabled = true;
      if (providerId === 'openai-tts') {
        policy.providers[providerId].monthlyCharacterCap = 10_000;
      }
      vi.stubGlobal('window', {
        dispatchEvent: vi.fn(),
        speechSynthesis: { cancel: vi.fn() },
      });
      vi.stubGlobal('CustomEvent', class {
        constructor(
          public readonly type: string,
          public readonly init?: CustomEventInit,
        ) {}
      });
      invalidateTtsProviderConfigCache();
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/tts/config') {
          return Response.json({
            policy,
            source: 'policy',
            readiness: { 'azure-speech': false, 'openai-tts': true },
            effectiveUsage: [],
          });
        }
        return Response.json({ error: 'provider unavailable' }, { status: 502 });
      }));

      await expect(
        speakWithTtsProviderFallback('Hello'),
      ).rejects.toBeInstanceOf(AggregateError);
      expect(getTtsEngineMock).not.toHaveBeenCalled();
    },
  );
});
