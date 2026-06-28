/**
 * Research-backed fluency metrics (Segalowitz / Skehan utterance-fluency model).
 *
 * From a transcript + total audio duration + a log of pause events we derive the
 * canonical second-language fluency measures:
 *   - speechRateWpm     : words per minute (INCLUDING pauses) — overall pace
 *   - articulationRateWpm: words per minute of ACTUAL phonation (excludes pauses)
 *   - pauseCount / pausePerMin : breakdown fluency (hesitation frequency)
 *   - meanLengthOfRun   : mean words spoken between pauses — the canonical MLR
 *   - fluencyIndex      : 0–1 composite, CEFR-banded
 *
 * Web Speech API does not provide word timestamps, so articulation rate / MLR are
 * derived from the pause-event log we capture on the client. The functions accept
 * an OPTIONAL `wordTimings` argument for the future (Whisper can provide these),
 * in which case exact values are computed instead.
 */

export type CefrBand = 'A1' | 'A2' | 'B1' | 'B2';

export interface PauseEvent {
  /** ms offset from recording start (optional, informational). */
  at?: number;
  /** silence duration in milliseconds. */
  durationMs: number;
}

export interface WordTiming {
  word: string;
  start: number; // seconds
  end: number;   // seconds
}

export interface FluencyMetrics {
  schemaVersion: 1;
  wordCount: number;
  audioDurationSeconds: number;
  speechRateWpm: number;
  articulationRateWpm: number;
  pauseCount: number;
  pausePerMin: number;
  totalPauseSeconds: number;
  meanLengthOfRun: number;
  fluencyIndex: number; // 0–1
}

export interface ComputeFluencyInput {
  transcript: string;
  audioDurationSeconds: number;
  pauseEvents?: PauseEvent[];
  wordTimings?: WordTiming[];
  cefrBand?: CefrBand;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Ideal speaking pace targets by CEFR band (words/min). Native conversational
 * English is ~140–160 wpm; learners are expected to be slower at lower levels.
 * These are the speech-rate "sweet spots" used to normalize the fluency index.
 */
const TARGET_WPM: Record<CefrBand, { ideal: number; floor: number }> = {
  A1: { ideal: 80,  floor: 35 },
  A2: { ideal: 100, floor: 45 },
  B1: { ideal: 120, floor: 60 },
  B2: { ideal: 140, floor: 75 },
};

/** Target mean-length-of-run (words between pauses) by band. */
const TARGET_MLR: Record<CefrBand, number> = { A1: 3, A2: 4, B1: 6, B2: 8 };

/** Acceptable pauses-per-minute ceiling by band (more pauses = less fluent). */
const PAUSE_CEILING: Record<CefrBand, number> = { A1: 30, A2: 26, B1: 22, B2: 18 };

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function computeFluencyMetrics(input: ComputeFluencyInput): FluencyMetrics {
  const band = input.cefrBand ?? 'A1';
  const duration = Math.max(0, input.audioDurationSeconds);
  const wordCount = countWords(input.transcript);

  // ── Pause aggregation ─────────────────────────────────────────────
  let pauseCount: number;
  let totalPauseSeconds: number;

  if (input.wordTimings && input.wordTimings.length > 1) {
    // Exact: gaps between consecutive words (≥ 250ms counts as a pause)
    const PAUSE_MIN = 0.25;
    let count = 0;
    let total = 0;
    for (let i = 1; i < input.wordTimings.length; i++) {
      const gap = input.wordTimings[i].start - input.wordTimings[i - 1].end;
      if (gap >= PAUSE_MIN) { count++; total += gap; }
    }
    pauseCount = count;
    totalPauseSeconds = total;
  } else {
    const events = input.pauseEvents ?? [];
    pauseCount = events.length;
    totalPauseSeconds = events.reduce((s, e) => s + e.durationMs / 1000, 0);
  }
  totalPauseSeconds = Math.min(totalPauseSeconds, duration); // sanity clamp

  // ── Rates ─────────────────────────────────────────────────────────
  const minutes = duration / 60;
  const phonationSeconds = Math.max(0.1, duration - totalPauseSeconds);
  const phonationMinutes = phonationSeconds / 60;

  const speechRateWpm = minutes > 0 ? wordCount / minutes : 0;
  const articulationRateWpm = phonationMinutes > 0 ? wordCount / phonationMinutes : 0;
  const pausePerMin = minutes > 0 ? pauseCount / minutes : 0;
  const meanLengthOfRun = wordCount / (pauseCount + 1);

  // ── Fluency index (0–1), CEFR-banded ──────────────────────────────
  // No speech → 0.
  let fluencyIndex = 0;
  if (wordCount > 0 && duration > 0) {
    const t = TARGET_WPM[band];

    // Speech-rate component: rises from floor→ideal, then plateaus (faster is
    // fine up to ~1.4× ideal, then very fast slightly penalized as rushed).
    let rateComp: number;
    if (speechRateWpm <= t.floor) {
      rateComp = clamp01((speechRateWpm / t.floor) * 0.4); // up to 0.4 below floor
    } else if (speechRateWpm <= t.ideal) {
      rateComp = 0.4 + 0.6 * ((speechRateWpm - t.floor) / (t.ideal - t.floor));
    } else if (speechRateWpm <= t.ideal * 1.4) {
      rateComp = 1.0;
    } else {
      rateComp = clamp01(1.0 - (speechRateWpm - t.ideal * 1.4) / (t.ideal * 1.4)); // rushed
    }

    // MLR component: longer runs (fewer mid-utterance pauses) = more fluent.
    const mlrComp = clamp01(meanLengthOfRun / TARGET_MLR[band]);

    // Pause-frequency penalty: more pauses/min than the ceiling drags it down.
    const pausePenalty = clamp01(1 - Math.max(0, pausePerMin - PAUSE_CEILING[band]) / PAUSE_CEILING[band]);

    // Weighted blend: pace 50%, runs 30%, pause control 20%.
    fluencyIndex = clamp01(rateComp * 0.5 + mlrComp * 0.3 + pausePenalty * 0.2);
  }

  return {
    schemaVersion: 1,
    wordCount,
    audioDurationSeconds: Math.round(duration * 100) / 100,
    speechRateWpm: Math.round(speechRateWpm),
    articulationRateWpm: Math.round(articulationRateWpm),
    pauseCount,
    pausePerMin: Math.round(pausePerMin * 10) / 10,
    totalPauseSeconds: Math.round(totalPauseSeconds * 100) / 100,
    meanLengthOfRun: Math.round(meanLengthOfRun * 10) / 10,
    fluencyIndex: Math.round(fluencyIndex * 1000) / 1000,
  };
}

/** Convert rich metrics to the 0–1 fluency dimension used by the scorer. */
export function scoreFluencyFromMetrics(metrics: FluencyMetrics): number {
  return metrics.fluencyIndex;
}

/**
 * Sustained-speech sufficiency for a 4/3/2 monologue round (0–1).
 *
 * Rate math (words ÷ minutes) explodes for tiny clips: saying "yo yo" and
 * stopping after ~1s computes to ~90 wpm and would otherwise read as highly
 * fluent. But a monologue measures SUSTAINED automatic speech, so a round only
 * earns full fluency credit once enough words have been produced over enough
 * time. Below the floor, the fluency index is scaled down proportionally — a
 * couple of words can never score as "fluent".
 */
export function monologueSufficiency(wordCount: number, speechSeconds: number): number {
  const MIN_WORDS = 10;
  const MIN_SECONDS = 5;
  if (wordCount <= 0 || speechSeconds <= 0) return 0;
  return clamp01(Math.min(wordCount / MIN_WORDS, speechSeconds / MIN_SECONDS));
}

/**
 * Content-quality score (0–1) for a free monologue — the part the rate-based
 * fluency index is blind to. It catches SUSTAINED nonsense: "yo yo yo yo…" said
 * fast for the full time has a perfectly good speech rate but says nothing.
 *
 * Purely lexical (offline, no AI): rewards a VARIETY of words and punishes
 * extreme repetition. Normal speech — which naturally repeats function words
 * ("the", "I", "and") — scores ~1.0; only pathological repetition / word-salad
 * drops. An AI coherence/on-topic grade refines this further when available.
 */
export function scoreContentQuality(transcript: string): number {
  const words = (transcript.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => w.length > 0);
  const n = words.length;
  if (n === 0) return 0;
  // Too few words to judge repetition meaningfully — brevity is handled by the
  // rate / sufficiency metrics, not here, so a short legit answer ("I use a pen")
  // is never docked for content.
  if (n < 4) return 1;

  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  let topCount = 0;
  for (const c of freq.values()) if (c > topCount) topCount = c;
  const topShare = topCount / n;
  const ttr = freq.size / n; // type-token ratio — length-robust

  // Extreme single-token dominance ("yo yo yo", "the the the").
  const repetition = clamp01(1 - Math.max(0, topShare - 0.4) / 0.5);
  // Very low lexical diversity = the same few words over and over. Only bites
  // below ~0.35 TTR; normal speech (even a long monologue) stays well above it,
  // so this is length-robust — a 6-word sentence and a 60-word monologue are
  // both judged fairly.
  const diversity = clamp01((ttr - 0.1) / 0.25);
  return Math.min(repetition, diversity);
}

/**
 * Score improvement across the 3 rounds of a 4/3/2 monologue.
 * The classic outcome is a RISING speech/articulation rate as content is
 * internalized. Rewards faster + smoother later rounds vs the first.
 * Returns 0–1.
 */
export function scoreMonologueImprovement(
  rounds: { speechRateWpm: number; articulationRateWpm: number; fluencyIndex: number }[],
): number {
  if (rounds.length < 2) return rounds[0]?.fluencyIndex ?? 0;
  const first = rounds[0];
  const last = rounds[rounds.length - 1];

  // Relative gains (capped so a single huge jump doesn't dominate).
  const rateGain = first.speechRateWpm > 0
    ? clamp01((last.speechRateWpm - first.speechRateWpm) / first.speechRateWpm)
    : 0;
  const artGain = first.articulationRateWpm > 0
    ? clamp01((last.articulationRateWpm - first.articulationRateWpm) / first.articulationRateWpm)
    : 0;
  const fluencyGain = clamp01(last.fluencyIndex - first.fluencyIndex + 0.5); // centered at 0.5

  // Blend the absolute final fluency with the improvement signal so a student
  // who is already fluent AND improves both score well.
  const improvement = (rateGain + artGain) / 2;
  return clamp01(last.fluencyIndex * 0.5 + improvement * 0.3 + fluencyGain * 0.2);
}

/**
 * Shadowing timing match: score peaks when the student's spoken duration
 * matches the reference (model) duration — i.e. they matched the pace/rhythm.
 * Penalizes both rushing (too short) and dragging (too long). Returns 0–1.
 */
export function scoreTimingMatch(refDurationSec: number, studentDurationSec: number): number {
  if (refDurationSec <= 0 || studentDurationSec <= 0) return 0;
  const ratio = studentDurationSec / refDurationSec;
  // ratio 1.0 = perfect. Falls off symmetrically (in log space) either side.
  const dev = Math.abs(Math.log(ratio)); // 0 when ratio==1
  // log(1.5)≈0.405, log(2)≈0.693. Map dev→score.
  return clamp01(1 - dev / 0.7);
}
