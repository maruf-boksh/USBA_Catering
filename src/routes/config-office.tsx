import { useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Plus, ArrowLeft, Save, Building2, CheckCircle, XCircle } from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { companies, offices as SEED, type Office } from "@/lib/sample-data";
import { rowEditors } from "@/lib/row-editors";

const CITIES = ["Dhaka", "Chittagong", "Sylhet", "Cox's Bazar", "Jessore"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function ConfigOfficePage() {
  const [rows, setRows] = usePersistedState<Office[]>("config-office-rows", SEED);
  const [view, setView] = useState<"list" | "create">("list");

  const toggle = (id: string) =>
    setRows((p) =>
      p.map((r) => (r.id === id ? { ...r, status: r.status === "Active" ? "Inactive" : "Active" } : r)),
    );

  const add = (off: Office) => {
    setRows((p) => [off, ...p]);
    setView("list");
  };

  const total = rows.length;
  const active = rows.filter((r) => r.status === "Active").length;

  return (
    <>
      <PageHeader
        title="Office"
        subtitle="Maintain offices under each company — head office, regional and station offices"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create" ? (
              <><ArrowLeft className="h-4 w-4 mr-1" /> Back</>
            ) : (
              <><Plus className="h-4 w-4 mr-1" /> Create Office</>
            )}
          </Button>
        }
      />
      {view === "list" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiCard label="Total Offices" value={total}            icon={Building2}  tone="navy" />
            <KpiCard label="Active"        value={active}           icon={CheckCircle} tone="success" />
            <KpiCard label="Inactive"      value={total - active}   icon={XCircle}    tone="warning" />
          </div>
          <OfficeList data={rows} onToggle={toggle} editors={rowEditors(setRows)} />
        </>
      ) : (
        <OfficeCreate
          nextId={`OFF-${String(rows.length + 1).padStart(3, "0")}`}
          onSave={add}
        />
      )}
    </>
  );
}

const GROUP_NAME = "US-Bangla Group";

function OfficeList({ data, onToggle, editors }: { data: Office[]; onToggle: (id: string) => void; editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void } }) {
  const cols: Column<Office>[] = [
    { key: "id", header: "ID" },
    {
      key: "code", header: "Code",
      render: (r) => <span className="font-mono text-xs">{r.code}</span>,
    },
    { key: "name", header: "Office Name" },
    {
      key: "companyId", header: "Company",
      render: () => <span>{GROUP_NAME}</span>,
    },
    { key: "city", header: "City" },
    { key: "manager", header: "Manager" },
    {
      key: "status", header: "Status",
      render: (r) => {
        const a = r.status === "Active";
        return (
          <div className="flex items-center gap-2">
            <Switch checked={a} onCheckedChange={() => onToggle(r.id)} />
            <span className={cn("text-xs font-medium", a ? "text-success" : "text-muted-foreground")}>
              {r.status}
            </span>
          </div>
        );
      },
    },
  ];
  return (
    <DataTable
      title="offices"
      data={data}
      columns={cols}
      searchKeys={["id", "code", "name", "city", "manager"]}
      selectable={false}
      actions={(r) => (
        <RowActions
          row={r}
          actions={["view", "edit", "print"]}
          onSave={editors.onSave}
          editDetail={({ save, close }) => <OfficeFields mode="edit" initial={r} onSubmit={save} onClose={close} />}
        />
      )}
    />
  );
}

function OfficeCreate({ nextId, onSave }: { nextId: string; onSave: (o: Office) => void }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <OfficeFields mode="create" nextId={nextId} onSave={onSave} />
      </CardContent>
    </Card>
  );
}

/**
 * Shared Office form fields. Used by the Create page (mode="create") and the
 * row Edit modal (mode="edit", pre-filled from `initial`) so both share an
 * identical layout.
 */
function OfficeFields({
  mode, nextId, initial, onSave, onSubmit, onClose,
}: {
  mode: "create" | "edit";
  nextId?: string;
  initial?: Office;
  onSave?: (o: Office) => void;
  onSubmit?: (patch: Record<string, unknown>) => void;
  onClose?: () => void;
}) {
  const isEdit = mode === "edit";
  const groupCompanyId = companies[0]?.id ?? "";
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [city, setCity] = useState(initial?.city ?? CITIES[0]);
  const [address, setAddress] = useState(initial?.address ?? "");
  const [manager, setManager] = useState(initial?.manager ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");

  const save = () => {
    if (!name.trim()) { toast.error("Office name is required."); return; }
    if (!code.trim()) { toast.error("Office code is required."); return; }
    const payload = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      companyId: groupCompanyId,
      city, address, manager, phone,
    };
    if (isEdit) {
      onSubmit?.(payload);
      onClose?.();
    } else {
      onSave?.({ id: nextId!, ...payload, status: "Active" });
      toast.success(`Office "${name.trim()}" created.`);
    }
  };

  return (
    <>
      {!isEdit && (
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Create Office</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save</Button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Office ID</Label>
          <Input value={initial?.id ?? nextId ?? ""} disabled className="mt-1 font-mono" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Code <span className="text-destructive">*</span>
          </Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1" placeholder="e.g. HQ-DAC" />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Office Name <span className="text-destructive">*</span>
          </Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Company</Label>
          <Input value={GROUP_NAME} disabled className="mt-1" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">City</Label>
          <select value={city} onChange={(e) => setCity(e.target.value)} className={selectCls}>
            {CITIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Manager</Label>
          <Input value={manager} onChange={(e) => setManager(e.target.value)} className="mt-1" placeholder="Office manager" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" placeholder="+880 1XXX-XXXXXX" />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Address</Label>
          <Textarea value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1" rows={2} />
        </div>
      </div>
      {isEdit && (
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save Changes</Button>
        </div>
      )}
    </>
  );
}
