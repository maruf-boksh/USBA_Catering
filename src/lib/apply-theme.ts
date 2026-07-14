import type { ThemeState } from "@/stores/themeStore";

// ─────────────────────────────────────────────────────────────────────────────
// applyTheme — writes the Theme Center's settings onto the live document so the
// whole app reflects them. The store only holds state; this is what makes it
// "functional". It drives the CSS custom-property + <html> data-attribute
// contract the stylesheets already key off (--color-primary*, --radius,
// --font-family-base, data-topbar, data-motion, data-sidebar-tone, …).
// ─────────────────────────────────────────────────────────────────────────────

const RADIUS_REM: Record<string, string> = { sharp: "0.25rem", default: "0.5rem", rounded: "1rem" };

const FONT_STACK: Record<string, string> = {
  manrope: "'Manrope', 'Hanken Grotesk', system-ui, -apple-system, sans-serif",
  inter: "'Inter', system-ui, -apple-system, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

// Root font-size scale (relative to the 16px default) — md keeps the current
// size so enabling theming never shifts the default layout.
const FONT_ROOT: Record<string, string> = { sm: "15px", md: "16px", lg: "17px" };
const FONT_BASE: Record<string, string> = { sm: "12px", md: "13px", lg: "14px" };

// Sidebar background per preset. "primary" tints with the brand light shade;
// "custom" uses the chosen color. Others are fixed.
const SIDEBAR_BG: Record<string, string> = {
  white: "#ffffff", slate: "#f1f5f9", dark: "#1e293b", midnight: "#0f172a",
};

function hexToRgbChannels(hex: string): string {
  const h = hex.replace("#", "").trim();
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v.slice(0, 6), 16);
  if (Number.isNaN(n)) return "225, 1, 1";
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Perceived luminance < 0.5 → treat as a dark surface (use light text). */
function isDarkColor(hex: string): boolean {
  const [r, g, b] = hexToRgbChannels(hex).split(",").map((s) => parseInt(s.trim(), 10));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

function setAttr(el: HTMLElement, name: string, val: string | null) {
  if (val == null) el.removeAttribute(name);
  else el.setAttribute(name, val);
}

export function applyTheme(s: ThemeState): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const set = (k: string, v: string) => el.style.setProperty(k, v);

  // Resolve the effective light/dark once (handles "system"). This single value
  // drives EVERY dark-mode surface so the layers can't disagree:
  //   • data-theme="dark"      → custom --color-* vars (dashboard, KPI, chrome)
  //   • the .dark class         → shadcn tokens (--background/--card/--foreground)
  //   • the sidebar force below → dark sidebar surface
  //   • AntThemeBridge (main)   → AntD dark algorithm (reads the same store)
  // Before this, the .dark class was owned by a SEPARATE ThemeProvider (the "d"
  // hotkey / OS pref) and could stay dark while this store toggled to light —
  // producing a light sidebar over dark content. useThemeStore is now the one
  // source of truth for mode.
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = s.mode === "dark" || (s.mode === "system" && prefersDark);

  // ── Primary colour family (drives buttons, header gradient, sidebar, tints) ──
  set("--color-primary", s.primaryColor);
  set("--color-primary-dark", s.primaryDark);
  set("--color-primary-light", s.primaryLight);
  set("--color-primary-rgb", hexToRgbChannels(s.primaryColor));
  set("--color-primary-dark-rgb", hexToRgbChannels(s.primaryDark));
  set("--color-accent", s.primaryColor);
  set("--color-secondary", s.primaryDark);
  // shadcn/Tailwind tokens some components read directly
  set("--primary", s.primaryColor);
  set("--ring", s.primaryColor);
  set("--sidebar-primary", s.primaryColor);
  set("--sidebar-ring", s.primaryColor);
  set("--brand", s.primaryColor);

  // ── Corner radius ──
  set("--radius", RADIUS_REM[s.borderRadius] ?? "0.5rem");

  // ── Typography ──
  const stack = FONT_STACK[s.fontFamily] ?? FONT_STACK.manrope;
  set("--font-family-base", stack);
  set("--hc-sans", stack);
  set("--font-sans", stack);
  set("--text-base", FONT_BASE[s.fontSize] ?? "13px");
  el.style.fontSize = FONT_ROOT[s.fontSize] ?? "16px";
  // The base body font comes from an inlined Tailwind token (--font-sans) that
  // isn't overridable at runtime, so set it on <body> directly too.
  if (document.body) document.body.style.fontFamily = stack;

  // ── Sidebar colour ──
  let sbBg =
    s.sidebarColor === "primary" ? s.primaryLight :
    s.sidebarColor === "custom" ? s.sidebarCustomBg :
    SIDEBAR_BG[s.sidebarColor] ?? "#ffffff";
  // In dark mode a light sidebar clashes with the dark shell — force a dark
  // surface (unless the user has already picked a dark sidebar preset). This
  // also flips data-sidebar-tone to "dark" below so the sidebar's dark styles
  // (text, hover, active) engage.
  if (isDark && !isDarkColor(sbBg)) sbBg = "#161b27";
  set("--app-sidebar-bg", sbBg);
  const darkSb = isDarkColor(sbBg);
  // Border tone follows the sidebar surface so it can't be left as a light
  // hairline over a dark sider (or vice-versa).
  set("--app-sidebar-border", darkSb ? "#252f42" : "#E5E7EB");
  setAttr(el, "data-sidebar-tone", darkSb ? "dark" : "light");
  if (s.sidebarCustomFg) {
    set("--app-sidebar-fg", s.sidebarCustomFg);
    setAttr(el, "data-sidebar-fg", "custom");
  } else {
    set("--app-sidebar-fg", darkSb ? "#f1f5f9" : "#0f172a");
    setAttr(el, "data-sidebar-fg", null);
  }

  // ── Layout / system flags (consumed by existing stylesheets) ──
  setAttr(el, "data-topbar", s.topbarStyle === "minimal" ? "minimal" : null);
  setAttr(el, "data-motion", s.motionReduced ? "reduced" : null);
  setAttr(el, "data-sidebar-style", s.sidebarStyle);
  setAttr(el, "data-density", s.density);
  setAttr(el, "data-theme", isDark ? "dark" : null);

  // Own the shadcn light/dark CLASS too, so the single toggle governs shadcn
  // tokens (bg-background, bg-card, text-foreground) — not the independent
  // ThemeProvider. Keep its localStorage key ("theme") in sync so the provider
  // agrees if it re-reads (mount, cross-tab storage event, "d" hotkey).
  el.classList.toggle("dark", isDark);
  el.classList.toggle("light", !isDark);
  try {
    localStorage.setItem("theme", s.mode);
  } catch {
    /* storage unavailable (private mode / quota) — class + attr already applied */
  }
}
