/**
 * Fluency scoring based on per-word timing.
 *
 * Key insight: WPM-based scoring is wrong for single-word tasks.
 * Saying "door" in 1 second IS perfect fluency — not 60%.
 *
 * Strategy:
 *   - Compute the AVERAGE seconds-per-word
 *   - Compare to a target range based on whether the task is single-word or multi-word
 *   - Apply hesitation / rush penalties
 *
 * Returns 0 when nothing was said.
 *
 * Healthy adult English: 0.3–0.6 seconds per word.
 * Single-word tasks are more lenient (0.3–1.5s is fine).
 */
export function scoreFluency(
  transcript: string | null | undefined,
  audioDurationSeconds: number,
  targetWordCount?: number,
): number {
  if (
    !transcript ||
    transcript.trim().length === 0 ||
    audioDurationSeconds <= 0
  ) {
    return 0;
  }

  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount === 0) return 0;

  // Use the larger of (transcript words, target words) to determine task type.
  const taskWordCount = Math.max(wordCount, targetWordCount ?? 0);
  const isSingleWordTask = taskWordCount <= 1;

  // ── Single-word task ──────────────────────────────────────────────────────
  // Score based on total duration. Saying "door" should take 0.3–1.5 seconds.
  if (isSingleWordTask) {
    if (audioDurationSeconds < 0.2) return 0.3; // unrealistically fast
    if (audioDurationSeconds <= 1.5) return 1.0; // ideal range
    if (audioDurationSeconds <= 2.5) return 0.8; // a bit slow
    if (audioDurationSeconds <= 4.0) return 0.5; // hesitant
    if (audioDurationSeconds <= 6.0) return 0.3; // very hesitant
    return 0.15;                                  // extreme hesitation
  }

  // ── Multi-word task ───────────────────────────────────────────────────────
  // Score based on average seconds per word.
  const secondsPerWord = audioDurationSeconds / wordCount;

  // Smooth piecewise-linear curve:
  //   0.30s/word → 1.00 (ideal)
  //   0.50s/word → 1.00 (still ideal)
  //   0.80s/word → 0.80
  //   1.20s/word → 0.55
  //   1.60s/word → 0.30
  //   2.00s/word → 0.15
  //   < 0.20s/word → rushed
  let score: number;
  if (secondsPerWord < 0.20) {
    score = 0.3; // rushed/garbled
  } else if (secondsPerWord <= 0.60) {
    score = 1.0; // ideal
  } else if (secondsPerWord <= 0.85) {
    // linear from 1.0 → 0.8
    score = 1.0 - ((secondsPerWord - 0.60) / 0.25) * 0.2;
  } else if (secondsPerWord <= 1.25) {
    // linear from 0.8 → 0.5
    score = 0.8 - ((secondsPerWord - 0.85) / 0.4) * 0.3;
  } else if (secondsPerWord <= 1.75) {
    // linear from 0.5 → 0.3
    score = 0.5 - ((secondsPerWord - 1.25) / 0.5) * 0.2;
  } else {
    score = 0.15;
  }

  return Math.min(1, Math.max(0, score));
}
