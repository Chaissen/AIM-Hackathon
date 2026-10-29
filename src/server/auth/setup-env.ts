import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";

import { sessionSecret } from "./session-secret";

/** Initialize or upgrade the local session key without printing it or changing other settings. */
export async function setupEnv(envPath: string, examplePath: string): Promise<void> {
  let content: string;
  let creating = false;
  try {
    content = await readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    creating = true;
    content = await readFile(examplePath, "utf8");
  }

  if (creating || !sessionSecret.safeParse(parseEnv(content).ORDY_SECRET).success) {
    const assignment = `ORDY_SECRET=${randomBytes(32).toString("hex")}`;
    const line = /^[\t ]*(?:export[\t ]+)?ORDY_SECRET[\t ]*=.*$/gm;
    content = line.test(content) ? content.replace(line, assignment) : `${content.trimEnd()}\n${assignment}\n`;
    // Restrict an existing file before writing the new secret, not just after the write.
    await chmod(envPath, 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await writeFile(envPath, content, { mode: 0o600 });
  }
  await chmod(envPath, 0o600);
}
