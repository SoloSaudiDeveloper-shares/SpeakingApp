import { createHmac, timingSafeEqual } from 'crypto';
import { nanoid } from 'nanoid';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  attempts,
  externalIdentities,
  externalSsoLaunches,
  sessions,
  students,
  userAccounts,
} from '@/lib/db/schema';
import { hashPassword } from '@/lib/utils/password';
import { getCurrentCycle, getStudentAttempts, getWordMastery } from '@/lib/actions/practice-actions';
import { hashSessionToken } from '@/lib/actions/auth-actions';

type ExternalAuthTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ExternalAuthDatabase = Pick<ExternalAuthTransaction, 'select' | 'insert' | 'update' | 'delete'>;

export type ExternalRole = 'Student' | 'Teacher' | 'Admin';

export interface ExternalSsoConfig {
  enabled: boolean;
  providerId: string;
  issuer: string;
  audience: string;
  sharedSecret: string;
  allowAdmin: boolean;
}

export interface ExternalLaunchPayload {
  iss: string;
  aud: string | string[];
  sub: string;
  role: ExternalRole | string;
  displayName: string;
  iat: number;
  exp: number;
  jti: string;
  email?: string;
  studentNumber?: string;
  className?: string;
  classId?: string;
  redirectTo?: string;
}

export interface ExternalUserInput {
  provider: string;
  subject: string;
  role: ExternalRole;
  displayName: string;
  email?: string;
  studentNumber?: string;
  className?: string;
  classId?: string;
}

const MAX_LAUNCH_AGE_SECONDS = 120;
const MAX_LAUNCH_LIFETIME_SECONDS = 120;
const MAX_CLOCK_SKEW_SECONDS = 30;
const MIN_SHARED_SECRET_LENGTH = 32;

export class IntegrationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'IntegrationError';
    this.status = status;
  }
}

export function getExternalSsoConfig(): ExternalSsoConfig {
  return {
    enabled: process.env.EXTERNAL_SSO_ENABLED === 'true',
    providerId: process.env.EXTERNAL_SSO_PROVIDER_ID ?? 'main-portal',
    issuer: process.env.EXTERNAL_SSO_ISSUER ?? '',
    audience: process.env.EXTERNAL_SSO_AUDIENCE ?? '',
    sharedSecret: process.env.EXTERNAL_SSO_SHARED_SECRET ?? '',
    allowAdmin: process.env.EXTERNAL_SSO_ALLOW_ADMIN === 'true',
  };
}

function normalizeRole(role: string): ExternalRole | null {
  const value = role.trim().toLowerCase();
  if (value === 'student') return 'Student';
  if (value === 'teacher') return 'Teacher';
  if (value === 'admin') return 'Admin';
  return null;
}

function base64UrlDecode(input: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) {
    throw new Error('Invalid base64url input.');
  }
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const decoded = Buffer.from(padded, 'base64');
  if (base64UrlEncode(decoded) !== input) {
    throw new Error('Non-canonical base64url input.');
  }
  return decoded;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signHs256(input: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(input).digest();
}

function isAudienceAllowed(aud: string | string[], expected: string): boolean {
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected;
}

export function isSafeRedirectPath(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (path.startsWith('/api/') || path === '/api') return false;
  return true;
}

export function createSignedLaunchToken(payload: ExternalLaunchPayload, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  return `${signingInput}.${base64UrlEncode(signHs256(signingInput, secret))}`;
}

export function verifySignedLaunchToken(
  token: string,
  config: ExternalSsoConfig,
  nowSec = Math.floor(Date.now() / 1000),
): ExternalLaunchPayload {
  if (!config.enabled) throw new IntegrationError('External SSO is disabled.', 503);
  if (
    config.sharedSecret.length < MIN_SHARED_SECRET_LENGTH
    || !config.issuer
    || !config.audience
  ) {
    throw new IntegrationError('External SSO is not fully configured.', 503);
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw new IntegrationError('Invalid launch token.');

  let header: { alg?: string };
  let payload: ExternalLaunchPayload;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
  } catch {
    throw new IntegrationError('Invalid launch token payload.');
  }

  if (header.alg !== 'HS256') throw new IntegrationError('Unsupported launch token algorithm.');
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expected = signHs256(signingInput, config.sharedSecret);
  const actual = base64UrlDecode(parts[2]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new IntegrationError('Invalid launch token signature.', 401);
  }

  if (payload.iss !== config.issuer) throw new IntegrationError('Invalid launch token issuer.', 401);
  if (!isAudienceAllowed(payload.aud, config.audience)) throw new IntegrationError('Invalid launch token audience.', 401);
  if (
    typeof payload.sub !== 'string'
    || !payload.sub.trim()
    || payload.sub.length > 200
    || typeof payload.displayName !== 'string'
    || !payload.displayName.trim()
    || payload.displayName.length > 200
    || typeof payload.role !== 'string'
    || !payload.role.trim()
    || typeof payload.jti !== 'string'
    || !payload.jti.trim()
    || payload.jti.length > 200
  ) {
    throw new IntegrationError('Launch token is missing required claims.');
  }
  if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) {
    throw new IntegrationError('Launch token has invalid timestamps.');
  }
  if (payload.exp <= nowSec) throw new IntegrationError('Launch token has expired.', 401);
  if (payload.exp <= payload.iat) {
    throw new IntegrationError('Launch token has an invalid lifetime.', 401);
  }
  if (payload.exp - payload.iat > MAX_LAUNCH_LIFETIME_SECONDS) {
    throw new IntegrationError('Launch token lifetime is too long.', 401);
  }
  if (payload.iat > nowSec + MAX_CLOCK_SKEW_SECONDS) {
    throw new IntegrationError('Launch token was issued in the future.', 401);
  }
  if (nowSec - payload.iat > MAX_LAUNCH_AGE_SECONDS) {
    throw new IntegrationError('Launch token is too old.', 401);
  }

  const role = normalizeRole(String(payload.role));
  if (!role) throw new IntegrationError('Launch token role is not allowed.', 403);
  if (role === 'Admin' && !config.allowAdmin) throw new IntegrationError('External admin launch is disabled.', 403);

  return { ...payload, role };
}

function externalUsername(provider: string, subject: string): string {
  return `${provider}:${subject}`;
}

async function chooseUniqueNumber(
  input: ExternalUserInput,
  database: ExternalAuthDatabase = db,
): Promise<string> {
  // The signed pseudonymous `sub` is the only SAIF learner key. Never use a
  // display name, email, or unsigned alternate student-number claim for linking.
  const preferred = input.subject.trim();
  const existing = ((await database.select().from(students).where(eq(students.uniqueNumber, preferred)).limit(1))[0]);
  if (!existing) return preferred;
  const fallback = externalUsername(input.provider, input.subject);
  const existingFallback = ((await database.select().from(students).where(eq(students.uniqueNumber, fallback)).limit(1))[0]);
  return existingFallback ? `${fallback}:${nanoid(8)}` : fallback;
}

export async function upsertExternalUser(
  input: ExternalUserInput,
  database: ExternalAuthDatabase = db,
) {
  const now = new Date().toISOString();
  const provider = input.provider.trim();
  const subject = input.subject.trim();
  const role = input.role;
  if (!provider || !subject || !input.displayName.trim()) {
    throw new IntegrationError('External user is missing provider, subject, or displayName.');
  }
  if (role === 'Admin' && process.env.EXTERNAL_SSO_ALLOW_ADMIN !== 'true') {
    throw new IntegrationError('External admin provisioning is disabled.', 403);
  }

  const identity = ((await database
    .select()
    .from(externalIdentities)
    .where(and(eq(externalIdentities.provider, provider), eq(externalIdentities.subject, subject))).limit(1))[0]);

  if (identity) {
    const user = ((await database.select().from(userAccounts).where(eq(userAccounts.id, identity.userAccountId)).limit(1))[0]);
    if (!user) throw new IntegrationError('Linked local user was not found.', 404);

    let studentId = user.studentId;
    if (role === 'Student') {
      if (studentId) {
        (await database.update(students)
          .set({ fullName: input.displayName, class: input.className ?? null, isActive: true })
          .where(eq(students.id, studentId)));
      } else {
        const stableStudent = ((await database.select().from(students).where(eq(students.uniqueNumber, subject)).limit(1))[0]);
        if (stableStudent) {
          studentId = stableStudent.id;
          (await database.update(students).set({ class: input.className ?? stableStudent.class, isActive: true }).where(eq(students.id, studentId)));
        } else {
        const [student] = (await database.insert(students)
          .values({
            uniqueNumber: await chooseUniqueNumber(input, database),
            fullName: input.displayName,
            class: input.className ?? null,
            cefrBand: 'A1',
            isActive: true,
          })
          .returning());
        studentId = student.id;
        }
      }
    } else {
      studentId = null;
    }

    (await database.update(userAccounts)
      .set({
        role,
        studentId,
        displayName: input.displayName,
        isActive: true,
        lastLoginAt: now,
      })
      .where(eq(userAccounts.id, user.id)));
    (await database.update(externalIdentities)
      .set({ role, updatedAt: now, lastLoginAt: now })
      .where(eq(externalIdentities.id, identity.id)));

    return {
      id: user.id,
      username: user.username,
      role,
      studentId,
      displayName: input.displayName,
    };
  }

  const username = role === 'Student' ? subject : externalUsername(provider, subject);
  const stableStudent = role === 'Student'
    ? ((await database.select().from(students).where(eq(students.uniqueNumber, subject)).limit(1))[0])
    : null;
  const existingUser = ((await database.select().from(userAccounts).where(eq(userAccounts.username, username)).limit(1))[0])
    ?? (stableStudent ? ((await database.select().from(userAccounts).where(eq(userAccounts.studentId, stableStudent.id)).limit(1))[0]) : undefined);
  if (existingUser) {
    let studentId = existingUser.studentId;
    if (role === 'Student' && !studentId && stableStudent) {
      studentId = stableStudent.id;
    } else if (role === 'Student' && !studentId) {
      const [student] = (await database.insert(students)
        .values({
          uniqueNumber: await chooseUniqueNumber(input, database),
          fullName: input.displayName,
          class: input.className ?? null,
          cefrBand: 'A1',
          isActive: true,
        })
        .returning());
      studentId = student.id;
    }
    if (role === 'Student' && studentId) {
      (await database.update(students)
        .set({ fullName: input.displayName, class: input.className ?? null, isActive: true })
        .where(eq(students.id, studentId)));
    }
    (await database.update(userAccounts)
      .set({ role, studentId: role === 'Student' ? studentId : null, displayName: input.displayName, isActive: true, lastLoginAt: now })
      .where(eq(userAccounts.id, existingUser.id)));
    (await database.insert(externalIdentities)
      .values({
        provider,
        subject,
        userAccountId: existingUser.id,
        role,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      }));
    return {
      id: existingUser.id,
      username: existingUser.username,
      role,
      studentId: role === 'Student' ? studentId : null,
      displayName: input.displayName,
    };
  }

  let studentId: number | null = stableStudent?.id ?? null;
  if (role === 'Student' && !studentId) {
    const [student] = (await database.insert(students)
      .values({
        uniqueNumber: await chooseUniqueNumber(input, database),
        fullName: input.displayName,
        class: input.className ?? null,
        cefrBand: 'A1',
        isActive: true,
      })
      .returning());
    studentId = student.id;
  }

  const [user] = (await database.insert(userAccounts)
    .values({
      username,
      passwordHash: hashPassword(nanoid(48)),
      role,
      studentId,
      displayName: input.displayName,
      isActive: true,
      createdAt: now,
      lastLoginAt: now,
    })
    .returning());

  (await database.insert(externalIdentities)
    .values({
      provider,
      subject,
      userAccountId: user.id,
      role,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    }));

  return {
    id: user.id,
    username: user.username,
    role,
    studentId,
    displayName: user.displayName,
  };
}

export async function createSessionForUser(
  userId: number,
  database: ExternalAuthDatabase = db,
): Promise<string> {
  const token = nanoid(48);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  (await database.insert(sessions)
    .values({ tokenHash: hashSessionToken(token), userId, expiresAt: expiresAt.toISOString() }));
  return token;
}

async function reserveLaunchJti(
  database: ExternalAuthDatabase,
  provider: string,
  jti: string,
  exp: number,
) {
  const [reservation] = (await database.insert(externalSsoLaunches)
    .values({
      provider,
      jti,
      userAccountId: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(exp * 1000).toISOString(),
    })
    .onConflictDoNothing({
      target: [externalSsoLaunches.provider, externalSsoLaunches.jti],
    })
    .returning({ id: externalSsoLaunches.id }));
  if (!reservation) throw new IntegrationError('Launch token has already been used.', 401);
  return reservation.id;
}

export async function launchExternalSso(token: string) {
  const config = getExternalSsoConfig();
  const payload = verifySignedLaunchToken(token, config);
  const role = normalizeRole(String(payload.role));
  if (!role) throw new IntegrationError('Launch token role is not allowed.', 403);

  return db.transaction(async (transaction) => {
    // Reserve the one-time identifier before any account mutation. The unique
    // constraint makes concurrent replays wait and fail without side effects.
    const reservationId = await reserveLaunchJti(
      transaction,
      config.providerId,
      payload.jti,
      payload.exp,
    );
    const user = await upsertExternalUser({
      provider: config.providerId,
      subject: payload.sub,
      role,
      displayName: payload.displayName,
      email: payload.email,
      studentNumber: payload.studentNumber,
      className: payload.className,
      classId: payload.classId,
    }, transaction);
    await transaction
      .update(externalSsoLaunches)
      .set({ userAccountId: user.id })
      .where(eq(externalSsoLaunches.id, reservationId));
    return {
      user,
      token: await createSessionForUser(user.id, transaction),
      redirectTo: isSafeRedirectPath(payload.redirectTo) ? payload.redirectTo : '/dashboard',
    };
  });
}

export async function findExternalIdentity(provider: string, subject: string) {
  return ((await db
    .select()
    .from(externalIdentities)
    .where(and(eq(externalIdentities.provider, provider), eq(externalIdentities.subject, subject))).limit(1))[0]);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function weakPronunciationWordsFromAttempts(rows: Array<{ metricsJson: string | null }>): Set<string> {
  const weak = new Set<string>();
  for (const row of rows) {
    const metrics = parseJson<{ pronunciationWeakWords?: Array<{ word?: string }> }>(row.metricsJson, {});
    for (const item of metrics.pronunciationWeakWords ?? []) {
      if (item.word) weak.add(item.word.toLowerCase());
    }
  }
  return weak;
}

export async function getExternalStudentSummary(provider: string, subject: string) {
  const identity = await findExternalIdentity(provider, subject);
  if (!identity) throw new IntegrationError('External identity was not found.', 404);
  const user = ((await db.select().from(userAccounts).where(eq(userAccounts.id, identity.userAccountId)).limit(1))[0]);
  if (!user?.studentId) throw new IntegrationError('External identity is not linked to a student.', 404);
  const student = ((await db.select().from(students).where(eq(students.id, user.studentId)).limit(1))[0]);
  if (!student) throw new IntegrationError('Student was not found.', 404);

  const cycleData = await getCurrentCycle(student.id);
  const recentAttempts = cycleData
    ? (await getStudentAttempts(student.id, cycleData.cycle.id)).slice(0, 10)
    : (await db.select().from(attempts).where(eq(attempts.studentId, student.id)).orderBy(desc(attempts.timestamp)).limit(10));
  const mastery = cycleData ? await getWordMastery(student.id, cycleData.cycle.id) : [];
  const weakPronunciation = weakPronunciationWordsFromAttempts(recentAttempts);
  const weakMastery = mastery.filter((item) => item.masteryStatus !== 'Mastered');
  const weakWordCount = new Set([
    ...weakMastery.map((item) => item.vocabulary?.word?.toLowerCase()).filter((word): word is string => !!word),
    ...Array.from(weakPronunciation),
  ]).size;
  const averageScore = recentAttempts.length
    ? recentAttempts.reduce((sum, attempt) => sum + attempt.compositeScore, 0) / recentAttempts.length
    : 0;

  return {
    provider,
    subject,
    localUserId: user.id,
    localStudentId: student.id,
    role: user.role,
    displayName: user.displayName,
    student: {
      uniqueNumber: student.uniqueNumber,
      fullName: student.fullName,
      className: student.class,
      cefrBand: student.cefrBand,
      hasDiagnostic: !!student.diagnosticJson,
      onboardedAt: student.onboardedAt,
      diagnosticProfile: parseJson(student.diagnosticJson, null),
    },
    activeCycle: cycleData ? {
      id: cycleData.cycle.id,
      startDate: cycleData.cycle.startDate,
      endDate: cycleData.cycle.endDate,
      book: cycleData.book ? {
        id: cycleData.book.id,
        title: cycleData.book.title,
        cefrLevel: cycleData.book.cefrLevel,
      } : null,
    } : null,
    progress: {
      totalWords: cycleData?.vocabulary.length ?? 0,
      masteredWords: mastery.filter((item) => item.masteryStatus === 'Mastered').length,
      developingWords: mastery.filter((item) => item.masteryStatus === 'Developing').length,
      weakWordCount,
      recentAttemptCount: recentAttempts.length,
      averageRecentScore: Math.round(averageScore * 1000) / 1000,
    },
    recentAttempts: recentAttempts.map((attempt) => ({
      id: attempt.id,
      practiceTaskId: attempt.practiceTaskId,
      timestamp: attempt.timestamp,
      compositeScore: attempt.compositeScore,
      targetMatchScore: attempt.targetMatchScore,
      pronunciationScore: attempt.pronunciationScore,
      fluencyScore: attempt.fluencyScore,
      completenessScore: attempt.completenessScore,
    })),
  };
}
