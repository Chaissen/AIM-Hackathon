import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request, type RequestOptions } from "node:http";
import { connect } from "node:net";
import { after, test } from "node:test";

import { faultEnvelope, getGdaXml, oids, post, searchXml, start } from "./http.ts";

const KLINIKUM = "1.2.40.0.34.3.1.99.1.1";
const LENA_HOFER = "1.2.40.0.34.3.2.99.1.1";
const EVA_BRANDL = "1.2.40.0.34.3.2.99.1.2";
const JOHANNA_LEITNER = "1.2.40.0.34.3.2.99.1.3";
const MARTIN_BRANDL = "1.2.40.0.34.3.2.99.1.4";
const EVA_BRANDL_HUBER = "1.2.40.0.34.3.2.99.1.5";
const TEST_AMBULATORIUM = "1.2.40.0.34.3.1.0.2";
const TEST_GRUPPENPRAXIS = "1.2.40.0.34.3.1.0.5";
const TEST_ARZT = "1.2.40.0.34.3.2.0.10";
const OTTO = "1.2.40.0.34.3.2.99.0.11003";

const mock = await start();
after(mock.close);

const searchOrder = ["firstname", "surname", "rolecode", "postcode", "streetNumber", "streetName", "city", "state", "maxResults", "ehvdstatus", "elgastatus", "description"];
const inWsdlOrder = (fields: Record<string, string>) =>
  Object.fromEntries(searchOrder.filter((name) => name in fields).map((name) => [name, fields[name]]));

const search = async (fields: Record<string, string>) => {
  const { status, body } = await post(mock.url, searchXml(inWsdlOrder({ maxResults: "10", ...fields })));
  assert.equal(status, 200, `${JSON.stringify(fields)}: ${body}`);
  return oids(body);
};

test("GetGDA answers with the entry as a GdaIndexResponse", async () => {
  const { status, body } = await post(mock.url, getGdaXml({ oidIssuingAuthority: "1.2.40.0.34", id: TEST_AMBULATORIUM }));
  assert.equal(status, 200);
  assert.equal(
    body,
    '<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
      '<GdaIndexResponse xmlns="eHVD"><gda><id><oidIssuingAuthority>1.2.40.0.34</oidIssuingAuthority><id>1.2.40.0.34.3.1.0.2</id></id>' +
      "<otherID>1.2.40.0.34.4.20:A9999</otherID><status><ehvdstatus>Aktiv</ehvdstatus><elgastatus>Aktiv</elgastatus></status>" +
      "<surname>Test-GDA Ambulatorium</surname><address><streetNumber>1</streetNumber><streetName>Testgasse</streetName><city>Wien</city>" +
      "<state>Wien</state><zip>1030</zip><country>AT</country></address><description>Registrierungsstelle:Amt der Landesregierung</description>" +
      "<roles><role>1.2.40.0.34.5.2:304</role><elgaRole>1.2.40.0.34.5.3:702</elgaRole></roles>" +
      "<timestamps><add>2015-01-01</add><modify>2026-01-01</modify></timestamps></gda></GdaIndexResponse></soap:Body></soap:Envelope>",
  );
});

test("GetGDA finds the handbook samples and other kinds of id", async () => {
  const cases: [Record<string, string>, string][] = [
    [{ oidIssuingAuthority: "1.2.40.0.34", id: TEST_AMBULATORIUM }, TEST_AMBULATORIUM],
    [{ oidIssuingAuthority: "1.2.40.0.34", id: TEST_GRUPPENPRAXIS }, TEST_GRUPPENPRAXIS],
    [{ oidIssuingAuthority: "1.2.40.0.34", id: TEST_ARZT }, TEST_ARZT],
    [{ oidIssuingAuthority: "1.2.40.0.34.4.20", id: "A9999" }, TEST_AMBULATORIUM],
    [{ oidIssuingAuthority: "1.2.40.0.34.4.20", id: "a9999" }, TEST_AMBULATORIUM],
    [{ oidIssuingAuthority: "1.2.40.0.34.4.18", id: "99002" }, EVA_BRANDL],
    [{ oidIssuingAuthority: "1.2.40.0.34.4.10", id: "K9001" }, KLINIKUM],
    [{ id: EVA_BRANDL }, EVA_BRANDL],
    [{ oidIssuingAuthority: "", id: EVA_BRANDL }, EVA_BRANDL],
    [{ id: OTTO }, OTTO],
  ];
  for (const [fields, expected] of cases) {
    const { status, body } = await post(mock.url, getGdaXml(fields));
    assert.equal(status, 200, JSON.stringify(fields));
    assert.deepEqual(oids(body), [expected], JSON.stringify(fields));
  }
});

test("GdaSearch finds each handbook test entry by its surname", async () => {
  assert.deepEqual(await search({ surname: "Test-GDA Ambulatorium" }), [TEST_AMBULATORIUM]);
  assert.deepEqual(await search({ surname: "Gruppenpraxis Dr. Aldemar SVC Betriebsordination Wahlarzt OG" }), [TEST_GRUPPENPRAXIS]);
  assert.deepEqual(await search({ surname: "XXXeHealth Test-GDA XXXTest-GDA Support-Ordination BMG" }), [TEST_ARZT]);
});

test("GdaSearch never returns or counts the entry without timestamps, which only GetGDA reaches", async () => {
  assert.deepEqual(await search({ surname: "*Test*", maxResults: "20" }), [TEST_AMBULATORIUM, TEST_ARZT]);
  assert.deepEqual(await search({ surname: "*Test*", maxResults: "2" }), [TEST_AMBULATORIUM, TEST_ARZT]);
  assert.deepEqual(await search({ surname: "ordy test entry without timestamps" }), []);
});

test("every fault from 6001 to 6005 has its documented code, message, and HTTP status", async () => {
  const cases: [string, string, number, string][] = [
    ["id with a trailing blank", getGdaXml({ id: `${EVA_BRANDL} ` }), 400, faultEnvelope("Sender", "Content is not valid!", 6001)],
    ["unknown OID", getGdaXml({ id: "1.2.40.0.34.3.2.99.9.1" }), 500, faultEnvelope("Receiver", "No compliance found!", 6002)],
    ["unknown Arzt-Nr", getGdaXml({ oidIssuingAuthority: "1.2.40.0.34.4.18", id: "12345" }), 500, faultEnvelope("Receiver", "No compliance found!", 6002)],
    ["well-formed unknown kind of id", getGdaXml({ oidIssuingAuthority: "1.0.2", id: "99002" }), 500, faultEnvelope("Receiver", "No compliance found!", 6002)],
    [
      "a real bPK, whose / and = the id rule rejects",
      getGdaXml({ oidIssuingAuthority: "1.2.40.0.10.2.1.1.149", id: "QqRyJqno/aFVJYjMxkWpDJWj878=" }),
      400,
      faultEnvelope("Sender", "Content is not valid!", 6001),
    ],
    [
      "the bPK kind of id with an id the id rule allows",
      getGdaXml({ oidIssuingAuthority: "1.2.40.0.10.2.1.1.149", id: "Njtp64gB10hpR5sYe6HxgmOQJk0" }),
      500,
      faultEnvelope("Receiver", "No compliance found!", 6002),
    ],
    ["reserved OID", getGdaXml({ id: "1.2.40.0.34.3.1.99.9.6003" }), 500, faultEnvelope("Receiver", "A general error occurred!", 6003)],
    ["entry without timestamps", getGdaXml({ id: "1.2.40.0.34.3.1.99.9.6004" }), 500, faultEnvelope("Receiver", "Attribute not found!", 6004)],
    [
      "more hits than maxResults",
      searchXml({ surname: "Brandl", maxResults: "1" }),
      400,
      faultEnvelope("Sender", "Maximum numbers of compliances exceeded!", 6005),
    ],
  ];
  for (const [name, xml, status, expected] of cases) {
    const response = await post(mock.url, xml);
    assert.equal(response.status, status, name);
    assert.equal(response.body, expected, name);
  }
});

test("a malformed field is fault 6001", async () => {
  const getGdaCases: Record<string, string>[] = [
    { id: "" },
    { id: "1".repeat(41) },
    { id: "1.2.40.0.34.3.2.99.1_2" },
    { oidIssuingAuthority: "1.2.40.0.34a", id: EVA_BRANDL },
    { oidIssuingAuthority: "1.2.40.0.34.4.18.1.2.3.4.5", id: "99002" },
    { oidIssuingAuthority: "1..2", id: "99002" },
    { oidIssuingAuthority: "1.02", id: "99002" },
    { oidIssuingAuthority: "1", id: "99002" },
    { oidIssuingAuthority: "3.1", id: "99002" },
    { oidIssuingAuthority: "1.45", id: "99002" },
  ];
  const searchCases: Record<string, string>[] = [
    { surname: "", maxResults: "10" },
    { surname: "B".repeat(129), maxResults: "10" },
    { surname: "Brandl@labor", maxResults: "10" },
    { surname: "Брандл", maxResults: "10" },
    { surname: "Brandl", postcode: "1O00", maxResults: "10" },
    { surname: "Brandl", rolecode: "1.2.40.0.34.5.2:159", maxResults: "10" },
    { surname: "Brandl", city: "Lin*", maxResults: "10" },
    { surname: "Brandl", maxResults: "0" },
    { surname: "Brandl", maxResults: "201" },
    { surname: "Brandl", maxResults: "0010" },
    { surname: "Brandl", maxResults: "-5" },
    { surname: "Brandl", maxResults: "10", ehvdstatus: "aktiv" },
    { surname: "Brandl", maxResults: "10", elgastatus: "Active" },
    { surname: "Brandl", maxResults: "10", description: "*Registrierungsstelle Wien*" },
  ];
  const requests = [...getGdaCases.map((fields) => getGdaXml(fields)), ...searchCases.map((fields) => searchXml(inWsdlOrder(fields)))];
  for (const xml of requests) {
    const response = await post(mock.url, xml);
    assert.equal(response.body, faultEnvelope("Sender", "Content is not valid!", 6001), xml);
  }
});

test("wildcards work as *X, X*, and *X* with at least two letters A to Z besides the *", async () => {
  assert.deepEqual(await search({ surname: "Brandl*" }), [EVA_BRANDL, MARTIN_BRANDL, EVA_BRANDL_HUBER]);
  assert.deepEqual(await search({ surname: "*randl" }), [EVA_BRANDL, MARTIN_BRANDL]);
  assert.deepEqual(await search({ surname: "*randl*" }), [EVA_BRANDL, MARTIN_BRANDL, EVA_BRANDL_HUBER]);
  assert.deepEqual(await search({ surname: "*Huber" }), [EVA_BRANDL_HUBER]);
  assert.deepEqual(await search({ firstname: "Ev*", surname: "Brandl*" }), [EVA_BRANDL, EVA_BRANDL_HUBER]);
  assert.deepEqual(await search({ surname: "Brandl", maxResults: "10", description: "*rztekammer" }), [EVA_BRANDL, MARTIN_BRANDL]);

  for (const surname of ["*", "**", "*B", "B*", "*12*", "Br*ndl", "**Brandl", "Brandl**", "*B*"]) {
    const response = await post(mock.url, searchXml({ surname, maxResults: "10" }));
    assert.equal(response.body, faultEnvelope("Sender", "Content is not valid!", 6001), surname);
  }
  const firstname = await post(mock.url, searchXml({ firstname: "*", surname: "Brandl", maxResults: "10" }));
  assert.equal(firstname.body, faultEnvelope("Sender", "Content is not valid!", 6001), "a bare * in firstname");
});

test("an exact match ignores case and Unicode normalisation, nothing else", async () => {
  assert.deepEqual(await search({ surname: "BRANDL" }), [EVA_BRANDL, MARTIN_BRANDL]);
  assert.deepEqual(await search({ surname: "brandl-huber" }), [EVA_BRANDL_HUBER]);
  assert.deepEqual(await search({ surname: "Brandl " }), [], "blanks are not trimmed");
  assert.deepEqual(await search({ surname: "Labor Kanalstraße" }), ["1.2.40.0.34.3.1.99.1.2"]);
  assert.deepEqual(
    await search({ surname: "Brandl", maxResults: "10", description: "*Österreichische*" }),
    [EVA_BRANDL, MARTIN_BRANDL],
    "a decomposed Ö matches the composed one",
  );
});

test("the directory keeps the documented scenario facts", async () => {
  assert.deepEqual(await search({ firstname: "Eva", surname: "Brandl", ehvdstatus: "Aktiv" }), [EVA_BRANDL]);
  assert.deepEqual(await search({ surname: "Hofer" }), [LENA_HOFER]);
  assert.deepEqual(await search({ surname: "Leitner" }), [JOHANNA_LEITNER]);
  assert.deepEqual(await search({ surname: "*Ottakringer" }), [OTTO]);
  assert.deepEqual(await search({ firstname: "Stefan", surname: "Kern" }), []);
  assert.deepEqual(await search({ firstname: "Thomas", surname: "Wagner" }), []);
  assert.deepEqual(await search({ firstname: "Anna", surname: "Huber" }), []);
  assert.deepEqual(await search({ firstname: "Eva", surname: "Labor Kanalstraße" }), [], "an entry without a first name never matches firstname");
});

test("the status filters keep only active entries when they say Aktiv", async () => {
  assert.deepEqual(await search({ surname: "Brandl-Huber" }), [EVA_BRANDL_HUBER]);
  assert.deepEqual(await search({ surname: "Brandl-Huber", ehvdstatus: "Aktiv" }), []);
  assert.deepEqual(await search({ surname: "Brandl-Huber", ehvdstatus: "Inaktiv" }), [EVA_BRANDL_HUBER]);
  assert.deepEqual(await search({ surname: "Brandl-Huber", elgastatus: "Aktiv" }), []);
  assert.deepEqual(await search({ surname: "Brandl-Huber", elgastatus: "Inaktiv" }), [EVA_BRANDL_HUBER]);
  assert.deepEqual(await search({ surname: "Brandl*", ehvdstatus: "Aktiv" }), [EVA_BRANDL, MARTIN_BRANDL]);
});

test("address criteria must all match one address of the entry", async () => {
  const surname = "Gruppenpraxis Dr. Aldemar SVC Betriebsordination Wahlarzt OG";
  assert.deepEqual(await search(inWsdlOrder({ surname, postcode: "1030", city: "Wien" })), [TEST_GRUPPENPRAXIS]);
  assert.deepEqual(await search(inWsdlOrder({ surname, postcode: "8020", streetName: "probeweg", city: "GRAZ", state: "Steiermark" })), [TEST_GRUPPENPRAXIS]);
  assert.deepEqual(await search(inWsdlOrder({ surname, postcode: "8020", city: "Wien" })), [], "zip of one address, city of the other");
  assert.deepEqual(await search(inWsdlOrder({ surname: "Brandl", streetNumber: "4", streetName: "Am Musterhof" })), [MARTIN_BRANDL]);
});

test("rolecode is the bare GTelV or ELGA code", async () => {
  assert.deepEqual(await search({ surname: "Brandl", rolecode: "100" }), [MARTIN_BRANDL]);
  assert.deepEqual(await search({ surname: "Brandl", rolecode: "159" }), [EVA_BRANDL]);
  assert.deepEqual(await search({ surname: "Brandl", rolecode: "700" }), [EVA_BRANDL, MARTIN_BRANDL]);
  assert.deepEqual(await search({ surname: "Brandl", rolecode: "724" }), []);
});

test("an optional element without text counts as absent", async () => {
  const { body } = await post(mock.url, searchXml({ firstname: "", surname: "Brandl", rolecode: "", maxResults: "10", ehvdstatus: "" }));
  assert.deepEqual(oids(body), [EVA_BRANDL, MARTIN_BRANDL]);
});

test("a search without hits is an empty GdaIndexResponseList", async () => {
  const { status, body } = await post(mock.url, searchXml({ surname: "Niemand", maxResults: "10" }));
  assert.equal(status, 200);
  assert.equal(
    body,
    '<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
      '<GdaIndexResponseList xmlns="eHVD"></GdaIndexResponseList></soap:Body></soap:Envelope>',
  );
});

test("each request logs one JSON line without the search values or an unknown path", async (t) => {
  const quiet = await start();
  t.after(quiet.close);
  await post(quiet.url, searchXml({ firstname: "Eva", surname: "Brandl", maxResults: "10" }));
  await post(quiet.url, searchXml({ surname: "Brandl", maxResults: "1" }));
  await post(quiet.url, getGdaXml({ id: "1.2.40.0.34.3.2.99.9.1" }));
  await fetch(`${quiet.url}/healthz`);
  await fetch(`${quiet.url}/ehvd.wsdl`);
  await fetch(`${quiet.url}/Patient-Maria-Beispiel-born-1961-03-12`);
  assert.deepEqual(
    quiet.logs.map((line) => JSON.parse(line)),
    [
      { client: "127.0.0.1", method: "POST", path: "/", operation: "GdaSearch", hits: 1, status: 200 },
      { client: "127.0.0.1", method: "POST", path: "/", operation: "GdaSearch", hits: 2, fault: 6005, status: 400 },
      { client: "127.0.0.1", method: "POST", path: "/", operation: "GetGDA", hits: 0, fault: 6002, status: 500 },
      { client: "127.0.0.1", method: "GET", path: "/ehvd.wsdl", status: 200 },
      { client: "127.0.0.1", method: "GET", path: "other", status: 404 },
    ],
  );
  assert.equal(quiet.logs.join().includes("Brandl"), false);
});

test("the allowlist turns away other networks with an empty 403 and limits operations with 6006", async (t) => {
  const closed = await start({ EHVD_ALLOWLIST: "10.0.0.0/8" });
  const limited = await start({ EHVD_ALLOWLIST: "0.0.0.0/0 GetGDA, ::/0 GetGDA" });
  t.after(closed.close);
  t.after(limited.close);

  const outside = await post(closed.url, getGdaXml({ id: EVA_BRANDL }));
  assert.deepEqual(outside, { status: 403, body: "" });
  assert.equal((await fetch(`${closed.url}/ehvd.wsdl`)).status, 403);
  assert.equal((await fetch(`${closed.url}/nowhere`)).status, 403);
  assert.deepEqual(await (await fetch(`${closed.url}/healthz`)).json(), { status: "ok", entries: 313 });

  assert.deepEqual(oids((await post(limited.url, getGdaXml({ id: EVA_BRANDL }))).body), [EVA_BRANDL]);
  assert.deepEqual(await post(limited.url, searchXml({ surname: "Brandl", maxResults: "10" })), {
    status: 500,
    body: faultEnvelope("Receiver", "User/Role is not allowed to use this webservice interface!", 6006),
  });
});

test("an IPv4 client of a dual-stack socket is checked and logged as IPv4", async (t) => {
  const dual = await start({ EHVD_ALLOWLIST: "127.0.0.0/8" }, "::");
  t.after(dual.close);
  await post(dual.url, getGdaXml({ id: EVA_BRANDL }));
  assert.deepEqual(JSON.parse(dual.logs[0]), { client: "127.0.0.1", method: "POST", path: "/", operation: "GetGDA", hits: 1, status: 200 });
});

test("GET /healthz reports the entry count, other paths and methods do not exist", async () => {
  assert.deepEqual(await (await fetch(`${mock.url}/healthz`)).json(), { status: "ok", entries: 313 });
  assert.equal((await fetch(`${mock.url}/nowhere`)).status, 404);
  const getRoot = await fetch(`${mock.url}/`);
  assert.deepEqual([getRoot.status, getRoot.headers.get("allow")], [405, "POST"]);
  const postWsdl = await fetch(`${mock.url}/ehvd.wsdl`, { method: "POST" });
  assert.deepEqual([postWsdl.status, postWsdl.headers.get("allow")], [405, "GET"]);
});

const realWsdl = readFileSync(new URL("../../../docs/ehvd/eHVD.wsdl", import.meta.url), "utf8");

test("GET /ehvd.wsdl serves the real WSDL with the mock's address", async () => {
  const response = await fetch(`${mock.url}/ehvd.wsdl`);
  assert.equal(response.headers.get("content-type"), "text/xml; charset=utf-8");
  const served = await response.text();
  assert.equal(served.includes(`<soap12:address location="http://127.0.0.1:${mock.port}/"/>`), true);
  assert.equal(served, realWsdl.replace('location="https://ehvdws.gesundheit.gv.at"', `location="http://127.0.0.1:${mock.port}/"`));
});

test("the WSDL address escapes the Host header and falls back without one or with an empty one", async () => {
  const wsdlWith = (options: RequestOptions) =>
    new Promise<string>((resolve, reject) => {
      request(`${mock.url}/ehvd.wsdl`, options, (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => resolve(text));
      })
        .on("error", reject)
        .end();
    });
  const escaped = await wsdlWith({ headers: { host: 'a"b&c' } });
  assert.equal(escaped.includes('<soap12:address location="http://a&quot;b&amp;c/"/>'), true);
  const empty = await wsdlWith({ setHost: false, headers: { host: "" } });
  assert.equal(empty.includes('<soap12:address location="http://localhost:8095/"/>'), true);

  const fallback = await new Promise<string>((resolve, reject) => {
    const socket = connect(mock.port, "127.0.0.1", () => socket.end("GET /ehvd.wsdl HTTP/1.0\r\n\r\n"));
    let text = "";
    socket.on("data", (chunk) => (text += chunk));
    socket.on("end", () => resolve(text));
    socket.on("error", reject);
  });
  assert.equal(fallback.includes('<soap12:address location="http://localhost:8095/"/>'), true);
});
