# Speaking Tutor Q3 signal proposal

Status: proposal only. The producer emits Profile v1.2 core fields until SAIF publishes agreed extension IRIs.

The Speaking Tutor can currently measure and retain:

- transcript and reference-text match;
- Azure word and phoneme accuracy, error type, and weakest sounds when Azure Pronunciation Assessment is configured;
- transcript-only pronunciation proxy when Azure is unavailable, explicitly labelled as basic scoring;
- speech rate, articulation rate, pause count, pause duration, pauses per minute, mean length of run, and a CEFR-banded fluency index;
- recording duration, transcript word count, completeness, consistency, and composite score;
- scenario goal outcomes, goal evidence/reasons, learner turn count, completion reason, and final scenario score.

Recommended next agreement with SAIF:

1. Decide which signals affect mastery and which remain audit-only.
2. Define units, allowed ranges, missing-value behavior, and privacy/retention rules.
3. Publish canonical extension IRIs in the SAIF profile.
4. Add fixture statements and round-trip ingestion tests before enabling any rich extensions.

No provisional extension names are emitted by Speaking Tutor.
