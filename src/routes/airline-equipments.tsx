import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, ArrowLeft, Save, Boxes, Wrench, ShieldAlert, ScanBarcode, Truck,
} from "lucide-react";
import { toast } from "sonner";
import {
  equipmentAssets as SEED_ASSETS,
  type EquipmentCategory, type EquipmentAsset,
} from "@/lib/sample-data";
import { cn } from "@/lib/utils";

const CATEGORIES: EquipmentCategory[] = [
  "Trolley", "Oven Rack", "Container", "Tray", "Galley Insert", "Hot Box",
];
const STATUSES: EquipmentAsset["status"][] = [
  "In Service", "In Maintenance", "Damaged", "Retired",
];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function EquipmentAssetsPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [assets, setAssets] = usePersistedState<EquipmentAsset[]>("airline-equipments-assets", SEED_ASSETS);

  const nextId = useMemo(() => `EQP-NEW-${String(assets.length + 1).padStart(3, "0")}`, [assets]);

  const addAsset = (a: EquipmentAsset) => {
    setAssets((prev) => [a, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Equipment Assets"
        subtitle="Reusable airline equipment register — trolleys, oven racks, containers, trays, galley inserts and hot boxes"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> Register Asset</>}
          </Button>
        }
      />

      {view === "list"
        ? <AssetList assets={assets} />
        : <AssetCreate nextId={nextId} onSave={addAsset} />}
    </>
  );
}

function AssetList({ assets }: { assets: EquipmentAsset[] }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<EquipmentCategory | "All">("All");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (category !== "All" && a.category !== category) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.id.toLowerCase().includes(q)
        && !(a.rfidTag ?? "").toLowerCase().includes(q)
        && !a.serialNo.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assets, search, category]);

  const today = new Date().toISOString().slice(0, 10);
  const cutoff30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const totalAssets = assets.length;
  const inService = assets.filter((a) => a.status === "In Service").length;
  const maintenanceDue = assets.filter(
    (a) => a.status !== "Damaged" && a.status !== "Retired" && a.nextMaintenance <= cutoff30,
  ).length;
  const damaged = assets.filter((a) => a.status === "Damaged").length;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Assets" value={totalAssets} icon={Boxes} tone="navy" />
        <KpiCard label="In Service" value={inService} icon={Truck} tone="success" />
        <KpiCard label="Maintenance Due (30d)" value={maintenanceDue} icon={Wrench} tone="warning" />
        <KpiCard label="Damaged" value={damaged} icon={ShieldAlert} tone="red" />
      </div>

      <Card className="mb-4">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by asset id, name, serial or RFID tag…"
                className="h-9"
              />
            </div>
            <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 shadow-sm flex-wrap">
              {(["All", ...CATEGORIES] as const).map((c) => {
                const active = category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c as typeof category)}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-medium rounded-sm transition-colors",
                      active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-14 text-xs uppercase tracking-wider">SL</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Asset ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Name</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Category</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Serial</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">RFID Tag</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Location</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Next Maint.</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                  No assets match the selected filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((a, i) => {
                const overdue = a.status !== "Damaged" && a.status !== "Retired" && a.nextMaintenance <= today;
                const due = !overdue && a.status !== "Damaged" && a.status !== "Retired" && a.nextMaintenance <= cutoff30;
                return (
                  <TableRow key={a.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{a.id}</TableCell>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{a.category}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{a.serialNo}</TableCell>
                    <TableCell className="font-mono text-[11px]">
                      {a.rfidTag ? (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <ScanBarcode className="h-3 w-3" />
                          {a.rfidTag}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">{a.location}</TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {a.nextMaintenance}
                      {overdue && <span className="ml-1 text-[10px] text-destructive font-semibold">OVERDUE</span>}
                      {due && <span className="ml-1 text-[10px] text-warning font-semibold">DUE</span>}
                    </TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function AssetCreate({ nextId, onSave }: { nextId: string; onSave: (a: EquipmentAsset) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const sixMonthsOut = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<EquipmentCategory>("Trolley");
  const [serialNo, setSerialNo] = useState("");
  const [rfidTag, setRfidTag] = useState("");
  const [location, setLocation] = useState("");
  const [lastMaintenance, setLastMaintenance] = useState(today);
  const [nextMaintenance, setNextMaintenance] = useState(sixMonthsOut);
  const [status, setStatus] = useState<EquipmentAsset["status"]>("In Service");

  const save = () => {
    if (!name.trim()) { toast.error("Asset name is required."); return; }
    if (!serialNo.trim()) { toast.error("Serial number is required."); return; }
    if (!location.trim()) { toast.error("Location is required."); return; }
    onSave({
      id: nextId,
      name: name.trim(),
      category,
      serialNo: serialNo.trim().toUpperCase(),
      rfidTag: rfidTag.trim() || undefined,
      location: location.trim(),
      lastMaintenance,
      nextMaintenance,
      status,
    });
    toast.success(`${name.trim()} registered as ${nextId}.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Register Equipment Asset</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Asset ID</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Full Size Meal Trolley" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Category</Label>
            <select value={category} onChange={(e) => setCategory(e.target.value as EquipmentCategory)} className={selectCls}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Status</Label>
            <select value={status} onChange={(e) => setStatus(e.target.value as EquipmentAsset["status"])} className={selectCls}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Serial No. *</Label>
            <Input value={serialNo} onChange={(e) => setSerialNo(e.target.value)} placeholder="e.g. TR-004" className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">RFID Tag</Label>
            <Input value={rfidTag} onChange={(e) => setRfidTag(e.target.value)} placeholder="e.g. RF-TR0004" className="mt-1 font-mono" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Current Location *</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Hot Kitchen, BG-401, Damaged Pool" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Last Maintenance</Label>
            <Input type="date" value={lastMaintenance} onChange={(e) => setLastMaintenance(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Next Maintenance</Label>
            <Input type="date" value={nextMaintenance} onChange={(e) => setNextMaintenance(e.target.value)} className="mt-1 tabular-nums" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
