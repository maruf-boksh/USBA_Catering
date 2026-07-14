import { useState, useMemo } from 'react';
import { T } from '../theme';
import { MOCK_RETURNS } from '../mockData';
import { consumableItems, consumableUsage } from '@/lib/sample-data';
import { getAuthUser } from '@/lib/auth';
import { Combobox } from '../components/Combobox';

const RETURNS_KEY = 'harvest-data-v1:consumable-returns';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

// Flight schedule — mirrors the web Consumable Returns screen so mobile returns
// slot into the same scheduled-time → flight → issued-items flow.
const FLIGHT_SCHEDULES = [
  { time: '06:30', flight: 'BG-401', sector: 'DAC→DXB' },
  { time: '06:30', flight: 'BS-141', sector: 'DAC→CGP' },
  { time: '08:45', flight: 'BS-105', sector: 'DAC→CXB' },
  { time: '10:15', flight: 'BG-522', sector: 'DAC→LHR' },
  { time: '14:00', flight: 'VQ-901', sector: 'DAC→KUL' },
];
const SCHEDULE_TIMES = [...new Set(FLIGHT_SCHEDULES.map((f) => f.time))].sort();

// Items ISSUED to a flight — the return-line options (you return against what
// was issued). Same source as the web form (consumableUsage).
function issuedForFlight(flight) {
  if (!flight) return [];
  return consumableUsage
    .filter((u) => u.flight === flight)
    .map((u) => {
      const inv = consumableItems.find((it) => it.id === u.itemId);
      return { itemId: u.itemId, name: inv?.name ?? u.itemName, issuedQty: u.qty, uom: inv?.uom ?? u.uom ?? 'Pcs' };
    });
}
const issuedLabel = (o) => `${o.name} · issued ${o.issuedQty} ${o.uom}`;

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
function initialReturns() {
  const web = loadWebReturns();
  return web.length > 0 ? web : MOCK_RETURNS;
}

// Reusable qty per line — supports both the web boolean model (reusable=true →
// whole qty is reusable) and the older mock model (numeric reusableQty).
const reuseQtyOf = (l) => (l.reusable === true ? (Number(l.qty) || 0) : (Number(l.reusableQty) || 0));
const sumQty   = (lines) => lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
const sumReuse = (lines) => lines.reduce((s, l) => s + reuseQtyOf(l), 0);

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const blankLine = () => ({ id: `L${Date.now()}${Math.round(performance.now())}`, itemLabel: '', itemId: '', itemName: '', issuedQty: '', uom: 'Pcs', qty: '', reusable: false, justification: '' });

export function ReturnLogScreen({ nav }) {
  const [returns, setReturns]   = useState(() => initialReturns());
  const [view, setView]         = useState('list');   // 'list' | 'form' | 'detail'
  const [activeId, setActiveId] = useState(null);
  const [flashId, setFlashId]   = useState(null);

  // Form state — mirrors the web "Log Consumable Return" layout.
  const [scheduledTime, setScheduledTime] = useState('');
  const [flight, setFlight] = useState('');
  const [lines, setLines]   = useState([blankLine()]);
  const [touched, setTouched] = useState(false);

  const returnId = useMemo(() => `CR-${String(7000 + returns.length + 1).padStart(4, '0')}`, [returns.length]);
  const sector   = FLIGHT_SCHEDULES.find((f) => f.flight === flight)?.sector ?? '';
  const flightsAtTime = FLIGHT_SCHEDULES.filter((f) => f.time === scheduledTime).map((f) => f.flight);
  const issued        = useMemo(() => issuedForFlight(flight), [flight]);
  const issuedLabels  = issued.map(issuedLabel);

  const validLines = lines.filter((l) => l.itemName.trim() && (parseFloat(l.qty) || 0) > 0);
  const justificationOk = validLines.every((l) => l.reusable || l.justification.trim());
  const canSubmit  = scheduledTime && flight && validLines.length > 0 && justificationOk;

  const resetForm = () => { setScheduledTime(''); setFlight(''); setLines([blankLine()]); setTouched(false); };
  const setLine    = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine    = () => setLines((prev) => [...prev, blankLine()]);
  const removeLine = (id) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const onTimePick = (val) => { setScheduledTime(val); setFlight(''); setLines([blankLine()]); };

  // Selecting a flight auto-populates one line per issued item (like the web).
  const onFlightPick = (val) => {
    setFlight(val);
    const opts = issuedForFlight(val);
    setLines(
      opts.length > 0
        ? opts.map((o) => ({ ...blankLine(), id: `L${o.itemId}${Math.round(performance.now())}`, itemLabel: issuedLabel(o), itemId: o.itemId, itemName: o.name, issuedQty: o.issuedQty, uom: o.uom }))
        : [blankLine()],
    );
  };

  const onItemPick = (id, label) => {
    const o = issued.find((x) => issuedLabel(x) === label);
    if (o) setLine(id, { itemLabel: label, itemId: o.itemId, itemName: o.name, issuedQty: o.issuedQty, uom: o.uom });
    else setLine(id, { itemLabel: label, itemName: label, itemId: '', issuedQty: '', uom: 'Pcs' });
  };

  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    const returnedBy = getAuthUser()?.name ?? 'Cabin Crew';
    const rec = {
      id: returnId, date: todayStr(), scheduledTime, flight, sector: sector || '—',
      returnedBy, savedAt: new Date().toISOString(), forwardToAirportStore: true,
      lines: validLines.map((l) => ({
        itemId: l.itemId || `MP-${l.itemName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
        itemName: l.itemName.trim(),
        qty: parseFloat(l.qty) || 0,
        issuedQty: l.issuedQty === '' ? undefined : Number(l.issuedQty),
        uom: l.uom || 'Pcs',
        reusable: !!l.reusable,
        nonReusableReason: l.reusable ? undefined : l.justification.trim(),
        lineType: 'item',
      })),
    };
    setReturns((prev) => [rec, ...prev]);
    persistWebReturns([rec, ...loadWebReturns()]);
    setFlashId(rec.id);
    resetForm();
    setView('list');
    setTimeout(() => setFlashId(null), 2400);
  };

  // ── Form view ─────────────────────────────────────────────────────────────
  if (view === 'form') {
    const LABEL    = { fontSize: 10.5, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
    const INPUT    = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '9px 11px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };
    const READONLY = { ...INPUT, background: T.bgSubtle, color: T.textSecondary };

    const Pill = ({ active, onClick, children }) => (
      <button type="button" onClick={onClick}
        style={{ flex: 1, padding: '7px 0', borderRadius: T.radiusMd, border: `1px solid ${active ? T.primary : T.border}`, background: active ? 'rgba(225,1,1,0.10)' : T.bgSurface, color: active ? T.primary : T.textSecondary, fontSize: 12.5, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
        {children}
      </button>
    );

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { resetForm(); setView('list'); }} style={BTN_BACK}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Log Consumable Return</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Return against issued items · syncs to web</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* Return ID + Date (auto) */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Return ID</div>
              <input value={returnId} readOnly style={READONLY} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Date</div>
              <input value={todayStr()} readOnly style={READONLY} />
            </div>
          </div>

          {/* Scheduled time + Flight */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Scheduled Time *</div>
              <Combobox value={scheduledTime} onChange={onTimePick} options={SCHEDULE_TIMES}
                placeholder="Select time" invalid={touched && !scheduledTime} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Flight *</div>
              <Combobox value={flight} onChange={onFlightPick} options={flightsAtTime}
                placeholder={scheduledTime ? 'Select flight' : 'Pick time first'} disabled={!scheduledTime}
                invalid={touched && !flight} />
            </div>
          </div>
          {flight && <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, margin: '2px 2px 0' }}>Sector {sector} · {issued.length} item{issued.length === 1 ? '' : 's'} issued</div>}

          {/* Items returned */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 2px 8px' }}>
            <div style={{ ...LABEL, marginBottom: 0 }}>Items Returned *</div>
            <button onClick={addLine} style={{ background: 'none', border: `1px solid ${T.primary}`, color: T.primary, borderRadius: T.radiusMd, padding: '4px 11px', fontSize: 11, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>+ Add new</button>
          </div>

          {lines.map((l, idx) => {
            const hasQty  = (parseFloat(l.qty) || 0) > 0;
            const needJust = touched && hasQty && !l.reusable && !l.justification.trim();
            const missing  = touched && (l.itemName.trim() || l.qty) && !(l.itemName.trim() && hasQty);
            return (
              <div key={l.id} style={{ background: T.bgSurface, border: `1px solid ${missing || needJust ? T.statusRejected : T.border}`, borderRadius: T.radiusLg, padding: '11px 12px', marginBottom: 9, boxShadow: T.shadowSm }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.05em', background: T.bgSubtle, padding: '2px 7px', borderRadius: T.radiusSm }}>Item {idx + 1}</span>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(l.id)} style={{ background: 'none', border: 'none', color: T.textTertiary, fontSize: 17, cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
                  )}
                </div>

                <div style={LABEL}>Item *</div>
                <Combobox value={l.itemLabel} onChange={(v) => onItemPick(l.id, v)} options={issuedLabels}
                  placeholder={flight ? 'Select issued item' : 'Pick a flight first'} disabled={!flight}
                  containerStyle={{ marginBottom: 9 }} />

                <div style={{ display: 'flex', gap: 8, marginBottom: 9 }}>
                  <div style={{ flex: 1 }}>
                    <div style={LABEL}>Issued Qty</div>
                    <input value={l.issuedQty === '' ? '—' : `${l.issuedQty} ${l.uom}`} readOnly style={READONLY} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={LABEL}>Return Qty *</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="number" inputMode="decimal" min="0" value={l.qty}
                        onChange={(e) => setLine(l.id, { qty: e.target.value })}
                        placeholder="0" style={{ ...INPUT, fontWeight: 700 }} />
                      <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, flexShrink: 0 }}>{l.uom}</span>
                    </div>
                  </div>
                </div>

                <div style={LABEL}>Reusable</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: l.reusable ? 0 : 8 }}>
                  <Pill active={l.reusable === true}  onClick={() => setLine(l.id, { reusable: true, justification: '' })}>Yes</Pill>
                  <Pill active={l.reusable === false} onClick={() => setLine(l.id, { reusable: false })}>No</Pill>
                </div>
                {!l.reusable && (
                  <input value={l.justification} onChange={(e) => setLine(l.id, { justification: e.target.value })}
                    placeholder="Justification (required)"
                    style={{ ...INPUT, border: `1px solid ${needJust ? T.statusRejected : T.border}` }} />
                )}
              </div>
            );
          })}

          <button onClick={submit} disabled={!canSubmit}
            style={{ width: '100%', marginTop: 8, padding: '13px 0', background: canSubmit ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.7 }}>
            Log Return
          </button>
          <div style={{ height: 8 }} />
        </div>
      </div>
    );
  }

  // ── Detail ────────────────────────────────────────────────────────────────
  if (view === 'detail' && activeId) {
    const r = returns.find((x) => x.id === activeId);
    if (r) {
      const totalQty = sumQty(r.lines);
      const reuseQty = sumReuse(r.lines);
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
              {[['Flight', r.flight], ['Sector', r.sector], ['Scheduled', r.scheduledTime || '—'], ['Date', r.date], ['Returned By', r.returnedBy]].map(([l, v], i) => (
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
            {r.lines.map((l, i) => {
              const isReusable = l.reusable === true || (Number(l.reusableQty) || 0) > 0;
              return (
                <div key={i} style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, paddingRight: 8 }}>{l.itemName}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, fontFamily: T.fontBody, flexShrink: 0 }}>{l.qty} {l.uom || ''}{l.issuedQty != null ? ` / ${l.issuedQty}` : ''}</span>
                  </div>
                  <div style={{ fontSize: 11, color: isReusable ? T.statusApproved : T.textTertiary, fontFamily: T.fontBody, marginTop: 3 }}>
                    {isReusable ? 'Reusable → credited to stock' : `Not reusable${l.nonReusableReason ? ` · ${l.nonReusableReason}` : ''}`}
                  </div>
                </div>
              );
            })}
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
          const totalQty = sumQty(r.lines);
          const reuseQty = sumReuse(r.lines);
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
