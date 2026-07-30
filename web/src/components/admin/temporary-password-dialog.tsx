"use client"

import { useState } from "react"
import { KeyRound, Loader2, X } from "lucide-react"

interface TemporaryPasswordDialogProps {
  title: string
  description: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: (password: string) => Promise<string | void>
}

const MIN_PASSWORD_LENGTH = 12

export function TemporaryPasswordDialog({
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: TemporaryPasswordDialogProps) {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setError(null)
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.")
      return
    }
    setSaving(true)
    try {
      const message = await onConfirm(password)
      if (message) setError(message)
    } catch {
      setError("The password could not be updated. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="temporary-password-title"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-primary">
              <KeyRound size={18} />
              <h2 id="temporary-password-title" className="text-lg font-semibold text-foreground">{title}</h2>
            </div>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Close password dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="temporary-password" className="mb-1.5 block text-sm font-medium text-foreground">
              Temporary password
            </label>
            <input
              id="temporary-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="confirm-temporary-password" className="mb-1.5 block text-sm font-medium text-foreground">
              Confirm temporary password
            </label>
            <input
              id="confirm-temporary-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !saving) void submit()
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The user must replace this password at the next sign-in. Existing sessions will be revoked.
          </p>
          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
