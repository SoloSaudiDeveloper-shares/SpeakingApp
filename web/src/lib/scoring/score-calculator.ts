import { scoreTargetMatch } from './target-match';
import { scorePronunciation } from './pronunciation';
import { scoreFluency } from './fluency';
import { scoreCompleteness } from './completeness';
import { scoreConsistency } from './consistency';

export type CefrBand = 'A1' | 'A2' | 'B1' | 'B2';

export interface ScoreBreakdown {
  targetMatch: number;
  pronunciation: number;
  fluency: number;
  completeness: number;
  consistency: number;
  composite: number;
}

interface ScoreWeights {
  targetMatch: number;
  pronunciation: number;
  fluency: number;
  completeness: number;
  consistency: number;
}

const CEFR_WEIGHT_PROFILES: Record<CefrBand, ScoreWeights> = {
  A1: { targetMatch: 0.40, pronunciation: 0.20, fluency: 0.10, completeness: 0.25, consistency: 0.05 },
  A2: { targetMatch: 0.35, pronunciation: 0.25, fluency: 0.20, completeness: 0.10, consistency: 0.10 },
  B1: { targetMatch: 0.30, pronunciation: 0.25, fluency: 0.25, completeness: 0.10, consistency: 0.10 },
  B2: { targetMatch: 0.25, pronunciation: 0.25, fluency: 0.25, completeness: 0.10, consistency: 0.15 },
};

import type { FluencyMetrics } from './fluency-metrics';
import { scoreFluencyFromMetrics } from './fluency-metrics';

export interface CalculateScoreParams {
  transcript: string | null | undefined;
  expectedAnswersJson: string | null | undefined;
  spokenPhonemes: string | null | undefined;
  referencePhonemes: string | null | undefined;
  audioDurationSeconds: number;
  bestPreviousScore: number;
  latestPreviousScore: number;
  previousAttemptCount: number;
  cefrBand: CefrBand;
  /** Optional rich fluency metrics. When provided for multi-word tasks, the
   *  fluency dimension is derived from these research-backed measures instead
   *  of the words-per-second heuristic. Fully backward compatible. */
  fluencyMetrics?: FluencyMetrics;
}

const ZERO_BREAKDOWN: ScoreBreakdown = {
  targetMatch: 0,
  pronunciation: 0,
  fluency: 0,
  completeness: 0,
  consistency: 0,
  composite: 0,
};

export function calculateScore(params: CalculateScoreParams): ScoreBreakdown {
  const {
    transcript,
    expectedAnswersJson,
    spokenPhonemes,
    referencePhonemes,
    audioDurationSeconds,
    bestPreviousScore,
    latestPreviousScore,
    previousAttemptCount,
    cefrBand,
  } = params;

  // Short-circuit: no speech detected → 0% across the board. A transcript with
  // no actual word characters (e.g. "." that Whisper emits for silence) is NOT
  // a real attempt, so it must score zero on every dimension — including fluency.
  const cleanTranscript = (transcript ?? '').trim();
  const hasRealWord = /[\p{L}\p{N}]/u.test(cleanTranscript);
  if (!hasRealWord || audioDurationSeconds <= 0) {
    return { ...ZERO_BREAKDOWN };
  }

  // Each scorer compares the actual transcript to the actual target.
  // No hardcoded "neutral" defaults — every value reflects real similarity.
  const targetMatch = scoreTargetMatch(cleanTranscript, expectedAnswersJson);
  const pronunciation = scorePronunciation(
    spokenPhonemes,
    referencePhonemes,
    cleanTranscript,
    expectedAnswersJson,
  );
  // Determine target word count from expected answers (so fluency can
  // pick single-word vs multi-word logic).
  let targetWordCount: number | undefined;
  if (expectedAnswersJson) {
    try {
      const parsed = JSON.parse(expectedAnswersJson) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        targetWordCount = Math.max(
          ...parsed.map((s) => s.trim().split(/\s+/).filter(Boolean).length),
        );
      }
    } catch { /* ignore */ }
  }
  // Fluency: prefer rich research-backed metrics for multi-word utterances when
  // available; otherwise fall back to the words-per-second heuristic.
  const isMultiWord = (targetWordCount ?? cleanTranscript.split(/\s+/).filter(Boolean).length) > 1;
  const fluency = (params.fluencyMetrics && isMultiWord)
    ? scoreFluencyFromMetrics(params.fluencyMetrics)
    : scoreFluency(cleanTranscript, audioDurationSeconds, targetWordCount);
  const completeness = scoreCompleteness(cleanTranscript, expectedAnswersJson);

  // Preliminary score for consistency comparison (excludes consistency itself
  // to avoid recursion).
  const preliminaryScore =
    targetMatch * 0.4 + pronunciation * 0.2 + fluency * 0.2 + completeness * 0.2;

  const consistency = scoreConsistency(
    preliminaryScore,
    bestPreviousScore,
    latestPreviousScore,
    previousAttemptCount,
  );

  const weights = CEFR_WEIGHT_PROFILES[cefrBand];

  // If there's no history, EXCLUDE consistency from the composite and
  // renormalize the other weights so the composite reflects actual performance,
  // not a synthetic consistency value.
  let composite: number;
  if (previousAttemptCount === 0) {
    const sumWithoutConsistency =
      weights.targetMatch + weights.pronunciation + weights.fluency + weights.completeness;
    composite =
      (targetMatch * weights.targetMatch +
        pronunciation * weights.pronunciation +
        fluency * weights.fluency +
        completeness * weights.completeness) /
      sumWithoutConsistency;
  } else {
    composite =
      targetMatch * weights.targetMatch +
      pronunciation * weights.pronunciation +
      fluency * weights.fluency +
        completeness * weights.completeness +
      consistency * weights.consistency;
  }

  // A fluent wrong answer is still wrong. This guard prevents pace or fuzzy
  // pronunciation from inflating a response with no meaningful target match.
  if (targetMatch <= 0.05 && completeness <= 0.05) {
    composite = Math.min(composite, 0.25);
  } else if (targetMatch < 0.5) {
    composite = Math.min(composite, 0.65);
  }

  const clamp = (v: number) => Math.min(1, Math.max(0, v));

  return {
    targetMatch: clamp(targetMatch),
    pronunciation: clamp(pronunciation),
    fluency: clamp(fluency),
    completeness: clamp(completeness),
    consistency: clamp(consistency),
    composite: clamp(composite),
  };
}
