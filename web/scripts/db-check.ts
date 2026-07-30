import { createHash } from 'node:crypto';
import { closeDatabase, pool } from '../src/lib/db/index';

if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required.');

try {
  const version = await pool.query<{ version: string }>(
    `SELECT current_setting('server_version') AS version`,
  );
  const tables = await pool.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const columns = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    identity_generation: string | null;
  }>(`
    SELECT table_name, column_name, data_type, is_nullable, column_default, identity_generation
    FROM information_schema.columns
    WHERE table_schema='public'
    ORDER BY table_name, ordinal_position
  `);
  const migrationTable = Number((await pool.query<{ count: number }>(`
    SELECT COUNT(*)::int AS count FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
  `)).rows[0]?.count ?? 0) === 1;
  const constraints = await pool.query<{
    constraint_name: string;
    constraint_type: string;
    definition: string;
    validated: boolean;
  }>(`
    SELECT conname AS constraint_name, contype::text AS constraint_type,
      pg_get_constraintdef(oid, true) AS definition, convalidated AS validated
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
    ORDER BY conrelid::regclass::text, conname
  `);
  const indexes = await pool.query<{ schemaname: string; tablename: string; indexdef: string }>(`
    SELECT schemaname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname='public'
    ORDER BY tablename, indexname
  `);
  const integrity = await pool.query<{
    orphan_attempts: number;
    orphan_accounts: number;
    plaintext_secret_settings: number;
    malformed_session_tokens: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM attempts a LEFT JOIN students s ON s.id=a.student_id WHERE s.id IS NULL) AS orphan_attempts,
      (SELECT COUNT(*)::int FROM user_accounts u LEFT JOIN students s ON s.id=u.student_id
        WHERE u.student_id IS NOT NULL AND s.id IS NULL) AS orphan_accounts,
      (SELECT COUNT(*)::int FROM app_settings
        WHERE key ~* '(^|_)(api_?key|secret|password|passwd|token|credential|private_?key|connection_?string)(_|$)') AS plaintext_secret_settings,
      (SELECT COUNT(*)::int FROM sessions WHERE token_hash !~ '^[a-f0-9]{64}$') AS malformed_session_tokens
  `);
  const schemaFingerprint = createHash('sha256')
    .update(JSON.stringify({
      columns: columns.rows,
      constraints: constraints.rows.map(({ validated: _validated, ...constraint }) => constraint),
      indexes: indexes.rows,
    }))
    .digest('hex');
  const integrityRow = integrity.rows[0];
  const unvalidatedConstraints = constraints.rows.filter((constraint) => !constraint.validated).length;
  const report = {
    ok:
      migrationTable &&
      version.rows[0]?.version?.startsWith('17.') &&
      tables.rows.length >= 42 &&
      unvalidatedConstraints === 0 &&
      Object.values(integrityRow).every((value) => Number(value) === 0),
    serverVersion: version.rows[0]?.version,
    tableCount: tables.rows.length,
    foreignKeyCount: constraints.rows.filter((constraint) => constraint.constraint_type === 'f').length,
    unvalidatedConstraints,
    integrity: integrityRow,
    schemaFingerprint,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await closeDatabase();
}
