"use client"

import Link from "next/link"
import { ArrowRight, Gauge, RotateCcw, Target } from "lucide-react"
import type { PracticeData, DiagnosticProfile } from "./widget-types"

interface Props {
  data: PracticeData
}

function formatDate(value?: string) {
  if (!value) return "Not completed"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Not completed"
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function pct(value?: number | null) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "Pending"
}

function weakestSkill(profile: DiagnosticProfile) {
  if (profile.weaknesses?.[0]) return profile.weaknesses[0]
  const bands = profile.skillBands
  if (!bands) return "Complete the speaking check to personalize practice."
  const entries = [
    ["Pronunciation", bands.pronunciation],
    ["Fluency", bands.fluency],
    ["Sentence production", bands.sentenceProduction],
    ["Recall readiness", bands.recallReadiness],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string")
  const order = new Map([["A1", 0], ["A2", 1], ["B1", 2], ["B2", 3]])
  entries.sort((a, b) => (order.get(a[1]) ?? 9) - (order.get(b[1]) ?? 9))
  return entries[0] ? `${entries[0][0]} is the current focus.` : "Keep practicing all modes to maintain balance."
}

export function SpeakingProfileWidget({ data }: Props) {
  const profile = data.diagnostic
  const firstStep = profile?.recommendedPracticePath?.[0]

  if (!profile) {
    return (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/15">
            <Gauge size={22} className="text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Speaking check required</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Complete the check to estimate your level and unlock a personalized practice path.
            </p>
          </div>
        </div>
        <Link
          href="/onboarding/diagnostic"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Start check <ArrowRight size={15} />
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/15">
            <Gauge size={22} className="text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Your starting level</p>
            <p className="text-2xl font-bold text-primary">{profile.suggestedCefr ?? data.student?.cefrBand ?? "A1"}</p>
            <p className="text-xs text-muted-foreground">Last check: {formatDate(profile.takenAt ?? data.student?.onboardedAt ?? undefined)}</p>
          </div>
        </div>
        <Link
          href="/onboarding/diagnostic"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
        >
          <RotateCcw size={15} /> Retake check
        </Link>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-muted/25 p-3">
          <p className="text-xs text-muted-foreground">Fluency</p>
          <p className="mt-1 font-semibold text-foreground">{pct(profile.fluencyIndex)}</p>
        </div>
        <div className="rounded-lg bg-muted/25 p-3">
          <p className="text-xs text-muted-foreground">Pronunciation</p>
          <p className="mt-1 font-semibold text-foreground">{pct(profile.pronAvg)}</p>
        </div>
        <div className="rounded-lg bg-muted/25 p-3">
          <p className="text-xs text-muted-foreground">Content</p>
          <p className="mt-1 font-semibold text-foreground">{pct(profile.contentScore)}</p>
        </div>
        <div className="rounded-lg bg-muted/25 p-3">
          <p className="text-xs text-muted-foreground">Speech rate</p>
          <p className="mt-1 font-semibold text-foreground">{profile.speechRateWpm ?? 0} wpm</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <Target size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-foreground">Current focus</p>
            <p className="text-sm text-muted-foreground">{weakestSkill(profile)}</p>
          </div>
        </div>
        {firstStep && (
          <Link
            href={firstStep.href}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            {firstStep.title} <ArrowRight size={15} />
          </Link>
        )}
      </div>
    </div>
  )
}
