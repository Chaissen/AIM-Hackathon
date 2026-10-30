import { SmsPhone } from "@/components/demo/sms-phone";

// GET /sms: every SMS the request service would have sent, like a phone screen (docs/ARCHITECTURE.md).
export default function SmsScreen() {
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
