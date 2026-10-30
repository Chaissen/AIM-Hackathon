// Finds a bot notice in Dr. Hofer's room that arrived during a run, without comparing clocks: the run remembers the newest
// room event at its start (the mark), and only events newer than the mark count.
import type { MatrixEvent } from "@/server/matrix/client";

export type NoticeScan = { hit?: MatrixEvent; reachedMark: boolean };

/**
 * The thread an event belongs to: its own id for a message that is not a reply in a thread (it can be a thread's root),
 * the root's id for a thread reply (`m.relates_to` with `rel_type` `m.thread`, as `notifyRoom` posts them).
 */
export function threadOf(event: MatrixEvent): string {
  const relation = event.content["m.relates_to"] as { rel_type?: unknown; event_id?: unknown } | undefined;
  return relation?.rel_type === "m.thread" && typeof relation.event_id === "string" ? relation.event_id : event.event_id;
}

// One page of `/messages?dir=b`, newest first. Stops at the mark; a hit after the mark is the newest matching message.
// `/messages` returns thread replies in the room timeline too, so a notice in a request's thread counts. With
// `threadRoot`, only the root and the replies in its thread count.
export function scanForNotice(page: MatrixEvent[], markId: string, text: string, threadRoot?: string): NoticeScan {
  for (const event of page) {
    if (event.event_id === markId) return { reachedMark: true };
    if (event.type !== "m.room.message" || !String(event.content.body ?? "").includes(text)) continue;
    if (threadRoot === undefined || threadOf(event) === threadRoot) return { hit: event, reachedMark: false };
  }
  return { reachedMark: false };
}
