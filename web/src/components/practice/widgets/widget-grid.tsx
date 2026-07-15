"use client"

import { CollapsibleWidget } from "./draggable-widget"
import { AVAILABLE_WIDGETS, type WidgetId, type PracticeData } from "./widget-types"
import { QuickPracticeWidget } from "./quick-practice-widget"
import { SpeakingProfileWidget } from "./speaking-profile-widget"
import { StatsWidget } from "./stats-widget"
import { StagesWidget } from "./stages-widget"
import { MasteryWidget } from "./mastery-widget"
import { RecentAttemptsWidget } from "./recent-attempts-widget"
import { AiCoachWidget } from "./ai-coach-widget"
import { KlpFocusWidget } from "./klp-focus-widget"
import { StreaksWidget } from "./streaks-widget"
import { LeaderboardWidget } from "./leaderboard-widget"

interface WidgetGridProps {
  widgets: WidgetId[]
  collapsed: string[]
  onToggle: (id: string) => void
  practiceData: PracticeData
  tone?: "action" | "progress"
}

function getWidgetContent(id: WidgetId, data: PracticeData) {
  switch (id) {
    case "quick-practice": return <QuickPracticeWidget data={data} />
    case "speaking-profile": return <SpeakingProfileWidget data={data} />
    case "stats": return <StatsWidget data={data} />
    case "stages": return <StagesWidget data={data} />
    case "mastery": return <MasteryWidget data={data} />
    case "recent-attempts": return <RecentAttemptsWidget data={data} />
    case "ai-coach": return <AiCoachWidget data={data} />
    case "klp-focus": return <KlpFocusWidget data={data} />
    case "streaks": return <StreaksWidget data={data} />
    case "leaderboard": return <LeaderboardWidget />
  }
}

export function WidgetGrid({ widgets, collapsed, onToggle, practiceData, tone = "progress" }: WidgetGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {widgets.map((widgetId) => {
        const config = AVAILABLE_WIDGETS.find((widget) => widget.id === widgetId)
        if (!config) return null
        return (
          <CollapsibleWidget
            key={widgetId}
            id={widgetId}
            title={config.title}
            collapsed={collapsed.includes(widgetId)}
            onToggle={() => onToggle(widgetId)}
            tone={tone}
            className={config.defaultSize === "large" ? "md:col-span-2" : ""}
          >
            {getWidgetContent(widgetId, practiceData)}
          </CollapsibleWidget>
        )
      })}
    </div>
  )
}
