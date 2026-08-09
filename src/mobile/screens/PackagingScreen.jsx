import { useMemo, useState } from 'react';
import { T } from '../theme';
import { KPICard } from '../components/KPICard';
// Packaging on the phone, on the WEB's own record — the "packaging-allocations"
// store routes/packaging.tsx works against.
//
// A row is an ALLOCATION: this production run, this flight, this quantity — not
// a batch. Runs are created on the web (New Packaging) and signed off in
// Approval Management; the phone works the packing floor itself: see what is
// queued per flight, and mark labels Packaging Done as they are packed. The
// lifecycle, the gating and the flight-order roll-up are the web's.
import {
  isPackaged, isAwaitingApproval, allocationItems,
} from '@/lib/packaging-allocations';
import { getFlightOrders, updateFlightOrdersWhere } from '@/lib/flight-orders-store';
import { useWorkflow } from '@/lib/workflow-store';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };
const CARD = { background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm };
const SECTION = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 2px 8px' };

const ALLOC_KEY = 'harvest-data-v1:packaging-allocations';
// The QC record behind a label, and the flight's meal manifest — the same two
// stores the web's "Production & QC" view reads.
const BATCH_KEY = 'harvest-data-v1:packaging-batches';
const ROWS_KEY  = 'harvest-data-v1:dispatch-packaging-rows';

// Allocation lifecycle → label + colour, mirroring the web's packaging chips.
const PSTATUS = {
  'Pending Approval':   { color: T.statusPending,  bg: T.statusPendingBg },
  'Rejected':           { color: T.statusRejected, bg: T.statusRejectedBg },
  'In Packaging':       { color: T.statusInfo,     bg: T.statusInfoBg },
  'Packaged':           { color: T.statusApproved, bg: T.statusApprovedBg },
  'Forwarded To Airport': { color: T.statusBoarding, bg: T.statusBoardingBg },
  'Airport Approved':   { color: T.statusBoarding, bg: T.statusBoardingBg },
  'Received At Airport': { color: T.statusBoarding, bg: T.statusBoardingBg },
  'Dispatched':         { color: T.statusApproved, bg: T.statusApprovedBg },
};
const STATUS_KEYS = Object.keys(PSTATUS);

const num = (v) => Number(v) || 0;
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function readJson(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function readAllocations() {
  return readJson(ALLOC_KEY, []);
}
function writeAllocations(list) {
  try { localStorage.setItem(ALLOC_KEY, JSON.stringify(list)); } catch { /* quota — non-fatal */ }
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
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '7px 0', borderTop: `1px solid ${T.border}` }}>
      <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, textAlign: 'right' }}>{v === '' ? '—' : v}</span>
    </div>
  );
}

/** A row whose id opens that record. */
function LinkRow({ label, value, onOpen }) {
  const v = String(value ?? '').trim();
  if (v === '') return <Row label={label} value="" />;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: `1px solid ${T.border}` }}>
      <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{label}</span>
      <button onClick={onOpen}
        style={{ background: T.primaryLight, border: `1px solid ${T.primary}55`, borderRadius: T.radiusMd, padding: '4px 10px', fontSize: 11.5, fontWeight: 700, color: T.primary, fontFamily: T.fontBody, cursor: 'pointer' }}>
        {v} ›
      </button>
    </div>
  );
}

export function PackagingScreen({ nav }) {
  const [allocations, setAllocations] = useState(() => readAllocations());
  const [view, setView]     = useState('list');   // 'list' | 'flight' | 'labels' | 'qc'
  const [activeKey, setActiveKey] = useState(null);
  const [query, setQuery]   = useState('');
  const [filter, setFilter] = useState('all');
  const [picked, setPicked] = useState([]);
  /** Labels printed this session — printing is repeatable and status-neutral;
   *  only a SCAN completes packaging, exactly as on the web. */
  const [printedIds, setPrintedIds] = useState([]);
  /** Allocation whose Production & QC page is open. */
  const [qcAlloc, setQcAlloc] = useState(null);
  /** An id opened from the Production & QC page — { kind, id }. */
  const [idDoc, setIdDoc] = useState(null);
  const [notice, setNotice] = useState('');
  const flash = (m) => { setNotice(m); setTimeout(() => setNotice(''), 2800); };

  const { productionEntries } = useWorkflow();
  const batches = useMemo(() => readJson(BATCH_KEY, []), []);
  const manifestRows = useMemo(() => readJson(ROWS_KEY, []), []);
  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const peById = useMemo(() => new Map(productionEntries.map((p) => [p.id, p])), [productionEntries]);

  const orders = useMemo(() => getFlightOrders(), []);
  const orderFor = (flight, date, orderNo) =>
    orders.find((o) => o.flight === flight && (!orderNo || o.orderNo === orderNo) && (!date || o.date === date))
    ?? orders.find((o) => o.flight === flight);

  // KPIs — the run states the web shows on this list.
  const pendingApproval = allocations.filter(isAwaitingApproval).length;
  const inPackaging = allocations.filter((a) => a.status === 'In Packaging').length;
  const packaged = allocations.filter(isPackaged).length;

  const rows = allocations.filter((a) => {
    if (filter !== 'all' && a.status !== filter) return false;
    if (!query.trim()) return true;
    const hay = `${a.productionId} ${a.packagingId} ${a.item} ${a.flight} ${a.orderNo ?? ''}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  /** Flight-wise roll-up — allocations already carry their flight, so this is a
   *  plain group, exactly as on the web. */
  const groups = useMemo(() => {
    const map = new Map();
    for (const a of rows) {
      const key = `${a.flight}|${a.date}`;
      let g = map.get(key);
      if (!g) {
        const fo = orderFor(a.flight, a.date, a.orderNo);
        g = { key, flight: a.flight, date: a.date, orderNo: a.orderNo ?? fo?.orderNo, depTime: a.depTime ?? fo?.etd, sector: fo?.sector, allocations: [], latestAt: '' };
        map.set(key, g);
      }
      g.allocations.push(a);
      if ((a.createdAt ?? '') > g.latestAt) g.latestAt = a.createdAt ?? '';
    }
    return [...map.values()].sort((a, b) =>
      b.latestAt.localeCompare(a.latestAt) || b.date.localeCompare(a.date) || a.flight.localeCompare(b.flight));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const activeGroup = groups.find((g) => g.key === activeKey)
    ?? (activeKey ? { key: activeKey, flight: activeKey.split('|')[0], date: activeKey.split('|')[1], allocations: [] } : null);

  /**
   * Mark labels Packaging Done — the web's own completion step. Once every
   * non-rejected allocation of a flight is packaged, its flight order advances
   * Approved/Production → Packaged, exactly as the web does it.
   */
  const markPackaged = (list) => {
    if (list.length === 0) return;
    const ids = new Set(list.map((a) => a.id));
    const at = stamp();
    const next = allocations.map((a) =>
      ids.has(a.id) ? { ...a, status: 'Packaged', packagedAt: at } : a);
    setAllocations(next);
    writeAllocations(next);
    const affected = new Map();
    for (const a of list) if (a.orderNo) affected.set(`${a.orderNo}__${a.flight}`, { orderNo: a.orderNo, flight: a.flight });
    for (const { orderNo, flight } of affected.values()) {
      const legs = next.filter((a) => a.orderNo === orderNo && a.flight === flight && a.status !== 'Rejected');
      if (legs.length > 0 && legs.every(isPackaged)) {
        updateFlightOrdersWhere(
          (o) => o.orderNo === orderNo && o.flight === flight && (o.status === 'Approved' || o.status === 'Production'),
          { status: 'Packaged' },
        );
      }
    }
    setPicked([]);
    flash(`${ids.size} label${ids.size === 1 ? '' : 's'} marked Packaging Done — ready for dispatch.`);
  };

  const togglePick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  /** Printing records that the label exists on paper — it changes no status and
   *  can be repeated. Scanning it is what completes packaging. */
  const printLabels = (list) => {
    if (list.length === 0) return;
    setPrintedIds((prev) => [...new Set([...prev, ...list.map((a) => a.id)])]);
    flash(`${list.length} label${list.length === 1 ? '' : 's'} sent to printer — scan to mark Packaging Done.`);
  };
  const scanLabels = (list) => markPackaged(list.filter((a) => printedIds.includes(a.id)));

  // ── One id, its own record ────────────────────────────────────────────────
  // A packaging id IS the package (this run's share of this flight); a
  // production id is the kitchen run behind it, which several flights can draw
  // on — so the run's page lists every package taken out of it.
  if (view === 'iddoc' && idDoc) {
    const back = () => { setIdDoc(null); setView('qc'); };
    const isPkg = idDoc.kind === 'packaging';
    const pkg = isPkg ? allocations.find((x) => x.packagingId === idDoc.id) : null;
    const run = !isPkg ? peById.get(idDoc.id) : null;
    const drawn = !isPkg ? allocations.filter((x) => x.productionId === idDoc.id
      || (x.components ?? []).some((c) => c.productionId === idDoc.id)) : [];
    const drawnQty = drawn.reduce((s, x) => s + (x.productionId === idDoc.id
      ? num(x.qty)
      : (x.components ?? []).filter((c) => c.productionId === idDoc.id).reduce((n, c) => n + num(c.qty), 0)), 0);
    const pkgBatch = pkg ? batchById.get(pkg.batchId) : null;
    const found = isPkg ? !!pkg : !!run;
    const s = pkg ? (PSTATUS[pkg.status] ?? PSTATUS['Pending Approval']) : null;

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={back} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{idDoc.id}</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
              {isPkg ? 'Package' : 'Production Run'}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          {!found ? (
            <Empty icon="🔍" text={`${idDoc.id} is no longer in the ${isPkg ? 'packaging' : 'production'} records.`} />
          ) : isPkg ? (
            <>
              <div style={SECTION}>Package</div>
              <div style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                    {pkg.setCode ? `${pkg.setCode} · ` : ''}{pkg.item}
                  </span>
                  <Chip label={pkg.status} color={s.color} bg={s.bg} />
                </div>
                <Row label="Packaging ID" value={pkg.packagingId} />
                <Row label="Production Run" value={pkg.productionId} />
                <Row label="QC Batch" value={pkg.batchId} />
                <Row label="Flight" value={pkg.flight} />
                <Row label="Order" value={pkg.orderNo} />
                <Row label="Date" value={pkg.date} />
                <Row label="Dep Time" value={pkg.depTime} />
                <Row label="Qty" value={`${num(pkg.qty).toLocaleString()} ${pkg.setCode ? 'meal(s)' : 'portion(s)'}`} />
                {pkgBatch && <Row label="Measured Temp" value={`${pkgBatch.measuredTemp}°C`} />}
              </div>

              <div style={SECTION}>Trail</div>
              <div style={CARD}>
                <Row label="Created" value={`${pkg.createdAt ?? '—'}${pkg.createdBy ? ` · ${pkg.createdBy}` : ''}`} />
                <Row label="Approved" value={pkg.approvedBy ? `${pkg.approvedBy}${pkg.approvedAt ? ` · ${pkg.approvedAt}` : ''}` : ''} />
                <Row label="Packaged" value={pkg.packagedAt} />
                <Row label="Dispatch" value={pkg.dispatchId} />
                <Row label="Rejected Reason" value={pkg.rejectedReason} />
              </div>

              {(pkg.components ?? []).length > 0 && (
                <>
                  <div style={SECTION}>Contents ({pkg.components.length} per meal)</div>
                  <div style={CARD}>
                    {pkg.components.map((c, i) => (
                      <div key={`${c.productionId}-${i}`} style={{ padding: '8px 0', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{c.item}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>×{num(c.qty).toLocaleString()}</span>
                        </div>
                        <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{c.productionId}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div style={SECTION}>Production Run</div>
              <div style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                    {run.outputItemName ?? run.bom}
                  </span>
                  <Chip label={run.status}
                    color={run.status === 'Completed' ? T.statusApproved : run.status === 'Pending' ? T.statusPending : T.statusInfo}
                    bg={run.status === 'Completed' ? T.statusApprovedBg : run.status === 'Pending' ? T.statusPendingBg : T.statusInfoBg} />
                </div>
                <Row label="Production ID" value={run.id} />
                <Row label="Item Code" value={run.outputItemCode} />
                <Row label="BOM" value={run.bom} />
                <Row label="Production Date" value={run.date} />
                <Row label="Order Qty" value={`${num(run.orderQty).toLocaleString()} portion(s)`} />
                <Row label="Produced Qty" value={`${num(run.producedQty).toLocaleString()} portion(s)`} />
                <Row label="Completed At" value={run.completedAt} />
              </div>

              <div style={SECTION}>Quality Control</div>
              <div style={CARD}>
                <Row label="QC Checked By" value={run.qcCheckedBy} />
                <Row label="QC Passed At" value={run.qcPassedAt} />
                <Row label="QC Failed By" value={run.qcFailedBy} />
                <Row label="Fail Reason" value={run.qcFailReason} />
              </div>

              <div style={SECTION}>Packaged From This Run ({drawn.length})</div>
              <div style={CARD}>
                {drawn.length === 0 ? (
                  <div style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, padding: '4px 0' }}>
                    Nothing packaged from this run yet.
                  </div>
                ) : (
                  <>
                    {drawn.map((x, i) => {
                      const xs = PSTATUS[x.status] ?? PSTATUS['Pending Approval'];
                      const qty = x.productionId === idDoc.id
                        ? num(x.qty)
                        : (x.components ?? []).filter((c) => c.productionId === idDoc.id).reduce((n, c) => n + num(c.qty), 0);
                      return (
                        <div key={x.id} style={{ padding: '9px 0', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{x.flight}</span>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{qty.toLocaleString()}</span>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 3 }}>
                            <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{x.packagingId} · {x.date}</span>
                            <Chip label={x.status} color={xs.color} bg={xs.bg} />
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0 0', borderTop: `2px solid ${T.borderStrong}`, marginTop: 4 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Allocated</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                        {drawnQty.toLocaleString()} / {num(run.producedQty).toLocaleString()}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Production & QC — the record behind one label ─────────────────────────
  if (view === 'qc' && qcAlloc) {
    const a = qcAlloc;
    const b = batchById.get(a.batchId);
    const pe = peById.get(a.productionId);
    const tempDelta = b && b.thresholdTemp != null ? num(b.measuredTemp) - num(b.thresholdTemp) : null;
    // The flight's meal manifest — same rows the web's Meal Items table lists.
    const meals = manifestRows.filter((r) => r.flight === a.flight && r.date === a.date);
    const mealTotal = meals.reduce((s, r) => s + num(r.qty), 0);
    const steps = [
      { done: !!b, label: 'Passed temperature & taste QC', at: b ? `${b.checkedBy ?? '—'}${pe?.qcPassedAt ? ` · ${pe.qcPassedAt}` : ''}` : 'No QC record' },
      { done: !isAwaitingApproval(a), label: 'Packaging approved', at: a.approvedBy ? `${a.approvedBy}${a.approvedAt ? ` · ${a.approvedAt}` : ''}` : (isAwaitingApproval(a) ? 'Pending approval' : '—') },
      { done: !!a.packagedAt, label: 'Packaged (labels printed)', at: a.packagedAt || '—' },
    ];
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setQcAlloc(null); setView('flight'); }} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Production &amp; QC</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{a.packagingId}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          <div style={SECTION}>Production Details</div>
          <div style={CARD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{a.item}</span>
              <Chip label={pe?.status ?? 'Completed'} color={T.textSecondary} bg={T.bgSubtle} />
            </div>
            <LinkRow label="Packaging ID" value={a.packagingId}
              onOpen={() => { setIdDoc({ kind: 'packaging', id: a.packagingId }); setView('iddoc'); }} />
            <LinkRow label="Production ID" value={a.productionId}
              onOpen={() => { setIdDoc({ kind: 'production', id: a.productionId }); setView('iddoc'); }} />
            <Row label="Order ID" value={a.orderNo} />
            <Row label="BOM" value={pe?.bom ?? a.item} />
            <Row label="Production Date" value={pe?.date ?? a.date} />
            <Row label="Time of Production" value={pe?.completedAt ?? pe?.qcPassedAt ?? a.packagedAt ?? a.date} />
            <Row label="Req Qty" value={pe?.orderQty != null ? num(pe.orderQty).toLocaleString() : num(a.qty).toLocaleString()} />
            <Row label="Produced Qty" value={pe?.producedQty != null ? num(pe.producedQty).toLocaleString() : num(a.qty).toLocaleString()} />
            <Row label="This Flight" value={`${num(a.qty).toLocaleString()} ${a.setCode ? 'meal(s)' : 'portion(s)'}`} />
          </div>

          <div style={SECTION}>QC Details</div>
          <div style={CARD}>
            {b ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>Measured Temp</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>
                    {b.measuredTemp}°C
                    {tempDelta != null && (
                      <span style={{ fontSize: 11, fontWeight: 400, color: T.textTertiary, marginLeft: 4 }}>
                        ({tempDelta >= 0 ? '+' : ''}{tempDelta}° vs threshold)
                      </span>
                    )}
                  </span>
                </div>
                <Row label="Standard Temp" value={b.standardTemp} />
                <Row label="Threshold Temp" value={b.thresholdTemp != null ? `≤${b.thresholdTemp}°C` : ''} />
                <Row label="Taste" value={b.taste} />
                <Row label="Cooked By" value={b.cookedBy} />
                <Row label="QC Checked By" value={b.checkedBy} />
                <Row label="QC Passed At" value={pe?.qcPassedAt} />
                <Row label="Packaging Status" value={a.status} />
              </>
            ) : (
              <div style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, padding: '4px 0' }}>
                No QC batch record linked to this run.
              </div>
            )}
          </div>

          <div style={SECTION}>Meal Items {meals.length > 0 ? `(${meals.length})` : ''}</div>
          <div style={CARD}>
            {meals.length === 0 ? (
              <div style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, padding: '4px 0' }}>
                No linked order manifest. This package — {a.item} · {num(a.qty).toLocaleString()}.
              </div>
            ) : (
              <>
                {meals.map((r, i) => {
                  const mpe = r.productionOrderId ? peById.get(r.productionOrderId) : undefined;
                  return (
                    <div key={r.id ?? i} style={{ padding: '9px 0', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{r.mealName}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, flexShrink: 0 }}>{num(r.qty).toLocaleString()}</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 3 }}>
                        <Chip label={r.mealType} color={T.statusInfo} bg={T.statusInfoBg} />
                        <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                          {r.productionOrderId ?? '—'}
                        </span>
                        <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                          req {mpe?.orderQty != null ? num(mpe.orderQty).toLocaleString() : num(r.qty).toLocaleString()} · produced {mpe?.producedQty != null ? num(mpe.producedQty).toLocaleString() : num(r.qty).toLocaleString()}
                        </span>
                        {r.section && <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{r.section}</span>}
                      </div>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0 0', borderTop: `2px solid ${T.borderStrong}`, marginTop: 4 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Total</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{mealTotal.toLocaleString()}</span>
                </div>
              </>
            )}
          </div>

          <div style={SECTION}>Approval Log</div>
          <div style={CARD}>
            {steps.map((st, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                <span style={{ width: 14, height: 14, borderRadius: T.radiusFull, flexShrink: 0, marginTop: 2,
                  background: st.done ? T.statusApproved : 'transparent',
                  border: `1px solid ${st.done ? T.statusApproved : T.borderStrong}`,
                  color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {st.done ? '✓' : ''}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: st.done ? 700 : 400, color: st.done ? T.textPrimary : T.textTertiary, fontFamily: T.fontBody }}>
                    {st.label}
                  </div>
                  {st.at && st.at !== '—' && (
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{st.at}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Print & Scan Labels ───────────────────────────────────────────────────
  // Printing is repeatable and status-neutral; SCANNING a printed label marks it
  // Packaging Done — the web's rule, unchanged.
  if (view === 'labels' && activeGroup) {
    const g = activeGroup;
    const labels = g.allocations.filter((a) => a.status === 'In Packaging' && picked.includes(a.id));
    const anyPrinted = labels.some((a) => printedIds.includes(a.id));
    const allPrinted = labels.length > 0 && labels.every((a) => printedIds.includes(a.id));
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => setView('flight')} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Print &amp; Scan Labels</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
              {g.flight} · {labels.length} label{labels.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          {notice && (
            <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusMd, padding: '9px 12px', marginBottom: 10, fontSize: 11, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>
              {notice}
            </div>
          )}
          <div style={{ background: T.statusInfoBg, border: `1px solid ${T.statusInfo}25`, borderRadius: T.radiusMd, padding: '9px 12px', marginBottom: 12, fontSize: 11.5, color: T.textSecondary, fontFamily: T.fontBody }}>
            Reprint as often as you need — <b>scanning</b> a label is what marks it <b>Packaging Done</b> (ready for dispatch).
          </div>

          {labels.length === 0 ? (
            <Empty icon="🏷️" text="No labels selected. Go back and tick the labels to print." />
          ) : labels.map((a) => {
            const b = batchById.get(a.batchId);
            const printed = printedIds.includes(a.id);
            const code = a.setCode ? `LBL-${a.packagingId}-${a.flight}` : `LBL-${a.productionId}-${a.flight}`;
            return (
              <div key={a.id} style={{ background: T.bgSurface, border: `2px dashed ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    USBA Catering · Meal Label
                  </span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: printed ? T.statusInfo : T.statusPending, fontFamily: T.fontBody }}>
                    {printed ? 'PRINTED · SCAN TO COMPLETE' : 'READY TO PRINT'}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                    {a.setCode ? `${a.setCode} · ` : ''}{a.item}
                  </span>
                  <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, flexShrink: 0 }}>
                    Qty {num(a.qty).toLocaleString()}
                  </span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', marginTop: 5 }}>
                  <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                    Flight <b style={{ color: T.textPrimary }}>{a.flight}</b>
                  </span>
                  {a.orderNo && (
                    <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                      Order <b style={{ color: T.textPrimary }}>{a.orderNo}</b>
                    </span>
                  )}
                  {!a.setCode && (
                    <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                      Batch <b style={{ color: T.textPrimary }}>{a.productionId}</b>
                    </span>
                  )}
                  {!a.setCode && b && (
                    <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                      Meas <b style={{ color: T.textPrimary }}>{b.measuredTemp}°C</b>
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{a.date}</span>
                </div>

                {/* An assembled meal prints what is IN it — the whole chain. */}
                {(a.components ?? []).length > 0 && (
                  <div style={{ border: `1px dashed ${T.statusBoarding}55`, background: T.statusBoardingBg, borderRadius: T.radiusMd, padding: '6px 9px', marginTop: 8 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.statusBoarding, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>
                      Contents — {a.components.length} items per meal
                    </div>
                    {a.components.map((c) => (
                      <div key={c.productionId} style={{ fontSize: 10.5, color: T.textTertiary, fontFamily: T.fontBody }}>
                        <b style={{ color: T.textPrimary }}>{c.item}</b> · {c.productionId} · ×{num(c.qty).toLocaleString()}
                      </div>
                    ))}
                  </div>
                )}

                {/* Decorative barcode — same format the web label prints */}
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 30, overflow: 'hidden' }} aria-hidden>
                    {code.split('').flatMap((ch, i) => [0, 1, 2, 3].map((k) => (
                      <span key={`${i}-${k}`} style={{ background: T.textPrimary, width: ((ch.charCodeAt(0) >> k) & 1) ? 2 : 1, height: '100%' }} />
                    )))}
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 10.5, letterSpacing: '0.12em', color: T.textSecondary, fontFamily: T.fontBody, marginTop: 4 }}>{code}</div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => printLabels([a])}
                    style={{ flex: 1, padding: '9px 0', background: 'none', border: `1px solid ${T.borderStrong}`, borderRadius: T.radiusMd, fontSize: 12, fontWeight: 700, color: T.textSecondary, fontFamily: T.fontBody, cursor: 'pointer' }}>
                    {printed ? 'Reprint' : 'Print'}
                  </button>
                  <button onClick={() => scanLabels([a])} disabled={!printed}
                    title={printed ? 'Scan to mark Packaging Done' : 'Print the label first, then scan it'}
                    style={{ flex: 1, padding: '9px 0', background: printed ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: printed ? 'pointer' : 'not-allowed', opacity: printed ? 1 : 0.7 }}>
                    Scan
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {labels.length > 0 && (
          <div style={{ display: 'flex', gap: 10, padding: '10px 14px', background: T.bgSurface, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
            <button onClick={() => printLabels(labels)}
              style={{ flex: 1, padding: '13px 0', background: 'none', border: `2px solid ${T.borderStrong}`, borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: T.textSecondary, fontFamily: T.fontBody, cursor: 'pointer' }}>
              {allPrinted ? 'Print All Again' : 'Print All Labels'}
            </button>
            <button onClick={() => scanLabels(labels)} disabled={!anyPrinted}
              title={anyPrinted ? 'Scan all printed labels — marks them Packaging Done' : 'Print the labels first, then scan'}
              style={{ flex: 1, padding: '13px 0', background: anyPrinted ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: anyPrinted ? 'pointer' : 'not-allowed', opacity: anyPrinted ? 1 : 0.7 }}>
              Scan All
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Flight detail ─────────────────────────────────────────────────────────
  if (view === 'flight' && activeGroup) {
    const g = activeGroup;
    const packable = g.allocations.filter((a) => a.status === 'In Packaging');
    const pickedRows = packable.filter((a) => picked.includes(a.id));
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setActiveKey(null); setPicked([]); setView('list'); }} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{g.flight}{g.sector ? ` · ${g.sector}` : ''}</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
              {g.date}{g.depTime ? ` · Dep ${g.depTime}` : ''}{g.orderNo ? ` · ${g.orderNo}` : ''}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          {notice && (
            <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusMd, padding: '9px 12px', marginBottom: 10, fontSize: 11, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>
              {notice}
            </div>
          )}

          <div style={SECTION}>Labels ({g.allocations.length})</div>
          {g.allocations.map((a) => {
            const s = PSTATUS[a.status] ?? PSTATUS['Pending Approval'];
            const canPack = a.status === 'In Packaging';
            const on = picked.includes(a.id);
            const items = allocationItems(a);
            return (
              // The CARD opens the label's Production & QC record; only the box
              // marks it for printing, so a tap never selects by accident.
              <div key={a.id} onClick={() => { setQcAlloc(a); setView('qc'); }}
                style={{ ...CARD, border: `1px solid ${on ? T.primary : T.border}`, background: on ? T.primaryLight : T.bgSurface, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  {canPack && (
                    <span onClick={(ev) => { ev.stopPropagation(); togglePick(a.id); }}
                      style={{ padding: 2, margin: -2, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                      <input type="checkbox" checked={on} onChange={() => togglePick(a.id)}
                        onClick={(ev) => ev.stopPropagation()}
                        aria-label={`Select ${a.packagingId} for printing`}
                        style={{ width: 18, height: 18, accentColor: T.primary, cursor: 'pointer', marginTop: 2 }} />
                    </span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{a.packagingId}</span>
                      <Chip label={a.status} color={s.color} bg={s.bg} />
                    </div>
                    <div style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody, marginTop: 3 }}>
                      {a.setCode ? `${a.setCode} · ` : ''}{items.join(', ')}
                    </div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 3 }}>
                      {num(a.qty)} {a.setCode ? 'meal(s)' : 'portion(s)'} · run {a.productionId}
                    </div>
                    {a.packagedAt && <div style={{ fontSize: 11, color: T.statusApproved, fontFamily: T.fontBody, marginTop: 3 }}>Packaged {a.packagedAt}</div>}
                    {a.status === 'Pending Approval' && (
                      <div style={{ fontSize: 11, color: T.statusPending, fontFamily: T.fontBody, marginTop: 3 }}>
                        Awaiting run sign-off in Approval Management.
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 16, color: T.textTertiary, lineHeight: 1, flexShrink: 0, alignSelf: 'center' }}>›</span>
                </div>
              </div>
            );
          })}
        </div>

        {packable.length > 0 && (
          <div style={{ display: 'flex', gap: 10, padding: '10px 14px', background: T.bgSurface, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
            <button onClick={() => setPicked(picked.length === packable.length ? [] : packable.map((a) => a.id))}
              style={{ flex: 1, padding: '13px 0', background: 'none', border: `2px solid ${T.borderStrong}`, borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: T.textSecondary, fontFamily: T.fontBody, cursor: 'pointer' }}>
              {picked.length === packable.length ? 'Clear' : `Select All (${packable.length})`}
            </button>
            <button onClick={() => setView('labels')} disabled={pickedRows.length === 0}
              title={pickedRows.length === 0 ? 'Tick the labels to print' : 'Print the selected labels, then scan to complete'}
              style={{ flex: 2, padding: '13px 0', background: pickedRows.length ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: pickedRows.length ? 'pointer' : 'not-allowed', opacity: pickedRows.length ? 1 : 0.7 }}>
              Print Labels{pickedRows.length ? ` (${pickedRows.length})` : ''}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Flight list ───────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Packaging</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
            {groups.length} flight{groups.length === 1 ? '' : 's'} · {inPackaging} to pack
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
        {notice && (
          <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusMd, padding: '9px 12px', marginBottom: 10, fontSize: 11, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>
            {notice}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <KPICard label="Pending Approval" value={pendingApproval} sub="Awaiting sign-off" accent={T.statusPending} />
          <KPICard label="In Packaging"     value={inPackaging}     sub="On the floor"     accent={T.statusInfo} />
          <KPICard label="Packaged"         value={packaged}        sub="Ready to dispatch" accent={T.statusApproved} />
          <KPICard label="Flights"          value={groups.length}   sub="In this list"     accent={T.statusScheduled} />
        </div>

        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search flight, item, run…" style={{ ...INPUT, marginTop: 12 }} />

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
          {groups.length} flight{groups.length === 1 ? '' : 's'}
        </div>

        {groups.length === 0 ? (
          <Empty icon="📦" text={allocations.length === 0
            ? 'No packaging runs yet. Runs are started from New Packaging on the web.'
            : 'No packaging runs match the current filter.'} />
        ) : groups.map((g) => {
          const toPack = g.allocations.filter((a) => a.status === 'In Packaging').length;
          const done = g.allocations.filter(isPackaged).length;
          const waiting = g.allocations.filter(isAwaitingApproval).length;
          const pct = g.allocations.length > 0 ? Math.round((done / g.allocations.length) * 100) : 0;
          return (
            <div key={g.key} onClick={() => { setActiveKey(g.key); setPicked([]); setView('flight'); }}
              style={{ ...CARD, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div style={{ flex: 1, paddingRight: 8, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                    {g.flight}
                    {g.sector && <span style={{ fontSize: 11, fontWeight: 400, color: T.textTertiary, marginLeft: 6 }}>{g.sector}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                    {g.date}{g.depTime ? ` · Dep ${g.depTime}` : ''}{g.orderNo ? ` · ${g.orderNo}` : ''}
                  </div>
                </div>
                <Chip
                  label={toPack > 0 ? `${toPack} to pack` : done === g.allocations.length ? 'Packaged' : 'Awaiting'}
                  color={toPack > 0 ? T.statusInfo : done === g.allocations.length ? T.statusApproved : T.statusPending}
                  bg={toPack > 0 ? T.statusInfoBg : done === g.allocations.length ? T.statusApprovedBg : T.statusPendingBg}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, marginTop: 6 }}>
                <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>Packed</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{done} / {g.allocations.length} · {pct}%</span>
              </div>
              <div style={{ height: 6, borderRadius: T.radiusFull, background: T.bgSubtle, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? T.statusApproved : T.primary }} />
              </div>

              {waiting > 0 && (
                <div style={{ fontSize: 11, color: T.statusPending, fontFamily: T.fontBody, marginTop: 7 }}>
                  {waiting} run{waiting === 1 ? '' : 's'} awaiting approval
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
