import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseEnv } from "node:util";

import { setupEnv } from "./setup-env";

test("setup creates unique private keys and preserves them across reruns", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ordy-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const example = join(directory, "example");
  await writeFile(example, "PUBLIC_URL=http://localhost:3010\nORDY_SECRET=\n");
  const first = join(directory, "first");
  const second = join(directory, "second");
  await setupEnv(first, example);
  await setupEnv(second, example);
  const original = await readFile(first, "utf8");
  const firstKey = parseEnv(original).ORDY_SECRET;
  assert.match(firstKey ?? "", /^[a-f0-9]{64}$/);
  assert.notEqual(firstKey, parseEnv(await readFile(second, "utf8")).ORDY_SECRET);
  assert.equal((await stat(first)).mode & 0o777, 0o600);
  await setupEnv(first, example);
  assert.equal(await readFile(first, "utf8"), original);
});

test("setup upgrades unsafe keys while preserving other local settings", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ordy-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, ".env");
  for (const oldKey of ["", "ordy-dev-secret-change-me", "change-me-to-a-long-random-string", "short"]) {
    await writeFile(file, `# Keep this comment\nPUBLIC_URL=http://localhost:3999\nORDY_SECRET=${oldKey}\n`);
    await setupEnv(file, "unused");
    const updated = await readFile(file, "utf8");
    assert.match(updated, /# Keep this comment/);
    assert.equal(parseEnv(updated).PUBLIC_URL, "http://localhost:3999");
    assert.match(parseEnv(updated).ORDY_SECRET ?? "", /^[a-f0-9]{64}$/);
  }
  await writeFile(file, "PUBLIC_URL=http://localhost:3999\n");
  await setupEnv(file, "unused");
  assert.match(parseEnv(await readFile(file, "utf8")).ORDY_SECRET ?? "", /^[a-f0-9]{64}$/);
});
