import assert from "node:assert/strict";
import { test } from "node:test";

import { outsidePersonActor, outsidePersonName } from "./audit-actor";

test("an outside person's actor names the person and their person number", () => {
  assert.equal(outsidePersonActor("Eva Brandl", "GH:eva"), "Eva Brandl (GH:eva)");
  assert.equal(outsidePersonActor("Eva Brandl", null), "Eva Brandl (no person number)");
});

test("the name reads back from the actor, also without a person number or with brackets in the name", () => {
  assert.equal(outsidePersonName(outsidePersonActor("Eva Brandl", "GH:eva")), "Eva Brandl");
  assert.equal(outsidePersonName(outsidePersonActor("Thomas Wagner", null)), "Thomas Wagner");
  assert.equal(outsidePersonName(outsidePersonActor("Eva (Evi) Brandl", "GH:evi")), "Eva (Evi) Brandl");
});

test("actors that are not an outside person have no name", () => {
  assert.equal(outsidePersonName("@lena.hofer:klinikum.example"), null);
  assert.equal(outsidePersonName("ID Austria login"), null);
  assert.equal(outsidePersonName("ip 0123456789abcdef"), null);
  assert.equal(outsidePersonName(" (GH:eva)"), null);
});
