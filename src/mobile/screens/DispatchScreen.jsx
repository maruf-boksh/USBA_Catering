import { useState } from 'react';
import { T } from '../theme';
import { MOCK_DISPATCHES } from '../mockData';

const STATUS_MAP = {
  dispatched: { color: T.statusApproved, bg: T.statusApprovedBg, label: 'Dispatched' },
  loading:    { color: T.statusInfo,     bg: T.statusInfoBg,     label: 'Loading'    },
  pending:    { color: T.statusPending,  bg: T.statusPendingBg,  label: 'Pending'    },
};

function DispatchDetail({ dispatch, onBack }) {
  const [status, setStatus] = useState(dispatch.status);
  const s = STATUS_MAP[status] || STATUS_MAP.pending;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{dispatch.id}</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{dispatch.flight} · {dispatch.route}</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: 16, marginBottom: 14, boxShadow: T.shadowSm }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{dispatch.flight}</div>
            <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '3px 10px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{s.label}</span>
          </div>
          {[
            ['Route',      dispatch.route],
            ['Departure',  dispatch.departure],
            ['Items',      `${dispatch.items} units`],
            ['Driver',     dispatch.driver || 'Not assigned'],
            ['Dispatched', dispatch.dispatchedAt || '—'],
          ].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 8, borderTop: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
            </div>
          ))}
        </div>
        {status !== 'dispatched' && (
          <button
            onClick={() => setStatus(status === 'pending' ? 'loading' : 'dispatched')}
            style={{ width: '100%', padding: '13px 0', background: T.statusApproved, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}
          >
            {status === 'pending' ? 'Start Loading' : 'Mark Dispatched'}
          </button>
        )}
        {status === 'dispatched' && (
          <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusMd, padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>Dispatched ✓</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function DispatchScreen({ nav }) {
  const [selected, setSelected] = useState(null);
  if (selected) return <DispatchDetail dispatch={selected} onBack={() => setSelected(null)} />;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Dispatch</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{MOCK_DISPATCHES.length} dispatches today</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
        {MOCK_DISPATCHES.map((d) => {
          const s = STATUS_MAP[d.status] || STATUS_MAP.pending;
          return (
            <div
              key={d.id}
              onClick={() => setSelected(d)}
              style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{d.id}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{d.flight} · {d.route} · Dep {d.departure}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>{s.label}</span>
              </div>
              <div style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>{d.items} units · {d.driver || 'No driver assigned'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
