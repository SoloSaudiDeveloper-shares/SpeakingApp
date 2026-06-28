"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/hooks/use-auth"
import { Loader2 } from "lucide-react"

const DIAGNOSTIC_SKIP_KEY = "speaking-lab-diagnostic-skip-session"

export default function DashboardPage() {
  const { user, isLoading, isStudent, isTeacher, isAdmin } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return
    if (isAdmin) router.replace("/admin/students")
    else if (isTeacher) router.replace("/teacher")
    else if (isStudent) {
      const isRealStudent = user?.role?.toLowerCase() === "student"
      if (!isRealStudent) {
        router.replace("/practice/hub")
        return
      }
      fetch("/api/onboarding")
        .then((response) => response.json())
        .then((state) => {
          const skippedThisSession = sessionStorage.getItem(DIAGNOSTIC_SKIP_KEY) === "1"
          router.replace(!state.hasDiagnostic && !skippedThisSession ? "/onboarding/diagnostic" : "/practice/hub")
        })
        .catch(() => router.replace("/practice/hub"))
    }
    else router.replace("/")
  }, [isLoading, isAdmin, isTeacher, isStudent, user, router])

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 size={32} className="animate-spin text-primary" />
    </div>
  )
}
