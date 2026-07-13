import { useState } from 'react';
import { T } from '../theme';
import { MOCK_DEMANDS, MOCK_STOCK } from '../mockData';

const STATUS_MAP = {
  pending:  { color: T.statusPending,  bg: T.statusPendingBg,  label: 'Pending'  },
  approved: { color: T.statusApproved, bg: T.statusApprovedBg, label: 'Approved' },
  rejected: { color: T.statusRejected, bg: T.statusRejectedBg, label: 'Rejected' },
};

// Requesters mirror the roles that raise demand on the web (/demand-orders).
const REQUESTERS = ['Kitchen Supervisor', 'Store Manager', 'Packaging Dept', 'Flight Kitchen Executive', 'Head Chef'];

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const LABEL = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };

export function DemandsScreen({ nav }) {
  const [demands, setDemands] = useState([...MOCK_DEMANDS]);
  const [view, setView]       = useState('list');   // 'list' | 'form' | 'detail'
  const [activeId, setActiveId] = useState(null);
  const [flashId, setFlashId]   = useState(null);

  // ── New-request form state ──────────────────────────────────────────────
  const [item, setItem]               = useState('');
  const [qty, setQty]                 = useState('');
  const [unit, setUnit]               = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [note, setNote]               = useState('');
  const [touched, setTouched]         = useState(false);

  const qtyNum   = parseFloat(qty) || 0;
  const canSubmit = item.trim() && qtyNum > 0 && requestedBy.trim();

  const resetForm = () => { setItem(''); setQty(''); setUnit(''); setRequestedBy(''); setNote(''); setTouched(false); };

  // When an item from the catalogue is chosen, auto-fill its unit.
  const onItemChange = (val) => {
    setItem(val);
    const hit = MOCK_STOCK.find((s) => s.name.toLowerCase() === val.trim().toLowerCase());
    if (hit) setUnit(hit.unit);
  };

  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    const seq = String(235 + demands.length).padStart(4, '0');
    const id  = `DMD-2026-${seq}`;
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const rec = {
      id, item: item.trim(), qty: qtyNum, unit: unit.trim() || 'unit',
      requestedBy: requestedBy.trim(), date, status: 'pending',
      note: note.trim() || undefined,
    };
    setDemands((prev) => [rec, ...prev]);
    setFlashId(id);
    resetForm();
    setView('list');
    setTimeout(() => setFlashId(null), 2200);
  };

  // ── Form view ───────────────────────────────────────────────────────────
  if (view === 'form') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { resetForm(); setView('list'); }} style={BTN_BACK}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>New Demand Request</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Raise material / packaging demand</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* Item */}
          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Item *</div>
            <input value={item} onChange={(e) => onItemChange(e.target.value)} list="demand-items" placeholder="Search or type an item"
              style={{ ...INPUT, border: `1px solid ${touched && !item.trim() ? T.statusRejected : T.border}` }} />
            <datalist id="demand-items">{MOCK_STOCK.map((s) => <option key={s.id} value={s.name} />)}</datalist>
          </div>

          {/* Qty + Unit */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 2 }}>
              <div style={LABEL}>Quantity *</div>
              <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0"
                style={{ ...INPUT, fontWeight: 700, border: `1px solid ${touched && qtyNum <= 0 ? T.statusRejected : T.border}` }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Unit</div>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg / pcs" style={INPUT} />
            </div>
          </div>

          {/* Requested by */}
          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Requested By *</div>
            <input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} list="demand-requesters" placeholder="Name / role"
              style={{ ...INPUT, border: `1px solid ${touched && !requestedBy.trim() ? T.statusRejected : T.border}` }} />
            <datalist id="demand-requesters">{REQUESTERS.map((r) => <option key={r} value={r} />)}</datalist>
          </div>

          {/* Note */}
          <div style={{ marginBottom: 18 }}>
            <div style={LABEL}>Note (optional)</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Reason or reference…"
              style={{ ...INPUT, resize: 'none' }} />
          </div>

          <button onClick={submit} disabled={!canSubmit}
            style={{ width: '100%', padding: '13px 0', background: canSubmit ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.7 }}>
            Submit Demand Request
          </button>
        </div>
      </div>
    );
  }

  // ── Detail view ─────────────────────────────────────────────────────────
  if (view === 'detail' && activeId) {
    const d = demands.find((x) => x.id === activeId);
    if (d) {
      const s = STATUS_MAP[d.status] || STATUS_MAP.pending;
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
          <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
            <div>
              <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Demand Detail</div>
              <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{d.id}</div>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{d.item}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{s.label}</span>
              </div>
              {[['Quantity', `${d.qty} ${d.unit}`], ['Requested By', d.requestedBy], ['Date', d.date], ['Request No.', d.id]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 7, paddingBottom: 7, borderTop: `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
                </div>
              ))}
            </div>
            {d.note && (
              <div style={{ background: T.statusInfoBg, border: `1px solid ${T.statusInfo}30`, borderRadius: T.radiusMd, padding: '10px 14px', marginTop: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.statusInfo, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Note</div>
                <div style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>{d.note}</div>
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
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Demand Requests</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{demands.length} requests</div>
        </div>
        <button onClick={() => { resetForm(); setView('form'); }}
          style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.55)', borderRadius: T.radiusMd, height: 30, padding: '0 12px', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          + New
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
        {demands.map((d) => {
          const s = STATUS_MAP[d.status] || STATUS_MAP.pending;
          const isNew = d.id === flashId;
          return (
            <div key={d.id} onClick={() => { setActiveId(d.id); setView('detail'); }}
              style={{ background: T.bgSurface, border: `1px solid ${isNew ? T.primary : T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ flex: 1, paddingRight: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{d.item}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{d.id} · {d.requestedBy}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>{s.label}</span>
              </div>
              <div style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>{d.qty} {d.unit} · {d.date}</div>
              {isNew && <div style={{ fontSize: 10, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody, marginTop: 5 }}>✓ Request raised</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
