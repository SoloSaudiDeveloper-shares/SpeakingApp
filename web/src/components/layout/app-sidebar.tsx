"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Mic,
  History,
  Users,
  BookOpen,
  CalendarDays,
  Pencil,
  Radio,
  Settings,
  Activity,
  BarChart3,
  Flag,
  ChevronLeft,
  ChevronRight,
  LogOut,
  KeyRound,
  ChevronDown,
  Volume2,
  Brain,
  FileText,
  ArrowLeftCircle,
  MessageCircle,
  Eye,
  Palette,
  GraduationCap,
  ListOrdered,
  Gauge,
  Target,
  LibraryBig,
} from "lucide-react"
import { cn } from "@/lib/utils/cn"

/* ─── Types ──────────────────────────────────────────────────────────────────── */

type UserRole = "student" | "teacher" | "admin"
type RoleView = "student" | "teacher" | null

interface SidebarUser {
  role: UserRole
  displayName: string
}

interface AppSidebarProps {
  user: SidebarUser
  actualRole: UserRole
  collapsed: boolean
  onToggle: () => void
  viewAsRole: RoleView
  canPreviewAsLearner: boolean
  canPreviewAsTeacher: boolean
  onEnterLearnerView: () => void
  onEnterTeacherView: () => void
  onExitLearnerView: () => void
  onExitTeacherView: () => void
}

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
}

/* ─── Navigation Definitions ─────────────────────────────────────────────────── */

const studentLearnLinks: NavItem[] = [
  { label: "Learner Home",     href: "/practice/hub",           icon: LayoutDashboard },
  { label: "Lesson Practice",  href: "/practice",                icon: Mic             },
]

const studentSpeakingLinks: NavItem[] = [
  { label: "Weak Words",       href: "/practice/weak-words",     icon: Target          },
  { label: "Fluency Drills",   href: "/practice/fluency",        icon: Gauge           },
  { label: "AI Conversation",  href: "/practice/conversation",   icon: MessageCircle   },
  { label: "Text Practice",    href: "/practice/texts",          icon: FileText        },
]

const studentProgressLinks: NavItem[] = [
  { label: "History",          href: "/practice/history",        icon: History         },
]

const teacherLinks: NavItem[] = [
  { label: "Dashboard",     href: "/teacher",          icon: LayoutDashboard },
  { label: "Review Queue",  href: "/teacher/review",   icon: Flag            },
  { label: "Class Monitor", href: "/teacher/monitor",  icon: Eye             },
  { label: "Reports",       href: "/reports",          icon: BarChart3       },
  { label: "KLP Planner",    href: "/teacher/curriculum", icon: LibraryBig   },
  { label: "Audio Review",  href: "/reports/audio",    icon: Volume2         },
]

const adminLinks: NavItem[] = [
  { label: "Students",       href: "/admin/students",        icon: Users        },
  { label: "Books",          href: "/admin/books",           icon: BookOpen     },
  { label: "Cycles",         href: "/admin/cycles",          icon: CalendarDays },
  { label: "Practice Sets",  href: "/admin/practice-sets",   icon: Pencil       },
  { label: "Practice Stages",href: "/admin/stages",          icon: ListOrdered  },
  { label: "Curriculum KLPs", href: "/admin/curriculum",      icon: LibraryBig   },
  { label: "Live Sessions",  href: "/admin/live-session",    icon: Radio        },
  { label: "AI & Speech",    href: "/admin/models",          icon: Activity     },
  { label: "System",         href: "/admin/status",          icon: Settings     },
]

function getNavSections(role: UserRole): { title?: string; items: NavItem[] }[] {
  if (role === "student") return [
    { title: "Learn", items: studentLearnLinks },
    { title: "Speaking Practice", items: studentSpeakingLinks },
    { title: "Progress", items: studentProgressLinks },
  ]
  if (role === "teacher") {
    return [{ items: teacherLinks }]
  }
  return [{ items: adminLinks }]
}

/* ─── Sub-components ─────────────────────────────────────────────────────────── */

function NavLink({ item, collapsed, active }: { item: NavItem; collapsed: boolean; active: boolean }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors duration-150",
        "hover:bg-sidebar-accent hover:text-white",
        active ? "bg-sidebar-accent text-white" : "text-sidebar-foreground",
        collapsed && "justify-center px-2"
      )}
    >
      <Icon size={17} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )
}

function SectionLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return <div className="mx-2 my-1 h-px bg-sidebar-border" aria-hidden="true" />
  return (
    <p className="mb-1 mt-3 px-2 text-[0.65rem] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
      {label}
    </p>
  )
}

/* ─── Learner-view Banner ────────────────────────────────────────────────────── */

function PreviewBanner({
  collapsed,
  label,
  description,
  onExit,
}: {
  collapsed: boolean
  label: string
  description: string
  onExit: () => void
}) {
  return (
    <div className={cn("bg-amber-500/15 border-b border-amber-500/30", collapsed ? "px-1 py-2" : "px-3 py-2")}>
      {collapsed ? (
        <button
          onClick={onExit}
          title="Exit learner preview"
          className="flex w-full items-center justify-center text-amber-400 hover:text-amber-300 transition-colors"
        >
          <ArrowLeftCircle size={18} />
        </button>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <GraduationCap size={13} className="text-amber-400 shrink-0" />
            <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-amber-400">
              {label}
            </span>
          </div>
          <span className="text-xs text-amber-300/80">{description}</span>
          <button
            onClick={onExit}
            className="mt-1 flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/25 transition-colors"
          >
            <ArrowLeftCircle size={12} />
            Exit preview
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── User Footer ─────────────────────────────────────────────────────────────── */

function UserFooter({
  user,
  collapsed,
  canPreviewAsLearner,
  canPreviewAsTeacher,
  onEnterLearnerView,
  onEnterTeacherView,
}: {
  user: SidebarUser
  collapsed: boolean
  canPreviewAsLearner: boolean
  canPreviewAsTeacher: boolean
  onEnterLearnerView: () => void
  onEnterTeacherView: () => void
}) {
  const [open, setOpen] = useState(false)
  const initial = user.displayName.charAt(0).toUpperCase()

  const roleBadgeColor: Record<UserRole, string> = {
    student: "bg-blue-500/20 text-blue-300",
    teacher: "bg-emerald-500/20 text-emerald-300",
    admin:   "bg-amber-500/20 text-amber-300",
  }

  return (
    <div className="relative">
      {open && (
        <div
          className={cn(
            "absolute bottom-full mb-1 z-50 w-52 rounded-lg border border-sidebar-border bg-sidebar py-1 shadow-xl",
            "animate-fade-in-scale",
            collapsed ? "left-1/2 -translate-x-1/2" : "left-2"
          )}
        >
          {canPreviewAsTeacher && (
            <button
              onClick={() => { setOpen(false); onEnterTeacherView() }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-white transition-colors"
            >
              <Flag size={14} className="text-emerald-400" />
              <span className="flex flex-col items-start text-left">
                <span>Switch to Teacher View</span>
                <span className="text-[0.6rem] text-sidebar-foreground/50">Review classes and reports</span>
              </span>
            </button>
          )}
          {canPreviewAsLearner && (
            <>
              <button
                onClick={() => { setOpen(false); onEnterLearnerView() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-white transition-colors"
              >
                <GraduationCap size={14} className="text-blue-400" />
                <span className="flex flex-col items-start text-left">
                  <span>Preview as Learner</span>
                  <span className="text-[0.6rem] text-sidebar-foreground/50">See what students see</span>
                </span>
              </button>
            </>
          )}
          {(canPreviewAsTeacher || canPreviewAsLearner) && <div className="my-1 h-px bg-sidebar-border" />}
          <Link
            href="/settings/appearance"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-white transition-colors"
          >
            <Palette size={14} />
            Appearance & Language
          </Link>
          <Link
            href="/settings/mic-test"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-white transition-colors"
          >
            <Mic size={14} />
            Test Microphone
          </Link>
          <Link
            href="/change-password"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-white transition-colors"
          >
            <KeyRound size={14} />
            Change Password
          </Link>
          <div className="my-1 h-px bg-sidebar-border" />
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-white transition-colors"
            >
              <LogOut size={14} />
              Logout
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-sidebar-accent",
          collapsed && "justify-center"
        )}
        aria-label="User menu"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {initial}
        </span>
        {!collapsed && (
          <>
            <div className="flex min-w-0 flex-1 flex-col items-start text-left">
              <span className="truncate text-sm font-medium text-sidebar-foreground leading-tight">
                {user.displayName}
              </span>
              <span className={cn("mt-0.5 rounded px-1 py-px text-[0.6rem] font-semibold uppercase tracking-wider", roleBadgeColor[user.role])}>
                {user.role}
              </span>
            </div>
            <ChevronDown
              size={14}
              className={cn("shrink-0 text-sidebar-foreground/50 transition-transform duration-200", open && "rotate-180")}
            />
          </>
        )}
      </button>
    </div>
  )
}

/* ─── Main Sidebar ───────────────────────────────────────────────────────────── */

export function AppSidebar({
  user,
  actualRole,
  collapsed,
  onToggle,
  viewAsRole,
  canPreviewAsLearner,
  canPreviewAsTeacher,
  onEnterLearnerView,
  onEnterTeacherView,
  onExitLearnerView,
  onExitTeacherView,
}: AppSidebarProps) {
  const pathname = usePathname()
  const displayedRole = viewAsRole ?? actualRole
  const sections = getNavSections(displayedRole)
  const isPreview = viewAsRole !== null

  function isActive(href: string) {
    if (href === "/") return pathname === "/"
    if (href === "/practice") return pathname === "/practice"
    if (href === "/teacher") return pathname === "/teacher"
    if (href === "/admin/models") return pathname === "/admin/models"
    if (href === "/reports") return pathname === "/reports"
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <aside
      style={{ width: collapsed ? 56 : 240 }}
      className={cn(
        "relative flex h-screen flex-col bg-sidebar border-r border-sidebar-border",
        "transition-[width] duration-200 ease-in-out shrink-0"
      )}
    >
      <div className={cn("flex h-14 items-center border-b border-sidebar-border px-3", collapsed ? "justify-center" : "gap-2")}>
        <Mic size={20} className="shrink-0 text-primary" />
        {!collapsed && (
          <span className="text-sm font-semibold text-white tracking-tight">Speaking Lab</span>
        )}
      </div>

      {viewAsRole === "student" && (
        <PreviewBanner collapsed={collapsed} label="Learner Preview" description="You're seeing the student view" onExit={onExitLearnerView} />
      )}
      {viewAsRole === "teacher" && (
        <PreviewBanner collapsed={collapsed} label="Teacher View" description="You're seeing the teacher workspace" onExit={onExitTeacherView} />
      )}

      <button
        onClick={onToggle}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={cn(
          "absolute -right-3 top-10 z-10 flex h-6 w-6 items-center justify-center",
          "rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground",
          "hover:bg-sidebar-accent hover:text-white transition-colors shadow-sm"
        )}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        {sections.map((section, i) => (
          <div key={i}>
            {section.title && <SectionLabel label={section.title} collapsed={collapsed} />}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    item={item}
                    collapsed={collapsed}
                    active={isActive(item.href)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-2 py-3">
        <UserFooter
          user={user}
          collapsed={collapsed}
          canPreviewAsLearner={canPreviewAsLearner && viewAsRole !== "student"}
          canPreviewAsTeacher={canPreviewAsTeacher && viewAsRole !== "teacher" && !isPreview}
          onEnterLearnerView={onEnterLearnerView}
          onEnterTeacherView={onEnterTeacherView}
        />
      </div>
    </aside>
  )
}
