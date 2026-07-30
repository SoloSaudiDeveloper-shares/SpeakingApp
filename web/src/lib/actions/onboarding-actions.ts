import { db } from '../db';
import { students } from '../db/schema';
import { eq } from 'drizzle-orm';
import { monologueSufficiency, scoreContentQuality } from '../scoring/fluency-metrics';

export const CEFR_BANDS = ['A1', 'A2', 'B1', 'B2'] as const;
export type DiagnosticBand = (typeof CEFR_BANDS)[number];

export interface DiagnosticSample {
  kind?: 'read' | 'repeat' | 'free-speak' | 'recall';
  target?: string;
  transcript: string;
  fluencyIndex: number;
  speechRateWpm: number;
  contentScore?: number;
  targetScore?: number;
  /** Azure pronunciation proficiency for this sample (0–1). Present only on
   *  read-aloud steps where a reference text exists and Azure is configured. */
  pron?: number;
  byAzure?: boolean;
}

export interface DiagnosticPracticePathItem {
  title: string;
  href: string;
  reason: string;
}

export interface DiagnosticResult {
  fluencyIndex: number;       // 0–1 averaged across samples
  speechRateWpm: number;
  /** Average Azure pronunciation proficiency (0–1) across read-aloud samples,
   *  or null when Azure didn't run. */
  pronAvg: number | null;
  contentScore: number;
  skillBands: {
    pronunciation: DiagnosticBand | null;
    fluency: DiagnosticBand;
    sentenceProduction: DiagnosticBand;
    recallReadiness: DiagnosticBand | null;
  };
  strengths: string[];
  weaknesses: string[];
  recommendedStartingStage: 'repeat' | 'read-aloud' | 'sentence' | 'free-speak' | 'review';
  recommendedPracticePath: DiagnosticPracticePathItem[];
  suggestedCefr: DiagnosticBand;
  samples: DiagnosticSample[];
  takenAt: string;
}

export async function getOnboardingState(studentId: number): Promise<{ onboarded: boolean; hasDiagnostic: boolean; cefrBand: string }> {
  const s = ((await db.select().from(students).where(eq(students.id, studentId)).limit(1))[0]);
  return {
    onboarded: !!s?.onboardedAt,
    hasDiagnostic: !!s?.diagnosticJson,
    cefrBand: s?.cefrBand ?? 'A1',
  };
}

export async function markOnboarded(studentId: number) {
  (await db.update(students)
    .set({ onboardedAt: new Date().toISOString() })
    .where(eq(students.id, studentId)));
}

export async function resetDiagnostic(studentId: number) {
  (await db.update(students)
    .set({ diagnosticJson: null, onboardedAt: null })
    .where(eq(students.id, studentId)));
}

export async function saveDiagnostic(studentId: number, result: DiagnosticResult, applyCefr: boolean) {
  const update: Record<string, string> = { diagnostic_json: JSON.stringify(result) } as never;
  (await db.update(students)
    .set(applyCefr
      ? { diagnosticJson: JSON.stringify(result), cefrBand: result.suggestedCefr }
      : { diagnosticJson: JSON.stringify(result) })
    .where(eq(students.id, studentId)));
  void update;
}

/** Map a measured fluency index + speech rate to a suggested CEFR band.
 *  This is the SPONTANEOUS-FLUENCY axis — best measured on the free-speak task. */
export function suggestCefr(fluencyIndex: number, speechRateWpm: number): DiagnosticBand {
  // Combine smoothness (index) and pace (wpm) into a rough band estimate.
  if (fluencyIndex >= 0.7 && speechRateWpm >= 120) return 'B2';
  if (fluencyIndex >= 0.55 && speechRateWpm >= 95) return 'B1';
  if (fluencyIndex >= 0.4 && speechRateWpm >= 60) return 'A2';
  return 'A1';
}

/** Map an Azure pronunciation proficiency (0–1) to a band. This is the
 *  PRONUNCIATION axis — best measured on the read-aloud tasks. */
export function suggestCefrFromPronunciation(pron: number): DiagnosticBand {
  if (pron >= 0.85) return 'B2';
  if (pron >= 0.70) return 'B1';
  if (pron >= 0.50) return 'A2';
  return 'A1';
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function countWords(text: string): number {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).length;
}

function sampleReliability(sample: DiagnosticSample): number {
  const wordCount = countWords(sample.transcript);
  if (wordCount === 0) return 0;

  const estimatedSpeechSeconds = sample.speechRateWpm > 0
    ? (wordCount / sample.speechRateWpm) * 60
    : 0;

  const sufficiency = monologueSufficiency(wordCount, estimatedSpeechSeconds);
  const content = scoreContentQuality(sample.transcript);

  // Diagnostic placement must not let tiny or repeated clips look fluent just
  // because the rate math is high. The read prompts are full sentences, so real
  // diagnostic samples easily clear this floor; "hello", "yo yo", etc. do not.
  const lengthCap = wordCount < 4 ? 0.25 : wordCount < 8 ? 0.65 : 1;
  return clamp01(Math.min(lengthCap, sufficiency * content));
}

function maxBandForReliability(avgReliability: number): DiagnosticBand {
  if (avgReliability < 0.35) return 'A1';
  if (avgReliability < 0.65) return 'A2';
  if (avgReliability < 0.85) return 'B1';
  return 'B2';
}

function lowerBand(a: DiagnosticBand, b: DiagnosticBand): DiagnosticBand {
  return CEFR_BANDS[Math.min(CEFR_BANDS.indexOf(a), CEFR_BANDS.indexOf(b))];
}

function bandFromScore(score: number): DiagnosticBand {
  if (score >= 0.85) return 'B2';
  if (score >= 0.70) return 'B1';
  if (score >= 0.50) return 'A2';
  return 'A1';
}

function average(values: number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function practicePath(
  first: DiagnosticResult['recommendedStartingStage'],
): DiagnosticPracticePathItem[] {
  if (first === 'repeat') {
    return [
      { title: 'Repeat practice', href: '/practice?stage=repeat', reason: 'Build clearer sound imitation first.' },
      { title: 'Read aloud', href: '/practice?stage=read-aloud', reason: 'Practice full-word decoding with visible text.' },
      { title: 'Weak Words', href: '/practice/weak-words', reason: 'Review words and sounds that need attention.' },
    ];
  }
  if (first === 'sentence') {
    return [
      { title: 'Sentence practice', href: '/practice?stage=sentence', reason: 'Build complete sentences before open speech.' },
      { title: 'Free Speak', href: '/practice?stage=free-speak', reason: 'Use vocabulary in your own sentence.' },
      { title: 'Fluency Drills', href: '/practice/fluency', reason: 'Improve pace, pauses, and run length.' },
    ];
  }
  if (first === 'review') {
    return [
      { title: 'Review', href: '/practice?stage=review', reason: 'Refresh vocabulary recall before new speaking tasks.' },
      { title: 'Weak Words', href: '/practice/weak-words', reason: 'Focus only on words that need another pass.' },
      { title: 'Repeat practice', href: '/practice?stage=repeat', reason: 'Reconnect meaning, sound, and pronunciation.' },
    ];
  }
  return [
    { title: 'Free Speak', href: '/practice?stage=free-speak', reason: 'Practice using the word in your own sentence.' },
    { title: 'Fluency Drills', href: '/practice/fluency', reason: 'Increase smoothness and speaking stamina.' },
    { title: 'Practice Hub', href: '/practice/hub', reason: 'Continue through your assigned learning path.' },
  ];
}

function buildStrengths(input: {
  pronAvg: number | null;
  fluencyIndex: number;
  contentScore: number;
  recallScore: number | null;
}): string[] {
  const strengths: string[] = [];
  if (input.pronAvg !== null && input.pronAvg >= 0.75) strengths.push('Clear pronunciation on guided tasks.');
  if (input.fluencyIndex >= 0.60) strengths.push('Good speaking flow for your current level.');
  if (input.contentScore >= 0.70) strengths.push('Meaningful sentence production.');
  if (input.recallScore !== null && input.recallScore >= 0.75) strengths.push('Strong vocabulary recall.');
  if (strengths.length === 0) strengths.push('You completed the check and we have a clear starting point.');
  return strengths.slice(0, 4);
}

function buildWeaknesses(input: {
  pronAvg: number | null;
  fluencyIndex: number;
  contentScore: number;
  recallScore: number | null;
}): string[] {
  const weaknesses: string[] = [];
  if (input.pronAvg !== null && input.pronAvg < 0.65) weaknesses.push('Pronunciation needs focused repeat and read-aloud practice.');
  if (input.fluencyIndex < 0.50) weaknesses.push('Build longer, smoother speech with fewer short stops.');
  if (input.contentScore < 0.60) weaknesses.push('Practice making complete English sentences with clear meaning.');
  if (input.recallScore !== null && input.recallScore < 0.65) weaknesses.push('Review vocabulary recall before moving too fast.');
  if (weaknesses.length === 0) weaknesses.push('Keep practicing all modes to maintain balance.');
  return weaknesses.slice(0, 4);
}

function chooseStartingStage(input: {
  pronAvg: number | null;
  fluencyIndex: number;
  contentScore: number;
  recallScore: number | null;
}): DiagnosticResult['recommendedStartingStage'] {
  if (input.pronAvg !== null && input.pronAvg < 0.65) return 'repeat';
  if (input.fluencyIndex < 0.50) return 'sentence';
  if (input.contentScore < 0.60) return 'sentence';
  if (input.recallScore !== null && input.recallScore < 0.65) return 'review';
  return 'free-speak';
}

/**
 * Estimate a starting band from the diagnostic samples. When Azure pronunciation
 * scores are present (read-aloud), blend the two complementary axes:
 *   - spontaneous fluency (rate/pauses — mostly from the free-speak task), and
 *   - pronunciation accuracy/prosody (from Azure on the reads).
 * Fluency is weighted a touch higher so a clean read of SIMPLE sentences can't
 * over-place a learner who can't yet speak fluently. With no Azure data it
 * degrades exactly to the original fluency-only heuristic (backward compatible).
 */
export function suggestCefrFromSamples(samples: DiagnosticSample[]): {
  suggestedCefr: DiagnosticBand;
  fluencyIndex: number;
  speechRateWpm: number;
  pronAvg: number | null;
} {
  const n = samples.length;
  const reliabilities = samples.map(sampleReliability);
  const avgReliability = n ? reliabilities.reduce((s, x) => s + x, 0) / n : 0;
  const avgIndex = n ? samples.reduce((s, x, i) => s + ((x.fluencyIndex || 0) * reliabilities[i]), 0) / n : 0;
  const avgWpm = n ? Math.round(samples.reduce((s, x, i) => s + ((x.speechRateWpm || 0) * reliabilities[i]), 0) / n) : 0;
  const fluencyBand = suggestCefr(avgIndex, avgWpm);
  const reliabilityCap = maxBandForReliability(avgReliability);

  const withPron = samples.filter((s) => typeof s.pron === 'number');
  if (withPron.length === 0) {
    return { suggestedCefr: lowerBand(fluencyBand, reliabilityCap), fluencyIndex: avgIndex, speechRateWpm: avgWpm, pronAvg: null };
  }

  const pronAvg = withPron.reduce((s, x) => s + (x.pron as number), 0) / withPron.length;
  const pronBand = suggestCefrFromPronunciation(pronAvg);
  const fo = CEFR_BANDS.indexOf(fluencyBand);
  const po = CEFR_BANDS.indexOf(pronBand);
  const blended = Math.round(fo * 0.55 + po * 0.45);
  const blendedBand = CEFR_BANDS[Math.max(0, Math.min(CEFR_BANDS.length - 1, blended))];
  return {
    suggestedCefr: lowerBand(blendedBand, reliabilityCap),
    fluencyIndex: avgIndex,
    speechRateWpm: avgWpm,
    pronAvg: Math.round(pronAvg * 1000) / 1000,
  };
}

export function analyzeDiagnosticSamples(samples: DiagnosticSample[]): DiagnosticResult {
  const speakingSamples = samples.filter((sample) => sample.kind !== 'recall');
  const est = suggestCefrFromSamples(speakingSamples.length > 0 ? speakingSamples : samples);
  const routingFluencyIndex = average((speakingSamples.length > 0 ? speakingSamples : samples)
    .map((sample) => clamp01(sample.fluencyIndex || 0))) ?? est.fluencyIndex;
  const routingSpeechRateWpm = Math.round(average((speakingSamples.length > 0 ? speakingSamples : samples)
    .map((sample) => Math.max(0, sample.speechRateWpm || 0))) ?? est.speechRateWpm);
  const freeSpeakContent = samples
    .filter((sample) => sample.kind === 'free-speak')
    .map((sample) => typeof sample.contentScore === 'number'
      ? clamp01(sample.contentScore)
      : scoreContentQuality(sample.transcript));
  const fallbackContent = samples.map((sample) => scoreContentQuality(sample.transcript));
  const contentScore = average(freeSpeakContent) ?? average(fallbackContent) ?? 0;
  const recallScore = average(samples
    .filter((sample) => sample.kind === 'recall')
    .map((sample) => typeof sample.targetScore === 'number' ? clamp01(sample.targetScore) : 0));

  const sentenceProductionScore = Math.min(
    contentScore,
    Math.max(est.fluencyIndex, average(samples.map(sampleReliability)) ?? 0),
  );

  const skillBands = {
    pronunciation: est.pronAvg === null ? null : suggestCefrFromPronunciation(est.pronAvg),
    fluency: suggestCefr(routingFluencyIndex, routingSpeechRateWpm),
    sentenceProduction: bandFromScore(sentenceProductionScore),
    recallReadiness: recallScore === null ? null : bandFromScore(recallScore),
  };

  const profile = {
    pronAvg: est.pronAvg,
    fluencyIndex: routingFluencyIndex,
    contentScore,
    recallScore,
  };
  const recommendedStartingStage = chooseStartingStage(profile);

  return {
    fluencyIndex: round3(routingFluencyIndex),
    speechRateWpm: routingSpeechRateWpm,
    pronAvg: est.pronAvg,
    contentScore: round3(contentScore),
    skillBands,
    strengths: buildStrengths(profile),
    weaknesses: buildWeaknesses(profile),
    recommendedStartingStage,
    recommendedPracticePath: practicePath(recommendedStartingStage),
    suggestedCefr: est.suggestedCefr,
    samples,
    takenAt: new Date().toISOString(),
  };
}
