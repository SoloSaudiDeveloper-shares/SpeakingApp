import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { gradeOpenResponseContent } from '@/lib/ai/content-grade';

/**
 * POST /api/practice/content-grade
 * Body: { transcript: string, topic?: string, fluencyMetrics?: object }
 *
 * Semantic content check for open spoken tasks. The app owns deterministic
 * numeric fluency scoring; the AI only judges coherence and explains the
 * measured fluency metrics in one short comment.
 */
export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    const body = await request.json();
    const transcript = String(body.transcript ?? '').trim();
    const topic = String(body.topic ?? '').trim();
    const fluencyMetrics = body.fluencyMetrics && typeof body.fluencyMetrics === 'object'
      ? body.fluencyMetrics
      : null;

    return Response.json(await gradeOpenResponseContent({ transcript, topic, fluencyMetrics }));
  } catch (e) {
    console.error('content-grade error:', e);
    return Response.json({
      coherence: null,
      reason: null,
      fluencyComment: null,
      aiAvailable: false,
      provider: 'ollama',
      model: 'unknown',
    });
  }
}
