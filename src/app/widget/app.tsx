"use client";

import { Button } from "@/components/ui/button";

import { useWorkspace } from "../workspace/context";
import { MessagesView } from "../workspace/messages";
import { DraftProvider } from "./draft";
import { WidgetShell } from "./shell";
import { useWidgetRoute } from "./use-widget-route";
import { AuditView } from "./views/audit";
import { ContactsView } from "./views/contacts";
import { MetricsView } from "./views/metrics";
import { NewRequestView } from "./views/new-request";
import { OverviewView } from "./views/overview";
import { PatientView } from "./views/patient";
import { PatientsView } from "./views/patients";
import { RequestView } from "./views/request";
import { RequestsView } from "./views/requests";
import { widgetHref, type WidgetRoute } from "./widget-route";

export function WidgetApp() {
  const route = useWidgetRoute();
  return (
    <DraftProvider>
      <WidgetShell>
        <View route={route} />
      </WidgetShell>
    </DraftProvider>
  );
}

function View({ route }: { route: WidgetRoute }) {
  const workspace = useWorkspace();
  switch (route.view) {
    case "overview":
      return <OverviewView />;
    case "requests":
      return <RequestsView filter={route.filter} />;
    case "request":
      return <RequestView id={route.id} />;
    case "new":
      return <NewRequestView />;
    case "patients":
      return <PatientsView />;
    case "patient":
      return <PatientView id={route.id} />;
    case "contacts":
      return <ContactsView />;
    case "messages":
      return workspace ? <MessagesView room={route.room} /> : (
        <div className="grid justify-items-start gap-3 p-6">
          <h1 className="text-2xl">Messages</h1>
          <p className="text-sm text-dim">Conversations are available in the full ordy workspace.</p>
          <Button asChild><a href={`/${widgetHref(route)}`} target="_blank" rel="noopener">Open workspace</a></Button>
        </div>
      );
    case "audit":
      return <AuditView event={route.event} />;
    case "metrics":
      return <MetricsView />;
    default:
      return route satisfies never;
  }
}
