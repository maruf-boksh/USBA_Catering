import { useState } from 'react';
import { MobileLayout }          from './MobileLayout';
import { BottomNav }             from './components/BottomNav';
import { WelcomeDialog }         from './components/WelcomeDialog';
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
import { DispatchScreen }        from './screens/DispatchScreen';
import { DispatchMonScreen }     from './screens/DispatchMonScreen';
import { ApprovalsScreen }       from './screens/ApprovalsScreen';
import { MoreScreen }            from './screens/MoreScreen';
import { StockScreen }           from './screens/StockScreen';
import { DemandsScreen }         from './screens/DemandsScreen';
import { PurchaseOrdersScreen }  from './screens/PurchaseOrdersScreen';
import { PurchaseRequisitionScreen } from './screens/PurchaseRequisitionScreen';
import { ProfileScreen }         from './screens/ProfileScreen';
import { GalleyOverviewScreen }  from './screens/GalleyOverviewScreen';
import { ReturnLogScreen }       from './screens/ReturnLogScreen';
import { ThemeScreen }           from './screens/ThemeScreen';
import { NavSettingsScreen }     from './screens/NavSettingsScreen';
import { loadMobileNavTabs, saveMobileNavTabs, tabForScreen } from './nav-config';
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
 * ║    purchase-requisition  · Local Purchase — Requisition tab (LIVE web   ║
 * ║                            data via @/lib/purchase-requisitions)        ║
 * ║    purchase-receive      · Local Purchase — Receive tab                 ║
 * ║    purchase-qc           · Local Purchase — QC / Inspect tab            ║
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

// Which tabs the bar carries is the user's choice now — see nav-config, and the
// Bottom Bar screen that edits it. Every tab id is also the screen it opens, so
// there is no TAB_ROOTS table any more.
const PRE_AUTH = new Set(['splash', 'login']);

function MainShell({ nav, screen, onLogout, children }) {
  const alertBadge = MOCK_KPIS.pendingApprovals + MOCK_KPIS.inventoryAlerts;
  const activeTab  = tabForScreen(screen, nav.navTabs);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      <BottomNav
        tabs={nav.navTabs}
        activeTab={activeTab}
        onTabPress={(tab) => nav.resetTo(tab)}
        badges={{
          home:      alertBadge,
          alerts:    alertBadge,
          approvals: MOCK_KPIS.pendingApprovals,
        }}
      />
    </div>
  );
}

export function MobileApp({ onClose }) {
  const [stack, setStack] = useState(['splash']);
  const screen = stack[stack.length - 1];
  // Post sign-in greeting. Raised by the login screen, cleared on dismiss and on
  // logout so the next sign-in gets its own.
  const [showWelcome, setShowWelcome] = useState(false);

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

  // User-picked bottom-bar modules, persisted on this device.
  const [navTabs, setNavTabsState] = useState(loadMobileNavTabs);
  const setNavTabs = (keys) => setNavTabsState(saveMobileNavTabs(keys));

  // Any navigation retires the welcome pill — it belongs to the home screen you
  // landed on, and should not follow you into the next one.
  const navigate = (s) => { setShowWelcome(false); setStack((p) => [...p, s]); };
  const goBack   = ()  => { setShowWelcome(false); setStack((p) => (p.length > 1 ? p.slice(0, -1) : p)); };
  const resetTo  = (s) => { setShowWelcome(false); setStack([s]); };

  const nav = { screen, navigate, goBack, resetTo, themeMode: themeSettings.mode, setTheme, themeSettings, patchTheme, navTabs, setNavTabs };
  const isPreAuth = PRE_AUTH.has(screen);

  // Logout resets to login screen
  const handleLogout = () => { setShowWelcome(false); resetTo('login'); };

  const handleLogin = () => { resetTo('home'); setShowWelcome(true); };

  function renderScreen() {
    switch (screen) {
      case 'splash':          return <SplashScreen onDone={() => resetTo('login')} />;
      case 'login':           return <LoginScreen onLogin={handleLogin} />;
      case 'home':            return <HomeScreen nav={nav} />;
      case 'alerts':          return <AlertsScreen nav={nav} />;
      case 'orders':          return <OrdersScreen nav={nav} />;
      case 'meal-planning':   return <MealPlanningScreen nav={nav} />;
      case 'production':      return <ProductionScreen nav={nav} />;
      case 'qc':              return <QCScreen nav={nav} />;
      case 'hygiene':         return <HygieneScreen nav={nav} />;
      case 'personal-hygiene': return <PersonalHygieneScreen nav={nav} />;
      case 'cooking-temp':    return <CookingTempScreen nav={nav} />;
      case 'dispatch-mon':    return <DispatchMonScreen nav={nav} />;
      case 'dispatch':        return <DispatchScreen nav={nav} />;
      case 'approvals':       return <ApprovalsScreen nav={nav} />;
      case 'more':            return <MoreScreen nav={nav} onLogout={handleLogout} />;
      case 'stock':           return <StockScreen nav={nav} />;
      case 'demands':         return <DemandsScreen nav={nav} />;
      case 'purchase-orders': return <PurchaseOrdersScreen nav={nav} />;
      // One screen, three More-menu doors — each opens on its own stage.
      case 'purchase-requisition': return <PurchaseRequisitionScreen nav={nav} initialTab="requisition" />;
      case 'purchase-receive':     return <PurchaseRequisitionScreen nav={nav} initialTab="receive" />;
      case 'purchase-qc':          return <PurchaseRequisitionScreen nav={nav} initialTab="inspect" />;
      case 'profile':         return <ProfileScreen nav={nav} onLogout={handleLogout} />;
      case 'theme':           return <ThemeScreen nav={nav} />;
      case 'nav-settings':    return <NavSettingsScreen nav={nav} />;
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
      {showWelcome && !isPreAuth && <WelcomeDialog onClose={() => setShowWelcome(false)} />}
    </MobileLayout>
  );
}
