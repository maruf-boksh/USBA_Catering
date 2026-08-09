import { useMemo, useState } from 'react';
import { T } from '../theme';
import { KPICard } from '../components/KPICard';
// The dispatch board on the phone, on the WEB's own records — the same
// "dispatch-records" store routes/dispatch.tsx persists to. A delay run or a
// packaging run that reaches dispatch appears here, and advancing a record's
// status writes the same status + trail entry the web writes.
import { INITIAL_RECORDS } from '@/routes/dispatch';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };
const CARD = { background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm };
const SECTION = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 2px 8px' };

const DISPATCH_KEY = 'harvest-data-v1:dispatch-records';

// The web's own lifecycle, in order — each step is the next one offered.
const FLOW = ['Preparing', 'Prepared', 'Ready For QC', 'Ready For Dispatch', 'Dispatched'];
const DSTATUS = {
  'Preparing':          { color: T.statusPending,  bg: T.statusPendingBg },
  'Prepared':           { color: T.statusInfo,     bg: T.statusInfoBg },
  'Ready For QC':       { color: T.statusBoarding, bg: T.statusBoardingBg },
  'Ready For Dispatch': { color: T.statusBoarding, bg: T.statusBoardingBg },
  'Dispatched':         { color: T.statusApproved, bg: T.statusApprovedBg },
  'Returned':           { color: T.statusRejected, bg: T.statusRejectedBg },
};

const num = (v) => Number(v) || 0;
const p2 = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const nowTime = () => { const d = new Date(); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };

function readRecords() {
  try {
    const raw = localStorage.getItem(DISPATCH_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return Array.isArray(saved) ? saved : INITIAL_RECORDS;
  } catch { return INITIAL_RECORDS; }
}
function writeRecords(list) {
  try { localStorage.setItem(DISPATCH_KEY, JSON.stringify(list)); } catch { /* quota — non-fatal */ }
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

/** `embedded` — rendered inside the Dispatch hub, which supplies the topbar. */
export function DispatchScreen({ nav, embedded = false }) {
  const [records, setRecords] = useState(() => readRecords());
  const [activeId, setActiveId] = useState(null);
  const [query, setQuery]   = useState('');
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const flash = (m) => { setNotice(m); setTimeout(() => setNotice(''), 3000); };

  const counts = useMemo(() => ({
    preparing: records.filter((r) => r.status === 'Preparing').length,
    ready: records.filter((r) => r.status === 'Ready For Dispatch').length,
    dispatched: records.filter((r) => r.status === 'Dispatched').length,
  }), [records]);

  const visible = records.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (!query.trim()) return true;
    const hay = `${r.id} ${(r.flightNos ?? []).join(' ')} ${r.kitchenName ?? ''} ${r.date}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });
  const sorted = [...visible].sort((a, b) =>
    String(b.date ?? '').localeCompare(String(a.date ?? '')) || String(a.depTime ?? '').localeCompare(String(b.depTime ?? '')));

  const active = records.find((r) => r.id === activeId) ?? null;

  /** Advance to the next step of the web's flow, stamping the trail as it does. */
  const advance = (rec) => {
    const at = FLOW.indexOf(rec.status);
    if (at < 0 || at >= FLOW.length - 1) return;
    const next = FLOW[at + 1];
    const list = records.map((r) => (r.id === rec.id
      ? {
          ...r, status: next,
          trail: [...(r.trail ?? []), { status: next, by: 'Mobile', date: todayStr(), time: nowTime() }],
          ...(next === 'Dispatched' ? { dispatchedBy: 'Mobile' } : {}),
        }
      : r));
    setRecords(list);
    writeRecords(list);
    flash(`${rec.id} — ${next}.`);
  };

  const mealCount = (r) =>
    (r.sections ?? []).reduce((s, sec) => s + (sec.rows ?? []).reduce((n, row) => n + num(row.qty), 0), 0);

  // ── Dispatch detail ───────────────────────────────────────────────────────
  if (active) {
    const r = active;
    const s = DSTATUS[r.status] ?? DSTATUS.Preparing;
    const at = FLOW.indexOf(r.status);
    const nextStep = at >= 0 && at < FLOW.length - 1 ? FLOW[at + 1] : null;
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => setActiveId(null)} style={BTN_BACK}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{(r.flightNos ?? []).join(', ') || r.id}</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{r.id} · {r.date}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          {notice && (
            <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusMd, padding: '9px 12px', marginBottom: 10, fontSize: 11, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>
              {notice}
            </div>
          )}

          <div style={CARD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                {mealCount(r).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400, color: T.textTertiary }}>meals</span>
              </span>
              <Chip label={r.status} color={s.color} bg={s.bg} />
            </div>
            <Row label="Flights" value={(r.flightNos ?? []).join(', ')} />
            <Row label="Dep Time" value={r.depTime} />
            <Row label="Kitchen" value={r.kitchenName} />
            <Row label="Date" value={r.date} />
            <Row label="Dispatched By" value={r.dispatchedBy} />
            <Row label="Airport Notified" value={r.notifiedAirport ? 'Yes' : ''} />
          </div>

          {/* Progress through the web's own dispatch flow */}
          <div style={SECTION}>Progress</div>
          <div style={CARD}>
            {FLOW.map((st, i) => {
              const done = at >= 0 && i < at;
              const here = at === i;
              return (
                <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                  <span style={{ width: 9, height: 9, borderRadius: T.radiusFull, flexShrink: 0,
                    background: here ? T.primary : done ? T.statusApproved : T.border }} />
                  <span style={{ flex: 1, fontSize: 12, fontFamily: T.fontBody, fontWeight: here ? 700 : 400,
                    color: here ? T.primary : done ? T.textPrimary : T.textTertiary }}>
                    {st}
                  </span>
                </div>
              );
            })}
          </div>

          {(r.sections ?? []).length > 0 && (
            <>
              <div style={SECTION}>Load</div>
              {r.sections.map((sec, i) => (
                <div key={i} style={CARD}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, marginBottom: 2 }}>
                    {sec.flightNo ?? sec.title ?? `Section ${i + 1}`}
                  </div>
                  {(sec.rows ?? []).map((row, j) => (
                    <Row key={j} label={row.mealName ?? row.item ?? '—'} value={num(row.qty).toLocaleString()} />
                  ))}
                </div>
              ))}
            </>
          )}

          {(r.trail ?? []).length > 0 && (
            <>
              <div style={SECTION}>Status Trail</div>
              <div style={CARD}>
                {r.trail.map((t, i) => (
                  <Row key={i} label={t.status} value={`${t.by} · ${t.date} ${t.time}`} />
                ))}
              </div>
            </>
          )}
        </div>

        {nextStep && (
          <div style={{ padding: '10px 14px', background: T.bgSurface, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
            <button onClick={() => advance(r)}
              style={{ width: '100%', padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
              Mark {nextStep}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Board ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      {!embedded && (
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Dispatch</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{records.length} dispatches</div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
        {notice && (
          <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}30`, borderRadius: T.radiusMd, padding: '9px 12px', marginBottom: 10, fontSize: 11, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>
            {notice}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <KPICard label="Total"      value={records.length}     sub="On the board"   accent={T.statusInfo} />
          <KPICard label="Preparing"  value={counts.preparing}   sub="Being built"    accent={T.statusPending} />
          <KPICard label="Ready"      value={counts.ready}       sub="To load"        accent={T.statusBoarding} />
          <KPICard label="Dispatched" value={counts.dispatched}  sub="Gone to gate"   accent={T.statusApproved} />
        </div>

        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search flight, dispatch id…" style={{ ...INPUT, marginTop: 12 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 0' }}>
          <button onClick={() => setFilter('all')}
            style={{ flexShrink: 0, padding: '8px 14px', borderRadius: T.radiusFull, border: `1px solid ${filter === 'all' ? T.primary : T.border}`, background: filter === 'all' ? T.primary : T.bgSurface, color: filter === 'all' ? '#fff' : T.textTertiary, fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
            All
          </button>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ ...INPUT, flex: 1, minWidth: 0, padding: '9px 10px', fontSize: 12, fontWeight: 700 }}>
            <option value="all">All statuses</option>
            {Object.keys(DSTATUS).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div style={{ ...SECTION, marginTop: 12 }}>
          {sorted.length} dispatch{sorted.length === 1 ? '' : 'es'}
        </div>

        {sorted.length === 0 ? (
          <Empty icon="🚛" text={records.length === 0 ? 'No dispatches yet.' : 'No dispatches match the current filter.'} />
        ) : sorted.map((r) => {
          const s = DSTATUS[r.status] ?? DSTATUS.Preparing;
          return (
            <div key={r.id} onClick={() => setActiveId(r.id)} style={{ ...CARD, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                    {(r.flightNos ?? []).join(', ') || r.id}
                  </div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                    {r.id} · {r.date}{r.depTime ? ` · Dep ${r.depTime}` : ''}
                  </div>
                </div>
                <Chip label={r.status} color={s.color} bg={s.bg} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span style={{ fontSize: 11.5, color: T.textSecondary, fontFamily: T.fontBody }}>
                  {r.kitchenName || 'Kitchen'}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                  {mealCount(r).toLocaleString()} meals
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
