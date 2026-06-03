import { useState, useEffect, useRef, useCallback } from 'react';
import { Tooltip } from 'antd';
import {
  BgColorsOutlined,
  CheckOutlined,
  ReloadOutlined,
  LayoutOutlined,
  FontSizeOutlined,
  SettingOutlined,
  DownloadOutlined,
  UploadOutlined,
  ThunderboltOutlined,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { useThemeStore, THEME_PRESETS, SIDEBAR_COLOR_PRESETS, FEATURED_PRESET_COUNT } from '@/stores/themeStore';
import type {
  BorderRadiusMode, DensityMode, FontFamilyMode,
  TopbarStyle, FontSizeMode, SidebarStyle, SidebarColor,
} from '@/stores/themeStore';
import { deriveColorScale } from '@/utils/colorUtils';

/* ─── Constants ──────────────────────────────────────────────────────── */
type TabId = 'colors' | 'layout' | 'type' | 'system';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'colors', label: 'Colors', icon: <BgColorsOutlined /> },
  { id: 'layout', label: 'Layout', icon: <LayoutOutlined />   },
  { id: 'type',   label: 'Type',   icon: <FontSizeOutlined /> },
  { id: 'system', label: 'System', icon: <SettingOutlined />  },
];

const RADII: { value: BorderRadiusMode; label: string; r: number }[] = [
  { value: 'sharp',   label: 'Sharp',   r: 3  },
  { value: 'default', label: 'Default', r: 10 },
  { value: 'rounded', label: 'Rounded', r: 18 },
];

const DENSITIES: { value: DensityMode; label: string; gap: number }[] = [
  { value: 'compact',  label: 'Compact',  gap: 2 },
  { value: 'default',  label: 'Default',  gap: 4 },
  { value: 'spacious', label: 'Spacious', gap: 7 },
];

const FONTS: { value: FontFamilyMode; label: string; stack: string; specimen: string }[] = [
  { value: 'manrope', label: 'Manrope',   stack: 'Manrope, sans-serif',   specimen: 'Modern & geometric' },
  { value: 'inter',   label: 'Inter',     stack: 'Inter, sans-serif',     specimen: 'Clean & neutral'    },
  { value: 'system',  label: 'System UI', stack: 'system-ui, sans-serif', specimen: 'Native & familiar'  },
];

const FONT_SIZES: { value: FontSizeMode; label: string; px: string }[] = [
  { value: 'sm', label: 'Small',  px: '12px' },
  { value: 'md', label: 'Medium', px: '13px' },
  { value: 'lg', label: 'Large',  px: '14px' },
];

const TOPBAR_STYLES: { value: TopbarStyle; label: string; desc: string }[] = [
  { value: 'gradient', label: 'Gradient', desc: 'Vivid branded header' },
  { value: 'minimal',  label: 'Minimal',  desc: 'Clean flat surface'   },
];

const SIDEBAR_STYLES: { value: SidebarStyle; label: string; desc: string }[] = [
  { value: 'default',  label: 'Default',  desc: 'Flat sidebar'         },
  { value: 'elevated', label: 'Elevated', desc: 'Shadow depth effect'  },
];

/* ─── Mini App Preview ───────────────────────────────────────────────── */
interface PreviewProps {
  isDark: boolean;
  primary: string;
  primaryDark: string;
  primaryLight: string;
  topbarStyle: TopbarStyle;
  br: number;
}

function MiniPreview({ isDark, primary, primaryDark, primaryLight, topbarStyle, br }: PreviewProps) {
  const sbBg    = isDark ? '#161c2d' : primaryLight;
  const cBg     = isDark ? '#0d1117' : '#f0f2f7';
  const crdBg   = isDark ? '#1c2438' : '#ffffff';
  const sep     = isDark ? '#243048' : '#e4e9f2';
  const topBg   = topbarStyle === 'minimal' ? (isDark ? '#1c2438' : '#ffffff') : undefined;
  const topGrad = topbarStyle === 'gradient'
    ? `linear-gradient(90deg, ${primaryDark} 0%, ${primary} 100%)`
    : undefined;

  return (
    <div className="tc-preview" style={{ borderRadius: br + 2, border: `1.5px solid ${sep}` }}>
      {/* Sidebar */}
      <div className="tc-preview-sb" style={{ background: sbBg, borderRight: `1px solid ${sep}` }}>
        <div style={{ width: 26, height: 6, background: primary, borderRadius: 2, marginBottom: 8 }} />
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} style={{
            width: '100%', height: 7, borderRadius: 2.5, marginBottom: 3,
            background: i === 2 ? primary + '28' : 'transparent',
            borderLeft: i === 2 ? `2.5px solid ${primary}` : '2.5px solid transparent',
          }} />
        ))}
      </div>
      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Topbar */}
        <div style={{
          height: 24, flexShrink: 0, display: 'flex', alignItems: 'center',
          padding: '0 8px', gap: 5,
          background: topGrad ?? topBg,
          borderBottom: topbarStyle === 'minimal' ? `1px solid ${sep}` : 'none',
        }}>
          <div style={{
            height: 4, flex: 1, borderRadius: 2,
            background: topbarStyle === 'minimal'
              ? (isDark ? '#ffffff1c' : '#00000011')
              : 'rgba(255,255,255,0.40)',
          }} />
          {[1, 2, 3].map(i => (
            <div key={i} style={{
              width: 13, height: 13, borderRadius: '50%',
              background: topbarStyle === 'minimal'
                ? (isDark ? '#ffffff16' : '#0000000d')
                : 'rgba(255,255,255,0.28)',
            }} />
          ))}
        </div>
        {/* Content */}
        <div style={{ flex: 1, background: cBg, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{
                flex: 1, height: 22, borderRadius: Math.max(br / 2, 2),
                background: crdBg, border: `1px solid ${sep}`,
                display: 'flex', alignItems: 'center', padding: '0 6px',
              }}>
                <div style={{
                  height: 3, borderRadius: 2,
                  width: i === 1 ? '60%' : i === 2 ? '80%' : '45%',
                  background: i === 1 ? primary + '70' : (isDark ? '#ffffff14' : '#00000010'),
                }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 3, flex: 1 }}>
            <div style={{
              flex: 3, borderRadius: Math.max(br / 2, 2),
              background: crdBg, border: `1px solid ${sep}`,
              padding: 5, display: 'flex', flexDirection: 'column', gap: 3,
            }}>
              {[70, 50, 85].map((w, i) => (
                <div key={i} style={{
                  height: 3, borderRadius: 2, width: `${w}%`,
                  background: isDark ? '#ffffff14' : '#00000010',
                }} />
              ))}
            </div>
            <div style={{ flex: 1, borderRadius: Math.max(br / 2, 2), background: primary, opacity: 0.88 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── iOS-style Toggle ───────────────────────────────────────────────── */
interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  primary: string;
  isDark: boolean;
}

function Toggle({ checked, onChange, primary, isDark }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 46, height: 26, borderRadius: 13, flexShrink: 0,
        background: checked ? primary : (isDark ? '#2d3e5c' : '#cbd5e1'),
        border: 'none', cursor: 'pointer', position: 'relative', outline: 'none',
        transition: 'background 0.22s cubic-bezier(0.4,0,0.2,1)',
        boxShadow: checked ? `0 0 0 3px ${primary}28` : 'none',
      }}
    >
      <div style={{
        position: 'absolute', top: 3, left: checked ? 23 : 3,
        width: 20, height: 20, borderRadius: '50%',
        background: '#ffffff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.28)',
        transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1)',
      }} />
    </button>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────── */
export function ThemeCenter() {
  const {
    presetName, primaryColor, primaryDark, primaryLight,
    borderRadius, density, fontFamily, topbarStyle,
    fontSize, sidebarStyle, sidebarColor, sidebarCustomBg, sidebarCustomFg, motionReduced,
    setMode, applyPreset, setCustomColor, setBorderRadius,
    setDensity, setFontFamily, setTopbarStyle,
    setFontSize, setSidebarStyle, setSidebarColor, setSidebarCustomBg,
    setSidebarCustomFg, setMotionReduced, reset,
  } = useThemeStore();

  const sidebarColorInputRef = useRef<HTMLInputElement>(null);

  const isDark = false;
  const [activeTab, setActiveTab] = useState<TabId>('colors');
  const [showMoreColors, setShowMoreColors] = useState(false);
  const [customHex, setCustomHex] = useState(primaryColor);
  const colorInputRef  = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setCustomHex(primaryColor); }, [primaryColor]);

  /* Auto-expand More Colors if the active preset lives in the hidden range */
  useEffect(() => {
    const idx = THEME_PRESETS.findIndex(p => p.name === presetName);
    if (idx >= FEATURED_PRESET_COUNT) setShowMoreColors(true);
  }, [presetName]);

  const handleCustomColor = useCallback((hex: string) => {
    setCustomHex(hex);
    const scale = deriveColorScale(hex);
    setCustomColor(scale.primary, scale.dark, scale.light);
  }, [setCustomColor]);

  /* Export current theme as JSON download */
  const handleExport = useCallback(() => {
    const data = {
      presetName, primaryColor, primaryDark, primaryLight,
      borderRadius, density, fontFamily, topbarStyle,
      fontSize, sidebarStyle, sidebarColor, sidebarCustomBg, sidebarCustomFg, motionReduced,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `vizyon-theme-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [presetName, primaryColor, primaryDark, primaryLight, borderRadius, density, fontFamily, topbarStyle, fontSize, sidebarStyle, sidebarColor, sidebarCustomBg, sidebarCustomFg, motionReduced]);

  /* Import theme from a JSON file */
  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target?.result as string);
        if (d.mode)       setMode(d.mode);
        if (d.presetName === 'custom' && d.primaryColor) {
          setCustomColor(d.primaryColor, d.primaryDark ?? d.primaryColor, d.primaryLight ?? d.primaryColor);
        } else if (d.presetName) {
          applyPreset(d.presetName);
        }
        if (d.borderRadius) setBorderRadius(d.borderRadius);
        if (d.density)      setDensity(d.density);
        if (d.fontFamily)   setFontFamily(d.fontFamily);
        if (d.topbarStyle)  setTopbarStyle(d.topbarStyle);
        if (d.fontSize)     setFontSize(d.fontSize);
        if (d.sidebarStyle) setSidebarStyle(d.sidebarStyle);
        if (d.sidebarColor) setSidebarColor(d.sidebarColor);
        if (d.sidebarCustomBg) setSidebarCustomBg(d.sidebarCustomBg);
        if (typeof d.sidebarCustomFg === 'string') setSidebarCustomFg(d.sidebarCustomFg);
        if (typeof d.motionReduced === 'boolean') setMotionReduced(d.motionReduced);
      } catch { /* invalid JSON — silently ignore */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [setMode, applyPreset, setCustomColor, setBorderRadius, setDensity, setFontFamily, setTopbarStyle, setFontSize, setSidebarStyle, setSidebarColor, setSidebarCustomBg, setSidebarCustomFg, setMotionReduced]);

  /* ── Derived palette tokens ── */
  const panelBg       = isDark ? '#11172a' : '#ffffff';
  const panelBorder   = isDark ? '#1c2840' : '#e2e8f0';
  const surfaceBg     = isDark ? '#19223a' : '#f8fafc';
  const surfaceBorder = isDark ? '#243050' : '#edf1f7';
  const textPrimary   = isDark ? '#eef2ff' : '#0f172a';
  const textSecondary = isDark ? '#7c8db5' : '#64748b';
  const textMuted     = isDark ? '#4a5a80' : '#94a3b8';
  const btnBg         = isDark ? '#1c2840' : '#f1f5f9';
  const btnBorder     = isDark ? '#2d3e5c' : '#dde3ed';
  const activeBg      = isDark ? primaryColor + '26' : primaryColor + '12';
  const br            = borderRadius === 'sharp' ? 4 : borderRadius === 'rounded' ? 16 : 10;

  return (
    <div className="tc-panel" style={{ background: panelBg, border: `1px solid ${panelBorder}` }}>

      {/* ── Gradient accent stripe ── */}
      <div className="tc-stripe" style={{
        background: `linear-gradient(90deg, ${primaryDark} 0%, ${primaryColor} 55%, ${primaryColor}55 100%)`,
      }} />

      {/* ── Header ── */}
      <div className="tc-header" style={{ borderBottom: `1px solid ${surfaceBorder}` }}>
        <div className="tc-header-left">
          <div className="tc-header-icon" style={{ background: primaryColor + '1c', color: primaryColor }}>
            <BgColorsOutlined style={{ fontSize: 15 }} />
          </div>
          <div>
            <div className="tc-header-title" style={{ color: textPrimary }}>Theme Center</div>
            <div className="tc-header-sub" style={{ color: textMuted }}>Personalize your workspace</div>
          </div>
        </div>
        <Tooltip title="Reset to defaults" placement="left">
          <button
            className="tc-icon-btn"
            style={{ color: textSecondary, background: btnBg, border: `1px solid ${btnBorder}` }}
            onClick={reset}
            aria-label="Reset theme"
          >
            <ReloadOutlined style={{ fontSize: 12 }} />
          </button>
        </Tooltip>
      </div>

      {/* ── Mini Preview ── */}
      <div className="tc-preview-shell">
        <MiniPreview
          isDark={isDark}
          primary={primaryColor}
          primaryDark={primaryDark}
          primaryLight={primaryLight}
          topbarStyle={topbarStyle}
          br={br}
        />
      </div>

      {/* ── Tab Bar ── */}
      <div className="tc-tabbar" style={{ borderBottom: `1px solid ${surfaceBorder}` }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`tc-tab${active ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              style={{
                color: active ? primaryColor : textSecondary,
                borderBottom: `2px solid ${active ? primaryColor : 'transparent'}`,
              }}
            >
              <span className="tc-tab-icon">{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Body ── */}
      <div className="tc-body">

        {/* ══════════════ COLORS TAB ══════════════ */}
        {activeTab === 'colors' && (
          <div className="tc-content">

            {/* Color presets */}
            <div className="tc-section">
              <div className="tc-label" style={{ color: textMuted }}>
                Color Presets
                <span style={{ marginLeft: 6, color: textMuted, fontWeight: 500, opacity: 0.7 }}>
                  ({THEME_PRESETS.length})
                </span>
              </div>
              <div className="tc-presets">
                {(showMoreColors ? THEME_PRESETS : THEME_PRESETS.slice(0, FEATURED_PRESET_COUNT)).map(preset => {
                  const active = presetName === preset.name;
                  return (
                    <button
                      key={preset.name}
                      className="tc-preset"
                      onClick={() => applyPreset(preset.name)}
                      title={preset.label}
                      style={{
                        background: active ? activeBg : 'transparent',
                        border: `1.5px solid ${active ? primaryColor : 'transparent'}`,
                      }}
                    >
                      <div
                        className="tc-preset-dot"
                        style={{
                          background: `linear-gradient(135deg, ${preset.primary}, ${preset.dark})`,
                          boxShadow: active
                            ? `0 0 0 2px ${panelBg}, 0 0 0 3.5px ${preset.primary}`
                            : `0 2px 6px ${preset.primary}44`,
                        }}
                      >
                        {active && (
                          <CheckOutlined style={{ color: '#fff', fontSize: 9, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.5))' }} />
                        )}
                      </div>
                      <span className="tc-preset-name" style={{
                        color: active ? primaryColor : textSecondary,
                        fontWeight: active ? 700 : 400,
                      }}>
                        {preset.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {THEME_PRESETS.length > FEATURED_PRESET_COUNT && (
                <button
                  className="tc-more-colors"
                  onClick={() => setShowMoreColors(v => !v)}
                  style={{
                    color: primaryColor,
                    background: showMoreColors ? activeBg : surfaceBg,
                    border: `1.5px dashed ${primaryColor}55`,
                  }}
                >
                  {showMoreColors ? (
                    <>
                      <UpOutlined style={{ fontSize: 10 }} />
                      Show Less
                    </>
                  ) : (
                    <>
                      <DownOutlined style={{ fontSize: 10 }} />
                      More Colors
                      <span style={{
                        background: primaryColor, color: '#fff', fontSize: 9,
                        padding: '1px 6px', borderRadius: 999, fontWeight: 700, marginLeft: 2,
                      }}>
                        +{THEME_PRESETS.length - FEATURED_PRESET_COUNT}
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Custom color picker */}
            <div className="tc-section">
              <div className="tc-label" style={{ color: textMuted }}>Custom Color</div>
              <div className="tc-colorpick-row">
                <div
                  className="tc-swatch"
                  style={{
                    background: customHex,
                    boxShadow: `0 2px 12px ${customHex}65`,
                    border: `2.5px solid ${panelBorder}`,
                  }}
                  onClick={() => colorInputRef.current?.click()}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); colorInputRef.current?.click(); } }}
                  role="button"
                  tabIndex={0}
                  aria-label="Open color picker"
                />
                <input
                  ref={colorInputRef}
                  type="color"
                  value={customHex}
                  onChange={e => handleCustomColor(e.target.value)}
                  style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
                  tabIndex={-1}
                />
                <div className="tc-hex-wrap" style={{ background: btnBg, border: `1px solid ${btnBorder}` }}>
                  <span style={{ color: textMuted, fontFamily: 'monospace', fontSize: 13, fontWeight: 700, userSelect: 'none' }}>#</span>
                  <input
                    type="text"
                    style={{
                      color: textPrimary, background: 'transparent',
                      border: 'none', outline: 'none', flex: 1,
                      fontSize: 13, fontWeight: 700, fontFamily: 'monospace', minWidth: 0,
                    }}
                    value={customHex.replace('#', '')}
                    maxLength={6}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9a-fA-F]/g, '');
                      setCustomHex('#' + raw);
                      if (raw.length === 6) handleCustomColor('#' + raw);
                    }}
                    placeholder="0f766e"
                    spellCheck={false}
                  />
                </div>
                <button
                  className="tc-apply"
                  style={{ background: primaryColor, border: 'none', color: '#fff' }}
                  onClick={() => handleCustomColor(customHex)}
                >
                  Apply
                </button>
              </div>
              {presetName === 'custom' && (
                <div className="tc-custom-badge" style={{ color: primaryColor, background: primaryColor + '16' }}>
                  Custom color active
                </div>
              )}
            </div>

          </div>
        )}

        {/* ══════════════ LAYOUT TAB ══════════════ */}
        {activeTab === 'layout' && (
          <div className="tc-content">

            {/* Header style */}
            <div className="tc-section">
              <div className="tc-label" style={{ color: textMuted }}>Header Style</div>
              <div className="tc-card-row">
                {TOPBAR_STYLES.map(s => {
                  const active = topbarStyle === s.value;
                  return (
                    <button
                      key={s.value}
                      className="tc-option-card"
                      onClick={() => setTopbarStyle(s.value)}
                      style={{
                        border: `1.5px solid ${active ? primaryColor : btnBorder}`,
                        background: active ? activeBg : surfaceBg,
                      }}
                    >
                      <div className="tc-bar-preview" style={{
                        background: s.value === 'gradient'
                          ? `linear-gradient(90deg, ${primaryDark}, ${primaryColor})`
                          : (isDark ? '#2a3752' : '#ffffff'),
                        border: s.value === 'minimal' ? `1px solid ${surfaceBorder}` : 'none',
                      }} />
                      <div className="tc-option-card-foot">
                        <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? primaryColor : textSecondary }}>
                          {s.label}
                        </span>
                        {active && (
                          <div className="tc-check-circle" style={{ background: primaryColor }}>
                            <CheckOutlined style={{ color: '#fff', fontSize: 8 }} />
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 10, color: textMuted, alignSelf: 'flex-start' }}>{s.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sidebar style */}
            <div className="tc-section">
              <div className="tc-label" style={{ color: textMuted }}>Sidebar Style</div>
              <div className="tc-card-row">
                {SIDEBAR_STYLES.map(s => {
                  const active = sidebarStyle === s.value;
                  return (
                    <button
                      key={s.value}
                      className="tc-option-card"
                      onClick={() => setSidebarStyle(s.value)}
                      style={{
                        border: `1.5px solid ${active ? primaryColor : btnBorder}`,
                        background: active ? activeBg : surfaceBg,
                      }}
                    >
                      <div style={{
                        width: 40, height: 24, position: 'relative',
                        background: isDark ? '#0f1117' : '#f0f2f7',
                        borderRadius: 4, overflow: 'hidden',
                        boxShadow: s.value === 'elevated'
                          ? (active ? `4px 0 10px ${primaryColor}40` : '4px 0 10px rgba(0,0,0,0.15)')
                          : 'none',
                      }}>
                        <div style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0, width: 13,
                          background: active ? primaryColor + '30' : (isDark ? '#1c2438' : '#e8efff'),
                        }} />
                        {s.value === 'elevated' && (
                          <div style={{
                            position: 'absolute', left: 13, top: 0, bottom: 0, width: 2,
                            background: active ? primaryColor + '50' : 'rgba(0,0,0,0.08)',
                            boxShadow: '1px 0 5px rgba(0,0,0,0.14)',
                          }} />
                        )}
                      </div>
                      <div className="tc-option-card-foot">
                        <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? primaryColor : textSecondary }}>
                          {s.label}
                        </span>
                        {active && (
                          <div className="tc-check-circle" style={{ background: primaryColor }}>
                            <CheckOutlined style={{ color: '#fff', fontSize: 8 }} />
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 10, color: textMuted, alignSelf: 'flex-start' }}>{s.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sidebar color */}
            <div className="tc-section">
              <div className="tc-label" style={{ color: textMuted }}>Sidebar Color</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
                {SIDEBAR_COLOR_PRESETS.map(p => {
                  const active = sidebarColor === p.name;
                  const swatchBg = p.name === 'primary' ? primaryLight : p.bg;
                  const isLight = p.tone === 'light';
                  return (
                    <Tooltip key={p.name} title={p.label} placement="top">
                      <button
                        onClick={() => setSidebarColor(p.name as SidebarColor)}
                        aria-label={`Sidebar color ${p.label}`}
                        style={{
                          width: '100%', aspectRatio: '1 / 1',
                          background: swatchBg,
                          border: `1.5px solid ${active ? primaryColor : (isLight ? btnBorder : 'transparent')}`,
                          borderRadius: 8, cursor: 'pointer', outline: 'none',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: active ? `0 0 0 2px ${panelBg}, 0 0 0 3.5px ${primaryColor}` : 'none',
                          transition: 'all 0.18s ease',
                        }}
                      >
                        {active && (
                          <CheckOutlined style={{
                            color: isLight ? primaryColor : '#ffffff',
                            fontSize: 12,
                            filter: isLight ? 'none' : 'drop-shadow(0 1px 1px rgba(0,0,0,.4))',
                          }} />
                        )}
                      </button>
                    </Tooltip>
                  );
                })}
                <Tooltip title="Custom color" placement="top">
                  <button
                    onClick={() => sidebarColorInputRef.current?.click()}
                    aria-label="Custom sidebar color"
                    style={{
                      width: '100%', aspectRatio: '1 / 1',
                      background: sidebarColor === 'custom'
                        ? sidebarCustomBg
                        : 'conic-gradient(from 180deg, #f87171, #fbbf24, #34d399, #60a5fa, #a78bfa, #f87171)',
                      border: `1.5px solid ${sidebarColor === 'custom' ? primaryColor : btnBorder}`,
                      borderRadius: 8, cursor: 'pointer', outline: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: sidebarColor === 'custom' ? `0 0 0 2px ${panelBg}, 0 0 0 3.5px ${primaryColor}` : 'none',
                      transition: 'all 0.18s ease',
                    }}
                  >
                    {sidebarColor === 'custom' && (
                      <CheckOutlined style={{
                        color: '#ffffff', fontSize: 12,
                        filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.4))',
                      }} />
                    )}
                  </button>
                </Tooltip>
                <input
                  ref={sidebarColorInputRef}
                  type="color"
                  value={sidebarCustomBg}
                  onChange={e => setSidebarCustomBg(e.target.value)}
                  style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
                  tabIndex={-1}
                />
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginTop: 8, fontSize: 11,
              }}>
                <span style={{ color: textMuted }}>
                  Active:{' '}
                  <span style={{ color: textSecondary, fontWeight: 600 }}>
                    {sidebarColor === 'custom'
                      ? sidebarCustomBg.toUpperCase()
                      : SIDEBAR_COLOR_PRESETS.find(p => p.name === sidebarColor)?.label}
                  </span>
                </span>
                {sidebarColor !== 'primary' && (
                  <button
                    onClick={() => setSidebarColor('primary')}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: primaryColor, fontSize: 11, fontWeight: 600, padding: 0,
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>

            </div>

            {/* Corner radius */}
            <div className="tc-section">
              <div className="tc-label" style={{ color: textMuted }}>Corner Radius</div>
              <div className="tc-card-row">
                {RADII.map(r => {
                  const active = borderRadius === r.value;
                  return (
                    <button
                      key={r.value}
                      className="tc-option-card"
                      onClick={() => setBorderRadius(r.value)}
                      style={{
                        border: `1.5px solid ${active ? primaryColor : btnBorder}`,
                        background: active ? activeBg : surfaceBg,
                      }}
                    >
                      <div style={{
                        width: 40, height: 24, borderRadius: r.r,
                        background: active
                          ? `linear-gradient(135deg, ${primaryColor}, ${primaryDark})`
                          : (isDark ? '#2a3752' : '#dde3ed'),
                        transition: 'all 0.2s ease',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {active && <CheckOutlined style={{ color: '#fff', fontSize: 9 }} />}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? primaryColor : textSecondary, marginTop: 6 }}>
                        {r.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* UI Density */}
            <div className="tc-section">
              <div className="tc-label" style={{ color: textMuted }}>UI Density</div>
              <div className="tc-card-row">
                {DENSITIES.map(d => {
                  const active = density === d.value;
                  return (
                    <button
                      key={d.value}
                      className="tc-option-card"
                      onClick={() => setDensity(d.value)}
                      style={{
                        border: `1.5px solid ${active ? primaryColor : btnBorder}`,
                        background: active ? activeBg : surfaceBg,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: d.gap, width: 40 }}>
                        {[100, 70, 50].map((w, i) => (
                          <div key={i} style={{
                            height: 4, borderRadius: 2, width: `${w}%`,
                            background: active
                              ? primaryColor + (i === 0 ? 'cc' : i === 1 ? '80' : '44')
                              : (isDark ? '#2a3752' : '#dde3ed'),
                            transition: 'background 0.2s',
                          }} />
                        ))}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? primaryColor : textSecondary, marginTop: 6 }}>
                        {d.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>
        )}

        {/* ══════════════ TYPE TAB ══════════════ */}
        {activeTab === 'type' && (
          <div className="tc-content">

            {/* Font family */}
            <div className="tc-section">
              <div className="tc-label" style={{ color: textMuted }}>Font Family</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {FONTS.map(f => {
                  const active = fontFamily === f.value;
                  return (
                    <button
                      key={f.value}
                      className="tc-font-row"
                      onClick={() => setFontFamily(f.value)}
                      style={{
                        border: `1.5px solid ${active ? primaryColor : btnBorder}`,
                        background: active ? activeBg : surfaceBg,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, alignItems: 'flex-start', minWidth: 0 }}>
                        <span style={{
                          fontSize: 24, fontWeight: 800, lineHeight: 1,
                          fontFamily: f.stack,
                          color: active ? primaryColor : textPrimary,
                          transition: 'color 0.18s',
                        }}>Aa</span>
                        <span style={{
                          fontSize: 10, fontFamily: f.stack, color: textMuted,
                          lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {f.specimen}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? primaryColor : textSecondary }}>
                          {f.label}
                        </span>
                        {active && (
                          <div className="tc-check-circle" style={{ background: primaryColor }}>
                            <CheckOutlined style={{ color: '#fff', fontSize: 8 }} />
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Font size */}
            <div className="tc-section">
              <div className="tc-label" style={{ color: textMuted }}>Font Size</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {FONT_SIZES.map(s => {
                  const active = fontSize === s.value;
                  return (
                    <button
                      key={s.value}
                      onClick={() => setFontSize(s.value)}
                      style={{
                        flex: 1, height: 60, border: `1.5px solid ${active ? primaryColor : btnBorder}`,
                        background: active ? activeBg : surfaceBg,
                        borderRadius: 10, cursor: 'pointer', outline: 'none',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 4,
                        transition: 'all 0.18s ease',
                      }}
                    >
                      <span style={{
                        fontSize: s.value === 'sm' ? 14 : s.value === 'lg' ? 22 : 18,
                        fontWeight: 800, lineHeight: 1,
                        color: active ? primaryColor : textPrimary,
                        fontFamily: 'var(--font-family-base)',
                      }}>A</span>
                      <span style={{ fontSize: 9, color: active ? primaryColor : textMuted, fontWeight: 600, letterSpacing: '0.03em' }}>
                        {s.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Live type preview */}
            <div className="tc-section" style={{ background: surfaceBg, border: `1px solid ${surfaceBorder}` }}>
              <div className="tc-label" style={{ color: textMuted }}>Preview</div>
              <div style={{ fontFamily: FONTS.find(f => f.value === fontFamily)?.stack }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: textPrimary, lineHeight: 1.25, marginBottom: 6, letterSpacing: '-0.01em' }}>
                  Flight Catering Platform
                </div>
                <div style={{ fontSize: 12, color: textSecondary, lineHeight: 1.65, marginBottom: 12 }}>
                  Plan meals across every route. Track production, manage inventory, and streamline dispatch operations.
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: '#fff',
                    background: primaryColor, padding: '5px 12px',
                    borderRadius: br, display: 'inline-block',
                  }}>Primary</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: primaryColor,
                    border: `1.5px solid ${primaryColor}`, padding: '5px 12px',
                    borderRadius: br, display: 'inline-block', background: 'transparent',
                  }}>Outline</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: primaryColor,
                    background: primaryColor + '18', padding: '5px 12px',
                    borderRadius: 999, display: 'inline-block',
                  }}>Badge</span>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ══════════════ SYSTEM TAB ══════════════ */}
        {activeTab === 'system' && (
          <div className="tc-content">

            {/* Motion / Accessibility */}
            <div className="tc-section">
              <div className="tc-label" style={{ color: textMuted }}>Accessibility</div>
              <div className="tc-toggle-row" style={{ background: surfaceBg, border: `1px solid ${surfaceBorder}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: textPrimary, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ThunderboltOutlined style={{ fontSize: 13, color: motionReduced ? textMuted : primaryColor }} />
                    Reduce Motion
                  </div>
                  <div style={{ fontSize: 11, color: textMuted, marginTop: 3 }}>
                    {motionReduced ? 'Transitions & animations disabled' : 'Smooth animations enabled'}
                  </div>
                </div>
                <Toggle
                  checked={motionReduced}
                  onChange={setMotionReduced}
                  primary={primaryColor}
                  isDark={isDark}
                />
              </div>
            </div>

            {/* Export / Import */}
            <div className="tc-section">
              <div className="tc-label" style={{ color: textMuted }}>Export & Import</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  className="tc-action-btn"
                  onClick={handleExport}
                  style={{ color: primaryColor, background: activeBg, border: `1.5px solid ${primaryColor}40` }}
                >
                  <DownloadOutlined style={{ fontSize: 15, flexShrink: 0 }} />
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Export Theme</div>
                    <div style={{ fontSize: 10, color: primaryColor, opacity: 0.65, marginTop: 1 }}>Download settings as JSON</div>
                  </div>
                </button>

                <button
                  className="tc-action-btn"
                  onClick={() => importInputRef.current?.click()}
                  style={{ color: textSecondary, background: surfaceBg, border: `1.5px solid ${btnBorder}` }}
                >
                  <UploadOutlined style={{ fontSize: 15, flexShrink: 0 }} />
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Import Theme</div>
                    <div style={{ fontSize: 10, color: textMuted, marginTop: 1 }}>Load from a JSON file</div>
                  </div>
                </button>

                <input
                  ref={importInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportFile}
                  style={{ display: 'none' }}
                  tabIndex={-1}
                />
              </div>
            </div>

            {/* Active theme summary */}
            <div className="tc-section">
              <div className="tc-label" style={{ color: textMuted }}>Active Settings</div>
              <div className="tc-summary">
                {[
                  { k: 'Color',   v: presetName === 'custom' ? 'Custom' : presetName.charAt(0).toUpperCase() + presetName.slice(1) },
                  { k: 'Font',    v: FONTS.find(f => f.value === fontFamily)?.label ?? fontFamily },
                  { k: 'Size',    v: FONT_SIZES.find(s => s.value === fontSize)?.px ?? fontSize },
                  { k: 'Radius',  v: borderRadius.charAt(0).toUpperCase() + borderRadius.slice(1) },
                  { k: 'Density', v: density.charAt(0).toUpperCase() + density.slice(1) },
                  { k: 'Header',  v: topbarStyle.charAt(0).toUpperCase() + topbarStyle.slice(1) },
                  { k: 'Sidebar', v: sidebarStyle.charAt(0).toUpperCase() + sidebarStyle.slice(1) },
                  { k: 'Sidebar Color', v: sidebarColor.charAt(0).toUpperCase() + sidebarColor.slice(1) },
                ].map(({ k, v }) => (
                  <div
                    key={k}
                    className="tc-summary-chip"
                    style={{ background: surfaceBg, border: `1px solid ${surfaceBorder}` }}
                  >
                    <span style={{ color: textMuted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</span>
                    <span style={{ color: textPrimary, fontWeight: 600, fontSize: 11 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
