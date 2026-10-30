import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";

import { inArray, sql } from "drizzle-orm";

import { eidSession } from "@/server/auth/eid-session";
import { db } from "@/server/db";
import { auditLog, requests } from "@/server/db/schema";
import { fhirFetch } from "@/server/fhir/client";
import { applyEvent, applyLoginTransition, createRequest } from "@/server/requests/service";
import { loadAnswerPage } from "./answer-page";

// What GET /r/{token}/answer shows in each state, against the Postgres from DATABASE_URL. The answer form itself needs
// the FHIR server for the patient, so `verified` is left to the answer flow's tests. Skipped when Postgres is not running.
const noDb = await db.execute(sql`select 1`).then(
  () => false,
  () => "Postgres is not reachable, start it with ./scripts/setup.sh",
);

const run = randomBytes(4).toString("hex");
const EVA = { givenName: "Eva", familyName: "Brandl", personNumber: `GH:test-page-${run}`, gdaOid: "1.2.40.0.34.3.2.99.1.2" };
const created: number[] = [];

after(async () => {
  // The request service mirrored each request on its FHIR Task, if HAPI runs.
  await Promise.all(created.map((id) => fhirFetch(`Task/ordy-request-${id}`, { method: "DELETE" }).catch(() => {})));
  if (!noDb && created.length) {
    await db.delete(auditLog).where(inArray(auditLog.requestId, created));
    await db.delete(requests).where(inArray(requests.id, created));
  }
  await db.$client.end();
});

async function loggedIn(to: "verified" | "identity_held") {
  const { request, token } = await createRequest(
    db,
    {
      docType: "lab-result",
      patientId: "maria-beispiel",
      given: EVA.givenName,
      family: EVA.familyName,
      org: `Labor Kanalstraße page ${run}`,
      channel: "email",
      address: "someone@example.org",
      requester: "@lena.hofer:klinikum.example",
      requesterName: "Dr. Lena Hofer",
    },
    { passed: true },
  );
  created.push(request.id);
  assert.ok(await applyLoginTransition(db, request.id, { from: "sent", to, personNumber: EVA.personNumber }));
  return { id: request.id, token, session: eidSession.parse({ requestId: request.id, level: "urn:eidgvat:eid.status.full", ...EVA }) };
}

test("each state has its page, and only the bound person sees more than the closed link", { skip: noDb }, async () => {
  const held = await loggedIn("identity_held");
  assert.deepEqual(await loadAnswerPage(held.token, held.session), { page: "identity_held" });

  const answer = await loggedIn("verified");
  assert.deepEqual(await loadAnswerPage(answer.token, null), { page: "login" });
  assert.deepEqual(await loadAnswerPage(answer.token, held.session), { page: "login" }, "a session from another link");
  assert.deepEqual(await loadAnswerPage(answer.token, { ...answer.session, personNumber: "GH:someone-else" }), { page: "closed" });
  assert.deepEqual(await loadAnswerPage("not-a-token", answer.session), { page: "closed" });

  await applyEvent(db, answer.id, "answer_unconfirmed");
  assert.deepEqual(await loadAnswerPage(answer.token, answer.session), { page: "held" });
  await applyEvent(db, answer.id, "accept");
  assert.deepEqual(await loadAnswerPage(answer.token, answer.session), { page: "filed" });

  const cancelled = await loggedIn("verified");
  await applyEvent(db, cancelled.id, "cancel");
  assert.deepEqual(await loadAnswerPage(cancelled.token, cancelled.session), { page: "closed" });
});
