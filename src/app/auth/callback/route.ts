import { DrizzleQueryError } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/env";
import {
  eidSession,
  eidSessionCookie,
  type LoginTransaction,
  loginTransactionCookie,
  readLoginTransaction,
  signEidSession,
} from "@/server/auth/eid-session";
import { endKeycloakSession, finishLogin, loginFromClaims, providerUnreachable } from "@/server/auth/id-austria";
import { db } from "@/server/db";
import { runIdentityChecks } from "@/server/identity/login";
import { findOpenRequest } from "@/server/portal/data";
import { portalPath } from "@/server/portal/paths";
import { identityCheckPorts } from "@/server/requests/identity-ports";
import { notifyRequest } from "@/server/requests/notify";
import { saveIdToken } from "@/server/requests/service";

const redirectTo = (path: string) => NextResponse.redirect(new URL(path, env.PUBLIC_URL));

// GET /auth/callback?code=...&state=...: ID Austria sends the person back here (docs/IDENTITY.md, "The login for T07").
export async function GET(request: NextRequest) {
  const transaction = await readLoginTransaction(request.cookies.get(loginTransactionCookie.name)?.value);
  const response = transaction ? await finish(transaction, request.nextUrl.searchParams) : redirectTo("/auth/failed");
  response.cookies.delete({ name: loginTransactionCookie.name, path: loginTransactionCookie.path });
  return response;
}

async function finish(transaction: LoginTransaction, query: URLSearchParams): Promise<NextResponse> {
  const { token } = transaction;
  try {
    const outcome = await verifyLogin(transaction, query);
    const request = await findOpenRequest(token);
    if (!request) return redirectTo(portalPath(token, "closed"));
    const ports = identityCheckPorts(db, (_, notice) => notifyRequest(request, notice));
    const run = await runIdentityChecks(ports, request, `${request.given} ${request.family}`, outcome);
    const response = redirectTo(portalPath(token, run.page));
    if (outcome.ok && run.bound) {
      const session = eidSession.parse({ requestId: request.id, ...outcome.login });
      await saveIdToken(db, request.id, outcome.idToken);
      response.cookies.set({ ...eidSessionCookie, value: await signEidSession(session) });
    }
    return response;
  } catch (error) {
    console.error(`ID Austria login failed: ${logReason(error)}`);
    const landing = new URL(portalPath(token, "closed"), env.PUBLIC_URL);
    landing.searchParams.set("login", "failed");
    return NextResponse.redirect(landing);
  }
}

async function verifyLogin(transaction: LoginTransaction, query: URLSearchParams) {
  try {
    const { claims, idToken, refreshToken } = await finishLogin(transaction, query);
    await endKeycloakSession(refreshToken);
    const login = loginFromClaims(claims);
    if (login instanceof Error) throw login;
    return { ok: true as const, login, idToken };
  } catch (error) {
    if (providerUnreachable(error)) return { ok: false as const, reason: "keycloak_unreachable" as const };
    throw error;
  }
}

// Never an error's cause, which can hold tokens and claims, nor a database error's message, which lists the query
// parameters: names, bPKs, and the raw ID token.
function logReason(error: unknown): string {
  if (error instanceof DrizzleQueryError) return `a database query failed (${error.cause && "code" in error.cause ? String(error.cause.code) : "no code"})`;
  return error instanceof Error ? error.message : "unknown error";
}
