import { connection } from "next/server";
import { Suspense } from "react";

import { Time } from "@/components/time";
import { cn } from "@/lib/utils";
import { listSms } from "@/server/portal/data";

// The phone screen of /sms and /inbox: every SMS in the demo outbox, each with its working link (docs/ARCHITECTURE.md,
// "Outgoing messages"). Server only, because it reads listSms(). Only open requests have one; closing a request deletes it.

const isLink = (word: string) => (word.startsWith("http://") || word.startsWith("https://")) && URL.canParse(word);

/** The text with each word that is a link turned into one. Each word is keyed by where it starts in the text. */
function linkify(text: string) {
  const words: { at: number; word: string }[] = [];
  let at = 0;
  for (const word of text.split(" ")) {
    words.push({ at, word });
    at += word.length + 1;
  }
  return words.map(({ at, word }) => (
    <span key={at}>
      {at > 0 && " "}
      {isLink(word) ? (
        <a href={word} className="border-b border-current font-medium break-all text-loud">
          {word}
        </a>
      ) : (
        word
      )}
    </span>
  ));
}

export function SmsPhone({ className }: { className?: string }) {
  return (
    <div className={cn("w-full max-w-[340px] rounded-[10px] border border-border bg-card p-2 shadow-lg", className)}>
      <div className="grid min-h-[480px] content-start gap-3 rounded-[6px] bg-surface-2 p-4">
        <Suspense fallback={<p className="text-center text-sm text-muted-foreground">Loading …</p>}>
          <Messages />
        </Suspense>
      </div>
    </div>
  );
}

async function Messages() {
  // The outbox changes with every request, so it is read at request time, never prerendered.
  await connection();
  const messages = await listSms();
  if (!messages.length) return <p className="pt-10 text-center text-sm text-muted-foreground">No SMS for an open request.</p>;
  return messages.map((m) => (
    <div key={m.id} className="grid gap-1.5">
      <span className="text-center font-mono text-[11px] text-muted-foreground">
        To {m.to} · <Time at={m.sentAt} />
      </span>
      <p className="rounded-[8px] rounded-bl-[2px] border border-hairline bg-background p-3 text-sm leading-snug shadow-xs">{linkify(m.body)}</p>
    </div>
  ));
}
