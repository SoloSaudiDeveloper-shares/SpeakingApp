"use client"

import { type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils/cn"

interface CollapsibleWidgetProps {
  id: string
  title: string
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
  className?: string
  tone?: "action" | "progress"
}

export function CollapsibleWidget({ id, title, collapsed, onToggle, children, className = "", tone = "progress" }: CollapsibleWidgetProps) {
  return (
    <section className={cn(
      "overflow-hidden rounded-xl border shadow-sm",
      tone === "action" ? "border-primary/35 bg-card shadow-primary/10" : "border-border/70 bg-card/60",
      className,
    )}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={`${id}-content`}
        className={cn(
          "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition",
          tone === "action" ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/40",
          !collapsed && "border-b border-border/70",
        )}
      >
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <ChevronDown size={16} className={cn("shrink-0 text-muted-foreground transition-transform", collapsed && "-rotate-90")} />
      </button>
      {!collapsed && <div id={`${id}-content`} className="p-4">{children}</div>}
    </section>
  )
}
