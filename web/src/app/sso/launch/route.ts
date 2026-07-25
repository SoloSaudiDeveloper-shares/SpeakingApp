import { NextRequest, NextResponse } from 'next/server';
import { IntegrationError, launchExternalSso } from '@/lib/integrations/external-auth';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Missing launch token.' }, { status: 400 });
  }

  try {
    const result = await launchExternalSso(token);
    const redirectUrl = new URL(result.redirectTo, request.url);
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set('session-token', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.SESSION_COOKIE_SECURE === 'true',
      path: '/',
    });
    return response;
  } catch (error) {
    if (error instanceof IntegrationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('external sso launch error:', error);
    return NextResponse.json({ error: 'External SSO launch failed.' }, { status: 500 });
  }
}
