"use client";

import { TooltipProvider } from "@/components/ui/tooltip";

import { AppSection } from "./sections/app";
import { ButtonsSection } from "./sections/buttons";
import { ConversationSection } from "./sections/conversation";
import { DisplaySection } from "./sections/display";
import { FormsSection } from "./sections/forms";
import { NavigationSection } from "./sections/navigation";
import { OverlaysSection } from "./sections/overlays";
import { PanelsSection } from "./sections/panels";
import { TokensSection } from "./sections/tokens";

export function Styleguide() {
  return (
    <TooltipProvider>
      <main className="mx-auto w-full max-w-5xl px-6 pb-20">
        <section className="relative isolate overflow-hidden border-b border-hairline py-16 text-center">
          <div aria-hidden className="hero-grid absolute inset-0 -z-10" />
          <p className="eyebrow">Development only</p>
          <h1 className="mt-4 text-[clamp(40px,6vw,64px)] leading-none font-stretch-[125%]">Styleguide</h1>
          <p className="mx-auto mt-4 max-w-xl text-xl font-light">
            Every component, <em className="font-serif text-[1.3em] leading-none font-light text-loud">as Hex would draw it</em>.
          </p>
        </section>
        <TokensSection />
        <ButtonsSection />
        <FormsSection />
        <DisplaySection />
        <OverlaysSection />
        <NavigationSection />
        <PanelsSection />
        <ConversationSection />
        <AppSection />
      </main>
    </TooltipProvider>
  );
}
