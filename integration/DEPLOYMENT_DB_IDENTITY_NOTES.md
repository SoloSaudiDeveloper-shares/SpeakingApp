# Speaking Tutor — Deployment, Database & Identity Notes

**Companion to [`HANDOVER.md`](HANDOVER.md).** That doc covers the xAPI contract; this one covers **where your data lives** and the **login-identity question** underneath open-question **Q1**. Prompted by SAIF's own database decision (moving to Postgres on Azure for the trial) and the clarification that the Speaking Tutor is a **multi-purpose product that also lives outside SAIF**, with its own users logging in from other locations.

**Prepared on SAIF branch `claude/stoic-perlman-37beca`, 2026-07-05. Three items to action + a data-protection note.**

---

## 1. You keep your own database — no shared SAIF database

The Speaking Tutor integrates with SAIF **only** through (a) xAPI emitted to SAIF's LRS and (b) the launch handshake. There is **no shared database** and no shared auth store. So:

- **SAIF's own database engine is irrelevant to you.** Whether SAIF runs SQLite or Postgres, it changes nothing on your side — you're not reading or writing SAIF's tables.
- **Own your own persistence.** This is doubly true because the Speaking Tutor is a **standalone, multi-purpose product** with its own users from other contexts. Its data is its own boundary — ownership, lifecycle, backups, and (see §4) data-protection posture. It must **not** live in SAIF's database.
- **Contrast with Tac Comms (a different case).** Tac Comms is a game built around the SAIF cohort, so it *could* optionally share SAIF's Postgres **server** as its own separate database, purely as infra consolidation. The Speaking Tutor should **not** — pulling an independent product's multi-tenant user data into SAIF's trial infrastructure would be wrong on ownership, lifecycle, and residency.

**Action:** none — just confirming the Speaking Tutor stays on its own store.

## 2. SQLite on Azure — verify before you rely on it ⚠

If you're considering SQLite for the Speaking Tutor's own store on Azure, the raw capacity is almost certainly fine at trial scale — it's a read-heavy workload with light, bursty writes and a small dataset, well within SQLite's envelope (especially in WAL mode). **The risk is not throughput; it's durability and the Azure deployment model.** Things to **verify before committing**:

- **Persistent block storage.** The SQLite file must sit on a genuinely persistent disk (a managed disk / persistent volume). **Not** Azure App Service's ephemeral filesystem (wiped on restart/redeploy/scale), and **critically not an Azure Files / SMB network share** — SQLite over SMB has unreliable locking semantics and is a known corruption risk. This is the single biggest trap.
- **Single instance, single writer.** SQLite allows one writer at a time and doesn't support multiple app servers over a shared file. Pin to **one instance / one worker**; no scale-out.
- **WAL mode on** (readers don't block the writer).
- **`busy_timeout` set** so a burst of simultaneous writes (e.g. a whole class saving progress at once) waits briefly instead of erroring.
- **A backup routine** — a scheduled consistent snapshot via SQLite's online-backup API / `VACUUM INTO`, not a naive file copy of a live DB.

**Bottom line:** SQLite is a legitimate choice **if** your Azure deployment gives it a persistent block volume on a single pinned instance, with WAL + a backup routine. If your target is **App Service** (ephemeral FS → pushes you toward an SMB share), that's the danger zone — either move to a container/VM with a persistent volume, or use a **small managed Postgres of your own**, which removes the puzzle entirely. **This needs verification against your actual Azure shape — please confirm which it is.**

## 3. The handshake & login identity — one identity across both login paths (ties to Q1)

This is the important one. A learner can reach the Speaking Tutor **two ways**:

- **(a) launched from SAIF** via the handshake / SSO, and
- **(b) logging in directly** to the Speaking Tutor from another context.

For SAIF to turn a speaking session into cadet mastery, the emitted xAPI **actor must resolve to the same SAIF learner regardless of which door they came in by.** So the requirement is:

- **One stable identity per learner, not two accounts.** If a SAIF-launched session and a direct-login session map to *different* Speaking Tutor accounts, the statements from one path won't attribute to the SAIF learner. Both entry paths must resolve to **one** user record.
- **Account linking on handshake.** When SAIF launches a learner, reconcile/link to the learner's existing Speaking Tutor account (rather than minting a parallel one), so the two paths are the same person.
- **A resolvable actor IFI, consistent across both paths.** Stamp emitted statements with an IFI SAIF can resolve to the learner — either an `mbox`, or an `account` IFI on an agreed `homePage` carrying the SAIF learner id — and use the **same** IFI whether the session was SAIF-launched or a direct login.

Net effect: whichever door the learner comes through, the statements carry the **same resolvable identity**, so speaking evidence lands on the right cadet. This is exactly **Q1 in `HANDOVER.md` §4** — and the two-login-path detail is the reason it's load-bearing.

**Action / to agree (Q1):** (i) what identifier the SAIF handshake passes across, and (ii) what IFI you stamp on emitted statements — plus your account-linking approach so the direct-login and SAIF-launched identities are one.

## 4. Data-protection note — keep the SAIF-facing identity pseudonymous

SAIF's 2026 trials are deliberately **codified / pseudonymous — no real PII**, hosted in an approved non-KSA region (UK South). Because the Speaking Tutor holds its own user data across multiple locations, keep the **SAIF-facing identity boundary pseudonymous**:

- The identifier SAIF hands across at the handshake should be the **pseudonymous SAIF learner code**, and the IFI you stamp for SAIF-cohort learners should be built from **that codified id** — **not** a real name/email.
- Don't leak real PII into the xAPI actor for SAIF-cohort learners. Your own product may hold richer identity internally; the SAIF-cohort xAPI it emits should carry only the codified id, so SAIF's no-real-PII trial classification holds.

## 5. Unchanged — the integration contract

Everything else is per [`HANDOVER.md`](HANDOVER.md) + the vendored **Profile v1.2** and the ingestion contract: you emit evidence statements to SAIF's LRS; SAIF ingests to mastery (`source="lrs_ingestion"`). No shared DB, no shared auth — just xAPI + the handshake. Re-sync the vendored snapshots after the first agreed profile change.

## 6. What we need from you

1. **Your Azure deployment shape** (App Service vs container/VM + persistent volume) → settles the §2 SQLite verification.
2. **Your launch + auth model** → pins the §3 / Q1 identity contract (handshake identifier + actor IFI + account linking across the two login paths).
3. (Then the speaking→KLP mapping **Q2** and the rich-signal set **Q3**, per `HANDOVER.md` — unchanged.)

---

_Scope wall (unchanged): the Speaking app's architecture, STT, and its own persistence stay your team's; SAIF owns integration, ingestion, the rich-signal store, and the KLP mapping/rubric. This note references the canonical SAIF docs — treat the vendored Profile v1.2 + ingestion contract as authoritative, not this cover letter alone._
