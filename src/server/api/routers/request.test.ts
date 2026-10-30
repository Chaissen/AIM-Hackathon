import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { UnsecuredJWT } from "jose";

import { env, mxid } from "@/env";
import { createCaller } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import { db } from "@/server/db";
import { anonymousBrowser } from "@/server/audit/record";
import { answerDeps, type AnswerDeps } from "@/server/answers/deps";
import type { AnswerToFile } from "@/server/answers/ports";
import { auditLog, bindings, heldAnswers, keptAnswers, requests } from "@/server/db/schema";
import { capabilities, fhirFetch } from "@/server/fhir/client";
import { findAnswerContext, findPublicRequest } from "@/server/portal/data";
import { TransitionError } from "@/server/requests/lifecycle";
import { LINK_TTL_MS } from "@/server/requests/link-token";
import { runIdentityChecks } from "@/server/identity/login";
import type { Notice } from "@/server/matrix/notices";
import { identityCheckPorts } from "@/server/requests/identity-ports";
import {
  applyEvent,
  applyLoginTransition,
  createRequest,
  findRequestByToken,
  getRequest,
  incrementFailedChecks,
  type NewRequest,
  sendAnyway,
} from "@/server/requests/service";

// Runs against the Postgres from DATABASE_URL and deletes its rows afterwards. Skipped when Postgres is not running.
// Request ids still move on, so run `pnpm reset` before a demo.
const noDb = await db.execute(sql`select 1`).then(
  () => false,
  () => "Postgres is not reachable, start it with ./scripts/setup.sh",
);
const noFhir = noDb || (await capabilities(AbortSignal.timeout(3_000)).then(() => false, () => "the FHIR server is not reachable"));

const hofer = mxid(env.MATRIX_HOFER_USER);
const clinic = createCaller(createContext({ kind: "clinic", mxid: hofer }));
const created: number[] = [];
const run = randomBytes(4).toString("hex");

const request1 = {
  docType: "lab-result",
  patient: "maria-beispiel",
  given: "Eva",
  family: "Brandl",
  org: "Labor Kanalstraße",
  email: "eva.brandl@labor-kanal.example",
} as const;

const newRequest: NewRequest = {
  docType: "lab-result",
  patientId: "maria-beispiel",
  given: "Eva",
  family: "Brandl",
  org: "Labor Kanalstraße",
  channel: "email",
  address: "eva.brandl@labor-kanal.example",
  requester: hofer,
  requesterName: "Dr. Lena Hofer",
};

async function seed(overrides: Partial<NewRequest> = {}) {
  const result = await createRequest(db, { ...newRequest, ...overrides }, { passed: true });
  created.push(result.request.id);
  return result;
}

const auditOf = (requestId: number) => db.select().from(auditLog).where(eq(auditLog.requestId, requestId)).orderBy(auditLog.id);

const decisionsOf = async (requestId: number) =>
  (await auditOf(requestId)).filter((a) => a.event === "request_decided").map((a) => [a.actorKind, a.actor, a.outcome, a.detail]);

async function seedHeld(state: "identity_held" | "answer_held", overrides: Partial<NewRequest> = {}) {
  const { request } = await seed(overrides);
  const to = state === "identity_held" ? "identity_held" : "verified";
  assert.equal(await applyLoginTransition(db, request.id, { from: "sent", to, personNumber: "GH:petra" }), true);
  if (state === "answer_held") assert.equal((await applyEvent(db, request.id, "answer_unconfirmed"))?.state, "answer_held");
  return request;
}

async function seedAddressMismatch() {
  const result = await createRequest(db, newRequest, { passed: false, domain: "labor-kanaI.example", expectedDomain: "labor-kanal.example" });
  created.push(result.request.id);
  return result;
}

after(async () => {
  // The request service mirrored each request on its FHIR Task, if HAPI runs.
  await Promise.all(created.map((id) => fhirFetch(`Task/ordy-request-${id}`, { method: "DELETE" }).catch(() => {})));
  if (!noDb && created.length) {
    await db.delete(auditLog).where(inArray(auditLog.requestId, created));
    await db.delete(requests).where(inArray(requests.id, created));
    await db.delete(bindings).where(eq(bindings.org, `Labor Kanalstraße test ${run}`));
  }
  await db.$client.end();
});

test("a request created through createCaller is stored and logged as request_sent", { skip: noDb }, async () => {
  const before = Date.now();
  const request = await clinic.request.create(request1);
  created.push(request.id);

  assert.equal(request.state, "sent");
  assert.equal(request.taskStatus, "requested");
  assert.equal(request.channel, "email");
  assert.equal(request.requester, hofer);
  assert.ok(request.requesterName.length > 0);
  assert.equal("linkHash" in request, false);

  const [row] = await db.select().from(requests).where(eq(requests.id, request.id));
  assert.match(row.linkHash, /^[0-9a-f]{64}$/);
  assert.equal(row.patientId, "maria-beispiel");
  assert.ok(Math.abs(row.expiresAt.getTime() - before - LINK_TTL_MS) < 60_000);

  const audit = await auditOf(request.id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].event, "request_sent");
  assert.equal(audit[0].actorKind, "network_member");
  assert.equal(audit[0].actor, hofer);
  assert.equal(audit[0].outcome, "sent");
  assert.deepEqual(audit[0].detail, { docType: "lab-result", channel: "email", address: "eva.brandl@labor-kanal.example" });
});

test("an SMS request stores the phone number", { skip: noDb }, async () => {
  const request = await clinic.request.create({
    docType: "rehab-report",
    patient: "maria-beispiel",
    given: "Stefan",
    family: "Kern",
    org: "Reha Waldblick",
    phone: "+43 660 000 0101",
  });
  created.push(request.id);
  assert.equal(request.channel, "sms");
  assert.equal(request.address, "+43 660 000 0101");
});

test("create refuses a request without a contact or with both", { skip: noDb }, async () => {
  const { email, ...withoutContact } = request1;
  await assert.rejects(clinic.request.create(withoutContact), (e) => e instanceof TRPCError && e.code === "BAD_REQUEST");
  await assert.rejects(
    clinic.request.create({ ...withoutContact, email, phone: "+43 660 000 0101" }),
    (e) => e instanceof TRPCError && e.code === "BAD_REQUEST",
  );
});

test("create refuses a name without a single name word", { skip: noDb }, async () => {
  for (const name of [{ given: "-" }, { family: "." }, { family: "–" }]) {
    await assert.rejects(clinic.request.create({ ...request1, ...name }), (e) => e instanceof TRPCError && e.code === "BAD_REQUEST", JSON.stringify(name));
  }
});

test("only network members reach the request procedures", { skip: noDb }, async () => {
  const anonymous = createCaller(createContext({ kind: "anonymous" }));
  await assert.rejects(anonymous.request.create(request1), (e) => e instanceof TRPCError && e.code === "UNAUTHORIZED");
  await assert.rejects(anonymous.request.list(), (e) => e instanceof TRPCError && e.code === "UNAUTHORIZED");
});

test("get returns the request with its audit entries, and list includes it", { skip: noDb }, async () => {
  const { request } = await seed();
  const got = await clinic.request.get({ id: request.id });
  assert.equal(got.id, request.id);
  assert.deepEqual(
    got.audit.map((a) => a.event),
    ["request_sent"],
  );
  assert.ok((await clinic.request.list()).some((r) => r.id === request.id));
  await assert.rejects(clinic.request.get({ id: 2_147_483_647 }), (e) => e instanceof TRPCError && e.code === "NOT_FOUND");
});

test("a network member sees and changes only their own requests", { skip: noDb }, async () => {
  const held = await seedHeld("identity_held");
  const { request: unconfirmed } = await seedAddressMismatch();
  const colleague = createCaller(createContext({ kind: "clinic", mxid: mxid("colleague") }));
  const notFound = (e: unknown) => e instanceof TRPCError && e.code === "NOT_FOUND";
  await assert.rejects(colleague.request.get({ id: held.id }), notFound);
  await assert.rejects(colleague.request.accept({ id: held.id }), notFound);
  await assert.rejects(colleague.request.reject({ id: held.id }), notFound);
  await assert.rejects(colleague.request.cancel({ id: held.id }), notFound);
  await assert.rejects(colleague.request.sendAnyway({ id: unconfirmed.id }), notFound);
  const listed = (await colleague.request.list()).map((r) => r.id);
  assert.equal(listed.includes(held.id) || listed.includes(unconfirmed.id), false);
  assert.equal((await clinic.request.get({ id: held.id })).state, "identity_held");
  assert.equal((await clinic.request.get({ id: unconfirmed.id })).state, "awaiting_confirmation");
  assert.deepEqual(await decisionsOf(held.id), []);
});

test("cancel closes an open request, logs request_decided, and refuses a closed one", { skip: noDb }, async () => {
  const { request } = await seed();
  const cancelled = await clinic.request.cancel({ id: request.id });
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.taskStatus, "cancelled");
  await assert.rejects(clinic.request.cancel({ id: request.id }), (e) => e instanceof TRPCError && e.code === "CONFLICT");
  assert.deepEqual(await decisionsOf(request.id), [["network_member", hofer, "cancelled", { from: "sent", to: "cancelled" }]]);
});

test("Send anyway through the widget sends the request with a new link and logs request_sent", { skip: noDb }, async () => {
  const { request, token } = await seedAddressMismatch();
  const before = await getRequest(db, request.id);

  const sent = await clinic.request.sendAnyway({ id: request.id });
  assert.equal(sent.state, "sent");
  assert.equal(sent.taskStatus, "requested");
  assert.equal("linkHash" in sent, false);

  const after = await getRequest(db, request.id);
  assert.ok(before && after);
  assert.notEqual(after.linkHash, before.linkHash);
  assert.equal(await findRequestByToken(db, token), null, "the token from before is gone");
  assert.deepEqual(
    (await auditOf(request.id)).map((a) => [a.event, a.actor, a.outcome, a.detail]),
    [
      ["misdelivery_caught", hofer, "address_mismatch", { domain: "labor-kanaI.example", expectedDomain: "labor-kanal.example" }],
      ["request_sent", hofer, "sent", { docType: "lab-result", channel: "email", address: "eva.brandl@labor-kanal.example" }],
    ],
  );
  await assert.rejects(clinic.request.sendAnyway({ id: request.id }), (e) => e instanceof TRPCError && e.code === "CONFLICT");
});

test("Accept verifies a held identity and logs who accepted", { skip: noDb }, async () => {
  const request = await seedHeld("identity_held");
  const accepted = await clinic.request.accept({ id: request.id });
  assert.equal(accepted.state, "verified");
  assert.equal(accepted.taskStatus, "in-progress");
  assert.deepEqual(await decisionsOf(request.id), [["network_member", hofer, "accepted", { from: "identity_held", to: "verified" }]]);
  await assert.rejects(clinic.request.accept({ id: request.id }), (e) => e instanceof TRPCError && e.code === "CONFLICT");
});

test("Reject cancels a held identity and a held answer and logs who rejected", { skip: noDb }, async () => {
  for (const state of ["identity_held", "answer_held"] as const) {
    const request = await seedHeld(state);
    const rejected = await clinic.request.reject({ id: request.id });
    assert.equal(rejected.state, "cancelled", state);
    assert.deepEqual(await decisionsOf(request.id), [["network_member", hofer, "rejected", { from: state, to: "cancelled" }]], state);
  }
});

/** A request in `answer_held` with Maria's lab result held, as the answer flow (T09) leaves it. */
async function seedHeldAnswer() {
  // An organisation of its own: filing binds the person number, and the demo's Labor Kanalstraße must stay unbound.
  const request = await seedHeld("answer_held", { org: `Labor Kanalstraße test ${run}` });
  await db.insert(heldAnswers).values({
    requestId: request.id,
    markdown: readFileSync(new URL("../../../../track/scenario/documents/lab-result-maria-beispiel.md", import.meta.url), "utf8"),
    sha256: "0".repeat(64),
    sender: { givenName: "Eva", familyName: "Brandl", gdaOid: null },
    idToken: new UnsecuredJWT({ "urn:pvpgvat:oidc.bpk": "GH:petra" }).setIssuedAt().encode(),
    reason: "Not confirmed.",
    sentAt: new Date(),
  });
  return request;
}

/** Runs `run` with stand-ins for the FHIR server and Matrix in the answer flow the router uses. */
async function withAnswerDeps(stand: Partial<AnswerDeps>, run: () => Promise<void>) {
  const real = { ...answerDeps };
  Object.assign(answerDeps, stand);
  try {
    await run();
  } finally {
    Object.assign(answerDeps, real);
  }
}

const maria = async () => ({ family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12", display: "Maria Beispiel" });
const filedAs = (id: number) => ({
  output: "DiagnosticReport/1",
  targets: ["DiagnosticReport/1"],
  provenance: "Provenance/2",
  task: `Task/ordy-request-${id}`,
  sender: "Practitioner/3",
  author: "Practitioner/3",
  organization: "Organization/4",
  resources: ["DiagnosticReport/1", "Provenance/2"],
});

test("Accept files a held answer through the answer flow and logs who accepted", { skip: noDb }, async () => {
  const request = await seedHeldAnswer();
  const filed: AnswerToFile[] = [];
  const notices: Notice[] = [];
  await withAnswerDeps(
    {
      readPatient: maria,
      fileAnswer: async (answer) => {
        filed.push(answer);
        return filedAs(request.id);
      },
      notify: async (_request, notice) => {
        notices.push(notice);
      },
    },
    async () => {
      const accepted = await clinic.request.accept({ id: request.id });
      assert.equal(accepted.state, "filed");
      assert.equal(accepted.taskStatus, "completed");
    },
  );
  assert.equal(filed.length, 1);
  assert.equal(filed[0].acceptedByRequester, true);
  assert.deepEqual(filed[0].findings, ["Not confirmed."]);
  assert.deepEqual(await decisionsOf(request.id), [["network_member", hofer, "accepted", { from: "answer_held", to: "filed" }]]);
  assert.equal((await auditOf(request.id)).find((a) => a.event === "answer_filed")?.detail.acceptedBy, hofer);
  assert.deepEqual(
    notices.map((n) => n.kind),
    ["filed"],
  );
  assert.equal((await db.select().from(heldAnswers).where(eq(heldAnswers.requestId, request.id))).length, 0);
});

test("a held answer stays held when Accept has nothing to file, its filing fails, or Reject meets an open outcome", { skip: noDb }, async () => {
  const empty = await seedHeld("answer_held");
  await assert.rejects(
    clinic.request.accept({ id: empty.id }),
    (e) => e instanceof TRPCError && e.code === "PRECONDITION_FAILED" && e.message === "This request has no held answer to file.",
  );
  assert.equal((await getRequest(db, empty.id))?.state, "answer_held");

  const request = await seedHeldAnswer();
  await withAnswerDeps({ readPatient: maria, fileAnswer: () => Promise.reject(new Error("fetch failed")), notify: async () => {} }, async () => {
    await assert.rejects(clinic.request.accept({ id: request.id }), (e) => e instanceof TRPCError && e.code === "INTERNAL_SERVER_ERROR");
  });
  assert.equal((await getRequest(db, request.id))?.state, "answer_held");
  assert.equal((await db.select().from(keptAnswers).where(eq(keptAnswers.requestId, request.id))).length, 1, "the FHIR server may have it");
  await assert.rejects(clinic.request.reject({ id: request.id }), (e) => e instanceof TRPCError && e.code === "PRECONDITION_FAILED");
  assert.equal((await getRequest(db, request.id))?.state, "answer_held");
  assert.deepEqual(await decisionsOf(empty.id), []);
  assert.deepEqual(await decisionsOf(request.id), []);
});

test("list returns the audit entries of each request", { skip: noDb }, async () => {
  const { request: open } = await seed();
  const { request: cancelled } = await seed();
  await clinic.request.cancel({ id: cancelled.id });

  const listed = await clinic.request.list();
  const auditIn = (id: number) => listed.find((r) => r.id === id)?.audit.map((a) => [a.requestId, a.event, a.outcome]);
  assert.deepEqual(auditIn(open.id), [[open.id, "request_sent", "sent"]]);
  assert.deepEqual(auditIn(cancelled.id), [
    [cancelled.id, "request_sent", "sent"],
    [cancelled.id, "request_decided", "cancelled"],
  ]);
});

test("the link shows only the requester and the clinic and writes link_opened", { skip: noDb }, async () => {
  env.ORDY_SECRET = randomBytes(32).toString("hex");
  const { request, token } = await seed();
  const shown = await findPublicRequest(token, { ip: "127.0.0.1" });
  assert.deepEqual(shown, { requester: "Dr. Lena Hofer", clinic: env.CLINIC_NAME, expiresAt: request.expiresAt });

  const [opened] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.requestId, request.id), eq(auditLog.event, "link_opened")));
  assert.equal(opened.actorKind, "anonymous");
  assert.equal(opened.outcome, "shown");
  assert.match(opened.actor, /^ip [0-9a-f]{16}$/);
  assert.equal(opened.actor, anonymousBrowser("127.0.0.1").id);

  assert.equal(await findAnswerContext(token, { requestId: request.id, personNumber: "GH:eva" }), null, "no patient before the identity check");
  assert.equal(await findPublicRequest("not-a-token", { ip: null }), null);
  assert.equal(await findPublicRequest("A".repeat(43), { ip: null }), null);
});

test("without a private ORDY_SECRET the IP address is not recorded", () => {
  const secret = env.ORDY_SECRET;
  try {
    for (const value of ["", "change-me-to-a-long-random-string", "too-short"]) {
      env.ORDY_SECRET = value;
      assert.deepEqual(anonymousBrowser("127.0.0.1"), { kind: "anonymous", id: "ip unknown" }, JSON.stringify(value));
    }
  } finally {
    env.ORDY_SECRET = secret;
  }
});

test("an expired link is refused and the request becomes expired", { skip: noDb }, async () => {
  const { request, token } = await seed();
  await db.update(requests).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(requests.id, request.id));

  assert.equal(await findPublicRequest(token, { ip: "127.0.0.1" }), null);
  const [row] = await db.select().from(requests).where(eq(requests.id, request.id));
  assert.equal(row.state, "expired");
  const audit = await auditOf(request.id);
  assert.deepEqual(
    audit.map((a) => [a.event, a.outcome]),
    [
      ["request_sent", "sent"],
      ["link_opened", "refused"],
    ],
  );
});

test("Send anyway sends the request with a new 7-day link and logs request_sent", { skip: noDb }, async () => {
  const { request, token } = await seedAddressMismatch();
  assert.equal(request.state, "awaiting_confirmation");
  assert.deepEqual(
    (await auditOf(request.id)).map((a) => [a.event, a.outcome, a.detail]),
    [["misdelivery_caught", "address_mismatch", { domain: "labor-kanaI.example", expectedDomain: "labor-kanal.example" }]],
    "nothing went out yet",
  );

  // Dr. Hofer decides later; the 7 days start only when the request goes out.
  await db.update(requests).set({ expiresAt: new Date(Date.now() + 60_000) }).where(eq(requests.id, request.id));
  const sent = await sendAnyway(db, request.id, { kind: "network_member", id: hofer });
  assert.ok(sent);
  assert.equal(sent.request.state, "sent");
  assert.ok(sent.request.expiresAt.getTime() > Date.now() + LINK_TTL_MS - 60_000);
  assert.equal(await findRequestByToken(db, token), null, "the token from before is gone");
  assert.equal((await findRequestByToken(db, sent.token))?.id, request.id);
  assert.deepEqual(
    (await auditOf(request.id)).map((a) => [a.event, a.actor]),
    [
      ["misdelivery_caught", hofer],
      ["request_sent", hofer],
    ],
  );
  await assert.rejects(sendAnyway(db, request.id, { kind: "network_member", id: hofer }), TransitionError);
});

test("a failed write in the same transaction rolls the state change back", { skip: noDb }, async () => {
  const { request } = await seed();
  await assert.rejects(
    applyEvent(db, request.id, "cancel", async () => {
      throw new Error("audit write failed");
    }),
    /audit write failed/,
  );
  const [row] = await db.select().from(requests).where(eq(requests.id, request.id));
  assert.equal(row.state, "sent");
});

test("a sent request locks only once the third failed identity check is counted", { skip: noDb }, async () => {
  const { request, token } = await seed();
  assert.equal(await incrementFailedChecks(db, request.id), 1);
  assert.equal(await incrementFailedChecks(db, request.id), 2);
  assert.equal(await applyLoginTransition(db, request.id, { from: "sent", to: "locked" }), false, "not before the third");
  assert.equal(await incrementFailedChecks(db, request.id), 3);
  assert.equal(await applyLoginTransition(db, request.id, { from: "sent", to: "locked" }), true);
  assert.equal((await getRequest(db, request.id))?.state, "locked");
  assert.equal(await findPublicRequest(token, { ip: null }), null);
});

test("failed checks after the identity check are counted but change no state", { skip: noDb }, async () => {
  const { request } = await seed();
  assert.equal(await applyLoginTransition(db, request.id, { from: "sent", to: "verified", personNumber: "GH:eva" }), true);
  for (let i = 1; i <= 3; i++) assert.equal(await incrementFailedChecks(db, request.id), i);
  assert.equal(await applyLoginTransition(db, request.id, { from: "sent", to: "locked" }), false);
  assert.equal((await getRequest(db, request.id))?.state, "verified");
});

test("a sent request with three counted failures locks at the next login instead of passing", { skip: noDb }, async () => {
  const { request } = await seed();
  // The third failure was counted, but the lock after it never ran, for example after a crash.
  for (let i = 1; i <= 3; i++) await incrementFailedChecks(db, request.id);
  assert.equal(await applyLoginTransition(db, request.id, { from: "sent", to: "verified", personNumber: "GH:eva" }), false);
  const row = await getRequest(db, request.id);
  assert.equal(row?.state, "locked");
  assert.equal(row?.personNumber, null);
});

test("a request is bound to one person and never rebound", { skip: noDb }, async () => {
  const { request } = await seed();
  assert.equal(await applyLoginTransition(db, request.id, { from: "sent", to: "verified", personNumber: "GH:eva" }), true);
  assert.equal(await applyLoginTransition(db, request.id, { from: "sent", to: "verified", personNumber: "GH:eva2" }), false);
  assert.equal(await applyLoginTransition(db, request.id, { from: "sent", to: "identity_held", personNumber: "GH:eva2" }), false);
  assert.equal((await getRequest(db, request.id))?.personNumber, "GH:eva");
});

test("a login cannot change an expired request", { skip: noDb }, async () => {
  const { request } = await seed();
  await db.update(requests).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(requests.id, request.id));
  assert.equal(await applyLoginTransition(db, request.id, { from: "sent", to: "verified", personNumber: "GH:eva" }), false);
  const row = await getRequest(db, request.id);
  assert.equal(row?.state, "expired");
  assert.equal(row?.personNumber, null);
});

test("after the identity check only the bound person gets the patient from FHIR", { skip: noFhir }, async () => {
  const { request, token } = await seed();
  const eva = { requestId: request.id, personNumber: "GH:eva" };
  await applyLoginTransition(db, request.id, { from: "sent", to: "verified", personNumber: eva.personNumber });
  const ctx = await findAnswerContext(token, eva);
  assert.deepEqual(ctx, {
    requester: "Dr. Lena Hofer",
    clinic: env.CLINIC_NAME,
    expiresAt: request.expiresAt,
    docType: "lab-result",
    patient: { name: "Maria Beispiel", birthDate: "1961-03-12" },
  });
  assert.equal(await findAnswerContext(token, { ...eva, requestId: request.id + 1 }), null, "the session is bound to one request");
  assert.equal(await findAnswerContext(token, { ...eva, personNumber: "GH:thomas" }), null, "a session of someone else");
});

test("Accept keeps the held person, who then gets the patient", { skip: noFhir }, async () => {
  const { request, token } = await seed();
  const petra = { requestId: request.id, personNumber: "GH:petra" };
  await applyLoginTransition(db, request.id, { from: "sent", to: "identity_held", personNumber: petra.personNumber });
  assert.equal(await findAnswerContext(token, petra), null, "not before Dr. Hofer accepts");
  assert.equal((await applyEvent(db, request.id, "accept"))?.state, "verified");
  assert.equal((await findAnswerContext(token, petra))?.patient.name, "Maria Beispiel");
});

test("a verified request bound to nobody shows no patient", { skip: noDb }, async () => {
  const { request, token } = await seed();
  // The request service never verifies without a bPK, so set the state directly: the answer page has to refuse it anyway.
  await db.update(requests).set({ state: "verified" }).where(eq(requests.id, request.id));
  assert.equal(await findAnswerContext(token, { requestId: request.id, personNumber: "GH:eva" }), null);
});

test("the identity checks run on the request service ports", { skip: noDb }, async () => {
  // An organisation of its own, so a binding left from a demo cannot change the result.
  const { request } = await seed({ org: `Labor Kanalstraße ${randomBytes(4).toString("hex")}` });
  const notices: Notice[] = [];
  const ports = identityCheckPorts(db, async (_id, notice) => {
    notices.push(notice);
  });
  const login = (givenName: string, familyName: string, personNumber: string) => ({
    ok: true as const,
    login: { givenName, familyName, personNumber, level: "urn:eidgvat:eid.status.full", gdaOid: null },
  });

  const eva = await runIdentityChecks(ports, (await getRequest(db, request.id))!, "Dr. Eva Brandl", login("Eva", "Brandl", "GH:eva"));
  assert.equal(eva.page, "answer");
  assert.equal(eva.applied, true);

  const thomas = await runIdentityChecks(ports, (await getRequest(db, request.id))!, "Dr. Eva Brandl", login("Thomas", "Wagner", "GH:thomas"));
  assert.equal(thomas.page, "wrong_person");
  assert.equal(thomas.failedChecks, 1);

  const row = await getRequest(db, request.id);
  assert.equal(row?.state, "verified");
  assert.equal(row?.personNumber, "GH:eva");
  assert.deepEqual(
    (await auditOf(request.id)).map((a) => [a.event, a.outcome]),
    [
      ["request_sent", "sent"],
      ["identity_checked", "pass"],
      ["identity_checked", "fail"],
      ["misdelivery_caught", "wrong_person"],
    ],
  );
  assert.deepEqual(
    notices.map((n) => n.kind),
    ["wrong-person"],
  );
});

test("the login's audit port writes only the entries the audit types allow", async () => {
  const { recordAudit: write } = identityCheckPorts(db, async () => {});
  const entry = { event: "identity_checked", requestId: null, actorKind: "anonymous", actor: "ID Austria login", outcome: "hold" } as const;
  const checks = [{ check: "service", result: "hold", reason: "keycloak_unreachable" }];
  await assert.rejects(write({ ...entry, detail: { checks: [{ ...checks[0], birthDate: "1961-03-12" }] } }), { name: "ZodError" });
  await assert.rejects(write({ ...entry, detail: { checks, reason: "a sentence" } }), { name: "ZodError" });
  await assert.rejects(write({ ...entry, outcome: "maybe", detail: { checks } }), /does not write identity_checked with maybe/);
  await assert.rejects(write({ ...entry, event: "answer_sent", detail: { checks } }), /does not write answer_sent/);
  await assert.rejects(write({ ...entry, actorKind: "service", detail: { checks } }), /does not write as service/);
});

test("applyEvent refuses a login's events, even from a caller that casts", { skip: noDb }, async () => {
  const { request } = await seed();
  for (const event of ["identity_pass", "identity_hold", "identity_fail"] as const) {
    await assert.rejects(applyEvent(db, request.id, event as never), TransitionError, event);
  }
  assert.equal((await getRequest(db, request.id))?.state, "sent");
});
