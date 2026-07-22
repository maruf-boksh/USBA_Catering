// ─── Domain Types ─────────────────────────────────────────────────────────────

/**
 * Data-visibility scopes, mirroring the app's org architecture:
 *   Company → Office → Warehouse (a single company).
 * Ordered from most-restrictive → most-permissive:
 *   own → warehouse → office → company
 * `company` is the broadest — the whole organization (one company).
 * See `offices` / `warehouses` in `@/lib/sample-data`.
 */
export type PermissionScope = 'own' | 'warehouse' | 'office' | 'company';

export const SCOPE_ORDER: PermissionScope[] = ['own', 'warehouse', 'office', 'company'];

export const SCOPE_LABELS: Record<PermissionScope, string> = {
  own:       'Own',
  warehouse: 'Warehouse',
  office:    'Office',
  company:   'Company',
};

export const SCOPE_DESCRIPTIONS: Record<PermissionScope, string> = {
  own:       'Only records the user owns or created.',
  warehouse: 'All records within the user\'s warehouse / store.',
  office:    'All records within the user\'s office (every warehouse under it).',
  company:   'All records across the company — every office & warehouse.',
};

export const SCOPE_STYLE: Record<PermissionScope, { color: string; bg: string; rank: number }> = {
  own:       { color: '#9333ea', bg: '#faf5ff', rank: 1 },
  warehouse: { color: '#047857', bg: '#ecfdf5', rank: 2 },
  office:    { color: '#0369a1', bg: '#f0f9ff', rank: 3 },
  company:   { color: '#b91c1c', bg: '#fef2f2', rank: 4 },
};

/** Section keys group permissions inside a submodule. New sections can be added without breaking the editor. */
export type PermissionSection =
  | 'page'           // page access gate
  | 'tiles'          // metric / KPI tiles
  | 'filters'        // search bar, filter drawer, status tabs
  | 'columns'        // table column visibility
  | 'row_actions'    // dropdown actions on each row
  | 'page_actions'   // top-of-page CTA buttons
  | 'forms'          // form field visibility
  | 'sections'       // page sections / panels
  | 'modals';        // modal-level visibility (used by other modules later)

export const SECTION_LABELS: Record<PermissionSection, string> = {
  page:         'Page Access',
  tiles:        'KPI Cards',
  filters:      'Filters',
  columns:      'Table Columns',
  row_actions:  'Row Actions',
  page_actions: 'Action Buttons',
  forms:        'Form Fields',
  sections:     'Page Sections',
  modals:       'Modals',
};

export const SECTION_ORDER: PermissionSection[] = [
  'page', 'tiles', 'filters', 'columns', 'forms', 'page_actions', 'row_actions', 'sections', 'modals',
];

/** A single grantable permission, sourced from the catalog. */
export interface Permission {
  key:                 string;     // dot-separated stable id, e.g. 'recruitment.job_posting.tiles.total_job_posts'
  displayName:         string;
  module:              string;     // module key, e.g. 'recruitment'
  submodule:           string;     // submodule key, e.g. 'job_posting'
  section:             PermissionSection;
  scopeable:           boolean;
  destructive:         boolean;
  required:            boolean;    // if true, this permission cannot be revoked when role has page access
  sensitive:           boolean;    // PII / salary / compensation data
  defaultScope:        PermissionScope | null;
  impactDescription:   string;
  apiEndpoint:         string | null;
  /**
   * Other permission keys that must already be granted for this one to take
   * effect. Granting a permission with unmet prerequisites prompts the admin
   * to grant the prerequisites alongside it. Examples:
   *  - row_actions.edit requires row_actions.view (must see before editing).
   *  - row_actions.approve requires row_actions.view.
   */
  requires?:           readonly string[];
}

export interface PermissionPreset {
  key:               string;
  label:             string;
  description:       string;
  /** Visual tone for the preset chip (kept presentation-only). */
  tone?:             'neutral' | 'info' | 'success' | 'warning' | 'danger';
  /** Default scope applied to all scopeable permissions in `include`. */
  scope?:            PermissionScope;
  /**
   * Permission keys to grant. If `omitted`, every permission in the submodule is granted.
   * If `[]` (empty array), every permission is revoked — useful for "No Access" presets.
   */
  include?:          string[];
  /** Per-key scope overrides — wins over `scope`. */
  scopeOverrides?:   Partial<Record<string, PermissionScope>>;
}

export interface SubmoduleNode {
  key:           string;
  module:        string;          // parent module key
  label:         string;
  description?:  string;
  /** `readonly` so per-page catalogs can use `as const satisfies readonly Permission[]` to preserve literal key types. */
  permissions:   readonly Permission[];
  presets?:      readonly PermissionPreset[];
  /** When `true`, the catalog has not yet been authored for this submodule. Editor shows a "not catalogued yet" banner. */
  pending?:      boolean;
}

export interface ModuleNode {
  key:        string;
  label:      string;
  iconKey:    string;             // resolved at render time to keep types lib-free
  submodules: SubmoduleNode[];
}

// ─── Role grant ────────────────────────────────────────────────────────────────

export interface PermissionGrant {
  granted: boolean;
  scope?:  PermissionScope;       // present only when scopeable + granted
}

/** Permission map for one role: keyed by Permission.key */
export type RolePermissionMap = Record<string, PermissionGrant>;

/** Permission state for the entire tenant, keyed by Role.id */
export type RolePermissionsByRole = Record<string, RolePermissionMap>;

// ─── Audit ────────────────────────────────────────────────────────────────────

export type PermissionAuditAction =
  | 'permission.granted'
  | 'permission.revoked'
  | 'permission.scope_changed'
  | 'role.draft_saved'
  | 'role.draft_published'
  | 'role.draft_discarded'
  | 'role.preset_applied'
  | 'role.copied_from'
  | 'role.scopes_reset'
  | 'role.reviewed';

export interface PermissionAuditEntry {
  id:             string;
  roleId:         string;
  action:         PermissionAuditAction;
  actor:          string;
  timestamp:      string;
  permissionKey?: string;          // present for permission.* actions
  fromScope?:     PermissionScope;
  toScope?:       PermissionScope;
  note?:          string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _auditCounter = 0;
export function nextPermAuditId(): string {
  _auditCounter += 1;
  return `PRM-${String(_auditCounter).padStart(6, '0')}`;
}

export function formatTimestamp(d: Date = new Date()): string {
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}
