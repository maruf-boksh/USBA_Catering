import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { KpiCard } from "@/components/common/KpiCard";
import {
  Clock, Plus, ArrowLeft, CheckCircle2, AlertTriangle, Truck, ShoppingCart,
  PackageOpen, Send, Timer, Eye, ChevronRight, ChevronDown,
  ExternalLink, Trash2, PlusCircle, ListChecks, Zap, History, X, ChefHat,
  ArrowLeftRight, Factory, Pencil, GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { roundQty } from "@/lib/num";
import { toast } from "sonner";
import { flagArrival } from "@/lib/arrival-flash";
import {
  addPurchaseRequisition, getPurchaseRequisitions, prReceived, type PRLineItem,
} from "@/lib/purchase-requisitions";
import { ListExportActions } from "@/components/common/ListExportActions";
import { filterMeta as listExportFilterMeta } from "@/lib/list-export";
import { useFlightOrders } from "@/lib/flight-orders-store";
import { activeItems, vendors, warehouses as ALL_WAREHOUSES } from "@/lib/sample-data";
import { LocationPicker } from "@/components/common/LocationPicker";
import { useWorkflow, type WfGRN, type WfGRNLine, type StockDelta, type WfProductionEntry } from "@/lib/workflow-store";
import { reduceInventoryStock } from "@/lib/stock-adjustments";
import { useRole } from "@/lib/roles";
import { TR_SEED } from "@/routes/transfer-request";
import {
  DPF_KEY, DPF_LOG_KEY, buildProductionAvailability, committedByProduction,
  readTransferRequests, allocateToBatches, shortfallOf, sourceOf,
  type DelayProductionFulfillment, type DpfLogEntry, type FulfilSource,
  type ItemAvailability, type PlanLine, type ProductionBatchOption,
} from "@/lib/delay-production-fulfillment";
import { isProducedItem } from "@/lib/meal-recipe";
import { getItemProfiles } from "@/lib/item-profiles";
import {
  newAllocationId, isPackaged, usesRun, type PackagingAllocation,
} from "@/lib/packaging-allocations";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DelayStatus =
  | "Received"
  | "Validated"
  | "Fulfillment Pending"
  | "Approval Pending"
  | "Approved"
  | "Rejected"
  | "Sent To Production"
  /** Packaging run raised — the meals are being packed, not yet dispatched. */
  | "Sent To Packaging"
  | "Sent To Dispatch"
  | "Dispatched"
  | "Closed";

export type FulfillmentType = "Instant Purchase" | "Direct Receive" | "From Production";

export type DrItem = { name: string; qty: number; unitCost: number };

/** A single item line from Menu Planning, carried on the delay event. */
export type DelayMenuItem = {
  name: string;
  requiredQty: number;
  uom: string;
  /** Present for "Other" items entered by the user and carries through to cost calculations. */
  unitCost?: number;
};

export type DirectReceive = {
  id: string;
  vendorName: string;
  items: DrItem[];
  totalCost: number;
  receivedBy: string;
  receivedAt: string;
};

export type DelayFulfillment = {
  id: string;
  itemType: string;
  suggestedQty: number;
  finalQty: number;
  fulfillmentType: FulfillmentType;
  requestedBy: string;
  notes: string;
  directReceive?: DirectReceive;
};

export type DelayEvent = {
  id: string;
  flightOrderId: string;
  orderNo: string;
  flightNumber: string;
  flightDate: string;
  sector: string;
  paxCount: number;
  crewCount: number;
  delayDurationHours: number;
  reason: string;
  reportedBy: string;
  status: DelayStatus;
  createdAt: string;
  updatedAt: string;
  mealType?: string;
  menuItems?: DelayMenuItem[];
  /** Original ETD from the flight order, stored so sendToDispatch can compute the delayed dep time. */
  originalEtd?: string;
  fulfillment?: DelayFulfillment;
  dispatchId?: string;
  approvalId?: string;
  /** Production Orders (WfProductionEntry ids) raised for this delay's food
   *  items when they are cooked fresh rather than bought/received. */
  productionOrderIds?: string[];
  /** Set when the delay was met from meals ALREADY produced for the scheduled
   *  flights. No new production order and no spot buy — the finished meals move
   *  to the airport store on the linked Transfer Request, which carries the
   *  approval and the stock movement. */
  productionFulfillment?: {
    id: string;
    /** One request per sending warehouse — a pull can span Hot and Cold Kitchen. */
    transferRequestIds: string[];
    totalQty: number;
    raisedAt: string;
  };
  /** Events logged together in one submission share a batch id, so the
   *  production check can present the whole delayed set as one worklist. */
  batchId?: string;
  /** When the run's items were taken out of stock. Set on Send To Packaging,
   *  cleared (and reversed) if the run is cancelled. */
  stockDeductedAt?: string;
  /** Packaging allocations raised for this delay (PKA-… ids in the shared
   *  `packaging-allocations` store). The delay's cooked items are packed on the
   *  Packaging board with the flight's scheduled meals, under the same flight
   *  header — this is the link between the two. */
  packagingAllocationIds?: string[];
  /** Every routing decision taken for this delay — which items went to stock,
   *  to the kitchen, or out to be bought, and the document each raised. The
   *  View modal reads this to show the full fulfilment breakdown. */
  fulfilmentRefs?: {
    source: "Stock" | "Production" | "Instant Purchase";
    /** Document id(s) raised — comma-joined when a route produced several. */
    ref: string;
    refKind: "delay-approval" | "production-order" | "purchase-requisition";
    items: { name: string; qty: number; uom: string }[];
    at: string;
  }[];
  /** Agreed sourcing for this flight, set when "Fulfill from Production" is
   *  raised. Survives the approval so "Transfer to Airport" knows exactly which
   *  batches to move. Quantities it could not cover stay as `purchaseQty` and
   *  still go through the existing instant-purchase route. */
  productionPlan?: {
    id: string;
    createdAt: string;
    createdBy: string;
    lines: {
      itemName: string;
      uom: string;
      requiredQty: number;
      productionQty: number;
      stockQty: number;
      purchaseQty: number;
      batches: { productionId: string; qty: number; warehouseId?: string }[];
    }[];
    totalProduction: number;
    totalStock: number;
    totalPurchase: number;
  };
};

export type DelayApprovalRecord = {
  id: string;
  delayEventId: string;
  flightNumber: string;
  flightDate: string;
  sector: string;
  paxCount: number;
  crewCount: number;
  delayDurationHours: number;
  submittedBy: string;
  submittedAt: string;
  status: "Pending" | "Approved" | "Declined";
  processedBy?: string;
  processedAt?: string;
  declineReason?: string;
  fulfillmentType: FulfillmentType;
  items: DrItem[];
  totalCost: number;
  notes: string;
};

type DispatchRecordLike = {
  id: string;
  date: string;
  depTime: string;
  kitchenName: string;
  flightNos: string[];
  status: string;
  trail: Array<{ status: string; by: string; date: string; time: string }>;
  detail: {
    flightKitchen: { name: string; totalMeals: number; lunch: number; breakfast: number };
    bakery: Array<{ name: string; qty: number }>;
    amenities: Array<{ label: string; qty: number }>;
    foodSafety: { result: string; checkedBy: string; date: string; time: string };
  };
  sections: unknown[];
  dynamicItems: unknown[];
  dispatch_type?: "Production" | "Delay Refreshment";
  dispatch_sequence?: number;
};

type PackagingRowLike = {
  id: string;
  date: string;
  depTime: string;
  flight: string;
  mealType: "Breakfast" | "Lunch" | "Dinner" | "Snack" | "Special";
  mealName: string;
  qty: number;
  section: string;
  packagingStatus: "Ready for Packaging" | "Packaging In Progress" | "Packaging Done" | "Ready for Dispatch" | "Dispatched";
  dspRef?: string;
  orderNo?: string;
  /** Kitchen run behind the row — how Packaging progress reaches Dispatch. */
  productionOrderId?: string;
};

type InventoryItemMinimal = { id?: string; name: string; stock: number; uom?: string };

type DrLogEntry = {
  drRef: string;
  eventId: string;
  itemName: string;
  qtyReceived: number;
  uom: string;
  stockBefore: number;
  stockAfter: number;
  receivedAt: string;
};

type DrFormLine = {
  id: string;
  name: string;
  qty: number;
  unitCost: number;
  uom: string;
  expiry: string;
  stockBefore: number;
  inventoryItemId?: string;
};

const DR_RECEIVERS = ["M. Karim", "S. Ahmed", "F. Begum", "K. Rahman", "N. Islam"] as const;

/** Warehouse display name for an id — used by the production-fulfilment views. */
const warehouseNameOf = (id?: string): string =>
  ALL_WAREHOUSES.find((w) => w.id === id)?.name ?? "—";

type MealCardMinimal = {
  day: string;
  mealType: string;
  choices: Array<{ items: Array<{ name: string; weight: number }> }>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Heavy Snacks", "Other"] as const;

const DELAY_REASONS = [
  "ATC Hold — Congestion at destination",
  "ATC Hold — Slot delay issued",
  "Technical — Engine inspection required",
  "Technical — Avionics / hydraulics fault",
  "Technical — Late aircraft maintenance",
  "Weather — Adverse conditions at departure",
  "Weather — Destination airspace closed",
  "Ground delay — Late incoming aircraft",
  "Ground delay — Fueling delay",
  "Crew delay — Late crew positioning",
  "Passenger delay — Late boarding / offloading",
  "Cargo delay — Late cargo / baggage loading",
  "Security — Additional screening required",
  "Other",
] as const;

/** "HH:MM" 24h → "H:MM AM/PM" airline display format. */
function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * "HH:MM" 24h, stamped with the operating timezone. Schedules are kept in Dhaka
 * local time (GMT+6), so the label states it rather than leaving the reader to
 * assume it — a delayed departure that wraps past midnight is ambiguous in 12h.
 */
function to24hGmt6(hhmm: string): string {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  return `${m[1].padStart(2, "0")}:${m[2]} GMT+6`;
}

/**
 * The date a delayed flight actually departs. A 23:55 departure pushed 2 hours
 * leaves at 01:55 the NEXT day, so it is served that day's menu — the day-wise
 * menu config follows the revised departure, not the original schedule. Returns
 * the original date when there is no delay, no ETD, or no midnight rollover.
 */
function delayedServiceDate(date: string, etd: string | undefined, hours: number): string {
  if (!etd || !(hours > 0)) return date;
  const m = etd.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return date;
  const shift = Math.floor(
    (parseInt(m[1]) * 60 + parseInt(m[2]) + Math.round(hours * 60)) / (24 * 60),
  );
  if (shift <= 0) return date;
  const d = new Date(date + "T00:00:00");
  if (Number.isNaN(d.getTime())) return date;
  d.setDate(d.getDate() + shift);
  // Local parts, not toISOString() — the schedule is Dhaka-local, and UTC would
  // roll the date back a day.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Add `hours` to an "HH:MM" ETD string; returns new "HH:MM" (wraps past midnight). */
function addHoursToEtd(etd: string, hours: number): string {
  const match = etd.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return etd;
  const h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const totalMins = h * 60 + m + Math.round(hours * 60);
  const newH = Math.floor(totalMins / 60) % 24;
  const newM = totalMins % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

const STATUS_BADGE: Record<DelayStatus, string> = {
  "Received":           "bg-slate-100 text-slate-600",
  "Validated":          "bg-blue-100 text-blue-700",
  "Fulfillment Pending":"bg-amber-100 text-amber-700",
  "Approval Pending":   "bg-violet-100 text-violet-700",
  "Approved":           "bg-emerald-100 text-emerald-700",
  "Rejected":           "bg-red-100 text-red-700",
  "Sent To Production": "bg-indigo-100 text-indigo-700",
  "Sent To Packaging":  "bg-sky-100 text-sky-700",
  "Sent To Dispatch":   "bg-teal-100 text-teal-700",
  "Dispatched":         "bg-emerald-200 text-emerald-800",
  "Closed":             "bg-gray-100 text-gray-500",
};

/**
 * Minutes until a flight's REVISED departure — the clock the whole delay runs
 * against. Null when the schedule can't be resolved. Negative once it has gone.
 */
function minutesToRevisedDeparture(ev: {
  flightDate: string; originalEtd?: string; delayDurationHours: number;
}): number | null {
  if (!ev.originalEtd) return null;
  const m = ev.originalEtd.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const date = delayedServiceDate(ev.flightDate, ev.originalEtd, ev.delayDurationHours);
  const hhmm = addHoursToEtd(ev.originalEtd, ev.delayDurationHours);
  const dep = new Date(`${date}T${hhmm}:00`);
  if (Number.isNaN(dep.getTime())) return null;
  return Math.round((dep.getTime() - Date.now()) / 60000);
}

/** "2h 15m" / "45m" — compact enough to sit in a table cell. */
function shortDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Countdown chip against the revised departure. A delay is defined by its new
 * departure time, so the list has to say which one is 40 minutes out — without
 * it every row looks equally urgent.
 */
function departureChip(ev: {
  flightDate: string; originalEtd?: string; delayDurationHours: number; status: DelayStatus;
}) {
  if (["Dispatched", "Closed", "Rejected"].includes(ev.status)) return null;
  const mins = minutesToRevisedDeparture(ev);
  // Nothing to count down to once the slot has passed — the column already
  // carries the delay itself, so a "Departed" tag on every past flight is noise.
  if (mins == null || mins < 0) return null;
  const cls = mins <= 120 ? "border-red-200 bg-red-50 text-red-700"
    : mins <= 360 ? "border-amber-200 bg-amber-50 text-amber-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
  return (
    <span
      title="Time to revised departure"
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap",
        cls,
      )}
    >
      T-{shortDuration(mins)}
    </span>
  );
}

function delayBadge(status: DelayStatus) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold", STATUS_BADGE[status])}>
      {status}
    </span>
  );
}

function stamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

function durationMultiplier(hours: number): number {
  if (hours <= 2) return 1.0;
  if (hours <= 4) return 1.2;
  return 1.5;
}

function suggestDrItems(itemType: string, totalPax: number): DrItem[] {
  if (itemType === "Heavy Snacks") {
    return [
      { name: "Mineral Water 500ml", qty: totalPax, unitCost: 20 },
      { name: "Snack Pack", qty: Math.ceil(totalPax * 0.8), unitCost: 95 },
    ];
  }
  if (itemType === "Lunch" || itemType === "Dinner") {
    return [
      { name: "Box Meal", qty: totalPax, unitCost: 285 },
      { name: "Mineral Water 500ml", qty: totalPax, unitCost: 20 },
      { name: "Juice Box", qty: Math.ceil(totalPax * 0.6), unitCost: 55 },
    ];
  }
  if (itemType === "Breakfast") {
    return [
      { name: "Breakfast Box", qty: totalPax, unitCost: 220 },
      { name: "Juice Box", qty: totalPax, unitCost: 55 },
      { name: "Mineral Water 500ml", qty: totalPax, unitCost: 20 },
    ];
  }
  return [
    { name: "Hot Meal Box", qty: totalPax, unitCost: 350 },
    { name: "Mineral Water 500ml", qty: totalPax, unitCost: 20 },
    { name: "Beverage Can", qty: totalPax, unitCost: 65 },
  ];
}

function defaultMenuItems(mealType: string, totalPax: number): DelayMenuItem[] {
  if (mealType === "Breakfast") {
    return [
      { name: "Breakfast Box", requiredQty: totalPax, uom: "pcs" },
      { name: "Juice Box",     requiredQty: totalPax, uom: "pcs" },
      { name: "Mineral Water 500ml", requiredQty: totalPax, uom: "pcs" },
    ];
  }
  if (mealType === "Lunch" || mealType === "Dinner") {
    return [
      { name: "Meal Box",      requiredQty: totalPax, uom: "pcs" },
      { name: "Mineral Water 500ml", requiredQty: totalPax, uom: "pcs" },
      { name: "Juice Box",     requiredQty: Math.ceil(totalPax * 0.5), uom: "pcs" },
    ];
  }
  if (mealType === "Heavy Snacks") {
    return [
      { name: "Snack Pack",    requiredQty: totalPax, uom: "pcs" },
      { name: "Mineral Water 500ml", requiredQty: totalPax, uom: "pcs" },
      { name: "Juice Box",     requiredQty: Math.ceil(totalPax * 0.8), uom: "pcs" },
    ];
  }
  return [];
}

function menuItemsFromPlan(
  mealType: string,
  flightDate: string,
  totalPax: number,
  cards: MealCardMinimal[],
): DelayMenuItem[] {
  if (mealType === "Other" || mealType === "Heavy Snacks") return defaultMenuItems(mealType, totalPax);
  const dayName = new Date(flightDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
  const matching = cards.filter(
    (c) => c.mealType.toLowerCase() === mealType.toLowerCase() && c.day === dayName,
  );
  if (matching.length === 0) return defaultMenuItems(mealType, totalPax);
  const card = matching[0];
  const seen = new Set<string>();
  const items: DelayMenuItem[] = [];
  card.choices.forEach((ch) => {
    ch.items.forEach((it) => {
      if (!seen.has(it.name)) {
        seen.add(it.name);
        items.push({ name: it.name, requiredQty: totalPax, uom: "portion" });
      }
    });
  });
  return items.length > 0 ? items : defaultMenuItems(mealType, totalPax);
}

// ─── Menu item picker ─────────────────────────────────────────────────────────

/** One selectable meal / beverage offered by the delay menu dropdowns. */
type MenuItemOption = { name: string; uom: string; unitCost: number };

const optKey = (name: string) => name.trim().toLowerCase();

/**
 * Everything that can be served to a delayed flight: the meals, bakery and
 * beverages on the Item Profile, plus whatever the day-wise Menu Planning cards
 * configure. Raw materials, packaging and assets are not servable, so they are
 * left out of the picker.
 */
function buildMenuItemOptions(cards: MealCardMinimal[]): MenuItemOption[] {
  const out: MenuItemOption[] = [];
  const seen = new Set<string>();
  const push = (name: string, uom: string, unitCost: number) => {
    const key = optKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name: name.trim(), uom, unitCost });
  };
  activeItems
    .filter((i) => i.itemType === "Finished Good"
      || i.itemType === "Semi-Finished Good"
      || i.category === "Beverage")
    .forEach((i) => push(i.name, i.uom, i.costPrice ?? 0));
  // Plan-configured dishes ("Aloo Paratha", "Chicken Korma", …) are served by the
  // portion, and may not exist on the Item Profile at all.
  cards.forEach((c) => c.choices.forEach((ch) => ch.items.forEach((it) => push(it.name, "portion", 0))));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Items servable under ONE meal type — the dishes the Menu Planning cards
 * configure for that type across every weekday, plus the type's default items.
 * Mirrors the meal-configuration pickers: a Breakfast dropdown only offers
 * breakfast dishes, never the whole master list.
 */
function mealTypeItemOptions(mealType: string, cards: MealCardMinimal[]): MenuItemOption[] {
  const out: MenuItemOption[] = [];
  const seen = new Set<string>();
  const costOf = (name: string) =>
    activeItems.find((i) => optKey(i.name) === optKey(name))?.costPrice ?? 0;
  const push = (name: string, uom: string) => {
    const key = optKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name: name.trim(), uom, unitCost: costOf(name) });
  };
  cards
    .filter((c) => c.mealType.toLowerCase() === mealType.toLowerCase())
    .forEach((c) => c.choices.forEach((ch) => ch.items.forEach((it) => push(it.name, "portion"))));
  // Only the menu-configuration dishes; the type's defaults are offered solely
  // when nothing at all is configured for it (mirrors menuItemsFromPlan).
  if (out.length === 0) defaultMenuItems(mealType, 1).forEach((it) => push(it.name, it.uom));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Searchable item dropdown. `multi` keeps the list open with a checkbox per
 * option (pick several); otherwise picking one option closes the list.
 */
function ItemDropdown({
  options, selected, label, multi, onPick, triggerClassName,
}: {
  options: MenuItemOption[];
  /** Lower-cased names already chosen — ticked when `multi`, disabled when not. */
  selected: string[];
  label: string;
  multi?: boolean;
  onPick: (o: MenuItemOption) => void;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;
  const isOn = (o: MenuItemOption) => selected.includes(optKey(o.name));
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-8 w-full flex items-center justify-between gap-2 rounded-md border border-input bg-background px-2 text-sm",
            triggerClassName,
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search items…"
          className="h-8 text-sm mb-1"
        />
        {/* overscroll-contain + stopPropagation keep the wheel on this list —
            without them the dialog behind the popover scrolls instead. */}
        <div className="max-h-56 overflow-y-auto overscroll-contain" onWheel={(e) => e.stopPropagation()}>
          {shown.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">No matching item.</div>
          ) : shown.map((o) => (
            <button
              key={o.name}
              type="button"
              disabled={!multi && isOn(o)}
              className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:opacity-40"
              onClick={() => { onPick(o); if (!multi) { setOpen(false); setQuery(""); } }}
            >
              {multi && <Checkbox checked={isOn(o)} className="pointer-events-none" />}
              <span className="flex-1 truncate">{o.name}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">{o.uom}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Seed data ────────────────────────────────────────────────────────────────

const SEED_EVENTS: DelayEvent[] = [
  {
    id: "DEL-0001",
    flightOrderId: "FO-002",
    orderNo: "ORD-3411",
    flightNumber: "BG-402",
    flightDate: "2026-05-20",
    sector: "DXB → DAC",
    paxCount: 174,
    crewCount: 14,
    delayDurationHours: 3,
    reason: "Technical — Engine inspection required before departure",
    reportedBy: "Flight Ops (DAC)",
    status: "Fulfillment Pending",
    createdAt: "2026-05-20 08:15",
    updatedAt: "2026-05-20 08:30",
    mealType: "Lunch",
    menuItems: [
      { name: "Box Meal", requiredQty: 188, uom: "pcs" },
      { name: "Mineral Water 500ml", requiredQty: 188, uom: "pcs" },
      { name: "Juice Box", requiredQty: 113, uom: "pcs" },
    ],
    fulfillment: {
      id: "DFR-0001",
      itemType: "Lunch",
      suggestedQty: 225,
      finalQty: 225,
      fulfillmentType: "Direct Receive",
      requestedBy: "Flight Ops (DAC)",
      notes: "",
    },
  },
];

/** A delay event still in play — not resolved (Closed), Rejected, or already
 *  Dispatched (a terminal state). The one definition of "active", shared by the
 *  Delay Management KPI and the dashboard. */
export const isActiveDelayEvent = (e: DelayEvent) => !["Closed", "Rejected", "Dispatched"].includes(e.status);

/** Non-hook reader of the shared delay-events store (falls back to the seed) so
 *  other surfaces — e.g. the dashboard "Delayed Flights" KPI — reflect the same
 *  live data the Delay Management page persists. */
export function loadDelayEvents(): DelayEvent[] {
  try {
    const raw = window.localStorage.getItem("harvest-data-v1:delay-events");
    if (raw) return JSON.parse(raw) as DelayEvent[];
  } catch {
    /* unavailable / corrupt — fall back to seed */
  }
  return SEED_EVENTS;
}

const SEED_APPROVALS: DelayApprovalRecord[] = [
  {
    id: "DA-0001",
    delayEventId: "DEL-0002",
    flightNumber: "BS-411",
    flightDate: "2026-05-21",
    sector: "CGP → DXB",
    paxCount: 162,
    crewCount: 8,
    delayDurationHours: 2,
    submittedBy: "R. Islam",
    submittedAt: "2026-05-21 17:00",
    status: "Approved",
    processedBy: "R. Hossain (Business Analyst)",
    processedAt: "2026-05-21 17:30",
    fulfillmentType: "Direct Receive",
    items: [
      { name: "Mineral Water 500ml", qty: 170, unitCost: 20 },
      { name: "Snack Pack",          qty: 136, unitCost: 95 },
    ],
    totalCost: 16320,
    notes: "Priority delivery — gate B7",
  },
  {
    id: "DA-DEMO",
    delayEventId: "DEL-DEMO",
    flightNumber: "BG-521",
    flightDate: "2026-05-22",
    sector: "DAC → DOH",
    paxCount: 196,
    crewCount: 12,
    delayDurationHours: 3,
    submittedBy: "T. Ahmed",
    submittedAt: "2026-05-22 08:45",
    status: "Approved",
    processedBy: "R. Hossain (Business Analyst)",
    processedAt: "2026-05-22 09:00",
    fulfillmentType: "Direct Receive",
    items: [
      { name: "Breakfast Box",       qty: 208, unitCost: 220 },
      { name: "Juice Box",           qty: 208, unitCost: 55 },
      { name: "Mineral Water 500ml", qty: 208, unitCost: 20 },
    ],
    totalCost: 60944,
    notes: "Expedited delivery — pier 6",
  },
];

/** Seeded demo dispatch record for DEL-DEMO — shows dispatch trail in the detail modal. */
const SEED_DEMO_DISPATCH: DispatchRecordLike = {
  id: "DSP-DEL-DEMO",
  date: "2026-05-22",
  depTime: "10:00",
  kitchenName: "Delay Refreshment",
  flightNos: ["BG-521"],
  status: "Dispatched",
  trail: [
    { status: "Preparing",         by: "Delay Management (DEL-DEMO)", date: "2026-05-22", time: "09:05" },
    { status: "Packaging Done",    by: "Kitchen Staff (T. Ahmed)",     date: "2026-05-22", time: "09:40" },
    { status: "Ready For QC",      by: "QC (S. Karim)",               date: "2026-05-22", time: "09:50" },
    { status: "Ready For Dispatch", by: "QC Cleared (S. Karim)",      date: "2026-05-22", time: "10:00" },
    { status: "Dispatched",        by: "Dispatcher (M. Hasan)",        date: "2026-05-22", time: "10:15" },
  ],
  detail: {
    flightKitchen: { name: "Delay Refreshment Dispatch", totalMeals: 250, lunch: 0, breakfast: 250 },
    bakery:    [],
    amenities: [
      { label: "Breakfast Box",       qty: 208 },
      { label: "Juice Box",           qty: 208 },
      { label: "Mineral Water 500ml", qty: 208 },
    ],
    foodSafety: { result: "Pass", checkedBy: "S. Karim", date: "2026-05-22", time: "09:52" },
  },
  sections:     [],
  dynamicItems: [],
  dispatch_type:     "Delay Refreshment",
  dispatch_sequence: 2,
};

// ─── Main Page ────────────────────────────────────────────────────────────────

type View = "list" | "production" | "fulfillment" | "detail";

export default function DelayManagementPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [view, setView]                   = useState<View>("list");
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  /** Event ID shown in the view modal (eye icon). null = modal closed. */
  const [viewModalEventId, setViewModalEventId] = useState<string | null>(null);
  /** Log Delay Event capture modal. */
  const [createOpen, setCreateOpen]       = useState(false);

  const [delayEvents, setDelayEvents]       = usePersistedState<DelayEvent[]>("delay-events", SEED_EVENTS);
  const [delayApprovals, setDelayApprovals] = usePersistedState<DelayApprovalRecord[]>("delay-approval-records", SEED_APPROVALS);
  const [dispatchRecords, setDispatchRecords] = usePersistedState<DispatchRecordLike[]>("dispatch-records", []);
  const [packagingRows, setPackagingRows]   = usePersistedState<PackagingRowLike[]>("dispatch-packaging-rows", []);
  // The Packaging board's own rows — run × flight × qty. A delay's cooked items
  // are packed there alongside the flight's scheduled meals, so Send To
  // Packaging writes real allocations rather than a parallel record.
  const [pkgAllocations, setPkgAllocations] = usePersistedState<PackagingAllocation[]>("packaging-allocations", []);
  // QC/packaging batches, read-only — used to link an allocation back to the
  // batch its run passed QC on, exactly as New Packaging does.
  const [pkgBatches] = usePersistedState<Array<{ id: string; batch: string }>>("packaging-batches", []);
  const { applyStockDeltas, addProductionEntry, productionEntries } = useWorkflow();

  // Ensure the demo dispatch record is present in dispatch-records on first load
  const demoPresent = dispatchRecords.some((d) => d.id === "DSP-DEL-DEMO");
  if (!demoPresent) {
    setDispatchRecords((prev) => [...prev, SEED_DEMO_DISPATCH]);
  }

  // Keep only the first delay event — drop the retired demo seed rows (DEL-0002,
  // DEL-DEMO) if an earlier session persisted them. Idempotent; leaves any
  // user-created events untouched.
  if (delayEvents.some((e) => e.id === "DEL-0002" || e.id === "DEL-DEMO")) {
    setDelayEvents((prev) => prev.filter((e) => e.id !== "DEL-0002" && e.id !== "DEL-DEMO"));
  }

  // Normalise the terminal status so the flow ends at "Dispatched":
  //  • Flip "Sent To Dispatch" → "Dispatched" once the linked delay dispatch is
  //    actually dispatched (all its packaging rows reach "Dispatched").
  //  • "Closed" is a retired state — migrate any lingering "Closed" event to
  //    "Dispatched" so the list, KPI and timeline all read "Dispatched".
  useEffect(() => {
    setDelayEvents((prev) => {
      let changed = false;
      const next = prev.map((e) => {
        if (e.status === "Closed") {
          changed = true;
          return { ...e, status: "Dispatched" as DelayStatus };
        }
        if ((e.status === "Sent To Packaging" || e.status === "Sent To Dispatch") && e.dispatchId) {
          const rows = packagingRows.filter((r) => r.dspRef === e.dispatchId);
          if (rows.length > 0 && rows.every((r) => r.packagingStatus === "Dispatched")) {
            changed = true;
            return { ...e, status: "Dispatched" as DelayStatus, updatedAt: stamp() };
          }
        }
        return e;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packagingRows]);

  // Handle ?del= deep-link from other modules
  const deepLinkId = searchParams.get("del");
  if (deepLinkId && view === "list" && delayEvents.some((e) => e.id === deepLinkId)) {
    setActiveEventId(deepLinkId);
    setView("detail");
  }

  const nextDelId = `DEL-${String(delayEvents.length + 1).padStart(4, "0")}`;
  const nextDfrId = `DFR-${String(delayEvents.filter((e) => e.fulfillment).length + 1).padStart(4, "0")}`;
  const nextDrId  = `DR-${String(delayEvents.filter((e) => e.fulfillment?.directReceive).length + 1).padStart(4, "0")}`;
  const nextDaId  = `DA-${String(delayApprovals.length + 1).padStart(4, "0")}`;

  const activeEvent    = delayEvents.find((e) => e.id === activeEventId) ?? null;
  const viewModalEvent = delayEvents.find((e) => e.id === viewModalEventId) ?? null;

  /**
   * The flights the production check works on: everything logged in the same
   * submission that is still awaiting fulfilment. Events from before batches
   * were recorded stand alone, so the check degrades to a single-flight list.
   */
  const batchEvents = useMemo(() => {
    if (!activeEvent) return [];
    if (!activeEvent.batchId) return [activeEvent];
    return delayEvents.filter(
      (e) => e.batchId === activeEvent.batchId && e.status === "Fulfillment Pending",
    );
  }, [delayEvents, activeEvent]);

  // "Fulfil" re-enters the flow at the Production / Stock Availability check
  // (view "production") — from there Forward to Production or Forward to Instant
  // Purchase continue the flow, so the rest is unchanged.
  const openFulfillment = (eventId: string) => { setActiveEventId(eventId); setView("production"); };

  const createEvents = (evs: DelayEvent[]) => {
    if (evs.length === 0) return;
    setDelayEvents((prev) => [...evs, ...prev]);
    // Land back on the Delay Events list — each new event sits there as
    // "Fulfillment Pending" with its own Fulfil action (per-event fulfillment).
    setView("list");
    toast.success(
      evs.length === 1
        ? `${evs[0].id} created — Fulfillment Pending in the list.`
        : `${evs.length} delay events created (one per flight) — all Fulfillment Pending in the list.`,
    );
  };

  const setEventFulfillmentAndGo = (
    eventId: string,
    fulfillmentType: FulfillmentType,
    overrideItems?: DelayMenuItem[],
  ) => {
    setDelayEvents((prev) =>
      prev.map((e) => {
        if (e.id !== eventId) return e;
        const totalPax = e.paxCount + e.crewCount;
        // Use overrideItems (insufficient-only from production check) if provided, else all menuItems
        const sourceItems = overrideItems ?? e.menuItems ?? [];
        const drItems: DrItem[] = sourceItems.map((mi) => ({
          name: mi.name, qty: mi.requiredQty, unitCost: mi.unitCost ?? 0,
        }));
        const dfrId = e.fulfillment?.id ??
          `DFR-${String(delayEvents.filter((x) => x.fulfillment).length + 1).padStart(4, "0")}`;
        const drId = `DR-${String(delayEvents.filter((x) => x.fulfillment?.directReceive).length + 1).padStart(4, "0")}`;
        const updatedFulfillment: DelayFulfillment = {
          id: dfrId,
          itemType: e.mealType ?? "Refreshments",
          suggestedQty: totalPax,
          finalQty: totalPax,
          fulfillmentType,
          requestedBy: e.reportedBy,
          notes: "",
          directReceive: fulfillmentType === "Direct Receive" ? {
            id: drId,
            vendorName: "",
            items: drItems.length > 0 ? drItems : suggestDrItems(e.mealType ?? "", totalPax),
            totalCost: drItems.reduce((s, i) => s + i.qty * i.unitCost, 0),
            receivedBy: "",
            receivedAt: "",
          } : undefined,
        };
        return { ...e, fulfillment: updatedFulfillment, updatedAt: stamp() };
      }),
    );
    setView("fulfillment");
  };

  const submitFulfillment = (
    eventId: string,
    fulfillment: DelayFulfillment,
    approvalRecord: DelayApprovalRecord,
  ) => {
    setDelayEvents((prev) =>
      prev.map((e) =>
        e.id === eventId
          ? { ...e, fulfillment, status: "Approval Pending", approvalId: approvalRecord.id, updatedAt: stamp() }
          : e,
      ),
    );
    setDelayApprovals((prev) => [approvalRecord, ...prev]);
    setView("detail");
    toast.success(`${approvalRecord.id} submitted for approval.`);
  };

  /**
   * Instant purchase from the production screen: raise the approval and come
   * straight back to the LIST — no detour through the detail view. A spot buy is
   * a PURCHASE, so it queues under Purchase Req in Approval Management (not
   * Delay Refreshment): the requisition carries the received lines and the event
   * keeps a purchase-requisition ref, so the Purchase Status column tracks it as
   * Purchase Req Pending → (approval) → Sent To Purchase Requisition →
   * (goods received) → Purchase Fulfillment Completed.
   */
  const submitInstantPurchase = (
    eventId: string,
    fulfillment: DelayFulfillment,
    approvalRecord: DelayApprovalRecord,
  ) => {
    const at = stamp();
    const dr = fulfillment.directReceive;
    const pr = addPurchaseRequisition({
      date: at.slice(0, 10),
      officeId: "OFF-001",
      warehouseId: "WH-001",
      requestedBy: approvalRecord.submittedBy,
      requiredBy: approvalRecord.flightDate,
      priority: "Urgent",
      justification:
        `Instant purchase${dr ? ` (${dr.id}${dr.vendorName ? ` — ${dr.vendorName}` : ""})` : ""} — ` +
        `delay refreshment ${approvalRecord.flightNumber} (${approvalRecord.flightDate}), ${eventId}.` +
        (approvalRecord.notes ? ` ${approvalRecord.notes}` : ""),
      lines: approvalRecord.items.map((it, i) => ({
        id: `L${i + 1}`,
        itemName: it.name,
        description: `Delay refreshment — ${approvalRecord.flightNumber}`,
        qty: it.qty,
        uom: "pcs",
        rate: it.unitCost ?? 0,
      })),
      status: "Pending Approval",
    });
    const ref: NonNullable<DelayEvent["fulfilmentRefs"]>[number] = {
      source: "Instant Purchase",
      ref: pr.id,
      refKind: "purchase-requisition",
      items: approvalRecord.items.map((i) => ({ name: i.name, qty: i.qty, uom: "pcs" })),
      at,
    };
    setDelayEvents((prev) =>
      prev.map((e) =>
        e.id === eventId
          ? {
              ...e,
              fulfillment,
              fulfilmentRefs: [...(e.fulfilmentRefs ?? []), ref],
              // A spot buy raised after the meals already moved must not drag
              // the flight back out of its dispatch state.
              status: ["Sent To Packaging", "Sent To Dispatch", "Dispatched"].includes(e.status)
                ? e.status
                : "Approval Pending",
              updatedAt: at,
            }
          : e,
      ),
    );
    setView("list");
    setActiveEventId(null);
    // Verify the write actually landed before claiming success.
    if (!getPurchaseRequisitions().some((p) => p.id === pr.id)) {
      toast.error("Could not save the requisition — browser storage unavailable.");
      return;
    }
    toast.success(`${pr.id} raised — pending approval under Purchase Req.`);
  };

  /**
   * Route the delay's food items to the kitchen: raise one Production Order
   * (WfProductionEntry, status "Pending") per item via the shared workflow
   * store. Pending orders are projected straight into Approval Management's
   * "Production" queue — approving there releases them to the Production Entry
   * floor log. The created order ids are linked back onto the delay event.
   */
  const sentToProduction = (
    eventId: string,
    config: {
      date: string;
      officeId: string;
      warehouseId: string;
      lines: Array<{ name: string; qty: number; code?: string }>;
    },
    /** `silent` skips the navigation + toast so several flights can be raised
     *  in one go from the availability plan. Single-flight callers are unchanged. */
    opts?: { silent?: boolean },
  ) => {
    const event = delayEvents.find((e) => e.id === eventId);
    if (!event) return;
    const batch = Date.now().toString(36).slice(-5).toUpperCase();
    const orderIds: string[] = [];
    config.lines.forEach((l, idx) => {
      const id = `PRO-DEL-${batch}-${idx + 1}`;
      const order: WfProductionEntry = {
        id,
        date: config.date,
        bom: l.name,
        outputItemName: l.name,
        outputItemCode: l.code,
        orderQty: l.qty,
        producedQty: 0,
        status: "Pending",
        officeId: config.officeId,
        warehouseId: config.warehouseId,
      };
      addProductionEntry(order);
      orderIds.push(id);
    });
    const prodRef: NonNullable<DelayEvent["fulfilmentRefs"]>[number] = {
      source: "Production",
      ref: orderIds.join(", "),
      refKind: "production-order",
      items: config.lines.map((l) => ({ name: l.name, qty: l.qty, uom: "portion" })),
      at: stamp(),
    };
    setDelayEvents((prev) =>
      prev.map((e) =>
        e.id === eventId
          ? {
              ...e,
              productionOrderIds: [...(e.productionOrderIds ?? []), ...orderIds],
              fulfilmentRefs: [...(e.fulfilmentRefs ?? []), prodRef],
              status: "Sent To Production",
              updatedAt: stamp(),
            }
          : e,
      ),
    );
    if (opts?.silent) return;
    setActiveEventId(eventId);
    setView("detail");
    toast.success(
      `${orderIds.length} production order${orderIds.length === 1 ? "" : "s"} raised for ${eventId} — pending approval in Approval Management.`,
    );
  };

  /**
   * "Fulfill from Production" for one or more delayed flights. Each flight gets
   * its own Delay Refreshment approval — the same record and queue the other
   * fulfilment routes use — plus the agreed sourcing plan. Nothing moves yet:
   * the stock only leaves the kitchen once the approval clears and the flight is
   * transferred to the airport store.
   */
  const fulfilFromProduction = (
    plans: { eventId: string; plan: NonNullable<DelayEvent["productionPlan"]>; approval: DelayApprovalRecord }[],
  ) => {
    if (plans.length === 0) return;
    const at = stamp();
    const byEvent = new Map(plans.map((p) => [p.eventId, p]));
    setDelayEvents((prev) =>
      prev.map((e) => {
        const p = byEvent.get(e.id);
        if (!p) return e;
        // Stock-sourced plans move nothing from the kitchen; production ones do.
        const fromStock = p.plan.totalProduction === 0 && p.plan.totalStock > 0;
        const ref: NonNullable<DelayEvent["fulfilmentRefs"]>[number] = {
          source: fromStock ? "Stock" : "Production",
          ref: p.approval.id,
          refKind: "delay-approval",
          items: p.approval.items.map((i) => ({ name: i.name, qty: i.qty, uom: "portion" })),
          at,
        };
        return {
          ...e,
          productionPlan: p.plan,
          approvalId: p.approval.id,
          fulfilmentRefs: [...(e.fulfilmentRefs ?? []), ref],
          status: "Approval Pending" as DelayStatus,
          updatedAt: at,
        };
      }),
    );
    setDelayApprovals((prev) => [...plans.map((p) => p.approval), ...prev]);
    // Meals drawn from the kitchen are a production decision, so they queue under
    // Production in Approval Management; a pure stock issue stays under Delay
    // Refreshment. Name the queue the approver will actually find it in.
    const allStock = plans.every((p) => p.plan.totalProduction === 0 && p.plan.totalStock > 0);
    const queue = allStock ? "Delay Refreshment" : "Production";
    // Deliberately no view change — the Production Availability modal stays open
    // so the purchase balance can be forwarded from the same plan.
    toast.success(
      plans.length === 1
        ? `${plans[0].approval.id} submitted — pending ${queue} approval.`
        : `${plans.length} fulfilment requests submitted — pending ${queue} approval.`,
    );
  };

  /** Append one routing decision to a delay event's fulfilment breakdown. */
  const recordFulfilment = (
    eventId: string,
    entry: NonNullable<DelayEvent["fulfilmentRefs"]>[number],
  ) => {
    setDelayEvents((prev) =>
      prev.map((e) =>
        e.id === eventId
          ? { ...e, fulfilmentRefs: [...(e.fulfilmentRefs ?? []), entry] }
          : e,
      ),
    );
  };

  /**
   * Raise Production Orders for items marked in the availability plan, across
   * however many flights they span. Reuses `sentToProduction` per flight — the
   * same records, the same Production approval queue, the same release to the
   * floor — but without navigating, so the plan modal stays open.
   */
  const sendMarkedToProduction = (
    groups: { eventId: string; date: string; lines: { name: string; qty: number }[] }[],
  ) => {
    if (groups.length === 0) return;
    groups.forEach((g) =>
      sentToProduction(g.eventId, {
        date: g.date,
        officeId: "OFF-001",
        warehouseId: "WH-003",
        lines: g.lines,
      }, { silent: true }),
    );
    const orders = groups.reduce((s, g) => s + g.lines.length, 0);
    toast.success(
      `${orders} production order${orders === 1 ? "" : "s"} raised across ` +
      `${groups.length} flight${groups.length === 1 ? "" : "s"} — pending approval in Approval Management.`,
    );
  };

  /**
   * Spot-buy the balance production could not cover. Reopens the flight's
   * fulfilment screen with the existing Direct Receive modal already showing —
   * the instant-purchase flow itself is untouched. Stays available after the
   * meals are dispatched, because the purchased balance is a separate errand.
   */
  const [autoOpenDrFor, setAutoOpenDrFor] = useState<string | null>(null);
  const openInstantPurchase = (ev: DelayEvent) => {
    const refs = ev.fulfilmentRefs ?? [];
    // Only references whose record still EXISTS count — a ghost ref (its
    // requisition/approval cleared from storage) must not block the flow.
    const prStore = getPurchaseRequisitions();
    const prRefs = refs.filter((r) => r.refKind === "purchase-requisition"
      && prStore.some((p) => p.id === r.ref));
    const ipRefs = refs.filter((r) => r.refKind === "delay-approval" && r.source === "Instant Purchase"
      && delayApprovals.some((a) => a.id === r.ref));

    // No live requisition — raise one for the plan's uncovered balance. It lands
    // in Approval Management under Purchase Req; the spot buy follows approval.
    if (prRefs.length === 0 && ipRefs.length === 0) {
      const lines = (ev.productionPlan?.lines ?? []).filter((l) => l.purchaseQty > 0);
      if (lines.length === 0) { toast.error("Nothing left to purchase for this flight."); return; }
      const now = stamp();
      const pr = addPurchaseRequisition({
        date: now.slice(0, 10),
        officeId: "OFF-001",
        warehouseId: "WH-001",
        requestedBy: ev.reportedBy,
        requiredBy: ev.flightDate,
        priority: "Urgent",
        justification:
          `Delay refreshment shortfall — ${ev.flightNumber} (${ev.flightDate}), ${ev.id}. ` +
          `Not covered by the approved fulfilment plan.`,
        lines: lines.map((l, i) => ({
          id: `L${i + 1}`,
          itemName: l.itemName,
          description: `Delay refreshment — ${ev.flightNumber}`,
          qty: l.purchaseQty,
          uom: l.uom,
          rate: (ev.menuItems ?? []).find((m) => m.name === l.itemName)?.unitCost ?? 0,
        })),
        status: "Pending Approval",
      });
      setDelayEvents((prev) => prev.map((e) => e.id === ev.id
        ? {
            ...e,
            fulfilmentRefs: [...(e.fulfilmentRefs ?? []), {
              source: "Instant Purchase",
              ref: pr.id,
              refKind: "purchase-requisition",
              items: lines.map((l) => ({ name: l.itemName, qty: l.purchaseQty, uom: l.uom })),
              at: now,
            }],
            updatedAt: now,
          }
        : e));
      // Verify the write actually landed before claiming success.
      if (!getPurchaseRequisitions().some((p) => p.id === pr.id)) {
        toast.error("Could not save the requisition — browser storage unavailable.");
        return;
      }
      toast.success(`${pr.id} raised — pending approval under Purchase Req.`);
      return;
    }

    // A requisition exists — the spot buy only unlocks once it is approved.
    const prPending = prRefs.some((r) => {
      const p = prStore.find((x) => x.id === r.ref);
      return !p || /pending|draft/i.test(p.status);
    });
    const ipPending = ipRefs.some((r) => {
      const a = delayApprovals.find((x) => x.id === r.ref);
      return !a || a.status === "Pending";
    });
    if (prPending || ipPending) {
      toast.info("Purchase Req is still pending approval — the spot buy opens once it is approved.");
      return;
    }

    setActiveEventId(ev.id);
    setAutoOpenDrFor(ev.id);
    setView("production");
  };

  /**
   * Advance an event once the Transfer Request approver signs off: the meals are
   * released to move, so the delay is Approved and "Send to Dispatch" opens up.
   * Read-only on the Transfer Request store — approval itself happens there.
   * Only ever touches events that carry a production-fulfilment link.
   */
  useEffect(() => {
    const approved = new Set(
      readTransferRequests(TR_SEED)
        .filter((r) => r.status === "Approved" || r.status === "Completed")
        .map((r) => r.id),
    );
    setDelayEvents((prev) => {
      let changed = false;
      const next = prev.map((e) => {
        if (
          e.status !== "Approval Pending" ||
          !e.productionFulfillment ||
          // Every request must clear before the meals are fully released.
          !e.productionFulfillment.transferRequestIds.every((id) => approved.has(id))
        ) return e;
        changed = true;
        return { ...e, status: "Approved" as DelayStatus, updatedAt: stamp() };
      });
      return changed ? next : prev;
    });
    // Approval happens on the Approval Management page, so returning here always
    // remounts — a read on mount is enough to pick the decision up.
  }, [setDelayEvents]);

  /**
   * Every kitchen run raised for the flight is finished AND has passed QC. A run
   * still preparing (or cooked but not QC-cleared) may not move on: packaging and
   * dispatch open only after production and QC are complete. Flights with no
   * kitchen run of their own — stock issues, spot buys, meals drawn from finished
   * production — are already past this point and pass trivially.
   */
  const productionReady = (event: DelayEvent): boolean =>
    (event.productionOrderIds ?? []).every((id) => {
      const o = productionEntries.find((x) => x.id === id);
      return o?.status === "Completed" && !!o.qcPassedAt;
    });

  const sendToDispatch = (
    event: DelayEvent,
    /** Offset for the DSP id when several flights dispatch in one tick — the
     *  event list is read from a closure, so back-to-back calls would other-
     *  wise mint the same id. */
    seqOffset = 0,
    /** Where to land afterwards. Meals that still need packing go to Packaging;
     *  meals already packed go straight to Dispatch. Same records either way. */
    opts?: { goTo?: "dispatch" | "packaging" },
  ) => {
    // "Approval Pending" is allowed through: the list only offers Dispatch once
    // every routed approval has actually cleared — the raw label can lag when
    // several fulfilments were raised on the same event.
    if (!["Approved", "Sent To Production", "Approval Pending"].includes(event.status)) return;
    // Hard gate, not just a hidden button: nothing preparing in the kitchen may
    // raise a packaging run or a dispatch, whichever path called in.
    if (!productionReady(event)) {
      toast.error(
        `${event.flightNumber} — production is still in progress. ` +
        `Packaging and dispatch open once production and QC are complete.`,
      );
      return;
    }
    const now = stamp();
    const today = now.slice(0, 10);
    // Compute delayed dep time in airline 12h standard (original ETD + delay hours)
    const rawDelayed = event.originalEtd ? addHoursToEtd(event.originalEtd, event.delayDurationHours) : null;
    const depTimeBase = rawDelayed ? to12h(rawDelayed) : (event.flightDate === today ? to12h(now.slice(11, 16)) : "00:00");
    // Packaging rows display dep time WITH the added delay hours so crew can
    // identify the delayed departure — always annotate when there's a delay,
    // even if the original ETD wasn't captured (base falls back to the slot time).
    const depTime = event.delayDurationHours > 0
      ? `${depTimeBase} (+${event.delayDurationHours}h delay)`
      : depTimeBase;
    // Dispatch record keeps the clean dep time (no annotation) for detail modal display
    const depTimeRecord = depTimeBase;
    const maxSeq = dispatchRecords
      .filter((d) => d.flightNos.includes(event.flightNumber))
      .reduce((m, d) => Math.max(m, d.dispatch_sequence ?? 1), 0);
    const newDspId = `DSP-DEL-${String(delayEvents.filter((e) => e.dispatchId).length + 1 + seqOffset).padStart(3, "0")}`;

    const sourceItems: Array<{ name: string; qty: number }> =
      event.fulfillment?.directReceive?.items ??
      (event.menuItems ?? []).map((mi) => ({ name: mi.name, qty: mi.requiredQty }));

    const pkgMealType = ((): PackagingRowLike["mealType"] => {
      const mt = (event.mealType ?? "").toLowerCase();
      if (mt === "breakfast") return "Breakfast";
      if (mt === "lunch")     return "Lunch";
      if (mt === "dinner")    return "Dinner";
      return "Snack";
    })();

    // Items issued from stock came off the shelf, not out of the kitchen, so the
    // system checks the packaging queue for this flight before sending them on:
    // one already packed for the flight skips the packaging stage, anything else
    // still packages first. Production / purchased items always package.
    const stockIssued = new Set(
      (event.fulfilmentRefs ?? [])
        .filter((r) => r.source === "Stock")
        .flatMap((r) => r.items.map((i) => i.name.trim().toLowerCase())),
    );
    const PACKED: PackagingRowLike["packagingStatus"][] =
      ["Packaging Done", "Ready for Dispatch", "Dispatched"];
    const alreadyPackaged = (name: string) =>
      packagingRows.some((r) =>
        r.flight === event.flightNumber
        && r.mealName.trim().toLowerCase() === name.trim().toLowerCase()
        && (!event.orderNo || !r.orderNo || r.orderNo === event.orderNo)
        && PACKED.includes(r.packagingStatus),
      );

    // The kitchen run behind each item, when there is one — this is the link the
    // Dispatch board uses to flip a row to "Packaging Done" once the Packaging
    // module finishes that production batch, so the delay run rides the existing
    // packaging → dispatch pipeline instead of a parallel one.
    const runFor = (name: string) =>
      productionEntries.find((o) =>
        (event.productionOrderIds ?? []).includes(o.id)
        && (o.outputItemName ?? o.bom ?? "").trim().toLowerCase() === name.trim().toLowerCase(),
      )?.id;

    let packedAhead = 0;
    const newPkgRows: PackagingRowLike[] = sourceItems.map((item, idx) => {
      // A bought-in item has no kitchen run: it comes off the shelf already
      // sealed (boxed meal, juice, bottled water), so there is nothing to pack.
      // Leaving it at "Ready for Packaging" stranded it — the Dispatch board
      // hides those rows and nothing else could ever advance them, so a delay
      // met entirely from stock or a spot buy could never be dispatched.
      const boughtIn = !runFor(item.name);
      const packed = boughtIn
        || (stockIssued.has(item.name.trim().toLowerCase()) && alreadyPackaged(item.name));
      if (packed) packedAhead++;
      return {
        // NOT a `PKG-…` id: the Dispatch board clears rows with that prefix as
        // legacy placeholders, which would delete this run's packaging.
        id:       `PRD-DEL-${newDspId}-${idx + 1}`,
        productionOrderId: runFor(item.name),
        date:     today,
        depTime,
        flight:   event.flightNumber,
        mealType: pkgMealType,
        mealName: item.name,
        qty:      item.qty,
        section:  "Delay Refreshment",
        // Packed already → straight into the dispatch stage; from there QC →
        // Ready for Dispatch → Dispatched runs exactly as it does today.
        packagingStatus: packed ? "Packaging Done" : "Ready for Packaging",
        dspRef:   newDspId,
        orderNo:  event.orderNo,
      };
    });

    // ── Packaging allocations — the Packaging board's own rows ──────────────
    // One per cooked item: run × flight × qty, the same record "New Packaging"
    // writes, so the delay lands under this flight's header on that page and
    // runs the existing lifecycle (Pending Approval → In Packaging → Packaged).
    // A run ALREADY packaged for this flight is linked, never duplicated — the
    // delay then simply reads "Packaged". Bought-in consumables carry no run,
    // so they raise no allocation, exactly as they don't today.
    const allocAt = now.slice(0, 16).replace("T", " ");
    const newAllocs: PackagingAllocation[] = [];
    const allocIds: string[] = [];
    for (const item of sourceItems) {
      const proId = runFor(item.name);
      if (!proId) continue;
      const packed = pkgAllocations.find((a) =>
        a.flight === event.flightNumber && a.date === event.flightDate
        && usesRun(a, proId) && isPackaged(a));
      if (packed) { allocIds.push(packed.id); continue; }
      const id = newAllocationId();
      allocIds.push(id);
      newAllocs.push({
        id,
        // Same derivation the board uses: PRO-2026-1234 → PKG-2026-1234.
        packagingId: `PKG-${proId.replace(/^PRO-?/i, "")}`,
        batchId: pkgBatches.find((b) => b.batch === proId)?.id ?? "",
        productionId: proId,
        item: item.name,
        flight: event.flightNumber,
        orderNo: event.orderNo,
        date: event.flightDate,
        // The flight now leaves later — the header should say so.
        depTime: rawDelayed ?? event.originalEtd,
        qty: item.qty,
        // Released straight to the packers. A scheduled run needs packaging
        // sign-off because nothing authorised it yet; a delay run already
        // carries its own fulfilment approval, and a fourth gate on a same-day
        // disruption is where people start working around the system.
        status: "In Packaging",
        createdAt: allocAt,
        createdBy: `Delay Mgmt (${event.id})`,
        approvedBy: `Delay Mgmt (${event.id})`,
        approvedAt: allocAt,
      });
    }

    const newRecord: DispatchRecordLike = {
      id:          newDspId,
      date:        today,
      depTime:     depTimeRecord,
      kitchenName: "Delay Refreshment",
      flightNos:   [event.flightNumber],
      status:      "Preparing",
      trail: [{ status: "Preparing", by: `Delay Mgmt (${event.id})`, date: today, time: now.slice(11, 16) }],
      detail: {
        flightKitchen: {
          name:       "Delay Refreshment Dispatch",
          totalMeals: event.fulfillment?.finalQty ?? sourceItems.reduce((s, i) => s + i.qty, 0),
          lunch: 0,
          breakfast: 0,
        },
        bakery:    [],
        amenities: sourceItems.map((i) => ({ label: i.name, qty: i.qty })),
        foodSafety: { result: "—", checkedBy: "", date: "", time: "" },
      },
      sections:     [],
      dynamicItems: [],
      dispatch_type:     "Delay Refreshment",
      dispatch_sequence: maxSeq + 1,
    };

    // Prepend (like the regular New Dispatch flow) so the just-sent delay
    // dispatch lands at the TOP of the Dispatch table / first page.
    setPackagingRows((prev) => [...newPkgRows, ...prev]);
    if (newAllocs.length > 0) setPkgAllocations((prev) => [...newAllocs, ...prev]);
    setDispatchRecords((prev) => [newRecord, ...prev]);
    setDelayEvents((prev) =>
      prev.map((e) =>
        e.id === event.id
          ? {
              ...e,
              // The run has been raised, not dispatched — saying "Sent To
              // Dispatch" here misled every other screen reading `status`.
              status: "Sent To Packaging",
              dispatchId: newDspId,
              packagingAllocationIds: allocIds.length > 0 ? allocIds : e.packagingAllocationIds,
              stockDeductedAt: stamp(),
              updatedAt: stamp(),
            }
          : e,
      ),
    );

    // Deduct dispatched items from stock (OUT QTY in the ledger). Stamped on the
    // event so cancelling the run can put it back — an un-reversible deduction
    // on a run that never leaves is how ledgers drift.
    sourceItems.forEach((item) => reduceInventoryStock(item.name, item.qty));
    const deltas: StockDelta[] = sourceItems.map((item) => ({
      itemId: item.name,
      delta: -item.qty,
      date: today,
      reference: newDspId,
      label: "Delay Dispatch",
    }));
    applyStockDeltas(deltas);

    const goTo = opts?.goTo ?? "dispatch";
    toast.success(
      goTo === "packaging"
        ? `${newDspId} created — ${newPkgRows.length - packedAhead} item(s) sent to Packaging.`
        : packedAhead > 0
          ? `${newDspId} created — ${packedAhead} item(s) already packaged, going straight to Dispatch.`
          : `${newDspId} created — proceeding to Dispatch for QC & dispatch.`,
    );
    // Defer navigation so usePersistedState flushes the new rows/record to
    // localStorage before the destination page mounts and reads from it.
    setTimeout(() => navigate(goTo === "packaging" ? "/packaging" : "/dispatch"), 0);
  };

  /**
   * "Send To Packaging" — the entry point from the list once every fulfilment
   * route has cleared. The system checks the packaging queue first:
   *   • every item already packaged → show them (with their packaging ids) and
   *     offer Send To Dispatch, which skips the packaging stage entirely;
   *   • anything still unpacked → raise the packaging run and go to Packaging.
   * From there the packaging → QC → dispatch process is the existing one.
   */
  const [pkgCheck, setPkgCheck] = useState<{
    event: DelayEvent;
    rows: Array<{ id: string; name: string; qty: number; status: string }>;
  } | null>(null);

  /** The items a delay dispatch actually moves — the received spot buy when
   *  there is one, otherwise the flight's menu. Mirrors `sendToDispatch`. */
  const dispatchItemsOf = (ev: DelayEvent): Array<{ name: string; qty: number }> =>
    ev.fulfillment?.directReceive?.items?.map((i) => ({ name: i.name, qty: i.qty }))
    ?? (ev.menuItems ?? []).map((mi) => ({ name: mi.name, qty: mi.requiredQty }));

  /**
   * Is this item already packed for this flight? Checks BOTH boards — the
   * packaging allocations (where a cooked run is packed) and the dispatch rows
   * (where a bought-in line sits). Reading only one of them let the two disagree
   * about the same item, which is how a run could be sent to packaging twice.
   */
  const packedRowFor = (ev: DelayEvent, name: string): { id: string; status: string } | undefined => {
    const key = name.trim().toLowerCase();
    const alloc = pkgAllocations.find((a) =>
      a.flight === ev.flightNumber
      && a.item.trim().toLowerCase() === key
      && (!ev.orderNo || !a.orderNo || a.orderNo === ev.orderNo)
      && isPackaged(a));
    if (alloc) return { id: alloc.packagingId, status: alloc.status };
    const row = packagingRows.find((r) =>
      r.flight === ev.flightNumber
      && r.mealName.trim().toLowerCase() === key
      && (!ev.orderNo || !r.orderNo || r.orderNo === ev.orderNo)
      && ["Packaging Done", "Ready for Dispatch", "Dispatched"].includes(r.packagingStatus));
    return row ? { id: row.id, status: row.packagingStatus } : undefined;
  };

  const sendToPackaging = (event: DelayEvent) => {
    // Blocked before the check even runs — a flight whose meals are still being
    // cooked or awaiting QC has nothing to package yet.
    if (!productionReady(event)) {
      toast.error(
        `${event.flightNumber} — production is still in progress. ` +
        `Packaging opens once production and QC are complete.`,
      );
      return;
    }
    const items = dispatchItemsOf(event);
    const matched = items.map((it) => ({ it, row: packedRowFor(event, it.name) }));
    if (items.length > 0 && matched.every((m) => m.row)) {
      setPkgCheck({
        event,
        rows: matched.map((m) => ({
          id: m.row!.id,
          name: m.it.name,
          qty: m.it.qty,
          status: m.row!.status,
        })),
      });
      return;
    }
    sendToDispatch(event, 0, { goTo: "packaging" });
  };

  /** Open a packaged item where it lives — the dispatch board's packaging row,
   *  flashed on arrival. */
  const goToPackagingRow = (rowId: string) => {
    flagArrival({ target: "packaging-rows", ids: [rowId] });
    navigate("/dispatch");
  };

  /** Combined dispatch: every marked flight goes out in one click, each with
   *  its own dispatch record — the same records a single dispatch creates. */
  const dispatchMarked = (ids: string[]) => {
    const ready = ids
      .map((id) => delayEvents.find((e) => e.id === id))
      .filter((e): e is DelayEvent =>
        !!e && ["Approved", "Sent To Production", "Approval Pending"].includes(e.status));
    // Anything still cooking or awaiting QC drops out of the batch — reported
    // once rather than one refusal toast per flight.
    const blocked = ready.filter((e) => !productionReady(e));
    const clear = ready.filter(productionReady);
    if (blocked.length > 0) {
      toast.error(
        `${blocked.map((e) => e.flightNumber).join(", ")} — production is still in progress. ` +
        `Packaging opens once production and QC are complete.`,
      );
    }
    if (clear.length === 0) return;
    // Same packaging run as the single-flight action — each flight's already
    // packed items skip ahead on their own, the rest go through packaging.
    clear.forEach((ev, i) => sendToDispatch(ev, i, { goTo: "packaging" }));
  };

  /**
   * Roll a packaging run back. A flight that recovers, or a run raised in error,
   * previously left its allocations, packaging rows, dispatch record AND the
   * stock deduction behind with no way to undo any of it. This unwinds all four
   * and returns the delay to Approved so it can be routed again. Refused once
   * anything has actually been packed or dispatched — at that point the food has
   * moved and the correction belongs on the Dispatch board.
   */
  const cancelRun = (eventId: string) => {
    const ev = delayEvents.find((e) => e.id === eventId);
    if (!ev?.dispatchId) return;
    const rows = packagingRows.filter((r) => r.dspRef === ev.dispatchId);
    const allocs = pkgAllocations.filter((a) => (ev.packagingAllocationIds ?? []).includes(a.id));
    const moved = rows.some((r) => r.packagingStatus === "Dispatched")
      || allocs.some((a) => a.status === "Dispatched")
      || ev.status === "Dispatched";
    if (moved) {
      toast.error("Already dispatched — this run can no longer be cancelled.");
      return;
    }

    const at = stamp();
    // Put the stock back exactly as it was taken out.
    if (ev.stockDeductedAt) {
      const items = ev.fulfillment?.directReceive?.items?.map((i) => ({ name: i.name, qty: i.qty }))
        ?? (ev.menuItems ?? []).map((mi) => ({ name: mi.name, qty: mi.requiredQty }));
      items.forEach((it) => reduceInventoryStock(it.name, -it.qty));
      applyStockDeltas(items.map((it) => ({
        itemId: it.name,
        delta: it.qty,
        date: at.slice(0, 10),
        reference: ev.dispatchId!,
        label: "Delay Run Cancelled",
      })));
    }

    // Drop only the records this run raised — nothing else on those boards.
    const allocIds = new Set(allocs.map((a) => a.id));
    setPkgAllocations((prev) => prev.filter((a) => !allocIds.has(a.id)));
    setPackagingRows((prev) => prev.filter((r) => r.dspRef !== ev.dispatchId));
    setDispatchRecords((prev) => prev.filter((d) => d.id !== ev.dispatchId));
    setDelayEvents((prev) => prev.map((e) => e.id === eventId
      ? {
          ...e,
          status: "Approved" as DelayStatus,
          dispatchId: undefined,
          packagingAllocationIds: undefined,
          stockDeductedAt: undefined,
          updatedAt: at,
        }
      : e));
    setViewModalEventId(null);
    toast.success(`${ev.dispatchId} cancelled — stock restored, ${ev.flightNumber} back to Approved.`);
  };

  const closeEvent = (eventId: string) => {
    setDelayEvents((prev) =>
      prev.map((e) => e.id === eventId ? { ...e, status: "Closed", updatedAt: stamp() } : e),
    );
    toast.success("Delay event closed.");
    setView("list");
  };

  // The View modal covers the WHOLE submission: every flight logged under the
  // same delay id renders its own detail block.
  const viewModalBatch = viewModalEvent
    ? delayEvents.filter((e) =>
        viewModalEvent.batchId ? e.batchId === viewModalEvent.batchId : e.id === viewModalEvent.id)
    : [];

  return (
    <>
      <PageHeader
        title="Delay Management"
        subtitle="Track flight delays, fulfil refreshment requests, and manage delay dispatches"
        actions={
          view === "list" ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> Log Delay Event
            </Button>
          ) : (
            <Button variant="outline" onClick={() => { setView("list"); setActiveEventId(null); }}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to List
            </Button>
          )
        }
      />

      {view === "list" && (
        <DelayList
          events={delayEvents}
          approvals={delayApprovals}
          onOpenFulfillment={openFulfillment}
          onInstantPurchase={openInstantPurchase}
          onOpenModal={setViewModalEventId}
          onNavigate={navigate}
          onDispatchMarked={dispatchMarked}
          onSendToPackaging={sendToPackaging}
        />
      )}

      {view === "production" && activeEvent && (
        <DelayProductionScreen
          event={activeEvent}
          onProceed={(id) => setEventFulfillmentAndGo(id, "Instant Purchase")}
          onNeedsPurchase={(id, fulfillment, approval) => submitInstantPurchase(id, fulfillment, approval)}
          onSentToProduction={sentToProduction}
          batchEvents={batchEvents}
          onFulfilFromProduction={fulfilFromProduction}
          onSelectEvent={setActiveEventId}
          onSendToProduction={sendMarkedToProduction}
          onRecordFulfilment={recordFulfilment}
          autoOpenPurchase={autoOpenDrFor === activeEvent.id}
          onAutoOpenPurchaseDone={() => setAutoOpenDrFor(null)}
          onCancel={() => setView("list")}
          nextDrId={nextDrId}
          nextDaId={nextDaId}
        />
      )}

      {view === "fulfillment" && activeEvent && (
        <DelayFulfillmentScreen
          event={activeEvent}
          nextDrId={nextDrId}
          nextDaId={nextDaId}
          onSubmit={submitFulfillment}
          onCancel={() => setView("list")}
        />
      )}

      {view === "detail" && activeEvent && (
        <DelayDetailScreen
          event={activeEvent}
          approval={delayApprovals.find((a) => a.id === activeEvent.approvalId)}
          onOpenFulfillment={() => openFulfillment(activeEvent.id)}
          onClose={() => closeEvent(activeEvent.id)}
          onNavigate={navigate}
        />
      )}

      {/* ─── Log Delay Event Modal ─────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border sticky top-0 bg-background z-10">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4 text-primary" /> Log Delay Event
              <span className="font-mono font-normal text-sm text-muted-foreground ml-1">{nextDelId}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4">
            <DelayCreate
              nextId={nextDelId}
              nextDfrId={nextDfrId}
              onCreate={(evs) => { setCreateOpen(false); createEvents(evs); }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── View Modal (eye icon / row click) ─────────────────────────────── */}
      <Dialog
        open={!!viewModalEvent}
        onOpenChange={(open) => { if (!open) setViewModalEventId(null); }}
      >
        <DialogContent className="w-full max-w-3xl max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border sticky top-0 bg-background z-10">
            <DialogTitle className="flex items-center gap-3 text-base">
              <span className="font-mono">{viewModalEvent?.id}</span>
              {viewModalEvent && viewModalBatch.length <= 1 && delayBadge(viewModalEvent.status)}
              <span className="font-normal text-sm text-muted-foreground ml-1">
                {viewModalBatch.length > 1
                  ? `${viewModalBatch.length} flights — ${viewModalBatch.map((e) => e.flightNumber).join(", ")}`
                  : `${viewModalEvent?.flightNumber} · ${viewModalEvent?.sector}`}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4">
            {/* One detail block per flight in the submission. */}
            {viewModalBatch.map((ev, i) => (
              <div key={ev.id} className={i > 0 ? "mt-8 pt-6 border-t-2 border-border" : undefined}>
                {viewModalBatch.length > 1 && (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{ev.flightNumber} · {ev.sector}</span>
                    <span className="font-mono text-xs text-muted-foreground">{ev.id}</span>
                    {delayBadge(ev.status)}
                  </div>
                )}
                <DelayDetailScreen
                  event={ev}
                  approval={delayApprovals.find((a) => a.id === ev.approvalId)}
                  onOpenFulfillment={() => {
                    setViewModalEventId(null);
                    openFulfillment(ev.id);
                  }}
                  onCancelRun={() => cancelRun(ev.id)}
                  onClose={() => {
                    setViewModalEventId(null);
                    closeEvent(ev.id);
                  }}
                  onNavigate={(path) => { setViewModalEventId(null); navigate(path); }}
                />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Packaging check — every item is already packed ─────────────────── */}
      <Dialog open={!!pkgCheck} onOpenChange={(v) => { if (!v) setPkgCheck(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageOpen className="h-4 w-4 text-emerald-600" /> Already Packaged
              {pkgCheck && (
                <span className="font-mono text-xs text-muted-foreground">
                  {pkgCheck.event.id} · {pkgCheck.event.flightNumber}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {pkgCheck && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Every item on this flight is already packed, so packaging is skipped.
                Open a packaging id to see it on the board, or send the run straight
                to Dispatch — QC and dispatch then follow the usual process.
              </p>
              <div className="border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-xs uppercase tracking-wider">Packaging ID</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right w-20">Qty</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider w-40">Packaging Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pkgCheck.rows.map((r) => (
                      <TableRow key={`${r.id}-${r.name}`}>
                        <TableCell>
                          <button
                            type="button"
                            className="font-mono text-xs font-semibold text-primary underline decoration-dotted underline-offset-2 hover:opacity-80"
                            title="Open this packaging row"
                            onClick={() => { setPkgCheck(null); goToPackagingRow(r.id); }}
                          >
                            {r.id}
                          </button>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{r.name}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{r.qty}</TableCell>
                        <TableCell>{chipStatic(r.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPkgCheck(null)}>Cancel</Button>
                <Button
                  className="bg-teal-600 text-white hover:bg-teal-700"
                  onClick={() => {
                    const ev = pkgCheck.event;
                    setPkgCheck(null);
                    sendToDispatch(ev, 0, { goTo: "dispatch" });
                  }}
                >
                  <Truck className="h-4 w-4 mr-1.5" /> Send To Dispatch
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Small read-only status pill — used where a chip is shown outside the list. */
function chipStatic(label: string) {
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 whitespace-nowrap">
      {label}
    </span>
  );
}

// ─── Delay List / Dashboard ───────────────────────────────────────────────────

function DelayList({
  events, approvals, onOpenFulfillment, onInstantPurchase, onOpenModal, onNavigate, onDispatchMarked,
  onSendToPackaging,
}: {
  events: DelayEvent[];
  approvals: DelayApprovalRecord[];
  onOpenFulfillment: (id: string) => void;
  onInstantPurchase: (ev: DelayEvent) => void;
  onOpenModal: (id: string) => void;
  onNavigate: ReturnType<typeof useNavigate>;
  /** Send every marked (ready) flight to packaging in one go. */
  onDispatchMarked: (ids: string[]) => void;
  /** Run the packaging check for one flight and route it accordingly. */
  onSendToPackaging: (ev: DelayEvent) => void;
}) {
  const [search, setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterFrom, setFilterFrom]     = useState("");
  const [filterTo, setFilterTo]         = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (filterStatus !== "all" && e.status !== filterStatus) return false;
      if (filterFrom && e.flightDate < filterFrom) return false;
      if (filterTo   && e.flightDate > filterTo)   return false;
      if (q && ![e.id, e.flightNumber, e.sector, e.reason, e.orderNo].some((f) => f.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [events, search, filterStatus, filterFrom, filterTo]);

  const { productionEntries: allProductionOrders } = useWorkflow();
  // Read-only: the dispatch record raised for a packaging run drives the Status
  // column's packaging → dispatch chain, and the packaging board says when the
  // delay's own allocations are actually packed.
  const [dispatchRecords] = usePersistedState<DispatchRecordLike[]>("dispatch-records", []);
  const [pkgAllocations] = usePersistedState<PackagingAllocation[]>("packaging-allocations", []);
  const [packagingRows] = usePersistedState<PackagingRowLike[]>("dispatch-packaging-rows", []);

  // One row per delay submission: flights logged together share a batchId, so
  // they show under ONE delay id with a single Fulfil action for the whole set.
  const groups = useMemo(() => {
    const map = new Map<string, DelayEvent[]>();
    const order: string[] = [];
    for (const e of filtered) {
      const key = e.batchId ?? e.id;
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key)!.push(e);
    }
    return order.map((k) => ({ key: k, events: map.get(k)! }));
  }, [filtered]);

  // ── Derived status: which approval queues the event still waits on ────────
  // Routed parts each carry an approval somewhere else in the system — Delay
  // Refreshment (stock / production fulfilment), Production Order, Purchase
  // Req. While any is undecided the row reads "Pending (…)"; each clears on its
  // own approval, and when none remain the event reads Approved.
  const prs = getPurchaseRequisitions();
  const pendingSources = (ev: DelayEvent): string[] => {
    const out = new Set<string>();
    for (const r of ev.fulfilmentRefs ?? []) {
      if (r.refKind === "delay-approval") {
        const a = approvals.find((x) => x.id === r.ref);
        // A ghost instant-purchase approval (record cleared) doesn't block —
        // the flow re-raises a real requisition instead.
        if (!a && r.source === "Instant Purchase") continue;
        if (!a || a.status === "Pending") {
          out.add(r.source === "Stock" ? "Stock" : r.source === "Instant Purchase" ? "Purchase" : "Production");
        }
      } else if (r.refKind === "production-order") {
        const ids = r.ref.split(",").map((s) => s.trim()).filter(Boolean);
        if (ids.some((id) => allProductionOrders.find((o) => o.id === id)?.status === "Pending")) {
          out.add("Production");
        }
      } else if (r.refKind === "purchase-requisition") {
        // Ghost refs (requisition cleared from storage) don't block dispatch.
        const pr = prs.find((p) => p.id === r.ref);
        if (pr && /pending|draft/i.test(pr.status)) out.add("Purchase");
      }
    }
    return Array.from(out);
  };
  const chip = (label: string, cls: string) => (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      cls,
    )}>
      {label}
    </span>
  );
  const CHIP_PENDING  = "border-amber-200 bg-amber-50 text-amber-700";
  const CHIP_DONE     = "border-emerald-200 bg-emerald-50 text-emerald-700";
  const CHIP_WORKING  = "border-indigo-200 bg-indigo-50 text-indigo-700";

  /** Was the referenced Delay Refreshment approval decided yet? */
  const approvalPending = (refIds: { ref: string }[]) =>
    refIds.some((r) => {
      const a = approvals.find((x) => x.id === r.ref);
      return !a || a.status === "Pending";
    });

  /** Column 1 — the STOCK leg only: stock fulfilment Pending → Approved;
   *  other stages fall back to the base badge. */
  const stockLabelsOf = (ev: DelayEvent): string[] => {
    // Dispatch states live in the Dispatch Status column, not here.
    if (["Sent To Packaging", "Sent To Dispatch", "Dispatched"].includes(ev.status)) return [];
    const inFlight = ["Approval Pending", "Sent To Production", "Approved"].includes(ev.status);
    if (!inFlight) return [ev.status];
    const refs = (ev.fulfilmentRefs ?? []).filter(
      (r) => r.refKind === "delay-approval" && r.source === "Stock",
    );
    if (refs.length > 0) {
      return [`Stock Fulfillment ${approvalPending(refs) ? "Pending" : "Completed"}`];
    }
    // Routed elsewhere (production / purchase) — this column has nothing to
    // add; those columns tell the story. Unrouted events show their own state.
    return (ev.fulfilmentRefs ?? []).length > 0 ? [] : [ev.status];
  };

  /** Column 2 — everything production: fulfilment from finished production
   *  (Pending → Approved) and the production-order route (approval → cooking
   *  → done, QC incl.). Empty when the flight has no production leg. */
  const productionLabelsOf = (ev: DelayEvent): string[] => {
    const out: string[] = [];
    const pf = (ev.fulfilmentRefs ?? []).filter(
      (r) => r.refKind === "delay-approval" && r.source === "Production",
    );
    if (pf.length > 0) {
      out.push(`Prod. Fulfillment ${approvalPending(pf) ? "Pending" : "Completed"}`);
    }
    const refs = (ev.fulfilmentRefs ?? []).filter((r) => r.refKind === "production-order");
    if (refs.length > 0) {
      const ids = refs.flatMap((r) => r.ref.split(",").map((s) => s.trim()).filter(Boolean));
      const orders = ids.map((id) => allProductionOrders.find((o) => o.id === id));
      if (orders.some((o) => !o || o.status === "Pending")) out.push("Production Pending");
      else if (orders.every((o) => o!.status === "Completed" && !!o!.qcPassedAt)) out.push("Production Completed");
      else out.push("In Production");
    }
    return out;
  };

  /**
   * Column 4 — the packaging → dispatch leg:
   *   Sent To Packaging → Packaging Done → Ready for Dispatch → Sent To Dispatch
   *
   * Derived from the run's OWN records — its packaging rows and its packaging
   * allocations — with the dispatch record as an accelerator. Reading the record
   * alone stalled runs it never advanced: it only moves when someone acts on the
   * Dispatch board, and a run whose rows are all packed never surfaces there
   * until they are. The rows are the ground truth for where the food is.
   */
  const dispatchLabelOf = (ev: DelayEvent): string => {
    if (ev.status === "Dispatched") return "Sent To Dispatch";
    const s = (dispatchRecords.find((d) => d.id === ev.dispatchId)?.status ?? "Preparing").toLowerCase();
    if (s === "dispatched")          return "Sent To Dispatch";
    if (s === "ready for dispatch")  return "Ready for Dispatch";

    // The run's own packaging lines, and the board rows for its cooked items.
    const rows = ev.dispatchId ? packagingRows.filter((r) => r.dspRef === ev.dispatchId) : [];
    const allocs = pkgAllocations.filter((a) => (ev.packagingAllocationIds ?? []).includes(a.id));
    if (rows.length > 0 && rows.every((r) => r.packagingStatus === "Dispatched")) return "Sent To Dispatch";

    const PACKED_ROW = ["Packaging Done", "Ready for Dispatch", "Dispatched"];
    const rowsPacked = rows.length > 0 && rows.every((r) => PACKED_ROW.includes(r.packagingStatus));
    const allocsPacked = allocs.length === 0 || allocs.every(isPackaged);
    if (rowsPacked && allocsPacked) {
      // Everything is packed. QC on the Dispatch board is the last gate, so the
      // run is ready to go the moment the board reports it prepared.
      return s === "prepared" || s === "ready for qc" ? "Ready for Dispatch" : "Packaging Done";
    }
    if (s === "prepared" || s === "ready for qc") return "Packaging Done";
    return "Sent To Packaging";
  };

  /**
   * Purchase references whose backing record still EXISTS. Ghost refs (their
   * requisition / approval cleared from storage) are ignored — otherwise a lost
   * requisition would read "Pending" forever with nothing in the queue, and the
   * flow could never re-raise one.
   */
  const livePurchaseRefs = (ev: DelayEvent) => {
    const refs = ev.fulfilmentRefs ?? [];
    return {
      prRefs: refs.filter((r) => r.refKind === "purchase-requisition"
        && prs.some((p) => p.id === r.ref)),
      ipRefs: refs.filter((r) => r.refKind === "delay-approval" && r.source === "Instant Purchase"
        && approvals.some((a) => a.id === r.ref)),
    };
  };

  /** Column 3 — the purchase route: requisition OR instant-purchase approval,
   *  pending → approved. */
  const purchaseLabelsOf = (ev: DelayEvent): string[] => {
    const { prRefs, ipRefs } = livePurchaseRefs(ev);
    if (prRefs.length === 0 && ipRefs.length === 0) return [];
    const pending =
      prRefs.some((r) => {
        const pr = prs.find((p) => p.id === r.ref);
        return !pr || /pending|draft/i.test(pr.status);
      })
      || approvalPending(ipRefs);
    if (pending) return ["Purchase Req Pending"];
    // Approved — the requisition is handed to the Purchase Requisition module,
    // where "Initiate Purchase" opens Direct Receive and the goods are received
    // against it. The leg only reads approved once that receipt lands: the
    // requisition's own received quantity is the signal, not a copy of it here.
    const fullyReceived = prRefs.length > 0 && prRefs.every((r) => {
      const pr = prs.find((p) => p.id === r.ref);
      if (!pr) return false;
      const { ordered, received } = prReceived(pr);
      return ordered > 0 && received >= ordered;
    });
    if (fullyReceived || ev.fulfillment?.directReceive) return ["Purchase Fulfillment Completed"];
    return ["Sent To Purchase Requisition"];
  };

  /** One renderer for every status label — chips for the routed states, the
   *  standard badge for base flow states. */
  const STATUS_CHIP_CLS: Record<string, string> = {
    "Stock Fulfillment Pending": CHIP_PENDING,
    "Stock Fulfillment Completed": CHIP_DONE,
    "Prod. Fulfillment Pending": CHIP_PENDING,
    "Prod. Fulfillment Completed": CHIP_DONE,
    "Production Pending": CHIP_PENDING,
    "In Production": CHIP_WORKING,
    "Production Completed": CHIP_DONE,
    "Purchase Req Pending": CHIP_PENDING,
    "Sent To Purchase Requisition": CHIP_WORKING,
    "Purchase Fulfillment Completed": CHIP_DONE,
    "Sent To Packaging": CHIP_WORKING,
    "Packaging Done": CHIP_DONE,
    "Ready for Dispatch": CHIP_DONE,
    "Pending": CHIP_PENDING,
  };
  const renderStatus = (label: string) =>
    STATUS_CHIP_CLS[label] ? chip(label, STATUS_CHIP_CLS[label]) : delayBadge(label as DelayStatus);

  /**
   * Every routed leg has actually FINISHED — stock issued, production cooked and
   * QC-passed, purchased goods received. Read off the very labels the three
   * status columns show, so the button and the columns can never disagree: if a
   * column doesn't read "completed", packaging isn't open.
   *
   * An approved requisition is not a finished purchase — the goods still have to
   * be bought and received. Judging the purchase leg by its approval alone let a
   * flight reach packaging while its "Sent To Purchase Requisition" chip was
   * still showing.
   */
  const legsComplete = (ev: DelayEvent): boolean => {
    const unfinished = (labels: string[], done: string[]) => labels.some((l) => !done.includes(l));
    // Only the routed stock labels — an unrouted event falls back to its own
    // status here, which says nothing about a stock leg it never had.
    const stock = stockLabelsOf(ev).filter((l) => l.startsWith("Stock Fulfillment"));
    if (unfinished(stock, ["Stock Fulfillment Completed"])) return false;
    if (unfinished(productionLabelsOf(ev), ["Prod. Fulfillment Completed", "Production Completed"])) return false;
    if (unfinished(purchaseLabelsOf(ev), ["Purchase Fulfillment Completed"])) return false;
    return true;
  };

  /**
   * Dispatchable ONLY when every routed leg has completed AND every production
   * order raised for the flight is Completed with QC passed — preparing
   * production can never be packaged. Packaging then happens exactly as today.
   */
  const readyToDispatch = (ev: DelayEvent): boolean => {
    // Any in-flight state qualifies — the routed approvals are the truth, not
    // the raw label (which can lag when several fulfilments were raised).
    if (!["Approved", "Sent To Production", "Approval Pending"].includes(ev.status)) return false;
    if (pendingSources(ev).length > 0) return false;
    if (!legsComplete(ev)) return false;
    const ids = ev.productionOrderIds ?? [];
    if (ids.length > 0) {
      return ids.every((id) => {
        const o = allProductionOrders.find((x) => x.id === id);
        return o?.status === "Completed" && !!o.qcPassedAt;
      });
    }
    // No production route — dispatchable once its approvals are all decided.
    return (ev.fulfilmentRefs ?? []).length > 0 || ev.status === "Approved";
  };

  // ── Marked dispatch: tick several ready flights → one combined Dispatch ───
  const [markedDispatch, setMarkedDispatch] = useState<string[]>([]);

  // ── Pagination ────────────────────────────────────────────────────────────
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  // Filtering can shrink the list under the current page — step back rather
  // than render an empty table.
  useEffect(() => { setPage(1); }, [search, filterStatus, filterFrom, filterTo]);
  const safePage = Math.min(page, pageCount);
  const paged = groups.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const active     = events.filter(isActiveDelayEvent).length;
  const pending    = events.filter((e) => e.status === "Approval Pending").length;
  // A run in packaging has left the fulfilment stage — it belongs with the
  // dispatch tally, not the active one, exactly as "Sent To Dispatch" did before
  // the packaging stage was split out of it.
  const inDispatchStage = (e: DelayEvent) =>
    ["Sent To Packaging", "Sent To Dispatch", "Dispatched"].includes(e.status);
  const dispatched = events.filter(inDispatchStage).length;

  // ── At-a-glance breakdowns for the KPI cards ────────────────────────────────
  // Extra stage counts + passenger tallies so each card reads like the dashboard
  // KPIs: a headline number, a "pax affected/served" stat pill, and a small
  // two-column breakdown of the sub-stages that make up the total.
  const pendingEvents      = events.filter((e) => e.status === "Approval Pending");
  const activeEvents       = events.filter(isActiveDelayEvent);
  const dispatchedEvents   = events.filter(inDispatchStage);
  const dispatchedOnly     = events.filter((e) => e.status === "Dispatched").length;
  const sentToDispatch     = events.filter((e) =>
    e.status === "Sent To Dispatch" || e.status === "Sent To Packaging").length;
  const closed             = events.filter((e) => e.status === "Closed").length;
  const fulfillmentPending = events.filter((e) => e.status === "Fulfillment Pending").length;
  const inProduction       = events.filter((e) => e.status === "Sent To Production").length;
  const readyStage         = events.filter((e) => e.status === "Approved").length + sentToDispatch;
  const sumPax             = (arr: DelayEvent[]) => arr.reduce((s, e) => s + e.paxCount, 0);
  const totalPax           = sumPax(events);
  const activePax          = sumPax(activeEvents);
  const pendingPax         = sumPax(pendingEvents);
  const dispatchedPax      = sumPax(dispatchedEvents);
  const pendingUrgent      = pendingEvents.filter((e) => e.delayDurationHours > 6).length;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Total Events" value={events.length} icon={Clock}
          tone="violet" variant="aurora"
          sub={`${totalPax.toLocaleString()} pax affected`}
          hint="All logged delay events and the passengers affected."
          breakdown={[
            { label: "Active",     value: active,     icon: "⚠️" },
            { label: "Pending",    value: pending,    icon: "📩" },
            { label: "Dispatched", value: dispatched, icon: "🚚" },
            { label: "Closed",     value: closed,     icon: "✓" },
          ]}
        />
        <KpiCard
          label="Active" value={active} icon={AlertTriangle}
          tone="amber" variant="aurora"
          sub={`${activePax.toLocaleString()} pax affected`}
          hint="Delay events still moving through fulfilment to dispatch."
          breakdown={[
            { label: "Fulfilment", value: fulfillmentPending, icon: "🍽️" },
            { label: "Approval",   value: pending,            icon: "📩" },
            { label: "Production", value: inProduction,       icon: "👨‍🍳" },
            { label: "Ready",      value: readyStage,         icon: "📦" },
          ]}
        />
        <KpiCard
          label="Pending Approval" value={pending} icon={Send}
          tone="rose" variant="aurora"
          sub={`${pendingPax.toLocaleString()} pax affected`}
          hint="Refreshment requests awaiting sign-off before dispatch."
          breakdown={[
            { label: "Urgent (>6h)", value: pendingUrgent,            icon: "🔴" },
            { label: "Standard",     value: pending - pendingUrgent,  icon: "🕒" },
          ]}
        />
        <KpiCard
          label="Dispatched" value={dispatched} icon={Truck}
          tone="green" variant="aurora"
          sub={`${dispatchedPax.toLocaleString()} pax served`}
          hint="Delay refreshments already sent to or dispatched on the aircraft."
          breakdown={[
            { label: "Dispatched",       value: dispatchedOnly, icon: "🚚" },
            { label: "Sent To Dispatch", value: sentToDispatch, icon: "📦" },
            { label: "Closed",           value: closed,         icon: "✓" },
          ]}
        />
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by event ID, flight, sector, reason…"
          className="h-9 flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {(["Received","Validated","Fulfillment Pending","Approval Pending","Approved","Rejected","Sent To Production","Sent To Packaging","Sent To Dispatch","Dispatched","Closed"] as DelayStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">From</span>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring tabular-nums w-36"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">To</span>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring tabular-nums w-36"
          />
        </div>
        {(filterFrom || filterTo) && (
          <Button size="sm" variant="ghost" className="h-9 text-xs text-muted-foreground"
            onClick={() => { setFilterFrom(""); setFilterTo(""); }}>
            Clear dates
          </Button>
        )}
        <div className="ml-auto">
          <ListExportActions
            table={() => ({
              title: "Delay Events",
              fileName: `delay-events-${filterFrom || "all"}${filterTo && filterTo !== filterFrom ? `_to_${filterTo}` : ""}`,
              meta: listExportFilterMeta([
                ["Dates", (filterFrom || filterTo) && `${filterFrom || "…"} → ${filterTo || "…"}`],
                ["Status", filterStatus !== "all" && filterStatus],
                ["Search", search.trim() || false],
              ]),
              columns: ["Event", "Flight", "Sector", "Order", "Flight Date", "Delay (h)", "PAX", "Reason", "Status"],
              numericCols: [5, 6],
              rows: filtered.map((e) => [
                e.id, e.flightNumber, e.sector, e.orderNo, e.flightDate,
                e.delayDurationHours, e.paxCount, e.reason, e.status,
              ]),
            })}
          />
        </div>
      </div>

      {/* Combined dispatch for the marked ready flights — one click, every
          marked flight goes to the Dispatch table exactly as a single one. */}
      {markedDispatch.length > 0 && (
        <div className="flex justify-end mb-2">
          <Button
            className="h-8 text-xs bg-teal-600 text-white hover:bg-teal-700"
            onClick={() => { onDispatchMarked(markedDispatch); setMarkedDispatch([]); }}
          >
            <PackageOpen className="h-3.5 w-3.5 mr-1.5" /> Send To Packaging ({markedDispatch.length})
          </Button>
        </div>
      )}

      <div className="border border-border rounded-md overflow-x-auto">
        {/* Tighter cell padding — the eleven columns should fit a normal
            desktop width without a horizontal scroll. */}
        <Table className="[&_th]:px-2 [&_td]:px-2">
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wider w-28">Event ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-center">Delay</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Meal Type</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Stock Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Production Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Purchase Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-10">
                  No delay events found.
                </TableCell>
              </TableRow>
            ) : (
              paged.map((g) => {
                const ev0 = g.events[0];
                const multi = g.events.length > 1;
                // ONE Fulfil for the whole submission — it opens the production
                // check worklist covering every flight in the batch.
                const pendingFulfil = g.events.find((e) => e.status === "Fulfillment Pending");
                // Instant Purchase RAISES the requisition — that is all it does
                // now. Buying against it happens in the Purchase Requisition
                // module ("Initiate Purchase" → Direct Receive), so once a
                // requisition exists this column is a status only. Two entry
                // points to the same spot buy is how the two drifted apart.
                const canPurchase = (e: DelayEvent) => {
                  if (!["Approved", "Sent To Packaging", "Sent To Dispatch"].includes(e.status)) return false;
                  if ((e.productionPlan?.totalPurchase ?? 0) <= 0) return false;
                  if (e.fulfillment?.directReceive) return false;
                  return purchaseLabelsOf(e).length === 0;
                };
                // The delay id's marking box covers every dispatch-ready flight
                // under it — tick the id, the whole submission joins the
                // combined dispatch.
                const readyIds = g.events.filter(readyToDispatch).map((e) => e.id);
                const allMarked = readyIds.length > 0 && readyIds.every((id) => markedDispatch.includes(id));
                return (
                <TableRow
                  key={g.key}
                  className="hover:bg-muted/30 cursor-pointer"
                  onClick={() => onOpenModal(ev0.id)}
                >
                  <TableCell className="font-mono text-xs font-semibold text-primary align-top">
                    <div className="flex items-start gap-2">
                      <span onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={allMarked}
                          disabled={readyIds.length === 0}
                          onCheckedChange={(v) => setMarkedDispatch((prev) => v === true
                            ? [...prev, ...readyIds.filter((id) => !prev.includes(id))]
                            : prev.filter((id) => !readyIds.includes(id)))}
                          aria-label={`Mark ${ev0.id} for combined dispatch`}
                          title={readyIds.length === 0
                            ? "Available once every approval has cleared and production is complete"
                            : "Mark for combined dispatch"}
                        />
                      </span>
                      <span className="whitespace-nowrap">
                        {ev0.id}
                        {multi && (
                          <div className="font-sans font-normal text-[10px] text-muted-foreground">
                            {g.events.length} flights
                          </div>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  {/* Per-flight blocks share a fixed min height so every column's
                      lines stay level with the flight they belong to. */}
                  <TableCell className="align-top">
                    {g.events.map((ev) => (
                      <div key={ev.id} className="min-h-[2.25rem] whitespace-nowrap leading-tight flex flex-col justify-center">
                        <div className="font-medium">{ev.flightNumber}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{ev.orderNo}</div>
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs align-top">
                    {g.events.map((ev) => (
                      <div key={ev.id} className="min-h-[2.25rem] whitespace-nowrap flex items-center">{ev.flightDate}</div>
                    ))}
                  </TableCell>
                  <TableCell className="text-xs align-top">
                    {g.events.map((ev) => (
                      <div key={ev.id} className="min-h-[2.25rem] whitespace-nowrap flex items-center">{ev.sector}</div>
                    ))}
                  </TableCell>
                  {/* Delay length, and how long is left before the revised
                      departure — the clock the whole run is racing. */}
                  <TableCell className="text-center tabular-nums font-semibold text-warning align-top">
                    {g.events.map((ev) => (
                      <div key={ev.id} className="min-h-[2.25rem] flex flex-col items-center justify-center gap-0.5">
                        <span>{ev.delayDurationHours}h</span>
                        {departureChip(ev)}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className="align-top">
                    {g.events.map((ev) => (
                      <div key={ev.id} className="min-h-[2.25rem] text-xs text-muted-foreground flex items-center">
                        {ev.mealType ?? "—"}
                      </div>
                    ))}
                  </TableCell>
                  {/* Three status columns — one chip per distinct state across
                      the batch, no flight labels. A column with no routed
                      flight shows a plain dash. */}
                  <TableCell className="align-top">
                    {(() => {
                      const labels = Array.from(new Set(g.events.flatMap(stockLabelsOf)));
                      return labels.length === 0
                        ? <span className="text-xs text-muted-foreground">—</span>
                        : labels.map((l) => (
                          <div key={l} className="mb-1 last:mb-0">{renderStatus(l)}</div>
                        ));
                    })()}
                  </TableCell>
                  <TableCell className="align-top">
                    {(() => {
                      const labels = Array.from(new Set(g.events.flatMap(productionLabelsOf)));
                      return labels.length === 0
                        ? <span className="text-xs text-muted-foreground">—</span>
                        : labels.map((l) => (
                          <div key={l} className="mb-1 last:mb-0">{renderStatus(l)}</div>
                        ));
                    })()}
                  </TableCell>
                  <TableCell className="align-top">
                    {(() => {
                      // The balance production couldn't cover is bought
                      // separately — the button raises that requisition, and
                      // disappears the moment one exists. From then on the cell
                      // is the requisition's status: Pending → Approved.
                      const buyable = g.events.filter(canPurchase);
                      const labels = Array.from(new Set(g.events.flatMap(purchaseLabelsOf)));
                      if (labels.length === 0 && buyable.length === 0) {
                        return <span className="text-xs text-muted-foreground">—</span>;
                      }
                      return (
                        <>
                          {labels.map((l) => (
                            <div key={l} className="mb-1 last:mb-0">{renderStatus(l)}</div>
                          ))}
                          {buyable.map((ev) => (
                            <div key={ev.id} className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                              <Button size="sm" variant="outline"
                                className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                                onClick={() => onInstantPurchase(ev)}
                                title={`Spot-buy the uncovered balance — ${ev.flightNumber}`}>
                                <ShoppingCart className="h-3 w-3 mr-1" />
                                Instant Purchase{multi ? ` · ${ev.flightNumber}` : ""}
                              </Button>
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </TableCell>
                  {/* Status — the packaging → dispatch leg, in order:
                      Send To Packaging → Sent To Packaging → Packaging Done →
                      Ready for Dispatch → Send To Dispatch → Sent To Dispatch.
                      The chips are read off the run's own dispatch record, so
                      the column follows the real packaging pipeline. */}
                  <TableCell className="align-top">
                    {(() => {
                      // Not in the pipeline yet: either still waiting on a
                      // fulfilment route, or ready for the packaging run.
                      // ONE button per flight — a submission can log the same
                      // flight more than once, and two identical buttons side by
                      // side is a coin toss for the user. The button sends every
                      // ready event on that flight.
                      const readyAll = g.events.filter((e) => !e.dispatchId && readyToDispatch(e));
                      const byFlight = new Map<string, DelayEvent[]>();
                      for (const e of readyAll) {
                        const list = byFlight.get(e.flightNumber);
                        if (list) list.push(e); else byFlight.set(e.flightNumber, [e]);
                      }
                      const ready = Array.from(byFlight.values());
                      const stillPending = g.events.some((e) =>
                        !e.dispatchId
                        && !["Dispatched", "Rejected", "Closed"].includes(e.status)
                        && !readyToDispatch(e));
                      const inPipeline = g.events.filter((e) => !!e.dispatchId || e.status === "Dispatched");
                      const labels = Array.from(new Set(inPipeline.map(dispatchLabelOf)));
                      // Once everything is packed the run leaves this page — the
                      // loading, QC and dispatch itself happen on the Dispatch
                      // board, so this opens it there rather than pretending to
                      // dispatch from here.
                      const dispatchable = inPipeline.filter((e) =>
                        ["Packaging Done", "Ready for Dispatch"].includes(dispatchLabelOf(e)));
                      if (labels.length === 0 && ready.length === 0 && !stillPending) {
                        return <span className="text-xs text-muted-foreground">—</span>;
                      }
                      return (
                        <>
                          {stillPending && (
                            <div className="mb-1 last:mb-0">{renderStatus("Pending")}</div>
                          )}
                          {labels.map((l) => (
                            <div key={l} className="mb-1 last:mb-0">{renderStatus(l)}</div>
                          ))}
                          {/* Packaging opens ONLY once every approval has cleared
                              and production (incl. QC) is complete. */}
                          {ready.map((evs) => {
                            const ev = evs[0];
                            const marked = evs.every((e) => markedDispatch.includes(e.id));
                            return (
                            <div key={ev.flightNumber} className="mt-1.5 first:mt-0" onClick={(e) => e.stopPropagation()}>
                              <Button size="sm" className="h-7 text-xs bg-teal-600 text-white hover:bg-teal-700"
                                disabled={marked}
                                onClick={() => evs.forEach((e) => onSendToPackaging(e))}
                                title={marked
                                  ? "Included in the combined packaging run"
                                  : `Check packaging for ${ev.flightNumber}`}>
                                Send To Packaging{multi ? ` · ${ev.flightNumber}` : ""}
                                <PackageOpen className="h-3 w-3 ml-1" />
                              </Button>
                            </div>
                            );
                          })}
                          {dispatchable.map((ev) => (
                            <div key={`d-${ev.id}`} className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                              <Button size="sm" className="h-7 text-xs bg-teal-600 text-white hover:bg-teal-700"
                                onClick={() => onNavigate("/dispatch")}
                                title={`Load, QC and dispatch ${ev.flightNumber} on the Dispatch board`}>
                                Open in Dispatch{multi ? ` · ${ev.flightNumber}` : ""}
                                <Truck className="h-3 w-3 ml-1" />
                              </Button>
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </TableCell>
                  {/* Action — Fulfil (whole submission) then View, on one line. */}
                  <TableCell className="text-right align-top" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                      {pendingFulfil && (
                        <Button size="sm" className="h-7 text-xs"
                          onClick={() => onOpenFulfillment(pendingFulfil.id)}>
                          Fulfil <ChevronRight className="h-3 w-3 ml-0.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => onOpenModal(ev0.id)} title="View details">
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, groups.length)} of {groups.length}
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm" variant="outline" className="h-7 text-xs"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
              >
                Previous
              </Button>
              <span className="px-2 text-xs text-muted-foreground tabular-nums">
                Page {safePage} of {pageCount}
              </span>
              <Button
                size="sm" variant="outline" className="h-7 text-xs"
                disabled={safePage >= pageCount}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Delay Create ─────────────────────────────────────────────────────────────

// Soft, eye-soothing tints cycled across the per-flight cards so each flight is
// easy to tell apart at a glance.
const CARD_TONES = [
  "bg-sky-50/70 border-sky-200",
  "bg-emerald-50/70 border-emerald-200",
  "bg-violet-50/70 border-violet-200",
  "bg-amber-50/70 border-amber-200",
  "bg-rose-50/70 border-rose-200",
  "bg-teal-50/70 border-teal-200",
];

function DetailCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value ?? "—"}</div>
    </div>
  );
}

function DelayCreate({
  nextId, nextDfrId, onCreate,
}: {
  nextId: string;
  nextDfrId: string;
  onCreate: (evs: DelayEvent[]) => void;
}) {
  const navigate     = useNavigate();
  const flightOrders = useFlightOrders();
  const dispatched   = useMemo(() => flightOrders.filter((o) => o.status === "Dispatched"), [flightOrders]);

  const [mealPlanCards] = usePersistedState<MealCardMinimal[]>("meal-planning-config", []);
  // Read the same dispatch records the Dispatch page persists, so we can surface
  // each selected flight's Dispatch ID + previously dispatched meal count.
  const [dispatchRecords] = usePersistedState<DispatchRecordLike[]>("dispatch-records", []);
  const dispatchFor = (flight: string) => dispatchRecords.find((r) => r.flightNos.includes(flight));
  // Delay event date — auto-selected to the current date.
  const [eventDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [selectedOrderIds, setSelectedOrderIds]   = useState<string[]>([]);
  // Delay duration is captured PER flight (keyed by flight order id) so different
  // flights can be delayed by different hours.
  const [durationByFlight, setDurationByFlight]   = useState<Record<string, string>>({});
  // Meal types are captured PER flight (keyed by flight order id) so each flight
  // can have its own meal selection.
  const [mealsByFlight, setMealsByFlight]         = useState<Record<string, string[]>>({});
  // Delay reason is captured PER flight (keyed by flight order id).
  const [reasonByFlight, setReasonByFlight]       = useState<Record<string, string>>({});
  const [reasonCustomByFlight, setReasonCustomByFlight] = useState<Record<string, string>>({});
  const [reportedBy, setReportedBy]             = useState("");

  // Dynamic items for "Other" meal type — each row is picked from the item
  // dropdown, which also brings the item's UoM and cost price with it.
  const [otherItems, setOtherItems] = useState<Array<{ name: string; qty: number; unitCost: number; uom?: string }>>([
    { name: "", qty: 0, unitCost: 0 },
  ]);

  /** Everything servable — the pool behind every item dropdown on this form. */
  const itemOptions = useMemo(() => buildMenuItemOptions(mealPlanCards), [mealPlanCards]);

  // Per-flight menu override, set only when the user edits the menu in Change
  // Menu. Absent → the day-wise plan derivation is used exactly as before.
  const [menuOverride, setMenuOverride] = useState<Record<string, DelayMenuItem[]>>({});
  // How the override splits across meal types — mirrors the Change Menu cards
  // (incl. drags) so the preview shows segregated sections, not one flat list.
  const [menuOverrideGroups, setMenuOverrideGroups] = useState<Record<string, Array<{ type: string; items: DelayMenuItem[] }>>>({});
  /** Flight order id whose Change Menu modal is open. */
  const [menuEditor, setMenuEditor] = useState<string | null>(null);
  const [menuDraft, setMenuDraft] = useState<DelayMenuItem[]>([]);
  /** "Configure Items" modal for the Other meal type. */
  const [otherConfigOpen, setOtherConfigOpen] = useState(false);

  // Multiple flights + meal types can be selected. The "primary" (first) of each
  // drives the live preview; on save we fan out one delay event per flight × meal
  // combination, so every downstream screen keeps working on single-value events.
  const selectedOrders = dispatched.filter((o) => selectedOrderIds.includes(o.id));
  const hoursFor = (id: string) => Number(durationByFlight[id]) || 0;
  /**
   * The day whose menu config this flight is served, once its delay is applied.
   * A late-night departure pushed past midnight takes the NEXT day's config —
   * everything that reads the day-wise plan goes through here so the preview,
   * Change Menu and the saved items all agree.
   */
  const serviceDateFor = (o: { id: string; date: string; etd?: string }) =>
    delayedServiceDate(o.date, o.etd, hoursFor(o.id));
  /** One delay for the whole submission — typing on any flight fills them all. */
  const [sameDelay, setSameDelay] = useState(false);
  const setDurationFor = (id: string, v: string) =>
    setDurationByFlight((prev) => sameDelay
      ? { ...prev, ...Object.fromEntries(selectedOrderIds.map((k) => [k, v])) }
      : { ...prev, [id]: v });
  /** Ticking it copies the first flight's delay onto every other flight and
   *  keeps them in step; unticking leaves the values as they are to edit. */
  const toggleSameDelay = (on: boolean) => {
    setSameDelay(on);
    if (!on) return;
    const seed = durationByFlight[selectedOrders[0]?.id ?? ""]
      ?? selectedOrderIds.map((k) => durationByFlight[k]).find(Boolean)
      ?? "";
    setDurationByFlight((prev) => ({
      ...prev,
      ...Object.fromEntries(selectedOrderIds.map((k) => [k, seed])),
    }));
  };
  const mealsFor = (id: string) => mealsByFlight[id] ?? [];
  const toggleMealFor = (id: string, mt: string) => {
    setMealsByFlight((prev) => {
      const cur = prev[id] ?? [];
      return { ...prev, [id]: cur.includes(mt) ? cur.filter((x) => x !== mt) : [...cur, mt] };
    });
    if (mt === "Other" && otherItems.length === 0) setOtherItems([{ name: "", qty: 0, unitCost: 0 }]);
  };
  const reasonFor = (id: string) => reasonByFlight[id] ?? "";
  const effectiveReasonFor = (id: string) =>
    reasonFor(id) === "Other" ? (reasonCustomByFlight[id] ?? "").trim() : reasonFor(id);
  // Any selected flight using the "Other" meal type → show the manual items entry.
  const anyOther = selectedOrders.some((o) => mealsFor(o.id).includes("Other"));
  const toggleOrder = (id: string, on: boolean) => {
    setSelectedOrderIds((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
    // Default a newly-selected flight's delay to 2h (kept if already set).
    if (on) setDurationByFlight((prev) => (prev[id] ? prev : { ...prev, [id]: "2" }));
  };

  const otherTotal = otherItems.reduce((s, i) => s + i.qty * i.unitCost, 0);

  // Menu items for a given flight + meal (used by save's fan-out). Mirrors the
  // preview logic: "Other" draws from the manual item rows, otherwise from plan.
  const itemsFor = (order: typeof dispatched[number], meal: string, tp: number): DelayMenuItem[] =>
    meal === "Other"
      ? otherItems.filter((i) => i.name.trim() !== "").map((i) => ({ name: i.name.trim(), requiredQty: i.qty, uom: i.uom ?? "pcs", unitCost: i.unitCost }))
      : (tp > 0 ? menuItemsFromPlan(meal, serviceDateFor(order), tp, mealPlanCards) : []);

  const updateOtherItem = (idx: number, field: "qty" | "unitCost", val: string) => {
    setOtherItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: Number(val) || 0 } : it)));
  };
  const removeOtherItem = (idx: number) => setOtherItems((prev) => prev.filter((_, i) => i !== idx));

  /** Largest headcount among the selected flights — the "Other" qty prefill. */
  const maxHeadcount = selectedOrders.reduce((m, o) => Math.max(m, (o.pax ?? 0) + (o.crew ?? 0)), 0);
  const otherNames = otherItems.map((i) => optKey(i.name));

  /** Point an existing "Other" row at a different item from the dropdown. */
  const pickOtherItem = (idx: number, o: MenuItemOption) => {
    setOtherItems((prev) => prev.map((it, i) => (i === idx
      ? { name: o.name, uom: o.uom, unitCost: it.unitCost || o.unitCost, qty: it.qty || maxHeadcount }
      : it)));
  };

  /** Tick an item in the dropdown → add a row; untick → drop its row. */
  const toggleOtherOption = (o: MenuItemOption) => {
    setOtherItems((prev) => {
      const at = prev.findIndex((i) => optKey(i.name) === optKey(o.name));
      if (at >= 0) return prev.filter((_, i) => i !== at);
      // Reuse a still-blank row rather than leaving it stranded above the pick.
      const blank = prev.findIndex((i) => i.name.trim() === "");
      const row = { name: o.name, uom: o.uom, qty: maxHeadcount, unitCost: o.unitCost };
      return blank >= 0 ? prev.map((it, i) => (i === blank ? row : it)) : [...prev, row];
    });
  };

  // ── Change Menu ─────────────────────────────────────────────────────────────

  /** A flight's menu as it stands: the edited override, else the plan derivation. */
  const menuForFlight = (order: typeof dispatched[number], tp: number): DelayMenuItem[] =>
    menuOverride[order.id] ?? mealsFor(order.id).flatMap((meal) => itemsFor(order, meal, tp));

  // Cross-type drag & drop inside the Change Menu modal: per-group visual
  // additions and removals made by dragging a meal onto another type's card.
  const [groupExtras, setGroupExtras] = useState<Record<string, DelayMenuItem[]>>({});
  const [groupRemovals, setGroupRemovals] = useState<Record<string, string[]>>({});
  const [dragOverType, setDragOverType] = useState<string | null>(null);

  const openMenuEditor = (order: typeof dispatched[number], tp: number) => {
    setMenuDraft(menuForFlight(order, tp));
    setGroupExtras({});
    setGroupRemovals({});
    setMenuEditor(order.id);
  };

  const draftNames = menuDraft.map((it) => optKey(it.name));
  const draftHas = (name: string) => draftNames.includes(optKey(name));
  /** Add / remove one item from the combined menu being edited. */
  const toggleDraftItem = (it: DelayMenuItem) => {
    setMenuDraft((prev) => (prev.some((d) => optKey(d.name) === optKey(it.name))
      ? prev.filter((d) => optKey(d.name) !== optKey(it.name))
      : [...prev, it]));
  };
  const removeDraftItem = (name: string) =>
    setMenuDraft((prev) => prev.filter((d) => optKey(d.name) !== optKey(name)));
  const setDraftQty = (name: string, val: string) =>
    setMenuDraft((prev) => prev.map((d) => (optKey(d.name) === optKey(name)
      ? { ...d, requiredQty: Number(val) || 0 } : d)));

  /** Move a dragged meal from one meal-type card onto another. The item leaves
   *  its source group, appears in the target group and joins the combined menu. */
  const dropOnGroup = (target: string, from: string, item: DelayMenuItem) => {
    if (from === target) return;
    const key = optKey(item.name);
    setGroupExtras((prev) => {
      const next = { ...prev };
      next[from] = (next[from] ?? []).filter((d) => optKey(d.name) !== key);
      const cur = next[target] ?? [];
      if (!cur.some((d) => optKey(d.name) === key)) next[target] = [...cur, item];
      return next;
    });
    setGroupRemovals((prev) => {
      const next = { ...prev };
      next[target] = (next[target] ?? []).filter((n) => n !== key);
      if (!(next[from] ?? []).includes(key)) next[from] = [...(next[from] ?? []), key];
      return next;
    });
    if (!draftHas(item.name)) toggleDraftItem(item);
  };

  /** The Other card's rows — the Configure Items table, as menu items. */
  const otherBaseRows = (tp: number): DelayMenuItem[] =>
    otherItems.filter((i) => i.name.trim() !== "").map((i) => ({
      name: i.name.trim(), requiredQty: i.qty || tp, uom: i.uom ?? "pcs", unitCost: i.unitCost || undefined,
    }));

  /**
   * Group the applied draft by meal type exactly as the Change Menu cards show
   * it — base plan items minus removals plus drag/dropdown additions. An item
   * shown under two types (e.g. water in Dinner and Heavy Snacks) is attributed
   * to the first; anything selected but no longer on any card joins the first
   * group so nothing silently drops from the preview.
   */
  const groupedDraft = (order: typeof dispatched[number], tp: number): Array<{ type: string; items: DelayMenuItem[] }> => {
    const used = new Set<string>();
    const groups: Array<{ type: string; items: DelayMenuItem[] }> = [];
    for (const mt of MEAL_TYPES) {
      const removed = groupRemovals[mt] ?? [];
      const extras = groupExtras[mt] ?? [];
      const base = mt === "Other" ? otherBaseRows(tp) : menuItemsFromPlan(mt, serviceDateFor(order), tp, mealPlanCards);
      const display = [
        ...base.filter((it) => !removed.includes(optKey(it.name))
          && !extras.some((x) => optKey(x.name) === optKey(it.name))),
        ...extras,
      ];
      const items = display
        .filter((it) => draftHas(it.name) && !used.has(optKey(it.name)))
        .map((it) => menuDraft.find((d) => optKey(d.name) === optKey(it.name)) ?? it);
      items.forEach((it) => used.add(optKey(it.name)));
      if (items.length > 0) groups.push({ type: mt, items });
    }
    const leftovers = menuDraft.filter((d) => !used.has(optKey(d.name)));
    if (leftovers.length > 0) {
      if (groups.length > 0) groups[0].items.push(...leftovers);
      else groups.push({ type: mealsFor(order.id).join(", ") || "Menu", items: leftovers });
    }
    return groups;
  };

  // Bump the numeric suffix of a base id (e.g. DEL-0005 → DEL-0006) so each
  // fanned-out event gets a distinct id.
  const bumpId = (baseId: string, offset: number) => {
    const m = baseId.match(/^(.*?)(\d+)$/);
    if (!m) return `${baseId}-${offset + 1}`;
    return `${m[1]}${String(Number(m[2]) + offset).padStart(m[2].length, "0")}`;
  };

  const save = () => {
    if (selectedOrders.length === 0) { toast.error("Select at least one dispatched flight order."); return; }
    if (selectedOrders.some((o) => hoursFor(o.id) <= 0)) { toast.error("Enter a positive delay duration for each selected flight."); return; }
    if (selectedOrders.some((o) => mealsFor(o.id).length === 0)) { toast.error("Select at least one meal type for each selected flight."); return; }
    if (selectedOrders.some((o) => !effectiveReasonFor(o.id))) { toast.error("Select a delay reason for each selected flight."); return; }
    if (!reportedBy.trim()) { toast.error("Reported by is required."); return; }
    if (anyOther) {
      const valid = otherItems.filter((i) => i.name.trim() && i.qty > 0);
      if (valid.length === 0) { toast.error("Add at least one item with a name and quantity for the Other meal type."); return; }
    }
    if (selectedOrders.some((o) => menuOverride[o.id]?.length === 0)) {
      toast.error("The edited menu is empty — add at least one item, or reset it to the plan.");
      return;
    }
    const now = stamp();
    // Fan out: ONE delay event per flight (not per meal). Each event carries ALL
    // selected meal types — a combined label plus the aggregated menu items — so a
    // single Delay ID covers the flight's whole refreshment requirement.
    const events: DelayEvent[] = [];
    // Everything logged in this submission shares a batch, so the production
    // check can work the whole delayed set as one list.
    const batchId = `DBT-${Date.now().toString(36).slice(-6).toUpperCase()}`;
    let k = 0;
    for (const order of selectedOrders) {
      const pax  = order.pax ?? 0;
      const crew = order.crew ?? 0;
      const tp   = pax + crew;
      const hrs  = hoursFor(order.id);
      const sq   = Math.ceil(tp * durationMultiplier(hrs));
      const etd  = (order as any)?.etd as string | undefined;
      const meals = mealsFor(order.id);
      const mealLabel = meals.join(", ");
      // The Change Menu override, when present, IS the flight's menu — the
      // combined, user-edited list. Otherwise derive from the day-wise plan.
      const aggItems = menuOverride[order.id] ?? meals.flatMap((meal) => itemsFor(order, meal, tp));
      events.push({
        id: bumpId(nextId, k),
        flightOrderId: order.id,
        orderNo: order.orderNo,
        flightNumber: order.flight,
        flightDate: order.date,
        sector: order.sector,
        paxCount: pax,
        crewCount: crew,
        delayDurationHours: hrs,
        reason: effectiveReasonFor(order.id),
        reportedBy: reportedBy.trim(),
        status: "Fulfillment Pending",
        createdAt: now,
        updatedAt: now,
        batchId,
        mealType: mealLabel,
        originalEtd: etd ?? undefined,
        menuItems: aggItems,
        fulfillment: {
          id: bumpId(nextDfrId, k),
          itemType: mealLabel,
          suggestedQty: sq,
          finalQty: sq,
          fulfillmentType: "Direct Receive",
          requestedBy: reportedBy.trim(),
          notes: "",
        },
      });
      k++;
    }
    onCreate(events);
  };

  return (
    <div className="space-y-5">
      <div className="space-y-5">
        {/* Flight Order (multi-select dropdown) + auto event date */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Dispatched Flight Order(s) <span className="text-destructive">*</span>
              {selectedOrderIds.length > 0 && (
                <span className="ml-1 font-normal normal-case text-primary">· {selectedOrderIds.length} selected</span>
              )}
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="mt-1 h-9 w-full flex items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
                >
                  <span className={selectedOrderIds.length === 0 ? "text-muted-foreground" : ""}>
                    {selectedOrderIds.length === 0
                      ? "Select dispatched order(s)…"
                      : `${selectedOrderIds.length} flight order${selectedOrderIds.length === 1 ? "" : "s"} selected`}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1 max-h-64 overflow-y-auto">
                {dispatched.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No dispatched orders found</div>
                ) : (
                  dispatched.map((o) => (
                    <label key={o.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded hover:bg-muted/50">
                      <Checkbox
                        checked={selectedOrderIds.includes(o.id)}
                        onCheckedChange={(v) => toggleOrder(o.id, v === true)}
                      />
                      <span>{o.flight} — {o.sector} ({o.date}) · {o.orderNo}</span>
                    </label>
                  ))
                )}
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Event Date</Label>
            <Input
              type="date"
              value={eventDate}
              readOnly
              tabIndex={-1}
              title="Auto-selected — current date"
              className="mt-1 tabular-nums bg-muted/50 text-muted-foreground cursor-default"
            />
          </div>
        </div>

        {/* Per-flight details — dispatched meal counts + clickable Order / Dispatch IDs */}
        {selectedOrders.map((o, idx) => {
          const dsp = dispatchFor(o.flight);
          const dispatchedMeals = dsp?.detail?.flightKitchen?.totalMeals;
          const hrs = hoursFor(o.id);
          const revised = o.etd && hrs > 0 ? to24hGmt6(addHoursToEtd(o.etd, hrs)) : null;
          const tone = CARD_TONES[idx % CARD_TONES.length];
          // The delay can push departure past midnight — the menu shown is the
          // one configured for the day the flight now actually leaves.
          const serviceDate = serviceDateFor(o);
          const weekday = new Date(serviceDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
          const tp = (o.pax ?? 0) + (o.crew ?? 0);
          const meals = mealsFor(o.id);
          return (
            <div key={o.id} className={cn("rounded-md border p-4 space-y-3", tone)}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-semibold">{o.flight} · {o.sector}</span>
                {/* Same clock as the revised time below, so the two compare. */}
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {o.date} · ETD {o.etd ? to24hGmt6(o.etd) : "—"}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <DetailCell label="Flight Name" value={o.flight} />
                <DetailCell label="Total PAX" value={o.pax?.toLocaleString() ?? "—"} />
                <DetailCell label="Crew Meal" value={o.crew?.toLocaleString() ?? "—"} />
                <DetailCell label="Special Meal" value={o.specialMeals?.toLocaleString() ?? "—"} />
                <DetailCell
                  label="Order ID"
                  value={
                    <button
                      type="button"
                      className="font-mono text-primary hover:underline"
                      onClick={() => navigate(`/order-management?ord=${o.orderNo}`)}
                    >
                      {o.orderNo}
                    </button>
                  }
                />
                <DetailCell
                  label="Dispatch ID"
                  value={
                    dsp ? (
                      <button
                        type="button"
                        className="font-mono text-primary hover:underline"
                        onClick={() => navigate("/dispatch")}
                      >
                        {dsp.id}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )
                  }
                />
                <DetailCell
                  label="Dispatched Meals"
                  value={dispatchedMeals != null ? dispatchedMeals.toLocaleString() : "—"}
                />
              </div>

              {/* Per-flight delay duration → this flight's revised departure time */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end pt-1 border-t border-border/50">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Delay Duration (hours) <span className="text-destructive">*</span>
                    </Label>
                    {/* One delay for the whole submission — offered on the first
                        flight only; the rest follow it. */}
                    {idx === 0 && selectedOrders.length > 1 && (
                      <label className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground cursor-pointer whitespace-nowrap">
                        <Checkbox
                          checked={sameDelay}
                          onCheckedChange={(v) => toggleSameDelay(!!v)}
                          className="h-3.5 w-3.5"
                          aria-label="Apply this delay to every selected flight"
                        />
                        Same Delay?
                      </label>
                    )}
                  </div>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={durationByFlight[o.id] ?? ""}
                    onChange={(e) => setDurationFor(o.id, e.target.value)}
                    className="mt-1 h-9 tabular-nums"
                    title={sameDelay ? "Same Delay is on — every flight follows this value" : undefined}
                  />
                </div>
                <DetailCell
                  label={`Revised Dep. Time${hrs > 0 ? ` (ETD + ${hrs}h)` : ""}`}
                  value={revised ? <span className="font-semibold text-amber-700 tabular-nums">{revised}</span> : "—"}
                />
                <div className="sm:col-span-2">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Meal Type(s) <span className="text-destructive">*</span>
                    {mealsFor(o.id).length > 0 && (
                      <span className="ml-1 font-normal normal-case text-primary">· {mealsFor(o.id).length} selected</span>
                    )}
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="mt-1 h-9 w-full flex items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <span className={cn("truncate", mealsFor(o.id).length === 0 && "text-muted-foreground")}>
                          {mealsFor(o.id).length === 0 ? "Select meal type(s)…" : mealsFor(o.id).join(", ")}
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1">
                      {/* "Other" is not offered here — it lives only inside Change Menu. */}
                      {MEAL_TYPES.filter((mt) => mt !== "Other").map((mt) => (
                        <label key={mt} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded hover:bg-muted/50">
                          <Checkbox checked={mealsFor(o.id).includes(mt)} onCheckedChange={() => toggleMealFor(o.id, mt)} />
                          <span>{mt}</span>
                        </label>
                      ))}
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Per-flight delay reason */}
              <div className="pt-1 border-t border-border/50">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Delay Reason <span className="text-destructive">*</span>
                </Label>
                <Select value={reasonFor(o.id)} onValueChange={(v) => setReasonByFlight((prev) => ({ ...prev, [o.id]: v }))}>
                  <SelectTrigger className="mt-1 h-9 bg-background">
                    <SelectValue placeholder="Select delay reason…" />
                  </SelectTrigger>
                  <SelectContent>
                    {DELAY_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {reasonFor(o.id) === "Other" && (
                  <Input
                    value={reasonCustomByFlight[o.id] ?? ""}
                    onChange={(e) => setReasonCustomByFlight((prev) => ({ ...prev, [o.id]: e.target.value }))}
                    placeholder="Describe the delay reason…"
                    className="mt-2 text-sm bg-background"
                  />
                )}
              </div>

              {/* Selected meals — day-wise configuration shown inside the card */}
              {meals.length > 0 && (
                <div className="pt-1 border-t border-border/50 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Selected Meals · Day-wise Config ({weekday})
                      </span>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs bg-background" onClick={() => openMenuEditor(o, tp)}>
                      <Pencil className="h-3 w-3 mr-1" /> Change Menu
                    </Button>
                  </div>
                  {menuOverride[o.id] ? (
                    /* Edited menu — segregated by meal type, as arranged in Change Menu. */
                    <div className="rounded-md border border-border/60 bg-background/70 divide-y divide-border/50">
                      {menuOverride[o.id].length === 0 ? (
                        <div className="px-3 py-2 text-[11px] text-destructive">No items — edit the menu again or reset to plan.</div>
                      ) : (menuOverrideGroups[o.id] ?? [{ type: meals.join(", "), items: menuOverride[o.id] }]).map((g) => (
                        <div key={g.type} className="px-3 py-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold text-primary">{g.type}</span>
                            <span className="text-[10px] text-amber-700 font-medium">(menu edited)</span>
                          </div>
                          <ul className="space-y-0.5">
                            {g.items.map((it, i) => (
                              <li key={i} className="flex items-center justify-between text-xs">
                                <span className="text-foreground">{it.name}</span>
                                <span className="tabular-nums text-muted-foreground">{it.requiredQty} {it.uom}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : (
                  <div className="rounded-md border border-border/60 bg-background/70 divide-y divide-border/50">
                    {meals.map((meal) => {
                      const isOther = meal === "Other";
                      const items = isOther
                        ? otherItems.filter((i) => i.name.trim() !== "").map((i) => ({ name: i.name.trim(), requiredQty: i.qty, uom: i.uom ?? "pcs" }))
                        : menuItemsFromPlan(meal, serviceDate, tp, mealPlanCards);
                      const matched = !isOther && mealPlanCards.some(
                        (c) => c.mealType.toLowerCase() === meal.toLowerCase() && c.day === weekday,
                      );
                      return (
                        <div key={meal} className="px-3 py-2">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-primary">{meal}</span>
                              {!isOther && (
                                <span className="text-[10px] text-muted-foreground">{matched ? "(matched to plan)" : "(defaults)"}</span>
                              )}
                            </div>
                            {isOther && (
                              <Button size="sm" variant="outline" className="h-6 text-[11px] bg-background"
                                onClick={() => setOtherConfigOpen(true)}>
                                <ListChecks className="h-3 w-3 mr-1" /> Configure Items
                              </Button>
                            )}
                          </div>
                          {items.length === 0 ? (
                            <div className="text-[11px] text-muted-foreground">No items configured.</div>
                          ) : (
                            <ul className="space-y-0.5">
                              {items.map((it, i) => (
                                <li key={i} className="flex items-center justify-between text-xs">
                                  <span className="text-foreground">{it.name}</span>
                                  <span className="tabular-nums text-muted-foreground">{it.requiredQty} {it.uom}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Reported By */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Reported By <span className="text-destructive">*</span>
            </Label>
            <Input value={reportedBy} onChange={(e) => setReportedBy(e.target.value)}
              placeholder="Name / department" className="mt-1" />
          </div>
        </div>

      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
        {selectedOrders.length > 0 && selectedOrders.some((o) => mealsFor(o.id).length > 0) ? (
          <span className="text-xs text-muted-foreground">
            Will create{" "}
            <span className="font-semibold text-foreground">{selectedOrders.length}</span>{" "}
            delay event{selectedOrders.length === 1 ? "" : "s"} (one per flight), each covering its own meal type(s).
          </span>
        ) : <span />}
        <Button onClick={save} className="mt-3">
          <Send className="h-4 w-4 mr-1.5" /> Create &amp; Go to Fulfillment
        </Button>
      </div>

      {/* ── Configure Items modal — the "Other" meal type ─────────────────── */}
      <Dialog open={otherConfigOpen} onOpenChange={setOtherConfigOpen}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" /> Configure Items — Other
            </DialogTitle>
            <DialogDescription>
              Pick the meals to serve under the Other meal type — quantity and price per item.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Items — Other <span className="text-destructive">*</span>
            </Label>
            {/* Multi-select: tick items to add rows, untick to remove them. */}
            <div className="w-56">
              <ItemDropdown
                options={itemOptions}
                selected={otherNames}
                label={`Add Item${otherItems.some((i) => i.name.trim()) ? ` · ${otherItems.filter((i) => i.name.trim()).length} selected` : ""}`}
                multi
                onPick={toggleOtherOption}
                triggerClassName="h-7 text-xs"
              />
            </div>
          </div>
          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs uppercase tracking-wider">Item Name</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider w-24">Qty</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider w-28">Unit Cost (৳)</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right w-28">Line Total</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {otherItems.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      {/* Items are picked from the master/menu list, not typed. */}
                      <ItemDropdown
                        options={itemOptions}
                        selected={otherNames}
                        label={item.name.trim() || "Select item…"}
                        onPick={(o) => pickOtherItem(idx, o)}
                        triggerClassName={cn(!item.name.trim() && "text-muted-foreground")}
                      />
                      {item.uom && (
                        <div className="mt-0.5 text-[10px] text-muted-foreground">UoM: {item.uom}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input type="number" min={0} value={item.qty || ""}
                        onChange={(e) => updateOtherItem(idx, "qty", e.target.value)}
                        className="h-8 text-sm tabular-nums" />
                    </TableCell>
                    <TableCell>
                      <Input type="number" min={0} value={item.unitCost || ""}
                        onChange={(e) => updateOtherItem(idx, "unitCost", e.target.value)}
                        className="h-8 text-sm tabular-nums" />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      ৳ {(item.qty * item.unitCost).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeOtherItem(idx)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end">
            <div className="text-sm font-semibold">
              Total Cost: <span className="text-primary tabular-nums">৳ {otherTotal.toLocaleString()}</span>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setOtherConfigOpen(false)}>
              <CheckCircle2 className="h-4 w-4 mr-1.5" /> Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Change Menu modal ─────────────────────────────────────────────── */}
      <Dialog open={!!menuEditor} onOpenChange={(v) => { if (!v) setMenuEditor(null); }}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          {(() => {
            const order = selectedOrders.find((o) => o.id === menuEditor);
            if (!order) return null;
            const tp = (order.pax ?? 0) + (order.crew ?? 0);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Pencil className="h-4 w-4 text-primary" /> Change Menu — {order.flight}
                    {/* The day the cards below are drawn from — the revised
                        departure day when the delay pushes past midnight. */}
                    <span className="font-mono text-xs font-normal text-muted-foreground">
                      {order.sector} · {serviceDateFor(order)}
                    </span>
                  </DialogTitle>
                  <DialogDescription>
                    Combine items across every meal type: untick to remove, tick to add —
                    or drag a meal onto another type&apos;s card to move it across.
                    The edited list replaces this flight&apos;s day-wise plan.
                  </DialogDescription>
                </DialogHeader>

                {/* All meal types with their day-wise plan items — quick add/remove.
                    Every card is also a drop target for cross-type dragging. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {MEAL_TYPES.map((mt) => {
                    const isOtherGroup = mt === "Other";
                    const removed = groupRemovals[mt] ?? [];
                    const extras = groupExtras[mt] ?? [];
                    // Other draws from its Configure Items rows; the rest from the plan.
                    const base: DelayMenuItem[] = isOtherGroup
                      ? otherBaseRows(tp)
                      : menuItemsFromPlan(mt, serviceDateFor(order), tp, mealPlanCards);
                    const items = [
                      ...base.filter((it) => !removed.includes(optKey(it.name))
                        && !extras.some((x) => optKey(x.name) === optKey(it.name))),
                      ...extras,
                    ];
                    /* Picking adds a visible row on THIS card (and selects it);
                       picking again removes it — so the card always shows where
                       each item belongs and the preview can segregate by type. */
                    const pickForGroup = (o: MenuItemOption) => {
                      const item: DelayMenuItem = { name: o.name, requiredQty: tp, uom: o.uom, unitCost: o.unitCost || undefined };
                      const key = optKey(o.name);
                      const inGroup = items.some((it) => optKey(it.name) === key);
                      setGroupExtras((prev) => ({
                        ...prev,
                        [mt]: inGroup
                          ? (prev[mt] ?? []).filter((d) => optKey(d.name) !== key)
                          : [...(prev[mt] ?? []), item],
                      }));
                      setGroupRemovals((prev) => ({
                        ...prev,
                        [mt]: inGroup
                          ? [...(prev[mt] ?? []).filter((n) => n !== key), key]
                          : (prev[mt] ?? []).filter((n) => n !== key),
                      }));
                      // Keep the combined menu in step: removing an in-group item
                      // drops it from the draft, adding one selects it.
                      if (inGroup === draftHas(o.name)) toggleDraftItem(item);
                    };
                    return (
                      <div
                        key={mt}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverType(mt); }}
                        onDragLeave={() => setDragOverType((cur) => (cur === mt ? null : cur))}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverType(null);
                          try {
                            const p = JSON.parse(e.dataTransfer.getData("application/json")) as { from: string; item: DelayMenuItem };
                            if (p?.item?.name) dropOnGroup(mt, p.from, p.item);
                          } catch { /* ignore non-item drags */ }
                        }}
                        className={cn(
                          "rounded-md border border-border bg-muted/20 p-2 transition-colors",
                          dragOverType === mt && "border-primary ring-1 ring-primary/40 bg-primary/5",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{mt}</div>
                          {/* Scoped to this meal type only — like the meal configuration
                              pickers. Other offers the full servable pool. */}
                          <div className="w-32">
                            <ItemDropdown
                              options={isOtherGroup ? itemOptions : mealTypeItemOptions(mt, mealPlanCards)}
                              selected={items.map((it) => optKey(it.name))}
                              label="Add Items"
                              multi
                              onPick={pickForGroup}
                              triggerClassName="h-6 text-[11px]"
                            />
                          </div>
                        </div>
                        {items.length === 0 ? (
                          <div className="text-[11px] text-muted-foreground px-1">
                            {isOtherGroup
                              ? "No items yet — add from the dropdown or drag a meal here."
                              : "No items configured."}
                          </div>
                        ) : items.map((it) => (
                          <label
                            key={it.name}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("application/json", JSON.stringify({ from: mt, item: it }));
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            className="flex items-center gap-2 rounded px-1 py-1 text-sm cursor-grab active:cursor-grabbing hover:bg-muted/50"
                          >
                            <GripVertical className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                            <Checkbox checked={draftHas(it.name)} onCheckedChange={() => toggleDraftItem(it)} />
                            <span className="flex-1 truncate">{it.name}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{it.uom}</span>
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>

                {/* The combined menu being built — editable quantities. */}
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs uppercase tracking-wider">Selected Item</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right w-28">Qty</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider w-20">UoM</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {menuDraft.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                            No items selected — tick items above to build the menu.
                          </TableCell>
                        </TableRow>
                      ) : menuDraft.map((it) => (
                        <TableRow key={it.name}>
                          <TableCell className="text-sm font-medium">{it.name}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              value={it.requiredQty || ""}
                              onChange={(e) => setDraftQty(it.name, e.target.value)}
                              className="h-8 text-right tabular-nums"
                            />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{it.uom}</TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => removeDraftItem(it.name)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <DialogFooter className="gap-2">
                  {menuOverride[order.id] && (
                    <Button
                      variant="outline"
                      className="mr-auto"
                      onClick={() => {
                        setMenuOverride((prev) => {
                          const next = { ...prev };
                          delete next[order.id];
                          return next;
                        });
                        setMenuOverrideGroups((prev) => {
                          const next = { ...prev };
                          delete next[order.id];
                          return next;
                        });
                        setMenuEditor(null);
                        toast.success(`${order.flight} — menu reset to the day-wise plan.`);
                      }}
                    >
                      Reset to Plan
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setMenuEditor(null)}>Cancel</Button>
                  <Button
                    disabled={menuDraft.length === 0 || menuDraft.some((it) => it.requiredQty <= 0)}
                    onClick={() => {
                      setMenuOverride((prev) => ({ ...prev, [order.id]: menuDraft }));
                      // Snapshot the per-type arrangement (incl. drags) for the preview.
                      setMenuOverrideGroups((prev) => ({ ...prev, [order.id]: groupedDraft(order, tp) }));
                      setMenuEditor(null);
                      toast.success(`${order.flight} — menu updated (${menuDraft.length} item${menuDraft.length === 1 ? "" : "s"}).`);
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1.5" /> Apply Menu
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Delay Production Screen ──────────────────────────────────────────────────

function DelayProductionScreen({
  event, batchEvents, onProceed, onNeedsPurchase, onSentToProduction,
  onFulfilFromProduction, onSelectEvent, onSendToProduction, onRecordFulfilment,
  autoOpenPurchase, onAutoOpenPurchaseDone,
  onCancel, nextDrId, nextDaId,
}: {
  event: DelayEvent;
  /** Every flight delayed in the same submission — the production worklist. */
  batchEvents: DelayEvent[];
  onProceed: (id: string) => void;
  onNeedsPurchase: (id: string, fulfillment: DelayFulfillment, approval: DelayApprovalRecord) => void;
  onSentToProduction: (
    eventId: string,
    config: {
      date: string;
      officeId: string;
      warehouseId: string;
      lines: Array<{ name: string; qty: number; code?: string }>;
    },
  ) => void;
  onFulfilFromProduction: (
    plans: { eventId: string; plan: NonNullable<DelayEvent["productionPlan"]>; approval: DelayApprovalRecord }[],
  ) => void;
  /** Switch which flight the Stock Availability check below is showing. */
  onSelectEvent: (eventId: string) => void;
  /** Raise Production Orders for marked items across one or more flights. */
  onSendToProduction: (
    groups: { eventId: string; date: string; lines: { name: string; qty: number }[] }[],
  ) => void;
  /** Log where a set of items was routed, for the event's View breakdown. */
  onRecordFulfilment: (
    eventId: string,
    entry: NonNullable<DelayEvent["fulfilmentRefs"]>[number],
  ) => void;
  /** Open the Direct Receive (instant purchase) modal as soon as we mount —
   *  set when the user picks Instant Purchase from the events list. */
  autoOpenPurchase?: boolean;
  onAutoOpenPurchaseDone?: () => void;
  onCancel: () => void;
  nextDrId: string;
  nextDaId: string;
}) {
  const { addGRN, productionEntries } = useWorkflow();
  const { role } = useRole();
  const navigate = useNavigate();
  const [inventoryItems, setInventoryItems] = usePersistedState<InventoryItemMinimal[]>("inventory-items", []);
  const [drLog, setDrLog]                   = usePersistedState<DrLogEntry[]>("delay-dr-log", []);

  const [drOpen, setDrOpen]               = useState(false);
  /** True when the spot buy was launched from the list's Instant Purchase —
   *  closing without submitting goes back to the list, not this blank screen. */
  const [drFromList, setDrFromList]       = useState(false);
  const [drVendor, setDrVendor]           = useState("");
  const [drReceivedBy, setDrReceivedBy]   = useState("");
  const [drOfficeId, setDrOfficeId]       = useState("OFF-001");
  const [drWarehouseId, setDrWarehouseId] = useState("WH-001");
  const [drJustification, setDrJustification] = useState("");
  const [drLines, setDrLines]             = useState<DrFormLine[]>([]);
  const [stockLogLine, setStockLogLine]   = useState<DrFormLine | null>(null);
  const [stockLogOpen, setStockLogOpen]   = useState(false);

  // ── Send to Production modal ──────────────────────────────────────────────
  const [prodOpen, setProdOpen]                 = useState(false);
  const [prodDate, setProdDate]                 = useState(event.flightDate);
  const [prodOfficeId, setProdOfficeId]         = useState("OFF-001");
  const [prodWarehouseId, setProdWarehouseId]   = useState("WH-003");
  const [prodLines, setProdLines]               = useState<Array<{ id: string; name: string; qty: number }>>([]);

  const items = event.menuItems ?? [];

  /** `seed` narrows the modal to specific items (marked in the View detail);
   *  omitted, it pre-fills the flight's whole menu as before. */
  const openProdModal = (seed?: { name: string; qty: number }[]) => {
    const src = seed ?? items.map((mi) => ({ name: mi.name, qty: mi.requiredQty }));
    setProdLines(src.map((l, i) => ({ id: `pl-${i}`, name: l.name, qty: l.qty })));
    setProdDate(event.flightDate);
    setProdOfficeId("OFF-001");
    setProdWarehouseId("WH-003");
    setProdOpen(true);
  };
  const updateProdLine = (id: string, field: "name" | "qty", val: string) =>
    setProdLines((prev) => prev.map((l) => l.id === id ? { ...l, [field]: field === "name" ? val : Number(val) || 0 } : l));
  const addProdLine    = () => setProdLines((prev) => [...prev, { id: `pl-${Date.now()}`, name: "", qty: 1 }]);
  const removeProdLine = (id: string) => setProdLines((prev) => prev.filter((l) => l.id !== id));

  const submitProduction = () => {
    if (prodLines.length === 0) { toast.error("Add at least one production item."); return; }
    if (prodLines.some((l) => !l.name.trim())) { toast.error("All items must have a name."); return; }
    if (prodLines.some((l) => l.qty <= 0)) { toast.error("All items must have a quantity greater than 0."); return; }
    setProdOpen(false);
    onSentToProduction(event.id, {
      date: prodDate,
      officeId: prodOfficeId,
      warehouseId: prodWarehouseId,
      lines: prodLines.map((l) => ({ name: l.name.trim(), qty: l.qty })),
    });
  };

  const stockCheck = useMemo(() => {
    return items.map((mi) => {
      const inv = inventoryItems.find(
        (it) => it.name.trim().toLowerCase() === mi.name.trim().toLowerCase(),
      );
      const onHand = inv?.stock ?? 0;
      return { ...mi, onHand, sufficient: onHand >= mi.requiredQty };
    });
  }, [items, inventoryItems]);


  // ── Fulfil from existing production ───────────────────────────────────────
  // Meals cooked for the day's scheduled flights can feed a delayed one. This
  // path raises no production order and buys nothing — it moves finished meals
  // from the kitchen to the airport store on a normal Transfer Request.

  const [dpfRecords, setDpfRecords] = usePersistedState<DelayProductionFulfillment[]>(DPF_KEY, []);
  const [dpfLog, setDpfLog] = usePersistedState<DpfLogEntry[]>(DPF_LOG_KEY, []);
  const committed = useMemo(() => committedByProduction(dpfRecords), [dpfRecords]);

  /** QC-passed production per delayed flight, scoped to that flight's own day. */
  const availabilityByEvent = useMemo(() => {
    const m = new Map<string, ItemAvailability[]>();
    for (const ev of batchEvents) {
      m.set(ev.id, buildProductionAvailability(ev.menuItems ?? [], productionEntries, committed, ev.flightDate));
    }
    return m;
  }, [batchEvents, productionEntries, committed]);

  /** On-hand stock by item name — what a bought-in consumable draws on. */
  const stockByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of inventoryItems) m.set(it.name.trim().toLowerCase(), it.stock);
    return m;
  }, [inventoryItems]);

  // Flight picking. "Production Availability" unlocks once every delayed flight
  // in the list is ticked, so a plan always covers the whole delayed set.
  const [selectedFlightIds, setSelectedFlightIds] = useState<string[]>([]);
  const selectableFlights = batchEvents.filter((e) => !e.productionPlan);
  const allFlightsSelected = selectableFlights.length > 0
    && selectableFlights.every((e) => selectedFlightIds.includes(e.id));
  const toggleFlight = (id: string) =>
    setSelectedFlightIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const [planOpen, setPlanOpen] = useState(false);
  const [planLines, setPlanLines] = useState<PlanLine[]>([]);
  /** Snapshot of the flights in the open plan. Held separately because raising
   *  the fulfilment flips them out of "Fulfillment Pending", which would empty
   *  `batchEvents` and blank the modal while it is still on screen. */
  const [planFlights, setPlanFlights] = useState<DelayEvent[]>([]);
  const [planToOfficeId, setPlanToOfficeId] = useState("OFF-001");
  const [planToWarehouseId, setPlanToWarehouseId] = useState("WH-001");
  /** Lines the user has marked — every action works on this selection. */
  const [planPicked, setPlanPicked] = useState<string[]>([]);
  /**
   * Lines already sent somewhere, and where they went. A line is actioned once:
   * its checkbox locks so the same quantity can't be raised twice, while the
   * three buttons stay available for whatever is still unmarked.
   */
  const [planDone, setPlanDone] = useState<Record<string, FulfilSource>>({});
  const isLocked = (key: string) => key in planDone;
  const togglePlanLine = (key: string) => {
    if (isLocked(key)) return;
    setPlanPicked((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };
  /** Lock what was just raised and clear the marks, so the buttons re-arm. */
  const commitLines = (keys: string[], to: FulfilSource) => {
    setPlanDone((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, to])) }));
    setPlanPicked((prev) => prev.filter((k) => !keys.includes(k)));
  };
  /** Flight shown in the per-flight detail modal opened from the View action. */
  const [viewFlight, setViewFlight] = useState<DelayEvent | null>(null);
  /** Items marked inside that modal — the actions work on this selection. */
  const [viewPicked, setViewPicked] = useState<string[]>([]);
  /** Items already routed from this modal, and where they went. */
  const [viewDone, setViewDone] = useState<Record<string, FulfilSource>>({});
  const isViewLocked = (name: string) => name in viewDone;
  const toggleViewItem = (name: string) => {
    if (isViewLocked(name)) return;
    setViewPicked((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);
  };
  /** Lock what was just sent and clear the marks, so the button greys out. */
  const commitViewItems = (names: string[], to: FulfilSource) => {
    setViewDone((prev) => ({ ...prev, ...Object.fromEntries(names.map((n) => [n, to])) }));
    setViewPicked((prev) => prev.filter((n) => !names.includes(n)));
  };
  const openViewFlight = (ev: DelayEvent) => {
    setViewPicked([]);
    setViewDone({});
    setViewFlight(ev);
  };

  /**
   * Review step between marking items and routing them. Shows exactly what is
   * about to be sent and in what quantity, so nothing reaches an approval queue
   * unseen. `run` carries the already-bound action for the chosen route.
   */
  const [confirmRoute, setConfirmRoute] = useState<{
    source: FulfilSource;
    flight: string;
    rows: { name: string; qty: number; uom: string; requiredQty: number }[];
    run: () => void;
    /** Override the source-derived heading (e.g. "Fulfill from Production"). */
    title?: string;
    /** Override the qty column header (Issue / Cook / Buy Qty by default). */
    qtyHeader?: string;
  } | null>(null);

  /**
   * The View modal's three routes. Each submits straight to its own approval
   * queue and leaves the modal open — only Close leaves. The items just sent
   * lock, which drops the button's count to zero and greys it out until fresh
   * items are marked.
   */
  const viewSendToProduction = (
    ev: DelayEvent,
    marked: { name: string; shortfall: number }[],
  ) => {
    if (marked.length === 0) return;
    onSendToProduction([{
      eventId: ev.id,
      date: ev.flightDate,
      lines: marked.map((r) => ({ name: r.name, qty: r.shortfall })),
    }]);
    commitViewItems(marked.map((r) => r.name), "Production");
  };


  /** Raise the marked shortfalls as a Purchase Requisition. Once IT is
   *  approved, the list's Instant Purchase button opens the Direct Receive
   *  modal for the actual spot buy. */
  const viewForwardToPurchase = (
    ev: DelayEvent,
    marked: { name: string; shortfall: number; uom: string }[],
  ) => {
    if (marked.length === 0) return;
    const now = stamp();
    const pr = addPurchaseRequisition({
      date: stamp().slice(0, 10),
      officeId: "OFF-001",
      warehouseId: "WH-001",
      requestedBy: role,
      requiredBy: ev.flightDate,
      priority: "Urgent",
      justification: `Delay refreshment shortfall — ${ev.flightNumber} (${ev.flightDate}), ${ev.id}.`,
      lines: marked.map((r, i) => ({
        id: `L${i + 1}`,
        itemName: r.name,
        description: `Delay refreshment — ${ev.flightNumber}`,
        qty: r.shortfall,
        uom: r.uom,
        rate: (ev.menuItems ?? []).find((m) => m.name === r.name)?.unitCost ?? 0,
      })),
      status: "Pending Approval",
    });
    commitViewItems(marked.map((r) => r.name), "Instant Purchase");
    onRecordFulfilment(ev.id, {
      source: "Instant Purchase",
      ref: pr.id,
      refKind: "purchase-requisition",
      items: marked.map((r) => ({ name: r.name, qty: r.shortfall, uom: r.uom })),
      at: now,
    });
    toast.success(`${pr.id} raised — pending approval under Purchase Req.`);
  };

  // ── Fulfill from Stock modal — stock items, live stock link, editable qty ──
  const [stockFulfil, setStockFulfil] = useState<{
    flight: DelayEvent;
    rows: { name: string; uom: string; requiredQty: number; onHand: number; reqQty: number }[];
  } | null>(null);

  const setStockFulfilQty = (name: string, val: string) =>
    setStockFulfil((prev) => prev
      ? {
          ...prev,
          rows: prev.rows.map((r) => r.name === name
            ? { ...r, reqQty: Math.max(0, roundQty(Number(val) || 0)) }
            : r),
        }
      : prev);

  /** Jump to the item's row on Stock Overview with the arrival blink — the
   *  closing-qty item-details table there works exactly as it does today. */
  const goToStockRow = (name: string) => {
    const inv = inventoryItems.find(
      (it) => it.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    flagArrival({ target: "inv-alerts", ids: [inv?.id ?? name] });
    navigate("/inventory");
    toast.success(`Opening ${name} in Stock Overview.`);
  };

  /** Submit the stock fulfilment for approval. Nothing moves yet — the admin
   *  approves in Approval Management and the existing flow deducts the stock. */
  const submitStockFulfil = () => {
    if (!stockFulfil) return;
    const { flight, rows } = stockFulfil;
    const acting = rows.filter((r) => r.reqQty > 0);
    if (acting.length === 0) { toast.error("Enter a quantity for at least one item."); return; }
    const over = acting.find((r) => r.reqQty > r.onHand);
    if (over) { toast.error(`${over.name}: exceeds the ${over.onHand} ${over.uom} on hand.`); return; }
    const now = stamp();
    const items: DrItem[] = acting.map((r) => ({
      name: r.name,
      qty: r.reqQty,
      unitCost: (flight.menuItems ?? []).find((m) => m.name === r.name)?.unitCost ?? 0,
    }));
    onFulfilFromProduction([{
      eventId: flight.id,
      plan: {
        id: bumpSeq("DPP-0001", dpfRecords.length),
        createdAt: now,
        createdBy: role,
        lines: acting.map((r) => ({
          itemName: r.name,
          uom: r.uom,
          requiredQty: r.requiredQty,
          productionQty: 0,
          stockQty: r.reqQty,
          purchaseQty: Math.max(0, r.requiredQty - r.reqQty),
          batches: [],
        })),
        totalProduction: 0,
        totalStock: items.reduce((s, i) => s + i.qty, 0),
        totalPurchase: acting.reduce((s, r) => s + Math.max(0, r.requiredQty - r.reqQty), 0),
      },
      approval: {
        id: nextDaId,
        delayEventId: flight.id,
        flightNumber: flight.flightNumber,
        flightDate: flight.flightDate,
        sector: flight.sector,
        paxCount: flight.paxCount,
        crewCount: flight.crewCount,
        delayDurationHours: flight.delayDurationHours,
        submittedBy: role,
        submittedAt: now,
        status: "Pending",
        fulfillmentType: "Direct Receive",
        items,
        totalCost: items.reduce((s, i) => s + i.qty * i.unitCost, 0),
        notes: "Fulfilled from on-hand kitchen stock.",
      },
    }]);
    commitViewItems(acting.map((r) => r.name), "Stock");
    setStockFulfil(null);
  };

  /** Coverage summary for one flight — drives the Check Production column. */
  const coverageFor = (ev: DelayEvent) => {
    const av = availabilityByEvent.get(ev.id) ?? [];
    const cooked = av.filter((a) => isProducedItem({ name: a.itemName }));
    return {
      items: av.length,
      cooked: cooked.length,
      covered: cooked.filter((a) => a.covered).length,
      availableQty: cooked.reduce((s, a) => s + a.availableQty, 0),
    };
  };

  /**
   * Build the sourcing plan for the picked flights. Kitchen items draw on that
   * day's QC-passed production; bought-in consumables come off the shelf when
   * there is stock. Whatever neither covers is left for instant purchase, so a
   * part-production / part-purchase fulfilment is the normal case, not an edge.
   */
  const openPlanModal = () => {
    const lines: PlanLine[] = [];
    const flights = batchEvents.filter((e) => selectedFlightIds.includes(e.id));
    setPlanFlights(flights);
    setPlanPicked([]);
    setPlanDone({});
    for (const ev of flights) {
      const av = availabilityByEvent.get(ev.id) ?? [];
      for (const mi of ev.menuItems ?? []) {
        const a = av.find((x) => x.itemName === mi.name);
        const produced = isProducedItem({ name: mi.name });
        const availableProduction = produced ? (a?.availableQty ?? 0) : 0;
        const availableStock = produced ? 0 : (stockByName.get(mi.name.trim().toLowerCase()) ?? 0);
        lines.push({
          key: `${ev.id}::${mi.name}`,
          eventId: ev.id,
          flightNumber: ev.flightNumber,
          itemName: mi.name,
          uom: mi.uom,
          // Req Qty starts auto-filled at the flight's full requirement; the
          // production / stock / to-buy split derives from it.
          requiredQty: mi.requiredQty,
          origRequiredQty: mi.requiredQty,
          produced,
          availableProduction,
          availableStock,
          productionQty: Math.min(mi.requiredQty, availableProduction),
          stockQty: Math.min(mi.requiredQty, availableStock),
          batches: a?.batches ?? [],
        });
      }
    }
    setPlanLines(lines);
    setPlanToOfficeId("OFF-001");
    setPlanToWarehouseId("WH-001");
    setPlanOpen(true);
  };

  /**
   * Cook what is not already made. Marked kitchen items with a shortfall raise a
   * Production Order each — exactly the record the "Send to Production" screen
   * creates today — so they land in Approval Management's Production queue and,
   * once approved, are released to the Production Entry floor as usual.
   *
   * Bought-in consumables are skipped: there is no recipe to cook them.
   */
  const submitSendToProduction = () => {
    const cookable = picked.filter((l) => l.produced && shortfallOf(l) > 0);
    if (cookable.length === 0) {
      toast.error("Mark at least one kitchen item that production has not covered.");
      return;
    }
    const byEvent = new Map<string, PlanLine[]>();
    cookable.forEach((l) => byEvent.set(l.eventId, [...(byEvent.get(l.eventId) ?? []), l]));

    const groups: { eventId: string; date: string; lines: { name: string; qty: number }[] }[] = [];
    byEvent.forEach((lines, eventId) => {
      const ev = planFlights.find((e) => e.id === eventId);
      if (!ev) return;
      groups.push({
        eventId,
        date: ev.flightDate,
        lines: lines.map((l) => ({ name: l.itemName, qty: shortfallOf(l) })),
      });
    });

    commitLines(cookable.map((l) => l.key), "Production");
    onSendToProduction(groups);
  };

  /**
   * Forward the uncovered balance for buying. Everything production and stock
   * could not cover — bought-in consumables plus any meal the kitchen came up
   * short on — is raised as one Purchase Requisition, which lands in Approval
   * Management under Purchase Req and then follows the existing purchase flow.
   */
  const submitPurchase = () => {
    const shortLines = picked.filter((l) => shortfallOf(l) > 0);
    if (shortLines.length === 0) { toast.error("Nothing left to purchase."); return; }

    // Merge the same item across flights into one requisition line.
    const byItem = new Map<string, PRLineItem>();
    shortLines.forEach((l, i) => {
      const key = l.itemName.toLowerCase();
      const existing = byItem.get(key);
      const qty = shortfallOf(l);
      if (existing) existing.qty += qty;
      else byItem.set(key, {
        id: `L${i + 1}`,
        itemName: l.itemName,
        description: `Delay refreshment — ${l.flightNumber}`,
        qty,
        uom: l.uom,
        rate: (planFlights.find((e) => e.id === l.eventId)?.menuItems ?? [])
          .find((m) => m.name === l.itemName)?.unitCost ?? 0,
      });
    });

    const flights = Array.from(new Set(shortLines.map((l) => l.flightNumber)));
    const pr = addPurchaseRequisition({
      date: stamp().slice(0, 10),
      officeId: planToOfficeId,
      warehouseId: planToWarehouseId,
      requestedBy: role,
      requiredBy: planFlights[0]?.flightDate ?? stamp().slice(0, 10),
      priority: "Urgent",
      justification:
        `Delay refreshment shortfall — ${flights.join(", ")}. ` +
        `Not covered by the day's production or on-hand stock.`,
      lines: Array.from(byItem.values()),
      status: "Pending Approval",
    });

    commitLines(shortLines.map((l) => l.key), "Instant Purchase");
    // One requisition can span flights — record it against each of them.
    new Set(shortLines.map((l) => l.eventId)).forEach((eventId) => {
      onRecordFulfilment(eventId, {
        source: "Instant Purchase",
        ref: pr.id,
        refKind: "purchase-requisition",
        items: shortLines
          .filter((l) => l.eventId === eventId)
          .map((l) => ({ name: l.itemName, qty: shortfallOf(l), uom: l.uom })),
        at: stamp(),
      });
    });
    toast.success(`${pr.id} raised — pending approval under Purchase Req.`);
  };

  // ── Plan "Fulfill from Stock" review modal — like the single-flight one ────
  const [planStock, setPlanStock] = useState<{
    rows: { key: string; flight: string; name: string; uom: string; requiredQty: number; onHand: number; reqQty: number }[];
  } | null>(null);

  const setPlanStockQty = (key: string, val: string) =>
    setPlanStock((prev) => prev
      ? {
          rows: prev.rows.map((r) => r.key === key
            ? { ...r, reqQty: Math.max(0, roundQty(Number(val) || 0)) }
            : r),
        }
      : prev);

  const submitPlanStock = () => {
    if (!planStock) return;
    const acting = planStock.rows.filter((r) => r.reqQty > 0);
    if (acting.length === 0) { toast.error("Enter a quantity for at least one item."); return; }
    const over = acting.find((r) => r.reqQty > r.onHand);
    if (over) { toast.error(`${over.name}: exceeds the ${over.onHand} ${over.uom} on hand.`); return; }
    const qty = new Map(planStock.rows.map((r) => [r.key, r.reqQty]));
    // Keep the plan table in step with what was confirmed, then submit with
    // the confirmed figures (state updates flush after this handler).
    setPlanLines((prev) => prev.map((l) => (qty.has(l.key) ? { ...l, stockQty: qty.get(l.key)! } : l)));
    submitPlan("Stock", qty);
    setPlanStock(null);
  };

  /** Edit a line's Req Qty (the amount being fulfilled — partial allowed). The
   *  production draw, stock draw and to-buy balance re-derive from it. */
  const setPlanQty = (key: string, value: string) =>
    setPlanLines((prev) => prev.map((l) => {
      if (l.key !== key) return l;
      const req = Math.max(0, roundQty(Number(value) || 0));
      return {
        ...l,
        requiredQty: req,
        productionQty: Math.min(req, l.availableProduction),
        stockQty: Math.min(req, l.availableStock),
      };
    }));

  /**
   * Open a production order from its id — jumps to the Production Order list and
   * flashes that row, the same deep-link highlight the dashboard quick-links use.
   * The look-up is auditable, so it is written to the fulfilment log first.
   */
  const goToProductionOrder = (batch: ProductionBatchOption) => {
    setDpfLog((prev) => [
      {
        at: stamp(),
        by: role,
        action: "Production Batch Viewed",
        detail: `${batch.productionId} (${batch.outputItemName}) opened from ${event.id} — ${event.flightNumber}`,
        productionId: batch.productionId,
        eventId: event.id,
      },
      ...prev,
    ]);
    flagArrival({ target: "production-list", ids: [batch.productionId] });
    // `?pro=` is the list's own deep-link param — it pages the table to the row
    // so the flash has something to land on when the order isn't on page 1.
    navigate(`/production-entry?pro=${encodeURIComponent(batch.productionId)}`);
  };

  /**
   * Open every batch a line draws on in one go — a meal cooked across several
   * runs lands on the Production Order list with all of its rows flashing,
   * instead of making the planner chase one id at a time.
   */
  const goToProductionBatches = (l: PlanLine) => {
    if (l.batches.length === 0) return;
    if (l.batches.length === 1) { goToProductionOrder(l.batches[0]); return; }
    const ids = l.batches.map((b) => b.productionId);
    setDpfLog((prev) => [
      {
        at: stamp(),
        by: role,
        action: "Production Batch Viewed",
        detail: `${ids.join(", ")} (${l.itemName}) opened from ${l.eventId} — ${l.flightNumber}`,
        productionId: ids[0],
        eventId: l.eventId,
      },
      ...prev,
    ]);
    flagArrival({ target: "production-list", ids });
    // Page the list to the first batch; every listed id on that page flashes.
    navigate(`/production-entry?pro=${encodeURIComponent(ids[0])}`);
    toast.success(`Opening ${ids.length} production batches for ${l.itemName}.`);
  };

  /**
   * The three routes, scored over the marked lines only. A line can feed more
   * than one: a meal that is half-cooked can be pulled from production AND have
   * the balance cooked or bought, which is why the counts overlap rather than
   * partition.
   */
  const picked = planLines.filter((l) => planPicked.includes(l.key) && !isLocked(l.key));
  /** Lines still open to marking — what select-all applies to. */
  const selectableLines = planLines.filter((l) => !isLocked(l.key));
  const planTotals = {
    production: picked.reduce((s, l) => s + l.productionQty, 0),
    stock: picked.reduce((s, l) => s + l.stockQty, 0),
    // Only the kitchen can make a meal, so a shortfall on a producible item is
    // cookable; a bought-in consumable's shortfall can only be purchased.
    cook: picked.filter((l) => l.produced).reduce((s, l) => s + shortfallOf(l), 0),
    purchase: picked.reduce((s, l) => s + shortfallOf(l), 0),
  };
  // Button labels count marked ITEMS per route (like the single-flight view),
  // not unit totals — 9 order lines reads "(9)", never "(1248)".
  const planCounts = {
    production: picked.filter((l) => l.productionQty > 0).length,
    stock: picked.filter((l) => l.stockQty > 0).length,
    cook: picked.filter((l) => l.produced && shortfallOf(l) > 0).length,
    purchase: picked.filter((l) => shortfallOf(l) > 0).length,
  };
  const planOverdrawn = picked.filter((l) => l.productionQty > l.availableProduction);
  /** Local id bumper — the parent hands us one next-id per series. */
  const bumpSeq = (baseId: string, offset: number) => {
    const m = baseId.match(/^(.*?)(\d+)$/);
    if (!m) return `${baseId}-${offset + 1}`;
    return `${m[1]}${String(Number(m[2]) + offset).padStart(m[2].length, "0")}`;
  };

  /**
   * Submit the plan. Each flight raises its own Delay Refreshment approval —
   * the existing record and queue — carrying the agreed sourcing. Nothing moves
   * yet: the meals only leave the kitchen once that approval clears and the
   * flight is transferred to the airport store.
   *
   * The drawn batches are committed here rather than at transfer time, so a
   * second delayed flight cannot be promised the same meals while this one is
   * still waiting for a decision.
   */
  const submitPlan = (
    from: "Production" | "Stock" = "Production",
    /** Per-line quantities confirmed in the route's review modal — they win
     *  over the plan table's figures for the submitting source. */
    qtyOverride?: Map<string, number>,
  ) => {
    const qtyOf = (l: PlanLine) =>
      qtyOverride?.get(l.key) ?? (from === "Stock" ? l.stockQty : l.productionQty);
    const stockQtyOf = (l: PlanLine) => (from === "Stock" ? qtyOf(l) : l.stockQty);
    const acting = picked.filter((l) => qtyOf(l) > 0);
    if (acting.length === 0) {
      toast.error(from === "Stock"
        ? "Mark at least one item that on-hand stock can cover."
        : "Enter a production quantity for at least one meal.");
      return;
    }
    if (from === "Production" && planOverdrawn.length > 0) {
      const o = planOverdrawn[0];
      toast.error(`${o.itemName}: exceeds the ${o.availableProduction} ${o.uom} available from production.`);
      return;
    }
    if (!planToWarehouseId) { toast.error("Select the receiving warehouse."); return; }

    const now = stamp();
    const byEvent = new Map<string, PlanLine[]>();
    acting.forEach((l) => byEvent.set(l.eventId, [...(byEvent.get(l.eventId) ?? []), l]));

    const submissions: {
      eventId: string;
      plan: NonNullable<DelayEvent["productionPlan"]>;
      approval: DelayApprovalRecord;
    }[] = [];
    const newDpf: DelayProductionFulfillment[] = [];

    byEvent.forEach((lines, eventId) => {
      const ev = planFlights.find((e) => e.id === eventId);
      if (!ev || lines.every((l) => qtyOf(l) <= 0)) return;
      const k = submissions.length;
      // Stock is issued straight from the shelf, so it draws on no batch.
      const drawn = from === "Stock"
        ? []
        : lines.flatMap((l) => allocateToBatches(l).map((b) => ({ line: l, ...b })));
      const items: DrItem[] = lines
        .filter((l) => qtyOf(l) > 0)
        .map((l) => ({
          name: l.itemName,
          qty: qtyOf(l),
          unitCost: (ev.menuItems ?? []).find((m) => m.name === l.itemName)?.unitCost ?? 0,
        }));

      submissions.push({
        eventId: ev.id,
        plan: {
          id: bumpSeq("DPP-0001", dpfRecords.length + k),
          createdAt: now,
          createdBy: role,
          lines: lines.map((l) => ({
            itemName: l.itemName,
            uom: l.uom,
            requiredQty: l.requiredQty,
            productionQty: l.productionQty,
            stockQty: stockQtyOf(l),
            purchaseQty: Math.max(0, l.requiredQty - l.productionQty - stockQtyOf(l)),
            batches: allocateToBatches(l).map((b) => ({
              productionId: b.batch.productionId,
              qty: b.qty,
              warehouseId: b.batch.warehouseId,
            })),
          })),
          totalProduction: lines.reduce((s, l) => s + l.productionQty, 0),
          totalStock: lines.reduce((s, l) => s + stockQtyOf(l), 0),
          totalPurchase: lines.reduce((s, l) => s + Math.max(0, l.requiredQty - l.productionQty - stockQtyOf(l)), 0),
        },
        approval: {
          id: bumpSeq(nextDaId, k),
          delayEventId: ev.id,
          flightNumber: ev.flightNumber,
          flightDate: ev.flightDate,
          sector: ev.sector,
          paxCount: ev.paxCount,
          crewCount: ev.crewCount,
          delayDurationHours: ev.delayDurationHours,
          submittedBy: role,
          submittedAt: now,
          status: "Pending",
          fulfillmentType: from === "Stock" ? "Direct Receive" : "From Production",
          items,
          totalCost: items.reduce((s, i) => s + i.qty * i.unitCost, 0),
          notes: from === "Stock"
            ? "Fulfilled from on-hand kitchen stock."
            : `Fulfilled from ${ev.flightDate} production — QC-passed batches only.`,
        },
      });

      newDpf.push({
        id: bumpSeq("DPF-0001", dpfRecords.length + k),
        eventId: ev.id,
        flightNumber: ev.flightNumber,
        flightDate: ev.flightDate,
        transferRequestId: "",
        fromOfficeId: "OFF-001",
        fromWarehouse: warehouseNameOf(drawn[0]?.batch.warehouseId),
        toOfficeId: planToOfficeId,
        toWarehouse: warehouseNameOf(planToWarehouseId),
        lines: drawn.map((d) => ({
          itemName: d.line.itemName,
          uom: d.line.uom,
          requiredQty: d.qty,
          productionId: d.batch.productionId,
          bom: d.batch.bom,
          producedQty: d.batch.producedQty,
          productionDate: d.batch.productionDate,
          completedAt: d.batch.completedAt,
        })),
        totalQty: lines.reduce((s, l) => s + l.productionQty, 0),
        raisedBy: role,
        raisedAt: now,
      });
    });

    if (submissions.length === 0) { toast.error("Nothing to fulfil from production."); return; }

    setDpfRecords((prev) => [...newDpf, ...prev]);
    setDpfLog((prev) => [
      {
        at: now,
        by: role,
        action: "Fulfilment Raised",
        detail:
          `${submissions.length} flight(s) — ${planTotals.production} unit(s) from production, ` +
          `${planTotals.stock} from stock, ${planTotals.purchase} left to buy.`,
        eventId: event.id,
        ref: submissions.map((s) => s.approval.id).join(", "),
      },
      ...prev,
    ]);
    commitLines(acting.map((l) => l.key), from === "Stock" ? "Stock" : "Production");
    // The modal stays open so the purchase balance can be raised from the same
    // plan; only Close leaves it.
    onFulfilFromProduction(submissions);
  };

  const openDrModal = (insufficient: typeof stockCheck) => {
    const lines: DrFormLine[] = insufficient.map((sc, i) => ({
      id: `drl-${i}`,
      name: sc.name,
      qty: sc.requiredQty - sc.onHand,
      unitCost: 0,
      uom: sc.uom,
      expiry: "",
      stockBefore: sc.onHand,
      inventoryItemId: (inventoryItems.find(
        (it) => it.name.trim().toLowerCase() === sc.name.trim().toLowerCase()
      ) as any)?.id,
    }));
    setDrLines(lines);
    setDrVendor("");
    setDrReceivedBy("");
    setDrOfficeId("OFF-001");
    setDrWarehouseId("WH-001");
    setDrJustification("");
    setDrOpen(true);
  };

  /**
   * Arriving from the list's Instant Purchase action: open the existing Direct
   * Receive modal straight away, pre-loaded with the quantities the approved
   * production plan could not cover (falling back to whatever stock is short).
   */
  useEffect(() => {
    if (!autoOpenPurchase) return;
    const plan = event.productionPlan;
    const short = plan
      ? plan.lines
          .filter((l) => l.purchaseQty > 0)
          .map((l) => ({
            name: l.itemName,
            requiredQty: l.purchaseQty,
            uom: l.uom,
            onHand: 0,
            sufficient: false,
          }))
      : stockCheck.filter((i) => !i.sufficient);
    openDrModal(short as typeof stockCheck);
    // Cancelling the modal returns to the list — this screen was only opened
    // to host the spot buy, so there is nothing else to show on it.
    setDrFromList(true);
    onAutoOpenPurchaseDone?.();
    // Fires once per arrival — the parent clears the flag straight after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenPurchase]);

  const updateDrLine = <K extends keyof DrFormLine>(id: string, field: K, value: DrFormLine[K]) => {
    setDrLines((prev) => prev.map((l) => l.id === id ? { ...l, [field]: value } : l));
  };
  const addDrLine    = () => setDrLines((prev) => [...prev, { id: `drl-${Date.now()}`, name: "", qty: 1, unitCost: 0, uom: "pcs", expiry: "", stockBefore: 0 }]);
  const removeDrLine = (id: string) => setDrLines((prev) => prev.filter((l) => l.id !== id));

  const totalDrCost = drLines.reduce((s, l) => s + l.qty * l.unitCost, 0);

  const submitDr = () => {
    if (!drVendor) { toast.error("Select a vendor."); return; }
    if (!drReceivedBy) { toast.error("Received By is required."); return; }
    if (!drJustification.trim()) { toast.error("Justification is required."); return; }
    if (drLines.some((l) => !l.name.trim())) { toast.error("All item rows must have an item name."); return; }
    if (drLines.some((l) => l.qty <= 0)) { toast.error("All items must have a quantity greater than 0."); return; }

    const now = stamp();

    // Update inventory stock for each received item
    setInventoryItems((prev) => {
      const updated = [...prev];
      drLines.forEach((line) => {
        const idx = updated.findIndex((it) => it.name.trim().toLowerCase() === line.name.trim().toLowerCase());
        if (idx >= 0) {
          updated[idx] = { ...updated[idx], stock: updated[idx].stock + line.qty };
        } else {
          updated.push({ name: line.name, stock: line.qty, uom: line.uom });
        }
      });
      return updated;
    });

    // Append stock log entries
    const newLogEntries: DrLogEntry[] = drLines.map((line) => ({
      drRef: nextDrId,
      eventId: event.id,
      itemName: line.name,
      qtyReceived: line.qty,
      uom: line.uom,
      stockBefore: line.stockBefore,
      stockAfter: line.stockBefore + line.qty,
      receivedAt: now,
    }));
    setDrLog((prev) => [...prev, ...newLogEntries]);

    // Build fulfillment + approval records (mirroring the existing submitFulfillment flow)
    const drItems: DrItem[] = drLines.map((l) => ({ name: l.name, qty: l.qty, unitCost: l.unitCost }));
    const totalPax = event.paxCount + event.crewCount;
    const fulfillment: DelayFulfillment = {
      id: nextDrId.replace("DR-", "DFR-"),
      itemType: event.mealType ?? "Refreshments",
      suggestedQty: totalPax,
      finalQty: drLines.reduce((s, l) => s + l.qty, 0),
      fulfillmentType: "Direct Receive",
      requestedBy: drReceivedBy,
      notes: drJustification.trim(),
      directReceive: {
        id: nextDrId,
        vendorName: drVendor,
        items: drItems,
        totalCost: totalDrCost,
        receivedBy: drReceivedBy,
        receivedAt: now,
      },
    };
    const approval: DelayApprovalRecord = {
      id: nextDaId,
      delayEventId: event.id,
      flightNumber: event.flightNumber,
      flightDate: event.flightDate,
      sector: event.sector,
      paxCount: event.paxCount,
      crewCount: event.crewCount,
      delayDurationHours: event.delayDurationHours,
      submittedBy: drReceivedBy,
      submittedAt: now,
      status: "Pending",
      fulfillmentType: "Direct Receive",
      items: drItems,
      totalCost: totalDrCost,
      notes: drJustification.trim(),
    };

    // Register as a GRN in the Receive Items list (Accepted so stock ledger sees it)
    const ts = Date.now().toString().slice(-5);
    addGRN({
      id: `GRN-DEL-${ts}`,
      poRef: `DP-DEL-${event.id}-${ts}`,
      vendor: drVendor,
      receivedBy: drReceivedBy,
      date: now,
      lines: drLines.map((l) => ({
        itemId: l.inventoryItemId ?? l.name,
        name: l.name,
        qty: l.qty,
        uom: l.uom,
        temp: "",
        expiry: l.expiry,
        qcStatus: "Accepted" as const,
      })),
      officeId: drOfficeId,
      warehouseId: drWarehouseId,
      direct: true,
      note: drJustification.trim(),
    });

    setDrOpen(false);
    setDrFromList(false);
    // The purchase approval itself is raised by the parent as a Purchase Req.
    toast.success(`${nextDrId} recorded — stock updated.`);
    onNeedsPurchase(event.id, fulfillment, approval);
  };

  return (
    <div className="space-y-5">
      {/* ── Production check worklist — one row per delayed flight ─────────── */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Production Check
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {batchEvents.length} delayed flight{batchEvents.length === 1 ? "" : "s"} ·
                select every flight to plan against the day&apos;s production
              </div>
            </div>
            <Button
              size="sm"
              className={cn(
                "bg-emerald-600 hover:bg-emerald-700 text-white",
                allFlightsSelected && "production-available-blink",
              )}
              disabled={!allFlightsSelected}
              onClick={openPlanModal}
              title={allFlightsSelected
                ? "Plan these flights against the day's QC-passed production"
                : "Select every flight in the list to continue"}
            >
              <Factory className="h-3.5 w-3.5 mr-1.5" /> Production Availability
            </Button>
          </div>

          <div className="overflow-x-auto -mx-1 px-1">
            <div className="min-w-[1080px] border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allFlightsSelected}
                        onCheckedChange={(v) => setSelectedFlightIds(
                          v ? selectableFlights.map((e) => e.id) : [],
                        )}
                        aria-label="Select all delayed flights"
                      />
                    </TableHead>
                    {["Flight", "Sector", "Delay", "Dep Time (After Delay)", "PAX", "Crew", "Meals", "Date", "Check Production", "Action"].map((h) => (
                      <TableHead key={h} className="text-xs uppercase tracking-wider whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchEvents.map((ev) => {
                    const cov = coverageFor(ev);
                    const delayedEtd = ev.originalEtd
                      ? to12h(addHoursToEtd(ev.originalEtd, ev.delayDurationHours))
                      : "—";
                    const planned = !!ev.productionPlan;
                    return (
                      <TableRow
                        key={ev.id}
                        className={cn(ev.id === event.id && "bg-sky-50/60")}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedFlightIds.includes(ev.id)}
                            disabled={planned}
                            onCheckedChange={() => toggleFlight(ev.id)}
                            aria-label={`Select ${ev.flightNumber}`}
                          />
                        </TableCell>
                        <TableCell className="text-sm font-semibold whitespace-nowrap">
                          {ev.flightNumber}
                          <div className="font-mono text-[10px] font-normal text-muted-foreground">{ev.id}</div>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{ev.sector}</TableCell>
                        <TableCell className="text-xs tabular-nums">{ev.delayDurationHours}h</TableCell>
                        <TableCell className="text-xs tabular-nums whitespace-nowrap">{delayedEtd}</TableCell>
                        <TableCell className="text-xs tabular-nums">{ev.paxCount}</TableCell>
                        <TableCell className="text-xs tabular-nums">{ev.crewCount}</TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate" title={ev.mealType}>
                          {ev.mealType ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums whitespace-nowrap">{ev.flightDate}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {planned ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" /> Planned
                            </span>
                          ) : cov.covered > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                              <Factory className="h-3 w-3" /> {cov.covered}/{cov.cooked} covered · {cov.availableQty}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              <AlertTriangle className="h-3 w-3" /> None produced
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => { onSelectEvent(ev.id); openViewFlight(ev); }}
                            title="Open this flight's availability detail"
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" /> View
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Per-flight availability detail (View) ─────────────────────────── */}
      <Dialog open={!!viewFlight} onOpenChange={(v) => { if (!v) setViewFlight(null); }}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-6xl max-h-[90vh] overflow-y-auto">
          {viewFlight && (() => {
            const av = availabilityByEvent.get(viewFlight.id) ?? [];
            const rows = (viewFlight.menuItems ?? []).map((mi) => {
              const a = av.find((x) => x.itemName === mi.name);
              const cooked = isProducedItem({ name: mi.name });
              const onHand = stockByName.get(mi.name.trim().toLowerCase()) ?? 0;
              const fromProduction = cooked ? (a?.availableQty ?? 0) : 0;
              // On-hand stock covers ANY item — a consumable already on the
              // shelf is never "Short" just because it isn't cooked.
              const shortfall = Math.max(0, mi.requiredQty - fromProduction - onHand);
              return { ...mi, cooked, onHand, fromProduction, shortfall, batches: a?.batches ?? [] };
            });
            // What still needs sourcing, split by how it can be sourced: meals the
            // kitchen makes can be cooked, bought-in consumables can only be bought.
            const unmet = rows.filter((r) => r.shortfall > 0);
            const cookable = unmet.filter((r) => r.cooked);
            const buyable = unmet.filter((r) => !r.cooked);
            // What the footer buttons will actually act on.
            const markedUnmet = unmet.filter((r) => viewPicked.includes(r.name) && !isViewLocked(r.name));
            const markedCookable = markedUnmet.filter((r) => r.cooked);
            // Items on-hand stock can contribute to — issuable without buying.
            const stockable = rows.filter((r) => r.onHand > 0);
            const markedStockable = stockable.filter(
              (r) => viewPicked.includes(r.name) && !isViewLocked(r.name),
            );
            /** Every row still open to marking — what select-all covers. */
            const actionable = rows.filter(
              (r) => (r.shortfall > 0 || r.onHand > 0) && !isViewLocked(r.name),
            );
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex flex-wrap items-center gap-2">
                    <Factory className="h-4 w-4 text-emerald-600" />
                    {viewFlight.flightNumber} — {viewFlight.sector}
                    <span className="font-mono text-xs font-normal text-muted-foreground">{viewFlight.id}</span>
                  </DialogTitle>
                </DialogHeader>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md border border-border bg-muted/20 p-3 text-sm">
                  {[
                    ["Date", viewFlight.flightDate],
                    ["Meal Type", viewFlight.mealType ?? "—"],
                    ["Delay", `${viewFlight.delayDurationHours}h`],
                    ["Dep Time (After Delay)", viewFlight.originalEtd
                      ? to12h(addHoursToEtd(viewFlight.originalEtd, viewFlight.delayDurationHours))
                      : "—"],
                    ["Pax", String(viewFlight.paxCount)],
                    ["Crew", String(viewFlight.crewCount)],
                    ["Reported By", viewFlight.reportedBy],
                    ["Status", viewFlight.status],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                      <div className="mt-0.5 font-medium">{val}</div>
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto">
                  <div className="min-w-[720px] border border-border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead className="w-10">
                            <Checkbox
                              checked={actionable.length > 0 && actionable.every((r) => viewPicked.includes(r.name))}
                              disabled={actionable.length === 0}
                              onCheckedChange={(v) => setViewPicked(v ? actionable.map((r) => r.name) : [])}
                              aria-label="Select all actionable items"
                            />
                          </TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Item Name</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider text-right w-28">Required Qty</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider text-right w-28">Current Stock</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider text-right w-32">From Production</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider w-20">UoM</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider text-center w-36">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">
                              No items derived from the meal plan for this flight.
                            </TableCell>
                          </TableRow>
                        ) : rows.map((r, i) => (
                          <TableRow key={`${r.name}-${i}`}>
                            {/* Markable when there is something to act on: a
                                shortfall to cook or buy, or stock to issue. */}
                            <TableCell>
                              <Checkbox
                                checked={viewPicked.includes(r.name) || isViewLocked(r.name)}
                                disabled={isViewLocked(r.name) || (r.shortfall === 0 && r.onHand === 0)}
                                onCheckedChange={() => toggleViewItem(r.name)}
                                aria-label={`Select ${r.name}`}
                              />
                            </TableCell>
                            <TableCell className="text-sm font-medium">
                              {r.name}
                              <div className="text-[10px] text-muted-foreground">
                                {r.cooked ? "kitchen item" : "bought-in consumable"}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm">{r.requiredQty}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm text-sky-700">
                              {r.onHand > 0 ? r.onHand : 0}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm text-emerald-700">
                              {r.cooked ? r.fromProduction : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.uom}</TableCell>
                            <TableCell className="text-center">
                              {isViewLocked(r.name) ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                  <CheckCircle2 className="h-3 w-3" /> Sent · {viewDone[r.name]}
                                </span>
                              ) : r.shortfall === 0 ? (
                                r.fromProduction > 0 ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                    <CheckCircle2 className="h-3 w-3" /> Available
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                                    <CheckCircle2 className="h-3 w-3" /> In Stock
                                  </span>
                                )
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                  <AlertTriangle className="h-3 w-3" /> Short {r.shortfall}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {unmet.length === 0 ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    Every item is covered from the day&apos;s production or from stock — use
                    <strong> Production Availability</strong> to plan the quantities.
                  </div>
                ) : (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <div className="font-semibold">Not available: {unmet.map((r) => r.name).join(", ")}</div>
                    <div className="mt-0.5">
                      {cookable.length > 0 && (
                        <>{cookable.length} kitchen item(s) can be cooked. </>
                      )}
                      {buyable.length > 0 && (
                        <>{buyable.length} bought-in consumable(s) can only be purchased.</>
                      )}
                    </div>
                  </div>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => setViewFlight(null)}>Close</Button>
                  {/* Every action works on the marked items. Only meals the kitchen
                      makes can be cooked; a bought-in consumable has no recipe,
                      so it is filtered out of the production route. */}
                  {stockable.length > 0 && (
                    <Button
                      className="bg-sky-600 hover:bg-sky-700 text-white"
                      disabled={markedStockable.length === 0}
                      title={markedStockable.length === 0
                        ? "Mark at least one item that on-hand stock can cover"
                        : `Issue ${markedStockable.length} marked item(s) from stock`}
                      onClick={() => setStockFulfil({
                        flight: viewFlight,
                        rows: markedStockable.map((r) => ({
                          name: r.name,
                          uom: r.uom,
                          requiredQty: r.requiredQty,
                          onHand: r.onHand,
                          reqQty: Math.min(r.requiredQty, r.onHand),
                        })),
                      })}
                    >
                      <PackageOpen className="h-4 w-4 mr-1.5" />
                      Fulfill from Stock ({markedStockable.length})
                    </Button>
                  )}
                  {cookable.length > 0 && (
                    <Button
                      variant="outline"
                      className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                      disabled={markedCookable.length === 0}
                      title={markedCookable.length === 0
                        ? "Mark at least one short kitchen item"
                        : `Cook ${markedCookable.length} marked item(s)`}
                      onClick={() => setConfirmRoute({
                        source: "Production",
                        flight: `${viewFlight.flightNumber} — ${viewFlight.sector}`,
                        rows: markedCookable.map((r) => ({
                          name: r.name, qty: r.shortfall, uom: r.uom, requiredQty: r.requiredQty,
                        })),
                        run: () => viewSendToProduction(viewFlight, markedCookable),
                      })}
                    >
                      <ChefHat className="h-4 w-4 mr-1.5" />
                      Send to Production ({markedCookable.length})
                    </Button>
                  )}
                  {unmet.length > 0 && (
                    <Button
                      className="bg-amber-600 hover:bg-amber-700 text-white"
                      disabled={markedUnmet.length === 0}
                      title={markedUnmet.length === 0
                        ? "Mark at least one short item"
                        : `Buy ${markedUnmet.length} marked item(s)`}
                      onClick={() => setConfirmRoute({
                        source: "Instant Purchase",
                        flight: `${viewFlight.flightNumber} — ${viewFlight.sector}`,
                        rows: markedUnmet.map((r) => ({
                          name: r.name, qty: r.shortfall, uom: r.uom, requiredQty: r.requiredQty,
                        })),
                        run: () => viewForwardToPurchase(viewFlight, markedUnmet),
                      })}
                    >
                      <ShoppingCart className="h-4 w-4 mr-1.5" />
                      Forward to Instant Purchase ({markedUnmet.length})
                    </Button>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
      {/* ─── Plan Fulfill from Stock Modal (multi-flight) ─────────────────── */}
      <Dialog open={!!planStock} onOpenChange={(v) => { if (!v) setPlanStock(null); }}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {planStock && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <PackageOpen className="h-4 w-4 text-sky-600" /> Fulfill from Stock
                </DialogTitle>
                <DialogDescription>
                  Issue the marked items from on-hand stock. On approval the stock is deducted
                  and the movement shows in the item&apos;s closing-quantity details, as today.
                </DialogDescription>
              </DialogHeader>

              <div className="border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider w-24">Flight</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right w-28">Current Stock</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right w-24">Required</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right w-28">Req Qty</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider w-20">UoM</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {planStock.rows.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="text-sm font-medium">{r.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.flight}</TableCell>
                        <TableCell className="text-right">
                          {/* Clickable — opens the item's Stock Overview row with
                              the blinking arrival effect. */}
                          <button
                            type="button"
                            className="tabular-nums text-sm font-semibold text-sky-700 underline decoration-dotted underline-offset-2 hover:opacity-80"
                            title="View this item in Stock Overview"
                            onClick={() => goToStockRow(r.name)}
                          >
                            {r.onHand}
                          </button>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{r.requiredQty}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={r.onHand}
                            value={r.reqQty}
                            onChange={(e) => setPlanStockQty(r.key, e.target.value)}
                            className={cn(
                              "h-8 text-right tabular-nums",
                              r.reqQty > r.onHand && "border-destructive focus-visible:ring-destructive",
                            )}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.uom}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <strong className="text-foreground">
                  {planStock.rows.reduce((s, r) => s + r.reqQty, 0)}
                </strong>{" "}
                unit(s) across {planStock.rows.length} item(s) — goes to Approval Management
                for admin sign-off before any stock moves.
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setPlanStock(null)}>Cancel</Button>
                <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitPlanStock}>
                  <PackageOpen className="h-4 w-4 mr-1.5" /> Submit For Approval
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Fulfill from Stock Modal ─────────────────────────────────────── */}
      <Dialog open={!!stockFulfil} onOpenChange={(v) => { if (!v) setStockFulfil(null); }}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {stockFulfil && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <PackageOpen className="h-4 w-4 text-sky-600" /> Fulfill from Stock
                </DialogTitle>
                <DialogDescription>
                  {stockFulfil.flight.flightNumber} — {stockFulfil.flight.sector} — issue the
                  marked items from on-hand stock. On approval the stock is deducted and the
                  movement shows in the item&apos;s closing-quantity details, as today.
                </DialogDescription>
              </DialogHeader>

              <div className="border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right w-28">Current Stock</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right w-24">Required</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right w-28">Req Qty</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider w-20">UoM</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockFulfil.rows.map((r) => (
                      <TableRow key={r.name}>
                        <TableCell className="text-sm font-medium">{r.name}</TableCell>
                        <TableCell className="text-right">
                          {/* Clickable — opens the item's Stock Overview row with
                              the blinking arrival effect. */}
                          <button
                            type="button"
                            className="tabular-nums text-sm font-semibold text-sky-700 underline decoration-dotted underline-offset-2 hover:opacity-80"
                            title="View this item in Stock Overview"
                            onClick={() => goToStockRow(r.name)}
                          >
                            {r.onHand}
                          </button>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{r.requiredQty}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={r.onHand}
                            value={r.reqQty}
                            onChange={(e) => setStockFulfilQty(r.name, e.target.value)}
                            className={cn(
                              "h-8 text-right tabular-nums",
                              r.reqQty > r.onHand && "border-destructive focus-visible:ring-destructive",
                            )}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.uom}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <strong className="text-foreground">
                  {stockFulfil.rows.reduce((s, r) => s + r.reqQty, 0)}
                </strong>{" "}
                unit(s) across {stockFulfil.rows.length} item(s) — goes to Approval Management
                for admin sign-off before any stock moves.
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setStockFulfil(null)}>Cancel</Button>
                <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitStockFulfil}>
                  <PackageOpen className="h-4 w-4 mr-1.5" /> Submit For Approval
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Direct Receive – Spot Buy Modal ──────────────────────────────── */}
      <Dialog open={drOpen} onOpenChange={(v) => {
        if (!v) {
          setDrOpen(false);
          if (drFromList) { setDrFromList(false); onCancel(); }
        }
      }}>
        <DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" /> Direct Receive — Spot Buy
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Vendor <span className="text-destructive">*</span></Label>
              <select
                value={drVendor}
                onChange={(e) => setDrVendor(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a vendor...</option>
                {vendors.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Received By <span className="text-destructive">*</span></Label>
              <select
                value={drReceivedBy}
                onChange={(e) => setDrReceivedBy(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select receiver...</option>
                {DR_RECEIVERS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <LocationPicker
              officeId={drOfficeId}
              warehouseId={drWarehouseId}
              onChange={(n) => { setDrOfficeId(n.officeId); setDrWarehouseId(n.warehouseId); }}
            />
            <div className="col-span-2">
              <Label>Justification <span className="text-destructive">*</span></Label>
              <Textarea
                value={drJustification}
                onChange={(e) => setDrJustification(e.target.value)}
                rows={2}
                className="mt-1"
                placeholder="Why this was received directly (urgency, no vendor contract, one-off, etc.)"
              />
            </div>
          </div>

          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <Label>Items Received</Label>
              <Button size="sm" variant="outline" onClick={addDrLine}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
              </Button>
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-semibold">Item</th>
                    <th className="p-2 text-left font-semibold w-20">Qty</th>
                    <th className="p-2 text-left font-semibold w-20">UOM</th>
                    <th className="p-2 text-left font-semibold w-28">Unit Cost (৳)</th>
                    <th className="p-2 text-left font-semibold w-28">Expiry</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {drLines.map((line) => (
                    <tr key={line.id} className="border-t border-border/50">
                      <td className="p-2">
                        <Input
                          value={line.name}
                          onChange={(e) => updateDrLine(line.id, "name", e.target.value)}
                          className="h-7 text-xs"
                          placeholder="Item name"
                        />
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          title="Click to view stock log"
                          className="w-full h-7 text-xs rounded-md border border-input bg-background px-2 text-left tabular-nums font-semibold text-primary underline decoration-dotted underline-offset-1 hover:bg-primary/5"
                          onClick={() => { setStockLogLine(line); setStockLogOpen(true); }}
                        >
                          {line.qty}
                        </button>
                      </td>
                      <td className="p-2">
                        <Input
                          value={line.uom}
                          onChange={(e) => updateDrLine(line.id, "uom", e.target.value)}
                          className="h-7 text-xs w-16"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number" min={0}
                          value={line.unitCost || ""}
                          onChange={(e) => updateDrLine(line.id, "unitCost", Number(e.target.value) || 0)}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="date"
                          value={line.expiry}
                          onChange={(e) => updateDrLine(line.id, "expiry", e.target.value)}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <button type="button" onClick={() => removeDrLine(line.id)}
                          className="text-muted-foreground hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalDrCost > 0 && (
              <div className="flex justify-end mt-2 text-sm font-semibold">
                Total Cost: <span className="ml-1 text-primary tabular-nums">৳ {totalDrCost.toLocaleString()}</span>
              </div>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Recorded as a GRN with a <span className="font-medium">DP</span> reference and routed through <span className="font-medium">Quality Control</span> — accepted items increment Stock Overview, same as any receipt.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDrOpen(false)}>Cancel</Button>
            <Button onClick={submitDr}><Zap className="h-4 w-4 mr-1.5" /> Submit For Approval</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Route confirmation — quantities before anything is raised ─────── */}
      <Dialog open={!!confirmRoute} onOpenChange={(v) => { if (!v) setConfirmRoute(null); }}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {confirmRoute && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {confirmRoute.source === "Stock" ? <PackageOpen className="h-4 w-4 text-sky-600" />
                    : confirmRoute.source === "Production" ? <ChefHat className="h-4 w-4 text-indigo-600" />
                    : <ShoppingCart className="h-4 w-4 text-amber-600" />}
                  {confirmRoute.title
                    ?? (confirmRoute.source === "Stock" ? "Fulfill from Stock"
                      : confirmRoute.source === "Production" ? "Send to Production"
                      : "Forward to Instant Purchase")}
                </DialogTitle>
                <DialogDescription>
                  {confirmRoute.flight} — review the quantities below. Confirming sends them to{" "}
                  {confirmRoute.source === "Instant Purchase"
                    ? "Approval Management under Purchase Req"
                    : confirmRoute.source === "Production"
                      ? "Approval Management under Production"
                      : "Approval Management under Delay Refreshment"}.
                </DialogDescription>
              </DialogHeader>

              <div className="overflow-x-auto">
                <div className="min-w-[420px] border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right w-28">Required</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right w-28">
                          {confirmRoute.qtyHeader
                            ?? (confirmRoute.source === "Stock" ? "Issue Qty"
                              : confirmRoute.source === "Production" ? "Cook Qty" : "Buy Qty")}
                        </TableHead>
                        <TableHead className="text-xs uppercase tracking-wider w-20">UoM</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {confirmRoute.rows.map((r) => (
                        <TableRow key={r.name}>
                          <TableCell className="text-sm font-medium">{r.name}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                            {r.requiredQty}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold">{r.qty}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.uom}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <strong className="text-foreground tabular-nums">
                  {confirmRoute.rows.reduce((s, r) => s + r.qty, 0)}
                </strong>{" "}
                unit(s) across {confirmRoute.rows.length} item(s).
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmRoute(null)}>Cancel</Button>
                <Button
                  className={cn(
                    "text-white",
                    confirmRoute.source === "Stock" ? "bg-sky-600 hover:bg-sky-700"
                      : confirmRoute.source === "Production" ? "bg-indigo-600 hover:bg-indigo-700"
                      : "bg-amber-600 hover:bg-amber-700",
                  )}
                  onClick={() => { confirmRoute.run(); setConfirmRoute(null); }}
                >
                  Confirm &amp; Send for Approval
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Production Availability Modal ─────────────────────────────────── */}
      <Dialog open={planOpen} onOpenChange={(v) => { if (!v) setPlanOpen(false); }}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Factory className="h-4 w-4 text-emerald-600" /> Production Availability
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            Quantities cooked and QC-passed on each flight&apos;s own day. Edit the
            <strong className="text-foreground"> Req Qty</strong> to take less than the
            full requirement — produced quantities are a snapshot and cannot be edited.
            Anything production and stock cannot cover is left for instant purchase.
            The <strong className="text-foreground">Stock</strong> quantity is a link —
            a produced meal opens its batches on the Production Order list, a
            consumable opens the item on Stock Overview.
          </p>

          <div className="overflow-x-auto">
            <div className="min-w-[900px] border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectableLines.length > 0
                          && selectableLines.every((l) => planPicked.includes(l.key))}
                        disabled={selectableLines.length === 0}
                        onCheckedChange={(v) => setPlanPicked(v ? selectableLines.map((l) => l.key) : [])}
                        aria-label="Select all lines"
                      />
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Meal Item</TableHead>
                    {/* How much is already held — a cooked meal in its QC-passed
                        batches, a bought-in consumable on the shelf. The quantity
                        links to wherever it sits. */}
                    <TableHead className="text-xs uppercase tracking-wider text-right w-24">Stock</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right w-28">Produced Qty</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right w-24">Required</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right w-28">Req Qty</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right w-24">To Buy</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-32">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {planLines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                        Nothing to plan — no meal items on the selected flights.
                      </TableCell>
                    </TableRow>
                  ) : planFlights
                    .filter((ev) => planLines.some((l) => l.eventId === ev.id))
                    .flatMap((ev) => {
                      const rows = planLines.filter((l) => l.eventId === ev.id);
                      return [
                        <TableRow key={`hdr-${ev.id}`} className="bg-sky-50/70">
                          <TableCell colSpan={8} className="py-1.5">
                            <span className="text-xs font-semibold text-sky-900">
                              {ev.flightNumber} — {ev.sector}
                            </span>
                            <span className="ml-2 text-[11px] text-sky-800">
                              {ev.flightDate} · {ev.delayDurationHours}h delay · {ev.paxCount + ev.crewCount} pax+crew
                            </span>
                          </TableCell>
                        </TableRow>,
                        ...rows.map((l) => {
                          const over = l.productionQty > l.availableProduction;
                          const short = shortfallOf(l);
                          return (
                            <TableRow key={l.key} className={cn(isLocked(l.key) && "opacity-55")}>
                              <TableCell>
                                <Checkbox
                                  checked={planPicked.includes(l.key) || isLocked(l.key)}
                                  disabled={isLocked(l.key)}
                                  onCheckedChange={() => togglePlanLine(l.key)}
                                  aria-label={`Select ${l.itemName}`}
                                />
                              </TableCell>
                              <TableCell className="text-sm font-medium">
                                {l.itemName}
                                {!l.produced && (
                                  <div className="text-[10px] text-muted-foreground">bought-in consumable</div>
                                )}
                              </TableCell>
                              {/* Stock — the quantity already held for this line,
                                  and a link to where it is held: a produced meal
                                  opens its batches on the Production Order list
                                  (every batch row flashes, however many there
                                  are), a consumable opens Stock Overview. */}
                              <TableCell className="text-right tabular-nums text-sm text-sky-700">
                                {l.produced ? (
                                  l.batches.length > 0 && l.availableProduction > 0 ? (
                                    <button
                                      type="button"
                                      className="font-semibold text-primary underline decoration-dotted underline-offset-2 hover:opacity-80"
                                      title={`Open in Production Order — ${l.batches.length} batch${l.batches.length === 1 ? "" : "es"}`}
                                      onClick={() => goToProductionBatches(l)}
                                    >
                                      {l.availableProduction}
                                    </button>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )
                                ) : l.stockQty > 0 ? (
                                  <button
                                    type="button"
                                    className="font-semibold text-sky-700 underline decoration-dotted underline-offset-2 hover:opacity-80"
                                    title={`Open ${l.itemName} in Stock Overview`}
                                    onClick={() => goToStockRow(l.itemName)}
                                  >
                                    {l.stockQty}
                                  </button>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              {/* Produced Qty is the order's own output, as it reads
                                  on the Production Order list. */}
                              <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                {l.produced && l.batches.length > 0
                                  ? l.batches.reduce((s, b) => s + b.producedQty, 0)
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm">
                                {l.origRequiredQty ?? l.requiredQty}
                              </TableCell>
                              {/* Auto-filled with the full requirement; edit down
                                  for a partial fulfilment — the production / stock
                                  / to-buy split re-derives from it. */}
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  min={0}
                                  value={l.requiredQty}
                                  disabled={isLocked(l.key)}
                                  onChange={(e) => setPlanQty(l.key, e.target.value)}
                                  className={cn(
                                    "h-8 text-right tabular-nums",
                                    over && "border-destructive focus-visible:ring-destructive",
                                  )}
                                />
                              </TableCell>
                              <TableCell className={cn(
                                "text-right tabular-nums text-sm",
                                short > 0 ? "text-amber-700 font-semibold" : "text-muted-foreground",
                              )}>
                                {short > 0 ? short : "—"}
                              </TableCell>
                              <TableCell>
                                {isLocked(l.key) ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 whitespace-nowrap">
                                    <CheckCircle2 className="h-3 w-3" /> Sent · {planDone[l.key]}
                                  </span>
                                ) : (
                                  <span className={cn(
                                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
                                    sourceOf(l) === "Production" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : sourceOf(l) === "Stock" ? "bg-sky-50 text-sky-700 border-sky-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200",
                                  )}>
                                    {sourceOf(l)}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        }),
                      ];
                    })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Destination — the airport-side store the meals move to on approval. */}
          <LocationPicker
            officeId={planToOfficeId}
            warehouseId={planToWarehouseId}
            onChange={(n) => { setPlanToOfficeId(n.officeId); setPlanToWarehouseId(n.warehouseId); }}
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              ["From Production", planTotals.production, "text-emerald-700"],
              ["From Stock", planTotals.stock, "text-sky-700"],
              ["Instant Purchase", planTotals.purchase, "text-amber-700"],
            ].map(([label, val, cls]) => (
              <div key={label as string} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label as string}</div>
                <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", cls as string)}>{val as number}</div>
              </div>
            ))}
          </div>

          {planTotals.purchase > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <strong>{planTotals.purchase} unit(s)</strong> cannot be covered from production or
              stock. Forward them for instant purchase — they are raised as a Purchase Requisition
              and picked up in Approval Management under Purchase Req.
            </div>
          )}

          {/* Two independent routes, each auto-counted from the tagged lines.
              All three stay available for the whole plan. Each is gated on the
              CURRENT marks only, so raising one greys it out until fresh items
              are marked — and the lines just raised lock so they can't be sent
              twice. */}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPlanOpen(false);
                if (Object.keys(planDone).length > 0) onCancel();
              }}
            >
              Close
            </Button>
            {/* Each route opens its own review modal first — quantities are
                confirmed there and only then go for approval, exactly like the
                single-flight View functionality. */}
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                const acting = picked.filter((l) => l.productionQty > 0);
                setConfirmRoute({
                  source: "Production",
                  title: "Fulfill from Production",
                  qtyHeader: "Issue Qty",
                  flight: Array.from(new Set(acting.map((l) => l.flightNumber))).join(", "),
                  rows: acting.map((l) => ({
                    name: l.itemName, qty: l.productionQty, uom: l.uom, requiredQty: l.requiredQty,
                  })),
                  run: () => submitPlan("Production"),
                });
              }}
              disabled={planTotals.production <= 0 || planOverdrawn.length > 0}
              title={planTotals.production <= 0
                ? "Mark items that production can cover"
                : "Send the marked production-sourced quantities for approval"}
            >
              <ArrowLeftRight className="h-4 w-4 mr-1.5" />
              Fulfill from Production ({planCounts.production})
            </Button>
            <Button
              className="bg-sky-600 hover:bg-sky-700 text-white"
              onClick={() => setPlanStock({
                rows: picked.filter((l) => l.stockQty > 0).map((l) => ({
                  key: l.key,
                  flight: l.flightNumber,
                  name: l.itemName,
                  uom: l.uom,
                  requiredQty: l.requiredQty,
                  onHand: l.availableStock,
                  reqQty: l.stockQty,
                })),
              })}
              disabled={planTotals.stock <= 0}
              title={planTotals.stock <= 0
                ? "Mark items that on-hand stock can cover"
                : "Issue the marked quantities from existing stock"}
            >
              <PackageOpen className="h-4 w-4 mr-1.5" />
              Fulfill from Stock ({planCounts.stock})
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={() => {
                const cook = picked.filter((l) => l.produced && shortfallOf(l) > 0);
                setConfirmRoute({
                  source: "Production",
                  qtyHeader: "Cook Qty",
                  flight: Array.from(new Set(cook.map((l) => l.flightNumber))).join(", "),
                  rows: cook.map((l) => ({
                    name: l.itemName, qty: shortfallOf(l), uom: l.uom, requiredQty: l.requiredQty,
                  })),
                  run: submitSendToProduction,
                });
              }}
              disabled={planTotals.cook <= 0}
              title={planTotals.cook <= 0
                ? "Mark kitchen items the day's production has not covered"
                : "Raise Production Orders for the marked items"}
            >
              <ChefHat className="h-4 w-4 mr-1.5" />
              Send to Production ({planCounts.cook})
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => {
                const short = picked.filter((l) => shortfallOf(l) > 0);
                setConfirmRoute({
                  source: "Instant Purchase",
                  flight: Array.from(new Set(short.map((l) => l.flightNumber))).join(", "),
                  rows: short.map((l) => ({
                    name: l.itemName, qty: shortfallOf(l), uom: l.uom, requiredQty: l.requiredQty,
                  })),
                  run: submitPurchase,
                });
              }}
              disabled={planTotals.purchase <= 0}
              title={planTotals.purchase <= 0
                ? "Mark items with a balance to buy"
                : "Raise a Purchase Requisition for the marked balance"}
            >
              <ShoppingCart className="h-4 w-4 mr-1.5" />
              Forward to Instant Purchase ({planCounts.purchase})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ─── Send to Production Modal ──────────────────────────────────────── */}
      <Dialog open={prodOpen} onOpenChange={(v) => { if (!v) setProdOpen(false); }}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ChefHat className="h-4 w-4 text-indigo-500" /> Send to Production — {event.id}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Production Date <span className="text-destructive">*</span></Label>
              <Input type="date" value={prodDate}
                onChange={(e) => setProdDate(e.target.value)} className="mt-1 tabular-nums" />
            </div>
            <LocationPicker
              officeId={prodOfficeId}
              warehouseId={prodWarehouseId}
              onChange={(n) => { setProdOfficeId(n.officeId); setProdWarehouseId(n.warehouseId); }}
            />
          </div>

          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <Label>Production Items</Label>
              <Button size="sm" variant="outline" onClick={addProdLine}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
              </Button>
            </div>
            <div className="rounded-md border border-border overflow-x-auto -mx-1 px-1">
              <table className="min-w-[420px] w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-semibold">Item to Produce</th>
                    <th className="p-2 text-left font-semibold w-28">Order Qty</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {prodLines.length === 0 ? (
                    <tr><td colSpan={3} className="p-3 text-center text-muted-foreground text-xs">
                      No items — add a row to raise a production order.
                    </td></tr>
                  ) : prodLines.map((line) => (
                    <tr key={line.id} className="border-t border-border/50">
                      <td className="p-2">
                        <Input value={line.name}
                          onChange={(e) => updateProdLine(line.id, "name", e.target.value)}
                          className="h-7 text-xs" placeholder="Item name" />
                      </td>
                      <td className="p-2">
                        <Input type="number" min={1} value={line.qty || ""}
                          onChange={(e) => updateProdLine(line.id, "qty", e.target.value)}
                          className="h-7 text-xs tabular-nums" />
                      </td>
                      <td className="p-2">
                        <button type="button" onClick={() => removeProdLine(line.id)}
                          className="text-muted-foreground hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Each item raises a <span className="font-medium">Production Order</span> (Pending) that appears in{" "}
              <span className="font-medium">Approval Management → Production</span>. Once approved, log output on the{" "}
              <span className="font-medium">Production Entry</span> floor screen; finished meals return here to dispatch.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setProdOpen(false)}>Cancel</Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={submitProduction}>
              <ChefHat className="h-4 w-4 mr-1.5" /> Raise Production Order{prodLines.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Stock Log Popup ──────────────────────────────────────────────── */}
      {stockLogLine && (
        <Dialog open={stockLogOpen} onOpenChange={setStockLogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm">
                <History className="h-4 w-4 text-primary" /> Stock Log — {stockLogLine.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-semibold">Movement</th>
                      <th className="text-right px-2 py-1.5 font-semibold">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Log entries for this item from delay DR log */}
                    {drLog.filter((e) => e.itemName.trim().toLowerCase() === stockLogLine.name.trim().toLowerCase()).map((entry, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="px-2 py-1.5 text-emerald-700 font-medium">+Direct Receive ({entry.drRef})</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700 font-semibold">+{entry.qtyReceived} {entry.uom}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-border/50 bg-muted/30">
                      <td className="px-2 py-1.5 font-bold">Current Stock</td>
                      <td className={cn("px-2 py-1.5 text-right tabular-nums font-bold",
                        stockLogLine.stockBefore === 0 ? "text-muted-foreground" :
                        stockLogLine.stockBefore >= stockLogLine.qty ? "text-emerald-600" : "text-red-600"
                      )}>
                        {stockLogLine.stockBefore} {stockLogLine.uom}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Required: <span className="font-semibold">{stockLogLine.qty} {stockLogLine.uom}</span>
                {" · "}
                Shortfall: <span className="font-semibold text-red-600">
                  {roundQty(Math.max(0, stockLogLine.qty - stockLogLine.stockBefore))} {stockLogLine.uom}
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setStockLogOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Delay Fulfillment Screen ─────────────────────────────────────────────────

function DelayFulfillmentScreen({
  event, nextDrId, nextDaId, onSubmit, onCancel,
}: {
  event: DelayEvent;
  nextDrId: string;
  nextDaId: string;
  onSubmit: (eventId: string, f: DelayFulfillment, a: DelayApprovalRecord) => void;
  onCancel: () => void;
}) {
  const f = event.fulfillment!;

  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>(f.fulfillmentType);
  const [itemType, setItemType]               = useState(f.itemType);
  const [finalQty, setFinalQty]               = useState(String(f.finalQty));
  const [notes, setNotes]                     = useState(f.notes);
  const [submittedBy, setSubmittedBy]         = useState(f.requestedBy);

  const [vendorName, setVendorName] = useState(f.directReceive?.vendorName ?? "");
  const [receivedBy, setReceivedBy] = useState(f.directReceive?.receivedBy ?? "");
  const [drItems, setDrItems]       = useState<DrItem[]>(
    f.directReceive?.items?.length
      ? f.directReceive.items
      : suggestDrItems(f.itemType, f.finalQty),
  );

  const totalCost = drItems.reduce((s, i) => s + i.qty * i.unitCost, 0);

  const updateDrItem = (idx: number, field: keyof DrItem, val: string) => {
    setDrItems((prev) => prev.map((it, i) =>
      i === idx ? { ...it, [field]: field === "name" ? val : Number(val) || 0 } : it,
    ));
  };
  const addDrItem    = () => setDrItems((prev) => [...prev, { name: "", qty: 0, unitCost: 0 }]);
  const removeDrItem = (idx: number) => setDrItems((prev) => prev.filter((_, i) => i !== idx));

  const handleTypeChange = (t: FulfillmentType) => {
    setFulfillmentType(t);
    if (t === "Direct Receive" && drItems.length === 0) {
      setDrItems(suggestDrItems(itemType, Number(finalQty) || f.suggestedQty));
    }
  };

  const confirm = () => {
    if (!submittedBy.trim()) { toast.error("Submitted by is required."); return; }
    const qty = Number(finalQty) || 0;
    if (qty <= 0) { toast.error("Final quantity must be positive."); return; }
    if (fulfillmentType === "Direct Receive") {
      if (!vendorName.trim()) { toast.error("Vendor name is required."); return; }
      if (!receivedBy.trim()) { toast.error("Received by is required."); return; }
      if (drItems.some((i) => !i.name.trim() || i.qty <= 0)) {
        toast.error("All item rows must have a name and quantity."); return;
      }
    }
    const now = stamp();
    const dr: DirectReceive | undefined =
      fulfillmentType === "Direct Receive"
        ? { id: nextDrId, vendorName: vendorName.trim(), items: drItems, totalCost, receivedBy: receivedBy.trim(), receivedAt: now }
        : undefined;

    const updatedFulfillment: DelayFulfillment = {
      ...f, itemType, finalQty: qty, fulfillmentType,
      requestedBy: submittedBy.trim(), notes, directReceive: dr,
    };
    const approvalRecord: DelayApprovalRecord = {
      id: nextDaId,
      delayEventId: event.id,
      flightNumber: event.flightNumber,
      flightDate: event.flightDate,
      sector: event.sector,
      paxCount: event.paxCount,
      crewCount: event.crewCount,
      delayDurationHours: event.delayDurationHours,
      submittedBy: submittedBy.trim(),
      submittedAt: now,
      status: "Pending",
      fulfillmentType,
      items: dr?.items ?? [{ name: "Instant Purchase — Kitchen Stock", qty, unitCost: 0 }],
      totalCost: fulfillmentType === "Direct Receive" ? totalCost : 0,
      notes,
    };
    onSubmit(event.id, updatedFulfillment, approvalRecord);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="pt-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Delay Event — {event.id}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {[
              ["Flight",    event.flightNumber],
              ["Date",      event.flightDate],
              ["Sector",    event.sector],
              ["Duration",  `${event.delayDurationHours}h`],
              ["Pax",       String(event.paxCount)],
              ["Crew",      String(event.crewCount)],
              ["Meal Type", event.mealType ?? "—"],
              ["Reported By", event.reportedBy],
            ].map(([label, val]) => (
              <div key={label}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className="mt-0.5 font-medium">{val}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider">Fulfillment Details</h3>
            <Button onClick={confirm}>
              <Send className="h-4 w-4 mr-1.5" /> Submit for Approval
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Type</Label>
              <Input value={itemType} onChange={(e) => setItemType(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Suggested Qty (auto)</Label>
              <Input value={f.suggestedQty} disabled className="mt-1 tabular-nums bg-muted" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Final Quantity <span className="text-destructive">*</span>
              </Label>
              <Input type="number" min={1} value={finalQty} onChange={(e) => setFinalQty(e.target.value)} className="mt-1 tabular-nums" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Submitted By <span className="text-destructive">*</span>
              </Label>
              <Input value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} className="mt-1" />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" className="mt-1" />
            </div>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground block mb-2">Fulfillment Method</Label>
            <Tabs value={fulfillmentType} onValueChange={(v) => handleTypeChange(v as FulfillmentType)}>
              <TabsList className="h-9">
                <TabsTrigger value="Instant Purchase" className="text-xs">
                  <ShoppingCart className="h-3.5 w-3.5 mr-1.5" /> Instant Purchase
                </TabsTrigger>
                <TabsTrigger value="Direct Receive" className="text-xs">
                  <PackageOpen className="h-3.5 w-3.5 mr-1.5" /> Direct Receive
                </TabsTrigger>
              </TabsList>

              <TabsContent value="Instant Purchase" className="mt-4">
                <div className="p-4 rounded-md bg-blue-50 border border-blue-200 text-sm text-blue-800">
                  <div className="flex items-start gap-2">
                    <ShoppingCart className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">Instant Purchase from Kitchen Stores</p>
                      <p className="mt-1 text-xs text-blue-700">
                        Items sourced from existing kitchen inventory. No vendor delivery required.
                      </p>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="Direct Receive" className="mt-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Vendor Name <span className="text-destructive">*</span>
                    </Label>
                    <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)}
                      placeholder="e.g. Fresh Bites Catering Co." className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Received By <span className="text-destructive">*</span>
                    </Label>
                    <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)}
                      placeholder="Staff name" className="mt-1" />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Items Received</Label>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addDrItem}>
                      <PlusCircle className="h-3.5 w-3.5 mr-1" /> Add Item
                    </Button>
                  </div>
                  <div className="border border-border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead className="text-xs uppercase tracking-wider">Item Name</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider w-24">Qty</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider w-28">Unit Cost (৳)</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider text-right w-28">Line Total</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {drItems.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell>
                              <Input value={item.name}
                                onChange={(e) => updateDrItem(idx, "name", e.target.value)}
                                className="h-8 text-sm" placeholder="Item name" />
                            </TableCell>
                            <TableCell>
                              <Input type="number" min={0} value={item.qty || ""}
                                onChange={(e) => updateDrItem(idx, "qty", e.target.value)}
                                className="h-8 text-sm tabular-nums" />
                            </TableCell>
                            <TableCell>
                              <Input type="number" min={0} value={item.unitCost || ""}
                                onChange={(e) => updateDrItem(idx, "unitCost", e.target.value)}
                                className="h-8 text-sm tabular-nums" />
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm font-medium">
                              ৳ {(item.qty * item.unitCost).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <Button size="icon" variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => removeDrItem(idx)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex justify-end mt-2">
                    <div className="text-sm font-semibold">
                      Total Cost: <span className="text-primary tabular-nums">৳ {totalCost.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Delay Detail Screen ──────────────────────────────────────────────────────

function DelayDetailScreen({
  event, approval, onOpenFulfillment, onClose, onNavigate, onCancelRun,
}: {
  event: DelayEvent;
  approval: DelayApprovalRecord | undefined;
  onOpenFulfillment: () => void;
  onClose: () => void;
  onNavigate: (path: string) => void;
  /** Roll the packaging run back — absent when there is nothing to roll back. */
  onCancelRun?: () => void;
}) {
  const [drLog] = usePersistedState<DrLogEntry[]>("delay-dr-log", []);
  const [detailStockLog, setDetailStockLog] = useState<{ item: DrItem; log: DrLogEntry[] } | null>(null);
  const { productionEntries } = useWorkflow();
  // Production-fulfilment records — read-only here, for the summary card below.
  const [dpfRecords] = usePersistedState<DelayProductionFulfillment[]>(DPF_KEY, []);
  const dpf = dpfRecords.find((r) => r.id === event.productionFulfillment?.id);

  const f  = event.fulfillment;
  const dr = f?.directReceive;

  // ── Per-item references for the fulfilment breakdown ──────────────────────
  // Stock Overview's Code column is a derived display code (see routes/
  // inventory.tsx): a per-item-type counter over the item list sorted by id.
  // Mirrored here so a consumable's reference reads exactly as it does there,
  // while the row id stays the join key used to flash the row on arrival.
  const [stockRows] = usePersistedState<Array<{ id?: string; name: string; itemType?: string }>>(
    "inventory-items", [],
  );
  const stockRefByName = useMemo(() => {
    const CODE_PREFIX: Record<string, string> = {
      "Finished Good": "FG", "Semi-Finished Good": "SFG",
      "Raw Material": "RM", "Packaging": "PKG", "Consumable": "CON",
    };
    const typeByName = new Map(getItemProfiles().map((p) => [p.name.toLowerCase(), p.itemType]));
    const counters: Record<string, number> = {};
    const map = new Map<string, { code: string; rowId: string }>();
    for (const it of [...stockRows].sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""))) {
      const prefix = CODE_PREFIX[typeByName.get(it.name.toLowerCase()) ?? it.itemType ?? ""] ?? "RM";
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      map.set(it.name.trim().toLowerCase(), {
        code: `${prefix}-${String(counters[prefix]).padStart(3, "0")}`,
        rowId: it.id ?? it.name,
      });
    }
    return map;
  }, [stockRows]);

  // The delay's rows on the Packaging board, in the order they were raised.
  const [allPkgAllocations] = usePersistedState<PackagingAllocation[]>("packaging-allocations", []);
  const myAllocations = useMemo(() => {
    const ids = event.packagingAllocationIds ?? [];
    if (ids.length === 0) return [];
    return ids
      .map((id) => allPkgAllocations.find((a) => a.id === id))
      .filter((a): a is PackagingAllocation => !!a);
  }, [event.packagingAllocationIds, allPkgAllocations]);

  // ── Approval log ──────────────────────────────────────────────────────────
  // One line per sign-off this event needed, whichever queue it went to:
  // stock / production fulfilment (Delay Refreshment), production orders, and
  // purchase requisitions. Read-only over each queue's own store.
  const [allDelayApprovals] = usePersistedState<DelayApprovalRecord[]>("delay-approval-records", []);
  const approvalLog = useMemo(() => {
    const prs = getPurchaseRequisitions();
    type Row = {
      leg: string; ref: string; requestedBy?: string; requestedAt?: string;
      approvedBy?: string; approvedAt?: string; status: string;
      done: boolean; rejected: boolean;
    };
    const rows: Row[] = [];
    for (const r of event.fulfilmentRefs ?? []) {
      if (r.refKind === "delay-approval") {
        const a = allDelayApprovals.find((x) => x.id === r.ref);
        const status = a?.status ?? "Pending";
        rows.push({
          leg: r.source === "Stock" ? "Stock Fulfillment"
            : r.source === "Production" ? "Production Fulfillment"
            : "Instant Purchase",
          ref: r.ref,
          requestedBy: a?.submittedBy ?? event.reportedBy,
          requestedAt: a?.submittedAt ?? r.at,
          approvedBy: a?.processedBy,
          approvedAt: a?.processedAt,
          status,
          done: status === "Approved",
          rejected: status === "Declined",
        });
      } else if (r.refKind === "purchase-requisition") {
        const pr = prs.find((p) => p.id === r.ref);
        const status = pr?.status ?? "Pending Approval";
        const pending = /pending|draft/i.test(status);
        rows.push({
          leg: "Purchase Req",
          ref: r.ref,
          requestedBy: pr?.requestedBy ?? event.reportedBy,
          requestedAt: r.at,
          // The requisition store keeps the decision, not its timestamp.
          approvedBy: undefined,
          approvedAt: undefined,
          status,
          done: !pending && !/reject|cancel/i.test(status),
          rejected: /reject|cancel/i.test(status),
        });
      } else {
        for (const id of r.ref.split(",").map((s) => s.trim()).filter(Boolean)) {
          const o = productionEntries.find((x) => x.id === id);
          const status = o?.status ?? "Pending";
          rows.push({
            leg: "Production Order",
            ref: id,
            requestedBy: event.reportedBy,
            requestedAt: r.at,
            approvedBy: o?.qcCheckedBy,
            // A run is signed off by QC — that is its approval moment.
            approvedAt: o?.qcPassedAt,
            status,
            done: status === "Completed" && !!o?.qcPassedAt,
            rejected: status === "Re-Cook",
          });
        }
      }
    }
    return rows;
  }, [event.fulfilmentRefs, event.reportedBy, allDelayApprovals, productionEntries]);

  /**
   * Where a single item actually came from. A cooked meal points at the kitchen
   * run that made it — the order raised for this flight, or the finished batch it
   * was drawn from. A spot-bought item points at the Purchase Requisition raised
   * for it, because that requisition IS the record the purchase is worked on
   * (Initiate Purchase → Direct Receive → approval → received). Anything else
   * points at its Stock Overview row. All open the row they name, flashed on
   * arrival.
   */
  const itemRef = (
    name: string,
    source: string,
    /** The routing record this item was listed under — carries the requisition
     *  id for a purchase, so the row can reference it. */
    from?: NonNullable<DelayEvent["fulfilmentRefs"]>[number],
  ): { label: string; open: () => void } | null => {
    const key = name.trim().toLowerCase();
    if (source === "Instant Purchase" && from?.refKind === "purchase-requisition") {
      const prId = from.ref;
      return {
        label: prId,
        open: () => {
          flagArrival({ target: "pr-list", ids: [prId] });
          onNavigate("/purchase-requisition");
        },
      };
    }
    if (source === "Production") {
      const run = productionEntries.find((o) =>
        (event.productionOrderIds ?? []).includes(o.id)
        && (o.outputItemName ?? o.bom ?? "").trim().toLowerCase() === key);
      // Meals pulled from production already finished carry their batch on a
      // fulfilment record instead of a fresh order — any record raised for this
      // event counts, not only the one the event points at.
      const batch = dpfRecords
        .filter((d) => d.eventId === event.id)
        .flatMap((d) => d.lines)
        .find((l) => l.itemName.trim().toLowerCase() === key);
      const proId = run?.id ?? batch?.productionId;
      if (proId) {
        return {
          label: proId,
          open: () => {
            flagArrival({ target: "production-list", ids: [proId] });
            onNavigate(`/production-entry?pro=${encodeURIComponent(proId)}`);
          },
        };
      }
    }
    const inv = stockRefByName.get(key);
    if (!inv) return null;
    return {
      label: inv.code,
      open: () => {
        flagArrival({ target: "inv-alerts", ids: [inv.rowId] });
        onNavigate("/inventory");
      },
    };
  };

  // ── Production route (delay food items cooked fresh) ──────────────────────
  const isProductionRoute = (event.productionOrderIds?.length ?? 0) > 0;
  const prodOrders = isProductionRoute
    ? productionEntries.filter((o) => event.productionOrderIds!.includes(o.id))
    : [];
  const allProdApproved = prodOrders.length > 0 &&
    prodOrders.every((o) => ["Approved", "In Preparation", "Ready for QC", "Completed"].includes(o.status));
  const allProdCompleted = prodOrders.length > 0 && prodOrders.every((o) => o.status === "Completed");

  // Packaging is a stage of its own now, so the timeline shows it instead of
  // jumping from Approved straight to Sent To Dispatch.
  const PACKED_ON = ["Sent To Packaging", "Sent To Dispatch", "Dispatched", "Closed"];
  const DISPATCHED_ON = ["Sent To Dispatch", "Dispatched", "Closed"];
  const timelineSteps: Array<{ label: string; done: boolean; active: boolean }> = isProductionRoute
    ? [
        { label: "Delay Received",   done: true, active: false },
        { label: "Sent To Production", done: true, active: event.status === "Sent To Production" && !allProdApproved },
        { label: "Prod. Approved",   done: allProdApproved, active: allProdApproved && !allProdCompleted },
        { label: "Produced",         done: allProdCompleted, active: allProdCompleted && event.status === "Sent To Production" },
        { label: "Packaging",        done: PACKED_ON.includes(event.status), active: event.status === "Sent To Packaging" },
        { label: "Sent To Dispatch", done: DISPATCHED_ON.includes(event.status), active: event.status === "Sent To Dispatch" },
        { label: "Dispatched",       done: ["Dispatched","Closed"].includes(event.status), active: ["Dispatched","Closed"].includes(event.status) },
      ]
    : [
        { label: "Delay Received",    done: true, active: event.status === "Received" },
        { label: "Validated",         done: event.status !== "Received", active: event.status === "Validated" },
        { label: "Fulfillment",       done: !["Received","Validated"].includes(event.status), active: event.status === "Fulfillment Pending" },
        { label: "Approval Pending",  done: !["Received","Validated","Fulfillment Pending"].includes(event.status), active: event.status === "Approval Pending" },
        { label: "Approved",          done: ["Approved", ...PACKED_ON].includes(event.status), active: event.status === "Approved" },
        { label: "Packaging",         done: PACKED_ON.includes(event.status), active: event.status === "Sent To Packaging" },
        { label: "Sent To Dispatch",  done: DISPATCHED_ON.includes(event.status), active: event.status === "Sent To Dispatch" },
        { label: "Dispatched",        done: ["Dispatched","Closed"].includes(event.status), active: ["Dispatched","Closed"].includes(event.status) },
      ];

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {event.status === "Fulfillment Pending" && (
          <Button size="sm" onClick={onOpenFulfillment}>
            <PackageOpen className="h-3.5 w-3.5 mr-1.5" /> Go to Fulfillment
          </Button>
        )}
        {/* Packaging and dispatch are driven from the list's Status column —
            Send To Packaging → … → Send To Dispatch — so this view stays a
            read-only record of what happened. */}
        {event.dispatchId && (
          <Button size="sm" variant="outline" onClick={() => onNavigate("/packaging")}>
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View In Packaging
          </Button>
        )}
        {/* A flight can recover, or a run can be raised in error — until the food
            has actually moved, this puts everything back. */}
        {onCancelRun && event.dispatchId && event.status !== "Dispatched" && (
          <Button size="sm" variant="outline"
            className="border-red-200 text-red-700 hover:bg-red-50"
            onClick={onCancelRun}>
            <X className="h-3.5 w-3.5 mr-1.5" /> Cancel Run
          </Button>
        )}
      </div>

      {/* Status timeline */}
      <div className="flex items-center gap-0 overflow-x-auto py-3 px-1">
        {timelineSteps.map((step, i) => (
          <div key={step.label} className="flex items-center shrink-0">
            <div className="flex flex-col items-center">
              <div className={cn(
                "h-6 w-6 rounded-full flex items-center justify-center border-2 text-[10px] font-bold",
                step.done   ? "border-primary bg-primary text-primary-foreground"
                : step.active ? "border-primary bg-background text-primary"
                : "border-muted-foreground/30 bg-background text-muted-foreground/50",
              )}>
                {step.done ? "✓" : i + 1}
              </div>
              <span className={cn(
                "mt-1.5 text-[10px] text-center max-w-[58px] leading-tight",
                step.active ? "font-semibold text-primary" : "text-muted-foreground",
              )}>
                {step.label}
              </span>
            </div>
            {i < timelineSteps.length - 1 && (
              <div className={cn("h-0.5 w-7 mx-1 mb-4 shrink-0", step.done ? "bg-primary" : "bg-muted-foreground/20")} />
            )}
          </div>
        ))}
      </div>

      {/* Event details */}
      <Card>
        <CardContent className="pt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Event Details</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {[
              ["Pax Count",   String(event.paxCount)],
              ["Crew Count",  String(event.crewCount)],
              ["Delay",       `${event.delayDurationHours}h`],
              ["Meal Type",   event.mealType ?? "—"],
              // The schedule the delay is measured against, both on the same
              // 24h clock so the shift reads at a glance.
              ["Scheduled Dep. Time", event.originalEtd ? to24hGmt6(event.originalEtd) : "—"],
              ["Delayed Dep. Time",   event.originalEtd
                ? to24hGmt6(addHoursToEtd(event.originalEtd, event.delayDurationHours))
                : "—"],
              ["Reported By", event.reportedBy],
              ["Created",     event.createdAt],
              ["Updated",     event.updatedAt],
            ].map(([label, val]) => (
              <div key={label}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className="mt-0.5 font-medium text-sm">{val}</div>
              </div>
            ))}
            <div className="col-span-2 md:col-span-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Reason</div>
              <div className="mt-0.5 text-sm">{event.reason}</div>
            </div>
          </div>

          {event.menuItems && event.menuItems.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Menu Plan Items</div>
              <div className="border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Required Qty</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">UoM</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Unit Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {event.menuItems.map((mi, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm font-medium">{mi.name}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{mi.requiredQty}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{mi.uom}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                          {mi.unitCost != null && mi.unitCost > 0 ? `৳ ${mi.unitCost.toLocaleString()}` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fulfilled from production — no production order, no purchase; the meals
          move on the linked Transfer Request(s). */}
      {/* ── Fulfilment breakdown — where each item was routed ──────────────── */}
      {(event.fulfilmentRefs ?? []).length > 0 && (() => {
        const refs = event.fulfilmentRefs ?? [];
        const SOURCES: NonNullable<DelayEvent["fulfilmentRefs"]>[number]["source"][] =
          ["Stock", "Production", "Instant Purchase"];
        const tone: Record<string, string> = {
          "Stock": "border-sky-200 bg-sky-50 text-sky-800",
          "Production": "border-indigo-200 bg-indigo-50 text-indigo-800",
          "Instant Purchase": "border-amber-200 bg-amber-50 text-amber-800",
        };
        /** Each route's own screen — where the whole leg is worked. */
        const ROUTE: Record<string, { label: string; path: string }> = {
          "Stock": { label: "Open Stock Overview", path: "/inventory" },
          "Production": { label: "Open Production Order", path: "/production-entry" },
          "Instant Purchase": { label: "Open Purchase Req", path: "/purchase-requisition" },
        };
        const TITLE: Record<string, string> = {
          "Stock": "Fulfill from Stock",
          "Production": "Fulfill from Production",
          "Instant Purchase": "Fulfill from Instant Purchase",
        };
        return (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fulfilment Breakdown
              </div>
              {SOURCES.filter((s) => refs.some((r) => r.source === s)).map((s) => {
                const group = refs.filter((r) => r.source === s);
                return (
                  <div key={s} className={cn("rounded-md border p-3", tone[s])}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold">{TITLE[s]}</span>
                      <span className="text-[11px] opacity-80">
                        {group.reduce((n, r) => n + r.items.length, 0)} item(s)
                      </span>
                      <button
                        type="button"
                        className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold underline decoration-dotted underline-offset-2 hover:opacity-70"
                        onClick={() => onNavigate(ROUTE[s].path)}
                      >
                        <ExternalLink className="h-3 w-3" /> {ROUTE[s].label}
                      </button>
                    </div>
                    {group.map((r, gi) => (
                      <div key={`${r.ref}-${gi}`} className="mt-2 border-t border-current/15 pt-2 first:mt-1 first:border-0 first:pt-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[10px] uppercase tracking-wider opacity-70">Routed</span>
                          <span className="text-[10px] tabular-nums opacity-70">{r.at}</span>
                        </div>
                        {/* Line detail — each item against the record it came
                            from: its kitchen run, or its Stock Overview code.
                            The reference sits on the row, not above the table. */}
                        <div className="mt-1.5 overflow-hidden rounded border border-current/15">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="bg-current/5 text-left">
                                <th className="px-2 py-1 font-semibold">Item</th>
                                <th className="px-2 py-1 font-semibold text-right w-20">Qty</th>
                                <th className="px-2 py-1 font-semibold w-16">UoM</th>
                                <th className="px-2 py-1 font-semibold w-40">Reference</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.items.map((i, ii) => {
                                const ref = itemRef(i.name, s, r);
                                return (
                                  <tr key={`${i.name}-${ii}`} className="border-t border-current/10">
                                    <td className="px-2 py-1 font-medium">{i.name}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{i.qty}</td>
                                    <td className="px-2 py-1 opacity-80">{i.uom}</td>
                                    <td className="px-2 py-1">
                                      {ref ? (
                                        <button
                                          type="button"
                                          onClick={ref.open}
                                          className="font-mono font-semibold underline decoration-dotted underline-offset-2 hover:opacity-70"
                                          title={s === "Production"
                                            ? "Open this production run"
                                            : s === "Instant Purchase" && r.refKind === "purchase-requisition"
                                              ? "Open this requisition in Purchase Requisition"
                                              : "Open this item in Stock Overview"}
                                        >
                                          {ref.label}
                                        </button>
                                      ) : (
                                        <span className="opacity-60">—</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })()}

      {dpf && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Factory className="h-3.5 w-3.5 text-emerald-600" /> Fulfilled From Production — {dpf.id}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {[
                ["Transfer Request", dpf.transferRequestId],
                ["From", dpf.fromWarehouse || "—"],
                ["To", dpf.toWarehouse || "—"],
                ["Total Qty", String(dpf.totalQty)],
                ["Raised By", dpf.raisedBy],
                ["Raised At", dpf.raisedAt],
              ].map(([label, val]) => (
                <div key={label}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                  <div className="mt-0.5 font-medium text-sm">{val}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[520px] border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-xs uppercase tracking-wider">Meal Item</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Production Batch</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Produced At</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Produced Qty</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Transferred</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dpf.lines.map((l, i) => (
                      <TableRow key={`${l.productionId}-${i}`}>
                        <TableCell className="text-sm font-medium">{l.itemName}</TableCell>
                        <TableCell>
                          <div className="font-mono text-xs font-semibold">{l.productionId}</div>
                          <div className="text-[10px] text-muted-foreground">{l.bom}</div>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">{l.completedAt ?? l.productionDate}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{l.producedQty}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-semibold">
                          {l.requiredQty} {l.uom}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => onNavigate("/transfer")}>
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View in Transfer
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Fulfillment details */}
      {f && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fulfillment Details</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {[
                ["Item Type",    f.itemType],
                ["Final Qty",    String(f.finalQty)],
                // The routes the items actually came through, not just the last
                // action taken — a delay can draw on all three at once.
                ["Fulfillment Method", (() => {
                  const used = Array.from(new Set((event.fulfilmentRefs ?? []).map((r) =>
                    r.source === "Instant Purchase" ? "Purchase" : r.source)));
                  return used.length > 0 ? used.join(", ") : f.fulfillmentType;
                })()],
                ["Requested By", f.requestedBy],
                ["Notes",        f.notes || "—"],
              ].map(([label, val]) => (
                <div key={label}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                  <div className="mt-0.5 font-medium text-sm">{val}</div>
                </div>
              ))}
            </div>

            {dr && (
              <div className="pt-3 border-t border-border">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Direct Receive — {dr.id}
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                  {[["Vendor", dr.vendorName], ["Received By", dr.receivedBy], ["Received At", dr.receivedAt]].map(([l, v]) => (
                    <div key={l}>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
                      <div className="mt-0.5 font-medium">{v}</div>
                    </div>
                  ))}
                </div>
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Unit Cost</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Line Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dr.items.map((item, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium text-sm">{item.name}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold">{item.qty}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">৳ {item.unitCost.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold">
                            ৳ {(item.qty * item.unitCost).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex justify-end mt-2">
                  <div className="text-sm font-bold">
                    Total: <span className="text-primary tabular-nums">৳ {dr.totalCost.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Packaging — the delay's own rows on the Packaging board, packed with
          this flight's scheduled meals under the same flight header. */}
      {myAllocations.length > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Packaging — {event.flightNumber}
              </div>
              <Button size="sm" variant="outline" onClick={() => onNavigate("/packaging")}>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View In Packaging
              </Button>
            </div>
            <div className="border border-border rounded-md overflow-x-auto">
              <Table className="min-w-[620px]">
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wider">Packaging ID</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Production ID</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right w-28">Qty For Flight</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-28">Date</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-36">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myAllocations.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs font-semibold">{a.packagingId}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="font-mono text-xs font-semibold text-primary underline decoration-dotted underline-offset-2 hover:opacity-80"
                          title="Open this production run"
                          onClick={() => {
                            flagArrival({ target: "production-list", ids: [a.productionId] });
                            onNavigate(`/production-entry?pro=${encodeURIComponent(a.productionId)}`);
                          }}
                        >
                          {a.productionId}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm font-medium">{a.item}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{a.qty}</TableCell>
                      <TableCell className="text-xs tabular-nums">{a.date}</TableCell>
                      <TableCell>
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                          isPackaged(a) ? "bg-emerald-100 text-emerald-700"
                            : a.status === "Rejected" ? "bg-red-100 text-red-700"
                            : a.status === "In Packaging" ? "bg-indigo-100 text-indigo-700"
                            : "bg-amber-100 text-amber-700",
                        )}>
                          {a.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Approval log — one line per sign-off the event needed, each with who
          asked, when, and when it cleared. */}
      {approvalLog.length > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Approval Log
            </div>
            <div className="border border-border rounded-md overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wider">Approval</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Reference</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Requested By</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Requested At</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Approved By</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Approved At</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvalLog.map((a, i) => (
                    <TableRow key={`${a.ref}-${i}`}>
                      <TableCell className="text-sm font-medium">{a.leg}</TableCell>
                      <TableCell className="font-mono text-xs">{a.ref}</TableCell>
                      <TableCell className="text-xs">{a.requestedBy || "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">{a.requestedAt || "—"}</TableCell>
                      <TableCell className="text-xs">{a.approvedBy || "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">{a.approvedAt || "—"}</TableCell>
                      <TableCell>
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                          a.done ? "bg-emerald-100 text-emerald-700"
                            : a.rejected ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700",
                        )}>
                          {a.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {approval?.declineReason && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Decline Reason</div>
                <div className="mt-0.5 font-medium text-sm text-red-600">{approval.declineReason}</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── DR Stock Log Popup ───────────────────────────────────────────── */}
      {detailStockLog && (
        <Dialog open={!!detailStockLog} onOpenChange={(o) => { if (!o) setDetailStockLog(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm">
                <History className="h-4 w-4 text-primary" /> Stock Log — {detailStockLog.item.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-semibold">Movement</th>
                      <th className="text-right px-2 py-1.5 font-semibold">Qty</th>
                      <th className="text-right px-2 py-1.5 font-semibold">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailStockLog.log.length > 0 ? (
                      <>
                        <tr className="border-t border-border/50">
                          <td className="px-2 py-1.5 text-muted-foreground">Opening Stock</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{detailStockLog.log[0].stockBefore} {detailStockLog.log[0].uom}</td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">—</td>
                        </tr>
                        {detailStockLog.log.map((entry, i) => (
                          <tr key={i} className="border-t border-border/50">
                            <td className="px-2 py-1.5 text-emerald-700 font-medium">+Direct Receive</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700 font-semibold">+{entry.qtyReceived} {entry.uom}</td>
                            <td className="px-2 py-1.5 text-right text-muted-foreground">{entry.receivedAt.slice(0, 10)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-border/50 bg-muted/30">
                          <td className="px-2 py-1.5 font-bold">Closing Balance</td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-bold text-primary">
                            {detailStockLog.log[detailStockLog.log.length - 1].stockAfter} {detailStockLog.log[0].uom}
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">Updated ✓</td>
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <td colSpan={3} className="px-2 py-3 text-center text-muted-foreground">
                          Received: <span className="font-semibold text-foreground">{detailStockLog.item.qty}</span> units
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setDetailStockLog(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
