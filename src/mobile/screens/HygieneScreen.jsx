import { useState } from 'react';
import { T } from '../theme';

// Matches the web's CHECKLIST_ITEMS exactly (hygiene-monitoring.tsx)
const CHECKLIST_ITEMS = [
  'All plastic curtains are in good position',
  'All aircutters are working properly',
  'Wastage has been disposed properly',
  'All cooking utensils are clean & good condition',
  'Any food item kept in danger zone',
  'All chiller/freezer/AC working properly',
  'Raw & cooked food kept separately in Kitchen/Chiller/freezer',
  'Maintaining FIFO properly in Kitchen/Chiller/Freezer/Pack/Bakery',
  'All open food are covered properly with Date code',
  'Any expired/spoiled product found in Kitchen/Chiller/Freezer',
  'Any Cooked food, RM/PM are kept directly on the floor',
  'Packaging room temp. is below 15°C',
  'Date code check in packaging room',
  'Meal PKT Holding inside packaging room (Max. 10 Baskets)',
  'Presence of any pest/insects',
];

// Matches the web's TIME_SLOTS
const TIME_SLOTS = ['6:00AM', '8:00AM', '10:00AM', '12:00PM', '2:00PM', '4:00PM', '6:00PM', '8:00PM', '10:00PM'];

function makeRows() {
  return CHECKLIST_ITEMS.map((item, i) => ({
    id: `r-${i}`,
    item,
    values: Object.fromEntries(TIME_SLOTS.map(s => [s, '—'])),
    remarks: Object.fromEntries(TIME_SLOTS.map(s => [s, ''])),
  }));
}

function cycleValue(v) {
  return v === '—' ? '✓' : v === '✓' ? '✗' : '—';
}

function parseSlotHour(slot) {
  const m = slot.match(/^(\d+):00(AM|PM)$/);
  if (!m) return -1;
  let h = parseInt(m[1], 10);
  if (m[2] === 'PM' && h !== 12) h += 12;
  if (m[2] === 'AM' && h === 12) h = 0;
  return h;
}

function isSlotPast(slot) {
  return new Date().getHours() > parseSlotHour(slot);
}

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

const LEGEND_ITEMS = [
  { symbol: '✓', label: '1st click — Pass', color: T.statusApproved },
  { symbol: '✗', label: '2nd click — Fail', color: T.statusRejected },
  { symbol: '—', label: 'Not Checked',       color: T.textTertiary   },
  { symbol: '🔒', label: 'Missed',            color: T.statusPending  },
];

function LegendStrip() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', background: T.bgSurface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
      {LEGEND_ITEMS.map(({ symbol, label, color }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: T.fontBody }}>{symbol}</span>
          <span style={{ fontSize: 9, color: T.textTertiary, fontFamily: T.fontBody, whiteSpace: 'nowrap' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function HygieneScreen({ nav }) {
  const [tab, setTab]                     = useState('checklist');
  const [screen, setScreen]               = useState('slots');
  const [currentSlot, setCurrentSlot]     = useState('');
  const [rows, setRows]                   = useState(makeRows);
  const [savedSlots, setSavedSlots]       = useState({});
  const [isSubmitted, setIsSubmitted]     = useState(false);
  const [submittedLogs, setSubmittedLogs] = useState([]);
  const [selectedLog, setSelectedLog]     = useState(null);
  const [remarkErrors, setRemarkErrors]   = useState(new Set());
  // Missed-slot appeals (mirrors the web appeal flow → Approval Management)
  const [appeals, setAppeals]             = useState({});   // slot -> { note, at }
  const [appealSlot, setAppealSlot]       = useState('');   // slot with its appeal form open
  const [appealNote, setAppealNote]       = useState('');

  const openAppeal = (slot) => { setAppealSlot(slot); setAppealNote(''); };
  const submitAppeal = (slot) => {
    if (!appealNote.trim()) return;
    const now = new Date();
    const at = `${now.toISOString().slice(0, 10)} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    setAppeals(prev => ({ ...prev, [slot]: { note: appealNote.trim(), at } }));
    setAppealSlot('');
    setAppealNote('');
  };

  // A slot counts as finalised if it was saved OR it has already passed (Missed)
  const allSlotsFinalized = TIME_SLOTS.every(s => savedSlots[s] || isSlotPast(s));

  const toggleValue = (rowId) => {
    if (savedSlots[currentSlot] || isSubmitted) return;
    setRows(prev => prev.map(r =>
      r.id === rowId ? { ...r, values: { ...r.values, [currentSlot]: cycleValue(r.values[currentSlot]) } } : r
    ));
    setRemarkErrors(new Set());
  };

  const updateRemark = (rowId, val) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, remarks: { ...r.remarks, [currentSlot]: val } } : r));
  };

  const saveSlot = () => {
    const errors = new Set();
    rows.forEach(r => { if (r.values[currentSlot] === '✗' && !r.remarks[currentSlot]?.trim()) errors.add(r.id); });
    if (errors.size > 0) { setRemarkErrors(errors); return; }
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    setSavedSlots(prev => ({ ...prev, [currentSlot]: timeStr }));
    setScreen('slots');
    setRemarkErrors(new Set());
  };

  const submitDay = () => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const failCount = rows.reduce((acc, r) =>
      acc + TIME_SLOTS.filter(s => r.values[s] === '✗').length, 0);
    // Save item + justification remark together so log detail can show them
    const failItems = rows
      .filter(r => TIME_SLOTS.some(s => r.values[s] === '✗'))
      .map(r => ({
        item: r.item,
        remarks: TIME_SLOTS
          .filter(s => r.values[s] === '✗' && r.remarks[s]?.trim())
          .map(s => r.remarks[s].trim())
          .join('; '),
      }));
    setSubmittedLogs(prev => [{
      id: `LOG-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      submittedAt: timeStr,
      failCount,
      failItems,
    }, ...prev]);
    setIsSubmitted(true);
  };

  const startNewChecklist = () => {
    setRows(makeRows());
    setSavedSlots({});
    setIsSubmitted(false);
    setRemarkErrors(new Set());
    setScreen('slots');
    setTab('checklist');
  };

  // ── Tab bar ────────────────────────────────────────────────────────────────
  const tabBar = (
    <div style={{ display: 'flex', background: T.bgSurface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
      {[['checklist', 'Checklist'], ['log', 'Log']].map(([key, label]) => (
        <button key={key} onClick={() => { setTab(key); if (key === 'checklist') setScreen('slots'); }}
          style={{ flex: 1, padding: '10px 0', fontFamily: T.fontBody, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            color: tab === key ? T.primary : T.textTertiary, background: 'none', border: 'none',
            borderBottom: tab === key ? `2px solid ${T.primary}` : '2px solid transparent' }}>
          {label}
        </button>
      ))}
    </div>
  );

  // ── Screen: record slot ────────────────────────────────────────────────────
  if (tab === 'checklist' && screen === 'record') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setScreen('slots'); setRemarkErrors(new Set()); }} style={BTN_BACK}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Record — {currentSlot}</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Tap to toggle Pass / Fail</div>
          </div>
        </div>
        <LegendStrip />
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 16px' }}>
          {rows.map(row => {
            const v = row.values[currentSlot];
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
                    <div style={{ fontSize: 12, color: T.textPrimary, fontFamily: T.fontBody, lineHeight: 1.4 }}>{row.item}</div>
                  </div>
                </div>
                {v === '✗' && (
                  <input type="text" value={row.remarks[currentSlot] || ''} onChange={e => updateRemark(row.id, e.target.value)}
                    placeholder="Remark required *"
                    style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', border: `1px solid ${hasError ? T.statusRejected : T.statusRejected + '80'}`, borderRadius: T.radiusMd, padding: '6px 10px', fontSize: 11, fontFamily: T.fontBody, outline: 'none', background: T.statusRejectedBg, color: T.textPrimary }} />
                )}
                {hasError && <div style={{ fontSize: 10, color: T.statusRejected, fontFamily: T.fontBody, marginTop: 3 }}>Remark required for failed item</div>}
              </div>
            );
          })}
          <button onClick={saveSlot}
            style={{ width: '100%', marginTop: 16, padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
            Save Slot — {currentSlot} ✓
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
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Log Details</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{selectedLog.date}</div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>
          <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 12 }}>
            {[['Date', selectedLog.date], ['Submitted at', selectedLog.submittedAt]].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, paddingBottom: 6, borderTop: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, borderTop: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>Result</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: selectedLog.failCount === 0 ? T.statusApproved : T.statusRejected, background: selectedLog.failCount === 0 ? T.statusApprovedBg : T.statusRejectedBg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>
                {selectedLog.failCount === 0 ? 'All Pass ✓' : `${selectedLog.failCount} failures`}
              </span>
            </div>
          </div>
          {selectedLog.failItems.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Failed Items</div>
              {selectedLog.failItems.map(({ item, remarks }, i) => (
                <div key={i} style={{ background: T.statusRejectedBg, border: `1px solid ${T.statusRejected + '30'}`, borderRadius: T.radiusMd, padding: '10px 12px', marginBottom: 6, fontFamily: T.fontBody }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.statusRejected }}>✗ {item}</div>
                  {remarks && (
                    <div style={{ fontSize: 11, color: T.statusRejected, marginTop: 5, paddingTop: 5, borderTop: `1px solid ${T.statusRejected + '25'}`, opacity: 0.85, fontStyle: 'italic' }}>
                      {remarks}
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
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Daily Hygiene Monitoring</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>USBA-FSH-DFSHM-01</div>
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
                  ✅ Today's checklist submitted successfully.
                </div>
                <button
                  onClick={startNewChecklist}
                  style={{ width: '100%', padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer', marginBottom: 4 }}
                >
                  New Checklist
                </button>
              </>
            )}
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 12, marginBottom: 8 }}>Time Slots</div>
            {TIME_SLOTS.map(slot => {
              const saved    = savedSlots[slot];
              const missed   = !saved && !isSubmitted && isSlotPast(slot);
              const isActive = !saved && !isSubmitted && !missed;
              const passCount = rows.filter(r => r.values[slot] === '✓').length;
              const failCount = rows.filter(r => r.values[slot] === '✗').length;
              const appeal = appeals[slot];
              return (
                <div key={slot}
                  onClick={() => isActive && (setCurrentSlot(slot), setScreen('record'))}
                  style={{
                    background: saved ? T.statusApprovedBg : missed ? T.bgSubtle : T.bgSurface,
                    border: `1.5px solid ${saved ? T.statusApproved + '50' : missed ? T.statusPending + '40' : T.border}`,
                    borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 8,
                    cursor: isActive ? 'pointer' : 'default',
                    opacity: (isSubmitted && !saved && !missed) ? 0.6 : 1,
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: missed ? T.textTertiary : T.textPrimary, fontFamily: T.fontBody }}>{slot}</span>
                    {saved
                      ? <span style={{ fontSize: 10, background: T.statusApproved, color: '#fff', borderRadius: T.radiusFull, padding: '2px 8px', fontWeight: 700, fontFamily: T.fontBody }}>✓ {saved}</span>
                      : missed
                        ? (appeal
                            ? <span style={{ fontSize: 10, background: T.statusInfoBg, color: T.statusInfo, borderRadius: T.radiusFull, padding: '2px 8px', fontWeight: 700, fontFamily: T.fontBody }}>⏳ Appeal Submitted</span>
                            : <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 10, background: T.statusPendingBg, color: T.statusPending, borderRadius: T.radiusFull, padding: '2px 8px', fontWeight: 700, fontFamily: T.fontBody }}>🔒 Missed</span>
                                <button onClick={(e) => { e.stopPropagation(); openAppeal(slot); }}
                                  style={{ fontSize: 10, background: T.primaryLight, color: T.primary, border: `1px solid ${T.primary}40`, borderRadius: T.radiusFull, padding: '3px 10px', fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
                                  Appeal
                                </button>
                              </div>)
                        : isActive
                          ? <span style={{ fontSize: 10, background: T.primaryLight, color: T.primary, borderRadius: T.radiusFull, padding: '2px 8px', fontWeight: 700, fontFamily: T.fontBody }}>Tap to record →</span>
                          : null}
                  </div>
                  {saved && (
                    <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 3 }}>
                      {failCount} fail · {passCount} pass · {CHECKLIST_ITEMS.length - failCount - passCount} unchecked
                    </div>
                  )}
                  {/* Appeal justification form */}
                  {missed && appealSlot === slot && !appeal && (
                    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.statusPending, fontFamily: T.fontBody, marginBottom: 6 }}>Appeal Justification *</div>
                      <textarea
                        value={appealNote}
                        onChange={e => setAppealNote(e.target.value)}
                        placeholder="Reason this slot was missed…"
                        rows={2}
                        style={{ width: '100%', boxSizing: 'border-box', resize: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '7px 10px', fontSize: 11, fontFamily: T.fontBody, background: T.bgSurface, color: T.textPrimary, outline: 'none' }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button onClick={() => setAppealSlot('')}
                          style={{ flex: 1, padding: '8px 0', background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, fontSize: 12, fontWeight: 600, color: T.textSecondary, fontFamily: T.fontBody, cursor: 'pointer' }}>
                          Cancel
                        </button>
                        <button onClick={() => submitAppeal(slot)} disabled={!appealNote.trim()}
                          style={{ flex: 2, padding: '8px 0', background: appealNote.trim() ? T.statusPending : T.textDisabled, border: 'none', borderRadius: T.radiusMd, fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: appealNote.trim() ? 'pointer' : 'not-allowed' }}>
                          Submit Appeal
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Submitted appeal summary */}
                  {missed && appeal && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, fontStyle: 'italic' }}>"{appeal.note}"</div>
                      <div style={{ fontSize: 9, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 3 }}>Appealed {appeal.at} · Pending approval</div>
                    </div>
                  )}
                </div>
              );
            })}
            {allSlotsFinalized && !isSubmitted && (
              <button onClick={submitDay}
                style={{ width: '100%', padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer', marginTop: 8 }}>
                Submit Day's Checklist ✓
              </button>
            )}
          </div>
        )}

        {/* ── LOG TAB ────────────────────────────────────────────────────── */}
        {tab === 'log' && (
          <div style={{ padding: '8px 14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Submitted Logs</div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{submittedLogs.length} total</div>
            </div>
            {submittedLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody }}>No logs submitted yet.</div>
            ) : (
              submittedLogs.map(log => (
                <div key={log.id} onClick={() => setSelectedLog(log)}
                  style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', boxShadow: T.shadowSm }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>📋 {log.date}</span>
                    <span style={{ fontSize: 10, background: log.failCount === 0 ? T.statusApproved : T.statusRejected, color: '#fff', borderRadius: T.radiusFull, padding: '2px 8px', fontWeight: 700, fontFamily: T.fontBody }}>
                      {log.failCount === 0 ? 'All Pass' : `${log.failCount} Fail`}
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
