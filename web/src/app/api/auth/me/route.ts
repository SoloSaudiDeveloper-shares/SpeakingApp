import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) {
      return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const user = await getSessionFromToken(token);
    if (!user) {
      return Response.json({ error: 'Session expired.' }, { status: 401 });
    }

    return Response.json({ user });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
