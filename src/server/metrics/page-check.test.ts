import assert from "node:assert/strict";
import { test } from "node:test";

import { birthDateFormats, flightData, pageText, revealedOnPage } from "./page-check";

const maria = { name: "Maria Beispiel", birthDate: "1961-03-12" };

test("the birth date in the documented formats and the en-US and en-GB forms", () => {
  assert.deepEqual(birthDateFormats("1961-03-12"), [
    "1961-03-12",
    "12.03.1961",
    "12 March 1961",
    "March 12, 1961",
    "3/12/1961",
    "03/12/1961",
    "12/03/1961",
    "12/3/1961",
  ]);
  // Day and month without a leading zero give each slash form once.
  assert.deepEqual(birthDateFormats("1970-12-24").filter((f) => f.includes("/")), ["12/24/1970", "24/12/1970"]);
});

test("a birth date in any of these forms counts, but not inside another date", () => {
  const found = (text: string) => revealedOnPage(`<p>${text}</p>`, { name: "Nobody Here", birthDate: "1961-03-12" });
  assert.deepEqual(found("born March 12, 1961"), ["March 12, 1961"]);
  assert.deepEqual(found("born 3/12/1961"), ["3/12/1961"]);
  assert.deepEqual(found("born 03/12/1961"), ["03/12/1961"]);
  assert.deepEqual(found("born 12/03/1961"), ["12/03/1961"]);
  assert.deepEqual(found("born 12 March 1961"), ["12 March 1961"]);
  assert.deepEqual(found(`"$D1961-03-12T00:00:00.000Z"`), ["1961-03-12"]);
  assert.deepEqual(found("born 13/12/1961 or 3/12/19610"), []);
});

test("flight data cut into pieces is joined before the search", () => {
  // React cuts the flight data every 4096 bytes, and each piece is its own JSON string in its own push script.
  const pushes = (...pieces: string[]) =>
    pieces.map((p) => `<script>self.__next_f.push([1,${JSON.stringify(p)}])</script>`).join("<div hidden></div>");
  const page = (...pieces: string[]) => `<h1>This request is for someone else.</h1>${pushes(...pieces)}`;
  assert.deepEqual(revealedOnPage(page('5:{"name":"Maria Bei', 'spiel"}'), maria), ["maria", "beispiel"]);
  assert.deepEqual(revealedOnPage(page('5:{"docType":"lab-res', 'ult"}'), maria), ["lab-result"]);
  assert.deepEqual(revealedOnPage(page('5:{"birthDate":"$D1961-0', '3-12T00:00:00.000Z"}'), maria), ["1961-03-12"]);
  // Each piece is decoded as a JSON string, then the pieces are joined in order.
  assert.equal(flightData(pushes('1:"x', 'y"', "\n")), '1:"xy"\n');
});

test("the refusal page after a wrong login reveals nothing, scripts included", () => {
  const html = `<main><h1>This request is for someone else.</h1>
    <p>Nothing was shared with you. Dr. Lena Hofer, Klinikum Beispielstadt, has been told.</p></main>
    <script>self.__next_f.push([1,"3:[\\"$\\",\\"main\\",null,{\\"page\\":\\"wrong_person\\",\\"clinic\\":\\"Klinikum Beispielstadt\\"}]\\n"])</script>`;
  assert.deepEqual(revealedOnPage(html, maria), []);
});

test("the answer page reveals the patient and the document type", () => {
  const html = `<h1>Lab result for <b>Maria&nbsp;Beispiel</b></h1><p>born 12.03.1961</p>`;
  assert.deepEqual(revealedOnPage(html, maria), ["maria", "beispiel", "12.03.1961", "lab result"]);
});

test("props sent to a client component count, even when the page does not show them", () => {
  const props = `"patient":{"name":"Maria Beispiel","birthDate":"1961-03-12"},"docType":"lab-result"`;
  const plain = `<h1>This request is for someone else.</h1><script>var p = {${props}};</script>`;
  const expected = ["maria", "beispiel", "1961-03-12", "lab-result"];
  assert.deepEqual(revealedOnPage(plain, maria), expected);
  // As Next.js sends it: a JSON string inside a JS string, so escaped twice.
  const flight = `<h1>This request is for someone else.</h1><script>self.__next_f.push([1,${JSON.stringify(JSON.stringify(`{${props}}`))}])</script>`;
  assert.deepEqual(revealedOnPage(flight, maria), expected);
  // Unicode escapes and HTML entities.
  const escaped = `<div data-props="{&quot;name&quot;:&quot;Maria Beispiel&quot;}"></div><script>x="\\u0072ehab-report"</script>`;
  assert.deepEqual(revealedOnPage(escaped, maria), ["maria", "beispiel", "rehab-report"]);
});

test("the page text undoes entities and escapes and keeps scripts and attribute values", () => {
  const text = pageText(`<p title="x&quot;y">a&amp;b</p><script>"c\\"d\\u0021"</script>`);
  assert.ok(text.includes(`title="x"y"`), text);
  assert.ok(text.includes(" a&b "), text);
  assert.ok(text.includes(`"c"d!"`), text);
  assert.ok(!/[<>]/.test(text), text);
});
