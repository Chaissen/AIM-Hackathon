import assert from "node:assert/strict";
import { test } from "node:test";

import { allows, parseConfig } from "../src/config.ts";

test("the default allowlist admits loopback and the private networks of Docker and colima only", () => {
  const { allowlist } = parseConfig({});
  for (const address of ["127.0.0.1", "::1", "10.0.2.2", "172.18.0.1", "192.168.5.2", "fd00::2"]) {
    assert.equal(allows(allowlist.GetGDA, address) && allows(allowlist.GdaSearch, address), true, address);
  }
  for (const address of ["8.8.8.8", "172.32.0.1", "2001:db8::1", "::ffff:8.8.8.8"]) {
    assert.equal(allows(allowlist.GetGDA, address) || allows(allowlist.GdaSearch, address), false, address);
  }
});

test("an empty variable gives the default, as compose passes an unset one", () => {
  const { allowlist, schemaErrors } = parseConfig({ EHVD_ALLOWLIST: "", EHVD_SCHEMA_ERRORS: "" });
  assert.equal(schemaErrors, "http-403");
  assert.deepEqual(
    ["172.18.0.1", "8.8.8.8"].map((address) => [allows(allowlist.GetGDA, address), allows(allowlist.GdaSearch, address)]),
    [
      [true, true],
      [false, false],
    ],
  );
});

test("an allowlist entry with an operation admits that network for that operation only", () => {
  const { allowlist } = parseConfig({ EHVD_ALLOWLIST: "10.0.0.0/8,  fc00::/7   GdaSearch" });
  assert.deepEqual(
    ["10.1.2.3", "fd00::1"].map((address) => [allows(allowlist.GetGDA, address), allows(allowlist.GdaSearch, address)]),
    [
      [true, true],
      [false, true],
    ],
  );
});

test("the documented 6006 recipe lets every client call GetGDA and no client call GdaSearch", () => {
  const { allowlist } = parseConfig({ EHVD_ALLOWLIST: "0.0.0.0/0 GetGDA, ::/0 GetGDA" });
  const addresses = ["127.0.0.1", "::1", "10.0.2.2", "172.18.0.1", "192.168.5.2", "fd00::2", "8.8.8.8", "2001:db8::1"];
  assert.deepEqual(
    addresses.map((address) => [address, allows(allowlist.GetGDA, address), allows(allowlist.GdaSearch, address)]),
    addresses.map((address) => [address, true, false]),
  );
});

test("invalid configuration fails with a message that names the value", () => {
  const network = (entry: string) => `EHVD_ALLOWLIST: "${entry}" is not a network in CIDR notation, such as 10.0.0.0/8 or fc00::/7`;
  const shape = (entry: string) => `EHVD_ALLOWLIST: "${entry}" must be a network, optionally followed by GetGDA or GdaSearch`;
  const cases: [Record<string, string>, string][] = [
    [{ EHVD_ALLOWLIST: "10.0.0.0" }, network("10.0.0.0")],
    [{ EHVD_ALLOWLIST: "10.0.0.0/33" }, network("10.0.0.0/33")],
    [{ EHVD_ALLOWLIST: "::1/129" }, network("::1/129")],
    [{ EHVD_ALLOWLIST: "localhost/8" }, network("localhost/8")],
    [{ EHVD_ALLOWLIST: "10.0.0.0/8 GetGda" }, shape("10.0.0.0/8 GetGda")],
    [{ EHVD_ALLOWLIST: "10.0.0.0/8 GetGDA GdaSearch" }, shape("10.0.0.0/8 GetGDA GdaSearch")],
    [{ EHVD_ALLOWLIST: "10.0.0.0/8,,::1/128" }, shape("")],
    [{ EHVD_SCHEMA_ERRORS: "403" }, 'EHVD_SCHEMA_ERRORS must be http-403 or fault-6001, not "403"'],
  ];
  for (const [env, message] of cases) assert.throws(() => parseConfig(env), { message }, JSON.stringify(env));
});
