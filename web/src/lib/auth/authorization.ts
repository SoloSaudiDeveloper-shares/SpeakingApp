import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import {
  getSessionFromToken,
  type SessionUser,
} from '@/lib/actions/auth-actions';
import { db } from '@/lib/db';
import { attempts, students } from '@/lib/db/schema';

export type AppRole = 'Admin' | 'Teacher' | 'Student';

type AuthSuccess = { ok: true; user: SessionUser };
type AuthFailure = { ok: false; response: Response };
export type AuthResult = AuthSuccess | AuthFailure;

function failure(message: string, status: 401 | 403): AuthFailure {
  return {
    ok: false,
    response: Response.json(
      { error: message },
      { status, headers: { 'Cache-Control': 'no-store' } },
    ),
  };
}

export async function requireAuthenticated(options: {
  roles?: readonly AppRole[];
  allowPasswordChange?: boolean;
} = {}): Promise<AuthResult> {
  const token = (await cookies()).get('session-token')?.value;
  if (!token) return failure('Not authenticated.', 401);

  const user = await getSessionFromToken(token, {
    allowPasswordChange: options.allowPasswordChange,
  });
  if (!user) return failure('Session expired.', 401);
  if (
    options.roles &&
    !options.roles.includes(user.role as AppRole)
  ) {
    return failure('Not authorized.', 403);
  }
  return { ok: true, user };
}

export async function requireAdmin(): Promise<AuthResult> {
  return requireAuthenticated({ roles: ['Admin'] });
}

export async function requireStudent(): Promise<AuthResult> {
  const auth = await requireAuthenticated({ roles: ['Student'] });
  if (!auth.ok) return auth;
  if (!auth.user.studentId) return failure('Student account is not linked.', 403);
  return auth;
}

export function canAccessStudent(user: SessionUser, studentId: number): boolean {
  if (user.role === 'Admin' || user.role === 'Teacher') return true;
  return user.role === 'Student' && user.studentId === studentId;
}

export async function getAuthorizedAttempt(
  user: SessionUser,
  attemptId: number,
) {
  const row = (await db
    .select({
      attempt: attempts,
      studentClass: students.class,
    })
    .from(attempts)
    .innerJoin(students, eq(students.id, attempts.studentId))
    .where(eq(attempts.id, attemptId))
    .limit(1))[0];
  if (!row || !canAccessStudent(user, row.attempt.studentId)) return null;
  return row;
}

export async function getAuthorizedAttemptByAudioPath(
  user: SessionUser,
  audioPath: string,
) {
  const row = (await db
    .select({
      attempt: attempts,
      studentClass: students.class,
    })
    .from(attempts)
    .innerJoin(students, eq(students.id, attempts.studentId))
    .where(eq(attempts.audioPath, audioPath))
    .limit(1))[0];
  if (!row || !canAccessStudent(user, row.attempt.studentId)) return null;
  return row;
}
