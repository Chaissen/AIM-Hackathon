import { useEffect, useState } from "react"
import { CircleCheck, FileUp, Lock, ShieldCheck } from "lucide-react"
import { Logo } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { CLINIC, DOC_TYPES, ME, SAMPLE_DOCS, citizens, fmtD, fmtDur, fmtISOd, linkStatus, login, openLink, pName, parseDoc, patient, reqByToken, state, submitAnswer, uuid } from "@/lib/api"
import { mutate, useStore } from "@/lib/store"

function Frame({ who, children }: { who?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <Logo />
          <span className="ml-auto truncate text-sm text-muted-foreground">{who ? `Logged in as ${who}` : CLINIC.name}</span>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-xl flex-1 content-start gap-4 px-4 py-8">{children}</main>
      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground">
        <a className="underline" href="#outbox">Back to the demo</a>
      </footer>
    </div>
  )
}

function Message({ title, text, who, action }: { title: string; text: string; who?: string; action?: React.ReactNode }) {
  return (
    <Frame who={who}>
      <Card>
        <CardHeader><CardTitle className="text-xl">{title}</CardTitle><CardDescription className="text-base">{text}</CardDescription></CardHeader>
        {action && <CardFooter>{action}</CardFooter>}
      </Card>
    </Frame>
  )
}

export function PortalPage({ token }: { token: string }) {
  useStore()
  const r = reqByToken(token)
  const st = linkStatus(r)
  const S = state()

  // Write link_opened once per session; "open" already implies that the request exists.
  const opened = !!S.sessions[token]?.openedAt
  useEffect(() => {
    if (st === "open" && !opened) mutate(() => openLink(token))
  }, [token, st, opened])

  if (st === "invalid") return <Message title="This link does not work" text="Check that you copied the whole link from the message." />
  if (st === "filed") return <Message title="Already answered" text="Thank you. There is nothing more to do." />
  if (st === "cancelled" || st === "expired") return <Message title="This link has expired" text="Contact the person who sent it if you still want to help." />
  if (st === "locked") return <Message title="This link is locked" text="Too many wrong logins. Contact the person who sent it." />
  if (st === "awaiting_confirmation") return <Message title="Not ready yet" text="Please try again later." />

  const ses = S.sessions[token] ?? { step: "landing" }
  const c = citizens().find((x: any) => x.u === ses.citizen)
  const who = c ? `${c.given} ${c.family}` : undefined
  const setStep = (step: string) => mutate(() => { S.sessions[token] = { ...(S.sessions[token] ?? {}), step } })
  const logout = () => mutate(() => { delete S.sessions[token] })

  if (ses.step === "idp") return <IdAustria token={token} />
  if (ses.step === "refused") return <Message who={who} title="This request is for someone else" text="Nothing was shared with you. The sender has been told." action={<Button variant="outline" onClick={logout}>Log out</Button>} />
  if (ses.step === "waiting") {
    if (r.state === "verified") { setStep("answer"); return null }
    return <Message who={who} title="Waiting for confirmation" text={`Dr. ${ME.family} needs to confirm it is you. Come back to this link later.`} action={<Button variant="outline" onClick={() => mutate(() => {})}>Check again</Button>} />
  }
  if (ses.step === "done" || ses.step === "done-held") {
    return (
      <Frame who={who}>
        <Card>
          <CardHeader className="justify-items-center text-center">
            <CircleCheck className="size-10 text-emerald-600" />
            <CardTitle className="text-xl">Sent. Thank you!</CardTitle>
            <CardDescription className="text-base">{ses.step === "done" ? `Dr. ${ME.family} has received it.` : `Dr. ${ME.family} will check it shortly.`} You can close this page.</CardDescription>
            {r.effort != null && <p className="text-sm text-muted-foreground">It took you {fmtDur(r.effort)}.</p>}
          </CardHeader>
        </Card>
      </Frame>
    )
  }
  if (ses.step === "answer") return <Answer token={token} who={who} />

  return (
    <Frame>
      <Card>
        <CardHeader className="gap-2">
          <CardDescription>Secure request</CardDescription>
          <CardTitle className="text-xl leading-snug">Dr. {ME.given} {ME.family} from {CLINIC.name} has asked you for a document</CardTitle>
          <CardDescription className="text-base">Log in with ID Austria to see what is needed. You do not need an account or an app.</CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-wrap items-center justify-between gap-3">
          <Button size="lg" onClick={() => setStep("idp")}><ShieldCheck /> Log in with ID Austria</Button>
          <span className="text-sm text-muted-foreground">Valid until {fmtD(r.expiresAt)}</span>
        </CardFooter>
      </Card>
      <p className="px-1 text-sm text-muted-foreground">Not expecting this? You can close the page. Only the person it was meant for can open it.</p>
    </Frame>
  )
}

function IdAustria({ token }: { token: string }) {
  const S = state()
  const ses = S.sessions[token]
  const [u, setU] = useState(ses.pick ?? "")
  const [pw, setPw] = useState(citizens().find((x: any) => x.u === ses.pick)?.pw ?? "")
  const [err, setErr] = useState("")
  const [nc, setNc] = useState({ given: "", family: "", birth: "1985-01-01" })
  const pick = (x: any) => { setU(x.u); setPw(x.pw); setErr("") }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const c = citizens().find((x: any) => x.u === u.trim())
    if (!c || c.pw !== pw) { setErr("Username or password is wrong. Pick a test person to fill both."); return }
    mutate(() => login(token, c.u))
  }
  return (
    <Frame>
      <Card className="overflow-hidden pt-0">
        <div className="flex items-center justify-between bg-foreground px-6 py-3 text-background">
          <span className="font-semibold">ID Austria</span>
          <span className="text-xs opacity-75">Simulation</span>
        </div>
        <CardHeader>
          <CardTitle>Log in</CardTitle>
          <CardDescription>ordy will receive your name and birth date.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label>Test people</Label>
            <div className="grid gap-1.5">
              {citizens().map((x: any) => (
                <button key={x.u} type="button" onClick={() => pick(x)} className={cn("flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/60", u === x.u && "border-primary bg-primary/5")}>
                  <Avatar className="size-7"><AvatarFallback className="text-xs">{x.given[0]}{x.family[0]}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1"><span className="block font-medium">{x.given} {x.family}</span><span className="block truncate text-xs text-muted-foreground">{x.plays}</span></span>
                </button>
              ))}
            </div>
          </div>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="idp-u">Username</Label><Input id="idp-u" value={u} onChange={(e) => setU(e.target.value)} autoComplete="off" /></div>
              <div className="grid gap-2"><Label htmlFor="idp-p">Password</Label><Input id="idp-p" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
            </div>
            {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
            <div className="flex gap-2">
              <Button type="submit">Log in</Button>
              <Button type="button" variant="ghost" onClick={() => mutate(() => { ses.step = "landing" })}>Cancel</Button>
            </div>
          </form>
          <Collapsible>
            <CollapsibleTrigger asChild><Button variant="link" className="h-auto p-0">Create a test person</Button></CollapsibleTrigger>
            <CollapsibleContent className="grid gap-3 pt-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Input aria-label="First name" placeholder="First name" value={nc.given} onChange={(e) => setNc({ ...nc, given: e.target.value })} />
                <Input aria-label="Last name" placeholder="Last name" value={nc.family} onChange={(e) => setNc({ ...nc, family: e.target.value })} />
                <Input aria-label="Birth date" type="date" value={nc.birth} onChange={(e) => setNc({ ...nc, birth: e.target.value })} />
              </div>
              <Button variant="outline" size="sm" className="w-fit" disabled={!nc.given.trim() || !nc.family.trim()} onClick={() => {
                const x = { u: `${nc.given}.${nc.family}`.toLowerCase().replace(/[^a-z.]/g, "") + (S.citizens.length + 1), pw: "demo", given: nc.given.trim(), family: nc.family.trim(), birthdate: nc.birth, sub: uuid(), level: "full", plays: "Created by you" }
                mutate(() => { S.citizens.push(x) }); pick(x)
              }}>Create and select</Button>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </Frame>
  )
}

function Answer({ token, who }: { token: string; who?: string }) {
  const S = state()
  const ses = S.sessions[token]
  const r = reqByToken(token)
  const p = patient(r.patientId)
  const doc = ses.file ? parseDoc(ses.file.md) : null
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)

  const setFile = (name: string, md: string) => mutate(() => { ses.file = { name, md }; ses.error = null })
  const read = (f?: File) => { if (!f) return; const fr = new FileReader(); fr.onload = () => setFile(f.name, String(fr.result)); fr.readAsText(f) }
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ses.file) return
    if (!ses.formName?.trim() || !ses.formDob) { mutate(() => { ses.error = "Enter the patient's name and birth date." }); return }
    setBusy(true)
    const res = await mutate(() => submitAnswer(token, { md: ses.file.md, fileName: ses.file.name, formName: ses.formName, formDob: ses.formDob }))
    mutate(() => { if (!res.ok) { ses.error = res.error; if (res.mismatch) ses.file = null } else ses.error = null })
    setBusy(false)
  }

  return (
    <Frame who={who}>
      <Card>
        <CardHeader className="gap-2">
          <CardDescription>Dr. {ME.given} {ME.family}, {CLINIC.name} asks for</CardDescription>
          <CardTitle className="text-xl leading-snug">{DOC_TYPES[r.docType].label} for {pName(p)}, born {fmtISOd(p.birthDate)}</CardTitle>
          <CardDescription className="text-base">{r.docType === "lab-result" ? "The latest blood clotting tests, before a planned procedure." : "The discharge report from the rehab stay."}</CardDescription>
        </CardHeader>
      </Card>

      <form onSubmit={send} className="grid gap-4">
        <Card>
          <CardHeader><CardTitle>1. Add the document</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <label
              htmlFor="file"
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files[0]) }}
              className={cn("grid cursor-pointer justify-items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm", drag ? "border-primary bg-primary/5" : "bg-muted/40")}
            >
              <FileUp className="size-6 text-muted-foreground" />
              <span className="font-medium">{ses.file ? ses.file.name : "Drop the file here or click to choose"}</span>
              {doc?.fields.Patient && <span className="text-muted-foreground">Patient in file: {doc.fields.Patient}</span>}
              <input id="file" type="file" accept=".md,.txt,text/markdown,text/plain" className="sr-only" onChange={(e) => read(e.target.files?.[0])} />
            </label>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Test files:</span>
              {Object.keys(SAMPLE_DOCS).map((k) => (
                <Button key={k} type="button" size="sm" variant="outline" onClick={() => setFile(k, SAMPLE_DOCS[k])}>
                  {k.replace(".md", "").replace(/-/g, " ").replace(/^\w/, (x) => x.toUpperCase())}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Confirm the patient</CardTitle>
            <CardDescription>As written in your document. We check that it is about the right person.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2"><Label htmlFor="pn">Patient name</Label><Input id="pn" value={ses.formName ?? ""} onChange={(e) => mutate(() => { ses.formName = e.target.value })} autoComplete="off" /></div>
            <div className="grid gap-2"><Label htmlFor="pd">Birth date</Label><Input id="pd" type="date" value={ses.formDob ?? ""} onChange={(e) => mutate(() => { ses.formDob = e.target.value })} /></div>
            {doc?.patientName && (
              <Button type="button" variant="link" className="h-auto w-fit p-0 sm:col-span-2" onClick={() => mutate(() => { ses.formName = doc.patientName; ses.formDob = doc.patientDob ?? "" })}>Copy from the file (testing)</Button>
            )}
          </CardContent>
        </Card>

        {ses.error && (
          <Alert variant="destructive"><AlertTitle>{ses.error}</AlertTitle></Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Lock className="size-3.5" /> Sent encrypted, only to Dr. {ME.family}</span>
          <Button size="lg" type="submit" disabled={!ses.file || busy}>Send securely</Button>
        </div>
      </form>
    </Frame>
  )
}
