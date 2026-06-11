import { useState } from 'react';
import { T } from '../theme';
import { MOCK_PRODUCTION_ORDERS, MOCK_KPIS } from '../mockData';

const STATUS_MAP = {
  completed:    { color: T.statusApproved,  bg: T.statusApprovedBg,  label: 'Completed'    },
  'in-progress':{ color: T.statusInfo,      bg: T.statusInfoBg,      label: 'In Progress'  },
  pending:      { color: T.statusPending,   bg: T.statusPendingBg,   label: 'Pending'      },
};

function ProgressBar({ produced, qty }) {
  const pct = qty > 0 ? Math.round((produced / qty) * 100) : 0;
  const color = pct === 100 ? T.statusApproved : pct > 0 ? T.statusInfo : T.border;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{produced}/{qty} produced</span>
        <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: T.fontBody }}>{pct}%</span>
      </div>
      <div style={{ height: 6, background: T.border, borderRadius: T.radiusFull, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: T.radiusFull, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

function OrderDetail({ order, onBack }) {
  const [localStatus, setLocalStatus] = useState(order.status);
  const s = STATUS_MAP[localStatus] || STATUS_MAP.pending;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{order.id}</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{order.flight} · Due {order.dueBy}</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: 16, marginBottom: 12, boxShadow: T.shadowSm }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, flex: 1, paddingRight: 8 }}>{order.item}</div>
            <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '3px 10px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>{s.label}</span>
          </div>
          {[['Section', order.section], ['Flight', order.flight], ['Due By', order.dueBy], ['Target Qty', `${order.qty} units`]].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 8, borderTop: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
            </div>
          ))}
          <div style={{ paddingTop: 12 }}>
            <ProgressBar produced={order.produced} qty={order.qty} />
          </div>
        </div>

        {localStatus !== 'completed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {localStatus === 'pending' && (
              <button
                onClick={() => setLocalStatus('in-progress')}
                style={{ width: '100%', padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}
              >
                Start Production
              </button>
            )}
            {localStatus === 'in-progress' && (
              <button
                onClick={() => setLocalStatus('completed')}
                style={{ width: '100%', padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}
              >
                Mark Completed
              </button>
            )}
          </div>
        )}
        {localStatus === 'completed' && (
          <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusMd, padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>Production Complete</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProductionScreen({ nav }) {
  const [selected, setSelected] = useState(null);
  if (selected) return <OrderDetail order={selected} onBack={() => setSelected(null)} />;

  const completed   = MOCK_PRODUCTION_ORDERS.filter(o => o.status === 'completed').length;
  const inProgress  = MOCK_PRODUCTION_ORDERS.filter(o => o.status === 'in-progress').length;
  const pending     = MOCK_PRODUCTION_ORDERS.filter(o => o.status === 'pending').length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Production</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{MOCK_PRODUCTION_ORDERS.length} orders today</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
          {[['Done', completed, T.statusApproved, T.statusApprovedBg], ['Active', inProgress, T.statusInfo, T.statusInfoBg], ['Pending', pending, T.statusPending, T.statusPendingBg]].map(([label, val, color, bg]) => (
            <div key={label} style={{ background: bg, border: `1px solid ${color}20`, borderRadius: T.radiusMd, padding: '10px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: T.fontBody }}>{val}</div>
              <div style={{ fontSize: 11, color, fontFamily: T.fontBody, marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Production Orders</div>

        {MOCK_PRODUCTION_ORDERS.map((order) => {
          const s = STATUS_MAP[order.status] || STATUS_MAP.pending;
          return (
            <div
              key={order.id}
              onClick={() => setSelected(order)}
              style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ flex: 1, paddingRight: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{order.item}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{order.id} · {order.section} · Due {order.dueBy}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>{s.label}</span>
              </div>
              <ProgressBar produced={order.produced} qty={order.qty} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
