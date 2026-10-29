"use client";

import { FileUp, Lock } from "lucide-react";
import { useState } from "react";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Upload field plus the patient's name and birth date (track/scenario/README.md: the form must ask for both).
export function AnswerForm() {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!file) return setError("Add the document first.");
        if (!name.trim() || !birthDate) return setError("Enter the patient's name and birth date.");
        // TODO(T09): send `file`, `name` and `birthDate` as FormData to the answer procedure (eidProcedure).
        // On a patient mismatch it returns: "This document is about a different patient. Check the file and upload again."
        setError("Uploading is not connected yet.");
      }}
    >
      <section className="grid gap-3 rounded-xl border bg-card p-6">
        <h2 className="font-semibold">1. Add the document</h2>
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
            "grid cursor-pointer justify-items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm",
            drag ? "border-primary bg-primary/5" : "bg-muted/40",
          )}
        >
          <FileUp className="size-6 text-muted-foreground" />
          <span className="font-medium">{file ? file.name : "Drop the file here or click to choose"}</span>
          <span className="text-muted-foreground">Markdown or text, as your system exports it</span>
          <input id="file" type="file" accept=".md,.txt,text/markdown,text/plain" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </section>

      <section className="grid gap-4 rounded-xl border bg-card p-6">
        <div className="grid gap-1">
          <h2 className="font-semibold">2. Confirm the patient</h2>
          <p className="text-sm text-muted-foreground">As written in your document. We check that it is about the right person.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="patient-name">Patient name</Label>
            <Input id="patient-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="patient-birth-date">Birth date</Label>
            <Input id="patient-birth-date" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
        </div>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="size-3.5" /> Sent encrypted
        </span>
        <Button size="lg" type="submit">
          Send securely
        </Button>
      </div>
    </form>
  );
}
