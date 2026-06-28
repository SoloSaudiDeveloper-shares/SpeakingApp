"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Loader2, Radio, Play, Square, Trash2, Eye, AlertCircle } from "lucide-react"

interface LiveSession {
  id: number
  cycleId: number
  startedAt: string
  endedAt: string | null
  taskType: string
  className: string | null
}

interface Cycle {
  id: number
  startDate: string
  endDate: string
  bookId: number
  book?: { title: string } | null
}

const TASK_TYPES = [
  "ListenRepeat", "ReadAloud", "SentenceFrame", "FreeRecall", "Dictation",
]

export default function LiveSessionsPage() {
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [classes, setClasses] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [taskType, setTaskType] = useState("ListenRepeat")
  const [cycleId, setCycleId] = useState<number | null>(null)
  const [className, setClassName] = useState("")

  const load = async () => {
    try {
      const [s, c, cls] = await Promise.all([
        fetch("/api/live-sessions").then((r) => r.json()).catch(() => ({ sessions: [] })),
        fetch("/api/cycles").then((r) => r.json()).catch(() => ({ cycles: [] })),
        fetch("/api/admin/classes").then((r) => r.json()).catch(() => ({ classes: [] })),
      ])
      setSessions(s.sessions ?? [])
      setCycles(c.cycles ?? [])
      setClasses(cls.classes ?? [])
      if (c.cycles?.[0]) setCycleId((prev) => prev ?? c.cycles[0].id)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const startSession = async () => {
    if (!cycleId) return
    setSaving(true)
    await fetch("/api/live-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cycleId, taskType, className: className.trim() || null }),
    })
    setClassName("")
    setSaving(false)
    load()
  }

  const endSession = async (id: number) => {
    if (!confirm("End this live session?")) return
    await fetch(`/api/live-sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end" }),
    })
    load()
  }

  const deleteSession = async (id: number) => {
    if (!confirm("Delete this session record permanently?")) return
    await fetch(`/api/live-sessions/${id}`, { method: "DELETE" })
    load()
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  const activeSessions = sessions.filter((s) => !s.endedAt)
  const pastSessions = sessions.filter((s) => s.endedAt)

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Live Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Mark a class as currently practicing in real time, then watch their progress in the Class Monitor.
        </p>
      </div>

      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-blue-500 mt-0.5 shrink-0" />
          <div>
            <strong className="text-blue-500">How Live Sessions work:</strong>
            <ol className="mt-1 ml-4 list-decimal text-muted-foreground space-y-0.5">
              <li>Start a session for a specific cycle and task type.</li>
              <li>Tell your class to begin practicing.</li>
              <li>Open the <Link href="/teacher/monitor" className="text-blue-500 underline">Class Monitor</Link> to see live attempts as students record.</li>
              <li>End the session when class finishes.</li>
            </ol>
          </div>
        </div>
      </div>

      {cycles.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-600 dark:text-amber-400">
          No cycles exist. <Link href="/admin/cycles" className="underline">Create a cycle first</Link> before starting a live session.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="font-semibold text-foreground mb-3">Start New Session</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs text-muted-foreground">Cycle</label>
              <select value={cycleId ?? ""} onChange={(e) => setCycleId(Number(e.target.value))} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.book?.title ?? `Cycle #${c.id}`} ({c.startDate.slice(0, 10)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Task Type</label>
              <select value={taskType} onChange={(e) => setTaskType(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Class (optional)</label>
              <input
                list="class-list"
                placeholder="e.g. Class A"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <datalist id="class-list">
                {classes.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>
          <button
            onClick={startSession}
            disabled={saving || !cycleId}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Play size={14} /> {saving ? "Starting..." : "Start Session"}
          </button>
        </div>
      )}

      {activeSessions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Active ({activeSessions.length})
          </h2>
          <div className="space-y-2">
            {activeSessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-green-500/30 bg-green-500/5 p-4">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Radio size={20} className="text-green-500" />
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 animate-pulse rounded-full bg-green-500" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">Session #{s.id}</span>
                      <span className="rounded bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-500">LIVE</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {s.taskType} · {s.className ?? "All classes"} · started {new Date(s.startedAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href="/teacher/monitor"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    <Eye size={14} /> Monitor
                  </Link>
                  <button
                    onClick={() => endSession(s.id)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-red-500/15 px-3 py-1.5 text-sm font-medium text-red-500 hover:bg-red-500/25"
                  >
                    <Square size={14} /> End
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          History {pastSessions.length > 0 && `(${pastSessions.length})`}
        </h2>
        {pastSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No past sessions.</p>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground bg-muted/30">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Task</th>
                  <th className="px-4 py-3">Class</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Ended</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pastSessions.map((s) => (
                  <tr key={s.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-2 text-muted-foreground">{s.id}</td>
                    <td className="px-4 py-2 text-foreground">{s.taskType}</td>
                    <td className="px-4 py-2 text-muted-foreground">{s.className ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{new Date(s.startedAt).toLocaleString()}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{s.endedAt ? new Date(s.endedAt).toLocaleString() : "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => deleteSession(s.id)}
                        className="p-1.5 rounded text-red-500 hover:bg-red-500/10"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
