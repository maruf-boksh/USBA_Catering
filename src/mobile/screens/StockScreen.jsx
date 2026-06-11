import { T } from '../theme';
import { MOCK_STOCK } from '../mockData';

export function StockScreen({ nav }) {
  const low = MOCK_STOCK.filter(s => s.status === 'low').length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Stock Overview</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{low} low-stock items</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
        {MOCK_STOCK.map((item) => (
          <div key={item.id} style={{ background: T.bgSurface, border: `1px solid ${item.status === 'low' ? T.statusDelayed + '40' : T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div style={{ flex: 1, paddingRight: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{item.name}</div>
                <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{item.category} · {item.value}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: item.status === 'low' ? T.statusDelayed : T.statusApproved, background: item.status === 'low' ? T.statusDelayedBg : T.statusApprovedBg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>
                {item.status === 'low' ? 'Low' : 'OK'}
              </span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: item.status === 'low' ? T.statusDelayed : T.textPrimary, fontFamily: T.fontBody }}>
              {item.qty} <span style={{ fontSize: 11, fontWeight: 400, color: T.textTertiary }}>{item.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
