import type { Task } from "fhir/r4";

// Request states and transitions. docs/ARCHITECTURE.md, "Request lifecycle", is the source; keep both in step.
export const REQUEST_STATES = [
  "awaiting_confirmation",
  "sent",
  "identity_held",
  "verified",
  "answer_held",
  "filed",
  "cancelled",
  "expired",
  "locked",
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

/** The FHIR Task mirrors the request state (docs/FHIR.md, "Task"). */
export const TASK_STATUS = {
  awaiting_confirmation: "draft",
  sent: "requested",
  identity_held: "on-hold",
  verified: "in-progress",
  answer_held: "on-hold",
  filed: "completed",
  cancelled: "cancelled",
  expired: "failed",
  locked: "failed",
} as const satisfies Record<RequestState, Task["status"]>;

export const taskStatus = (state: RequestState) => TASK_STATUS[state];
