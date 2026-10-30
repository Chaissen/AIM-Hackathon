# FHIR model

This page lists the FHIR R4 resources the request service files, how they reference each other, and how we validate them.

## Resources we file

| Resource | When | Purpose |
|---|---|---|
| [Patient](https://hl7.org/fhir/R4/patient.html) | Once, from `track/scenario/patient.json` | Maria Beispiel. Every clinical resource points at her through `subject`. |
| [Task](https://hl7.org/fhir/R4/task.html) | Each request | Tracks the request from sent to filed and points at the filed results |
| [Practitioner](https://hl7.org/fhir/R4/practitioner.html) | First contact with a person | Dr. Hofer, the outside people, and the document authors |
| [Organization](https://hl7.org/fhir/R4/organization.html) | First contact with an organisation | Klinikum Beispielstadt, Labor Kanalstraße, Reha Waldblick, and "ID Austria (simulation)", which signs the identity proof |
| [Observation](https://hl7.org/fhir/R4/observation.html) | Lab result, one per table row | One test value with its LOINC code, unit, and reference range |
| [DiagnosticReport](https://hl7.org/fhir/R4/diagnosticreport.html) | Lab result | Groups the Observations and carries the original document |
| [DocumentReference](https://hl7.org/fhir/R4/documentreference.html) | Rehab report | The report text, attached, with the stay period and the author |
| [Provenance](https://hl7.org/fhir/R4/provenance.html) | Each filed answer | Who sent it, when, and how the identity was checked |

We file all resources of one answer in one [transaction Bundle](https://hl7.org/fhir/R4/http.html#transaction), so an answer is filed completely or not at all.

## How the resources reference each other

```
Lab result

  Task --for--> Patient
   |  requester --> Practitioner (Dr. Hofer)
   |  owner ------> Practitioner (Dr. Brandl)
   |  output -----> DiagnosticReport
   |
  DiagnosticReport --subject--> Patient
   |  result -----------> Observation x4 --subject--> Patient
   |  performer --------> Organization (Labor Kanalstraße)
   |  resultsInterpreter -> Practitioner (Dr. Brandl)
   |
  Provenance
      target ------> DiagnosticReport and each Observation
      agent author -> Practitioner (Dr. Brandl), onBehalfOf Organization (Labor Kanalstraße)
      signature ---> ID token from ID Austria, signed by Organization (ID Austria simulation)

Rehab report

  Task --for--> Patient, output --> DocumentReference

  DocumentReference --subject--> Patient
      author -> Practitioner (Dr. Leitner), Organization (Reha Waldblick)

  Provenance
      target -----------> DocumentReference
      agent author -----> Practitioner (Dr. Leitner), onBehalfOf Organization (Reha Waldblick)
      agent informant --> Practitioner (Stefan Kern), who sent it
      signature --------> ID token of Stefan Kern
```

The report and the people who handle it are different. Dr. Leitner wrote the rehab report, and Stefan Kern sent it. The DocumentReference names the author, and the Provenance names both.

## Lab result mapping

| Document | FHIR |
|---|---|
| `Patient: Maria Beispiel, born 12 March 1961` | Patient check only. `subject` is `Patient/maria-beispiel`. |
| `Sample taken: 22 October 2026, 08:10` | `effectiveDateTime` on each Observation and on the DiagnosticReport: `2026-10-22T08:10:00+02:00` |
| `Reported: 22 October 2026, 11:40` | `issued` on each Observation and on the DiagnosticReport: `2026-10-22T11:40:00+02:00` |
| Table column `Test` | `Observation.code.text` |
| Table column `LOINC code` | `Observation.code.coding`, system `http://loinc.org`, without `display` |
| Table column `Result` | `Observation.valueQuantity.value` |
| Table column `Unit` | `Observation.valueQuantity` `unit`, `system` `http://unitsofmeasure.org`, and `code` in UCUM |
| Table column `Reference range` | `Observation.referenceRange` `low`, `high`, and `text` |
| Computed from value and range | `Observation.interpretation`: `N`, `H`, or `L` from `http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation` |
| Free text such as `All values are within the reference range.` | `DiagnosticReport.conclusion` |
| `Validated by: Dr. Eva Brandl, lab physician` | `DiagnosticReport.resultsInterpreter` and `Observation.performer`, both the Practitioner |
| Heading `# Labor Kanalstraße: lab report` | `DiagnosticReport.performer`, the Organization |
| The whole file | `DiagnosticReport.presentedForm`, `contentType` `text/markdown`, data in base64 |

The DiagnosticReport has `status` `final`, `category` `LAB` from `http://terminology.hl7.org/CodeSystem/v2-0074`, and `code` LOINC `11502-2` (Laboratory report) with the document title in `code.text`. Each Observation has `status` `final` and `category` `laboratory` from `http://terminology.hl7.org/CodeSystem/observation-category`.

### The scenario values

| Test | LOINC | LOINC display, checked on tx.fhir.org | Value | UCUM unit | Range |
|---|---|---|---|---|---|
| INR (prothrombin time) | 6301-6 | INR in Platelet poor plasma by Coagulation assay | 1.0 | none | 0.8 to 1.2 |
| aPTT | 14979-9 | aPTT in Platelet poor plasma by Coagulation assay | 31 | `s` | 25 to 37 |
| Platelets | 777-3 | Platelets [#/volume] in Blood by Automated count | 245 | `10*9/L` | 150 to 400 |
| Fibrinogen | 3255-7 | Fibrinogen [Mass/volume] in Platelet poor plasma by Coagulation assay | 3.1 | `g/L` | 2.0 to 4.0 |

The document writes the platelet unit as `10^9/L`, which is not valid UCUM. The parser replaces `^` with `*`, so the mapper gets `10*9/L`. INR has no unit, so its `valueQuantity` and its range carry only values.

For Max Beispiel's result, INR 2.6 and aPTT 44 are above the range and get `H`. That result is never filed for Maria, because the patient check stops it first.

### Example Observation

```json
{
	"resourceType": "Observation",
	"status": "final",
	"category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory"}]}],
	"code": {"coding": [{"system": "http://loinc.org", "code": "14979-9"}], "text": "aPTT"},
	"subject": {"reference": "Patient/maria-beispiel"},
	"effectiveDateTime": "2026-10-22T08:10:00+02:00",
	"issued": "2026-10-22T11:40:00+02:00",
	"performer": [{"reference": "urn:uuid:practitioner-eva-brandl"}],
	"valueQuantity": {"value": 31, "unit": "s", "system": "http://unitsofmeasure.org", "code": "s"},
	"interpretation": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", "code": "N"}]}],
	"referenceRange": [{
		"low": {"value": 25, "unit": "s", "system": "http://unitsofmeasure.org", "code": "s"},
		"high": {"value": 37, "unit": "s", "system": "http://unitsofmeasure.org", "code": "s"},
		"text": "25 to 37"
	}]
}
```

The `urn:uuid:` references point at other entries of the transaction Bundle, and HAPI replaces them with server ids. The values in the examples are shortened for reading. Real ones are UUIDs.

## Rehab report mapping

| Document | FHIR |
|---|---|
| Heading `# Reha Waldblick: discharge report` | `DocumentReference.type`, LOINC `18842-5` (Discharge summary), with `text` "Rehab discharge report" |
| `Patient: Maria Beispiel, born 12 March 1961` | Patient check only. `subject` is `Patient/maria-beispiel`. |
| `Stay: 2 to 23 September 2026` | `DocumentReference.context.period`, `start` `2026-09-02`, `end` `2026-09-23` |
| `Reason: rehabilitation after a total hip replacement...` | `DocumentReference.description` |
| `Written by: Dr. Johanna Leitner, medical director, Reha Waldblick` | `DocumentReference.author`, the Practitioner and the Organization. Provenance agent `author`. |
| `Sent by: Stefan Kern, discharge management` | Provenance agent `informant` |
| The whole file | `DocumentReference.content.attachment`, `contentType` `text/markdown`, data in base64, `title` from the heading |

The DocumentReference has `status` `current`, `docStatus` `final`, and `date` set to the filing time.

The `Stay` line can name the month once ("2 to 23 September 2026") or twice ("28 August to 12 September 2026"). The parser splits at `" to "` and borrows the month and year from the right side when the left side lacks them.

The medication list stays inside the attached text. One MedicationStatement per line is a stretch goal and the first thing to cut.

## Filing an answer

The filing (T13) lives in `src/server/fhir/`. `filing.ts` is pure and builds the Bundle, and `file-answer.ts` sends it and writes the audit entry.

1. `prepareParties(parties, { requestId, uploadSha256 })` builds the Practitioner and Organization entries: Dr. Hofer, the sender, the author when it is someone else, the outside organisation, and the identity provider. It returns their `urn:uuid:` references as FHIR `Reference`s, which the mapper takes as they are. `uploadSha256` is `uploadHash()` of the uploaded file and names the answer.
2. The mapper (T12, T14) builds the clinical resources with those references.
3. `buildFilingBundle()` adds the Provenance and the completed Task and returns the Bundle with the references the audit entry needs.
4. `fileAnswer()` POSTs the Bundle to the server base, reads the server ids from the `transaction-response`, and writes `answer_filed`.

Order of the entries: Practitioners, Organizations, the DiagnosticReport or DocumentReference, the Observations, the Provenance, the Task.

### Retries

Every POST in the Bundle is a conditional create (`ifNoneExist`), so the same answer is filed at most once:

| Entry | Condition |
|---|---|
| Practitioner, Organization with an eHVD entry | `identifier=urn:ietf:rfc:3986\|urn:oid:<OID>`. Every answer from that person or organisation reuses it. |
| Practitioner, Organization without an eHVD entry | `identifier=urn:aim-t2:answer\|<request id>:<upload SHA-256>:<part>`, part `sender`, `author`, or `organization`. Only a retry of the same answer reuses it. |
| "ID Austria (simulation)" | `identifier=urn:ietf:rfc:3986\|<issuer URL>` |
| DiagnosticReport or DocumentReference | `identifier=urn:aim-t2:answer\|<request id>:<upload SHA-256>:output` |
| Each Observation | the same with `result-1`, `result-2`, … in table order |
| Provenance | `target=<urn:uuid of the output>`. R4 Provenance has no `identifier`. HAPI resolves the `urn:uuid:` in the condition to the output's server id, so the condition finds the Provenance of the same answer. Tested on HAPI FHIR 8.12.0 (`hapiproject/hapi:latest`, image of 2 October 2026). Another FHIR server or HAPI version must do the same, or the Provenance needs another key. |
| Task | `PUT Task/ordy-request-<request id>`, idempotent anyway |

When `fileAnswer()` throws, the answer may or may not be on the server. HAPI may have rejected the transaction (a `FhirError` with its status, nothing filed), or it may have committed while the response was lost (the 15-second timeout, the network) or the audit insert failed afterwards. Either way nothing is audited. The retry files nothing new, gets back the ids of what the first attempt filed, and writes `answer_filed`, under these rules:

- **Retry the stored `Filing`.** The caller keeps the `Filing` that `buildFilingBundle()` returned, which is plain JSON and can be stored in Postgres, and passes exactly it to `fileAnswer()` again. A Bundle built anew is only safe from the same stored inputs: eHVD OIDs, the `practitionerId` from `bindings`, the parsed rows, and `acceptedByRequester`. Never retry with a fresh eHVD lookup or a fresh parse. If attempt 1 had no OID for the organisation and the retry has one, the retry creates a second Organization while the DiagnosticReport and the Provenance match the old ones. If a new parse, such as the AI fallback, reads one row more, `result-5` becomes an Observation nothing references.
- **One answer at a time (T04, T09).** While a kept answer's filing outcome is unknown, the request accepts no new upload. Another upload has another hash and is another answer, so it would be filed next to the first: two DiagnosticReports and two Provenances for one request. Only after the kept answer is filed, or HAPI rejected it with a `FhirError`, may the request take a new upload.
- **Reset both stores together.** The answer key and the Task id `ordy-request-<id>` use the Postgres request id. If Postgres is emptied without HAPI, for example by dropping its volume, request 1 with the same scenario file gets the same key and silently matches the old run's resources, including the old Provenance with the old ID token, and the old Task. Empty both with `pnpm reset`.

## Provenance

| Field | Value |
|---|---|
| `target` | Every clinical resource filed for this answer |
| `occurredDateTime` | When the outside person pressed send |
| `recorded` | When the request service filed the answer |
| `policy` | The identity policy of the document type: `urn:aim-t2:identity-policy:lab-result:v1` or `urn:aim-t2:identity-policy:rehab-report:v1`. When Dr. Hofer accepted a held answer, also `urn:aim-t2:identity-policy:accepted-by-requester:v1`. |
| `agent` | `author` for the document author. `informant` for the sender when the sender is someone else. `onBehalfOf` for the organisation. |
| `signature` | Type `1.2.840.10065.1.12.1.10` (Identity Witness Signature) from `urn:iso-astm:E1762-95:2013`. `when` is the login time, from the ID token's `auth_time`, or `iat` when it has none. `who` is the Organization "ID Austria (simulation)", `sigFormat` is `application/jose`, and `data` holds the ID token in base64. |
| `text` | A short narrative for people who open the resource: who sent it and when, who wrote it when that is someone else, the ID Austria levels from the token, whether Dr. Hofer accepted a held answer, and any sentences the caller adds, such as the release check result |

The ID token is the proof of the identity check. Anyone can verify its signature later with the identity provider's public key. It contains the sender's name, birth date, and person number. [Compliance and safety](COMPLIANCE_AND_SAFETY.md) covers that trade-off.

```json
{
	"resourceType": "Provenance",
	"text": {
		"status": "generated",
		"div": "<div xmlns=\"http://www.w3.org/1999/xhtml\">Sent by Dr. Eva Brandl on 29 October 2026 at 14:02. Identity checked with ID Austria (simulation), full function, level high. The name matched the request. eHVD lists her as an active lab physician at Labor Kanalstraße.</div>"
	},
	"target": [
		{"reference": "urn:uuid:diagnostic-report"},
		{"reference": "urn:uuid:observation-inr"},
		{"reference": "urn:uuid:observation-aptt"},
		{"reference": "urn:uuid:observation-platelets"},
		{"reference": "urn:uuid:observation-fibrinogen"}
	],
	"occurredDateTime": "2026-10-29T14:02:10+01:00",
	"recorded": "2026-10-29T14:02:12+01:00",
	"policy": ["urn:aim-t2:identity-policy:lab-result:v1"],
	"agent": [{
		"type": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/provenance-participant-type", "code": "author"}]},
		"who": {"reference": "urn:uuid:practitioner-eva-brandl"},
		"onBehalfOf": {"reference": "urn:uuid:organization-labor-kanalstrasse"}
	}],
	"signature": [{
		"type": [{"system": "urn:iso-astm:E1762-95:2013", "code": "1.2.840.10065.1.12.1.10"}],
		"when": "2026-10-29T14:01:40+01:00",
		"who": {"reference": "urn:uuid:organization-id-austria-simulation"},
		"sigFormat": "application/jose",
		"data": "ZXlKaGJHY2lPaUpTVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5Li4u"
	}]
}
```


## Task

| Field | Value |
|---|---|
| `status` | Mirrors the request state. [Architecture](ARCHITECTURE.md) has the table. |
| `businessStatus.text` | Details such as "waiting for a new upload after a patient mismatch" |
| `intent` | `order` |
| `description` | "Request for a lab result" or "Request for a rehab discharge report" |
| `for` | The Patient |
| `authoredOn` | When Dr. Hofer sent the request |
| `requester` | Dr. Hofer's Practitioner |
| `owner` | The outside person's Practitioner |
| `restriction.period.end` | The link expiry |
| `output` | The DiagnosticReport or the DocumentReference, once filed, with `type.text` "Lab result" or "Rehab discharge report" |

The Task id is `ordy-request-<request id>`, and every write is a `PUT`, so the same Task follows the request from sent to filed. The filing Bundle PUTs it with status `completed` and the output. Its status comes from `taskStatus()` in `src/server/requests/lifecycle.ts`, the table in [Architecture](ARCHITECTURE.md#request-lifecycle). For the other state changes, `syncTask()` in `src/server/fhir/file-answer.ts` PUTs it; until the outside person has a Practitioner, `owner` is a reference with only `display`. Wiring `syncTask()` into the state changes belongs to the request core (T04).

The Task stays on the clinic's FHIR server. It is the only place outside the request service database where the request appears with its document type.

## Practitioner and Organization

- A Practitioner holds the name from the request, confirmed by ID Austria. When the eHVD lists the person, the Practitioner gets the eHVD OID as `identifier`, with `system` `urn:ietf:rfc:3986` and `value` `urn:oid:1.2.40.0.34.3.2.99.1.2` for Dr. Brandl. [eHVD](EHVD.md#directory-content) lists all OIDs.
- We do not store the outside person's birth date in the Practitioner.
- An Organization holds the name and the eHVD OID, for example `urn:oid:1.2.40.0.34.3.1.99.1.2` for Labor Kanalstraße.
- The transaction uses conditional create with `ifNoneExist` on the identifier, for example `identifier=urn:ietf:rfc:3986|urn:oid:1.2.40.0.34.3.2.99.1.2`, so a second answer from Dr. Brandl reuses her Practitioner.
- For people without an eHVD entry, such as Stefan Kern, the `bindings` table remembers the Practitioner id. The filing then references `Practitioner/<id>` and creates nothing. Without a binding, it creates a new Practitioner whose only identifier names the answer (see [Retries](#retries)), and `answer_filed` names its id in `sender` so the binding can store it.
- An organisation without an eHVD entry gets a new Organization whose only identifier names the answer. We do not match organisations by name.
- The Organization "ID Austria (simulation)" has the issuer URL from the ID token as identifier, `http://localhost:8080/realms/idaustria-sim` in the demo, and is created once the same way. Real ID Austria has its own issuer, so it becomes a separate Organization.

## Patient

The request service puts `track/scenario/patient.json` on the server with `PUT Patient/maria-beispiel`. On the public test server `https://hapi.fhir.org/baseR4`, use an id with a team prefix, such as `aim-t2-<team>-maria-beispiel`, so the data does not mix with other teams' data. We prefer a local HAPI server.

## Validation

1. After a run, `pnpm validate` (`scripts/validate.ts`) reads the ids of the filed resources from the `answer_filed` audit entries, all of them or with `--since <time>` those of one run. `detail.resources` lists every resource in the transaction, the Task included. A Practitioner known from `bindings` is only referenced, not part of the transaction, so it appears in `sender` or `author` but not in `resources`. `detail` also names `output`, `targets`, `provenance`, `task`, `sender`, `author`, and `organization`.
2. It fetches each resource from HAPI into `out/filed/`.
3. It runs the validator on all files at once, as the scenario README says: `java -jar validator_cli.jar <files> -version 4.0`, with `-locale en-US` so the messages are in English.
4. It counts the issues with severity `error` or `fatal`. The target is 0. Warnings do not count. Every file must have a result. It prints each error, writes the raw validator result to `out/metrics/validator-output.json` and the counts to `out/metrics/validate.json`, and exits with 1 on any error or missing result, or with a short message when the validator cannot run (no Java, a jar with another hash).

`pnpm validate path/to/file.json path/to/folder` validates hand-made resources instead, without Postgres or HAPI. `pnpm scenario` runs the same check on the resources filed during its run.

The validator needs Java 17 or newer. `pnpm validate` downloads the pinned version 7.0.3 to `tools/validator_cli.jar` if it is missing and checks its SHA-256 before every run ([Development](DEVELOPMENT.md#hl7-validator)). The first run downloads the FHIR packages to `~/.fhir` and takes a few minutes; later runs take under a minute. The validator checks LOINC codes against tx.fhir.org, so it needs internet access.

Traps we know about:

- `10^9/L` is not valid UCUM. Use `10*9/L`.
- A `dateTime` with a time needs a time zone. `Europe/Vienna` is `+02:00` until 25 October 2026 and `+01:00` after that. The sample times are `+02:00`, and the filing times are `+01:00`.
- An `instant`, such as `issued` and `recorded`, needs seconds and a time zone.
- A Quantity with a `code` needs a `system` (invariant `qty-3`).
- The validator reports a `display` that differs from LOINC's. We leave `display` out and put the document's label into `code.text`, because jury documents may carry codes we have not looked up.
- A resource without narrative gets a warning (`dom-6`), not an error. Only the Provenance gets a narrative.

## Sources

- [FHIR R4 data types](https://hl7.org/fhir/R4/datatypes.html)
- [FHIR R4 RESTful API and transactions](https://hl7.org/fhir/R4/http.html)
- [FHIR R4 signature types](https://hl7.org/fhir/R4/valueset-signature-type.html)
- [UCUM](https://ucum.org/)
- [HL7 validator releases](https://github.com/hapifhir/org.hl7.fhir.core/releases)
- [HAPI FHIR public test server](https://hapi.fhir.org/baseR4/metadata)
- [Track 2 scenario](https://github.com/AIM-Austria/TRACK-2-interoperability)
