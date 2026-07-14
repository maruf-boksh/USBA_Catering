import { useState } from 'react';
import { T } from '../theme';
import { getDemandRequests, addDemandRequest } from '@/lib/demand-requests';
import { inventory } from '@/lib/sample-data';
import { getAuthUser } from '@/lib/auth';
import { Combobox } from '../components/Combobox';

// Item catalogue for the picker — real inventory so created demands reference
// the same items the web uses (id + uom carried through).
const ITEM_NAMES = inventory.map((it) => it.name);

// Web WfDemandStatus → mobile colour bucket + compact pill label. Web statuses
// are richer/longer than the old 3-state mock, so map them onto pending /
// approved / rejected tones and shorten the label to fit a phone pill.
const SHORT_STATUS = {
  'pending approval': 'Pending',
  'pending store review': 'Store Review',
  'partially available': 'Partial',
  'partially issued': 'Partial',
  'partially fulfilled': 'Partial',
  'escalated to supply chain': 'Escalated',
  fulfilled: 'Fulfilled',
  rejected: 'Rejected',
};
function statusTone(status) {
  const s = String(status || '').toLowerCase();
  const label = SHORT_STATUS[s] || status || 'Pending';
  if (s.includes('reject')) return { color: T.statusRejected, bg: T.statusRejectedBg, label };
  if (s.includes('fulfilled') || s.includes('approved') || s.includes('available') || s.includes('issued'))
    return { color: T.statusApproved, bg: T.statusApprovedBg, label };
  return { color: T.statusPending, bg: T.statusPendingBg, label };
}

const REQUESTERS = ['Kitchen Supervisor', 'Store Manager', 'Packaging Dept', 'Flight Kitchen Executive', 'Head Chef'];

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const LABEL = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };

const primaryItem = (d) => (d.items && d.items[0]) || { name: '—', qty: 0, uom: '' };
const totalQty    = (d) => (d.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);

export function DemandsScreen({ nav }) {
  const [demands, setDemands]   = useState(() => getDemandRequests());
  const [view, setView]         = useState('list');   // 'list' | 'form' | 'detail'
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

  const resetForm = () => { setItem(''); setQty(''); setUnit(''); setRequestedBy(getAuthUser()?.name ?? ''); setNote(''); setTouched(false); };

  // When an item from the catalogue is chosen, auto-fill its unit.
  const onItemChange = (val) => {
    setItem(val);
    const hit = inventory.find((it) => it.name.toLowerCase() === val.trim().toLowerCase());
    if (hit) setUnit(hit.uom);
  };

  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    const hit = inventory.find((it) => it.name.toLowerCase() === item.trim().toLowerCase());
    const rec = addDemandRequest({
      requestedBy: requestedBy.trim(),
      role: 'Kitchen Supervisor',
      note: note.trim() || undefined,
      items: [{
        id: hit?.id ?? `MP-${item.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
        name: item.trim(),
        qty: qtyNum,
        uom: unit.trim() || hit?.uom || 'unit',
      }],
    });
    // Reflect immediately + keep in sync with the shared web store.
    setDemands([rec, ...demands]);
    setFlashId(rec.id);
    resetForm();
    setView('list');
    setTimeout(() => setFlashId(null), 2200);
  };

  const openForm = () => { resetForm(); setView('form'); };

  // ── Form view ───────────────────────────────────────────────────────────
  if (view === 'form') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { resetForm(); setView('list'); }} style={BTN_BACK}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>New Demand Request</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Raise material demand · syncs to web</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* Item */}
          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Item *</div>
            <Combobox value={item} onChange={onItemChange} options={ITEM_NAMES}
              placeholder="Search or type an item" invalid={touched && !item.trim()} />
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
            <Combobox value={requestedBy} onChange={setRequestedBy} options={REQUESTERS}
              placeholder="Name / role" invalid={touched && !requestedBy.trim()} />
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
      const s = statusTone(d.status);
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
            <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', boxShadow: T.shadowSm }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, paddingRight: 8 }}>{d.reference || d.id}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>{s.label}</span>
              </div>
              {[['Requested By', d.requestedBy], ['Role', d.role], ['Date', d.date], ['Request No.', d.id]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 7, paddingBottom: 7, borderTop: `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 2px 8px' }}>Items ({(d.items || []).length})</div>
            {(d.items || []).map((it, i) => (
              <div key={i} style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, paddingRight: 8 }}>{it.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, fontFamily: T.fontBody, flexShrink: 0 }}>{it.qty} {it.uom || ''}</span>
              </div>
            ))}

            {d.note && (
              <div style={{ background: T.statusInfoBg, border: `1px solid ${T.statusInfo}30`, borderRadius: T.radiusMd, padding: '10px 14px', marginTop: 8 }}>
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
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{demands.length} requests · synced to web</div>
        </div>
        <button onClick={openForm}
          style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.55)', borderRadius: T.radiusMd, height: 30, padding: '0 12px', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          + New
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
        {demands.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📝</div>
            <div style={{ fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody }}>No demand requests yet. Tap “+ New” to raise one.</div>
          </div>
        ) : demands.map((d) => {
          const s = statusTone(d.status);
          const isNew = d.id === flashId;
          const first = primaryItem(d);
          const extra = (d.items || []).length - 1;
          return (
            <div key={d.id} onClick={() => { setActiveId(d.id); setView('detail'); }}
              style={{ background: T.bgSurface, border: `1px solid ${isNew ? T.primary : T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ flex: 1, paddingRight: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                    {first.name}{extra > 0 ? <span style={{ color: T.textTertiary, fontWeight: 400 }}> +{extra} more</span> : null}
                  </div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{d.id} · {d.requestedBy}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>{s.label}</span>
              </div>
              <div style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>{(d.items || []).length} item{(d.items || []).length === 1 ? '' : 's'} · {totalQty(d)} total · {d.date}</div>
              {isNew && <div style={{ fontSize: 10, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody, marginTop: 5 }}>✓ Request raised · synced to web</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
