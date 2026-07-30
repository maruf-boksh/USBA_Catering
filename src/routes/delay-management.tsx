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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { KpiCard } from "@/components/common/KpiCard";
import {
  Clock, Plus, ArrowLeft, CheckCircle2, AlertTriangle, Truck, ShoppingCart,
  PackageOpen, Send, Timer, Eye, ChevronRight, ChevronDown,
  ExternalLink, Trash2, PlusCircle, ListChecks, Zap, History, X, ChefHat,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { roundQty } from "@/lib/num";
import { toast } from "sonner";
import { ListExportActions } from "@/components/common/ListExportActions";
import { filterMeta as listExportFilterMeta } from "@/lib/list-export";
import { useFlightOrders } from "@/lib/flight-orders-store";
import { vendors } from "@/lib/sample-data";
import { LocationPicker } from "@/components/common/LocationPicker";
import { useWorkflow, type WfGRN, type WfGRNLine, type StockDelta, type WfProductionEntry } from "@/lib/workflow-store";
import { reduceInventoryStock } from "@/lib/stock-adjustments";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DelayStatus =
  | "Received"
  | "Validated"
  | "Fulfillment Pending"
  | "Approval Pending"
  | "Approved"
  | "Rejected"
  | "Sent To Production"
  | "Sent To Dispatch"
  | "Dispatched"
  | "Closed";

export type FulfillmentType = "Instant Purchase" | "Direct Receive";

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
  "Sent To Dispatch":   "bg-teal-100 text-teal-700",
  "Dispatched":         "bg-emerald-200 text-emerald-800",
  "Closed":             "bg-gray-100 text-gray-500",
};

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
  const { applyStockDeltas, addProductionEntry } = useWorkflow();

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
        if (e.status === "Sent To Dispatch" && e.dispatchId) {
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
    setDelayEvents((prev) =>
      prev.map((e) =>
        e.id === eventId
          ? {
              ...e,
              productionOrderIds: [...(e.productionOrderIds ?? []), ...orderIds],
              status: "Sent To Production",
              updatedAt: stamp(),
            }
          : e,
      ),
    );
    setActiveEventId(eventId);
    setView("detail");
    toast.success(
      `${orderIds.length} production order${orderIds.length === 1 ? "" : "s"} raised for ${eventId} — pending approval in Approval Management.`,
    );
  };

  const sendToDispatch = (event: DelayEvent) => {
    if (event.status !== "Approved" && event.status !== "Sent To Production") return;
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
    const newDspId = `DSP-DEL-${String(delayEvents.filter((e) => e.dispatchId).length + 1).padStart(3, "0")}`;

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

    const newPkgRows: PackagingRowLike[] = sourceItems.map((item, idx) => ({
      id:       `PKG-${newDspId}-${idx + 1}`,
      date:     today,
      depTime,
      flight:   event.flightNumber,
      mealType: pkgMealType,
      mealName: item.name,
      qty:      item.qty,
      section:  "Delay Refreshment",
      packagingStatus: "Ready for Packaging",
      dspRef:   newDspId,
      orderNo:  event.orderNo,
    }));

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
    setDispatchRecords((prev) => [newRecord, ...prev]);
    setDelayEvents((prev) =>
      prev.map((e) =>
        e.id === event.id
          ? { ...e, status: "Sent To Dispatch", dispatchId: newDspId, updatedAt: stamp() }
          : e,
      ),
    );

    // Deduct dispatched items from stock (OUT QTY in the ledger)
    sourceItems.forEach((item) => reduceInventoryStock(item.name, item.qty));
    const deltas: StockDelta[] = sourceItems.map((item) => ({
      itemId: item.name,
      delta: -item.qty,
      date: today,
      reference: newDspId,
      label: "Delay Dispatch",
    }));
    applyStockDeltas(deltas);

    toast.success(`${newDspId} created — proceeding to Dispatch for QC & dispatch.`);
    // Defer navigation so usePersistedState flushes the new rows/record to
    // localStorage before the dispatch page mounts and reads from it.
    setTimeout(() => navigate("/dispatch"), 0);
  };

  const closeEvent = (eventId: string) => {
    setDelayEvents((prev) =>
      prev.map((e) => e.id === eventId ? { ...e, status: "Closed", updatedAt: stamp() } : e),
    );
    toast.success("Delay event closed.");
    setView("list");
  };

  const activeDispatchRecord = activeEvent?.dispatchId
    ? dispatchRecords.find((d) => d.id === activeEvent.dispatchId)
    : undefined;

  const modalDispatchRecord = viewModalEvent?.dispatchId
    ? dispatchRecords.find((d) => d.id === viewModalEvent.dispatchId)
    : undefined;

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
          onOpenModal={setViewModalEventId}
          onNavigate={navigate}
        />
      )}

      {view === "production" && activeEvent && (
        <DelayProductionScreen
          event={activeEvent}
          onProceed={(id) => setEventFulfillmentAndGo(id, "Instant Purchase")}
          onNeedsPurchase={(id, fulfillment, approval) => submitFulfillment(id, fulfillment, approval)}
          onSentToProduction={sentToProduction}
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
          dispatchRecord={activeDispatchRecord}
          onOpenFulfillment={() => openFulfillment(activeEvent.id)}
          onSendToDispatch={() => sendToDispatch(activeEvent)}
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
              {viewModalEvent && delayBadge(viewModalEvent.status)}
              <span className="font-normal text-sm text-muted-foreground ml-1">
                {viewModalEvent?.flightNumber} · {viewModalEvent?.sector}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4">
            {viewModalEvent && (
              <DelayDetailScreen
                event={viewModalEvent}
                approval={delayApprovals.find((a) => a.id === viewModalEvent.approvalId)}
                dispatchRecord={modalDispatchRecord}
                onOpenFulfillment={() => {
                  setViewModalEventId(null);
                  openFulfillment(viewModalEvent.id);
                }}
                onSendToDispatch={() => {
                  setViewModalEventId(null);
                  sendToDispatch(viewModalEvent);
                }}
                onClose={() => {
                  setViewModalEventId(null);
                  closeEvent(viewModalEvent.id);
                }}
                onNavigate={(path) => { setViewModalEventId(null); navigate(path); }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Delay List / Dashboard ───────────────────────────────────────────────────

function DelayList({
  events, approvals, onOpenFulfillment, onOpenModal, onNavigate,
}: {
  events: DelayEvent[];
  approvals: DelayApprovalRecord[];
  onOpenFulfillment: (id: string) => void;
  onOpenModal: (id: string) => void;
  onNavigate: ReturnType<typeof useNavigate>;
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

  const active     = events.filter(isActiveDelayEvent).length;
  const pending    = events.filter((e) => e.status === "Approval Pending").length;
  const dispatched = events.filter((e) => e.status === "Dispatched" || e.status === "Sent To Dispatch").length;

  // ── At-a-glance breakdowns for the KPI cards ────────────────────────────────
  // Extra stage counts + passenger tallies so each card reads like the dashboard
  // KPIs: a headline number, a "pax affected/served" stat pill, and a small
  // two-column breakdown of the sub-stages that make up the total.
  const pendingEvents      = events.filter((e) => e.status === "Approval Pending");
  const activeEvents       = events.filter(isActiveDelayEvent);
  const dispatchedEvents   = events.filter((e) => e.status === "Dispatched" || e.status === "Sent To Dispatch");
  const dispatchedOnly     = events.filter((e) => e.status === "Dispatched").length;
  const sentToDispatch     = events.filter((e) => e.status === "Sent To Dispatch").length;
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
            {(["Received","Validated","Fulfillment Pending","Approval Pending","Approved","Rejected","Sent To Production","Sent To Dispatch","Dispatched","Closed"] as DelayStatus[]).map((s) => (
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

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wider w-28">Event ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-center">Delay</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Meal Type</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                  No delay events found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((ev) => (
                <TableRow
                  key={ev.id}
                  className="hover:bg-muted/30 cursor-pointer"
                  onClick={() => onOpenModal(ev.id)}
                >
                  <TableCell className="font-mono text-xs font-semibold text-primary">{ev.id}</TableCell>
                  <TableCell>
                    <div className="font-medium">{ev.flightNumber}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{ev.orderNo}</div>
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">{ev.flightDate}</TableCell>
                  <TableCell className="text-xs">{ev.sector}</TableCell>
                  <TableCell className="text-center tabular-nums font-semibold text-warning">
                    {ev.delayDurationHours}h
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{ev.mealType ?? "—"}</span>
                  </TableCell>
                  <TableCell>{delayBadge(ev.status)}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      {ev.status === "Fulfillment Pending" && (
                        <Button size="sm" className="h-7 text-xs"
                          onClick={() => onOpenFulfillment(ev.id)}>
                          Fulfil <ChevronRight className="h-3 w-3 ml-0.5" />
                        </Button>
                      )}
                      {ev.status === "Approved" && (
                        <Button size="sm" className="h-7 text-xs bg-teal-600 text-white hover:bg-teal-700"
                          onClick={() => onOpenModal(ev.id)}>
                          Dispatch <Truck className="h-3 w-3 ml-1" />
                        </Button>
                      )}
                      <Button size="icon" variant="outline" className="h-7 w-7"
                        onClick={() => onOpenModal(ev.id)} title="View details">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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

  // Dynamic items for "Other" meal type
  const [otherItems, setOtherItems] = useState<Array<{ name: string; qty: number; unitCost: number }>>([
    { name: "", qty: 0, unitCost: 0 },
  ]);

  // Multiple flights + meal types can be selected. The "primary" (first) of each
  // drives the live preview; on save we fan out one delay event per flight × meal
  // combination, so every downstream screen keeps working on single-value events.
  const selectedOrders = dispatched.filter((o) => selectedOrderIds.includes(o.id));
  const hoursFor = (id: string) => Number(durationByFlight[id]) || 0;
  const setDurationFor = (id: string, v: string) => setDurationByFlight((prev) => ({ ...prev, [id]: v }));
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
      ? otherItems.filter((i) => i.name.trim() !== "").map((i) => ({ name: i.name.trim(), requiredQty: i.qty, uom: "pcs", unitCost: i.unitCost }))
      : (tp > 0 ? menuItemsFromPlan(meal, order.date, tp, mealPlanCards) : []);

  const updateOtherItem = (idx: number, field: "name" | "qty" | "unitCost", val: string) => {
    setOtherItems((prev) => prev.map((it, i) =>
      i === idx ? { ...it, [field]: field === "name" ? val : Number(val) || 0 } : it,
    ));
  };
  const addOtherItem    = () => setOtherItems((prev) => [...prev, { name: "", qty: 0, unitCost: 0 }]);
  const removeOtherItem = (idx: number) => setOtherItems((prev) => prev.filter((_, i) => i !== idx));

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
    const now = stamp();
    // Fan out: ONE delay event per flight (not per meal). Each event carries ALL
    // selected meal types — a combined label plus the aggregated menu items — so a
    // single Delay ID covers the flight's whole refreshment requirement.
    const events: DelayEvent[] = [];
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
      const aggItems = meals.flatMap((meal) => itemsFor(order, meal, tp));
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
          const revised = o.etd && hrs > 0 ? to12h(addHoursToEtd(o.etd, hrs)) : null;
          const tone = CARD_TONES[idx % CARD_TONES.length];
          const weekday = new Date(o.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
          const tp = (o.pax ?? 0) + (o.crew ?? 0);
          const meals = mealsFor(o.id);
          return (
            <div key={o.id} className={cn("rounded-md border p-4 space-y-3", tone)}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-semibold">{o.flight} · {o.sector}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {o.date} · ETD {o.etd ? to12h(o.etd) : "—"}
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
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Delay Duration (hours) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={durationByFlight[o.id] ?? ""}
                    onChange={(e) => setDurationFor(o.id, e.target.value)}
                    className="mt-1 h-9 tabular-nums"
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
                      {MEAL_TYPES.map((mt) => (
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
                    <Button size="sm" variant="outline" className="h-7 text-xs bg-background" onClick={() => navigate("/meal-planning")}>
                      <ExternalLink className="h-3 w-3 mr-1" /> Change Menu
                    </Button>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/70 divide-y divide-border/50">
                    {meals.map((meal) => {
                      const isOther = meal === "Other";
                      const items = isOther
                        ? otherItems.filter((i) => i.name.trim() !== "").map((i) => ({ name: i.name.trim(), requiredQty: i.qty, uom: "pcs" }))
                        : menuItemsFromPlan(meal, o.date, tp, mealPlanCards);
                      const matched = !isOther && mealPlanCards.some(
                        (c) => c.mealType.toLowerCase() === meal.toLowerCase() && c.day === weekday,
                      );
                      return (
                        <div key={meal} className="px-3 py-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold text-primary">{meal}</span>
                            {!isOther && (
                              <span className="text-[10px] text-muted-foreground">{matched ? "(matched to plan)" : "(defaults)"}</span>
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

        {/* ── "Other" dynamic item entry ──────────────────────────────── */}
        {anyOther && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Items — Other <span className="text-destructive">*</span>
              </Label>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addOtherItem}>
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
                  {otherItems.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <Input value={item.name}
                          onChange={(e) => updateOtherItem(idx, "name", e.target.value)}
                          className="h-8 text-sm" placeholder="Item name" />
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
            <div className="flex justify-end mt-2">
              <div className="text-sm font-semibold">
                Total Cost: <span className="text-primary tabular-nums">৳ {otherTotal.toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}

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
    </div>
  );
}

// ─── Delay Production Screen ──────────────────────────────────────────────────

function DelayProductionScreen({
  event, onProceed, onNeedsPurchase, onSentToProduction, onCancel, nextDrId, nextDaId,
}: {
  event: DelayEvent;
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
  onCancel: () => void;
  nextDrId: string;
  nextDaId: string;
}) {
  const { addGRN } = useWorkflow();
  const [inventoryItems, setInventoryItems] = usePersistedState<InventoryItemMinimal[]>("inventory-items", []);
  const [drLog, setDrLog]                   = usePersistedState<DrLogEntry[]>("delay-dr-log", []);

  const [drOpen, setDrOpen]               = useState(false);
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

  const openProdModal = () => {
    setProdLines(items.map((mi, i) => ({ id: `pl-${i}`, name: mi.name, qty: mi.requiredQty })));
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

  const allSufficient = stockCheck.length > 0 && stockCheck.every((i) => i.sufficient);

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
    toast.success(`${nextDrId} recorded — stock updated. ${nextDaId} submitted for approval.`);
    onNeedsPurchase(event.id, fulfillment, approval);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="pt-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Production Check — {event.id}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {[
              ["Flight",    event.flightNumber],
              ["Date",      event.flightDate],
              ["Sector",    event.sector],
              ["Meal Type", event.mealType ?? "—"],
              ["Pax",       String(event.paxCount)],
              ["Crew",      String(event.crewCount)],
              ["Delay",     `${event.delayDurationHours}h`],
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
        <CardContent className="pt-5 space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Stock Availability Check</h3>

          {items.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No items derived from meal plan. Go back and select a different meal type.
            </div>
          ) : (
            <>
              <div className="border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-xs uppercase tracking-wider">Item Name</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right w-32">Required Qty</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right w-32">Current Stock</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider w-20">UoM</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-center w-32">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockCheck.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium text-sm">{item.name}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{item.requiredQty}</TableCell>
                        <TableCell className="text-right">
                          <button
                            type="button"
                            title="Click to view stock log"
                            className={cn(
                              "tabular-nums text-sm font-semibold underline decoration-dotted underline-offset-2 hover:opacity-80",
                              item.onHand === 0 ? "text-muted-foreground" :
                              item.sufficient ? "text-emerald-600" : "text-red-600",
                            )}
                            onClick={() => {
                              setStockLogLine({
                                id: item.name,
                                name: item.name,
                                qty: item.requiredQty,
                                unitCost: 0,
                                uom: item.uom,
                                expiry: "",
                                stockBefore: item.onHand,
                              });
                              setStockLogOpen(true);
                            }}
                          >
                            {item.onHand}
                          </button>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.uom}</TableCell>
                        <TableCell className="text-center">
                          {item.sufficient ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="h-3 w-3" /> Sufficient
                            </span>
                          ) : item.onHand > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                              <AlertTriangle className="h-3 w-3" /> Short {item.requiredQty - item.onHand}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                              <AlertTriangle className="h-3 w-3" /> Not In Stock
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className={cn(
                "rounded-md p-4 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4",
                allSufficient ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200",
              )}>
                <div>
                  {allSufficient ? (
                    <p className="text-sm font-semibold text-emerald-800">
                      All items available in kitchen stock — no external procurement needed.
                    </p>
                  ) : (
                    <p className="text-sm font-semibold text-amber-800">
                      Some items are insufficient. External procurement required.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {allSufficient
                      ? "Proceed from kitchen inventory — no external procurement needed."
                      : `${stockCheck.filter(i => !i.sufficient).length} insufficient item(s) will be forwarded for instant purchase.`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={onCancel}>
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Cancel
                  </Button>
                  <Button variant="outline" size="sm"
                    className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                    onClick={openProdModal}>
                    <ChefHat className="h-3.5 w-3.5 mr-1.5" /> Send to Production
                  </Button>
                  {allSufficient ? (
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => onProceed(event.id)}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Proceed — Kitchen Stock
                    </Button>
                  ) : (
                    <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={() => openDrModal(stockCheck.filter(i => !i.sufficient))}>
                      <ShoppingCart className="h-3.5 w-3.5 mr-1.5" /> Forward to Instant Purchase
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── Direct Receive – Spot Buy Modal ──────────────────────────────── */}
      <Dialog open={drOpen} onOpenChange={(v) => { if (!v) setDrOpen(false); }}>
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
  event, approval, dispatchRecord, onOpenFulfillment, onSendToDispatch, onClose, onNavigate,
}: {
  event: DelayEvent;
  approval: DelayApprovalRecord | undefined;
  dispatchRecord: DispatchRecordLike | undefined;
  onOpenFulfillment: () => void;
  onSendToDispatch: () => void;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const [drLog] = usePersistedState<DrLogEntry[]>("delay-dr-log", []);
  const [detailStockLog, setDetailStockLog] = useState<{ item: DrItem; log: DrLogEntry[] } | null>(null);
  const { productionEntries } = useWorkflow();
  const [allDispatchRecords] = usePersistedState<DispatchRecordLike[]>("dispatch-records", []);

  const f  = event.fulfillment;
  const dr = f?.directReceive;

  // The flight's earlier dispatches (everything for this flight other than this
  // delay dispatch) — shown as "Previous Dispatch History" before the delay one.
  const previousDispatches = allDispatchRecords
    .filter((d) => d.flightNos.includes(event.flightNumber) && d.id !== event.dispatchId)
    .sort((a, b) => (a.dispatch_sequence ?? 0) - (b.dispatch_sequence ?? 0));

  // Food items + qty for the Delay Dispatch Details card: use the dispatch
  // record's amenities when it resolves, otherwise fall back to the event's own
  // menu items so the card always shows the dispatched food, never a bare stub.
  const delayDispatchItems: { label: string; qty: number }[] =
    (dispatchRecord?.detail.amenities.length ?? 0) > 0
      ? dispatchRecord!.detail.amenities.map((a) => ({ label: a.label, qty: a.qty }))
      : (event.menuItems ?? []).map((mi) => ({ label: mi.name, qty: mi.requiredQty }));

  // ── Production route (delay food items cooked fresh) ──────────────────────
  const isProductionRoute = (event.productionOrderIds?.length ?? 0) > 0;
  const prodOrders = isProductionRoute
    ? productionEntries.filter((o) => event.productionOrderIds!.includes(o.id))
    : [];
  const allProdApproved = prodOrders.length > 0 &&
    prodOrders.every((o) => ["Approved", "In Preparation", "Ready for QC", "Completed"].includes(o.status));
  const allProdCompleted = prodOrders.length > 0 && prodOrders.every((o) => o.status === "Completed");

  const timelineSteps: Array<{ label: string; done: boolean; active: boolean }> = isProductionRoute
    ? [
        { label: "Delay Received",   done: true, active: false },
        { label: "Sent To Production", done: true, active: event.status === "Sent To Production" && !allProdApproved },
        { label: "Prod. Approved",   done: allProdApproved, active: allProdApproved && !allProdCompleted },
        { label: "Produced",         done: allProdCompleted, active: allProdCompleted && event.status === "Sent To Production" },
        { label: "Sent To Dispatch", done: ["Sent To Dispatch","Dispatched","Closed"].includes(event.status), active: event.status === "Sent To Dispatch" },
        { label: "Dispatched",       done: ["Dispatched","Closed"].includes(event.status), active: ["Dispatched","Closed"].includes(event.status) },
      ]
    : [
        { label: "Delay Received",    done: true, active: event.status === "Received" },
        { label: "Validated",         done: event.status !== "Received", active: event.status === "Validated" },
        { label: "Fulfillment",       done: !["Received","Validated"].includes(event.status), active: event.status === "Fulfillment Pending" },
        { label: "Approval Pending",  done: !["Received","Validated","Fulfillment Pending"].includes(event.status), active: event.status === "Approval Pending" },
        { label: "Approved",          done: ["Approved","Sent To Dispatch","Dispatched","Closed"].includes(event.status), active: event.status === "Approved" },
        { label: "Sent To Dispatch",  done: ["Sent To Dispatch","Dispatched","Closed"].includes(event.status), active: event.status === "Sent To Dispatch" },
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
        {event.status === "Approved" && (
          <Button size="sm" className="bg-teal-600 text-white hover:bg-teal-700" onClick={onSendToDispatch}>
            <Truck className="h-3.5 w-3.5 mr-1.5" /> Send to Dispatch
          </Button>
        )}
        {event.status === "Sent To Production" && allProdCompleted && (
          <Button size="sm" className="bg-teal-600 text-white hover:bg-teal-700" onClick={onSendToDispatch}>
            <Truck className="h-3.5 w-3.5 mr-1.5" /> Send to Dispatch
          </Button>
        )}
        {event.dispatchId && (
          <Button size="sm" variant="outline" onClick={() => onNavigate("/dispatch")}>
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View in Dispatch
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

      {/* Fulfillment details */}
      {f && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fulfillment Details</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {[
                ["Item Type",    f.itemType],
                ["Final Qty",    String(f.finalQty)],
                ["Method",       f.fulfillmentType],
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

      {/* Production Orders (delay food items cooked fresh) */}
      {isProductionRoute && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Production Orders
              </div>
              <Button size="sm" variant="outline" onClick={() => onNavigate("/production-entry")}>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View in Production
              </Button>
            </div>

            <div className="border border-border rounded-md overflow-x-auto -mx-1 px-1">
              <Table className="min-w-[520px]">
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wider">Order No</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">Order Qty</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">Produced</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prodOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-4">
                        {event.productionOrderIds?.length ?? 0} order(s) raised — open the Production module to track them.
                      </TableCell>
                    </TableRow>
                  ) : prodOrders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs font-semibold text-primary">{o.id}</TableCell>
                      <TableCell className="text-sm font-medium">{o.outputItemName ?? o.bom}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{(o.orderQty ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{o.producedQty.toLocaleString()}</TableCell>
                      <TableCell>
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold",
                          o.status === "Completed" ? "bg-emerald-100 text-emerald-700" :
                          o.status === "Ready for QC" ? "bg-teal-100 text-teal-700" :
                          o.status === "In Preparation" ? "bg-amber-100 text-amber-700" :
                          o.status === "Approved" ? "bg-blue-100 text-blue-700" :
                          o.status === "Re-Cook" ? "bg-red-100 text-red-700" :
                          "bg-slate-100 text-slate-600",
                        )}>
                          {o.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {allProdCompleted ? (
              <p className="text-xs font-medium text-emerald-700">
                All production orders completed — ready to send to dispatch.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Orders flow through Approval Management → Production Entry → QC. This event can be dispatched once every order is Completed.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Approval record */}
      {approval && (
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Approval — {approval.id}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
                <div className={cn("mt-0.5 font-semibold",
                  approval.status === "Approved" ? "text-emerald-700" :
                  approval.status === "Declined" ? "text-red-600" : "text-amber-700")}>
                  {approval.status}
                </div>
              </div>
              {[["Submitted By", approval.submittedBy], ["Submitted At", approval.submittedAt],
                ...(approval.processedBy ? [["Processed By", approval.processedBy]] : []),
                ...(approval.processedAt ? [["Processed At", approval.processedAt]] : []),
              ].map(([l, v]) => (
                <div key={l}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
                  <div className="mt-0.5 font-medium text-sm tabular-nums">{v}</div>
                </div>
              ))}
              {approval.declineReason && (
                <div className="md:col-span-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Decline Reason</div>
                  <div className="mt-0.5 font-medium text-red-600">{approval.declineReason}</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Previous dispatch history — the flight's earlier dispatches */}
      {event.dispatchId && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Previous Dispatch History
              </div>
              <Button size="sm" variant="outline" onClick={() => onNavigate("/dispatch")}>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View in Dispatch
              </Button>
            </div>

            {previousDispatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No previous dispatches recorded for {event.flightNumber}.
              </p>
            ) : (
              <div className="space-y-3">
                {previousDispatches.map((d) => (
                  <div key={d.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        title="View in Dispatch"
                        className="font-mono text-xs font-semibold text-primary underline decoration-dotted underline-offset-2 hover:opacity-80"
                        onClick={() => onNavigate("/dispatch")}
                      >
                        {d.id}
                      </button>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${d.status === "Dispatched" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {d.status}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {d.detail.amenities.map((a) => a.label).join(", ") || "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Delay dispatch details — ID, food items & qty, status Dispatched */}
      {event.dispatchId && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Delay Dispatch Details
              </div>
              <Button size="sm" variant="outline" onClick={() => onNavigate("/dispatch")}>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View in Dispatch
              </Button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                title="View in Dispatch"
                className="font-mono text-xs font-semibold text-primary underline decoration-dotted underline-offset-2 hover:opacity-80"
                onClick={() => onNavigate("/dispatch")}
              >
                {event.dispatchId}
              </button>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                Dispatched
              </span>
            </div>

            {delayDispatchItems.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Food Items</div>
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {delayDispatchItems.map((it, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm font-medium">{it.label}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{it.qty}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
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
