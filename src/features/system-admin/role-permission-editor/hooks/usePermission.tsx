/**
 * usePermission.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * The frontend enforcement layer. Pages call `usePermission(key)` to find out
 * whether the current acting role has been granted a specific permission, and
 * at which scope.
 *
 * For one-shot conditional rendering, `<Can permission="...">` is the sugar.
 *
 * When the real backend lands, only `useRoleGrants()` needs to change — it
 * swaps from reading the in-memory store to a `useQuery(['/api/me/perms'])`.
 * Every consumer keeps working without modification.
 */

import type { ReactNode } from 'react';

import { INITIAL_ROLES, type Role } from '@/features/system-admin/role-setup/types/roleSetup.types';
import { usePermissionsStore } from '@/stores/permissionsStore';
import type { PermissionScope, RolePermissionMap } from '../types/permissions.types';
import type { PermissionKey } from '../types/permissionKeys';
import { flattenResolved, resolveGrantsForRole } from '../utils/resolveGrants';

/**
 * Internal: get the LIVE, fully-resolved grants for the currently acting role.
 * - Consumer pages always see live state — never the editor's pending draft.
 * - Inheritance is applied: ancestors' grants are unioned in, with the
 *   nearest role's grant winning on key collision.
 */
function useRoleGrants(): RolePermissionMap {
  const { liveGrantsByRole, currentRoleId } = usePermissionsStore();
  if (!currentRoleId) return {};
  const resolved = resolveGrantsForRole(currentRoleId, liveGrantsByRole);
  return flattenResolved(resolved);
}

export interface PermissionCheck {
  granted: boolean;
  scope:   PermissionScope | undefined;
}

/**
 * Read a single permission for the current acting role.
 * The `key` parameter is constrained to catalogued keys — typos and missing
 * catalogue entries fail at compile time.
 */
export function usePermission(key: PermissionKey): PermissionCheck {
  const grants = useRoleGrants();
  const grant = grants[key];
  return {
    granted: !!grant?.granted,
    scope:   grant?.scope,
  };
}

/** Read multiple permissions in one call — returns a key-keyed map. */
export function usePermissions<K extends PermissionKey>(keys: readonly K[]): Record<K, PermissionCheck> {
  const grants = useRoleGrants();
  const out = {} as Record<K, PermissionCheck>;
  for (const k of keys) {
    const g = grants[k];
    out[k] = { granted: !!g?.granted, scope: g?.scope };
  }
  return out;
}

/** Read the current acting role. */
export function useCurrentRole(): Role | null {
  const { currentRoleId } = usePermissionsStore();
  return INITIAL_ROLES.find(r => r.id === currentRoleId) ?? null;
}

/**
 * Conditional render helper.
 *   <Can permission="recruitment.job_posting.row_actions.delete" fallback={null}>
 *     <Button>Delete</Button>
 *   </Can>
 */
export function Can({
  permission, children, fallback = null,
}: {
  permission: PermissionKey;
  children:   ReactNode;
  fallback?:  ReactNode;
}) {
  const { granted } = usePermission(permission);
  return <>{granted ? children : fallback}</>;
}
