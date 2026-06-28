"use client"

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react"
import { translate, type Language, type TranslationKey } from "@/lib/i18n/translations"

interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey) => string
  dir: "ltr" | "rtl"
}

const I18nContext = createContext<I18nContextType | null>(null)

const STORAGE_KEY = "speaking-lab-language"

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en")

  // Load saved language from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = localStorage.getItem(STORAGE_KEY) as Language | null
    if (saved === "ar" || saved === "en") {
      setLanguageState(saved)
    }
  }, [])

  // Update <html> lang and dir whenever language changes
  useEffect(() => {
    if (typeof document === "undefined") return
    document.documentElement.lang = language
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr"
  }, [language])

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, lang)
    }
  }, [])

  const t = useCallback(
    (key: TranslationKey) => translate(key, language),
    [language]
  )

  const value: I18nContextType = {
    language,
    setLanguage,
    t,
    dir: language === "ar" ? "rtl" : "ltr",
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextType {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used within an I18nProvider")
  return ctx
}
