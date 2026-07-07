/**
 * permissionsStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Source of truth for the current acting role and the permission grants per
 * role. The Advanced Role Permission Editor writes here on Save (as a draft)
 * and Publish (promotes draft → live); the rest of the app reads `live`
 * via `usePermission(key)` / <Can />.
 *
 * Two-tier flow:
 *   - liveGrantsByRole — what consumer pages enforce. Updated only on Publish.
 *   - draftGrantsByRole — work-in-progress. Saving in the editor commits here;
 *     undefined means there's no pending draft (live is the source of truth).
 *
 * In production this gets replaced by a real `roleService` → `useQuery` chain;
 * the live/draft split mirrors common review-and-publish patterns for
 * security-sensitive grants.
 */

import { create } from 'zustand';

import { INITIAL_ROLES } from '@/features/system-admin/role-setup/types/roleSetup.types';
import { INITIAL_ROLE_PERMISSIONS } from '@/features/system-admin/role-permission-editor/data/initialGrants';
import type { RolePermissionMap, RolePermissionsByRole } from '@/features/system-admin/role-permission-editor/types/permissions.types';

interface PermissionsState {
  /** Currently-enforced grants per role. Consumer pages read from here. */
  liveGrantsByRole:    RolePermissionsByRole;
  /**
   * Pending drafts per role. Editor writes here on Save. Roles without an
   * entry have no pending draft — `live` is authoritative for them.
   */
  draftGrantsByRole:   Partial<RolePermissionsByRole>;
  /** Which role the current user is "acting as" — drives every <Can /> on the page. */
  currentRoleId:       string;

  /** Editor → save the working state as a draft (no consumer impact). */
  saveDraft:           (roleId: string, map: RolePermissionMap) => void;
  /** Editor → promote the draft to live; consumer pages immediately reflect. */
  publishDraft:        (roleId: string) => void;
  /** Editor → throw away an unpublished draft; live state is restored. */
  discardDraft:        (roleId: string) => void;
  /** Convenience accessor — returns the draft if present, else live. */
  getEffectiveGrants:  (roleId: string) => RolePermissionMap;
  /** True iff the role has a draft different from live. */
  hasUnpublishedDraft: (roleId: string) => boolean;

  setCurrentRoleId:    (roleId: string) => void;
}

const DEFAULT_ROLE_ID = INITIAL_ROLES[0]?.id ?? '';

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  liveGrantsByRole:  JSON.parse(JSON.stringify(INITIAL_ROLE_PERMISSIONS)) as RolePermissionsByRole,
  draftGrantsByRole: {},
  currentRoleId:     DEFAULT_ROLE_ID,

  saveDraft: (roleId, map) => set(state => ({
    draftGrantsByRole: { ...state.draftGrantsByRole, [roleId]: JSON.parse(JSON.stringify(map)) },
  })),

  publishDraft: (roleId) => set(state => {
    const draft = state.draftGrantsByRole[roleId];
    if (!draft) return state;
    const nextDraft = { ...state.draftGrantsByRole };
    delete nextDraft[roleId];
    return {
      liveGrantsByRole:  { ...state.liveGrantsByRole, [roleId]: draft },
      draftGrantsByRole: nextDraft,
    };
  }),

  discardDraft: (roleId) => set(state => {
    if (!state.draftGrantsByRole[roleId]) return state;
    const next = { ...state.draftGrantsByRole };
    delete next[roleId];
    return { draftGrantsByRole: next };
  }),

  getEffectiveGrants: (roleId) => {
    const s = get();
    return s.draftGrantsByRole[roleId] ?? s.liveGrantsByRole[roleId] ?? {};
  },

  hasUnpublishedDraft: (roleId) => {
    const s = get();
    return Object.prototype.hasOwnProperty.call(s.draftGrantsByRole, roleId);
  },

  setCurrentRoleId: (roleId) => set({ currentRoleId: roleId }),
}));
