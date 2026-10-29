import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDate, parseDateRange, parseDateTime } from "./dates";

test("reads dates", () => {
  assert.equal(parseDate("12 March 1961"), "1961-03-12");
  assert.equal(parseDate("1 January 1960"), "1960-01-01");
  assert.equal(parseDate("29 february 2024"), "2024-02-29");
});

test("refuses other date formats and impossible dates", () => {
  for (const value of ["1961-03-12", "12.03.1961", "March 12 1961", "12 Mar 1961", "31 April 2026", "29 February 2026", ""]) {
    assert.equal(parseDate(value), null, value);
  }
});

test("reads times with the Vienna offset of that day", () => {
  assert.equal(parseDateTime("22 October 2026, 08:10"), "2026-10-22T08:10:00+02:00");
  assert.equal(parseDateTime("25 October 2026, 01:30"), "2026-10-25T01:30:00+02:00");
  assert.equal(parseDateTime("25 October 2026, 04:00"), "2026-10-25T04:00:00+01:00");
  assert.equal(parseDateTime("29 October 2026, 11:40"), "2026-10-29T11:40:00+01:00");
  assert.equal(parseDateTime("15 January 2026, 23:59"), "2026-01-15T23:59:00+01:00");
});

test("refuses times without a date or out of range", () => {
  for (const value of ["22 October 2026", "22 October 2026, 24:00", "22 October 2026, 8:60", "08:10"]) {
    assert.equal(parseDateTime(value), null, value);
  }
});

test("reads stays within one month and across months", () => {
  assert.deepEqual(parseDateRange("2 to 23 September 2026"), { start: "2026-09-02", end: "2026-09-23" });
  assert.deepEqual(parseDateRange("28 August to 12 September 2026"), { start: "2026-08-28", end: "2026-09-12" });
  assert.deepEqual(parseDateRange("20 December 2025 to 10 January 2026"), { start: "2025-12-20", end: "2026-01-10" });
});

test("refuses stays that end before they start or cannot be read", () => {
  for (const value of ["23 to 2 September 2026", "September 2026", "2 to 23 Septober 2026", "1 to 2 to 3 May 2026"]) {
    assert.equal(parseDateRange(value), null, value);
  }
});
