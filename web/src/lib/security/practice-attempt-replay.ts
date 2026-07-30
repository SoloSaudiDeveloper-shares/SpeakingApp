export type ReplayableAttempt = {
  id: number;
  studentId: number;
  clientSubmissionId: string | null;
  cycleId: number;
  bookId: number;
  practiceTaskId: number;
  timestamp: string;
  audioPath: string | null;
  rawTranscript: string | null;
  rescoredTranscript: string | null;
  targetMatchScore: number;
  pronunciationScore: number;
  fluencyScore: number;
  completenessScore: number;
  consistencyScore: number;
  compositeScore: number;
  teacherOverrideScore: number | null;
  teacherNotes: string | null;
  metricsJson: string | null;
};

export function practiceAttemptReplayPayload(attempt: ReplayableAttempt) {
  return {
    attempt: { ...attempt, idempotentReplay: true },
    score: {
      targetMatch: attempt.targetMatchScore,
      pronunciation: attempt.pronunciationScore,
      fluency: attempt.fluencyScore,
      completeness: attempt.completenessScore,
      consistency: attempt.consistencyScore,
      composite: attempt.compositeScore,
    },
    klpResults: [],
    idempotentReplay: true,
  };
}
