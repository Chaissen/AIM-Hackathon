"use client";

import { useMutation } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { FileUp, Loader2, Lock } from "lucide-react";
import { useRef, useState } from "react";

import { AnswerFiled, AnswerHeld, EarlierAnswerFiled, LinkClosed } from "@/components/portal/answer-messages";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/react";

type Problem = { title: string; details?: string[]; loginAgain?: boolean };

// MAX_UPLOAD_BYTES in src/server/answers/submit.ts. The server checks it again.
const MAX_FILE_BYTES = 64 * 1024;

// The texts the sender sees. docs/IDENTITY.md, M3, fixes the one for a document about someone else.
const PATIENT_MISMATCH: Record<"document" | "form", string> = {
  document: "This document is about a different patient. Check the file and upload again.",
  form: "The name or birth date you entered does not match the patient of this request. Check them and send again.",
};

// Upload field plus the patient's name and birth date (track/scenario/README.md: the form must ask for both).
export function AnswerForm({ token, requester, clinic }: { token: string; requester: string; clinic: string }) {
  const trpc = useTRPC();
  const answer = useMutation(trpc.portal.answer.mutationOptions());
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [drag, setDrag] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [done, setDone] = useState<"filed" | "earlier_filed" | "held" | "closed" | null>(null);

  if (done === "filed") return <AnswerFiled clinic={clinic} />;
  if (done === "earlier_filed") return <EarlierAnswerFiled clinic={clinic} />;
  if (done === "held") return <AnswerHeld requester={requester} />;
  if (done === "closed") return <LinkClosed />;

  async function send() {
    // A file chosen before the page finished loading is in the input but not in the state.
    const chosen = file ?? input.current?.files?.[0] ?? null;
    if (!chosen) return setProblem({ title: "Add the document first." });
    if (chosen.size > MAX_FILE_BYTES) return setProblem({ title: `The file is larger than ${MAX_FILE_BYTES / 1024} KB. Upload the document as Markdown or text.` });
    if (!name.trim() || !birthDate) return setProblem({ title: "Enter the patient's name and birth date." });
    setProblem(null);
    const data = new FormData();
    data.set("token", token);
    data.set("file", chosen);
    data.set("patientName", name);
    data.set("birthDate", birthDate);
    try {
      const result = await answer.mutateAsync(data);
      switch (result.outcome) {
        case "filed":
        case "held":
        case "closed":
          return setDone(result.outcome);
        case "patient_mismatch":
          return setProblem({ title: PATIENT_MISMATCH[result.part] });
        case "earlier_answer":
          // An earlier upload's filing outcome was open. Only that document can be filed, never a second one.
          if (result.filed) return setDone("earlier_filed");
          return setProblem({ title: "Your earlier document is still being filed. Send it again in a few minutes. The file you just chose was not read." });
        case "unreadable":
          return setProblem({ title: "We could not read this document.", details: result.errors });
        case "not_filed":
          return setProblem({ title: "The document could not be filed right now. Send it again in a few minutes." });
        case "login_again":
          return setProblem({ title: "Your login is no longer valid. Log in again.", loginAgain: true });
      }
    } catch (error) {
      if (isTRPCClientError(error) && error.data?.code === "UNAUTHORIZED") {
        return setProblem({ title: "Your login has expired. Log in again.", loginAgain: true });
      }
      if (isTRPCClientError(error) && error.data?.code === "BAD_REQUEST") {
        return setProblem({ title: "Check the file, the patient's name, and the birth date." });
      }
      setProblem({ title: "Sending did not work. Try again." });
    }
  }

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <section className="grid gap-4 border border-border bg-card p-6 sm:p-8">
        <h2 className="text-lg">1. Add the document</h2>
        <label
          htmlFor="file"
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            setFile(e.dataTransfer.files[0] ?? null);
          }}
          className={cn(
            "grid cursor-pointer justify-items-center gap-2 border border-dashed p-6 text-center text-sm transition-colors",
            drag ? "border-ring bg-rose-surface/60" : "border-strong bg-surface hover:border-ring",
          )}
        >
          <FileUp className="size-6 text-muted-foreground" />
          <span className="font-medium text-loud">{file ? file.name : "Drop the file here or click to choose"}</span>
          <span className="text-muted-foreground">Markdown or text, as your system exports it</span>
          <input ref={input} id="file" type="file" accept=".md,.txt,text/markdown,text/plain" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </section>

      <section className="grid gap-5 border border-border bg-card p-6 sm:p-8">
        <div className="grid gap-1.5">
          <h2 className="text-lg">2. Confirm the patient</h2>
          <p className="text-sm text-muted-foreground">As written in your document. We check that it is about the right person.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="patient-name">Patient name</Label>
            <Input id="patient-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="patient-birth-date">Birth date</Label>
            <Input id="patient-birth-date" className="h-11" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
        </div>
      </section>

      {problem && (
        <Alert variant="destructive">
          <AlertTitle>{problem.title}</AlertTitle>
          {(problem.details?.length || problem.loginAgain) && (
            <AlertDescription>
              {problem.details && (
                <ul className="list-disc pl-4">
                  {problem.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
              {problem.loginAgain && (
                <a href={`/r/${encodeURIComponent(token)}`} className="font-medium">
                  Log in again
                </a>
              )}
            </AlertDescription>
          )}
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="size-3.5" /> Sent encrypted
        </span>
        <Button size="lg" type="submit" disabled={answer.isPending}>
          {answer.isPending && <Loader2 className="animate-spin" />} Send securely
        </Button>
      </div>
    </form>
  );
}
