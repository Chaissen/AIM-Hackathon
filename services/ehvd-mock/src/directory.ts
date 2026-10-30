import { chamber, idKinds, stateGovernment, type IdKind } from "./codes.ts";
import { generateEntries } from "./generated.ts";
import type { GdaAddress, GdaRelationship, GdaRoles, GdaStatus, GdaTimestamps } from "./soap.ts";

export const EHVD_AUTHORITY = "1.2.40.0.34";

export type DirectoryEntry = {
  oid: string;
  getGdaOnly?: true;
  otherIds?: { kind: IdKind; number: string }[];
  status: GdaStatus;
  firstname?: string;
  surname: string;
  gender?: string;
  title?: string;
  knownname?: string[];
  address?: GdaAddress[];
  description?: string[];
  roles: GdaRoles;
  relations?: GdaRelationship;
  tel?: string;
  fax?: string;
  web?: string;
  mail?: string;
  timestamps?: GdaTimestamps;
};

export const RESERVED_6003 = "1.2.40.0.34.3.1.99.9.6003";

const active: GdaStatus = { ehvdstatus: "Aktiv", elgastatus: "Aktiv" };

const klinikum = "1.2.40.0.34.3.1.99.1.1";
const labor = "1.2.40.0.34.3.1.99.1.2";
const reha = "1.2.40.0.34.3.1.99.1.3";

const klinikumAddress: GdaAddress = { streetNumber: "10", streetName: "Musterstraße", city: "Beispielstadt", zip: "1000", country: "AT" };
const laborAddress: GdaAddress = { streetNumber: "12", streetName: "Kanalstraße", city: "Beispielstadt", zip: "1000", country: "AT" };
const rehaAddress: GdaAddress = { streetNumber: "3", streetName: "Waldweg", city: "Beispielstadt", zip: "1000", country: "AT" };

const scenario: DirectoryEntry[] = [
  {
    oid: klinikum,
    otherIds: [{ kind: idKinds.kaNr, number: "K9001" }],
    status: active,
    surname: "Klinikum Beispielstadt",
    address: [klinikumAddress],
    description: [stateGovernment],
    roles: { role: ["1.2.40.0.34.5.2:300"], elgaRole: ["1.2.40.0.34.5.3:702"], specialisation: [] },
    mail: "office@klinikum.example",
    timestamps: { add: "2012-04-02", modify: "2025-11-20" },
  },
  {
    oid: labor,
    otherIds: [{ kind: idKinds.ambuNr, number: "A9101" }],
    status: active,
    surname: "Labor Kanalstraße",
    address: [laborAddress],
    description: [stateGovernment],
    roles: { role: ["1.2.40.0.34.5.2:304"], elgaRole: ["1.2.40.0.34.5.3:724"], specialisation: [] },
    mail: "office@labor-kanal.example",
    timestamps: { add: "2014-09-15", modify: "2026-02-03" },
  },
  {
    oid: reha,
    otherIds: [{ kind: idKinds.kaNr, number: "K9301" }],
    status: active,
    surname: "Reha Waldblick",
    address: [rehaAddress],
    description: [stateGovernment],
    roles: { role: ["1.2.40.0.34.5.2:301"], elgaRole: ["1.2.40.0.34.5.3:702"], specialisation: [] },
    mail: "office@reha-waldblick.example",
    timestamps: { add: "2016-01-11", modify: "2025-06-30" },
  },
  {
    oid: "1.2.40.0.34.3.2.99.1.1",
    otherIds: [{ kind: idKinds.arztNr, number: "99001" }],
    status: active,
    firstname: "Lena",
    surname: "Hofer",
    title: "Dr.",
    address: [klinikumAddress],
    description: [chamber],
    roles: { role: ["1.2.40.0.34.5.2:159"], elgaRole: ["1.2.40.0.34.5.3:700"], specialisation: ["1.2.40.0.34.3.1.10.20:7"] },
    relations: { memberof: [klinikum], ownerof: [] },
    timestamps: { add: "2017-07-01", modify: "2025-12-01" },
  },
  {
    oid: "1.2.40.0.34.3.2.99.1.2",
    otherIds: [{ kind: idKinds.arztNr, number: "99002" }],
    status: active,
    firstname: "Eva",
    surname: "Brandl",
    title: "Dr.",
    address: [laborAddress],
    description: [chamber],
    roles: { role: ["1.2.40.0.34.5.2:159"], elgaRole: ["1.2.40.0.34.5.3:700"], specialisation: ["1.2.40.0.34.3.1.10.20:19"] },
    relations: { memberof: [labor], ownerof: [] },
    timestamps: { add: "2019-03-01", modify: "2026-01-15" },
  },
  {
    oid: "1.2.40.0.34.3.2.99.1.3",
    otherIds: [{ kind: idKinds.arztNr, number: "99003" }],
    status: active,
    firstname: "Johanna",
    surname: "Leitner",
    title: "Dr.",
    address: [rehaAddress],
    description: [chamber],
    roles: { role: ["1.2.40.0.34.5.2:159"], elgaRole: ["1.2.40.0.34.5.3:700"], specialisation: ["1.2.40.0.34.3.1.10.20:12"] },
    relations: { memberof: [reha], ownerof: [] },
    timestamps: { add: "2018-10-22", modify: "2025-09-12" },
  },
  {
    oid: "1.2.40.0.34.3.2.99.1.4",
    otherIds: [{ kind: idKinds.arztNr, number: "99004" }],
    status: active,
    firstname: "Martin",
    surname: "Brandl",
    title: "Dr.",
    address: [{ streetNumber: "4", streetName: "Am Musterhof", city: "Linz", state: "Oberösterreich", zip: "4020", country: "AT" }],
    description: [chamber],
    roles: { role: ["1.2.40.0.34.5.2:100"], elgaRole: ["1.2.40.0.34.5.3:700"], specialisation: ["1.2.40.0.34.3.1.10:0"] },
    timestamps: { add: "2011-05-09", modify: "2024-03-18" },
  },
  {
    oid: "1.2.40.0.34.3.2.99.1.5",
    otherIds: [{ kind: idKinds.arztNr, number: "99005" }],
    status: { ehvdstatus: "Inaktiv", elgastatus: "Inaktiv" },
    firstname: "Eva",
    surname: "Brandl-Huber",
    title: "Dr.",
    address: [{ streetNumber: "21", streetName: "Beispielgasse", city: "Graz", state: "Steiermark", zip: "8010", country: "AT" }],
    description: [chamber],
    roles: { role: ["1.2.40.0.34.5.2:159"], elgaRole: ["1.2.40.0.34.5.3:700"], specialisation: ["1.2.40.0.34.3.1.10.20:19"] },
    timestamps: { add: "2009-02-16", modify: "2023-08-31" },
  },
];

const handbook: DirectoryEntry[] = [
  {
    oid: "1.2.40.0.34.3.1.0.2",
    otherIds: [{ kind: idKinds.ambuNr, number: "A9999" }],
    status: active,
    surname: "Test-GDA Ambulatorium",
    address: [{ streetNumber: "1", streetName: "Testgasse", city: "Wien", state: "Wien", zip: "1030", country: "AT" }],
    description: [stateGovernment],
    roles: { role: ["1.2.40.0.34.5.2:304"], elgaRole: ["1.2.40.0.34.5.3:702"], specialisation: [] },
    timestamps: { add: "2015-01-01", modify: "2026-01-01" },
  },
  {
    oid: "1.2.40.0.34.3.1.0.5",
    status: active,
    surname: "Gruppenpraxis Dr. Aldemar SVC Betriebsordination Wahlarzt OG",
    address: [
      { streetNumber: "5", streetName: "Testgasse", city: "Wien", state: "Wien", zip: "1030", country: "AT" },
      { streetNumber: "8", streetName: "Probeweg", city: "Graz", state: "Steiermark", zip: "8020", country: "AT" },
    ],
    description: [chamber],
    roles: { role: ["1.2.40.0.34.5.2:100"], elgaRole: ["1.2.40.0.34.5.3:700"], specialisation: ["1.2.40.0.34.3.1.10:0"] },
    timestamps: { add: "2015-01-01", modify: "2026-01-01" },
  },
  {
    oid: "1.2.40.0.34.3.2.0.10",
    status: active,
    surname: "XXXeHealth Test-GDA XXXTest-GDA Support-Ordination BMG",
    address: [{ streetNumber: "1/3/3/40", streetName: "Scheingasse", city: "Wien", state: "Wien", zip: "1010", country: "AT" }],
    description: [chamber],
    roles: { role: ["1.2.40.0.34.5.2:100"], elgaRole: ["1.2.40.0.34.5.3:700"], specialisation: ["1.2.40.0.34.3.1.10:0"] },
    timestamps: { add: "2015-01-01", modify: "2026-01-01" },
  },
];

const idAustriaTestDoctor: DirectoryEntry = {
  oid: "1.2.40.0.34.3.2.99.0.11003",
  status: active,
  firstname: "XXXOtto",
  surname: "XXXOttakringer",
  title: "Dr.",
  description: [chamber],
  roles: {
    role: ["1.2.40.0.34.5.2:158", "1.2.40.0.34.5.2:100"],
    elgaRole: ["1.2.40.0.34.5.3:700"],
    specialisation: ["1.2.40.0.34.3.1.10:0", "1.2.40.0.34.3.1.10.20:49"],
  },
  timestamps: { add: "2022-09-10", modify: "2022-09-10" },
};

const withoutTimestamps: DirectoryEntry = {
  oid: "1.2.40.0.34.3.1.99.9.6004",
  getGdaOnly: true,
  status: active,
  surname: "ordy test entry without timestamps",
  description: [stateGovernment],
  roles: { role: ["1.2.40.0.34.5.2:304"], elgaRole: ["1.2.40.0.34.5.3:702"], specialisation: [] },
};

export const directory: readonly DirectoryEntry[] = [...scenario, ...handbook, idAustriaTestDoctor, withoutTimestamps, ...generateEntries()];
