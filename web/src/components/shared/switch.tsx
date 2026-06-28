"use client"

import { cn } from "@/lib/utils/cn"

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  ariaLabel: string
  className?: string
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  ariaLabel,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        checked ? "bg-primary" : "bg-muted",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  )
}
