"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/hooks/use-auth"
import { BookOpen, Loader2, Gauge, ArrowRight, RotateCcw, Mic, Target, MessageCircle, FileText, History, Sparkles } from "lucide-react"
import { WidgetGrid } from "@/components/practice/widgets/widget-grid"
import { CollapsibleWidget } from "@/components/practice/widgets/draggable-widget"
import { LessonPathway, ContinueLesson } from "@/components/practice/lesson-pathway"
import type { PracticeData } from "@/components/practice/widgets/widget-types"
import type { LearnerAssignmentPath } from "@/lib/actions/path-actions"

type HubTab = "practice" | "progress"
interface Preferences { version: number; activeTab: HubTab; collapsedSections: string[] }
interface PathResponse { activePath: LearnerAssignmentPath | null; paths: LearnerAssignmentPath[]; legacyAssignments: LearnerAssignmentPath[] }

const DEFAULT_PREFERENCES: Preferences = { version: 1, activeTab: "practice", collapsedSections: [] }
const DIAGNOSTIC_SKIP_KEY = "speaking-lab-diagnostic-skip-session"

const SECONDARY = [
  { title: "Weak Words", detail: "Focus on sounds and words that need another try.", href: "/practice/weak-words", icon: Target },
  { title: "Fluency Drills", detail: "Build pace and smoothness with timed practice.", href: "/practice/fluency", icon: Gauge },
  { title: "Text Practice", detail: "Read and rehearse a paragraph at your own pace.", href: "/practice/texts", icon: FileText },
  { title: "Free AI Conversation", detail: "Choose a topic and speak freely with the tutor.", href: "/practice/conversation", icon: MessageCircle },
]

export default function PracticeHubPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [data, setData] = useState<PracticeData | null>(null)
  const [paths, setPaths] = useState<PathResponse>({ activePath: null, paths: [], legacyAssignments: [] })
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES)
  const [loading, setLoading] = useState(true)
  const [showDiagnosticPrompt, setShowDiagnosticPrompt] = useState(false)

  useEffect(() => {
    if (!user || user.role?.toLowerCase() !== "student") return
    fetch("/api/onboarding").then((r) => r.json()).then((state) => {
      if (state.notAStudent || state.hasDiagnostic) return
      if (sessionStorage.getItem(DIAGNOSTIC_SKIP_KEY) !== "1") router.replace("/onboarding/diagnostic")
      else setShowDiagnosticPrompt(true)
    }).catch(() => {})
  }, [user, router])

  useEffect(() => {
    Promise.all([
      fetch("/api/practice").then((r) => r.json()),
      fetch("/api/practice/path").then((r) => r.json()),
      fetch("/api/practice/dashboard-preferences").then((r) => r.json()),
    ]).then(([practice, pathData, prefs]) => {
      setData(practice)
      if (Array.isArray(pathData?.paths)) setPaths(pathData)
      if (prefs?.activeTab) setPreferences({
        version: Number(prefs.version) || 1,
        activeTab: prefs.activeTab === "progress" ? "progress" : "practice",
        collapsedSections: Array.isArray(prefs.collapsedSections) ? prefs.collapsedSections : [],
      })
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  function savePreferences(next: Preferences) {
    setPreferences(next)
    void fetch("/api/practice/dashboard-preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    })
  }

  function setTab(activeTab: HubTab) { savePreferences({ ...preferences, activeTab }) }
  function toggleSection(id: string) {
    const collapsedSections = preferences.collapsedSections.includes(id)
      ? preferences.collapsedSections.filter((section) => section !== id)
      : [...preferences.collapsedSections, id]
    savePreferences({ ...preferences, collapsedSections })
  }
  function resetView() { savePreferences({ ...DEFAULT_PREFERENCES, version: preferences.version }) }

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  if (!data?.cycle) return (
    <div className="p-6"><h1 className="text-2xl font-bold text-foreground">Learner home</h1><div className="mt-8 rounded-lg border border-border bg-card p-8 text-center"><BookOpen size={48} className="mx-auto text-muted-foreground" /><p className="mt-4 text-muted-foreground">No active cycle. Ask your teacher to enroll you.</p></div></div>
  )

  const activePath = paths.activePath
  return (
    <div className="space-y-6 p-6 animate-page-enter">
      {showDiagnosticPrompt && (
        <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/15 to-primary/5 p-5">
          <div className="flex items-start gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/20"><Gauge size={24} className="text-primary" /></div><div className="flex-1"><h2 className="font-semibold text-foreground">Complete your speaking check</h2><p className="mt-1 text-sm text-muted-foreground">Finish the short check so your practice can be personalized accurately.</p><Link href="/onboarding/diagnostic" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Start speaking check <ArrowRight size={15} /></Link></div></div>
        </div>
      )}

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-bold text-foreground">{data.student?.displayName ? `Welcome back, ${data.student.displayName}` : "Learner home"}</h1><p className="mt-1 text-sm text-muted-foreground">{data.book?.title} · {data.book?.cefrLevel} · {data.cycle.startDate} to {data.cycle.endDate}</p></div>
        <button onClick={resetView} className="inline-flex items-center gap-2 self-start rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"><RotateCcw size={14} /> Reset view</button>
      </header>

      <div className="inline-flex rounded-xl border border-border bg-muted/30 p-1" role="tablist" aria-label="Learner home sections">
        <button role="tab" aria-selected={preferences.activeTab === "practice"} onClick={() => setTab("practice")} className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${preferences.activeTab === "practice" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Practice</button>
        <button role="tab" aria-selected={preferences.activeTab === "progress"} onClick={() => setTab("progress")} className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${preferences.activeTab === "progress" ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"}`}>Progress</button>
      </div>

      {preferences.activeTab === "practice" ? (
        <div className="space-y-4">
          {activePath ? (
            <>
              <CollapsibleWidget id="continue-lesson" title="Continue lesson" collapsed={preferences.collapsedSections.includes("continue-lesson")} onToggle={() => toggleSection("continue-lesson")} tone="action"><ContinueLesson path={activePath} /></CollapsibleWidget>
              <CollapsibleWidget id="lesson-path" title="Active lesson pathway" collapsed={preferences.collapsedSections.includes("lesson-path")} onToggle={() => toggleSection("lesson-path")} tone="action"><LessonPathway path={activePath} /></CollapsibleWidget>
            </>
          ) : (
            <div className="rounded-xl border border-primary/30 bg-card p-6"><Sparkles size={22} className="text-primary" /><h2 className="mt-2 text-lg font-semibold">Independent practice is ready</h2><p className="mt-1 text-sm text-muted-foreground">Your teacher has not configured a lesson pathway yet. Choose any practice below.</p></div>
          )}

          <CollapsibleWidget id="secondary-practice" title="More speaking practice" collapsed={preferences.collapsedSections.includes("secondary-practice")} onToggle={() => toggleSection("secondary-practice")} tone="action">
            <div className="grid gap-3 sm:grid-cols-2">
              {SECONDARY.map(({ title, detail, href, icon: Icon }) => <Link key={href} href={href} className="group rounded-lg border border-primary/20 bg-background p-4 transition hover:border-primary hover:shadow-md"><div className="flex items-start gap-3"><span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon size={18} /></span><div><h3 className="font-semibold text-foreground group-hover:text-primary">{title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p><span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">Open <ArrowRight size={12} /></span></div></div></Link>)}
            </div>
          </CollapsibleWidget>

          {paths.legacyAssignments.length > 0 && <div className="rounded-xl border border-border bg-card/60 p-4"><h2 className="text-sm font-semibold text-foreground">Other assignments</h2><p className="mt-1 text-xs text-muted-foreground">These assignments use the earlier card format until a teacher configures their pathway.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{paths.legacyAssignments.map((assignment) => <div key={assignment.assignmentId} className="rounded-lg border border-border bg-background p-3"><p className="text-sm font-medium text-foreground">{assignment.title}</p><p className="mt-1 text-xs text-muted-foreground">Due {assignment.dueDate}</p></div>)}</div></div>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><History size={16} /> This tab reflects what you have done and how you are progressing. Practice controls stay on the Practice tab.</div></div>
          <WidgetGrid widgets={["speaking-profile", "ai-coach", "stats", "mastery", "recent-attempts", "streaks"]} collapsed={preferences.collapsedSections} onToggle={toggleSection} practiceData={data} tone="progress" />
        </div>
      )}
    </div>
  )
}
