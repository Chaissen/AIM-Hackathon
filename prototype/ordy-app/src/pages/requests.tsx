import { useState } from "react"
import { ArrowRight, Clock, Inbox, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { AppShell, PageHeader } from "@/components/app-shell"
import { StatusBadge } from "@/components/status"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { DOC_TYPES, STATES, act, ago, counts, pName, patient, recipientLabel, state } from "@/lib/api"
import { go, mutate, useStore } from "@/lib/store"

const lastUpdate = (r: any) => Math.max(r.createdAt, ...state().audit.filter((a: any) => a.requestId === r.id).map((a: any) => a.at))

export function RequestsTable({ list, empty }: { list: any[]; empty?: string }) {
  if (!list.length) {
    return (
      <div className="grid justify-items-center gap-3 py-10 text-center text-sm text-muted-foreground">
        <Inbox className="size-6" />
        <span>{empty ?? "No requests here yet."}</span>
        <Button size="sm" asChild><a href="#new">New request</a></Button>
      </div>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Patient</TableHead>
          <TableHead>Document</TableHead>
          <TableHead className="hidden md:table-cell">From</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((r) => (
          <TableRow key={r.id} className="cursor-pointer" onClick={() => go(`r-${r.id}`)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && go(`r-${r.id}`)}>
            <TableCell className="font-medium">{pName(patient(r.patientId))}</TableCell>
            <TableCell>{DOC_TYPES[r.docType].label}</TableCell>
            <TableCell className="hidden md:table-cell">
              <div>{recipientLabel(r)}</div>
              <div className="text-xs text-muted-foreground">{r.org}</div>
            </TableCell>
            <TableCell><StatusBadge state={r.state} /></TableCell>
            <TableCell className="hidden text-right text-muted-foreground sm:table-cell">{ago(lastUpdate(r))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** One line per request that waits for the doctor, with the matching action. */
export function DecisionItem({ r, compact }: { r: any; compact?: boolean }) {
  let title: string, text: string
  let buttons: [string, string][]
  if (r.state === "awaiting_confirmation") {
    title = "The email address looks wrong"
    text = `${r.org} normally uses @${r.addressCheck.exp}, but you typed @${r.addressCheck.got}${r.addressCheck.diff ? ` (${r.addressCheck.diff})` : ""}.`
    buttons = [["send", "Send anyway"], ["cancel", "Cancel"]]
  } else if (r.state === "identity_held") {
    title = "Is this the right person?"
    text = `${r.heldIdentity.name} opened your request. You asked for ${r.given} ${r.family}.`
    buttons = [["accept", "Accept"], ["reject", "Reject"]]
  } else {
    title = "Check this document before it goes into the record"
    text = `${r.pendingAnswer.by} sent a document. ${r.roleConfirmed ? "It is not in the format we expected." : "We could not confirm that this person works there."}`
    buttons = [["accept", "Add to record"], ["reject", "Reject"]]
  }
  const run = (op: string) => {
    mutate(() => act[op](r))
    toast(({ send: "Request sent", accept: "Accepted", reject: "Rejected", cancel: "Request cancelled" } as Record<string, string>)[op])
  }
  return (
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <TriangleAlert className="text-amber-600" />
      <AlertTitle>{title}{compact && <span className="font-normal text-muted-foreground"> · {DOC_TYPES[r.docType].label} for {pName(patient(r.patientId))}</span>}</AlertTitle>
      <AlertDescription className="grid gap-3">
        <span>{text}</span>
        <div className="flex flex-wrap gap-2">
          {buttons.map(([op, label], i) => (
            <Button key={op} size="sm" variant={i === 0 ? "default" : "outline"} onClick={() => run(op)}>{label}</Button>
          ))}
          {compact && <Button size="sm" variant="ghost" asChild><a href={`#r-${r.id}`}>Open <ArrowRight /></a></Button>}
        </div>
      </AlertDescription>
    </Alert>
  )
}

export function OverviewPage() {
  useStore()
  const S = state()
  const c = counts()
  const decide = S.requests.filter((r: any) => STATES[r.state]?.decide)
  const recent = S.requests.slice().sort((a: any, b: any) => lastUpdate(b) - lastUpdate(a)).slice(0, 5)
  const stats = [
    { label: "Waiting for a reply", value: c.waiting, icon: Clock },
    { label: "Needs your attention", value: c.decide, icon: TriangleAlert, warn: c.decide > 0 },
    { label: "Received", value: c.filed, icon: Inbox },
  ]
  return (
    <AppShell crumbs={<span className="font-medium">Overview</span>}>
      <PageHeader title="Good day, Dr. Hofer" description="Documents you asked for from labs, rehab clinics and other practices." />
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="gap-1 py-5">
            <CardHeader className="px-5">
              <CardDescription className="flex items-center gap-2"><s.icon className="size-4" /> {s.label}</CardDescription>
              <CardTitle className={`text-3xl font-semibold ${s.warn ? "text-amber-600 dark:text-amber-400" : ""}`}>{s.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      {decide.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-base font-semibold">Needs your attention</h2>
          {decide.map((r: any) => <DecisionItem key={r.id} r={r} compact />)}
        </section>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Recent requests</CardTitle>
          <CardAction><Button variant="ghost" size="sm" asChild><a href="#requests">View all <ArrowRight /></a></Button></CardAction>
        </CardHeader>
        <CardContent>
          <RequestsTable list={recent} empty="You have not requested any documents yet." />
        </CardContent>
      </Card>
    </AppShell>
  )
}

export function RequestsPage() {
  useStore()
  const S = state()
  const [f, setF] = useState("all")
  const sets: Record<string, (r: any) => boolean> = {
    all: () => true,
    open: (r) => !!STATES[r.state]?.open,
    attention: (r) => !!STATES[r.state]?.decide,
    received: (r) => r.state === "filed",
    closed: (r) => ["cancelled", "expired", "locked"].includes(r.state),
  }
  const list = S.requests.filter(sets[f]).slice().reverse()
  const n = (k: string) => S.requests.filter(sets[k]).length
  return (
    <AppShell crumbs={<span className="font-medium">Requests</span>}>
      <PageHeader title="Requests" description="Every document you asked for, and where it stands." />
      <Tabs value={f} onValueChange={setF}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="all">All {n("all")}</TabsTrigger>
          <TabsTrigger value="open">Open {n("open")}</TabsTrigger>
          <TabsTrigger value="attention">Needs attention {n("attention")}</TabsTrigger>
          <TabsTrigger value="received">Received {n("received")}</TabsTrigger>
          <TabsTrigger value="closed">Closed {n("closed")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="py-2"><CardContent className="px-2"><RequestsTable list={list} /></CardContent></Card>
    </AppShell>
  )
}
