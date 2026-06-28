"use client"

import { useState, useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/hooks/use-auth"
import { AppSidebar } from "./app-sidebar"
import { Loader2 } from "lucide-react"

const PUBLIC_PATHS = ["/", "/register"]

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isAuthenticated, viewAsRole, setViewAsRole } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const isPublicPage = PUBLIC_PATHS.includes(pathname)

  useEffect(() => {
    if (typeof window === "undefined") return
    const syncSidebar = () => {
      if (window.innerWidth < 768) setSidebarCollapsed(true)
    }
    syncSidebar()
    window.addEventListener("resize", syncSidebar)
    return () => window.removeEventListener("resize", syncSidebar)
  }, [])

  useEffect(() => {
    if (isLoading) return
    // Not logged in on a protected page → bounce to login
    if (!isAuthenticated && !isPublicPage) {
      router.replace("/")
    }
    // Already logged in but sitting on the login/register page → go to the app
    if (isAuthenticated && isPublicPage) {
      router.replace("/dashboard")
    }
  }, [isLoading, isAuthenticated, isPublicPage, router])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  // Not authenticated → render the public page (login/register) bare, no sidebar
  if (!isAuthenticated) {
    return <>{children}</>
  }

  // Authenticated but still on a public page → show a spinner while the
  // redirect above takes effect (prevents the "sidebar + login form" flash)
  if (isPublicPage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  const actualRole = user!.role.toLowerCase() as "student" | "teacher" | "admin"
  // Preview modes change the workspace shell but keep the real signed-in user.
  const displayedRole = viewAsRole ?? actualRole

  const sidebarUser = {
    role: displayedRole,
    displayName: user!.displayName || user!.username,
  }

  const handleEnterLearnerView = () => {
    setViewAsRole("student")
    router.push("/practice/hub")
  }

  const handleEnterTeacherView = () => {
    setViewAsRole("teacher")
    router.push("/teacher")
  }

  const handleExitLearnerView = () => {
    setViewAsRole(null)
    router.push(actualRole === "admin" ? "/admin/students" : "/teacher")
  }

  const handleExitTeacherView = () => {
    setViewAsRole(null)
    router.push("/admin/students")
  }

  const canPreviewAsLearner = actualRole === "admin" || actualRole === "teacher"
  const canPreviewAsTeacher = actualRole === "admin"

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar
        user={sidebarUser}
        actualRole={actualRole}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
        viewAsRole={viewAsRole}
        canPreviewAsLearner={canPreviewAsLearner}
        canPreviewAsTeacher={canPreviewAsTeacher}
        onEnterLearnerView={handleEnterLearnerView}
        onEnterTeacherView={handleEnterTeacherView}
        onExitLearnerView={handleExitLearnerView}
        onExitTeacherView={handleExitTeacherView}
      />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
