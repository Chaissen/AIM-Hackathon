import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/env";
import { eidSessionCookie, loginTransactionCookie, signLoginTransaction } from "@/server/auth/eid-session";
import { startLogin } from "@/server/auth/id-austria";
import { findOpenRequest } from "@/server/portal/data";

const publicOrigin = new URL(env.PUBLIC_URL).origin;

// 303, so the browser follows every redirect with a GET.
const seeOther = (url: URL) => NextResponse.redirect(url, 303);

// POST /auth/login: the landing page's form sends the person to ID Austria (docs/IDENTITY.md, "The login for T07").
export async function POST(request: NextRequest) {
  // Browsers send Origin with every POST. Another site's form must neither start a login nor drop a session.
  if (request.headers.get("origin") !== publicOrigin) return seeOther(new URL("/auth/failed", env.PUBLIC_URL));
  const token = (await request.formData().catch(() => null))?.get("token");
  const response = await start(typeof token === "string" ? token : "");
  response.cookies.delete({ name: eidSessionCookie.name, path: eidSessionCookie.path });
  return response;
}

async function start(token: string): Promise<NextResponse> {
  if (!token) return seeOther(new URL("/auth/failed", env.PUBLIC_URL));
  const landing = new URL(`/r/${encodeURIComponent(token)}`, env.PUBLIC_URL);
  try {
    if (!(await findOpenRequest(token))) return seeOther(landing);
    const { url, transaction } = await startLogin(token);
    const response = seeOther(url);
    response.cookies.set({ ...loginTransactionCookie, value: await signLoginTransaction(transaction) });
    return response;
  } catch (error) {
    console.error(`ID Austria login could not start: ${error instanceof Error ? error.message : "unknown error"}`);
    landing.searchParams.set("login", "failed");
    return seeOther(landing);
  }
}
