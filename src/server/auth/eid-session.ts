import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import { env } from "@/env";

// Session of an outside person after the ID Austria login (Keycloak in the demo). Bound to exactly one request link.
export const EID_SESSION_COOKIE = "ordy_eid_session";

export const eidSession = z.object({
  requestId: z.number().int(),
  personNumber: z.string(), // the `sub` claim, stable per person
  givenName: z.string(),
  familyName: z.string(),
  level: z.string(), // `idaustria_level`, must be "full" to pass
});
export type EidSession = z.infer<typeof eidSession>;

const key = new TextEncoder().encode(env.ORDY_SECRET);

export const signEidSession = (session: EidSession) =>
  new SignJWT(session).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30m").sign(key);

export async function readEidSession(cookie: string | undefined): Promise<EidSession | null> {
  if (!cookie) return null;
  try {
    const { payload } = await jwtVerify(cookie, key, { algorithms: ["HS256"] });
    return eidSession.parse(payload);
  } catch {
    return null;
  }
}
