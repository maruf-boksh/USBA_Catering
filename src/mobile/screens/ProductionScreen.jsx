import { useMemo, useState } from 'react';
import { T } from '../theme';
import { KPICard } from '../components/KPICard';
// Production on the phone, on the WEB's own workflow store — the same
// production orders routes/production-entry.tsx works.
//
// The floor action here is PRODUCTION INITIATION: approved orders are ticked and
// released to the Production Entry order list, which is exactly what the web's
// "Initiate (n)" does — including the kitchen-section segregation (Hot Kitchen /
// Cold Kitchen / Bakery), resolved from the BOM master.
import { useWorkflow } from '@/lib/workflow-store';
import { billOfMaterials } from '@/lib/sample-data';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };
const CARD = { background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm };
const SECTION = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 2px 8px' };

// Order lifecycle → label + colour, mirroring the web's production badges.
const PSTATUS = {
  'Pending':              { color: T.statusPending,  bg: T.statusPendingBg },
  'Approved':             { color: T.statusInfo,     bg: T.statusInfoBg },
  'Production Initiation':{ color: T.statusBoarding, bg: T.statusBoardingBg },
  'In Preparation':       { color: T.statusBoarding, bg: T.statusBoardingBg },
  'Ready for QC':         { color: T.statusPending,  bg: T.statusPendingBg },
  'Completed':            { color: T.statusApproved, bg: T.statusApprovedBg },
  'Re-Cook':              { color: T.statusRejected, bg: T.statusRejectedBg },
  'Rejected':             { color: T.statusRejected, bg: T.statusRejectedBg },
};
const STATUS_KEYS = Object.keys(PSTATUS);

const num = (v) => Number(v) || 0;

// ── Kitchen section of an order — the BOM master is the authority ────────────
const BOM_CATEGORY = (() => {
  const m = new Map();
  const put = (k, v) => { const key = (k ?? '').trim().toLowerCase(); if (key && v && !m.has(key)) m.set(key, v); };
  for (const b of billOfMaterials) { put(b.itemCode, b.category); put(b.itemName, b.category); put(b.name, b.category); }
  return m;
})();
const BAKERY_WORDS = ['bread', 'bun', 'toast', 'cake', 'pastry', 'croissant', 'muffin', 'donut', 'cookie', 'biscuit', 'danish', 'brownie', 'tart', 'jamun', 'mousse', 'tukra'];
const COLD_WORDS = ['yoghurt', 'yogurt', 'salad', 'fruit', 'banana', 'apple', 'orange', 'custard', 'firni', 'raita', 'juice', 'cold', 'chilled', 'boiled egg'];

function sectionOf(e) {
  const fromBom = BOM_CATEGORY.get((e.outputItemCode ?? '').trim().toLowerCase())
    ?? BOM_CATEGORY.get((e.outputItemName ?? '').trim().toLowerCase())
    ?? BOM_CATEGORY.get((e.bom ?? '').trim().toLowerCase());
  if (fromBom) return fromBom;
  const name = `${e.outputItemName ?? ''} ${e.bom ?? ''}`.toLowerCase();
  if (BAKERY_WORDS.some((w) => name.includes(w))) return 'Bakery';
  if (COLD_WORDS.some((w) => name.includes(w))) return 'Cold Kitchen';
  return 'Hot Kitchen';
}
const SECTION_ORDER = ['Hot Kitchen', 'Cold Kitchen', 'Bakery'];
function groupBySection(list) {
  const g = new Map();
  for (const e of list) {
    const c = sectionOf(e);
    g.set(c, [...(g.get(c) ?? []), e]);
  }
  return [...g.entries()]
    .sort(([a], [b]) => {
      const ia = SECTION_ORDER.indexOf(a), ib = SECTION_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b);
    })
    .map(([section, entries]) => ({ section, entries }));
}

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

export function ProductionScreen({ nav }) {
  const { productionEntries, updateProductionEntryStatus } = useWorkflow();
  const [view, setView]   = useState('list');   // 'list' | 'initiate' | 'detail'
  const [activeId, setActiveId] = useState(null);
  const [picked, setPicked] = useState([]);
  const [query, setQuery]   = useState('');
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const flash = (m) => { setNotice(m); setTimeout(() => setNotice(''), 3000); };

  const counts = useMemo(() => ({
    approved: productionEntries.filter((e) => e.status === 'Approved').length,
    initiated: productionEntries.filter((e) => e.status === 'Production Initiation').length,
    preparing: productionEntries.filter((e) => ['In Preparation', 'Ready for QC'].includes(e.status)).length,
    completed: productionEntries.filter((e) => e.status === 'Completed').length,
  }), [productionEntries]);

  const initiatable = productionEntries.filter((e) => e.status === 'Approved');

  const visible = productionEntries.filter((e) => {
    if (filter !== 'all' && e.status !== filter) return false;
    if (!query.trim()) return true;
    const hay = `${e.id} ${e.outputItemName ?? ''} ${e.bom} ${e.status}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });
  const sorted = [...visible].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || String(b.id).localeCompare(String(a.id)));

  const activeEntry = productionEntries.find((e) => e.id === activeId) ?? null;
  const initiateGroups = useMemo(() => groupBySection(initiatable), [initiatable]);

  const togglePick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const groupAll = (entries) => entries.length > 0 && entries.every((e) => picked.includes(e.id));
  const toggleGroup = (entries) => {
    const on = !groupAll(entries);
    setPicked((prev) => {
      const next = new Set(prev);
      for (const e of entries) { if (on) next.add(e.id); else next.delete(e.id); }
      return [...next];
    });
  };

  /** Release the ticked orders to the Production Entry floor list. */
  const confirmInitiate = () => {
    const targets = initiatable.filter((e) => picked.includes(e.id));
    if (targets.length === 0) return;
    for (const e of targets) updateProductionEntryStatus(e.id, 'Production Initiation');
    setPicked([]);
    setView('list');
    flash(`${targets.length} order${targets.length === 1 ? '' : 's'} moved to Production Initiation.`);
  };

  // ── Production Initiation ─────────────────────────────────────────────────
  if (view === 'initiate') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setPicked([]); setView('list'); }} style={BTN_BACK}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Production Initiation</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
              {picked.length} of {initiatable.length} selected
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          <div style={{ background: T.statusInfoBg, border: `1px solid ${T.statusInfo}25`, borderRadius: T.radiusMd, padding: '9px 12px', marginBottom: 12, fontSize: 11.5, color: T.textSecondary, fontFamily: T.fontBody }}>
            Tick the orders to begin. Unticked orders stay Approved and remain available for a later run.
          </div>

          {initiateGroups.length === 0 ? (
            <Empty icon="🏭" text="No approved orders waiting to be initiated." />
          ) : initiateGroups.map((g) => (
            <div key={g.section}>
              {/* One block per kitchen section — its heading marks the whole section */}
              <div onClick={() => toggleGroup(g.entries)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, background: T.bgSubtle, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '9px 12px', marginTop: 10, marginBottom: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={groupAll(g.entries)} onChange={() => toggleGroup(g.entries)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 17, height: 17, accentColor: T.primary, cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 11.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {g.section}
                </span>
                <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                  {g.entries.filter((e) => picked.includes(e.id)).length} of {g.entries.length} marked
                </span>
              </div>

              {g.entries.map((e) => {
                const on = picked.includes(e.id);
                return (
                  <div key={e.id} onClick={() => togglePick(e.id)}
                    style={{ ...CARD, marginBottom: 8, border: `1px solid ${on ? T.primary : T.border}`, background: on ? T.primaryLight : T.bgSurface, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <input type="checkbox" checked={on} onChange={() => togglePick(e.id)}
                        onClick={(ev) => ev.stopPropagation()}
                        style={{ width: 17, height: 17, accentColor: T.primary, cursor: 'pointer', marginTop: 2, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                            {e.outputItemName ?? e.bom}
                          </span>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                            {num(e.orderQty).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                          {e.id} · {e.date}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {initiatable.length > 0 && (
          <div style={{ display: 'flex', gap: 10, padding: '10px 14px', background: T.bgSurface, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
            <button onClick={() => setPicked(picked.length === initiatable.length ? [] : initiatable.map((e) => e.id))}
              style={{ flex: 1, padding: '13px 0', background: 'none', border: `2px solid ${T.borderStrong}`, borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: T.textSecondary, fontFamily: T.fontBody, cursor: 'pointer' }}>
              {picked.length === initiatable.length ? 'Clear' : `Select All (${initiatable.length})`}
            </button>
            <button onClick={confirmInitiate} disabled={picked.length === 0}
              style={{ flex: 2, padding: '13px 0', background: picked.length ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: picked.length ? 'pointer' : 'not-allowed', opacity: picked.length ? 1 : 0.7 }}>
              Initiate {picked.length || ''}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Order detail ──────────────────────────────────────────────────────────
  if (view === 'detail' && activeEntry) {
    const e = activeEntry;
    const s = PSTATUS[e.status] ?? PSTATUS.Pending;
    const pct = num(e.orderQty) > 0 ? Math.min(100, Math.round((num(e.producedQty) / num(e.orderQty)) * 100)) : 0;
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{e.outputItemName ?? e.bom}</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{e.id} · {sectionOf(e)}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          <div style={CARD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                {num(e.producedQty).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400, color: T.textTertiary }}>of {num(e.orderQty).toLocaleString()} portions</span>
              </span>
              <Chip label={e.status} color={s.color} bg={s.bg} />
            </div>
            <div style={{ height: 6, borderRadius: T.radiusFull, background: T.bgSubtle, overflow: 'hidden', margin: '8px 0 2px' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? T.statusApproved : T.primary }} />
            </div>
            <Row label="Kitchen Section" value={sectionOf(e)} />
            <Row label="Item Code" value={e.outputItemCode} />
            <Row label="BOM" value={e.bom} />
            <Row label="Order Date" value={e.date} />
            <Row label="Completed At" value={e.completedAt} />
          </div>

          <div style={SECTION}>Quality Control</div>
          <div style={CARD}>
            <Row label="QC Checked By" value={e.qcCheckedBy} />
            <Row label="QC Passed At" value={e.qcPassedAt} />
            <Row label="QC Failed By" value={e.qcFailedBy} />
            <Row label="Fail Reason" value={e.qcFailReason} />
            {!e.qcPassedAt && !e.qcFailReason && (
              <div style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, padding: '4px 0' }}>
                Not QC-checked yet — signed off in Cooking Temperature &amp; Sensory.
              </div>
            )}
          </div>

          {e.status === 'Approved' && (
            <button onClick={() => { setPicked([e.id]); setView('initiate'); }}
              style={{ width: '100%', marginTop: 12, padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
              Initiate Production
            </button>
          )}
          {e.status === 'Pending' && (
            <div style={{ background: T.statusPendingBg, border: `1px solid ${T.statusPending}30`, borderRadius: T.radiusMd, padding: '10px 14px', marginTop: 12, fontSize: 12, color: T.statusPending, fontFamily: T.fontBody }}>
              Waiting for approval — sign it off in the Approvals inbox.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Production</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
            {productionEntries.length} orders · {counts.approved} to initiate
          </div>
        </div>
        {counts.approved > 0 && (
          <button onClick={() => { setPicked(initiatable.map((e) => e.id)); setView('initiate'); }}
            style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.55)', borderRadius: T.radiusMd, height: 30, padding: '0 12px', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, flexShrink: 0 }}>
            Initiate {counts.approved}
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
        {notice && (
          <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusMd, padding: '9px 12px', marginBottom: 10, fontSize: 11, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>
            {notice}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <KPICard label="To Initiate" value={counts.approved}  sub="Approved orders" accent={T.statusInfo} />
          <KPICard label="Initiated"   value={counts.initiated} sub="On the floor"    accent={T.statusBoarding} />
          <KPICard label="In Progress" value={counts.preparing} sub="Cooking / QC"    accent={T.statusPending} />
          <KPICard label="Completed"   value={counts.completed} sub="Done today"      accent={T.statusApproved} />
        </div>

        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search order, item, BOM…" style={{ ...INPUT, marginTop: 12 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 0' }}>
          <button onClick={() => setFilter('all')}
            style={{ flexShrink: 0, padding: '8px 14px', borderRadius: T.radiusFull, border: `1px solid ${filter === 'all' ? T.primary : T.border}`, background: filter === 'all' ? T.primary : T.bgSurface, color: filter === 'all' ? '#fff' : T.textTertiary, fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
            All
          </button>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ ...INPUT, flex: 1, minWidth: 0, padding: '9px 10px', fontSize: 12, fontWeight: 700 }}>
            <option value="all">All statuses</option>
            {STATUS_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div style={{ ...SECTION, marginTop: 12 }}>
          {sorted.length} production order{sorted.length === 1 ? '' : 's'}
        </div>

        {sorted.length === 0 ? (
          <Empty icon="🏭" text={productionEntries.length === 0
            ? 'No production orders yet.'
            : 'No orders match the current filter.'} />
        ) : sorted.slice(0, 60).map((e) => {
          const s = PSTATUS[e.status] ?? PSTATUS.Pending;
          const pct = num(e.orderQty) > 0 ? Math.min(100, Math.round((num(e.producedQty) / num(e.orderQty)) * 100)) : 0;
          return (
            <div key={e.id} onClick={() => { setActiveId(e.id); setView('detail'); }} style={{ ...CARD, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                    {e.outputItemName ?? e.bom}
                  </div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                    {e.id} · {e.date} · {sectionOf(e)}
                  </div>
                </div>
                <Chip label={e.status} color={s.color} bg={s.bg} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6, marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>Produced</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                  {num(e.producedQty).toLocaleString()} / {num(e.orderQty).toLocaleString()}
                </span>
              </div>
              <div style={{ height: 5, borderRadius: T.radiusFull, background: T.bgSubtle, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? T.statusApproved : T.primary }} />
              </div>
            </div>
          );
        })}

        {sorted.length > 60 && (
          <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
            Showing the 60 most recent — search to narrow it down.
          </div>
        )}
      </div>
    </div>
  );
}
