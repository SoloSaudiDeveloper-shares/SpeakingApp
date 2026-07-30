import 'server-only';

import { pool } from '@/lib/db';
import type { CloudTtsProviderId, TtsProviderPolicy } from './tts-policy';

export const TTS_REQUESTS_PER_MINUTE = 60;
export const TTS_RATE_WINDOW_RETENTION_MS = 24 * 60 * 60 * 1_000;

export interface TtsUsageRow {
  provider: CloudTtsProviderId;
  periodMonth: string;
  characters: number;
  requestCount: number;
}

export interface TtsUsageSummary extends TtsUsageRow {
  cap: number;
  remaining: number;
}

export class TtsQuotaExceededError extends Error {
  constructor(
    public readonly provider: CloudTtsProviderId,
    public readonly cap: number,
  ) {
    super(`The ${provider} monthly character cap has been reached.`);
  }
}

export class TtsRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Too many text-to-speech requests.');
  }
}

export function currentTtsPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function currentMinute(now = new Date()): Date {
  const value = new Date(now);
  value.setUTCSeconds(0, 0);
  return value;
}

export async function consumeTtsRateLimit(
  userId: number,
  provider: CloudTtsProviderId,
  now = new Date(),
  limit = TTS_REQUESTS_PER_MINUTE,
): Promise<void> {
  const windowStartedAt = currentMinute(now);
  const retentionCutoff = new Date(now.getTime() - TTS_RATE_WINDOW_RETENTION_MS);
  const result = await pool.query<{ request_count: number }>(
    `
      WITH cleanup AS (
        DELETE FROM tts_rate_limit_windows
        WHERE user_id = $1
          AND provider = $2
          AND window_started_at < $5
      )
      INSERT INTO tts_rate_limit_windows
        (user_id, provider, window_started_at, request_count)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (user_id, provider, window_started_at)
      DO UPDATE SET request_count = tts_rate_limit_windows.request_count + 1
      WHERE tts_rate_limit_windows.request_count < $4
      RETURNING request_count
    `,
    [userId, provider, windowStartedAt.toISOString(), limit, retentionCutoff.toISOString()],
  );
  if (result.rowCount === 0) {
    const retryAfterSeconds = Math.max(
      1,
      60 - Math.floor((now.getTime() - windowStartedAt.getTime()) / 1_000),
    );
    throw new TtsRateLimitError(retryAfterSeconds);
  }
}

export async function reserveTtsUsage(
  provider: CloudTtsProviderId,
  characterCount: number,
  cap: number,
  now = new Date(),
): Promise<TtsUsageRow> {
  if (!Number.isSafeInteger(characterCount) || characterCount <= 0) {
    throw new Error('characterCount must be a positive integer.');
  }
  if (!Number.isSafeInteger(cap) || cap <= 0) throw new TtsQuotaExceededError(provider, cap);
  const period = currentTtsPeriod(now);
  const result = await pool.query<{
    provider: CloudTtsProviderId;
    period_month: string;
    characters: number;
    request_count: number;
  }>(
    `
      INSERT INTO tts_provider_usage
        (provider, period_month, characters, request_count, updated_at)
      SELECT $1, $2, $3::integer, 1, $4
      WHERE $3::integer <= $5::integer
      ON CONFLICT (provider, period_month)
      DO UPDATE SET
        characters = tts_provider_usage.characters + EXCLUDED.characters,
        request_count = tts_provider_usage.request_count + 1,
        updated_at = EXCLUDED.updated_at
      WHERE tts_provider_usage.characters + EXCLUDED.characters <= $5
      RETURNING provider, period_month, characters, request_count
    `,
    [provider, period, characterCount, now.toISOString(), cap],
  );
  const row = result.rows[0];
  if (!row) throw new TtsQuotaExceededError(provider, cap);
  return {
    provider: row.provider,
    periodMonth: row.period_month,
    characters: Number(row.characters),
    requestCount: Number(row.request_count),
  };
}

export async function releaseTtsUsage(
  provider: CloudTtsProviderId,
  characterCount: number,
  periodMonth = currentTtsPeriod(),
  now = new Date(),
): Promise<void> {
  await pool.query(
    `
      UPDATE tts_provider_usage
      SET
        characters = GREATEST(0, characters - $3),
        request_count = GREATEST(0, request_count - 1),
        updated_at = $4
      WHERE provider = $1 AND period_month = $2
    `,
    [provider, periodMonth, characterCount, now.toISOString()],
  );
}

export async function getTtsUsage(
  policy: TtsProviderPolicy,
  now = new Date(),
): Promise<TtsUsageSummary[]> {
  const periodMonth = currentTtsPeriod(now);
  const result = await pool.query<{
    provider: CloudTtsProviderId;
    period_month: string;
    characters: number;
    request_count: number;
  }>(
    `
      SELECT provider, period_month, characters, request_count
      FROM tts_provider_usage
      WHERE period_month = $1 AND provider = ANY($2::text[])
      ORDER BY provider
    `,
    [periodMonth, ['azure-speech', 'openai-tts']],
  );
  const rows = new Map(result.rows.map((row) => [row.provider, row]));
  return (['azure-speech', 'openai-tts'] as const).map((provider) => {
    const row = rows.get(provider);
    const cap = policy.providers[provider].monthlyCharacterCap;
    const characters = Number(row?.characters ?? 0);
    return {
      provider,
      periodMonth,
      characters,
      requestCount: Number(row?.request_count ?? 0),
      cap,
      remaining: Math.max(0, cap - characters),
    };
  });
}
