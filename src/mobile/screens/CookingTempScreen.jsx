import { useState } from 'react';
import { T } from '../theme';
import { MOCK_COOKING_TEMPS } from '../mockData';

// Mirrors CHEFS from the web's cooking-temp.tsx
const CHEFS = ['Chef Ahmed R.', 'Chef Nusrat K.', 'Chef Karim S.', 'Chef Hossain T.', 'Chef Begum F.', 'Chef Mahmud S.'];

// Two production batches ready for QC sign-off (matches "Ready for QC" production entries in web)
const INITIAL_PENDING = [
  { id: 'PRD-0235', item: 'Economy Lunch Tray',  qty: 176, date: '2026-06-11', standardTemp: 75 },
  { id: 'PRD-0236', item: 'Business Dinner Set', qty: 191, date: '2026-06-11', standardTemp: 63 },
];

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

export function CookingTempScreen({ nav }) {
  const [tab, setTab]             = useState('qc');
  const [screen, setScreen]       = useState(1);
  const [pending, setPending]     = useState(INITIAL_PENDING);
  const [records, setRecords]     = useState([...MOCK_COOKING_TEMPS]);
  const [qcTarget, setQcTarget]   = useState(null);
  const [measured, setMeasured]   = useState('');
  const [cookedBy, setCookedBy]   = useState('');
  const [failReason, setFailReason] = useState('');
  const [lastResult, setLastResult] = useState('pass');
  const [logRecordId, setLogRecordId] = useState(null);

  const measuredNum = parseFloat(measured) || 0;
  const stdTemp     = qcTarget?.standardTemp ?? 75;
  const tempPasses  = measuredNum > 0 && measuredNum >= stdTemp;

  const startQc = (item) => { setQcTarget(item); setMeasured(''); setCookedBy(''); setFailReason(''); setScreen(2); };

  const passQc = () => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    setRecords(prev => [{ id: `CT-${Date.now()}`, item: qcTarget.item, target: `≥${stdTemp}°C`, actual: `${measuredNum}°C`, status: 'pass', time: timeStr, chef: cookedBy || 'Kitchen Staff' }, ...prev]);
    setPending(prev => prev.filter(p => p.id !== qcTarget.id));
    setLastResult('pass');
    setScreen(4);
  };

  const failQc = () => {
    if (!failReason.trim()) return;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    setRecords(prev => [{ id: `CT-${Date.now()}`, item: qcTarget.item, target: `≥${stdTemp}°C`, actual: `${measuredNum}°C`, status: 'fail', time: timeStr, chef: cookedBy || 'Kitchen Staff', failReason }, ...prev]);
    setPending(prev => prev.filter(p => p.id !== qcTarget.id));
    setLastResult('fail');
    setScreen(4);
  };

  // ── Tab bar ────────────────────────────────────────────────────────────────
  const tabBar = (
    <div style={{ display: 'flex', background: T.bgSurface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
      {[['qc', 'QC'], ['log', 'Log']].map(([key, label]) => (
        <button key={key} onClick={() => { setTab(key); if (key === 'qc') setScreen(1); setLogRecordId(null); }}
          style={{ flex: 1, padding: '10px 0', fontFamily: T.fontBody, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: tab === key ? T.primary : T.textTertiary, background: 'none', border: 'none', borderBottom: tab === key ? `2px solid ${T.primary}` : '2px solid transparent' }}>
          {label}
        </button>
      ))}
    </div>
  );

  // ── Screen 2: Record Test ──────────────────────────────────────────────────
  if (tab === 'qc' && screen === 2 && qcTarget) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => setScreen(1)} style={BTN_BACK}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Record Test</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{qcTarget.id}</div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* Item info card */}
          <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 14 }}>
            {[['Item', qcTarget.item], ['Standard Temp', `≥${stdTemp}°C`], ['Batch No.', qcTarget.id], ['Qty', qcTarget.qty?.toLocaleString()]].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, paddingBottom: 6, borderTop: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: l === 'Standard Temp' ? T.statusInfo : T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Measured temp */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Measured Temp (°C) *</div>
            <input type="number" value={measured} onChange={e => setMeasured(e.target.value)} placeholder="Enter temperature"
              style={{ width: '100%', boxSizing: 'border-box', border: `2px solid ${measuredNum > 0 ? (tempPasses ? T.statusApproved : T.statusRejected) : T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 18, fontWeight: 700, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary, textAlign: 'center' }} />
            {measuredNum > 0 && (
              <div style={{ fontSize: 11, fontWeight: 700, color: tempPasses ? T.statusApproved : T.statusRejected, fontFamily: T.fontBody, marginTop: 5, textAlign: 'center' }}>
                {tempPasses ? `✓ Above standard (+${(measuredNum - stdTemp).toFixed(1)}°C)` : `✗ Below standard (${(stdTemp - measuredNum).toFixed(1)}°C short)`}
              </div>
            )}
          </div>

          {/* Cooked by */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Cooked By *</div>
            <input value={cookedBy} onChange={e => setCookedBy(e.target.value)} placeholder="Chef / cook name" list="chef-list"
              style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary }} />
            <datalist id="chef-list">{CHEFS.map(c => <option key={c} value={c} />)}</datalist>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setScreen(3)}
              style={{ flex: 1, padding: '13px 0', background: 'none', border: `2px solid ${T.statusRejected}`, borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, cursor: 'pointer' }}>
              ✗ Fail
            </button>
            <button onClick={passQc}
              style={{ flex: 2, padding: '13px 0', background: T.statusApproved, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
              ✓ Pass & Complete
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Screen 3: Rejection Reason ─────────────────────────────────────────────
  if (tab === 'qc' && screen === 3 && qcTarget) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => setScreen(2)} style={BTN_BACK}>←</button>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Rejection Justification</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* Temp comparison */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Standard</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>≥{stdTemp}°C</div>
              <div style={{ fontSize: 9, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>HACCP min.</div>
            </div>
            <div style={{ background: tempPasses ? T.statusApprovedBg : T.statusRejectedBg, border: `1px solid ${tempPasses ? T.statusApproved + '40' : T.statusRejected + '40'}`, borderRadius: T.radiusLg, padding: '12px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Measured</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: tempPasses ? T.statusApproved : T.statusRejected, fontFamily: T.fontBody }}>{measuredNum}°C</div>
              <div style={{ fontSize: 9, color: tempPasses ? T.statusApproved : T.statusRejected, fontFamily: T.fontBody, marginTop: 2 }}>
                {tempPasses ? `+${(measuredNum - stdTemp).toFixed(1)}°C` : `${(stdTemp - measuredNum).toFixed(1)}°C short`}
              </div>
            </div>
          </div>
          {/* Reason */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Reason for Rejection *</div>
            <textarea value={failReason} onChange={e => setFailReason(e.target.value)} rows={4}
              placeholder="Describe why this batch is being sent back..."
              style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 12, fontFamily: T.fontBody, outline: 'none', resize: 'none', background: T.bgSurface, color: T.textPrimary }} />
          </div>
          <button onClick={failQc}
            style={{ width: '100%', padding: '13px 0', background: T.statusRejected, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
            Confirm & Reject Batch
          </button>
        </div>
      </div>
    );
  }

  // ── Screen 4: Result ───────────────────────────────────────────────────────
  if (tab === 'qc' && screen === 4 && qcTarget) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', flexShrink: 0 }}>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>QC Result</div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', gap: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: lastResult === 'pass' ? T.statusApprovedBg : T.statusRejectedBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>
            {lastResult === 'pass' ? '✅' : '❌'}
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: lastResult === 'pass' ? T.statusApproved : T.statusRejected, fontFamily: T.fontBody }}>
              {lastResult === 'pass' ? 'QC Passed!' : 'Batch Rejected'}
            </div>
            <div style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 6 }}>
              {lastResult === 'pass' ? `${qcTarget.qty?.toLocaleString() || ''} units added to inventory` : 'Sent back to In Preparation'}
            </div>
          </div>
          <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 16px', width: '100%', textAlign: 'left' }}>
            {[['Batch', qcTarget.id], ['Item', qcTarget.item], ['Temp', `${measuredNum}°C / ≥${stdTemp}°C`], ['Cooked By', cookedBy || 'Kitchen Staff']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, paddingBottom: 6, borderTop: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: l === 'Temp' ? (lastResult === 'pass' ? T.statusApproved : T.statusRejected) : T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
              </div>
            ))}
          </div>
          <button onClick={() => { setScreen(1); setQcTarget(null); }}
            style={{ width: '100%', padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
            Back to Pending Batches
          </button>
        </div>
      </div>
    );
  }

  // ── Log detail ─────────────────────────────────────────────────────────────
  if (tab === 'log' && logRecordId) {
    const rec = records.find(r => r.id === logRecordId);
    if (rec) {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
          <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={() => setLogRecordId(null)} style={BTN_BACK}>←</button>
            <div>
              <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Test Details</div>
              <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{rec.id}</div>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 12 }}>
              {[['Item', rec.item], ['Target', rec.target], ['Actual', rec.actual], ['Chef', rec.chef], ['Time', rec.time]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, paddingBottom: 6, borderTop: `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: l === 'Actual' ? (rec.status === 'pass' ? T.statusApproved : T.statusRejected) : T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, borderTop: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>Sensory</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: rec.status === 'pass' ? T.statusApproved : T.statusRejected, background: rec.status === 'pass' ? T.statusApprovedBg : T.statusRejectedBg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>
                  {rec.status === 'pass' ? 'Pass' : 'Fail'}
                </span>
              </div>
            </div>
            {rec.failReason && (
              <div style={{ background: T.statusRejectedBg, border: `1px solid ${T.statusRejected + '30'}`, borderRadius: T.radiusMd, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Rejection Reason</div>
                <div style={{ fontSize: 12, color: T.statusRejected, fontFamily: T.fontBody }}>{rec.failReason}</div>
              </div>
            )}
          </div>
        </div>
      );
    }
  }

  // ── Main (screen 1 / log list) ─────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Cooking Temp & Sensory</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>HACCP Quality Control</div>
        </div>
      </div>
      {tabBar}

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>

        {/* ── QC TAB: pending batches ─────────────────────────────────────── */}
        {tab === 'qc' && screen === 1 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Batches Pending QC</div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{pending.length} pending</div>
            </div>
            {pending.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
                <div style={{ fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody }}>No batches awaiting QC. All caught up.</div>
              </div>
            ) : (
              pending.map(p => (
                <div key={p.id} onClick={() => startQc(p)}
                  style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, cursor: 'pointer', boxShadow: T.shadowSm }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{p.id}</span>
                    <span style={{ fontSize: 10, background: T.statusPendingBg, color: T.statusPending, borderRadius: T.radiusFull, padding: '2px 8px', fontWeight: 700, fontFamily: T.fontBody }}>Pending QC</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, marginBottom: 4 }}>{p.item}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                    × {p.qty?.toLocaleString()} · {p.date} · Standard ≥{p.standardTemp}°C
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* ── LOG TAB: records list ───────────────────────────────────────── */}
        {tab === 'log' && !logRecordId && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>QC Records</div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{records.length} total</div>
            </div>
            {records.map(rec => (
              <div key={rec.id} onClick={() => setLogRecordId(rec.id)}
                style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, cursor: 'pointer', boxShadow: T.shadowSm }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{rec.item}</span>
                  <span style={{ fontSize: 10, background: rec.status === 'pass' ? T.statusApproved : T.statusRejected, color: '#fff', borderRadius: T.radiusFull, padding: '2px 8px', fontWeight: 700, fontFamily: T.fontBody, flexShrink: 0 }}>
                    {rec.status === 'pass' ? 'Pass' : 'Fail'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                  {rec.actual} / {rec.target} · {rec.chef} · {rec.time}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
