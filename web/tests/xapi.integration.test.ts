import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { pool } from '@/lib/db';
import {
  drainXapiOutbox,
  enqueueXapiForKlpResult,
  retryXapiFailures,
} from '@/lib/integrations/xapi';

const suffix = randomBytes(5).toString('hex');
const subject = `cadet-${suffix}`;
let sourceId = 0;
let studentId = 0;
let accountId = 0;
let scoredConceptId = 0;
let contextConceptId = 0;
let scoredResultIds: number[] = [];
let unassessedResultId = 0;
let contextResultId = 0;
let firstStatementId = '';

describe.sequential('PostgreSQL xAPI outbox', () => {
  beforeAll(async () => {
    process.env.EXTERNAL_SSO_PROVIDER_ID = 'main-portal';
    process.env.XAPI_SOURCE_APP = 'speaking-lab';
    process.env.XAPI_ACTOR_HOMEPAGE = 'https://saif.rsaf.mil';
    const source = await pool.query<{ id: number }>(`
      INSERT INTO klp_import_sources
        (name, imported_at, total_concepts, active_question_shapes, warnings_json, status)
      VALUES ($1, now(), 2, 0, '[]'::jsonb, 'imported')
      RETURNING id
    `, [`xapi-test-${suffix}`]);
    sourceId = source.rows[0].id;
    const concepts = await pool.query<{ id: number; support_status: string }>(`
      INSERT INTO klp_concepts
        (source_id, concept_id, domain, support_status, active_question_count,
         active_question_shapes_json, raw_json, created_at)
      VALUES
        ($1, $2, 'speaking', 'speaking_scored', 1, '[]'::jsonb, '{}'::jsonb, now()),
        ($1, $3, 'speaking', 'context_only', 1, '[]'::jsonb, '{}'::jsonb, now())
      RETURNING id, support_status
    `, [sourceId, `KLP-${suffix}`, `CONTEXT-${suffix}`]);
    scoredConceptId = concepts.rows.find((row) => row.support_status === 'speaking_scored')!.id;
    contextConceptId = concepts.rows.find((row) => row.support_status === 'context_only')!.id;

    const student = await pool.query<{ id: number }>(`
      INSERT INTO students (unique_number, full_name, cefr_band, is_active)
      VALUES ($1, 'Pseudonymous xAPI fixture', 'A1', true)
      RETURNING id
    `, [`xapi-student-${suffix}`]);
    studentId = student.rows[0].id;
    const account = await pool.query<{ id: number }>(`
      INSERT INTO user_accounts
        (username, password_hash, role, student_id, display_name, is_active, must_change_password, created_at)
      VALUES ($1, 'test-only-unused-hash', 'Student', $2, 'Pseudonymous xAPI fixture', true, false, now())
      RETURNING id
    `, [`xapi-account-${suffix}`, studentId]);
    accountId = account.rows[0].id;
    await pool.query(`
      INSERT INTO external_identities
        (provider, subject, user_account_id, role, created_at, updated_at, last_login_at)
      VALUES ('main-portal', $1, $2, 'Student', now(), now(), now())
    `, [subject, accountId]);

    const results = await pool.query<{ id: number; assessed: boolean; klp_concept_id: number }>(`
      INSERT INTO attempt_klp_results
        (student_id, klp_concept_id, assessment_mode, support_status, assessed,
         success_score_percent, passed, confidence, raw_scores_json, created_at)
      VALUES
        ($1, $2, 'speaking_performance', 'speaking_scored', true, 83, true, 1, '{}'::jsonb, now()),
        ($1, $2, 'speaking_performance', 'speaking_scored', true, 45, false, 1, '{}'::jsonb, now()),
        ($1, $2, 'speaking_performance', 'speaking_scored', true, 100, true, 1, '{}'::jsonb, now()),
        ($1, $2, 'speaking_performance', 'speaking_scored', false, 91, true, 1, '{}'::jsonb, now()),
        ($1, $3, 'context_only', 'context_only', true, 99, true, 1, '{}'::jsonb, now())
      RETURNING id, assessed, klp_concept_id
    `, [studentId, scoredConceptId, contextConceptId]);
    scoredResultIds = results.rows
      .filter((row) => row.assessed && row.klp_concept_id === scoredConceptId)
      .map((row) => row.id);
    unassessedResultId = results.rows.find((row) => !row.assessed)!.id;
    contextResultId = results.rows.find((row) => row.klp_concept_id === contextConceptId)!.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM user_accounts WHERE id=$1`, [accountId]);
    await pool.query(`DELETE FROM students WHERE id=$1`, [studentId]);
    await pool.query(`DELETE FROM klp_import_sources WHERE id=$1`, [sourceId]);
  });

  test('emits the pinned actor, verb, KLP object, scaled score, and source exactly once', async () => {
    const first = await enqueueXapiForKlpResult(scoredResultIds[0], 'answered');
    const duplicate = await enqueueXapiForKlpResult(scoredResultIds[0], 'answered');
    expect(first).toBeTruthy();
    firstStatementId = first!;
    expect(duplicate).toBe(first);
    const rows = await pool.query<{ statement_json: Record<string, unknown> }>(
      `SELECT statement_json FROM xapi_outbox WHERE statement_id=$1`,
      [first],
    );
    expect(rows.rows).toHaveLength(1);
    const statement = rows.rows[0].statement_json as {
      actor: { account: { homePage: string; name: string } };
      verb: { id: string };
      object: { id: string };
      result: { success: boolean; score: { scaled: number } };
      context: { extensions: Record<string, string> };
    };
    expect(statement.actor.account).toEqual({ homePage: 'https://saif.rsaf.mil', name: subject });
    expect(statement.verb.id).toBe('http://adlnet.gov/expapi/verbs/answered');
    expect(statement.object.id).toBe(`https://saif.rsaf.mil/klp/dli_alc/KLP-${suffix}`);
    expect(statement.result).toEqual({ success: true, score: { scaled: 0.83 } });
    expect(statement.context.extensions['https://saif.rsaf.mil/extensions/skill']).toBe('speaking');
    expect(statement.context.extensions['https://saif.rsaf.mil/extensions/source-app']).toBe('speaking-lab');
  });

  test('suppresses unassessed and context-only evidence', async () => {
    await expect(enqueueXapiForKlpResult(unassessedResultId, 'answered')).resolves.toBeNull();
    await expect(enqueueXapiForKlpResult(contextResultId, 'answered')).resolves.toBeNull();
  });

  test('concurrent workers claim each statement at most once', async () => {
    await enqueueXapiForKlpResult(scoredResultIds[1], 'reviewed');
    await enqueueXapiForKlpResult(scoredResultIds[2], 'practiced');
    process.env.XAPI_ENABLED = 'true';
    process.env.XAPI_LRS_URL = 'https://lrs.invalid/xapi/statements';
    process.env.XAPI_USERNAME = 'mock-user';
    process.env.XAPI_PASSWORD = 'mock-password';
    const sentIds: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Array<{ id: string }>;
      sentIds.push(...body.map((statement) => statement.id));
      expect(init?.headers).toMatchObject({
        'X-Experience-API-Version': '1.0.3',
      });
      return new Response('[]', { status: 200 });
    }));
    const outcomes = await Promise.all([
      drainXapiOutbox({ includeFailed: true }),
      drainXapiOutbox({ includeFailed: true }),
    ]);
    expect(outcomes.reduce((sum, outcome) => sum + outcome.sent, 0)).toBe(3);
    expect(new Set(sentIds).size).toBe(3);
    const statuses = await pool.query<{ status: string; count: number }>(`
      SELECT status, COUNT(*)::int AS count
      FROM xapi_outbox
      WHERE student_id=$1
      GROUP BY status
    `, [studentId]);
    expect(statuses.rows).toEqual([{ status: 'sent', count: 3 }]);
    vi.unstubAllGlobals();
  });

  test('an explicit administrator retry reopens a capped failure', async () => {
    await pool.query(`
      UPDATE xapi_outbox
      SET status='failed', attempts=10, next_attempt_at=NULL, last_error='test failure'
      WHERE statement_id=$1
    `, [firstStatementId]);
    await expect(retryXapiFailures([firstStatementId])).resolves.toBe(1);
    const row = await pool.query<{ status: string; attempts: number; last_error: string | null }>(`
      SELECT status, attempts, last_error
      FROM xapi_outbox
      WHERE statement_id=$1
    `, [firstStatementId]);
    expect(row.rows[0]).toEqual({ status: 'pending', attempts: 0, last_error: null });
  });
});
