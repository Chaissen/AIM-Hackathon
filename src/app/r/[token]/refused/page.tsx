import { Refusal } from "@/components/portal/portal-frame";

// GET /r/{token}/refused: after a failed identity check (M1, M2). The same page for every link, so it tells nothing.
export default function RefusedPage() {
  return <Refusal />;
}
