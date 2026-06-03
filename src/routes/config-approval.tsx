import { useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, ArrowLeft, Save, GitBranch, Trash2, CheckCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Stage = { stage: number; role: string; user?: string; limit?: string };

type Workflow = {
  id: string;
  module: string;
  name: string;
  stages: Stage[];
  active: boolean;
};

const MODULES = [
  "Purchase Requisition",
  "Purchase Order",
  "Goods Receipt",
  "Stock Adjustment",
  "Demand Request",
  "Item Issue",
  "Invoice Payment",
];

const ROLES = [
  "Department Head",
  "Store Manager",
  "Procurement Manager",
  "Finance Manager",
  "GM/Admin",
  "CFO",
  "CEO",
];

// Candidate approvers (named users) per approval role. Selecting a role filters
// the User dropdown to the people who hold that role.
const USERS_BY_ROLE: Record<string, string[]> = {
  "Department Head":     ["S. Ahmed", "K. Rahman"],
  "Store Manager":       ["F. Begum", "H. Uddin"],
  "Procurement Manager": ["Md. Karim", "R. Chowdhury"],
  "Finance Manager":     ["A. Haque", "S. Nahar"],
  "GM/Admin":            ["R. Hossain"],
  "CFO":                 ["M. Alam"],
  "CEO":                 ["T. Rahman"],
};

const usersFor = (role: string): string[] => USERS_BY_ROLE[role] ?? [];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const SEED: Workflow[] = [
  {
    id: "WF-001", module: "Purchase Requisition", name: "Standard PR Approval", active: true,
    stages: [
      { stage: 1, role: "Department Head" },
      { stage: 2, role: "Procurement Manager", limit: "≤ ৳ 5,00,000" },
      { stage: 3, role: "GM/Admin", limit: "> ৳ 5,00,000" },
    ],
  },
  {
    id: "WF-002", module: "Purchase Order", name: "PO Approval Chain", active: true,
    stages: [
      { stage: 1, role: "Procurement Manager" },
      { stage: 2, role: "Finance Manager", limit: "≤ ৳ 10,00,000" },
      { stage: 3, role: "CFO", limit: "> ৳ 10,00,000" },
    ],
  },
  {
    id: "WF-003", module: "Invoice Payment", name: "Payment Approval", active: true,
    stages: [
      { stage: 1, role: "Finance Manager", limit: "≤ ৳ 2,00,000" },
      { stage: 2, role: "CFO", limit: "> ৳ 2,00,000" },
    ],
  },
  {
    id: "WF-004", module: "Stock Adjustment", name: "Adjustment Sign-off", active: false,
    stages: [
      { stage: 1, role: "Store Manager" },
      { stage: 2, role: "GM/Admin" },
    ],
  },
];

export default function ConfigApprovalPage() {
  const [rows, setRows] = usePersistedState<Workflow[]>("config-approval-rows", SEED);
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [viewing, setViewing] = useState<Workflow | null>(null);

  const toggle = (id: string) =>
    setRows((p) => p.map((r) => (r.id === id ? { ...r, active: !r.active } : r)));

  // Save handles both create (new id) and edit (existing id).
  const save = (wf: Workflow) => {
    setRows((p) => (p.some((r) => r.id === wf.id) ? p.map((r) => (r.id === wf.id ? wf : r)) : [wf, ...p]));
    setView("list");
    setEditing(null);
  };

  const startCreate = () => { setEditing(null); setView("form"); };
  const startEdit = (wf: Workflow) => { setEditing(wf); setView("form"); };
  const backToList = () => { setEditing(null); setView("list"); };

  return (
    <>
      <PageHeader
        title="Approval Setup"
        subtitle="Configure multi-stage approval chains for procurement, finance and inventory documents"
        actions={
          <Button
            variant={view === "form" ? "outline" : "default"}
            onClick={() => (view === "form" ? backToList() : startCreate())}
          >
            {view === "form" ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back</> : <><Plus className="h-4 w-4 mr-1" /> Create Workflow</>}
          </Button>
        }
      />

      {view === "list" ? (
        <ApprovalList
          data={rows}
          onToggle={toggle}
          onView={(wf) => setViewing(wf)}
          onEdit={startEdit}
        />
      ) : (
        <ApprovalForm
          initial={editing}
          nextId={`WF-${String(rows.length + 1).padStart(3, "0")}`}
          onSave={save}
        />
      )}

      <ApprovalViewDialog workflow={viewing} onClose={() => setViewing(null)} onEdit={(wf) => { setViewing(null); startEdit(wf); }} />
    </>
  );
}

const StageChain = ({ stages }: { stages: Stage[] }) => (
  <div className="flex items-center gap-1 flex-wrap">
    {stages.map((s, i) => (
      <div key={s.stage} className="flex items-center gap-1">
        <Badge variant="outline" className="font-normal text-xs">
          {s.role}
          {s.user && <span className="ml-1 text-muted-foreground">· {s.user}</span>}
          {s.limit && <span className="ml-1 text-[10px] text-muted-foreground">({s.limit})</span>}
        </Badge>
        {i < stages.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
      </div>
    ))}
  </div>
);

function ApprovalViewDialog({ workflow, onClose, onEdit }: { workflow: Workflow | null; onClose: () => void; onEdit: (wf: Workflow) => void }) {
  return (
    <Dialog open={workflow !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            {workflow?.name} <span className="font-mono text-xs text-muted-foreground">({workflow?.id})</span>
          </DialogTitle>
        </DialogHeader>
        {workflow && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Module</div>
                <div className="font-medium">{workflow.module}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</div>
                <span className={cn("text-sm font-medium", workflow.active ? "text-success" : "text-muted-foreground")}>
                  {workflow.active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Approval Chain</div>
              <div className="space-y-2">
                {workflow.stages.map((s) => (
                  <div key={s.stage} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">{s.stage}</div>
                    <div className="text-sm font-medium flex-1">
                      {s.role}
                      {s.user && <span className="text-muted-foreground font-normal"> · {s.user}</span>}
                    </div>
                    {s.limit && <div className="text-xs text-muted-foreground">{s.limit}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {workflow && <Button onClick={() => onEdit(workflow)}>Edit</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalList({ data, onToggle, onView, onEdit }: {
  data: Workflow[];
  onToggle: (id: string) => void;
  onView: (wf: Workflow) => void;
  onEdit: (wf: Workflow) => void;
}) {
  const cols: Column<Workflow>[] = [
    { key: "id", header: "Workflow #" },
    { key: "module", header: "Module" },
    { key: "name", header: "Workflow Name" },
    {
      key: "stages",
      header: "Approval Chain",
      render: (r) => <StageChain stages={r.stages} />,
    },
    {
      key: "active",
      header: "Status",
      render: (r) => (
        <div className="flex items-center gap-2">
          <Switch checked={r.active} onCheckedChange={() => onToggle(r.id)} />
          <span className={cn("text-xs font-medium", r.active ? "text-success" : "text-muted-foreground")}>
            {r.active ? "Active" : "Inactive"}
          </span>
        </div>
      ),
    },
  ];
  return (
    <DataTable
      title="workflows"
      data={data}
      columns={cols}
      searchKeys={["id", "module", "name"]}
      selectable={false}
      actions={(r) => (
        <RowActions
          row={r as unknown as Record<string, unknown>}
          actions={["view", "edit", "print"]}
          onView={() => onView(r)}
          onEdit={() => onEdit(r)}
        />
      )}
    />
  );
}

function ApprovalForm({ initial, nextId, onSave }: { initial: Workflow | null; nextId: string; onSave: (wf: Workflow) => void }) {
  const isEdit = initial !== null;
  const id = initial?.id ?? nextId;
  const [module, setModule] = useState(initial?.module ?? MODULES[0]);
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(ROLES[0]);
  const [user, setUser] = useState(usersFor(ROLES[0])[0] ?? "");
  const [limit, setLimit] = useState("");
  const [stages, setStages] = useState<Stage[]>(initial?.stages ?? []);

  // When the role changes, default the user to the first approver of that role.
  const onRoleChange = (next: string) => {
    setRole(next);
    setUser(usersFor(next)[0] ?? "");
  };

  const addStage = () => {
    setStages((p) => [...p, { stage: p.length + 1, role, user: user || undefined, limit: limit.trim() || undefined }]);
    setLimit("");
  };

  const removeStage = (idx: number) =>
    setStages((p) => p.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stage: i + 1 })));

  const save = () => {
    if (!name.trim()) { toast.error("Workflow name is required."); return; }
    if (stages.length === 0) { toast.error("Add at least one approval stage."); return; }
    onSave({ id, module, name: name.trim(), stages, active: initial?.active ?? true });
    toast.success(
      isEdit
        ? `Workflow "${name.trim()}" updated (${stages.length} stage${stages.length > 1 ? "s" : ""}).`
        : `Workflow "${name.trim()}" created with ${stages.length} stage${stages.length > 1 ? "s" : ""}.`,
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" /> {isEdit ? `Edit Workflow` : "Workflow"}
            </h3>
            <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> {isEdit ? "Save Changes" : "Save"}</Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Workflow #</Label>
              <Input value={id} disabled className="mt-1 font-mono" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Module <span className="text-destructive">*</span></Label>
              <select value={module} onChange={(e) => setModule(e.target.value)} className={selectCls}>
                {MODULES.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Workflow Name <span className="text-destructive">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" placeholder="e.g. Standard PR Approval" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-6">Approval Stages</h3>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Approver Role</Label>
              <select value={role} onChange={(e) => onRoleChange(e.target.value)} className={selectCls}>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">User</Label>
              <select
                value={user}
                onChange={(e) => setUser(e.target.value)}
                className={selectCls}
                disabled={usersFor(role).length === 0}
              >
                {usersFor(role).length === 0
                  ? <option value="">No users for this role</option>
                  : usersFor(role).map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div className="md:col-span-4">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Amount Limit (optional)</Label>
              <Input value={limit} onChange={(e) => setLimit(e.target.value)} className="mt-1" placeholder="e.g. ≤ ৳ 5,00,000" />
            </div>
            <div className="md:col-span-2">
              <Button variant="outline" onClick={addStage} className="w-full">
                <Plus className="h-4 w-4 mr-1" /> Add Stage
              </Button>
            </div>
          </div>

          <div className="mt-6 border border-border rounded-md overflow-hidden">
            {stages.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                No stages added yet. Build the approval chain by adding stages above.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {stages.map((s, idx) => (
                  <div key={s.stage} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30">
                    <div className="flex items-center gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                        {s.stage}
                      </div>
                      <CheckCircle className="h-4 w-4 text-success" />
                      <div>
                        <div className="text-sm font-medium">
                          {s.role}
                          {s.user && <span className="text-muted-foreground font-normal"> · {s.user}</span>}
                        </div>
                        {s.limit && <div className="text-xs text-muted-foreground">{s.limit}</div>}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => removeStage(idx)} aria-label={`Remove stage ${s.stage}`}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
