import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/lib/db/index';
import { postgresCommandConnection, run } from './postgres-cli';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const backupDir = path.resolve(process.env.BACKUP_DIR || 'data/backups/postgresql');
await mkdir(backupDir, { recursive: true });
const dumpPath = path.join(backupDir, `speaking-lab-${stamp}.dump`);
const manifestPath = path.join(backupDir, `speaking-lab-${stamp}.audio-manifest.json`);

const preflight = await pool.query<{ database_time: string }>('select now()::text as database_time');
const audio = await pool.query<{ key: string; references: number }>(`
  SELECT audio_path AS key, COUNT(*)::int AS references
  FROM attempts WHERE audio_path IS NOT NULL AND audio_path <> ''
  GROUP BY audio_path ORDER BY audio_path
`);
const manifest = {
  generatedAt: new Date().toISOString(),
  databaseTime: preflight.rows[0]?.database_time,
  storageAccount: process.env.AZURE_STORAGE_ACCOUNT_URL ? new URL(process.env.AZURE_STORAGE_ACCOUNT_URL).hostname : 'azurite',
  container: process.env.AZURE_AUDIO_CONTAINER || 'speaking-audio',
  objects: audio.rows,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
const connection = postgresCommandConnection(databaseUrl);
await run('pg_dump', [
  ...connection.args,
  '--schema=public',
  '--schema=drizzle',
  '--format=custom',
  '--compress=9',
  '--no-owner',
  '--no-acl',
  '--file', dumpPath,
], connection.env);
const dumpHash = createHash('sha256').update(await readFile(dumpPath)).digest('hex');
const manifestHash = createHash('sha256').update(await readFile(manifestPath)).digest('hex');
await writeFile(
  path.join(backupDir, `speaking-lab-${stamp}.sha256.json`),
  `${JSON.stringify({ dump: { path: path.basename(dumpPath), sha256: dumpHash }, audioManifest: { path: path.basename(manifestPath), sha256: manifestHash } }, null, 2)}\n`,
  { flag: 'wx' },
);
await pool.end();
console.log(`[backup] PostgreSQL dump: ${dumpPath}`);
console.log(`[backup] SHA-256: ${dumpHash}`);
