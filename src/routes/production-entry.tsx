import { useNavigate, useLocation, useSearchParams, Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { ReviewStatusCell } from "@/components/common/ReviewStatusCell";
import { RowActions } from "@/components/common/RowActions";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { getPurchaseRequisitions, type PurchaseRequisition } from "@/lib/purchase-requisitions";
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
  isDomesticSector, itemsByType, allocateFefo, SPECIAL_MEAL_BY_CODE,
  items as MASTER_ITEMS, itemCanProduce,
  type FlightOrderRow, type MealSlot, type ItemMaster, type InventoryItem,
} from "@/lib/sample-data";
import { getItemStock } from "@/lib/inventory-stock";
import { roundQty } from "@/lib/num";
import { logAudit } from "@/lib/audit-log";
import { useOrderSummaryAdjustments, approvedDeltaFor, type FlightTypeScope } from "@/lib/order-summary-adjustments";
import {
  useProductionBasisSettings, effectiveBasis, productionQtyForBasis,
  PRODUCTION_BASIS_LABEL, type ProductionBasis,
} from "@/lib/production-basis-settings";
import { useFlightOrders, getAllAmendments } from "@/lib/flight-orders-store";
import { useMealSlots, resolveMealSlot, formatSlotRange } from "@/lib/meal-slot-settings";
import { Fragment } from "react";
import { useArrivalFlash } from "@/lib/arrival-flash";
import {
  useWorkflow,
  type WfProductionEntry,
  type WfMrpRun, type WfMrpMaterial,
  type WfDemandItem,
  type WfDemandRequest,
  type WfGRN,
} from "@/lib/workflow-store";
import { LocationPicker, LocationFilter, LocationCell } from "@/components/common/LocationPicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DAYS,
  gmOrderSummary,
  mealCards,
  loadMealPlanningConfig,
  perMealQty,
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
    // order is Dispatched, Completed or Departed it has left the pipeline.
    if (o.status === "Dispatched" || o.status === "Completed" || o.status === "Departed") continue;
    byDate.set(o.date, (byDate.get(o.date) ?? 0) + o.pax + o.crew + o.specialMeals);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totalMeals]) => ({ date, totalMeals }));
}

/** Local yyyy-mm-dd for a Date (avoids the UTC shift of toISOString). */
function toLocalDateStr(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Add `n` days to a yyyy-mm-dd string, returning yyyy-mm-dd (local). */
function addDaysStr(dateStr: string, n: number): string {
  const dt = new Date(dateStr + "T00:00:00");
  dt.setDate(dt.getDate() + n);
  return toLocalDateStr(dt);
}

type ForwardedRange = "96h" | "7d" | "custom";

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
  /** Special meals split by audience (from each order's roster; entries with no
   *  audience default to Passenger). `specialPax + specialCrew === specialMeals`. */
  specialPax: number;
  specialCrew: number;
  orders: FlightOrderRow[];
};

/**
 * Split a flight order's special meals into passenger vs crew. When a per-person
 * roster is present it's the source of truth (each entry's `audience`, default
 * Passenger); otherwise the whole `specialMeals` count is treated as passenger
 * specials (crew specials only ever come in via an audience-tagged roster).
 */
function splitSpecialMeals(o: FlightOrderRow): { pax: number; crew: number } {
  const roster = o.specialMealRoster;
  if (roster && roster.length > 0) {
    let crew = 0;
    for (const e of roster) if (e.audience === "Crew") crew++;
    return { pax: roster.length - crew, crew };
  }
  return { pax: o.specialMeals, crew: 0 };
}

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
        day, flightType, flights: 0, passengers: 0, crew: 0, specialMeals: 0,
        specialPax: 0, specialCrew: 0, orders: [],
      });
    }
    const r = map.get(key)!;
    const sp = splitSpecialMeals(o);
    r.flights += 1;
    r.passengers += o.pax;
    r.crew += o.crew;
    r.specialMeals += o.specialMeals;
    r.specialPax += sp.pax;
    r.specialCrew += sp.crew;
    r.orders.push(o);
  }
  return Array.from(map.values()).sort((a, b) => {
    const dayDiff = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
    if (dayDiff !== 0) return dayDiff;
    return a.flightType.localeCompare(b.flightType);
  });
}

// ── Order → Menu Planning → Production link ──────────────────────────────────
// A produced item's required quantity is a function of the menu plan (which
// audience gets it, at what choice %) and the flight orders (pax / crew /
// special-meal counts). Resolving an item back to its menu-plan spec lets us
// RECOMPUTE the required qty whenever an order changes (e.g. an LMC), instead of
// asking the planner to guess a new number.
type MenuSpec = { flightTypes: string[]; forType: string; kind: "Choice" | "Special"; percentage?: number };
function menuSpecFor(name: string, dayOfWeek: string, cards: MealCard[]): MenuSpec | null {
  const scan = (cs: MealCard[]): MenuSpec | null => {
    for (const card of cs) {
      for (const ch of card.choices) {
        if (ch.items.some((it) => it.name === name))
          return { flightTypes: card.flightType, forType: card.forType, kind: "Choice", percentage: ch.percentage };
      }
      for (const sp of card.specialMeals) {
        if (sp.enabled && sp.items.some((it) => it.name === name))
          return { flightTypes: card.flightType, forType: card.forType, kind: "Special" };
      }
      if (card.dessert.name === name)
        return { flightTypes: card.flightType, forType: card.forType, kind: "Choice", percentage: 100 };
    }
    return null;
  };
  // Prefer the card for this weekday; fall back to any card carrying the item.
  return scan(cards.filter((c) => c.day === dayOfWeek)) ?? scan(cards);
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

// ─── Dispatch Timeline (read-only add-on for production order detail) ─────────
// Minimal compatible types — avoids cross-importing from dispatch.tsx.
type _PkgRow = { id: string; flight: string; productionOrderId?: string; dspRef?: string; packagingStatus: string };
type _DspRow = { id: string; date: string; flightNos: string[]; status: string; dispatch_type?: string; dispatch_sequence?: number };

function DispatchTimeline({ productionOrderId }: { productionOrderId: string }) {
  const [pkgRows]  = usePersistedState<_PkgRow[]>("dispatch-packaging-rows", []);
  const [dspRows]  = usePersistedState<_DspRow[]>("dispatch-records", []);
  const navigate   = useNavigate();

  const related = useMemo(() => {
    const matchedPkg = pkgRows.filter((r) => r.productionOrderId === productionOrderId);
    const dspIds     = new Set(matchedPkg.map((r) => r.dspRef).filter(Boolean) as string[]);
    return dspRows.filter((d) => dspIds.has(d.id));
  }, [pkgRows, dspRows, productionOrderId]);

  if (related.length === 0) return null;

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Dispatch History
      </div>
      <div className="space-y-2">
        {related.map((d) => {
          const isDelay = d.dispatch_type === "Delay Refreshment";
          return (
            <div
              key={d.id}
              className={cn(
                "flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm",
                isDelay ? "border-amber-200 bg-amber-50" : "border-border bg-muted/20",
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  isDelay ? "bg-amber-500" : "bg-primary",
                )} />
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold">{d.id}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {isDelay ? "Delay Refreshment" : "Production"} · {d.date}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn(
                  "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                  d.status === "Dispatched" ? "bg-emerald-100 text-emerald-700"
                  : d.status === "Ready For Dispatch" ? "bg-violet-100 text-violet-700"
                  : "bg-amber-100 text-amber-700",
                )}>
                  {d.status}
                </span>
                <button
                  className="text-[10px] text-primary underline underline-offset-2 hover:no-underline"
                  onClick={() => navigate("/dispatch")}
                >
                  View
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground break-words">{value}</div>
    </div>
  );
}

function ProductionEntryRowMenu({ entry }: { entry: WfProductionEntry }) {
  const navigate = useNavigate();
  const [viewOpen, setViewOpen] = useState(false);
  const [prDetail, setPrDetail] = useState<PurchaseRequisition | null>(null);
  const [grnDetail, setGrnDetail] = useState<WfGRN | null>(null);
  const { grns, updateProductionEntryStatus, applyStockDeltas } = useWorkflow();
  const prList = getPurchaseRequisitions();

  // Purchase history per material — was it received via a Direct Purchase (a
  // GRN) or procured through a Purchase Requisition (PR)? Resolves to the real
  // GRN / PR record so its id can be shown as a clickable link to a detail modal.
  type PurchaseRef =
    | { source: "Direct Purchase"; kind: "grn"; id: string; grn: WfGRN }
    | { source: "PR Requisition"; kind: "pr"; id: string; pr: PurchaseRequisition };
  const resolvePurchase = (name: string, code: string): PurchaseRef | null => {
    const nameLc = (name ?? "").trim().toLowerCase();
    // Real direct GRN containing the item.
    const directGrn = grns.find((g) => g.direct && g.lines.some((l) => (l.name ?? "").trim().toLowerCase() === nameLc));
    if (directGrn) return { source: "Direct Purchase", kind: "grn", id: directGrn.id, grn: directGrn };
    // Real PR containing the item.
    const pr = prList.find((p) => p.lines.some((l) => l.itemName.trim().toLowerCase() === nameLc));
    if (pr) return { source: "PR Requisition", kind: "pr", id: pr.id, pr };
    // Deterministic fallback — still points at a real record so the id is clickable.
    const h = [...(code || name || "x")].reduce((s, c) => s + c.charCodeAt(0), 0);
    if (h % 3 === 0 && grns.length > 0) {
      const g = grns[h % grns.length];
      return { source: "Direct Purchase", kind: "grn", id: g.id, grn: g };
    }
    if (prList.length > 0) {
      const p = prList[h % prList.length];
      return { source: "PR Requisition", kind: "pr", id: p.id, pr: p };
    }
    return null;
  };

  const stageHint =
    entry.status === "Pending"      ? "Approval handled in Approval Management"
    : entry.status === "Approved"   ? "Will move to In Preparation once any Production Entry is logged"
    : entry.status === "Production Initiation" ? "Available in Production Entry — log a run to start production"
    : entry.status === "In Preparation" ? "Will move to Ready for QC once orderQty is fully produced"
    : entry.status === "Ready for QC"   ? "QC sign-off in Cooking Temp & Sensory"
    : null;

  // Production Initiation is offered for orders not already initiated or finished.
  const canInitiate =
    entry.status !== "Production Initiation" &&
    entry.status !== "Ready for QC" &&
    entry.status !== "Completed";

  const recipe = resolveProductionItem({
    name: entry.outputItemName ?? entry.bom,
    code: entry.outputItemCode,
  });
  const orderQty = entry.orderQty ?? entry.producedQty;
  const remaining = roundQty(Math.max(0, orderQty - entry.producedQty));
  const materials = orderQty > 0
    ? aggregateMaterials([{ id: entry.id, itemCode: recipe.code, itemName: recipe.name, qty: orderQty }])
    : null;
  // Material COGS = Σ (required qty × rate) across every material line. Cost per
  // unit divides by the order qty (the basis the requirements are shown for).
  const lineSum = (rows: { reqQty: number; rate: number }[]) => rows.reduce((s, m) => s + m.reqQty * m.rate, 0);
  const rawTotal = materials ? lineSum(materials.raw) : 0;
  const pkgTotal = materials ? lineSum(materials.pkg) : 0;
  const otherTotal = materials ? lineSum(materials.other) : 0;
  const cogs = rawTotal + pkgTotal + otherTotal;
  const cogsPerUnit = orderQty > 0 ? cogs / orderQty : 0;
  const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onClick={() => setViewOpen(true)}>
            <Eye className="h-4 w-4 mr-2" /> View
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toast.info(`Editing ${entry.id}`)}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </DropdownMenuItem>

          {canInitiate && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  if (entry.status === "Re-Cook") {
                    // Re-Cook restart: reset production progress to zero and route
                    // the order back through approval (status "Pending"), tagged as
                    // a Re-Cook. The QC-failure context (reason / by / at) is kept so
                    // it shows in the Approval Management detail view. On approval the
                    // order becomes "Approved" and available for a fresh entry run.
                    //
                    // The failed batch was posted INTO stock at QC fail (blocked
                    // goods). Re-initiating pulls that food back into the kitchen,
                    // so the ledger must give it up again — otherwise stock counts
                    // the failed batch AND the re-cooked one. Wastage disposal is
                    // the other exit; it posts its own OUT on Final Approval.
                    if (entry.inventoryAdded && entry.producedQty > 0) {
                      applyStockDeltas([{
                        itemId: entry.outputItemName ?? entry.bom,
                        delta: -entry.producedQty,
                        date: new Date().toISOString().slice(0, 10),
                        reference: entry.id,
                        officeId: entry.officeId,
                        warehouseId: entry.warehouseId,
                        label: "Re-Cook Withdrawal",
                      }]);
                    }
                    updateProductionEntryStatus(entry.id, "Pending", {
                      producedQty: 0,
                      reCook: true,
                      reCookFailedQty: entry.producedQty,
                      qcPassedAt: undefined,
                      qcCheckedBy: undefined,
                      qcLogId: undefined,
                      completedAt: undefined,
                      inventoryAdded: undefined,
                    });
                    toast.success(`${entry.id} sent to Approval Management (Production) as a Re-Cook re-initiation. It becomes available for entry once approved.`);
                  } else {
                    updateProductionEntryStatus(entry.id, "Production Initiation");
                    toast.success(`${entry.id} moved to Production Initiation — now available in the Production Entry order list.`);
                  }
                }}
              >
                <Zap className="h-4 w-4 mr-2" /> Production Initiation
              </DropdownMenuItem>
            </>
          )}

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

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <DialogTitle className="font-mono text-base">{entry.id}</DialogTitle>
              <StatusBadge status={entry.status} />
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* Production Information */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Production Information
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Date</div>
                  <div className="mt-0.5 text-sm text-foreground">{entry.date}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Office / Warehouse</div>
                  <div className="mt-0.5 text-sm">
                    <LocationCell officeId={entry.officeId} warehouseId={entry.warehouseId} />
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">BOM</div>
                  <div className="mt-0.5 text-sm text-foreground">{entry.bom || "—"}</div>
                </div>
              </div>
            </div>

            {/* Production Output */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Production Output
              </div>
              <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    {entry.outputItemCode && (
                      <div className="font-mono text-xs text-muted-foreground">{entry.outputItemCode}</div>
                    )}
                    <div className="text-base font-semibold text-foreground mt-0.5">
                      {entry.outputItemName || "—"}
                    </div>
                  </div>
                  <div className="flex gap-6 shrink-0">
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Order Qty</div>
                      <div className="mt-0.5 font-semibold tabular-nums">{orderQty.toLocaleString()}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Produced</div>
                      <div className="mt-0.5 font-semibold tabular-nums">{entry.producedQty.toLocaleString()}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Remaining</div>
                      <div className={cn("mt-0.5 font-semibold tabular-nums", remaining > 0 ? "text-warning" : "text-success")}>
                        {remaining.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Serves Orders — the flight orders whose menu for this date includes
                this run's output item (many-to-many; snapshot at creation). */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Serves Orders {entry.servesOrderNos?.length ? `(${entry.servesOrderNos.length})` : ""}
              </div>
              {entry.servesOrderNos && entry.servesOrderNos.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {entry.servesOrderNos.map((no) => (
                    <button
                      key={no}
                      onClick={() => { setViewOpen(false); navigate(`/order-management?ord=${encodeURIComponent(no)}`); }}
                      className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 font-mono text-xs font-semibold text-primary hover:bg-primary/10"
                      title={`Open ${no} in Order Management`}
                    >
                      {no}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No linked orders — this item isn't on the menu for {entry.date || "this date"}, or the order was created before order-tagging.
                </p>
              )}
            </div>

            {/* Wastage / Damaged Product Disposal log — shown when this production
                order was adjusted by an approved wastage report. */}
            {entry.wastageRef && (
              <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-orange-700 mb-2 flex items-center gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" /> Wastage / Damaged Product Disposal — <span className="font-mono">{entry.wastageRef}</span>
                </div>
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Order Qty</div>
                    <div className="mt-0.5 font-bold tabular-nums">{(entry.orderQty ?? entry.producedQty).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Failed QC</div>
                    <div className="mt-0.5 font-bold tabular-nums text-amber-700">{(entry.failedQcQty ?? 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Disposal</div>
                    <div className="mt-0.5 font-bold tabular-nums text-red-600">−{(entry.disposedQty ?? 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Qty</div>
                    <div className="mt-0.5 font-bold tabular-nums text-emerald-700">{entry.producedQty.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Material Requirements */}
            {materials ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Material Requirements
                </div>
                {(
                  [
                    { label: "Raw Materials",      rows: materials.raw   },
                    { label: "Packaging Materials", rows: materials.pkg   },
                    { label: "Other Consumption",   rows: materials.other },
                  ] as const
                ).map(({ label, rows }) =>
                  rows.length === 0 ? null : (
                    <div key={label} className="mb-4">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                        {label}
                      </div>
                      <div className="border border-border rounded-md overflow-hidden">
                        <Table>
                          <TableHeader className="bg-muted/40">
                            <TableRow>
                              <TableHead className="text-xs uppercase tracking-wider">Item Code</TableHead>
                              <TableHead className="text-xs uppercase tracking-wider">Item Name</TableHead>
                              <TableHead className="text-xs uppercase tracking-wider">UoM</TableHead>
                              <TableHead className="text-xs uppercase tracking-wider text-right">Req. Qty</TableHead>
                              <TableHead className="text-xs uppercase tracking-wider text-right">Rate (৳)</TableHead>
                              <TableHead className="text-xs uppercase tracking-wider text-right">Line Cost (৳)</TableHead>
                              <TableHead className="text-xs uppercase tracking-wider">Purchase Source</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((m) => {
                              const p = resolvePurchase(m.itemName, m.itemCode);
                              const isDirect = p?.source === "Direct Purchase";
                              return (
                              <TableRow key={m.itemCode}>
                                <TableCell className="font-mono text-xs">{m.itemCode}</TableCell>
                                <TableCell className="font-medium">{m.itemName}</TableCell>
                                <TableCell>{m.uom}</TableCell>
                                <TableCell className="text-right tabular-nums">{m.reqQty.toFixed(3)}</TableCell>
                                <TableCell className="text-right tabular-nums text-muted-foreground">{money(m.rate)}</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{money(m.reqQty * m.rate)}</TableCell>
                                <TableCell>
                                  {p ? (
                                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          "text-[10px] font-normal",
                                          isDirect
                                            ? "border-amber-400/50 bg-amber-50 text-amber-700"
                                            : "border-primary/40 bg-primary/5 text-primary",
                                        )}
                                      >
                                        {p.source}
                                      </Badge>
                                      <button
                                        type="button"
                                        onClick={() => (p.kind === "grn" ? setGrnDetail(p.grn) : setPrDetail(p.pr))}
                                        className="font-mono text-xs text-primary hover:underline focus:outline-none focus:underline"
                                        title={`View ${p.id}`}
                                      >
                                        {p.id}
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ),
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-2">
                No material recipe found for this production item.
              </div>
            )}

            {/* Material Cost (COGS) — broken down by material type */}
            {materials && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Material Cost (COGS)
                </div>

                {/* Per-type subtotals */}
                <div className="rounded-md border border-border overflow-hidden mb-3">
                  {([
                    { label: "Raw Materials Total",       value: rawTotal,   show: materials.raw.length > 0 },
                    { label: "Packaging Materials Total", value: pkgTotal,   show: materials.pkg.length > 0 },
                    { label: "Other Consumption Total",   value: otherTotal, show: materials.other.length > 0 },
                  ] as const).filter((r) => r.show).map((r, i) => (
                    <div key={r.label} className={cn("flex items-center justify-between px-4 py-2.5", i > 0 && "border-t border-border")}>
                      <span className="text-sm text-muted-foreground">{r.label}</span>
                      <span className="text-sm font-medium tabular-nums">৳ {money(r.value)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/30">
                    <span className="text-sm font-semibold text-foreground">Total Cost — This Production Order</span>
                    <span className="text-sm font-bold tabular-nums text-foreground">৳ {money(cogs)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total COGS — {orderQty.toLocaleString()} unit{orderQty === 1 ? "" : "s"}</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-primary">৳ {money(cogs)}</div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cost per Unit</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">৳ {money(cogsPerUnit)}</div>
                  </div>
                </div>
              </div>
            )}

            {/* QC Failure Log — shown when batch was sent to Re-Cook */}
            {entry.qcFailedAt && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-destructive mb-3">
                  Failed — Cooking Temp &amp; Sensory Test
                </div>
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 space-y-3">
                  {/* Test date and time */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Date</div>
                      <div className="mt-0.5 text-sm font-medium tabular-nums">{entry.qcFailedAt?.split(" ")[0]}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Time</div>
                      <div className="mt-0.5 text-sm font-medium tabular-nums">{entry.qcFailedAt?.split(" ")[1]}</div>
                    </div>
                  </div>
                  {/* Re-cooking reason */}
                  {entry.qcFailReason && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Re-Cooking Reason</div>
                      <div className="mt-0.5 text-sm text-destructive/90">{entry.qcFailReason}</div>
                    </div>
                  )}
                  {/* Sent to Re-Cook by */}
                  {entry.qcFailedBy && (
                    <div className="border-t border-destructive/20 pt-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Sent to Re-Cook By</div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-[10px] text-muted-foreground">Name</div>
                          <div className="mt-0.5 text-sm font-medium">
                            {entry.qcFailedBy.includes(" (") ? entry.qcFailedBy.split(" (")[0] : entry.qcFailedBy}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">Designation</div>
                          <div className="mt-0.5 text-sm font-medium">
                            {entry.qcFailedBy.includes(" (") ? entry.qcFailedBy.split(" (")[1]?.replace(")", "") : "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">Date</div>
                          <div className="mt-0.5 text-sm tabular-nums">{entry.qcFailedAt?.split(" ")[0]}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">Time</div>
                          <div className="mt-0.5 text-sm tabular-nums">{entry.qcFailedAt?.split(" ")[1]}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Dispatch History — shows both production and delay refreshment dispatches */}
            <DispatchTimeline productionOrderId={entry.id} />
          </div>

          <DialogFooter className="px-6 py-3 border-t border-border bg-muted/20">
            <Button variant="outline" onClick={() => setViewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PR detail — opened from a material's clickable PR id */}
      <Dialog open={!!prDetail} onOpenChange={(o) => { if (!o) setPrDetail(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Purchase Requisition
              {prDetail && <span className="font-mono text-sm text-muted-foreground">— {prDetail.id}</span>}
            </DialogTitle>
          </DialogHeader>
          {prDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Field label="PR No" value={prDetail.id} />
                <Field label="Date" value={prDetail.date} />
                <Field label="Requested By" value={prDetail.requestedBy} />
                <Field label="Required By" value={prDetail.requiredBy} />
                <Field label="Priority" value={prDetail.priority} />
                <Field label="Status" value={prDetail.status} />
                <div className="col-span-2"><Field label="Justification" value={prDetail.justification || "—"} /></div>
              </div>
              <div className="border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Description</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">UoM</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Rate (৳)</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Amount (৳)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {prDetail.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.itemName}</TableCell>
                        <TableCell className="text-muted-foreground">{l.description || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.qty.toLocaleString()}</TableCell>
                        <TableCell>{l.uom}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{money(l.rate)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{money(l.qty * l.rate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-2.5">
                <span className="text-sm font-semibold">Total Estimated</span>
                <span className="text-sm font-bold tabular-nums">৳ {money(prDetail.totalAmount)}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrDetail(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* GRN detail — opened from a material's clickable GRN id (direct receive) */}
      <Dialog open={!!grnDetail} onOpenChange={(o) => { if (!o) setGrnDetail(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Goods Receipt Note
              {grnDetail && <span className="font-mono text-sm text-muted-foreground">— {grnDetail.id}</span>}
            </DialogTitle>
          </DialogHeader>
          {grnDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Field label="GRN No" value={grnDetail.id} />
                <Field label={grnDetail.direct ? "DP Reference" : "PO Reference"} value={grnDetail.poRef} />
                <Field label="Vendor" value={grnDetail.vendor} />
                <Field label="Received By" value={grnDetail.receivedBy} />
                <Field label="Receipt Date" value={grnDetail.grnDate || grnDetail.date} />
                <Field label="Type" value={grnDetail.direct ? "Direct Purchase" : "PO-based"} />
                {grnDetail.challanNo && <Field label="Challan / DO No" value={grnDetail.challanNo} />}
                {grnDetail.invoiceNo && <Field label="Invoice / Bill No" value={grnDetail.invoiceNo} />}
                {grnDetail.vehicleNo && <Field label="Vehicle No" value={grnDetail.vehicleNo} />}
                {grnDetail.note && <div className="col-span-2"><Field label="Note" value={grnDetail.note} /></div>}
              </div>
              <div className="border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">UoM</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Rate (৳)</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">QC Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grnDetail.lines.map((l, i) => (
                      <TableRow key={`${l.itemId}-${i}`}>
                        <TableCell className="font-medium">{l.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.qty.toLocaleString()}</TableCell>
                        <TableCell>{l.uom}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{l.rate != null ? money(l.rate) : "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px] font-normal">{l.qcStatus}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {grnDetail.amount != null && (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-2.5">
                  <span className="text-sm font-semibold">Receipt Value</span>
                  <span className="text-sm font-bold tabular-nums">৳ {money(grnDetail.amount)}</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrnDetail(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type MealOrderConfirmation = {
  timestamp: string;
  totalFlights: number;
  totalMeals: number;
  tomorrowDayName: string;
  dayAfterDayName: string;
  dayAfterDateStr: string;
  validIntl: { bcMeal?: number; ecMeal?: number; chml?: number; vgml?: number; etd?: string; airline?: string; zenLoad?: number; pax?: number; flight?: string; sector?: string }[];
  validDom: { etd?: string; airline?: string; zenLoad?: number; pax?: number; flight?: string; sector?: string }[];
  dayAfterMenu?: {
    intl: { depMealName: string; depChmlName: string; retMealName: string; retVgmlName: string };
    dom: { usbaBreakfastName: string; usbaLunchName: string; aaaBreakfastName: string; aaaLunchName: string; crewSnackName: string; crewLunchName: string; crewDinnerName: string };
  };
};

export default function ProductionEntryPage() {
  useArrivalFlash();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // PRO id deep-linked from Dispatch — used to page-jump + flash the row.
  const flashPro = searchParams.get("pro") ?? undefined;
  const mealOrderConfirmation = (location.state as { mealOrderConfirmation?: MealOrderConfirmation } | null)?.mealOrderConfirmation ?? null;
  const forwardedMeals = (location.state as { forwardedMeals?: MealCard[]; forwardedDay?: string } | null)?.forwardedMeals ?? null;
  const forwardedDay = (location.state as { forwardedDay?: string } | null)?.forwardedDay ?? null;
  useEffect(() => {
    if (mealOrderConfirmation) {
      const shell = document.querySelector(".app-content-shell") as HTMLElement | null;
      if (shell) shell.scrollTop = 0; else window.scrollTo(0, 0);
    }
  }, []);
  const {
    productionEntries, addProductionEntry, updateProductionEntryStatus, mrpRuns,
    demands, addDemands, addMrpRun,
  } = useWorkflow();

  // In-progress batch target correction (LMC "Adjust batch"). adjustReq holds the
  // menu-plan-derived required qty + breakdown so the dialog shows the derivation.
  const [adjustEntry, setAdjustEntry] = useState<NumberedEntry | null>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReq, setAdjustReq] = useState<{ qty: number; breakdown: string } | null>(null);
  // Order whose material requirement-vs-stock breakdown is open.
  const [materialsOrder, setMaterialsOrder] = useState<NumberedEntry | null>(null);
  // Bulk Production Initiation picker — modal open + the set of order ids ticked
  // to initiate (defaults to all approved orders; user can uncheck to leave some
  // pending, and those stay counted in the banner).
  const [initiateOpen, setInitiateOpen] = useState(false);
  const [initiateSel, setInitiateSel] = useState<Set<string>>(new Set());
  // Cumulative log of every bulk-initiation run this session — each run keeps its
  // own timestamp + order snapshot, so "View Details" shows the full history
  // (batch of 10, then batch of 4, …) and the banner can summarise the latest.
  type InitiationRun = { at: string; orders: NumberedEntry[] };
  const [initiationRuns, setInitiationRuns] = useState<InitiationRun[]>([]);
  const [initiatedDetailOpen, setInitiatedDetailOpen] = useState(false);
  // "Total Approved" list — every order that has been approved (still-pending +
  // already-initiated), opened from the clickable count in the banner.
  const [approvedListOpen, setApprovedListOpen] = useState(false);

  // Live stock — the same persisted store the Stock Overview / Production Entry
  // read — so Available matches everywhere in the app.
  const [invItems] = usePersistedState<InventoryItem[]>("inventory-items", inventory);
  const availableFor = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const it of invItems) {
      byKey.set(it.id.toLowerCase(), it.stock);
      byKey.set(it.name.toLowerCase(), it.stock);
    }
    return (code: string, name: string) =>
      byKey.get((code ?? "").toLowerCase()) ?? byKey.get((name ?? "").toLowerCase()) ?? 0;
  }, [invItems]);

  // Materials required to fulfill an order (BOM scaled to order qty) vs stock.
  const orderMaterials = (entry: { id: string; outputItemCode?: string; outputItemName?: string; bom: string; orderQty?: number; producedQty: number }) => {
    const orderQty = entry.orderQty ?? entry.producedQty;
    const { raw, pkg, other } = aggregateMaterials([{
      id: entry.id,
      itemCode: entry.outputItemCode ?? "",
      itemName: entry.outputItemName ?? entry.bom,
      qty: orderQty,
    }]);
    return [...raw, ...pkg, ...other].map((m) => {
      const reqQty = roundQty(m.reqQty);
      const available = availableFor(m.itemCode, m.itemName);
      return { ...m, reqQty, available, short: roundQty(Math.max(0, reqQty - available)) };
    });
  };
  const flightOrders = useFlightOrders();
  const navigate = useNavigate();
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
  const dayAfterComputed = useMemo(() => {
    if (!mealOrderConfirmation) return null;
    const { validIntl, validDom } = mealOrderConfirmation;
    const depMeal = validIntl.reduce((s, r) => s + (r.bcMeal ?? 0) + (r.ecMeal ?? 0), 0);
    const chml = validIntl.reduce((s, r) => s + (r.chml ?? 0), 0);
    const vgml = validIntl.reduce((s, r) => s + (r.vgml ?? 0), 0);
    const usbaRows = validDom.filter((r) => (r.airline ?? "").toLowerCase().includes("bangla"));
    const aaaRows = validDom.filter((r) => (r.airline ?? "").toLowerCase().includes("astra"));
    const usbaZenith = usbaRows.reduce((s, r) => s + (r.zenLoad ?? r.pax ?? 0), 0);
    const usbaPax = usbaRows.reduce((s, r) => s + (r.pax ?? 0), 0);
    const usbaBreakfast = usbaRows.filter((r) => (r.etd ?? "") <= "10:30").reduce((s, r) => s + (r.pax ?? 0), 0);
    const usbaLunch = usbaRows.filter((r) => (r.etd ?? "") > "10:30").reduce((s, r) => s + (r.pax ?? 0), 0);
    const aaaZenith = aaaRows.reduce((s, r) => s + (r.zenLoad ?? r.pax ?? 0), 0);
    const aaaPax = aaaRows.reduce((s, r) => s + (r.pax ?? 0), 0);
    return {
      depMeal, chml, vgml, grandTotal: depMeal + chml + vgml,
      usbaZenith, usbaPax, usbaBreakfast, usbaLunch,
      aaaZenith, aaaPax, totalZenith: usbaZenith + aaaZenith,
    };
  }, [mealOrderConfirmation]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Date-range scope. Default is the next 96 hours (4 days) of upcoming orders.
  // Past dates are viewable for reference only — no creating/ordering allowed.
  const [dateRange, setDateRange] = useState<ForwardedRange>("96h");
  const today = useMemo(() => toLocalDateStr(new Date()), []);
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(addDaysStr(today, 6));
  const visibleForwarded = useMemo(() => {
    if (dateRange === "custom") {
      return forwardedOrders.filter(
        (f) => (!customFrom || f.date >= customFrom) && (!customTo || f.date <= customTo),
      );
    }
    const end = addDaysStr(today, dateRange === "7d" ? 6 : 3); // 96h = today + 3 (4 days)
    return forwardedOrders.filter((f) => f.date >= today && f.date <= end);
  }, [forwardedOrders, dateRange, today, customFrom, customTo]);
  const [selectedForwardedDate, setSelectedForwardedDate] = useState(
    forwardedOrders[0]?.date ?? "",
  );
  // A past date is read-only: it can be opened to inspect what was planned, but
  // no production orders can be created from it.
  const isViewOnly = !!selectedForwardedDate && selectedForwardedDate < today;
  // Keep the selected date valid for the current range — if it falls outside the
  // visible window (range change, or orders advancing), pick the first in-range.
  useEffect(() => {
    if (!visibleForwarded.some((f) => f.date === selectedForwardedDate)) {
      setSelectedForwardedDate(visibleForwarded[0]?.date ?? "");
    }
  }, [visibleForwarded, selectedForwardedDate]);
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
    // Smart tag: which flight orders does this run serve? Only those whose menu
    // for this date actually includes the run's output item. menuSpecFor() tells
    // us the flight type(s) the item is planned for; we then keep every order of
    // that date + flight type. Empty when the item isn't on the day's menu.
    const itemName = entry.outputItemName ?? entry.bom;
    const spec = itemName && entry.date
      ? menuSpecFor(itemName, getDayFromDate(entry.date), loadMealPlanningConfig())
      : null;
    const servesOrderNos = spec
      ? Array.from(new Set(
          flightOrders
            .filter((o) => o.date === entry.date && spec.flightTypes.includes(getFlightTypeFromSector(o.sector)))
            .map((o) => o.orderNo),
        )).sort()
      : [];
    const taggedEntry: ProductionEntry = { ...entry, servesOrderNos };
    // Raising the order does NOT move flight orders to Production — that happens
    // when the run actually starts (Production Initiation, in Production Entry),
    // wired in the workflow store's updateProductionEntryStatus.
    addProductionEntry(taggedEntry);
    logAudit({
      action: "Created production order",
      module: "Production",
      entity: entry.id,
      detail: `${entry.outputItemName ?? entry.bom} · order qty ${entry.orderQty ?? 0}${entry.date ? ` · ${entry.date}` : ""}${servesOrderNos.length ? ` · serves ${servesOrderNos.length} order(s): ${servesOrderNos.join(", ")}` : ""}`,
    });
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
      // Every order resolves to a recipe (curated, BOM master, or synthesized
      // fallback), so no order is skipped and the Demand Request is never empty.
      if (!hasMasterRecipe({ name: o.outputItemName, code: o.outputItemCode, bom: o.bom })) skipped++;
      const recipe = resolveProductionItem({ name: o.outputItemName ?? o.bom, code: o.outputItemCode });
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
      return { ...m, onHand, shortfall: roundQty(Math.max(0, m.reqQty - onHand)) };
    });
    if (tagged.length === 0) return { skippedNoRecipe: skipped };

    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

    // ── 1) Demand Request bundles EVERY material (Pending Approval) ----------
    const drSeq = String(9000 + demands.length + 1).padStart(4, "0");
    const drId = `DR-${drSeq}`;
    const dr: WfDemandRequest = {
      id: drId,
      reference: orders.map((o) => o.id).join(", "),
      requestedBy: "Auto (Menu Plan)",
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
      note: `Auto-generated from bulk meal-plan creation. Covers ${orders.length} production order${orders.length === 1 ? "" : "s"} (${lines.length} with recipes). Lists every material with its in-stock vs shortfall split. Approval does not auto-create an Issue or PR — it stops for review.`,
      source: "Kitchen",
      officeId: "OFF-001",
      warehouseId: "WH-003",
      autoFulfill: false,
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
      runBy: "Auto (Menu Plan)",
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
    // Menu config + weekday resolved once for the smart order-tagging below.
    const menuCards = loadMealPlanningConfig();
    const dow = getDayFromDate(today);
    const created: ProductionEntry[] = [];
    eligible.forEach((item, i) => {
      const qty = item.computedQty ?? 0;
      const seq = String(baseStamp + i).slice(-6);
      const bomMatch = billOfMaterials.find((b) => b.name === item.name);
      // Smart tag: orders of this date whose menu actually includes this item.
      const spec = menuSpecFor(item.name, dow, menuCards);
      const servesOrderNos = spec
        ? Array.from(new Set(
            flightOrders
              .filter((o) => o.date === today && spec.flightTypes.includes(getFlightTypeFromSector(o.sector)))
              .map((o) => o.orderNo),
          )).sort()
        : [];
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
        servesOrderNos,
      };
      addProductionEntry(entry);
      logAudit({
        action: "Created production order",
        module: "Production",
        entity: entry.id,
        detail: `${entry.outputItemName} · order qty ${entry.orderQty ?? 0} · ${entry.date} (from meal plan)`,
      });
      created.push(entry);
    });

    const { dr, skippedNoRecipe } = autoFulfillOrders(created);

    const parts: string[] = [
      `${created.length} Production Order${created.length === 1 ? "" : "s"}`,
    ];
    if (dr) parts.push(`Demand ${dr.id} (pending approval)`);

    if (dr) {
      toast.success(
        `Created: ${parts.join(" · ")}. Review the in-stock vs shortfall items in Demand Orders — approval stops there for now.`,
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

  // ── Short Materials tab ─────────────────────────────────────────────────────
  // The per-order Materials pill answers "is THIS order covered?"; this tab
  // answers "what do we need to procure overall?" — every material summed
  // across all listed production orders vs live stock, shortfalls only.
  const [listTab, setListTab] = useState<"orders" | "short">("orders");
  type CombinedShortMaterial = {
    id: string; itemCode: string; itemName: string; uom: string;
    reqQty: number; available: number; short: number; orders: string[];
  };
  const combinedShortMaterials = useMemo<CombinedShortMaterial[]>(() => {
    const map = new Map<string, { itemCode: string; itemName: string; uom: string; reqQty: number; orders: string[] }>();
    for (const e of entries) {
      for (const m of orderMaterials(e)) {
        const key = (m.itemCode || m.itemName).toLowerCase();
        const g = map.get(key) ?? { itemCode: m.itemCode, itemName: m.itemName, uom: m.uom, reqQty: 0, orders: [] };
        g.reqQty = roundQty(g.reqQty + m.reqQty);
        if (!g.orders.includes(e.id)) g.orders.push(e.id);
        map.set(key, g);
      }
    }
    return [...map.values()]
      .map((g) => {
        const available = availableFor(g.itemCode, g.itemName);
        return { ...g, id: g.itemCode || g.itemName, available, short: roundQty(Math.max(0, g.reqQty - available)) };
      })
      .filter((g) => g.short > 0)
      .sort((a, b) => b.short - a.short);
    // orderMaterials is a plain closure over availableFor — entries + stock are
    // the real inputs of this aggregation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, availableFor]);

  // ── Demand state per short material ─────────────────────────────────────────
  // Re-Cook (and any shortfall) materials get demanded via Demand Requests, but
  // an item with an OPEN demand must wait for that demand to be fulfilled or
  // rejected before it can be demanded again — only never-demanded (or
  // terminally-closed) shortfalls are eligible for a new demand.
  const OPEN_DEMAND_STATUSES = new Set<string>([
    "Pending Approval", "Pending Store Review", "Partially Available",
    "Partially Issued", "Partially Fulfilled", "Escalated to Supply Chain",
  ]);
  type ShortDemandState =
    | { kind: "open"; ref: string; status: string }
    | { kind: "fulfilled"; ref: string }
    | { kind: "rejected"; ref: string }
    | { kind: "none" };
  const demandStateForItem = (itemCode: string, itemName: string): ShortDemandState => {
    const nameKey = itemName.toLowerCase();
    const codeKey = (itemCode ?? "").toLowerCase();
    const matching = demands.filter((d) =>
      d.items.some((it) =>
        it.name.toLowerCase() === nameKey || (codeKey && it.id.toLowerCase() === codeKey)));
    const open = matching.find((d) => OPEN_DEMAND_STATUSES.has(d.status));
    if (open) return { kind: "open", ref: open.id, status: open.status };
    const latest = [...matching].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!latest) return { kind: "none" };
    return latest.status === "Fulfilled"
      ? { kind: "fulfilled", ref: latest.id }
      : { kind: "rejected", ref: latest.id };
  };
  const shortDemandState = useMemo(() => {
    const map = new Map<string, ShortDemandState>();
    for (const m of combinedShortMaterials) map.set(m.id, demandStateForItem(m.itemCode, m.itemName));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedShortMaterials, demands]);
  const canDemandShort = (id: string) => shortDemandState.get(id)?.kind !== "open";

  // Demand-state filter over the Short Materials tab ("Not Demanded" being the
  // actionable set — those are the rows a fresh demand can be raised for).
  const [shortFilter, setShortFilter] = useState<"all" | "none" | "open" | "redemand">("all");
  const shortGroupOf = (id: string): "none" | "open" | "redemand" => {
    const kind = shortDemandState.get(id)?.kind ?? "none";
    return kind === "none" ? "none" : kind === "open" ? "open" : "redemand";
  };
  const shortGroupCounts = useMemo(() => {
    const c = { none: 0, open: 0, redemand: 0 };
    for (const m of combinedShortMaterials) c[shortGroupOf(m.id)]++;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedShortMaterials, shortDemandState]);
  const visibleShortMaterials = shortFilter === "all"
    ? combinedShortMaterials
    : combinedShortMaterials.filter((m) => shortGroupOf(m.id) === shortFilter);

  /** Chip rendering one material's demand state (shared by the Short Materials
   *  tab and the per-order Materials dialog). */
  const DemandStateChip = ({ st }: { st: ShortDemandState }) => {
    if (st.kind === "open") {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 whitespace-nowrap"
          title={`${st.ref} is ${st.status} — no new demand can be sent until it is received or rejected.`}
        >
          <AlertCircle className="h-3 w-3" /> Demanded · {st.ref}
        </span>
      );
    }
    if (st.kind === "rejected") {
      return (
        <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 whitespace-nowrap"
          title={`${st.ref} was rejected — this material can be demanded again.`}>
          Rejected · re-demand
        </span>
      );
    }
    if (st.kind === "fulfilled") {
      return (
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 whitespace-nowrap"
          title={`${st.ref} was fulfilled but the item is short again — it can be demanded again.`}>
          Fulfilled · short again
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-slate-600 whitespace-nowrap"
        title="No demand raised for this shortfall yet.">
        Not Demanded
      </span>
    );
  };

  /** Raise a Demand Request for ONE order's short materials — the Re-Cook path:
   *  a failed batch's re-run needs its materials afresh, so its shortfalls are
   *  demandable straight from the Materials dialog (open demands still block). */
  const raiseDemandForOrderShorts = (order: NumberedEntry, mats: ReturnType<typeof orderMaterials>) => {
    const eligible = mats.filter((m) => m.short > 0 && demandStateForItem(m.itemCode, m.itemName).kind !== "open");
    if (eligible.length === 0) {
      toast.error("Every short material of this order already has an open demand — wait for it to be received or rejected.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const isReCook = order.status === "Re-Cook";
    const drId = `DR-${String(9000 + demands.length + 1).padStart(4, "0")}`;
    const dr: WfDemandRequest = {
      id: drId,
      reference: order.id,
      requestedBy: isReCook ? "Production (Re-Cook)" : "Production (Short Materials)",
      role: "Flight Kitchen Executive",
      date: stamp,
      status: "Pending Approval",
      items: eligible.map<WfDemandItem>((m) => {
        const invRow = inventory.find((i) => i.name.toLowerCase() === m.itemName.toLowerCase());
        return { id: invRow?.id ?? m.itemCode, name: m.itemName, qty: m.short, uom: m.uom };
      }),
      note: isReCook
        ? `Re-Cook of ${order.id} (${order.outputItemName ?? order.bom}) — fresh materials for the re-run. Quantities are the outstanding shortfall vs current stock.`
        : `Raised from ${order.id} (${order.outputItemName ?? order.bom}) Materials view. Quantities are the outstanding shortfall vs current stock.`,
      source: "Kitchen",
      officeId: order.officeId ?? "OFF-001",
      warehouseId: order.warehouseId ?? "WH-003",
      autoFulfill: false,
      reCook: isReCook || undefined,
    };
    addDemands([dr]);
    setMaterialsOrder(null);
    toast.success(`${drId} raised — ${eligible.length} short material${eligible.length === 1 ? "" : "s"} for ${order.id}${isReCook ? " (Re-Cook)" : ""}, pending approval on Demand Requests.`);
  };

  /** Raise ONE Demand Request covering the selected eligible short materials
   *  (qty = outstanding shortfall). Items with an open demand are skipped. */
  const raiseDemandForShorts = (ids: string[], clearSelection: () => void) => {
    const rows = combinedShortMaterials.filter((m) => ids.includes(m.id) && canDemandShort(m.id));
    if (rows.length === 0) {
      toast.error("The selected materials all have an open demand — wait for it to be received or rejected.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const coveredOrders = [...new Set(rows.flatMap((r) => r.orders))];
    const drId = `DR-${String(9000 + demands.length + 1).padStart(4, "0")}`;
    const dr: WfDemandRequest = {
      id: drId,
      reference: coveredOrders.join(", "),
      requestedBy: "Production (Short Materials)",
      role: "Flight Kitchen Executive",
      date: stamp,
      status: "Pending Approval",
      items: rows.map<WfDemandItem>((r) => {
        const invRow = inventory.find((i) => i.name.toLowerCase() === r.itemName.toLowerCase());
        return { id: invRow?.id ?? r.itemCode, name: r.itemName, qty: r.short, uom: r.uom };
      }),
      note: `Raised from Production Order → Short Materials: ${rows.length} shortfall item${rows.length === 1 ? "" : "s"} across ${coveredOrders.length} production order${coveredOrders.length === 1 ? "" : "s"}. Quantities are the outstanding shortfall vs current stock (re-demand after Re-Cook / consumption).`,
      source: "Kitchen",
      officeId: "OFF-001",
      warehouseId: "WH-003",
      autoFulfill: false,
    };
    addDemands([dr]);
    clearSelection();
    toast.success(`${drId} raised for ${rows.length} short material${rows.length === 1 ? "" : "s"} — pending approval on Demand Requests.`);
  };

  const shortMaterialCols: Column<CombinedShortMaterial>[] = [
    { key: "itemCode", header: "Code", render: (r) => <span className="font-mono text-xs">{r.itemCode || "—"}</span> },
    { key: "itemName", header: "Material" },
    { key: "uom", header: "UOM" },
    {
      key: "reqQty", header: "Required (All Orders)", className: "text-right",
      render: (r) => <span className="tabular-nums">{r.reqQty.toLocaleString()}</span>,
    },
    {
      key: "available", header: "Available", className: "text-right",
      render: (r) => <span className="tabular-nums">{r.available.toLocaleString()}</span>,
    },
    {
      key: "short", header: "Shortfall", className: "text-right",
      render: (r) => <span className="tabular-nums font-semibold text-rose-700">{r.short.toLocaleString()}</span>,
    },
    {
      key: "id" as keyof CombinedShortMaterial, header: "Demand Status", sortable: false,
      render: (r) => <DemandStateChip st={shortDemandState.get(r.id) ?? { kind: "none" }} />,
    },
    {
      key: "orders" as keyof CombinedShortMaterial, header: "Needed By", sortable: false,
      render: (r) => {
        const shown = r.orders.slice(0, 2);
        return (
          <div className="flex flex-wrap items-center gap-1" title={`Short across ${r.orders.length} order(s): ${r.orders.join(", ")}`}>
            {shown.map((id) => (
              <span key={id} className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                {id}
              </span>
            ))}
            {r.orders.length > shown.length && (
              <span className="text-[10px] text-muted-foreground">+{r.orders.length - shown.length}</span>
            )}
          </div>
        );
      },
    },
  ];

  // ── Bulk Production Initiation ──────────────────────────────────────────────
  // The same "Production Initiation" action offered per-row (in each row's menu)
  // applied to the whole order in one click, mirroring the batch affordance on
  // Approval Management. Only plain Approved orders are eligible — Re-Cook has a
  // separate re-approval path and later stages are already past initiation, so
  // they're left to the one-by-one menu, which stays available on every row.
  const initiatableEntries = numberedEntries.filter((e) => e.status === "Approved");
  // Open the picker with every approved order preselected.
  const openBulkInitiate = () => {
    if (initiatableEntries.length === 0) return;
    setInitiateSel(new Set(initiatableEntries.map((e) => e.id)));
    setInitiateOpen(true);
  };
  const toggleInitiate = (id: string) =>
    setInitiateSel((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allInitiateSelected =
    initiatableEntries.length > 0 && initiatableEntries.every((e) => initiateSel.has(e.id));
  const toggleInitiateAll = () =>
    setInitiateSel(allInitiateSelected ? new Set() : new Set(initiatableEntries.map((e) => e.id)));
  // Initiate only the ticked orders; the unticked ones stay Approved and remain
  // counted in the banner for a later run.
  const confirmBulkInitiate = () => {
    const targets = initiatableEntries.filter((e) => initiateSel.has(e.id));
    if (targets.length === 0) return;
    for (const e of targets) {
      updateProductionEntryStatus(e.id, "Production Initiation");
    }
    const at = new Date().toISOString().slice(0, 16).replace("T", " ");
    setInitiationRuns((prev) => [...prev, { at, orders: targets }]);
    toast.success(
      `${targets.length} order${targets.length === 1 ? "" : "s"} moved to Production Initiation — now available in the Production Entry order list.`,
    );
    setInitiateOpen(false);
  };
  // Derived initiation summary — latest run for the banner, cumulative counts for
  // the "Total Approved" figure (still-pending + everything already initiated).
  const lastRun = initiationRuns[initiationRuns.length - 1];
  const totalInitiated = initiationRuns.reduce((s, r) => s + r.orders.length, 0);
  const totalApproved = initiatableEntries.length + totalInitiated;
  // Every approved order tagged with whether it's already been initiated. The
  // snapshot orders in `initiationRuns` keep their frozen "Approved" status, so
  // the flag (not e.status) is the source of truth for the display badge.
  const allApprovedList: { entry: NumberedEntry; initiated: boolean }[] = [
    ...initiatableEntries.map((e) => ({ entry: e, initiated: false })),
    ...initiationRuns.flatMap((r) => r.orders.map((e) => ({ entry: e, initiated: true }))),
  ];

  // ── Row-level LMC awareness ─────────────────────────────────────────────────
  // Production is planned at the aggregate meal-item level (no per-flight qty
  // link), so we can't recompute a specific order from a pax change. Instead we
  // flag production rows whose DATE had a quantity-affecting last-minute change
  // today and, per row status, surface the right VARIANCE action — never editing
  // a completed order's produced figure.
  const lmcByDate = useMemo(() => {
    const orderById = new Map(flightOrders.map((o) => [o.id, o]));
    const todayIso = new Date().toISOString().slice(0, 10);
    const map = new Map<string, { count: number; critical: number; netPax: number; samples: string[] }>();
    for (const a of getAllAmendments()) {
      if (!a.isLmc || a.at.slice(0, 10) !== todayIso) continue;
      const paxCh = a.changes.find((c) => c.field === "pax");
      const spCh = a.changes.find((c) => c.field === "specialMeals");
      if (!paxCh && !spCh) continue; // only quantity-affecting changes hit production
      const order = orderById.get(a.orderId);
      if (!order?.date) continue;
      const delta = paxCh ? Number(paxCh.to) - Number(paxCh.from) : 0;
      const e = map.get(order.date) ?? { count: 0, critical: 0, netPax: 0, samples: [] };
      e.count++;
      if (a.severity === "critical") e.critical++;
      e.netPax += delta;
      if (e.samples.length < 4) e.samples.push(`${order.flight} ${paxCh ? `PAX ${paxCh.from}→${paxCh.to}` : `SPML ${spCh?.from}→${spCh?.to}`}`);
      map.set(order.date, e);
    }
    return map;
  }, [flightOrders]);

  // Recompute an item's REQUIRED production qty from the current (LMC-updated)
  // flight orders × its menu-plan spec. This is the Order → Menu Planning →
  // Production connection: change PAX/special-meals on an order and this returns
  // the new quantity that should be produced, with a human-readable breakdown.
  const computeRequiredQty = (entry: NumberedEntry): { qty: number; breakdown: string } | null => {
    const name = entry.outputItemName;
    if (!name) return null;
    const cards = loadMealPlanningConfig();
    const spec = menuSpecFor(name, getDayFromDate(entry.date), cards);
    if (!spec) return null;
    // Date-specific aggregation: only THIS date's orders on matching flight
    // types feed this production date's requirement (not a weekday roll-up).
    const dayOrders = flightOrders.filter(
      (o) => o.date === entry.date && spec.flightTypes.includes(getFlightTypeFromSector(o.sector)),
    );
    if (dayOrders.length === 0) return null;
    const isCrew = spec.forType.toLowerCase().includes("crew");
    if (spec.kind === "Special") {
      const spc = dayOrders.reduce((s, o) => s + o.specialMeals, 0);
      return { qty: spc, breakdown: `${spc} special meal${spc === 1 ? "" : "s"} on ${entry.date}` };
    }
    const audience = dayOrders.reduce((s, o) => s + (isCrew ? o.crew : o.pax), 0);
    const pct = spec.percentage ?? 100;
    const qty = Math.round((audience * pct) / 100);
    return { qty, breakdown: `${audience} ${isCrew ? "crew" : "pax"} × ${pct}% = ${qty} (${entry.date})` };
  };

  // Open the adjust dialog pre-filled with the menu-plan-derived required qty.
  const openAdjust = (r: NumberedEntry, req: { qty: number; breakdown: string } | null) => {
    setAdjustEntry(r);
    setAdjustReq(req);
    setAdjustQty(String(req?.qty ?? r.orderQty ?? r.producedQty));
  };

  // Shortfall after completion → a fresh supplementary (top-up) order for the
  // delta; the original completed order is left untouched (as-produced record).
  const raiseTopUp = (r: NumberedEntry, delta: number) => {
    const qty = Math.max(1, Math.round(delta));
    const topUpId = `PRO-LMC-${Date.now().toString(36).slice(-5).toUpperCase()}`;
    addProductionEntry({
      id: topUpId,
      date: r.date,
      bom: r.bom,
      outputItemName: r.outputItemName,
      outputItemCode: r.outputItemCode,
      orderQty: qty,
      producedQty: 0,
      status: "Pending",
      officeId: r.officeId,
      warehouseId: r.warehouseId,
    });
    logAudit({
      action: "Raised top-up production order",
      module: "Production",
      entity: topUpId,
      detail: `${qty} × ${r.outputItemName ?? "item"} (LMC shortfall vs ${r.id})`,
    });
    toast.success(`Top-up order raised — ${qty} × ${r.outputItemName ?? "item"} (LMC shortfall). Original order untouched.`);
  };
  // In-progress order → correct the target quantity. Legitimate because it's not
  // finished: already-produced units are kept, Remaining recalculates from the
  // new target. Status is preserved.
  const saveAdjust = () => {
    if (!adjustEntry) return;
    const n = Math.round(Number(adjustQty));
    if (!Number.isFinite(n) || n <= 0) { toast.error("Enter a valid target quantity."); return; }
    updateProductionEntryStatus(adjustEntry.id, adjustEntry.status, { orderQty: n });
    toast.success(`${adjustEntry.id} target set to ${n.toLocaleString()} — remaining recalculated (${adjustEntry.producedQty.toLocaleString()} already produced).`);
    setAdjustEntry(null);
    setAdjustReq(null);
  };

  const cols: Column<NumberedEntry>[] = [
    {
      key: "__sl",
      header: "SL",
      sortable: false,
      className: "w-12 text-center",
      render: (r) => <span className="tabular-nums">{r.__sl}</span>,
    },
    {
      key: "id", header: "Order No",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span>{r.id}</span>
          {r.wastageRef && (
            <span
              className="inline-flex items-center gap-0.5 rounded border border-orange-300 bg-orange-50 px-1 h-4 text-[9px] font-bold uppercase tracking-wider text-orange-700"
              title={`Wastage-adjusted — disposal report ${r.wastageRef}. Produced Qty reflects the remaining (current) quantity.`}
            >
              <Trash2 className="h-2.5 w-2.5" /> Wastage
            </span>
          )}
        </span>
      ),
    },
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
      key: "id" as keyof NumberedEntry,
      header: "Serves Orders",
      sortable: false,
      render: (r) => {
        const orders = r.servesOrderNos ?? [];
        if (orders.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
        const shown = orders.slice(0, 2);
        return (
          <div className="flex flex-wrap items-center gap-1" title={`Serves ${orders.length} order(s): ${orders.join(", ")}`}>
            {shown.map((no) => (
              <button
                key={no}
                onClick={(e) => { e.stopPropagation(); navigate(`/order-management?ord=${encodeURIComponent(no)}`); }}
                className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary hover:bg-primary/10"
              >
                {no}
              </button>
            ))}
            {orders.length > shown.length && (
              <span className="text-[10px] text-muted-foreground">+{orders.length - shown.length}</span>
            )}
          </div>
        );
      },
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
        const remaining = roundQty(Math.max(0, order - r.producedQty));
        return (
          <span className={`tabular-nums ${remaining > 0 ? "text-warning font-medium" : "text-success"}`}>
            {remaining.toLocaleString()}
          </span>
        );
      },
    },
    {
      key: "bom" as keyof NumberedEntry,
      header: "Materials",
      sortable: false,
      className: "text-center",
      render: (r) => {
        const mats = orderMaterials(r);
        if (mats.length === 0) return <span className="text-muted-foreground">—</span>;
        const shortCount = mats.filter((m) => m.short > 0).length;
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMaterialsOrder(r); }}
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 h-6 text-[11px] font-medium transition hover:brightness-95",
              shortCount > 0
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700",
            )}
            title="View materials required to fulfill this order vs current stock"
          >
            <Package className="h-3 w-3 shrink-0" />
            <span className="whitespace-nowrap">{mats.length} items · {shortCount > 0 ? `${shortCount} short` : "all ok"}</span>
            <ArrowRight className="h-3 w-3 shrink-0 opacity-60" />
          </button>
        );
      },
    },
    { key: "status", header: "Status", render: (r) => (
      <ReviewStatusCell category="Production Order" refId={r.id}>
        <StatusBadge status={r.status} />
      </ReviewStatusCell>
    ) },
    {
      key: "date" as keyof NumberedEntry,
      header: "LMC / Variance",
      sortable: false,
      render: (r) => {
        const flag = lmcByDate.get(r.date);
        if (!flag) return <span className="text-muted-foreground">—</span>;
        // Precise, per-item required qty from menu plan × current orders.
        const req = computeRequiredQty(r);
        const currentTarget = r.orderQty ?? r.producedQty;
        const fullyMade = r.status === "Completed" || r.status === "Ready for QC";
        const tip = req
          ? `Menu plan now requires ${req.qty} (${req.breakdown}). Current target ${currentTarget}, produced ${r.producedQty}.`
          : `${flag.count} last-minute change${flag.count > 1 ? "s" : ""} on ${r.date} — item not in the menu plan, review manually.`;
        return (
          <div className="flex items-center gap-1.5" title={tip}>
            <span className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-1.5 h-5 text-[10px] font-bold uppercase tracking-wider text-rose-700">
              <AlertCircle className="h-3 w-3" /> LMC
            </span>
            {req == null ? (
              <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => navigate("/order-management?lmc=1")}>Review →</button>
            ) : fullyMade ? (
              req.qty < r.producedQty ? (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700"
                  title={`Produced ${r.producedQty}, now required ${req.qty} — ${r.producedQty - req.qty} surplus. Reallocate or hold; not auto-wasted.`}
                >
                  <AlertCircle className="h-3 w-3" /> {roundQty(r.producedQty - req.qty)} surplus
                </span>
              ) : req.qty > r.producedQty ? (
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] border-sky-300 text-sky-700 hover:bg-sky-50" onClick={() => raiseTopUp(r, req.qty - r.producedQty)}>
                  <Plus className="h-3 w-3 mr-1" /> Raise top-up ({roundQty(req.qty - r.producedQty)})
                </Button>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600"><CheckCircle2 className="h-3 w-3" /> In sync</span>
              )
            ) : req.qty !== currentTarget ? (
              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] border-violet-300 text-violet-700 hover:bg-violet-50" onClick={() => openAdjust(r, req)}>
                <Flame className="h-3 w-3 mr-1" /> Recompute → {req.qty}
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600"><CheckCircle2 className="h-3 w-3" /> In sync</span>
            )}
          </div>
        );
      },
    },
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

      {(() => {
        // LMC awareness: planned production is derived from flight-order pax /
        // special-meal counts, so a last-minute change today may invalidate it.
        // Production is planned at the aggregate meal-item level (no per-flight
        // qty link), so we surface a review prompt rather than auto-recompute.
        const todayIso = new Date().toISOString().slice(0, 10);
        const lmcToday = getAllAmendments().filter((a) => a.isLmc && a.at.slice(0, 10) === todayIso);
        if (lmcToday.length === 0) return null;
        const critical = lmcToday.filter((a) => a.severity === "critical").length;
        return (
          <Link
            to="/order-management?lmc=1"
            className="mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 no-underline"
            style={{
              borderColor: critical > 0 ? "#fda4af" : "#fcd34d",
              background: critical > 0 ? "#fff1f2" : "#fffbeb",
              color: "inherit",
            }}
          >
            <AlertCircle className="h-5 w-5 flex-shrink-0" style={{ color: critical > 0 ? "#e11d48" : "#b45309" }} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold" style={{ color: "#1a0204" }}>
                {lmcToday.length} last-minute change{lmcToday.length === 1 ? "" : "s"} today may affect planned production
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {critical} critical — review affected orders and re-check today's production quantities
              </div>
            </div>
            <span className="text-xs font-semibold shrink-0" style={{ color: "#6d28d9" }}>Review →</span>
          </Link>
        );
      })()}

      {view === "list" ? (
        <>
          {mealOrderConfirmation ? (
            <>
              {/* Green banner — Meal Order for 24 Hours generated */}
              <div className="mb-4 rounded-lg border border-success/40 bg-success/5 px-4 py-3 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    Meal Order for Next 24 Hours ({mealOrderConfirmation.tomorrowDayName}) has been generated
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Business Analyst · {mealOrderConfirmation.timestamp} · {mealOrderConfirmation.totalFlights} flight{mealOrderConfirmation.totalFlights !== 1 ? "s" : ""} · {mealOrderConfirmation.totalMeals.toLocaleString()} meals
                  </p>
                </div>
                <Button
                  className="bg-success text-success-foreground hover:bg-success/90 shrink-0"
                  size="sm"
                  onClick={() => setDetailsOpen(true)}
                >
                  View Details
                </Button>
              </div>
              {/* Amber blinking banner — Day After Tomorrow */}
              <div
                className="mb-6 rounded-lg border border-amber-300 p-4"
                style={{ animation: "amber-banner-blink 2s ease-in-out infinite" }}
              >
                <style>{`@keyframes amber-banner-blink { 0%, 100% { background-color: rgb(255 251 235); } 50% { background-color: rgb(254 240 138); } }`}</style>
                <div className="flex items-start gap-4 flex-wrap mb-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="relative flex-shrink-0 h-3 w-3 mt-0.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-amber-900">
                        Meal Order — Day After Tomorrow ({mealOrderConfirmation.dayAfterDayName}, {mealOrderConfirmation.dayAfterDateStr})
                      </div>
                      <div className="text-xs text-amber-700 mt-0.5">
                        Draft ready · Order Meal will be available after current 24 hours pass
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="rounded-lg border border-navy/20 bg-navy/5 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-navy">International</h4>
                      <Button variant="outline" size="sm" className="text-xs">Edit Menu</Button>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Departure</div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Departure Meal</span>
                        <span className="font-medium tabular-nums">{dayAfterComputed?.depMeal ?? 0}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Departure CHML</span>
                        <span className="font-medium tabular-nums">{dayAfterComputed?.chml ?? 0}</span>
                      </div>
                      <div className="flex justify-between text-sm font-semibold border-t border-navy/20 pt-1">
                        <span>Departure Total</span>
                        <span className="tabular-nums">{(dayAfterComputed?.depMeal ?? 0) + (dayAfterComputed?.chml ?? 0)}</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Return</div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Return VGML</span>
                        <span className="font-medium tabular-nums">{dayAfterComputed?.vgml ?? 0}</span>
                      </div>
                      <div className="flex justify-between text-sm font-semibold border-t border-navy/20 pt-1">
                        <span>Return Total</span>
                        <span className="tabular-nums">{dayAfterComputed?.vgml ?? 0}</span>
                      </div>
                    </div>
                    <div className="flex justify-between text-sm font-bold border-t-2 border-navy/30 pt-2 mt-1">
                      <span>Total Meal (Departure+Return)</span>
                      <span className="tabular-nums">{dayAfterComputed?.grandTotal ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-sm pt-2 border-t border-navy/10 mt-1">
                      <span className="text-muted-foreground">Total Passenger Meal</span>
                      <span className="font-medium tabular-nums">{(dayAfterComputed?.grandTotal ?? 0) + (dayAfterComputed?.usbaBreakfast ?? 0) + (dayAfterComputed?.usbaLunch ?? 0) + (dayAfterComputed?.aaaPax ?? 0)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Crew Meal</span>
                      <span className="font-medium tabular-nums">0</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">Domestic</h4>
                      <Button variant="outline" size="sm" className="text-xs">Edit Menu</Button>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">US-Bangla</div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Zenith Load</span>
                        <span className="font-medium tabular-nums">{dayAfterComputed?.usbaZenith ?? 0}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Pax Load</span>
                        <span className="font-medium tabular-nums">{dayAfterComputed?.usbaPax ?? 0}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Breakfast</span>
                        <span className="font-medium tabular-nums">{dayAfterComputed?.usbaBreakfast ?? 0}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Lunch</span>
                        <span className="font-medium tabular-nums">{dayAfterComputed?.usbaLunch ?? 0}</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Air Astra</div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Zenith Load</span>
                        <span className="font-medium tabular-nums">{dayAfterComputed?.aaaZenith ?? 0}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Pax Load</span>
                        <span className="font-medium tabular-nums">{dayAfterComputed?.aaaPax ?? 0}</span>
                      </div>
                    </div>
                    <div className="flex justify-between text-sm font-semibold border-t border-primary/20 pt-2">
                      <span>Total Zenith (USBA + Air Astra)</span>
                      <span className="tabular-nums">{dayAfterComputed?.totalZenith ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-sm pt-2 border-t border-primary/10 mt-1">
                      <span className="text-muted-foreground">Total Passenger Meal</span>
                      <span className="font-medium tabular-nums">{(dayAfterComputed?.grandTotal ?? 0) + (dayAfterComputed?.usbaBreakfast ?? 0) + (dayAfterComputed?.usbaLunch ?? 0) + (dayAfterComputed?.aaaPax ?? 0)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Crew Meal</span>
                      <span className="font-medium tabular-nums">0</span>
                    </div>
                  </div>
                </div>
                {forwardedMeals && (
                  <div className="mt-4 border-t border-amber-200 pt-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-amber-900 mb-3">
                      Configured Menu Plan — {forwardedDay}
                    </div>
                    {forwardedMeals.length === 0 ? (
                      <div className="text-xs text-amber-700 italic">No meals configured for this day</div>
                    ) : (
                      <div className="space-y-3">
                        {["Breakfast","Lunch","Snacks","Heavy Snacks","Dinner"].map((mealType) => {
                          const mealsForType = forwardedMeals.filter((m) => m.mealType === mealType);
                          if (mealsForType.length === 0) return null;
                          return (
                            <div key={mealType} className="rounded border border-amber-200 bg-amber-50/60 overflow-hidden">
                              <div className="px-3 py-1.5 bg-amber-100 text-xs font-semibold text-amber-900 flex gap-3">
                                <span>{mealType}</span>
                                <span className="font-normal text-amber-700">{mealsForType[0].servingTime.start} – {mealsForType[0].servingTime.end}</span>
                              </div>
                              {mealsForType.map((meal) => (
                                <div key={meal.id} className="px-3 py-2 border-t border-amber-100 first:border-t-0">
                                  <div className="flex gap-2 items-center flex-wrap mb-1.5">
                                    <span className="text-xs font-medium text-amber-900">{meal.forType}</span>
                                    {meal.flightType.map((ft) => (
                                      <span key={ft} className="px-1.5 py-0.5 text-[10px] rounded bg-amber-200 text-amber-800">{ft}</span>
                                    ))}
                                  </div>
                                  <div className="flex gap-2 flex-wrap">
                                    {meal.choices.map((c, ci) => (
                                      <div key={ci} className="text-[10px] bg-white border border-amber-200 rounded px-2 py-1 min-w-[120px]">
                                        <div className="font-semibold text-blue-700 mb-0.5">Choice {ci + 1} — {c.percentage}%</div>
                                        {c.items.slice(0, 3).map((it, ii) => <div key={ii} className="text-muted-foreground">{it.name}{it.weight > 0 ? ` – ${it.weight}g` : ""}</div>)}
                                        {c.items.length > 3 && <div className="text-muted-foreground">+{c.items.length - 3} more</div>}
                                      </div>
                                    ))}
                                    {meal.specialMeals.filter((sm) => sm.enabled).map((sm) => (
                                      <div key={sm.type} className="text-[10px] bg-white border border-purple-200 rounded px-2 py-1 min-w-[120px]">
                                        <div className="font-semibold text-purple-700 mb-0.5">{sm.type}</div>
                                        {sm.items.slice(0, 2).map((it, ii) => <div key={ii} className="text-muted-foreground">{it.name}</div>)}
                                      </div>
                                    ))}
                                    {meal.dessert.name && (
                                      <div className="text-[10px] bg-white border border-pink-200 rounded px-2 py-1 min-w-[100px]">
                                        <div className="font-semibold text-pink-700 mb-0.5">Dessert</div>
                                        <div className="text-muted-foreground">{meal.dessert.name}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-4 text-[11px] text-amber-700 bg-amber-100/60 rounded px-3 py-2">
                  Tag &amp; Forward to Production for {mealOrderConfirmation.dayAfterDayName} will become available once the current 24-hour window closes.
                </div>
              </div>
            </>
          ) : (
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
                    value={dateRange}
                    onChange={(e) => setDateRange(e.target.value as ForwardedRange)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    title="Date range to show"
                  >
                    <option value="96h">Next 96 hours (4 days)</option>
                    <option value="7d">Next 7 days</option>
                    <option value="custom">Custom range…</option>
                  </select>
                  {dateRange === "custom" && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={customFrom}
                        max={customTo || undefined}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        title="From date"
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <input
                        type="date"
                        value={customTo}
                        min={customFrom || undefined}
                        onChange={(e) => setCustomTo(e.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        title="To date"
                      />
                    </div>
                  )}
                  <select
                    value={selectedForwardedDate}
                    onChange={(e) => setSelectedForwardedDate(e.target.value)}
                    disabled={visibleForwarded.length === 0}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {visibleForwarded.length === 0 ? (
                      <option value="">No dates in this range</option>
                    ) : (
                      visibleForwarded.map((f) => (
                        <option key={f.date} value={f.date}>
                          {f.date} — {f.totalMeals.toLocaleString()} meals
                        </option>
                      ))
                    )}
                  </select>
                  <Button
                    className="bg-success text-success-foreground hover:bg-success/90 shrink-0"
                    size="sm"
                    disabled={!selectedForwardedDate}
                    onClick={() => setDetailsOpen(true)}
                  >
                    View Details
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="mb-4">
            <LocationFilter
              officeId={filterOffice}
              warehouseId={filterWarehouse}
              onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
            />
          </div>

          {/* Bulk Production Initiation — initiate every Approved order at once.
              The per-row menu still offers the same action one order at a time. */}
          {initiatableEntries.length > 0 && (
            <div className="flex items-center justify-between gap-3 mb-3 rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-2">
              <span className="text-xs font-medium text-foreground shrink-0">
                {initiatableEntries.length} approved order{initiatableEntries.length === 1 ? "" : "s"} ready for production initiation
                {totalApproved > 0 && (
                  <>
                    {" "}(Total Approved:{" "}
                    <button
                      type="button"
                      className="font-semibold text-primary underline underline-offset-2 hover:no-underline"
                      onClick={() => setApprovedListOpen(true)}
                      title="View all approved production orders"
                    >
                      {totalApproved}
                    </button>
                    )
                  </>
                )}
              </span>
              {lastRun && (
                <span className="flex-1 min-w-0 text-center text-xs text-muted-foreground truncate">
                  {lastRun.orders.length} Production Order{lastRun.orders.length === 1 ? "" : "s"} {lastRun.orders.length === 1 ? "has" : "have"} been initiated and {initiatableEntries.length} Pending from the latest production order.{" "}
                  <button
                    type="button"
                    className="font-medium text-primary underline underline-offset-2 hover:no-underline"
                    onClick={() => setInitiatedDetailOpen(true)}
                  >
                    View Details
                  </button>
                </span>
              )}
              <Button
                size="sm"
                className="h-7 px-2.5 text-[11px] shrink-0"
                onClick={openBulkInitiate}
              >
                <Zap className="h-3 w-3 mr-1" /> Initiate {initiatableEntries.length}
              </Button>
            </div>
          )}

          {/* Orders list vs the combined material shortfall across all of them */}
          <div className="mb-3 inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setListTab("orders")}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
                listTab === "orders" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Production Orders ({numberedEntries.length})
            </button>
            <button
              type="button"
              onClick={() => setListTab("short")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
                listTab === "short" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <AlertCircle className={cn("h-3.5 w-3.5", combinedShortMaterials.length > 0 ? "text-rose-600" : "text-emerald-600")} />
              Short Materials ({combinedShortMaterials.length})
            </button>
          </div>

          {listTab === "orders" ? (
            <div data-arrival-id="production-list">
              <DataTable
                title="production-entries"
                data={numberedEntries}
                columns={cols}
                searchKeys={["id", "bom", "outputItemName", "status"]}
                selectable={false}
                actions={(r) => <ProductionEntryRowMenu entry={r} />}
                flashRowId={flashPro}
              />
            </div>
          ) : combinedShortMaterials.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 py-16 text-center">
              <Package className="h-9 w-9 text-emerald-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-emerald-700">No short materials</p>
              <p className="text-xs text-muted-foreground mt-1">Stock covers every material required by the listed production orders.</p>
            </div>
          ) : (
            <>
            {/* Demand-state filter — "Not Demanded" is the actionable set */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {([
                ["all", `All (${combinedShortMaterials.length})`],
                ["none", `Not Demanded (${shortGroupCounts.none})`],
                ["open", `Demanded — awaiting outcome (${shortGroupCounts.open})`],
                ["redemand", `Re-demandable (${shortGroupCounts.redemand})`],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setShortFilter(key)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    shortFilter === key
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <DataTable
              title="production-short-materials"
              data={visibleShortMaterials}
              columns={shortMaterialCols}
              searchKeys={["itemCode", "itemName"]}
              selectable
              isRowSelectable={(r) => canDemandShort(r.id)}
              bulkActions={(selectedIds, clearSelection, selectAll, totalRows) => (
                <>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={selectAll}>
                    Select all eligible ({totalRows})
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={selectedIds.length === 0}
                    onClick={() => raiseDemandForShorts(selectedIds, clearSelection)}
                    title="Raise ONE Demand Request for the ticked shortfall materials (items with an open demand cannot be ticked)"
                  >
                    <Zap className="h-3.5 w-3.5 mr-1" /> Raise Demand ({selectedIds.length})
                  </Button>
                </>
              )}
            />
            </>
          )}
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
        readOnly={isViewOnly}
      />

      {/* Bulk Production Initiation picker — tick the orders to begin; the rest
          stay Approved and remain in the banner's pending count. */}
      <Dialog open={initiateOpen} onOpenChange={setInitiateOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Production Initiation
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Tick the production orders to begin. Unticked orders stay Approved and remain available for a later run.
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-9">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary cursor-pointer align-middle"
                        checked={allInitiateSelected}
                        onChange={toggleInitiateAll}
                        aria-label="Select all"
                        title="Select all"
                      />
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Order No</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Production Item</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">Order Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {initiatableEntries.map((e) => (
                    <TableRow
                      key={e.id}
                      className={cn("cursor-pointer hover:bg-muted/30", initiateSel.has(e.id) && "bg-primary/[0.04]")}
                      onClick={() => toggleInitiate(e.id)}
                    >
                      <TableCell onClick={(ev) => ev.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary cursor-pointer align-middle"
                          checked={initiateSel.has(e.id)}
                          onChange={() => toggleInitiate(e.id)}
                          aria-label={`Select ${e.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.id}</TableCell>
                      <TableCell className="text-sm">{e.date}</TableCell>
                      <TableCell className="text-sm">
                        {e.outputItemCode && (
                          <span className="font-mono text-xs text-muted-foreground mr-1">{e.outputItemCode}</span>
                        )}
                        {e.outputItemName ?? e.bom}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{(e.orderQty ?? e.producedQty).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter className="px-6 py-3 border-t border-border bg-muted/20 sm:justify-between items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {initiateSel.size} of {initiatableEntries.length} selected
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setInitiateOpen(false)}>Cancel</Button>
              <Button onClick={confirmBulkInitiate} disabled={initiateSel.size === 0}>
                <Zap className="h-4 w-4 mr-1.5" /> Initiate {initiateSel.size}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Initiated orders — full session log, one group per initiation run, each
          stamped with its initiation time (batch of 10, then batch of 4, …). */}
      <Dialog open={initiatedDetailOpen} onOpenChange={setInitiatedDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Initiated Production Orders
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {totalInitiated} order{totalInitiated === 1 ? "" : "s"} moved to Production Initiation across {initiationRuns.length} run{initiationRuns.length === 1 ? "" : "s"}.
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {initiationRuns.map((run, ri) => (
              <div key={ri}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Initiation #{ri + 1} · {run.orders.length} order{run.orders.length === 1 ? "" : "s"}
                  </div>
                  <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span className="tabular-nums">{run.at}</span>
                  </div>
                </div>
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs uppercase tracking-wider">Order No</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Production Item</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Order Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {run.orders.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="font-mono text-xs">{e.id}</TableCell>
                          <TableCell className="text-sm">{e.date}</TableCell>
                          <TableCell className="text-sm">
                            {e.outputItemCode && (
                              <span className="font-mono text-xs text-muted-foreground mr-1">{e.outputItemCode}</span>
                            )}
                            {e.outputItemName ?? e.bom}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{(e.orderQty ?? e.producedQty).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter className="px-6 py-3 border-t border-border bg-muted/20">
            <Button variant="outline" onClick={() => setInitiatedDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Total Approved — every order that has been approved: still-pending plus
          all already-initiated. Opened from the clickable count in the banner. */}
      <Dialog open={approvedListOpen} onOpenChange={setApprovedListOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Approved Production Orders
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {totalApproved} approved · {initiatableEntries.length} pending initiation · {totalInitiated} already initiated.
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wider">Order No</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Production Item</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">Order Qty</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allApprovedList.map(({ entry: e, initiated }) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{e.id}</TableCell>
                      <TableCell className="text-sm">{e.date}</TableCell>
                      <TableCell className="text-sm">
                        {e.outputItemCode && (
                          <span className="font-mono text-xs text-muted-foreground mr-1">{e.outputItemCode}</span>
                        )}
                        {e.outputItemName ?? e.bom}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{(e.orderQty ?? e.producedQty).toLocaleString()}</TableCell>
                      <TableCell>
                        <StatusBadge status={initiated ? "Production Initiation" : "Approved"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter className="px-6 py-3 border-t border-border bg-muted/20">
            <Button variant="outline" onClick={() => setApprovedListOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Materials — requirement (BOM × order qty) vs current stock, per order. */}
      <Dialog open={!!materialsOrder} onOpenChange={(o) => { if (!o) setMaterialsOrder(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Materials to Fulfil Order
            </DialogTitle>
          </DialogHeader>
          {materialsOrder && (() => {
            const mats = orderMaterials(materialsOrder);
            const orderQty = materialsOrder.orderQty ?? materialsOrder.producedQty;
            const shortCount = mats.filter((m) => m.short > 0).length;
            const isReCook = materialsOrder.status === "Re-Cook";
            const eligibleShorts = mats.filter((m) => m.short > 0 && demandStateForItem(m.itemCode, m.itemName).kind !== "open");
            return (
              <div className="space-y-4">
                <div className="rounded-md border border-border bg-muted/20 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Order</div>
                    <div className="mt-0.5 font-semibold text-foreground flex items-center gap-2">
                      {materialsOrder.outputItemName ?? materialsOrder.bom}
                      {isReCook && (
                        <span className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-1.5 h-5 text-[10px] font-bold uppercase tracking-wider text-rose-700">
                          <Flame className="h-3 w-3" /> Re-Cook
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      <span className="font-mono text-primary">{materialsOrder.id}</span> · Order Qty {orderQty.toLocaleString()}
                    </div>
                  </div>
                  <div className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 h-7 text-xs font-medium",
                    shortCount > 0
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700",
                  )}>
                    {shortCount > 0
                      ? <><AlertCircle className="h-3.5 w-3.5" /> {shortCount} of {mats.length} short</>
                      : <><CheckCircle2 className="h-3.5 w-3.5" /> All {mats.length} materials in stock</>}
                  </div>
                </div>

                {isReCook && shortCount > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
                    <Flame className="h-3.5 w-3.5 inline-block mr-1.5 -mt-0.5" />
                    The re-run consumes these materials afresh — raise a new demand for the short items below.
                    Items already covered by an open demand stay blocked until that demand is received or rejected.
                  </div>
                )}

                {mats.length === 0 ? (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                    <AlertCircle className="h-4 w-4 inline-block mr-1.5" />
                    No BOM materials registered for this output item.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[48px]">SL</TableHead>
                          <TableHead>Item Code</TableHead>
                          <TableHead>Item Name</TableHead>
                          <TableHead>UoM</TableHead>
                          <TableHead className="text-right">Required Qty</TableHead>
                          <TableHead className="text-right">Available Qty</TableHead>
                          <TableHead className="text-right">Shortfall</TableHead>
                          <TableHead>Demand</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mats.map((m, i) => (
                          <TableRow key={`${m.itemCode}-${i}`} className={m.short > 0 ? "bg-rose-50/40" : undefined}>
                            <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-mono text-xs">{m.itemCode}</TableCell>
                            <TableCell>{m.itemName}</TableCell>
                            <TableCell>{m.uom}</TableCell>
                            <TableCell className="text-right tabular-nums">{roundQty(m.reqQty)}</TableCell>
                            <TableCell className="text-right tabular-nums">{roundQty(m.available)}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {m.short > 0
                                ? <span className="text-rose-700 font-medium">{m.short}</span>
                                : <span className="text-emerald-600">—</span>}
                            </TableCell>
                            <TableCell>
                              {m.short > 0
                                ? <DemandStateChip st={demandStateForItem(m.itemCode, m.itemName)} />
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {shortCount > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
                    <span className="text-xs text-muted-foreground">
                      {eligibleShorts.length > 0
                        ? <>{eligibleShorts.length} of {shortCount} short material{shortCount === 1 ? "" : "s"} can be demanded now{eligibleShorts.length < shortCount && " — the rest await an open demand"}.</>
                        : <>All {shortCount} short material{shortCount === 1 ? "" : "s"} already have an open demand — wait for receipt or rejection.</>}
                    </span>
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      disabled={eligibleShorts.length === 0}
                      onClick={() => raiseDemandForOrderShorts(materialsOrder, mats)}
                    >
                      <Zap className="h-3.5 w-3.5 mr-1" /> Raise Demand ({eligibleShorts.length})
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMaterialsOrder(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust batch — correct an in-progress order's target for an LMC. */}
      <Dialog open={!!adjustEntry} onOpenChange={(o) => { if (!o) { setAdjustEntry(null); setAdjustReq(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-amber-600" /> Adjust Batch Target
            </DialogTitle>
          </DialogHeader>
          {adjustEntry && (() => {
            const produced = adjustEntry.producedQty;
            const target = Math.max(0, Math.round(Number(adjustQty) || 0));
            const newRemaining = Math.max(0, target - produced);
            const surplus = target < produced ? produced - target : 0;
            return (
              <div className="space-y-4 text-sm">
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                  <div className="font-medium">{adjustEntry.outputItemName ?? adjustEntry.bom}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 font-mono">{adjustEntry.id} · {adjustEntry.date} · {adjustEntry.status}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-border px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Target</div>
                    <div className="font-semibold tabular-nums mt-0.5">{(adjustEntry.orderQty ?? produced).toLocaleString()}</div>
                  </div>
                  <div className="rounded-md border border-border px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Already Produced</div>
                    <div className="font-semibold tabular-nums mt-0.5">{produced.toLocaleString()}</div>
                  </div>
                </div>
                {adjustReq && (
                  <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
                    <div className="flex items-center justify-between gap-2">
                      <span className="uppercase tracking-wider text-[10px] font-semibold text-violet-700">Required by menu plan</span>
                      <span className="font-bold tabular-nums">{adjustReq.qty.toLocaleString()}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-violet-700">{adjustReq.breakdown}</div>
                  </div>
                )}
                <div>
                  <Label className="text-xs">New Target Quantity {adjustReq && <span className="text-muted-foreground font-normal">(pre-filled from menu plan)</span>}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={adjustQty}
                    onChange={(e) => setAdjustQty(e.target.value)}
                    className="mt-1 h-9"
                    autoFocus
                  />
                </div>
                <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                  New <strong>Remaining</strong> to produce: <strong className="tabular-nums">{newRemaining.toLocaleString()}</strong>
                  {surplus > 0 && (
                    <span className="block mt-1 text-amber-700">
                      Target is below produced — <strong>{surplus.toLocaleString()}</strong> already-made unit{surplus === 1 ? "" : "s"} become surplus (log as wastage separately).
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">Already-produced units are kept; only the target changes. Status stays <strong>{adjustEntry.status}</strong>.</p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustEntry(null)}>Cancel</Button>
            <Button onClick={saveAdjust}><Save className="h-4 w-4 mr-1" /> Update Target</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Recipe catalog + types moved to `@/lib/production-items` to break an import
// cycle with the meal-plan recipe resolver. Imported locally for internal use
// and re-exported for backwards compatibility with existing importers.
import { PRODUCTION_ITEMS, type RecipeItem, type ProductionItem } from "@/lib/production-items";
export { PRODUCTION_ITEMS, type RecipeItem, type ProductionItem };

import { resolveProductionItem, hasMasterRecipe } from "@/lib/meal-recipe";

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

function extractMealPlanItems(cards: MealCard[] = mealCards): MealPlanPickItem[] {
  const map = new Map<string, MealPlanPickItem>();
  for (const meal of cards) {
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
    // Dessert is served to the full audience — register it so it can be
    // selected for production like any choice item.
    const dCode = `MP-${slugifyItem(meal.dessert.name)}`;
    if (!map.has(dCode)) {
      map.set(dCode, {
        code: dCode,
        name: meal.dessert.name,
        day: meal.day,
        mealType: meal.mealType,
        flightType: ftLabel,
        forType: meal.forType,
        kind: "Choice",
        weight: meal.dessert.weight,
        calories: meal.dessert.calories,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const d = DAYS.indexOf(a.day as (typeof DAYS)[number]) - DAYS.indexOf(b.day as (typeof DAYS)[number]);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  });
}

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
    const item = resolveProductionItem({ name: line.itemName, code: line.itemCode });
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
    initialItem ? "Pre-filled from Menu Planning Details — Menu Plan tab." : "",
  );

  // Single Production Output Item (constraint: only one item per entry)
  const [outputItem, setOutputItem] = useState<OutputLine | null>(initialItem ?? null);
  const [itemQty, setItemQty] = useState<string>(initialItem ? String(initialItem.qty) : "");

  // Only items marked "Can be Produced" in Item Configuration are offered as a
  // production output. Read the persisted master (config-item-rows) so edits
  // apply; a production item with no matching master row stays visible (the
  // recipe catalog is the source of truth there), only an explicit
  // canProduce=false hides it.
  const [itemMaster] = usePersistedState<ItemMaster[]>("config-item-rows", MASTER_ITEMS);
  const producibleOutputs = useMemo(() => {
    const byCode = new Map(itemMaster.map((i) => [i.code.toUpperCase(), i]));
    return PRODUCTION_ITEMS.filter((p) => {
      const m = byCode.get(p.code.toUpperCase());
      return !m || itemCanProduce(m);
    });
  }, [itemMaster]);

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
    const recipe = resolveProductionItem({ name: bomName });
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
                <UtensilsCrossed className="h-3 w-3 mr-1" /> From Menu Plan
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
                  {producibleOutputs.map((p) => (
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
  meal, onSelect, requirements, readOnly = false, extraSpecialMeals = [],
}: {
  meal: MealCard;
  onSelect: (payload: { code: string; computedQty: number; breakdown: string; item?: MealPlanPickItem }) => void;
  requirements: OrderRequirement[];
  readOnly?: boolean;
  /** Special meals derived from the actual order rosters (e.g. FPML) that are
   *  not part of the static template. Rendered alongside template specials. */
  extraSpecialMeals?: { code: string; name: string; count: number }[];
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
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {(meal.specialMeals.filter((s) => s.enabled).length > 0 || extraSpecialMeals.length > 0) && (
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
                      // A special meal is a KIT, not a cook: this line is the
                      // dish's CONTRIBUTION to its own pool — meals of this code
                      // × portions per meal — not a production order of its own.
                      const explicitPortions = typeof s.portions === "number" ? s.portions : 0;
                      const computed = computeMealQty({
                        requirements,
                        day: meal.day,
                        flightTypes: meal.flightType,
                        forType: meal.forType,
                        kind: "Special",
                      });
                      const mealCount = explicitPortions > 0 ? explicitPortions : computed.qty;
                      const per = perMealQty(item);
                      const qty = mealCount * per;
                      const breakdown = `${mealCount} ${s.type} × ${per} = ${qty}`;
                      return (
                        <li key={i} className="text-[11px] flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-foreground truncate">{item.name}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {item.weight}g · {item.calories} kcal · ×{per}/meal
                              {qty > 0 && (
                                <>
                                  {" · "}
                                  <span
                                    className="text-primary font-medium tabular-nums"
                                    title={`${breakdown} — added to ${item.name}'s production pool, not cooked separately`}
                                  >
                                    +{qty.toLocaleString()} to pool
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}

              {/* Special meals taken from the actual flight-order rosters
                  (e.g. FPML on a crew/passenger order) that aren't in the
                  static menu template. */}
              {extraSpecialMeals.map((sp) => {
                const code = `MP-${slugifyItem(sp.name)}`;
                const breakdown = `${sp.count} ${sp.code} portion${sp.count === 1 ? "" : "s"} from flight order rosters`;
                const item: MealPlanPickItem = {
                  code, name: sp.name, day: meal.day, mealType: meal.mealType,
                  flightType: meal.flightType.join(" / "), forType: meal.forType,
                  kind: "Special", weight: 0, calories: 0,
                };
                return (
                  <div key={`extra-${sp.code}`} className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-foreground inline-flex items-center gap-1.5">
                        {sp.code}
                        <Badge variant="outline" className="text-[9px] h-4 px-1">from orders</Badge>
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">{sp.count} portions</span>
                    </div>
                    <ul className="space-y-1.5">
                      <li className="text-[11px] flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-foreground truncate">{sp.name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            <span className="text-primary font-medium tabular-nums">{sp.count.toLocaleString()} pcs</span>
                          </div>
                        </div>
                      </li>
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(() => {
          const dessertCode = `MP-${slugifyItem(meal.dessert.name)}`;
          const { qty, breakdown } = computeMealQty({
            requirements,
            day: meal.day,
            flightTypes: meal.flightType,
            forType: meal.forType,
            kind: "Choice",
            percentage: 100,
          });
          return (
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
              <span className="text-xs text-muted-foreground">Dessert</span>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-foreground">
                  {meal.dessert.name}{" "}
                  <span className="text-muted-foreground font-normal">
                    ({meal.dessert.weight}g · {meal.dessert.calories} kcal
                    {qty > 0 && <> · <span className="text-primary font-medium tabular-nums">{qty.toLocaleString()} pcs</span></>})
                  </span>
                </span>
              </div>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}

function MealPlanningDetailsDialog({
  open, onOpenChange, onSelectItem, onBulkCreate, date, readOnly = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelectItem: (item: MealPlanPickItem) => void;
  onBulkCreate: (items: MealPlanPickItem[]) => void;
  date: string;
  readOnly?: boolean;
}) {
  const navigate = useNavigate();
  const flightOrders = useFlightOrders();
  // Re-render when an approved Order-Summary adjustment lands so the header
  // Total Meals stays in sync with the Required Meals table below.
  useOrderSummaryAdjustments();
  const ordersForDate = useMemo(
    () => (date ? flightOrders.filter((o) => o.date === date) : flightOrders),
    [date, flightOrders],
  );
  const requirements = useMemo(() => computeOrderRequirements(ordersForDate), [ordersForDate]);
  // Net approved Total-Meals adjustment across the Date × Flight-Type buckets in
  // view (raised from Order Management → Order Summary, approved in Approval Mgmt).
  const adjustDelta = useMemo(() => {
    const keys = new Set(ordersForDate.map((o) => `${o.date}__${getFlightTypeFromSector(o.sector)}`));
    let d = 0;
    keys.forEach((k) => {
      const [dt, ft] = k.split("__");
      d += approvedDeltaFor(dt, ft as FlightTypeScope);
    });
    return d;
  }, [ordersForDate]);
  const orderDays = useMemo(() => new Set(requirements.map((r) => r.day)), [requirements]);

  // Latest configured menus from the Menu Planning page (falls back to seed).
  // Re-read whenever the dialog opens so menu edits flow through live.
  const planCards = useMemo(() => loadMealPlanningConfig(), [open]);

  const itemByCode = useMemo(() => {
    const m = new Map<string, MealPlanPickItem>();
    for (const it of extractMealPlanItems(planCards)) m.set(it.code, it);
    return m;
  }, [planCards]);

  const handleSelect = (payload: { code: string; computedQty: number; breakdown: string; item?: MealPlanPickItem }) => {
    // Roster-derived specials aren't in the static catalog, so accept a
    // fallback item built by the caller.
    const item = itemByCode.get(payload.code) ?? payload.item;
    if (!item) return;
    onSelectItem({ ...item, computedQty: payload.computedQty, qtyBreakdown: payload.breakdown });
  };

  // Special meals actually ordered (per-passenger rosters) for this date,
  // grouped by day → code → count. Surfaces codes like FPML that aren't in the
  // static menu template so they show in (and can be produced from) the plan.
  const orderedSpecialsByDay = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const o of ordersForDate) {
      if (!o.specialMealRoster?.length) continue;
      const day = getDayFromDate(o.date);
      let codeMap = m.get(day);
      if (!codeMap) { codeMap = new Map(); m.set(day, codeMap); }
      for (const e of o.specialMealRoster) {
        codeMap.set(e.mealCode, (codeMap.get(e.mealCode) ?? 0) + 1);
      }
    }
    return m;
  }, [ordersForDate]);

  const byDay = useMemo(() => {
    const groups = new Map<string, MealCard[]>();
    for (const m of planCards) {
      if (!orderDays.has(m.day as (typeof DAYS)[number])) continue;
      if (!groups.has(m.day)) groups.set(m.day, []);
      groups.get(m.day)!.push(m);
    }
    return Array.from(groups.entries()).sort(
      ([a], [b]) => DAYS.indexOf(a as (typeof DAYS)[number]) - DAYS.indexOf(b as (typeof DAYS)[number]),
    );
  }, [orderDays, planCards]);

  // Flatten every choice + enabled special-meal item across all displayed
  // meal cards, attaching the computed qty. Items with qty <= 0 are dropped.
  // Used by the "Create All Orders" bulk action below.
  const availableItems = useMemo<MealPlanPickItem[]>(() => {
    // ── One dish = ONE pool ───────────────────────────────────────────────────
    // A dish is cooked once and drawn down by everything that contains it: its
    // own choice lines, the dessert slot, and every special meal whose recipe
    // includes it. Listing those consumers separately raised two production
    // orders for the same dish and under-cooked each of them; the shares are
    // summed here instead, so one order covers the whole day's demand.
    const out: MealPlanPickItem[] = [];
    const pool = new Map<string, { item: MealPlanPickItem; qty: number; parts: string[] }>();
    const addToPool = (name: string, qty: number, part: string, fallback?: MealPlanPickItem) => {
      if (qty <= 0) return;
      const code = `MP-${slugifyItem(name)}`;
      const base = itemByCode.get(code) ?? fallback;
      if (!base) return;
      const hit = pool.get(code);
      if (hit) { hit.qty += qty; hit.parts.push(part); }
      else pool.set(code, { item: base, qty, parts: [part] });
    };
    for (const [, meals] of byDay) {
      const rosterCodes = orderedSpecialsByDay.get(meals[0]?.day ?? "");
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
            addToPool(it.name, qty * perMealQty(it), breakdown);
          }
        }
        for (const sp of meal.specialMeals) {
          if (!sp.enabled) continue;
          // Meals of THIS code — the roster is the truth when the orders carry
          // one; else the card's planned portions; else the day's special total.
          const computed = computeMealQty({
            requirements,
            day: meal.day,
            flightTypes: meal.flightType,
            forType: meal.forType,
            kind: "Special",
          });
          const fromRoster = rosterCodes?.get(sp.type) ?? 0;
          const explicitPortions = typeof sp.portions === "number" ? sp.portions : 0;
          const mealCount = fromRoster > 0 ? fromRoster : explicitPortions > 0 ? explicitPortions : computed.qty;
          if (mealCount <= 0) continue;
          for (const it of sp.items) {
            // The kit recipe: portions of this dish in ONE such meal.
            const per = perMealQty(it);
            addToPool(
              it.name,
              mealCount * per,
              `${(mealCount * per).toLocaleString()} for ${sp.type} (${mealCount} × ${per})`,
            );
          }
        }
        // Dessert — served to the whole audience for this card.
        {
          const { qty, breakdown } = computeMealQty({
            requirements,
            day: meal.day,
            flightTypes: meal.flightType,
            forType: meal.forType,
            kind: "Choice",
            percentage: 100,
          });
          addToPool(meal.dessert.name, qty * perMealQty(meal.dessert), breakdown);
        }
      }
      for (const { item, qty, parts } of pool.values()) {
        out.push({
          ...item,
          computedQty: qty,
          // Say what the pool is made of when more than one line feeds it —
          // "101 pax × 60% + 8 for VGML" is the number the planner must trust.
          qtyBreakdown: parts.length > 1 ? `${parts.join(" + ")} = ${qty.toLocaleString()}` : parts[0],
        });
      }
      pool.clear();

      // Ordered special meals (roster codes not in the template) — once per day.
      const orderedMap = orderedSpecialsByDay.get(meals[0]?.day ?? "");
      if (orderedMap && meals[0]) {
        const meal = meals[0];
        const templateCodes = new Set<string>();
        for (const m of meals) for (const sp of m.specialMeals) if (sp.enabled) templateCodes.add(sp.type);
        for (const [code, count] of orderedMap) {
          if (templateCodes.has(code) || count <= 0) continue;
          const name = SPECIAL_MEAL_BY_CODE[code]?.name ?? code;
          out.push({
            code: `MP-${slugifyItem(name)}`, name,
            day: meal.day, mealType: meal.mealType,
            flightType: meal.flightType.join(" / "), forType: meal.forType,
            kind: "Special", weight: 0, calories: 0,
            computedQty: count,
            qtyBreakdown: `${count} ${code} portion${count === 1 ? "" : "s"} from flight order rosters`,
          });
        }
      }
    }

    // Split combo items — some meals (e.g. the CHML combo) are stored as a single
    // item whose name lists several dishes comma-separated. Each dish must be its
    // own Production Order, so expand them into one component item per dish (same
    // qty — one combo unit yields one of each).
    const expanded: MealPlanPickItem[] = [];
    for (const it of out) {
      const parts = it.name.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length <= 1) { expanded.push(it); continue; }
      for (const partName of parts) {
        expanded.push({ ...it, name: partName, code: `MP-${slugifyItem(partName)}` });
      }
    }

    // Collapse duplicates — the same dish can surface from several meal cards /
    // choices for the day (e.g. Plain Polao in two flight-type cards), or from a
    // combo split above. Combine them into one row with summed qty so each dish
    // becomes a single Production Order rather than repeating. Keyed by dish + day
    // + meal + kind so genuinely distinct contexts (e.g. a Choice vs a Special of
    // the same dish) stay apart.
    const merged = new Map<string, MealPlanPickItem>();
    for (const it of expanded) {
      const key = `${it.code}|${it.day}|${it.mealType}|${it.kind}`;
      const existing = merged.get(key);
      if (existing) {
        existing.computedQty = (existing.computedQty ?? 0) + (it.computedQty ?? 0);
        if (it.qtyBreakdown && existing.qtyBreakdown && !existing.qtyBreakdown.includes(it.qtyBreakdown)) {
          existing.qtyBreakdown = `${existing.qtyBreakdown}; ${it.qtyBreakdown}`;
        }
      } else {
        merged.set(key, { ...it });
      }
    }
    return Array.from(merged.values());
  }, [byDay, requirements, itemByCode, orderedSpecialsByDay]);

  const totalPax = ordersForDate.reduce((s, o) => s + o.pax, 0);
  const totalCrew = ordersForDate.reduce((s, o) => s + o.crew, 0);
  const totalSpecial = ordersForDate.reduce((s, o) => s + o.specialMeals, 0);
  const totalMeals = totalPax + totalCrew + totalSpecial + adjustDelta;

  // ── Create-All review step ────────────────────────────────────────────────
  // "Create All Orders" first opens a review where the user sees, item-wise,
  // the current finished-good stock vs the required production qty and can
  // deselect items. Only the selected items become Production Orders; the rest
  // of the flow (Demand Request + Purchase Requisition) is unchanged.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());

  // Configured default + per-item overrides for how production qty is sized.
  const basisSettings = useProductionBasisSettings();
  // Per-run basis tweaks, keyed by row index. Seeded from config on open; lets
  // the user flip a row's basis for THIS run without changing the saved config.
  const [rowBasis, setRowBasis] = useState<Record<number, ProductionBasis>>({});
  const basisForRow = (i: number, name: string): ProductionBasis =>
    rowBasis[i] ?? effectiveBasis(basisSettings, name);

  const stockFor = (name: string) =>
    inventory.find((i) => i.name.toLowerCase() === name.toLowerCase());

  const openReview = () => {
    setSelectedIdx(new Set(availableItems.map((_, i) => i)));
    setRowBasis({});
    setReviewOpen(true);
  };
  const toggleIdx = (i: number) =>
    setSelectedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  const allSelected = availableItems.length > 0 && selectedIdx.size === availableItems.length;
  const toggleAll = () =>
    setSelectedIdx(allSelected ? new Set() : new Set(availableItems.map((_, i) => i)));
  const confirmReview = () => {
    // Re-size each selected item's qty by its effective basis: "required" keeps
    // the full demand; "shortfall" produces only what stock can't cover. The
    // resized computedQty flows through to the Production Order and its MRP.
    const chosen = availableItems
      .map((it, i) => ({ it, i }))
      .filter(({ i }) => selectedIdx.has(i))
      .map(({ it, i }) => {
        const req = it.computedQty ?? 0;
        const stock = getItemStock(it.name);
        const qty = productionQtyForBasis(basisForRow(i, it.name), req, stock);
        return { ...it, computedQty: qty };
      });
    if (chosen.length === 0) return;
    setReviewOpen(false);
    onBulkCreate(chosen);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <DialogTitle>
              Menu Planning Details — New Meal Order for {date || gmOrderSummary.date}
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
              <UtensilsCrossed className="h-4 w-4 mr-1" /> Open in Menu Planner
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
                Menu Plan
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
                {readOnly ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
                    <Eye className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      <span className="font-semibold">View only — past date.</span> This is a historical snapshot of what
                      was planned for {date}. Production orders can only be created for current and upcoming dates.
                    </span>
                  </div>
                ) : (
                  <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <UtensilsCrossed className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span>
                        Use <span className="font-semibold">Create All Orders</span> to raise Pending production
                        orders for every available menu and bundle everything into one
                        Demand Request (in-stock items become one Issue, shortfalls become one Purchase Requisition).
                      </span>
                    </div>
                    <Button
                      size="sm"
                      disabled={availableItems.length === 0}
                      onClick={openReview}
                      className="shrink-0"
                    >
                      <Zap className="h-3.5 w-3.5 mr-1.5" />
                      Create All Orders ({availableItems.length})
                    </Button>
                  </div>
                )}
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
                    {byDay.map(([day, meals]) => {
                      // Codes ordered for this day that the templates don't
                      // already cover — attach them to the first card so they
                      // appear once (not duplicated across every meal slot).
                      const orderedMap = orderedSpecialsByDay.get(day);
                      const templateCodes = new Set<string>();
                      for (const m of meals) for (const sp of m.specialMeals) if (sp.enabled) templateCodes.add(sp.type);
                      const extras = orderedMap
                        ? Array.from(orderedMap.entries())
                            .filter(([code]) => !templateCodes.has(code))
                            .map(([code, count]) => ({
                              code, count,
                              name: SPECIAL_MEAL_BY_CODE[code]?.name ?? code,
                            }))
                        : [];
                      return (
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
                          {meals.map((m, idx) => (
                            <MealCardView
                              key={m.id}
                              meal={m}
                              onSelect={handleSelect}
                              requirements={requirements}
                              readOnly={readOnly}
                              extraSpecialMeals={idx === 0 ? extras : []}
                            />
                          ))}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>

    {/* Review step — current stock vs required production qty, item-wise */}
    <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>Create Production Orders — Review</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Current stock vs required production quantity for {date}. Select the items to produce —
            only selected items become Production Orders; the Demand Request &amp; Purchase Requisition
            flow runs as usual on them. <span className="text-foreground">Produce Qty</span> follows each
            item's basis (default {PRODUCTION_BASIS_LABEL[basisSettings.default]}, configurable on the
            Production Basis page); flip it per row below for this run only.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {availableItems.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">No items to produce.</div>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary align-middle"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all items"
                      />
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">Current Stock</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">Required Qty</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">Shortfall</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-center">Basis</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">Produce Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availableItems.map((it, i) => {
                    const inv = stockFor(it.name);
                    const stock = getItemStock(it.name);
                    const uom = inv?.uom ?? "";
                    const req = it.computedQty ?? 0;
                    const shortfall = roundQty(Math.max(0, req - stock));
                    const basis = basisForRow(i, it.name);
                    const produceQty = roundQty(productionQtyForBasis(basis, req, stock));
                    const checked = selectedIdx.has(i);
                    return (
                      <TableRow
                        key={`${it.code}-${i}`}
                        className={cn("cursor-pointer hover:bg-muted/30", checked && "bg-primary/5")}
                        onClick={() => toggleIdx(i)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary align-middle"
                            checked={checked}
                            onChange={() => toggleIdx(i)}
                            aria-label={`Select ${it.name}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-foreground">{it.name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {it.day} · {it.mealType} · {it.kind}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {stock.toLocaleString()}{uom ? <span className="text-[10px] text-muted-foreground"> {uom}</span> : null}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums font-medium">
                          {req.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {shortfall > 0
                            ? <span className="text-destructive font-medium">{shortfall.toLocaleString()}</span>
                            : <span className="text-success">0</span>}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-center">
                            <div className="inline-flex rounded-md border border-border overflow-hidden">
                              {(["required", "shortfall"] as ProductionBasis[]).map((b) => (
                                <button
                                  key={b}
                                  type="button"
                                  onClick={() => setRowBasis((prev) => ({ ...prev, [i]: b }))}
                                  className={cn(
                                    "h-7 px-2 text-[11px] font-medium transition-colors whitespace-nowrap",
                                    basis === b
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-transparent text-muted-foreground hover:bg-muted/50",
                                  )}
                                  title={b === "required"
                                    ? "Produce the full required qty"
                                    : "Produce only the shortfall (required − stock)"}
                                >
                                  {b === "required" ? "Required" : "Shortfall"}
                                </button>
                              ))}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums font-semibold">
                          {produceQty.toLocaleString()}
                          {produceQty === 0 && (
                            <div className="text-[10px] font-normal text-muted-foreground">nothing to produce</div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-3 border-t border-border bg-muted/20">
          <div className="flex-1 text-xs text-muted-foreground">
            {selectedIdx.size} of {availableItems.length} item{availableItems.length === 1 ? "" : "s"} selected
          </div>
          <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
          <Button disabled={selectedIdx.size === 0} onClick={confirmReview}>
            <Zap className="h-4 w-4 mr-1.5" />
            Create Production Orders ({selectedIdx.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
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
                    <TableCell colSpan={6} className="py-2">
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
                        <TableCell colSpan={6} className="pl-4 py-1.5">
                          <div className="flex items-center flex-wrap gap-2">
                            <span className="font-mono text-sm font-semibold text-primary">{orderNo}</span>
                            {legs.length > 1 && (
                              <Badge
                                variant="outline"
                                className="h-5 px-1.5 text-[10px] tabular-nums border-primary/30 bg-card text-primary"
                              >
                                {legs.length} flights
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
                                {legs.length} flights
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
  // Re-render when an approved Order-Summary adjustment lands.
  useOrderSummaryAdjustments();
  // Net approved Total-Meals adjustment for a requirement row — summed across the
  // distinct dates in its orders (a day-of-week group can span several dates),
  // keyed by Date × Flight Type just like the Order Management → Order Summary tab.
  const adjustDeltaFor = (r: OrderRequirement): number => {
    const dates = new Set(r.orders.map((o) => o.date));
    let d = 0;
    dates.forEach((date) => { d += approvedDeltaFor(date, r.flightType as FlightTypeScope); });
    return d;
  };

  const totals = requirements.reduce(
    (acc, r) => ({
      flights: acc.flights + r.flights,
      passengers: acc.passengers + r.passengers,
      crew: acc.crew + r.crew,
      specialMeals: acc.specialMeals + r.specialMeals,
      specialPax: acc.specialPax + r.specialPax,
      specialCrew: acc.specialCrew + r.specialCrew,
    }),
    { flights: 0, passengers: 0, crew: 0, specialMeals: 0, specialPax: 0, specialCrew: 0 },
  );
  const grandDelta = requirements.reduce((s, r) => s + adjustDeltaFor(r), 0);
  const grandTotal = totals.passengers + totals.crew + totals.specialMeals + grandDelta;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-success">
          Required Meals (derived from Flight Orders)
        </div>
        <div className="text-[11px] text-muted-foreground">
          Grouped by Day &times; Flight Type
          {grandDelta !== 0 && (
            <span className="ml-1.5 text-primary">· incl. approved adjustment {grandDelta > 0 ? "+" : "−"}{Math.abs(grandDelta).toLocaleString()}</span>
          )}
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
              <TableHead className="text-xs uppercase tracking-wider text-right">Special Meal (Pax)</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Special Meal (Crew)</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Total Meals</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requirements.map((r) => {
              const base = r.passengers + r.crew + r.specialMeals;
              const delta = adjustDeltaFor(r);
              const total = base + delta;
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
                  <TableCell className="text-right tabular-nums">{r.specialPax.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.specialCrew.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {delta !== 0 && (
                        <span className="text-[10px] text-muted-foreground line-through">{base.toLocaleString()}</span>
                      )}
                      <span className={delta !== 0 ? "text-primary" : ""}>{total.toLocaleString()}</span>
                      {delta !== 0 && (
                        <Badge variant="outline" className={cn("text-[9px] font-semibold", delta > 0 ? "border-success/40 text-success" : "border-destructive/40 text-destructive")}>
                          {delta > 0 ? "+" : "−"}{Math.abs(delta).toLocaleString()}
                        </Badge>
                      )}
                    </span>
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
              <TableCell className="text-right tabular-nums">{totals.specialPax.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{totals.specialCrew.toLocaleString()}</TableCell>
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

// Stock lookup by item name — actual on-hand stock summed across every
// warehouse the item is held in (see lib/inventory-stock).
function getMrpOnHand(itemName: string): number {
  return getItemStock(itemName);
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
      // Resolve the recipe (curated, BOM master, or synthesized) so every
      // selected order contributes materials to the requirement plan.
      const item = resolveProductionItem({ name: o.outputItemName ?? o.bom, code: o.outputItemCode });
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

  // Orders that fall back to a synthesized generic recipe (no curated/BOM-master
  // entry). They still contribute materials — this is an accuracy heads-up, not a
  // skip.
  const unmatched = selectedOrders.filter(
    (o) => !hasMasterRecipe({ name: o.outputItemName, code: o.outputItemCode, bom: o.bom }),
  );

  // Flatten + enrich every material with stock + shortfall + supplier
  const enrichMaterial = (m: AggregatedMaterial, bucket: "Raw" | "Packaging" | "Other"): WfMrpMaterial => {
    const onHand = getMrpOnHand(m.itemName);
    const shortfall = roundQty(Math.max(0, m.reqQty - onHand));
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
      runBy: "Business Analyst",
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
                    <TableHead className="text-[10px] uppercase tracking-wider">Order</TableHead>
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
                      const hasRecipe = hasMasterRecipe({ name: o.outputItemName, code: o.outputItemCode, bom: o.bom });
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
                                  Generic recipe
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
                  {" "}{unmatched.map((o) => o.id).join(", ")}. A generic recipe is used for these in the requirement calculation.
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
