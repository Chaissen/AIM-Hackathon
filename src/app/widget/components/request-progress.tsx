import { Time } from "@/components/time";
import type { ProgressStep, StepStatus } from "@/lib/request-story";
import { cn } from "@/lib/utils";

const BAR: Record<StepStatus, string> = {
  done: "bg-success",
  current: "bg-primary",
  held: "bg-warning",
  blocked: "bg-destructive",
  todo: "bg-muted",
};

/** What a step without a time says under its label. A done step shows its time instead. */
const STATE_TEXT: Record<StepStatus, string | null> = {
  done: null,
  current: "Waiting",
  held: "On hold",
  blocked: "Blocked",
  todo: null,
};

/** The five steps from `progressOf`: a row of bars from 32rem of container width, a column with a bar per step below. */
export function RequestProgress({ steps }: { steps: readonly ProgressStep[] }) {
  return (
    <ol className="grid gap-3 @lg/main:grid-cols-5 @lg/main:gap-2" aria-label="Progress">
      {steps.map((step) => (
        <li key={step.key} className="grid grid-cols-[0.375rem_1fr] content-start gap-x-3 @lg/main:grid-cols-1 @lg/main:gap-1.5">
          <span className={cn("w-1.5 @lg/main:h-1.5 @lg/main:w-auto", BAR[step.status])} aria-hidden />
          <div className="grid gap-0.5">
            <span className={cn("text-sm font-medium", step.status === "todo" ? "text-muted-foreground" : "text-loud")}>{step.label}</span>
            <span className="text-xs text-muted-foreground">
              {step.at ? <Time at={step.at} /> : STATE_TEXT[step.status]}
            </span>
            {step.note && <span className="text-xs text-dim">{step.note}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
