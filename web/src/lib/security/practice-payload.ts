export const PRACTICE_ATTEMPT_BODY_MAX_BYTES = 96 * 1024;
export const PRACTICE_TRANSCRIPT_MAX_CHARS = 12_000;
export const PRACTICE_METRICS_MAX_BYTES = 48 * 1024;

const MAX_JSON_DEPTH = 6;
const MAX_JSON_PROPERTIES = 256;
const MAX_JSON_ARRAY_ITEMS = 256;
const MAX_JSON_STRING_CHARS = 4_096;

export type PracticePayloadValidation =
  | {
      ok: true;
      body: Record<string, unknown>;
      transcript: string;
      metrics: Record<string, unknown>;
    }
  | { ok: false; error: string };

function boundedJsonValue(
  value: unknown,
  depth: number,
  state: { properties: number },
): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (typeof value === 'string') return value.length <= MAX_JSON_STRING_CHARS;
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length <= MAX_JSON_ARRAY_ITEMS &&
      value.every((item) => boundedJsonValue(item, depth + 1, state));
  }
  if (!value || typeof value !== 'object') return false;
  const entries = Object.entries(value);
  state.properties += entries.length;
  return (
    state.properties <= MAX_JSON_PROPERTIES &&
    entries.every(([key, item]) =>
      key.length <= 128 && boundedJsonValue(item, depth + 1, state))
  );
}

export function parseBoundedPracticePayload(body: unknown): PracticePayloadValidation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;
  const transcript = typeof record.rawTranscript === 'string' ? record.rawTranscript : '';
  if (transcript.length > PRACTICE_TRANSCRIPT_MAX_CHARS) {
    return { ok: false, error: 'Transcript is too large.' };
  }

  let metrics: unknown = {};
  if (record.metricsJson !== undefined && record.metricsJson !== null && record.metricsJson !== '') {
    if (typeof record.metricsJson !== 'string') {
      return { ok: false, error: 'metricsJson must be a JSON string.' };
    }
    if (new TextEncoder().encode(record.metricsJson).byteLength > PRACTICE_METRICS_MAX_BYTES) {
      return { ok: false, error: 'Practice metrics are too large.' };
    }
    try {
      metrics = JSON.parse(record.metricsJson) as unknown;
    } catch {
      return { ok: false, error: 'Practice metrics must be valid JSON.' };
    }
  }
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    return { ok: false, error: 'Practice metrics must be a JSON object.' };
  }
  if (!boundedJsonValue(metrics, 0, { properties: 0 })) {
    return { ok: false, error: 'Practice metrics are too complex.' };
  }
  return {
    ok: true,
    body: record,
    transcript,
    metrics: metrics as Record<string, unknown>,
  };
}
