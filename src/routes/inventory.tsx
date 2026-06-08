import { useNavigate } from "react-router-dom";
import { useState, useSyncExternalStore, useMemo } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Boxes, AlertTriangle, Eye, FileText, CalendarDays } from "lucide-react";
import { Select as AntSelect, Button as AntButton } from "antd";
import { AppstoreOutlined, TagsOutlined, CloseOutlined, ProfileOutlined } from "@ant-design/icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  inventory, inventoryValue, nearExpiryCount,
  getAllocationMethod,
  isBatchTrackedForInventory, findItemProfileFor,
  subscribeAllocationMethod, getAllocationVersion,
  type BatchLot, type AllocationMethod,
} from "@/lib/sample-data";
import { KpiCard } from "@/components/common/KpiCard";
import { getItemStockByWarehouse } from "@/lib/inventory-stock";
import { useRole } from "@/lib/roles";
import {
  LocationPicker, LocationFilter, LocationCell, officeName, warehouseName,
} from "@/components/common/LocationPicker";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useArrivalFlash } from "@/lib/arrival-flash";
import { useWorkflow } from "@/lib/workflow-store";
import { getStockAdjustments } from "@/lib/stock-adjustments";
import { getItemProfiles } from "@/lib/item-profiles";
import { buildItemLedger, itemMovementTotals, itemLedgerSummary, type LedgerSources, type LedgerRange, type RawMovement } from "@/lib/stock-ledger";
import { weightedAvg, poUnitPrice, blendedOutCost, movingAverage } from "@/lib/item-cost";

type BaseItem = (typeof inventory)[number];
type Item = BaseItem & {
  threshold?: number;
  lastEditedBy?: string;
  lastEditedDate?: string;
  lastEditedTime?: string;
  officeId?: string;
  warehouseId?: string;
  itemType?: string;
  subCategory?: string;
};

// Display item-code prefixes by item type. The internal `id` (INV-####) stays
// the join key for transfers/adjustments/GRNs/allocation; this only changes the
// human-facing Code shown in the report.
const CODE_PREFIX: Record<string, string> = {
  "Finished Good": "FG",
  "Semi-Finished Good": "SFG",
  "Raw Material": "RM",
  "Packaging": "PKG",
  "Consumable": "CON",
};
// Unprofiled kitchen-store items are raw materials in practice, so default to RM.
const codePrefixFor = (itemType?: string) => CODE_PREFIX[itemType ?? ""] ?? "RM";

const CATEGORIES = ["Grains", "Protein", "Beverage", "Dairy", "Vegetable", "Oil", "Misc"];
const UOM_OPTIONS = ["Kg", "Litre", "Bottle", "Unit", "Pcs", "Box", "Pack"];
const STORAGE_OPTIONS = ["Dry", "Cold", "Frozen"];

// Sort helper for filter option lists.
const sortStr = (a: string, b: string) => a.localeCompare(b);

function computeStatus(
  stock: number,
  reorder: number,
  thresholdPct = 20,
): "OK" | "Low" | "Critical" {
  if (stock < reorder) return "Critical";
  if (stock < reorder * (1 + thresholdPct / 100)) return "Low";
  return "OK";
}

type FormState = {
  name: string;
  category: string;
  uom: string;
  stock: string;
  reorder: string;
  threshold: string;
  batch: string;
  expiry: string;
  storage: string;
  officeId: string;
  warehouseId: string;
};

const emptyForm: FormState = {
  name: "",
  category: "Grains",
  uom: "Kg",
  stock: "",
  reorder: "",
  threshold: "20",
  batch: "",
  expiry: "",
  storage: "Dry",
  officeId: "OFF-001",
  warehouseId: "WH-001",
};

const SELECT_CLS = "w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm";

export default function Inventory() {
  useArrivalFlash();
  // Re-render when any item's FIFO/FEFO method is toggled.
  useSyncExternalStore(subscribeAllocationMethod, getAllocationVersion, getAllocationVersion);
  const { role } = useRole();
  const navigate = useNavigate();
  // Backfill existing inventory rows with default Office + Central Warehouse
  const [items, setItems] = usePersistedState<Item[]>("inventory-items", () =>
    inventory.map((i) => {
      const profile = findItemProfileFor(i);
      return {
        ...i,
        officeId: "OFF-001",
        warehouseId: "WH-001",
        itemType: profile?.itemType ?? "",
        // Prefer the Item Profile's category/sub-category (authoritative taxonomy).
        category: profile?.category ?? i.category,
        subCategory: profile?.subCategory ?? "",
      };
    }),
  );
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const openBatches = (item: Item) => {
    setSelected(item);
    setBatchOpen(true);
  };

  // Stash a pre-filled line for the Purchase Requisition page, then navigate.
  // Suggested order qty tops up to 150% of reorder level. Suggested rate is the
  // most recently received batch's cost price (when available).
  const requestPR = (item: Item) => {
    const suggestedQty = Math.max(1, Math.ceil(item.reorder * 1.5) - item.stock);
    const recentBatch = [...item.batches].sort((a, b) =>
      b.receivedOn.localeCompare(a.receivedOn),
    )[0];
    const suggestedRate = recentBatch?.costPrice ?? 0;
    try {
      sessionStorage.setItem(
        "pr-prefill-from-inventory",
        JSON.stringify({
          itemName: item.name,
          uom: item.uom,
          qty: suggestedQty,
          rate: suggestedRate,
          priority: item.status === "Critical" ? "Urgent" : "Normal",
          justification:
            item.status === "Critical"
              ? `Critical stock replenishment for ${item.name} — current stock ${item.stock} ${item.uom} is below reorder level ${item.reorder} ${item.uom}.`
              : `Low stock replenishment for ${item.name} — top up to safe level.`,
          source: "Stock Overview",
          sourceItemId: item.id,
        }),
      );
    } catch {
      /* sessionStorage unavailable — fall through to navigation */
    }
    navigate("/purchase-requisition");
    toast.success(`Pre-filling Purchase Requisition for ${item.name}.`);
  };
  // Live link to the Item Profile master (config-item). Each Stock Overview row
  // takes its configured taxonomy (type / category / sub-category), UoM, storage
  // and cost from its profile, so editing the Item Profile flows through here.
  const profileByName = useMemo(() => {
    const m = new Map<string, ReturnType<typeof getItemProfiles>[number]>();
    for (const p of getItemProfiles()) m.set(p.name.toLowerCase(), p);
    return m;
  }, []);
  const profileFor = (i: Item) => profileByName.get(i.name.toLowerCase());
  const effType = (i: Item) => profileFor(i)?.itemType ?? i.itemType ?? "";
  const effCategory = (i: Item) => profileFor(i)?.category ?? i.category;
  const effSubCategory = (i: Item) => profileFor(i)?.subCategory ?? i.subCategory ?? "";
  const effUom = (i: Item) => profileFor(i)?.uom ?? i.uom;
  const effStorage = (i: Item) => profileFor(i)?.storage ?? i.storage;

  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSubCategory, setFilterSubCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // Cascading filter options, derived from each item's live Item Profile. Item
  // Type comes first; Category is scoped to the chosen type; Sub-category to
  // type + category.
  const typeOptions = Array.from(new Set(items.map(effType).filter(Boolean) as string[])).sort(sortStr);
  const categoryOptions = Array.from(new Set(
    items.filter((i) => !filterType || effType(i) === filterType).map(effCategory).filter(Boolean),
  )).sort(sortStr);
  const subCategoryOptions = Array.from(new Set(
    items
      .filter((i) => (!filterType || effType(i) === filterType) && (!filterCategory || effCategory(i) === filterCategory))
      .map(effSubCategory).filter(Boolean) as string[],
  )).sort(sortStr);

  const f = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const openNew = () => {
    setForm(emptyForm);
    setNewItemOpen(true);
  };

  const saveNew = () => {
    if (!form.name.trim()) { toast.error("Item name is required."); return; }
    if (!form.officeId) { toast.error("Office is required."); return; }
    if (!form.warehouseId) { toast.error("Warehouse is required."); return; }
    const stock = Number(form.stock) || 0;
    const reorder = Number(form.reorder) || 0;
    const threshold = Math.max(0, Number(form.threshold) || 20);
    const today = new Date().toISOString().slice(0, 10);
    const newItem: Item = {
      id: `INV-${String(Date.now()).slice(-4)}`,
      name: form.name.trim(),
      category: form.category,
      uom: form.uom,
      stock,
      reorder,
      threshold,
      batch: form.batch.trim() || "—",
      expiry: form.expiry || "—",
      storage: form.storage,
      status: computeStatus(stock, reorder, threshold),
      officeId: form.officeId,
      warehouseId: form.warehouseId,
      batches: stock > 0
        ? [{
            batchNo: form.batch.trim() || `${form.name.trim().slice(0, 2).toUpperCase()}-${String(Date.now()).slice(-4)}`,
            expiry: form.expiry || today,
            qty: stock,
            costPrice: 0,
            receivedOn: today,
          }]
        : [],
    };
    setItems((prev) => [newItem, ...prev]);
    setNewItemOpen(false);
    toast.success(`${newItem.name} added to inventory.`);
  };

  const openEdit = (item: Item) => {
    setSelected(item);
    setForm({
      name: item.name,
      category: item.category,
      uom: item.uom,
      stock: String(item.stock),
      reorder: String(item.reorder),
      threshold: String(item.threshold ?? 20),
      batch: item.batch,
      expiry: item.expiry === "—" ? "" : item.expiry,
      storage: item.storage,
      officeId: item.officeId ?? "OFF-001",
      warehouseId: item.warehouseId ?? "WH-001",
    });
    setEditOpen(true);
  };

  const saveEdit = () => {
    if (!selected) return;
    if (!form.name.trim()) { toast.error("Item name is required."); return; }
    const stock = Number(form.stock) || 0;
    const reorder = Number(form.reorder) || 0;
    const threshold = Math.max(0, Number(form.threshold) || 20);
    const now = new Date();
    const date = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
    setItems((prev) =>
      prev.map((i) =>
        i.id === selected.id
          ? {
              ...i,
              name: form.name.trim(),
              category: form.category,
              uom: form.uom,
              stock,
              reorder,
              threshold,
              batch: form.batch.trim() || "—",
              expiry: form.expiry || "—",
              storage: form.storage,
              status: computeStatus(stock, reorder, threshold),
              officeId: form.officeId,
              warehouseId: form.warehouseId,
              lastEditedBy: role,
              lastEditedDate: date,
              lastEditedTime: time,
            }
          : i,
      ),
    );
    setEditOpen(false);
    toast.success(`${form.name.trim()} updated successfully.`);
  };

  const openView = (item: Item) => {
    setSelected(item);
    setViewOpen(true);
  };

  const lowStockCount = items.filter((i) => i.status === "Low").length;
  const criticalCount = items.filter((i) => i.status === "Critical").length;
  const okCount = items.filter((i) => i.status === "OK").length;

  // Unified stock-movement ledger. Every flow that touches an item feeds the
  // In/Out columns and the per-item "Item Details" drill-down:
  //   • Purchases   → accepted GRN lines        (workflow-store grns)
  //   • Transfers   → issues out of the store   (workflow-store transferNotes)
  //   • Adjustments → approved stock corrections (persisted stock-adjustments)
  //   • Production / Dispatch → finished meals   (workflow-store stockDeltas)
  const { stockDeltas, grns, transferNotes, wfPurchaseOrders } = useWorkflow();
  const ledgerSources: LedgerSources = useMemo(
    () => ({ grns, transferNotes, stockDeltas, adjustments: getStockAdjustments() }),
    [grns, transferNotes, stockDeltas],
  );
  const movementFor = (r: Item) => itemMovementTotals(r.id, r.name, ledgerSources);
  // Optional date window applied to the In/Out/Opening/Closing columns and the
  // Item Details ledger modal.
  const dateRange: LedgerRange | undefined =
    filterDateFrom || filterDateTo
      ? { from: filterDateFrom || undefined, to: filterDateTo || undefined }
      : undefined;

  // Type-based display codes (FG-001, SFG-001, RM-001…). Numbered per type over
  // the full item set (sorted by id) so the sequence is stable regardless of the
  // active filter/search. Internal `id` is unchanged.
  const codeByItemId = useMemo(() => {
    const counters: Record<string, number> = {};
    const map = new Map<string, string>();
    for (const it of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
      const prefix = codePrefixFor(effType(it));
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      map.set(it.id, `${prefix}-${String(counters[prefix]).padStart(3, "0")}`);
    }
    return map;
  }, [items]);
  const displayCode = (it: Item) => codeByItemId.get(it.id) ?? it.id;

  // Item Details ledger modal.
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerItem, setLedgerItem] = useState<Item | null>(null);
  const openLedger = (item: Item) => { setLedgerItem(item); setLedgerOpen(true); };

  // Most recent batch cost (fallback when an item has no weighted-average basis).
  const recentBatchCost = (item: Item) =>
    [...item.batches].sort((a, b) => b.receivedOn.localeCompare(a.receivedOn))[0]?.costPrice ?? 0;
  // Item's current total stock across warehouses (mirrors the Stock cell).
  const totalStockFor = (item: Item) =>
    item.stock + getItemStockByWarehouse(item.name).slice(1).reduce((s, w) => s + w.stock, 0);

  // Opening / In / Out / Closing for a row, scoped to the active date window.
  const ledgerSummaryFor = (r: Item) =>
    itemLedgerSummary(r.id, r.name, totalStockFor(r), ledgerSources, dateRange);

  /**
   * Per-item costing context for the ledger. Batch items cost issues by FIFO/
   * FEFO drawdown (`blendedOutCost`); single items by moving weighted-average
   * (`wac`). Purchases price at their PO line rate. Returns the opening-row cost,
   * a per-movement cost resolver, and the closing valuation.
   */
  const costContextFor = (item: Item) => {
    const isBatch = isBatchTrackedForInventory(item.id);
    const avg = weightedAvg(item.batches.map((b) => ({ qty: b.qty, costPrice: b.costPrice })));
    const baseCost = avg > 0 ? avg : recentBatchCost(item);
    const closing = totalStockFor(item);

    const purchases = grns.flatMap((g) =>
      g.lines
        .filter((l) => l.qcStatus === "Accepted" &&
          (l.itemId === item.id || l.name.toLowerCase() === item.name.toLowerCase()))
        .map((l) => ({ qty: l.qty, rate: poUnitPrice(g.poRef, item.id, item.name, wfPurchaseOrders) ?? baseCost })),
    );
    const totals = itemMovementTotals(item.id, item.name, ledgerSources);
    const openingQty = closing - totals.inQty + totals.outQty;
    const wac = movingAverage(openingQty, baseCost, purchases);

    const unitCostFor = (m: RawMovement): number => {
      if (m.type === "Purchase (GRN)") return poUnitPrice(m.reference, item.id, item.name, wfPurchaseOrders) ?? baseCost;
      if (m.outQty > 0) return isBatch ? blendedOutCost(item.id, m.outQty, baseCost) : wac;
      return isBatch ? baseCost : wac; // production / adjustment-increase IN
    };
    const openingCost = isBatch ? baseCost : wac;
    const closingCost = isBatch ? baseCost : wac;
    return { unitCostFor, openingCost, closing, closingCost, closingValue: closing * closingCost };
  };

  const cols: Column<Item>[] = [
    { key: "id", header: "Code", render: (r) => <span className="font-mono text-xs">{displayCode(r)}</span> },
    { key: "name", header: "Item" },
    {
      key: "officeId" as keyof Item, header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    { key: "category", header: "Category", render: (r) => effCategory(r) },
    { key: "uom", header: "UOM", render: (r) => effUom(r) },
    {
      key: "stock", header: "Stock",
      render: (r) => <StockCell item={r} onClick={() => openBatches(r)} />,
    },
    {
      key: "id" as keyof Item, header: "Opening Qty",
      render: (r) => {
        const { opening } = ledgerSummaryFor(r);
        return <span className="tabular-nums font-medium">{opening.toLocaleString()}</span>;
      },
    },
    {
      key: "id" as keyof Item, header: "In Qty",
      render: (r) => {
        const { inQty } = ledgerSummaryFor(r);
        if (inQty === 0) return <span className="text-muted-foreground tabular-nums">—</span>;
        return <span className="tabular-nums font-medium text-emerald-700">+{inQty.toLocaleString()}</span>;
      },
    },
    {
      key: "id" as keyof Item, header: "Out Qty",
      render: (r) => {
        const { outQty } = ledgerSummaryFor(r);
        if (outQty === 0) return <span className="text-muted-foreground tabular-nums">—</span>;
        return <span className="tabular-nums font-medium text-rose-700">−{outQty.toLocaleString()}</span>;
      },
    },
    {
      key: "id" as keyof Item, header: "Closing Qty",
      render: (r) => {
        const { closing } = ledgerSummaryFor(r);
        return (
          <button
            type="button"
            onClick={() => openLedger(r)}
            className="group inline-flex items-center text-left rounded-sm px-1 py-0.5 -mx-1 hover:bg-sky-50 transition-colors"
            title="Click to see the transaction ledger"
          >
            <span className="tabular-nums font-semibold text-sky-700 underline decoration-dotted decoration-sky-300 underline-offset-2 group-hover:decoration-sky-500">
              {closing.toLocaleString()}
            </span>
          </button>
        );
      },
    },
    { key: "reorder", header: "Reorder Lvl" },
    {
      key: "id" as keyof Item,
      header: "Method",
      render: (r) => <MethodBadge inventoryId={r.id} />,
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  const filteredItems = items.filter((i) => {
    if (filterOffice && i.officeId !== filterOffice) return false;
    if (filterWarehouse && i.warehouseId !== filterWarehouse) return false;
    if (filterType && effType(i) !== filterType) return false;
    if (filterCategory && effCategory(i) !== filterCategory) return false;
    if (filterSubCategory && effSubCategory(i) !== filterSubCategory) return false;
    if (filterStatus && i.status !== filterStatus) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        title="Stock Overview"
        subtitle="Kitchen store item master — batch tracking, reorder levels and storage status"
      />

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Total Items" value={1248} icon={Boxes} tone="navy" />
        <KpiCard label="Low Stock" value={lowStockCount} icon={AlertTriangle} tone="warning" />
        <KpiCard label="Critical" value={criticalCount} icon={AlertTriangle} tone="red" />
        <KpiCard
          label="Near Expiry (30d)"
          value={nearExpiryCount(items, 30)}
          icon={AlertTriangle}
          tone="warning"
        />
        <div data-arrival-id="inv-value">
          <KpiCard
            label="Stock Value"
            value={`৳ ${Math.round(inventoryValue(items)).toLocaleString()}`}
            sub="on-hand valuation"
            icon={Boxes}
            tone="success"
          />
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <LocationFilter
          officeId={filterOffice}
          warehouseId={filterWarehouse}
          onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
        />
        <div className="inline-flex items-center gap-1.5 bg-card border border-border rounded-lg px-2 py-1 shadow-sm">
          <ProfileOutlined style={{ color: "var(--color-muted-foreground)", fontSize: 12 }} />
          <span className="field-label">Item Type</span>
          <AntSelect
            value={filterType || ""}
            onChange={(next: string) => { setFilterType(next); setFilterCategory(""); setFilterSubCategory(""); }}
            size="small"
            variant="borderless"
            style={{ minWidth: 150 }}
            options={[{ value: "", label: "All" }, ...typeOptions.map((t) => ({ value: t, label: t }))]}
          />
        </div>
        <div className="inline-flex items-center gap-1.5 bg-card border border-border rounded-lg px-2 py-1 shadow-sm">
          <AppstoreOutlined style={{ color: "var(--color-muted-foreground)", fontSize: 12 }} />
          <span className="field-label">Category</span>
          <AntSelect
            value={filterCategory || ""}
            onChange={(next: string) => { setFilterCategory(next); setFilterSubCategory(""); }}
            size="small"
            variant="borderless"
            disabled={categoryOptions.length === 0}
            style={{ minWidth: 130 }}
            options={[{ value: "", label: "All" }, ...categoryOptions.map((c) => ({ value: c, label: c }))]}
          />
        </div>
        <div className="inline-flex items-center gap-1.5 bg-card border border-border rounded-lg px-2 py-1 shadow-sm">
          <TagsOutlined style={{ color: "var(--color-muted-foreground)", fontSize: 12 }} />
          <span className="field-label">Sub-category</span>
          <AntSelect
            value={filterSubCategory || ""}
            onChange={(next: string) => setFilterSubCategory(next)}
            size="small"
            variant="borderless"
            disabled={subCategoryOptions.length === 0}
            style={{ minWidth: 150 }}
            options={[
              { value: "", label: subCategoryOptions.length === 0 ? "—" : "All" },
              ...subCategoryOptions.map((s) => ({ value: s, label: s })),
            ]}
          />
        </div>
        {/* Status filter — All / OK / Low / Critical. */}
        <div className="inline-flex items-center gap-1.5 bg-card border border-border rounded-lg px-2 py-1 shadow-sm">
          <AlertTriangle className="h-3 w-3 text-muted-foreground" />
          <span className="field-label">Status</span>
          <AntSelect
            value={filterStatus || ""}
            onChange={(next: string) => setFilterStatus(next)}
            size="small"
            variant="borderless"
            style={{ minWidth: 110 }}
            options={[
              { value: "", label: "All" },
              { value: "OK", label: `OK (${okCount})` },
              { value: "Low", label: `Low (${lowStockCount})` },
              { value: "Critical", label: `Critical (${criticalCount})` },
            ]}
          />
        </div>
        {/* Date range — scopes the In/Out/Opening/Closing columns + ledger modal. */}
        <div className="inline-flex items-center gap-1.5 bg-card border border-border rounded-lg px-2 py-1 shadow-sm">
          <CalendarDays className="h-3 w-3 text-muted-foreground" />
          <span className="field-label">Period</span>
          <Input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="h-7 w-[8.5rem] border-0 shadow-none px-1 text-xs tabular-nums focus-visible:ring-0"
            aria-label="From date"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="h-7 w-[8.5rem] border-0 shadow-none px-1 text-xs tabular-nums focus-visible:ring-0"
            aria-label="To date"
          />
        </div>
        {(filterType || filterCategory || filterSubCategory || filterDateFrom || filterDateTo) && (
          <AntButton
            size="small"
            type="text"
            icon={<CloseOutlined />}
            onClick={() => { setFilterType(""); setFilterCategory(""); setFilterSubCategory(""); setFilterDateFrom(""); setFilterDateTo(""); }}
            style={{ color: "var(--color-muted-foreground)" }}
          >
            Clear
          </AntButton>
        )}
      </div>

      <div data-arrival-id="inv-alerts">
      <DataTable
        title="inventory"
        data={filteredItems}
        columns={cols}
        searchKeys={["name", "category", "status"]}
        selectable={false}
        actions={(row) => (
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => openView(row)}
              aria-label={`View ${row.name}`}
              title="View"
            >
              <Eye className="h-4 w-4" />
            </Button>
            {(row.status === "Low" || row.status === "Critical") && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-warning-foreground hover:text-warning-foreground hover:bg-warning/15"
                onClick={() => requestPR(row)}
                aria-label={`Raise purchase requisition for ${row.name}`}
                title="Raise Purchase Requisition"
              >
                <FileText className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      />
      </div>

      {/* New Item Dialog */}
      <Dialog open={newItemOpen} onOpenChange={setNewItemOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Inventory Item</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Item Name *</Label>
              <Input value={form.name} onChange={(e) => f("name", e.target.value)} placeholder="e.g. Chicken Breast" className="mt-1" />
            </div>
            <div>
              <Label>Category</Label>
              <select value={form.category} onChange={(e) => f("category", e.target.value)} className={SELECT_CLS}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label>UOM</Label>
              <select value={form.uom} onChange={(e) => f("uom", e.target.value)} className={SELECT_CLS}>
                {UOM_OPTIONS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <Label>Current Stock</Label>
              <Input type="number" min={0} value={form.stock} onChange={(e) => f("stock", e.target.value)} placeholder="0" className="mt-1" />
            </div>
            <div>
              <Label>Reorder Level</Label>
              <Input type="number" min={0} value={form.reorder} onChange={(e) => f("reorder", e.target.value)} placeholder="0" className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Stock Threshold (%)</Label>
              <Input type="number" min={0} max={200} value={form.threshold} onChange={(e) => f("threshold", e.target.value)} placeholder="20" className="mt-1" />
              <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed bg-muted/60 rounded px-2.5 py-1.5">
                Sets the buffer above the Reorder Level that triggers <span className="font-semibold text-amber-600">Low</span> status.
                Stock below Reorder Level = <span className="font-semibold text-red-600">Critical</span>.
                Stock below Reorder Level × (1 + Threshold%) = <span className="font-semibold text-amber-600">Low</span>.
                <br />
                <span className="text-muted-foreground/80">Example: Reorder = 100, Threshold = 20% → Low when stock &lt; 120, Critical when stock &lt; 100.</span>
              </p>
            </div>
            <div>
              <Label>Batch No.</Label>
              <Input value={form.batch} onChange={(e) => f("batch", e.target.value)} placeholder="e.g. BR-2406" className="mt-1" />
            </div>
            <div>
              <Label>Expiry Date</Label>
              <Input type="date" value={form.expiry} onChange={(e) => f("expiry", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Storage</Label>
              <select value={form.storage} onChange={(e) => f("storage", e.target.value)} className={SELECT_CLS}>
                {STORAGE_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <LocationPicker
              officeId={form.officeId}
              warehouseId={form.warehouseId}
              onChange={(n) => setForm((p) => ({ ...p, officeId: n.officeId, warehouseId: n.warehouseId }))}
            />
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setNewItemOpen(false)}>Cancel</Button>
            <Button onClick={saveNew}>Add Item</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Item — {selected?.id}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Item Name *</Label>
              <Input value={form.name} onChange={(e) => f("name", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Category</Label>
              <select value={form.category} onChange={(e) => f("category", e.target.value)} className={SELECT_CLS}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label>UOM</Label>
              <select value={form.uom} onChange={(e) => f("uom", e.target.value)} className={SELECT_CLS}>
                {UOM_OPTIONS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <Label>Current Stock</Label>
              <Input type="number" min={0} value={form.stock} onChange={(e) => f("stock", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Reorder Level</Label>
              <Input type="number" min={0} value={form.reorder} onChange={(e) => f("reorder", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Batch No.</Label>
              <Input value={form.batch} onChange={(e) => f("batch", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Expiry Date</Label>
              <Input type="date" value={form.expiry} onChange={(e) => f("expiry", e.target.value)} className="mt-1" />
            </div>
            <LocationPicker
              officeId={form.officeId}
              warehouseId={form.warehouseId}
              onChange={(n) => setForm((p) => ({ ...p, officeId: n.officeId, warehouseId: n.warehouseId }))}
            />

            {selected?.lastEditedBy && (
              <div className="col-span-2 border-t pt-3">
                <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  Last edited by{" "}
                  <span className="font-medium text-foreground">{selected.lastEditedBy}</span>
                  {" "}on {selected.lastEditedDate} at {selected.lastEditedTime}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="text-sm space-y-4">
              <div>
                {(
                  [
                    ["Code", displayCode(selected)],
                    ["Item Type", effType(selected) || "—"],
                    ["Category", effCategory(selected)],
                    ["Sub-category", effSubCategory(selected) || "—"],
                    ["UOM", effUom(selected)],
                    ["Current Stock", String(selected.stock)],
                    ["Reorder Level", String(selected.reorder)],
                    ["Storage", effStorage(selected)],
                    ["Status", selected.status],
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between py-1.5 border-b border-border/50 last:border-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">{value}</span>
                  </div>
                ))}
              </div>

              {isBatchTrackedForInventory(selected.id) ? (
                <FefoBatchLadder
                  batches={selected.batches}
                  uom={selected.uom}
                  method={getAllocationMethod(selected.id)}
                />
              ) : (
                <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                  <div className="font-semibold text-foreground mb-0.5">Single Item Stock</div>
                  This item is not batch-tracked. Stock is held as one pooled bucket of{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {selected.stock.toLocaleString()} {selected.uom}
                  </span>{" "}
                  — no batch numbers, no expiry, no FIFO/FEFO ordering.
                </div>
              )}

              {selected.lastEditedBy && (
                <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  Last edited by{" "}
                  <span className="font-medium text-foreground">{selected.lastEditedBy}</span>
                  {" "}on {selected.lastEditedDate} at {selected.lastEditedTime}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOpen(false)}>Close</Button>
            <Button onClick={() => { setViewOpen(false); if (selected) openEdit(selected); }}>Edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Item Details — full transaction ledger, opens from In/Out Qty cells */}
      <Dialog open={ledgerOpen} onOpenChange={setLedgerOpen}>
        <DialogContent className="max-w-6xl w-[96vw] max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Item Details</DialogTitle>
          </DialogHeader>
          {ledgerItem && (() => {
            const cost = costContextFor(ledgerItem);
            const ledger = buildItemLedger(
              ledgerItem.id, ledgerItem.name,
              cost.closing, cost.openingCost, cost.unitCostFor,
              ledgerSources,
              { officeId: ledgerItem.officeId, warehouseId: ledgerItem.warehouseId },
              dateRange,
            );
            // Column totals INCLUDE the opening-balance row so they foot to the
            // closing balance: (Total In) − (Total Out) = Closing Balance.
            const colIn = ledger.rows.reduce((s, r) => s + r.inQty, 0);
            const colOut = ledger.rows.reduce((s, r) => s + r.outQty, 0);
            const fmtMoney = (n: number) =>
              n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return (
              <div className="text-sm space-y-4">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-1">
                  <span><span className="font-semibold">Item Code :</span> <span className="font-mono">{displayCode(ledgerItem)}</span></span>
                  <span><span className="font-semibold">Item Name :</span> {ledgerItem.name}</span>
                  <span><span className="font-semibold">Uom :</span> {ledgerItem.uom}</span>
                </div>

                <div className="border border-border rounded-md overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-sky-50 text-slate-700 border-b border-border">
                      <tr>
                        <th className="px-2.5 py-2 text-left font-semibold">Date</th>
                        <th className="px-2.5 py-2 text-left font-semibold">Reference</th>
                        <th className="px-2.5 py-2 text-left font-semibold">Office</th>
                        <th className="px-2.5 py-2 text-left font-semibold">Warehouse</th>
                        <th className="px-2.5 py-2 text-left font-semibold whitespace-nowrap">Transaction Type</th>
                        <th className="px-2.5 py-2 text-right font-semibold whitespace-nowrap">In Qty</th>
                        <th className="px-2.5 py-2 text-right font-semibold whitespace-nowrap">Out Qty</th>
                        <th className="px-2.5 py-2 text-right font-semibold whitespace-nowrap">Unit Cost</th>
                        <th className="px-2.5 py-2 text-right font-semibold whitespace-nowrap">Balance ( QTY )</th>
                        <th className="px-2.5 py-2 text-right font-semibold whitespace-nowrap">Value ( ৳ )</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.rows.map((row, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-2.5 py-2 tabular-nums whitespace-nowrap">{row.date}</td>
                          <td className="px-2.5 py-2 whitespace-nowrap">{row.reference}</td>
                          <td className="px-2.5 py-2 whitespace-nowrap text-muted-foreground">
                            {row.officeId ? officeName(row.officeId) : ""}
                          </td>
                          <td className="px-2.5 py-2 whitespace-nowrap text-muted-foreground">
                            {row.warehouseId ? warehouseName(row.warehouseId) : ""}
                          </td>
                          <td className="px-2.5 py-2 whitespace-nowrap">{row.type}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums text-emerald-700">
                            {row.inQty ? row.inQty.toLocaleString() : "0.00"}
                          </td>
                          <td className="px-2.5 py-2 text-right tabular-nums text-rose-700">
                            {row.outQty ? `-${row.outQty.toLocaleString()}` : "0.00"}
                          </td>
                          <td className="px-2.5 py-2 text-right tabular-nums text-muted-foreground">
                            {fmtMoney(row.unitCost)}
                          </td>
                          <td className="px-2.5 py-2 text-right tabular-nums font-medium whitespace-nowrap">
                            {row.balance.toLocaleString()}
                          </td>
                          <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">
                            {fmtMoney(row.value)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-muted/40 font-semibold border-t border-border">
                        <td className="px-2.5 py-2 text-right" colSpan={5}>
                          <span className="uppercase text-[10px] tracking-wider">Total</span>
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums text-emerald-700">
                          {colIn.toLocaleString()}
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums text-rose-700">
                          {colOut ? `-${colOut.toLocaleString()}` : "0.00"}
                        </td>
                        <td className="px-2.5 py-2 text-right uppercase text-[10px] tracking-wider whitespace-nowrap">Closing Balance</td>
                        <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">{ledger.closing.toLocaleString()}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">{fmtMoney(ledger.closing * cost.closingCost)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLedgerOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Dialog — opens when the Stock cell is clicked */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selected?.name}
              <span className="ml-2 font-mono text-xs text-muted-foreground font-normal">{selected?.id}</span>
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm pb-3 border-b border-border">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Stock</div>
                  <div className={cn(
                    "text-lg font-bold tabular-nums mt-0.5",
                    selected.stock < selected.reorder && "text-destructive",
                  )}>
                    {selected.stock.toLocaleString()} {selected.uom}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Reorder Level</div>
                  <div className="text-sm mt-0.5 tabular-nums">{selected.reorder.toLocaleString()} {selected.uom}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
                  <div className="mt-0.5"><StatusBadge status={selected.status} /></div>
                </div>
              </div>

              {isBatchTrackedForInventory(selected.id) ? (
                <FefoBatchLadder
                  batches={selected.batches}
                  uom={selected.uom}
                  method={getAllocationMethod(selected.id)}
                />
              ) : (
                <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                  <div className="font-semibold text-foreground mb-0.5">Single Item Stock</div>
                  This item is not batch-tracked. Stock is held as one pooled bucket of{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {selected.stock.toLocaleString()} {selected.uom}
                  </span>{" "}
                  — no batch numbers, no expiry, no FIFO/FEFO ordering.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Stock cell — shows the total qty as a clickable button that opens the batch
 * popup. For batch-tracked items the small caption summarises how many lots
 * are held; for Single Items it shows a quiet "single" marker.
 */
function StockCell({ item, onClick }: { item: Item; onClick: () => void }) {
  const batched = isBatchTrackedForInventory(item.id);
  const lots = batched ? item.batches.filter((b) => b.qty > 0).length : 0;

  // Actual stock = this item summed across every warehouse it's held in. The
  // primary-warehouse figure is the live `item.stock`; any other warehouses'
  // holdings come from the aggregation helper.
  const others = getItemStockByWarehouse(item.name).slice(1); // beyond primary
  const total = item.stock + others.reduce((s, w) => s + w.stock, 0);
  const low = total < item.reorder;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex flex-col items-start text-left rounded-sm px-1 py-0.5 -mx-1 hover:bg-primary/5 transition-colors"
      title={batched
        ? `Click to see ${lots} batch lot${lots === 1 ? "" : "s"}`
        : "Single-item stock — click for details"}
    >
      <span className={cn(
        "tabular-nums font-semibold underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 group-hover:decoration-primary",
        low && "text-destructive",
      )}>
        {total.toLocaleString()}
      </span>
      <span className="text-[10px] text-muted-foreground -mt-0.5">
        {batched ? `${lots} lot${lots === 1 ? "" : "s"}` : "single"}
      </span>
    </button>
  );
}

// Read-only allocation method (configured on the Item Profile). Shows the
// active FEFO/FIFO, or N/A for single (non-batch) items.
function MethodBadge({ inventoryId }: { inventoryId: string }) {
  const batched = isBatchTrackedForInventory(inventoryId);
  if (!batched) {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border border-border bg-muted/40 text-muted-foreground"
        title="Single-item — FIFO/FEFO does not apply."
      >
        N/A
      </span>
    );
  }
  const method = getAllocationMethod(inventoryId);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border border-primary/30 bg-primary/10 text-primary"
      title={method === "FEFO" ? "First-Expiry-First-Out" : "First-In-First-Out"}
    >
      {method}
    </span>
  );
}

function FefoBatchLadder({
  batches, uom, method,
}: { batches: BatchLot[]; uom: string; method: AllocationMethod }) {
  if (!batches || batches.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
        No batch lots recorded for this item.
      </div>
    );
  }
  const sorted = [...batches].sort((a, b) =>
    method === "FIFO"
      ? a.receivedOn.localeCompare(b.receivedOn)
      : a.expiry.localeCompare(b.expiry),
  );
  const today = new Date().toISOString().slice(0, 10);
  const cutoff30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const totalQty = sorted.reduce((s, b) => s + b.qty, 0);
  const totalValue = sorted.reduce((s, b) => s + b.qty * b.costPrice, 0);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-foreground flex items-center gap-2">
          Batch Ladder
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 border border-primary/30 text-primary">{method}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {method === "FIFO"
            ? "Oldest receipt drained first"
            : "Earliest expiry drained first"}
          {" · "}{sorted.length} lot{sorted.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-2 py-1.5 font-semibold w-8">#</th>
              <th className="text-left px-2 py-1.5 font-semibold">Batch</th>
              <th className="text-left px-2 py-1.5 font-semibold">Received</th>
              <th className="text-left px-2 py-1.5 font-semibold">Expiry</th>
              <th className="text-right px-2 py-1.5 font-semibold">Qty</th>
              <th className="text-right px-2 py-1.5 font-semibold">Cost / {uom}</th>
              <th className="text-right px-2 py-1.5 font-semibold">Line Value</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((b, i) => {
              const expired = b.expiry < today;
              const near = !expired && b.expiry <= cutoff30;
              return (
                <tr
                  key={b.batchNo}
                  className={
                    expired
                      ? "bg-destructive/5"
                      : near
                      ? "bg-warning/5"
                      : "hover:bg-muted/20"
                  }
                >
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">{b.batchNo}</td>
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{b.receivedOn}</td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {b.expiry}
                    {expired && (
                      <span className="ml-1 text-[10px] text-destructive font-semibold">EXPIRED</span>
                    )}
                    {near && (
                      <span className="ml-1 text-[10px] text-warning font-semibold">NEAR</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                    {b.qty.toLocaleString()} {uom}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    ৳ {b.costPrice.toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                    ৳ {(b.qty * b.costPrice).toLocaleString()}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-muted/30 font-semibold">
              <td colSpan={4} className="px-2 py-1.5 text-right uppercase text-[10px] tracking-wider">Total</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{totalQty.toLocaleString()} {uom}</td>
              <td />
              <td className="px-2 py-1.5 text-right tabular-nums">৳ {totalValue.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
