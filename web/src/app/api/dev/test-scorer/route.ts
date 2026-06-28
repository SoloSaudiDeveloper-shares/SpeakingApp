import { calculateScore } from '@/lib/scoring/score-calculator';
import { generateFeedback } from '@/lib/scoring/feedback';
import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user || user.role !== 'Admin') {
    return Response.json({ error: 'Admin only.' }, { status: 403 });
  }

  type TestCase = {
    name: string;
    transcript: string;
    expected: string[];
    duration: number;
    history?: { best: number; latest: number; count: number };
  };

  const cases: TestCase[] = [
    { name: 'no speech', transcript: '', expected: ['door'], duration: 3 },
    { name: 'silence dot', transcript: '.', expected: ['door'], duration: 3 },
    { name: 'punctuation only', transcript: '...', expected: ['door'], duration: 2 },
    { name: 'perfect single word', transcript: 'door', expected: ['door'], duration: 1 },
    { name: 'perfect single word (fast)', transcript: 'door', expected: ['door'], duration: 0.6 },
    { name: 'wrong word', transcript: 'window', expected: ['door'], duration: 1 },
    { name: 'similar word', transcript: 'doore', expected: ['door'], duration: 1 },
    { name: 'mispronounced 1 letter', transcript: 'dor', expected: ['door'], duration: 1 },
    { name: 'mispronounced 2 letters', transcript: 'dur', expected: ['door'], duration: 1 },
    { name: 'perfect sentence', transcript: 'please open the door', expected: ['please open the door'], duration: 1.6 },
    { name: 'partial sentence', transcript: 'open the door', expected: ['please open the door'], duration: 1.5 },
    { name: 'wrong sentence', transcript: 'i went to the store', expected: ['please open the door'], duration: 2 },
    { name: 'rushed (single word)', transcript: 'door', expected: ['door'], duration: 0.1 },
    { name: 'hesitation single word', transcript: 'door', expected: ['door'], duration: 4 },
  ];

  const results = cases.map((c) => {
    const breakdown = calculateScore({
      transcript: c.transcript,
      expectedAnswersJson: JSON.stringify(c.expected),
      spokenPhonemes: null,
      referencePhonemes: null,
      audioDurationSeconds: c.duration,
      bestPreviousScore: c.history?.best ?? 0,
      latestPreviousScore: c.history?.latest ?? 0,
      previousAttemptCount: c.history?.count ?? 0,
      cefrBand: 'A1' as const,
    });
    const feedback = generateFeedback(breakdown, c.transcript, c.expected, c.duration);
    return {
      name: c.name,
      transcript: c.transcript,
      target: c.expected[0],
      duration: c.duration,
      breakdown,
      headline: feedback.overall.headline,
      summary: feedback.overall.summary,
      strengthsCount: feedback.strengths.length,
      weaknessesList: feedback.weaknesses.map((w) => `${w.dimension}: ${w.message}`),
    };
  });

  return Response.json({ results }, { headers: { 'Cache-Control': 'no-store' } });
}
