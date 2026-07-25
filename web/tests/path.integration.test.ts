import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { pool } from '@/lib/db';
import { getLearnerPaths } from '@/lib/actions/path-actions';

const transcriptMarker = `path-test-${randomBytes(6).toString('hex')}`;
let studentId = 0;
let assignmentId = 0;

describe.sequential('controlled-to-open pathway progress', () => {
  beforeAll(async () => {
    const fixture = await pool.query<{ student_id: number; assignment_id: number }>(`
      SELECT s.id AS student_id, h.id AS assignment_id
      FROM students s
      JOIN homework_assignments h ON h.student_ids_json @> to_jsonb(ARRAY[s.id])
      WHERE s.unique_number='demo-learner' AND h.path_config_json IS NOT NULL
      ORDER BY h.id
      LIMIT 1
    `);
    if (!fixture.rows[0]) throw new Error('Path integration test requires the environment-credentialed demo seed.');
    studentId = fixture.rows[0].student_id;
    assignmentId = fixture.rows[0].assignment_id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM attempts WHERE raw_transcript=$1`, [transcriptMarker]);
    await pool.query(
      `DELETE FROM homework_path_progress WHERE homework_id=$1 AND student_id=$2`,
      [assignmentId, studentId],
    );
  });

  test('unlocks context only after every listen-and-repeat target passes', async () => {
    const initial = await getLearnerPaths(studentId);
    expect(initial.activePath?.stages.map((stage) => stage.status)).toEqual([
      'available',
      'locked',
      'locked',
      'locked',
      'locked',
    ]);

    await pool.query(`
      INSERT INTO attempts
        (student_id, cycle_id, book_id, practice_task_id, timestamp, raw_transcript,
         target_match_score, pronunciation_score, fluency_score, completeness_score,
         consistency_score, composite_score)
      SELECT $1, h.cycle_id, c.book_id, pt.id, now(), $2,
        1, 1, 1, 1, 1, pt.pass_score
      FROM homework_assignments h
      JOIN cycles c ON c.id=h.cycle_id
      JOIN practice_tasks pt ON pt.book_id=c.book_id
      WHERE h.id=$3 AND lower(pt.task_type)='listenrepeat'
    `, [studentId, transcriptMarker, assignmentId]);

    const advanced = await getLearnerPaths(studentId);
    expect(advanced.activePath?.stages[0]).toMatchObject({ status: 'complete', completed: 2, required: 2 });
    expect(advanced.activePath?.stages[1]).toMatchObject({ status: 'available', completed: 0, required: 2 });
    expect(advanced.activePath?.stages[2].status).toBe('locked');
  });
});
