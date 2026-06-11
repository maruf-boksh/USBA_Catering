import { T } from '../theme';
import { MOCK_QC_CHECKS } from '../mockData';

const RESULT_MAP = {
  pass: { color: T.statusApproved, bg: T.statusApprovedBg, label: 'Pass' },
  open: { color: T.primary,        bg: T.primaryLight,     label: 'Open' },
  fail: { color: T.statusRejected, bg: T.statusRejectedBg, label: 'Fail' },
};

const passCount = MOCK_QC_CHECKS.filter(c => c.result === 'pass').length;
const openCount = MOCK_QC_CHECKS.filter(c => c.result === 'open').length;
const failCount = MOCK_QC_CHECKS.filter(c => c.result === 'fail').length;
const passRate  = MOCK_QC_CHECKS.length > 0
  ? Math.round((passCount / MOCK_QC_CHECKS.length) * 100)
  : 0;

const HUB_MODULES = [
  {
    screen:  'cooking-temp',
    icon:    '🌡️',
    label:   'Cooking Temperature',
    sub:     'HACCP temp & sensory tests',
    color:   T.statusInfo,
    bg:      T.statusInfoBg,
  },
  {
    screen:  'hygiene',
    icon:    '🧹',
    label:   'Hygiene Monitoring',
    sub:     'Daily safety checklists',
    color:   T.statusApproved,
    bg:      T.statusApprovedBg,
  },
];

export function QCScreen({ nav }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>

      {/* Topbar — no back button, this is the tab root */}
      <div style={{ background: T.topbarGradient, padding: '12px 16px', flexShrink: 0 }}>
        <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Food Safety & QC</div>
        <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
          Quality control hub
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px 16px' }}>

        {/* ── Summary stats ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 7, marginBottom: 14 }}>
          {[
            ['Total',     MOCK_QC_CHECKS.length, T.textPrimary,   T.bgSurface],
            ['Pass',      passCount,              T.statusApproved, T.statusApprovedBg],
            ['Open',      openCount,              T.primary,        T.primaryLight],
            ['Pass Rate', `${passRate}%`,         T.statusApproved, T.statusApprovedBg],
          ].map(([label, value, color, bg]) => (
            <div key={label} style={{
              background: bg, border: `1px solid ${color}25`,
              borderRadius: T.radiusMd, padding: '9px 8px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 17, fontWeight: 800, color, fontFamily: T.fontBody, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 9,  fontWeight: 600, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── Module cards ── */}
        <div style={{
          fontSize: 11, fontWeight: 700, color: T.textTertiary,
          fontFamily: T.fontBody, textTransform: 'uppercase',
          letterSpacing: '0.07em', marginBottom: 8,
        }}>
          Record / Check
        </div>

        {HUB_MODULES.map(m => (
          <div
            key={m.screen}
            onClick={() => nav.navigate(m.screen)}
            style={{
              background: T.bgSurface,
              border: `1px solid ${T.border}`,
              borderRadius: T.radiusLg,
              padding: '14px 14px',
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              cursor: 'pointer',
              boxShadow: T.shadowSm,
            }}
          >
            <div style={{
              width: 48, height: 48,
              borderRadius: T.radiusMd,
              background: m.bg,
              border: `1px solid ${m.color}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, flexShrink: 0,
            }}>
              {m.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
                {m.label}
              </div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 3 }}>
                {m.sub}
              </div>
            </div>
            <div style={{
              width: 30, height: 30, borderRadius: T.radiusFull,
              background: m.bg, border: `1px solid ${m.color}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="10" height="12" viewBox="0 0 10 14" fill="none">
                <path d="M1 1l8 6-8 6" stroke={m.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        ))}

        {/* ── Today's QC log ── */}
        <div style={{
          fontSize: 11, fontWeight: 700, color: T.textTertiary,
          fontFamily: T.fontBody, textTransform: 'uppercase',
          letterSpacing: '0.07em', marginTop: 8, marginBottom: 8,
        }}>
          Today's Checks
        </div>

        {MOCK_QC_CHECKS.map(check => {
          const r = RESULT_MAP[check.result] || RESULT_MAP.pass;
          return (
            <div key={check.id} style={{
              background: T.bgSurface,
              border: `1px solid ${check.result === 'open' ? T.primary + '40' : T.border}`,
              borderRadius: T.radiusLg,
              padding: '12px 14px',
              marginBottom: 8,
              boxShadow: T.shadowSm,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ flex: 1, paddingRight: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{check.item}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                    Flight {check.flight} · {check.time} · {check.checkedBy}
                  </div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: r.color,
                  background: r.bg, padding: '2px 8px',
                  borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0,
                }}>
                  {r.label}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  background: T.bgSubtle, borderRadius: T.radiusMd,
                  padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6,
                }}>
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
