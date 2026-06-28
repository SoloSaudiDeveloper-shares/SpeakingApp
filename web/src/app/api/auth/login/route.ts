import { cookies } from 'next/headers';
import { login } from '@/lib/actions/auth-actions';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return Response.json({ error: 'Username and password are required.' }, { status: 400 });
    }

    const result = await login(username, password);
    if (!result) {
      return Response.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    const cookieStore = await cookies();
    cookieStore.set('session-token', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.SESSION_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
      path: '/',
    });

    return Response.json({ user: result.user });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
