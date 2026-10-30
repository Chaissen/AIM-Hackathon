import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDocument } from "./parse";
import { labResultMaria, labResultMax, rehabReportMaria } from "./scenario-fixtures";

// The mapper tests build on the fixtures, so the fixtures must stay what the parser returns.
for (const fixture of [labResultMaria, labResultMax, rehabReportMaria]) {
  test(`the fixture for "${fixture.patient.name}: ${fixture.kind}" equals the parser output`, () => {
    assert.deepEqual(parseDocument(fixture.markdown), { ok: true, document: fixture });
  });
}
