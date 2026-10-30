import { cn } from "@/lib/utils";

/** A mono uppercase label centred on a hairline, bracketed by two short ticks, as Hex sets its section labels. */
export function SectionLabel({
  as: Tag = "p",
  className,
  children,
}: {
  as?: "p" | "h2" | "h3" | "span";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span aria-hidden className="h-px flex-1 bg-border" />
      <Tag className="eyebrow border-x border-border px-3 font-normal">{children}</Tag>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}
