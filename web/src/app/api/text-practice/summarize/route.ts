import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    const body = await request.json();
    const { text, model } = body;

    if (!text) {
      return Response.json({ error: 'Text is required.' }, { status: 400 });
    }

    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model ?? 'llama3',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant. Summarize the following text in 2-3 concise sentences. Keep the language simple and clear for English language learners.',
          },
          { role: 'user', content: text },
        ],
        stream: false,
      }),
    });

    if (!res.ok) {
      return Response.json({ error: 'Ollama request failed.' }, { status: 502 });
    }

    const data = await res.json();
    const summary = data.message?.content ?? '';
    return Response.json({ summary });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
