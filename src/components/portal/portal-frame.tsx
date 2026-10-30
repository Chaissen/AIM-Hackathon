import { Logo } from "@/components/logo";

/** Narrow page for the outside person: logo on top, one column of boxes. */
export function PortalFrame({ aside, children }: { aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3.5">
          <Logo />
          {aside && <span className="eyebrow ml-auto truncate">{aside}</span>}
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-xl content-start gap-4 px-4 py-8 sm:py-12">{children}</main>
    </div>
  );
}

export function PortalMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="crop-marks relative grid gap-3 border border-border bg-card p-6 sm:p-8">
      <h1 className="text-2xl leading-tight text-balance">{title}</h1>
      <div className="text-base leading-relaxed text-dim">{children}</div>
    </section>
  );
}

/** Shown after a failed identity check. Says nothing about the patient or the document (docs/IDENTITY.md, M1). */
export function Refusal() {
  return (
    <PortalFrame>
      <PortalMessage title="This request is for someone else">Nothing was shared with you.</PortalMessage>
    </PortalFrame>
  );
}
