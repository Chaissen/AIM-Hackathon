import { notFound } from "next/navigation";
import { Suspense } from "react";

// The gallery is imported only on the development branch, so a production build does not bundle recharts, shiki,
// embla and the other gallery-only libraries for a route that returns 404. The Suspense boundary streams the page,
// because the calendar reads today's date while rendering.
export default async function StyleguidePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  } else {
    const { Styleguide } = await import("./styleguide");
    return (
      <Suspense fallback={null}>
        <Styleguide />
      </Suspense>
    );
  }
}
