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
import { Plus, ArrowLeft, Save, Boxes, AlertTriangle, Coffee } from "lucide-react";
import { toast } from "sonner";
import {
  consumableItems, items as MASTER_ITEMS,
  type ConsumableCategory, type ConsumableItem,
} from "@/lib/sample-data";
import { cn } from "@/lib/utils";

const CATEGORIES: ConsumableCategory[] = [
  "Napkin", "Cup", "Cutlery", "Tissue", "Amenity Kit", "Plastic Tray", "Packaging",
];
const UOMS = ["Pcs", "Kit", "Box", "Pack", "Roll"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function computeStatus(stock: number, reorder: number): "OK" | "Low" | "Critical" {
  if (stock < reorder * 0.5) return "Critical";
  if (stock < reorder) return "Low";
  return "OK";
}

export default function ConsumableInventoryPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [items, setItems] = usePersistedState<ConsumableItem[]>("airline-consumables-items", consumableItems);

  const nextId = `CNS-${String(items.length + 1).padStart(3, "0")}`;

  const addItem = (it: ConsumableItem) => {
    setItems((prev) => [it, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Consumables Inventory"
        subtitle="Disposable airline service items — napkins, cups, cutlery, tissues, amenity kits, trays and packaging"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> New Item</>}
          </Button>
        }
      />

      {view === "list"
        ? <ConsumableList items={items} />
        : <ConsumableCreate nextId={nextId} onSave={addItem} />}
    </>
  );
}

function ConsumableList({ items }: { items: ConsumableItem[] }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ConsumableCategory | "All">("All");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (category !== "All" && it.category !== category) return false;
      if (q && !it.name.toLowerCase().includes(q) && !it.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, category]);

  const totalItems = items.length;
  const lowStock = items.filter((i) => i.status === "Low").length;
  const critical = items.filter((i) => i.status === "Critical").length;
  const totalValue = items.reduce((s, i) => s + i.stock * i.unitCost, 0);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Items" value={totalItems} icon={Boxes} tone="navy" />
        <KpiCard label="Low Stock" value={lowStock} icon={AlertTriangle} tone="warning" />
        <KpiCard label="Critical" value={critical} icon={AlertTriangle} tone="red" />
        <KpiCard
          label="Stock Value"
          value={`৳ ${Math.round(totalValue).toLocaleString()}`}
          icon={Coffee}
          tone="success"
        />
      </div>

      <Card className="mb-4">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search consumables…"
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
              <TableHead className="text-xs uppercase tracking-wider">Code</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Category</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">UoM</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Stock</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Reorder</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Unit Cost</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Value</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Bin</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">
                  No items match the selected filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((it, i) => {
                const masterBin = MASTER_ITEMS.find(
                  (m) => m.name.toLowerCase() === it.name.toLowerCase(),
                )?.binLocation;
                const bin = masterBin ?? it.binLocation ?? "—";
                return (
                  <TableRow key={it.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{it.id}</TableCell>
                    <TableCell className="font-medium">{it.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{it.category}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{it.uom}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      <span className={it.status === "Critical" ? "text-destructive" : it.status === "Low" ? "text-warning" : ""}>
                        {it.stock.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{it.reorder.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">৳ {it.unitCost.toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      ৳ {Math.round(it.stock * it.unitCost).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {bin}
                        {masterBin && (
                          <Badge variant="outline" className="text-[9px] py-0 px-1 border-primary/30 bg-primary/5 text-primary">
                            profile
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell><StatusBadge status={it.status} /></TableCell>
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

function ConsumableCreate({ nextId, onSave }: { nextId: string; onSave: (it: ConsumableItem) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ConsumableCategory>("Napkin");
  const [uom, setUom] = useState("Pcs");
  const [stock, setStock] = useState("0");
  const [reorder, setReorder] = useState("0");
  const [unitCost, setUnitCost] = useState("");
  const [binLocation, setBinLocation] = useState("");

  const save = () => {
    if (!name.trim()) { toast.error("Item name is required."); return; }
    const s = Number(stock) || 0;
    const r = Number(reorder) || 0;
    const c = Number(unitCost) || 0;
    onSave({
      id: nextId,
      name: name.trim(),
      category,
      uom,
      stock: s,
      reorder: r,
      unitCost: c,
      binLocation: binLocation.trim() || undefined,
      status: computeStatus(s, r),
    });
    toast.success(`${name.trim()} added to consumables catalog.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Register Consumable Item</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Code</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cocktail Napkin" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Category</Label>
            <select value={category} onChange={(e) => setCategory(e.target.value as ConsumableCategory)} className={selectCls}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">UoM</Label>
            <select value={uom} onChange={(e) => setUom(e.target.value)} className={selectCls}>
              {UOMS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Opening Stock</Label>
            <Input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Reorder Level</Label>
            <Input type="number" min={0} value={reorder} onChange={(e) => setReorder(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Unit Cost (৳)</Label>
            <Input type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00" className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Bin Location</Label>
            <Input
              value={binLocation}
              onChange={(e) => setBinLocation(e.target.value)}
              placeholder="e.g. A1-R1-S1"
              className="mt-1 font-mono"
            />
          </div>
        </div>
        <div className="mt-4 text-[11px] text-muted-foreground bg-muted/40 border border-border rounded px-3 py-2">
          Status is auto-computed: <span className="font-semibold text-destructive">Critical</span> when stock &lt; 50% of reorder,
          {" "}<span className="font-semibold text-warning">Low</span> when stock &lt; reorder, else <span className="font-semibold text-success">OK</span>.
        </div>
      </CardContent>
    </Card>
  );
}
