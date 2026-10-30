import type { Server } from "node:http";

// Starts the eHVD mock from services/ehvd-mock (T23) in this process, for the client tests. ordy has no mock of its own.
// The mock runs its TypeScript directly, so it is loaded at runtime and its sources stay outside ordy's tsconfig.

type MockModule = { createEhvdServer(config: unknown, log?: (line: string) => void): Server };
type ConfigModule = { parseConfig(env: Record<string, string>): unknown };

const MOCK = new URL("../../../services/ehvd-mock/src/", import.meta.url);

/** Listens on a free port on 127.0.0.1. `env` takes the mock's variables, for example `EHVD_ALLOWLIST`. */
export async function startEhvdMock(env: Record<string, string> = {}) {
  const { createEhvdServer } = (await import(new URL("server.ts", MOCK).href)) as MockModule;
  const { parseConfig } = (await import(new URL("config.ts", MOCK).href)) as ConfigModule;
  const server = createEhvdServer(parseConfig(env), () => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The eHVD mock is not listening on a port");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
