# SAIF xAPI Integration Profile

**Version:** 1.2 — Draft (revised 4 July 2026)  
**Date:** April 2026; revised May 2026 for unified mastery and cmi5 demotion; revised June 2026 (v1.1) to reserve four behavioural-signal extensions for Tier-2/3 analytics (Appendix A); revised July 2026 (v1.2) to register the `choice-breadth` per-KLP weighting extension (Appendix A), signed off with Tac Comms 2026-07-04  
**Audience:** External LMS administrators, integration developers, CALL platform vendors  
**xAPI Spec:** IEEE 9274.1.1 (Experience API 2.0) / backward-compatible with xAPI 1.0.3  
**cmi5:** Compatible only insofar as cmi5 statements conform to this xAPI profile (§7); cmi5 is not a first-class ingestion format  
**Trial scope:** DLI American Language Course (`dli_alc`) only; other departments not yet supported  

---

## 1. Purpose

This document defines the xAPI statement format that external learning systems must use when sending learner performance data to SAIF. Any system that produces statements conforming to this profile will have its data automatically ingested into SAIF's mastery tracking layer, contributing to each cadet's unified progress picture alongside SAIF-native practice data.

**What SAIF does with ingested data:**
- Maps each statement to a specific KLP (Key Learning Point) in the DLI curriculum
- Resolves the learner identity to their SAIF account
- Converts the performance score to SAIF's spaced repetition quality scale
- Updates the learner's mastery state for that KLP, recording the modality of the evidence (reading, writing, listening, speaking) as audit metadata on the underlying attempt record
- Makes the evidence visible on instructor and admin dashboards

**What SAIF does NOT do:**
- Accept statements for activities that are not mapped to KLPs (they are filtered and logged)
- Accept statements without a resolvable learner identity (they are logged as unresolved)
- Modify the original statement in the LRS — SAIF reads; it does not write back
- Maintain separate mastery records per modality. Each (learner × KLP) has a single mastery state under SAIF's unified mastery model; the modality of each piece of evidence is preserved in the attempt log but does not produce parallel mastery rows

---

## 2. Architecture

External systems do not POST statements directly to SAIF. They POST to a shared Learning Record Store (LRS). SAIF's ingestion adapter polls the LRS and processes qualifying statements.

```
Your LMS / CALL Platform
        │
        │  POST /xAPI/statements
        │  (Basic Auth credentials provided during onboarding)
        ▼
┌─────────────────┐
│   LRS (Ralph)   │  ← Shared xAPI statement store
│   Port 8200     │
└────────┬────────┘
         │
         │  Polled by ingestion adapter
         ▼
┌─────────────────┐
│  SAIF Ingestion │  ← Filters, transforms, writes to SAIF
│  Adapter (8201) │     (FILTER → DEDUP → TRANSFORM → WRITE)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SAIF Mastery   │  ← Learner progress updated
│  Layer          │
└─────────────────┘
```

**2026 trial deployment** runs on Azure in a convenient region (UK/EU): the trials use codified, pseudonymous learners and a non-proprietary syllabus, so in-Kingdom data residency is not required this year, and the LRS and ingestion adapter run together in that region's VNet. Long-term production moves in-Kingdom to Azure KSA Central (the PDPL/SDAIA data-residency aspiration) and later to on-premise infrastructure; the LRS endpoint and adapter behaviour remain consistent across all environments, so external integrations require no code changes when the production move occurs.

**LRS Credentials:** Provided during integration onboarding. Each external system receives a unique Basic Auth username with `statements/write` scope. Contact the SAIF administrator for credentials.

**Polling cadence and adapter behaviour** are specified in `ralph_lrs_xapi_ingestion_adapter_v1.md`; external integrators do not need to know the cadence, only that ingestion is asynchronous and statements may take up to a few minutes to surface in SAIF dashboards.

---

## 3. KLP Activity IRI Scheme

Every statement must reference a specific KLP using the SAIF activity IRI format. This is how SAIF identifies which curriculum item the learner interacted with.

### 3.1 IRI Pattern

```
https://saif.rsaf.mil/klp/{department}/{concept_id}
```

### 3.2 Components

| Segment | Value | Description |
|---|---|---|
| `department` | `dli_alc` | DLI American Language Course (currently the only supported department) |
| `concept_id` | `{book}-{lesson}-{type}-{seq}` | Maps 1:1 to SAIF's KLP identifier |

### 3.3 Type Codes

| Code | KLP Type | Example |
|---|---|---|
| `V` | Vocabulary | `7-1-V-1` = Book 7, Lesson 1, Vocabulary item 1 |
| `G` | Grammar | `12-3-G-5` = Book 12, Lesson 3, Grammar item 5 |
| `F` | Functions | `9-2-F-3` = Book 9, Lesson 2, Function item 3 |
| `S` | Skills | `15-1-S-2` = Book 15, Lesson 1, Skill item 2 |

Some KLPs have subdivisions: `12-3-G-5-ii` (grammar item 5, subdivision ii). Include the subdivision when it exists.

### 3.4 Full IRI Examples

```
https://saif.rsaf.mil/klp/dli_alc/7-1-V-1
https://saif.rsaf.mil/klp/dli_alc/12-3-G-5-ii
https://saif.rsaf.mil/klp/dli_alc/9-2-F-3
https://saif.rsaf.mil/klp/dli_alc/15-1-S-2
```

### 3.5 Governance status

The IRI scheme above is provisional for the trial period and is hardcoded into the SAIF ingestion adapter. RSAF/SAIF KLP IRI governance is an open item that will determine the canonical hostname, department-segment naming, and subdivision conventions for production. External integrators who build against the trial scheme should expect at most a hostname change during the production cutover; the path structure and concept identifiers will not change.

### 3.6 The KLP-addressability gate

Every ingested observation must name the KLP it concerns. This is the single gate on the mastery-write path — *can you name the KLP?* If yes, the observation is mastery evidence and is weighted by fidelity like any other (a low-fidelity source contributes less per observation, not nothing). If no, it is not mastery evidence: session-, module-, or book-level scores without per-KLP mapping are filtered from mastery and never aggregated into it.

**No aggregate distribution.** A coarse score over an undeclared set of KLPs — for example one quiz percentage spanning a whole book — must not be spread across that book's constituent KLPs to manufacture per-KLP outcomes. Distributing an aggregate asserts observations that were never made and swamps genuine per-KLP evidence; that is fabrication, not ingestion. Such a source earns a mastery path only by being upgraded at source to emit per-KLP outcomes conforming to this profile, at which point it becomes ordinary low-fidelity KLP evidence. (§7 applies this same gate to cmi5.)

### 3.7 How to Find the Correct IRI

The full KLP corpus (7,420 items) is available as a reference export. Request the KLP Index file from the SAIF administrator. Each row contains the ConceptID that maps directly to the `concept_id` segment of the IRI.

---

## 4. Actor Format

SAIF must be able to identify which cadet produced the statement. Use one of the following actor formats.

### 4.1 Preferred: mbox (email)

```json
{
  "actor": {
    "mbox": "mailto:cadet001@rsaf.mil",
    "name": "Cadet Al-Ghamdi",
    "objectType": "Agent"
  }
}
```

### 4.2 Supported: Account

```json
{
  "actor": {
    "account": {
      "homePage": "https://your-lms.example.com",
      "name": "cadet001"
    },
    "name": "Cadet Al-Ghamdi",
    "objectType": "Agent"
  }
}
```

### 4.3 Actor Resolution

Before your first data submission, provide the SAIF administrator with a mapping file: a list of your system's learner identifiers paired with their SAIF email addresses or user IDs. SAIF uses a lookup table to resolve external identifiers. Statements from unmapped actors are logged but not processed — they will not silently disappear, but they will not update mastery until the mapping is created.

---

## 5. Accepted Verbs

SAIF's ingestion adapter only processes statements with the following verbs. All other verbs are filtered and logged.

### 5.1 Mastery Evidence Verbs (processed)

| Verb IRI | Display | When to Use |
|---|---|---|
| `http://adlnet.gov/expapi/verbs/answered` | answered | Learner submitted a response to a KLP-level question or exercise |
| `http://adlnet.gov/expapi/verbs/passed` | passed | Learner met the pass threshold on a KLP assessment |
| `http://adlnet.gov/expapi/verbs/failed` | failed | Learner did not meet the pass threshold on a KLP assessment |
| `https://saif.rsaf.mil/verbs/practiced` | practiced | Learner practiced a KLP in any modality (drill, exercise, activity) |
| `https://saif.rsaf.mil/verbs/reviewed` | reviewed | Learner completed a scheduled review of a previously-seen KLP |

### 5.2 Non-Evidence Verbs (accepted by LRS, filtered by SAIF)

These verbs are valid xAPI and will be stored in the LRS, but SAIF's ingestion adapter does not process them into mastery evidence.

| Verb IRI | Display | Why Filtered |
|---|---|---|
| `http://adlnet.gov/expapi/verbs/completed` | completed | Session-level — SAIF needs per-KLP evidence |
| `http://adlnet.gov/expapi/verbs/experienced` | experienced | Exposure only — no performance signal |
| `http://adlnet.gov/expapi/verbs/launched` | launched | Session management — no learning evidence |
| `http://adlnet.gov/expapi/verbs/initialized` | initialized | cmi5 lifecycle — no learning evidence |
| `http://adlnet.gov/expapi/verbs/terminated` | terminated | cmi5 lifecycle — no learning evidence |

SAIF-native apps may emit some of these verbs (notably `experienced` for placement test chat turns) for internal audit and analytics purposes; those statements are not part of this external profile and are out of scope here.

---

## 6. Statement Templates

### 6.1 Minimal Valid Statement

The minimum required fields for a statement that SAIF will process:

```json
{
  "actor": {
    "mbox": "mailto:cadet001@rsaf.mil",
    "objectType": "Agent"
  },
  "verb": {
    "id": "http://adlnet.gov/expapi/verbs/answered",
    "display": { "en-US": "answered" }
  },
  "object": {
    "id": "https://saif.rsaf.mil/klp/dli_alc/7-1-V-1",
    "definition": {
      "type": "https://saif.rsaf.mil/activity-types/klp",
      "name": { "en-US": "Book 7, Lesson 1, Vocabulary 1" }
    },
    "objectType": "Activity"
  },
  "result": {
    "success": true
  }
}
```

This is the floor. SAIF will process it, but the mastery quality mapping will use conservative defaults because no score is provided. More data leads to better mastery tracking.

### 6.2 Recommended Full Statement

Includes score, modality context, and source identification for the best mastery signal.

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "actor": {
    "mbox": "mailto:cadet001@rsaf.mil",
    "name": "Cadet Al-Ghamdi",
    "objectType": "Agent"
  },
  "verb": {
    "id": "http://adlnet.gov/expapi/verbs/answered",
    "display": { "en-US": "answered" }
  },
  "object": {
    "id": "https://saif.rsaf.mil/klp/dli_alc/7-1-V-1",
    "definition": {
      "type": "https://saif.rsaf.mil/activity-types/klp",
      "name": { "en-US": "goodbye" },
      "description": { "en-US": "Book 7, Lesson 1, Vocabulary item 1" }
    },
    "objectType": "Activity"
  },
  "result": {
    "success": true,
    "score": {
      "scaled": 0.85,
      "raw": 85,
      "max": 100,
      "min": 0
    }
  },
  "context": {
    "extensions": {
      "https://saif.rsaf.mil/extensions/skill": "reading",
      "https://saif.rsaf.mil/extensions/klp-type": "vocabulary",
      "https://saif.rsaf.mil/extensions/book": 7,
      "https://saif.rsaf.mil/extensions/lesson": 1,
      "https://saif.rsaf.mil/extensions/department": "dli_alc",
      "https://saif.rsaf.mil/extensions/source-app": "talentlms"
    }
  },
  "timestamp": "2026-04-27T10:30:00.000Z"
}
```

The `skill` extension carries the modality of the evidence (reading, writing, listening, or speaking). The IRI is named `skill` for historical reasons but the value semantically represents the modality through which the learner exercised the KLP. SAIF records this on the underlying attempt record as audit metadata; it does not produce a separate mastery row per modality (see §1).

### 6.2.1 Enriched Statement — Behavioural Signals (v1.1, optional)

The four behavioural-signal extensions reserved in Appendix A (v1.1) carry effort, confidence, and confusion signals for Tier-2 and Tier-3 analytics. They are **optional and non-gating**: SAIF records them as attempt audit metadata when present and ignores them when absent — the mastery write depends only on the KLP-addressability gate (§3.6), never on these. The example below shows an *incorrect* multiple-choice attempt (so `distractor-selected` is meaningful) carrying a low confidence rating.

```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
  "actor": { "mbox": "mailto:cadet001@rsaf.mil", "objectType": "Agent" },
  "verb": {
    "id": "http://adlnet.gov/expapi/verbs/answered",
    "display": { "en-US": "answered" }
  },
  "object": {
    "id": "https://saif.rsaf.mil/klp/dli_alc/7-1-V-1",
    "definition": { "type": "https://saif.rsaf.mil/activity-types/klp" },
    "objectType": "Activity"
  },
  "result": {
    "success": false,
    "score": { "scaled": 0.0, "raw": 0, "max": 100, "min": 0 },
    "extensions": {
      "https://saif.rsaf.mil/extensions/confidence-rating": 2,
      "https://saif.rsaf.mil/extensions/hint-usage-count": 1,
      "https://saif.rsaf.mil/extensions/retry-count": 0,
      "https://saif.rsaf.mil/extensions/distractor-selected": "https://saif.rsaf.mil/klp/dli_alc/7-1-V-4"
    }
  },
  "context": {
    "extensions": {
      "https://saif.rsaf.mil/extensions/skill": "reading",
      "https://saif.rsaf.mil/extensions/source-app": "talentlms"
    }
  },
  "timestamp": "2026-06-21T09:15:00.000Z"
}
```

`confidence-rating` uses SAIF's native 1–4 `ConfidenceRating` scale; here `2` (TOUGH) paired with an incorrect outcome reproduces composite SM-2 quality 1. `distractor-selected` names the chosen wrong option — SAIF-native emits the distractor's owning KLP IRI (linking to Stage 5.7.7 distractor tagging), while an external LMS may instead emit the option id or text. `hint-usage-count` and `retry-count` are effort signals. All four are absent-tolerant: a source that emits none of them produces an ordinary valid statement.

### 6.3 Field-by-Field Reference

| Field | Required? | Description | Impact if Missing |
|---|---|---|---|
| `id` | Recommended | UUID for this statement. Used for deduplication. | SAIF generates one, but cannot deduplicate if resubmitted |
| `actor.mbox` or `actor.account` | **Required** | Learner identity | Statement rejected (unresolved actor) |
| `verb.id` | **Required** | Must be a mastery evidence verb (§5.1) | Statement filtered |
| `object.id` | **Required** | Must match SAIF KLP IRI pattern (§3) | Statement filtered |
| `object.definition.type` | Recommended | Should be `https://saif.rsaf.mil/activity-types/klp` | Accepted but lower confidence |
| `result.success` | **Required** | `true` or `false` | Statement processed with quality 0 (worst case) |
| `result.score.scaled` | Recommended | 0.0–1.0 performance score | Quality mapping uses conservative defaults |
| `context.extensions.../skill` | Recommended | Modality of evidence: `reading`, `writing`, `listening`, or `speaking` | Defaults to `reading`; modality is recorded as audit metadata only |
| `context.extensions.../source-app` | **Required** | Your system's identifier (e.g., `talentlms`, `moodle`) | Must not be a SAIF-internal value (see §9) |
| `timestamp` | Recommended | ISO 8601 datetime | LRS assigns server time |

---

## 7. cmi5 Compatibility Note

cmi5 is not a first-class ingestion format for SAIF. The standard ingestion contract is the xAPI profile defined in this document. cmi5 statements are accepted only insofar as they conform to that profile — that is, only when the statement carries a SAIF KLP IRI as the activity, an accepted verb, a resolvable actor, and the required source-app extension. cmi5's session-lifecycle verbs and Assignable Unit-level structures do not map to SAIF's per-KLP mastery model and are filtered.

If your LMS uses cmi5 and you wish to integrate, the practical guidance is as follows.

### 7.1 cmi5 Assignable Unit Mapping

Each Assignable Unit (AU) must map to one or more KLPs. The `cmi5.xml` manifest should use SAIF KLP IRIs as Activity IDs for the most granular AUs:

```xml
<au id="klp-7-1-V-1" 
    url="https://your-content.example.com/exercises/book7-lesson1-vocab1"
    activityType="https://saif.rsaf.mil/activity-types/klp"
    moveOn="Passed">
  <title>
    <langstring lang="en-US">Book 7, Lesson 1, Vocabulary 1: goodbye</langstring>
  </title>
  <description>
    <langstring lang="en-US">Vocabulary practice for 'goodbye'</langstring>
  </description>
  <launch url="index.html"/>
</au>
```

### 7.2 cmi5 Verbs That SAIF Processes

From the cmi5 verb vocabulary, SAIF processes:

| cmi5 Verb | SAIF Processing |
|---|---|
| `passed` | Mastery evidence — yes |
| `failed` | Mastery evidence — yes |
| `completed` | Filtered — session-level, not per-KLP |
| `satisfied` | Filtered — block-level |
| `launched` / `initialized` / `terminated` / `abandoned` / `waived` | Filtered — lifecycle |

### 7.3 cmi5 Masteryscore

If the AU uses cmi5's `masteryscore` attribute, SAIF interprets it as the pass threshold. A `result.score.scaled` at or above `masteryscore` maps to `passed`; below maps to `failed`.

### 7.4 cmi5 Registration

cmi5 requires a `registration` UUID in the context. SAIF logs this for audit purposes but does not use it for mastery grouping — mastery is always per-KLP, per-learner.

The implication of the demotion is straightforward: AU-level reporting, block-level satisfaction, and cmi5 lifecycle audits remain in the LRS but do not contribute to SAIF mastery state. Per-KLP `passed` and `failed` statements do contribute, and they are processed identically to any other xAPI statement that meets §5.1.

---

## 8. Score-to-Quality Mapping

SAIF uses the SM-2 spaced repetition algorithm, which requires a quality score from 0 (complete failure) to 5 (perfect recall). External systems provide percentage scores or pass/fail outcomes. The ingestion adapter translates as follows:

| Your Result | SAIF Quality | SM-2 Meaning |
|---|---|---|
| `success: true` + `scaled ≥ 0.9` | **5** | Perfect — confident, instant recall |
| `success: true` + `scaled ≥ 0.7` | **4** | Correct after minor hesitation |
| `success: true` + `scaled ≥ 0.5` | **3** | Correct with significant difficulty |
| `success: false` + `scaled ≥ 0.3` | **2** | Incorrect but partially recalled |
| `success: false` + `scaled ≥ 0.1` | **1** | Incorrect with vague recognition |
| `success: false` + `scaled < 0.1` or no result | **0** | Complete blank |
| No score, only `success: true` | **3** | Conservative correct default |
| No score, only `success: false` | **1** | Conservative incorrect default |

**Key implication:** If your system only sends `success: true/false` without a scaled score, SAIF uses quality 3 (correct) or 1 (incorrect). This is functional but loses nuance. Providing `result.score.scaled` significantly improves the accuracy of SAIF's review scheduling for your learners.

---

## 9. Source-App Identification

Every statement from an external system **must** include a source identifier in context extensions:

```json
"context": {
  "extensions": {
    "https://saif.rsaf.mil/extensions/source-app": "your-system-name"
  }
}
```

**Rules:**
- Use a consistent, lowercase identifier (e.g., `talentlms`, `moodle`, `classroom-quiz-tool`)
- Do **not** use values that begin with `saif-` or that match the names of SAIF-native applications (`vocab-app`, `reading-tutor`, `placement-test`, `speaking-tutor`); these namespaces are reserved
- The source-app value is logged in SAIF's ingestion records for audit and troubleshooting
- Once chosen, the identifier should remain stable across releases; changing it mid-trial fragments the audit trail

---

## 10. Batch Submission

You may POST single statements or batches of up to 100 statements per request. The LRS accepts both formats.

**Single statement:**
```
POST /xAPI/statements
Content-Type: application/json
X-Experience-API-Version: 1.0.3

{ ... single statement ... }
```

**Batch:**
```
POST /xAPI/statements
Content-Type: application/json
X-Experience-API-Version: 1.0.3

[ { ... statement 1 ... }, { ... statement 2 ... }, ... ]
```

Always include the `X-Experience-API-Version: 1.0.3` header. The LRS will reject statements without it.

---

## 11. Validation Checklist

Before submitting your first production statements, verify:

- [ ] Actor `mbox` or `account` matches the mapping file provided to the SAIF administrator
- [ ] Activity IRI follows the pattern `https://saif.rsaf.mil/klp/dli_alc/{concept_id}`
- [ ] ConceptIDs used exist in the SAIF KLP corpus (request the KLP Index for verification)
- [ ] Verb IRI is one of the five mastery evidence verbs (§5.1)
- [ ] `result.success` is present as `true` or `false`
- [ ] `result.score.scaled` is present and between 0.0 and 1.0 (recommended)
- [ ] `context.extensions.../skill` reflects the modality of the evidence (reading/writing/listening/speaking)
- [ ] `context.extensions.../source-app` is set and does not collide with any reserved SAIF-internal value (§9)
- [ ] `X-Experience-API-Version: 1.0.3` header is included
- [ ] LRS credentials work: test with a single statement and verify via `GET /xAPI/statements`

---

## 12. Monitoring and Troubleshooting

SAIF exposes ingestion status endpoints (admin access required):

| Endpoint | What It Shows |
|---|---|
| `GET /api/ingestion/status` | Total statements processed, filtered, errored; last poll time |
| `GET /api/ingestion/unresolved` | Actors in statements that could not be mapped to SAIF users |
| `GET /api/ingestion/log` | Recent processed statements with outcomes (applied, filtered, error) |

If your statements are not appearing in SAIF mastery data, check the ingestion log. Common issues:

| Symptom | Cause | Fix |
|---|---|---|
| Statements in LRS but not in SAIF | Verb not in mastery evidence list | Use an accepted verb (§5.1) |
| Statements in LRS but not in SAIF | Activity IRI doesn't match KLP pattern | Check IRI format (§3) |
| Statements processed but actor unresolved | Learner identity not in actor map | Provide mapping file to SAIF admin |
| Statements applied but mastery unchanged | Quality mapped to 0 (no score provided) | Add `result.score.scaled` |
| Statements rejected by LRS | Missing `X-Experience-API-Version` header | Add the header |
| Statements applied but appear under unexpected modality | `skill` extension missing or set incorrectly | Set `skill` to one of `reading`/`writing`/`listening`/`speaking` |

---

## 13. Worked Example: TalentLMS Quiz

A TalentLMS course includes a vocabulary quiz for Book 9, Lesson 2. The quiz has 10 questions, each mapped to a specific KLP. After the learner completes the quiz, TalentLMS posts 10 statements — one per question — to the SAIF LRS.

**Statement for question 3 (KLP: 9-2-V-3, "emergency", learner got it right with 80% confidence):**

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "actor": {
    "mbox": "mailto:cadet.alghamdi@rsaf.mil",
    "name": "Cadet Al-Ghamdi",
    "objectType": "Agent"
  },
  "verb": {
    "id": "http://adlnet.gov/expapi/verbs/answered",
    "display": { "en-US": "answered" }
  },
  "object": {
    "id": "https://saif.rsaf.mil/klp/dli_alc/9-2-V-3",
    "definition": {
      "type": "https://saif.rsaf.mil/activity-types/klp",
      "name": { "en-US": "emergency" },
      "description": { "en-US": "Book 9, Lesson 2, Vocabulary: emergency" }
    },
    "objectType": "Activity"
  },
  "result": {
    "success": true,
    "score": {
      "scaled": 0.8
    }
  },
  "context": {
    "extensions": {
      "https://saif.rsaf.mil/extensions/skill": "reading",
      "https://saif.rsaf.mil/extensions/klp-type": "vocabulary",
      "https://saif.rsaf.mil/extensions/book": 9,
      "https://saif.rsaf.mil/extensions/lesson": 2,
      "https://saif.rsaf.mil/extensions/department": "dli_alc",
      "https://saif.rsaf.mil/extensions/source-app": "talentlms"
    }
  },
  "timestamp": "2026-04-27T09:15:30.000Z"
}
```

**What SAIF does with this statement:**

1. **FILTER** — Verb is `answered` (accepted). Activity IRI matches `https://saif.rsaf.mil/klp/**` (accepted). Source-app is `talentlms` (not a reserved SAIF-internal value, accepted).
2. **DEDUP** — Statement ID `f47ac10b...` not in processed table. Proceed.
3. **TRANSFORM** — Actor `cadet.alghamdi@rsaf.mil` resolved to SAIF user `uuid-1234`. KLP `9-2-V-3` found in corpus. Score `0.8` + `success: true` → SM-2 quality **4**. Modality from `skill` extension: `reading`.
4. **WRITE** — A practice attempt is recorded against (user `uuid-1234`, KLP `9-2-V-3`) with `modality='reading'`, `quality=4`, `source='talentlms'`. The unified mastery row for that (user, KLP) pair is upserted: SM-2 fields recalculate from the attempt sequence and the next review date is updated. No separate per-modality mastery row is created.

The learner's dashboard now shows this KLP as practised, with the reading-modality contribution visible in the modality drill-down on the mastery radar. The instructor's cohort view reflects the updated mastery state.

---

## Appendix A: Reserved Extension IRIs

| Extension IRI | Type | Values | Notes |
|---|---|---|---|
| `https://saif.rsaf.mil/extensions/skill` | Context | `reading`, `writing`, `listening`, `speaking` | Modality of evidence; recorded as audit metadata on the attempt under unified mastery |
| `https://saif.rsaf.mil/extensions/klp-type` | Context | `vocabulary`, `grammar`, `functions`, `skills` | Type of KLP; redundant with the IRI type code but useful for indexing |
| `https://saif.rsaf.mil/extensions/book` | Context | Integer (1–34) | Source book |
| `https://saif.rsaf.mil/extensions/lesson` | Context | Integer (1–N) | Source lesson |
| `https://saif.rsaf.mil/extensions/department` | Context | String: `dli_alc` (others TBD) | Currently `dli_alc` only |
| `https://saif.rsaf.mil/extensions/source-app` | Context | String: your system identifier | Must not collide with reserved SAIF-internal values (§9) |
| `https://saif.rsaf.mil/extensions/confidence-rating` | Result | Integer 1–4: `1`=FORGOT, `2`=TOUGH, `3`=SOLID, `4`=MASTERED | **v1.1.** Learner's pre-submission self-reported confidence, aligned to SAIF's native `ConfidenceRating` scale; paired with the outcome it reproduces the composite SM-2 quality. Captured as attempt audit metadata; never gates the mastery write. Optional. |
| `https://saif.rsaf.mil/extensions/hint-usage-count` | Result | Integer ≥ 0 | **v1.1.** Number of hints or scaffolds the learner consumed on the item. Effort/scaffolding signal for Tier-2/3 analytics. Optional. |
| `https://saif.rsaf.mil/extensions/retry-count` | Result | Integer ≥ 0 | **v1.1.** Number of retries on the item before the recorded outcome. Effort/persistence signal. Optional. |
| `https://saif.rsaf.mil/extensions/distractor-selected` | Result | String — identifier or text of the distractor chosen on an incorrect response | **v1.1.** Confusion signal (which distractor was picked). SAIF-native may emit the distractor's owning KLP IRI to link to distractor tagging (Stage 5.7.7); external sources may emit the option id or text. Present only on incorrect attempts. Optional. |
| `https://saif.rsaf.mil/extensions/choice-breadth` | Result | Integer ≥ 0 | **v1.2.** Per-KLP **effective-distractor count** — the number of genuinely confusable decoys *this KLP alone* rules out (**excludes the correct target; NOT the candidate count**). Carried per KLP on `answered` statements in the per-KLP fan-out (`object.id` = the KLP IRI). **The producer sends the raw count only; SAIF owns count → weight** — maps to the BKT guess parameter (`guess ≈ 1/N_effective`, per `SAIF_Mastery_Evidence_Weighting_Alignment.md`), so every external producer is weighed identically and none bakes its own scale. **Non-gating**; the "no genuine choice" case (breadth < 2) is filtered producer-side via the `experienced` verb (the adapter's verb gate), so the adapter only ever sees breadth ≥ 2 here. Pairs with `distractor-selected`. Signed off with Tac Comms 2026-07-04 (all four decisions Option A). Optional. |
| `https://saif.rsaf.mil/extensions/sm2-quality` | Result | Integer (0–5) — SAIF-native only | Not for external use |
| `https://saif.rsaf.mil/extensions/response-time-ms` | Result | Integer — milliseconds | Optional |

---

## Appendix B: Quick Reference Card

```
LRS Endpoint:     http://<lrs-host>:8200/xAPI/statements
                  (2026 trial: Azure UK/EU; production: KSA Central, then on-premise)
Auth:             Basic Auth (credentials from SAIF admin)
API Version:      X-Experience-API-Version: 1.0.3
Method:           POST
Content-Type:     application/json

Activity IRI:     https://saif.rsaf.mil/klp/dli_alc/{book}-{lesson}-{type}-{seq}
                  (provisional; pending KLP IRI governance — see §3.5)
Activity Type:    https://saif.rsaf.mil/activity-types/klp

Accepted Verbs:   answered | passed | failed | practiced | reviewed
Required Fields:  actor (mbox or account), verb, object.id, result.success
Recommended:      result.score.scaled, context.extensions.../skill,
                  context.extensions.../source-app, timestamp

cmi5:             Compatibility only via this xAPI profile (§7);
                  cmi5 is not a first-class ingestion format
```
