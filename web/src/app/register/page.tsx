"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { Mic, Eye, EyeOff, Loader2, ArrowLeft } from "lucide-react"

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const form = e.currentTarget
    const username = (form.elements.namedItem("username") as HTMLInputElement).value.trim()
    const displayName = (form.elements.namedItem("displayName") as HTMLInputElement).value.trim()
    const className = (form.elements.namedItem("className") as HTMLInputElement).value.trim()
    const password = (form.elements.namedItem("password") as HTMLInputElement).value
    const confirmPassword = (form.elements.namedItem("confirmPassword") as HTMLInputElement).value

    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.")
      return
    }

    setLoading(true)

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, displayName, className, password }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error ?? "Registration failed. Please try again.")
        return
      }

      window.location.href = "/"
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      {/* Background decoration */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm animate-fade-in-scale">
        {/* Card */}
        <div className="rounded-2xl border border-border bg-card p-8 shadow-2xl shadow-black/20">
          {/* Logo & Title */}
          <div className="mb-7 flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
              <Mic size={22} className="text-primary" />
            </div>
            <div className="text-center">
              <h1 className="text-xl font-semibold text-foreground tracking-tight">
                Create Account
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Register as a new student
              </p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div className="space-y-1.5">
              <label
                htmlFor="username"
                className="block text-sm font-medium text-foreground"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                placeholder="your.username"
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
              />
            </div>

            {/* Full Name */}
            <div className="space-y-1.5">
              <label
                htmlFor="displayName"
                className="block text-sm font-medium text-foreground"
              >
                Full Name
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                autoComplete="name"
                required
                placeholder="Your full name"
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
              />
            </div>

            {/* Class */}
            <div className="space-y-1.5">
              <label
                htmlFor="className"
                className="block text-sm font-medium text-foreground"
              >
                Class
              </label>
              <input
                id="className"
                name="className"
                type="text"
                required
                placeholder="e.g. Grade 10A"
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-foreground"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  placeholder="Min. 6 characters"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-foreground"
              >
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  placeholder="Repeat your password"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  tabIndex={-1}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? "Creating account…" : "Create Account"}
            </button>
          </form>
        </div>

        {/* Back to login */}
        <div className="mt-5 flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={14} />
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
