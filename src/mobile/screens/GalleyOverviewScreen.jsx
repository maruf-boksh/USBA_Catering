import { T } from '../theme';
import { KPICard } from '../components/KPICard';
// Live galley + consumables data from the web modules (same sources the web
// Galley Dashboard reads): seeded galley loading records and the consumable
// item master.
import { loadGalleyRecords } from '@/routes/dispatch-monitoring';
import { consumableItems } from '@/lib/sample-data';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

// Galley plan lifecycle → label + colour (mirrors the web Galley Dashboard chips).
const GSTATUS = {
  forwarded:         { label: 'Forwarded',         color: '#0EA5E9', bg: '#e0f2fe' },
  loading:           { label: 'Loading',           color: '#D97706', bg: '#fffbeb' },
  completed:         { label: 'Loaded',            color: '#16A34A', bg: '#f0fdf4' },
  awaiting_approval: { label: 'Awaiting Approval', color: '#7C3AED', bg: '#f5f3ff' },
  approved:          { label: 'Approved',          color: '#0F7A40', bg: '#ecfdf5' },
};
const GSTATUS_ORDER = ['forwarded', 'loading', 'completed', 'awaiting_approval', 'approved'];

// Live consumable stock (allocation may have overwritten the seed).
function readItems() {
  try {
    const raw = localStorage.getItem('harvest-data-v1:airline-consumables-items');
    return raw ? JSON.parse(raw) : consumableItems;
  } catch { return consumableItems; }
}

const money = (n) => `৳ ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function GalleyOverviewScreen({ nav }) {
  const records = loadGalleyRecords();
  const items = readItems();

  const statusCounts = records.reduce((acc, r) => {
    acc[r.galleyStatus] = (acc[r.galleyStatus] ?? 0) + 1;
    return acc;
  }, {});
  const statusChart = GSTATUS_ORDER
    .filter((s) => (statusCounts[s] ?? 0) > 0)
    .map((s) => ({ key: s, ...GSTATUS[s], value: statusCounts[s] }));

  const totalSKUs   = items.length;
  const lowStock    = items.filter((r) => r.reorder > 0 && r.stock <= r.reorder).length;
  const stockValue  = items.reduce((s, r) => s + r.stock * r.unitCost, 0);
  const awaiting    = statusCounts.awaiting_approval ?? 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Galley Planning</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Overview · {records.length} plans</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 20px' }}>
        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <KPICard label="Galley Plans"    value={records.length} sub="This period"     accent={T.statusScheduled} />
          <KPICard label="Awaiting Approval" value={awaiting}     sub="Need sign-off"    accent={T.statusBoarding} />
          <KPICard label="Consumable SKUs" value={totalSKUs}      sub="Item master"      accent={T.statusApproved} />
          <KPICard label="Low Stock"       value={lowStock}       sub="At/under reorder" accent={T.statusDelayed} />
        </div>

        {/* Stock value */}
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Consumable Stock Value</span>
          <span style={{ fontSize: 17, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{money(stockValue)}</span>
        </div>

        {/* Status breakdown */}
        {statusChart.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '18px 2px 8px' }}>Plan Status</div>
            <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '6px 14px', boxShadow: T.shadowSm }}>
              {statusChart.map((s, i) => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 10, paddingBottom: 10, borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                  <span style={{ width: 9, height: 9, borderRadius: T.radiusFull, background: s.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, color: T.textPrimary, fontFamily: T.fontBody }}>{s.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{s.value}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Galley plans list */}
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '18px 2px 8px' }}>Galley Plans</div>
        {records.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody }}>No galley plans yet.</div>
        ) : records.map((r) => {
          const g = GSTATUS[r.galleyStatus] || GSTATUS.forwarded;
          return (
            <div key={r.id} style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{r.flightLabel}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: g.color, background: g.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>{g.label}</span>
              </div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                {r.id} · {r.date}{r.approvedBy ? ` · ✓ ${r.approvedBy}` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
