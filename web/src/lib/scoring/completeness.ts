import { areEquivalentWords } from './homophones';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.,!?]+$/, '').replace(/^[.,!?]+/, ''))
    .filter((w) => w.length > 0);
}

function countEquivalentMatches(expectedWords: string[], actualWords: string[]): number {
  const used = new Set<number>();
  let matched = 0;
  for (const expected of expectedWords) {
    const idx = actualWords.findIndex((actual, i) => !used.has(i) && areEquivalentWords(expected, actual));
    if (idx >= 0) {
      used.add(idx);
      matched++;
    }
  }
  return matched;
}

function f1Score(matches: number, expectedCount: number, actualCount: number): number {
  if (matches <= 0 || expectedCount <= 0 || actualCount <= 0) return 0;
  const precision = matches / actualCount;
  const recall = matches / expectedCount;
  return (2 * precision * recall) / (precision + recall);
}

export function scoreCompleteness(
  transcript: string | null | undefined,
  expectedAnswersJson: string | null | undefined,
): number {
  if (!transcript || transcript.trim().length === 0) return 0;

  if (!expectedAnswersJson || expectedAnswersJson.trim().length === 0) {
    return transcript.length > 0 ? 0.5 : 0;
  }

  let expected: string[];
  try {
    expected = JSON.parse(expectedAnswersJson) as string[];
  } catch {
    return 0.5;
  }

  if (!Array.isArray(expected) || expected.length === 0) return 0.5;

  const actualWords = tokenize(transcript);

  let bestScore = 0;

  for (const exp of expected) {
    const expectedWords = tokenize(exp);
    if (expectedWords.length === 0) continue;

    const matched = countEquivalentMatches(expectedWords, actualWords);
    const score = f1Score(matched, expectedWords.length, actualWords.length);
    bestScore = Math.max(bestScore, score);
  }

  return Math.min(1, Math.max(0, bestScore));
}
