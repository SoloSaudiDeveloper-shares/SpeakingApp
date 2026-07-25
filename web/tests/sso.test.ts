import { describe, expect, test } from 'vitest';
import {
  createSignedLaunchToken,
  verifySignedLaunchToken,
  type ExternalLaunchPayload,
} from '@/lib/integrations/external-auth';

describe('signed SAIF launches', () => {
  test('accepts the signed pseudonymous subject and rejects tampering', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: ExternalLaunchPayload = {
      iss: 'https://saif.example/issuer',
      aud: 'speaking-lab',
      sub: 'cadet-9f2a',
      role: 'Student',
      displayName: 'Pseudonymous learner',
      iat: now,
      exp: now + 90,
      jti: 'fixture-jti',
    };
    const secret = 'fixture-signing-secret-long-enough';
    const config = {
      enabled: true,
      providerId: 'main-portal',
      issuer: payload.iss,
      audience: String(payload.aud),
      sharedSecret: secret,
      allowAdmin: false,
    };
    const token = createSignedLaunchToken(payload, secret);
    expect(verifySignedLaunchToken(token, config, now).sub).toBe('cadet-9f2a');
    expect(() => verifySignedLaunchToken(`${token.slice(0, -1)}x`, config, now)).toThrow();
  });
});
