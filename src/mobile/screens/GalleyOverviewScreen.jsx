import { useMemo, useState } from 'react';
import { T } from '../theme';
import { KPICard } from '../components/KPICard';
import { Combobox } from '../components/Combobox';
// The web Galley Plan module, on the phone, on the SAME records — nothing is
// mocked and no parallel store is introduced:
//
//   worklist    loadDispatchEntries() + the "galley-manual-entries" list the
//               web's "+ New Galley Plan" writes, deduped by flight|date
//   plan        buildInitialGalley() seeds it, getGalleySections() supplies the
//               lines, computeAutoTotals() keeps the subtotals honest
//   draft       loadDrafts / persistDrafts (sessionStorage "galley_plan_drafts")
//   forward     a GalleyLoadingRecord via saveGalleyRecords(), plus the same
//               consumable allocation + stock deduction the web forward makes
//
// Statuses, lifecycle and gating are the web's: a flight can only be forwarded
// once it has been planned, and a forwarded plan is read-only.
import {
  flights, flightLabel, nowTimeStr,
  loadDispatchEntries, loadGalleyRecords, saveGalleyRecords,
  scaleDispatchMeals, buildInitialGalley,
} from '@/routes/dispatch-monitoring';
import { getGalleySections, computeAutoTotals } from '@/lib/galley-items';
import { filterEnabledGalleyItems } from '@/lib/galley-item-scope';
import { getGalleyGroups } from '@/lib/galley-groups';
import { loadDrafts, persistDrafts } from '@/lib/galley-drafts';
import { getFlightOrders } from '@/lib/flight-orders-store';
import { resolveFlightOrder, resolveReturnLeg } from '@/lib/order-chain';
import { getAuthUser } from '@/lib/auth';
import { consumableItems, activeWarehouses } from '@/lib/sample-data';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const LABEL = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };
const CARD = { background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm };
const SECTION = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 2px 8px' };

// Galley plan lifecycle → label + colour (mirrors the web Galley Plan chips),
// plus the two pre-forward states the web list also shows.
const GSTATUS = {
  not_planned:       { label: 'Not Planned',       color: T.textTertiary,   bg: T.bgSubtle },
  draft:             { label: 'Draft',             color: '#0EA5E9', bg: '#e0f2fe' },
  forwarded:         { label: 'Forwarded',         color: '#0EA5E9', bg: '#e0f2fe' },
  loading:           { label: 'Loading',           color: '#D97706', bg: '#fffbeb' },
  completed:         { label: 'Loaded',            color: '#16A34A', bg: '#f0fdf4' },
  awaiting_approval: { label: 'Awaiting Approval', color: '#7C3AED', bg: '#f5f3ff' },
  approved:          { label: 'Approved',          color: '#0F7A40', bg: '#ecfdf5' },
};
const FILTERS = ['all', 'not_planned', 'draft', 'forwarded', 'loading', 'completed', 'awaiting_approval', 'approved'];
const FILTER_LABEL = { all: 'All', ...Object.fromEntries(Object.entries(GSTATUS).map(([k, v]) => [k, v.label])) };

const LSK = (k) => `harvest-data-v1:${k}`;
function readLS(key, fallback) {
  try { const raw = localStorage.getItem(LSK(key)); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeLS(key, val) {
  try { localStorage.setItem(LSK(key), JSON.stringify(val)); } catch { /* quota — non-fatal */ }
}

const num = (v) => Number(v) || 0;
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const warehouseNameOf = (id) => activeWarehouses.find((w) => w.id === id)?.name ?? id;

/**
 * Build a consumable allocation from a galley plan and post it to Inventory,
 * deducting stock from the chosen source — the same write the web's forward
 * makes, so a plan forwarded from the phone reaches Flight Allocation and the
 * consumable stock moves exactly once.
 */
function allocateConsumables(plan, flight, sector, date, schedTime, source) {
  const saved = readLS('airline-consumables-items', consumableItems);
  const have = new Set(saved.map((c) => c.id));
  const missing = consumableItems.filter((c) => !have.has(c.id));
  const master = missing.length ? [...saved, ...missing] : saved;
  const qtyById = new Map();
  const lines = [];
  for (const m of master) {
    const qty = num(plan[m.id]);
    if (qty <= 0) continue;
    qtyById.set(m.id, qty);
    lines.push({ itemId: m.id, itemName: m.name, qty, uom: m.uom });
  }
  if (lines.length === 0) return 0;
  const stamp = Date.now().toString(36).slice(-5).toUpperCase();
  const alloc = {
    id: `FA-G${stamp}`, date, scheduledTime: schedTime, flight, sector, lines,
    officeId: source.officeId, warehouseId: source.warehouseId,
    warehouseName: warehouseNameOf(source.warehouseId),
  };
  writeLS('consumable-allocations', [alloc, ...readLS('consumable-allocations', [])]);
  writeLS('airline-consumables-items', master.map((it) =>
    qtyById.has(it.id) ? { ...it, stock: it.stock - (qtyById.get(it.id) ?? 0) } : it,
  ));
  return lines.length;
}

// ── Shared bits ─────────────────────────────────────────────────────────────
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

function Row({ label, value, unit }) {
  const v = String(value ?? '').trim();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '7px 0', borderTop: `1px solid ${T.border}` }}>
      <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, whiteSpace: 'nowrap' }}>
        {v === '' ? '—' : v}{unit && v !== '' ? <span style={{ fontSize: 10, fontWeight: 400, color: T.textTertiary, marginLeft: 3 }}>{unit}</span> : null}
      </span>
    </div>
  );
}

export function GalleyOverviewScreen({ nav }) {
  // ── Worklist: dispatched entries + flight-wise plans, deduped by flight|date
  const [dispatchEntries] = useState(() => loadDispatchEntries());
  const [manualEntries, setManualEntries] = useState(() => readLS('galley-manual-entries', []));
  const [records, setRecords] = useState(() => loadGalleyRecords());
  const [drafts, setDrafts] = useState(() => loadDrafts());

  const [view, setView]         = useState('list');   // 'list' | 'plan' | 'sheet'
  const [activeId, setActiveId] = useState(null);
  const [query, setQuery]       = useState('');
  const [filter, setFilter]     = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [notice, setNotice]     = useState('');
  const flash = (m) => { setNotice(m); setTimeout(() => setNotice(''), 2800); };

  // "+ New" — start a plan flight-wise from the order book, like the web dialog.
  const [showNew, setShowNew]   = useState(false);
  const [newFlight, setNewFlight] = useState('');
  const [newDate, setNewDate]   = useState('');

  const entries = useMemo(() => {
    const byKey = new Set(dispatchEntries.map((e) => `${e.flightId}|${e.packagingDate}`));
    const out = [...dispatchEntries];
    for (const e of manualEntries) {
      const key = `${e.flightId}|${e.packagingDate}`;
      if (byKey.has(key)) continue;
      byKey.add(key);
      out.unshift(e);
    }
    return out;
  }, [dispatchEntries, manualEntries]);

  const recByEntry = useMemo(() => {
    const m = new Map();
    for (const r of records) m.set(r.dispatchEntryId, r);
    return m;
  }, [records]);

  const flightOrders = useMemo(() => getFlightOrders(), []);
  const airlineByFlight = useMemo(() => {
    const m = new Map();
    for (const o of flightOrders) if (o.flight && o.airline) m.set(o.flight, o.airline);
    return m;
  }, [flightOrders]);
  const airlineOf = (f) => (f && airlineByFlight.get(f)) || '—';
  const orderFor = (f, date) => (f ? resolveFlightOrder({ flight: f, date }, flightOrders) : undefined);
  const returnLegFor = (f, date) => resolveReturnLeg(orderFor(f, date), flightOrders)?.order;
  const flightOf = (e) => flights.find((x) => x.id === e.flightId);
  const etdOf = (e) => { const f = flightOf(e); return f?.dep && f.dep !== '—' ? f.dep : ''; };

  const rowStatus = (id) => recByEntry.get(id)?.galleyStatus ?? (drafts[id] ? 'draft' : 'not_planned');

  // KPIs — the web's four.
  const pendingCount  = entries.filter((e) => !recByEntry.has(e.id)).length;
  const approvedCount = records.filter((r) => r.galleyStatus === 'approved').length;
  const inFlowCount   = records.length - approvedCount;

  const visible = entries.filter((e) => {
    if (filter !== 'all' && rowStatus(e.id) !== filter) return false;
    if (dateFrom && e.packagingDate < dateFrom) return false;
    if (dateTo && e.packagingDate > dateTo) return false;
    if (!query.trim()) return true;
    const f = flightOf(e);
    const hay = `${f?.flight ?? e.flightId} ${f?.sector ?? ''} ${airlineOf(f?.flight)} ${f?.aircraft ?? ''} ${e.packagingDate}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });
  const sorted = [...visible].sort((a, b) =>
    `${a.packagingDate} ${etdOf(a) || '99:99'}`.localeCompare(`${b.packagingDate} ${etdOf(b) || '99:99'}`));

  // ── Planner state ─────────────────────────────────────────────────────────
  const [plan, setPlan]       = useState({});
  const [planPax, setPlanPax] = useState(0);
  const [planCrew, setPlanCrew] = useState(0);
  const [planTab, setPlanTab] = useState('meals');
  const [openSec, setOpenSec] = useState({});
  const [source, setSource]   = useState({ officeId: 'OFF-001', warehouseId: 'WH-001' });

  const galleySections = useMemo(() => getGalleySections(filterEnabledGalleyItems()), []);
  const galleyGroups   = useMemo(() => getGalleyGroups(), []);
  const planTabs = useMemo(
    () => [{ id: 'meals', label: 'Meals' },
      ...galleyGroups.filter((g) => galleySections.some((s) => s.group === g.id))],
    [galleyGroups, galleySections],
  );

  const activeEntry = entries.find((e) => e.id === activeId);
  const activeFlight = activeEntry ? flightOf(activeEntry) : undefined;
  const activeRec = activeId ? recByEntry.get(activeId) : undefined;
  const activeReturn = activeEntry ? returnLegFor(activeFlight?.flight, activeEntry.packagingDate) : undefined;

  /** Standard-derived quantities for a load — the web's own seed builder. */
  const seedPlan = (entry, flight, pax, crew, ret) =>
    buildInitialGalley(entry, { ...(flight ?? {}), pax, crew }, ret);

  const openPlanner = (entry) => {
    const f = flightOf(entry);
    const ret = returnLegFor(f?.flight, entry.packagingDate);
    const retLoad = ret ? { pax: num(ret.pax), crew: num(ret.crew) } : undefined;
    const ord = orderFor(f?.flight, entry.packagingDate);
    const pax = num(ord?.pax) || num(f?.pax);
    const crew = num(ord?.crew) || num(f?.crew) || 7;
    const saved = recByEntry.get(entry.id)?.galleyPlan ?? drafts[entry.id]?.plan;
    setPlanPax(pax);
    setPlanCrew(crew);
    setPlan({ ...seedPlan(entry, f, pax, crew, retLoad), ...(saved ?? {}) });
    setSource(drafts[entry.id]?.source ?? { officeId: 'OFF-001', warehouseId: 'WH-001' });
    setPlanTab('meals');
    setOpenSec({});
    setActiveId(entry.id);
    setView('plan');
  };

  /** Editing the load re-derives the standard-driven quantities, as on the web. */
  const reload = (pax, crew) => {
    if (!activeEntry) return;
    const ret = activeReturn ? { pax: num(activeReturn.pax), crew: num(activeReturn.crew) } : undefined;
    setPlan((prev) => ({ ...prev, ...seedPlan(activeEntry, activeFlight, pax, crew, ret) }));
  };

  const setField = (k, v) => setPlan((prev) => ({ ...prev, [k]: v }));
  // Auto subtotals are never typed — they are recomputed from their own lines.
  const autos = useMemo(() => computeAutoTotals(plan, filterEnabledGalleyItems()), [plan]);
  const valueOf = (f) => (f.auto ? (autos[f.k] ?? '0') : (plan[f.k] ?? ''));

  const saveDraft = () => {
    if (!activeEntry) return;
    const next = { ...drafts, [activeEntry.id]: { plan, savedAt: nowTimeStr(), source } };
    setDrafts(next);
    persistDrafts(next);
    setView('list');
    flash('Galley plan saved — forward it to aircraft from the list.');
  };

  /** The forwarded record the web creates: preparer stamped, status forwarded,
   *  consumables allocated on the FIRST forward only. */
  const forwardPlan = (entryId, thePlan, src) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    if (!src?.warehouseId) { flash('Pick a transfer warehouse first.'); return; }
    const user = getAuthUser();
    const blank = { name: '', designation: '', signedAt: '' };
    const rec = {
      id: `GL-${Date.now().toString(36)}`,
      dispatchEntryId: entryId,
      flightId: entry.flightId,
      flightLabel: flightLabel(entry.flightId),
      date: entry.packagingDate,
      galleyPlan: thePlan,
      signOff: {
        preparedBy: { name: user?.name ?? '—', designation: user?.role ?? 'APT Executive', signedAt: nowTimeStr() },
        physicallyHandedBy: { ...blank },
        flightCheckedBy: { ...blank },
        handedOverBy: { ...blank },
      },
      galleyStatus: 'forwarded',
      forwardedAt: nowTimeStr(),
      sourceOfficeId: src.officeId,
      sourceWarehouseId: src.warehouseId,
    };
    const firstForward = !recByEntry.has(entryId);
    const next = [...records.filter((r) => r.dispatchEntryId !== entryId), rec];
    setRecords(next);
    saveGalleyRecords(next);
    if (drafts[entryId]) {
      const d = { ...drafts };
      delete d[entryId];
      setDrafts(d);
      persistDrafts(d);
    }
    let msg = '';
    if (firstForward) {
      const fl = flightOf(entry);
      const n = allocateConsumables(thePlan, fl?.flight ?? entry.flightId, fl?.sector ?? '', entry.packagingDate, fl?.dep ?? '', src);
      if (n > 0) msg = ` · ${n} consumable line${n === 1 ? '' : 's'} from ${warehouseNameOf(src.warehouseId)}`;
    } else {
      msg = ' · consumables already allocated';
    }
    setActiveId(null);
    setView('list');
    flash(`Forwarded to aircraft loading${msg}.`);
  };

  const forwardDraft = (entryId) => {
    const d = drafts[entryId];
    if (!d) return;
    forwardPlan(entryId, d.plan, d.source ?? { officeId: 'OFF-001', warehouseId: 'WH-001' });
  };

  // ── "+ New Galley Plan" ───────────────────────────────────────────────────
  const newFlightOptions = useMemo(() => {
    const seen = new Set();
    const opts = [];
    for (const o of flightOrders) {
      if ((o.orderType ?? 'flight') === 'crew' || o.direction !== 'Outbound') continue;
      if (seen.has(o.flight)) continue;
      const fo = flights.find((f) => f.flight === o.flight);
      if (!fo) continue;
      seen.add(o.flight);
      opts.push({ flight: o.flight, flightId: fo.id, sector: o.sector, etd: o.etd, date: o.date, airline: o.airline });
    }
    return opts.sort((a, b) => a.flight.localeCompare(b.flight));
  }, [flightOrders]);

  const newOpt = newFlightOptions.find((o) => o.flight === newFlight);
  const newRet = newOpt ? returnLegFor(newOpt.flight, newDate || newOpt.date) : undefined;

  const createNewPlan = () => {
    if (!newOpt) { flash('Pick a flight first.'); return; }
    const date = newDate || newOpt.date;
    const existing = entries.find((e) => e.flightId === newOpt.flightId && e.packagingDate === date);
    setShowNew(false);
    if (existing) { openPlanner(existing); flash(`${newOpt.flight} on ${date} is already listed — opening it.`); return; }
    const ord = orderFor(newOpt.flight, date);
    const entry = {
      id: `GALLEY-${Date.now().toString(36)}`,
      flightId: newOpt.flightId, packagingDate: date,
      mealLines: [{ type: 'Regular', qty: ord?.pax > 0 ? String(ord.pax) : '' }],
      vehicleNo: '', vehicleClean: 'Yes', chilledTemp: '', frozenTemp: '',
      loadStartTime: '', loadEndTime: '', vehicleTempBegin: '', vehicleTempEnd: '',
      resultSatisfy: 'Yes', gateTempGate08: '', unloadingTime: '', checkedByApt: '',
      monitoredByRemarks: '', monitoredAt: '', approvalStage: 0,
      receivedBy: '', receivedDesignation: '', receivedAt: '', receivedRemarks: '',
    };
    const next = [entry, ...manualEntries];
    setManualEntries(next);
    writeLS('galley-manual-entries', next);
    openPlanner(entry);
  };

  // Meals are integrated live from Dispatch, for both legs of the rotation.
  const meals = activeFlight ? scaleDispatchMeals(activeFlight.flight, planPax, planCrew, num(activeFlight.crew) || planCrew)?.scaled : null;
  const retMeals = activeReturn
    ? scaleDispatchMeals(activeReturn.flight, num(activeReturn.pax), num(activeReturn.crew), num(activeReturn.crew))?.scaled
    : null;

  // ── Planner ───────────────────────────────────────────────────────────────
  if (view === 'plan' && activeEntry) {
    const secs = galleySections.filter((s) => s.group === planTab);
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Galley Plan</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {activeFlight?.flight ?? activeEntry.flightId} · {activeEntry.packagingDate}
              {activeReturn ? ` · ↩ ${activeReturn.flight}` : ''}
            </div>
          </div>
        </div>

        {/* Stage tabs — Meals first, then every galley group that has lines */}
        <div style={{ display: 'flex', overflowX: 'auto', background: T.bgSurface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          {planTabs.map((t) => {
            const on = planTab === t.id;
            return (
              <button key={t.id} onClick={() => setPlanTab(t.id)}
                style={{ flexShrink: 0, padding: '10px 14px 8px', background: 'none', border: 'none', borderBottom: `2px solid ${on ? T.primary : 'transparent'}`, cursor: 'pointer', fontFamily: T.fontBody, fontSize: 12, fontWeight: 700, color: on ? T.primary : T.textTertiary, whiteSpace: 'nowrap' }}>
                {t.label}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          {/* Load summary — editing PAX / Crew re-derives the standard quantities */}
          <div style={CARD}>
            <div style={{ ...LABEL, marginBottom: 8 }}>Load Summary</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ ...LABEL, marginBottom: 4 }}>PAX</div>
                <input type="number" inputMode="numeric" value={planPax}
                  onChange={(e) => { const v = num(e.target.value); setPlanPax(v); reload(v, planCrew); }}
                  style={{ ...INPUT, fontWeight: 700 }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ ...LABEL, marginBottom: 4 }}>Crew</div>
                <input type="number" inputMode="numeric" value={planCrew}
                  onChange={(e) => { const v = num(e.target.value); setPlanCrew(v); reload(planPax, v); }}
                  style={{ ...INPUT, fontWeight: 700 }} />
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ ...LABEL, marginBottom: 4 }}>Transfer From</div>
              <Combobox
                value={warehouseNameOf(source.warehouseId)}
                onChange={(v) => {
                  const w = activeWarehouses.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
                  if (w) setSource({ officeId: w.officeId ?? 'OFF-001', warehouseId: w.id });
                }}
                options={activeWarehouses.map((w) => w.name)}
                placeholder="Source warehouse"
              />
            </div>
            <Row label="Sector" value={activeFlight?.sector ?? '—'} />
            <Row label="Aircraft" value={activeFlight?.aircraft ?? '—'} />
            <Row label="Total Meal Load" value={plan.totalMealLoad} />
          </div>

          {/* Meals — integrated from Dispatch, read-only (the web behaves the same) */}
          {planTab === 'meals' && (
            <>
              <div style={SECTION}>Departure Meals</div>
              <div style={CARD}>
                {meals ? (
                  <>
                    {meals.paxLines.map((l, i) => <Row key={`${l.itemName}-${i}`} label={l.itemName} value={l.qty} />)}
                    {meals.crewMeals.map((c, i) => <Row key={`c${i}`} label={`Crew · ${c.type}`} value={c.qty} />)}
                    <Row label="Special (VGML/CHML/SPML)" value={meals.specialTotal} />
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, padding: '4px 0' }}>
                    No dispatched meal plan for this flight yet.
                  </div>
                )}
              </div>
              {activeReturn && (
                <>
                  <div style={SECTION}>Return Leg · {activeReturn.flight}</div>
                  <div style={CARD}>
                    {retMeals ? (
                      <>
                        {retMeals.paxLines.map((l, i) => <Row key={`r${i}`} label={l.itemName} value={l.qty} />)}
                        <Row label="Special (VGML/CHML/SPML)" value={retMeals.specialTotal} />
                      </>
                    ) : (
                      <Row label="PAX / Crew" value={`${activeReturn.pax ?? '—'} / ${activeReturn.crew ?? '—'}`} />
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* Galley group lines — one collapsible block per section */}
          {planTab !== 'meals' && (
            secs.length === 0 ? (
              <Empty icon="📦" text="No lines configured in this group." />
            ) : secs.map((s) => {
              const open = openSec[s.title] !== false;
              return (
                <div key={s.title} style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
                  <button onClick={() => setOpenSec((p) => ({ ...p, [s.title]: !open }))}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: T.bgSubtle, border: 'none', borderBottom: open ? `1px solid ${T.border}` : 'none', padding: '10px 14px', cursor: 'pointer' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.title}</span>
                    <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{s.fields.length} · {open ? '▾' : '▸'}</span>
                  </button>
                  {open && (
                    <div style={{ padding: '4px 14px 10px' }}>
                      {s.fields.map((f) => (
                        <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: `1px solid ${T.border}` }}>
                          <span style={{ flex: 1, fontSize: 12, color: T.textPrimary, fontFamily: T.fontBody }}>
                            {f.label}
                            {f.unit && <span style={{ fontSize: 10, color: T.textTertiary, marginLeft: 4 }}>{f.unit}</span>}
                          </span>
                          <input
                            type="number" inputMode="decimal"
                            value={valueOf(f)}
                            readOnly={f.auto}
                            onChange={(e) => setField(f.k, e.target.value)}
                            style={{ ...INPUT, width: 84, padding: '8px 10px', textAlign: 'right', fontWeight: 700,
                              background: f.auto ? T.bgSubtle : T.bgSurface, color: f.auto ? T.textTertiary : T.textPrimary }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Save / Forward — a plan must be saved or forwarded from here */}
        <div style={{ display: 'flex', gap: 10, padding: '10px 14px', background: T.bgSurface, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
          <button onClick={saveDraft}
            style={{ flex: 1, padding: '13px 0', background: 'none', border: `2px solid ${T.borderStrong}`, borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: T.textSecondary, fontFamily: T.fontBody, cursor: 'pointer' }}>
            Save Draft
          </button>
          <button onClick={() => forwardPlan(activeEntry.id, plan, source)}
            style={{ flex: 2, padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
            Forward To Aircraft
          </button>
        </div>
      </div>
    );
  }

  // ── Read-only sheet of a forwarded plan ───────────────────────────────────
  if (view === 'sheet' && activeRec) {
    const g = GSTATUS[activeRec.galleyStatus] ?? GSTATUS.forwarded;
    const sign = [
      ['Prepared By', activeRec.signOff?.preparedBy],
      ['Physically Handed By', activeRec.signOff?.physicallyHandedBy],
      ['Flight Checked By', activeRec.signOff?.flightCheckedBy],
      ['Flight Handed Over By', activeRec.signOff?.handedOverBy],
    ];
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Galley Sheet</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{activeRec.flightLabel} · {activeRec.date}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          <div style={CARD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{activeRec.id}</span>
              <Chip label={g.label} color={g.color} bg={g.bg} />
            </div>
            <Row label="Forwarded At" value={activeRec.forwardedAt} />
            <Row label="Transferred From" value={warehouseNameOf(activeRec.sourceWarehouseId)} />
            <Row label="PAX / Crew Load" value={`${activeRec.galleyPlan?.depZenithLoad ?? '—'} / ${Math.max(0, num(activeRec.galleyPlan?.totalMealLoad) - num(activeRec.galleyPlan?.depZenithLoad)) || '—'}`} />
            {activeRec.approvedBy && <Row label="Approved By" value={activeRec.approvedBy} />}
          </div>

          <div style={SECTION}>Sign-Off</div>
          <div style={CARD}>
            {sign.map(([label, s]) => (
              <Row key={label} label={label} value={s?.name ? `${s.name}${s.signedAt ? ` · ${s.signedAt}` : ''}` : ''} />
            ))}
          </div>

          {/* The loaded sheet — only lines actually carrying a quantity */}
          {galleySections.map((s) => {
            const rows = s.fields.filter((f) => num(activeRec.galleyPlan?.[f.k]) > 0);
            if (rows.length === 0) return null;
            return (
              <div key={s.title}>
                <div style={SECTION}>{s.title}</div>
                <div style={CARD}>
                  {rows.map((f) => <Row key={f.k} label={f.label} value={activeRec.galleyPlan[f.k]} unit={f.unit} />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Worklist ──────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Galley Plan</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Plan · Forward · Track loading</div>
        </div>
        <button onClick={() => { setNewFlight(''); setNewDate(''); setShowNew(true); }}
          style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.55)', borderRadius: T.radiusMd, height: 30, padding: '0 12px', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, flexShrink: 0 }}>
          + New
        </button>
      </div>

      {showNew ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          <div style={{ ...LABEL, marginBottom: 8 }}>New Galley Plan</div>
          <div style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 14 }}>
            Pick a flight — its return leg is added automatically when the rotation is tagged with one.
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Flight *</div>
            <Combobox value={newFlight} onChange={setNewFlight}
              options={newFlightOptions.map((o) => o.flight)} placeholder="Flight number" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Date</div>
            <input type="date" value={newDate || newOpt?.date || ''} onChange={(e) => setNewDate(e.target.value)} style={INPUT} />
          </div>
          {newOpt && (
            <div style={CARD}>
              <Row label="Sector" value={newOpt.sector} />
              <Row label="Airline" value={newOpt.airline} />
              <Row label="ETD" value={newOpt.etd} />
              <Row label="Return Leg" value={newRet ? `${newRet.flight} · ${newRet.sector ?? ''}` : 'None tagged'} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button onClick={() => setShowNew(false)}
              style={{ flex: 1, padding: '13px 0', background: 'none', border: `2px solid ${T.borderStrong}`, borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: T.textSecondary, fontFamily: T.fontBody, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={createNewPlan} disabled={!newOpt}
              style={{ flex: 2, padding: '13px 0', background: newOpt ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: newOpt ? 'pointer' : 'not-allowed', opacity: newOpt ? 1 : 0.7 }}>
              Start Planning
            </button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          {notice && (
            <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusMd, padding: '9px 12px', marginBottom: 10, fontSize: 11, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>
              {notice}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <KPICard label="Dispatches"      value={entries.length} sub="To plan against" accent={T.statusScheduled} />
            <KPICard label="Awaiting Plan"   value={pendingCount}   sub="Not forwarded"   accent={T.statusDelayed} />
            <KPICard label="In Loading Flow" value={inFlowCount}    sub="Forwarded"       accent={T.statusBoarding} />
            <KPICard label="Approved"        value={approvedCount}  sub="Signed off"      accent={T.statusApproved} />
          </div>

          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search flight, sector, airline…" style={{ ...INPUT, marginTop: 12 }} />

          {/* Status + date range — the web's Galley Status dropdown and date
              range, sized for the phone: All stays a one-tap chip, the rest of
              the statuses live in the dropdown beside it. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 0' }}>
            <button onClick={() => setFilter('all')}
              style={{ flexShrink: 0, padding: '8px 14px', borderRadius: T.radiusFull, border: `1px solid ${filter === 'all' ? T.primary : T.border}`, background: filter === 'all' ? T.primary : T.bgSurface, color: filter === 'all' ? '#fff' : T.textTertiary, fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
              All
            </button>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}
              style={{ ...INPUT, flex: 1, minWidth: 0, padding: '9px 10px', fontSize: 12, fontWeight: 700 }}>
              {FILTERS.map((k) => (
                <option key={k} value={k}>{k === 'all' ? 'All statuses' : FILTER_LABEL[k]}</option>
              ))}
            </select>
            <button onClick={() => setDateOpen((v) => !v)}
              title="Filter by date range"
              style={{ flexShrink: 0, position: 'relative', padding: '8px 12px', borderRadius: T.radiusMd, border: `1px solid ${dateFrom || dateTo ? T.primary : T.border}`, background: dateFrom || dateTo ? T.primaryLight : T.bgSurface, color: dateFrom || dateTo ? T.primary : T.textTertiary, fontSize: 13, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
              📅
            </button>
          </div>

          {(dateOpen || dateFrom || dateTo) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date"
                style={{ ...INPUT, flex: 1, minWidth: 0, padding: '8px 8px', fontSize: 11.5 }} />
              <span style={{ fontSize: 12, color: T.textTertiary }}>→</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date"
                style={{ ...INPUT, flex: 1, minWidth: 0, padding: '8px 8px', fontSize: 11.5 }} />
              <button onClick={() => { const t = todayStr(); setDateFrom(t); setDateTo(t); }}
                style={{ flexShrink: 0, padding: '8px 10px', borderRadius: T.radiusMd, border: `1px solid ${T.border}`, background: T.bgSurface, color: T.textSecondary, fontSize: 11.5, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
                Today
              </button>
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo(''); }}
                  style={{ flexShrink: 0, background: 'none', border: 'none', color: T.textTertiary, fontSize: 11.5, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer', padding: '8px 2px' }}>
                  Clear
                </button>
              )}
            </div>
          )}

          <div style={{ ...SECTION, marginTop: 12 }}>
            {sorted.length} of {entries.length} flight{entries.length === 1 ? '' : 's'}
          </div>

          {sorted.length === 0 ? (
            <Empty icon="🍽️" text={entries.length === 0 ? 'No dispatches to plan.' : 'No flights match the current filter.'} />
          ) : sorted.map((e) => {
            const f = flightOf(e);
            const st = rowStatus(e.id);
            const g = GSTATUS[st] ?? GSTATUS.not_planned;
            const ret = returnLegFor(f?.flight, e.packagingDate);
            const ord = orderFor(f?.flight, e.packagingDate);
            return (
              <div key={e.id} style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <div style={{ flex: 1, paddingRight: 8, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                      {f?.flight ?? e.flightId}
                      <span style={{ fontSize: 11, fontWeight: 400, color: T.textTertiary, marginLeft: 6 }}>{f?.sector ?? '—'}</span>
                    </div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                      {airlineOf(f?.flight)} · {e.packagingDate}{etdOf(e) ? ` · ETD ${etdOf(e)}` : ''}
                    </div>
                  </div>
                  <Chip label={g.label} color={g.color} bg={g.bg} />
                </div>

                {/* A tagged rotation is ONE job — the return leg rides with it */}
                {ret && (
                  <div style={{ fontSize: 11, color: T.statusInfo, fontFamily: T.fontBody, background: T.statusInfoBg, border: `1px solid ${T.statusInfo}25`, borderRadius: T.radiusMd, padding: '5px 9px', margin: '2px 0 6px' }}>
                    ↩ {ret.flight} · {ret.sector ?? '—'}{ret.etd ? ` · ${ret.etd}` : ''} — planned together
                  </div>
                )}

                <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                  {[['PAX', f?.pax], ['Crew', f?.crew], ['Special', ord?.specialMeals]].map(([l, v]) => (
                    <span key={l} style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                      {l} <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary }}>{v ?? '—'}</span>
                    </span>
                  ))}
                </div>

                {/* The web's per-row actions, gated the same way */}
                <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                  {recByEntry.has(e.id) ? (
                    <button onClick={() => { setActiveId(e.id); setView('sheet'); }}
                      style={{ flex: 1, padding: '9px 0', background: 'none', border: `1px solid ${T.borderStrong}`, borderRadius: T.radiusMd, fontSize: 12, fontWeight: 700, color: T.textSecondary, fontFamily: T.fontBody, cursor: 'pointer' }}>
                      View Sheet
                    </button>
                  ) : st === 'draft' ? (
                    <>
                      <button onClick={() => openPlanner(e)}
                        style={{ flex: 1, padding: '9px 0', background: 'none', border: `1px solid ${T.primary}`, borderRadius: T.radiusMd, fontSize: 12, fontWeight: 700, color: T.primary, fontFamily: T.fontBody, cursor: 'pointer' }}>
                        Resume Draft
                      </button>
                      <button onClick={() => forwardDraft(e.id)}
                        style={{ flex: 1, padding: '9px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
                        Forward
                      </button>
                    </>
                  ) : (
                    <button onClick={() => openPlanner(e)}
                      style={{ flex: 1, padding: '9px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
                      Plan Galley
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
