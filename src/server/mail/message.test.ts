import assert from "node:assert/strict";
import { test } from "node:test";

import { forbiddenContent, requestEmail } from "./message";

const maria = { family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12" };
const check = (text: string, patient = maria) => forbiddenContent({ subject: "Secure request from Klinikum Beispielstadt", text }, patient);

test("request 1's email follows the template, dates the expiry in Vienna, and passes the check", () => {
  const email = requestEmail({
    requester: "Dr. Lena Hofer",
    clinic: "Klinikum Beispielstadt",
    link: "http://localhost:3010/r/q3Vt8sQ0bA1xY7nK2mZ9pL4rW6eT5uH0jF8dC3gB1iE",
    expiresAt: new Date("2026-11-04T23:30:00Z"),
  });
  assert.deepEqual(email, {
    subject: "Secure request from Klinikum Beispielstadt",
    text:
      "Hello,\n\n" +
      "Dr. Lena Hofer at Klinikum Beispielstadt has sent you a secure request.\n" +
      "Open it here: http://localhost:3010/r/q3Vt8sQ0bA1xY7nK2mZ9pL4rW6eT5uH0jF8dC3gB1iE\n\n" +
      "You need ID Austria to open it. The link expires on 5 November 2026.\n" +
      "If you did not expect this message, you can ignore it.\n",
  });
  assert.deepEqual(forbiddenContent(email, maria), []);
  assert.deepEqual(forbiddenContent({ ...email, text: `${email.text}Maria` }, maria), ["patient-name"]);
});

test("a text with Maria or lab is refused", () => {
  assert.deepEqual(check("Hello Maria"), ["patient-name"]);
  assert.deepEqual(check("Your lab values"), ["document-type"]);
  assert.deepEqual(check("Maria's lab report, born 12.03.1961"), ["patient-name", "birth-date", "document-type"]);
});

test("only whole words count, so Klinikum Beispielstadt passes", () => {
  assert.deepEqual(check("Klinikum Beispielstadt"), []);
  assert.deepEqual(check("Klinikum Beispiel"), ["patient-name"]);
  assert.deepEqual(check("our laboratory"), []);
  assert.deepEqual(check("our labor"), ["document-type"]);
});

test("punctuation and case around a name do not hide it", () => {
  for (const text of ["Maria's", "(Maria)", "Maria:", "MARIA", "maria.beispiel@example.com", "Maria_Beispiel"]) {
    assert.deepEqual(check(text), ["patient-name"], text);
  }
});

test("the birth date is caught in each format, also without leading zeros or with other separators", () => {
  for (const text of ["born 1961-03-12", "born 12.03.1961", "born 12 March 1961", "born 12.3.1961", "born 12/03/1961", "born 12 march 1961"]) {
    assert.deepEqual(check(text), ["birth-date"], text);
  }
  assert.deepEqual(check("born 13.03.1961"), []);
  assert.deepEqual(check("born 1961"), []);
});

test("umlauts are spelled out and other accents dropped, as in the patient check", () => {
  const mueller = { family: "Müller", given: ["José"], birthDate: "1950-05-05" };
  for (const text of ["Mueller", "Müller", "Mu\u0308ller", "MÜLLER", "Jose", "José"]) {
    assert.deepEqual(check(text, mueller), ["patient-name"], text);
  }
});

test("a combining mark from any block drops out without splitting the word", () => {
  assert.deepEqual(check("Ma\u1ab0ria"), ["patient-name"]);
  assert.deepEqual(check("la\u1ab0b"), ["document-type"]);
  assert.deepEqual(check("Hello Ma", { ...maria, given: ["Ma\u1ab0ria"] }), []);
});

test("a character that joins the next one does not hide it", () => {
  assert.deepEqual(check("Dr. \u0600Maria Hofer"), ["patient-name"]);
  assert.deepEqual(check("\u0600lab"), ["document-type"]);
  assert.deepEqual(check("born \u06001961-03-12"), ["birth-date"]);
});

test("a Turkish name is caught in either case, with or without the dot on its i", () => {
  const yilmaz = { family: "Yılmaz", given: ["Işık"], birthDate: "1950-05-05" };
  for (const text of ["Dr. Selin YILMAZ", "Yılmaz", "yilmaz", "IŞIK", "Isik"]) assert.deepEqual(check(text, yilmaz), ["patient-name"], text);
  const ince = { family: "İnce", given: ["Ayşe"], birthDate: "1950-05-05" };
  for (const text of ["INCE", "ince", "İNCE"]) assert.deepEqual(check(text, ince), ["patient-name"], text);
});

test("an upper-case Greek name is caught whatever follows its final sigma", () => {
  const pavlos = { family: "Παύλος", given: ["Νίκος"], birthDate: "1950-05-05" };
  for (const text of ["ΠΑΥΛΟΣ", "ΠΑΥΛΟΣ's", "ΠΑΥΛΟΣ:ABC", "Παυλος"]) assert.deepEqual(check(text, pavlos), ["patient-name"], text);
});

test("the subject is checked too, and the words of every document type", () => {
  assert.deepEqual(forbiddenContent({ subject: "Your Befund", text: "Hello" }, maria), ["document-type"]);
  for (const text of ["rehab", "discharge", "result"]) assert.deepEqual(check(text), ["document-type"], text);
});

test("a patient without a birth date is still checked for the name", () => {
  assert.deepEqual(check("Maria, 12.03.1961", { ...maria, birthDate: "" }), ["patient-name"]);
});

test("a name with a letter that has no case refuses every email for that patient", () => {
  assert.deepEqual(check("Hello", { family: "李", given: ["明"], birthDate: "1970-01-01" }), ["patient-name"]);
  for (const [given, family] of [["Seán", "O’Brien"], ["Seán", "Oʼbrien"], ["Лукʼян", "Іванов"]]) {
    assert.deepEqual(check("Hello", { family, given: [given], birthDate: "1970-01-01" }), [], family);
  }
  assert.deepEqual(check("Лукʼян", { family: "Іванов", given: ["Лукʼян"], birthDate: "1970-01-01" }), ["patient-name"]);
});
