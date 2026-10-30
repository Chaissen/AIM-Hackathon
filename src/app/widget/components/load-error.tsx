import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

/** A failed clinic query in place of a whole view or section, with the way to try again without reloading the widget. */
export function LoadError({ title, children, onRetry }: { title: string; children: React.ReactNode; onRetry: () => void }) {
  return (
    <Empty role="alert" className="border border-dashed border-destructive/40">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-destructive/8 text-destructive">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** The one-line form inside a card. `alert` for a failed query, `status` when the server behind it was away. */
export function InlineRetry({ role = "alert", children, onRetry }: { role?: "alert" | "status"; children: React.ReactNode; onRetry: () => void }) {
  return (
    <p role={role} className={cn("flex flex-wrap items-center gap-2 text-sm", role === "alert" ? "text-destructive" : "text-dim")}>
      {children}
      <Button variant="outline" size="xs" onClick={onRetry}>
        Try again
      </Button>
    </p>
  );
}
