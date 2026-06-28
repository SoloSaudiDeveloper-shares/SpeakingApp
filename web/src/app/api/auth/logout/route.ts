import { cookies } from 'next/headers';
import { logout } from '@/lib/actions/auth-actions';
import { NextRequest, NextResponse } from 'next/server';

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
    if (accept.includes('text/html') || !accept.includes('application/json')) {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return Response.json({ success: true });
  } catch {
    return NextResponse.redirect(new URL('/', req.url));
  }
}
