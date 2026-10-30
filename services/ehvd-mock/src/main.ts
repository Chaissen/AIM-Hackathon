import { parseConfig, type Config } from "./config.ts";
import { directory } from "./directory.ts";
import { createEhvdServer } from "./server.ts";

const PORT = 8095;

let config: Config;
try {
  config = parseConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// Node running as PID 1 in the container has no default handler for these signals.
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));

createEhvdServer(config).listen(PORT, () => {
  console.log(JSON.stringify({ listening: PORT, entries: directory.length, schemaErrors: config.schemaErrors }));
});
