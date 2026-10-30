import { and, eq, isNull } from "drizzle-orm";

import { db as appDb, type Db } from "@/server/db";
import { requests } from "@/server/db/schema";
import { getBotClient, roomAlias } from "@/server/matrix/client";
import { type Notice, notifyRoom } from "@/server/matrix/notices";
import type { RequestRow } from "./service";

/** Where a notice goes. Tests swap these for stand-ins, so they post nothing in Matrix. */
export const notifyDeps = {
  db: appDb as Db,
  post: notifyRoom,
  /** The room `MATRIX_ROOM_ALIAS` names: Dr. Hofer's room. */
  room: async () => {
    const room = await (await getBotClient()).resolveAlias(roomAlias());
    if (!room) throw new Error(`room ${roomAlias()} does not exist`);
    return room;
  },
};

/**
 * Posts a notice about a request in Dr. Hofer's room. The request's first notice, normally "Request … sent", starts the
 * request's thread in the room `MATRIX_ROOM_ALIAS` names, and its room and event id go into `matrix_room` and
 * `matrix_event`. Every later notice goes into that thread. The thread is read from the database, so a caller with a row
 * read before the thread started still posts into it.
 *
 * A failed notice is logged and never changes the request or what the outside person sees, so this never throws. If the
 * first notice fails, the next one starts the thread.
 */
export async function notifyRequest(request: Pick<RequestRow, "id" | "matrixRoom" | "matrixEvent">, notice: Notice): Promise<void> {
  const { db, post, room } = notifyDeps;
  try {
    const [stored] = await db
      .select({ matrixRoom: requests.matrixRoom, matrixEvent: requests.matrixEvent })
      .from(requests)
      .where(eq(requests.id, request.id));
    const thread = stored ?? request;
    if (thread.matrixRoom && thread.matrixEvent) {
      await post(thread.matrixRoom, notice, thread.matrixEvent);
      return;
    }
    const roomId = thread.matrixRoom ?? (await room());
    const eventId = await post(roomId, notice);
    // Only if no other notice started the thread in the meantime. Then this one stays a message of its own in the room.
    await db
      .update(requests)
      .set({ matrixRoom: roomId, matrixEvent: eventId })
      .where(and(eq(requests.id, request.id), isNull(requests.matrixEvent)));
  } catch (error) {
    // Only the request id and the kind: names stay out of the application log.
    console.error(`notice ${notice.kind} for request ${request.id} failed:`, error instanceof Error ? error.message : error);
  }
}
