import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { z } from "zod";

import { DELETE, GET, POST } from "@/app/api/workspace/session/route";
import { env } from "@/env";
import { WORKSPACE_HEADER, workspaceSessionResponse } from "@/lib/workspace";
import { createCaller } from "@/server/api/root";
import { createContextFromRequest } from "@/server/api/trpc";
import { signEidSession } from "./eid-session";
import { sealWorkspaceSession, WORKSPACE_COOKIE } from "./workspace-session";

const secret = randomBytes(32).toString("hex");
const validToken = "only-the-server-may-see-this-matrix-token";
const who = "@lena.hofer:klinikum.example";
let available = true;
const revoked = new Set<string>();
const saved = { secret: env.ORDY_SECRET, matrix: env.MATRIX_HOMESERVER_URL, workspace: env.WORKSPACE_URL, public: env.PUBLIC_URL };
const loginBody = z.object({ identifier: z.object({ user: z.string() }), password: z.string(), initial_device_display_name: z.string() });

const server = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  const reply = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)); };
  if (!available) return reply(503, { errcode: "M_UNAVAILABLE", error: `secret response ${validToken}` });
  const path = new URL(req.url ?? "/", "http://matrix.test").pathname;
  if (path === "/_matrix/client/v3/login") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = loginBody.parse(JSON.parse(Buffer.concat(chunks).toString()));
    if (input.identifier.user !== "lena.hofer" || input.password !== " password with spaces ") return reply(403, { errcode: "M_FORBIDDEN", error: "Do not echo this private server failure" });
    assert.equal(input.initial_device_display_name, "ordy workspace");
    revoked.delete(validToken);
    return reply(200, { user_id: who, access_token: validToken });
  }
  if (path.startsWith("/_matrix/client/v3/profile/")) return reply(200, { displayname: "Dr. Lena Hofer" });
  const token = req.headers.authorization?.slice("Bearer ".length);
  if (token !== validToken || revoked.has(token)) return reply(401, { errcode: "M_UNKNOWN_TOKEN", error: "Unknown token" });
  if (path === "/_matrix/client/v3/account/whoami") return reply(200, { user_id: who });
  if (path === "/_matrix/client/v3/logout") { revoked.add(validToken); return reply(200, {}); }
  return reply(404, { errcode: "M_NOT_FOUND", error: "Not found" });
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  env.MATRIX_HOMESERVER_URL = `http://127.0.0.1:${address.port}`;
  env.ORDY_SECRET = secret;
  env.WORKSPACE_URL = "http://workspace.test";
  env.PUBLIC_URL = "http://portal.test";
});
after(async () => {
  env.MATRIX_HOMESERVER_URL = saved.matrix;
  env.ORDY_SECRET = saved.secret;
  env.WORKSPACE_URL = saved.workspace;
  env.PUBLIC_URL = saved.public;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const request = (method: string, options: { origin?: string; cookie?: string; body?: string; workspace?: boolean; bearer?: string } = {}) => new Request("http://workspace.test/api/workspace/session", {
  method,
  headers: {
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(options.workspace ? { [WORKSPACE_HEADER]: "1" } : {}),
    ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
  },
  body: options.body,
});
const body = JSON.stringify({ username: "lena.hofer", password: " password with spaces " });
async function login() {
  const response = await POST(request("POST", { origin: "http://workspace.test", body }));
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  const cookie = setCookie.split(";")[0];
  return { response, cookie };
}

test("session endpoint rejects foreign and missing origins, oversized bodies and invalid credentials", async () => {
  for (const origin of [undefined, "null", "http://foreign.test"]) {
    const response = await POST(request("POST", { origin, body }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "This request must come from the ordy workspace." });
  }
  const oversized = await POST(request("POST", { origin: "http://workspace.test", body: "x".repeat(8193) }));
  assert.equal(oversized.status, 413);
  const invalid = await POST(request("POST", { origin: "http://workspace.test", body: JSON.stringify({ username: "lena.hofer", password: "wrong" }) }));
  assert.equal(invalid.status, 401);
  assert.deepEqual(await invalid.json(), { error: "The username or password is incorrect." });
  assert.equal(invalid.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(workspaceSessionResponse.parse(await (await GET(request("GET"))).json()), { status: "signed_out", clinic: env.CLINIC_NAME });
});

test("sign-in returns only public metadata in an HttpOnly encrypted cookie and logout revokes that device", async () => {
  const { response, cookie } = await login();
  const result = workspaceSessionResponse.parse(await response.json());
  assert.equal(result.status, "signed_in");
  assert.equal(JSON.stringify(result).includes(validToken), false);
  assert.equal(cookie.includes(validToken), false);
  assert.ok(response.headers.get("set-cookie")?.includes("HttpOnly"));
  assert.ok(response.headers.get("set-cookie")?.toLowerCase().includes("samesite=lax"));
  assert.deepEqual(await (await GET(request("GET", { cookie }))).json(), result);
  const rejected = await DELETE(request("DELETE", { cookie, origin: "http://foreign.test" }));
  assert.equal(rejected.status, 403);
  assert.deepEqual(await (await GET(request("GET", { cookie }))).json(), result);
  const logout = await DELETE(request("DELETE", { cookie, origin: "http://workspace.test" }));
  assert.deepEqual(await logout.json(), { status: "signed_out", clinic: env.CLINIC_NAME });
  assert.ok(logout.headers.get("set-cookie")?.includes("Max-Age=0"));
  assert.deepEqual(await (await GET(request("GET", { cookie }))).json(), { status: "signed_out", clinic: env.CLINIC_NAME });
});

test("workspace and outside-person identities stay separate and a failed opt-in never falls through", async () => {
  const { cookie } = await login();
  const eid = await signEidSession({ requestId: 27, personNumber: "GH:outside", givenName: "Eva", familyName: "Brandl", level: "urn:eidgvat:eid.status.full", gdaOid: null });
  const both = `${cookie}; ordy_eid_session=${eid}`;
  const outside = await createContextFromRequest(request("GET", { cookie: both }));
  assert.deepEqual(outside.actor, { kind: "eid", session: { requestId: 27, personNumber: "GH:outside", givenName: "Eva", familyName: "Brandl", level: "urn:eidgvat:eid.status.full", gdaOid: null } });
  assert.equal(outside.matrix, null);
  const workspace = await createContextFromRequest(request("GET", { cookie: both, workspace: true }));
  assert.deepEqual(await createCaller(workspace).health.whoami(), { mxid: who });
  assert.equal(workspace.matrix?.userId, who);
  const noSession = await createContextFromRequest(request("GET", { cookie: `ordy_eid_session=${eid}`, workspace: true, bearer: "ignored" }));
  assert.deepEqual(noSession.actor, { kind: "anonymous" });
  await assert.rejects(createContextFromRequest(request("POST", { cookie: both, workspace: true, body: "{}", origin: "http://foreign.test" })), { code: "FORBIDDEN" });
});

test("a Matrix outage is a recoverable error and logout still clears the local credential", async () => {
  const { cookie } = await login();
  available = false;
  try {
    const response = await GET(request("GET", { cookie }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "The network service is unavailable. Try again shortly." });
    assert.equal(response.headers.get("set-cookie"), null);
    const logout = await DELETE(request("DELETE", { cookie, origin: "http://workspace.test" }));
    assert.deepEqual(await logout.json(), { status: "signed_out", clinic: env.CLINIC_NAME });
    assert.ok(logout.headers.get("set-cookie")?.includes("Max-Age=0"));
  } finally { available = true; }
});

test("invalid, expired and mismatched credentials cannot open a workspace session", async () => {
  await login();
  const expired = await sealWorkspaceSession({ userId: who, accessToken: validToken, displayName: "Dr. Lena Hofer" }, { at: new Date("2020-01-01T00:00:00Z") });
  const mismatch = await sealWorkspaceSession({ userId: "@other:klinikum.example", accessToken: validToken, displayName: "Other member" });
  const foreign = await sealWorkspaceSession({ userId: "@other:another.example", accessToken: validToken, displayName: "Other member" });
  for (const token of ["invalid", expired.token, mismatch.token, foreign.token]) {
    const response = await GET(request("GET", { cookie: `${WORKSPACE_COOKIE}=${token}` }));
    assert.deepEqual(await response.json(), { status: "signed_out", clinic: env.CLINIC_NAME });
    assert.ok(response.headers.get("set-cookie")?.includes("Max-Age=0"));
  }
  const logout = await DELETE(request("DELETE", { cookie: `${WORKSPACE_COOKIE}=${expired.token}`, origin: "http://workspace.test" }));
  assert.deepEqual(await logout.json(), { status: "signed_out", clinic: env.CLINIC_NAME });
  assert.ok(logout.headers.get("set-cookie")?.includes("Max-Age=0"));
});

test("configured HTTPS keeps the credential cookie Secure behind an HTTP gateway hop", async () => {
  env.WORKSPACE_URL = "https://workspace.test";
  try {
    const response = await POST(request("POST", { origin: "https://workspace.test", body }));
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("set-cookie")?.includes("Secure"));
  } finally { env.WORKSPACE_URL = "http://workspace.test"; }
});
