import { computeFluencyMetrics, scoreMonologueImprovement, scoreTimingMatch } from '@/lib/scoring/fluency-metrics';
import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user || user.role !== 'Admin') return Response.json({ error: 'Admin only.' }, { status: 403 });

  const cases = [
    {
      name: 'fluent B1 sentence (smooth, no pauses)',
      input: { transcript: 'I usually wake up early and go to work by bus', audioDurationSeconds: 4, pauseEvents: [], cefrBand: 'B1' as const },
    },
    {
      name: 'hesitant A2 (many pauses)',
      input: { transcript: 'I... um... go to school', audioDurationSeconds: 6, pauseEvents: [{ durationMs: 900 }, { durationMs: 1200 }, { durationMs: 800 }], cefrBand: 'A2' as const },
    },
    {
      name: 'fast B2 (native-like pace)',
      input: { transcript: 'Honestly the best part of my job is meeting new people every single day', audioDurationSeconds: 4.5, pauseEvents: [{ durationMs: 500 }], cefrBand: 'B2' as const },
    },
    {
      name: 'no speech',
      input: { transcript: '', audioDurationSeconds: 3, pauseEvents: [], cefrBand: 'A1' as const },
    },
  ];

  const metrics = cases.map((c) => ({ name: c.name, metrics: computeFluencyMetrics(c.input) }));

  const monologue = scoreMonologueImprovement([
    { speechRateWpm: 70, articulationRateWpm: 90, fluencyIndex: 0.45 },
    { speechRateWpm: 85, articulationRateWpm: 110, fluencyIndex: 0.60 },
    { speechRateWpm: 100, articulationRateWpm: 125, fluencyIndex: 0.72 },
  ]);

  const timing = {
    perfect: scoreTimingMatch(3.0, 3.0),
    slightlyFast: scoreTimingMatch(3.0, 2.5),
    rushed: scoreTimingMatch(3.0, 1.5),
    dragging: scoreTimingMatch(3.0, 5.0),
  };

  return Response.json({ metrics, monologueImprovement: monologue, timingMatch: timing }, { headers: { 'Cache-Control': 'no-store' } });
}
