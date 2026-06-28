import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { analyzeDiagnosticSamples, getOnboardingState, markOnboarded, saveDiagnostic, type DiagnosticSample } from '@/lib/actions/onboarding-actions';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ onboarded: true, hasDiagnostic: true, notAStudent: true });
    return Response.json(getOnboardingState(user.studentId));
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
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

    if (body.action === 'complete-tour') {
      markOnboarded(user.studentId);
      return Response.json({ ok: true });
    }

    if (body.action === 'save-diagnostic') {
      const samples: DiagnosticSample[] = Array.isArray(body.samples) ? body.samples : [];
      const result = analyzeDiagnosticSamples(samples);
      saveDiagnostic(user.studentId, result, body.applyCefr !== false);
      markOnboarded(user.studentId);
      return Response.json({ ok: true, result });
    }

    return Response.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    console.error('onboarding error:', e);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
