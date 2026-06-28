"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/hooks/use-auth"
import { BookOpen, Loader2, Settings, Gauge, ArrowRight } from "lucide-react"
import { WidgetGrid } from "@/components/practice/widgets/widget-grid"
import { CustomizePanel } from "@/components/practice/widgets/customize-panel"
import { DEFAULT_LAYOUT, AVAILABLE_WIDGETS, type WidgetId, type PracticeData } from "@/components/practice/widgets/widget-types"

function getStorageKey(userId: number) {
  return `dashboard-layout-${userId}`
}

function loadLayout(userId: number): WidgetId[] {
  try {
    const saved = localStorage.getItem(getStorageKey(userId))
    if (saved) {
      const parsed = JSON.parse(saved) as string[]
      // Validate that all IDs are valid
      const validIds = new Set(AVAILABLE_WIDGETS.map((w) => w.id))
      const filtered = parsed.filter((id) => validIds.has(id as WidgetId)) as WidgetId[]
      if (filtered.length > 0) {
        if (!filtered.includes("speaking-profile")) {
          const quickIndex = filtered.indexOf("quick-practice")
          filtered.splice(quickIndex >= 0 ? quickIndex + 1 : 0, 0, "speaking-profile")
        }
        if (!filtered.includes("ai-coach")) {
          const profileIndex = filtered.indexOf("speaking-profile")
          filtered.splice(profileIndex >= 0 ? profileIndex + 1 : 0, 0, "ai-coach")
        }
        if (!filtered.includes("klp-focus")) {
          const coachIndex = filtered.indexOf("ai-coach")
          filtered.splice(coachIndex >= 0 ? coachIndex + 1 : 0, 0, "klp-focus")
        }
        return filtered
      }
    }
  } catch {}
  return [...DEFAULT_LAYOUT]
}

function saveLayout(userId: number, layout: WidgetId[]) {
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(layout))
  } catch {}
}

const DIAGNOSTIC_SKIP_KEY = "speaking-lab-diagnostic-skip-session"

export default function PracticeHubPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [data, setData] = useState<PracticeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeWidgets, setActiveWidgets] = useState<WidgetId[]>([])
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [showDiagnosticPrompt, setShowDiagnosticPrompt] = useState(false)

  // Redirect real student accounts until the required speaking check is complete.
  useEffect(() => {
    if (!user) return
    const isRealStudent = user.role?.toLowerCase() === "student"
    if (!isRealStudent) return
    fetch("/api/onboarding")
      .then((r) => r.json())
      .then((s) => {
        if (s.notAStudent || s.hasDiagnostic) return
        const skippedThisSession = sessionStorage.getItem(DIAGNOSTIC_SKIP_KEY) === "1"
        if (!skippedThisSession) {
          router.replace("/onboarding/diagnostic")
        } else {
          setShowDiagnosticPrompt(true)
        }
      })
      .catch(() => {})
  }, [user, router])

  // Load layout from localStorage once we have a user
  useEffect(() => {
    if (user?.id) {
      setActiveWidgets(loadLayout(user.id))
      setLayoutLoaded(true)
    }
  }, [user?.id])

  // Save layout whenever it changes
  useEffect(() => {
    if (user?.id && layoutLoaded && activeWidgets.length > 0) {
      saveLayout(user.id, activeWidgets)
    }
  }, [user?.id, activeWidgets, layoutLoaded])

  // Fetch practice data
  useEffect(() => {
    fetch("/api/practice")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleReorder = useCallback((widgets: WidgetId[]) => {
    setActiveWidgets(widgets)
  }, [])

  const handleRemove = useCallback((id: WidgetId) => {
    setActiveWidgets((prev) => prev.filter((w) => w !== id))
  }, [])

  const handleToggle = useCallback((id: WidgetId) => {
    setActiveWidgets((prev) => {
      if (prev.includes(id)) {
        // Don't allow removing non-removable widgets
        const config = AVAILABLE_WIDGETS.find((w) => w.id === id)
        if (config && !config.removable) return prev
        return prev.filter((w) => w !== id)
      }
      return [...prev, id]
    })
  }, [])

  const handleReset = useCallback(() => {
    setActiveWidgets([...DEFAULT_LAYOUT])
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  if (!data?.cycle) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-foreground">Practice Hub</h1>
        <div className="mt-8 rounded-lg border border-border bg-card p-8 text-center">
          <BookOpen size={48} className="mx-auto text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">No active cycle. Ask your teacher to enroll you.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 animate-page-enter">
      {/* Onboarding: speaking-check prompt for new students */}
      {showDiagnosticPrompt && (
        <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/15 to-primary/5 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/20">
              <Gauge size={24} className="text-primary" />
            </div>
            <div className="flex-1">
              <h2 className="font-semibold text-foreground">Complete your speaking check</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                You skipped it for this session. The check will appear again next time so practice can be personalized accurately.
              </p>
              <Link
                href="/onboarding/diagnostic"
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Start speaking check <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {data.student?.displayName
              ? `Welcome back, ${data.student.displayName}`
              : "Practice Hub"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data.book?.title} &middot; {data.book?.cefrLevel} &middot; {data.cycle.startDate} to {data.cycle.endDate}
          </p>
        </div>
        <button
          onClick={() => setCustomizeOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Settings size={16} />
          Customize
        </button>
      </div>

      {/* Widget Grid */}
      {layoutLoaded && (
        <WidgetGrid
          activeWidgets={activeWidgets}
          onReorder={handleReorder}
          onRemove={handleRemove}
          practiceData={data}
        />
      )}

      {/* Customize Panel */}
      <CustomizePanel
        isOpen={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        activeWidgets={activeWidgets}
        onToggle={handleToggle}
        onReset={handleReset}
      />
    </div>
  )
}
