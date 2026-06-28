# KLP Scenario Assignment And Study Plan Integration

## What This Adds

- Teachers and admins can generate KLP-based role-play scenario drafts from selected KLPs.
- Published KLP scenarios can be assigned as study-plan work to:
  - a cycle/cohort,
  - a class,
  - selected individual students.
- Cycle is the v1 cohort model.
- Student Practice Hub now shows assigned KLP study-plan work.
- Assigned KLP scenarios appear first in AI Conversation and are labeled `Assigned`.
- Weak Words can show KLP source labels when a weak vocabulary item is linked to imported KLP data.
- Reports and KLP exports include assignment context.

## How KLPs Connect

- `practice_task_klps` links existing vocabulary practice tasks to KLP concepts.
- `scenario_klps` links generated KLP role-play scenarios to KLP concepts.
- `homework_assignments` now stores KLP study-plan assignments with:
  - `target_type`: `cycle`, `class`, or `student`
  - `student_ids_json`
  - `klp_ids_json`
  - `scenario_ids_json`
  - `source`: `klp`
  - `status`: `assigned` or `archived`
- `attempt_klp_results` stores speaking-performance evidence after linked practice or scenario attempts.
- `student_klp_summaries` stores per-student KLP result summaries.

## Important Scoring Boundary

KLP success means the learner passed a speaking-performance task linked to the KLP.

The app does not claim grammar mastery from speech. Grammar and function KLPs can guide prompts and scenario context, but they remain `context_only` and export as unassessed.

Speaking evidence is based on:

- target use,
- pronunciation,
- fluency,
- completeness,
- consistency,
- scenario interaction success.

## Teacher Workflow

1. Open `KLP Planner` from the teacher sidebar or `Curriculum KLPs` from the admin sidebar.
2. Browse/filter KLPs by book, lesson, domain, and support status.
3. Select KLPs.
4. Generate a scenario draft.
5. Review and publish it.
6. Assign the published scenario, or selected KLPs without a scenario, to a cycle/cohort, class, or selected students.

## Student Workflow

1. Student opens Practice Hub.
2. Assigned KLP work appears in `Lesson Speaking Focus`.
3. If the assignment includes a scenario, the student starts AI Conversation.
4. Assigned scenarios appear first and are labeled `Assigned`.
5. Scenario completion records KLP-linked speaking evidence.

## Verification

- Build: `npm run build` from `C:\Users\malfa\speaking\web`.
- Quality checks: `GET /api/dev/learning-quality`.
- Expected KLP import baseline:
  - `7,420` KLP concepts,
  - `4,268` active question-shape rows.
