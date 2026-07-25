import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { pool } from '@/lib/db';
import { upsertExternalUser } from '@/lib/integrations/external-auth';

const suffix = randomBytes(5).toString('hex');
const provider = `identity-test-${suffix}`;
const linkedSubject = `linked-${suffix}`;
const newSubject = `new-${suffix}`;
const victimCode = `victim-${suffix}`;

describe.sequential('pseudonymous SAIF account linking', () => {
  afterAll(async () => {
    await pool.query(
      `DELETE FROM user_accounts
       WHERE username = ANY($1::text[]) OR username LIKE $2`,
      [[linkedSubject, newSubject, victimCode], `${provider}:%`],
    );
    await pool.query(
      `DELETE FROM students WHERE unique_number = ANY($1::text[])`,
      [[linkedSubject, newSubject, victimCode]],
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
});
