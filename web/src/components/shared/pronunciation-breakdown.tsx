"use client"

import { Mic } from "lucide-react"
import type { WordScore } from "@/lib/scoring/azure-pronunciation"

function accColor(acc: number): string {
  if (acc >= 80) return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"
  if (acc >= 60) return "bg-amber-500/15 text-amber-400 ring-amber-500/30"
  return "bg-red-500/15 text-red-400 ring-red-500/30"
}

/**
 * Phoneme-level pronunciation feedback from Azure: each word coloured by its
 * accuracy, with the sounds (phonemes) of the weakest words broken out so the
 * learner can see exactly which sound to fix.
 */
export function PronunciationBreakdown({ words }: { words: WordScore[] }) {
  if (!words.length) return null

  const problem = words
    .filter((w) => w.errorType === "Omission" || w.errorType === "Mispronunciation" || w.accuracy < 75)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3)

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-2.5 flex items-center gap-2">
        <Mic size={14} className="text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sound detail · word and phoneme accuracy</h3>
      </div>

      {/* Per-word accuracy */}
      <div className="flex flex-wrap gap-1.5">
        {words.map((w, i) => (
          <span key={i} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-medium ring-1 ${accColor(w.accuracy)}`}>
            {w.word}
            <span className="text-[0.6rem] opacity-80">{Math.round(w.accuracy)}%</span>
            {w.errorType === "Omission" && <span className="text-[0.55rem] uppercase opacity-70">(missed)</span>}
          </span>
        ))}
      </div>

      {/* Weakest sounds */}
      {problem.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="text-[0.7rem] font-medium text-muted-foreground">Focus on these sounds:</p>
          {problem.map((w, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">{w.word}:</span>
              {w.phonemes.length ? w.phonemes.map((p, j) => (
                <span key={j} className={`rounded px-1.5 py-0.5 font-mono text-[0.7rem] ring-1 ${accColor(p.accuracy)}`}>
                  /{p.phoneme}/ {Math.round(p.accuracy)}%
                </span>
              )) : <span className="text-xs text-muted-foreground">say it more clearly</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
