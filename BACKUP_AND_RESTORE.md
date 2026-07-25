# PostgreSQL and Blob backup/restore runbook

The Azure release uses PostgreSQL 17 and private Blob Storage. Database rows contain
only audio object keys; the audio objects have their own retention policy.

## Before schema changes and deployments

1. Confirm the Git branch and working tree contain only the intended release.
2. From `web`, run `npm run db:check`.
3. Run `npm run backup:data`. It creates a PostgreSQL custom-format dump, a referenced
   audio-object manifest, and SHA-256 hashes under `web/data/backups/postgresql`.
4. Run `npm run backup:restore-test`. The command restores the dump into a new temporary
   database, verifies both SHA-256 files, the schema, and relationships, and drops the
   temporary database.
5. In Azure, start the `speakinglab-backup` Container Apps job. Confirm it succeeds before
   starting the migration job.
6. Record the commit SHA, dump hash, Azure job execution ID, and operator in the release log.

The deployment workflow performs steps 5–6 before every migration. PostgreSQL Flexible
Server also retains 14 days of point-in-time restore history.

## Restore

1. Do not overwrite the live database. Restore PostgreSQL PITR or the logical dump to a
   new server/database.
2. Set a temporary revision or local verification environment to the restored database.
3. Run `npm run db:check`, authenticate each role, open representative historical attempts,
   and verify that referenced private audio objects are available.
4. Run the SAIF signed-launch and mock-LRS checks.
5. Move traffic only after parity checks pass. Preserve the incident database and audit log.

Blob soft-delete and container-delete retention are both 14 days. Restore deleted audio
objects before promoting a database whose rows reference them.
