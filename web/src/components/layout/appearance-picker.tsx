"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Sun, Moon, Languages, Palette } from "lucide-react"
import { useI18n } from "./i18n-provider"
import { cn } from "@/lib/utils/cn"

const ACCENT_THEMES = [
  { id: "blue",   color: "oklch(0.62 0.22 264)", label: "Blue" },
  { id: "green",  color: "oklch(0.65 0.18 145)", label: "Green" },
  { id: "purple", color: "oklch(0.62 0.22 305)", label: "Purple" },
  { id: "gold",   color: "oklch(0.78 0.16 75)",  label: "Gold" },
] as const

const ACCENT_STORAGE_KEY = "speaking-lab-accent"

export function AppearancePicker() {
  const { theme, setTheme } = useTheme()
  const { language, setLanguage, t } = useI18n()
  const [mounted, setMounted] = useState(false)
  const [accent, setAccent] = useState<string>("blue")

  useEffect(() => {
    setMounted(true)
    const saved = localStorage.getItem(ACCENT_STORAGE_KEY)
    if (saved) {
      setAccent(saved)
      document.documentElement.dataset.accent = saved
    }
  }, [])

  const changeAccent = (id: string) => {
    setAccent(id)
    document.documentElement.dataset.accent = id
    localStorage.setItem(ACCENT_STORAGE_KEY, id)
  }

  if (!mounted) return null

  return (
    <div className="space-y-6">
      {/* Theme mode */}
      <div>
        <label className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <Palette size={14} />
          {t("settings.theme")}
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => setTheme("light")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
              theme === "light"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-foreground/30"
            )}
          >
            <Sun size={16} />
            {t("settings.light")}
          </button>
          <button
            onClick={() => setTheme("dark")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
              theme === "dark"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-foreground/30"
            )}
          >
            <Moon size={16} />
            {t("settings.dark")}
          </button>
        </div>
      </div>

      {/* Accent color */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          {t("settings.accent_color")}
        </label>
        <div className="flex gap-3">
          {ACCENT_THEMES.map((a) => (
            <button
              key={a.id}
              onClick={() => changeAccent(a.id)}
              title={a.label}
              className={cn(
                "h-10 w-10 rounded-full border-2 transition-all",
                accent === a.id
                  ? "border-foreground scale-110 shadow-md"
                  : "border-transparent hover:scale-105"
              )}
              style={{ backgroundColor: a.color }}
            />
          ))}
        </div>
      </div>

      {/* Language */}
      <div>
        <label className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <Languages size={14} />
          {t("settings.language")}
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => setLanguage("en")}
            className={cn(
              "flex flex-1 items-center justify-center rounded-md border px-3 py-2 text-sm transition-colors",
              language === "en"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-foreground/30"
            )}
          >
            English
          </button>
          <button
            onClick={() => setLanguage("ar")}
            className={cn(
              "flex flex-1 items-center justify-center rounded-md border px-3 py-2 text-sm transition-colors font-arabic",
              language === "ar"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-foreground/30"
            )}
          >
            العربية
          </button>
        </div>
      </div>
    </div>
  )
}
