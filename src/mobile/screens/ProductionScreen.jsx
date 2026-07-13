import { useState } from 'react';
import { T } from '../theme';
import { MOCK_PRODUCTION_ORDERS, MOCK_PRODUCTION_DETAILS } from '../mockData';
import { qcStore } from '../qcStore';

const STATUS_MAP = {
  completed:    { color: T.statusApproved,  bg: T.statusApprovedBg,  label: 'Completed'    },
  'in-progress':{ color: T.statusInfo,      bg: T.statusInfoBg,      label: 'In Progress'  },
  pending:      { color: T.statusPending,   bg: T.statusPendingBg,   label: 'Pending'      },
};

const money = (n) => n.toLocaleString('en-IN');

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

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
      {children}
    </div>
  );
}

function MaterialTable({ title, rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{title}</div>
      <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, overflow: 'hidden' }}>
        {rows.map((m, i) => (
          <div key={m.code} style={{ padding: '8px 12px', borderTop: i === 0 ? 'none' : `1px solid ${T.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{m.name}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>৳ {money(m.qty * m.rate)}</span>
            </div>
            <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
              {m.code} · {m.qty} {m.uom} × ৳{m.rate}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderDetail({ order, onBack, onUpdate }) {
  const [forwardedToQC, setForwardedToQC] = useState(false);
  const [recordQty, setRecordQty] = useState(String(order.qty));
  const s = STATUS_MAP[order.status] || STATUS_MAP.pending;
  const detail = MOCK_PRODUCTION_DETAILS[order.id];
  const remaining = Math.max(0, order.qty - order.produced);

  const allMats = detail ? [...detail.raw, ...detail.pkg] : [];
  const cogs = allMats.reduce((sum, m) => sum + m.qty * m.rate, 0);
  const costPerUnit = order.qty > 0 ? Math.round(cogs / order.qty) : 0;

  const saveProduction = () => {
    const val = Math.max(0, Math.min(order.qty, parseInt(recordQty, 10) || 0));
    onUpdate(order.id, { produced: val, status: val >= order.qty ? 'completed' : 'in-progress' });
  };

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

        {/* Production Output */}
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: 16, marginBottom: 14, boxShadow: T.shadowSm }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 8 }}>
            <div style={{ flex: 1 }}>
              {detail?.outputCode && <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody }}>{detail.outputCode}</div>}
              <div style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, marginTop: 1 }}>{order.item}</div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '3px 10px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>{s.label}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'center', borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
            {[['Order Qty', order.qty, T.textPrimary], ['Produced', order.produced, T.textPrimary], ['Remaining', remaining, remaining > 0 ? T.statusPending : T.statusApproved]].map(([l, v, c]) => (
              <div key={l} style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: c, fontFamily: T.fontBody, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ paddingTop: 12 }}>
            <ProgressBar produced={order.produced} qty={order.qty} />
          </div>
        </div>

        {/* Production Information */}
        {detail && (
          <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 16px', marginBottom: 14, boxShadow: T.shadowSm }}>
            <SectionLabel>Production Information</SectionLabel>
            {[['Date', detail.date], ['Office', detail.office], ['Warehouse', detail.warehouse], ['Section', order.section], ['Flight', order.flight], ['Due By', order.dueBy], ['BOM', detail.bom]].map(([l, v], i) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: i === 0 ? 0 : 8, paddingBottom: 8, borderTop: i === 0 ? 'none' : `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody, maxWidth: '60%', textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* Material Requirements */}
        {detail && (
          <div style={{ marginBottom: 14 }}>
            <SectionLabel>Material Requirements</SectionLabel>
            <MaterialTable title="Raw Materials" rows={detail.raw} />
            <MaterialTable title="Packaging Materials" rows={detail.pkg} />
          </div>
        )}

        {/* Material Cost (COGS) */}
        {detail && (
          <div style={{ marginBottom: 14 }}>
            <SectionLabel>Material Cost (COGS)</SectionLabel>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, background: T.primaryLight, border: `1px solid ${T.primary}30`, borderRadius: T.radiusMd, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total COGS · {order.qty} units</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.primary, fontFamily: T.fontBody, marginTop: 3 }}>৳ {money(cogs)}</div>
              </div>
              <div style={{ flex: 1, background: T.bgSubtle, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cost per Unit</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, marginTop: 3 }}>৳ {money(costPerUnit)}</div>
              </div>
            </div>
          </div>
        )}

        {/* ── Flow ────────────────────────────────────────────────────────── */}
        {order.status === 'pending' && (
          <button
            onClick={() => onUpdate(order.id, { status: 'in-progress' })}
            style={{ width: '100%', padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}
          >
            Start Production
          </button>
        )}

        {order.status === 'in-progress' && (
          <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '14px 16px', boxShadow: T.shadowSm }}>
            <SectionLabel>Record Production</SectionLabel>
            <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 8 }}>Enter total produced quantity (target {order.qty}). The order completes when fully produced.</div>
            <input
              type="number" min={0} max={order.qty} value={recordQty}
              onChange={e => setRecordQty(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 14, fontFamily: T.fontBody, background: T.bgBase, color: T.textPrimary, outline: 'none', marginBottom: 10 }}
            />
            <button
              onClick={saveProduction}
              style={{ width: '100%', padding: '12px 0', background: T.statusInfo, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}
            >
              Save Production
            </button>
          </div>
        )}

        {order.status === 'completed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusMd, padding: '12px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>Production Complete ✓</div>
            </div>
            {!forwardedToQC ? (
              <button
                onClick={() => {
                  qcStore.add({ id: `QC-PROD-${order.id}`, item: order.item, flight: order.flight, section: order.section, qty: `${order.qty} units` });
                  setForwardedToQC(true);
                }}
                style={{ width: '100%', padding: '13px 0', background: T.statusInfo, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}
              >
                Forward to QC
              </button>
            ) : (
              <div style={{ background: T.statusInfoBg, border: `1px solid ${T.statusInfo}30`, borderRadius: T.radiusMd, padding: '12px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.statusInfo, fontFamily: T.fontBody }}>Forwarded to QC ✓</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProductionScreen({ nav }) {
  const [orders, setOrders]   = useState(() => MOCK_PRODUCTION_ORDERS.map(o => ({ ...o })));
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch]   = useState('');
  const [todayOnly, setTodayOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const updateOrder = (id, patch) => setOrders(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));

  const selected = orders.find(o => o.id === selectedId);
  if (selected) return <OrderDetail order={selected} onBack={() => setSelectedId(null)} onUpdate={updateOrder} />;

  const completed  = orders.filter(o => o.status === 'completed').length;
  const inProgress = orders.filter(o => o.status === 'in-progress').length;
  const pending    = orders.filter(o => o.status === 'pending').length;

  const q = search.trim().toLowerCase();
  const todayStr = new Date().toISOString().slice(0, 10);
  const bySearch = (o) => !q || [o.item, o.id, o.section, o.flight].some(v => (v || '').toLowerCase().includes(q));
  const byDate   = (o) => todayOnly ? true : ((!dateFrom || todayStr >= dateFrom) && (!dateTo || todayStr <= dateTo));
  const byStatus = (o) => statusFilter === 'all' || o.status === statusFilter;
  const filtered = orders.filter(o => bySearch(o) && byDate(o) && byStatus(o));

  const inputStyle = { boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, background: T.bgSurface, color: T.textPrimary, fontFamily: T.fontBody, outline: 'none' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.resetTo('home')} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Production</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{orders.length} orders today</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
          {[['Done', completed, T.statusApproved, T.statusApprovedBg], ['Active', inProgress, T.statusInfo, T.statusInfoBg], ['Pending', pending, T.statusPending, T.statusPendingBg]].map(([label, val, color, bg]) => (
            <div key={label} style={{ background: bg, border: `1px solid ${color}20`, borderRadius: T.radiusMd, padding: '10px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: T.fontBody }}>{val}</div>
              <div style={{ fontSize: 11, color, fontFamily: T.fontBody, marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── Filters: search · today · date range · status ─────────────────── */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ position: 'absolute', left: 12, fontSize: 14, color: T.textTertiary, pointerEvents: 'none' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search order, item, section…"
            style={{ ...inputStyle, width: '100%', padding: '10px 12px 10px 34px', borderRadius: T.radiusFull, fontSize: 13 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setTodayOnly(v => { const nv = !v; if (nv) { setDateFrom(''); setDateTo(''); } return nv; })}
            style={{ padding: '7px 14px', borderRadius: T.radiusFull, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody,
              border: `1px solid ${todayOnly ? T.primary : T.border}`, background: todayOnly ? T.primary : T.bgSurface, color: todayOnly ? '#fff' : T.textSecondary }}>
            Today
          </button>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setTodayOnly(false); }} style={{ ...inputStyle, flex: 1, minWidth: 0, padding: '7px 8px', fontSize: 11 }} />
          <span style={{ fontSize: 12, color: T.textTertiary }}>–</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setTodayOnly(false); }} style={{ ...inputStyle, flex: 1, minWidth: 0, padding: '7px 8px', fontSize: 11 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ ...inputStyle, flex: 1, padding: '8px 10px', fontSize: 12 }}>
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="in-progress">In Progress</option>
            <option value="pending">Pending</option>
          </select>
          {(search || todayOnly || dateFrom || dateTo || statusFilter !== 'all') && (
            <span onClick={() => { setSearch(''); setTodayOnly(false); setDateFrom(''); setDateTo(''); setStatusFilter('all'); }}
              style={{ fontSize: 11, fontWeight: 600, color: T.textTertiary, fontFamily: T.fontBody, cursor: 'pointer' }}>Clear</span>
          )}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Production Orders</div>

        {/* Approvals-style cards */}
        {filtered.map((order) => {
          const s = STATUS_MAP[order.status] || STATUS_MAP.pending;
          return (
            <div
              key={order.id}
              onClick={() => setSelectedId(order.id)}
              style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
                  <div style={{ width: 36, height: 36, borderRadius: T.radiusMd, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🏭</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{order.item}</div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{order.id} · {order.section} · Due {order.dueBy}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{s.label}</span>
                  <span style={{ fontSize: 14, color: T.textTertiary }}>›</span>
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: T.textTertiary, fontFamily: T.fontBody, fontSize: 13 }}>No production orders match.</div>
        )}
      </div>
    </div>
  );
}
