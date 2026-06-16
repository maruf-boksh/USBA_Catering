import { useState, useEffect } from 'react';
import { T } from '../theme';
import { MOCK_QC_CHECKS } from '../mockData';
import { qcStore } from '../qcStore';

const RESULT_MAP = {
  pass: { color: T.statusApproved, bg: T.statusApprovedBg, label: 'Pass' },
  open: { color: T.primary,        bg: T.primaryLight,     label: 'Open' },
  fail: { color: T.statusRejected, bg: T.statusRejectedBg, label: 'Fail' },
};

const HUB_MODULES = [
  { screen: 'cooking-temp', icon: '🌡️', label: 'Cooking Temperature', sub: 'HACCP temp & sensory tests', color: T.statusInfo,    bg: T.statusInfoBg    },
  { screen: 'hygiene',      icon: '🧹', label: 'Hygiene Monitoring',  sub: 'Daily safety checklists',   color: T.statusApproved, bg: T.statusApprovedBg },
];

const SENSORY_FIELDS = [
  { key: 'appearance', label: 'Appearance' },
  { key: 'aroma',      label: 'Aroma'      },
  { key: 'taste',      label: 'Taste'      },
  { key: 'texture',    label: 'Texture'    },
];

const SENSORY_OPTS = [
  { val: 'good', label: 'Good', color: T.statusApproved, bg: T.statusApprovedBg },
  { val: 'fair', label: 'Fair', color: T.statusPending,  bg: T.statusPendingBg  },
  { val: 'poor', label: 'Poor', color: T.statusRejected, bg: T.statusRejectedBg },
];

const PRESET_SENSORY = { appearance: 'good', aroma: 'good', taste: 'good', texture: 'good' };
const initForm = () => ({ appearance: '', aroma: '', taste: '', texture: '', overall: '', justification: '' });

function initChecks() {
  return MOCK_QC_CHECKS.map(c => ({
    ...c,
    sensory: c.result === 'pass' ? { ...PRESET_SENSORY } : null,
    rejectionNote: null,
  }));
}

export function QCScreen({ nav }) {
  const [checks,        setChecks]        = useState(initChecks);
  const [pendingQC,     setPendingQC]     = useState(() => qcStore.getBatches());
  const [sensoryPage,   setSensoryPage]   = useState(null);
  const [sForm,         setSForm]         = useState(initForm());
  const [checksFilter,  setChecksFilter]  = useState('all');

  useEffect(() => qcStore.subscribe(setPendingQC), []);

  const passCount = checks.filter(c => c.result === 'pass').length;
  const openCount = checks.filter(c => c.result === 'open').length;
  const passRate  = checks.length > 0 ? Math.round((passCount / checks.length) * 100) : 0;

  const filteredChecks = checksFilter === 'all' ? checks
    : checksFilter === 'pass' ? checks.filter(c => c.result === 'pass')
    : checks.filter(c => c.result === 'fail' || c.result === 'open');

  const formComplete =
    sForm.overall !== '' &&
    (sForm.overall !== 'fail' || sForm.justification.trim() !== '');

  const handleSave = () => {
    if (!sensoryPage || !formComplete) return;
    const sensoryData = {
      appearance: sForm.appearance,
      aroma:      sForm.aroma,
      taste:      sForm.taste,
      texture:    sForm.texture,
    };
    const alreadyInLog = checks.some(c => c.id === sensoryPage.id);
    if (alreadyInLog) {
      setChecks(prev => prev.map(c => c.id === sensoryPage.id ? {
        ...c,
        result:        sForm.overall,
        sensory:       sensoryData,
        rejectionNote: sForm.overall === 'fail' ? sForm.justification : null,
        issue:         sForm.overall === 'fail' ? sForm.justification : undefined,
      } : c));
    } else {
      qcStore.remove(sensoryPage.id);
      setChecks(prev => [...prev, {
        id:            sensoryPage.id,
        item:          sensoryPage.item,
        flight:        sensoryPage.flight || '—',
        result:        sForm.overall,
        temp:          sensoryPage.temp || '—',
        checkedBy:     'QC Inspector',
        time:          new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        issue:         sForm.overall === 'fail' ? sForm.justification : undefined,
        sensory:       sensoryData,
        rejectionNote: sForm.overall === 'fail' ? sForm.justification : null,
      }]);
    }
    setSensoryPage(null);
    setSForm(initForm());
  };

  // ── Sensory page ──────────────────────────────────────────────────────────
  if (sensoryPage) {
    const isReadOnly = sensoryPage.result === 'pass';

    if (isReadOnly) {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
          <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={() => setSensoryPage(null)} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
            <div>
              <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Sensory Record</div>
              <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{sensoryPage.item}</div>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>
            <div style={{ background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}40`, borderRadius: T.radiusLg, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 24 }}>✅</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody }}>PASS</div>
                <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>All sensory checks passed</div>
              </div>
            </div>

            <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 16px', marginBottom: 12, boxShadow: T.shadowSm }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Batch Details</div>
              {[
                sensoryPage.flight && sensoryPage.flight !== '—' ? ['Flight No',  sensoryPage.flight]      : null,
                ['Batch Name', sensoryPage.item],
                sensoryPage.checkedBy ? ['Checked By', sensoryPage.checkedBy] : null,
                sensoryPage.time      ? ['Time',       sensoryPage.time]      : null,
              ].filter(Boolean).map(([l, v], i) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: i === 0 ? 0 : 9, paddingBottom: 9, borderTop: i === 0 ? 'none' : `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
                </div>
              ))}
            </div>

            {sensoryPage.batchItems?.length > 0 && (
              <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 16px', boxShadow: T.shadowSm }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Batch Items & Temperature</div>
                {sensoryPage.batchItems.map((bi, i) => (
                  <div key={bi.name} style={{ paddingTop: i === 0 ? 0 : 10, paddingBottom: 10, borderTop: i === 0 ? 'none' : `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, marginBottom: 4 }}>{bi.name}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>Standard: {bi.standardTemp}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: T.statusApproved, fontFamily: T.fontBody }}>Recorded: {bi.recordedTemp}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Sensory test form (open / pending items)
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { setSensoryPage(null); setSForm(initForm()); }} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Sensory Test</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{sensoryPage.item}</div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>

          {/* Batch / item details */}
          <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 16px', marginBottom: 14, boxShadow: T.shadowSm }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Batch Details</div>
            {[
              sensoryPage.flight && sensoryPage.flight !== '—' ? ['Flight No',  sensoryPage.flight]  : null,
              ['Batch Name', sensoryPage.item],
              sensoryPage.section ? ['Section',  sensoryPage.section] : null,
              sensoryPage.qty     ? ['Quantity', sensoryPage.qty]     : null,
            ].filter(Boolean).map(([l, v], i) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: i === 0 ? 0 : 9, paddingBottom: 9, borderTop: i === 0 ? 'none' : `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody, maxWidth: '60%', textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>

          {sensoryPage.batchItems?.length > 0 && (
            <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 16px', marginBottom: 14, boxShadow: T.shadowSm }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Batch Items & Temperature</div>
              {sensoryPage.batchItems.map((bi, i) => (
                <div key={bi.name} style={{ paddingTop: i === 0 ? 0 : 10, paddingBottom: 10, borderTop: i === 0 ? 'none' : `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, marginBottom: 4 }}>{bi.name}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>Standard: {bi.standardTemp}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: T.primary, fontFamily: T.fontBody }}>Recorded: {bi.recordedTemp}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {sensoryPage.issue && (
            <div style={{ background: T.primaryLight, border: `1px solid ${T.primary}30`, borderRadius: T.radiusLg, padding: '10px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.primary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Issue Noted</div>
              <div style={{ fontSize: 12, color: T.primary, fontFamily: T.fontBody }}>{sensoryPage.issue}</div>
            </div>
          )}

          {/* Overall result */}
          <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 16px', marginBottom: 14, boxShadow: T.shadowSm }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Overall Result</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setSForm(f => ({ ...f, overall: 'pass', justification: '' }))}
                style={{
                  flex: 1, padding: '12px 0',
                  background: sForm.overall === 'pass' ? T.statusApproved : T.bgSubtle,
                  border: `1px solid ${sForm.overall === 'pass' ? T.statusApproved : T.border}`,
                  borderRadius: T.radiusMd,
                  fontSize: 14, fontWeight: 700,
                  color: sForm.overall === 'pass' ? '#fff' : T.textTertiary,
                  fontFamily: T.fontBody, cursor: 'pointer',
                }}
              >
                ✓ PASS
              </button>
              <button
                onClick={() => setSForm(f => ({ ...f, overall: 'fail' }))}
                style={{
                  flex: 1, padding: '12px 0',
                  background: sForm.overall === 'fail' ? T.statusRejected : T.bgSubtle,
                  border: `1px solid ${sForm.overall === 'fail' ? T.statusRejected : T.border}`,
                  borderRadius: T.radiusMd,
                  fontSize: 14, fontWeight: 700,
                  color: sForm.overall === 'fail' ? '#fff' : T.textTertiary,
                  fontFamily: T.fontBody, cursor: 'pointer',
                }}
              >
                ✗ FAIL
              </button>
            </div>
          </div>

          {/* Rejection justification — mandatory when FAIL */}
          {sForm.overall === 'fail' && (
            <div style={{ background: T.statusRejectedBg, border: `1px solid ${T.statusRejected}30`, borderRadius: T.radiusLg, padding: '14px 16px', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, marginBottom: 8 }}>
                Rejection Justification *
              </div>
              <textarea
                value={sForm.justification}
                onChange={e => setSForm(f => ({ ...f, justification: e.target.value }))}
                placeholder="Describe the reason for failing this sensory test..."
                rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'none',
                  border: `1px solid ${T.statusRejected}50`, borderRadius: T.radiusMd,
                  padding: '8px 10px', fontSize: 12, fontFamily: T.fontBody,
                  background: T.bgSurface, color: T.textPrimary, outline: 'none',
                }}
              />
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={!formComplete}
            style={{
              width: '100%', padding: '13px 0',
              background: formComplete ? T.statusApproved : T.textDisabled,
              border: 'none', borderRadius: T.radiusMd,
              fontSize: 14, fontWeight: 700, color: '#fff',
              fontFamily: T.fontBody,
              cursor: formComplete ? 'pointer' : 'not-allowed',
            }}
          >
            Save & Record
          </button>
        </div>
      </div>
    );
  }

  // ── Main QC list view ─────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', flexShrink: 0 }}>
        <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Food Safety & QC</div>
        <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Quality control hub</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px 16px' }}>

        {/* Module cards */}
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
          Record / Check
        </div>
        {HUB_MODULES.map(m => (
          <div
            key={m.screen}
            onClick={() => nav.navigate(m.screen)}
            style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '14px 14px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', boxShadow: T.shadowSm }}
          >
            <div style={{ width: 48, height: 48, borderRadius: T.radiusMd, background: m.bg, border: `1px solid ${m.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
              {m.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{m.label}</div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 3 }}>{m.sub}</div>
            </div>
            <div style={{ width: 30, height: 30, borderRadius: T.radiusFull, background: m.bg, border: `1px solid ${m.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="10" height="12" viewBox="0 0 10 14" fill="none">
                <path d="M1 1l8 6-8 6" stroke={m.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        ))}

        {/* Pending QC — batches forwarded from Production */}
        {pendingQC.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 8, marginBottom: 8 }}>
              Pending QC
            </div>
            {pendingQC.map(batch => (
              <div
                key={batch.id}
                onClick={() => { setSensoryPage({ ...batch, result: 'open' }); setSForm(initForm()); }}
                style={{ background: T.bgSurface, border: `1.5px solid ${T.statusPending}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 10, cursor: 'pointer', boxShadow: T.shadowSm }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{batch.item}</div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                      Flight {batch.flight} · {batch.section}
                    </div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 1 }}>
                      {batch.qty} · Forwarded from Production
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.statusPending, background: T.statusPendingBg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>Pending</span>
                    <span style={{ fontSize: 14, color: T.textTertiary }}>›</span>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Today's Checks */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Today's Checks</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['pass', 'Pass'], ['fail', 'Failed']].map(([key, label]) => {
              const active = checksFilter === key;
              const color  = key === 'pass' ? T.statusApproved : T.statusRejected;
              const bg     = key === 'pass' ? T.statusApprovedBg : T.statusRejectedBg;
              return (
                <button key={key} onClick={() => setChecksFilter(active ? 'all' : key)}
                  style={{ padding: '4px 12px', borderRadius: T.radiusFull, border: `1.5px solid ${active ? color : T.border}`, background: active ? bg : T.bgSurface, color: active ? color : T.textTertiary, fontSize: 11, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {filteredChecks.map(check => {
          const r = RESULT_MAP[check.result] || RESULT_MAP.pass;
          return (
            <div
              key={check.id}
              onClick={() => {
                setSensoryPage({ ...check });
                if (check.result !== 'pass') setSForm(initForm());
              }}
              style={{
                background: T.bgSurface,
                border: `1.5px solid ${r.color}`,
                borderRadius: T.radiusLg,
                padding: '12px 14px',
                marginBottom: 8,
                boxShadow: T.shadowSm,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: check.issue ? 8 : 0 }}>
                <div style={{ flex: 1, paddingRight: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{check.item}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                    Flight {check.flight} · {check.time} · {check.checkedBy}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: r.color, background: r.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>
                    {r.label}
                  </span>
                  <span style={{ fontSize: 14, color: T.textTertiary }}>›</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ background: T.bgSubtle, borderRadius: T.radiusMd, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>Temp:</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: check.result === 'open' ? T.primary : T.statusApproved, fontFamily: T.fontBody }}>
                    {check.temp}
                  </span>
                </div>
                {check.issue && (
                  <div style={{ flex: 1, background: T.primaryLight, borderRadius: T.radiusMd, padding: '4px 10px' }}>
                    <span style={{ fontSize: 11, color: T.primary, fontFamily: T.fontBody }}>{check.issue}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

      </div>
    </div>
  );
}
