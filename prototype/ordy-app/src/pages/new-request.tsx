import { useState } from "react"
import { ChevronDown, Mail, MessageSquare, Send, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { AppShell, PageHeader } from "@/components/app-shell"
import { CheckMark } from "@/components/status"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { DOC_TYPES, EHVD, PATIENTS, addressCheck, buildMessage, contentCheck, createRequest, fmtISOd, lookupPerson, nameKey, pName, patient, state } from "@/lib/api"
import { go, mutate, useStore } from "@/lib/store"

type Draft = { docType: string; patientId: string; given: string; family: string; org: string; channel: string; address: string }

const EXAMPLES: Record<string, { label: string; d: Draft }> = {
  r1: { label: "Lab result from Dr. Brandl", d: { docType: "lab-result", patientId: "maria-beispiel", given: "Eva", family: "Brandl", org: "Labor Kanalstraße", channel: "email", address: "eva.brandl@labor-kanal.example" } },
  r2: { label: "Rehab report from Stefan Kern", d: { docType: "rehab-report", patientId: "maria-beispiel", given: "Stefan", family: "Kern", org: "Reha Waldblick", channel: "sms", address: "+43 660 000 0101" } },
  m1: { label: "Typo in the email address (test M1)", d: { docType: "lab-result", patientId: "maria-beispiel", given: "Eva", family: "Brandl", org: "Labor Kanalstraße", channel: "email", address: "eva.brandl@labor-kanaI.example" } },
}

const DESCRIBE: Record<string, string> = {
  "lab-result": "Blood tests and other lab values. Must come from the lab physician.",
  "rehab-report": "The discharge report after a rehab stay.",
}

export function NewRequestPage() {
  useStore()
  const [d, setD] = useState<Draft>(() => state().ui.draft ?? { ...EXAMPLES.r1.d })
  // The preview needs an expiry date; take the time once instead of on every render.
  const [previewNow] = useState(() => Date.now())
  const set = (patch: Partial<Draft>) => { const next = { ...d, ...patch }; setD(next); state().ui.draft = next }

  const lp = lookupPerson(d.given, d.family, d.org)
  const ac = addressCheck(d)
  const p = patient(d.patientId)
  const msg = buildMessage({ token: "…", expiresAt: previewNow + 7 * 864e5, channel: d.channel })
  const clean = contentCheck(`${msg.subject ?? ""} ${msg.body}`, p).every((c: any) => c.ok)
  const missing = (["given", "family", "org", "address"] as const).filter((k) => !d[k].trim())
  const knownBefore = state().bindings.some((b: any) => nameKey(b.given) === nameKey(d.given) && nameKey(b.family) === nameKey(d.family) && nameKey(b.org) === nameKey(d.org))

  // What we can confirm about the recipient, in plain words
  const checks: { res: string; text: string }[] = []
  if (d.org.trim()) checks.push(lp.org ? { res: "pass", text: `${lp.org.surname} is in the healthcare directory` } : { res: "hold", text: `${d.org} is not in the healthcare directory. You will check the answer yourself.` })
  if (d.given.trim() && d.family.trim()) {
    if (lp.person && lp.member) checks.push({ res: "pass", text: `${lp.person.title} ${lp.person.firstname} ${lp.person.surname} works there (${lp.person.specialisation.toLowerCase()})` })
    else if (d.docType === "lab-result") checks.push({ res: "hold", text: `${d.given} ${d.family} is not listed as a lab physician there. You will check the answer yourself.` })
  }
  if (knownBefore) checks.push({ res: "pass", text: `${d.given} ${d.family} has sent you documents before` })
  if (ac.kind === "match") checks.push({ res: "pass", text: "The email address belongs to this organisation" })

  const send = () => {
    const r = mutate(() => createRequest({ ...d }))
    state().ui.draft = null
    toast(r.state === "sent" ? `Sent to ${d.given} ${d.family}` : "Saved. Check the email address before it goes out.")
    go(`r-${r.id}`)
  }

  return (
    <AppShell
      crumbs={<span className="font-medium">New request</span>}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Wand2 /> Examples</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {Object.entries(EXAMPLES).map(([k, e]) => <DropdownMenuItem key={k} onSelect={() => set(e.d)}>{e.label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <PageHeader title="New request" description="Ask someone outside the network for a document. They answer in their browser, no account needed." />

      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader><CardTitle>Which patient?</CardTitle></CardHeader>
          <CardContent>
            <Select value={d.patientId} onValueChange={(v) => set({ patientId: v })}>
              <SelectTrigger className="w-full" aria-label="Patient"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PATIENTS.map((x: any) => <SelectItem key={x.id} value={x.id}>{pName(x)} · born {fmtISOd(x.birthDate)}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>What do you need?</CardTitle></CardHeader>
          <CardContent>
            <RadioGroup value={d.docType} onValueChange={(v) => set({ docType: v, channel: DOC_TYPES[v].channel })} className="grid gap-3 sm:grid-cols-2">
              {Object.keys(DOC_TYPES).map((k) => (
                <Label key={k} htmlFor={`dt-${k}`} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal", d.docType === k && "border-primary bg-primary/5")}>
                  <RadioGroupItem id={`dt-${k}`} value={k} className="mt-0.5" />
                  <span className="grid gap-1"><span className="font-medium">{DOC_TYPES[k].label}</span><span className="text-sm text-muted-foreground">{DESCRIBE[k]}</span></span>
                </Label>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Who should send it?</CardTitle>
            <CardDescription>Only this person can open the request. A colleague cannot answer for them.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="given">First name</Label><Input id="given" value={d.given} onChange={(e) => set({ given: e.target.value })} autoComplete="off" /></div>
              <div className="grid gap-2"><Label htmlFor="family">Last name</Label><Input id="family" value={d.family} onChange={(e) => set({ family: e.target.value })} autoComplete="off" /></div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="org">Where do they work?</Label>
              <Input id="org" list="orgs" value={d.org} onChange={(e) => set({ org: e.target.value })} autoComplete="off" />
              <datalist id="orgs">{EHVD.filter((e: any) => e.kind === "org").map((e: any) => <option key={e.id} value={e.surname} />)}</datalist>
            </div>
            <div className="grid gap-2">
              <Label>How should we reach them?</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={d.channel === "email" ? "default" : "outline"} onClick={() => set({ channel: "email" })}><Mail /> Email</Button>
                <Button type="button" size="sm" variant={d.channel === "sms" ? "default" : "outline"} onClick={() => set({ channel: "sms" })}><MessageSquare /> Text message</Button>
              </div>
              <Input id="address" aria-label={d.channel === "email" ? "Email address" : "Mobile number"} placeholder={d.channel === "email" ? "name@example.org" : "+43 …"} value={d.address} onChange={(e) => set({ address: e.target.value })} autoComplete="off" />
            </div>
            {ac.kind === "mismatch" && (
              <Alert variant="destructive">
                <AlertTitle>This email address looks wrong</AlertTitle>
                <AlertDescription>{d.org} uses @{ac.exp}, but you typed @{ac.got}{ac.diff ? ` (${ac.diff})` : ""}. Check it before sending.</AlertDescription>
              </Alert>
            )}
            {checks.length > 0 && (
              <ul className="grid gap-2 text-sm">
                {checks.map((c) => <li key={c.text} className="flex gap-2"><CheckMark res={c.res} />{c.text}</li>)}
              </ul>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t">
            <Collapsible className="min-w-0">
              <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="-ml-2">Preview the {d.channel === "email" ? "email" : "text message"} <ChevronDown /></Button></CollapsibleTrigger>
              <CollapsibleContent className="grid gap-2 pt-2">
                <div className="rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">{msg.subject ? `${msg.subject}\n\n` : ""}{msg.body}</div>
                {clean && <p className="text-xs text-muted-foreground">No patient name, birth date or document type is included.</p>}
              </CollapsibleContent>
            </Collapsible>
            <Button onClick={send} disabled={missing.length > 0 || !clean}><Send /> Send request</Button>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  )
}
