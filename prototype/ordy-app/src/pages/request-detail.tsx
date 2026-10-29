import { useState } from "react"
import { ChevronDown, FileX2, Mail, MessageSquare } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/app-shell"
import { CheckMark, StatusBadge, Steps } from "@/components/status"
import { LabTable, RehabView } from "@/components/results"
import { DecisionItem } from "@/pages/requests"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { DOC_TYPES, STATES, act, fmtD, fmtDT, fmtISOd, pName, patient, recipientLabel, req, state } from "@/lib/api"
import { isAdmin, mutate, useStore } from "@/lib/store"

/** Turn audit entries into sentences a doctor reads at a glance. */
function storyOf(r: any) {
  const who = (a: any) => String(a.actor).replace(/\s*\(.*\)$/, "")
  return state().audit.filter((a: any) => a.requestId === r.id).map((a: any) => {
    const t = (() => {
      switch (a.event) {
        case "request_sent": return { text: `Sent by ${r.channel === "email" ? "email" : "text message"} to ${r.address}`, tone: "pass" }
        case "link_opened": return { text: "Someone opened the link", tone: "none" }
        case "identity_checked":
          if (a.actorKind === "doctor") return { text: "You confirmed the sender", tone: "pass" }
          return a.outcome === "pass" ? { text: `${who(a)} confirmed who they are with ID Austria`, tone: "pass" }
            : a.outcome === "hold" ? { text: `${who(a)} logged in, but the name only partly matches`, tone: "hold" }
            : { text: `${who(a)} tried to open it and was turned away`, tone: "fail" }
        case "answer_sent": return { text: `${who(a)} sent a document`, tone: "none" }
        case "answer_filed": return { text: "Added to the patient record", tone: "pass" }
        case "misdelivery_caught":
          return a.outcome === "address_mismatch" ? { text: "Held back: the email address looked wrong", tone: "hold" }
            : a.outcome === "wrong_person" ? { text: "Blocked: this was not the person you asked", tone: "fail" }
            : { text: "Blocked: the document was about a different patient", tone: "fail" }
      }
      return { text: a.event, tone: "none" }
    })()
    return { ...t, at: a.at, key: a.id }
  })
}

export function RequestPage({ id }: { id: number }) {
  useStore()
  const r = req(id)
  const [tech, setTech] = useState(false)
  const [sel, setSel] = useState(0)
  if (!r) {
    return (
      <AppShell crumbs="Request">
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">This request does not exist. <a className="underline" href="#requests">Back to requests</a></CardContent></Card>
      </AppShell>
    )
  }
  const p = patient(r.patientId)
  const dt = DOC_TYPES[r.docType]
  const doc = r.state === "filed" ? r.result : r.state === "answer_held" ? r.pendingAnswer?.doc : null
  const rejected = r.answers.filter((a: any) => a.outcome === "patient_mismatch").length
  const msg = state().outbox.find((m: any) => m.requestId === r.id && !m.forwarded)
  const story = storyOf(r).reverse()
  const run = (op: string, label: string) => { mutate(() => act[op](r)); toast(label) }

  return (
    <AppShell
      crumbs={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink href="#requests">Requests</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{dt.label} · {pName(p)}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{dt.label} for {pName(p)}</h1>
            <StatusBadge state={r.state} />
          </div>
          <p className="text-sm text-muted-foreground">
            Asked from {recipientLabel(r)}, {r.org} · {fmtDT(r.createdAt)}
          </p>
        </div>
        {STATES[r.state]?.open && !STATES[r.state]?.decide && (
          <Button variant="outline" onClick={() => run("cancel", "Request cancelled")}>Cancel request</Button>
        )}
      </div>

      {STATES[r.state]?.decide && <DecisionItem r={r} />}

      <Card><CardContent><Steps r={r} /></CardContent></Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>{doc ? doc.title?.split(":")[1]?.trim().replace(/^\w/, (c: string) => c.toUpperCase()) || "Document" : "Document"}</CardTitle>
            {doc && <CardDescription>{doc.fields["Sample taken"] ? `Sample taken ${doc.fields["Sample taken"]}` : doc.fields["Written by"]}</CardDescription>}
          </CardHeader>
          <CardContent className="grid gap-4">
            {doc ? (doc.results ? <LabTable doc={doc} /> : <RehabView doc={doc} />) : (
              <div className="grid justify-items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                <FileX2 className="size-6" />
                {r.state === "cancelled" || r.state === "expired" || r.state === "locked" ? "This request is closed." : `The document appears here once ${recipientLabel(r)} has sent it.`}
              </div>
            )}
            {rejected > 0 && (
              <Alert>
                <FileX2 />
                <AlertTitle>A document for another patient was stopped</AlertTitle>
                <AlertDescription>It was not saved. The sender was asked to upload the right file.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent>
              <ol className="grid gap-3">
                {story.map((s: any) => (
                  <li key={s.key} className="grid grid-cols-[20px_1fr] gap-3 text-sm">
                    <CheckMark res={s.tone} />
                    <div><div>{s.text}</div><div className="text-xs text-muted-foreground">{fmtDT(s.at)}</div></div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">Patient</dt><dd><a className="underline-offset-4 hover:underline" href={`#patient-${p.id}`}>{pName(p)}</a>, {fmtISOd(p.birthDate)}</dd>
                <dt className="text-muted-foreground">Sent to</dt><dd className="break-all">{r.address}</dd>
                <dt className="text-muted-foreground">Link valid until</dt><dd>{fmtD(r.expiresAt)}</dd>
              </dl>
              {msg && (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="-ml-2 w-fit">{r.channel === "email" ? <Mail /> : <MessageSquare />} See the message we sent <ChevronDown /></Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid gap-2 pt-2">
                    <div className="rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">{msg.subject ? `${msg.subject}\n\n` : ""}{msg.body}</div>
                    <p className="text-xs text-muted-foreground">It does not mention the patient or what you asked for.</p>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {isAdmin() && (
      <Collapsible open={tech} onOpenChange={setTech}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-fit text-muted-foreground">Technical details <ChevronDown className={tech ? "rotate-180" : ""} /></Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-6 pt-3">
          <Card>
            <CardHeader><CardTitle>Identity checks</CardTitle><CardDescription>Rules for this document: {dt.checks.join(" · ")}</CardDescription></CardHeader>
            <CardContent className="grid gap-4">
              {r.attempts.length ? r.attempts.slice().reverse().map((a: any) => (
                <div key={a.at} className="grid gap-2 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{a.name}</span><span className="text-muted-foreground">{fmtDT(a.at)}</span></div>
                  {a.checks.map((c: any) => <div key={c.name} className="flex gap-2"><CheckMark res={c.res} /><span><span className="font-medium">{c.name}</span> <span className="text-muted-foreground">{c.why}</span></span></div>)}
                </div>
              )) : <p className="text-sm text-muted-foreground">Nobody has logged in yet.</p>}
            </CardContent>
          </Card>
          {r.bundle && (
            <Card>
              <CardHeader>
                <CardTitle>FHIR bundle</CardTitle>
                <CardDescription>{r.bundle.entry.length} resources · {r.bundleErrors.length ? `${r.bundleErrors.length} structure errors` : "no structure errors"} · Task/request-{r.id}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
                <div className="flex flex-wrap gap-1 md:flex-col">
                  {r.bundle.entry.map((e: any, i: number) => (
                    <Button key={i} size="sm" variant={i === sel ? "secondary" : "ghost"} className="justify-start" onClick={() => setSel(i)}>{e.resource.resourceType}</Button>
                  ))}
                </div>
                <pre className="max-h-[480px] overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(r.bundle.entry[Math.min(sel, r.bundle.entry.length - 1)].resource, null, 2)}</pre>
              </CardContent>
            </Card>
          )}
        </CollapsibleContent>
      </Collapsible>
      )}
    </AppShell>
  )
}
