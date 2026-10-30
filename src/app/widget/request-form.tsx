"use client";

import { skipToken, useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { TRPCClientErrorLike } from "@trpc/client";
import { ChevronDown, CircleAlert, CircleCheck, Mail, MessageSquare, Send, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";

import { CalendarDate } from "@/components/time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DOCUMENT_TYPES, documentTypeKeys, type DocumentType } from "@/lib/document-types";
import { requestInput } from "@/lib/request-input";
import { cn } from "@/lib/utils";
import type { AppRouter } from "@/server/api/root";
import type { ContentCategory } from "@/server/mail/message";
import type { RouterOutputs } from "@/trpc/types";
import { useTRPC } from "@/trpc/react";

import { usePatients } from "./data";
import type { RequestDraft } from "./draft";
import { navigate } from "./use-widget-route";

type Channel = RequestDraft["channel"];
type RecipientCheck = RouterOutputs["request"]["checkRecipient"];
type CheckQuery = UseQueryResult<RecipientCheck, TRPCClientErrorLike<AppRouter>>;
type PreviewQuery = UseQueryResult<RouterOutputs["request"]["preview"], TRPCClientErrorLike<AppRouter>>;

/** The fields Dr. Hofer fills, in the order of the cards. Send waits until none is empty. */
type Field = "patient" | "given" | "family" | "org" | "contact";
const FIELDS: readonly Field[] = ["patient", "given", "family", "org", "contact"];

/** Which field shows a `requestInput` issue. The contact field carries both the email and the phone messages. */
const ISSUE_FIELD: Readonly<Record<string, Field>> = { patient: "patient", given: "given", family: "family", org: "org", email: "contact", phone: "contact" };

const CHANNEL_LABEL: Record<Channel, string> = { email: "email", sms: "SMS" };

const REFUSED_TEXT: Record<ContentCategory, string> = {
  "patient-name": "the patient's name",
  "birth-date": "the patient's birth date",
  "document-type": "the document type",
};

const isDocumentType = (value: string): value is DocumentType => Object.hasOwn(DOCUMENT_TYPES, value);
const isChannel = (value: string): value is Channel => value === "email" || value === "sms";

const toRequestInput = (d: RequestDraft) => ({
  docType: d.docType,
  patient: d.patient,
  given: d.given,
  family: d.family,
  org: d.org,
  email: d.channel === "email" && d.contact ? d.contact : undefined,
  phone: d.channel === "sms" && d.contact ? d.contact : undefined,
});

/** The first `requestInput` message per field. */
function fieldErrors(error: z.ZodError): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of error.issues) {
    const field = ISSUE_FIELD[String(issue.path[0])];
    if (field) errors[field] ??= issue.message;
  }
  return errors;
}

/** The recipient check's input once the organisation and the contact are filled, else nothing to check. */
function checkInput(d: RequestDraft) {
  const org = d.org.trim();
  const address = d.contact.trim();
  if (!org || !address) return null;
  return { given: d.given.trim(), family: d.family.trim(), org, channel: d.channel, address };
}

/** The value as it stood `ms` after the last change. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function RequestForm({ value, onChange, onCreated }: { value: RequestDraft; onChange: (draft: RequestDraft) => void; onCreated: () => void }) {
  const [touched, setTouched] = useState<ReadonlySet<Field>>(() => new Set());
  const [previewOpen, setPreviewOpen] = useState(false);
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // The eHVD is asked 500 ms after typing stops, and only once there is an organisation and an address to check.
  const settled = useSettled(value, 500);
  const check = useQuery(trpc.request.checkRecipient.queryOptions(checkInput(settled) ?? skipToken, { retry: false, staleTime: 5 * 60_000 }));
  const preview = useQuery(
    trpc.request.preview.queryOptions(value.patient ? { channel: value.channel, patient: value.patient } : skipToken, { retry: false, staleTime: 5 * 60_000 }),
  );
  const create = useMutation(
    trpc.request.create.mutationOptions({
      onSuccess: (created) => {
        void queryClient.invalidateQueries(trpc.request.list.pathFilter());
        if (created.addressWarning) toast.warning("Saved, but not sent yet", { description: created.addressWarning });
        else toast.success(`Request sent to ${created.given} ${created.family} by ${CHANNEL_LABEL[created.channel]}`);
        onCreated();
        navigate({ view: "request", id: created.id });
      },
    }),
  );

  const set = (patch: Partial<RequestDraft>) => onChange({ ...value, ...patch });
  const touch = (field: Field) => setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));

  const parsed = requestInput.safeParse(toRequestInput(value));
  const errors = parsed.success ? {} : fieldErrors(parsed.error);
  const shown = (field: Field) => (touched.has(field) ? errors[field] : undefined);
  const missing = FIELDS.some((field) => !value[field].trim());
  const clean = preview.data?.refused.length === 0;

  return (
    <form
      className="grid gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(new Set(FIELDS));
        if (parsed.success) create.mutate(parsed.data);
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Which patient?</CardTitle>
        </CardHeader>
        <CardContent>
          <PatientSelect value={value.patient} invalid={!!shown("patient")} onChange={(patient) => set({ patient })} onBlur={() => touch("patient")} />
          <FieldError message={shown("patient")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What do you need?</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentTypeCards value={value.docType} onChange={(docType) => set({ docType, channel: DOCUMENT_TYPES[docType].channel })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who should send it?</CardTitle>
          <CardDescription>Only this person can open the request. A colleague cannot answer for them.</CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <div className="grid gap-4 @md/main:grid-cols-2">
            <TextField id="given" label="First name" value={value.given} onChange={(given) => set({ given })} onBlur={() => touch("given")} error={shown("given")} />
            <TextField id="family" label="Last name" value={value.family} onChange={(family) => set({ family })} onBlur={() => touch("family")} error={shown("family")} />
          </div>
          <TextField id="org" label="Where do they work?" value={value.org} onChange={(org) => set({ org })} onBlur={() => touch("org")} error={shown("org")} />
          <ContactField
            channel={value.channel}
            contact={value.contact}
            error={shown("contact")}
            onChannelChange={(channel) => set({ channel })}
            onContactChange={(contact) => set({ contact })}
            onBlur={() => touch("contact")}
          />
          <RecipientChecks check={check} draft={value} />
        </CardContent>
        <CardFooter className="border-t">
          <Collapsible open={previewOpen} onOpenChange={setPreviewOpen} className="grid w-full gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="group/preview -ml-2">
                  Preview the {CHANNEL_LABEL[value.channel]}
                  <ChevronDown data-icon="inline-end" className="transition-transform group-aria-expanded/preview:rotate-180" />
                </Button>
              </CollapsibleTrigger>
              <Button type="submit" disabled={missing || !clean || create.isPending}>
                <Send data-icon="inline-start" /> {create.isPending ? "Sending …" : "Send request"}
              </Button>
            </div>
            <CollapsibleContent className="grid gap-2">
              <MessagePreview patient={value.patient} query={preview} />
            </CollapsibleContent>
            {preview.data && preview.data.refused.length > 0 && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>This message cannot be sent</AlertTitle>
                <AlertDescription>It would include {preview.data.refused.map((c) => REFUSED_TEXT[c]).join(" and ")}. A request never names the patient or the document.</AlertDescription>
              </Alert>
            )}
            {create.error && (
              <Alert variant="destructive">
                <AlertDescription>{create.error.message}</AlertDescription>
              </Alert>
            )}
          </Collapsible>
        </CardFooter>
      </Card>
    </form>
  );
}

function PatientSelect({ value, invalid, onChange, onBlur }: { value: string; invalid: boolean; onChange: (patient: string) => void; onBlur: () => void }) {
  const patients = usePatients();
  if (patients.error)
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load the patients. Check the FHIR server, then reload the widget.</AlertDescription>
      </Alert>
    );
  if (patients.isPending) return <Skeleton className="h-9" />;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label="Patient" aria-invalid={invalid} onBlur={onBlur}>
        <SelectValue placeholder="Choose a patient" />
      </SelectTrigger>
      <SelectContent>
        {patients.data.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
            {p.birthDate && (
              <>
                , born <CalendarDate iso={p.birthDate} />
              </>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DocumentTypeCards({ value, onChange }: { value: DocumentType; onChange: (docType: DocumentType) => void }) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(docType) => {
        if (isDocumentType(docType)) onChange(docType);
      }}
      className="grid gap-3 @md/main:grid-cols-2"
    >
      {documentTypeKeys.map((k) => (
        <Label
          key={k}
          htmlFor={`doc-${k}`}
          className={cn(
            "flex cursor-pointer items-start gap-3 border border-border p-4 font-normal text-foreground transition-colors hover:border-strong",
            value === k && "border-ring bg-rose-surface/50 hover:border-ring",
          )}
        >
          <RadioGroupItem id={`doc-${k}`} value={k} className="mt-0.5" />
          <span className="grid gap-1">
            <span className="font-medium text-loud">{DOCUMENT_TYPES[k].label}</span>
            <span className="text-sm leading-snug text-muted-foreground">{DOCUMENT_TYPES[k].description}</span>
          </span>
        </Label>
      ))}
    </RadioGroup>
  );
}

function ContactField({
  channel,
  contact,
  error,
  onChannelChange,
  onContactChange,
  onBlur,
}: {
  channel: Channel;
  contact: string;
  error: string | undefined;
  onChannelChange: (channel: Channel) => void;
  onContactChange: (contact: string) => void;
  onBlur: () => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium text-dim">Send the link by</legend>
      <ToggleGroup
        type="single"
        variant="outline"
        value={channel}
        onValueChange={(next) => {
          if (isChannel(next)) onChannelChange(next);
        }}
      >
        <ToggleGroupItem value="email" size="sm">
          <Mail /> Email
        </ToggleGroupItem>
        <ToggleGroupItem value="sms" size="sm">
          <MessageSquare /> SMS
        </ToggleGroupItem>
      </ToggleGroup>
      <Input
        id="contact"
        aria-label={channel === "email" ? "Email address" : "Mobile number"}
        inputMode={channel === "email" ? "email" : "tel"}
        placeholder={channel === "email" ? "name@example.org" : "+43 660 000 0101"}
        aria-invalid={!!error}
        autoComplete="off"
        value={contact}
        onChange={(e) => onContactChange(e.target.value)}
        onBlur={onBlur}
      />
      <FieldError message={error} />
    </fieldset>
  );
}

/** The mismatch alert and one line per fact the directory and the bindings gave. */
function RecipientChecks({ check, draft }: { check: CheckQuery; draft: RequestDraft }) {
  const mismatch = check.data?.address.status === "mismatch" ? check.data.address : null;
  const lines = check.data ? checkLines(check.data, draft) : [];
  return (
    <>
      {mismatch && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>This email address looks wrong</AlertTitle>
          <AlertDescription>
            {draft.org.trim()} uses @{mismatch.expectedDomain}, but the address is @{mismatch.domain}. Check it before sending.
          </AlertDescription>
        </Alert>
      )}
      <div aria-live="polite" className="grid gap-1.5 text-sm">
        {check.isFetching && <p className="text-xs text-dim">Checking the healthcare directory …</p>}
        {check.error && <p className="text-xs text-dim">The recipient could not be checked. You can still send the request.</p>}
        {lines.length > 0 && (
          <ul className="grid gap-1.5">
            {lines.map((line) => (
              <li key={line.text} className="flex gap-2">
                {line.tone === "pass" ? (
                  <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                )}
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

type CheckLine = { tone: "pass" | "hold"; text: string };

const REVIEW = "You will review the answer before it goes into the record.";

function checkLines(check: RecipientCheck, d: RequestDraft): CheckLine[] {
  const org = d.org.trim();
  const person = `${d.given.trim()} ${d.family.trim()}`.trim();
  const lines: (CheckLine | null)[] = [
    organisationLine(check, org),
    check.organisation.status === "listed" ? personLine(check.person, person, org) : null,
    check.knownSender ? { tone: "pass", text: `${person} has sent you documents before` } : null,
    check.organisation.status === "listed" ? addressLine(check.address, org) : null,
  ];
  return lines.filter((line) => line !== null);
}

function organisationLine(check: RecipientCheck, org: string): CheckLine {
  switch (check.organisation.status) {
    case "listed":
      return { tone: "pass", text: `${check.organisation.name} is in the healthcare directory` };
    case "not_listed":
      return { tone: "hold", text: `${org} is not in the healthcare directory. ${REVIEW}` };
    case "unchecked":
      return { tone: "hold", text: check.address.status === "unchecked" ? check.address.reason : `The healthcare directory could not check ${org}.` };
    default:
      return check.organisation satisfies never;
  }
}

function personLine(person: RecipientCheck["person"], name: string, org: string): CheckLine | null {
  switch (person.status) {
    case "member":
      return { tone: "pass", text: `${person.name} works there` };
    case "not_member":
      return { tone: "hold", text: `${name} is in the healthcare directory, but not as a member of ${org}. ${REVIEW}` };
    case "not_listed":
      return { tone: "hold", text: `${name} is not in the healthcare directory. ${REVIEW}` };
    case "unchecked":
      return null;
    default:
      return person satisfies never;
  }
}

function addressLine(address: RecipientCheck["address"], org: string): CheckLine | null {
  switch (address.status) {
    case "match":
      return { tone: "pass", text: `The email address belongs to ${org}` };
    case "unchecked":
      return { tone: "hold", text: address.reason };
    case "mismatch":
    case "sms":
      return null;
    default:
      return address satisfies never;
  }
}

function MessagePreview({ patient, query }: { patient: string; query: PreviewQuery }) {
  if (!patient) return <p className="text-xs text-dim">Choose a patient to see the message.</p>;
  if (query.isPending) return <Skeleton className="h-28" />;
  if (query.error)
    return (
      <p className="text-xs text-destructive">
        The preview could not be loaded: {query.error.message}{" "}
        <Button type="button" variant="link" size="xs" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </p>
    );
  return (
    <>
      <pre className="overflow-x-auto border border-hairline bg-surface-2 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">
        {query.data.subject ? `Subject: ${query.data.subject}\n\n` : ""}
        {query.data.text}
      </pre>
      {query.data.refused.length === 0 && (
        <p className="flex items-start gap-2 text-xs text-dim">
          <CircleCheck aria-hidden className="mt-px size-3.5 shrink-0 text-success" />
          No patient name, birth date, or document type is included.
        </p>
      )}
    </>
  );
}

function TextField({ id, label, error, onChange, ...input }: { id: string; label: string; error?: string; onChange: (value: string) => void } & Omit<React.ComponentProps<typeof Input>, "onChange">) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={!!error} autoComplete="off" onChange={(e) => onChange(e.target.value)} {...input} />
      <FieldError message={error} />
    </div>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  ) : null;
}
