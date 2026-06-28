import { cookies } from 'next/headers';
import { db } from '../db';
import { userAccounts, sessions, students, cycles, studentCycles } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { hashPassword, verifyPassword } from '../utils/password';

export { hashPassword, verifyPassword };

export type SessionUser = {
  id: number;
  username: string;
  role: string;
  studentId: number | null;
  displayName: string | null;
};

export async function login(
  username: string,
  password: string
): Promise<{ user: SessionUser; token: string } | null> {
  const user = db
    .select()
    .from(userAccounts)
    .where(and(eq(userAccounts.username, username), eq(userAccounts.isActive, true)))
    .get();

  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;

  // Generate session token
  const token = nanoid(48);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7-day sessions

  db.insert(sessions)
    .values({
      token,
      userId: user.id,
      expiresAt: expiresAt.toISOString(),
    })
    .run();

  // Update last login
  db.update(userAccounts)
    .set({ lastLoginAt: new Date().toISOString() })
    .where(eq(userAccounts.id, user.id))
    .run();

  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      studentId: user.studentId,
      displayName: user.displayName,
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
  // Check if username already exists
  const existing = db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.username, username))
    .get();

  if (existing) return null;

  const now = new Date().toISOString();

  // Create student record
  const [student] = db
    .insert(students)
    .values({
      uniqueNumber: username,
      fullName,
      class: studentClass || null,
      cefrBand: 'A1',
      isActive: true,
    })
    .returning()
    .all();

  // Create user account
  const passwordHash = hashPassword(password);
  const [user] = db
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
    .returning()
    .all();

  // Generate session
  const token = nanoid(48);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  db.insert(sessions)
    .values({
      token,
      userId: user.id,
      expiresAt: expiresAt.toISOString(),
    })
    .run();

  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      studentId: user.studentId,
      displayName: user.displayName,
    },
    token,
  };
}

/**
 * A sample student for the admin/teacher "view as learner" preview — the first
 * active student enrolled in the most recent cycle, so every learner feature is
 * populated with real data. Falls back to any active student.
 */
export function getPreviewStudentId(): number | null {
  const cycle = db.select().from(cycles).orderBy(desc(cycles.id)).get();
  if (cycle) {
    const enrolled = db
      .select({ id: students.id })
      .from(studentCycles)
      .innerJoin(students, eq(students.id, studentCycles.studentId))
      .where(and(eq(studentCycles.cycleId, cycle.id), eq(students.isActive, true)))
      .orderBy(students.id)
      .get();
    if (enrolled) return enrolled.id;
  }
  const any = db.select({ id: students.id }).from(students).where(eq(students.isActive, true)).orderBy(students.id).get();
  return any?.id ?? null;
}

export async function getSessionFromToken(token: string): Promise<SessionUser | null> {
  const session = db
    .select()
    .from(sessions)
    .where(eq(sessions.token, token))
    .get();

  if (!session) return null;

  // Check expiration
  if (new Date(session.expiresAt) < new Date()) {
    db.delete(sessions).where(eq(sessions.token, token)).run();
    return null;
  }

  const user = db
    .select()
    .from(userAccounts)
    .where(and(eq(userAccounts.id, session.userId), eq(userAccounts.isActive, true)))
    .get();

  if (!user) return null;

  // "View as learner" preview: when an admin/teacher (who has no studentId)
  // sets the view-as=student cookie, act as a sample student so every learner
  // page/endpoint is populated — no need to log in as a different account.
  let studentId = user.studentId;
  if (!studentId && (user.role === 'Admin' || user.role === 'Teacher')) {
    try {
      const ck = await cookies();
      if (ck.get('view-as')?.value === 'student') studentId = getPreviewStudentId();
    } catch { /* outside a request context */ }
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    studentId,
    displayName: user.displayName,
  };
}

export async function logout(token: string): Promise<void> {
  db.delete(sessions).where(eq(sessions.token, token)).run();
}

export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const user = db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.id, userId))
    .get();

  if (!user) return false;
  if (!verifyPassword(currentPassword, user.passwordHash)) return false;

  const newHash = hashPassword(newPassword);
  db.update(userAccounts)
    .set({ passwordHash: newHash })
    .where(eq(userAccounts.id, userId))
    .run();

  return true;
}
