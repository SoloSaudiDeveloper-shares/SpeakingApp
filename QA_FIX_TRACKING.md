# QA Fix Tracking

Updated: 2026-06-16

## Demo Logins

Use these to compare the student and teacher views:

| Role | Username | Password | Use |
| --- | --- | --- | --- |
| Student | `1` | `1` | Richest learner history and practice data |
| Student | `1001` | `1001` | Layla Hassan, useful for diagnostic and teacher review checks |
| Teacher | `teacher` | `teacher` | Teacher review, class monitor, reports |
| Admin | `admin` | `admin` | Practice stages and model settings |

## Issues Caught And Fixed

- [x] Replaced the visually broken hand-built toggle buttons in STT, TTS, AI, and dashboard customization with a shared accessible `Switch`.
- [x] Fixed scoring for extra or repeated words. Example: expected `house`, transcript `speak. house. house.` is no longer treated as perfect.
- [x] Updated feedback so extra words are named directly instead of praising the attempt.
- [x] Added homophone-aware scoring for isolated words such as `write` and `right`.
- [x] Updated homophone feedback so isolated ambiguous words ask for sentence context instead of saying the answer was perfect.
- [x] Fixed practice stage scoring so each stage saves and scores against the actual stage target, not always the base word.
- [x] Fixed Practice Stages unlock logic so completing Listen or passing the current stage unlocks the next sequential stage.
- [x] Added local tracking for Listen-stage completion, because Listen does not create a spoken attempt.
- [x] Added a new student `Weak Words` tab that filters out mastered words and links weak words directly into Repeat, Read Aloud, Sentence, and Free Speak practice.
- [x] Merged saved text-practice weak-word lists and fluency shadowing weak words into the Weak Words page.
- [x] Rebuilt Free Speak as vocabulary-in-sentence scoring, so valid sentences are not penalized as extra words but must include the displayed word or phrase.
- [x] Added generic Free Speak target matching for single words, short phrases, punctuation/case-insensitive matching, and known single-word homophones such as `write` / `right`.
- [x] Added clear score explanations and percentage hints to practice score cards, including the Free Speak rows `Target Word/Phrase`, `Content`, `Fluency`, and `Sentence`.
- [x] Fixed a client/server score mismatch where the browser used the book CEFR level but the save endpoint used the student's CEFR level. Practice pages now load the student CEFR band and use the server-authoritative saved score.
- [x] Made fluency visible on normal practice score cards because it contributes to the composite, including single-word recall/repeat stages.
- [x] Fixed basic pronunciation scoring so an exact transcript/target match like `water` vs `water` receives `100%` pronunciation. Known homophones still receive ambiguity credit instead of perfect pronunciation.
- [x] Added AI content grading metadata for Free Speak using the active Admin AI provider, with AI explaining measured fluency but not changing the numeric fluency score.
- [x] Reused the same server AI content-grading helper in both `/api/practice/content-grade` and `/api/practice/attempt`, so saved Free Speak attempts are server-graded.
- [x] Added provisional Free Speak behavior when AI is unavailable: local scoring still works, but passing is capped and the UI warns the student/admin.
- [x] Added Azure-only pronunciation weak-word evidence capture for `Mispronunciation`, `Omission`, or word accuracy below `75`.
- [x] Added pronunciation weak words to the Weak Words page with source labels and links into Repeat, Read Aloud, Sentence, and Free Speak when the word exists in vocabulary.
- [x] Hardened diagnostic placement against false input, short clips, and repeated nonsense with high WPM.
- [x] Made the first student speaking diagnostic required before normal dashboard/practice access when `diagnostic_json` is missing.
- [x] Added a `/practice/*` route guard so direct practice links cannot bypass the required diagnostic for real student accounts.
- [x] Created a timestamped pre-integration backup under `outputs/backups/speaking-backup-20260616-122912.zip`.
- [x] Added custom portal SSO launch support at `/sso/launch?token=...` using short-lived HS256 JWTs.
- [x] Added external identity mapping and replay-protection tables for portal SSO launches.
- [x] Added protected integration API endpoints for health, roster upsert, and external student summary.
- [x] Added `EXTERNAL_INTEGRATION.md` with SSO payload, env vars, and API usage.
- [x] Changed “Skip for now” into a session-only escape hatch using `sessionStorage`, without setting `onboarded_at`.
- [x] Upgraded the diagnostic into a balanced check: mic/STT readiness, read aloud, short repeat, free speak, and optional active-cycle vocabulary recall.
- [x] Stored a richer speaking profile in `diagnostic_json`: CEFR, fluency, speech rate, pronunciation average, content score, skill bands, strengths, weaknesses, starting stage, and recommended path.
- [x] Added a learner-facing diagnostic result screen with starting level, strengths, practice priorities, and links to the recommended path, Weak Words, and Fluency Drills.
- [x] Added the dashboard `Your Speaking Profile` widget with level, last check date, weakest focus, retake action, and first recommended practice step.
- [x] Added admin/student-management visibility for speaking check completion and a reset action so students can be asked to retake the check.
- [x] Added teacher dashboard CEFR override and speaking-check reset controls without granting password/delete powers.
- [x] Separated recall readiness from speaking fluency in diagnostic routing, so weak recall routes to Review/Weak Words instead of incorrectly lowering fluency.
- [x] Added regression checks for extra words, homophones, diagnostic false input, coherent diagnostic input, Free Speak, and Azure pronunciation weak-word evidence to `/api/dev/learning-quality`.
- [x] Added regression checks for required diagnostic false input, pronunciation-focused path, low-fluency path, low-content path, and weak-recall path.

## What To Re-Test In The Browser

- [x] Log in as student `1` / `1` and open `/practice/weak-words`.
- [ ] Use a weak word's `Repeat`, `Read aloud`, `Sentence`, and `Free speak` links and confirm the selected word stays active.
- [ ] On `/practice`, complete Listen, then confirm the next stage unlocks in `/practice/hub`.
- [ ] Say extra words around a target word and confirm the score drops and feedback names the extra words.
- [ ] Open `/practice?stage=free-speak`, say a meaningful sentence without the target word, and confirm it is capped at or below 45% with target-word feedback.
- [ ] Open `/practice?stage=free-speak`, say a meaningful sentence with the target word or phrase, and confirm it can pass without "extra words" feedback.
- [ ] Open `/practice?stage=free-speak` with phrase targets such as `thank you` or `how much` and confirm the exact phrase sequence is required.
- [ ] Open `/practice?stage=free-speak`, say one word only, and confirm the Free Speak score stays low.
- [ ] Open `/practice?stage=free-speak`, say repeated nonsense, and confirm it cannot pass.
- [ ] On any scored practice result, confirm the row explanations are readable and do not crowd the score card.
- [ ] Say `water` for a recall/review stage and confirm the browser score matches the saved server score, with fluency visible as a contributing row.
- [ ] Try a reference stage with an Azure-detected weak word and confirm it appears in `/practice/weak-words` as `Pronunciation` or `Multiple sources`.
- [ ] Try `right` for target `write` and confirm the feedback explains the homophone/context issue.
- [x] Log in as admin `admin` / `admin` and check `/admin/models/stt`, `/admin/models/tts`, and `/admin/models/ai` toggle alignment.
- [ ] Run the speaking diagnostic with false/repeated input and confirm it does not place the student high.
- [ ] Reset a student diagnostic from `/admin/students`, then log in as that student and confirm `/dashboard` redirects to `/onboarding/diagnostic`.
- [ ] Reset or override a student from `/teacher`, then confirm the student row updates and the learner is prompted to retake the diagnostic.
- [ ] Click `Skip for this session`, confirm `/practice/hub` opens, then start a new browser session and confirm the speaking check appears again.
- [ ] Complete the diagnostic with mixed results and confirm the result screen shows level, strengths, practice priorities, and recommended path.
- [ ] After completion, confirm `/practice/hub` shows the `Your Speaking Profile` dashboard card and the retake action.
- [ ] Test a weak vocabulary recall sample and confirm the recommended path starts with Review/Weak Words rather than Sentence practice.

## Verification Commands

- [x] `npm run build` from `web`
- [x] `GET http://localhost:3000/api/dev/learning-quality`
- [x] `/api/dev/learning-quality` passes `49/49` checks after the required diagnostic changes.
- [x] `/api/dev/learning-quality` passes `55/55` checks after SSO token validation checks were added.
- [x] `GET /api/integrations/health` returns locked-down `503` until `INTEGRATION_API_KEY` is configured.
- [x] Authenticated `POST /api/practice/content-grade` returned coherence, reason, fluency comment, provider, and model.
- [x] Student page smoke checks against `/practice`, `/practice/hub`, `/practice/weak-words`
- [x] Admin page smoke checks against `/admin/models/stt`, `/admin/models/tts`, `/admin/models/ai`

## Open Follow-Up Ideas

- [ ] Track weak words from scenario role-play and AI conversation explicitly. Those features do not currently persist word-level misses, so guessing them from free conversation would be unreliable.
- [ ] Add teacher-facing filters for weak words by class, student, skill, and stage.
- [ ] Add a teacher override for homophone/context pairs that should require full-sentence practice.
- [ ] Add end-to-end browser tests for stage unlocks and weak-word routing once a stable test runner is chosen.
