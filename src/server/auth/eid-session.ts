import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import { env } from "@/env";
import { oid } from "@/server/ehvd/oid";
import { sessionKey } from "./session-secret";

// Session of an outside person after the ID Austria login (Keycloak in the demo). Bound to exactly one request link.
export const EID_SESSION_COOKIE = "ordy_eid_session";

export const eidSession = z.object({
  requestId: z.number().int(),
  // The bPK from `urn:pvpgvat:oidc.bpk`. Never use `sub`, because real ID Austria sends a transient one.
  personNumber: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  // `urn:pvpgvat:oidc.eid_ida_level`. Only full passes. Null when ID Austria sent none, for example for a foreign eID.
  level: z.enum(["urn:eidgvat:eid.status.full", "urn:eidgvat:eid.status.basic"]).nullable(),
  // The eHVD OID from `urn:eidgvat:attributes.gda`, read with gdaOidFromClaim. Null when the token has no such claim.
  gdaOid: z.string().nullable(),
});
export type EidSession = z.infer<typeof eidSession>;

export const loginTransaction = z.object({
  token: z.string(),
  state: z.string(),
  nonce: z.string(),
  codeVerifier: z.string(),
});
export type LoginTransaction = z.infer<typeof loginTransaction>;

// `urn:eidgvat:attributes.gda` is the person's eHVD entry as base64 of UTF-8 JSON. Only the OID in `gda.id.id` matters here.
const gdaClaim = z
  .base64()
  .transform((value, ctx) => {
    try {
      const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value, "base64")));
      return json;
    } catch {
      ctx.addIssue({ code: "custom", message: "not UTF-8 JSON" });
      return z.NEVER;
    }
  })
  .pipe(z.object({ gda: z.object({ id: z.object({ id: oid }) }) }));

// A present but unreadable claim returns an Error, not null, so the caller fails the identity check
// instead of treating the person as someone the eHVD does not list.
export function gdaOidFromClaim(value: unknown): string | null | Error {
  if (value === undefined) return null;
  const parsed = gdaClaim.safeParse(value);
  return parsed.success ? parsed.data.gda.id.id : new Error(`urn:eidgvat:attributes.gda is malformed: ${z.prettifyError(parsed.error)}`);
}

const secure = new URL(env.PUBLIC_URL).protocol === "https:";

export const eidSessionCookie = { name: EID_SESSION_COOKIE, path: "/", maxAge: 30 * 60, httpOnly: true, sameSite: "lax", secure } as const;
export const loginTransactionCookie = { name: "ordy_eid_login", path: "/auth/callback", maxAge: 10 * 60, httpOnly: true, sameSite: "lax", secure } as const;

const sign = (payload: EidSession | LoginTransaction, maxAge: number) =>
  new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${maxAge}s`).sign(sessionKey(env.ORDY_SECRET));

async function read<Schema extends z.ZodType>(cookie: string | undefined, schema: Schema): Promise<z.infer<Schema> | null> {
  if (!cookie) return null;
  try {
    const { payload } = await jwtVerify(cookie, sessionKey(env.ORDY_SECRET), { algorithms: ["HS256"], requiredClaims: ["exp", "iat"] });
    return schema.parse(payload);
  } catch {
    return null;
  }
}

export const signEidSession = (session: EidSession) => sign(session, eidSessionCookie.maxAge);
export const readEidSession = (cookie: string | undefined) => read(cookie, eidSession);

export const signLoginTransaction = (transaction: LoginTransaction) => sign(transaction, loginTransactionCookie.maxAge);
export const readLoginTransaction = (cookie: string | undefined) => read(cookie, loginTransaction);
