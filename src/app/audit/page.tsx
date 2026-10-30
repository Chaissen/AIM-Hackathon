import { ClinicAccess } from "@/components/clinic-access";
import { AuditTable } from "./audit-table";

export default function AuditPage() {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl">Audit log</h1>
      <ClinicAccess><AuditTable /></ClinicAccess>
    </main>
  );
}
