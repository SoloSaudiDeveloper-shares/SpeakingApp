import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import {
  getStudentXp,
  getStudentBadges,
  getStreak,
  getDailyGoal,
  getLeaderboard,
} from '@/lib/actions/gamification-actions';

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ error: 'Not a student.' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const className = searchParams.get('className') ?? undefined;

    const xp = getStudentXp(user.studentId);
    const studentBadges = getStudentBadges(user.studentId);
    const streak = getStreak(user.studentId);
    const dailyGoal = getDailyGoal(user.studentId);
    const leaderboard = getLeaderboard(className);

    return Response.json({ xp, badges: studentBadges, streak, dailyGoal, leaderboard });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
