"use client"

import { useState } from "react"
import { HelpCircle } from "lucide-react"

interface Props {
  text: string
  /** Optional larger title shown above the text. */
  title?: string
  side?: "top" | "bottom"
  size?: number
}

/**
 * A small accessible "?" tooltip. Hover or focus to reveal a hint.
 * Use for contextual guidance next to controls and labels.
 */
export function InfoTip({ text, title, side = "top", size = 14 }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={title ?? "More info"}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v) }}
        className="text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        <HelpCircle size={size} />
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute z-50 w-56 rounded-lg border border-border bg-popover bg-card p-2.5 text-xs text-foreground shadow-xl left-1/2 -translate-x-1/2 ${
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
          }`}
        >
          {title && <span className="mb-0.5 block font-semibold">{title}</span>}
          <span className="block leading-snug text-muted-foreground">{text}</span>
        </span>
      )}
    </span>
  )
}
