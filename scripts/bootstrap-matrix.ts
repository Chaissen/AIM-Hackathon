// Creates Dr. Hofer's room (idempotent via alias), joins her and the bot, and pins the ordy widget.
import { env } from "@/env";
import { MatrixClient, roomAlias } from "@/server/matrix/client";

const WIDGET_ID = "ordy-request";

const bot = await MatrixClient.login(env.MATRIX_BOT_USER, env.MATRIX_BOT_PASSWORD);
const hofer = await MatrixClient.login(env.MATRIX_HOFER_USER, env.MATRIX_HOFER_PASSWORD);

const alias = roomAlias();
let roomId = await bot.resolveAlias(alias);
if (!roomId) {
  ({ room_id: roomId } = await bot.createRoom({
    name: "Dr. Hofer · Outside documents",
    topic: "Request documents from outside the network (ordy)",
    room_alias_name: env.MATRIX_ROOM_ALIAS,
    preset: "private_chat",
    invite: [hofer.userId],
  }));
}
await hofer.joinRoom(roomId);

await bot.setState(roomId, "im.vector.modular.widgets", WIDGET_ID, {
  id: WIDGET_ID,
  type: "m.custom",
  name: "Request a document",
  url: `${env.PUBLIC_URL}/widget?widgetId=${WIDGET_ID}&room=$matrix_room_id&user=$matrix_user_id`,
  waitForIframeLoad: false,
  creatorUserId: bot.userId,
  data: {},
});
await bot.setState(roomId, "io.element.widgets.layout", "", {
  widgets: { [WIDGET_ID]: { container: "top", index: 0, width: 100, height: 45 } },
});

console.log(`Room ${alias} (${roomId}) ready, widget points to ${env.PUBLIC_URL}/widget`);
