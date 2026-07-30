import { NextRequest, NextResponse } from 'next/server';
import { IntegrationError, launchExternalSso } from '@/lib/integrations/external-auth';
import {
  SESSION_COOKIE_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from '@/lib/auth/session-cookie';

function secureLaunchResponse(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return secureLaunchResponse(
      NextResponse.json({ error: 'Missing launch token.' }, { status: 400 }),
    );
  }

  try {
    const result = await launchExternalSso(token);
    const redirectUrl = new URL(result.redirectTo, request.url);
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set('session-token', result.token, {
      ...sessionCookieOptions(),
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });
    return secureLaunchResponse(response);
  } catch (error) {
    if (error instanceof IntegrationError) {
      return secureLaunchResponse(
        NextResponse.json({ error: error.message }, { status: error.status }),
      );
    }
    console.error('external sso launch error:', error);
    return secureLaunchResponse(
      NextResponse.json({ error: 'External SSO launch failed.' }, { status: 500 }),
    );
  }
}
