import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Truck, Package, Plus, AlertTriangle, Bell, MoreHorizontal,
  Eye, Croissant, Pill, ChefHat, ShieldCheck, Download,
  CheckCircle2, AlertCircle,
} from "lucide-react";
import { flights } from "@/lib/sample-data";
import { KpiCard } from "@/components/common/KpiCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useArrivalFlash } from "@/lib/arrival-flash";

// ─── Types ───────────────────────────────────────────────────────────────────

type DispatchStatus = "Preparing" | "Prepared" | "Ready For QC" | "Ready For Dispatch" | "Dispatched";

type StatusLog = { status: DispatchStatus; by: string; date: string; time: string };

type DispatchDetail = {
  flightKitchen: { name: string; totalMeals: number; lunch: number; breakfast: number };
  bakery: { name: string; qty: number }[];
  amenities: { label: string; qty: number }[];
  foodSafety: { result: "Passed" | "Failed" | "—"; checkedBy: string; date: string; time: string };
};

type PaxLine = { itemName: string; percent: number; qty: number };
type CrewMealLine = { type: string; qty: string };
type DynamicItem = { id: string; name: string; qty: string };

type FlightSection = {
  flightNo: string; sector: string;
  paxLines: PaxLine[];
  vgml: number; chml: number; spml: number;
  crewMeals: CrewMealLine[];
  pastry: number; childMealsPastry: number;
};

type DispatchRecord = {
  id: string;
  date: string;
  depTime: string;
  kitchenName: string;
  flightNos: string[];
  status: DispatchStatus;
  trail: StatusLog[];
  dispatchedBy?: string;
  notifiedAirport?: boolean;
  detail: DispatchDetail;
  sections: FlightSection[];
  dynamicItems: DynamicItem[];
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
  | "Ready for Dispatch";

type QCState = "not-started" | "in-progress" | "done";

type PackagingRow = {
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

type FlightGroup = { flight: string; rows: PackagingRow[] };
type DepTimeGroup = { depTime: string; flightGroups: FlightGroup[] };

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
};

// ─── Constants ───────────────────────────────────────────────────────────────

const PAX_MEAL_OPTIONS   = ["PBDR", "JPCV", "JPBD", "VRSCV", "CHRS", "BDBR", "SFBD", "HNML"];
const CREW_MEAL_TYPES    = ["Breakfast", "Lunch", "Dinner", "Light Snacks", "Fruit", "Beverages"];
const SPECIAL_MEAL_TYPES = ["VGML", "CHML", "SPML", "HNML", "LCML", "DBML", "BLML", "KSML"];
const ADDITIONAL_OPTIONS = ["Garlic Toast", "Soft Bun & Croissant", "Fruit Platter", "Mineral Water", "Juice Pack", "Date Cake", "Nuts & Seeds"];

const STATUS_BADGE: Record<DispatchStatus, string> = {
  "Preparing":          "bg-slate-100 text-slate-600",
  "Prepared":           "bg-blue-100 text-blue-700",
  "Ready For QC":       "bg-amber-100 text-amber-700",
  "Ready For Dispatch": "bg-violet-100 text-violet-700",
  "Dispatched":         "bg-emerald-100 text-emerald-700",
};
const STATUS_DOT: Record<DispatchStatus, string> = {
  "Preparing":          "bg-slate-400",
  "Prepared":           "bg-blue-500",
  "Ready For QC":       "bg-amber-500",
  "Ready For Dispatch": "bg-violet-500",
  "Dispatched":         "bg-emerald-500",
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

const FLIGHT_STATUS_BADGE: Record<string, string> = {
  "Packaging Pending":     "bg-amber-100 text-amber-700",
  "Packaging In Progress": "bg-blue-100 text-blue-700",
  "Packaging Done":        "bg-teal-100 text-teal-700",
  "QC In Progress":        "bg-violet-100 text-violet-700",
  "Ready for Dispatch":    "bg-emerald-100 text-emerald-700",
};

function getFlightStatus(rows: PackagingRow[], qcState: QCState): string {
  if (qcState === "done") return "Ready for Dispatch";
  if (qcState === "in-progress") return "QC In Progress";
  if (rows.every((r) => r.packagingStatus === "Packaging Done" || r.packagingStatus === "Ready for Dispatch")) return "Packaging Done";
  if (rows.some((r) => r.packagingStatus === "Packaging In Progress")) return "Packaging In Progress";
  return "Packaging Pending";
}

const MATERIAL_NAMES = [
  "Passenger tray", "Crew tray", "Main course container",
  "Bread roll wrapper", "Dessert cup", "Cutlery set", "Tray liner", "Cart label",
];
const MATERIAL_BUFFERS = [24, 18, 32, 40, 15, 28, 36, 20];

function getMaterials(qty: number) {
  const req = Math.ceil(qty * 1.05);
  return MATERIAL_NAMES.map((name, i) => ({
    name,
    required: req,
    available: req + MATERIAL_BUFFERS[i],
  }));
}

// ─── Packaging Seed Data ─────────────────────────────────────────────────────

const TODAY = "2026-05-18";

const INITIAL_PACKAGING_ROWS: PackagingRow[] = [
  { id: "PRD-9006", date: TODAY, depTime: "7:00 AM", flight: "BS-225", mealType: "Snack",     mealName: "Heavy Snack Box",        qty: 174, section: "Cold Kitchen",   packagingStatus: "Packaging In Progress", dspRef: "DSP-7704", orderNo: "ORD-3420", productionOrderId: "PRO-2026-100601" },
  { id: "PRD-9001", date: TODAY, depTime: "7:00 AM", flight: "BS-225", mealType: "Lunch",     mealName: "Chicken Biryani",         qty: 168, section: "Hot Kitchen",    packagingStatus: "Ready for Packaging",   dspRef: "DSP-7704", orderNo: "ORD-3420", productionOrderId: "PRO-2026-100602" },
  { id: "PRD-9002", date: TODAY, depTime: "7:00 AM", flight: "BS-225", mealType: "Snack",     mealName: "Veg Pulao",               qty: 24,  section: "Veg Section",    packagingStatus: "Packaging In Progress", dspRef: "DSP-7704", orderNo: "ORD-3420", productionOrderId: "PRO-2026-100603" },
  { id: "PRD-9002B",date: TODAY, depTime: "7:00 AM", flight: "BS-203", mealType: "Snack",     mealName: "Veg Pulao",               qty: 24,  section: "Veg Section",    packagingStatus: "Packaging In Progress", dspRef: "DSP-7702", orderNo: "ORD-3414", productionOrderId: "PRO-2026-100603" },
  { id: "PRD-9003", date: TODAY, depTime: "8:30 AM", flight: "BS-307", mealType: "Dinner",    mealName: "Grilled Salmon",          qty: 282, section: "Hot Kitchen",    packagingStatus: "Packaging In Progress",                     orderNo: "ORD-3415", productionOrderId: "PRO-2026-100604" },
  { id: "PRD-9004", date: TODAY, depTime: "8:30 AM", flight: "BS-307", mealType: "Breakfast", mealName: "Continental Breakfast",   qty: 282, section: "Cold Kitchen",   packagingStatus: "Packaging Done",                            orderNo: "ORD-3415", productionOrderId: "PRO-2026-100605" },
  { id: "PRD-9005", date: TODAY, depTime: "9:00 AM", flight: "BS-101", mealType: "Special",   mealName: "Hindu Meal Special",      qty: 8,   section: "Special Meal",   packagingStatus: "Packaging Done",        dspRef: "DSP-7701", orderNo: "ORD-3422", productionOrderId: "PRO-2026-100606" },
];

// ─── Dispatch Seed Data ───────────────────────────────────────────────────────

const INITIAL_RECORDS: DispatchRecord[] = [
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
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function Dispatch() {
  useArrivalFlash();
  const navigate = useNavigate();
  // ── Dispatch records state ──────────────────────────────────────────────────
  const [records, setRecords] = useState<DispatchRecord[]>(INITIAL_RECORDS);
  const [configuredFlights, setConfiguredFlights] = useState<Set<string>>(
    new Set(INITIAL_RECORDS.flatMap((r) => r.flightNos))
  );

  // ── Packaging pipeline state ────────────────────────────────────────────────
  const [packagingRows, setPackagingRows] = useState<PackagingRow[]>(INITIAL_PACKAGING_ROWS);
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

  // ── New Dispatch Config modal ───────────────────────────────────────────────
  const [configOpen, setConfigOpen]         = useState(false);
  const [configDate, setConfigDate]         = useState("");
  const [configDepTime, setConfigDepTime]   = useState("");
  const [configFlight, setConfigFlight]     = useState("");
  const [configPaxLines, setConfigPaxLines] = useState<CfgPaxLine[]>([
    { id: "p1", itemName: "", percent: 60, qty: 0 },
    { id: "p2", itemName: "", percent: 40, qty: 0 },
  ]);
  const [configCrewMeals, setConfigCrewMeals]       = useState<CfgCrewMeal[]>([{ id: "c1", type: "Breakfast", qty: "" }]);
  const [configSpecialMeals, setConfigSpecialMeals] = useState<CfgSpecialMeal[]>([]);
  const [configAdditional, setConfigAdditional]     = useState<CfgAdditional[]>([]);

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

  const distinctDepTimes = useMemo(
    () => [...new Set(flights.map((f) => f.dep))].sort(),
    []
  );
  const availableFlights = useMemo(
    () => flights.filter((f) => f.dep === configDepTime),
    [configDepTime]
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
    () => flights.find((f) => f.flight === configFlight)?.sector ?? "",
    [configFlight]
  );

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

  // ── DSP aggregate recalculation ─────────────────────────────────────────────

  const recalcDSP = (rows: PackagingRow[], dspId: string) => {
    const linked = rows.filter((r) => r.dspRef === dspId);
    if (linked.length === 0) return;
    const allReady = linked.every((r) => r.packagingStatus === "Ready for Dispatch");
    const allDone  = linked.every((r) =>
      r.packagingStatus === "Packaging Done" || r.packagingStatus === "Ready for Dispatch"
    );
    const newStatus: DispatchStatus = allReady ? "Ready For Dispatch" : allDone ? "Prepared" : "Preparing";
    setRecords((prev) => prev.map((r) => (r.id === dspId ? { ...r, status: newStatus } : r)));
  };

  // ── Packaging handlers ──────────────────────────────────────────────────────

  const handleConfirmMaterials = (row: PackagingRow) => {
    const updated = packagingRows.map((r) =>
      r.id === row.id ? { ...r, packagingStatus: "Packaging In Progress" as PackagingStatus } : r
    );
    setPackagingRows(updated);
    if (row.dspRef) recalcDSP(updated, row.dspRef);
    setMaterialsRow(null);
    toast.success(`${row.id} — materials confirmed. Packaging In Progress.`);
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
      toast.info(`QC started for flight ${flight}.`);
    } else if (current.qcState === "in-progress") {
      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
      setFlightQCStates((prev) => new Map(prev).set(flight, { qcState: "done", qcCheckedAt: timeStr }));
      const dspRef = packagingRows.find((r) => r.flight === flight)?.dspRef;
      if (dspRef) setRecords((prev) => prev.map((r) => r.id === dspRef ? { ...r, status: "Ready For Dispatch" as DispatchStatus } : r));
      toast.success(`QC Done for flight ${flight}. Status → Ready for Dispatch.`);
    }
  };

  const openWarningForFlightGroup = (fg: FlightGroup) => {
    const firstRow = fg.rows[0];
    if (!firstRow) return;
    const dspRef = firstRow.dspRef;
    const existing = dspRef ? records.find((r) => r.id === dspRef) : undefined;
    const totalQty = fg.rows.reduce((sum, r) => sum + r.qty, 0);
    const rec: DispatchRecord = existing ?? {
      id: `DSP-${fg.flight}`,
      date: firstRow.date,
      depTime: firstRow.depTime,
      kitchenName: firstRow.section,
      flightNos: [fg.flight],
      status: "Ready For Dispatch",
      trail: [],
      detail: {
        flightKitchen: { name: firstRow.section, totalMeals: totalQty, lunch: 0, breakfast: 0 },
        bakery: [],
        amenities: [],
        foodSafety: { result: "—", checkedBy: "", date: "", time: "" },
      },
      sections: [{
        flightNo: fg.flight,
        sector: "",
        paxLines: [{ itemName: "PBDR", percent: 100, qty: totalQty }],
        vgml: 0, chml: 0, spml: 0,
        crewMeals: [],
        pastry: 0,
        childMealsPastry: 0,
      }],
      dynamicItems: [],
    };
    openWarning(rec);
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
  };

  const resetConfig = () => {
    setConfigDate("");
    setConfigDepTime("");
    setConfigAdditional([]);
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

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });

    const specialByCode = (code: string) =>
      configSpecialMeals.filter((m) => m.type === code).reduce((acc, m) => acc + (Number(m.qty) || 0), 0);

    const newSection: FlightSection = {
      flightNo: configFlight,
      sector: selectedSector,
      paxLines: configPaxLines.map(({ itemName, percent, qty }) => ({ itemName, percent, qty })),
      vgml: specialByCode("VGML"),
      chml: specialByCode("CHML"),
      spml: specialByCode("SPML"),
      crewMeals: configCrewMeals.map(({ type, qty }) => ({ type, qty })),
      pastry: 0,
      childMealsPastry: 0,
    };

    const hotTotal = configPaxLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    const existingRec = records.find((r) => r.date === configDate && r.depTime === configDepTime);

    if (existingRec) {
      setRecords((prev) =>
        prev.map((r) =>
          r.id === existingRec.id
            ? {
                ...r,
                flightNos: [...r.flightNos, configFlight],
                sections: [...r.sections, newSection],
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
      toast.success(`${configFlight} added to dispatch ${existingRec.id} (dep ${configDepTime}).`);
    } else {
      const newRec: DispatchRecord = {
        id: `DSP-${Date.now().toString().slice(-4)}`,
        date: configDate,
        depTime: configDepTime,
        kitchenName: "Flight Kitchen A",
        flightNos: [configFlight],
        status: "Preparing",
        trail: [{ status: "Preparing", by: "System", date: dateStr, time: timeStr }],
        detail: {
          flightKitchen: { name: "Flight Kitchen A", totalMeals: hotTotal, lunch: Math.floor(hotTotal * 0.6), breakfast: Math.floor(hotTotal * 0.4) },
          bakery: [],
          amenities: configAdditional.filter((a) => a.name).map((a) => ({ label: a.name, qty: Number(a.qty) || 0 })),
          foodSafety: { result: "—", checkedBy: "—", date: "—", time: "—" },
        },
        sections: [newSection],
        dynamicItems: configAdditional.map((a) => ({ id: a.id, name: a.name, qty: a.qty })),
      };
      setRecords((prev) => [...prev, newRec]);
      toast.success(`Dispatch configured for ${configFlight} departing ${configDepTime}.`);
    }

    setConfiguredFlights((prev) => new Set([...prev, configFlight]));
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
      }));
      setDispatchedFlightEntries((prev) => [...prev, ...newEntries]);
      const dispatchedFlightSet = new Set(dispatchingRecord.flightNos);
      setPackagingRows((prev) => prev.filter((r) => !dispatchedFlightSet.has(r.flight)));
    }
    setDispatched(true);
    toast.success("Dispatch initiated successfully.");
  };

  const handleNotify = () => {
    setRecords((prev) =>
      prev.map((r) => (r.id === dispatchingRecord?.id ? { ...r, notifiedAirport: true } : r))
    );
    setNotifyOpen(false);
    setFormOpen(false);
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
        <KpiCard label="Active Dispatches" value={records.filter((r) => r.status !== "Dispatched").length} icon={Truck} tone="navy" />
        <KpiCard label="Trays Prepared" value="1,420" icon={Package} tone="success" />
        <KpiCard label="Vehicles On Trip" value={6} icon={Truck} tone="warning" />
        <KpiCard label="Delivered Today" value={records.filter((r) => r.status === "Dispatched").length} icon={Truck} tone="red" />
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
        </select>
      </div>

      {/* ── PRD Packaging Table ──────────────────────────────────────────────── */}
      <div data-arrival-id="dispatch-list" className="rounded-lg border border-border bg-card shadow-sm mb-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="p-3 text-left font-semibold">Dep Time</th>
                <th className="p-3 text-left font-semibold">Flight</th>
                <th className="p-3 text-left font-semibold">Order</th>
                <th className="p-3 text-left font-semibold">Production</th>
                <th className="p-3 text-left font-semibold">Meal Type</th>
                <th className="p-3 text-left font-semibold">Meal Name</th>
                <th className="p-3 text-right font-semibold">Qty</th>
                <th className="p-3 text-left font-semibold">Warehouse</th>
                <th className="p-3 text-left font-semibold">Status</th>
                <th className="p-3 text-left font-semibold">Food Safety & QC</th>
                <th className="p-3 text-left font-semibold">Actions</th>
              </tr>
            </thead>

            {groupedPRDs.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={11} className="p-10 text-center text-muted-foreground text-sm">
                    No packaging orders match the selected filters.
                  </td>
                </tr>
              </tbody>
            ) : (
              groupedPRDs.map((timeGroup) => {
                const totalTimeRows = timeGroup.flightGroups.reduce((sum, fg) => sum + fg.rows.length, 0);
                let timeDepRendered = false;
                return (
                  <tbody key={timeGroup.depTime}>
                    {timeGroup.flightGroups.flatMap((flightGroup, fgIdx) => {
                      const flightRowSpan = flightGroup.rows.length;
                      const flightQCData = flightQCStates.get(flightGroup.flight);
                      const flightQCState = flightQCData?.qcState ?? "not-started";
                      const allPackagingDone = flightGroup.rows.every(
                        (r) => r.packagingStatus === "Packaging Done" || r.packagingStatus === "Ready for Dispatch"
                      );
                      const flightStatus = getFlightStatus(flightGroup.rows, flightQCState);
                      const isLastFlightGroup = fgIdx === timeGroup.flightGroups.length - 1;
                      return flightGroup.rows.map((row, rIdx) => {
                        const isFirstInFlight = rIdx === 0;
                        const isFirstInTime = isFirstInFlight && !timeDepRendered;
                        if (isFirstInTime) timeDepRendered = true;
                        const isAbsoluteLast = isLastFlightGroup && rIdx === flightGroup.rows.length - 1;
                        return (
                          <tr
                            key={row.id}
                            data-arrival-row-id={row.id}
                            className={`hover:bg-muted/20 ${isAbsoluteLast ? "border-b-2 border-border" : "border-b border-border/50"}`}
                          >
                            {isFirstInTime && (
                              <td rowSpan={totalTimeRows} className="p-3 text-sm text-muted-foreground align-middle font-medium border-r border-border/40 bg-slate-50/60 whitespace-nowrap">
                                {timeGroup.depTime}
                              </td>
                            )}
                            {isFirstInFlight && (
                              <td rowSpan={flightRowSpan} className="p-3 font-semibold text-sm align-middle border-r border-border/20 whitespace-nowrap">
                                {flightGroup.flight}
                              </td>
                            )}
                            <td className="p-3 align-middle">
                              {row.orderNo ? (
                                <button
                                  type="button"
                                  className="text-xs font-mono font-semibold text-primary hover:underline whitespace-nowrap"
                                  title="Open Order Management"
                                  onClick={() => navigate(`/order-management?ord=${row.orderNo}`)}
                                >
                                  {row.orderNo}
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="p-3 align-middle">
                              {row.productionOrderId ? (
                                <button
                                  type="button"
                                  className="text-xs font-mono font-medium text-primary hover:underline whitespace-nowrap"
                                  title="Open Production Order"
                                  onClick={() => navigate(`/production-entry?pro=${row.productionOrderId}`)}
                                >
                                  {row.productionOrderId}
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${MEAL_TYPE_BADGE[row.mealType] ?? "bg-muted text-foreground"}`}>
                                {row.mealType}
                              </span>
                            </td>
                            <td className="p-3 text-sm">{row.mealName}</td>
                            <td className="p-3 text-right font-medium">{row.qty}</td>
                            <td className="p-3 text-sm text-muted-foreground">{row.section}</td>
                            {isFirstInFlight && (
                              <td rowSpan={flightRowSpan} className="p-3 align-middle border-l border-border/20">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${FLIGHT_STATUS_BADGE[flightStatus] ?? "bg-muted text-muted-foreground"}`}>
                                  {flightStatus}
                                </span>
                              </td>
                            )}
                            {isFirstInFlight && (
                              <td rowSpan={flightRowSpan} className="p-3 align-middle border-l border-border/20">
                                {flightQCState === "done" ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border border-emerald-500 text-emerald-700 cursor-default"
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
                                    onClick={() => handleQCAction(flightGroup.flight)}>
                                    <ShieldCheck className="h-3 w-3 mr-1" /> Initiate QC
                                  </Button>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">Pending</span>
                                )}
                              </td>
                            )}
                            {isFirstInFlight && (
                              <td rowSpan={flightRowSpan} className="p-3 align-middle border-l border-border/20">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Button
                                    size="sm"
                                    className="h-7 px-3 text-xs bg-navy text-navy-foreground hover:opacity-90 shrink-0"
                                    onClick={() => setViewPackagingRow(flightGroup.rows[0])}
                                  >
                                    <Eye className="h-3 w-3 mr-1" /> View
                                  </Button>
                                  {flightGroup.rows.some((r) => r.packagingStatus === "Ready for Packaging") && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-3 text-xs shrink-0"
                                      onClick={() => setMaterialsRow(flightGroup.rows.find((r) => r.packagingStatus === "Ready for Packaging")!)}
                                    >
                                      <Package className="h-3 w-3 mr-1" /> Initiate Packaging
                                    </Button>
                                  )}
                                  {flightQCState === "done" && (
                                    <Button
                                      size="sm"
                                      className="h-7 px-3 text-xs shrink-0 bg-gradient-to-r from-teal-500 to-cyan-600 text-white hover:from-teal-600 hover:to-cyan-700 border-0 shadow-sm"
                                      onClick={() => openWarningForFlightGroup(flightGroup)}
                                    >
                                      <Truck className="h-3 w-3 mr-1" /> Initiate Dispatch
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
                                      <DropdownMenuItem onClick={() => toast.info(`QC Report for ${flightGroup.flight}`)}>
                                        View QC Report
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      });
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
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                        Dispatched
                      </span>
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
        <DialogContent className="w-full max-w-full sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Order Details — {viewPackagingRow?.id}</DialogTitle>
          </DialogHeader>
          {viewPackagingRow && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div><span className="text-muted-foreground">Meal:</span><span className="font-semibold ml-1">{viewPackagingRow.mealName}</span></div>
                <div><span className="text-muted-foreground">Type:</span><span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-semibold ${MEAL_TYPE_BADGE[viewPackagingRow.mealType]}`}>{viewPackagingRow.mealType}</span></div>
                <div><span className="text-muted-foreground">Qty:</span><span className="font-semibold ml-1">{viewPackagingRow.qty} units</span></div>
                <div><span className="text-muted-foreground">Warehouse:</span><span className="font-semibold ml-1">{viewPackagingRow.section}</span></div>
                <div><span className="text-muted-foreground">Dep Time:</span><span className="font-semibold ml-1">{viewPackagingRow.depTime}</span></div>
                <div><span className="text-muted-foreground">Date:</span><span className="font-semibold ml-1">{viewPackagingRow.date}</span></div>
                <div className="col-span-2"><span className="text-muted-foreground">Flight:</span><span className="font-semibold ml-1">{viewPackagingRow.flight}</span></div>
                {viewPackagingRow.dspRef && (
                  <div className="col-span-2"><span className="text-muted-foreground">Dispatch Ref:</span><span className="font-semibold ml-1">{viewPackagingRow.dspRef}</span></div>
                )}
              </div>
              <div className="pt-2 border-t border-border flex gap-3 flex-wrap">
                <div>
                  <span className="text-muted-foreground">Packaging:</span>
                  <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-semibold ${PACKAGING_BADGE[viewPackagingRow.packagingStatus]}`}>{viewPackagingRow.packagingStatus}</span>
                </div>
                {(() => {
                  const qc = flightQCStates.get(viewPackagingRow.flight);
                  const qs = qc?.qcState ?? "not-started";
                  return (
                    <>
                      <div>
                        <span className="text-muted-foreground">QC:</span>
                        <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-semibold ${qs === "done" ? "bg-emerald-100 text-emerald-700" : qs === "in-progress" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                          {qs === "done" ? "QC Done" : qs === "in-progress" ? "QC In Progress" : "Pending"}
                        </span>
                      </div>
                      {qc?.qcCheckedAt && (
                        <div><span className="text-muted-foreground">QC at:</span><span className="font-semibold ml-1">{qc.qcCheckedAt}</span></div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewPackagingRow(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Packaging Materials Check Modal ─────────────────────────────────── */}
      <Dialog open={!!materialsRow} onOpenChange={(v) => !v && setMaterialsRow(null)}>
        <DialogContent className="w-full max-w-full sm:max-w-2xl max-h-[100vh] sm:max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b shrink-0">
            <DialogTitle className="text-base font-semibold">
              Packaging Materials Check — {materialsRow?.id}
            </DialogTitle>
          </div>
          {materialsRow && (() => {
            const materials = getMaterials(materialsRow.qty);
            const anyShort = materials.some((m) => m.available < m.required);
            return (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                  <div className="flex gap-6 text-sm flex-wrap">
                    <div>
                      <span className="text-muted-foreground">Meal:</span>
                      <span className="font-semibold ml-1">{materialsRow.mealName}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Qty:</span>
                      <span className="font-semibold ml-1">{materialsRow.qty} units</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                      Required Materials
                    </div>
                    <div className="rounded-md border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 border-b border-border">
                          <tr>
                            <th className="p-2.5 text-left font-semibold">Material</th>
                            <th className="p-2.5 text-center font-semibold w-28">Required</th>
                            <th className="p-2.5 text-center font-semibold w-28">Available</th>
                          </tr>
                        </thead>
                        <tbody>
                          {materials.map((m, i) => {
                            const ok = m.available >= m.required;
                            return (
                              <tr key={i} className={`border-t border-border/50 ${!ok ? "bg-red-50" : ""}`}>
                                <td className="p-2.5">
                                  <div className="flex items-center gap-2">
                                    {ok
                                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                                      : <AlertCircle  className="h-4 w-4 text-red-500 shrink-0" />
                                    }
                                    {m.name}
                                  </div>
                                </td>
                                <td className="p-2.5 text-center">{m.required}</td>
                                <td className={`p-2.5 text-center font-semibold ${ok ? "text-emerald-700" : "text-red-700"}`}>
                                  {m.available}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-4 border-t shrink-0 flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setMaterialsRow(null)}>Cancel</Button>
                  <Button
                    disabled={anyShort}
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
            <p className="text-xs text-muted-foreground mt-0.5">Select date, departure time, and flight. Flights already dispatched are shown as (Already configured).</p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            <div>
              <Label className="text-xs font-semibold">Date</Label>
              <Input type="date" value={configDate} onChange={(e) => setConfigDate(e.target.value)} min={today} max={maxDate} className="h-9 mt-1" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-semibold">Departure Time</Label>
                <select
                  value={configDepTime}
                  onChange={(e) => { setConfigDepTime(e.target.value); setConfigFlight(""); }}
                  className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Select time —</option>
                  {distinctDepTimes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs font-semibold">Select Flight</Label>
                <select
                  value={configFlight}
                  onChange={(e) => setConfigFlight(e.target.value)}
                  disabled={!configDepTime}
                  className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                >
                  <option value="">— Select flight —</option>
                  {availableFlights.map((f) => {
                    const alreadyConfigured = configuredFlights.has(f.flight);
                    return (
                      <option key={f.id} value={f.flight} disabled={alreadyConfigured}>
                        {f.flight}{alreadyConfigured ? " (Already configured)" : ""}
                      </option>
                    );
                  })}
                </select>
                {configFlight && selectedSector && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">Sector:</span>
                    <span className="font-semibold text-slate-700">{selectedSector}</span>
                  </div>
                )}
                {configDepTime && availableFlights.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">No flights scheduled at this time.</p>
                )}
              </div>
            </div>

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
                  {configPaxLines.map((line, i) => (
                    <tr key={line.id} className={i > 0 ? "border-t border-slate-200" : ""}>
                      <td className="p-1.5">
                        <select
                          value={line.itemName}
                          onChange={(e) => setConfigPaxLines((prev) => prev.map((l) => l.id === line.id ? { ...l, itemName: e.target.value } : l))}
                          className="h-8 w-full rounded border border-input bg-background px-2 text-xs"
                        >
                          <option value="">— Select —</option>
                          {PAX_MEAL_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </td>
                      <td className="p-1.5">
                        <select
                          value={line.percent}
                          onChange={(e) => setConfigPaxLines((prev) => prev.map((l) => l.id === line.id ? { ...l, percent: Number(e.target.value) } : l))}
                          className="h-8 w-full rounded border border-input bg-background px-2 text-xs text-center"
                        >
                          {[30, 40, 50, 60, 70].map((v) => <option key={v} value={v}>{v}%</option>)}
                        </select>
                      </td>
                      <td className="p-1.5">
                        <Input
                          type="number" min={0}
                          value={line.qty || ""}
                          onChange={(e) => setConfigPaxLines((prev) => prev.map((l) => l.id === line.id ? { ...l, qty: Number(e.target.value) } : l))}
                          className="h-8 text-xs text-center"
                        />
                      </td>
                      <td className="p-1.5 text-center">
                        {configPaxLines.length > 1 && (
                          <button onClick={() => setConfigPaxLines((prev) => prev.filter((l) => l.id !== line.id))} className="text-red-500 hover:text-red-700 text-base leading-none">×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 bg-slate-50/80">
                    <td className="p-2 font-bold text-xs" colSpan={2}>Total Hot Meal</td>
                    <td className="p-2 text-center font-bold text-slate-800">{configPaxLines.reduce((s, l) => s + (Number(l.qty) || 0), 0)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
              <Button variant="outline" size="sm" className="mt-2 text-xs"
                onClick={() => setConfigPaxLines((prev) => [...prev, { id: `p${Date.now()}`, itemName: "", percent: 40, qty: 0 }])}>
                + Add Meal Option
              </Button>
            </div>

            {/* Crew Meals */}
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Crew Meals</div>
              <div className="space-y-2">
                {configCrewMeals.map((meal) => (
                  <div key={meal.id} className="flex items-center gap-2">
                    <select
                      value={meal.type}
                      onChange={(e) => setConfigCrewMeals((prev) => prev.map((m) => m.id === meal.id ? { ...m, type: e.target.value } : m))}
                      className="h-8 flex-1 rounded border border-input bg-background px-2 text-sm"
                    >
                      {CREW_MEAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <Input
                      value={meal.qty}
                      onChange={(e) => setConfigCrewMeals((prev) => prev.map((m) => m.id === meal.id ? { ...m, qty: e.target.value } : m))}
                      placeholder="e.g. 12+1"
                      className="h-8 w-28 text-sm"
                    />
                    {configCrewMeals.length > 1 && (
                      <button onClick={() => setConfigCrewMeals((prev) => prev.filter((m) => m.id !== meal.id))} className="text-red-500 hover:text-red-700 text-lg leading-none">×</button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" className="text-xs"
                  onClick={() => setConfigCrewMeals((prev) => [...prev, { id: `c${Date.now()}`, type: "Lunch", qty: "" }])}>
                  + Add More
                </Button>
              </div>
            </div>

            {/* Special Meals */}
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Special Meals</div>
              <div className="space-y-2">
                {configSpecialMeals.length === 0 && (
                  <p className="text-xs text-muted-foreground">No special meals added.</p>
                )}
                {configSpecialMeals.map((meal) => (
                  <div key={meal.id} className="flex items-center gap-2">
                    <select
                      value={meal.type}
                      onChange={(e) => setConfigSpecialMeals((prev) => prev.map((m) => m.id === meal.id ? { ...m, type: e.target.value } : m))}
                      className="h-8 flex-1 rounded border border-input bg-background px-2 text-sm"
                    >
                      {SPECIAL_MEAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <Input
                      type="number" min={0}
                      value={meal.qty}
                      onChange={(e) => setConfigSpecialMeals((prev) => prev.map((m) => m.id === meal.id ? { ...m, qty: e.target.value } : m))}
                      placeholder="Qty"
                      className="h-8 w-24 text-sm text-center"
                    />
                    <button onClick={() => setConfigSpecialMeals((prev) => prev.filter((m) => m.id !== meal.id))} className="text-red-500 hover:text-red-700 text-lg leading-none">×</button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="text-xs"
                  onClick={() => setConfigSpecialMeals((prev) => [...prev, { id: `s${Date.now()}`, type: "VGML", qty: "" }])}>
                  + Add Special Meal
                </Button>
              </div>
            </div>

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
                <Button variant="outline" size="sm" className="text-xs"
                  onClick={() => setConfigAdditional((prev) => [...prev, { id: `a${Date.now()}`, name: "", qty: "" }])}>
                  + Add Item
                </Button>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t shrink-0 flex justify-between gap-2">
            <Button variant="outline" onClick={() => { setConfigOpen(false); resetConfig(); }}>Cancel</Button>
            <Button onClick={handleConfigSave} disabled={!configFlight}>
              Save &amp; Create Dispatch
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── View / Trail Modal ───────────────────────────────────────────────── */}
      <Dialog open={!!viewRecord} onOpenChange={(v) => !v && setViewRecord(null)}>
        <DialogContent className="w-full max-w-full sm:max-w-md max-h-[100vh] sm:max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b shrink-0">
            <DialogTitle className="text-base font-semibold">Dispatch Details — {viewRecord?.id}</DialogTitle>
            {viewRecord && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {viewRecord.flightNos.join(", ")} · {viewRecord.kitchenName} · Dep {viewRecord.depTime}
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {viewRecord && (() => {
              const { detail, trail, notifiedAirport } = viewRecord;
              const bakeryTotal    = detail.bakery.reduce((s, b) => s + b.qty, 0);
              const amenitiesTotal = detail.amenities.reduce((s, a) => s + a.qty, 0);
              const fk = detail.flightKitchen;
              const fs = detail.foodSafety;
              return (
                <>
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
                      <ChefHat className="h-3.5 w-3.5" /> Flight Kitchen
                      <span className="ml-auto font-semibold text-slate-700 normal-case tracking-normal">{fk.totalMeals.toLocaleString()} total meals</span>
                    </div>
                    <div className="rounded-lg border border-border overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="text-slate-700">Lunch</span><span className="font-semibold">{fk.lunch.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between px-3 py-2 text-sm border-t border-border">
                        <span className="text-slate-700">Breakfast</span><span className="font-semibold">{fk.breakfast.toLocaleString()}</span>
                      </div>
                    </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Dispatch By</Label>
                <div className="h-8 mt-1 rounded border border-input bg-slate-100 px-3 flex items-center text-sm font-semibold text-slate-700">
                  PRODUCTION
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

                        <div className="flex items-center gap-4 px-3 py-2 rounded border border-slate-200 bg-slate-50/60 flex-wrap">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Special Meals</span>
                          <div className="flex gap-3 flex-wrap">
                            {([["VGML", "vgml"], ["CHML", "chml"], ["SPML", "spml"]] as const).map(([label, field]) => (
                              <div key={label} className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-slate-600">{label}</span>
                                <Input type="number" value={sec[field]} onChange={(e) => updateSection(sIdx, { [field]: Number(e.target.value) })} className="h-7 w-14 text-xs text-center" />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex gap-6 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Label className="text-xs font-semibold text-slate-600 whitespace-nowrap">Pastry for {sec.flightNo}</Label>
                            <Input type="number" value={sec.pastry} onChange={(e) => updateSection(sIdx, { pastry: Number(e.target.value) })} className="h-7 w-20 text-xs text-center" />
                          </div>
                          <div className="flex items-center gap-2">
                            <Label className="text-xs font-semibold text-slate-600 whitespace-nowrap">Child Meals Pastry</Label>
                            <Input type="number" value={sec.childMealsPastry} onChange={(e) => updateSection(sIdx, { childMealsPastry: Number(e.target.value) })} className="h-7 w-20 text-xs text-center" />
                          </div>
                        </div>
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

            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Summary</div>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-left font-semibold border-r border-slate-200">Flight</th>
                    <th className="p-2.5 text-center font-semibold border-r border-slate-200">PAX Meals</th>
                    <th className="p-2.5 text-center font-semibold border-r border-slate-200">Pastry</th>
                    <th className="p-2.5 text-center font-semibold">Child Meals</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((s) => {
                    const tot = s.paxLines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
                    return (
                      <tr key={s.flightNo} className="border-t border-slate-200">
                        <td className="p-2.5 font-semibold border-r border-slate-200">{s.flightNo}</td>
                        <td className="p-2.5 text-center border-r border-slate-200">{tot}</td>
                        <td className="p-2.5 text-center border-r border-slate-200">{s.pastry}</td>
                        <td className="p-2.5 text-center">{s.childMealsPastry}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

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
              {!dispatched ? (
                <Button
                  disabled={!declared}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40"
                  onClick={handleDispatch}
                >
                  <Truck className="h-4 w-4 mr-1" /> Dispatch
                </Button>
              ) : (
                <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setNotifyOpen(true)}>
                  <Bell className="h-4 w-4 mr-1" /> Notify Airport Executive
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
    </>
  );
}
