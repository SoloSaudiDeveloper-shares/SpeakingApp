import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL || !process.env.AZURE_STORAGE_ACCOUNT_URL) {
  throw new Error('DATABASE_URL and AZURE_STORAGE_ACCOUNT_URL are required.');
}
const url = new URL(process.env.DATABASE_URL);
const work = await mkdtemp(path.join(tmpdir(), 'speaking-backup-'));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const dump = path.join(work, `speaking-lab-${stamp}.dump`);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: { rejectUnauthorized: true },
});
try {
  const audio = await pool.query(`
    SELECT audio_path AS key, COUNT(*)::int AS references
    FROM attempts
    WHERE audio_path IS NOT NULL AND audio_path <> ''
    GROUP BY audio_path
    ORDER BY audio_path
  `);
  const manifestData = Buffer.from(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    storageAccount: new URL(process.env.AZURE_STORAGE_ACCOUNT_URL).hostname,
    container: process.env.AZURE_AUDIO_CONTAINER || 'speaking-audio',
    objects: audio.rows,
  }, null, 2)}\n`);
  const manifestName = `speaking-lab-${stamp}.audio-manifest.json`;
  const manifestHash = createHash('sha256').update(manifestData).digest('hex');
  await new Promise((resolve, reject) => {
    const child = spawn('pg_dump', [
      '--host', url.hostname,
      '--port', url.port || '5432',
      '--username', decodeURIComponent(url.username),
      '--dbname', url.pathname.replace(/^\//, ''),
      '--format=custom', '--compress=9', '--no-owner', '--no-acl', '--file', dump,
    ], {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require' },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited with ${code}.`)));
  });
  const data = await readFile(dump);
  const sha256 = createHash('sha256').update(data).digest('hex');
  const service = new BlobServiceClient(process.env.AZURE_STORAGE_ACCOUNT_URL, new DefaultAzureCredential());
  const container = service.getContainerClient(process.env.AZURE_BACKUP_CONTAINER || 'database-backups');
  await container.createIfNotExists();
  await Promise.all([
    container.getBlockBlobClient(path.basename(dump)).uploadData(data, {
      metadata: {
        sha256,
        audioManifest: manifestName,
        audioManifestSha256: manifestHash,
        commit: process.env.APP_COMMIT_SHA || 'unknown',
      },
    }),
    container.getBlockBlobClient(manifestName).uploadData(manifestData, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      metadata: { sha256: manifestHash, commit: process.env.APP_COMMIT_SHA || 'unknown' },
    }),
  ]);
  console.log(`[backup-job] Uploaded ${path.basename(dump)} (${sha256}) and ${manifestName} (${manifestHash}).`);
} finally {
  await pool.end();
  await rm(work, { recursive: true, force: true });
}
