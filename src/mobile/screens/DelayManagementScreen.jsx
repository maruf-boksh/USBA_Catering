import { useMemo, useState } from 'react';
import { T } from '../theme';
import { KPICard } from '../components/KPICard';
import { Combobox } from '../components/Combobox';
// Delay Management on the phone, on the WEB's own store — the same
// "harvest-data-v1:delay-events" list routes/delay-management.tsx persists, so a
// delay logged here is the same record the desk works, and vice versa.
//
//   list      loadDelayEvents() + isActiveDelayEvent(), the web's own reader
//   log       one event per delayed flight, exactly the shape the web writes
//             (Fulfillment Pending, batched, menu derived for the DELAYED
//             service date so a post-midnight departure takes the next day's menu)
//   detail    the web's fulfilment breakdown, approval log and stage timeline
import { loadDelayEvents, isActiveDelayEvent } from '@/routes/delay-management';
import { getFlightOrders } from '@/lib/flight-orders-store';
import { getPurchaseRequisitions, procurementStage, prReceived } from '@/lib/purchase-requisitions';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const LABEL = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };
const CARD = { background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm };
const SECTION = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 2px 8px' };

const DELAY_KEY = 'harvest-data-v1:delay-events';
const MENU_KEY  = 'harvest-data-v1:meal-planning-config';
// The two stores a fulfilment reference can point at, besides the requisitions:
// the Delay Refreshment approval queue and the production order workflow store.
const APPROVAL_KEY   = 'harvest-data-v1:delay-approval-records';
const PRODUCTION_KEY = 'harvest-data-v1:wf-production-entries';

// The web's own lists, so a delay logged on the phone reads identically.
const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Heavy Snacks'];
const DELAY_REASONS = [
  'ATC Hold — Congestion at destination',
  'ATC Hold — Slot delay issued',
  'Technical — Engine inspection required',
  'Technical — Avionics / hydraulics fault',
  'Technical — Late aircraft maintenance',
  'Weather — Adverse conditions at departure',
  'Weather — Destination airspace closed',
  'Ground delay — Late incoming aircraft',
  'Ground delay — Fueling delay',
  'Crew delay — Late crew positioning',
  'Passenger delay — Late boarding / offloading',
  'Cargo delay — Late cargo / baggage loading',
  'Security — Additional screening required',
  'Other',
];

// Status → mobile palette. Mirrors the web's delay badges.
const DSTATUS = {
  'Received':            { color: T.textTertiary,  bg: T.bgSubtle },
  'Validated':           { color: T.statusInfo,     bg: T.statusInfoBg },
  'Fulfillment Pending': { color: T.statusPending,  bg: T.statusPendingBg },
  'Approval Pending':    { color: T.statusPending,  bg: T.statusPendingBg },
  'Approved':            { color: T.statusApproved, bg: T.statusApprovedBg },
  'Rejected':            { color: T.statusRejected, bg: T.statusRejectedBg },
  'Sent To Production':  { color: T.statusBoarding, bg: T.statusBoardingBg },
  'Sent To Packaging':   { color: T.statusInfo,     bg: T.statusInfoBg },
  'Sent To Dispatch':    { color: T.statusApproved, bg: T.statusApprovedBg },
  'Dispatched':          { color: T.statusApproved, bg: T.statusApprovedBg },
  'Closed':              { color: T.textTertiary,   bg: T.bgSubtle },
};
const STATUS_KEYS = Object.keys(DSTATUS);

const num = (v) => Number(v) || 0;
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function readLS(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota — non-fatal */ }
}

/** "14:05" + 2h → "16:05" (wraps past midnight) — the web's own arithmetic. */
function addHoursToEtd(etd, hours) {
  const m = String(etd ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const total = parseInt(m[1]) * 60 + parseInt(m[2]) + Math.round(num(hours) * 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
/** 24-hour clock with the operating offset, as the web shows it. */
const to24Gmt6 = (hhmm) => (hhmm ? `${hhmm} GMT+6` : '—');

/**
 * The day a delayed flight actually departs: a 23:55 departure pushed 2 hours
 * leaves at 01:55 the NEXT day and is served that day's menu. Local date parts,
 * never toISOString() — the schedule is Dhaka-local.
 */
function delayedServiceDate(date, etd, hours) {
  const m = String(etd ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !(num(hours) > 0)) return date;
  const shift = Math.floor((parseInt(m[1]) * 60 + parseInt(m[2]) + Math.round(num(hours) * 60)) / (24 * 60));
  if (shift <= 0) return date;
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  d.setDate(d.getDate() + shift);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const durationMultiplier = (h) => (h <= 2 ? 1.0 : h <= 4 ? 1.2 : 1.5);

/** Fallback refreshment lines when the day has no menu card — the web's set. */
function defaultMenuItems(mealType, totalPax) {
  if (mealType === 'Breakfast') return [
    { name: 'Breakfast Box', requiredQty: totalPax, uom: 'pcs' },
    { name: 'Juice Box', requiredQty: totalPax, uom: 'pcs' },
    { name: 'Mineral Water 500ml', requiredQty: totalPax, uom: 'pcs' },
  ];
  if (mealType === 'Lunch' || mealType === 'Dinner') return [
    { name: 'Meal Box', requiredQty: totalPax, uom: 'pcs' },
    { name: 'Mineral Water 500ml', requiredQty: totalPax, uom: 'pcs' },
    { name: 'Juice Box', requiredQty: Math.ceil(totalPax * 0.5), uom: 'pcs' },
  ];
  if (mealType === 'Heavy Snacks') return [
    { name: 'Snack Pack', requiredQty: totalPax, uom: 'pcs' },
    { name: 'Mineral Water 500ml', requiredQty: totalPax, uom: 'pcs' },
    { name: 'Juice Box', requiredQty: Math.ceil(totalPax * 0.8), uom: 'pcs' },
  ];
  return [];
}

/** The day-wise Menu Planning card for the DELAYED service date, else defaults. */
function menuItemsFromPlan(mealType, serviceDate, totalPax, cards) {
  if (mealType === 'Heavy Snacks') return defaultMenuItems(mealType, totalPax);
  const dayName = new Date(`${serviceDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
  const card = (cards ?? []).find(
    (c) => String(c.mealType).toLowerCase() === mealType.toLowerCase() && c.day === dayName,
  );
  if (!card) return defaultMenuItems(mealType, totalPax);
  const seen = new Set();
  const items = [];
  (card.choices ?? []).forEach((ch) => (ch.items ?? []).forEach((it) => {
    if (seen.has(it.name)) return;
    seen.add(it.name);
    items.push({ name: it.name, requiredQty: totalPax, uom: 'portion' });
  }));
  return items.length > 0 ? items : defaultMenuItems(mealType, totalPax);
}

// ── Shared bits ─────────────────────────────────────────────────────────────
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

function Row({ label, value, strong }) {
  const v = String(value ?? '').trim();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '7px 0', borderTop: `1px solid ${T.border}` }}>
      <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: strong ? T.primary : T.textPrimary, fontFamily: T.fontBody, textAlign: 'right' }}>
        {v === '' ? '—' : v}
      </span>
    </div>
  );
}

/** A reference row — every document id on it opens that document. */
function RefRow({ label, ids, onOpen }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '7px 0', borderTop: `1px solid ${T.border}` }}>
      <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{label}</span>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
        {ids.length === 0 ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>—</span>
        ) : ids.map((id) => (
          <button key={id} onClick={(ev) => { ev.stopPropagation(); onOpen(id); }}
            style={{ background: T.primaryLight, border: `1px solid ${T.primary}55`, borderRadius: T.radiusMd, padding: '3px 9px', fontSize: 11.5, fontWeight: 700, color: T.primary, fontFamily: T.fontBody, cursor: 'pointer' }}>
            {id} ›
          </button>
        ))}
      </span>
    </div>
  );
}

export function DelayManagementScreen({ nav }) {
  const [events, setEvents] = useState(() => loadDelayEvents());
  const [view, setView]     = useState('list');   // 'list' | 'detail' | 'log' | 'ref'
  const [activeId, setActiveId] = useState(null);
  /** The fulfilment document opened from a Reference — { kind, id }. */
  const [refDoc, setRefDoc] = useState(null);
  const [query, setQuery]   = useState('');
  const [filter, setFilter] = useState('active');
  const [notice, setNotice] = useState('');
  const flash = (m) => { setNotice(m); setTimeout(() => setNotice(''), 2800); };

  const active = events.filter(isActiveDelayEvent);
  const awaiting = active.filter((e) => e.status === 'Fulfillment Pending').length;
  const inApproval = active.filter((e) => ['Approval Pending', 'Sent To Production'].includes(e.status)).length;
  const moving = active.filter((e) => ['Approved', 'Sent To Packaging', 'Sent To Dispatch'].includes(e.status)).length;
  const paxAffected = active.reduce((s, e) => s + num(e.paxCount), 0);

  const visible = events.filter((e) => {
    if (filter === 'active' ? !isActiveDelayEvent(e) : filter !== 'all' && e.status !== filter) return false;
    if (!query.trim()) return true;
    const hay = `${e.id} ${e.flightNumber} ${e.sector} ${e.flightDate} ${e.reason} ${e.mealType ?? ''}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });
  const sorted = [...visible].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

  const activeEvent = events.find((e) => e.id === activeId) ?? null;

  // ── Log Delay Event ───────────────────────────────────────────────────────
  const flightOrders = useMemo(() => getFlightOrders(), []);
  const dispatched = useMemo(
    () => flightOrders.filter((o) => o.status === 'Dispatched' && (o.orderType ?? 'flight') !== 'crew'),
    [flightOrders],
  );
  const menuCards = useMemo(() => readLS(MENU_KEY, []), []);

  const [picked, setPicked]   = useState([]);
  const [hoursBy, setHoursBy] = useState({});
  const [mealsBy, setMealsBy] = useState({});
  const [reasonBy, setReasonBy] = useState({});
  const [sameDelay, setSameDelay] = useState(false);
  const [reportedBy, setReportedBy] = useState('');
  const [touched, setTouched] = useState(false);

  const resetLog = () => {
    setPicked([]); setHoursBy({}); setMealsBy({}); setReasonBy({});
    setSameDelay(false); setReportedBy(''); setTouched(false);
  };

  const togglePick = (id) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** One delay for the whole submission — typing on any flight fills them all. */
  const setHoursFor = (id, v) =>
    setHoursBy((prev) => (sameDelay
      ? { ...prev, ...Object.fromEntries(picked.map((k) => [k, v])) }
      : { ...prev, [id]: v }));
  const toggleSameDelay = (on) => {
    setSameDelay(on);
    if (!on) return;
    const seed = hoursBy[picked[0]] ?? picked.map((k) => hoursBy[k]).find(Boolean) ?? '';
    setHoursBy((prev) => ({ ...prev, ...Object.fromEntries(picked.map((k) => [k, seed])) }));
  };
  const toggleMeal = (id, mt) =>
    setMealsBy((prev) => {
      const cur = prev[id] ?? [];
      return { ...prev, [id]: cur.includes(mt) ? cur.filter((x) => x !== mt) : [...cur, mt] };
    });

  const pickedOrders = dispatched.filter((o) => picked.includes(o.id));
  const canLog = pickedOrders.length > 0
    && pickedOrders.every((o) => num(hoursBy[o.id]) > 0 && (mealsBy[o.id] ?? []).length > 0 && reasonBy[o.id])
    && reportedBy.trim();

  /** Fan out ONE event per delayed flight — the record the web writes. */
  const submitLog = () => {
    setTouched(true);
    if (!canLog) return;
    const now = stamp();
    const batchId = `DBT-${Date.now().toString(36).slice(-6).toUpperCase()}`;
    const startNo = events.length + 1;
    const dfrNo = events.filter((e) => e.fulfillment).length + 1;
    const created = pickedOrders.map((o, k) => {
      const pax = num(o.pax);
      const crew = num(o.crew);
      const tp = pax + crew;
      const hrs = num(hoursBy[o.id]);
      const meals = mealsBy[o.id] ?? [];
      const mealLabel = meals.join(', ');
      const serviceDate = delayedServiceDate(o.date, o.etd, hrs);
      const items = meals.flatMap((m) => (tp > 0 ? menuItemsFromPlan(m, serviceDate, tp, menuCards) : []));
      const sq = Math.ceil(tp * durationMultiplier(hrs));
      return {
        id: `DEL-${String(startNo + k).padStart(4, '0')}`,
        flightOrderId: o.id,
        orderNo: o.orderNo,
        flightNumber: o.flight,
        flightDate: o.date,
        sector: o.sector,
        paxCount: pax,
        crewCount: crew,
        delayDurationHours: hrs,
        reason: reasonBy[o.id],
        reportedBy: reportedBy.trim(),
        status: 'Fulfillment Pending',
        createdAt: now,
        updatedAt: now,
        batchId,
        mealType: mealLabel,
        originalEtd: o.etd ?? undefined,
        menuItems: items,
        fulfillment: {
          id: `DFR-${String(dfrNo + k).padStart(4, '0')}`,
          itemType: mealLabel,
          suggestedQty: sq,
          finalQty: sq,
          fulfillmentType: 'Direct Receive',
          requestedBy: reportedBy.trim(),
          notes: '',
        },
      };
    });
    const next = [...created, ...events];
    setEvents(next);
    writeLS(DELAY_KEY, next);
    resetLog();
    setFilter('active');
    setView('list');
    flash(created.length === 1
      ? `${created[0].id} logged — Fulfillment Pending.`
      : `${created.length} delay events logged — all Fulfillment Pending.`);
  };

  // ── Log Delay Event ───────────────────────────────────────────────────────
  if (view === 'log') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { resetLog(); setView('list'); }} style={BTN_BACK}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Log Delay Event</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
              {picked.length} of {dispatched.length} flight{dispatched.length === 1 ? '' : 's'} selected
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          <div style={{ ...LABEL, margin: '0 2px 8px' }}>Dispatched Flights *</div>
          {dispatched.length === 0 ? (
            <Empty icon="✈️" text="No dispatched flight orders to log a delay against." />
          ) : dispatched.map((o) => {
            const on = picked.includes(o.id);
            const hrs = num(hoursBy[o.id]);
            const meals = mealsBy[o.id] ?? [];
            const missing = touched && on && (!(hrs > 0) || meals.length === 0 || !reasonBy[o.id]);
            return (
              <div key={o.id} style={{ ...CARD, border: `1px solid ${missing ? T.statusRejected : on ? T.primary : T.border}`, padding: 0, overflow: 'hidden' }}>
                <div onClick={() => togglePick(o.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer', background: on ? T.primaryLight : T.bgSurface }}>
                  <input type="checkbox" checked={on} onChange={() => togglePick(o.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 17, height: 17, accentColor: T.primary, cursor: 'pointer', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                      {o.flight}
                      <span style={{ fontSize: 11, fontWeight: 400, color: T.textTertiary, marginLeft: 6 }}>{o.sector}</span>
                    </div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                      {o.date}{o.etd ? ` · ETD ${o.etd}` : ''} · {num(o.pax)} pax · {num(o.crew)} crew
                    </div>
                  </div>
                </div>

                {on && (
                  <div style={{ padding: '10px 14px 12px', borderTop: `1px solid ${T.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ ...LABEL, marginBottom: 4 }}>Delay (hours) *</div>
                        <input type="number" inputMode="decimal" min="0" step="0.5"
                          value={hoursBy[o.id] ?? ''}
                          onChange={(e) => setHoursFor(o.id, e.target.value)}
                          placeholder="0"
                          style={{ ...INPUT, fontWeight: 700 }} />
                      </div>
                      <div style={{ flex: 1.2 }}>
                        <div style={{ ...LABEL, marginBottom: 4 }}>Revised Departure</div>
                        <div style={{ ...INPUT, background: T.bgSubtle, color: hrs > 0 ? T.primary : T.textTertiary, fontWeight: 700 }}>
                          {hrs > 0 && o.etd ? to24Gmt6(addHoursToEtd(o.etd, hrs)) : '—'}
                        </div>
                      </div>
                    </div>
                    {hrs > 0 && delayedServiceDate(o.date, o.etd, hrs) !== o.date && (
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.statusInfo, background: T.statusInfoBg, border: `1px solid ${T.statusInfo}25`, borderRadius: T.radiusMd, padding: '6px 9px', marginBottom: 10 }}>
                        Departs after midnight — served the {delayedServiceDate(o.date, o.etd, hrs)} menu.
                      </div>
                    )}

                    <div style={{ ...LABEL, marginBottom: 6 }}>Meal Type *</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {MEAL_TYPES.map((mt) => {
                        const sel = meals.includes(mt);
                        return (
                          <button key={mt} onClick={() => toggleMeal(o.id, mt)}
                            style={{ padding: '6px 12px', borderRadius: T.radiusFull, border: `1px solid ${sel ? T.primary : T.border}`, background: sel ? T.primary : T.bgSurface, color: sel ? '#fff' : T.textTertiary, fontSize: 11.5, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
                            {mt}
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ ...LABEL, marginBottom: 4 }}>Reason *</div>
                    <select value={reasonBy[o.id] ?? ''} onChange={(e) => setReasonBy((p) => ({ ...p, [o.id]: e.target.value }))}
                      style={{ ...INPUT, fontSize: 12 }}>
                      <option value="">Select a reason…</option>
                      {DELAY_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                )}
              </div>
            );
          })}

          {picked.length > 1 && (
            <div onClick={() => toggleSameDelay(!sameDelay)}
              style={{ display: 'flex', alignItems: 'center', gap: 9, background: T.bgSurface, border: `1px solid ${sameDelay ? T.primary : T.border}`, borderRadius: T.radiusLg, padding: '11px 14px', marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={sameDelay} onChange={() => toggleSameDelay(!sameDelay)}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 17, height: 17, accentColor: T.primary, cursor: 'pointer' }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Same Delay?</div>
                <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 1 }}>
                  One duration fills every selected flight.
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 4, marginBottom: 14 }}>
            <div style={LABEL}>Reported By *</div>
            <Combobox value={reportedBy} onChange={setReportedBy}
              options={['Flight Ops (DAC)', 'Duty Manager', 'Station Control', 'APT Executive', 'Catering Control']}
              placeholder="Name / desk" invalid={touched && !reportedBy.trim()} />
          </div>

          <button onClick={submitLog} disabled={!canLog}
            style={{ width: '100%', padding: '13px 0', background: canLog ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: canLog ? 'pointer' : 'not-allowed', opacity: canLog ? 1 : 0.7 }}>
            Log {picked.length > 0 ? `${picked.length} ` : ''}Delay Event{picked.length === 1 ? '' : 's'}
          </button>
          <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, textAlign: 'center', marginTop: 8 }}>
            Each flight is logged as its own delay event, Fulfillment Pending.
          </div>
        </div>
      </div>
    );
  }

  // ── Reference document ────────────────────────────────────────────────────
  // A fulfilment reference points at a real record in another module's store —
  // the requisition, the Delay Refreshment approval, or the production order.
  // Opening one reads THAT store, so what shows here is what the web shows.
  if (view === 'ref' && refDoc) {
    const backToDetail = () => { setRefDoc(null); setView('detail'); };
    let title = refDoc.id;
    let sub = 'Reference';
    let chip = null;
    let rows = [];
    let lines = [];

    if (refDoc.kind === 'purchase-requisition') {
      sub = 'Purchase Requisition';
      const pr = getPurchaseRequisitions().find((p) => p.id === refDoc.id);
      if (pr) {
        const stage = procurementStage(pr);
        const { ordered, received, pct } = prReceived(pr);
        chip = { label: stage, color: /approv|full/i.test(stage) ? T.statusApproved : /reject|cancel/i.test(stage) ? T.statusRejected : T.statusPending,
          bg: /approv|full/i.test(stage) ? T.statusApprovedBg : /reject|cancel/i.test(stage) ? T.statusRejectedBg : T.statusPendingBg };
        rows = [
          ['Requested By', pr.requestedBy], ['Raised', pr.date], ['Required By', pr.requiredBy],
          ['Priority', pr.priority], ['Value', `৳ ${num(pr.totalAmount).toLocaleString()}`],
          ['Received', `${received} / ${ordered} · ${pct}%`],
          ['Justification', pr.justification],
        ];
        lines = pr.lines.map((l) => ({ name: l.itemName, qty: `${l.qty} ${l.uom}`, note: num(l.receivedQty) > 0 ? `${num(l.receivedQty)} received` : '' }));
      }
    } else if (refDoc.kind === 'delay-approval') {
      sub = 'Delay Refreshment Approval';
      const a = readLS(APPROVAL_KEY, []).find((x) => x.id === refDoc.id);
      if (a) {
        chip = { label: a.status, color: a.status === 'Approved' ? T.statusApproved : a.status === 'Declined' ? T.statusRejected : T.statusPending,
          bg: a.status === 'Approved' ? T.statusApprovedBg : a.status === 'Declined' ? T.statusRejectedBg : T.statusPendingBg };
        rows = [
          ['Flight', `${a.flightNumber} · ${a.sector}`], ['Flight Date', a.flightDate],
          ['Delay', `${a.delayDurationHours}h`], ['PAX + Crew', num(a.paxCount) + num(a.crewCount)],
          ['Fulfilment Type', a.fulfillmentType],
          ['Submitted By', a.submittedBy], ['Submitted At', a.submittedAt],
          ['Processed By', a.processedBy], ['Processed At', a.processedAt],
          ['Total Cost', `৳ ${num(a.totalCost).toLocaleString()}`],
          ['Notes', a.notes], ['Decline Reason', a.declineReason],
        ];
        lines = (a.items ?? []).map((i) => ({ name: i.name, qty: `${i.qty} pcs`, note: num(i.unitCost) > 0 ? `৳ ${num(i.unitCost).toLocaleString()}/pcs` : '' }));
      }
    } else {
      sub = 'Production Order';
      const o = readLS(PRODUCTION_KEY, []).find((x) => x.id === refDoc.id);
      if (o) {
        const done = o.status === 'Completed' && !!o.qcPassedAt;
        chip = { label: o.status, color: done ? T.statusApproved : o.status === 'Pending' ? T.statusPending : T.statusBoarding,
          bg: done ? T.statusApprovedBg : o.status === 'Pending' ? T.statusPendingBg : T.statusBoardingBg };
        rows = [
          ['Item', o.outputItemName ?? o.bom], ['Item Code', o.outputItemCode],
          ['BOM', o.bom], ['Order Date', o.date],
          ['Order Qty', `${num(o.orderQty).toLocaleString()} portion`],
          ['Produced Qty', `${num(o.producedQty).toLocaleString()} portion`],
          ['QC Passed By', o.qcCheckedBy], ['QC Passed At', o.qcPassedAt],
        ];
      }
    }

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={backToDetail} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{title}</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{sub}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          {rows.length === 0 ? (
            <Empty icon="🔍" text={`${refDoc.id} is no longer in the ${sub} records.`} />
          ) : (
            <>
              <div style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{sub}</span>
                  {chip && <Chip label={chip.label} color={chip.color} bg={chip.bg} />}
                </div>
                {rows.filter(([, v]) => String(v ?? '').trim() !== '').map(([l, v]) => (
                  <Row key={l} label={l} value={v} />
                ))}
              </div>

              {lines.length > 0 && (
                <>
                  <div style={SECTION}>Items ({lines.length})</div>
                  <div style={CARD}>
                    {lines.map((l, i) => (
                      <div key={`${l.name}-${i}`} style={{ padding: '8px 0', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{l.name}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, whiteSpace: 'nowrap' }}>{l.qty}</span>
                        </div>
                        {l.note && <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{l.note}</div>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Detail ────────────────────────────────────────────────────────────────
  if (view === 'detail' && activeEvent) {
    const e = activeEvent;
    const s = DSTATUS[e.status] ?? DSTATUS.Received;
    const revised = e.originalEtd ? addHoursToEtd(e.originalEtd, e.delayDurationHours) : '';
    const refs = e.fulfilmentRefs ?? [];
    const bySource = ['Stock', 'Production', 'Instant Purchase']
      .map((src) => ({ src, group: refs.filter((r) => r.source === src) }))
      .filter((g) => g.group.length > 0);
    const STAGES = ['Received', 'Fulfillment Pending', 'Approval Pending', 'Approved', 'Sent To Packaging', 'Sent To Dispatch', 'Dispatched'];
    const at = STAGES.indexOf(e.status);
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{e.flightNumber} · {e.sector}</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{e.id} · {e.flightDate}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          <div style={CARD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                {e.delayDurationHours}h delay
              </span>
              <Chip label={e.status} color={s.color} bg={s.bg} />
            </div>
            <Row label="Scheduled Departure" value={to24Gmt6(e.originalEtd)} />
            <Row label="Delayed Departure" value={to24Gmt6(revised)} strong />
            <Row label="Meal Type" value={e.mealType} />
            <Row label="PAX / Crew" value={`${num(e.paxCount)} / ${num(e.crewCount)}`} />
            <Row label="Reason" value={e.reason} />
            <Row label="Reported By" value={e.reportedBy} />
            <Row label="Logged" value={e.createdAt} />
          </div>

          {/* Stage timeline */}
          <div style={SECTION}>Progress</div>
          <div style={CARD}>
            {STAGES.map((st, i) => {
              const done = at >= 0 && i < at;
              const here = at === i;
              return (
                <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                  <span style={{ width: 9, height: 9, borderRadius: T.radiusFull, flexShrink: 0,
                    background: here ? T.primary : done ? T.statusApproved : T.border }} />
                  <span style={{ flex: 1, fontSize: 12, fontFamily: T.fontBody, fontWeight: here ? 700 : 400,
                    color: here ? T.primary : done ? T.textPrimary : T.textTertiary }}>
                    {st}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Requirement */}
          {(e.menuItems ?? []).length > 0 && (
            <>
              <div style={SECTION}>Requirement ({e.menuItems.length})</div>
              <div style={CARD}>
                {e.menuItems.map((i, ix) => (
                  <Row key={`${i.name}-${ix}`} label={i.name} value={`${i.requiredQty} ${i.uom}`} />
                ))}
              </div>
            </>
          )}

          {/* Fulfilment breakdown — where each item was routed, and against what */}
          {bySource.length > 0 && (
            <>
              <div style={SECTION}>Fulfilment Breakdown</div>
              {bySource.map(({ src, group }) => (
                <div key={src} style={CARD}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                      Fulfill from {src}
                    </span>
                    <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                      {group.reduce((n, r) => n + (r.items?.length ?? 0), 0)} item(s)
                    </span>
                  </div>
                  {group.map((r, gi) => (
                    <div key={`${r.ref}-${gi}`}>
                      <RefRow
                        label="Reference"
                        ids={String(r.ref ?? '').split(',').map((x) => x.trim()).filter(Boolean)}
                        onOpen={(id) => { setRefDoc({ kind: r.refKind, id }); setView('ref'); }}
                      />
                      <Row label="Routed" value={r.at} />
                      {(r.items ?? []).map((i, ii) => (
                        <Row key={`${i.name}-${ii}`} label={i.name} value={`${i.qty} ${i.uom}`} />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}

          {refs.length === 0 && e.status === 'Fulfillment Pending' && (
            <div style={{ background: T.statusPendingBg, border: `1px solid ${T.statusPending}30`, borderRadius: T.radiusMd, padding: '10px 14px', marginTop: 10, fontSize: 12, color: T.statusPending, fontFamily: T.fontBody }}>
              Not routed yet — fulfilment (stock, production or instant purchase) is raised on the web Delay Management screen.
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
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Delay Management</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
            {active.length} active · {paxAffected} pax affected
          </div>
        </div>
        <button onClick={() => { resetLog(); setView('log'); }}
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
          <KPICard label="Active Delays"  value={active.length} sub={`${paxAffected} pax affected`} accent={T.statusDelayed} />
          <KPICard label="Awaiting Fulfilment" value={awaiting} sub="Not routed yet"   accent={T.statusPending} />
          <KPICard label="In Approval / Production" value={inApproval} sub="Being sourced" accent={T.statusBoarding} />
          <KPICard label="Packaging / Dispatch" value={moving} sub="On the way"        accent={T.statusApproved} />
        </div>

        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search flight, sector, reason…" style={{ ...INPUT, marginTop: 12 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 0' }}>
          <button onClick={() => setFilter('active')}
            style={{ flexShrink: 0, padding: '8px 14px', borderRadius: T.radiusFull, border: `1px solid ${filter === 'active' ? T.primary : T.border}`, background: filter === 'active' ? T.primary : T.bgSurface, color: filter === 'active' ? '#fff' : T.textTertiary, fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
            Active
          </button>
          <select value={filter} onChange={(ev) => setFilter(ev.target.value)}
            style={{ ...INPUT, flex: 1, minWidth: 0, padding: '9px 10px', fontSize: 12, fontWeight: 700 }}>
            <option value="active">Active only</option>
            <option value="all">All statuses</option>
            {STATUS_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div style={{ ...SECTION, marginTop: 12 }}>
          {sorted.length} delay event{sorted.length === 1 ? '' : 's'}
        </div>

        {sorted.length === 0 ? (
          <Empty icon="⏱️" text={events.length === 0 ? 'No delay events logged yet. Tap “+ Log” to raise one.' : 'No delay events match the current filter.'} />
        ) : sorted.map((e) => {
          const s = DSTATUS[e.status] ?? DSTATUS.Received;
          const revised = e.originalEtd ? addHoursToEtd(e.originalEtd, e.delayDurationHours) : '';
          const legs = (e.fulfilmentRefs ?? []).map((r) => r.source);
          return (
            <div key={e.id} onClick={() => { setActiveId(e.id); setView('detail'); }} style={{ ...CARD, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div style={{ flex: 1, paddingRight: 8, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                    {e.flightNumber}
                    <span style={{ fontSize: 11, fontWeight: 400, color: T.textTertiary, marginLeft: 6 }}>{e.sector}</span>
                  </div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                    {e.id} · {e.flightDate}{e.mealType ? ` · ${e.mealType}` : ''}
                  </div>
                </div>
                <Chip label={e.status} color={s.color} bg={s.bg} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.statusDelayedBg, border: `1px solid ${T.statusDelayed}25`, borderRadius: T.radiusMd, padding: '6px 9px', margin: '4px 0 8px' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: T.statusDelayed, fontFamily: T.fontBody }}>
                  +{e.delayDurationHours}h
                </span>
                <span style={{ fontSize: 11, color: T.statusDelayed, fontFamily: T.fontBody, opacity: 0.9 }}>
                  {to24Gmt6(e.originalEtd)} → {to24Gmt6(revised)}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 12, marginBottom: legs.length ? 8 : 0 }}>
                {[['PAX', num(e.paxCount)], ['Crew', num(e.crewCount)], ['Items', (e.menuItems ?? []).length]].map(([l, v]) => (
                  <span key={l} style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                    {l} <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary }}>{v}</span>
                  </span>
                ))}
              </div>

              {legs.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                  {[...new Set(legs)].map((src) => (
                    <Chip key={src} label={src} color={T.statusInfo} bg={T.statusInfoBg} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
