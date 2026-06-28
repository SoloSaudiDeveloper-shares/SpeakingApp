"use client"

import { DndContext, closestCenter, type DragEndEvent, PointerSensor, useSensor, useSensors, TouchSensor } from "@dnd-kit/core"
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable"
import { DraggableWidget } from "./draggable-widget"
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
  activeWidgets: WidgetId[]
  onReorder: (widgets: WidgetId[]) => void
  onRemove: (id: WidgetId) => void
  practiceData: PracticeData
}

function getWidgetContent(id: WidgetId, data: PracticeData) {
  switch (id) {
    case "quick-practice":
      return <QuickPracticeWidget data={data} />
    case "speaking-profile":
      return <SpeakingProfileWidget data={data} />
    case "stats":
      return <StatsWidget data={data} />
    case "stages":
      return <StagesWidget data={data} />
    case "mastery":
      return <MasteryWidget data={data} />
    case "recent-attempts":
      return <RecentAttemptsWidget data={data} />
    case "ai-coach":
      return <AiCoachWidget data={data} />
    case "klp-focus":
      return <KlpFocusWidget data={data} />
    case "streaks":
      return <StreaksWidget data={data} />
    case "leaderboard":
      return <LeaderboardWidget />
    default:
      return null
  }
}

export function WidgetGrid({ activeWidgets, onReorder, onRemove, practiceData }: WidgetGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = activeWidgets.indexOf(active.id as WidgetId)
    const newIndex = activeWidgets.indexOf(over.id as WidgetId)
    if (oldIndex === -1 || newIndex === -1) return

    const updated = [...activeWidgets]
    updated.splice(oldIndex, 1)
    updated.splice(newIndex, 0, active.id as WidgetId)
    onReorder(updated)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={activeWidgets} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeWidgets.map((widgetId) => {
            const config = AVAILABLE_WIDGETS.find((w) => w.id === widgetId)
            if (!config) return null
            const isLarge = config.defaultSize === "large"
            return (
              <DraggableWidget
                key={widgetId}
                id={widgetId}
                title={config.title}
                removable={config.removable}
                onRemove={() => onRemove(widgetId)}
                className={isLarge ? "md:col-span-2" : ""}
              >
                {getWidgetContent(widgetId, practiceData)}
              </DraggableWidget>
            )
          })}
        </div>
      </SortableContext>
    </DndContext>
  )
}
