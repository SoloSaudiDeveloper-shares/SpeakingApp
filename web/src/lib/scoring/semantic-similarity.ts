/**
 * Semantic similarity scoring using EmbeddingGemma (or fallback).
 * Used for "Free Speak" tasks where exact word match isn't expected,
 * but the meaning should align with the target.
 */

/**
 * Cosine similarity between two embedding vectors.
 * Returns a value between -1 and 1; 1 = identical meaning.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Score how semantically close the student's response is to the target.
 * Returns 0-100.
 */
export async function scoreSemanticSimilarity(
  studentResponse: string,
  targetReference: string
): Promise<number> {
  if (!studentResponse.trim() || !targetReference.trim()) return 0;

  try {
    const res = await fetch('/api/ai/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: [studentResponse, targetReference] }),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    if (!data.embeddings || data.embeddings.length !== 2) return 0;
    const sim = cosineSimilarity(data.embeddings[0], data.embeddings[1]);
    // Map [-1, 1] to [0, 100], clamped at 0
    return Math.max(0, Math.round(sim * 100));
  } catch {
    return 0;
  }
}
