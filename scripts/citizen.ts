import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

import { z } from "zod";

import { env } from "@/env";
import { oid } from "@/server/ehvd/oid";

const USAGE =
  "Usage: pnpm citizen --given Peter --family Muster --birthdate 1970-01-01 [--loa high|substantial|low] [--ida-level full|basic|none] [--gda-oid 1.2.40.0.34.3.2.99.9.9] [--username ...] [--password ...]";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const options = z.object({
  given: z.string().trim().min(1),
  family: z.string().trim().min(1),
  birthdate: z.iso.date(),
  loa: z.enum(["high", "substantial", "low"]).default("high"),
  "ida-level": z.enum(["full", "basic", "none"]).default("full"),
  "gda-oid": oid.optional(),
  username: z.string().trim().min(1).optional(),
  password: z.string().min(1).optional(),
});

let raw: unknown;
try {
  raw = parseArgs({
    options: Object.fromEntries(Object.keys(options.shape).map((name) => [name, { type: "string" as const }])),
  }).values;
} catch (error) {
  fail(`${String(error)}\n${USAGE}`);
}
const parsed = options.safeParse(raw);
if (!parsed.success) fail(`${z.prettifyError(parsed.error)}\n${USAGE}`);
const args = parsed.data;

const metadata = new URL(env.OIDC_METADATA_URL);
const segments = metadata.pathname.split("/");
const realmAt = segments.indexOf("realms");
const realm = segments[realmAt + 1];
if (realmAt < 0 || !realm) fail(`OIDC_METADATA_URL ${env.OIDC_METADATA_URL} is not a Keycloak realm. pnpm citizen only works with the simulator.`);
const keycloak = metadata.origin + segments.slice(0, realmAt).join("/");

const words = (name: string) => name.toLowerCase().split(" ").filter(Boolean);
const username = (args.username ?? `${words(args.given).join("-")}.${words(args.family).join("-")}`).toLowerCase();
const password = args.password ?? `demo-${words(args.given)[0]}`;
// Same derivation as the citizens in docker/keycloak/idaustria-sim-realm.json. The username stands in for the
// source PIN, so one person keeps one bPK across re-imports, and two people with the same name get two.
const bpk = `GH:${createHash("sha256").update(`GH:${username}`).digest().subarray(0, 20).toString("base64")}`;
const loa = `http://eidas.europa.eu/LoA/${args.loa}`;
// `none` stands for a foreign eID through EU-Login, which carries no ID Austria level at all.
const idaLevel = args["ida-level"] === "none" ? null : `urn:eidgvat:eid.status.${args["ida-level"]}`;
// The eHVD entry that ID Austria delivers as `urn:eidgvat:attributes.gda`, in the same shape as Eva Brandl's in the realm.
const gda =
  args["gda-oid"] &&
  Buffer.from(
    JSON.stringify({
      gda: {
        id: { oidIssuingAuthority: "1.2.40.0.34", id: args["gda-oid"] },
        status: { ehvdstatus: "Aktiv", elgastatus: "Aktiv" },
        firstname: args.given,
        surname: args.family,
      },
    }),
  ).toString("base64");

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    fail(`Keycloak at ${keycloak} did not answer (${String(error)}). Start it with: docker compose up -d keycloak`);
  }
}

const login = await request(`${keycloak}/realms/master/protocol/openid-connect/token`, {
  method: "POST",
  body: new URLSearchParams({
    grant_type: "password",
    client_id: "admin-cli",
    username: env.KEYCLOAK_ADMIN_USER,
    password: env.KEYCLOAK_ADMIN_PASSWORD,
  }),
});
if (!login.ok) fail(`Keycloak admin login as ${env.KEYCLOAK_ADMIN_USER} failed: HTTP ${login.status} ${await login.text()}`);
const adminLogin = z.object({ access_token: z.string() }).safeParse(await login.json().catch(() => null));
if (!adminLogin.success) fail(`Keycloak admin login as ${env.KEYCLOAK_ADMIN_USER} sent no access token.`);
const token = adminLogin.data.access_token;

const created = await request(`${keycloak}/admin/realms/${realm}/users`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({
    username,
    enabled: true,
    firstName: args.given,
    lastName: args.family,
    attributes: {
      birthdate: [args.birthdate],
      bpk: [bpk],
      loa: [loa],
      ...(idaLevel ? { ida_level: [idaLevel] } : {}),
      ...(gda ? { gda: [gda] } : {}),
    },
    credentials: [{ type: "password", value: password, temporary: false }],
  }),
});
if (created.status === 409) fail(`The username ${username} already exists in ${realm}. Nothing was changed. Pick another one with --username.`);
if (created.status !== 201) fail(`Keycloak refused the citizen: HTTP ${created.status} ${await created.text()}`);

console.log(`Added ${args.given} ${args.family}, born ${args.birthdate}, to ${realm}.`);
console.log(`  username   ${username}`);
console.log(`  password   ${password}`);
console.log(`  bPK        ${bpk}`);
console.log(`  eIDAS      ${loa}`);
console.log(`  ID Austria ${idaLevel ?? "none (foreign eID)"}`);
console.log(`  eHVD OID   ${args["gda-oid"] ?? "none (not a healthcare provider)"}`);
