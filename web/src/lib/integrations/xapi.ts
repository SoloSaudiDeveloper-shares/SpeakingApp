import { createHash } from 'node:crypto';
import { sqlite } from '@/lib/db';

export type XapiEvidenceKind = 'answered' | 'reviewed' | 'practiced';

const VERBS: Record<XapiEvidenceKind, { id: string; display: string }> = {
  answered: { id: 'http://adlnet.gov/expapi/verbs/answered', display: 'answered' },
  reviewed: { id: 'https://saif.rsaf.mil/verbs/reviewed', display: 'reviewed' },
  practiced: { id: 'https://saif.rsaf.mil/verbs/practiced', display: 'practiced' },
};

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

function actorSubjectForStudent(studentId: number): string | null {
  const provider = process.env.EXTERNAL_SSO_PROVIDER_ID || 'main-portal';
  const preferred = sqlite.prepare(`
    SELECT ei.subject
    FROM user_accounts ua
    JOIN external_identities ei ON ei.user_account_id = ua.id
    WHERE ua.student_id = ? AND ei.provider = ?
    ORDER BY COALESCE(ei.last_login_at, ei.updated_at) DESC LIMIT 1
  `).get(studentId, provider) as { subject: string } | undefined;
  return preferred?.subject || null;
}

export function enqueueXapiForKlpResult(attemptKlpResultId: number, kind: XapiEvidenceKind) {
  const row = sqlite.prepare(`
    SELECT akr.id, akr.student_id AS studentId, akr.assessed, akr.passed,
      akr.success_score_percent AS scorePercent, akr.created_at AS createdAt,
      kc.concept_id AS conceptId, kc.support_status AS supportStatus
    FROM attempt_klp_results akr
    JOIN klp_concepts kc ON kc.id = akr.klp_concept_id
    WHERE akr.id = ?
  `).get(attemptKlpResultId) as {
    id: number; studentId: number; assessed: number; passed: number; scorePercent: number;
    createdAt: string; conceptId: string; supportStatus: string;
  } | undefined;
  if (!row || !row.assessed || row.supportStatus !== 'speaking_scored' || !row.conceptId.trim()) return null;
  const actorSubject = actorSubjectForStudent(row.studentId);
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
      id: `https://saif.rsaf.mil/klp/dli_alc/${encodeURIComponent(row.conceptId)}`,
      definition: { type: 'https://saif.rsaf.mil/activity-types/klp' },
    },
    result: { success: Boolean(row.passed), score: { scaled } },
    context: { extensions: {
      'https://saif.rsaf.mil/extensions/skill': 'speaking',
      'https://saif.rsaf.mil/extensions/source-app': config.sourceApp,
    } },
    timestamp: row.createdAt,
  };
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT OR IGNORE INTO xapi_outbox(
      statement_id, attempt_klp_result_id, student_id, actor_subject, verb, statement_json,
      status, attempts, next_attempt_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
  `).run(statementId, row.id, row.studentId, actorSubject, kind, JSON.stringify(statement), now, now, now);
  return statementId;
}

let draining = false;

export async function drainXapiOutbox(options: { includeFailed?: boolean } = {}) {
  const config = getXapiConfig();
  if (!config.enabled || !config.configured || draining) return { sent: 0, skipped: true, error: config.configurationError };
  draining = true;
  try {
    const now = new Date().toISOString();
    const statuses = options.includeFailed === false ? "('pending')" : "('pending','failed')";
    const rows = sqlite.prepare(`
      SELECT id, statement_json AS statementJson, attempts
      FROM xapi_outbox WHERE status IN ${statuses} AND next_attempt_at <= ?
      ORDER BY id LIMIT 100
    `).all(now) as Array<{ id: number; statementJson: string; attempts: number }>;
    if (!rows.length) return { sent: 0, skipped: false };
    const statements = rows.map((row) => JSON.parse(row.statementJson));
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
      if (!response.ok) throw Object.assign(new Error((await response.text().catch(() => '')).slice(0, 500) || `LRS returned ${response.status}`), { status: response.status });
      const sentAt = new Date().toISOString();
      const markSent = sqlite.prepare(`UPDATE xapi_outbox SET status='sent', attempts=attempts+1, last_attempt_at=?, sent_at=?, last_error=NULL, response_status=?, updated_at=? WHERE id=?`);
      const transaction = sqlite.transaction(() => rows.forEach((row) => markSent.run(attemptedAt, sentAt, response.status, sentAt, row.id)));
      transaction();
      return { sent: rows.length, skipped: false };
    } catch (error) {
      const status = Number((error as { status?: number }).status) || null;
      const message = error instanceof Error ? error.message : String(error);
      const update = sqlite.prepare(`UPDATE xapi_outbox SET status='failed', attempts=attempts+1, last_attempt_at=?, next_attempt_at=?, last_error=?, response_status=?, updated_at=? WHERE id=?`);
      const transaction = sqlite.transaction(() => rows.forEach((row) => {
        const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(7, row.attempts));
        const next = new Date(Date.now() + delaySeconds * 1000).toISOString();
        update.run(attemptedAt, next, message.slice(0, 1000), status, attemptedAt, row.id);
      }));
      transaction();
      return { sent: 0, failed: rows.length, skipped: false, error: message };
    }
  } finally {
    draining = false;
  }
}

export function getXapiStatus() {
  const config = getXapiConfig();
  const counts = sqlite.prepare(`SELECT status, COUNT(*) AS count FROM xapi_outbox GROUP BY status`).all() as Array<{ status: string; count: number }>;
  const recentFailures = sqlite.prepare(`SELECT statement_id AS statementId, actor_subject AS actorSubject, verb, attempts, last_error AS lastError, next_attempt_at AS nextAttemptAt FROM xapi_outbox WHERE status='failed' ORDER BY updated_at DESC LIMIT 20`).all();
  return { ...config, password: undefined, username: config.username ? 'configured' : '', counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])), recentFailures };
}

export function retryXapiFailures(statementIds?: string[]) {
  const now = new Date().toISOString();
  if (statementIds?.length) {
    const placeholders = statementIds.map(() => '?').join(',');
    return sqlite.prepare(`UPDATE xapi_outbox SET status='pending', next_attempt_at=?, last_error=NULL, updated_at=? WHERE statement_id IN (${placeholders})`).run(now, now, ...statementIds).changes;
  }
  return sqlite.prepare(`UPDATE xapi_outbox SET status='pending', next_attempt_at=?, last_error=NULL, updated_at=? WHERE status='failed'`).run(now, now).changes;
}

export function getXapiActorMap() {
  const config = getXapiConfig();
  const rows = sqlite.prepare(`
    SELECT ei.provider, ei.subject, ua.username, s.unique_number AS studentCode,
      (SELECT COUNT(*) FROM xapi_outbox xo WHERE xo.student_id = s.id AND xo.status != 'sent') AS unsent
    FROM external_identities ei
    JOIN user_accounts ua ON ua.id = ei.user_account_id
    JOIN students s ON s.id = ua.student_id
    ORDER BY ei.provider, ei.subject
  `).all() as Array<{ provider: string; subject: string; username: string; studentCode: string; unsent: number }>;
  return rows.map((row) => ({
    provider: row.provider,
    subject: row.subject,
    localStudentCode: row.studentCode,
    username: row.username,
    actor: { objectType: 'Agent', account: { homePage: config.actorHomepage, name: row.subject } },
    unsentStatements: Number(row.unsent),
  }));
}
