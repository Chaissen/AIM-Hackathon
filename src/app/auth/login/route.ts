import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/env";
import { eidSessionCookie, loginTransactionCookie, signLoginTransaction } from "@/server/auth/eid-session";
import { startLogin } from "@/server/auth/id-austria";
import { findOpenRequest } from "@/server/portal/data";

// GET /auth/login?token=...: sends the person from the landing page to ID Austria (docs/IDENTITY.md, "The login for T07").
export async function GET(request: NextRequest) {
  const response = await start(request.nextUrl.searchParams.get("token"));
  response.cookies.delete({ name: eidSessionCookie.name, path: eidSessionCookie.path });
  return response;
}

async function start(token: string | null): Promise<NextResponse> {
  if (!token) return NextResponse.redirect(new URL("/auth/failed", env.PUBLIC_URL));
  const landing = new URL(`/r/${encodeURIComponent(token)}`, env.PUBLIC_URL);
  try {
    if (!(await findOpenRequest(token))) return NextResponse.redirect(landing);
    const { url, transaction } = await startLogin(token);
    const response = NextResponse.redirect(url);
    response.cookies.set({ ...loginTransactionCookie, value: await signLoginTransaction(transaction) });
    return response;
  } catch (error) {
    console.error(`ID Austria login could not start: ${error instanceof Error ? error.message : "unknown error"}`);
    landing.searchParams.set("login", "failed");
    return NextResponse.redirect(landing);
  }
}
