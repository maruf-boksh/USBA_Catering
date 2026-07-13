import { useState } from 'react';
import { T } from '../theme';

// Mirrors the web's PH_PARAMS_DEFAULT (personal-hygiene-monitoring.tsx)
const PH_PARAMS = [
  'Dress code',
  'Uniform cleanliness',
  'Hair control',
  'Hand Sanitizing',
  'Jewelery & watches control',
  'Nails are trimmed properly',
  'Clean Shave/Beard Cover',
  'Wound/Infection',
  'Hand gloves',
  'Masks',
  'Overall cleaness',
];

// Mirrors the web's PH_AREAS
const PH_AREAS = [
  'Flight Kitchen',
  'Packaging-01',
  'Packaging-02',
  'Packaging-03',
  'Butcher Room',
  'Bakery',
];

const PH_SHIFTS = ['Morning', 'Afternoon', 'Night'];

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

const LEGEND_ITEMS = [
  { symbol: '✓', label: '1st click — OK',   color: T.statusApproved },
  { symbol: '✗', label: '2nd click — Not OK', color: T.statusRejected },
  { symbol: '—', label: 'Not Checked',      color: T.textTertiary   },
];

function makeRows() {
  return PH_PARAMS.map((param, i) => ({
    id: `p-${i}`,
    param,
    value: '—',
    remark: '',
  }));
}

function cycleValue(v) {
  return v === '—' ? '✓' : v === '✓' ? '✗' : '—';
}

function LegendStrip() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '7px 14px', background: T.bgSurface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
      {LEGEND_ITEMS.map(({ symbol, label, color }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: T.fontBody }}>{symbol}</span>
          <span style={{ fontSize: 9, color: T.textTertiary, fontFamily: T.fontBody, whiteSpace: 'nowrap' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function PersonalHygieneScreen({ nav }) {
  const [tab, setTab]                 = useState('checklist');
  const [screen, setScreen]           = useState('areas');
  const [shift, setShift]             = useState('Morning');
  const [currentArea, setCurrentArea] = useState('');
  const [rowsByArea, setRowsByArea]   = useState({});   // area -> rows
  const [savedAreas, setSavedAreas]   = useState({});   // area -> time
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedLogs, setSubmittedLogs] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  const [remarkErrors, setRemarkErrors] = useState(new Set());

  const rows = rowsByArea[currentArea] || makeRows();
  const allAreasFinalized = PH_AREAS.every(a => savedAreas[a]);

  const toggleValue = (rowId) => {
    if (savedAreas[currentArea] || isSubmitted) return;
    setRowsByArea(prev => ({
      ...prev,
      [currentArea]: (prev[currentArea] || makeRows()).map(r =>
        r.id === rowId ? { ...r, value: cycleValue(r.value) } : r),
    }));
    setRemarkErrors(new Set());
  };

  const updateRemark = (rowId, val) => {
    setRowsByArea(prev => ({
      ...prev,
      [currentArea]: (prev[currentArea] || makeRows()).map(r =>
        r.id === rowId ? { ...r, remark: val } : r),
    }));
  };

  const openArea = (area) => {
    setCurrentArea(area);
    setRowsByArea(prev => prev[area] ? prev : { ...prev, [area]: makeRows() });
    setScreen('record');
  };

  const saveArea = () => {
    const errors = new Set();
    rows.forEach(r => { if (r.value === '✗' && !r.remark.trim()) errors.add(r.id); });
    if (errors.size > 0) { setRemarkErrors(errors); return; }
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    setSavedAreas(prev => ({ ...prev, [currentArea]: timeStr }));
    setScreen('areas');
    setRemarkErrors(new Set());
  };

  const submitDay = () => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const notOkItems = [];
    PH_AREAS.forEach(area => {
      (rowsByArea[area] || []).forEach(r => {
        if (r.value === '✗') notOkItems.push({ area, param: r.param, remark: r.remark.trim() });
      });
    });
    setSubmittedLogs(prev => [{
      id: `PH-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      shift,
      submittedAt: timeStr,
      notOkCount: notOkItems.length,
      notOkItems,
    }, ...prev]);
    setIsSubmitted(true);
  };

  const startNew = () => {
    setRowsByArea({});
    setSavedAreas({});
    setIsSubmitted(false);
    setRemarkErrors(new Set());
    setScreen('areas');
    setTab('checklist');
  };

  // ── Tab bar ────────────────────────────────────────────────────────────────
  const tabBar = (
    <div style={{ display: 'flex', background: T.bgSurface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
      {[['checklist', 'Checklist'], ['log', 'Log']].map(([key, label]) => (
        <button key={key} onClick={() => { setTab(key); if (key === 'checklist') setScreen('areas'); }}
          style={{ flex: 1, padding: '10px 0', fontFamily: T.fontBody, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            color: tab === key ? T.primary : T.textTertiary, background: 'none', border: 'none',
            borderBottom: tab === key ? `2px solid ${T.primary}` : '2px solid transparent' }}>
          {label}
        </button>
      ))}
    </div>
  );

  // ── Screen: record area ────────────────────────────────────────────────────
  if (tab === 'checklist' && screen === 'record') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setScreen('areas'); setRemarkErrors(new Set()); }} style={BTN_BACK}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{currentArea}</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{shift} shift · Tap to toggle OK / Not OK</div>
          </div>
        </div>
        <LegendStrip />
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 16px' }}>
          {rows.map(row => {
            const v = row.value;
            const hasError = remarkErrors.has(row.id);
            return (
              <div key={row.id} style={{ background: T.bgSurface, border: `1px solid ${v === '✗' ? T.statusRejected + '50' : T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <button onClick={() => toggleValue(row.id)}
                    style={{ flexShrink: 0, width: 36, height: 36, borderRadius: T.radiusMd, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, cursor: 'pointer',
                      background: v === '✓' ? T.statusApprovedBg : v === '✗' ? T.statusRejectedBg : T.bgSubtle,
                      color:      v === '✓' ? T.statusApproved   : v === '✗' ? T.statusRejected   : T.textTertiary,
                      border: `1.5px solid ${v === '✓' ? T.statusApproved + '60' : v === '✗' ? T.statusRejected + '60' : T.border}` }}>
                    {v}
                  </button>
                  <div style={{ flex: 1, paddingTop: 4 }}>
                    <div style={{ fontSize: 12, color: T.textPrimary, fontFamily: T.fontBody, lineHeight: 1.4 }}>{row.param}</div>
                  </div>
                </div>
                {v === '✗' && (
                  <input type="text" value={row.remark || ''} onChange={e => updateRemark(row.id, e.target.value)}
                    placeholder="Remark required *"
                    style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', border: `1px solid ${hasError ? T.statusRejected : T.statusRejected + '80'}`, borderRadius: T.radiusMd, padding: '6px 10px', fontSize: 11, fontFamily: T.fontBody, outline: 'none', background: T.statusRejectedBg, color: T.textPrimary }} />
                )}
                {hasError && <div style={{ fontSize: 10, color: T.statusRejected, fontFamily: T.fontBody, marginTop: 3 }}>Remark required for Not OK item</div>}
              </div>
            );
          })}
          <button onClick={saveArea}
            style={{ width: '100%', marginTop: 16, padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
            Save — {currentArea} ✓
          </button>
        </div>
      </div>
    );
  }

  // ── Screen: log detail ─────────────────────────────────────────────────────
  if (tab === 'log' && selectedLog) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => setSelectedLog(null)} style={BTN_BACK}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Record Details</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{selectedLog.date} · {selectedLog.shift}</div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 12 }}>
            {[['Date', selectedLog.date], ['Shift', selectedLog.shift], ['Submitted at', selectedLog.submittedAt]].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, paddingBottom: 6, borderTop: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, borderTop: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>Result</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: selectedLog.notOkCount === 0 ? T.statusApproved : T.statusRejected, background: selectedLog.notOkCount === 0 ? T.statusApprovedBg : T.statusRejectedBg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>
                {selectedLog.notOkCount === 0 ? 'All OK ✓' : `${selectedLog.notOkCount} Not OK`}
              </span>
            </div>
          </div>
          {selectedLog.notOkItems.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Not OK Items</div>
              {selectedLog.notOkItems.map(({ area, param, remark }, i) => (
                <div key={i} style={{ background: T.statusRejectedBg, border: `1px solid ${T.statusRejected + '30'}`, borderRadius: T.radiusMd, padding: '10px 12px', marginBottom: 6, fontFamily: T.fontBody }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.statusRejected }}>✗ {param}</div>
                  <div style={{ fontSize: 10, color: T.textTertiary, marginTop: 2 }}>{area}</div>
                  {remark && (
                    <div style={{ fontSize: 11, color: T.statusRejected, marginTop: 5, paddingTop: 5, borderTop: `1px solid ${T.statusRejected + '25'}`, opacity: 0.85, fontStyle: 'italic' }}>
                      {remark}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Health &amp; Personal Hygiene Monitoring</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>USBA-FSH-HPHM-01</div>
        </div>
        {isSubmitted && (
          <div style={{ background: T.statusApproved, borderRadius: T.radiusFull, padding: '2px 8px', fontSize: 10, fontWeight: 700, color: '#fff', fontFamily: T.fontBody }}>Submitted ✓</div>
        )}
      </div>
      {tabBar}

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── CHECKLIST TAB ──────────────────────────────────────────────── */}
        {tab === 'checklist' && (
          <div style={{ padding: '8px 14px 16px' }}>
            {isSubmitted && (
              <>
                <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved + '30'}`, borderRadius: T.radiusMd, padding: '10px 14px', marginTop: 8, marginBottom: 10, fontSize: 12, color: T.statusApproved, fontWeight: 700, fontFamily: T.fontBody }}>
                  ✅ {shift} shift record submitted successfully.
                </div>
                <button onClick={startNew}
                  style={{ width: '100%', padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer', marginBottom: 4 }}>
                  New Record
                </button>
              </>
            )}

            {/* Shift selector */}
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 12, marginBottom: 8 }}>Shift</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {PH_SHIFTS.map(s => {
                const active = shift === s;
                return (
                  <button key={s} onClick={() => !isSubmitted && setShift(s)}
                    style={{ flex: 1, padding: '8px 0', borderRadius: T.radiusMd, cursor: isSubmitted ? 'default' : 'pointer',
                      fontSize: 12, fontWeight: 700, fontFamily: T.fontBody,
                      border: `1px solid ${active ? T.primary : T.border}`,
                      background: active ? T.primary : T.bgSurface,
                      color: active ? '#fff' : T.textSecondary }}>
                    {s}
                  </button>
                );
              })}
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Areas</div>
            {PH_AREAS.map(area => {
              const saved = savedAreas[area];
              const isActive = !saved && !isSubmitted;
              const areaRows = rowsByArea[area] || [];
              const okCount = areaRows.filter(r => r.value === '✓').length;
              const notOkCount = areaRows.filter(r => r.value === '✗').length;
              return (
                <div key={area}
                  onClick={() => isActive && openArea(area)}
                  style={{
                    background: saved ? T.statusApprovedBg : T.bgSurface,
                    border: `1.5px solid ${saved ? T.statusApproved + '50' : T.border}`,
                    borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 8,
                    cursor: isActive ? 'pointer' : 'default',
                    opacity: isSubmitted && !saved ? 0.6 : 1,
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{area}</span>
                    {saved
                      ? <span style={{ fontSize: 10, background: T.statusApproved, color: '#fff', borderRadius: T.radiusFull, padding: '2px 8px', fontWeight: 700, fontFamily: T.fontBody }}>✓ {saved}</span>
                      : isActive
                        ? <span style={{ fontSize: 10, background: T.primaryLight, color: T.primary, borderRadius: T.radiusFull, padding: '2px 8px', fontWeight: 700, fontFamily: T.fontBody }}>Tap to record →</span>
                        : null}
                  </div>
                  {saved && (
                    <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 3 }}>
                      {notOkCount} not ok · {okCount} ok · {PH_PARAMS.length - okCount - notOkCount} unchecked
                    </div>
                  )}
                </div>
              );
            })}
            {allAreasFinalized && !isSubmitted && (
              <button onClick={submitDay}
                style={{ width: '100%', padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer', marginTop: 8 }}>
                Submit {shift} Record ✓
              </button>
            )}
          </div>
        )}

        {/* ── LOG TAB ────────────────────────────────────────────────────── */}
        {tab === 'log' && (
          <div style={{ padding: '8px 14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Submitted Records</div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{submittedLogs.length} total</div>
            </div>
            {submittedLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody }}>No records submitted yet.</div>
            ) : (
              submittedLogs.map(log => (
                <div key={log.id} onClick={() => setSelectedLog(log)}
                  style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', boxShadow: T.shadowSm }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>🧼 {log.date} · {log.shift}</span>
                    <span style={{ fontSize: 10, background: log.notOkCount === 0 ? T.statusApproved : T.statusRejected, color: '#fff', borderRadius: T.radiusFull, padding: '2px 8px', fontWeight: 700, fontFamily: T.fontBody }}>
                      {log.notOkCount === 0 ? 'All OK' : `${log.notOkCount} Not OK`}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{log.submittedAt}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
