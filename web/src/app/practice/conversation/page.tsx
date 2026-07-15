"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Send, Mic, MicOff, Loader2, MessageCircle, Sparkles, AlertTriangle, CheckCircle2, Circle, Trophy, X, Volume2, Coffee, Utensils, ShoppingBag, Map, Stethoscope, Briefcase, Plane, Users, Drama } from "lucide-react"
import { getDefaultEngine, getSpeechEngine } from "@/lib/speech/speech-factory"
import type { SpeechEngine, STTEngineId } from "@/lib/speech/types"
import { recordClientSpeechReliabilityEvent } from "@/lib/speech/reliability-client"
import { speak, cancelSpeak, prepareActiveTts } from "@/lib/speech/tts"
import { useI18n } from "@/components/layout/i18n-provider"
import { SCENARIOS, type Scenario } from "@/lib/ai/scenarios"
import type { ScenarioProgressionMode } from "@/lib/ai/scenarios"

const SCENARIO_ICONS: Record<string, React.ElementType> = {
  Coffee, Utensils, ShoppingBag, Map, Stethoscope, Briefcase, Plane, Users,
}

interface Message {
  role: "user" | "assistant"
  content: string
  timestamp: number
}

const SYSTEM_PROMPT = `You are a friendly English conversation tutor for Arabic-speaking students at the A1-B2 level. Your goal is to help them practice speaking English naturally. Rules:
- Keep responses short (1-2 sentences max).
- Use simple vocabulary appropriate for the student's level.
- Ask follow-up questions to keep the conversation going.
- Gently correct major grammar errors by repeating the corrected version.
- Encourage and praise effort.
- Never write Arabic in your responses unless explicitly asked.`

const TOPIC_STARTERS = [
  { id: "intro", title: "Introduce yourself", prompt: "Let's get to know each other! Tell me about yourself - your name, where you're from, and what you like to do." },
  { id: "weather", title: "Today's weather", prompt: "How is the weather today where you are? Do you like this kind of weather?" },
  { id: "hobby", title: "Your hobbies", prompt: "What do you like to do in your free time? Tell me about your favorite hobby." },
  { id: "food", title: "Favorite food", prompt: "What is your favorite food? Can you describe it for me?" },
  { id: "travel", title: "Travel dreams", prompt: "If you could travel anywhere in the world, where would you go and why?" },
]

const PROGRESSION_SECTIONS: Array<{ id: ScenarioProgressionMode; title: string; detail: string }> = [
  { id: "controlled", title: "Controlled practice", detail: "Use one target word or lesson phrase accurately." },
  { id: "guided", title: "Guided scenario", detail: "Complete a real-life role-play with clear goals." },
  { id: "open", title: "Open scenario", detail: "Keep a less-scripted conversation going naturally." },
  { id: "simulation", title: "Exam/workplace simulation", detail: "Perform under pressure with stronger success criteria." },
]

function scenarioMode(scenario: Scenario): ScenarioProgressionMode {
  if (scenario.progressionMode) return scenario.progressionMode
  return /^practice\s+/i.test(scenario.title) ? "controlled" : "guided"
}

type InputMode = "both" | "text" | "voice"
type ScenarioScoringMode = "manual" | "live"

type ScenarioResult = {
  criteria: string[]
  criteriaMet: boolean[]
  score: number
  feedback: string
  persisted?: boolean
  criteriaDetails?: Array<{
    criterion: string
    met: boolean
    reason: string
    evidence?: string
  }>
}

export default function AIConversationPage() {
  const { t } = useI18n()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [thinking, setThinking] = useState(false)
  const [recording, setRecording] = useState(false)
  const [model, setModel] = useState("")
  const [providerName, setProviderName] = useState("")
  const [aiEnabled, setAiEnabled] = useState(true)
  const [inputMode, setInputMode] = useState<InputMode>("both")
  const [scenarioScoringMode, setScenarioScoringMode] = useState<ScenarioScoringMode>("live")
  const [micError, setMicError] = useState<string | null>(null)
  const [liveTranscript, setLiveTranscript] = useState("")
  // The AI tutor is currently speaking (TTS playing) — block recording so the
  // mic doesn't capture the AI's own voice.
  const [aiSpeaking, setAiSpeaking] = useState(false)
  // The voice model has finished loading — until then, "Speak" is disabled.
  const [ttsReady, setTtsReady] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<SpeechEngine | null>(null)
  const interimUnsubRef = useRef<(() => void) | null>(null)

  // Scenario role-play
  const router = useRouter()
  const searchParams = useSearchParams()
  const assignmentId = searchParams.get("assignmentId")
  const [tab, setTab] = useState<"chat" | "scenarios">(searchParams.get("mode") === "scenarios" ? "scenarios" : "chat")
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null)
  const [scenarioList, setScenarioList] = useState<Scenario[]>(SCENARIOS)
  const [assignedScenarioIds, setAssignedScenarioIds] = useState<string[]>([])
  const [grading, setGrading] = useState(false)
  const [liveGrading, setLiveGrading] = useState(false)
  const [liveSaved, setLiveSaved] = useState(false)
  const [scenarioEnded, setScenarioEnded] = useState(false)
  const [scenarioSessionId, setScenarioSessionId] = useState("")
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null)
  const [liveScenarioResult, setLiveScenarioResult] = useState<ScenarioResult | null>(null)

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(s => {
      if (s.enable_ai !== undefined) setAiEnabled(s.enable_ai !== "false")
      if (s.ai_conversation_input_mode) {
        const m = s.ai_conversation_input_mode
        if (m === "both" || m === "text" || m === "voice") setInputMode(m)
      }
      if (s.ai_conversation_scenario_scoring_mode === "manual" || s.ai_conversation_scenario_scoring_mode === "live") {
        setScenarioScoringMode(s.ai_conversation_scenario_scoring_mode)
      }
    }).catch(() => {})

    // Show the actual active provider + model (handles Ollama/Groq/Grok/OpenAI)
    fetch("/api/ai/status").then(r => r.json()).then(s => {
      if (s.model) setModel(s.model)
      if (s.provider) setProviderName(s.provider)
    }).catch(() => {})
    fetch("/api/ai/scenarios")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.scenarios) && data.scenarios.length > 0) setScenarioList(data.scenarios)
        if (Array.isArray(data.assignedScenarioIds)) setAssignedScenarioIds(data.assignedScenarioIds)
      })
      .catch(() => {})

    // Warm up the STT engine (offline models cold-load) and the active neural
    // voice (Kokoro). "Speak" stays disabled with a "loading voice…" message
    // until the voice model is ready, so the user never talks to a dead mic.
    const saved = (typeof window !== "undefined" ? localStorage.getItem("stt-engine") : null) as STTEngineId | null
    engineRef.current = saved ? getSpeechEngine(saved) : getDefaultEngine()
    engineRef.current.prepare?.().catch(() => {})
    prepareActiveTts().finally(() => setTtsReady(true))
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Clean up the mic subscription + stop any AI speech if the user leaves
  useEffect(() => {
    return () => {
      if (interimUnsubRef.current) interimUnsubRef.current()
      engineRef.current?.stop?.().catch(() => {})
      cancelSpeak()
    }
  }, [])

  // Speak an AI line, flagging `aiSpeaking` so the mic is blocked until it ends.
  const speakAi = useCallback(async (text: string) => {
    setAiSpeaking(true)
    try { await speak(text) } catch { /* fallback handled in speak() */ } finally { setAiSpeaking(false) }
  }, [])

  const scoreScenarioMessages = useCallback(async (
    scenario: Scenario,
    messagesForScore: Message[],
    options: { persistMode: "always" | "auto" | "never"; showModal?: boolean; live?: boolean; completionReason?: "manual" | "goals-met" | "max-turns" },
  ) => {
    if (options.live) setLiveGrading(true)
    else setGrading(true)
    try {
      const res = await fetch("/api/ai/scenario-score", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: scenario.id,
          messages: messagesForScore.map(m => ({ role: m.role, content: m.content })),
          persistMode: options.persistMode,
          sessionId: scenarioSessionId,
          completionReason: options.completionReason,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMicError(data?.error ?? "Could not score the scenario.")
        return null
      }
      const result: ScenarioResult = {
        criteria: data.criteria,
        criteriaMet: data.criteriaMet,
        score: data.score,
        feedback: data.feedback,
        persisted: !!data.persisted,
        criteriaDetails: Array.isArray(data.criteriaDetails) ? data.criteriaDetails : undefined,
      }
      if (options.live) {
        setLiveScenarioResult(result)
        if (result.persisted) setLiveSaved(true)
      }
      if (options.showModal) setScenarioResult(result)
      return result
    } catch {
      setMicError(options.live ? "Live scoring is temporarily unavailable." : "Network error while scoring.")
      return null
    } finally {
      if (options.live) setLiveGrading(false)
      else setGrading(false)
    }
  }, [scenarioSessionId])

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || scenarioEnded) return

    const userMsg: Message = { role: "user", content, timestamp: Date.now() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput("")
    setThinking(true)

    if (activeScenario) {
      const result = await scoreScenarioMessages(activeScenario, newMessages, { persistMode: "auto", live: true })
      const learnerTurns = newMessages.filter((message) => message.role === "user" && message.content.trim()).length
      const allGoalsMet = Boolean(result?.criteriaMet.length) && result!.criteriaMet.every(Boolean)
      const maxTurns = Math.max(activeScenario.minTurns, activeScenario.maxTurns ?? 8)
      const completionReason = learnerTurns >= maxTurns ? "max-turns" : allGoalsMet && learnerTurns >= activeScenario.minTurns ? "goals-met" : null
      if (result && completionReason) {
        const closing = completionReason === "goals-met"
          ? "You achieved the goals for this scenario. Great work — let’s review your feedback."
          : "That completes the final turn. Let’s review what you achieved and what to practise next."
        setScenarioEnded(true)
        setLiveSaved(Boolean(result.persisted))
        setScenarioResult(result)
        setMessages([...newMessages, { role: "assistant", content: closing, timestamp: Date.now() }])
        void speakAi(closing)
        setThinking(false)
        return
      }
    }

    try {
      // NOTE: we do NOT send a `model` override. The server's provider
      // abstraction picks the correct model for whichever provider is active
      // (Ollama / Groq / Grok / OpenAI). Sending an Ollama model name would
      // break cloud providers that don't recognize it.
      const systemContent = activeScenario ? activeScenario.systemPrompt : SYSTEM_PROMPT
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: activeScenario?.id,
          messages: [
            { role: "system", content: systemContent },
            ...newMessages.map(m => ({ role: m.role, content: m.content })),
          ],
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const detail = data?.error ? `\n\n(${data.error})` : ""
        setMessages([...newMessages, {
          role: "assistant",
          content: `Sorry, I couldn't reach the AI service.${detail}\n\nAn admin can check the provider in Admin → AI Settings.`,
          timestamp: Date.now(),
        }])
        return
      }

      const aiContent = data.message?.content || data.choices?.[0]?.message?.content || data.response || "I'm here to help!"
      setMessages([...newMessages, { role: "assistant", content: aiContent, timestamp: Date.now() }])

      // Auto-speak the AI response (blocks the mic until it finishes)
      speakAi(aiContent)
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "Network error. Please try again.", timestamp: Date.now() }])
    } finally {
      setThinking(false)
    }
  }, [messages, activeScenario, scenarioEnded, scoreScenarioMessages, speakAi])

  const startScenario = (scenario: Scenario) => {
    setActiveScenario(scenario)
    setScenarioResult(null)
    setLiveScenarioResult(null)
    setLiveSaved(false)
    setScenarioEnded(false)
    setScenarioSessionId(globalThis.crypto?.randomUUID?.() ?? `${scenario.id}-${Date.now()}`)
    setMessages([{ role: "assistant", content: scenario.firstMessage, timestamp: Date.now() }])
    speakAi(scenario.firstMessage)
  }

  const finishScenario = async () => {
    if (!activeScenario) return
    if (scenarioEnded && (scenarioResult || liveScenarioResult)) {
      setScenarioResult(scenarioResult ?? liveScenarioResult)
      return
    }
    const result = await scoreScenarioMessages(activeScenario, messages, { persistMode: "always", showModal: true, completionReason: "manual" })
    if (result) {
      const closing = "You’ve finished this scenario. Review your goals and one next improvement below."
      setScenarioEnded(true)
      setLiveSaved(Boolean(result.persisted))
      setMessages((current) => [...current, { role: "assistant", content: closing, timestamp: Date.now() }])
    }
  }

  const exitScenario = () => {
    if (assignmentId) {
      router.push("/practice/hub")
      return
    }
    setActiveScenario(null)
    setScenarioResult(null)
    setLiveScenarioResult(null)
    setLiveSaved(false)
    setScenarioEnded(false)
    setScenarioSessionId("")
    setMessages([])
  }

  useEffect(() => {
    const requested = searchParams.get("scenarioId")
    if (!requested || activeScenario || messages.length > 0) return
    const scenario = scenarioList.find((item) => item.id === requested)
    if (scenario) startScenario(scenario)
    // startScenario intentionally uses current scenario selection state only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioList, searchParams, activeScenario, messages.length])

  const handleVoiceInput = async () => {
    setMicError(null)

    if (recording) {
      // ── Stop recording ──
      setRecording(false)
      if (interimUnsubRef.current) { interimUnsubRef.current(); interimUnsubRef.current = null }
      try {
        if (!engineRef.current) return
        const sttStartedAt = Date.now()
        const result = await engineRef.current.stop()
        setLiveTranscript("")
        const transcript = (result.transcript ?? "").trim()
        recordClientSpeechReliabilityEvent({
          eventType: "stt",
          provider: engineRef.current?.name ?? "conversation-engine",
          route: "conversation-engine-stop",
          scenarioId: activeScenario?.id ?? null,
          success: !!transcript,
          latencyMs: Date.now() - sttStartedAt,
          noSpeech: !transcript || result.errorCode === "no-speech",
          errorCode: transcript ? null : (result.errorCode ?? "no-speech"),
          metadata: { engine: engineRef.current?.name ?? "Conversation engine" },
        })
        if (transcript) {
          await sendMessage(transcript)
        } else {
          // No speech detected — show a hint instead of failing silently
          setMicError(
            result.errorMessage ??
            "No speech detected. Try speaking louder and closer to the mic, then tap the mic again.",
          )
        }
      } catch (e) {
        recordClientSpeechReliabilityEvent({
          eventType: "stt",
          provider: engineRef.current?.name ?? "conversation-engine",
          route: "conversation-engine-stop",
          scenarioId: activeScenario?.id ?? null,
          success: false,
          errorCode: "engine-stop-failed",
          metadata: { message: e instanceof Error ? e.message.slice(0, 120) : "Unknown stop error" },
        })
        setMicError(e instanceof Error ? e.message : "Something went wrong while transcribing.")
      }
      return
    }

    // Don't start recording while the AI is still speaking or the voice model is
    // loading — that's the overlap the user hit (mic capturing the AI's voice).
    if (aiSpeaking || !ttsReady) return

    // ── Start recording ──
    try {
      if (!engineRef.current) {
        const saved = (typeof window !== "undefined" ? localStorage.getItem("stt-engine") : null) as STTEngineId | null
        engineRef.current = saved ? getSpeechEngine(saved) : getDefaultEngine()
      }
      setLiveTranscript("")
      await engineRef.current.start()
      setRecording(true)

      // Live transcript (Web Speech API surfaces interim results)
      if (engineRef.current.onInterim) {
        interimUnsubRef.current = engineRef.current.onInterim((tx) => setLiveTranscript(tx))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Microphone not available."
      recordClientSpeechReliabilityEvent({
        eventType: "recording",
        provider: engineRef.current?.name ?? "conversation-engine",
        route: "conversation-recording-start",
        scenarioId: activeScenario?.id ?? null,
        success: false,
        errorCode: msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied") ? "permission-denied" : "recording-start-failed",
        metadata: { engine: engineRef.current?.name ?? "Conversation engine" },
      })
      // Friendly message for the most common case (permission denied)
      if (msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("permission")) {
        setMicError("Microphone access was blocked. Click the mic/camera icon in your browser's address bar and allow the microphone, then try again.")
      } else {
        setMicError(msg)
      }
      setRecording(false)
    }
  }

  const startTopic = (prompt: string) => {
    const aiMsg: Message = { role: "assistant", content: prompt, timestamp: Date.now() }
    setMessages([aiMsg])
    speakAi(prompt)
  }

  if (!aiEnabled) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md text-center">
          <Sparkles className="mx-auto mb-3 text-muted-foreground" size={36} />
          <h2 className="mb-2 text-xl font-semibold">AI features are disabled</h2>
          <p className="text-sm text-muted-foreground">
            Ask your administrator to enable AI features in the Admin → AI Settings page.
          </p>
        </div>
      </div>
    )
  }

  const scenarioProgress = liveScenarioResult ?? scenarioResult
  const scenarioUserTurnCount = messages.filter(m => m.role === "user" && m.content.trim()).length
  const scenarioCanFinish = !activeScenario || scenarioEnded || scenarioUserTurnCount >= activeScenario.minTurns
  const scenarioButtonLabel = scenarioEnded ? "View feedback" : "Finish & Save"
  const scenarioGoalsMet = scenarioProgress?.criteriaMet.filter(Boolean).length ?? 0
  const scenarioGoalTotal = activeScenario?.successCriteria.length ?? 0
  const scenarioProgressPercent = scenarioGoalTotal ? Math.round((scenarioGoalsMet / scenarioGoalTotal) * 100) : 0
  const recommendedMode: ScenarioProgressionMode = assignedScenarioIds.length
    ? "controlled"
    : "guided"
  const scenariosByMode = PROGRESSION_SECTIONS.map((section) => ({
    ...section,
    scenarios: scenarioList.filter((scenario) => scenarioMode(scenario) === section.id),
  })).filter((section) => section.scenarios.length > 0)
  const scenarioModelAnswer = activeScenario?.targetVocabulary?.[0]
    ? activeScenario.targetVocabulary[0].toLowerCase() === "am"
      ? "I am ready."
      : `I can use ${activeScenario.targetVocabulary[0]} in a clear answer.`
    : activeScenario?.studentGoal ?? null

  return (
    <div className="flex h-[calc(100vh-2rem)] flex-col p-4 md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <MessageCircle className="text-primary" size={24} />
        <div>
          <h1 className="text-xl font-bold text-foreground">{t("ai_conv.title")}</h1>
          <p className="text-xs text-muted-foreground">
            Practice speaking with an AI tutor
            {providerName && model ? ` · ${providerName} · ${model}` : ""}
          </p>
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center overflow-y-auto py-4">
          {/* Tabs */}
          <div className="mb-5 inline-flex rounded-lg border border-border bg-card p-1">
            <button
              onClick={() => setTab("chat")}
              className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === "chat" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <MessageCircle size={14} /> Free Chat
            </button>
            <button
              onClick={() => setTab("scenarios")}
              className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === "scenarios" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Drama size={14} /> Scenarios
            </button>
          </div>

          {tab === "chat" ? (
            <div className="flex flex-col items-center">
              <Sparkles className="mb-3 text-primary" size={36} />
              <h2 className="mb-1 text-lg font-semibold">{t("ai_conv.start_conversation")}</h2>
              <p className="mb-5 text-sm text-muted-foreground">Pick a topic to begin or just say hi!</p>
              <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                {TOPIC_STARTERS.map(topic => (
                  <button
                    key={topic.id}
                    onClick={() => startTopic(topic.prompt)}
                    className="rounded-lg border border-border bg-card p-4 text-left text-sm transition hover:border-primary hover:shadow-md"
                  >
                    <div className="font-semibold text-foreground">{topic.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{topic.prompt}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center w-full">
              <Drama className="mb-3 text-primary" size={36} />
              <h2 className="mb-1 text-lg font-semibold">Role-play a real situation</h2>
              <p className="mb-5 text-sm text-muted-foreground">Move from controlled practice into guided, open, and simulation speaking. Access is open; the recommendation just points you to the best next step.</p>
              <div className="w-full max-w-4xl space-y-4">
                {scenariosByMode.map((section) => (
                  <section key={section.id} className={`rounded-lg border p-4 ${section.id === recommendedMode ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-foreground">{section.title}</h3>
                        <p className="text-xs text-muted-foreground">{section.detail}</p>
                      </div>
                      {section.id === recommendedMode && (
                        <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[0.65rem] font-semibold text-primary">Recommended next</span>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {section.scenarios.map(s => {
                        const Icon = SCENARIO_ICONS[s.icon] ?? Drama
                        const assigned = assignedScenarioIds.includes(s.id)
                        return (
                          <button
                            key={s.id}
                            onClick={() => startScenario(s)}
                            className="flex items-start gap-3 rounded-lg border border-border bg-background/45 p-4 text-left transition hover:border-primary hover:shadow-md"
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                              <Icon size={18} className="text-primary" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="font-semibold text-foreground">{s.title}</div>
                                {assigned && (
                                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-300">
                                    Assigned
                                  </span>
                                )}
                                {s.simulationType && (
                                  <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[0.65rem] font-semibold text-blue-300">
                                    {s.simulationType}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.description}</div>
                              {s.estimatedMinutes && <div className="mt-2 text-[0.65rem] text-muted-foreground">{s.estimatedMinutes} min</div>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
        {/* Scenario goal bar */}
        {activeScenario && (
          <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Drama size={15} className="text-primary shrink-0" />
                <span className="text-sm font-semibold text-foreground truncate">{activeScenario.title}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={finishScenario}
                  disabled={grading || liveGrading || !scenarioCanFinish}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                  title={!scenarioCanFinish ? `Keep going - at least ${activeScenario.minTurns} replies needed` : scenarioButtonLabel}
                >
                  {grading || liveGrading ? <Loader2 size={13} className="animate-spin" /> : <Trophy size={13} />} {scenarioButtonLabel}
                </button>
                <button onClick={exitScenario} className="text-muted-foreground hover:text-foreground" title="Exit scenario"><X size={16} /></button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activeScenario.successCriteria.map((c, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] ${
                    scenarioProgress?.criteriaMet[i]
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-background/60 text-muted-foreground"
                  }`}
                >
                  {scenarioProgress?.criteriaMet[i] ? <CheckCircle2 size={10} /> : <Circle size={9} />} {c}
                </span>
              ))}
            </div>
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[0.7rem] text-muted-foreground">
                <span>Goal progress</span>
                <span>{scenarioGoalsMet}/{scenarioGoalTotal} goals · {scenarioProgressPercent}% · turn {scenarioUserTurnCount}/{activeScenario.maxTurns ?? 8}</span>
              </div>
              <div
                className="grid h-2 overflow-hidden rounded-full bg-background/70 ring-1 ring-border"
                style={{ gridTemplateColumns: `repeat(${Math.max(1, scenarioGoalTotal)}, minmax(0, 1fr))` }}
              >
                {activeScenario.successCriteria.map((_, i) => (
                  <div
                    key={i}
                    className={`border-r border-background/60 last:border-r-0 ${
                      scenarioProgress?.criteriaMet[i] ? "bg-emerald-400" : "bg-muted"
                    }`}
                  />
                ))}
              </div>
            </div>
            {scenarioScoringMode === "live" && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.7rem] text-muted-foreground">
                <span className="rounded-full border border-border bg-background/60 px-2 py-0.5">
                  Live scoring {liveGrading ? "checking..." : "on"}
                </span>
                {scenarioProgress && (
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${
                    scenarioProgress.score >= 75
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-amber-500/15 text-amber-300"
                  }`}>
                    {scenarioProgress.score}% {liveSaved || scenarioProgress.persisted ? "saved" : "current"}
                  </span>
                )}
              </div>
            )}
            <p className="mt-2 text-[0.7rem] text-muted-foreground">
              The tutor wraps up when every goal is met after {activeScenario.minTurns} turns, or after {activeScenario.maxTurns ?? 8} turns.
            </p>
            {scenarioProgress?.criteriaDetails && (
              <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {scenarioProgress.criteriaDetails.map((detail, i) => (
                  <div
                    key={`${detail.criterion}-${i}`}
                    className={`rounded-md border px-2.5 py-2 text-[0.72rem] ${
                      detail.met
                        ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-100"
                        : "border-border bg-background/40 text-muted-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold">
                      {detail.met ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Circle size={12} />}
                      <span>{detail.criterion}</span>
                    </div>
                    <p className="mt-1 leading-snug">{detail.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4">
          <div className="space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-muted px-4 py-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  {t("ai_conv.thinking")}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
        </>
      )}

      {/* Scenario result modal */}
      {scenarioResult && activeScenario && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-3 text-center">
              <Trophy className="mx-auto mb-2 text-amber-400" size={32} />
              <h3 className="text-lg font-bold text-foreground">{activeScenario.title}</h3>
              <div className={`mt-1 text-3xl font-bold ${scenarioResult.score >= 75 ? "text-emerald-400" : scenarioResult.score >= 50 ? "text-amber-400" : "text-red-400"}`}>
                {scenarioResult.score}%
              </div>
            </div>
            <p className="mb-4 text-center text-sm text-muted-foreground">{scenarioResult.feedback}</p>
            {scenarioResult.criteria.some((_, i) => !scenarioResult.criteriaMet[i]) && (
              <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">Fix this next</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {scenarioResult.criteria.find((_, i) => !scenarioResult.criteriaMet[i])}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try the same role-play again and make this goal clear in your answer.
                </p>
              </div>
            )}
            <div className="mb-4 space-y-1.5">
              {scenarioResult.criteria.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {scenarioResult.criteriaMet[i]
                    ? <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                    : <Circle size={15} className="text-muted-foreground shrink-0" />}
                  <span className={scenarioResult.criteriaMet[i] ? "text-foreground" : "text-muted-foreground"}>{c}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => startScenario(activeScenario)} className="flex-1 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Try scenario again</button>
              {scenarioModelAnswer && (
                <button onClick={() => speakAi(scenarioModelAnswer)} className="flex-1 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10">Practice model</button>
              )}
              <button onClick={exitScenario} className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Mic error banner */}
      {micError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-500">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{micError}</span>
        </div>
      )}

      {/* Live transcript / recording indicator */}
      {recording && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="text-sm text-foreground">
            {liveTranscript ? (
              <>
                {liveTranscript}
                <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-primary align-middle" />
              </>
            ) : (
              <span className="text-muted-foreground">Listening… speak now, then tap the mic to send.</span>
            )}
          </span>
        </div>
      )}

      {/* Input mode notice */}
      {inputMode !== "both" && !recording && (
        <div className="mt-3 mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          {inputMode === "voice" ? (
            <>
              <Mic size={12} />
              <span>Voice-only mode — speak your message using the microphone.</span>
            </>
          ) : (
            <>
              <Send size={12} />
              <span>Text-only mode — type your message and press Enter or Send.</span>
            </>
          )}
        </div>
      )}

      {/* Loading / AI-speaking status — prevents talking over the AI or to a
          not-yet-loaded voice model */}
      {(!ttsReady || aiSpeaking) && !recording && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            {!ttsReady ? (
              <><Loader2 size={14} className="animate-spin" /> Loading the voice model… please wait.</>
            ) : (
              <><Volume2 size={14} className="text-primary animate-pulse" /> The AI is speaking — listen, then it&apos;s your turn.</>
            )}
          </span>
          {aiSpeaking && ttsReady && (
            <button
              onClick={() => { cancelSpeak(); setAiSpeaking(false) }}
              className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
            >
              Skip
            </button>
          )}
        </div>
      )}

      {/* Input bar */}
      <div className="mt-4 flex gap-2">
        {/* Voice button — only when voice is allowed */}
        {(inputMode === "both" || inputMode === "voice") && (
          <button
            onClick={handleVoiceInput}
            disabled={thinking || scenarioEnded || (!recording && (aiSpeaking || !ttsReady))}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition ${
              recording
                ? "bg-red-500 text-white animate-pulse"
                : "bg-primary text-primary-foreground hover:opacity-90"
            } disabled:opacity-50`}
            title={
              !ttsReady ? "Loading the voice model…"
              : aiSpeaking ? "Wait — the AI is speaking"
              : recording ? "Stop and send" : "Speak"
            }
          >
            {recording ? <MicOff size={20} />
              : !ttsReady ? <Loader2 size={20} className="animate-spin" />
              : aiSpeaking ? <Volume2 size={20} />
              : <Mic size={20} />}
          </button>
        )}

        {/* Text field — hidden in voice-only mode */}
        {(inputMode === "both" || inputMode === "text") && (
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !thinking && sendMessage(input)}
            placeholder={
              inputMode === "text"
                ? "Type your message..."
                : t("ai_conv.placeholder")
            }
            disabled={thinking || recording || scenarioEnded}
            className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
          />
        )}

        {/* Voice-only mode: show a wide status pill instead of the text input */}
        {inputMode === "voice" && (
          <div className="flex flex-1 items-center justify-center rounded-full border border-border bg-muted/30 text-sm text-muted-foreground">
            {!ttsReady ? "Loading voice…" : aiSpeaking ? "AI is speaking…" : recording ? "Listening..." : thinking ? "Thinking..." : "Tap the mic to speak"}
          </div>
        )}

        {/* Send button — only when text is allowed */}
        {(inputMode === "both" || inputMode === "text") && (
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || thinking || scenarioEnded}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>
  )
}
