// Finds a bot notice in Dr. Hofer's room that arrived during a run, without comparing clocks: the run remembers the newest
// room event at its start (the mark), and only events newer than the mark count.
import type { MatrixEvent } from "@/server/matrix/client";

export type NoticeScan = { hit?: MatrixEvent; reachedMark: boolean };

// One page of `/messages?dir=b`, newest first. Stops at the mark; a hit after the mark is the newest matching message.
export function scanForNotice(page: MatrixEvent[], markId: string, text: string): NoticeScan {
  for (const event of page) {
    if (event.event_id === markId) return { reachedMark: true };
    if (event.type === "m.room.message" && String(event.content.body ?? "").includes(text)) return { hit: event, reachedMark: false };
  }
  return { reachedMark: false };
}
