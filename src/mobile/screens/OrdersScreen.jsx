import { useMemo, useState } from 'react';
import { T } from '../theme';
import {
  loadMobileOrderBook, getOrderAmendments,
} from '../../lib/flight-orders-store';

// ─────────────────────────────────────────────────────────────────────────────
// Order Management — the SAME live order book the web page manages, read from
// the shared store (see loadMobileOrderBook in lib/flight-orders-store.ts).
// Orders created, amended or advanced on the web show here on next open, with
// the web's own order numbers, lifecycle statuses and revision history.
//
// Read-only by design: orders are raised and amended at a desk; the phone is
// for looking one up at the galley door. What IS carried over from the web:
//   • the full lifecycle vocabulary (Pending → … → Departed), hex-identical
//     pill colours,
//   • legs grouped under their Order # (a round trip is one order, two legs),
//   • the LMC lead-window flag on upcoming legs,
//   • each leg's amendment timeline — who changed what, when, and whether it
//     was a last-minute change.
// ─────────────────────────────────────────────────────────────────────────────

// Lifecycle pill palette — theme tokens mirroring the web's OM_STAT_CLS.
const STATUS_PILL = {
  Pending:    { color: T.statusOrderPending, bg: T.statusOrderPendingBg },
  Approved:   { color: T.statusDispatched,   bg: T.statusDispatchedBg },
  Production: { color: T.statusProduction,   bg: T.statusProductionBg },
  Packaged:   { color: T.statusPackaged,     bg: T.statusPackagedBg },
  Dispatched: { color: T.statusDispatched,   bg: T.statusDispatchedBg },
  Completed:  { color: T.statusCompleted,    bg: T.statusCompletedBg },
  Departed:   { color: T.statusDeparted,     bg: T.statusDepartedBg },
};

// Filter-chip order — the lifecycle itself, so the row reads as a pipeline.
const LIFECYCLE = ['Pending', 'Approved', 'Production', 'Packaged', 'Dispatched', 'Completed', 'Departed'];

function StatusPill({ status, size = 10 }) {
  const s = STATUS_PILL[status] ?? STATUS_PILL.Pending;
  return (
    <span style={{
      fontSize: size, fontWeight: 700, color: s.color, background: s.bg,
      border: `1px solid ${s.color}22`,
      padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody,
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {status}
    </span>
  );
}

/**
 * Order-level badges — the web's OrderStatusBadges rule, restated for mobile.
 * An order has no status of its own; its legs advance independently. So:
 *   • every leg at one stage → that concrete pill (a fact, not a guess),
 *   • mixed stages → an indigo PROGRESS readout naming the least-advanced
 *     stage ("3 of 38 still Production" — the order is only as done as its
 *     slowest leg) plus a count chip per stage so the mix is visible without
 *     expanding.
 */
function GroupStatusBadges({ group }) {
  if (group.uniformStatus) return <StatusPill status={group.uniformStatus} />;
  const blocking = group.statusCounts[0]; // earliest lifecycle stage present
  const total = group.legs.length;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 9.5, fontWeight: 800, letterSpacing: '0.03em',
        color: T.statusProgress, background: T.statusProgressBg,
        border: `1px solid ${T.statusProgress}33`,
        padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody,
        whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', border: `1.5px solid ${T.statusProgress}`, flexShrink: 0 }} />
        {blocking.n} of {total} still {blocking.status}
      </span>
      {group.statusCounts.map((c) => {
        const s = STATUS_PILL[c.status] ?? STATUS_PILL.Pending;
        return (
          <span key={c.status} style={{
            fontSize: 9, fontWeight: 600, color: s.color, background: s.bg,
            border: `1px solid ${s.color}22`,
            padding: '1px 6px', borderRadius: T.radiusFull, fontFamily: T.fontBody,
            whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
          }}>
            <strong style={{ fontWeight: 800 }}>{c.n}</strong> {c.status}
          </span>
        );
      })}
    </span>
  );
}

/** Amber "LMC window" tag — this leg departs inside the last-minute-change
 *  window, so any further change is an LMC. Same signal the web shows. */
function LmcTag() {
  return (
    <span style={{
      fontSize: 8.5, fontWeight: 800, letterSpacing: '0.06em',
      color: T.statusDelayed, background: T.statusDelayedBg,
      padding: '1.5px 5px', borderRadius: T.radiusSm, fontFamily: T.fontBody,
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      LMC WINDOW
    </span>
  );
}

function FlightNoBadge({ flight }) {
  return (
    <span style={{
      fontFamily: T.fontBody, fontSize: 10.5, fontWeight: 800, color: '#fff',
      background: T.textPrimary, borderRadius: T.radiusSm,
      padding: '2px 6px', letterSpacing: '0.03em', flexShrink: 0,
    }}>
      {flight}
    </span>
  );
}

function Topbar({ onBack, title, sub }) {
  return (
    <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <button
        onClick={onBack}
        aria-label="Back"
        style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      >
        ←
      </button>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        {sub && <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
    </div>
  );
}

/** "how long until wheels-up", as a person would say it. */
function leadLabel(leadHours) {
  if (leadHours == null) return null;
  if (leadHours < 0) return 'Flown';
  if (leadHours < 1) return `${Math.max(1, Math.round(leadHours * 60))} min to ETD`;
  if (leadHours < 48) return `${Math.round(leadHours)}h to ETD`;
  return `${Math.round(leadHours / 24)}d to ETD`;
}

/** One leg's amendment timeline — the web's revision history, newest first. */
function AmendmentTimeline({ legId }) {
  const revisions = getOrderAmendments(legId);
  if (revisions.length === 0) return null;
  return (
    <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10, marginTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.07em', color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 8 }}>
        AMENDMENTS ({revisions.length})
      </div>
      {revisions.map((rev) => (
        <div key={rev.id} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 3, flexShrink: 0 }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: rev.isLmc ? T.primary : T.borderStrong, flexShrink: 0,
            }} />
            <span style={{ flex: 1, width: 1, background: T.border, marginTop: 3 }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{rev.by}</span>
              <span style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody }}>{String(rev.at).slice(0, 16).replace('T', ' ')}</span>
              {rev.isLmc && (
                <span style={{ fontSize: 8.5, fontWeight: 800, color: T.primary, background: T.primaryLight, padding: '1px 5px', borderRadius: T.radiusSm, fontFamily: T.fontBody }}>
                  LMC
                </span>
              )}
            </div>
            {rev.changes.map((c, i) => (
              <div key={i} style={{ fontSize: 11, color: T.textSecondary, fontFamily: T.fontBody, marginTop: 2 }}>
                {c.label}: <span style={{ textDecoration: 'line-through', color: T.textTertiary }}>{String(c.from)}</span>
                {' → '}
                <span style={{ fontWeight: 700, color: T.textPrimary }}>{String(c.to)}</span>
              </div>
            ))}
            {rev.reason && (
              <div style={{ fontSize: 10.5, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2, fontStyle: 'italic' }}>
                “{rev.reason}”
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Detail: one order group, every leg in full ───────────────────────────────
function OrderDetail({ group, onBack }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <Topbar
        onBack={onBack}
        title={group.orderNo}
        sub={`${group.airline} · ${group.date} · ${group.legs.length} leg${group.legs.length === 1 ? '' : 's'}`}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
        {/* Order-level badges — same rule as the web band and the list card. */}
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
          <GroupStatusBadges group={group} />
        </div>

        {/* Rollup strip — the order's totals across its legs. */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12,
        }}>
          {[
            ['PAX', group.totalPax],
            ['Crew', group.totalCrew],
            ['Special', group.totalSpecial],
          ].map(([label, value]) => (
            <div key={label} style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.textPrimary, fontFamily: T.fontBody, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', marginTop: 1 }}>{label}</div>
            </div>
          ))}
        </div>

        {group.legs.map((leg) => (
          <div key={leg.id} style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: 14, marginBottom: 12, boxShadow: T.shadowSm }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, flexWrap: 'wrap' }}>
              <FlightNoBadge flight={leg.flight} />
              <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{leg.route}</span>
              <span style={{ flex: 1 }} />
              {leg.inLmcWindow && <LmcTag />}
              <StatusPill status={leg.status} />
            </div>
            {[
              ['Direction', leg.direction],
              ['Scope', leg.scope],
              ['Date', leg.date],
              ['ETD', `${leg.etd}${leadLabel(leg.leadHours) ? ` · ${leadLabel(leg.leadHours)}` : ''}`],
              ['Passengers', `${leg.pax} pax`],
              ['Crew', String(leg.crew)],
              ['Special meals', String(leg.specialMeals)],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingTop: 7, paddingBottom: 7, borderTop: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody, textAlign: 'right' }}>{value}</span>
              </div>
            ))}
            <AmendmentTimeline legId={leg.id} />
          </div>
        ))}

        <div style={{ textAlign: 'center', fontSize: 10.5, color: T.textDisabled, fontFamily: T.fontBody, marginTop: 4 }}>
          Live from web Order Management · read-only on mobile
        </div>
      </div>
    </div>
  );
}

// ── List ─────────────────────────────────────────────────────────────────────
export function OrdersScreen({ nav }) {
  // Read once per mount — reopening the screen re-reads the store, matching how
  // the other mobile bridges (Home, Purchase Requisition) stay fresh.
  const book = useMemo(() => loadMobileOrderBook(), []);
  const [tab, setTab] = useState('flight');
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  const groups = book[tab] ?? [];

  // Chip row shows only statuses that exist in this tab — a filter that can
  // only ever produce an empty list is noise.
  const presentStatuses = useMemo(() => {
    const seen = new Set();
    for (const g of groups) for (const l of g.legs) seen.add(l.status);
    return LIFECYCLE.filter((s) => seen.has(s));
  }, [groups]);

  const q = query.trim().toLowerCase();
  const visible = groups.filter((g) => {
    if (statusFilter && !g.legs.some((l) => l.status === statusFilter)) return false;
    if (!q) return true;
    return (
      g.orderNo.toLowerCase().includes(q) ||
      g.airline.toLowerCase().includes(q) ||
      g.legs.some((l) => l.flight.toLowerCase().includes(q) || l.route.toLowerCase().includes(q))
    );
  });

  const totalLegs = groups.reduce((s, g) => s + g.legs.length, 0);

  // With a status filter on, a card previews the legs IN that status — the
  // default preview is most-active-first, so filtering by a late status would
  // otherwise surface cards whose visible rows are all in a different one,
  // which reads as a broken filter.
  const legsOf = (g) => (statusFilter ? g.legs.filter((l) => l.status === statusFilter) : g.legs);

  if (selected) return <OrderDetail group={selected} onBack={() => setSelected(null)} />;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <Topbar
        onBack={() => nav.goBack()}
        title="Order Management"
        sub={`${groups.length} order${groups.length === 1 ? '' : 's'} · ${totalLegs} flight${totalLegs === 1 ? '' : 's'} · live from web`}
      />

      {/* Flight / Crew tabs — same split as the web page and the Home card. */}
      <div style={{ display: 'flex', background: T.bgSurface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        {[['flight', 'Flight Orders'], ['crew', 'Crew Orders']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setStatusFilter(''); setQuery(''); setSelected(null); }}
            style={{
              flex: 1, background: 'none', border: 'none', cursor: 'pointer',
              padding: '11px 4px 9px',
              fontFamily: T.fontBody, fontSize: 12.5,
              fontWeight: tab === key ? 800 : 600,
              color: tab === key ? T.primary : T.textTertiary,
              borderBottom: `2px solid ${tab === key ? T.primary : 'transparent'}`,
            }}
          >
            {label} ({(book[key] ?? []).length})
          </button>
        ))}
      </div>

      {/* Search + status chips */}
      <div style={{ padding: '10px 14px 0', flexShrink: 0 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search order #, flight or route…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: T.bgSurface, border: `1px solid ${T.border}`,
            borderRadius: T.radiusMd, padding: '9px 12px',
            fontSize: 13, fontFamily: T.fontBody, color: T.textPrimary,
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 0 8px', WebkitOverflowScrolling: 'touch' }}>
          {['', ...presentStatuses].map((s) => {
            const active = statusFilter === s;
            const pill = s ? STATUS_PILL[s] : null;
            return (
              <button
                key={s || 'all'}
                onClick={() => setStatusFilter(s)}
                style={{
                  flexShrink: 0, cursor: 'pointer',
                  background: active ? (pill ? pill.bg : T.textPrimary) : T.bgSurface,
                  color: active ? (pill ? pill.color : '#fff') : T.textSecondary,
                  border: `1px solid ${active && pill ? `${pill.color}55` : T.border}`,
                  borderRadius: T.radiusFull, padding: '4px 11px',
                  fontSize: 11, fontWeight: 700, fontFamily: T.fontBody,
                }}
              >
                {s || 'All'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Order cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 16px' }}>
        {visible.length === 0 && (
          <div style={{ textAlign: 'center', color: T.textTertiary, fontSize: 12.5, fontFamily: T.fontBody, padding: '36px 12px' }}>
            No orders match{q ? <> “<strong>{query.trim()}</strong>”</> : ' this filter'}.
          </div>
        )}
        {visible.map((g) => (
          <div
            key={g.orderNo}
            onClick={() => setSelected(g)}
            style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, marginTop: 10, boxShadow: T.shadowSm, cursor: 'pointer', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 13px 8px' }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: T.primary, fontFamily: T.fontBody }}>{g.orderNo}</span>
              <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.airline} · {g.date}
              </span>
              <span style={{ flex: 1 }} />
              <GroupStatusBadges group={g} />
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '0 13px 8px', fontSize: 11, color: T.textSecondary, fontFamily: T.fontBody }}>
              <span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{g.totalPax}</strong> pax</span>
              <span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{g.totalCrew}</strong> crew</span>
              {g.totalSpecial > 0 && <span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{g.totalSpecial}</strong> special</span>}
            </div>
            {/* Bulk-upload orders carry dozens of legs — preview a few and let
                the detail view list them all, as the web card does. With a
                status filter on, the preview is the matching legs (legsOf). */}
            {legsOf(g).slice(0, 3).map((leg, i) => (
              <div
                key={leg.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
                  padding: '8px 13px', borderTop: `1px solid ${T.border}`,
                  background: i % 2 ? T.bgSubtle : 'transparent',
                }}
              >
                <FlightNoBadge flight={leg.flight} />
                <span style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {leg.route}
                </span>
                {/* Each leg carries its OWN lifecycle status — a rotation's legs
                    advance independently, so the group pill alone misleads. */}
                <StatusPill status={leg.status} size={9} />
                {leg.inLmcWindow && <LmcTag />}
                {leg.amendmentCount > 0 && (
                  <span
                    title={`${leg.amendmentCount} amendment${leg.amendmentCount === 1 ? '' : 's'}`}
                    style={{ fontSize: 9, fontWeight: 800, color: T.statusInfo, background: T.statusInfoBg, padding: '1px 5px', borderRadius: T.radiusSm, fontFamily: T.fontBody, flexShrink: 0 }}
                  >
                    {leg.amendmentCount} rev
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{leg.etd}</span>
                <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, fontVariantNumeric: 'tabular-nums', width: 38, textAlign: 'right', flexShrink: 0 }}>{leg.pax}p</span>
              </div>
            ))}
            {legsOf(g).length > 3 && (
              <div style={{ padding: '7px 13px', borderTop: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700, color: T.primary, fontFamily: T.fontBody }}>
                + {legsOf(g).length - 3} more {statusFilter ? `${statusFilter} ` : ''}flight{legsOf(g).length - 3 === 1 ? '' : 's'} →
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
