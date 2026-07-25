import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  if (
    request.cookies.get('must-change-password')?.value === '1' &&
    request.nextUrl.pathname !== '/change-password'
  ) {
    return NextResponse.redirect(new URL('/change-password', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
