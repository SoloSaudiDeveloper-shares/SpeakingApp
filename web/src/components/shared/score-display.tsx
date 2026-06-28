"use client"

import type { ScoreBreakdown } from "@/lib/scoring"
import { InfoTip } from "@/components/shared/info-tip"
import type { CustomScoreRow, ScoreHelp, ScoreRowKey } from "@/lib/scoring/score-card-help"

export type { CustomScoreRow, ScoreHelp, ScoreRowKey } from "@/lib/scoring/score-card-help"

const LABELS: { key: ScoreRowKey; label: string; color: string }[] = [
  { key: "targetMatch", label: "Target Match", color: "bg-blue-500" },
  { key: "pronunciation", label: "Pronunciation", color: "bg-emerald-500" },
  { key: "fluency", label: "Fluency", color: "bg-amber-500" },
  { key: "completeness", label: "Completeness", color: "bg-purple-500" },
  { key: "consistency", label: "Consistency", color: "bg-rose-500" },
]

function getScoreColor(value: number): string {
  if (value >= 0.85) return "text-emerald-400"
  if (value >= 0.6) return "text-amber-400"
  return "text-red-400"
}

function getBadgeBg(value: number): string {
  if (value >= 0.85) return "bg-emerald-500/20 border-emerald-500/40"
  if (value >= 0.6) return "bg-amber-500/20 border-amber-500/40"
  return "bg-red-500/20 border-red-500/40"
}

export function ScoreDisplay({
  scores,
  omit,
  labelOverrides,
  scoreHelp,
  customRows,
}: {
  scores: ScoreBreakdown
  omit?: ScoreRowKey[]
  labelOverrides?: Partial<Record<ScoreRowKey, string>>
  scoreHelp?: ScoreHelp
  customRows?: CustomScoreRow[]
}) {
  const rows = customRows ?? (omit?.length ? LABELS.filter((l) => !omit.includes(l.key)) : LABELS).map((row) => ({
    key: row.key,
    label: labelOverrides?.[row.key] ?? row.label,
    score: scores[row.key],
    color: row.color,
    help: scoreHelp?.rows?.[row.key],
  }))
  return (
    <div className="space-y-4">
      {rows.map(({ key, label, score, color, help }) => (
        <div key={key} className="space-y-1.5">
          <div className="flex items-start gap-3">
            <div className="w-32 shrink-0 sm:w-40">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{label}</span>
                {help && <InfoTip title={label} text={help.detail} size={12} />}
              </div>
              {help?.short && (
                <p className="mt-0.5 text-[0.65rem] leading-snug text-muted-foreground/75">
                  {help.short}
                </p>
              )}
            </div>
            <div className="min-w-0 flex-1 pt-1.5">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${color}`}
                  style={{ width: `${(score * 100).toFixed(0)}%` }}
                />
              </div>
            </div>
            <div className="w-16 shrink-0 text-right">
              <span className={`block text-xs font-semibold ${getScoreColor(score)}`}>
                {(score * 100).toFixed(0)}%
              </span>
              {typeof help?.weightPercent === "number" && (
                <span className="mt-0.5 block text-[0.6rem] leading-none text-muted-foreground/75">
                  {help.weightPercent}% of total
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
      <div className="flex flex-col items-center justify-center gap-1 pt-2">
        <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 ${getBadgeBg(scores.composite)}`}>
          <span className="text-sm text-muted-foreground">Composite</span>
          {scoreHelp?.composite && <InfoTip title="Composite score" text={scoreHelp.composite.detail} size={12} />}
          <span className={`text-lg font-bold ${getScoreColor(scores.composite)}`}>
            {(scores.composite * 100).toFixed(0)}%
          </span>
        </div>
        {scoreHelp?.composite?.short && (
          <p className="max-w-md text-center text-[0.7rem] leading-snug text-muted-foreground/80">
            {scoreHelp.composite.short}
          </p>
        )}
      </div>
    </div>
  )
}
