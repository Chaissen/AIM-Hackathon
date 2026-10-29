# Identity and misdelivery

This page covers how the outside person proves who they are, what we simulate, and how the request service catches the three misdelivery tests.

## What real ID Austria offers

ID Austria is the Austrian state electronic ID for people. Services connect to it over OpenID Connect or SAML2.

- **A test environment exists.** ID Austria runs an official reference environment with predefined test identities, each with a public username and password.
- **Every service must register.** A service needs its own service provider entry, in the test environment and in production. Private companies register only through Mein USP, the government business portal, so you need a company with a USP account.
- **Test identities have odd names.** They are called "XXXOtto XXXOttakringer" and similar, so they never match a real person. They will not match the scenario's people either.
- **There is no lookup.** Nobody can ask ID Austria whether a person has an ID Austria. A service learns about a person only when that person logs in.
- **Each service gets its own person number.** ID Austria derives a different identifier (bPK) per sector or service, so services cannot link a person's activity across services.
- **Organisations have no ID Austria.** A lab or a clinic has no login. A person can act for a company, and the business portal handles that representation.
- **Not everyone has ID Austria.** An outside person without one, for example staff who live abroad, cannot pass the check. Dr. Hofer then needs another route.

Signicat's example of an ID Austria login in the reference environment returns these claims, among others:

| Claim | Example value | Meaning |
|---|---|---|
| `given_name` | `XXXClaus - Maria` | Given names, all of them |
| `family_name` | `XXXvon Brandenburg` | Family name |
| `birthdate` | `1994-12-31` | Birth date |
| `nin` | `XERSB+9110037664968:0BV...` | The person number for this service (bPK) |
| `idaustria_level` | `urn:eidgvat:eid.status.full` | Full function: identity checked in person once |
| `idaustria_authentication_level` | `http://eidas.europa.eu/LoA/high` | eIDAS level of assurance |
| `idaustria_type_of_identity` | `http://eid.gv.at/eID/status/testidentity` | Marks a test identity |
| `idp_issuer` | `https://idp.ref.id-austria.gv.at` | The reference environment |
| `urn:eidgvat:attributes.gda` | Base64-encoded JSON | The person's eHVD entry, only for healthcare professionals acting for themselves. [eHVD](EHVD.md#id-austria-sends-the-ehvd-entry-at-login) has the details. |

Signicat is a broker, so other brokers or a direct connection may name the claims differently. The request service maps claim names in one function.

## What we simulate with Keycloak

We cannot register a service provider during the hackathon, so Keycloak plays ID Austria. The brief allows a simulated electronic ID.

Keycloak speaks the same protocol, OpenID Connect. Switching to real ID Austria changes the metadata URL, the client id, the client secret, and the claim mapping. The request service code stays the same.

| ID Austria feature | In Keycloak |
|---|---|
| Login page that sends the person back to the service | Standard OpenID Connect authorization code flow |
| Name and birth date | `given_name`, `family_name`, `birthdate` from the user profile |
| Person number | Keycloak's `sub` claim, which is stable per user and realm |
| Full or basis function | A user attribute `ida_level`, sent as `idaustria_level` |
| Level of assurance | A hardcoded claim `idaustria_authentication_level` with `http://eidas.europa.eu/LoA/high` |
| eHVD entry of a healthcare professional | A user attribute `gda`, sent as the claim `urn:eidgvat:attributes.gda` |
| Look | A login theme with the label "ID Austria (simulation)" |
| Phone-app confirmation | Not simulated. Keycloak would need a custom Java authenticator. |
| Qualified electronic signature | Not simulated. The task does not need it. |
| Acting for a company | Not simulated. The eHVD check covers the organisation. |

### Realm setup

The realm `idaustria-sim` lives in `keycloak/realm-idaustria-sim.json`. Keycloak imports it at startup with `start-dev --import-realm`.

- The client `request-service` is confidential and uses the standard flow. Its redirect URI is `http://localhost:3010/auth/callback`.
- The user profile declares `birthdate`, required at registration, and `ida_level`, which only admins can edit and which defaults to `urn:eidgvat:eid.status.full`.
- The `profile` client scope already maps `birthdate`. Two more mappers add `idaustria_level` and `idaustria_authentication_level`.
- The user profile also declares `gda`, which only admins can edit and which has no default. Keycloak drops attributes that the user profile does not declare.
- A mapper of type User Attribute sends `gda` as the claim `urn:eidgvat:attributes\.gda` in the ID token and in userinfo. The backslashes keep the dots in the claim name; without them, Keycloak builds nested objects.
- Self-registration is on. A jury member creates a new outside person in about 20 seconds. The registration page says that real ID Austria identities come from the state.

### Test citizens

| Username | Password | Name | Birth date | Plays |
|---|---|---|---|---|
| `eva.brandl` | `demo-eva` | Eva Brandl | 1979-05-14 | The requested lab physician |
| `stefan.kern` | `demo-stefan` | Stefan Kern | 1986-02-03 | The requested discharge manager |
| `thomas.wagner` | `demo-thomas` | Thomas Wagner | 1982-07-21 | Dr. Brandl's colleague in test M2 |
| `anna.huber` | `demo-anna` | Anna Huber | 1990-11-30 | The owner of the mistyped address in test M1 |
| `eva.brandl2` | `demo-eva2` | Eva Brandl | 1968-09-09 | A second Eva Brandl who is not in the eHVD |

Only `eva.brandl` has the `gda` attribute, because only she is in the eHVD. Its value is the Base64 encoding of this JSON, which matches her entry `1.2.40.0.34.3.2.99.1.2` in the [eHVD mock](EHVD.md#directory-content):

```json
{"gda":{"id":{"oidIssuingAuthority":"1.2.40.0.34","id":"1.2.40.0.34.3.2.99.1.2"},"status":{"ehvdstatus":"Aktiv","elgastatus":"Aktiv"},"firstname":"Eva","surname":"Brandl","title":"Dr.","description":["Registrierungsstelle:Österreichische Ärztekammer"],"roles":{"role":["1.2.40.0.34.5.2:159"],"elgaRole":["1.2.40.0.34.5.3:700"],"specialisation":["1.2.40.0.34.3.1.10.20:19"]},"timestamps":{"add":"2019-03-01","modify":"2026-01-15"}}}
```

All names, dates, OIDs, and passwords are synthetic.

## How the login connects to the request service

```
 Browser                      Request service                    Keycloak
    |-- GET /r/{token} --------->| link_opened                      |
    |<-- neutral page -----------|                                  |
    |-- GET /auth/login -------->|                                  |
    |<-- redirect (client_id, redirect_uri, state, nonce) ----------|
    |-- username + password ----------------------------------------->|
    |<-- redirect to /auth/callback?code=...&state=... --------------|
    |-- GET /auth/callback ----->|                                  |
    |                            |-- code + client secret --------->|
    |                            |<-- ID token (signed) ------------|
    |                            | verify signature, nonce, expiry  |
    |                            | identity checks, identity_checked|
    |<-- answer form or refusal -|                                  |
```

The request service never sees the password. Keycloak signs the ID token with its private key, and the request service checks it with Keycloak's public key, so the person cannot change their own name. The code swap runs server to server with a secret the browser never sees. The library `openid-client` does the redirects, the code swap, and the signature check inside two Next.js route handlers.

The request service keeps the raw ID token, because the Provenance carries it as proof of the identity check ([FHIR model](FHIR.md#provenance)). It also keeps the decoded `urn:eidgvat:attributes.gda` claim, if there is one, for the eHVD check.

## Identity checks

The request service runs three checks after login. They make sure the right person answers. It shows the patient and the document type only if the result is pass. A fourth check, the release check, runs when the answer arrives and makes sure the person responsible for the content released it. [Who may release a document](#who-may-release-a-document) describes it.

| Check | Pass | Hold | Fail |
|---|---|---|---|
| Level | `idaustria_level` is full | | Basis or missing |
| Name | All requested name words are in the ID Austria name | The family names share a word but do not match fully | No shared family name word |
| Person number | No binding yet, or the binding matches `sub` | | A binding exists for this person and organisation with a different `sub` |

Any fail blocks the person, writes `identity_checked` with `fail` and `misdelivery_caught` with `wrong_person`, and tells Dr. Hofer. A hold on the name sets the request to `identity_held`, and Dr. Hofer decides with `!accept` or `!reject`.

If Keycloak or the eHVD cannot be reached, the request service treats it as a hold, never as a pass.

### Name match

ID Austria returns the full official name. Dr. Hofer types what she knows. The match tolerates extra names, double names, titles, and spelling of umlauts.

| Dr. Hofer typed | ID Austria returns | Result |
|---|---|---|
| Eva Brandl | Eva Maria Brandl | Pass. An extra given name is fine. |
| Eva Brandl | Eva Brandl-Huber | Pass. A double family name contains Brandl. |
| Eva Mueller | Eva Müller | Pass. Both spell out to `mueller`. |
| Dr. Eva Brandl | Eva Brandl | Pass. Titles are ignored. |
| Eva Brandl-Huber | Eva Brandl | Hold. The family names share only Brandl. |
| Eva Brandl | Petra Brandl | Hold. Same family name, different given name. |
| Eva Brandl | Eva Huber | Fail. A married name change also fails, and Dr. Hofer can send a new request. |
| Eva Brandl | Thomas Wagner | Fail |

```ts
const TITLES = new Set(["dr", "mag", "prof", "med", "univ", "di", "ing"]);
const SPELL_OUT: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" };

export function nameWords(name: string): Set<string> {
  const plain = name
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => SPELL_OUT[c])
    .replace(/[-.,]/g, " ")
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "");
  return new Set(plain.split(/\s+/).filter((w) => w && !TITLES.has(w)));
}

const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w));
const shares = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w));

export function matchRequestedPerson(reqGiven: string, reqFamily: string, idGiven: string, idFamily: string) {
  const wantFamily = nameWords(reqFamily), gotFamily = nameWords(idFamily);
  if (isSubset(wantFamily, gotFamily) && isSubset(nameWords(reqGiven), nameWords(idGiven))) return "pass";
  if (shares(wantFamily, gotFamily)) return "hold";
  return "fail";
}
```

`isSubset(a, b)` means every word in `a` is also in `b`. The bot refuses requests with an empty `given` or `family`, because an empty set passes every subset test.

### Person number binding

After the first answer that gets filed, the request service stores the `sub` claim for the requested name and organisation in the `bindings` table. On the next request to "Eva Brandl at Labor Kanalstraße", only that `sub` passes. A second Eva Brandl then fails the person number check even if she receives the link.

### What we need about the outside person

| From | Data |
|---|---|
| Dr. Hofer, in the request | Given name, family name, email or phone, organisation |
| The outside person | An ID Austria login, access to the inbox or phone, a browser, and the document |
| ID Austria, at login | Verified name, birth date, person number, function level, time |
| The answer form | The patient's name and birth date, and the document |

We do not need the person's birth date, their ID Austria number, or an account in advance. Dr. Hofer does not have those, and no public register lists a doctor's birth date.

## Who may release a document

Only the people who are professionally responsible for a document's content may release it. The sender can be someone else, for example discharge management. So the request service checks two people: the sender, with the identity checks above, and the person responsible for the content, with the release check below.

This is our reading of Austrian law for a hackathon prototype, not legal advice. Doc 1 checks it.

### Legal basis

| Rule | Source | What follows for ordy |
|---|---|---|
| Examining people for illnesses and assessing the results with medical diagnostic aids is reserved for physicians. | § 2 Abs 2 Z 1 and 2 ÄrzteG 1998 | A medical lab report and a discharge letter are physicians' documents. |
| Specialists must limit their work to their specialty. | § 31 Abs 3 ÄrzteG 1998 | The releasing physician's specialty must cover the content. For lab reports, the specialty "Medizinische und Chemische Labordiagnostik" has the broadest authority. Other specialties may release only tests that belong to their training, for example microbiology. |
| Biomedical scientists (BMA) may produce a "biomedical-analytical finding" on their own, after a medical order: plausibility checks, comparison with earlier values. Diagnoses and treatment recommendations stay with physicians. | §§ 4 Abs 2 Z 1 lit d, 5 Abs 1 MTD-Gesetz 2024; Stöger et al., RdM 2025/38 | A value released only by a BMA is a biomedically validated result, not a medical lab report. A comment such as "INR and aPTT are raised, as expected under anticoagulation" needs a physician. |
| A lab that is an outpatient clinic must be run by a qualified physician. A lab in a hospital must be run by a specialist of the relevant specialty. That physician answers for the quality of all lab work. | §§ 7, 8 KAKuG and the state laws | The lab's medical lead is responsible even when someone else does the analysis. |
| At discharge, a hospital writes a discharge letter with what further care needs. Rehab centres are special hospitals, so this applies to them too. | § 24 Abs 2 KAKuG | The discharge letter is the rehab clinic's medical document. The physician who signs it is responsible for it. Others may send it. |
| In ELGA, a lab report is the specialist-signed, commented or interpreted report. Its legal signer is typically the medical validator or the physician responsible for the lab. A medical discharge letter is signed by the responsible physician. | ELGA CDA guides "Laborbefund" v2.06.3 (3.3.4, 3.3.5) and "Entlassungsbrief (Ärztlich)" v2.06.5 | We treat the person named under `Validated by` or `Written by` as the legal signer and check them. |

### The release check

The release check runs when the answer arrives, after the patient check.

| Document | Responsible for the content | Named in the document as | The eHVD must show |
|---|---|---|---|
| Lab result | A physician whose specialty covers the tests. For clotting, haematology, and clinical chemistry: a specialist in medical and chemical laboratory diagnostics. | `Validated by` | An active entry with `specialisation` `1.2.40.0.34.3.1.10.20:19`, member of the lab that sent the report |
| Rehab discharge report | The physician who wrote and signed it for the rehab clinic | `Written by` | An active physician (`elgaRole` `1.2.40.0.34.5.3:700`), member of the rehab clinic, and the rehab clinic itself active as a hospital (`role` 300 or 301) |

How the request service finds the responsible person in the eHVD:

- If the responsible person is the sender and the login carried the GDA claim, it uses the OID from the claim. That is the usual case for lab results.
- Otherwise it searches the eHVD for the name from the document and keeps active entries that are members of the organisation. Exactly one hit counts. [eHVD](EHVD.md#how-ordy-uses-the-ehvd-t15) has the calls.

The Provenance names the responsible person as `author` and the sender as `informant` when they differ. [FHIR model](FHIR.md#provenance) has the details.

### Block or hold

The two kinds of checks fail differently:

- **Block**, when the identity checks fail. The wrong person opened the link, for example in M1 and M2. They see nothing, cannot answer, and nothing is stored. Dr. Hofer gets a message.
- **Hold**, when the release check does not pass. The right person answered, but the eHVD does not confirm that the responsible person may release this document. Reasons: not listed, not active, another specialty, not a member of the organisation, or several people with that name. The request service keeps the answer but files nothing. Dr. Hofer gets a Matrix message with the reason and decides with `!accept` or `!reject`.

We hold instead of blocking because the eHVD can be out of date, and a physician of another specialty can be responsible for some tests. Dr. Hofer, a physician, makes that call. If she accepts, the audit log records who accepted and when, and the Provenance carries the policy `urn:aim-t2:identity-policy:accepted-by-requester:v1`.

## The eHVD

The eHealth directory (eHVD) lists every person and organisation in Austria that works as a healthcare provider, with name, roles, specialties, practice addresses, membership in organisations, and whether they may currently practise (`Aktiv` or `Inaktiv`). [eHVD](EHVD.md) describes the real SOAP interface and our mock in detail.

What matters for identity:

- For healthcare professionals, ID Austria can send the eHVD entry at login (`urn:eidgvat:attributes.gda`). The eHVD OID in the claim then links the login to the directory entry through the state. Keycloak sends it for `eva.brandl`.
- Without the claim, the name is the only link, because the eHVD has no birth date and no person number.
- People who are not healthcare professionals, such as a discharge manager, are not listed as persons. Their organisation is.
- The claim has no organisation membership. The request service asks the eHVD for the entry's `memberof`.
- The real web service needs a registration with the health ministry and an IP allowlist entry at BRZ. That does not fit into a hackathon, so we run a mock with the same interface in its own container.

The mock holds Labor Kanalstraße, Reha Waldblick, Klinikum Beispielstadt, Dr. Eva Brandl, Dr. Johanna Leitner, Dr. Lena Hofer, two other people named Brandl, the official test entries, and generated filler entries. [eHVD](EHVD.md#directory-content) has the full list with OIDs.

Stefan Kern and Thomas Wagner are not listed. The second Eva Brandl is not listed either.

## Misdelivery tests

All three run on request 1, Dr. Brandl by email. A test counts if its condition holds and the audit log has the event.

### M1: wrong address

Dr. Hofer types `eva.brandl@labor-kanaI.example`, with a capital I.

1. The address check sees that the domain differs from `labor-kanal.example` in the eHVD. The bot warns Dr. Hofer and writes `misdelivery_caught` with `address_mismatch`.
2. For the test, Dr. Hofer sends `!send 1` anyway.
3. Anna Huber opens the email in Mailpit and clicks the link. The page shows only "Dr. Lena Hofer at Klinikum Beispielstadt sent you a request".
4. She logs in as `anna.huber`. The name check fails.
5. She sees "This request is for someone else. Nothing was shared with you." She never sees the patient or the document type, and she cannot answer.
6. The audit log has `identity_checked` with `fail` and `misdelivery_caught` with `wrong_person`. Dr. Hofer gets a Matrix message.

### M2: forwarded request

Dr. Brandl forwards the email to `kollege@labor-kanal.example`.

1. Thomas Wagner opens the link and logs in as `thomas.wagner`.
2. The name check fails. He sees nothing and cannot answer.
3. The audit log has `identity_checked` with `fail` and `misdelivery_caught` with `wrong_person`. Dr. Hofer gets "Request 1 was opened by someone who is not Dr. Eva Brandl (ID Austria name: Thomas Wagner)".
4. The link still works for Dr. Brandl until three checks have failed.

### M3: wrong patient

Dr. Brandl logs in and uploads `lab-result-max-beispiel.md`, a result for Max Beispiel, born 1 January 1960.

1. The parser reads "Max Beispiel" and 1960-01-01 from the document.
2. The patient check fails. Neither the birth date nor the given name matches Maria Beispiel.
3. Nothing is filed. Dr. Brandl sees "This document is about a different patient. Check the file and upload again."
4. The audit log has `misdelivery_caught` with `patient_mismatch`. Dr. Hofer gets a Matrix message that names Maria and does not name Max.
5. The request service discards the upload and keeps only its SHA-256 hash.

```ts
export function samePatient(docName: string, docBirthDate: string, patient: { family: string; given: string[]; birthDate: string }) {
  const family = nameWords(patient.family);
  const allNames = new Set([...family, ...nameWords(patient.given.join(" "))]);
  const docWords = nameWords(docName);
  return docBirthDate === patient.birthDate && isSubset(family, docWords) && isSubset(docWords, allNames);
}
```

The request service runs this check on the document and on the name and birth date typed into the form. Both must pass.

## Sources

- [ID Austria predefined test identities](https://www.id-austria.gv.at/de/developer/testen/vordefinierte-testidentit%C3%A4ten)
- [ID Austria: testing on mobile devices](https://www.id-austria.gv.at/de/developer/testen/testen-auf-mobilen-ger%C3%A4ten)
- [ID Austria: connecting via SAML2 (PVP2 S-Profil)](https://www.id-austria.gv.at/de/developer/anbinden/anbindung-via-saml2-(pvp2-s-profil))
- [ID Austria whitepaper for service owners v1.4](https://www.id-austria.gv.at/dam/jcr:af50dfdb-d7d3-4e98-bfe7-f2dc0b1dec36/ID-Austria-Whitepaper-Service-Owner-v1.4.pdf)
- [ID Austria technical background v1.4](https://www.id-austria.gv.at/dam/jcr:f86f12a4-87fb-44d6-89a2-e5111a388577/ID-Austria-Technische-Hintergrundinformationen-v1.4-1.pdf)
- [ID Austria whitepaper for end users](https://www.id-austria.gv.at/dam/jcr:1ee37fa4-5781-4db3-9839-b12417bd917f/ID-Austria-Whitepaper-fuer-EndanwenderInnen.docx.pdf)
- [USP: registering as an ID Austria service provider](https://www.usp.gv.at/hilfe-und-support/verfahrensrechte/registrierung-als-ida-sp.html)
- [USP: ID Austria for companies and public bodies](https://www.usp.gv.at/themen/betrieb-und-umwelt/laufender-betrieb/weitere-informationen-laufender-betrieb/id-austria-fuer-unternehmen-und-behoerden.html)
- [USP: company representation with ID Austria](https://www.usp.gv.at/ueber-das-usp/infos-fuer-verfahrenspartner/ida-anbindung.html)
- [Signicat: ID Austria integration guide](https://developer.signicat.com/identity-methods/id-austria/integration/)
- [Signicat: ID Austria OIDC attributes](https://developer.signicat.com/identity-methods/id-austria/attributes-reference/id-austria-attributes-oidc/)
- [chil.at: a public ID Austria SAML2 test service provider](https://chil.at/projects/2025-07-31_id-austria-service-provider-test/saml/)
- [BMF: supplementary register for natural persons](https://www.bmf.gv.at/ministerium/aufgaben-und-organisation/Stammzahlenregisterbehoerde/Ergaenzungsregister.html)
- [eHVD web service handbook v2.4](https://www.gesundheit.gv.at/dam/gesundheitgvat/professional/it-services/ehvd/eHVD-ServicehandbuchV2.4.pdf), sections 2, 3.2, 3.3.2, and 5.2
- [ID Austria: attribute "Gesundheitsdiensteanbieter"](https://www.id-austria.gv.at/de/developer/registrieren/personenmerkmale/Gesundheitsdiensteanbieter)
- [eHVD](EHVD.md) lists all sources on the eHVD interface
- [Ärztegesetz 1998, § 2 and § 31](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10011138)
- [MTD-Gesetz 2024, §§ 4 and 5](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20012653)
- [Krankenanstalten- und Kuranstaltengesetz, § 24](https://www.ris.bka.gv.at/eli/bgbl/1957/1/P24/NOR40211928)
- [Stöger, Wagner, Griesmacher, Hörmann: Biomedizinisch-analytische und ärztliche Befundung, RdM 2025/38](https://biomed-austria.at/sites/default/files/uploads/St%C3%B6ger%20et%20al%20Befundung%20BMA_RdM%2025-38.pdf), and the [reply by Biomed Austria](https://biomed-austria.at/sites/default/files/uploads/Stellungnahme_St%C3%B6ger%20et%20al%20Befundung%20BMA_RdM%2025-38_Biomed%20Austria_0.pdf)
- [ELGA CDA implementation guide: lab report v2.06.3](https://www.gesundheit.gv.at/dam/jcr:850c95f5-438a-40e4-864c-30839c3b49ea/Implementierungsleitfaden_Laborbefund_V2.06.3.pdf)
- [ELGA CDA implementation guide: medical discharge letter v2.06.5](https://www.gesundheit.gv.at/dam/jcr:ca65e81f-caff-410d-b6fb-0d83c3df5054/Implementierungsleitfaden_Entlassungsbrief_%C3%84rztlich_V2.06.5.pdf)
- [GDA-Index glossary entry](https://www.gesundheit.gv.at/lexikon/G/gda-index.html)
- [ELGA guide for laboratory medicine v2.0](https://www.elga.gv.at/fileadmin/user_upload/Dokumente_PDF_MP4/Technisches/Leitfaden_ELGA_f%C3%BCr_Labormedizin_V2.0.pdf)
- [Keycloak server administration guide](https://www.keycloak.org/docs/latest/server_admin/index.html)
- [Keycloak: importing and exporting realms](https://www.keycloak.org/server/importExport)
