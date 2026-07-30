import { NextRequest, NextResponse } from 'next/server';
import { mutationRequestViolation } from '@/lib/security/request-protection';

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const violation = mutationRequestViolation(request);
    if (violation) {
      return NextResponse.json(
        { error: violation },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.next();
  }

  if (
    request.cookies.get('must-change-password')?.value === '1' &&
    request.nextUrl.pathname !== '/change-password'
  ) {
    return NextResponse.redirect(new URL('/change-password', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
