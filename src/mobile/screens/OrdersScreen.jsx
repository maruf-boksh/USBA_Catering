import { useState } from 'react';
import { T } from '../theme';
import { MOCK_ORDERS } from '../mockData';

const STATUS_MAP = {
  confirmed: { color: T.statusApproved,  bg: T.statusApprovedBg,  label: 'Confirmed' },
  pending:   { color: T.statusPending,   bg: T.statusPendingBg,   label: 'Pending'   },
  draft:     { color: T.statusDraft,     bg: T.statusDraftBg,     label: 'Draft'     },
};

function Topbar({ nav, title, sub }) {
  return (
    <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <button onClick={() => nav.goBack()} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
      <div>
        <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{title}</div>
        {sub && <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.draft;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>
      {s.label}
    </span>
  );
}

function OrderDetail({ order, onBack }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{order.id}</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{order.flight} · {order.route}</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: 16, marginBottom: 12, boxShadow: T.shadowSm }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{order.mealType}</div>
            <StatusBadge status={order.status} />
          </div>
          {[
            ['Flight',     order.flight],
            ['Airline',    order.airline],
            ['Route',      order.route],
            ['Departure',  order.departure],
            ['Passengers', `${order.pax} pax`],
            ['Sector',     order.sector],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 8, borderTop: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OrdersScreen({ nav }) {
  const [selected, setSelected] = useState(null);

  if (selected) return <OrderDetail order={selected} onBack={() => setSelected(null)} />;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <Topbar nav={nav} title="Order Management" sub={`${MOCK_ORDERS.length} orders today`} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
        {MOCK_ORDERS.map((order) => (
          <div
            key={order.id}
            onClick={() => setSelected(order)}
            style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{order.id}</div>
                <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{order.flight} · {order.route} · {order.departure}</div>
              </div>
              <StatusBadge status={order.status} />
            </div>
            <div style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>{order.mealType} · {order.pax} pax</div>
          </div>
        ))}
      </div>
    </div>
  );
}
