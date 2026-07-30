"use client"

import { AppearancePicker } from "@/components/layout/appearance-picker"
import { TtsPicker } from "@/components/layout/tts-picker"
import { useI18n } from "@/components/layout/i18n-provider"
import { Volume2 } from "lucide-react"

export default function AppearanceSettingsPage() {
  const { t } = useI18n()
  return (
    <div className="container mx-auto max-w-xl p-6 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">{t("settings.theme")}</h1>
      <div className="rounded-lg border border-border bg-card p-6">
        <AppearancePicker />
      </div>

      <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
        <Volume2 size={20} /> Tutor voice and accent
      </h2>
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="mb-4 text-sm text-muted-foreground">This changes the voice you hear from the tutor (text-to-speech). It does not change <strong>Groq Whisper — speech recognition</strong>, which listens to your speech.</p>
        <TtsPicker />
      </div>
    </div>
  )
}
