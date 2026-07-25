"use client"

import Link from "next/link"
import { Check, LockKeyhole, ArrowRight, Circle } from "lucide-react"
import { cn } from "@/lib/utils/cn"
import type { LearnerAssignmentPath } from "@/lib/actions/path-actions"

export function LessonPathway({ path }: { path: LearnerAssignmentPath }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold text-foreground">{path.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Due {path.dueDate} · {path.targetWords.length} lesson target{path.targetWords.length === 1 ? "" : "s"}</p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{path.progressPercent}% complete</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${path.progressPercent}%` }} />
      </div>
      <ol className="grid gap-2 lg:grid-cols-5">
        {path.stages.map((stage) => {
          const available = stage.status !== "locked"
          const content = (
            <div className={cn(
              "h-full rounded-lg border p-3 transition",
              stage.status === "complete" && "border-emerald-500/30 bg-emerald-500/8",
              (stage.status === "available" || stage.status === "in-progress") && "border-primary/45 bg-primary/8 hover:border-primary hover:bg-primary/12",
              stage.status === "locked" && "border-border bg-muted/20 opacity-60",
            )}>
              <div className="flex items-center justify-between">
                <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Step {stage.number}</span>
                {stage.status === "complete" ? <Check size={15} className="text-emerald-400" /> : stage.status === "locked" ? <LockKeyhole size={13} /> : <Circle size={13} className="text-primary" />}
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">{stage.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{stage.description}</p>
              <p className="mt-2 text-[0.68rem] font-medium text-muted-foreground">{stage.completed}/{stage.required} complete</p>
            </div>
          )
          return <li key={stage.key}>{available && stage.href ? <Link href={stage.href}>{content}</Link> : content}</li>
        })}
      </ol>
      {path.targetWords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {path.targetWords.map((target) => <span key={target.id} className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground">{target.word}</span>)}
        </div>
      )}
      {path.complete && <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"><Check size={16} /> Lesson pathway complete.</div>}
    </div>
  )
}

export function ContinueLesson({ path }: { path: LearnerAssignmentPath }) {
  const next = path.stages.find((stage) => stage.status === "available" || stage.status === "in-progress")
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Your next action</p>
        <h2 className="mt-1 text-xl font-bold text-foreground">{next?.title ?? "Review your completed lesson"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{path.title}{next ? ` · ${next.completed}/${next.required} items complete` : ""}</p>
      </div>
      {next?.href && <Link href={next.href} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90">Continue lesson <ArrowRight size={16} /></Link>}
    </div>
  )
}
