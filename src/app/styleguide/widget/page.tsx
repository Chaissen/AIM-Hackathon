import { notFound } from "next/navigation";
import { Suspense } from "react";

// Development only, like /styleguide: the fixtures and the parser they use stay out of the production bundle.
// `?fixtures=` is read on the client, so the preview streams inside a Suspense boundary.
export default async function WidgetPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  } else {
    const { WidgetPreview } = await import("./preview");
    return (
      <Suspense fallback={null}>
        <WidgetPreview />
      </Suspense>
    );
  }
}
