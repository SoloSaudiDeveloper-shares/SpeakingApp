import { Pool, type PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { postgresSslConfig } from './ssl';

type DatabaseGlobals = typeof globalThis & {
  __speakingLabPgPool?: Pool;
  __speakingLabPgClosePromise?: Promise<void>;
  __speakingLabPgShutdownRegistered?: boolean;
};

const globals = globalThis as DatabaseGlobals;
const isBuild =
  process.env.SPEAKING_LAB_SKIP_DB_INIT === '1' ||
  process.env.NEXT_PHASE === 'phase-production-build';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function poolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString && !isBuild) {
    throw new Error('DATABASE_URL is required for the PostgreSQL runtime.');
  }

  return {
    // Build-time imports must not connect. Any accidental build-time query
    // fails quickly instead of touching a developer or production database.
    connectionString:
      connectionString ??
      'postgresql://build-only:build-only@127.0.0.1:1/build-only',
    max: positiveInteger(process.env.DB_POOL_MAX, 5),
    connectionTimeoutMillis: positiveInteger(
      process.env.DB_CONNECT_TIMEOUT_MS,
      5_000,
    ),
    idleTimeoutMillis: positiveInteger(process.env.DB_IDLE_TIMEOUT_MS, 30_000),
    query_timeout: positiveInteger(process.env.DB_QUERY_TIMEOUT_MS, 15_000),
    statement_timeout: positiveInteger(
      process.env.DB_STATEMENT_TIMEOUT_MS,
      15_000,
    ),
    application_name: process.env.XAPI_SOURCE_APP || 'speaking-lab',
    ssl: postgresSslConfig(),
  };
}

export const pool = globals.__speakingLabPgPool ?? new Pool(poolConfig());
globals.__speakingLabPgPool = pool;

pool.on('error', (error) => {
  console.error('[database] Idle PostgreSQL client error:', error.message);
});

function closePoolOnce(): Promise<void> {
  globals.__speakingLabPgClosePromise ??= pool.end();
  return globals.__speakingLabPgClosePromise;
}

if (
  process.env.NODE_ENV === 'production' &&
  !isBuild &&
  !globals.__speakingLabPgShutdownRegistered
) {
  globals.__speakingLabPgShutdownRegistered = true;
  const closePool = () => {
    void closePoolOnce().catch((error: unknown) => {
      console.error(
        '[database] PostgreSQL pool shutdown failed:',
        error instanceof Error ? error.message : 'unknown error',
      );
    });
  };
  process.once('SIGTERM', closePool);
  process.once('SIGINT', closePool);
}

export const db = drizzle(pool, { schema });
export { schema };

export async function checkDatabase(): Promise<{
  ok: true;
  databaseTime: string;
}> {
  const result = await pool.query<{ database_time: string }>(
    'select now()::text as database_time',
  );
  return { ok: true, databaseTime: result.rows[0]?.database_time ?? '' };
}

export async function closeDatabase(): Promise<void> {
  await closePoolOnce();
}
