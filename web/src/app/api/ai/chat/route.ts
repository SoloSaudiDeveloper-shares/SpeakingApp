import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { callChat } from '@/lib/ai/providers';
import { getScenario } from '@/lib/ai/scenarios';
import { buildScenarioSystemPrompt, guardScenarioTurn } from '@/lib/ai/conversation-guard';
import { getGeneratedScenario } from '@/lib/actions/klp-actions';
import { jsonBodyErrorResponse, readBoundedJson } from '@/lib/security/request-body';
import {
  consumeCloudAiBudgetIfNeeded,
  resourceBudgetResponse,
} from '@/lib/security/resource-budget-server';
import { mutationRequestViolation } from '@/lib/security/request-protection';

type ChatRequestBody = {
  messages?: Array<{ role?: string; content?: unknown }>;
  scenarioId?: unknown;
  model?: string;
  temperature?: number;
  max_tokens?: number;
};

export async function POST(request: Request) {
  let body: ChatRequestBody | null = null;
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
    body = rawBody as ChatRequestBody;
    const requestBody = body;
    const rawMessages = Array.isArray(requestBody.messages) ? requestBody.messages.slice(-32) : [];
    const scenarioId = typeof requestBody.scenarioId === 'string' ? requestBody.scenarioId : '';
    const scenario = scenarioId ? (getScenario(scenarioId) ?? await getGeneratedScenario(scenarioId)) : null;
    const lastUserMessage = [...rawMessages].reverse().find((m) => m?.role === 'user');

    if (scenario && typeof lastUserMessage?.content === 'string') {
      const guard = guardScenarioTurn(scenario, lastUserMessage.content);
      if (guard.blocked) {
        return Response.json({
          provider: 'local-guard',
          model: 'scenario-focus',
          guarded: true,
          guardReason: guard.reason,
          message: { role: 'assistant', content: guard.reply },
          choices: [{ message: { role: 'assistant', content: guard.reply } }],
        });
      }
    }

    const safeMessages = rawMessages
      .filter((m) => m?.role === 'system' || m?.role === 'user' || m?.role === 'assistant')
      .map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: String(m.content ?? '').slice(0, 8_000),
      }));
    if (safeMessages.reduce((total, message) => total + message.content.length, 0) > 64_000) {
      return Response.json({ error: 'Conversation is too large.' }, { status: 400 });
    }

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = scenario
      ? [
          { role: 'system', content: buildScenarioSystemPrompt(scenario) },
          ...safeMessages.filter((m) => m.role === 'user' || m.role === 'assistant'),
        ]
      : safeMessages;

    await consumeCloudAiBudgetIfNeeded(user.id);
    const result = await callChat(messages, {
      modelOverride: requestBody.model, // explicit model wins
      temperature: requestBody.temperature,
      maxTokens: requestBody.max_tokens,
    });

    // Return an Ollama-compatible shape so the existing client code keeps working
    return Response.json({
      provider: result.provider,
      model: result.model,
      message: { role: 'assistant', content: result.content },
      // Also OpenAI-compatible shape
      choices: [{ message: { role: 'assistant', content: result.content } }],
    });
  } catch (e) {
    const bodyResponse = jsonBodyErrorResponse(e);
    if (bodyResponse) return bodyResponse;
    const budgetResponse = resourceBudgetResponse(e);
    if (budgetResponse) return budgetResponse;
    const msg = e instanceof Error ? e.message : String(e);
    try {
      const scenarioId = typeof body?.scenarioId === 'string' ? body.scenarioId : '';
      const scenario = scenarioId ? (getScenario(scenarioId) ?? await getGeneratedScenario(scenarioId)) : null;
      if (scenario && /content management|content filter|filtered|policy/i.test(msg)) {
        const reply = guardScenarioTurn(scenario, 'change topic').reply ||
          `Let's stay with this practice: "${scenario.title}". Please answer using the lesson language.`;
        return Response.json({
          provider: 'local-guard',
          model: 'scenario-focus',
          guarded: true,
          guardReason: 'unsafe',
          message: { role: 'assistant', content: reply },
          choices: [{ message: { role: 'assistant', content: reply } }],
        });
      }
    } catch { /* fall through to normal error */ }
    console.error('AI chat request failed:', msg);
    return Response.json({ error: 'AI service is unavailable.' }, { status: 502 });
  }
}
