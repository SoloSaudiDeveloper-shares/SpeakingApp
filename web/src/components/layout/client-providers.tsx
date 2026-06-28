"use client"

import { useEffect } from "react"
import { AuthProvider } from "@/lib/hooks/use-auth"
import { AuthLayout } from "./auth-layout"
import { SttFallbackToast } from "./stt-fallback-toast"
import { loadConfiguredEngineId } from "@/lib/speech/speech-factory"

export function ClientProviders({ children }: { children: React.ReactNode }) {
  // Load the admin's configured STT engine once, so the default is consistent
  // across every page (practice, fluency drills, diagnostic, …).
  useEffect(() => { loadConfiguredEngineId().catch(() => {}) }, [])

  return (
    <AuthProvider>
      <AuthLayout>{children}</AuthLayout>
      <SttFallbackToast />
    </AuthProvider>
  )
}
