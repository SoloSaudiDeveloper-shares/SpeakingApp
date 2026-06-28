import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getLiveSessions, createLiveSession } from '@/lib/actions/admin-actions';

async function requireTeacherOrAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return { error: 'Not authenticated.', status: 401 } as const;
  const user = await getSessionFromToken(token);
  if (!user) return { error: 'Session expired.', status: 401 } as const;
  if (user.role !== 'Admin' && user.role !== 'Teacher') {
    return { error: 'Teacher/Admin only.', status: 403 } as const;
  }
  return { user } as const;
}

export async function GET() {
  const auth = await requireTeacherOrAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ sessions: getLiveSessions() });
}

export async function POST(req: Request) {
  const auth = await requireTeacherOrAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json();
  if (!body.cycleId || !body.taskType) {
    return Response.json({ error: 'cycleId and taskType are required' }, { status: 400 });
  }
  const session = createLiveSession({
    cycleId: Number(body.cycleId),
    createdByUserId: auth.user.id,
    taskType: body.taskType,
    className: body.className ?? null,
    wordIds: body.wordIds ?? [],
  });
  return Response.json({ session });
}
