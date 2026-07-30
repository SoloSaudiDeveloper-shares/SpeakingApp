import { beforeEach, describe, expect, test, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  pool: { query: queryMock },
}));

import {
  reserveTtsUsage,
  TtsQuotaExceededError,
} from '@/lib/speech/tts-usage-server';

beforeEach(() => {
  queryMock.mockReset();
});

describe('TTS monthly usage reservation', () => {
  test('guards the first row with the cap inside the atomic INSERT statement', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      reserveTtsUsage('openai-tts', 101, 100, new Date('2026-07-10T08:00:00Z')),
    ).rejects.toBeInstanceOf(TtsQuotaExceededError);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    const compactSql = sql.replace(/\s+/g, ' ').trim();
    expect(compactSql).toContain(
      'SELECT $1, $2, $3::integer, 1, $4 WHERE $3::integer <= $5::integer ON CONFLICT (provider, period_month)',
    );
    expect(compactSql).toContain(
      'WHERE tts_provider_usage.characters + EXCLUDED.characters <= $5',
    );
    expect(params).toEqual([
      'openai-tts',
      '2026-07',
      101,
      '2026-07-10T08:00:00.000Z',
      100,
    ]);
  });

  test('accepts a fresh-month reservation exactly equal to the cap', async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        provider: 'azure-speech',
        period_month: '2026-07',
        characters: 100,
        request_count: 1,
      }],
    });

    await expect(
      reserveTtsUsage('azure-speech', 100, 100, new Date('2026-07-01T00:00:00Z')),
    ).resolves.toEqual({
      provider: 'azure-speech',
      periodMonth: '2026-07',
      characters: 100,
      requestCount: 1,
    });
  });

  test('turns the losing concurrent reservation into a quota error', async () => {
    let characters = 0;
    queryMock.mockImplementation(async (_sql: string, params: unknown[]) => {
      await Promise.resolve();
      const requested = Number(params[2]);
      const cap = Number(params[4]);
      if (characters + requested > cap) return { rowCount: 0, rows: [] };
      characters += requested;
      return {
        rowCount: 1,
        rows: [{
          provider: params[0],
          period_month: params[1],
          characters,
          request_count: 1,
        }],
      };
    });

    const outcomes = await Promise.allSettled([
      reserveTtsUsage('openai-tts', 60, 100, new Date('2026-07-01T00:00:00Z')),
      reserveTtsUsage('openai-tts', 60, 100, new Date('2026-07-01T00:00:00Z')),
    ]);

    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(TtsQuotaExceededError),
    });
    expect(characters).toBe(60);
  });
});
