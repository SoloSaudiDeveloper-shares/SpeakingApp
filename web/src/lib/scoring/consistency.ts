/**
 * Consistency rewards stable performance over time.
 *
 * - currentScore = 0 (no speech) → 0
 * - First attempt → 0 (no history to compare) — and the calculator will
 *   exclude consistency from the composite weight in this case.
 * - Has history → blends proximity-to-best with improvement-from-latest.
 */
export function scoreConsistency(
  currentScore: number,
  bestPreviousScore: number,
  latestPreviousScore: number,
  previousAttemptCount: number,
): number {
  // Nothing said this attempt → no consistency score.
  if (currentScore <= 0) return 0;

  // First attempt: no history. Returning 0 (not 0.5 or currentScore) ensures
  // we don't fabricate a consistency value. The calculator excludes this
  // from the composite when there's no history.
  if (previousAttemptCount === 0) return 0;

  // Improvement from latest attempt: -1 (regressed fully) → +1 (gained fully)
  const improvement = currentScore - latestPreviousScore;

  // Proximity to personal best (capped at 1.0)
  const proximityToBest =
    bestPreviousScore > 0
      ? Math.min(1, currentScore / bestPreviousScore)
      : currentScore;

  // 60% weight on proximity-to-best, 40% on improvement-from-latest.
  // Map improvement [-1, 1] → [0, 1].
  const score = proximityToBest * 0.6 + ((improvement + 1) / 2) * 0.4;

  return Math.min(1, Math.max(0, score));
}
