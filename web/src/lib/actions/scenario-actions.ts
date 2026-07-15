import { db } from '../db';
import { scenarioAttempts } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

export function recordScenarioAttempt(data: {
  studentId: number;
  scenarioId: string;
  transcript: { role: string; content: string }[];
  criteriaMet: boolean[];
  score: number;
  feedback: string;
  sessionId: string;
  learnerTurns: number;
  completionReason: 'manual' | 'goals-met' | 'max-turns';
}) {
  const existing = db.select().from(scenarioAttempts).where(eq(scenarioAttempts.sessionId, data.sessionId)).get();
  if (existing) return existing;
  return db
    .insert(scenarioAttempts)
    .values({
      studentId: data.studentId,
      scenarioId: data.scenarioId,
      transcriptJson: JSON.stringify(data.transcript),
      criteriaMetJson: JSON.stringify(data.criteriaMet),
      score: data.score,
      feedback: data.feedback,
      sessionId: data.sessionId,
      learnerTurns: data.learnerTurns,
      completionReason: data.completionReason,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

export function findScenarioAttemptBySession(sessionId: string) {
  return db.select().from(scenarioAttempts).where(eq(scenarioAttempts.sessionId, sessionId)).get();
}

export function getScenarioHistory(studentId: number, limit = 50) {
  return db
    .select()
    .from(scenarioAttempts)
    .where(eq(scenarioAttempts.studentId, studentId))
    .orderBy(desc(scenarioAttempts.createdAt))
    .limit(limit)
    .all();
}
