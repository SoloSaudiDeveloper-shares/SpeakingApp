import { beforeEach, describe, expect, test, vi } from 'vitest';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const { queryMock, activeProviderMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  activeProviderMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  pool: { query: queryMock },
}));
vi.mock('@/lib/ai/providers', () => ({
  getActiveProvider: activeProviderMock,
}));

import {
  jsonBodyErrorResponse,
  readBoundedJson,
  RequestBodyError,
} from '@/lib/security/request-body';
import {
  PRACTICE_METRICS_MAX_BYTES,
  PRACTICE_TRANSCRIPT_MAX_CHARS,
  parseBoundedPracticePayload,
} from '@/lib/security/practice-payload';
import {
  assertPasswordPolicy,
  hashPassword,
  passwordHashNeedsUpgrade,
  passwordPolicyViolation,
  verifyPassword,
} from '@/lib/utils/password';
import {
  consumeSharedRateLimit,
  normalizedAccountSubject,
  requestRateLimitSubjects,
  SharedRateLimitError,
} from '@/lib/security/rate-limit-server';
import {
  DAILY_AUDIO_UPLOAD_BYTE_LIMIT,
  DAILY_ORGANIZATION_CLOUD_AI_REQUEST_LIMIT,
  consumeAudioUploadBudget,
  consumeCloudAiBudgetIfNeeded,
  consumeOrganizationResourceBudget,
  consumeUserResourceBudget,
  ResourceBudgetExceededError,
} from '@/lib/security/resource-budget-server';
import { POST as legacyAudioPost } from '@/app/api/audio/route';
import { practiceAttemptReplayPayload } from '@/lib/security/practice-attempt-replay';

beforeEach(() => {
  queryMock.mockReset();
  activeProviderMock.mockReset();
});

describe('bounded JSON requests', () => {
  test('accepts a small JSON body and rejects declared or streamed overflow', async () => {
    const valid = new Request('https://speaking.example/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    });
    await expect(readBoundedJson(valid, 128)).resolves.toEqual({ ok: true });

    const declared = new Request('https://speaking.example/api/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '1000',
      },
      body: '{}',
    });
    await expect(readBoundedJson(declared, 128)).rejects.toMatchObject({ status: 413 });

    const streamed = new Request('https://speaking.example/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(256) }),
    });
    await expect(readBoundedJson(streamed, 64)).rejects.toBeInstanceOf(RequestBodyError);
  });

  test('returns safe client errors for invalid media type', async () => {
    const request = new Request('https://speaking.example/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });
    const error = await readBoundedJson(request, 128).catch((value) => value);
    const response = jsonBodyErrorResponse(error);
    expect(response?.status).toBe(415);
    expect(await response?.json()).toEqual({ error: 'Content-Type must be application/json.' });
  });
});

describe('practice payload limits', () => {
  test('accepts bounded metrics and rejects oversized transcripts', () => {
    expect(parseBoundedPracticePayload({
      rawTranscript: 'A short answer.',
      metricsJson: JSON.stringify({ practiceStage: 'repeat', wordCount: 3 }),
    })).toMatchObject({ ok: true, transcript: 'A short answer.' });
    expect(parseBoundedPracticePayload({
      rawTranscript: 'x'.repeat(PRACTICE_TRANSCRIPT_MAX_CHARS + 1),
      metricsJson: '{}',
    })).toEqual({ ok: false, error: 'Transcript is too large.' });
  });

  test('rejects malformed, oversized, and overly complex metrics', () => {
    expect(parseBoundedPracticePayload({
      rawTranscript: '',
      metricsJson: '{bad json',
    })).toEqual({ ok: false, error: 'Practice metrics must be valid JSON.' });
    expect(parseBoundedPracticePayload({
      rawTranscript: '',
      metricsJson: `{"value":"${'x'.repeat(PRACTICE_METRICS_MAX_BYTES)}"}`,
    })).toEqual({ ok: false, error: 'Practice metrics are too large.' });
    expect(parseBoundedPracticePayload({
      rawTranscript: '',
      metricsJson: JSON.stringify({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }),
    })).toEqual({ ok: false, error: 'Practice metrics are too complex.' });
  });
});

describe('idempotent practice replay', () => {
  test('reconstructs stored scores without requiring another budget reservation or AI call', () => {
    const payload = practiceAttemptReplayPayload({
      id: 42,
      studentId: 7,
      clientSubmissionId: 'submission_123',
      cycleId: 3,
      bookId: 2,
      practiceTaskId: 9,
      timestamp: '2026-07-30T12:00:00.000Z',
      audioPath: null,
      rawTranscript: 'hello',
      rescoredTranscript: null,
      targetMatchScore: 0.9,
      pronunciationScore: 0.8,
      fluencyScore: 0.7,
      completenessScore: 1,
      consistencyScore: 0.6,
      compositeScore: 0.82,
      teacherOverrideScore: null,
      teacherNotes: null,
      metricsJson: '{}',
    });
    expect(payload).toMatchObject({
      attempt: { id: 42, idempotentReplay: true },
      score: { targetMatch: 0.9, composite: 0.82 },
      klpResults: [],
      idempotentReplay: true,
    });
    expect(queryMock).not.toHaveBeenCalled();
    expect(activeProviderMock).not.toHaveBeenCalled();
  });
});

describe('password compromise controls', () => {
  test('rejects common, repeated, identity-derived, and excessively long passwords', () => {
    expect(passwordPolicyViolation('Password123!')).toContain('commonly used');
    expect(passwordPolicyViolation('aaaaaaaaaaaa')).toContain('commonly used');
    expect(passwordPolicyViolation('student-safe-phrase', { username: 'student' })).toContain('username');
    expect(() => assertPasswordPolicy('x'.repeat(257))).toThrow('at most 256');
    expect(passwordPolicyViolation('Truly-Random-47!Phrase')).toBeNull();
  });

  test('writes a versioned 220k hash and verifies legacy hashes for transparent upgrades', () => {
    const password = 'Truly-Random-47!Phrase';
    const current = hashPassword(password);
    expect(current).toMatch(/^pbkdf2-sha512\$220000\$/);
    expect(verifyPassword(password, current)).toBe(true);
    expect(passwordHashNeedsUpgrade(current)).toBe(false);

    const legacySalt = randomBytes(16);
    const legacyHash = pbkdf2Sync(password, legacySalt, 100_000, 64, 'sha512');
    const legacy = `${legacySalt.toString('base64')}.${legacyHash.toString('base64')}`;
    expect(verifyPassword(password, legacy)).toBe(true);
    expect(verifyPassword('wrong-password', legacy)).toBe(false);
    expect(passwordHashNeedsUpgrade(legacy)).toBe(true);

    const dummyTimingHash =
      'pbkdf2-sha512$220000$c3BlYWtpbmdsYWJkdW1teQ==$5nKUk5T1X6faz922ZIqPvh8mJOvyy2smK+oFpvWSOl0PleJKD0dHnEmjGdfWjuA+0DOLyk/r0rJ1oSLpyj0tcA==';
    expect(verifyPassword('dummy-password-never-valid', dummyTimingHash)).toBe(true);
  });
});

describe('database-backed shared counters', () => {
  test('hashes account and request subjects before persistence', () => {
    const account = normalizedAccountSubject(' Example.User ');
    expect(account).toMatch(/^[a-f0-9]{64}$/);
    expect(account).toBe(normalizedAccountSubject('example.user'));
    const subjects = requestRateLimitSubjects({
      headers: new Headers({
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
        origin: 'https://speaking.example',
      }),
    });
    expect(subjects.ip).toMatch(/^[a-f0-9]{64}$/);
    expect(subjects.origin).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(subjects)).not.toContain('203.0.113.10');
  });

  test('uses an atomic conditional UPSERT for replica-shared rate limits', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(consumeSharedRateLimit({
      scope: 'login-account',
      subjectHash: 'a'.repeat(64),
      limit: 10,
      windowSeconds: 900,
      now: new Date('2026-07-30T12:07:00Z'),
    })).rejects.toBeInstanceOf(SharedRateLimitError);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql.replace(/\s+/g, ' ')).toContain(
      'ON CONFLICT (scope, subject_hash, window_started_at) DO UPDATE',
    );
    expect(sql).toContain('security_rate_limit_windows.request_count < $4');
    expect(params).toEqual([
      'login-account',
      'a'.repeat(64),
      '2026-07-30T12:00:00.000Z',
      10,
    ]);
  });

  test('caps both first and concurrent user-resource reservations', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(consumeUserResourceBudget({
      userId: 7,
      resource: 'cloud-ai',
      limit: 100,
      units: 101,
      now: new Date('2026-07-30T12:00:00Z'),
    })).rejects.toBeInstanceOf(ResourceBudgetExceededError);
    const [sql] = queryMock.mock.calls[0] as [string];
    const compact = sql.replace(/\s+/g, ' ');
    expect(compact).toContain('WHERE $4::integer <= $6::integer');
    expect(compact).toContain('user_resource_usage.units + EXCLUDED.units <= $6');
  });

  test('does not spend the cloud budget for local Ollama', async () => {
    activeProviderMock.mockResolvedValueOnce({ provider: 'ollama' });
    await expect(consumeCloudAiBudgetIfNeeded(7)).resolves.toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test('reserves audio bytes against a shared per-user daily cap', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(consumeAudioUploadBudget(
      7,
      DAILY_AUDIO_UPLOAD_BYTE_LIMIT + 1,
      new Date('2026-07-30T12:00:00Z'),
    )).rejects.toMatchObject({
      resource: 'audio-upload-bytes',
    });
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('user_resource_usage.units + EXCLUDED.units <= $6');
    expect(params[1]).toBe('audio-upload-bytes');
    expect(params[3]).toBe(DAILY_AUDIO_UPLOAD_BYTE_LIMIT + 1);
  });

  test('atomically enforces the organization-wide daily cloud-AI cap', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(consumeOrganizationResourceBudget({
      resource: 'cloud-ai-organization',
      limit: DAILY_ORGANIZATION_CLOUD_AI_REQUEST_LIMIT,
      now: new Date('2026-07-30T12:00:00Z'),
    })).rejects.toMatchObject({
      resource: 'cloud-ai-organization',
    });
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    const compact = sql.replace(/\s+/g, ' ');
    expect(compact).toContain(
      'ON CONFLICT (resource, period_day) DO UPDATE',
    );
    expect(compact).toContain(
      'organization_resource_usage.units + EXCLUDED.units <= $5',
    );
    expect(params).toEqual([
      'cloud-ai-organization',
      '2026-07-30',
      1,
      '2026-07-30T12:00:00.000Z',
      DAILY_ORGANIZATION_CLOUD_AI_REQUEST_LIMIT,
    ]);
  });

  test('rolls back a user AI reservation when the organization cap is full', async () => {
    activeProviderMock.mockResolvedValueOnce({ provider: 'openai' });
    queryMock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ units: 1 }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await expect(consumeCloudAiBudgetIfNeeded(7)).rejects.toMatchObject({
      resource: 'cloud-ai-organization',
    });
    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(String(queryMock.mock.calls[2]?.[0])).toContain(
      'UPDATE user_resource_usage',
    );
  });
});

describe('legacy audio uploads', () => {
  test('cannot create unattached blobs', async () => {
    const response = await legacyAudioPost();
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'Legacy audio upload is no longer available.',
    });
  });
});
