"use client"

import { useEffect, useState } from "react"
import { Activity, Users, Clock, Loader2, Wifi, WifiOff } from "lucide-react"
import { useI18n } from "@/components/layout/i18n-provider"

interface ActiveStudent {
  studentId: number
  name: string
  class: string | null
  cefr: string
  lastWord: string | null
  lastTaskType: string | null
  lastScore: number | null
  lastTranscript: string | null
  lastActiveAt: string
}

const POLL_INTERVAL_MS = 4000
const ACTIVE_WINDOW_MS = 60_000 // a student is "active" if they made an attempt in last 60s

export default function ClassMonitorPage() {
  const { t } = useI18n()
  const [students, setStudents] = useState<ActiveStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(true)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/teacher/class-monitor?windowMs=${ACTIVE_WINDOW_MS}`)
        if (!res.ok) {
          setConnected(false)
          return
        }
        const data = await res.json()
        setStudents(data.activeStudents || [])
        setConnected(true)
        setLastFetch(new Date())
      } catch {
        setConnected(false)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  const timeAgo = (iso: string) => {
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (sec < 5) return "Just now"
    if (sec < 60) return `${sec}s ago`
    const min = Math.floor(sec / 60)
    return `${min}m ago`
  }

  const scoreColor = (score: number | null) => {
    if (score === null) return "text-muted-foreground"
    if (score >= 80) return "text-green-500"
    if (score >= 60) return "text-amber-500"
    return "text-red-500"
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="text-primary" size={28} />
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t("monitor.class_monitor")}</h1>
            <p className="text-sm text-muted-foreground">
              Live view of students currently practicing
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {connected ? (
            <>
              <Wifi size={14} className="text-green-500" />
              <span className="text-green-500">Connected</span>
            </>
          ) : (
            <>
              <WifiOff size={14} className="text-red-500" />
              <span className="text-red-500">Disconnected</span>
            </>
          )}
          {lastFetch && (
            <span className="text-muted-foreground ml-2">
              · Updated {timeAgo(lastFetch.toISOString())}
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Users size={14} />
            {t("monitor.live_now")}
          </div>
          <div className="mt-2 text-3xl font-bold text-foreground">
            {students.length}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Clock size={14} />
            Window
          </div>
          <div className="mt-2 text-3xl font-bold text-foreground">
            {ACTIVE_WINDOW_MS / 1000}s
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Activity size={14} />
            Refresh
          </div>
          <div className="mt-2 text-3xl font-bold text-foreground">
            {POLL_INTERVAL_MS / 1000}s
          </div>
        </div>
      </div>

      {/* Active students */}
      {students.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <Users size={36} className="mx-auto mb-3 text-muted-foreground" />
          <h2 className="mb-1 text-lg font-semibold text-foreground">
            {t("monitor.no_active_students")}
          </h2>
          <p className="text-sm text-muted-foreground">
            Students will appear here as soon as they start practicing.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 text-left">Student</th>
                <th className="px-4 py-3 text-left">Class</th>
                <th className="px-4 py-3 text-left">CEFR</th>
                <th className="px-4 py-3 text-left">Last Word</th>
                <th className="px-4 py-3 text-left">Said</th>
                <th className="px-4 py-3 text-right">Score</th>
                <th className="px-4 py-3 text-right">{t("monitor.last_active")}</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr
                  key={s.studentId}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                      {s.name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.class || "—"}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-xs font-semibold text-blue-300">
                      {s.cefr}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-foreground">
                    {s.lastWord || "—"}
                    {s.lastTaskType && (
                      <span className="ml-2 text-[0.6rem] uppercase text-muted-foreground">
                        {s.lastTaskType}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate font-mono text-xs text-muted-foreground">
                    {s.lastTranscript || "(no transcript)"}
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${scoreColor(s.lastScore)}`}>
                    {s.lastScore !== null ? `${Math.round(s.lastScore)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {timeAgo(s.lastActiveAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
