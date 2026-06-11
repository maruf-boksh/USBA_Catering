import { useState } from 'react';
import { T } from '../theme';
import { KPICard } from '../components/KPICard';
import { MOCK_KPIS, MOCK_FLIGHTS, MOCK_PRODUCTION_ORDERS, MOCK_QC_CHECKS, MOCK_DISPATCHES } from '../mockData';

const STATUS_STYLE = {
  boarding:  { color: T.statusBoarding,  bg: T.statusBoardingBg  },
  scheduled: { color: T.statusScheduled, bg: T.statusScheduledBg },
  delayed:   { color: T.statusDelayed,   bg: T.statusDelayedBg   },
  departed:  { color: T.statusDeparted,  bg: T.statusDepartedBg  },
};

function FlightRow({ flight }) {
  const s = STATUS_STYLE[flight.status] || STATUS_STYLE.scheduled;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 0', borderBottom: `1px solid ${T.border}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{flight.id}</span>
          <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{flight.route}</span>
        </div>
        <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
          {flight.airline} · {flight.pax} pax · {flight.meals} meals
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, fontFamily: T.fontBody }}>{flight.departure}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, color: s.color, background: s.bg,
          padding: '2px 6px', borderRadius: T.radiusFull,
          textTransform: 'capitalize', fontFamily: T.fontBody,
        }}>
          {flight.status}
        </span>
      </div>
    </div>
  );
}

const KPI_ROWS = [
  { label: 'Total Flights',     value: MOCK_KPIS.totalFlights,                          sub: 'Today',                             accent: T.statusInfo    },
  { label: 'Total Meals',       value: MOCK_KPIS.totalMeals,                             sub: 'Scheduled',                         accent: T.statusApproved },
  { label: 'Delayed Flights',   value: MOCK_KPIS.delayedFlights,                         sub: `${MOCK_KPIS.delayedPax} pax affected`, accent: T.statusDelayed  },
  { label: 'On-Time Rate',      value: `${MOCK_KPIS.onTimeRate}%`,                       sub: 'Departures',                        accent: T.statusApproved },
  { label: 'QC Open Issues',    value: MOCK_KPIS.qcOpenIssues,                           sub: `${MOCK_KPIS.qcResolvedToday} resolved today`, accent: T.primary },
  { label: 'Pending Approvals', value: MOCK_KPIS.pendingApprovals,                       sub: 'Awaiting review',                   accent: T.statusPending  },
  { label: 'Active Dispatches', value: MOCK_KPIS.activeDispatches,                       sub: 'In progress',                       accent: T.statusBoarding },
  { label: 'Inventory Alerts',  value: MOCK_KPIS.inventoryAlerts,                        sub: 'Low stock items',                   accent: T.statusDelayed  },
];

// Pipeline step data derived from mock data
const ordersConfirmed  = MOCK_FLIGHTS.length;
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
  const alertBadgeCount = MOCK_KPIS.pendingApprovals + MOCK_KPIS.inventoryAlerts;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{
        background: T.topbarGradient,
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1 }}>Good morning</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff', marginTop: 2 }}>Operations Dashboard</div>
        </div>
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
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px' }}>

        {/* ── KPI grid ── */}
        <div style={{ marginBottom: 4 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: T.textTertiary,
            fontFamily: T.fontBody, textTransform: 'uppercase',
            letterSpacing: '0.06em', marginBottom: 10,
          }}>
            Today's KPIs
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {visibleKPIs.map((kpi, i) => (
              <KPICard
                key={i}
                label={kpi.label}
                value={kpi.value}
                sub={kpi.sub}
                accent={kpi.accent}
              />
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

        {/* ── Pending approvals card ── */}
        <div style={{
          background: T.bgSurface, border: `1px solid ${T.border}`,
          borderRadius: T.radiusLg, padding: '12px 14px',
          marginTop: 14, boxShadow: T.shadowSm,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Pending Approvals</span>
            <button
              onClick={() => nav.navigate('approvals')}
              style={{
                background: 'none', border: 'none', color: T.primary,
                fontSize: 12, fontWeight: 600, fontFamily: T.fontBody,
                cursor: 'pointer', padding: 0,
              }}
            >
              View all →
            </button>
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
                {MOCK_KPIS.pendingApprovals} items awaiting your review
              </div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                Purchase orders · Payments · Demands
              </div>
            </div>
          </div>
        </div>

        {/* ── Next departures ── */}
        <div style={{
          background: T.bgSurface, border: `1px solid ${T.border}`,
          borderRadius: T.radiusLg, padding: '12px 14px',
          marginTop: 14, boxShadow: T.shadowSm, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Next Departures</span>
            <button
              onClick={() => nav.navigate('orders')}
              style={{
                background: 'none', border: 'none', color: T.primary,
                fontSize: 12, fontWeight: 600, fontFamily: T.fontBody,
                cursor: 'pointer', padding: 0,
              }}
            >
              Orders →
            </button>
          </div>
          {MOCK_FLIGHTS.slice(0, 4).map(f => (
            <FlightRow key={f.id} flight={f} />
          ))}
          <div style={{ paddingTop: 6, fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, textAlign: 'center' }}>
            {MOCK_KPIS.totalFlights} flights total today
          </div>
        </div>

      </div>
    </div>
  );
}
