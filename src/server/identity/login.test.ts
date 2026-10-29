import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { noticeText, type Notice } from "@/server/matrix/notices";

import type { LoginIdentity } from "./checks";
import { runIdentityChecks, type AuditEntry, type CheckedRequest, type IdentityCheckPorts, type LoginDecision } from "./login";

// The test citizens of the simulated ID Austria, from the realm Keycloak imports (docs/IDENTITY.md, "Test citizens").
type RealmUser = { username: string; firstName: string; lastName: string; attributes: Record<string, string[]> };
const realm: { users: RealmUser[] } = JSON.parse(
  readFileSync(new URL("../../../docker/keycloak/idaustria-sim-realm.json", import.meta.url), "utf8"),
);

function citizen(username: string): LoginIdentity {
  const user = realm.users.find((u) => u.username === username);
  assert.ok(user, `${username} is not in the realm`);
  return {
    givenName: user.firstName,
    familyName: user.lastName,
    personNumber: user.attributes.bpk[0],
    level: user.attributes.ida_level[0],
    // Only eva.brandl has a gda attribute; the checks need only whether it decodes, which eid-session tests cover.
    gdaOid: user.attributes.gda ? "1.2.40.0.34.3.2.99.1.2" : null,
  };
}

// Request 1: Dr. Eva Brandl at Labor Kanalstraße, by email.
const request1 = (failedChecks = 0): CheckedRequest => ({ id: 1, given: "Eva", family: "Brandl", org: "Labor Kanalstraße", failedChecks });
const recipient = "Dr. Eva Brandl";

function fakePorts(binding: string | null = null) {
  const audit: AuditEntry[] = [];
  const saved: { requestId: number; state: LoginDecision["state"]; failedChecks: number }[] = [];
  const notices: Notice[] = [];
  const ports: IdentityCheckPorts = {
    findBinding: async () => binding,
    recordAudit: async (entry) => void audit.push(entry),
    saveOutcome: async (requestId, outcome) => void saved.push({ requestId, ...outcome }),
    notify: async (_requestId, notice) => void notices.push(notice),
  };
  return { ports, audit, saved, notices };
}

for (const [test_, username, name] of [
  ["M1", "anna.huber", "Anna Huber"],
  ["M2", "thomas.wagner", "Thomas Wagner"],
] as const) {
  test(`${test_}: ${username} is blocked and logged`, async () => {
    const { ports, audit, saved, notices } = fakePorts();
    const decision = await runIdentityChecks(ports, request1(), recipient, { ok: true, login: citizen(username) });

    // Blocked: nothing shown, no answer possible, the state stays so Dr. Brandl can still answer.
    assert.equal(decision.result.verdict, "fail");
    assert.equal(decision.page, "wrong_person");
    assert.equal(decision.state, null);

    // Logged: identity_checked with fail and misdelivery_caught with wrong_person.
    assert.deepEqual(
      audit.map((e) => [e.event, e.outcome]),
      [
        ["identity_checked", "fail"],
        ["misdelivery_caught", "wrong_person"],
      ],
    );
    for (const entry of audit) {
      assert.equal(entry.requestId, 1);
      assert.equal(entry.actorKind, "outside_person");
      assert.equal(entry.actor, `${name} (${citizen(username).personNumber})`);
    }
    assert.deepEqual(audit[1].detail, { checks: [{ check: "name", verdict: "fail", reason: "no_shared_family_name" }], failedChecks: 1 });
    // The audit log never names the patient.
    assert.doesNotMatch(JSON.stringify(audit), /Beispiel/);

    // Counts toward the lock.
    assert.deepEqual(saved, [{ requestId: 1, state: null, failedChecks: 1 }]);

    // Dr. Hofer gets a Matrix notice.
    assert.equal(notices.length, 1);
    assert.equal(
      noticeText(notices[0]),
      `Request 1 was opened by someone who is not Dr. Eva Brandl (ID Austria name: ${name}). Nothing was shown or filed. Check the address.`,
    );
  });
}

test("M2: the link still works for Dr. Brandl after a failed check", async () => {
  const { ports, audit, saved, notices } = fakePorts();
  const decision = await runIdentityChecks(ports, request1(1), recipient, { ok: true, login: citizen("eva.brandl") });
  assert.equal(decision.page, "answer");
  assert.deepEqual(saved, [{ requestId: 1, state: "verified", failedChecks: 1 }]);
  assert.deepEqual(audit.map((e) => [e.event, e.outcome]), [["identity_checked", "pass"]]);
  assert.equal(notices.length, 0);
});

test("the third failed check locks the link", async () => {
  const { ports, saved } = fakePorts();
  const decision = await runIdentityChecks(ports, request1(2), recipient, { ok: true, login: citizen("thomas.wagner") });
  assert.equal(decision.page, "wrong_person");
  assert.deepEqual(saved, [{ requestId: 1, state: "locked", failedChecks: 3 }]);
});

test("a partial name match holds for Dr. Hofer", async () => {
  const { ports, audit, saved, notices } = fakePorts();
  const petra = { ...citizen("eva.brandl"), givenName: "Petra", gdaOid: null };
  const decision = await runIdentityChecks(ports, request1(), recipient, { ok: true, login: petra });
  assert.equal(decision.page, "held");
  assert.deepEqual(saved, [{ requestId: 1, state: "identity_held", failedChecks: 0 }]);
  assert.deepEqual(audit.map((e) => [e.event, e.outcome]), [["identity_checked", "hold"]]);
  assert.equal(
    noticeText(notices[0]),
    "Request 1 is on hold. The ID Austria name Petra Brandl matches Dr. Eva Brandl only in part. Accept or reject the person in the widget.",
  );
});

test("Keycloak unreachable holds without a state change and shows nothing", async () => {
  const { ports, audit, saved, notices } = fakePorts();
  const decision = await runIdentityChecks(ports, request1(), recipient, { ok: false, reason: "keycloak_unreachable" });
  assert.equal(decision.result.verdict, "hold");
  assert.equal(decision.page, "unavailable");
  assert.deepEqual(saved, []);
  assert.deepEqual(audit, [
    {
      event: "identity_checked",
      requestId: 1,
      actorKind: "anonymous",
      actor: "ID Austria login",
      outcome: "hold",
      detail: { checks: [{ check: "service", verdict: "hold", reason: "keycloak_unreachable" }] },
    },
  ]);
  assert.equal(notices.length, 0);
});

test("the eHVD unreachable holds the right person for Dr. Hofer", async () => {
  const { ports, saved, notices } = fakePorts();
  const decision = await runIdentityChecks(ports, request1(), recipient, { ok: true, login: citizen("eva.brandl") }, ["ehvd"]);
  assert.equal(decision.page, "held");
  assert.deepEqual(saved, [{ requestId: 1, state: "identity_held", failedChecks: 0 }]);
  assert.equal(
    noticeText(notices[0]),
    "Request 1 is on hold. The eHVD could not be reached to confirm Eva Brandl. Accept or reject the person in the widget.",
  );
});

test("a failed notice does not change what the person sees", async () => {
  const { ports, audit } = fakePorts();
  ports.notify = async () => {
    throw new Error("Matrix down");
  };
  const error = console.error;
  console.error = () => {};
  try {
    const decision = await runIdentityChecks(ports, request1(), recipient, { ok: true, login: citizen("anna.huber") });
    assert.equal(decision.page, "wrong_person");
    assert.equal(audit.length, 2);
  } finally {
    console.error = error;
  }
});
