import * as oidc from "openid-client";
import { z } from "zod";

import { env } from "@/env";
import { gdaOidFromClaim, type LoginTransaction } from "@/server/auth/eid-session";
import type { LoginIdentity } from "@/server/identity/checks";

const metadataUrl = new URL(env.OIDC_METADATA_URL);
const redirectUri = new URL("/auth/callback", env.PUBLIC_URL);
const localProvider = metadataUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(metadataUrl.hostname);

let discovered: Promise<oidc.Configuration> | undefined;

function provider(): Promise<oidc.Configuration> {
  discovered ??= oidc
    .discovery(metadataUrl, env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET, oidc.ClientSecretPost(env.OIDC_CLIENT_SECRET), {
      // openid-client skips the signature of an ID token from the token endpoint unless asked to check it.
      execute: localProvider ? [oidc.enableNonRepudiationChecks, oidc.allowInsecureRequests] : [oidc.enableNonRepudiationChecks],
    })
    .catch((error: unknown) => {
      discovered = undefined;
      throw error;
    });
  return discovered;
}

export async function startLogin(token: string): Promise<{ url: URL; transaction: LoginTransaction }> {
  const config = await provider();
  const transaction = { token, state: oidc.randomState(), nonce: oidc.randomNonce(), codeVerifier: oidc.randomPKCECodeVerifier() };
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri.href,
    scope: "openid profile",
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(transaction.codeVerifier),
    code_challenge_method: "S256",
    prompt: "login",
  });
  return { url, transaction };
}

export async function finishLogin(transaction: LoginTransaction, query: URLSearchParams) {
  const config = await provider();
  // Built from PUBLIC_URL, not the request URL. openid-client sends it without its query as `redirect_uri`, which must equal the login's.
  const currentUrl = new URL(redirectUri);
  currentUrl.search = query.toString();
  const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims || !tokens.id_token) throw new Error("The token response has no ID token");
  return { claims, idToken: tokens.id_token, refreshToken: tokens.refresh_token };
}

// Keycloak's legacy logout. Real ID Austria lists no `end_session_endpoint`, so this does nothing there.
export async function endKeycloakSession(refreshToken: string | undefined) {
  const endpoint = (await provider()).serverMetadata().end_session_endpoint;
  if (!endpoint) return;
  if (!refreshToken) {
    console.error("Keycloak logout skipped: the token response has no refresh token");
    return;
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: new URLSearchParams({ client_id: env.OIDC_CLIENT_ID, client_secret: env.OIDC_CLIENT_SECRET, refresh_token: refreshToken }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) console.error(`Keycloak logout failed with HTTP ${response.status}`);
  } catch (error) {
    console.error(`Keycloak logout failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

const UNAVAILABLE = new Set([502, 503, 504]);

export function providerUnreachable(error: unknown): boolean {
  if (error instanceof oidc.ClientError) {
    if (error.code === "OAUTH_TIMEOUT" || error.code === "OAUTH_ABORT") return true;
    return error.cause instanceof Response && UNAVAILABLE.has(error.cause.status);
  }
  // fetch rejects with a TypeError whose cause is the network error. openid-client's own TypeErrors carry a code instead.
  return error instanceof TypeError && !("code" in error) && error.cause instanceof Error;
}

const idAustriaClaims = z.object({
  "urn:pvpgvat:oidc.bpk": z.string().nullish(),
  given_name: z.string(),
  family_name: z.string(),
  "urn:pvpgvat:oidc.eid_ida_level": z.unknown().optional(),
  "urn:eidgvat:attributes.gda": z.unknown().optional(),
});

export function loginFromClaims(claims: unknown): LoginIdentity | Error {
  const parsed = idAustriaClaims.safeParse(claims);
  if (!parsed.success) return new Error(`The ID token claims are malformed: ${z.prettifyError(parsed.error)}`);
  return {
    givenName: parsed.data.given_name,
    familyName: parsed.data.family_name,
    personNumber: parsed.data["urn:pvpgvat:oidc.bpk"] ?? null,
    level: parsed.data["urn:pvpgvat:oidc.eid_ida_level"],
    gdaOid: gdaOidFromClaim(parsed.data["urn:eidgvat:attributes.gda"]),
  };
}
