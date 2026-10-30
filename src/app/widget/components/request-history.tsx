import { Check, CircleAlert, type LucideIcon, Minus, X } from "lucide-react";

import { Time } from "@/components/time";
import type { HistoryLine, Tone } from "@/lib/request-story";
import { cn } from "@/lib/utils";

const MARK: Record<Tone, { icon: LucideIcon; className: string; label: string | null }> = {
  pass: { icon: Check, className: "bg-success/15 text-success", label: "passed" },
  hold: { icon: CircleAlert, className: "bg-warning/15 text-warning", label: "held" },
  fail: { icon: X, className: "bg-destructive/15 text-destructive", label: "failed" },
  none: { icon: Minus, className: "bg-muted text-muted-foreground", label: null },
};

/** A small disc that says how a step or a check went. The `none` tone is decoration only. */
export function ToneMark({ tone, className }: { tone: Tone; className?: string }) {
  const { icon: Icon, className: look, label } = MARK[tone];
  return (
    <span
      className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full", look, className)}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <Icon className="size-3" strokeWidth={3} />
    </span>
  );
}

/** The request's story, newest first, as `historyOf` tells it. */
export function RequestHistory({ lines }: { lines: readonly HistoryLine[] }) {
  if (lines.length === 0) return <p className="text-sm text-dim">Nothing has happened yet.</p>;
  return (
    <ol className="grid gap-3">
      {lines.map((line) => (
        <li key={line.id} className="grid grid-cols-[1.25rem_1fr] gap-3 text-sm">
          <ToneMark tone={line.tone} />
          <div className="grid gap-0.5">
            <span>{line.text}</span>
            <Time at={line.at} className="text-xs text-muted-foreground" />
          </div>
        </li>
      ))}
    </ol>
  );
}
