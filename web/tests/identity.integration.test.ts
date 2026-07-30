import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { pool } from '@/lib/db';
import {
  createSignedLaunchToken,
  launchExternalSso,
  upsertExternalUser,
  type ExternalLaunchPayload,
} from '@/lib/integrations/external-auth';

const suffix = randomBytes(5).toString('hex');
const provider = `identity-test-${suffix}`;
const linkedSubject = `linked-${suffix}`;
const newSubject = `new-${suffix}`;
const victimCode = `victim-${suffix}`;
const replaySubject = `replay-${suffix}`;

describe.sequential('pseudonymous SAIF account linking', () => {
  afterAll(async () => {
    await pool.query(
      `DELETE FROM external_sso_launches WHERE provider=$1`,
      [provider],
    );
    await pool.query(
      `DELETE FROM user_accounts
       WHERE username = ANY($1::text[]) OR username LIKE $2`,
      [[linkedSubject, newSubject, victimCode, replaySubject], `${provider}:%`],
    );
    await pool.query(
      `DELETE FROM students WHERE unique_number = ANY($1::text[])`,
      [[linkedSubject, newSubject, victimCode, replaySubject]],
    );
  });

  test('links a signed subject to the existing direct-login account', async () => {
    const student = await pool.query<{ id: number }>(`
      INSERT INTO students (unique_number, full_name, cefr_band, is_active)
      VALUES ($1, 'Original local label', 'A1', true)
      RETURNING id
    `, [linkedSubject]);
    const account = await pool.query<{ id: number }>(`
      INSERT INTO user_accounts
        (username, password_hash, role, student_id, display_name, is_active, must_change_password, created_at)
      VALUES ($1, 'test-only-unused-hash', 'Student', $2, 'Original local label', true, false, now())
      RETURNING id
    `, [linkedSubject, student.rows[0].id]);

    const linked = await upsertExternalUser({
      provider,
      subject: linkedSubject,
      role: 'Student',
      displayName: 'Updated label',
      email: 'must-not-be-used@example.invalid',
      studentNumber: 'unsigned-number-must-not-link',
      className: 'Pilot',
    });
    expect(linked.id).toBe(account.rows[0].id);
    expect(linked.studentId).toBe(student.rows[0].id);
    const identity = await pool.query(`
      SELECT subject, user_account_id
      FROM external_identities
      WHERE provider=$1 AND subject=$2
    `, [provider, linkedSubject]);
    expect(identity.rows).toEqual([{ subject: linkedSubject, user_account_id: account.rows[0].id }]);
  });

  test('never links by a matching display name or email', async () => {
    const victim = await pool.query<{ student_id: number; account_id: number }>(`
      WITH student AS (
        INSERT INTO students (unique_number, full_name, cefr_band, is_active)
        VALUES ($1, 'Shared display label', 'A1', true)
        RETURNING id
      )
      INSERT INTO user_accounts
        (username, password_hash, role, student_id, display_name, is_active, must_change_password, created_at)
      SELECT $1, 'test-only-unused-hash', 'Student', id, 'Shared display label', true, false, now()
      FROM student
      RETURNING student_id, id AS account_id
    `, [victimCode]);
    const created = await upsertExternalUser({
      provider,
      subject: newSubject,
      role: 'Student',
      displayName: 'Shared display label',
      email: 'shared@example.invalid',
      studentNumber: victimCode,
    });
    expect(created.id).not.toBe(victim.rows[0].account_id);
    expect(created.studentId).not.toBe(victim.rows[0].student_id);
    const createdStudent = await pool.query<{ unique_number: string }>(
      `SELECT unique_number FROM students WHERE id=$1`,
      [created.studentId],
    );
    expect(createdStudent.rows[0].unique_number).toBe(newSubject);
  });

  test('reserves the jti before mutations so a replay cannot reactivate or relabel an account', async () => {
    const previous = {
      enabled: process.env.EXTERNAL_SSO_ENABLED,
      provider: process.env.EXTERNAL_SSO_PROVIDER_ID,
      issuer: process.env.EXTERNAL_SSO_ISSUER,
      audience: process.env.EXTERNAL_SSO_AUDIENCE,
      secret: process.env.EXTERNAL_SSO_SHARED_SECRET,
      allowAdmin: process.env.EXTERNAL_SSO_ALLOW_ADMIN,
    };
    const issuer = 'https://saif.example/issuer';
    const audience = 'speaking-lab';
    const secret = 'integration-test-signing-secret-long-enough';
    process.env.EXTERNAL_SSO_ENABLED = 'true';
    process.env.EXTERNAL_SSO_PROVIDER_ID = provider;
    process.env.EXTERNAL_SSO_ISSUER = issuer;
    process.env.EXTERNAL_SSO_AUDIENCE = audience;
    process.env.EXTERNAL_SSO_SHARED_SECRET = secret;
    process.env.EXTERNAL_SSO_ALLOW_ADMIN = 'false';

    try {
      const now = Math.floor(Date.now() / 1000);
      const payload: ExternalLaunchPayload = {
        iss: issuer,
        aud: audience,
        sub: replaySubject,
        role: 'Student',
        displayName: 'First launch label',
        iat: now,
        exp: now + 90,
        jti: `one-time-${suffix}`,
      };
      const token = createSignedLaunchToken(payload, secret);
      const launched = await launchExternalSso(token);
      expect(launched.user.username).toBe(replaySubject);

      await pool.query(
        `UPDATE user_accounts
         SET is_active=false, display_name='Changed after launch'
         WHERE id=$1`,
        [launched.user.id],
      );
      await pool.query(
        `UPDATE students
         SET is_active=false, full_name='Changed after launch'
         WHERE id=$1`,
        [launched.user.studentId],
      );

      await expect(launchExternalSso(token)).rejects.toThrow('already been used');

      const account = await pool.query<{
        is_active: boolean;
        display_name: string;
      }>(
        `SELECT is_active, display_name FROM user_accounts WHERE id=$1`,
        [launched.user.id],
      );
      const student = await pool.query<{
        is_active: boolean;
        full_name: string;
      }>(
        `SELECT is_active, full_name FROM students WHERE id=$1`,
        [launched.user.studentId],
      );
      expect(account.rows[0]).toEqual({
        is_active: false,
        display_name: 'Changed after launch',
      });
      expect(student.rows[0]).toEqual({
        is_active: false,
        full_name: 'Changed after launch',
      });
    } finally {
      const restore = (name: string, value: string | undefined) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      };
      restore('EXTERNAL_SSO_ENABLED', previous.enabled);
      restore('EXTERNAL_SSO_PROVIDER_ID', previous.provider);
      restore('EXTERNAL_SSO_ISSUER', previous.issuer);
      restore('EXTERNAL_SSO_AUDIENCE', previous.audience);
      restore('EXTERNAL_SSO_SHARED_SECRET', previous.secret);
      restore('EXTERNAL_SSO_ALLOW_ADMIN', previous.allowAdmin);
    }
  });
});
