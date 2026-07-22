import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import {
  Users, Lock, Plus, MoreHorizontal, Eye, Pencil, ShieldCheck, History,
  Power, PowerOff, Search, Download, FileText, FileSpreadsheet, GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import { useRolesStore } from "@/stores/rolesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { resolveGrantsForRole } from "@/features/system-admin/role-permission-editor/utils/resolveGrants";
import { TOTAL_CATALOGED } from "@/features/system-admin/role-permission-editor/data/catalog";
import {
  type Role, type RoleStatus, type AuditEntry, type AuditChange,
  STATUS_STYLE, AUDIT_STYLE, nextAuditId, formatTimestamp, formatDate,
} from "../types/roleSetup.types";
import { exportAuditExcel, exportAuditPdf, exportAuditWord } from "../utils/exportAudit";

const ACTOR = "Business Analyst";

interface RoleForm {
  name: string;
  code: string;
  description: string;
  status: RoleStatus;
  parentRoleId: string; // "" = none
}
const emptyForm: RoleForm = { name: "", code: "", description: "", status: "Active", parentRoleId: "" };

const formatCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+/, "");

export default function RoleSetupPage() {
  const navigate = useNavigate();
  const roles = useRolesStore(s => s.roles);
  const createRole = useRolesStore(s => s.createRole);
  const updateRole = useRolesStore(s => s.updateRole);
  const setStatus = useRolesStore(s => s.setStatus);
  const liveGrants = usePermissionsStore(s => s.liveGrantsByRole);

  const rolesById = useMemo(() => Object.fromEntries(roles.map(r => [r.id, r])), [roles]);

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"All" | RoleStatus>("All");

  const [formOpen, setFormOpen] = useState<null | { mode: "create" | "edit"; id?: string }>(null);
  const [form, setForm] = useState<RoleForm>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof RoleForm, string>>>({});
  const [viewId, setViewId] = useState<string | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [membersId, setMembersId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [toggleTarget, setToggleTarget] = useState<Role | null>(null);

  // ── derived ────────────────────────────────────────────────────────────────
  const coverage = (role: Role) => {
    const resolved = resolveGrantsForRole(role.id, liveGrants, rolesById);
    return Object.values(resolved).filter(g => g.granted).length;
  };

  const counts = {
    All: roles.length,
    Active: roles.filter(r => r.status === "Active").length,
    Inactive: roles.filter(r => r.status === "Inactive").length,
  };

  const filtered = roles.filter(r => {
    if (tab !== "All" && r.status !== tab) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
  });

  const viewRole = viewId ? rolesById[viewId] : null;
  const auditRole = auditId ? rolesById[auditId] : null;
  const membersRole = membersId ? rolesById[membersId] : null;

  // ── handlers ─────────────────────────────────────────────────────────────────
  const openCreate = () => { setForm(emptyForm); setErrors({}); setFormOpen({ mode: "create" }); };
  const openEdit = (r: Role) => {
    setForm({ name: r.name, code: r.code, description: r.description, status: r.status, parentRoleId: r.parentRoleId ?? "" });
    setErrors({});
    setFormOpen({ mode: "edit", id: r.id });
  };

  const validate = (): boolean => {
    const e: Partial<Record<keyof RoleForm, string>> = {};
    if (!form.name.trim()) e.name = "Role name is required.";
    if (!form.code.trim()) e.code = "Role code is required.";
    else if (roles.some(r => r.code === form.code && r.id !== formOpen?.id)) e.code = "Code already in use.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submitForm = () => {
    if (!formOpen || !validate()) return;
    if (formOpen.mode === "create") {
      const audit: AuditEntry[] = [{
        id: nextAuditId(), action: "Created", actor: ACTOR, timestamp: formatTimestamp(),
        note: `Role "${form.name}" created.`,
      }];
      if (form.status === "Inactive") {
        audit.push({ id: nextAuditId(), action: "Deactivated", actor: ACTOR, timestamp: formatTimestamp(), note: "Created inactive." });
      }
      const role = createRole({
        name: form.name.trim(), code: form.code.trim(), description: form.description.trim(),
        status: form.status, parentRoleId: form.parentRoleId || undefined,
      }, audit);
      toast.success(`Role "${role.name}" created.`);
      setFormOpen(null);
      navigate(`/config-role-permission-editor?role=${encodeURIComponent(role.id)}`);
      return;
    }
    // edit
    const id = formOpen.id!;
    const prev = rolesById[id];
    const changes: AuditChange[] = [];
    const push = (field: string, from: string, to: string) => { if (from !== to) changes.push({ field, from, to }); };
    push("name", prev.name, form.name.trim());
    push("code", prev.code, form.code.trim());
    push("description", prev.description, form.description.trim());
    push("parent", rolesById[prev.parentRoleId ?? ""]?.name ?? "—", rolesById[form.parentRoleId]?.name ?? "—");
    const statusChanged = prev.status !== form.status;
    if (changes.length === 0 && !statusChanged) { toast.message("No changes to save."); setFormOpen(null); return; }

    const audit: AuditEntry[] = [];
    if (changes.length) audit.push({ id: nextAuditId(), action: "Updated", actor: ACTOR, timestamp: formatTimestamp(), changes });
    if (statusChanged) audit.push({
      id: nextAuditId(), action: form.status === "Active" ? "Activated" : "Deactivated",
      actor: ACTOR, timestamp: formatTimestamp(),
    });
    updateRole(id, {
      name: form.name.trim(), code: form.code.trim(), description: form.description.trim(),
      status: form.status, parentRoleId: form.parentRoleId || undefined, updatedAt: formatDate(),
    }, audit);
    toast.success("Role updated.");
    setFormOpen(null);
  };

  const confirmToggle = () => {
    if (!toggleTarget) return;
    const next: RoleStatus = toggleTarget.status === "Active" ? "Inactive" : "Active";
    setStatus(toggleTarget.id, next, {
      id: nextAuditId(), action: next === "Active" ? "Activated" : "Deactivated",
      actor: ACTOR, timestamp: formatTimestamp(),
    });
    toast.success(`Role ${next === "Active" ? "activated" : "deactivated"}.`);
    setToggleTarget(null);
  };

  const parentOptions = (excludeId?: string) => roles.filter(r => r.id !== excludeId);

  const memberList = membersRole
    ? membersRole.memberList.filter(m => {
        const q = memberSearch.trim().toLowerCase();
        if (!q) return true;
        return [m.name, m.id, m.email, m.designation, m.section, m.department].some(v => v.toLowerCase().includes(q));
      })
    : [];

  return (
    <>
      <PageHeader
        title="Role Setup"
        subtitle="Create and manage roles — identity, status, inheritance and members. Grants are configured in the Role Permission Editor."
        actions={<Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" /> New Role</Button>}
      />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {([
          ["Total Roles", counts.All, ShieldCheck],
          ["Active", counts.Active, Power],
          ["Inactive", counts.Inactive, PowerOff],
          ["Catalogued Permissions", TOTAL_CATALOGED, GitBranch],
        ] as const).map(([label, value, Icon]) => (
          <Card key={label}>
            <CardContent className="py-3 px-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
              </div>
              <Icon className="h-5 w-5 text-primary/70" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="py-4">
          {/* Filter bar */}
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div className="inline-flex items-center gap-1 rounded-md border border-border p-0.5">
              {(["All", "Active", "Inactive"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-2.5 py-1 text-xs rounded ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t} <span className="tabular-nums opacity-70">{counts[t]}</span>
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name, code or ID…"
                className="h-8 pl-8 w-64"
              />
            </div>
          </div>

          <div className="rounded-md border border-border overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-10">SL</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="min-w-[160px]">Coverage</TableHead>
                  <TableHead className="text-center">Members</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last modified</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r, i) => {
                  const granted = coverage(r);
                  const pct = TOTAL_CATALOGED ? Math.round((granted / TOTAL_CATALOGED) * 100) : 0;
                  const st = STATUS_STYLE[r.status];
                  const parent = r.parentRoleId ? rolesById[r.parentRoleId] : null;
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setViewId(r.id)}>
                      <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 font-medium">
                          {r.name}
                          {r.isSystem && <Lock className="h-3 w-3 text-muted-foreground" aria-label="System role" />}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          <span className="font-mono">{r.code}</span>
                          {parent && <span className="ml-1.5 inline-flex items-center gap-0.5"><GitBranch className="h-2.5 w-2.5" /> {parent.name}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-1.5 w-24" />
                          <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{granted}/{TOTAL_CATALOGED}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          className="text-sm tabular-nums hover:text-primary inline-flex items-center gap-1"
                          onClick={e => { e.stopPropagation(); setMembersId(r.id); setMemberSearch(""); }}
                        >
                          <Users className="h-3 w-3" /> {r.members}
                        </button>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border"
                          style={{ color: st.color, background: st.bg, borderColor: st.border }}>
                          {r.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{r.updatedAt}</TableCell>
                      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => setViewId(r.id)}><Eye className="h-3.5 w-3.5 mr-2" /> View</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5 mr-2" /> Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/config-role-permission-editor?role=${encodeURIComponent(r.id)}`)}>
                              <ShieldCheck className="h-3.5 w-3.5 mr-2" /> Permissions
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setAuditId(r.id)}><History className="h-3.5 w-3.5 mr-2" /> Audit trail</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {!r.isSystem ? (
                              <DropdownMenuItem onClick={() => setToggleTarget(r)}>
                                {r.status === "Active"
                                  ? <><PowerOff className="h-3.5 w-3.5 mr-2" /> Deactivate</>
                                  : <><Power className="h-3.5 w-3.5 mr-2" /> Activate</>}
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem disabled><Lock className="h-3.5 w-3.5 mr-2" /> System role</DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No roles match your filters.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Create / Edit dialog ─────────────────────────────────────────────── */}
      <Dialog open={formOpen !== null} onOpenChange={o => !o && setFormOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{formOpen?.mode === "create" ? "Create New Role" : "Edit Role"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Role name <span className="text-destructive">*</span></Label>
                <Input
                  autoFocus value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  onBlur={() => { if (formOpen?.mode === "create" && !form.code && form.name) setForm(f => ({ ...f, code: formatCode(f.name) })); }}
                  placeholder="e.g. Cold Kitchen Supervisor"
                  className={`mt-1 ${errors.name ? "border-destructive" : ""}`}
                />
                {errors.name && <p className="text-[11px] text-destructive mt-1">{errors.name}</p>}
              </div>
              <div>
                <Label className="text-xs">Role code <span className="text-destructive">*</span></Label>
                <Input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: formatCode(e.target.value) }))}
                  placeholder="COLD_KITCHEN_SUP"
                  className={`mt-1 font-mono ${errors.code ? "border-destructive" : ""}`}
                />
                {errors.code && <p className="text-[11px] text-destructive mt-1">{errors.code}</p>}
              </div>
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What can this role do?"
                className="mt-1 min-h-[64px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Inherit from (parent role)</Label>
                <Select value={form.parentRoleId || "none"} onValueChange={v => setForm(f => ({ ...f, parentRoleId: v === "none" ? "" : v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {parentOptions(formOpen?.id).map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as RoleStatus }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Inheritance unions the parent role's effective grants with this role's own — child grants win on conflict.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(null)}>Cancel</Button>
            <Button onClick={submitForm}>{formOpen?.mode === "create" ? "Create role" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={viewRole !== null} onOpenChange={o => !o && setViewId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2">{viewRole?.name} {viewRole?.isSystem && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}</DialogTitle></DialogHeader>
          {viewRole && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Code" value={<span className="font-mono">{viewRole.code}</span>} />
                <Field label="Status" value={viewRole.status} />
                <Field label="Members" value={String(viewRole.members)} />
                <Field label="Coverage" value={`${coverage(viewRole)}/${TOTAL_CATALOGED}`} />
                <Field label="Inherits from" value={viewRole.parentRoleId ? rolesById[viewRole.parentRoleId]?.name ?? "—" : "—"} />
                <Field label="Last modified" value={`${viewRole.updatedAt} · ${viewRole.modifiedBy}`} />
              </div>
              <Field label="Description" value={viewRole.description} />
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => { const id = viewRole.id; setViewId(null); navigate(`/config-role-permission-editor?role=${encodeURIComponent(id)}`); }}>
                  <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Manage permissions
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setViewId(null); openEdit(viewRole); }}><Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Audit dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={auditRole !== null} onOpenChange={o => !o && setAuditId(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Audit Trail — {auditRole?.name}</DialogTitle></DialogHeader>
          {auditRole && (
            <>
              <div className="flex gap-2 mb-1">
                <Button size="sm" variant="outline" onClick={() => exportAuditExcel(auditRole)}><FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Excel</Button>
                <Button size="sm" variant="outline" onClick={() => exportAuditPdf(auditRole)}><FileText className="h-3.5 w-3.5 mr-1.5" /> PDF</Button>
                <Button size="sm" variant="outline" onClick={() => exportAuditWord(auditRole)}><Download className="h-3.5 w-3.5 mr-1.5" /> Word</Button>
              </div>
              <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-1">
                {[...auditRole.auditLog].reverse().map(a => {
                  const style = AUDIT_STYLE[a.action];
                  return (
                    <div key={a.id} className="rounded-md border border-border p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: style.color }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: style.dot }} /> {a.action}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{a.timestamp}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">by {a.actor}</div>
                      {a.note && <div className="text-xs mt-1">{a.note}</div>}
                      {a.changes?.map((c, idx) => (
                        <div key={idx} className="text-[11px] mt-1">
                          <span className="text-muted-foreground">{c.field}:</span> <span className="line-through opacity-60">{c.from}</span> → <span className="font-medium">{c.to}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Members dialog ───────────────────────────────────────────────────── */}
      <Dialog open={membersRole !== null} onOpenChange={o => !o && setMembersId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Members — {membersRole?.name}</DialogTitle></DialogHeader>
          {membersRole && (
            <>
              <div className="relative mb-2">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder="Search members…" className="h-8 pl-8" />
              </div>
              {membersRole.memberList.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8 flex flex-col items-center gap-2 w-full">
                  <Users className="h-6 w-6 opacity-50" /> No members assigned yet.
                </div>
              ) : (
                <div className="rounded-md border border-border overflow-x-auto max-h-[50vh] overflow-y-auto">
                  <Table>
                    <TableHeader className="bg-muted/40 sticky top-0">
                      <TableRow>
                        <TableHead>Name</TableHead><TableHead>Designation</TableHead>
                        <TableHead>Section</TableHead><TableHead>Department</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {memberList.map(m => (
                        <TableRow key={m.id}>
                          <TableCell>
                            <div className="font-medium">{m.name}</div>
                            <div className="text-[11px] text-muted-foreground">{m.id} · {m.email}</div>
                          </TableCell>
                          <TableCell className="text-sm">{m.designation}</TableCell>
                          <TableCell className="text-sm">{m.section}</TableCell>
                          <TableCell className="text-sm">{m.department}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {membersRole.members > membersRole.memberList.length && (
                <p className="text-[11px] text-muted-foreground">Showing {membersRole.memberList.length} of {membersRole.members} tagged members.</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Activate / deactivate confirm ────────────────────────────────────── */}
      <Dialog open={toggleTarget !== null} onOpenChange={o => !o && setToggleTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{toggleTarget?.status === "Active" ? "Deactivate" : "Activate"} “{toggleTarget?.name}”?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {toggleTarget?.status === "Active"
              ? "Members acting as this role will lose access until it is reactivated."
              : "This role becomes assignable again and its members regain access."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToggleTarget(null)}>Cancel</Button>
            <Button
              className={toggleTarget?.status === "Active" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              onClick={confirmToggle}
            >
              {toggleTarget?.status === "Active" ? <><PowerOff className="h-4 w-4 mr-1.5" /> Deactivate</> : <><Power className="h-4 w-4 mr-1.5" /> Activate</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm mt-0.5">{value}</div>
    </div>
  );
}
