// The audit actor of an outside person, such as "Eva Brandl (GH:abc)". The login and the answer flow write it, and
// the widget reads the name back.

export const outsidePersonActor = (name: string, personNumber: string | null) => `${name} (${personNumber ?? "no person number"})`;

/** The name in an outside person's actor, or null for any other actor, such as a Matrix ID or "ID Austria login". */
export function outsidePersonName(actor: string): string | null {
  const open = actor.lastIndexOf(" (");
  return open > 0 && actor.endsWith(")") ? actor.slice(0, open) : null;
}
