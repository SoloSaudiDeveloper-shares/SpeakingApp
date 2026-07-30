import { db } from '../db';
import { scenarioAttempts } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

export async function recordScenarioAttempt(data: {
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
  const [inserted] = await db
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
    .onConflictDoNothing({ target: scenarioAttempts.sessionId })
    .returning();
  if (inserted) return inserted;
  const existing = ((await db.select().from(scenarioAttempts).where(eq(scenarioAttempts.sessionId, data.sessionId)).limit(1))[0]);
  if (!existing) throw new Error('Scenario attempt could not be persisted.');
  return existing;
}

export async function findScenarioAttemptBySession(sessionId: string) {
  return ((await db.select().from(scenarioAttempts).where(eq(scenarioAttempts.sessionId, sessionId)).limit(1))[0]);
}

export async function getScenarioHistory(studentId: number, limit = 50) {
  return (await db
    .select()
    .from(scenarioAttempts)
    .where(eq(scenarioAttempts.studentId, studentId))
    .orderBy(desc(scenarioAttempts.createdAt))
    .limit(limit));
}
