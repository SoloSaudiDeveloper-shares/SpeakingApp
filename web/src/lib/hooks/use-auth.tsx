"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"

export interface AuthUser {
  id: number
  username: string
  role: string
  studentId: number | null
  displayName: string | null
}

export type RoleView = "student" | "teacher" | null

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  isStudent: boolean
  isTeacher: boolean
  isAdmin: boolean
  /** Effective role override — when set, the UI hides admin/teacher controls
   *  even though the underlying user is still admin/teacher. Purely client-side. */
  viewAsRole: RoleView
  setViewAsRole: (role: RoleView) => void
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>
  register: (data: { username: string; password: string; displayName: string; className?: string }) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

const VIEW_AS_KEY = "speaking-lab-view-as"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [viewAsRole, setViewAsRoleState] = useState<RoleView>(null)

  // Restore view-as mode from localStorage on mount. Only learner preview needs
  // a cookie because server routes use it to resolve a sample student id.
  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = localStorage.getItem(VIEW_AS_KEY)
    if (saved === "student") {
      setViewAsRoleState("student")
      document.cookie = "view-as=student; path=/; max-age=86400; SameSite=Lax"
    } else if (saved === "teacher") {
      setViewAsRoleState("teacher")
      document.cookie = "view-as=; path=/; max-age=0; SameSite=Lax"
    }
  }, [])

  const setViewAsRole = useCallback((role: RoleView) => {
    setViewAsRoleState(role)
    if (typeof window !== "undefined") {
      if (role) {
        localStorage.setItem(VIEW_AS_KEY, role)
        if (role === "student") {
          // Cookie tells the server to populate learner data with a sample student.
          document.cookie = "view-as=student; path=/; max-age=86400; SameSite=Lax"
        } else {
          document.cookie = "view-as=; path=/; max-age=0; SameSite=Lax"
        }
      } else {
        localStorage.removeItem(VIEW_AS_KEY)
        document.cookie = "view-as=; path=/; max-age=0; SameSite=Lax"
      }
    }
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me")
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  // Re-fetch the session whenever preview mode toggles, so the client picks up
  // the preview student id (or reverts) without a manual reload.
  useEffect(() => {
    refreshUser()
  }, [viewAsRole, refreshUser])

  const loginFn = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        return { ok: true }
      }
      const data = await res.json().catch(() => ({}))
      return { ok: false, error: data?.error ?? "Login failed." }
    } catch {
      return { ok: false, error: "Network error." }
    }
  }, [])

  const registerFn = useCallback(async (data: { username: string; password: string; displayName: string; className?: string }) => {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (res.ok) return { ok: true }
      const rdata = await res.json().catch(() => ({}))
      return { ok: false, error: rdata?.error ?? "Registration failed." }
    } catch {
      return { ok: false, error: "Network error." }
    }
  }, [])

  const logoutFn = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch { /* ignore */ }
    setUser(null)
    setViewAsRole(null)
  }, [setViewAsRole])

  const role = user?.role?.toLowerCase() ?? ""

  // The effective role for the UI: actual role unless overridden via viewAsRole
  const effectiveStudent = role === "student" || viewAsRole === "student"
  const effectiveTeacher = (role === "teacher" && viewAsRole === null) || (role === "admin" && viewAsRole === "teacher")
  const effectiveAdmin = role === "admin" && viewAsRole === null

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    isStudent: effectiveStudent,
    isTeacher: effectiveTeacher,
    isAdmin: effectiveAdmin,
    viewAsRole,
    setViewAsRole,
    login: loginFn,
    register: registerFn,
    logout: logoutFn,
    refreshUser,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider")
  return ctx
}
