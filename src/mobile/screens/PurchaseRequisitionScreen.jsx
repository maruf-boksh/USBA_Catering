import { useState } from 'react';
import { T } from '../theme';
// Data comes straight from the web app's Purchase Requisition source of truth.
// getPurchaseRequisitions() reads the same localStorage the web screen persists
// to (falling back to the shared seed); addPurchaseRequisition() writes back into
// that same list, so a PR raised here shows up on the web too. procurementStage /
// prReceived are the web's own derivation helpers.
import {
  getPurchaseRequisitions,
  addPurchaseRequisition,
  procurementStage,
  prReceived,
} from '@/lib/purchase-requisitions';
import { activeItems } from '@/lib/sample-data';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const LABEL = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };

const REQUESTERS = ['S. Ahmed', 'M. Hossain', 'F. Begum', 'A. Khan', 'N. Hasan', 'Store Manager', 'Kitchen Supervisor'];

// Map the web's procurement stage to the mobile status palette.
const stageStyle = (stage) => {
  switch (stage) {
    case 'Approved':
    case 'Full Order':    return { color: T.statusApproved, bg: T.statusApprovedBg };
    case 'Processing':    return { color: T.statusInfo,     bg: T.statusInfoBg };
    case 'Pending':
    case 'Partial Order': return { color: T.statusPending,  bg: T.statusPendingBg };
    case 'Rejected':
    case 'Cancelled':     return { color: T.statusRejected, bg: T.statusRejectedBg };
    default:              return { color: T.statusDraft,    bg: T.statusDraftBg };  // Draft / Closed
  }
};

const money = (n) => `৳ ${Number(n || 0).toLocaleString()}`;
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const blankLine = () => ({ id: `L${Date.now()}${Math.round(performance.now())}`, itemName: '', qty: '', uom: '', rate: '' });

export function PurchaseRequisitionScreen({ nav }) {
  // Snapshot the web data on mount (mobile mounts fresh each time it opens).
  const [requisitions, setRequisitions] = useState(() => getPurchaseRequisitions());
  const [view, setView]         = useState('list');   // 'list' | 'form' | 'detail'
  const [activeId, setActiveId] = useState(null);
  const [flashId, setFlashId]   = useState(null);

  // ── New-PR form state ───────────────────────────────────────────────────
  const [requestedBy, setRequestedBy] = useState('');
  const [requiredBy, setRequiredBy]   = useState('');
  const [priority, setPriority]       = useState('Normal');
  const [justification, setJustification] = useState('');
  const [lines, setLines]             = useState([blankLine()]);
  const [touched, setTouched]         = useState(false);

  const validLines = lines.filter((l) => l.itemName.trim() && (parseFloat(l.qty) || 0) > 0);
  const formTotal  = validLines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0), 0);
  const canSubmit  = requestedBy.trim() && validLines.length > 0;

  const resetForm = () => {
    setRequestedBy(''); setRequiredBy(''); setPriority('Normal');
    setJustification(''); setLines([blankLine()]); setTouched(false);
  };

  const setLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, blankLine()]);
  const removeLine = (id) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  // Selecting a catalogue item auto-fills its UoM and cost rate.
  const onItemPick = (id, val) => {
    const hit = activeItems.find((it) => it.name.toLowerCase() === val.trim().toLowerCase());
    setLine(id, { itemName: val, ...(hit ? { uom: hit.uom, rate: hit.costPrice != null ? String(hit.costPrice) : '' } : {}) });
  };

  const submit = (asDraft) => {
    setTouched(true);
    if (!canSubmit) return;
    const created = addPurchaseRequisition({
      date: todayStr(),
      officeId: 'OFF-001',
      warehouseId: 'WH-003',
      requestedBy: requestedBy.trim(),
      requiredBy: requiredBy || '—',
      priority,
      justification: justification.trim(),
      lines: validLines.map((l, i) => ({
        id: `L${i + 1}`,
        itemName: l.itemName.trim(),
        description: '',
        qty: parseFloat(l.qty) || 0,
        uom: l.uom.trim() || 'unit',
        rate: parseFloat(l.rate) || 0,
      })),
      status: asDraft ? 'Draft' : 'Pending Approval',
    });
    // Re-read so the new PR (and its assigned id) appears at the top of the list.
    setRequisitions(getPurchaseRequisitions());
    setFlashId(created.id);
    resetForm();
    setView('list');
    setTimeout(() => setFlashId(null), 2400);
  };

  // ── Form view ───────────────────────────────────────────────────────────
  if (view === 'form') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { resetForm(); setView('list'); }} style={BTN_BACK}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>New Purchase Requisition</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Raise a requisition · syncs to web</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* Requested by */}
          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Requested By *</div>
            <input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} list="pr-requesters" placeholder="Name / role"
              style={{ ...INPUT, border: `1px solid ${touched && !requestedBy.trim() ? T.statusRejected : T.border}` }} />
            <datalist id="pr-requesters">{REQUESTERS.map((r) => <option key={r} value={r} />)}</datalist>
          </div>

          {/* Required by + priority */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Required By</div>
              <input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} style={INPUT} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Priority</div>
              <div style={{ display: 'flex', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, overflow: 'hidden' }}>
                {['Normal', 'Urgent'].map((p) => (
                  <button key={p} onClick={() => setPriority(p)}
                    style={{ flex: 1, padding: '9px 0', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer', border: 'none',
                      background: priority === p ? (p === 'Urgent' ? T.statusRejected : T.primary) : T.bgSurface,
                      color: priority === p ? '#fff' : T.textTertiary }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Line items */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 2px 8px' }}>
            <div style={{ ...LABEL, marginBottom: 0 }}>Items *</div>
            <button onClick={addLine} style={{ background: 'none', border: `1px solid ${T.primary}`, color: T.primary, borderRadius: T.radiusMd, padding: '3px 10px', fontSize: 11, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>+ Add</button>
          </div>

          {lines.map((l, idx) => {
            const lineTotal = (parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0);
            const missing = touched && !(l.itemName.trim() && (parseFloat(l.qty) || 0) > 0) && (l.itemName.trim() || l.qty);
            return (
              <div key={l.id} style={{ background: T.bgSurface, border: `1px solid ${missing ? T.statusRejected : T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody }}>Item {idx + 1}</span>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(l.id)} style={{ background: 'none', border: 'none', color: T.statusRejected, fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
                  )}
                </div>
                <input value={l.itemName} onChange={(e) => onItemPick(l.id, e.target.value)} list="pr-items" placeholder="Search or type an item"
                  style={{ ...INPUT, marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="number" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value })} placeholder="Qty" style={{ ...INPUT, flex: 1, fontWeight: 700 }} />
                  <input value={l.uom} onChange={(e) => setLine(l.id, { uom: e.target.value })} placeholder="UoM" style={{ ...INPUT, flex: 1 }} />
                  <input type="number" inputMode="decimal" value={l.rate} onChange={(e) => setLine(l.id, { rate: e.target.value })} placeholder="Rate" style={{ ...INPUT, flex: 1 }} />
                </div>
                {lineTotal > 0 && (
                  <div style={{ textAlign: 'right', fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 5 }}>Line total: <span style={{ fontWeight: 700, color: T.textPrimary }}>{money(lineTotal)}</span></div>
                )}
              </div>
            );
          })}
          <datalist id="pr-items">{activeItems.map((it) => <option key={it.id} value={it.name} />)}</datalist>

          {/* Justification */}
          <div style={{ margin: '6px 0 14px' }}>
            <div style={LABEL}>Justification (optional)</div>
            <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} placeholder="Reason for this requisition…"
              style={{ ...INPUT, resize: 'none' }} />
          </div>

          {/* Total */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.bgSubtle, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 14px', marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Est. Total</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{money(formTotal)}</span>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => submit(true)} disabled={!canSubmit}
              style={{ flex: 1, padding: '13px 0', background: 'none', border: `2px solid ${canSubmit ? T.borderStrong : T.border}`, borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: canSubmit ? T.textSecondary : T.textDisabled, fontFamily: T.fontBody, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
              Save Draft
            </button>
            <button onClick={() => submit(false)} disabled={!canSubmit}
              style={{ flex: 2, padding: '13px 0', background: canSubmit ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.7 }}>
              Submit for Approval
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Detail view ─────────────────────────────────────────────────────────
  if (view === 'detail' && activeId) {
    const pr = requisitions.find((r) => r.id === activeId);
    if (pr) {
      const stage = procurementStage(pr);
      const s = stageStyle(stage);
      const { ordered, received, pct } = prReceived(pr);
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
          <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
            <div>
              <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Requisition Detail</div>
              <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{pr.id}</div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {/* Summary */}
            <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{money(pr.totalAmount)}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{stage}</span>
              </div>
              {[['Requested By', pr.requestedBy], ['Date', pr.date], ['Required By', pr.requiredBy], ['Priority', pr.priority]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 7, paddingBottom: 7, borderTop: `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: l === 'Priority' && v === 'Urgent' ? T.statusRejected : T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Receipt progress — only meaningful once approved */}
            {(stage === 'Processing' || stage === 'Partial Order' || stage === 'Full Order') && (
              <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Received</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{received} / {ordered} · {pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: T.radiusFull, background: T.bgSubtle, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? T.statusApproved : T.primary }} />
                </div>
              </div>
            )}

            {/* Line items */}
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 2px 8px' }}>
              Items ({pr.lines.length})
            </div>
            {pr.lines.map((l) => (
              <div key={l.id} style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{l.itemName}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, flexShrink: 0, paddingLeft: 8 }}>{money(l.qty * l.rate)}</span>
                </div>
                {l.description && <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 3 }}>{l.description}</div>}
                <div style={{ fontSize: 11, color: T.textSecondary, fontFamily: T.fontBody }}>{l.qty} {l.uom} × {money(l.rate)}</div>
              </div>
            ))}

            {/* Justification */}
            {pr.justification && (
              <div style={{ background: T.statusInfoBg, border: `1px solid ${T.statusInfo}30`, borderRadius: T.radiusMd, padding: '10px 14px', marginTop: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.statusInfo, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Justification</div>
                <div style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>{pr.justification}</div>
              </div>
            )}
          </div>
        </div>
      );
    }
  }

  // ── List view ───────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Purchase Requisition</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{requisitions.length} requisitions · from web</div>
        </div>
        <button onClick={() => { resetForm(); setView('form'); }}
          style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.55)', borderRadius: T.radiusMd, height: 30, padding: '0 12px', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          + New
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
        {requisitions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
            <div style={{ fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody }}>No purchase requisitions yet. Tap “+ New” to raise one.</div>
          </div>
        ) : requisitions.map((pr) => {
          const stage = procurementStage(pr);
          const s = stageStyle(stage);
          const isNew = pr.id === flashId;
          return (
            <div key={pr.id} onClick={() => { setActiveId(pr.id); setView('detail'); }}
              style={{ background: T.bgSurface, border: `1px solid ${isNew ? T.primary : T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ flex: 1, paddingRight: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{pr.id}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{pr.requestedBy} · {pr.date}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>{stage}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>{pr.lines.length} item{pr.lines.length === 1 ? '' : 's'}{pr.priority === 'Urgent' ? ' · Urgent' : ''}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{money(pr.totalAmount)}</span>
              </div>
              {isNew && <div style={{ fontSize: 10, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody, marginTop: 5 }}>✓ Requisition raised · synced to web</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
