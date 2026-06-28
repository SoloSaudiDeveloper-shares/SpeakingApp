# KPI Reporting Status And Plan

Updated: 2026-06-27

## Current Status

The KPI/reporting foundation is implemented and tested, but the teacher/customer reporting workflow is not finished in every product aspect.

## Implemented

- Shared report aggregation layer in `web/src/lib/actions/report-actions.ts`.
- Teacher/admin report APIs:
  - `GET /api/reports/overview`
  - `GET /api/reports/class`
  - `GET /api/reports/student/:id`
  - `GET /api/reports/audio`
  - `POST /api/reports/ai-insight`
- Teacher command center at `/teacher`.
- Visual reports at `/reports`.
- Teacher report authorization: students are blocked from report APIs.
- Student AI Tutor Insight uses the shared progress/report signals.
- KLP coverage is surfaced as speaking-performance traceability, not grammar mastery.
- Learning-quality tests cover report aggregation consistency, bounded KPI values, AI fallback, and student access control.

## KPI Signals Currently Available

- Total students.
- Active students.
- Diagnostic completion rate.
- Total attempts.
- Attempts in selected date range.
- Average score.
- Pass rate.
- Average pronunciation.
- Average fluency.
- Average content/coherence.
- Weak-word count.
- Audio attempt count.
- Students needing attention.
- Class-level summaries.
- Student-level summaries.
- Top weak words.
- Recent/audio attempts.
- Deterministic teacher insights when AI is unavailable.

## Existing Markdown Evidence

- `outputs/reviews/TEACHER_PLATFORM_TEST_REPORT.md`
- `outputs/reviews/STUDENT_PLATFORM_TEST_REPORT.md`
- `outputs/reviews/CUSTOMER_CRITICAL_REVIEW.md`
- `outputs/klp-qa/QA_REPORT.md`
- `outputs/deep-qa/post-fix-qa-report.md`
- `outputs/deep-qa/learning-fluency-audit-report.md`
- `QA_FIX_TRACKING.md`

## Not Finished Yet

- Printable/exportable reports for teacher, student, parent/customer, and admin views.
- CSV/PDF export with date range summaries.
- Teacher assignment workflow with due dates and class-level actions.
- Priority tiers for attention flags, such as urgent, watch, stable, and missing diagnostic.
- Bulk diagnostic reminders or "require speaking check" actions.
- Strong audio evidence workflow. Current tested data showed `audioAttemptCount` as 0, so audio review/reporting exists structurally but is not meaningful until recordings are captured and retained consistently.
- KLP learning evidence is shallow. The workbook and coverage layer exist, but practiced KLP results are not yet rich enough for customer-ready curriculum reporting.
- Longitudinal improvement validation over weeks of practice.
- Real-audio calibration against Arabic L1 learners across microphones, noise, accents, and levels.
- A customer-facing KPI definitions page that explains exactly what each KPI means and what it does not mean.

## Recommended Next Plan

1. Add KPI definitions/help text inside `/reports` and `/teacher`.
2. Add attention tiers instead of one broad `needs attention` flag.
3. Add teacher actions from each KPI card:
   - require diagnostic
   - assign weak words
   - assign repeat/read-aloud
   - publish scenario
   - review audio
4. Add PDF/CSV export for class and student reports.
5. Add sample completed KLP-linked attempts so KLP coverage reports show real evidence.
6. Ensure audio recording retention is consistent for scored attempts.
7. Add a 4-week seeded learner dataset to validate trend lines and improvement KPIs.
8. Add a customer-facing report glossary:
   - speaking score
   - pronunciation
   - fluency
   - content/coherence
   - weak words
   - KLP coverage
   - diagnostic completion
   - what the app does not grade, especially grammar mastery.

## Verdict

KPI work is partly complete:

- Engineering foundation: complete enough for dashboards and current reports.
- Automated validation: present and passing.
- Teacher/customer workflow: not complete.
- Formal KPI documentation: now started in this file, but should be expanded into an in-app glossary and report export guide.
