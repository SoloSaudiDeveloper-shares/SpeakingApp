"use client"

import { compareTextToTranscript, type WordComparison } from "@/lib/scoring/text-comparison"

interface Props {
  expected: string
  transcript: string
}

/**
 * Renders a word-by-word colored diff of expected text vs. what the student
 * said: green = correct, amber = close (high similarity), red = missed/wrong.
 */
export function WordDiff({ expected, transcript }: Props) {
  const cmp = compareTextToTranscript(expected, transcript)
  return (
    <div className="flex flex-wrap gap-1.5 text-sm">
      {cmp.wordComparisons.map((w: WordComparison, i: number) => {
        const cls = w.correct
          ? "bg-emerald-500/20 text-emerald-300"
          : w.similarity >= 0.6
            ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30"
            : "bg-red-500/20 text-red-300 ring-1 ring-red-500/30"
        return (
          <span
            key={i}
            className={`rounded px-1.5 py-0.5 font-mono text-xs ${cls}`}
            title={w.spoken ? `you said: "${w.spoken}"` : "not detected"}
          >
            {w.expected}
          </span>
        )
      })}
    </div>
  )
}
