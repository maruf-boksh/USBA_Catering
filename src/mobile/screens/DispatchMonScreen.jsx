import { useState, useEffect } from 'react';
import { T } from '../theme';
import { MOCK_FLIGHTS, MOCK_DISPATCHES } from '../mockData';

const TODAY = '2026-06-11';

function nowStr() {
  const n = new Date();
  return `${n.getHours().toString().padStart(2, '0')}:${n.getMinutes().toString().padStart(2, '0')}`;
}

// Container labels printed at the catering point for a dispatch — scanned to
// verify the load. A handful of containers rather than one per meal.
function labelsFor(flight, units) {
  const n = Math.min(6, Math.max(3, Math.ceil((units || 120) / 40)));
  return Array.from({ length: n }, (_, i) => `LBL-${flight}-${String(i + 1).padStart(2, '0')}`);
}

// Renders a scannable barcode (bars derived from the label code) — mirrors the
// packaging label printed at the catering point in the web version.
function Barcode({ code }) {
  const bars = code.split('').flatMap((ch, i) => {
    const n = ch.charCodeAt(0);
    return [2, (n % 3) + 1, 1, (n % 2) + 2].map((w, j) => ({ key: `${i}-${j}`, w, h: 26 + (n % 16) }));
  });
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 44, justifyContent: 'center', padding: '0 4px' }}>
      {bars.map(b => <div key={b.key} style={{ width: b.w, height: b.h, background: '#0f172a' }} />)}
    </div>
  );
}

// The printed catering-point label card revealed on scan (web "Meal Label").
function LabelCard({ code, flight, onScan, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 300, background: '#fff', borderRadius: T.radiusLg, overflow: 'hidden', boxShadow: T.shadowMd }}>
        <div style={{ background: T.statusApprovedBg, padding: '10px 14px', borderBottom: `1px solid ${T.statusApproved}30`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.statusApproved, fontFamily: T.fontBody }}>USBA Catering · Meal Label</div>
          <span onClick={onClose} style={{ fontSize: 16, color: T.textTertiary, cursor: 'pointer', lineHeight: 1 }}>×</span>
        </div>
        <div style={{ padding: '16px 16px 14px' }}>
          <Barcode code={code} />
          <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: '#0f172a', fontFamily: T.fontBody, marginTop: 8 }}>{code}</div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${T.border}` }}>
            {[['Flight', code.split('-').slice(1, -1).join('-') || flight], ['Batch', code.split('-').slice(-1)[0]], ['Cold Chain', '≤ +8°C']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, paddingBottom: 4 }}>
                <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', fontFamily: T.fontBody }}>{v}</span>
              </div>
            ))}
          </div>
          <button onClick={onScan}
            style={{ width: '100%', marginTop: 14, padding: '12px', fontFamily: T.fontBody, fontSize: 14, fontWeight: 700, color: '#fff', background: T.statusInfo, border: 'none', borderRadius: T.radiusMd, cursor: 'pointer' }}>
            Scan
          </button>
        </div>
      </div>
    </div>
  );
}

// Label-scan panel with a live timer. Tapping a label reveals its printed label
// card (barcode) — scanning it there marks it done. When `auto`, packaging is
// completed automatically once every label is scanned (no manual step).
function ScanPanel({ labels, flight, ctaLabel, doneLabel, onComplete, auto }) {
  const [scanned, setScanned] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [activeLabel, setActiveLabel] = useState(null);
  const allDone = scanned.length === labels.length;

  useEffect(() => {
    if (allDone) return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [allDone]);

  // Auto-complete (e.g. "packaging done") the moment everything is scanned.
  useEffect(() => {
    if (auto && allDone) onComplete();
  }, [auto, allDone, onComplete]);

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const scanActive = () => { setScanned(prev => prev.includes(activeLabel) ? prev : [...prev, activeLabel]); setActiveLabel(null); };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, background: T.bgSubtle, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '8px 12px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>⏱ {mmss}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: allDone ? T.statusApproved : T.statusPending, fontFamily: T.fontBody }}>{scanned.length}/{labels.length} scanned</div>
      </div>
      {labels.map(code => {
        const done = scanned.includes(code);
        return (
          <div key={code} onClick={() => !done && setActiveLabel(code)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: T.bgSurface, border: `1px solid ${done ? T.statusApproved + '50' : T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', marginBottom: 8, cursor: done ? 'default' : 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>{done ? '✅' : '🏷️'}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{code}</span>
            </div>
            {done
              ? <span style={{ fontSize: 10, fontWeight: 700, color: T.statusApproved, background: T.statusApprovedBg, padding: '3px 10px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>Scanned</span>
              : <span style={{ fontSize: 11, fontWeight: 700, color: T.statusInfo, background: T.statusInfoBg, padding: '6px 14px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>View label</span>}
          </div>
        );
      })}
      {allDone && (
        <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}40`, borderRadius: T.radiusMd, padding: '10px 14px', margin: '4px 0 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>{doneLabel} · {mmss}</div>
        </div>
      )}
      {!auto && (
        <button onClick={onComplete} disabled={!allDone}
          style={{ width: '100%', padding: '13px', fontFamily: T.fontBody, fontSize: 14, fontWeight: 700, color: '#fff', background: allDone ? T.statusApproved : T.textDisabled, border: 'none', borderRadius: T.radiusMd, cursor: allDone ? 'pointer' : 'not-allowed' }}>
          {ctaLabel}
        </button>
      )}
      {activeLabel && <LabelCard code={activeLabel} flight={flight} onScan={scanActive} onClose={() => setActiveLabel(null)} />}
    </div>
  );
}

const SEED_DISPATCHES = MOCK_DISPATCHES.map(d => ({
  ...d,
  monitoredAt: d.dispatchedAt ?? d.loadStart ?? '—',
  receivedAt: d.approvalStage === 4 ? (d.dispatchedAt ?? '05:50') : null,
  gateTemp: d.approvalStage === 4 ? '5.2' : null,
  unloadTime: d.approvalStage === 4 ? '06:10' : null,
}));

const BACK_BTN = {
  background: 'rgba(255,255,255,0.15)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: T.radiusFull,
  width: 32, height: 32,
  cursor: 'pointer', color: '#fff', fontSize: 16,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};

const INPUT_STYLE = {
  width: '100%', padding: '10px 12px', fontSize: 13,
  fontFamily: T.fontBody, border: `1px solid ${T.border}`,
  borderRadius: T.radiusMd, background: T.bgSurface,
  color: T.textPrimary, boxSizing: 'border-box', outline: 'none',
};

const ROW = { display: 'flex', justifyContent: 'space-between', paddingTop: 7, paddingBottom: 7, borderTop: `1px solid ${T.border}` };
const LABEL = { fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody };
const VALUE = { fontSize: 12, fontWeight: 600, fontFamily: T.fontBody, color: T.textPrimary, textAlign: 'right', maxWidth: '55%' };

function Card({ children, style }) {
  return (
    <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, boxShadow: T.shadowSm, ...style }}>
      {children}
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

function PrimaryBtn({ children, onClick, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', padding: '13px', fontFamily: T.fontBody, fontSize: 14, fontWeight: 700,
      color: '#fff', background: disabled ? T.textDisabled : T.statusApproved,
      border: 'none', borderRadius: T.radiusMd, cursor: disabled ? 'not-allowed' : 'pointer',
      ...style,
    }}>
      {children}
    </button>
  );
}

function SecondaryBtn({ children, onClick, style }) {
  return (
    <button onClick={onClick} style={{
      padding: '11px 16px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 600,
      color: T.textSecondary, background: T.bgSubtle, border: `1px solid ${T.border}`,
      borderRadius: T.radiusMd, cursor: 'pointer', ...style,
    }}>
      {children}
    </button>
  );
}

function ResultBadge({ value }) {
  if (!value) return <span style={{ color: T.textTertiary, fontSize: 12, fontFamily: T.fontBody }}>—</span>;
  const approved = value === 'Yes';
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, fontFamily: T.fontBody,
      color: approved ? T.statusApproved : T.statusRejected,
      background: approved ? T.statusApprovedBg : T.statusRejectedBg,
      padding: '2px 8px', borderRadius: T.radiusFull,
    }}>
      {value}
    </span>
  );
}

// ── Log Detail ──────────────────────────────────────────────────────────────
function LogDetail({ entry, onBack }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onBack} style={BACK_BTN}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Dispatch Details</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{entry.id} · {entry.flight}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.primary, fontFamily: T.fontBody }}>{entry.flight}</div>
            <ResultBadge value={entry.resultSatisfy} />
          </div>
          {[
            ['Dispatch ID',     entry.id],
            ['Date',            entry.packagingDate ?? TODAY],
            ['Vehicle',         entry.vehicleNo ?? '—'],
            ['Vehicle Clean',   entry.vehicleClean ?? '—'],
            ['Total Pax',       entry.items ? `${entry.items} units` : '—'],
            ['Chilled Temp',    entry.chilledTemp ?? '—'],
            ['Frozen Temp',     entry.frozenTemp ?? '—'],
            ['Van Temp Begin',  entry.vehicleTempBegin ?? '—'],
            ['Van Temp End',    entry.vehicleTempEnd ?? '—'],
            ['Gate 08 Temp',    entry.gateTemp ? `${entry.gateTemp}°C` : '—'],
            ['Monitored At',    entry.monitoredAt ?? '—'],
            ['Received At',     entry.receivedAt ?? '—'],
          ].map(([l, v]) => (
            <div key={l} style={ROW}>
              <span style={LABEL}>{l}</span>
              <span style={{ ...VALUE, color: l === 'Vehicle Clean' ? (v === 'Yes' ? T.statusApproved : v === 'No' ? T.statusRejected : T.textPrimary) : T.textPrimary }}>{v}</span>
            </div>
          ))}
        </Card>

        {/* Approval stages */}
        <Card>
          <SectionLabel>Approval Stages</SectionLabel>
          {[
            ['② Verified By', 'Food Safety & Hygiene Officer', entry.approvalStage >= 2],
            ['③ Approved By', 'Head of Catering (HoC)',        entry.approvalStage >= 3],
            ['④ Airport Receipt', 'Airport Catering Unit — Gate 08', entry.approvalStage >= 4],
          ].map(([stage, who, done]) => (
            <div key={stage} style={{ display: 'flex', gap: 10, paddingTop: 8, paddingBottom: 8, borderTop: `1px solid ${T.border}`, alignItems: 'flex-start' }}>
              <div style={{
                width: 20, height: 20, borderRadius: T.radiusFull, flexShrink: 0, marginTop: 1,
                background: done ? T.statusApproved : T.border,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {done && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3 5.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: done ? T.statusApproved : T.textTertiary, fontFamily: T.fontBody }}>{stage}</div>
                <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{who}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────
/** `embedded` — rendered inside the Dispatch hub, which already supplies the
 *  module topbar; its own stage tabs and every flow below are unchanged. */
export function DispatchMonScreen({ nav, embedded = false }) {
  const [tab, setTab] = useState('dispatch');
  const [dispatches, setDispatches] = useState(SEED_DISPATCHES);

  // Dispatch tab
  const [mScreen, setMScreen] = useState(1);
  const [mFlights, setMFlights] = useState([]);
  const [mVehicleNo, setMVehicleNo] = useState('');
  const [mVehicleClean, setMVehicleClean] = useState('');
  const [mChilledTemp, setMChilledTemp] = useState('');
  const [mFrozenTemp, setMFrozenTemp] = useState('');
  const [mVanStart, setMVanStart] = useState('');
  const [mVanEnd, setMVanEnd] = useState('');
  const [mResult, setMResult] = useState('');
  const [mDispatchedIds, setMDispatchedIds] = useState([]);
  const [mPackagingDone, setMPackagingDone] = useState(false);

  // Receive tab
  const [rScreen, setRScreen] = useState(1);
  const [rSelectedId, setRSelectedId] = useState('');
  const [rGateTemp, setRGateTemp] = useState('');
  const [rUnloadTime, setRUnloadTime] = useState('');
  const [rCheck1, setRCheck1] = useState(false);
  const [rCheck2, setRCheck2] = useState(false);
  const [rCheck3, setRCheck3] = useState(false);
  const [rRemarks, setRRemarks] = useState('');
  const [rAcceptedAt, setRAcceptedAt] = useState('');

  // Log tab
  const [mLogEntryId, setMLogEntryId] = useState(null);

  const pendingReceive = dispatches.filter(d => !d.receivedAt);
  const rSelected = dispatches.find(d => d.id === rSelectedId) ?? null;

  const confirmDispatch = () => {
    const at = nowStr();
    const newEntries = mFlights.map((fid, i) => {
      const f = MOCK_FLIGHTS.find(x => x.id === fid);
      return {
        id: `DSP-M${Date.now() + i}`,
        flight: f?.id ?? fid,
        route: f?.route ?? '—',
        departure: f?.departure ?? '—',
        items: f?.pax ?? 0,
        status: 'loading',
        approvalStage: 0,
        vehicleNo: mVehicleNo,
        vehicleClean: mVehicleClean === 'Clean' ? 'Yes' : 'No',
        chilledTemp: mChilledTemp ? `${mChilledTemp}°C` : null,
        frozenTemp: mFrozenTemp ? `${mFrozenTemp}°C` : null,
        vehicleTempBegin: mVanStart ? `${mVanStart}°C` : null,
        vehicleTempEnd: mVanEnd ? `${mVanEnd}°C` : null,
        resultSatisfy: mResult,
        packagingDate: TODAY,
        loadStart: at, loadEnd: null, dispatchedAt: at, driver: null,
        monitoredAt: at, receivedAt: null, gateTemp: null, unloadTime: null,
      };
    });
    setDispatches(prev => [...newEntries, ...prev]);
    setMDispatchedIds(newEntries.map(e => e.id));
    setMScreen(4);
  };

  const acceptReceipt = () => {
    const at = nowStr();
    setRAcceptedAt(at);
    setDispatches(prev => prev.map(d =>
      d.id === rSelectedId ? { ...d, receivedAt: at, gateTemp: rGateTemp, unloadTime: rUnloadTime, approvalStage: 4, sentToStore: true } : d
    ));
    setRScreen(4);
  };

  const resetDispatch = () => {
    setMScreen(1); setMFlights([]); setMVehicleNo(''); setMVehicleClean('');
    setMChilledTemp(''); setMFrozenTemp(''); setMVanStart(''); setMVanEnd('');
    setMResult(''); setMDispatchedIds([]); setMPackagingDone(false);
  };

  // Log filters — search + date range
  const [logSearch, setLogSearch] = useState('');
  const [logFrom, setLogFrom] = useState('');
  const [logTo, setLogTo] = useState('');

  const resetReceive = () => {
    setRScreen(1); setRSelectedId(''); setRGateTemp(''); setRUnloadTime('');
    setRCheck1(false); setRCheck2(false); setRCheck3(false);
    setRRemarks(''); setRAcceptedAt('');
  };

  // Log detail early return
  if (tab === 'log' && mLogEntryId) {
    const entry = dispatches.find(d => d.id === mLogEntryId);
    if (entry) return <LogDetail entry={entry} onBack={() => setMLogEntryId(null)} />;
  }

  const bottomNav = (
    <div style={{ display: 'flex', background: T.bgSurface, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
      {[['dispatch', '🚛', 'Dispatch'], ['receive', '✈️', 'Receive'], ['log', '📋', 'Log']].map(([key, icon, label]) => (
        <button key={key} onClick={() => setTab(key)} style={{
          flex: 1, padding: '8px 0', fontFamily: T.fontBody, fontSize: 10, fontWeight: 700,
          cursor: 'pointer', color: tab === key ? T.primary : T.textTertiary,
          background: 'none', border: 'none',
          borderTop: tab === key ? `2px solid ${T.primary}` : '2px solid transparent',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          {label}
        </button>
      ))}
    </div>
  );

  const topbar = (title, subtitle) => (
    <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <button onClick={() => nav.goBack()} style={BACK_BTN}>←</button>
      <div>
        <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{title}</div>
        {subtitle && <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{subtitle}</div>}
      </div>
    </div>
  );

  // ── DISPATCH TAB ──────────────────────────────────────────────────────────
  function renderDispatch() {

    // S4 — Dispatched confirmation
    if (mScreen === 4) {
      const dispatchedFlights = mFlights.map(fid => MOCK_FLIGHTS.find(f => f.id === fid)).filter(Boolean);
      const label = dispatchedFlights.length === 1
        ? `${dispatchedFlights[0].id} · ${dispatchedFlights[0].pax} pax`
        : `${dispatchedFlights.length} flights dispatched`;
      return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: T.radiusFull, border: `2px solid ${T.statusApproved}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 12 }}>✅</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 18, fontWeight: 700, color: T.textPrimary, marginBottom: 4 }}>Dispatched</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 13, color: T.textTertiary, marginBottom: 4 }}>{label}</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 12, color: T.textTertiary, marginBottom: 16 }}>Vehicle: {mVehicleNo} · {TODAY}</div>

          <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}40`, borderRadius: T.radiusMd, padding: '10px 14px', marginBottom: 10, width: '100%', boxSizing: 'border-box', textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>En route to Gate 08</div>
            <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>Awaiting APT scan at airport</div>
          </div>

          {mDispatchedIds.map(id => (
            <div key={id} style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 14px', marginBottom: 8, width: '100%', boxSizing: 'border-box' }}>
              <div style={ROW}><span style={LABEL}>Dispatch ID</span><span style={VALUE}>{id}</span></div>
              <div style={ROW}><span style={LABEL}>Status</span><span style={{ ...VALUE, color: T.statusPending }}>Awaiting APT verify</span></div>
            </div>
          ))}

          <PrimaryBtn onClick={resetDispatch} style={{ marginTop: 8 }}>+ New Dispatch</PrimaryBtn>
        </div>
      );
    }

    // S1 — Flight selection
    if (mScreen === 1) {
      return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
          <div style={{ background: T.statusPendingBg, border: `1px solid ${T.statusPending}50`, borderRadius: T.radiusMd, padding: '8px 12px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 14 }}>🌡️</span>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.statusPending, fontFamily: T.fontBody }}>Max. Temp. Limit: +8°C — Cold chain integrity must be maintained</div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, marginBottom: 10 }}>Select Flights</div>

          {MOCK_FLIGHTS.slice(0, 5).map(f => {
            const selected = mFlights.includes(f.id);
            const totalPax = f.pax;
            const vegQty = Math.round(totalPax * 0.12);
            const diabQty = Math.max(0, totalPax - Math.round(totalPax * 0.84) - vegQty);
            const regQty = totalPax - vegQty - diabQty;
            return (
              <div key={f.id} onClick={() => setMFlights(prev => selected ? prev.filter(x => x !== f.id) : [...prev, f.id])}
                style={{ background: selected ? T.primaryLight : T.bgSurface, border: `1px solid ${selected ? T.primary : T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', boxShadow: T.shadowSm }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{f.id} — {f.route}</div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>Dep {f.departure} · {f.pax} pax</div>
                  </div>
                  <div style={{ width: 22, height: 22, borderRadius: T.radiusFull, border: `2px solid ${selected ? T.primary : T.border}`, background: selected ? T.primary : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {selected && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                </div>
                {selected && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.primary}30` }}>
                    {[['Regular', `${regQty}`, '84%'], ['Vegetarian', `${vegQty}`, '12%'], ['Diabetic', `${diabQty}`, `${Math.round(diabQty / totalPax * 100)}%`], ['Total', `${f.meals}`, '']].map(([type, qty, pct]) => (
                      <div key={type} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, paddingBottom: 4 }}>
                        <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{type}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{qty} {pct ? `(${pct})` : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <PrimaryBtn onClick={() => setMScreen(2)} disabled={mFlights.length === 0} style={{ marginTop: 8 }}>
            Next — vehicle details ({mFlights.length} selected) →
          </PrimaryBtn>
        </div>
      );
    }

    // S2 — Vehicle & Temperature
    if (mScreen === 2) {
      const canNext = mVehicleNo.trim() && mVehicleClean;
      return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
          <Card>
            <SectionLabel>Van Number</SectionLabel>
            <input value={mVehicleNo} onChange={e => setMVehicleNo(e.target.value)}
              placeholder="e.g. HiLoader-03" style={INPUT_STYLE} />
          </Card>

          <Card>
            <SectionLabel>Van Cleanliness</SectionLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              {['Clean', 'Not Clean'].map(opt => (
                <button key={opt} onClick={() => setMVehicleClean(opt)} style={{
                  flex: 1, padding: '10px 0', fontFamily: T.fontBody, fontSize: 13, fontWeight: 700,
                  border: `1px solid ${mVehicleClean === opt ? (opt === 'Clean' ? T.statusApproved : T.primary) : T.border}`,
                  borderRadius: T.radiusMd, cursor: 'pointer',
                  background: mVehicleClean === opt ? (opt === 'Clean' ? T.statusApproved : T.primary) : T.bgSubtle,
                  color: mVehicleClean === opt ? '#fff' : T.textSecondary,
                }}>
                  {opt === 'Clean' ? '✓ Clean' : 'Not Clean'}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <SectionLabel>Product Core Temperature</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[['CHILLED °C', 'Std: 1–4°C', mChilledTemp, setMChilledTemp], ['FROZEN °C', 'Std: -12 to -8°C', mFrozenTemp, setMFrozenTemp]].map(([label, hint, val, setter]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 4 }}>{label}</div>
                  <input value={val} onChange={e => setter(e.target.value)} type="number" placeholder="0.0" style={{ ...INPUT_STYLE }} />
                  <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 3 }}>{hint}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionLabel>Van Temp During Loading</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[['START °C', mVanStart, setMVanStart], ['END °C', mVanEnd, setMVanEnd]].map(([label, val, setter]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 4 }}>{label}</div>
                  <input value={val} onChange={e => setter(e.target.value)} type="number" placeholder="0.0" style={{ ...INPUT_STYLE }} />
                </div>
              ))}
            </div>
          </Card>

          <div style={{ display: 'flex', gap: 8 }}>
            <SecondaryBtn onClick={() => setMScreen(1)} style={{ flex: 1 }}>← Back</SecondaryBtn>
            <PrimaryBtn onClick={() => setMScreen(3)} disabled={!canNext} style={{ flex: 2 }}>Next →</PrimaryBtn>
          </div>
        </div>
      );
    }

    // S3 — Result check
    if (mScreen === 3) {
      const scanLabels = mFlights.flatMap(fid => {
        const f = MOCK_FLIGHTS.find(x => x.id === fid);
        return labelsFor(f?.id ?? fid, f?.meals);
      });
      const canConfirm = mResult === 'Yes' ? mPackagingDone : mResult === 'No';
      return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
          <Card>
            <SectionLabel>Dispatch Summary</SectionLabel>
            {[
              ['Van Clean', mVehicleClean || '—'],
              ['Chilled Temp', mChilledTemp ? `${mChilledTemp}°C` : '—'],
              ['Frozen Temp', mFrozenTemp ? `${mFrozenTemp}°C` : '—'],
              ['Van Temp Start', mVanStart ? `${mVanStart}°C` : '—'],
              ['Van Temp End', mVanEnd ? `${mVanEnd}°C` : '—'],
            ].map(([l, v]) => (
              <div key={l} style={ROW}><span style={LABEL}>{l}</span><span style={VALUE}>{v}</span></div>
            ))}
          </Card>

          <Card>
            <SectionLabel>Result Satisfy</SectionLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              {['Yes', 'No'].map(opt => (
                <button key={opt} onClick={() => setMResult(opt)} style={{
                  flex: 1, padding: '12px 0', fontFamily: T.fontBody, fontSize: 14, fontWeight: 700,
                  border: `1px solid ${mResult === opt ? (opt === 'Yes' ? T.statusApproved : T.statusRejected) : T.border}`,
                  borderRadius: T.radiusMd, cursor: 'pointer',
                  background: mResult === opt ? (opt === 'Yes' ? T.statusApprovedBg : T.statusRejectedBg) : T.bgSubtle,
                  color: mResult === opt ? (opt === 'Yes' ? T.statusApproved : T.statusRejected) : T.textSecondary,
                }}>
                  {opt === 'Yes' ? '✓ Yes' : '✗ No'}
                </button>
              ))}
            </div>
          </Card>

          {mResult === 'Yes' && (
            <Card>
              <SectionLabel>Scan Container Labels — Packaging</SectionLabel>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 10 }}>Scan every printed label to confirm the load. Packaging completes when all labels are scanned.</div>
              {!mPackagingDone ? (
                <ScanPanel
                  labels={scanLabels}
                  flight={mFlights[0] ?? '—'}
                  auto
                  doneLabel="All labels scanned — packaging done"
                  onComplete={() => setMPackagingDone(true)}
                />
              ) : (
                <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}40`, borderRadius: T.radiusMd, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>📦 Packaging Done — ready to dispatch</div>
                </div>
              )}
            </Card>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <SecondaryBtn onClick={() => setMScreen(2)} style={{ flex: 1 }}>← Back</SecondaryBtn>
            <PrimaryBtn onClick={confirmDispatch} disabled={!canConfirm} style={{ flex: 2 }}>✈️ Confirm & dispatch</PrimaryBtn>
          </div>
        </div>
      );
    }

    return null;
  }

  // ── RECEIVE TAB ──────────────────────────────────────────────────────────
  function renderReceive() {

    // S3 — Scan items → send to store
    if (rScreen === 3) {
      const entry = dispatches.find(d => d.id === rSelectedId);
      const scanLabels = labelsFor(entry?.flight ?? 'APT', entry?.items);
      return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
          <Card>
            <SectionLabel>Scan Received Items — Gate 08</SectionLabel>
            <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 10 }}>Scan each container label received at the gate, then send the load to the airport store.</div>
            <ScanPanel
              labels={scanLabels}
              flight={entry?.flight ?? '—'}
              ctaLabel="Send to Store →"
              doneLabel="All items scanned"
              onComplete={acceptReceipt}
            />
          </Card>
          <SecondaryBtn onClick={() => setRScreen(2)} style={{ width: '100%' }}>← Back</SecondaryBtn>
        </div>
      );
    }

    // S4 — Accepted / Sent to store
    if (rScreen === 4) {
      const entry = dispatches.find(d => d.id === rSelectedId);
      const f = entry ? MOCK_FLIGHTS.find(f => f.id === entry.flight) : null;
      const kitchenTemp = entry?.chilledTemp ?? '—';
      const gateT = rGateTemp ? `${rGateTemp}°C` : '—';
      const breach = rGateTemp ? parseFloat(rGateTemp) > 8 : false;
      return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: T.radiusFull, border: `2px solid ${T.statusInfo}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 12 }}>✅</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 18, fontWeight: 700, color: T.textPrimary, marginBottom: 4 }}>Received &amp; Sent to Store</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 12, color: T.textTertiary, marginBottom: 4 }}>
            {entry?.flight} · {entry?.items ?? '—'} units · Gate 08 · {rAcceptedAt}
          </div>

          <Card style={{ width: '100%' }}>
            <SectionLabel>Cold Chain Summary</SectionLabel>
            {[
              ['Kitchen Chilled Temp', kitchenTemp],
              ['Gate 08 Temp', gateT],
              ['Max Limit', '+8°C'],
              ['Cold Chain', breach ? '⚠️ Breach detected' : '✓ No breach'],
            ].map(([l, v]) => (
              <div key={l} style={ROW}><span style={LABEL}>{l}</span>
                <span style={{ ...VALUE, color: l === 'Cold Chain' ? (breach ? T.statusRejected : T.statusApproved) : T.textPrimary }}>{v}</span>
              </div>
            ))}
          </Card>

          <Card style={{ background: T.statusInfoBg, border: `1px solid ${T.statusInfo}40`, width: '100%' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.statusInfo, fontFamily: T.fontBody, marginBottom: 2 }}>Synced to web dashboard</div>
            <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>Receipt recorded and visible on Dispatch Monitoring web page.</div>
          </Card>

          <PrimaryBtn onClick={resetReceive} style={{ marginTop: 8, width: '100%' }}>+ Receive Another</PrimaryBtn>
        </div>
      );
    }

    // S1 — Select dispatch
    if (rScreen === 1) {
      return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
          <div style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 10, textAlign: 'center', fontStyle: 'italic' }}>
            Airport Catering Unit — Gate No. 08
          </div>

          {pendingReceive.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: T.textTertiary, fontFamily: T.fontBody, fontSize: 13 }}>
              No pending dispatches to receive
            </div>
          )}

          {pendingReceive.map(d => {
            const sel = rSelectedId === d.id;
            return (
              <div key={d.id} onClick={() => setRSelectedId(sel ? '' : d.id)}
                style={{ background: sel ? T.primaryLight : T.bgSurface, border: `1px solid ${sel ? T.primary : T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', boxShadow: T.shadowSm }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: sel ? 8 : 0 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{d.flight} — {d.route}</div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{d.id} · {d.items} units</div>
                  </div>
                  <div style={{ width: 22, height: 22, borderRadius: T.radiusFull, border: `2px solid ${sel ? T.primary : T.border}`, background: sel ? T.primary : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {sel && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                </div>
                {sel && (
                  <div style={{ paddingTop: 8, borderTop: `1px solid ${T.primary}30` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 4 }}>QR-Scanned Data</div>
                    {[
                      ['Dispatch ID',  d.id],
                      ['Flight',       d.flight],
                      ['Total Pax',    `${d.items} units`],
                      ['Vehicle',      d.vehicleNo ?? '—'],
                      ['Van Clean',    d.vehicleClean ?? '—'],
                      ['Chilled Temp', d.chilledTemp ?? '—'],
                      ['Frozen Temp',  d.frozenTemp ?? '—'],
                    ].map(([l, v]) => (
                      <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, paddingBottom: 4 }}>
                        <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, fontFamily: T.fontBody, color: T.textPrimary }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <PrimaryBtn onClick={() => setRScreen(2)} disabled={!rSelectedId} style={{ marginTop: 8 }}>
            Proceed to gate check →
          </PrimaryBtn>
        </div>
      );
    }

    // S2 — Gate verification
    if (rScreen === 2) {
      const gateTempNum = parseFloat(rGateTemp);
      const tempOk = rGateTemp && !isNaN(gateTempNum) && gateTempNum <= 8;
      const canSave = rGateTemp && rUnloadTime && rCheck1 && rCheck2 && rCheck3;
      return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
          <Card>
            <SectionLabel>Gate 08 Temperature °C</SectionLabel>
            <input value={rGateTemp} onChange={e => setRGateTemp(e.target.value)} type="number" placeholder="0.0" style={INPUT_STYLE} />
            {rGateTemp && (
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, color: tempOk ? T.statusApproved : T.statusRejected }}>
                {tempOk ? '✓ ≤8°C — within limit' : '⚠ >8°C — cold chain breach'}
              </div>
            )}
          </Card>

          <Card>
            <SectionLabel>Time of Unloading</SectionLabel>
            <input value={rUnloadTime} onChange={e => setRUnloadTime(e.target.value)} type="time" style={INPUT_STYLE} />
          </Card>

          <Card>
            <SectionLabel>Physical Checks</SectionLabel>
            {[
              ['Vehicle temp verified at gate before unloading', rCheck1, setRCheck1],
              ['Seal integrity & packaging condition checked', rCheck2, setRCheck2],
              ['Unloading time recorded', rCheck3, setRCheck3],
              ['APT countersign pending', false, null],
            ].map(([label, checked, setter]) => (
              <label key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingTop: 8, paddingBottom: 8, borderTop: `1px solid ${T.border}`, cursor: setter ? 'pointer' : 'default', opacity: setter ? 1 : 0.5 }}>
                <div onClick={() => setter && setter(v => !v)} style={{
                  width: 20, height: 20, borderRadius: 4, border: `2px solid ${checked ? T.primary : T.border}`,
                  background: checked ? T.primary : 'transparent', flexShrink: 0, marginTop: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: setter ? 'pointer' : 'default',
                }}>
                  {checked && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3 5.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <span style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody, lineHeight: 1.4 }}>{label}</span>
              </label>
            ))}
          </Card>

          <Card>
            <SectionLabel>Remarks</SectionLabel>
            <textarea value={rRemarks} onChange={e => setRRemarks(e.target.value)}
              placeholder="Optional remarks..." rows={3}
              style={{ ...INPUT_STYLE, resize: 'none', lineHeight: 1.5 }} />
          </Card>

          <div style={{ background: T.statusInfoBg, border: `1px solid ${T.statusInfo}40`, borderRadius: T.radiusMd, padding: '10px 14px', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.statusInfo, fontFamily: T.fontBody }}>APT Officer Signature</div>
            <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>Digital signature via APT terminal</div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <SecondaryBtn onClick={() => setRScreen(1)} style={{ flex: 1 }}>← Back</SecondaryBtn>
            <PrimaryBtn onClick={() => setRScreen(3)} disabled={!canSave} style={{ flex: 2 }}>Next — scan items →</PrimaryBtn>
          </div>
        </div>
      );
    }

    return null;
  }

  // ── LOG TAB ───────────────────────────────────────────────────────────────
  function renderLog() {
    const lq = logSearch.trim().toLowerCase();
    const visible = dispatches.filter(d => {
      const dt = d.packagingDate ?? TODAY;
      if (logFrom && dt < logFrom) return false;
      if (logTo && dt > logTo) return false;
      if (lq && ![d.flight, d.id, d.vehicleNo, d.route].some(v => (v || '').toLowerCase().includes(lq))) return false;
      return true;
    });
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Search + date range */}
        <div style={{ padding: '10px 14px 6px', flexShrink: 0 }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ position: 'absolute', left: 12, fontSize: 13, color: T.textTertiary, pointerEvents: 'none' }}>🔍</span>
            <input value={logSearch} onChange={e => setLogSearch(e.target.value)} placeholder="Search flight, dispatch, vehicle…"
              style={{ ...INPUT_STYLE, padding: '9px 12px 9px 32px', borderRadius: T.radiusFull, fontSize: 12 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="date" value={logFrom} onChange={e => setLogFrom(e.target.value)} style={{ ...INPUT_STYLE, flex: 1, minWidth: 0, padding: '7px 8px', fontSize: 11 }} />
            <span style={{ fontSize: 12, color: T.textTertiary }}>–</span>
            <input type="date" value={logTo} onChange={e => setLogTo(e.target.value)} style={{ ...INPUT_STYLE, flex: 1, minWidth: 0, padding: '7px 8px', fontSize: 11 }} />
            {(logSearch || logFrom || logTo) && (
              <span onClick={() => { setLogSearch(''); setLogFrom(''); setLogTo(''); }} style={{ fontSize: 11, fontWeight: 600, color: T.textTertiary, fontFamily: T.fontBody, cursor: 'pointer' }}>Clear</span>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 14px 16px' }}>
          {visible.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: T.textTertiary, fontFamily: T.fontBody, fontSize: 13 }}>No dispatch records match.</div>
          )}
          {visible.map(d => {
            const received = !!d.receivedAt;
            const stColor = received ? T.statusApproved : T.statusPending;
            const stBg = received ? T.statusApprovedBg : T.statusPendingBg;
            return (
              <div key={d.id} onClick={() => setMLogEntryId(d.id)}
                style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, cursor: 'pointer', boxShadow: T.shadowSm }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
                    <div style={{ width: 36, height: 36, borderRadius: T.radiusMd, background: stBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🚛</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{d.flight}{d.route ? ` · ${d.route}` : ''}</div>
                      <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.id} · {d.packagingDate ?? TODAY}{d.vehicleNo ? ` · ${d.vehicleNo}` : ''}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: stColor, background: stBg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{received ? 'Received' : 'Awaiting'}</span>
                    <span style={{ fontSize: 14, color: T.textTertiary }}>›</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      {!embedded && topbar(
        tab === 'dispatch' ? 'Kitchen Dispatch' : tab === 'receive' ? 'Airport Receiving' : 'Dispatch Log',
        tab === 'dispatch' ? 'Baunia Catering → Airport' : tab === 'receive' ? 'Gate No. 08' : 'All dispatch records',
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tab === 'dispatch' && renderDispatch()}
        {tab === 'receive' && renderReceive()}
        {tab === 'log' && renderLog()}
      </div>

      {bottomNav}
    </div>
  );
}
