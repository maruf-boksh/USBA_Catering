import { useState, useMemo, useEffect, useRef } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Truck, Package, Plus, AlertTriangle, Bell, MoreHorizontal,
  Eye, Croissant, Pill, ShieldCheck, Download,
  CheckCircle2, ThermometerSun, PlaneLanding, User, Clock, MoveRight,
} from "lucide-react";
import { flights, meals, activeWarehouses, activeOffices, activeWarehousesByOffice } from "@/lib/sample-data";
import {
  dayFromDate, parseMealQty, resolveCrewDish, resolveSpecialDish,
} from "@/lib/meal-planning-data";
import { useFlightOrders, getOrderAmendments, type FlightOrder } from "@/lib/flight-orders-store";
import { KpiCard } from "@/components/common/KpiCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useArrivalFlash, flagArrival } from "@/lib/arrival-flash";
import { useWorkflow } from "@/lib/workflow-store";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DispatchStatus = "Preparing" | "Prepared" | "Ready For QC" | "Ready For Dispatch" | "Dispatched" | "Returned";

type StatusLog = { status: DispatchStatus; by: string; date: string; time: string };

/** Advance a dispatch record's status AND append it to the status trail, stamped
 *  with the current date/time. Returns the record untouched when the status
 *  hasn't actually changed (so no duplicate trail rows). Every status mutation
 *  goes through this so the trail captures the full lifecycle, not just create +
 *  dispatch. */
function withStatusLog(r: DispatchRecord, status: DispatchStatus, by: string): DispatchRecord {
  if (r.status === status) return r;
  const now = new Date();
  const date = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
  return { ...r, status, trail: [...r.trail, { status, by, date, time }] };
}

type DispatchDetail = {
  flightKitchen: { name: string; totalMeals: number; lunch: number; breakfast: number };
  bakery: { name: string; qty: number }[];
  amenities: { label: string; qty: number }[];
  foodSafety: { result: "Passed" | "Failed" | "—"; checkedBy: string; date: string; time: string };
};

type PaxLine = { itemName: string; percent: number; qty: number };
type CrewMealLine = { type: string; qty: string };
type DynamicItem = { id: string; name: string; qty: string };

// One row of the dispatch's Production Status — a meal tagged by audience and
// linked to its production order. PAX, Crew and Special all flow through this.
// A combined dispatch bundles two legs (outbound + return), so each line also
// carries which leg (flight/sector/direction) it belongs to.
type ProdAudience = "PAX" | "Crew" | "Special";
type LegDirection = "Outbound" | "Return";
type ProductionLine = {
  audience: ProdAudience;
  meal: string;                 // resolved dish name
  label: string;                // display label (crew/special prefix the period/code)
  needQty: number;
  proId: string | null;
  producedQty: number | null;
  status: string;
  ready: boolean;               // has a Completed (QC-passed) production order
  blocks: boolean;              // prevents dispatch until resolved
  legFlight: string;            // flight number this line belongs to
  legSector: string;            // sector (e.g. "SIN → DAC")
  legDirection: LegDirection;
};

// "SIN → DAC" / "SIN-DAC" → "DAC → SIN" — used to spot the reverse-sector leg.
function reverseSector(sector: string): string {
  const parts = sector.split(/→|—|–|-/).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return sector;
  return `${parts[1]} → ${parts[0]}`;
}

type FlightSection = {
  flightNo: string; sector: string;
  /** Outbound/Return — set by buildFlightSection; optional on seed literals. */
  direction?: LegDirection;
  paxLines: PaxLine[];
  vgml: number; chml: number; spml: number;
  crewMeals: CrewMealLine[];
  pastry: number; childMealsPastry: number;
};

export type DispatchRecord = {
  id: string;
  date: string;
  depTime: string;
  kitchenName: string;
  flightNos: string[];
  status: DispatchStatus;
  trail: StatusLog[];
  dispatchedBy?: string;
  notifiedAirport?: boolean;
  /** Inventory warehouses the dispatch moves meals between. Picked in the
   *  Configure New Dispatch modal; on "Dispatched" a Transfer Note is raised
   *  from → to so the movement lands in the Inventory → Transfer module. */
  fromWarehouseId?: string;
  toWarehouseId?: string;
  /** ISO time this dispatch was configured. Used to detect LMC staleness — a
   *  source order amended AFTER this is flagged for re-sync. Absent on legacy/
   *  seed records (never flagged). */
  builtAt?: string;
  detail: DispatchDetail;
  sections: FlightSection[];
  dynamicItems: DynamicItem[];
  /** Undefined / absent on all existing records — defaults to "Production". Only
   *  set on records created by Delay Management for a second dispatch. */
  dispatch_type?: "Production" | "Delay Refreshment";
  /** 1 = original production dispatch, 2 = delay refreshment dispatch. */
  dispatch_sequence?: number;
  /** Returned load captured when a transfer-in-transit is returned (Transfer →
   *  Return). Only these lines/quantities are re-dispatched — not the whole
   *  original dispatch. Set alongside status "Returned". */
  returnedLines?: { meal: string; qty: number; uom?: string; flight?: string }[];
};

type CfgPaxLine     = { id: string; itemName: string; percent: number; qty: number };
type CfgCrewMeal    = { id: string; type: string; qty: string };
type CfgSpecialMeal = { id: string; type: string; qty: string };
type CfgAdditional  = { id: string; name: string; qty: string };

// ─── Packaging Pipeline Types ─────────────────────────────────────────────────

type PackagingStatus =
  | "Ready for Packaging"
  | "Packaging In Progress"
  | "Packaging Done"
  | "Ready for Dispatch"
  | "Dispatched";

export type QCState = "not-started" | "in-progress" | "done";

export type PackagingRow = {
  id: string;
  date: string;
  depTime: string;
  flight: string;
  mealType: "Breakfast" | "Lunch" | "Dinner" | "Snack" | "Special";
  mealName: string;
  qty: number;
  section: string;
  packagingStatus: PackagingStatus;
  dspRef?: string;
  /** Upstream flight-order code (ORD-NNNN) from Order Management. */
  orderNo?: string;
  /** Upstream Production Order code (PRO-2026-NNNNNN). Set when the order
   *  flowed in from the Production Entry page. */
  productionOrderId?: string;
};

type FlightQCData = { qcState: QCState; qcCheckedAt?: string };

// Read-only shape of a Dispatch Monitoring sheet entry (persisted by the
// Dispatch Monitoring page under sessionStorage["dm_entries"]). The QC Report
// dialog mirrors this so both surfaces show the same cold-chain QC record.
type DmSheetEntry = {
  flightId: string;
  vehicleNo?: string;
  vehicleClean?: string;
  chilledTemp?: string;
  frozenTemp?: string;
  loadStartTime?: string;
  loadEndTime?: string;
  vehicleTempBegin?: string;
  vehicleTempEnd?: string;
  resultSatisfy?: string;
  monitoredByRemarks?: string;
  monitoredAt?: string;
  approvalStage?: number;
  verifiedBy?: { name?: string; date?: string; time?: string; remarks?: string };
  approvedBy?: { name?: string; date?: string; time?: string; remarks?: string };
  forwardedToAirportAt?: string;
  receivedBy?: string;
  receivedAt?: string;
  receivedRemarks?: string;
};

type FlightGroup = { flight: string; rows: PackagingRow[] };
type DepTimeGroup = { depTime: string; flightGroups: FlightGroup[] };

// Number of distinct dispatch runs in a list of flight groups — consecutive
// legs sharing a Dispatch ID (a round trip) count as one run. Used to give each
// dispatch a single serial number (one SL = one Dispatch ID), continuous across
// departure-time groups.
function dispatchRunCount(flightGroups: FlightGroup[]): number {
  let count = 0;
  for (let i = 0; i < flightGroups.length; i++) {
    const dsp = flightGroups[i].rows.find((r) => r.dspRef)?.dspRef;
    const prevDsp = i > 0 ? flightGroups[i - 1].rows.find((r) => r.dspRef)?.dspRef : undefined;
    if (!(dsp && prevDsp === dsp)) count++;
  }
  return count;
}

type DispatchedFlightEntry = {
  id: string;
  flight: string;
  depTime: string;
  date: string;
  totalQty: number;
  dispatchExecName: string;
  dispatchedDate: string;
  dispatchedTime: string;
  recordId: string;
  sections: FlightSection[];
  dynamicItems: DynamicItem[];
  airportReceived: boolean;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const CREW_MEAL_TYPES    = ["Breakfast", "Lunch", "Dinner", "Light Snacks", "Fruit", "Beverages"];
const SPECIAL_MEAL_TYPES = ["VGML", "CHML", "SPML", "HNML", "LCML", "DBML", "BLML", "KSML"];
const ADDITIONAL_OPTIONS = ["Garlic Toast", "Soft Bun & Croissant", "Fruit Platter", "Mineral Water", "Juice Pack", "Date Cake", "Nuts & Seeds"];

/** "15:40" → "3:40 PM" (matches the packaging table's dep-time style). */
function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m ?? 0).padStart(2, "0")} ${ap}`;
}

/** Resolve a meal name to its kitchen section + packaging meal-type via the
 *  Menu Planning catalog, with sensible fallbacks. */
function mealMeta(name: string): { section: string; mealType: PackagingRow["mealType"] } {
  const m = meals.find((x) => x.name === name);
  const cat = m?.category;
  const section =
    /veg|vegetable/i.test(name) ? "Veg Section"
      : cat === "Cold" ? "Cold Kitchen"
      : cat === "Special" ? "Special Meal"
      : "Hot Kitchen";
  const t = m?.type;
  const mealType: PackagingRow["mealType"] =
    t === "Breakfast" ? "Breakfast"
      : t === "Dinner" ? "Dinner"
      : t === "Snacks" || t === "H.Snacks" ? "Snack"
      : "Lunch";
  return { section, mealType };
}

export const STATUS_BADGE: Record<DispatchStatus, string> = {
  "Preparing":          "bg-slate-100 text-slate-600",
  "Prepared":           "bg-blue-100 text-blue-700",
  "Ready For QC":       "bg-amber-100 text-amber-700",
  "Ready For Dispatch": "bg-violet-100 text-violet-700",
  "Dispatched":         "bg-emerald-100 text-emerald-700",
  "Returned":           "bg-rose-100 text-rose-700",
};
const STATUS_DOT: Record<DispatchStatus, string> = {
  "Preparing":          "bg-slate-400",
  "Prepared":           "bg-blue-500",
  "Ready For QC":       "bg-amber-500",
  "Ready For Dispatch": "bg-violet-500",
  "Dispatched":         "bg-emerald-500",
  "Returned":           "bg-rose-500",
};

const PACKAGING_BADGE: Record<PackagingStatus, string> = {
  "Ready for Packaging":   "bg-amber-100 text-amber-700",
  "Packaging In Progress": "bg-blue-100 text-blue-700",
  "Packaging Done":        "bg-teal-100 text-teal-700",
  "Ready for Dispatch":    "bg-emerald-100 text-emerald-700",
};

const MEAL_TYPE_BADGE: Record<string, string> = {
  Breakfast: "bg-blue-100 text-blue-700",
  Lunch:     "bg-amber-100 text-amber-700",
  Dinner:    "bg-indigo-100 text-indigo-700",
  Snack:     "bg-slate-100 text-slate-600",
  Special:   "bg-purple-100 text-purple-700",
};

export const FLIGHT_STATUS_BADGE: Record<string, string> = {
  "Packaging Pending":                  "bg-amber-100 text-amber-700",
  "Packaging In Progress":              "bg-blue-100 text-blue-700",
  "Packaging Done":                     "bg-teal-100 text-teal-700",
  "QC In Progress":                     "bg-violet-100 text-violet-700",
  "Ready for Dispatch":                 "bg-emerald-100 text-emerald-700",
  "Dispatched":                         "bg-emerald-100 text-emerald-700",
};

export function getFlightStatus(rows: PackagingRow[], qcState: QCState): string {
  if (rows.every((r) => r.packagingStatus === "Dispatched")) return "Dispatched";
  if (qcState === "done") return "Ready for Dispatch";
  if (qcState === "in-progress") return "QC In Progress";
  if (rows.every((r) => r.packagingStatus === "Packaging Done" || r.packagingStatus === "Ready for Dispatch")) return "Packaging Done";
  if (rows.some((r) => r.packagingStatus === "Packaging In Progress")) return "Packaging In Progress";
  return "Packaging Pending";
}

// ─── Shared flight-level dispatch list ────────────────────────────────────────
// Both the Dispatch page list and the dashboard Dispatch Tracker read the
// flight summaries through buildDispatchList so the two surfaces never drift.

export type DispatchListItem = {
  flight: string;
  dspId: string | null;
  depTime: string;
  status: string;
  /** Packaging-row ids that make up this flight — used to flash exactly this
   *  flight's rows (not the whole list) when deep-linked from the dashboard. */
  rowIds: string[];
};

/** In-session QC seed the Dispatch module starts with (BS-101 already cleared).
 *  Mirrored on the dashboard so the initial state matches the module list. */
export const SEED_FLIGHT_QC: Record<string, QCState> = { "BS-101": "done" };

/**
 * Group packaging rows by flight (first-appearance order, matching the module's
 * dep-time→flight grouping) and compute each flight's status from its rows plus
 * the cold-chain QC signals (Dispatch Monitoring clearance / dispatch approval).
 */
export function buildDispatchList(
  rows: PackagingRow[],
  qcClearedFlights: Record<string, string>,
  dispatchApprovals: { flightId: string; stage: string }[],
  localQC: Record<string, QCState> = SEED_FLIGHT_QC,
): DispatchListItem[] {
  const groups: { flight: string; depTime: string; rows: PackagingRow[] }[] = [];
  for (const row of rows) {
    let g = groups.find((x) => x.flight === row.flight);
    if (!g) { g = { flight: row.flight, depTime: row.depTime, rows: [] }; groups.push(g); }
    g.rows.push(row);
  }
  return groups.map((g) => {
    const cleared = qcClearedFlights[g.flight];
    const hasHocApproval = dispatchApprovals.some(
      (da) => da.flightId === g.flight && (da.stage === "hoc_approved" || da.stage === "forwarded_to_airport"),
    );
    const qcState: QCState = cleared || hasHocApproval ? "done" : localQC[g.flight] ?? "not-started";
    return {
      flight: g.flight,
      dspId: g.rows.find((r) => r.dspRef)?.dspRef ?? null,
      depTime: g.depTime,
      status: getFlightStatus(g.rows, qcState),
      rowIds: g.rows.map((r) => r.id),
    };
  });
}

// ─── Packaging Seed Data ─────────────────────────────────────────────────────

const TODAY = "2026-05-18";

export const INITIAL_PACKAGING_ROWS: PackagingRow[] = [
  { id: "PRD-9006", date: TODAY, depTime: "7:00 AM", flight: "BS-225", mealType: "Snack",     mealName: "Heavy Snack Box",        qty: 174, section: "Cold Kitchen",   packagingStatus: "Packaging In Progress", dspRef: "DSP-7704", orderNo: "ORD-3420", productionOrderId: "PRO-2026-100601" },
  { id: "PRD-9001", date: TODAY, depTime: "7:00 AM", flight: "BS-225", mealType: "Lunch",     mealName: "Chicken Biryani",         qty: 168, section: "Hot Kitchen",    packagingStatus: "Ready for Packaging",   dspRef: "DSP-7704", orderNo: "ORD-3420", productionOrderId: "PRO-2026-100602" },
  { id: "PRD-9002", date: TODAY, depTime: "7:00 AM", flight: "BS-225", mealType: "Snack",     mealName: "Veg Pulao",               qty: 24,  section: "Veg Section",    packagingStatus: "Packaging In Progress", dspRef: "DSP-7704", orderNo: "ORD-3420", productionOrderId: "PRO-2026-100603" },
  { id: "PRD-9002B",date: TODAY, depTime: "7:00 AM", flight: "BS-203", mealType: "Snack",     mealName: "Veg Pulao",               qty: 24,  section: "Veg Section",    packagingStatus: "Packaging In Progress", dspRef: "DSP-7702", orderNo: "ORD-3414", productionOrderId: "PRO-2026-100603" },
  { id: "PRD-9003", date: TODAY, depTime: "8:30 AM", flight: "BS-307", mealType: "Dinner",    mealName: "Grilled Salmon",          qty: 282, section: "Hot Kitchen",    packagingStatus: "Packaging In Progress", dspRef: "DSP-7705", orderNo: "ORD-3415", productionOrderId: "PRO-2026-100604" },
  { id: "PRD-9004", date: TODAY, depTime: "8:30 AM", flight: "BS-307", mealType: "Breakfast", mealName: "Continental Breakfast",   qty: 282, section: "Cold Kitchen",   packagingStatus: "Packaging Done",        dspRef: "DSP-7705", orderNo: "ORD-3415", productionOrderId: "PRO-2026-100605" },
  { id: "PRD-9005", date: TODAY, depTime: "9:00 AM", flight: "BS-101", mealType: "Special",   mealName: "Hindu Meal Special",      qty: 8,   section: "Special Meal",   packagingStatus: "Packaging Done",        dspRef: "DSP-7701", orderNo: "ORD-3422", productionOrderId: "PRO-2026-100606" },
];

// Two demo rows with all packaging done — so "Initiate QC" button is visible
// for testing the full QC → Dispatch Monitoring → Galley Loading flow.
const QC_SEED_ROWS: PackagingRow[] = [
  { id: "PRD-QC-DEMO1", date: "2026-06-28", depTime: "10:00 AM", flight: "BS-141", mealType: "Snack",  mealName: "Snack Box",   qty: 72,  section: "Cold Kitchen", packagingStatus: "Packaging Done", orderNo: "ORD-DEMO1" },
  { id: "PRD-QC-DEMO2", date: "2026-06-28", depTime: "6:25 PM",  flight: "BS-411", mealType: "Dinner", mealName: "Dinner Set",  qty: 162, section: "Hot Kitchen",  packagingStatus: "Packaging Done", orderNo: "ORD-DEMO2" },
];

// ─── Dispatch Seed Data ───────────────────────────────────────────────────────

export const INITIAL_RECORDS: DispatchRecord[] = [
  {
    id: "DSP-7701", date: "2025-11-09", depTime: "08:30", kitchenName: "Flight Kitchen A", flightNos: ["BS-101"],
    status: "Ready For Dispatch",
    trail: [
      { status: "Preparing",          by: "System",     date: "09 Nov 2025", time: "07:00 am" },
      { status: "Prepared",           by: "M. Hossain", date: "09 Nov 2025", time: "07:45 am" },
      { status: "Ready For QC",       by: "F. Begum",   date: "09 Nov 2025", time: "08:15 am" },
      { status: "Ready For Dispatch", by: "A. Khan",    date: "09 Nov 2025", time: "09:00 am" },
    ],
    detail: {
      flightKitchen: { name: "Flight Kitchen A", totalMeals: 9000, lunch: 2387, breakfast: 2400 },
      bakery: [{ name: "Bread Jelly Butter", qty: 945 }, { name: "Croissant", qty: 850 }, { name: "Dinner Roll", qty: 205 }],
      amenities: [{ label: "Medicines", qty: 300 }, { label: "Tissues", qty: 200 }],
      foodSafety: { result: "Passed", checkedBy: "F. Begum", date: "09 Nov 2025", time: "07:30 am" },
    },
    sections: [{
      flightNo: "BS-101", sector: "DAC-CGP",
      paxLines: [{ itemName: "PBDR", percent: 60, qty: 41 }, { itemName: "JPCV", percent: 40, qty: 27 }],
      vgml: 2, chml: 1, spml: 0,
      crewMeals: [{ type: "Breakfast", qty: "4+1" }, { type: "Light Snacks", qty: "4" }],
      pastry: 68, childMealsPastry: 1,
    }],
    dynamicItems: [{ id: "d1", name: "Garlic Toast", qty: "68" }],
  },
  {
    id: "DSP-7702", date: "2025-11-09", depTime: "12:15", kitchenName: "Flight Kitchen A", flightNos: ["BS-203"],
    status: "Ready For QC",
    trail: [
      { status: "Preparing",    by: "System",     date: "09 Nov 2025", time: "09:00 am" },
      { status: "Prepared",     by: "R. Hossain", date: "09 Nov 2025", time: "10:30 am" },
      { status: "Ready For QC", by: "N. Islam",   date: "09 Nov 2025", time: "11:00 am" },
    ],
    detail: {
      flightKitchen: { name: "Flight Kitchen A", totalMeals: 12800, lunch: 4200, breakfast: 3600 },
      bakery: [{ name: "Sandwich Bread", qty: 176 }, { name: "Chocolate Muffin", qty: 88 }],
      amenities: [{ label: "Medicine Kits", qty: 176 }, { label: "Tissue Sets", qty: 352 }, { label: "Cutlery Sets", qty: 176 }],
      foodSafety: { result: "Passed", checkedBy: "A. Rahman", date: "09 Nov 2025", time: "11:00 am" },
    },
    sections: [{
      flightNo: "BS-203", sector: "DAC-DXB",
      paxLines: [{ itemName: "JPBD", percent: 60, qty: 101 }, { itemName: "VRSCV", percent: 40, qty: 67 }],
      vgml: 5, chml: 3, spml: 1,
      crewMeals: [{ type: "Lunch", qty: "8+1" }, { type: "Light Snacks", qty: "8" }],
      pastry: 168, childMealsPastry: 3,
    }],
    dynamicItems: [{ id: "d1", name: "Soft Bun & Croissant", qty: "176" }],
  },
  {
    id: "DSP-7703", date: "2025-11-09", depTime: "10:00", kitchenName: "Flight Kitchen B", flightNos: ["BS-141"],
    status: "Prepared",
    trail: [
      { status: "Preparing", by: "System",   date: "09 Nov 2025", time: "07:30 am" },
      { status: "Prepared",  by: "S. Ahmed", date: "09 Nov 2025", time: "09:00 am" },
    ],
    detail: {
      flightKitchen: { name: "Flight Kitchen B", totalMeals: 7200, lunch: 1850, breakfast: 2100 },
      bakery: [{ name: "Cheese Pastry", qty: 76 }, { name: "Vanilla Cake Slice", qty: 38 }],
      amenities: [{ label: "Medicine Kits", qty: 76 }, { label: "Tissue Sets", qty: 152 }, { label: "Cutlery Sets", qty: 76 }],
      foodSafety: { result: "Passed", checkedBy: "N. Hasan", date: "09 Nov 2025", time: "08:45 am" },
    },
    sections: [{
      flightNo: "BS-141", sector: "DAC-CXB",
      paxLines: [{ itemName: "CHRS", percent: 60, qty: 43 }, { itemName: "BDBR", percent: 40, qty: 29 }],
      vgml: 1, chml: 1, spml: 0,
      crewMeals: [{ type: "Light Snacks", qty: "4" }],
      pastry: 72, childMealsPastry: 1,
    }],
    dynamicItems: [],
  },
  {
    id: "DSP-7704", date: "2025-11-09", depTime: "15:40", kitchenName: "Flight Kitchen B", flightNos: ["BS-225"],
    status: "Preparing",
    trail: [
      { status: "Preparing", by: "System", date: "09 Nov 2025", time: "11:00 am" },
    ],
    detail: {
      flightKitchen: { name: "Flight Kitchen B", totalMeals: 11200, lunch: 3650, breakfast: 2800 },
      bakery: [{ name: "Butter Croissant", qty: 144 }, { name: "Dinner Roll", qty: 72 }, { name: "Cheese Pastry", qty: 36 }],
      amenities: [{ label: "Medicine Kits", qty: 182 }, { label: "Tissue Sets", qty: 364 }, { label: "Cutlery Sets", qty: 182 }],
      foodSafety: { result: "Passed", checkedBy: "F. Begum", date: "09 Nov 2025", time: "09:15 am" },
    },
    sections: [{
      flightNo: "BS-225", sector: "DAC-DOH",
      paxLines: [{ itemName: "JPBD", percent: 60, qty: 104 }, { itemName: "VRSCV", percent: 40, qty: 70 }],
      vgml: 4, chml: 2, spml: 0,
      crewMeals: [{ type: "Light Snacks", qty: "8" }, { type: "Fruit", qty: "8" }],
      pastry: 174, childMealsPastry: 2,
    }],
    dynamicItems: [],
  },
  {
    id: "DSP-7705", date: "2025-11-09", depTime: "07:20", kitchenName: "Flight Kitchen B", flightNos: ["BS-105"],
    status: "Ready For Dispatch",
    trail: [
      { status: "Preparing",          by: "System",     date: "09 Nov 2025", time: "05:30 am" },
      { status: "Prepared",           by: "S. Ahmed",   date: "09 Nov 2025", time: "06:15 am" },
      { status: "Ready For QC",       by: "F. Begum",   date: "09 Nov 2025", time: "06:40 am" },
      { status: "Ready For Dispatch", by: "A. Khan",    date: "09 Nov 2025", time: "07:00 am" },
    ],
    detail: {
      flightKitchen: { name: "Flight Kitchen B", totalMeals: 7600, lunch: 1980, breakfast: 2200 },
      bakery: [{ name: "Chicken Roll", qty: 43 }, { name: "Beef Bun", qty: 29 }],
      amenities: [{ label: "Medicine Kits", qty: 72 }, { label: "Tissue Sets", qty: 144 }, { label: "Cutlery Sets", qty: 72 }],
      foodSafety: { result: "Passed", checkedBy: "F. Begum", date: "09 Nov 2025", time: "06:30 am" },
    },
    sections: [{
      flightNo: "BS-105", sector: "DAC-CXB",
      paxLines: [{ itemName: "CHRS", percent: 60, qty: 43 }, { itemName: "BDBR", percent: 40, qty: 29 }],
      vgml: 2, chml: 5, spml: 0,
      crewMeals: [{ type: "Breakfast", qty: "4" }, { type: "Light Snacks", qty: "4" }],
      pastry: 72, childMealsPastry: 5,
    }],
    dynamicItems: [],
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function Dispatch() {
  useArrivalFlash();
  const navigate = useNavigate();
  const { applyStockDeltas, addTransferNote, productionEntries, qcClearedFlights, dispatchApprovals } = useWorkflow();
  const flightOrders = useFlightOrders();
  // ── Dispatch records state ──────────────────────────────────────────────────
  const [records, setRecords] = usePersistedState<DispatchRecord[]>("dispatch-records", INITIAL_RECORDS);
  // Seed from the persisted records (not just INITIAL_RECORDS) so flights added
  // via "+ New Dispatch" stay flagged as configured across reloads.
  const [configuredFlights, setConfiguredFlights] = useState<Set<string>>(
    () => new Set(records.flatMap((r) => r.flightNos))
  );

  // ── Packaging pipeline state ────────────────────────────────────────────────
  // Persisted so dispatches created via "+ New Dispatch" (and packaging/QC
  // progress) survive a page reload, matching the persisted `records`.
  const [packagingRows, setPackagingRows] = usePersistedState<PackagingRow[]>("dispatch-packaging-rows", INITIAL_PACKAGING_ROWS);
  const [flightQCStates, setFlightQCStates] = useState<Map<string, FlightQCData>>(
    new Map([["BS-101", { qcState: "done", qcCheckedAt: "08:00 AM" }]])
  );
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo]     = useState("");
  const [filterDepTime, setFilterDepTime]   = useState("");
  const [filterStatus, setFilterStatus]     = useState("All Statuses");
  const [materialsRow, setMaterialsRow]             = useState<PackagingRow | null>(null);
  const [markReadyRow, setMarkReadyRow]             = useState<PackagingRow | null>(null);
  const [viewPackagingRow, setViewPackagingRow]     = useState<PackagingRow | null>(null);
  const [dispatchedFlightEntries, setDispatchedFlightEntries] = useState<DispatchedFlightEntry[]>([]);
  const [viewDispatchedEntry, setViewDispatchedEntry] = useState<DispatchedFlightEntry | null>(null);
  // ── QC Report dialog state ─────────────────────────────────────────────────
  const [qcReport, setQcReport] = useState<{ flight: string; qcState: QCState; checkedAt?: string } | null>(null);

  // ── Airport Receive dialog state ───────────────────────────────────────────
  const [airportReceiveTarget, setAirportReceiveTarget] = useState<DispatchedFlightEntry | null>(null);
  const [aptGateTemp, setAptGateTemp] = useState("");
  const [aptUnloadTime, setAptUnloadTime] = useState("");
  const [aptRemarks, setAptRemarks] = useState("");

  // ── New Dispatch Config modal ───────────────────────────────────────────────
  const [configOpen, setConfigOpen]         = useState(false);
  const [configDate, setConfigDate]         = useState("");
  const [configDepTime, setConfigDepTime]   = useState("");
  const [configFlight, setConfigFlight]     = useState("");
  // Warehouse the meals are dispatched FROM (kitchen/cold store) and TO. On
  // "Dispatched" these drive the Transfer Note raised into the Inventory module.
  const DEFAULT_FROM_WH = "WH-003"; // Hot Kitchen
  const DEFAULT_TO_WH   = "WH-001"; // Central Warehouse
  const officeOfWarehouse = (whId: string) => activeWarehouses.find((w) => w.id === whId)?.officeId ?? "OFF-001";
  const [configFromWarehouse, setConfigFromWarehouse] = useState(DEFAULT_FROM_WH);
  const [configToWarehouse, setConfigToWarehouse]     = useState(DEFAULT_TO_WH);
  // Owning office per warehouse — the warehouse dropdowns cascade from these.
  const [configFromOffice, setConfigFromOffice] = useState(() => officeOfWarehouse(DEFAULT_FROM_WH));
  const [configToOffice, setConfigToOffice]     = useState(() => officeOfWarehouse(DEFAULT_TO_WH));
  const changeFromOffice = (officeId: string) => {
    setConfigFromOffice(officeId);
    const whs = activeWarehousesByOffice(officeId);
    if (!whs.some((w) => w.id === configFromWarehouse)) setConfigFromWarehouse(whs[0]?.id ?? "");
  };
  const changeToOffice = (officeId: string) => {
    setConfigToOffice(officeId);
    const whs = activeWarehousesByOffice(officeId);
    if (!whs.some((w) => w.id === configToWarehouse)) setConfigToWarehouse(whs[0]?.id ?? "");
  };
  const [configPaxLines, setConfigPaxLines] = useState<CfgPaxLine[]>([
    { id: "p1", itemName: "", percent: 60, qty: 0 },
    { id: "p2", itemName: "", percent: 40, qty: 0 },
  ]);
  const [configCrewMeals, setConfigCrewMeals]       = useState<CfgCrewMeal[]>([{ id: "c1", type: "Breakfast", qty: "" }]);
  const [configSpecialMeals, setConfigSpecialMeals] = useState<CfgSpecialMeal[]>([]);
  const [configAdditional, setConfigAdditional]     = useState<CfgAdditional[]>([]);
  // When the selected flight is part of a round trip, bundle its return leg into
  // the same dispatch sheet (one combined record covering both sectors). The
  // return leg's meals are seeded on flight-pick and stay editable, just like the
  // primary leg's.
  const [includeReturn, setIncludeReturn]           = useState(true);
  const [returnPaxLines, setReturnPaxLines]         = useState<CfgPaxLine[]>([]);
  const [returnCrewMeals, setReturnCrewMeals]       = useState<CfgCrewMeal[]>([]);
  const [returnSpecialMeals, setReturnSpecialMeals] = useState<CfgSpecialMeal[]>([]);

  // ── View / trail modal ──────────────────────────────────────────────────────
  const [viewRecord, setViewRecord] = useState<DispatchRecord | null>(null);

  // ── Initiate Dispatch flow ──────────────────────────────────────────────────
  const [dispatchingRecord, setDispatchingRecord] = useState<DispatchRecord | null>(null);
  const [warningOpen, setWarningOpen]   = useState(false);
  const [formOpen, setFormOpen]         = useState(false);
  const [dispatched, setDispatched]     = useState(false);
  const [notifyOpen, setNotifyOpen]     = useState(false);
  const [declared, setDeclared]         = useState(false);
  const [dispatchDate, setDispatchDate]         = useState("2026-05-12");
  const [flightDeptTime, setFlightDeptTime]     = useState("10:00");
  const [sections, setSections]                 = useState<FlightSection[]>([]);
  const [dynamicItems, setDynamicItems]         = useState<DynamicItem[]>([{ id: "d1", name: "", qty: "" }]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  // Flights selectable for dispatch come from Order Management (flight orders),
  // narrowed to the chosen date — one entry per flight number, earliest ETD
  // first. Selecting one auto-loads the rest of the form (see autoLoadFromFlight).
  const orderFlightOptions = useMemo(() => {
    const seen = new Map<string, FlightOrder>();
    for (const o of flightOrders) {
      if (configDate && o.date !== configDate) continue;
      if (!seen.has(o.flight)) seen.set(o.flight, o);
    }
    return [...seen.values()].sort((a, b) => a.etd.localeCompare(b.etd) || a.flight.localeCompare(b.flight));
  }, [flightOrders, configDate]);
  const selectedOrder = useMemo(
    () =>
      flightOrders.find((o) => o.flight === configFlight && (!configDate || o.date === configDate)) ??
      flightOrders.find((o) => o.flight === configFlight),
    [flightOrders, configFlight, configDate],
  );
  // PAX main-meal menu sourced from Menu Planning (approved passenger main dishes).
  const paxMenu = useMemo(
    () => meals.filter((m) => m.serviceGroup === "Passenger" && (m.category === "Hot" || m.category === "Cold") && m.status === "Approved"),
    [],
  );
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const maxDate = useMemo(() => {
    const d = new Date(Date.now() + 96 * 60 * 60 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const selectedSector = useMemo(
    () => selectedOrder?.sector ?? flights.find((f) => f.flight === configFlight)?.sector ?? "",
    [selectedOrder, configFlight]
  );

  // The return leg of an order's round trip. An explicit Trip Ref (pairId, set on
  // bulk upload) is the authoritative link — it disambiguates same-sector trips
  // that share one date's Order #. Without it, fall back to same Order # + the
  // opposite direction, preferring the exact reverse sector.
  const findReturnLeg = (order: FlightOrder | null | undefined): FlightOrder | null => {
    if (!order) return null;
    const opp: LegDirection = order.direction === "Return" ? "Outbound" : "Return";
    // Crew orders can now share a flight order's Order #, so match the same
    // order TYPE — a flight's return leg is a flight, never the crew order.
    const orderKind = order.orderType ?? "flight";
    const rev = reverseSector(order.sector);
    // 1) Explicit pair key wins.
    if (order.pairId) {
      const paired = flightOrders.filter(
        (o) =>
          o.pairId === order.pairId &&
          (o.orderType ?? "flight") === orderKind &&
          o.flight !== order.flight &&
          o.direction === opp,
      );
      if (paired.length > 0) return paired.find((o) => o.sector === rev) ?? paired[0];
    }
    // 2) Fall back to Order # + opposite direction (+ reverse-sector preference).
    if (!order.orderNo) return null;
    const legs = flightOrders.filter(
      (o) =>
        o.orderNo === order.orderNo &&
        (o.orderType ?? "flight") === orderKind &&
        o.flight !== order.flight &&
        o.direction === opp,
    );
    if (legs.length === 0) return null;
    return legs.find((o) => o.sector === rev) ?? legs[0];
  };
  const returnOrder = useMemo<FlightOrder | null>(
    () => findReturnLeg(selectedOrder),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedOrder, flightOrders],
  );

  // Derive a leg's meals (PAX split 60/40, crew headcount, special roster) the
  // same way auto-load does — used to fill the return leg without extra input.
  const deriveMeals = (order: FlightOrder) => {
    const pax = order.pax;
    const lead = Math.round(pax * 0.6);
    let paxLines: CfgPaxLine[] = [];
    if (paxMenu.length >= 2) {
      paxLines = [
        { id: "rp1", itemName: paxMenu[0].name, percent: 60, qty: lead },
        { id: "rp2", itemName: paxMenu[1].name, percent: 40, qty: pax - lead },
      ];
    } else if (paxMenu.length === 1) {
      paxLines = [{ id: "rp1", itemName: paxMenu[0].name, percent: 60, qty: pax }];
    }
    const crewMeals: CfgCrewMeal[] = [{ id: "rc1", type: "Lunch", qty: String(order.crew) }];
    const byCode = new Map<string, number>();
    for (const e of order.specialMealRoster ?? []) byCode.set(e.mealCode, (byCode.get(e.mealCode) ?? 0) + 1);
    let specialMeals: CfgSpecialMeal[] = [...byCode.entries()].map(([type, qty], i) => ({ id: `rs${i}`, type, qty: String(qty) }));
    if (specialMeals.length === 0 && order.specialMeals > 0) specialMeals = [{ id: "rs0", type: "VGML", qty: String(order.specialMeals) }];
    return { paxLines, crewMeals, specialMeals };
  };

  // Select a flight → auto-load the rest of the form from Order Management
  // (ETD, sector, PAX, crew, special-meal roster) and Menu Planning (the PAX
  // main-meal menu, split across the passenger count). The user only picks the
  // flight; everything below is filled in and remains editable.
  const autoLoadFromFlight = (flightNo: string) => {
    setConfigFlight(flightNo);
    setIncludeReturn(true); // default to bundling the return leg on each new pick
    if (!flightNo) return;
    const order =
      flightOrders.find((o) => o.flight === flightNo && (!configDate || o.date === configDate)) ??
      flightOrders.find((o) => o.flight === flightNo);
    if (!order) return;

    setConfigDepTime(to12h(order.etd));

    // PAX main meal — split the passenger count across two menu choices (60/40).
    const pax = order.pax;
    const lead = Math.round(pax * 0.6);
    if (paxMenu.length >= 2) {
      setConfigPaxLines([
        { id: "p1", itemName: paxMenu[0].name, percent: 60, qty: lead },
        { id: "p2", itemName: paxMenu[1].name, percent: 40, qty: pax - lead },
      ]);
    } else if (paxMenu.length === 1) {
      setConfigPaxLines([{ id: "p1", itemName: paxMenu[0].name, percent: 60, qty: pax }]);
    }

    // Crew meals — one line carrying the crew headcount.
    setConfigCrewMeals([{ id: "c1", type: "Lunch", qty: String(order.crew) }]);

    // Special meals — aggregate the order's special-meal roster by meal code.
    // Fall back to the order's special-meal count when no roster is attached.
    const byCode = new Map<string, number>();
    for (const e of order.specialMealRoster ?? []) {
      byCode.set(e.mealCode, (byCode.get(e.mealCode) ?? 0) + 1);
    }
    let special = [...byCode.entries()].map(([type, qty], i) => ({ id: `s${i}`, type, qty: String(qty) }));
    if (special.length === 0 && order.specialMeals > 0) {
      special = [{ id: "s0", type: "VGML", qty: String(order.specialMeals) }];
    }
    setConfigSpecialMeals(special);

    // Seed the return leg's meals (editable) when this order has a paired return.
    const retLeg = findReturnLeg(order);
    if (retLeg) {
      const d = deriveMeals(retLeg);
      setReturnPaxLines(d.paxLines);
      setReturnCrewMeals(d.crewMeals);
      setReturnSpecialMeals(d.specialMeals);
    } else {
      setReturnPaxLines([]); setReturnCrewMeals([]); setReturnSpecialMeals([]);
    }
  };

  // Production Entry linkup — every meal under this dispatch (PAX, Crew and
  // Special) is tagged with its own production order, so one dispatch bundles
  // multiple orders/productions. PAX lines name their dish directly; crew and
  // special lines are auto-mapped to a representative dish (period/code → Meal
  // Planning) so they too carry a PRO number.
  const productionLines = useMemo<ProductionLine[]>(() => {
    if (!configFlight) return [];
    const day = dayFromDate(configDate);

    // Link a dish to its production order: prefer a QC-passed (Completed) order;
    // else show the latest in-progress one so the block reason is visible.
    const linkPro = (dish: string) => {
      const matches = productionEntries.filter((e) => (e.outputItemName ?? e.bom) === dish);
      const completed = matches.find((e) => e.status === "Completed");
      const pe = completed ?? matches[0];
      return {
        proId: pe?.id ?? null,
        producedQty: pe?.producedQty ?? null,
        status: pe?.status ?? "Not in production",
        completed: !!completed,
        hasPro: !!pe,
      };
    };

    type Leg = { legFlight: string; legSector: string; legDirection: LegDirection };

    // Build the PAX/Crew/Special production lines for one leg, tagged with that
    // leg's flight/sector/direction. Every line must be Completed to dispatch.
    const buildLines = (
      leg: Leg, paxLines: CfgPaxLine[], crewMeals: CfgCrewMeal[], specialMeals: CfgSpecialMeal[],
    ): ProductionLine[] => {
      const out: ProductionLine[] = [];
      for (const l of paxLines.filter((l) => l.itemName)) {
        const link = linkPro(l.itemName);
        out.push({
          audience: "PAX", meal: l.itemName, label: l.itemName, needQty: Number(l.qty) || 0,
          proId: link.proId, producedQty: link.producedQty, status: link.status,
          ready: link.completed, blocks: !link.completed, ...leg,
        });
      }
      for (const m of crewMeals) {
        const dish = resolveCrewDish(m.type, day);
        if (!dish) continue;
        const link = linkPro(dish);
        out.push({
          audience: "Crew", meal: dish, label: `${m.type} · ${dish}`, needQty: parseMealQty(m.qty),
          proId: link.proId, producedQty: link.producedQty, status: link.status,
          ready: link.completed, blocks: !link.completed, ...leg,
        });
      }
      for (const m of specialMeals) {
        const dish = resolveSpecialDish(m.type, day);
        if (!dish) continue;
        const link = linkPro(dish);
        out.push({
          audience: "Special", meal: dish, label: `${m.type} · ${dish}`, needQty: parseMealQty(m.qty),
          proId: link.proId, producedQty: link.producedQty, status: link.status,
          ready: link.completed, blocks: !link.completed, ...leg,
        });
      }
      return out;
    };

    const lines: ProductionLine[] = [];
    // Selected (primary) leg — from the editable config.
    lines.push(...buildLines(
      { legFlight: configFlight, legSector: selectedSector, legDirection: selectedOrder?.direction ?? "Outbound" },
      configPaxLines, configCrewMeals, configSpecialMeals,
    ));
    // Return leg — from its editable meal state, bundled into the same dispatch.
    if (includeReturn && returnOrder) {
      lines.push(...buildLines(
        { legFlight: returnOrder.flight, legSector: returnOrder.sector, legDirection: returnOrder.direction },
        returnPaxLines, returnCrewMeals, returnSpecialMeals,
      ));
    }
    // Always list Outbound lines before Return (stable — keeps audience order).
    lines.sort((a, b) => (a.legDirection === "Outbound" ? 0 : 1) - (b.legDirection === "Outbound" ? 0 : 1));
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configFlight, configDate, configPaxLines, configCrewMeals, configSpecialMeals, productionEntries, includeReturn, returnOrder, returnPaxLines, returnCrewMeals, returnSpecialMeals, selectedSector, selectedOrder]);

  // Dispatch validation. Saving only needs a flight + at least one meal line.
  // The "produced & QC-passed" check is a SOFT warning: if any meal isn't
  // completed we surface it (here and on save) but still allow the dispatch.
  const paxLineCount = productionLines.filter((l) => l.audience === "PAX").length;
  const productionReady = paxLineCount > 0 && productionLines.every((l) => !l.blocks);
  const blockingMeals = productionLines.filter((l) => l.blocks).map((l) => l.label);
  const canSave = !!configFlight && productionLines.length > 0;

  // Combined dispatch summary — per-leg and grand totals across outbound + return.
  const legTotals = (o: FlightOrder) => ({
    pax: o.pax, crew: o.crew, special: o.specialMeals, meals: o.pax + o.crew + o.specialMeals,
  });
  const summaryLegs = ([
    selectedOrder ? { order: selectedOrder, totals: legTotals(selectedOrder) } : null,
    includeReturn && returnOrder ? { order: returnOrder, totals: legTotals(returnOrder) } : null,
  ].filter(Boolean) as { order: FlightOrder; totals: ReturnType<typeof legTotals> }[])
    // Always show Outbound before Return.
    .sort((a, b) => (a.order.direction === "Outbound" ? 0 : 1) - (b.order.direction === "Outbound" ? 0 : 1));
  const grandTotals = summaryLegs.reduce(
    (acc, l) => ({
      pax: acc.pax + l.totals.pax, crew: acc.crew + l.totals.crew,
      special: acc.special + l.totals.special, meals: acc.meals + l.totals.meals,
    }),
    { pax: 0, crew: 0, special: 0, meals: 0 },
  );

  // Inject QC demo rows on mount; also reset any that were previously dispatched back to Packaging Done
  const _qcSeedDone = useRef(false);
  useEffect(() => {
    if (_qcSeedDone.current) return;
    _qcSeedDone.current = true;
    const SEED_IDS = new Set(QC_SEED_ROWS.map((r) => r.id));
    setPackagingRows((prev) => {
      const existing = new Set(prev.map((r) => r.id));
      const toAdd = QC_SEED_ROWS.filter((r) => !existing.has(r.id));
      const resetPrev = prev.map((r) =>
        SEED_IDS.has(r.id) && r.packagingStatus === "Dispatched"
          ? { ...r, packagingStatus: "Packaging Done" as PackagingStatus }
          : r
      );
      return toAdd.length === 0 ? resetPrev : [...resetPrev, ...toAdd];
    });
    // Clear QC state for seed flights so "Initiate QC" reappears
    setFlightQCStates((prev) => {
      const seedFlights = new Set(QC_SEED_ROWS.map((r) => r.flight));
      const next = new Map(prev);
      seedFlights.forEach((f) => next.delete(f));
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Packaging derived ───────────────────────────────────────────────────────

  const depTimesForDate = useMemo(() => {
    const dateFiltered = packagingRows.filter((r) =>
      (!filterDateFrom || r.date >= filterDateFrom) &&
      (!filterDateTo   || r.date <= filterDateTo)
    );
    return [...new Set(dateFiltered.map((r) => r.depTime))].sort();
  }, [packagingRows, filterDateFrom, filterDateTo]);

  const filteredPRDs = useMemo(
    () =>
      packagingRows.filter((r) => {
        const matchDate =
          (!filterDateFrom || r.date >= filterDateFrom) &&
          (!filterDateTo   || r.date <= filterDateTo);
        const matchDepTime = !filterDepTime || r.depTime === filterDepTime;
        const matchStatus =
          filterStatus === "All Statuses" || r.packagingStatus === filterStatus;
        return matchDate && matchDepTime && matchStatus;
      }),
    [packagingRows, filterDateFrom, filterDateTo, filterDepTime, filterStatus]
  );

  const groupedPRDs = useMemo(() => {
    const timeGroups: DepTimeGroup[] = [];
    for (const row of filteredPRDs) {
      let tg = timeGroups.find((g) => g.depTime === row.depTime);
      if (!tg) { tg = { depTime: row.depTime, flightGroups: [] }; timeGroups.push(tg); }
      let fg = tg.flightGroups.find((g) => g.flight === row.flight);
      if (!fg) { fg = { flight: row.flight, rows: [] }; tg.flightGroups.push(fg); }
      fg.rows.push(row);
    }
    return timeGroups;
  }, [filteredPRDs]);

  // ── KPI data ──────────────────────────────────────────────────────────────
  // The flight-level dispatch list (same source the table renders from) is the
  // "dispatched" universe; the Dispatch Monitoring receipts (dm_entries) tell us
  // which of those flights the airport has actually signed for.
  const flightList = useMemo(
    () => buildDispatchList(packagingRows, qcClearedFlights, dispatchApprovals),
    [packagingRows, qcClearedFlights, dispatchApprovals],
  );
  // Flight codes the airport has received (cold-chain sheet has receivedAt set).
  // Note: receivedAt is a time-of-day stamp on a single-day demo, so every
  // received receipt counts as "today".
  const receivedFlightCodes = useMemo(() => {
    let raw: DmSheetEntry[] = [];
    try {
      const s = sessionStorage.getItem("dm_entries");
      if (s) raw = JSON.parse(s) as DmSheetEntry[];
    } catch { /* sessionStorage unavailable — treat as no receipts */ }
    const set = new Set<string>();
    for (const e of raw) {
      if (!e.receivedAt || !e.receivedAt.trim()) continue;
      set.add(flights.find((f) => f.id === e.flightId)?.flight ?? e.flightId);
    }
    return set;
  }, [packagingRows]);
  const dispatchedFlights = flightList.filter((d) => d.status === "Dispatched");
  const activeDispatches = flightList.filter((d) => d.status !== "Dispatched").length;
  const deliveredToday = dispatchedFlights.filter((d) => receivedFlightCodes.has(d.flight)).length;
  const vehiclesOnTrip = dispatchedFlights.filter((d) => !receivedFlightCodes.has(d.flight)).length;

  // ── DSP aggregate recalculation ─────────────────────────────────────────────

  const recalcDSP = (rows: PackagingRow[], dspId: string) => {
    const linked = rows.filter((r) => r.dspRef === dspId);
    if (linked.length === 0) return;
    const allReady = linked.every((r) => r.packagingStatus === "Ready for Dispatch");
    const allDone  = linked.every((r) =>
      r.packagingStatus === "Packaging Done" || r.packagingStatus === "Ready for Dispatch"
    );
    const newStatus: DispatchStatus = allReady ? "Ready For Dispatch" : allDone ? "Prepared" : "Preparing";
    setRecords((prev) => prev.map((r) => (r.id === dspId ? withStatusLog(r, newStatus, "System") : r)));
  };

  // ── Packaging handlers ──────────────────────────────────────────────────────

  const handleConfirmMaterials = (row: PackagingRow) => {
    // Start packaging for every "Ready for Packaging" meal on this flight/slot.
    const updated = packagingRows.map((r) =>
      r.flight === row.flight && r.depTime === row.depTime && r.packagingStatus === "Ready for Packaging"
        ? { ...r, packagingStatus: "Packaging In Progress" as PackagingStatus }
        : r
    );
    setPackagingRows(updated);
    if (row.dspRef) recalcDSP(updated, row.dspRef);
    setMaterialsRow(null);
    toast.success(`${row.flight} — packaging started.`);
  };

  const handleMarkPackagingDone = (row: PackagingRow) => {
    const updated = packagingRows.map((r) =>
      r.id === row.id ? { ...r, packagingStatus: "Packaging Done" as PackagingStatus } : r
    );
    setPackagingRows(updated);
    if (row.dspRef) recalcDSP(updated, row.dspRef);
    toast.success(`${row.id} marked as Packaging Done.`);
  };

  const handleMarkReadyForDispatch = (row: PackagingRow) => {
    const updated = packagingRows.map((r) =>
      r.id === row.id ? { ...r, packagingStatus: "Ready for Dispatch" as PackagingStatus } : r
    );
    setPackagingRows(updated);
    if (row.dspRef) recalcDSP(updated, row.dspRef);
    setMarkReadyRow(null);
    toast.success(`${row.id} is Ready for Dispatch.`);
  };

  const handleQCAction = (flight: string) => {
    const current = flightQCStates.get(flight) ?? { qcState: "not-started" as QCState };
    if (current.qcState === "not-started") {
      setFlightQCStates((prev) => new Map(prev).set(flight, { qcState: "in-progress" }));
      const dspRef = packagingRows.find((r) => r.flight === flight)?.dspRef;
      if (dspRef) setRecords((prev) => prev.map((r) => r.id === dspRef ? withStatusLog(r, "Ready For QC", "Food Safety & QC") : r));
      toast.info(`QC started for flight ${flight}.`);
    } else if (current.qcState === "in-progress") {
      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
      setFlightQCStates((prev) => new Map(prev).set(flight, { qcState: "done", qcCheckedAt: timeStr }));
      const dspRef = packagingRows.find((r) => r.flight === flight)?.dspRef;
      if (dspRef) setRecords((prev) => prev.map((r) => r.id === dspRef ? withStatusLog(r, "Ready For Dispatch", "Food Safety & QC") : r));
      toast.success(`QC Done for flight ${flight}. Status → Ready for Dispatch.`);
    }
  };

  // Initiate QC → start QC for this flight AND open the Dispatch Monitoring
  // sheet scoped to the flight number, so the QC executive can fill the
  // temperature/vehicle monitoring record straight away.
  const handleInitiateQC = (flight: string) => {
    handleQCAction(flight);
    navigate(`/dispatch-monitoring?flight=${encodeURIComponent(flight)}&mode=qc-only`);
  };

  // Effective QC state for a flight: cleared by a Dispatch Monitoring record or an
  // HoC approval counts as done; otherwise the local QC state.
  const getQcState = (flight: string): QCState => {
    if (qcClearedFlights[flight]) return "done";
    if (dispatchApprovals.some((da) => da.flightId === flight && (da.stage === "hoc_approved" || da.stage === "forwarded_to_airport"))) return "done";
    return flightQCStates.get(flight)?.qcState ?? "not-started";
  };

  // Combined dispatch for a round-trip run: opens ONE check sheet covering every
  // leg (outbound + return) and dispatches them together. Used by the single
  // "Initiate Dispatch" action that unlocks once ALL legs have passed QC.
  const openWarningForDispatchRun = (runFgs: FlightGroup[]) => {
    const allRows = runFgs.flatMap((fg) => fg.rows);
    const firstRow = allRows[0];
    if (!firstRow) return;
    const dspRef = firstRow.dspRef;
    const existing = dspRef ? records.find((r) => r.id === dspRef) : undefined;
    const flightNos = runFgs.map((fg) => fg.flight);
    const totalQty = allRows.reduce((sum, r) => sum + r.qty, 0);
    const rec: DispatchRecord = existing ?? {
      id: dspRef ?? `DSP-${flightNos.join("+")}`,
      date: firstRow.date,
      depTime: firstRow.depTime,
      kitchenName: firstRow.section,
      flightNos,
      status: "Ready For Dispatch",
      trail: [],
      detail: {
        flightKitchen: { name: firstRow.section, totalMeals: totalQty, lunch: 0, breakfast: 0 },
        bakery: [],
        amenities: [],
        foodSafety: { result: "—", checkedBy: "", date: "", time: "" },
      },
      sections: [],
      dynamicItems: [],
    };
    // Build a section per leg so the sheet (and dispatch) covers both sectors.
    const builtSections = runFgs.map((fg) => buildFlightSection(fg.flight, fg.rows, firstRow.date));
    openWarning({ ...rec, flightNos, sections: builtSections });
  };

  // ── Config helpers ──────────────────────────────────────────────────────────

  const resetFlightFields = () => {
    setConfigFlight("");
    setConfigPaxLines([
      { id: "p1", itemName: "", percent: 60, qty: 0 },
      { id: "p2", itemName: "", percent: 40, qty: 0 },
    ]);
    setConfigCrewMeals([{ id: "c1", type: "Breakfast", qty: "" }]);
    setConfigSpecialMeals([]);
    setReturnPaxLines([]);
    setReturnCrewMeals([]);
    setReturnSpecialMeals([]);
  };

  const resetConfig = () => {
    setConfigDate("");
    setConfigDepTime("");
    setConfigAdditional([]);
    setConfigFromWarehouse(DEFAULT_FROM_WH);
    setConfigToWarehouse(DEFAULT_TO_WH);
    resetFlightFields();
  };

  const openWarning = (rec: DispatchRecord) => {
    setDispatchingRecord(rec);
    setDispatched(false);
    setDeclared(false);
    setSections(rec.sections);
    setFlightDeptTime(rec.depTime);
    setDynamicItems(rec.dynamicItems.length > 0 ? rec.dynamicItems : [{ id: "d1", name: "", qty: "" }]);
    setWarningOpen(true);
  };

  const updateSection = (idx: number, updates: Partial<FlightSection>) =>
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, ...updates } : s)));

  const updatePaxLine = (sIdx: number, lIdx: number, field: keyof PaxLine, value: number | string) =>
    setSections((prev) =>
      prev.map((s, i) => {
        if (i !== sIdx) return s;
        const paxLines = s.paxLines.map((l, li) => (li === lIdx ? { ...l, [field]: value } : l));
        return { ...s, paxLines };
      })
    );

  const updateCrewMeal = (sIdx: number, cIdx: number, field: keyof CrewMealLine, value: string) =>
    setSections((prev) =>
      prev.map((s, i) => {
        if (i !== sIdx) return s;
        const crewMeals = s.crewMeals.map((c, ci) => (ci === cIdx ? { ...c, [field]: value } : c));
        return { ...s, crewMeals };
      })
    );

  const addDynamic = () =>
    setDynamicItems((prev) => [...prev, { id: `d${Date.now()}`, name: "", qty: "" }]);

  const updateDynamic = (id: string, field: "name" | "qty", value: string) =>
    setDynamicItems((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)));

  const removeDynamic = (id: string) =>
    setDynamicItems((prev) => prev.filter((d) => d.id !== id));

  const handleConfigSave = () => {
    if (!configDepTime) { toast.error("Please select a departure time."); return; }
    if (!configFlight)  { toast.error("Please select a flight."); return; }
    if (configuredFlights.has(configFlight)) { toast.error(`${configFlight} is already configured for dispatch.`); return; }
    if (includeReturn && returnOrder && configuredFlights.has(returnOrder.flight)) {
      toast.error(`Return leg ${returnOrder.flight} is already configured — untick "Dispatch the return sector together" to dispatch ${configFlight} alone.`);
      return;
    }
    if (!configFromWarehouse || !configToWarehouse) { toast.error("Please select both a from and to warehouse."); return; }
    if (configFromWarehouse === configToWarehouse) { toast.error("From and to warehouse must be different."); return; }
    // Soft warning only — proceed even if some meals aren't produced/QC-passed.
    if (!productionReady) {
      toast.warning(`Dispatching with meals not yet produced & QC-passed: ${blockingMeals.join(", ")}.`);
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });

    // The legs going on this one combined dispatch sheet: the selected flight,
    // plus its return leg when bundled (one record covers both sectors).
    type LegConfig = {
      flight: string; sector: string; order: FlightOrder | null;
      paxLines: CfgPaxLine[]; crewMeals: CfgCrewMeal[]; specialMeals: CfgSpecialMeal[];
    };
    const legConfigs: LegConfig[] = [
      { flight: configFlight, sector: selectedSector, order: selectedOrder ?? null,
        paxLines: configPaxLines, crewMeals: configCrewMeals, specialMeals: configSpecialMeals },
    ];
    if (includeReturn && returnOrder) {
      legConfigs.push({
        flight: returnOrder.flight, sector: returnOrder.sector, order: returnOrder,
        paxLines: returnPaxLines, crewMeals: returnCrewMeals, specialMeals: returnSpecialMeals,
      });
    }
    // Outbound leg first in the saved sections / packaging rows / flight list.
    legConfigs.sort((a, b) =>
      (a.order?.direction === "Outbound" ? 0 : 1) - (b.order?.direction === "Outbound" ? 0 : 1));

    const sectionFor = (leg: LegConfig): FlightSection => {
      const byCode = (code: string) =>
        leg.specialMeals.filter((m) => m.type === code).reduce((acc, m) => acc + (Number(m.qty) || 0), 0);
      return {
        flightNo: leg.flight,
        sector: leg.sector,
        paxLines: leg.paxLines.map(({ itemName, percent, qty }) => ({ itemName, percent, qty })),
        vgml: byCode("VGML"),
        chml: byCode("CHML"),
        spml: byCode("SPML"),
        crewMeals: leg.crewMeals.map(({ type, qty }) => ({ type, qty })),
        pastry: 0,
        childMealsPastry: 0,
      };
    };
    const newSections = legConfigs.map(sectionFor);

    const hotTotal = legConfigs.reduce(
      (s, leg) => s + leg.paxLines.reduce((a, l) => a + (Number(l.qty) || 0), 0), 0,
    );
    const existingRec = records.find((r) => r.date === configDate && r.depTime === configDepTime);
    const recId = existingRec ? existingRec.id : `DSP-${Date.now().toString().slice(-4)}`;

    // Build packaging rows per leg so the dispatch shows in the packaging/dispatch
    // list. Each row links back to its dispatch record (dspRef), the flight order
    // (orderNo) and — when the meal matches a production order — the PRO.
    const proFor = (mealName: string) =>
      productionEntries.find((e) => (e.outputItemName ?? e.bom) === mealName)?.id;
    // Crew period → a packaging meal-type bucket (PackagingRow has no "Crew").
    const crewMealType = (period: string): PackagingRow["mealType"] => {
      const p = period.toLowerCase();
      if (p.includes("breakfast")) return "Breakfast";
      if (p.includes("dinner")) return "Dinner";
      if (p.includes("lunch")) return "Lunch";
      return "Snack";
    };
    const dispatchDay = dayFromDate(configDate);
    const stamp = Date.now();
    const rowsForLeg = (leg: LegConfig, legIdx: number): PackagingRow[] => [
      ...leg.paxLines
        .filter((l) => l.itemName && (Number(l.qty) || 0) > 0)
        .map((l, i) => {
          const meta = mealMeta(l.itemName);
          return {
            id: `PRD-${stamp}-L${legIdx}-${i}`,
            date: configDate, depTime: configDepTime, flight: leg.flight,
            mealType: meta.mealType, mealName: l.itemName, qty: Number(l.qty) || 0,
            section: meta.section, packagingStatus: "Ready for Packaging" as PackagingStatus,
            dspRef: recId, orderNo: leg.order?.orderNo, productionOrderId: proFor(l.itemName),
          };
        }),
      ...leg.crewMeals
        .filter((m) => parseMealQty(m.qty) > 0)
        .map((m, i) => {
          const dish = resolveCrewDish(m.type, dispatchDay);
          return {
            id: `PRD-${stamp}-L${legIdx}-C${i}`,
            date: configDate, depTime: configDepTime, flight: leg.flight,
            mealType: crewMealType(m.type),
            mealName: dish ? `${dish} (Crew ${m.type})` : `Crew ${m.type}`,
            qty: parseMealQty(m.qty), section: "Crew Meal",
            packagingStatus: "Ready for Packaging" as PackagingStatus,
            dspRef: recId, orderNo: leg.order?.orderNo,
            productionOrderId: dish ? proFor(dish) : undefined,
          };
        }),
      ...leg.specialMeals
        .filter((m) => (Number(m.qty) || 0) > 0)
        .map((m, i) => {
          const dish = resolveSpecialDish(m.type, dispatchDay);
          return {
            id: `PRD-${stamp}-L${legIdx}-S${i}`,
            date: configDate, depTime: configDepTime, flight: leg.flight,
            mealType: "Special" as PackagingRow["mealType"], mealName: m.type,
            qty: Number(m.qty) || 0, section: "Special Meal",
            packagingStatus: "Ready for Packaging" as PackagingStatus,
            dspRef: recId, orderNo: leg.order?.orderNo,
            productionOrderId: dish ? proFor(dish) : undefined,
          };
        }),
    ];
    const newPackagingRows: PackagingRow[] = legConfigs.flatMap((leg, idx) => rowsForLeg(leg, idx));
    if (newPackagingRows.length > 0) {
      setPackagingRows((prev) => [...newPackagingRows, ...prev]);
    }

    const legFlights = legConfigs.map((l) => l.flight);
    const legLabel = legFlights.join(" + ");

    if (existingRec) {
      setRecords((prev) =>
        prev.map((r) =>
          r.id === existingRec.id
            ? {
                ...r,
                flightNos: [...r.flightNos, ...legFlights],
                fromWarehouseId: r.fromWarehouseId ?? configFromWarehouse,
                toWarehouseId: r.toWarehouseId ?? configToWarehouse,
                sections: [...r.sections, ...newSections],
                detail: {
                  ...r.detail,
                  flightKitchen: {
                    ...r.detail.flightKitchen,
                    totalMeals: r.detail.flightKitchen.totalMeals + hotTotal,
                    lunch:      r.detail.flightKitchen.lunch      + Math.floor(hotTotal * 0.6),
                    breakfast:  r.detail.flightKitchen.breakfast  + Math.floor(hotTotal * 0.4),
                  },
                },
              }
            : r
        )
      );
      toast.success(`${legLabel} added to dispatch ${existingRec.id} (dep ${configDepTime}).`);
    } else {
      const newRec: DispatchRecord = {
        id: recId,
        date: configDate,
        depTime: configDepTime,
        kitchenName: "Flight Kitchen A",
        flightNos: legFlights,
        fromWarehouseId: configFromWarehouse,
        toWarehouseId: configToWarehouse,
        builtAt: new Date().toISOString(),
        status: "Preparing",
        trail: [{ status: "Preparing", by: "System", date: dateStr, time: timeStr }],
        detail: {
          flightKitchen: { name: "Flight Kitchen A", totalMeals: hotTotal, lunch: Math.floor(hotTotal * 0.6), breakfast: Math.floor(hotTotal * 0.4) },
          bakery: [],
          amenities: configAdditional.filter((a) => a.name).map((a) => ({ label: a.name, qty: Number(a.qty) || 0 })),
          foodSafety: { result: "—", checkedBy: "—", date: "—", time: "—" },
        },
        sections: newSections,
        dynamicItems: configAdditional.map((a) => ({ id: a.id, name: a.name, qty: a.qty })),
      };
      setRecords((prev) => [...prev, newRec]);
      toast.success(
        legFlights.length > 1
          ? `Combined dispatch configured for ${legLabel} (outbound + return) departing ${configDepTime}.`
          : `Dispatch configured for ${legLabel} departing ${configDepTime}.`,
      );
    }

    setConfiguredFlights((prev) => new Set([...prev, ...legFlights]));
    setConfigOpen(false);
    resetConfig();
  };

  const handleDispatch = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
    setRecords((prev) =>
      prev.map((r) =>
        r.id === dispatchingRecord?.id
          ? { ...r, status: "Dispatched", dispatchedBy: "M. Karim",
              trail: [...r.trail, { status: "Dispatched", by: "M. Karim (Dispatch Executive)", date: dateStr, time: timeStr }] }
          : r
      )
    );
    if (dispatchingRecord) {
      const execName = "M. Karim";
      const newEntries: DispatchedFlightEntry[] = dispatchingRecord.flightNos.map((flight) => ({
        id: `DE-${Date.now()}-${flight}`,
        flight,
        depTime: dispatchingRecord.depTime,
        date: dispatchingRecord.date,
        totalQty: packagingRows.filter((r) => r.flight === flight).reduce((s, r) => s + r.qty, 0),
        dispatchExecName: execName,
        dispatchedDate: dateStr,
        dispatchedTime: timeStr,
        recordId: dispatchingRecord.id,
        sections: sections.filter((s) => s.flightNo === flight || dispatchingRecord.flightNos.length === 1),
        dynamicItems: dynamicItems.filter((d) => d.name),
        airportReceived: false,
      }));
      setDispatchedFlightEntries((prev) => [...prev, ...newEntries]);
      const dispatchedFlightSet = new Set(dispatchingRecord.flightNos);
      const dispatchedRows = packagingRows.filter((r) => dispatchedFlightSet.has(r.flight));

      // Dispatched meals leave inventory. Key the negative delta by meal name so
      // it nets against the positive delta QC adds on production completion
      // (see cooking-temp.tsx → applyStockDeltas). The Inventory report sums
      // these into its In/Out columns.
      const outDeltas = dispatchedRows
        .filter((r) => r.qty > 0)
        .map((r) => ({
          itemId: r.mealName,
          delta: -r.qty,
          date: r.date,
          reference: r.dspRef ?? r.orderNo ?? dispatchingRecord.id,
          label: "Dispatch",
        }));
      if (outDeltas.length > 0) applyStockDeltas(outDeltas);

      // Connect to the Inventory → Transfer module: a dispatched sheet moves
      // its meals out of the source warehouse, so raise one Transfer Note from
      // the dispatch's From → To warehouse. It enters the Transfer list as an
      // outbound "Pending" transfer (Transfer Out tab); the destination then
      // sends it in transit and receives it through the normal flow.
      const fromWh =
        activeWarehouses.find((w) => w.id === dispatchingRecord.fromWarehouseId) ??
        activeWarehouses.find((w) => w.id === "WH-003");
      const toWh =
        activeWarehouses.find((w) => w.id === dispatchingRecord.toWarehouseId) ??
        activeWarehouses.find((w) => w.id === "WH-001");
      const mealAgg = new Map<string, { qty: number; uom: string }>();
      for (const r of dispatchedRows) {
        if (r.qty <= 0) continue;
        const prev = mealAgg.get(r.mealName);
        mealAgg.set(r.mealName, { qty: (prev?.qty ?? 0) + r.qty, uom: "Meal" });
      }
      const tnItems = [...mealAgg.entries()].map(([name, v], i) => ({
        id: `${dispatchingRecord.id}-I${i + 1}`,
        name,
        qty: v.qty,
        uom: v.uom,
      }));
      if (fromWh && toWh && tnItems.length > 0) {
        addTransferNote({
          id: `TRF-${dispatchingRecord.id}`,
          demandRef: dispatchingRecord.id,
          grnRef: "Dispatch",
          items: tnItems,
          from: fromWh.name,
          to: toWh.name,
          issuedBy: execName,
          date: `${dispatchingRecord.date} ${timeStr}`,
          status: "Pending",
          officeId: fromWh.officeId,
          warehouseId: fromWh.id,
        });
        toast.info(`Transfer ${`TRF-${dispatchingRecord.id}`} created in Transfer Out: ${fromWh.name} → ${toWh.name} (${tnItems.length} item${tnItems.length > 1 ? "s" : ""}).`);
      }

      const SEED_IDS = new Set(["PRD-QC-DEMO1", "PRD-QC-DEMO2"]);
      const updatedRows = packagingRows.map((r) => {
        if (dispatchedFlightSet.has(r.flight)) {
          if (SEED_IDS.has(r.id)) return { ...r, packagingStatus: "Packaging Done" as PackagingStatus };
          return { ...r, packagingStatus: "Dispatched" as PackagingStatus };
        }
        return r;
      });
      setPackagingRows(updatedRows);
      // Reset QC state for seed flights so "Initiate QC" reappears
      const seedFlights = [...SEED_IDS].map((id) => packagingRows.find((r) => r.id === id)?.flight).filter(Boolean) as string[];
      if (seedFlights.some((f) => dispatchedFlightSet.has(f))) {
        setFlightQCStates((prev) => {
          const next = new Map(prev);
          seedFlights.forEach((f) => { if (dispatchedFlightSet.has(f)) next.delete(f); });
          return next;
        });
      }
    }
    setDispatched(true);
    toast.success("Dispatch initiated — awaiting airport receipt.");
    setFormOpen(false);
    setWarningOpen(false);
    // Defer the route change so the dispatched status (records + packaging rows)
    // is committed and persisted by usePersistedState's effect BEFORE this page
    // unmounts — otherwise the unmount races the write and the dispatch table
    // still reads "Ready for Dispatch" on return.
    setTimeout(() => navigate("/dispatch-monitoring"), 0);
  };

  const handleNotify = () => {
    setRecords((prev) =>
      prev.map((r) => (r.id === dispatchingRecord?.id ? { ...r, notifiedAirport: true } : r))
    );
    setNotifyOpen(false);
    setFormOpen(false);
  };

  // ── Re-dispatch a Returned dispatch ─────────────────────────────────────────
  // A transfer-in-transit return flips the linked dispatch record to "Returned"
  // and stamps the returned lines/quantities onto it. Re-dispatching runs the
  // FULL pipeline again — but only for the RETURNED load, not the whole original
  // dispatch: the linked packaging rows are rebuilt to exactly the returned
  // lines (Ready for Packaging), QC is cleared, and the record re-enters
  // "Preparing" so packaging → QC → Initiate Dispatch flow as a fresh dispatch.
  const reDispatchReturned = (dspId: string) => {
    const rec = records.find((r) => r.id === dspId);
    if (!rec || rec.status !== "Returned") return;
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
    const returned = rec.returnedLines ?? [];
    const primaryFlight = rec.flightNos[0];

    setPackagingRows((prev) => {
      if (returned.length === 0) {
        // No line detail (legacy/seed) — fall back to re-running the whole load.
        return prev.map((r) => (r.dspRef === dspId ? { ...r, packagingStatus: "Ready for Packaging" as PackagingStatus } : r));
      }
      // Inherit slot/section metadata from the dispatch's original rows.
      const template = prev.find((r) => r.dspRef === dspId);
      const others = prev.filter((r) => r.dspRef !== dspId);
      const rebuilt: PackagingRow[] = returned
        .filter((l) => l.qty > 0)
        .map((l, i) => ({
          id: `${dspId}-RD-${i + 1}`,
          date: template?.date ?? rec.date,
          depTime: template?.depTime ?? rec.depTime,
          flight: l.flight ?? template?.flight ?? primaryFlight,
          mealType: template?.mealType ?? "Lunch",
          mealName: l.meal,
          qty: l.qty,
          section: template?.section ?? "Hot Kitchen",
          packagingStatus: "Ready for Packaging" as PackagingStatus,
          dspRef: dspId,
          orderNo: template?.orderNo,
          productionOrderId: template?.productionOrderId,
        }));
      return [...rebuilt, ...others];
    });

    // Clear local QC so the returned load must pass QC again on the re-run.
    const flightSet = new Set([...rec.flightNos, ...returned.map((l) => l.flight ?? primaryFlight)]);
    setFlightQCStates((prev) => {
      const next = new Map(prev);
      flightSet.forEach((f) => f && next.delete(f));
      return next;
    });

    // Re-enter the pipeline and log the re-dispatch on the record's trail.
    setRecords((prev) =>
      prev.map((r) =>
        r.id === dspId
          ? {
              ...r,
              status: "Preparing" as DispatchStatus,
              trail: [
                ...r.trail,
                { status: "Preparing" as DispatchStatus, by: "M. Karim (Dispatch Executive) — re-dispatch of returned load", date: dateStr, time: timeStr },
              ],
            }
          : r,
      ),
    );
    const totalQty = returned.reduce((s, l) => s + l.qty, 0);
    toast.success(
      returned.length
        ? `${dspId} re-dispatch initiated — returned load (${totalQty} unit${totalQty === 1 ? "" : "s"}) sent back through packaging & QC.`
        : `${dspId} re-dispatch initiated — sent back through packaging & QC.`,
    );
  };

  // ── LMC downstream impact: a dispatch is built from a snapshot of the order's
  // PAX. If the order is later amended, the snapshot goes stale. Compare each
  // leg's snapshot pax (sum of its paxLines) against the source order's current
  // pax and surface the deltas so the dispatcher can re-sync (or recall).
  type ImpactField = { label: string; was: string | number; now: string | number };
  type RecordImpact = { flight: string; fields: ImpactField[] };
  const normTime = (t: string | undefined) => (t ?? "").trim().slice(0, 5);
  const recordImpacts = (rec: DispatchRecord): RecordImpact[] => {
    // Only records configured with a build time can go stale; legacy/seed
    // records (no builtAt) are never flagged — avoids false positives where a
    // seed snapshot simply never matched its order.
    if (!rec.builtAt) return [];
    const out: RecordImpact[] = [];
    for (const sec of rec.sections) {
      const order =
        flightOrders.find((o) => o.flight === sec.flightNo && o.date === rec.date && o.orderType !== "crew") ??
        flightOrders.find((o) => o.flight === sec.flightNo && o.orderType !== "crew");
      if (!order) continue;
      // Which fields were amended AFTER this dispatch was built? We surface every
      // high-impact change (not just PAX) so a last-minute ETD/date/special-meal
      // edit is visible to the dispatcher, not silently missed.
      const amendedFields = new Set(
        getOrderAmendments(order.id)
          .filter((a) => a.at > rec.builtAt!)
          .flatMap((a) => a.changes.map((c) => c.field)),
      );
      if (amendedFields.size === 0) continue;
      const fields: ImpactField[] = [];
      const snapPax = sec.paxLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
      if (snapPax !== order.pax) fields.push({ label: "PAX", was: snapPax, now: order.pax });
      if (amendedFields.has("specialMeals")) {
        const snapSpec = (sec.vgml || 0) + (sec.chml || 0) + (sec.spml || 0);
        if (snapSpec !== order.specialMeals) fields.push({ label: "Special Meals", was: snapSpec, now: order.specialMeals });
      }
      if (amendedFields.has("etd") && normTime(rec.depTime) !== normTime(order.etd))
        fields.push({ label: "ETD", was: rec.depTime, now: order.etd });
      if (amendedFields.has("date") && rec.date !== order.date)
        fields.push({ label: "Date", was: rec.date, now: order.date });
      if (fields.length) out.push({ flight: sec.flightNo, fields });
    }
    return out;
  };

  // Re-sync a dispatch record to its source orders' current PAX: re-split each
  // leg's paxLines (keeping dish names + percentages), refresh the kitchen total
  // and the linked PAX packaging-row quantities. Crew/special are untouched.
  const resyncRecord = (rec: DispatchRecord) => {
    const splitPax = (lines: PaxLine[], pax: number): PaxLine[] => {
      if (lines.length === 0) return lines;
      let assigned = 0;
      return lines.map((l, i) => {
        const qty = i === lines.length - 1 ? pax - assigned : Math.round((pax * l.percent) / 100);
        assigned += qty;
        return { ...l, qty: Math.max(0, qty) };
      });
    };
    // Re-scale the special-meal breakdown (veg/child/special) to a new total,
    // keeping each component's share. When the snapshot total was 0 we can't
    // infer a split, so the whole new total lands in `spml`.
    const scaleSpecial = (sec: FlightSection, newTotal: number) => {
      const old = (sec.vgml || 0) + (sec.chml || 0) + (sec.spml || 0);
      if (old === newTotal) return sec;
      if (old === 0) return { ...sec, spml: newTotal };
      const vgml = Math.round((newTotal * (sec.vgml || 0)) / old);
      const chml = Math.round((newTotal * (sec.chml || 0)) / old);
      const spml = newTotal - vgml - chml;
      return { ...sec, vgml, chml, spml: Math.max(0, spml) };
    };
    const newSections = rec.sections.map((sec) => {
      const order =
        flightOrders.find((o) => o.flight === sec.flightNo && o.date === rec.date && o.orderType !== "crew") ??
        flightOrders.find((o) => o.flight === sec.flightNo && o.orderType !== "crew");
      if (!order) return sec;
      let next = { ...sec, paxLines: splitPax(sec.paxLines, order.pax) };
      next = scaleSpecial(next, order.specialMeals);
      return next;
    });
    // Pull the record's schedule forward to the (possibly amended) source ETD/date.
    const schedOrder =
      flightOrders.find((o) => rec.flightNos.includes(o.flight) && o.orderType !== "crew");
    const hotTotal = newSections.reduce((s, sec) => s + sec.paxLines.reduce((a, l) => a + l.qty, 0), 0);
    const newDepTime = schedOrder ? schedOrder.etd : rec.depTime;
    const newDate = schedOrder ? schedOrder.date : rec.date;
    setRecords((prev) => prev.map((r) => r.id === rec.id ? {
      ...r,
      date: newDate,
      depTime: newDepTime,
      sections: newSections,
      detail: { ...r.detail, flightKitchen: {
        ...r.detail.flightKitchen, totalMeals: hotTotal,
        lunch: Math.floor(hotTotal * 0.6), breakfast: Math.floor(hotTotal * 0.4),
      } },
    } : r));
    // Update the PAX packaging rows (non crew/special) for this dispatch, plus
    // re-scale Special Meal rows to each flight's new special-meal total.
    const newQtyByKey = new Map<string, number>();
    const newSpecByFlight = new Map<string, number>();
    for (const sec of newSections) {
      for (const l of sec.paxLines) newQtyByKey.set(`${sec.flightNo}|${l.itemName}`, l.qty);
      newSpecByFlight.set(sec.flightNo, (sec.vgml || 0) + (sec.chml || 0) + (sec.spml || 0));
    }
    // Special rows are distributed proportionally to their share of the flight's
    // old special total (computed from the rows themselves so it stays in sync).
    const oldSpecByFlight = new Map<string, number>();
    for (const row of packagingRows) {
      if (row.dspRef !== rec.id || row.section !== "Special Meal") continue;
      oldSpecByFlight.set(row.flight, (oldSpecByFlight.get(row.flight) || 0) + row.qty);
    }
    setPackagingRows((prev) => prev.map((row) => {
      if (row.dspRef !== rec.id) return row;
      if (row.section === "Crew Meal") return row;
      if (row.section === "Special Meal") {
        const oldTot = oldSpecByFlight.get(row.flight) || 0;
        const newTot = newSpecByFlight.get(row.flight);
        if (newTot == null || oldTot === newTot) return row;
        const q = oldTot === 0 ? newTot : Math.round((newTot * row.qty) / oldTot);
        return { ...row, qty: Math.max(0, q), date: newDate, depTime: newDepTime };
      }
      const q = newQtyByKey.get(`${row.flight}|${row.mealName}`);
      return q == null ? row : { ...row, qty: q, date: newDate, depTime: newDepTime };
    }));
    const impacts = recordImpacts(rec);
    const summary = impacts
      .map((i) => `${i.flight}: ${i.fields.map((f) => `${f.label} ${f.was}→${f.now}`).join(", ")}`)
      .join(" · ");
    toast.success(`${rec.id} re-synced to current orders${summary ? ` (${summary})` : ""}.`);
    setViewRecord((cur) => cur && cur.id === rec.id ? { ...cur, date: newDate, depTime: newDepTime, sections: newSections } : cur);
  };

  // Derive a flight's check-sheet section from real system data:
  //   • PAX Main Meal ← the produced passenger meals (Menu Planning → Production,
  //     carried on the packaging rows linked to this flight)
  //   • Sector / Special Meals (VGML/CHML/SPML) / Crew ← the Order Management
  //     flight + crew orders for this flight
  // so the sheet always reflects live data rather than the seed placeholders.
  const slotLabel = (etd: string) => {
    const h = Number((etd || "").split(":")[0]) || 0;
    return h < 11 ? "Breakfast" : h < 16 ? "Lunch" : h < 21 ? "Dinner" : "Snack";
  };
  const buildFlightSection = (flight: string, rows: PackagingRow[], date: string): FlightSection => {
    const order =
      flightOrders.find((o) => o.flight === flight && o.date === date && o.orderType !== "crew") ??
      flightOrders.find((o) => o.flight === flight && o.orderType !== "crew");

    const paxRows = rows.filter((r) => r.mealType !== "Special");
    const specialRows = rows.filter((r) => r.mealType === "Special");
    const paxTotal = paxRows.reduce((s, r) => s + r.qty, 0) || (order?.pax ?? 0);
    const paxLines: PaxLine[] = paxRows.length
      ? paxRows.map((r) => ({ itemName: r.mealName, percent: paxTotal ? Math.round((r.qty / paxTotal) * 100) : 0, qty: r.qty }))
      : [{ itemName: order ? "PAX Meal" : "—", percent: 100, qty: order?.pax ?? 0 }];

    // Special-meal breakdown — prefer the Order Management roster (per passenger
    // meal code); fall back to any "Special" production rows by name.
    const roster = order?.specialMealRoster ?? [];
    const codeCount = (code: string) => {
      const fromRoster = roster.filter((e) => (e.mealCode ?? "").toUpperCase() === code).length;
      if (fromRoster) return fromRoster;
      return specialRows.filter((r) => r.mealName.toUpperCase().includes(code)).reduce((s, r) => s + r.qty, 0);
    };
    const vgml = codeCount("VGML");
    const chml = codeCount("CHML");
    const totalSpecial = order?.specialMeals ?? (roster.length || specialRows.reduce((s, r) => s + r.qty, 0));
    const spml = Math.max(0, totalSpecial - vgml - chml);

    // Crew meal — from crew-meal orders for this flight, else the flight order's
    // crew count.
    const crewOrders = flightOrders.filter((o) => o.flight === flight && o.orderType === "crew" && (!date || o.date === date));
    const crewMeals: CrewMealLine[] = crewOrders.length
      ? crewOrders.map((c) => ({ type: slotLabel(c.etd), qty: String(c.crew) }))
      : order && order.crew > 0
      ? [{ type: slotLabel(order.etd), qty: String(order.crew) }]
      : [];

    return {
      flightNo: flight,
      sector: (order?.sector ?? "").replace(/\s*→\s*/g, "-"),
      direction: (order?.direction as LegDirection) ?? "Outbound",
      paxLines,
      vgml, chml, spml,
      crewMeals,
      pastry: paxTotal,
      childMealsPastry: 0,
    };
  };
  const buildSectionsForRecord = (rec: DispatchRecord): FlightSection[] =>
    rec.flightNos.map((flight) =>
      buildFlightSection(flight, packagingRows.filter((r) => r.dspRef === rec.id && r.flight === flight), rec.date),
    );

  // Render the Meal Dispatch Check Sheet for a record into a standalone print
  // window so the user gets a clean, sheet-only PDF (via the browser's "Save as
  // PDF") that mirrors the on-screen check sheet — rather than printing the app.
  const downloadDispatchSheet = (rec: DispatchRecord) => {
    const esc = (s: unknown) =>
      String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

    // Build the sheet from live Order Management + Menu Planning data.
    const sheetSections = buildSectionsForRecord(rec);

    // Production order numbers backing this dispatch (from its packaging rows).
    const productionNos = [...new Set(
      packagingRows.filter((r) => r.dspRef === rec.id).map((r) => r.productionOrderId).filter(Boolean),
    )] as string[];
    const productionNoStr = productionNos.length ? productionNos.join(", ") : "—";

    // Domestic endpoints — used to label the sheet International vs Domestic.
    const DOMESTIC = new Set(["DAC", "CGP", "CXB", "ZYL", "JSR", "BZL", "SPD", "RJH", "TKR", "CLA"]);
    const isIntl = sheetSections.some((s) =>
      s.sector.split(/[-→/]/).map((x) => x.trim().toUpperCase()).some((code) => code && !DOMESTIC.has(code)),
    );
    const flightType = isIntl ? "International Flight" : "Domestic Flight";

    const win = window.open("", "_blank", "width=900,height=1100");
    if (!win) { toast.error("Pop-up blocked — allow pop-ups to download the PDF."); return; }

    const sectionsHtml = sheetSections.map((sec) => {
      const hotTotal = sec.paxLines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
      const paxRows = sec.paxLines
        .map((l) => `<tr><td>${esc(l.itemName)}</td><td class="c">${esc(l.percent)}</td><td class="c">${esc(l.qty)}</td></tr>`)
        .join("");
      const crewRows = sec.crewMeals.length
        ? sec.crewMeals.map((cm) => `<tr><td>${esc(cm.type)}</td><td class="c">${esc(cm.qty)}</td></tr>`).join("")
        : `<tr><td class="muted" colspan="2">—</td></tr>`;
      const dirLabel = sec.direction === "Return" ? "RETURN" : "OUTBOUND";
      const dirClass = sec.direction === "Return" ? "dir-ret" : "dir-out";
      return `
        <div class="card">
          <div class="card-hd"><span class="dir ${dirClass}">${dirLabel}</span> <b>FLT. NO.</b> ${esc(sec.flightNo)} &nbsp;&nbsp; <b>SECTOR</b> ${esc(sec.sector)}</div>
          <div class="card-bd">
            <div class="cols">
              <div class="left">
                <h4>PAX Main Meal</h4>
                <table class="grid">
                  <thead><tr><th>Item's Name</th><th class="c">%</th><th class="c">Qty</th></tr></thead>
                  <tbody>
                    ${paxRows}
                    <tr class="tot"><td><b>Hot Meal Total</b></td><td></td><td class="c"><b>${hotTotal}</b></td></tr>
                  </tbody>
                </table>
                ${(() => {
                  const sm = [
                    sec.vgml > 0 ? `<span class="sm">VGML <b>${esc(sec.vgml)}</b></span>` : "",
                    sec.chml > 0 ? `<span class="sm">CHML <b>${esc(sec.chml)}</b></span>` : "",
                    sec.spml > 0 ? `<span class="sm">SPML <b>${esc(sec.spml)}</b></span>` : "",
                  ].filter(Boolean);
                  return sm.length ? `<div class="special"><span class="lbl">Special Meals</span>${sm.join("")}</div>` : "";
                })()}
                ${(() => {
                  const pt = [
                    sec.pastry > 0 ? `<span>Pastry for ${esc(sec.flightNo)}: <b>${esc(sec.pastry)}</b></span>` : "",
                    sec.childMealsPastry > 0 ? `<span>Child Meals Pastry: <b>${esc(sec.childMealsPastry)}</b></span>` : "",
                  ].filter(Boolean);
                  return pt.length ? `<div class="pastry">${pt.join("")}</div>` : "";
                })()}
              </div>
              <div class="right">
                <h4>Crew Meal</h4>
                <table class="grid">
                  <thead><tr><th>Type</th><th class="c">Qty</th></tr></thead>
                  <tbody>${crewRows}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>`;
    }).join("");

    const additional = rec.dynamicItems.filter((d) => d.name && d.name.trim());
    const additionalHtml = additional.length
      ? `<div class="card"><div class="card-hd light">Additional Items</div><div class="card-bd">
           <table class="grid"><thead><tr><th>Item</th><th class="c">Qty</th></tr></thead><tbody>
           ${additional.map((d) => `<tr><td>${esc(d.name)}</td><td class="c">${esc(d.qty)}</td></tr>`).join("")}
           </tbody></table></div></div>`
      : "";

    // Per-leg dispatch summary (Outbound + Return) with a combined total across
    // both sectors — mirrors the on-screen round-trip summary.
    const legRow = (s: FlightSection) => {
      const pax = s.paxLines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
      const crew = s.crewMeals.reduce((sum, c) => sum + (Number(c.qty) || 0), 0);
      const special = (Number(s.vgml) || 0) + (Number(s.chml) || 0) + (Number(s.spml) || 0);
      return { pax, crew, special, total: pax + crew + special, s };
    };
    const legRows = sheetSections.map(legRow);
    const grand = legRows.reduce(
      (a, r) => ({ pax: a.pax + r.pax, crew: a.crew + r.crew, special: a.special + r.special, total: a.total + r.total }),
      { pax: 0, crew: 0, special: 0, total: 0 },
    );
    const summaryLabel = legRows.length > 1 ? "Dispatch Summary — Outbound + Return" : "Dispatch Summary";
    const dash = (n: number) => (n > 0 ? String(n) : "—");
    const summaryHtml = `
      <div class="card"><div class="card-hd light">${summaryLabel}</div><div class="card-bd">
        <table class="grid">
          <thead><tr><th>Leg</th><th class="c">PAX</th><th class="c">Crew</th><th class="c">Special</th><th class="c">Total Meals</th></tr></thead>
          <tbody>
            ${legRows.map((r) => {
              const dir = r.s.direction === "Return" ? "RETURN" : "OUTBOUND";
              const dirClass = r.s.direction === "Return" ? "dir-ret" : "dir-out";
              return `<tr><td><span class="dir ${dirClass}">${dir}</span> <b>${esc(r.s.flightNo)}</b> <span class="muted">${esc(r.s.sector)}</span></td><td class="c">${dash(r.pax)}</td><td class="c">${dash(r.crew)}</td><td class="c">${dash(r.special)}</td><td class="c"><b>${dash(r.total)}</b></td></tr>`;
            }).join("")}
            ${legRows.length > 1 ? `<tr class="tot"><td><b>Total (both sectors)</b></td><td class="c"><b>${dash(grand.pax)}</b></td><td class="c"><b>${dash(grand.crew)}</b></td><td class="c"><b>${dash(grand.special)}</b></td><td class="c"><b>${dash(grand.total)}</b></td></tr>` : ""}
          </tbody>
        </table>
      </div></div>`;

    win.document.write(`<!doctype html><html><head><meta charset="utf-8" />
      <title>Dispatch Sheet ${esc(rec.id)}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #1f2937; margin: 0; padding: 32px; font-size: 12px; }
        .org { text-align: center; }
        .org h1 { margin: 0; font-size: 17px; letter-spacing: .05em; }
        .org .addr { color: #6b7280; font-size: 10px; margin-top: 2px; }
        .sheet-title { text-align: center; font-weight: 600; font-size: 13px; margin: 12px 0; padding: 10px 0; border-top: 1px solid #e5e7eb; }
        .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
        .meta .box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px; }
        .meta .k { color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
        .meta .v { font-weight: 600; font-size: 13px; margin-top: 2px; }
        .card { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 14px; }
        .card-hd { background: #f1f5f9; border-bottom: 1px solid #e2e8f0; padding: 8px 12px; font-size: 12px; }
        .card-hd b { color: #475569; font-size: 11px; letter-spacing: .04em; }
        .card-hd.light { text-transform: uppercase; letter-spacing: .08em; font-weight: 700; color: #475569; font-size: 10px; }
        .card-bd { padding: 12px; }
        .cols { display: grid; grid-template-columns: 1fr 220px; gap: 16px; }
        h4 { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin: 0 0 6px; }
        table.grid { width: 100%; border-collapse: collapse; }
        table.grid th { background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; font-size: 11px; }
        table.grid td { border: 1px solid #e2e8f0; padding: 6px 8px; }
        .c { text-align: center; }
        .tot { background: #f8fafc; }
        .special { margin-top: 10px; display: flex; gap: 14px; align-items: center; border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 6px; padding: 6px 10px; flex-wrap: wrap; }
        .special .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #64748b; font-weight: 700; }
        .pastry { margin-top: 10px; display: flex; gap: 24px; flex-wrap: wrap; }
        .muted { color: #9ca3af; }
        .dir { display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: .05em; padding: 1px 6px; border-radius: 999px; margin-right: 6px; vertical-align: middle; }
        .dir-out { background: #d1fae5; color: #047857; }
        .dir-ret { background: #fef3c7; color: #b45309; }
        @media print { body { padding: 0.4in; } .card { break-inside: avoid; } }
      </style></head><body>
      <div class="org"><h1>US-BANGLA AIRLINES</h1><div class="addr">MADINA BHABAN, BAUNIA, BATTOLA, TURAG, DHAKA-1230</div></div>
      <div class="sheet-title">Meal Dispatch Check Sheet (${flightType})</div>
      <div class="meta">
        <div class="box"><div class="k">Dispatch By</div><div class="v">PRODUCTION</div></div>
        <div class="box"><div class="k">Production No</div><div class="v">${esc(productionNoStr)}</div></div>
        <div class="box"><div class="k">Date</div><div class="v">${esc(rec.date)}</div></div>
        <div class="box"><div class="k">Flight Dept Time (LT)</div><div class="v">${esc(rec.depTime)}</div></div>
      </div>
      ${sectionsHtml}
      ${additionalHtml}
      ${summaryHtml}
    </body></html>`);
    win.document.close();
    win.focus();
    // Give the new document a tick to lay out before invoking print.
    setTimeout(() => win.print(), 250);
  };

  // Leg header — direction-coded (Outbound = emerald, Return = amber) so the
  // badge colour always matches the label.
  const legHeader = (flight: string, sector: string, direction: LegDirection) => (
    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-600">
      <span className={`px-1.5 py-0.5 rounded text-[10px] ${direction === "Return" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
        {direction}
      </span>
      {flight} · {sector}
    </div>
  );

  // PAX / Crew / Special meal-entry sections for one leg. Rendered once for the
  // selected flight, and again for the return leg when the round trip is bundled.
  type SetFn<T> = (updater: (prev: T[]) => T[]) => void;
  const renderMealSections = (
    paxLines: CfgPaxLine[], setPaxLines: SetFn<CfgPaxLine>,
    crewMeals: CfgCrewMeal[], setCrewMeals: SetFn<CfgCrewMeal>,
    specialMeals: CfgSpecialMeal[], setSpecialMeals: SetFn<CfgSpecialMeal>,
  ) => {
    const specialOpts = [...new Set([...SPECIAL_MEAL_TYPES, ...specialMeals.map((m) => m.type)])];
    return (
      <>
        {/* PAX Main Meal */}
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">PAX Main Meal</div>
          <table className="w-full text-xs border border-slate-200 rounded-md overflow-hidden">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="p-2 text-left font-semibold">Item Name</th>
                <th className="p-2 text-center font-semibold w-28">%</th>
                <th className="p-2 text-center font-semibold w-24">QTY</th>
                <th className="p-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {paxLines.map((line, i) => (
                <tr key={line.id} className={i > 0 ? "border-t border-slate-200" : ""}>
                  <td className="p-1.5">
                    <select
                      value={line.itemName}
                      onChange={(e) => setPaxLines((prev) => prev.map((l) => l.id === line.id ? { ...l, itemName: e.target.value } : l))}
                      className="h-8 w-full rounded border border-input bg-background px-2 text-xs"
                    >
                      <option value="">— Select —</option>
                      {paxMenu.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                    </select>
                  </td>
                  <td className="p-1.5">
                    <select
                      value={line.percent}
                      onChange={(e) => setPaxLines((prev) => prev.map((l) => l.id === line.id ? { ...l, percent: Number(e.target.value) } : l))}
                      className="h-8 w-full rounded border border-input bg-background px-2 text-xs text-center"
                    >
                      {[30, 40, 50, 60, 70].map((v) => <option key={v} value={v}>{v}%</option>)}
                    </select>
                  </td>
                  <td className="p-1.5">
                    <Input
                      type="number" min={0}
                      value={line.qty || ""}
                      onChange={(e) => setPaxLines((prev) => prev.map((l) => l.id === line.id ? { ...l, qty: Number(e.target.value) } : l))}
                      className="h-8 text-xs text-center"
                    />
                  </td>
                  <td className="p-1.5 text-center">
                    {paxLines.length > 1 && (
                      <button onClick={() => setPaxLines((prev) => prev.filter((l) => l.id !== line.id))} className="text-red-500 hover:text-red-700 text-base leading-none">×</button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-50/80">
                <td className="p-2 font-bold text-xs" colSpan={2}>Total Hot Meal</td>
                <td className="p-2 text-center font-bold text-slate-800">{paxLines.reduce((s, l) => s + (Number(l.qty) || 0), 0)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <Button variant="outline" size="sm" className="mt-2 text-xs no-brand"
            onClick={() => setPaxLines((prev) => [...prev, { id: `p${Date.now()}`, itemName: "", percent: 40, qty: 0 }])}>
            + Add Meal Option
          </Button>
        </div>

        {/* Crew Meals */}
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Crew Meals</div>
          <div className="space-y-2">
            {crewMeals.map((meal) => (
              <div key={meal.id} className="flex items-center gap-2">
                <select
                  value={meal.type}
                  onChange={(e) => setCrewMeals((prev) => prev.map((m) => m.id === meal.id ? { ...m, type: e.target.value } : m))}
                  className="h-8 flex-1 rounded border border-input bg-background px-2 text-sm"
                >
                  {CREW_MEAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <Input
                  value={meal.qty}
                  onChange={(e) => setCrewMeals((prev) => prev.map((m) => m.id === meal.id ? { ...m, qty: e.target.value } : m))}
                  placeholder="e.g. 12+1"
                  className="h-8 w-28 text-sm"
                />
                {crewMeals.length > 1 && (
                  <button onClick={() => setCrewMeals((prev) => prev.filter((m) => m.id !== meal.id))} className="text-red-500 hover:text-red-700 text-lg leading-none">×</button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" className="text-xs no-brand"
              onClick={() => setCrewMeals((prev) => [...prev, { id: `c${Date.now()}`, type: "Lunch", qty: "" }])}>
              + Add More
            </Button>
          </div>
        </div>

        {/* Special Meals */}
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Special Meals</div>
          <div className="space-y-2">
            {specialMeals.length === 0 && (
              <p className="text-xs text-muted-foreground">No special meals added.</p>
            )}
            {specialMeals.map((meal) => (
              <div key={meal.id} className="flex items-center gap-2">
                <select
                  value={meal.type}
                  onChange={(e) => setSpecialMeals((prev) => prev.map((m) => m.id === meal.id ? { ...m, type: e.target.value } : m))}
                  className="h-8 flex-1 rounded border border-input bg-background px-2 text-sm"
                >
                  {specialOpts.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <Input
                  type="number" min={0}
                  value={meal.qty}
                  onChange={(e) => setSpecialMeals((prev) => prev.map((m) => m.id === meal.id ? { ...m, qty: e.target.value } : m))}
                  placeholder="Qty"
                  className="h-8 w-24 text-sm text-center"
                />
                <button onClick={() => setSpecialMeals((prev) => prev.filter((m) => m.id !== meal.id))} className="text-red-500 hover:text-red-700 text-lg leading-none">×</button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="text-xs no-brand"
              onClick={() => setSpecialMeals((prev) => [...prev, { id: `s${Date.now()}`, type: "VGML", qty: "" }])}>
              + Add Special Meal
            </Button>
          </div>
        </div>
      </>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <PageHeader
        title="Packaging & Dispatch"
        subtitle="Tray prep, cart assignment, label printing & vehicle dispatch"
        actions={<Button onClick={() => { setConfigDate(today); setConfigOpen(true); }}><Plus className="h-4 w-4 mr-1" /> New Dispatch</Button>}
      />

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Active Dispatches" value={activeDispatches} icon={Truck} tone="navy" />
        <KpiCard label="Trays Prepared" value="1,420" icon={Package} tone="success" />
        <KpiCard label="Vehicles On Trip" value={vehiclesOnTrip} icon={Truck} tone="warning" />
        <KpiCard label="Delivered Today" value={deliveredToday} icon={Truck} tone="red" />
      </div>

      {/* ── Filter Bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 py-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto">
          <span className="text-xs text-muted-foreground whitespace-nowrap">From</span>
          <Input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="h-9 text-sm w-full sm:w-36"
            placeholder="From"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">To</span>
          <Input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="h-9 text-sm w-full sm:w-36"
            placeholder="To"
          />
        </div>
        <select
          value={filterDepTime}
          onChange={(e) => setFilterDepTime(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm w-full sm:w-40"
        >
          <option value="">All Dep Times</option>
          {depTimesForDate.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm w-full sm:w-52"
        >
          <option>All Statuses</option>
          <option>Ready for Packaging</option>
          <option>Packaging In Progress</option>
          <option>Packaging Done</option>
          <option>Ready for Dispatch</option>
          <option>Dispatched</option>
        </select>
      </div>

      {/* ── PRD Packaging Table ──────────────────────────────────────────────── */}
      <div data-arrival-id="dispatch-list" className="rounded-lg border border-border bg-card shadow-sm mb-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="p-3 text-center font-semibold w-12">SL</th>
                <th className="p-3 text-left font-semibold">Dispatch ID</th>
                <th className="p-3 text-left font-semibold">Flight</th>
                <th className="p-3 text-left font-semibold">Order</th>
                <th className="p-3 text-left font-semibold">Date</th>
                <th className="p-3 text-left font-semibold">Dep Time</th>
                <th className="p-3 text-center font-semibold">Meals</th>
                <th className="p-3 text-left font-semibold">Status</th>
                <th className="p-3 text-left font-semibold">Food Safety & QC</th>
                <th className="p-3 text-left font-semibold">Actions</th>
              </tr>
            </thead>

            {groupedPRDs.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={10} className="p-10 text-center text-muted-foreground text-sm">
                    No packaging orders match the selected filters.
                  </td>
                </tr>
              </tbody>
            ) : (
              groupedPRDs.map((timeGroup, tgIdx) => {
                const flightCount = timeGroup.flightGroups.length;
                // Running serial across all time-groups — one serial per dispatch
                // run (round-trip legs share a Dispatch ID and one SL).
                const serialBase = groupedPRDs.slice(0, tgIdx).reduce((s, g) => s + dispatchRunCount(g.flightGroups), 0);
                // Round-trip grouping: consecutive legs that share a Dispatch ID
                // (outbound + return of the same dispatch) are merged so the
                // Dispatch ID / Order cells span both legs — one dispatch, two
                // leg lines — while each leg keeps its own status / QC / actions.
                const fgs = timeGroup.flightGroups;
                const dspOf = (fg: FlightGroup) => fg.rows.find((r) => r.dspRef)?.dspRef;
                const dispatchRunInfo = fgs.map((fg, i) => {
                  const dsp = dspOf(fg);
                  const prevDsp = i > 0 ? dspOf(fgs[i - 1]) : undefined;
                  if (dsp && prevDsp === dsp) return { first: false, span: 0 };
                  let span = 1;
                  if (dsp) for (let j = i + 1; j < fgs.length && dspOf(fgs[j]) === dsp; j++) span++;
                  return { first: true, span };
                });
                return (
                  <tbody key={timeGroup.depTime}>
                    {timeGroup.flightGroups.map((flightGroup, fgIdx) => {
                      // A completed Dispatch Monitoring entry (qcClearedFlights)
                      // clears the flight for dispatch, overriding local QC state.
                      const monitoredAt = qcClearedFlights[flightGroup.flight];
                      const localQCData = flightQCStates.get(flightGroup.flight);
                      const hasHocApproval = dispatchApprovals.some(
                        (da) => da.flightId === flightGroup.flight && (da.stage === "hoc_approved" || da.stage === "forwarded_to_airport")
                      );
                      const flightQCData = monitoredAt
                        ? { qcState: "done" as QCState, qcCheckedAt: monitoredAt }
                        : hasHocApproval ? { qcState: "done" as QCState, qcCheckedAt: "" }
                        : localQCData;
                      const flightQCState = flightQCData?.qcState ?? "not-started";
                      const allPackagingDone = flightGroup.rows.every(
                        (r) => r.packagingStatus === "Packaging Done" || r.packagingStatus === "Ready for Dispatch"
                      );
                      const allDispatched = flightGroup.rows.every((r) => r.packagingStatus === "Dispatched");
                      const flightStatus = getFlightStatus(flightGroup.rows, flightQCState);
                      const isFirstInTime = fgIdx === 0;
                      const isAbsoluteLast = fgIdx === flightCount - 1;
                      // One row per flight now — the per-meal production breakdown
                      // lives in the View dialog (Eye / Meals cell), not the list.
                      const dspId = flightGroup.rows.find((r) => r.dspRef)?.dspRef;
                      const dspRec = dspId ? records.find((rec) => rec.id === dspId) : undefined;
                      const dspHasRecord = !!dspRec;
                      // A dispatch returned from transfer-in-transit can be re-dispatched
                      // (full pipeline re-run) from its record's row.
                      const isReturnedDispatch = dspRec?.status === "Returned";
                      const run = dispatchRunInfo[fgIdx];
                      // One serial per dispatch run (= per Dispatch ID).
                      const runsBefore = dispatchRunInfo.slice(0, fgIdx).filter((r) => r.first).length;
                      const serialNo = serialBase + runsBefore + 1;
                      // Order numbers across all legs of this dispatch run (so the
                      // merged Order cell covers both outbound + return).
                      const runFgs = run.first ? fgs.slice(fgIdx, fgIdx + run.span) : [];
                      const orderNos = [...new Set(runFgs.flatMap((fg) => fg.rows.map((r) => r.orderNo)).filter(Boolean))] as string[];
                      const isRoundTrip = run.first && run.span > 1;
                      // Combined dispatch gating: every leg of this dispatch must be
                      // QC-done before the single Initiate Dispatch unlocks, and at
                      // least one leg must still be undispatched.
                      const allLegsQcDone = run.first && runFgs.every((fg) => getQcState(fg.flight) === "done");
                      const runAnyNotDispatched = run.first && runFgs.some((fg) => getFlightStatus(fg.rows, getQcState(fg.flight)) !== "Dispatched");
                      const mealCount = flightGroup.rows.length;
                      const totalQty = flightGroup.rows.reduce((s, r) => s + r.qty, 0);
                      return (
                        <tr
                          key={`${flightGroup.flight}-${dspId ?? fgIdx}`}
                          data-arrival-row-id={flightGroup.rows[0]?.id}
                          className={`hover:bg-muted/20 ${isAbsoluteLast ? "border-b-2 border-border" : "border-b border-border/50"}`}
                        >
                          {run.first && (
                            <td rowSpan={run.span} className="p-3 align-middle text-center text-xs font-medium text-muted-foreground tabular-nums border-r border-border/20">
                              {serialNo}
                            </td>
                          )}
                          {run.first && (
                            <td rowSpan={run.span} className="p-3 align-middle border-r border-border/20">
                              {!dspId ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : dspHasRecord ? (
                                <button
                                  type="button"
                                  className="text-xs font-mono font-semibold text-primary hover:underline whitespace-nowrap"
                                  title="View dispatch details"
                                  onClick={() => setViewRecord(records.find((rec) => rec.id === dspId)!)}
                                >
                                  {dspId}
                                </button>
                              ) : (
                                <span className="text-xs font-mono font-semibold text-foreground whitespace-nowrap">{dspId}</span>
                              )}
                              {dspHasRecord && (() => {
                                const rec = records.find((r) => r.id === dspId);
                                return rec && recordImpacts(rec).length > 0 ? (
                                  <span className="mt-1 flex w-fit items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-700" title="Source order amended since configured — open to re-sync">
                                    <AlertTriangle className="h-2.5 w-2.5" /> LMC
                                  </span>
                                ) : null;
                              })()}
                              {isRoundTrip && (
                                <span className="mt-1 block text-[10px] font-medium text-amber-600 whitespace-nowrap">Round trip · {run.span} legs</span>
                              )}
                            </td>
                          )}
                          <td className="p-3 font-semibold text-sm align-middle border-r border-border/20 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              {flightGroup.flight}
                              {(() => {
                                const dir = flightOrders.find((o) => o.flight === flightGroup.flight && o.orderType !== "crew")?.direction;
                                return dir ? (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${dir === "Return" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{dir}</span>
                                ) : null;
                              })()}
                            </span>
                          </td>
                          {run.first && (
                            <td rowSpan={run.span} className="p-3 align-middle border-r border-border/20">
                              {orderNos.length === 0 ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {orderNos.map((on) => (
                                    <button
                                      key={on}
                                      type="button"
                                      className="text-xs font-mono font-semibold text-primary hover:underline whitespace-nowrap"
                                      title="Open Order Management"
                                      onClick={() => navigate(`/order-management?ord=${on}`)}
                                    >
                                      {on}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </td>
                          )}
                          {run.first && (
                            <td rowSpan={run.span} className="p-3 text-sm text-muted-foreground align-middle tabular-nums whitespace-nowrap border-r border-border/20">
                              {flightGroup.rows[0]?.date ?? "—"}
                            </td>
                          )}
                          {isFirstInTime && (
                            <td rowSpan={flightCount} className="p-3 text-sm text-muted-foreground align-middle font-medium border-r border-border/40 bg-slate-50/60 whitespace-nowrap">
                              {timeGroup.depTime}
                            </td>
                          )}
                          <td className="p-3 align-middle text-center">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline whitespace-nowrap"
                              title="View meal breakdown"
                              onClick={() => setViewPackagingRow(flightGroup.rows[0])}
                            >
                              <Eye className="h-3 w-3" /> {mealCount} item{mealCount === 1 ? "" : "s"} · {totalQty.toLocaleString()}
                            </button>
                          </td>
                          <td className="p-3 align-middle border-l border-border/20">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${FLIGHT_STATUS_BADGE[flightStatus] ?? "bg-muted text-muted-foreground"}`}>
                              {flightStatus}
                            </span>
                          </td>
                          <td className="p-3 align-middle border-l border-border/20">
                            {(flightQCState === "done" || allDispatched) ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold cursor-default" style={{ backgroundColor: "#42F527", color: "#166534" }}
                                title={`QC checked at ${flightQCData?.qcCheckedAt ?? ""}`}>
                                <ShieldCheck className="h-3 w-3" /> QC Done
                              </span>
                            ) : flightQCState === "in-progress" ? (
                              <Button size="sm"
                                className="h-7 px-3 text-xs shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                                onClick={() => handleQCAction(flightGroup.flight)}>
                                <ShieldCheck className="h-3 w-3 mr-1" /> QC Passed
                              </Button>
                            ) : allPackagingDone ? (
                              <Button size="sm"
                                className="h-7 px-3 text-xs shrink-0 bg-violet-600 hover:bg-violet-700 text-white border-0"
                                onClick={() => handleInitiateQC(flightGroup.flight)}>
                                <ShieldCheck className="h-3 w-3 mr-1" /> Initiate QC
                              </Button>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">Pending</span>
                            )}
                          </td>
                          <td className="p-3 align-middle border-l border-border/20">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button
                                size="icon"
                                title="View"
                                aria-label="View"
                                className="h-7 w-7 bg-navy text-navy-foreground hover:opacity-90 shrink-0"
                                onClick={() => setViewPackagingRow(flightGroup.rows[0])}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              {flightQCState !== "done" && flightGroup.rows.some((r) => r.packagingStatus === "Ready for Packaging") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-3 text-xs shrink-0"
                                  onClick={() => setMaterialsRow(flightGroup.rows.find((r) => r.packagingStatus === "Ready for Packaging")!)}
                                >
                                  <Package className="h-3 w-3 mr-1" /> Initiate Packaging
                                </Button>
                              )}
                              {/* One combined Initiate Dispatch per dispatch — only
                                  on the first leg, only once EVERY leg passed QC. */}
                              {run.first && allLegsQcDone && runAnyNotDispatched && (
                                <Button
                                  size="sm"
                                  className="h-7 px-3 text-xs shrink-0 bg-gradient-to-r from-teal-500 to-cyan-600 text-white hover:from-teal-600 hover:to-cyan-700 border-0 shadow-sm"
                                  onClick={() => openWarningForDispatchRun(runFgs)}
                                  title={isRoundTrip ? "Dispatch both outbound & return together" : "Initiate dispatch"}
                                >
                                  <Truck className="h-3 w-3 mr-1" /> Initiate Dispatch{isRoundTrip ? " (Round Trip)" : ""}
                                </Button>
                              )}
                              {/* Returned from transfer-in-transit → allow re-dispatch,
                                  which re-runs the full packaging → QC → dispatch flow. */}
                              {run.first && isReturnedDispatch && (
                                <Button
                                  size="sm"
                                  className="h-7 px-3 text-xs shrink-0 bg-gradient-to-r from-rose-500 to-orange-500 text-white hover:from-rose-600 hover:to-orange-600 border-0 shadow-sm"
                                  onClick={() => reDispatchReturned(dspId!)}
                                  title="Re-run packaging, QC & dispatch for the returned load"
                                >
                                  <MoveRight className="h-3 w-3 mr-1" /> Re-dispatch
                                </Button>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-52">
                                  {flightGroup.rows.some((r) => r.packagingStatus === "Packaging In Progress") && (
                                    <>
                                      <DropdownMenuItem onClick={() => {
                                        const ids = new Set(flightGroup.rows.filter((r) => r.packagingStatus === "Packaging In Progress").map((r) => r.id));
                                        setPackagingRows((prev) => prev.map((r) => ids.has(r.id) ? { ...r, packagingStatus: "Packaging Done" as PackagingStatus } : r));
                                        toast.success(`Packaging done for flight ${flightGroup.flight}.`);
                                      }}>
                                        <CheckCircle2 className="h-4 w-4 mr-2" /> Mark Packaging Done
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                    </>
                                  )}
                                  <DropdownMenuItem onClick={() => toast.info(`Print Label for ${flightGroup.flight}`)}>
                                    Print Label
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setQcReport({ flight: flightGroup.flight, qcState: flightQCState, checkedAt: flightQCData?.qcCheckedAt })}>
                                    View QC Report
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })
            )}
          </table>
        </div>
      </div>


      {/* ── Dispatched Records Table ────────────────────────────────────────── */}
      {dispatchedFlightEntries.length > 0 && (
        <div className="rounded-lg border border-border bg-card shadow-sm mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
            <Truck className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-semibold text-slate-700">Dispatched Records</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {dispatchedFlightEntries.length} dispatch{dispatchedFlightEntries.length !== 1 ? "es" : ""}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="p-3 text-left font-semibold">Flight</th>
                  <th className="p-3 text-left font-semibold">Dep Time</th>
                  <th className="p-3 text-left font-semibold">Date</th>
                  <th className="p-3 text-right font-semibold">Total Qty</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                  <th className="p-3 text-left font-semibold">Dispatch Executive</th>
                  <th className="p-3 text-left font-semibold">Dispatched At</th>
                  <th className="p-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dispatchedFlightEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="p-3 font-semibold">{entry.flight}</td>
                    <td className="p-3 text-muted-foreground">{entry.depTime}</td>
                    <td className="p-3 text-muted-foreground">{entry.date}</td>
                    <td className="p-3 text-right font-medium">{entry.totalQty}</td>
                    <td className="p-3">
                      {entry.airportReceived ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                          Airport Received
                        </span>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                            Awaiting Airport Receipt
                          </span>
                          <Button
                            size="sm"
                            className="h-6 px-2.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                            onClick={() => {
                              setAirportReceiveTarget(entry);
                              setAptGateTemp(""); setAptUnloadTime(""); setAptRemarks("");
                            }}
                          >
                            <PlaneLanding className="h-3 w-3 mr-1" /> Airport Receive
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-sm">{entry.dispatchExecName}</td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {entry.dispatchedDate}, {entry.dispatchedTime}
                    </td>
                    <td className="p-3">
                      <Button
                        size="sm"
                        className="h-7 px-3 text-xs bg-navy text-navy-foreground hover:opacity-90"
                        onClick={() => setViewDispatchedEntry(entry)}
                      >
                        <Eye className="h-3 w-3 mr-1" /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          MODALS
      ════════════════════════════════════════════════════════════════════ */}

      {/* ── View Packaging Row Modal ────────────────────────────────────────── */}
      <Dialog open={!!viewPackagingRow} onOpenChange={(v) => !v && setViewPackagingRow(null)}>
        <DialogContent className="w-full max-w-full sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Order Details — {viewPackagingRow?.orderNo ?? viewPackagingRow?.flight}</DialogTitle>
          </DialogHeader>
          {viewPackagingRow && (() => {
            const v = viewPackagingRow;
            // Show the WHOLE order — every meal on this flight at this dep time —
            // not just the row whose View button was clicked.
            const orderRows = packagingRows.filter(
              (r) => r.flight === v.flight && r.depTime === v.depTime && r.date === v.date,
            );
            // Match by flight (reliable) rather than orderNo — seed packaging
            // order numbers can collide with unrelated real flight orders.
            const sector =
              flightOrders.find((o) => o.flight === v.flight)?.sector ??
              flights.find((f) => f.flight === v.flight)?.sector;
            const totalQty = orderRows.reduce((s, r) => s + r.qty, 0);
            // Mirror the list row's QC resolution: a flight cleared via Dispatch
            // Monitoring, HOC-approved, or already fully dispatched is QC-done,
            // even if no *local* QC toggle was recorded — otherwise the modal
            // would read "Pending" for a flight the row shows as done.
            const allDispatched = orderRows.length > 0 && orderRows.every((r) => r.packagingStatus === "Dispatched");
            const qs: QCState = getQcState(v.flight) === "done" || allDispatched ? "done" : (flightQCStates.get(v.flight)?.qcState ?? "not-started");
            const qcCheckedAt = qcClearedFlights[v.flight] ?? flightQCStates.get(v.flight)?.qcCheckedAt;
            return (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div><span className="text-muted-foreground">Flight:</span><span className="font-semibold ml-1">{v.flight}</span></div>
                  <div><span className="text-muted-foreground">Sector:</span><span className="font-semibold ml-1">{sector ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Order:</span><span className="font-semibold ml-1">{v.orderNo ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Dispatch Ref:</span><span className="font-semibold ml-1">{v.dspRef ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Dep Time:</span><span className="font-semibold ml-1">{v.depTime}</span></div>
                  <div><span className="text-muted-foreground">Date:</span><span className="font-semibold ml-1">{v.date}</span></div>
                </div>

                <div className="pt-2 border-t border-border flex gap-3 flex-wrap">
                  <div>
                    <span className="text-muted-foreground">Packaging:</span>
                    <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-semibold ${PACKAGING_BADGE[v.packagingStatus]}`}>{v.packagingStatus}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">QC:</span>
                    <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-semibold ${qs === "done" ? "bg-emerald-100 text-emerald-700" : qs === "in-progress" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                      {qs === "done" ? "QC Done" : qs === "in-progress" ? "QC In Progress" : "Pending"}
                    </span>
                  </div>
                  {qcCheckedAt && (
                    <div><span className="text-muted-foreground">QC at:</span><span className="font-semibold ml-1">{qcCheckedAt}</span></div>
                  )}
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Meals ({orderRows.length})</div>
                  <table className="w-full text-xs border border-slate-200 rounded-md overflow-hidden">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="p-2 text-left font-semibold">Production</th>
                        <th className="p-2 text-left font-semibold">Meal</th>
                        <th className="p-2 text-left font-semibold">Type</th>
                        <th className="p-2 text-right font-semibold">Qty</th>
                        <th className="p-2 text-left font-semibold">Warehouse</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderRows.map((r) => (
                        <tr key={r.id} className="border-t border-slate-100">
                          <td className="p-2 font-mono text-primary">{r.productionOrderId ?? "—"}</td>
                          <td className="p-2">{r.mealName}</td>
                          <td className="p-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${MEAL_TYPE_BADGE[r.mealType] ?? "bg-muted text-foreground"}`}>{r.mealType}</span></td>
                          <td className="p-2 text-right tabular-nums font-medium">{r.qty}</td>
                          <td className="p-2 text-muted-foreground">{r.section}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-300 bg-slate-50/80">
                        <td className="p-2 font-bold" colSpan={3}>Total</td>
                        <td className="p-2 text-right font-bold tabular-nums">{totalQty}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewPackagingRow(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Start Packaging Summary Modal ───────────────────────────────────── */}
      <Dialog open={!!materialsRow} onOpenChange={(v) => !v && setMaterialsRow(null)}>
        <DialogContent className="w-full max-w-full sm:max-w-2xl max-h-[100vh] sm:max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b shrink-0">
            <DialogTitle className="text-base font-semibold">
              Start Packaging — {materialsRow?.flight}
            </DialogTitle>
          </div>
          {materialsRow && (() => {
            // Full manifest for this flight/slot — every meal, whatever its status.
            const flightRows = packagingRows
              .filter((r) => r.flight === materialsRow.flight && r.depTime === materialsRow.depTime)
              .slice()
              .sort((a, b) =>
                (a.packagingStatus === "Ready for Packaging" ? 0 : 1) -
                (b.packagingStatus === "Ready for Packaging" ? 0 : 1));
            // Only the "Ready for Packaging" meals will actually be started.
            const readyRows = flightRows.filter((r) => r.packagingStatus === "Ready for Packaging");
            const unitsToStart = readyRows.reduce((s, r) => s + r.qty, 0);
            return (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                  <div className="flex gap-x-8 gap-y-2 text-sm flex-wrap">
                    <div>
                      <span className="text-muted-foreground">Flight:</span>
                      <span className="font-semibold ml-1">{materialsRow.flight}</span>
                    </div>
                    {materialsRow.orderNo && (
                      <div>
                        <span className="text-muted-foreground">Order:</span>
                        <span className="font-semibold ml-1 font-mono">{materialsRow.orderNo}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">Departure:</span>
                      <span className="font-semibold ml-1">{materialsRow.depTime}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">To start:</span>
                      <span className="font-semibold ml-1">{readyRows.length}</span>
                      <span className="text-muted-foreground ml-1">of {flightRows.length} meal{flightRows.length === 1 ? "" : "s"}</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                      Meals to Package
                    </div>
                    <div className="rounded-md border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 border-b border-border">
                          <tr>
                            <th className="p-2.5 text-left font-semibold">Meal</th>
                            <th className="p-2.5 text-left font-semibold w-28">Type</th>
                            <th className="p-2.5 text-left font-semibold w-36">Section</th>
                            <th className="p-2.5 text-left font-semibold w-40">Status</th>
                            <th className="p-2.5 text-right font-semibold w-24">Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {flightRows.map((r) => {
                            const ready = r.packagingStatus === "Ready for Packaging";
                            return (
                              <tr key={r.id} className={`border-t border-border/50 ${ready ? "" : "opacity-50"}`}>
                                <td className="p-2.5">
                                  <div className="flex items-center gap-2">
                                    <Package className={`h-4 w-4 shrink-0 ${ready ? "text-violet-500" : "text-muted-foreground"}`} />
                                    {r.mealName}
                                  </div>
                                </td>
                                <td className="p-2.5">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${MEAL_TYPE_BADGE[r.mealType] ?? "bg-muted text-foreground"}`}>
                                    {r.mealType}
                                  </span>
                                </td>
                                <td className="p-2.5 text-muted-foreground">{r.section}</td>
                                <td className="p-2.5">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PACKAGING_BADGE[r.packagingStatus] ?? "bg-muted text-foreground"}`}>
                                    {r.packagingStatus}
                                  </span>
                                </td>
                                <td className="p-2.5 text-right font-medium tabular-nums">{r.qty}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-border bg-muted/40">
                            <td className="p-2.5 font-semibold" colSpan={4}>Units to start packaging</td>
                            <td className="p-2.5 text-right font-semibold tabular-nums">{unitsToStart.toLocaleString()}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    {readyRows.length < flightRows.length && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Greyed-out meals are already in progress or done — only the{" "}
                        <strong className="text-foreground">{readyRows.length}</strong> meal{readyRows.length === 1 ? "" : "s"} marked{" "}
                        <span className="font-semibold text-amber-700">Ready for Packaging</span> will be started.
                      </p>
                    )}
                  </div>
                </div>
                <div className="px-6 py-4 border-t shrink-0 flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setMaterialsRow(null)}>Cancel</Button>
                  <Button
                    disabled={readyRows.length === 0}
                    onClick={() => handleConfirmMaterials(materialsRow)}
                  >
                    Confirm — Start Packaging
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Mark Ready for Dispatch Confirm Modal ────────────────────────────── */}
      <Dialog open={!!markReadyRow} onOpenChange={(v) => !v && setMarkReadyRow(null)}>
        <DialogContent className="w-full max-w-full sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark as Ready for Dispatch</DialogTitle>
          </DialogHeader>
          {markReadyRow && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              Confirm all <strong>{markReadyRow.qty}</strong> units of{" "}
              <strong>{markReadyRow.mealName}</strong> for flight{" "}
              <strong>{markReadyRow.flight}</strong> are packaged, labeled,
              and loaded onto the cart.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkReadyRow(null)}>Cancel</Button>
            <Button onClick={() => markReadyRow && handleMarkReadyForDispatch(markReadyRow)}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New Dispatch Config Modal ────────────────────────────────────────── */}
      <Dialog open={configOpen} onOpenChange={(v) => { setConfigOpen(v); if (!v) resetConfig(); }}>
        <DialogContent className="w-full max-w-full sm:max-w-2xl max-h-[100vh] sm:max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b shrink-0">
            <DialogTitle className="text-base font-semibold">Configure New Dispatch</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Pick a date and flight — sector, departure time, PAX, crew and meals auto-load from Order Management &amp; Menu Planning.</p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-semibold">Date</Label>
                <Input type="date" value={configDate} onChange={(e) => { setConfigDate(e.target.value); setConfigFlight(""); }} min={today} max={maxDate} className="h-9 mt-1" />
              </div>
              <div>
                <Label className="text-xs font-semibold">Select Flight</Label>
                <select
                  value={configFlight}
                  onChange={(e) => autoLoadFromFlight(e.target.value)}
                  className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Select flight —</option>
                  {orderFlightOptions.map((o) => {
                    const alreadyConfigured = configuredFlights.has(o.flight);
                    return (
                      <option key={o.id} value={o.flight} disabled={alreadyConfigured}>
                        {o.flight} · {o.sector}{alreadyConfigured ? " (Already configured)" : ""}
                      </option>
                    );
                  })}
                </select>
                {configDate && orderFlightOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">No flight orders on this date.</p>
                )}
              </div>
            </div>

            {/* Inventory warehouses — meals move From → To. On "Dispatched" a
                Transfer Note is raised between these into the Inventory module. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-semibold">From Office</Label>
                <select
                  value={configFromOffice}
                  onChange={(e) => changeFromOffice(e.target.value)}
                  className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {activeOffices.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                <Label className="text-xs font-semibold mt-2 block">From Warehouse</Label>
                <select
                  value={configFromWarehouse}
                  onChange={(e) => setConfigFromWarehouse(e.target.value)}
                  className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {activeWarehousesByOffice(configFromOffice).map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs font-semibold">To Office</Label>
                <select
                  value={configToOffice}
                  onChange={(e) => changeToOffice(e.target.value)}
                  className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {activeOffices.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                <Label className="text-xs font-semibold mt-2 block">To Warehouse</Label>
                <select
                  value={configToWarehouse}
                  onChange={(e) => setConfigToWarehouse(e.target.value)}
                  className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {activeWarehousesByOffice(configToOffice).map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                  ))}
                </select>
                {configFromWarehouse === configToWarehouse && (
                  <p className="text-xs text-amber-600 mt-1">From and to warehouse must be different.</p>
                )}
              </div>
            </div>

            {/* Auto-loaded order summary — one card per leg (Outbound first), so a
                bundled round trip shows BOTH sectors, each labelled by flight. */}
            {selectedOrder && summaryLegs.length > 0 && (
              <div className="space-y-2">
                {summaryLegs.map((l) => (
                  <div key={l.order.id} className="rounded-md border border-slate-200 bg-slate-50/70 p-3 text-xs">
                    <div className="mb-2 flex items-center gap-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${l.order.direction === "Return" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {l.order.direction}
                      </span>
                      <span className="font-semibold text-slate-700">{l.order.flight}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div><div className="text-muted-foreground">Sector</div><div className="font-semibold text-slate-700">{l.order.sector || "—"}</div></div>
                      <div><div className="text-muted-foreground">Departure (ETD)</div><div className="font-semibold text-slate-700">{l.order.etd}</div></div>
                      <div><div className="text-muted-foreground">PAX</div><div className="font-semibold text-slate-700">{l.order.pax}</div></div>
                      <div><div className="text-muted-foreground">Crew</div><div className="font-semibold text-slate-700">{l.order.crew}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Return-sector bundling — when the order has a paired return leg */}
            {selectedOrder && returnOrder && (
              <label className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50/60 p-3 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={includeReturn}
                  onChange={(e) => setIncludeReturn(e.target.checked)}
                />
                <span className="text-slate-700">
                  <span className="font-semibold">Dispatch the return sector together</span> — {returnOrder.flight} · {returnOrder.sector} · ETD {returnOrder.etd} · {returnOrder.pax} pax / {returnOrder.crew} crew.
                  Both legs go on one dispatch sheet with a combined summary.
                </span>
              </label>
            )}

            {/* Combined dispatch summary — outbound + return totals */}
            {configFlight && summaryLegs.length > 1 && (
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Dispatch Summary — Outbound + Return</div>
                <table className="w-full text-xs border border-slate-200 rounded-md overflow-hidden">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="p-2 text-left font-semibold">Leg</th>
                      <th className="p-2 text-center font-semibold w-20">PAX</th>
                      <th className="p-2 text-center font-semibold w-20">Crew</th>
                      <th className="p-2 text-center font-semibold w-20">Special</th>
                      <th className="p-2 text-center font-semibold w-28">Total Meals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryLegs.map((l) => (
                      <tr key={l.order.id} className="border-t border-slate-100">
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide mr-1.5 ${l.order.direction === "Return" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                            {l.order.direction}
                          </span>
                          <span className="font-medium text-slate-700">{l.order.flight} · {l.order.sector}</span>
                        </td>
                        <td className="p-2 text-center tabular-nums">{l.totals.pax}</td>
                        <td className="p-2 text-center tabular-nums">{l.totals.crew}</td>
                        <td className="p-2 text-center tabular-nums">{l.totals.special}</td>
                        <td className="p-2 text-center tabular-nums font-medium">{l.totals.meals}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-300 bg-slate-50/80 font-bold text-slate-800">
                      <td className="p-2">Total (both sectors)</td>
                      <td className="p-2 text-center tabular-nums">{grandTotals.pax}</td>
                      <td className="p-2 text-center tabular-nums">{grandTotals.crew}</td>
                      <td className="p-2 text-center tabular-nums">{grandTotals.special}</td>
                      <td className="p-2 text-center tabular-nums">{grandTotals.meals}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Production Entry linkup — produced meals for the selected flight.
                One dispatch bundles multiple orders/productions: PAX, Crew and
                Special each carry their own PRO number, tagged by audience. */}
            {configFlight && productionLines.length > 0 && (
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Production Status</div>
                <table className="w-full text-xs border border-slate-200 rounded-md overflow-hidden">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {summaryLegs.length > 1 && <th className="p-2 text-left font-semibold w-28">Leg</th>}
                      <th className="p-2 text-left font-semibold w-20">For</th>
                      <th className="p-2 text-left font-semibold">Production Order</th>
                      <th className="p-2 text-left font-semibold">Meal</th>
                      <th className="p-2 text-center font-semibold w-24">Required</th>
                      <th className="p-2 text-center font-semibold w-28">Batch Produced</th>
                      <th className="p-2 text-left font-semibold w-40">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionLines.map((p, idx) => (
                      <tr key={`${p.legFlight}-${p.audience}-${p.meal}-${idx}`} className="border-t border-slate-100">
                        {summaryLegs.length > 1 && (
                          <td className="p-2">
                            <div className="font-medium text-slate-700">{p.legFlight}</div>
                            <div className="text-[10px] text-muted-foreground">{p.legDirection}</div>
                          </td>
                        )}
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${p.audience === "PAX" ? "bg-indigo-100 text-indigo-700" : p.audience === "Crew" ? "bg-purple-100 text-purple-700" : "bg-teal-100 text-teal-700"}`}>
                            {p.audience}
                          </span>
                        </td>
                        <td className="p-2">
                          {p.proId ? (
                            <button
                              type="button"
                              className="font-mono font-semibold text-primary hover:underline"
                              title="Open Production Order"
                              onClick={() => {
                                flagArrival({ target: "production-list", ids: [p.proId!] });
                                navigate(`/production-entry?pro=${encodeURIComponent(p.proId!)}`);
                              }}
                            >
                              {p.proId}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2">{p.label}</td>
                        <td className="p-2 text-center tabular-nums font-medium">{p.needQty}</td>
                        <td className="p-2 text-center tabular-nums text-muted-foreground">{p.producedQty ?? "—"}</td>
                        <td className="p-2">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${p.status === "Completed" ? "bg-emerald-100 text-emerald-700" : p.status === "Ready for QC" ? "bg-amber-100 text-amber-700" : p.status === "Not in production" ? "bg-muted text-muted-foreground" : "bg-sky-100 text-sky-700"}`}>
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {productionReady ? (
                  <p className="text-[11px] font-medium text-emerald-700 mt-1.5">✓ All meals produced &amp; QC-passed — ready to dispatch.</p>
                ) : (
                  <p className="text-[11px] font-medium text-amber-600 mt-1.5">⚠ Not yet produced &amp; QC-passed: {blockingMeals.join(", ")}. You can still dispatch, but completing production &amp; QC first is recommended.</p>
                )}
              </div>
            )}

            {/* Meals — selected leg, plus the return leg when the round trip is
                bundled. Each leg is wrapped with its own direction-coded header
                and editable PAX/Crew/Special sections. */}
            {includeReturn && returnOrder ? (
              [
                {
                  flight: configFlight, sector: selectedSector, direction: selectedOrder?.direction ?? "Outbound",
                  paxLines: configPaxLines, setPaxLines: setConfigPaxLines,
                  crewMeals: configCrewMeals, setCrewMeals: setConfigCrewMeals,
                  specialMeals: configSpecialMeals, setSpecialMeals: setConfigSpecialMeals,
                },
                {
                  flight: returnOrder.flight, sector: returnOrder.sector, direction: returnOrder.direction,
                  paxLines: returnPaxLines, setPaxLines: setReturnPaxLines,
                  crewMeals: returnCrewMeals, setCrewMeals: setReturnCrewMeals,
                  specialMeals: returnSpecialMeals, setSpecialMeals: setReturnSpecialMeals,
                },
              ]
                .sort((a, b) => (a.direction === "Outbound" ? 0 : 1) - (b.direction === "Outbound" ? 0 : 1))
                .map((leg, idx) => (
                  <div key={leg.flight} className={idx === 0 ? "space-y-6" : "space-y-6 border-t border-dashed border-slate-300 pt-6"}>
                    {legHeader(leg.flight, leg.sector, leg.direction)}
                    {renderMealSections(
                      leg.paxLines, leg.setPaxLines,
                      leg.crewMeals, leg.setCrewMeals,
                      leg.specialMeals, leg.setSpecialMeals,
                    )}
                  </div>
                ))
            ) : (
              renderMealSections(
                configPaxLines, setConfigPaxLines,
                configCrewMeals, setConfigCrewMeals,
                configSpecialMeals, setConfigSpecialMeals,
              )
            )}

            {/* Additional Items */}
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Additional Items</div>
              <div className="space-y-2">
                {configAdditional.length === 0 && (
                  <p className="text-xs text-muted-foreground">No additional items added.</p>
                )}
                {configAdditional.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <Input
                      list="cfg-additional-list"
                      value={item.name}
                      onChange={(e) => setConfigAdditional((prev) => prev.map((a) => a.id === item.id ? { ...a, name: e.target.value } : a))}
                      placeholder="Item name"
                      className="h-8 flex-1 text-sm"
                    />
                    <datalist id="cfg-additional-list">
                      {ADDITIONAL_OPTIONS.map((opt) => <option key={opt} value={opt} />)}
                    </datalist>
                    <Input
                      type="number" min={0}
                      value={item.qty}
                      onChange={(e) => setConfigAdditional((prev) => prev.map((a) => a.id === item.id ? { ...a, qty: e.target.value } : a))}
                      placeholder="Qty"
                      className="h-8 w-24 text-sm text-center"
                    />
                    <button onClick={() => setConfigAdditional((prev) => prev.filter((a) => a.id !== item.id))} className="text-red-500 hover:text-red-700 text-lg leading-none">×</button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="text-xs no-brand"
                  onClick={() => setConfigAdditional((prev) => [...prev, { id: `a${Date.now()}`, name: "", qty: "" }])}>
                  + Add Item
                </Button>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t shrink-0 flex justify-between gap-2">
            <Button variant="outline" className="no-brand" onClick={() => { setConfigOpen(false); resetConfig(); }}>Cancel</Button>
            <Button onClick={handleConfigSave} disabled={!canSave} title={!productionReady ? "Some meals aren't produced & QC-passed yet — you can still dispatch, with a warning" : undefined}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── View / Trail Modal ───────────────────────────────────────────────── */}
      <Dialog open={!!viewRecord} onOpenChange={(v) => !v && setViewRecord(null)}>
        <DialogContent className="w-full max-w-full sm:max-w-md max-h-[100vh] sm:max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b shrink-0 pr-24">
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="text-base font-semibold">Dispatch Details — {viewRecord?.id}</DialogTitle>
                {viewRecord && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {viewRecord.flightNos.join(", ")} · {viewRecord.kitchenName} · Dep {viewRecord.depTime}
                  </p>
                )}
              </div>
              {viewRecord && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px] shrink-0"
                  onClick={() => downloadDispatchSheet(viewRecord)}
                >
                  <Download className="h-3 w-3 mr-1" /> PDF
                </Button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {viewRecord && (() => {
              const { detail, trail, notifiedAirport } = viewRecord;
              const bakeryTotal    = detail.bakery.reduce((s, b) => s + b.qty, 0);
              const amenitiesTotal = detail.amenities.reduce((s, a) => s + a.qty, 0);
              const fs = detail.foodSafety;
              // Flight Kitchen meals are derived from the packaging rows linked to
              // this dispatch (dspRef) — the same dataset shown in the table — rather
              // than a standalone figure stored on the record.
              const linkedRows = packagingRows.filter((r) => r.dspRef === viewRecord.id);
              const mealsTotal = linkedRows.reduce((s, r) => s + r.qty, 0);
              const impacts = recordImpacts(viewRecord);
              const dispatched = viewRecord.status === "Dispatched";
              return (
                <>
                  {impacts.length > 0 && (
                    <div className="rounded-lg border border-rose-300 bg-rose-50/70 px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-rose-700 font-semibold">
                        <AlertTriangle className="h-3.5 w-3.5" /> Order amended since this dispatch was built
                      </div>
                      <ul className="mt-1 space-y-0.5 text-xs text-rose-900">
                        {impacts.map((im) => (
                          <li key={im.flight} className="tabular-nums">
                            <span className="font-medium">{im.flight}</span> ·{" "}
                            {im.fields.map((f, i) => (
                              <span key={f.label}>
                                {i > 0 ? <span className="text-rose-400"> · </span> : null}
                                {f.label} <span className="line-through text-rose-400">{f.was}</span> → <span className="font-semibold">{f.now}</span>
                              </span>
                            ))}
                          </li>
                        ))}
                      </ul>
                      {dispatched ? (
                        <p className="mt-1.5 text-[11px] text-rose-700">Already dispatched — meals have left the kitchen. Coordinate a recall/top-up with the airport.</p>
                      ) : (
                        <Button size="sm" className="mt-2 h-7 px-2.5 text-xs" onClick={() => resyncRecord(viewRecord)}>
                          <ThermometerSun className="h-3 w-3 mr-1" /> Re-sync to current orders
                        </Button>
                      )}
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Status Trail</div>
                    <div className="space-y-3">
                      {trail.map((log, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <div className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${STATUS_DOT[log.status]}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${STATUS_BADGE[log.status]}`}>{log.status}</span>
                              <span className="text-xs text-muted-foreground">{log.date}, {log.time}</span>
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">By: {log.by}</div>
                            {log.status === "Dispatched" && (
                              <div className={`text-xs font-medium mt-0.5 ${notifiedAirport ? "text-emerald-600" : "text-slate-400"}`}>
                                Notified Airport Executive: {notifiedAirport ? "Yes" : "Pending"}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-border" />

                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                      <span className="font-semibold text-slate-700 normal-case tracking-normal">{mealsTotal.toLocaleString()} total meals</span>
                    </div>
                    {linkedRows.length === 0 ? (
                      <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">No linked packaging rows.</div>
                    ) : (() => {
                      // Group the meals per leg (Outbound / Return) so a round-trip
                      // dispatch reads as one sheet with both sectors clearly split.
                      const legGroups = viewRecord.flightNos
                        .map((flight) => {
                          const rows = linkedRows.filter((r) => r.flight === flight);
                          const order = flightOrders.find((o) => o.flight === flight && o.orderType !== "crew");
                          const direction: LegDirection = (order?.direction as LegDirection) ?? "Outbound";
                          return { flight, direction, rows, subtotal: rows.reduce((s, r) => s + r.qty, 0) };
                        })
                        .filter((g) => g.rows.length > 0);
                      return (
                        <div className="space-y-3">
                          {legGroups.map((g) => (
                            <div key={g.flight} className="rounded-lg border border-border overflow-hidden">
                              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                                <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${g.direction === "Return" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{g.direction}</span>
                                  {g.flight}
                                </span>
                                <span className="text-xs text-muted-foreground tabular-nums">{g.subtotal.toLocaleString()} meals</span>
                              </div>
                              {g.rows.map((r, i) => (
                                <div key={r.id} className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${i > 0 ? "border-t border-border" : ""}`}>
                                  <div className="min-w-0">
                                    <div className="text-slate-700 truncate">{r.mealName}</div>
                                    <div className="text-xs text-slate-400">{r.mealType} · {r.section}</div>
                                  </div>
                                  <span className="font-semibold shrink-0">{r.qty.toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {bakeryTotal > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                        <Croissant className="h-3.5 w-3.5" /> Bakery
                        <span className="ml-auto font-semibold text-slate-700 normal-case tracking-normal">{bakeryTotal.toLocaleString()} items</span>
                      </div>
                      <div className="rounded-lg border border-border overflow-hidden">
                        {detail.bakery.map((b, i) => (
                          <div key={i} className={`flex items-center justify-between px-3 py-2 text-sm ${i > 0 ? "border-t border-border" : ""}`}>
                            <span className="text-slate-700">{b.name}</span>
                            <span className="font-semibold">{b.qty.toLocaleString()} pcs</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {amenitiesTotal > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                        <Pill className="h-3.5 w-3.5" /> Amenities
                        <span className="ml-auto font-semibold text-slate-700 normal-case tracking-normal">{amenitiesTotal.toLocaleString()} units</span>
                      </div>
                      <div className="rounded-lg border border-border overflow-hidden">
                        {detail.amenities.map((a, i) => (
                          <div key={i} className={`flex items-center justify-between px-3 py-2 text-sm ${i > 0 ? "border-t border-border" : ""}`}>
                            <span className="text-slate-700">{a.label}</span>
                            <span className="font-semibold">{a.qty.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {fs.result !== "—" && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                        <ShieldCheck className="h-3.5 w-3.5" /> Food Safety &amp; QC
                        <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-semibold normal-case tracking-normal ${fs.result === "Passed" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                          {fs.result}
                        </span>
                      </div>
                      <div className="rounded-lg border border-border px-3 py-3 space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">Checked By</span>
                          <span className="font-semibold text-slate-700">{fs.checkedBy} (Hygiene Executive)</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">Date</span><span className="font-medium">{fs.date}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">Time</span><span className="font-medium">{fs.time}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          <div className="px-6 py-4 border-t shrink-0 flex justify-end">
            <Button onClick={() => setViewRecord(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dispatch Warning Modal ───────────────────────────────────────────── */}
      <Dialog open={warningOpen} onOpenChange={setWarningOpen}>
        <DialogContent className="w-full max-w-full sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Dispatch Warning
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 leading-relaxed">
            Each meal must be dispatched at least <strong>4–5 hours prior</strong> to the flight time.
            Ensure all meals are packed and sealed before initiating dispatch.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWarningOpen(false)}>Cancel</Button>
            <Button onClick={() => { setWarningOpen(false); setFormOpen(true); }}>OK, Proceed</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dispatch Form Modal ──────────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={(v) => { setFormOpen(v); if (!v) { setDispatched(false); setDeclared(false); } }}>
        <DialogContent className="w-full max-w-full sm:max-w-4xl max-h-[100vh] sm:max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b bg-slate-50 shrink-0">
            <div className="flex justify-end mb-1">
              <Button
                size="sm" variant="outline"
                onClick={() => { toast.info("Opening print / save-as-PDF dialog…"); window.print(); }}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> Download PDF
              </Button>
            </div>
            <div className="text-center mb-4">
              <div className="text-base font-bold uppercase tracking-widest text-slate-800">US-BANGLA AIRLINES</div>
              <div className="text-[11px] text-slate-500 mt-0.5">MADINA BHABAN, BAUNIA, BATTOLA, TURAG, DHAKA-1230</div>
              <div className="text-sm font-semibold text-slate-700 mt-2 border-t border-slate-200 pt-2">
                Meal Dispatch Check Sheet (International Flight)
              </div>
            </div>
            {(() => {
              // Production order numbers backing this dispatch — taken from the
              // packaging rows linked to the record.
              const productionNos = dispatchingRecord
                ? ([...new Set(
                    packagingRows
                      .filter((r) => r.dspRef === dispatchingRecord.id)
                      .map((r) => r.productionOrderId)
                      .filter(Boolean),
                  )] as string[])
                : [];
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Dispatch By</Label>
                    <div className="h-8 mt-1 rounded border border-input bg-slate-100 px-3 flex items-center text-sm font-semibold text-slate-700">
                      PRODUCTION
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Production No</Label>
                    <div className="min-h-8 mt-1 rounded border border-input bg-slate-100 px-3 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-mono text-slate-700">
                      {productionNos.length
                        ? productionNos.map((p) => <span key={p}>{p}</span>)
                        : <span className="text-slate-400 font-sans">—</span>}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Date</Label>
                    <Input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} className="h-8 mt-1 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Flight Dept Time (LT)</Label>
                    <Input value={flightDeptTime} onChange={(e) => setFlightDeptTime(e.target.value)} placeholder="10:00" className="h-8 mt-1 text-sm" />
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5 bg-white">
            {sections.map((sec, sIdx) => {
              const hotTotal = sec.paxLines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
              return (
                <div key={sIdx} className="rounded-lg border border-slate-200 overflow-hidden">
                  <div className="bg-slate-100 border-b border-slate-200 px-4 py-2.5 flex items-center gap-6 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">FLT. NO.</span>
                      <Input value={sec.flightNo} onChange={(e) => updateSection(sIdx, { flightNo: e.target.value })} className="h-7 w-28 text-sm font-bold" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Sector</span>
                      <Input value={sec.sector} onChange={(e) => updateSection(sIdx, { sector: e.target.value })} className="h-7 w-28 text-sm" />
                    </div>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
                      <div className="space-y-3">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">PAX Main Meal</div>
                        <table className="w-full text-xs border border-slate-200 rounded">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                              <th className="p-2 text-left font-semibold border-r border-slate-200">Item's Name</th>
                              <th className="p-2 text-center font-semibold border-r border-slate-200 w-16">%</th>
                              <th className="p-2 text-center font-semibold w-16">Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sec.paxLines.map((line, lIdx) => (
                              <tr key={lIdx} className="border-t border-slate-200">
                                <td className="p-1.5 border-r border-slate-200">
                                  <Input value={line.itemName} onChange={(e) => updatePaxLine(sIdx, lIdx, "itemName", e.target.value)} className="h-7 text-xs" />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <Input type="number" value={line.percent} onChange={(e) => updatePaxLine(sIdx, lIdx, "percent", Number(e.target.value))} className="h-7 text-xs text-center" />
                                </td>
                                <td className="p-1.5">
                                  <Input type="number" value={line.qty} onChange={(e) => updatePaxLine(sIdx, lIdx, "qty", Number(e.target.value))} className="h-7 text-xs text-center" />
                                </td>
                              </tr>
                            ))}
                            <tr className="border-t-2 border-slate-300 bg-slate-50/80">
                              <td className="p-2 font-bold text-xs border-r border-slate-200">Hot Meal Total</td>
                              <td className="border-r border-slate-200"></td>
                              <td className="p-2 text-center font-bold text-sm text-slate-800">{hotTotal}</td>
                            </tr>
                          </tbody>
                        </table>

                        {(() => {
                          // Only surface special-meal codes that actually have a
                          // quantity — zero codes are noise on the sheet.
                          const specials = ([["VGML", "vgml"], ["CHML", "chml"], ["SPML", "spml"]] as const)
                            .filter(([, field]) => (Number(sec[field]) || 0) > 0);
                          if (specials.length === 0) return null;
                          return (
                            <div className="flex items-center gap-4 px-3 py-2 rounded border border-slate-200 bg-slate-50/60 flex-wrap">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Special Meals</span>
                              <div className="flex gap-3 flex-wrap">
                                {specials.map(([label, field]) => (
                                  <div key={label} className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold text-slate-600">{label}</span>
                                    <Input type="number" value={sec[field] || ""} placeholder="0" onChange={(e) => updateSection(sIdx, { [field]: Number(e.target.value) })} className="h-7 w-14 text-xs text-center" />
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {(sec.pastry > 0 || sec.childMealsPastry > 0) && (
                          <div className="flex gap-6 flex-wrap">
                            {sec.pastry > 0 && (
                              <div className="flex items-center gap-2">
                                <Label className="text-xs font-semibold text-slate-600 whitespace-nowrap">Pastry for {sec.flightNo}</Label>
                                <Input type="number" value={sec.pastry} onChange={(e) => updateSection(sIdx, { pastry: Number(e.target.value) })} className="h-7 w-20 text-xs text-center" />
                              </div>
                            )}
                            {sec.childMealsPastry > 0 && (
                              <div className="flex items-center gap-2">
                                <Label className="text-xs font-semibold text-slate-600 whitespace-nowrap">Child Meals Pastry</Label>
                                <Input type="number" value={sec.childMealsPastry} onChange={(e) => updateSection(sIdx, { childMealsPastry: Number(e.target.value) })} className="h-7 w-20 text-xs text-center" />
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Crew Meal</div>
                        <div className="rounded border border-slate-200 overflow-hidden">
                          <div className="grid grid-cols-2 bg-slate-50 border-b border-slate-200">
                            <div className="p-2 text-xs font-semibold border-r border-slate-200">Type</div>
                            <div className="p-2 text-xs font-semibold text-center">Qty</div>
                          </div>
                          {sec.crewMeals.map((cm, cIdx) => (
                            <div key={cIdx} className="grid grid-cols-2 border-t border-slate-200">
                              <div className="p-1.5 border-r border-slate-200">
                                <Input value={cm.type} onChange={(e) => updateCrewMeal(sIdx, cIdx, "type", e.target.value)} className="h-7 text-xs" />
                              </div>
                              <div className="p-1.5">
                                <Input value={cm.qty} onChange={(e) => updateCrewMeal(sIdx, cIdx, "qty", e.target.value)} className="h-7 text-xs text-center" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                Additional Items
              </div>
              <div className="p-4 space-y-2">
                {dynamicItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <Input value={item.name} onChange={(e) => updateDynamic(item.id, "name", e.target.value)} placeholder="Item name (e.g. Garlic Toast)" className="h-8 text-xs flex-1" />
                    <Input type="number" value={item.qty} onChange={(e) => updateDynamic(item.id, "qty", e.target.value)} placeholder="Qty" className="h-8 text-xs w-24" />
                    {dynamicItems.length > 1 && (
                      <button type="button" onClick={() => removeDynamic(item.id)} className="text-red-500 hover:text-red-700 text-xl w-8 text-center leading-none flex-shrink-0">×</button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addDynamic} className="mt-1">+ Add Item</Button>
              </div>
            </div>

            {(() => {
              // Only render optional summary columns that at least one leg uses —
              // a column that's empty across every flight is dropped entirely.
              const showSpecial = sections.some((s) => ((Number(s.vgml) || 0) + (Number(s.chml) || 0) + (Number(s.spml) || 0)) > 0);
              const showPastry = sections.some((s) => (Number(s.pastry) || 0) > 0);
              const showChild = sections.some((s) => (Number(s.childMealsPastry) || 0) > 0);
              return (
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Summary</div>
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="p-2.5 text-left font-semibold border-r border-slate-200">Flight</th>
                        <th className="p-2.5 text-center font-semibold border-r border-slate-200">PAX Meals</th>
                        {showSpecial && <th className="p-2.5 text-center font-semibold border-r border-slate-200">Special Meals</th>}
                        {showPastry && <th className="p-2.5 text-center font-semibold border-r border-slate-200">Pastry</th>}
                        {showChild && <th className="p-2.5 text-center font-semibold">Child Meals</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {sections.map((s) => {
                        const tot = s.paxLines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
                        const special = (Number(s.vgml) || 0) + (Number(s.chml) || 0) + (Number(s.spml) || 0);
                        return (
                          <tr key={s.flightNo} className="border-t border-slate-200">
                            <td className="p-2.5 font-semibold border-r border-slate-200">{s.flightNo}</td>
                            <td className="p-2.5 text-center border-r border-slate-200">{tot || "—"}</td>
                            {showSpecial && (
                              <td className="p-2.5 text-center border-r border-slate-200">
                                {special > 0 ? (
                                  <>
                                    <div className="font-medium">{special}</div>
                                    {(() => {
                                      const parts = [
                                        s.vgml > 0 ? `VGML ${s.vgml}` : "",
                                        s.chml > 0 ? `CHML ${s.chml}` : "",
                                        s.spml > 0 ? `SPML ${s.spml}` : "",
                                      ].filter(Boolean);
                                      return <div className="text-[10px] text-slate-400">{parts.join(" · ")}</div>;
                                    })()}
                                  </>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            )}
                            {showPastry && <td className="p-2.5 text-center border-r border-slate-200">{s.pastry || "—"}</td>}
                            {showChild && <td className="p-2.5 text-center">{s.childMealsPastry || "—"}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                I hereby declare that Explosives, dangerous harmful and contraband items are not loaded in the catering van with food item.
              </p>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} className="h-4 w-4 accent-primary" />
                <span className="text-xs font-semibold text-slate-700">I confirm the above declaration</span>
              </label>
            </div>
          </div>

          <div className="px-6 py-4 border-t bg-white flex items-center justify-between shrink-0">
            <div className="text-xs text-muted-foreground">
              {dispatched && <span className="text-emerald-600 font-semibold">✓ Dispatch recorded successfully</span>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Close</Button>
              {!dispatched && (
                <Button
                  disabled={!declared}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40"
                  onClick={handleDispatch}
                >
                  <Truck className="h-4 w-4 mr-1" /> Dispatch
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Notify Confirmation ──────────────────────────────────────────────── */}
      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent className="w-full max-w-full sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-700">
              <Bell className="h-5 w-5 text-blue-500" /> Notification Sent
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 leading-relaxed">
            Airport Executive has been notified that the load has been dispatched from the kitchen and is on its way to the airport.
          </div>
          <DialogFooter>
            <Button onClick={handleNotify}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Airport Receive Dialog ───────────────────────────────────────────── */}
      <Dialog open={!!airportReceiveTarget} onOpenChange={(v) => !v && setAirportReceiveTarget(null)}>
        <DialogContent className="w-full max-w-full sm:max-w-5xl max-h-[100vh] sm:max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="px-6 pt-4 pb-3 border-b shrink-0 bg-slate-50">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <PlaneLanding className="h-4 w-4 text-emerald-600" />
              Airport Receipt — {airportReceiveTarget?.flight}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Catering point data (read-only) · Airport Point Receiving Entry
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {airportReceiveTarget && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-0 divide-y xl:divide-y-0 xl:divide-x divide-border h-full">

                {/* ── LEFT: Catering Point (read-only) ── */}
                <div className="p-5 space-y-4 pointer-events-none opacity-70 select-none">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-2 w-2 rounded-full bg-blue-600" />
                    <span className="text-xs font-bold uppercase tracking-widest text-blue-700">Catering Point Dispatch Entry</span>
                    <span className="ml-auto text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Read Only</span>
                  </div>
                  {airportReceiveTarget.sections.map((sec, i) => {
                    const hotTotal = sec.paxLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
                    return (
                      <div key={i} className="rounded-lg border border-slate-200 overflow-hidden text-sm">
                        <div className="bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 flex gap-4">
                          <span>Flight: {sec.flightNo}</span>
                          {sec.sector && <span>Sector: {sec.sector}</span>}
                        </div>
                        <div className="p-3 space-y-2">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">PAX Main Meal</div>
                          {sec.paxLines.map((l, li) => (
                            <div key={li} className="flex justify-between text-xs">
                              <span className="text-slate-600">{l.itemName || "—"}</span>
                              <span className="font-medium">{l.qty} ({l.percent}%)</span>
                            </div>
                          ))}
                          <div className="flex justify-between text-xs border-t border-slate-100 pt-1 font-semibold">
                            <span>Hot Meal Total</span><span>{hotTotal}</span>
                          </div>
                          <div className="flex gap-4 text-xs mt-1">
                            <span>VGML: <strong>{sec.vgml}</strong></span>
                            <span>CHML: <strong>{sec.chml}</strong></span>
                            <span>SPML: <strong>{sec.spml}</strong></span>
                          </div>
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2">Crew Meals</div>
                          {sec.crewMeals.map((cm, ci) => (
                            <div key={ci} className="flex justify-between text-xs">
                              <span className="text-slate-600">{cm.type}</span>
                              <span className="font-medium">{cm.qty}</span>
                            </div>
                          ))}
                          <div className="flex gap-4 text-xs mt-1">
                            <span>Pastry: <strong>{sec.pastry}</strong></span>
                            <span>Child Meals: <strong>{sec.childMealsPastry}</strong></span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {airportReceiveTarget.dynamicItems.length > 0 && (
                    <div className="rounded-lg border border-slate-200 overflow-hidden text-sm">
                      <div className="bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">Additional Items</div>
                      <div className="p-3 space-y-1">
                        {airportReceiveTarget.dynamicItems.map((item) => (
                          <div key={item.id} className="flex justify-between text-xs">
                            <span className="text-slate-600">{item.name}</span>
                            <span className="font-medium">{item.qty}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── RIGHT: Airport Point Receiving Entry ── */}
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-600" />
                    <span className="text-xs font-bold uppercase tracking-widest text-emerald-700">Airport Point Receiving Entry</span>
                    <span className="ml-auto text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Gate No. 08</span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-xs font-semibold">
                    <ThermometerSun className="h-4 w-4 text-amber-500 shrink-0" />
                    Max. Temp. Limit: +8°C — Cold chain integrity must be maintained
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Gate 08 Temp (°C)</Label>
                      <Input type="number" step="0.1" placeholder="e.g. 6.5" value={aptGateTemp}
                        onChange={(e) => setAptGateTemp(e.target.value)}
                        className={`mt-1 h-9 ${aptGateTemp !== "" && parseFloat(aptGateTemp) > 8 ? "border-red-400 bg-red-50" : ""}`} />
                      <p className="text-[11px] text-blue-600/80 mt-0.5 italic">Max: +8°C at gate</p>
                      {aptGateTemp !== "" && parseFloat(aptGateTemp) > 8 && (
                        <p className="text-xs text-red-600 mt-0.5 font-semibold">⚠ Exceeds +8°C</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">Time of Unloading</Label>
                      <Input type="time" value={aptUnloadTime} onChange={(e) => setAptUnloadTime(e.target.value)} className="mt-1 h-9" />
                      <p className="text-[11px] text-blue-600/80 mt-0.5 italic">Time when unloading begins at gate</p>
                    </div>
                  </div>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3.5">
                    <p className="text-xs font-bold text-emerald-800 flex items-center gap-1.5 mb-2">
                      <ShieldCheck className="h-3.5 w-3.5" /> Airport Receiving Protocol
                    </p>
                    <ul className="text-xs text-emerald-700 space-y-1">
                      <li className="flex items-start gap-1.5"><span className="text-emerald-500 mt-0.5">✔</span>Verify vehicle temperature at gate before unloading begins</li>
                      <li className="flex items-start gap-1.5"><span className="text-emerald-500 mt-0.5">✔</span>Check product seal integrity and packaging condition upon arrival</li>
                      <li className="flex items-start gap-1.5"><span className="text-emerald-500 mt-0.5">✔</span>Record unloading time accurately in the system</li>
                      <li className="flex items-start gap-1.5"><span className="text-emerald-500 mt-0.5">✔</span>APT executive must physically verify and countersign</li>
                      <li className="flex items-start gap-1.5"><span className="text-emerald-500 mt-0.5">✔</span>Any temperature breach must be escalated immediately</li>
                    </ul>
                  </div>
                  <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-3.5 space-y-3">
                    <p className="text-[11px] text-emerald-700 font-bold flex items-center gap-1.5">
                      <PlaneLanding className="h-3.5 w-3.5" /> Received By (Airport Catering)
                    </p>
                    <p className="text-[11px] text-slate-400 italic flex items-center gap-1">
                      <User className="h-3 w-3" /> Name &amp; designation auto-filled by system
                    </p>
                    <div>
                      <Label className="text-xs">Remarks</Label>
                      <Textarea
                        value={aptRemarks}
                        onChange={(e) => setAptRemarks(e.target.value)}
                        placeholder="Remarks by receiving officer..."
                        className="mt-1 min-h-[60px] text-xs resize-none"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Date &amp; time auto-recorded on accept
                      </p>
                      <Button
                        size="sm"
                        className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0 px-4"
                        onClick={() => {
                          setDispatchedFlightEntries((prev) =>
                            prev.map((e) => e.id === airportReceiveTarget.id ? { ...e, airportReceived: true } : e)
                          );
                          toast.success(`Airport receipt accepted — ${airportReceiveTarget.flight}`);
                          setAirportReceiveTarget(null);
                        }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Save And Accept
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="px-6 py-3 border-t shrink-0 flex justify-end bg-slate-50">
            <Button variant="outline" onClick={() => setAirportReceiveTarget(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── View Dispatched Entry Modal ──────────────────────────────────────── */}
      <Dialog open={!!viewDispatchedEntry} onOpenChange={(v) => !v && setViewDispatchedEntry(null)}>
        <DialogContent className="w-full max-w-full sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Dispatch Details — {viewDispatchedEntry?.flight}</DialogTitle>
          </DialogHeader>
          {viewDispatchedEntry && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <span className="text-xs text-muted-foreground">Flight</span>
                  <div className="font-semibold mt-0.5">{viewDispatchedEntry.flight}</div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Dep Time</span>
                  <div className="font-semibold mt-0.5">{viewDispatchedEntry.depTime}</div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Date</span>
                  <div className="font-medium mt-0.5">{viewDispatchedEntry.date}</div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Total Qty</span>
                  <div className="font-semibold mt-0.5">{viewDispatchedEntry.totalQty} units</div>
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <div className="mt-0.5">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Dispatched</span>
                  </div>
                </div>
              </div>
              <div className="border-t border-border pt-3 space-y-2.5">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Dispatch Info</div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Dispatch Executive</span>
                  <span className="font-semibold">{viewDispatchedEntry.dispatchExecName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium">{viewDispatchedEntry.dispatchedDate}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Time</span>
                  <span className="font-medium">{viewDispatchedEntry.dispatchedTime}</span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDispatchedEntry(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── QC Report Modal ──────────────────────────────────────────────────── */}
      <Dialog open={!!qcReport} onOpenChange={(v) => !v && setQcReport(null)}>
        <DialogContent className="w-full max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              QC Report — {qcReport?.flight}
              {qcReport && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                  qcReport.qcState === "done" ? "bg-emerald-100 text-emerald-700"
                  : qcReport.qcState === "in-progress" ? "bg-amber-100 text-amber-700"
                  : "bg-slate-100 text-slate-600"}`}>
                  {qcReport.qcState === "done" ? "QC Done" : qcReport.qcState === "in-progress" ? "In Progress" : "Not Started"}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {qcReport && (() => {
            // QC Report is sourced ONLY from real cold-chain QC records — the
            // Dispatch Monitoring sheet (sessionStorage) or the workflow store's
            // dispatch-approval record for this flight. No seed/fabricated data.
            let dmEntries: DmSheetEntry[] = [];
            try { const s = sessionStorage.getItem("dm_entries"); if (s) dmEntries = JSON.parse(s) as DmSheetEntry[]; } catch { /* ignore */ }
            const sheet = dmEntries.find((e) => e.flightId === qcReport.flight);
            const approval = dispatchApprovals.find((a) => a.flightId === qcReport.flight);
            const dm: DmSheetEntry | undefined = sheet ?? (approval ? {
              flightId: approval.flightId,
              vehicleNo: approval.vehicleNo,
              vehicleClean: approval.vehicleClean,
              chilledTemp: approval.chilledTemp,
              frozenTemp: approval.frozenTemp,
              loadStartTime: approval.loadStartTime,
              loadEndTime: approval.loadEndTime,
              vehicleTempBegin: approval.vehicleTempBegin,
              vehicleTempEnd: approval.vehicleTempEnd,
              resultSatisfy: approval.resultSatisfy,
              monitoredByRemarks: approval.verifiedByRemarks,
              monitoredAt: [approval.verifiedByDate, approval.verifiedByTime].filter(Boolean).join(", "),
              approvalStage: approval.stage === "forwarded_to_airport" ? 4 : approval.stage === "hoc_approved" ? 3 : 2,
              verifiedBy: { date: approval.verifiedByDate, time: approval.verifiedByTime, remarks: approval.verifiedByRemarks },
              approvedBy: approval.approvedBy ? { name: approval.approvedBy, date: approval.approvedAt ?? "", time: "", remarks: "" } : undefined,
              forwardedToAirportAt: approval.forwardedAt,
            } : undefined);

            const chilledOOR = (v?: string) => { const n = parseFloat(v ?? ""); return !!v && !isNaN(n) && (n < 1 || n > 4); };
            const frozenOOR = (v?: string) => { const n = parseFloat(v ?? ""); return !!v && !isNaN(n) && (n < -12 || n > -8); };
            const vehOOR = (v?: string) => { const n = parseFloat(v ?? ""); return !!v && !isNaN(n) && n > 8; };
            const temp = (v?: string, oor?: boolean) =>
              v ? <span className={oor ? "text-red-600 font-semibold" : "font-medium"}>{v}°C</span> : <span className="text-muted-foreground">—</span>;
            const sectionLabel = "text-[10px] font-bold uppercase tracking-widest text-blue-600 mb-2 mt-1 border-t border-blue-100 pt-3";
            const fieldK = "text-[11px] uppercase tracking-wider text-muted-foreground";

            // No cold-chain QC record exists for this flight yet — show the QC
            // workflow status only (no fabricated parameters).
            if (!dm) {
              const qcDone = qcReport.qcState === "done";
              return (
                <div className="space-y-3">
                  {qcReport.checkedAt && (
                    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                      <span className={fieldK}>QC cleared at</span>
                      <span className="font-medium ml-2">{qcReport.checkedAt}</span>
                    </div>
                  )}
                  <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                    {qcDone
                      ? "QC is cleared for this flight. The detailed cold-chain monitoring sheet (vehicle & product temperatures, verification & approval) will appear here once Food Safety records it on the Dispatch Monitoring page."
                      : "QC has not been completed for this flight yet."}
                  </div>
                </div>
              );
            }

            const stage = dm.approvalStage ?? 0;
            const monStatus = dm.receivedAt ? { label: "Received by Airport", cls: "bg-emerald-100 text-emerald-700" }
              : stage >= 3 ? { label: "Forwarded to Airport", cls: "bg-blue-100 text-blue-700" }
              : stage >= 2 ? { label: "Verified", cls: "bg-amber-100 text-amber-700" }
              : { label: "Pending", cls: "bg-slate-100 text-slate-500" };

            return (
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${monStatus.cls}`}>{monStatus.label}</span>
                  {dm.monitoredAt && <span className="text-xs text-muted-foreground">Monitored at {dm.monitoredAt}</span>}
                </div>

                {/* Vehicle & Hygiene */}
                <div className={sectionLabel}>Vehicle &amp; Hygiene</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><div className={fieldK}>Vehicle No.</div><div className="font-medium mt-0.5">{dm.vehicleNo || "—"}</div></div>
                  <div><div className={fieldK}>Vehicle Clean</div><div className="mt-0.5">{dm.vehicleClean ? <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${dm.vehicleClean === "Yes" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>{dm.vehicleClean}</span> : "—"}</div></div>
                </div>

                {/* Product Core Temperature */}
                <div className={sectionLabel}>Product Core Temperature</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><div className={fieldK}>Chilled Temp</div><div className="mt-0.5">{temp(dm.chilledTemp, chilledOOR(dm.chilledTemp))}{chilledOOR(dm.chilledTemp) && <span className="text-red-600 text-[11px] ml-1">⚠ out of range</span>}</div></div>
                  <div><div className={fieldK}>Frozen Temp</div><div className="mt-0.5">{temp(dm.frozenTemp, frozenOOR(dm.frozenTemp))}{frozenOOR(dm.frozenTemp) && <span className="text-red-600 text-[11px] ml-1">⚠ out of range</span>}</div></div>
                </div>

                {/* Loading & Vehicle Temperature */}
                <div className={sectionLabel}>Loading Times &amp; Vehicle Temperature</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><div className={fieldK}>Load Start</div><div className="font-medium mt-0.5 tabular-nums">{dm.loadStartTime || "—"}</div></div>
                  <div><div className={fieldK}>Load End</div><div className="font-medium mt-0.5 tabular-nums">{dm.loadEndTime || "—"}</div></div>
                  <div><div className={fieldK}>Veh. Temp Begin</div><div className="mt-0.5">{temp(dm.vehicleTempBegin, vehOOR(dm.vehicleTempBegin))}</div></div>
                  <div><div className={fieldK}>Veh. Temp End</div><div className="mt-0.5">{temp(dm.vehicleTempEnd, vehOOR(dm.vehicleTempEnd))}</div></div>
                </div>

                {/* Result */}
                <div className={sectionLabel}>Result Check</div>
                <div className="text-sm">
                  <div className={fieldK}>Result Satisfy</div>
                  <div className="mt-0.5">{dm.resultSatisfy ? <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${dm.resultSatisfy === "Yes" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>{dm.resultSatisfy}</span> : "—"}</div>
                  {dm.monitoredByRemarks && <p className="text-xs text-muted-foreground italic mt-1.5">Remarks: {dm.monitoredByRemarks}</p>}
                </div>

                {/* Approval Trail */}
                <div className={sectionLabel}>Verification &amp; Approval Trail</div>
                <div className="space-y-2 text-sm">
                  <div className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">① Verified — Food Safety &amp; Hygiene</span>
                      {stage >= 2 ? <span className="text-xs text-emerald-700">{dm.verifiedBy?.date} {dm.verifiedBy?.time}</span> : <span className="text-xs text-muted-foreground">Pending</span>}
                    </div>
                    {dm.verifiedBy?.remarks && <p className="text-xs text-muted-foreground italic mt-1">{dm.verifiedBy.remarks}</p>}
                  </div>
                  <div className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">② Approved — Head of Catering</span>
                      {stage >= 3 ? <span className="text-xs text-emerald-700">{dm.approvedBy?.date} {dm.approvedBy?.time}</span> : <span className="text-xs text-muted-foreground">Pending</span>}
                    </div>
                    {dm.approvedBy?.remarks && <p className="text-xs text-muted-foreground italic mt-1">{dm.approvedBy.remarks}</p>}
                  </div>
                  {dm.receivedAt && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">③ Received by Airport — {dm.receivedBy || "—"}</span>
                        <span className="text-xs text-emerald-700">{dm.receivedAt}</span>
                      </div>
                      {dm.receivedRemarks && <p className="text-xs text-muted-foreground italic mt-1">{dm.receivedRemarks}</p>}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setQcReport(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
