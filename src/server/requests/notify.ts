import { getBotClient, roomAlias } from "@/server/matrix/client";
import { type Notice, notifyRoom } from "@/server/matrix/notices";
import type { RequestRow } from "./service";

/**
 * Posts a notice about a request in Dr. Hofer's room: in the request's thread if it has one, otherwise as a new message
 * in the room `MATRIX_ROOM_ALIAS` names. A failed notice is logged and never changes what the outside person sees,
 * so this never throws.
 */
export async function notifyRequest(request: Pick<RequestRow, "id" | "matrixRoom" | "matrixEvent">, notice: Notice): Promise<void> {
  try {
    const room = request.matrixRoom ?? (await (await getBotClient()).resolveAlias(roomAlias()));
    if (!room) throw new Error(`room ${roomAlias()} does not exist`);
    await notifyRoom(room, notice, (request.matrixRoom && request.matrixEvent) || undefined);
  } catch (error) {
    // Only the request id and the kind: names stay out of the application log.
    console.error(`notice ${notice.kind} for request ${request.id} failed:`, error instanceof Error ? error.message : error);
  }
}
