import { NextRequest } from 'next/server';
import { describe, expect, test } from 'vitest';
import { GET as launchRoute } from '@/app/sso/launch/route';
import {
  createSignedLaunchToken,
  isSafeRedirectPath,
  verifySignedLaunchToken,
  type ExternalLaunchPayload,
  type ExternalSsoConfig,
} from '@/lib/integrations/external-auth';

describe('signed SAIF launches', () => {
  const now = 1_800_000_000;
  const secret = 'fixture-signing-secret-long-enough';
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
  const config: ExternalSsoConfig = {
    enabled: true,
    providerId: 'main-portal',
    issuer: payload.iss,
    audience: String(payload.aud),
    sharedSecret: secret,
    allowAdmin: false,
  };

  test('accepts the signed pseudonymous subject and rejects tampering', () => {
    const token = createSignedLaunchToken(payload, secret);
    expect(verifySignedLaunchToken(token, config, now).sub).toBe('cadet-9f2a');
    expect(() => verifySignedLaunchToken(`${token.slice(0, -1)}x`, config, now)).toThrow();
  });

  test('rejects expired, future, wrong-issuer, wrong-audience, and Admin launches', () => {
    const sign = (overrides: Partial<ExternalLaunchPayload>) =>
      createSignedLaunchToken({ ...payload, ...overrides }, secret);

    expect(() => verifySignedLaunchToken(sign({ exp: now }), config, now)).toThrow('expired');
    expect(() => verifySignedLaunchToken(sign({ iat: now + 31 }), config, now)).toThrow('future');
    expect(() => verifySignedLaunchToken(sign({ iss: 'https://wrong.example' }), config, now)).toThrow('issuer');
    expect(() => verifySignedLaunchToken(sign({ aud: 'wrong-app' }), config, now)).toThrow('audience');
    expect(() => verifySignedLaunchToken(sign({ role: 'Admin' }), config, now)).toThrow('admin');
  });

  test('rejects excessive, non-increasing, fractional, and weakly configured launches', () => {
    const sign = (overrides: Partial<ExternalLaunchPayload>) =>
      createSignedLaunchToken({ ...payload, ...overrides }, secret);

    expect(() => verifySignedLaunchToken(sign({ exp: now + 121 }), config, now))
      .toThrow('lifetime is too long');
    expect(() => verifySignedLaunchToken(sign({ iat: now + 20, exp: now + 10 }), config, now))
      .toThrow('invalid lifetime');
    expect(() => verifySignedLaunchToken(sign({ iat: now + 0.5 }), config, now))
      .toThrow('invalid timestamps');
    expect(() => verifySignedLaunchToken(sign({}), {
      ...config,
      sharedSecret: 'too-short',
    }, now)).toThrow('not fully configured');
  });

  test('permits only local non-API redirect paths', () => {
    expect(isSafeRedirectPath('/dashboard')).toBe(true);
    expect(isSafeRedirectPath('/practice/scenario')).toBe(true);
    expect(isSafeRedirectPath('//attacker.example')).toBe(false);
    expect(isSafeRedirectPath('https://attacker.example')).toBe(false);
    expect(isSafeRedirectPath('/api/admin')).toBe(false);
  });

  test('sets no-store and privacy headers even when the token is missing', async () => {
    const response = await launchRoute(new NextRequest('https://speaking.example/sso/launch'));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});
