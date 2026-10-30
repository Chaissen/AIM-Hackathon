import { z } from "zod";

import { env, mxid } from "@/env";

// Minimal Matrix client-server API client. No E2EE (not required by the track), no native dependencies.

export type MatrixEvent = {
  type: string;
  event_id: string;
  sender: string;
  state_key?: string;
  origin_server_ts: number;
  content: Record<string, unknown>;
};

export type SyncResponse = {
  next_batch: string;
  rooms?: {
    join?: Record<string, { timeline?: { events: MatrixEvent[] } }>;
    invite?: Record<string, unknown>;
  };
};

export class MatrixError extends Error {
  constructor(readonly status: number, readonly errcode: string | undefined, message: string) {
    super(`Matrix ${status} ${errcode ?? ""}: ${message}`);
  }
}

export class MatrixClient {
  private txn = 0;

  constructor(readonly baseUrl: string, readonly accessToken: string, readonly userId: string) {}

  static async login(user: string, password: string, baseUrl = env.MATRIX_HOMESERVER_URL) {
    const res = await raw<{ access_token: string; user_id: string }>(baseUrl, "POST", "/_matrix/client/v3/login", {
      type: "m.login.password",
      identifier: { type: "m.id.user", user },
      password,
      initial_device_display_name: "ordy",
    });
    return new MatrixClient(baseUrl, res.access_token, res.user_id);
  }

  static async loginWorkspace(user: string, password: string, baseUrl = env.MATRIX_HOMESERVER_URL) {
    const result = z.object({
      access_token: z.string().min(1).max(2048),
      user_id: z.string().min(1).max(255),
      expires_in_ms: z.number().positive().optional(),
    }).parse(await raw<unknown>(baseUrl, "POST", "/_matrix/client/v3/login", {
      type: "m.login.password",
      identifier: { type: "m.id.user", user },
      password,
      initial_device_display_name: "ordy workspace",
    }));
    return { client: new MatrixClient(baseUrl, result.access_token, result.user_id), expiresInMs: result.expires_in_ms };
  }

  request<T>(method: string, path: string, body?: unknown, timeoutMs?: number) {
    return raw<T>(this.baseUrl, method, path, body, this.accessToken, timeoutMs);
  }

  sync(since?: string, timeoutMs = 30_000) {
    const q = new URLSearchParams({ timeout: String(timeoutMs) });
    if (since) q.set("since", since);
    else q.set("filter", JSON.stringify({ room: { timeline: { limit: 0 } } }));
    return this.request<SyncResponse>("GET", `/_matrix/client/v3/sync?${q}`, undefined, timeoutMs + 15_000);
  }

  joinRoom(roomIdOrAlias: string) {
    return this.request<{ room_id: string }>("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomIdOrAlias)}`, {});
  }

  sendMessage(roomId: string, text: string, html?: string) {
    const content = html
      ? { msgtype: "m.notice", body: text, format: "org.matrix.custom.html", formatted_body: html }
      : { msgtype: "m.notice", body: text };
    return this.sendEvent(roomId, "m.room.message", content);
  }

  sendEvent(roomId: string, type: string, content: unknown) {
    const txnId = `${Date.now()}-${this.txn++}`;
    return this.request<{ event_id: string }>(
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(type)}/${txnId}`,
      content,
    );
  }

  setState(roomId: string, type: string, stateKey: string, content: unknown) {
    return this.request<{ event_id: string }>(
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(type)}/${encodeURIComponent(stateKey)}`,
      content,
    );
  }

  async resolveAlias(alias: string): Promise<string | null> {
    try {
      const res = await this.request<{ room_id: string }>("GET", `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`);
      return res.room_id;
    } catch (e) {
      if (e instanceof MatrixError && e.status === 404) return null;
      throw e;
    }
  }

  createRoom(options: Record<string, unknown>) {
    return this.request<{ room_id: string }>("POST", "/_matrix/client/v3/createRoom", options);
  }

  setDisplayName(displayname: string) {
    return this.request("PUT", `/_matrix/client/v3/profile/${encodeURIComponent(this.userId)}/displayname`, { displayname });
  }
}

async function raw<T>(baseUrl: string, method: string, path: string, body?: unknown, token?: string, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as { errcode?: string; error?: string };
  if (!res.ok) throw new MatrixError(res.status, json.errcode, json.error ?? res.statusText);
  return json as T;
}

/**
 * Verifies an OpenID token that a Matrix widget got from Element (matrix-widget-api `requestOpenIDConnectToken`).
 * Returns the user's Matrix ID if the token is valid and the user belongs to our homeserver.
 */
export async function verifyOpenIdToken(token: string): Promise<string | null> {
  try {
    const res = await raw<{ sub: string }>(
      env.MATRIX_HOMESERVER_URL,
      "GET",
      `/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(token)}`,
    );
    return res.sub.endsWith(`:${env.MATRIX_SERVER_NAME}`) ? res.sub : null;
  } catch {
    return null;
  }
}

/**
 * A user's display name on the homeserver, such as "Dr. Lena Hofer". Null if there is none or Matrix is not reachable.
 * Users set it themselves, so it comes back as one line of at most 100 characters: it ends up in emails and SMS.
 */
export async function displayName(userId: string): Promise<string | null> {
  try {
    const res = await raw<{ displayname?: string }>(
      env.MATRIX_HOMESERVER_URL,
      "GET",
      `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`,
      undefined,
      undefined,
      5_000,
    );
    return (
      res.displayname
        ?.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100) || null
    );
  } catch {
    return null;
  }
}

// One logged-in bot client per process, used for notifications from the web app and the bot alike.
let botClient: Promise<MatrixClient> | undefined;
export function getBotClient() {
  botClient ??= MatrixClient.login(env.MATRIX_BOT_USER, env.MATRIX_BOT_PASSWORD).catch((e) => {
    botClient = undefined;
    throw e;
  });
  return botClient;
}

export const roomAlias = () => `#${env.MATRIX_ROOM_ALIAS}:${env.MATRIX_SERVER_NAME}`;
export const botUserId = () => mxid(env.MATRIX_BOT_USER);
