# Speaking Lab backup and restore runbook

The Railway pilot remains a single replica with the SQLite database on its persistent volume. WAL mode and a 10-second busy timeout are configured by the application.

## Before schema changes and deployments

1. Create or switch to a `codex/` Git branch and confirm `git status` contains only expected work.
2. From `web`, run `npm run backup:data`. This uses SQLite's online-backup API, runs `PRAGMA integrity_check` before and after the copy, records a SHA-256 hash, and writes an audio-file manifest beside the backup.
3. Trigger a Railway Volume Backup/snapshot in the Railway project before deployment.
4. Commit the intended code checkpoint. Never add database, audio, `.env`, or backup files to Git.

Backups are written below `data/backups` locally or below `$SPEAKING_LAB_DATA_DIR/backups` in a deployed environment.

## Restore drill

1. Stop the application so no process has the live database open.
2. Preserve the current database and its `-wal`/`-shm` files under a dated incident folder.
3. Copy the selected backup to `<data-dir>/speakinglab.db`; do not copy stale `-wal`/`-shm` files with it.
4. Run `npm run backup:restore-test` to verify the latest backup opens and passes `PRAGMA integrity_check`.
5. Start one application replica, check `/api/health`, authenticate as each role, and verify a learner attempt plus its audio link.
6. Record the tested backup filename, hash, operator, and time in the deployment log.

If Railway volume restore is used, restore into a separate service or cloned volume first, validate it, and only then replace the production service volume.
