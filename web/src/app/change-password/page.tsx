"use client"

import { useState, type FormEvent } from "react"
import { useAuth } from "@/lib/hooks/use-auth"
import { KeyRound, Loader2, Eye, EyeOff, CheckCircle } from "lucide-react"

export default function ChangePasswordPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const form = e.currentTarget
    const currentPassword = (form.elements.namedItem("currentPassword") as HTMLInputElement).value
    const newPassword = (form.elements.namedItem("newPassword") as HTMLInputElement).value
    const confirmPassword = (form.elements.namedItem("confirmPassword") as HTMLInputElement).value

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.")
      return
    }

    if (newPassword.length < 12) {
      setError("Password must be at least 12 characters.")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })

      if (res.ok) {
        setSuccess(true)
        form.reset()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data?.error ?? "Failed to change password.")
      }
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md p-6 space-y-6">
      <div className="flex items-center gap-3">
        <KeyRound size={20} className="text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Change Password</h1>
      </div>

      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-400">
          <CheckCircle size={16} />
          Password changed successfully.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="currentPassword" className="block text-sm font-medium text-foreground">Current Password</label>
          <div className="relative">
            <input
              id="currentPassword"
              name="currentPassword"
              type={showCurrent ? "text" : "password"}
              required
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 pr-10 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
            />
            <button type="button" onClick={() => setShowCurrent((v) => !v)} tabIndex={-1} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="newPassword" className="block text-sm font-medium text-foreground">New Password</label>
          <div className="relative">
            <input
              id="newPassword"
              name="newPassword"
              type={showNew ? "text" : "password"}
              required
              placeholder="Min. 12 characters"
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 pr-10 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
            />
            <button type="button" onClick={() => setShowNew((v) => !v)} tabIndex={-1} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground">Confirm New Password</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading && <Loader2 size={15} className="animate-spin" />}
          {loading ? "Changing..." : "Change Password"}
        </button>
      </form>
    </div>
  )
}
