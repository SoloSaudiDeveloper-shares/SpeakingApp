import { db } from '../db';
import { fluencyDrillSessions } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

export interface FluencyDrillRound {
  round?: number;
  limitSeconds?: number;
  actualSeconds: number;
  transcript: string;
  wordCount: number;
  speechRateWpm: number;
  articulationRateWpm: number;
  fluencyIndex: number;
  // shadowing-specific (optional)
  sentence?: string;
  refDurationSec?: number;
  studentDurationSec?: number;
  accuracy?: number;
  timingMatch?: number;
  weakWords?: string[];
}

export async function recordFluencyDrill(data: {
  studentId: number;
  cycleId?: number | null;
  drillType: 'monologue' | 'shadowing';
  topicId?: string | null;
  rounds: FluencyDrillRound[];
  improvementScore: number;
}) {
  return ((await db
    .insert(fluencyDrillSessions)
    .values({
      studentId: data.studentId,
      cycleId: data.cycleId ?? null,
      drillType: data.drillType,
      topicId: data.topicId ?? null,
      roundsJson: JSON.stringify(data.rounds),
      improvementScore: data.improvementScore,
      createdAt: new Date().toISOString(),
    })
    .returning())[0]);
}

export async function getFluencyDrillHistory(studentId: number, limit = 50) {
  return (await db
    .select()
    .from(fluencyDrillSessions)
    .where(eq(fluencyDrillSessions.studentId, studentId))
    .orderBy(desc(fluencyDrillSessions.createdAt))
    .limit(limit));
}
