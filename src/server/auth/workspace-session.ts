import { createHash } from "node:crypto";

import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";

import { env } from "@/env";
import type { WorkspaceSessionResponse } from "@/lib/workspace";
import { displayName, MatrixClient, MatrixError } from "@/server/matrix/client";

import { sessionKey } from "./session-secret";

export const WORKSPACE_COOKIE = "ordy_workspace_session";
export const WORKSPACE_MAX_AGE = 8 * 60 * 60;

const identity = z.object({
  userId: z.string().min(1).max(255),
  accessToken: z.string().min(1).max(2048),
  displayName: z.string().min(1).max(100),
});
const claims = identity.extend({ exp: z.number().int(), iat: z.number().int() });
export type WorkspaceSession = z.infer<typeof identity> & { expiresAt: Date };

export class WorkspaceAccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function encryptionKey(secret: string) {
  return createHash("sha256").update("ordy/workspace/session/v1").update(sessionKey(secret)).digest();
}

export function workspaceCookieOptions() {
  return {
    name: WORKSPACE_COOKIE,
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production" || new URL(env.WORKSPACE_URL).protocol === "https:" || new URL(env.PUBLIC_URL).protocol === "https:",
  };
}

export function allowedWorkspaceOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && [new URL(env.WORKSPACE_URL).origin, new URL(env.PUBLIC_URL).origin].includes(origin);
}

export function requireWorkspaceOrigin(request: Request) {
  if (!allowedWorkspaceOrigin(request)) throw new WorkspaceAccessError(403, "This request must come from the ordy workspace.");
}

export function workspaceCookie(request: Request): string | undefined {
  const prefix = `${WORKSPACE_COOKIE}=`;
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
}

export async function sealWorkspaceSession(
  value: z.infer<typeof identity>,
  { secret = env.ORDY_SECRET, at = new Date(), maxAge = WORKSPACE_MAX_AGE }: { secret?: string; at?: Date; maxAge?: number } = {},
) {
  const payload = identity.parse(value);
  const issued = Math.floor(at.getTime() / 1000);
  const expires = issued + Math.min(WORKSPACE_MAX_AGE, Math.max(1, Math.floor(maxAge)));
  const token = await new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer("ordy")
    .setAudience("ordy-workspace")
    .setIssuedAt(issued)
    .setExpirationTime(expires)
    .encrypt(encryptionKey(secret));
  if (token.length > 3800) throw new WorkspaceAccessError(503, "Workspace sign-in is not available.");
  return { token, session: { ...payload, expiresAt: new Date(expires * 1000) } };
}

export async function openWorkspaceSession(
  token: string | undefined,
  { secret = env.ORDY_SECRET, at = new Date() }: { secret?: string; at?: Date } = {},
): Promise<WorkspaceSession | null> {
  if (!token || token.length > 3800) return null;
  try {
    const { payload } = await jwtDecrypt(token, encryptionKey(secret), {
      issuer: "ordy",
      audience: "ordy-workspace",
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      requiredClaims: ["iat", "exp"],
      maxTokenAge: WORKSPACE_MAX_AGE,
      currentDate: at,
    });
    const parsed = claims.parse(payload);
    return { userId: parsed.userId, accessToken: parsed.accessToken, displayName: parsed.displayName, expiresAt: new Date(parsed.exp * 1000) };
  } catch {
    return null;
  }
}

const localUser = (userId: string) => userId.startsWith("@") && userId.endsWith(`:${env.MATRIX_SERVER_NAME}`);

export async function verifiedWorkspaceSession(request: Request): Promise<{ session: WorkspaceSession; client: MatrixClient } | null> {
  const session = await openWorkspaceSession(workspaceCookie(request));
  if (!session || !localUser(session.userId)) return null;
  const client = new MatrixClient(env.MATRIX_HOMESERVER_URL, session.accessToken, session.userId);
  try {
    const who = z.object({ user_id: z.string() }).parse(await client.request<unknown>("GET", "/_matrix/client/v3/account/whoami"));
    return who.user_id === session.userId && localUser(who.user_id) ? { session, client } : null;
  } catch (error) {
    if (error instanceof MatrixError && (error.status === 401 || error.status === 403)) return null;
    throw new WorkspaceAccessError(503, "The network service is unavailable. Try again shortly.");
  }
}

export function publicWorkspaceSession(session: WorkspaceSession): WorkspaceSessionResponse {
  return {
    status: "signed_in",
    user: { mxid: session.userId, displayName: session.displayName, clinic: env.CLINIC_NAME },
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function createWorkspaceSession(username: string, password: string) {
  try {
    encryptionKey(env.ORDY_SECRET);
  } catch {
    throw new WorkspaceAccessError(503, "Workspace sign-in is not configured. Contact your administrator.");
  }
  let client: MatrixClient | undefined;
  try {
    const login = await MatrixClient.loginWorkspace(username, password);
    client = login.client;
    const who = z.object({ user_id: z.string() }).parse(await client.request<unknown>("GET", "/_matrix/client/v3/account/whoami"));
    if (who.user_id !== client.userId || !localUser(who.user_id)) throw new WorkspaceAccessError(403, "Use an account from this clinic's network.");
    const name = await displayName(client.userId);
    const maxAge = login.expiresInMs === undefined ? WORKSPACE_MAX_AGE : Math.floor(login.expiresInMs / 1000);
    return await sealWorkspaceSession({ userId: client.userId, accessToken: client.accessToken, displayName: name ?? client.userId.slice(0, 100) }, { maxAge });
  } catch (error) {
    if (client) await client.request("POST", "/_matrix/client/v3/logout", {}).catch(() => {});
    if (error instanceof WorkspaceAccessError) throw error;
    if (error instanceof MatrixError && (error.status === 401 || error.status === 403)) throw new WorkspaceAccessError(401, "The username or password is incorrect.");
    if (error instanceof MatrixError && error.status === 429) throw new WorkspaceAccessError(429, "Too many sign-in attempts. Try again shortly.");
    throw new WorkspaceAccessError(503, "The network service is unavailable. Try again shortly.");
  }
}
