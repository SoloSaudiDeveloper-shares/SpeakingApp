# SAIF xAPI Ingestion Contract (v1)

**Companion to** `SAIF_xAPI_Integration_Profile.md`. The Profile says *what to emit*; this
document records exactly what SAIF's ingestion adapter **enforces at runtime**, sourced
from the code, plus how an external producer verifies a statement was accepted against a
**live** SAIF.

**Status (2026-06-30):** the adapter is **IMPLEMENTED and tested** in
`app/services/xapi_ingestion/` (pipeline, poller, actor resolver, quality mapping) +
`app/routers/xapi_ingestion.py` + `app/models/xapi_ingestion.py`, exercised by the cmi5 /
TalentLMS ingestion tests. It is **default-OFF** behind the `xapi_ingestion_enabled`
setting. This is a **live, enforced contract — not aspirational**: the Integration Profile
is what the adapter actually applies. (Earlier SAD/PRD snapshots that read "no ingestion
code" / `[PLANNED]` are stale; the SAD flipped this to `[IMPLEMENTED]` on 2026-06-25.)

---

## Pipeline

`FILTER → DEDUP → TRANSFORM → WRITE`, one statement → exactly one outcome:
`applied` | `filtered` | `unresolved_actor` | `error` | `duplicate`. Every non-duplicate
statement is recorded in the `xapi_processed_statements` ledger, so nothing is silently
dropped and re-runs are idempotent. Source: `pipeline.py::process_statement` /
`process_batch` (commits per statement).

## FILTER — three gates, all must pass

`pipeline.filter_reason()` (pure; unit-testable). Failing any gate → `filtered` with the
reason recorded.

1. **Activity-IRI gate** — `object.id` **MUST** start with `https://saif.training/klp/`
   (`Settings.xapi_activity_iri_prefix`). Else → `activity_iri_not_klp`. This is the
   Profile §3.6 addressability gate: only KLP-addressed statements are candidate evidence.
2. **Verb gate** — `verb.id` **MUST** be one of the five mastery-evidence verbs:
   `http://adlnet.gov/expapi/verbs/answered`, `…/passed`, `…/failed`,
   `https://saif.training/verbs/practiced`, `https://saif.training/verbs/reviewed`.
   Else → `verb_not_evidence`. (`experienced`, `completed`, cmi5 lifecycle verbs → filtered.)
3. **Source-app skip** — `context.extensions["https://saif.training/extensions/source-app"]`
   **MUST NOT** be in the skip set (`Settings.xapi_skip_source_apps`, default `saif-native`).
   Else → `skip_source_app`. This is the circular-ingestion guard for SAIF's own Path-A
   emissions. **External producers must not use `saif-native` or any reserved value (Profile §9).**

## TRANSFORM

After FILTER passes:

- **KLP resolution** — `concept_id` is parsed from the IRI tail
  (`{prefix}{department}/{concept_id}`, e.g. `dli_alc/7-1-V-1`; the department segment is
  discarded) and **MUST** resolve to an active `klps.concept_id`. Unknown KLP →
  `filtered` (`unknown_klp`). A second restatement of the addressability gate.
- **Actor resolution** — `actor` (`mbox` or `account`, Profile §4) **MUST** resolve to a
  SAIF user via the actor map. Unresolved → `unresolved_actor` (logged + surfaced for
  mapping, **never silently dropped**).
- **Modality** — `context.extensions[".../skill"]` ∈ {`reading`,`writing`,`listening`,
  `speaking`} → recorded as attempt audit metadata only (unified mastery: no per-modality
  row). Absent/invalid → null.
- **Quality** — `score_to_sm2_quality(result.success, result.score.scaled)` per Profile §8.
  `result.success` (bool) is required; `result.score.scaled` (0.0–1.0) recommended for nuance.

## WRITE

`record_mastery_write(source="lrs_ingestion")` — the 5th sanctioned runtime mastery-write
site (one of SAIF's two write choke points). Upserts the unified `(user × KLP)` mastery row
and advances SM-2/FSRS; **no** `klp_practice_attempts` row (session-less evidence,
`klp_flagger` precedent). **DEDUP:** the statement `id` is the idempotency key
(`xapi_processed_statements`), so re-POSTing the same statement is a no-op.

---

## How to verify against a live SAIF (admin endpoints)

Prefix `/api/admin/ingestion` (admin-only). An external producer can prove statements
become mastery evidence **end-to-end** without waiting on anything SAIF still has to build:

1. **POST** your statements to the shared LRS.
2. `POST /api/admin/ingestion/trigger` — force one poll cycle now (a background loop also
   does this on a timer when ingestion is enabled).
3. `GET /api/admin/ingestion/log?result=applied|filtered|unresolved_actor` — per-statement
   outcome, reason, and the resolved KLP / user.
4. On `unresolved_actor`: `GET /unresolved`, then
   `POST /actors/map {external_identifier, saif_user_id, identifier_type}`; the statement
   resolves on the next poll (old ledger rows stay as history).
5. `GET /status` — cumulative counters + ledger-outcome breakdown + the poll cursor.

The **only** deploy-time gate is operational, not code: enable `xapi_ingestion_enabled` and
supply the LRS URL + Basic-auth credential.

## Emitter reference

`app/tutor/xapi_emitter.py` is a working Profile-statement builder + POSTer: the
`_statement` / `_actor` / `_activity` / `_verb` helpers, and `_post_sync` (sets
`X-Experience-API-Version: 1.0.3` + Basic auth, wraps a single statement in a one-element
array). Mirror it for a conformant emitter. It also demonstrates the **inverse** of gate 3:
SAIF-native statements are deliberately tagged `saif-native` so the skip gate keeps them
out of ingestion — an external producer does the opposite (a real, non-reserved
`source-app`).

---

_Sourced from `app/services/xapi_ingestion/` @ SAIF `main` (local, 2026-06-30). Pin this
alongside the Profile; if SAIF's `filter_reason` / `parse_concept_id` change, re-sync._
