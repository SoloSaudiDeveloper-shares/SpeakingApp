"use client"

import Link from "next/link"
import type { PracticeData } from "./widget-types"

interface Props {
  data: PracticeData
}

export function MasteryWidget({ data }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {data.vocabulary.map((v) => {
          const m = data.mastery.find((x) => x.vocabularyItemId === v.id)
          const status = m?.masteryStatus ?? "NotStarted"
          const colorClass =
            status === "Mastered"
              ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
              : status === "Developing"
                ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                : status === "Attempted"
                  ? "bg-orange-500/20 border-orange-500/40 text-orange-300"
                  : "bg-muted/50 border-border text-muted-foreground"

          return (
            <span
              key={v.id}
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium cursor-default transition-all duration-200 hover:scale-105 ${colorClass}`}
              title={`${v.word}${v.arabicMeaning ? ` - ${v.arabicMeaning}` : ""} (${status})`}
            >
              {v.word}
            </span>
          )
        })}
      </div>
      <Link
        href="/practice/history"
        className="inline-flex text-xs text-primary hover:underline"
      >
        View detailed history
      </Link>
    </div>
  )
}
