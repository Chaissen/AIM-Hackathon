import { notFound } from "next/navigation";

import { SmsPhone } from "@/components/demo/sms-phone";
import { demoToolsEnabled } from "@/lib/demo-tools";

// GET /sms: every SMS in the demo outbox, like a phone screen (docs/ARCHITECTURE.md). The links work, so a production
// build, which keeps no outbox, answers 404 (docs/COMPLIANCE_AND_SAFETY.md).
export default function SmsScreen() {
  if (!demoToolsEnabled) notFound();
  return (
    <main className="grid justify-items-center gap-6 px-4 py-10 sm:py-14">
      <div className="grid gap-2 text-center">
        <h1 className="text-2xl">SMS screen</h1>
        <p className="eyebrow">Demo only. No SMS is really sent.</p>
      </div>
      <SmsPhone />
    </main>
  );
}
