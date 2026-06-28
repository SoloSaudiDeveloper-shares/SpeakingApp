import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getTeacherDashboard } from '@/lib/actions/teacher-actions';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user || (user.role !== 'Admin' && user.role !== 'Teacher')) {
      return Response.json({ error: 'Not authorized.' }, { status: 403 });
    }
    return Response.json({ students: getTeacherDashboard() });
  } catch (e) {
    console.error('teacher dashboard error:', e);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
