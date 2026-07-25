import { cookies } from 'next/headers';
import { db } from '../db';
import { userAccounts, sessions, students, cycles, studentCycles } from '../db/schema';
import { eq, and, desc, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../utils/password';
import { createHash } from 'crypto';

export { hashPassword, verifyPassword };

export type SessionUser = {
  id: number;
  username: string;
  role: string;
  studentId: number | null;
  displayName: string | null;
  mustChangePassword: boolean;
};

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function login(
  username: string,
  password: string
): Promise<{ user: SessionUser; token: string } | null> {
  const user = ((await db
    .select()
    .from(userAccounts)
    .where(and(eq(userAccounts.username, username), eq(userAccounts.isActive, true))).limit(1))[0]);

  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;

  // Generate session token
  const token = nanoid(48);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7-day sessions

  (await db.insert(sessions)
    .values({
      tokenHash: hashSessionToken(token),
      userId: user.id,
      expiresAt: expiresAt.toISOString(),
    }));

  // Update last login
  (await db.update(userAccounts)
    .set({ lastLoginAt: new Date().toISOString() })
    .where(eq(userAccounts.id, user.id)));

  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      studentId: user.studentId,
      displayName: user.displayName,
      mustChangePassword: user.mustChangePassword,
    },
    token,
  };
}

export async function register(
  username: string,
  password: string,
  fullName: string,
  studentClass?: string
): Promise<{ user: SessionUser; token: string } | null> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  // Check if username already exists
  const existing = ((await db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.username, username)).limit(1))[0]);

  if (existing) return null;

  const now = new Date().toISOString();

  // Create student record
  const [student] = (await db
    .insert(students)
    .values({
      uniqueNumber: username,
      fullName,
      class: studentClass || null,
      cefrBand: 'A1',
      isActive: true,
    })
    .returning());

  // Create user account
  const passwordHash = hashPassword(password);
  const [user] = (await db
    .insert(userAccounts)
    .values({
      username,
      passwordHash,
      role: 'Student',
      studentId: student.id,
      displayName: fullName,
      isActive: true,
      createdAt: now,
    })
    .returning());

  // Generate session
  const token = nanoid(48);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  (await db.insert(sessions)
    .values({
      tokenHash: hashSessionToken(token),
      userId: user.id,
      expiresAt: expiresAt.toISOString(),
    }));

  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      studentId: user.studentId,
      displayName: user.displayName,
      mustChangePassword: user.mustChangePassword,
    },
    token,
  };
}

/**
 * A sample student for the admin/teacher "view as learner" preview — the first
 * active student enrolled in the most recent cycle, so every learner feature is
 * populated with real data. Falls back to any active student.
 */
export async function getPreviewStudentId(): Promise<number | null> {
  const cycle = ((await db.select().from(cycles).orderBy(desc(cycles.id)).limit(1))[0]);
  if (cycle) {
    const enrolled = ((await db
      .select({ id: students.id })
      .from(studentCycles)
      .innerJoin(students, eq(students.id, studentCycles.studentId))
      .where(and(eq(studentCycles.cycleId, cycle.id), eq(students.isActive, true)))
      .orderBy(students.id).limit(1))[0]);
    if (enrolled) return enrolled.id;
  }
  const any = ((await db.select({ id: students.id }).from(students).where(eq(students.isActive, true)).orderBy(students.id).limit(1))[0]);
  return any?.id ?? null;
}

export async function getSessionFromToken(
  token: string,
  options: { allowPasswordChange?: boolean } = {},
): Promise<SessionUser | null> {
  const tokenHash = hashSessionToken(token);
  const session = ((await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash)).limit(1))[0]);

  if (!session) return null;

  // Check expiration
  if (new Date(session.expiresAt) < new Date()) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }

  const user = ((await db
    .select()
    .from(userAccounts)
    .where(and(eq(userAccounts.id, session.userId), eq(userAccounts.isActive, true))).limit(1))[0]);

  if (!user) return null;
  if (user.mustChangePassword && !options.allowPasswordChange) return null;

  // "View as learner" preview: when an admin/teacher (who has no studentId)
  // sets the view-as=student cookie, act as a sample student so every learner
  // page/endpoint is populated — no need to log in as a different account.
  let studentId = user.studentId;
  if (!studentId && (user.role === 'Admin' || user.role === 'Teacher')) {
    try {
      const ck = await cookies();
      if (ck.get('view-as')?.value === 'student') studentId = await getPreviewStudentId();
    } catch { /* outside a request context */ }
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    studentId,
    displayName: user.displayName,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function logout(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}

export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
  currentSessionToken: string,
): Promise<boolean> {
  const user = ((await db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.id, userId)).limit(1))[0]);

  if (!user) return false;
  if (!verifyPassword(currentPassword, user.passwordHash)) return false;

  const newHash = hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.update(userAccounts)
      .set({ passwordHash: newHash, mustChangePassword: false })
      .where(eq(userAccounts.id, userId));
    await tx.delete(sessions).where(and(
      eq(sessions.userId, userId),
      ne(sessions.tokenHash, hashSessionToken(currentSessionToken)),
    ));
  });

  return true;
}
