# Security operations

## Secret boundary

- Production secrets live in Azure Key Vault and are read or replaced with the user-assigned
  managed identity. Its Secrets Officer role cannot manage Key Vault permissions.
- Provider APIs return only configured state or the fixed mask `••••••••`.
- Local secret persistence is AES-256-GCM encrypted and requires `SETTINGS_ENCRYPTION_KEY`.
- Exact standalone CI may set `ALLOW_LOCAL_ENCRYPTED_SECRET_STORE=true`; Azure production
  must never set it and fails closed when `AZURE_KEY_VAULT_URL` is absent.
- `.env`, databases, dumps, audio, certificates, and private keys are excluded from Git and Docker contexts.
- Session cookies contain random tokens, but PostgreSQL stores only SHA-256 token hashes.

## Repository controls

Run `npm run security:secrets` from `web` before publishing. GitHub Actions scans full
history on pull requests and protected-branch pushes with redacted output. In GitHub
Settings → Code security, enable secret scanning and push protection and do not permit
unexplained bypasses.

If a real secret is found:

1. Revoke or rotate it first.
2. Remove the source and replace it with a Key Vault reference.
3. Check logs, artifacts, images, backups, and downstream systems.
4. Rewrite Git history only when the secret genuinely exists in historical commits.
5. Force consumers to refresh credentials and document the incident.

Before Azure cutover, rotate the previously configured Groq, Azure AI, and Azure Speech
credentials. Do not copy values from the SQLite backup. Store only the rotated values in
Key Vault.
