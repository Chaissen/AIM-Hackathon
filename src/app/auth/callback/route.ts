import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/env";
import {
  eidSessionCookie,
  type LoginTransaction,
  loginTransactionCookie,
  readLoginTransaction,
  signEidSession,
} from "@/server/auth/eid-session";
import { endKeycloakSession, finishLogin, sessionFromClaims } from "@/server/auth/id-austria";
import { db } from "@/server/db";
import { findOpenRequest } from "@/server/portal/data";
import { saveIdToken } from "@/server/requests/service";

// GET /auth/callback?code=...&state=...: ID Austria sends the person back here (docs/IDENTITY.md, "The login for T07").
export async function GET(request: NextRequest) {
  const transaction = await readLoginTransaction(request.cookies.get(loginTransactionCookie.name)?.value);
  const response = transaction
    ? await finish(transaction, request.nextUrl.searchParams)
    : NextResponse.redirect(new URL("/auth/failed", env.PUBLIC_URL));
  response.cookies.delete({ name: loginTransactionCookie.name, path: loginTransactionCookie.path });
  return response;
}

async function finish(transaction: LoginTransaction, query: URLSearchParams): Promise<NextResponse> {
  const landing = new URL(`/r/${encodeURIComponent(transaction.token)}`, env.PUBLIC_URL);
  try {
    const { claims, idToken, refreshToken } = await finishLogin(transaction, query);
    await endKeycloakSession(refreshToken);
    const request = await findOpenRequest(transaction.token);
    if (!request) return NextResponse.redirect(landing);
    const session = sessionFromClaims(claims, request.id);
    if (session instanceof Error) throw session;
    // TODO(T08): run the level, name, and person number checks and write `identity_checked`. Only a pass stores the
    // ID token and gets a session, so a wrong person never replaces the token of the right one.
    // A Drizzle error message carries the query parameters, here the raw ID token, and would end up in the log below.
    await saveIdToken(db, request.id, idToken).catch(() => {
      throw new Error("The ID token could not be stored");
    });
    const response = NextResponse.redirect(new URL(`${landing.pathname}/answer`, env.PUBLIC_URL));
    response.cookies.set({ ...eidSessionCookie, value: await signEidSession(session) });
    return response;
  } catch (error) {
    // The message only. Error causes can hold tokens and claims.
    console.error(`ID Austria login failed: ${error instanceof Error ? error.message : "unknown error"}`);
    landing.searchParams.set("login", "failed");
    return NextResponse.redirect(landing);
  }
}
