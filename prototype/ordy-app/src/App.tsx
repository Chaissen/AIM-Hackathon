import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useRoute } from "@/lib/store"
import { OverviewPage, RequestsPage } from "@/pages/requests"
import { RequestPage } from "@/pages/request-detail"
import { NewRequestPage } from "@/pages/new-request"
import { AuditPage, ContactsPage, MetricsPage, OutboxPage, PatientPage, PatientsPage } from "@/pages/other"
import { PortalPage } from "@/pages/portal"

function Page() {
  const route = useRoute()
  switch (route.view) {
    case "requests": return <RequestsPage />
    case "request": return <RequestPage key={route.id} id={route.id} />
    case "new": return <NewRequestPage />
    case "patients": return <PatientsPage />
    case "patient": return <PatientPage id={route.id} />
    case "contacts": return <ContactsPage />
    case "audit": return <AuditPage />
    case "metrics": return <MetricsPage />
    case "outbox": return <OutboxPage />
    case "portal": return <PortalPage key={route.token} token={route.token} />
    default: return <OverviewPage />
  }
}

export default function App() {
  return (
    <TooltipProvider>
      <Page />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}
