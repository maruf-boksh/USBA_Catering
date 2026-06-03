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
import { Badge } from "@/components/ui/badge";
import { Plus, ArrowLeft, Save, Warehouse as WarehouseIcon, Snowflake, ChefHat } from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  offices, warehouses as SEED,
  type Warehouse, type WarehouseType,
} from "@/lib/sample-data";

const TYPES: WarehouseType[] = ["Warehouse", "Cold Store", "Kitchen"];
const CITIES = ["Dhaka", "Chittagong", "Sylhet", "Cox's Bazar", "Jessore"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function ConfigWarehousePage() {
  const [rows, setRows] = usePersistedState<Warehouse[]>("config-warehouse-rows", SEED);
  const [view, setView] = useState<"list" | "create">("list");

  const toggle = (id: string) =>
    setRows((p) =>
      p.map((r) => (r.id === id ? { ...r, status: r.status === "Active" ? "Inactive" : "Active" } : r)),
    );

  const add = (w: Warehouse) => {
    setRows((p) => [w, ...p]);
    setView("list");
  };

  const warehouseCount = rows.filter((r) => r.type === "Warehouse").length;
  const coldStoreCount = rows.filter((r) => r.type === "Cold Store").length;
  const kitchenCount = rows.filter((r) => r.type === "Kitchen").length;

  return (
    <>
      <PageHeader
        title="Warehouse"
        subtitle="Warehouses, cold stores and kitchens — each one sits under an office"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create" ? (
              <><ArrowLeft className="h-4 w-4 mr-1" /> Back</>
            ) : (
              <><Plus className="h-4 w-4 mr-1" /> Create Warehouse</>
            )}
          </Button>
        }
      />
      {view === "list" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiCard label="Warehouses" value={warehouseCount} icon={WarehouseIcon} tone="navy"    />
            <KpiCard label="Cold Stores" value={coldStoreCount} icon={Snowflake}     tone="success" />
            <KpiCard label="Kitchens"    value={kitchenCount}   icon={ChefHat}       tone="warning" />
          </div>
          <WarehouseList data={rows} onToggle={toggle} />
        </>
      ) : (
        <WarehouseCreate
          nextId={`WH-${String(rows.length + 1).padStart(3, "0")}`}
          onSave={add}
        />
      )}
    </>
  );
}

function WarehouseList({ data, onToggle }: { data: Warehouse[]; onToggle: (id: string) => void }) {
  const officeName = (id: string) => offices.find((o) => o.id === id)?.name || "—";
  const cols: Column<Warehouse>[] = [
    { key: "id", header: "ID" },
    {
      key: "code", header: "Code",
      render: (r) => <span className="font-mono text-xs">{r.code}</span>,
    },
    { key: "name", header: "Warehouse Name" },
    {
      key: "type", header: "Type",
      render: (r) => <Badge variant="outline" className="font-normal">{r.type}</Badge>,
    },
    {
      key: "officeId", header: "Office",
      render: (r) => <span>{officeName(r.officeId)}</span>,
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
      title="warehouses"
      data={data}
      columns={cols}
      searchKeys={["id", "code", "name", "type", "city", "manager"]}
      selectable={false}
      actions={(r) => <RowActions row={r} actions={["view", "edit", "print"]} />}
    />
  );
}

function WarehouseCreate({ nextId, onSave }: { nextId: string; onSave: (w: Warehouse) => void }) {
  const activeOffices = offices.filter((o) => o.status === "Active");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [officeId, setOfficeId] = useState(activeOffices[0]?.id ?? "");
  const [type, setType] = useState<WarehouseType>(TYPES[0]);
  const [city, setCity] = useState(CITIES[0]);
  const [address, setAddress] = useState("");
  const [manager, setManager] = useState("");
  const [phone, setPhone] = useState("");

  const save = () => {
    if (!name.trim()) { toast.error("Warehouse name is required."); return; }
    if (!code.trim()) { toast.error("Warehouse code is required."); return; }
    if (!officeId)    { toast.error("Select an office."); return; }
    onSave({
      id: nextId,
      code: code.trim().toUpperCase(),
      name: name.trim(),
      officeId,
      type, city, address, manager, phone,
      status: "Active",
    });
    toast.success(`Warehouse "${name.trim()}" created.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Create Warehouse</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Warehouse ID</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Code <span className="text-destructive">*</span>
            </Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1" placeholder="e.g. WH-DAC-02" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Warehouse Name <span className="text-destructive">*</span>
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Office <span className="text-destructive">*</span>
            </Label>
            <select
              value={officeId}
              onChange={(e) => setOfficeId(e.target.value)}
              className={selectCls}
            >
              {activeOffices.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Type</Label>
            <select value={type} onChange={(e) => setType(e.target.value as WarehouseType)} className={selectCls}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">City</Label>
            <select value={city} onChange={(e) => setCity(e.target.value)} className={selectCls}>
              {CITIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Manager</Label>
            <Input value={manager} onChange={(e) => setManager(e.target.value)} className="mt-1" />
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
      </CardContent>
    </Card>
  );
}
