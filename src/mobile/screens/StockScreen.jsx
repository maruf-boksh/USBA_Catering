import { useState, useMemo } from 'react';
import { T } from '../theme';
import { loadStockOverviewRows, stockOverviewSummary } from '@/lib/stock-overview';
import { findInventoryRow, lotIsBlocked } from '@/lib/inventory-store';
import { getItemStockByWarehouse } from '@/lib/inventory-stock';
import { buildItemLedger } from '@/lib/stock-ledger';
import { getStockAdjustments } from '@/lib/stock-adjustments';
import { useWorkflow } from '@/lib/workflow-store';
import { roundQty } from '@/lib/num';

// Mobile Stock Overview — the web /inventory report on a phone. Rows come from
// `lib/stock-overview.ts`, the headless projection of that report, so the two
// screens can never disagree.
//
// Tapping a row opens the item detail view (StockDetail below), the phone
// version of the web report's "Item Details" drill-down: balance breakdown,
// per-warehouse holdings, batch/lot list and the movement ledger from
// `lib/stock-ledger.ts`. Same sources as the web page — nothing mocked.
//
// Consumable returns are NOT here: the Return Log screen (More → Galley
// Planning) owns them and works against the real returns store. This screen
// used to carry a duplicate "Return Items" tab backed by mock data.

const BACK_BTN = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

/** Status colours, shared by the list rows and the detail header. */
function toneFor(status) {
  if (status === 'Critical') return { fg: T.statusRejected, bg: T.statusRejectedBg };
  if (status === 'Low')      return { fg: T.statusDelayed,  bg: T.statusDelayedBg };
  return { fg: T.statusApproved, bg: T.statusApprovedBg };
}

const qty = (n) => roundQty(n).toLocaleString();
const money = (n) => `৳${Math.round(n).toLocaleString()}`;

export function StockScreen({ nav }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | 'Critical' | 'Low' | 'Held'
  const [selected, setSelected] = useState(null);

  // Read once per mount, like the web page: usePersistedState doesn't broadcast
  // same-tab writes either, so both refresh when you next open them.
  const rows    = useMemo(() => loadStockOverviewRows(), []);
  const summary = useMemo(() => stockOverviewSummary(rows), [rows]);

  // Movement ledger sources — the same four the web report stitches together.
  // The mobile app renders inside the WorkflowProvider (AppLayout), so the
  // in-memory GRN / transfer / production slices are readable here.
  const { grns, transferNotes, stockDeltas } = useWorkflow();
  const ledgerSources = useMemo(
    () => ({ grns, transferNotes, stockDeltas, adjustments: getStockAdjustments() }),
    [grns, transferNotes, stockDeltas],
  );

  const q = search.trim().toLowerCase();
  const visible = rows.filter(r => {
    if (filter === 'Held' ? r.held <= 0 : filter !== 'all' && r.status !== filter) return false;
    if (q && ![r.name, r.id, r.category, r.itemType].some(v => (v || '').toLowerCase().includes(q))) return false;
    return true;
  });

  if (selected) {
    return <StockDetail item={selected} ledgerSources={ledgerSources} onBack={() => setSelected(null)} />;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.resetTo('home')} style={BACK_BTN}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Stock Overview</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
            {summary.critical} critical · {summary.low} low
          </div>
        </div>
      </div>

      {/* Report KPIs — same figures as the web Stock Overview cards. */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 14px 0', flexShrink: 0 }}>
        {[
          ['Items',    summary.totalItems.toLocaleString(),   T.textPrimary],
          ['Low',      summary.low.toLocaleString(),          T.statusDelayed],
          ['Critical', summary.critical.toLocaleString(),     T.statusRejected],
          ['Near Exp', summary.nearExpiry30.toLocaleString(), T.statusPending],
        ].map(([label, value, colour]) => (
          <div key={label} style={{ flex: 1, minWidth: 0, background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '8px 4px', textAlign: 'center', boxShadow: T.shadowSm }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: colour, fontFamily: T.fontBody }}>{value}</div>
            <div style={{ fontSize: 9, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Valuation gets its own row — the full figure never fits in a tile. */}
      <div style={{ margin: '8px 14px 0', background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '9px 12px', boxShadow: T.shadowSm, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Stock Value</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: T.statusApproved, fontFamily: T.fontBody }}>
          ৳ {Math.round(summary.totalValue).toLocaleString()}
        </span>
      </div>

      {/* Search + status filter */}
      <div style={{ padding: '8px 14px 0', flexShrink: 0 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ position: 'absolute', left: 12, fontSize: 13, color: T.textTertiary, pointerEvents: 'none' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item, code, category…"
            style={{ boxSizing: 'border-box', border: `1px solid ${T.border}`, background: T.bgSurface, color: T.textPrimary, fontFamily: T.fontBody, outline: 'none', width: '100%', padding: '9px 12px 9px 32px', borderRadius: T.radiusFull, fontSize: 12 }} />
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {[['all', `All (${rows.length})`], ['Critical', `Critical (${summary.critical})`], ['Low', `Low (${summary.low})`], ['Held', `Held (${summary.heldItems})`]].map(([key, label]) => {
            const active = filter === key;
            return (
              <button key={key} onClick={() => setFilter(key)}
                style={{ flexShrink: 0, padding: '6px 12px', borderRadius: T.radiusFull, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: T.fontBody,
                  border: `1px solid ${active ? T.primary : T.border}`, background: active ? T.primary : T.bgSurface, color: active ? '#fff' : T.textSecondary }}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 14px 16px' }}>
        {visible.map((item) => {
          const tone = toneFor(item.status);
          return (
            <div key={item.id} onClick={() => setSelected(item)} role="button"
              style={{ background: T.bgSurface, border: `1px solid ${item.status === 'OK' ? T.border : tone.fg + '40'}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                    {item.id} · {item.category || item.itemType || '—'}
                    {item.value > 0 ? ` · ${money(item.value)}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: tone.fg, background: tone.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>
                    {item.status}
                  </span>
                  <span style={{ fontSize: 14, color: T.textDisabled, lineHeight: 1 }}>›</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: item.status === 'OK' ? T.textPrimary : tone.fg, fontFamily: T.fontBody }}>
                  {qty(item.stock)} <span style={{ fontSize: 11, fontWeight: 400, color: T.textTertiary }}>{item.uom}</span>
                </div>
                {item.reorder > 0 && (
                  <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody }}>Reorder {qty(item.reorder)}</div>
                )}
              </div>
              {item.held > 0 && (
                <div style={{ fontSize: 10, fontWeight: 700, color: T.statusPending, background: T.statusPendingBg, borderRadius: T.radiusFull, padding: '2px 8px', fontFamily: T.fontBody, marginTop: 6, display: 'inline-block' }}>
                  🔒 {qty(item.held)} held for QC · {qty(item.available)} usable
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: T.textTertiary, fontFamily: T.fontBody, fontSize: 13 }}>No stock items match.</div>
        )}
      </div>
    </div>
  );
}

// ── Item detail ─────────────────────────────────────────────────────────────

const CARD = { background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, boxShadow: T.shadowSm, marginTop: 10, overflow: 'hidden' };
const SECTION_TITLE = { fontSize: 10, fontWeight: 800, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '10px 14px 0' };

function Fact({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '7px 14px', borderTop: `1px solid ${T.border}` }}>
      <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

const DAY = 86400000;
const isoToday = () => new Date().toISOString().slice(0, 10);

/** Expiry tone: red once expired, amber inside 30 days, plain otherwise. */
function expiryTone(expiry) {
  if (!expiry || expiry === '—') return null;
  const today = isoToday();
  if (expiry < today) return { fg: T.statusRejected, bg: T.statusRejectedBg, label: 'Expired' };
  const cutoff = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
  if (expiry <= cutoff) return { fg: T.statusPending, bg: T.statusPendingBg, label: 'Near expiry' };
  return null;
}

function StockDetail({ item, ledgerSources, onBack }) {
  const [allMoves, setAllMoves] = useState(false);
  const tone = toneFor(item.status);

  // Batch lots live on the persisted stock row, not on the report projection.
  const lots = useMemo(() => {
    const row = findInventoryRow(item.id) ?? findInventoryRow(item.name);
    const batches = Array.isArray(row?.batches) ? row.batches : [];
    // FEFO order — what will be drawn down first sits at the top.
    return [...batches].sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));
  }, [item]);

  const warehouseRows = useMemo(() => getItemStockByWarehouse(item.id), [item]);

  // Weighted-average cost across the lots; the report's `value` is the lot sum,
  // so this is only shown when there is a cost basis to average.
  const avgCost = useMemo(() => {
    const totalQty = lots.reduce((s, b) => s + (Number(b.qty) || 0), 0);
    if (totalQty <= 0) return 0;
    return lots.reduce((s, b) => s + (Number(b.qty) || 0) * (Number(b.costPrice) || 0), 0) / totalQty;
  }, [lots]);

  // Same ledger the web "Item Details" drill-down renders — quantities only, so
  // the movements are costed at 0 and no value column is shown on the phone.
  const ledger = useMemo(
    () => buildItemLedger(item.id, item.name, item.stock, 0, () => 0, ledgerSources),
    [item, ledgerSources],
  );
  const moves = useMemo(() => ledger.rows.slice(1).reverse(), [ledger]); // newest first, minus the opening row
  const shownMoves = allMoves ? moves : moves.slice(0, 6);

  // Usable stock against the reorder level, for the health bar.
  const barPct = item.reorder > 0
    ? Math.max(2, Math.min(100, (item.available / (item.reorder * 1.2)) * 100))
    : 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onBack} style={BACK_BTN}>←</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{item.id}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
        {/* Balance hero */}
        <div style={{ ...CARD, marginTop: 0, padding: '14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.05em' }}>On hand</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: T.textPrimary, fontFamily: T.fontBody, lineHeight: 1.15, marginTop: 2 }}>
              {qty(item.stock)} <span style={{ fontSize: 12, fontWeight: 500, color: T.textTertiary }}>{item.uom}</span>
            </div>
            <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 3 }}>
              {item.category || item.itemType || '—'}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: tone.fg, background: tone.bg, padding: '3px 9px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{item.status}</span>
            {item.value > 0 && (
              <div style={{ fontSize: 13, fontWeight: 800, color: T.statusApproved, fontFamily: T.fontBody, marginTop: 8 }}>{money(item.value)}</div>
            )}
          </div>
        </div>

        {/* Held / usable / reorder split */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {[
            ['Held for QC', qty(item.held),      item.held > 0 ? T.statusPending : T.textTertiary],
            ['Usable',      qty(item.available), item.available > 0 ? T.statusApproved : T.statusRejected],
            ['Reorder',     item.reorder > 0 ? qty(item.reorder) : '—', T.textPrimary],
          ].map(([label, value, colour]) => (
            <div key={label} style={{ flex: 1, minWidth: 0, background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '9px 4px', textAlign: 'center', boxShadow: T.shadowSm }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: colour, fontFamily: T.fontBody }}>{value}</div>
              <div style={{ fontSize: 9, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        {item.held > 0 && (
          <div style={{ marginTop: 10, background: T.statusPendingBg, border: `1px solid ${T.statusPending}33`, borderRadius: T.radiusMd, padding: '9px 12px', fontSize: 11, color: T.statusPending, fontFamily: T.fontBody, fontWeight: 600 }}>
            🔒 {qty(item.held)} {item.uom} is held for QC and cannot be issued — {qty(item.available)} usable.
          </div>
        )}

        {/* Usable vs reorder level */}
        {item.reorder > 0 && (
          <div style={{ ...CARD, padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 6 }}>
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800 }}>Usable vs reorder</span>
              <span>{qty(item.available)} / {qty(item.reorder)} {item.uom}</span>
            </div>
            <div style={{ height: 7, borderRadius: T.radiusFull, background: T.bgSubtle, border: `1px solid ${T.border}`, overflow: 'hidden' }}>
              <div style={{ width: `${barPct}%`, height: '100%', background: tone.fg, borderRadius: T.radiusFull }} />
            </div>
          </div>
        )}

        {/* Item facts */}
        <div style={CARD}>
          <div style={SECTION_TITLE}>Item</div>
          <div style={{ marginTop: 8 }}>
            <Fact label="Item code"  value={item.id} />
            <Fact label="Item type"  value={item.itemType || '—'} />
            <Fact label="Category"   value={item.category || '—'} />
            <Fact label="Storage"    value={item.storage || '—'} />
            <Fact label="UoM"        value={item.uom || '—'} />
            {avgCost > 0 && <Fact label="Avg cost" value={`${money(avgCost)} / ${item.uom}`} />}
          </div>
        </div>

        {/* Per-warehouse holdings */}
        {warehouseRows.length > 0 && (
          <div style={CARD}>
            <div style={SECTION_TITLE}>Warehouses ({warehouseRows.length})</div>
            <div style={{ marginTop: 8 }}>
              {warehouseRows.map((w) => (
                <Fact key={w.warehouseId} label={`${w.warehouseName} · ${w.warehouseId}`} value={`${qty(w.stock)} ${item.uom}`} />
              ))}
            </div>
          </div>
        )}

        {/* Batch lots */}
        <div style={CARD}>
          <div style={SECTION_TITLE}>Batches / lots ({lots.length})</div>
          {lots.length === 0 ? (
            <div style={{ padding: '10px 14px 14px', fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
              Not batch-tracked — no batch numbers, expiry or FEFO ordering for this item.
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {lots.map((b, i) => {
                const exp = expiryTone(b.expiry);
                const blocked = lotIsBlocked(b);
                return (
                  <div key={`${b.batchNo}-${i}`} style={{ padding: '9px 14px', borderTop: `1px solid ${T.border}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.batchNo || '—'}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, flexShrink: 0 }}>{qty(b.qty)} <span style={{ fontSize: 10, fontWeight: 400, color: T.textTertiary }}>{item.uom}</span></span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 4 }}>
                      <span style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody }}>
                        Exp {b.expiry || '—'}{Number(b.costPrice) > 0 ? ` · ${money(b.costPrice)}/${item.uom}` : ''}{b.binLocation ? ` · ${b.binLocation}` : ''}
                      </span>
                      {exp && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: exp.fg, background: exp.bg, padding: '1px 7px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{exp.label}</span>
                      )}
                      {blocked && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: T.statusPending, background: T.statusPendingBg, padding: '1px 7px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>🔒 Blocked</span>
                      )}
                    </div>
                    {blocked && b.blockedReason && (
                      <div style={{ fontSize: 10, color: T.statusPending, fontFamily: T.fontBody, marginTop: 3 }}>{b.blockedReason}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Movement ledger */}
        <div style={CARD}>
          <div style={{ ...SECTION_TITLE, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span>Movements ({moves.length})</span>
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: T.textTertiary }}>
              In {qty(ledger.totalIn)} · Out {qty(ledger.totalOut)}
            </span>
          </div>
          {moves.length === 0 ? (
            <div style={{ padding: '10px 14px 14px', fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
              No recorded movements — the balance is all opening stock.
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {shownMoves.map((m, i) => {
                const inbound = m.inQty > 0;
                return (
                  <div key={`${m.reference}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderTop: `1px solid ${T.border}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{m.type}</div>
                      <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{m.reference} · {m.date}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, fontFamily: T.fontBody, color: inbound ? T.statusApproved : T.statusRejected }}>
                        {inbound ? '+' : '−'}{qty(inbound ? m.inQty : m.outQty)}
                      </div>
                      <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>Bal {qty(m.balance)}</div>
                    </div>
                  </div>
                );
              })}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', borderTop: `1px solid ${T.border}`, background: T.bgSubtle }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.textSecondary, fontFamily: T.fontBody }}>Opening balance</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.textSecondary, fontFamily: T.fontBody }}>{qty(ledger.opening)} {item.uom}</span>
              </div>
              {moves.length > 6 && (
                <button onClick={() => setAllMoves(v => !v)}
                  style={{ width: '100%', border: 'none', borderTop: `1px solid ${T.border}`, background: 'transparent', color: T.primary, fontFamily: T.fontBody, fontSize: 11, fontWeight: 700, padding: '10px 0', cursor: 'pointer' }}>
                  {allMoves ? 'Show less' : `Show all ${moves.length} movements`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
