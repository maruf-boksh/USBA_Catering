/**
 * exportAudit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Export the audit trail of a single Role to Excel / PDF / Word.
 *
 *  - Excel  → xlsx-js-style workbook with a styled header + table
 *  - PDF    → opens a print-styled window; user picks "Save as PDF"
 *  - Word   → HTML body wrapped in MS Word headers, downloaded as .doc
 */

import type * as XLSX from 'xlsx-js-style';
import type { AuditEntry, Role } from '../types/roleSetup.types';

// `xlsx-js-style` (~600 KB) is loaded lazily on the first Excel-export click,
// then cached so subsequent clicks don't re-fetch the chunk.
let _xlsxPromise: Promise<typeof XLSX> | null = null;
const loadXLSX = () => (_xlsxPromise ??= import('xlsx-js-style'));

// ─── Common helpers ──────────────────────────────────────────────────────────

function changesToText(e: AuditEntry): string {
  if (!e.changes || e.changes.length === 0) return '';
  return e.changes
    .map(c => `${c.field}: "${c.from}" → "${c.to}"`)
    .join('; ');
}

function safeFilename(role: Role): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = role.code.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return `audit-trail_${slug}_${stamp}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ─── Excel ───────────────────────────────────────────────────────────────────

const BORDER = {
  top:    { style: 'thin', color: { rgb: 'E5E7EB' } },
  bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
  left:   { style: 'thin', color: { rgb: 'E5E7EB' } },
  right:  { style: 'thin', color: { rgb: 'E5E7EB' } },
} as const;

const ACTION_FILL: Record<string, string> = {
  Created:     '0EA5E9',
  Updated:     'D97706',
  Activated:   '059669',
  Deactivated: 'DC2626',
};

export async function exportAuditExcel(role: Role) {
  const xl = await loadXLSX();
  const wb = xl.utils.book_new();
  const aoa: (string | number)[][] = [];

  // Title block
  aoa.push([`Role Audit Trail — ${role.name}`, '', '', '', '']);
  aoa.push([`Code: ${role.code} · ID: ${role.id} · Status: ${role.status}`, '', '', '', '']);
  aoa.push([`Generated: ${new Date().toLocaleString('en-GB')}`, '', '', '', '']);
  aoa.push(['', '', '', '', '']);
  aoa.push(['#', 'Action', 'Actor', 'Timestamp', 'Details']);

  // Newest first
  const ordered = [...role.auditLog].reverse();
  ordered.forEach((e, i) => {
    const details = [e.note, changesToText(e)].filter(Boolean).join(' — ');
    aoa.push([i + 1, e.action, e.actor, e.timestamp, details]);
  });

  const ws = xl.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 5 },  { wch: 14 }, { wch: 28 }, { wch: 24 }, { wch: 80 },
  ];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
  ];

  // Title
  applyStyle(xl, ws, 0, 0, {
    font: { name: 'Calibri', bold: true, sz: 16, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: '3B6EEA' } },
    alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    border: BORDER,
  });
  applyStyle(xl, ws, 1, 0, {
    font: { name: 'Calibri', sz: 10, color: { rgb: 'E0E7FF' } },
    fill: { patternType: 'solid', fgColor: { rgb: '3B6EEA' } },
    alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    border: BORDER,
  });
  applyStyle(xl, ws, 2, 0, {
    font: { name: 'Calibri', italic: true, sz: 9, color: { rgb: '6B7280' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'F9FAFB' } },
    alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    border: BORDER,
  });
  ws['!rows'] = [{ hpt: 26 }, { hpt: 18 }, { hpt: 16 }, { hpt: 12 }, { hpt: 22 }];

  // Header row
  for (let c = 0; c < 5; c++) {
    applyStyle(xl, ws, 4, c, {
      font: { name: 'Calibri', bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '111827' } },
      alignment: { horizontal: c === 4 ? 'left' : 'center', vertical: 'center' },
      border: BORDER,
    });
  }

  // Body rows
  ordered.forEach((e, i) => {
    const r = 5 + i;
    const alt = i % 2 === 1;
    const baseFill = alt ? 'F8FAFC' : 'FFFFFF';
    for (let c = 0; c < 5; c++) {
      applyStyle(xl, ws, r, c, {
        font: { name: 'Calibri', sz: 10, color: { rgb: '111827' } },
        fill: { patternType: 'solid', fgColor: { rgb: baseFill } },
        alignment: { horizontal: c === 4 ? 'left' : 'center', vertical: 'center', wrapText: c === 4, indent: c === 4 ? 1 : 0 },
        border: BORDER,
      });
    }
    // Action pill cell
    applyStyle(xl, ws, r, 1, {
      font: { name: 'Calibri', bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: ACTION_FILL[e.action] ?? '6B7280' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: BORDER,
    });
  });

  xl.utils.book_append_sheet(wb, ws, 'Audit Trail');
  xl.writeFile(wb, `${safeFilename(role)}.xlsx`);
}

function applyStyle(xl: typeof XLSX, ws: XLSX.WorkSheet, r: number, c: number, s: object) {
  const addr = xl.utils.encode_cell({ r, c });
  if (!ws[addr]) ws[addr] = { t: 's', v: '' };
  (ws[addr] as XLSX.CellObject).s = s;
}

// ─── Shared HTML body (used by PDF print window + Word doc) ───────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ACTION_HEX: Record<string, { color: string; bg: string }> = {
  Created:     { color: '#0369a1', bg: '#f0f9ff' },
  Updated:     { color: '#b45309', bg: '#fffbeb' },
  Activated:   { color: '#027a48', bg: '#ecfdf3' },
  Deactivated: { color: '#b91c1c', bg: '#fef2f2' },
};

function buildAuditHtml(role: Role): string {
  const ordered = [...role.auditLog].reverse();
  const rows = ordered.map((e, i) => {
    const a = ACTION_HEX[e.action] ?? { color: '#374151', bg: '#f3f4f6' };
    const changes = (e.changes ?? [])
      .map(c => `<div class="change"><strong>${escapeHtml(c.field)}:</strong> <span class="from">${escapeHtml(c.from)}</span> → <span class="to">${escapeHtml(c.to)}</span></div>`)
      .join('');
    const note = e.note ? `<div class="note">${escapeHtml(e.note)}</div>` : '';
    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td><span class="pill" style="color:${a.color};background:${a.bg};">${escapeHtml(e.action)}</span></td>
        <td>${escapeHtml(e.actor)}</td>
        <td class="ts">${escapeHtml(e.timestamp)}</td>
        <td>${note}${changes}</td>
      </tr>`;
  }).join('');

  return `
    <div class="meta">
      <h1>Role Audit Trail</h1>
      <h2>${escapeHtml(role.name)}</h2>
      <div class="sub">
        <span><strong>ID:</strong> ${escapeHtml(role.id)}</span>
        <span><strong>Code:</strong> ${escapeHtml(role.code)}</span>
        <span><strong>Status:</strong> ${escapeHtml(role.status)}</span>
      </div>
      <div class="gen">Generated ${new Date().toLocaleString('en-GB')} · ${role.auditLog.length} entr${role.auditLog.length === 1 ? 'y' : 'ies'}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width:32px;">#</th>
          <th style="width:90px;">Action</th>
          <th style="width:160px;">Actor</th>
          <th style="width:140px;">Timestamp</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

const REPORT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #111827; padding: 24px; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 4px; color: #3B6EEA; }
  h2 { font-size: 22px; margin: 0 0 8px; color: #111827; font-weight: 700; }
  .sub { font-size: 12px; color: #4B5563; display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 4px; }
  .gen { font-size: 11px; color: #6B7280; font-style: italic; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead th { background: #111827; color: #fff; padding: 8px 10px; text-align: left; font-weight: 600; border: 1px solid #111827; }
  tbody td { padding: 8px 10px; border: 1px solid #E5E7EB; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #F8FAFC; }
  td.num, td.ts { text-align: center; white-space: nowrap; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 10px; font-weight: 600; }
  .note { font-style: italic; color: #6B7280; margin-bottom: 4px; }
  .change { font-size: 10px; color: #374151; margin-bottom: 2px; }
  .change .from { background: #fef2f2; color: #b91c1c; padding: 1px 4px; border-radius: 3px; text-decoration: line-through; }
  .change .to { background: #ecfdf3; color: #027a48; padding: 1px 4px; border-radius: 3px; }
  @media print {
    body { padding: 12px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
`;

// ─── PDF (print window) ──────────────────────────────────────────────────────

export function exportAuditPdf(role: Role) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) {
    alert('Pop-up blocked. Please allow pop-ups for this site to export PDF.');
    return;
  }
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(`Audit Trail · ${role.name}`)}</title><style>${REPORT_CSS}</style></head><body>${buildAuditHtml(role)}<script>window.onload = () => { setTimeout(() => { window.focus(); window.print(); }, 200); };<\/script></body></html>`);
  w.document.close();
}

// ─── Word (.doc via HTML/MS Word headers) ────────────────────────────────────

export function exportAuditWord(role: Role) {
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <title>Audit Trail · ${escapeHtml(role.name)}</title>
        <!--[if gte mso 9]>
        <xml>
          <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>100</w:Zoom>
            <w:DoNotOptimizeForBrowser/>
          </w:WordDocument>
        </xml>
        <![endif]-->
        <style>${REPORT_CSS}</style>
      </head>
      <body>${buildAuditHtml(role)}</body>
    </html>`;

  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  downloadBlob(blob, `${safeFilename(role)}.doc`);
}
