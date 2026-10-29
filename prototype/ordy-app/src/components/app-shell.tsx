import { useState } from "react"
import { BarChart3, FileText, Inbox, LayoutGrid, ListChecks, Moon, Plus, RotateCcw, ScrollText, Users, UserRound, ChevronsUpDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { toast } from "sonner"
import { CLINIC, ME, counts, resetEmpty, resetSeed } from "@/lib/api"
import { isAdmin, setRole, useRoute } from "@/lib/store"

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden className="text-primary">
        <rect x="2" y="3" width="15" height="6" rx="2" fill="currentColor" />
        <rect x="9" y="10" width="15" height="6" rx="2" fill="currentColor" opacity=".55" />
        <rect x="2" y="17" width="15" height="6" rx="2" fill="currentColor" opacity=".3" />
      </svg>
      <span className="text-lg font-bold tracking-tight">ordy</span>
    </span>
  )
}

function toggleTheme() {
  const dark = !document.documentElement.classList.contains("dark")
  document.documentElement.classList.toggle("dark", dark)
  try { localStorage.setItem("ordy-theme", dark ? "dark" : "light") } catch { /* storage blocked */ }
}

const NAV = [
  { h: "overview", label: "Overview", icon: LayoutGrid },
  { h: "requests", label: "Requests", icon: ListChecks },
  { h: "patients", label: "Patients", icon: UserRound },
  { h: "contacts", label: "Contacts", icon: Users },
]
const MORE = [
  { h: "audit", label: "Audit log", icon: ScrollText },
  { h: "metrics", label: "Metrics", icon: BarChart3 },
]

export function AppShell({ crumbs, actions, wide, children }: { crumbs: React.ReactNode; actions?: React.ReactNode; wide?: boolean; children: React.ReactNode }) {
  const route = useRoute()
  const c = counts()
  const [resetOpen, setResetOpen] = useState(false)
  const admin = isAdmin()
  const active = (h: string) => route.view === h || (h === "requests" && route.view === "request") || (h === "patients" && route.view === "patient")

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="gap-3 px-3 pt-4">
          <a href="#overview" className="px-1"><Logo /></a>
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-sm font-medium">{CLINIC.name}</div>
            <div className="text-xs text-muted-foreground">{ME.role}</div>
          </div>
          <Button asChild className="w-full justify-start">
            <a href="#new"><Plus /> New request</a>
          </Button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((n) => (
                  <SidebarMenuItem key={n.h}>
                    <SidebarMenuButton asChild isActive={active(n.h)}>
                      <a href={`#${n.h}`}><n.icon /> <span>{n.label}</span></a>
                    </SidebarMenuButton>
                    {n.h === "requests" && c.decide > 0 && (
                      <SidebarMenuBadge className="bg-amber-500/15 text-amber-800 dark:text-amber-300">{c.decide}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {admin && (
            <SidebarGroup>
              <SidebarGroupLabel>Admin</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {MORE.map((n) => (
                    <SidebarMenuItem key={n.h}>
                      <SidebarMenuButton asChild isActive={active(n.h)}>
                        <a href={`#${n.h}`}><n.icon /> <span>{n.label}</span></a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
          <SidebarGroup className="mt-auto">
            <SidebarGroupLabel>Demo tools</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={active("outbox")} size="sm">
                    <a href="#outbox"><Inbox /> <span>Recipient's inbox</span></a>
                  </SidebarMenuButton>
                  {c.unread > 0 && <SidebarMenuBadge>{c.unread}</SidebarMenuBadge>}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg">
                <Avatar className="size-8"><AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">LH</AvatarFallback></Avatar>
                <div className="grid min-w-0 text-left leading-tight">
                  <span className="truncate text-sm font-medium">Dr. {ME.given} {ME.family}</span>
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">{ME.role}{admin && <Badge variant="secondary" className="h-4 rounded px-1 text-[10px]">Admin</Badge>}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-60">
              <DropdownMenuLabel className="font-normal text-muted-foreground">{CLINIC.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">View as</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={admin ? "admin" : "doctor"} onValueChange={(v) => {
                setRole(v)
                if (v === "doctor" && (route.view === "audit" || route.view === "metrics")) window.location.hash = "overview"
                toast(v === "admin" ? "Admin view: audit log, metrics and technical details are shown" : "Doctor view")
              }}>
                <DropdownMenuRadioItem value="doctor">
                  <div className="grid"><span>Doctor</span><span className="text-xs text-muted-foreground">Requests and documents</span></div>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="admin">
                  <div className="grid"><span>Admin</span><span className="text-xs text-muted-foreground">Also audit log, metrics, technical details</span></div>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={toggleTheme}><Moon /> Switch theme</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setResetOpen(true)}><RotateCcw /> Reset demo data</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur md:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <div className="min-w-0 flex-1 truncate text-sm">{crumbs}</div>
          {actions}
        </header>
        <main className={`mx-auto grid w-full content-start gap-6 p-4 md:p-6 ${wide ? "max-w-[1600px]" : "max-w-6xl"}`}>{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-4 pb-6 text-xs text-muted-foreground md:px-6">
          <FileText className="mr-1 inline size-3" /> Prototype with synthetic data. ID Austria is simulated. Not for clinical use.
        </footer>
      </SidebarInset>

      <ResetDialog open={resetOpen} onOpenChange={setResetOpen} />
    </SidebarProvider>
  )
}

function ResetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset demo data</DialogTitle>
          <DialogDescription>This replaces all requests, messages and audit entries in this browser.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="rounded-md border p-3">
            <div className="font-medium">Example run</div>
            <p className="text-muted-foreground">Request 1 received with M2 and M3 caught, M1 on request 2, and request 3 waiting for Stefan Kern.</p>
          </div>
          <div className="rounded-md border p-3">
            <div className="font-medium">Empty</div>
            <p className="text-muted-foreground">Run the scenario yourself from New request.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { resetEmpty(); onOpenChange(false); window.location.hash = "overview"; toast("Reset to an empty state") }}>Start empty</Button>
          <Button onClick={async () => { await resetSeed(); onOpenChange(false); window.location.hash = "overview"; toast("Example run loaded") }}>Load example run</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PageHeader({ title, description, children }: { title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}
