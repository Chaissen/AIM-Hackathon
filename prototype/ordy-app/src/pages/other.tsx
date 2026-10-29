import { useState } from "react"
import { ArrowRight, Forward, Plus, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { AppShell, PageHeader } from "@/components/app-shell"
import { CheckMark, StatusBadge, ToneBadge } from "@/components/status"
import { LabTable, RehabView } from "@/components/results"
import { RequestsTable } from "@/pages/requests"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { BASE_URL, DOC_TYPES, EHVD, EVENTS, EVENT_LABEL, PATIENTS, fmtD, fmtDT, fmtDur, fmtISOd, lookupPerson, metrics, nameKey, now, pName, patient, state } from "@/lib/api"
import { go, isAdmin, mutate, setRole, useStore } from "@/lib/store"

export function PatientsPage() {
  useStore()
  const S = state()
  return (
    <AppShell crumbs={<span className="font-medium">Patients</span>}>
      <PageHeader title="Patients" />
      <Card className="py-2">
        <CardContent className="px-2">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Born</TableHead><TableHead className="text-right">Documents received</TableHead></TableRow></TableHeader>
            <TableBody>
              {PATIENTS.map((p: any) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => go(`patient-${p.id}`)}>
                  <TableCell className="font-medium">{pName(p)}</TableCell>
                  <TableCell>{fmtISOd(p.birthDate)}</TableCell>
                  <TableCell className="text-right">{S.requests.filter((r: any) => r.patientId === p.id && r.state === "filed").length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  )
}

export function PatientPage({ id }: { id: string }) {
  useStore()
  const p = patient(id)
  if (!p) return <PatientsPage />
  const rs = state().requests.filter((r: any) => r.patientId === id)
  const filed = rs.filter((r: any) => r.state === "filed")
  return (
    <AppShell crumbs={<span><a href="#patients" className="text-muted-foreground hover:text-foreground">Patients</a> / <span className="font-medium">{pName(p)}</span></span>}>
      <PageHeader title={pName(p)} description={`Born ${fmtISOd(p.birthDate)} · ${p.address}`}>
        <Button asChild onClick={() => { state().ui.draft = { ...(state().ui.draft ?? {}), docType: "lab-result", patientId: p.id, given: "", family: "", org: "", channel: "email", address: "" } }}>
          <a href="#new"><Plus /> Request a document</a>
        </Button>
      </PageHeader>
      {filed.map((r: any) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle>{DOC_TYPES[r.docType].label}</CardTitle>
            <CardDescription>From {r.result.fields["Validated by"] ?? r.result.fields["Written by"]} · received {fmtD(r.filedAt)}</CardDescription>
          </CardHeader>
          <CardContent>{r.result.results ? <LabTable doc={r.result} /> : <RehabView doc={r.result} />}</CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader><CardTitle>Requests</CardTitle></CardHeader>
        <CardContent><RequestsTable list={rs.slice().reverse()} empty="No documents requested for this patient yet." /></CardContent>
      </Card>
    </AppShell>
  )
}

export function ContactsPage() {
  useStore()
  const S = state()
  const admin = isAdmin()
  const seen = new Set<string>()
  const contacts = S.requests.slice().reverse().filter((r: any) => {
    const k = nameKey(`${r.given} ${r.family} ${r.org}`)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return (
    <AppShell crumbs={<span className="font-medium">Contacts</span>}>
      <PageHeader title="Contacts" description="People outside the network you have asked for documents." />
      <Card className="py-2">
        <CardContent className="px-2">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="hidden sm:table-cell">Contact</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {contacts.map((r: any) => {
                const lp = lookupPerson(r.given, r.family, r.org)
                const known = S.bindings.some((b: any) => nameKey(b.given) === nameKey(r.given) && nameKey(b.family) === nameKey(r.family) && nameKey(b.org) === nameKey(r.org))
                return (
                  <TableRow key={r.id}>
                    <TableCell><div className="font-medium">{lp.person ? "Dr. " : ""}{r.given} {r.family}</div><div className="text-xs text-muted-foreground">{r.org}</div></TableCell>
                    <TableCell className="hidden break-all sm:table-cell">{r.address}</TableCell>
                    <TableCell>{known ? <ToneBadge tone="ok">Verified sender</ToneBadge> : <ToneBadge tone="">Not verified yet</ToneBadge>}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => { state().ui.draft = { docType: r.docType, patientId: r.patientId, given: r.given, family: r.family, org: r.org, channel: r.channel, address: r.address }; go("new") }}>Request</Button>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!contacts.length && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No contacts yet. They are added with your first request.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Healthcare directory</CardTitle>
          <CardDescription>Doctors and organisations listed in the eHVD (mock). Used to check who you are asking.</CardDescription>
        </CardHeader>
        <CardContent className="px-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Details</TableHead>
                <TableHead>Status</TableHead>
                {admin && <TableHead className="hidden sm:table-cell">OID</TableHead>}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {EHVD.map((e: any) => {
                const org = e.kind === "person" ? EHVD.find((o: any) => o.id === e.memberof) : null
                const isMe = e.id === "2.999.2.3" || e.id === "2.999.1.3"
                return (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className="font-medium">{e.kind === "person" ? `${e.title} ${e.firstname} ${e.surname}` : e.surname}</div>
                      <div className="text-xs text-muted-foreground">{e.kind === "person" ? org?.surname : e.type}</div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{e.kind === "person" ? e.specialisation : e.mail.split("@")[1]}</TableCell>
                    <TableCell>{e.status === "Aktiv" ? <ToneBadge tone="ok">Active</ToneBadge> : <ToneBadge tone="">Inactive</ToneBadge>}</TableCell>
                    {admin && <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{e.id}</TableCell>}
                    <TableCell className="text-right">
                      {e.kind === "person" && !isMe && (
                        <Button size="sm" variant="outline" onClick={() => { state().ui.draft = { docType: /lab/i.test(e.specialisation) ? "lab-result" : "rehab-report", patientId: "maria-beispiel", given: e.firstname, family: e.surname, org: org?.surname ?? "", channel: "email", address: "" }; go("new") }}>Request</Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  )
}

/* ---------- Demo tools ---------- */

export function OutboxPage() {
  useStore()
  const S = state()
  const emails = S.outbox.filter((m: any) => m.kind === "email").slice().reverse()
  const sms = S.outbox.filter((m: any) => m.kind === "sms").slice().reverse()
  const [sel, setSel] = useState<number | null>(S.ui.msg ?? emails[0]?.id ?? null)
  const m = S.outbox.find((x: any) => x.id === sel)
  const open = (id: number) => { setSel(id); mutate(() => { const x = S.outbox.find((y: any) => y.id === id); if (x) x.read = true; S.ui.msg = id }) }
  const linkify = (msg: any) => {
    const url = BASE_URL + msg.token
    const [a, b] = msg.body.split(url)
    return <>{a}<a className="font-medium text-primary underline underline-offset-2" href={`#portal-${msg.token}`} onClick={() => open(msg.id)}>{url.slice(0, 48)}…</a>{b}</>
  }
  return (
    <AppShell crumbs={<span className="font-medium">Recipient's inbox</span>}>
      <PageHeader title="Recipient's inbox" description="Demo only. This is what the lab or rehab clinic receives. Open a link to answer as them." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="gap-0 overflow-hidden py-0">
          <div className="grid md:grid-cols-[240px_minmax(0,1fr)]">
            <div className="border-b md:border-r md:border-b-0">
              {emails.map((x: any) => (
                <button key={x.id} onClick={() => open(x.id)} className={cn("grid w-full gap-0.5 border-b px-4 py-3 text-left text-sm hover:bg-muted/60", sel === x.id && "bg-muted")}>
                  <span className={cn("truncate", !x.read && "font-semibold")}>{x.to}</span>
                  <span className="truncate text-xs text-muted-foreground">{x.subject} · {fmtDT(x.at)}</span>
                </button>
              ))}
              {!emails.length && <p className="p-4 text-sm text-muted-foreground">No email yet.</p>}
            </div>
            <div className="grid content-start gap-4 p-5 text-sm">
              {m && m.kind === "email" ? (
                <>
                  <div className="grid gap-0.5"><span className="font-semibold">{m.subject}</span><span className="text-muted-foreground">To {m.to} · {fmtDT(m.at)}</span></div>
                  <p className="leading-relaxed whitespace-pre-wrap break-words">{linkify(m)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild><a href={`#portal-${m.token}`}>Open the request</a></Button>
                    {!m.forwarded && (
                      <Button variant="outline" onClick={() => { mutate(() => S.outbox.push({ ...m, id: S.outbox.length + 1, to: "kollege@labor-kanal.example", subject: `Fwd: ${m.subject}`, body: `Can you answer this one for me?\n\n${m.body}`, at: now(), read: false, forwarded: true })); toast("Forwarded to a colleague") }}>
                        <Forward /> Forward to a colleague
                      </Button>
                    )}
                  </div>
                </>
              ) : <p className="text-muted-foreground">Choose an email.</p>}
            </div>
          </div>
        </Card>
        <Card className="mx-auto w-full max-w-[300px] rounded-[2rem] border-4">
          <CardHeader className="text-center"><CardTitle className="text-sm">Text messages</CardTitle><CardDescription>+43 660 000 0101</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {sms.map((x: any) => <div key={x.id} className="min-w-0 rounded-2xl rounded-bl-sm bg-muted p-3 text-sm leading-snug [overflow-wrap:anywhere]">{linkify(x)}<div className="mt-1 text-xs text-muted-foreground">{fmtDT(x.at)}</div></div>)}
            {!sms.length && <p className="text-center text-sm text-muted-foreground">No messages.</p>}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}


function AdminOnly({ title }: { title: string }) {
  return (
    <AppShell crumbs={<span className="font-medium">{title}</span>}>
      <Card>
        <CardContent className="grid justify-items-center gap-3 py-10 text-center text-sm">
          <ShieldAlert className="size-6 text-muted-foreground" />
          <div className="font-medium">{title} is for admins</div>
          <p className="text-muted-foreground">Switch to the admin view to see it.</p>
          <Button size="sm" variant="outline" onClick={() => setRole("admin")}>Switch to admin</Button>
        </CardContent>
      </Card>
    </AppShell>
  )
}

export function AuditPage() {
  useStore()
  const S = state()
  const [f, setF] = useState("all")
  if (!isAdmin()) return <AdminOnly title="Audit log" />
  const list = S.audit.filter((a: any) => f === "all" || a.event === f).slice().reverse()
  return (
    <AppShell crumbs={<span className="font-medium">Audit log</span>}>
      <PageHeader title="Audit log" description="Who did what and when, for every request. Document contents are never stored here.">
        <Select value={f} onValueChange={setF}>
          <SelectTrigger className="w-52" aria-label="Filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {EVENTS.map((e: string) => <SelectItem key={e} value={e}>{EVENT_LABEL[e]}</SelectItem>)}
          </SelectContent>
        </Select>
      </PageHeader>
      <Card className="py-2">
        <CardContent className="px-2">
          <Table>
            <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Event</TableHead><TableHead>Who</TableHead><TableHead className="hidden lg:table-cell">Details</TableHead></TableRow></TableHeader>
            <TableBody>
              {list.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDT(a.at)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2"><CheckMark res={a.event === "misdelivery_caught" || a.outcome === "fail" ? "fail" : a.outcome === "hold" ? "hold" : "pass"} />{EVENT_LABEL[a.event]}</div>
                    {a.requestId && <a href={`#r-${a.requestId}`} className="text-xs text-muted-foreground hover:underline">Request {a.requestId}</a>}
                  </TableCell>
                  <TableCell className="max-w-56 truncate">{String(a.actor).replace(/\s*\(.*\)$/, "")}</TableCell>
                  <TableCell className="hidden max-w-md whitespace-normal text-muted-foreground lg:table-cell">{a.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  )
}

export function MetricsPage() {
  useStore()
  if (!isAdmin()) return <AdminOnly title="Metrics" />
  const m = metrics()
  const tiles = [
    { label: "FHIR errors", value: String(m.errCount), ok: m.errCount === 0 && m.bundles > 0, note: `${m.resCount} resources, target 0` },
    { label: "Time for the sender", value: fmtDur(m.effort), ok: m.effort != null && m.effort < 120000, note: "No install, no account, target under 2:00" },
    { label: "Wrong deliveries caught", value: `${m.mCount} of 3`, ok: m.mCount === 3, note: "Tests M1 to M3" },
    { label: "Audit coverage", value: `${m.cov} of 6`, ok: m.cov === 6, note: "Steps logged" },
  ]
  const tests = [
    { id: "M1", name: "Wrong email address", ok: m.m1Full, how: "A typo in the address is flagged. The stranger who opens it sees nothing." },
    { id: "M2", name: "Forwarded to a colleague", ok: m.m2, how: "The colleague logs in and is turned away." },
    { id: "M3", name: "Document for another patient", ok: m.m3, how: "Nothing is saved and the doctor is told." },
  ]
  return (
    <AppShell crumbs={<span className="font-medium">Metrics</span>}>
      <PageHeader title="Metrics" description="The hackathon targets, measured live on this demo." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="gap-1 py-5">
            <CardHeader className="px-5">
              <CardDescription>{t.label}</CardDescription>
              <CardTitle className={cn("text-3xl font-semibold", t.ok && "text-emerald-600 dark:text-emerald-400")}>{t.value}</CardTitle>
              <p className="text-xs text-muted-foreground">{t.note}</p>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Wrong-delivery tests</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {tests.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-4 rounded-md border p-3 text-sm">
              <div><div className="font-medium">{t.id} · {t.name}</div><div className="text-muted-foreground">{t.how}</div></div>
              {t.ok ? <ToneBadge tone="ok">Caught</ToneBadge> : <ToneBadge tone="">Not run yet</ToneBadge>}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Try it yourself</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>1. Open the <a className="text-primary underline" href="#outbox">recipient's inbox</a> and the text message to Stefan Kern.</p>
          <p>2. Log in as Stefan Kern and send the rehab report.</p>
          <p>3. Come back here or open the request to see it arrive. <a className="inline-flex items-center gap-1 text-primary underline" href="#requests">Requests <ArrowRight className="size-3" /></a></p>
        </CardContent>
      </Card>
      {state().requests.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Per request</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {state().requests.map((r: any) => (
              <a key={r.id} href={`#r-${r.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                <span>Request {r.id} · {DOC_TYPES[r.docType].label} · {r.given} {r.family}</span>
                <span className="flex items-center gap-3">{r.effort != null && <span className="text-muted-foreground">{fmtDur(r.effort)}</span>}<StatusBadge state={r.state} /></span>
              </a>
            ))}
          </CardContent>
        </Card>
      )}
    </AppShell>
  )
}
