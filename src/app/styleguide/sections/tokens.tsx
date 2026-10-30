import { Logo } from "@/components/logo";
import { SectionLabel } from "@/components/section-label";

import { Block } from "./block";

const SWATCHES = [
  "background",
  "surface",
  "surface-2",
  "muted",
  "secondary",
  "hairline",
  "border",
  "strong",
  "muted-foreground",
  "dim",
  "foreground",
  "loud",
  "rose",
  "rose-surface",
  "destructive",
  "success",
  "warning",
] as const;

export function TokensSection() {
  return (
    <>
      <Block title="Colour tokens" wide>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {SWATCHES.map((name) => (
            <div key={name} className="grid gap-1.5">
              <div className="h-12 border border-border" style={{ background: `var(--${name})` }} />
              <span className="font-mono text-[11px] text-dim">{name}</span>
            </div>
          ))}
        </div>
      </Block>

      <Block id="type" title="Type" wide>
        <p className="text-5xl leading-none font-bold tracking-[-0.025em] text-loud font-heading font-stretch-[125%]">Display grotesk, 125%</p>
        <p className="text-3xl font-heading font-extrabold tracking-[-0.025em] text-loud">Heading, 112%</p>
        <p className="font-serif text-5xl leading-none font-extralight italic text-loud">for humans and agents</p>
        <p className="max-w-xl text-xl leading-normal font-light">Lead paragraph, 20px light. Secure document requests from outside the PGK network.</p>
        <p className="max-w-xl text-sm leading-[1.571]">Body, 14px. Hex is built with a full suite of tools, and so is ordy. Hairlines, eggplant text, rose accent.</p>
        <p className="eyebrow">Mono uppercase eyebrow</p>
        <SectionLabel>Section label on a rule</SectionLabel>
        <a href="#type" className="w-fit border-b border-current text-base font-light text-dim hover:text-loud">
          Text link with a hairline underline
        </a>
        <Logo />
      </Block>
    </>
  );
}
