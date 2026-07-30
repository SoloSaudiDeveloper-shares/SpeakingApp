import { describe, expect, test } from 'vitest';
import {
  createDefaultTtsProviderPolicy,
  migrateLegacyTtsSettings,
  parseTtsProviderPolicy,
  ttsProviderChain,
} from '@/lib/speech/tts-policy';

describe('TTS provider policy', () => {
  test('the default policy is valid and local-first', () => {
    const policy = parseTtsProviderPolicy(createDefaultTtsProviderPolicy());
    expect(policy.organizationDefault).toMatchObject({
      providerId: 'windows-companion',
      modelId: 'kokoro',
      voiceId: 'af_heart',
    });
    expect(ttsProviderChain(policy).map((item) => item.providerId)).toEqual([
      'windows-companion',
      'browser-system',
    ]);
    expect(policy.allowDeviceOverrides).toBe(false);
    expect(policy.providers['browser-local'].enabled).toBe(false);
  });

  test('migrates legacy browser neural settings to companion Kokoro without losing playback defaults', () => {
    const policy = migrateLegacyTtsSettings({
      active_tts_model: 'piper',
      tts_default_voice: 'en_US-lessac-medium',
      tts_default_rate: '1.2',
      tts_default_volume: '0.75',
      tts_auto_play: 'false',
      tts_repeat_count: '3',
      tts_allow_student_choice: 'true',
    });
    expect(policy.organizationDefault).toEqual({
      providerId: 'windows-companion',
      modelId: 'kokoro',
      voiceId: 'af_heart',
    });
    expect(policy).toMatchObject({
      rate: 1.2,
      volume: 0.75,
      autoPlay: false,
      repeatCount: 3,
      allowStudentVoiceChoice: true,
    });
    expect(() => parseTtsProviderPolicy(policy)).not.toThrow();
  });

  test('migrates the legacy browser engine without duplicating its fallback', () => {
    const policy = migrateLegacyTtsSettings({
      active_tts_model: 'browser-tts',
      tts_default_voice: 'Microsoft Jenny',
    });
    expect(policy.organizationDefault.providerId).toBe('browser-system');
    expect(policy.fallbacks.some((item) => item.providerId === 'browser-system')).toBe(false);
    expect(() => parseTtsProviderPolicy(policy)).not.toThrow();
  });

  test('rejects unknown fields and duplicate provider chains', () => {
    const unknown = { ...createDefaultTtsProviderPolicy(), unsafeEndpoint: 'https://example.com' };
    expect(() => parseTtsProviderPolicy(unknown)).toThrow('unsupported field');

    const duplicate = createDefaultTtsProviderPolicy();
    duplicate.fallbacks.unshift({ providerId: 'windows-companion', modelId: 'kokoro' });
    expect(() => parseTtsProviderPolicy(duplicate)).toThrow('only once');
  });

  test('normalizes an old browser-local policy to the companion without duplicate fallbacks', () => {
    const legacy = createDefaultTtsProviderPolicy();
    legacy.providers['browser-local'] = {
      enabled: true,
      modelId: 'piper',
      voiceId: 'en_US-lessac-medium',
      allowedVoiceIds: ['en_US-lessac-medium'],
      monthlyCharacterCap: 0,
    };
    legacy.organizationDefault = {
      providerId: 'browser-local',
      modelId: 'piper',
      voiceId: 'en_US-lessac-medium',
    };
    legacy.fallbacks.unshift({
      providerId: 'windows-companion',
      modelId: 'kokoro',
      voiceId: 'af_heart',
    });

    const parsed = parseTtsProviderPolicy(legacy);
    expect(parsed.organizationDefault).toEqual({
      providerId: 'windows-companion',
      modelId: 'kokoro',
      voiceId: 'af_heart',
    });
    expect(parsed.providers['browser-local']).toMatchObject({
      enabled: false,
      modelId: '',
      voiceId: '',
    });
    expect(parsed.providers['windows-companion'].enabled).toBe(true);
    expect(parsed.fallbacks.some((item) => item.providerId === 'browser-local')).toBe(false);
    expect(parsed.fallbacks.some((item) => item.providerId === 'windows-companion')).toBe(false);
  });

  test('rejects an unsupported OpenAI voice', () => {
    const policy = createDefaultTtsProviderPolicy();
    policy.providers['openai-tts'].voiceId = 'untrusted-voice';
    policy.providers['openai-tts'].allowedVoiceIds = ['untrusted-voice'];
    expect(() => parseTtsProviderPolicy(policy)).toThrow('not supported');
  });

  test('uses an approved device override only when organization policy allows it', () => {
    const policy = createDefaultTtsProviderPolicy();
    policy.allowDeviceOverrides = true;
    policy.providers['custom-local'].enabled = true;
    policy.providers['custom-local'].modelId = 'kokoro';
    const parsed = parseTtsProviderPolicy(policy);
    expect(ttsProviderChain(parsed, {
      selection: { providerId: 'custom-local', modelId: 'kokoro' },
    })[0].providerId).toBe('custom-local');

    expect(ttsProviderChain(parsed, {
      selection: { providerId: 'custom-local', modelId: 'unapproved-model' },
    })[0].providerId).toBe('windows-companion');
  });
});
