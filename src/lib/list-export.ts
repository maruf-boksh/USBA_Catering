import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// List export / print — ONE implementation for every list page.
//
// Extracted from the Galley Plan page so all pages export and print the same
// way: Export downloads the CURRENT FILTERED list as CSV (Excel-ready, BOM
// prefixed); Print opens a clean tabular sheet and triggers the browser's
// print dialog (Save as PDF included).
//
// Pages describe their table once (title, columns, rows) and hand it to
// `exportTableCsv` / `printTable` — or just render <ListExportActions> with a
// lazy `table` thunk so rows are only built on click.
// ─────────────────────────────────────────────────────────────────────────────

export type ExportTable = {
  /** Sheet heading, e.g. "Production Orders". Also seeds the print tab title. */
  title: string;
  /** CSV file base name (no extension), e.g. "production-orders-2026-06-03". */
  fileName: string;
  /** Sub-line under the heading — active filters / date range, so a printed
   *  sheet says what slice of the data it is. */
  meta?: string;
  columns: string[];
  rows: (string | number)[][];
  /** Column indexes right-aligned in print (quantities, counts). */
  numericCols?: number[];
};

const cellStr = (v: string | number) => (typeof v === "number" ? String(v) : v ?? "");

/** Download the table as a CSV the way Excel expects it (CRLF + BOM). */
export function exportTableCsv(t: ExportTable): void {
  if (t.rows.length === 0) { toast.error("Nothing to export — the current filters match no rows."); return; }
  const esc = (v: string | number) => `"${cellStr(v).replace(/"/g, '""')}"`;
  const csv = [t.columns, ...t.rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${t.fileName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${t.rows.length} row${t.rows.length === 1 ? "" : "s"} to CSV.`);
}

const escHtml = (v: string | number) =>
  cellStr(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Open a print window with the table laid out as a clean sheet. */
export function printTable(t: ExportTable): void {
  if (t.rows.length === 0) { toast.error("Nothing to print — the current filters match no rows."); return; }
  const win = window.open("", "_blank", "width=1024,height=720");
  if (!win) { toast.error("Pop-up blocked — allow pop-ups to print."); return; }
  const numeric = new Set(t.numericCols ?? []);
  const body = t.rows
    .map((r) => `<tr>${r.map((v, i) => `<td class="${numeric.has(i) ? "num" : ""}">${escHtml(v)}</td>`).join("")}</tr>`)
    .join("");
  win.document.write(`<!doctype html><html><head><title>${escHtml(t.title)}</title><style>
    body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#0f172a}
    h1{font-size:18px;margin:0 0 2px} .meta{color:#64748b;font-size:12px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
    th{background:#f1f5f9;text-transform:uppercase;font-size:10px;letter-spacing:.05em}
    td.num{text-align:right;font-variant-numeric:tabular-nums}
    @media print{@page{margin:14mm}}
  </style></head><body>
    <h1>${escHtml(t.title)}</h1>
    <div class="meta">${escHtml(t.meta ?? "")}${t.meta ? " · " : ""}${t.rows.length} row(s) · printed ${new Date().toLocaleString()}</div>
    <table><thead><tr>${t.columns.map((c) => `<th>${escHtml(c)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
    <script>window.onload=function(){window.print()}</script>
  </body></html>`);
  win.document.close();
}

/** Human-readable filter summary for the print meta line. Skips empty values. */
export function filterMeta(parts: Array<[label: string, value: string | undefined | false]>): string {
  const active = parts.filter((p): p is [string, string] => !!p[1]);
  return active.length === 0 ? "All records" : active.map(([l, v]) => `${l}: ${v}`).join(" · ");
}
