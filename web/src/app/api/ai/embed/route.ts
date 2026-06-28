import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

/**
 * POST /api/ai/embed
 * Generates embeddings via Ollama for semantic similarity scoring.
 * Default model: nomic-embed-text (or embedinggemma if pulled).
 *
 * Body: { text: string | string[], model?: string }
 * Returns: { embeddings: number[][] }
 */
export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    const body = await request.json();
    const texts: string[] = Array.isArray(body.text) ? body.text : [body.text];
    const model: string = body.model ?? 'embeddinggemma:300m';

    const embeddings: number[][] = [];
    for (const t of texts) {
      const res = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: t }),
      });
      if (!res.ok) {
        // Try fallback model
        const fallback = await fetch('http://localhost:11434/api/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'nomic-embed-text', prompt: t }),
        });
        if (!fallback.ok) {
          return Response.json({ error: `Embedding failed for "${t.substring(0, 30)}..."` }, { status: 502 });
        }
        const data = await fallback.json();
        embeddings.push(data.embedding);
      } else {
        const data = await res.json();
        embeddings.push(data.embedding);
      }
    }

    return Response.json({ embeddings });
  } catch (e) {
    console.error('Embed error:', e);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
