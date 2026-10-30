import Link from "next/link";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

import { SystemStatus } from "../system-status";

export default function SystemPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Logo />
        <Button asChild variant="outline" size="sm"><Link href="/">Back to workspace</Link></Button>
      </div>
      <section className="pt-12">
        <h1 className="text-3xl">System status</h1>
        <p className="mt-3 text-sm text-dim">Live connections to the services behind ordy.</p>
        <SystemStatus />
      </section>
    </main>
  );
}
