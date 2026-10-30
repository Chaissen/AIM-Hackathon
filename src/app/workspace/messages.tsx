"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ChevronDown, Hash, LoaderCircle, LockKeyhole, MessagesSquare, RefreshCw, Send } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Time } from "@/components/time";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/types";

import { LoadError } from "../widget/components/load-error";
import { ShellPage } from "../widget/shell";
import { widgetHref } from "../widget/widget-route";
import { useWorkspace } from "./context";

type Room = RouterOutputs["chat"]["rooms"]["rooms"][number];
type Timeline = Extract<RouterOutputs["chat"]["timeline"], { kind: "timeline" }>;
type Message = Timeline["messages"][number];
type Attempt = { body: string; transactionId: string };

export function MessagesView({ room }: { room: string | null }) {
  const trpc = useTRPC();
  const rooms = useQuery(trpc.chat.rooms.queryOptions(undefined, { retry: false, refetchInterval: 30_000 }));
  const selected = room ?? rooms.data?.defaultRoomId ?? null;

  return (
    <ShellPage crumbs={[{ label: "Messages" }]} wide>
      <div className="grid gap-5">
        <div className="grid gap-1">
          <h1 className="text-2xl">Messages</h1>
          <p className="text-sm text-dim">Your network conversations and ordy updates.</p>
        </div>
        {rooms.isPending ? <MessagesSkeleton /> : !rooms.data ? (
          <LoadError title="Could not load your conversations" onRetry={() => void rooms.refetch()}>{rooms.error?.message}</LoadError>
        ) : (
          <>
            {rooms.error && <p role="alert" className="text-sm text-destructive">Could not refresh your room list. Showing the last loaded rooms.</p>}
            {rooms.data.rooms.length === 0 ? <NoRooms /> : (
              <div className="grid min-h-[28rem] grid-cols-[minmax(0,1fr)] overflow-hidden border border-hairline bg-card @3xl/main:grid-cols-[13rem_minmax(0,1fr)]">
                {selected ? <Conversation key={selected} room={selected} rooms={rooms.data.rooms} /> : <NoRooms />}
              </div>
            )}
          </>
        )}
      </div>
    </ShellPage>
  );
}

function RoomList({ rooms, selected, onSelect }: { rooms: Room[]; selected: string | null; onSelect?: () => void }) {
  return (
    <nav aria-label="Joined rooms" className="max-h-[42rem] overflow-y-auto p-2">
      <ul className="grid gap-1">
        {rooms.map((room) => (
          <li key={room.id}>
            <a href={widgetHref({ view: "messages", room: room.id })} aria-current={selected === room.id ? "page" : undefined} onClick={onSelect}
              className={cn("flex min-w-0 items-start gap-2.5 px-3 py-3 text-sm transition-colors hover:bg-surface-2", selected === room.id && "bg-secondary text-loud")}>
              {room.encrypted ? <LockKeyhole className="mt-0.5 size-4 shrink-0 text-dim" /> : <Hash className="mt-0.5 size-4 shrink-0 text-dim" />}
              <span className="grid min-w-0 gap-1"><span className="break-words font-medium">{room.name}</span><span className="text-xs text-dim">{room.encrypted ? "Encrypted room" : "Network conversation"}</span></span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function RoomPicker({ rooms, selected, name }: { rooms: Room[]; selected: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" className="h-auto max-w-full justify-start gap-2 px-0 py-1 text-left @3xl/main:hidden" aria-label="Choose conversation">
          <span className="truncate">{name}</span><ChevronDown className="size-4 shrink-0" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="gap-0 p-0">
        <SheetHeader className="border-b border-hairline p-5"><SheetTitle>Conversations</SheetTitle><SheetDescription>Rooms you have joined in your network.</SheetDescription></SheetHeader>
        <RoomList rooms={rooms} selected={selected} onSelect={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function Conversation({ room, rooms }: { room: string; rooms: Room[] }) {
  const trpc = useTRPC();
  const timeline = useInfiniteQuery(trpc.chat.timeline.infiniteQueryOptions({ room }, {
    retry: false,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    getNextPageParam: (page) => page.kind === "timeline" ? page.nextCursor ?? undefined : undefined,
  }));
  const first = timeline.data?.pages[0];
  const shownRoom = first?.room ?? rooms.find((candidate) => candidate.id === room);
  const title = shownRoom?.name ?? "Conversation";

  return (
    <>
      <aside className="hidden min-h-0 border-r border-hairline bg-surface @3xl/main:block">
        <p className="eyebrow border-b border-hairline px-4 py-4">Joined rooms</p>
        <RoomList rooms={rooms} selected={shownRoom?.id ?? room} />
      </aside>
      <section aria-label={title} className="flex h-[min(46rem,calc(100svh-12rem))] min-h-[28rem] min-w-0 flex-col">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="grid min-w-0 gap-0.5">
          <p className="hidden truncate text-sm font-medium text-loud @3xl/main:block">{title}</p>
          <RoomPicker rooms={rooms} selected={shownRoom?.id ?? room} name={title} />
          <p className="text-xs text-dim">{shownRoom?.encrypted ? "Encrypted conversation" : "Connected to your network"}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh conversation" title="Refresh conversation" onClick={() => void timeline.refetch()} disabled={timeline.isFetching}>
          <RefreshCw className={cn("size-4", timeline.isFetching && "animate-spin")} />
        </Button>
      </header>
      {timeline.isPending ? <FeedSkeleton /> : !timeline.data ? (
        <div className="flex-1 overflow-y-auto p-4"><LoadError title="Could not open this conversation" onRetry={() => void timeline.refetch()}>{timeline.error?.message}</LoadError></div>
      ) : first?.kind === "encrypted" ? <EncryptedRoom /> : (
        <>
          {timeline.error && <p role="alert" className="border-b border-hairline px-4 py-2 text-xs text-destructive">{timeline.error.message} Use refresh to try again.</p>}
          <MessageFeed pages={timeline.data.pages} hasOlder={timeline.hasNextPage} loadingOlder={timeline.isFetchingNextPage} loadOlder={() => void timeline.fetchNextPage()} />
          <Composer room={shownRoom?.id ?? room} />
        </>
      )}
      </section>
    </>
  );
}

function MessageFeed({ pages, hasOlder, loadingOlder, loadOlder }: {
  pages: RouterOutputs["chat"]["timeline"][];
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
}) {
  const workspace = useWorkspace();
  const viewport = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const [showJump, setShowJump] = useState(false);
  const byId = new Map<string, Message>();
  for (const page of pages.toReversed()) if (page.kind === "timeline") for (const message of page.messages) byId.set(message.id, message);
  const messages = [...byId.values()].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
  const latest = messages.at(-1)?.id;

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    if (anchor.current && !loadingOlder) {
      node.scrollTop = anchor.current.top + node.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (atBottom.current) node.scrollTop = node.scrollHeight;
  }, [latest, messages.length, pages.length, loadingOlder]);

  function older() {
    const node = viewport.current;
    if (node) anchor.current = { height: node.scrollHeight, top: node.scrollTop };
    atBottom.current = false;
    loadOlder();
  }

  function jump() {
    const node = viewport.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "instant" });
    atBottom.current = true;
    setShowJump(false);
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={viewport} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" onScroll={(event) => {
        const node = event.currentTarget;
        atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        setShowJump(!atBottom.current);
      }}>
        {hasOlder && <div className="mb-5 text-center"><Button variant="outline" size="sm" onClick={older} disabled={loadingOlder}>{loadingOlder && <LoaderCircle className="size-3.5 animate-spin" />}{loadingOlder ? "Loading history…" : "Load earlier messages"}</Button></div>}
        {messages.length === 0 ? <NoMessages /> : (
          <ol aria-label="Messages" className="grid gap-5">
            {messages.map((message) => <MessageRow key={message.id} message={message} own={message.sender === workspace?.session.user.mxid} />)}
          </ol>
        )}
      </div>
      {showJump && <Button variant="secondary" size="sm" onClick={jump} className="absolute right-4 bottom-3 shadow-sm"><ArrowDown /> Jump to latest</Button>}
    </div>
  );
}

function MessageRow({ message, own }: { message: Message; own: boolean }) {
  const notice = message.kind === "notice";
  return (
    <li className={cn("flex min-w-0 gap-2.5", own && "flex-row-reverse")}>
      <span aria-hidden className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center border border-hairline bg-surface text-xs text-dim", notice && "bg-rose-surface")}>
        {notice ? <MessagesSquare className="size-3.5" /> : message.senderName.slice(0, 1).toLocaleUpperCase("en")}
      </span>
      <div className={cn("grid min-w-0 max-w-[90%] gap-1", own && "justify-items-end")}>
        <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", own && "justify-end")}>
          <span className="font-medium text-loud" title={message.sender}>{own ? "You" : message.senderName}</span>
          {notice && <Badge variant="secondary" className="px-1 py-0 text-[10px]">Notice</Badge>}
          <Time at={message.at} className="text-muted-foreground" />
        </div>
        <p className={cn("max-w-full border border-hairline px-3 py-2 text-sm whitespace-pre-wrap wrap-anywhere", own ? "bg-secondary" : "bg-surface", notice && "border-rose-border bg-rose-surface", message.kind === "emote" && "italic")}>{message.kind === "emote" ? `${message.senderName} ${message.body}` : message.body}</p>
      </div>
    </li>
  );
}

function Composer({ room }: { room: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const attempt = useRef<Attempt | null>(null);
  const sending = useRef(false);
  const send = useMutation(trpc.chat.send.mutationOptions());

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text || sending.current) return;
    if (attempt.current?.body !== text) attempt.current = { body: text, transactionId: crypto.randomUUID() };
    const current = attempt.current;
    sending.current = true;
    send.mutate({ room, ...current }, {
      onSuccess: () => {
        setBody("");
        attempt.current = null;
        void queryClient.invalidateQueries({ queryKey: trpc.chat.timeline.queryKey() });
      },
      onSettled: () => { sending.current = false; },
    });
  }

  return (
    <form onSubmit={submit} className="grid shrink-0 gap-2 border-t border-hairline bg-background p-3">
      {send.error && <Alert variant="destructive"><AlertDescription>{send.error.message} Your message is still here.</AlertDescription></Alert>}
      <Label htmlFor="message-body" className="sr-only">Message</Label>
      <Textarea id="message-body" name="message" placeholder="Write a message to this room…" value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} disabled={send.isPending} className="max-h-40 min-h-16 resize-none text-sm" />
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">Synthetic data only. Messages stay in this Matrix room.</p>
        <Button type="submit" size="sm" disabled={!body.trim() || send.isPending}>{send.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}{send.error ? "Retry" : "Send"}</Button>
      </div>
    </form>
  );
}

function NoRooms() {
  return <div className="flex min-h-80 flex-col items-center justify-center gap-3 p-6 text-center"><MessagesSquare className="size-8 text-dim" /><h2 className="text-lg">No conversations yet</h2><p className="max-w-sm text-sm text-dim">Your network administrator can invite you to a room. It will appear here after you join.</p></div>;
}

function NoMessages() {
  return <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><MessagesSquare className="mb-2 size-7 text-dim" /><p className="text-sm font-medium text-loud">Start the conversation</p><p className="max-w-xs text-xs leading-relaxed text-dim">Messages and ordy notices in this room appear here.</p></div>;
}

function EncryptedRoom() {
  return <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"><LockKeyhole className="size-8 text-dim" /><h2 className="text-lg">This room uses encryption</h2><p className="max-w-sm text-sm leading-relaxed text-dim">ordy supports text conversations in unencrypted rooms. Use a compatible Matrix client for this room.</p><p className="text-xs text-dim">No plaintext message can be sent here.</p></div>;
}

function FeedSkeleton() {
  return <div aria-label="Loading messages" className="grid flex-1 content-start gap-5 p-4"><Skeleton className="h-16 w-4/5" /><Skeleton className="ml-auto h-12 w-3/5" /><Skeleton className="h-20 w-4/5" /></div>;
}

function MessagesSkeleton() {
  return <div aria-label="Loading conversations" className="grid min-h-96 gap-4 border border-hairline p-4"><Skeleton className="h-8 w-1/3" /><FeedSkeleton /></div>;
}
