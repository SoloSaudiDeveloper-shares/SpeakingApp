"use client"

import { useState, useEffect } from "react"
import { BarChart3, Loader2 } from "lucide-react"

interface Student {
  id: number
  fullName: string
  class: string | null
  cefrBand: string
}

export default function ClassReportsPage() {
  const [studentList, setStudentList] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/students")
      .then((r) => r.json())
      .then((d) => setStudentList(d.students ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  // Group by class
  const byClass: Record<string, Student[]> = {}
  for (const s of studentList) {
    const cls = s.class ?? "Unassigned"
    if (!byClass[cls]) byClass[cls] = []
    byClass[cls].push(s)
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Class Reports</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries(byClass).map(([cls, students]) => (
          <div key={cls} className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={16} className="text-primary" />
              <h2 className="font-semibold text-foreground">{cls}</h2>
              <span className="ml-auto text-xs text-muted-foreground">{students.length} students</span>
            </div>
            <div className="space-y-1">
              {students.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{s.fullName}</span>
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{s.cefrBand}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
