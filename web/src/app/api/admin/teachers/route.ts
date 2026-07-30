import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getTeacherAccounts } from '@/lib/actions/admin-actions';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user || user.role !== 'Admin') {
    return Response.json({ error: 'Admin only.' }, { status: 403 });
  }
  return Response.json({ teachers: await getTeacherAccounts() });
}
