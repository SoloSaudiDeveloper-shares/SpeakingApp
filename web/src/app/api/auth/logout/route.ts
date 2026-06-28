import { cookies } from 'next/headers';
import { logout } from '@/lib/actions/auth-actions';
import { NextRequest, NextResponse } from 'next/server';

function redirectHome() {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: '/',
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (token) {
      await logout(token);
    }
    cookieStore.delete('session-token');

    // If form submission, redirect to login page
    const accept = req.headers.get('accept') || '';
    if (accept.includes('text/html')) {
      return redirectHome();
    }
    return Response.json({ success: true });
  } catch {
    return redirectHome();
  }
}
