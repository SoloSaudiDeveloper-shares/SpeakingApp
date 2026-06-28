import { areEquivalentWords, areHomophones, normalizeWordToken } from './homophones';

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}'\s]/gu, '')
    .replace(/\s+/g, ' ');
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .map(normalizeWordToken)
    .filter(Boolean);
}

function countEquivalentMatches(expectedTokens: string[], actualTokens: string[]): { matched: number; homophoneOnly: number } {
  const used = new Set<number>();
  let matched = 0;
  let homophoneOnly = 0;

  for (const expected of expectedTokens) {
    let matchIndex = -1;
    for (let i = 0; i < actualTokens.length; i++) {
      if (used.has(i)) continue;
      if (areEquivalentWords(expected, actualTokens[i])) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex >= 0) {
      used.add(matchIndex);
      matched++;
      if (areHomophones(expected, actualTokens[matchIndex])) homophoneOnly++;
    }
  }

  return { matched, homophoneOnly };
}

function f1Score(matches: number, expectedCount: number, actualCount: number): number {
  if (matches <= 0 || expectedCount <= 0 || actualCount <= 0) return 0;
  const precision = matches / actualCount;
  const recall = matches / expectedCount;
  return (2 * precision * recall) / (precision + recall);
}

export function scoreTargetMatch(
  transcript: string,
  expectedAnswersJson: string | null | undefined,
): number {
  if (!transcript || transcript.trim().length === 0) return 0;

  const actual = normalizeText(transcript);

  if (!expectedAnswersJson || expectedAnswersJson.trim().length === 0) return 0;

  let expected: string[];
  try {
    expected = JSON.parse(expectedAnswersJson) as string[];
  } catch {
    return 0;
  }

  if (!Array.isArray(expected) || expected.length === 0) return 0;

  let bestScore = 0;

  for (const exp of expected) {
    const norm = normalizeText(exp);
    if (!norm) continue;

    if (actual === norm) {
      bestScore = 1.0;
      break;
    }

    if (actual.includes(norm) || norm.includes(actual)) {
      const overlap =
        Math.min(actual.length, norm.length) /
        Math.max(actual.length, norm.length);
      bestScore = Math.max(bestScore, overlap);
    }

    // Token-level precision/recall. This intentionally penalizes extra or
    // repeated words, so "speak house house" is not a perfect "house" attempt.
    const actualTokens = tokenize(actual);
    const expectedTokens = tokenize(norm);
    if (expectedTokens.length > 0) {
      const { matched, homophoneOnly } = countEquivalentMatches(expectedTokens, actualTokens);
      const tokenScore = f1Score(matched, expectedTokens.length, actualTokens.length);
      const ambiguityCap = homophoneOnly > 0 ? 0.9 : 1;
      bestScore = Math.max(bestScore, tokenScore * ambiguityCap);

      if (
        expectedTokens.length === 1 &&
        actualTokens.length === 1 &&
        matched === 1 &&
        homophoneOnly === 1 &&
        expectedTokens[0] !== actualTokens[0]
      ) {
        bestScore = Math.max(bestScore, 0.9);
      }
    }
  }

  return Math.min(1, Math.max(0, bestScore));
}
