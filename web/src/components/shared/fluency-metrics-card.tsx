"use client"

import { Gauge, Zap, Pause, Ruler } from "lucide-react"
import type { FluencyMetrics } from "@/lib/scoring"
import { InfoTip } from "@/components/shared/info-tip"

interface Props {
  metrics: FluencyMetrics
}

/**
 * Shows research-backed fluency measures for a single attempt:
 * speech rate, articulation rate, pauses/min, and mean length of run.
 */
export function FluencyMetricsCard({ metrics }: Props) {
  if (metrics.wordCount === 0) return null

  const items = [
    {
      icon: Gauge,
      label: "Speech rate",
      value: `${metrics.speechRateWpm}`,
      unit: "wpm",
      hint: "Words per minute (including pauses)",
    },
    {
      icon: Zap,
      label: "Articulation",
      value: `${metrics.articulationRateWpm}`,
      unit: "wpm",
      hint: "Pace while actually speaking (excludes pauses)",
    },
    {
      icon: Pause,
      label: "Pauses",
      value: `${metrics.pausePerMin}`,
      unit: "/min",
      hint: "Hesitation frequency — fewer is smoother",
    },
    {
      icon: Ruler,
      label: "Run length",
      value: `${metrics.meanLengthOfRun}`,
      unit: "words",
      hint: "Mean words between pauses (higher = more fluent)",
    },
  ]

  const idxPct = Math.round(metrics.fluencyIndex * 100)
  const idxColor =
    metrics.fluencyIndex >= 0.75 ? "text-emerald-400"
    : metrics.fluencyIndex >= 0.5 ? "text-amber-400"
    : "text-red-400"

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Fluency metrics
        </h3>
        <div className="flex items-baseline gap-1.5">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Fluency index
            <InfoTip
              title="Fluency index"
              text="A single 0–100% score combining your speech rate, pause frequency, and run length, weighted for your CEFR level. Higher means smoother, more automatic speech."
            />
          </span>
          <span className={`text-lg font-bold ${idxColor}`}>{idxPct}%</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((it) => (
          <div
            key={it.label}
            title={it.hint}
            className="rounded-md border border-border bg-muted/30 p-3 text-center"
          >
            <it.icon size={15} className="mx-auto mb-1 text-primary" />
            <div className="text-lg font-bold text-foreground leading-none">
              {it.value}
              <span className="ml-0.5 text-[0.6rem] font-normal text-muted-foreground">{it.unit}</span>
            </div>
            <div className="mt-1 text-[0.65rem] text-muted-foreground">{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
