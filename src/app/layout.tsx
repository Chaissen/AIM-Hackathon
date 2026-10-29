import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { TRPCReactProvider } from "@/trpc/react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ordy",
  description: "Secure document requests from outside the PGK network, filed as FHIR R4",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
