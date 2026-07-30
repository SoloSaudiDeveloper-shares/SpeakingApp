import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { postgresCommandConnection, run } from './postgres-cli';
import { postgresSslConfig } from '../src/lib/db/ssl';

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const databaseUrl = process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required.');
const backupDir = path.resolve(process.env.BACKUP_DIR || 'data/backups/postgresql');
const requested = argument('--backup');
const backups = requested
  ? [path.resolve(requested)]
  : (await readdir(backupDir)).filter((name) => name.endsWith('.dump')).sort().map((name) => path.join(backupDir, name));
const backup = backups.at(-1);
if (!backup) throw new Error('No PostgreSQL backup was found.');
const checksumFile = backup.replace(/\.dump$/i, '.sha256.json');
const checksums = JSON.parse(await readFile(checksumFile, 'utf8')) as {
  dump?: { path?: string; sha256?: string };
  audioManifest?: { path?: string; sha256?: string };
};
if (
  checksums.dump?.path !== path.basename(backup) ||
  !checksums.dump.sha256 ||
  createHash('sha256').update(await readFile(backup)).digest('hex') !== checksums.dump.sha256
) {
  throw new Error('PostgreSQL dump SHA-256 verification failed.');
}
if (!checksums.audioManifest?.path || !checksums.audioManifest.sha256) {
  throw new Error('Audio manifest checksum metadata is missing.');
}
const audioManifest = path.join(path.dirname(backup), checksums.audioManifest.path);
if (
  createHash('sha256').update(await readFile(audioManifest)).digest('hex') !==
  checksums.audioManifest.sha256
) {
  throw new Error('Audio manifest SHA-256 verification failed.');
}

const original = new URL(databaseUrl);
const maintenanceDatabase = process.env.POSTGRES_MAINTENANCE_DATABASE || 'postgres';
const maintenanceUrl = new URL(original);
maintenanceUrl.pathname = `/${maintenanceDatabase}`;
const admin = new Pool({
  connectionString: maintenanceUrl.toString(),
  max: 1,
  ssl: postgresSslConfig(),
});
const testDatabase = `speaking_restore_${randomBytes(6).toString('hex')}`;
try {
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  const connection = postgresCommandConnection(databaseUrl, testDatabase);
  await run('pg_restore', [
    ...connection.args,
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-acl',
    '--exit-on-error',
    backup,
  ], connection.env);
  const restoredUrl = new URL(original);
  restoredUrl.pathname = `/${testDatabase}`;
  const restored = new Pool({
    connectionString: restoredUrl.toString(),
    max: 1,
    ssl: postgresSslConfig(),
  });
  try {
    const tables = await restored.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
    `);
    const sessions = await restored.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM sessions`);
    const orphanAttempts = await restored.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count FROM attempts a LEFT JOIN students s ON s.id=a.student_id WHERE s.id IS NULL
    `);
    if (Number(tables.rows[0]?.count ?? 0) < 42 ||
        Number(orphanAttempts.rows[0]?.count ?? 0) !== 0) {
      throw new Error('Restored database integrity checks failed.');
    }
    console.log(JSON.stringify({
      ok: true,
      backup,
      hashesVerified: true,
      tableCount: Number(tables.rows[0]?.count ?? 0),
      sessions: Number(sessions.rows[0]?.count ?? 0),
      orphanAttempts: 0,
    }, null, 2));
  } finally {
    await restored.end();
  }
} finally {
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()`,
    [testDatabase],
  ).catch(() => undefined);
  await admin.query(`DROP DATABASE IF EXISTS "${testDatabase}"`);
  await admin.end();
}
