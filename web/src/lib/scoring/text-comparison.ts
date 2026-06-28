import { areEquivalentWords } from './homophones';

export interface WordComparison {
  expected: string;
  spoken: string | null;
  correct: boolean;
  similarity: number; // 0-1
}

export interface TextComparisonResult {
  wordComparisons: WordComparison[];
  accuracyScore: number;
  weakWords: string[];
  completenessScore: number;
}

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (areEquivalentWords(a, b)) return 0.96;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

/**
 * Align expected words with spoken words using dynamic programming (similar to diff).
 * Finds the best alignment that minimizes edit distance at the word level.
 */
function alignWords(expected: string[], spoken: string[]): WordComparison[] {
  const m = expected.length;
  const n = spoken.length;

  // DP table: cost[i][j] = min cost to align expected[0..i-1] with spoken[0..j-1]
  const cost: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  // ops[i][j]: 'match'|'substitute'|'delete'|'insert'
  const ops: string[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(''));

  for (let i = 0; i <= m; i++) { cost[i][0] = i; ops[i][0] = 'delete'; }
  for (let j = 0; j <= n; j++) { cost[0][j] = j; ops[0][j] = 'insert'; }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sim = wordSimilarity(expected[i - 1], spoken[j - 1]);
      const matchCost = cost[i - 1][j - 1] + (sim >= 0.7 ? 0 : 1);
      const deleteCost = cost[i - 1][j] + 1;
      const insertCost = cost[i][j - 1] + 1;

      if (matchCost <= deleteCost && matchCost <= insertCost) {
        cost[i][j] = matchCost;
        ops[i][j] = sim >= 0.7 ? 'match' : 'substitute';
      } else if (deleteCost <= insertCost) {
        cost[i][j] = deleteCost;
        ops[i][j] = 'delete';
      } else {
        cost[i][j] = insertCost;
        ops[i][j] = 'insert';
      }
    }
  }

  // Backtrace
  const result: WordComparison[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && (ops[i][j] === 'match' || ops[i][j] === 'substitute')) {
      const sim = wordSimilarity(expected[i - 1], spoken[j - 1]);
      result.unshift({
        expected: expected[i - 1],
        spoken: spoken[j - 1],
        correct: sim >= 0.7,
        similarity: sim,
      });
      i--; j--;
    } else if (i > 0 && ops[i][j] === 'delete') {
      result.unshift({
        expected: expected[i - 1],
        spoken: null,
        correct: false,
        similarity: 0,
      });
      i--;
    } else {
      // insert — extra spoken word, skip
      j--;
    }
  }

  return result;
}

export function compareTextToTranscript(
  originalText: string,
  spokenTranscript: string
): TextComparisonResult {
  const expectedWords = normalize(originalText);
  const spokenWords = normalize(spokenTranscript);

  if (expectedWords.length === 0) {
    return {
      wordComparisons: [],
      accuracyScore: 0,
      weakWords: [],
      completenessScore: 0,
    };
  }

  const wordComparisons = alignWords(expectedWords, spokenWords);
  const correctCount = wordComparisons.filter((w) => w.correct).length;
  const spokenCount = wordComparisons.filter((w) => w.spoken !== null).length;

  const accuracyScore = Math.round((correctCount / expectedWords.length) * 100);
  const completenessScore = Math.round((spokenCount / expectedWords.length) * 100);

  const weakWords = wordComparisons
    .filter((w) => !w.correct)
    .map((w) => w.expected);

  // Deduplicate weak words
  const uniqueWeakWords = [...new Set(weakWords)];

  return {
    wordComparisons,
    accuracyScore,
    weakWords: uniqueWeakWords,
    completenessScore,
  };
}
