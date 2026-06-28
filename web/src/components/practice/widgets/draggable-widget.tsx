"use client"

import { type ReactNode } from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, X } from "lucide-react"

interface DraggableWidgetProps {
  id: string
  title: string
  removable: boolean
  onRemove?: () => void
  children: ReactNode
  className?: string
}

export function DraggableWidget({ id, title, removable, onRemove, children, className = "" }: DraggableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-card text-card-foreground border border-border rounded-xl shadow-sm overflow-hidden transition-shadow hover:shadow-md ${className}`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <button
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors touch-none"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} />
          </button>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {removable && onRemove && (
          <button
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive transition-colors"
            aria-label={`Remove ${title}`}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}
