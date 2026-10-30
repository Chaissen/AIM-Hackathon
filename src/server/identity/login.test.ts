import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { noticeText, type Notice } from "@/server/matrix/notices";

import { BASIC_FUNCTION, type LoginIdentity } from "./checks";
import { runIdentityChecks, type AuditEntry, type CheckedRequest, type IdentityCheckPorts, type LoginOutcome, type RequestState } from "./login";

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

const eva = citizen("eva.brandl");
const petra: LoginIdentity = { ...eva, givenName: "Petra", personNumber: "GH:petra", gdaOid: null };
const recipient = "Dr. Eva Brandl";
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Request 1 (Dr. Eva Brandl at Labor Kanalstraße) in an in-memory store. The ports keep the contract the request core
 * must keep: the count goes up atomically, and a transition applies only while the state is still `from`.
 */
function store(state: RequestState = "sent", { failedChecks = 0, personNumber = null as string | null, binding = null as string | null } = {}) {
  const row = { id: 1, given: "Eva", family: "Brandl", org: "Labor Kanalstraße", state, failedChecks, personNumber };
  const audit: AuditEntry[] = [];
  const notices: Notice[] = [];
  const ports: IdentityCheckPorts = {
    findBinding: async () => binding,
    recordAudit: async (entry) => void audit.push(entry),
    incrementFailedChecks: async () => {
      await tick();
      return ++row.failedChecks;
    },
    transition: async (_id, change) => {
      await tick();
      if (row.state !== change.from) return false;
      row.state = change.to;
      if ("personNumber" in change) row.personNumber = change.personNumber;
      return true;
    },
    notify: async (_id, notice) => void notices.push(notice),
  };
  const request = (): CheckedRequest => ({ ...row });
  const login = (who: LoginIdentity, unreachable: ReadonlyArray<"ehvd"> = []) =>
    runIdentityChecks(ports, request(), recipient, { ok: true, login: who }, unreachable);
  return { row, ports, audit, notices, request, login };
}

const events = (audit: AuditEntry[]) => audit.map((e) => [e.event, e.outcome]);

for (const [test_, username, name] of [
  ["M1", "anna.huber", "Anna Huber"],
  ["M2", "thomas.wagner", "Thomas Wagner"],
] as const) {
  test(`${test_}: ${username} is blocked and logged`, async () => {
    const s = store();
    const run = await s.login(citizen(username));

    // Blocked: nothing shown, no answer possible, the state stays so Dr. Brandl can still answer.
    assert.equal(run.result?.verdict, "fail");
    assert.equal(run.page, "wrong_person");
    assert.equal(run.transition, null);
    assert.equal(s.row.state, "sent");

    // Logged: identity_checked with fail and misdelivery_caught with wrong_person.
    assert.deepEqual(events(s.audit), [
      ["identity_checked", "fail"],
      ["misdelivery_caught", "wrong_person"],
    ]);
    for (const entry of s.audit) {
      assert.equal(entry.requestId, 1);
      assert.equal(entry.actorKind, "outside_person");
      assert.equal(entry.actor, `${name} (${citizen(username).personNumber})`);
    }
    assert.deepEqual(s.audit[1].detail, { checks: [{ check: "name", result: "fail", reason: "no_shared_family_name" }] });
    // The audit log never names the patient.
    assert.doesNotMatch(JSON.stringify(s.audit), /Beispiel/);

    // Counts toward the lock.
    assert.equal(run.failedChecks, 1);
    assert.equal(s.row.failedChecks, 1);

    // Dr. Hofer gets a Matrix notice.
    assert.deepEqual(s.notices.map(noticeText), [
      `Request 1 was opened by someone who is not Dr. Eva Brandl (ID Austria name: ${name}). Nothing was shown or filed. Check the address.`,
    ]);
  });
}

test("M2: the link still works for Dr. Brandl after a failed check, and binds her", async () => {
  const s = store("sent", { failedChecks: 1 });
  const run = await s.login(eva);
  assert.equal(run.page, "answer");
  assert.deepEqual(run.transition, { from: "sent", to: "verified", personNumber: eva.personNumber });
  assert.deepEqual([s.row.state, s.row.personNumber, s.row.failedChecks], ["verified", eva.personNumber, 1]);
  assert.deepEqual(events(s.audit), [["identity_checked", "pass"]]);
  assert.equal(s.notices.length, 0);

  // She logs in again after the session expired: still the answer page, no transition.
  const again = await s.login(eva);
  assert.equal(again.page, "answer");
  assert.equal(again.transition, null);
});

test("the third failed check locks the link", async () => {
  const s = store("sent", { failedChecks: 2 });
  const run = await s.login(citizen("thomas.wagner"));
  assert.equal(run.page, "wrong_person");
  assert.deepEqual(run.transition, { from: "sent", to: "locked" });
  assert.deepEqual([s.row.state, s.row.failedChecks], ["locked", 3]);
});

test("three wrong logins at the same time still lock the link", async () => {
  const s = store();
  const runs = await Promise.all(["anna.huber", "thomas.wagner", "anna.huber"].map((u) => s.login(citizen(u))));
  assert.deepEqual(runs.map((r) => r.failedChecks).sort(), [1, 2, 3]);
  assert.deepEqual([s.row.state, s.row.failedChecks], ["locked", 3]);
});

test("a failed check outside sent counts but asks for no transition the lifecycle lacks", async () => {
  for (const state of ["verified", "identity_held", "answer_held"] as const) {
    const s = store(state, { failedChecks: 2, personNumber: eva.personNumber });
    const run = await s.login(citizen("thomas.wagner"));
    assert.equal(run.page, "wrong_person", state);
    assert.equal(run.transition, null, state);
    assert.deepEqual([s.row.state, s.row.failedChecks], [state, 3]);
  }
});

test("a partial name match holds for Dr. Hofer and stores the held person", async () => {
  const s = store();
  const run = await s.login(petra);
  assert.equal(run.page, "held");
  assert.deepEqual([s.row.state, s.row.personNumber, s.row.failedChecks], ["identity_held", "GH:petra", 0]);
  assert.deepEqual(events(s.audit), [["identity_checked", "hold"]]);
  assert.deepEqual(s.notices.map(noticeText), [
    "Request 1 is on hold. The ID Austria name Petra Brandl matches Dr. Eva Brandl only in part. Accept or reject the person in the widget.",
  ]);
});

test("after Accept, the held person can answer, and only she", async () => {
  const s = store();
  await s.login(petra);
  // Dr. Hofer clicks Accept: identity_held → verified. requests.person_number keeps Petra.
  s.row.state = "verified";

  const run = await s.login(petra);
  assert.equal(run.result?.verdict, "pass");
  assert.equal(run.page, "answer");
  assert.equal(run.transition, null);
  assert.equal(s.row.state, "verified");
  // The name still holds in the audit detail; the acceptance is why she passes.
  assert.deepEqual(s.audit.at(-1)?.detail, {
    checks: [
      { check: "level", result: "pass", reason: "full" },
      { check: "name", result: "hold", reason: "partial" },
      { check: "person_number", result: "pass", reason: "no_binding" },
      { check: "ehvd_claim", result: "pass", reason: "none" },
      { check: "request_person", result: "pass", reason: "same_person" },
    ],
  });

  // Somebody else, even with the full requested name, fails now.
  s.notices.length = 0;
  const other = await s.login(eva);
  assert.equal(other.page, "wrong_person");
  assert.deepEqual(s.notices.map(noticeText), [
    "Request 1 was opened by Eva Brandl, but the identity check failed. Another person already logged in for this request as Dr. Eva Brandl. Nothing was shown or filed.",
  ]);
});

test("a login while the identity is held changes nothing", async () => {
  const s = store("identity_held", { personNumber: "GH:petra" });
  // A full pass does not skip Dr. Hofer's decision.
  const pass = await s.login(eva);
  assert.equal(pass.result?.verdict, "pass");
  assert.equal(pass.page, "held");
  assert.equal(pass.transition, null);
  // A second partial match does not replace the held person.
  const hold = await s.login({ ...petra, givenName: "Paula", personNumber: "GH:paula" });
  assert.equal(hold.page, "held");
  assert.equal(hold.transition, null);
  assert.deepEqual([s.row.state, s.row.personNumber], ["identity_held", "GH:petra"]);
  assert.equal(s.notices.length, 0);
  assert.deepEqual(events(s.audit), [
    ["identity_checked", "pass"],
    ["identity_checked", "hold"],
  ]);
});

test("a login while the answer is held shows the held page", async () => {
  const s = store("answer_held", { personNumber: eva.personNumber });
  const run = await s.login(eva);
  assert.equal(run.page, "held");
  assert.equal(run.transition, null);
});

test("a pass that loses the race to a hold shows try again", async () => {
  const s = store();
  const [held, passed] = await Promise.all([s.login(petra), s.login(eva)]);
  // Petra's transition ran first in this store, so Eva's pass finds the request held.
  assert.equal(held.applied, true);
  assert.equal(passed.applied, false);
  assert.equal(passed.page, "unavailable");
  assert.equal(s.row.state, "identity_held");
});

test("a hold that loses the race to a pass shows try again and tells Dr. Hofer nothing", async () => {
  const s = store();
  const [passed, held] = await Promise.all([s.login(eva), s.login(petra)]);
  // Eva's pass ran first, so Petra's hold is never applied and nobody will decide on it.
  assert.equal(passed.applied, true);
  assert.equal(held.applied, false);
  assert.equal(held.page, "unavailable");
  assert.equal(held.notice, null);
  assert.equal(s.notices.length, 0);
  assert.deepEqual([s.row.state, s.row.personNumber], ["verified", eva.personNumber]);
});

test("a bound request without a person number fails closed", async () => {
  for (const state of ["verified", "answer_held"] as const) {
    const s = store(state, { personNumber: null });
    // The second Eva Brandl has the full requested name; she must not get the answer page.
    const run = await s.login(citizen("eva.brandl2"));
    assert.equal(run.result?.verdict, "fail", state);
    assert.equal(run.page, "wrong_person", state);
    assert.deepEqual(s.audit[1].detail, { checks: [{ check: "request_person", result: "fail", reason: "unbound" }] }, state);
    assert.deepEqual(
      s.notices.map(noticeText),
      [
        "Request 1 was opened by Eva Brandl, but the identity check failed. The request stores no person number to compare with, so nobody can be confirmed. Nothing was shown or filed.",
      ],
      state,
    );
  }
});

test("Keycloak unreachable holds without a state change and shows nothing", async () => {
  const s = store();
  const outcome: LoginOutcome = { ok: false, reason: "keycloak_unreachable" };
  const run = await runIdentityChecks(s.ports, s.request(), recipient, outcome);
  assert.equal(run.result?.verdict, "hold");
  assert.equal(run.page, "unavailable");
  assert.deepEqual([s.row.state, s.row.failedChecks], ["sent", 0]);
  assert.deepEqual(s.audit, [
    {
      event: "identity_checked",
      requestId: 1,
      actorKind: "anonymous",
      actor: "ID Austria login",
      outcome: "hold",
      detail: { checks: [{ check: "service", result: "hold", reason: "keycloak_unreachable" }] },
    },
  ]);
  assert.equal(s.notices.length, 0);
});

test("the eHVD unreachable holds a new person for Dr. Hofer, not the bound one", async () => {
  const s = store();
  const run = await s.login(eva, ["ehvd"]);
  assert.equal(run.page, "held");
  assert.deepEqual([s.row.state, s.row.personNumber], ["identity_held", eva.personNumber]);
  assert.deepEqual(s.notices.map(noticeText), [
    "Request 1 is on hold. The eHVD could not be reached to confirm Eva Brandl. Accept or reject the person in the widget.",
  ]);

  const bound = store("verified", { personNumber: eva.personNumber });
  assert.equal((await bound.login(eva, ["ehvd"])).page, "answer");
});

test("a link that no longer works runs no check", async () => {
  for (const state of ["awaiting_confirmation", "filed", "cancelled", "expired", "locked"] as const) {
    const s = store(state);
    const run = await s.login(citizen("anna.huber"));
    assert.equal(run.page, "closed", state);
    assert.equal(run.result, null, state);
    assert.deepEqual([s.audit.length, s.notices.length, s.row.failedChecks], [0, 0, 0], state);
  }
});

test("a fail with the right name tells Dr. Hofer the actual reason", async () => {
  const cases: [string, LoginIdentity, string | null, string][] = [
    [
      "basic level",
      { ...eva, level: BASIC_FUNCTION },
      null,
      "The ID Austria login has only basic function, and a request needs full function.",
    ],
    ["no level", { ...eva, level: undefined }, null, "The login carries no ID Austria level, as with a foreign eID."],
    ["no bPK", { ...eva, personNumber: null }, null, "The login carries no person number."],
    ["malformed gda claim", { ...eva, gdaOid: new Error("bad") }, null, "The eHVD entry in the login could not be read."],
    [
      "second Eva Brandl against the binding",
      citizen("eva.brandl2"),
      eva.personNumber,
      "The person number differs from the one bound to Dr. Eva Brandl at Labor Kanalstraße.",
    ],
  ];
  for (const [label, who, binding, reason] of cases) {
    const s = store("sent", { binding });
    const run = await s.login(who);
    assert.equal(run.page, "wrong_person", label);
    assert.deepEqual(events(s.audit), [
      ["identity_checked", "fail"],
      ["misdelivery_caught", "wrong_person"],
    ], label);
    assert.deepEqual(s.notices.map(noticeText), [
      `Request 1 was opened by Eva Brandl, but the identity check failed. ${reason} Nothing was shown or filed.`,
    ], label);
  }
});

test("a failed notice does not change what the person sees", async () => {
  const s = store();
  s.ports.notify = async () => {
    throw new Error("Matrix down");
  };
  const error = console.error;
  console.error = () => {};
  try {
    const run = await s.login(citizen("anna.huber"));
    assert.equal(run.page, "wrong_person");
    assert.equal(s.audit.length, 2);
  } finally {
    console.error = error;
  }
});
