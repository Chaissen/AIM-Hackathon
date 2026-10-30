"use client";

import { Plus, TriangleAlert } from "lucide-react";
import { Fragment, useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";

import { NavSheet, useAttentionCount, WidgetNav } from "./nav";
import { useWidgetRoute } from "./use-widget-route";
import { widgetHref, type WidgetRoute } from "./widget-route";

/**
 * A sidebar from 1024px (Element's top container and the maximised widget), a top bar with a menu sheet below that
 * (Element's right panel, 360 to about 900px). The sidebar is sticky and scrolls on its own, so it fits the top
 * container's 350px of height. It is as tall as the viewport below the root layout's column-rule strip, so its foot
 * shows before the page scrolls; the column around it carries the border and fills the strip's height once it has.
 */
export function WidgetShell({ children }: { children: React.ReactNode }) {
  const href = widgetHref(useWidgetRoute());
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [href]);

  return (
    <SidebarProvider className="min-h-0 flex-1">
      <div className="hidden border-r border-hairline bg-sidebar lg:block">
        <Sidebar collapsible="none" className="sticky top-0 h-[calc(100svh-var(--column-rule))]">
          <WidgetNav />
        </Sidebar>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      <Toaster />
    </SidebarProvider>
  );
}

export type Crumb = { label: string; route?: WidgetRoute };

/**
 * Every view's frame: the header with the breadcrumb and the view's actions, then the content as a container-query
 * root, so a view lays itself out by the width it really has.
 */
export function ShellPage({ crumbs, actions, children }: { crumbs: readonly Crumb[]; actions?: React.ReactNode; children: React.ReactNode }) {
  const route = useWidgetRoute();
  const attention = useAttentionCount();

  return (
    <>
      <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-hairline bg-background/90 px-3 backdrop-blur lg:px-6">
        {/* Keyed by the route, so back and forward close the sheet as a click does. */}
        <NavSheet key={widgetHref(route)} />
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList className="flex-nowrap">
            {crumbs.map((crumb, i) => (
              <Fragment key={crumb.label}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem className="min-w-0">
                  {crumb.route ? (
                    <BreadcrumbLink href={widgetHref(crumb.route)} className="truncate">
                      {crumb.label}
                    </BreadcrumbLink>
                  ) : i === crumbs.length - 1 ? (
                    <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                  ) : (
                    <span className="truncate">{crumb.label}</span>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        {actions}
        {attention > 0 && (
          <Badge asChild variant="warning" className="h-7 px-2.5 text-sm lg:hidden">
            <a href={widgetHref({ view: "requests", filter: "attention" })} aria-label={`${attention} requests need your attention`}>
              <TriangleAlert /> {attention}
            </a>
          </Badge>
        )}
        {route.view !== "new" && (
          <Button asChild size="icon-sm" className="lg:hidden">
            <a href={widgetHref({ view: "new" })} aria-label="New request">
              <Plus />
            </a>
          </Button>
        )}
      </header>
      <main className="@container/main mx-auto w-full max-w-6xl p-3 lg:p-6">{children}</main>
    </>
  );
}
