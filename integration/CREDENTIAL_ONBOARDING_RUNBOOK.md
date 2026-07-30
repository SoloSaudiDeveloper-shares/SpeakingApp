# Speaking Lab Credential Onboarding Runbook

## Purpose

This runbook explains how to add the credentials that were intentionally excluded from the SQLite migration and Azure deployment:

- Groq API key
- Azure AI / Microsoft Foundry endpoint, deployment, and API key
- Azure Speech key and region
- SAIF LRS URL and Basic Auth credentials

Do not add any real secret until the old credential has been rotated. This file contains secret names and procedures only. It must never contain a real password, API key, token, connection string, or copied secret value.

## Current production boundary

- Provider secrets entered through the Speaking Lab Admin UI are written by the application's managed identity to Azure Key Vault.
- Provider APIs return only `configured` status or the fixed mask `••••••••`; they do not return stored values.
- Only an authenticated Admin can create, replace, test, or clear provider credentials.
- Non-secret provider choices, endpoints, deployment names, and regions are stored as application settings.
- Real SAIF LRS credentials are not yet connected to the Container App. They must be added through the infrastructure deployment described in the SAIF section, not as untracked portal-only environment variables.

## Rules that apply to every credential

1. Rotate or create a new credential at the provider first.
2. Never paste a secret into source files, `.env.example`, GitHub, a pull request, an issue, chat, screenshots, logs, migration reports, shell command arguments, or deployment output.
3. Prefer the Speaking Lab Admin UI for Groq, Azure AI, and Azure Speech. It sends the value directly to the server, which stores it in Key Vault.
4. Use Key Vault-backed Container App secret references for infrastructure credentials such as the SAIF LRS password.
5. Test the new credential before revoking the old one when a safe overlap is available.
6. After successful testing, revoke the old credential and record only the provider, owner, rotation date, and next review date. Do not record the value.
7. If a credential is accidentally exposed, revoke or rotate it first. Remove the source next. Rewrite Git history only if a genuine secret was committed.

## Access prerequisites

Use an Azure account with only the permissions needed for the task:

- `Key Vault Secrets User` can read secret values.
- `Key Vault Secrets Officer` can create, replace, and manage secret values.
- The Speaking Lab runtime managed identity must retain its existing Key Vault secret access.

The vault firewall uses default-deny networking. The application reaches the vault through its approved Azure network path. A laptop must not be left permanently open to the vault.

### Temporary portal access from an administrator laptop

If the Azure portal says:

> Firewall is turned on and your client IP address is not authorized to access this key vault.

the browser's current public IP no longer matches an allowed vault rule. This is a network restriction, not a wrong password.

1. Confirm the laptop is on a trusted connection and is not using an unexpected VPN or proxy.
2. Add only the laptop's current public IP as a single `/32` Key Vault firewall rule.
3. Refresh the Key Vault **Secrets** page. Use `Ctrl+F5` if the portal cached the error.
4. Complete the required secret operation.
5. Remove the laptop `/32` rule immediately afterward.
6. Confirm the vault still has `Default action: Deny` and only the intended Azure application network remains allowed.

If the page then reports an authorization error rather than a firewall error, verify the signed-in Azure identity has the appropriate Key Vault RBAC role at the vault scope. RBAC changes can take several minutes to propagate.

## Bootstrap Admin password

The one-time production Admin password is stored in Key Vault as:

`bootstrap-admin-password`

To use it:

1. In Azure Portal, open `speakinglab-kv-20260729`.
2. Open **Objects → Secrets → bootstrap-admin-password**.
3. Open the current enabled version.
4. Select **Show Secret Value**.
5. Sign in to Speaking Lab as the bootstrap Admin.
6. Complete the forced password change immediately.
7. Sign out, sign back in with the new password, and confirm Admin access.
8. Remove the temporary laptop `/32` firewall rule.

Never save the bootstrap value in a browser password note, text file, screenshot, terminal history, or this repository. Once the forced change succeeds, the Key Vault bootstrap value is historical deployment material and must not be reused as the account password.

## Groq

### Obtain and rotate

1. Sign in to the [Groq API Keys console](https://console.groq.com/keys).
2. Revoke any key that may have been present in the old SQLite database or exposed elsewhere.
3. Create a new key specifically for the Speaking Lab Azure trial.
4. Copy it only for the immediate Admin UI entry; do not save it in a local file.

### Add to Speaking Lab

1. Sign in as Admin.
2. Open **Admin → Models → AI Models**, or go to `/admin/models/ai`.
3. Select **Groq**.
4. Enter the new value in **Groq API key**.
5. Select the required Groq model. The application's current compatibility default is `llama-3.3-70b-versatile`.
6. Save the settings.
7. Run the page's provider test and require a successful response.
8. If Groq Whisper will be used, open **Admin → Models → Speech Recognition** (`/admin/models/stt`), activate **Groq Whisper**, and run a short transcription test.

### Production storage mapping

| Application setting | Key Vault secret | Notes |
|---|---|---|
| `groq_api_key` | `speaking-lab-groq-api-key` | Secret; written through the Admin UI |
| `groq_model` | Not a secret | Stored in application settings |
| `groq_stt_model` | Not a secret | Current default is `whisper-large-v3-turbo` |

## Azure AI / Microsoft Foundry

Azure AI chat and Azure Speech are separate resources and use separate credentials.

### Create or rotate the Azure AI credential

1. Open [Microsoft Foundry](https://ai.azure.com/) and select the intended Azure AI resource/project.
2. Deploy a compatible chat model. Use the deployment name, not merely the catalog model name, in Speaking Lab.
3. Copy the resource endpoint. Speaking Lab accepts a base endpoint such as:
   - `https://<resource>.openai.azure.com`
   - `https://<resource>.services.ai.azure.com`
4. Regenerate or rotate the resource key before use if an older key may have been stored in SQLite.
5. Keep the endpoint and deployment name as non-secret configuration. Treat the API key as a secret.

### Add to Speaking Lab

1. Sign in as Admin.
2. Open **Admin → Models → AI Models** (`/admin/models/ai`).
3. Select **Azure / Foundry**.
4. Enter:
   - **Endpoint**: the Azure AI resource endpoint
   - **API key**: the newly rotated key
   - **Deployment name**: the exact deployed model name
   - **API version**: leave `v1` unless a tested legacy deployment specifically requires something else
5. Save the settings.
6. Run the provider test and require a successful short response.
7. Exercise one feedback request and one scenario conversation before making Azure AI the pilot default.

Speaking Lab normalizes the supplied endpoint to the OpenAI-compatible `/openai/v1` API. A small compatible deployment such as `gpt-4o-mini` is the current low-cost application recommendation; verify current Azure availability and pricing before deployment.

### Production storage mapping

| Application setting | Key Vault secret | Notes |
|---|---|---|
| `azure_api_key` | `speaking-lab-azure-api-key` | Secret; written through the Admin UI |
| `azure_endpoint` | Not a secret | Stored in application settings |
| `azure_model` | Not a secret | Exact Foundry deployment name |
| `azure_api_version` | Not a secret | `v1` for the current compatible path |

## Azure Speech

### Create or rotate

1. In Azure Portal, open or create the intended **Speech service** resource.
2. Record its Azure region exactly, for example `uksouth` or `westeurope`.
3. Regenerate Key 1 or Key 2 if an older key may have been stored in SQLite.
4. Copy the new key only for the immediate Admin UI entry.

Azure Speech keys are region-scoped. A correct key paired with the wrong region will fail authentication.

### Add to Speaking Lab

1. Sign in as Admin.
2. Open **Admin → Models → Speech Recognition** (`/admin/models/stt`).
3. In **Azure Speech key**, enter the newly rotated key.
4. In **Region**, enter the Speech resource's exact region identifier.
5. Select **Save Azure key**.
6. Select **Test Azure Speech** and require the “reachable” result.
7. If Azure Speech should transcribe learner audio, activate **Azure Speech (cloud)**.
8. Run both:
   - a normal speech-to-text attempt; and
   - a reference-text pronunciation attempt that displays Azure word/phoneme detail.

The same credential powers Azure Speech-to-text and phoneme-level pronunciation assessment. If it is unavailable, the app must continue to show the honest basic-transcript-scoring fallback.

### Production storage mapping

| Application setting | Key Vault secret | Notes |
|---|---|---|
| `azure_speech_key` | `speaking-lab-azure-speech-key` | Secret; written through the Admin UI |
| `azure_speech_region` | Not a secret | Must match the Speech resource |

## SAIF LRS

The 2026-07-20 re-issued handoff supplied a dedicated write-only LRS credential and
the corrected `https://saif.training` identifier namespace. Do not record the
credential value in this file or in deployment output.
Follow the joint programmer sequence in
[`SAIF_SPEAKING_LAB_CONNECTION_GUIDE.md`](./SAIF_SPEAKING_LAB_CONNECTION_GUIDE.md);
this section focuses on credential handling.

### Request from SAIF

Obtain all of the following through an approved secure channel:

- Stable LRS statements endpoint (received in the 2026-07-20 handoff)
- Unique Basic Auth username with `statements/write` scope (received)
- Basic Auth password (received separately; store only in Key Vault)
- Confirmation that the actor account homepage remains `https://saif.rsaf.mil`
- Confirmation that `speaking-lab` remains the accepted source application
- Signed launch/SSO test inputs and the pseudonymous `sub` format
- Speaking-to-KLP mapping slice and valid concept IDs
- SAIF sandbox administrator access for the ingestion verification loop

Never request or accept learner names or personal email addresses for the SAIF trial identity link. The signed pseudonymous `sub` is the identity boundary.

### Infrastructure onboarding

The current release intentionally leaves the real LRS disabled. Before adding credentials:

1. Add Key Vault secrets for the LRS username and password through the reviewed Bicep deployment.
2. Add Key Vault-backed Container App secret references; do not type the password into a plain Container App environment-value field.
3. Supply the URL and enable flag as reviewed deployment configuration.
4. Deploy a new immutable image/revision through GitHub Actions.
5. Confirm readiness and app smoke tests before enabling the scheduled xAPI worker.

The application expects:

| Configuration | Required production value | Classification |
|---|---|---|
| `XAPI_ENABLED` | `true` only at controlled cutover | Non-secret |
| `XAPI_LRS_URL` | SAIF statements endpoint | Configuration; manage through deployment |
| `XAPI_USERNAME` | SAIF-issued writer username | Secret |
| `XAPI_PASSWORD` | SAIF-issued writer password | Secret |
| `XAPI_SOURCE_APP` | `speaking-lab` | Non-secret, pinned |
| `XAPI_ACTOR_HOMEPAGE` | `https://saif.rsaf.mil` | Non-secret, pinned |

The dedicated LRS credential supplies the definitive xAPI `authority`. The
2026-07-20 handoff cover note says `speaking-tutor`, but Profile v1.2 in the same
bundle lists that source-app value as reserved. Until SAIF re-issues those two
instructions consistently, keep `XAPI_SOURCE_APP=speaking-lab` so ingestion does
not filter the evidence.

Use stable Key Vault names in the infrastructure change:

- `speaking-lab-xapi-username`
- `speaking-lab-xapi-password`

The existing `speaking-lab-xapi-job-token` is an internal scheduler-to-app authentication token. It is not an LRS credential and must not be replaced with the SAIF password.

### SAIF validation and cutover

1. Keep `XAPI_ENABLED=false` while configuration is deployed.
2. Validate a signed SAIF launch fixture:
   - external identity is resolved first;
   - only the signed pseudonymous `sub` is used;
   - direct and SAIF-launched activity use the same actor account IFI.
3. Enable the integration in the sandbox.
4. Complete one explicitly assessed, mapped KLP attempt.
5. Confirm one deterministic statement appears in the Speaking Lab xAPI outbox.
6. Run the xAPI worker and confirm the LRS accepts the batch with:
   - Basic Auth
   - `Content-Type: application/json`
   - `X-Experience-API-Version: 1.0.3`
   - no more than 100 statements
7. In SAIF, trigger ingestion:
   - `POST /api/admin/ingestion/trigger`
8. Inspect:
   - `GET /api/admin/ingestion/log?result=applied|filtered|unresolved_actor`
   - `GET /api/admin/ingestion/unresolved`
   - `GET /api/admin/ingestion/status`
9. If the actor is unresolved, add the pseudonymous actor mapping through the SAIF Admin actor-map workflow and rerun ingestion.
10. Confirm the intended KLP mastery record changed with `source="lrs_ingestion"`.
11. Verify duplicate delivery does not create duplicate mastery evidence.
12. Verify unmapped, context-only, listening-only, and unassessed activity does not emit mastery evidence.
13. Only after the sandbox round trip passes, repeat the controlled procedure for the trial endpoint.

## Replacement and rollback procedure

For Groq, Azure AI, or Azure Speech:

1. Create or rotate to a new provider key.
2. Enter it in the appropriate Speaking Lab Admin page.
3. Save and run the built-in provider test.
4. Run one representative learner workflow.
5. Revoke the old provider key.
6. If the new key fails, restore the previous still-valid key through the Admin UI, investigate without logging values, and repeat with a newly rotated credential.

For SAIF:

1. Keep the previous Container App revision available.
2. Disable `XAPI_ENABLED` if authentication, actor resolution, or ingestion behaves unexpectedly.
3. Do not delete pending outbox rows.
4. Correct the Key Vault-backed configuration through Bicep and deploy a reviewed revision.
5. Use the Admin xAPI status/retry controls only after the configuration test passes.

## Final onboarding checklist

- [ ] Old Groq key revoked; new Groq chat test passed
- [ ] Groq Whisper transcription test passed if selected
- [ ] Old Azure AI key revoked; Foundry provider test passed
- [ ] Old Azure Speech key revoked; region matches and Azure Speech test passed
- [ ] Pronunciation phoneme detail verified
- [ ] No credential appears in Git, logs, responses, screenshots, reports, or artifacts
- [ ] Key Vault returns only masked/configured status through the application
- [ ] SAIF LRS values came from an approved secure channel
- [ ] SAIF actor uses only the signed pseudonymous `sub`
- [ ] Sandbox LRS → ingestion → actor map → mastery round trip passed
- [ ] Duplicate and suppression tests passed
- [ ] Temporary laptop Key Vault firewall rule removed
- [ ] Rotation dates and owners recorded without secret values

## Pinned local authority

The implementation must continue to follow:

- [HANDOVER.md](./HANDOVER.md)
- [SAIF xAPI Integration Profile v1.2](./SAIF_xAPI_Integration_Profile.md)
- [SAIF xAPI Ingestion Contract v1](./SAIF_xAPI_Ingestion_Contract_v1.md)

Useful official references:

- [Azure Key Vault network security](https://learn.microsoft.com/azure/key-vault/general/network-security)
- [Azure Key Vault RBAC guide](https://learn.microsoft.com/azure/key-vault/general/rbac-guide)
- [Microsoft Foundry endpoints](https://learn.microsoft.com/azure/foundry/foundry-models/concepts/endpoints)
- [Azure Speech supported regions](https://learn.microsoft.com/azure/ai-services/speech-service/regions)
- [Azure Speech authentication and RBAC](https://learn.microsoft.com/azure/ai-services/speech-service/role-based-access-control)
