// Every moment shows in the clinic's time zone, as in the emails (src/server/mail/message.ts), so a page the server
// renders and a page the browser renders show the same text.
const timeZone = "Europe/Vienna";
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone });
// A calendar date has no time zone. `new Date("1961-03-12")` is midnight UTC, so it is formatted in UTC.
const calendarDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A moment as "29 Oct 2026, 16:23", in a `<time>` that carries the exact instant. */
export function Time({ at, className }: { at: Date; className?: string }) {
  return (
    <time dateTime={at.toISOString()} className={className}>
      {dateTime.format(at)}
    </time>
  );
}

/** A moment to the second, the date above the clock: "29 Oct" over "16:23:05". For the audit log. */
export function EventTime({ at }: { at: Date }) {
  return (
    <time dateTime={at.toISOString()} title={at.toISOString()} className="grid">
      <span>{dayMonth.format(at)}</span>
      <span className="text-xs text-muted-foreground">{clock.format(at)}</span>
    </time>
  );
}

/** A calendar date such as a birth date, "12 Mar 1961". */
export function CalendarDate({ iso }: { iso: string }) {
  return <time dateTime={iso}>{calendarDate.format(new Date(iso))}</time>;
}
