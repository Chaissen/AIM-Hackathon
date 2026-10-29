// The four metric results in one table, for the README (docs/WHITEPAPER.md, "How we measure the metrics").
import path from "node:path";

export type MetricStatus = "met" | "missed" | "blocked";
export type Metric = { name: string; target: string; result: string; status: MetricStatus };

export const METRICS_DIR = path.join("out", "metrics");

const STATUS_LABEL: Record<MetricStatus, string> = { met: "met", missed: "missed", blocked: "not measured" };

export function metricsMarkdown(metrics: Metric[], at: Date): string {
  const rows = metrics.map((m) => `| ${m.name} | ${m.target} | ${m.result} | ${STATUS_LABEL[m.status]} |`);
  return [
    `Metric results from \`pnpm scenario\` on ${at.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    "",
    "| Metric | Target | Result | Status |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
