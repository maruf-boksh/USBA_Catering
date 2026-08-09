import { useState } from 'react';
import { T } from '../theme';
import { KPICard } from '../components/KPICard';
import { Combobox } from '../components/Combobox';
// Wastage Management on the phone, on the WEB's own store — the
// "wastage-entries" list routes/wastage-management.tsx persists.
//
// A report is raised here in the same shape the web writes (Pending In-Charge,
// with the "Prepared By · Submitted" step already on its trail), so it enters
// the very same three-stage approval chain — In-Charge → GM Catering → Final
// Authorization — which is worked in Approval Management, not here.
import { activeItems } from '@/lib/sample-data';
import { getAuthUser } from '@/lib/auth';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const LABEL = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };
const CARD = { background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm };
const SECTION = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 2px 8px' };

const WASTAGE_KEY = 'harvest-data-v1:wastage-entries';

// The web's own option lists, so a report raised here reads identically there.
const WASTAGE_TYPES = ['Production', 'Airport Store', 'Return Item', 'Transfer', 'Expired Product'];
const DISPOSAL_REASONS = [
  'Expired / Past Expiry Date', 'Physical Damage', 'Contamination', 'Over-production',
  'Quality Rejection', 'Temperature Abuse', 'Pest / Rodent Damage', 'Spillage / Breakage',
  'Customer Complaint', 'Other',
];
const DISPOSAL_METHODS = [
  'Incineration', 'Composting', 'Landfill Disposal', 'Sewage / Drain', 'Animal Feed',
  'Third-party Disposal', 'Destroy', 'N/A',
];
const UNITS = ['Kg', 'g', 'L', 'ml', 'Pcs', 'Units', 'Box', 'Tray', 'Bag'];
const ITEM_NAMES = activeItems.map((i) => i.name);

const WSTATUS = {
  'Pending In-Charge': { label: 'Pending In-Charge', color: T.statusPending,  bg: T.statusPendingBg },
  'Pending GM':        { label: 'Pending GM',        color: T.statusPending,  bg: T.statusPendingBg },
  'Pending Final':     { label: 'Pending Final',     color: T.statusBoarding, bg: T.statusBoardingBg },
  'Final Approved':    { label: 'Final Approved',    color: T.statusApproved, bg: T.statusApprovedBg },
  'Rejected':          { label: 'Rejected',          color: T.statusRejected, bg: T.statusRejectedBg },
};
const STATUS_KEYS = Object.keys(WSTATUS);
const PENDING = ['Pending In-Charge', 'Pending GM', 'Pending Final'];

const num = (v) => Number(v) || 0;
const p2 = (n) => String(n).padStart(2, '0');
const todayDate = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const nowTime = () => { const d = new Date(); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const stamp = () => `${todayDate()} ${nowTime()}`;

function readEntries() {
  try { const raw = localStorage.getItem(WASTAGE_KEY); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
function writeEntries(list) {
  try { localStorage.setItem(WASTAGE_KEY, JSON.stringify(list)); } catch { /* quota — non-fatal */ }
}

/** WDD-YYYY-#### — the web's own id sequence. */
function genId(entries) {
  const max = entries.reduce((m, e) => {
    const n = parseInt(String(e.id).split('-').pop() ?? '0', 10);
    return n > m ? n : m;
  }, 0);
  return `WDD-${new Date().getFullYear()}-${String(max + 1).padStart(4, '0')}`;
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
    <div style={{ textAlign: 'center', padding: '46px 0' }}>
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

export function WastageScreen({ nav }) {
  const [entries, setEntries] = useState(() => readEntries());
  const [view, setView]     = useState('list');   // 'list' | 'detail' | 'log'
  const [activeId, setActiveId] = useState(null);
  const [query, setQuery]   = useState('');
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const flash = (m) => { setNotice(m); setTimeout(() => setNotice(''), 2800); };

  const kpis = {
    total: entries.length,
    pending: entries.filter((e) => PENDING.includes(e.status)).length,
    approved: entries.filter((e) => e.status === 'Final Approved').length,
    qty: entries.reduce((s, e) => s + num(e.disposalQty), 0),
  };

  const visible = entries.filter((e) => {
    if (filter !== 'all' && e.status !== filter) return false;
    if (!query.trim()) return true;
    const hay = `${e.id} ${e.itemName} ${e.wastageType} ${e.disposalReason} ${e.preparedBy}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });
  const sorted = [...visible].sort((a, b) => String(b.preparedAt ?? '').localeCompare(String(a.preparedAt ?? '')));
  const activeEntry = entries.find((e) => e.id === activeId) ?? null;

  // ── Log form ──────────────────────────────────────────────────────────────
  const [fType, setFType] = useState('');
  const [fItem, setFItem] = useState('');
  const [fQty, setFQty] = useState('');
  const [fUnit, setFUnit] = useState('Kg');
  const [fBatch, setFBatch] = useState('');
  const [fReason, setFReason] = useState('');
  const [fReasonOther, setFReasonOther] = useState('');
  const [fReprocess, setFReprocess] = useState('No');
  const [fMethod, setFMethod] = useState('');
  const [fRootCause, setFRootCause] = useState('');
  const [fCorrection, setFCorrection] = useState('');
  const [touched, setTouched] = useState(false);

  const resetForm = () => {
    setFType(''); setFItem(''); setFQty(''); setFUnit('Kg'); setFBatch('');
    setFReason(''); setFReasonOther(''); setFReprocess('No'); setFMethod('');
    setFRootCause(''); setFCorrection(''); setTouched(false);
  };

  const canLog = fType && fItem.trim() && num(fQty) > 0 && fReason
    && (fReason !== 'Other' || fReasonOther.trim()) && fRootCause.trim();

  /** The record the web writes — straight into the In-Charge approval stage. */
  const submitLog = () => {
    setTouched(true);
    if (!canLog) return;
    const user = getAuthUser();
    const by = user?.name ?? 'Mobile';
    const at = stamp();
    const entry = {
      id: genId(entries),
      reportingDate: todayDate(),
      wastageType: fType,
      itemName: fItem.trim(),
      packageBatchSize: '',
      batchCode: fBatch.trim() || 'N/A',
      productionDate: 'N/A',
      disposalQty: num(fQty),
      disposalQtyUnit: fUnit,
      disposalReason: fReason === 'Other' ? (fReasonOther.trim() || 'Other') : fReason,
      reprocessingPossibility: fReprocess,
      disposalMethod: fMethod || 'N/A',
      disposalDate: todayDate(),
      disposalTime: nowTime(),
      rootCause: fRootCause.trim(),
      correction: fCorrection.trim() || 'N/A',
      correctiveActionPlan: [],
      responsiblePersons: [],
      eligibleForCompensation: false,
      compensationJustification: '',
      preparedBy: by,
      preparedByDesignation: user?.role ?? 'Senior Executive-Food Safety & Hygiene',
      preparedAt: at,
      status: 'Pending In-Charge',
      approvalSteps: [
        { step: 'Prepared By', by, designation: user?.role ?? 'Senior Executive-Food Safety & Hygiene', action: 'Submitted', at },
      ],
    };
    const next = [entry, ...entries];
    setEntries(next);
    writeEntries(next);
    resetForm();
    setView('list');
    flash(`${entry.id} submitted — Pending In-Charge approval.`);
  };

  // ── Log Wastage ───────────────────────────────────────────────────────────
  if (view === 'log') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { resetForm(); setView('list'); }} style={BTN_BACK}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Log Wastage</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Disposal report · goes for approval</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Wastage Type *</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {WASTAGE_TYPES.map((t) => {
                const on = fType === t;
                return (
                  <button key={t} onClick={() => setFType(t)}
                    style={{ padding: '7px 12px', borderRadius: T.radiusFull, border: `1px solid ${on ? T.primary : (touched && !fType ? T.statusRejected : T.border)}`, background: on ? T.primary : T.bgSurface, color: on ? '#fff' : T.textTertiary, fontSize: 11.5, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Item *</div>
            <Combobox value={fItem} onChange={setFItem} options={ITEM_NAMES}
              placeholder="Search or type the item" invalid={touched && !fItem.trim()} />
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Disposal Qty *</div>
              <input type="number" inputMode="decimal" value={fQty} onChange={(e) => setFQty(e.target.value)}
                placeholder="0"
                style={{ ...INPUT, fontWeight: 700, borderColor: touched && !(num(fQty) > 0) ? T.statusRejected : T.border }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Unit</div>
              <select value={fUnit} onChange={(e) => setFUnit(e.target.value)} style={{ ...INPUT, fontSize: 12 }}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Batch Code</div>
            <input value={fBatch} onChange={(e) => setFBatch(e.target.value)} placeholder="Batch / lot reference" style={INPUT} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Disposal Reason *</div>
            <select value={fReason} onChange={(e) => setFReason(e.target.value)}
              style={{ ...INPUT, fontSize: 12, borderColor: touched && !fReason ? T.statusRejected : T.border }}>
              <option value="">Select a reason…</option>
              {DISPOSAL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {fReason === 'Other' && (
              <input value={fReasonOther} onChange={(e) => setFReasonOther(e.target.value)}
                placeholder="Specify the reason" style={{ ...INPUT, marginTop: 8 }} />
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Reprocessing</div>
              <div style={{ display: 'flex', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, overflow: 'hidden' }}>
                {['Yes', 'No', 'N/A'].map((v) => (
                  <button key={v} onClick={() => setFReprocess(v)}
                    style={{ flex: 1, padding: '9px 0', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer', border: 'none',
                      background: fReprocess === v ? T.primary : T.bgSurface, color: fReprocess === v ? '#fff' : T.textTertiary }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Disposal Method</div>
            <select value={fMethod} onChange={(e) => setFMethod(e.target.value)} style={{ ...INPUT, fontSize: 12 }}>
              <option value="">Select a method…</option>
              {DISPOSAL_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Root Cause *</div>
            <textarea value={fRootCause} onChange={(e) => setFRootCause(e.target.value)} rows={2}
              placeholder="Why did this happen?"
              style={{ ...INPUT, resize: 'none', borderColor: touched && !fRootCause.trim() ? T.statusRejected : T.border }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Correction Taken</div>
            <textarea value={fCorrection} onChange={(e) => setFCorrection(e.target.value)} rows={2}
              placeholder="What was done immediately?" style={{ ...INPUT, resize: 'none' }} />
          </div>

          <button onClick={submitLog} disabled={!canLog}
            style={{ width: '100%', padding: '13px 0', background: canLog ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: canLog ? 'pointer' : 'not-allowed', opacity: canLog ? 1 : 0.7 }}>
            Submit For Approval
          </button>
          <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, textAlign: 'center', marginTop: 8 }}>
            Goes to In-Charge → GM Catering → Final Authorization.
          </div>
        </div>
      </div>
    );
  }

  // ── Detail ────────────────────────────────────────────────────────────────
  if (view === 'detail' && activeEntry) {
    const e = activeEntry;
    const s = WSTATUS[e.status] ?? WSTATUS['Pending In-Charge'];
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{e.itemName}</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{e.id} · {e.wastageType || 'Unspecified'}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          <div style={CARD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                {num(e.disposalQty).toLocaleString()} {e.disposalQtyUnit}
              </span>
              <Chip label={s.label} color={s.color} bg={s.bg} />
            </div>
            <Row label="Wastage Type" value={e.wastageType} />
            <Row label="Reported" value={e.reportingDate} />
            <Row label="Batch Code" value={e.batchCode} />
            <Row label="Disposal Reason" value={e.disposalReason} />
            <Row label="Reprocessing" value={e.reprocessingPossibility} />
            <Row label="Disposal Method" value={e.disposalMethod} />
            <Row label="Disposed" value={`${e.disposalDate ?? ''} ${e.disposalTime ?? ''}`.trim()} />
            <Row label="Prepared By" value={`${e.preparedBy}${e.preparedByDesignation ? ` · ${e.preparedByDesignation}` : ''}`} />
            <Row label="Prepared At" value={e.preparedAt} />
            {e.returnRef && <Row label="Return Ref" value={e.returnRef} />}
            {e.stockItemName && <Row label="Stock Item" value={`${e.stockItemName}${e.previousStock != null ? ` · was ${e.previousStock}` : ''}`} />}
          </div>

          {(e.rootCause || e.correction) && (
            <>
              <div style={SECTION}>Analysis</div>
              <div style={CARD}>
                <Row label="Root Cause" value={e.rootCause} />
                <Row label="Correction" value={e.correction} />
                {(e.correctiveActionPlan ?? []).map((a, i) => (
                  <Row key={i} label={`Action ${i + 1}`} value={a} />
                ))}
              </div>
            </>
          )}

          {(e.responsiblePersons ?? []).length > 0 && (
            <>
              <div style={SECTION}>Responsible ({e.responsiblePersons.length})</div>
              <div style={CARD}>
                {e.responsiblePersons.map((p, i) => (
                  <div key={`${p.empId}-${i}`} style={{ padding: '8px 0', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{p.name}</span>
                      {num(p.penaltyAmount) > 0 && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody }}>
                          ৳ {num(p.penaltyAmount).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                      {[p.empId, p.designation, p.section].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Approval trail — the three-stage chain, as recorded on the entry */}
          <div style={SECTION}>Approval Trail</div>
          <div style={CARD}>
            {(e.approvalSteps ?? []).length === 0 ? (
              <div style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, padding: '4px 0' }}>No steps recorded yet.</div>
            ) : e.approvalSteps.map((st, i) => {
              const color = st.action === 'Approved' ? T.statusApproved
                : st.action === 'Rejected' ? T.statusRejected
                : st.action === 'Returned' ? T.statusPending : T.statusInfo;
              return (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                  <span style={{ width: 9, height: 9, borderRadius: T.radiusFull, background: color, flexShrink: 0, marginTop: 4 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{st.step}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: T.fontBody }}>{st.action}</span>
                    </div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                      {[st.by, st.designation, st.at].filter(Boolean).join(' · ')}
                    </div>
                    {st.comment && (
                      <div style={{ fontSize: 11, color: T.textSecondary, fontFamily: T.fontBody, marginTop: 3 }}>{st.comment}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {PENDING.includes(e.status) && (
            <div style={{ background: T.statusPendingBg, border: `1px solid ${T.statusPending}30`, borderRadius: T.radiusMd, padding: '10px 14px', marginTop: 10, fontSize: 12, color: T.statusPending, fontFamily: T.fontBody }}>
              Waiting on {e.status.replace('Pending ', '')} — signed off in Approval Management.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Wastage Management</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
            {kpis.total} report{kpis.total === 1 ? '' : 's'} · {kpis.pending} pending
          </div>
        </div>
        <button onClick={() => { resetForm(); setView('log'); }}
          style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.55)', borderRadius: T.radiusMd, height: 30, padding: '0 12px', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, flexShrink: 0 }}>
          + Log
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
        {notice && (
          <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusMd, padding: '9px 12px', marginBottom: 10, fontSize: 11, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>
            {notice}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <KPICard label="Total Reports"   value={kpis.total}    sub="All records"     accent={T.statusInfo} />
          <KPICard label="Pending Approval" value={kpis.pending} sub="Awaiting action" accent={T.statusPending} />
          <KPICard label="Final Approved"  value={kpis.approved} sub="Fully processed" accent={T.statusApproved} />
          <KPICard label="Total Disposal"  value={kpis.qty.toFixed(1)} sub="Cumulative qty" accent={T.statusRejected} />
        </div>

        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search item, type, reason…" style={{ ...INPUT, marginTop: 12 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 0' }}>
          <button onClick={() => setFilter('all')}
            style={{ flexShrink: 0, padding: '8px 14px', borderRadius: T.radiusFull, border: `1px solid ${filter === 'all' ? T.primary : T.border}`, background: filter === 'all' ? T.primary : T.bgSurface, color: filter === 'all' ? '#fff' : T.textTertiary, fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
            All
          </button>
          <select value={filter} onChange={(ev) => setFilter(ev.target.value)}
            style={{ ...INPUT, flex: 1, minWidth: 0, padding: '9px 10px', fontSize: 12, fontWeight: 700 }}>
            <option value="all">All statuses</option>
            {STATUS_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div style={{ ...SECTION, marginTop: 12 }}>
          {sorted.length} report{sorted.length === 1 ? '' : 's'}
        </div>

        {sorted.length === 0 ? (
          <Empty icon="🗑️" text={entries.length === 0
            ? 'No wastage reports yet. Tap “+ Log” to raise one.'
            : 'No reports match the current filter.'} />
        ) : sorted.map((e) => {
          const s = WSTATUS[e.status] ?? WSTATUS['Pending In-Charge'];
          return (
            <div key={e.id} onClick={() => { setActiveId(e.id); setView('detail'); }} style={{ ...CARD, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div style={{ flex: 1, paddingRight: 8, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{e.itemName}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                    {e.id} · {e.wastageType || 'Unspecified'} · {e.reportingDate}
                  </div>
                </div>
                <Chip label={s.label} color={s.color} bg={s.bg} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span style={{ fontSize: 11.5, color: T.textSecondary, fontFamily: T.fontBody, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.disposalReason}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, flexShrink: 0, paddingLeft: 8 }}>
                  {num(e.disposalQty).toLocaleString()} {e.disposalQtyUnit}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
