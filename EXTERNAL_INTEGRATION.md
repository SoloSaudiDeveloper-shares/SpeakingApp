# External Portal Integration

This app can run standalone with its built-in login, or a custom portal can launch users into it with a short-lived signed JWT.

For the joint SAIF programmer handover, contract traceability, sandbox verification,
and Azure cutover sequence, use
[`integration/SAIF_SPEAKING_LAB_CONNECTION_GUIDE.md`](integration/SAIF_SPEAKING_LAB_CONNECTION_GUIDE.md).
The present document is the generic application interface reference.

## SSO Launch

Portal link:

```text
https://YOUR_SPEAKING_APP/sso/launch?token=JWT_HERE
```

Required environment variables:

```text
EXTERNAL_SSO_ENABLED=true
EXTERNAL_SSO_PROVIDER_ID=main-portal
EXTERNAL_SSO_ISSUER=https://portal.example.com
EXTERNAL_SSO_AUDIENCE=speaking-lab
EXTERNAL_SSO_SHARED_SECRET=replace-with-long-random-secret
EXTERNAL_SSO_ALLOW_ADMIN=false
INTEGRATION_API_KEY=replace-with-long-random-api-key
```

JWT requirements:

- Algorithm: `HS256`
- Required claims: `iss`, `aud`, `sub`, `role`, `displayName`, `iat`, `exp`, `jti`
- Allowed roles: `Student`, `Teacher`; `Admin` only when `EXTERNAL_SSO_ALLOW_ADMIN=true`
- Max age: 2 minutes from `iat`
- `jti` can only be used once
- Optional claims: `email`, `studentNumber`, `className`, `classId`, `redirectTo`

For SAIF launches, `sub` is the only account-linking key. The app first resolves an
existing external identity, then a local student number/username equal to `sub`, and
finally creates one code-keyed account if no match exists. It never links SAIF users
by display name or email. Send the pseudonymous SAIF learner code in `sub`; do not put
real names or email addresses in SAIF cohort xAPI statements.

Example payload:

```json
{
  "iss": "https://portal.example.com",
  "aud": "speaking-lab",
  "sub": "student-123",
  "role": "Student",
  "displayName": "Layla Hassan",
  "studentNumber": "1001",
  "className": "A1 Morning",
  "iat": 1800000000,
  "exp": 1800000060,
  "jti": "unique-launch-id",
  "redirectTo": "/dashboard"
}
```

## Integration APIs

All integration APIs require:

```text
Authorization: Bearer YOUR_INTEGRATION_API_KEY
```

Endpoints:

```text
GET  /api/integrations/health
POST /api/integrations/roster/upsert
GET  /api/integrations/students/:provider/:subject/summary
```

Roster upsert body can be one user or `{ "users": [...] }`:

```json
{
  "subject": "student-123",
  "role": "Student",
  "displayName": "Layla Hassan",
  "studentNumber": "1001",
  "className": "A1 Morning"
}
```

Student summary returns local IDs, CEFR, diagnostic profile, active cycle, weak-word count, recent attempts, and progress stats. Raw audio is not exposed.

## SAIF xAPI Outbox

The Speaking Tutor keeps its own database. SAIF integration is limited to the signed
launch handshake and xAPI statements sent to the SAIF LRS. Configure:

```text
XAPI_ENABLED=true
XAPI_LRS_URL=https://YOUR_LRS/xapi/statements
XAPI_USERNAME=<basic-auth-user>
XAPI_PASSWORD=<basic-auth-password>
XAPI_SOURCE_APP=speaking-lab
XAPI_ACTOR_HOMEPAGE=https://saif.rsaf.mil
```

`XAPI_LRS_URL` is the LRS statements endpoint. Assessed, mapped KLP results are queued
transactionally and delivered asynchronously in batches of at most 100 with xAPI
version `1.0.3`. Learner requests do not wait for the LRS. Failed deliveries use
exponential retry and remain visible to admins.

The 2026-07-20 SAIF re-issue moved every SAIF-owned xAPI identifier to
`https://saif.training`. This applies to KLP activity IRIs, activity types,
SAIF-defined verbs, and extension keys. `XAPI_ACTOR_HOMEPAGE` is a separate,
configurable Q1 identity choice and is not rewritten as an xAPI namespace.

The SAIF actor is deliberately pseudonymous and is identical for direct-login and
SAIF-launched activity after account linking:

```json
{
  "objectType": "Agent",
  "account": {
    "homePage": "https://saif.rsaf.mil",
    "name": "<signed SAIF sub>"
  }
}
```

Admin-only operational endpoints:

```text
GET  /api/admin/integrations/xapi/status
POST /api/admin/integrations/xapi/retry
GET  /api/admin/integrations/xapi/actor-map
```

The initial implementation emits only Profile v1.2 core fields. Proposed rich speech
signals are recorded in `integration/SPEAKING_RICH_SIGNAL_Q3_PROPOSAL.md` and remain local
until SAIF publishes extension IRIs.
