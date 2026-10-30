import type { Metadata } from "next";
import { Archivo, Geist, IBM_Plex_Mono, Newsreader } from "next/font/google";

import { cn } from "@/lib/utils";
import { TRPCReactProvider } from "@/trpc/react";
import "./globals.css";

// Open substitutes for Hex's commercial faces, self-hosted at build time so the browser never calls Google.
const body = Geist({ subsets: ["latin"], variable: "--font-body" });
const display = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display" });
const serif = Newsreader({ subsets: ["latin"], style: ["italic"], axes: ["opsz"], variable: "--font-serif-italic" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono-face" });

export const metadata: Metadata = {
  title: "ordy",
  description: "Secure document requests from outside the PGK network, filed as FHIR R4",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn("h-full antialiased", body.variable, display.variable, serif.variable, mono.variable)}>
      <body className="hatch flex min-h-full flex-col">
        {/* --column-rule is the strip's height, so the widget's sticky sidebar can leave room for it. */}
        <div className="mx-2 flex min-h-full flex-1 flex-col border-x border-border bg-background [--column-rule:--spacing(5)] sm:mx-4 lg:mx-[25px]">
          <div aria-hidden className="column-rules h-(--column-rule) shrink-0 border-b border-hairline" />
          <TRPCReactProvider>
            <div className="flex flex-1 flex-col">{children}</div>
          </TRPCReactProvider>
          {/* Short form required by docs/COMPLIANCE_AND_SAFETY.md, "Disclaimer". */}
          <footer className="border-t border-hairline px-4 py-4 text-center">
            <p className="eyebrow text-xs">Prototype with synthetic data. ID Austria is simulated. Not for clinical use.</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
