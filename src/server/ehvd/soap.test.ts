import assert from "node:assert/strict";
import { test } from "node:test";

import { readResponse, requestXml, SoapError } from "./soap";

const envelope = (body: string, ns = "http://www.w3.org/2003/05/soap-envelope") =>
  `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="${ns}"><s:Body>${body}</s:Body></s:Envelope>`;

const gda = (inner: string) =>
  `<gda><id><id>1.2.40.0.34.3.2.99.1.2</id></id><status><ehvdstatus>Aktiv</ehvdstatus><elgastatus>Aktiv</elgastatus></status>${inner}</gda>`;

test("a search request keeps the WSDL order, whatever order the query has", () => {
  const xml = requestXml("GdaSearch", { ehvdstatus: "Aktiv", maxResults: 10, surname: "Brandl", firstname: "Eva" });
  assert.match(xml, /<e:GetGdaSearch><e:hcIdentifierSearch><e:firstname>Eva<\/e:firstname><e:surname>Brandl<\/e:surname><e:maxResults>10<\/e:maxResults><e:ehvdstatus>Aktiv<\/e:ehvdstatus><\/e:hcIdentifierSearch>/);
  assert.match(requestXml("GetGDA", { id: "1.2.40.0.34.3.2.99.1.2" }), /<e:GetGdaDescriptors><e:hcIdentifier><e:id>1\.2\.40\.0\.34\.3\.2\.99\.1\.2<\/e:id><\/e:hcIdentifier><\/e:GetGdaDescriptors>/);
  assert.match(requestXml("GdaSearch", { surname: "A & <B>", maxResults: 1 }), /<e:surname>A &amp; &lt;B&gt;<\/e:surname>/);
});

test("a descriptor is read by element name, with any prefix, and repeated elements become arrays", () => {
  const xml = envelope(
    `<x:GdaIndexResponseList xmlns:x="eHVD"><x:gda>` +
      `<x:id><x:id>1.2.40.0.34.3.2.99.1.2</x:id></x:id><x:status><x:ehvdstatus>Aktiv</x:ehvdstatus><x:elgastatus>Aktiv</x:elgastatus></x:status>` +
      `<x:surname>Brandl</x:surname>` +
      `<x:roles><x:role>1.2.40.0.34.5.2:159</x:role><x:specialisation>1.2.40.0.34.3.1.10.20:19</x:specialisation></x:roles>` +
      `<x:relations><x:memberof>a</x:memberof><x:memberof>b</x:memberof></x:relations><x:future>ignored</x:future>` +
      `</x:gda></x:GdaIndexResponseList>`,
  );
  const answer = readResponse("GdaSearch", xml);
  assert.equal(answer.kind, "gdas");
  if (answer.kind !== "gdas") return;
  assert.equal(answer.gdas[0].surname, "Brandl");
  assert.deepEqual(answer.gdas[0].roles, { role: ["1.2.40.0.34.5.2:159"], elgaRole: [], specialisation: ["1.2.40.0.34.3.1.10.20:19"] });
  assert.deepEqual(answer.gdas[0].relations, { memberof: ["a", "b"], ownerof: [] });
});

test("a fault gives the eHVD number from soap:Detail, or null without one", () => {
  const fault = (detail: string) =>
    envelope(`<s:Fault><s:Code><s:Value>s:Receiver</s:Value></s:Code><s:Reason><s:Text xml:lang="en">No compliance found!</s:Text></s:Reason>${detail}</s:Fault>`);
  assert.deepEqual(readResponse("GetGDA", fault('<s:Detail><code xmlns="eHVD">6002</code></s:Detail>')), { kind: "fault", code: 6002, message: "No compliance found!" });
  assert.deepEqual(readResponse("GetGDA", fault("")), { kind: "fault", code: null, message: "No compliance found!" });
  assert.deepEqual(readResponse("GetGDA", fault('<s:Detail><code xmlns="eHVD">7000</code></s:Detail>')).kind, "fault");
});

test("anything that is not the SOAP the WSDL describes is refused", () => {
  const cases: [string, string, RegExp][] = [
    ["a DOCTYPE", `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]>${envelope("").slice(21)}`, /DOCTYPE/],
    ["SOAP 1.1", envelope(`<GdaIndexResponse xmlns="eHVD"/>`, "http://schemas.xmlsoap.org/soap/envelope/"), /SOAP 1.2/],
    ["the other operation's response", envelope(`<GdaIndexResponseList xmlns="eHVD"/>`), /Expected GdaIndexResponse/],
    ["two gda in a GetGDA response", envelope(`<GdaIndexResponse xmlns="eHVD">${gda("<surname>A</surname>")}${gda("<surname>B</surname>")}</GdaIndexResponse>`), /more than one gda/],
    ["a gda without surname", envelope(`<GdaIndexResponse xmlns="eHVD">${gda("")}</GdaIndexResponse>`), /without surname/],
    ["a response in another namespace", envelope(`<GdaIndexResponse xmlns="urn:other"/>`), /Expected GdaIndexResponse/],
    ["XML that is not well-formed", "<s:Envelope", /Not XML/],
  ];
  for (const [label, xml, reason] of cases) assert.throws(() => readResponse("GetGDA", xml), (e: Error) => e instanceof SoapError && reason.test(e.message), label);
});
