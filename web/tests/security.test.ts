import { describe, expect, test } from 'vitest';
import { hashSessionToken } from '@/lib/actions/auth-actions';
import { decryptLocalSecret, encryptLocalSecret } from '@/lib/secrets/secret-store';
import { getXapiConfig } from '@/lib/integrations/xapi';
import { createStudent, updateAppSetting, updateStudent } from '@/lib/actions/admin-actions';
import { register } from '@/lib/actions/auth-actions';
import { MIN_PASSWORD_LENGTH, verifyPassword } from '@/lib/utils/password';
import { isSecretLikeSettingKey } from '@/lib/secrets/sensitive-setting';

describe('credential boundaries', () => {
  test('session tokens are persisted as deterministic one-way hashes', () => {
    const token = 'raw-session-token-never-store-this';
    const stored = hashSessionToken(token);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toContain(token);
    expect(hashSessionToken(token)).toBe(stored);
  });

  test('local secrets use randomized authenticated encryption', () => {
    const value = 'provider-secret-value';
    const first = encryptLocalSecret(value);
    const second = encryptLocalSecret(value);
    expect(first).not.toBe(second);
    expect(first).not.toContain(value);
    expect(decryptLocalSecret(first)).toBe(value);
  });

  test('reserved SAIF source names fail configuration', () => {
    process.env.XAPI_SOURCE_APP = 'speaking-tutor';
    expect(getXapiConfig().configured).toBe(false);
    expect(getXapiConfig().configurationError).toContain('reserved');
    process.env.XAPI_SOURCE_APP = 'speaking-lab';
  });

  test('all local account-creation and reset paths reject weak passwords', async () => {
    const weak = 'short';
    expect(weak.length).toBeLessThan(MIN_PASSWORD_LENGTH);
    await expect(register('never-created', weak, 'Never Created')).rejects.toThrow('at least 12');
    await expect(
      createStudent({
        uniqueNumber: 'never-created',
        fullName: 'Never Created',
        password: weak,
      }),
    ).rejects.toThrow('at least 12');
    await expect(updateStudent(-1, { password: weak })).rejects.toThrow('at least 12');
  });

  test('malformed legacy password hashes fail authentication without throwing', () => {
    expect(verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
    expect(verifyPassword('anything', 'c2FsdA==.dGlueQ==')).toBe(false);
  });

  test('plaintext settings reject known and future-looking secret names', () => {
    expect(isSecretLikeSettingKey('groq_api_key')).toBe(true);
    expect(isSecretLikeSettingKey('future_provider_token')).toBe(true);
    expect(isSecretLikeSettingKey('database_connection_string')).toBe(true);
    expect(isSecretLikeSettingKey('azure_endpoint')).toBe(false);
    expect(isSecretLikeSettingKey('stt_scored_pause_threshold_ms')).toBe(false);
  });

  test('the plaintext settings repository rejects secret-like keys', async () => {
    await expect(updateAppSetting('future_provider_token', 'must-not-persist')).rejects.toThrow(
      'cannot be stored',
    );
  });
});
