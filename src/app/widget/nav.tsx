"use client";

import { ChartColumn, ExternalLink, Inbox, LayoutGrid, ListChecks, LogOut, type LucideIcon, Menu, MessagesSquare, Plus, ScrollText, UserRound, Users } from "lucide-react";
import { useState } from "react";

import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { demoToolsEnabled } from "@/lib/demo-tools";
import { countByFilter } from "@/lib/request-status";

import { useWorkspace } from "../workspace/context";

import { useMe, useRequests } from "./data";
import { useWidgetRoute } from "./use-widget-route";
import { widgetHref, type WidgetRoute } from "./widget-route";

type View = WidgetRoute["view"];
type NavItem = { label: string; icon: LucideIcon; route: WidgetRoute };

/** The navigation entry each view lights up: a request's page belongs to Requests, a patient's page to Patients. */
const SECTION: Record<View, View> = {
  overview: "overview",
  requests: "requests",
  request: "requests",
  new: "new",
  patients: "patients",
  patient: "patients",
  contacts: "contacts",
  messages: "messages",
  audit: "audit",
  metrics: "metrics",
};

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Work",
    items: [
      { label: "Overview", icon: LayoutGrid, route: { view: "overview" } },
      { label: "Requests", icon: ListChecks, route: { view: "requests", filter: "all" } },
      { label: "Patients", icon: UserRound, route: { view: "patients" } },
      { label: "Contacts", icon: Users, route: { view: "contacts" } },
      { label: "Messages", icon: MessagesSquare, route: { view: "messages", room: null } },
    ],
  },
  {
    label: "Oversight",
    items: [
      { label: "Audit log", icon: ScrollText, route: { view: "audit", event: "all" } },
      { label: "Metrics", icon: ChartColumn, route: { view: "metrics" } },
    ],
  },
];

const NEW_REQUEST: WidgetRoute = { view: "new" };

/** Open requests that wait for one of Dr. Hofer's decisions. Zero while the list loads or fails. */
export function useAttentionCount(): number {
  const { data } = useRequests();
  return data ? countByFilter(data.map((r) => r.state)).attention : 0;
}

/**
 * The whole navigation: the clinic and New request, the Work and Oversight groups, the demo tools card, and who is
 * signed in. The sidebar shows it from 1024px, the sheet below that.
 */
export function WidgetNav({ onNavigate }: { onNavigate?: () => void }) {
  const route = useWidgetRoute();
  const attention = useAttentionCount();
  const me = useMe();
  const workspace = useWorkspace();
  const current = (target: WidgetRoute) => (SECTION[route.view] === target.view ? "page" : undefined);

  return (
    <>
      <SidebarHeader className="gap-3 px-3 pt-4">
        <a href={widgetHref({ view: "overview" })} onClick={onNavigate} className="w-fit px-1">
          <Logo />
        </a>
        {me.isPending && !workspace ? <Skeleton className="mx-1 h-4 w-32" /> : <p className="truncate px-1 text-xs text-dim">{me.data?.clinic ?? workspace?.session.user.clinic}</p>}
        <Button asChild className="w-full">
          <a href={widgetHref(NEW_REQUEST)} onClick={onNavigate} aria-current={current(NEW_REQUEST)}>
            <Plus /> New request
          </a>
        </Button>
      </SidebarHeader>
      <SidebarContent>
        {GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="eyebrow h-7 font-normal text-dim">{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.filter((item) => item.route.view !== "messages" || workspace !== null).map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton asChild isActive={current(item.route) === "page"}>
                      <a href={widgetHref(item.route)} onClick={onNavigate} aria-current={current(item.route)}>
                        <item.icon />
                        <span>{item.label}</span>
                        {item.route.view === "requests" && attention > 0 && (
                          <Badge variant="warning" className="ml-auto">
                            {attention}
                          </Badge>
                        )}
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        {demoToolsEnabled && <DemoTools />}
      </SidebarContent>
      <SidebarFooter className="border-t border-hairline">
        <UserBlock />
      </SidebarFooter>
    </>
  );
}

function DemoTools() {
  return (
    <SidebarGroup className="mt-auto">
      <SidebarGroupLabel className="eyebrow h-7 font-normal text-dim">Demo tools</SidebarGroupLabel>
      <SidebarGroupContent>
        <a
          href="/inbox"
          target="_blank"
          rel="noopener"
          className="flex items-center gap-3 border border-hairline bg-surface p-3 transition-colors hover:border-strong hover:bg-surface-2"
        >
          <span className="flex size-9 shrink-0 items-center justify-center bg-primary text-primary-foreground">
            <Inbox className="size-5" />
          </span>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="text-sm font-medium text-loud">Recipient&apos;s inbox</span>
            <span className="truncate text-xs text-dim">Emails and SMS sent out</span>
          </span>
          <ExternalLink className="size-4 shrink-0 text-dim" aria-hidden />
        </a>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function UserBlock() {
  const me = useMe();
  const workspace = useWorkspace();
  const identity = me.data ?? workspace?.session.user;
  return (
    <div className="grid gap-0.5 p-2 leading-tight">
      {identity ? (
        <>
          <span className="truncate text-sm font-medium text-loud">{identity.displayName}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{identity.mxid}</span>
        </>
      ) : me.isPending ? (
        <div className="grid gap-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-40" />
        </div>
      ) : <p className="text-xs text-dim">Could not load who you are. Reload this page.</p>}
      {workspace && (
        <Button variant="ghost" size="sm" onClick={workspace.signOut} className="mt-2 justify-start px-0 text-dim">
          <LogOut /> Sign out
        </Button>
      )}
    </div>
  );
}

/** Below 1024px the navigation sits in a left sheet behind the menu button. Any navigation closes it. */
export function NavSheet() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open navigation">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="gap-0 p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Your workspace views.</SheetDescription>
        </SheetHeader>
        <Sidebar collapsible="none" className="h-full w-full">
          <WidgetNav onNavigate={() => setOpen(false)} />
        </Sidebar>
      </SheetContent>
    </Sheet>
  );
}
