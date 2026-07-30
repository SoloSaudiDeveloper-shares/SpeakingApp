import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { pool } from '@/lib/db';
import { recordScenarioAttempt } from '@/lib/actions/scenario-actions';

const sessionId = `scenario-session-${randomBytes(8).toString('hex')}`;
let studentId = 0;

describe('scenario persistence', () => {
  beforeAll(async () => {
    const student = await pool.query<{ id: number }>(
      `SELECT id FROM students WHERE is_active=true ORDER BY id LIMIT 1`,
    );
    if (!student.rows[0]) throw new Error('Scenario integration test requires a seeded student.');
    studentId = student.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM scenario_attempts WHERE session_id=$1`, [sessionId]);
  });

  test('a unique scenario session is persisted exactly once under concurrent saves', async () => {
    const input = {
      studentId,
      scenarioId: 'concurrency-verification',
      transcript: [
        { role: 'assistant', content: 'What would you like?' },
        { role: 'user', content: 'A coffee, please.' },
      ],
      criteriaMet: [true],
      score: 82,
      feedback: 'Clear and polite.',
      sessionId,
      learnerTurns: 1,
      completionReason: 'manual' as const,
    };
    const saved = await Promise.all(Array.from({ length: 5 }, () => recordScenarioAttempt(input)));
    expect(new Set(saved.map((attempt) => attempt.id)).size).toBe(1);
    const count = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM scenario_attempts WHERE session_id=$1`,
      [sessionId],
    );
    expect(count.rows[0].count).toBe(1);
  });
});
