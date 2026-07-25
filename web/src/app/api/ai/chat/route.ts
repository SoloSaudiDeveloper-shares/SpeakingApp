import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { callChat } from '@/lib/ai/providers';
import { getScenario } from '@/lib/ai/scenarios';
import { buildScenarioSystemPrompt, guardScenarioTurn } from '@/lib/ai/conversation-guard';
import { getGeneratedScenario } from '@/lib/actions/klp-actions';

export async function POST(request: Request) {
  let body: {
    messages?: Array<{ role?: string; content?: unknown }>;
    scenarioId?: unknown;
    model?: string;
    temperature?: number;
    max_tokens?: number;
  } | null = null;
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    body = await request.json();
    const requestBody = body ?? {};
    const rawMessages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
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
      .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: String(m.content ?? '') }));

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = scenario
      ? [
          { role: 'system', content: buildScenarioSystemPrompt(scenario) },
          ...safeMessages.filter((m) => m.role === 'user' || m.role === 'assistant'),
        ]
      : safeMessages;

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
    return Response.json({ error: msg }, { status: 502 });
  }
}
