# SAIF ↔ Speaking Lab Connection Guide

**Implementation guide for SAIF and Speaking Lab programmers — 2026-07-30**

This guide explains how SAIF launches a pseudonymous learner into Speaking Lab and
how Speaking Lab returns assessed, KLP-addressed speaking evidence through xAPI.
It does not replace the pinned contracts:

- [`HANDOVER.md`](./HANDOVER.md)
- [`SAIF_xAPI_Integration_Profile.md`](./SAIF_xAPI_Integration_Profile.md), Profile v1.2
- [`SAIF_xAPI_Ingestion_Contract_v1.md`](./SAIF_xAPI_Ingestion_Contract_v1.md)
- [`DEPLOYMENT_DB_IDENTITY_NOTES.md`](./DEPLOYMENT_DB_IDENTITY_NOTES.md)

If this guide conflicts with a pinned contract, stop and resolve the difference
with both teams before enabling the integration.

## 1. What is already agreed

| Area | Agreed behaviour | Authority |
|---|---|---|
| System boundary | Speaking Lab keeps its own database and authentication. There is no shared SAIF database or auth store. | Deployment and identity notes §1 |
| Connection | SAIF uses a signed launch handshake; Speaking Lab emits xAPI to the shared LRS. | Handover and deployment notes |
| Identity boundary | The SAIF-facing learner identifier is the signed pseudonymous `sub`. Do not use or match real names or email addresses. | Deployment and identity notes §§3–4 |
| Actor IFI | Speaking Lab emits an account IFI whose `homePage` is `https://saif.rsaf.mil` and whose `name` is the same signed `sub`. | Profile §4 plus the Q1 implementation below |
| KLP evidence | Emit one statement for each explicitly assessed KLP result. Do not spread an aggregate score across undeclared KLPs. | Profile §§3 and 6; Handover §2 |
| Evidence verbs | Speaking Lab uses `answered`, `reviewed`, and `practiced` in the cases described below. | Profile §5.1 |
| Identifier namespace | KLP objects, SAIF-defined verbs, activity types, and extension keys use `https://saif.training`. The retired `saif.rsaf.mil` xAPI namespace is filtered from mastery. | 2026-07-20 re-issue; Profile §§3, 5, 6 and 9 |
| Source application | Speaking Lab sends `speaking-lab`. The dedicated LRS credential stamps the authoritative `authority`; the self-declared source remains non-reserved. | Profile §9 and the ingestion source gate |
| LRS transport | POST JSON statement arrays with Basic Auth and `X-Experience-API-Version: 1.0.3`. | Profile §2 and ingestion contract emitter reference |
| Ingestion | SAIF polls the LRS, resolves the actor, filters evidence, and writes mastery with `source="lrs_ingestion"`. | Ingestion contract |

## 2. Decisions that still require SAIF sign-off

The 2026-07-20 handoff gives the operational LRS endpoint and a dedicated,
write-only credential. It also says `speaking-tutor` in its cover note, while the
Profile in the same bundle reserves that value and the ingestion contract filters
reserved source applications. Speaking Lab therefore keeps the non-reserved
`speaking-lab` source label; the credential-stamped `authority` is the definitive
producer identity. If SAIF wants a different source label, it must re-issue a
consistent Profile and ingestion contract before cutover.

The supplied documents intentionally left Q1, Q2, and Q3 open. Speaking Lab has
implemented a secure pilot proposal for Q1, but SAIF must approve it before the
flags are enabled:

1. **Q1 launch protocol:** short-lived, one-use HS256 JWT sent to
   `GET /sso/launch?token=...`. The required claims and validation rules are in
   §5. This is a Speaking Lab pilot resolution, not a protocol prescribed by
   Profile v1.2.
2. **Q2 speaking-to-KLP map:** SAIF must supply or approve the valid DLI ALC
   `concept_id` values assigned to Speaking Lab activities. Unknown or
   context-only mappings remain suppressed.
3. **Q3 rich signals:** pronunciation, phoneme, fluency, pace, pause, and
   scenario signals remain a proposal in
   [`SPEAKING_RICH_SIGNAL_Q3_PROPOSAL.md`](./SPEAKING_RICH_SIGNAL_Q3_PROPOSAL.md).
   Speaking Lab emits Profile v1.2 core fields only until SAIF publishes the
   extension IRIs.

Do not invent Q2 identifiers or Q3 extension IRIs to make a test pass.

## 3. Team responsibilities

| SAIF team | Speaking Lab team | Joint approval |
|---|---|---|
| Supply the exact sandbox issuer and pseudonymous `sub` format. | Validate the launch signature, claims, age, role, and one-use `jti`. | Approve the Q1 handshake and actor account IFI. |
| Generate a unique `jti` and short expiry for every launch. | Link only by external identity or exact local code/username equal to `sub`. | Test direct login and SAIF launch against one local learner record. |
| Supply the KLP slice and valid concept IDs. | Emit only explicitly assessed, supported KLP results. | Approve Q2 mappings and thresholds. |
| Supply a scoped sandbox LRS writer credential securely. | Store integration secrets in Azure Key Vault and deliver through the xAPI outbox. | Run the LRS-to-mastery verification loop. |
| Map pseudonymous actors to SAIF users. | Show the emitted actor map to a Speaking Lab Admin. | Confirm no real PII crosses the boundary. |
| Publish any approved rich-signal extension IRIs. | Keep rich signals local until they are published. | Agree Q3 incrementally. |

## 4. Preflight worksheet

Record values in the teams' approved secret/configuration systems, not in this
file, tickets, screenshots, or chat.

| Value | Owner | Secret? | Required before |
|---|---|---:|---|
| Speaking Lab public HTTPS origin | Speaking Lab | No | launch test |
| `EXTERNAL_SSO_PROVIDER_ID` (recommended `saif`) | Joint | No | launch test |
| `EXTERNAL_SSO_ISSUER` | SAIF | No | launch test |
| `EXTERNAL_SSO_AUDIENCE` (`speaking-lab`) | Joint | No | launch test |
| `EXTERNAL_SSO_SHARED_SECRET` (at least 32 random bytes) | Joint | Yes | launch test |
| Pseudonymous `sub` format and fixture codes | SAIF | Sensitive identifier | identity test |
| SAIF actor homepage (`https://saif.rsaf.mil`) | Joint | No | xAPI test |
| Approved speaking `concept_id` fixture | SAIF | No | evidence test |
| Sandbox LRS statements endpoint | SAIF | No | delivery test |
| LRS writer username and password | SAIF | Yes | delivery test |
| SAIF sandbox Admin access | SAIF | Yes | ingestion verification |

## 5. Step 1 — configure and test the signed launch

### 5.1 Required token shape

SAIF creates an HS256 JWT with:

```json
{
  "iss": "SAIF_ISSUER_AGREED_BY_BOTH_TEAMS",
  "aud": "speaking-lab",
  "sub": "PSEUDONYMOUS_SAIF_LEARNER_CODE",
  "role": "Student",
  "displayName": "Pseudonymous learner label",
  "iat": 1800000000,
  "exp": 1800000060,
  "jti": "NEW_RANDOM_IDENTIFIER_FOR_THIS_LAUNCH",
  "redirectTo": "/dashboard"
}
```

Rules enforced by Speaking Lab:

- HS256 only.
- Exact configured issuer and audience.
- `sub`, `role`, `displayName`, `iat`, `exp`, and `jti` are required.
- The token may be no more than 120 seconds old and no more than 30 seconds in
  the future. A 60-second expiry is recommended.
- A `(provider, jti)` pair is accepted once. Reservation and account/session
  creation occur in one database transaction.
- `Student` and `Teacher` are allowed. External `Admin` launch remains disabled.
- `redirectTo` must be a local non-API path; otherwise Speaking Lab uses
  `/dashboard`.

`displayName` is a learner-facing pseudonymous label. It is not an identity key.
Optional `email` and `studentNumber` claims are never used for SAIF account
linking and should be omitted for the trial.

### 5.2 SAIF-side reference code

This is illustrative Python. Keep the real secret in SAIF's secret store and
never print the token or complete launch URL.

```python
import os
import time
import uuid
from urllib.parse import urlencode

import jwt


def speaking_lab_launch_url(learner_code: str) -> str:
    now = int(time.time())
    payload = {
        "iss": os.environ["SPEAKING_LAB_SSO_ISSUER"],
        "aud": "speaking-lab",
        "sub": learner_code,
        "role": "Student",
        "displayName": f"Learner {learner_code}",
        "iat": now,
        "exp": now + 60,
        "jti": str(uuid.uuid4()),
        "redirectTo": "/dashboard",
    }
    token = jwt.encode(
        payload,
        os.environ["SPEAKING_LAB_SSO_SHARED_SECRET"],
        algorithm="HS256",
    )
    return (
        os.environ["SPEAKING_LAB_ORIGIN"].rstrip("/")
        + "/sso/launch?"
        + urlencode({"token": token})
    )
```

Redirect the learner immediately. Do not send this URL through analytics, link
shorteners, email, or support logs. Speaking Lab returns `Cache-Control:
no-store`, `Referrer-Policy: no-referrer`, and a secure `HttpOnly` session
cookie. The launch JWT is short-lived and one-use; it is not the session token.

### 5.3 Speaking Lab account resolution

After signature and replay validation, Speaking Lab resolves in this order:

1. Existing `(provider, sub)` external identity.
2. Exact local student number/username equal to the signed `sub`.
3. One newly created account keyed by the code.

It never matches by name or email. A linked learner who later signs in directly
uses the same local account and therefore the same xAPI actor IFI.

## 6. Step 2 — configure Azure without exposing secrets

Both [`infra/trial.bicep`](../infra/trial.bicep) and
[`infra/main.bicep`](../infra/main.bicep) support the integration. Their defaults
keep both paths disabled. Partial configuration also fails closed to disabled.

The reviewed deployment supplies:

```text
externalSsoEnabled
externalSsoProviderId
externalSsoIssuer
externalSsoAudience
externalSsoSharedSecret          # secure deployment parameter
xapiEnabled
xapiLrsUrl
xapiUsername                     # secure deployment parameter
xapiPassword                     # secure deployment parameter
```

The templates place secret values in these Key Vault secrets and reference them
from Container Apps:

```text
speaking-lab-external-sso-shared-secret
speaking-lab-xapi-username
speaking-lab-xapi-password
```

Do not place secret values in a committed parameter file or inline shell
arguments. Supply secure parameters through the protected deployment workflow
or Azure's authenticated deployment form. Run a Bicep what-if with flags off,
review it, deploy the configuration, verify health, and only then enable one
integration at a time.

## 7. Step 3 — approve KLP mappings and generate evidence

Speaking Lab creates one outbox statement for each explicitly assessed,
supported KLP result:

- ordinary spoken response → `answered`
- scheduled review → `reviewed`
- scenario role-play → `practiced`

It does not emit:

- listening exposure;
- an aggregate monologue without a named KLP;
- context-only or unassessed links;
- unknown or unsupported KLPs.

If one assessed attempt legitimately measures three approved KLPs, it creates
three statements with the actual result for each KLP. It does not copy one
undeclared aggregate across them.

## 8. Step 4 — inspect the exact xAPI statement

A Speaking Lab core statement has this shape:

```json
{
  "id": "DETERMINISTIC_UUID",
  "actor": {
    "objectType": "Agent",
    "account": {
      "homePage": "https://saif.rsaf.mil",
      "name": "PSEUDONYMOUS_SAIF_LEARNER_CODE"
    }
  },
  "verb": {
    "id": "http://adlnet.gov/expapi/verbs/answered",
    "display": { "en-US": "answered" }
  },
  "object": {
    "objectType": "Activity",
    "id": "https://saif.training/klp/dli_alc/APPROVED_CONCEPT_ID",
    "definition": {
      "type": "https://saif.training/activity-types/klp"
    }
  },
  "result": {
    "success": true,
    "score": { "scaled": 0.84 }
  },
  "context": {
    "extensions": {
      "https://saif.training/extensions/skill": "speaking",
      "https://saif.training/extensions/source-app": "speaking-lab"
    }
  },
  "timestamp": "2026-07-30T00:00:00.000Z"
}
```

The score is the actual composite or scenario score scaled to `0..1`, not a
binary 0/100 summary. The statement ID is deterministic, so retries are
idempotent.

## 9. Step 5 — deliver through the outbox

Speaking Lab queues evidence transactionally and a scheduled worker claims at
most 100 rows using PostgreSQL row locks. Learner requests do not wait for the
LRS. The worker sends:

```http
POST SAIF_LRS_STATEMENTS_ENDPOINT
Authorization: Basic BASE64_OF_SCOPED_WRITER_CREDENTIAL
Content-Type: application/json
X-Experience-API-Version: 1.0.3
```

The body is a JSON array, even when it contains one statement. Failures receive
capped exponential retry with jitter, stale-lock recovery, and Admin-visible
status. Never log the Authorization header or its decoded value.

Speaking Lab Admin endpoints:

```text
GET  /api/admin/integrations/xapi/status
POST /api/admin/integrations/xapi/retry
GET  /api/admin/integrations/xapi/actor-map
```

These require a Speaking Lab Admin session and never return the LRS password.

## 10. Step 6 — map the actor and verify SAIF ingestion

With both systems pointed at sandbox services:

1. Launch one pseudonymous fixture learner from SAIF.
2. Confirm direct login and SAIF launch resolve to one Speaking Lab account.
3. In Speaking Lab's actor-map view, confirm the account IFI contains only the
   expected homepage and signed `sub`.
4. Complete one assessed activity mapped to one approved sandbox KLP.
5. Confirm one pending outbox statement and inspect its actor, verb, object,
   score, source, and deterministic ID.
6. Run the xAPI worker and confirm the LRS accepts it.
7. In SAIF, call `POST /api/admin/ingestion/trigger`.
8. Inspect
   `GET /api/admin/ingestion/log?result=applied|filtered|unresolved_actor`.
9. If unresolved, call `GET /api/admin/ingestion/unresolved`, then:

   ```http
   POST /api/admin/ingestion/actors/map
   Content-Type: application/json

   {
     "external_identifier": "PSEUDONYMOUS_SAIF_LEARNER_CODE",
     "saif_user_id": "APPROVED_SANDBOX_USER_ID",
     "identifier_type": "account"
   }
   ```

10. Trigger ingestion again and inspect `GET /api/admin/ingestion/status`.
11. Confirm the intended KLP mastery changed with
    `source="lrs_ingestion"`.
12. Re-send the same statement ID and confirm SAIF reports it as a duplicate
    without applying mastery twice.

The actor-map request shape must be reconfirmed against the running SAIF
sandbox and its pinned ingestion contract before use.

## 11. Acceptance and security checklist

- [ ] SAIF approved the HS256 Q1 pilot or supplied a reviewed replacement.
- [ ] The signing secret is different from every LRS, application, and job secret.
- [ ] Both teams use the exact issuer, audience, provider ID, and actor homepage.
- [ ] Launch fixtures contain pseudonymous codes, not names or email addresses.
- [ ] Expired, future, tampered, replayed, wrong-issuer, and wrong-audience tokens fail.
- [ ] A replay cannot create, reactivate, or relabel an account.
- [ ] External Admin launch remains disabled.
- [ ] Q2 concept IDs came from SAIF and multi-KLP fan-out is justified.
- [ ] Unassessed, context-only, aggregate, and unknown-KLP evidence is suppressed.
- [ ] `source-app` is exactly `speaking-lab`.
- [ ] Every SAIF-owned xAPI IRI uses `https://saif.training`, never the retired namespace.
- [ ] LRS credentials have only the required write scope and live in Key Vault.
- [ ] Logs, HTTP errors, reports, builds, images, and workflow artifacts contain no secrets.
- [ ] LRS POST → ingestion → actor map → mastery succeeds in sandbox.
- [ ] Duplicate delivery does not duplicate mastery.
- [ ] Q3 fields remain local until Profile IRIs are published.

## 12. Cutover and rollback

Enable in this order:

1. Deploy all code and Key Vault references with `externalSsoEnabled=false` and
   `xapiEnabled=false`.
2. Back up PostgreSQL and verify application health.
3. Enable SSO for sandbox fixtures only; complete identity and replay tests.
4. Keep xAPI disabled while Q2 mappings and the actor map are verified.
5. Enable xAPI against the sandbox LRS; complete the round trip above.
6. Obtain joint sign-off before moving from sandbox to the trial cohort.

If identity, actor resolution, or ingestion is wrong:

1. Set the affected enable flag to `false`.
2. Do not delete pending outbox evidence.
3. Preserve statement IDs and Admin-visible failure details.
4. Correct configuration or mappings through a reviewed change.
5. Re-enable in sandbox and retry only after the cause is understood.

Disabling xAPI stops delivery without blocking learners or losing the queued
evidence. Disabling SSO does not disable the app's direct-login path.
