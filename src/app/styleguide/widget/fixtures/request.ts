import { TRPCError } from "@trpc/server";

import { addressWarning, type AddressCheck, domainOf, sameDomain } from "@/lib/address-check";
import { outsidePersonActor } from "@/lib/audit-actor";
import type { DocumentType } from "@/lib/document-types";
import { requestInput } from "@/lib/request-input";
import type { AuditEntry, IdentityCheck } from "@/server/audit/record";
import type { bindings, heldAnswers } from "@/server/db/schema";
import type { Recipient } from "@/server/ehvd/address-check";
import type { AnswerFiled } from "@/server/fhir/file-answer";
import type { NameReason } from "@/server/identity/checks";
import { isSubset, nameWords } from "@/server/identity/names";
import { requestEmail, requestSms } from "@/server/mail/message";
import { taskStatus, transition, TransitionError, type RequestEvent, type RequestState } from "@/server/requests/lifecycle";
import { pendingDecision } from "@/server/requests/pending";
import type { RouterOutputs } from "@/trpc/types";

import type { RouterFixtures } from "../fixture-link";

type ListedRequest = RouterOutputs["request"]["list"][number];
type AuditRow = ListedRequest["audit"][number];
type StoredRequest = Omit<ListedRequest, "taskStatus" | "pending" | "audit"> & { personNumber: string | null };
type HeldAnswer = Pick<typeof heldAnswers.$inferSelect, "markdown" | "sha256" | "sender" | "reason" | "sentAt">;
type Binding = Pick<typeof bindings.$inferSelect, "given" | "family" | "org">;

/** What Postgres and HAPI hold for Dr. Hofer. The mutations change it in place, so a decision shows on the next read. */
export type FixtureStore = {
  requests: StoredRequest[];
  audit: AuditRow[];
  held: Map<number, HeldAnswer>;
  bindings: readonly Binding[];
  /** The Markdown of each filed answer on HAPI, by the reference in `answer_filed.output`. */
  filed: Map<string, string>;
};

export const HOFER = { mxid: "@lena.hofer:klinikum.example", displayName: "Dr. Lena Hofer" };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const plus = (date: Date, ms: number) => new Date(date.getTime() + ms);

type NewAuditRow = Omit<AuditRow, "id">;

const row = (at: Date, entry: AuditEntry): NewAuditRow => ({
  at,
  event: entry.event,
  requestId: entry.requestId,
  actorKind: entry.actor.kind,
  actor: entry.actor.id,
  outcome: entry.outcome,
  detail: entry.detail,
});

const byHofer = { kind: "network_member", id: HOFER.mxid } as const;
const SERVICE = { kind: "service", id: "ordy" } as const;

function newRow(store: FixtureStore, at: Date, entry: AuditEntry) {
  const id = store.audit.reduce((max, a) => Math.max(max, a.id), 0) + 1;
  store.audit.push({ id, ...row(at, entry) });
}

type Person = { name: string; personNumber: string; browser: string; ehvdEntry: boolean };

const EVA: Person = { name: "Eva Brandl", personNumber: "GH:Njtp64gB10hpR5sYe6HxgmOQJk0=", browser: "ip 5ed6decb2bc6a785", ehvdEntry: true };
const EVA_2: Person = { name: "Eva Brandl", personNumber: "GH:QqRyJqno/aFVJYjMxkWpDJWj878=", browser: "ip 2fbba9016d8d96c0", ehvdEntry: false };
const STEFAN: Person = { name: "Stefan Kern", personNumber: "GH:RF6PDuDy01ECq3HwWVdsGZpNH4A=", browser: "ip 455715443c16e9ac", ehvdEntry: false };
const THOMAS: Person = { name: "Thomas Wagner", personNumber: "GH:QQujzdblDRAvHut5+pFJYO61p04=", browser: "ip f5db51d006a4b65c", ehvdEntry: false };
const ANNA: Person = { name: "Anna Huber", personNumber: "GH:2pgjERTxixGQaVB2gPMDZjQeI84=", browser: "ip 97135aec176bbd3d", ehvdEntry: false };
const PETRA: Person = { name: "Petra Brandl", personNumber: "GH:mpWAk3kHzUqm2YVRVDNf4aDNQY0=", browser: "ip 819bce679bbdc98b", ehvdEntry: false };

const outside = (p: Person) => ({ kind: "outside_person", id: outsidePersonActor(p.name, p.personNumber) }) as const;

type Upload = { markdown: string; sha256: string; size: number };

const MARIA_LAB: Upload = {
  sha256: "8690d33a1c2cd1e14a91c3338dd48413d72a6c34a8ae8122b8d3ad8d745cad3e",
  size: 564,
  markdown: `# Labor Kanalstraße: lab report

Patient: Maria Beispiel, born 12 March 1961
Requested by: Dr. Lena Hofer, Klinikum Beispielstadt
Sample taken: 22 October 2026, 08:10
Reported: 22 October 2026, 11:40

| Test | Result | Unit | Reference range | LOINC code |
|---|---|---|---|---|
| INR (prothrombin time) | 1.0 | | 0.8 to 1.2 | 6301-6 |
| aPTT | 31 | s | 25 to 37 | 14979-9 |
| Platelets | 245 | 10^9/L | 150 to 400 | 777-3 |
| Fibrinogen | 3.1 | g/L | 2.0 to 4.0 | 3255-7 |

All values are within the reference range.

Validated by: Dr. Eva Brandl, lab physician
`,
};

const MAX_LAB = { sha256: "7e0a67cee8790c1f15acc3c7dc42256a0f833c420547059bd794f700ae4d6c8b", size: 599 };

const MARIA_REHAB: Upload = {
  sha256: "a1a77c8c33672f6f126cee24aad081ef61d1c6abc74a4bf313c67fd96fef48af",
  size: 948,
  markdown: `# Reha Waldblick: discharge report

Patient: Maria Beispiel, born 12 March 1961
Stay: 2 to 23 September 2026
Reason: rehabilitation after a total hip replacement on the left, on 18 August 2026 at Klinikum Beispielstadt

## Course

On arrival, Maria walked with two crutches. After three weeks of physiotherapy she walks up to 500 metres without aids and climbs stairs with a handrail. The wound healed without problems. There were no falls.

## Medication at discharge

- Rivaroxaban 10 mg once a day until 29 September 2026, to prevent thrombosis for six weeks after the operation
- Paracetamol 500 mg up to three times a day if needed
- Pantoprazole 20 mg once a day

## Recommendations

- Continue the home exercises.
- Outpatient physiotherapy twice a week for six weeks.
- Follow-up X-ray at Klinikum Beispielstadt in November 2026.

Written by: Dr. Johanna Leitner, medical director, Reha Waldblick
Sent by: Stefan Kern, discharge management
`,
};

const MARIA_KIDNEY: Upload = {
  sha256: "3ddc69bf5f04c2d501740db3de7065d789224f2a4106710f8c579e59568364c8",
  size: 622,
  markdown: `# Labor Kanalstraße: lab report

Patient: Maria Beispiel, born 12 March 1961
Requested by: Dr. Lena Hofer, Klinikum Beispielstadt
Sample taken: 24 October 2026, 09:10
Reported: 26 October 2026, 08:05

| Test | Result | Unit | Reference range | LOINC code |
|---|---|---|---|---|
| Creatinine | 1,02 | mg/dL | 0,50 to 0,90 | 2160-0 |
| Sodium | 138 | mmol/L | 135 to 145 | 2951-2 |
| Potassium | 3,4 | mmol/L | 3,5 to 5,1 | 2823-3 |
| Uric acid | 312 | µmol/L | 143 to 339 | 14933-6 |

Creatinine is slightly raised and potassium slightly low. Please repeat both in one week.

Validated by: Dr. Eva Brandl, lab physician
`,
};

function filing(docType: DocumentType, requestId: number, first: number): AnswerFiled {
  const ref = (type: string, offset: number) => `${type}/${first + offset}`;
  const task = `Task/ordy-request-${requestId}`;
  if (docType === "lab-result") {
    const targets = [ref("DiagnosticReport", 4), ...[5, 6, 7, 8].map((offset) => ref("Observation", offset))];
    const resources = [ref("Practitioner", 0), ref("Practitioner", 1), ref("Organization", 2), ref("Organization", 3), ...targets, ref("Provenance", 9), task];
    return { output: targets[0], targets, provenance: ref("Provenance", 9), task, sender: ref("Practitioner", 1), author: ref("Practitioner", 1), organization: ref("Organization", 2), resources };
  }
  const output = ref("DocumentReference", 5);
  const resources = [0, 1, 2].map((offset) => ref("Practitioner", offset)).concat(ref("Organization", 3), ref("Organization", 4), output, ref("Provenance", 6), task);
  return { output, targets: [output], provenance: ref("Provenance", 6), task, sender: ref("Practitioner", 1), author: ref("Practitioner", 2), organization: ref("Organization", 3), resources };
}

const filingIdsAfter = (store: FixtureStore) => 1001 + store.audit.filter((a) => a.event === "answer_filed").length * 20;

const sent = (r: StoredRequest, at: Date, sentAnyway = false) =>
  row(at, { event: "request_sent", requestId: r.id, actor: byHofer, outcome: "sent", detail: { docType: r.docType, channel: r.channel, address: r.address, sentAnyway } });

const addressMismatch = (r: StoredRequest, at: Date) =>
  row(at, {
    event: "misdelivery_caught",
    requestId: r.id,
    actor: byHofer,
    outcome: "address_mismatch",
    detail: { domain: r.address.slice(r.address.indexOf("@") + 1), expectedDomain: "labor-kanal.example" },
  });

const opened = (r: StoredRequest, at: Date, p: Person): NewAuditRow => ({
  at,
  event: "link_opened",
  requestId: r.id,
  actorKind: "anonymous",
  actor: p.browser,
  outcome: "shown",
  detail: { state: "sent" },
});

function login(r: StoredRequest, at: Date, p: Person, name: Exclude<NameReason, "requested_name_empty">, binding: string | null): NewAuditRow[] {
  const checks: IdentityCheck[] = [
    { check: "level", result: "pass", reason: "full" },
    { check: "name", result: name === "match" ? "pass" : name === "partial" ? "hold" : "fail", reason: name },
    binding === null
      ? { check: "person_number", result: "pass", reason: "no_binding" }
      : binding === p.personNumber
        ? { check: "person_number", result: "pass", reason: "binding_matches" }
        : { check: "person_number", result: "fail", reason: "binding_differs" },
    { check: "ehvd_claim", result: "pass", reason: p.ehvdEntry ? "readable" : "none" },
  ];
  const failed = checks.filter((c) => c.result === "fail");
  const verdict = failed.length ? "fail" : checks.some((c) => c.result === "hold") ? "hold" : "pass";
  const checked = row(at, { event: "identity_checked", requestId: r.id, actor: outside(p), outcome: verdict, detail: { checks } });
  if (verdict !== "fail") return [checked];
  return [checked, row(plus(at, 30), { event: "misdelivery_caught", requestId: r.id, actor: outside(p), outcome: "wrong_person", detail: { checks: failed } })];
}

const answerSent = (r: StoredRequest, at: Date, p: Person, upload: Omit<Upload, "markdown">) =>
  row(at, { event: "answer_sent", requestId: r.id, actor: outside(p), outcome: "received", detail: { sha256: upload.sha256, size: upload.size } });

const patientMismatch = (r: StoredRequest, at: Date, p: Person, upload: Omit<Upload, "markdown">) =>
  row(at, {
    event: "misdelivery_caught",
    requestId: r.id,
    actor: outside(p),
    outcome: "patient_mismatch",
    detail: { sha256: upload.sha256, size: upload.size, nameMatches: false, birthDateMatches: false },
  });

const answerFiled = (r: StoredRequest, at: Date, filed: AnswerFiled, upload: Upload) =>
  row(at, { event: "answer_filed", requestId: r.id, actor: SERVICE, outcome: "filed", detail: { ...filed, sha256: upload.sha256 } });

const decided = (r: StoredRequest, at: Date, outcome: "accepted" | "rejected" | "cancelled", from: RequestState, to: RequestState) =>
  row(at, { event: "request_decided", requestId: r.id, actor: byHofer, outcome, detail: { from, to } });

type Seed = { request: StoredRequest; story: NewAuditRow[] };

/** Requests 1 to 11 with their audit stories, at fixed times on the days before `now`. */
export function seededStore(now = new Date()): FixtureStore {
  const at = (daysAgo: number, time: string) => {
    const [h, m, s] = time.split(":").map(Number);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m, s);
  };
  const request = (fields: Omit<StoredRequest, "requester" | "requesterName" | "failedChecks" | "expiresAt" | "personNumber"> & Partial<StoredRequest>): StoredRequest => ({
    personNumber: null,
    requester: HOFER.mxid,
    requesterName: HOFER.displayName,
    failedChecks: 0,
    expiresAt: plus(fields.createdAt, WEEK_MS),
    ...fields,
  });
  const brandl = { docType: "lab-result", given: "Eva", family: "Brandl", org: "Labor Kanalstraße", channel: "email", patientId: "maria-beispiel" } as const;
  const kern = { docType: "rehab-report", given: "Stefan", family: "Kern", org: "Reha Waldblick", channel: "sms", address: "+43 660 000 0101", patientId: "maria-beispiel" } as const;
  const evaBound = EVA.personNumber;
  const filed1 = filing("lab-result", 1, 1001);
  const filed2 = filing("rehab-report", 2, 1021);
  const r3SendAnyway = at(1, "15:10:00");
  const r6Sent = at(1, "16:23:40");

  const r1 = request({ id: 1, ...brandl, address: "eva.brandl@labor-kanal.example", state: "filed", failedChecks: 1, createdAt: at(3, "09:12:00") });
  const r2 = request({ id: 2, ...kern, state: "filed", createdAt: at(3, "09:20:00") });
  const r3 = request({
    id: 3,
    ...brandl,
    address: "eva.brandl@labor-kanaI.example",
    state: "sent",
    failedChecks: 1,
    createdAt: at(2, "08:55:00"),
    expiresAt: plus(r3SendAnyway, WEEK_MS),
  });
  const r4 = request({ id: 4, ...brandl, address: "eva.brandl@labor-kanai.example", state: "awaiting_confirmation", createdAt: at(2, "09:30:00") });
  const r5 = request({ id: 5, ...brandl, address: "e.brandl@labor-kanal.example", state: "identity_held", personNumber: PETRA.personNumber, createdAt: at(2, "11:00:00") });
  const r6 = request({ id: 6, ...brandl, address: "e.brandl@labor-kanal.example", state: "answer_held", createdAt: at(1, "08:40:00") });
  const r7 = request({
    id: 7,
    ...kern,
    given: "Karl Heinz",
    family: "Moser-Wallner",
    address: "+43 660 000 0102",
    patientId: "johann-muster",
    state: "sent",
    createdAt: at(1, "10:15:00"),
  });
  const r8 = request({ id: 8, ...brandl, address: "e.brandl@labor-kanal.example", patientId: "petra-probst", state: "verified", createdAt: at(1, "11:30:00") });
  const r9 = request({ id: 9, ...kern, state: "cancelled", createdAt: at(1, "12:00:00") });
  const r10 = request({ id: 10, ...brandl, address: "e.brandl@labor-kanal.example", state: "expired", createdAt: at(8, "10:00:00") });
  const r11 = request({ id: 11, ...brandl, address: "e.brandl@labor-kanal.example", state: "locked", failedChecks: 3, createdAt: at(1, "13:00:00") });

  const seeds: Seed[] = [
    {
      request: r1,
      story: [
        sent(r1, at(3, "09:12:00")),
        opened(r1, at(3, "16:47:10"), THOMAS),
        ...login(r1, at(3, "16:48:02"), THOMAS, "no_shared_family_name", null),
        opened(r1, at(1, "14:00:46"), EVA),
        ...login(r1, at(1, "14:01:40"), EVA, "match", null),
        answerSent(r1, at(1, "14:01:51"), EVA, MAX_LAB),
        patientMismatch(r1, plus(at(1, "14:01:51"), 400), EVA, MAX_LAB),
        answerSent(r1, at(1, "14:02:00"), EVA, MARIA_LAB),
        answerFiled(r1, at(1, "14:02:12"), filed1, MARIA_LAB),
      ],
    },
    {
      request: r2,
      story: [
        sent(r2, at(3, "09:20:00")),
        opened(r2, at(2, "10:05:12"), STEFAN),
        ...login(r2, at(2, "10:06:30"), STEFAN, "match", null),
        answerSent(r2, at(2, "10:08:02"), STEFAN, MARIA_REHAB),
        answerFiled(r2, at(2, "10:08:15"), filed2, MARIA_REHAB),
      ],
    },
    {
      request: r3,
      story: [
        addressMismatch(r3, at(2, "08:55:00")),
        sent(r3, r3SendAnyway, true),
        opened(r3, at(1, "15:31:20"), ANNA),
        ...login(r3, at(1, "15:32:05"), ANNA, "no_shared_family_name", evaBound),
      ],
    },
    { request: r4, story: [addressMismatch(r4, at(2, "09:30:00"))] },
    {
      request: r5,
      story: [sent(r5, at(2, "11:00:00")), opened(r5, at(2, "13:40:05"), PETRA), ...login(r5, at(2, "13:41:00"), PETRA, "partial", null)],
    },
    {
      request: r6,
      story: [
        sent(r6, at(1, "08:40:00")),
        opened(r6, at(1, "16:20:10"), EVA),
        ...login(r6, at(1, "16:21:02"), EVA, "match", evaBound),
        answerSent(r6, r6Sent, EVA, MARIA_KIDNEY),
      ],
    },
    { request: r7, story: [sent(r7, at(1, "10:15:00"))] },
    {
      request: r8,
      story: [sent(r8, at(1, "11:30:00")), opened(r8, at(1, "17:05:30"), EVA), ...login(r8, at(1, "17:06:15"), EVA, "match", evaBound)],
    },
    { request: r9, story: [sent(r9, at(1, "12:00:00")), decided(r9, at(1, "12:04:30"), "cancelled", "sent", "cancelled")] },
    { request: r10, story: [sent(r10, at(8, "10:00:00")), opened(r10, at(7, "09:12:44"), EVA)] },
    {
      request: r11,
      story: [
        sent(r11, at(1, "13:00:00")),
        opened(r11, at(1, "18:30:10"), THOMAS),
        ...login(r11, at(1, "18:31:00"), THOMAS, "no_shared_family_name", evaBound),
        opened(r11, at(1, "18:36:40"), EVA_2),
        ...login(r11, at(1, "18:37:25"), EVA_2, "match", evaBound),
        opened(r11, at(1, "18:41:05"), ANNA),
        ...login(r11, at(1, "18:41:50"), ANNA, "no_shared_family_name", evaBound),
      ],
    },
  ];

  const audit = seeds
    .flatMap((seed) => seed.story)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((entry, index) => ({ id: index + 1, ...entry }));

  return {
    requests: seeds.map((seed) => seed.request),
    audit,
    held: new Map([
      [
        6,
        {
          markdown: MARIA_KIDNEY.markdown,
          sha256: MARIA_KIDNEY.sha256,
          sender: { givenName: "Eva", familyName: "Brandl", gdaOid: "1.2.40.0.34.3.2.99.1.2" },
          reason: "The eHVD does not list Dr. Eva Brandl as a member of Labor Kanalstraße.",
          sentAt: r6Sent,
        },
      ],
    ]),
    bindings: [
      { given: "Eva", family: "Brandl", org: "Labor Kanalstraße" },
      { given: "Stefan", family: "Kern", org: "Reha Waldblick" },
    ],
    filed: new Map([
      [filed1.output, MARIA_LAB.markdown],
      [filed2.output, MARIA_REHAB.markdown],
    ]),
  };
}

export const emptyStore = (): FixtureStore => ({ requests: [], audit: [], held: new Map(), bindings: [], filed: new Map() });

const ORGANISATION_DOMAINS = new Map([
  ["Klinikum Beispielstadt", "klinikum.example"],
  ["Labor Kanalstraße", "labor-kanal.example"],
  ["Reha Waldblick", "reha-waldblick.example"],
]);

const EHVD_PERSONS = [
  { name: "Dr. Lena Hofer", given: "Lena", family: "Hofer", memberOf: "Klinikum Beispielstadt", active: true },
  { name: "Dr. Eva Brandl", given: "Eva", family: "Brandl", memberOf: "Labor Kanalstraße", active: true },
  { name: "Dr. Johanna Leitner", given: "Johanna", family: "Leitner", memberOf: "Reha Waldblick", active: true },
  { name: "Dr. Martin Brandl", given: "Martin", family: "Brandl", memberOf: null, active: true },
  { name: "Dr. Eva Brandl-Huber", given: "Eva", family: "Brandl-Huber", memberOf: null, active: false },
];

function checkAddress(channel: "email" | "sms", address: string, org: string): AddressCheck {
  if (channel === "sms") return { result: "pass" };
  const domain = domainOf(address);
  if (!domain) return { result: "unchecked", reason: "invalid_address" };
  const expectedDomain = ORGANISATION_DOMAINS.get(org);
  if (!expectedDomain) return { result: "unchecked", reason: "organisation_not_listed" };
  return sameDomain(domain, expectedDomain) ? { result: "pass" } : { result: "mismatch", domain, expectedDomain };
}

type RecipientCheck = RouterOutputs["request"]["checkRecipient"];

function recipientAddress({ channel, address, org }: Recipient): RecipientCheck["address"] {
  if (channel === "sms") return { status: "sms" };
  const check = checkAddress(channel, address, org);
  if (check.result === "pass") return { status: "match" };
  if (check.result === "mismatch") return { status: "mismatch", domain: check.domain, expectedDomain: check.expectedDomain };
  return { status: "unchecked", reason: addressWarning(check, org) };
}

function recipientPerson({ given, family, org }: Recipient): RecipientCheck["person"] {
  const words = { given: nameWords(given), family: nameWords(family) };
  if (!words.given.size || !words.family.size) return { status: "unchecked" };
  const named = EHVD_PERSONS.filter((p) => isSubset(words.given, nameWords(p.given)) && isSubset(words.family, nameWords(p.family)));
  const member = named.find((p) => p.active && p.memberOf === org);
  if (member) return { status: "member", name: member.name };
  return named.length ? { status: "not_member" } : { status: "not_listed" };
}

const DECIDED = { accept: "accepted", reject: "rejected", cancel: "cancelled" } as const;

const newestFirst = (a: StoredRequest, b: StoredRequest) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id;

const CLINIC = "Klinikum Beispielstadt";
const SHOWN_LINK = "http://localhost:3010/r/…";
const PREVIEW_REFUSALS: ReadonlyMap<string, RouterOutputs["request"]["preview"]["refused"]> = new Map([["petra-probst", ["patient-name"]]]);

function message(requester: string, expiresAt: Date, channel: "email" | "sms") {
  const content = { requester, clinic: CLINIC, link: SHOWN_LINK, expiresAt };
  return channel === "email" ? requestEmail(content) : { subject: null, ...requestSms(content) };
}

export function requestFixtures(store: FixtureStore): RouterFixtures<"request"> {
  const auditOf = (id: number) => store.audit.filter((a) => a.requestId === id);
  const summary = (r: StoredRequest) => {
    const { personNumber, ...shown } = r;
    void personNumber;
    return { ...shown, taskStatus: taskStatus(r.state) };
  };

  function listed(r: StoredRequest) {
    const audit = auditOf(r.id);
    const filingOpen = false;
    return { ...summary(r), pending: pendingDecision(r, audit, store.held.get(r.id) ?? null, filingOpen), audit };
  }

  function own(id: number) {
    const found = store.requests.find((r) => r.id === id);
    if (!found) throw new TRPCError({ code: "NOT_FOUND", message: `Request ${id} does not exist` });
    return found;
  }

  function apply(id: number, event: RequestEvent, fields: Partial<StoredRequest> = {}) {
    const from = own(id);
    let state: RequestState;
    try {
      state = transition(from.state, event, from.failedChecks);
    } catch (error) {
      if (error instanceof TransitionError) throw new TRPCError({ code: "CONFLICT", message: error.message });
      throw error;
    }
    const changed = { ...from, ...fields, state };
    store.requests = store.requests.map((r) => (r.id === id ? changed : r));
    if (state !== "answer_held") store.held.delete(id);
    return { from: from.state, changed };
  }

  function decide(id: number, event: keyof typeof DECIDED) {
    const held = store.held.get(id);
    const { from, changed } = apply(id, event);
    const now = new Date();
    newRow(store, now, { event: "request_decided", requestId: id, actor: byHofer, outcome: DECIDED[event], detail: { from, to: changed.state } });
    if (from === "answer_held" && event === "accept" && held) {
      const filed = filing(changed.docType, id, filingIdsAfter(store));
      store.filed.set(filed.output, held.markdown);
      newRow(store, now, { event: "answer_filed", requestId: id, actor: SERVICE, outcome: "filed", detail: { ...filed, sha256: held.sha256, acceptedBy: HOFER.mxid } });
    }
    return summary(changed);
  }

  return {
    list: () => [...store.requests].sort(newestFirst).map(listed),

    get: ({ id }) => {
      const r = own(id);
      return { ...listed(r), message: message(r.requesterName, r.expiresAt, r.channel) };
    },

    preview: ({ channel, patient }) => ({
      ...message(HOFER.displayName, plus(new Date(), WEEK_MS), channel),
      refused: PREVIEW_REFUSALS.get(patient) ?? [],
    }),

    create: (raw) => {
      const parsed = requestInput.safeParse(raw);
      if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Check the request" });
      const input = parsed.data;
      const contact = input.email ? { channel: "email" as const, address: input.email } : input.phone ? { channel: "sms" as const, address: input.phone } : null;
      if (!contact) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an email address or a mobile number" });
      if (!nameWords(input.given).size || !nameWords(input.family).size) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the person's given name and family name" });
      }
      const check = checkAddress(contact.channel, contact.address, input.org);
      const now = new Date();
      const created: StoredRequest = {
        personNumber: null,
        id: store.requests.reduce((max, r) => Math.max(max, r.id), 0) + 1,
        docType: input.docType,
        patientId: input.patient,
        given: input.given,
        family: input.family,
        org: input.org,
        ...contact,
        requester: HOFER.mxid,
        requesterName: HOFER.displayName,
        state: check.result === "pass" ? "sent" : "awaiting_confirmation",
        failedChecks: 0,
        createdAt: now,
        expiresAt: plus(now, WEEK_MS),
      };
      store.requests = [...store.requests, created];
      if (check.result === "pass") newRow(store, now, { event: "request_sent", requestId: created.id, actor: byHofer, outcome: "sent", detail: { docType: created.docType, ...contact, sentAnyway: false } });
      if (check.result === "mismatch") {
        newRow(store, now, { event: "misdelivery_caught", requestId: created.id, actor: byHofer, outcome: "address_mismatch", detail: { domain: check.domain, expectedDomain: check.expectedDomain } });
      }
      return { ...summary(created), addressWarning: check.result === "pass" ? null : addressWarning(check, input.org) };
    },

    sendAnyway: ({ id }) => {
      const now = new Date();
      const { changed } = apply(id, "send_anyway", { expiresAt: plus(now, WEEK_MS) });
      newRow(store, now, { event: "request_sent", requestId: id, actor: byHofer, outcome: "sent", detail: { docType: changed.docType, channel: changed.channel, address: changed.address, sentAnyway: true } });
      return summary(changed);
    },

    accept: ({ id }) => decide(id, "accept"),
    reject: ({ id }) => decide(id, "reject"),
    cancel: ({ id }) => decide(id, "cancel"),

    checkRecipient: (input) => {
      const knownSender = store.bindings.some((b) => b.given === input.given && b.family === input.family && b.org === input.org);
      const address = recipientAddress(input);
      if (!ORGANISATION_DOMAINS.has(input.org)) return { organisation: { status: "not_listed" }, person: { status: "unchecked" }, address, knownSender };
      return { organisation: { status: "listed", name: input.org }, person: recipientPerson(input), address, knownSender };
    },
  };
}
