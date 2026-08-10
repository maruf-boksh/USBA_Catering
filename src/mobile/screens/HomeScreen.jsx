import { useState, useEffect } from 'react';
import { T } from '../theme';
import { MOCK_PRODUCTION_ORDERS, MOCK_QC_CHECKS, MOCK_DISPATCHES, MOCK_APPROVALS, MOCK_INVENTORY_ALERTS } from '../mockData';
import { loadMobileFlights, loadMobileActiveOrders } from '../../lib/flight-orders-store';
import { getAuthUser } from '@/lib/auth';
// Same sector test the web dashboard splits its KPI breakdowns on.
import { isDomesticSector } from '@/lib/sample-data';
// Same source the web dashboard's "Delayed Flights" KPI reads (index.tsx) — the
// live Delay Management store — so phone and desk always show the same number.
import { loadDelayEvents, isActiveDelayEvent } from '@/routes/delay-management';

// Time-of-day greeting (matches the web dashboard's greeting logic).
function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The stamp's parts — "Thursday", "06 August 2026", "10:01 AM".
 *
 * Assembled piece by piece rather than from one toLocaleDateString call for two
 * reasons: locale data disagrees about whether a comma follows the weekday, and
 * the three parts are typeset differently — the day of the week is the thing an
 * ops user scans for, the year is the thing they never read.
 */
function stampParts(d) {
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
    date: `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleDateString('en-US', { month: 'long' })} ${d.getFullYear()}`,
    time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
  };
}

/**
 * The current time, re-rendered exactly on the minute.
 *
 * A one-second interval would re-render the whole dashboard sixty times a minute
 * to change nothing — the display has no seconds — so the first tick is aligned
 * to the next minute boundary and it settles into a 60s beat after that.
 */
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval;
    const align = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => { clearTimeout(align); if (interval) clearInterval(interval); };
  }, []);
  return now;
}

// Two-letter initials from a name (e.g. "Ikramul Haque Khan" → "IK").
function nameInitials(name) {
  const parts = String(name || '').replace(/[.]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Live flights from the web Order Management store (replaces the old MOCK_FLIGHTS).
const FLIGHTS = loadMobileFlights();
// Active Orders (Flight / Crew) — same live data + grouping the web dashboard's
// "Active Orders" panel uses, projected into the mobile card shape.
const ACTIVE_ORDERS = loadMobileActiveOrders();

// Order-lifecycle status → mobile pill palette (mirrors the web Active-Orders pill:
// Production → amber, Dispatched → blue, Approved → green, Pending → neutral).
const AO_STATUS_STYLE = {
  Production: { color: T.statusDelayed,   bg: T.statusDelayedBg   },
  Approved:   { color: T.statusApproved,  bg: T.statusApprovedBg  },
  Dispatched: { color: T.statusScheduled, bg: T.statusScheduledBg },
  Pending:    { color: T.statusDraft,     bg: T.statusDraftBg     },
  Completed:  { color: T.statusDeparted,  bg: T.statusDepartedBg  },
};
const aoStatus = (s) => AO_STATUS_STYLE[s] || AO_STATUS_STYLE.Pending;

const MAX_LEGS_PER_CARD = 3;

function OrderGroupCard({ group, mode, onOpen }) {
  const st = aoStatus(group.status);
  const shown = group.legs.slice(0, MAX_LEGS_PER_CARD);
  const hidden = group.legs.length - shown.length;
  const total = mode === 'crew' ? group.totalCrew : group.totalPax;
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radiusLg, overflow: 'hidden', marginTop: 10, background: T.bgSurface }}>
      {/* group header */}
      <div onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: T.bgSubtle, borderBottom: `1px solid ${T.border}`, cursor: 'pointer' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.primary, fontFamily: T.fontBody }}>{group.orderNo}</span>
        {group.legs.length > 1 && (
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', color: T.statusDelayed, background: T.statusDelayedBg, padding: '2px 6px', borderRadius: T.radiusSm, textTransform: 'uppercase', fontFamily: T.fontBody }}>
            {group.legs.length} flights
          </span>
        )}
        <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>· <span style={{ color: T.textPrimary, fontWeight: 600 }}>{total}</span> {mode === 'crew' ? 'crew' : 'pax'}</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: st.color, background: st.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{group.status}</span>
      </div>
      {/* legs */}
      {shown.map((l, idx) => (
        <div key={l.id} onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderTop: idx > 0 ? `1px solid ${T.border}` : 'none', cursor: 'pointer' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#2a2528', borderRadius: T.radiusSm, padding: '3px 7px', fontFamily: T.fontBody, flexShrink: 0 }}>{l.flight.slice(-3)}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: T.textPrimary, fontFamily: T.fontBody, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {l.flight} <span style={{ color: T.textTertiary }}>· {l.route}</span>
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, fontFamily: T.fontBody, flexShrink: 0 }}>{l.etd}</span>
          <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, width: 34, textAlign: 'right', flexShrink: 0 }}>{mode === 'crew' ? `${l.crew}c` : `${l.pax}p`}</span>
        </div>
      ))}
      {hidden > 0 && (
        <div onClick={onOpen} style={{ padding: '8px 12px', borderTop: `1px solid ${T.border}`, textAlign: 'center', fontSize: 11, fontWeight: 700, color: T.primary, background: T.bgSubtle, cursor: 'pointer', fontFamily: T.fontBody }}>
          + {hidden} more flight{hidden === 1 ? '' : 's'} →
        </div>
      )}
    </div>
  );
}

function ActiveOrdersCard({ nav }) {
  const [tab, setTab] = useState('flight');
  const groups = ACTIVE_ORDERS[tab] || [];
  return (
    <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 14, boxShadow: T.shadowSm, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Active Orders</span>
        <ViewAllButton onPress={() => nav.navigate('orders')} />
      </div>
      {/* tabs */}
      <div style={{ display: 'flex', gap: 18, borderBottom: `1px solid ${T.border}`, marginBottom: 2 }}>
        {[['flight', 'Flight Orders'], ['crew', 'Crew Orders']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ position: 'relative', padding: '8px 0', fontSize: 12.5, fontWeight: 700, color: tab === key ? T.textPrimary : T.textTertiary, background: 'none', border: 'none', cursor: 'pointer', fontFamily: T.fontBody }}>
            {label}
            {tab === key && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2.5, borderRadius: 99, background: T.primary }} />}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>No active {tab} orders.</div>
      ) : (
        groups.map((g) => <OrderGroupCard key={`${tab}-${g.orderNo}`} group={g} mode={tab} onOpen={() => nav.navigate('orders')} />)
      )}
    </div>
  );
}

// ── Computed KPIs — derived from mock data so values stay in sync ──────────────
const totalFlights     = FLIGHTS.length;
const totalMeals       = FLIGHTS.reduce((s, f) => s + f.meals, 0);
// Delayed Flights — active Delay Management events, exactly like the web KPI
// (NOT flight-order statuses, which is a different signal and used to disagree).
const ACTIVE_DELAYS    = loadDelayEvents().filter(isActiveDelayEvent);
const delayedFlights   = ACTIVE_DELAYS.length;
const delayedPax       = ACTIVE_DELAYS.reduce((s, e) => s + e.paxCount, 0);
const onTimeRate       = totalFlights > 0 ? Math.max(0, Math.round(((totalFlights - delayedFlights) / totalFlights) * 100)) : 100;
const qcOpenIssues     = MOCK_QC_CHECKS.filter(c => c.result === 'open').length;
const qcResolvedToday  = MOCK_QC_CHECKS.filter(c => c.result === 'pass').length;
const pendingApprovals = MOCK_APPROVALS.filter(a => a.status === 'pending').length;
const activeDispatches = MOCK_DISPATCHES.filter(d => d.status !== 'pending').length;
const inventoryAlerts  = MOCK_INVENTORY_ALERTS.length;

// ── At-a-glance breakdowns shown inside each KPI card ─────────────────────────
// Same splits the web dashboard puts on its cards (routes/index.tsx), computed
// from the same live data the mobile KPI values already read.

// Legs leaving DAC are Outbound — the rule the web uses for its delay split.
const isOutboundSector = (sector) => String(sector || '').trim().startsWith('DAC');

// Flights by direction × domestic/international.
const flightDirSplit = (outbound) => {
  const rows = FLIGHTS.filter((f) => isOutboundSector(f.route) === outbound);
  const dom = rows.filter((f) => f.sector === 'Domestic').length;
  return { total: rows.length, dom, intl: rows.length - dom };
};
const fOut = flightDirSplit(true);
const fRet = flightDirSplit(false);

// Delayed flights by direction × domestic/international.
const delayDirSplit = (outbound) => {
  const rows = ACTIVE_DELAYS.filter((e) => isOutboundSector(e.sector) === outbound);
  const dom = rows.filter((e) => isDomesticSector(e.sector)).length;
  return { total: rows.length, dom, intl: rows.length - dom };
};
const dOut = delayDirSplit(true);
const dRet = delayDirSplit(false);

const mealsPrepared = MOCK_PRODUCTION_ORDERS.reduce((s, o) => s + o.produced, 0);
const mealsPending  = Math.max(0, totalMeals - mealsPrepared);
const onTimeFlights = Math.max(0, totalFlights - delayedFlights);

const dispatchLoading   = MOCK_DISPATCHES.filter(d => d.status === 'loading').length;
const dispatchDone      = MOCK_DISPATCHES.filter(d => d.status === 'dispatched').length;
const dispatchPending   = MOCK_DISPATCHES.filter(d => d.status === 'pending').length;

// Critical = a quarter or less of the reorder point still on hand; the rest of
// the alerts are simply low.
const invCritical = MOCK_INVENTORY_ALERTS.filter(i => i.current <= i.reorderPoint * 0.25).length;
const invLow      = inventoryAlerts - invCritical;

// One hue per card, following the web dashboard's assignment (flights violet,
// meals green, delays amber, QC brand, dispatch indigo) so a metric keeps its
// colour between the desk and the phone. Every value is a theme token, so the
// set re-brands with the colour preset and holds up on the dark theme.
const KPI_ROWS = [
  { label: 'Total Flights',     value: totalFlights,                     sub: 'Today',                              accent: T.statusBoarding, icon: '✈️', route: 'orders',
    breakdown: [
      { label: 'Outbound', value: fOut.total, icon: '🛫', children: [
        { label: 'Domestic',      value: fOut.dom,  icon: '🏠' },
        { label: 'International', value: fOut.intl, icon: '🌍' },
      ] },
      { label: 'Return', value: fRet.total, icon: '🛬', children: [
        { label: 'Domestic',      value: fRet.dom,  icon: '🏠' },
        { label: 'International', value: fRet.intl, icon: '🌍' },
      ] },
    ] },
  { label: 'Total Meals',       value: totalMeals,                       sub: 'Scheduled',                          accent: T.statusApproved, icon: '🍽️', route: 'meal-planning',
    breakdown: [
      { label: 'Target (24h)', value: totalMeals,    icon: '🎯' },
      { label: 'Prepared',     value: mealsPrepared, icon: '🍳' },
      { label: 'Pending',      value: mealsPending,  icon: '⏳' },
    ] },
  { label: 'Delayed Flights',   value: delayedFlights,                   sub: `${delayedPax} pax affected`,         accent: T.statusDelayed,  icon: '⚠️', route: 'delay-management',
    breakdown: [
      { label: 'Outbound', value: dOut.total, icon: '🛫', children: [
        { label: 'Domestic',      value: dOut.dom,  icon: '🏠' },
        { label: 'International', value: dOut.intl, icon: '🌍' },
      ] },
      { label: 'Return', value: dRet.total, icon: '🛬', children: [
        { label: 'Domestic',      value: dRet.dom,  icon: '🏠' },
        { label: 'International', value: dRet.intl, icon: '🌍' },
      ] },
    ] },
  { label: 'On-Time Rate',      value: `${onTimeRate}%`,                 sub: 'Departures',                         accent: T.statusInfo,     icon: '⏱️', route: 'orders',
    breakdown: [
      { label: 'On Time',  value: onTimeFlights,  icon: '✅' },
      { label: 'Delayed',  value: delayedFlights, icon: '⏱️' },
      { label: 'Flights',  value: totalFlights,   icon: '✈️' },
    ] },
  { label: 'QC Open Issues',    value: qcOpenIssues,                     sub: `${qcResolvedToday} resolved today`,  accent: T.primary,        icon: '🛡️', route: 'qc',
    breakdown: [
      { label: 'Cooking Temp',     value: qcOpenIssues, icon: '🌡️' },
      { label: 'Re-cook',          value: 0,            icon: '🔁' },
      { label: 'Daily Hygiene',    value: 0,            icon: '🧹' },
      { label: 'Personal Hygiene', value: 0,            icon: '🧼' },
    ] },
  // Pending Approvals is not a tile here — it leads the page as its own card.
  { label: 'Active Dispatches', value: activeDispatches,                 sub: 'In progress',                        accent: T.statusProgress, icon: '🚛', route: 'dispatch-mon',
    breakdown: [
      { label: 'Loading',    value: dispatchLoading, icon: '📦' },
      { label: 'Dispatched', value: dispatchDone,    icon: '✅' },
      { label: 'Pending',    value: dispatchPending, icon: '⏳' },
    ] },
  { label: 'Inventory Alerts',  value: inventoryAlerts,                  sub: 'Low stock items',                    accent: T.statusScheduled, icon: '📦', route: 'stock',
    breakdown: [
      { label: 'Low',      value: invLow,      icon: '📉' },
      { label: 'Critical', value: invCritical, icon: '🔴' },
    ] },
];

// Pipeline step data derived from mock data
const ordersConfirmed  = FLIGHTS.length;
const productionActive = MOCK_PRODUCTION_ORDERS.filter(o => o.status === 'in-progress').length;
const qcPass           = MOCK_QC_CHECKS.filter(c => c.result === 'pass').length;
const qcTotal          = MOCK_QC_CHECKS.length;
const qcRate           = qcTotal > 0 ? Math.round((qcPass / qcTotal) * 100) : 0;
const dispatchActive   = MOCK_DISPATCHES.filter(d => d.status !== 'pending').length;

const PIPELINE = [
  {
    key:    'orders',
    icon:   '📋',
    label:  'Orders',
    value:  `${ordersConfirmed}`,
    sub:    'flights',
    color:  T.statusInfo,
    bg:     T.statusInfoBg,
  },
  {
    key:    'production',
    icon:   '🍳',
    label:  'Production',
    value:  `${productionActive}`,
    sub:    'active',
    color:  T.statusPending,
    bg:     T.statusPendingBg,
  },
  {
    key:    'qc',
    icon:   '✅',
    label:  'QC',
    value:  `${qcRate}%`,
    sub:    'pass rate',
    color:  T.statusApproved,
    bg:     T.statusApprovedBg,
  },
  {
    key:    'dispatch-mon',
    icon:   '🚛',
    label:  'Dispatch',
    value:  `${dispatchActive}`,
    sub:    'active',
    color:  T.statusBoarding,
    bg:     T.statusBoardingBg,
  },
];

// "View all →" link with a real touch target: the visible text stays small,
// but padding + negative margin grow the hit area to ~44px class without
// shifting layout. At small window sizes the phone frame is transform-scaled,
// so a text-sized button shrinks to ~13px tall — near-misses land on the inert
// header row and the tap "does nothing".
function ViewAllButton({ onPress, children = 'View all →' }) {
  return (
    <button
      onClick={onPress}
      style={{
        background: 'none', border: 'none', color: T.primary,
        fontSize: 12, fontWeight: 600, fontFamily: T.fontBody,
        cursor: 'pointer', padding: '10px 12px', margin: '-10px -12px',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {children}
    </button>
  );
}

// Section micro-header — one voice for every block on the dashboard.
function SectionHeader({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={{
        fontSize: 11, fontWeight: 700, color: T.textTertiary,
        fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.07em',
      }}>
        {children}
      </span>
      {right}
    </div>
  );
}

/**
 * Dashboard KPI card — the web dashboard's card, narrowed for the phone.
 *
 * Same anatomy as the web's KpiCard (aurora variant): a tinted icon chip, the
 * secondary stat as a pill in the card's own accent, the uppercase label, the
 * number, then the at-a-glance breakdown under a rule.
 *
 * The one adaptation is the breakdown layout — the web splits it into two
 * columns, which at half a phone's width would leave ~60px per column, so the
 * rows stack instead and nested detail indents under its parent.
 */
function DashKpiCard({ kpi, onPress }) {
  const accent = kpi.accent || T.primary;
  // The card's own hue, laid as a thin wash OVER the card surface rather than as
  // a fixed pastel: on the light theme that reads as the pale tint the web card
  // uses, and on the dark theme it stays a quiet shade of the same hue instead
  // of a white block. Same reason the chip, pill and detail panel sit on
  // T.bgSurface — they lift out of the wash in either theme.
  const wash    = `linear-gradient(0deg, ${accent}14, ${accent}14), ${T.bgSurface}`;
  const hairline = `${accent}33`;

  const breakdownRow = (b, i) => (
    <div key={b.label} style={{ marginTop: i === 0 ? 0 : (b.children ? 6 : 3) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 12, textAlign: 'center', fontSize: 9.5, flexShrink: 0, opacity: 0.9 }}>{b.icon ?? '•'}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, color: T.textSecondary, fontFamily: T.fontBody,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {b.label}
        </span>
        <span style={{ flex: 1, minWidth: 4 }} />
        <span style={{
          fontSize: 10.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody,
          whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
        }}>
          {b.value}
        </span>
      </div>
      {b.children?.map((c) => (
        <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, paddingLeft: 14 }}>
          <span style={{ width: 10, textAlign: 'center', fontSize: 8.5, flexShrink: 0, opacity: 0.75 }}>{c.icon ?? '·'}</span>
          <span style={{
            fontSize: 9.5, color: T.textTertiary, fontFamily: T.fontBody,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {c.label}
          </span>
          <span style={{ flex: 1, minWidth: 3 }} />
          <span style={{
            fontSize: 9.5, fontWeight: 600, color: T.textTertiary, fontFamily: T.fontBody,
            whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
          }}>
            {c.value}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <button
      onClick={onPress}
      style={{
        background: wash,
        border: `1px solid ${hairline}`,
        borderRadius: T.radiusLg,
        padding: '11px 11px 11px',
        display: 'flex', flexDirection: 'column',
        textAlign: 'left', width: '100%', height: '100%',
        cursor: onPress ? 'pointer' : 'default',
        boxShadow: T.shadowSm,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* icon chip */}
      <div style={{
        width: 30, height: 30, borderRadius: T.radiusMd,
        background: T.bgSurface, border: `1px solid ${hairline}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, flexShrink: 0,
      }}>
        {kpi.icon ?? '•'}
      </div>

      {/* label */}
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
        color: T.textTertiary, fontFamily: T.fontBody, marginTop: 9,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%',
      }}>
        {kpi.label}
      </div>

      {/* number */}
      <div style={{
        fontSize: 24, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em',
        color: T.textPrimary, fontFamily: T.fontBody, marginTop: 3,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {kpi.value}
      </div>

      {/* stat pill — the card's secondary figure, in the card's own hue */}
      {kpi.sub && (
        <span style={{
          alignSelf: 'flex-start', maxWidth: '100%', marginTop: 6,
          padding: '2px 8px', borderRadius: T.radiusFull,
          background: T.bgSurface, border: `1px solid ${hairline}`, color: accent,
          fontSize: 9.5, fontWeight: 700, fontFamily: T.fontBody,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {kpi.sub}
        </span>
      )}

      {/* breakdown — an inset panel rather than a rule: the small figures need a
          plain surface to sit on, and it gives the card a clear second half */}
      {kpi.breakdown?.length > 0 && (
        <div style={{
          width: '100%', marginTop: 9,
          background: T.bgSurface, border: `1px solid ${T.border}`,
          borderRadius: T.radiusMd, padding: '7px 8px',
        }}>
          {kpi.breakdown.map(breakdownRow)}
        </div>
      )}
    </button>
  );
}

// ── Next departures rail — the airline-app staple: upcoming flights as a
// horizontally scrolling strip of boarding-pass-like cards. ──────────────────
const FLIGHT_STATUS_STYLE = {
  boarding:  { color: T.statusBoarding,  bg: T.statusBoardingBg,  label: 'Boarding'  },
  delayed:   { color: T.statusDelayed,   bg: T.statusDelayedBg,   label: 'Delayed'   },
  scheduled: { color: T.statusScheduled, bg: T.statusScheduledBg, label: 'Scheduled' },
  departed:  { color: T.statusDeparted,  bg: T.statusDepartedBg,  label: 'Departed'  },
};

function DepartureCard({ f, onPress }) {
  const st = FLIGHT_STATUS_STYLE[f.status] || FLIGHT_STATUS_STYLE.scheduled;
  return (
    <div
      onClick={onPress}
      style={{
        flexShrink: 0, width: 158, background: T.bgSurface,
        border: `1px solid ${T.border}`, borderRadius: T.radiusLg,
        boxShadow: T.shadowSm, cursor: 'pointer', overflow: 'hidden',
      }}
    >
      <div style={{ height: 3, background: st.color }} />
      <div style={{ padding: '9px 11px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: T.textOnPrimary, background: '#2a2528', borderRadius: T.radiusSm, padding: '2px 6px', fontFamily: T.fontBody }}>
            {f.id}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: st.color, background: st.bg, padding: '2px 7px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>
            {st.label}
          </span>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 800, color: T.textPrimary, fontFamily: T.fontBody, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '0.01em' }}>
          {f.route}
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: T.textPrimary, fontFamily: T.fontBody, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{f.departure}</span>
          <span style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody }}>ETD</span>
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: T.textTertiary, fontFamily: T.fontBody }}>
          <span style={{ fontWeight: 700, color: T.textSecondary }}>{f.meals}</span> meals
          <span style={{
            marginLeft: 'auto', fontSize: 9, fontWeight: 700,
            color: f.sector === 'International' ? T.statusInfo : T.textTertiary,
            background: f.sector === 'International' ? T.statusInfoBg : T.bgSubtle,
            border: `1px solid ${T.border}`, padding: '1px 6px', borderRadius: T.radiusFull,
          }}>
            {f.sector === 'International' ? 'INTL' : 'DOM'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Quick actions — one-tap jumps into the modules an ops user opens all day. ──
const QUICK_ACTIONS = [
  { key: 'orders',        icon: '🧾', label: 'Orders'     },
  { key: 'meal-planning', icon: '🍱', label: 'Meals'      },
  { key: 'production',    icon: '🍳', label: 'Production' },
  { key: 'qc',            icon: '✅', label: 'QC'         },
  { key: 'dispatch',      icon: '🚛', label: 'Dispatch'   },
  { key: 'stock',         icon: '📦', label: 'Stock'      },
  { key: 'demands',       icon: '📝', label: 'Demands'    },
  { key: 'approvals',     icon: '🗂️', label: 'Approvals'  },
];

function QuickActions({ nav }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
      {QUICK_ACTIONS.map((a) => (
        <button
          key={a.key}
          onClick={() => nav.navigate(a.key)}
          style={{
            background: T.bgSurface, border: `1px solid ${T.border}`,
            borderRadius: T.radiusMd, padding: '10px 2px 8px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
            cursor: 'pointer', boxShadow: T.shadowSm, WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span style={{
            width: 34, height: 34, borderRadius: T.radiusFull, background: T.primaryLight,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
          }}>
            {a.icon}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.textSecondary, fontFamily: T.fontBody }}>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

function PipelineStep({ step, onPress, isLast }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
      <div
        onClick={onPress}
        style={{
          flex: 1,
          background: step.bg,
          border: `1px solid ${step.color}25`,
          borderRadius: T.radiusMd,
          padding: '9px 6px 7px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          cursor: 'pointer',
          minWidth: 0,
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>{step.icon}</span>
        <div style={{
          fontSize: 14, fontWeight: 800, color: step.color,
          fontFamily: T.fontBody, marginTop: 4, lineHeight: 1,
        }}>
          {step.value}
        </div>
        <div style={{
          fontSize: 9, color: step.color, fontFamily: T.fontBody,
          opacity: 0.75, marginTop: 2, lineHeight: 1,
        }}>
          {step.sub}
        </div>
        <div style={{
          fontSize: 9, fontWeight: 700, color: T.textTertiary,
          fontFamily: T.fontBody, marginTop: 3, textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {step.label}
        </div>
      </div>
      {!isLast && (
        <div style={{
          width: 10, flexShrink: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center',
        }}>
          <svg width="8" height="10" viewBox="0 0 8 12" fill="none">
            <path d="M1 1l6 5-6 5" stroke={T.border} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
}

export function HomeScreen({ nav }) {
  const [expanded, setExpanded] = useState(false);
  const visibleKPIs = expanded ? KPI_ROWS : KPI_ROWS.slice(0, 4);
  const alertBadgeCount = pendingApprovals + inventoryAlerts;
  const authUser = getAuthUser();
  const userName = authUser?.name ?? 'Guest User';
  // Same avatar the web top bar shows — re-read each render, so it updates as
  // soon as you come back from the Profile screen after changing it.
  const userPhoto = authUser?.photoUrl;
  const userFirstName = userName.split(/\s+/)[0];
  const stamp = stampParts(useMinuteClock());

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      {/* Topbar */}
      {/* Topbar is two rows: the greeting sits beside the controls, and the
          date/time gets the full width beneath. Inline beside the bell it ran to
          311px against ~184px of free space and slid under the alert button. */}
      <div style={{
        background: T.topbarGradient,
        padding: '12px 16px 11px',
        display: 'flex', flexDirection: 'column', gap: 9,
        flexShrink: 0,
      }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: T.fontBody, fontSize: 14, fontWeight: 600, color: '#fff',
            lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {greetingForNow()}, <span style={{ fontWeight: 800 }}>{userFirstName}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => nav.navigate('alerts')}
            aria-label="Alerts"
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: T.radiusFull,
              width: 36, height: 36,
              cursor: 'pointer', color: '#fff', fontSize: 17,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative', flexShrink: 0,
            }}
          >
            🔔
            {alertBadgeCount > 0 && (
              <div style={{
                position: 'absolute', top: -3, right: -3,
                background: T.highlight, color: '#fff',
                fontSize: 9, fontWeight: 700,
                minWidth: 14, height: 14,
                borderRadius: T.radiusFull,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 3px', fontFamily: T.fontBody,
                border: `1.5px solid ${T.primary}`,
              }}>
                {alertBadgeCount}
              </div>
            )}
          </button>

          {/* Profile — the avatar alone. The name lived here too, one word away
              from the greeting that already says it; dropping it kills the echo
              and leaves the two controls a matched pair of 36px circles. */}
          <button
            onClick={() => nav.navigate('profile')}
            aria-label={`Profile — ${userName}`}
            title={userName}
            style={{
              width: 36, height: 36, borderRadius: T.radiusFull,
              background: 'rgba(255,255,255,0.95)', color: T.primary,
              border: '1px solid rgba(255,255,255,0.35)',
              fontSize: 12.5, fontWeight: 800, fontFamily: T.fontBody, letterSpacing: '0.02em',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, padding: 0, overflow: 'hidden',
            }}
          >
            {userPhoto
              ? <img src={userPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : nameInitials(userName)}
          </button>
        </div>
      </div>

        {/* Live to the minute — the shift handover reads the date off this bar.
            Three weights, not one: the weekday is what an ops user scans for, the
            year is what they never read, and the time is the only part that
            changes — so it gets a chip in the same translucent language as the
            bell and profile controls above it, with a dot marking it as live. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div
            style={{
              fontFamily: T.fontBody, fontSize: 13.5, color: '#fff',
              whiteSpace: 'nowrap', lineHeight: 1.2, minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span style={{ fontWeight: 800, letterSpacing: '0.01em' }}>{stamp.weekday}</span>
            <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.5)' }}>{' · '}</span>
            <span style={{ fontWeight: 500, color: 'rgba(255,255,255,0.86)' }}>{stamp.date}</span>
          </div>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: T.radiusFull,
              padding: '2px 8px 2px 7px',
              fontFamily: T.fontBody, fontSize: 11.5, fontWeight: 700, color: '#fff',
              letterSpacing: '0.02em', fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.5,
            }}
          >
            <span
              className="ml-live-dot"
              style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', flexShrink: 0 }}
            />
            {stamp.time}
          </span>
        </div>
      </div>

      <style>{`
        /* Marks the clock as live without a spinner's urgency. */
        @keyframes mlLivePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .ml-live-dot { animation: mlLivePulse 2.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ml-live-dot { animation: none; } }
      `}</style>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px' }}>

        {/* ── Pending approvals card — the first thing to act on, so it leads
               the page instead of sitting below the metrics ── */}
        <div style={{
          background: T.bgSurface, border: `1px solid ${T.border}`,
          borderRadius: T.radiusLg, padding: '12px 14px',
          marginBottom: 18, boxShadow: T.shadowSm,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Pending Approvals</span>
            <ViewAllButton onPress={() => nav.navigate('approvals')} />
          </div>
          <div style={{
            background: T.statusPendingBg, border: `1px solid ${T.statusPending}30`,
            borderRadius: T.radiusMd, padding: '9px 12px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: T.radiusFull,
              background: T.statusPendingBg, border: `1.5px solid ${T.statusPending}50`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, flexShrink: 0,
            }}>
              ⏳
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.statusPending, fontFamily: T.fontBody }}>
                {pendingApprovals} items awaiting your review
              </div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                Purchase orders · Payments · Demands
              </div>
            </div>
          </div>
        </div>

        {/* ── KPI grid ── */}
        <div style={{ marginBottom: 4 }}>
          <SectionHeader>Today's KPIs</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'stretch' }}>
            {visibleKPIs.map((kpi, i) => (
              <DashKpiCard key={i} kpi={kpi} onPress={() => nav.navigate(kpi.route)} />
            ))}
          </div>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              width: '100%', marginTop: 10, padding: '8px 0',
              background: T.bgSurface, border: `1px solid ${T.border}`,
              borderRadius: T.radiusMd, fontSize: 12, fontWeight: 600,
              color: T.primary, fontFamily: T.fontBody, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}
          >
            {expanded ? '▲ Show less' : `▼ View all metrics (${KPI_ROWS.length - 4} more)`}
          </button>
        </div>

        {/* ── Quick actions — sits with the KPIs: read the number, jump to the
               module it came from ── */}
        <div style={{ marginTop: 18 }}>
          <SectionHeader>Quick Actions</SectionHeader>
          <QuickActions nav={nav} />
        </div>

        {/* ── Operations pipeline — the catering flow at a glance ── */}
        <div style={{ marginTop: 18 }}>
          <SectionHeader>Operations Pipeline</SectionHeader>
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            {PIPELINE.map((step, i) => (
              <PipelineStep
                key={step.key}
                step={step}
                isLast={i === PIPELINE.length - 1}
                onPress={() => nav.navigate(step.key)}
              />
            ))}
          </div>
        </div>

        {/* ── Next departures rail ── */}
        {FLIGHTS.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <SectionHeader right={<ViewAllButton onPress={() => nav.navigate('orders')} />}>
              Next Departures
            </SectionHeader>
            {/* bleed to the screen edge so the cut-off card invites the scroll */}
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', margin: '0 -14px', padding: '2px 14px 6px' }}>
              {FLIGHTS.slice(0, 10).map((f, i) => (
                <DepartureCard key={`${f.id}-${i}`} f={f} onPress={() => nav.navigate('orders')} />
              ))}
            </div>
          </div>
        )}

        {/* ── Active Orders (Flight / Crew) — same data as the web dashboard ── */}
        <ActiveOrdersCard nav={nav} />

      </div>
    </div>
  );
}
