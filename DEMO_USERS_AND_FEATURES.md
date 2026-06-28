# Speaking Lab Demo Users and Feature Walkthrough

Updated: 2026-06-15  
App URL: `http://localhost:3000/`

## Verified Login Accounts

Use these accounts to compare the app from each role.

| Role | Username | Password | Display name | Best use |
| --- | --- | --- | --- | --- |
| Student | `1` | `1` | Ahmed Ali | Primary learner demo with the richest history. |
| Student | `1001` | `1001` | Layla Hassan | Secondary learner demo for teacher comparison and review flags. |
| Teacher | `teacher` | `teacher` | Teacher | Classroom review, class monitor, and student progress comparison. |
| Admin | `admin` | `admin` | Administrator | Admin-only setup: students, books, cycles, practice stages, speech, TTS, AI, system status. |

For a direct student/teacher comparison, log in as `1` in one browser session and `teacher` in another. If you only use one browser window, log out before switching accounts.

## Demo Data Status

The demo cycle has been refreshed so the student accounts show current classroom context.

| Item | Value |
| --- | --- |
| Current demo cycle | Cycle `2` |
| Dates shown to learners | `2026-06-15` to `2026-06-30` |
| Book | `Everyday English - Level 1` |
| CEFR level | `A1` |
| Vocabulary/tasks | 30 words and 30 practice tasks |
| Class | `Class A` |
| Demo homework | `Demo speaking homework`, due `2026-06-22` |

## Student Walkthrough

Use `username: 1`, `password: 1` for the fullest learner view.

| Feature | Path | What to check |
| --- | --- | --- |
| Practice hub | `/practice/hub` | Current cycle, book, progress widgets, mastery data, and customize panel. |
| Core speaking practice | `/practice` | Listen/repeat/read/sentence/free-speak/review stages, recording, transcript, and scoring. |
| Weak Words | `/practice/weak-words` | Non-mastered words plus text-practice and fluency weak words grouped for targeted Repeat, Read Aloud, Sentence, and Free Speak practice. |
| Word drill | Open a word from practice | Pronunciation and score breakdown for one vocabulary item. |
| Text practice | `/practice/texts` | Saved learner text and reading practice workflow. Ahmed has `writing`; Layla has `Demo reading: At the library`. |
| Weak-word lists | `/practice/texts/lists` | Saved weak-word remediation lists when available. |
| Fluency drills | `/practice/fluency` | Monologue, shadowing, and scenario role-play entry points. |
| Monologue practice | `/practice/fluency/monologue` | Timed 4/3/2 fluency drill and improvement scoring. |
| Shadowing | `/practice/fluency/shadowing` | Listen-and-shadow timing and accuracy practice. |
| AI conversation | `/practice/conversation` | Free conversation practice with the configured AI provider. |
| Scenario role-play | `/practice/conversation?mode=scenarios` | Real-world tasks such as ordering coffee, then criteria-based score. |
| Mic self-test | `/settings/mic-test` | STT engine check and local/cloud fallback behavior. |
| History | `/history` or `/practice/history` | Previous attempts and scores. |
| Diagnostic | `/onboarding/diagnostic` | 2-minute speaking check for estimated level and fluency baseline. |

Student demo coverage currently verified through the live API:

| Student | Practice attempts | Texts | Text attempts | Fluency sessions | Scenario attempts | Homework |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ahmed Ali (`1`) | 103 | 1 | 4 | 1 | 12 | 1 |
| Layla Hassan (`1001`) | 17 | 1 | 1 | 1 | 1 | 1 |

## Teacher Walkthrough

Use `username: teacher`, `password: teacher`.

| Feature | Path | What to check |
| --- | --- | --- |
| Teacher dashboard | `/teacher` | Class list, attempt counts, recent average score, and flagged students. |
| Student review | Open Ahmed or Layla from `/teacher` | Per-student cycle, vocabulary, attempts, score history, and mastery evidence. |
| Attempt review | Open an attempt from a student page | Transcript, score dimensions, teacher score override, and notes. |
| Class monitor | `/teacher/monitor` | Recently active students and live class activity window. This is most useful while a student is actively recording. |
| Progress report | `/reports/progress/1` | Historical progress view for Ahmed. |
| Homework API/data | `/api/homework?cycleId=2` | Teacher-visible homework assignment data for the current demo cycle. |

Teacher demo coverage currently verified:

| Check | Result |
| --- | --- |
| Login | Passed |
| Teacher dashboard route | HTTP 200 |
| Class monitor route | HTTP 200 |
| Teacher review route | HTTP 200 |
| Teacher dashboard API | Shows 13 active students |
| Homework for cycle `2` | 1 assignment |
| Layla review flags | Open flags exist in the database for teacher review evidence |

## Admin Walkthrough

Student and teacher accounts intentionally do not show admin controls. Use `username: admin`, `password: admin` to inspect all setup and model-management functionality.

| Feature | Path |
| --- | --- |
| Student management | `/admin/students` |
| Book and vocabulary management | `/admin/books` |
| Cycle management | `/admin/cycles` |
| Custom practice sets | `/admin/practice-sets` |
| Practice stage sequencing | `/admin/stages` |
| Live sessions | `/admin/live-session` |
| Model overview | `/admin/models` |
| STT settings | `/admin/models/stt` |
| TTS settings | `/admin/models/tts` |
| AI settings | `/admin/models/ai` |
| System status | `/admin/status` |

## UI Note: Toggle Buttons

The STT/TTS/AI settings and dashboard customization toggles now use the shared `Switch` component at `web/src/components/shared/switch.tsx`. This keeps the track and knob aligned consistently and gives each switch proper `role="switch"` and `aria-checked` semantics.

## Verified Route Coverage

The following accounts were checked against the live app on `http://localhost:3000/`:

| Account | Verified pages/APIs |
| --- | --- |
| Student `1` | Dashboard redirect, practice, practice hub, text practice, fluency, AI conversation, mic test, history, practice API, text API, homework API |
| Student `1001` | Dashboard redirect, practice, practice hub, text practice, fluency, AI conversation, mic test, history, practice API, text API, homework API |
| Teacher `teacher` | Teacher dashboard, class monitor, review page, teacher dashboard API, class monitor API |
| Admin `admin` | Students, books, cycles, practice sets, stages, live session, model pages, STT/TTS/AI settings, system status, admin APIs |

## Practical Comparison Script

1. Open `http://localhost:3000/`.
2. Log in as student `1` / `1`.
3. Visit `/practice/hub`, `/practice`, `/practice/texts`, `/practice/fluency`, and `/practice/conversation?mode=scenarios`.
4. Log out.
5. Log in as teacher `teacher` / `teacher`.
6. Open `/teacher`, then review Ahmed Ali and Layla Hassan.
7. Compare what the student sees as practice tasks with what the teacher sees as evidence and progress.
8. For admin-only setup, log in as `admin` / `admin` and open `/admin/models/stt`, `/admin/models/tts`, and `/admin/models/ai`.

## Role Boundary Reminder

No single non-admin user displays every app feature by design:

- Students see learning and practice functionality.
- Teachers see review, monitoring, and classroom evidence.
- Admins see setup, model configuration, curriculum, and system operations.

To demonstrate the whole app, use the student, teacher, and admin accounts together.
