import assert from "node:assert/strict";
import { test } from "node:test";

import type { MatrixEvent } from "@/server/matrix/client";

import { scanForNotice, threadOf } from "./notice-check";

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

// A later notice about a request is a reply in the thread its "Request … sent" notice started (`notifyRoom`).
const reply = (id: string, body: string, ts: number, root: string): MatrixEvent => {
  const e = event(id, body, ts);
  e.content["m.relates_to"] = { rel_type: "m.thread", event_id: root, is_falling_back: true, "m.in_reply_to": { event_id: root } };
  return e;
};

test("a notice that is a reply in a request's thread counts", () => {
  const page = [reply("$reply", `The answer to request 1 ${TEXT}.`, 3, "$root"), event("$root", "Request 1 sent.", 2), event("$mark", "Earlier.", 1)];
  assert.equal(scanForNotice(page, "$mark", TEXT).hit?.event_id, "$reply");
  assert.equal(scanForNotice(page, "$mark", TEXT, "$root").hit?.event_id, "$reply");
});

test("with a thread root, a matching notice in another thread or outside any thread does not count", () => {
  const page = [
    reply("$other", `The answer to request 2 ${TEXT}.`, 4, "$root2"),
    event("$plain", `The answer to request 1 ${TEXT}.`, 3),
    event("$mark", "Earlier.", 1),
  ];
  assert.deepEqual(scanForNotice(page, "$mark", TEXT, "$root1"), { reachedMark: true });
  assert.equal(scanForNotice(page, "$mark", TEXT).hit?.event_id, "$other");
});

test("the thread of a message is the root it replies to, or its own id", () => {
  assert.equal(threadOf(reply("$r", "x", 1, "$root")), "$root");
  assert.equal(threadOf(event("$root", "x", 1)), "$root");
  // A plain reply (no thread) is not in a thread.
  const plainReply = event("$p", "x", 1);
  plainReply.content["m.relates_to"] = { "m.in_reply_to": { event_id: "$root" } };
  assert.equal(threadOf(plainReply), "$p");
});
