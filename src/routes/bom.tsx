import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Plus, Layers, FileText, CheckCircle, Save, Trash2, ArrowLeft, Eye, Printer, Search,
} from "lucide-react";
import {
  billOfMaterials, itemsByType,
  type BillOfMaterial, type BomProductionItem, type BomInputMaterial,
} from "@/lib/sample-data";
import { KpiCard } from "@/components/common/KpiCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { LocationPicker, LocationFilter, LocationCell } from "@/components/common/LocationPicker";

const HEADER_ITEM_TYPES = ["Finished Good", "Semi-Finished Good"];
const HEADER_CATEGORIES = ["Hot Kitchen", "Cold Kitchen", "Bakery", "Beverage"];
const HEADER_SUB_CATEGORIES = ["Main Course", "Side", "Dessert", "Snack"];

// Production output items — pulled from the central Item Profile
const FG_SFG_ITEMS = itemsByType("Finished Good", "Semi-Finished Good")
  .map((i) => `${i.code} - ${i.name}`);

const MATERIAL_ITEM_TYPES = ["Raw Material", "Packaging", "Consumable"];
const MATERIAL_CATEGORIES = ["Grains", "Protein", "Vegetable", "Spices", "Oil", "Dairy"];
const MATERIAL_SUB_CATEGORIES = ["Fresh", "Frozen", "Dry", "Liquid"];

// Input materials — pulled from the central Item Profile
const MATERIAL_ITEMS = itemsByType("Raw Material", "Packaging", "Consumable")
  .map((i) => `${i.code} - ${i.name} (${i.uom})`);

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

type LineItem = {
  id: string;
  itemType: string;
  item: string;
  qty: number;
  rate: number;
};

type ProdLine = {
  id: string;
  itemType: string;
  category: string;
  subCategory: string;
  item: string;
  lotSize: number;
};

function formatDmy(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function BomList({
  data, onToggleStatus, onView,
}: {
  data: BillOfMaterial[];
  onToggleStatus: (id: string) => void;
  onView: (b: BillOfMaterial) => void;
}) {
  const [q, setQ] = useState("");
  const ql = q.toLowerCase();
  const filtered = !q
    ? data
    : data.filter((b) =>
        [b.id, b.name, b.itemName, b.itemCode, b.createdBy]
          .some((s) => (s || "").toLowerCase().includes(ql)),
      );

  return (
    <div className="bg-card rounded-lg border border-border shadow-sm">
      <div className="p-3 flex items-center gap-2 border-b border-border">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search BOM, item, created by…"
            className="pl-9 h-9"
          />
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          Showing <strong className="text-foreground tabular-nums">{filtered.length}</strong> of {data.length}
        </span>
      </div>

      <div className="overflow-auto">
        <Table>
          <TableHeader className="bg-primary/5 sticky top-0">
            <TableRow>
              <TableHead className="text-xs font-semibold uppercase tracking-wider w-12 text-center">SL</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider w-28">Date</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">BOM Name</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">Item Name</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider w-20">UoM</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider w-20 text-right">Lot Size</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider w-28 text-right">BOM Value</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">Office / Warehouse</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">Created By</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider w-32">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-10">
                  No bill of materials found.
                </TableCell>
              </TableRow>
            ) : filtered.map((r, i) => {
              const active = r.status === "Active";
              return (
                <TableRow key={r.id} className="hover:bg-muted/30">
                  <TableCell className="text-center text-sm tabular-nums">{i + 1}</TableCell>
                  <TableCell className="text-sm tabular-nums">{formatDmy(r.date)}</TableCell>
                  <TableCell className="font-medium text-sm">{r.name}</TableCell>
                  <TableCell className="text-sm">{r.itemCode} - {r.itemName} ({r.uom})</TableCell>
                  <TableCell className="text-sm">{r.uom}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{r.lotSize}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{formatMoney(r.bomValue)}</TableCell>
                  <TableCell><LocationCell officeId={r.officeId} warehouseId={r.warehouseId} /></TableCell>
                  <TableCell className="text-sm">{r.createdBy}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={active}
                        onCheckedChange={() => onToggleStatus(r.id)}
                        aria-label={`${active ? "Deactivate" : "Activate"} ${r.id}`}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => onView(r)}
                        aria-label={`View ${r.id}`}
                        title="View"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function BomDetailsDialog({
  bom, open, onOpenChange, onEdit,
}: {
  bom: BillOfMaterial | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}) {
  if (!bom) return null;

  const materialTotal = bom.inputMaterials.reduce((s, m) => s + m.total, 0);
  const lotN = bom.lotSize > 0 ? bom.lotSize : 1;
  const costPerUnit = materialTotal / lotN;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
          <DialogTitle className="text-xl">Bill Of Material Details</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto px-6 py-5 space-y-6">
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              <Field label="BOM Name" value={bom.name} bold />
              <Field label="Item Type" value={bom.productionItems[0]?.itemType || "—"} />
              <Field label="Category" value={bom.category || "—"} />
              <Field label="Sub Category" value={bom.section || "—"} />
              <Field label="FG/SFG Item" value={`${bom.itemCode} - ${bom.itemName}`} />
              <Field label="Lot Size" value={String(bom.lotSize)} />
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                className="bg-sky-600 hover:bg-sky-700 text-white h-8"
                onClick={() => { window.print(); toast.success(`Printing ${bom.id}`); }}
              >
                <Printer className="h-3.5 w-3.5 mr-1.5" /> PDF
              </Button>
            </div>
          </div>

          <section>
            <h4 className="text-base font-semibold text-foreground mb-2">Production Item</h4>
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-primary/5">
                  <TableRow>
                    <TableHead className="text-xs font-semibold uppercase w-12">SL</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">Item</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">Item Type</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-right w-32">Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bom.productionItems.map((p: BomProductionItem, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="tabular-nums">{i + 1}</TableCell>
                      <TableCell className="font-medium">{p.item}</TableCell>
                      <TableCell>{p.itemType}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.quantity.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <section>
            <div className="flex items-end justify-between mb-2">
              <h4 className="text-base font-semibold text-foreground">Input Materials</h4>
              <span className="text-xs text-muted-foreground">
                {bom.inputMaterials.length} material{bom.inputMaterials.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-primary/5">
                  <TableRow>
                    <TableHead className="text-xs font-semibold uppercase w-12">SL</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">Material Item</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">Item Type</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-right w-28">Quantity</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-right w-24">Rate</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-right w-28">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bom.inputMaterials.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                        No input materials added.
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {bom.inputMaterials.map((m: BomInputMaterial, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="tabular-nums">{i + 1}</TableCell>
                          <TableCell className="font-medium">{m.material}</TableCell>
                          <TableCell>{m.type}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {m.quantity.toFixed(2)} <span className="text-muted-foreground text-xs">{m.uom}</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{m.avgRate.toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(m.total)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/40 font-semibold">
                        <TableCell colSpan={5} className="text-right uppercase text-xs tracking-wider">
                          Material Total
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(materialTotal)}</TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>

            {bom.inputMaterials.length > 0 && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Material Total</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">৳ {formatMoney(materialTotal)}</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Lot Size</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{lotN}</div>
                </div>
                <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cost per Unit</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums text-primary">৳ {formatMoney(costPerUnit)}</div>
                </div>
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="px-6 py-3 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <span className="uppercase tracking-wider text-xs font-semibold">Close</span>
          </Button>
          <Button onClick={onEdit}>
            <span className="uppercase tracking-wider text-xs font-semibold">Edit</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={"mt-0.5 text-sm text-foreground" + (bold ? " font-semibold" : "")}>{value}</div>
    </div>
  );
}

function BomEditDialog({
  bom, open, onOpenChange,
}: {
  bom: BillOfMaterial | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!bom) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit BOM — {bom.id}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto">
          <BomEditForm row={bom} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { toast.success(`Saved ${bom.id}.`); onOpenChange(false); }}>
            <Save className="h-4 w-4 mr-1.5" /> Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BomEditForm({ row }: { row: BillOfMaterial }) {
  const initialLotSize = String(row.lotSize);

  const [bomName, setBomName] = useState(row.name);
  const [itemType, setItemType] = useState("");
  const [category, setCategory] = useState(row.category);
  const [subCategory, setSubCategory] = useState(row.section);
  const [fgSfgItem, setFgSfgItem] = useState("");
  const [lotSize, setLotSize] = useState(initialLotSize);

  const [matItemType, setMatItemType] = useState(MATERIAL_ITEM_TYPES[0]);
  const [matCategory, setMatCategory] = useState("");
  const [matSubCategory, setMatSubCategory] = useState("");
  const [matItem, setMatItem] = useState("");
  const [matQty, setMatQty] = useState("");
  const [matRate, setMatRate] = useState("");

  const [lines, setLines] = useState<LineItem[]>([]);

  const seedTotal = row.inputMaterials.reduce((s, m) => s + m.total, 0);
  const newTotal = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const materialTotal = seedTotal + newTotal;
  const lotN = Number(lotSize) || 1;
  const costPerUnit = lotN > 0 ? materialTotal / lotN : 0;

  const addLine = () => {
    if (!matItem) { toast.error("Select a material item."); return; }
    const qty = Number(matQty);
    if (!qty || qty <= 0) { toast.error("Quantity must be greater than zero."); return; }
    const rate = Number(matRate);
    if (rate < 0) { toast.error("Rate cannot be negative."); return; }
    setLines((prev) => [
      ...prev,
      { id: `LN-${Date.now()}`, itemType: matItemType, item: matItem, qty, rate },
    ]);
    setMatItem("");
    setMatQty("");
    setMatRate("");
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  return (
    <div className="space-y-6 pt-2">
      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground mb-6">
            BOM Header
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="md:col-span-2 md:max-w-xs">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                BOM Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={bomName}
                onChange={(e) => setBomName(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Item Type
              </Label>
              <select value={itemType} onChange={(e) => setItemType(e.target.value)} className={selectCls}>
                <option value="">Item Type</option>
                {HEADER_ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Category
              </Label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
                <option value="">Category</option>
                {HEADER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Sub Category
              </Label>
              <select value={subCategory} onChange={(e) => setSubCategory(e.target.value)} className={selectCls}>
                <option value="">Sub Category</option>
                {HEADER_SUB_CATEGORIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                FG/SFG Item
              </Label>
              <select value={fgSfgItem} onChange={(e) => setFgSfgItem(e.target.value)} className={selectCls}>
                <option value="">Select FG/SFG Item</option>
                {FG_SFG_ITEMS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>

            <div className="md:max-w-xs">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Lot Size
              </Label>
              <Input
                type="number"
                min={0}
                value={lotSize}
                onChange={(e) => setLotSize(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground mb-6">
            Input Materials Setup
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Type</Label>
              <select value={matItemType} onChange={(e) => setMatItemType(e.target.value)} className={selectCls}>
                {MATERIAL_ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Category</Label>
              <select value={matCategory} onChange={(e) => setMatCategory(e.target.value)} className={selectCls}>
                <option value="">Category</option>
                {MATERIAL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Sub Category</Label>
              <select value={matSubCategory} onChange={(e) => setMatSubCategory(e.target.value)} className={selectCls}>
                <option value="">Sub Category</option>
                {MATERIAL_SUB_CATEGORIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Material Item <span className="text-destructive">*</span>
              </Label>
              <select value={matItem} onChange={(e) => setMatItem(e.target.value)} className={selectCls}>
                <option value="">Select item</option>
                {MATERIAL_ITEMS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>

            <div className="md:col-span-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Qty <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={0}
                value={matQty}
                onChange={(e) => setMatQty(e.target.value)}
                className="mt-1"
              />
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Rate</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={matRate}
                onChange={(e) => setMatRate(e.target.value)}
                placeholder="0.00"
                className="mt-1"
              />
            </div>

            <div className="md:col-span-1">
              <Button variant="outline" onClick={addLine} className="w-full">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="mt-6 border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs uppercase tracking-wider">Item Type</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Rate</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Total</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {row.inputMaterials.length === 0 && lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      No materials added yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {row.inputMaterials.map((m, i) => (
                      <TableRow key={`seed-${i}`}>
                        <TableCell>{m.type}</TableCell>
                        <TableCell className="font-medium">{m.material}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.quantity.toFixed(2)} {m.uom}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.avgRate.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(m.total)}</TableCell>
                        <TableCell />
                      </TableRow>
                    ))}
                    {lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>{l.itemType}</TableCell>
                        <TableCell className="font-medium">{l.item}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.rate.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{(l.qty * l.rate).toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => removeLine(l.id)}
                            aria-label={`Remove ${l.item}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell colSpan={4} className="text-right uppercase text-xs tracking-wider">
                        Material Total
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(materialTotal)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Material Total</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">৳ {formatMoney(materialTotal)}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Lot Size</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{lotN}</div>
            </div>
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cost per Unit</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-primary">৳ {formatMoney(costPerUnit)}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BomCreate({ onSave }: { onSave?: (bom: BillOfMaterial) => void }) {
  const [bomName, setBomName] = useState("");
  const [itemType, setItemType] = useState("");
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [fgSfgItem, setFgSfgItem] = useState("");
  const [lotSize, setLotSize] = useState("1");
  const [officeId, setOfficeId] = useState("OFF-001");
  const [warehouseId, setWarehouseId] = useState("WH-003");

  const [prodLines, setProdLines] = useState<ProdLine[]>([]);

  const [matItemType, setMatItemType] = useState(MATERIAL_ITEM_TYPES[0]);
  const [matCategory, setMatCategory] = useState("");
  const [matSubCategory, setMatSubCategory] = useState("");
  const [matItem, setMatItem] = useState("");
  const [matQty, setMatQty] = useState("");
  const [matRate, setMatRate] = useState("");

  const [lines, setLines] = useState<LineItem[]>([]);

  const totalLotSize = prodLines.reduce((s, p) => s + p.lotSize, 0);
  const materialTotal = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const costPerUnit = totalLotSize > 0 ? materialTotal / totalLotSize : 0;

  const addProdLine = () => {
    if (!fgSfgItem) { toast.error("Select an FG/SFG item."); return; }
    if (prodLines.some((p) => p.item === fgSfgItem)) {
      toast.error("That item is already added.");
      return;
    }
    const lot = Number(lotSize);
    if (!lot || lot <= 0) { toast.error("Lot Size must be greater than zero."); return; }
    setProdLines((prev) => [
      ...prev,
      {
        id: `PL-${Date.now()}`,
        itemType: itemType || "—",
        category: category || "—",
        subCategory: subCategory || "—",
        item: fgSfgItem,
        lotSize: lot,
      },
    ]);
    setFgSfgItem("");
    setLotSize("1");
  };

  const removeProdLine = (id: string) => {
    setProdLines((prev) => prev.filter((p) => p.id !== id));
  };

  const addLine = () => {
    if (!matItem) { toast.error("Select a material item."); return; }
    const qty = Number(matQty);
    if (!qty || qty <= 0) { toast.error("Quantity must be greater than zero."); return; }
    const rate = Number(matRate);
    if (rate < 0) { toast.error("Rate cannot be negative."); return; }
    setLines((prev) => [
      ...prev,
      { id: `LN-${Date.now()}`, itemType: matItemType, item: matItem, qty, rate },
    ]);
    setMatItem("");
    setMatQty("");
    setMatRate("");
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleSave = () => {
    if (!bomName.trim()) { toast.error("BOM Name is required."); return; }
    if (!officeId) { toast.error("Office is required."); return; }
    if (!warehouseId) { toast.error("Warehouse is required."); return; }
    if (prodLines.length === 0) { toast.error("Add at least one production item."); return; }
    if (lines.length === 0) { toast.error("Add at least one input material."); return; }

    const today = new Date().toISOString().slice(0, 10);
    const first = prodLines[0];
    const lot = totalLotSize || 1;
    const newBom: BillOfMaterial = {
      id: `BOM-${String(Date.now()).slice(-3)}`,
      name: bomName.trim(),
      components: lines.length,
      version: "v1.0",
      yield: `${lot} portions`,
      lastUpdated: today,
      status: "Draft",
      date: today,
      itemCode: `FG-${String(Date.now()).slice(-5)}`,
      itemName: first.item,
      category: first.category !== "—" ? first.category : "N/A",
      section: first.subCategory !== "—" ? first.subCategory : "N/A",
      uom: "PCS",
      altUom: "",
      lotSize: lot,
      bomValue: materialTotal,
      createdBy: "GM/Admin",
      bomType: prodLines.length > 1 ? "Multi Output" : "Single Output",
      productionItems: prodLines.map((p) => ({
        item: `${p.item} (PCS)`,
        itemType: p.itemType !== "—" ? p.itemType : "Finished/Trading Goods",
        netWeight: 0,
        quantity: p.lotSize,
        costPct: lot > 0 ? Math.round((p.lotSize / lot) * 100) : 0,
      })),
      inputMaterials: lines.map((l) => ({
        material: l.item,
        type: l.itemType,
        excludeScrap: "No",
        altQty: 0,
        quantity: l.qty,
        uom: "KG",
        wastagePct: 0,
        totalQty: l.qty,
        avgRate: l.rate,
        total: l.qty * l.rate,
      })),
      officeId,
      warehouseId,
    };

    toast.success(`BOM "${bomName.trim()}" saved with ${prodLines.length} output${prodLines.length > 1 ? "s" : ""} and ${lines.length} material${lines.length > 1 ? "s" : ""}.`);
    onSave?.(newBom);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Create Bill of Material
            </h3>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-1.5" /> Save
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="md:col-span-2 md:max-w-xs">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                BOM Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={bomName}
                onChange={(e) => setBomName(e.target.value)}
                placeholder="BOM Name"
                className="mt-1"
              />
            </div>

            <LocationPicker
              officeId={officeId}
              warehouseId={warehouseId}
              onChange={(n) => { setOfficeId(n.officeId); setWarehouseId(n.warehouseId); }}
            />

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Item Type
              </Label>
              <select
                value={itemType}
                onChange={(e) => setItemType(e.target.value)}
                className={selectCls}
              >
                <option value="">Item Type</option>
                {HEADER_ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Category
              </Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={selectCls}
              >
                <option value="">Category</option>
                {HEADER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Sub Category
              </Label>
              <select
                value={subCategory}
                onChange={(e) => setSubCategory(e.target.value)}
                className={selectCls}
              >
                <option value="">Sub Category</option>
                {HEADER_SUB_CATEGORIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                FG/SFG Item
              </Label>
              <select
                value={fgSfgItem}
                onChange={(e) => setFgSfgItem(e.target.value)}
                className={selectCls}
              >
                <option value="">Select FG/SFG Item</option>
                {FG_SFG_ITEMS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>

            <div className="md:max-w-xs">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Lot Size
              </Label>
              <div className="mt-1 flex items-end gap-2">
                <Input
                  type="number"
                  min={0}
                  value={lotSize}
                  onChange={(e) => setLotSize(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={addProdLine}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-6 border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-12 text-xs uppercase tracking-wider">SL</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">FG/SFG Item</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Item Type</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Category</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Sub Category</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Lot Size</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {prodLines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                      No production items added yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {prodLines.map((p, i) => (
                      <TableRow key={p.id}>
                        <TableCell className="tabular-nums">{i + 1}</TableCell>
                        <TableCell className="font-medium">{p.item}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{p.itemType}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{p.category}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{p.subCategory}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.lotSize}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => removeProdLine(p.id)}
                            aria-label={`Remove ${p.item}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell colSpan={5} className="text-right uppercase text-xs tracking-wider">
                        Total Lot Size
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{totalLotSize}</TableCell>
                      <TableCell />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="input-materials">
            <TabsList className="h-auto bg-transparent p-0 border-b border-border w-full justify-start rounded-none">
              <TabsTrigger
                value="input-materials"
                className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 pb-3"
              >
                Input Materials Setup
              </TabsTrigger>
            </TabsList>

            <TabsContent value="input-materials" className="mt-6">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Item Type
                  </Label>
                  <select
                    value={matItemType}
                    onChange={(e) => setMatItemType(e.target.value)}
                    className={selectCls}
                  >
                    {MATERIAL_ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Category
                  </Label>
                  <select
                    value={matCategory}
                    onChange={(e) => setMatCategory(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">Category</option>
                    {MATERIAL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Sub Category
                  </Label>
                  <select
                    value={matSubCategory}
                    onChange={(e) => setMatSubCategory(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">Sub Category</option>
                    {MATERIAL_SUB_CATEGORIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Material Item <span className="text-destructive">*</span>
                  </Label>
                  <select
                    value={matItem}
                    onChange={(e) => setMatItem(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">Select item</option>
                    {MATERIAL_ITEMS.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>

                <div className="md:col-span-1">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Qty <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={matQty}
                    onChange={(e) => setMatQty(e.target.value)}
                    className="mt-1"
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Rate
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={matRate}
                    onChange={(e) => setMatRate(e.target.value)}
                    placeholder="0.00"
                    className="mt-1"
                  />
                </div>

                <div className="md:col-span-1">
                  <Button variant="outline" onClick={addLine} className="w-full">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-6 border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-xs uppercase tracking-wider">Item Type</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Rate</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Total</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                          No materials added yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {lines.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell>{l.itemType}</TableCell>
                            <TableCell className="font-medium">{l.item}</TableCell>
                            <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                            <TableCell className="text-right tabular-nums">{l.rate.toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums">{(l.qty * l.rate).toFixed(2)}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => removeLine(l.id)}
                                aria-label={`Remove ${l.item}`}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/40 font-semibold">
                          <TableCell colSpan={4} className="text-right uppercase text-xs tracking-wider">
                            Material Total
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(materialTotal)}</TableCell>
                          <TableCell />
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </div>

              {lines.length > 0 && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Material Total</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">৳ {formatMoney(materialTotal)}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Lot Size</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{totalLotSize || 1}</div>
                  </div>
                  <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cost per Unit</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-primary">৳ {formatMoney(costPerUnit)}</div>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

export default function BomPage() {
  const [boms, setBoms] = useState<BillOfMaterial[]>(billOfMaterials);
  const [view, setView] = useState<"list" | "create">("list");
  const [selected, setSelected] = useState<BillOfMaterial | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");

  const filteredBoms = boms.filter((b) => {
    if (filterOffice && b.officeId !== filterOffice) return false;
    if (filterWarehouse && b.warehouseId !== filterWarehouse) return false;
    return true;
  });

  const addBom = (bom: BillOfMaterial) => {
    setBoms((prev) => [bom, ...prev]);
    setView("list");
  };

  const toggleStatus = (id: string) => {
    setBoms((prev) =>
      prev.map((b) =>
        b.id === id
          ? { ...b, status: b.status === "Active" ? "Inactive" : "Active" }
          : b,
      ),
    );
    const target = boms.find((b) => b.id === id);
    const next = target && target.status === "Active" ? "Inactive" : "Active";
    toast.success(`${id} marked ${next}.`);
  };

  const openView = (b: BillOfMaterial) => {
    setSelected(b);
    setViewOpen(true);
  };

  const activeCount = boms.filter((b) => b.status === "Active").length;
  const inactiveCount = boms.length - activeCount;

  return (
    <>
      <PageHeader
        title="Bill of Materials (BOM)"
        subtitle="Manage meal recipes, component lists, version control and yield planning for the flight kitchen"
        actions={
          <>
            <Button variant="outline" onClick={() => toast.success("BOM report exported.")}>
              <FileText className="h-4 w-4 mr-1" /> Export
            </Button>
            <Button
              variant={view === "create" ? "outline" : "default"}
              onClick={() => setView(view === "create" ? "list" : "create")}
            >
              {view === "create" ? (
                <><ArrowLeft className="h-4 w-4 mr-1" /> Back</>
              ) : (
                <><Plus className="h-4 w-4 mr-1" /> Create BOM</>
              )}
            </Button>
          </>
        }
      />

      {view === "list" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiCard label="Total BOMs" value={boms.length} icon={Layers} tone="navy" />
            <KpiCard label="Active" value={activeCount} icon={CheckCircle} tone="success" />
            <KpiCard label="Inactive" value={inactiveCount} icon={FileText} tone="warning" />
          </div>
          <div className="mb-4">
            <LocationFilter
              officeId={filterOffice}
              warehouseId={filterWarehouse}
              onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
            />
          </div>
          <BomList
            data={filteredBoms}
            onToggleStatus={toggleStatus}
            onView={openView}
          />
          <BomDetailsDialog
            bom={selected}
            open={viewOpen}
            onOpenChange={setViewOpen}
            onEdit={() => { setViewOpen(false); setEditOpen(true); }}
          />
          <BomEditDialog
            bom={selected}
            open={editOpen}
            onOpenChange={setEditOpen}
          />
        </>
      ) : (
        <BomCreate onSave={addBom} />
      )}
    </>
  );
}

