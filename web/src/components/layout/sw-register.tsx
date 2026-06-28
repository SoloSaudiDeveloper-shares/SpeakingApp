"use client"

import { useEffect } from "react"

/**
 * Registers the PWA service worker after the page loads.
 * Only runs in production builds (skipped in dev to avoid caching issues).
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return
    if (process.env.NODE_ENV !== "production") return

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" })
      } catch (e) {
        console.warn("Service worker registration failed:", e)
      }
    }

    if (document.readyState === "complete") {
      register()
    } else {
      window.addEventListener("load", register, { once: true })
    }
  }, [])

  return null
}
