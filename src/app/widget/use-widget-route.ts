import { useSyncExternalStore } from "react";

import { parseWidgetRoute, widgetHref, type WidgetRoute } from "./widget-route";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const getHash = () => window.location.hash;
// The server has no hash, so it renders the overview and the client switches to the real view while hydrating.
const getServerHash = () => "";

/** The view in `location.hash`, read again on every hashchange. */
export function useWidgetRoute(): WidgetRoute {
  return parseWidgetRoute(useSyncExternalStore(subscribe, getHash, getServerHash));
}

/** Opens a view. A hash change is a history entry, so back and forward walk through the views. */
export function navigate(route: WidgetRoute) {
  window.location.hash = widgetHref(route);
}
