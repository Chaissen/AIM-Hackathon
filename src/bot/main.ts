import { env } from "@/env";
import { createCaller } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import { getBotClient, type MatrixClient, type MatrixEvent } from "@/server/matrix/client";
import { commands } from "./commands";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handle(client: MatrixClient, roomId: string, ev: MatrixEvent) {
  const body = ev.type === "m.room.message" ? ev.content.body : undefined;
  if (typeof body !== "string" || !body.startsWith("!") || ev.sender === client.userId) return;
  // Closed network: only members of our homeserver may give commands.
  if (!ev.sender.endsWith(`:${env.MATRIX_SERVER_NAME}`)) return;

  const [, name = "", args = ""] = body.match(/^!(\S+)\s*([\s\S]*)$/) ?? [];
  const command = commands[name.toLowerCase()];
  if (!command) {
    await client.sendMessage(roomId, `Unknown command !${name}. !help lists all commands.`);
    return;
  }
  try {
    // Same procedures as the widget, called in-process with the sender as clinic actor.
    const reply = await command.run(createCaller(createContext({ kind: "clinic", mxid: ev.sender })), args.trim());
    await client.sendMessage(roomId, reply.text, reply.html);
  } catch (e) {
    console.error(`!${name} failed`, e);
    await client.sendMessage(roomId, `!${name} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  const client = await getBotClient();
  const initial = await client.sync(undefined, 0);
  let since = initial.next_batch;
  for (const roomId of Object.keys(initial.rooms?.invite ?? {})) await client.joinRoom(roomId);
  console.log(`ordy bot running as ${client.userId}`);

  for (;;) {
    try {
      const res = await client.sync(since);
      since = res.next_batch;
      for (const roomId of Object.keys(res.rooms?.invite ?? {})) await client.joinRoom(roomId);
      for (const [roomId, room] of Object.entries(res.rooms?.join ?? {}))
        for (const ev of room.timeline?.events ?? []) await handle(client, roomId, ev);
    } catch (e) {
      console.error("Sync failed, retrying in 3 s:", e instanceof Error ? e.message : e);
      await sleep(3_000);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

main().catch((e) => {
  console.error("ordy bot could not start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
