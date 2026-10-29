import assert from "node:assert/strict";
import { test } from "node:test";

import { toUcum } from "./ucum";

test("toUcum codes the usual lab spellings in UCUM", () => {
  const cases: [string, string][] = [
    ["10^9/L", "10*9/L"],
    ["x10^9/L", "10*9/L"],
    ["× 10^12/l", "10*12/L"],
    ["10^3/µL", "10*3/uL"],
    ["µmol/L", "umol/L"],
    ["μmol/l", "umol/L"],
    ["mmol/l", "mmol/L"],
    ["mg/dl", "mg/dL"],
    ["ml/min", "mL/min"],
    ["fl", "fL"],
    ["IU/L", "[IU]/L"],
    ["mIU/l", "m[IU]/L"],
    [" s ", "s"],
    ["g/L", "g/L"],
  ];
  for (const [unit, code] of cases) assert.equal(toUcum(unit), code, unit);
});

test("toUcum leaves empty, unknown, and misleading units uncoded", () => {
  // G/L and T/L mean giga and tera per litre on Austrian lab reports, but gauss and tesla per litre in UCUM.
  for (const unit of ["", "G/L", "T/L", "sec", "ratio", "mmol / L"]) assert.equal(toUcum(unit), null, unit);
});
