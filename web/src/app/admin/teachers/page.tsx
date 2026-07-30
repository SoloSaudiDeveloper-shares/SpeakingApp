"use client"

import { useEffect, useState } from "react"
import { KeyRound, Loader2, ShieldCheck, UserX } from "lucide-react"
import { TemporaryPasswordDialog } from "@/components/admin/temporary-password-dialog"

interface TeacherAccount {
  id: number
  username: string
  displayName: string | null
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
}

export default function AdminTeachersPage() {
  const [teachers, setTeachers] = useState<TeacherAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [passwordTarget, setPasswordTarget] = useState<TeacherAccount | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = async () => {
    setError(null)
    try {
      const response = await fetch("/api/admin/teachers")
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error ?? "Teacher accounts could not be loaded.")
      setTeachers(data.teachers ?? [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Teacher accounts could not be loaded.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const setTemporaryPassword = async (teacher: TeacherAccount, password: string) => {
    const response = await fetch(`/api/admin/teachers/${teacher.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset-password", password }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return data?.error ?? "Teacher password could not be updated."
    setPasswordTarget(null)
    await load()
  }

  const deactivate = async (teacher: TeacherAccount) => {
    if (!confirm(`Disable ${teacher.username}? Their existing sessions will be revoked.`)) return
    setBusyId(teacher.id)
    setError(null)
    try {
      const response = await fetch(`/api/admin/teachers/${teacher.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate" }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error ?? "Teacher account could not be disabled.")
      await load()
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : "Teacher account could not be disabled.")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Teacher accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Secure migrated Teacher logins, reset temporary passwords, and revoke access.
        </p>
      </div>

      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        A disabled Teacher cannot be enabled with an old password. Setting a new temporary password both activates the account and forces a password change at first sign-in.
      </div>

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center">
          <Loader2 size={28} className="animate-spin text-primary" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Teacher</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Password</th>
                  <th className="px-4 py-3">Last sign-in</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {teachers.map((teacher) => (
                  <tr key={teacher.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{teacher.displayName || teacher.username}</p>
                      <p className="text-xs text-muted-foreground">{teacher.username}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={teacher.isActive ? "text-emerald-400" : "text-red-400"}>
                        {teacher.isActive ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {teacher.mustChangePassword ? (
                        <span className="text-amber-300">Change required</span>
                      ) : (
                        <span className="text-muted-foreground">Set by teacher</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {teacher.lastLoginAt ? new Date(teacher.lastLoginAt).toLocaleString() : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setPasswordTarget(teacher)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                        >
                          {teacher.isActive ? <KeyRound size={14} /> : <ShieldCheck size={14} />}
                          {teacher.isActive ? "Reset password" : "Secure and activate"}
                        </button>
                        {teacher.isActive && (
                          <button
                            type="button"
                            onClick={() => void deactivate(teacher)}
                            disabled={busyId === teacher.id}
                            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                          >
                            {busyId === teacher.id ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />}
                            Disable
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {teachers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No Teacher accounts found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {passwordTarget && (
        <TemporaryPasswordDialog
          title={passwordTarget.isActive ? "Reset Teacher password" : "Secure and activate Teacher"}
          description={
            passwordTarget.isActive
              ? `Set a temporary password for ${passwordTarget.username}.`
              : `${passwordTarget.username} is disabled. A new temporary password is required before activation.`
          }
          confirmLabel={passwordTarget.isActive ? "Reset password" : "Set password and activate"}
          onCancel={() => setPasswordTarget(null)}
          onConfirm={(password) => setTemporaryPassword(passwordTarget, password)}
        />
      )}
    </div>
  )
}
