import { z } from "zod";

import { requestInput } from "@/lib/request-input";
import { REQUEST_FILTERS, type RequestFilter } from "@/lib/request-status";
import { roomReference } from "@/lib/workspace";
import type { AuditEventName } from "@/server/metrics/audit";

// The widget's views as hash routes ("#/requests/12"). The hash leaves Element's widget query alone, so a frame reload
// keeps both the view and the connection to Element.

export type WidgetRoute =
  | { view: "overview" }
  | { view: "requests"; filter: RequestFilter }
  | { view: "request"; id: number }
  | { view: "new" }
  | { view: "patients" }
  | { view: "patient"; id: string }
  | { view: "contacts" }
  | { view: "messages"; room: string | null }
  | { view: "audit"; event: AuditEventName | "all" }
  | { view: "metrics" };

/** The events a hash may filter the audit log by, which is every event. The filter UI lists the same set. */
export const AUDIT_EVENTS: { [E in AuditEventName]: E } = {
  request_sent: "request_sent",
  link_opened: "link_opened",
  identity_checked: "identity_checked",
  answer_sent: "answer_sent",
  answer_filed: "answer_filed",
  misdelivery_caught: "misdelivery_caught",
  request_decided: "request_decided",
};

// Postgres `serial` ends at 2^31 - 1, as `byId` on the server says.
const requestId = z.string().transform(Number).pipe(z.number().int().positive().max(2_147_483_647));
const filter = z.enum(REQUEST_FILTERS).default("all");
const event = z.union([z.enum(AUDIT_EVENTS), z.literal("all")]).default("all");
const patientId = requestInput.shape.patient;

const OVERVIEW: WidgetRoute = { view: "overview" };

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The route for `location.hash`. Anything unknown, such as a bad id or filter, is the overview. */
export function parseWidgetRoute(hash: string): WidgetRoute {
  if (hash.startsWith("#/room/")) {
    const parsed = roomReference.safeParse(decode(hash.slice(7).split("/")[0]?.split("?")[0] ?? ""));
    return parsed.success ? { view: "messages", room: parsed.data } : OVERVIEW;
  }
  let url: URL;
  try {
    url = new URL(hash.slice(1) || "/", "http://widget");
  } catch {
    return OVERVIEW;
  }
  if (url.origin !== "http://widget") return OVERVIEW;
  const [view, id, ...rest] = url.pathname.split("/").filter((segment) => segment !== "");
  if (rest.length > 0) return OVERVIEW;
  const query = (name: string) => url.searchParams.get(name) ?? undefined;

  switch (view) {
    case "requests": {
      if (id !== undefined) {
        const parsed = requestId.safeParse(id);
        return parsed.success ? { view: "request", id: parsed.data } : OVERVIEW;
      }
      const parsed = filter.safeParse(query("filter"));
      return parsed.success ? { view: "requests", filter: parsed.data } : OVERVIEW;
    }
    case "patients": {
      if (id === undefined) return { view: "patients" };
      const parsed = patientId.safeParse(decode(id));
      return parsed.success ? { view: "patient", id: parsed.data } : OVERVIEW;
    }
    case "messages": {
      if (id === undefined) return { view: "messages", room: null };
      const parsed = roomReference.safeParse(decode(id));
      return parsed.success ? { view: "messages", room: parsed.data } : OVERVIEW;
    }
    case "audit": {
      if (id !== undefined) return OVERVIEW;
      const parsed = event.safeParse(query("event"));
      return parsed.success ? { view: "audit", event: parsed.data } : OVERVIEW;
    }
    case "new":
    case "contacts":
    case "metrics":
      return id === undefined ? { view } : OVERVIEW;
    default:
      return OVERVIEW;
  }
}

export function widgetHref(route: WidgetRoute): string {
  switch (route.view) {
    case "overview":
      return "#/";
    case "requests":
      return route.filter === "all" ? "#/requests" : `#/requests?filter=${route.filter}`;
    case "request":
      return `#/requests/${route.id}`;
    case "new":
      return "#/new";
    case "patients":
      return "#/patients";
    case "patient":
      return `#/patients/${encodeURIComponent(route.id)}`;
    case "contacts":
      return "#/contacts";
    case "messages":
      return route.room === null ? "#/messages" : `#/messages/${encodeURIComponent(route.room)}`;
    case "audit":
      return route.event === "all" ? "#/audit" : `#/audit?event=${route.event}`;
    case "metrics":
      return "#/metrics";
    default:
      return route satisfies never;
  }
}
