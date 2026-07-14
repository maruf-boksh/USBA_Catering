import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ConfigProvider, theme as antTheme } from "antd"

import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"
import { FONT_FAMILY_STACK, RADIUS_PX, readableForeground } from "@/lib/theme-settings"
import { useThemeStore } from "@/stores/themeStore"
import App from "./App.tsx"

// Theme Center (useThemeStore) enum → AntD token mappings.
const FONT_PX = { sm: 12, md: 13, lg: 15 } as const
const SIDEBAR_SOLID: Record<string, string> = {
  white: "#FFFFFF", slate: "#F1F5F9", dark: "#1E293B", midnight: "#0F172A",
}
import "./index.css"
import "@/styles/globals.css"
import "@/styles/sidebar.css"

/**
 * Bridges the existing useTheme hook to Ant Design's ConfigProvider so a
 * single source of truth (localStorage "theme") drives both Tailwind's `.dark`
 * class and Ant's theme algorithm. Tokens here mirror DESIGN.md §3 (teal
 * primary, amber accent, light borders) so Ant components match the rest of
 * the app without custom CSS overrides on every component.
 */
function AntThemeBridge({ children }: { children: React.ReactNode }) {
  // Read the SAME store the Theme Center + dark-mode toggle write, so changing a
  // preset/colour/font/radius/MODE live re-themes every AntD surface (top-bar
  // Buttons, Menu, Table, modals, Tags, links, …). Deriving `isDark` from this
  // store (not the separate ThemeProvider) is what makes the dark-mode toggle
  // actually switch AntD to its dark algorithm — otherwise Tables etc. keep
  // light tokens (dark text on dark rows) even though the CSS chrome went dark.
  const s = useThemeStore()
  const resolved =
    s.mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : s.mode

  const isDark = resolved === "dark"

  const primary = s.primaryColor
  const fontStack = FONT_FAMILY_STACK[s.fontFamily] ?? FONT_FAMILY_STACK.manrope
  const fontPx = FONT_PX[s.fontSize] ?? 13
  const radiusPx = RADIUS_PX[s.borderRadius] ?? 8
  const siderBgColor =
    isDark ? "#131826"
    : s.sidebarColor === "primary" ? `${primary}0D`
    : s.sidebarColor === "custom" ? s.sidebarCustomBg
    : SIDEBAR_SOLID[s.sidebarColor] ?? "#FFFFFF"
  const siderFg =
    isDark ? "#CBD5E1"
    : s.sidebarColor === "dark" || s.sidebarColor === "midnight" ? "#F8FAFC"
    : s.sidebarColor === "custom" ? (s.sidebarCustomFg || readableForeground(s.sidebarCustomBg))
    : "#0F172A"

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        // CSS-variable mode: AntD compiles tokens to CSS vars, so changing the
        // primary in Theme Center reactively re-paints every already-mounted
        // primary Button, Tag, link, etc. without a hard reload.
        cssVar: { key: "vizyon" },
        hashed: false,
        token: {
          colorPrimary: isDark ? "#2DD4BF" : primary,
          colorInfo:    isDark ? "#38BDF8" : "#0EA5E9",
          colorSuccess: isDark ? "#4ADE80" : "#16A34A",
          colorWarning: isDark ? "#FBBF24" : "#D97706",
          colorError:   isDark ? "#F87171" : "#DC2626",
          colorBgBase:  isDark ? "#0F1117" : "#F4F5F8",
          colorTextBase:isDark ? "#E5E7EB" : "#1F2937",
          colorBorder:  isDark ? "#252F42" : "#D8E7E5",
          borderRadius: radiusPx,
          borderRadiusLG: radiusPx + 4,
          borderRadiusSM: Math.max(2, radiusPx - 2),
          fontFamily: fontStack,
          fontSize: fontPx,
        },
        components: {
          Layout: {
            headerBg: "transparent",
            headerHeight: 56,
            headerPadding: 0,
            // Let the sidebar's OWN stylesheet paint its background from
            // --app-sidebar-bg (set imperatively by applyTheme, in the SAME call
            // that sets data-theme). If AntD painted it from this reactive token
            // instead, the sidebar could update on a different tick than the
            // content's data-theme → the light-sidebar-over-dark-content split.
            siderBg: "transparent",
            bodyBg: "transparent",
          },
          Menu: {
            itemBg: "transparent",
            itemColor: isDark ? "#CBD5E1" : siderFg,
            itemSelectedBg: isDark ? "rgba(45,212,191,0.12)" : `${primary}1F`,
            itemSelectedColor: isDark ? "#2DD4BF" : primary,
            itemHoverBg: isDark ? "rgba(45,212,191,0.08)" : `${primary}14`,
            itemHoverColor: isDark ? "#2DD4BF" : primary,
            itemHeight: 36,
            iconSize: 14,
            fontFamily: fontStack,
            fontSize: fontPx,
            subMenuItemBg: "transparent",
          },
          Button: {
            controlHeight: 34,
            controlHeightSM: 28,
            fontWeight: 600,
            fontFamily: fontStack,
          },
        },
      }}
    >
      {children}
    </ConfigProvider>
  )
}

// Seed the ThemeProvider's localStorage key from the (already-rehydrated) theme
// store BEFORE first render, so its `.dark`/`.light` class inits to the same
// mode as the visible toggle. Without this, a stale "theme" value could paint a
// dark shell under a light sidebar (or vice-versa) for the first frame.
try {
  localStorage.setItem("theme", useThemeStore.getState().mode)
} catch {
  /* storage unavailable — applyTheme still reconciles the class at runtime */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light">
      <AntThemeBridge>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </AntThemeBridge>
    </ThemeProvider>
  </StrictMode>
)
