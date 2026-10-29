# Whitepaper: requesting documents from outside the PGK network

Track 2, health data interoperability. Hackathon prototype on synthetic data. Not a medical device.

## The problem

Austrian doctors are piloting PGK, a closed document network built on Matrix. Members are listed in a directory, and only members can be reached. Labs, rehab clinics, and patients outside the network still send results by fax or unencrypted email. The results come back as scans that someone at the clinic types in by hand.

In the scenario, Dr. Lena Hofer (internal medicine, Klinikum Beispielstadt) needs two documents about her patient Maria Beispiel, born 12 March 1961:

1. Maria's latest blood clotting tests, from Dr. Eva Brandl at Labor Kanalstraße, before a planned procedure. Dr. Hofer has Dr. Brandl's work email address.
2. Maria's rehab discharge report, from Stefan Kern, discharge manager at Reha Waldblick. Dr. Hofer has his mobile number.

Neither person is in the directory. Dr. Hofer knows only their name, their role, and one contact. The request is always for the named person, and a colleague may not answer for them.

## What we build

We build a request service that runs at the clinic, next to its Matrix server and its FHIR server.

1. Dr. Hofer types a request into her Matrix room. The bot inside the request service picks it up.
2. The request service sends the outside person a link by email or SMS. The message contains no patient name, no birth date, and no document type.
3. The outside person opens the link and logs in with ID Austria. In the demo, Keycloak plays ID Austria.
4. The request service checks that the login belongs to the person Dr. Hofer asked for. Only then does the page show the patient and the requested document.
5. The outside person uploads the document and confirms the patient's name and birth date in a form.
6. The request service checks that the document is about the right patient. It turns the document into FHIR resources plus a Provenance resource and stores them on the FHIR server.
7. The bot tells Dr. Hofer in her Matrix room.

The request service writes an audit entry at each step.

```
Dr. Hofer (Element)          Request service              Outside person            ID Austria
       |                            |                            |                        |
       |-- !request ...  ---------->|                            |                        |
       |                            |-- email or SMS, link ----->|                        |
       |                            |<-- opens link -------------|                        |
       |                            |                            |-- logs in ------------>|
       |                            |<-- signed token: name, birth date, person number ---|
       |                            |   identity checks          |                        |
       |                            |-- form with patient ------>|                        |
       |                            |<-- document + patient -----|                        |
       |                            |   patient check            |                        |
       |                            |   file FHIR + Provenance   |                        |
       |<-- "result is filed" ------|                            |                        |
```

[Architecture](ARCHITECTURE.md) has the components and the request lifecycle. [Identity and misdelivery](IDENTITY.md) has the checks. [FHIR model](FHIR.md) has the resources.

## Design answers

These answers go into the repository README for the submission.

### 1. How does an outside person prove who they are if they are in no directory?

They log in with ID Austria, the Austrian state electronic ID. ID Austria gives our service their verified name, their birth date, and a person number that stays the same for our service. We compare the name with the name Dr. Hofer typed. The person needs no account with us and does not need to be in any directory beforehand.

Two more facts back up the name. First, the link went only to the address or phone number Dr. Hofer gave, so the person has access to that inbox or phone. Second, healthcare professionals are listed in the Austrian eHealth directory (eHVD) with name, specialty, practice address, and whether they may currently practise. We check the eHVD where the role matters. For healthcare professionals, ID Austria can also send their eHVD entry at login, which ties the login to the directory entry through the state and not only through the name.

After the first verified answer, we store the person number. From then on, only that exact person can answer as "Eva Brandl", even if a second Eva Brandl exists.

Nobody can ask ID Austria in advance whether a person has an ID Austria. We learn it when they log in.

### 2. Which identity check do you require for each type of document and why?

Every outside person sees the patient's name once the identity check passes. So every document type needs an ID Austria login at the full function level, which means the person's identity was checked in person once. The other checks depend on who answers and on what the document is used for.

| Document | Who answers | Checks | Why |
|---|---|---|---|
| Lab result | The named lab physician | ID Austria full, name match, eHVD lists the person as an active specialist in lab medicine who is a member of the named lab (found through the eHVD entry from the login, or by name), person number if known | Lab values feed straight into a clinical decision, here the clearance for a procedure. A qualified physician must stand behind them. |
| Rehab discharge report | The named discharge manager | ID Austria full, name match, the link went to the phone number Dr. Hofer gave, eHVD lists the rehab clinic | The sender is administrative staff and is not in a professional register. The report names its medical author, and we file that physician as the author. |
| Any document from a person the eHVD cannot confirm | The named person | ID Austria full, name match. The answer waits until Dr. Hofer accepts it in Matrix. | We cannot confirm the role, so a human decides. |

### 3. Which FHIR resources do you create and how do they reference each other and the patient?

| Answer | Resources |
|---|---|
| Lab result | One Observation per test, with the LOINC code from the document, UCUM units, reference range, and interpretation. One DiagnosticReport groups the Observations and carries the original document. |
| Rehab report | One DocumentReference with the report text attached and the stay period. |
| Every answer | One Provenance that targets everything filed. It records who sent the answer, when, and how their identity was checked, including the signed ID Austria token. |
| Every request | One Task that tracks the request from sent to completed and points at the filed results. |
| People and organisations | Practitioner and Organization resources for Dr. Hofer, the outside people, the document authors, and their organisations. |

Every clinical resource points at the Patient through `subject`. [FHIR model](FHIR.md) has the reference diagram and the field mapping.

### 4. How do you notice a misdelivery?

The request service checks at three points.

1. Before sending. If the email domain differs from the domain the eHVD lists for the organisation, Dr. Hofer gets a warning and must confirm. This check flags `labor-kanaI.example` before anything goes out.
2. At login. The ID Austria name must match the requested person. A stranger at a mistyped address (test M1) and a colleague with a forwarded email (test M2) fail here. They see nothing about the patient and cannot answer. The audit log records the failed check, and Dr. Hofer gets a Matrix message.
3. On answer. The patient name and birth date in the document and in the form must match the patient record. A result for another patient (test M3) is not filed, and Dr. Hofer gets a Matrix message.

### 5. Where does your service run: at the clinic, at the outside organisation or at a third party?

At the clinic. Klinikum Beispielstadt already runs its Matrix server and its FHIR server, so the request service runs next to them. Patient data leaves the clinic only toward the person who proved their identity. The outside organisation runs nothing. Its staff need a browser and ID Austria.

A third party, such as the PGK network operator, could later run one shared instance for all members. That saves each clinic the setup. The cost is that the operator then holds patient data from every clinic and needs a processing agreement with each one. For a pilot, we would keep the service at the clinic.

## What is real and what is simulated

| Part | In the demo | In production |
|---|---|---|
| Matrix | Synapse and Element Web, server name `klinikum.example` | The PGK homeserver |
| ID Austria | Keycloak over OpenID Connect, with the claim names of a real ID Austria response, including the eHVD entry for healthcare professionals | The ID Austria reference environment, then production. Both need a registered service provider, which private companies register through Mein USP. |
| eHVD | A mock SOAP service in its own container with the real interface (WSDL version 2 from BRZ) and synthetic entries | The eHVD web service, after registration with the health ministry |
| Email | Mailpit catches every message | The clinic's mail server |
| SMS | A page in the request service shows each SMS | An SMS gateway |
| FHIR server | Local HAPI FHIR | The clinic's FHIR server |

Keycloak does not simulate the phone-app confirmation that real ID Austria uses. We say so in the video.

## How we measure the metrics

| Metric | Target | How we measure |
|---|---|---|
| FHIR validation | 0 errors | `pnpm validate` (`scripts/validate.ts`) exports every resource filed during a run and runs the HL7 validator with `-version 4.0`. It counts issues with severity `error`. |
| Effort for the outside person | 0 installs, 0 accounts, under 2 minutes | Someone new answers request 1 with a stopwatch running from opening the email in Mailpit to pressing send. The audit times from `link_opened` to `answer_sent` back up the stopwatch. We count ID Austria as an existing state ID, not as an account with us. |
| Misdeliveries caught | 3 of 3 | We run M1, M2, and M3 from `track/scenario/misdelivery.md` on request 1. Each must show the outcome that the test names and a `misdelivery_caught` audit entry. |
| Audit coverage | 6 of 6 | `pnpm audit:check` (`scripts/audit-check.ts`) lists the six event types for a request, each with who, what, and when. |

The scripts are planned. [Timeline](TIMELINE.md) has the owners.

## How this answers the judging questions

Clinical approach and impact. A lab physician answers with the report she already produces and her own ID Austria. She needs no new account and no app. Dr. Hofer gets the clotting values as structured Observations that she can trend and reuse, not a scan. A clinic runs one Node.js service and a Postgres database next to the Matrix and FHIR servers it already runs.

Technical quality. Every filed resource passes the HL7 validator. The identity check combines a state ID, a name match, a professional register, and a stored person number, and it costs the outside person about one minute.

Execution. The whole flow runs on both scenario requests. New documents in the same Markdown format go through the same parser. Jury members can create their own outside people on the Keycloak sign-up page.

## Limitations

- ID Austria is simulated. Real use needs a registered service provider and the phone-app step.
- For people without an eHVD entry from ID Austria, the name is the only link between the login and the eHVD, because the eHVD has no birth date. It is not documented whether a private service provider like us would receive the eHVD attribute from ID Austria.
- A second person with the same name and the same role who receives the link would pass the first time. The stored person number closes this gap from the second request on.
- The parser expects the scenario's Markdown format and English dates. Other documents go to Dr. Hofer as held answers.

## Sources

- [Track 2 brief and scenario](https://github.com/AIM-Austria/TRACK-2-interoperability), copied to [`track/`](../track/README.md)
- [ID Austria predefined test identities](https://www.id-austria.gv.at/de/developer/testen/vordefinierte-testidentit%C3%A4ten)
- [USP: registering as an ID Austria service provider](https://www.usp.gv.at/hilfe-und-support/verfahrensrechte/registrierung-als-ida-sp.html)
- [eHVD web service handbook v2.4](https://www.gesundheit.gv.at/dam/gesundheitgvat/professional/it-services/ehvd/eHVD-ServicehandbuchV2.4.pdf)
- [ID Austria: attribute "Gesundheitsdiensteanbieter"](https://www.id-austria.gv.at/de/developer/registrieren/personenmerkmale/Gesundheitsdiensteanbieter)
- [Signicat: ID Austria OIDC attributes](https://developer.signicat.com/identity-methods/id-austria/attributes-reference/id-austria-attributes-oidc/)

[Identity and misdelivery](IDENTITY.md) lists all sources on ID Austria, and [eHVD](EHVD.md) all sources on the eHVD.
