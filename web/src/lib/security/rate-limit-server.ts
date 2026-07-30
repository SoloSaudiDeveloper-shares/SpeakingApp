import 'server-only';

import { createHmac } from 'node:crypto';
import { pool } from '@/lib/db';

export class SharedRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Request limit reached.');
    this.name = 'SharedRateLimitError';
  }
}

function stableHash(value: string): string {
  const key =
    process.env.AUTH_RATE_LIMIT_HASH_KEY?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    'speaking-lab-development-rate-limit-key';
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

export function normalizedAccountSubject(username: string): string {
  return stableHash(`account:${username.trim().normalize('NFKC').toLowerCase()}`);
}

function safeHeaderValue(value: string | null, fallback: string): string {
  const normalized = value?.trim().slice(0, 256);
  return normalized || fallback;
}

export function requestRateLimitSubjects(request: Pick<Request, 'headers'>): {
  ip: string;
  origin: string;
} {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',', 1)[0] ?? null;
  const clientIp =
    request.headers.get('x-azure-clientip') ||
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    forwarded;
  const origin = request.headers.get('origin');
  return {
    ip: stableHash(`ip:${safeHeaderValue(clientIp, 'unavailable')}`),
    origin: stableHash(`origin:${safeHeaderValue(origin, 'non-browser')}`),
  };
}

function windowStart(now: Date, windowSeconds: number): Date {
  return new Date(
    Math.floor(now.getTime() / (windowSeconds * 1_000)) * windowSeconds * 1_000,
  );
}

export async function consumeSharedRateLimit(input: {
  scope: string;
  subjectHash: string;
  limit: number;
  windowSeconds: number;
  now?: Date;
}): Promise<void> {
  if (
    !/^[a-z0-9:_-]{1,64}$/i.test(input.scope) ||
    !/^[a-f0-9]{64}$/.test(input.subjectHash) ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    !Number.isSafeInteger(input.windowSeconds) ||
    input.windowSeconds < 1
  ) {
    throw new Error('Invalid shared rate-limit configuration.');
  }
  const now = input.now ?? new Date();
  const startedAt = windowStart(now, input.windowSeconds);
  const result = await pool.query(
    `
      INSERT INTO security_rate_limit_windows
        (scope, subject_hash, window_started_at, request_count)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (scope, subject_hash, window_started_at)
      DO UPDATE SET request_count = security_rate_limit_windows.request_count + 1
      WHERE security_rate_limit_windows.request_count < $4
      RETURNING request_count
    `,
    [input.scope, input.subjectHash, startedAt.toISOString(), input.limit],
  );
  if (result.rowCount === 0) {
    const elapsedSeconds = Math.floor((now.getTime() - startedAt.getTime()) / 1_000);
    throw new SharedRateLimitError(Math.max(1, input.windowSeconds - elapsedSeconds));
  }
}

export async function clearSharedRateLimit(
  scope: string,
  subjectHash: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM security_rate_limit_windows WHERE scope = $1 AND subject_hash = $2`,
    [scope, subjectHash],
  );
}

export function sharedRateLimitResponse(error: unknown): Response | null {
  if (!(error instanceof SharedRateLimitError)) return null;
  return Response.json(
    { error: 'Too many requests. Please wait and try again.' },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(error.retryAfterSeconds),
      },
    },
  );
}
