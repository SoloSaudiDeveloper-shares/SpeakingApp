import { cookies } from 'next/headers';
import { getSessionFromToken, changePassword } from '@/lib/actions/auth-actions';
import { sessionCookieOptions } from '@/lib/auth/session-cookie';
import { passwordPolicyViolation } from '@/lib/utils/password';
import {
  clearSharedRateLimit,
  consumeSharedRateLimit,
  normalizedAccountSubject,
  sharedRateLimitResponse,
} from '@/lib/security/rate-limit-server';
import {
  jsonBodyErrorResponse,
  readBoundedJson,
} from '@/lib/security/request-body';
import { mutationRequestViolation } from '@/lib/security/request-protection';

export async function POST(request: Request) {
  try {
    const violation = mutationRequestViolation(request);
    if (violation) return Response.json({ error: 'Request is not allowed.' }, { status: 403 });
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token, { allowPasswordChange: true });
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    const body = await readBoundedJson(request, 8 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'All fields are required.' }, { status: 400 });
    }
    const { currentPassword, newPassword } = body as Record<string, unknown>;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      return Response.json({ error: 'All fields are required.' }, { status: 400 });
    }
    const passwordViolation = passwordPolicyViolation(newPassword, {
      username: user.username,
      displayName: user.displayName ?? undefined,
    });
    if (passwordViolation) {
      return Response.json({ error: passwordViolation }, { status: 400 });
    }
    if (currentPassword === newPassword) {
      return Response.json({ error: 'New password must be different from the current password.' }, { status: 400 });
    }

    const accountSubject = normalizedAccountSubject(user.username);
    await consumeSharedRateLimit({
      scope: 'change-password-account',
      subjectHash: accountSubject,
      limit: 10,
      windowSeconds: 15 * 60,
    });
    const success = await changePassword(user.id, currentPassword, newPassword, token);
    if (!success) {
      return Response.json({ error: 'Current password is incorrect.' }, { status: 400 });
    }
    await clearSharedRateLimit('change-password-account', accountSubject);

    cookieStore.set('must-change-password', '', {
      ...sessionCookieOptions(),
      maxAge: 0,
    });
    return Response.json({ success: true });
  } catch (error) {
    const bodyResponse = jsonBodyErrorResponse(error);
    if (bodyResponse) return bodyResponse;
    const rateLimitResponse = sharedRateLimitResponse(error);
    if (rateLimitResponse) return rateLimitResponse;
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
