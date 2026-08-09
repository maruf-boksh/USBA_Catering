import { T } from './theme';

/*
 * Bottom-bar configuration.
 *
 * The bar used to be a hardcoded five. It is now user-picked: this module owns
 * the catalogue of things that MAY sit on the bar, the persisted choice, and the
 * screen → tab mapping the shell needs to know which tab to light up.
 *
 * "More" is deliberately not in the catalogue — it is pinned last and is the
 * door to every module the user did not promote, so it can never be removed.
 */

const NAV_KEY = 'aerogalley-mobile-nav-v1';

export const MIN_NAV_TABS = 2;
export const MAX_NAV_TABS = 4; // + the pinned More tab = 5 slots, the width limit

export const DEFAULT_NAV_KEYS = ['home', 'orders', 'production', 'qc'];

// Icons are functions of `active` so they can pull the live theme colour at
// render time — presets change T.primary in place.
const ico = (active) => (active ? T.primary : T.textTertiary);
const S = { strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };

function svg(children) {
  return (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      {children(ico(active))}
    </svg>
  );
}

/**
 * Everything the user can put on the bar.
 *   key    — also the screen id it opens, and the tab id
 *   label  — the bar label; kept short, the bar gives it ~70px
 *   name   — the full module name, used in the picker
 *   group  — picker section
 */
export const NAV_CATALOGUE = [
  {
    key: 'home', label: 'Home', name: 'Home Dashboard', group: 'Overview',
    icon: svg((c) => (<>
      <path d="M3 12L12 3l9 9" stroke={c} {...S} />
      <path d="M9 21V12h6v9" stroke={c} {...S} />
      <path d="M5 10v11h14V10" stroke={c} {...S} />
    </>)),
  },
  {
    key: 'alerts', label: 'Alerts', name: 'Alerts', group: 'Overview',
    icon: svg((c) => (<>
      <path d="M18 8a6 6 0 10-12 0c0 6-3 7-3 7h18s-3-1-3-7z" stroke={c} {...S} />
      <path d="M13.7 21a2 2 0 01-3.4 0" stroke={c} {...S} />
    </>)),
  },
  {
    key: 'orders', label: 'Orders', name: 'Order Management', group: 'Operations',
    icon: svg((c) => (<>
      <rect x="3" y="3" width="18" height="18" rx="3" stroke={c} strokeWidth="2" fill="none" />
      <path d="M7 8h10M7 12h7M7 16h5" stroke={c} {...S} />
    </>)),
  },
  {
    key: 'meal-planning', label: 'Meals', name: 'Meal Planning', group: 'Operations',
    icon: svg((c) => (<>
      <rect x="3" y="5" width="18" height="16" rx="3" stroke={c} strokeWidth="2" fill="none" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke={c} {...S} />
      <path d="M9 15h6" stroke={c} {...S} />
    </>)),
  },
  {
    key: 'production', label: 'Production', name: 'Production', group: 'Operations',
    icon: svg((c) => (<>
      <path d="M12 2L2 7l10 5 10-5-10-5z" stroke={c} {...S} />
      <path d="M2 17l10 5 10-5" stroke={c} {...S} />
      <path d="M2 12l10 5 10-5" stroke={c} {...S} />
    </>)),
  },
  {
    key: 'qc', label: 'QC', name: 'Quality Checks', group: 'Operations',
    icon: svg((c) => (<>
      <path d="M9 11l3 3L22 4" stroke={c} {...S} />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke={c} {...S} />
    </>)),
  },
  {
    key: 'approvals', label: 'Approvals', name: 'Approvals Inbox', group: 'Operations',
    icon: svg((c) => (<>
      <path d="M9 4h6a1 1 0 011 1v1h2a1 1 0 011 1v13a1 1 0 01-1 1H6a1 1 0 01-1-1V7a1 1 0 011-1h2V5a1 1 0 011-1z" stroke={c} strokeWidth="2" strokeLinejoin="round" fill="none" />
      <path d="M9 13l2.2 2.2L15.5 11" stroke={c} {...S} />
    </>)),
  },
  {
    key: 'dispatch', label: 'Dispatch', name: 'Dispatch', group: 'Operations',
    icon: svg((c) => (<>
      <path d="M2 7h11v9H2z" stroke={c} {...S} />
      <path d="M13 10h4l3 3v3h-7z" stroke={c} {...S} />
      <circle cx="6.5" cy="18" r="1.8" stroke={c} strokeWidth="2" fill="none" />
      <circle cx="16.5" cy="18" r="1.8" stroke={c} strokeWidth="2" fill="none" />
    </>)),
  },
  {
    key: 'dispatch-mon', label: 'Monitor', name: 'Dispatch Monitoring', group: 'Operations',
    icon: svg((c) => (<>
      <circle cx="12" cy="12" r="2" stroke={c} strokeWidth="2" fill="none" />
      <path d="M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7" stroke={c} {...S} />
      <path d="M5.5 5.5a9 9 0 000 13M18.5 5.5a9 9 0 010 13" stroke={c} {...S} />
    </>)),
  },
  {
    key: 'stock', label: 'Stock', name: 'Stock Overview', group: 'Inventory',
    icon: svg((c) => (<>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" stroke={c} {...S} />
      <path d="M3 8l9 5 9-5M12 13v8" stroke={c} {...S} />
    </>)),
  },
  {
    key: 'demands', label: 'Demands', name: 'Demand Requests', group: 'Inventory',
    icon: svg((c) => (<>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" stroke={c} {...S} />
      <path d="M9 13h6M12 10v6" stroke={c} {...S} />
    </>)),
  },
  {
    key: 'purchase-requisition', label: 'Purchase', name: 'Purchase Requisition', group: 'Inventory',
    icon: svg((c) => (<>
      <path d="M9 4h6v3H9z" stroke={c} {...S} />
      <path d="M15 5.5h3v15H6v-15h3" stroke={c} {...S} />
      <path d="M9 11h6M9 15h4" stroke={c} {...S} />
    </>)),
  },
  {
    key: 'galley-overview', label: 'Galley', name: 'Galley Planning', group: 'Galley',
    icon: svg((c) => (<>
      <path d="M4 11h16a8 8 0 01-16 0z" stroke={c} {...S} />
      <path d="M12 3v5M3 21h18" stroke={c} {...S} />
    </>)),
  },
  {
    key: 'return-log', label: 'Returns', name: 'Return Log', group: 'Galley',
    icon: svg((c) => (<>
      <path d="M9 14L4 9l5-5" stroke={c} {...S} />
      <path d="M4 9h10a6 6 0 010 12h-5" stroke={c} {...S} />
    </>)),
  },
];

export const MORE_TAB = {
  key: 'more', label: 'More', name: 'More', group: 'Overview',
  icon: svg((c) => (<>
    <circle cx="5" cy="12" r="1.5" fill={c} />
    <circle cx="12" cy="12" r="1.5" fill={c} />
    <circle cx="19" cy="12" r="1.5" fill={c} />
  </>)),
};

export function navItem(key) {
  return key === 'more' ? MORE_TAB : NAV_CATALOGUE.find((i) => i.key === key);
}

/**
 * Which bar tab a screen belongs to. A screen that is not itself a tab rides
 * with its parent (Cooking Temp under QC), and if that parent is not on the bar
 * either, the highlight falls through to More — which is exactly where the user
 * would have reached it from.
 */
const SCREEN_FAMILY = {
  home: 'home', profile: 'home', theme: 'home', 'nav-settings': 'home',
  alerts: 'alerts',
  orders: 'orders', 'meal-planning': 'meal-planning',
  production: 'production',
  qc: 'qc', hygiene: 'qc', 'personal-hygiene': 'qc', 'cooking-temp': 'qc',
  approvals: 'approvals',
  dispatch: 'dispatch', 'dispatch-mon': 'dispatch-mon',
  stock: 'stock', demands: 'demands',
  'purchase-requisition': 'purchase-requisition',
  'purchase-receive': 'purchase-requisition',
  'purchase-qc': 'purchase-requisition',
  'purchase-orders': 'purchase-requisition',
  'galley-overview': 'galley-overview', 'return-log': 'return-log',
};

// Fall-back chain for families the user did not promote to the bar.
const FAMILY_PARENT = { alerts: 'home', 'meal-planning': 'orders' };

export function tabForScreen(screen, tabs = DEFAULT_NAV_KEYS) {
  let family = SCREEN_FAMILY[screen];
  while (family) {
    if (tabs.includes(family)) return family;
    family = FAMILY_PARENT[family];
  }
  return 'more';
}

function sanitize(keys) {
  const valid = [];
  for (const k of Array.isArray(keys) ? keys : []) {
    if (k !== 'more' && navItem(k) && !valid.includes(k)) valid.push(k);
  }
  return valid.length >= MIN_NAV_TABS ? valid.slice(0, MAX_NAV_TABS) : [...DEFAULT_NAV_KEYS];
}

export function loadMobileNavTabs() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(NAV_KEY) || 'null'); } catch { /* ignore */ }
  return sanitize(saved);
}

export function saveMobileNavTabs(keys) {
  const clean = sanitize(keys);
  try { localStorage.setItem(NAV_KEY, JSON.stringify(clean)); } catch { /* ignore */ }
  return clean;
}

export function isDefaultNavTabs(keys) {
  return keys.length === DEFAULT_NAV_KEYS.length && keys.every((k, i) => k === DEFAULT_NAV_KEYS[i]);
}
