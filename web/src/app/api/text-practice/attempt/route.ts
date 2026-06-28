import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { recordTextAttempt } from '@/lib/actions/text-practice-actions';
import { db } from '@/lib/db';
import { studentTexts } from '@/lib/db/schema';
import { compareTextToTranscript } from '@/lib/scoring/text-comparison';
import { computeFluencyMetrics } from '@/lib/scoring/fluency-metrics';
import { and, eq } from 'drizzle-orm';

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toNonNegativeNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
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
    const {
      studentTextId,
      spokenTranscript,
      durationSeconds,
    } = body;

    const textId = toPositiveInt(studentTextId);
    if (!textId || spokenTranscript === undefined) {
      return Response.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    const text = db
      .select()
      .from(studentTexts)
      .where(and(eq(studentTexts.id, textId), eq(studentTexts.studentId, user.studentId)))
      .get();
    if (!text) return Response.json({ error: 'Text not found.' }, { status: 404 });

    const transcript = typeof spokenTranscript === 'string' ? spokenTranscript : '';
    const duration = toNonNegativeNumber(durationSeconds);
    const comparison = compareTextToTranscript(text.originalText, transcript);
    const fluency = computeFluencyMetrics({
      transcript,
      audioDurationSeconds: duration,
      cefrBand: 'A1',
    });

    const attempt = recordTextAttempt({
      studentTextId: textId,
      studentId: user.studentId,
      spokenTranscript: transcript,
      accuracyScore: comparison.accuracyScore,
      pronunciationScore: 0,
      fluencyScore: Math.round(fluency.fluencyIndex * 100),
      completenessScore: comparison.completenessScore,
      weakWords: comparison.weakWords,
      durationSeconds: duration,
    });

    return Response.json({ attempt });
  } catch (error) {
    console.error('Text attempt save error:', error);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
