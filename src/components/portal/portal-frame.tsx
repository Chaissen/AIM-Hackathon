import { Logo } from "@/components/logo";

/** Narrow page for the outside person: logo on top, one column of cards. */
export function PortalFrame({ aside, children }: { aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <Logo />
          {aside && <span className="ml-auto truncate text-sm text-muted-foreground">{aside}</span>}
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-xl content-start gap-4 px-4 py-8">{children}</main>
    </div>
  );
}

export function PortalMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 rounded-xl border bg-card p-6">
      <h1 className="text-xl font-semibold text-balance">{title}</h1>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}

/** Shown after a failed identity check. Says nothing about the patient or the document (organisations/IDENTITY.md, M1). */
export function Refusal() {
  return (
    <PortalFrame>
      <PortalMessage title="This request is for someone else">Nothing was shared with you.</PortalMessage>
    </PortalFrame>
  );
}
