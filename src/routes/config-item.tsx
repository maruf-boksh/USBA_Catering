import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { rowEditors } from "@/lib/row-editors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator,
} from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, ArrowLeft, Save, Tag, CheckCircle, XCircle,
  ChevronRight, ChevronDown, FolderTree,
  Boxes, Upload, Download, FileSpreadsheet, Trash2, AlertTriangle, Search,
  Layers, Package, Sparkles, CalendarClock, ArrowDownUp, Check, X,
  type LucideIcon,
} from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  items as MASTER_ITEMS,
  ITEM_TYPES,
  ITEM_CATEGORIES,
  ITEM_SUB_CATEGORIES,
  ASSET_CATEGORIES,
  ASSET_SUB_CATEGORIES,
  ITEM_UOMS,
  activeOffices,
  offices as ALL_OFFICES,
  activeWarehousesByOffice,
  warehouses as ALL_WAREHOUSES,
  customOfficesRegistry,
  customWarehousesRegistry,
  bomForItemCode,
  BOM_REQUIRED_ITEM_TYPES,
  getAllocationMethodForMaster,
  getAllocationChoiceForMaster,
  clearAllocationOverride,
  setAllocationMethod,
  isBatchTrackedForMaster,
  PRODUCIBLE_ITEM_TYPES,
  itemCanPurchase,
  itemCanProduce,
  itemCanSell,
  setBatchTracked as persistBatchTracked,
  subscribeAllocationMethod,
  getAllocationVersion,
  type ItemMaster,
  type AllocationMethod,
  type AltUom,
  type Office,
  type Warehouse,
} from "@/lib/sample-data";
import { usePrimaryUoms, useAltUoms, addPrimaryUom, addAltUom } from "@/lib/custom-uoms";
import { AgeingAddPanels } from "@/routes/stock-ageing";
import { roundQty } from "@/lib/num";
import {
  useBatchNumberingMode, setBatchNumberingMode, generateBatchCode,
  type BatchNumberingMode,
} from "@/lib/batch-numbering-settings";

type ItemRow = ItemMaster;

const CATEGORIES = ITEM_CATEGORIES;
const SUB_CATEGORIES = ITEM_SUB_CATEGORIES;
const UOMS = ITEM_UOMS;

/** Sentinel option value used by the Category / Sub Category dropdowns to open
 *  the inline "add new" input. */
const ADD_NEW = "__add_new__";

/** Item-code prefix per item type — auto-populated in the Create form so codes
 *  stay consistent (RM-…, PKG-…, FG-…). */
const ITEM_TYPE_CODE_PREFIX: Record<string, string> = {
  "Raw Material": "RM",
  "Packaging": "PKG",
  "Consumable": "CNS",
  "Finished Good": "FG",
  "Semi-Finished Good": "SFG",
  "Asset": "AST",
};

/** Resolve the code prefix for an item type. Custom/unknown types derive one
 *  from their name — word initials (e.g. "Cold Beverage" → "CB"), else the
 *  first letters (e.g. "Spice" → "SPI"). */
function codePrefixForType(type: string): string {
  const known = ITEM_TYPE_CODE_PREFIX[type];
  if (known) return known;
  const words = type.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0]).join("").toUpperCase().slice(0, 4);
  return type.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "ITM";
}

// ── Weight ↔ UOM link-up ─────────────────────────────────────────────────────
// The serving-weight field is stored in grams (Menu Planning reads grams), but
// its label and entry unit follow the Primary UOM: pick Kg and the field becomes
// "Weight (Kg)" and you type in Kg. Only mass UOMs change the basis; every other
// unit keeps grams. Storage stays grams so downstream math is untouched.
const WEIGHT_UNIT_GRAMS: Record<string, { label: string; grams: number }> = {
  kg: { label: "Kg", grams: 1000 },
  gm: { label: "g", grams: 1 },
  g: { label: "g", grams: 1 },
  gram: { label: "g", grams: 1 },
  grams: { label: "g", grams: 1 },
};

/** Display label for the weight field given the Primary UOM (e.g. "Kg", "g"). */
function weightUnitLabel(uom: string): string {
  return WEIGHT_UNIT_GRAMS[uom.trim().toLowerCase()]?.label ?? "g";
}

/** Grams per one unit of the weight field's entry unit (Kg → 1000, else 1). */
function weightGramsPerUnit(uom: string): number {
  return WEIGHT_UNIT_GRAMS[uom.trim().toLowerCase()]?.grams ?? 1;
}

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Selectable option card — a radio choice rendered as an icon + title + blurb.
 *  Shared by the Stock Tracking and Allocation Method pickers. */
function OptionCard({
  icon: Icon, title, desc, active, onSelect,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all",
        active
          ? "border-primary ring-1 ring-primary bg-primary/5 shadow-sm"
          : "border-input bg-background hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className={cn("text-sm font-semibold", active ? "text-primary" : "text-foreground")}>{title}</span>
        {active && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
      </div>
      <span className="text-[11px] leading-relaxed text-muted-foreground">{desc}</span>
    </button>
  );
}

const STOCK_TRACKING_OPTIONS = [
  { value: true,  title: "Batch-Tracked", icon: Layers,  desc: "Each receipt is a discrete lot with its own expiry & cost. FIFO/FEFO controls which lot drains first." },
  { value: false, title: "Single Item",   icon: Package, desc: "One pooled bucket — no batch numbers, no expiry, no FIFO/FEFO. Best for shelf-stable hardware." },
] as const;

const ALLOCATION_OPTIONS = [
  { value: "Auto", title: "Auto", icon: Sparkles,      desc: "FEFO for perishables, FIFO for shelf-stable goods — picked from the item category." },
  { value: "FEFO", title: "FEFO", icon: CalendarClock, desc: "Drains the lot with the earliest expiry first." },
  { value: "FIFO", title: "FIFO", icon: ArrowDownUp,   desc: "Drains the earliest-received lot first." },
] as const;

/** Item capability checkboxes — "Can be Purchased" / "Can be Produced". These
 *  govern where the item may be actioned: purchasable items appear in purchasing
 *  pickers (Direct Receive / PR / PO); producible items can be a production
 *  output. Shared by the Create and Edit forms. */
function CapabilityChecks({
  canPurchase, canProduce, canSell, onPurchase, onProduce, onSell,
}: {
  canPurchase: boolean;
  canProduce: boolean;
  canSell: boolean;
  onPurchase: (v: boolean) => void;
  onProduce: (v: boolean) => void;
  onSell: (v: boolean) => void;
}) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Actions</Label>
      <div className="mt-2 flex flex-wrap items-center gap-x-8 gap-y-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox checked={canProduce} onCheckedChange={(v) => onProduce(v === true)} />
          <span className="text-sm font-medium">Can be Produced</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox checked={canPurchase} onCheckedChange={(v) => onPurchase(v === true)} />
          <span className="text-sm font-medium">Can be Purchased</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox checked={canSell} onCheckedChange={(v) => onSell(v === true)} />
          <span className="text-sm font-medium">Can be Sold</span>
        </label>
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
        <span className="font-semibold text-foreground">Can be Purchased</span> lets the item be received/ordered in Local Purchase (Direct Receive, PR, PO).
        <span className="font-semibold text-foreground"> Can be Produced</span> lets it be chosen as a production output.
        <span className="font-semibold text-foreground"> Can be Sold</span> lets it be sold as salvage on the Damaged Product Sales page.
      </div>
    </div>
  );
}


type LocationOption = { id: string; code: string; name: string };

/** Searchable, checkable multi-select for Offices / Warehouses. Renders the
 *  chosen entries as removable chips and supports inline "Add new". Shared by the
 *  Create form's location pickers. */
function LocationMultiSelect({
  label, placeholder, emptyPlaceholder, entity, options, selectedIds, onToggle, onAddNew, disabled,
}: {
  label: string;
  placeholder: string;
  emptyPlaceholder?: string;
  entity: string;
  options: LocationOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onAddNew?: (name: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const selected = options.filter((o) => selectedIds.includes(o.id));

  const commitAdd = () => {
    const v = draft.trim();
    if (!v) { toast.error(`Enter a ${entity} name.`); return; }
    onAddNew?.(v);
    setDraft("");
    setAdding(false);
  };

  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setAdding(false); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(selectCls, "flex items-center justify-between gap-2 text-left", disabled && "opacity-50 cursor-not-allowed")}
          >
            <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
              {selected.length === 0
                ? (disabled ? (emptyPlaceholder ?? placeholder) : placeholder)
                : `${selected.length} ${entity}${selected.length === 1 ? "" : "s"} selected`}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${entity}…`} />
            <CommandList>
              <CommandEmpty>No {entity} found.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => {
                  const on = selectedIds.includes(o.id);
                  return (
                    <CommandItem key={o.id} value={`${o.code} ${o.name}`} onSelect={() => onToggle(o.id)}>
                      <Checkbox checked={on} className="pointer-events-none" />
                      <span className="truncate">{o.code} — {o.name}</span>
                      {on && <Check className="ml-auto h-4 w-4 text-primary" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {onAddNew && (
                <>
                  <CommandSeparator />
                  <div className="p-1">
                    {adding ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitAdd(); } }}
                          placeholder={`New ${entity} name`}
                          className="h-8"
                        />
                        <Button type="button" size="sm" onClick={commitAdd}>Add</Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAdding(true)}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Plus className="h-4 w-4" /> Add new {entity}…
                      </button>
                    )}
                  </div>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((o) => (
            <Badge key={o.id} variant="secondary" className="gap-1 pr-1 font-normal">
              <span className="font-mono text-[10px]">{o.code}</span>
              <button
                type="button"
                onClick={() => onToggle(o.id)}
                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-foreground/15"
                aria-label={`Remove ${o.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ConfigItemPage() {
  const [rows, setRows] = usePersistedState<ItemRow[]>("config-item-rows", MASTER_ITEMS);
  const [view, setView] = useState<"list" | "create">("list");
  const [tab, setTab] = useState<"items" | "category" | "ageing" | "alert">("items");
  const [openingOpen, setOpeningOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const toggle = (id: string) =>
    setRows((prev) => {
      const target = prev.find((r) => r.id === id);
      if (!target) return prev;
      const nextActive = target.status !== "Active";
      if (
        nextActive &&
        BOM_REQUIRED_ITEM_TYPES.includes(target.itemType) &&
        !bomForItemCode(target.code)
      ) {
        toast.error(
          `${target.name} can't be activated — every Finished Good must have a BOM. Create one first.`,
        );
        return prev;
      }
      return prev.map((r) =>
        r.id === id ? { ...r, status: nextActive ? "Active" : "Inactive" } : r,
      );
    });

  const add = (row: ItemRow) => {
    setRows((prev) => [row, ...prev]);
    setView("list");
  };

  const addMany = (incoming: ItemRow[]) => {
    setRows((prev) => [...incoming, ...prev]);
  };

  const activeCount = rows.filter((r) => r.status === "Active").length;

  const nextIdFor = (offset = 0) =>
    `ITM-${String(rows.length + 1 + offset).padStart(3, "0")}`;

  return (
    <>
      <PageHeader
        title="Item Configuration"
        subtitle="Master list of raw materials, packaging, consumables and finished goods used across the kitchen"
        actions={
          tab !== "category" ? (
            <div className="flex items-center gap-2">
              {view === "list" && (
                <>
                  <Button variant="outline" onClick={() => setOpeningOpen(true)}>
                    <Boxes className="h-4 w-4 mr-1.5" /> Opening Stock
                  </Button>
                  <Button variant="outline" onClick={() => setBulkOpen(true)}>
                    <Upload className="h-4 w-4 mr-1.5" /> Bulk Upload
                  </Button>
                </>
              )}
              <Button
                variant={view === "create" ? "outline" : "default"}
                onClick={() => {
                  if (view === "create") {
                    // Leaving Create Item also closes its Ageing / Alert sub-tabs.
                    setView("list");
                    setTab("items");
                  } else {
                    setView("create");
                  }
                }}
              >
                {view === "create" ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back</> : <><Plus className="h-4 w-4 mr-1" /> Create Item</>}
              </Button>
            </div>
          ) : null
        }
      />

      <OpeningStockDialog
        open={openingOpen}
        onOpenChange={setOpeningOpen}
        items={rows.filter((r) => r.status === "Active")}
      />

      <BulkUploadDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        existingCodes={new Set(rows.map((r) => r.code.toUpperCase()))}
        nextIdFor={nextIdFor}
        onImport={(items) => {
          addMany(items);
          setBulkOpen(false);
          toast.success(`Imported ${items.length} item${items.length === 1 ? "" : "s"}.`);
        }}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "items" | "category" | "ageing" | "alert")} className="space-y-5">
        <TabsList className="h-auto gap-6 bg-transparent p-0 pt-2 border-b border-border w-full justify-start rounded-none">
          <TabsTrigger
            value="items"
            className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-1 pb-3"
          >
            Item Profile
          </TabsTrigger>
          {/* Category is a list-view tab — hidden inside the Create Item flow. */}
          {view !== "create" && (
            <TabsTrigger
              value="category"
              className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-1 pb-3"
            >
              Category
            </TabsTrigger>
          )}
          {/* Only inside the Create Item flow — ageing entry moved here from
              Stock Ageing & Alerts. */}
          {view === "create" && (
            <>
              <TabsTrigger
                value="ageing"
                className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-1 pb-3"
              >
                Ageing Record
              </TabsTrigger>
              <TabsTrigger
                value="alert"
                className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-1 pb-3"
              >
                Alert Configuration
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="items" className="mt-0">
          {view === "list" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <KpiCard label="Total Items" value={rows.length} icon={Tag} tone="navy" />
                <KpiCard label="Active" value={activeCount} icon={CheckCircle} tone="success" />
                <KpiCard label="Inactive" value={rows.length - activeCount} icon={XCircle} tone="warning" />
              </div>
              <BatchNumberingSetting />
              <ItemList data={rows} onToggle={toggle} editors={rowEditors(setRows)} />
            </>
          ) : (
            <ItemCreate nextId={`ITM-${String(rows.length + 1).padStart(3, "0")}`} onSave={add} />
          )}
        </TabsContent>

        <TabsContent value="category" className="mt-0">
          <CategoryManager items={rows} />
        </TabsContent>

        <TabsContent value="ageing" className="mt-0">
          <AgeingAddPanels panel="record" onClose={() => setTab("items")} />
        </TabsContent>

        <TabsContent value="alert" className="mt-0">
          <AgeingAddPanels panel="config" onClose={() => setTab("items")} />
        </TabsContent>
      </Tabs>
    </>
  );
}

type CategoryNode = {
  id: string;
  description: string;
  children: CategoryNode[];
};

const CATEGORY_TREE: CategoryNode[] = [
  { id: "C-1",  description: "Grains",    children: [
    { id: "C-1-1", description: "Rice",            children: [] },
    { id: "C-1-2", description: "Flour",           children: [] },
    { id: "C-1-3", description: "Pasta",           children: [] },
  ]},
  { id: "C-2",  description: "Protein",   children: [
    { id: "C-2-1", description: "Chicken",         children: [] },
    { id: "C-2-2", description: "Beef",            children: [] },
    { id: "C-2-3", description: "Mutton",          children: [] },
    { id: "C-2-4", description: "Seafood",         children: [] },
    { id: "C-2-5", description: "Egg",             children: [] },
  ]},
  { id: "C-3",  description: "Vegetable", children: [
    { id: "C-3-1", description: "Fresh Vegetable", children: [] },
    { id: "C-3-2", description: "Frozen Vegetable",children: [] },
    { id: "C-3-3", description: "Leafy Greens",    children: [] },
  ]},
  { id: "C-4",  description: "Spices",    children: [
    { id: "C-4-1", description: "Whole Spices",    children: [] },
    { id: "C-4-2", description: "Ground Spices",   children: [] },
    { id: "C-4-3", description: "Spice Blends",    children: [] },
  ]},
  { id: "C-5",  description: "Oil",       children: [
    { id: "C-5-1", description: "Cooking Oil",     children: [] },
    { id: "C-5-2", description: "Specialty Oil",   children: [] },
    { id: "C-5-3", description: "Ghee",            children: [] },
  ]},
  { id: "C-6",  description: "Dairy",     children: [
    { id: "C-6-1", description: "Milk",            children: [] },
    { id: "C-6-2", description: "Butter & Cream",  children: [] },
    { id: "C-6-3", description: "Cheese",          children: [] },
    { id: "C-6-4", description: "Yogurt",          children: [] },
  ]},
  { id: "C-7",  description: "Beverage",  children: [
    { id: "C-7-1", description: "Water",           children: [] },
    { id: "C-7-2", description: "Juice",           children: [] },
    { id: "C-7-3", description: "Tea & Coffee",    children: [] },
    { id: "C-7-4", description: "Soft Drinks",     children: [] },
  ]},
  { id: "C-8",  description: "Bakery",    children: [
    { id: "C-8-1", description: "Bread",           children: [] },
    { id: "C-8-2", description: "Pastry",          children: [] },
    { id: "C-8-3", description: "Cake",            children: [] },
    { id: "C-8-4", description: "Cookies",         children: [] },
  ]},
  { id: "C-9",  description: "Meal",      children: [
    { id: "C-9-1", description: "Hot Meal",        children: [] },
    { id: "C-9-2", description: "Cold Meal",       children: [] },
    { id: "C-9-3", description: "Special Meal",    children: [] },
  ]},
  { id: "C-10", description: "Packaging", children: [
    { id: "C-10-1", description: "Boxes & Trays",  children: [] },
    { id: "C-10-2", description: "Cups & Bottles", children: [] },
    { id: "C-10-3", description: "Films & Wraps",  children: [] },
    { id: "C-10-4", description: "Labels",         children: [] },
  ]},
];

function CategoryManager({ items }: { items: ItemRow[] }) {
  const [mode, setMode] = useState<"table" | "tree">("table");

  const itemCount = (description: string) =>
    items.filter((i) => i.category.toLowerCase() === description.toLowerCase()).length;

  const totalCategories = CATEGORY_TREE.length;
  const totalSubCategories = CATEGORY_TREE.reduce((s, c) => s + c.children.length, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiCard label="Categories" value={totalCategories} icon={FolderTree} tone="navy" />
        <KpiCard label="Sub Categories" value={totalSubCategories} icon={Tag} tone="success" />
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-6 mb-4 border-b border-border pb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="category-view"
                value="table"
                checked={mode === "table"}
                onChange={() => setMode("table")}
                className="h-4 w-4 accent-primary cursor-pointer"
              />
              <span className="text-sm font-medium">Table View</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="category-view"
                value="tree"
                checked={mode === "tree"}
                onChange={() => setMode("tree")}
                className="h-4 w-4 accent-primary cursor-pointer"
              />
              <span className="text-sm font-medium">Tree View</span>
            </label>
          </div>

          {mode === "table" ? (
            <CategoryTableView nodes={CATEGORY_TREE} itemCount={itemCount} />
          ) : (
            <CategoryTreeView nodes={CATEGORY_TREE} itemCount={itemCount} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CategoryTableView({
  nodes, itemCount,
}: { nodes: CategoryNode[]; itemCount: (d: string) => number }) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-primary/5">
          <tr>
            <th className="w-16 text-left px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">SL</th>
            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">Description</th>
            <th className="w-32 text-right px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">Items</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((parent, pi) => (
            <Fragment2 key={parent.id}>
              <tr className="border-t border-border bg-muted/20 font-medium">
                <td className="px-3 py-2 tabular-nums">{pi + 1}</td>
                <td className="px-3 py-2">{parent.description}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {itemCount(parent.description)}
                </td>
              </tr>
              {parent.children.map((child, ci) => (
                <tr key={child.id} className="border-t border-border hover:bg-muted/10">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground pl-8">{ci + 1}</td>
                  <td className="px-3 py-2 pl-8 text-muted-foreground">{child.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">—</td>
                </tr>
              ))}
            </Fragment2>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fragment2({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function CategoryTreeView({
  nodes, itemCount,
}: { nodes: CategoryNode[]; itemCount: (d: string) => number }) {
  return (
    <div className="space-y-1">
      {nodes.map((n) => (
        <TreeNode key={n.id} node={n} depth={0} itemCount={itemCount} defaultOpen />
      ))}
    </div>
  );
}

function TreeNode({
  node, depth, itemCount, defaultOpen,
}: {
  node: CategoryNode;
  depth: number;
  itemCount: (d: string) => number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const hasChildren = node.children.length > 0;
  const count = depth === 0 ? itemCount(node.description) : 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40 transition-colors",
          depth === 0 && "font-medium",
        )}
        style={{ paddingLeft: 8 + depth * 20 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="h-5 w-5 inline-block" aria-hidden />
        )}
        <span className="flex-1">{node.description}</span>
        {depth === 0 && count > 0 && (
          <span className="text-[10px] tabular-nums rounded-full bg-muted/60 text-muted-foreground px-2 py-0.5">
            {count} item{count === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {hasChildren && open && (
        <div>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} itemCount={itemCount} />
          ))}
        </div>
      )}
    </div>
  );
}

// Global batch-code numbering policy for all batch-tracked items — Manual (the
// receiver types the batch/LOT no) or Auto (the system generates it on receipt).
function BatchNumberingSetting() {
  const mode = useBatchNumberingMode();
  const set = (next: BatchNumberingMode) => {
    if (next === mode) return;
    setBatchNumberingMode(next);
    toast.success(`Batch codes are now ${next === "auto" ? "auto-generated" : "entered manually"}.`);
  };
  return (
    <div className="mb-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-semibold">Batch Code Numbering</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Applies to every batch-tracked item on receipt.{" "}
            {mode === "auto"
              ? <>System generates the code (e.g. <span className="font-mono">{generateBatchCode()}</span>); the receiver enters only the expiry.</>
              : <>The receiver types the batch / LOT number.</>}
          </p>
        </div>
        <div
          className="inline-flex items-center rounded-md border border-input bg-background p-0.5 shadow-sm shrink-0"
          role="group"
          aria-label="Batch code numbering mode"
        >
          {([
            { label: "Manual", value: "manual" as const },
            { label: "Auto-generate", value: "auto" as const },
          ]).map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => set(opt.value)}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-sm transition-colors",
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Read-only Item profile shown by the row "View" action — a sectioned profile
 *  (header + grouped attributes) instead of the generic flat field dump. Mirrors
 *  the Edit form's grouping and reads derived allocation / batch-tracking from the
 *  same source the table uses, so the view stays truthful. */
function ItemProfileView({ row }: { row: ItemRow }) {
  const active = row.status === "Active";
  const allocation = getAllocationMethodForMaster(row.id);
  const batchTracked = isBatchTrackedForMaster(row.id);

  const findWh = (id: string) =>
    ALL_WAREHOUSES.find((w) => w.id === id) ?? customWarehousesRegistry.find((w) => w.id === id);
  const findOff = (id: string) =>
    ALL_OFFICES.find((o) => o.id === id) ?? customOfficesRegistry.find((o) => o.id === id);

  // Prefer the multi-location arrays; fall back to the legacy single fields.
  const whIds = row.warehouseIds?.length ? row.warehouseIds : (row.warehouseId ? [row.warehouseId] : []);
  const whs = whIds.map(findWh).filter(Boolean) as Warehouse[];
  const offIds = row.officeIds?.length
    ? row.officeIds
    : (row.officeId ? [row.officeId] : whs.map((w) => w.officeId));
  const offs = Array.from(new Set(offIds)).map(findOff).filter(Boolean) as Office[];
  const hasLocation = offs.length > 0 || whs.length > 0 || !!row.binLocation;

  const Field = ({ label, children }: { label: string; children?: ReactNode }) => (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className="text-sm font-medium mt-0.5 break-words">{children == null || children === "" ? "—" : children}</div>
    </div>
  );
  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 rounded-lg border border-border bg-muted/30 p-4">
        {children}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header — item identity at a glance */}
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-bold truncate">{row.name}</h3>
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
            )}>
              {active ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} {row.status}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <span className="font-mono">{row.code}</span>
            <span>·</span>
            <span>{row.itemType}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Item ID</div>
          <div className="font-mono text-sm font-semibold">{row.id}</div>
        </div>
      </div>

      <Section title="Classification">
        <Field label="Category">{row.category}</Field>
        <Field label="Sub Category">{row.subCategory}</Field>
        <Field label="Primary UOM">{row.uom}</Field>
        <Field label="Can be Produced">{itemCanProduce(row) ? "Yes" : "No"}</Field>
        <Field label="Can be Purchased">{itemCanPurchase(row) ? "Yes" : "No"}</Field>
        <Field label="Can be Sold">{itemCanSell(row) ? "Yes" : "No"}</Field>
      </Section>

      <Section title="Costing & Nutrition">
        <Field label="Cost Price">{row.costPrice != null ? `৳ ${row.costPrice}` : ""}</Field>
        <Field label="Weight">{row.weightG ? `${roundQty(row.weightG / weightGramsPerUnit(row.uom ?? ""))} ${weightUnitLabel(row.uom ?? "")}` : ""}</Field>
        <Field label="Energy">{row.kcal ? `${row.kcal} kcal` : ""}</Field>
      </Section>

      <Section title="Inventory & Tracking">
        <Field label="Allocation Method">{allocation}</Field>
        <Field label="Batch Tracked">{batchTracked ? "Yes" : "No"}</Field>
        <Field label="Shelf Life">{row.shelfLifeDays ? `${row.shelfLifeDays} day${row.shelfLifeDays === 1 ? "" : "s"}` : ""}</Field>
        <Field label="Storage">{row.storage}</Field>
        {row.currentStock != null && <Field label="Current Stock">{`${row.currentStock} ${row.uom}`}</Field>}
        {row.reorderLevel != null && <Field label="Reorder Level">{`${row.reorderLevel} ${row.uom}`}</Field>}
      </Section>

      {hasLocation && (
        <Section title="Default Location">
          <Field label={offs.length > 1 ? "Offices" : "Office"}>
            {offs.length ? offs.map((o) => `${o.code} — ${o.name}`).join(", ") : ""}
          </Field>
          <Field label={whs.length > 1 ? "Warehouses" : "Warehouse"}>
            {whs.length ? whs.map((w) => `${w.code} — ${w.name}`).join(", ") : ""}
          </Field>
          <Field label="Bin">{row.binLocation}</Field>
        </Section>
      )}
    </div>
  );
}

function ItemList({
  data, onToggle, editors,
}: {
  data: ItemRow[];
  onToggle: (id: string) => void;
  editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void };
}) {
  // Re-render the table when any item's FIFO/FEFO override changes.
  useSyncExternalStore(subscribeAllocationMethod, getAllocationVersion, getAllocationVersion);
  const navigate = useNavigate();

  const cols: Column<ItemRow>[] = [
    { key: "id", header: "ID" },
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: "name", header: "Item Name" },
    { key: "itemType", header: "Type" },
    { key: "category", header: "Category" },
    {
      key: "subCategory",
      header: "Sub Category",
      render: (r) =>
        r.subCategory ? r.subCategory : <span className="text-muted-foreground text-xs">—</span>,
    },
    {
      key: "uom",
      header: "UOM",
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <span>{r.uom}</span>
          {r.altUoms && r.altUoms.length > 0 && (
            <span
              className="inline-flex items-center rounded border border-primary/30 bg-primary/5 px-1 py-0 text-[9px] font-semibold text-primary"
              title={r.altUoms.map((a) => `1 ${a.uom} = ${a.conversion} ${r.uom}`).join("\n")}
            >
              +{r.altUoms.length} alt
            </span>
          )}
        </div>
      ),
    },
    {
      key: "currentStock",
      header: "Current Stock",
      render: (r) =>
        r.currentStock != null ? (
          <span className="tabular-nums">{roundQty(r.currentStock)} <span className="text-muted-foreground text-xs">{r.uom}</span></span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const active = r.status === "Active";
        return (
          <div className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={() => onToggle(r.id)} />
            <span className={cn("text-xs font-medium", active ? "text-success" : "text-muted-foreground")}>
              {r.status}
            </span>
          </div>
        );
      },
    },
  ];
  return (
    <DataTable
      title="items"
      data={data}
      columns={cols}
      searchKeys={["id", "code", "name", "itemType", "category"]}
      selectable={false}
      actions={(r) => (
        <RowActions
          row={r}
          actions={["view", "edit", "print"]}
          onSave={editors.onSave}
          detail={<ItemProfileView row={r} />}
          editDetail={({ save, close }) => <ItemEditForm row={r} onSubmit={save} onClose={close} />}
        />
      )}
    />
  );
}

/** Edit form shown inside the row-actions modal — mirrors the Create Item
 *  layout (sectioned fields, inline "+ Add new" category/sub-category) but
 *  pre-filled from the selected row. */
function ItemEditForm({
  row, onSubmit, onClose,
}: {
  row: ItemRow;
  onSubmit: (patch: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(row.code ?? "");
  const [name, setName] = useState(row.name ?? "");
  const [itemType, setItemType] = useState<string>(row.itemType ?? ITEM_TYPES[0]);
  const [category, setCategory] = useState(row.category ?? "");
  const [subCategory, setSubCategory] = useState(row.subCategory ?? "");
  const [uom, setUom] = useState<string>(row.uom ?? UOMS[0]);
  const [status, setStatus] = useState<string>(row.status ?? "Active");
  const [costPrice, setCostPrice] = useState(String(row.costPrice ?? ""));
  // weightVal is shown/edited in the Primary UOM's basis (Kg / g); stored grams
  // (row.weightG) are converted in for display and back out on save.
  const [weightVal, setWeightVal] = useState(() =>
    row.weightG == null ? "" : String(roundQty(row.weightG / weightGramsPerUnit(row.uom ?? UOMS[0]))),
  );
  const [kcal, setKcal] = useState(String(row.kcal ?? ""));
  const [shelfLife, setShelfLife] = useState(String(row.shelfLifeDays ?? ""));
  const [allocation, setAllocation] = useState<"Auto" | AllocationMethod>(getAllocationChoiceForMaster(row.id));
  const [batchTracked, setBatchTracked] = useState(isBatchTrackedForMaster(row.id));
  // Capability flags — seed from the row's effective values (explicit flag, else
  // the type-based default) so the checkboxes reflect the current behaviour.
  const [canPurchase, setCanPurchase] = useState(itemCanPurchase(row));
  const [canProduce, setCanProduce] = useState(itemCanProduce(row));
  const [canSell, setCanSell] = useState(itemCanSell(row));

  const [categoryOptions, setCategoryOptions] = useState<string[]>(() => {
    const base = [...CATEGORIES] as string[];
    if (row.category && !base.includes(row.category)) base.push(row.category);
    return base;
  });
  const [subCategoryOptions, setSubCategoryOptions] = useState<string[]>(() => {
    const base = [...SUB_CATEGORIES] as string[];
    if (row.subCategory && !base.includes(row.subCategory)) base.push(row.subCategory);
    return base;
  });
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [addingSubCategory, setAddingSubCategory] = useState(false);
  const [newSubCategory, setNewSubCategory] = useState("");

  // Primary UOM list — seed + any units added from the system. Include the row's
  // own UOM in case it was a custom unit saved on another device/session.
  const uomOptions = usePrimaryUoms();
  const [addingUom, setAddingUom] = useState(false);
  const [newUomLabel, setNewUomLabel] = useState("");
  // Switch UOM and re-express the weight entry in the new unit's basis.
  const handleUomChange = (next: string) => {
    const oldG = weightGramsPerUnit(uom);
    const newG = weightGramsPerUnit(next);
    if (oldG !== newG) {
      setWeightVal((v) => {
        const n = parseFloat(v);
        if (!v.trim() || Number.isNaN(n)) return v;
        return String(roundQty((n * oldG) / newG));
      });
    }
    setUom(next);
  };
  const commitNewUom = () => {
    const added = addPrimaryUom(newUomLabel);
    if (!added) { toast.error("Enter a UOM name."); return; }
    handleUomChange(added);
    toast.success(`UOM "${added}" added.`);
    setNewUomLabel("");
    setAddingUom(false);
  };

  const commitNewCategory = () => {
    const val = newCategory.trim();
    if (!val) { toast.error("Enter a category name."); return; }
    if (!categoryOptions.some((c) => c.toLowerCase() === val.toLowerCase())) setCategoryOptions((p) => [...p, val]);
    setCategory(val); setNewCategory(""); setAddingCategory(false);
  };
  const commitNewSubCategory = () => {
    const val = newSubCategory.trim();
    if (!val) { toast.error("Enter a sub category name."); return; }
    if (!subCategoryOptions.some((s) => s.toLowerCase() === val.toLowerCase())) setSubCategoryOptions((p) => [...p, val]);
    setSubCategory(val); setNewSubCategory(""); setAddingSubCategory(false);
  };

  const submit = () => {
    if (!code.trim()) { toast.error("Item code is required."); return; }
    if (!name.trim()) { toast.error("Item name is required."); return; }
    // Allocation + batch tracking live in their own override stores, keyed by
    // master id — persist them there.
    if (allocation === "Auto") clearAllocationOverride(row.id);
    else setAllocationMethod(row.id, allocation);
    persistBatchTracked(row.id, batchTracked);
    // Persist the core item-master fields back into the list.
    onSubmit({
      code: code.trim(),
      name: name.trim(),
      itemType,
      category,
      subCategory,
      uom,
      status,
      costPrice: Number(costPrice) || 0,
      weightG: (Number(weightVal) * weightGramsPerUnit(uom)) || 0,
      kcal: Number(kcal) || 0,
      shelfLifeDays: Number(shelfLife) > 0 ? Number(shelfLife) : undefined,
      canPurchase,
      canProduce,
      canSell,
    });
  };

  const lbl = "text-xs uppercase tracking-wider text-muted-foreground";
  return (
    <div className="space-y-5 max-h-[62vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className={lbl}>Item ID</Label>
          <Input value={row.id} disabled className="mt-1 bg-muted/40" />
        </div>
        <div>
          <Label className={lbl}>Item Code <span className="text-destructive">*</span></Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1" />
        </div>
      </div>

      <div>
        <Label className={lbl}>Item Name <span className="text-destructive">*</span></Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className={lbl}>Item Type</Label>
          <select value={itemType} onChange={(e) => setItemType(e.target.value)} className={selectCls}>
            {ITEM_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Label className={lbl}>Category</Label>
          <select
            value={category}
            onChange={(e) => { e.target.value === ADD_NEW ? setAddingCategory(true) : setCategory(e.target.value); }}
            className={selectCls}
          >
            <option value="">Select category</option>
            {categoryOptions.map((c) => <option key={c}>{c}</option>)}
            <option value={ADD_NEW}>+ Add new category…</option>
          </select>
          {addingCategory && (
            <div className="mt-2 flex items-center gap-2">
              <Input autoFocus value={newCategory} onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitNewCategory(); } }} placeholder="New category name" className="h-9" />
              <Button type="button" size="sm" onClick={commitNewCategory}>Add</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { setAddingCategory(false); setNewCategory(""); }}>Cancel</Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className={lbl}>Sub Category</Label>
          <select
            value={subCategory}
            onChange={(e) => { e.target.value === ADD_NEW ? setAddingSubCategory(true) : setSubCategory(e.target.value); }}
            className={selectCls}
          >
            <option value="">Select sub category</option>
            {subCategoryOptions.map((s) => <option key={s}>{s}</option>)}
            <option value={ADD_NEW}>+ Add new sub category…</option>
          </select>
          {addingSubCategory && (
            <div className="mt-2 flex items-center gap-2">
              <Input autoFocus value={newSubCategory} onChange={(e) => setNewSubCategory(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitNewSubCategory(); } }} placeholder="New sub category name" className="h-9" />
              <Button type="button" size="sm" onClick={commitNewSubCategory}>Add</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { setAddingSubCategory(false); setNewSubCategory(""); }}>Cancel</Button>
            </div>
          )}
        </div>
        <div>
          <Label className={lbl}>Primary UOM</Label>
          <select
            value={uom}
            onChange={(e) => { e.target.value === ADD_NEW ? setAddingUom(true) : handleUomChange(e.target.value); }}
            className={selectCls}
          >
            {uomOptions.map((u) => <option key={u}>{u}</option>)}
            {uom && !uomOptions.some((u) => u.toLowerCase() === uom.toLowerCase()) && (
              <option key={uom}>{uom}</option>
            )}
            <option value={ADD_NEW}>+ Add new UOM…</option>
          </select>
          {addingUom && (
            <div className="mt-2 flex items-center gap-2">
              <Input autoFocus value={newUomLabel} onChange={(e) => setNewUomLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitNewUom(); } }} placeholder="New UOM name (e.g. Can, Roll)" className="h-9" />
              <Button type="button" size="sm" onClick={commitNewUom}>Add</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { setAddingUom(false); setNewUomLabel(""); }}>Cancel</Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label className={lbl}>Cost Price (৳)</Label>
          <Input type="number" min={0} value={costPrice} onChange={(e) => setCostPrice(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className={lbl}>Weight ({weightUnitLabel(uom)})</Label>
          <Input type="number" min={0} step="any" value={weightVal} onChange={(e) => setWeightVal(e.target.value)} placeholder="0" className="mt-1" />
          {weightUnitLabel(uom) !== "g" && Number(weightVal) > 0 && (
            <div className="mt-1 text-[11px] text-muted-foreground">= {roundQty(Number(weightVal) * weightGramsPerUnit(uom))} g stored</div>
          )}
        </div>
        <div>
          <Label className={lbl}>Kcal</Label>
          <Input type="number" min={0} value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="0" className="mt-1" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className={lbl}>Allocation Method</Label>
          <select value={allocation} onChange={(e) => setAllocation(e.target.value as "Auto" | AllocationMethod)} className={selectCls}>
            <option value="Auto">Auto</option>
            <option value="FEFO">FEFO</option>
            <option value="FIFO">FIFO</option>
          </select>
        </div>
        <div>
          <Label className={lbl}>Shelf Life (days)</Label>
          <Input type="number" min={0} value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} placeholder="Category default" className="mt-1" />
          <div className="mt-1 text-[11px] text-muted-foreground">Drives projected batch expiry (receipt + shelf life). Leave blank for the category default.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
        <div>
          <Label className={lbl}>Status</Label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
        <div className="flex items-center gap-3 pt-5">
          <Switch checked={batchTracked} onCheckedChange={setBatchTracked} />
          <span className="text-sm font-medium">{batchTracked ? "Batch-tracked" : "Single item"}</span>
        </div>
      </div>

      <div className="pt-4 border-t border-border">
        <CapabilityChecks
          canPurchase={canPurchase}
          canProduce={canProduce}
          canSell={canSell}
          onPurchase={setCanPurchase}
          onProduce={setCanProduce}
          onSell={setCanSell}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit}>Save Changes</Button>
      </div>
    </div>
  );
}

function ItemCreate({ nextId, onSave }: { nextId: string; onSave: (row: ItemRow) => void }) {
  const navigate = useNavigate();
  // Code is seeded with the default item type's prefix; it auto-swaps when the
  // type changes (see handleItemTypeChange).
  const [code, setCode] = useState(() => `${codePrefixForType(ITEM_TYPES[0])}-`);
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<string>(ITEM_TYPES[0]);
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [uom, setUom] = useState<string>(UOMS[0]);

  // Item Type is editable: users can add a new one inline via "+ Add new…",
  // same dynamic pattern as Category / Sub Category below.
  const [itemTypeOptions, setItemTypeOptions] = useState<string[]>([...ITEM_TYPES]);
  const [addingItemType, setAddingItemType] = useState(false);
  const [newItemType, setNewItemType] = useState("");

  const isAsset = itemType === "Asset";

  // Category / Sub Category are editable: users can add a new one inline via the
  // "+ Add new…" option. Options seed from the master list and grow per session.
  const [categoryOptions, setCategoryOptions] = useState<string[]>([...CATEGORIES]);
  const [subCategoryOptions, setSubCategoryOptions] = useState<string[]>([...SUB_CATEGORIES]);

  // Primary / Alt UOM lists — seed + any units the user added from the system.
  // Persisted app-wide via the custom-uoms store so new units survive and appear
  // in every UOM dropdown (Create, Edit, Alt UOM DDL).
  const uomOptions = usePrimaryUoms();
  const altUomOptions = useAltUoms();
  const [addingUom, setAddingUom] = useState(false);
  const [newUomLabel, setNewUomLabel] = useState("");
  const [addingAltUomOption, setAddingAltUomOption] = useState(false);
  const [newAltUomOption, setNewAltUomOption] = useState("");

  // Switch the Primary UOM and re-express the weight entry in the new unit's
  // basis so "0.5 Kg" becomes "500 g" (and back) rather than silently changing
  // the stored grams.
  const handleUomChange = (next: string) => {
    const oldG = weightGramsPerUnit(uom);
    const newG = weightGramsPerUnit(next);
    if (oldG !== newG) {
      setWeightVal((v) => {
        const n = parseFloat(v);
        if (!v.trim() || Number.isNaN(n)) return v;
        return String(roundQty((n * oldG) / newG));
      });
    }
    setUom(next);
  };

  const commitNewUom = () => {
    const added = addPrimaryUom(newUomLabel);
    if (!added) { toast.error("Enter a UOM name."); return; }
    handleUomChange(added);
    toast.success(`UOM "${added}" added.`);
    setNewUomLabel("");
    setAddingUom(false);
  };
  const commitNewAltUomOption = () => {
    const added = addAltUom(newAltUomOption);
    if (!added) { toast.error("Enter an alt UOM name."); return; }
    if (added.toLowerCase() === uom.toLowerCase()) {
      toast.error("Alt UOM cannot match the Primary UOM."); return;
    }
    setAltDraftUom(added);
    toast.success(`Alt UOM "${added}" added.`);
    setNewAltUomOption("");
    setAddingAltUomOption(false);
  };

  // "Asset" item type uses its own Category → Sub Category presets (Catering /
  // Electronic Devices). "+ Add new" extends this map so new categories and
  // sub-categories stay dynamic, same as the general item flow above.
  const [assetCategoryMap, setAssetCategoryMap] = useState<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    ASSET_CATEGORIES.forEach((c) => { map[c] = [...(ASSET_SUB_CATEGORIES[c] ?? [])]; });
    return map;
  });

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [addingSubCategory, setAddingSubCategory] = useState(false);
  const [newSubCategory, setNewSubCategory] = useState("");

  const activeCategoryOptions = isAsset ? Object.keys(assetCategoryMap) : categoryOptions;
  const activeSubCategoryOptions = isAsset ? (assetCategoryMap[category] ?? []) : subCategoryOptions;

  const handleItemTypeChange = (next: string) => {
    if (next === ADD_NEW) { setAddingItemType(true); return; }
    const oldPrefix = codePrefixForType(itemType);
    const newPrefix = codePrefixForType(next);
    setItemType(next);
    // Auto-populate the code's type prefix. Swap it only when the field is empty
    // or still carries the previous type's auto prefix — never clobber a code the
    // user has fully typed.
    setCode((c) => {
      const t = c.trim();
      if (!t || t === oldPrefix || t === `${oldPrefix}-`) return `${newPrefix}-`;
      if (t.startsWith(`${oldPrefix}-`)) return `${newPrefix}-${t.slice(oldPrefix.length + 1)}`;
      return c;
    });
    // Asset uses a different Category/Sub Category preset — reset the selection on switch.
    if ((next === "Asset") !== isAsset) {
      setCategory("");
      setSubCategory("");
    }
  };

  const commitNewItemType = () => {
    const val = newItemType.trim();
    if (!val) { toast.error("Enter an item type name."); return; }
    if (!itemTypeOptions.some((t) => t.toLowerCase() === val.toLowerCase())) {
      setItemTypeOptions((prev) => [...prev, val]);
      toast.success(`Item type "${val}" added.`);
    }
    handleItemTypeChange(val);
    setNewItemType("");
    setAddingItemType(false);
  };

  const handleCategoryChange = (next: string) => {
    if (next === ADD_NEW) { setAddingCategory(true); return; }
    setCategory(next);
    if (isAsset && !(assetCategoryMap[next] ?? []).includes(subCategory)) setSubCategory("");
  };

  const commitNewCategory = () => {
    const val = newCategory.trim();
    if (!val) { toast.error("Enter a category name."); return; }
    if (isAsset) {
      setAssetCategoryMap((prev) => (prev[val] ? prev : { ...prev, [val]: [] }));
      setSubCategory("");
    } else if (!categoryOptions.some((c) => c.toLowerCase() === val.toLowerCase())) {
      setCategoryOptions((prev) => [...prev, val]);
      toast.success(`Category "${val}" added.`);
    }
    setCategory(val);
    setNewCategory("");
    setAddingCategory(false);
  };
  const commitNewSubCategory = () => {
    const val = newSubCategory.trim();
    if (!val) { toast.error("Enter a sub category name."); return; }
    if (isAsset) {
      if (!category) { toast.error("Select a category first."); return; }
      setAssetCategoryMap((prev) => {
        const existing = prev[category] ?? [];
        if (existing.some((s) => s.toLowerCase() === val.toLowerCase())) return prev;
        return { ...prev, [category]: [...existing, val] };
      });
    } else if (!subCategoryOptions.some((s) => s.toLowerCase() === val.toLowerCase())) {
      setSubCategoryOptions((prev) => [...prev, val]);
      toast.success(`Sub category "${val}" added.`);
    }
    setSubCategory(val);
    setNewSubCategory("");
    setAddingSubCategory(false);
  };

  const requiresBom = BOM_REQUIRED_ITEM_TYPES.includes(itemType as ItemRow["itemType"]);
  const existingBomForCode = useMemo(
    () => (code.trim() ? bomForItemCode(code.trim().toUpperCase()) : undefined),
    [code],
  );

  // Serving info — flows to Menu Planning meal items. weightVal is entered in the
  // Primary UOM's basis (Kg / g) and converted to grams (weightG) on save.
  const [weightVal, setWeightVal] = useState("");
  const [kcal, setKcal] = useState("");

  // Stock & storage
  const [shelfLife, setShelfLife] = useState("");
  const [reorderLevel, setReorderLevel] = useState("0");
  const [thresholdPct, setThresholdPct] = useState("20");
  // Office / Warehouse — multi-select. An item may be stocked in several offices
  // and several warehouses (which can span offices). The first of each list is
  // mirrored to the legacy single `officeId`/`warehouseId` on save so every
  // single-location reader keeps working.
  const [officeIds, setOfficeIds] = useState<string[]>([]);
  const [warehouseIds, setWarehouseIds] = useState<string[]>([]);
  const [customOffices, setCustomOffices] = useState<Office[]>([]);
  const [customWarehouses, setCustomWarehouses] = useState<Warehouse[]>([]);

  const officeOptions = useMemo(
    () => [...activeOffices, ...customOffices],
    [customOffices],
  );

  // Warehouses across every selected office (deduped), so multi-office items can
  // pick warehouses from any of their offices.
  const warehouseOptions = useMemo(() => {
    if (officeIds.length === 0) return [];
    const pool = [
      ...officeIds.flatMap((oid) => activeWarehousesByOffice(oid)),
      ...customWarehouses.filter((w) => officeIds.includes(w.officeId)),
    ];
    return Array.from(new Map(pool.map((w) => [w.id, w])).values());
  }, [officeIds, customWarehouses]);

  const toggleOffice = (id: string) => {
    const next = officeIds.includes(id) ? officeIds.filter((x) => x !== id) : [...officeIds, id];
    setOfficeIds(next);
    // Drop any selected warehouse whose office is no longer selected.
    setWarehouseIds((whs) => whs.filter((wid) => {
      const w = [...ALL_WAREHOUSES, ...customWarehouses].find((x) => x.id === wid);
      return !!w && next.includes(w.officeId);
    }));
  };

  const toggleWarehouse = (id: string) => {
    setWarehouseIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const addNewOffice = (val: string) => {
    const existing = officeOptions.find((o) => o.name.toLowerCase() === val.toLowerCase());
    if (existing) {
      if (!officeIds.includes(existing.id)) setOfficeIds((p) => [...p, existing.id]);
      return;
    }
    const office: Office = {
      id: `OFF-CUSTOM-${Date.now()}`,
      code: val.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "OTHER",
      name: val, companyId: "", address: "—", city: "—", manager: "—", phone: "—", status: "Active",
    };
    setCustomOffices((prev) => [...prev, office]);
    customOfficesRegistry.push(office);
    setOfficeIds((p) => [...p, office.id]);
    toast.success(`Office "${val}" added.`);
  };

  const addNewWarehouse = (val: string) => {
    if (officeIds.length === 0) { toast.error("Select an office first."); return; }
    const existing = warehouseOptions.find((w) => w.name.toLowerCase() === val.toLowerCase());
    if (existing) {
      if (!warehouseIds.includes(existing.id)) setWarehouseIds((p) => [...p, existing.id]);
      return;
    }
    // New warehouses attach to the first selected office.
    const officeId = officeIds[0];
    const warehouse: Warehouse = {
      id: `WH-CUSTOM-${Date.now()}`,
      code: val.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "OTHER",
      name: val, officeId, type: "Warehouse", address: "—", city: "—", manager: "—", phone: "—", status: "Active",
    };
    setCustomWarehouses((prev) => [...prev, warehouse]);
    customWarehousesRegistry.push(warehouse);
    setWarehouseIds((p) => [...p, warehouse.id]);
    toast.success(`Warehouse "${val}" added.`);
  };
  // Allocation method: "Auto" lets the smart default kick in based on item type/category.
  const [allocationChoice, setAllocationChoice] = useState<"Auto" | AllocationMethod>("Auto");
  const [batchTrackedChoice, setBatchTrackedChoice] = useState<boolean>(true);

  // Capability flags — default from the item type (purchasable unless Asset;
  // producible for Finished/Semi-Finished Goods). We keep tracking the type-based
  // default until the user manually ticks a box (`capsTouched`), after which their
  // explicit choice sticks even if the item type changes.
  const [canPurchase, setCanPurchase] = useState(true);
  const [canProduce, setCanProduce] = useState(false);
  const [canSell, setCanSell] = useState(true);
  const [capsTouched, setCapsTouched] = useState(false);
  useEffect(() => {
    if (capsTouched) return;
    setCanPurchase(itemType !== "Asset");
    setCanProduce(PRODUCIBLE_ITEM_TYPES.includes(itemType as ItemRow["itemType"]));
    setCanSell(itemType !== "Asset");
  }, [itemType, capsTouched]);

  // ALT UOMs — repeatable rows. Each row has its own draft state until added.
  const [altUoms, setAltUoms] = useState<AltUom[]>([]);
  const [altDraftUom, setAltDraftUom] = useState("");
  const [altDraftConversion, setAltDraftConversion] = useState("");

  const addAltUom = () => {
    const label = altDraftUom.trim();
    if (!label) { toast.error("Alt UOM label is required."); return; }
    if (label.toLowerCase() === uom.toLowerCase()) {
      toast.error("Alt UOM cannot match the Primary UOM.");
      return;
    }
    if (altUoms.some((a) => a.uom.toLowerCase() === label.toLowerCase())) {
      toast.error(`"${label}" is already configured.`);
      return;
    }
    const conv = Number(altDraftConversion);
    if (!conv || conv <= 0) {
      toast.error("Conversion factor must be a positive number.");
      return;
    }
    setAltUoms((prev) => [...prev, { uom: label, conversion: conv }]);
    setAltDraftUom("");
    setAltDraftConversion("");
  };

  const removeAltUom = (idx: number) => {
    setAltUoms((prev) => prev.filter((_, i) => i !== idx));
  };

  const save = () => {
    if (!name.trim()) { toast.error("Item name is required."); return; }
    if (!code.trim()) { toast.error("Item code is required."); return; }
    const reorder = Number(reorderLevel) || 0;
    const threshold = Number(thresholdPct) || 0;
    if (reorder < 0 || threshold < 0) {
      toast.error("Reorder level and threshold must be non-negative.");
      return;
    }

    // Every Finished Good must have a BOM. If one already exists for this
    // item code, save it as Active; otherwise save as Inactive and prompt
    // the user to create the BOM (chicken-and-egg: BOM creation needs the
    // item to already exist in the master).
    const itemTypeTyped = itemType as ItemRow["itemType"];
    const codeUpper = code.trim().toUpperCase();
    const hasBom = !!bomForItemCode(codeUpper);
    const fgWithoutBom = BOM_REQUIRED_ITEM_TYPES.includes(itemTypeTyped) && !hasBom;

    onSave({
      id: nextId,
      code: codeUpper,
      name: name.trim(),
      itemType: itemTypeTyped,
      category, subCategory, uom,
      status: fgWithoutBom ? "Inactive" : "Active",
      weightG: (Number(weightVal) * weightGramsPerUnit(uom)) || undefined,
      kcal: Number(kcal) || undefined,
      shelfLifeDays: Number(shelfLife) > 0 ? Number(shelfLife) : undefined,
      reorderLevel: reorder,
      thresholdPct: threshold,
      officeId: officeIds[0] || undefined,
      warehouseId: warehouseIds[0] || undefined,
      officeIds: officeIds.length > 0 ? officeIds : undefined,
      warehouseIds: warehouseIds.length > 0 ? warehouseIds : undefined,
      allocationMethod: allocationChoice === "Auto" ? undefined : allocationChoice,
      batchTracked: batchTrackedChoice,
      altUoms: altUoms.length > 0 ? altUoms : undefined,
      canPurchase,
      canProduce,
      canSell,
    });

    if (fgWithoutBom) {
      toast.warning(`"${name.trim()}" saved as Inactive — every Finished Good needs a BOM.`, {
        action: { label: "Create BOM", onClick: () => navigate("/bom") },
        duration: 8000,
      });
    } else {
      toast.success(`Item "${name.trim()}" created.`);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Create Item</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item ID</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Code <span className="text-destructive">*</span></Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1" placeholder="e.g. RM-RICE-BSMT" />
            <div className="mt-1 text-[11px] text-muted-foreground">
              Prefix <span className="font-mono font-semibold text-foreground">{codePrefixForType(itemType)}-</span> is set automatically from the Item Type — complete the rest.
            </div>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Name <span className="text-destructive">*</span></Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Type</Label>
            <select value={itemType} onChange={(e) => handleItemTypeChange(e.target.value)} className={selectCls}>
              {itemTypeOptions.map((t) => <option key={t}>{t}</option>)}
              <option value={ADD_NEW}>+ Add new item type…</option>
            </select>
            {addingItemType && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  autoFocus
                  value={newItemType}
                  onChange={(e) => setNewItemType(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitNewItemType(); } }}
                  placeholder="New item type name"
                  className="h-9"
                />
                <Button type="button" size="sm" onClick={commitNewItemType}>Add</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setAddingItemType(false); setNewItemType(""); }}>Cancel</Button>
              </div>
            )}
            {requiresBom && (
              <div
                className={cn(
                  "mt-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed flex items-start gap-2",
                  existingBomForCode
                    ? "border-success/30 bg-success/5 text-success"
                    : "border-warning/40 bg-warning/10 text-warning-foreground",
                )}
              >
                {existingBomForCode ? (
                  <>
                    <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-success" />
                    <span>
                      BOM <span className="font-mono font-semibold">{existingBomForCode.id}</span> already exists for code{" "}
                      <span className="font-mono font-semibold">{code.trim().toUpperCase()}</span>. This item will be linked to it on save.
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
                    <span>
                      Every <strong>Finished Good</strong> must have a BOM. Since BOMs reference items by code,
                      this item will be saved as <strong>Inactive</strong> until you create its BOM in the BOM module.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Category</Label>
            <select
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className={selectCls}
            >
              <option value="">Select category</option>
              {activeCategoryOptions.map((c) => <option key={c}>{c}</option>)}
              <option value={ADD_NEW}>+ Add new category…</option>
            </select>
            {addingCategory && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  autoFocus
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitNewCategory(); } }}
                  placeholder="New category name"
                  className="h-9"
                />
                <Button type="button" size="sm" onClick={commitNewCategory}>Add</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setAddingCategory(false); setNewCategory(""); }}>Cancel</Button>
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Sub Category</Label>
            <select
              value={subCategory}
              onChange={(e) => { e.target.value === ADD_NEW ? setAddingSubCategory(true) : setSubCategory(e.target.value); }}
              disabled={isAsset && !category}
              className={selectCls}
            >
              <option value="">{isAsset && !category ? "Select category first" : "Select sub category"}</option>
              {activeSubCategoryOptions.map((s) => <option key={s}>{s}</option>)}
              <option value={ADD_NEW}>+ Add new sub category…</option>
            </select>
            {addingSubCategory && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  autoFocus
                  value={newSubCategory}
                  onChange={(e) => setNewSubCategory(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitNewSubCategory(); } }}
                  placeholder="New sub category name"
                  className="h-9"
                />
                <Button type="button" size="sm" onClick={commitNewSubCategory}>Add</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setAddingSubCategory(false); setNewSubCategory(""); }}>Cancel</Button>
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Primary UOM</Label>
            <select
              value={uom}
              onChange={(e) => { e.target.value === ADD_NEW ? setAddingUom(true) : handleUomChange(e.target.value); }}
              className={selectCls}
            >
              {uomOptions.map((u) => <option key={u}>{u}</option>)}
              <option value={ADD_NEW}>+ Add new UOM…</option>
            </select>
            {addingUom && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  autoFocus
                  value={newUomLabel}
                  onChange={(e) => setNewUomLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitNewUom(); } }}
                  placeholder="New UOM name (e.g. Can, Roll)"
                  className="h-9"
                />
                <Button type="button" size="sm" onClick={commitNewUom}>Add</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setAddingUom(false); setNewUomLabel(""); }}>Cancel</Button>
              </div>
            )}
            <div className="mt-1 text-[11px] text-muted-foreground">
              Stock is always kept in this unit. Add ALT UOMs below for transactions in other units.
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Weight ({weightUnitLabel(uom)})</Label>
            <Input type="number" min={0} step="any" value={weightVal} onChange={(e) => setWeightVal(e.target.value)} placeholder="0" className="mt-1" />
            <div className="mt-1 text-[11px] text-muted-foreground">
              Default serving weight used in Menu Planning.
              {weightUnitLabel(uom) !== "g" && Number(weightVal) > 0 && (
                <> = {roundQty(Number(weightVal) * weightGramsPerUnit(uom))} g</>
              )}
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Kcal</Label>
            <Input type="number" min={0} value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="0" className="mt-1" />
            <div className="mt-1 text-[11px] text-muted-foreground">Default energy per serving used in Menu Planning.</div>
          </div>

          {/* ── Item capabilities ──────────────────────────────────────── */}
          <div className="md:col-span-2 mt-2 pt-4 border-t border-border">
            <CapabilityChecks
              canPurchase={canPurchase}
              canProduce={canProduce}
              canSell={canSell}
              onPurchase={(v) => { setCapsTouched(true); setCanPurchase(v); }}
              onProduce={(v) => { setCapsTouched(true); setCanProduce(v); }}
              onSell={(v) => { setCapsTouched(true); setCanSell(v); }}
            />
          </div>

          {/* ── ALT UOMs ───────────────────────────────────────────────── */}
          <div className="md:col-span-2 mt-2 pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Alternative UOMs <span className="text-muted-foreground/70 normal-case font-normal">(optional)</span>
              </h4>
              {altUoms.length > 0 && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {altUoms.length} configured
                </span>
              )}
            </div>

            <div className="text-[11px] text-muted-foreground mb-3">
              ALT UOMs let users transact in different units (e.g. <span className="font-semibold text-foreground">Dozen</span>, <span className="font-semibold text-foreground">Tray</span>, <span className="font-semibold text-foreground">Carton</span>) while inventory stays in <span className="font-semibold text-foreground">{uom}</span>. The system auto-converts at save time.
            </div>

            {altUoms.length > 0 && (
              <div className="rounded-md border border-border overflow-hidden mb-3">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold">ALT UOM</th>
                      <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-semibold">Conversion</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold">Equivalence</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {altUoms.map((a, i) => (
                      <tr key={`${a.uom}-${i}`} className="border-t border-border/50">
                        <td className="px-3 py-1.5 font-medium">{a.uom}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{a.conversion}</td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">
                          1 {a.uom} = <span className="font-semibold text-foreground tabular-nums">{a.conversion}</span> {uom}
                        </td>
                        <td className="px-3 py-1.5">
                          <button
                            type="button"
                            onClick={() => removeAltUom(i)}
                            className="text-muted-foreground hover:text-destructive text-sm"
                            aria-label={`Remove ${a.uom}`}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Alt UOM Label</Label>
                <select
                  value={altDraftUom}
                  onChange={(e) => { e.target.value === ADD_NEW ? setAddingAltUomOption(true) : setAltDraftUom(e.target.value); }}
                  className={selectCls}
                >
                  <option value="">Select alt UOM…</option>
                  {altUomOptions.filter(
                    (opt) =>
                      opt.toLowerCase() !== uom.toLowerCase() &&
                      !altUoms.some((a) => a.uom.toLowerCase() === opt.toLowerCase()),
                  ).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                  <option value={ADD_NEW}>+ Add new alt UOM…</option>
                </select>
                {addingAltUomOption && (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      autoFocus
                      value={newAltUomOption}
                      onChange={(e) => setNewAltUomOption(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitNewAltUomOption(); } }}
                      placeholder="New alt UOM (e.g. Jar, Roll)"
                      className="h-9"
                    />
                    <Button type="button" size="sm" onClick={commitNewAltUomOption}>Add</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => { setAddingAltUomOption(false); setNewAltUomOption(""); }}>Cancel</Button>
                  </div>
                )}
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Conversion to {uom}
                </Label>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  value={altDraftConversion}
                  onChange={(e) => setAltDraftConversion(e.target.value)}
                  placeholder="e.g. 12"
                  className="mt-1 tabular-nums"
                />
              </div>
              <Button type="button" variant="outline" onClick={addAltUom}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
          </div>

          <div className="md:col-span-2 mt-2 pt-4 border-t border-border">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Stock & Storage
            </h4>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Shelf Life (days)</Label>
            <Input type="number" min={0} value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} placeholder="Category default" className="mt-1 tabular-nums" />
            <div className="mt-1 text-[11px] text-muted-foreground">Drives projected batch expiry (receipt + shelf life). Leave blank for the category default.</div>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Reorder Level ({uom})</Label>
            <div className="relative mt-1">
              <Input type="number" min={0} value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} className="tabular-nums pr-16" />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted-foreground">{uom}</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">Trigger point in the item's stock unit ({uom}).</div>
          </div>

          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Stock Threshold (%)</Label>
            <Input type="number" min={0} value={thresholdPct} onChange={(e) => setThresholdPct(e.target.value)} className="mt-1 tabular-nums" />
            <div className="mt-2 rounded-md bg-muted/40 border border-border px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
              Sets the buffer above the Reorder Level that triggers <span className="font-semibold text-warning-foreground">Low</span> status.
              Stock below Reorder Level = <span className="font-semibold text-destructive">Critical</span>.
              Stock below Reorder Level × (1 + Threshold%) = <span className="font-semibold text-warning-foreground">Low</span>.
              <div className="mt-1">
                <span className="text-foreground/70">Example:</span> Reorder = 100, Threshold = 20% → Low when stock &lt; 120, Critical when stock &lt; 100.
              </div>
            </div>
          </div>
          <LocationMultiSelect
            label="Office"
            entity="office"
            placeholder="Select offices…"
            options={officeOptions}
            selectedIds={officeIds}
            onToggle={toggleOffice}
            onAddNew={addNewOffice}
          />
          <LocationMultiSelect
            label="Warehouse"
            entity="warehouse"
            placeholder="Select warehouses…"
            emptyPlaceholder="Select an office first"
            options={warehouseOptions}
            selectedIds={warehouseIds}
            onToggle={toggleWarehouse}
            onAddNew={addNewWarehouse}
            disabled={officeIds.length === 0}
          />
          <div className="md:col-span-2 -mt-1 text-[11px] text-muted-foreground">
            Offices + warehouses this item may be stocked in — pick as many as apply. Used to group stock and prefill location pickers.
          </div>

          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Stock Tracking</Label>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Stock tracking mode">
              {STOCK_TRACKING_OPTIONS.map((opt) => (
                <OptionCard
                  key={String(opt.value)}
                  icon={opt.icon}
                  title={opt.title}
                  desc={opt.desc}
                  active={batchTrackedChoice === opt.value}
                  onSelect={() => setBatchTrackedChoice(opt.value)}
                />
              ))}
            </div>
          </div>

          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Allocation Method
              {!batchTrackedChoice && (
                <span className="ml-2 text-[10px] font-normal italic text-muted-foreground/80">
                  not applicable for Single Item
                </span>
              )}
            </Label>
            <div
              className={cn(
                "mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3",
                !batchTrackedChoice && "opacity-50 pointer-events-none",
              )}
              role="radiogroup"
              aria-label="Allocation method"
            >
              {ALLOCATION_OPTIONS.map((opt) => (
                <OptionCard
                  key={opt.value}
                  icon={opt.icon}
                  title={opt.title}
                  desc={opt.desc}
                  active={allocationChoice === opt.value}
                  onSelect={() => setAllocationChoice(opt.value)}
                />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Opening Stock dialog ───────────────────────────────────────────────────

type OpeningStockLine = {
  id: string;
  itemId: string;
  itemName: string;
  uom: string;
  batchTracked: boolean;
  batchNo: string;
  qty: number;
  unitCost: number;
  expiry: string;
  bin: string;
};

function OpeningStockDialog({
  open, onOpenChange, items,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  items: ItemRow[];
}) {
  const [pickQuery, setPickQuery] = useState("");
  const [pickedId, setPickedId] = useState<string>("");
  const [batchNo, setBatchNo] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [expiry, setExpiry] = useState("");
  const [bin, setBin] = useState("");
  const [lines, setLines] = useState<OpeningStockLine[]>([]);

  const picked = items.find((i) => i.id === pickedId);
  const isBatch = picked ? isBatchTrackedForMaster(picked.id) : true;

  const filtered = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return items.slice(0, 30);
    return items.filter(
      (i) =>
        i.id.toLowerCase().includes(q) ||
        i.code.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q),
    ).slice(0, 30);
  }, [items, pickQuery]);

  const reset = () => {
    setPickQuery(""); setPickedId(""); setBatchNo("");
    setQty(""); setUnitCost(""); setExpiry(""); setBin("");
    setLines([]);
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const addLine = () => {
    if (!picked) { toast.error("Pick an item first."); return; }
    const q = Number(qty);
    if (!q || q <= 0) { toast.error("Quantity must be a positive number."); return; }
    const c = Number(unitCost);
    if (c < 0 || isNaN(c)) { toast.error("Unit cost must be zero or positive."); return; }
    if (isBatch && !batchNo.trim()) {
      toast.error("Batch number is required for batch-tracked items.");
      return;
    }
    if (isBatch && !expiry) {
      toast.error("Expiry date is required for batch-tracked items.");
      return;
    }
    const line: OpeningStockLine = {
      id: `os-${Date.now()}`,
      itemId: picked.id,
      itemName: picked.name,
      uom: picked.uom,
      batchTracked: isBatch,
      batchNo: isBatch ? batchNo.trim().toUpperCase() : "—",
      qty: q,
      unitCost: c,
      expiry: isBatch ? expiry : "—",
      bin: bin.trim() || picked.binLocation || "—",
    };
    setLines((prev) => [line, ...prev]);
    setBatchNo(""); setQty(""); setUnitCost(""); setExpiry(""); setBin("");
    toast.success(`Added ${picked.name} (${q} ${picked.uom}) to queue.`);
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const commit = () => {
    if (lines.length === 0) {
      toast.error("Add at least one opening stock line before submitting.");
      return;
    }
    const totalValue = lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
    const distinctItems = new Set(lines.map((l) => l.itemId)).size;
    toast.success(
      `Opening stock recorded · ${lines.length} batch${lines.length === 1 ? "" : "es"} across ${distinctItems} item${distinctItems === 1 ? "" : "s"} · ৳${totalValue.toLocaleString()} value.`,
    );
    reset();
    onOpenChange(false);
  };

  const totalLineValue = (l: OpeningStockLine) => l.qty * l.unitCost;
  const totalQueueValue = lines.reduce((s, l) => s + totalLineValue(l), 0);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl w-[min(95vw,860px)] max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border bg-muted/30">
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-primary" />
            Opening Stock
          </DialogTitle>
          <DialogDescription className="text-xs">
            Record initial on-hand balances for items. Batch-tracked items require a batch number and expiry; single items just need a quantity.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-5 py-4 space-y-4 flex-1">
          {/* Item picker */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Pick Item</Label>
              <div className="mt-1 relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={pickQuery}
                  onChange={(e) => setPickQuery(e.target.value)}
                  placeholder="Search by code, name, or category…"
                  className="pl-8"
                />
              </div>
              <div className="mt-1 max-h-44 overflow-y-auto border border-border rounded-md bg-card">
                {filtered.length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-foreground">
                    No matches. Try a different keyword.
                  </div>
                ) : (
                  filtered.map((i) => {
                    const active = i.id === pickedId;
                    return (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => {
                          setPickedId(i.id);
                          setBin(i.binLocation ?? "");
                        }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-xs border-b border-border/40 last:border-0 transition-colors flex items-center gap-2",
                          active ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
                        )}
                      >
                        <span className="font-mono text-[10px] text-muted-foreground w-16 shrink-0">{i.code}</span>
                        <span className="flex-1 truncate font-medium">{i.name}</span>
                        <span className="text-[10px] text-muted-foreground">{i.uom}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="space-y-3">
              {picked ? (
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                  <div className="font-semibold text-primary">{picked.name}</div>
                  <div className="text-muted-foreground mt-0.5">
                    {picked.code} · {picked.category} · stock in <span className="font-semibold text-foreground">{picked.uom}</span>
                  </div>
                  <div className="mt-1 text-[10px]">
                    Tracking: <span className={cn("font-semibold", isBatch ? "text-emerald-700" : "text-muted-foreground")}>
                      {isBatch ? "Batch-tracked" : "Single item"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground text-center">
                  Select an item from the list to enter opening balance.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Quantity {picked && <span className="normal-case text-muted-foreground/70">({picked.uom})</span>}
                  </Label>
                  <Input
                    type="number" min={0} step="0.001"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    disabled={!picked}
                    placeholder="0"
                    className="mt-1 tabular-nums"
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Unit Cost (৳)</Label>
                  <Input
                    type="number" min={0} step="0.01"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                    disabled={!picked}
                    placeholder="0.00"
                    className="mt-1 tabular-nums"
                  />
                </div>
              </div>

              {isBatch && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Batch No.</Label>
                    <Input
                      value={batchNo}
                      onChange={(e) => setBatchNo(e.target.value)}
                      disabled={!picked}
                      placeholder="e.g. OB-2026-001"
                      className="mt-1 font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Expiry</Label>
                    <Input
                      type="date"
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                      disabled={!picked}
                      className="mt-1 tabular-nums"
                    />
                  </div>
                </div>
              )}

              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Bin Location</Label>
                <Input
                  value={bin}
                  onChange={(e) => setBin(e.target.value)}
                  disabled={!picked}
                  placeholder={picked?.binLocation ? `default: ${picked.binLocation}` : "e.g. A1-R3-S2"}
                  className="mt-1 font-mono"
                />
              </div>

              <Button type="button" onClick={addLine} disabled={!picked} className="w-full">
                <Plus className="h-4 w-4 mr-1" /> Add to Queue
              </Button>
            </div>
          </div>

          {/* Queue table */}
          <div className="pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pending Opening Stock <span className="text-muted-foreground/70 normal-case font-normal">({lines.length})</span>
              </h4>
              {lines.length > 0 && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  Total value: <span className="font-semibold text-foreground">৳{totalQueueValue.toLocaleString()}</span>
                </span>
              )}
            </div>

            {lines.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-6 text-xs text-muted-foreground text-center">
                No lines yet. Pick an item, enter the opening balance, and click "Add to Queue".
              </div>
            ) : (
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold">Item</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold">Batch</th>
                      <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-semibold">Qty</th>
                      <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-semibold">Cost</th>
                      <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-semibold">Value</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold">Expiry</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold">Bin</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-t border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-1.5 font-medium">{l.itemName}</td>
                        <td className="px-3 py-1.5 font-mono text-[10px]">{l.batchNo}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{l.qty} {l.uom}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">৳{l.unitCost.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                          ৳{totalLineValue(l).toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{l.expiry}</td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground">{l.bin}</td>
                        <td className="px-3 py-1.5">
                          <button
                            type="button"
                            onClick={() => removeLine(l.id)}
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Remove line"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border bg-muted/20">
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button onClick={commit} disabled={lines.length === 0}>
            <Save className="h-4 w-4 mr-1.5" />
            Submit {lines.length > 0 ? `(${lines.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk Upload dialog ─────────────────────────────────────────────────────

type ParsedRow = {
  row: number;
  raw: Record<string, string>;
  data?: ItemRow;
  errors: string[];
};

const BULK_TEMPLATE_HEADERS = [
  "code", "name", "itemType", "category", "subCategory", "uom",
  "reorderLevel", "thresholdPct", "office", "warehouse", "binLocation",
  "batchTracked", "allocationMethod",
] as const;

const TEMPLATE_CSV =
  BULK_TEMPLATE_HEADERS.join(",") + "\n" +
  [
    "RM-RICE-PSHM,Premium Basmati Rice,Raw Material,Grains,Rice,Kg,150,20,HQ-DAC,WH-DAC-01,A1-R2-S1,true,FEFO",
    "PK-BAG-BRN,Brown Paper Bag,Packaging,Packaging,Boxes & Trays,Pcs,500,15,HQ-DAC,WH-DAC-01,B2-R1-S3,false,FIFO",
    "BV-JCE-MNG,Mango Juice 200ml,Finished Good,Beverage,Juice,Pcs,200,25,HQ-DAC,CS-DAC-01,C1-R4-S2,true,FEFO",
  ].join("\n");

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

function validateRow(
  raw: Record<string, string>,
  rowIndex: number,
  id: string,
  existingCodes: Set<string>,
  newCodes: Set<string>,
): ParsedRow {
  const errors: string[] = [];

  const code = (raw.code ?? "").trim().toUpperCase();
  const name = (raw.name ?? "").trim();
  const itemTypeRaw = (raw.itemType ?? "").trim();
  const category = (raw.category ?? "").trim();
  const subCategory = (raw.subCategory ?? "").trim();
  const uom = (raw.uom ?? "").trim();
  const reorderRaw = (raw.reorderLevel ?? "0").trim();
  const thresholdRaw = (raw.thresholdPct ?? "20").trim();
  const officeRaw = (raw.office ?? "").trim();
  const warehouseRaw = (raw.warehouse ?? "").trim();
  const bin = (raw.binLocation ?? "").trim();
  const batchRaw = (raw.batchTracked ?? "true").trim().toLowerCase();
  const allocRaw = (raw.allocationMethod ?? "").trim().toUpperCase();

  if (!code) errors.push("code required");
  else if (existingCodes.has(code)) errors.push(`code "${code}" already exists`);
  else if (newCodes.has(code)) errors.push(`code "${code}" duplicated in file`);

  if (!name) errors.push("name required");

  const itemType = ITEM_TYPES.find((t) => t.toLowerCase() === itemTypeRaw.toLowerCase());
  if (!itemType) errors.push(`itemType must be one of: ${ITEM_TYPES.join(" / ")}`);

  if (category && !ITEM_CATEGORIES.includes(category as never)) {
    errors.push(`category "${category}" not in master list`);
  }
  if (subCategory && !ITEM_SUB_CATEGORIES.includes(subCategory as never)) {
    errors.push(`subCategory "${subCategory}" not in master list`);
  }
  if (uom && !ITEM_UOMS.includes(uom as never)) {
    errors.push(`uom "${uom}" not in master list`);
  }

  const reorder = Number(reorderRaw);
  if (isNaN(reorder) || reorder < 0) errors.push("reorderLevel must be ≥ 0");
  const threshold = Number(thresholdRaw);
  if (isNaN(threshold) || threshold < 0) errors.push("thresholdPct must be ≥ 0");

  let officeId: string | undefined;
  if (officeRaw) {
    const off = ALL_OFFICES.find(
      (o) => o.code.toLowerCase() === officeRaw.toLowerCase() ||
             o.id.toLowerCase()   === officeRaw.toLowerCase(),
    );
    if (!off) errors.push(`office "${officeRaw}" not in master list`);
    else officeId = off.id;
  }

  let warehouseId: string | undefined;
  if (warehouseRaw) {
    const wh = ALL_WAREHOUSES.find(
      (w) => w.code.toLowerCase() === warehouseRaw.toLowerCase() ||
             w.id.toLowerCase()   === warehouseRaw.toLowerCase(),
    );
    if (!wh) {
      errors.push(`warehouse "${warehouseRaw}" not in master list`);
    } else {
      warehouseId = wh.id;
      if (officeId && wh.officeId !== officeId) {
        errors.push(`warehouse "${warehouseRaw}" does not belong to office "${officeRaw}"`);
      } else if (!officeId) {
        // Office wasn't supplied — infer it from the warehouse so the row stays consistent.
        officeId = wh.officeId;
      }
    }
  }

  const batchTracked = batchRaw === "true" || batchRaw === "1" || batchRaw === "yes";

  let allocationMethod: AllocationMethod | undefined;
  if (allocRaw) {
    if (allocRaw !== "FIFO" && allocRaw !== "FEFO") {
      errors.push("allocationMethod must be FIFO or FEFO (or blank for Auto)");
    } else {
      allocationMethod = allocRaw as AllocationMethod;
    }
  }

  if (errors.length > 0) {
    return { row: rowIndex, raw, errors };
  }

  return {
    row: rowIndex,
    raw,
    errors: [],
    data: {
      id,
      code,
      name,
      itemType: itemType as ItemRow["itemType"],
      category,
      subCategory,
      uom: uom || ITEM_UOMS[0],
      status: "Active",
      reorderLevel: reorder,
      thresholdPct: threshold,
      officeId,
      warehouseId,
      binLocation: bin || undefined,
      batchTracked,
      allocationMethod,
    },
  };
}

function BulkUploadDialog({
  open, onOpenChange, existingCodes, nextIdFor, onImport,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  existingCodes: Set<string>;
  nextIdFor: (offset?: number) => string;
  onImport: (items: ItemRow[]) => void;
}) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedRow[]>([]);

  const reset = () => { setFileName(""); setParsed([]); };
  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? "");
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast.error("No rows found. Check the file headers and content.");
        setParsed([]);
        return;
      }
      const newCodes = new Set<string>();
      let nextOffset = 0;
      const out: ParsedRow[] = rows.map((r, i) => {
        const id = nextIdFor(nextOffset);
        const validated = validateRow(r, i + 2, id, existingCodes, newCodes);
        if (validated.data) {
          newCodes.add(validated.data.code);
          nextOffset++;
        }
        return validated;
      });
      setParsed(out);
      const valid = out.filter((r) => r.data).length;
      const invalid = out.length - valid;
      if (invalid === 0) {
        toast.success(`Parsed ${valid} row${valid === 1 ? "" : "s"} — all valid.`);
      } else {
        toast.warning(`Parsed ${out.length} rows — ${valid} valid, ${invalid} need fixing.`);
      }
    };
    reader.onerror = () => toast.error("Failed to read file.");
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "item-bulk-upload-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Template downloaded.");
  };

  const validRows = parsed.filter((r) => r.data) as Array<ParsedRow & { data: ItemRow }>;
  const invalidRows = parsed.filter((r) => !r.data);

  const doImport = () => {
    if (validRows.length === 0) {
      toast.error("No valid rows to import.");
      return;
    }
    onImport(validRows.map((r) => r.data));
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-4xl w-[min(95vw,960px)] max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border bg-muted/30">
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Bulk Upload Items
          </DialogTitle>
          <DialogDescription className="text-xs">
            Upload a CSV to create many items at once. Download the template first to see required columns and example rows.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Step 1: template */}
          <div className="rounded-md border border-border bg-muted/20 p-3 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <FileSpreadsheet className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-sm font-semibold">Step 1 · Download Template</div>
                <div className="text-[11px] text-muted-foreground">
                  Columns: {BULK_TEMPLATE_HEADERS.join(", ")}
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="shrink-0">
              <Download className="h-4 w-4 mr-1.5" /> Template CSV
            </Button>
          </div>

          {/* Step 2: file picker */}
          <div className="rounded-md border border-border p-3">
            <div className="flex items-start gap-2">
              <Upload className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-semibold mb-1">Step 2 · Upload CSV</div>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                />
                {fileName && (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Loaded: <span className="font-mono text-foreground">{fileName}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Step 3: preview */}
          {parsed.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Preview · {parsed.length} row{parsed.length === 1 ? "" : "s"}
                </h4>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-success" /> {validRows.length} valid
                  </span>
                  {invalidRows.length > 0 && (
                    <span className="flex items-center gap-1 text-destructive">
                      <AlertTriangle className="h-3 w-3" /> {invalidRows.length} errors
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-md border border-border overflow-x-auto max-h-[40vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold w-12">Row</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold w-16">Status</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold">Code</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold">Name</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold">Type</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold">Category</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold">UOM</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((p) => {
                      const ok = !!p.data;
                      return (
                        <tr
                          key={p.row}
                          className={cn(
                            "border-t border-border/50",
                            ok ? "hover:bg-muted/20" : "bg-destructive/5",
                          )}
                        >
                          <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{p.row}</td>
                          <td className="px-3 py-1.5">
                            {ok ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success">
                                <CheckCircle className="h-3 w-3" /> OK
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-destructive">
                                <AlertTriangle className="h-3 w-3" /> ERR
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[10px]">{p.raw.code ?? ""}</td>
                          <td className="px-3 py-1.5">{p.raw.name ?? ""}</td>
                          <td className="px-3 py-1.5">{p.raw.itemType ?? ""}</td>
                          <td className="px-3 py-1.5">{p.raw.category ?? ""}</td>
                          <td className="px-3 py-1.5">{p.raw.uom ?? ""}</td>
                          <td className="px-3 py-1.5 text-[10px]">
                            {ok ? (
                              <span className="text-muted-foreground">→ {p.data!.id}</span>
                            ) : (
                              <span className="text-destructive">{p.errors.join("; ")}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border bg-muted/20">
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button onClick={doImport} disabled={validRows.length === 0}>
            <Save className="h-4 w-4 mr-1.5" />
            Import {validRows.length > 0 ? `${validRows.length} item${validRows.length === 1 ? "" : "s"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
