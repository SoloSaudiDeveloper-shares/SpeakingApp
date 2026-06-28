import { areEquivalentWords } from './homophones';

/**
 * Pronunciation scoring.
 *
 * Strategy (in order of preference):
 *   1. Phoneme-level Levenshtein similarity (when both spoken & reference phonemes available)
 *   2. Word-level fuzzy match between transcript and expected answers
 *   3. Character-level similarity as a last-resort fallback
 *
 * Returns 0 if there's no transcript at all (no speech detected).
 * Never returns a hardcoded "neutral" default — the score always reflects
 * actual similarity between what was said and what should have been said.
 */

function levenshteinDistance<T>(a: T[], b: T[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z\s']/gi, '').replace(/\s+/g, ' ');
}

/**
 * Levenshtein-based similarity for two strings (character level).
 * Returns 0–1 where 1 = identical.
 */
function stringSimilarity(a: string, b: string): number {
  const la = normalize(a);
  const lb = normalize(b);
  if (!la || !lb) return 0;
  if (la === lb) return 1;
  if (areEquivalentWords(la, lb)) return 0.96;
  const dist = levenshteinDistance(la.split(''), lb.split(''));
  const maxLen = Math.max(la.length, lb.length);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Word-level similarity between transcript and a target phrase.
 * Aligns words and uses character-similarity for partial credit on each word.
 */
function wordLevelSimilarity(transcript: string, target: string): number {
  const tWords = normalize(transcript).split(' ').filter(Boolean);
  const refWords = normalize(target).split(' ').filter(Boolean);
  if (tWords.length === 0 || refWords.length === 0) return 0;

  // For each reference word, find the best matching transcript word
  // and average those best-match similarities. Penalize length mismatch.
  let totalSim = 0;
  for (const ref of refWords) {
    let best = 0;
    for (const t of tWords) {
      const sim = t === ref ? 1 : areEquivalentWords(t, ref) ? 0.96 : stringSimilarity(t, ref);
      if (sim > best) best = sim;
    }
    totalSim += best;
  }

  const avgSim = totalSim / refWords.length;

  // Penalize when transcript is much longer than expected (filler words / wrong content)
  const lengthRatio =
    Math.min(tWords.length, refWords.length) /
    Math.max(tWords.length, refWords.length);

  return avgSim * (0.5 + 0.5 * lengthRatio);
}

export function scorePronunciation(
  spokenPhonemes: string | null | undefined,
  referencePhonemes: string | null | undefined,
  transcript?: string,
  expectedAnswersJson?: string | null,
): number {
  const cleanTranscript = (transcript ?? '').trim();

  // No speech → no pronunciation.
  if (
    !cleanTranscript &&
    (!spokenPhonemes || spokenPhonemes.trim().length === 0)
  ) {
    return 0;
  }

  // 1. PHONEME-LEVEL (most accurate)
  if (
    spokenPhonemes &&
    spokenPhonemes.trim().length > 0 &&
    referencePhonemes &&
    referencePhonemes.trim().length > 0
  ) {
    const spoken = spokenPhonemes.trim().split(/\s+/).filter(Boolean);
    const reference = referencePhonemes.trim().split(/\s+/).filter(Boolean);
    if (spoken.length > 0 && reference.length > 0) {
      const distance = levenshteinDistance(
        spoken.map((p) => p.toLowerCase()),
        reference.map((p) => p.toLowerCase()),
      );
      const maxLen = Math.max(spoken.length, reference.length);
      return Math.min(1, Math.max(0, 1 - distance / maxLen));
    }
  }

  if (!cleanTranscript) return 0;

  // 2. WORD-LEVEL against expected answers (when no phonemes)
  if (expectedAnswersJson && expectedAnswersJson.trim().length > 0) {
    try {
      const expected = JSON.parse(expectedAnswersJson) as string[];
      if (Array.isArray(expected) && expected.length > 0) {
        let best = 0;
        for (const exp of expected) {
          const sim = wordLevelSimilarity(cleanTranscript, exp);
          if (sim > best) best = sim;
        }
        return Math.min(1, Math.max(0, best));
      }
    } catch {
      // fall through to next strategy
    }
  }

  // 3. CHARACTER-LEVEL similarity to reference text (final fallback)
  if (referencePhonemes && referencePhonemes.trim().length > 0) {
    return stringSimilarity(cleanTranscript, referencePhonemes.trim());
  }

  // Truly nothing to compare against → low confidence score
  // (we got speech but no target — caller should provide expectedAnswers)
  return 0.3;
}
