import { calculateScore } from '@/lib/scoring/score-calculator';
import { generateFeedback } from '@/lib/scoring/feedback';
import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

/**
 * GET /api/dev/test-stages
 * Admin-only end-to-end sanity check for stage scoring & feedback.
 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user || user.role !== 'Admin') {
    return Response.json({ error: 'Admin only.' }, { status: 403 });
  }

  const cases = [
    {
      stage: 'repeat',
      transcript: 'door',
      expected: ['door'],
      duration: 1,
      description: 'Perfect repeat of the word',
    },
    {
      stage: 'sentence',
      transcript: 'please open the door',
      expected: ['Please open the door.'],
      duration: 2,
      description: 'Full sentence said correctly',
    },
    {
      stage: 'sentence',
      transcript: 'open the door',
      expected: ['Please open the door.'],
      duration: 1.5,
      description: 'Partial sentence (missing "please")',
    },
    {
      stage: 'free-speak',
      transcript: 'i open the door every morning when i go to school',
      expected: ['door'],
      duration: 4,
      description: 'Free speak — long sentence using the target word',
    },
    {
      stage: 'free-speak',
      transcript: 'i went to the store',
      expected: ['door'],
      duration: 2,
      description: 'Free speak — sentence WITHOUT the target word',
    },
    {
      stage: 'read-aloud',
      transcript: 'door',
      expected: ['door'],
      duration: 0.8,
      description: 'Read aloud — single word, fast',
    },
  ];

  const results = cases.map(c => {
    const breakdown = calculateScore({
      transcript: c.transcript,
      expectedAnswersJson: JSON.stringify(c.expected),
      spokenPhonemes: null,
      referencePhonemes: null,
      audioDurationSeconds: c.duration,
      bestPreviousScore: 0,
      latestPreviousScore: 0,
      previousAttemptCount: 0,
      cefrBand: 'A1' as const,
    });
    const fb = generateFeedback(breakdown, c.transcript, c.expected, c.duration);
    return {
      stage: c.stage,
      description: c.description,
      transcript: c.transcript,
      target: c.expected[0],
      breakdown,
      headline: fb.overall.headline,
    };
  });

  return Response.json({ results }, { headers: { 'Cache-Control': 'no-store' } });
}
