import assert from "node:assert/strict";
import { after, test } from "node:test";

import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";

import { env, mxid } from "@/env";
import { createCaller } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import { db } from "@/server/db";
import { auditLog, requests } from "@/server/db/schema";
import { capabilities } from "@/server/fhir/client";
import { findAnswerContext, findPublicRequest } from "@/server/portal/data";
import { TransitionError } from "@/server/requests/lifecycle";
import { LINK_TTL_MS } from "@/server/requests/link-token";
import { applyEvent, bindPerson, createRequest, findRequestByToken, type NewRequest, sendAnyway } from "@/server/requests/service";

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

async function seed() {
  const result = await createRequest(db, newRequest, { addressCheckPassed: true });
  created.push(result.request.id);
  return result;
}

const auditOf = (requestId: number) => db.select().from(auditLog).where(eq(auditLog.requestId, requestId)).orderBy(auditLog.id);

after(async () => {
  if (!noDb && created.length) {
    await db.delete(auditLog).where(inArray(auditLog.requestId, created));
    await db.delete(requests).where(inArray(requests.id, created));
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

test("create refuses a name that is only a title", { skip: noDb }, async () => {
  for (const name of [{ given: "Dr." }, { family: "Prof. Dr." }, { family: "-" }]) {
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

test("a network member sees and cancels only their own requests", { skip: noDb }, async () => {
  const { request } = await seed();
  const colleague = createCaller(createContext({ kind: "clinic", mxid: mxid("colleague") }));
  const notFound = (e: unknown) => e instanceof TRPCError && e.code === "NOT_FOUND";
  await assert.rejects(colleague.request.get({ id: request.id }), notFound);
  await assert.rejects(colleague.request.cancel({ id: request.id }), notFound);
  assert.equal((await colleague.request.list()).some((r) => r.id === request.id), false);
  assert.equal((await clinic.request.get({ id: request.id })).state, "sent");
});

test("cancel closes an open request and refuses a closed one", { skip: noDb }, async () => {
  const { request } = await seed();
  const cancelled = await clinic.request.cancel({ id: request.id });
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.taskStatus, "cancelled");
  await assert.rejects(clinic.request.cancel({ id: request.id }), (e) => e instanceof TRPCError && e.code === "CONFLICT");
});

test("the link shows only the requester and the clinic and writes link_opened", { skip: noDb }, async () => {
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

  assert.equal(await findAnswerContext(token, { requestId: request.id, personNumber: "GH:eva" }), null, "no patient before the identity check");
  assert.equal(await findPublicRequest("not-a-token", { ip: null }), null);
  assert.equal(await findPublicRequest("A".repeat(43), { ip: null }), null);
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
  const { request, token } = await createRequest(db, newRequest, { addressCheckPassed: false });
  created.push(request.id);
  assert.equal(request.state, "awaiting_confirmation");
  assert.deepEqual(await auditOf(request.id), [], "nothing went out yet");

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
    [["request_sent", hofer]],
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

test("the third failed identity check locks the link", { skip: noDb }, async () => {
  const { request, token } = await seed();
  const states = [];
  for (let i = 0; i < 3; i++) states.push((await applyEvent(db, request.id, "identity_fail"))?.state);
  assert.deepEqual(states, ["sent", "sent", "locked"]);
  const [row] = await db.select().from(requests).where(eq(requests.id, request.id));
  assert.equal(row.failedChecks, 3);
  assert.equal(await findPublicRequest(token, { ip: null }), null);
});

test("after the identity check only the bound person gets the patient from FHIR", { skip: noFhir }, async () => {
  const { request, token } = await seed();
  const eva = { requestId: request.id, personNumber: "GH:eva" };
  await applyEvent(db, request.id, "identity_pass", (tx) => bindPerson(tx, request.id, eva.personNumber));
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

test("a verified request bound to nobody shows no patient", { skip: noDb }, async () => {
  const { request, token } = await seed();
  await applyEvent(db, request.id, "identity_pass");
  assert.equal(await findAnswerContext(token, { requestId: request.id, personNumber: "GH:eva" }), null);
});
