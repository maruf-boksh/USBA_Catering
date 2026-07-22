import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { ShieldCheck, Lock, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRole } from "@/lib/roles";
import {
  ADMIN_ROLE, RBAC_TREE,
  useAllRoles, useAccess, useAdminRoles, isBuiltinRole, isAdminRole, can,
  createRole, renameRole, deleteRole,
} from "@/lib/access-control";

export default function ConfigAccessControlPage() {
  const { role: activeRole } = useRole();
  const roles = useAllRoles();
  const map = useAccess();
  useAdminRoles(); // re-render when admin promotions change
  const navigate = useNavigate();
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
            <p className="text-xs text-muted-foreground mt-1">Only <strong>Business Analyst</strong> can manage access control.</p>
          </CardContent>
        </Card>
      </>
    );
  }

  const totalPages = RBAC_TREE.reduce((s, m) => s + m.pages.length, 0);

  const openPermissions = (r: string) =>
    navigate(`/config-access-control/permissions?role=${encodeURIComponent(r)}`);

  const submitRoleDialog = () => {
    if (!roleDialog) return;
    const name = roleDialog.value.trim();
    const res = roleDialog.mode === "create"
      ? createRole(name)
      : renameRole(roleDialog.target ?? "", name);
    if (!res.ok) { toast.error(res.error ?? "Failed."); return; }
    const wasCreate = roleDialog.mode === "create";
    toast.success(wasCreate ? `Role "${name}" created.` : "Role renamed.");
    setRoleDialog(null);
    // Creating a role jumps straight into configuring its permissions.
    if (wasCreate) openPermissions(name);
  };

  const onDeleteRole = (target: string) => {
    const res = deleteRole(target);
    if (!res.ok) { toast.error(res.error ?? "Failed."); return; }
    toast.success(`Role "${target}" deleted.`);
    setDeleteTarget(null);
  };

  return (
    <>
      <PageHeader
        title="User Access Control"
        subtitle="Create roles and manage view / create / edit / delete permissions for every module, page, KPI card, column, field and action. Business Analyst always has full access."
      />

      {/* Roles — CRUD table. Open a role's permissions on its own page. */}
      <Card>
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
                  const isRoot = r === ADMIN_ROLE;
                  const admin = isAdminRole(r);
                  const builtin = isBuiltinRole(r);
                  const vp = RBAC_TREE.reduce(
                    (s, m) => s + m.pages.filter((p) => can(r, p.key, "view", map)).length, 0);
                  return (
                    <TableRow
                      key={r}
                      onClick={() => openPermissions(r)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {r}
                          {isRoot && <Lock className="h-3 w-3 text-muted-foreground" />}
                          {activeRole === r && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">previewing</Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`h-5 px-1.5 text-[10px] ${admin ? "border-primary/40 text-primary" : ""}`}
                        >
                          {admin ? "Administrator" : builtin ? "Built-in" : "Custom"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center tabular-nums whitespace-nowrap">
                        {admin ? "All" : `${vp}/${totalPages}`}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 w-6 p-0"
                            title="Manage permissions"
                            aria-label="Manage permissions"
                            onClick={() => openPermissions(r)}
                          >
                            <ShieldCheck className="h-3 w-3" />
                          </Button>
                          {!isRoot && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 w-6 p-0"
                                title="Rename role"
                                aria-label="Rename role"
                                onClick={() => setRoleDialog({ mode: "rename", value: r, target: r })}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 w-6 p-0 text-destructive"
                                title="Delete role"
                                aria-label="Delete role"
                                onClick={() => setDeleteTarget(r)}
                              >
                                <Trash2 className="h-3 w-3" />
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
          <p className="text-[11px] text-muted-foreground mt-3">
            Select a role (or click <ShieldCheck className="inline h-3 w-3 -mt-0.5" /> Manage permissions) to configure its access.
          </p>
        </CardContent>
      </Card>

      {/* Create / rename role dialog */}
      <Dialog open={roleDialog !== null} onOpenChange={(o) => !o && setRoleDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{roleDialog?.mode === "create" ? "Create New Role" : `Rename "${roleDialog?.target ?? ""}"`}</DialogTitle>
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
              New roles start with Dashboard access only — you'll be taken to its permissions page to grant more.
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
