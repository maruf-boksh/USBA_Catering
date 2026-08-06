// All design tokens for the mobile mini-app.
// Every mobile screen must import from here — no per-screen colour literals.

// The web Theme Center's colour presets, reused verbatim so the phone offers
// the exact same palette as the desk (Harvest red is presets[0] = the default).
import { THEME_PRESETS, FEATURED_PRESET_COUNT } from '../stores/themeStore';

export { THEME_PRESETS, FEATURED_PRESET_COUNT };

export const T = {
  // ── Brand ──────────────────────────────────────────────────────────────
  primary:        '#E10101',
  primaryDark:    '#a60303',
  primaryLight:   '#fff0f0',
  highlight:      '#f59e0b',
  textOnPrimary:  '#ffffff',

  // ── Backgrounds ────────────────────────────────────────────────────────
  bgBase:    '#F4F5F8',
  bgSurface: '#ffffff',
  bgSubtle:  '#F8FAFC',

  // ── Text ───────────────────────────────────────────────────────────────
  textPrimary:   '#111827',
  textSecondary: '#374151',
  textTertiary:  '#6b7280',
  textDisabled:  '#9ca3af',

  // ── Borders ────────────────────────────────────────────────────────────
  border:       '#e5e7eb',
  borderStrong: '#d1d5db',

  // ── Status ─────────────────────────────────────────────────────────────
  statusPending:     '#d97706',
  statusPendingBg:   '#fffbeb',
  statusApproved:    '#059669',
  statusApprovedBg:  '#f0fdf4',
  statusRejected:    '#dc2626',
  statusRejectedBg:  '#fef2f2',
  statusDraft:       '#6b7280',
  statusDraftBg:     '#f9fafb',
  statusInfo:        '#0ea5e9',
  statusInfoBg:      '#f0f9ff',

  // Order-lifecycle status colours — the web Order Management pill palette
  // (OM_STAT_CLS in routes/order-management.tsx), kept hex-identical so an
  // order reads the same colour on the phone as on the desk. Pending is GOLD
  // there, deliberately apart from Production's amber.
  statusOrderPending:    '#8a6400',
  statusOrderPendingBg:  '#fbf4e2',
  statusProduction:      '#b45309',
  statusProductionBg:    '#fbf1e6',
  statusPackaged:        '#2563eb',
  statusPackagedBg:      '#eff4ff',
  statusDispatched:      '#1f9d57',
  statusDispatchedBg:    '#ecf5ef',
  statusCompleted:       '#0f7a40',
  statusCompletedBg:     '#ecf5ef',
  // Mixed-order progress readout ("3 of 38 still Production") — the web's
  // indigo, distinct from every lifecycle colour because it is not a status.
  statusProgress:        '#3651d4',
  statusProgressBg:      '#eef1fe',

  // Flight-specific status colours
  statusBoarding:     '#7c3aed',
  statusBoardingBg:   '#f5f3ff',
  statusDelayed:      '#b45309',
  statusDelayedBg:    '#fef3c7',
  statusScheduled:    '#0369a1',
  statusScheduledBg:  '#e0f2fe',
  statusDeparted:     '#374151',
  statusDepartedBg:   '#f3f4f6',

  // ── Gradients ──────────────────────────────────────────────────────────
  buttonGradient: 'linear-gradient(135deg, #ff2d2d 0%, #E10101 55%, #a60303 100%)',
  heroGradient:   'radial-gradient(120% 120% at 8% 95%, #7e0206 0%, #470206 40%, #1d0204 75%, #130103 100%)',
  topbarGradient: 'linear-gradient(96deg, rgba(163,3,3,0.97) 0%, rgba(225,1,1,0.97) 54%, rgba(225,1,1,0.97) 100%)',

  // ── Typography ─────────────────────────────────────────────────────────
  fontBody:  "'Hanken Grotesk', system-ui, sans-serif",
  fontBrand: "'Orbitron', sans-serif",
  fontSerif: "'Newsreader', Georgia, serif",

  // ── Radius ─────────────────────────────────────────────────────────────
  radiusSm:   4,
  radiusMd:   8,
  radiusLg:   12,
  radiusXl:   16,
  radiusFull: 9999,

  // ── Shadows ────────────────────────────────────────────────────────────
  shadowSm: '0 1px 2px rgba(17,24,39,0.06)',
  shadowMd: '0 6px 18px rgba(26,2,4,0.08)',
  shadowLg: '0 18px 40px rgba(26,2,4,0.12)',

  // ── Phone frame ────────────────────────────────────────────────────────
  frameBezel:      '#1E293B',
  frameWidth:      375,
  frameHeight:     812,
  frameRadius:     32,
  statusBarHeight: 28,
  bottomNavHeight: 60,
};

// ── Theme settings (mode + colour preset + font size) ─────────────────────
// The mobile mirror of the web Theme Center: light/dark neutrals, a brand
// colour preset shared with the web, and a display font-size scale. Everything
// mutates the SAME exported `T` object in place, so every screen that reads
// `T.primary` / `T.bgBase` / … at render time picks up the new values on the
// next render (MobileApp re-renders the whole tree when settings change).

const LIGHT_NEUTRALS = {
  bgBase: '#F4F5F8', bgSurface: '#ffffff', bgSubtle: '#F8FAFC',
  textPrimary: '#111827', textSecondary: '#374151', textTertiary: '#6b7280', textDisabled: '#9ca3af',
  border: '#e5e7eb', borderStrong: '#d1d5db',
};
const DARK_NEUTRALS = {
  bgBase: '#0f1420', bgSurface: '#1a2130', bgSubtle: '#232c3d',
  textPrimary: '#f1f5f9', textSecondary: '#cbd5e1', textTertiary: '#94a3b8', textDisabled: '#64748b',
  border: '#2d3a52', borderStrong: '#3a4660',
};

// Display size — like a phone's "Display size" setting: scales the whole
// rendered UI (text AND spacing) via CSS zoom on the screen content, because
// every mobile style is in absolute px and can't follow a root font-size.
export const MOBILE_FONT_SIZES = [
  { key: 'sm', label: 'Small',   zoom: 0.9  },
  { key: 'md', label: 'Default', zoom: 1    },
  { key: 'lg', label: 'Large',   zoom: 1.12 },
];

const SETTINGS_KEY = 'mobile-theme-settings';
const LEGACY_MODE_KEY = 'mobile-theme'; // pre-Theme-Center key that held only 'light'|'dark'

export const DEFAULT_MOBILE_THEME = { mode: 'light', presetName: THEME_PRESETS[0].name, fontSize: 'md' };

// ── tiny hex helpers (for the derived gradients) ──
function hexRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(v.slice(0, 6), 16);
  return Number.isNaN(n) ? [225, 1, 1] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba  = (hex, a) => `rgba(${hexRgb(hex).join(',')},${a})`;
const shade = (hex, f) => {
  const to = (n) => Math.max(0, Math.min(255, Math.round(n * f))).toString(16).padStart(2, '0');
  const [r, g, b] = hexRgb(hex);
  return `#${to(r)}${to(g)}${to(b)}`;
};
const mixWhite = (hex, t) => {
  const to = (n) => Math.round(n + (255 - n) * t).toString(16).padStart(2, '0');
  const [r, g, b] = hexRgb(hex);
  return `#${to(r)}${to(g)}${to(b)}`;
};

let __settings = { ...DEFAULT_MOBILE_THEME };

export function getMobileThemeSettings() {
  return { ...__settings };
}

export function getMobileThemeMode() {
  return __settings.mode;
}

export function getMobileFontZoom() {
  return (MOBILE_FONT_SIZES.find((f) => f.key === __settings.fontSize) || MOBILE_FONT_SIZES[1]).zoom;
}

export function loadMobileThemeSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch { /* ignore */ }
  if (!saved) {
    // Migrate the old mode-only key so an existing dark-mode choice survives.
    let legacyMode = null;
    try { legacyMode = localStorage.getItem(LEGACY_MODE_KEY); } catch { /* ignore */ }
    saved = legacyMode ? { mode: legacyMode } : {};
  }
  return { ...DEFAULT_MOBILE_THEME, ...saved };
}

export function applyMobileThemeSettings(settings) {
  __settings = { ...DEFAULT_MOBILE_THEME, ...settings };
  if (__settings.mode !== 'dark') __settings.mode = 'light';

  Object.assign(T, __settings.mode === 'dark' ? DARK_NEUTRALS : LIGHT_NEUTRALS);

  const preset = THEME_PRESETS.find((p) => p.name === __settings.presetName) || THEME_PRESETS[0];
  const { primary, dark, light } = preset;
  Object.assign(T, {
    primary,
    primaryDark: dark,
    primaryLight: light,
    // Same gradient recipes the hand-tuned Harvest values followed, rebuilt
    // from the preset so the whole chrome re-brands with one tap.
    buttonGradient: `linear-gradient(135deg, ${mixWhite(primary, 0.18)} 0%, ${primary} 55%, ${dark} 100%)`,
    topbarGradient: `linear-gradient(96deg, ${rgba(dark, 0.97)} 0%, ${rgba(primary, 0.97)} 54%, ${rgba(primary, 0.97)} 100%)`,
    heroGradient:   `radial-gradient(120% 120% at 8% 95%, ${shade(dark, 0.76)} 0%, ${shade(dark, 0.42)} 40%, ${shade(dark, 0.18)} 75%, ${shade(dark, 0.11)} 100%)`,
  });

  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(__settings)); } catch { /* ignore */ }
}

// Back-compat shim: mode-only switch (Profile screen's Dark Mode toggle).
export function applyMobileTheme(mode) {
  applyMobileThemeSettings({ ...__settings, mode });
}
