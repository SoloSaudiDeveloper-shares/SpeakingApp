import { cookies } from 'next/headers';
import { login } from '@/lib/actions/auth-actions';
import {
  SESSION_COOKIE_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from '@/lib/auth/session-cookie';
import {
  clearSharedRateLimit,
  consumeSharedRateLimit,
  normalizedAccountSubject,
  requestRateLimitSubjects,
  sharedRateLimitResponse,
} from '@/lib/security/rate-limit-server';
import {
  jsonBodyErrorResponse,
  readBoundedJson,
} from '@/lib/security/request-body';
import { mutationRequestViolation } from '@/lib/security/request-protection';

const LOGIN_BODY_MAX_BYTES = 8 * 1024;

export async function POST(request: Request) {
  try {
    const mutationViolation = mutationRequestViolation(request);
    if (mutationViolation) {
      return Response.json({ error: 'Request is not allowed.' }, { status: 403 });
    }
    const subjects = requestRateLimitSubjects(request);
    await consumeSharedRateLimit({
      scope: 'login-ip',
      subjectHash: subjects.ip,
      limit: 60,
      windowSeconds: 15 * 60,
    });
    await consumeSharedRateLimit({
      scope: 'login-origin',
      subjectHash: subjects.origin,
      limit: 500,
      windowSeconds: 15 * 60,
    });

    const body = await readBoundedJson(request, LOGIN_BODY_MAX_BYTES);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Invalid username or password.' }, { status: 401 });
    }
    const { username, password } = body as Record<string, unknown>;
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      !username ||
      !password ||
      username.length > 128 ||
      password.length > 256
    ) {
      return Response.json({ error: 'Username and password are required.' }, { status: 400 });
    }
    const accountSubject = normalizedAccountSubject(username);
    await consumeSharedRateLimit({
      scope: 'login-account',
      subjectHash: accountSubject,
      limit: 10,
      windowSeconds: 15 * 60,
    });

    const result = await login(username, password);
    if (!result) {
      return Response.json({ error: 'Invalid username or password.' }, { status: 401 });
    }
    await clearSharedRateLimit('login-account', accountSubject);

    const cookieStore = await cookies();
    cookieStore.set('session-token', result.token, {
      ...sessionCookieOptions(),
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });
    cookieStore.set('must-change-password', result.user.mustChangePassword ? '1' : '', {
      ...sessionCookieOptions(),
      maxAge: result.user.mustChangePassword ? 7 * 24 * 60 * 60 : 0,
    });

    return Response.json({ user: result.user });
  } catch (error) {
    const bodyResponse = jsonBodyErrorResponse(error);
    if (bodyResponse) return bodyResponse;
    const rateLimitResponse = sharedRateLimitResponse(error);
    if (rateLimitResponse) return rateLimitResponse;
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
