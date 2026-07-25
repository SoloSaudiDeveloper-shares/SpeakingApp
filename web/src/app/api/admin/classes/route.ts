import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getDistinctClasses } from '@/lib/actions/admin-actions';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
  if (user.role !== 'Admin' && user.role !== 'Teacher') {
    return Response.json({ error: 'Forbidden.' }, { status: 403 });
  }
  return Response.json({ classes: await getDistinctClasses() });
}
