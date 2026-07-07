/**
 * resolveGrants.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Walks a role's parent chain and produces the *effective* permission map —
 * union of every ancestor's grants plus the role's own. When the same key
 * appears at multiple levels, the most-specific (closest to the role) wins,
 * including for scope. Cycles are guarded against.
 *
 * Used by:
 *  - `usePermission()` — consumer pages get the resolved grants for the
 *    currently acting role.
 *  - The Permission Inspector — to show roles that effectively have a
 *    permission, not just direct grants.
 */

import { INITIAL_ROLES, type Role } from '@/features/system-admin/role-setup/types/roleSetup.types';
import type { RolePermissionMap, RolePermissionsByRole } from '../types/permissions.types';

export interface ResolvedGrant {
  granted:    boolean;
  scope?:     import('../types/permissions.types').PermissionScope;
  /** The role id this grant came from. `null` means "this role's own direct grant". */
  fromRoleId: string | null;
}

export type ResolvedRoleMap = Record<string, ResolvedGrant>;

/**
 * Build the resolved map for one role given the full grants table.
 * `grantsByRole` is the source (live or draft) — caller picks.
 */
export function resolveGrantsForRole(
  roleId: string,
  grantsByRole: RolePermissionsByRole,
  rolesById: Record<string, Role> = ROLES_BY_ID,
): ResolvedRoleMap {
  const seen = new Set<string>();
  const out: ResolvedRoleMap = {};

  // Walk the chain root → child so child grants overwrite ancestor grants.
  function walkUp(id: string): string[] {
    const order: string[] = [];
    let cur: string | undefined = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      order.unshift(cur);                       // root-first
      cur = rolesById[cur]?.parentRoleId;
    }
    return order;
  }

  const chain = walkUp(roleId);
  for (const ancestorId of chain) {
    const map = grantsByRole[ancestorId] ?? {};
    const isDirect = ancestorId === roleId;
    for (const key of Object.keys(map)) {
      const g = map[key];
      if (!g?.granted) continue;
      // Child wins on conflict — overwrite is fine because we walk root-first.
      out[key] = {
        granted:    true,
        scope:      g.scope,
        fromRoleId: isDirect ? null : ancestorId,
      };
    }
  }
  return out;
}

/**
 * Plain map (no provenance). Used by the consumer hook — it doesn't care
 * which ancestor granted the permission, only whether it's granted.
 */
export function flattenResolved(resolved: ResolvedRoleMap): RolePermissionMap {
  const out: RolePermissionMap = {};
  for (const k of Object.keys(resolved)) {
    const g = resolved[k];
    out[k] = g.scope ? { granted: true, scope: g.scope } : { granted: true };
  }
  return out;
}

/**
 * Resolve grants from ANCESTORS ONLY — excluding the role's own direct
 * grants. The editor uses this to show "inherited" overlays in the UI
 * without conflating them with the role's own working state.
 */
export function resolveAncestorGrants(
  roleId: string,
  grantsByRole: RolePermissionsByRole,
  rolesById: Record<string, Role> = ROLES_BY_ID,
): ResolvedRoleMap {
  const role = rolesById[roleId];
  const parentId = role?.parentRoleId;
  if (!parentId) return {};
  return resolveGrantsForRole(parentId, grantsByRole, rolesById);
}

const ROLES_BY_ID: Record<string, Role> = Object.fromEntries(INITIAL_ROLES.map(r => [r.id, r]));
