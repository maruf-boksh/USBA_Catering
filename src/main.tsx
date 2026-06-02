import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ConfigProvider, theme as antTheme } from "antd"

import { ThemeProvider, useTheme } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  useThemeSettings,
  FONT_FAMILY_STACK,
  FONT_SIZE_PX,
  RADIUS_PX,
  resolveSidebarBg,
  readableForeground,
} from "@/lib/theme-settings"
import App from "./App.tsx"
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
  const settings = useThemeSettings()
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme

  const isDark = resolved === "dark"

  // Bridge Theme Center settings into AntD tokens so antd-rendered surfaces
  // (sidebar Menu, modals, top-bar Buttons, etc) match the rest of the app.
  const primary = settings.primary
  const primaryFg = readableForeground(primary)
  const sidebarBg = resolveSidebarBg(settings)
  const fontStack = FONT_FAMILY_STACK[settings.fontFamily]
  const fontPx = FONT_SIZE_PX[settings.fontSize]
  const radiusPx = RADIUS_PX[settings.cornerRadius]
  // Sidebar swatch backgrounds may be CSS gradients — antd's `siderBg` only
  // takes a colour, so we fall back to a plain colour when the choice is a
  // gradient (the gradient itself is still painted via the CSS variable that
  // AppShell reads).
  const siderBgColor =
    settings.sidebarColor === "gradient" ? "#EEF2FF"
    : settings.sidebarColor === "primary" ? `${primary}0D`
    : sidebarBg.bg
  const siderFg = sidebarBg.fg

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
