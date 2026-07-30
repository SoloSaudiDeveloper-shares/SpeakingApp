import { describe, expect, it } from "vitest"
import { createDefaultTtsProviderPolicy } from "@/lib/speech/tts-policy"
import {
  isSelectionDefault,
  moveFallback,
  promoteOrganizationDefault,
  setProviderEnabled,
  toggleFallback,
  updateProviderVoice,
} from "@/app/admin/models/tts/voice-settings"

describe("admin voice settings policy helpers", () => {
  it("promotes a provider and preserves the previous default as the first fallback", () => {
    const policy = createDefaultTtsProviderPolicy()
    policy.providers["openai-tts"].monthlyCharacterCap = 100_000

    const promoted = promoteOrganizationDefault(policy, "openai-tts", {
      modelId: "gpt-4o-mini-tts",
      voiceId: "coral",
    })

    expect(promoted.organizationDefault).toEqual({
      providerId: "openai-tts",
      modelId: "gpt-4o-mini-tts",
      voiceId: "coral",
    })
    expect(promoted.providers["openai-tts"].enabled).toBe(true)
    expect(promoted.fallbacks[0]?.providerId).toBe("windows-companion")
    expect(new Set([
      promoted.organizationDefault.providerId,
      ...promoted.fallbacks.map((item) => item.providerId),
    ]).size).toBe(promoted.fallbacks.length + 1)
  })

  it("does not disable the organization default", () => {
    const policy = createDefaultTtsProviderPolicy()
    const unchanged = setProviderEnabled(policy, "windows-companion", false)

    expect(unchanged).toBe(policy)
    expect(unchanged.providers["windows-companion"].enabled).toBe(true)
  })

  it("removes disabled providers from the fallback chain", () => {
    const policy = createDefaultTtsProviderPolicy()
    const updated = setProviderEnabled(policy, "azure-speech", false)

    expect(updated.fallbacks.some((item) => item.providerId === "azure-speech")).toBe(false)
  })

  it("adds, moves, and removes a fallback without duplicating it", () => {
    const policy = createDefaultTtsProviderPolicy()
    policy.fallbacks = policy.fallbacks.filter((item) => item.providerId !== "browser-system")

    const added = toggleFallback(policy, "browser-system")
    expect(added.fallbacks.at(-1)?.providerId).toBe("browser-system")

    const moved = moveFallback(added, "browser-system", -1)
    expect(moved.fallbacks.at(-2)?.providerId).toBe("browser-system")

    const removed = toggleFallback(moved, "browser-system")
    expect(removed.fallbacks.some((item) => item.providerId === "browser-system")).toBe(false)
  })

  it("keeps configured and default voice selections in sync", () => {
    const policy = createDefaultTtsProviderPolicy()
    const updated = updateProviderVoice(policy, "windows-companion", "bf_emma")

    expect(updated.providers["windows-companion"].voiceId).toBe("bf_emma")
    expect(updated.providers["windows-companion"].allowedVoiceIds).toContain("bf_emma")
    expect(isSelectionDefault(updated, "windows-companion", undefined, "bf_emma")).toBe(true)
  })
})
