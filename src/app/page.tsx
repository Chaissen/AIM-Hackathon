import { SectionLabel } from "@/components/section-label";
import { SystemStatus } from "./system-status";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="relative isolate overflow-hidden border-b border-hairline px-6 py-20 text-center sm:py-28">
        <div aria-hidden className="hero-grid absolute inset-0 -z-10" />
        <div aria-hidden className="dot-grid absolute inset-0 -z-10" />
        <h1 className="mx-auto text-[clamp(56px,9vw,96px)] leading-none font-stretch-[125%]">ordy</h1>
        <p className="mx-auto mt-6 max-w-2xl text-xl leading-snug font-light text-foreground sm:text-2xl">
          Secure document requests <em className="font-serif text-[1.3em] leading-none font-light text-loud">from outside the PGK network</em>,
          filed as FHIR R4.
        </p>
      </section>
      <section className="mx-auto w-full max-w-2xl px-6 py-12 sm:py-16">
        <SectionLabel as="h2">System status</SectionLabel>
        <SystemStatus />
      </section>
    </main>
  );
}
