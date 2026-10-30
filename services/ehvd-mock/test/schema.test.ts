import assert from "node:assert/strict";
import { after, test } from "node:test";

import { envelope, faultEnvelope, getGdaXml, oids, post, searchXml, start } from "./http.ts";

const EVA_BRANDL = "1.2.40.0.34.3.2.99.1.2";
const SOAP_12 = "application/soap+xml; charset=utf-8";
const SOAP_ENV = "http://www.w3.org/2003/05/soap-envelope";
const XSI = "http://www.w3.org/2001/XMLSchema-instance";
const NONE_ROLE = `${SOAP_ENV}/role/none`;

const strict = await start();
const lenient = await start({ EHVD_SCHEMA_ERRORS: "fault-6001" });
after(strict.close);
after(lenient.close);

const search = (inner: string) => envelope(`<e:GetGdaSearch><e:hcIdentifierSearch>${inner}</e:hcIdentifierSearch></e:GetGdaSearch>`);
const brandl = searchXml({ surname: "Brandl", maxResults: "10" });
const withHeader = (block: string) => brandl.replace("<soap:Body>", `<soap:Header>${block}</soap:Header><soap:Body>`);

const [beforeName, afterName] = brandl.split("Brandl");
const invalidUtf8 = Buffer.concat([Buffer.from(beforeName), Buffer.from([0xff]), Buffer.from(afterName)]);

const brokenRequests: [string, string, string | Buffer][] = [
  ["SOAP 1.1 media type", "text/xml; charset=utf-8", brandl],
  ["action of the other operation", `${SOAP_12}; action="eHVD/GetGDA"`, brandl],
  ["charset other than UTF-8", "application/soap+xml; charset=iso-8859-1", brandl],
  [
    "SOAP 1.1 envelope",
    SOAP_12,
    brandl.replace(SOAP_ENV, "http://schemas.xmlsoap.org/soap/envelope/"),
  ],
  ["malformed XML", SOAP_12, brandl.replace("</soap:Body>", "")],
  ["bare & in a header block", SOAP_12, withHeader('<x:trace xmlns:x="urn:x">&</x:trace>')],
  ["DOCTYPE", SOAP_12, `<!DOCTYPE soap:Envelope>${brandl.replace('<?xml version="1.0" encoding="UTF-8"?>', "")}`],
  ["invalid UTF-8", SOAP_12, invalidUtf8],
  ["control character, not allowed in XML 1.0", SOAP_12, searchXml({ surname: "Brandl\u0001", maxResults: "10" })],
  ["character reference to U+0000 in a field", SOAP_12, getGdaXml({ id: `${EVA_BRANDL}&#0;` })],
  ["character reference to U+0000 in a header block", SOAP_12, withHeader('<x:trace xmlns:x="urn:x">&#0;</x:trace>')],
  ["character reference beyond U+10FFFF in a header block", SOAP_12, withHeader('<x:trace xmlns:x="urn:x">&#x100010000;</x:trace>')],
  [
    "character reference to U+0001 in a document that declares XML 1.1",
    SOAP_12,
    withHeader('<x:trace xmlns:x="urn:x">&#1;</x:trace>').replace('version="1.0"', 'version="1.1"'),
  ],
  ["header block that must be understood", SOAP_12, withHeader('<x:trace xmlns:x="urn:x" soap:mustUnderstand="true">1</x:trace>')],
  [
    "mustUnderstand twice through two prefixes for the SOAP namespace",
    SOAP_12,
    withHeader(`<x:trace xmlns:x="urn:x" xmlns:a="${SOAP_ENV}" a:mustUnderstand="true" soap:mustUnderstand="false"/>`),
  ],
  ["attribute on a field", SOAP_12, search('<e:surname bogus="1">Brandl</e:surname><e:maxResults>10</e:maxResults>')],
  ["xsi:nil on an optional field", SOAP_12, search(`<e:firstname xmlns:xsi="${XSI}" xsi:nil="true"/><e:surname>Brandl</e:surname><e:maxResults>10</e:maxResults>`)],
  ["attribute on the wrapper", SOAP_12, brandl.replace("<e:hcIdentifierSearch>", '<e:hcIdentifierSearch id="1">')],
  ["xsi:type on the operation element", SOAP_12, brandl.replace("<e:GetGdaSearch>", `<e:GetGdaSearch xmlns:xsi="${XSI}" xsi:type="e:InstanceIdentifierSearch">`)],
  ["two operations in the body", SOAP_12, envelope("<e:GetGdaSearch/><e:GetGdaSearch/>")],
  ["unknown operation", SOAP_12, envelope("<e:GetGdaList><e:hcIdentifierSearch/></e:GetGdaList>")],
  ["wrapper of the other operation", SOAP_12, envelope("<e:GetGdaSearch><e:hcIdentifier><e:id>1</e:id></e:hcIdentifier></e:GetGdaSearch>")],
  ["fields out of WSDL order", SOAP_12, search("<e:maxResults>10</e:maxResults><e:surname>Brandl</e:surname>")],
  ["description before ehvdstatus, as in the handbook", SOAP_12, search("<e:surname>Brandl</e:surname><e:maxResults>10</e:maxResults><e:description>x</e:description><e:ehvdstatus>Aktiv</e:ehvdstatus>")],
  ["missing surname", SOAP_12, search("<e:maxResults>10</e:maxResults>")],
  ["missing maxResults", SOAP_12, search("<e:surname>Brandl</e:surname>")],
  ["duplicate surname", SOAP_12, search("<e:surname>Brandl</e:surname><e:surname>Hofer</e:surname><e:maxResults>10</e:maxResults>")],
  ["unknown field", SOAP_12, search("<e:surname>Brandl</e:surname><e:nickname>x</e:nickname><e:maxResults>10</e:maxResults>")],
  ["unqualified field", SOAP_12, search("<surname>Brandl</surname><e:maxResults>10</e:maxResults>")],
  ["element inside a field", SOAP_12, search("<e:surname><e:b>Brandl</e:b></e:surname><e:maxResults>10</e:maxResults>")],
  ["text between fields", SOAP_12, search("<e:surname>Brandl</e:surname>, <e:maxResults>10</e:maxResults>")],
  ["maxResults not an integer", SOAP_12, searchXml({ surname: "Brandl", maxResults: "ten" })],
  ["maxResults empty", SOAP_12, searchXml({ surname: "Brandl", maxResults: "" })],
  ["maxResults with a decimal point", SOAP_12, searchXml({ surname: "Brandl", maxResults: "10.0" })],
  ["body over 64 KiB, even when only whitespace is past the limit", SOAP_12, `${brandl}${" ".repeat(65536)}`],
];

test("a request that breaks SOAP 1.2 or the WSDL gets an empty HTTP 403, like the real firewall", async () => {
  for (const [name, contentType, xml] of brokenRequests) {
    const response = await fetch(`${strict.url}/`, { method: "POST", headers: { "content-type": contentType }, body: xml });
    assert.deepEqual({ status: response.status, body: await response.text() }, { status: 403, body: "" }, name);
  }
});

test("EHVD_SCHEMA_ERRORS=fault-6001 turns the same requests into fault 6001", async () => {
  for (const [name, contentType, xml] of brokenRequests) {
    const response = await fetch(`${lenient.url}/`, { method: "POST", headers: { "content-type": contentType }, body: xml });
    assert.deepEqual(
      { status: response.status, body: await response.text() },
      { status: 400, body: faultEnvelope("Sender", "Content is not valid!", 6001) },
      name,
    );
  }
});

test("a SOAP 1.2 request may carry optional headers, comments, whitespace, namespace declarations, and the right action", async () => {
  const requests: [string, string, string][] = [
    ["matching action", `${SOAP_12}; action="eHVD/GdaSearch"`, brandl],
    ["unquoted action, no charset", "Application/SOAP+XML; action=eHVD/GdaSearch", brandl],
    ["quoted parameter with a semicolon", `${SOAP_12}; extension="a;b"`, brandl],
    [
      "header, comments, and whitespace between elements",
      SOAP_12,
      search("\n  <!-- by surname -->\n  <e:surname>Brandl</e:surname>\n  <e:maxResults>10</e:maxResults>\n").replace(
        "<soap:Body>",
        '<soap:Header><x:trace xmlns:x="urn:x">1</x:trace></soap:Header>\n<soap:Body>',
      ),
    ],
    ["maxResults with surrounding whitespace, as xs:integer allows", SOAP_12, searchXml({ surname: "Brandl", maxResults: " +10\n" })],
    ["CDATA and character references", SOAP_12, search("<e:surname><![CDATA[Bran]]>&#x64;l</e:surname><e:maxResults>10</e:maxResults>")],
    ["namespace declaration on a field", SOAP_12, search('<e:surname xmlns:x="urn:x">Brandl</e:surname><e:maxResults>10</e:maxResults>')],
    ["mandatory header block for the role none", SOAP_12, withHeader(`<x:trace xmlns:x="urn:x" soap:mustUnderstand="true" soap:role="${NONE_ROLE}">1</x:trace>`)],
  ];
  for (const [name, contentType, xml] of requests) {
    const { status, body } = await post(strict.url, xml, contentType);
    assert.equal(status, 200, name);
    assert.deepEqual(oids(body), [EVA_BRANDL, "1.2.40.0.34.3.2.99.1.4"], name);
  }
});
