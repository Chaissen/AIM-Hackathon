import assert from "node:assert/strict";
import { test } from "node:test";

import { directory, type DirectoryEntry } from "../src/directory.ts";
import { generateEntries } from "../src/generated.ts";

const SCENARIO_ORGANISATIONS = ["1.2.40.0.34.3.1.99.1.1", "1.2.40.0.34.3.1.99.1.2", "1.2.40.0.34.3.1.99.1.3"];
const SCENARIO_SURNAMES = ["Brandl", "Hofer", "Leitner", "Huber", "Wagner", "Kern", "Beispiel", "Ottakringer"];
const ACTIVE = { ehvdstatus: "Aktiv", elgastatus: "Aktiv" };
const INACTIVE = { ehvdstatus: "Inaktiv", elgastatus: "Inaktiv" };

const isOrganisation = (entry: DirectoryEntry) => entry.oid.startsWith("1.2.40.0.34.3.1.");
const summary = ({ oid, firstname, surname, status, relations }: DirectoryEntry) => ({ oid, firstname, surname, status, memberof: relations?.memberof });

test("the generator builds the same 300 entries on every run", () => {
  const entries = generateEntries();
  assert.deepEqual(generateEntries(), entries);
  assert.deepEqual([entries.length, entries.filter(isOrganisation).length], [300, 51]);
  assert.deepEqual([entries[0], entries[1], entries[2], entries[3], entries[9]].map(summary), [
    { oid: "1.2.40.0.34.3.2.99.1.1000", firstname: "Magdalena", surname: "Schneider", status: ACTIVE, memberof: undefined },
    { oid: "1.2.40.0.34.3.1.99.1.1001", firstname: undefined, surname: "Krankenhaus Erlengrund", status: ACTIVE, memberof: undefined },
    { oid: "1.2.40.0.34.3.1.99.1.1002", firstname: undefined, surname: "Krankenhaus Bergwiese", status: ACTIVE, memberof: undefined },
    { oid: "1.2.40.0.34.3.2.99.1.1003", firstname: "Franziska", surname: "Strasser-Maier", status: ACTIVE, memberof: ["1.2.40.0.34.3.1.99.1.1002"] },
    { oid: "1.2.40.0.34.3.2.99.1.1009", firstname: "Zeynep", surname: "Egger", status: INACTIVE, memberof: ["1.2.40.0.34.3.1.99.1.1001"] },
  ]);
});

test("generated entries avoid the scenario's surnames and organisations, and join generated ones", () => {
  const entries = generateEntries();
  const organisations = new Set(entries.filter(isOrganisation).map((entry) => entry.oid));
  for (const entry of entries) {
    for (const name of entry.surname.split("-")) assert.equal(SCENARIO_SURNAMES.includes(name), false, `${entry.oid} ${entry.surname}`);
    for (const oid of entry.relations?.memberof ?? []) assert.equal(SCENARIO_ORGANISATIONS.includes(oid), false, `${entry.oid} memberof ${oid}`);
  }
  assert.equal(entries.filter((entry) => entry.relations?.memberof.some((oid) => organisations.has(oid))).length, 83);
});

test("generated entries cover all nine federal states and keep elgastatus inactive when ehvdstatus is", () => {
  const entries = generateEntries();
  assert.deepEqual(
    [...new Set(entries.flatMap((entry) => entry.address?.map((address) => address.state) ?? []))].sort(),
    ["Burgenland", "Kärnten", "Niederösterreich", "Oberösterreich", "Salzburg", "Steiermark", "Tirol", "Vorarlberg", "Wien"],
  );
  const inactive = entries.filter((entry) => entry.status.ehvdstatus === "Inaktiv");
  const withoutElga = entries.filter((entry) => entry.status.ehvdstatus === "Aktiv" && entry.status.elgastatus === "Inaktiv");
  assert.deepEqual([inactive.length, withoutElga.length], [36, 13]);
  assert.deepEqual(inactive.filter((entry) => entry.status.elgastatus !== "Inaktiv"), []);
});

test("every OID is unique and every memberof names an organisation in the directory", () => {
  const oids = directory.map((entry) => entry.oid);
  assert.equal(new Set(oids).size, oids.length);
  const organisations = new Set(oids.filter((oid) => oid.startsWith("1.2.40.0.34.3.1.")));
  for (const entry of directory) {
    for (const oid of entry.relations?.memberof ?? []) assert.equal(organisations.has(oid), true, `${entry.oid} memberof ${oid}`);
  }
});
