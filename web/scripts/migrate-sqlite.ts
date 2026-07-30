import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Pool, type PoolClient } from 'pg';
import { hashPassword, verifyPassword } from '../src/lib/utils/password';
import { uploadAudioObject } from '../src/lib/storage/audio-storage';
import {
  isSecretLikeSettingKey,
  PROVIDER_SECRET_SETTING_KEYS,
} from '../src/lib/secrets/sensitive-setting';
import { postgresSslConfig } from '../src/lib/db/ssl';

const TABLE_ORDER = [
  'books', 'students', 'user_accounts', 'app_settings', 'badges',
  'klp_import_sources', 'klp_concepts', 'klp_active_question_shapes',
  'cycles', 'student_cycles', 'vocabulary_items', 'practice_tasks',
  'attempts', 'teacher_flags', 'word_mastery_records', 'custom_practice_sets',
  'stage_overrides', 'live_sessions', 'dashboard_widgets', 'student_xp',
  'student_badges', 'daily_goals', 'spaced_repetition_queue',
  'homework_assignments', 'homework_submissions', 'student_texts',
  'text_attempts', 'student_word_lists', 'fluency_drill_sessions',
  'scenario_attempts', 'practice_task_klps', 'klp_generated_scenarios',
  'scenario_klps', 'attempt_klp_results', 'student_klp_summaries',
  'xapi_outbox', 'external_identities', 'external_sso_launches',
  'speech_reliability_events', 'homework_path_progress',
] as const;
const EXCLUDED_TABLES = ['sessions', 'app_secrets'];
const WEAK_PASSWORDS = ['admin', 'teacher', '1'];

type SqliteRow = Record<string, unknown>;
type ColumnInfo = { column_name: string; data_type: string; is_nullable: 'YES' | 'NO'; column_default: string | null };

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const sourcePath = path.resolve(argument('--source') || process.env.SQLITE_SOURCE_PATH || '');
const verification = process.argv.includes('--verification');
const skipAudio = process.argv.includes('--skip-audio');
if (!sourcePath || sourcePath === path.resolve('.')) {
  throw new Error('Provide --source <verified-sqlite-backup.db>.');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

await access(sourcePath);
const sqlite = new Database(sourcePath, { readonly: true, fileMustExist: true });
const integrity = sqlite.pragma('integrity_check') as Array<{ integrity_check: string }>;
if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
  throw new Error('SQLite integrity_check failed.');
}
const postgres = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  ssl: postgresSslConfig(),
});
const report = {
  source: sourcePath,
  startedAt: new Date().toISOString(),
  verification,
  sourceIntegrity: 'ok',
  tables: {} as Record<string, { source: number; imported: number; excluded: number; representativeHash: string }>,
  exclusions: {
    sessions: 0,
    secretSettings: 0,
    expiredReplayEntries: 0,
    sentOrInvalidXapiStatements: 0,
    invalidExternalIdentities: 0,
    ftsTables: [] as string[],
  },
  providersPreviouslyConfigured: [] as string[],
  weakAccounts: { adminsReset: 0, nonAdminsDisabled: 0 },
  audio: {
    uploaded: 0,
    missing: 0,
    skipped: 0,
    missingAttemptIds: [] as number[],
  },
  sequencesReset: 0,
  relationshipChecks: {} as Record<string, number>,
  completedAt: '',
};

function sourceTableExists(table: string) {
  return Boolean(sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
}

function stableHash(rows: SqliteRow[]) {
  const identity = rows.map((row) => row.id ?? `${row.student_id ?? ''}:${row.cycle_id ?? ''}:${row.key ?? ''}`);
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function weakPassword(hash: unknown) {
  return typeof hash === 'string' && WEAK_PASSWORDS.some((candidate) => {
    try { return verifyPassword(candidate, hash); } catch { return false; }
  });
}

async function targetColumns(client: PoolClient, table: string) {
  return (await client.query<ColumnInfo>(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [table])).rows;
}

function transformValue(value: unknown, column: ColumnInfo) {
  if (value === null || value === undefined || value === '') {
    return column.is_nullable === 'YES' ? null : value;
  }
  if (column.data_type === 'boolean') return value === true || value === 1 || value === '1';
  if (column.data_type === 'jsonb') {
    if (typeof value !== 'string') return JSON.stringify(value);
    try {
      JSON.parse(value);
      return value;
    } catch {
      throw new Error(`Invalid JSON in ${column.column_name}.`);
    }
  }
  return value;
}

async function insertRows(client: PoolClient, table: string, sourceRows: SqliteRow[]) {
  const columns = await targetColumns(client, table);
  const columnByName = new Map(columns.map((column) => [column.column_name, column]));
  const groupedRows = new Map<string, Array<{ names: string[]; values: unknown[] }>>();
  let imported = 0;

  for (const sourceRow of sourceRows) {
    const row = { ...sourceRow };
    if (table === 'user_accounts' && weakPassword(row.password_hash)) {
      if (row.role === 'Admin') {
        const replacement = process.env.MIGRATION_BOOTSTRAP_ADMIN_PASSWORD?.trim();
        if (!replacement || replacement.length < 16) {
          throw new Error('MIGRATION_BOOTSTRAP_ADMIN_PASSWORD (16+ characters) is required for a weak Admin account.');
        }
        row.password_hash = hashPassword(replacement);
        row.must_change_password = 1;
        report.weakAccounts.adminsReset += 1;
      } else {
        row.is_active = 0;
        row.must_change_password = 1;
        report.weakAccounts.nonAdminsDisabled += 1;
      }
    }
    // Include PostgreSQL-only values derived during migration (for example
    // must_change_password) while still ignoring target defaults that are not
    // present in the source row.
    const rowColumns = new Set(Object.keys(row));
    const usable = columns.filter((column) => rowColumns.has(column.column_name));
    const names = usable.map((column) => `"${column.column_name}"`);
    const values = usable.map((column) => transformValue(row[column.column_name], column));
    const signature = usable.map((column) => column.column_name).join('\u001f');
    const group = groupedRows.get(signature) ?? [];
    group.push({ names, values });
    groupedRows.set(signature, group);
  }

  for (const [signature, rows] of groupedRows) {
    if (rows.length === 0) continue;
    const columnNames = signature.split('\u001f');
    const quotedNames = columnNames.map((name) => {
      if (!columnByName.has(name)) throw new Error(`Unknown target column ${table}.${name}.`);
      return `"${name.replaceAll('"', '""')}"`;
    });
    // PostgreSQL supports at most 65,535 bind parameters. Staying below
    // 60,000 also keeps each remote TLS request to a manageable size.
    const batchSize = Math.max(1, Math.min(250, Math.floor(60_000 / columnNames.length)));
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const parameters = batch.flatMap((row) => row.values);
      const tuples = batch.map((row, rowIndex) => {
        const offset = rowIndex * row.values.length;
        return `(${row.values.map((_, valueIndex) => `$${offset + valueIndex + 1}`).join(',')})`;
      });
      await client.query(
        `INSERT INTO "${table}" (${quotedNames.join(',')}) VALUES ${tuples.join(',')}`,
        parameters,
      );
      imported += batch.length;
    }
  }

  return imported;
}

async function migrateAudio(client: PoolClient) {
  const rows = (await client.query<{ id: number; audio_path: string }>(
    `SELECT id, audio_path FROM attempts WHERE audio_path IS NOT NULL AND audio_path <> ''`,
  )).rows;
  if (skipAudio) {
    report.audio.skipped = rows.length;
    return;
  }
  const audioRoot = path.resolve(process.env.MIGRATE_AUDIO_DIR || path.join(path.dirname(sourcePath), 'audio-archive'));
  for (const row of rows) {
    const localPath = path.resolve(audioRoot, row.audio_path);
    if (!localPath.startsWith(audioRoot + path.sep)) {
      report.audio.missing += 1;
      report.audio.missingAttemptIds.push(row.id);
      continue;
    }
    try {
      const data = await readFile(localPath);
      const extension = path.extname(localPath).toLowerCase() || '.webm';
      const key = `legacy/${row.id}/${createHash('sha256').update(data).digest('hex').slice(0, 24)}${extension}`;
      await uploadAudioObject(key, data, extension === '.wav' ? 'audio/wav' : 'audio/webm');
      await client.query(`UPDATE attempts SET audio_path=$1 WHERE id=$2`, [key, row.id]);
      report.audio.uploaded += 1;
    } catch {
      report.audio.missing += 1;
      report.audio.missingAttemptIds.push(row.id);
    }
  }
}

const client = await postgres.connect();
try {
  const targetTables = (await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
    ORDER BY table_name
  `)).rows;
  const nonEmptyTables: string[] = [];
  for (const { table_name: table } of targetTables) {
    const quotedTable = `"${table.replaceAll('"', '""')}"`;
    const hasRows = await client.query<{ has_rows: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM ${quotedTable} LIMIT 1) AS has_rows`,
    );
    if (hasRows.rows[0]?.has_rows) nonEmptyTables.push(table);
  }
  if (nonEmptyTables.length > 0) {
    throw new Error(
      `Target PostgreSQL database is not empty (${nonEmptyTables.join(', ')}).` +
      (verification ? ' Verification imports also require a fresh target database.' : ''),
    );
  }

  await client.query('BEGIN');
  const sourceTables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
  report.exclusions.ftsTables = sourceTables
    .map((row) => row.name)
    .filter((name) => name.startsWith('fts_') || name.includes('_fts'));
  report.exclusions.sessions = sourceTableExists('sessions')
    ? Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM sessions`).get() as { count: number }).count)
    : 0;

  for (const table of TABLE_ORDER) {
    if (!sourceTableExists(table)) continue;
    let rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as SqliteRow[];
    let excluded = 0;
    if (table === 'app_settings') {
      const safeRows: SqliteRow[] = [];
      for (const row of rows) {
        if (isSecretLikeSettingKey(row.key)) {
          excluded += 1;
          if (row.value && PROVIDER_SECRET_SETTING_KEYS.has(String(row.key))) {
            report.providersPreviouslyConfigured.push(String(row.key).replace('_api_key', '').replace('_speech_key', '-speech'));
          }
          continue;
        }
        safeRows.push(row);
      }
      rows = safeRows;
      for (const provider of new Set(report.providersPreviouslyConfigured)) {
        rows.push({ key: `migration_${provider}_was_configured`, value: 'true' });
      }
      report.exclusions.secretSettings += excluded;
    }
    if (table === 'external_sso_launches') {
      const before = rows.length;
      rows = rows.filter((row) => new Date(String(row.expires_at)).getTime() > Date.now());
      report.exclusions.expiredReplayEntries += before - rows.length;
      excluded += before - rows.length;
    }
    if (table === 'external_identities') {
      const before = rows.length;
      rows = rows.filter((row) =>
        String(row.provider ?? '').trim().length > 0 &&
        String(row.subject ?? '').trim().length > 0 &&
        Number.isInteger(Number(row.user_account_id)),
      );
      report.exclusions.invalidExternalIdentities += before - rows.length;
      excluded += before - rows.length;
    }
    if (table === 'xapi_outbox') {
      const before = rows.length;
      rows = rows
        .filter((row) => ['pending', 'failed', 'processing'].includes(String(row.status)))
        .map((row) => String(row.status) === 'processing'
          ? {
              ...row,
              status: 'pending',
              lock_owner: null,
              locked_at: null,
              next_attempt_at: new Date().toISOString(),
            }
          : row);
      report.exclusions.sentOrInvalidXapiStatements += before - rows.length;
      excluded += before - rows.length;
    }
    const imported = await insertRows(client, table, rows);
    console.log(`[migrate:sqlite] ${table}: imported ${imported}, excluded ${excluded}.`);
    report.tables[table] = {
      source: rows.length + excluded,
      imported,
      excluded,
      representativeHash: stableHash(rows),
    };
  }

  await migrateAudio(client);
  const identityTables = (await client.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND is_identity='YES'
  `)).rows;
  for (const identity of identityTables) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX("${identity.column_name}") FROM "${identity.table_name}"), 1), EXISTS(SELECT 1 FROM "${identity.table_name}"))`,
      [identity.table_name, identity.column_name],
    );
    report.sequencesReset += 1;
  }
  const relationshipQueries: Record<string, string> = {
    orphanAttempts: `SELECT COUNT(*)::int AS count FROM attempts a LEFT JOIN students s ON s.id=a.student_id WHERE s.id IS NULL`,
    orphanAccounts: `SELECT COUNT(*)::int AS count FROM user_accounts u LEFT JOIN students s ON s.id=u.student_id WHERE u.student_id IS NOT NULL AND s.id IS NULL`,
    orphanKlpResults: `SELECT COUNT(*)::int AS count FROM attempt_klp_results r LEFT JOIN klp_concepts k ON k.id=r.klp_concept_id WHERE k.id IS NULL`,
    importedSessions: `SELECT COUNT(*)::int AS count FROM sessions`,
  };
  for (const [name, query] of Object.entries(relationshipQueries)) {
    report.relationshipChecks[name] = Number((await client.query<{ count: number }>(query)).rows[0]?.count ?? 0);
  }
  if (Object.entries(report.relationshipChecks).some(([name, count]) => name !== 'importedSessions' && count > 0) ||
      report.relationshipChecks.importedSessions !== 0) {
    throw new Error('Post-import relationship checks failed.');
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  sqlite.close();
  await postgres.end();
}

report.completedAt = new Date().toISOString();
const reportPath = path.resolve(argument('--report') || `migration-reports/sqlite-postgres-${Date.now()}.json`);
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(`[migrate:sqlite] Reconciliation report: ${reportPath}`);
