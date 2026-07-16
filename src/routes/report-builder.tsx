import { useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { FileBarChart, Columns3, Eye, CheckCheck, Square, Filter as FilterIcon, Plus, X, FileText, FileSpreadsheet, FileType2, Database, ShieldCheck, Table2, UserCircle2, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAccess, canElement, columnElementId, ADMIN_ROLE } from "@/lib/access-control";
import { useRole } from "@/lib/roles";
import { REPORT_DATASETS, getDataset, type ReportColumn } from "@/lib/report-datasets";

// ── Row filters ───────────────────────────────────────────────────────────────
// A filter is scoped to a specific dataset (report) + column so it only narrows
// that report's rows. `between` uses value (from) + value2 (to) → date/number
// range; `empty` / `nempty` need no value.
type FilterOp = "contains" | "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "between" | "empty" | "nempty";
type Filter = { id: number; ds: string; col: string; op: FilterOp; value: string; value2?: string };

const OPERATORS: { value: FilterOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "between", label: "range (from–to)" },
  { value: "empty", label: "is empty" },
  { value: "nempty", label: "is not empty" },
];

// Soft, professional accent themes cycled across report tabs so each report is
// easy to tell apart at a glance (tab chip + its preview panel background).
const TAB_THEMES = [
  { trigger: "border-sky-200 text-sky-700 hover:bg-sky-50 data-[state=active]:bg-sky-100 data-[state=active]:text-sky-800 data-[state=active]:border-sky-300",           panel: "bg-sky-50/50 border-sky-200" },
  { trigger: "border-emerald-200 text-emerald-700 hover:bg-emerald-50 data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-800 data-[state=active]:border-emerald-300", panel: "bg-emerald-50/50 border-emerald-200" },
  { trigger: "border-violet-200 text-violet-700 hover:bg-violet-50 data-[state=active]:bg-violet-100 data-[state=active]:text-violet-800 data-[state=active]:border-violet-300",   panel: "bg-violet-50/50 border-violet-200" },
  { trigger: "border-amber-200 text-amber-700 hover:bg-amber-50 data-[state=active]:bg-amber-100 data-[state=active]:text-amber-800 data-[state=active]:border-amber-300",       panel: "bg-amber-50/50 border-amber-200" },
  { trigger: "border-rose-200 text-rose-700 hover:bg-rose-50 data-[state=active]:bg-rose-100 data-[state=active]:text-rose-800 data-[state=active]:border-rose-300",           panel: "bg-rose-50/50 border-rose-200" },
  { trigger: "border-teal-200 text-teal-700 hover:bg-teal-50 data-[state=active]:bg-teal-100 data-[state=active]:text-teal-800 data-[state=active]:border-teal-300",           panel: "bg-teal-50/50 border-teal-200" },
  { trigger: "border-indigo-200 text-indigo-700 hover:bg-indigo-50 data-[state=active]:bg-indigo-100 data-[state=active]:text-indigo-800 data-[state=active]:border-indigo-300", panel: "bg-indigo-50/50 border-indigo-200" },
  { trigger: "border-cyan-200 text-cyan-700 hover:bg-cyan-50 data-[state=active]:bg-cyan-100 data-[state=active]:text-cyan-800 data-[state=active]:border-cyan-300",           panel: "bg-cyan-50/50 border-cyan-200" },
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
  if (!colDef) return true;
  const raw = colDef.get(row);
  const s = String(raw ?? "").trim();
  // Presence checks — no value needed.
  if (f.op === "empty") return s === "";
  if (f.op === "nempty") return s !== "";
  // Range (from–to) — either bound may be blank (open-ended); both blank = no-op.
  if (f.op === "between") {
    const lo = f.value.trim();
    const hi = (f.value2 ?? "").trim();
    if (lo === "" && hi === "") return true;
    const okLo = lo === "" || compareValues(raw, lo) >= 0;
    const okHi = hi === "" || compareValues(raw, hi) <= 0;
    return okLo && okHi;
  }
  if (f.value.trim() === "") return true;
  const sl = s.toLowerCase();
  const fv = f.value.trim().toLowerCase();
  switch (f.op) {
    case "contains": return sl.includes(fv);
    case "eq": return sl === fv;
    case "neq": return sl !== fv;
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
  const { role } = useRole();               // auto-selected from the signed-in system user
  const access = useAccess();
  // Multiple reports (datasets) can be selected at once — each downloads on its own.
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>(
    [REPORT_DATASETS[0]?.key ?? ""].filter(Boolean),
  );
  // Column selection is kept per dataset (report).
  const [colsByDs, setColsByDs] = useState<Record<string, Set<string>>>({});
  const [filters, setFilters] = useState<Filter[]>([]);
  // Generated = data populated (else the table is blank). Once generated it stays
  // on, so adding/removing reports or columns never closes the open report.
  const [generated, setGenerated] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>("");   // controlled tab so adding a report keeps the view
  const [removeMode, setRemoveMode] = useState(false);       // show a × on each tab
  const [removeAllOpen, setRemoveAllOpen] = useState(false); // "Remove all" confirmation
  const filterId = useRef(0);

  // Can this role view a given dataset column? (role scopes the columns).
  const canViewCol = (ds: { route: string }, key: string) =>
    canElement(role, ds.route, columnElementId(key), "view", access);

  // Reports (datasets) this role is permitted to report on — has ≥1 viewable column.
  const permissibleDatasets = useMemo(
    () => REPORT_DATASETS.filter((ds) => ds.columns.some((c) => canViewCol(ds, c.key))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, access],
  );

  // Role-scoped columns available for a given dataset.
  const availableColsFor = (dsKey: string): ReportColumn[] => {
    const ds = getDataset(dsKey);
    if (!ds) return [];
    return ds.columns.filter((c) => canViewCol(ds, c.key));
  };

  // Datasets that are both selected AND permissible for the current role.
  const effectiveDatasets = useMemo(
    () => selectedDatasets.filter((k) => permissibleDatasets.some((d) => d.key === k)),
    [selectedDatasets, permissibleDatasets],
  );

  // Selected columns for a dataset, limited to what the role may view.
  const effectiveColsFor = (dsKey: string): ReportColumn[] => {
    const chosen = colsByDs[dsKey] ?? new Set<string>();
    return availableColsFor(dsKey).filter((c) => chosen.has(c.key));
  };

  const totalSelectedCols = useMemo(
    () => effectiveDatasets.reduce((n, k) => n + effectiveColsFor(k).length, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveDatasets, colsByDs, role, access],
  );

  // ── Selection handlers ─────────────────────────────────────────────────────
  // Adding/removing a report or toggling columns never blanks an already-open
  // report — the preview stays generated and updates live.
  const toggleDataset = (key: string) => {
    setSelectedDatasets((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };
  const toggleCol = (dsKey: string, colKey: string) => {
    setColsByDs((prev) => {
      const cur = new Set(prev[dsKey] ?? []);
      if (cur.has(colKey)) cur.delete(colKey); else cur.add(colKey);
      return { ...prev, [dsKey]: cur };
    });
  };
  const selectAllCols = (dsKey: string) =>
    setColsByDs((prev) => ({ ...prev, [dsKey]: new Set(availableColsFor(dsKey).map((c) => c.key)) }));
  const clearCols = (dsKey: string) =>
    setColsByDs((prev) => ({ ...prev, [dsKey]: new Set() }));

  // Remove a single report (its columns + filters go with it); stay on the page.
  const removeDataset = (key: string) => {
    setSelectedDatasets((prev) => prev.filter((k) => k !== key));
    setColsByDs((prev) => { const next = { ...prev }; delete next[key]; return next; });
    setFilters((prev) => prev.filter((f) => f.ds !== key));
  };
  // Remove every selected report at once (from the confirm dialog); stay here.
  const removeAll = () => {
    setSelectedDatasets([]);
    setColsByDs({});
    setFilters([]);
    setGenerated(false);
    setRemoveMode(false);
    setRemoveAllOpen(false);
  };

  // ── Filters ──────────────────────────────────────────────────────────────
  const addFilter = () => {
    const firstDs = effectiveDatasets[0];
    if (!firstDs) return;
    const firstCol = availableColsFor(firstDs)[0];
    if (!firstCol) return;
    // A date column defaults to an inline from–to range; everything else to "contains".
    const op: FilterOp = columnInputType(firstDs, firstCol.key) === "date" ? "between" : "contains";
    setFilters((prev) => [...prev, { id: ++filterId.current, ds: firstDs, col: firstCol.key, op, value: "", value2: "" }]);
  };
  const updateFilter = (id: number, patch: Partial<Filter>) =>
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeFilter = (id: number) => setFilters((prev) => prev.filter((f) => f.id !== id));

  // Sniff a column's value type so the filter value field is a date / number
  // picker (and so the right comparison kicks in).
  const columnInputType = (dsKey: string, colKey: string): "date" | "number" | "text" => {
    const ds = getDataset(dsKey);
    const colDef = ds?.columns.find((c) => c.key === colKey);
    if (!ds || !colDef) return "text";
    for (const row of ds.rows()) {
      const s = String(colDef.get(row) ?? "").trim();
      if (s === "") continue;
      if (!Number.isNaN(Number(s))) return "number";
      if (!Number.isNaN(Date.parse(s))) return "date";
      return "text";
    }
    return "text";
  };

  // Keep only filters whose dataset is selected and whose column the role may view.
  const activeFilters = useMemo(
    () => filters.filter((f) => effectiveDatasets.includes(f.ds) && availableColsFor(f.ds).some((c) => c.key === f.col)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters, effectiveDatasets, role, access],
  );

  const generate = () => {
    if (totalSelectedCols === 0) return;
    setGenerated(true);
  };

  // ── Per-report resolution ──────────────────────────────────────────────────
  // Each selected report contributes its (role-scoped, chosen) columns and its
  // own filtered rows. Headers are always live (blank preview); rows only
  // populate once "Generate report" is clicked. Each report downloads on its own.
  const reports = useMemo(() => {
    return effectiveDatasets
      .map((dsKey) => {
        const ds = getDataset(dsKey)!;
        const cols = effectiveColsFor(dsKey);
        const dsFilters = activeFilters.filter((f) => f.ds === dsKey);
        const colByKey = new Map(ds.columns.map((c) => [c.key, c]));
        const rows = dsFilters.length === 0
          ? ds.rows()
          : ds.rows().filter((row) => dsFilters.every((f) => matchesFilter(row, colByKey.get(f.col), f)));
        return { ds, cols, rows, total: ds.rows().length, filters: dsFilters };
      })
      .filter((g) => g.cols.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveDatasets, colsByDs, activeFilters, role, access]);

  type ReportGroup = { ds: { key: string; label: string }; cols: ReportColumn[]; rows: Record<string, unknown>[]; total: number; filters: Filter[] };

  // Write one report's file (no toast — the callers handle messaging).
  const exportGroupFile = async (kind: "csv" | "xlsx" | "pdf", g: ReportGroup) => {
    const fileBase = `${g.ds.label.replace(/[^\w]+/g, "-").toLowerCase()}-report`;
    const subtitle = `Role: ${role} · ${g.cols.length} columns · ${g.rows.length}`
      + `${g.filters.length ? ` of ${g.total}` : ""} rows`
      + `${g.filters.length ? ` · ${g.filters.length} filter(s)` : ""}`;
    if (kind === "csv") exportCsv(fileBase, g.cols, g.rows);
    else if (kind === "xlsx") await exportXlsx(fileBase, g.cols, g.rows);
    else await exportPdf(fileBase, `${g.ds.label} — report`, subtitle, g.cols, g.rows);
  };

  // Download a single report on its own.
  const onExportGroup = async (kind: "csv" | "xlsx" | "pdf", g: ReportGroup) => {
    if (!generated || g.rows.length === 0) return;
    try {
      await exportGroupFile(kind, g);
      toast.success(`Exported ${g.rows.length} row${g.rows.length === 1 ? "" : "s"} as ${kind.toUpperCase()}.`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  };

  // Download every selected report at once (one file each).
  const downloadAll = async (kind: "csv" | "xlsx" | "pdf") => {
    if (!generated) return;
    const usable = reports.filter((g) => g.rows.length > 0);
    if (usable.length === 0) { toast.error("No rows to download in the selected reports."); return; }
    try {
      for (const g of usable) await exportGroupFile(kind, g);
      toast.success(`Downloaded ${usable.length} report${usable.length === 1 ? "" : "s"} as ${kind.toUpperCase()}.`);
    } catch (e) {
      toast.error(`Download failed: ${(e as Error).message}`);
    }
  };

  // One report's preview panel (meta + its own download buttons + table). Reused
  // for the single-report card and each tab of the multi-report view.
  const reportPanel = (g: ReportGroup) => (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Database className="h-4 w-4 text-muted-foreground" /> {g.ds.label} — report
          </div>
          <div className="text-xs text-muted-foreground">
            Role: <strong className="text-foreground">{role}</strong> · {g.cols.length} columns ·{" "}
            {generated
              ? (g.filters.length > 0
                  ? <><strong className="text-foreground">{g.rows.length}</strong> of {g.total} rows ({g.filters.length} filter{g.filters.length > 1 ? "s" : ""})</>
                  : <>{g.rows.length} rows</>)
              : <span className="italic">blank preview — click “Generate report” to populate rows</span>}
          </div>
        </div>
        {generated && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1">Download</span>
            <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" disabled={g.rows.length === 0} onClick={() => onExportGroup("csv", g)}>
              <FileText className="h-3.5 w-3.5 mr-1" /> CSV
            </Button>
            <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" disabled={g.rows.length === 0} onClick={() => onExportGroup("xlsx", g)}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Excel
            </Button>
            <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" disabled={g.rows.length === 0} onClick={() => onExportGroup("pdf", g)}>
              <FileType2 className="h-3.5 w-3.5 mr-1" /> PDF
            </Button>
          </div>
        )}
      </div>
      <div className="rounded-md border border-border overflow-x-auto w-fit max-w-full bg-background">
        <Table className="!w-auto">
          <TableHeader className="bg-muted/40">
            <TableRow>
              {g.cols.map((c) => (
                <TableHead key={c.key} className="text-[10px] uppercase tracking-wider whitespace-nowrap px-6">{c.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!generated ? (
              <TableRow>
                <TableCell colSpan={g.cols.length} className="text-center text-xs text-muted-foreground italic py-8">
                  Blank preview — {g.cols.length} column{g.cols.length === 1 ? "" : "s"} selected. Click “Generate report” to populate rows.
                </TableCell>
              </TableRow>
            ) : g.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={g.cols.length} className="text-center text-sm text-muted-foreground py-8">No rows match the current filters.</TableCell>
              </TableRow>
            ) : (
              g.rows.map((row, i) => (
                <TableRow key={(row.id as string) ?? i}>
                  {g.cols.map((c) => (
                    <TableCell key={c.key} className="text-sm whitespace-nowrap tabular-nums px-6">{c.get(row)}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );

  return (
    <>
      <PageHeader
        title="Report Builder"
        subtitle="Your role is auto-detected. Pick one or more permissible reports, choose the columns to include, then generate. Each selected report previews and downloads on its own."
      />

      {/* Permissible reports — clickable, right below the banner */}
      <Card className="mt-4">
        <CardContent className="py-3">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Permissible Reports</span>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">{permissibleDatasets.length}</Badge>
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1 border-l border-border pl-2">
              <UserCircle2 className="h-3.5 w-3.5" /> {role}
            </span>
            <span className="text-[11px] text-muted-foreground">— {role === ADMIN_ROLE ? "you can report on every report & column. " : ""}click a report to include it; its columns open below. Select several to combine.</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {permissibleDatasets.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">Your role can view no reports.</span>
            ) : (
              permissibleDatasets.map((ds) => {
                const on = selectedDatasets.includes(ds.key);
                return (
                  <button
                    key={ds.key}
                    type="button"
                    onClick={() => toggleDataset(ds.key)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 h-7 text-xs font-medium border transition-colors ${
                      on
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    }`}
                    title={on ? "Selected — click to remove" : "Click to include this report"}
                  >
                    {on ? <CheckCheck className="h-3.5 w-3.5" /> : <Database className="h-3.5 w-3.5" />}
                    {ds.label}
                  </button>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Columns — a SEPARATE card per selected report, laid out side by side */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            Columns
            <span className="normal-case text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <FileBarChart className="h-3.5 w-3.5" />
              <strong className="text-foreground tabular-nums">{effectiveDatasets.length}</strong> report{effectiveDatasets.length === 1 ? "" : "s"} · <strong className="text-foreground tabular-nums">{totalSelectedCols}</strong> column{totalSelectedCols === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        {effectiveDatasets.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <div className="text-center text-sm text-muted-foreground">Select one or more reports above to choose their columns.</div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {effectiveDatasets.map((dsKey) => {
              const ds = getDataset(dsKey)!;
              const cols = availableColsFor(dsKey);
              const chosen = colsByDs[dsKey] ?? new Set<string>();
              const chosenCount = cols.filter((c) => chosen.has(c.key)).length;
              return (
                <Card key={dsKey}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-foreground flex items-center gap-1.5 min-w-0">
                        <Database className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> <span className="truncate">{ds.label}</span>
                        <Badge variant="outline" className="h-4 px-1 text-[10px] tabular-nums shrink-0">{chosenCount}/{cols.length}</Badge>
                      </span>
                      <div className="flex gap-1.5 shrink-0">
                        <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" onClick={() => selectAllCols(dsKey)}><CheckCheck className="h-3 w-3 mr-0.5" /> All</Button>
                        <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" onClick={() => clearCols(dsKey)}><Square className="h-3 w-3 mr-0.5" /> None</Button>
                      </div>
                    </div>
                    <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
                      {cols.length === 0 ? (
                        <div className="text-[11px] text-muted-foreground py-2 text-center">No viewable columns for this role.</div>
                      ) : cols.map((c) => (
                        <label key={c.key} className="flex items-center gap-2.5 text-sm cursor-pointer py-0.5">
                          <input type="checkbox" className="h-4 w-4 accent-primary" checked={chosen.has(c.key)} onChange={() => toggleCol(dsKey, c.key)} />
                          <Columns3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-foreground">{c.label}</span>
                        </label>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
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
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={addFilter} disabled={effectiveDatasets.length === 0}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add filter
            </Button>
          </div>

          {filters.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No filters — each report shows all rows. Add a rule to narrow a report by a column value — text match, comparison, a
              <strong className="text-foreground"> date / number range (from–to)</strong>, or empty / not-empty (rules on the same report combine with AND).
            </p>
          ) : (
            <div className="space-y-2">
              {filters.map((f) => {
                const dsSelected = effectiveDatasets.includes(f.ds);
                const dsCols = availableColsFor(f.ds);
                const staleCol = !dsCols.some((c) => c.key === f.col);
                const stale = !dsSelected || staleCol;
                const inputType = columnInputType(f.ds, f.col);
                const dsLabel = getDataset(f.ds)?.label ?? f.ds;
                return (
                  <div key={f.id} className="flex items-center gap-2 flex-wrap">
                    {/* Report (dataset) scope */}
                    <select
                      value={f.ds}
                      onChange={(e) => {
                        const nextDs = e.target.value;
                        const firstCol = availableColsFor(nextDs)[0];
                        const isDate = firstCol ? columnInputType(nextDs, firstCol.key) === "date" : false;
                        updateFilter(f.id, { ds: nextDs, col: firstCol?.key ?? "", op: isDate ? "between" : (f.op === "between" ? "contains" : f.op), value: "", value2: "" });
                      }}
                      className={`rb-filter-ds rounded-md border bg-background px-2 py-1.5 text-sm min-w-[150px] ${!dsSelected ? "border-destructive text-destructive" : "border-border"}`}
                    >
                      {!dsSelected && <option value={f.ds}>{dsLabel} (not selected)</option>}
                      {effectiveDatasets.map((k) => <option key={k} value={k}>{getDataset(k)?.label ?? k}</option>)}
                    </select>
                    <select
                      value={f.col}
                      onChange={(e) => {
                        const nextCol = e.target.value;
                        // Picking a date column gives an inline from–to range beside it.
                        const isDate = columnInputType(f.ds, nextCol) === "date";
                        updateFilter(f.id, { col: nextCol, op: isDate ? "between" : (f.op === "between" ? "contains" : f.op), value: "", value2: "" });
                      }}
                      className={`rb-filter-col rounded-md border bg-background px-2 py-1.5 text-sm min-w-[140px] ${staleCol ? "border-destructive text-destructive" : "border-border"}`}
                    >
                      {staleCol && <option value={f.col}>{f.col} (unavailable)</option>}
                      {dsCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <select
                      value={f.op}
                      onChange={(e) => updateFilter(f.id, { op: e.target.value as FilterOp })}
                      className="rb-filter-op rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {/* Value input(s) — none for empty/nempty, two for a range */}
                    {f.op === "empty" || f.op === "nempty" ? null : f.op === "between" ? (
                      <>
                        <Input
                          type={inputType}
                          value={f.value}
                          onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                          placeholder={inputType === "date" ? "from date" : "from"}
                          className="rb-filter-val h-9 w-40"
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <Input
                          type={inputType}
                          value={f.value2 ?? ""}
                          onChange={(e) => updateFilter(f.id, { value2: e.target.value })}
                          placeholder={inputType === "date" ? "to date" : "to"}
                          className="rb-filter-val2 h-9 w-40"
                        />
                      </>
                    ) : (
                      <Input
                        type={inputType}
                        value={f.value}
                        onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                        placeholder="value"
                        className="rb-filter-val h-9 w-44"
                      />
                    )}
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeFilter(f.id)} title="Remove filter">
                      <X className="h-4 w-4" />
                    </Button>
                    {stale && <span className="text-[11px] text-destructive">{!dsSelected ? "report not selected — ignored" : "column not available for this role — ignored"}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results toolbar — Generate report (moved here, below the filters) plus a
          one-click "Download all" so multiple reports don't need scrolling. */}
      {effectiveDatasets.length > 0 && (
        <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <FileBarChart className="h-3.5 w-3.5 shrink-0" />
            {totalSelectedCols === 0
              ? "Tick columns above, then generate."
              : reports.length > 1
                ? <>{reports.length} reports — switch tabs to view; download one, or all at once.</>
                : "Generate to populate rows, then download."}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {generated && reports.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Download all</span>
                <Button size="sm" variant="outline" className="h-9 px-2.5 text-xs" onClick={() => downloadAll("csv")}>
                  <Download className="h-3.5 w-3.5 mr-1" /> CSV
                </Button>
                <Button size="sm" variant="outline" className="h-9 px-2.5 text-xs" onClick={() => downloadAll("xlsx")}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Excel
                </Button>
                <Button size="sm" variant="outline" className="h-9 px-2.5 text-xs" onClick={() => downloadAll("pdf")}>
                  <Download className="h-3.5 w-3.5 mr-1" /> PDF
                </Button>
              </div>
            )}
            <Button className="h-9" disabled={totalSelectedCols === 0} onClick={generate}>
              <Eye className="h-4 w-4 mr-1.5" /> Generate report ({totalSelectedCols})
            </Button>
          </div>
        </div>
      )}

      {/* Preview — tabs when several reports are selected (no scrolling); a single
          card otherwise. Columns populate live; rows appear on Generate. */}
      {reports.length === 0 ? (
        <Card className="mt-3">
          <CardContent className="py-8">
            <div className="text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
              <Table2 className="h-6 w-6 text-muted-foreground/60" />
              Select one or more reports and their columns — the report table builds here.
            </div>
          </CardContent>
        </Card>
      ) : reports.length === 1 ? (
        <Card className="mt-3">
          <CardContent className="pt-5">{reportPanel(reports[0])}</CardContent>
        </Card>
      ) : (
        <Card className="mt-3">
          <CardContent className="pt-5">
            <Tabs
              value={reports.some((r) => r.ds.key === activeTab) ? activeTab : reports[0].ds.key}
              onValueChange={setActiveTab}
            >
              {/* Tabs + remove controls at the top */}
              <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                <TabsList className="flex flex-wrap h-auto gap-1.5 bg-transparent p-0">
                  {reports.map((g, i) => {
                    const theme = TAB_THEMES[i % TAB_THEMES.length];
                    return (
                      <TabsTrigger key={g.ds.key} value={g.ds.key} className={`text-xs gap-1.5 border ${theme.trigger}`}>
                        <Database className="h-3.5 w-3.5" /> {g.ds.label}
                        <Badge variant="outline" className="h-4 px-1 text-[10px] tabular-nums ml-0.5 bg-white/60">{g.cols.length}</Badge>
                        {removeMode && (
                          <span
                            role="button"
                            tabIndex={0}
                            title={`Remove ${g.ds.label}`}
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); removeDataset(g.ds.key); }}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); removeDataset(g.ds.key); } }}
                            className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-destructive/15 text-destructive hover:bg-destructive hover:text-white transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </span>
                        )}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className={`h-7 px-2 text-xs no-brand ${removeMode ? "bg-destructive/10 text-destructive border-destructive/40 hover:bg-destructive/15 hover:text-destructive" : ""}`}
                    onClick={() => setRemoveMode((m) => !m)}
                    title="Show a × on each tab to remove that report"
                  >
                    {removeMode ? <><CheckCheck className="h-3.5 w-3.5 mr-1" /> Done</> : <><X className="h-3.5 w-3.5 mr-1" /> Remove</>}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs no-brand text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setRemoveAllOpen(true)}
                    title="Remove every selected report"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove All
                  </Button>
                </div>
              </div>
              {reports.map((g, i) => {
                const theme = TAB_THEMES[i % TAB_THEMES.length];
                return (
                  <TabsContent key={g.ds.key} value={g.ds.key} className="mt-0">
                    <div className={`rounded-lg border p-4 ${theme.panel}`}>
                      {reportPanel(g)}
                    </div>
                  </TabsContent>
                );
              })}
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Remove-all confirmation */}
      <Dialog open={removeAllOpen} onOpenChange={setRemoveAllOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" /> Remove all reports?
            </DialogTitle>
            <DialogDescription>
              This clears all {effectiveDatasets.length} selected report{effectiveDatasets.length === 1 ? "" : "s"}, their chosen
              columns and filters. You'll stay on this page and can add reports again anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveAllOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={removeAll}>
              <Trash2 className="h-4 w-4 mr-1.5" /> Yes, remove all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
