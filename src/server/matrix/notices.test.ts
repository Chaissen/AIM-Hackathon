import assert from "node:assert/strict";
import { test } from "node:test";

import { noticeText } from "./notices";

test("the documented notices for request 1", () => {
  assert.equal(
    noticeText({ kind: "sent", requestId: 1, recipient: "Dr. Eva Brandl", org: "Labor Kanalstraße", channel: "email" }),
    "Request 1 sent to Dr. Eva Brandl (Labor Kanalstraße) by email.",
  );
  assert.equal(
    noticeText({ kind: "wrong-person", requestId: 1, recipient: "Dr. Eva Brandl", idAustriaName: "Anna Huber" }),
    "Request 1 was opened by someone who is not Dr. Eva Brandl (ID Austria name: Anna Huber). Nothing was shown or filed. Check the address.",
  );
  assert.equal(
    noticeText({ kind: "patient-mismatch", requestId: 1, patient: "Maria Beispiel" }),
    "The answer to request 1 is about a different patient. Name and birth date do not match Maria Beispiel. Nothing was filed.",
  );
  assert.equal(
    noticeText({
      kind: "filed",
      docType: "lab-result",
      patient: "Maria Beispiel",
      sender: "Dr. Eva Brandl",
      values: { within: 4, outside: 0 },
    }),
    "Lab result for Maria Beispiel from Dr. Eva Brandl is filed. Identity checked with ID Austria. 4 values, all within the reference range.",
  );
});

test("a held notice gives the caller's reason and points to the widget", () => {
  assert.equal(
    noticeText({
      kind: "held",
      requestId: 1,
      hold: "identity",
      reason: "The ID Austria name Petra Brandl matches Dr. Eva Brandl only in part.",
    }),
    "Request 1 is on hold. The ID Austria name Petra Brandl matches Dr. Eva Brandl only in part. Accept or reject the person in the widget.",
  );
  assert.equal(
    noticeText({
      kind: "held",
      requestId: 1,
      hold: "answer",
      reason: "The eHVD does not list Dr. Eva Brandl as a member of Labor Kanalstraße.",
    }),
    "The answer to request 1 is on hold. The eHVD does not list Dr. Eva Brandl as a member of Labor Kanalstraße. Accept or reject the answer in the widget.",
  );
});

test("a filed rehab report has no values", () => {
  assert.equal(
    noticeText({ kind: "filed", docType: "rehab-report", patient: "Maria Beispiel", sender: "Stefan Kern" }),
    "Rehab discharge report for Maria Beispiel from Stefan Kern is filed. Identity checked with ID Austria.",
  );
});

test("a filed lab result counts the values outside the reference range", () => {
  const filed = (within: number, outside: number) =>
    noticeText({ kind: "filed", docType: "lab-result", patient: "Maria Beispiel", sender: "Dr. Eva Brandl", values: { within, outside } });
  assert.equal(
    filed(3, 1),
    "Lab result for Maria Beispiel from Dr. Eva Brandl is filed. Identity checked with ID Austria. 4 values, 1 outside the reference range.",
  );
  assert.equal(
    filed(0, 1),
    "Lab result for Maria Beispiel from Dr. Eva Brandl is filed. Identity checked with ID Austria. 1 value, outside the reference range.",
  );
});
