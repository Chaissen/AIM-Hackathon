# Review 19: the filed FHIR data

> **An "unsafe" grade blocks the release** until a fix is merged and reviewed again.

Issue: [#19](https://github.com/Chaissen/AIM-Hackathon/issues/19). Reviewer: Doc 1. Time: about 15 minutes, 2 minutes per answer.

This sheet checks that the stored data says what each document says. For each answer, compare the **Document** column with the **Filed** column, tick one grade, and add your name and the date. A developer has already compared every value. Each row they found wrong or questionable is marked **differs** and explained under it. You do not need to read any JSON.

What to check, from the issue:

- Units and reference ranges match the document.
- `H` (high), `L` (low), and `N` (normal) match the values.
- The rehab report names the right author and sender.
- The Provenance narrative, the short text stored with each answer, says who sent it and how their identity was checked.

Grades:

| Grade | Meaning |
|---|---|
| correct | Everything in the stored data matches the document. |
| acceptable | Small differences that cannot mislead a clinician. Write them under Comments. |
| unsafe | A clinician who reads the stored data could draw a wrong conclusion. This blocks the release. |

## Pre-review summary

Done by a developer on 30 October 2026, not by a clinician. Only Doc 1's grade counts.

| # | Finding | Answers | Effect on the filed data | Pre-review suggests | Issue |
|---|---|---|---|---|---|
| 1 | A one-sided reference range such as `< 5` or `> 45` loses its limit, and the value gets no flag | A3 (CRP), A5 (LDL, HDL) | **CRP 14 mg/L (range below 5) is stored without `H`.** The lab's own comment asks to look for a source of inflammation before the procedure. LDL 128 mg/dL (below 116) has no `H`, and HDL 58 mg/dL (above 45) has no `N`. The range is kept as text only. | A3 unsafe, A5 acceptable or unsafe | [#49](https://github.com/Chaissen/AIM-Hackathon/issues/49) |
| 2 | Dr. Eva Brandl validated the lab results, but the stored data says she wrote them: the narrative says "Written by", and the Provenance stores her in the role "author" | role: A1, A3, A4, A5. Narrative: A4, A5 | The document says "Validated by". The person is right, but the verb and the coded role are not. FHIR's closer role is "verifier". [FHIR model](../FHIR.md#provenance) chose "author" on purpose for the person responsible for the content, so Doc 1 decides (question in each lab answer's grade block). | acceptable | [#50](https://github.com/Chaissen/AIM-Hackathon/issues/50) |
| 3 | The request record (Task) in each upload package has no entry address (`fullUrl`) | all | No clinical effect. The HL7 validator reports 2 technical errors per upload. | — | [#51](https://github.com/Chaissen/AIM-Hackathon/issues/51) |
| 4 | Trailing zeros are dropped: `1.0` is stored as `1`, `2.0 to 4.0` as 2 and 4, `0,50` as 0.5 | A1, A3, A4, A5 | The numbers are the same, but they have fewer decimal places. The range text and the attached document keep the values as written. This is a design decision in [FHIR model](../FHIR.md#the-scenario-values). | acceptable | none, by design |
| 5 | The units `µmol/L` and `mIU/L` are not valid UCUM | A4, A5 | **Fixed by #30.** They are stored as the UCUM codes `umol/L` and `m[IU]/L`, and the unit as written is kept next to the code. | correct | none, closed |

Everything else matched: patient, LOINC codes and their meaning, values, units, two-sided ranges and their flags, sample and report times with the right summer or winter time offset, the lab's comment, the validating physician's name and eHVD record (her role is finding 2), the rehab author, sender, clinic, stay dates and reason, and the attached original text, which is byte-identical to the uploaded file in all seven answers.

## The known parser gaps

[Extra test documents](../../track/scenario/extra/index.md#open-parser-gaps) lists two parser gaps. This is what they do to the filed data today:

| Gap | Status on `main` (0466f90) | Effect on the filed data |
|---|---|---|
| One-sided reference ranges (`< 5`, `< 116`, `> 45`) | **Open** ([#49](https://github.com/Chaissen/AIM-Hackathon/issues/49)) | The range is stored as the text "< 5" with no lower or upper limit, so nothing can compare the value against it, and the value has no `H`, `L`, or `N`. Affects CRP in A3, and LDL and HDL in A5. |
| Units that are not UCUM (`µmol/L`, `mIU/L`, `µg/dL`) | **Closed by #30.** The table in `index.md` and the `todo` markers in `extra.test.ts` still list it. #49 asks to remove them. | None. Uric acid is stored as `umol/L` and TSH as `m[IU]/L`. Before #30 they would have been stored as written, and the validator would have rejected them. `µg/dL` is only in the Maria Anna Beispiel document, which is blocked and never filed. |

## How this package was made

- **Code.** `main` at `0466f90`, which contains the mappers from #30 (PR head `2dc9b74`, the same code). Parser, patient check, mappers, and `buildFilingBundle()`, with no server involved. `pnpm clinical-review:export` writes one upload package (a FHIR transaction Bundle) per answer to [`19-fhir/`](19-fhir/). Run it again after any change to the parser, the mappers, or the filing, and compare.
- **Not yet wired.** The answer flow that collects the people for the filing (T09, [#13](https://github.com/Chaissen/AIM-Hackathon/issues/13)) is not merged. The export follows [FHIR model](../FHIR.md) and [Identity](../IDENTITY.md#who-may-release-a-document) for who goes where, and the T09 draft for the sentence about the release check.
- **Fixed inputs.** Every answer uses the same times: Dr. Hofer sends the request on 29 October 2026 at 09:00, the outside person logs in at 14:01:40 and sends at 14:02, and ordy files at 14:02:12 (Vienna time, `+01:00`). The ID token is the test citizen's, with a placeholder signature. A real filing carries the token that ID Austria signed. Each answer stands alone, as if it were the first answer from that sender and the first mention of its author. On a real server, the answers share people: Dr. Eva Brandl (A1, A3, A4, A5) and Dr. Johanna Leitner (A2, A6, A7) are created once, by their eHVD identifier, and every later answer points at the existing record, whose name the later answer does not change. So the stored record shows the name from the first answer filed. Dr. Brandl's is "Dr. Eva Brandl" in every answer. Dr. Leitner's is "Dr. Johanna Leitner" when A2 or A6 is filed first, as in the demo order, although A7 sends "Prim. Dr. Johanna Leitner". A7's narrative is built from the document, so it still says "Prim. Dr.".
- **Validator.** Not run: Java is not installed on the machine that made the package. The #30 run of HL7 validator 7.0.3 on the same mapper output found 0 errors in the clinical resources, and the 2 Task errors per Bundle from #51. To check: `pnpm validate docs/clinical-review/19-fhir`.
- **LOINC names.** The stored data carries the LOINC code and the document's own label, not LOINC's name, by design ([FHIR model](../FHIR.md#validation)). The LOINC names in the tables below were looked up on tx.fhir.org on 30 October 2026, so you can check that each code means what the document says.

Every answer also stores:

- **Patient:** Maria Beispiel, born 12 March 1961, taken from Dr. Hofer's request, never from the document. The patient check compared the document's name and birth date with her record before anything was filed.
- **Request record (Task):** status completed, requested by Dr. Lena Hofer, assigned to the sender, pointing at the filed report.
- **Identity proof:** the sender's ID Austria token, with the login time, signed by "ID Austria (simulation)".
- **Original:** the uploaded file, unchanged, attached to the report.

---

## A1: Request 1, lab result (clotting tests before the procedure)

File: [`track/scenario/documents/lab-result-maria-beispiel.md`](../../track/scenario/documents/lab-result-maria-beispiel.md) → [`19-fhir/01-request-1-lab-result.bundle.json`](19-fhir/01-request-1-lab-result.bundle.json)

| Item | Document | Filed | Check |
|---|---|---|---|
| Lab | Labor Kanalstraße | Labor Kanalstraße, eHVD OID 1.2.40.0.34.3.1.99.1.2 | match |
| Validated by | Dr. Eva Brandl, lab physician | Dr. Eva Brandl, eHVD OID 1.2.40.0.34.3.2.99.1.2, as the interpreting physician and on each value | match |
| Sample taken | 22 October 2026, 08:10 | 22 October 2026, 08:10 `+02:00` (summer time) | match |
| Reported | 22 October 2026, 11:40 | 22 October 2026, 11:40 `+02:00` | match |
| Comment | All values are within the reference range. | the same text | match |

| Test | LOINC code: LOINC name | Result | Unit as written → stored | Reference range: document → stored | Flag expected → stored | Check |
|---|---|---|---|---|---|---|
| INR (prothrombin time) | 6301-6: INR in platelet poor plasma by coagulation assay | 1.0 → 1 | none → none | 0.8 to 1.2 → 0.8 to 1.2 | N → N | match (1.0 stored as 1) |
| aPTT | 14979-9: aPTT in platelet poor plasma by coagulation assay | 31 → 31 | s → `s` | 25 to 37 → 25 to 37 s | N → N | match |
| Platelets | 777-3: Platelets [#/volume] in blood by automated count | 245 → 245 | 10^9/L → `10*9/L` | 150 to 400 → 150 to 400 | N → N | match |
| Fibrinogen | 3255-7: Fibrinogen [mass/volume] in platelet poor plasma by coagulation assay | 3.1 → 3.1 | g/L → `g/L` | 2.0 to 4.0 → 2 to 4 g/L | N → N | match (2.0 and 4.0 stored as 2 and 4) |

Provenance narrative, as stored:

> Sent by Dr. Eva Brandl on 29 October 2026 at 14:02. Identity checked with ID Austria (simulation), full function, level high. The eHVD confirms Dr. Eva Brandl as responsible for the content at Labor Kanalstraße, found by the eHVD OID in the ID Austria login.

Sender and responsible person are the same, so there is one person: Dr. Eva Brandl, stored in the Provenance role "author", for Labor Kanalstraße. The document says "Validated by" (finding 2, [#50](https://github.com/Chaissen/AIM-Hackathon/issues/50)).

Pre-review: the values have no differences. INR has no unit in the document and none is stored, which is usual for a ratio. Suggests **correct** if Doc 1 accepts the role "author" below, otherwise **acceptable**.

**Question for Doc 1 (role of the validating physician):** the document says "Validated by: Dr. Eva Brandl". The record of who released this answer (the Provenance) stores her in the role "author", the FHIR role for whoever wrote the content. FHIR also has the role "verifier", which is closer to "validated by". Is "author" acceptable here?

- [ ] "author" is acceptable for the validating physician
- [ ] should be "verifier" (or another role, write it under Comments)

**Grade**

- [ ] correct
- [ ] acceptable
- [ ] unsafe

Comments:

Reviewer:

Date:

---

## A2: Request 2, rehab discharge report (hip replacement)

File: [`track/scenario/documents/rehab-report-maria-beispiel.md`](../../track/scenario/documents/rehab-report-maria-beispiel.md) → [`19-fhir/02-request-2-rehab-report.bundle.json`](19-fhir/02-request-2-rehab-report.bundle.json)

| Item | Document | Filed | Check |
|---|---|---|---|
| Kind | Reha Waldblick: discharge report | Discharge summary (LOINC 18842-5), "Rehab discharge report" | match |
| Stay | 2 to 23 September 2026 | 2 September 2026 to 23 September 2026 | match |
| Reason and diagnosis | rehabilitation after a total hip replacement on the left, on 18 August 2026 at Klinikum Beispielstadt | the same text, as the description | match |
| Written by (author) | Dr. Johanna Leitner, medical director, Reha Waldblick | Dr. Johanna Leitner, eHVD OID 1.2.40.0.34.3.2.99.1.3, and Reha Waldblick, eHVD OID 1.2.40.0.34.3.1.99.1.3 | match |
| Sent by | Stefan Kern, discharge management | Stefan Kern, as the sender (informant) for Reha Waldblick. He is not in the eHVD. | match |
| Course, medication, recommendations | in the text | only in the attached original | by design |
| Date of the record | none in the document | 29 October 2026, 14:02:12, the filing time | by design |

Provenance narrative, as stored:

> Sent by Stefan Kern on 29 October 2026 at 14:02. Written by Dr. Johanna Leitner for Reha Waldblick. Identity checked with ID Austria (simulation), full function, level high. The eHVD confirms Dr. Johanna Leitner as responsible for the content at Reha Waldblick, found by name.

Pre-review: no differences. The diagnosis is stored as free text only, with no ICD-10 code, and the medication list stays in the attached text (both by design, see [FHIR model](../FHIR.md#rehab-report-mapping)). Suggests **correct**.

**Grade**

- [ ] correct
- [ ] acceptable
- [ ] unsafe

Comments:

Reviewer:

Date:

---

## A3: Extra, blood count with CRP

File: [`track/scenario/extra/lab-result-maria-beispiel-blood-count.md`](../../track/scenario/extra/lab-result-maria-beispiel-blood-count.md) → [`19-fhir/03-extra-lab-blood-count.bundle.json`](19-fhir/03-extra-lab-blood-count.bundle.json)

| Item | Document | Filed | Check |
|---|---|---|---|
| Lab, validated by | Labor Kanalstraße, Dr. Eva Brandl | the same, with eHVD OIDs | match |
| Sample taken | 26 October 2026, 07:50 | 26 October 2026, 07:50 `+01:00` (winter time, the day after the clock change) | match |
| Reported | 26 October 2026, 10:15 | 26 October 2026, 10:15 `+01:00` | match |
| Comment | Mild anaemia with slightly raised platelets and CRP. Please check for a source of inflammation before the procedure. | the same text | match |

| Test | LOINC code: LOINC name | Result | Unit as written → stored | Reference range: document → stored | Flag expected → stored | Check |
|---|---|---|---|---|---|---|
| Haemoglobin | 718-7: Hemoglobin [mass/volume] in blood | 11.4 → 11.4 | g/dL → `g/dL` | 12.0 to 16.0 → 12 to 16 | L → L | match |
| Leukocytes | 6690-2: Leukocytes [#/volume] in blood by automated count | 7.9 → 7.9 | 10^9/L → `10*9/L` | 4.0 to 10.0 → 4 to 10 | N → N | match |
| Erythrocytes | 789-8: Erythrocytes [#/volume] in blood by automated count | 3.82 → 3.82 | 10^12/L → `10*12/L` | 3.90 to 5.20 → 3.9 to 5.2 | L → L | match |
| Haematocrit | 4544-3: Hematocrit [volume fraction] of blood by automated count | 34.6 → 34.6 | % → `%` | 36.0 to 46.0 → 36 to 46 | L → L | match |
| Platelets | 777-3: Platelets [#/volume] in blood by automated count | 412 → 412 | 10^9/L → `10*9/L` | 150 to 400 → 150 to 400 | H → H | match |
| C-reactive protein | 1988-5: C reactive protein [mass/volume] in serum or plasma | 14 → 14 | mg/L → `mg/L` | < 5 → **text "< 5" only, no upper limit** | H → **no flag** | **differs** ([#49](https://github.com/Chaissen/AIM-Hackathon/issues/49)) |

**CRP:** the value and the range text are stored, but the range has no upper limit, so nothing compares 14 against 5, and the value carries no `H`. A list that highlights abnormal values by their flag shows CRP 14 mg/L as unremarkable. The comment, stored on the report, still says CRP is raised.

Provenance narrative, as stored:

> Sent by Dr. Eva Brandl on 29 October 2026 at 14:02. Identity checked with ID Austria (simulation), full function, level high. The eHVD confirms Dr. Eva Brandl as responsible for the content at Labor Kanalstraße, found by the eHVD OID in the ID Austria login.

Pre-review suggests **unsafe**: an abnormal value that the lab says must be acted on before the procedure is not flagged. Dr. Brandl is stored in the role "author" as in A1 (finding 2).

**Question for Doc 1 (role of the validating physician):** the document says "Validated by: Dr. Eva Brandl". The record of who released this answer (the Provenance) stores her in the role "author", the FHIR role for whoever wrote the content. FHIR also has the role "verifier", which is closer to "validated by". Is "author" acceptable here?

- [ ] "author" is acceptable for the validating physician
- [ ] should be "verifier" (or another role, write it under Comments)

**Grade**

- [ ] correct
- [ ] acceptable
- [ ] unsafe

Comments:

Reviewer:

Date:

---

## A4: Extra, kidney values, sent by a biomedical scientist

File: [`track/scenario/extra/lab-result-maria-beispiel-kidney.md`](../../track/scenario/extra/lab-result-maria-beispiel-kidney.md) → [`19-fhir/04-extra-lab-kidney.bundle.json`](19-fhir/04-extra-lab-kidney.bundle.json)

| Item | Document | Filed | Check |
|---|---|---|---|
| Lab, validated by | Labor Kanalstraße, Dr. Eva Brandl | the same, with eHVD OIDs. Dr. Brandl was found in the eHVD by name. | match |
| Sent by | not in the document. Sophie Lindner-Pichler answered the request. | Sophie Lindner-Pichler, as the sender (informant) for Labor Kanalstraße. She is not in the eHVD. | match |
| Sample taken | 24 October 2026, 09:10 | 24 October 2026, 09:10 `+02:00` (summer time) | match |
| Reported | 26 October 2026, 08:05 | 26 October 2026, 08:05 `+01:00` (winter time) | match |
| Comment | Creatinine is slightly raised and potassium slightly low. Please repeat both in one week. | the same text | match |

| Test | LOINC code: LOINC name | Result | Unit as written → stored | Reference range: document → stored | Flag expected → stored | Check |
|---|---|---|---|---|---|---|
| Creatinine | 2160-0: Creatinine [mass/volume] in serum or plasma | 1,02 → 1.02 | mg/dL → `mg/dL` | 0,50 to 0,90 → 0.5 to 0.9 | H → H | match (decimal comma read correctly) |
| Sodium | 2951-2: Sodium [moles/volume] in serum or plasma | 138 → 138 | mmol/L → `mmol/L` | 135 to 145 → 135 to 145 | N → N | match |
| Potassium | 2823-3: Potassium [moles/volume] in serum or plasma | 3,4 → 3.4 | mmol/L → `mmol/L` | 3,5 to 5,1 → 3.5 to 5.1 | L → L | match |
| Uric acid | 14933-6: Urate [moles/volume] in serum or plasma | 312 → 312 | µmol/L → `umol/L` | 143 to 339 → 143 to 339 | N → N | match (unit gap fixed by #30) |

Provenance narrative, as stored:

> Sent by Sophie Lindner-Pichler on 29 October 2026 at 14:02. Written by Dr. Eva Brandl for Labor Kanalstraße. Identity checked with ID Austria (simulation), full function, level high. The eHVD confirms Dr. Eva Brandl as responsible for the content at Labor Kanalstraße, found by name.

**Narrative differs:** the document says "Validated by: Dr. Eva Brandl", and the narrative says "Written by Dr. Eva Brandl" ([#50](https://github.com/Chaissen/AIM-Hackathon/issues/50)). **Coded role differs too:** the report names her as the interpreting physician and each value names her as the performer, which fits "Validated by". But the Provenance, the record of who released the answer, stores her in the role "author", the FHIR role for whoever wrote the content. FHIR's closer role is "verifier". [FHIR model](../FHIR.md#provenance) chose "author" on purpose, so this is a question for Doc 1, not a bug fixed here ([#50](https://github.com/Chaissen/AIM-Hackathon/issues/50)). Sophie Lindner-Pichler is stored as the sender, which matches.

Pre-review suggests **acceptable**: all values, units, ranges, and flags match. The narrative's verb and the coded role say "wrote" where the document says "validated".

**Question for Doc 1 (role of the validating physician):** the document says "Validated by: Dr. Eva Brandl". The record of who released this answer (the Provenance) stores her in the role "author", the FHIR role for whoever wrote the content. FHIR also has the role "verifier", which is closer to "validated by". Is "author" acceptable here?

- [ ] "author" is acceptable for the validating physician
- [ ] should be "verifier" (or another role, write it under Comments)

**Grade**

- [ ] correct
- [ ] acceptable
- [ ] unsafe

Comments:

Reviewer:

Date:

---

## A5: Extra, metabolic values with one-sided ranges

File: [`track/scenario/extra/lab-result-maria-beispiel-metabolic.md`](../../track/scenario/extra/lab-result-maria-beispiel-metabolic.md) → [`19-fhir/05-extra-lab-metabolic.bundle.json`](19-fhir/05-extra-lab-metabolic.bundle.json)

| Item | Document | Filed | Check |
|---|---|---|---|
| Patient line | BEISPIEL Maria, born 12 March 1961 | Maria Beispiel. The patient check passed although the name is written family name first. | match |
| Lab, validated by | Labor Kanalstraße, Dr. Eva Brandl | the same, with eHVD OIDs. Dr. Brandl was found in the eHVD by name. | match |
| Sent by | not in the document. Sophie Lindner-Pichler answered the request. | Sophie Lindner-Pichler, as the sender (informant) for Labor Kanalstraße | match |
| Sample taken | 27 October 2026, 07:30 | 27 October 2026, 07:30 `+01:00` | match |
| Reported | 27 October 2026, 13:20 | 27 October 2026, 13:20 `+01:00` | match |
| Comment | HbA1c and fasting glucose are in the prediabetic range. Thyroid function is normal. | the same text | match |

| Test | LOINC code: LOINC name | Result | Unit as written → stored | Reference range: document → stored | Flag expected → stored | Check |
|---|---|---|---|---|---|---|
| HbA1c | 4548-4: Hemoglobin A1c/Hemoglobin.total in blood | 6.1 → 6.1 | % → `%` | 4.0 to 5.6 → 4 to 5.6 | H → H | match |
| Glucose, fasting | 1558-6: Fasting glucose [mass/volume] in serum or plasma | 104 → 104 | mg/dL → `mg/dL` | 70 to 99 → 70 to 99 | H → H | match |
| LDL cholesterol | 13457-7: Cholesterol in LDL [mass/volume] in serum or plasma by calculation | 128 → 128 | mg/dL → `mg/dL` | < 116 → **text "< 116" only, no upper limit** | H → **no flag** | **differs** ([#49](https://github.com/Chaissen/AIM-Hackathon/issues/49)) |
| HDL cholesterol | 2085-9: Cholesterol in HDL [mass/volume] in serum or plasma | 58 → 58 | mg/dL → `mg/dL` | > 45 → **text "> 45" only, no lower limit** | N → **no flag** | **differs** ([#49](https://github.com/Chaissen/AIM-Hackathon/issues/49)) |
| TSH | 3016-3: Thyrotropin [units/volume] in serum or plasma | 1.84 → 1.84 | mIU/L → `m[IU]/L` | 0.27 to 4.20 → 0.27 to 4.2 | N → N | match (unit gap fixed by #30) |

LOINC 13457-7 means a calculated LDL. The document does not say whether LDL was calculated or measured. The code is the lab's choice, so it is kept.

Provenance narrative, as stored:

> Sent by Sophie Lindner-Pichler on 29 October 2026 at 14:02. Written by Dr. Eva Brandl for Labor Kanalstraße. Identity checked with ID Austria (simulation), full function, level high. The eHVD confirms Dr. Eva Brandl as responsible for the content at Labor Kanalstraße, found by name.

**Narrative and coded role differ:** "Written by" instead of "Validated by", and the Provenance role "author", as in A4 ([#50](https://github.com/Chaissen/AIM-Hackathon/issues/50)).

Pre-review suggests **acceptable or unsafe**, Doc 1's call. LDL 128 mg/dL is above its target and not flagged. HDL is normal and only lacks its `N`. The comment does not mention LDL.

**Question for Doc 1 (role of the validating physician):** the document says "Validated by: Dr. Eva Brandl". The record of who released this answer (the Provenance) stores her in the role "author", the FHIR role for whoever wrote the content. FHIR also has the role "verifier", which is closer to "validated by". Is "author" acceptable here?

- [ ] "author" is acceptable for the validating physician
- [ ] should be "verifier" (or another role, write it under Comments)

**Grade**

- [ ] correct
- [ ] acceptable
- [ ] unsafe

Comments:

Reviewer:

Date:

---

## A6: Extra, rehab report 2025 (hip osteoarthritis, an older stay)

File: [`track/scenario/extra/rehab-report-maria-beispiel-2025.md`](../../track/scenario/extra/rehab-report-maria-beispiel-2025.md) → [`19-fhir/06-extra-rehab-2025.bundle.json`](19-fhir/06-extra-rehab-2025.bundle.json)

| Item | Document | Filed | Check |
|---|---|---|---|
| Kind | Reha Waldblick: discharge report | Discharge summary (LOINC 18842-5) | match |
| Stay | 13 October to 7 November 2025 | 13 October 2025 to 7 November 2025, dates only, no time zone | match |
| Reason and diagnosis | conservative rehabilitation for osteoarthritis of the left hip | the same text | match |
| Written by (author) | Dr. Johanna Leitner, medical director, Reha Waldblick | Dr. Johanna Leitner and Reha Waldblick, with eHVD OIDs | match |
| Sent by | Stefan Kern, discharge management | Stefan Kern, as the sender (informant) | match |

Provenance narrative, as stored:

> Sent by Stefan Kern on 29 October 2026 at 14:02. Written by Dr. Johanna Leitner for Reha Waldblick. Identity checked with ID Austria (simulation), full function, level high. The eHVD confirms Dr. Johanna Leitner as responsible for the content at Reha Waldblick, found by name.

Pre-review: no differences. This is an old stay, not the latest report, and it is filed with its own stay dates, so it cannot be mistaken for the 2026 stay. Suggests **correct**.

**Grade**

- [ ] correct
- [ ] acceptable
- [ ] unsafe

Comments:

Reviewer:

Date:

---

## A7: Extra, rehab report 2024 (ankle fracture, stay over New Year)

File: [`track/scenario/extra/rehab-report-maria-beispiel-2024.md`](../../track/scenario/extra/rehab-report-maria-beispiel-2024.md) → [`19-fhir/07-extra-rehab-2024.bundle.json`](19-fhir/07-extra-rehab-2024.bundle.json)

| Item | Document | Filed | Check |
|---|---|---|---|
| Kind | Reha Waldblick: discharge report | Discharge summary (LOINC 18842-5) | match |
| Stay | 28 December to 25 January 2024 | 28 December **2023** to 25 January 2024 | match (the start year is taken as the year before) |
| Reason and diagnosis | rehabilitation after a fracture of the right ankle (lateral malleolus), operated with a plate at Klinikum Beispielstadt on 14 December 2023 | the same text | match |
| Written by (author) | Prim. Dr. Johanna Leitner, medical director, Reha Waldblick | Prim. Dr. Johanna Leitner and Reha Waldblick, with eHVD OIDs. Found in the eHVD by name despite the title "Prim." | match in this package. On a server where A2 or A6 was filed first, her stored record reads "Dr. Johanna Leitner" (see [How this package was made](#how-this-package-was-made)). |
| Sent by | Karl Heinz Moser-Wallner, discharge management | Karl Heinz Moser-Wallner, as the sender (informant). He is not in the eHVD. | match |
| "Pain at discharge: 2 of 10" | a line in the course text | only in the attached original | by design |

Provenance narrative, as stored:

> Sent by Karl Heinz Moser-Wallner on 29 October 2026 at 14:02. Written by Prim. Dr. Johanna Leitner for Reha Waldblick. Identity checked with ID Austria (simulation), full function, level high. The eHVD confirms Prim. Dr. Johanna Leitner as responsible for the content at Reha Waldblick, found by name.

Pre-review: no differences in this package. On a shared server, the stored record of Dr. Leitner keeps the titles of the first answer filed, usually "Dr.", while A7's narrative says "Prim. Dr.". Same person, same eHVD identifier. Suggests **correct**.

**Grade**

- [ ] correct
- [ ] acceptable
- [ ] unsafe

Comments:

Reviewer:

Date:

---

## Blocked documents: nothing filed

These three documents are about someone else. The patient check stops them, and nothing reaches the FHIR server, so there is no data to grade. The export confirms that each one fails the patient check.

| Document | Patient in the document | Why it is blocked |
|---|---|---|
| [`lab-result-maria-anna-beispiel.md`](../../track/scenario/extra/lab-result-maria-anna-beispiel.md) | Maria Anna Beispiel, born 21 November 1987 | Extra given name and another birth date |
| [`rehab-report-maria-beispiel-namesake.md`](../../track/scenario/extra/rehab-report-maria-beispiel-namesake.md) | Maria Beispiel, born 3 December 1961 | Same name, another birth date (day and month swapped) |
| [`microbiology-report-johann-maria-gruber.md`](../../track/scenario/extra/microbiology-report-johann-maria-gruber.md) | Johann Maria Gruber, born 12 March 1961 | Same birth date, another family name |

Max Beispiel's lab result (`documents/lab-result-max-beispiel.md`) is test M3 and is blocked the same way.

## Sign-off

When all seven answers are graded: if none is unsafe, Doc 1 comments "graded, no unsafe answer" on [#19](https://github.com/Chaissen/AIM-Hackathon/issues/19), and the issue can be closed. If any answer is unsafe, the release waits for the linked fix. Then a developer runs `pnpm clinical-review:export` again, and Doc 1 grades that answer again in this file.
