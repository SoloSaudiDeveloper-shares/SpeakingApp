import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { checkAndAwardBadges } from '@/lib/actions/gamification-actions';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ error: 'Not a student.' }, { status: 403 });

    const newBadges = checkAndAwardBadges(user.studentId);

    return Response.json({ newBadges });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
