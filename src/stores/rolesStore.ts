/**
 * rolesStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared source of truth for role identity (name, code, description, status,
 * inheritance, members, audit). Role Setup does CRUD here; the Advanced Role
 * Permission Editor reads the role list and inheritance from here. Grants
 * themselves live in permissionsStore, keyed by these role ids.
 *
 * Kept in-memory (like permissionsStore) so a session stays internally
 * consistent; swap `create` for `persist(create(...))` to survive reloads.
 */

import { create } from 'zustand';

import {
  INITIAL_ROLES,
  nextRoleId,
  type Role,
  type AuditEntry,
  type RoleStatus,
} from '@/features/system-admin/role-setup/types/roleSetup.types';

export interface NewRoleInput {
  name:        string;
  code:        string;
  description: string;
  status:      RoleStatus;
  parentRoleId?: string;
}

interface RolesState {
  roles: Role[];
  getById:    (id: string) => Role | undefined;
  rolesById:  () => Record<string, Role>;
  createRole: (input: NewRoleInput, audit: AuditEntry[]) => Role;
  updateRole: (id: string, patch: Partial<Role>, audit: AuditEntry[]) => void;
  setStatus:  (id: string, status: RoleStatus, audit: AuditEntry) => void;
}

export const useRolesStore = create<RolesState>((set, get) => ({
  roles: JSON.parse(JSON.stringify(INITIAL_ROLES)) as Role[],

  getById: (id) => get().roles.find(r => r.id === id),

  rolesById: () => Object.fromEntries(get().roles.map(r => [r.id, r])),

  createRole: (input, audit) => {
    const role: Role = {
      id:          nextRoleId(),
      name:        input.name,
      code:        input.code,
      description: input.description,
      permissions: 0,
      members:     0,
      memberList:  [],
      status:      input.status,
      isSystem:    false,
      parentRoleId: input.parentRoleId,
      createdBy:   'Business Analyst',
      createdAt:   audit[0]?.timestamp.split(',')[0] ?? '',
      modifiedBy:  'Business Analyst',
      updatedAt:   audit[0]?.timestamp.split(',')[0] ?? '',
      auditLog:    audit,
    };
    set(state => ({ roles: [...state.roles, role] }));
    return role;
  },

  updateRole: (id, patch, audit) => set(state => ({
    roles: state.roles.map(r =>
      r.id === id
        ? { ...r, ...patch, auditLog: [...r.auditLog, ...audit], modifiedBy: 'Business Analyst' }
        : r,
    ),
  })),

  setStatus: (id, status, audit) => set(state => ({
    roles: state.roles.map(r =>
      r.id === id
        ? { ...r, status, auditLog: [...r.auditLog, audit], modifiedBy: 'Business Analyst' }
        : r,
    ),
  })),
}));
