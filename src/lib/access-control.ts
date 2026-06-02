import { useSyncExternalStore } from "react";
import { BUILTIN_ROLES, useRole, type Role } from "./roles";
import { NAV_MODULES, type NavModule, type NavSubItem } from "@/layouts/AppLayout/navConfig";

// ─────────────────────────────────────────────────────────────────────────────
// User Access Control (RBAC) — dynamic roles + per-resource CRUD permissions.
//
//  • Roles: a fully editable list seeded from the built-in roles — every role
//    except GM/Admin can be created, renamed or deleted at runtime.
//  • Resources form a tree derived from the live nav: Module → Page → Element.
//      - Module id:  "mod:<moduleKey>"          (e.g. "mod:operations")
//      - Page id:    "<route>"                  (e.g. "/order-management")
//      - Element id: "<route>#<elementId>"      (e.g. "/order-management#action-create")
//    Elements (KPI cards, table columns, action buttons …) are declared in
//    PAGE_ELEMENTS and can be extended page-by-page — the matrix grows
//    automatically.
//  • Actions: view / create / edit / delete — granted per role per resource.
//      - "view" on a page == nav visibility.
//      - Element checks fall back to their page's permission when no explicit
//        element rule is set, so granting page access reveals its elements by
//        default; admins then restrict individual elements as needed.
//  • GM/Admin always has every permission and cannot be restricted.
//
// Persisted: perms → localStorage["harvest-rbac-v2"], role list →
// localStorage["harvest-roles-v2"] (migrated from the legacy "harvest-roles-v1").
// ─────────────────────────────────────────────────────────────────────────────

export const ADMIN_ROLE: Role = "GM/Admin";

export const ACTIONS = ["view", "create", "edit", "delete"] as const;
export type Action = (typeof ACTIONS)[number];

/** Pages always visible so no role is ever stranded with an empty app. */
export const ALWAYS_ON_PAGES = new Set<string>(["/"]);

// ── Resource registry ────────────────────────────────────────────────────────

export type ElementKind = "kpi" | "column" | "action" | "section";
export type RbacElement = { id: string; label: string; kind: ElementKind };
export type RbacPage = { key: string; label: string; elements: RbacElement[] };
export type RbacModule = { key: string; label: string; pages: RbacPage[] };

/**
 * Per-page manageable elements (KPI cards, columns, actions …). Seeded for a
 * few pages and **extended dynamically at runtime**: shared components such as
 * DataTable register their columns here on mount (see registerElements), and
 * report datasets register their columns at import — so the access matrix grows
 * automatically and covers every page, with no manual enumeration.
 */
const SEED_ELEMENTS: Record<string, RbacElement[]> = {
  "/": [
    { id: "kpi-flights", label: "Flights Today (KPI)", kind: "kpi" },
    { id: "kpi-meals", label: "Meals Prepared (KPI)", kind: "kpi" },
    { id: "kpi-delayed", label: "Delayed Flights (KPI)", kind: "kpi" },
    { id: "kpi-qc", label: "QC Issues (KPI)", kind: "kpi" },
    { id: "kpi-pos", label: "Pending POs (KPI)", kind: "kpi" },
    { id: "kpi-inv", label: "Inventory Alerts (KPI)", kind: "kpi" },
    { id: "kpi-dispatch", label: "Dispatch Active (KPI)", kind: "kpi" },
    { id: "kpi-cost", label: "Daily Cost (KPI)", kind: "kpi" },
  ],
  "/order-management": [
    { id: "action-create", label: "Create Order (button)", kind: "action" },
    { id: "action-bulk", label: "Bulk Upload (button)", kind: "action" },
    { id: "col:spec-meals", label: "Special Meals column", kind: "column" },
  ],
};

// Mutable, reactive element registry. Keyed by route → elements.
const elementRegistry: Record<string, RbacElement[]> = JSON.parse(JSON.stringify(SEED_ELEMENTS));

export function getPageElements(route: string): RbacElement[] {
  return elementRegistry[route] ?? [];
}

/** Column resource element id from a DataTable/report column key. */
export const columnElementId = (key: string) => `col:${key}`;

/**
 * Register elements for a route (idempotent, additive). Called by DataTable for
 * its columns and by report datasets at import. Only notifies subscribers when
 * something actually changed, so it is safe to call from effects.
 */
export function registerElements(route: string, els: RbacElement[]) {
  const existing = elementRegistry[route] ?? [];
  const byId = new Map(existing.map((e) => [e.id, e]));
  let changed = false;
  for (const el of els) {
    if (!byId.has(el.id)) { byId.set(el.id, el); changed = true; }
  }
  if (!changed) return;
  elementRegistry[route] = Array.from(byId.values());
  notify();
}

function pageLabelMap(): Record<string, string> {
  const map: Record<string, string> = {};
  const walk = (items: NavSubItem[]) => {
    for (const it of items) {
      if (it.children?.length) walk(it.children);
      else if (it.key.startsWith("/")) map[it.key] = it.label;
    }
  };
  NAV_MODULES.forEach((m) => walk(m.children));
  return map;
}
const PAGE_LABELS = pageLabelMap();

function collectLeafKeys(items: NavSubItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.children?.length) out.push(...collectLeafKeys(it.children));
    else if (it.key.startsWith("/")) out.push(it.key);
  }
  return out;
}

/** The module → page tree, derived from the nav. Element lists are read live
 *  from the registry via getPageElements (so runtime-registered columns show). */
export const RBAC_TREE: RbacModule[] = NAV_MODULES.map((m) => ({
  key: m.key,
  label: m.label,
  pages: collectLeafKeys(m.children).map((route) => ({
    key: route,
    label: PAGE_LABELS[route] ?? route,
    elements: [],
  })),
}));

const ALL_PAGE_KEYS = RBAC_TREE.flatMap((m) => m.pages.map((p) => p.key));
export const elementResourceId = (route: string, elementId: string) => `${route}#${elementId}`;

// ── Stores (perms + custom roles) ────────────────────────────────────────────

/** role → resourceId → granted actions. */
export type PermMap = Record<string, Record<string, Action[]>>;

const DEFAULT_MODULES_BY_ROLE: Record<string, string[]> = {
  "GM/Admin": RBAC_TREE.map((m) => m.key),
  "Meal Planner": ["dashboard", "operations"],
  "Production": ["dashboard", "production", "qc"],
  "Packaging & Dispatch": ["dashboard", "dispatch"],
  "Store & Inventory": ["dashboard", "inventory"],
  "Procurement & Supply Chain": ["dashboard", "supply", "inventory"],
  "Food Safety & QC": ["dashboard", "qc"],
  "Maintenance & Asset": ["dashboard", "maintenance", "airline-equipments"],
  "Reports & Analytics": ["dashboard", "reports", "accounts"],
};

/** Build default perms for one role: "view" on every page of its modules. */
function defaultPermsForRole(role: string): Record<string, Action[]> {
  const mods = DEFAULT_MODULES_BY_ROLE[role] ?? ["dashboard"];
  const out: Record<string, Action[]> = {};
  for (const mod of RBAC_TREE) {
    if (!mods.includes(mod.key)) continue;
    for (const page of mod.pages) out[page.key] = ["view"];
  }
  for (const page of ALWAYS_ON_PAGES) out[page] = Array.from(new Set([...(out[page] ?? []), "view"]));
  return out;
}

function buildDefaultPerms(roles: string[]): PermMap {
  const map: PermMap = {};
  for (const role of roles) map[role] = defaultPermsForRole(role);
  return map;
}

const PERMS_KEY = "harvest-rbac-v2";
const ROLES_KEY = "harvest-roles-v2";        // full ordered role list (built-ins are editable/deletable)
const LEGACY_ROLES_KEY = "harvest-roles-v1"; // legacy: custom-only list

/**
 * Load the full ordered list of roles. The list is now fully editable — built-in
 * roles can be renamed or deleted — so we persist the entire list rather than
 * rebuilding it from BUILTIN_ROLES each load. Migrates the legacy custom-only
 * list on first run. GM/Admin is always guaranteed present.
 */
function loadRoles(): string[] {
  const withAdmin = (list: string[]) =>
    Array.from(new Set([ADMIN_ROLE, ...list.filter((r) => r !== ADMIN_ROLE)]));
  if (typeof window === "undefined") return withAdmin([...BUILTIN_ROLES]);
  try {
    const raw = window.localStorage.getItem(ROLES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const list = parsed.filter((r): r is string => typeof r === "string" && r.length > 0);
        if (list.length) return withAdmin(list);
      }
    }
    // Migrate from the legacy custom-only list (built-ins + saved custom roles).
    const legacyRaw = window.localStorage.getItem(LEGACY_ROLES_KEY);
    const legacy = legacyRaw ? (JSON.parse(legacyRaw) as unknown) : [];
    const custom = Array.isArray(legacy)
      ? legacy.filter((r): r is string => typeof r === "string" && !BUILTIN_ROLES.includes(r as never))
      : [];
    return withAdmin([...BUILTIN_ROLES, ...custom]);
  } catch {
    return withAdmin([...BUILTIN_ROLES]);
  }
}

function loadPerms(roles: string[]): PermMap {
  const defaults = buildDefaultPerms(roles);
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(PERMS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as PermMap;
    if (!parsed || typeof parsed !== "object") return defaults;
    const merged: PermMap = {};
    for (const role of roles) merged[role] = parsed[role] ?? defaults[role] ?? {};
    return merged;
  } catch {
    return defaults;
  }
}

let allRoles: string[] = loadRoles();
let perms: PermMap = loadPerms(allRoles);
const listeners = new Set<() => void>();

function notify() { for (const l of listeners) l(); }
function persistPerms() { try { window?.localStorage?.setItem(PERMS_KEY, JSON.stringify(perms)); } catch { /* ignore */ } }
function persistRoles() { try { window?.localStorage?.setItem(ROLES_KEY, JSON.stringify(allRoles)); } catch { /* ignore */ } }

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function getAllRoles(): string[] { return allRoles; }
export function getCustomRoles(): string[] { return allRoles.filter((r) => r !== ADMIN_ROLE && !isBuiltinRole(r)); }
/** True if `role` is one of the original factory roles (informational; built-ins are still editable). */
export function isBuiltinRole(role: string): boolean { return (BUILTIN_ROLES as readonly string[]).includes(role); }
export function getPerms(): PermMap { return perms; }

export function useAllRoles(): string[] {
  return useSyncExternalStore((cb) => subscribe(cb), getAllRoles, getAllRoles);
}
export function useAccess(): PermMap {
  return useSyncExternalStore((cb) => subscribe(cb), getPerms, getPerms);
}

// ── Permission checks ────────────────────────────────────────────────────────

export function can(role: Role, resourceId: string, action: Action, map: PermMap = perms): boolean {
  if (role === ADMIN_ROLE) return true;
  if (action === "view" && ALWAYS_ON_PAGES.has(resourceId)) return true;
  return (map[role]?.[resourceId] ?? []).includes(action);
}

/** Element check with page-level fallback when no explicit element rule exists. */
export function canElement(role: Role, route: string, elementId: string, action: Action = "view", map: PermMap = perms): boolean {
  if (role === ADMIN_ROLE) return true;
  const resId = elementResourceId(route, elementId);
  const explicit = map[role]?.[resId];
  if (explicit) return explicit.includes(action);
  return can(role, route, action, map); // inherit page permission
}

export function canViewPage(role: Role, route: string, map: PermMap = perms): boolean {
  return can(role, route, "view", map);
}

/** Nav tree filtered to pages the role may view. */
export function visibleNavModules(role: Role, map: PermMap = perms): NavModule[] {
  if (role === ADMIN_ROLE) return NAV_MODULES;
  const filterItems = (items: NavSubItem[]): NavSubItem[] =>
    items
      .map((it) => (it.children?.length ? { ...it, children: filterItems(it.children) } : it))
      .filter((it) => (it.children?.length ? it.children.length > 0 : canViewPage(role, it.key, map)));
  return NAV_MODULES.map((mod) => ({ ...mod, children: filterItems(mod.children) })).filter(
    (mod) => mod.children.length > 0,
  );
}

/** Convenience hook: live CRUD flags for a resource (page or element id). */
export function usePermission(resourceId: string): Record<Action, boolean> {
  const { role } = useRole();
  const map = useAccess();
  return {
    view: can(role, resourceId, "view", map),
    create: can(role, resourceId, "create", map),
    edit: can(role, resourceId, "edit", map),
    delete: can(role, resourceId, "delete", map),
  };
}

/** Convenience hook for element-level checks (with page fallback). */
export function useElementPermission(route: string, elementId: string): Record<Action, boolean> {
  const { role } = useRole();
  const map = useAccess();
  return {
    view: canElement(role, route, elementId, "view", map),
    create: canElement(role, route, elementId, "create", map),
    edit: canElement(role, route, elementId, "edit", map),
    delete: canElement(role, route, elementId, "delete", map),
  };
}

// ── Writes ───────────────────────────────────────────────────────────────────

export function setActions(role: string, resourceId: string, actions: Action[]) {
  if (role === ADMIN_ROLE) return; // admin is immutable (always full)
  const next: PermMap = { ...perms, [role]: { ...(perms[role] ?? {}) } };
  if (actions.length === 0) delete next[role][resourceId];
  else next[role][resourceId] = Array.from(new Set(actions));
  perms = next;
  persistPerms();
  notify();
}

export function toggleAction(role: string, resourceId: string, action: Action) {
  if (role === ADMIN_ROLE) return;
  const cur = perms[role]?.[resourceId] ?? [];
  const has = cur.includes(action);
  let next = has ? cur.filter((a) => a !== action) : [...cur, action];
  // Removing "view" removes everything (can't act on what you can't see).
  if (action === "view" && has) next = [];
  // Granting any action implies "view".
  if (!has && action !== "view" && !next.includes("view")) next = [...next, "view"];
  setActions(role, resourceId, next as Action[]);
}

/** Set the same action set on every page in a module (bulk). */
export function setModuleActions(role: string, moduleKey: string, actions: Action[]) {
  if (role === ADMIN_ROLE) return;
  const mod = RBAC_TREE.find((m) => m.key === moduleKey);
  if (!mod) return;
  const next: PermMap = { ...perms, [role]: { ...(perms[role] ?? {}) } };
  for (const page of mod.pages) {
    if (actions.length === 0) delete next[role][page.key];
    else next[role][page.key] = Array.from(new Set(actions));
  }
  perms = next;
  persistPerms();
  notify();
}

export function resetRoleToDefaults(role: string) {
  if (role === ADMIN_ROLE) return;
  perms = { ...perms, [role]: defaultPermsForRole(role) };
  persistPerms();
  notify();
}

export function grantAllPages(role: string, actions: Action[]) {
  if (role === ADMIN_ROLE) return;
  const roleMap: Record<string, Action[]> = {};
  for (const key of ALL_PAGE_KEYS) roleMap[key] = Array.from(new Set(actions));
  perms = { ...perms, [role]: roleMap };
  persistPerms();
  notify();
}

export function clearRole(role: string) {
  if (role === ADMIN_ROLE) return;
  const roleMap: Record<string, Action[]> = {};
  for (const page of ALWAYS_ON_PAGES) roleMap[page] = ["view"];
  perms = { ...perms, [role]: roleMap };
  persistPerms();
  notify();
}

// ── Role CRUD ────────────────────────────────────────────────────────────────

export function createRole(name: string): { ok: boolean; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Role name is required." };
  if (allRoles.some((r) => r.toLowerCase() === trimmed.toLowerCase()))
    return { ok: false, error: "A role with that name already exists." };
  allRoles = [...allRoles, trimmed];
  perms = { ...perms, [trimmed]: { "/": ["view"] } }; // new role: dashboard only
  persistRoles();
  persistPerms();
  notify();
  return { ok: true };
}

export function renameRole(oldName: string, newName: string): { ok: boolean; error?: string } {
  if (oldName === ADMIN_ROLE) return { ok: false, error: "The administrator role cannot be renamed." };
  if (!allRoles.includes(oldName)) return { ok: false, error: "Role not found." };
  const trimmed = newName.trim();
  if (!trimmed) return { ok: false, error: "Role name is required." };
  if (allRoles.some((r) => r.toLowerCase() === trimmed.toLowerCase() && r !== oldName))
    return { ok: false, error: "A role with that name already exists." };
  allRoles = allRoles.map((r) => (r === oldName ? trimmed : r));
  const moved = perms[oldName] ?? {};
  perms = { ...perms, [trimmed]: moved };
  delete perms[oldName];
  persistRoles();
  persistPerms();
  notify();
  return { ok: true };
}

export function deleteRole(name: string): { ok: boolean; error?: string } {
  if (name === ADMIN_ROLE) return { ok: false, error: "The administrator role cannot be deleted." };
  if (!allRoles.includes(name)) return { ok: false, error: "Role not found." };
  allRoles = allRoles.filter((r) => r !== name);
  const next = { ...perms };
  delete next[name];
  perms = next;
  persistRoles();
  persistPerms();
  notify();
  return { ok: true };
}
