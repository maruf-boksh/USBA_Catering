// Shared store for Theme Center settings. Both the popover (writer) and the
// AntD ConfigProvider bridge (reader) subscribe to this so a change made in
// the popover propagates to Tailwind-styled chrome AND every Ant-rendered
// surface (sidebar Menu, top-bar Buttons, modals, etc).

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "theme-center:settings";

export type HeaderStyle = "gradient" | "minimal";
export type SidebarStyle = "default" | "elevated";
export type SidebarColor = "primary" | "white" | "gray" | "dark" | "midnight" | "gradient";
export type CornerRadius = "sharp" | "default" | "rounded";
export type Density = "compact" | "default" | "spacious";
export type FontFamily = "manrope" | "inter" | "system";
export type FontSize = "small" | "medium" | "large";

export type ThemeSettings = {
  primary: string;
  headerStyle: HeaderStyle;
  sidebarStyle: SidebarStyle;
  sidebarColor: SidebarColor;
  cornerRadius: CornerRadius;
  density: Density;
  fontFamily: FontFamily;
  fontSize: FontSize;
  reduceMotion: boolean;
};

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  primary: "#0F766E",
  headerStyle: "gradient",
  sidebarStyle: "default",
  sidebarColor: "primary",
  cornerRadius: "default",
  density: "default",
  fontFamily: "manrope",
  fontSize: "medium",
  reduceMotion: false,
};

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

export function normalizeHex(input: string): string | null {
  const m = input.trim().match(HEX_RE);
  return m ? `#${m[1].toUpperCase()}` : null;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.match(HEX_RE);
  if (!m) return [0, 0, 0];
  return [
    parseInt(m[1].slice(0, 2), 16),
    parseInt(m[1].slice(2, 4), 16),
    parseInt(m[1].slice(4, 6), 16),
  ];
}

export function readableForeground(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 160 ? "#0F172A" : "#FFFFFF";
}

export function shadeHex(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const to = (n: number) => clamp(n * factor).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

// ── Mappings shared by both the writer (popover) and the reader (AntD) ─────

export const FONT_FAMILY_STACK: Record<FontFamily, string> = {
  manrope: '"Manrope", "Nunito Sans", ui-sans-serif, system-ui, -apple-system, sans-serif',
  inter: '"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

export const FONT_SIZE_PX: Record<FontSize, number> = {
  small: 12,
  medium: 13,
  large: 15,
};

export const RADIUS_PX: Record<CornerRadius, number> = {
  sharp: 2,
  default: 8,
  rounded: 16,
};

export const SIDEBAR_BG: Record<Exclude<SidebarColor, "primary">, { bg: string; fg: string }> = {
  white:    { bg: "#FFFFFF",           fg: "#0F172A" },
  gray:     { bg: "#F1F5F9",           fg: "#0F172A" },
  dark:     { bg: "#1E293B",           fg: "#F8FAFC" },
  midnight: { bg: "#0F172A",           fg: "#F8FAFC" },
  gradient: { bg: "linear-gradient(180deg, #EEF2FF 0%, #FCE7F3 50%, #FEF3C7 100%)", fg: "#0F172A" },
};

// ── Resolved derived values (so callers don't recompute) ───────────────────

export function resolveSidebarBg(s: ThemeSettings): { bg: string; fg: string } {
  if (s.sidebarColor === "primary") {
    return { bg: `${s.primary}0D`, fg: "#0F172A" };
  }
  return SIDEBAR_BG[s.sidebarColor];
}

// ── Store: subscribe / get / set ───────────────────────────────────────────

const IS_BROWSER = typeof window !== "undefined" && typeof localStorage !== "undefined";

let current: ThemeSettings = loadFromStorage();
const listeners = new Set<() => void>();

function loadFromStorage(): ThemeSettings {
  if (!IS_BROWSER) return DEFAULT_THEME_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    return { ...DEFAULT_THEME_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_THEME_SETTINGS;
  }
}

function persist(s: ThemeSettings) {
  if (!IS_BROWSER) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function getThemeSettings(): ThemeSettings { return current; }

export function setThemeSettings(next: ThemeSettings) {
  current = next;
  persist(next);
  for (const l of listeners) l();
}

export function patchThemeSettings(patch: Partial<ThemeSettings>) {
  setThemeSettings({ ...current, ...patch });
}

export function subscribeThemeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * React hook — re-renders when the settings change. Safe to call in any
 * component; updates propagate to every subscriber simultaneously.
 */
export function useThemeSettings(): ThemeSettings {
  return useSyncExternalStore(
    (cb) => subscribeThemeSettings(cb),
    getThemeSettings,
    getThemeSettings,
  );
}

// ── DOM application: CSS variables + body classes ──────────────────────────
// Single source of truth for "settings -> DOM side-effects".

export function applyThemeToDOM(s: ThemeSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const body = document.body;

  const primary = s.primary;
  const primaryFg = readableForeground(primary);
  const primaryDark = shadeHex(primary, 0.78);

  root.style.setProperty("--primary", primary);
  root.style.setProperty("--primary-foreground", primaryFg);
  root.style.setProperty("--primary-dark", primaryDark);
  root.style.setProperty("--ring", primary);
  root.style.setProperty("--sidebar-accent", `${primary}1F`);
  root.style.setProperty("--sidebar-accent-foreground", primary);

  if (s.headerStyle === "gradient") {
    root.style.setProperty("--header-bg", `linear-gradient(90deg, ${primary} 0%, ${primaryDark} 100%)`);
    root.style.setProperty("--header-fg", primaryFg);
    root.style.setProperty("--header-shadow", "0 6px 16px -6px rgba(0, 0, 0, 0.25), 0 2px 4px 0 rgba(15, 23, 42, 0.08)");
    root.style.setProperty("--header-logo-bg", "#FFFFFF");
    root.style.setProperty("--header-button-bg", "rgba(255,255,255,0.95)");
    root.style.setProperty("--header-button-fg", primary);
  } else {
    root.style.setProperty("--header-bg", "var(--card)");
    root.style.setProperty("--header-fg", "var(--foreground)");
    root.style.setProperty("--header-shadow", "0 1px 2px rgba(15, 23, 42, 0.06)");
    root.style.setProperty("--header-logo-bg", `${primary}1A`);
    root.style.setProperty("--header-button-bg", primary);
    root.style.setProperty("--header-button-fg", primaryFg);
  }

  const sb = resolveSidebarBg(s);
  root.style.setProperty("--sidebar", sb.bg);
  root.style.setProperty("--sidebar-foreground", sb.fg);
  root.style.setProperty("--sidebar-primary", primary);
  root.style.setProperty("--sidebar-primary-foreground", primaryFg);
  root.style.setProperty(
    "--sidebar-shadow",
    s.sidebarStyle === "elevated" ? "4px 0 16px -8px rgba(15, 23, 42, 0.16)" : "none",
  );

  // Corner radius
  root.style.setProperty("--radius", `${RADIUS_PX[s.cornerRadius] / 16}rem`);

  // Density flag (kept as a CSS variable for any consumer that wants to read it)
  root.style.setProperty("--density-scale", s.density === "compact" ? "0.92" : s.density === "spacious" ? "1.12" : "1");

  // Font family + size — set on BOTH html and body so every inheritor picks
  // them up regardless of which selector originally won the cascade.
  const stack = FONT_FAMILY_STACK[s.fontFamily];
  const sizePx = FONT_SIZE_PX[s.fontSize];
  root.style.setProperty("--font-sans", stack);
  root.style.setProperty("--font-heading", stack);
  root.style.fontFamily = stack;
  body.style.fontFamily = stack;
  body.style.fontSize = `${sizePx}px`;

  body.classList.toggle("reduce-motion", s.reduceMotion);
}

// Apply once on module load so the saved theme reaches the DOM before any
// React component mounts — beats first-paint flash even on slow networks.
// Guarded so SSR (prerender) doesn't blow up touching `document`.
if (IS_BROWSER) {
  try { applyThemeToDOM(current); } catch { /* ignore */ }
}

/**
 * Synchronous bootstrap script string. Injected via `dangerouslySetInnerHTML`
 * into the document `<head>` so it runs BEFORE the body parses — eliminates
 * the FOUC where the page paints with the default teal theme for a frame
 * before the React-driven `applyThemeToDOM` swaps to the saved theme.
 *
 * Self-contained vanilla JS: no module imports, no React. Mirrors the
 * variable-writes in `applyThemeToDOM` for the visible chrome (header,
 * sidebar, radius, fonts).
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    if (!raw) return;
    var s = JSON.parse(raw);
    var R = document.documentElement.style;

    function hexToRgb(h) {
      var m = /^#?([0-9a-fA-F]{6})$/.exec(h || '');
      return m
        ? [parseInt(m[1].slice(0,2),16), parseInt(m[1].slice(2,4),16), parseInt(m[1].slice(4,6),16)]
        : [0,0,0];
    }
    function fg(h) {
      var c = hexToRgb(h);
      return (c[0]*299 + c[1]*587 + c[2]*114) / 1000 >= 160 ? '#0F172A' : '#FFFFFF';
    }
    function shade(h, f) {
      var c = hexToRgb(h);
      function to(n) {
        var v = Math.max(0, Math.min(255, Math.round(n * f))).toString(16);
        return v.length < 2 ? '0' + v : v;
      }
      return ('#' + to(c[0]) + to(c[1]) + to(c[2])).toUpperCase();
    }

    var primary    = s.primary || '#0F766E';
    var primaryFg  = fg(primary);
    var primaryDk  = shade(primary, 0.78);

    R.setProperty('--primary', primary);
    R.setProperty('--primary-foreground', primaryFg);
    R.setProperty('--primary-dark', primaryDk);
    R.setProperty('--ring', primary);
    R.setProperty('--sidebar-accent', primary + '1F');
    R.setProperty('--sidebar-accent-foreground', primary);

    if (s.headerStyle === 'minimal') {
      R.setProperty('--header-bg', 'var(--card)');
      R.setProperty('--header-fg', 'var(--foreground)');
      R.setProperty('--header-shadow', '0 1px 2px rgba(15, 23, 42, 0.06)');
      R.setProperty('--header-logo-bg', primary + '1A');
      R.setProperty('--header-button-bg', primary);
      R.setProperty('--header-button-fg', primaryFg);
    } else {
      R.setProperty('--header-bg', 'linear-gradient(90deg, ' + primary + ' 0%, ' + primaryDk + ' 100%)');
      R.setProperty('--header-fg', primaryFg);
      R.setProperty('--header-shadow', '0 6px 16px -6px rgba(0, 0, 0, 0.25), 0 2px 4px 0 rgba(15, 23, 42, 0.08)');
      R.setProperty('--header-logo-bg', '#FFFFFF');
      R.setProperty('--header-button-bg', 'rgba(255,255,255,0.95)');
      R.setProperty('--header-button-fg', primary);
    }

    var SBC = {
      white:    { bg: '#FFFFFF', fg: '#0F172A' },
      gray:     { bg: '#F1F5F9', fg: '#0F172A' },
      dark:     { bg: '#1E293B', fg: '#F8FAFC' },
      midnight: { bg: '#0F172A', fg: '#F8FAFC' },
      gradient: { bg: 'linear-gradient(180deg, #EEF2FF 0%, #FCE7F3 50%, #FEF3C7 100%)', fg: '#0F172A' }
    };
    var sb = s.sidebarColor === 'primary'
      ? { bg: primary + '0D', fg: '#0F172A' }
      : (SBC[s.sidebarColor] || SBC.white);
    R.setProperty('--sidebar', sb.bg);
    R.setProperty('--sidebar-foreground', sb.fg);
    R.setProperty('--sidebar-primary', primary);
    R.setProperty('--sidebar-primary-foreground', primaryFg);
    R.setProperty('--sidebar-shadow', s.sidebarStyle === 'elevated' ? '4px 0 16px -8px rgba(15, 23, 42, 0.16)' : 'none');

    var RAD = { sharp: 2, default: 8, rounded: 16 };
    R.setProperty('--radius', ((RAD[s.cornerRadius] || 8) / 16) + 'rem');

    var FF = {
      manrope: '"Manrope", "Nunito Sans", ui-sans-serif, system-ui, -apple-system, sans-serif',
      inter:   '"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
      system:  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    };
    var stack = FF[s.fontFamily] || FF.manrope;
    R.setProperty('--font-sans', stack);
    R.setProperty('--font-heading', stack);
    document.documentElement.style.fontFamily = stack;

    var FS = { small: 12, medium: 13, large: 15 };
    var sz = FS[s.fontSize] || 13;
    R.setProperty('--font-size-body', sz + 'px');

    if (s.reduceMotion) {
      // Body might not exist yet at <head> parse time; defer the class.
      var apply = function () { if (document.body) document.body.classList.add('reduce-motion'); };
      if (document.body) apply();
      else document.addEventListener('DOMContentLoaded', apply, { once: true });
    }
  } catch (e) { /* swallow — falls back to default theme */ }
})();
`.trim();
