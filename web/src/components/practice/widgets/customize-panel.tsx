"use client"

import { useEffect, useRef } from "react"
import { X, RotateCcw } from "lucide-react"
import { AVAILABLE_WIDGETS, DEFAULT_LAYOUT, type WidgetId } from "./widget-types"
import { Switch } from "@/components/shared/switch"

interface CustomizePanelProps {
  isOpen: boolean
  onClose: () => void
  activeWidgets: WidgetId[]
  onToggle: (id: WidgetId) => void
  onReset: () => void
}

export function CustomizePanel({ isOpen, onClose, activeWidgets, onToggle, onReset }: CustomizePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown)
      return () => document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen, onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-sm bg-card border-l border-border shadow-xl transition-transform duration-300 ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Customize Dashboard</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto" style={{ maxHeight: "calc(100vh - 130px)" }}>
          {AVAILABLE_WIDGETS.map((widget) => {
            const isActive = activeWidgets.includes(widget.id)
            return (
              <div
                key={widget.id}
                className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <div className={`h-2.5 w-2.5 rounded-full ${isActive ? "bg-emerald-400" : "bg-muted-foreground/30"}`} />
                  <div>
                    <p className="text-sm font-medium text-foreground">{widget.title}</p>
                    <p className="text-xs text-muted-foreground">{widget.description}</p>
                  </div>
                </div>
                <Switch
                  checked={isActive}
                  onCheckedChange={() => onToggle(widget.id)}
                  disabled={!widget.removable && isActive}
                  ariaLabel={`Toggle ${widget.title}`}
                />
              </div>
            )
          })}
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border bg-card">
          <button
            onClick={onReset}
            className="flex items-center gap-2 w-full justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <RotateCcw size={14} />
            Reset to Default
          </button>
        </div>
      </div>
    </>
  )
}
