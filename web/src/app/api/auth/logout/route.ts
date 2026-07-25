import { cookies } from 'next/headers';
import { logout } from '@/lib/actions/auth-actions';
import { NextRequest, NextResponse } from 'next/server';

function redirectHome() {
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: '/',
    },
  });
  clearAuthCookies(response);
  return response;
}

function clearAuthCookies(response: NextResponse) {
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
  response.cookies.set('must-change-password', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SESSION_COOKIE_SECURE === 'true',
    path: '/',
    maxAge: 0,
  });
}

export async function POST(req: NextRequest) {
  const accept = req.headers.get('accept') || '';
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (token) {
      try {
        await logout(token);
      } catch {
        // A stale cookie should not stop the browser from being logged out.
      }
    }

    // If form submission, redirect to login page
    if (accept.includes('text/html')) {
      return redirectHome();
    }
    const response = NextResponse.json({ success: true });
    clearAuthCookies(response);
    return response;
  } catch {
    if (accept.includes('text/html')) {
      return redirectHome();
    }
    const response = NextResponse.json({ success: true });
    clearAuthCookies(response);
    return response;
  }
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (token) {
      try {
        await logout(token);
      } catch {
        // Manual browser reset should still clear cookies if the DB session is stale.
      }
    }
  } catch {
    // Fall through to a cookie-clearing redirect.
  }
  return redirectHome();
}
