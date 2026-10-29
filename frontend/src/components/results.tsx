import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { RangeBar } from "@/components/status"
import { cn } from "@/lib/utils"
import { parseStay } from "@/lib/api"

export function LabTable({ doc }: { doc: any }) {
  return (
    <div className="grid gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Test</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Normal range</TableHead>
            <TableHead className="hidden sm:table-cell" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {doc.results.map((x: any) => {
            const out = x.interp === "H" || x.interp === "L"
            return (
              <TableRow key={x.loinc}>
                <TableCell className="font-medium">{x.test}</TableCell>
                <TableCell className={cn("whitespace-nowrap", out && "font-semibold text-red-700 dark:text-red-400")}>
                  {x.raw ?? x.value} {x.unitText && <span className="text-muted-foreground">{x.unitText}</span>}
                  {x.interp === "H" && " ↑"}
                  {x.interp === "L" && " ↓"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{x.rangeText}</TableCell>
                <TableCell className="hidden sm:table-cell"><RangeBar x={x} /></TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {(doc.free.length > 0 || doc.fields["Validated by"]) && (
        <p className="px-2 text-sm">
          {doc.free.join(" ")}{" "}
          {doc.fields["Validated by"] && <span className="text-muted-foreground">Validated by {doc.fields["Validated by"]}.</span>}
        </p>
      )}
    </div>
  )
}

export function RehabView({ doc }: { doc: any }) {
  const stay = parseStay(doc.fields.Stay)
  return (
    <div className="grid max-w-prose gap-5 text-sm leading-relaxed">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        <dt className="text-muted-foreground">Stay</dt>
        <dd>{doc.fields.Stay}{stay && <span className="text-muted-foreground"> · {Math.round((Date.parse(stay.end) - Date.parse(stay.start)) / 864e5) + 1} days</span>}</dd>
        <dt className="text-muted-foreground">Reason</dt>
        <dd>{doc.fields.Reason}</dd>
        <dt className="text-muted-foreground">Written by</dt>
        <dd>{doc.fields["Written by"]}</dd>
      </dl>
      {doc.order.map((s: string) => {
        const lines: string[] = doc.sections[s]
        const list = lines.every((l) => l.startsWith("-"))
        return (
          <section key={s} className="grid gap-1.5">
            <h3 className="font-semibold">{s}</h3>
            {list ? (
              <ul className="list-disc space-y-1 pl-5">{lines.map((l) => <li key={l}>{l.replace(/^-\s*/, "")}</li>)}</ul>
            ) : (
              <p>{lines.join(" ")}</p>
            )}
          </section>
        )
      })}
    </div>
  )
}
