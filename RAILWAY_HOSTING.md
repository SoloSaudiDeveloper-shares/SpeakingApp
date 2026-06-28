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
2. Use Railway Volume Backups.
3. Also export `/data/db/speakinglab.db`, `/data/db/speakinglab.db-wal`, `/data/db/speakinglab.db-shm`, and `/data/audio-archive` if recordings are used.

Restore by mounting a fresh Railway Volume at `/data`, copying the DB/audio files back into the same paths, then redeploying the service.

## Verification Checklist

- `/api/health` returns `{ "ok": true }`.
- HTTPS login works for admin, teacher, and student.
- Student practice records attempts and survives redeploy.
- Teacher reports show demo progress and KLP evidence.
- Admin model settings save and survive redeploy.
- `/api/audio/*` rejects unauthenticated requests.
- `/api/dev/*` returns 404 unless `ENABLE_DEV_DIAGNOSTICS=true`.
