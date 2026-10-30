import assert from "node:assert/strict";
import { test } from "node:test";

import type { MatrixEvent } from "@/server/matrix/client";

import { scanForNotice } from "./notice-check";

const event = (id: string, body: string, ts: number, type = "m.room.message"): MatrixEvent => ({
  type,
  event_id: id,
  sender: "@ordy:klinikum.example",
  origin_server_ts: ts,
  content: { msgtype: "m.notice", body },
});
const TEXT = "is about a different patient";

test("a notice newer than the mark counts, whatever its timestamp says", () => {
  // Synapse's clock lags: the new notice has an older timestamp than the mark.
  const page = [event("$new", `The answer to request 1 ${TEXT}.`, 1_000), event("$mark", "Request 1 sent.", 5_000)];
  assert.equal(scanForNotice(page, "$mark", TEXT).hit?.event_id, "$new");
});

test("a notice from before the mark does not count", () => {
  const page = [event("$other", "Request 2 sent.", 9_000), event("$mark", "Request 1 sent.", 8_000), event("$old", `Old: ${TEXT}.`, 7_000)];
  assert.deepEqual(scanForNotice(page, "$mark", TEXT), { reachedMark: true });
});

test("a page without the mark and without the notice asks for the next page", () => {
  const page = [event("$a", "Request 2 sent.", 2), event("$b", `${TEXT}`, 1, "m.reaction")];
  assert.deepEqual(scanForNotice(page, "$mark", TEXT), { reachedMark: false });
});
