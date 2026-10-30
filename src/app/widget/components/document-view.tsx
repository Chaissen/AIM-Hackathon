import { CalendarDate, Time } from "@/components/time";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { LabRow } from "@/server/documents/types";
import type { DocumentView as Doc } from "@/server/documents/view";

type LabResult = Extract<Doc, { type: "lab-result" }>;
type RehabReport = Extract<Doc, { type: "rehab-report" }>;

/** The heading of a report's sections, one level below the heading the document sits under. */
type SectionHeading = "h3" | "h4";

/** A held or filed answer as Dr. Hofer reads it: the lab table with range bars, or the rehab report's sections. */
export function DocumentView({ doc, sectionHeading }: { doc: Doc; sectionHeading: SectionHeading }) {
  switch (doc.type) {
    case "lab-result":
      return <LabResultView doc={doc} />;
    case "rehab-report":
      return <RehabReportView doc={doc} sectionHeading={sectionHeading} />;
    default:
      return doc satisfies never;
  }
}

function LabResultView({ doc }: { doc: LabResult }) {
  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        Sample taken <Time at={new Date(doc.sampleTaken)} /> · Reported <Time at={new Date(doc.reported)} />
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Test</TableHead>
            <TableHead>Result</TableHead>
            <TableHead className="hidden @md/main:table-cell">Reference range</TableHead>
            <TableHead className="hidden @md/main:table-cell">
              <span className="sr-only">Where the result sits in the range</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {doc.rows.map((row) => (
            <LabRowView key={`${row.loinc} ${row.test}`} row={row} />
          ))}
        </TableBody>
      </Table>
      {(doc.conclusion || doc.validatedBy) && (
        <p className="text-sm">
          {doc.conclusion} {doc.validatedBy && <span className="text-muted-foreground">Validated by {doc.validatedBy.raw}.</span>}
        </p>
      )}
    </div>
  );
}

const OUTSIDE: Record<"H" | "L", { arrow: string; text: string }> = {
  H: { arrow: "↑", text: "above the range" },
  L: { arrow: "↓", text: "below the range" },
};

function LabRowView({ row }: { row: LabRow }) {
  const outside = row.interpretation === "H" || row.interpretation === "L" ? OUTSIDE[row.interpretation] : null;
  const bar = <RangeBar row={row} outside={outside !== null} />;
  return (
    <TableRow>
      <TableCell className="whitespace-normal font-medium">{row.test}</TableCell>
      <TableCell className={cn("align-top @md/main:align-middle", outside && "font-semibold text-destructive")}>
        {row.valueText}
        {row.unitText && <span className="font-normal text-muted-foreground"> {row.unitText}</span>}
        {outside && (
          <>
            <span aria-hidden> {outside.arrow}</span>
            <span className="sr-only">, {outside.text}</span>
          </>
        )}
        <div className="grid gap-2 pt-1 text-xs font-normal text-muted-foreground @md/main:hidden">
          {row.rangeText}
          {bar}
        </div>
      </TableCell>
      <TableCell className="hidden text-muted-foreground @md/main:table-cell">{row.rangeText}</TableCell>
      <TableCell className="hidden @md/main:table-cell">{bar}</TableCell>
    </TableRow>
  );
}

/** The reference range as the middle three fifths of a bar, with the result as a marker on it. */
function RangeBar({ row, outside }: { row: LabRow; outside: boolean }) {
  if (row.low === null || row.high === null) return null;
  const position = Math.max(2, Math.min(98, 20 + ((row.value - row.low) / (row.high - row.low)) * 60));
  return (
    <div className="relative flex h-1.5 w-16 @md/main:w-24" role="img" aria-label={`${row.valueText} against ${row.rangeText}`}>
      <span className="w-1/5 bg-destructive/15" />
      <span className="w-3/5 bg-success/20" />
      <span className="w-1/5 bg-destructive/15" />
      <span className={cn("absolute -top-1 h-3.5 w-1 -translate-x-1/2", outside ? "bg-destructive" : "bg-loud")} style={{ left: `${position}%` }} />
    </div>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function RehabReportView({ doc, sectionHeading }: { doc: RehabReport; sectionHeading: SectionHeading }) {
  const nights = Math.round((Date.parse(doc.stay.end) - Date.parse(doc.stay.start)) / DAY_MS);
  return (
    <div className="grid max-w-prose gap-5 text-sm leading-relaxed">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        <dt className="text-muted-foreground">Stay</dt>
        <dd>
          <CalendarDate iso={doc.stay.start} /> to <CalendarDate iso={doc.stay.end} />
          <span className="text-muted-foreground"> · {nights + 1} days</span>
        </dd>
        {doc.reason && (
          <>
            <dt className="text-muted-foreground">Reason</dt>
            <dd>{doc.reason}</dd>
          </>
        )}
        {doc.writtenBy && (
          <>
            <dt className="text-muted-foreground">Written by</dt>
            <dd>{doc.writtenBy.raw}</dd>
          </>
        )}
        {doc.sentBy && (
          <>
            <dt className="text-muted-foreground">Sent by</dt>
            <dd>{doc.sentBy.raw}</dd>
          </>
        )}
      </dl>
      {doc.sections.map((section) => (
        <Section key={section.heading} as={sectionHeading} heading={section.heading} text={section.text} />
      ))}
    </div>
  );
}

/** A `##` section. Lines that all start with "- " are a list, as the parser keeps them. */
function Section({ as: Heading, heading, text }: { as: SectionHeading; heading: string; text: string }) {
  const lines = text.split("\n");
  const list = lines.every((line) => line.startsWith("- "));
  return (
    <section className="grid gap-1.5">
      <Heading className="text-sm">{heading}</Heading>
      {list ? (
        <ul className="list-disc space-y-1 pl-5">
          {lines.map((line) => (
            <li key={line}>{line.slice(2)}</li>
          ))}
        </ul>
      ) : (
        <p className="whitespace-pre-line">{text}</p>
      )}
    </section>
  );
}
