import assert from "node:assert/strict";
import { test } from "node:test";

import { toUcum, UCUM_CODES } from "./ucum";

test("toUcum codes the usual lab spellings in UCUM", () => {
  const cases: [string, string][] = [
    ["10^9/L", "10*9/L"],
    ["x10^9/L", "10*9/L"],
    ["X10^9/l", "10*9/L"],
    ["× 10^12/l", "10*12/L"],
    ["10⁹/l", "10*9/L"],
    ["10^3/µL", "10*3/uL"],
    ["/nl", "/nL"],
    ["µmol/L", "umol/L"],
    ["μmol/l", "umol/L"],
    ["mmol/l", "mmol/L"],
    ["mg/dl", "mg/dL"],
    ["ml/min", "mL/min"],
    ["fl", "fL"],
    ["IU/L", "[IU]/L"],
    ["mIU/l", "m[IU]/L"],
    ["µIU/ml", "u[IU]/mL"],
    ["mmHg", "mm[Hg]"],
    ["mm Hg", "mm[Hg]"],
    ["mOsm/kg", "mosm/kg"],
    ["pH", "[pH]"],
    ["°C", "Cel"],
    ["°F", "[degF]"],
    ["kg/m²", "kg/m2"],
    [" s ", "s"],
    ["g/L", "g/L"],
  ];
  for (const [unit, code] of cases) assert.equal(toUcum(unit), code, unit);
});

test("toUcum keeps every code on its list as it is", () => {
  for (const code of UCUM_CODES) assert.equal(toUcum(code), code, code);
});

test("toUcum leaves empty, unknown, and misleading units uncoded", () => {
  // G/L and T/L mean giga and tera per litre on Austrian lab reports, but gauss and tesla per litre in UCUM.
  // mU/L, U/mL, and kU/L often mean international or arbitrary units there, but enzyme units in UCUM.
  for (const unit of ["", "G/L", "T/L", "mU/L", "U/mL", "kU/l", "Tsd/µl", "ratio", "mmol / L"]) assert.equal(toUcum(unit), null, unit);
});
