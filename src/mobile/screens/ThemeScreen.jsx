import { useState } from 'react';
import { T, THEME_PRESETS, FEATURED_PRESET_COUNT, MOBILE_FONT_SIZES, DEFAULT_MOBILE_THEME } from '../theme';

// The mobile mirror of the web Theme Center: appearance mode, brand colour
// preset (same list as the web, so a colour chosen here exists on the desk
// too) and display size. Changes apply live — the screen's own chrome is the
// preview.

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '20px 2px 8px' }}>
      {children}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '14px', boxShadow: T.shadowSm, ...style }}>
      {children}
    </div>
  );
}

// Light / Dark — two mini phone mock-ups, tap to pick (the web's mode picker
// uses the same "preview tile" idiom).
function ModeTile({ label, icon, active, surface, base, text, onPick }) {
  return (
    <button
      onClick={onPick}
      style={{
        flex: 1, cursor: 'pointer', padding: 0, textAlign: 'center',
        background: 'none', border: 'none', fontFamily: T.fontBody,
      }}
    >
      <div style={{
        border: `2px solid ${active ? T.primary : T.border}`,
        borderRadius: T.radiusMd, overflow: 'hidden', background: base,
        height: 74, display: 'flex', flexDirection: 'column',
        boxShadow: active ? `0 0 0 3px ${T.primaryLight}` : 'none',
      }}>
        <div style={{ height: 16, background: T.topbarGradient }} />
        <div style={{ flex: 1, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ height: 8, borderRadius: 3, background: surface, border: `1px solid ${text}22` }} />
          <div style={{ height: 8, borderRadius: 3, background: surface, border: `1px solid ${text}22`, width: '70%' }} />
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, fontWeight: active ? 800 : 600, color: active ? T.primary : T.textSecondary }}>
        {icon} {label}
      </div>
    </button>
  );
}

export function ThemeScreen({ nav }) {
  const s = nav.themeSettings;
  const [showAll, setShowAll] = useState(false);
  const presets = showAll ? THEME_PRESETS : THEME_PRESETS.slice(0, FEATURED_PRESET_COUNT);
  const isDefault = s.mode === DEFAULT_MOBILE_THEME.mode && s.presetName === DEFAULT_MOBILE_THEME.presetName && s.fontSize === DEFAULT_MOBILE_THEME.fontSize;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      {/* Topbar — itself the live preview of the chosen colour */}
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Theme & Appearance</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1 }}>Changes apply instantly, on this device</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 14px 24px' }}>
        {/* ── Mode ── */}
        <SectionLabel>Appearance</SectionLabel>
        <Card>
          <div style={{ display: 'flex', gap: 12 }}>
            <ModeTile label="Light" icon="☀️" active={s.mode === 'light'} base="#F4F5F8" surface="#ffffff" text="#111827" onPick={() => nav.patchTheme({ mode: 'light' })} />
            <ModeTile label="Dark"  icon="🌙" active={s.mode === 'dark'}  base="#0f1420" surface="#1a2130" text="#f1f5f9" onPick={() => nav.patchTheme({ mode: 'dark' })} />
          </div>
        </Card>

        {/* ── Colour preset ── */}
        <SectionLabel>Theme Colour</SectionLabel>
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {presets.map((p) => {
              const active = p.name === s.presetName;
              return (
                <button
                  key={p.name}
                  onClick={() => nav.patchTheme({ presetName: p.name })}
                  aria-label={`Theme colour ${p.label}`}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontFamily: T.fontBody }}
                >
                  <span style={{
                    width: 34, height: 34, borderRadius: T.radiusFull,
                    background: `linear-gradient(135deg, ${p.primary} 0%, ${p.dark} 100%)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: active ? `2px solid ${T.textPrimary}` : `2px solid ${T.border}`,
                    boxShadow: active ? `0 0 0 3px ${p.light}` : 'none',
                    color: '#fff', fontSize: 14, fontWeight: 800,
                  }}>
                    {active ? '✓' : ''}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: active ? 800 : 500, color: active ? T.textPrimary : T.textTertiary, lineHeight: 1.1 }}>
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setShowAll((v) => !v)}
            style={{ width: '100%', marginTop: 12, padding: '8px 0', background: T.bgSubtle, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, fontSize: 12, fontWeight: 700, color: T.primary, fontFamily: T.fontBody, cursor: 'pointer' }}
          >
            {showAll ? '▲ Show featured colours' : `▼ All colours (${THEME_PRESETS.length})`}
          </button>
        </Card>

        {/* ── Font size ── */}
        <SectionLabel>Font Size</SectionLabel>
        <Card>
          <div style={{ display: 'flex', gap: 10 }}>
            {MOBILE_FONT_SIZES.map((f) => {
              const active = f.key === s.fontSize;
              return (
                <button
                  key={f.key}
                  onClick={() => nav.patchTheme({ fontSize: f.key })}
                  style={{
                    flex: 1, cursor: 'pointer', fontFamily: T.fontBody,
                    background: active ? T.primaryLight : T.bgSubtle,
                    border: `2px solid ${active ? T.primary : T.border}`,
                    borderRadius: T.radiusMd, padding: '10px 0 8px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  }}
                >
                  {/* the sample glyph scales (exaggerated so the sizes read at a glance), the label doesn't */}
                  <span style={{ fontSize: { sm: 12, md: 15, lg: 19 }[f.key] || 15, fontWeight: 800, color: active ? T.primary : T.textSecondary, lineHeight: 1.2 }}>Aa</span>
                  <span style={{ fontSize: 11, fontWeight: active ? 800 : 600, color: active ? T.primary : T.textTertiary }}>{f.label}</span>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, lineHeight: 1.5 }}>
            Scales the whole app, like your phone's display-size setting.
          </div>
        </Card>

        {/* ── Reset ── */}
        <button
          onClick={() => nav.patchTheme({ ...DEFAULT_MOBILE_THEME })}
          disabled={isDefault}
          style={{
            width: '100%', marginTop: 22, padding: '12px 0',
            background: T.bgSurface, border: `1px solid ${isDefault ? T.border : T.borderStrong}`,
            borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700,
            color: isDefault ? T.textDisabled : T.textSecondary,
            fontFamily: T.fontBody, cursor: isDefault ? 'default' : 'pointer',
          }}
        >
          Reset to AeroGalley default
        </button>
      </div>
    </div>
  );
}
