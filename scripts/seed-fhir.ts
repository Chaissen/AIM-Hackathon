// Loads the scenario patient (Maria Beispiel) into the FHIR server.
import { readFile } from "node:fs/promises";

import type { Patient } from "fhir/r4";

import { put } from "@/server/fhir/client";

const patient = JSON.parse(await readFile(new URL("../track/scenario/patient.json", import.meta.url), "utf8")) as Patient & { id: string };
const saved = await put(patient);
console.log(`Patient/${saved.id} saved (${saved.name?.[0]?.given?.join(" ")} ${saved.name?.[0]?.family})`);
