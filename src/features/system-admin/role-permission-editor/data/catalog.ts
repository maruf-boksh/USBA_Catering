/**
 * Permission catalog — generated from the real Harvest Catering app structure.
 *
 * Instead of hand-authoring a `permissions.ts` next to every page, the catalog
 * is derived at load time from two sources of truth the app already maintains:
 *
 *   • `RBAC_TREE`            (src/lib/access-control.ts)  — module → page tree,
 *                              built straight from the sidebar navigation.
 *   • `PAGE_CONTENT_CATALOG` (src/lib/page-content-catalog.ts) — the exhaustive
 *                              KPI / column / field / action / section inventory
 *                              for every page.
 *
 * Every page becomes a "submodule" with one master **page access** permission
 * plus one grantable permission per UI element, grouped into sections (KPI
 * cards, table columns, form fields, action buttons, page sections). KPIs and
 * action buttons are **scopeable** (own → organization data visibility);
 * structural elements are simple on/off.
 *
 * Extend a page in `page-content-catalog.ts` and it shows up here automatically.
 */

import { RBAC_TREE } from '@/lib/access-control';
import { PAGE_CONTENT_CATALOG } from '@/lib/page-content-catalog';
import type {
  ModuleNode,
  Permission,
  PermissionPreset,
  PermissionSection,
  SubmoduleNode,
} from '../types/permissions.types';

// Map the app's element kinds to permission sections.
const KIND_SECTION: Record<string, PermissionSection> = {
  kpi:     'tiles',
  column:  'columns',
  field:   'forms',
  action:  'page_actions',
  section: 'sections',
};

// Keywords that mark a permission as money / cost sensitive (confirm before grant).
const SENSITIVE_ROUTES = /accounts|price|procurement|purchase|quotation|comparative|invoice|expense|payroll|cost/i;
const SENSITIVE_WORDS  = /\b(cost|price|amount|spend|value|payment|invoice|salary|rate|budget|total)\b/i;
// Keywords that mark an action as destructive (irreversible / lifecycle-ending).
const DESTRUCTIVE_WORDS = /\b(delete|remove|reject|dispose|discard|deactivate|cancel|clear)\b/i;

/** Strip the kind prefix from an element id → a clean, stable key segment. */
function cleanId(id: string): string {
  const slug = id
    .replace(/^col:/, '')
    .replace(/^(kpi|field|action|section)-/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return slug || 'item';
}

/** submodule key = route without the leading slash (root "/" → "dashboard"). */
function routeToSubKey(route: string): string {
  const cleaned = route.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '_');
  return cleaned || 'dashboard';
}

function buildPresets(subKey: string, perms: Permission[]): PermissionPreset[] {
  const nonStructural = perms
    .filter(p => p.section === 'page_actions' || p.section === 'forms')
    .filter(p => !p.destructive && !p.sensitive)
    .map(p => p.key);
  const readOnlyKeys = perms
    .filter(p => p.section === 'page' || p.section === 'tiles' || p.section === 'columns' || p.section === 'sections')
    .map(p => p.key);
  return [
    {
      key: `${subKey}.no_access`,
      label: 'No Access',
      description: 'Revoke every permission on this page. The role cannot open it.',
      tone: 'danger',
      include: [],
    },
    {
      key: `${subKey}.read_only`,
      label: 'Read Only',
      description: 'Page access, all KPI cards, table columns and page sections. No forms or actions.',
      tone: 'info',
      scope: 'department',
      include: readOnlyKeys,
    },
    {
      key: `${subKey}.operator`,
      label: 'Operator',
      description: 'Read-only plus form fields and non-destructive action buttons.',
      tone: 'success',
      scope: 'department',
      include: [...readOnlyKeys, ...nonStructural],
    },
    {
      key: `${subKey}.full`,
      label: 'Full Access',
      description: 'Every permission on this page granted at organization scope.',
      tone: 'warning',
      scope: 'organization',
      // include omitted → grant everything
    },
  ];
}

function buildSubmodule(route: string, label: string, moduleKey: string): SubmoduleNode {
  const subKey = routeToSubKey(route);
  const elements = PAGE_CONTENT_CATALOG[route] ?? [];
  const sensitivePage = SENSITIVE_ROUTES.test(route);

  const permissions: Permission[] = [];

  // Master page-access gate.
  permissions.push({
    key: `${moduleKey}.${subKey}.page.access`,
    displayName: 'Access this page',
    module: moduleKey,
    submodule: subKey,
    section: 'page',
    scopeable: false,
    destructive: false,
    required: false,
    sensitive: false,
    defaultScope: null,
    impactDescription: `Master gate for ${label}. When off, the page hides from the menu and the route is blocked; all element permissions below are ignored.`,
    apiEndpoint: `GET ${route}`,
  });

  // One permission per catalogued UI element.
  for (const el of elements) {
    const section = KIND_SECTION[el.kind] ?? 'sections';
    const scopeable = section === 'tiles' || section === 'page_actions';
    const destructive = section === 'page_actions' && DESTRUCTIVE_WORDS.test(el.label);
    const sensitive = (sensitivePage || SENSITIVE_WORDS.test(el.label)) && (scopeable || destructive);
    permissions.push({
      key: `${moduleKey}.${subKey}.${section}.${cleanId(el.id)}`,
      displayName: el.label,
      module: moduleKey,
      submodule: subKey,
      section,
      scopeable,
      destructive,
      required: false,
      sensitive,
      defaultScope: scopeable ? 'department' : null,
      impactDescription:
        section === 'tiles'          ? `Shows the "${el.label}" KPI card and its underlying metric within scope.`
        : section === 'columns'      ? `Shows the "${el.label}" column in this page's tables.`
        : section === 'forms'        ? `Exposes the "${el.label}" input in this page's forms.`
        : section === 'page_actions' ? `Enables the "${el.label}" action button.`
        : `Renders the "${el.label}" section / panel on this page.`,
      apiEndpoint: null,
    });
  }

  return {
    key: subKey,
    module: moduleKey,
    label,
    description: `${elements.length} manageable element${elements.length === 1 ? '' : 's'} across ${
      new Set(permissions.map(p => p.section)).size
    } sections.`,
    permissions,
    presets: buildPresets(subKey, permissions),
    pending: elements.length === 0,
  };
}

// Icon keys resolved at render time (lucide-react name per module).
const MODULE_ICON: Record<string, string> = {
  dashboard: 'LayoutDashboard',
  operations: 'ClipboardList',
  production: 'ChefHat',
  supply: 'ShoppingCart',
  inventory: 'Package',
  qc: 'ShieldCheck',
  dispatch: 'Truck',
  'airline-consumables': 'Coffee',
  'fleet-operations': 'Plane',
  'wastage-management': 'Trash2',
  reports: 'BarChart3',
  admin: 'Users',
  config: 'Settings',
  archive: 'Archive',
  accounts: 'Wallet',
};

export const PERMISSION_CATALOG: ModuleNode[] = RBAC_TREE
  .map((mod) => ({
    key: mod.key,
    label: mod.label,
    iconKey: MODULE_ICON[mod.key] ?? 'Settings',
    submodules: mod.pages.map((page) => buildSubmodule(page.key, page.label, mod.key)),
  }))
  .filter((m) => m.submodules.length > 0);

/** Find the catalog entry for a given module/submodule pair. */
export function findSubmodule(moduleKey: string, submoduleKey: string) {
  return PERMISSION_CATALOG
    .find(m => m.key === moduleKey)
    ?.submodules.find(s => s.key === submoduleKey) ?? null;
}

/** Flatten every catalogued permission across the entire catalog. */
export function allCatalogedPermissions(): Permission[] {
  return PERMISSION_CATALOG.flatMap(m => m.submodules.flatMap(s => s.permissions as Permission[]));
}

/** Total number of grantable permissions in the catalog. */
export const TOTAL_CATALOGED = allCatalogedPermissions().length;
