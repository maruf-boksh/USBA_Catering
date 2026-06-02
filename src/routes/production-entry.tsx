import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Plus, Plane, Users, Clock, Flame, Save, Trash2, UtensilsCrossed, ArrowRight, ArrowLeft, MoreHorizontal, Eye, Pencil, Printer, Calculator, Package, PackageOpen, Wrench, CheckCircle2, AlertCircle, FileText, Send, Zap } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  billOfMaterials, inventory, warehouses as ALL_WAREHOUSES,
  isDomesticSector, itemsByType, allocateFefo,
  type FlightOrderRow, type MealSlot, type ItemMaster,
} from "@/lib/sample-data";
import { useFlightOrders, updateFlightOrdersWhere } from "@/lib/flight-orders-store";
import { useMealSlots, resolveMealSlot, formatSlotRange } from "@/lib/meal-slot-settings";
import { Fragment } from "react";
import { useArrivalFlash } from "@/lib/arrival-flash";
import {
  useWorkflow,
  type WfProductionEntry,
  type WfMrpRun, type WfMrpMaterial,
  type WfDemandItem,
  type WfDemandRequest,
} from "@/lib/workflow-store";
import { LocationPicker, LocationFilter, LocationCell } from "@/components/common/LocationPicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DAYS,
  gmOrderSummary,
  mealCards,
  type FlightType,
  type MealCard,
} from "@/lib/meal-planning-data";

// Aggregates derived from the live flight-orders store — computed inside the
// page via `useForwardedOrders()` so that approving/advancing an order on the
// Order Management page (or anywhere else) flows through here in real time.
function buildForwardedOrders(orders: FlightOrderRow[]): { date: string; totalMeals: number }[] {
  const byDate = new Map<string, number>();
  for (const o of orders) {
    // Only count orders that haven't been pushed past Production yet — once an
    // order is Dispatched or Completed it has left the production pipeline.
    if (o.status === "Dispatched" || o.status === "Completed") continue;
    byDate.set(o.date, (byDate.get(o.date) ?? 0) + o.pax + o.crew + o.specialMeals);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totalMeals]) => ({ date, totalMeals }));
}

const DOMESTIC_AIRPORTS = new Set(["DAC", "CXB", "CGP", "ZYL", "JSR"]);

function getFlightTypeFromSector(sector: string): FlightType {
  const parts = sector.split("→");
  const dest = parts[parts.length - 1]?.trim();
  return dest && DOMESTIC_AIRPORTS.has(dest) ? "Domestic" : "International";
}

function getDayFromDate(dateStr: string): (typeof DAYS)[number] {
  const d = new Date(dateStr);
  const idx = d.getDay() === 0 ? 6 : d.getDay() - 1;
  return DAYS[idx];
}

type OrderRequirement = {
  day: (typeof DAYS)[number];
  flightType: FlightType;
  flights: number;
  passengers: number;
  crew: number;
  specialMeals: number;
  orders: FlightOrderRow[];
};

/**
 * Compute the production quantity for a meal-plan item, given the day's flight
 * orders. A Choice item gets `audience × choice%`. A Special item gets the
 * special-meals total directly. Audience depends on `forType` — Passengers,
 * Crew, or both.
 */
function computeMealQty({
  requirements, day, flightTypes, forType, kind, percentage,
}: {
  requirements: OrderRequirement[];
  day: string;
  flightTypes: string[];   // meal.flightType
  forType: string;          // "Passengers" | "Crew" | "Both" | ...
  kind: "Choice" | "Special";
  percentage?: number;      // 0-100 for choices
}): { qty: number; breakdown: string } {
  const matching = requirements.filter(
    (r) => r.day === day && flightTypes.includes(r.flightType),
  );
  if (matching.length === 0) return { qty: 0, breakdown: "No matching flight orders" };

  const pax = matching.reduce((s, r) => s + r.passengers, 0);
  const crew = matching.reduce((s, r) => s + r.crew, 0);
  const spec = matching.reduce((s, r) => s + r.specialMeals, 0);

  if (kind === "Special") {
    return {
      qty: spec,
      breakdown: `${spec} special meal${spec === 1 ? "" : "s"} on ${day} · ${flightTypes.join(" / ")}`,
    };
  }

  const ft = forType.toLowerCase();
  let audience = 0;
  let audienceLabel = "";
  if (ft.includes("passenger") && ft.includes("crew")) {
    audience = pax + crew;
    audienceLabel = `${pax} pax + ${crew} crew = ${audience}`;
  } else if (ft.includes("crew")) {
    audience = crew;
    audienceLabel = `${crew} crew`;
  } else {
    audience = pax;
    audienceLabel = `${pax} pax`;
  }
  const pct = percentage ?? 100;
  const qty = Math.round((audience * pct) / 100);
  return {
    qty,
    breakdown: `${audienceLabel} × ${pct}% = ${qty} (${day} · ${flightTypes.join(" / ")})`,
  };
}

function computeOrderRequirements(orders: FlightOrderRow[]): OrderRequirement[] {
  const map = new Map<string, OrderRequirement>();
  for (const o of orders) {
    const day = getDayFromDate(o.date);
    const flightType = getFlightTypeFromSector(o.sector);
    const key = `${day}|${flightType}`;
    if (!map.has(key)) {
      map.set(key, {
        day, flightType, flights: 0, passengers: 0, crew: 0, specialMeals: 0, orders: [],
      });
    }
    const r = map.get(key)!;
    r.flights += 1;
    r.passengers += o.pax;
    r.crew += o.crew;
    r.specialMeals += o.specialMeals;
    r.orders.push(o);
  }
  return Array.from(map.values()).sort((a, b) => {
    const dayDiff = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
    if (dayDiff !== 0) return dayDiff;
    return a.flightType.localeCompare(b.flightType);
  });
}



const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

type ProductionEntry = WfProductionEntry;

// The Production Order status is fully event-driven — no manual transitions
// in this menu. Lifecycle, for reference:
//   Pending          → user creates the order
//   Approved         → Approval Management approves it
//   In Preparation   → first partial Production Entry is logged (auto)
//   Ready for QC     → cumulative Production Entries reach orderQty (auto)
//   Completed        → QC sign-off in Cooking Temp & Sensory
function ProductionEntryRowMenu({ entry }: { entry: WfProductionEntry }) {
  const stageHint =
    entry.status === "Pending"      ? "Approval handled in Approval Management"
    : entry.status === "Approved"   ? "Will move to In Preparation once any Production Entry is logged"
    : entry.status === "In Preparation" ? "Will move to Ready for QC once orderQty is fully produced"
    : entry.status === "Ready for QC"   ? "QC sign-off in Cooking Temp & Sensory"
    : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={() => toast.info(`Viewing ${entry.id}`)}>
          <Eye className="h-4 w-4 mr-2" /> View
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => toast.info(`Editing ${entry.id}`)}>
          <Pencil className="h-4 w-4 mr-2" /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" /> Print
        </DropdownMenuItem>

        {stageHint && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Workflow
            </DropdownMenuLabel>
            <DropdownMenuItem disabled className="text-[11px]">
              <span className="text-muted-foreground">{stageHint}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function ProductionEntryPage() {
  useArrivalFlash();
  const {
    productionEntries, addProductionEntry, mrpRuns,
    demands, addDemands, addMrpRun,
  } = useWorkflow();
  const flightOrders = useFlightOrders();
  const forwardedOrders = useMemo(() => buildForwardedOrders(flightOrders), [flightOrders]);
  const totalMealsFromOrders = useMemo(
    () => flightOrders.reduce(
      (sum, o) => (o.status === "Dispatched" || o.status === "Completed")
        ? sum
        : sum + o.pax + o.crew + o.specialMeals,
      0,
    ),
    [flightOrders],
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedForwardedDate, setSelectedForwardedDate] = useState(
    forwardedOrders[0]?.date ?? "",
  );
  // Keep the selected date valid as orders advance — if the previously selected
  // date no longer has any production-pending demand, pick the earliest one.
  useEffect(() => {
    if (!forwardedOrders.some((f) => f.date === selectedForwardedDate)) {
      setSelectedForwardedDate(forwardedOrders[0]?.date ?? "");
    }
  }, [forwardedOrders, selectedForwardedDate]);
  const [view, setView] = useState<"list" | "create">("list");
  const [pendingItem, setPendingItem] = useState<OutputLine | undefined>(undefined);
  const [createKey, setCreateKey] = useState(0);
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const entries = productionEntries.filter((e) => {
    if (filterOffice && e.officeId !== filterOffice) return false;
    if (filterWarehouse && e.warehouseId !== filterWarehouse) return false;
    return true;
  });

  const addEntry = (entry: ProductionEntry) => {
    addProductionEntry(entry);
    // Connection: posting a production order auto-advances every flight order
    // for that same date from the production pipeline (Approved / Production)
    // into Dispatched, so they appear on the Dispatch page automatically.
    const advanced = updateFlightOrdersWhere(
      (o) => o.date === entry.date && (o.status === "Approved" || o.status === "Production"),
      { status: "Dispatched" },
    );
    if (advanced > 0) {
      toast.success(`${advanced} flight order leg${advanced === 1 ? "" : "s"} for ${entry.date} forwarded to Dispatch.`);
    }
    setView("list");
    setPendingItem(undefined);
  };

  const startFromMealPlan = (item: MealPlanPickItem) => {
    const qty = item.computedQty ?? 0;
    const line: OutputLine = {
      id: `OL-MP-${Date.now()}`,
      itemCode: item.code,
      itemName: item.name,
      qty,
      source: "meal-plan",
      mealMeta: {
        day: item.day,
        mealType: item.mealType,
        flightType: item.flightType,
        forType: item.forType,
        kind: item.kind,
      },
    };
    setPendingItem(line);
    setCreateKey((k) => k + 1);
    setDetailsOpen(false);
    setView("create");
    if (qty > 0) {
      toast.success(`"${item.name}" — order qty pre-filled at ${qty.toLocaleString()} pcs (${item.qtyBreakdown ?? "auto"}).`);
    } else {
      toast.success(`"${item.name}" selected — enter order quantity to auto-load materials.`);
    }
  };

  /**
   * For the given production orders, compute the consolidated material need
   * (raw + packaging + other), then raise ONE Demand Request bundling every
   * material plus a traceability MRP run. The DR is created in `Pending
   * Approval` status with `autoFulfill: true` — the matching Transfer Note
   * (in-stock items) and Purchase Requisition (shortfalls) are deferred until
   * the demand is approved on the Demand Orders page.
   *
   * Lineage:  Production Orders -> MRP run -> Demand Request -> (on approve)
   *                                                              { Issue + PR }
   */
  const autoFulfillOrders = (orders: ProductionEntry[]): {
    dr?: WfDemandRequest; mrpRun?: WfMrpRun;
    skippedNoRecipe: number;
  } => {
    // Aggregate materials needed across the orders. Only orders whose
    // outputItem maps to a recipe in PRODUCTION_ITEMS contribute materials —
    // meal-plan items without a recipe are silently skipped here (the order
    // itself was already raised by the caller).
    const lines: OutputLine[] = [];
    let skipped = 0;
    for (const o of orders) {
      const target = o.orderQty ?? 0;
      if (target <= 0) continue;
      const recipe = PRODUCTION_ITEMS.find(
        (p) => p.name === o.outputItemName || p.name === o.bom || p.code === o.outputItemCode,
      );
      if (!recipe) { skipped++; continue; }
      lines.push({
        id: o.id, itemCode: recipe.code, itemName: recipe.name,
        qty: target, source: "bom",
      });
    }
    if (lines.length === 0) return { skippedNoRecipe: skipped };

    const mats = aggregateMaterials(lines);
    type SplitRow = AggregatedMaterial & {
      bucket: "Raw" | "Packaging" | "Other"; onHand: number; shortfall: number;
    };
    const tagged: SplitRow[] = [
      ...mats.raw.map((m) => ({ ...m, bucket: "Raw" as const })),
      ...mats.pkg.map((m) => ({ ...m, bucket: "Packaging" as const })),
      ...mats.other.map((m) => ({ ...m, bucket: "Other" as const })),
    ].map((m) => {
      const onHand = getMrpOnHand(m.itemName);
      return { ...m, onHand, shortfall: Math.max(0, m.reqQty - onHand) };
    });
    if (tagged.length === 0) return { skippedNoRecipe: skipped };

    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

    // ── 1) Demand Request bundles EVERY material (Pending Approval) ----------
    const drSeq = String(9000 + demands.length + 1).padStart(4, "0");
    const drId = `DR-${drSeq}`;
    const dr: WfDemandRequest = {
      id: drId,
      reference: orders.map((o) => o.id).join(", "),
      requestedBy: "Auto (Meal Plan)",
      role: "Flight Kitchen Executive",
      date: stamp,
      status: "Pending Approval",
      items: tagged.map<WfDemandItem>((s) => {
        // Prefer the inventory id when the material exists in stock master, so
        // downstream pages (Item Issue, Transfer) that look up items by id can
        // resolve the row. Falls back to the recipe code otherwise — those
        // become shortfalls and travel through the PR flow.
        const invRow = inventory.find((i) => i.name.toLowerCase() === s.itemName.toLowerCase());
        return {
          id: invRow?.id ?? s.itemCode,
          name: s.itemName,
          qty: Math.round(s.reqQty * 1000) / 1000,
          uom: s.uom,
          type: s.bucket,
        };
      }),
      note: `Auto-generated from bulk meal-plan creation. Covers ${orders.length} production order${orders.length === 1 ? "" : "s"} (${lines.length} with recipes). On approval, an Issue + PR will be auto-created from current stock levels.`,
      source: "Kitchen",
      officeId: "OFF-001",
      warehouseId: "WH-003",
      autoFulfill: true,
    };
    addDemands([dr]);

    // ── 2) MRP run for traceability -----------------------------------------
    const enriched: WfMrpMaterial[] = tagged.map((s) => ({
      itemCode: s.itemCode, itemName: s.itemName, uom: s.uom, bucket: s.bucket,
      reqQty: s.reqQty, onHand: s.onHand, shortfall: s.shortfall,
      rate: s.rate, totalCost: s.reqQty * s.rate,
      supplier: s.shortfall > 0 ? resolveMrpSupplier(s.itemName) : undefined,
    }));
    const mrpRun: WfMrpRun = {
      id: `MRP-2026-${String(mrpRuns.length + 1).padStart(3, "0")}`,
      date: stamp,
      runBy: "Auto (Meal Plan)",
      basis: "remaining",
      orderIds: orders.map((o) => o.id),
      totalUnits: orders.reduce((sum, o) => sum + (o.orderQty ?? 0), 0),
      totalCost: enriched.reduce((sum, m) => sum + m.totalCost, 0),
      materials: enriched,
      requisitionIds: [],   // populated by approveDemand in /approval-management
      transferIds: [],      // populated by approveDemand in /approval-management
      demandRef: drId,
    };
    addMrpRun(mrpRun);

    return { dr, mrpRun, skippedNoRecipe: skipped };
  };

  /**
   * One-click bulk: create a Pending production order for every meal-plan item
   * that has a non-zero computed qty, then auto-run MRP and raise one Demand
   * Request + one Transfer Note + one Purchase Requisition off the back of it.
   */
  const bulkCreateFromMealPlan = (items: MealPlanPickItem[]) => {
    const eligible = items.filter((it) => (it.computedQty ?? 0) > 0);
    if (eligible.length === 0) {
      toast.warning("No menu items have a computed quantity > 0 for the selected day.");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const baseStamp = Date.now();
    const created: ProductionEntry[] = [];
    eligible.forEach((item, i) => {
      const qty = item.computedQty ?? 0;
      const seq = String(baseStamp + i).slice(-6);
      const bomMatch = billOfMaterials.find((b) => b.name === item.name);
      const entry: ProductionEntry = {
        id: `PRO-2026-${seq}`,
        date: today,
        bom: bomMatch?.name ?? item.name,
        outputItemName: item.name,
        outputItemCode: item.code,
        orderQty: qty,
        producedQty: 0,
        status: "Pending",
        officeId: "OFF-001",
        warehouseId: "WH-003",
      };
      addProductionEntry(entry);
      created.push(entry);
    });

    const { dr, mrpRun, skippedNoRecipe } = autoFulfillOrders(created);

    const parts: string[] = [
      `${created.length} Production Order${created.length === 1 ? "" : "s"}`,
    ];
    if (mrpRun) parts.push(`MRP ${mrpRun.id}`);
    if (dr) parts.push(`Demand ${dr.id} (pending approval)`);

    if (dr) {
      toast.success(
        `Created: ${parts.join(" · ")}. Approve the demand in Demand Orders to auto-issue stock and raise the PR for shortfalls.`,
        { duration: 8000 },
      );
    } else if (skippedNoRecipe === created.length) {
      toast.success(
        `Created ${created.length} production order${created.length === 1 ? "" : "s"}. No materials computed — these meal items don't have a recipe in the BOM master, so no Demand Request was raised.`,
        { duration: 7000 },
      );
    } else {
      toast.success(parts.join(" · "), { duration: 6000 });
    }
    setDetailsOpen(false);
  };

  type NumberedEntry = ProductionEntry & { __sl: number };
  const numberedEntries: NumberedEntry[] = entries.map((e, i) => ({ ...e, __sl: i + 1 }));

  const cols: Column<NumberedEntry>[] = [
    {
      key: "__sl",
      header: "SL",
      sortable: false,
      className: "w-12 text-center",
      render: (r) => <span className="tabular-nums">{r.__sl}</span>,
    },
    { key: "id",         header: "Order No" },
    { key: "date",       header: "Date" },
    {
      key: "officeId" as keyof NumberedEntry, header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    { key: "bom",        header: "BOM" },
    {
      key: "outputItemName",
      header: "Production Item",
      render: (r) => (
        <span>
          {r.outputItemName ? (
            <>
              {r.outputItemCode && (
                <span className="font-mono text-xs text-muted-foreground mr-1">{r.outputItemCode}</span>
              )}
              {r.outputItemName}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      ),
    },
    {
      key: "orderQty" as keyof NumberedEntry,
      header: "Order Qty",
      className: "text-right",
      render: (r) => (
        <span className="tabular-nums">{(r.orderQty ?? r.producedQty).toLocaleString()}</span>
      ),
    },
    {
      key: "producedQty",
      header: "Produced Qty",
      className: "text-right",
      render: (r) => (
        <span className="tabular-nums">{r.producedQty.toLocaleString()}</span>
      ),
    },
    {
      key: "id" as keyof NumberedEntry,
      header: "Remaining Qty",
      className: "text-right",
      render: (r) => {
        const order = r.orderQty ?? r.producedQty;
        const remaining = Math.max(0, order - r.producedQty);
        return (
          <span className={`tabular-nums ${remaining > 0 ? "text-warning font-medium" : "text-success"}`}>
            {remaining.toLocaleString()}
          </span>
        );
      },
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Production Order"
        subtitle="Record and manage production orders"
        actions={
          <Button onClick={() => setView(view === "create" ? "list" : "create")}>
            {view === "create" ? (
              <>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-1" /> Create Order
              </>
            )}
          </Button>
        }
      />

      {view === "list" ? (
        <>
          <div className="mb-6 rounded-lg border border-success/30 bg-success/10 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-success">
                  Forwarded from Order Management
                </div>
                <div className="mt-1 text-sm text-foreground">
                  <span className="font-bold">{forwardedOrders.length}</span>{" "}
                  date{forwardedOrders.length === 1 ? "" : "s"} pending ·{" "}
                  <span className="font-bold text-success">
                    {totalMealsFromOrders.toLocaleString()}
                  </span>{" "}
                  meals
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedForwardedDate}
                  onChange={(e) => setSelectedForwardedDate(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {forwardedOrders.map((f) => (
                    <option key={f.date} value={f.date}>
                      {f.date} — {f.totalMeals.toLocaleString()} meals
                    </option>
                  ))}
                </select>
                <Button
                  className="bg-success text-success-foreground hover:bg-success/90"
                  onClick={() => setDetailsOpen(true)}
                >
                  View Details
                </Button>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <LocationFilter
              officeId={filterOffice}
              warehouseId={filterWarehouse}
              onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
            />
          </div>
          <div data-arrival-id="production-list">
            <DataTable
              title="production-entries"
              data={numberedEntries}
              columns={cols}
              searchKeys={["id", "bom", "outputItemName", "status"]}
              selectable={false}
              actions={(r) => <ProductionEntryRowMenu entry={r} />}
            />
          </div>
        </>
      ) : (
        <ProductionEntryCreate key={createKey} initialItem={pendingItem} onSave={addEntry} />
      )}

      <MealPlanningDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        onSelectItem={startFromMealPlan}
        onBulkCreate={bulkCreateFromMealPlan}
        date={selectedForwardedDate}
      />
    </>
  );
}

export type RecipeItem = {
  itemCode: string;
  itemName: string;
  uom: string;
  qtyPerUnit: number;
  rate: number;
};

export type ProductionItem = {
  code: string;
  name: string;
  rawMaterials: RecipeItem[];
  packagingMaterials: RecipeItem[];
  otherConsumption: RecipeItem[];
};

export const PRODUCTION_ITEMS: ProductionItem[] = [
  {
    code: "FG-001",
    name: "Chicken Biryani",
    rawMaterials: [
      { itemCode: "RM-001", itemName: "Basmati Rice",    uom: "Kg",    qtyPerUnit: 0.180, rate: 120 },
      { itemCode: "RM-002", itemName: "Chicken",         uom: "Kg",    qtyPerUnit: 0.120, rate: 280 },
      { itemCode: "RM-003", itemName: "Onion",           uom: "Kg",    qtyPerUnit: 0.040, rate: 60  },
      { itemCode: "RM-004", itemName: "Spice Mix",       uom: "Kg",    qtyPerUnit: 0.010, rate: 850 },
      { itemCode: "RM-005", itemName: "Cooking Oil",     uom: "Litre", qtyPerUnit: 0.020, rate: 175 },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.050, rate: 85 },
      { itemCode: "OC-002", itemName: "Disposable Glove", uom: "Pair", qtyPerUnit: 0.10, rate: 4  },
    ],
  },
  {
    code: "FG-002",
    name: "Veg Pulao",
    rawMaterials: [
      { itemCode: "RM-001", itemName: "Basmati Rice",    uom: "Kg",    qtyPerUnit: 0.180, rate: 120 },
      { itemCode: "RM-006", itemName: "Mixed Vegetable", uom: "Kg",    qtyPerUnit: 0.100, rate: 70  },
      { itemCode: "RM-005", itemName: "Cooking Oil",     uom: "Litre", qtyPerUnit: 0.020, rate: 175 },
      { itemCode: "RM-004", itemName: "Spice Mix",       uom: "Kg",    qtyPerUnit: 0.008, rate: 850 },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.040, rate: 85 },
    ],
  },
  {
    code: "FG-003",
    name: "Continental Breakfast",
    rawMaterials: [
      { itemCode: "RM-007", itemName: "Bread Loaf",      uom: "Pcs", qtyPerUnit: 0.25, rate: 30  },
      { itemCode: "RM-008", itemName: "Egg",             uom: "Pcs", qtyPerUnit: 1.0,  rate: 11  },
      { itemCode: "RM-009", itemName: "Butter",          uom: "Kg",  qtyPerUnit: 0.015, rate: 950 },
      { itemCode: "RM-010", itemName: "Sausage",         uom: "Pcs", qtyPerUnit: 2.0,  rate: 22  },
    ],
    packagingMaterials: [
      { itemCode: "PKG-003", itemName: "Breakfast Box",  uom: "Pcs", qtyPerUnit: 1, rate: 18 },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.025, rate: 85 },
    ],
  },
  {
    code: "FG-004",
    name: "Grilled Salmon",
    rawMaterials: [
      { itemCode: "RM-011", itemName: "Salmon Fillet",   uom: "Kg",    qtyPerUnit: 0.140, rate: 1400 },
      { itemCode: "RM-012", itemName: "Lemon",           uom: "Pcs",   qtyPerUnit: 0.25,  rate: 8    },
      { itemCode: "RM-005", itemName: "Cooking Oil",     uom: "Litre", qtyPerUnit: 0.015, rate: 175  },
      { itemCode: "RM-004", itemName: "Spice Mix",       uom: "Kg",    qtyPerUnit: 0.008, rate: 850  },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.035, rate: 85 },
    ],
  },

  // ── Meal-plan items (Wednesday Breakfast menu) ───────────────────────────
  // Recipes for the menu items raised by the bulk "Create All Orders" flow on
  // the Meal Planning Details dialog, so MRP can compute on-hand vs shortfall
  // and the resulting Demand Request actually carries materials.
  {
    code: "FG-PRT",
    name: "Paratha",
    rawMaterials: [
      { itemCode: "RM-013", itemName: "Wheat Flour",     uom: "Kg",    qtyPerUnit: 0.060, rate: 88  },
      { itemCode: "RM-005", itemName: "Cooking Oil",     uom: "Litre", qtyPerUnit: 0.012, rate: 175 },
      { itemCode: "RM-017", itemName: "Salt",            uom: "Kg",    qtyPerUnit: 0.001, rate: 35  },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.015, rate: 85 },
    ],
  },
  {
    code: "FG-CHM",
    name: "Channa Masala",
    rawMaterials: [
      { itemCode: "RM-014", itemName: "Chickpeas",       uom: "Kg",    qtyPerUnit: 0.060, rate: 110 },
      { itemCode: "RM-003", itemName: "Onion",           uom: "Kg",    qtyPerUnit: 0.025, rate: 60  },
      { itemCode: "RM-015", itemName: "Tomato",          uom: "Kg",    qtyPerUnit: 0.030, rate: 58  },
      { itemCode: "RM-005", itemName: "Cooking Oil",     uom: "Litre", qtyPerUnit: 0.012, rate: 175 },
      { itemCode: "RM-004", itemName: "Spice Mix",       uom: "Kg",    qtyPerUnit: 0.004, rate: 850 },
      { itemCode: "RM-017", itemName: "Salt",            uom: "Kg",    qtyPerUnit: 0.001, rate: 35  },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.020, rate: 85 },
    ],
  },
  {
    code: "FG-BEG",
    name: "Boiled Egg",
    rawMaterials: [
      { itemCode: "RM-008", itemName: "Egg",             uom: "Pcs", qtyPerUnit: 1,     rate: 11 },
      { itemCode: "RM-017", itemName: "Salt",            uom: "Kg",  qtyPerUnit: 0.001, rate: 35 },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.010, rate: 85 },
    ],
  },
  {
    code: "FG-VSW",
    name: "Vegetable Sandwich",
    rawMaterials: [
      { itemCode: "RM-007", itemName: "Bread Loaf",      uom: "Pcs", qtyPerUnit: 0.40,  rate: 30  },
      { itemCode: "RM-006", itemName: "Mixed Vegetable", uom: "Kg",  qtyPerUnit: 0.045, rate: 70  },
      { itemCode: "RM-009", itemName: "Butter",          uom: "Kg",  qtyPerUnit: 0.010, rate: 950 },
      { itemCode: "RM-017", itemName: "Salt",            uom: "Kg",  qtyPerUnit: 0.0005,rate: 35  },
    ],
    packagingMaterials: [
      { itemCode: "PKG-003", itemName: "Breakfast Box",  uom: "Pcs", qtyPerUnit: 1, rate: 18 },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.005, rate: 85 },
    ],
  },
  {
    code: "FG-FRS",
    name: "Fruit Salad",
    rawMaterials: [
      { itemCode: "RM-016", itemName: "Mixed Fruits",    uom: "Kg",  qtyPerUnit: 0.080, rate: 120 },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-002", itemName: "Disposable Glove",uom: "Pair", qtyPerUnit: 0.05, rate: 4 },
    ],
  },
];

type OutputLine = {
  id: string;
  itemCode: string;
  itemName: string;
  qty: number;
  source?: "bom" | "meal-plan";
  mealMeta?: { day: string; mealType: string; flightType: string; forType: string; kind: "Choice" | "Special" };
};

type MealPlanPickItem = {
  code: string;
  name: string;
  day: string;
  mealType: string;
  flightType: string;
  forType: string;
  kind: "Choice" | "Special";
  weight: number;
  calories: number;
  /** Computed production qty derived from flight orders + choice allocation. */
  computedQty?: number;
  /** Short human-readable explanation of how computedQty was derived. */
  qtyBreakdown?: string;
};

function slugifyItem(name: string) {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

function extractMealPlanItems(): MealPlanPickItem[] {
  const map = new Map<string, MealPlanPickItem>();
  for (const meal of mealCards) {
    const ftLabel = meal.flightType.join(" / ");
    for (const ch of meal.choices) {
      for (const it of ch.items) {
        const code = `MP-${slugifyItem(it.name)}`;
        if (!map.has(code)) {
          map.set(code, {
            code,
            name: it.name,
            day: meal.day,
            mealType: meal.mealType,
            flightType: ftLabel,
            forType: meal.forType,
            kind: "Choice",
            weight: it.weight,
            calories: it.calories,
          });
        }
      }
    }
    for (const sp of meal.specialMeals) {
      if (!sp.enabled) continue;
      for (const it of sp.items) {
        const code = `MP-${slugifyItem(it.name)}`;
        if (!map.has(code)) {
          map.set(code, {
            code,
            name: it.name,
            day: meal.day,
            mealType: meal.mealType,
            flightType: ftLabel,
            forType: meal.forType,
            kind: "Special",
            weight: it.weight,
            calories: it.calories,
          });
        }
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const d = DAYS.indexOf(a.day as (typeof DAYS)[number]) - DAYS.indexOf(b.day as (typeof DAYS)[number]);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  });
}

const MEAL_PLAN_ITEMS = extractMealPlanItems();

type AggregatedMaterial = RecipeItem & { reqQty: number };

function aggregateMaterials(lines: OutputLine[]) {
  const raw = new Map<string, AggregatedMaterial>();
  const pkg = new Map<string, AggregatedMaterial>();
  const other = new Map<string, AggregatedMaterial>();

  const addTo = (bucket: Map<string, AggregatedMaterial>, recipe: RecipeItem, qty: number) => {
    const reqQty = recipe.qtyPerUnit * qty;
    const existing = bucket.get(recipe.itemCode);
    if (existing) existing.reqQty += reqQty;
    else bucket.set(recipe.itemCode, { ...recipe, reqQty });
  };

  for (const line of lines) {
    const item = PRODUCTION_ITEMS.find((p) => p.code === line.itemCode);
    if (!item) continue;
    item.rawMaterials.forEach((r) => addTo(raw, r, line.qty));
    item.packagingMaterials.forEach((r) => addTo(pkg, r, line.qty));
    item.otherConsumption.forEach((r) => addTo(other, r, line.qty));
  }
  return {
    raw: Array.from(raw.values()),
    pkg: Array.from(pkg.values()),
    other: Array.from(other.values()),
  };
}

type MaterialRow = {
  id: string;
  itemCode: string;
  itemName: string;
  uom: string;
  reqQty: number;
  rate: number;
  source: "bom" | "manual";
};

type MaterialBucket = "raw" | "pkg" | "other";

type DeletionLog = {
  bucket: MaterialBucket;
  itemCode: string;
  itemName: string;
  source: "bom" | "manual";
  remarks: string;
  removedAt: string;
};

const UOM_OPTIONS = ["Kg", "Gm", "Litre", "ML", "Pcs", "Pack", "Bottle", "Pair"];

const BUCKET_ITEM_TYPE: Record<MaterialBucket, ItemMaster["itemType"]> = {
  raw: "Raw Material",
  pkg: "Packaging",
  other: "Consumable",
};

function EditableMaterialSection({
  title, bucket, rows, onAdd, onDelete,
}: {
  title: string;
  bucket: MaterialBucket;
  rows: MaterialRow[];
  onAdd: (bucket: MaterialBucket, row: MaterialRow) => void;
  onDelete: (bucket: MaterialBucket, row: MaterialRow) => void;
}) {
  const itemOptions = useMemo(() => itemsByType(BUCKET_ITEM_TYPE[bucket]), [bucket]);

  const [itemName, setItemName] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [uom, setUom] = useState(UOM_OPTIONS[0]);
  const [qty, setQty] = useState("");

  const handleItemPick = (name: string) => {
    setItemName(name);
    const picked = itemOptions.find((i) => i.name === name);
    if (!picked) { setItemCode(""); return; }
    setItemCode(picked.code);
    if (UOM_OPTIONS.includes(picked.uom)) setUom(picked.uom);
  };

  const resetForm = () => {
    setItemName(""); setItemCode(""); setQty("");
    setUom(UOM_OPTIONS[0]);
  };

  const handleAdd = () => {
    if (!itemName.trim()) { toast.error("Select an item to add."); return; }
    const q = Number(qty);
    if (!q || q <= 0) { toast.error("Required quantity must be greater than zero."); return; }
    const duplicate = rows.find((row) => row.itemCode === itemCode || row.itemName === itemName.trim());
    if (duplicate) {
      toast.error(`${itemName} is already in ${title}.`);
      return;
    }
    const picked = itemOptions.find((i) => i.name === itemName.trim());
    onAdd(bucket, {
      id: `MN-${bucket}-${Date.now()}`,
      itemCode: itemCode || `CUSTOM-${Date.now()}`,
      itemName: itemName.trim(),
      uom,
      reqQty: q,
      rate: picked?.costPrice ?? 0,
      source: "manual",
    });
    resetForm();
  };

  // Match items to inventory by name so we can render FEFO lots.
  const fefoForItem = (name: string, reqQty: number) => {
    const inv = inventory.find((i) => i.name === name);
    if (!inv) return null;
    return allocateFefo(inv.id, reqQty);
  };

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end mb-3 px-1">
        <div className="md:col-span-6">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Item Name</Label>
          <select
            value={itemName}
            onChange={(e) => handleItemPick(e.target.value)}
            className={cn(selectCls, "mt-1")}
          >
            <option value="">Select an item…</option>
            {itemOptions.map((opt) => (
              <option key={opt.code} value={opt.name}>
                {opt.code} — {opt.name}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">UoM</Label>
          <select value={uom} onChange={(e) => setUom(e.target.value)} className={cn(selectCls, "mt-1")}>
            {UOM_OPTIONS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
        <div className="md:col-span-3">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Req. Qty</Label>
          <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 h-9 tabular-nums" />
        </div>
        <div className="md:col-span-1">
          <Button variant="outline" onClick={handleAdd} className="w-full h-9" aria-label={`Add to ${title}`}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-14 text-xs uppercase tracking-wider">SL</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Item Code</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Item Name</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">UoM</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Req. Qty</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Allocation Lots</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                  No materials yet — add one using the form above.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((m, i) => {
                const fefo = fefoForItem(m.itemName, m.reqQty);
                return (
                  <TableRow key={m.id}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{m.itemCode}</TableCell>
                    <TableCell className="font-medium">
                      <span>{m.itemName}</span>
                      {m.source === "manual" && (
                        <Badge variant="outline" className="ml-2 text-[9px] font-normal border-warning/40 bg-warning/10 text-warning-foreground">
                          Added
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{m.uom}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.reqQty.toFixed(3)}</TableCell>
                    <TableCell className="text-[11px]">
                      {fefo === null ? (
                        <span className="text-muted-foreground">Not in stock master</span>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="text-[9px] uppercase tracking-wider font-bold mb-0.5">
                            <span className="px-1.5 py-0.5 rounded bg-primary/10 border border-primary/30 text-primary">{fefo.method}</span>
                          </div>
                          {fefo.allocations.map((a) => (
                            <div key={a.batchNo} className="font-mono">
                              <span className="text-foreground">{a.batchNo}</span>
                              <span className="text-muted-foreground"> · {a.expiry} · </span>
                              <span className="font-semibold">{a.qty.toFixed(3)}</span>
                            </div>
                          ))}
                          {fefo.shortfall > 0 && (
                            <div className="text-destructive font-semibold">
                              Shortfall: {fefo.shortfall.toFixed(3)}
                            </div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => onDelete(bucket, m)}
                        aria-label={`Remove ${m.itemName}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DeleteMaterialDialog({
  open, onOpenChange, target, remarks, onRemarksChange, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: { bucket: MaterialBucket; row: MaterialRow } | null;
  remarks: string;
  onRemarksChange: (v: string) => void;
  onConfirm: () => void;
}) {
  const bucketLabel: Record<MaterialBucket, string> = {
    raw: "Raw Materials",
    pkg: "Packaging Materials",
    other: "Other Consumption",
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            Remove Material
          </DialogTitle>
        </DialogHeader>
        {target && (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <div className="font-medium text-foreground">{target.row.itemName}</div>
              <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                {target.row.itemCode} · {bucketLabel[target.bucket]} · {target.row.reqQty.toFixed(3)} {target.row.uom}
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Reason for removal <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={remarks}
                onChange={(e) => onRemarksChange(e.target.value)}
                placeholder="Why is this material being removed?"
                className="mt-1 min-h-[80px]"
                autoFocus
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductionEntryCreate({
  onSave, initialItem,
}: {
  onSave?: (entry: ProductionEntry) => void;
  initialItem?: OutputLine;
}) {
  // Production Information
  const today = new Date().toISOString().slice(0, 10);
  const [orderDate, setOrderDate] = useState(today);
  const [bomName, setBomName] = useState("");
  const [officeId, setOfficeId] = useState("OFF-001");
  const [warehouseId, setWarehouseId] = useState("WH-003"); // Hot Kitchen
  const [remarks, setRemarks] = useState(
    initialItem ? "Pre-filled from Meal Planning Details — Meal Plan tab." : "",
  );

  // Single Production Output Item (constraint: only one item per entry)
  const [outputItem, setOutputItem] = useState<OutputLine | null>(initialItem ?? null);
  const [itemQty, setItemQty] = useState<string>(initialItem ? String(initialItem.qty) : "");

  // Editing state for the materials list (per bucket).
  // BOM-loaded rows are computed; users can also add custom rows and remove
  // any row with a remark. `deletedBomCodes` hides BOM rows so that re-running
  // the BOM compute (e.g. on qty change) doesn't bring them back.
  const [manualRaw,   setManualRaw]   = useState<MaterialRow[]>([]);
  const [manualPkg,   setManualPkg]   = useState<MaterialRow[]>([]);
  const [manualOther, setManualOther] = useState<MaterialRow[]>([]);
  const [deletedBomCodes, setDeletedBomCodes] = useState<Map<string, string>>(new Map());
  const [deletionLog, setDeletionLog] = useState<DeletionLog[]>([]);
  const [pendingDelete, setPendingDelete] =
    useState<{ bucket: MaterialBucket; row: MaterialRow } | null>(null);
  const [deleteRemarks, setDeleteRemarks] = useState("");

  // Switching the BOM means a completely different recipe — wipe edits.
  useEffect(() => {
    setManualRaw([]);
    setManualPkg([]);
    setManualOther([]);
    setDeletedBomCodes(new Map());
    setDeletionLog([]);
  }, [bomName]);

  const bomMaterials = useMemo(() => {
    const qty = Number(itemQty);
    if (!bomName || !qty || qty <= 0) return { raw: [], pkg: [], other: [] };
    const recipe = PRODUCTION_ITEMS.find((p) => p.name === bomName);
    if (!recipe) return { raw: [], pkg: [], other: [] };
    return aggregateMaterials([
      { id: "current", itemCode: recipe.code, itemName: recipe.name, qty },
    ]);
  }, [bomName, itemQty]);

  const toMaterialRow = (m: AggregatedMaterial): MaterialRow => ({
    id: `BOM-${m.itemCode}`,
    itemCode: m.itemCode,
    itemName: m.itemName,
    uom: m.uom,
    reqQty: m.reqQty,
    rate: m.rate,
    source: "bom",
  });

  const rawRows = useMemo(
    () => [
      ...bomMaterials.raw.filter((m) => !deletedBomCodes.has(m.itemCode)).map(toMaterialRow),
      ...manualRaw,
    ],
    [bomMaterials.raw, deletedBomCodes, manualRaw],
  );
  const pkgRows = useMemo(
    () => [
      ...bomMaterials.pkg.filter((m) => !deletedBomCodes.has(m.itemCode)).map(toMaterialRow),
      ...manualPkg,
    ],
    [bomMaterials.pkg, deletedBomCodes, manualPkg],
  );
  const otherRows = useMemo(
    () => [
      ...bomMaterials.other.filter((m) => !deletedBomCodes.has(m.itemCode)).map(toMaterialRow),
      ...manualOther,
    ],
    [bomMaterials.other, deletedBomCodes, manualOther],
  );

  const addMaterial = (bucket: MaterialBucket, row: MaterialRow) => {
    const setter =
      bucket === "raw" ? setManualRaw :
      bucket === "pkg" ? setManualPkg :
      setManualOther;
    setter((prev) => [...prev, row]);
    toast.success(`Added "${row.itemName}" to materials.`);
  };

  const requestDelete = (bucket: MaterialBucket, row: MaterialRow) => {
    setPendingDelete({ bucket, row });
    setDeleteRemarks("");
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (!deleteRemarks.trim()) {
      toast.error("Please enter a reason for removing this material.");
      return;
    }
    const { bucket, row } = pendingDelete;
    if (row.source === "bom") {
      setDeletedBomCodes((prev) => {
        const next = new Map(prev);
        next.set(row.itemCode, deleteRemarks.trim());
        return next;
      });
    } else {
      const setter =
        bucket === "raw" ? setManualRaw :
        bucket === "pkg" ? setManualPkg :
        setManualOther;
      setter((prev) => prev.filter((m) => m.id !== row.id));
    }
    setDeletionLog((prev) => [
      ...prev,
      {
        bucket,
        itemCode: row.itemCode,
        itemName: row.itemName,
        source: row.source,
        remarks: deleteRemarks.trim(),
        removedAt: new Date().toISOString(),
      },
    ]);
    toast.success(`Removed "${row.itemName}".`);
    setPendingDelete(null);
    setDeleteRemarks("");
  };

  const selectBomItem = (code: string) => {
    if (!code) { setOutputItem(null); return; }
    const item = PRODUCTION_ITEMS.find((p) => p.code === code);
    if (!item) return;
    setOutputItem({
      id: "current",
      itemCode: item.code,
      itemName: item.name,
      qty: Number(itemQty) || 0,
      source: "bom",
    });
  };

  const clearOutputItem = () => {
    setOutputItem(null);
    setItemQty("");
  };

  const handleSave = () => {
    if (!bomName) { toast.error("Select a BOM."); return; }
    if (!outputItem) { toast.error("Select a production output item."); return; }
    if (!officeId) { toast.error("Office is required."); return; }
    if (!warehouseId) { toast.error("Warehouse is required."); return; }
    const qty = Number(itemQty);
    if (!qty || qty <= 0) { toast.error("Order quantity must be greater than zero."); return; }

    const nextSeq = String(Date.now()).slice(-6);
    const newEntry: ProductionEntry = {
      id: `PRO-2026-${nextSeq}`,
      date: orderDate,
      bom: bomName,
      outputItemName: outputItem.itemName,
      outputItemCode: outputItem.itemCode,
      orderQty: qty,
      producedQty: 0,
      status: "Pending",
      officeId,
      warehouseId,
    };

    toast.success(`Order ${newEntry.id} created — ${outputItem.itemName} × ${qty.toLocaleString()}.`);
    onSave?.(newEntry);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Production Information
            </h3>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-1.5" /> Save
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Order Date <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="mt-1"
              />
            </div>

            <LocationPicker
              officeId={officeId}
              warehouseId={warehouseId}
              onChange={(n) => { setOfficeId(n.officeId); setWarehouseId(n.warehouseId); }}
            />

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                BOM Name <span className="text-destructive">*</span>
              </Label>
              <select
                value={bomName}
                onChange={(e) => setBomName(e.target.value)}
                className={selectCls}
              >
                <option value="">BOM Name</option>
                {billOfMaterials.map((b) => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Remarks
              </Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Remarks"
                className="mt-1 min-h-[72px]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
                Production Output Item
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                One production item per entry. Materials auto-load when item and quantity are set.
              </p>
            </div>
            {outputItem?.source === "meal-plan" && (
              <Badge variant="outline" className="bg-success/10 text-success border-success/30 font-normal text-xs">
                <UtensilsCrossed className="h-3 w-3 mr-1" /> From Meal Plan
              </Badge>
            )}
          </div>

          {outputItem?.source === "meal-plan" ? (
            <div className="rounded-md border border-success/30 bg-success/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Selected Meal Item</div>
                  <div className="mt-1 text-base font-semibold text-foreground">{outputItem.itemName}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{outputItem.itemCode}</div>
                  {outputItem.mealMeta && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[10px] font-normal">{outputItem.mealMeta.day}</Badge>
                      <Badge variant="outline" className="text-[10px] font-normal">{outputItem.mealMeta.mealType}</Badge>
                      <Badge variant="outline" className="text-[10px] font-normal">{outputItem.mealMeta.flightType}</Badge>
                      <Badge variant="outline" className="text-[10px] font-normal">{outputItem.mealMeta.forType}</Badge>
                      {outputItem.mealMeta.kind === "Special" && (
                        <Badge variant="outline" className="text-[10px] font-normal bg-warning/15 text-warning-foreground border-warning/40">
                          Special
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={clearOutputItem}>
                  <Trash2 className="h-3.5 w-3.5 mr-1 text-destructive" /> Clear
                </Button>
              </div>

              <div className="mt-4 max-w-xs">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Order Quantity <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={itemQty}
                  onChange={(e) => setItemQty(e.target.value)}
                  placeholder="Quantity"
                  className="mt-1 tabular-nums"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-7">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Production Item <span className="text-destructive">*</span>
                </Label>
                <select
                  value={outputItem?.itemCode ?? ""}
                  onChange={(e) => selectBomItem(e.target.value)}
                  className={selectCls}
                >
                  <option value="">Select Production Item</option>
                  {PRODUCTION_ITEMS.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-4">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Order Quantity <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={itemQty}
                  onChange={(e) => setItemQty(e.target.value)}
                  placeholder="Quantity"
                  className="mt-1 tabular-nums"
                />
              </div>

              <div className="md:col-span-1">
                {outputItem && (
                  <Button variant="ghost" onClick={clearOutputItem} className="w-full" aria-label="Clear item">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Material Item Information
            </h3>
            <div className="flex items-center gap-2">
              {deletionLog.length > 0 && (
                <Badge variant="outline" className="bg-destructive/5 text-destructive border-destructive/30 font-normal text-[10px]">
                  {deletionLog.length} removed
                </Badge>
              )}
              {bomName && Number(itemQty) > 0 ? (
                <Badge variant="outline" className="bg-success/10 text-success border-success/30 font-normal text-[10px]">
                  Auto-loaded from BOM
                </Badge>
              ) : null}
            </div>
          </div>

          {!bomName ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              Select a BOM to auto-load the required materials.
            </div>
          ) : Number(itemQty) <= 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              Enter an order quantity to compute the required materials.
            </div>
          ) : (
            <div className="space-y-6">
              <EditableMaterialSection
                title="Raw Materials"
                bucket="raw"
                rows={rawRows}
                onAdd={addMaterial}
                onDelete={requestDelete}
              />
              <EditableMaterialSection
                title="Packaging Materials"
                bucket="pkg"
                rows={pkgRows}
                onAdd={addMaterial}
                onDelete={requestDelete}
              />
              <EditableMaterialSection
                title="Other Consumption"
                bucket="other"
                rows={otherRows}
                onAdd={addMaterial}
                onDelete={requestDelete}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <DeleteMaterialDialog
        open={pendingDelete !== null}
        onOpenChange={(v) => { if (!v) { setPendingDelete(null); setDeleteRemarks(""); } }}
        target={pendingDelete}
        remarks={deleteRemarks}
        onRemarksChange={setDeleteRemarks}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function MealCardView({
  meal, onSelect, requirements,
}: {
  meal: MealCard;
  onSelect: (payload: { code: string; computedQty: number; breakdown: string }) => void;
  requirements: OrderRequirement[];
}) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {meal.day}
            </div>
            <div className="mt-0.5 text-base font-bold text-foreground">{meal.mealType}</div>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {meal.servingTime.start} – {meal.servingTime.end}
              </span>
              <span className="inline-flex items-center gap-1">
                <Flame className="h-3 w-3" /> {meal.totalKcal} kcal
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {meal.flightType.map((ft) => (
              <Badge key={ft} variant="outline" className="text-[10px]">
                <Plane className="h-2.5 w-2.5 mr-1" /> {ft}
              </Badge>
            ))}
            <Badge variant="secondary" className="text-[10px]">
              <Users className="h-2.5 w-2.5 mr-1" /> {meal.forType}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {meal.choices.map((c) => (
            <div key={c.label} className="rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-primary">{c.label}</span>
                <span className="text-[11px] text-muted-foreground">{c.percentage}%</span>
              </div>
              <ul className="space-y-2">
                {c.items.map((item, i) => {
                  const code = `MP-${slugifyItem(item.name)}`;
                  const { qty, breakdown } = computeMealQty({
                    requirements,
                    day: meal.day,
                    flightTypes: meal.flightType,
                    forType: meal.forType,
                    kind: "Choice",
                    percentage: c.percentage,
                  });
                  return (
                    <li key={i} className="text-xs flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-foreground truncate">{item.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {item.weight}g · {item.calories} kcal
                          {qty > 0 && (
                            <>
                              {" · "}
                              <span className="text-primary font-medium tabular-nums">
                                {qty.toLocaleString()} pcs
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px] shrink-0"
                        onClick={() => onSelect({ code, computedQty: qty, breakdown })}
                        title={breakdown}
                      >
                        Select →
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {meal.specialMeals.filter((s) => s.enabled).length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Special Meals
            </div>
            <div className="space-y-2">
              {meal.specialMeals.filter((s) => s.enabled).map((s) => (
                <div key={s.type} className="rounded-md border border-border p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-foreground">{s.type}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {typeof s.portions === "number" ? `${s.portions} portions` : s.portions}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {s.items.map((item, i) => {
                      const code = `MP-${slugifyItem(item.name)}`;
                      // Special-meal portions can come from the meal-plan
                      // template; if it's a fixed number use that, otherwise
                      // fall back to the special-meals count from flight orders.
                      const explicitPortions = typeof s.portions === "number" ? s.portions : 0;
                      const computed = computeMealQty({
                        requirements,
                        day: meal.day,
                        flightTypes: meal.flightType,
                        forType: meal.forType,
                        kind: "Special",
                      });
                      const qty = explicitPortions > 0 ? explicitPortions : computed.qty;
                      const breakdown = explicitPortions > 0
                        ? `${explicitPortions} portion${explicitPortions === 1 ? "" : "s"} configured for ${s.type}`
                        : computed.breakdown;
                      return (
                        <li key={i} className="text-[11px] flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-foreground truncate">{item.name}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {item.weight}g · {item.calories} kcal
                              {qty > 0 && (
                                <>
                                  {" · "}
                                  <span className="text-primary font-medium tabular-nums">
                                    {qty.toLocaleString()} pcs
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px] shrink-0"
                            onClick={() => onSelect({ code, computedQty: qty, breakdown })}
                            title={breakdown}
                          >
                            Select →
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
          <span className="text-xs text-muted-foreground">Dessert</span>
          <span className="text-xs font-medium text-foreground">
            {meal.dessert.name}{" "}
            <span className="text-muted-foreground font-normal">
              ({meal.dessert.weight}g · {meal.dessert.calories} kcal)
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function MealPlanningDetailsDialog({
  open, onOpenChange, onSelectItem, onBulkCreate, date,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelectItem: (item: MealPlanPickItem) => void;
  onBulkCreate: (items: MealPlanPickItem[]) => void;
  date: string;
}) {
  const navigate = useNavigate();
  const flightOrders = useFlightOrders();
  const ordersForDate = useMemo(
    () => (date ? flightOrders.filter((o) => o.date === date) : flightOrders),
    [date, flightOrders],
  );
  const requirements = useMemo(() => computeOrderRequirements(ordersForDate), [ordersForDate]);
  const orderDays = useMemo(() => new Set(requirements.map((r) => r.day)), [requirements]);

  const itemByCode = useMemo(() => {
    const m = new Map<string, MealPlanPickItem>();
    for (const it of MEAL_PLAN_ITEMS) m.set(it.code, it);
    return m;
  }, []);

  const handleSelect = (payload: { code: string; computedQty: number; breakdown: string }) => {
    const item = itemByCode.get(payload.code);
    if (!item) return;
    onSelectItem({ ...item, computedQty: payload.computedQty, qtyBreakdown: payload.breakdown });
  };

  const byDay = useMemo(() => {
    const groups = new Map<string, MealCard[]>();
    for (const m of mealCards) {
      if (!orderDays.has(m.day as (typeof DAYS)[number])) continue;
      if (!groups.has(m.day)) groups.set(m.day, []);
      groups.get(m.day)!.push(m);
    }
    return Array.from(groups.entries()).sort(
      ([a], [b]) => DAYS.indexOf(a as (typeof DAYS)[number]) - DAYS.indexOf(b as (typeof DAYS)[number]),
    );
  }, [orderDays]);

  // Flatten every choice + enabled special-meal item across all displayed
  // meal cards, attaching the computed qty. Items with qty <= 0 are dropped.
  // Used by the "Create All Orders" bulk action below.
  const availableItems = useMemo<MealPlanPickItem[]>(() => {
    const out: MealPlanPickItem[] = [];
    for (const [, meals] of byDay) {
      for (const meal of meals) {
        for (const choice of meal.choices) {
          for (const it of choice.items) {
            const { qty, breakdown } = computeMealQty({
              requirements,
              day: meal.day,
              flightTypes: meal.flightType,
              forType: meal.forType,
              kind: "Choice",
              percentage: choice.percentage,
            });
            if (qty <= 0) continue;
            const base = itemByCode.get(`MP-${slugifyItem(it.name)}`);
            if (base) out.push({ ...base, computedQty: qty, qtyBreakdown: breakdown });
          }
        }
        for (const sp of meal.specialMeals) {
          if (!sp.enabled) continue;
          for (const it of sp.items) {
            const explicitPortions = typeof sp.portions === "number" ? sp.portions : 0;
            const computed = computeMealQty({
              requirements,
              day: meal.day,
              flightTypes: meal.flightType,
              forType: meal.forType,
              kind: "Special",
            });
            const qty = explicitPortions > 0 ? explicitPortions : computed.qty;
            if (qty <= 0) continue;
            const breakdown = explicitPortions > 0
              ? `${explicitPortions} portion${explicitPortions === 1 ? "" : "s"} configured for ${sp.type}`
              : computed.breakdown;
            const base = itemByCode.get(`MP-${slugifyItem(it.name)}`);
            if (base) out.push({ ...base, computedQty: qty, qtyBreakdown: breakdown });
          }
        }
      }
    }
    return out;
  }, [byDay, requirements, itemByCode]);

  const totalPax = ordersForDate.reduce((s, o) => s + o.pax, 0);
  const totalCrew = ordersForDate.reduce((s, o) => s + o.crew, 0);
  const totalSpecial = ordersForDate.reduce((s, o) => s + o.specialMeals, 0);
  const totalMeals = totalPax + totalCrew + totalSpecial;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <DialogTitle>
              Meal Planning Details — New Meal Order for {date || gmOrderSummary.date}
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                onOpenChange(false);
                navigate("/meal-planning");
              }}
            >
              <UtensilsCrossed className="h-4 w-4 mr-1" /> Open in Meal Planner
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            <SummaryStat label="Flights"        value={ordersForDate.length.toString()} />
            <SummaryStat label="Passengers"     value={totalPax.toLocaleString()} />
            <SummaryStat label="Crew"           value={totalCrew.toString()} />
            <SummaryStat label="Special Meals"  value={totalSpecial.toString()} />
            <SummaryStat label="Total Meals"    value={totalMeals.toLocaleString()} success />
          </div>
        </DialogHeader>

        <Tabs defaultValue="orders" className="flex-1 overflow-hidden flex flex-col">
          <div className="px-6 pt-4 border-b border-border">
            <TabsList className="bg-transparent p-0 h-auto rounded-none gap-4">
              <TabsTrigger
                value="orders"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-1 pb-3 text-xs uppercase tracking-wider font-semibold"
              >
                Flight Orders ({ordersForDate.length})
              </TabsTrigger>
              <TabsTrigger
                value="crew"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-1 pb-3 text-xs uppercase tracking-wider font-semibold"
              >
                Crew Meals ({totalCrew})
              </TabsTrigger>
              <TabsTrigger
                value="meals"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-1 pb-3 text-xs uppercase tracking-wider font-semibold"
              >
                Meal Plan
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="orders" className="flex-1 overflow-y-auto px-6 py-5 mt-0">
            <FlightOrdersTabContent orders={ordersForDate} />
          </TabsContent>

          <TabsContent value="crew" className="flex-1 overflow-y-auto px-6 py-5 mt-0">
            <CrewMealsTabContent orders={ordersForDate} />
          </TabsContent>

          <TabsContent value="meals" className="flex-1 overflow-hidden flex flex-col mt-0">
            <div className="flex-1 overflow-y-auto">
              <div className="px-6 pt-5 pb-3">
                <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <UtensilsCrossed className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span>
                      Click <span className="font-semibold">Select</span> beside any meal item to start a single
                      production entry, or use <span className="font-semibold">Create All Orders</span> — that
                      raises Pending orders for every available menu, runs MRP, and bundles everything into one
                      Demand Request (in-stock items become one Issue, shortfalls become one Purchase Requisition).
                    </span>
                  </div>
                  <Button
                    size="sm"
                    disabled={availableItems.length === 0}
                    onClick={() => onBulkCreate(availableItems)}
                    className="shrink-0"
                  >
                    <Zap className="h-3.5 w-3.5 mr-1.5" />
                    Create All Orders ({availableItems.length})
                  </Button>
                </div>
              </div>
              <div className="px-6 pb-4">
                <RequirementsSummary requirements={requirements} />
              </div>

              <div className="px-6 py-3 border-y border-border bg-muted/30">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Menu Templates &mdash; {Array.from(orderDays).join(" · ")}
                </div>
              </div>

              <div className="px-6 py-5">
                {byDay.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-12">
                    No menu templates available for the order days.
                  </div>
                ) : (
                  <div className="space-y-6">
                    {byDay.map(([day, meals]) => (
                      <div key={day}>
                        <div className="flex items-center gap-2 mb-3">
                          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                            {day}
                          </h3>
                          <span className="text-xs text-muted-foreground">
                            ({meals.length} meal{meals.length > 1 ? "s" : ""})
                          </span>
                        </div>
                        <div className="space-y-3">
                          {meals.map((m) => (
                            <MealCardView
                              key={m.id}
                              meal={m}
                              onSelect={handleSelect}
                              requirements={requirements}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({
  label, value, success,
}: { label: string; value: string; success?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 font-semibold", success ? "text-success" : "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

function OrderStatusBadges({ legs }: { legs: { status: string }[] }) {
  if (legs.length === 0) return null;
  return <StatusBadge status={legs[0].status} />;
}

function FlightOrdersTabContent({ orders }: { orders: FlightOrderRow[] }) {
  const totalPax = orders.reduce((s, o) => s + o.pax, 0);
  const totalCrew = orders.reduce((s, o) => s + o.crew, 0);
  const totalSpecial = orders.reduce((s, o) => s + o.specialMeals, 0);

  // Group by Date, then by Order # within each date, then sort legs by ETD.
  const byDate = new Map<string, FlightOrderRow[]>();
  for (const o of orders) {
    if (!byDate.has(o.date)) byDate.set(o.date, []);
    byDate.get(o.date)!.push(o);
  }
  const datesSorted = Array.from(byDate.keys()).sort();

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40 sticky top-0">
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">ETD</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Type</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">PAX</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Crew</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Special</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {datesSorted.map((date) => {
              const dayRows = byDate.get(date)!;
              const dayPax = dayRows.reduce((s, o) => s + o.pax, 0);
              const dayCrew = dayRows.reduce((s, o) => s + o.crew, 0);
              const daySpec = dayRows.reduce((s, o) => s + o.specialMeals, 0);

              // Sub-group by Order # within this date, preserving first-seen order
              const byOrder = new Map<string, FlightOrderRow[]>();
              dayRows.forEach((o) => {
                if (!byOrder.has(o.orderNo)) byOrder.set(o.orderNo, []);
                byOrder.get(o.orderNo)!.push(o);
              });
              // Sort each order's legs by ETD
              byOrder.forEach((legs) => legs.sort((a, b) => a.etd.localeCompare(b.etd)));

              return (
                <Fragment key={date}>
                  <TableRow className="bg-primary/10 border-t-2 border-t-primary/50 hover:bg-primary/15">
                    <TableCell colSpan={7} className="py-2">
                      <span className="font-semibold text-primary uppercase tracking-wider text-xs">
                        {date}
                      </span>
                      <span className="ml-2 text-[11px] text-muted-foreground tabular-nums">
                        {byOrder.size} order{byOrder.size === 1 ? "" : "s"} ·
                        {" "}{dayRows.length} flight{dayRows.length === 1 ? "" : "s"} ·
                        {" "}<strong className="text-foreground">{dayPax.toLocaleString()}</strong> pax ·
                        {" "}<strong className="text-foreground">{dayCrew.toLocaleString()}</strong> crew ·
                        {" "}<strong className="text-foreground">{daySpec.toLocaleString()}</strong> special
                      </span>
                    </TableCell>
                  </TableRow>
                  {Array.from(byOrder.entries()).map(([orderNo, legs]) => (
                    <Fragment key={`${date}-${orderNo}`}>
                      <TableRow className="bg-primary/5 hover:bg-primary/10">
                        <TableCell colSpan={7} className="pl-4 py-1.5">
                          <div className="flex items-center flex-wrap gap-2">
                            <span className="font-mono text-sm font-semibold text-primary">{orderNo}</span>
                            {legs.length > 1 && (
                              <Badge
                                variant="outline"
                                className="h-5 px-1.5 text-[10px] tabular-nums border-primary/30 bg-card text-primary"
                              >
                                {legs.length} legs
                              </Badge>
                            )}
                            <OrderStatusBadges legs={legs} />
                          </div>
                        </TableCell>
                      </TableRow>
                      {legs.map((o) => {
                        const dom = isDomesticSector(o.sector);
                        return (
                          <TableRow key={o.id} className="hover:bg-muted/30">
                            <TableCell className="font-medium pl-8">{o.flight}</TableCell>
                            <TableCell>{o.sector}</TableCell>
                            <TableCell className="tabular-nums">{o.etd}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] font-normal",
                                  dom
                                    ? "border-success/30 bg-success/5 text-success"
                                    : "border-navy/30 bg-navy/5 text-navy",
                                )}
                              >
                                {dom ? "Domestic" : "International"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{o.pax}</TableCell>
                            <TableCell className="text-right tabular-nums">{o.crew}</TableCell>
                            <TableCell className="text-right tabular-nums">{o.specialMeals}</TableCell>
                          </TableRow>
                        );
                      })}
                    </Fragment>
                  ))}
                </Fragment>
              );
            })}
            <TableRow className="bg-muted/30 font-semibold">
              <TableCell colSpan={4} className="text-right uppercase text-xs tracking-wider">
                Grand Total
              </TableCell>
              <TableCell className="text-right tabular-nums">{totalPax.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{totalCrew.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{totalSpecial.toLocaleString()}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Crew Meals tab — same flight orders, grouped by meal slot (derived from ETD)
// ─────────────────────────────────────────────────────────────────────────────
function CrewMealsTabContent({ orders }: { orders: FlightOrderRow[] }) {
  const slots = useMealSlots();
  // Group orders by meal slot, then by Order # within each slot
  const bySlot = new Map<MealSlot, FlightOrderRow[]>();
  slots.forEach((s) => bySlot.set(s.name, []));
  orders.forEach((o) => bySlot.get(resolveMealSlot(o.etd, slots).name)!.push(o));
  slots.forEach((s) =>
    bySlot.get(s.name)!.sort((a, b) => a.etd.localeCompare(b.etd)),
  );

  const totalCrew = orders.reduce((s, o) => s + o.crew, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground flex items-center gap-2">
        <Users className="h-3.5 w-3.5 text-primary shrink-0" />
        <span>
          Cabin-crew meal counts grouped by serving slot — slot is derived from each flight's ETD.
          Use this to plan crew-specific BOMs alongside passenger meals.
        </span>
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40 sticky top-0">
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">ETD</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Type</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">No of Crew</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slots.map((slot) => {
              const slotRows = bySlot.get(slot.name)!;
              if (slotRows.length === 0) return null;
              const slotCrew = slotRows.reduce((s, o) => s + o.crew, 0);

              // Sub-group by Order # within this slot
              const byOrder = new Map<string, FlightOrderRow[]>();
              slotRows.forEach((o) => {
                if (!byOrder.has(o.orderNo)) byOrder.set(o.orderNo, []);
                byOrder.get(o.orderNo)!.push(o);
              });
              byOrder.forEach((legs) => legs.sort((a, b) => a.etd.localeCompare(b.etd)));

              return (
                <Fragment key={slot.name}>
                  <TableRow className="bg-primary/10 border-t-2 border-t-primary/50 hover:bg-primary/15">
                    <TableCell colSpan={5} className="py-2">
                      <span className="font-semibold text-primary uppercase tracking-wider text-xs">
                        {slot.name}
                      </span>
                      <span className="ml-2 text-[10px] text-muted-foreground tabular-nums">
                        {formatSlotRange(slot)}
                      </span>
                      <span className="ml-3 text-[11px] text-muted-foreground tabular-nums">
                        {byOrder.size} order{byOrder.size === 1 ? "" : "s"} ·
                        {" "}{slotRows.length} flight{slotRows.length === 1 ? "" : "s"} ·
                        {" "}<strong className="text-foreground">{slotCrew.toLocaleString()}</strong> crew meals
                      </span>
                    </TableCell>
                  </TableRow>
                  {Array.from(byOrder.entries()).map(([orderNo, legs]) => (
                    <Fragment key={`${slot.name}-${orderNo}`}>
                      <TableRow className="bg-primary/5 hover:bg-primary/10">
                        <TableCell colSpan={5} className="pl-4 py-1.5">
                          <div className="flex items-center flex-wrap gap-2">
                            <span className="font-mono text-sm font-semibold text-primary">{orderNo}</span>
                            {legs.length > 1 && (
                              <Badge
                                variant="outline"
                                className="h-5 px-1.5 text-[10px] tabular-nums border-primary/30 bg-card text-primary"
                              >
                                {legs.length} legs
                              </Badge>
                            )}
                            <OrderStatusBadges legs={legs} />
                          </div>
                        </TableCell>
                      </TableRow>
                      {legs.map((o) => {
                        const dom = isDomesticSector(o.sector);
                        return (
                          <TableRow key={o.id} className="hover:bg-muted/30">
                            <TableCell className="font-medium pl-8">{o.flight}</TableCell>
                            <TableCell>{o.sector}</TableCell>
                            <TableCell className="tabular-nums">{o.etd}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] font-normal",
                                  dom
                                    ? "border-success/30 bg-success/5 text-success"
                                    : "border-navy/30 bg-navy/5 text-navy",
                                )}
                              >
                                {dom ? "Domestic" : "International"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{o.crew}</TableCell>
                          </TableRow>
                        );
                      })}
                    </Fragment>
                  ))}
                  <TableRow className="bg-muted/30 font-semibold">
                    <TableCell colSpan={4} className="text-right uppercase text-[10px] tracking-wider">
                      {slot.name} Total
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-primary">{slotCrew}</TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
            <TableRow className="bg-primary/10 font-bold">
              <TableCell colSpan={4} className="text-right uppercase text-xs tracking-wider">
                Grand Total
              </TableCell>
              <TableCell className="text-right tabular-nums text-primary">{totalCrew.toLocaleString()}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RequirementsSummary({ requirements }: { requirements: OrderRequirement[] }) {
  const totals = requirements.reduce(
    (acc, r) => ({
      flights: acc.flights + r.flights,
      passengers: acc.passengers + r.passengers,
      crew: acc.crew + r.crew,
      specialMeals: acc.specialMeals + r.specialMeals,
    }),
    { flights: 0, passengers: 0, crew: 0, specialMeals: 0 },
  );
  const grandTotal = totals.passengers + totals.crew + totals.specialMeals;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-success">
          Required Meals (derived from Flight Orders)
        </div>
        <div className="text-[11px] text-muted-foreground">
          Grouped by Day &times; Flight Type
        </div>
      </div>
      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wider">Day</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Flight Type</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Flights</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Passengers</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Crew</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Special</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Total Meals</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requirements.map((r) => {
              const total = r.passengers + r.crew + r.specialMeals;
              return (
                <TableRow key={`${r.day}-${r.flightType}`}>
                  <TableCell className="font-medium">{r.day}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      <Plane className="h-2.5 w-2.5 mr-1" /> {r.flightType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.flights}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.passengers.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.crew.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.specialMeals.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {total.toLocaleString()}
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow className="bg-muted/30 font-semibold">
              <TableCell colSpan={2} className="text-right uppercase text-xs tracking-wider">
                Grand Total
              </TableCell>
              <TableCell className="text-right tabular-nums">{totals.flights}</TableCell>
              <TableCell className="text-right tabular-nums">{totals.passengers.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{totals.crew.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{totals.specialMeals.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums text-success">
                {grandTotal.toLocaleString()}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Material Requirement Planning (MRP)
// ═══════════════════════════════════════════════════════════════════════════
//
// Lets the user pick one or more Production Orders and computes the combined
// material requirement (raw + packaging + other consumption) using each
// order's BOM and outstanding qty (orderQty − producedQty).
//
// Match strategy: look up PRODUCTION_ITEMS by name (the order's `bom` field),
// since not every seed order carries an `outputItemCode`.
// ═══════════════════════════════════════════════════════════════════════════

type MrpBasis = "remaining" | "full";

// ── Reference lookups for MRP ─────────────────────────────────────────────────
// Material → supplier mapping (mirrors the seed data in /config-price plus
// reasonable defaults for items the procurement team typically buys together).
// Any material not in this map falls back to a generic supplier, which means
// it gets bundled into a single fallback Purchase Requisition.
const MRP_SUPPLIER_BY_MATERIAL: Record<string, string> = {
  "Basmati Rice": "Agro Fresh Ltd.",
  "Chicken": "Meat & Co.",
  "Chicken Breast": "Meat & Co.",
  "Onion": "Agro Fresh Ltd.",
  "Tomato": "Agro Fresh Ltd.",
  "Spice Mix": "Spice House Ltd.",
  "Cooking Oil": "Agro Fresh Ltd.",
  "Mixed Vegetable": "Agro Fresh Ltd.",
  "Aluminum Tray": "Packaging BD",
  "Lid Foil": "Packaging BD",
  "Meal Box": "Packaging BD",
  "Mineral Water 250ml": "Pure Water Co.",
  "Cooking Gas": "Industrial Gas Co.",
  "Disposable Glove": "Hygiene Supplies Ltd.",
};
const MRP_FALLBACK_SUPPLIER = "Catering General Supplies";

function resolveMrpSupplier(itemName: string): string {
  return MRP_SUPPLIER_BY_MATERIAL[itemName] ?? MRP_FALLBACK_SUPPLIER;
}

// Stock lookup by item name. We treat the entire `inventory.stock` value as
// being held at WH-001 (Central Warehouse) — per-warehouse stock isn't modeled
// yet, so this is the demo simplification.
function getMrpOnHand(itemName: string): number {
  const inv = inventory.find((i) => i.name.toLowerCase() === itemName.toLowerCase());
  return inv?.stock ?? 0;
}

const MRP_CENTRAL_WAREHOUSE_ID = "WH-001";
const MRP_CENTRAL_WAREHOUSE_NAME =
  ALL_WAREHOUSES.find((w) => w.id === MRP_CENTRAL_WAREHOUSE_ID)?.name ?? "Central Warehouse";

function downloadMrpCsv(run: WfMrpRun) {
  const header = [
    "MRP Run", "Date", "Run By", "Basis",
    "Bucket", "Item Code", "Item Name", "UoM",
    "Required Qty", "On Hand", "Shortfall",
    "Rate (BDT)", "Total Cost (BDT)",
  ];
  const rows = run.materials.map((m) => [
    run.id, run.date, run.runBy, run.basis,
    m.bucket, m.itemCode, m.itemName, m.uom,
    m.reqQty.toFixed(3), m.onHand.toString(), m.shortfall.toFixed(3),
    m.rate.toString(), m.totalCost.toFixed(2),
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${run.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function MaterialRequirementPlanningDialog({
  open, onOpenChange, orders,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orders: WfProductionEntry[];
}) {
  const { addDemands, addMrpRun, demands, mrpRuns } = useWorkflow();
  const [lastRun, setLastRun] = useState<WfMrpRun | null>(null);
  const [lastDemandId, setLastDemandId] = useState<string | null>(null);
  // Default to fulfillable orders: anything not yet shipped (drop Completed)
  // and exclude Pending until approved.
  const eligible = useMemo(
    () => orders.filter((o) => o.status !== "Completed"),
    [orders],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [basis, setBasis] = useState<MrpBasis>("remaining");

  // Reset selection each time the dialog opens
  useEffect(() => {
    if (open) {
      // Pre-select Approved + In Preparation orders by default — these are
      // actively in the production pipeline.
      const defaults = new Set(
        eligible
          .filter((o) => o.status === "Approved" || o.status === "In Preparation")
          .map((o) => o.id),
      );
      setSelected(defaults);
      setBasis("remaining");
      setLastRun(null);  // clear any previous result view
      setLastDemandId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const selectAll = () => setSelected(new Set(eligible.map((o) => o.id)));
  const clearAll = () => setSelected(new Set());

  // Build the material aggregation from selected orders + basis
  const materials = useMemo(() => {
    const lines: OutputLine[] = [];
    for (const o of eligible) {
      if (!selected.has(o.id)) continue;
      const target = o.orderQty ?? o.producedQty;
      const qty = basis === "remaining" ? Math.max(0, target - o.producedQty) : target;
      if (qty <= 0) continue;
      // Find the production item by name (BOM name = output item name typically)
      const item = PRODUCTION_ITEMS.find(
        (p) => p.name === o.outputItemName || p.name === o.bom || p.code === o.outputItemCode,
      );
      if (!item) continue;
      lines.push({
        id: o.id,
        itemCode: item.code,
        itemName: item.name,
        qty,
        source: "bom",
      });
    }
    return aggregateMaterials(lines);
  }, [selected, basis, eligible]);

  const selectedOrders = eligible.filter((o) => selected.has(o.id));
  const totalUnits = selectedOrders.reduce((s, o) => {
    const target = o.orderQty ?? o.producedQty;
    const q = basis === "remaining" ? Math.max(0, target - o.producedQty) : target;
    return s + q;
  }, 0);
  const totalCost =
    materials.raw.reduce((s, m) => s + m.reqQty * m.rate, 0) +
    materials.pkg.reduce((s, m) => s + m.reqQty * m.rate, 0) +
    materials.other.reduce((s, m) => s + m.reqQty * m.rate, 0);

  const unmatched = selectedOrders.filter((o) => !PRODUCTION_ITEMS.find(
    (p) => p.name === o.outputItemName || p.name === o.bom || p.code === o.outputItemCode,
  ));

  // Flatten + enrich every material with stock + shortfall + supplier
  const enrichMaterial = (m: AggregatedMaterial, bucket: "Raw" | "Packaging" | "Other"): WfMrpMaterial => {
    const onHand = getMrpOnHand(m.itemName);
    const shortfall = Math.max(0, m.reqQty - onHand);
    return {
      itemCode: m.itemCode,
      itemName: m.itemName,
      uom: m.uom,
      bucket,
      reqQty: m.reqQty,
      onHand,
      shortfall,
      rate: m.rate,
      totalCost: m.reqQty * m.rate,
      supplier: shortfall > 0 ? resolveMrpSupplier(m.itemName) : undefined,
    };
  };
  const enrichedMaterials: WfMrpMaterial[] = [
    ...materials.raw.map((m) => enrichMaterial(m, "Raw")),
    ...materials.pkg.map((m) => enrichMaterial(m, "Packaging")),
    ...materials.other.map((m) => enrichMaterial(m, "Other")),
  ];
  const shortfallMaterials = enrichedMaterials.filter((m) => m.shortfall > 0);
  const transferableMaterials = enrichedMaterials.filter((m) => m.onHand > 0 && m.reqQty > 0);

  // ── Generate Requirement Plan ─────────────────────────────────────────────
  // New flow: the MRP run records the materials snapshot and raises ONE
  // Demand Request in "Pending Approval". No PRs or Transfer Notes are created
  // here — those are produced on demand approval (see /approval-management's
  // approveDemand), which also patches the run's requisitionIds/transferIds
  // back through updateMrpRun.
  //
  //   Selected Production Orders -> MRP run -> Demand Request
  //                                                |
  //                                            (on approval)
  //                                                v
  //                                  { ONE Transfer Note + ONE Purchase
  //                                    Requisition based on current stock }
  const handleGenerate = () => {
    if (selectedOrders.length === 0 || totalUnits === 0) return;

    const runSeq = String(mrpRuns.length + 1).padStart(3, "0");
    const runId = `MRP-2026-${runSeq}`;
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

    // 1) Demand Request bundling every material (Pending Approval, autoFulfill)
    const drSeq = String(9000 + demands.length + 1).padStart(4, "0");
    const drId = `DR-${drSeq}`;
    const drItems: WfDemandItem[] = enrichedMaterials.map((s) => {
      // Prefer inventory id when the material exists in stock master so
      // downstream Item Issue / Transfer screens can resolve the row.
      const invRow = inventory.find((i) => i.name.toLowerCase() === s.itemName.toLowerCase());
      return {
        id: invRow?.id ?? s.itemCode,
        name: s.itemName,
        qty: Math.round(s.reqQty * 1000) / 1000,
        uom: s.uom,
        type: s.bucket,
      };
    });
    const dr: WfDemandRequest = {
      id: drId,
      reference: runId,
      requestedBy: "MRP System",
      role: "Flight Kitchen Executive",
      date: stamp,
      status: "Pending Approval",
      items: drItems,
      note: `Auto-generated from MRP run ${runId}. Covers ${selectedOrders.length} production order${selectedOrders.length === 1 ? "" : "s"} (${enrichedMaterials.length} materials). On approval, an Issue + PR will be auto-created from current stock levels.`,
      source: "Kitchen",
      officeId: "OFF-001",
      warehouseId: selectedOrders[0]?.warehouseId ?? "WH-003",
      autoFulfill: true,
    };
    addDemands([dr]);

    // 2) Persist the run — PR/TN ids stay empty until the demand is approved
    const run: WfMrpRun = {
      id: runId,
      date: stamp,
      runBy: "GM/Admin",
      basis,
      orderIds: selectedOrders.map((o) => o.id),
      totalUnits,
      totalCost,
      materials: enrichedMaterials,
      requisitionIds: [],
      transferIds: [],
      demandRef: drId,
    };
    addMrpRun(run);

    setLastRun(run);
    setLastDemandId(drId);
    toast.success(
      `${runId} generated — Demand ${drId} raised (pending approval).`,
      { duration: 6000 },
    );
  };

  // ── Render: result view after generation ────────────────────────────────
  if (lastRun) {
    const resultShortfalls = lastRun.materials.filter((m) => m.shortfall > 0).length;
    const resultInStock = lastRun.materials.filter((m) => m.shortfall < m.reqQty).length;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              Requirement Plan Generated
              <span className="font-mono text-sm text-muted-foreground ml-1">— {lastRun.id}</span>
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              CSV downloaded. A Demand Request has been raised — Issue + PR will be
              created automatically when it's approved on Approval Management.
            </p>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-muted/20 px-4 py-3">
              <SummaryCell label="Orders" value={lastRun.orderIds.length.toString()} />
              <SummaryCell label="Units Planned" value={lastRun.totalUnits.toLocaleString()} />
              <SummaryCell label="Materials" value={lastRun.materials.length.toString()} />
            </div>

            {/* Demand Request — the single artifact this dialog actually
                creates. PR/TN are deferred until this demand is approved. */}
            {lastDemandId && (
              <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-warning" />
                    <span className="text-sm font-semibold uppercase tracking-wider text-warning-foreground">
                      Demand Request raised
                    </span>
                    <Badge variant="outline" className="font-mono text-[11px] border-warning/40 bg-card">
                      {lastDemandId}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] border-warning/40 bg-warning/15 text-warning-foreground">
                      Pending Approval
                    </Badge>
                  </div>
                  <Button asChild size="sm" variant="outline" className="h-7 text-[11px]">
                    <Link to="/approval-management">
                      Approve now <ArrowRight className="h-3 w-3 ml-1" />
                    </Link>
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Covers all <strong className="text-foreground">{lastRun.materials.length} material{lastRun.materials.length === 1 ? "" : "s"}</strong> from the selected production orders.
                </p>
              </div>
            )}

            {/* Forecast of artifacts that will be created on approval. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-md border border-success/30 bg-success/5 px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <FileText className="h-4 w-4 text-success" />
                  <span className="text-sm font-semibold uppercase tracking-wider text-success">
                    Purchase Requisition
                  </span>
                </div>
                {resultShortfalls > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    <strong className="text-foreground">{resultShortfalls} material{resultShortfalls === 1 ? "" : "s"}</strong> short — one PR will be auto-created on approval.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3" /> No shortfall — no PR will be raised.
                  </p>
                )}
              </div>

              <div className="rounded-md border border-navy/30 bg-navy/5 px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Send className="h-4 w-4 text-navy" />
                  <span className="text-sm font-semibold uppercase tracking-wider text-navy">
                    Item Issue
                  </span>
                </div>
                {resultInStock > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    <strong className="text-foreground">{resultInStock} material{resultInStock === 1 ? "" : "s"}</strong> with on-hand stock — one Item Issue will be auto-created on approval.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <AlertCircle className="h-3 w-3" /> No on-hand stock — no Item Issue needed.
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => downloadMrpCsv(lastRun)}>
              <FileText className="h-4 w-4 mr-1.5" /> Re-download CSV
            </Button>
            <Button variant="outline" onClick={() => { setLastRun(null); setLastDemandId(null); }}>
              <Calculator className="h-4 w-4 mr-1.5" /> New Run
            </Button>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Render: planning view ───────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            Material Requirement Planning (MRP)
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Select one or more Production Orders below — the combined material requirement is computed live from each order's BOM.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {/* ── Order selection ───────────────────────────────────────── */}
          <div className="px-6 pt-5 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider">
                Production Orders
                <Badge variant="outline" className="ml-2 text-[10px]">
                  {selected.size} selected
                </Badge>
              </h3>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-md border border-input bg-background p-0.5 shadow-sm">
                  {(["remaining", "full"] as MrpBasis[]).map((b) => {
                    const active = basis === b;
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setBasis(b)}
                        className={
                          "px-3 py-1 text-[11px] font-medium rounded-sm transition-colors " +
                          (active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")
                        }
                        title={b === "remaining"
                          ? "Use only the qty still pending (order − produced)"
                          : "Use the full order qty regardless of produced"}
                      >
                        {b === "remaining" ? "Remaining Only" : "Full Order Qty"}
                      </button>
                    );
                  })}
                </div>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={selectAll}>
                  Select All
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearAll}>
                  Clear
                </Button>
              </div>
            </div>

            <div className="border border-border rounded-md overflow-hidden max-h-[260px] overflow-y-auto">
              <Table>
                <TableHeader className="bg-muted/40 sticky top-0">
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead className="text-[10px] uppercase tracking-wider">Order #</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Output Item</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">BOM</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-right">Order Qty</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-right">Produced</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-right">Remaining</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eligible.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-6">
                        No fulfillable orders. Approve a Production Order to see materials here.
                      </TableCell>
                    </TableRow>
                  ) : (
                    eligible.map((o) => {
                      const target = o.orderQty ?? o.producedQty;
                      const rem = Math.max(0, target - o.producedQty);
                      const isSelected = selected.has(o.id);
                      const hasRecipe = !!PRODUCTION_ITEMS.find(
                        (p) => p.name === o.outputItemName || p.name === o.bom || p.code === o.outputItemCode,
                      );
                      return (
                        <TableRow
                          key={o.id}
                          className={cn(
                            "hover:bg-muted/30 cursor-pointer",
                            isSelected && "bg-primary/5",
                          )}
                          onClick={() => toggle(o.id)}
                        >
                          <TableCell className="text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggle(o.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="accent-primary"
                              aria-label={`Select ${o.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{o.id}</TableCell>
                          <TableCell className="text-xs">
                            <div className="flex items-center gap-1.5">
                              {o.outputItemName ?? "—"}
                              {!hasRecipe && (
                                <Badge variant="outline" className="text-[9px] border-warning/40 bg-warning/10 text-warning">
                                  No recipe
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{o.bom}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{target.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{o.producedQty.toLocaleString()}</TableCell>
                          <TableCell className={cn(
                            "text-right tabular-nums text-xs",
                            rem > 0 ? "text-warning font-medium" : "text-success",
                          )}>
                            {rem.toLocaleString()}
                          </TableCell>
                          <TableCell><StatusBadge status={o.status} /></TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {unmatched.length > 0 && (
              <div className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning-foreground flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
                <div>
                  <strong>{unmatched.length}</strong> selected order{unmatched.length === 1 ? "" : "s"} have no recipe in the BOM master:
                  {" "}{unmatched.map((o) => o.id).join(", ")}. These will be skipped from the requirement calculation.
                </div>
              </div>
            )}
          </div>

          {/* ── Summary strip ────────────────────────────────────────── */}
          <div className="px-6 py-3 border-y border-border bg-muted/30">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <SummaryCell label="Selected Orders" value={selected.size.toString()} />
              <SummaryCell label="Units to Produce" value={totalUnits.toLocaleString()} />
              <SummaryCell
                label="Distinct Materials"
                value={enrichedMaterials.length.toString()}
              />
              <SummaryCell
                label="Shortfalls"
                value={shortfallMaterials.length.toString()}
                tone={shortfallMaterials.length > 0 ? "warning" : "success"}
              />
            </div>
            {shortfallMaterials.length > 0 && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                Shortfalls will be procured via auto-generated Purchase Requisition{shortfallMaterials.length === 1 ? "" : "s"}.
              </div>
            )}
          </div>

          {/* ── Material requirements ───────────────────────────────── */}
          <div className="px-6 py-5 space-y-5">
            {selected.size === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-10">
                Tick one or more orders above to compute the material requirement.
              </div>
            ) : totalUnits === 0 ? (
              <div className="rounded-md border border-success/30 bg-success/5 px-4 py-3 text-sm text-success flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                All selected orders are already fully produced — no material requirement.
              </div>
            ) : (
              <>
                <MrpMaterialTable
                  title="Raw Materials"
                  icon={Package}
                  items={enrichedMaterials.filter((m) => m.bucket === "Raw")}
                  tone="primary"
                />
                <MrpMaterialTable
                  title="Packaging Materials"
                  icon={PackageOpen}
                  items={enrichedMaterials.filter((m) => m.bucket === "Packaging")}
                  tone="navy"
                />
                <MrpMaterialTable
                  title="Other Consumption"
                  icon={Wrench}
                  items={enrichedMaterials.filter((m) => m.bucket === "Other")}
                  tone="muted"
                />
              </>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t border-border bg-muted/20">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button
            disabled={selected.size === 0 || totalUnits === 0}
            onClick={handleGenerate}
          >
            <Calculator className="h-4 w-4 mr-1.5" /> Generate Requirement Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCell({
  label, value, tone,
}: { label: string; value: string; tone?: "primary" | "warning" | "success" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-0.5 text-base font-semibold tabular-nums",
        tone === "primary" && "text-primary",
        tone === "warning" && "text-warning",
        tone === "success" && "text-success",
        !tone && "text-foreground",
      )}>
        {value}
      </div>
    </div>
  );
}

function MrpMaterialTable({
  title, icon: Icon, items, tone,
}: {
  title: string;
  icon: typeof Package;
  items: WfMrpMaterial[];
  tone: "primary" | "navy" | "muted";
}) {
  const shortfallCount = items.filter((m) => m.shortfall > 0).length;
  const headerTint =
    tone === "primary" ? "bg-primary/5 text-primary" :
    tone === "navy"    ? "bg-navy/5 text-navy" :
    "bg-muted/40 text-muted-foreground";

  return (
    <div>
      <div className={cn(
        "flex items-center justify-between rounded-t-md px-3 py-2 border border-b-0 border-border",
        headerTint,
      )}>
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
          <Badge variant="outline" className="text-[10px] bg-card">
            {items.length} item{items.length === 1 ? "" : "s"}
          </Badge>
          {shortfallCount > 0 && (
            <Badge variant="outline" className="text-[10px] border-warning/40 bg-warning/10 text-warning">
              {shortfallCount} shortfall{shortfallCount === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
      </div>
      <div className="border border-border rounded-b-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="w-8 text-[10px] uppercase tracking-wider">SL</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider w-24">Code</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Material</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider w-14">UoM</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-right w-24">Req. Qty</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-right w-20">On Hand</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-right w-24">Shortfall</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-6">
                  No {title.toLowerCase()} required for the selected orders.
                </TableCell>
              </TableRow>
            ) : (
              items.map((m, i) => {
                const isShort = m.shortfall > 0;
                return (
                  <TableRow
                    key={m.itemCode}
                    className={cn("hover:bg-muted/20", isShort && "bg-destructive/5")}
                  >
                    <TableCell className="text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{m.itemCode}</TableCell>
                    <TableCell className="text-sm font-medium">{m.itemName}</TableCell>
                    <TableCell className="text-xs">{m.uom}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-semibold">
                      {m.reqQty.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {m.onHand.toLocaleString()}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right tabular-nums text-sm font-semibold",
                      isShort ? "text-destructive" : "text-success",
                    )}>
                      {isShort ? m.shortfall.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
