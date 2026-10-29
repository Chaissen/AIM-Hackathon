"use client";

import { Mail, MessageSquare } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DOCUMENT_TYPES, documentTypeKeys, type DocumentType } from "@/lib/document-types";
import { requestInput } from "@/lib/request-input";
import { cn } from "@/lib/utils";

export type PatientOption = { id: string; name: string; birthDate: string | null };

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function RequestForm({ patients }: { patients: PatientOption[] | null }) {
  const [docType, setDocType] = useState<DocumentType>("lab-result");
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [form, setForm] = useState({ patient: patients?.[0]?.id ?? "", given: "", family: "", org: "", contact: "" });
  const [touched, setTouched] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const parsed = requestInput.safeParse({
    docType,
    patient: form.patient,
    given: form.given,
    family: form.family,
    org: form.org,
    email: channel === "email" && form.contact ? form.contact : undefined,
    phone: channel === "sms" && form.contact ? form.contact : undefined,
  });
  const errors = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
  const err = (k: string) => (touched ? errors[k] : undefined);

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">What do you need?</legend>
        <RadioGroup
          value={docType}
          onValueChange={(v) => {
            setDocType(v as DocumentType);
            setChannel(DOCUMENT_TYPES[v as DocumentType].channel);
          }}
          className="grid gap-2"
        >
          {documentTypeKeys.map((k) => (
            <Label
              key={k}
              htmlFor={`doc-${k}`}
              className={cn("flex cursor-pointer items-center gap-3 rounded-md border p-3 font-normal", docType === k && "border-primary bg-primary/5")}
            >
              <RadioGroupItem id={`doc-${k}`} value={k} />
              {DOCUMENT_TYPES[k].label}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor="patient">Patient</Label>
        {patients === null ? (
          <Alert variant="destructive">
            <AlertDescription>The FHIR server is not reachable, so the patient list is empty.</AlertDescription>
          </Alert>
        ) : (
          <select
            id="patient"
            value={form.patient}
            onChange={set("patient")}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.birthDate ? `, born ${formatDate(p.birthDate)}` : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Who should send it?</legend>
        <p className="-mt-1 text-xs text-muted-foreground">Only this person can open the request. A colleague cannot answer for them.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field id="given" label="First name" value={form.given} onChange={set("given")} error={err("given")} />
          <Field id="family" label="Last name" value={form.family} onChange={set("family")} error={err("family")} />
        </div>
        <Field id="org" label="Organisation" value={form.org} onChange={set("org")} error={err("org")} />
        <div className="grid gap-2">
          <span className="text-sm font-medium">Send the link by</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={channel === "email" ? "default" : "outline"} onClick={() => setChannel("email")}>
              <Mail /> Email
            </Button>
            <Button type="button" size="sm" variant={channel === "sms" ? "default" : "outline"} onClick={() => setChannel("sms")}>
              <MessageSquare /> SMS
            </Button>
          </div>
          <Input
            id="contact"
            aria-label={channel === "email" ? "Email address" : "Mobile number"}
            placeholder={channel === "email" ? "name@example.org" : "+43 660 000 0101"}
            value={form.contact}
            onChange={set("contact")}
            aria-invalid={!!(err("email") ?? err("phone"))}
            autoComplete="off"
          />
          {(err("email") ?? err("phone")) && <p className="text-xs text-destructive">{err("email") ?? err("phone")}</p>}
        </div>
      </fieldset>

      <p className="text-xs text-muted-foreground">
        The {channel === "email" ? "email" : "SMS"} names you and the clinic. It never names the patient, the birth date, or the document.
      </p>

      <Button type="submit">Send request</Button>
      {/* TODO(T04, T05): call the request procedure here. */}
      {touched && parsed.success && <p className="text-sm text-muted-foreground">Sending from the widget is not connected yet.</p>}
    </form>
  );
}

function Field({ id, label, error, ...input }: { id: string; label: string; error?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={!!error} autoComplete="off" {...input} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
