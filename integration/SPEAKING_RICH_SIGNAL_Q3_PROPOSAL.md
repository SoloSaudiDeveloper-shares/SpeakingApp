# Q3 proposal — speaking signals (not emitted in Profile v1.2)

The application currently measures pronunciation and phoneme details (when Azure Speech is
available), transcript completeness, fluency, pace, pause timings, and scenario performance.

These values remain inside Speaking Lab until SAIF publishes names and semantics for their
extension IRIs. The initial xAPI release emits only the pinned Profile v1.2 core:

- per-assessed-KLP actor, verb, activity, success, and scaled score;
- speaking modality;
- stable `speaking-lab` source application.

Proposed discussion fields for Q3 are pronunciation accuracy, weak phonemes, fluency index,
speech/articulation rate, scored pause count/duration/threshold, transcript coverage, scenario
criteria achieved, and scenario completion reason. None drives SAIF mastery independently,
and no unregistered extension IRI is invented in this release.
