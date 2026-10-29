// @ts-nocheck
/* ordy request engine: ported unchanged from the first single-file prototype (see git history).
   Simulates the request service, ID Austria (Keycloak), the eHVD, Mailpit/SMS,
   the FHIR mapper and the audit log, all in the browser. Synthetic data only. */
// ---------- Reference data (from docs/*.md and track/scenario) ----------
const CLINIC = { name: 'Klinikum Beispielstadt', oid: '2.999.1.3', domain: 'klinikum.example' };
const ME = { given: 'Lena', family: 'Hofer', title: 'Dr.', matrix: '@lena.hofer:klinikum.example', role: 'Internal medicine', oid: '2.999.2.3' };
const BASE_URL = 'https://ordy.klinikum.example/r/';

const PATIENTS = [
  { id: 'maria-beispiel', mrn: 'KB-000123', given: ['Maria'], family: 'Beispiel', birthDate: '1961-03-12', gender: 'female', phone: '+43 660 000 0199', address: 'Musterstraße 1, 1000 Beispielstadt' },
  { id: 'johann-muster', mrn: 'KB-000187', given: ['Johann'], family: 'Muster', birthDate: '1948-07-02', gender: 'male', phone: '+43 660 000 0142', address: 'Lindengasse 8, 1000 Beispielstadt' },
  { id: 'petra-probst', mrn: 'KB-000204', given: ['Petra'], family: 'Probst', birthDate: '1975-11-19', gender: 'female', phone: '+43 660 000 0177', address: 'Am Anger 3, 1000 Beispielstadt' }
];

const EHVD = [
  { id: '2.999.1.1', kind: 'org', surname: 'Labor Kanalstraße', type: 'Laboratory', mail: 'office@labor-kanal.example', status: 'Aktiv' },
  { id: '2.999.2.1', kind: 'person', title: 'Dr.', firstname: 'Eva', surname: 'Brandl', specialisation: 'Lab medicine', memberof: '2.999.1.1', status: 'Aktiv' },
  { id: '2.999.1.2', kind: 'org', surname: 'Reha Waldblick', type: 'Rehabilitation clinic', mail: 'office@reha-waldblick.example', status: 'Aktiv' },
  { id: '2.999.2.2', kind: 'person', title: 'Dr.', firstname: 'Johanna', surname: 'Leitner', specialisation: 'Medical director', memberof: '2.999.1.2', status: 'Aktiv' },
  { id: '2.999.1.3', kind: 'org', surname: 'Klinikum Beispielstadt', type: 'Hospital', mail: 'office@klinikum.example', status: 'Aktiv' },
  { id: '2.999.2.3', kind: 'person', title: 'Dr.', firstname: 'Lena', surname: 'Hofer', specialisation: 'Internal medicine', memberof: '2.999.1.3', status: 'Aktiv' }
];

const BASE_CITIZENS = [
  { u: 'eva.brandl', pw: 'demo-eva', given: 'Eva', family: 'Brandl', birthdate: '1979-05-14', sub: 'c1f6a2e0-4b7d-4e55-9a31-0f2d7e8b5a11', level: 'full', plays: 'Requested lab physician' },
  { u: 'stefan.kern', pw: 'demo-stefan', given: 'Stefan', family: 'Kern', birthdate: '1986-02-03', sub: '8d2e4f7a-1c3b-4a9e-b6d0-5e7f9a1b2c34', level: 'full', plays: 'Requested discharge manager' },
  { u: 'thomas.wagner', pw: 'demo-thomas', given: 'Thomas', family: 'Wagner', birthdate: '1982-07-21', sub: '3a9b1c5d-7e2f-4d8a-9c6b-2f4e6a8b0d57', level: 'full', plays: 'Colleague in test M2' },
  { u: 'anna.huber', pw: 'demo-anna', given: 'Anna', family: 'Huber', birthdate: '1990-11-30', sub: '5e7c9a1b-3d5f-4b7e-8a2c-6d8f0b2a4c69', level: 'full', plays: 'Owner of the typo address, M1' },
  { u: 'eva.brandl2', pw: 'demo-eva2', given: 'Eva', family: 'Brandl', birthdate: '1968-09-09', sub: '9f1d3b5e-7a9c-4e1b-8d3f-5a7c9e1b3d82', level: 'full', plays: 'Second Eva Brandl, not in eHVD' }
];

const DOC_TYPES = {
  'lab-result': {
    label: 'Lab result', matrixName: 'lab result', channel: 'email', kind: 'lab report',
    policy: 'urn:aim-t2:identity-policy:lab-result:v1',
    checks: ['ID Austria, full function', 'Name matches the person you asked', 'eHVD lists an active lab physician at the named lab', 'Same person number as last time, if known'],
    why: 'Lab values feed straight into a clinical decision. A qualified physician must stand behind them.'
  },
  'rehab-report': {
    label: 'Rehab discharge report', matrixName: 'rehab discharge report', channel: 'sms', kind: 'discharge report',
    policy: 'urn:aim-t2:identity-policy:rehab-report:v1',
    checks: ['ID Austria, full function', 'Name matches the person you asked', 'Link went only to the phone number you gave', 'eHVD lists the rehab clinic'],
    why: 'The sender is administrative staff. The report names its medical author, who is filed as the author.'
  }
};
const DOC_TYPE_WORDS = ['lab', 'labor', 'result', 'results', 'befund', 'rehab', 'reha', 'discharge', 'report'];

const EVENTS = ['request_sent', 'link_opened', 'identity_checked', 'answer_sent', 'answer_filed', 'misdelivery_caught'];
const EVENT_LABEL = { request_sent: 'Request sent', link_opened: 'Link opened', identity_checked: 'Identity checked', answer_sent: 'Answer sent', answer_filed: 'Answer filed', misdelivery_caught: 'Misdelivery caught' };

const STATES = {
  awaiting_confirmation: { label: 'Address warning', cls: 'hold', task: 'draft', open: true, decide: true },
  sent: { label: 'Sent', cls: 'info', task: 'requested', open: true },
  identity_held: { label: 'Identity on hold', cls: 'hold', task: 'on-hold', open: true, decide: true },
  verified: { label: 'Identity verified', cls: 'acc', task: 'in-progress', open: true },
  answer_held: { label: 'Answer on hold', cls: 'hold', task: 'on-hold', open: true, decide: true },
  filed: { label: 'Filed', cls: 'ok', task: 'completed' },
  cancelled: { label: 'Cancelled', cls: '', task: 'cancelled' },
  expired: { label: 'Expired', cls: '', task: 'failed' },
  locked: { label: 'Locked', cls: 'bad', task: 'failed' }
};

const SAMPLE_DOCS = {
  'lab-result-maria-beispiel.md': `# Labor Kanalstraße: lab report

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
  'lab-result-max-beispiel.md': `# Labor Kanalstraße: lab report

Patient: Max Beispiel, born 1 January 1960
Requested by: Dr. Lena Hofer, Klinikum Beispielstadt
Sample taken: 22 October 2026, 08:25
Reported: 22 October 2026, 11:45

| Test | Result | Unit | Reference range | LOINC code |
|---|---|---|---|---|
| INR (prothrombin time) | 2.6 | | 0.8 to 1.2 | 6301-6 |
| aPTT | 44 | s | 25 to 37 | 14979-9 |
| Platelets | 198 | 10^9/L | 150 to 400 | 777-3 |
| Fibrinogen | 3.4 | g/L | 2.0 to 4.0 | 3255-7 |

INR and aPTT are raised, as expected under anticoagulation with phenprocoumon.

Validated by: Dr. Eva Brandl, lab physician
`,
  'rehab-report-maria-beispiel.md': `# Reha Waldblick: discharge report

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
`
};

// ---------- State ----------
const KEY = 'ordy-prototype-v1';
let S;
let clock = null; // set while seeding to backdate events
const now = () => clock ?? Date.now();
const tick = (sec) => { if (clock != null) clock += sec * 1000; };

function blankState() {
  return { seq: 1, requests: [], audit: [], bindings: [], outbox: [], matrix: [], citizens: [], sessions: {}, ui: {} };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
function load() { try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && v.requests) return v; } catch (e) {} return null; }
const citizens = () => BASE_CITIZENS.concat(S.citizens);

// ---------- Utilities ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDT(t) { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtD(t) { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function fmtISOd(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; }
function fmtDur(ms) { if (ms == null) return '–'; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${pad(s % 60)}`; }
function ago(t) { const s = Math.round((Date.now() - t) / 1000); if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return fmtDT(t); }
function uuid() { if (crypto.randomUUID) return crypto.randomUUID(); const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; }
function token() { const b = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
async function sha256(s) {
  try { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  catch (e) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return 'fnv1a-' + (h >>> 0).toString(16); }
}
const patient = (id) => PATIENTS.find((p) => p.id === id);
const pName = (p) => `${p.given.join(' ')} ${p.family}`;
const req = (id) => S.requests.find((r) => r.id === Number(id));
const reqByToken = (t) => S.requests.find((r) => r.token === t);
const ehvdOrg = (name) => EHVD.find((e) => e.kind === 'org' && nameKey(e.surname) === nameKey(name || ''));
const nameKey = (s) => [...nameWords(s)].sort().join(' ');

// ---------- Vienna time (EU DST rule) ----------
function lastSundayUTC(y, month) { const d = new Date(Date.UTC(y, month, 0)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.getTime(); }
function viennaLocalToISO(date, time) {
  const [y, mo, d] = date.split('-').map(Number); const [h, mi] = (time || '00:00').split(':').map(Number);
  const local = Date.UTC(y, mo - 1, d, h, mi);
  const dst = local >= lastSundayUTC(y, 3) + 2 * 3600e3 && local < lastSundayUTC(y, 10) + 3 * 3600e3;
  return `${date}T${pad(h)}:${pad(mi)}:00${dst ? '+02:00' : '+01:00'}`;
}
function viennaISO(ms) {
  const y = new Date(ms).getUTCFullYear();
  const dst = ms >= lastSundayUTC(y, 3) + 3600e3 && ms < lastSundayUTC(y, 10) + 3600e3;
  const off = dst ? 2 : 1; const l = new Date(ms + off * 3600e3);
  return `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}T${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}:${pad(l.getUTCSeconds())}+0${off}:00`;
}

// ---------- Identity matching (port of IDENTITY.md) ----------
const TITLES = new Set(['dr', 'mag', 'prof', 'med', 'univ', 'di', 'ing']);
function nameWords(name) {
  let s = String(name).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[-.,]/g, ' ');
  s = s.normalize('NFKD').replace(/[^\x00-\x7f]/g, '');
  return new Set(s.split(/\s+/).filter((w) => w && !TITLES.has(w)));
}
const subset = (a, b) => [...a].every((x) => b.has(x));
const shares = (a, b) => [...a].some((x) => b.has(x));
function matchRequestedPerson(rg, rf, ig, iff) {
  const wf = nameWords(rf), gf = nameWords(iff);
  if (subset(wf, gf) && subset(nameWords(rg), nameWords(ig))) return 'pass';
  if (shares(wf, gf)) return 'hold';
  return 'fail';
}
function samePatient(docName, docDob, p) {
  const fam = nameWords(p.family); const all = new Set([...fam, ...nameWords(p.given.join(' '))]); const dw = nameWords(docName || '');
  return docDob === p.birthDate && dw.size > 0 && subset(fam, dw) && subset(dw, all);
}

// ---------- Messages and the content rule ----------
function buildMessage(r) {
  const link = BASE_URL + r.token; const exp = new Date(r.expiresAt);
  if (r.channel === 'email') {
    return { subject: `Secure request from ${CLINIC.name}`, body: `Hello,\n\nDr. ${ME.given} ${ME.family} at ${CLINIC.name} has sent you a secure request.\nOpen it here: ${link}\n\nYou need ID Austria to open it. The link expires on ${fmtD(exp)}.\nIf you did not expect this message, you can ignore it.` };
  }
  return { subject: null, body: `${CLINIC.name}: Dr. ${ME.given[0]}. ${ME.family} sent you a secure request. Open it with ID Austria: ${link} (valid until ${exp.getDate()} ${MONTHS[exp.getMonth()].slice(0, 3)})` };
}
function contentCheck(text, p) {
  const words = new Set(text.toLowerCase().split(/[^a-zäöüß0-9]+/i).filter(Boolean).map((w) => w.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')));
  const nameHits = [...nameWords(pName(p))].filter((w) => words.has(w));
  const [y, m, d] = p.birthDate.split('-');
  const dates = [p.birthDate, `${d}.${m}.${y}`, `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`];
  const dateHits = dates.filter((f) => text.toLowerCase().includes(f.toLowerCase()));
  const typeHits = DOC_TYPE_WORDS.filter((w) => words.has(w));
  return [
    { label: 'No patient name', ok: nameHits.length === 0, detail: nameHits.join(', ') },
    { label: 'No birth date', ok: dateHits.length === 0, detail: dateHits.join(', ') },
    { label: 'No document type', ok: typeHits.length === 0, detail: typeHits.join(', ') }
  ];
}

// ---------- Register (eHVD + address check) ----------
function lookupPerson(given, family, orgName) {
  const org = ehvdOrg(orgName);
  const person = EHVD.find((e) => e.kind === 'person' && nameKey(e.firstname) === nameKey(given || '') && nameKey(e.surname) === nameKey(family || ''));
  return { org, person, member: !!(org && person && person.memberof === org.id) };
}
function explainDiff(a, b) {
  if (a.length !== b.length) return null;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) {
    const n = (c) => (c === 'I' ? 'a capital I' : c === 'l' ? 'a lowercase l' : c === '0' ? 'a zero' : c === 'O' ? 'a capital O' : c === '1' ? 'a one' : `"${c}"`);
    return `${n(a[i])} instead of ${n(b[i])}`;
  }
  return null;
}
function addressCheck(p) {
  if (p.channel !== 'email') return { ok: true, kind: 'phone', note: 'Phone numbers are not in the eHVD. The link goes only to this number.' };
  const org = ehvdOrg(p.org);
  const got = (p.address.split('@')[1] || '').trim();
  if (!org) return { ok: true, kind: 'unknown', got, note: 'The organisation is not in the eHVD, so the address domain cannot be compared.' };
  const exp = org.mail.split('@')[1];
  if (got === exp) return { ok: true, kind: 'match', got, exp };
  return { ok: false, kind: 'mismatch', got, exp, diff: explainDiff(got, exp) };
}

// ---------- Document parser (scenario Markdown format) ----------
function parseDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:,\s*(\d{1,2}):(\d{2}))?$/);
  if (!m) return null; const mi = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()); if (mi < 0) return null;
  return { date: `${m[3]}-${pad(mi + 1)}-${pad(Number(m[1]))}`, time: m[4] ? `${pad(Number(m[4]))}:${m[5]}` : null };
}
function parseStay(s) {
  const [l, r] = String(s || '').split(' to '); const right = parseDate(r); if (!right) return null;
  const lp = l.trim().split(/\s+/); const [ry, rm] = right.date.split('-');
  let left;
  if (lp.length === 1) left = `${ry}-${rm}-${pad(Number(lp[0]))}`;
  else if (lp.length === 2) { const mi = MONTHS.findIndex((x) => x.toLowerCase() === lp[1].toLowerCase()); left = `${ry}-${pad(mi + 1)}-${pad(Number(lp[0]))}`; }
  else left = parseDate(l)?.date;
  return { start: left, end: right.date };
}
function parseDoc(md) {
  const doc = { title: null, org: null, kind: null, fields: {}, table: [], sections: {}, order: [], free: [], raw: md, problems: [] };
  let section = null, header = null;
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trim(); if (!line) continue; let m;
    if ((m = line.match(/^#\s+(.+)$/))) { doc.title = m[1]; const i = m[1].indexOf(':'); if (i > 0) { doc.org = m[1].slice(0, i).trim(); doc.kind = m[1].slice(i + 1).trim().toLowerCase(); } continue; }
    if ((m = line.match(/^##\s+(.+)$/))) { section = m[1].trim(); doc.sections[section] = []; doc.order.push(section); continue; }
    if (line.startsWith('|')) {
      const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
      if (!header) header = cells; else { const row = {}; header.forEach((h, i) => (row[h] = cells[i] ?? '')); doc.table.push(row); }
      continue;
    }
    if (!line.startsWith('-') && (m = line.match(/^([A-Z][A-Za-z ]{1,30}):\s+(.+)$/))) { doc.fields[m[1]] = m[2]; section = section && doc.fields['Written by'] ? null : section; continue; }
    if (section) doc.sections[section].push(line); else doc.free.push(line);
  }
  if (doc.fields.Patient) { const [n, b] = doc.fields.Patient.split(', born '); doc.patientName = (n || '').trim(); doc.patientDob = parseDate(b)?.date || null; }
  if (!doc.title) doc.problems.push('No heading of the form "# Organisation: document kind".');
  if (!doc.fields.Patient) doc.problems.push('No "Patient:" line.');
  else if (!doc.patientDob) doc.problems.push('The birth date in the "Patient:" line could not be read.');
  if (doc.kind === 'lab report') {
    if (!doc.table.length) doc.problems.push('No result table.');
    doc.results = doc.table.map((row) => {
      const v = parseFloat(String(row.Result).replace(',', '.'));
      const [lo, hi] = String(row['Reference range'] || '').split(' to ').map((x) => parseFloat(x));
      const interp = isNaN(v) || isNaN(lo) || isNaN(hi) ? null : v < lo ? 'L' : v > hi ? 'H' : 'N';
      return { test: row.Test, value: v, raw: String(row.Result).trim(), unitText: row.Unit || '', ucum: (row.Unit || '').replace(/\^/g, '*'), low: lo, high: hi, rangeText: row['Reference range'], loinc: row['LOINC code'], interp };
    });
  }
  return doc;
}

// ---------- FHIR mapper ----------
const OBS_CAT = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] };
const qty = (v, code) => (code ? { value: v, unit: code, system: 'http://unitsofmeasure.org', code } : { value: v });
function practitioner(given, family, oid) {
  const r = { resourceType: 'Practitioner', name: [{ family, given: [given] }] };
  if (oid) r.identifier = [{ system: 'urn:ietf:rfc:3986', value: `urn:oid:${oid}` }];
  return r;
}
function organization(name, oid) {
  const r = { resourceType: 'Organization', name };
  if (oid) r.identifier = [{ system: 'urn:ietf:rfc:3986', value: `urn:oid:${oid}` }];
  return r;
}
function buildBundle(r, doc, cit, idToken, t) {
  const entries = []; const u = () => 'urn:uuid:' + uuid();
  const add = (res, cond) => { const full = u(); const e = { fullUrl: full, resource: res, request: { method: 'POST', url: res.resourceType } }; if (cond) e.request.ifNoneExist = cond; entries.push(e); return full; };
  const condId = (oid) => (oid ? `identifier=urn:ietf:rfc:3986|urn:oid:${oid}` : null);
  const pRef = { reference: `Patient/${r.patientId}` };
  const hofer = add(practitioner(ME.given, ME.family, ME.oid), condId(ME.oid));
  const { org: orgE, person } = lookupPerson(r.given, r.family, r.org);
  const sender = add(practitioner(cit.given, cit.family, person?.id), condId(person?.id));
  const orgRef = add(organization(orgE?.surname || r.org, orgE?.id), condId(orgE?.id));
  const ida = add(organization('ID Austria (simulation)'), null);
  const targets = []; let output; let authorRef = sender;
  if (doc.kind === 'lab report') {
    const eff = viennaLocalToISO(parseDate(doc.fields['Sample taken']).date, parseDate(doc.fields['Sample taken']).time);
    const iss = viennaLocalToISO(parseDate(doc.fields.Reported).date, parseDate(doc.fields.Reported).time);
    const obsRefs = doc.results.map((x) => {
      const o = { resourceType: 'Observation', status: 'final', category: [OBS_CAT], code: { coding: [{ system: 'http://loinc.org', code: x.loinc }], text: x.test }, subject: pRef, effectiveDateTime: eff, issued: iss, performer: [{ reference: sender }], valueQuantity: qty(x.value, x.ucum) };
      if (x.interp) o.interpretation = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: x.interp }] }];
      if (!isNaN(x.low)) o.referenceRange = [{ low: qty(x.low, x.ucum), high: qty(x.high, x.ucum), text: x.rangeText }];
      const ref = add(o); targets.push(ref); return { reference: ref };
    });
    const dr = { resourceType: 'DiagnosticReport', status: 'final', category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB' }] }], code: { coding: [{ system: 'http://loinc.org', code: '11502-2' }], text: doc.title }, subject: pRef, effectiveDateTime: eff, issued: iss, performer: [{ reference: orgRef }], resultsInterpreter: [{ reference: sender }], result: obsRefs, presentedForm: [{ contentType: 'text/markdown', data: b64(doc.raw), title: doc.title }] };
    if (doc.free.length) dr.conclusion = doc.free.join(' ');
    output = add(dr); targets.unshift(output);
  } else {
    const leit = EHVD.find((e) => e.id === '2.999.2.2');
    const wb = String(doc.fields['Written by'] || ''); const wbName = wb.split(',')[0].replace(/^Dr\.\s*/, '').trim().split(/\s+/);
    const author = leit && nameKey(`${leit.firstname} ${leit.surname}`) === nameKey(wbName.join(' ')) ? leit : null;
    authorRef = add(practitioner(wbName.slice(0, -1).join(' ') || wbName[0], wbName.slice(-1)[0], author?.id), condId(author?.id));
    const stay = parseStay(doc.fields.Stay);
    const dref = { resourceType: 'DocumentReference', status: 'current', docStatus: 'final', type: { coding: [{ system: 'http://loinc.org', code: '18842-5' }], text: 'Rehab discharge report' }, subject: pRef, date: viennaISO(t.filed), author: [{ reference: authorRef }, { reference: orgRef }], description: doc.fields.Reason, content: [{ attachment: { contentType: 'text/markdown', data: b64(doc.raw), title: doc.title } }] };
    if (stay) dref.context = { period: { start: stay.start, end: stay.end } };
    output = add(dref); targets.push(output);
  }
  const agents = [{ type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'author' }] }, who: { reference: authorRef }, onBehalfOf: { reference: orgRef } }];
  if (authorRef !== sender) agents.push({ type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'informant' }] }, who: { reference: sender }, onBehalfOf: { reference: orgRef } });
  add({
    resourceType: 'Provenance',
    text: { status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">Sent by ${esc(cit.given + ' ' + cit.family)} on ${fmtD(t.sent)}. Identity checked with ID Austria (simulation), full function, level high. The name matched the request.</div>` },
    target: targets.map((x) => ({ reference: x })), occurredDateTime: viennaISO(t.sent), recorded: viennaISO(t.filed), policy: [DOC_TYPES[r.docType].policy], agent: agents,
    signature: [{ type: [{ system: 'urn:iso-astm:E1762-95:2013', code: '1.2.840.10065.1.12.1.10' }], when: viennaISO(t.login), who: { reference: ida }, sigFormat: 'application/jose', data: b64(idToken) }]
  });
  entries.push({ fullUrl: `Task/request-${r.id}`, resource: { resourceType: 'Task', id: `request-${r.id}`, status: 'completed', intent: 'order', description: `Request for a ${DOC_TYPES[r.docType].matrixName}`, for: pRef, authoredOn: viennaISO(r.createdAt), requester: { reference: hofer }, owner: { reference: sender }, restriction: { period: { end: viennaISO(r.expiresAt) } }, output: [{ type: { text: DOC_TYPES[r.docType].label }, valueReference: { reference: output } }] }, request: { method: 'PUT', url: `Task/request-${r.id}` } });
  return { resourceType: 'Bundle', type: 'transaction', entry: entries };
}
// Structure check in the browser. It catches the traps listed in FHIR.md; the HL7 validator stays the official check.
function checkBundle(b) {
  const errs = []; const dt = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/; const inst = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  const q = (x, where) => { if (!x) return; if (x.code && !x.system) errs.push(`${where}: Quantity with code needs a system (qty-3)`); if (x.code && /\^/.test(x.code)) errs.push(`${where}: "${x.code}" is not valid UCUM`); };
  for (const e of b.entry) {
    const r = e.resource, w = r.resourceType;
    if (r.effectiveDateTime && !dt.test(r.effectiveDateTime)) errs.push(`${w}: effectiveDateTime needs a time zone`);
    if (r.issued && !inst.test(r.issued)) errs.push(`${w}: issued must be an instant`);
    if (w === 'Observation') { if (!r.status || !r.code?.coding?.[0]?.code) errs.push('Observation: status and code are required'); if (!r.subject) errs.push('Observation: subject missing'); q(r.valueQuantity, 'Observation.valueQuantity'); (r.referenceRange || []).forEach((rr) => { q(rr.low, 'referenceRange.low'); q(rr.high, 'referenceRange.high'); }); }
    if (w === 'DiagnosticReport' && (!r.status || !r.code || !r.subject)) errs.push('DiagnosticReport: status, code and subject are required');
    if (w === 'DocumentReference' && (!r.status || !r.content?.[0]?.attachment)) errs.push('DocumentReference: status and content are required');
    if (w === 'Provenance') { if (!r.target?.length || !r.agent?.length) errs.push('Provenance: target and agent are required'); if (!inst.test(r.recorded || '')) errs.push('Provenance: recorded must be an instant'); }
    if (w === 'Task' && (!r.status || !r.intent)) errs.push('Task: status and intent are required');
  }
  return errs;
}

// ---------- Audit + Matrix ----------
function audit(event, r, actorKind, actor, outcome, detail) { S.audit.push({ id: S.audit.length + 1, at: now(), event, requestId: r?.id ?? null, actorKind, actor, outcome, detail }); }
function bot(r, text, kind = 'info') { S.matrix.push({ at: now(), requestId: r?.id ?? null, text, kind }); }
const recipientLabel = (r) => `${lookupPerson(r.given, r.family, r.org).person ? 'Dr. ' : ''}${r.given} ${r.family}`;

// ---------- Request service ----------
function createRequest(p) {
  const r = { id: S.seq++, docType: p.docType, patientId: p.patientId, given: p.given.trim(), family: p.family.trim(), org: p.org.trim(), channel: p.channel, address: p.address.trim(), state: null, token: token(), createdAt: now(), expiresAt: now() + 7 * 864e5, failedChecks: 0, attempts: [], answers: [], roleConfirmed: null };
  S.requests.push(r);
  const ac = addressCheck(r); r.addressCheck = ac;
  if (!ac.ok) {
    r.state = 'awaiting_confirmation';
    audit('misdelivery_caught', r, 'doctor', ME.matrix, 'address_mismatch', `Domain ${ac.got} does not match ${ac.exp} from the eHVD`);
    bot(r, `Warning. The address domain ${ac.got} does not match ${r.org} (${ac.exp}). Send anyway with !send ${r.id}, or !cancel ${r.id}.`, 'warn');
  } else sendLink(r);
  return r;
}
function sendLink(r) {
  const m = buildMessage(r);
  S.outbox.push({ id: S.outbox.length + 1, kind: r.channel, to: r.address, subject: m.subject, body: m.body, token: r.token, requestId: r.id, at: now(), read: false });
  r.state = 'sent'; r.sentAt = now();
  audit('request_sent', r, 'doctor', ME.matrix, 'ok', `${DOC_TYPES[r.docType].label}, ${r.channel === 'email' ? 'email' : 'SMS'} to ${r.address}`);
  bot(r, `Request ${r.id} sent to ${recipientLabel(r)} (${r.org}) by ${r.channel === 'email' ? 'email' : 'SMS'}.`);
}
function linkStatus(r) {
  if (!r) return 'invalid';
  if (['cancelled', 'expired', 'locked', 'filed', 'awaiting_confirmation'].includes(r.state)) return r.state;
  if (now() > r.expiresAt) return 'expired';
  return 'open';
}
function openLink(tok) {
  const r = reqByToken(tok); const ses = S.sessions[tok] || (S.sessions[tok] = { step: 'landing' });
  if (r && linkStatus(r) === 'open' && !ses.openedAt) {
    ses.openedAt = now(); r.linkOpenedAt = r.linkOpenedAt || now();
    audit('link_opened', r, 'anonymous', `browser session ${uuid().slice(0, 8)}, ip hash ${uuid().slice(0, 6)}`, 'ok', `Request ${r.id}`);
  }
  return ses;
}
function ehvdRoleCheck(r) {
  const { org, person, member } = lookupPerson(r.given, r.family, r.org);
  if (r.docType === 'lab-result') {
    if (person && member && person.status === 'Aktiv' && /lab/i.test(person.specialisation)) return { res: 'pass', why: `eHVD ${person.id}: active, ${person.specialisation}, member of ${org.surname}` };
    return { res: 'hold', why: person ? 'Listed, but not as an active lab physician at this lab' : 'Not listed in the eHVD' };
  }
  if (org && org.status === 'Aktiv') return { res: 'pass', why: `eHVD ${org.id}: ${org.surname} is listed and active` };
  return { res: 'hold', why: 'The organisation is not listed in the eHVD' };
}
function login(tok, u) {
  const r = reqByToken(tok); const c = citizens().find((x) => x.u === u); const ses = S.sessions[tok];
  if (!r || !c) return null;
  const at = now();
  const checks = [];
  checks.push({ name: 'Level', res: c.level === 'full' ? 'pass' : 'fail', why: c.level === 'full' ? 'urn:eidgvat:eid.status.full' : 'Basis function only' });
  const nm = matchRequestedPerson(r.given, r.family, c.given, c.family);
  checks.push({ name: 'Name', res: nm, why: `Asked for ${r.given} ${r.family}, ID Austria says ${c.given} ${c.family}` });
  const b = S.bindings.find((x) => nameKey(x.given) === nameKey(r.given) && nameKey(x.family) === nameKey(r.family) && nameKey(x.org) === nameKey(r.org));
  checks.push({ name: 'Person number', res: !b || b.sub === c.sub ? 'pass' : 'fail', why: !b ? 'No binding yet, first answer from this person' : b.sub === c.sub ? `Matches binding from ${fmtD(b.firstVerifiedAt)}` : 'A different person answered as this name before' });
  const role = ehvdRoleCheck(r); checks.push({ name: 'eHVD role', res: role.res, why: role.why });
  const fail = checks.some((x) => x.res === 'fail'); const nameHold = nm === 'hold' && !fail;
  const outcome = fail ? 'fail' : nameHold ? 'hold' : 'pass';
  const attempt = { at, u: c.u, sub: c.sub, name: `${c.given} ${c.family}`, checks, outcome };
  r.attempts.push(attempt);
  audit('identity_checked', r, 'id_austria', `${c.given} ${c.family} (${c.sub.slice(0, 8)}…)`, outcome, checks.map((x) => `${x.name}: ${x.res}`).join(', '));
  ses.citizen = c.u; ses.loginAt = at;
  if (fail) {
    r.failedChecks++;
    audit('misdelivery_caught', r, 'id_austria', `${c.given} ${c.family}`, 'wrong_person', `Login does not match ${r.given} ${r.family}`);
    bot(r, `Request ${r.id} was opened by someone who is not ${recipientLabel(r)} (ID Austria name: ${c.given} ${c.family}). Nothing was shown or filed. Check the address.`, 'bad');
    if (r.failedChecks >= 3) { r.state = 'locked'; bot(r, `Request ${r.id} is locked after three failed identity checks. Send a new request if needed.`, 'bad'); }
    ses.step = 'refused';
  } else if (nameHold) {
    r.state = 'identity_held'; r.heldIdentity = attempt;
    bot(r, `Request ${r.id}: the login name ${c.given} ${c.family} matches ${r.given} ${r.family} only partly. Accept with !accept ${r.id} or reject with !reject ${r.id}.`, 'warn');
    ses.step = 'waiting';
  } else {
    r.state = 'verified'; r.verifiedSub = c.sub; r.roleConfirmed = role.res === 'pass'; r.verifiedAs = attempt;
    ses.step = 'answer';
  }
  return attempt;
}
function idTokenFor(c, r, at) {
  const h = { alg: 'RS256', typ: 'JWT', kid: 'idaustria-sim' };
  const p = { iss: 'http://localhost:8080/realms/idaustria-sim', aud: 'request-service', sub: c.sub, given_name: c.given, family_name: c.family, birthdate: c.birthdate, idaustria_level: 'urn:eidgvat:eid.status.full', idaustria_authentication_level: 'http://eidas.europa.eu/LoA/high', iat: Math.floor(at / 1000), exp: Math.floor(at / 1000) + 300, nonce: uuid().slice(0, 12) };
  const enc = (o) => b64(JSON.stringify(o)).replace(/=+$/, '');
  return `${enc(h)}.${enc(p)}.simulated-signature`;
}
async function submitAnswer(tok, { md, fileName, formName, formDob }) {
  const r = reqByToken(tok); const ses = S.sessions[tok]; const c = citizens().find((x) => x.u === ses.citizen);
  if (!r || r.state !== 'verified' || !c) return { ok: false, error: 'This request can no longer be answered.' };
  const p = patient(r.patientId); const hash = await sha256(md); const sentAt = now();
  audit('answer_sent', r, 'verified_person', `${c.given} ${c.family}`, 'ok', `${fileName || 'form'}, ${new Blob([md]).size} bytes, sha256 ${hash.slice(0, 16)}…`);
  const doc = parseDoc(md);
  const docOk = doc.patientName ? samePatient(doc.patientName, doc.patientDob, p) : null;
  const formOk = samePatient(formName, formDob, p);
  const ans = { at: sentAt, fileName, hash, size: md.length, by: `${c.given} ${c.family}`, docOk, formOk, effort: sentAt - (ses.openedAt || sentAt) };
  r.answers.push(ans);
  if (docOk === false || !formOk) {
    ans.outcome = 'patient_mismatch';
    audit('misdelivery_caught', r, 'verified_person', `${c.given} ${c.family}`, 'patient_mismatch', `Document or form does not match ${pName(p)}. Upload discarded, hash kept.`);
    bot(r, `The answer to request ${r.id} is about a different patient. Name and birth date do not match ${pName(p)}. Nothing was filed.`, 'bad');
    return { ok: false, error: 'This document is about a different patient. Check the file and upload again.', mismatch: true };
  }
  const kindOk = doc.kind === DOC_TYPES[r.docType].kind && doc.problems.length === 0;
  const t = { sent: sentAt, login: ses.loginAt, filed: now() + 2000 };
  ans.doc = doc; ans.idToken = idTokenFor(c, r, ses.loginAt); ans.sender = { given: c.given, family: c.family, sub: c.sub };
  r.answerSentAt = sentAt; r.effort = ans.effort;
  if (!kindOk || !r.roleConfirmed) {
    r.state = 'answer_held'; r.heldReason = !kindOk ? (doc.problems[0] || `The document is a "${doc.kind || 'unknown'}", not a ${DOC_TYPES[r.docType].kind}.`) : 'The eHVD could not confirm the sender’s role.';
    ans.outcome = 'held'; r.pendingAnswer = ans; r.pendingTimes = t;
    bot(r, `The answer to request ${r.id} from ${c.given} ${c.family} is on hold. ${r.heldReason} Accept with !accept ${r.id} or reject with !reject ${r.id}.`, 'warn');
    ses.step = 'done-held';
    return { ok: true, held: true };
  }
  fileAnswer(r, ans, t, c); ses.step = 'done';
  return { ok: true };
}
function fileAnswer(r, ans, t, c) {
  const doc = ans.doc; const p = patient(r.patientId);
  if (doc.kind === 'lab report' || doc.kind === 'discharge report') {
    tick(2);
    r.bundle = buildBundle(r, doc, c, ans.idToken, t);
    r.bundleErrors = checkBundle(r.bundle);
  } else {
    r.bundle = null; r.bundleErrors = [];
  }
  r.state = 'filed'; r.filedAt = now(); r.result = doc; ans.outcome = 'filed';
  const ids = r.bundle ? r.bundle.entry.filter((e) => ['Observation', 'DiagnosticReport', 'DocumentReference', 'Provenance'].includes(e.resource.resourceType)).map((e) => `${e.resource.resourceType}/${e.fullUrl.slice(9, 17)}`) : [];
  audit('answer_filed', r, 'service', 'ordy request service', 'ok', ids.join(', '));
  if (!S.bindings.find((x) => nameKey(x.given) === nameKey(r.given) && nameKey(x.family) === nameKey(r.family) && nameKey(x.org) === nameKey(r.org))) {
    S.bindings.push({ given: r.given, family: r.family, org: r.org, sub: c.sub, practitioner: `Practitioner/${uuid().slice(0, 8)}`, firstVerifiedAt: now() });
  }
  let summary = '';
  if (doc.results) { const out = doc.results.filter((x) => x.interp && x.interp !== 'N'); summary = ` ${doc.results.length} values, ${out.length ? out.length + ' outside the reference range' : 'all within the reference range'}.`; }
  bot(r, `${DOC_TYPES[r.docType].label} for ${pName(p)} from ${recipientLabel(r)} is filed. Identity checked with ID Austria.${summary}`, 'ok');
}
// Doctor decisions (Matrix commands !send, !accept, !reject, !cancel)
const act = {
  send(r) { if (r.state !== 'awaiting_confirmation') return; bot(r, `!send ${r.id} by ${ME.matrix}`, 'info'); sendLink(r); },
  accept(r) {
    if (r.state === 'identity_held') { const a = r.heldIdentity; r.state = 'verified'; r.verifiedSub = a.sub; r.roleConfirmed = a.checks.find((x) => x.name === 'eHVD role').res === 'pass'; r.verifiedAs = a; audit('identity_checked', r, 'doctor', ME.matrix, 'pass', `Accepted held identity ${a.name}`); bot(r, `Identity for request ${r.id} accepted. ${a.name} can now answer.`, 'ok'); const ses = Object.entries(S.sessions).find(([k]) => k === r.token)?.[1]; if (ses) ses.step = 'answer'; }
    else if (r.state === 'answer_held') { const ans = r.pendingAnswer; const c = citizens().find((x) => x.sub === ans.sender.sub) || ans.sender; audit('answer_filed', r, 'doctor', ME.matrix, 'accepted', `Held answer accepted: ${r.heldReason}`); S.audit.pop(); r.pendingTimes.filed = now() + 2000; fileAnswer(r, ans, r.pendingTimes, c); r.acceptedBy = ME.matrix; }
  },
  reject(r) { if (!['identity_held', 'answer_held'].includes(r.state)) return; r.state = 'cancelled'; bot(r, `Request ${r.id} rejected and cancelled by ${ME.matrix}.`, 'bad'); },
  cancel(r) { if (!STATES[r.state]?.open) return; r.state = 'cancelled'; bot(r, `Request ${r.id} cancelled.`, 'info'); },
};

// ---------- Example run (seed) ----------
async function seed() {
  S = blankState(); clock = Date.now() - 5 * 3600e3;
  const r1 = createRequest({ docType: 'lab-result', patientId: 'maria-beispiel', given: 'Eva', family: 'Brandl', org: 'Labor Kanalstraße', channel: 'email', address: 'eva.brandl@labor-kanal.example' });
  tick(1800);
  S.outbox.push({ id: S.outbox.length + 1, kind: 'email', to: 'kollege@labor-kanal.example', subject: 'Fwd: ' + S.outbox[0].subject, body: 'Thomas, can you answer this one for me?\n\n---------- Forwarded message ----------\n' + S.outbox[0].body, token: r1.token, requestId: r1.id, at: now(), read: true, forwarded: true });
  tick(240); openLink(r1.token); tick(25); login(r1.token, 'thomas.wagner'); delete S.sessions[r1.token];
  tick(900); openLink(r1.token); tick(30); login(r1.token, 'eva.brandl'); tick(40);
  await submitAnswer(r1.token, { md: SAMPLE_DOCS['lab-result-max-beispiel.md'], fileName: 'lab-result-max-beispiel.md', formName: 'Max Beispiel', formDob: '1960-01-01' });
  tick(35);
  await submitAnswer(r1.token, { md: SAMPLE_DOCS['lab-result-maria-beispiel.md'], fileName: 'lab-result-maria-beispiel.md', formName: 'Maria Beispiel', formDob: '1961-03-12' });
  tick(1500);
  const r2 = createRequest({ docType: 'lab-result', patientId: 'maria-beispiel', given: 'Eva', family: 'Brandl', org: 'Labor Kanalstraße', channel: 'email', address: 'eva.brandl@labor-kanaI.example' });
  tick(120); act.send(r2); tick(1300); openLink(r2.token); tick(20); login(r2.token, 'anna.huber'); delete S.sessions[r2.token];
  tick(2400);
  createRequest({ docType: 'rehab-report', patientId: 'maria-beispiel', given: 'Stefan', family: 'Kern', org: 'Reha Waldblick', channel: 'sms', address: '+43 660 000 0101' });
  S.outbox.forEach((m) => (m.read = m.kind === 'email'));
  clock = null; save();
}


function stepsFor(r) {
  const ev = (e) => S.audit.find((a) => a.requestId === r.id && a.event === e);
  const idOk = r.attempts.find((a) => a.outcome === 'pass') || (r.state === 'verified' || r.state === 'filed' || r.state === 'answer_held');
  const lastAtt = r.attempts[r.attempts.length - 1];
  const s = [
    { k: 'request_sent', label: 'Request sent', st: ev('request_sent') ? 'done' : r.state === 'awaiting_confirmation' ? 'hold' : r.state === 'cancelled' ? 'fail' : '', t: ev('request_sent')?.at },
    { k: 'link_opened', label: 'Link opened', st: ev('link_opened') ? 'done' : '', t: ev('link_opened')?.at },
    { k: 'identity_checked', label: 'Identity checked', st: idOk ? 'done' : r.state === 'identity_held' ? 'hold' : lastAtt?.outcome === 'fail' ? 'fail' : '', t: (r.verifiedAs || lastAtt)?.at },
    { k: 'answer_sent', label: 'Answer sent', st: r.answerSentAt ? 'done' : r.answers.some((a) => a.outcome === 'patient_mismatch') ? 'fail' : '', t: r.answerSentAt || r.answers[r.answers.length - 1]?.at },
    { k: 'answer_filed', label: 'Answer filed', st: r.state === 'filed' ? 'done' : r.state === 'answer_held' ? 'hold' : '', t: r.filedAt }
  ];
  const firstOpen = s.findIndex((x) => !x.st);
  if (firstOpen >= 0 && STATES[r.state]?.open) s[firstOpen].st = 'now';
  return s;
}

function counts() {
  const open = S.requests.filter((r) => STATES[r.state]?.open);
  return {
    open: open.length,
    waiting: S.requests.filter((r) => r.state === 'sent' || r.state === 'verified').length,
    decide: S.requests.filter((r) => STATES[r.state]?.decide).length,
    filed: S.requests.filter((r) => r.state === 'filed').length,
    caught: S.audit.filter((a) => a.event === 'misdelivery_caught').length,
    unread: S.outbox.filter((m) => !m.read).length
  };
}

function metrics() {
  const filedBundles = S.requests.filter((r) => r.bundle);
  const resCount = filedBundles.reduce((n, r) => n + r.bundle.entry.length, 0);
  const errCount = filedBundles.reduce((n, r) => n + (r.bundleErrors?.length || 0), 0);
  const efforts = S.requests.filter((r) => r.effort != null).map((r) => r.effort);
  const best = efforts.length ? efforts.slice().sort((a, b) => a - b)[Math.floor(efforts.length / 2)] : null;
  const mc = S.audit.filter((a) => a.event === 'misdelivery_caught');
  const m1 = S.requests.some((r) => mc.some((a) => a.requestId === r.id && a.outcome === 'address_mismatch'));
  const m1Full = S.requests.some((r) => mc.some((a) => a.requestId === r.id && a.outcome === 'address_mismatch') && mc.some((a) => a.requestId === r.id && a.outcome === 'wrong_person'));
  const m2 = S.requests.some((r) => r.addressCheck?.ok && mc.some((a) => a.requestId === r.id && a.outcome === 'wrong_person'));
  const m3 = mc.some((a) => a.outcome === 'patient_mismatch');
  const seen = new Set(S.audit.map((a) => a.event));
  return { resCount, errCount, bundles: filedBundles.length, effort: best, efforts, m1, m1Full, m2, m3, mCount: [m1Full || m1, m2, m3].filter(Boolean).length, cov: EVENTS.filter((e) => seen.has(e)).length, seen };
}


// ---------- Store for React ----------
const listeners = new Set<() => void>();
let version = 0;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getVersion() { return version; }
export function commit() { save(); version++; listeners.forEach((f) => f()); }
export async function boot() { S = load(); if (!S) await seed(); version++; }
export async function resetSeed() { await seed(); commit(); }
export function resetEmpty() { S = blankState(); commit(); }
export const state = () => S;

export {
  CLINIC, ME, PATIENTS, EHVD, DOC_TYPES, EVENTS, EVENT_LABEL, STATES, SAMPLE_DOCS, BASE_URL, MONTHS,
  citizens, patient, pName, req, reqByToken, recipientLabel, lookupPerson, addressCheck, buildMessage, contentCheck,
  parseDoc, parseStay, createRequest, linkStatus, openLink, login, submitAnswer, act, nameKey, uuid, now,
  fmtDT, fmtD, fmtISOd, fmtDur, ago, stepsFor, counts, metrics,
};
