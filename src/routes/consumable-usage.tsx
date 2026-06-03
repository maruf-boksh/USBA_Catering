import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, ArrowLeft, Save, Send, Plane, Layers, Coins } from "lucide-react";
import { toast } from "sonner";
import {
  consumableUsage as SEED_USAGE,
  consumableItems,
  type ConsumableUsage,
} from "@/lib/sample-data";

const CABIN_CLASSES = ["Y", "B", "F"] as const;

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function ConsumableUsagePage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [usage, setUsage] = usePersistedState<ConsumableUsage[]>("consumable-usage", SEED_USAGE);

  const nextId = `CU-${String(9000 + usage.length + 1).padStart(4, "0")}`;

  const addUsage = (u: ConsumableUsage) => {
    setUsage((prev) => [u, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Consumable Usage Tracking"
        subtitle="Per-flight consumption log for napkins, cups, cutlery, kits and packaging materials"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> New Usage Entry</>}
          </Button>
        }
      />

      {view === "list"
        ? <UsageList usage={usage} />
        : <UsageCreate nextId={nextId} onSave={addUsage} />}
    </>
  );
}

function UsageList({ usage }: { usage: ConsumableUsage[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return usage;
    return usage.filter(
      (u) =>
        u.flight.toLowerCase().includes(q) ||
        u.itemName.toLowerCase().includes(q) ||
        u.itemId.toLowerCase().includes(q) ||
        u.sector.toLowerCase().includes(q),
    );
  }, [usage, search]);

  const totalEntries = usage.length;
  const totalQty = usage.reduce((s, u) => s + u.qty, 0);
  const flightsCovered = new Set(usage.map((u) => u.flight)).size;
  const totalValue = usage.reduce((s, u) => {
    const item = consumableItems.find((i) => i.id === u.itemId);
    return s + u.qty * (item?.unitCost ?? 0);
  }, 0);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Usage Entries" value={totalEntries} icon={Send} tone="navy" />
        <KpiCard label="Flights Covered" value={flightsCovered} icon={Plane} tone="success" />
        <KpiCard label="Total Units Loaded" value={totalQty.toLocaleString()} icon={Layers} tone="warning" />
        <KpiCard
          label="Total Value"
          value={`৳ ${Math.round(totalValue).toLocaleString()}`}
          icon={Coins}
          tone="success"
        />
      </div>

      <Card className="mb-4">
        <CardContent className="pt-5">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by flight, sector, item code or item name…"
            className="h-9"
          />
        </CardContent>
      </Card>

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-14 text-xs uppercase tracking-wider">SL</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Usage ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Class</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                  No usage entries match.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((u, i) => {
                const item = consumableItems.find((it) => it.id === u.itemId);
                const value = u.qty * (item?.unitCost ?? 0);
                return (
                  <TableRow key={u.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{u.id}</TableCell>
                    <TableCell className="tabular-nums text-xs">{u.date}</TableCell>
                    <TableCell className="font-medium">{u.flight}</TableCell>
                    <TableCell className="text-xs">{u.sector}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{u.cabinClass}-Class</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{u.itemName}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{u.itemId}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {u.qty.toLocaleString()} {u.uom}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      ৳ {Math.round(value).toLocaleString()}
                    </TableCell>
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

function UsageCreate({ nextId, onSave }: { nextId: string; onSave: (u: ConsumableUsage) => void }) {
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [flight, setFlight] = useState("");
  const [sector, setSector] = useState("");
  const [cabinClass, setCabinClass] = useState<"Y" | "B" | "F">("Y");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("0");

  const selectedItem = consumableItems.find((i) => i.id === itemId);

  const save = () => {
    if (!flight.trim()) { toast.error("Flight number is required."); return; }
    if (!sector.trim()) { toast.error("Sector is required."); return; }
    if (!selectedItem) { toast.error("Select an item."); return; }
    const q = Number(qty);
    if (!q || q <= 0) { toast.error("Quantity must be positive."); return; }
    onSave({
      id: nextId,
      date,
      flight: flight.trim().toUpperCase(),
      sector: sector.trim().toUpperCase(),
      cabinClass,
      itemId: selectedItem.id,
      itemName: selectedItem.name,
      qty: q,
      uom: selectedItem.uom,
    });
    toast.success(`${nextId} logged for ${flight.trim().toUpperCase()}.`);
  };

  const lineValue = selectedItem ? (Number(qty) || 0) * selectedItem.unitCost : 0;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">New Consumable Usage Entry</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save Entry</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Usage ID</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Cabin Class</Label>
            <select value={cabinClass} onChange={(e) => setCabinClass(e.target.value as "Y" | "B" | "F")} className={selectCls}>
              {CABIN_CLASSES.map((c) => <option key={c} value={c}>{c}-Class</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Flight # *</Label>
            <Input
              value={flight}
              onChange={(e) => setFlight(e.target.value)}
              placeholder="e.g. BG-401"
              className="mt-1 font-mono uppercase"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Sector *</Label>
            <Input
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="e.g. DAC→DXB"
              className="mt-1 font-mono uppercase"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Consumable Item *</Label>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={selectCls}>
              <option value="">Select consumable…</option>
              {consumableItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name} ({it.id}) · {it.uom}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Qty Loaded *</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="number"
                min={0}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="tabular-nums"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">{selectedItem?.uom ?? "—"}</span>
            </div>
          </div>
        </div>

        {selectedItem && (
          <div className="mt-5 rounded-md border border-border bg-muted/30 px-4 py-3 flex items-center justify-between text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Line Value</div>
              <div className="text-base font-bold tabular-nums mt-0.5">৳ {Math.round(lineValue).toLocaleString()}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Unit Cost</div>
              <div className="text-xs tabular-nums mt-0.5">৳ {selectedItem.unitCost.toFixed(2)} / {selectedItem.uom}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
