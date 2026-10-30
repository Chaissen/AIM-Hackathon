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

export const OPEN_STATES = ["awaiting_confirmation", "sent", "identity_held", "verified", "answer_held"] as const satisfies RequestState[];

export const isOpen = (state: RequestState) => (OPEN_STATES as readonly RequestState[]).includes(state);

/** The link works for the outside person: it went out and the request is still open. */
export const linkIsLive = (state: RequestState) => isOpen(state) && state !== "awaiting_confirmation";

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

/** Three failed identity checks lock the link. */
export const MAX_FAILED_CHECKS = 3;

/** The state a new request starts in, after the address check. */
export const initialState = (addressCheckPassed: boolean): RequestState => (addressCheckPassed ? "sent" : "awaiting_confirmation");

export type RequestEvent =
  | "send_anyway" // Dr. Hofer clicks Send anyway
  // The identity events start only from `sent`. A login in any other state changes no state (docs/IDENTITY.md).
  | "identity_pass"
  | "identity_hold" // partial name, requested name without words, or eHVD unreachable
  | "identity_fail"
  | "accept" // Dr. Hofer accepts a held identity or a held answer
  | "reject" // Dr. Hofer rejects a held identity or a held answer
  | "answer_confirmed" // patient check passed, eHVD confirmed the role
  | "answer_unconfirmed" // patient check passed, eHVD did not confirm the role
  | "patient_mismatch"
  | "cancel"
  | "expire";

const open = (to: RequestState) => Object.fromEntries(OPEN_STATES.map((s) => [s, to])) as Record<(typeof OPEN_STATES)[number], RequestState>;

const TRANSITIONS: Record<RequestEvent, Partial<Record<RequestState, RequestState>>> = {
  send_anyway: { awaiting_confirmation: "sent" },
  identity_pass: { sent: "verified" },
  identity_hold: { sent: "identity_held" },
  // A failed check keeps the state, so the real person can still answer a forwarded link. The third one locks.
  identity_fail: { sent: "sent" },
  accept: { identity_held: "verified", answer_held: "filed" },
  reject: { identity_held: "cancelled", answer_held: "cancelled" },
  answer_confirmed: { verified: "filed" },
  answer_unconfirmed: { verified: "answer_held" },
  patient_mismatch: { verified: "verified" },
  cancel: open("cancelled"),
  expire: open("expired"),
};

/** The four events Dr. Hofer triggers from the widget. */
export type RequesterEvent = Extract<RequestEvent, "send_anyway" | "accept" | "reject" | "cancel">;

export const accepts = (state: RequestState, event: RequestEvent) => TRANSITIONS[event][state] !== undefined;

export class TransitionError extends Error {
  constructor(readonly from: RequestState, readonly event: RequestEvent) {
    super(`A request in state ${from} does not accept ${event}`);
  }
}

/**
 * The state after `event`. `failedChecks` is the number of failed identity checks so far, this one included,
 * so it only matters for `identity_fail`. Throws a TransitionError for an event the state does not accept.
 */
export function transition(from: RequestState, event: RequestEvent, failedChecks = 0): RequestState {
  const to = TRANSITIONS[event][from];
  if (!to) throw new TransitionError(from, event);
  return event === "identity_fail" && failedChecks >= MAX_FAILED_CHECKS ? "locked" : to;
}
