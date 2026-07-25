# SAIF → Speaking Tutor — xAPI integration handover (starter, 2026-07-05)

This is the **starting drop** for the external Speaking Tutor dev: what SAIF needs from your
xAPI emission so ingested speaking evidence becomes cadet mastery. The Speaking Tutor is an
**external xAPI producer** (Path B) — you emit to SAIF's LRS, SAIF ingests to mastery
(`source="lrs_ingestion"`). Same integration pattern Tac Comms uses. Prepared on SAIF branch
`claude/stoic-perlman-37beca`.

**This is a start, not a full spec — the rich speaking signal makes it a back-and-forth.** The
*core* below is stable and buildable today; the *rich layer* and three open questions (§4) are
what we iterate on together.

## 1. The contract (vendored in this folder — point-in-time snapshots)

Two pinned copies sit **beside this file** so this is a self-contained drop:

| File (here) | Canonical SAIF source | Version | Snapshot |
|---|---|---|---|
| `SAIF_xAPI_Integration_Profile.md` | `docs/spec docs/SAIF_xAPI_Integration_Profile.md` | **v1.2** | `claude/stoic-perlman-37beca` @ `908f4e6`, 2026-07-05 |
| `SAIF_xAPI_Ingestion_Contract_v1.md` | `docs/spec docs/SAIF_xAPI_Ingestion_Contract_v1.md` | v1 (FILTER/TRANSFORM/WRITE gates + verify loop) | same |

⚠ **These are point-in-time snapshots, and they will move.** The profile is expected to gain new
**rich extensions** as we settle Q3 (§4) — so treat these as a starting pin and **re-sync against the
canonical SAIF sources** after the first agreed change (the canonical path + version above is
authoritative; a Tac Comms handoff froze at v1.1 exactly this way). The profile is
**producer-agnostic** — the TalentLMS worked example (§13) is illustrative, not the scope; build to
the general contract.

## 2. The mandatory common core (build this first — it's stable)

For a statement to become mastery evidence, SAIF's ingestion needs all of:

- **Actor with an IFI that resolves to a SAIF learner** — mbox (email) preferred, or account
  (Profile §4). Resolution via the actor map (`POST /api/admin/ingestion/actors/map`). *(How the
  Speaking Tutor identifies the learner is open question Q1, §4.)*
- **An evidence verb** — Profile §5.1 (the processed set). Non-evidence verbs are accepted by the
  LRS but filtered by SAIF (§5.2).
- **A KLP-addressable object** — the object's activity IRI carries the KLP concept-id per the IRI
  scheme (§3). **This is the hard gate (§3.6): a statement that doesn't resolve to a named KLP is
  filtered, not stored as evidence.** IRIs are committed stable (§3.5).
- **A `result`** carrying correctness / score — mapped to SM-2 quality by §8 (score-to-quality).
- **`context.extensions/source-app`** = a stable producer id (e.g. `speaking-tutor`) — Profile §9.
  This is how SAIF attributes the evidence to you (and it's now stored + surfaced admin-side).

Statement templates are in Profile §6 (minimal §6.1, recommended full §6.2). Validate your shape
against the **§11 checklist** before you ever touch a live SAIF.

**CEFR drives the KLP grade.** The quality that moves mastery comes from the CEFR-referenced
correctness/score, *not* from ICAO or any rich signal (ADR-12).

### One speaking-specific core rule: N KLPs per interaction
A single speaking turn typically exercises **more than one KLP** — the function, the grammar, *and*
the speaking-skill KLP. So emit **one evidence statement per KLP** the turn addresses (or a batch,
§10), each KLP-addressable per §3.6. Don't collapse a turn to one statement on one KLP. Which KLPs
a turn maps to is open question Q2 (§4).

## 3. The rich layer (absent-tolerant — grows through iteration)

Everything beyond the core is a **rich extension SAIF stores but never gates mastery on**:
- The **reserved behavioural extensions** (Profile §6.2.1 / Appendix A): confidence / hint / retry /
  distractor — `result.extensions`, optional, audit-only.
- **Speaking-specific rich signals** — prosody, phonemes, fluency, pace, **ICAO rating**, etc. These
  land in SAIF's rich-signal store (Phase 5.9.4), feed analytics/reflection, and are **parallel to**
  the mastery grade, never driving it (ADR-12).

Emit what you can; SAIF tolerates absence. New rich extensions get **named in the Profile as we go**
(Phase 5.9.3 is deliberately iterative) — that's the back-and-forth. Don't wait on the rich layer to
start the core.

## 4. The three open questions (this is where we iterate)

These are genuinely unsettled and gate the *speaking* slice (Phase 5.9) — they're the agenda for the
back-and-forth, not blockers on starting the core:

1. **Q1 — Actor identity / SSO↔IFI (Phase 5.9.1).** How does a launched Speaking Tutor session
   identify the cadet so the statement's actor IFI resolves to the right SAIF learner? (mbox from
   SSO? an account on a launch homepage? a cmi5 launch with the actor in the launch data — §7 / the
   `docs/talentlms/cmi5_reference_package/` launch shape is the reference.) **We need your launch +
   auth model to pin this.**
2. **Q2 — KLP tagging for speaking.** Which KLPs does a speaking activity/turn exercise, and how do
   *you* know the concept-id to put in the object IRI? (SAIF owns the KLP catalog; we hand you the
   relevant slice + the IRI derivation, §3.7. We need to agree the speaking→KLP mapping — this is
   curriculum-adjacent.)
3. **Q3 — The rich signal set.** Tell us what you can actually measure (the "very rich data"). We'll
   pick which land as named Profile extensions (rich layer, §3) vs which we defer — iteratively.

## 5. What you can do without SAIF (start now)

Everything up to and including a **verified end-to-end round-trip** (statement → cadet mastery)
against a *running SAIF instance* — see the ingestion contract's verify loop (`/api/admin/ingestion/*`).
You don't need our production LRS for this: emit into a local conformant LRS (Ralph is open-source
Docker — the same one SAIF runs), or point at a running SAIF dev instance we give you access to.

**Only a trial-scale / production-LRS deployment is gated on SAIF ops** — a stable LRS URL + write
credential, which lands with SAIF's trial standup (target August). That's the final wiring step, not
a prerequisite for building or proving the integration.

## 6. SAIF-side commitments (owed, so you're not blocked)
- Hand you the **speaking→KLP slice** + IRI derivation once Q2 is agreed.
- Name agreed **rich extensions** in the Profile as they're settled (Q3, iterative).
- Stand up + enable the **live trial LRS** and supply runtime config (URL + credential) at the August
  standup (the adapter/poller already exist; only the live LRS + enable-flag remain).

---

_Scope wall (unchanged): the Speaking app's architecture + STT stay your team's; SAIF owns
integration, ingestion, the rich-signal store, and the KLP mapping/rubric. Questions / re-sync: ping
the SAIF side. This drop references the canonical SAIF docs — vendor the current v1.2 profile +
ingestion contract, don't rely on this cover letter alone._
