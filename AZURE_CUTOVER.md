# Azure setup and cutover

This runbook keeps `main` untouched until the `codex/postgres-azure` pull request passes
all release gates.

## 1. Workstation prerequisites

Install Docker Desktop with administrator approval, Node 24 LTS, Git, Azure CLI, Bicep, and
PostgreSQL 17 client tools. From the repository root:

```powershell
docker compose up -d postgres azurite migrate app
```

Create demo users only when needed by setting the three `DEMO_*_PASSWORD` values and
running `npm run db:seed` from `web`.

## 2. Azure and OIDC

1. Create an empty UK South resource group.
2. Create a Microsoft Entra application/federated credential restricted to this repository,
   the `main` branch, and the GitHub `production` environment.
3. Grant the deployment identity Contributor on the resource group and permission to assign
   the three narrowly scoped runtime roles declared by Bicep. The application identity receives
   Key Vault Secrets Officer because the Admin settings UI can create, replace, and clear provider
   keys; it cannot manage Key Vault permissions.
4. Set GitHub environment variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_ACR_NAME`,
   `AZURE_CONTAINER_APP`, `AZURE_MIGRATION_JOB`, `AZURE_XAPI_JOB`, and
   `AZURE_BACKUP_JOB`.

## 3. Provision infrastructure

Generate strong one-time PostgreSQL, bootstrap-admin, and job-token values locally. Do not
put them in GitHub:

```powershell
$env:POSTGRES_ADMIN_PASSWORD = "<generated>"
$env:BOOTSTRAP_ADMIN_PASSWORD = "<generated>"
$env:XAPI_JOB_TOKEN = "<generated>"
az login
az deployment group create `
  --resource-group <resource-group> `
  --template-file infra/main.bicep `
  --parameters infra/main.bicepparam
```

The template creates one always-ready 1-vCPU/2-GiB Container App, PostgreSQL 17
`Standard_B1ms` with 32 GiB and 14-day PITR, private Blob Storage, ACR Basic, Key Vault,
Log Analytics, and migration/xAPI/backup jobs. PostgreSQL and Blob traffic stay private.

## 4. Rotate and configure providers

Rotate Groq, Azure AI, and Azure Speech keys. Add only the rotated values through the Admin
settings UI or `az keyvault secret set`. Configure xAPI Basic Auth and SSO signing values as
Key Vault-backed Container Apps secrets. Keep `XAPI_ENABLED=false` until the sandbox round
trip passes.

## 5. Import the verified SQLite release

First prove the conversion locally; this never changes the immutable SQLite backup:

```powershell
$env:DATABASE_URL = "postgresql://<local-user>:<password>@127.0.0.1:5432/<empty-db>"
$env:DATABASE_SSL_MODE = "disable"
$env:AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true"
$env:MIGRATION_BOOTSTRAP_ADMIN_PASSWORD = "<16+-character one-time value>"
npm run db:migrate
npm run migrate:sqlite -- --source <verified.db> --report <report.json>
npm run db:check
$env:BACKUP_DIR = "<private-backup-folder>"
npm run backup:data
npm run backup:restore-test
```

The importer refuses a non-empty target, preserves explicit IDs, resets sequences, excludes
sessions/FTS/expired replay rows/plaintext provider credentials, secures weak accounts, uploads
available audio, and records missing attempt IDs in the reconciliation report.

For Azure, the recommended one-time route is an approved point-to-site VPN into the deployed
VNet. Keep PostgreSQL and Blob public access disabled. After the VPN resolves the private
PostgreSQL and Blob endpoints:

1. Temporarily grant the importing operator `Storage Blob Data Contributor` on the storage
   account; do not grant shared-key access.
2. Run `az login`, then set `DATABASE_URL` to the empty Azure database,
   `DATABASE_SSL_MODE=require`, `AZURE_STORAGE_ACCOUNT_URL` to the private account URL,
   `AZURE_AUDIO_CONTAINER=speaking-audio`, `MIGRATE_AUDIO_DIR` to the restored local audio
   folder, and the one-time `MIGRATION_BOOTSTRAP_ADMIN_PASSWORD`.
3. Run `npm ci`, `npm run db:migrate`, the importer command above, and `npm run db:check`.
   `DefaultAzureCredential` uses the operator's Azure CLI login for Blob uploads; PostgreSQL
   receives only blob object keys.
4. Review the reconciliation report outside the repository. Require zero relationship errors,
   zero imported sessions, the documented exclusion counts, correct sequence resets, and an
   explicit decision for every missing audio attempt ID.
5. Create and restore-test a PostgreSQL dump, compare representative application records, then
   remove the operator's temporary Blob role and clear all migration environment variables.

If point-to-site VPN is not available, use a disposable no-public-IP runner inside the VNet
with the same commands and narrowly scoped managed identity, transfer the backup through an
approved private channel, then delete the runner and its disk. Do not bake the SQLite database,
audio, credentials, or importer into the application/jobs images or a public CI artifact.

## 6. Release and smoke tests

After the `PostgreSQL release gates` workflow succeeds for `main`, the deployment workflow
checks out that exact tested SHA, builds immutable images, pushes them to ACR, runs a logical
backup, executes migrations, deploys one new revision, checks `/api/health/ready`, and restores
the prior image on failure. A failing or incomplete CI run cannot trigger deployment.

Before DNS cutover verify Admin/Teacher/Student authorization, forced password changes,
Practice/Progress tabs, pathway unlocking, scenario finish behavior, 90-second speech capture,
private recording playback, signed SSO, actor mapping, and mock-LRS xAPI delivery. Then add
the custom domain/certificate and change DNS with a short TTL.

## 7. SAIF and rollback gates

The real LRS → ingestion trigger → applied/unresolved log → actor map → mastery round trip
remains mandatory once SAIF sandbox credentials are supplied. Until then, keep the mock-LRS
test and `XAPI_ENABLED=false`.

For application failure, redeploy the recorded prior image. For data failure, restore PITR or
the logical dump into a new database and follow `BACKUP_AND_RESTORE.md`; do not run destructive
down migrations against the live database.
