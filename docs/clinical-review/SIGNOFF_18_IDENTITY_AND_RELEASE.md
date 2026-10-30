# Clinical sign-off for issue #18: identity rules and release check

Issue: [#18](https://github.com/Chaissen/AIM-Hackathon/issues/18). Prepared on 30 October 2026, before any clinician reviewed it. The sources were checked again on the same day after a review of the pull request. It takes about 15 minutes.

## What to review

ordy lets Dr. Hofer request a document from someone outside the PGK network, such as Dr. Eva Brandl at Labor Kanalstraße. Before ordy files an answer in the patient's record, it checks two people:

- **The sender.** The person who logs in must be the person Dr. Hofer asked for. If not, nothing is shown and nothing is stored. This is not part of this review.
- **The person responsible for the content.** This is the physician named under "Validated by" in a lab result or "Written by" in a discharge report. ordy looks that physician up in the Austrian eHealth directory (eHVD) and checks the specialty, whether they may currently practise, and whether they work at the lab or clinic that sent the document. We call this the release check.

Three questions are open. For each one you find the rule as it stands, our recommended answer, the reasons and sources, and an answer box.

## How to answer

Tick one box per question and add your name and the date. If you want a change, write the rule you want in plain words. You do not need to read the sources unless you doubt the recommendation. Commit the file, or hand it to a developer. [README](README.md) explains the folder.

This is a hackathon prototype on synthetic data, and the legal reading is ours, not legal advice.

---

## Question 1: Who may release a clotting panel?

### The rule as it stands

ordy files a lab result without asking Dr. Hofer only if the eHVD lists the physician under "Validated by" as an active specialist in **medical and chemical laboratory diagnostics** ("Medizinische und Chemische Labordiagnostik") at the lab that sent it.

If the physician has another specialty, for example internal medicine with haematology or transfusion medicine, ordy does **not** reject the result. It holds it, tells Dr. Hofer why, and she accepts or rejects it.

So the question is not "who may release" in the legal sense. It is "for which specialties may ordy file a lab result without asking Dr. Hofer".

### Recommended answer: keep, with clearer wording

Keep the laboratory specialist as the only specialty that ordy confirms on its own. Every other specialty goes to Dr. Hofer.

We have already changed the wording in the docs so that it no longer says "only a laboratory specialist may release". It now says that ordy confirms only the laboratory specialist on its own, and that a haematologist's clotting panel is held for Dr. Hofer. The rule in the software is the same as before.

### Reasons

- A specialist must limit their work to their specialty (§ 31 Abs 3 ÄrzteG 1998). The ÄAO 2015, a regulation of the health ministry, defines what each specialty covers. Its annexes were replaced on 1 August 2026. The medical chamber's KEF und RZ-V 2015 lists the training content of each specialty.
- **Medical and chemical laboratory diagnostics** is defined as applying lab methods to body fluids and assessing the results, including function tests and expert reports. Its training content names medical validation ("Medizinische Validation/medizinische Vidierung"), writing lab reports by medical validation ("Erstellung von Laborbefunden durch ärztliche Vidierung"), and basic and special coagulation tests including anticoagulant therapy. A clotting panel is clearly inside this specialty.
- **Internal medicine with haematology and internal oncology** is defined to include diseases of blood clotting. Its training content names the diagnosis and treatment of clotting disorders and thromboses, "fachspezifische Laboruntersuchungen", and the interpretation of lab medicine. A haematologist may well be responsible for a clotting panel, for example in a hospital coagulation clinic.
- **Transfusion medicine** is its own specialty. Its training content names basic and special coagulation tests ("Globalgerinnungstests und speziellen Gerinnungsuntersuchungen"), the diagnosis and treatment of clotting disorders, and antithrombotic therapy, all as knowledge in the basic training. A transfusion medicine specialist may be responsible for a clotting panel too.
- For haematology and transfusion medicine, the training content does not name the medical validation of lab reports for other physicians, so we could not settle from the sources whether they may release one.
- For a report from an outside lab such as Labor Kanalstraße, the laboratory specialist is the usual signer. The hold already covers the other cases safely: nothing is lost, Dr. Hofer only decides.
- Adding more specialties would need a list of which tests each specialty may release. That list is a clinical decision, not a technical one.

### Risk if we are wrong

- **Too narrow** (haematologists or transfusion medicine specialists should pass on their own): a correct clotting panel signed by one of them waits until Dr. Hofer accepts it. Low risk: one click and a short delay.
- **Too wide** (if we added specialties without a clinical list): a result signed outside the physician's specialty is filed without anyone looking. Medium risk.

### Confidence

High that the laboratory specialist is the right specialty to confirm on its own. Medium on whether other specialties may legally release a clotting panel.

### Sources

- [Ärztegesetz 1998, § 31 Abs 3](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10011138&Paragraf=31), RIS, version of 30 October 2026
- [ÄAO 2015](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20009186), RIS, version of 30 October 2026, for the definition of each specialty ("A. Definition des Aufgabengebiets"): Anlage 19 (Medizinische und Chemische Labordiagnostik), Anlage 12, 5. Abschnitt (Innere Medizin und Hämatologie und internistische Onkologie), and Anlage 31 (Transfusionsmedizin). The list of specialties is in § 15 Abs 1, Transfusionsmedizin as Z 30. The annexes in the version of BGBl. II Nr. 224/2026 apply from 1 August 2026 (§ 39 Abs 14).
- Medical chamber, [KEF und RZ-V 2015](https://www.aerztekammer.at/documents/261766/417698/KEF_RZ_VO_2015%20konsolidierte%20Fassung/a999fc10-7fad-ed7e-9aee-b58c87d31eb4), consolidated version including the 7th amendment of 19 June 2026, for the training content:
  - Anlage 19, Medizinische und Chemische Labordiagnostik: basic training, skills C 7, C 9, and C 16, and module 1 "Blutdepotleitung/Blutgruppenserologie/Hämatologie/Hämostaseologie"
  - Anlage 12.5, Innere Medizin und Hämatologie und internistische Onkologie: focus training A 7, B 1, and C 1
  - Anlage 31, Transfusionsmedizin: basic training, knowledge A 17 to A 19
- [Specialty codes in the eHVD (OEAEK_Fachrichtung)](https://termgit.elga.gv.at/CodeSystem-oeaek-fachrichtung.html): laboratory diagnostics (19), internal medicine with haematology and internal oncology (782), transfusion medicine (41), and clinical microbiology (23 and 482) each have their own code, so a wider rule could be built if you want one

### Your answer

- [ ] Confirm as written: only the laboratory specialist is confirmed by ordy on its own, every other specialty is held for Dr. Hofer.
- [ ] Change to: ______________________________________________
      (for example: "also confirm internal medicine with haematology for clotting panels", "also confirm transfusion medicine for clotting panels", or "also confirm clinical microbiology for microbiology reports")

In your practice, who signs a clotting panel that comes from outside the hospital? ______________________________

Reviewer: ____________________  Date: ____________

---

## Question 2: Hold or block when the eHVD cannot confirm the responsible physician?

### The rule as it stands

When the sender is the right person but the eHVD does not confirm the physician responsible for the content, ordy **holds** the answer. Reasons can be: not listed, listed as not active, another specialty, not a member of the lab or clinic, several physicians with the same name, or the eHVD cannot be reached.

On hold, nothing is filed. Dr. Hofer gets a message in her Matrix room with the reason, and she accepts or rejects the answer. If she accepts, the record notes that she accepted it and when.

A wrong sender is always **blocked**. That does not change.

### Recommended answer: keep the hold, and decide on "not active"

Keep the hold for all reasons. Please decide one detail: when the eHVD lists the physician as **not active**, should ordy still hold, hold with a stronger warning, or block?

We lean towards a hold with a stronger warning, such as "The eHVD lists Dr. X as not currently allowed to practise. Call the lab before you accept." We have not changed this. It waits for your answer.

### Reasons

- At this point the sender has passed the identity checks. The answer comes from the person Dr. Hofer asked for, and the patient is the one she asked about. Holding the answer shows nothing to anyone new.
- § 49 Abs 1 ÄrzteG 1998 obliges every physician to care for patients according to medical science and experience ("nach Maßgabe der ärztlichen Wissenschaft und Erfahrung"). It does not mention results. We read it to mean that Dr. Hofer must judge any result before she uses it. Then the hold asks her to do what her duty of care already asks: look at the result and its source before she uses it.
- The eHVD can be out of date or incomplete, for example after a change of lab, and another specialty may be responsible for some tests (see question 1). A block would reject correct results that are needed for a procedure.
- A block pushes the lab back to fax, phone, or plain email. Those channels have no identity check at all, which is the problem ordy is meant to solve.
- "Not active" is different. The eHVD takes physicians directly from the medical chamber's list of physicians (§ 9 Abs 3 GTelG 2012), so "not active" is rarely just out of date. It may mean that the physician is not allowed to practise at the moment. That is why we ask you about it.

### Risk if we are wrong

- **Hold, but it should block:** Dr. Hofer gets used to clicking Accept, and a result from a physician who may not practise enters the record. The record still shows that she accepted it without eHVD confirmation. Medium risk, lower with a stronger warning.
- **Block, but it should hold:** a correct result for a planned procedure does not arrive, and the lab falls back to fax or phone. Medium risk for the patient's care.

### Confidence

Medium to high that the hold is right in general. Medium for the "not active" case.

### Sources

- [Ärztegesetz 1998, § 49](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10011138&Paragraf=49), RIS, version of 30 October 2026
- [Gesundheitstelematikgesetz 2012, § 9](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20008120&Paragraf=9): the eHVD gets its entries from official registers, including the list of physicians under § 27 ÄrzteG
- [eHVD web service handbook v2.4](https://www.gesundheit.gv.at/dam/gesundheitgvat/professional/it-services/ehvd/eHVD-ServicehandbuchV2.4.pdf): status "Aktiv" or "Inaktiv"

### Your answer

- [ ] Confirm as written: hold for every reason, Dr. Hofer decides.
- [ ] Confirm the hold, and for "not active" use:
      - [ ] a hold with a stronger warning
      - [ ] a block: the answer is rejected and the lab is asked to send it again, signed by an active physician
- [ ] Change to: ______________________________________________

Should a result that Dr. Hofer accepted without eHVD confirmation be marked as such where clinicians read it, not only in the audit record?

- [ ] Yes   - [ ] No   - [ ] No opinion

Reviewer: ____________________  Date: ____________

---

## Question 3: Is our reading of the legal basis plausible?

### The rule as it stands

The docs base the release check on these laws. We checked each paragraph against the current text in the federal legal information system (RIS) on 30 October 2026.

| Law | What we take from it | Check |
|---|---|---|
| Ärztegesetz 1998, § 2 Abs 2 Z 1 and 2 | Medical practice includes examining people for illness and assessing the results with diagnostic aids. | Confirmed. We **added § 3 Abs 4**, which forbids anyone but a physician to practise medicine. § 2 alone only describes the work. |
| Ärztegesetz 1998, § 31 Abs 3 | A specialist limits their work to their specialty. | Confirmed. The exceptions (occupational medicine, emergency care, pandemics, vaccinations, and a few more) do not cover lab reports. |
| MTD-Gesetz 2024, § 4 Abs 2 Z 1 lit d and § 5 Abs 1 | Biomedical scientists produce a "biomedical-analytical finding" on their own, after a medical order. Diagnosis stays with physicians. | Confirmed. The law does not itself say "plausibility check" or "comparison with earlier values". That reading is from Stöger et al., RdM 2025/38, and we now say so. |
| KAKuG §§ 7 and 8 | The lab's medical lead answers for the lab's work. | **Corrected.** § 8 is about physicians being present in a hospital, not about labs, so we removed it. § 7 Abs 1 requires a suitable physician as medical lead in every hospital, which includes independent outpatient clinics (§ 2 Abs 1 Z 5). § 7 Abs 4 requires that a lab inside a hospital be led by a specialist of the relevant specialty. A group practice is not a hospital (§ 2 Abs 2 lit e), so a lab run as a doctor's practice or group practice falls under the Ärztegesetz instead. But a lab whose staff and volume need a hospital's organisation counts as a hospital even if run as a practice (§ 2 Abs 3). |
| KAKuG § 24 Abs 2 | A hospital writes a discharge letter at discharge. Rehab centres are special hospitals (§ 2 Abs 1 Z 2), so this covers the rehab report. | Confirmed. |

The corrections are already in the docs, marked "pending clinical sign-off".

### Recommended answer: plausible, with the corrections above

The reading holds: a medical lab report and a discharge letter are physicians' documents, the responsible physician must work within their specialty, and a biomedical scientist alone does not produce a medical lab report.

### What we could not check

- The KAKuG is a framework law. The binding detail is in the nine state hospital laws, for example on who may lead an independent lab clinic. We did not check them.
- We found no court decision on how strictly § 31 Abs 3 applies to lab tests done outside the laboratory specialty.
- We did not re-check the ELGA lab report guide and the article by Stöger et al. in this review. They were already cited in the docs.

### Risk if we are wrong

The prototype runs on synthetic data, so a legal error does not harm a patient today. Before a pilot with real data, a lawyer or the medical chamber should confirm the reading. If the reading is too strict, correct results are held more often. If it is too loose, ordy could file results that a physician was not allowed to release.

### Confidence

High that the paragraph numbers and their content are right. Medium for the reading as a whole, because it is not legal advice and the state laws are unchecked.

### Sources

- [Ärztegesetz 1998](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10011138): [§ 2](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10011138&Paragraf=2), [§ 3](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10011138&Paragraf=3), [§ 31](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10011138&Paragraf=31)
- [MTD-Gesetz 2024](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20012653), BGBl. I Nr. 100/2024
- [KAKuG § 2](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10010285&Paragraf=2), [§ 7](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10010285&Paragraf=7), [§ 8](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10010285&Paragraf=8), [§ 24](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10010285&Paragraf=24)
- [Stöger, Wagner, Griesmacher, Hörmann: Biomedizinisch-analytische und ärztliche Befundung, RdM 2025/38](https://biomed-austria.at/sites/default/files/uploads/St%C3%B6ger%20et%20al%20Befundung%20BMA_RdM%2025-38.pdf)

### Your answer

- [ ] Confirm as written, including the corrections
- [ ] Change to: ______________________________________________

Reviewer: ____________________  Date: ____________

---

## After the sign-off

A developer applies any change you asked for to [Identity and misdelivery](../IDENTITY.md#who-may-release-a-document), the [whitepaper](../WHITEPAPER.md#2-which-identity-check-do-you-require-for-each-type-of-document-and-why), and the release check in the software. They remove the "pending clinical sign-off" marks and close issue #18.
