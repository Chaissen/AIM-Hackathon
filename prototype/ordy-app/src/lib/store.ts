import { useEffect, useState, useSyncExternalStore } from "react"
import { commit, getVersion, state, subscribe } from "@/lib/api"

/** Re-render whenever the engine state changes. */
export function useStore() {
  return useSyncExternalStore(subscribe, getVersion)
}

/** Run an engine mutation, then save and notify. */
export function mutate<T>(fn: () => T): T {
  const out = fn()
  if (out instanceof Promise) {
    return out.then((v) => {
      commit()
      return v
    }) as T
  }
  commit()
  return out
}

export type Route =
  | { view: "overview" | "requests" | "new" | "patients" | "contacts" | "audit" | "metrics" | "outbox" }
  | { view: "request"; id: number; tab: string }
  | { view: "patient"; id: string }
  | { view: "portal"; token: string }

export function parseHash(hash = window.location.hash): Route {
  const h = decodeURIComponent(hash.slice(1)) || "overview"
  if (h.startsWith("portal-")) return { view: "portal", token: h.slice(7) }
  if (h.startsWith("r-")) {
    const [id, tab] = h.slice(2).split("-")
    return { view: "request", id: Number(id), tab: tab || "overview" }
  }
  if (h.startsWith("patient-")) return { view: "patient", id: h.slice(8) }
  const known = ["overview", "requests", "new", "patients", "contacts", "audit", "metrics", "outbox"]
  return { view: (known.includes(h) ? h : "overview") as "overview" }
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash())
  useEffect(() => {
    const on = () => {
      setRoute(parseHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return route
}

export const go = (h: string) => {
  window.location.hash = h
}

/** Doctors see requests and documents; admins also see the audit log, metrics and technical details. */
export const isAdmin = () => state()?.ui?.role === "admin"
export const setRole = (role: string) => mutate(() => { state().ui.role = role })
