import { useMemo, useState, useEffect, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ShieldCheck, ArrowLeft, Search, Save, UploadCloud, Undo2, Trash2, History,
  ChevronRight, ChevronDown, AlertTriangle, ShieldAlert, GitBranch, Copy, RotateCcw,
  Eye, Pencil, FileSpreadsheet, FileText, Download, GitCompare, Crosshair, Lock,
} from "lucide-react";
import { toast } from "sonner";
import { useRolesStore } from "@/stores/rolesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { usePermissionAuditStore } from "@/stores/permissionAuditStore";
import { PERMISSION_CATALOG, findSubmodule, TOTAL_CATALOGED } from "../data/catalog";
import { resolveGrantsForRole, resolveAncestorGrants } from "../utils/resolveGrants";
import {
  exportPermissionAuditExcel, exportPermissionAuditPdf, exportPermissionAuditWord,
} from "../utils/exportPermissionAudit";
import {
  type Permission, type PermissionScope, type PermissionSection, type PermissionPreset,
  type RolePermissionMap, type PermissionAuditAction,
  SCOPE_ORDER, SCOPE_LABELS, SCOPE_STYLE, SECTION_ORDER, SECTION_LABELS,
  nextPermAuditId, formatTimestamp,
} from "../types/permissions.types";
import type { Role } from "@/features/system-admin/role-setup/types/roleSetup.types";

const ACTOR = "GM/Admin";
const clone = (m: RolePermissionMap): RolePermissionMap => JSON.parse(JSON.stringify(m));
const initials = (name: string) => name.split(/[\s/]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

const TONE_CLASS: Record<string, string> = {
  neutral: "border-border text-muted-foreground",
  info: "border-sky-300 text-sky-700 dark:text-sky-300",
  success: "border-emerald-300 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-300 text-amber-700 dark:text-amber-300",
  danger: "border-red-300 text-red-700 dark:text-red-300",
};

export default function RolePermissionEditorPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const roles = useRolesStore(s => s.roles);
  const rolesById = useMemo<Record<string, Role>>(() => Object.fromEntries(roles.map(r => [r.id, r])), [roles]);

  const liveGrantsByRole = usePermissionsStore(s => s.liveGrantsByRole);
  const draftGrantsByRole = usePermissionsStore(s => s.draftGrantsByRole);
  const saveDraft = usePermissionsStore(s => s.saveDraft);
  const publishDraft = usePermissionsStore(s => s.publishDraft);
  const discardDraft = usePermissionsStore(s => s.discardDraft);
  const getEffectiveGrants = usePermissionsStore(s => s.getEffectiveGrants);

  const auditEntries = usePermissionAuditStore(s => s.entries);
  const pushAudit = usePermissionAuditStore(s => s.push);

  const [view, setView] = useState<"list" | "editor">("list");
  const [editRoleId, setEditRoleId] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  const [working, setWorking] = useState<RolePermissionMap>({});
  const [snapshot, setSnapshot] = useState<RolePermissionMap>({});

  // list-view filters
  const [listSearch, setListSearch] = useState("");

  // editor state
  const [openModules, setOpenModules] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<{ mod: string; sub: string } | null>(null);
  const [treeSearch, setTreeSearch] = useState("");
  const [permSearch, setPermSearch] = useState("");
  const [onlyGranted, setOnlyGranted] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);

  // dialogs
  const [sensitiveConfirm, setSensitiveConfirm] = useState<Permission | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [cmpA, setCmpA] = useState("");
  const [cmpB, setCmpB] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorQuery, setInspectorQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  const editRole = editRoleId ? rolesById[editRoleId] : null;

  // Deep-link ?role=<id> opens the editor.
  useEffect(() => {
    const rid = searchParams.get("role");
    if (rid && rolesById[rid]) openEditor(rid, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── helpers ──────────────────────────────────────────────────────────────────
  function grantedCount(map: RolePermissionMap): number {
    return Object.values(map).filter(g => g.granted).length;
  }
  function liveCount(roleId: string): number {
    return grantedCount(resolveGrantsForRole(roleId, liveGrantsByRole, rolesById));
  }

  function openEditor(roleId: string, ro: boolean) {
    const eff = clone(getEffectiveGrants(roleId));
    setEditRoleId(roleId);
    setReadOnly(ro);
    setWorking(eff);
    setSnapshot(clone(eff));
    const first = PERMISSION_CATALOG[0];
    setSel(first ? { mod: first.key, sub: first.submodules[0]?.key ?? "" } : null);
    setOpenModules(new Set(PERMISSION_CATALOG.map(m => m.key)));
    setPermSearch(""); setOnlyGranted(false); setOnlyChanged(false); setTreeSearch("");
    setView("editor");
  }

  function audit(roleId: string, action: PermissionAuditAction, extra: Partial<Parameters<typeof pushAudit>[0]> = {}) {
    pushAudit({ id: nextPermAuditId(), roleId, action, actor: ACTOR, timestamp: formatTimestamp(), ...extra });
  }

  const isDirty = useMemo(() => JSON.stringify(working) !== JSON.stringify(snapshot), [working, snapshot]);
  const hasDraft = editRoleId ? Object.prototype.hasOwnProperty.call(draftGrantsByRole, editRoleId) : false;

  // ── grant mutations ──────────────────────────────────────────────────────────
  function applyGrant(key: string, granted: boolean, perm?: Permission) {
    setWorking(prev => {
      const next = { ...prev };
      if (granted) next[key] = perm?.scopeable ? { granted: true, scope: perm.defaultScope ?? "department" } : { granted: true };
      else delete next[key];
      return next;
    });
  }

  function toggleGrant(perm: Permission, granted: boolean) {
    if (readOnly || !editRoleId) return;
    if (granted && perm.sensitive) { setSensitiveConfirm(perm); return; }
    applyGrant(perm.key, granted, perm);
    audit(editRoleId, granted ? "permission.granted" : "permission.revoked", { permissionKey: perm.key });
  }

  function setScope(perm: Permission, scope: PermissionScope) {
    if (readOnly || !editRoleId) return;
    setWorking(prev => ({ ...prev, [perm.key]: { granted: true, scope } }));
    audit(editRoleId, "permission.scope_changed", { permissionKey: perm.key, toScope: scope });
  }

  function bulkSection(perms: Permission[], granted: boolean) {
    if (readOnly || !editRoleId) return;
    let sensitiveCount = 0;
    setWorking(prev => {
      const next = { ...prev };
      for (const p of perms) {
        if (granted) { next[p.key] = p.scopeable ? { granted: true, scope: p.defaultScope ?? "department" } : { granted: true }; if (p.sensitive) sensitiveCount++; }
        else delete next[p.key];
      }
      return next;
    });
    if (granted && sensitiveCount) toast.warning(`Granted ${sensitiveCount} sensitive permission${sensitiveCount === 1 ? "" : "s"} in bulk.`);
  }

  function bulkScope(perms: Permission[], scope: PermissionScope) {
    if (readOnly || !editRoleId) return;
    setWorking(prev => {
      const next = { ...prev };
      for (const p of perms) if (p.scopeable && next[p.key]?.granted) next[p.key] = { granted: true, scope };
      return next;
    });
  }

  function applyPreset(sub: { permissions: readonly Permission[] }, preset: PermissionPreset) {
    if (readOnly || !editRoleId) return;
    let sensitiveCount = 0;
    setWorking(prev => {
      const next = { ...prev };
      for (const p of sub.permissions) {
        const include = preset.include === undefined ? true : preset.include.includes(p.key);
        if (include) {
          const scope = preset.scopeOverrides?.[p.key] ?? preset.scope ?? p.defaultScope ?? "department";
          next[p.key] = p.scopeable ? { granted: true, scope } : { granted: true };
          if (p.sensitive) sensitiveCount++;
        } else {
          delete next[p.key];
        }
      }
      return next;
    });
    audit(editRoleId, "role.preset_applied", { note: `Applied preset "${preset.label}".` });
    if (sensitiveCount) toast.warning(`Preset granted ${sensitiveCount} sensitive permission${sensitiveCount === 1 ? "" : "s"}.`);
    else toast.success(`Applied "${preset.label}".`);
  }

  function resetScopes() {
    if (readOnly || !editRoleId) return;
    const byKey = new Map(PERMISSION_CATALOG.flatMap(m => m.submodules.flatMap(s => s.permissions.map(p => [p.key, p] as const))));
    setWorking(prev => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        const p = byKey.get(k);
        if (p?.scopeable && next[k].granted) next[k] = { granted: true, scope: p.defaultScope ?? "department" };
      }
      return next;
    });
    audit(editRoleId, "role.scopes_reset", { note: "Reset all scopes to catalog defaults." });
    toast.success("Scopes reset to defaults.");
  }

  function doCopyFrom() {
    if (!editRoleId || !copyFrom) return;
    const src = clone(getEffectiveGrants(copyFrom));
    setWorking(src);
    audit(editRoleId, "role.copied_from", { note: `Copied grants from ${rolesById[copyFrom]?.name}.` });
    setCopyOpen(false);
    toast.success(`Copied grants from ${rolesById[copyFrom]?.name}.`);
  }

  // ── save lifecycle ─────────────────────────────────────────────────────────────
  function handleSave() {
    if (!editRoleId) return;
    saveDraft(editRoleId, working);
    setSnapshot(clone(working));
    audit(editRoleId, "role.draft_saved");
    toast.success("Draft saved. Publish to apply to the app.");
  }
  function handlePublish() {
    if (!editRoleId) return;
    saveDraft(editRoleId, working);
    publishDraft(editRoleId);
    setSnapshot(clone(working));
    audit(editRoleId, "role.draft_published", { note: "Grants published live." });
    toast.success("Published — the app now enforces these grants.");
  }
  function handleDiscard(roleId: string) {
    discardDraft(roleId);
    if (roleId === editRoleId) {
      const live = clone(liveGrantsByRole[roleId] ?? {});
      setWorking(live); setSnapshot(clone(live));
    }
    audit(roleId, "role.draft_discarded");
    toast.message("Draft discarded — reverted to live.");
  }
  function handleReset() {
    setWorking(clone(snapshot));
    toast.message("Reverted to last saved state.");
  }

  // ── list view ────────────────────────────────────────────────────────────────
  const pendingRoles = roles.filter(r => Object.prototype.hasOwnProperty.call(draftGrantsByRole, r.id));
  function draftDiff(roleId: string) {
    const draft = draftGrantsByRole[roleId] ?? {};
    const live = liveGrantsByRole[roleId] ?? {};
    let added = 0, removed = 0, scoped = 0;
    const keys = new Set([...Object.keys(draft), ...Object.keys(live)]);
    for (const k of keys) {
      const d = draft[k]?.granted, l = live[k]?.granted;
      if (d && !l) added++;
      else if (!d && l) removed++;
      else if (d && l && draft[k].scope !== live[k].scope) scoped++;
    }
    return { added, removed, scoped };
  }

  const listFiltered = roles.filter(r => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q);
  });

  // ── editor derived ─────────────────────────────────────────────────────────────
  const currentSub = sel ? findSubmodule(sel.mod, sel.sub) : null;
  const ancestorGrants = editRoleId ? resolveAncestorGrants(editRoleId, liveGrantsByRole, rolesById) : {};
  const baseline = editRoleId ? (liveGrantsByRole[editRoleId] ?? {}) : {};

  function subGrantedCount(subKey: string, modKey: string): number {
    const sub = findSubmodule(modKey, subKey);
    if (!sub) return 0;
    return sub.permissions.filter(p => working[p.key]?.granted).length;
  }

  const roleTotals = useMemo(() => {
    const all = PERMISSION_CATALOG.flatMap(m => m.submodules.flatMap(s => s.permissions));
    const granted = all.filter(p => working[p.key]?.granted);
    return {
      granted: granted.length,
      scopeable: granted.filter(p => p.scopeable).length,
      sensitive: granted.filter(p => p.sensitive).length,
      destructive: granted.filter(p => p.destructive).length,
    };
  }, [working]);

  // permission rows for the selected submodule, grouped by section
  const groupedRows = useMemo(() => {
    if (!currentSub) return [] as { section: PermissionSection; perms: Permission[] }[];
    const q = permSearch.trim().toLowerCase();
    const bySection = new Map<PermissionSection, Permission[]>();
    for (const p of currentSub.permissions) {
      if (q && !p.displayName.toLowerCase().includes(q) && !p.key.toLowerCase().includes(q)) continue;
      if (onlyGranted && !working[p.key]?.granted) continue;
      if (onlyChanged) {
        const now = working[p.key]?.granted ?? false;
        const was = baseline[p.key]?.granted ?? false;
        const scopeChanged = now && was && working[p.key]?.scope !== baseline[p.key]?.scope;
        if (now === was && !scopeChanged) continue;
      }
      const arr = bySection.get(p.section) ?? [];
      arr.push(p); bySection.set(p.section, arr);
    }
    return SECTION_ORDER.filter(s => bySection.has(s)).map(section => ({ section, perms: bySection.get(section)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSub, permSearch, onlyGranted, onlyChanged, working, baseline]);

  // ────────────────────────────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <>
        <PageHeader
          title="Role Permission Editor"
          subtitle="Component-level grants per role — page access, KPIs, columns, form fields, actions and sections — with data scope, inheritance and a draft → publish workflow."
          actions={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setInspectorOpen(true)}><Crosshair className="h-4 w-4 mr-1.5" /> Inspector</Button>
              <Button size="sm" onClick={() => { setPickerSearch(""); setPickerOpen(true); }}><ShieldCheck className="h-4 w-4 mr-1.5" /> Configure a Role</Button>
            </div>
          }
        />

        {pendingRoles.length > 0 && (
          <Card className="mb-4 border-amber-300 bg-amber-50/60 dark:bg-amber-950/20">
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">
                <AlertTriangle className="h-4 w-4" /> {pendingRoles.length} role{pendingRoles.length === 1 ? "" : "s"} with unpublished drafts
              </div>
              <div className="space-y-1.5">
                {pendingRoles.map(r => {
                  const d = draftDiff(r.id);
                  return (
                    <div key={r.id} className="flex items-center justify-between gap-2 flex-wrap text-xs bg-background/60 rounded px-2.5 py-1.5">
                      <span className="font-medium">{r.name}</span>
                      <span className="flex items-center gap-2 ml-auto">
                        <span className="text-emerald-600">+{d.added}</span>
                        <span className="text-red-600">−{d.removed}</span>
                        <span className="text-sky-600">~{d.scoped}</span>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => handleDiscard(r.id)}>Discard</Button>
                        <Button size="sm" className="h-6 px-2 text-xs" onClick={() => { saveDraft(r.id, draftGrantsByRole[r.id] ?? {}); publishDraft(r.id); audit(r.id, "role.draft_published"); toast.success(`Published ${r.name}.`); }}>Publish</Button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Roles · {roles.length}</div>
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={listSearch} onChange={e => setListSearch(e.target.value)} placeholder="Search roles…" className="h-8 pl-8 w-64" />
              </div>
            </div>
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead className="min-w-40">Coverage (live)</TableHead>
                    <TableHead className="text-center">Members</TableHead>
                    <TableHead>Last change</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listFiltered.map(r => {
                    const granted = liveCount(r.id);
                    const pct = TOTAL_CATALOGED ? Math.round((granted / TOTAL_CATALOGED) * 100) : 0;
                    const hasPending = Object.prototype.hasOwnProperty.call(draftGrantsByRole, r.id);
                    const lastAudit = auditEntries.filter(e => e.roleId === r.id).slice(-1)[0];
                    return (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => openEditor(r.id, false)}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span className="h-8 w-8 shrink-0 rounded-full bg-primary/10 text-primary text-xs font-semibold inline-flex items-center justify-center">{initials(r.name)}</span>
                            <div>
                              <div className="font-medium flex items-center gap-1.5">
                                {r.name}
                                {r.isSystem && <Lock className="h-3 w-3 text-muted-foreground" />}
                                {hasPending && <span className="rounded-full border border-amber-300 text-amber-700 dark:text-amber-300 px-1.5 text-[9px] uppercase">Draft</span>}
                              </div>
                              <div className="text-[11px] text-muted-foreground font-mono">{r.code}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={pct} className="h-1.5 w-24" />
                            <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{granted}/{TOTAL_CATALOGED}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{r.members}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{lastAudit?.timestamp ?? "—"}</TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          <div className="inline-flex gap-1 justify-end">
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openEditor(r.id, true)}><Eye className="h-3.5 w-3.5 mr-1" /> View</Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openEditor(r.id, false)}><Pencil className="h-3.5 w-3.5 mr-1" /> Edit</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Role picker — search & select a role to configure */}
        <Dialog open={pickerOpen} onOpenChange={o => !o && setPickerOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Configure a Role</DialogTitle></DialogHeader>
            <div className="relative mb-1">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder="Search a role by name or code…" className="h-9 pl-8" autoFocus />
            </div>
            <div className="max-h-[52vh] overflow-y-auto space-y-1">
              {roles.filter(r => {
                const q = pickerSearch.trim().toLowerCase();
                return !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q);
              }).map(r => {
                const granted = liveCount(r.id);
                const pct = TOTAL_CATALOGED ? Math.round((granted / TOTAL_CATALOGED) * 100) : 0;
                const hasPending = Object.prototype.hasOwnProperty.call(draftGrantsByRole, r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => { setPickerOpen(false); openEditor(r.id, false); }}
                    className="w-full flex items-center gap-3 rounded-md border border-border px-2.5 py-2 text-left hover:border-primary/50 hover:bg-muted/50"
                  >
                    <span className="h-8 w-8 shrink-0 rounded-full bg-primary/10 text-primary text-xs font-semibold inline-flex items-center justify-center">{initials(r.name)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5 font-medium text-sm">
                        {r.name}
                        {r.isSystem && <Lock className="h-3 w-3 text-muted-foreground" />}
                        {hasPending && <span className="rounded-full border border-amber-300 text-amber-700 dark:text-amber-300 px-1.5 text-[9px] uppercase">Draft</span>}
                      </span>
                      <span className="block text-[11px] text-muted-foreground font-mono">{r.code} · {granted}/{TOTAL_CATALOGED} ({pct}%)</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
              {roles.filter(r => { const q = pickerSearch.trim().toLowerCase(); return !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q); }).length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-6">No roles match. Create one in <button className="underline" onClick={() => { setPickerOpen(false); navigate("/config-role-setup"); }}>Role Setup</button>.</div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <CompareDialog open={compareOpen} onClose={() => setCompareOpen(false)} roles={roles} rolesById={rolesById}
          a={cmpA} b={cmpB} setA={setCmpA} setB={setCmpB} liveGrantsByRole={liveGrantsByRole} />
        <InspectorDialog open={inspectorOpen} onClose={() => setInspectorOpen(false)} query={inspectorQuery} setQuery={setInspectorQuery}
          roles={roles} rolesById={rolesById} liveGrantsByRole={liveGrantsByRole} />
      </>
    );
  }

  // ── editor view ──────────────────────────────────────────────────────────────
  if (!editRole) return null;
  const subCoverage = currentSub ? Math.round((subGrantedCount(currentSub.key, currentSub.module) / Math.max(1, currentSub.permissions.length)) * 100) : 0;

  return (
    <>
      <PageHeader
        title={`${editRole.name}${readOnly ? "  ·  read-only" : ""}`}
        subtitle={`${editRole.code} · component-level grants${editRole.parentRoleId ? ` · inherits ${rolesById[editRole.parentRoleId]?.name}` : ""}`}
        icon={<span className="h-9 w-9 rounded-md bg-primary/10 text-primary text-sm font-semibold inline-flex items-center justify-center">{initials(editRole.name)}</span>}
        actions={
          <div className="flex gap-2 items-center flex-wrap">
            <Button size="sm" variant="ghost" onClick={() => { setView("list"); setEditRoleId(null); }}><ArrowLeft className="h-4 w-4 mr-1.5" /> Back</Button>
            <Button size="sm" variant="outline" onClick={() => setAuditOpen(true)}><History className="h-4 w-4 mr-1.5" /> Audit</Button>
            <Button size="sm" variant="outline" onClick={() => { setCmpA(editRole.id); setCompareOpen(true); }}><GitCompare className="h-4 w-4 mr-1.5" /> Compare</Button>
            {!readOnly && <>
              <Button size="sm" variant="outline" disabled={!isDirty} onClick={handleReset}><Undo2 className="h-4 w-4 mr-1.5" /> Reset</Button>
              <Button size="sm" variant="outline" disabled={!isDirty} onClick={handleSave}><Save className="h-4 w-4 mr-1.5" /> Save draft</Button>
              <Button size="sm" onClick={handlePublish}><UploadCloud className="h-4 w-4 mr-1.5" /> Publish</Button>
            </>}
          </div>
        }
      />

      {hasDraft && !readOnly && (
        <div className="mb-3 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 rounded-md px-3 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5" /> This role has an unpublished draft. Publish to apply it to the app, or
          <button className="underline" onClick={() => handleDiscard(editRole.id)}>discard</button>.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_240px] gap-3">
        {/* LEFT — module / page tree */}
        <Card className="h-fit lg:sticky lg:top-3">
          <CardContent className="py-3 px-2">
            <div className="relative mb-2 px-1">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={treeSearch} onChange={e => setTreeSearch(e.target.value)} placeholder="Find page…" className="h-8 pl-8" />
            </div>
            <div className="max-h-[70vh] overflow-y-auto pr-1">
              {PERMISSION_CATALOG.map(mod => {
                const subs = mod.submodules.filter(s => {
                  const q = treeSearch.trim().toLowerCase();
                  return !q || s.label.toLowerCase().includes(q) || mod.label.toLowerCase().includes(q);
                });
                if (subs.length === 0) return null;
                const isOpen = openModules.has(mod.key) || treeSearch.trim().length > 0;
                return (
                  <div key={mod.key} className="mb-0.5">
                    <button
                      className="w-full flex items-center gap-1 px-1.5 py-1 text-xs font-semibold text-foreground hover:bg-muted/60 rounded"
                      onClick={() => setOpenModules(prev => { const n = new Set(prev); n.has(mod.key) ? n.delete(mod.key) : n.add(mod.key); return n; })}
                    >
                      {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {mod.label}
                    </button>
                    {isOpen && subs.map(s => {
                      const active = sel?.mod === mod.key && sel?.sub === s.key;
                      const gc = subGrantedCount(s.key, mod.key);
                      return (
                        <button
                          key={s.key}
                          onClick={() => setSel({ mod: mod.key, sub: s.key })}
                          className={`w-full flex items-center justify-between gap-1 pl-6 pr-1.5 py-1 text-xs rounded ${active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
                        >
                          <span className="truncate">{s.label}</span>
                          {gc > 0 && <span className="tabular-nums text-[10px] rounded-full bg-primary/15 text-primary px-1.5">{gc}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* CENTER — permission table */}
        <Card>
          <CardContent className="py-3">
            {!currentSub ? (
              <div className="text-sm text-muted-foreground py-10 text-center">Select a page from the left.</div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                  <div>
                    <div className="font-semibold text-foreground">{currentSub.label}</div>
                    <div className="text-[11px] text-muted-foreground">{currentSub.description}</div>
                  </div>
                </div>

                {/* presets */}
                {currentSub.presets && currentSub.presets.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {currentSub.presets.map(p => (
                      <button
                        key={p.key}
                        disabled={readOnly}
                        title={p.description}
                        onClick={() => applyPreset(currentSub, p)}
                        className={`text-[11px] rounded-full border px-2 py-0.5 disabled:opacity-50 hover:bg-muted/60 ${TONE_CLASS[p.tone ?? "neutral"]}`}
                      >
                        {p.label}
                      </button>
                    ))}
                    {!readOnly && (
                      <>
                        <span className="mx-1 w-px bg-border" />
                        <button className="text-[11px] rounded-full border border-border px-2 py-0.5 hover:bg-muted/60 inline-flex items-center gap-1" onClick={() => { setCopyFrom(""); setCopyOpen(true); }}><Copy className="h-3 w-3" /> Copy from…</button>
                        <button className="text-[11px] rounded-full border border-border px-2 py-0.5 hover:bg-muted/60 inline-flex items-center gap-1" onClick={resetScopes}><RotateCcw className="h-3 w-3" /> Reset scopes</button>
                      </>
                    )}
                  </div>
                )}

                {/* filters */}
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={permSearch} onChange={e => setPermSearch(e.target.value)} placeholder="Search permissions…" className="h-8 pl-8" />
                  </div>
                  <label className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5"><Switch checked={onlyGranted} onCheckedChange={setOnlyGranted} /> Granted only</label>
                  <label className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5"><Switch checked={onlyChanged} onCheckedChange={setOnlyChanged} /> Changed only</label>
                </div>

                <div className="space-y-3 max-h-[62vh] overflow-y-auto pr-1">
                  {groupedRows.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">No permissions match.</div>}
                  {groupedRows.map(({ section, perms }) => (
                    <div key={section}>
                      <div className="flex items-center justify-between gap-2 mb-1 sticky top-0 bg-card py-1">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{SECTION_LABELS[section]} <span className="opacity-60">({perms.length})</span></div>
                        {!readOnly && (
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => bulkSection(perms, true)}>Grant all</Button>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => bulkSection(perms, false)}>Revoke all</Button>
                            {perms.some(p => p.scopeable) && (
                              <Select onValueChange={v => bulkScope(perms, v as PermissionScope)}>
                                <SelectTrigger className="h-6 w-[110px] text-[11px]"><SelectValue placeholder="Set scope" /></SelectTrigger>
                                <SelectContent>{SCOPE_ORDER.map(s => <SelectItem key={s} value={s} className="text-xs">{SCOPE_LABELS[s]}</SelectItem>)}</SelectContent>
                              </Select>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="rounded-md border border-border divide-y divide-border">
                        {perms.map(p => {
                          const g = working[p.key];
                          const inherited = !g?.granted && ancestorGrants[p.key]?.granted;
                          return (
                            <div key={p.key} className="flex items-start gap-3 px-2.5 py-2">
                              <Switch className="mt-0.5" checked={!!g?.granted} disabled={readOnly} onCheckedChange={v => toggleGrant(p, v)} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm font-medium text-foreground">{p.displayName}</span>
                                  {p.sensitive && <Tag className="text-amber-700 dark:text-amber-300 border-amber-300"><ShieldAlert className="h-2.5 w-2.5" /> Sensitive</Tag>}
                                  {p.destructive && <Tag className="text-red-700 dark:text-red-300 border-red-300"><Trash2 className="h-2.5 w-2.5" /> Destructive</Tag>}
                                  {inherited && <Tag className="text-sky-700 dark:text-sky-300 border-sky-300"><GitBranch className="h-2.5 w-2.5" /> Inherited</Tag>}
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-0.5">{p.impactDescription}</div>
                              </div>
                              {p.scopeable && g?.granted && (
                                <Select value={g.scope ?? "department"} onValueChange={v => setScope(p, v as PermissionScope)} disabled={readOnly}>
                                  <SelectTrigger className="h-7 w-[130px] text-xs shrink-0"
                                    style={{ color: SCOPE_STYLE[g.scope ?? "department"].color }}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>{SCOPE_ORDER.map(s => <SelectItem key={s} value={s} className="text-xs">{SCOPE_LABELS[s]}</SelectItem>)}</SelectContent>
                                </Select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* RIGHT — coverage / totals */}
        <div className="space-y-3 h-fit lg:sticky lg:top-3">
          <Card>
            <CardContent className="py-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">This page</div>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-semibold tabular-nums">{subCoverage}%</span>
                <span className="text-[11px] text-muted-foreground">{currentSub ? `${subGrantedCount(currentSub.key, currentSub.module)}/${currentSub.permissions.length}` : "—"}</span>
              </div>
              <Progress value={subCoverage} className="h-1.5 mt-2" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Role totals</div>
              <Stat label="Granted" value={`${roleTotals.granted}/${TOTAL_CATALOGED}`} />
              <Stat label="Scoped" value={roleTotals.scopeable} />
              <Stat label="Sensitive" value={roleTotals.sensitive} tone="amber" />
              <Stat label="Destructive" value={roleTotals.destructive} tone="red" />
              {editRole.parentRoleId && (
                <div className="text-[11px] text-muted-foreground pt-1 border-t border-border mt-1">
                  <GitBranch className="h-3 w-3 inline -mt-0.5 mr-1" />
                  Inherits {Object.values(ancestorGrants).filter(a => a.granted).length} grants from {rolesById[editRole.parentRoleId]?.name}.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sensitive confirm */}
      <Dialog open={sensitiveConfirm !== null} onOpenChange={o => !o && setSensitiveConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-amber-600" /> Grant sensitive permission?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{sensitiveConfirm?.displayName}</strong> exposes cost / financial data or a
            lifecycle-changing action. Confirm you want to grant it to this role.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSensitiveConfirm(null)}>Cancel</Button>
            <Button onClick={() => {
              if (sensitiveConfirm && editRoleId) { applyGrant(sensitiveConfirm.key, true, sensitiveConfirm); audit(editRoleId, "permission.granted", { permissionKey: sensitiveConfirm.key }); }
              setSensitiveConfirm(null);
            }}>Grant anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy from role */}
      <Dialog open={copyOpen} onOpenChange={o => !o && setCopyOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Copy grants from another role</DialogTitle></DialogHeader>
          <p className="text-[12px] text-muted-foreground">Replaces the entire working state with the selected role's effective (inherited + own) grants. Save or publish to keep it.</p>
          <Select value={copyFrom} onValueChange={setCopyFrom}>
            <SelectTrigger><SelectValue placeholder="Select a role…" /></SelectTrigger>
            <SelectContent>{roles.filter(r => r.id !== editRoleId).map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)}>Cancel</Button>
            <Button disabled={!copyFrom} onClick={doCopyFrom}>Copy grants</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit trail */}
      <Dialog open={auditOpen} onOpenChange={o => !o && setAuditOpen(false)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Audit Trail — {editRole.name}</DialogTitle></DialogHeader>
          <div className="flex gap-2 mb-1">
            <Button size="sm" variant="outline" onClick={() => exportPermissionAuditExcel({ roleName: editRole.name, roleCode: editRole.code, roleId: editRole.id }, auditEntries.filter(e => e.roleId === editRole.id))}><FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Excel</Button>
            <Button size="sm" variant="outline" onClick={() => exportPermissionAuditPdf({ roleName: editRole.name, roleCode: editRole.code, roleId: editRole.id }, auditEntries.filter(e => e.roleId === editRole.id))}><FileText className="h-3.5 w-3.5 mr-1.5" /> PDF</Button>
            <Button size="sm" variant="outline" onClick={() => exportPermissionAuditWord({ roleName: editRole.name, roleCode: editRole.code, roleId: editRole.id }, auditEntries.filter(e => e.roleId === editRole.id))}><Download className="h-3.5 w-3.5 mr-1.5" /> Word</Button>
          </div>
          <div className="max-h-[55vh] overflow-y-auto space-y-1.5 pr-1">
            {auditEntries.filter(e => e.roleId === editRole.id).slice().reverse().map(e => (
              <div key={e.id} className="rounded-md border border-border p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{e.action.replace(/^(permission|role)\./, "").replace(/_/g, " ")}</span>
                  <span className="text-[11px] text-muted-foreground">{e.timestamp}</span>
                </div>
                {e.permissionKey && <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{e.permissionKey}</div>}
                {(e.fromScope || e.toScope) && <div className="text-[11px] mt-0.5">{e.fromScope ?? "—"} → <strong>{e.toScope}</strong></div>}
                {e.note && <div className="text-[11px] mt-0.5">{e.note}</div>}
                <div className="text-[10px] text-muted-foreground mt-0.5">by {e.actor}</div>
              </div>
            ))}
            {auditEntries.filter(e => e.roleId === editRole.id).length === 0 && <div className="text-sm text-muted-foreground text-center py-6">No audit entries yet.</div>}
          </div>
        </DialogContent>
      </Dialog>

      <CompareDialog open={compareOpen} onClose={() => setCompareOpen(false)} roles={roles} rolesById={rolesById}
        a={cmpA} b={cmpB} setA={setCmpA} setB={setCmpB} liveGrantsByRole={liveGrantsByRole} />
    </>
  );
}

// ── small presentational helpers ────────────────────────────────────────────────
function Tag({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 text-[10px] ${className}`}>{children}</span>;
}
function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "amber" | "red" }) {
  const c = tone === "amber" ? "text-amber-600" : tone === "red" ? "text-red-600" : "text-foreground";
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${c}`}>{value}</span>
    </div>
  );
}

// ── Compare drawer ──────────────────────────────────────────────────────────────
function CompareDialog(props: {
  open: boolean; onClose: () => void; roles: Role[]; rolesById: Record<string, Role>;
  a: string; b: string; setA: (v: string) => void; setB: (v: string) => void;
  liveGrantsByRole: Record<string, RolePermissionMap>;
}) {
  const { open, onClose, roles, rolesById, a, b, setA, setB, liveGrantsByRole } = props;
  const diff = useMemo(() => {
    if (!a || !b) return null;
    const ga = resolveGrantsForRole(a, liveGrantsByRole, rolesById);
    const gb = resolveGrantsForRole(b, liveGrantsByRole, rolesById);
    const keys = new Set([...Object.keys(ga), ...Object.keys(gb)]);
    const onlyA: string[] = [], onlyB: string[] = [], scopeDiff: string[] = [];
    for (const k of keys) {
      const x = ga[k]?.granted, y = gb[k]?.granted;
      if (x && !y) onlyA.push(k);
      else if (!x && y) onlyB.push(k);
      else if (x && y && ga[k].scope !== gb[k].scope) scopeDiff.push(k);
    }
    return { onlyA, onlyB, scopeDiff };
  }, [a, b, liveGrantsByRole, rolesById]);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Compare Roles</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 mb-2">
          <Select value={a} onValueChange={setA}>
            <SelectTrigger><SelectValue placeholder="Role A" /></SelectTrigger>
            <SelectContent>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={b} onValueChange={setB}>
            <SelectTrigger><SelectValue placeholder="Role B" /></SelectTrigger>
            <SelectContent>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {!diff ? (
          <div className="text-sm text-muted-foreground text-center py-8">Pick two roles to see the difference.</div>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-xs max-h-[50vh] overflow-y-auto">
            <DiffCol title={`Only ${rolesById[a]?.name}`} tone="text-emerald-600" keys={diff.onlyA} />
            <DiffCol title={`Only ${rolesById[b]?.name}`} tone="text-sky-600" keys={diff.onlyB} />
            <DiffCol title="Scope differs" tone="text-amber-600" keys={diff.scopeDiff} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
function DiffCol({ title, tone, keys }: { title: string; tone: string; keys: string[] }) {
  return (
    <div>
      <div className={`font-semibold mb-1 ${tone}`}>{title} · {keys.length}</div>
      <div className="space-y-0.5">
        {keys.map(k => <div key={k} className="font-mono text-[10px] text-muted-foreground truncate" title={k}>{k}</div>)}
        {keys.length === 0 && <div className="text-muted-foreground">—</div>}
      </div>
    </div>
  );
}

// ── Permission inspector ────────────────────────────────────────────────────────
function InspectorDialog(props: {
  open: boolean; onClose: () => void; query: string; setQuery: (v: string) => void;
  roles: Role[]; rolesById: Record<string, Role>; liveGrantsByRole: Record<string, RolePermissionMap>;
}) {
  const { open, onClose, query, setQuery, roles, rolesById, liveGrantsByRole } = props;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const all = PERMISSION_CATALOG.flatMap(m => m.submodules.flatMap(s => s.permissions.map(p => ({ p, mod: m.label, sub: s.label }))));
    return all.filter(({ p }) => p.displayName.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)).slice(0, 30);
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Crosshair className="h-4 w-4" /> Permission Inspector</DialogTitle></DialogHeader>
        <div className="relative mb-2">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a permission by name or key…" className="h-9 pl-8" autoFocus />
        </div>
        <div className="max-h-[55vh] overflow-y-auto space-y-2">
          {query.trim() && matches.length === 0 && <div className="text-sm text-muted-foreground text-center py-6">No permissions match.</div>}
          {matches.map(({ p, mod, sub }) => {
            const holders = roles.filter(r => resolveGrantsForRole(r.id, liveGrantsByRole, rolesById)[p.key]?.granted);
            return (
              <div key={p.key} className="rounded-md border border-border p-2.5">
                <div className="text-sm font-medium">{p.displayName}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{mod} › {sub}</div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {holders.length === 0 && <span className="text-[11px] text-muted-foreground">No role has this (live).</span>}
                  {holders.map(r => {
                    const scope = resolveGrantsForRole(r.id, liveGrantsByRole, rolesById)[p.key]?.scope;
                    return (
                      <span key={r.id} className="text-[11px] rounded-full border border-border px-1.5 py-0.5 inline-flex items-center gap-1">
                        {r.name}{scope && <em className="not-italic" style={{ color: SCOPE_STYLE[scope].color }}>· {SCOPE_LABELS[scope]}</em>}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
