/**
 * exportPermissionAudit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Export the permission audit trail of a single role to Excel / PDF / Word.
 *
 *  - Excel  → xlsx-js-style workbook with a styled header + table
 *  - PDF    → opens a print-styled window; user picks "Save as PDF"
 *  - Word   → HTML body wrapped in MS Word headers, downloaded as .doc
 */

import type * as XLSX from 'xlsx-js-style';
import type { PermissionAuditEntry } from '../types/permissions.types';
import { SCOPE_LABELS } from '../types/permissions.types';

// `xlsx-js-style` (~600 KB) is loaded lazily on the first Excel-export click,
// then cached so subsequent clicks don't re-fetch the chunk.
let _xlsxPromise: Promise<typeof XLSX> | null = null;
const loadXLSX = () => (_xlsxPromise ??= import('xlsx-js-style'));

interface ExportTarget {
  roleName:  string;
  roleCode:  string;
  roleId:    string;
}

const ACTION_LABEL: Record<PermissionAuditEntry['action'], string> = {
  'permission.granted':       'Granted',
  'permission.revoked':       'Revoked',
  'permission.scope_changed': 'Scope changed',
  'role.draft_saved':         'Draft saved',
  'role.draft_published':     'Published',
  'role.draft_discarded':     'Draft discarded',
  'role.preset_applied':      'Preset applied',
  'role.copied_from':         'Copied from role',
  'role.scopes_reset':        'Scopes reset',
  'role.reviewed':            'Reviewed',
};

const ACTION_FILL: Record<PermissionAuditEntry['action'], string> = {
  'permission.granted':       '059669',
  'permission.revoked':       'DC2626',
  'permission.scope_changed': '0EA5E9',
  'role.draft_saved':         'D97706',
  'role.draft_published':     '059669',
  'role.draft_discarded':     '6B7280',
  'role.preset_applied':      '7C3AED',
  'role.copied_from':         '0D9488',
  'role.scopes_reset':        '0EA5E9',
  'role.reviewed':            '7C3AED',
};

const ACTION_HEX: Record<PermissionAuditEntry['action'], { color: string; bg: string }> = {
  'permission.granted':       { color: '#027a48', bg: '#ecfdf3' },
  'permission.revoked':       { color: '#b91c1c', bg: '#fef2f2' },
  'permission.scope_changed': { color: '#0369a1', bg: '#f0f9ff' },
  'role.draft_saved':         { color: '#b45309', bg: '#fffbeb' },
  'role.draft_published':     { color: '#027a48', bg: '#ecfdf3' },
  'role.draft_discarded':     { color: '#6b7280', bg: '#f3f4f6' },
  'role.preset_applied':      { color: '#7c3aed', bg: '#f5f3ff' },
  'role.copied_from':         { color: '#0d9488', bg: '#ccfbf1' },
  'role.scopes_reset':        { color: '#0369a1', bg: '#f0f9ff' },
  'role.reviewed':            { color: '#7c3aed', bg: '#f5f3ff' },
};

function changesToText(e: PermissionAuditEntry): string {
  if (e.action === 'permission.scope_changed') {
    return `${e.fromScope ? SCOPE_LABELS[e.fromScope] : '—'} → ${e.toScope ? SCOPE_LABELS[e.toScope] : '—'}`;
  }
  if (e.action === 'permission.granted' && e.toScope) {
    return `Scope: ${SCOPE_LABELS[e.toScope]}`;
  }
  return '';
}

function safeFilename(target: ExportTarget): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = target.roleCode.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return `permission-audit_${slug}_${stamp}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ─── Excel ────────────────────────────────────────────────────────────────────

const BORDER = {
  top:    { style: 'thin', color: { rgb: 'E5E7EB' } },
  bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
  left:   { style: 'thin', color: { rgb: 'E5E7EB' } },
  right:  { style: 'thin', color: { rgb: 'E5E7EB' } },
} as const;

function applyStyle(xl: typeof XLSX, ws: XLSX.WorkSheet, r: number, c: number, s: object) {
  const addr = xl.utils.encode_cell({ r, c });
  if (!ws[addr]) ws[addr] = { t: 's', v: '' };
  (ws[addr] as XLSX.CellObject).s = s;
}

export async function exportPermissionAuditExcel(target: ExportTarget, entries: PermissionAuditEntry[]) {
  const xl = await loadXLSX();
  const wb = xl.utils.book_new();
  const aoa: (string | number)[][] = [];

  aoa.push([`Permission Audit Trail — ${target.roleName}`, '', '', '', '', '', '']);
  aoa.push([`Code: ${target.roleCode} · Role ID: ${target.roleId}`, '', '', '', '', '', '']);
  aoa.push([`Generated: ${new Date().toLocaleString('en-GB')} · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`, '', '', '', '', '', '']);
  aoa.push(['', '', '', '', '', '', '']);
  aoa.push(['#', 'Action', 'Actor', 'Timestamp', 'Permission Key', 'Scope Change', 'Note']);

  const ordered = [...entries].reverse();
  ordered.forEach((e, i) => {
    aoa.push([
      i + 1,
      ACTION_LABEL[e.action],
      e.actor,
      e.timestamp,
      e.permissionKey ?? '',
      changesToText(e),
      e.note ?? '',
    ]);
  });

  const ws = xl.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 5 }, { wch: 16 }, { wch: 28 }, { wch: 22 },
    { wch: 56 }, { wch: 28 }, { wch: 50 },
  ];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } },
  ];

  // Title row
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
  for (let c = 0; c < 7; c++) {
    applyStyle(xl, ws, 4, c, {
      font: { name: 'Calibri', bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '111827' } },
      alignment: { horizontal: c === 6 || c === 4 ? 'left' : 'center', vertical: 'center' },
      border: BORDER,
    });
  }

  // Body rows
  ordered.forEach((e, i) => {
    const r = 5 + i;
    const alt = i % 2 === 1;
    const baseFill = alt ? 'F8FAFC' : 'FFFFFF';
    for (let c = 0; c < 7; c++) {
      applyStyle(xl, ws, r, c, {
        font: { name: 'Calibri', sz: 10, color: { rgb: '111827' } },
        fill: { patternType: 'solid', fgColor: { rgb: baseFill } },
        alignment: {
          horizontal: c === 6 || c === 4 ? 'left' : 'center',
          vertical: 'center', wrapText: c === 4 || c === 6,
          indent: c === 4 || c === 6 ? 1 : 0,
        },
        border: BORDER,
      });
    }
    // Action pill cell
    applyStyle(xl, ws, r, 1, {
      font: { name: 'Calibri', bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: ACTION_FILL[e.action] } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: BORDER,
    });
  });

  xl.utils.book_append_sheet(wb, ws, 'Permission Audit');
  xl.writeFile(wb, `${safeFilename(target)}.xlsx`);
}

// ─── Shared HTML body (PDF + Word) ────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildAuditHtml(target: ExportTarget, entries: PermissionAuditEntry[]): string {
  const ordered = [...entries].reverse();
  const rows = ordered.map((e, i) => {
    const a = ACTION_HEX[e.action];
    const change = changesToText(e);
    const note = e.note ? `<div class="note">${escapeHtml(e.note)}</div>` : '';
    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td><span class="pill" style="color:${a.color};background:${a.bg};">${escapeHtml(ACTION_LABEL[e.action])}</span></td>
        <td>${escapeHtml(e.actor)}</td>
        <td class="ts">${escapeHtml(e.timestamp)}</td>
        <td><code>${escapeHtml(e.permissionKey ?? '—')}</code></td>
        <td class="change">${escapeHtml(change)}</td>
        <td>${note}</td>
      </tr>`;
  }).join('');

  return `
    <div class="meta">
      <h1>Permission Audit Trail</h1>
      <h2>${escapeHtml(target.roleName)}</h2>
      <div class="sub">
        <span><strong>Role ID:</strong> ${escapeHtml(target.roleId)}</span>
        <span><strong>Code:</strong> ${escapeHtml(target.roleCode)}</span>
      </div>
      <div class="gen">Generated ${new Date().toLocaleString('en-GB')} · ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width:32px;">#</th>
          <th style="width:100px;">Action</th>
          <th style="width:160px;">Actor</th>
          <th style="width:140px;">Timestamp</th>
          <th>Permission Key</th>
          <th style="width:140px;">Scope Change</th>
          <th>Note</th>
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
  td.num, td.ts, td.change { text-align: center; white-space: nowrap; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 10px; font-weight: 600; }
  .note { font-style: italic; color: #6B7280; }
  code { font-family: 'Courier New', monospace; font-size: 10px; background: #F3F4F6; padding: 1px 4px; border-radius: 3px; color: #374151; }
  @media print {
    body { padding: 12px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
`;

// ─── PDF (print window) ──────────────────────────────────────────────────────

export function exportPermissionAuditPdf(target: ExportTarget, entries: PermissionAuditEntry[]) {
  const w = window.open('', '_blank', 'width=1000,height=700');
  if (!w) {
    alert('Pop-up blocked. Please allow pop-ups for this site to export PDF.');
    return;
  }
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(`Permission Audit · ${target.roleName}`)}</title><style>${REPORT_CSS}</style></head><body>${buildAuditHtml(target, entries)}<script>window.onload = () => { setTimeout(() => { window.focus(); window.print(); }, 200); };<\/script></body></html>`);
  w.document.close();
}

// ─── Word (.doc via HTML/MS Word headers) ────────────────────────────────────

export function exportPermissionAuditWord(target: ExportTarget, entries: PermissionAuditEntry[]) {
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <title>Permission Audit · ${escapeHtml(target.roleName)}</title>
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
      <body>${buildAuditHtml(target, entries)}</body>
    </html>`;

  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  downloadBlob(blob, `${safeFilename(target)}.doc`);
}
