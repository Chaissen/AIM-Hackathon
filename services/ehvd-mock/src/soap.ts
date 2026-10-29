import { MIMEType } from "node:util";

import { SaxesParser } from "saxes";

const SOAP_ENVELOPE = "http://www.w3.org/2003/05/soap-envelope";
const SOAP_ROLE = `${SOAP_ENVELOPE}/role/`;
const XMLNS = "http://www.w3.org/2000/xmlns/";
const EHVD = "eHVD";

type Particle<Name extends string = string> = { name: Name; type: "xs:string" | "xs:integer"; minOccurs: 0 | 1; maxOccurs: 1 };

const instanceIdentifier = [
  { name: "oidIssuingAuthority", type: "xs:string", minOccurs: 0, maxOccurs: 1 },
  { name: "id", type: "xs:string", minOccurs: 1, maxOccurs: 1 },
] as const satisfies readonly Particle[];

const instanceIdentifierSearch = [
  { name: "firstname", type: "xs:string", minOccurs: 0, maxOccurs: 1 },
  { name: "surname", type: "xs:string", minOccurs: 1, maxOccurs: 1 },
  { name: "rolecode", type: "xs:string", minOccurs: 0, maxOccurs: 1 },
  { name: "postcode", type: "xs:string", minOccurs: 0, maxOccurs: 1 },
  { name: "streetNumber", type: "xs:string", minOccurs: 0, maxOccurs: 1 },
  { name: "streetName", type: "xs:string", minOccurs: 0, maxOccurs: 1 },
  { name: "city", type: "xs:string", minOccurs: 0, maxOccurs: 1 },
  { name: "state", type: "xs:string", minOccurs: 0, maxOccurs: 1 },
  { name: "maxResults", type: "xs:integer", minOccurs: 1, maxOccurs: 1 },
  { name: "ehvdstatus", type: "xs:string", minOccurs: 0, maxOccurs: 1 },
  { name: "elgastatus", type: "xs:string", minOccurs: 0, maxOccurs: 1 },
  { name: "description", type: "xs:string", minOccurs: 0, maxOccurs: 1 },
] as const satisfies readonly Particle[];

export const operations = {
  GetGDA: {
    soapAction: "eHVD/GetGDA",
    element: "GetGdaDescriptors",
    wrapper: "hcIdentifier",
    wrapperType: "InstanceIdentifier",
    sequence: instanceIdentifier,
    response: "GdaIndexResponse",
  },
  GdaSearch: {
    soapAction: "eHVD/GdaSearch",
    element: "GetGdaSearch",
    wrapper: "hcIdentifierSearch",
    wrapperType: "InstanceIdentifierSearch",
    sequence: instanceIdentifierSearch,
    response: "GdaIndexResponseList",
  },
} as const;

export type Operation = keyof typeof operations;

type Fields<S extends readonly Particle[]> = Partial<Record<S[number]["name"], string>>;
export type GetGdaFields = Fields<typeof instanceIdentifier>;
export type SearchFields = Fields<typeof instanceIdentifierSearch>;

export type SoapRequest =
  | { operation: "GetGDA"; fields: GetGdaFields }
  | { operation: "GdaSearch"; fields: SearchFields };

export const faults = {
  6001: { soapCode: "Sender", message: "Content is not valid!" },
  6002: { soapCode: "Receiver", message: "No compliance found!" },
  6003: { soapCode: "Receiver", message: "A general error occurred!" },
  6004: { soapCode: "Receiver", message: "Attribute not found!" },
  6005: { soapCode: "Sender", message: "Maximum numbers of compliances exceeded!" },
  6006: { soapCode: "Receiver", message: "User/Role is not allowed to use this webservice interface!" },
} as const;

export type FaultCode = keyof typeof faults;

type Status = "Aktiv" | "Inaktiv";
export type GdaStatus = { ehvdstatus: "Aktiv"; elgastatus: Status } | { ehvdstatus: "Inaktiv"; elgastatus: "Inaktiv" };

export type GdaAddress = {
  streetNumber?: string;
  streetName?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
};

export type GdaRoles = { role: string[]; elgaRole: string[]; specialisation: string[] };
export type GdaRelationship = { memberof: string[]; ownerof: string[] };
export type GdaTimestamps = { add: string; modify: string };

export type GdaDescriptor = {
  id: { oidIssuingAuthority: string; id: string };
  otherID: string[];
  status: GdaStatus;
  firstname?: string;
  surname: string;
  gender?: string;
  title?: string;
  knownname: string[];
  address: GdaAddress[];
  description: [string, ...string[]];
  roles: GdaRoles;
  relations?: GdaRelationship;
  tel?: string;
  fax?: string;
  web?: string;
  mail?: string;
  timestamps: GdaTimestamps;
};

export type XmlAttribute = { namespace: string; localName: string; value: string };
export type XmlElement = { namespace: string; localName: string; attributes: XmlAttribute[]; children: (XmlElement | string)[] };

export function parseXml(xml: string): XmlElement | undefined {
  // A version="1.1" declaration would otherwise let saxes accept control characters such as &#1;.
  const parser = new SaxesParser({ xmlns: true, forceXMLVersion: true, defaultXMLVersion: "1.0" });
  const open: XmlElement[] = [];
  let root: XmlElement | undefined;
  parser.on("doctype", () => parser.fail("a SOAP message must not contain a DOCTYPE"));
  parser.on("opentag", (tag) => {
    const element: XmlElement = {
      namespace: tag.uri,
      localName: tag.local,
      // XML Schema does not count namespace declarations as attributes.
      attributes: Object.values(tag.attributes)
        .filter((attribute) => attribute.uri !== XMLNS)
        .map(({ uri, local, value }) => ({ namespace: uri, localName: local, value })),
      children: [],
    };
    open.at(-1)?.children.push(element);
    root ??= element;
    open.push(element);
  });
  parser.on("closetag", () => open.pop());
  const addText = (text: string) => open.at(-1)?.children.push(text);
  parser.on("text", addText);
  parser.on("cdata", addText);
  // Without an error handler, saxes throws at the first error.
  try {
    parser.write(xml).close();
  } catch {
    return undefined;
  }
  return root;
}

const isXmlSpace = (char: string) => char === " " || char === "\t" || char === "\n" || char === "\r";
const isDigit = (char: string) => char >= "0" && char <= "9";

function elementChildren(parent: XmlElement): XmlElement[] | undefined {
  const elements: XmlElement[] = [];
  for (const child of parent.children) {
    if (typeof child !== "string") elements.push(child);
    else if (![...child].every(isXmlSpace)) return undefined;
  }
  return elements;
}

const leafText = (element: XmlElement) =>
  element.children.every((child) => typeof child === "string") ? element.children.join("") : undefined;

function trimXmlSpace(text: string) {
  const chars = [...text];
  while (chars.length > 0 && isXmlSpace(chars[0])) chars.shift();
  while (chars.length > 0 && isXmlSpace(chars[chars.length - 1])) chars.pop();
  return chars.join("");
}

function integerLexical(text: string): string | undefined {
  const trimmed = trimXmlSpace(text);
  const digits = [...(trimmed.startsWith("+") || trimmed.startsWith("-") ? trimmed.slice(1) : trimmed)];
  return digits.length > 0 && digits.every(isDigit) ? trimmed : undefined;
}

const is = (element: XmlElement, namespace: string, name: string) => element.namespace === namespace && element.localName === name;
const hasNoAttributes = (element: XmlElement) => element.attributes.length === 0;
const attribute = (element: XmlElement, namespace: string, name: string) =>
  element.attributes.find((candidate) => candidate.namespace === namespace && candidate.localName === name)?.value;

function mustBeUnderstood(block: XmlElement) {
  const mustUnderstand = trimXmlSpace(attribute(block, SOAP_ENVELOPE, "mustUnderstand") ?? "");
  const role = attribute(block, SOAP_ENVELOPE, "role");
  const forUs = role === undefined || [`${SOAP_ROLE}next`, `${SOAP_ROLE}ultimateReceiver`].includes(trimXmlSpace(role));
  return (mustUnderstand === "true" || mustUnderstand === "1") && forUs;
}

function readSequence<Name extends string>(parent: XmlElement, sequence: readonly Particle<Name>[]) {
  const children = elementChildren(parent);
  if (!children) return undefined;
  const fields: Partial<Record<Name, string>> = {};
  let next = 0;
  for (const child of children) {
    if (child.namespace !== EHVD || !hasNoAttributes(child)) return undefined;
    while (next < sequence.length && sequence[next].name !== child.localName) {
      if (sequence[next].minOccurs === 1) return undefined;
      next += 1;
    }
    const particle: Particle<Name> | undefined = sequence[next];
    if (!particle) return undefined;
    const text = leafText(child);
    const value = text !== undefined && particle.type === "xs:integer" ? integerLexical(text) : text;
    if (value === undefined) return undefined;
    fields[particle.name] = value;
    next += 1;
  }
  return sequence.slice(next).every((particle) => particle.minOccurs === 0) ? fields : undefined;
}

function readWrapped<Name extends string>(element: XmlElement, operation: { wrapper: string; sequence: readonly Particle<Name>[] }) {
  const children = elementChildren(element);
  const wrapper = children?.length === 1 ? children[0] : undefined;
  if (!wrapper || !is(wrapper, EHVD, operation.wrapper) || ![element, wrapper].every(hasNoAttributes)) return undefined;
  return readSequence(wrapper, operation.sequence);
}

function parseContentType(header: string | undefined) {
  try {
    return new MIMEType(header ?? "");
  } catch {
    return undefined;
  }
}

function decodeUtf8(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function readEnvelope(xml: string): SoapRequest | undefined {
  const envelope = parseXml(xml);
  if (!envelope || !is(envelope, SOAP_ENVELOPE, "Envelope")) return undefined;
  const parts = elementChildren(envelope) ?? [];
  const header = parts.length === 2 && is(parts[0], SOAP_ENVELOPE, "Header") ? parts[0] : undefined;
  const body = header ? parts[1] : parts.length === 1 ? parts[0] : undefined;
  if (!body || !is(body, SOAP_ENVELOPE, "Body")) return undefined;
  const blocks = header ? elementChildren(header) : [];
  if (!blocks || blocks.some(mustBeUnderstood)) return undefined;
  const content = elementChildren(body);
  if (content?.length !== 1) return undefined;
  const [request] = content;
  if (is(request, EHVD, operations.GetGDA.element)) {
    const fields = readWrapped(request, operations.GetGDA);
    return fields && { operation: "GetGDA", fields };
  }
  if (is(request, EHVD, operations.GdaSearch.element)) {
    const fields = readWrapped(request, operations.GdaSearch);
    return fields && { operation: "GdaSearch", fields };
  }
  return undefined;
}

export function parseRequest(contentType: string | undefined, body: Uint8Array): SoapRequest | undefined {
  const type = parseContentType(contentType);
  if (type?.essence !== "application/soap+xml") return undefined;
  const charset = type.params.get("charset");
  const xml = decodeUtf8(body);
  if ((charset !== null && charset.toLowerCase() !== "utf-8") || xml === undefined) return undefined;
  const request = readEnvelope(xml);
  const action = type.params.get("action");
  if (!request || (action !== null && action !== operations[request.operation].soapAction)) return undefined;
  return request;
}

export const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const node = (name: string, content: string) => `<${name}>${content}</${name}>`;
const leaf = (name: string, value: string | undefined) => (value === undefined ? "" : node(name, escapeXml(value)));
const leaves = (name: string, values: readonly string[]) => values.map((value) => leaf(name, value)).join("");

const addressXml = (address: GdaAddress) =>
  node(
    "address",
    leaf("streetNumber", address.streetNumber) +
      leaf("streetName", address.streetName) +
      leaf("city", address.city) +
      leaf("state", address.state) +
      leaf("zip", address.zip) +
      leaf("country", address.country),
  );

const gdaXml = (gda: GdaDescriptor) =>
  node(
    "gda",
    node("id", leaf("oidIssuingAuthority", gda.id.oidIssuingAuthority) + leaf("id", gda.id.id)) +
      leaves("otherID", gda.otherID) +
      node("status", leaf("ehvdstatus", gda.status.ehvdstatus) + leaf("elgastatus", gda.status.elgastatus)) +
      leaf("firstname", gda.firstname) +
      leaf("surname", gda.surname) +
      leaf("gender", gda.gender) +
      leaf("title", gda.title) +
      leaves("knownname", gda.knownname) +
      gda.address.map(addressXml).join("") +
      leaves("description", gda.description) +
      node(
        "roles",
        leaves("role", gda.roles.role) + leaves("elgaRole", gda.roles.elgaRole) + leaves("specialisation", gda.roles.specialisation),
      ) +
      (gda.relations ? node("relations", leaves("memberof", gda.relations.memberof) + leaves("ownerof", gda.relations.ownerof)) : "") +
      leaf("tel", gda.tel) +
      leaf("fax", gda.fax) +
      leaf("web", gda.web) +
      leaf("mail", gda.mail) +
      node("timestamps", leaf("add", gda.timestamps.add) + leaf("modify", gda.timestamps.modify)),
  );

const envelopeXml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="${SOAP_ENVELOPE}"><soap:Body>${body}</soap:Body></soap:Envelope>`;

export const responseXml = (operation: Operation, gdas: readonly GdaDescriptor[]) =>
  envelopeXml(`<${operations[operation].response} xmlns="${EHVD}">${gdas.map(gdaXml).join("")}</${operations[operation].response}>`);

export const faultXml = (code: FaultCode) =>
  envelopeXml(
    `<soap:Fault><soap:Code><soap:Value>soap:${faults[code].soapCode}</soap:Value></soap:Code>` +
      `<soap:Reason><soap:Text xml:lang="en">${escapeXml(faults[code].message)}</soap:Text></soap:Reason>` +
      `<soap:Detail><code xmlns="${EHVD}">${code}</code></soap:Detail></soap:Fault>`,
  );
