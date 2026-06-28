/**
 * Maps Azure AI Speech — Pronunciation Assessment results into the app's
 * ScoreBreakdown + feedback, including phoneme-level detail. Pure functions so
 * they can be unit-tested with a sample Azure response.
 */

import type { ScoreBreakdown, CefrBand } from './score-calculator';
import type { FullFeedback, FeedbackLevel } from './feedback';

export interface PhonemeScore { phoneme: string; accuracy: number }
export interface WordScore {
  word: string;
  accuracy: number;       // 0–100
  errorType: string;      // None | Mispronunciation | Omission | Insertion | ...
  phonemes: PhonemeScore[];
}

export interface AzureAssessment {
  breakdown: ScoreBreakdown;
  feedback: FullFeedback;
  recognizedText: string;
  words: WordScore[];
  raw: { accuracy: number; fluency: number; completeness: number; prosody: number; pron: number };
}

const WEIGHTS: Record<CefrBand, { target: number; pron: number; fluency: number; complete: number }> = {
  A1: { target: 0.30, pron: 0.45, fluency: 0.10, complete: 0.15 },
  A2: { target: 0.25, pron: 0.45, fluency: 0.20, complete: 0.10 },
  B1: { target: 0.25, pron: 0.40, fluency: 0.25, complete: 0.10 },
  B2: { target: 0.20, pron: 0.40, fluency: 0.30, complete: 0.10 },
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const level = (s: number): FeedbackLevel => (s >= 0.9 ? 'excellent' : s >= 0.75 ? 'good' : s >= 0.5 ? 'fair' : s === 0 ? 'no_speech' : 'needs_work');

/* eslint-disable @typescript-eslint/no-explicit-any */
function num(v: any, d = 0): number { const n = Number(v); return Number.isFinite(n) ? n : d; }

/**
 * Parse a raw Azure REST response. Returns null when the response isn't a
 * usable assessment (e.g. no speech / no NBest), so the caller falls back.
 */
export function assessFromAzureResponse(
  azure: any,
  cefrBand: CefrBand,
  previousConsistency: number,
): AzureAssessment | null {
  if (!azure || azure.RecognitionStatus !== 'Success') return null;
  const best = Array.isArray(azure.NBest) ? azure.NBest[0] : null;
  if (!best) return null;

  // Scores may be NESTED under `PronunciationAssessment` (older API) or
  // FLATTENED directly onto the utterance/word/phoneme objects (current API).
  // Support both by falling back to the parent object.
  const pa = best.PronunciationAssessment ?? best;
  if (pa.AccuracyScore === undefined && pa.PronScore === undefined) return null;

  const accuracy = num(pa.AccuracyScore);
  const fluency = num(pa.FluencyScore);
  const completeness = num(pa.CompletenessScore, 100);
  const prosody = num(pa.ProsodyScore, accuracy);
  const pron = num(pa.PronScore, accuracy);

  const words: WordScore[] = (best.Words ?? []).map((w: any) => {
    const wpa = w.PronunciationAssessment ?? w;
    return {
      word: String(w.Word ?? ''),
      accuracy: num(wpa.AccuracyScore),
      errorType: String(wpa.ErrorType ?? 'None'),
      phonemes: (w.Phonemes ?? []).map((p: any) => {
        const ppa = p.PronunciationAssessment ?? p;
        return { phoneme: String(p.Phoneme ?? ''), accuracy: num(ppa.AccuracyScore) };
      }),
    };
  });

  // targetMatch = fraction of reference words actually attempted (not omitted).
  const said = words.filter((w) => w.errorType !== 'Omission' && w.errorType !== 'Insertion').length;
  const targetMatch = words.length ? said / words.length : clamp01(completeness / 100);

  const b = {
    targetMatch: clamp01(targetMatch),
    pronunciation: clamp01(accuracy / 100),
    fluency: clamp01(fluency / 100),
    completeness: clamp01(completeness / 100),
    consistency: clamp01(previousConsistency),
  };
  const w = WEIGHTS[cefrBand];
  const composite = clamp01(b.targetMatch * w.target + b.pronunciation * w.pron + b.fluency * w.fluency + b.completeness * w.complete);
  const breakdown: ScoreBreakdown = { ...b, composite };

  return {
    breakdown,
    feedback: buildAzureFeedback(breakdown, words, String(best.Display ?? azure.DisplayText ?? '')),
    recognizedText: String(best.Display ?? azure.DisplayText ?? '').toLowerCase().trim(),
    words,
    raw: { accuracy, fluency, completeness, prosody, pron },
  };
}

function buildAzureFeedback(b: ScoreBreakdown, words: WordScore[], display: string): FullFeedback {
  const overallLevel = level(b.composite);
  // Worst-scoring words drive the specific advice.
  const problemWords = words
    .filter((w) => w.errorType === 'Omission' || w.errorType === 'Mispronunciation' || w.accuracy < 70)
    .sort((a, z) => a.accuracy - z.accuracy);

  let headline: string, summary: string;
  if (overallLevel === 'no_speech') { headline = 'No speech detected'; summary = 'We didn\'t hear anything. Move closer to the mic and try again.'; }
  else if (overallLevel === 'excellent') { headline = 'Excellent pronunciation!'; summary = `Clear and accurate — "${display}".`; }
  else if (overallLevel === 'good') { headline = 'Good pronunciation'; summary = problemWords.length ? `Mostly clear. Polish: ${problemWords.slice(0, 2).map((w) => `"${w.word}"`).join(', ')}.` : 'Clear and natural.'; }
  else if (overallLevel === 'fair') { headline = 'Getting there'; summary = problemWords.length ? `Work on the sounds in ${problemWords.slice(0, 2).map((w) => `"${w.word}"`).join(', ')}.` : 'Slow down and articulate each sound.'; }
  else { headline = 'Keep practicing'; summary = problemWords.length ? `Focus on ${problemWords.slice(0, 3).map((w) => `"${w.word}"`).join(', ')}.` : 'Listen to the model and match each sound.'; }

  const dims = [
    { dimension: 'Pronunciation', score: b.pronunciation },
    { dimension: 'Fluency', score: b.fluency },
    { dimension: 'Completeness', score: b.completeness },
    { dimension: 'Target Match', score: b.targetMatch },
  ];
  const strengths = dims.filter((d) => d.score >= 0.75).map((d) => ({ dimension: d.dimension, score: d.score, level: level(d.score), message: 'Strong here.', suggestion: null }));
  const weaknesses = dims.filter((d) => d.score < 0.75 && d.score > 0).map((d) => ({
    dimension: d.dimension, score: d.score, level: level(d.score),
    message: `${Math.round(d.score * 100)}% — room to improve.`,
    suggestion: d.dimension === 'Pronunciation' && problemWords[0]
      ? `Practise the sounds in "${problemWords[0].word}": ${problemWords[0].phonemes.filter((p) => p.accuracy < 70).map((p) => `/${p.phoneme}/`).join(' ') || 'listen and repeat slowly'}.`
      : null,
  }));

  const firstProblem = problemWords[0];
  const modelAnswer = display.trim() || null;
  const nextFix = overallLevel === 'no_speech'
    ? {
        title: 'Try again clearly',
        message: 'Move closer to the microphone, say the model answer once, then stop recording.',
      }
    : firstProblem
      ? {
          title: `Fix "${firstProblem.word}" next`,
          message: firstProblem.phonemes.some((p) => p.accuracy < 70)
            ? `Slow down and repeat the weak sound: ${firstProblem.phonemes.filter((p) => p.accuracy < 70).map((p) => `/${p.phoneme}/`).join(' ')}.`
            : `Listen once, then repeat "${firstProblem.word}" slowly.`,
        }
      : {
          title: 'Keep the same quality',
          message: modelAnswer ? `Shadow the model once more: "${modelAnswer}".` : 'Move on when you are ready.',
        };

  return {
    overall: { level: overallLevel, headline, summary },
    nextFix,
    modelAnswer,
    nextAction: overallLevel === 'no_speech' ? 'try_again' : modelAnswer ? 'shadow_model' : 'move_on',
    strengths,
    weaknesses,
    diff: null,
  };
}
