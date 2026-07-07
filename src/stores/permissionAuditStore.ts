/**
 * permissionAuditStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Persistent audit log for permission changes. Lives in a store so the trail
 * survives navigation between the list and editor views (within a session).
 *
 * In production this gets replaced by a real `auditService` reading from the
 * backend audit table — every push here would become an API call. The shape
 * of `PermissionAuditEntry` is the contract.
 *
 * Why not in component state: an audit log living inside `useState` of a
 * page component is lost on refresh, route change, or hard navigation —
 * structurally wrong for compliance-grade history.
 */

import { create } from 'zustand';

import { INITIAL_PERMISSION_AUDIT } from '@/features/system-admin/role-permission-editor/data/initialGrants';
import type { PermissionAuditEntry } from '@/features/system-admin/role-permission-editor/types/permissions.types';

interface PermissionAuditState {
  entries:    PermissionAuditEntry[];
  push:       (entry: PermissionAuditEntry) => void;
  /** Convenience — entries filtered to a single role, in chronological order. */
  forRole:    (roleId: string) => PermissionAuditEntry[];
}

export const usePermissionAuditStore = create<PermissionAuditState>((set, get) => ({
  entries: [...INITIAL_PERMISSION_AUDIT],

  push: (entry) => set(state => ({ entries: [...state.entries, entry] })),

  forRole: (roleId) => get().entries.filter(e => e.roleId === roleId),
}));
