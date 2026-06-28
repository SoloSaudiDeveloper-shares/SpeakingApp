import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname.startsWith('/api/dev') &&
    process.env.NODE_ENV === 'production' &&
    process.env.ENABLE_DEV_DIAGNOSTICS !== 'true'
  ) {
    return NextResponse.json({ error: 'Developer diagnostics are disabled.' }, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/dev/:path*'],
};
