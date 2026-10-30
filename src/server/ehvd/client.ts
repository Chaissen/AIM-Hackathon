import { env } from "@/env";

import {
  type FaultCode,
  type GdaDescriptor,
  type GdaSearchQuery,
  type GetGdaQuery,
  OPERATIONS,
  type Operation,
  readResponse,
  requestXml,
  SoapError,
} from "./soap";

// The typed eHVD client (T15). docs/EHVD.md, "How ordy uses the eHVD", has the calls the checks make.

/**
 * Why a call gave no usable answer. Every one of them means: the eHVD confirmed nothing, so a check that needs it holds.
 * - `unreachable`: no connection, a timeout, a redirect, HTTP 403 (the firewall, or a request the service refused), or another HTTP status
 * - `fault`: a SOAP fault, with the eHVD number when it sent one. GetGDA's 6002 is not a failure but `null`.
 * - `bad_response`: the answer is not the SOAP the WSDL describes, or it is larger than `MAX_RESPONSE_BYTES`
 * - `bad_request`: a value breaks the field rules, so the client did not send it. `field` names the field, never its value.
 */
export type EhvdFailure =
  | { kind: "unreachable"; detail: string }
  | { kind: "fault"; code: FaultCode | null; message: string }
  | { kind: "bad_response"; detail: string }
  | { kind: "bad_request"; field: string; detail: string };

export type EhvdResult<T> = { ok: true; value: T } | { ok: false; failure: EhvdFailure };

export type EhvdClient = {
  /** One entry by id. `null` when the eHVD has none (fault 6002 or an empty response). */
  getGda(query: GetGdaQuery): Promise<EhvdResult<GdaDescriptor | null>>;
  /** All entries that match. More hits than `maxResults` is fault 6005. */
  gdaSearch(query: GdaSearchQuery): Promise<EhvdResult<GdaDescriptor[]>>;
};

export const EHVD_TIMEOUT_MS = 5000;
/** 200 descriptors, the service-wide maximum, take well under 1 MiB. */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

// Allowed characters from docs/EHVD.md, "Allowed characters in requests". ordy searches only exact values, so `*` is
// never allowed: a `*` from a document would turn an exact search into a wildcard search.
const NAME_TEXT = /^[\p{Script=Latin}0-9 .\-~_+=/]+$/u;
const STREET_NUMBER = /^[\p{L}0-9 .\-~_+=/]+$/u;
const RULES: Record<string, { pattern: RegExp; max?: number }> = {
  oidIssuingAuthority: { pattern: /^[0-9.]+$/, max: 24 },
  id: { pattern: /^[A-Za-z0-9.-]+$/, max: 40 },
  firstname: { pattern: NAME_TEXT, max: 128 },
  surname: { pattern: NAME_TEXT, max: 128 },
  rolecode: { pattern: /^[A-Za-z0-9.]+$/ },
  postcode: { pattern: /^[0-9]+$/, max: 10 },
  streetNumber: { pattern: STREET_NUMBER, max: 12 },
  streetName: { pattern: NAME_TEXT, max: 88 },
  city: { pattern: NAME_TEXT, max: 50 },
  state: { pattern: NAME_TEXT, max: 20 },
  description: { pattern: NAME_TEXT, max: 24 },
};

/** The first field that breaks a rule, or null. Values are NFC-normalised first, as the eHVD compares them. */
function invalidField(query: Record<string, unknown>): { field: string; detail: string } | null {
  for (const [field, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (field === "maxResults") {
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 200) return { field, detail: "must be an integer from 1 to 200" };
      continue;
    }
    if (field === "ehvdstatus" || field === "elgastatus") {
      if (value !== "Aktiv" && value !== "Inaktiv") return { field, detail: "must be Aktiv or Inaktiv" };
      continue;
    }
    const rule = RULES[field];
    if (!rule) return { field, detail: "is not a field of this operation" };
    const text = String(value);
    if (text === "" || text !== text.trim()) return { field, detail: "must not be empty or start or end with a blank" };
    if (rule.max !== undefined && [...text].length > rule.max) return { field, detail: `must have at most ${rule.max} characters` };
    if (!rule.pattern.test(text)) return { field, detail: "has a character the eHVD does not allow" };
  }
  return null;
}

const normalise = <T extends object>(query: T): T =>
  Object.fromEntries(Object.entries(query).map(([k, v]) => [k, typeof v === "string" ? v.normalize("NFC") : v])) as T;

/** The body as bytes, or null when it is larger than MAX_RESPONSE_BYTES. */
async function readLimited(response: Response): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

const failed = (failure: EhvdFailure) => ({ ok: false, failure }) as const;

export function createEhvdClient({ url, timeoutMs = EHVD_TIMEOUT_MS }: { url: string; timeoutMs?: number }): EhvdClient {
  /** The descriptors, or null for GetGDA's 6002. */
  async function call(operation: Operation, query: GetGdaQuery | GdaSearchQuery): Promise<EhvdResult<GdaDescriptor[] | null>> {
    const values = normalise(query);
    const invalid = invalidField(values);
    if (invalid) return failed({ kind: "bad_request", ...invalid });

    let status: number;
    let bytes: Uint8Array | null;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": `application/soap+xml; charset=utf-8; action="${OPERATIONS[operation].action}"` },
        body: operation === "GetGDA" ? requestXml("GetGDA", values as GetGdaQuery) : requestXml("GdaSearch", values as GdaSearchQuery),
        // A redirect would carry the request somewhere the firewall rules never covered.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      bytes = await readLimited(response);
    } catch (error) {
      const { name, message, cause } = error as Error & { cause?: { code?: string } };
      return failed({ kind: "unreachable", detail: name === "TimeoutError" ? `no answer within ${timeoutMs} ms` : (cause?.code ?? message) });
    }
    // The firewall and a request the service refuses both answer with an empty 403 (docs/EHVD.md, "Transport and access").
    if (status !== 200 && status !== 400 && status !== 500) return failed({ kind: "unreachable", detail: `HTTP ${status}` });
    if (bytes === null) return failed({ kind: "bad_response", detail: `the answer is larger than ${MAX_RESPONSE_BYTES} bytes` });

    try {
      const answer = readResponse(operation, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (answer.kind === "fault") {
        if (operation === "GetGDA" && answer.code === 6002) return { ok: true, value: null };
        return failed({ kind: "fault", code: answer.code, message: answer.message });
      }
      if (status !== 200) return failed({ kind: "bad_response", detail: `HTTP ${status} without a SOAP fault` });
      return { ok: true, value: answer.gdas };
    } catch (error) {
      if (error instanceof SoapError) return failed({ kind: "bad_response", detail: error.message });
      if (error instanceof TypeError) return failed({ kind: "bad_response", detail: "the answer is not UTF-8" });
      throw error;
    }
  }

  return {
    async getGda(query) {
      const result = await call("GetGDA", query);
      return result.ok ? { ok: true, value: result.value?.[0] ?? null } : result;
    },
    async gdaSearch(query) {
      const result = await call("GdaSearch", query);
      return result.ok ? { ok: true, value: result.value ?? [] } : result;
    },
  };
}

/** The client for `EHVD_URL`. */
export const ehvd = createEhvdClient({ url: env.EHVD_URL });
