"use client"

import { useEffect, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/hooks/use-auth"

const DIAGNOSTIC_SKIP_KEY = "speaking-lab-diagnostic-skip-session"

export default function PracticeLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading || !user || user.role?.toLowerCase() !== "student") return
    fetch("/api/onboarding")
      .then((response) => response.json())
      .then((state) => {
        if (state.notAStudent || state.hasDiagnostic) return
        const skippedThisSession = sessionStorage.getItem(DIAGNOSTIC_SKIP_KEY) === "1"
        if (!skippedThisSession) router.replace("/onboarding/diagnostic")
      })
      .catch(() => {})
  }, [isLoading, pathname, router, user])

  return children
}
