// The outside person's browser for `pnpm demo:seed`: opens a request link, logs in at the simulated ID Austria, and
// uploads an answer, through the same code the web server runs. Nothing here skips a check.
//
// - Opening the link calls `findPublicRequest`, as the landing page /r/{token} does, so `link_opened` is logged.
// - The login calls the route handlers of POST /auth/login and GET /auth/callback in this process. Between them, it
//   drives Keycloak's real authorization code flow over HTTP: it fetches the login form, posts the username and
//   password, and catches the redirect to the callback without following it. So Keycloak checks the password, signs the
//   ID token, and the callback verifies it and runs the identity checks, exactly as for a browser. Nothing needs the
//   web server on port 3010: the redirect URI only has to be the one the realm allows.
// - The upload calls `portal.answer` through `createCaller` with the session the callback set.
//
// It never prints a link token, an ID token, a person number, or a patient's name (docs/COMPLIANCE_AND_SAFETY.md).
import { NextRequest } from "next/server";

import { POST as loginRoute } from "@/app/auth/login/route";
import { GET as callbackRoute } from "@/app/auth/callback/route";
import { env } from "@/env";
import { createCaller } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import { EID_SESSION_COOKIE, type EidSession, loginTransactionCookie, readEidSession } from "@/server/auth/eid-session";
import type { LoginPage } from "@/server/identity/login";
import { findPublicRequest } from "@/server/portal/data";

/** A test citizen from docs/IDENTITY.md. The passwords are the documented demo passwords of the simulated ID Austria. */
export type Citizen = { username: string; password: string; ip: string };

// IP addresses from the documentation range 198.51.100.0/24 (RFC 5737), so each person's browser gets its own hash.
export const CITIZENS = {
  eva: { username: "eva.brandl", password: "demo-eva", ip: "198.51.100.11" },
  stefan: { username: "stefan.kern", password: "demo-stefan", ip: "198.51.100.12" },
  thomas: { username: "thomas.wagner", password: "demo-thomas", ip: "198.51.100.13" },
  anna: { username: "anna.huber", password: "demo-anna", ip: "198.51.100.14" },
  eva2: { username: "eva.brandl2", password: "demo-eva2", ip: "198.51.100.15" },
} as const satisfies Record<string, Citizen>;

const PAGES: Record<string, LoginPage> = { "": "closed", answer: "answer", held: "held", refused: "wrong_person", unavailable: "unavailable" };

/** GET /r/{token}: the landing page. Writes `link_opened`. Returns whether the page offered the login. */
export async function openLink(token: string, citizen: Citizen): Promise<boolean> {
  return (await findPublicRequest(token, { ip: citizen.ip })) !== null;
}

/** Cookies a response set, as `name=value` for the next request. Attributes such as `Secure` do not matter here. */
const cookiesOf = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);

/** Keycloak's login form: the action URL of `kc-form-login`, with `&amp;` decoded. */
function formAction(html: string): string {
  const action = html.match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/)?.[1];
  if (!action) throw new Error("Keycloak did not show its login form");
  return action.replaceAll("&amp;", "&");
}

/** Keycloak: show the login form, post the credentials, and return the callback URL it redirects to. */
async function keycloakLogin(authorizationUrl: string, citizen: Citizen): Promise<URL> {
  const form = await fetch(authorizationUrl, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  if (form.status !== 200) throw new Error(`Keycloak answered ${form.status} to the authorization request`);
  const posted = await fetch(formAction(await form.text()), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookiesOf(form).join("; ") },
    body: new URLSearchParams({ username: citizen.username, password: citizen.password, credentialId: "" }),
    signal: AbortSignal.timeout(10_000),
  });
  const location = posted.headers.get("location");
  if (posted.status !== 302 || !location) throw new Error(`Keycloak refused the login of ${citizen.username} (HTTP ${posted.status})`);
  const callback = new URL(location);
  if (callback.origin + callback.pathname !== new URL("/auth/callback", env.PUBLIC_URL).href) {
    throw new Error("Keycloak redirected somewhere other than the callback");
  }
  return callback;
}

export type Login = { page: LoginPage; session: EidSession | null };

/**
 * The ID Austria login for one request link, as a browser does it: POST /auth/login, Keycloak, GET /auth/callback.
 * Returns the portal page the callback sent the person to, and the ID Austria session if the request is now bound to them.
 */
export async function logIn(token: string, citizen: Citizen): Promise<Login> {
  const origin = new URL(env.PUBLIC_URL).origin;
  const body = new FormData();
  body.set("token", token);
  const started = await loginRoute(new NextRequest(new URL("/auth/login", origin), { method: "POST", body, headers: { origin } }));
  const transaction = started.cookies.get(loginTransactionCookie.name)?.value;
  const authorizationUrl = started.headers.get("location");
  if (!transaction || !authorizationUrl) throw new Error(`The login for ${citizen.username} did not start`);

  const callback = await keycloakLogin(authorizationUrl, citizen);
  const finished = await callbackRoute(new NextRequest(callback, { headers: { cookie: `${loginTransactionCookie.name}=${transaction}` } }));
  const landing = new URL(finished.headers.get("location") ?? "/auth/failed", env.PUBLIC_URL);
  if (landing.searchParams.get("login") === "failed" || !landing.pathname.startsWith("/r/")) {
    throw new Error(`The callback refused the login of ${citizen.username}`);
  }
  const page = PAGES[landing.pathname.split("/")[3] ?? ""];
  if (!page) throw new Error(`The callback sent ${citizen.username} to an unknown page`);
  return { page, session: await readEidSession(finished.cookies.get(EID_SESSION_COOKIE)?.value) };
}

/** The answer page's upload: the file and the patient's name and birth date as the sender types them. */
export async function upload(token: string, session: EidSession, file: { name: string; bytes: Uint8Array<ArrayBuffer> }, form: { name: string; birthDate: string }) {
  const data = new FormData();
  data.set("token", token);
  data.set("file", new File([file.bytes], file.name, { type: "text/markdown" }));
  data.set("patientName", form.name);
  data.set("birthDate", form.birthDate);
  return createCaller(createContext({ kind: "eid", session })).portal.answer(data);
}
