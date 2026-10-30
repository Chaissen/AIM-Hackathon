import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { env } from "@/env";
import { createCaller } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import { MatrixClient } from "./client";
import { sendWorkspaceMessage, workspaceMatrixError, workspaceRooms, workspaceTimeline } from "./workspace";

const user = "@lena.hofer:klinikum.example";
const roomId = "!opaque-room-id";
const encryptedRoom = "!old-room:klinikum.example";
const alias = `#${env.MATRIX_ROOM_ALIAS}:${env.MATRIX_SERVER_NAME}`;
const sent = new Map<string, { id: string; body: unknown }>();
let unavailableState = false;
let client: MatrixClient;
let serverUrl: string;

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  const reply = (status: number, body: unknown) => { response.statusCode = status; response.end(JSON.stringify(body)); };
  if (request.headers.authorization !== "Bearer test-user-token") return reply(401, { errcode: "M_UNKNOWN_TOKEN", error: "secret user token" });
  const url = new URL(request.url ?? "/", "http://matrix.test");
  if (url.pathname === "/_matrix/client/v3/joined_rooms") return reply(200, { joined_rooms: [encryptedRoom, roomId] });
  if (url.pathname.startsWith("/_matrix/client/v3/directory/room/")) {
    const requestedAlias = decodeURIComponent(url.pathname.slice("/_matrix/client/v3/directory/room/".length));
    return requestedAlias === alias ? reply(200, { room_id: roomId }) : reply(404, { errcode: "M_NOT_FOUND", error: "private detail" });
  }
  const parts = url.pathname.split("/");
  const requestedRoom = decodeURIComponent(parts[5] ?? "");
  if (parts[6] === "state") {
    if (unavailableState) return reply(500, { errcode: "M_UNKNOWN", error: "sensitive state lookup failure" });
    return reply(200, [
      { type: "m.room.name", state_key: "", content: { name: requestedRoom === roomId ? "Outside documents" : "Private encrypted room" } },
      { type: "m.room.member", state_key: user, content: { displayname: "Dr. Lena Hofer", membership: "join" } },
      { type: "m.room.member", state_key: "@ordy:klinikum.example", content: { displayname: null, membership: "join" } },
      ...(requestedRoom === encryptedRoom ? [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }] : []),
    ]);
  }
  if (parts[6] === "messages") {
    assert.equal(url.searchParams.get("dir"), "b");
    assert.equal(url.searchParams.get("limit"), "50");
    if (url.searchParams.get("from") === "empty-oldest") return reply(200, { chunk: [], start: "empty-oldest", end: "empty-oldest" });
    if (url.searchParams.get("from") === "creation") return reply(200, { chunk: [{ type: "m.room.create", event_id: "$create", sender: user, origin_server_ts: 0, content: {} }], end: "before-creation" });
    if (url.searchParams.get("from") === "unsupported") return reply(200, { chunk: [{ type: "m.room.encrypted", event_id: "$encrypted", sender: user, origin_server_ts: 123, content: {} }], end: "older-than-unsupported" });
    return reply(200, {
      start: "recent", end: "older",
      chunk: [
        { type: "m.room.message", event_id: "$later", sender: user, origin_server_ts: 2000, content: { msgtype: "m.text", body: "<b>plain text only</b>", formatted_body: "<script>do not render</script>" } },
        { type: "m.room.message", event_id: "$earlier", sender: "@ordy:klinikum.example", origin_server_ts: 1000, content: { msgtype: "m.notice", body: "A document arrived" } },
      ],
    });
  }
  if (parts[6] === "send") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
    const transactionId = decodeURIComponent(parts[8] ?? "");
    const existing = sent.get(transactionId);
    if (existing) return reply(200, { event_id: existing.id });
    const entry = { id: `$sent-${sent.size + 1}`, body };
    sent.set(transactionId, entry);
    return reply(200, { event_id: entry.id });
  }
  return reply(404, { errcode: "M_NOT_FOUND", error: "No fixture" });
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  serverUrl = `http://127.0.0.1:${address.port}`;
  client = new MatrixClient(serverUrl, "test-user-token", user);
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("rooms contains only joined rooms and selects the configured joined alias", async () => {
  assert.deepEqual(await workspaceRooms(client), {
    rooms: [
      { id: roomId, name: "Outside documents", encrypted: false },
      { id: encryptedRoom, name: "Private encrypted room", encrypted: true },
    ],
    defaultRoomId: roomId,
  });
});

test("text and notices arrive oldest first without rendering Matrix HTML, with history cursors retained", async () => {
  assert.deepEqual(await workspaceTimeline(client, alias), {
    kind: "timeline",
    room: { id: roomId, name: "Outside documents", encrypted: false },
    messages: [
      { id: "$earlier", sender: "@ordy:klinikum.example", senderName: "@ordy:klinikum.example", at: new Date(1000), body: "A document arrived", kind: "notice" },
      { id: "$later", sender: user, senderName: "Dr. Lena Hofer", at: new Date(2000), body: "<b>plain text only</b>", kind: "text" },
    ],
    nextCursor: "older",
  });
  assert.deepEqual(await workspaceTimeline(client, roomId, "unsupported"), {
    kind: "timeline", room: { id: roomId, name: "Outside documents", encrypted: false }, messages: [], nextCursor: "older-than-unsupported",
  });
  assert.deepEqual(await workspaceTimeline(client, roomId, "empty-oldest"), {
    kind: "timeline", room: { id: roomId, name: "Outside documents", encrypted: false }, messages: [], nextCursor: null,
  });
  assert.deepEqual(await workspaceTimeline(client, roomId, "creation"), {
    kind: "timeline", room: { id: roomId, name: "Outside documents", encrypted: false }, messages: [], nextCursor: null,
  });
});

test("the app refuses unjoined and encrypted-room sends and fails closed when encryption state cannot be read", async () => {
  await assert.rejects(workspaceTimeline(client, "!unjoined-room"), { code: "FORBIDDEN" });
  assert.deepEqual(await workspaceTimeline(client, encryptedRoom), { kind: "encrypted", room: { id: encryptedRoom, name: "Private encrypted room", encrypted: true } });
  await assert.rejects(sendWorkspaceMessage(client, { room: encryptedRoom, body: "do not send", transactionId: "encrypted" }), { code: "PRECONDITION_FAILED" });
  unavailableState = true;
  try {
    await assert.rejects(sendWorkspaceMessage(client, { room: roomId, body: "do not send", transactionId: "unreadable" }).catch(workspaceMatrixError), { code: "SERVICE_UNAVAILABLE", message: "Messages are unavailable. Try again shortly." });
  } finally { unavailableState = false; }
  assert.equal(sent.size, 0);
});

test("a retried send keeps its transaction identity and sends the user's bounded plaintext through the router", async () => {
  const caller = createCaller(createContext({ kind: "clinic", mxid: user }, client));
  const input = { room: roomId, body: "  Hello from ordy  ", transactionId: "a2f1420a-328d-4ea0-9ce6-17835cc12f48" };
  assert.deepEqual(await caller.chat.send(input), { eventId: "$sent-1" });
  assert.deepEqual(await caller.chat.send(input), { eventId: "$sent-1" });
  assert.deepEqual([...sent.values()], [{ id: "$sent-1", body: { msgtype: "m.text", body: "Hello from ordy" } }]);
  for (const actor of [{ kind: "anonymous" }, { kind: "clinic", mxid: user }] as const) {
    await assert.rejects(createCaller(createContext(actor)).chat.rooms(), { code: "UNAUTHORIZED" });
  }
  const invalid = createCaller(createContext({ kind: "clinic", mxid: user }, new MatrixClient(serverUrl, "revoked-token", user)));
  await assert.rejects(invalid.chat.rooms(), { code: "UNAUTHORIZED", message: "Your network sign-in expired. Sign in again." });
});
