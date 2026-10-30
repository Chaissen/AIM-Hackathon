"use client";

import { ArrowRight, LoaderCircle, MessagesSquare, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Logo } from "@/components/logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { workspaceSessionResponse, type WorkspaceSessionResponse } from "@/lib/workspace";
import { TRPCReactProvider } from "@/trpc/react";

import { WidgetApp } from "../widget/app";
import { WorkspaceProvider } from "./context";

type SignedInSession = Extract<WorkspaceSessionResponse, { status: "signed_in" }>;
type AccessState = WorkspaceSessionResponse
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "signing_out"; clinic: string }
  | { status: "sign_out_failed"; clinic: string };

const sessionError = z.object({ error: z.string().max(500) });
const sessionQueryKey = ["workspace-session"];

async function requestSession(method: "GET" | "POST" | "DELETE", body?: { username: string; password: string }, signal?: AbortSignal) {
  const response = await fetch("/api/workspace/session", {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal,
    ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const value: unknown = await response.json().catch(() => null);
    throw new Error(sessionError.safeParse(value).data?.error ?? "The workspace could not be reached. Try again.");
  }
  const value: unknown = await response.json().catch(() => null);
  const parsed = workspaceSessionResponse.safeParse(value);
  if (!parsed.success) throw new Error("The workspace could not finish signing you in. Try again.");
  return parsed.data;
}

export function WorkspaceAccess() {
  const queryClient = useQueryClient();
  const [local, setState] = useState<AccessState | null>(null);
  const session = useQuery({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => requestSession("GET", undefined, signal),
    enabled: local === null,
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const state: AccessState = local ?? (session.isPending ? { status: "loading" } : session.error ? { status: "unavailable", message: session.error.message } : session.data);

  const endSession = useCallback((clinic: string) => {
    queryClient.removeQueries({ queryKey: sessionQueryKey, exact: true });
    setState({ status: "signed_out", clinic });
  }, [queryClient]);
  const signOut = useCallback(async (clinic: string) => {
    queryClient.removeQueries({ queryKey: sessionQueryKey, exact: true });
    setState({ status: "signing_out", clinic });
    try {
      setState(await requestSession("DELETE"));
    } catch {
      setState({ status: "sign_out_failed", clinic });
    }
  }, [queryClient]);

  switch (state.status) {
    case "signed_in":
      return <SignedInWorkspace key={`${state.user.mxid}:${state.expiresAt}`} session={state} onEnd={endSession} onSignOut={signOut} />;
    case "signed_out":
      return <SignIn clinic={state.clinic} onSignedIn={setState} />;
    case "unavailable":
      return (
        <AccessFrame>
          <Alert variant="destructive">
            <AlertTitle>The workspace is unavailable</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
          <Button variant="outline" onClick={() => void session.refetch()} disabled={session.isFetching}>{session.isFetching && <LoaderCircle className="size-4 animate-spin" />}Try again</Button>
        </AccessFrame>
      );
    case "sign_out_failed":
      return (
        <AccessFrame>
          <Alert variant="destructive">
            <AlertTitle>Sign-out could not be confirmed</AlertTitle>
            <AlertDescription>Reconnect and try again before leaving this device.</AlertDescription>
          </Alert>
          <Button onClick={() => void signOut(state.clinic)}>Retry sign out</Button>
        </AccessFrame>
      );
    case "loading":
    case "signing_out":
      return <AccessFrame><p role="status" className="flex items-center gap-2 text-sm text-dim"><LoaderCircle className="size-4 animate-spin" />{state.status === "loading" ? "Opening your workspace…" : "Signing out…"}</p></AccessFrame>;
    default:
      return state satisfies never;
  }
}

function SignedInWorkspace({ session, onEnd, onSignOut }: {
  session: SignedInSession;
  onEnd: (clinic: string) => void;
  onSignOut: (clinic: string) => Promise<void>;
}) {
  const end = useCallback(() => onEnd(session.user.clinic), [onEnd, session.user.clinic]);
  const signOut = useCallback(() => void onSignOut(session.user.clinic), [onSignOut, session.user.clinic]);

  useEffect(() => {
    const expiry = setTimeout(end, Math.max(0, new Date(session.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(expiry);
  }, [end, session.expiresAt]);

  return (
    <TRPCReactProvider workspace onUnauthorized={end}>
      <WorkspaceProvider session={session} signOut={signOut}>
        <WidgetApp />
      </WorkspaceProvider>
    </TRPCReactProvider>
  );
}

function AccessFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-start justify-center gap-6 px-6 py-16">
      <Logo />
      {children}
      <Link href="/system" className="text-xs text-dim underline underline-offset-4">System status</Link>
    </main>
  );
}

function SignIn({ clinic, onSignedIn }: { clinic: string; onSignedIn: (session: WorkspaceSessionResponse) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const session = await requestSession("POST", { username, password });
      if (session.status !== "signed_in") throw new Error("Sign-in could not be completed. Try again.");
      setPassword("");
      onSignedIn(session);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign-in could not be completed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="relative isolate flex flex-1 items-center overflow-hidden">
      <div aria-hidden className="hero-grid absolute inset-0 -z-10 opacity-55" />
      <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-20">
        <section className="grid justify-items-start gap-5">
          <Logo />
          <p className="eyebrow mt-4 text-dim">{clinic}</p>
          <h1 className="max-w-xl text-4xl leading-[1.08] sm:text-5xl lg:text-6xl">Your network.<br /><em className="font-serif font-light">Your workspace.</em></h1>
          <p className="max-w-md text-base leading-relaxed text-dim">Request documents, review answers, and talk with your team in one place.</p>
          <div className="hidden gap-4 pt-3 text-sm text-dim sm:grid">
            <p className="flex items-center gap-3"><ShieldCheck className="size-4 text-success" /> Your existing network account</p>
            <p className="flex items-center gap-3"><MessagesSquare className="size-4 text-primary" /> Documents and conversations together</p>
          </div>
        </section>
        <section aria-labelledby="sign-in" className="w-full border border-border bg-card p-5 sm:p-8">
          <p className="eyebrow mb-3">Network members</p>
          <h2 id="sign-in" className="text-2xl">Sign in to ordy</h2>
          <p className="mt-2 text-sm leading-relaxed text-dim">Use the username and password for your network account.</p>
          <form onSubmit={submit} className="mt-7 grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="workspace-username">Username</Label>
              <Input id="workspace-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your network username" required maxLength={256} disabled={pending} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="workspace-password">Password</Label>
              <Input id="workspace-password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={1024} disabled={pending} />
            </div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" size="lg" className="mt-1 w-full justify-between" disabled={pending || !username.trim() || !password}>
              {pending ? "Signing in…" : "Sign in"}{pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight />}
            </Button>
          </form>
          <p className="mt-6 border-t border-hairline pt-5 text-xs leading-relaxed text-dim">Need an account or a new password? Contact your network administrator.</p>
          <Link href="/system" className="mt-4 inline-block text-xs text-dim underline underline-offset-4">System status</Link>
        </section>
      </div>
    </main>
  );
}
