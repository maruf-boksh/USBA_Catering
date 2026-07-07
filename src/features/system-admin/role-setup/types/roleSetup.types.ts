// ─── Domain Types ─────────────────────────────────────────────────────────────

export type RoleStatus = 'Active' | 'Inactive';

export type AuditAction = 'Created' | 'Updated' | 'Activated' | 'Deactivated';

export interface AuditChange {
  field: string;
  from:  string;
  to:    string;
}

export interface AuditEntry {
  id:        string;
  action:    AuditAction;
  actor:     string;
  timestamp: string;       // "12 Mar 2026, 03:42 PM"
  changes?:  AuditChange[]; // present on Updated
  note?:     string;        // human-readable summary
}

export interface RoleMember {
  id:          string;     // employee ID, e.g. EMP-1042
  name:        string;
  email:       string;
  designation: string;
  section:     string;
  department:  string;
  assignedAt:  string;     // "14 Feb 2025"
  assignedBy:  string;
}

export interface Role {
  id:           string;
  name:         string;
  code:         string;
  description:  string;
  permissions:  number;
  members:      number;          // total tagged count (may exceed memberList length)
  memberList:   RoleMember[];    // sample / fully-loaded list for the side panel
  status:       RoleStatus;
  isSystem:     boolean;
  /**
   * Optional parent role. When set, the effective permissions for this role
   * are the union of the parent's effective permissions and this role's own
   * direct grants — child overrides win when keys overlap. Cycles are not
   * permitted; the resolver guards against them.
   */
  parentRoleId?: string;
  createdBy:    string;
  createdAt:    string;
  modifiedBy:   string;
  updatedAt:    string;
  auditLog:     AuditEntry[];
}

// ─── Status Styles ─────────────────────────────────────────────────────────────

export const STATUS_STYLE: Record<RoleStatus, { color: string; bg: string; border: string }> = {
  Active:   { color: '#027a48',                     bg: '#ecfdf3',                  border: '#a9efc5'              },
  Inactive: { color: 'var(--color-text-secondary)', bg: 'var(--color-bg-subtle)',   border: 'var(--color-border)' },
};

export const AUDIT_STYLE: Record<AuditAction, { color: string; bg: string; dot: string }> = {
  Created:     { color: '#0369a1', bg: '#f0f9ff', dot: '#0ea5e9' },
  Updated:     { color: '#b45309', bg: '#fffbeb', dot: '#d97706' },
  Activated:   { color: '#027a48', bg: '#ecfdf3', dot: '#059669' },
  Deactivated: { color: '#b91c1c', bg: '#fef2f2', dot: '#dc2626' },
};

// ─── Options ──────────────────────────────────────────────────────────────────

export const STATUS_OPTIONS = [
  { value: 'Active',   label: 'Active'   },
  { value: 'Inactive', label: 'Inactive' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

let _counter = 0;
export function nextRoleId(): string {
  _counter += 1;
  return `ROL-${String(_counter).padStart(3, '0')}`;
}

let _auditCounter = 0;
export function nextAuditId(): string {
  _auditCounter += 1;
  return `AUD-${String(_auditCounter).padStart(5, '0')}`;
}

export function formatTimestamp(d: Date = new Date()): string {
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}

export function formatDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Seed Data (Harvest Catering) ───────────────────────────────────────────────

const seedAudit = (action: AuditAction, actor: string, timestamp: string, note?: string, changes?: AuditChange[]): AuditEntry => ({
  id: nextAuditId(), action, actor, timestamp, note, changes,
});

const NAME_POOL = [
  'Md. Wahiduzzaman Nayem', 'Ayesha Rahman',     'Tanvir Hossain',     'Sumaiya Akter',
  'Rafsan Jamil',           'Nazia Karim',       'Imran Khaled',       'Maliha Chowdhury',
  'Sabbir Ahmed',           'Rumana Sultana',    'Tausif Mahmud',      'Farhana Yeasmin',
  'Hasibul Islam',          'Anika Tabassum',    'Mehedi Hasan',       'Rashedul Karim',
  'Tasnim Jahan',           'Arif Hossain',      'Zarin Tasnim',       'Ridwan Sakib',
];

// Catering-floor departments and their working sections.
const SECTION_BY_DEPT: Record<string, string[]> = {
  'Kitchen':            ['Hot Kitchen', 'Cold Kitchen', 'Butchery', 'Garnish'],
  'Bakery':            ['Bread & Rolls', 'Pastry', 'Dessert'],
  'Stores':            ['Dry Store', 'Cold Store', 'Consumables'],
  'Procurement':       ['Purchasing', 'Vendor Management', 'Receiving'],
  'Dispatch':          ['Packaging', 'Loading', 'Transport'],
  'Quality Assurance': ['Food Safety', 'Hygiene', 'HACCP'],
  'Maintenance':       ['Equipment', 'Facilities', 'Cold Chain'],
  'Administration':    ['Management', 'MIS', 'Finance'],
};
const DEPT_BY_ROLE: Record<string, string> = {
  GM_ADMIN:    'Administration',
  MENU_PLAN:   'Kitchen',
  PRODUCTION:  'Kitchen',
  DISPATCH:    'Dispatch',
  STORE_INV:   'Stores',
  PROCUREMENT: 'Procurement',
  QC:          'Quality Assurance',
  MAINTENANCE: 'Maintenance',
  REPORTS:     'Administration',
};
const DESIG_BY_ROLE: Record<string, string[]> = {
  GM_ADMIN:    ['General Manager', 'System Administrator'],
  MENU_PLAN:   ['Menu Planning Lead', 'Menu Planner', 'Dietician'],
  PRODUCTION:  ['Head Chef', 'Sous Chef', 'Production Supervisor', 'Kitchen Associate'],
  DISPATCH:    ['Dispatch Supervisor', 'Packaging Lead', 'Loading Coordinator'],
  STORE_INV:   ['Store Manager', 'Store Keeper', 'Inventory Officer'],
  PROCUREMENT: ['Procurement Manager', 'Purchase Officer', 'Supply Chain Analyst'],
  QC:          ['QC Manager', 'Food Safety Officer', 'Hygiene Inspector'],
  MAINTENANCE: ['Maintenance Engineer', 'Asset Coordinator', 'Technician'],
  REPORTS:     ['MIS Analyst', 'Reporting Officer'],
};

function emailFromName(name: string): string {
  const local = name
    .toLowerCase()
    .replace(/md\.\s*/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/).slice(0, 2).join('.');
  return `${local}@harvestcatering.com`;
}

let _empCounter = 1000;
function generateMembers(opts: {
  roleCode: string;
  count:    number;
  baseDate: string;
  baseAssigner: string;
}): RoleMember[] {
  const cap = Math.min(opts.count, 25);
  const designations = DESIG_BY_ROLE[opts.roleCode] ?? ['Associate'];
  const department = DEPT_BY_ROLE[opts.roleCode] ?? 'Administration';
  const sections = SECTION_BY_DEPT[department] ?? ['General'];
  const out: RoleMember[] = [];
  for (let i = 0; i < cap; i++) {
    _empCounter += 1;
    const name = NAME_POOL[(i + opts.roleCode.length) % NAME_POOL.length];
    out.push({
      id:          `EMP-${_empCounter}`,
      name,
      email:       emailFromName(name),
      designation: designations[i % designations.length],
      section:     sections[i % sections.length],
      department,
      assignedAt:  opts.baseDate,
      assignedBy:  opts.baseAssigner,
    });
  }
  return out;
}

/**
 * INITIAL_ROLES mirrors the app's built-in roles (see src/lib/roles.ts →
 * BUILTIN_ROLES). Names are kept identical so the Permission Editor's acting
 * role lines up with the rest of the app's access control. Role ids are the
 * stable keys the permission grants are keyed by.
 */
export const INITIAL_ROLES: Role[] = [
  {
    id:          nextRoleId(),                     // ROL-001
    name:        'GM/Admin',
    code:        'GM_ADMIN',
    description: 'Full unrestricted access across every module, page and configuration. Reserved for the General Manager and system administrators.',
    permissions: 0,
    members:     2,
    memberList:  generateMembers({ roleCode: 'GM_ADMIN', count: 2, baseDate: '01 Jan 2025', baseAssigner: 'System' }),
    status:      'Active',
    isSystem:    true,
    createdBy:   'System',
    createdAt:   '01 Jan 2025',
    modifiedBy:  'System',
    updatedAt:   '12 Mar 2026',
    auditLog: [
      seedAudit('Created', 'System', '01 Jan 2025, 09:00 AM', 'Seeded by installer as the root administrator role.'),
    ],
  },
  {
    id:          nextRoleId(),                     // ROL-002
    name:        'Menu Planner',
    code:        'MENU_PLAN',
    description: 'Builds flight menus, meal configurations and special-meal plans; reads order demand.',
    permissions: 0,
    members:     4,
    memberList:  generateMembers({ roleCode: 'MENU_PLAN', count: 4, baseDate: '05 Jan 2025', baseAssigner: 'GM/Admin' }),
    status:      'Active',
    isSystem:    true,
    createdBy:   'System',
    createdAt:   '05 Jan 2025',
    modifiedBy:  'GM/Admin',
    updatedAt:   '18 Mar 2026',
    auditLog: [
      seedAudit('Created', 'System', '05 Jan 2025, 09:30 AM'),
    ],
  },
  {
    id:          nextRoleId(),                     // ROL-003
    name:        'Production',
    code:        'PRODUCTION',
    description: 'Runs kitchen production — BOMs, production orders, entries and reports; hands off to QC.',
    permissions: 0,
    members:     28,
    memberList:  generateMembers({ roleCode: 'PRODUCTION', count: 28, baseDate: '05 Jan 2025', baseAssigner: 'GM/Admin' }),
    status:      'Active',
    isSystem:    true,
    createdBy:   'System',
    createdAt:   '05 Jan 2025',
    modifiedBy:  'GM/Admin',
    updatedAt:   '02 Apr 2026',
    auditLog: [
      seedAudit('Created', 'System', '05 Jan 2025, 09:30 AM'),
      seedAudit('Updated', 'GM/Admin', '02 Apr 2026, 02:30 PM', 'Granted access to the new Production Entry page.'),
    ],
  },
  {
    id:          nextRoleId(),                     // ROL-004
    name:        'Packaging & Dispatch',
    code:        'DISPATCH',
    description: 'Packs finished meals, manages loading, vehicle temperature checks and dispatch monitoring.',
    permissions: 0,
    members:     16,
    memberList:  generateMembers({ roleCode: 'DISPATCH', count: 16, baseDate: '05 Jan 2025', baseAssigner: 'GM/Admin' }),
    status:      'Active',
    isSystem:    true,
    createdBy:   'System',
    createdAt:   '05 Jan 2025',
    modifiedBy:  'GM/Admin',
    updatedAt:   '22 Mar 2026',
    auditLog: [
      seedAudit('Created', 'System', '05 Jan 2025, 09:30 AM'),
    ],
  },
  {
    id:          nextRoleId(),                     // ROL-005
    name:        'Store & Inventory',
    code:        'STORE_INV',
    description: 'Owns stock — item issue, demand fulfilment, transfers, stock adjustments and inventory levels.',
    permissions: 0,
    members:     12,
    memberList:  generateMembers({ roleCode: 'STORE_INV', count: 12, baseDate: '05 Jan 2025', baseAssigner: 'GM/Admin' }),
    status:      'Active',
    isSystem:    true,
    createdBy:   'System',
    createdAt:   '05 Jan 2025',
    modifiedBy:  'GM/Admin',
    updatedAt:   '28 Mar 2026',
    auditLog: [
      seedAudit('Created', 'System', '05 Jan 2025, 09:30 AM'),
    ],
  },
  {
    id:          nextRoleId(),                     // ROL-006
    name:        'Procurement & Supply Chain',
    code:        'PROCUREMENT',
    description: 'Handles requisitions, RFQs, quotations, comparative statements and purchase orders. Extends Store & Inventory.',
    parentRoleId: 'ROL-005',
    permissions: 0,
    members:     7,
    memberList:  generateMembers({ roleCode: 'PROCUREMENT', count: 7, baseDate: '08 Jan 2025', baseAssigner: 'GM/Admin' }),
    status:      'Active',
    isSystem:    true,
    createdBy:   'System',
    createdAt:   '08 Jan 2025',
    modifiedBy:  'GM/Admin',
    updatedAt:   '01 May 2026',
    auditLog: [
      seedAudit('Created', 'System', '08 Jan 2025, 10:00 AM'),
      seedAudit('Updated', 'GM/Admin', '01 May 2026, 11:05 AM', 'Set inheritance from Store & Inventory.', [
        { field: 'parentRoleId', from: '—', to: 'ROL-005' },
      ]),
    ],
  },
  {
    id:          nextRoleId(),                     // ROL-007
    name:        'Food Safety & QC',
    code:        'QC',
    description: 'Runs hygiene monitoring, cooking-temperature/sensory checks and dispatch food-safety sign-off.',
    permissions: 0,
    members:     9,
    memberList:  generateMembers({ roleCode: 'QC', count: 9, baseDate: '05 Jan 2025', baseAssigner: 'GM/Admin' }),
    status:      'Active',
    isSystem:    true,
    createdBy:   'System',
    createdAt:   '05 Jan 2025',
    modifiedBy:  'GM/Admin',
    updatedAt:   '17 Apr 2026',
    auditLog: [
      seedAudit('Created', 'System', '05 Jan 2025, 09:30 AM'),
    ],
  },
  {
    id:          nextRoleId(),                     // ROL-008
    name:        'Maintenance & Asset',
    code:        'MAINTENANCE',
    description: 'Manages airline equipment and kitchen assets — registration, maintenance, returns and damage reports.',
    permissions: 0,
    members:     6,
    memberList:  generateMembers({ roleCode: 'MAINTENANCE', count: 6, baseDate: '10 Jan 2025', baseAssigner: 'GM/Admin' }),
    status:      'Active',
    isSystem:    true,
    createdBy:   'System',
    createdAt:   '10 Jan 2025',
    modifiedBy:  'GM/Admin',
    updatedAt:   '11 Feb 2026',
    auditLog: [
      seedAudit('Created', 'System', '10 Jan 2025, 11:00 AM'),
    ],
  },
  {
    id:          nextRoleId(),                     // ROL-009
    name:        'Reports & Analytics',
    code:        'REPORTS',
    description: 'Read-only access to dashboards, reports, accounts and the audit trail for management reporting.',
    permissions: 0,
    members:     3,
    memberList:  generateMembers({ roleCode: 'REPORTS', count: 3, baseDate: '12 Jan 2025', baseAssigner: 'GM/Admin' }),
    status:      'Active',
    isSystem:    true,
    createdBy:   'System',
    createdAt:   '12 Jan 2025',
    modifiedBy:  'GM/Admin',
    updatedAt:   '06 May 2026',
    auditLog: [
      seedAudit('Created', 'System', '12 Jan 2025, 12:00 PM'),
    ],
  },
];
