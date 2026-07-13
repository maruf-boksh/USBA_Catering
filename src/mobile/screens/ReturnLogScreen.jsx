import { useState } from 'react';
import { T } from '../theme';
import { MOCK_RETURNS } from '../mockData';
import { consumableItems } from '@/lib/sample-data';

const RETURNS_KEY = 'harvest-data-v1:consumable-returns';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

// Flight → sector shortcuts (match the web returns flight schedule).
const FLIGHTS = [
  { flight: 'BG-401', sector: 'DAC→DXB' },
  { flight: 'BS-141', sector: 'DAC→CGP' },
  { flight: 'BS-105', sector: 'DAC→CXB' },
  { flight: 'BG-522', sector: 'DAC→LHR' },
  { flight: 'VQ-901', sector: 'DAC→KUL' },
];
const RETURNERS = ['T. Ahmed', 'S. Karim', 'M. Rahman', 'K. Sultana', 'Cabin Crew'];

// Read / write the SAME localStorage list the web Consumable Returns screen uses.
function loadWebReturns() {
  try {
    const raw = localStorage.getItem(RETURNS_KEY);
    const l = raw ? JSON.parse(raw) : [];
    return Array.isArray(l) ? l : [];
  } catch { return []; }
}
function persistWebReturns(list) {
  try { localStorage.setItem(RETURNS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}
// Initial display: real web returns if any, else the demo seed so it's not empty.
function initialReturns() {
  const web = loadWebReturns();
  return web.length > 0 ? web : MOCK_RETURNS;
}

const sum = (lines, key) => lines.reduce((s, l) => s + (Number(l[key]) || 0), 0);
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const blankLine = () => ({ id: `L${Date.now()}${Math.round(performance.now())}`, itemName: '', qty: '', reusableQty: '', uom: '' });

export function ReturnLogScreen({ nav }) {
  const [returns, setReturns] = useState(() => initialReturns());
  const [view, setView]       = useState('list');   // 'list' | 'form' | 'detail'
  const [activeId, setActiveId] = useState(null);
  const [flashId, setFlashId]   = useState(null);

  // Form state
  const [flight, setFlight]         = useState('');
  const [sector, setSector]         = useState('');
  const [returnedBy, setReturnedBy] = useState('');
  const [date, setDate]             = useState(todayStr());
  const [lines, setLines]           = useState([blankLine()]);
  const [touched, setTouched]       = useState(false);

  const validLines = lines.filter((l) => l.itemName.trim() && (parseFloat(l.qty) || 0) > 0);
  const canSubmit  = flight.trim() && returnedBy.trim() && validLines.length > 0;

  const resetForm = () => { setFlight(''); setSector(''); setReturnedBy(''); setDate(todayStr()); setLines([blankLine()]); setTouched(false); };
  const setLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, blankLine()]);
  const removeLine = (id) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const onFlightPick = (val) => {
    setFlight(val);
    const hit = FLIGHTS.find((f) => f.flight.toLowerCase() === val.trim().toLowerCase());
    if (hit) setSector(hit.sector);
  };
  const onItemPick = (id, val) => {
    const hit = consumableItems.find((it) => it.name.toLowerCase() === val.trim().toLowerCase());
    setLine(id, { itemName: val, ...(hit ? { uom: hit.uom } : {}) });
  };

  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    const seq = String(7000 + returns.length + 1).padStart(4, '0');
    const id  = `CR-${seq}`;
    const rec = {
      id, date, scheduledTime: '', flight: flight.trim(),
      sector: sector.trim() || '—', returnedBy: returnedBy.trim(),
      forwardToAirportStore: true,
      lines: validLines.map((l) => {
        const qty = parseFloat(l.qty) || 0;
        const reusableQty = Math.min(parseFloat(l.reusableQty) || 0, qty);
        const hit = consumableItems.find((it) => it.name.toLowerCase() === l.itemName.trim().toLowerCase());
        return {
          itemId: hit?.id ?? `MP-${l.itemName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
          itemName: l.itemName.trim(),
          qty, reusableQty,
          uom: l.uom.trim() || hit?.uom || 'Pcs',
          reusable: reusableQty > 0,
          lineType: 'item',
        };
      }),
    };
    // Show it in-session (keeps any demo seed visible) and persist to the web list.
    setReturns((prev) => [rec, ...prev]);
    persistWebReturns([rec, ...loadWebReturns()]);
    setFlashId(id);
    resetForm();
    setView('list');
    setTimeout(() => setFlashId(null), 2400);
  };

  // ── Form view ─────────────────────────────────────────────────────────────
  if (view === 'form') {
    const LABEL = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
    const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { resetForm(); setView('list'); }} style={BTN_BACK}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>New Return</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Log a consumable return · syncs to web</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* Flight + sector */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Flight *</div>
              <input value={flight} onChange={(e) => onFlightPick(e.target.value)} list="ret-flights" placeholder="e.g. BS-105"
                style={{ ...INPUT, border: `1px solid ${touched && !flight.trim() ? T.statusRejected : T.border}` }} />
              <datalist id="ret-flights">{FLIGHTS.map((f) => <option key={f.flight} value={f.flight} />)}</datalist>
            </div>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Sector</div>
              <input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="DAC→…" style={INPUT} />
            </div>
          </div>

          {/* Returned by + date */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Returned By *</div>
              <input value={returnedBy} onChange={(e) => setReturnedBy(e.target.value)} list="ret-returners" placeholder="Name"
                style={{ ...INPUT, border: `1px solid ${touched && !returnedBy.trim() ? T.statusRejected : T.border}` }} />
              <datalist id="ret-returners">{RETURNERS.map((r) => <option key={r} value={r} />)}</datalist>
            </div>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Date</div>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={INPUT} />
            </div>
          </div>

          {/* Items */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 2px 8px' }}>
            <div style={{ ...LABEL, marginBottom: 0 }}>Returned Items *</div>
            <button onClick={addLine} style={{ background: 'none', border: `1px solid ${T.primary}`, color: T.primary, borderRadius: T.radiusMd, padding: '3px 10px', fontSize: 11, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>+ Add</button>
          </div>

          {lines.map((l, idx) => {
            const missing = touched && !(l.itemName.trim() && (parseFloat(l.qty) || 0) > 0) && (l.itemName.trim() || l.qty);
            return (
              <div key={l.id} style={{ background: T.bgSurface, border: `1px solid ${missing ? T.statusRejected : T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody }}>Item {idx + 1}</span>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(l.id)} style={{ background: 'none', border: 'none', color: T.statusRejected, fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
                  )}
                </div>
                <input value={l.itemName} onChange={(e) => onItemPick(l.id, e.target.value)} list="ret-items" placeholder="Search or type an item"
                  style={{ ...INPUT, marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="number" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value })} placeholder="Return qty" style={{ ...INPUT, flex: 1, fontWeight: 700 }} />
                  <input type="number" inputMode="decimal" value={l.reusableQty} onChange={(e) => setLine(l.id, { reusableQty: e.target.value })} placeholder="Reusable" style={{ ...INPUT, flex: 1 }} />
                  <input value={l.uom} onChange={(e) => setLine(l.id, { uom: e.target.value })} placeholder="UoM" style={{ ...INPUT, flex: 1 }} />
                </div>
              </div>
            );
          })}
          <datalist id="ret-items">{consumableItems.map((it) => <option key={it.id} value={it.name} />)}</datalist>

          <button onClick={submit} disabled={!canSubmit}
            style={{ width: '100%', marginTop: 8, padding: '13px 0', background: canSubmit ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.7 }}>
            Log Return
          </button>
        </div>
      </div>
    );
  }

  // ── Detail ────────────────────────────────────────────────────────────────
  if (view === 'detail' && activeId) {
    const r = returns.find((x) => x.id === activeId);
    if (r) {
      const totalQty = sum(r.lines, 'qty');
      const reuseQty = sum(r.lines, 'reusableQty');
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
          <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
            <div>
              <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Return Detail</div>
              <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{r.id}</div>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 12, boxShadow: T.shadowSm }}>
              {[['Flight', r.flight], ['Sector', r.sector], ['Date', r.date], ['Returned By', r.returnedBy]].map(([l, v], i) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 8, borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                  <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1, background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{totalQty}</div>
                <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>Returned</div>
              </div>
              <div style={{ flex: 1, background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusLg, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>{reuseQty}</div>
                <div style={{ fontSize: 10, color: T.statusApproved, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>Reusable</div>
              </div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 2px 8px' }}>Items ({r.lines.length})</div>
            {r.lines.map((l, i) => (
              <div key={i} style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{l.itemName}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, fontFamily: T.fontBody }}>{l.qty} {l.uom || ''}</span>
                </div>
                <div style={{ fontSize: 11, color: (Number(l.reusableQty) || 0) > 0 ? T.statusApproved : T.textTertiary, fontFamily: T.fontBody, marginTop: 3 }}>
                  {(Number(l.reusableQty) || 0) > 0 ? `${l.reusableQty} reusable → credited to stock` : 'Not reusable'}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
  }

  // ── List ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Return Log</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{returns.length} consumable returns</div>
        </div>
        <button onClick={() => { resetForm(); setView('form'); }}
          style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.55)', borderRadius: T.radiusMd, height: 30, padding: '0 12px', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          + New
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
        {returns.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>↩️</div>
            <div style={{ fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody }}>No returns logged yet. Tap “+ New” to add one.</div>
          </div>
        ) : returns.map((r) => {
          const totalQty = sum(r.lines, 'qty');
          const reuseQty = sum(r.lines, 'reusableQty');
          const isNew = r.id === flashId;
          return (
            <div key={r.id} onClick={() => { setActiveId(r.id); setView('detail'); }}
              style={{ background: T.bgSurface, border: `1px solid ${isNew ? T.primary : T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ flex: 1, paddingRight: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{r.flight} <span style={{ color: T.textTertiary, fontWeight: 400 }}>· {r.sector}</span></div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{r.id} · {r.returnedBy} · {r.date}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.statusApproved, background: T.statusApprovedBg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>{reuseQty} reusable</span>
              </div>
              <div style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>{r.lines.length} item{r.lines.length === 1 ? '' : 's'} · {totalQty} returned</div>
              {isNew && <div style={{ fontSize: 10, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody, marginTop: 5 }}>✓ Return logged · synced to web</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
