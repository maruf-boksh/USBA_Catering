import { useState } from 'react';
import { T } from '../theme';
import { MOCK_STOCK, MOCK_RETURNS } from '../mockData';

const BACK_BTN = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const INPUT = { boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, background: T.bgSurface, color: T.textPrimary, fontFamily: T.fontBody, outline: 'none' };

const RETURN_STATUS = {
  pending:   { color: T.statusPending,  bg: T.statusPendingBg,  label: 'Pending'   },
  received:  { color: T.statusApproved, bg: T.statusApprovedBg, label: 'Received'  },
  forwarded: { color: T.statusInfo,     bg: T.statusInfoBg,     label: 'Forwarded' },
};

// ── Return detail ────────────────────────────────────────────────────────────
function ReturnDetail({ record, onBack, onComplete, onOpenDoc }) {
  const st = RETURN_STATUS[record.status] || RETURN_STATUS.pending;
  const isAirport = record.dest === 'airport';
  const totalQty = record.lines.reduce((s, l) => s + l.qty, 0);
  const totalReuse = record.lines.reduce((s, l) => s + (l.reusable || 0), 0);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onBack} style={BACK_BTN}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Return Details</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{record.id}</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 16px', marginBottom: 12, boxShadow: T.shadowSm }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{record.flight} · {record.sector}</div>
            <span style={{ fontSize: 10, fontWeight: 700, color: st.color, background: st.bg, padding: '3px 10px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{st.label}</span>
          </div>
          {[['Return No.', record.id], ['Date', record.date], ['Returned By', record.returnedBy], ['Destination', isAirport ? 'Airport Store' : 'Inventory & Store'], ['Total Qty', `${totalQty}`], ['Reusable', `${totalReuse}`]].map(([l, v], i) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: i === 0 ? 4 : 8, paddingBottom: 8, borderTop: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
              {l === 'Return No.' ? (
                <span onClick={() => onOpenDoc(record.id)}
                  style={{ fontSize: 12, fontWeight: 700, color: T.statusInfo, fontFamily: T.fontBody, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                  {v} ↗
                </span>
              ) : (
                <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
              )}
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Returned Items ({record.lines.length})</div>
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, overflow: 'hidden', marginBottom: 14, boxShadow: T.shadowSm }}>
          {record.lines.map((l, i) => (
            <div key={l.item} style={{ padding: '10px 14px', borderTop: i === 0 ? 'none' : `1px solid ${T.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{l.item}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{l.qty} {l.uom}</span>
              </div>
              <div style={{ fontSize: 10, color: (l.reusable || 0) > 0 ? T.statusApproved : T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                Reusable: {l.reusable || 0} {l.uom}{(l.reusable || 0) === 0 ? ' · disposed' : ''}
              </div>
            </div>
          ))}
        </div>

        {record.status === 'pending' ? (
          <button
            onClick={() => onComplete(record.id, isAirport ? 'forwarded' : 'received')}
            style={{ width: '100%', padding: '13px 0', background: isAirport ? T.statusInfo : T.statusApproved, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}
          >
            {isAirport ? 'Forward to Airport Store' : 'Receive to Store'}
          </button>
        ) : (
          <div style={{ background: st.bg, border: `1px solid ${st.color}30`, borderRadius: T.radiusMd, padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: st.color, fontFamily: T.fontBody }}>
              {record.status === 'received' ? 'Reusable items received into store ✓' : 'Forwarded to airport store ✓'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Return document (web "View" functionality) — full read-only detail ───────
function ReturnDocPage({ record, onBack }) {
  const st = RETURN_STATUS[record.status] || RETURN_STATUS.pending;
  const isAirport = record.dest === 'airport';
  const totalQty = record.lines.reduce((s, l) => s + l.qty, 0);
  const totalReuse = record.lines.reduce((s, l) => s + (l.reusable || 0), 0);
  const disposed = totalQty - totalReuse;

  // Return lifecycle — mirrors the web consumable-return view status timeline.
  const steps = isAirport
    ? [['Returned at Airport', true], ['Reusable Verified', true], ['Forwarded to Airport Store', record.status === 'forwarded']]
    : [['Returned to Store', true], ['Reusable Verified', true], ['Received into Inventory', record.status === 'received']];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onBack} style={BACK_BTN}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Consumable Return</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{record.id}</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>
        {/* Return summary */}
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 16px', marginBottom: 12, boxShadow: T.shadowSm }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Return Summary</div>
          {[['Return No.', record.id], ['Status', st.label], ['Flight', record.flight], ['Sector', record.sector], ['Date', record.date], ['Returned By', record.returnedBy], ['Destination', isAirport ? 'Airport Store' : 'Inventory & Store']].map(([l, v], i) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: i === 0 ? 0 : 8, paddingBottom: 8, borderTop: i === 0 ? 'none' : `1px solid ${T.border}` }}>
              <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: l === 'Status' ? st.color : T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Line items with condition */}
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Items ({record.lines.length})</div>
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, overflow: 'hidden', marginBottom: 12, boxShadow: T.shadowSm }}>
          {record.lines.map((l, i) => {
            const good = (l.reusable || 0) > 0;
            return (
              <div key={l.item} style={{ padding: '10px 14px', borderTop: i === 0 ? 'none' : `1px solid ${T.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{l.item}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{l.qty} {l.uom}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                  <span style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody }}>Reusable {l.reusable || 0} · Disposed {l.qty - (l.reusable || 0)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: good ? T.statusApproved : T.statusRejected, fontFamily: T.fontBody }}>{good ? 'Good — reusable' : 'Damaged — disposed'}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Reusable roll-up */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          {[['Total Returned', totalQty, T.textPrimary], ['Reusable', totalReuse, T.statusApproved], ['Disposed', disposed, T.statusRejected]].map(([l, v, c]) => (
            <div key={l} style={{ flex: 1, background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 6px', textAlign: 'center', boxShadow: T.shadowSm }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: c, fontFamily: T.fontBody }}>{v}</div>
              <div style={{ fontSize: 9, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>

        {/* Lifecycle */}
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Lifecycle</div>
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 16px', boxShadow: T.shadowSm }}>
          {steps.map(([label, done], i) => (
            <div key={label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingTop: i === 0 ? 0 : 10 }}>
              <div style={{ width: 20, height: 20, borderRadius: T.radiusFull, flexShrink: 0, background: done ? T.statusApproved : T.border, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {done && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: done ? T.textPrimary : T.textTertiary, fontFamily: T.fontBody, paddingTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StockScreen({ nav }) {
  const [mainTab, setMainTab]   = useState('stock');   // 'stock' | 'returns'
  const [returnTab, setReturnTab] = useState('inventory'); // 'inventory' | 'airport'
  const [returns, setReturns]   = useState(() => MOCK_RETURNS.map(r => ({ ...r })));
  const [selectedId, setSelectedId] = useState(null);
  const [docId, setDocId]       = useState(null);
  const [search, setSearch]     = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  const low = MOCK_STOCK.filter(s => s.status === 'low').length;

  const completeReturn = (id, status) => {
    setReturns(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    setSelectedId(null);
  };

  const docRecord = returns.find(r => r.id === docId);
  if (docRecord) return <ReturnDocPage record={docRecord} onBack={() => setDocId(null)} />;

  const selected = returns.find(r => r.id === selectedId);
  if (selected) return <ReturnDetail record={selected} onBack={() => setSelectedId(null)} onComplete={completeReturn} onOpenDoc={setDocId} />;

  const q = search.trim().toLowerCase();
  const visibleReturns = returns.filter(r => {
    if (r.dest !== returnTab) return false;
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    if (q && ![r.id, r.flight, r.sector, r.returnedBy, ...r.lines.map(l => l.item)].some(v => (v || '').toLowerCase().includes(q))) return false;
    return true;
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.resetTo('home')} style={BACK_BTN}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Stock Overview</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{low} low-stock items</div>
        </div>
      </div>

      {/* Top-level tabs */}
      <div style={{ display: 'flex', background: T.bgSurface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        {[['stock', 'Stock'], ['returns', 'Return Items']].map(([key, label]) => (
          <button key={key} onClick={() => setMainTab(key)}
            style={{ flex: 1, padding: '10px 0', fontFamily: T.fontBody, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              color: mainTab === key ? T.primary : T.textTertiary, background: 'none', border: 'none',
              borderBottom: mainTab === key ? `2px solid ${T.primary}` : '2px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {mainTab === 'stock' && (
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
      )}

      {mainTab === 'returns' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Return sub-tabs */}
          <div style={{ display: 'flex', gap: 8, padding: '10px 14px 6px', flexShrink: 0 }}>
            {[['inventory', 'Inventory & Store'], ['airport', 'Airport Items']].map(([key, label]) => {
              const active = returnTab === key;
              return (
                <button key={key} onClick={() => setReturnTab(key)}
                  style={{ flex: 1, padding: '8px 0', borderRadius: T.radiusFull, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody,
                    border: `1px solid ${active ? T.primary : T.border}`, background: active ? T.primary : T.bgSurface, color: active ? '#fff' : T.textSecondary }}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* Search + date range */}
          <div style={{ padding: '0 14px 6px', flexShrink: 0 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ position: 'absolute', left: 12, fontSize: 13, color: T.textTertiary, pointerEvents: 'none' }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search return, flight, item…"
                style={{ ...INPUT, width: '100%', padding: '9px 12px 9px 32px', borderRadius: T.radiusFull, fontSize: 12 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...INPUT, flex: 1, minWidth: 0, padding: '7px 8px', fontSize: 11 }} />
              <span style={{ fontSize: 12, color: T.textTertiary }}>–</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...INPUT, flex: 1, minWidth: 0, padding: '7px 8px', fontSize: 11 }} />
              {(search || dateFrom || dateTo) && (
                <span onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); }} style={{ fontSize: 11, fontWeight: 600, color: T.textTertiary, fontFamily: T.fontBody, cursor: 'pointer' }}>Clear</span>
              )}
            </div>
          </div>

          {/* Approvals-style cards */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 14px 16px' }}>
            {visibleReturns.map(r => {
              const st = RETURN_STATUS[r.status] || RETURN_STATUS.pending;
              return (
                <div key={r.id} onClick={() => setSelectedId(r.id)}
                  style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
                      <div style={{ width: 36, height: 36, borderRadius: T.radiusMd, background: st.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>↩️</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{r.flight} · {r.sector}</div>
                        <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{r.id} · {r.returnedBy} · {r.lines.length} item{r.lines.length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: st.color, background: st.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{st.label}</span>
                      <span style={{ fontSize: 14, color: T.textTertiary }}>›</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {visibleReturns.length === 0 && (
              <div style={{ textAlign: 'center', padding: 32, color: T.textTertiary, fontFamily: T.fontBody, fontSize: 13 }}>No returns match.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
