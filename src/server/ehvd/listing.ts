import { env } from "@/env";

import { ehvd, type EhvdClient } from "./client";
import { type DirectoryEntry, toEntries } from "./search";
import type { GdaDescriptor } from "./soap";

// The listed entries of the widget's Contacts view (docs/EHVD.md, "How ordy uses the eHVD"). The eHVD has no call that
// lists entries: GdaSearch needs a surname with two letters and stops at 200 hits with fault 6005. So the view lists
// the entries of EHVD_DIRECTORY_OIDS, each looked up with GetGDA, and the search finds everyone else.

export type DirectoryListing =
  /**
   * The entries in the configured order. An OID the eHVD does not list (fault 6002) is left out. `failed` counts the
   * OIDs whose lookup failed: unreachable, another fault, an answer the WSDL does not describe, or another entry's id.
   */
  | { status: "ok"; entries: DirectoryEntry[]; failed: number }
  /** Every lookup failed */
  | { status: "unavailable" };

/** Each OID once, looked up at the same time. The organisations among them name their members without another call. */
export async function listDirectory(oids: readonly string[] = env.EHVD_DIRECTORY_OIDS, client: EhvdClient = ehvd): Promise<DirectoryListing> {
  const unique = [...new Set(oids)];
  if (unique.length === 0) return { status: "ok", entries: [], failed: 0 };

  const lookups = await Promise.all(unique.map((id) => client.getGda({ id })));
  const found: GdaDescriptor[] = [];
  let failed = 0;
  lookups.forEach((lookup, i) => {
    if (!lookup.ok || (lookup.value !== null && lookup.value.id.id !== unique[i])) failed++;
    else if (lookup.value !== null) found.push(lookup.value);
  });
  if (failed === unique.length) return { status: "unavailable" };
  return { status: "ok", entries: await toEntries(found, found, client), failed };
}
