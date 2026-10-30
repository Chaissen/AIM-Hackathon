import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/env";
import type { WorkspaceSessionResponse } from "@/lib/workspace";
import {
  createWorkspaceSession,
  openWorkspaceSession,
  publicWorkspaceSession,
  requireWorkspaceOrigin,
  verifiedWorkspaceSession,
  WorkspaceAccessError,
  workspaceCookie,
  workspaceCookieOptions,
} from "@/server/auth/workspace-session";
import { withUploadLimit } from "@/server/api/upload-limit";
import { MatrixClient } from "@/server/matrix/client";

const headers = { "Cache-Control": "private, no-store" };
const credentials = z.object({ username: z.string().trim().min(1).max(255), password: z.string().min(1).max(1024) });
const signedOut = (): WorkspaceSessionResponse => ({ status: "signed_out", clinic: env.CLINIC_NAME });

function failure(error: unknown) {
  return error instanceof WorkspaceAccessError
    ? NextResponse.json({ error: error.message }, { status: error.status, headers })
    : NextResponse.json({ error: "Workspace sign-in is unavailable. Try again shortly." }, { status: 503, headers });
}

function clearCookie(response: NextResponse) {
  response.cookies.set({ ...workspaceCookieOptions(), value: "", maxAge: 0, expires: new Date(0) });
  return response;
}

export async function GET(request: Request) {
  try {
    const verified = await verifiedWorkspaceSession(request);
    if (verified) return NextResponse.json(publicWorkspaceSession(verified.session), { headers });
    const response = NextResponse.json(signedOut(), { headers });
    return workspaceCookie(request) ? clearCookie(response) : response;
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    requireWorkspaceOrigin(request);
    const bounded = await withUploadLimit(request, 8 * 1024);
    if (!bounded) return NextResponse.json({ error: "The sign-in request is too large." }, { status: 413, headers });
    const parsed = credentials.safeParse(await bounded.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Enter your username and password." }, { status: 400, headers });
    const { token, session } = await createWorkspaceSession(parsed.data.username, parsed.data.password);
    const response = NextResponse.json(publicWorkspaceSession(session), { headers });
    response.cookies.set({ ...workspaceCookieOptions(), value: token, maxAge: Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)) });
    return response;
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireWorkspaceOrigin(request);
    const session = await openWorkspaceSession(workspaceCookie(request));
    if (session) {
      const client = new MatrixClient(env.MATRIX_HOMESERVER_URL, session.accessToken, session.userId);
      await client.request("POST", "/_matrix/client/v3/logout", {}).catch(() => {});
    }
    return clearCookie(NextResponse.json(signedOut(), { headers }));
  } catch (error) {
    return failure(error);
  }
}
