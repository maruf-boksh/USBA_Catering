// All design tokens for the mobile mini-app.
// Every mobile screen must import from here — no per-screen colour literals.

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

// ── Light / dark mode ─────────────────────────────────────────────────────
// Only the neutral surface / text / border tokens flip between modes; brand and
// status colours stay constant. `applyMobileTheme` mutates the SAME exported `T`
// object in place, so every screen that reads `T.bgBase` / `T.textPrimary` / … at
// render time picks up the new values on the next render (MobileApp re-renders the
// whole tree when the mode changes).
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

let __mobileThemeMode = 'light';

export function getMobileThemeMode() {
  return __mobileThemeMode;
}

export function applyMobileTheme(mode) {
  __mobileThemeMode = mode === 'dark' ? 'dark' : 'light';
  Object.assign(T, __mobileThemeMode === 'dark' ? DARK_NEUTRALS : LIGHT_NEUTRALS);
}
