import { desc } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";

const EVENT_LABEL: Record<(typeof auditLog.$inferSelect)["event"], string> = {
  request_sent: "Request sent",
  link_opened: "Link opened",
  identity_checked: "Identity checked",
  answer_sent: "Answer sent",
  answer_filed: "Answer filed",
  misdelivery_caught: "Misdelivery caught",
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// GET /audit: the audit log for the demo, bound to localhost (organisations/ARCHITECTURE.md, "Outside portal").
export default function AuditPage() {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Who did what and when. Never document text.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading …</p>}>
        <AuditTable />
      </Suspense>
    </main>
  );
}

async function AuditTable() {
  // Demo guard only: both values are request headers, so a client on the network that forges both gets through.
  // For anything beyond the local demo, put /audit behind a login or a reverse proxy rule.
  const h = await headers();
  const host = (h.get("host") ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  const client = h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "";
  if (!(host === "localhost" || LOOPBACK.has(host)) || !LOOPBACK.has(client)) notFound();

  let rows: (typeof auditLog.$inferSelect)[];
  try {
    rows = await db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(500);
  } catch {
    return <p className="text-sm text-destructive">The database is not reachable. Start it with ./scripts/setup.sh.</p>;
  }
  if (!rows.length) return <p className="text-sm text-muted-foreground">No entries yet.</p>;

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time (UTC)</TableHead>
            <TableHead>Request</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap">{r.at.toISOString().replace("T", " ").slice(0, 19)}</TableCell>
              <TableCell>{r.requestId ?? ""}</TableCell>
              <TableCell>{EVENT_LABEL[r.event]}</TableCell>
              <TableCell>
                <div>{r.actor}</div>
                <div className="text-xs text-muted-foreground">{r.actorKind.replace("_", " ")}</div>
              </TableCell>
              <TableCell>
                <Badge variant={r.event === "misdelivery_caught" || r.outcome === "fail" ? "destructive" : "secondary"}>{r.outcome}</Badge>
              </TableCell>
              <TableCell className="max-w-md font-mono text-xs whitespace-normal break-all text-muted-foreground">
                {JSON.stringify(r.detail)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
