import { callChat, getActiveProvider, type ProviderId } from './providers';

export interface OpenResponseContentGrade {
  coherence: number | null;
  reason: string | null;
  fluencyComment: string | null;
  aiAvailable: boolean;
  provider: ProviderId;
  model: string;
}

export async function gradeOpenResponseContent(input: {
  transcript: string;
  topic?: string;
  fluencyMetrics?: unknown;
}): Promise<OpenResponseContentGrade> {
  const cfg = await getActiveProvider();
  const transcript = input.transcript.trim();
  if (!transcript) return unavailable(cfg.provider, cfg.model);

  const system =
    `You grade a SPOKEN English learner response for content/coherence only. ` +
    `The task is open production, so there is no required target word unless the topic says so. ` +
    `Ignore accent and minor grammar. Give 90-100 for a genuine coherent English sentence. ` +
    `Give below 35 for gibberish, repeated sounds/words, random unrelated words, not-English, or a one-word answer. ` +
    `You also receive deterministic fluency metrics from the app. Do not create or change any numeric fluency score; ` +
    `write one short comment explaining the measured fluency. ` +
    `Respond with STRICT JSON only: {"score": number, "reason": "short content reason", "fluencyComment": "short fluency explanation"}.`;

  const userMsg =
    `TOPIC: ${input.topic || '(open response; judge whether it is coherent English)'}\n\n` +
    `APP_MEASURED_FLUENCY_METRICS:\n${JSON.stringify(input.fluencyMetrics ?? {}, null, 2)}\n\n` +
    `RESPONSE:\n${transcript}`;

  try {
    const result = await callChat(
      [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
      { temperature: 0.1, maxTokens: 160 },
    );
    const parsed = extractGrade(result.content);
    return {
      coherence: parsed.score / 100,
      reason: parsed.reason,
      fluencyComment: parsed.fluencyComment,
      aiAvailable: true,
      provider: result.provider,
      model: result.model,
    };
  } catch (e) {
    console.warn('open-response AI content grade failed:', e);
    return unavailable(cfg.provider, cfg.model);
  }
}

function unavailable(provider: ProviderId, model: string): OpenResponseContentGrade {
  return {
    coherence: null,
    reason: null,
    fluencyComment: null,
    aiAvailable: false,
    provider,
    model,
  };
}

function extractGrade(text: string): { score: number; reason: string; fluencyComment: string | null } {
  let s = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const match = s.match(/\{[\s\S]*\}/);
  if (match) s = match[0];
  try {
    const obj = JSON.parse(s);
    const score = Math.max(0, Math.min(100, Number(obj.score)));
    const reason = typeof obj.reason === 'string' ? obj.reason.trim() : '';
    const fluencyComment = typeof obj.fluencyComment === 'string' && obj.fluencyComment.trim()
      ? obj.fluencyComment.trim()
      : null;
    return { score: Number.isFinite(score) ? score : 100, reason, fluencyComment };
  } catch {
    return { score: 100, reason: '', fluencyComment: null };
  }
}
