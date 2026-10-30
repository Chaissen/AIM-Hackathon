import type { IsoDate, ViennaDateTime } from "./types";

// Dates in the scenario documents are written in English, for example "12 March 1961" or "22 October 2026, 08:10",
// and meant in the Europe/Vienna time zone (docs/ARCHITECTURE.md, "Document parsing").

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const pad = (n: number) => String(n).padStart(2, "0");

type DateParts = { year: number; month: number; day: number };

function isRealDate({ year, month, day }: DateParts): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function dayMonth(day: string, monthName: string): { day: number; month: number } | null {
  const month = MONTHS.indexOf(monthName.toLowerCase()) + 1;
  return month > 0 ? { day: Number(day), month } : null;
}

// FHIR wants four digits for the year, also for a typo such as 0999.
const toIso = ({ year, month, day }: DateParts): IsoDate => `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;

/** `12 March 1961` to `1961-03-12`. Null for any other format or an impossible date. */
export function parseDate(text: string): IsoDate | null {
  const m = text.trim().match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  const dm = m && dayMonth(m[1], m[2]);
  if (!m || !dm) return null;
  const parts = { ...dm, year: Number(m[3]) };
  return isRealDate(parts) ? toIso(parts) : null;
}

const viennaOffsetFormat = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Vienna", timeZoneName: "longOffset" });

/** The Europe/Vienna UTC offset in minutes at an instant, for example 120 in summer. */
function viennaOffsetMinutes(instant: number): number {
  const name = viennaOffsetFormat
    .formatToParts(new Date(instant))
    .find((p) => p.type === "timeZoneName")?.value;
  const m = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

const offsetText = (offset: number) => {
  const abs = Math.abs(offset);
  return `${offset < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

/** An instant as FHIR `instant` with seconds and the Vienna offset, for example `2026-10-29T14:02:12+01:00`. */
export function viennaInstant(date: Date): ViennaDateTime {
  const offset = viennaOffsetMinutes(date.getTime());
  const wall = new Date(date.getTime() + offset * 60_000);
  const day = toIso({ year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate() });
  return `${day}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}${offsetText(offset)}`;
}

/** `22 October 2026, 08:10` to `2026-10-22T08:10:00+02:00`. Null for any other format or an impossible date or time. */
export function parseViennaDateTime(text: string): ViennaDateTime | null {
  const m = text.trim().match(/^(\d{1,2}) ([A-Za-z]+) (\d{4}), (\d{1,2}):(\d{2})$/);
  const dm = m && dayMonth(m[1], m[2]);
  if (!m || !dm) return null;
  const parts = { ...dm, year: Number(m[3]) };
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (!isRealDate(parts) || hour > 23 || minute > 59) return null;

  // The wall-clock time read as UTC, corrected by the offset Vienna has at that moment.
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute);
  let offset = viennaOffsetMinutes(wallClock);
  offset = viennaOffsetMinutes(wallClock - offset * 60_000);
  return `${toIso(parts)}T${pad(hour)}:${pad(minute)}:00${offsetText(offset)}`;
}

/**
 * `2 to 23 September 2026`, `28 August to 12 September 2026` or `28 December 2026 to 3 January 2027`.
 * The left side borrows the month and the year from the right side when it lacks them (docs/FHIR.md, "Rehab report mapping").
 */
export function parseStay(text: string): { start: IsoDate; end: IsoDate } | null {
  const [left, right, ...rest] = text.trim().split(" to ");
  if (!left || !right || rest.length) return null;
  const end = parseDate(right);
  if (!end) return null;
  const [endYear, endMonth] = end.split("-").map(Number);

  const words = left.trim().split(/\s+/);
  let start: DateParts | null = null;
  if (words.length === 1 && /^\d{1,2}$/.test(words[0])) {
    start = { day: Number(words[0]), month: endMonth, year: endYear };
  } else if (words.length === 2) {
    const dm = dayMonth(words[0], words[1]);
    // "28 December to 3 January 2027": a start month after the end month lies in the year before.
    if (dm) start = { ...dm, year: dm.month > endMonth ? endYear - 1 : endYear };
  } else if (words.length === 3) {
    const iso = parseDate(left);
    if (iso) {
      const [year, month, day] = iso.split("-").map(Number);
      start = { year, month, day };
    }
  }
  if (!start || !isRealDate(start)) return null;
  const startIso = toIso(start);
  return startIso <= end ? { start: startIso, end } : null;
}
