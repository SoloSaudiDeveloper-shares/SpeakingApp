"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Check, Lock } from "lucide-react"
import type { PracticeData } from "./widget-types"

interface Props {
  data: PracticeData
}

const STAGE_META: Record<string, { label: string; description: string }> = {
  "listen":     { label: "Listen",     description: "Hear the word" },
  "repeat":     { label: "Repeat",     description: "Say it back" },
  "read-aloud": { label: "Read Aloud", description: "Read and speak" },
  "sentence":   { label: "Sentence",   description: "Use in context" },
  "free-speak": { label: "Free Speak", description: "Express yourself" },
  "review":     { label: "Review",     description: "Test mastery" },
}

const DEFAULT_SEQUENCE = ["listen", "repeat", "read-aloud", "sentence", "free-speak", "review"]
const STAGE_KEYS = new Set(DEFAULT_SEQUENCE)

function normalizeTaskType(taskType: string | undefined): string | null {
  if (!taskType) return null
  const t = taskType.toLowerCase()
  if (t === "listenrepeat" || t === "repeat") return "repeat"
  if (t === "readaloud" || t === "read-aloud") return "read-aloud"
  if (t === "sentenceframe" || t === "sentence") return "sentence"
  if (t === "freerecall" || t === "free-speak") return "free-speak"
  if (t === "review") return "review"
  if (t === "listen") return "listen"
  return null
}

function stageFromAttemptMetrics(metricsJson: string | null | undefined): string | null {
  if (!metricsJson) return null
  try {
    const parsed = JSON.parse(metricsJson) as { practiceStage?: unknown }
    return typeof parsed.practiceStage === "string" && STAGE_KEYS.has(parsed.practiceStage)
      ? parsed.practiceStage
      : null
  } catch {
    return null
  }
}

export function StagesWidget({ data }: Props) {
  // Use admin-controlled config if available; otherwise fall back to default.
  const sequence = data.stageConfig?.sequence?.length ? data.stageConfig.sequence : DEFAULT_SEQUENCE
  const unlockMode = data.stageConfig?.unlockMode ?? "sequential"
  const [listenCompleted, setListenCompleted] = useState(false)

  useEffect(() => {
    if (!data.cycle?.id) return
    try {
      setListenCompleted(localStorage.getItem(`stage-complete-${data.cycle.id}-listen`) === "true")
    } catch {
      setListenCompleted(false)
    }
  }, [data.cycle?.id])

  // Track which stages the student has worked on
  const attemptStages = data.attempts.map((a) => {
    const task = data.tasks.find((t) => t.id === a.practiceTaskId)
    return {
      stage: stageFromAttemptMetrics(a.metricsJson) ?? normalizeTaskType(task?.taskType),
      score: a.compositeScore,
      passScore: task?.passScore ?? 0.6,
    }
  })

  /** Has the student successfully completed this stage at least once? */
  function isStageCompleted(stageKey: string): boolean {
    if (stageKey === "listen") {
      return listenCompleted || attemptStages.some((a) => a.stage !== null && a.score >= a.passScore)
    }
    return attemptStages.some((a) => a.stage === stageKey && a.score >= a.passScore)
  }

  /** Determine status: "completed" | "current" | "locked" */
  function getStatus(stageKey: string, indexInSequence: number): "completed" | "current" | "locked" {
    const completed = isStageCompleted(stageKey)

    // unlockMode: "all" — every stage is always available
    if (unlockMode === "all") {
      return completed ? "completed" : "current"
    }

    // unlockMode: "free" — every stage is available, but completed stays completed
    if (unlockMode === "free") {
      if (completed) return "completed"
      return "current"
    }

    // unlockMode: "sequential" — must complete previous to unlock next
    if (completed) return "completed"
    // Find the first not-completed stage in the sequence
    const firstIncompleteIdx = sequence.findIndex((k) => !isStageCompleted(k))
    if (indexInSequence === firstIncompleteIdx) return "current"
    if (indexInSequence < firstIncompleteIdx) return "completed"
    return "locked"
  }

  return (
    <div className="space-y-2">
      {/* Mode hint */}
      {unlockMode !== "sequential" && (
        <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
          {unlockMode === "all" ? "All stages unlocked" : "Free-order mode — practice any stage"}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {sequence.map((stageKey, i) => {
          const meta = STAGE_META[stageKey]
          if (!meta) return null
          const status = getStatus(stageKey, i)
          const isCompleted = status === "completed"
          const isCurrent = status === "current"
          const isLocked = status === "locked"

          return (
            <Link
              key={stageKey}
              href={isLocked ? "#" : `/practice?stage=${stageKey}`}
              title={isLocked ? `Locked — finish "${STAGE_META[sequence[i - 1]]?.label ?? "previous stage"}" first` : undefined}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all duration-200 ${
                isCompleted
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : isCurrent
                    ? "border-primary/40 bg-primary/10 text-primary ring-1 ring-primary/30"
                    : "border-border bg-muted/30 text-muted-foreground cursor-not-allowed opacity-60"
              }`}
              onClick={(e) => isLocked && e.preventDefault()}
            >
              <span className="rounded-full bg-background/40 px-1.5 text-[0.65rem] font-bold">
                {i + 1}
              </span>
              {isCompleted ? (
                <Check size={14} className="text-emerald-400" />
              ) : isLocked ? (
                <Lock size={14} />
              ) : (
                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              )}
              <div>
                <span className="font-medium">{meta.label}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground ml-1.5">
                  {meta.description}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
