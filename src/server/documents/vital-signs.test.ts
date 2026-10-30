import assert from "node:assert/strict";
import { test } from "node:test";

import { UCUM_CODES } from "./ucum";
import { REFUSED_VITAL_SIGNS, VITAL_SIGNS, vitalSign } from "./vital-signs";

test("every unit a vital sign allows is one the UCUM list codes", () => {
  for (const v of VITAL_SIGNS) for (const unit of v.units) assert.ok(UCUM_CODES.has(unit), `${v.code}: ${unit}`);
});

test("every vital sign code belongs to one profile or is refused, never both", () => {
  const codes = [...VITAL_SIGNS.flatMap((v) => [v.code, ...v.related]), ...REFUSED_VITAL_SIGNS.keys()];
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(vitalSign("2713-6")?.code, "2708-6");
  assert.equal(vitalSign("2711-0"), undefined);
});
