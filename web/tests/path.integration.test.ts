import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { pool } from '@/lib/db';
import { getLearnerPaths } from '@/lib/actions/path-actions';

const transcriptMarker = `path-test-${randomBytes(6).toString('hex')}`;
const studentMarker = `path-student-${randomBytes(6).toString('hex')}`;
const promptMarker = `path-prompt-${randomBytes(6).toString('hex')}`;
let studentId = 0;
let assignmentId = 0;
let practiceTaskIds: number[] = [];

describe.sequential('controlled-to-open pathway progress', () => {
  beforeAll(async () => {
    const base = await pool.query<{
      cycle_id: number;
      book_id: number;
      creator_id: number;
      word_ids: number[];
    }>(`
      WITH eligible_cycles AS (
        SELECT c.id AS cycle_id, c.book_id,
          (ARRAY_AGG(vi.id ORDER BY vi.id))[1:2] AS word_ids
        FROM cycles c
        JOIN vocabulary_items vi ON vi.book_id = c.book_id
        GROUP BY c.id, c.book_id
        HAVING COUNT(*) >= 2
      )
      SELECT ec.cycle_id, ec.book_id, ec.word_ids,
        (SELECT id FROM user_accounts WHERE role = 'Admin' ORDER BY id LIMIT 1) AS creator_id
      FROM eligible_cycles ec
      ORDER BY ec.cycle_id
      LIMIT 1
    `);
    const fixture = base.rows[0];
    if (!fixture?.creator_id || fixture.word_ids.length !== 2) {
      throw new Error('Path integration test requires two fully-authored practice targets.');
    }

    practiceTaskIds = (await pool.query<{ id: number }>(`
      INSERT INTO practice_tasks(
        book_id, vocabulary_item_id, task_type, prompt, expected_answers, pass_score
      )
      SELECT $1, word_id, task_type, $2, '[]'::jsonb, 0.6
      FROM UNNEST($3::int[]) AS word(word_id)
      CROSS JOIN UNNEST(ARRAY['ListenRepeat','SentenceFrame','FreeRecall']) AS task(task_type)
      RETURNING id
    `, [fixture.book_id, promptMarker, fixture.word_ids])).rows.map((row) => Number(row.id));

    studentId = Number((await pool.query<{ id: number }>(`
      INSERT INTO students(unique_number, full_name, cefr_band, is_active)
      VALUES ($1, 'Pseudonymous path fixture', 'A1', true)
      RETURNING id
    `, [studentMarker])).rows[0].id);

    const pathConfig = {
      version: 1,
      targetWordIds: fixture.word_ids.map(Number),
      controlledScenarioId: null,
      openScenarioId: null,
      textPracticeId: null,
    };
    assignmentId = Number((await pool.query<{ id: number }>(`
      INSERT INTO homework_assignments(
        cycle_id, created_by_user_id, title, word_ids, task_types, due_date,
        target_type, student_ids_json, klp_ids_json, scenario_ids_json,
        source, status, path_config_json, created_at
      ) VALUES (
        $1, $2, 'Path integration fixture', $3::jsonb,
        '["repeat","sentence","free-speak"]'::jsonb, current_date + 1,
        'student', $4::jsonb, '[]'::jsonb, '[]'::jsonb,
        'manual', 'assigned', $5::jsonb, now()
      )
      RETURNING id
    `, [
      fixture.cycle_id,
      fixture.creator_id,
      JSON.stringify(fixture.word_ids),
      JSON.stringify([studentId]),
      JSON.stringify(pathConfig),
    ])).rows[0].id);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM attempts WHERE raw_transcript=$1`, [transcriptMarker]);
    await pool.query(
      `DELETE FROM homework_path_progress WHERE homework_id=$1 AND student_id=$2`,
      [assignmentId, studentId],
    );
    await pool.query(`DELETE FROM homework_assignments WHERE id=$1`, [assignmentId]);
    await pool.query(`DELETE FROM practice_tasks WHERE id = ANY($1::int[])`, [practiceTaskIds]);
    await pool.query(`DELETE FROM students WHERE id=$1`, [studentId]);
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
