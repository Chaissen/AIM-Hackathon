import assert from "node:assert/strict";
import { test } from "node:test";

import { birthDateFormats, revealedOnPage } from "./page-check";

const maria = { name: "Maria Beispiel", birthDate: "1961-03-12" };

test("the birth date in the three documented formats", () => {
  assert.deepEqual(birthDateFormats("1961-03-12"), ["1961-03-12", "12.03.1961", "12 March 1961"]);
});

test("the refusal page after a wrong login reveals nothing", () => {
  const html = `<main><h1>This request is for someone else.</h1>
    <p>Nothing was shared with you. Dr. Lena Hofer, Klinikum Beispielstadt, has been told.</p></main>`;
  assert.deepEqual(revealedOnPage(html, maria), []);
});

test("the answer page reveals the patient and the document type", () => {
  const html = `<h1>Lab result for <b>Maria&nbsp;Beispiel</b></h1><p>born 12.03.1961</p><script>var x = "rehab discharge report";</script>`;
  assert.deepEqual(revealedOnPage(html, maria), ["maria", "beispiel", "12.03.1961", "lab result"]);
});
