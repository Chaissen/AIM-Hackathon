import { createCaller } from "@/server/api/root";

type Caller = ReturnType<typeof createCaller>;
export type Reply = { text: string; html?: string };
type Command = { usage: string; help: string; run: (caller: Caller, args: string) => Promise<Reply> };

// Planned (organisations/ARCHITECTURE.md, "Matrix bot"): !request, !send, !accept, !reject, !cancel, !status <id>.
export const commands: Record<string, Command> = {
  help: {
    usage: "!help",
    help: "lists the commands",
    run: async () => ({
      text: Object.values(commands).map((c) => `${c.usage}: ${c.help}`).join("\n"),
      html: `<ul>${Object.values(commands).map((c) => `<li><code>${c.usage}</code>: ${c.help}</li>`).join("")}</ul>`,
    }),
  },
  status: {
    usage: "!status",
    help: "checks the database, the FHIR server and Matrix",
    run: async (caller) => {
      const h = await caller.health.check();
      const rows = [
        ["Database", h.database],
        ["FHIR server", h.fhir],
        ["Matrix", h.matrix],
      ] as const;
      return { text: rows.map(([label, c]) => `${c.ok ? "✅" : "❌"} ${label}: ${c.detail}`).join("\n") };
    },
  },
};
