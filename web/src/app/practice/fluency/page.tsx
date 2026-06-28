"use client"

import Link from "next/link"
import { Timer, AudioLines, Drama, ArrowRight, Gauge } from "lucide-react"

const DRILLS = [
  {
    href: "/practice/fluency/monologue",
    icon: Timer,
    title: "4/3/2 Timed Monologue",
    tag: "Automaticity",
    description:
      "Speak on one topic three times — 90s, then 60s, then 40s. Repetition under time pressure builds speed and reduces hesitation. We track how your speech rate rises across rounds.",
    accent: "from-blue-500/20 to-blue-500/5 border-blue-500/30",
  },
  {
    href: "/practice/fluency/shadowing",
    icon: AudioLines,
    title: "Shadowing",
    tag: "Rhythm & prosody",
    description:
      "Listen to a model sentence, then repeat it matching the rhythm and pace. Shadowing trains natural intonation, linking, and connected speech.",
    accent: "from-purple-500/20 to-purple-500/5 border-purple-500/30",
  },
  {
    href: "/practice/conversation?mode=scenarios",
    icon: Drama,
    title: "Scenario Role-play",
    tag: "Real-world",
    description:
      "Practice real situations — ordering coffee, a job interview, a doctor visit — with an AI partner. Complete the goal and get a fluency score.",
    accent: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30",
  },
]

export default function FluencyHubPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-2 flex items-center gap-3">
        <Gauge className="text-primary" size={26} />
        <h1 className="text-2xl font-bold text-foreground">Fluency Drills</h1>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Vocabulary builds <em>what</em> you can say — fluency drills build <em>how smoothly</em> you say it.
        These research-backed exercises train speed, rhythm, and automaticity so you speak without hesitation.
      </p>

      <div className="grid gap-4 sm:grid-cols-1">
        {DRILLS.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className={`group relative overflow-hidden rounded-xl border bg-gradient-to-br ${d.accent} p-5 transition hover:shadow-lg`}
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-background/60">
                <d.icon size={24} className="text-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground">{d.title}</h2>
                  <span className="rounded-full bg-background/60 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                    {d.tag}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{d.description}</p>
              </div>
              <ArrowRight size={18} className="mt-1 shrink-0 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-foreground" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
