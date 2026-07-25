# Railway Hosting

This deployment is for a demo or small pilot. The current app uses SQLite, so run one Railway service instance only. Do not scale horizontally until the database is moved to managed Postgres and audio files are moved to object storage.

## GitHub

Keep the repository private. Do not commit:

- `data/*.db`, `*.db-wal`, `*.db-shm`
- `audio-archive/`
- `dist/`
- `outputs/`
- `.env*`

## Railway Service

1. Create a Railway project from the GitHub repo.
2. Select Dockerfile deployment.
3. Add a Railway Volume mounted at `/data`.
4. Keep replicas at `1`.
5. Deploy.

Railway's generated HTTPS domain is enough for browser microphone access. Add a custom domain later if needed.

## Required Variables

```text
NODE_ENV=production
HOSTNAME=0.0.0.0
SESSION_COOKIE_SECURE=true
SPEAKING_LAB_DATA_DIR=/data/db
SPEAKING_LAB_AUDIO_DIR=/data/audio-archive
ENABLE_DEV_DIAGNOSTICS=false
```

For the sanitized demo database:

```text
DEMO_DATA_ENABLED=true
DEMO_ADMIN_PASSWORD=<set-a-private-password>
DEMO_TEACHER_PASSWORD=<set-a-private-password>
DEMO_STUDENT_PASSWORD=<set-a-private-password>
```

Do not use public default demo passwords online.

For external portal/API integration:

```text
APP_BASE_URL=https://your-railway-domain
INTEGRATION_API_KEY=<long-random-secret>
EXTERNAL_SSO_ENABLED=false
EXTERNAL_SSO_PROVIDER_ID=main-portal
EXTERNAL_SSO_ISSUER=https://portal.example.com
EXTERNAL_SSO_AUDIENCE=speaking-lab
EXTERNAL_SSO_SHARED_SECRET=<long-random-secret>
EXTERNAL_SSO_ALLOW_ADMIN=false
XAPI_ENABLED=false
XAPI_LRS_URL=https://YOUR_LRS/xapi/statements
XAPI_USERNAME=<basic-auth-user>
XAPI_PASSWORD=<basic-auth-password>
XAPI_SOURCE_APP=speaking-lab
XAPI_ACTOR_HOMEPAGE=https://saif.rsaf.mil
```

If you are not using portal SSO yet, keep `EXTERNAL_SSO_ENABLED=false`.

## AI And Speech Providers

The app can store provider keys from Admin -> AI & Speech. For Railway demos, configure:

- Azure Speech key + region for STT and pronunciation scoring.
- Azure/Foundry, Groq, Grok, or OpenAI key for AI feedback/conversation.
- Kokoro TTS remains bundled from `web/public/models`.

Do not commit provider keys to GitHub.

## First Login

With `DEMO_DATA_ENABLED=true`, the seed creates:

- Admin: `admin` / `DEMO_ADMIN_PASSWORD`
- Teacher: `teacher` / `DEMO_TEACHER_PASSWORD`
- Student: `1` / `DEMO_STUDENT_PASSWORD`

It also creates fake students, classes, attempts, weak words, fluency sessions, text practice, KLP sample data, KLP assignments, and published KLP scenarios for demonstration.

If `DEMO_DATA_ENABLED` is not set in production, no public default accounts are created. Use `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` to create one admin on an empty production database.

## Backups

Before every major deploy:

1. Stop new testing.
2. From the `web` directory, run `npm run backup:data`. This uses SQLite's online
   backup API, runs `PRAGMA integrity_check`, writes a SHA-256 file, and records an
   audio manifest without copying a live database file naively.
3. Run `npm run backup:restore-test -- <backup.db>` and require `integrity_check=ok`.
4. Create a Railway Volume Backup before deploying.
5. Retain the generated database backup, hash, metadata, and audio manifest together.

Restore by stopping the single app replica, mounting a fresh Railway Volume at
`/data`, verifying the backup hash, copying the verified backup to
`/data/db/speakinglab.db`, restoring the audio files represented by the manifest, and
then redeploying one replica. Run `PRAGMA integrity_check` and the login/practice smoke
tests before reopening the service. See `BACKUP_AND_RESTORE.md` for the full drill.

Keep SQLite on the Railway persistent volume, one replica, with the existing WAL mode
and busy timeout. Do not move the database file to Azure App Service shared storage or
Azure Files/SMB; use managed Postgres if the deployment shape later requires shared or
multi-replica storage.

## Verification Checklist

- `/api/health` returns `{ "ok": true }`.
- HTTPS login works for admin, teacher, and student.
- Student practice records attempts and survives redeploy.
- Teacher reports show demo progress and KLP evidence.
- Admin model settings save and survive redeploy.
- `/api/audio/*` rejects unauthenticated requests.
- `/api/dev/*` returns 404 unless `ENABLE_DEV_DIAGNOSTICS=true`.
