import { Badge } from "@/components/ui/badge";
import { STATUS } from "@/lib/request-status";
import type { RequestState } from "@/server/requests/lifecycle";

export function StatusBadge({ state, className }: { state: RequestState; className?: string }) {
  const { label, tone } = STATUS[state];
  return (
    <Badge variant={tone} className={className}>
      {label}
    </Badge>
  );
}
