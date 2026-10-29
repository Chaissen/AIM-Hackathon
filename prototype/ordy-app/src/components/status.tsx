import { Check, CircleAlert, X, Minus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { STATES, fmtDT, stepsFor } from "@/lib/api"

const TONE: Record<string, string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  hold: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  bad: "bg-red-500/10 text-red-700 dark:text-red-400",
  info: "bg-sky-500/10 text-sky-800 dark:text-sky-300",
  acc: "bg-primary/10 text-primary",
  "": "bg-muted text-muted-foreground",
}

/** Plain-language status for the doctor. */
const LABEL: Record<string, string> = {
  awaiting_confirmation: "Check address",
  sent: "Waiting for reply",
  identity_held: "Confirm sender",
  verified: "Opened",
  answer_held: "Review answer",
  filed: "Received",
  cancelled: "Cancelled",
  expired: "Expired",
  locked: "Locked",
}

export function StatusBadge({ state }: { state: string }) {
  const s = STATES[state]
  return (
    <Badge variant="secondary" className={cn("rounded-md font-medium", TONE[s?.cls ?? ""])}>
      {LABEL[state] ?? state}
    </Badge>
  )
}

export function ToneBadge({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <Badge variant="secondary" className={cn("rounded-md font-medium", TONE[tone])}>
      {children}
    </Badge>
  )
}

export function CheckMark({ res }: { res: string }) {
  const map: Record<string, [React.ElementType, string]> = {
    pass: [Check, "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"],
    hold: [CircleAlert, "bg-amber-500/15 text-amber-700 dark:text-amber-300"],
    fail: [X, "bg-red-500/15 text-red-700 dark:text-red-400"],
  }
  const [Icon, cls] = map[res] ?? [Minus, "bg-muted text-muted-foreground"]
  return (
    <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full", cls)} aria-label={res}>
      <Icon className="size-3" strokeWidth={3} />
    </span>
  )
}

/** Five-step progress: sent, opened, identity, answered, received. */
export function Steps({ r }: { r: any }) {
  const steps = stepsFor(r)
  const label: Record<string, string> = {
    request_sent: "Sent",
    link_opened: "Opened",
    identity_checked: "Sender confirmed",
    answer_sent: "Answered",
    answer_filed: "Received",
  }
  const bar: Record<string, string> = {
    done: "bg-emerald-500",
    now: "bg-primary",
    fail: "bg-red-500",
    hold: "bg-amber-500",
    "": "bg-muted",
  }
  return (
    <ol className="grid grid-cols-5 gap-2">
      {steps.map((s: any) => (
        <li key={s.k} className="grid gap-1.5">
          <span className={cn("h-1.5 rounded-full", bar[s.st])} />
          <span className="text-sm font-medium">{label[s.k]}</span>
          <span className="text-xs text-muted-foreground">
            {s.t ? fmtDT(s.t) : s.st === "now" ? "Waiting" : s.st === "hold" ? "On hold" : s.st === "fail" ? "Blocked" : ""}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function RangeBar({ x }: { x: any }) {
  if (isNaN(x.low) || isNaN(x.high)) return null
  const pos = Math.max(2, Math.min(98, 20 + ((x.value - x.low) / (x.high - x.low)) * 60))
  const out = x.interp === "H" || x.interp === "L"
  return (
    <div
      className="relative h-1.5 w-32 rounded-full bg-[linear-gradient(90deg,var(--color-red-200)_0_20%,var(--color-emerald-200)_20%_80%,var(--color-red-200)_80%)] dark:bg-[linear-gradient(90deg,var(--color-red-950)_0_20%,var(--color-emerald-900)_20%_80%,var(--color-red-950)_80%)]"
      role="img"
      aria-label={`${x.raw ?? x.value} against ${x.rangeText}`}
    >
      <i className={cn("absolute -top-1 h-3.5 w-1 -translate-x-1/2 rounded-full", out ? "bg-red-600" : "bg-foreground")} style={{ left: `${pos}%` }} />
    </div>
  )
}
