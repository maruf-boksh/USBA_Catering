import { T } from '../theme';
import { MOCK_POS } from '../mockData';

const STATUS_MAP = {
  pending:  { color: T.statusPending,  bg: T.statusPendingBg,  label: 'Pending'  },
  approved: { color: T.statusApproved, bg: T.statusApprovedBg, label: 'Approved' },
  rejected: { color: T.statusRejected, bg: T.statusRejectedBg, label: 'Rejected' },
};

export function PurchaseOrdersScreen({ nav }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Purchase Orders</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{MOCK_POS.length} purchase orders</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
        {MOCK_POS.map((po) => {
          const s = STATUS_MAP[po.status] || STATUS_MAP.pending;
          return (
            <div key={po.id} style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ flex: 1, paddingRight: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{po.id}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{po.vendor} · {po.date}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>{s.label}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>{po.items} items</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{po.total}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
