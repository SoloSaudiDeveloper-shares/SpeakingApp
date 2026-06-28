"use client"

import { useState, useEffect } from "react"
import { Flag, Loader2 } from "lucide-react"

export default function TeacherReviewPage() {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500)
    return () => clearTimeout(t)
  }, [])

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Review Queue</h1>

      <div className="rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <Flag size={48} className="mx-auto text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">No flagged attempts to review.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Flagged attempts from students will appear here for manual review and scoring override.
        </p>
      </div>
    </div>
  )
}
