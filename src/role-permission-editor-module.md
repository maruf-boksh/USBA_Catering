# Advanced Role Permission Editor — Module Porting Guide

> Route: `/system-admin/role-permission-editor`
> Purpose: component-level (page → tiles → filters → columns → row-actions) permission
> management per role, with per-permission data **scope** (own/team/dept/branch/org),
> role **inheritance**, a **draft → publish** workflow, a live **UI preview**, a role
> **compare** diff, a **permission inspector**, and a compliance **audit trail**.

This document is a self-contained spec so you can rebuild the module in another project.
It describes every file, the data model, the runtime enforcement layer, and the wiring.

> **Companion module — Role Setup** (`/system-admin/role-setup`) is documented in §7A.
> Role Setup owns role **identity/CRUD** (name, code, description, status, inheritance,
> members, audit); the Permission Editor owns the **grants** on those roles. Port both if
> you want the full system — the Permission Editor imports its role list from Role Setup.

---

## 1. Tech stack / dependencies

| Concern | Library | Notes |
|---|---|---|
| UI | React 18 + TypeScript | function components + hooks |
| Component kit | Ant Design v5 (`antd`) + `@ant-design/icons` | `Modal`, `Select`, `Switch`, `Table`(hand-rolled), `Progress`, `Tag`, `Tooltip`, `message`, `Dropdown` |
| State | **Zustand v5** (`create`) | two stores: grants + audit |
| Dates | `dayjs` (+ `customParseFormat` plugin) | audit date-range filter / export |
| Routing | React Router v6 | one lazy route |
| Exports | `xlsx`, `jspdf`+`jspdf-autotable`, `docx` (or your equivalents) | audit export to Excel/PDF/Word — optional |
| Path alias | `@/` → `./src/` | all imports below use it |

No Redux, no Tailwind. Styling is inline styles + CSS custom properties
(`var(--color-primary)`, `var(--color-text-primary)`, etc.). If your target project
doesn't have those tokens, either define them or replace with literal hex.

---

## 2. File inventory

```
src/features/system-admin/role-permission-editor/
├── pages/
│   └── RolePermissionEditorPage.tsx      # THE screen — list view + deep editor + all modals (~3.6k lines)
├── types/
│   ├── permissions.types.ts              # domain model: Permission, Grant, Scope, Section, Audit
│   └── permissionKeys.ts                 # tenant-wide PermissionKey union (typo-safe <Can/>)
├── data/
│   ├── catalog.ts                        # PERMISSION_CATALOG — wires per-page permission files into a tree
│   └── initialGrants.ts                  # seed grants per role + seed audit log
├── hooks/
│   ├── usePermission.tsx                 # ENFORCEMENT: usePermission(key), usePermissions(), <Can/>
│   └── previewRegistry.tsx               # pluggable preview component registry
├── utils/
│   ├── resolveGrants.ts                  # inheritance resolver (walk parent chain)
│   └── exportPermissionAudit.ts          # audit → xlsx / pdf / docx
└── components/
    └── ActingAsBar.tsx                   # "acting as <role>" banner for consumer pages

src/stores/
├── permissionsStore.ts                   # live vs draft grants + currentRoleId (acting role)
└── permissionAuditStore.ts               # persistent audit log (survives navigation)

# Co-located with each consumer page (the contract between page UI and editor):
src/features/<area>/<page>/
├── permissions.ts                        # <PAGE>_PERMISSIONS (Permission[]) + <PAGE>_PRESETS
└── permissions.preview.tsx               # optional: registers a live preview component
```

**External dependency:** the module reads roles from
`@/features/system-admin/role-setup/types/roleSetup.types` → `INITIAL_ROLES: Role[]`.
You must provide a role list with at least this shape (see §7).

---

## 3. Domain model (`types/permissions.types.ts`)

Copy this file verbatim — it is the contract everything else depends on.

### Scope (data visibility, hierarchical, least → most permissive)
```ts
type PermissionScope = 'own' | 'team' | 'department' | 'branch' | 'organization';
SCOPE_ORDER   = ['own','team','department','branch','organization'];
SCOPE_LABELS  = { own:'Own', team:'Team', department:'Department', branch:'Branch', organization:'Organization' };
SCOPE_DESCRIPTIONS = { own:'Only records the user owns…', … };
SCOPE_STYLE   = { own:{color,bg,rank}, … };   // presentation only
```

### Section (groups permissions inside a submodule — mirrors page anatomy)
```ts
type PermissionSection =
  | 'page'          // the master access gate (exactly one per submodule)
  | 'tiles'         // metric / KPI tiles
  | 'filters'       // search, filter drawer, status tabs
  | 'columns'       // table column visibility
  | 'row_actions'   // per-row dropdown actions
  | 'page_actions'  // top-of-page CTA buttons
  | 'forms'         // form section visibility
  | 'modals';       // modal-level visibility
SECTION_LABELS, SECTION_ORDER   // render order
```

### Permission (one grantable unit, authored in the co-located `permissions.ts`)
```ts
interface Permission {
  key:               string;          // stable dot-id: '<module>.<submodule>.<section>.<name>'
  displayName:       string;
  module:            string;
  submodule:         string;
  section:           PermissionSection;
  scopeable:         boolean;         // if true → shows a scope <Select> when granted
  destructive:       boolean;         // deletes/irreversible → red styling
  required:          boolean;         // cannot be revoked while page access is on
  sensitive:         boolean;         // PII / salary / comp → confirm-modal before granting
  defaultScope:      PermissionScope | null;
  impactDescription: string;          // shown in the row + tooltip
  apiEndpoint:       string | null;   // documentation of what it gates on the backend
  requires?:         readonly string[]; // prerequisite keys (e.g. edit requires view)
}
```

### Preset (one-click bundles)
```ts
interface PermissionPreset {
  key: string; label: string; description: string;
  tone?: 'neutral'|'info'|'success'|'warning'|'danger';
  scope?: PermissionScope;                          // default scope for scopeables in `include`
  include?: string[];                               // keys to grant. undefined = grant ALL, [] = revoke ALL
  scopeOverrides?: Partial<Record<string, PermissionScope>>; // per-key scope, wins over `scope`
}
```

### Catalog tree nodes
```ts
interface SubmoduleNode { key; module; label; description?; permissions: readonly Permission[]; presets?; pending?: boolean; }
interface ModuleNode    { key; label; iconKey: string; submodules: SubmoduleNode[]; }
```
`pending: true` → not authored yet; editor shows a "not catalogued" banner.

### Grant + maps (what a role actually has)
```ts
interface PermissionGrant     { granted: boolean; scope?: PermissionScope; }
type RolePermissionMap        = Record<string /*permKey*/, PermissionGrant>;
type RolePermissionsByRole    = Record<string /*roleId*/, RolePermissionMap>;
```

### Audit
```ts
type PermissionAuditAction =
  | 'permission.granted' | 'permission.revoked' | 'permission.scope_changed'
  | 'role.draft_saved' | 'role.draft_published' | 'role.draft_discarded'
  | 'role.preset_applied' | 'role.copied_from' | 'role.scopes_reset' | 'role.reviewed';

interface PermissionAuditEntry {
  id; roleId; action: PermissionAuditAction; actor; timestamp;
  permissionKey?; fromScope?; toScope?; note?;
}
nextPermAuditId()   // → 'PRM-000001' counter
formatTimestamp(d)  // → '07 Jul 2026, 03:42 PM'
```

---

## 4. State stores (Zustand)

### `permissionsStore.ts` — the two-tier grant model (the heart of the system)

```
liveGrantsByRole   → what consumer pages ENFORCE. Changes only on Publish.
draftGrantsByRole  → work-in-progress per role. Editor Save writes here. Missing = no draft.
currentRoleId      → which role the user is "acting as" (drives every <Can/> on consumer pages)
```
Actions: `saveDraft(roleId, map)`, `publishDraft(roleId)` (draft→live, clears draft),
`discardDraft(roleId)`, `getEffectiveGrants(roleId)` (draft ?? live), `hasUnpublishedDraft(roleId)`,
`setCurrentRoleId(roleId)`. Seeds from `INITIAL_ROLE_PERMISSIONS` (deep-cloned).

> **Why two tiers:** permission changes are security-sensitive. Admins edit a draft, review
> the diff, then explicitly publish. Nothing a consumer sees changes until publish.

### `permissionAuditStore.ts` — persistent trail

`entries: PermissionAuditEntry[]`, `push(entry)`, `forRole(roleId)`. Lives in a store (not
component state) so the log survives navigation between list and editor. Seeds from
`INITIAL_PERMISSION_AUDIT`. In production, `push` becomes an API call and the array becomes a query.

---

## 5. Inheritance resolver (`utils/resolveGrants.ts`)

Roles can have `parentRoleId`. Effective grants = **union of the whole ancestor chain +
the role's own**, with the closest role winning on key collision (scope included).

- `resolveGrantsForRole(roleId, grantsByRole, rolesById?) → ResolvedRoleMap`
  Walks root→child so children overwrite ancestors. Cycle-guarded via a `seen` set.
  Each `ResolvedGrant` carries `fromRoleId` (`null` = this role's own direct grant).
- `flattenResolved(resolved) → RolePermissionMap` — drops provenance; used by the consumer hook.
- `resolveAncestorGrants(roleId, …)` — ancestors ONLY (editor draws "inherited" overlays with it).

`ROLES_BY_ID` is built once from `INITIAL_ROLES`.

---

## 6. Enforcement layer (`hooks/usePermission.tsx`) — how pages consume permissions

This is what you sprinkle across the app so the UI reacts to grants.

```tsx
const { granted, scope } = usePermission('recruitment.job_posting.row_actions.edit');
const map = usePermissions(['a.key', 'b.key'] as const);   // → Record<key, {granted,scope}>
const role = useCurrentRole();                              // acting Role | null

<Can permission="recruitment.job_posting.page_actions.create" fallback={null}>
  <Button>Create New Job Post</Button>
</Can>
```

- Internally reads **live** grants for `currentRoleId`, resolves inheritance, flattens.
- `key` is typed as `PermissionKey` — a **typo or un-catalogued key is a compile error**.
- Consumer pages NEVER see the editor's draft — only published/live state.
- Swap-to-backend: change only `useRoleGrants()` to a `useQuery(['/api/me/perms'])`; every
  `usePermission` / `<Can>` caller keeps working.

---

## 7. Role dependency (`role-setup/types/roleSetup.types.ts`)

The editor needs a role list. Minimum shape it actually reads:

```ts
interface Role {
  id: string; name: string; code: string; description: string;
  members: number;            // shown in list "Members" column
  isSystem: boolean;          // "System" tag
  parentRoleId?: string;      // drives inheritance (§5)
  // …the full type also has permissions, memberList, status, audit fields, timestamps
}
export const INITIAL_ROLES: Role[] = [ /* seed roles */ ];
```
If you already have a roles source, adapt `INITIAL_ROLES` imports (in `permissionsStore.ts`,
`usePermission.tsx`, `resolveGrants.ts`, `initialGrants.ts`, and the page) to point at it.

---

## 7A. Companion module — Role Setup (`/system-admin/role-setup`)

The **source of roles** for the whole permission system. Role Setup is the CRUD screen for
role identity; the Permission Editor (everything above) manages the *grants* on those roles.
They share one `Role` type and one `INITIAL_ROLES` list.

> Division of responsibility: **Role Setup = who the roles are** (name, code, description,
> status, parent/inheritance, members, audit). **Permission Editor = what each role can do**
> (component-level grants + scope). Role Setup is intentionally read-only on permissions —
> it just shows a `permissions` count and links out to the editor.

### Files
```
src/features/system-admin/role-setup/
├── pages/RoleSetupPage.tsx          # the screen — table + create/edit/view/audit/members modals
├── types/roleSetup.types.ts         # Role, RoleMember, AuditEntry + INITIAL_ROLES seed + helpers
└── utils/exportAudit.ts             # per-role audit trail → Excel / PDF / Word
```
`roleSetup.types.ts` is the canonical home of the `Role` type and `INITIAL_ROLES` that
`permissionsStore.ts`, `usePermission.tsx`, `resolveGrants.ts`, `initialGrants.ts`, and the
Permission Editor page all import. **Port this file first** — it is the shared dependency.

### Data model (`types/roleSetup.types.ts`)
```ts
type RoleStatus = 'Active' | 'Inactive';
type AuditAction = 'Created' | 'Updated' | 'Activated' | 'Deactivated';

interface AuditChange { field: string; from: string; to: string; }
interface AuditEntry  { id; action: AuditAction; actor; timestamp; changes?: AuditChange[]; note?; }

interface RoleMember {
  id: string;           // 'EMP-1042'
  name; email; designation; section; department;
  assignedAt: string; assignedBy: string;
}

interface Role {
  id: string;           // 'ROL-001' via nextRoleId()
  name; code; description;
  permissions: number;  // display count only — real grants live in the Permission Editor
  members: number;      // total tagged (may exceed memberList length)
  memberList: RoleMember[];
  status: RoleStatus;
  isSystem: boolean;    // system roles get a lock badge; guard against edit/deactivate if you want
  parentRoleId?: string;// drives inheritance in the Permission Editor (§5)
  createdBy; createdAt; modifiedBy; updatedAt;
  auditLog: AuditEntry[];
}
```
Presentation maps: `STATUS_STYLE`, `AUDIT_STYLE`, `STATUS_OPTIONS`.
Helpers: `nextRoleId()` → `ROL-001`, `nextAuditId()` → `AUD-00001`, `formatTimestamp()`,
`formatDate()`. `INITIAL_ROLES` seeds 8 roles (Super Administrator, HR Administrator,
Department Manager, Recruiter, Payroll Officer, Employee, Training Coordinator, Auditor),
several with `parentRoleId` set so inheritance has something to resolve, each with a
generated `memberList` and seeded `auditLog`.

> **Inheritance note:** `parentRoleId` is authored here but *consumed* by the Permission
> Editor's resolver (§5). Setting it in Role Setup is how you build the role hierarchy;
> the effective-grant union happens at read time in `usePermission`.

### Page behavior (`RoleSetupPage.tsx`)
State: `roles` held in local `useState(INITIAL_ROLES)` (this screen mutates its own list;
it does **not** use a Zustand store — only the Permission Editor's *grants* are stored).
`CURRENT_USER` is the hardcoded audit actor — replace with your auth user.

- **Filter bar** — draft/applied pattern (`draft` vs `applied` `RoleFilters = {search, status}`),
  Apply/Reset. Search matches name / code / id.
- **Status tabs** — All / Active / Inactive with live counts.
- **Table** (antd `Table<Role>`) — SL, Role (name + code + System lock badge + description),
  Permissions count (links to editor), Members (count → opens members modal), Status pill,
  Last modified, and a `⋯` actions `Dropdown`: View, Edit, Audit Trail, Activate/Deactivate.
- **Create modal** — `RoleForm {name, code, description, isActive}` with `validateCreate()`
  (name/code required, unique code). Code is auto-uppercased + spaces→`_`. Seeds an audit
  `Created` entry (plus `Deactivated` if created inactive).
- **Edit modal** — same form; `diffRoleFields()` produces `AuditChange[]`, and status flips add
  an `Activated`/`Deactivated` entry. "No changes to save" short-circuits.
- **View modal** — read-only role detail.
- **Activate/Deactivate** — confirm modal (`toggleTarget`); appends the audit entry.
- **Audit modal** — full `auditLog` timeline styled via `AUDIT_STYLE`; export to Excel/PDF/Word
  via `utils/exportAudit.ts`. `liveAuditTarget` re-reads the role by id so the trail stays
  fresh after edits.
- **Members modal** — searchable `memberList` (name/id/email/designation/section/department),
  shows "N of total" when the sampled list is capped.

All modals reuse a shared `ModalHeader` presentational component (also used by the Permission
Editor). Row mutations rebuild the role immutably and append audit entries — mirror this if you
swap to a backend (each becomes a `PATCH` + audit insert).

### Export util (`utils/exportAudit.ts`)
`exportAuditExcel(role)`, `exportAuditPdf(role)`, `exportAuditWord(role)`.
- Excel → `xlsx-js-style` workbook (lazy-loaded ~600 KB on first click, then cached).
- PDF → opens a print-styled window; user picks "Save as PDF".
- Word → HTML wrapped in MS-Word headers, downloaded as `.doc`.
Helpers: `changesToText(entry)`, `safeFilename(role)` (`audit-trail_<code>_<date>`),
`downloadBlob(blob, name)`. Optional — stub the three functions if you don't need exports.

### Wiring (`App.tsx`)
```tsx
const RoleSetupPage = lazy(() => import('@/features/system-admin/role-setup/pages/RoleSetupPage'));
// …
<Route path="/system-admin/role-setup" element={<RoleSetupPage />} />
```
Add a "Role Setup" nav item under System Administration (in this repo:
`src/layouts/AppLayout/navConfig.tsx`), typically **above** "Role Permission Editor".

### Port order for Role Setup
1. `types/roleSetup.types.ts` (the `Role` type + `INITIAL_ROLES` — needed by the Permission Editor too)
2. `utils/exportAudit.ts` (or stub the three export fns)
3. `pages/RoleSetupPage.tsx`
4. Route + nav wiring

---

## 8. The catalog — how per-page permissions are wired (`data/catalog.ts`)

**Permissions live next to the page they describe**, not in one giant file. Each consumer
page ships a `permissions.ts` exporting `<PAGE>_PERMISSIONS` and `<PAGE>_PRESETS`. `catalog.ts`
imports them and assembles `PERMISSION_CATALOG: ModuleNode[]`, mirroring the app's nav tree.

```ts
attachPresets({
  key: 'job_posting', module: 'recruitment', label: 'Job Posting',
  description: '…',
  permissions: JOB_POSTING_PERMISSIONS,
}, JOB_POSTING_PRESETS)
```
Un-authored submodules are stubs: `{ key, module, label, permissions: [], pending: true }`.

Helpers: `findSubmodule(moduleKey, submoduleKey)`, `allCatalogedPermissions()`.

`catalog.ts` also does **side-effect imports** of each `permissions.preview.tsx` so previews
self-register at load time (see §10).

### Authoring a page's `permissions.ts` (the repeatable pattern)
See `src/features/recruitment/job-postings/permissions.ts` as the reference (29 perms:
1 page · 4 tiles · 8 filters · 4 columns · 10 row_actions · 2 page_actions). Rules:

1. `const M = '<module>'; const S = '<submodule>';` to DRY the key prefix.
2. Author the array `... as const satisfies readonly Permission[]` — the `as const` preserves
   literal key types so the union below is exact.
3. Export the key union: `export type JobPostingPermissionKey = typeof JOB_POSTING_PERMISSIONS[number]['key'];`
4. Add that type to the `PermissionKey` union in `types/permissionKeys.ts`.
5. Author presets (`No Access` = `include:[]`, `Full Admin` = omit `include` + `scope:'organization'`).
6. Register the submodule in `catalog.ts`.
7. (Optional) add `permissions.preview.tsx` and a side-effect import in `catalog.ts`.

`permissionKeys.ts`:
```ts
export type PermissionKey =
  | JobPostingPermissionKey
  | CandidateTrackingPermissionKey
  | …;   // add each page's key type here
```

---

## 9. Seed data (`data/initialGrants.ts`)

Exports `INITIAL_ROLE_PERMISSIONS: RolePermissionsByRole` (per-role starter grants) and
`INITIAL_PERMISSION_AUDIT: PermissionAuditEntry[]`. Uses helpers like `grantSet({source, scope,
exclude, override})` and `readOnlyOf(source, scope)` to build role baselines from the catalogued
permission arrays. Replace with your own defaults (or empty `{}`) per role.

---

## 10. Preview registry (`hooks/previewRegistry.tsx`)

Lets the editor render a faithful mock of the real page, gated by the role's effective grants,
so admins see exactly what the role would see.

```ts
registerPreview(moduleKey, submoduleKey, Component);   // page-side, at module load
getPreview(moduleKey, submoduleKey);                   // editor-side lookup, null if none
listRegisteredPreviews();                              // diagnostics
```
Preview components receive `{ grants: RolePermissionMap }` (already inheritance-resolved) and
conditionally render sections based on `grants[key]?.granted`. Register in a
`permissions.preview.tsx` next to the page, and add a side-effect `import` of it in `catalog.ts`.

---

## 11. The editor page (`pages/RolePermissionEditorPage.tsx`)

One large component with two `viewMode`s. Key behaviors to reproduce:

### List view (`viewMode === 'list'`)
- Page header + `Assign Role Permission` / `Permission Inspector` buttons.
- Filter bar (draft/applied search pattern) + status pills (All / With Grants / No Grants).
- **Pending drafts panel** (amber) — every role with an unpublished draft, with per-role
  +granted / −revoked / ↻scope counts and Publish/Discard (single + "all").
- Roles table: avatar (initials), System / DRAFT-PENDING tags, coverage `Progress` bar
  (`granted / totalCatalogued`), members, last-modified (from audit), and row actions
  **View (read-only)** / **Edit Permissions** / **Audit**.
- Counts in the list use **live** grants (what consumers enforce).

### Editor view (`viewMode === 'editor'`)
Three-pane layout:
1. **Module/submodule tree** (left) — searchable, per-submodule grant count badge.
2. **Permission table** (center) — grouped by `SECTION_ORDER`. Each row: grant `Switch`,
   scope `Select` (only when `scopeable && granted`), sensitive/destructive/required badges,
   impact text, API endpoint. Filters: search, "only granted", "only changed". Section-level
   bulk **grant/revoke** + bulk **set scope**. Per-submodule preset chips, copy-from-role,
   reset-scopes-to-default.
3. **Coverage + live preview** (right) — `subCoverage` %, role totals (granted/scopeable/
   destructive/sensitive), toggleable live preview via the registry.

### Interception rules on single-row grant (`setGrant`)
1. **Prerequisites** — if `requires` keys aren't granted, prompt to grant them too.
2. **Sensitive** — if `sensitive`, open a confirm modal before granting.
   Bulk actions (presets, grant-all, copy) **bypass** both but emit a consolidated
   "granted N sensitive permissions" warning toast afterward.
- `required` permissions can't be revoked (warn toast).
- Every mutation calls `pushAudit(...)`.

### Save / publish lifecycle
- `handleSave` → `saveDraft` + audit `role.draft_saved` (no consumer impact).
- `handlePublish` → `saveDraft` then `publishDraft` + audit `role.draft_published` (goes live).
- `handleDiscardDraft` → `discardDraft`, revert editor to live + audit `role.draft_discarded`.
- `handleReset` → revert working state to last in-session saved snapshot.
- `isDirty` compares working map vs saved snapshot; `hasDraft` / `draftDiffersFromLive` drive the publish bar.

### Modals / sub-features (all in this file)
- **Audit Trail** modal — filter by date range (dayjs), export Excel/PDF/Word.
- **Compare** drawer — diff two roles permission-by-permission.
- **Permission Inspector** — search a permission, see which roles effectively have it
  (uses `resolveGrantsForRole`, so it counts inherited grants, not just direct).
- **Assign Role Permission** modal, **Copy from role** modal, **Sensitive** + **Prerequisite** gates.
- `editorReadOnly` guards every mutator (View mode opens read-only).

`CURRENT_USER` is a hardcoded actor string for audit entries — replace with your auth user.

---

## 12. Wiring into a new app

1. **Route** (`App.tsx`), lazy-loaded:
   ```tsx
   const RolePermissionEditorPage = lazy(() =>
     import('@/features/system-admin/role-permission-editor/pages/RolePermissionEditorPage'));
   // …
   <Route path="/system-admin/role-permission-editor" element={<RolePermissionEditorPage />} />
   ```
2. **Nav** — add a "Role Permission Editor" item under your System Administration group
   (in this repo: `src/layouts/AppLayout/navConfig.tsx`).
3. **Roles source** — provide `INITIAL_ROLES` (§7) or repoint the imports.
4. **Design tokens** — ensure the `--color-*` CSS custom properties exist, or replace with hex.
5. **Seed grants/audit** — adjust `initialGrants.ts` (or start empty).
6. **Consume it** — on real pages, gate UI with `<Can permission="…">` / `usePermission('…')`
   and set the acting role via `usePermissionsStore().setCurrentRoleId(...)` (optionally a
   `<ActingAsBar/>` banner). Add each page's key type to `PermissionKey`.

---

## 13. Copy order (dependency-safe)

Port files in this order so each compiles against what's already there:

1. `types/permissions.types.ts`
2. Role type + `INITIAL_ROLES` (from role-setup, or your own)
3. One page `permissions.ts` (e.g. job-postings) → then `types/permissionKeys.ts`
4. `data/catalog.ts` + `data/initialGrants.ts`
5. `utils/resolveGrants.ts`
6. `stores/permissionsStore.ts` + `stores/permissionAuditStore.ts`
7. `hooks/previewRegistry.tsx` + `hooks/usePermission.tsx`
8. `utils/exportPermissionAudit.ts` (or stub the three export fns)
9. `components/ActingAsBar.tsx`
10. `pages/RolePermissionEditorPage.tsx`
11. Route + nav wiring

---

## 14. Mental model (one paragraph)

Every page is decomposed into grantable **permissions** grouped by **section**, authored in a
`permissions.ts` next to the page and wired into `PERMISSION_CATALOG`. A **role** holds a
`RolePermissionMap`; roles inherit from `parentRoleId`. The editor mutates a **draft**, and
**publishing** promotes it to **live**. Consumer pages read live grants for the **acting role**
through `usePermission` / `<Can>`, which resolves inheritance under the hood. Every change is
recorded in an **audit store**, and a **preview registry** lets admins see the resulting page
before publishing. Keys are a typed union, so gating UI is typo-proof at compile time.
