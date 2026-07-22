/**
 * Initial role-permission grants for Harvest Catering.
 *
 * Seeds sensible defaults per built-in role by walking the generated
 * PERMISSION_CATALOG and granting whole modules at a chosen depth:
 *   • 'full'     — every permission (used for Business Analyst and a role's own modules)
 *   • 'operator' — page + KPIs + columns + form fields + sections + safe actions
 *   • 'read'     — page + KPIs + columns + sections only (view-only)
 *
 * Mirrors what an API would return after first provisioning a tenant.
 */

import { INITIAL_ROLES } from '@/features/system-admin/role-setup/types/roleSetup.types';
import { PERMISSION_CATALOG } from './catalog';
import type {
  Permission,
  PermissionAuditEntry,
  PermissionScope,
  RolePermissionMap,
  RolePermissionsByRole,
} from '../types/permissions.types';
import { nextPermAuditId } from '../types/permissions.types';

type Depth = 'full' | 'operator' | 'read';

const READ_SECTIONS = new Set(['page', 'tiles', 'columns', 'sections']);

function includePerm(p: Permission, depth: Depth): boolean {
  if (depth === 'full') return true;
  if (READ_SECTIONS.has(p.section)) return true;
  if (depth === 'read') return false;
  // operator: also form fields + safe (non-destructive, non-sensitive) actions
  if (p.section === 'forms') return true;
  if (p.section === 'page_actions') return !p.destructive && !p.sensitive;
  return false;
}

/** Grant every catalog module in `moduleKeys` at the given depth + scope. */
function grantModules(moduleKeys: string[] | 'all', depth: Depth, scope: PermissionScope): RolePermissionMap {
  const map: RolePermissionMap = {};
  for (const mod of PERMISSION_CATALOG) {
    if (moduleKeys !== 'all' && !moduleKeys.includes(mod.key)) continue;
    for (const sub of mod.submodules) {
      for (const p of sub.permissions) {
        if (!includePerm(p, depth)) continue;
        map[p.key] = p.scopeable ? { granted: true, scope } : { granted: true };
      }
    }
  }
  return map;
}

function merge(...maps: RolePermissionMap[]): RolePermissionMap {
  return Object.assign({}, ...maps);
}

const roleId = (i: number) => INITIAL_ROLES[i]?.id ?? `ROL-${String(i + 1).padStart(3, '0')}`;

const GM_ADMIN    = roleId(0);
const MENU_PLAN   = roleId(1);
const PRODUCTION  = roleId(2);
const DISPATCH    = roleId(3);
const STORE_INV   = roleId(4);
const PROCUREMENT = roleId(5);
const QC          = roleId(6);
const MAINTENANCE = roleId(7);
const REPORTS     = roleId(8);

export const INITIAL_ROLE_PERMISSIONS: RolePermissionsByRole = {
  // Business Analyst — everything, organization scope.
  [GM_ADMIN]: grantModules('all', 'full', 'company'),

  // Menu Planner — owns menu/operations, reads production.
  [MENU_PLAN]: merge(
    grantModules(['dashboard'], 'read', 'company'),
    grantModules(['operations'], 'operator', 'office'),
    grantModules(['production'], 'read', 'office'),
  ),

  // Production — owns kitchen production, reads QC & inventory.
  [PRODUCTION]: merge(
    grantModules(['dashboard'], 'read', 'company'),
    grantModules(['production'], 'operator', 'office'),
    grantModules(['qc', 'inventory'], 'read', 'office'),
  ),

  // Packaging & Dispatch — owns dispatch, reads production & QC.
  [DISPATCH]: merge(
    grantModules(['dashboard'], 'read', 'company'),
    grantModules(['dispatch'], 'operator', 'office'),
    grantModules(['production', 'qc'], 'read', 'office'),
  ),

  // Store & Inventory — owns inventory.
  [STORE_INV]: merge(
    grantModules(['dashboard'], 'read', 'company'),
    grantModules(['inventory'], 'operator', 'office'),
  ),

  // Procurement — owns supply + reads accounts (inherits Store & Inventory via parentRoleId).
  [PROCUREMENT]: merge(
    grantModules(['dashboard'], 'read', 'company'),
    grantModules(['supply'], 'operator', 'office'),
    grantModules(['accounts'], 'read', 'company'),
  ),

  // Food Safety & QC — owns QC.
  [QC]: merge(
    grantModules(['dashboard'], 'read', 'company'),
    grantModules(['qc'], 'operator', 'office'),
  ),

  // Maintenance & Asset — owns fleet / equipment.
  [MAINTENANCE]: merge(
    grantModules(['dashboard'], 'read', 'company'),
    grantModules(['fleet-operations', 'airline-consumables'], 'operator', 'office'),
  ),

  // Reports & Analytics — read-only across reporting surfaces, org scope.
  [REPORTS]: merge(
    grantModules(['dashboard', 'reports', 'accounts'], 'read', 'company'),
  ),
};

// ─── Initial audit log ───────────────────────────────────────────────────────

function seedAudit(roleIdArg: string, action: PermissionAuditEntry['action'], actor: string, timestamp: string, extra: Partial<PermissionAuditEntry> = {}): PermissionAuditEntry {
  return { id: nextPermAuditId(), roleId: roleIdArg, action, actor, timestamp, ...extra };
}

export const INITIAL_PERMISSION_AUDIT: PermissionAuditEntry[] = [
  seedAudit(GM_ADMIN,    'role.reviewed',            'System',   '01 Jan 2025, 09:00 AM', { note: 'Seeded with full access across every module.' }),
  seedAudit(PRODUCTION,  'role.reviewed',            'System',   '05 Jan 2025, 09:30 AM', { note: 'Seeded with operator access to Production.' }),
  seedAudit(PROCUREMENT, 'role.copied_from',         'Business Analyst', '01 May 2026, 11:05 AM', { note: 'Inheritance set from Store & Inventory.' }),
  seedAudit(REPORTS,     'role.reviewed',            'Business Analyst', '06 May 2026, 10:00 AM', { note: 'Quarterly review — confirmed read-only across reporting surfaces.' }),
];
