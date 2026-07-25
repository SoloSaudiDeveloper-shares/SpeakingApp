import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

function unauthorized(message: string) {
  const response = NextResponse.json({ error: message }, { status: 401 });
  response.cookies.set('session-token', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SESSION_COOKIE_SECURE === 'true',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set('view-as', '', {
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) {
      return unauthorized('Not authenticated.');
    }

    const user = await getSessionFromToken(token, { allowPasswordChange: true });
    if (!user) {
      return unauthorized('Session expired.');
    }

    return Response.json({ user });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
