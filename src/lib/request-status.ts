import { accepts, isOpen, REQUEST_STATES, type RequestState } from "@/server/requests/lifecycle";

// How the widget names and groups request states. The overview counts, the request tabs, the sidebar badge, and the
// attention pill all read this one table.

type Bucket = "attention" | "waiting" | "received" | "closed";
export const REQUEST_FILTERS = ["all", "open", "attention", "received", "closed"] as const;
export type RequestFilter = (typeof REQUEST_FILTERS)[number];
type StatusTone = "warning" | "outline" | "success" | "secondary" | "destructive";
export type Status = { label: string; tone: StatusTone; bucket: Bucket };

/** An open request needs Dr. Hofer when its state takes one of her decisions: Send anyway or Accept. */
function bucketOf(state: RequestState): Bucket {
  if (!isOpen(state)) return state === "filed" ? "received" : "closed";
  return accepts(state, "send_anyway") || accepts(state, "accept") ? "attention" : "waiting";
}

const LOOK: Record<RequestState, Omit<Status, "bucket">> = {
  awaiting_confirmation: { label: "Check address", tone: "warning" },
  sent: { label: "Waiting for reply", tone: "outline" },
  identity_held: { label: "Confirm sender", tone: "warning" },
  verified: { label: "Sender confirmed", tone: "outline" },
  answer_held: { label: "Review answer", tone: "warning" },
  filed: { label: "Received", tone: "success" },
  cancelled: { label: "Cancelled", tone: "secondary" },
  expired: { label: "Expired", tone: "secondary" },
  locked: { label: "Locked", tone: "destructive" },
};

export const STATUS = Object.fromEntries(REQUEST_STATES.map((state) => [state, { ...LOOK[state], bucket: bucketOf(state) }])) as Record<
  RequestState,
  Status
>;

export const FILTERS: Record<RequestFilter, { label: string; buckets: readonly Bucket[] }> = {
  all: { label: "All", buckets: ["attention", "waiting", "received", "closed"] },
  open: { label: "Open", buckets: ["attention", "waiting"] },
  attention: { label: "Needs attention", buckets: ["attention"] },
  received: { label: "Received", buckets: ["received"] },
  closed: { label: "Closed", buckets: ["closed"] },
};

export const inFilter = (state: RequestState, filter: RequestFilter) => FILTERS[filter].buckets.includes(STATUS[state].bucket);

export function countByFilter(states: readonly RequestState[]): Record<RequestFilter, number> {
  const counts: Record<RequestFilter, number> = { all: 0, open: 0, attention: 0, received: 0, closed: 0 };
  for (const state of states) for (const filter of REQUEST_FILTERS) if (inFilter(state, filter)) counts[filter]++;
  return counts;
}
