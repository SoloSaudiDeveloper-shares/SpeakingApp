# External Portal Integration

This app can run standalone with its built-in login, or a custom portal can launch users into it with a short-lived signed JWT.

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
