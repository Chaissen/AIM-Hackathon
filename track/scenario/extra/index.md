# Extra test documents

Our own set, before the jury brings theirs. Every file uses the format of [`../documents/`](../documents/). Everyone in it is made up.

Every request is Dr. Hofer's request about Maria Beispiel, born 12 March 1961. The sender uploads the file as the answer. `src/server/documents/extra.test.ts` runs every file through `parseDocument` and the patient check and asserts the columns Kind, Patient, and Expected, and the parser values named under Trap.

## Documents

| File | Kind | Patient | Sender | Expected | Trap |
|---|---|---|---|---|---|
| `lab-result-maria-beispiel-blood-count.md` | Lab result | Maria Beispiel, born 12 March 1961 | Dr. Eva Brandl | Filed. Validated by Dr. Eva Brandl, so the release check passes. | Sample taken the day after summer time ends, so `+01:00`. `10^12/L` becomes `10*12/L`. Four values outside the range: haemoglobin, erythrocytes, and haematocrit `L`, platelets `H`. CRP 14 with the range `< 5` needs `H` and a range with only `high` 5. |
| `lab-result-maria-beispiel-kidney.md` | Lab result | Maria Beispiel, born 12 March 1961 | Sophie Lindner-Pichler | Filed. She is not in the eHVD; the release check finds Dr. Eva Brandl by name. | Decimal commas in results and ranges: `1,02` is 1.02 and `H`, `3,4` is 3.4 and `L`. Sample taken before the clock change (`+02:00`), reported after it (`+01:00`). `µmol/L` is not UCUM; the code is `umol/L`. |
| `lab-result-maria-beispiel-metabolic.md` | Lab result | BEISPIEL Maria, born 12 March 1961 | Sophie Lindner-Pichler | Filed. The patient check passes, although the name is written differently. | The patient line has the family name first and in capitals. One-sided ranges: LDL `< 116` (only `high`, 128 is `H`) and HDL `> 45` (only `low`, 58 is `N`). `mIU/L` is not UCUM; the code is `m[IU]/L`. `%` is valid UCUM. |
| `rehab-report-maria-beispiel-2025.md` | Rehab report | Maria Beispiel, born 12 March 1961 | Stefan Kern | Filed, although it is an old stay and not the latest report. Written by Dr. Johanna Leitner. | The stay spans two months and the clock change of 26 October 2025: `2025-10-13` to `2025-11-07`. The period stays two dates, with no time and no offset. |
| `rehab-report-maria-beispiel-2024.md` | Rehab report | Maria Beispiel, born 12 March 1961 | Karl Heinz Moser-Wallner | Filed. The release check must find Dr. Johanna Leitner despite the title `Prim.` | The stay crosses a year and the left side names no year: `28 December to 25 January 2024` is `2023-12-28` to `2024-01-25`. `Pain at discharge: 2 of 10` inside `## Course` stays text. `Written by: Prim. Dr. Johanna Leitner` needs the titles `Prim.` and `Dr.` and the given name `Johanna`. The sender has a double given name and a double family name. |
| `lab-result-maria-anna-beispiel.md` | Lab result | Maria Anna Beispiel, born 21 November 1987 | Dr. Eva Brandl | Blocked: `patient_mismatch`. Nothing is filed, Dr. Hofer is told. | Same family name and same first given name as Maria, one extra given name, a different birth date. A check on the family and the first given name would pass. `µg/dL` is not UCUM; the code is `ug/dL`. |
| `rehab-report-maria-beispiel-namesake.md` | Rehab report | Maria Beispiel, born 3 December 1961 | Stefan Kern | Blocked: `patient_mismatch`. Nothing is filed, Dr. Hofer is told. | A namesake. The name matches exactly, the birth date has day and month swapped (`03.12.1961` against `12.03.1961`). A check on the name alone would pass. Same clinic, same author, and same sender as Maria's real reports. |
| `microbiology-report-johann-maria-gruber.md` | Other | Johann Maria Gruber, born 12 March 1961 | Sophie Lindner-Pichler | Blocked: `patient_mismatch`. Nothing is filed, Dr. Hofer is told. | Same birth date as Maria, and `Maria` is one of his given names, but the family name is missing. The kind `microbiology report` is neither lab report nor discharge report, so the parser returns a generic document. |

## Outside people

Two new senders with double names. They are not in the realm file. Add them to the simulated ID Austria after every `./scripts/setup.sh` or Keycloak recreate:

```bash
pnpm citizen --given Sophie --family Lindner-Pichler --birthdate 1991-04-17
pnpm citizen --given "Karl Heinz" --family Moser-Wallner --birthdate 1975-08-08
```

| Username | Password | Name | Birth date | bPK | Plays | Contact |
|---|---|---|---|---|---|---|
| `sophie.lindner-pichler` | `demo-sophie` | Sophie Lindner-Pichler | 1991-04-17 | `GH:2KJhKOguN9KGwXfn3ks6G3L/3Zo=` | Biomedical scientist at Labor Kanalstraße. She sends results that Dr. Eva Brandl validated. Not in the eHVD. | `sophie.lindner-pichler@labor-kanal.example` |
| `karl-heinz.moser-wallner` | `demo-karl` | Karl Heinz Moser-Wallner | 1975-08-08 | `GH:pkNTMRK75YGoZ1lqSH5kAvaF37w=` | Discharge manager at Reha Waldblick, Stefan Kern's colleague. Not in the eHVD. | `+43 660 000 0102` |

Name traps for the request ([name match](../../../docs/IDENTITY.md#name-match)):

| Dr. Hofer types | ID Austria returns | Expected |
|---|---|---|
| Sophie Lindner | Sophie Lindner-Pichler | Pass. The double family name contains Lindner. |
| Sophie Lindner-Pichler | Sophie Lindner-Pichler | Pass |
| Karl-Heinz Moser-Wallner | Karl Heinz Moser-Wallner | Pass. The hyphen splits the given name into the same two words. |
| Karl Moser | Karl Heinz Moser-Wallner | Pass. An extra given name is fine. |
| Karl Heinz Wallner-Moser | Karl Heinz Moser-Wallner | Pass. The order of the family name words does not count. |

## Open parser gaps

Run on 30 October 2026 against `parseDocument` from T10. The test marks these expectations as `todo`, so they show up in every run without failing it. Remove the `todo` when the parser is fixed.

| Gap | Documents | Parser today | Expected |
|---|---|---|---|
| One-sided reference ranges | blood count (`< 5`), metabolic (`< 116`, `> 45`) | `low` and `high` null, no interpretation. CRP 14 and LDL 128 are not flagged. | `< x` gives only `high`, `> x` only `low`. `text` keeps the range as written. |
| Units that are not UCUM | kidney (`µmol/L`), metabolic (`mIU/L`), Maria Anna Beispiel (`µg/dL`) | Passed through unchanged, so the validator reports an error | `umol/L`, `m[IU]/L`, `ug/dL`. `unitText` keeps the unit as written. |
| The title `Prim.` | rehab 2024 | `titles` empty, `given` `Prim. Dr. Johanna` | `titles` `Prim.` and `Dr.`, `given` `Johanna`. `nameWords` in `src/server/identity/names.ts` does not drop `prim` either. |
