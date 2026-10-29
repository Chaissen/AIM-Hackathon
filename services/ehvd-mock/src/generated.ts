import type { DirectoryEntry } from "./directory.ts";
import type { GdaStatus } from "./soap.ts";

const firstnames = [
  "Andrea", "Barbara", "Christina", "Daniela", "Elisabeth", "Franziska", "Gabriele", "Hannah", "Ines", "Julia",
  "Katharina", "Laura", "Magdalena", "Nina", "Petra", "Sabine", "Theresa", "Ursula", "Verena", "Zeynep",
  "Alexander", "Bernhard", "Christoph", "David", "Florian", "Georg", "Herbert", "Jakob", "Klaus", "Lukas",
  "Markus", "Matthias", "Michael", "Paul", "Raphael", "Simon", "Tobias", "Wolfgang", "Łukasz", "Dragoš",
];

const surnames = [
  "Gruber", "Bauer", "Pichler", "Moser", "Mayer", "Steiner", "Berger", "Eder", "Fischer", "Schmid",
  "Winkler", "Weber", "Schwarz", "Maier", "Schneider", "Reiter", "Wimmer", "Egger", "Brunner", "Lang",
  "Baumgartner", "Auer", "Binder", "Lechner", "Wallner", "Aigner", "Ebner", "Koller", "Lehner", "Haas",
  "Schuster", "Müller", "Fuchs", "Holzer", "Haider", "Strasser", "Weiß", "Kovačević", "Nowak", "Horvath",
  "Yılmaz", "Dvořák", "Šimić", "Öztürk",
];

const titles = ["Dr.", "Dr.", "Dr.", "Dr. med. univ.", "Prim. Dr.", "Univ.-Prof. Dr."];

const places = [
  { city: "Wien", state: "Wien", zips: ["1010", "1030", "1050", "1090", "1100", "1130", "1160", "1210", "1220"] },
  { city: "Sankt Pölten", state: "Niederösterreich", zips: ["3100"] },
  { city: "Wiener Neustadt", state: "Niederösterreich", zips: ["2700"] },
  { city: "Linz", state: "Oberösterreich", zips: ["4020", "4040"] },
  { city: "Wels", state: "Oberösterreich", zips: ["4600"] },
  { city: "Salzburg", state: "Salzburg", zips: ["5020"] },
  { city: "Innsbruck", state: "Tirol", zips: ["6020"] },
  { city: "Bregenz", state: "Vorarlberg", zips: ["6900"] },
  { city: "Eisenstadt", state: "Burgenland", zips: ["7000"] },
  { city: "Graz", state: "Steiermark", zips: ["8010", "8020"] },
  { city: "Klagenfurt am Wörthersee", state: "Kärnten", zips: ["9020"] },
  { city: "Villach", state: "Kärnten", zips: ["9500"] },
];

const streets = [
  "Ahornweg", "Birkenallee", "Lindengasse", "Am Mühlbach", "Kastanienweg", "Sonnenhang", "Erlenstraße",
  "Talgasse", "Wiesenweg", "Feldgasse", "Gartenstraße", "Brunnenweg", "Hügelgasse", "Föhrenweg", "Quellenstraße",
];

const siteNames = [
  { name: "Lindenhof", slug: "lindenhof" },
  { name: "Sonnberg", slug: "sonnberg" },
  { name: "Talblick", slug: "talblick" },
  { name: "Erlengrund", slug: "erlengrund" },
  { name: "Bergwiese", slug: "bergwiese" },
  { name: "Mühlbach", slug: "muehlbach" },
  { name: "Seeblick", slug: "seeblick" },
  { name: "Föhrenwald", slug: "foehrenwald" },
  { name: "Ahornhain", slug: "ahornhain" },
  { name: "Kirchfeld", slug: "kirchfeld" },
  { name: "Auwald", slug: "auwald" },
  { name: "Steinfeld", slug: "steinfeld" },
];

const organisationKinds = [
  { label: "Klinikum", slug: "klinikum", role: "300", elgaRole: "702", idKind: "1.2.40.0.34.4.10", prefix: "K" },
  { label: "Krankenhaus", slug: "krankenhaus", role: "300", elgaRole: "702", idKind: "1.2.40.0.34.4.10", prefix: "K" },
  { label: "Rehazentrum", slug: "rehazentrum", role: "301", elgaRole: "702", idKind: "1.2.40.0.34.4.10", prefix: "K" },
  { label: "Labor", slug: "labor", role: "304", elgaRole: "724", idKind: "1.2.40.0.34.4.20", prefix: "A" },
  { label: "Ambulatorium", slug: "ambulatorium", role: "304", elgaRole: "702", idKind: "1.2.40.0.34.4.20", prefix: "A" },
] as const;

const specialties = ["1.2.40.0.34.3.1.10.20:7", "1.2.40.0.34.3.1.10.20:12", "1.2.40.0.34.3.1.10.20:19"];

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const FIRST_DAY = Date.UTC(2008, 0, 1);
const LAST_DAY = Date.UTC(2026, 8, 30);
const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);

export function generateEntries(): DirectoryEntry[] {
  const random = mulberry32(20261029);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const organisations: string[] = [];
  const entries: DirectoryEntry[] = [];

  for (let n = 0; n < 300; n += 1) {
    const place = pick(places);
    const address = {
      streetNumber: String(between(1, 80)),
      streetName: pick(streets),
      city: place.city,
      state: place.state,
      zip: pick(place.zips),
      country: "AT",
    };
    const roll = random();
    const status: GdaStatus =
      roll < 0.1
        ? { ehvdstatus: "Inaktiv", elgastatus: "Inaktiv" }
        : roll < 0.15
          ? { ehvdstatus: "Aktiv", elgastatus: "Inaktiv" }
          : { ehvdstatus: "Aktiv", elgastatus: "Aktiv" };
    const added = FIRST_DAY + between(0, (LAST_DAY - FIRST_DAY) / DAY) * DAY;
    const timestamps = { add: isoDate(added), modify: isoDate(added + between(0, (LAST_DAY - added) / DAY) * DAY) };

    if (random() < 0.15) {
      const kind = pick(organisationKinds);
      const site = pick(siteNames);
      const oid = `1.2.40.0.34.3.1.99.1.${1000 + n}`;
      organisations.push(oid);
      entries.push({
        oid,
        otherIds: [{ kind: kind.idKind, number: `${kind.prefix}${1000 + n}` }],
        status,
        surname: `${kind.label} ${site.name}`,
        address: [address],
        description: ["Registrierungsstelle:Amt der Landesregierung"],
        roles: { role: [`1.2.40.0.34.5.2:${kind.role}`], elgaRole: [`1.2.40.0.34.5.3:${kind.elgaRole}`], specialisation: [] },
        mail: `office@${kind.slug}-${site.slug}.example`,
        timestamps,
      });
      continue;
    }

    const family = pick(surnames);
    const surname = random() < 0.06 ? `${family}-${pick(surnames.filter((other) => other !== family))}` : family;
    const specialist = random() < 0.6;
    const memberof = organisations.length > 0 && random() < 0.3 ? [pick(organisations)] : [];
    entries.push({
      oid: `1.2.40.0.34.3.2.99.1.${1000 + n}`,
      otherIds: [{ kind: "1.2.40.0.34.4.18", number: String(91000 + n) }],
      status,
      firstname: pick(firstnames),
      surname,
      title: pick(titles),
      address: [address],
      description: ["Registrierungsstelle:Österreichische Ärztekammer"],
      roles: specialist
        ? { role: ["1.2.40.0.34.5.2:159"], elgaRole: ["1.2.40.0.34.5.3:700"], specialisation: [pick(specialties)] }
        : { role: ["1.2.40.0.34.5.2:100"], elgaRole: ["1.2.40.0.34.5.3:700"], specialisation: ["1.2.40.0.34.3.1.10:0"] },
      ...(memberof.length > 0 && { relations: { memberof, ownerof: [] } }),
      timestamps,
    });
  }
  return entries;
}
