import { useMemo, useState } from 'react';
import { T } from '../theme';
import { KPICard } from '../components/KPICard';
// Stock Overview on the phone, on the WEB's own inventory — the same
// "inventory-items" store routes/inventory.tsx persists to, so a receipt
// approved on the phone or the desk moves the number here immediately.
//
// Availability is stock − blocked (a batch held for QC is on hand but not
// usable), and the OK / Low / Critical bands are the web's own reorder rules.
import { inventory } from '@/lib/sample-data';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };
const CARD = { background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm };
const SECTION = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 2px 8px' };

const INV_KEY = 'harvest-data-v1:inventory-items';

const STATUS = {
  OK:       { label: 'OK',       color: T.statusApproved, bg: T.statusApprovedBg },
  Low:      { label: 'Low',      color: T.statusPending,  bg: T.statusPendingBg },
  Critical: { label: 'Critical', color: T.statusRejected, bg: T.statusRejectedBg },
};

const num = (v) => Number(v) || 0;
const fmt = (n) => num(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

function readItems() {
  try {
    const raw = localStorage.getItem(INV_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return Array.isArray(saved) && saved.length > 0 ? saved : inventory;
  } catch { return inventory; }
}

/** Usable stock — what is on hand minus anything held for QC. */
const availableOf = (it) => Math.max(0, num(it.stock) - num(it.blockedQty));
/** The web's own band: Critical under half the reorder point, Low under it. */
const bandOf = (it) => {
  if (it.status && STATUS[it.status]) return it.status;
  const r = num(it.reorder);
  if (r <= 0) return 'OK';
  return num(it.stock) < r * 0.5 ? 'Critical' : num(it.stock) < r ? 'Low' : 'OK';
};

function Chip({ label, color, bg }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>
      {label}
    </span>
  );
}

function Empty({ icon, text }) {
  return (
    <div style={{ textAlign: 'center', padding: '46px 0' }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody, padding: '0 24px' }}>{text}</div>
    </div>
  );
}

function Row({ label, value }) {
  const v = String(value ?? '').trim();
  if (v === '') return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '7px 0', borderTop: `1px solid ${T.border}` }}>
      <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

export function StockScreen({ nav }) {
  const items = useMemo(() => readItems(), []);
  const [view, setView]     = useState('list');   // 'list' | 'detail'
  const [activeId, setActiveId] = useState(null);
  const [query, setQuery]   = useState('');
  const [filter, setFilter] = useState('all');

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(),
    [items],
  );

  const lowCount = items.filter((i) => bandOf(i) === 'Low').length;
  const critCount = items.filter((i) => bandOf(i) === 'Critical').length;
  const blocked = items.reduce((s, i) => s + num(i.blockedQty), 0);

  const visible = items.filter((i) => {
    const band = bandOf(i);
    if (filter === 'low' && band === 'OK') return false;
    if (filter === 'critical' && band !== 'Critical') return false;
    if (filter === 'blocked' && num(i.blockedQty) <= 0) return false;
    if (filter !== 'all' && ['low', 'critical', 'blocked'].indexOf(filter) === -1 && i.category !== filter) return false;
    if (!query.trim()) return true;
    return `${i.name} ${i.category} ${i.batch ?? ''} ${i.storage ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  // Anything short floats to the top — the reason to open this screen.
  const sorted = [...visible].sort((a, b) => {
    const rank = { Critical: 0, Low: 1, OK: 2 };
    return (rank[bandOf(a)] - rank[bandOf(b)]) || a.name.localeCompare(b.name);
  });

  const activeItem = items.find((i) => i.id === activeId) ?? null;

  // ── Item detail ───────────────────────────────────────────────────────────
  if (view === 'detail' && activeItem) {
    const it = activeItem;
    const band = bandOf(it);
    const s = STATUS[band];
    const avail = availableOf(it);
    const lots = it.batches ?? [];
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{it.name}</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{it.id} · {it.category}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          <div style={CARD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                {fmt(avail)} <span style={{ fontSize: 12, fontWeight: 400, color: T.textTertiary }}>{it.uom} available</span>
              </span>
              <Chip label={s.label} color={s.color} bg={s.bg} />
            </div>
            <Row label="On Hand" value={`${fmt(it.stock)} ${it.uom}`} />
            {num(it.blockedQty) > 0 && <Row label="Held For QC" value={`${fmt(it.blockedQty)} ${it.uom}`} />}
            {it.blockedReason && <Row label="Hold Reason" value={it.blockedReason} />}
            <Row label="Reorder Level" value={`${fmt(it.reorder)} ${it.uom}`} />
            <Row label="Storage" value={it.storage} />
            <Row label="Batch" value={it.batch} />
            <Row label="Expiry" value={it.expiry} />
          </div>

          {/* Cover against the reorder point, read at a glance */}
          <div style={CARD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Against Reorder
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: s.color, fontFamily: T.fontBody }}>
                {num(it.reorder) > 0 ? `${Math.round((num(it.stock) / num(it.reorder)) * 100)}%` : '—'}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: T.radiusFull, background: T.bgSubtle, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, num(it.reorder) > 0 ? (num(it.stock) / num(it.reorder)) * 100 : 100)}%`, height: '100%', background: s.color }} />
            </div>
          </div>

          {lots.length > 0 && (
            <>
              <div style={SECTION}>Batches / Lots ({lots.length})</div>
              <div style={CARD}>
                {lots.map((b, i) => (
                  <div key={b.batchNo ?? i} style={{ padding: '9px 0', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{b.batchNo ?? '—'}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{fmt(b.qty)} {it.uom}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 3 }}>
                      {b.expiry && <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>Exp {b.expiry}</span>}
                      {b.receivedAt && <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>Recv {b.receivedAt}</span>}
                      {num(b.blockedQty) > 0 && (
                        <Chip label={`${fmt(b.blockedQty)} held`} color={T.statusPending} bg={T.statusPendingBg} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── List ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Stock Overview</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
            {items.length} items · {lowCount + critCount} need attention
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <KPICard label="Total Items" value={items.length} sub="In the store"     accent={T.statusInfo} />
          <KPICard label="Low Stock"   value={lowCount}     sub="Under reorder"    accent={T.statusPending} />
          <KPICard label="Critical"    value={critCount}    sub="Order now"        accent={T.statusRejected} />
          <KPICard label="Held For QC" value={fmt(blocked)} sub="Not usable yet"   accent={T.statusBoarding} />
        </div>

        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search item, category, batch…" style={{ ...INPUT, marginTop: 12 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 0' }}>
          <button onClick={() => setFilter('all')}
            style={{ flexShrink: 0, padding: '8px 14px', borderRadius: T.radiusFull, border: `1px solid ${filter === 'all' ? T.primary : T.border}`, background: filter === 'all' ? T.primary : T.bgSurface, color: filter === 'all' ? '#fff' : T.textTertiary, fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
            All
          </button>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ ...INPUT, flex: 1, minWidth: 0, padding: '9px 10px', fontSize: 12, fontWeight: 700 }}>
            <option value="all">All items</option>
            <option value="low">Needs attention (Low + Critical)</option>
            <option value="critical">Critical only</option>
            <option value="blocked">Held for QC</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div style={{ ...SECTION, marginTop: 12 }}>
          {sorted.length} of {items.length} items
        </div>

        {sorted.length === 0 ? (
          <Empty icon="📦" text="No items match the current filter." />
        ) : sorted.map((it) => {
          const band = bandOf(it);
          const s = STATUS[band];
          const avail = availableOf(it);
          const pct = num(it.reorder) > 0 ? Math.min(100, (num(it.stock) / num(it.reorder)) * 100) : 100;
          return (
            <div key={it.id} onClick={() => { setActiveId(it.id); setView('detail'); }} style={{ ...CARD, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{it.name}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                    {it.category}{it.storage ? ` · ${it.storage}` : ''}
                  </div>
                </div>
                <Chip label={s.label} color={s.color} bg={s.bg} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6, marginBottom: 5 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                  {fmt(avail)} <span style={{ fontSize: 11, fontWeight: 400, color: T.textTertiary }}>{it.uom}</span>
                </span>
                <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                  reorder {fmt(it.reorder)}
                </span>
              </div>
              <div style={{ height: 5, borderRadius: T.radiusFull, background: T.bgSubtle, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: s.color }} />
              </div>

              {num(it.blockedQty) > 0 && (
                <div style={{ fontSize: 11, color: T.statusPending, fontFamily: T.fontBody, marginTop: 7 }}>
                  {fmt(it.blockedQty)} {it.uom} held for QC — not available to issue
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
