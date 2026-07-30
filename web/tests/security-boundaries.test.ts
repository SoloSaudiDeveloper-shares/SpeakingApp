import { describe, expect, test } from 'vitest';
import { mutationRequestViolation } from '@/lib/security/request-protection';
import {
  settingWriteDecision,
  validateSettingValue,
} from '@/lib/security/settings-policy';
import {
  detectAudioContentType,
  parseSingleByteRange,
  safeStoredAudioContentType,
} from '@/lib/storage/audio-validation';

function metadata(
  method: string,
  headers: Record<string, string> = {},
  url = 'https://speaking.example/api/settings',
) {
  return {
    method,
    headers: new Headers(headers),
    url,
  };
}

describe('browser mutation boundary', () => {
  test('allows reads and same-origin mutations', () => {
    expect(mutationRequestViolation(metadata('GET', {
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    }))).toBeNull();
    expect(mutationRequestViolation(metadata('POST', {
      origin: 'https://speaking.example',
      'sec-fetch-site': 'same-origin',
    }))).toBeNull();
  });

  test('rejects cross-site Fetch Metadata and mismatched origins', () => {
    expect(mutationRequestViolation(metadata('POST', {
      'sec-fetch-site': 'cross-site',
    }))).toContain('Cross-site');
    expect(mutationRequestViolation(metadata('PUT', {
      origin: 'https://evil.example',
      'sec-fetch-site': 'same-site',
    }))).toContain('origin');
    expect(mutationRequestViolation(metadata('PATCH', {
      'sec-fetch-site': 'same-site',
    }))).toContain('Origin');
  });

  test('allows non-browser service requests without ambient browser metadata', () => {
    expect(mutationRequestViolation(metadata('POST'))).toBeNull();
  });
});

describe('legacy settings write policy', () => {
  test('keeps provider, voice, and default settings administrator-only', () => {
    expect(settingWriteDecision('Admin', 'active_tts_model')).toEqual({ allowed: true });
    expect(settingWriteDecision('Teacher', 'active_tts_model')).toMatchObject({
      allowed: false,
      status: 403,
    });
    expect(settingWriteDecision('Teacher', 'tts_default_voice')).toMatchObject({
      allowed: false,
      status: 403,
    });
  });

  test('allows only the explicit teacher pedagogical set and denies unknown keys', () => {
    expect(settingWriteDecision('Teacher', 'custom_practice_sets')).toEqual({ allowed: true });
    expect(settingWriteDecision('Teacher', 'pass_threshold')).toEqual({ allowed: true });
    expect(settingWriteDecision('Admin', 'future_unreviewed_setting')).toMatchObject({
      allowed: false,
      status: 400,
    });
  });

  test('validates structured and bounded values', () => {
    expect(validateSettingValue('custom_practice_sets', '{}')).toContain('JSON array');
    expect(validateSettingValue('custom_practice_sets', '[]')).toBeNull();
    expect(validateSettingValue('tts_default_voice', 'x'.repeat(5_000))).toContain('too large');
  });
});

describe('audio validation and range handling', () => {
  test('detects formats by file signature rather than a claimed MIME type', () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
    ]);
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    expect(detectAudioContentType(wav)).toBe('audio/wav');
    expect(detectAudioContentType(webm)).toBe('audio/webm');
    expect(detectAudioContentType(new TextEncoder().encode('<script>'))).toBeNull();
  });

  test('serves only allowlisted stored media types', () => {
    expect(safeStoredAudioContentType('audio/webm; codecs=opus')).toBe('audio/webm');
    expect(safeStoredAudioContentType('text/html')).toBe('application/octet-stream');
  });

  test('parses standard, open-ended, and suffix ranges and rejects invalid ranges', () => {
    expect(parseSingleByteRange(null, 100)).toEqual({ kind: 'none' });
    expect(parseSingleByteRange('bytes=10-19', 100)).toEqual({
      kind: 'valid',
      start: 10,
      end: 19,
    });
    expect(parseSingleByteRange('bytes=90-', 100)).toEqual({
      kind: 'valid',
      start: 90,
      end: 99,
    });
    expect(parseSingleByteRange('bytes=-10', 100)).toEqual({
      kind: 'valid',
      start: 90,
      end: 99,
    });
    expect(parseSingleByteRange('bytes=100-101', 100)).toEqual({ kind: 'invalid' });
    expect(parseSingleByteRange('bytes=0-1,5-6', 100)).toEqual({ kind: 'invalid' });
  });
});
