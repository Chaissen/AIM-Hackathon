import { childrenNamed, escapeXml, parseXml, type XmlElement } from "./xml";

// The eHVD wire format from docs/ehvd/eHVD.wsdl (docs/EHVD.md, "Operations"). The WSDL wins over the handbook.

export const SOAP_ENVELOPE = "http://www.w3.org/2003/05/soap-envelope";
export const EHVD_NAMESPACE = "eHVD";

export const OPERATIONS = {
  GetGDA: { action: "eHVD/GetGDA", request: "GetGdaDescriptors", wrapper: "hcIdentifier", response: "GdaIndexResponse" },
  GdaSearch: { action: "eHVD/GdaSearch", request: "GetGdaSearch", wrapper: "hcIdentifierSearch", response: "GdaIndexResponseList" },
} as const;
export type Operation = keyof typeof OPERATIONS;

/** `InstanceIdentifier`, in WSDL order. */
export const GET_GDA_FIELDS = ["oidIssuingAuthority", "id"] as const;
/** `InstanceIdentifierSearch`, in WSDL order. The order matters for schema validation. */
export const SEARCH_FIELDS = [
  "firstname",
  "surname",
  "rolecode",
  "postcode",
  "streetNumber",
  "streetName",
  "city",
  "state",
  "maxResults",
  "ehvdstatus",
  "elgastatus",
  "description",
] as const;

export type GetGdaQuery = { oidIssuingAuthority?: string; id: string };
export type EhvdStatus = "Aktiv" | "Inaktiv";
export type GdaSearchQuery = {
  firstname?: string;
  surname: string;
  rolecode?: string;
  postcode?: string;
  streetNumber?: string;
  streetName?: string;
  city?: string;
  state?: string;
  maxResults: number;
  ehvdstatus?: EhvdStatus;
  elgastatus?: EhvdStatus;
  description?: string;
};

/** The SOAP 1.2 request for one operation. Leaves out absent fields and keeps the WSDL order. */
export function requestXml(operation: "GetGDA", query: GetGdaQuery): string;
export function requestXml(operation: "GdaSearch", query: GdaSearchQuery): string;
export function requestXml(operation: Operation, query: GetGdaQuery | GdaSearchQuery): string {
  const { request, wrapper } = OPERATIONS[operation];
  const fields: readonly string[] = operation === "GetGDA" ? GET_GDA_FIELDS : SEARCH_FIELDS;
  const values = query as Record<string, string | number | undefined>;
  const body = fields
    .filter((name) => values[name] !== undefined)
    .map((name) => `<e:${name}>${escapeXml(String(values[name]))}</e:${name}>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="${SOAP_ENVELOPE}" xmlns:e="${EHVD_NAMESPACE}">` +
    `<soap:Body><e:${request}><e:${wrapper}>${body}</e:${wrapper}></e:${request}></soap:Body></soap:Envelope>`
  );
}

export type GdaAddress = { streetNumber?: string; streetName?: string; city?: string; state?: string; zip?: string; country?: string };

/** `GdaDescriptor` (docs/EHVD.md, "Response: GdaDescriptor"). Repeated elements become arrays, empty when absent. */
export type GdaDescriptor = {
  id: { oidIssuingAuthority?: string; id: string };
  otherID: string[];
  status: { ehvdstatus: string; elgastatus: string };
  firstname?: string;
  surname: string;
  gender?: string;
  title?: string;
  knownname: string[];
  address: GdaAddress[];
  description: string[];
  /** Each value is `<code system OID>:<code>`, for example `1.2.40.0.34.5.2:159`. */
  roles: { role: string[]; elgaRole: string[]; specialisation: string[] };
  relations: { memberof: string[]; ownerof: string[] };
  tel?: string;
  fax?: string;
  web?: string;
  mail?: string;
  timestamps: { add?: string; modify?: string };
};

export const FAULT_CODES = [6001, 6002, 6003, 6004, 6005, 6006] as const;
export type FaultCode = (typeof FAULT_CODES)[number];

export type SoapAnswer = { kind: "gdas"; gdas: GdaDescriptor[] } | { kind: "fault"; code: FaultCode | null; message: string };

export class SoapError extends Error {}

const child = (element: XmlElement, local: string) => childrenNamed(element, EHVD_NAMESPACE, local);
const texts = (element: XmlElement, local: string) => child(element, local).map((e) => e.text.trim());
const optional = (element: XmlElement, local: string) => {
  const [first, ...more] = texts(element, local);
  if (more.length) throw new SoapError(`More than one ${local}`);
  return first === undefined || first === "" ? undefined : first;
};
const required = (element: XmlElement, local: string) => {
  const value = optional(element, local);
  if (value === undefined) throw new SoapError(`A gda without ${local}`);
  return value;
};
const single = (element: XmlElement, local: string) => {
  const found = child(element, local);
  if (found.length > 1) throw new SoapError(`More than one ${local}`);
  return found[0];
};

const readAddress = (address: XmlElement): GdaAddress => ({
  streetNumber: optional(address, "streetNumber"),
  streetName: optional(address, "streetName"),
  city: optional(address, "city"),
  state: optional(address, "state"),
  zip: optional(address, "zip"),
  country: optional(address, "country"),
});

/**
 * One `gda` element. Reads elements by name, not by position, and ignores unknown ones, so a newer service version
 * with extra fields still works. Throws a SoapError without `id/id`, `status`, or `surname`: the checks need them.
 */
function readDescriptor(gda: XmlElement): GdaDescriptor {
  const id = single(gda, "id");
  const status = single(gda, "status");
  if (!id) throw new SoapError("A gda without id");
  if (!status) throw new SoapError("A gda without status");
  const roles = single(gda, "roles");
  const relations = single(gda, "relations");
  const timestamps = single(gda, "timestamps");
  return {
    id: { id: required(id, "id"), oidIssuingAuthority: optional(id, "oidIssuingAuthority") },
    otherID: texts(gda, "otherID"),
    status: { ehvdstatus: required(status, "ehvdstatus"), elgastatus: required(status, "elgastatus") },
    firstname: optional(gda, "firstname"),
    surname: required(gda, "surname"),
    gender: optional(gda, "gender"),
    title: optional(gda, "title"),
    knownname: texts(gda, "knownname"),
    address: child(gda, "address").map(readAddress),
    description: texts(gda, "description"),
    roles: {
      role: roles ? texts(roles, "role") : [],
      elgaRole: roles ? texts(roles, "elgaRole") : [],
      specialisation: roles ? texts(roles, "specialisation") : [],
    },
    relations: { memberof: relations ? texts(relations, "memberof") : [], ownerof: relations ? texts(relations, "ownerof") : [] },
    tel: optional(gda, "tel"),
    fax: optional(gda, "fax"),
    web: optional(gda, "web"),
    mail: optional(gda, "mail"),
    timestamps: timestamps ? { add: optional(timestamps, "add"), modify: optional(timestamps, "modify") } : {},
  };
}

/** The eHVD fault number from `soap:Detail` (docs/EHVD.md, "Our choices"), or null if there is none. */
function readFault(fault: XmlElement): SoapAnswer {
  const reason = childrenNamed(fault, SOAP_ENVELOPE, "Reason")[0];
  const message = reason ? (childrenNamed(reason, SOAP_ENVELOPE, "Text")[0]?.text.trim() ?? "") : "";
  const detail = childrenNamed(fault, SOAP_ENVELOPE, "Detail")[0];
  const number = detail ? Number(child(detail, "code")[0]?.text.trim()) : NaN;
  const code = (FAULT_CODES as readonly number[]).includes(number) ? (number as FaultCode) : null;
  return { kind: "fault", code, message };
}

/**
 * Reads the response to `operation`: the descriptors, or the SOAP fault. Throws a SoapError for anything else,
 * such as XML that is not a SOAP 1.2 envelope or the response element of the other operation.
 */
export function readResponse(operation: Operation, xml: string): SoapAnswer {
  let envelope: XmlElement;
  try {
    envelope = parseXml(xml);
  } catch (error) {
    throw new SoapError(`Not XML: ${(error as Error).message}`);
  }
  if (envelope.uri !== SOAP_ENVELOPE || envelope.local !== "Envelope") throw new SoapError("Not a SOAP 1.2 envelope");
  const body = childrenNamed(envelope, SOAP_ENVELOPE, "Body");
  if (body.length !== 1) throw new SoapError("The envelope needs exactly one Body");
  const [content, ...more] = body[0].children;
  if (!content || more.length) throw new SoapError("The Body needs exactly one element");
  if (content.uri === SOAP_ENVELOPE && content.local === "Fault") return readFault(content);

  const expected = OPERATIONS[operation].response;
  if (content.uri !== EHVD_NAMESPACE || content.local !== expected) throw new SoapError(`Expected ${expected}`);
  const gdas = child(content, "gda").map(readDescriptor);
  if (operation === "GetGDA" && gdas.length > 1) throw new SoapError("GdaIndexResponse with more than one gda");
  return { kind: "gdas", gdas };
}
