import assert from "node:assert/strict";
import { test } from "node:test";

import { parseWidgetRoute, widgetHref, type WidgetRoute } from "./widget-route";

test("one route of every view round-trips through its hash", () => {
  const cases: [WidgetRoute, string][] = [
    [{ view: "overview" }, "#/"],
    [{ view: "requests", filter: "all" }, "#/requests"],
    [{ view: "requests", filter: "attention" }, "#/requests?filter=attention"],
    [{ view: "request", id: 12 }, "#/requests/12"],
    [{ view: "new" }, "#/new"],
    [{ view: "patients" }, "#/patients"],
    [{ view: "patient", id: "maria-beispiel" }, "#/patients/maria-beispiel"],
    [{ view: "contacts" }, "#/contacts"],
    [{ view: "messages", room: null }, "#/messages"],
    [{ view: "messages", room: "#outside-documents:klinikum.example" }, "#/messages/%23outside-documents%3Aklinikum.example"],
    [{ view: "messages", room: "!opaque-room-id" }, "#/messages/!opaque-room-id"],
    [{ view: "audit", event: "all" }, "#/audit"],
    [{ view: "audit", event: "misdelivery_caught" }, "#/audit?event=misdelivery_caught"],
    [{ view: "metrics" }, "#/metrics"],
  ];
  assert.deepEqual(
    cases.map(([route]) => [widgetHref(route), parseWidgetRoute(widgetHref(route))]),
    cases.map(([route, href]) => [href, route]),
  );
});

test("the hashes of the routes table parse to their views", () => {
  assert.deepEqual(
    ["", "#", "#/", "#/requests", "#/requests?filter=closed", "#/requests?filter=all", "#/requests/7", "#/patients/maria-beispiel", "#/audit?event=request_sent"].map(
      parseWidgetRoute,
    ),
    [
      { view: "overview" },
      { view: "overview" },
      { view: "overview" },
      { view: "requests", filter: "all" },
      { view: "requests", filter: "closed" },
      { view: "requests", filter: "all" },
      { view: "request", id: 7 },
      { view: "patient", id: "maria-beispiel" },
      { view: "audit", event: "request_sent" },
    ],
  );
});

test("unknown hashes, bad ids, and unknown filters give the overview", () => {
  const overview = { view: "overview" };
  for (const hash of [
    "#/settings",
    "#/requests/abc",
    "#/requests/0",
    "#/requests/-3",
    "#/requests/1.5",
    "#/requests/2147483648",
    "#/requests/12/extra",
    "#/requests?filter=pending",
    "#/audit?event=deleted",
    "#/patients/..",
    "#/patients/%E0",
    "#/patients/maria%2Fbeispiel",
    "#/metrics/1",
    "#/messages/not-a-room",
    "#/messages/%E0",
    "#/room/#missing-server",
  ]) {
    assert.deepEqual(parseWidgetRoute(hash), overview, hash);
  }
  assert.deepEqual(parseWidgetRoute("#/requests/2147483647"), { view: "request", id: 2_147_483_647 });
});

test("the existing Element room link opens Messages with its room", () => {
  assert.deepEqual(parseWidgetRoute("#/room/#outside-documents:klinikum.example"), {
    view: "messages",
    room: "#outside-documents:klinikum.example",
  });
  assert.deepEqual(parseWidgetRoute("#/room/%21opaque-room-id"), { view: "messages", room: "!opaque-room-id" });
  assert.deepEqual(parseWidgetRoute("#/room/#outside-documents:klinikum.example/$event"), { view: "messages", room: "#outside-documents:klinikum.example" });
});
