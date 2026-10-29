import assert from "node:assert/strict";
import { test } from "node:test";

import { oid } from "./oid";

test("accepts OIDs", () => {
  for (const value of ["1.2.40.0.34.3.2.99.1.2", "2.999", "0.0"]) {
    assert.equal(oid.safeParse(value).success, true, value);
  }
});

test("rejects anything else", () => {
  for (const value of ["7", "123", "3.1", "1.40", "1.02", "1..2", "1.2.", " 1.2", "1.2a", ""]) {
    assert.equal(oid.safeParse(value).success, false, JSON.stringify(value));
  }
});
