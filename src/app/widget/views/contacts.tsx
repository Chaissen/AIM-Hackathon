"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTRPC } from "@/trpc/react";

import { DirectorySearch } from "../components/directory-search";
import { useDraft } from "../draft";
import { ShellPage } from "../shell";

/** The people outside the network Dr. Hofer asked for documents, and the eHVD search to find new ones. */
export function ContactsView() {
  return (
    <ShellPage crumbs={[{ label: "Contacts" }]}>
      <div className="grid gap-8">
        <section className="grid gap-4">
          <div className="grid gap-1">
            <h1 className="text-2xl">Contacts</h1>
            <p className="text-sm text-dim">People outside the network you asked for documents. A sender is verified once they answered with ID Austria.</p>
          </div>
          <PeopleAsked />
        </section>
        <section className="grid gap-4">
          <div className="grid gap-1">
            <h2 className="text-lg">Healthcare directory</h2>
            <p className="text-sm text-dim">Doctors and organisations listed in the eHVD. Search by name and press Enter.</p>
          </div>
          <DirectorySearch />
        </section>
      </div>
    </ShellPage>
  );
}

function PeopleAsked() {
  const trpc = useTRPC();
  const { data, error, isPending } = useQuery(trpc.clinic.contacts.queryOptions(undefined, { retry: false }));
  const { startRequest } = useDraft();

  if (error) {
    return (
      <p role="alert" className="text-destructive">
        Could not load your contacts. Check your network sign-in and the database, then reload this page.
      </p>
    );
  }
  if (isPending) return <Skeleton className="h-28" aria-busy />;
  if (data.length === 0) return <p className="text-sm text-dim">No contacts yet. They are added with your first request.</p>;

  return (
    <div className="min-w-0 border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden @xl/main:table-cell">Contact</TableHead>
            <TableHead className="hidden @md/main:table-cell">Status</TableHead>
            <TableHead>
              <span className="sr-only">Request</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((contact) => {
            const requests = contact.requests === 1 ? "1 request" : `${contact.requests} requests`;
            const status = contact.verified ? (
              <Badge variant="success">
                <ShieldCheck /> Verified sender
              </Badge>
            ) : (
              <Badge variant="outline">Not verified yet</Badge>
            );
            return (
              <TableRow key={contact.lastRequestId}>
                <TableCell className="wrap-anywhere whitespace-normal">
                  <div className="font-medium text-loud">
                    {contact.given} {contact.family}
                  </div>
                  <div className="text-xs text-muted-foreground">{contact.org}</div>
                  <div className="text-xs text-muted-foreground @xl/main:hidden">
                    {contact.address} · {requests}
                  </div>
                  <div className="mt-1.5 @md/main:hidden">{status}</div>
                </TableCell>
                <TableCell className="hidden wrap-anywhere whitespace-normal @xl/main:table-cell">
                  <div>{contact.address}</div>
                  <div className="text-xs text-muted-foreground">{requests}</div>
                </TableCell>
                <TableCell className="hidden @md/main:table-cell">{status}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      startRequest({
                        docType: contact.docType,
                        given: contact.given,
                        family: contact.family,
                        org: contact.org,
                        channel: contact.channel,
                        contact: contact.address,
                      })
                    }
                  >
                    Request
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
