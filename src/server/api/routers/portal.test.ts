import assert from "node:assert/strict";
import { test } from "node:test";

import { TRPCError } from "@trpc/server";

import { createCaller } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import { portalPath } from "@/server/portal/paths";
import { answerForm } from "./portal";

const form = (fields: Record<string, string | Blob>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const file = new File(["# Labor Kanalstraße: lab report\n"], "result.md", { type: "text/markdown" });

test("the answer form takes the token, the file, and the patient's name and birth date", () => {
  const input = answerForm.parse(form({ token: "abc", file, patientName: " Maria Beispiel ", birthDate: "1961-03-12" }));
  assert.equal(input.token, "abc");
  assert.equal(input.patientName, "Maria Beispiel");
  assert.equal(input.birthDate, "1961-03-12");
  assert.ok(input.file instanceof File);
});

test("the answer form refuses a missing file, an empty name, and a birth date that is not a date", () => {
  assert.equal(answerForm.safeParse(form({ token: "abc", patientName: "Maria", birthDate: "1961-03-12" })).success, false);
  assert.equal(answerForm.safeParse(form({ token: "abc", file, patientName: "  ", birthDate: "1961-03-12" })).success, false);
  assert.equal(answerForm.safeParse(form({ token: "abc", file, patientName: "Maria", birthDate: "12.03.1961" })).success, false);
  assert.equal(answerForm.safeParse(form({ token: "abc", file: "text", patientName: "Maria", birthDate: "1961-03-12" })).success, false);
});

test("only an ID Austria session can send an answer", async () => {
  const data = form({ token: "abc", file, patientName: "Maria Beispiel", birthDate: "1961-03-12" });
  for (const actor of [{ kind: "anonymous" as const }, { kind: "clinic" as const, mxid: "@lena.hofer:klinikum.example" }]) {
    await assert.rejects(createCaller(createContext(actor)).portal.answer(data), (e) => e instanceof TRPCError && e.code === "UNAUTHORIZED");
  }
});

test("each login result has its page, and only `answer` is the answer page", () => {
  assert.equal(portalPath("t-1", "answer"), "/r/t-1/answer");
  assert.equal(portalPath("t-1", "held"), "/r/t-1/held");
  assert.equal(portalPath("t-1", "wrong_person"), "/r/t-1/refused");
  assert.equal(portalPath("t-1", "unavailable"), "/r/t-1/unavailable");
  assert.equal(portalPath("t-1", "closed"), "/r/t-1");
  assert.equal(portalPath("a/b", "answer"), "/r/a%2Fb/answer");
});
