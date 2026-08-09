import { useState } from 'react';
import { MobileLayout }          from './MobileLayout';
import { BottomNav }             from './components/BottomNav';
import { SplashScreen }          from './screens/SplashScreen';
import { LoginScreen }           from './screens/LoginScreen';
import { HomeScreen }            from './screens/HomeScreen';
import { AlertsScreen }          from './screens/AlertsScreen';
import { OrdersScreen }          from './screens/OrdersScreen';
import { MealPlanningScreen }    from './screens/MealPlanningScreen';
import { ProductionScreen }      from './screens/ProductionScreen';
import { QCScreen }              from './screens/QCScreen';
import { HygieneScreen }         from './screens/HygieneScreen';
import { PersonalHygieneScreen } from './screens/PersonalHygieneScreen';
import { CookingTempScreen }     from './screens/CookingTempScreen';
import { ApprovalsScreen }       from './screens/ApprovalsScreen';
import { MoreScreen }            from './screens/MoreScreen';
import { StockScreen }           from './screens/StockScreen';
import { DemandsScreen }         from './screens/DemandsScreen';
import { PurchaseOrdersScreen }  from './screens/PurchaseOrdersScreen';
import { PurchaseRequisitionScreen } from './screens/PurchaseRequisitionScreen';
import { DelayManagementScreen }  from './screens/DelayManagementScreen';
import { DispatchHubScreen }     from './screens/DispatchHubScreen';
import { PackagingScreen }       from './screens/PackagingScreen';
import { WastageScreen }         from './screens/WastageScreen';
import { ProfileScreen }         from './screens/ProfileScreen';
import { GalleyOverviewScreen }  from './screens/GalleyOverviewScreen';
import { ReturnLogScreen }       from './screens/ReturnLogScreen';
import { ThemeScreen }           from './screens/ThemeScreen';
import { applyMobileThemeSettings, loadMobileThemeSettings, getMobileThemeSettings, getMobileFontZoom } from './theme';
import { MOCK_KPIS }             from './mockData';

/*
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  MOBILE APP — TIER ASSIGNMENT AUDIT BLOCK                               ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  TIER 1 — Full interactive screens                                      ║
 * ║    home          · KPI dashboard (M3 ✓)                                 ║
 * ║    alerts        · Unread alert list (M3 ✓)                             ║
 * ║    orders        · Order Management list + detail (M4 ✓)                ║
 * ║    meal-planning · Meal Planning list + detail (M4 ✓)                   ║
 * ║    production    · Production Dashboard + orders + actions (M4 ✓)       ║
 * ║    qc            · QC Checks (M5 ✓)                                     ║
 * ║    hygiene       · Hygiene Monitoring checklist (M5 ✓)                  ║
 * ║    cooking-temp  · Cooking Temp & Sensory entry + pass/fail (M5 ✓)      ║
 * ║    dispatch-mon  · Dispatch Monitoring status list (M5 ✓)               ║
 * ║    dispatch      · Dispatch list + detail + status actions (M5 ✓)       ║
 * ║    approvals     · Cross-module Approvals inbox (M5 ✓)                  ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  TIER 2 — List + detail accessible via More screen (M6 ✓)               ║
 * ║    stock                 · Stock Overview                               ║
 * ║    demands               · Demand Requests (list + create)             ║
 * ║    purchase-orders       · Purchase Orders                             ║
 * ║    purchase-requisition  · Purchase Requisition (LIVE web data via      ║
 * ║                            @/lib/purchase-requisitions)                 ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  TIER 3 — Web-only, disabled rows in More, toast on tap (M6 ✓)         ║
 * ║    Configuration (all sub-pages), User Management, Audit Logs,          ║
 * ║    Report Builder, Quotation Entry, Stock Adjustment, Transfer,          ║
 * ║    Transfer Request, Bill of Materials                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Architecture rules (DO NOT BREAK):
 *   - No routing connection to the web app.
 *   - No shared state or props from the web app's current page.
 *   - No reuse of web page components.
 *   - Fresh mount every time the modal opens (conditional render in AppLayout).
 *   - Always starts at the SPLASH screen.
 *   - All colours consumed from src/mobile/theme.js — no per-screen literals.
 */

const TAB_ROOTS = {
  home:       'home',
  orders:     'orders',
  production: 'production',
  qc:         'qc',
  more:       'more',
};

function tabForScreen(screen) {
  if (['home', 'alerts', 'profile', 'theme'].includes(screen))                     return 'home';
  if (['orders', 'meal-planning'].includes(screen))                                return 'orders';
  if (['production'].includes(screen))                                             return 'production';
  if (['qc', 'hygiene', 'personal-hygiene', 'cooking-temp'].includes(screen))      return 'qc';
  if (['more', 'dispatch', 'dispatch-mon', 'approvals',
       'stock', 'demands', 'purchase-orders', 'purchase-requisition',
       'galley-overview', 'return-log', 'delay-management',
       'packaging', 'wastage'].includes(screen)) return 'more';
  return 'home';
}

const PRE_AUTH = new Set(['splash', 'login']);

function MainShell({ nav, screen, onLogout, children }) {
  const alertBadge = MOCK_KPIS.pendingApprovals + MOCK_KPIS.inventoryAlerts;
  const activeTab  = tabForScreen(screen);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      <BottomNav
        activeTab={activeTab}
        onTabPress={(tab) => nav.resetTo(TAB_ROOTS[tab])}
        alertBadge={alertBadge}
      />
    </div>
  );
}

export function MobileApp({ onClose }) {
  const [stack, setStack] = useState(['splash']);
  const screen = stack[stack.length - 1];

  // Theme Center settings (mode + colour preset + font size) — persisted,
  // applied to the shared token object before first paint.
  const [themeSettings, setThemeSettingsState] = useState(() => {
    applyMobileThemeSettings(loadMobileThemeSettings());
    return getMobileThemeSettings();
  });
  const patchTheme = (patch) => {
    applyMobileThemeSettings({ ...getMobileThemeSettings(), ...patch });
    setThemeSettingsState(getMobileThemeSettings());
  };
  const setTheme = (mode) => patchTheme({ mode }); // Dark Mode toggle shim

  const navigate = (s) => setStack((p) => [...p, s]);
  const goBack   = ()  => setStack((p) => (p.length > 1 ? p.slice(0, -1) : p));
  const resetTo  = (s) => setStack([s]);

  const nav = { screen, navigate, goBack, resetTo, themeMode: themeSettings.mode, setTheme, themeSettings, patchTheme };
  const isPreAuth = PRE_AUTH.has(screen);

  // Logout resets to login screen
  const handleLogout = () => resetTo('login');

  function renderScreen() {
    switch (screen) {
      case 'splash':          return <SplashScreen onDone={() => resetTo('login')} />;
      case 'login':           return <LoginScreen onLogin={() => resetTo('home')} />;
      case 'home':            return <HomeScreen nav={nav} />;
      case 'alerts':          return <AlertsScreen nav={nav} />;
      case 'orders':          return <OrdersScreen nav={nav} />;
      case 'meal-planning':   return <MealPlanningScreen nav={nav} />;
      case 'production':      return <ProductionScreen nav={nav} />;
      case 'qc':              return <QCScreen nav={nav} />;
      case 'hygiene':         return <HygieneScreen nav={nav} />;
      case 'personal-hygiene': return <PersonalHygieneScreen nav={nav} />;
      case 'cooking-temp':    return <CookingTempScreen nav={nav} />;
      // Dispatch is ONE module with two surfaces — the board and monitoring —
      // so both entry points land on the hub, on the right tab.
      case 'dispatch-mon':    return <DispatchHubScreen nav={nav} initialTab="monitoring" />;
      case 'dispatch':        return <DispatchHubScreen nav={nav} />;
      case 'packaging':       return <PackagingScreen nav={nav} />;
      case 'wastage':         return <WastageScreen nav={nav} />;
      case 'approvals':       return <ApprovalsScreen nav={nav} />;
      case 'more':            return <MoreScreen nav={nav} onLogout={handleLogout} />;
      case 'stock':           return <StockScreen nav={nav} />;
      case 'demands':         return <DemandsScreen nav={nav} />;
      case 'purchase-orders': return <PurchaseOrdersScreen nav={nav} />;
      case 'purchase-requisition': return <PurchaseRequisitionScreen nav={nav} />;
      case 'delay-management': return <DelayManagementScreen nav={nav} />;
      case 'profile':         return <ProfileScreen nav={nav} onLogout={handleLogout} />;
      case 'theme':           return <ThemeScreen nav={nav} />;
      case 'galley-overview': return <GalleyOverviewScreen nav={nav} />;
      case 'return-log':      return <ReturnLogScreen nav={nav} />;
      default:                return <HomeScreen nav={nav} />;
    }
  }

  return (
    <MobileLayout onClose={onClose} fontZoom={getMobileFontZoom()}>
      {isPreAuth ? (
        renderScreen()
      ) : (
        <MainShell nav={nav} screen={screen} onLogout={handleLogout}>
          {renderScreen()}
        </MainShell>
      )}
    </MobileLayout>
  );
}
