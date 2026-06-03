import { useNavigate } from "react-router-dom";
import { useMemo, useState, useSyncExternalStore } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, ArrowLeft, Save, Tag, CheckCircle, XCircle,
  ChevronRight, ChevronDown, FolderTree,
  Boxes, Upload, Download, FileSpreadsheet, Trash2, AlertTriangle, Search,
} from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  items as MASTER_ITEMS,
  ITEM_TYPES,
  ITEM_CATEGORIES,
  ITEM_SUB_CATEGORIES,
  ITEM_UOMS,
  ALT_UOM_OPTIONS,
  activeOffices,
  offices as ALL_OFFICES,
  activeWarehousesByOffice,
  warehouses as ALL_WAREHOUSES,
  bomForItemCode,
  BOM_REQUIRED_ITEM_TYPES,
  getAllocationMethodForMaster,
  getAllocationChoiceForMaster,
  clearAllocationOverride,
  setAllocationMethod,
  isBatchTrackedForMaster,
  setBatchTracked,
  subscribeAllocationMethod,
  getAllocationVersion,
  type ItemMaster,
  type AllocationMethod,
  type AltUom,
} from "@/lib/sample-data";

type ItemRow = ItemMaster;

const CATEGORIES = ITEM_CATEGORIES;
const SUB_CATEGORIES = ITEM_SUB_CATEGORIES;
const UOMS = ITEM_UOMS;

/** Sentinel option value used by the Category / Sub Category dropdowns to open
 *  the inline "add new" input. */
const ADD_NEW = "__add_new__";

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";


export default function ConfigItemPage() {
  const [rows, setRows] = usePersistedState<ItemRow[]>("config-item-rows", MASTER_ITEMS);
  const [view, setView] = useState<"list" | "create">("list");
  const [tab, setTab] = useState<"items" | "category">("items");
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
          tab === "items" ? (
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
                onClick={() => setView(view === "create" ? "list" : "create")}
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

      <Tabs value={tab} onValueChange={(v) => setTab(v as "items" | "category")} className="space-y-5">
        <TabsList className="h-auto gap-6 bg-transparent p-0 pt-2 border-b border-border w-full justify-start rounded-none">
          <TabsTrigger
            value="items"
            className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-1 pb-3"
          >
            Item Profile
          </TabsTrigger>
          <TabsTrigger
            value="category"
            className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-1 pb-3"
          >
            Category
          </TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-0">
          {view === "list" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <KpiCard label="Total Items" value={rows.length} icon={Tag} tone="navy" />
                <KpiCard label="Active" value={activeCount} icon={CheckCircle} tone="success" />
                <KpiCard label="Inactive" value={rows.length - activeCount} icon={XCircle} tone="warning" />
              </div>
              <ItemList data={rows} onToggle={toggle} />
            </>
          ) : (
            <ItemCreate nextId={`ITM-${String(rows.length + 1).padStart(3, "0")}`} onSave={add} />
          )}
        </TabsContent>

        <TabsContent value="category" className="mt-0">
          <CategoryManager items={rows} />
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

function MethodToggle({ master }: { master: ItemRow }) {
  const batched = isBatchTrackedForMaster(master.id);

  if (!batched) {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border border-border bg-muted/40 text-muted-foreground"
        title="Single-item — FIFO/FEFO not applicable."
      >
        N/A
      </span>
    );
  }

  // "Auto" = follow the system's smart default (no explicit override). FEFO/FIFO
  // set an explicit override. `resolved` is what Auto currently maps to.
  const choice = getAllocationChoiceForMaster(master.id);
  const resolved = getAllocationMethodForMaster(master.id);
  const setChoice = (c: "Auto" | AllocationMethod) => {
    if (c === choice) return;
    if (c === "Auto") {
      clearAllocationOverride(master.id);
      toast.success(`${master.name} set to Auto (${resolved}).`);
    } else {
      setAllocationMethod(master.id, c);
      toast.success(`${master.name} switched to ${c}.`);
    }
  };
  const titleFor = (c: "Auto" | AllocationMethod) =>
    c === "Auto" ? `Auto — resolves to ${resolved} by item type/category`
      : c === "FEFO" ? "First-Expiry-First-Out"
      : "First-In-First-Out";
  return (
    <div
      className="inline-flex items-center rounded-md border border-input bg-background p-0.5 shadow-sm"
      role="group"
      aria-label={`Allocation method for ${master.name}`}
    >
      {(["Auto", "FEFO", "FIFO"] as const).map((m) => {
        const active = choice === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => setChoice(m)}
            className={cn(
              "px-2 py-0.5 text-[10px] font-semibold rounded-sm transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={titleFor(m)}
          >
            {m === "Auto" ? "AUTO" : m}
          </button>
        );
      })}
    </div>
  );
}

function BatchToggle({ master }: { master: ItemRow }) {
  const current = isBatchTrackedForMaster(master.id);
  const toggle = (next: boolean) => {
    if (next === current) return;
    setBatchTracked(master.id, next);
    toast.success(`${master.name} is now ${next ? "batch-tracked" : "a single item"}.`);
  };
  return (
    <div
      className="inline-flex items-center rounded-md border border-input bg-background p-0.5 shadow-sm"
      role="group"
      aria-label={`Batch tracking for ${master.name}`}
    >
      {([
        { label: "Batch",  value: true  },
        { label: "Single", value: false },
      ] as const).map((opt) => {
        const active = current === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => toggle(opt.value)}
            className={cn(
              "px-2 py-0.5 text-[10px] font-semibold rounded-sm transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={
              opt.value
                ? "Tracked as discrete batches with expiry, FIFO/FEFO applies"
                : "Single non-batched stock; no batch lot, no FIFO/FEFO"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ItemList({ data, onToggle }: { data: ItemRow[]; onToggle: (id: string) => void }) {
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
      key: "code" as keyof ItemRow,
      header: "BOM",
      render: (r) => {
        const requiresBom = BOM_REQUIRED_ITEM_TYPES.includes(r.itemType);
        if (!requiresBom) return <span className="text-muted-foreground text-xs">—</span>;
        const bom = bomForItemCode(r.code);
        if (bom) {
          return (
            <button
              type="button"
              onClick={() => navigate("/bom")}
              className="inline-flex items-center gap-1.5 rounded border border-success/30 bg-success/5 px-1.5 py-0.5 text-[10px] font-semibold text-success hover:bg-success/10"
              title={`Linked to ${bom.name} (${bom.version})`}
            >
              <CheckCircle className="h-3 w-3" />
              <span className="font-mono">{bom.id}</span>
            </button>
          );
        }
        return (
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded border border-destructive/30 bg-destructive/5 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
              <AlertTriangle className="h-3 w-3" /> Missing
            </span>
            <button
              type="button"
              onClick={() => navigate("/bom")}
              className="text-[10px] font-semibold text-primary hover:underline"
            >
              Create BOM
            </button>
          </div>
        );
      },
    },
    {
      key: "warehouseId" as keyof ItemRow,
      header: "Office / Warehouse",
      render: (r) => {
        const wh = r.warehouseId ? ALL_WAREHOUSES.find((w) => w.id === r.warehouseId) : undefined;
        const officeId = r.officeId ?? wh?.officeId;
        const off = officeId ? ALL_OFFICES.find((o) => o.id === officeId) : undefined;
        if (!off && !wh) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <div className="text-xs leading-tight">
            <div>{off ? `${off.code} — ${off.name}` : <span className="text-muted-foreground">—</span>}</div>
            <div className="text-muted-foreground">{wh ? `${wh.code} — ${wh.name}` : "—"}</div>
          </div>
        );
      },
    },
    {
      key: "binLocation",
      header: "Bin",
      render: (r) =>
        r.binLocation ? (
          <span className="font-mono text-[11px]">{r.binLocation}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: "batchTracked" as keyof ItemRow,
      header: "Tracking",
      render: (r) => <BatchToggle master={r} />,
    },
    {
      key: "allocationMethod" as keyof ItemRow,
      header: "Method",
      render: (r) => <MethodToggle master={r} />,
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
      actions={(r) => <RowActions row={r} actions={["view", "edit", "print"]} editDetail={<ItemEditForm row={r} />} />}
    />
  );
}

/** Edit form shown inside the row-actions modal — mirrors the Create Item
 *  layout (sectioned fields, inline "+ Add new" category/sub-category) but
 *  pre-filled from the selected row. */
function ItemEditForm({ row }: { row: ItemRow }) {
  const [code, setCode] = useState(row.code ?? "");
  const [name, setName] = useState(row.name ?? "");
  const [itemType, setItemType] = useState<string>(row.itemType ?? ITEM_TYPES[0]);
  const [category, setCategory] = useState(row.category ?? "");
  const [subCategory, setSubCategory] = useState(row.subCategory ?? "");
  const [uom, setUom] = useState<string>(row.uom ?? UOMS[0]);
  const [status, setStatus] = useState<string>(row.status ?? "Active");
  const [costPrice, setCostPrice] = useState(String(row.costPrice ?? ""));
  const [allocation, setAllocation] = useState<"Auto" | AllocationMethod>(getAllocationChoiceForMaster(row.id));
  const [batchTracked, setBatchTracked] = useState(isBatchTrackedForMaster(row.id));

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
          <select value={uom} onChange={(e) => setUom(e.target.value)} className={selectCls}>
            {UOMS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className={lbl}>Cost Price (৳)</Label>
          <Input type="number" min={0} value={costPrice} onChange={(e) => setCostPrice(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className={lbl}>Allocation Method</Label>
          <select value={allocation} onChange={(e) => setAllocation(e.target.value as "Auto" | AllocationMethod)} className={selectCls}>
            <option value="Auto">Auto</option>
            <option value="FEFO">FEFO</option>
            <option value="FIFO">FIFO</option>
          </select>
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
    </div>
  );
}

function ItemCreate({ nextId, onSave }: { nextId: string; onSave: (row: ItemRow) => void }) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<string>(ITEM_TYPES[0]);
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [uom, setUom] = useState<string>(UOMS[0]);

  // Category / Sub Category are editable: users can add a new one inline via the
  // "+ Add new…" option. Options seed from the master list and grow per session.
  const [categoryOptions, setCategoryOptions] = useState<string[]>([...CATEGORIES]);
  const [subCategoryOptions, setSubCategoryOptions] = useState<string[]>([...SUB_CATEGORIES]);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [addingSubCategory, setAddingSubCategory] = useState(false);
  const [newSubCategory, setNewSubCategory] = useState("");

  const commitNewCategory = () => {
    const val = newCategory.trim();
    if (!val) { toast.error("Enter a category name."); return; }
    if (!categoryOptions.some((c) => c.toLowerCase() === val.toLowerCase())) {
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
    if (!subCategoryOptions.some((s) => s.toLowerCase() === val.toLowerCase())) {
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

  // Stock & storage
  const [reorderLevel, setReorderLevel] = useState("0");
  const [thresholdPct, setThresholdPct] = useState("20");
  const [expiryDate, setExpiryDate] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [binLocation, setBinLocation] = useState("");

  const warehouseOptions = useMemo(
    () => (officeId ? activeWarehousesByOffice(officeId) : []),
    [officeId],
  );

  const handleOfficeChange = (next: string) => {
    setOfficeId(next);
    // Drop the warehouse selection if it no longer belongs to the new office.
    if (warehouseId && !ALL_WAREHOUSES.some((w) => w.id === warehouseId && w.officeId === next)) {
      setWarehouseId("");
    }
  };
  // Allocation method: "Auto" lets the smart default kick in based on item type/category.
  const [allocationChoice, setAllocationChoice] = useState<"Auto" | AllocationMethod>("Auto");
  const [batchTrackedChoice, setBatchTrackedChoice] = useState<boolean>(true);

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
      reorderLevel: reorder,
      thresholdPct: threshold,
      expiryDate: expiryDate || undefined,
      officeId: officeId || undefined,
      warehouseId: warehouseId || undefined,
      binLocation: binLocation.trim() || undefined,
      allocationMethod: allocationChoice === "Auto" ? undefined : allocationChoice,
      batchTracked: batchTrackedChoice,
      altUoms: altUoms.length > 0 ? altUoms : undefined,
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
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Name <span className="text-destructive">*</span></Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Type</Label>
            <select value={itemType} onChange={(e) => setItemType(e.target.value)} className={selectCls}>
              {ITEM_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
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
              onChange={(e) => { e.target.value === ADD_NEW ? setAddingCategory(true) : setCategory(e.target.value); }}
              className={selectCls}
            >
              <option value="">Select category</option>
              {categoryOptions.map((c) => <option key={c}>{c}</option>)}
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
              className={selectCls}
            >
              <option value="">Select sub category</option>
              {subCategoryOptions.map((s) => <option key={s}>{s}</option>)}
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
            <select value={uom} onChange={(e) => setUom(e.target.value)} className={selectCls}>
              {UOMS.map((u) => <option key={u}>{u}</option>)}
            </select>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Stock is always kept in this unit. Add ALT UOMs below for transactions in other units.
            </div>
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
                  onChange={(e) => setAltDraftUom(e.target.value)}
                  className={selectCls}
                >
                  <option value="">Select alt UOM…</option>
                  {ALT_UOM_OPTIONS.filter(
                    (opt) =>
                      opt.toLowerCase() !== uom.toLowerCase() &&
                      !altUoms.some((a) => a.uom.toLowerCase() === opt.toLowerCase()),
                  ).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
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
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Reorder Level</Label>
            <Input type="number" min={0} value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Expiry Date</Label>
            <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="mt-1 tabular-nums" />
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
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Office</Label>
            <select
              value={officeId}
              onChange={(e) => handleOfficeChange(e.target.value)}
              className={selectCls}
            >
              <option value="">Select office…</option>
              {activeOffices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} — {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Warehouse</Label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              disabled={!officeId}
              className={selectCls}
            >
              <option value="">
                {officeId ? "Select warehouse…" : "Select office first"}
              </option>
              {warehouseOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2 -mt-1 text-[11px] text-muted-foreground">
            Default office + warehouse for this item. Used to group stock and prefill location pickers.
          </div>

          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Bin Location</Label>
            <Input
              value={binLocation}
              onChange={(e) => setBinLocation(e.target.value)}
              className="mt-1 font-mono"
              placeholder="e.g. A1-R3-S2  (aisle-rack-shelf)"
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              Bin/rack/shelf within the selected warehouse. Used as the picking location across Inventory, Airline Consumables, and FEFO/FIFO lookups.
            </div>
          </div>

          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Stock Tracking</Label>
            <div
              className="mt-1 inline-flex items-center rounded-md border border-input bg-background p-0.5 shadow-sm"
              role="group"
              aria-label="Stock tracking mode"
            >
              {([
                { label: "Batch-Tracked",  value: true  },
                { label: "Single Item",    value: false },
              ] as const).map((opt) => {
                const active = batchTrackedChoice === opt.value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setBatchTrackedChoice(opt.value)}
                    className={cn(
                      "px-3 py-1 text-xs font-semibold rounded-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Batch-Tracked</span> means each receipt creates a discrete batch lot with its own expiry and cost. FIFO/FEFO controls which lot is drained first.
              <br />
              <span className="font-semibold text-foreground">Single Item</span> means stock is one pooled bucket — no batch numbers, no expiry, no FIFO/FEFO. Use for shelf-stable hardware (tape, caps, labels, etc.).
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
                "mt-1 inline-flex items-center rounded-md border border-input bg-background p-0.5 shadow-sm",
                !batchTrackedChoice && "opacity-50 pointer-events-none",
              )}
              role="group"
              aria-label="Allocation method"
            >
              {(["Auto", "FEFO", "FIFO"] as const).map((m) => {
                const active = allocationChoice === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAllocationChoice(m)}
                    className={cn(
                      "px-3 py-1 text-xs font-semibold rounded-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Auto</span> picks FEFO for perishables (Protein, Dairy, Vegetable, Bakery, Meal, Beverage; Fresh/Frozen) and FIFO for shelf-stable goods (Packaging, Consumables, Dry).
              <br />
              <span className="font-semibold text-foreground">FEFO</span> drains the lot with the earliest expiry first; <span className="font-semibold text-foreground">FIFO</span> drains the earliest-received lot.
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
