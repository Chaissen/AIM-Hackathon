import { ClinicAccess } from "@/components/clinic-access";
import { ClinicWorkspace } from "./workspace";

export default function Widget() {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-5">
      <ClinicAccess><ClinicWorkspace /></ClinicAccess>
    </main>
  );
}
