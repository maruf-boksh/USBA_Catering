import { useMemo, useState } from 'react';
import { T } from '../theme';
import { KPICard } from '../components/KPICard';
// Quality Control on the phone, on the WEB's own records — the workflow store's
// GRNs. A receipt approved anywhere lands here as pending lines; inspecting one
// splits it Passed / Failed exactly as routes/quality-control.tsx does:
// passed qty posts to Stock Overview, failed qty raises a Purchase Return.
//
// The food-safety checklists (cooking temperature, daily hygiene, personal
// hygiene) keep their own screens — they are reached from the tiles below.
import { useWorkflow } from '@/lib/workflow-store';
import { applyInventoryStock } from '@/lib/stock-adjustments';
import { SEED_RETURNS } from '@/routes/purchase-return';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const LABEL = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };
const CARD = { background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm };
const SECTION = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 2px 8px' };

// The other food-safety modules, kept exactly where they were.
const SAFETY_TILES = [
  { screen: 'cooking-temp',     icon: '🌡️', label: 'Cooking Temperature',                  sub: 'HACCP temp & sensory tests',   color: T.statusInfo,     bg: T.statusInfoBg },
  { screen: 'hygiene',          icon: '🧹', label: 'Daily Hygiene Monitoring',             sub: 'Daily safety checklists',      color: T.statusApproved, bg: T.statusApprovedBg },
  { screen: 'personal-hygiene', icon: '🧼', label: 'Health & Personal Hygiene Monitoring', sub: 'Staff hygiene checks by area', color: T.statusPending,  bg: T.statusPendingBg },
];

const QC_STATUS = {
  'Pending':             { color: T.statusPending,  bg: T.statusPendingBg },
  'Accepted':            { color: T.statusApproved, bg: T.statusApprovedBg },
  'Partially Accepted':  { color: T.statusPending,  bg: T.statusPendingBg },
  'Rejected':            { color: T.statusRejected, bg: T.statusRejectedBg },
  'On Hold':             { color: T.statusInfo,     bg: T.statusInfoBg },
};

const num = (v) => Number(v) || 0;
const p2 = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

/**
 * One Purchase Return per inspection, carrying every failed item — the same
 * record (same key, same shape, same seed guard) Quality Control writes on the
 * web, so a return raised from the phone lands in the Purchase Return module.
 */
function initiatePurchaseReturn(grnId, po, vendor, failed) {
  const KEY = 'harvest-data-v1:purchase-return-rows';
  let existing = SEED_RETURNS;
  try { const raw = localStorage.getItem(KEY); if (raw) existing = JSON.parse(raw); }
  catch { /* fall back to seed */ }
  const id = `RT-${new Date().getFullYear()}-${String(existing.length + 15).padStart(4, '0')}`;
  const ret = {
    id, date: todayStr(), grnRef: grnId, poRef: po, supplier: vendor,
    lines: failed.map((f, i) => ({
      id: `l-${Date.now()}-${i}`, itemName: f.item, uom: f.uom, qty: f.qty,
      unitPrice: 0, reason: f.reason, notes: f.notes,
    })),
    totalValue: 0, status: 'Submitted',
    remarks: `Auto-initiated from QC — GRN ${grnId} (${failed.length} item${failed.length === 1 ? '' : 's'} failed).`,
  };
  try { localStorage.setItem(KEY, JSON.stringify([ret, ...existing])); } catch { /* quota */ }
  return id;
}

function Chip({ label, color, bg }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>
      {label}
    </span>
  );
}

function Empty({ icon, text }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 0' }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody, padding: '0 24px' }}>{text}</div>
    </div>
  );
}

function Row({ label, value }) {
  const v = String(value ?? '').trim();
  if (v === '') return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '7px 0', borderTop: `1px solid ${T.border}` }}>
      <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

export function QCScreen({ nav }) {
  const { grns, updateGRNLineQC } = useWorkflow();
  const [view, setView]   = useState('list');   // 'list' | 'inspect' | 'detail'
  const [activeId, setActiveId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [filter, setFilter] = useState('pending');
  const [query, setQuery]   = useState('');
  const [notice, setNotice] = useState('');
  const flash = (m) => { setNotice(m); setTimeout(() => setNotice(''), 3000); };

  const pendingGrns = grns.filter((g) => g.lines.some((l) => l.qcStatus === 'Pending'));
  const doneGrns    = grns.filter((g) => g.lines.length > 0 && g.lines.every((l) => l.qcStatus !== 'Pending'));

  const allLines = grns.flatMap((g) => g.lines);
  const kpis = {
    pending: allLines.filter((l) => l.qcStatus === 'Pending').length,
    accepted: allLines.filter((l) => l.qcStatus === 'Accepted').length,
    partial: allLines.filter((l) => l.qcStatus === 'Partially Accepted').length,
    rejected: allLines.filter((l) => l.qcStatus === 'Rejected').length,
  };

  const pool = filter === 'pending' ? pendingGrns : filter === 'done' ? doneGrns : grns;
  const visible = pool.filter((g) => {
    if (!query.trim()) return true;
    const hay = `${g.id} ${g.poRef} ${g.vendor} ${g.lines.map((l) => l.name).join(' ')}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  const activeGrn = grns.find((g) => g.id === activeId) ?? null;

  const openInspect = (g) => {
    // Default: inspect the full received qty, all passing — one tap accepts all.
    const d = {};
    g.lines.forEach((l, i) => {
      if (l.qcStatus === 'Pending') d[i] = { qcQty: String(l.qty), passQty: String(l.qty), remarks: '' };
    });
    setDrafts(d);
    setActiveId(g.id);
    setView('inspect');
  };

  const setDraft = (idx, patch) => setDrafts((p) => ({ ...p, [idx]: { ...p[idx], ...patch } }));

  // Clamp a line into a resolved split: inspected ≤ received, passed ≤ inspected.
  const resolveLine = (received, d) => {
    const qcQ = Math.max(0, Math.min(num(d?.qcQty), received));
    const pass = Math.max(0, Math.min(num(d?.passQty), qcQ));
    return { qcQ, pass, fail: Math.max(0, qcQ - pass) };
  };
  const lineStatus = (received, pass, fail) =>
    fail === 0 && pass === received ? 'Accepted' : pass === 0 ? 'Rejected' : 'Partially Accepted';

  const confirmInspect = () => {
    const g = activeGrn;
    if (!g) return;
    const failed = [];
    let inspected = 0;
    g.lines.forEach((l, i) => {
      const d = drafts[i];
      if (!d) return;
      const { qcQ, pass, fail } = resolveLine(l.qty, d);
      if (qcQ <= 0) return;
      inspected++;
      updateGRNLineQC(g.id, i, lineStatus(l.qty, pass, fail), {
        qcQty: qcQ, qcPassQty: pass, qcFailQty: fail,
        qcCompliedQty: fail === 0 ? 'Yes' : 'No',
        qcRemarks: d.remarks.trim() || undefined,
        ...(fail > 0 ? { qcReason: 'Quality Issue' } : {}),
      });
      if (pass > 0) applyInventoryStock(l.name, pass);
      if (fail > 0) failed.push({ item: l.name, uom: l.uom, qty: fail, reason: 'Quality Issue', notes: d.remarks.trim() || undefined });
    });
    if (inspected === 0) { flash('Enter a QC quantity for at least one item.'); return; }
    const rtId = failed.length ? initiatePurchaseReturn(g.id, g.poRef, g.vendor, failed) : null;
    setActiveId(null);
    setView('list');
    flash(`${g.id} inspected — ${inspected} item${inspected === 1 ? '' : 's'} processed${rtId ? ` · Return ${rtId}` : ''}.`);
  };

  // ── Inspect ───────────────────────────────────────────────────────────────
  if (view === 'inspect' && activeGrn) {
    const g = activeGrn;
    const pending = g.lines.map((l, i) => ({ ...l, idx: i })).filter((l) => l.qcStatus === 'Pending');
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Inspect Receipt</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{g.id} · {g.vendor}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          <div style={{ ...LABEL, margin: '0 2px 8px' }}>Items To Inspect ({pending.length})</div>
          {pending.map((l) => {
            const d = drafts[l.idx] || { qcQty: '', passQty: '', remarks: '' };
            const { qcQ, pass, fail } = resolveLine(l.qty, d);
            const st = lineStatus(l.qty, pass, fail);
            const s = QC_STATUS[st];
            return (
              <div key={l.idx} style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{l.name}</span>
                  <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, flexShrink: 0 }}>
                    {num(l.qty).toLocaleString()} {l.uom} received
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...LABEL, marginBottom: 4 }}>Inspected</div>
                    <input type="number" inputMode="decimal" value={d.qcQty}
                      onChange={(e) => setDraft(l.idx, { qcQty: e.target.value })} style={{ ...INPUT, fontWeight: 700 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...LABEL, marginBottom: 4 }}>Passed</div>
                    <input type="number" inputMode="decimal" value={d.passQty}
                      onChange={(e) => setDraft(l.idx, { passQty: e.target.value })} style={{ ...INPUT, fontWeight: 700 }} />
                  </div>
                </div>
                <input value={d.remarks} onChange={(e) => setDraft(l.idx, { remarks: e.target.value })}
                  placeholder="Remarks (optional)" style={{ ...INPUT, marginTop: 8 }} />
                {qcQ > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7 }}>
                    <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{pass} pass · {fail} fail</span>
                    <Chip label={st} color={s.color} bg={s.bg} />
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ background: T.statusInfoBg, border: `1px solid ${T.statusInfo}30`, borderRadius: T.radiusMd, padding: '10px 14px', margin: '4px 0 14px', fontSize: 11.5, color: T.textSecondary, fontFamily: T.fontBody }}>
            Passed quantity posts to Stock Overview. Failed quantity initiates a Purchase Return to the vendor.
          </div>

          <button onClick={confirmInspect}
            style={{ width: '100%', padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
            Confirm Inspection
          </button>
        </div>
      </div>
    );
  }

  // ── Inspected receipt detail ──────────────────────────────────────────────
  if (view === 'detail' && activeGrn) {
    const g = activeGrn;
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{g.id}</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{g.vendor} · {g.poRef}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          <div style={CARD}>
            <Row label="Received By" value={g.receivedBy} />
            <Row label="Received" value={g.grnDate ?? g.date} />
            <Row label="Challan No" value={g.challanNo} />
            <Row label="Invoice No" value={g.invoiceNo} />
            <Row label="Remarks" value={g.note} />
          </div>

          <div style={SECTION}>Inspected Items ({g.lines.length})</div>
          {g.lines.map((l, i) => {
            const s = QC_STATUS[l.qcStatus] ?? QC_STATUS.Pending;
            return (
              <div key={i} style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{l.name}</span>
                  <Chip label={l.qcStatus} color={s.color} bg={s.bg} />
                </div>
                <div style={{ fontSize: 11.5, color: T.textSecondary, fontFamily: T.fontBody, marginTop: 4 }}>
                  {num(l.qty).toLocaleString()} {l.uom} received
                  {l.qcPassQty != null && ` · ${num(l.qcPassQty).toLocaleString()} passed`}
                  {num(l.qcFailQty) > 0 && ` · ${num(l.qcFailQty).toLocaleString()} failed`}
                </div>
                {l.qcRemarks && (
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 3 }}>{l.qcRemarks}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── List ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', flexShrink: 0 }}>
        <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Quality Control</div>
        <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
          {kpis.pending} item{kpis.pending === 1 ? '' : 's'} awaiting inspection
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
        {notice && (
          <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusMd, padding: '9px 12px', marginBottom: 10, fontSize: 11, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>
            {notice}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <KPICard label="Awaiting QC" value={kpis.pending}  sub="Received lines"   accent={T.statusPending} />
          <KPICard label="Accepted"    value={kpis.accepted} sub="Posted to stock"  accent={T.statusApproved} />
          <KPICard label="Partial"     value={kpis.partial}  sub="Some failed"      accent={T.statusBoarding} />
          <KPICard label="Rejected"    value={kpis.rejected} sub="Returned"         accent={T.statusRejected} />
        </div>

        {/* Food-safety checklists — unchanged, reached from here as before */}
        <div style={SECTION}>Food Safety Checks</div>
        {SAFETY_TILES.map((m) => (
          <div key={m.screen} onClick={() => nav.navigate(m.screen)} style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <div style={{ width: 42, height: 42, borderRadius: T.radiusMd, background: m.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
              {m.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{m.label}</div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{m.sub}</div>
            </div>
            <span style={{ fontSize: 18, color: T.textTertiary, lineHeight: 1 }}>›</span>
          </div>
        ))}

        <div style={SECTION}>Goods Inspection</div>
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GRN, vendor, item…" style={INPUT} />

        <div style={{ display: 'flex', gap: 6, padding: '10px 0 2px' }}>
          {[['pending', 'Awaiting QC'], ['done', 'Inspected'], ['all', 'All']].map(([k, label]) => {
            const on = filter === k;
            return (
              <button key={k} onClick={() => setFilter(k)}
                style={{ flex: 1, padding: '8px 0', borderRadius: T.radiusFull, border: `1px solid ${on ? T.primary : T.border}`, background: on ? T.primary : T.bgSurface, color: on ? '#fff' : T.textTertiary, fontSize: 11.5, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ ...SECTION, marginTop: 10 }}>
          {visible.length} receipt{visible.length === 1 ? '' : 's'}
        </div>

        {visible.length === 0 ? (
          <Empty icon="🔍" text={filter === 'pending'
            ? 'Nothing waiting on inspection. Approved goods receipts appear here.'
            : 'No receipts match this filter.'} />
        ) : visible.map((g) => {
          const pending = g.lines.filter((l) => l.qcStatus === 'Pending');
          const isPending = pending.length > 0;
          return (
            <div key={g.id}
              onClick={() => (isPending ? openInspect(g) : (setActiveId(g.id), setView('detail')))}
              style={{ ...CARD, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{g.id}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                    {g.vendor} · {g.poRef}
                  </div>
                </div>
                <Chip
                  label={isPending ? `${pending.length} to inspect` : 'Inspected'}
                  color={isPending ? T.statusPending : T.statusApproved}
                  bg={isPending ? T.statusPendingBg : T.statusApprovedBg}
                />
              </div>
              <div style={{ fontSize: 11.5, color: T.textSecondary, fontFamily: T.fontBody, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.lines.map((l) => `${l.name} ${num(l.qty).toLocaleString()} ${l.uom}`).join(', ')}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.primary, fontFamily: T.fontBody, marginTop: 7 }}>
                {isPending ? 'Inspect ›' : 'View inspection ›'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
