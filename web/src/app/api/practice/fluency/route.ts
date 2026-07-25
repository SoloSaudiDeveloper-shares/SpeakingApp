import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { recordFluencyDrill, getFluencyDrillHistory } from '@/lib/actions/fluency-actions';
import { db } from '@/lib/db';
import { studentCycles, students } from '@/lib/db/schema';
import { compareTextToTranscript } from '@/lib/scoring/text-comparison';
import {
  computeFluencyMetrics,
  monologueSufficiency,
  scoreContentQuality,
  scoreMonologueImprovement,
  scoreTimingMatch,
  type CefrBand,
} from '@/lib/scoring/fluency-metrics';
import { and, eq } from 'drizzle-orm';

function toPositiveIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toNonNegativeNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function coerceBand(value: unknown): CefrBand {
  return value === 'A2' || value === 'B1' || value === 'B2' ? value : 'A1';
}

type RoundInput = Record<string, unknown>;

function sanitizeMonologueRounds(rounds: RoundInput[], cefrBand: CefrBand) {
  return rounds.map((round, index) => {
    const transcript = typeof round.transcript === 'string' ? round.transcript : '';
    const actualSeconds = toNonNegativeNumber(round.actualSeconds);
    const wordTimings = Array.isArray(round.wordTimings) ? round.wordTimings.flatMap((timing) => {
      if (!timing || typeof timing !== 'object') return [];
      const item = timing as Record<string, unknown>;
      const word = typeof item.word === 'string' ? item.word.trim() : '';
      const start = toNonNegativeNumber(item.start);
      const end = toNonNegativeNumber(item.end);
      return word && end >= start ? [{ word, start, end }] : [];
    }) : [];
    const scoredPauseThresholdMs = Math.max(500, Math.min(3000, toNonNegativeNumber(round.scoredPauseThresholdMs) || 1000));
    const rawMetrics = computeFluencyMetrics({ transcript, audioDurationSeconds: actualSeconds, wordTimings, scoredPauseThresholdMs, cefrBand });
    const speechSeconds = Math.max(0, rawMetrics.audioDurationSeconds - rawMetrics.totalPauseSeconds);
    const sufficiency = monologueSufficiency(rawMetrics.wordCount, speechSeconds);
    const content = scoreContentQuality(transcript);
    const fluencyIndex = Math.round(Math.max(0, Math.min(1, rawMetrics.fluencyIndex * sufficiency * content)) * 1000) / 1000;

    return {
      round: toNonNegativeNumber(round.round) || index + 1,
      limitSeconds: toNonNegativeNumber(round.limitSeconds),
      actualSeconds: Math.round(actualSeconds),
      transcript,
      wordCount: rawMetrics.wordCount,
      speechRateWpm: rawMetrics.speechRateWpm,
      articulationRateWpm: rawMetrics.articulationRateWpm,
      fluencyIndex,
      pauseCount: rawMetrics.pauseCount,
      pausePerMin: rawMetrics.pausePerMin,
      totalPauseSeconds: rawMetrics.totalPauseSeconds,
      meanLengthOfRun: rawMetrics.meanLengthOfRun,
      scoredPauseThresholdMs,
      wordTimings,
      serverScored: true,
      sufficiency,
      contentQuality: content,
    };
  });
}

function sanitizeShadowingRounds(rounds: RoundInput[]) {
  return rounds.map((round) => {
    const sentence = typeof round.sentence === 'string' ? round.sentence : '';
    const transcript = typeof round.transcript === 'string' ? round.transcript : '';
    const refDurationSec = toNonNegativeNumber(round.refDurationSec);
    const studentDurationSec = toNonNegativeNumber(round.studentDurationSec ?? round.actualSeconds);
    const comparison = compareTextToTranscript(sentence, transcript);
    const accuracy = comparison.accuracyScore / 100;
    const timingMatch = scoreTimingMatch(refDurationSec, studentDurationSec);
    const composite = Math.round((accuracy * 0.7 + timingMatch * 0.3) * 1000) / 1000;

    return {
      sentence,
      transcript,
      refDurationSec,
      studentDurationSec,
      accuracy,
      timingMatch,
      composite,
      weakWords: comparison.weakWords,
      azureWords: Array.isArray(round.azureWords) ? round.azureWords : [],
      pronunciationProvider: Array.isArray(round.azureWords) && round.azureWords.length > 0 ? 'azure' : 'basic-transcript',
      actualSeconds: studentDurationSec,
      wordCount: transcript.trim().split(/\s+/).filter(Boolean).length,
      speechRateWpm: 0,
      articulationRateWpm: 0,
      fluencyIndex: composite,
      serverScored: true,
    };
  });
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ error: 'Not a student.' }, { status: 403 });

    const body = await request.json();
    if (body.drillType !== 'monologue' && body.drillType !== 'shadowing') {
      return Response.json({ error: 'Invalid drillType.' }, { status: 400 });
    }

    const cycleId = toPositiveIntOrNull(body.cycleId);
    if (cycleId) {
      const enrollment = ((await db
        .select()
        .from(studentCycles)
        .where(and(eq(studentCycles.studentId, user.studentId), eq(studentCycles.cycleId, cycleId))).limit(1))[0]);
      if (!enrollment) return Response.json({ error: 'Not enrolled in this cycle.' }, { status: 403 });
    }

    const student = ((await db.select().from(students).where(eq(students.id, user.studentId)).limit(1))[0]);
    const cefrBand = coerceBand(student?.cefrBand);
    const roundInputs: RoundInput[] = Array.isArray(body.rounds)
      ? body.rounds.filter((round: unknown): round is RoundInput => !!round && typeof round === 'object' && !Array.isArray(round))
      : [];

    const rounds = body.drillType === 'monologue'
      ? sanitizeMonologueRounds(roundInputs, cefrBand)
      : sanitizeShadowingRounds(roundInputs);

    const improvementScore = body.drillType === 'monologue'
      ? scoreMonologueImprovement((rounds as ReturnType<typeof sanitizeMonologueRounds>).map((round) => ({
          speechRateWpm: round.speechRateWpm,
          articulationRateWpm: round.articulationRateWpm,
          fluencyIndex: round.fluencyIndex,
        })))
      : (rounds.length > 0
          ? Math.round(((rounds as ReturnType<typeof sanitizeShadowingRounds>).reduce((sum, round) => sum + round.composite, 0) / rounds.length) * 1000) / 1000
          : 0);

    const session = await recordFluencyDrill({
      studentId: user.studentId,
      cycleId,
      drillType: body.drillType,
      topicId: typeof body.topicId === 'string' ? body.topicId : null,
      rounds,
      improvementScore,
    });

    return Response.json({ session });
  } catch (e) {
    console.error('Fluency drill save error:', e);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ sessions: [] });

    return Response.json({ sessions: await getFluencyDrillHistory(user.studentId) });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
