// The outside person's browser for `pnpm demo:seed` and `pnpm scenario`: opens a request link, logs in at the simulated
// ID Austria, and uploads an answer, through the same code the web server runs. Nothing here skips a check.
//
// - Opening the link calls `findPublicRequest`, as the landing page /r/{token} does, so `link_opened` is logged.
// - The login calls the route handlers of POST /auth/login and GET /auth/callback in this process. Between them, it
//   drives Keycloak's real authorization code flow over HTTP: it fetches the login form, posts the username and
//   password, and catches the redirect to the callback without following it. So Keycloak checks the password, signs the
//   ID token, and the callback verifies it and runs the identity checks, exactly as for a browser. Nothing needs the
//   web server on port 3010: the redirect URI only has to be the one the realm allows.
// - The upload calls `portal.answer` through `createCaller` with the session the callback set.
// - Only `viewPage` needs the web server: it fetches the page the callback sent the person to, as the browser would
//   follow the redirect, so `pnpm scenario` can check the HTML the portal really sends (M1).
//
// It never prints a link token, an ID token, a person number, or a patient's name (docs/COMPLIANCE_AND_SAFETY.md).
import { NextRequest } from "next/server";

import { POST as loginRoute } from "@/app/auth/login/route";
import { GET as callbackRoute } from "@/app/auth/callback/route";
import { env } from "@/env";
import { createCaller } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import { EID_SESSION_COOKIE, type EidSession, loginTransactionCookie, readEidSession } from "@/server/auth/eid-session";
import type { AnswerOutcome } from "@/server/answers/submit";
import type { LoginPage } from "@/server/identity/login";
import { findAnswerContext, findPublicRequest } from "@/server/portal/data";

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

export type Login = {
  page: LoginPage;
  session: EidSession | null;
  // Where the callback sent the person, as path and query. It holds the link token: never print it.
  landing: string;
  // The ID Austria session cookie the callback set, as `name=value`, for the next request of this browser.
  cookie: string | null;
};

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
  const sessionCookie = finished.cookies.get(EID_SESSION_COOKIE)?.value;
  return {
    page,
    session: await readEidSession(sessionCookie),
    landing: landing.pathname + landing.search,
    cookie: sessionCookie ? `${EID_SESSION_COOKIE}=${sessionCookie}` : null,
  };
}

/** A step of the outside person that did not end as expected. Its message names usernames, pages, and outcomes only. */
export class BrowserError extends Error {}

/** Opens the link and logs in, and fails unless the callback sent the person to the `expected` page. */
export async function visit(token: string, citizen: Citizen, expected: LoginPage): Promise<Login> {
  if (!(await openLink(token, citizen))) throw new BrowserError(`the link did not open for ${citizen.username}`);
  const login = await logIn(token, citizen);
  if (login.page !== expected) throw new BrowserError(`${citizen.username} landed on ${login.page}, expected ${expected}`);
  return login;
}

/** The target of a `<meta http-equiv="refresh">`: Next.js streams a redirect that way once the page has started. */
function metaRefresh(html: string): string | null {
  const tag = /<meta\b[^>]*http-equiv="refresh"[^>]*>/i.exec(html)?.[0];
  const url = tag && /content="\d*;\s*url=([^"]+)"/i.exec(tag)?.[1];
  return url ? url.replaceAll("&amp;", "&") : null;
}

/**
 * GET of the page the login ended on, from the web server at `webUrl`, with the cookie the callback set: the HTML a
 * browser gets when it follows the callback's redirect, scripts and the React Server Components data included. With
 * `path`, another page of the portal in the same browser, such as the answer page the person then tries. Follows HTTP
 * redirects and up to three streamed ones, as a browser does, and returns the HTML of the page it ends on.
 */
export async function viewPage(webUrl: string, login: Login, path = login.landing): Promise<string> {
  let url = new URL(path, webUrl);
  for (let hops = 0; ; hops++) {
    const response = await fetch(url, {
      headers: login.cookie ? { cookie: login.cookie } : {},
      signal: AbortSignal.timeout(60_000),
    }).catch(() => {
      throw new BrowserError(`the web server at ${url.origin} did not answer for a portal page`);
    });
    if (!response.ok) throw new BrowserError(`the web server answered ${response.status} for a portal page`);
    const html = await response.text();
    const next = metaRefresh(html);
    if (!next || hops === 3) return html;
    url = new URL(next, response.url);
  }
}

/** A document the outside person uploads. */
export type Upload = { name: string; bytes: Uint8Array<ArrayBuffer> };

/** The answer page's upload: the file and the patient's name and birth date as the sender types them. */
export async function upload(token: string, session: EidSession, file: Upload, form: { name: string; birthDate: string }) {
  const data = new FormData();
  data.set("token", token);
  data.set("file", new File([file.bytes], file.name, { type: "text/markdown" }));
  data.set("patientName", form.name);
  data.set("birthDate", form.birthDate);
  return createCaller(createContext({ kind: "eid", session })).portal.answer(data);
}

/** Uploads a document, typing the patient's name and birth date as the answer page shows them, and checks the outcome. */
export async function answer(token: string, session: EidSession | null, doc: Upload, expected: AnswerOutcome["outcome"]): Promise<AnswerOutcome> {
  if (!session) throw new BrowserError("no ID Austria session to answer with");
  const page = await findAnswerContext(token, session);
  if (!page) throw new BrowserError("the answer page did not open");
  const outcome = await upload(token, session, doc, { name: page.patient.name, birthDate: page.patient.birthDate });
  if (outcome.outcome !== expected) throw new BrowserError(`the upload ended as ${outcome.outcome}, expected ${expected}`);
  return outcome;
}
