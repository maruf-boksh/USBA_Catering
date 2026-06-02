import { useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { FileBarChart, Columns3, Eye, CheckCheck, Square, Filter as FilterIcon, Plus, X, FileText, FileSpreadsheet, FileType2 } from "lucide-react";
import { toast } from "sonner";
import { useAllRoles, useAccess, canElement, columnElementId, ADMIN_ROLE } from "@/lib/access-control";
import { REPORT_DATASETS, getDataset, type ReportColumn } from "@/lib/report-datasets";

// ── Row filters ───────────────────────────────────────────────────────────────
type FilterOp = "contains" | "eq" | "neq" | "gt" | "lt" | "gte" | "lte";
type Filter = { id: number; col: string; op: FilterOp; value: string };

const OPERATORS: { value: FilterOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
];

/**
 * Order-compare a row value against a filter value. Picks the right mode so the
 * comparison operators work for numbers, dates AND plain text:
 *   • both pure numbers      → numeric compare
 *   • both parse as dates    → chronological compare
 *   • otherwise              → case-insensitive lexical compare
 * Returns negative / 0 / positive like a comparator (a vs b).
 */
function compareValues(rawA: unknown, rawB: string): number {
  const sa = String(rawA ?? "").trim();
  const sb = rawB.trim();
  const numA = Number(sa), numB = Number(sb);
  if (sa !== "" && sb !== "" && !Number.isNaN(numA) && !Number.isNaN(numB)) {
    return numA - numB;
  }
  const dA = Date.parse(sa), dB = Date.parse(sb);
  if (!Number.isNaN(dA) && !Number.isNaN(dB)) {
    return dA - dB;
  }
  return sa.toLowerCase().localeCompare(sb.toLowerCase());
}

/** Does a row satisfy one filter rule? Empty value = no-op (ignored). */
function matchesFilter(row: Record<string, unknown>, colDef: ReportColumn | undefined, f: Filter): boolean {
  if (!colDef || f.value.trim() === "") return true;
  const raw = colDef.get(row);
  const s = String(raw ?? "").toLowerCase();
  const fv = f.value.trim().toLowerCase();
  switch (f.op) {
    case "contains": return s.includes(fv);
    case "eq": return s === fv;
    case "neq": return s !== fv;
    case "gt": return compareValues(raw, f.value) > 0;
    case "lt": return compareValues(raw, f.value) < 0;
    case "gte": return compareValues(raw, f.value) >= 0;
    case "lte": return compareValues(raw, f.value) <= 0;
    default: return true;
  }
}

// ── Export helpers ──────────────────────────────────────────────────────────
// Heavy libs (jspdf, xlsx) are dynamically imported so they don't weigh down the
// initial bundle — only loaded when the user actually exports.

function buildMatrix(cols: ReportColumn[], rows: Record<string, unknown>[]) {
  return {
    header: cols.map((c) => c.label),
    body: rows.map((r) => cols.map((c) => c.get(r))),
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv(filename: string, cols: ReportColumn[], rows: Record<string, unknown>[]) {
  const { header, body } = buildMatrix(cols, rows);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [header.map(esc).join(","), ...body.map((r) => r.map(esc).join(","))];
  // BOM so Excel reads UTF-8 correctly.
  downloadBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" }), `${filename}.csv`);
}

async function exportXlsx(filename: string, cols: ReportColumn[], rows: Record<string, unknown>[]) {
  const mod = (await import("xlsx-js-style")) as unknown as { default?: unknown };
  const XLSX = (mod.default ?? mod) as typeof import("xlsx-js-style");
  const { header, body } = buildMatrix(cols, rows);
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  header.forEach((_, i) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c: i });
    const cell = (ws as Record<string, { s?: unknown }>)[ref];
    if (cell) cell.s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "DC2626" } }, alignment: { horizontal: "left" } };
  });
  (ws as Record<string, unknown>)["!cols"] = header.map((h, i) =>
    ({ wch: Math.min(45, Math.max(String(h).length, ...body.map((r) => String(r[i] ?? "").length), 6) + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

async function exportPdf(filename: string, title: string, subtitle: string, cols: ReportColumn[], rows: Record<string, unknown>[]) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: cols.length > 5 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 32;
  const usableW = pageW - margin * 2;
  const colW = usableW / cols.length;
  const rowH = 16;
  let y = margin;

  const fit = (txt: unknown, w: number) => doc.splitTextToSize(String(txt ?? ""), w)[0] ?? "";

  doc.setFont("helvetica", "bold").setFontSize(14);
  doc.text(title, margin, y); y += 16;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  doc.text(subtitle, margin, y); y += 14;
  doc.setTextColor(30);

  const drawHeader = () => {
    doc.setFillColor(220, 38, 38).rect(margin, y, usableW, rowH, "F");
    doc.setTextColor(255).setFont("helvetica", "bold").setFontSize(8);
    cols.forEach((c, i) => doc.text(fit(c.label, colW - 6), margin + i * colW + 4, y + 11));
    y += rowH;
    doc.setTextColor(30).setFont("helvetica", "normal");
  };
  drawHeader();
  rows.forEach((row, ri) => {
    if (y + rowH > pageH - margin) { doc.addPage(); y = margin; drawHeader(); }
    if (ri % 2 === 1) doc.setFillColor(245, 245, 247).rect(margin, y, usableW, rowH, "F");
    doc.setFontSize(8).setTextColor(30);
    cols.forEach((c, i) => doc.text(fit(c.get(row), colW - 6), margin + i * colW + 4, y + 11));
    y += rowH;
  });
  doc.save(`${filename}.pdf`);
}

export default function ReportBuilderPage() {
  const roles = useAllRoles();
  const access = useAccess();
  const [datasetKey, setDatasetKey] = useState(REPORT_DATASETS[0]?.key ?? "");
  const [role, setRole] = useState<string>(ADMIN_ROLE);
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Filter[]>([]);
  const [generated, setGenerated] = useState<{ cols: string[]; ds: string; role: string } | null>(null);
  const filterId = useRef(0);

  const dataset = getDataset(datasetKey);

  // Columns the chosen role is permitted to view (role scopes the columns).
  const availableCols = useMemo(() => {
    if (!dataset) return [];
    return dataset.columns.filter((c) =>
      canElement(role, dataset.route, columnElementId(c.key), "view", access),
    );
  }, [dataset, role, access]);

  // Keep selection within the available set when dataset/role changes.
  const effectiveSelected = useMemo(
    () => availableCols.filter((c) => selectedCols.has(c.key)),
    [availableCols, selectedCols],
  );

  const toggleCol = (key: string) =>
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const selectAll = () => setSelectedCols(new Set(availableCols.map((c) => c.key)));
  const clearAll = () => setSelectedCols(new Set());

  // ── Filters ──────────────────────────────────────────────────────────────
  const addFilter = () => {
    const first = availableCols[0];
    if (!first) return;
    setFilters((prev) => [...prev, { id: ++filterId.current, col: first.key, op: "contains", value: "" }]);
  };
  const updateFilter = (id: number, patch: Partial<Filter>) =>
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeFilter = (id: number) => setFilters((prev) => prev.filter((f) => f.id !== id));

  // Sniff a column's value type from the data so the filter value field can be a
  // date picker / number input (and so the right comparison kicks in).
  const columnInputType = (colKey: string): "date" | "number" | "text" => {
    if (!dataset) return "text";
    const colDef = dataset.columns.find((c) => c.key === colKey);
    if (!colDef) return "text";
    for (const row of dataset.rows()) {
      const s = String(colDef.get(row) ?? "").trim();
      if (s === "") continue;
      if (!Number.isNaN(Number(s))) return "number";
      if (!Number.isNaN(Date.parse(s))) return "date";
      return "text";
    }
    return "text";
  };

  // Only keep filters whose column the role may still view (role/dataset changes).
  const activeFilters = useMemo(
    () => filters.filter((f) => availableCols.some((c) => c.key === f.col)),
    [filters, availableCols],
  );

  const generate = () => {
    if (!dataset || effectiveSelected.length === 0) return;
    setGenerated({ cols: effectiveSelected.map((c) => c.key), ds: dataset.key, role });
  };

  const onPickDataset = (key: string) => {
    setDatasetKey(key);
    setSelectedCols(new Set());
    setFilters([]);
    setGenerated(null);
  };
  const onPickRole = (r: string) => {
    setRole(r);
    setGenerated(null);
  };

  // Resolve the generated report (columns + filtered rows) for preview. Filters
  // apply live, so tweaking a rule updates the preview without re-generating.
  const report = useMemo(() => {
    if (!generated) return null;
    const ds = getDataset(generated.ds);
    if (!ds) return null;
    const cols = ds.columns.filter((c) => generated.cols.includes(c.key));
    const allRows = ds.rows();
    const colByKey = new Map(ds.columns.map((c) => [c.key, c]));
    const rows = activeFilters.length === 0
      ? allRows
      : allRows.filter((row) => activeFilters.every((f) => matchesFilter(row, colByKey.get(f.col), f)));
    return { ds, cols, rows, total: allRows.length };
  }, [generated, activeFilters]);

  const onExport = async (kind: "csv" | "xlsx" | "pdf") => {
    if (!report || report.rows.length === 0) return;
    const fileBase = `${report.ds.label.replace(/[^\w]+/g, "-").toLowerCase()}-report`;
    const subtitle = `Role: ${generated!.role} · ${report.cols.length} columns · ${report.rows.length}`
      + `${activeFilters.length ? ` of ${report.total}` : ""} rows`
      + `${activeFilters.length ? ` · ${activeFilters.length} filter(s)` : ""}`;
    try {
      if (kind === "csv") exportCsv(fileBase, report.cols, report.rows);
      else if (kind === "xlsx") await exportXlsx(fileBase, report.cols, report.rows);
      else await exportPdf(fileBase, `${report.ds.label} — report`, subtitle, report.cols, report.rows);
      toast.success(`Exported ${report.rows.length} row${report.rows.length === 1 ? "" : "s"} as ${kind.toUpperCase()}.`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <PageHeader
        title="Report Builder"
        subtitle="Build a report by picking a dataset, a role, and the columns that role may view. The selected role scopes which columns are available."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Dataset */}
        <Card>
          <CardContent className="py-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">1 · Dataset</div>
            <div className="flex flex-col gap-1.5">
              {REPORT_DATASETS.map((ds) => (
                <button
                  key={ds.key}
                  type="button"
                  onClick={() => onPickDataset(ds.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border text-left transition-colors ${
                    datasetKey === ds.key ? "bg-primary text-primary-foreground border-primary" : "bg-white text-foreground border-border hover:bg-muted"
                  }`}
                >
                  <FileBarChart className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{ds.label}</span>
                  <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${datasetKey === ds.key ? "border-white/40 text-primary-foreground" : ""}`}>
                    {ds.columns.length} cols
                  </Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Role */}
        <Card>
          <CardContent className="py-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">2 · Role (scopes columns)</div>
            <select
              value={role}
              onChange={(e) => onPickRole(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <p className="text-[11px] text-muted-foreground mt-2">
              {role === ADMIN_ROLE
                ? "GM/Admin can report on every column."
                : `Only columns "${role}" is permitted to view are selectable. Adjust in Configuration → User Access Control.`}
            </p>
            <div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <strong className="text-foreground tabular-nums">{availableCols.length}</strong> of{" "}
              <strong className="text-foreground tabular-nums">{dataset?.columns.length ?? 0}</strong> columns available to this role
            </div>
          </CardContent>
        </Card>

        {/* Columns */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">3 · Columns</div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={selectAll}><CheckCheck className="h-3.5 w-3.5 mr-1" /> All</Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={clearAll}><Square className="h-3.5 w-3.5 mr-1" /> None</Button>
              </div>
            </div>
            <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
              {availableCols.length === 0 && (
                <div className="text-xs text-muted-foreground py-4 text-center">This role has no viewable columns for this dataset.</div>
              )}
              {availableCols.map((c) => (
                <label key={c.key} className="flex items-center gap-2.5 text-sm cursor-pointer py-0.5">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={selectedCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                  <Columns3 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-foreground">{c.label}</span>
                </label>
              ))}
            </div>
            <Button className="w-full mt-3" disabled={effectiveSelected.length === 0} onClick={generate}>
              <Eye className="h-4 w-4 mr-1.5" /> Generate report ({effectiveSelected.length})
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mt-4">
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <FilterIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Filters</span>
              {activeFilters.length > 0 && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{activeFilters.length} active</Badge>
              )}
            </div>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={addFilter} disabled={availableCols.length === 0}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add filter
            </Button>
          </div>

          {filters.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No filters — the report shows all rows. Add a rule to narrow by a column value (rules combine with AND).
            </p>
          ) : (
            <div className="space-y-2">
              {filters.map((f) => {
                const stale = !availableCols.some((c) => c.key === f.col);
                return (
                  <div key={f.id} className="flex items-center gap-2 flex-wrap">
                    <select
                      value={f.col}
                      onChange={(e) => updateFilter(f.id, { col: e.target.value, value: "" })}
                      className={`rb-filter-col rounded-md border bg-background px-2 py-1.5 text-sm min-w-[140px] ${stale ? "border-destructive text-destructive" : "border-border"}`}
                    >
                      {stale && <option value={f.col}>{f.col} (unavailable)</option>}
                      {availableCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <select
                      value={f.op}
                      onChange={(e) => updateFilter(f.id, { op: e.target.value as FilterOp })}
                      className="rb-filter-op rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <Input
                      type={columnInputType(f.col)}
                      value={f.value}
                      onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                      placeholder="value"
                      className="rb-filter-val h-9 w-44"
                    />
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeFilter(f.id)} title="Remove filter">
                      <X className="h-4 w-4" />
                    </Button>
                    {stale && <span className="text-[11px] text-destructive">column not available for this role — ignored</span>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview */}
      {report && (
        <Card className="mt-4">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <div className="text-sm font-semibold text-foreground">{report.ds.label} — report</div>
                <div className="text-xs text-muted-foreground">
                  Role: <strong className="text-foreground">{generated!.role}</strong> · {report.cols.length} columns ·{" "}
                  {activeFilters.length > 0
                    ? <><strong className="text-foreground">{report.rows.length}</strong> of {report.total} rows ({activeFilters.length} filter{activeFilters.length > 1 ? "s" : ""})</>
                    : <>{report.rows.length} rows</>}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1">Export</span>
                <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" disabled={report.rows.length === 0} onClick={() => onExport("csv")}>
                  <FileText className="h-3.5 w-3.5 mr-1" /> CSV
                </Button>
                <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" disabled={report.rows.length === 0} onClick={() => onExport("xlsx")}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Excel
                </Button>
                <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" disabled={report.rows.length === 0} onClick={() => onExport("pdf")}>
                  <FileType2 className="h-3.5 w-3.5 mr-1" /> PDF
                </Button>
              </div>
            </div>
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    {report.cols.map((c) => (
                      <TableHead key={c.key} className="text-[10px] uppercase tracking-wider whitespace-nowrap">{c.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={report.cols.length} className="text-center text-sm text-muted-foreground py-8">
                        No rows match the current filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.rows.map((row, i) => (
                      <TableRow key={(row.id as string) ?? i}>
                        {report.cols.map((c) => (
                          <TableCell key={c.key} className="text-sm whitespace-nowrap tabular-nums">{c.get(row)}</TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
