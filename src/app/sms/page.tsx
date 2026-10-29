import { Suspense } from "react";

import { listSms } from "@/server/portal/data";

const formatTime = (d: Date) =>
  d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const linkify = (text: string) =>
  text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} className="font-medium break-all text-primary underline underline-offset-2">
        {part}
      </a>
    ) : (
      part
    ),
  );

// GET /sms: every SMS the request service would have sent, like a phone screen (docs/ARCHITECTURE.md).
export default function SmsScreen() {
  return (
    <main className="grid justify-items-center gap-4 px-4 py-8">
      <div className="grid gap-1 text-center">
        <h1 className="text-lg font-semibold">SMS screen</h1>
        <p className="text-sm text-muted-foreground">Demo only. No SMS is really sent.</p>
      </div>
      <div className="w-full max-w-[340px] rounded-[2.25rem] border-4 bg-card p-3 shadow-sm">
        <div className="grid min-h-[480px] content-start gap-3 rounded-[1.6rem] bg-muted/50 p-4">
          <Suspense fallback={<p className="text-center text-sm text-muted-foreground">Loading …</p>}>
            <Messages />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function Messages() {
  const messages = await listSms();
  if (!messages.length) return <p className="pt-10 text-center text-sm text-muted-foreground">No SMS sent yet.</p>;
  return messages.map((m) => (
    <div key={m.id} className="grid gap-1">
      <span className="text-center text-xs text-muted-foreground">
        To {m.to} · {formatTime(m.sentAt)}
      </span>
      <p className="rounded-2xl rounded-bl-sm bg-background p-3 text-sm leading-snug shadow-xs">{linkify(m.body)}</p>
    </div>
  ));
}
