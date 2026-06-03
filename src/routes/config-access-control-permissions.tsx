import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  ShieldCheck, Lock, RotateCcw, Eye, ArrowLeft, ChevronRight,
  ChevronDown, CheckCheck, Square, LayoutGrid, BarChart3, MousePointerClick, Columns3, FormInput,
} from "lucide-react";
import { toast } from "sonner";
import { useRole } from "@/lib/roles";
import {
  ACTIONS, ADMIN_ROLE, RBAC_TREE, type Action, type ElementKind, type RbacElement,
  useAllRoles, useAccess, useAdminRoles, getPageElements, isAdminRole, isRootAdmin, setRoleAdmin,
  can, canElement, elementResourceId,
  toggleAction, setActions, setModuleActions, resetRoleToDefaults, grantAllPages, clearRole,
} from "@/lib/access-control";

const ELEMENT_ICON: Record<ElementKind, typeof BarChart3> = {
  kpi: BarChart3, column: Columns3, field: FormInput, action: MousePointerClick, section: LayoutGrid,
};

// Display order + plural headings for the per-page content groups.
const ELEMENT_GROUPS: { kind: ElementKind; label: string }[] = [
  { kind: "kpi", label: "KPI cards" },
  { kind: "column", label: "Table columns" },
  { kind: "field", label: "Form fields" },
  { kind: "action", label: "Action buttons" },
  { kind: "section", label: "Sections" },
];

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

export default function ConfigAccessControlPermissionsPage() {
  const { role: activeRole, setRole } = useRole();
  const roles = useAllRoles();
  const map = useAccess();
  useAdminRoles(); // re-render when admin promotions change
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const backToRoles = () => navigate("/config-access-control");

  // Only GM/Admin (acting role) can manage access control.
  if (activeRole !== ADMIN_ROLE) {
    return (
      <>
        <PageHeader title="User Access Control" subtitle="Manage view / create / edit / delete permissions per module, page, and element." />
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

  const roleParam = searchParams.get("role") ?? "";
  const role = roles.includes(roleParam) ? roleParam : "";

  // No / unknown role in the URL — send the admin back to pick one.
  if (!role) {
    return (
      <>
        <PageHeader
          title="Permissions"
          subtitle="No role selected."
          actions={<Button variant="outline" onClick={backToRoles}><ArrowLeft className="h-4 w-4 mr-1.5" /> Back to roles</Button>}
        />
        <Card>
          <CardContent className="py-12 text-center">
            <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <div className="text-sm font-semibold text-foreground">Pick a role to configure</div>
            <p className="text-xs text-muted-foreground mt-1">Choose a role from the roles list to manage its permissions.</p>
            <Button className="mt-4" onClick={backToRoles}>Go to roles</Button>
          </CardContent>
        </Card>
      </>
    );
  }

  const isAdmin = isAdminRole(role);
  const isRoot = isRootAdmin(role);

  const onToggleAdmin = (next: boolean) => {
    setRoleAdmin(role, next);
    toast.success(next ? `"${role}" is now an administrator — full access.` : `"${role}" is no longer an administrator.`);
  };

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

  const onPageToggle = (route: string, action: Action) => toggleAction(role, route, action);

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

  return (
    <>
      <PageHeader
        title={`Permissions — ${role}`}
        subtitle="Manage view / create / edit / delete down to each KPI card, column, field, action and section."
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm" title={isRoot ? "GM/Admin is the root administrator and is always full-access" : "Give this role full access to everything, like GM/Admin"}>
              <Switch checked={isAdmin} disabled={isRoot} onCheckedChange={onToggleAdmin} />
              <span className="whitespace-nowrap">Administrator <span className="text-muted-foreground">(full access)</span></span>
            </label>
            <Button variant="outline" onClick={() => setRole(role)} title="Switch the app to this role to preview its access live">
              <Eye className="h-4 w-4 mr-1.5" /> Preview as {role}
            </Button>
            <Button variant="outline" onClick={backToRoles}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to roles
            </Button>
          </div>
        }
      />

      {isAdmin ? (
        <Card>
          <CardContent className="py-10 text-center">
            <ShieldCheck className="h-8 w-8 mx-auto text-primary mb-3" />
            <div className="text-sm font-semibold text-foreground">{role} — Full access (Administrator)</div>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              {isRoot
                ? "GM/Admin is the root administrator and always has every permission on every module, page and element."
                : "This role has every permission on every module, page and element. Turn off the Administrator toggle above to manage granular permissions."}
            </p>
            <Button className="mt-4" variant="outline" onClick={backToRoles}>Back to roles</Button>
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

                            {/* Page contents — grouped by kind (KPIs, columns, fields, actions, sections) */}
                            {isOpen && hasElements && (
                              <div className="pl-8 pb-2 space-y-2">
                                {ELEMENT_GROUPS.map((grp) => {
                                  const Icon = ELEMENT_ICON[grp.kind];
                                  const groupEls = els.filter((e) => e.kind === grp.kind);
                                  if (groupEls.length === 0) return null;
                                  return (
                                    <div key={grp.kind}>
                                      <div className="flex items-center gap-1.5 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/80">
                                        <Icon className="h-3 w-3" />
                                        {grp.label}
                                        <span className="tabular-nums">({groupEls.length})</span>
                                      </div>
                                      {groupEls.map((el) => {
                                        const eff = elementActions(page.key, el.id);
                                        const inherited = !elementHasExplicit(page.key, el.id);
                                        return (
                                          <div key={el.id} className="flex items-center gap-2 py-1">
                                            <span className="h-3.5 w-3.5 shrink-0" />
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
    </>
  );
}
