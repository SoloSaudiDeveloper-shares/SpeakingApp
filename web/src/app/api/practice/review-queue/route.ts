import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getReviewQueue } from '@/lib/actions/spaced-repetition-actions';
import { getCurrentCycle } from '@/lib/actions/practice-actions';

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ error: 'Not a student.' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const cycleIdParam = searchParams.get('cycleId');

    let cycleId: number;
    if (cycleIdParam) {
      cycleId = Number(cycleIdParam);
    } else {
      const cycleData = await getCurrentCycle(user.studentId);
      if (!cycleData) return Response.json({ queue: [] });
      cycleId = cycleData.cycle.id;
    }

    const queue = await getReviewQueue(user.studentId, cycleId);

    return Response.json({ queue });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
