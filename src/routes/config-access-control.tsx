import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShieldCheck, Lock, RotateCcw, Eye, Plus, Pencil, Trash2, ChevronRight,
  ChevronDown, CheckCheck, Square, LayoutGrid, BarChart3, MousePointerClick, Columns3,
} from "lucide-react";
import { toast } from "sonner";
import { useRole } from "@/lib/roles";
import {
  ACTIONS, ADMIN_ROLE, RBAC_TREE, type Action, type ElementKind, type RbacElement,
  useAllRoles, useAccess, isBuiltinRole, getPageElements,
  can, canElement, elementResourceId,
  toggleAction, setActions, setModuleActions, resetRoleToDefaults, grantAllPages, clearRole,
  createRole, renameRole, deleteRole,
} from "@/lib/access-control";

const ELEMENT_ICON: Record<ElementKind, typeof BarChart3> = {
  kpi: BarChart3, column: Columns3, action: MousePointerClick, section: LayoutGrid,
};

function Check({ on, dim, disabled, onChange }: { on: boolean; dim?: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      className={`h-4 w-4 accent-primary ${dim ? "opacity-50" : ""} ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      checked={on}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export default function ConfigAccessControlPage() {
  const { role: activeRole, setRole } = useRole();
  const roles = useAllRoles();
  const map = useAccess();
  const [selectedRole, setSelectedRole] = useState<string>(
    roles.find((r) => r !== ADMIN_ROLE) ?? ADMIN_ROLE,
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [roleDialog, setRoleDialog] = useState<{ mode: "create" | "rename"; value: string; target?: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  if (activeRole !== ADMIN_ROLE) {
    return (
      <>
        <PageHeader title="User Access Control" subtitle="Create roles and manage view / create / edit / delete permissions per module, page, and element." />
        <Card>
          <CardContent className="py-12 text-center">
            <Lock className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <div className="text-sm font-semibold text-foreground">Restricted</div>
            <p className="text-xs text-muted-foreground mt-1">Only <strong>GM/Admin</strong> can manage access control.</p>
          </CardContent>
        </Card>
      </>
    );
  }

  // Keep selection valid if a role was just deleted/renamed.
  const role = roles.includes(selectedRole) ? selectedRole : (roles.find((r) => r !== ADMIN_ROLE) ?? ADMIN_ROLE);
  const isAdminSel = role === ADMIN_ROLE;

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const pageActions = (route: string): Action[] => ACTIONS.filter((a) => can(role, route, a, map));
  const elementActions = (route: string, elId: string): Action[] =>
    ACTIONS.filter((a) => canElement(role, route, elId, a, map));
  const elementHasExplicit = (route: string, elId: string) =>
    Boolean(map[role]?.[elementResourceId(route, elId)]);

  // Toggle one action on a page.
  const onPageToggle = (route: string, action: Action) => toggleAction(role, route, action);

  // Toggle one action on an element — captures inherited state into an explicit
  // override so a column/KPI can be denied even when the page is viewable.
  const onElementToggle = (route: string, el: RbacElement, action: Action) => {
    const eff = elementActions(route, el.id);
    const resId = elementResourceId(route, el.id);
    let next: Action[];
    if (eff.includes(action)) {
      next = action === "view" ? [] : eff.filter((a) => a !== action);
    } else {
      next = [...eff, action];
      if (action !== "view" && !next.includes("view")) next.push("view");
    }
    setActions(role, resId, next);
  };

  // Module master (view across all its pages).
  const moduleViewState = (moduleKey: string): "all" | "some" | "none" => {
    const mod = RBAC_TREE.find((m) => m.key === moduleKey)!;
    const on = mod.pages.filter((p) => can(role, p.key, "view", map)).length;
    if (on === 0) return "none";
    if (on === mod.pages.length) return "all";
    return "some";
  };
  const toggleModuleView = (moduleKey: string) => {
    const turnOn = moduleViewState(moduleKey) !== "all";
    setModuleActions(role, moduleKey, turnOn ? ["view"] : []);
  };

  const totalPages = RBAC_TREE.reduce((s, m) => s + m.pages.length, 0);
  const viewablePages = RBAC_TREE.reduce(
    (s, m) => s + m.pages.filter((p) => can(role, p.key, "view", map)).length, 0);

  const submitRoleDialog = () => {
    if (!roleDialog) return;
    const name = roleDialog.value.trim();
    const res = roleDialog.mode === "create"
      ? createRole(name)
      : renameRole(roleDialog.target ?? role, name);
    if (!res.ok) { toast.error(res.error ?? "Failed."); return; }
    setSelectedRole(name);
    toast.success(roleDialog.mode === "create" ? `Role "${name}" created.` : "Role renamed.");
    setRoleDialog(null);
  };

  const onDeleteRole = (target: string) => {
    const res = deleteRole(target);
    if (!res.ok) { toast.error(res.error ?? "Failed."); return; }
    toast.success(`Role "${target}" deleted.`);
    if (selectedRole === target) {
      setSelectedRole(roles.find((r) => r !== ADMIN_ROLE && r !== target) ?? ADMIN_ROLE);
    }
    setDeleteTarget(null);
  };

  return (
    <>
      <PageHeader
        title="User Access Control"
        subtitle="Create roles and manage view / create / edit / delete permissions for every module, page, KPI card, column and action. GM/Admin always has full access."
        actions={
          <Button variant="outline" onClick={() => setRole(role)} title="Switch the app to this role to preview its access live">
            <Eye className="h-4 w-4 mr-1.5" /> Preview as {role}
          </Button>
        }
      />

      {/* Roles — CRUD table. Select a row to edit its permissions below. */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Roles</div>
            <Button size="sm" variant="outline" onClick={() => setRoleDialog({ mode: "create", value: "" })}>
              <Plus className="h-4 w-4 mr-1.5" /> New Role
            </Button>
          </div>
          <div className="rounded-md border border-border overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-center whitespace-nowrap">Pages viewable</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((r) => {
                  const isAdmin = r === ADMIN_ROLE;
                  const builtin = isBuiltinRole(r);
                  const selected = role === r;
                  const vp = RBAC_TREE.reduce(
                    (s, m) => s + m.pages.filter((p) => can(r, p.key, "view", map)).length, 0);
                  return (
                    <TableRow
                      key={r}
                      onClick={() => setSelectedRole(r)}
                      className={`cursor-pointer ${selected ? "bg-primary/5" : ""}`}
                    >
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                          {r}
                          {isAdmin && <Lock className="h-3 w-3 text-muted-foreground" />}
                          {activeRole === r && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">previewing</Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                          {isAdmin ? "Administrator" : builtin ? "Built-in" : "Custom"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center tabular-nums whitespace-nowrap">
                        {isAdmin ? "All" : `${vp}/${totalPages}`}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <Button
                            size="sm"
                            variant={selected ? "default" : "outline"}
                            className="h-7 px-2 text-xs"
                            onClick={() => setSelectedRole(r)}
                          >
                            <Pencil className="h-3.5 w-3.5 mr-1" /> Permissions
                          </Button>
                          {!isAdmin && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 w-7 p-0"
                                title="Rename role"
                                onClick={() => setRoleDialog({ mode: "rename", value: r, target: r })}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 w-7 p-0 text-destructive"
                                title="Delete role"
                                onClick={() => setDeleteTarget(r)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
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

      {isAdminSel ? (
        <Card>
          <CardContent className="py-10 text-center">
            <ShieldCheck className="h-8 w-8 mx-auto text-primary mb-3" />
            <div className="text-sm font-semibold text-foreground">GM/Admin — Full access</div>
            <p className="text-xs text-muted-foreground mt-1">
              The administrator role always has every permission on every module, page and element. Select another role to configure it.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-sm text-muted-foreground">
              <strong className="text-foreground tabular-nums">{viewablePages}</strong> of{" "}
              <strong className="text-foreground tabular-nums">{totalPages}</strong> pages viewable for{" "}
              <strong className="text-foreground">{role}</strong>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => grantAllPages(role, ["view"])}><CheckCheck className="h-4 w-4 mr-1.5" /> View all</Button>
              <Button size="sm" variant="outline" onClick={() => grantAllPages(role, [...ACTIONS])}><CheckCheck className="h-4 w-4 mr-1.5" /> Full CRUD all</Button>
              <Button size="sm" variant="outline" onClick={() => clearRole(role)}><Square className="h-4 w-4 mr-1.5" /> Clear</Button>
              <Button size="sm" variant="outline" onClick={() => { resetRoleToDefaults(role); toast.success(`Reset "${role}" to defaults.`); }}><RotateCcw className="h-4 w-4 mr-1.5" /> Defaults</Button>
            </div>
          </div>

          <div className="space-y-3">
            {RBAC_TREE.map((mod) => {
              const mState = moduleViewState(mod.key);
              return (
                <Card key={mod.key}>
                  <CardContent className="py-3">
                    {/* Module header */}
                    <div className="flex items-center gap-2.5 pb-2 border-b border-border">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary cursor-pointer"
                        checked={mState === "all"}
                        ref={(el) => { if (el) el.indeterminate = mState === "some"; }}
                        onChange={() => toggleModuleView(mod.key)}
                        title="Toggle view for all pages in this module"
                      />
                      <span className="text-sm font-semibold text-foreground">{mod.label}</span>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                        {mod.pages.filter((p) => can(role, p.key, "view", map)).length}/{mod.pages.length}
                      </Badge>
                      <div className="ml-auto hidden sm:flex items-center gap-6 pr-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {ACTIONS.map((a) => <span key={a} className="w-10 text-center">{a}</span>)}
                      </div>
                    </div>

                    {/* Pages */}
                    <div className="divide-y divide-border/60">
                      {mod.pages.map((page) => {
                        const acts = pageActions(page.key);
                        const els = getPageElements(page.key);
                        const hasElements = els.length > 0;
                        const isOpen = expanded.has(page.key);
                        return (
                          <div key={page.key}>
                            <div className="flex items-center gap-2 py-2">
                              <button
                                type="button"
                                className={`p-0.5 rounded ${hasElements ? "hover:bg-muted" : "invisible"}`}
                                onClick={() => hasElements && toggleExpand(page.key)}
                                aria-label="Toggle elements"
                              >
                                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                              <span className="text-sm text-foreground flex-1 truncate">{page.label}</span>
                              {hasElements && (
                                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{els.length} elements</Badge>
                              )}
                              <div className="flex items-center gap-6 pr-1">
                                {ACTIONS.map((a) => (
                                  <div key={a} className="w-10 flex justify-center">
                                    <Check on={acts.includes(a)} onChange={() => onPageToggle(page.key, a)} />
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Elements */}
                            {isOpen && hasElements && (
                              <div className="pl-8 pb-2 space-y-1">
                                {els.map((el) => {
                                  const Icon = ELEMENT_ICON[el.kind];
                                  const eff = elementActions(page.key, el.id);
                                  const inherited = !elementHasExplicit(page.key, el.id);
                                  return (
                                    <div key={el.id} className="flex items-center gap-2 py-1">
                                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                      <span className="text-xs text-foreground flex-1 truncate">
                                        {el.label}
                                        {inherited && <span className="ml-2 text-[10px] text-muted-foreground">(inherits page)</span>}
                                      </span>
                                      <div className="flex items-center gap-6 pr-1">
                                        {ACTIONS.map((a) => (
                                          <div key={a} className="w-10 flex justify-center">
                                            <Check on={eff.includes(a)} dim={inherited} onChange={() => onElementToggle(page.key, el, a)} />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Create / rename role dialog */}
      <Dialog open={roleDialog !== null} onOpenChange={(o) => !o && setRoleDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{roleDialog?.mode === "create" ? "Create New Role" : `Rename "${role}"`}</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Role name <span className="text-destructive">*</span></Label>
            <Input
              autoFocus
              value={roleDialog?.value ?? ""}
              onChange={(e) => setRoleDialog((d) => (d ? { ...d, value: e.target.value } : d))}
              onKeyDown={(e) => { if (e.key === "Enter") submitRoleDialog(); }}
              placeholder="e.g. Kitchen Supervisor"
              className="mt-1"
            />
            <p className="text-[11px] text-muted-foreground mt-2">
              New roles start with Dashboard access only — grant modules and pages below.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialog(null)}>Cancel</Button>
            <Button onClick={submitRoleDialog}>{roleDialog?.mode === "create" ? "Create" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete role confirmation */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete role “{deleteTarget}”?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently removes the <strong className="text-foreground">{deleteTarget}</strong> role and all of its
            permission settings. Users acting as this role will lose access. This cannot be undone.
            {deleteTarget && isBuiltinRole(deleteTarget) && (
              <span className="block mt-2">
                You can recreate it later with the same name and click <strong className="text-foreground">Defaults</strong> to restore its standard access.
              </span>
            )}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && onDeleteRole(deleteTarget)}
            >
              <Trash2 className="h-4 w-4 mr-1.5" /> Delete role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
