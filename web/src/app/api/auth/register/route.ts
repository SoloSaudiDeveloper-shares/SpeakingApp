import { register } from '@/lib/actions/auth-actions';
import { passwordPolicyViolation } from '@/lib/utils/password';
import {
  consumeSharedRateLimit,
  requestRateLimitSubjects,
  sharedRateLimitResponse,
} from '@/lib/security/rate-limit-server';
import {
  jsonBodyErrorResponse,
  readBoundedJson,
} from '@/lib/security/request-body';
import { mutationRequestViolation } from '@/lib/security/request-protection';

const REGISTER_BODY_MAX_BYTES = 16 * 1024;
const GENERIC_REGISTRATION_RESPONSE = {
  success: true,
  message: 'If the account can be created, it is now ready for sign in.',
};

export async function POST(request: Request) {
  try {
    const mutationViolation = mutationRequestViolation(request);
    if (mutationViolation) {
      return Response.json({ error: 'Request is not allowed.' }, { status: 403 });
    }
    const subjects = requestRateLimitSubjects(request);
    await consumeSharedRateLimit({
      scope: 'register-ip',
      subjectHash: subjects.ip,
      limit: 20,
      windowSeconds: 60 * 60,
    });
    await consumeSharedRateLimit({
      scope: 'register-origin',
      subjectHash: subjects.origin,
      limit: 100,
      windowSeconds: 60 * 60,
    });

    const body = await readBoundedJson(request, REGISTER_BODY_MAX_BYTES);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'All fields are required.' }, { status: 400 });
    }
    const { username, password, displayName, className } = body as Record<string, unknown>;
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      typeof displayName !== 'string' ||
      !username.trim() ||
      !displayName.trim() ||
      username.length > 128 ||
      displayName.length > 200 ||
      (className !== undefined && (typeof className !== 'string' || className.length > 100))
    ) {
      return Response.json({ error: 'All fields are required.' }, { status: 400 });
    }
    const passwordViolation = passwordPolicyViolation(password, {
      username,
      displayName,
    });
    if (passwordViolation) {
      return Response.json(
        { error: passwordViolation },
        { status: 400 },
      );
    }

    const result = await register(
      username.trim(),
      password,
      displayName.trim(),
      typeof className === 'string' ? className.trim() : undefined,
    );
    if (!result) {
      return Response.json(GENERIC_REGISTRATION_RESPONSE, { status: 201 });
    }

    return Response.json(GENERIC_REGISTRATION_RESPONSE, { status: 201 });
  } catch (error) {
    const bodyResponse = jsonBodyErrorResponse(error);
    if (bodyResponse) return bodyResponse;
    const rateLimitResponse = sharedRateLimitResponse(error);
    if (rateLimitResponse) return rateLimitResponse;
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
