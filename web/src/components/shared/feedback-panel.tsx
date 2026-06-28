"use client"

import { CheckCircle2, AlertCircle, Sparkles, MicOff, TrendingUp, Lightbulb, RotateCcw, Volume2 } from "lucide-react"
import type { FullFeedback, FeedbackLevel } from "@/lib/scoring"
import { cn } from "@/lib/utils/cn"

interface FeedbackPanelProps {
  feedback: FullFeedback
  onTryAgain?: () => void
  onShadowModelAnswer?: (text: string) => void
}

const LEVEL_STYLES: Record<FeedbackLevel, { icon: React.ElementType; color: string; bg: string; border: string }> = {
  excellent: {
    icon: Sparkles,
    color: "text-green-500",
    bg: "bg-green-500/10",
    border: "border-green-500/30",
  },
  good: {
    icon: CheckCircle2,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  fair: {
    icon: TrendingUp,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
  needs_work: {
    icon: AlertCircle,
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
  },
  no_speech: {
    icon: MicOff,
    color: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
  },
}

export function FeedbackPanel({ feedback, onTryAgain, onShadowModelAnswer }: FeedbackPanelProps) {
  const overall = feedback.overall
  const styles = LEVEL_STYLES[overall.level]
  const Icon = styles.icon
  const canShadow = !!feedback.modelAnswer && !!onShadowModelAnswer

  return (
    <div className="space-y-4">
      {/* Overall headline */}
      <div className={cn("flex items-start gap-3 rounded-lg border p-4", styles.bg, styles.border)}>
        <Icon size={22} className={cn("mt-0.5 shrink-0", styles.color)} />
        <div className="flex-1">
          <h3 className={cn("font-semibold", styles.color)}>{overall.headline}</h3>
          <p className="mt-1 text-sm text-foreground/90">{overall.summary}</p>
        </div>
      </div>

      {feedback.nextFix && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <h4 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Lightbulb size={13} />
            Fix this next
          </h4>
          <p className="text-sm font-semibold text-foreground">{feedback.nextFix.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{feedback.nextFix.message}</p>
          {(onTryAgain || canShadow) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {onTryAgain && (
                <button
                  type="button"
                  onClick={onTryAgain}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <RotateCcw size={13} />
                  Try Again
                </button>
              )}
              {canShadow && (
                <button
                  type="button"
                  onClick={() => feedback.modelAnswer && onShadowModelAnswer(feedback.modelAnswer)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  <Volume2 size={13} />
                  Shadow model answer
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Word-level diff */}
      {feedback.diff && feedback.diff.expectedWords.length > 0 && overall.level !== "no_speech" && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Word-by-word
          </h4>
          <div className="flex flex-wrap gap-1.5 text-sm">
            {feedback.diff.expectedWords.map((word, i) => {
              const wasSaid = feedback.diff!.correctWords.includes(word)
              return (
                <span
                  key={`exp-${i}`}
                  className={cn(
                    "rounded px-2 py-1 font-mono text-xs",
                    wasSaid
                      ? "bg-green-500/20 text-green-500 line-through-no"
                      : "bg-red-500/20 text-red-400 ring-1 ring-red-500/30"
                  )}
                  title={wasSaid ? "Said correctly" : "Missed"}
                >
                  {word}
                </span>
              )
            })}
            {feedback.diff.extraWords.length > 0 && (
              <>
                <span className="self-center text-xs text-muted-foreground">·</span>
                {feedback.diff.extraWords.map((word, i) => (
                  <span
                    key={`extra-${i}`}
                    className="rounded bg-amber-500/15 px-2 py-1 font-mono text-xs text-amber-500 ring-1 ring-amber-500/30"
                    title="Extra word — not in target"
                  >
                    +{word}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* Strengths */}
      {feedback.strengths.length > 0 && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
          <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-green-500">
            <CheckCircle2 size={12} />
            What you did well
          </h4>
          <ul className="space-y-1.5 text-sm text-foreground/90">
            {feedback.strengths.map((s) => (
              <li key={s.dimension} className="flex items-start gap-2">
                <span className="text-green-500">✓</span>
                <span>
                  <strong>{s.dimension}:</strong> {s.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Areas to improve */}
      {feedback.weaknesses.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
          <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-500">
            <Lightbulb size={12} />
            How to improve
          </h4>
          <ul className="space-y-2.5 text-sm text-foreground/90">
            {feedback.weaknesses.map((w) => (
              <li key={w.dimension}>
                <div className="flex items-start gap-2">
                  <span className="text-amber-500">•</span>
                  <div>
                    <strong>{w.dimension}:</strong> {w.message}
                    {w.suggestion && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        💡 {w.suggestion}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
