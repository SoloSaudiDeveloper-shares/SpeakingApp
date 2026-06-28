export type ClientSpeechReliabilityEventType = 'stt' | 'pronunciation' | 'recording';

export function recordClientSpeechReliabilityEvent(input: {
  eventType: ClientSpeechReliabilityEventType;
  provider: string;
  route?: string;
  practiceStage?: string | null;
  scenarioId?: string | null;
  practiceTaskId?: number | null;
  success: boolean;
  statusCode?: number | null;
  errorCode?: string | null;
  latencyMs?: number | null;
  noSpeech?: boolean | null;
  fallbackUsed?: boolean | null;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  if (typeof window === 'undefined') return;
  const body = {
    route: 'client',
    ...input,
  };
  void fetch('/api/speech/reliability-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {
    // Telemetry is best-effort and must never interrupt speaking practice.
  });
}
