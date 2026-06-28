import { cookies } from 'next/headers';
import { getSessionFromToken, changePassword } from '@/lib/actions/auth-actions';

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    const { currentPassword, newPassword } = await request.json();
    if (!currentPassword || !newPassword) {
      return Response.json({ error: 'All fields are required.' }, { status: 400 });
    }

    const success = await changePassword(user.id, currentPassword, newPassword);
    if (!success) {
      return Response.json({ error: 'Current password is incorrect.' }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
