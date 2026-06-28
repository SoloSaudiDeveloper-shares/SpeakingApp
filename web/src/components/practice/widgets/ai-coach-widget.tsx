"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Brain, Loader2, RefreshCw, Sparkles, Target } from "lucide-react"
import type { PracticeData } from "./widget-types"

interface Props {
  data: PracticeData
}

interface TutorAction {
  title: string
  href: string
  reason: string
}

interface TutorInsight {
  headline: string
  strengths: string[]
  focus: string[]
  actions: TutorAction[]
}

interface TutorResponse {
  aiAvailable: boolean
  provider?: string
  model?: string
  warning?: string
  insight: TutorInsight
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`
}

function localInsight(data: PracticeData): TutorInsight {
  const attempts = data.attempts ?? []
  const avg = attempts.length
    ? attempts.reduce((sum, attempt) => sum + attempt.compositeScore, 0) / attempts.length
    : 0
  const mastered = data.mastery.filter((item) => item.masteryStatus === "Mastered").length
  const weak = data.mastery.filter((item) => item.masteryStatus !== "Mastered").length
  const profile = data.diagnostic
  const actions: TutorAction[] = []

  if (!profile) {
    actions.push({ title: "Start speaking check", href: "/onboarding/diagnostic", reason: "Set your level and practice path." })
  }
  if (weak > 0) {
    actions.push({ title: "Weak Words", href: "/practice/weak-words", reason: "Focus on the words that need more practice." })
  }
  if ((profile?.fluencyIndex ?? avg) < 0.7) {
    actions.push({ title: "Fluency Drills", href: "/practice/fluency", reason: "Build smoother, longer speaking runs." })
  }
  if (actions.length < 3) {
    actions.push({ title: "AI Conversation", href: "/practice/conversation", reason: "Practice natural speaking with follow-up questions." })
  }

  return {
    headline: profile?.weaknesses?.[0] ?? (weak > 0 ? "Focus on your weak words today." : "Keep building balanced speaking skills."),
    strengths: [
      mastered > 0 ? `You have mastered ${mastered} word${mastered === 1 ? "" : "s"}.` : "You are building your speaking habit.",
      attempts.length > 0 ? `Your average practice score is ${pct(avg)}.` : "Start a practice attempt to build your report.",
    ],
    focus: [
      profile?.weaknesses?.[0] ?? (weak > 0 ? `${weak} word${weak === 1 ? "" : "s"} still need practice.` : "Keep rotating through all practice modes."),
      profile?.recommendedStartingStage ? `Recommended stage: ${profile.recommendedStartingStage}.` : "Use your recommended path after the speaking check.",
    ],
    actions: actions.slice(0, 3),
  }
}

export function AiCoachWidget({ data }: Props) {
  const [response, setResponse] = useState<TutorResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const fallback = useMemo(() => localInsight(data), [data])

  const fetchInsight = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/practice/tutor-insight")
      const json = await res.json().catch(() => null)
      if (res.ok && json?.insight) {
        setResponse(json)
      } else {
        setResponse({ aiAvailable: false, insight: fallback, warning: json?.error ?? "Tutor insight unavailable." })
      }
    } catch {
      setResponse({ aiAvailable: false, insight: fallback, warning: "Tutor insight unavailable." })
    } finally {
      setLoading(false)
    }
  }, [fallback])

  useEffect(() => {
    fetchInsight()
  }, [fetchInsight])

  const insight = response?.insight ?? fallback

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15">
            <Sparkles size={20} className="text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground">{loading ? "Reading your progress..." : insight.headline}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {response?.aiAvailable ? `${response.provider} - ${response.model}` : response?.warning ? "Measured-data fallback" : "Personalized from your practice history"}
            </p>
          </div>
        </div>
        <button
          onClick={fetchInsight}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-300">
            <Brain size={15} />
            What is improving
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {insight.strengths.slice(0, 3).map((item, index) => (
              <li key={index}>- {item}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
            <Target size={15} />
            Focus next
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {insight.focus.slice(0, 4).map((item, index) => (
              <li key={index}>- {item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        {insight.actions.slice(0, 3).map((action) => (
          <Link
            key={`${action.title}-${action.href}`}
            href={action.href}
            className="group rounded-lg border border-border bg-background/50 p-3 hover:border-primary/60 hover:bg-primary/5"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-foreground">{action.title}</p>
              <ArrowRight size={15} className="text-muted-foreground group-hover:text-primary" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{action.reason}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
