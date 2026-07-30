import { createHash, randomUUID } from 'node:crypto';
import { pool } from '@/lib/db';

export type XapiEvidenceKind = 'answered' | 'reviewed' | 'practiced';

const SAIF_XAPI_NAMESPACE = 'https://saif.training';
const LEGACY_SAIF_XAPI_NAMESPACE = 'https://saif.rsaf.mil';
const VERBS: Record<XapiEvidenceKind, { id: string; display: string }> = {
  answered: { id: 'http://adlnet.gov/expapi/verbs/answered', display: 'answered' },
  reviewed: { id: `${SAIF_XAPI_NAMESPACE}/verbs/reviewed`, display: 'reviewed' },
  practiced: { id: `${SAIF_XAPI_NAMESPACE}/verbs/practiced`, display: 'practiced' },
};
const MAX_BATCH = 100;
const MAX_ATTEMPTS = 10;
const STALE_LOCK_MINUTES = 10;

export function getXapiConfig() {
  const sourceApp = (process.env.XAPI_SOURCE_APP || 'speaking-lab').trim();
  const reservedNames = new Set(['vocab-app', 'reading-tutor', 'placement-test', 'speaking-tutor']);
  const reserved = reservedNames.has(sourceApp) || sourceApp.startsWith('saif-');
  const invalidFormat = !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sourceApp);
  return {
    enabled: process.env.XAPI_ENABLED === 'true',
    lrsUrl: (process.env.XAPI_LRS_URL || '').trim(),
    username: process.env.XAPI_USERNAME || '',
    password: process.env.XAPI_PASSWORD || '',
    sourceApp,
    actorHomepage: (process.env.XAPI_ACTOR_HOMEPAGE || 'https://saif.rsaf.mil').replace(/\/$/, ''),
    configured: Boolean(process.env.XAPI_LRS_URL && process.env.XAPI_USERNAME && process.env.XAPI_PASSWORD) && !reserved && !invalidFormat,
    configurationError: reserved
      ? `XAPI_SOURCE_APP "${sourceApp}" is reserved by SAIF.`
      : invalidFormat
        ? 'XAPI_SOURCE_APP must be a stable lowercase kebab-case identifier.'
        : null,
  };
}

function deterministicUuid(input: string) {
  const bytes = Buffer.from(createHash('sha256').update(input).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function actorSubjectForStudent(studentId: number): Promise<string | null> {
  const provider = process.env.EXTERNAL_SSO_PROVIDER_ID || 'main-portal';
  const result = await pool.query<{ subject: string }>(`
    SELECT ei.subject
    FROM user_accounts ua
    JOIN external_identities ei ON ei.user_account_id = ua.id
    WHERE ua.student_id = $1 AND ei.provider = $2
    ORDER BY COALESCE(ei.last_login_at, ei.updated_at) DESC
    LIMIT 1
  `, [studentId, provider]);
  return result.rows[0]?.subject ?? null;
}

export async function enqueueXapiForKlpResult(attemptKlpResultId: number, kind: XapiEvidenceKind) {
  const result = await pool.query<{
    id: number;
    studentId: number;
    assessed: boolean;
    passed: boolean;
    scorePercent: number;
    createdAt: string;
    conceptId: string;
    supportStatus: string;
  }>(`
    SELECT akr.id, akr.student_id AS "studentId", akr.assessed, akr.passed,
      akr.success_score_percent AS "scorePercent", akr.created_at AS "createdAt",
      kc.concept_id AS "conceptId", kc.support_status AS "supportStatus"
    FROM attempt_klp_results akr
    JOIN klp_concepts kc ON kc.id = akr.klp_concept_id
    WHERE akr.id = $1
  `, [attemptKlpResultId]);
  const row = result.rows[0];
  if (!row || !row.assessed || row.supportStatus !== 'speaking_scored' || !row.conceptId.trim()) return null;
  const actorSubject = await actorSubjectForStudent(row.studentId);
  if (!actorSubject) return null;
  const config = getXapiConfig();
  const verb = VERBS[kind];
  const statementId = deterministicUuid(`speaking-lab:${row.id}:${kind}:${actorSubject}:${row.conceptId}`);
  const scaled = Math.max(0, Math.min(1, Number(row.scorePercent) / 100));
  const statement = {
    id: statementId,
    actor: { objectType: 'Agent', account: { homePage: config.actorHomepage, name: actorSubject } },
    verb: { id: verb.id, display: { 'en-US': verb.display } },
    object: {
      objectType: 'Activity',
      id: `${SAIF_XAPI_NAMESPACE}/klp/dli_alc/${encodeURIComponent(row.conceptId)}`,
      definition: { type: `${SAIF_XAPI_NAMESPACE}/activity-types/klp` },
    },
    result: { success: Boolean(row.passed), score: { scaled } },
    context: { extensions: {
      [`${SAIF_XAPI_NAMESPACE}/extensions/skill`]: 'speaking',
      [`${SAIF_XAPI_NAMESPACE}/extensions/source-app`]: config.sourceApp,
    } },
    timestamp: row.createdAt,
  };
  await pool.query(`
    INSERT INTO xapi_outbox(
      statement_id, attempt_klp_result_id, student_id, actor_subject, verb, statement_json,
      status, attempts, next_attempt_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending', 0, now(), now(), now())
    ON CONFLICT (statement_id) DO NOTHING
  `, [statementId, row.id, row.studentId, actorSubject, kind, JSON.stringify(statement)]);
  return statementId;
}

type ClaimedRow = { id: number; statementJson: unknown; attempts: number };

export function normalizeSaifStatementNamespace(statement: unknown): unknown {
  if (!statement || typeof statement !== 'object' || Array.isArray(statement)) return statement;
  const normalized = structuredClone(statement) as {
    verb?: { id?: unknown };
    object?: { id?: unknown; definition?: { type?: unknown } };
    context?: { extensions?: unknown };
  };
  const migrateIri = (value: unknown, segment: string) =>
    typeof value === 'string' && value.startsWith(`${LEGACY_SAIF_XAPI_NAMESPACE}/${segment}/`)
      ? `${SAIF_XAPI_NAMESPACE}${value.slice(LEGACY_SAIF_XAPI_NAMESPACE.length)}`
      : value;

  if (normalized.verb) {
    normalized.verb.id = migrateIri(normalized.verb.id, 'verbs');
  }
  if (normalized.object) {
    normalized.object.id = migrateIri(normalized.object.id, 'klp');
    if (normalized.object.definition) {
      normalized.object.definition.type = migrateIri(
        normalized.object.definition.type,
        'activity-types',
      );
    }
  }
  if (
    normalized.context?.extensions
    && typeof normalized.context.extensions === 'object'
    && !Array.isArray(normalized.context.extensions)
  ) {
    normalized.context.extensions = Object.fromEntries(
      Object.entries(normalized.context.extensions).map(([key, value]) => [
        key.startsWith(`${LEGACY_SAIF_XAPI_NAMESPACE}/extensions/`)
          ? `${SAIF_XAPI_NAMESPACE}${key.slice(LEGACY_SAIF_XAPI_NAMESPACE.length)}`
          : key,
        value,
      ]),
    );
  }
  return normalized;
}

async function claimBatch(includeFailed: boolean, owner: string): Promise<ClaimedRow[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      UPDATE xapi_outbox
      SET status = 'failed', lock_owner = NULL, locked_at = NULL,
        last_error = COALESCE(last_error, 'Recovered stale processing lock.'),
        next_attempt_at = now(), updated_at = now()
      WHERE status = 'processing'
        AND locked_at < now() - ($1::int * interval '1 minute')
    `, [STALE_LOCK_MINUTES]);
    const statuses = includeFailed ? ['pending', 'failed'] : ['pending'];
    const claimed = await client.query<ClaimedRow>(`
      WITH candidates AS (
        SELECT id
        FROM xapi_outbox
        WHERE status = ANY($1::text[])
          AND attempts < $2
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT $3
      )
      UPDATE xapi_outbox AS xo
      SET status = 'processing', lock_owner = $4, locked_at = now(), updated_at = now()
      FROM candidates
      WHERE xo.id = candidates.id
      RETURNING xo.id, xo.statement_json AS "statementJson", xo.attempts
    `, [statuses, MAX_ATTEMPTS, MAX_BATCH, owner]);
    for (const row of claimed.rows) {
      const normalized = normalizeSaifStatementNamespace(row.statementJson);
      if (JSON.stringify(normalized) !== JSON.stringify(row.statementJson)) {
        await client.query(
          `UPDATE xapi_outbox SET statement_json=$1::jsonb WHERE id=$2 AND lock_owner=$3`,
          [JSON.stringify(normalized), row.id, owner],
        );
        row.statementJson = normalized;
      }
    }
    await client.query('COMMIT');
    return claimed.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function retryDelaySeconds(attempts: number): number {
  const capped = Math.min(3600, 30 * 2 ** Math.min(7, attempts));
  return Math.round(capped * (0.8 + Math.random() * 0.4));
}

export async function drainXapiOutbox(options: { includeFailed?: boolean } = {}) {
  const config = getXapiConfig();
  if (!config.enabled || !config.configured) {
    return { sent: 0, skipped: true, error: config.configurationError };
  }
  const owner = randomUUID();
  const rows = await claimBatch(options.includeFailed !== false, owner);
  if (!rows.length) return { sent: 0, skipped: false };
  const statements = rows.map((row) => row.statementJson);
  const attemptedAt = new Date().toISOString();
  try {
    const response = await fetch(config.lrsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'X-Experience-API-Version': '1.0.3',
      },
      body: JSON.stringify(statements),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500);
      throw Object.assign(new Error(detail || `LRS returned ${response.status}`), { status: response.status });
    }
    const ids = rows.map((row) => row.id);
    await pool.query(`
      UPDATE xapi_outbox
      SET status = 'sent', attempts = attempts + 1, last_attempt_at = $1, sent_at = $1,
        last_error = NULL, response_status = $2, updated_at = $1,
        lock_owner = NULL, locked_at = NULL
      WHERE id = ANY($3::int[]) AND lock_owner = $4
    `, [attemptedAt, response.status, ids, owner]);
    return { sent: rows.length, skipped: false };
  } catch (error) {
    const status = Number((error as { status?: number }).status) || null;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const finalFailure = row.attempts + 1 >= MAX_ATTEMPTS;
        const next = finalFailure
          ? null
          : new Date(Date.now() + retryDelaySeconds(row.attempts) * 1000).toISOString();
        await client.query(`
          UPDATE xapi_outbox
          SET status = 'failed', attempts = attempts + 1, last_attempt_at = $1,
            next_attempt_at = $2, last_error = $3, response_status = $4, updated_at = $1,
            lock_owner = NULL, locked_at = NULL
          WHERE id = $5 AND lock_owner = $6
        `, [attemptedAt, next, message, status, row.id, owner]);
      }
      await client.query('COMMIT');
    } catch (updateError) {
      await client.query('ROLLBACK');
      throw updateError;
    } finally {
      client.release();
    }
    return { sent: 0, failed: rows.length, skipped: false, error: message };
  }
}

export async function getXapiStatus() {
  const config = getXapiConfig();
  const counts = await pool.query<{ status: string; count: number }>(
    `SELECT status, COUNT(*)::int AS count FROM xapi_outbox GROUP BY status`,
  );
  const recentFailures = await pool.query(`
    SELECT statement_id AS "statementId", actor_subject AS "actorSubject", verb, attempts,
      last_error AS "lastError", next_attempt_at AS "nextAttemptAt"
    FROM xapi_outbox WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 20
  `);
  return {
    ...config,
    password: undefined,
    username: config.username ? 'configured' : '',
    counts: Object.fromEntries(counts.rows.map((row) => [row.status, Number(row.count)])),
    recentFailures: recentFailures.rows,
  };
}

export async function retryXapiFailures(statementIds?: string[]) {
  const result = statementIds?.length
    ? await pool.query(`
        UPDATE xapi_outbox SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL,
          updated_at = now(), lock_owner = NULL, locked_at = NULL
        WHERE statement_id = ANY($1::text[]) AND status = 'failed'
      `, [statementIds])
    : await pool.query(`
        UPDATE xapi_outbox SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL,
          updated_at = now(), lock_owner = NULL, locked_at = NULL
        WHERE status = 'failed'
      `);
  return result.rowCount ?? 0;
}

export async function getXapiActorMap() {
  const config = getXapiConfig();
  const result = await pool.query<{
    provider: string;
    subject: string;
    username: string;
    studentCode: string;
    unsent: number;
  }>(`
    SELECT ei.provider, ei.subject, ua.username, s.unique_number AS "studentCode",
      (SELECT COUNT(*)::int FROM xapi_outbox xo WHERE xo.student_id = s.id AND xo.status != 'sent') AS unsent
    FROM external_identities ei
    JOIN user_accounts ua ON ua.id = ei.user_account_id
    JOIN students s ON s.id = ua.student_id
    ORDER BY ei.provider, ei.subject
  `);
  return result.rows.map((row) => ({
    provider: row.provider,
    subject: row.subject,
    localStudentCode: row.studentCode,
    username: row.username,
    actor: { objectType: 'Agent', account: { homePage: config.actorHomepage, name: row.subject } },
    unsentStatements: Number(row.unsent),
  }));
}
