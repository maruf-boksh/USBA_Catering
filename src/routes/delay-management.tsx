import { useState, useMemo } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { KpiCard } from "@/components/common/KpiCard";
import {
  Clock, Plus, ArrowLeft, CheckCircle2, AlertTriangle, Truck, ShoppingCart,
  PackageOpen, Send, Timer, Eye, ChevronRight,
  ExternalLink, Trash2, PlusCircle, ListChecks, Zap, History, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useFlightOrders } from "@/lib/flight-orders-store";
import { vendors } from "@/lib/sample-data";
import { LocationPicker } from "@/components/common/LocationPicker";
import { useWorkflow, type WfGRN, type WfGRNLine, type StockDelta } from "@/lib/workflow-store";
import { reduceInventoryStock } from "@/lib/stock-adjustments";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DelayStatus =
  | "Received"
  | "Validated"
  | "Fulfillment Pending"
  | "Approval Pending"
  | "Approved"
  | "Rejected"
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
  {
    id: "DEL-0002",
    flightOrderId: "FO-DSP-1",
    orderNo: "ORD-3425",
    flightNumber: "BS-411",
    flightDate: "2026-05-21",
    sector: "CGP → DXB",
    paxCount: 162,
    crewCount: 8,
    delayDurationHours: 2,
    reason: "ATC Hold — Congestion at DXB, slot delay issued",
    reportedBy: "S. Mahmud",
    status: "Approved",
    createdAt: "2026-05-21 16:00",
    updatedAt: "2026-05-21 17:10",
    mealType: "Heavy Snacks",
    menuItems: [
      { name: "Snack Pack", requiredQty: 170, uom: "pcs" },
      { name: "Mineral Water 500ml", requiredQty: 170, uom: "pcs" },
    ],
    fulfillment: {
      id: "DFR-0002",
      itemType: "Heavy Snacks",
      suggestedQty: 170,
      finalQty: 170,
      fulfillmentType: "Direct Receive",
      requestedBy: "R. Islam",
      notes: "Priority delivery — gate B7",
      directReceive: {
        id: "DR-0001",
        vendorName: "Fresh Bites Catering Co.",
        items: [
          { name: "Mineral Water 500ml", qty: 170, unitCost: 20 },
          { name: "Snack Pack",          qty: 136, unitCost: 95 },
        ],
        totalCost: 16320,
        receivedBy: "R. Islam",
        receivedAt: "2026-05-21 17:45",
      },
    },
    approvalId: "DA-0001",
  },
  // Demo: approved event ready to send to dispatch — resets to this state on fresh localStorage clear
  {
    id: "DEL-DEMO",
    flightOrderId: "FO-DSP-2",
    orderNo: "ORD-3426",
    flightNumber: "BG-521",
    flightDate: "2026-05-22",
    sector: "DAC → DOH",
    paxCount: 196,
    crewCount: 12,
    delayDurationHours: 3,
    reason: "Ground delay — Late incoming aircraft",
    reportedBy: "Station Control (DAC)",
    status: "Approved",
    createdAt: "2026-05-22 07:30",
    updatedAt: "2026-05-22 09:00",
    mealType: "Breakfast",
    originalEtd: "08:00",
    menuItems: [
      { name: "Breakfast Box", requiredQty: 208, uom: "pcs" },
      { name: "Juice Box",     requiredQty: 208, uom: "pcs" },
      { name: "Mineral Water 500ml", requiredQty: 208, uom: "pcs" },
    ],
    fulfillment: {
      id: "DFR-DEMO",
      itemType: "Breakfast",
      suggestedQty: 250,
      finalQty: 250,
      fulfillmentType: "Direct Receive",
      requestedBy: "T. Ahmed",
      notes: "Expedited delivery — pier 6",
      directReceive: {
        id: "DR-DEMO",
        vendorName: "Sky Meals Ltd.",
        items: [
          { name: "Breakfast Box",     qty: 208, unitCost: 220 },
          { name: "Juice Box",         qty: 208, unitCost: 55 },
          { name: "Mineral Water 500ml", qty: 208, unitCost: 20 },
        ],
        totalCost: 60944,
        receivedBy: "T. Ahmed",
        receivedAt: "2026-05-22 09:30",
      },
    },
    approvalId: "DA-DEMO",
  },
];

/** A delay event still in play — not resolved (Closed) or Rejected. The one
 *  definition of "active", shared by the Delay Management KPI and the dashboard. */
export const isActiveDelayEvent = (e: DelayEvent) => !["Closed", "Rejected"].includes(e.status);

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
    processedBy: "R. Hossain (GM/Admin)",
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
    processedBy: "R. Hossain (GM/Admin)",
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

type View = "list" | "create" | "production" | "fulfillment" | "detail";

export default function DelayManagementPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [view, setView]                   = useState<View>("list");
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  /** Event ID shown in the view modal (eye icon). null = modal closed. */
  const [viewModalEventId, setViewModalEventId] = useState<string | null>(null);

  const [delayEvents, setDelayEvents]       = usePersistedState<DelayEvent[]>("delay-events", SEED_EVENTS);
  const [delayApprovals, setDelayApprovals] = usePersistedState<DelayApprovalRecord[]>("delay-approval-records", SEED_APPROVALS);
  const [dispatchRecords, setDispatchRecords] = usePersistedState<DispatchRecordLike[]>("dispatch-records", []);
  const [packagingRows, setPackagingRows]   = usePersistedState<PackagingRowLike[]>("dispatch-packaging-rows", []);
  const { applyStockDeltas } = useWorkflow();

  // Ensure the demo dispatch record is present in dispatch-records on first load
  const demoPresent = dispatchRecords.some((d) => d.id === "DSP-DEL-DEMO");
  if (!demoPresent) {
    setDispatchRecords((prev) => [...prev, SEED_DEMO_DISPATCH]);
  }

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

  const openFulfillment = (eventId: string) => { setActiveEventId(eventId); setView("fulfillment"); };

  const createEvent = (ev: DelayEvent) => {
    setDelayEvents((prev) => [ev, ...prev]);
    setActiveEventId(ev.id);
    setView("production");
    toast.success(`${ev.id} created — check production requirements.`);
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

  const sendToDispatch = (event: DelayEvent) => {
    if (event.status !== "Approved") return;
    const now = stamp();
    const today = now.slice(0, 10);
    // Compute delayed dep time in airline 12h standard (original ETD + delay hours)
    const rawDelayed = event.originalEtd ? addHoursToEtd(event.originalEtd, event.delayDurationHours) : null;
    const depTimeBase = rawDelayed ? to12h(rawDelayed) : (event.flightDate === today ? to12h(now.slice(11, 16)) : "00:00");
    // Packaging rows display dep time with delay note so crew can identify it
    const depTime = rawDelayed
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

    setPackagingRows((prev) => [...prev, ...newPkgRows]);
    setDispatchRecords((prev) => [...prev, newRecord]);
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
            <Button onClick={() => setView("create")}>
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

      {view === "create" && (
        <DelayCreate
          nextId={nextDelId}
          nextDfrId={nextDfrId}
          onCreate={createEvent}
        />
      )}

      {view === "production" && activeEvent && (
        <DelayProductionScreen
          event={activeEvent}
          onProceed={(id) => setEventFulfillmentAndGo(id, "Instant Purchase")}
          onNeedsPurchase={(id, fulfillment, approval) => submitFulfillment(id, fulfillment, approval)}
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

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Events"     value={events.length} icon={Clock}         tone="navy"    />
        <KpiCard label="Active"           value={active}        icon={AlertTriangle}  tone="warning" />
        <KpiCard label="Pending Approval" value={pending}       icon={Send}          tone="warning" />
        <KpiCard label="Dispatched"       value={dispatched}    icon={Truck}         tone="success" />
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
            {(["Received","Validated","Fulfillment Pending","Approval Pending","Approved","Rejected","Sent To Dispatch","Dispatched","Closed"] as DelayStatus[]).map((s) => (
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

function DelayCreate({
  nextId, nextDfrId, onCreate,
}: {
  nextId: string;
  nextDfrId: string;
  onCreate: (ev: DelayEvent) => void;
}) {
  const flightOrders = useFlightOrders();
  const dispatched   = useMemo(() => flightOrders.filter((o) => o.status === "Dispatched"), [flightOrders]);

  const [mealPlanCards] = usePersistedState<MealCardMinimal[]>("meal-planning-config", []);

  const [selectedOrderId, setSelectedOrderId]   = useState("");
  const [durationHours, setDurationHours]       = useState("2");
  const [selectedMealType, setSelectedMealType] = useState("");
  const [reasonPreset, setReasonPreset]         = useState("");
  const [reasonCustom, setReasonCustom]         = useState("");
  const [reportedBy, setReportedBy]             = useState("");

  // Dynamic items for "Other" meal type
  const [otherItems, setOtherItems] = useState<Array<{ name: string; qty: number; unitCost: number }>>([
    { name: "", qty: 0, unitCost: 0 },
  ]);

  const selectedOrder = dispatched.find((o) => o.id === selectedOrderId);
  const effectivePax  = selectedOrder?.pax  ?? 0;
  const effectiveCrew = selectedOrder?.crew ?? 0;
  const totalPax      = effectivePax + effectiveCrew;
  const hours         = Number(durationHours) || 0;
  const suggestedQty  = Math.ceil(totalPax * durationMultiplier(hours));

  // Airline-standard delayed departure time
  const originalEtd   = (selectedOrder as any)?.etd as string | undefined;
  const delayedDepTime = originalEtd && hours > 0
    ? to12h(addHoursToEtd(originalEtd, hours))
    : null;

  const handleMealTypeChange = (mt: string) => {
    setSelectedMealType(mt);
    if (mt === "Other" && otherItems.length === 0) {
      setOtherItems([{ name: "", qty: 0, unitCost: 0 }]);
    }
  };

  // Auto-populate items from meal plan
  const planMenuItems = useMemo((): DelayMenuItem[] => {
    if (!selectedMealType || selectedMealType === "Other" || !selectedOrder || totalPax === 0) return [];
    return menuItemsFromPlan(selectedMealType, selectedOrder.date, totalPax, mealPlanCards);
  }, [selectedMealType, selectedOrder, totalPax, mealPlanCards]);

  // Items for "Other" — derived from otherItems state with unitCost
  const otherMenuItems = useMemo((): DelayMenuItem[] => {
    if (selectedMealType !== "Other") return [];
    return otherItems
      .filter((i) => i.name.trim() !== "")
      .map((i) => ({ name: i.name.trim(), requiredQty: i.qty, uom: "pcs", unitCost: i.unitCost }));
  }, [selectedMealType, otherItems]);

  const menuItems = selectedMealType === "Other" ? otherMenuItems : planMenuItems;

  const otherTotal = otherItems.reduce((s, i) => s + i.qty * i.unitCost, 0);

  const updateOtherItem = (idx: number, field: "name" | "qty" | "unitCost", val: string) => {
    setOtherItems((prev) => prev.map((it, i) =>
      i === idx ? { ...it, [field]: field === "name" ? val : Number(val) || 0 } : it,
    ));
  };
  const addOtherItem    = () => setOtherItems((prev) => [...prev, { name: "", qty: 0, unitCost: 0 }]);
  const removeOtherItem = (idx: number) => setOtherItems((prev) => prev.filter((_, i) => i !== idx));

  const planMatched = selectedOrder && selectedMealType && selectedMealType !== "Other" &&
    mealPlanCards.some((c) =>
      c.mealType.toLowerCase() === selectedMealType.toLowerCase() &&
      c.day === new Date(selectedOrder.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" }),
    );

  const effectiveReason = reasonPreset === "Other" ? reasonCustom.trim() : reasonPreset;

  const save = () => {
    if (!selectedOrder) { toast.error("Select a dispatched flight order."); return; }
    if (!hours || hours <= 0) { toast.error("Delay duration must be positive."); return; }
    if (!selectedMealType) { toast.error("Select a meal type."); return; }
    if (!reasonPreset) { toast.error("Select a delay reason."); return; }
    if (reasonPreset === "Other" && !reasonCustom.trim()) { toast.error("Enter the delay reason."); return; }
    if (!reportedBy.trim()) { toast.error("Reported by is required."); return; }
    if (selectedMealType === "Other") {
      const valid = otherItems.filter((i) => i.name.trim() && i.qty > 0);
      if (valid.length === 0) { toast.error("Add at least one item with a name and quantity."); return; }
    }
    const now = stamp();
    const event: DelayEvent = {
      id: nextId,
      flightOrderId: selectedOrder.id,
      orderNo: selectedOrder.orderNo,
      flightNumber: selectedOrder.flight,
      flightDate: selectedOrder.date,
      sector: selectedOrder.sector,
      paxCount: effectivePax,
      crewCount: effectiveCrew,
      delayDurationHours: hours,
      reason: effectiveReason,
      reportedBy: reportedBy.trim(),
      status: "Fulfillment Pending",
      createdAt: now,
      updatedAt: now,
      mealType: selectedMealType,
      originalEtd: originalEtd ?? undefined,
      menuItems,
      fulfillment: {
        id: nextDfrId,
        itemType: selectedMealType,
        suggestedQty,
        finalQty: suggestedQty,
        fulfillmentType: "Direct Receive",
        requestedBy: reportedBy.trim(),
        notes: "",
      },
    };
    onCreate(event);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider">New Delay Event</h3>
        <Button onClick={save}>
          <Send className="h-4 w-4 mr-1.5" /> Create &amp; Go to Fulfillment
        </Button>
      </div>

      <div className="space-y-5">
        {/* Flight Order */}
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Dispatched Flight Order <span className="text-destructive">*</span>
          </Label>
          <Select value={selectedOrderId} onValueChange={setSelectedOrderId}>
            <SelectTrigger className="mt-1 h-9">
              <SelectValue placeholder="Select dispatched order…" />
            </SelectTrigger>
            <SelectContent>
              {dispatched.length === 0 ? (
                <SelectItem value="_none" disabled>No dispatched orders found</SelectItem>
              ) : (
                dispatched.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.flight} — {o.sector} ({o.date}) · {o.orderNo}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {selectedOrder && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-md bg-muted/30 border border-border">
            {[["Flight #", selectedOrder.flight], ["Date", selectedOrder.date],
              ["Sector", selectedOrder.sector], ["Order No.", selectedOrder.orderNo]].map(([label, val]) => (
              <div key={label}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className="mt-0.5 text-sm font-medium">{val}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Delay Duration (hours) <span className="text-destructive">*</span>
            </Label>
            <Input type="number" min={0.5} step={0.5} value={durationHours}
              onChange={(e) => setDurationHours(e.target.value)} className="mt-1 tabular-nums" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Meal Type <span className="text-destructive">*</span>
            </Label>
            <Select value={selectedMealType} onValueChange={handleMealTypeChange}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="Select meal type…" />
              </SelectTrigger>
              <SelectContent>
                {MEAL_TYPES.map((mt) => (
                  <SelectItem key={mt} value={mt}>{mt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Pax Count</Label>
            <div className="mt-1 h-9 flex items-center px-3 rounded-md border border-input bg-muted/50 text-sm tabular-nums text-muted-foreground select-none">
              {effectivePax || "—"}
            </div>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Crew Count</Label>
            <div className="mt-1 h-9 flex items-center px-3 rounded-md border border-input bg-muted/50 text-sm tabular-nums text-muted-foreground select-none">
              {effectiveCrew || "—"}
            </div>
          </div>

          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Delay Reason <span className="text-destructive">*</span>
            </Label>
            <Select value={reasonPreset} onValueChange={setReasonPreset}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="Select delay reason…" />
              </SelectTrigger>
              <SelectContent>
                {DELAY_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reasonPreset === "Other" && (
              <Input
                value={reasonCustom}
                onChange={(e) => setReasonCustom(e.target.value)}
                placeholder="Describe the delay reason…"
                className="mt-2 text-sm"
              />
            )}
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Reported By <span className="text-destructive">*</span>
            </Label>
            <Input value={reportedBy} onChange={(e) => setReportedBy(e.target.value)}
              placeholder="Name / department" className="mt-1" />
          </div>

          {delayedDepTime && (
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Revised Dep. Time (ETD + {hours}h)
              </Label>
              <div className="mt-1 h-9 flex items-center px-3 rounded-md border border-amber-300 bg-amber-50 text-sm font-semibold text-amber-800 tabular-nums">
                {delayedDepTime}
              </div>
            </div>
          )}
        </div>

        {/* ── "Other" dynamic item entry ──────────────────────────────── */}
        {selectedMealType === "Other" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Items <span className="text-destructive">*</span>
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

        {/* ── Summary + auto-populated plan items preview ─────────────── */}
        {selectedOrder && hours > 0 && selectedMealType && selectedMealType !== "Other" && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 p-4 rounded-md border border-primary/20 bg-primary/[0.04]">
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Pax + Crew</div>
                <div className="mt-0.5 text-base font-bold tabular-nums">{totalPax}</div>
              </div>
              <div className="text-center border-x border-primary/10">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Suggested Qty</div>
                <div className="mt-0.5 text-base font-bold tabular-nums text-primary">{suggestedQty}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Meal Type</div>
                <div className="mt-0.5 text-sm font-semibold">{selectedMealType}</div>
              </div>
            </div>

            {planMenuItems.length > 0 && (
              <div className="border border-border rounded-md overflow-hidden">
                <div className="px-4 py-2 bg-muted/40 flex items-center gap-2">
                  <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Items from Menu Plan — {selectedMealType}
                    {planMatched ? " (matched)" : " (defaults)"}
                  </span>
                </div>
                <Table>
                  <TableHeader className="bg-muted/20">
                    <TableRow>
                      <TableHead className="text-xs uppercase tracking-wider">Item Name</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right w-32">Required Qty</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider w-20">UoM</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {planMenuItems.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm font-medium">{item.name}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{item.requiredQty}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.uom}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/10">
                  Stock availability will be verified in the next step.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Delay Production Screen ──────────────────────────────────────────────────

function DelayProductionScreen({
  event, onProceed, onNeedsPurchase, onCancel, nextDrId, nextDaId,
}: {
  event: DelayEvent;
  onProceed: (id: string) => void;
  onNeedsPurchase: (id: string, fulfillment: DelayFulfillment, approval: DelayApprovalRecord) => void;
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

  const items = event.menuItems ?? [];

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
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={onCancel}>
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Cancel
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
                  {Math.max(0, stockLogLine.qty - stockLogLine.stockBefore)} {stockLogLine.uom}
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

  const f  = event.fulfillment;
  const dr = f?.directReceive;

  const timelineSteps: Array<{ label: string; done: boolean; active: boolean }> = [
    { label: "Delay Received",    done: true, active: event.status === "Received" },
    { label: "Validated",         done: event.status !== "Received", active: event.status === "Validated" },
    { label: "Fulfillment",       done: !["Received","Validated"].includes(event.status), active: event.status === "Fulfillment Pending" },
    { label: "Approval Pending",  done: !["Received","Validated","Fulfillment Pending"].includes(event.status), active: event.status === "Approval Pending" },
    { label: "Approved",          done: ["Approved","Sent To Dispatch","Dispatched","Closed"].includes(event.status), active: event.status === "Approved" },
    { label: "Sent To Dispatch",  done: ["Sent To Dispatch","Dispatched","Closed"].includes(event.status), active: event.status === "Sent To Dispatch" },
    { label: "Dispatched",        done: ["Dispatched","Closed"].includes(event.status), active: event.status === "Dispatched" },
    { label: "Closed",            done: event.status === "Closed", active: event.status === "Closed" },
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
        {(event.status === "Dispatched" || event.status === "Sent To Dispatch") && (
          <Button size="sm" variant="outline" onClick={onClose}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Close Event
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
                      {dr.items.map((item, i) => {
                        const itemLog = drLog.filter(
                          (e) => e.eventId === event.id && e.itemName.trim().toLowerCase() === item.name.trim().toLowerCase(),
                        );
                        return (
                          <TableRow key={i}>
                            <TableCell className="font-medium text-sm">{item.name}</TableCell>
                            <TableCell className="text-right">
                              <button
                                type="button"
                                title="Click to view stock log"
                                className="tabular-nums text-sm font-semibold text-primary underline decoration-dotted underline-offset-2 hover:opacity-80"
                                onClick={() => setDetailStockLog({ item, log: itemLog })}
                              >
                                {item.qty}
                              </button>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm">৳ {item.unitCost.toLocaleString()}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm font-semibold">
                              ৳ {(item.qty * item.unitCost).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        );
                      })}
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

      {/* Dispatch details with full activity log */}
      {event.dispatchId && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Dispatch — {event.dispatchId}
              </div>
              <Button size="sm" variant="outline" onClick={() => onNavigate("/dispatch")}>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View in Dispatch
              </Button>
            </div>

            {dispatchRecord ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  {[
                    ["Status",      dispatchRecord.status],
                    ["Date",        dispatchRecord.date],
                    ["Dep. Time",   dispatchRecord.depTime],
                    ["Type",        dispatchRecord.dispatch_type ?? "Delay Refreshment"],
                    ["Total Meals", String(dispatchRecord.detail.flightKitchen.totalMeals)],
                    ["Sequence",    String(dispatchRecord.dispatch_sequence ?? "—")],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
                      <div className="mt-0.5 font-medium text-sm">{v}</div>
                    </div>
                  ))}
                </div>

                {dispatchRecord.detail.amenities.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Items</div>
                    <div className="border border-border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader className="bg-muted/40">
                          <TableRow>
                            <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                            <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dispatchRecord.detail.amenities.map((a, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-sm font-medium">{a.label}</TableCell>
                              <TableCell className="text-right tabular-nums text-sm">{a.qty}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Full activity log / dispatch trail */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Activity Log
                  </div>
                  <div className="space-y-2">
                    {dispatchRecord.trail.map((entry, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                        <div className="text-sm flex flex-wrap gap-x-2">
                          <span className="font-semibold">{entry.status}</span>
                          <span className="text-muted-foreground">— {entry.by}</span>
                          <span className="tabular-nums text-xs text-muted-foreground">
                            {entry.date} {entry.time}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Navigate to the Dispatch module to view the full QC &amp; dispatch trail for{" "}
                <span className="font-mono font-medium">{event.dispatchId}</span>.
              </p>
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
