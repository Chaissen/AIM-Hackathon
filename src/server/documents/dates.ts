// The date formats the parser reads, in the Europe/Vienna time zone. docs/ARCHITECTURE.md, "Document parsing".
const TIME_ZONE = "Europe/Vienna";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const pad = (n: number) => String(n).padStart(2, "0");

/** `12 March 1961` to `1961-03-12`, or null. */
export function parseDate(value: string): string | null {
  const match = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), MONTHS.indexOf(match[2].toLowerCase()) + 1, Number(match[3])];
  if (!month) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const offsetFormat = new Intl.DateTimeFormat("en", { timeZone: TIME_ZONE, timeZoneName: "longOffset" });

/** Minutes east of UTC in Vienna at the given instant. */
function viennaOffset(instant: number): number {
  const name = offsetFormat.formatToParts(instant).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  return match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}

/** `22 October 2026, 08:10` to `2026-10-22T08:10:00+02:00`, with the Vienna offset that applied then, or null. */
export function parseDateTime(value: string): string | null {
  const match = /^(.+), (\d{1,2}):(\d{2})$/.exec(value.trim());
  const date = match && parseDate(match[1]);
  if (!match || !date) return null;
  const [hours, minutes] = [Number(match[2]), Number(match[3])];
  if (hours > 23 || minutes > 59) return null;
  const [year, month, day] = date.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day, hours, minutes);
  const offset = viennaOffset(wall - viennaOffset(wall) * 60_000);
  const sign = offset < 0 ? "-" : "+";
  return `${date}T${pad(hours)}:${pad(minutes)}:00${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

/** `2 to 23 September 2026` or `28 August to 12 September 2026`; the left side borrows month and year from the right. */
export function parseDateRange(value: string): { start: string; end: string } | null {
  const [left, right, ...rest] = value.trim().split(" to ");
  if (!left || !right || rest.length) return null;
  const leftParts = left.split(" ");
  const rightParts = right.split(" ");
  const start = parseDate([...leftParts, ...rightParts.slice(leftParts.length)].join(" "));
  const end = parseDate(right);
  return start && end && start <= end ? { start, end } : null;
}
