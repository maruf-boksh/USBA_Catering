import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ConfigProvider, theme as antTheme } from "antd"

import { ThemeProvider, useTheme } from "@/components/theme-provider.tsx"
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
  const { theme } = useTheme()
  // Read the SAME store the Theme Center writes, so changing a preset/colour/
  // font/radius live re-themes every AntD surface (top-bar Buttons, Menu,
  // modals, Tags, links, …) — not just the CSS-variable chrome.
  const s = useThemeStore()
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme

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
            siderBg: isDark ? "#131826" : siderBgColor,
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
