import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { callChat } from '@/lib/ai/providers';
import { getScenario } from '@/lib/ai/scenarios';
import { findScenarioAttemptBySession, recordScenarioAttempt } from '@/lib/actions/scenario-actions';
import { nanoid } from 'nanoid';
import { getGeneratedScenario, recordScenarioKlpResults } from '@/lib/actions/klp-actions';
import { applyLocalScenarioGuard, heuristicScenarioGrade } from '@/lib/ai/scenario-grading';
import type { ScenarioGrade } from '@/lib/ai/scenario-grading';
import { after } from 'next/server';
import { drainXapiOutbox } from '@/lib/integrations/xapi';
import { jsonBodyErrorResponse, readBoundedJson } from '@/lib/security/request-body';
import {
  consumeCloudAiBudgetIfNeeded,
  consumePracticeAttemptBudget,
  ResourceBudgetExceededError,
  resourceBudgetResponse,
} from '@/lib/security/resource-budget-server';
import { mutationRequestViolation } from '@/lib/security/request-protection';

const SCENARIO_GRADER_TIMEOUT_MS = 15000;

/**
 * POST /api/ai/scenario-score
 * Body: { scenarioId, messages: [{role, content}], persistMode?: "always"|"auto"|"never" }
 * Grades a completed role-play against the scenario's success criteria using
 * the configured AI provider, persists the result, and returns it.
 */
export async function POST(request: Request) {
  try {
    const violation = mutationRequestViolation(request);
    if (violation) return Response.json({ error: 'Request is not allowed.' }, { status: 403 });
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    const rawBody = await readBoundedJson(request, 128 * 1024);
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return Response.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }
    const body = rawBody as Record<string, unknown>;
    const scenarioId = typeof body.scenarioId === 'string' ? body.scenarioId : '';
    const scenario = getScenario(scenarioId) ?? await getGeneratedScenario(scenarioId);
    if (!scenario) return Response.json({ error: 'Unknown scenario.' }, { status: 400 });

    const messages: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(body.messages)
      ? body.messages.slice(-32).flatMap((message) => {
          if (!message || typeof message !== 'object') return [];
          const item = message as Record<string, unknown>;
          if (item.role !== 'user' && item.role !== 'assistant') return [];
          if (typeof item.content !== 'string' || item.content.length > 8_000) return [];
          return [{ role: item.role, content: item.content }];
        })
      : [];
    if (messages.reduce((total, message) => total + message.content.length, 0) > 64_000) {
      return Response.json({ error: 'Scenario transcript is too large.' }, { status: 400 });
    }
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : nanoid(32);
    const persistMode: 'always' | 'auto' | 'never' =
      body.persistMode === 'auto' || body.persistMode === 'never'
        ? body.persistMode
        : body.persist === false
          ? 'never'
          : 'always';
    const userTurnCount = messages.filter((m) => m.role === 'user' && m.content.trim()).length;
    const transcript = messages
      .map((m) => `${m.role === 'user' ? 'Student' : 'Partner'}: ${m.content}`)
      .join('\n');

    const criteriaList = scenario.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n');
    const targetVocabulary = scenario.targetVocabulary?.length
      ? scenario.targetVocabulary.join(', ')
      : scenario.title.match(/^Practice\s+(.+)$/i)?.[1] ?? '';

    const graderSystem =
      `You are a strict but fair English-speaking examiner. You are given a role-play transcript and a list of success criteria. ` +
      `Decide for each criterion whether the STUDENT met it (true/false), give an overall score from 0 to 100 reflecting how well and how fluently the student completed the task, and write ONE short encouraging sentence of feedback. ` +
      `Evaluate the meaning of each criterion separately. For target-language criteria, check whether the student used the actual target vocabulary/phrase, not whether they said words like "target" or "lesson". ` +
      `Respond ONLY with strict JSON in this exact shape, no prose, no markdown:\n` +
      `{"criteriaMet": [boolean, ...], "score": number, "feedback": "..."}\n` +
      `The criteriaMet array must have exactly ${scenario.successCriteria.length} booleans in order.`;

    const graderUser =
      `SCENARIO: ${scenario.title}\nTARGET_LANGUAGE: ${targetVocabulary || 'not specified'}\n\nSUCCESS CRITERIA:\n${criteriaList}\n\nTRANSCRIPT:\n${transcript}`;

    let parsed: ScenarioGrade;
    try {
      await consumeCloudAiBudgetIfNeeded(user.id);
      const result = await withTimeout(
        callChat(
          [
            { role: 'system', content: graderSystem },
            { role: 'user', content: graderUser },
          ],
          { temperature: 0.2, maxTokens: 300 },
        ),
        SCENARIO_GRADER_TIMEOUT_MS,
        'Scenario grader timed out.',
      );
      parsed = applyLocalScenarioGuard(
        extractJson(result.content, scenario.successCriteria.length),
        scenario,
        messages,
      );
    } catch (e) {
      if (e instanceof ResourceBudgetExceededError) {
        parsed = heuristicScenarioGrade(scenario, messages);
      } else {
      // If the provider is down, fall back to a local content-aware grade so
      // empty or off-task conversations do not get credit just for turn count.
        console.warn('Scenario grader failed, using fallback:', e);
        parsed = heuristicScenarioGrade(scenario, messages);
      }
    }

    const allGoalsMet = parsed.criteriaMet.length > 0 && parsed.criteriaMet.every(Boolean);
    const maxTurns = Math.max(scenario.minTurns, scenario.maxTurns ?? 8);
    const autoCompletionReason = userTurnCount >= maxTurns ? 'max-turns' : allGoalsMet && userTurnCount >= scenario.minTurns ? 'goals-met' : null;
    const completionReason: 'manual' | 'goals-met' | 'max-turns' =
      body.completionReason === 'goals-met' || body.completionReason === 'max-turns' ? body.completionReason : autoCompletionReason ?? 'manual';
    const shouldPersist =
      !!user.studentId &&
      (persistMode === 'always' || (persistMode === 'auto' && autoCompletionReason !== null));

    let persisted = false;
    // Persist (best effort)
    if (shouldPersist && user.studentId) {
      try {
        await consumePracticeAttemptBudget(user.id);
        const existing = await findScenarioAttemptBySession(sessionId);
        if (existing) {
          persisted = true;
        } else {
        const scenarioAttempt = await recordScenarioAttempt({
          studentId: user.studentId,
          scenarioId: scenario.id,
          transcript: messages,
          criteriaMet: parsed.criteriaMet,
          score: parsed.score,
          feedback: parsed.feedback,
          sessionId,
          learnerTurns: userTurnCount,
          completionReason,
        });
        await recordScenarioKlpResults({
          scenarioAttemptId: scenarioAttempt.id,
          scenarioId: scenario.id,
          studentId: user.studentId,
          score: parsed.score,
          criteriaMet: parsed.criteriaMet,
        });
        after(() => drainXapiOutbox());
        persisted = true;
        }
      } catch (error) {
        if (error instanceof ResourceBudgetExceededError) throw error;
        // Scenario grading can still be returned when optional persistence is unavailable.
      }
    }

    return Response.json({
      scenarioId: scenario.id,
      criteria: scenario.successCriteria,
      criteriaMet: parsed.criteriaMet,
      score: parsed.score,
      feedback: parsed.feedback,
      criteriaDetails: parsed.criteriaDetails ?? parsed.criteriaMet.map((met, index) => ({
        criterion: scenario.successCriteria[index],
        met,
        reason: met ? 'Met.' : 'Not clearly shown yet.',
      })),
      persisted,
      persistMode,
      sessionId,
      learnerTurns: userTurnCount,
      maxTurns,
      completionReason: persisted ? completionReason : null,
    });
  } catch (e) {
    const bodyResponse = jsonBodyErrorResponse(e);
    if (bodyResponse) return bodyResponse;
    const budgetResponse = resourceBudgetResponse(e);
    if (budgetResponse) return budgetResponse;
    console.error('scenario-score error:', e);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  });
}

/** Defensively extract the grader JSON even if the model wraps it in prose/markdown. */
function extractJson(text: string, n: number): { criteriaMet: boolean[]; score: number; feedback: string } {
  let jsonStr = text.trim();
  // Strip code fences
  jsonStr = jsonStr.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  // Find the first {...} block
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (match) jsonStr = match[0];
  const obj = JSON.parse(jsonStr);
  let criteriaMet: boolean[] = Array.isArray(obj.criteriaMet) ? obj.criteriaMet.map(Boolean) : [];
  // Normalize length
  if (criteriaMet.length < n) criteriaMet = [...criteriaMet, ...Array(n - criteriaMet.length).fill(false)];
  if (criteriaMet.length > n) criteriaMet = criteriaMet.slice(0, n);
  const score = Math.max(0, Math.min(100, Number(obj.score) || 0));
  const feedback = typeof obj.feedback === 'string' ? obj.feedback : 'Good effort — keep practicing!';
  return { criteriaMet, score, feedback };
}
