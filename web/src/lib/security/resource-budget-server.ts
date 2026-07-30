import 'server-only';

import { pool } from '@/lib/db';
import { getActiveProvider } from '@/lib/ai/providers';

export const DAILY_PRACTICE_ATTEMPT_LIMIT = 500;
export const DAILY_CLOUD_AI_REQUEST_LIMIT = 100;
export const DAILY_ORGANIZATION_CLOUD_AI_REQUEST_LIMIT = 5_000;
export const DAILY_AUDIO_UPLOAD_BYTE_LIMIT = 250 * 1024 * 1024;

export type MeteredResource =
  | 'practice-attempt'
  | 'cloud-ai'
  | 'cloud-ai-organization'
  | 'audio-upload-bytes';
export type UserResource = Exclude<MeteredResource, 'cloud-ai-organization'>;
export type OrganizationResource = 'cloud-ai-organization';

export class ResourceBudgetExceededError extends Error {
  constructor(
    public readonly resource: MeteredResource,
    public readonly retryAfterSeconds: number,
  ) {
    super(`Daily ${resource} budget reached.`);
    this.name = 'ResourceBudgetExceededError';
  }
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(now: Date): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - now.getTime()) / 1_000));
}

export async function consumeUserResourceBudget(input: {
  userId: number;
  resource: UserResource;
  limit: number;
  units?: number;
  now?: Date;
}): Promise<void> {
  const units = input.units ?? 1;
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId < 1 ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    !Number.isSafeInteger(units) ||
    units < 1
  ) {
    throw new Error('Invalid resource-budget configuration.');
  }
  const now = input.now ?? new Date();
  const result = await pool.query(
    `
      INSERT INTO user_resource_usage
        (user_id, resource, period_day, units, request_count, updated_at)
      SELECT $1, $2, $3::date, $4::integer, 1, $5
      WHERE $4::integer <= $6::integer
      ON CONFLICT (user_id, resource, period_day)
      DO UPDATE SET
        units = user_resource_usage.units + EXCLUDED.units,
        request_count = user_resource_usage.request_count + 1,
        updated_at = EXCLUDED.updated_at
      WHERE user_resource_usage.units + EXCLUDED.units <= $6
      RETURNING units
    `,
    [
      input.userId,
      input.resource,
      utcDay(now),
      units,
      now.toISOString(),
      input.limit,
    ],
  );
  if (result.rowCount === 0) {
    throw new ResourceBudgetExceededError(
      input.resource,
      secondsUntilNextUtcDay(now),
    );
  }
}

export async function releaseUserResourceBudget(input: {
  userId: number;
  resource: UserResource;
  units: number;
  now?: Date;
}): Promise<void> {
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId < 1 ||
    !Number.isSafeInteger(input.units) ||
    input.units < 1
  ) {
    throw new Error('Invalid resource-budget release.');
  }
  const now = input.now ?? new Date();
  await pool.query(
    `
      UPDATE user_resource_usage
      SET
        units = GREATEST(0, units - $4::integer),
        request_count = GREATEST(0, request_count - 1),
        updated_at = $5
      WHERE user_id = $1 AND resource = $2 AND period_day = $3::date
    `,
    [input.userId, input.resource, utcDay(now), input.units, now.toISOString()],
  );
}

export async function consumeOrganizationResourceBudget(input: {
  resource: OrganizationResource;
  limit: number;
  units?: number;
  now?: Date;
}): Promise<void> {
  const units = input.units ?? 1;
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    !Number.isSafeInteger(units) ||
    units < 1
  ) {
    throw new Error('Invalid organization resource-budget configuration.');
  }
  const now = input.now ?? new Date();
  const result = await pool.query(
    `
      INSERT INTO organization_resource_usage
        (resource, period_day, units, request_count, updated_at)
      SELECT $1, $2::date, $3::integer, 1, $4
      WHERE $3::integer <= $5::integer
      ON CONFLICT (resource, period_day)
      DO UPDATE SET
        units = organization_resource_usage.units + EXCLUDED.units,
        request_count = organization_resource_usage.request_count + 1,
        updated_at = EXCLUDED.updated_at
      WHERE organization_resource_usage.units + EXCLUDED.units <= $5
      RETURNING units
    `,
    [input.resource, utcDay(now), units, now.toISOString(), input.limit],
  );
  if (result.rowCount === 0) {
    throw new ResourceBudgetExceededError(
      input.resource,
      secondsUntilNextUtcDay(now),
    );
  }
}

export async function consumePracticeAttemptBudget(userId: number): Promise<void> {
  await consumeUserResourceBudget({
    userId,
    resource: 'practice-attempt',
    limit: DAILY_PRACTICE_ATTEMPT_LIMIT,
  });
}

export async function consumeAudioUploadBudget(
  userId: number,
  bytes: number,
  now = new Date(),
): Promise<void> {
  await consumeUserResourceBudget({
    userId,
    resource: 'audio-upload-bytes',
    units: bytes,
    limit: DAILY_AUDIO_UPLOAD_BYTE_LIMIT,
    now,
  });
}

export async function consumeCloudAiBudgetIfNeeded(userId: number): Promise<boolean> {
  const provider = await getActiveProvider();
  if (provider.provider === 'ollama') return false;
  const reservationTime = new Date();
  await consumeUserResourceBudget({
    userId,
    resource: 'cloud-ai',
    limit: DAILY_CLOUD_AI_REQUEST_LIMIT,
    now: reservationTime,
  });
  try {
    await consumeOrganizationResourceBudget({
      resource: 'cloud-ai-organization',
      limit: DAILY_ORGANIZATION_CLOUD_AI_REQUEST_LIMIT,
      now: reservationTime,
    });
  } catch (error) {
    await releaseUserResourceBudget({
      userId,
      resource: 'cloud-ai',
      units: 1,
      now: reservationTime,
    });
    throw error;
  }
  return true;
}

export function resourceBudgetResponse(error: unknown): Response | null {
  if (!(error instanceof ResourceBudgetExceededError)) return null;
  const label =
    error.resource === 'cloud-ai' || error.resource === 'cloud-ai-organization'
      ? 'AI assistance'
      : error.resource === 'audio-upload-bytes'
        ? 'recording uploads'
        : 'practice attempts';
  return Response.json(
    { error: `Your daily ${label} limit has been reached. Please try again tomorrow.` },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(error.retryAfterSeconds),
      },
    },
  );
}
