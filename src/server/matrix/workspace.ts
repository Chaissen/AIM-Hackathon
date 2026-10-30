import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { roomReference } from "@/lib/workspace";
import { MatrixClient, MatrixError, roomAlias } from "./client";

const roomId = roomReference.refine((value) => value.startsWith("!"));
export type WorkspaceRoom = { id: string; name: string; encrypted: boolean };

const joined = z.object({ joined_rooms: z.array(roomId) });
const state = z.array(z.object({ type: z.string(), state_key: z.string().optional(), content: z.record(z.string(), z.unknown()) }));
const memberContent = z.object({ displayname: z.string().nullish() });
const textContent = z.object({ msgtype: z.enum(["m.text", "m.notice", "m.emote"]), body: z.string() });
const event = z.object({ event_id: z.string(), sender: z.string(), origin_server_ts: z.number().int().nonnegative(), type: z.string(), content: z.unknown() });
const history = z.object({ chunk: z.array(event), end: z.string().optional(), start: z.string().optional() });

export type WorkspaceMessage = { id: string; sender: string; senderName: string; at: Date; body: string; kind: "text" | "notice" | "emote" };
export type WorkspaceTimeline =
  | { kind: "encrypted"; room: WorkspaceRoom }
  | { kind: "timeline"; room: WorkspaceRoom; messages: WorkspaceMessage[]; nextCursor: string | null };

export function workspaceMatrixError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof MatrixError) {
    if (error.status === 401) throw new TRPCError({ code: "UNAUTHORIZED", message: "Your network sign-in expired. Sign in again." });
    if (error.status === 403) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this room." });
    if (error.status === 404) throw new TRPCError({ code: "NOT_FOUND", message: "This room is not available." });
    if (error.status === 429) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "The network is busy. Try again shortly." });
  }
  throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Messages are unavailable. Try again shortly." });
}

async function joinedRoomIds(client: MatrixClient): Promise<string[]> {
  return joined.parse(await client.request<unknown>("GET", "/_matrix/client/v3/joined_rooms")).joined_rooms;
}

async function resolveRoom(client: MatrixClient, reference: string, rooms: string[]): Promise<string> {
  const id = reference.startsWith("#")
    ? z.object({ room_id: roomId }).parse(await client.request<unknown>("GET", `/_matrix/client/v3/directory/room/${encodeURIComponent(reference)}`)).room_id
    : reference;
  if (!rooms.includes(id)) throw new TRPCError({ code: "FORBIDDEN", message: "Choose a room you have joined." });
  return id;
}

async function describeRoom(client: MatrixClient, id: string) {
  const events = state.parse(await client.request<unknown>("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(id)}/state`));
  const name = z.object({ name: z.string() }).safeParse(events.find((entry) => entry.type === "m.room.name")?.content).data?.name;
  const members = new Map<string, string>();
  for (const entry of events.filter((entry) => entry.type === "m.room.member")) {
    const content = memberContent.safeParse(entry.content).data;
    if (entry.state_key && content?.displayname) members.set(entry.state_key, content.displayname.slice(0, 100));
  }
  return { room: { id, name: name || id, encrypted: events.some((entry) => entry.type === "m.room.encryption") }, members };
}

export async function workspaceRooms(client: MatrixClient): Promise<{ rooms: WorkspaceRoom[]; defaultRoomId: string | null }> {
  const ids = await joinedRoomIds(client);
  const rooms = await Promise.all(ids.map(async (id) => (await describeRoom(client, id)).room));
  rooms.sort((a, b) => a.name.localeCompare(b.name));
  let preferred: string | null = null;
  try {
    preferred = await resolveRoom(client, roomAlias(), ids);
  } catch (error) {
    if (!(error instanceof MatrixError && error.status === 404) && !(error instanceof TRPCError && error.code === "FORBIDDEN")) throw error;
  }
  return { rooms, defaultRoomId: preferred ?? rooms[0]?.id ?? null };
}

export async function workspaceTimeline(client: MatrixClient, reference: string, cursor?: string): Promise<WorkspaceTimeline> {
  const id = await resolveRoom(client, reference, await joinedRoomIds(client));
  const description = await describeRoom(client, id);
  if (description.room.encrypted) return { kind: "encrypted", room: description.room };
  const query = new URLSearchParams({ dir: "b", limit: "50" });
  if (cursor) query.set("from", cursor);
  const page = history.parse(await client.request<unknown>("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(id)}/messages?${query}`));
  const messages = page.chunk.flatMap((entry): WorkspaceMessage[] => {
    if (entry.type !== "m.room.message") return [];
    const content = textContent.safeParse(entry.content);
    if (!content.success) return [];
    return [{
      id: entry.event_id,
      sender: entry.sender,
      senderName: description.members.get(entry.sender) ?? entry.sender,
      at: new Date(entry.origin_server_ts),
      body: content.data.body,
      kind: content.data.msgtype === "m.notice" ? "notice" : content.data.msgtype === "m.emote" ? "emote" : "text",
    }];
  }).reverse();
  const reachedStart = page.chunk.some((entry) => entry.type === "m.room.create");
  return { kind: "timeline", room: description.room, messages, nextCursor: !reachedStart && page.chunk.length > 0 && page.end && page.end !== cursor ? page.end : null };
}

export async function sendWorkspaceMessage(client: MatrixClient, input: { room: string; body: string; transactionId: string }) {
  const id = await resolveRoom(client, input.room, await joinedRoomIds(client));
  const description = await describeRoom(client, id);
  if (description.room.encrypted) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This room uses encryption. ordy cannot send messages to encrypted rooms." });
  const result = z.object({ event_id: z.string() }).parse(await client.request<unknown>(
    "PUT",
    `/_matrix/client/v3/rooms/${encodeURIComponent(id)}/send/m.room.message/${encodeURIComponent(input.transactionId)}`,
    { msgtype: "m.text", body: input.body },
  ));
  return { eventId: result.event_id };
}
