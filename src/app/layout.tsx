import type { Metadata } from "next";

import { TRPCReactProvider } from "@/trpc/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ordy",
  description: "Secure document requests from outside the PGK network, filed as FHIR R4",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <TRPCReactProvider>
          <div className="flex-1">{children}</div>
        </TRPCReactProvider>
        {/* Short form required by organisations/COMPLIANCE_AND_SAFETY.md, "Disclaimer". */}
        <footer className="px-4 py-4 text-center text-xs text-muted-foreground">
          Prototype with synthetic data. ID Austria is simulated. Not for clinical use.
        </footer>
      </body>
    </html>
  );
}
