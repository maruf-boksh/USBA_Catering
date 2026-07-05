import { useState, Fragment, useEffect, useRef, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, Minus, Truck, Pencil, Trash2, ThermometerSun, ShieldCheck,
  AlertOctagon, AlertTriangle, PlaneTakeoff, PlaneLanding, Warehouse,
  Clock, User, CheckCircle2, Eye, Smartphone, ChevronRight, QrCode, X as CloseIcon, Timer, Play,
} from "lucide-react";
import {
  flights as FLIGHT_BOARD, seedFlightOrders, activeOffices, activeWarehousesByOffice,
  aircraftFleet as AIRCRAFT_SEED, airlines as AIRLINE_SEED,
  type Aircraft, type Airline,
} from "@/lib/sample-data";
import { getFlightOrders } from "@/lib/flight-orders-store";
import { INITIAL_RECORDS as DISPATCH_SEED_RECORDS } from "@/routes/dispatch";
import { useRole } from "@/lib/roles";
import { useWorkflow } from "@/lib/workflow-store";
import { useDispatchMonitoringSettings } from "@/lib/dispatch-monitoring-settings";
import { KpiCard } from "@/components/common/KpiCard";
import { loadStandardsForAircraft, computeStandard, isMealMixKey, galleyAircraftTypes } from "@/lib/galley-standards";
import { usePersistedState } from "@/lib/use-persisted-state";
import { AircraftFields } from "@/routes/config-aircraft";
import { getGalleySections, computeAutoTotals, loadGalleyItems } from "@/lib/galley-items";

// Flight options for the dispatch-monitoring form. The operational flight board
// (`FLIGHT_BOARD`) only carries a handful of flights, so we merge in every
// distinct flight number from the order book (`seedFlightOrders`) — deduped by
// flight code — so the Flight Number dropdown has them all pre-loaded.
export type FlightOption = {
  id: string; flight: string; sector: string; aircraft: string; dep: string; arr: string;
  pax: number; adult: number; child: number; infant: number; crew: number;
  type: string; window: string; duration: string; status: string;
};
export const flights: FlightOption[] = (() => {
  const merged: FlightOption[] = FLIGHT_BOARD.map((f) => ({ ...f }));
  const seen = new Set(merged.map((f) => f.flight));
  for (const o of seedFlightOrders) {
    if (!o.flight || seen.has(o.flight)) continue;
    seen.add(o.flight);
    merged.push({
      id: `MFL-${o.flight}`,
      flight: o.flight,
      sector: o.sector ?? "—",
      aircraft: o.airline ?? "—",
      dep: o.etd ?? "—",
      arr: "—",
      pax: o.pax ?? 0,
      adult: o.pax ?? 0,
      child: 0,
      infant: 0,
      crew: o.crew ?? 0,
      type: "—",
      window: o.direction ?? "—",
      duration: "—",
      status: o.status ?? "Scheduled",
    });
  }
  return merged.sort((a, b) => a.flight.localeCompare(b.flight));
})();

// ── Constants ───────────────────────────────────────────────────────────────
const MEAL_TYPES = ["Regular", "Vegetarian (VGML)", "Child Meal (CHML)", "Diabetic (DBML)", "Kosher (KSML)", "Crew Meal", "Special"];
export const APT_EXECUTIVES = ["M. Hossain", "T. Ahmed", "K. Sultana", "A. Chowdhury", "R. Islam"];
const APT_DESIGNATIONS = ["APT Executive", "Sr. APT Executive", "Airport Supervisor", "Ground Operations Officer"];
const FS_HYGIENE_EXECUTIVES = ["F. Begum", "A. Khan", "S. Islam", "R. Akter", "N. Hossain"];
export const HOC_NAMES = ["Cmd. A. Rahman", "M. Jahangir", "S. Karim", "R. Ahmed"];
export const APT_EXEC_DESIG: Record<string, string> = {
  "M. Hossain": "Sr. APT Executive",
  "T. Ahmed": "APT Executive",
  "K. Sultana": "Airport Supervisor",
  "A. Chowdhury": "Ground Operations Officer",
  "R. Islam": "APT Executive",
};
export const HOC_DESIG: Record<string, string> = {
  "Cmd. A. Rahman": "Head of Catering",
  "M. Jahangir": "Catering Supervisor",
  "S. Karim": "Head of Catering",
  "R. Ahmed": "Sr. Catering Officer",
};
const DEP_TIMES = [...new Set(flights.map((f) => f.dep))].sort();
const todayStr = new Date().toISOString().split("T")[0];

export function nowTimeStr() {
  const now = new Date();
  return `${todayStr} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
}

// ── Types ───────────────────────────────────────────────────────────────────
type MealLine = { type: string; qty: string };
type ApprovalLog = { name: string; date: string; time: string; remarks: string };
export type DispatchEntry = {
  id: string; flightId: string; packagingDate: string; mealLines: MealLine[];
  vehicleNo: string; vehicleClean: "Yes" | "No"; chilledTemp: string; frozenTemp: string;
  loadStartTime: string; loadEndTime: string; vehicleTempBegin: string; vehicleTempEnd: string;
  resultSatisfy: "Yes" | "No"; gateTempGate08: string;
  unloadingTime: string; checkedByApt: string;
  monitoredByRemarks: string; monitoredAt: string;
  approvalStage: 0 | 1 | 2 | 3 | 4;
  verifiedBy?: ApprovalLog;
  approvedBy?: ApprovalLog;
  forwardedToAirportAt?: string;
  receivedBy: string; receivedDesignation: string; receivedAt: string; receivedRemarks: string;
  /** Human-friendly dispatch number (e.g. DSP-0001), assigned on creation. */
  dispatchNo?: string;
};
type FormState = {
  flightId: string; packagingDate: string; mealLines: MealLine[];
  vehicleNo: string; vehicleClean: "Yes" | "No" | ""; chilledTemp: string; frozenTemp: string;
  loadStartTime: string; loadEndTime: string; vehicleTempBegin: string; vehicleTempEnd: string;
  resultSatisfy: "Yes" | "No" | ""; gateTempGate08: string;
  unloadingTime: string; checkedByApt: string;
  monitoredByRemarks: string;
  ackChilled: boolean; ackFrozen: boolean; ackTempBegin: boolean; ackTempEnd: boolean; ackGate08: boolean;
  receiverRemarks: string;
};

type SignOffLog = { name: string; designation: string; signedAt: string };
export type GalleyStatus = "forwarded" | "loading" | "completed" | "awaiting_approval" | "approved";
export type GalleyLoadingRecord = {
  id: string;
  dispatchEntryId: string;
  flightId: string;
  flightLabel: string;
  date: string;
  galleyPlan: GalleyPlan;
  signOff: {
    preparedBy: SignOffLog;
    physicallyHandedBy: SignOffLog;
    flightCheckedBy: SignOffLog;
    handedOverBy: SignOffLog;
  };
  galleyStatus: GalleyStatus;
  forwardedAt: string;
  /** Office / warehouse the consumables were transferred FROM on forward. */
  sourceOfficeId?: string;
  sourceWarehouseId?: string;
  loadingStartedAt?: string;
  loadingCompletedAt?: string;
  loadingDurationSec?: number;
  approvedAt?: string;
  approvedBy?: string;
};

const GALLEY_KEY = "galley_loading";

function initGalleySeed(): GalleyLoadingRecord[] {
  const seed: GalleyLoadingRecord[] = [
    {
      id: "GL-BS105-001",
      dispatchEntryId: "SEED-BS105",
      flightId: "MFL-BS-105",
      flightLabel: "BS-105 — DAC→CXB",
      date: "2026-06-28",
      galleyPlan: {
        depZenithLoad: "72", arrZenithLoad: "22", traySetupDep: "75", traySetupArr: "25",
        depMealLoad: "67", arrMealLoad: "25", depBCPax: "0", arrBCPax: "0",
        depBCMeal: "0", arrBCMeal: "0", depCrewBC: "0", arrCrewBC: "0",
        depCockpit: "2", depCabin: "2", depObs: "0", arrCockpit: "2", arrCabin: "2", arrObs: "0",
        depChildPax: "5", arrChildPax: "0", depChildMeal: "5", arrChildMeal: "0",
        extHotMeal: "0", totalMealLoad: "76",
        depChicken: "27", depBeef: "40", depVeg: "2", depChilled: "0", depDiabetic: "0", depBreakfast: "0", totalDepMeal: "67",
        arrChicken: "10", arrBeef: "15", arrVeg: "1", arrChilled: "0", arrDiabetic: "0", totalArrMeal: "25",
        bcDepPassMeal: "0", bcArrPassMeal: "0", bcDepCrewMeal: "0", bcArrCrewMeal: "0",
        bcAppetizer: "0", bcNutPkt: "0", bcDessert: "0",
        crewBreakfast: "4", crewLunch: "4", crewHeavySnacks: "", crewAppetizer: "4",
        crewLightSnacks: "8", crewDessert: "8", crewExtraLunchVeg: "1", crewButterJam: "10",
        traySetupDepEY: "75", traySetupArrEY: "25", totalSalad: "2", totalFirni: "76", totalCutlery: "76",
        bcSetupDep: "", bcSetupArr: "",
        coke225: "0", pepsi225: "10", sprite225: "0", sevenUp225: "10", totalColdBev: "20",
        cokeCanBC: "2", spriteCanBC: "2", dietCanBC: "4", totalCanBC: "8",
        water250Pax: "144", water500Crew: "8",
        appleJuice1L: "1", mangoJuice1L: "2", orangeJuice1L: "1", totalJuice: "4",
        coffee50g: "6", coffeeMate400g: "2", teaBag50pcs: "4", greenTea: "10", zeroCal: "10",
        milkPowder: "1.5", sugar: "2", paperCup: "114",
        saltPkt: "20", pepperPkt: "0", teaPot: "6", disposableSpoon: "20", extraCottage: "10", sanitizerBtl: "0",
        soda: "", lemon: "", ginger: "", tonic: "",
        dailyMedeline: "2", emkBox: "1", upkBox: "2", fanBox: "2",
        wetTissue: "76", blanket: "6", napkinPaper: "8", facialTissue: "3",
        kitchenTowel: "3", handWash: "11", toiletRoll: "1",
        aerosol: "12", celeste: "2", airFreshener: "",
        surgicalGloves: "15", ovenGloves: "20", surgicalMask: "0", oneShot: "1",
        babyWipes: "92", sicknessBag: "0", headRestCover: "122", pillowCoverSmall: "0", pillowCoverBig: "122",
        safetyCard: "76", healthDeclForm: "100", baggageDeclForm: "100", bdEdCard: "20", commentsCard: "50",
        fullMealCart: "2", halfMealCart: "2", fullWastageCart: "1", halfWastageCart: "0",
        standardCabinet: "5", ovenCase: "6",
        ceramicMealBowl: "3", ceramicDessertBowl: "0", ceramicButterBowl: "0", ceramicNutBowl: "0",
        teaCupSaucer: "0", tumblerGlass: "0", snacksPlate: "2",
        teaSpoon: "3", dinnerFork: "3", dinnerSpoon: "3", dinnerKnife: "0",
        longSpoon: "3", iceTong: "1", iceBucket: "1", roundTraySteel: "1", serviceTrayBig: "4",
        banana: "4", apple: "4",
        preparedBy: "M. Hossain", physicallyHandedBy: "T. Ahmed",
        flightCheckedBy: "K. Sultana", handedOverBy: "Cmd. A. Rahman",
      },
      signOff: {
        preparedBy: { name: "M. Hossain", designation: "Sr. APT Executive", signedAt: "2026-06-28 07:00" },
        physicallyHandedBy: { name: "T. Ahmed", designation: "APT Executive", signedAt: "2026-06-28 07:01" },
        flightCheckedBy: { name: "K. Sultana", designation: "Airport Supervisor", signedAt: "2026-06-28 07:02" },
        handedOverBy: { name: "Cmd. A. Rahman", designation: "Head of Catering", signedAt: "2026-06-28 07:03" },
      },
      galleyStatus: "awaiting_approval",
      forwardedAt: "2026-06-28 07:05",
      loadingStartedAt: "2026-06-28T07:10:00.000Z",
      loadingCompletedAt: "2026-06-28T07:28:00.000Z",
      loadingDurationSec: 1080,
    },
  ];
  sessionStorage.setItem(GALLEY_KEY, JSON.stringify(seed));
  return seed;
}

export function loadGalleyRecords(): GalleyLoadingRecord[] {
  try {
    const raw = sessionStorage.getItem(GALLEY_KEY);
    if (!raw) return initGalleySeed();
    return JSON.parse(raw) as GalleyLoadingRecord[];
  } catch { return initGalleySeed(); }
}

export function saveGalleyRecords(records: GalleyLoadingRecord[]) {
  sessionStorage.setItem(GALLEY_KEY, JSON.stringify(records));
}

// ── Dispatch (packaging) records — read-only source for the galley Meals tab ──
// The dish-level meal breakdown lives on the Packaging & Dispatch records
// (persisted by dispatch.tsx). We read them directly so Meals integrate from
// dispatch data rather than being hand-keyed.
export type DispPaxLine = { itemName: string; percent?: number; qty: number };
export type DispCrewMeal = { type: string; qty: string };
export type DispSection = {
  flightNo: string; sector?: string; direction?: string;
  paxLines: DispPaxLine[]; vgml?: number; chml?: number; spml?: number;
  crewMeals?: DispCrewMeal[];
};
type DispRecord = { id: string; date: string; flightNos: string[]; sections: DispSection[] };

function loadDispatchRecords(): DispRecord[] {
  try {
    const raw = localStorage.getItem("harvest-data-v1:dispatch-records");
    if (raw) return JSON.parse(raw) as DispRecord[];
  } catch { /* fall through to seed */ }
  // Not persisted yet (user hasn't opened the Dispatch page) — fall back to the
  // same seed dispatch.tsx uses, so the galley Meals tab still integrates.
  return DISPATCH_SEED_RECORDS as unknown as DispRecord[];
}

/** The dispatch section (dish breakdown) for a flight, if a dispatch was built. */
export function dispatchSectionForFlight(flightNo: string | undefined): DispSection | undefined {
  if (!flightNo) return undefined;
  for (const rec of loadDispatchRecords()) {
    const sec = rec.sections?.find((s) => s.flightNo === flightNo);
    if (sec) return sec;
  }
  return undefined;
}

export type ScaledMeals = {
  origPax: number;
  paxLines: DispPaxLine[];
  crewMeals: DispCrewMeal[];
  special: { vgml: number; chml: number; spml: number };
  specialTotal: number;
};

/** Scale a flight's Dispatch meal breakdown to a plan's load counts — the single
 *  source of truth for the galley Meals view. The planner (live) and the
 *  read-only handing/taking sheet both call this so they always agree.
 *  Percent-based passenger lines recompute off planPax; fixed-qty lines scale
 *  proportionally; crew meals scale off the flight's original crew. */
export function scaleDispatchMeals(
  flightNo: string | undefined, planPax: number, planCrew: number, origCrew: number,
): { section: DispSection; scaled: ScaledMeals } | null {
  const section = dispatchSectionForFlight(flightNo);
  if (!section) return null;
  const origPax = section.paxLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const paxLines = section.paxLines.map((l) => ({
    ...l,
    qty: l.percent != null
      ? Math.round(planPax * (l.percent / 100))
      : origPax > 0 ? Math.round((Number(l.qty) || 0) * planPax / origPax) : (Number(l.qty) || 0),
  }));
  const crewMeals = (section.crewMeals ?? []).map((c) => ({
    ...c,
    qty: origCrew > 0 ? String(Math.round((Number(c.qty) || 0) * planCrew / origCrew)) : c.qty,
  }));
  // Special meals are a subset of passengers, so they scale with planPax too.
  const paxScale = origPax > 0 ? planPax / origPax : 1;
  const special = {
    vgml: Math.round((section.vgml ?? 0) * paxScale),
    chml: Math.round((section.chml ?? 0) * paxScale),
    spml: Math.round((section.spml ?? 0) * paxScale),
  };
  const specialTotal = special.vgml + special.chml + special.spml;
  return { section, scaled: { origPax, paxLines, crewMeals, special, specialTotal } };
}

/** Read the shared dispatch-monitoring entries (seeding on first use) so other
 *  modules — e.g. Galley Planning — can plan against the same dispatches. */
export function loadDispatchEntries(): DispatchEntry[] {
  try {
    const s = sessionStorage.getItem("dm_entries");
    if (s) return JSON.parse(s) as DispatchEntry[];
    const seed = initDispatchSeed();
    sessionStorage.setItem("dm_entries", JSON.stringify(seed));
    return seed;
  } catch { return initDispatchSeed(); }
}

function initDispatchSeed(): DispatchEntry[] {
  return [
    {
      id: "SEED-DS-001",
      flightId: "BS-141",
      packagingDate: "2026-06-28",
      dispatchNo: "DSP-DEMO1",
      mealLines: [{ type: "Regular", qty: "72" }],
      vehicleNo: "DHA-2234",
      vehicleClean: "Yes",
      chilledTemp: "2.5",
      frozenTemp: "-10.0",
      loadStartTime: "08:30",
      loadEndTime: "09:00",
      vehicleTempBegin: "3.2",
      vehicleTempEnd: "4.1",
      resultSatisfy: "Yes",
      gateTempGate08: "4.5",
      unloadingTime: "09:15",
      checkedByApt: "T. Ahmed",
      monitoredByRemarks: "All temperature readings within acceptable range",
      monitoredAt: "2026-06-28 09:00",
      approvalStage: 4,
      verifiedBy: { name: "F. Begum", date: "28 Jun 2026", time: "08:45 AM", remarks: "Food safety checks passed" },
      approvedBy: { name: "Cmd. A. Rahman", date: "28 Jun 2026", time: "09:00 AM", remarks: "Approved for dispatch" },
      forwardedToAirportAt: "2026-06-28 09:05",
      receivedBy: "T. Ahmed",
      receivedDesignation: "APT Executive",
      receivedAt: "2026-06-28 09:15",
      receivedRemarks: "All items received in good condition",
    },
    {
      id: "SEED-DS-002",
      flightId: "BS-117",
      packagingDate: "2026-06-28",
      dispatchNo: "DSP-DEMO2",
      mealLines: [{ type: "Regular", qty: "64" }],
      vehicleNo: "DHA-5511",
      vehicleClean: "Yes",
      chilledTemp: "3.0",
      frozenTemp: "-11.0",
      loadStartTime: "06:00",
      loadEndTime: "06:30",
      vehicleTempBegin: "3.8",
      vehicleTempEnd: "4.5",
      resultSatisfy: "Yes",
      gateTempGate08: "5.0",
      unloadingTime: "06:45",
      checkedByApt: "K. Sultana",
      monitoredByRemarks: "Cold chain maintained throughout",
      monitoredAt: "2026-06-28 06:45",
      approvalStage: 4,
      verifiedBy: { name: "A. Khan", date: "28 Jun 2026", time: "06:30 AM", remarks: "QC verified" },
      approvedBy: { name: "M. Jahangir", date: "28 Jun 2026", time: "06:45 AM", remarks: "Dispatch approved" },
      forwardedToAirportAt: "2026-06-28 06:50",
      receivedBy: "K. Sultana",
      receivedDesignation: "Airport Supervisor",
      receivedAt: "2026-06-28 07:00",
      receivedRemarks: "Received and verified",
    },
  ];
}

function formatElapsed(startedAtIso: string): string {
  const sec = Math.floor((Date.now() - new Date(startedAtIso).getTime()) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

const EMPTY_FORM: FormState = {
  flightId: "", packagingDate: todayStr, mealLines: [{ type: "Regular", qty: "" }],
  vehicleNo: "", vehicleClean: "", chilledTemp: "", frozenTemp: "",
  loadStartTime: "", loadEndTime: "", vehicleTempBegin: "", vehicleTempEnd: "",
  resultSatisfy: "", gateTempGate08: "",
  unloadingTime: "", checkedByApt: "", monitoredByRemarks: "",
  ackChilled: false, ackFrozen: false, ackTempBegin: false, ackTempEnd: false, ackGate08: false,
  receiverRemarks: "",
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const chilledOOR = (v: string) => { const n = parseFloat(v); return v !== "" && !isNaN(n) && (n < 1 || n > 4); };
const frozenOOR  = (v: string) => { const n = parseFloat(v); return v !== "" && !isNaN(n) && (n < -12 || n > -8); };
const vehOOR     = (v: string) => { const n = parseFloat(v); return v !== "" && !isNaN(n) && n > 8; };
const totalQty   = (lines: MealLine[]) => lines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0);
export const flightLabel = (id: string) => { const f = flights.find((x) => x.id === id); return f ? `${f.flight} — ${f.sector}` : id; };
const flightNo    = (id: string) => { const f = flights.find((x) => x.id === id); return f ? f.flight : id; };
const flightDest  = (id: string) => { const f = flights.find((x) => x.id === id); return f ? f.sector.split("-").pop() ?? "—" : "—"; };
function dispatchStatusBadge(entry: DispatchEntry) {
  if (entry.receivedAt) return { label: "Received by Airport", cls: "bg-emerald-100 text-emerald-700" };
  if (entry.approvalStage >= 3) return { label: "Forwarded to Airport", cls: "bg-blue-100 text-blue-700" };
  if (entry.approvalStage >= 2) return { label: "Verified", cls: "bg-amber-100 text-amber-700" };
  return { label: "Pending", cls: "bg-slate-100 text-slate-500" };
}

// ── UI Primitives ────────────────────────────────────────────────────────────
function TempHint({ note }: { note: string }) {
  return (
    <p className="text-[11px] text-blue-600/80 mt-0.5 italic flex items-center gap-1">
      <ThermometerSun className="h-3 w-3 shrink-0" />{note}
    </p>
  );
}

function YesNoBadge({ value }: { value: "Yes" | "No" }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${value === "Yes" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
      {value}
    </span>
  );
}

function TempCell({ value, oor }: { value: string; oor?: boolean }) {
  const flag = oor !== undefined ? oor : vehOOR(value);
  return <span className={flag ? "text-red-600 font-semibold" : ""}>{value ? `${value}°C` : "—"}</span>;
}

function OorAck({ show, checked, onChange, label }: { show: boolean; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  if (!show) return null;
  return (
    <label className="flex items-center gap-2 mt-1.5 text-xs cursor-pointer select-none bg-red-50 border border-red-200 rounded p-2">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} className="border-red-400" />
      <span className="text-red-700 font-medium">{label}</span>
    </label>
  );
}

function FieldErr({ msg }: { msg?: string }) {
  return msg ? <p className="text-xs text-red-500 mt-0.5">{msg}</p> : null;
}

function YesNoToggle({ value, onChange, error }: { value: "Yes" | "No" | ""; onChange: (v: "Yes" | "No") => void; error?: string }) {
  return (
    <>
      <div className="flex gap-2 mt-1">
        {(["Yes", "No"] as const).map((opt) => (
          <button key={opt} type="button" onClick={() => onChange(opt)}
            className={`flex-1 py-1.5 rounded-md border text-sm font-semibold transition-colors ${
              value === opt
                ? opt === "Yes" ? "bg-emerald-600 border-emerald-600 text-white" : "bg-red-600 border-red-600 text-white"
                : "border-border hover:bg-muted"}`}>
            {opt}
          </button>
        ))}
      </div>
      <FieldErr msg={error} />
    </>
  );
}

function MaxTempBanner() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-xs font-semibold mb-4">
      <ThermometerSun className="h-4 w-4 text-amber-500 shrink-0" />
      Max. Temp. Limit: +8°C — Cold chain integrity must be maintained throughout dispatch
    </div>
  );
}

function Divider({ label, color = "blue" }: { label: string; color?: "blue" | "emerald" | "slate" }) {
  const t = color === "blue" ? "text-blue-600" : color === "emerald" ? "text-emerald-600" : "text-slate-500";
  const l = color === "blue" ? "border-blue-100" : color === "emerald" ? "border-emerald-100" : "border-slate-200";
  return (
    <div className="flex items-center gap-2 mb-2 mt-1">
      <span className={`text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${t}`}>{label}</span>
      <div className={`flex-1 border-t ${l}`} />
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function DispatchMonitoring() {
  useRole();
  const doc = useDispatchMonitoringSettings();

  const [entries, setEntries] = useState<DispatchEntry[]>(() => {
    try {
      const s = sessionStorage.getItem("dm_entries");
      if (s) return JSON.parse(s) as DispatchEntry[];
      const seed = initDispatchSeed();
      sessionStorage.setItem("dm_entries", JSON.stringify(seed));
      return seed;
    } catch { return initDispatchSeed(); }
  });
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Next sequential dispatch number (DSP-0001…), derived from existing entries so
  // it survives deletions. The new-entry form previews it; saving persists it.
  const nextDispatchNo = (() => {
    const max = entries.reduce((m, e) => {
      const n = parseInt(String(e.dispatchNo ?? "").replace(/\D/g, ""), 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return `DSP-${String(max + 1).padStart(4, "0")}`;
  })();
  // The number shown in the entry form header: an existing entry's own number
  // when editing, otherwise the previewed next number.
  const formDispatchNo = editId
    ? (entries.find((e) => e.id === editId)?.dispatchNo ?? nextDispatchNo)
    : nextDispatchNo;
  const [depTime, setDepTime] = useState("");
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [approvalTargetId, setApprovalTargetId] = useState<string | null>(null);
  const [approvalCurrentStage, setApprovalCurrentStage] = useState<0 | 1 | 2 | null>(null);
  const [approvalName, setApprovalName] = useState("");
  const [approvalRemarks, setApprovalRemarks] = useState("");
  const [viewEntryId, setViewEntryId] = useState<string | null>(null);
  const [galleyRecords, setGalleyRecords] = useState<GalleyLoadingRecord[]>(() => loadGalleyRecords());
  const [tickCount, setTickCount] = useState(0);
  const [formLoadStartIso, setFormLoadStartIso] = useState("");
  const [formTimerTick, setFormTimerTick] = useState(0);
  const [fsRemarksInput, setFsRemarksInput] = useState("");
  const [hocRemarksInput, setHocRemarksInput] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkHandled = useRef(false);
  const { markFlightQcCleared, addDispatchApproval, dispatchApprovals } = useWorkflow();
  const navigate = useNavigate();
  const qcOnlyMode = searchParams.get("mode") === "qc-only";

  // ── Airport receive panel state ──────────────────────────────────────────────
  const [showAirportPanel, setShowAirportPanel] = useState(false);
  const [isAirportReceiveMode, setIsAirportReceiveMode] = useState(false);

  // ── Mobile App View state ───────────────────────────────────────────────────
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"dispatch" | "receive" | "log">("dispatch");
  // Mobile dispatch flow
  const [mScreen, setMScreen] = useState<1 | 2 | 3 | 4>(1);
  const [mFlightIds, setMFlightIds] = useState<string[]>([]);
  const [mVehicleNo, setMVehicleNo] = useState("");
  const [mVehicleClean, setMVehicleClean] = useState<"Clean" | "Not Clean" | "">("");
  const [mChilledTemp, setMChilledTemp] = useState("");
  const [mFrozenTemp, setMFrozenTemp] = useState("");
  const [mVanStart, setMVanStart] = useState("");
  const [mVanEnd, setMVanEnd] = useState("");
  const [mResult, setMResult] = useState<"Yes" | "No" | "">("");
  const [mDispatchedIds, setMDispatchedIds] = useState<string[]>([]);
  const [mLogEntryId, setMLogEntryId] = useState<string | null>(null);
  // Mobile receive flow
  const [rScreen, setRScreen] = useState<1 | 2 | 3>(1);
  const [rSelectedId, setRSelectedId] = useState("");
  const [rGateTemp, setRGateTemp] = useState("");
  const [rUnloadTime, setRUnloadTime] = useState("");
  const [rCheck1, setRCheck1] = useState(false);
  const [rCheck2, setRCheck2] = useState(false);
  const [rCheck3, setRCheck3] = useState(false);
  const [rRemarks, setRRemarks] = useState("");
  const [rAcceptedAt, setRAcceptedAt] = useState("");

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  useEffect(() => {
    sessionStorage.setItem("dm_entries", JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    dispatchApprovals.forEach(da => {
      if (da.stage === "hoc_approved" || da.stage === "forwarded_to_airport") {
        setEntries(prev => prev.map(e => {
          if (e.id !== da.id) return e;
          if (da.stage === "hoc_approved" && e.approvalStage < 3) {
            const parts = (da.approvedAt ?? " ").split(" ");
            return { ...e, approvalStage: 3 as const, approvedBy: { name: da.approvedBy ?? "", date: parts[0] ?? "", time: parts[1] ?? "", remarks: "" } };
          }
          if (da.stage === "forwarded_to_airport" && e.approvalStage < 4) {
            const parts = (da.approvedAt ?? " ").split(" ");
            return {
              ...e,
              approvalStage: 4 as const,
              forwardedToAirportAt: da.forwardedAt ?? "",
              approvedBy: e.approvedBy ?? (da.approvedBy ? { name: da.approvedBy, date: parts[0] ?? "", time: parts[1] ?? "", remarks: "" } : undefined),
            };
          }
          return e;
        }));
      }
    });
  }, [dispatchApprovals]);

  const sf = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const filteredFlights = depTime ? flights.filter((f) => f.dep === depTime) : flights;
  const selectedFlight = flights.find((f) => f.id === form.flightId);

  const handleFlightSelect = (flightId: string) => {
    const f = flights.find((x) => x.id === flightId);
    setForm((prev) => ({
      ...prev,
      flightId,
      packagingDate: todayStr,
      mealLines: f ? [{ type: "Regular", qty: f.pax.toString() }] : prev.mealLines,
    }));
  };

  const resetForm = () => {
    setShowForm(false); setEditId(null); setForm({ ...EMPTY_FORM }); setDepTime(""); setErrors({});
    setShowAirportPanel(false); setIsAirportReceiveMode(false);
    setFormLoadStartIso(""); setFormTimerTick(0);
  };

  const openNew = () => {
    setForm({ ...EMPTY_FORM }); setDepTime(""); setEditId(null); setErrors({});
    setFsRemarksInput(""); setHocRemarksInput(""); setShowForm(true);
    setFormLoadStartIso(""); setFormTimerTick(0);
  };

  // Deep link from Packaging & Dispatch → "Initiate QC": open a new monitoring
  // entry pre-scoped to the flight number passed via ?flight=BS-225.
  useEffect(() => {
    if (deepLinkHandled.current) return;
    const flightNo = searchParams.get("flight");
    if (!flightNo) return;
    deepLinkHandled.current = true;
    const f = flights.find((x) => x.flight === flightNo);
    openNew();
    if (f) {
      setDepTime(f.dep);
      handleFlightSelect(f.id);
      toast.info(`Dispatch monitoring opened for flight ${flightNo}.`);
    } else {
      toast.info(`New dispatch entry — flight ${flightNo} isn't in the flight list, please select it manually.`);
    }
    // Clear the param so a refresh / re-render doesn't reopen the form.
    searchParams.delete("flight");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Sync galley records to sessionStorage whenever they change
  useEffect(() => { saveGalleyRecords(galleyRecords); }, [galleyRecords]);

  // Live timer tick — re-renders every second while a loading session is active
  useEffect(() => {
    const hasActive = galleyRecords.some((r) => r.galleyStatus === "loading");
    if (!hasActive) return;
    const id = setInterval(() => setTickCount((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [galleyRecords]);

  // Form loading timer tick — re-renders every second while loading is active in the dispatch entry form
  useEffect(() => {
    if (!formLoadStartIso) return;
    const id = setInterval(() => setFormTimerTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [formLoadStartIso]);


  function startLoading(entryId: string) {
    setGalleyRecords((prev) =>
      prev.map((r) =>
        r.dispatchEntryId === entryId
          ? { ...r, galleyStatus: "loading" as GalleyStatus, loadingStartedAt: new Date().toISOString() }
          : r,
      ),
    );
    toast.info("Loading started. Timer is running.");
  }

  function completeLoading(entryId: string) {
    setGalleyRecords((prev) =>
      prev.map((r) => {
        if (r.dispatchEntryId !== entryId || r.galleyStatus !== "loading") return r;
        const sec = Math.floor((Date.now() - new Date(r.loadingStartedAt!).getTime()) / 1000);
        return {
          ...r,
          galleyStatus: "awaiting_approval" as GalleyStatus,
          loadingCompletedAt: new Date().toISOString(),
          loadingDurationSec: sec,
        };
      }),
    );
    toast.success("Loading completed! Record sent to Approval Management.");
  }

  const openEdit = (entry: DispatchEntry) => {
    const fl = flights.find((f) => f.id === entry.flightId);
    setDepTime(fl?.dep ?? "");
    setForm({
      flightId: entry.flightId, packagingDate: entry.packagingDate,
      mealLines: entry.mealLines.length ? entry.mealLines : [{ type: "Regular", qty: "" }],
      vehicleNo: entry.vehicleNo, vehicleClean: entry.vehicleClean,
      chilledTemp: entry.chilledTemp, frozenTemp: entry.frozenTemp,
      loadStartTime: entry.loadStartTime, loadEndTime: entry.loadEndTime,
      vehicleTempBegin: entry.vehicleTempBegin, vehicleTempEnd: entry.vehicleTempEnd,
      resultSatisfy: entry.resultSatisfy,
      gateTempGate08: entry.gateTempGate08, unloadingTime: entry.unloadingTime,
      checkedByApt: entry.checkedByApt, monitoredByRemarks: entry.monitoredByRemarks,
      ackChilled: false, ackFrozen: false, ackTempBegin: false, ackTempEnd: false, ackGate08: false,
      receiverRemarks: entry.receivedRemarks,
    });
    setEditId(entry.id); setErrors({});
    setFsRemarksInput(entry.verifiedBy?.remarks ?? "");
    setHocRemarksInput(entry.approvedBy?.remarks ?? "");
    setShowForm(true);
  };

  const openAirportReceive = (entry: DispatchEntry) => {
    openEdit(entry);
    setShowAirportPanel(true);
    setIsAirportReceiveMode(true);
  };

  const validate = () => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.flightId) e.flightId = "Flight is required.";
    if (!form.vehicleNo) e.vehicleNo = "Vehicle No. is required.";
    if (!form.vehicleClean) e.vehicleClean = "Vehicle cleanliness status is required.";
    if (!form.loadStartTime) e.loadStartTime = "Required.";
    if (!form.loadEndTime) e.loadEndTime = "Required.";
    if (!form.vehicleTempBegin) e.vehicleTempBegin = "Required.";
    if (!form.vehicleTempEnd) e.vehicleTempEnd = "Required.";
    if (!form.resultSatisfy) e.resultSatisfy = "Required.";
    if (chilledOOR(form.chilledTemp) && !form.ackChilled) e.ackChilled = "Acknowledge out-of-range reading.";
    if (frozenOOR(form.frozenTemp) && !form.ackFrozen) e.ackFrozen = "Acknowledge out-of-range reading.";
    if (vehOOR(form.vehicleTempBegin) && !form.ackTempBegin) e.ackTempBegin = "Acknowledge exceeds +8°C.";
    if (vehOOR(form.vehicleTempEnd) && !form.ackTempEnd) e.ackTempEnd = "Acknowledge exceeds +8°C.";
    if (vehOOR(form.gateTempGate08) && !form.ackGate08) e.ackGate08 = "Acknowledge exceeds +8°C.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const saveEntry = () => {
    if (!validate()) return;
    const label = flightLabel(form.flightId);
    const at = nowTimeStr();
    // Completing the dispatch monitoring entry clears the flight for dispatch —
    // Packaging & Dispatch reads this to unlock "Initiate Dispatch".
    const flightNo = flights.find((f) => f.id === form.flightId)?.flight;
    if (flightNo) markFlightQcCleared(flightNo, at);
    const existing = editId ? entries.find((e) => e.id === editId) : null;
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    const mealLines = form.mealLines.filter((l) => l.qty);
    const base: Omit<DispatchEntry, "id"> = {
      flightId: form.flightId, packagingDate: form.packagingDate,
      mealLines,
      vehicleNo: form.vehicleNo, vehicleClean: form.vehicleClean as "Yes" | "No",
      chilledTemp: form.chilledTemp, frozenTemp: form.frozenTemp,
      loadStartTime: form.loadStartTime, loadEndTime: form.loadEndTime,
      vehicleTempBegin: form.vehicleTempBegin, vehicleTempEnd: form.vehicleTempEnd,
      resultSatisfy: form.resultSatisfy as "Yes" | "No",
      gateTempGate08: form.gateTempGate08, unloadingTime: form.unloadingTime,
      checkedByApt: form.checkedByApt, monitoredByRemarks: form.monitoredByRemarks,
      monitoredAt: existing?.monitoredAt ?? at,
      approvalStage: existing?.approvalStage ?? 0,
      verifiedBy: existing?.verifiedBy,
      approvedBy: existing?.approvedBy,
      receivedBy: existing?.receivedBy ?? "",
      receivedDesignation: existing?.receivedDesignation ?? "",
      receivedAt: existing?.receivedAt ?? "",
      receivedRemarks: form.receiverRemarks,
      forwardedToAirportAt: existing?.forwardedToAirportAt,
      dispatchNo: existing?.dispatchNo ?? nextDispatchNo,
    };
    if (editId) {
      setEntries((prev) => prev.map((e) => e.id === editId ? { ...e, ...base } : e));
      toast.success(`Entry updated — ${label}`);
      resetForm();
    } else {
      const newId = `DSP-${Date.now()}`;
      const newEntry: DispatchEntry = { id: newId, ...base, approvalStage: 2, verifiedBy: { name: "", date: dateStr, time: timeStr, remarks: fsRemarksInput } };
      const updatedEntries = [newEntry, ...entries];
      setEntries(updatedEntries);
      // Write synchronously so the entry survives navigation before useEffect fires
      try { sessionStorage.setItem("dm_entries", JSON.stringify(updatedEntries)); } catch { /* ignore */ }
      addDispatchApproval({
        id: newId,
        flightId: form.flightId,
        flightLabel: label,
        packagingDate: form.packagingDate,
        vehicleNo: form.vehicleNo,
        vehicleClean: form.vehicleClean,
        totalQty: totalQty(mealLines),
        resultSatisfy: form.resultSatisfy,
        chilledTemp: form.chilledTemp,
        frozenTemp: form.frozenTemp,
        vehicleTempBegin: form.vehicleTempBegin,
        vehicleTempEnd: form.vehicleTempEnd,
        loadStartTime: form.loadStartTime,
        loadEndTime: form.loadEndTime,
        gateTempGate08: form.gateTempGate08,
        unloadingTime: form.unloadingTime,
        verifiedByRemarks: fsRemarksInput,
        verifiedByDate: dateStr,
        verifiedByTime: timeStr,
        stage: "pending_hoc",
      });
      toast.success(`Forwarded to Head of Catering — ${label}`);
      resetForm();
      navigate("/approval-management?tab=dispatch");
    }
  };

  const saveEntryInPlace = () => {
    if (!validate()) return;
    const label = flightLabel(form.flightId);
    const at = nowTimeStr();
    const existing = editId ? entries.find((e) => e.id === editId) : null;
    const base: Omit<DispatchEntry, "id"> = {
      flightId: form.flightId, packagingDate: form.packagingDate,
      mealLines: form.mealLines.filter((l) => l.qty),
      vehicleNo: form.vehicleNo, vehicleClean: form.vehicleClean as "Yes" | "No",
      chilledTemp: form.chilledTemp, frozenTemp: form.frozenTemp,
      loadStartTime: form.loadStartTime, loadEndTime: form.loadEndTime,
      vehicleTempBegin: form.vehicleTempBegin, vehicleTempEnd: form.vehicleTempEnd,
      resultSatisfy: form.resultSatisfy as "Yes" | "No",
      gateTempGate08: form.gateTempGate08, unloadingTime: form.unloadingTime,
      checkedByApt: form.checkedByApt, monitoredByRemarks: form.monitoredByRemarks,
      monitoredAt: existing?.monitoredAt ?? at,
      approvalStage: existing?.approvalStage ?? 0,
      verifiedBy: existing?.verifiedBy,
      approvedBy: existing?.approvedBy,
      receivedBy: existing?.receivedBy ?? "",
      receivedDesignation: existing?.receivedDesignation ?? "",
      receivedAt: existing?.receivedAt ?? "",
      receivedRemarks: form.receiverRemarks,
      forwardedToAirportAt: existing?.forwardedToAirportAt,
      dispatchNo: existing?.dispatchNo ?? nextDispatchNo,
    };
    if (editId) {
      setEntries((prev) => prev.map((e) => e.id === editId ? { ...e, ...base } : e));
      toast.success(`Entry updated — ${label}`);
    } else {
      const newId = `DSP-${Date.now()}`;
      setEntries((prev) => [{ id: newId, ...base }, ...prev]);
      setEditId(newId);
      toast.success(`Dispatch entry saved — ${label}`);
    }
  };

  const acceptReceipt = () => {
    if (!validate()) return;
    const label = flightLabel(form.flightId);
    const at = nowTimeStr();
    const existing = editId ? entries.find((e) => e.id === editId) : null;
    const base: Omit<DispatchEntry, "id"> = {
      flightId: form.flightId, packagingDate: form.packagingDate,
      mealLines: form.mealLines.filter((l) => l.qty),
      vehicleNo: form.vehicleNo, vehicleClean: form.vehicleClean as "Yes" | "No",
      chilledTemp: form.chilledTemp, frozenTemp: form.frozenTemp,
      loadStartTime: form.loadStartTime, loadEndTime: form.loadEndTime,
      vehicleTempBegin: form.vehicleTempBegin, vehicleTempEnd: form.vehicleTempEnd,
      resultSatisfy: form.resultSatisfy as "Yes" | "No",
      gateTempGate08: form.gateTempGate08, unloadingTime: form.unloadingTime,
      checkedByApt: form.checkedByApt, monitoredByRemarks: form.monitoredByRemarks,
      monitoredAt: existing?.monitoredAt ?? at,
      approvalStage: existing?.approvalStage ?? 0,
      verifiedBy: existing?.verifiedBy,
      approvedBy: existing?.approvedBy,
      receivedBy: existing?.receivedBy ?? "",
      receivedDesignation: existing?.receivedDesignation ?? "",
      receivedAt: at,
      receivedRemarks: form.receiverRemarks,
      forwardedToAirportAt: existing?.forwardedToAirportAt,
      dispatchNo: existing?.dispatchNo ?? nextDispatchNo,
    };
    if (editId) {
      setEntries((prev) => prev.map((e) => e.id === editId ? { ...e, ...base } : e));
    } else {
      const newId = `DSP-${Date.now()}`;
      setEntries((prev) => [{ id: newId, ...base }, ...prev]);
      setEditId(newId);
    }
    toast.success(`Receipt accepted — ${label}`);
    resetForm();
  };

  const forwardToAirport = () => {
    if (!editId) return;
    const at = nowTimeStr();
    setEntries((prev) =>
      prev.map((e) => e.id === editId ? { ...e, approvalStage: 4 as const, forwardedToAirportAt: at } : e)
    );
    toast.success(`Forwarded to ${doc.destinationLabel}`);
    resetForm();
  };

  const approveInline = (stage: 0 | 1 | 2) => {
    if (!editId) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== editId) return e;
        if (stage === 0) return { ...e, approvalStage: 1 as const };
        if (stage === 1) return { ...e, approvalStage: 2 as const, verifiedBy: { name: "", date: dateStr, time: timeStr, remarks: fsRemarksInput } };
        return { ...e, approvalStage: 3 as const, approvedBy: { name: "", date: dateStr, time: timeStr, remarks: hocRemarksInput } };
      })
    );
    const msgs = ["Forwarded to Food Safety & Hygiene", "Forwarded to Head of Catering", "Dispatch Approved!"];
    toast.success(msgs[stage]);
    if (stage === 1) {
      const entry = entries.find((e) => e.id === editId);
      if (entry) {
        addDispatchApproval({
          id: entry.id,
          flightId: entry.flightId,
          flightLabel: flightLabel(entry.flightId),
          packagingDate: entry.packagingDate,
          vehicleNo: entry.vehicleNo,
          vehicleClean: entry.vehicleClean,
          totalQty: totalQty(entry.mealLines),
          resultSatisfy: entry.resultSatisfy,
          chilledTemp: entry.chilledTemp,
          frozenTemp: entry.frozenTemp,
          vehicleTempBegin: entry.vehicleTempBegin,
          vehicleTempEnd: entry.vehicleTempEnd,
          loadStartTime: entry.loadStartTime,
          loadEndTime: entry.loadEndTime,
          gateTempGate08: entry.gateTempGate08,
          unloadingTime: entry.unloadingTime,
          verifiedByRemarks: fsRemarksInput,
          verifiedByDate: dateStr,
          verifiedByTime: timeStr,
          stage: "pending_hoc",
        });
        navigate("/approval-management?tab=dispatch");
      }
    }
    if (stage === 2) {
      const entry = entries.find((e) => e.id === editId);
      if (entry) {
        const flightNo = flights.find((f) => f.id === entry.flightId)?.flight;
        if (flightNo) markFlightQcCleared(flightNo, nowTimeStr());
      }
      if (qcOnlyMode) {
        resetForm();
        navigate("/dispatch");
      }
    }
  };

  const confirmDelete = () => {
    setEntries((prev) => prev.filter((e) => e.id !== deleteId));
    setDeleteOpen(false);
    toast.success("Entry deleted");
  };

  const openApprovalModal = (entryId: string, stage: 0 | 1 | 2) => {
    setApprovalTargetId(entryId);
    setApprovalCurrentStage(stage);
    setApprovalName("");
    setApprovalRemarks("");
    setApprovalModalOpen(true);
  };

  const confirmApproval = () => {
    if (!approvalTargetId || approvalCurrentStage === null) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== approvalTargetId) return e;
        if (approvalCurrentStage === 0) {
          return { ...e, approvalStage: 1 as const };
        } else if (approvalCurrentStage === 1) {
          return { ...e, approvalStage: 2 as const, verifiedBy: { name: approvalName, date: dateStr, time: timeStr, remarks: approvalRemarks } };
        } else {
          return { ...e, approvalStage: 3 as const, approvedBy: { name: approvalName, date: dateStr, time: timeStr, remarks: approvalRemarks } };
        }
      })
    );
    setApprovalModalOpen(false);
    const msgs = ["Forwarded to Food Safety & Hygiene", "Forwarded to Head of Catering", "Dispatch Approved!"];
    toast.success(msgs[approvalCurrentStage]);
  };

  const mobileConfirmDispatch = () => {
    const at = nowTimeStr();
    const newEntries = mFlightIds.map((flightId, i) => {
      const f = flights.find(x => x.id === flightId);
      const id = `DSP-${Date.now() + i}`;
      return {
        id, flightId, packagingDate: todayStr,
        mealLines: f ? [{ type: "Regular", qty: f.pax.toString() }] : [],
        vehicleNo: mVehicleNo,
        vehicleClean: (mVehicleClean === "Clean" ? "Yes" : "No") as "Yes" | "No",
        chilledTemp: mChilledTemp, frozenTemp: mFrozenTemp,
        loadStartTime: "", loadEndTime: "",
        vehicleTempBegin: mVanStart, vehicleTempEnd: mVanEnd,
        resultSatisfy: mResult as "Yes" | "No",
        gateTempGate08: "", unloadingTime: "", checkedByApt: "", monitoredByRemarks: "",
        monitoredAt: at, approvalStage: 0 as const,
        receivedBy: "", receivedDesignation: "", receivedAt: "", receivedRemarks: "",
      };
    });
    setEntries(prev => [...newEntries, ...prev]);
    setMDispatchedIds(newEntries.map(e => e.id));
    setMScreen(4);
    toast.success(`${newEntries.length} dispatch${newEntries.length > 1 ? "es" : ""} confirmed via Mobile App`);
  };

  const mobileAcceptReceipt = () => {
    const at = nowTimeStr();
    setRAcceptedAt(at);
    setEntries(prev => prev.map(e => e.id === rSelectedId
      ? { ...e, gateTempGate08: rGateTemp, unloadingTime: rUnloadTime, receivedAt: at, receivedRemarks: rRemarks }
      : e));
    setRScreen(3);
    toast.success("Receipt accepted via Mobile App");
  };

  const deleteTarget = entries.find((e) => e.id === deleteId);
  const satisfiedCount = entries.filter((e) => e.resultSatisfy === "Yes").length;
  const unsatisfiedCount = entries.filter((e) => e.resultSatisfy === "No").length;
  const vehicleIssues = entries.filter((e) => e.vehicleClean === "No").length;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <PageHeader
            title={doc.title}
            subtitle={`Cold chain integrity & vehicle hygiene verification per flight dispatch · ${doc.documentCode}`}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-5 -mt-1">{doc.originLabel} → {doc.destinationLabel}</p>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Dispatches" value={entries.length} icon={Truck} tone="navy" />
        <KpiCard label="Result Satisfied" value={satisfiedCount} icon={ShieldCheck} tone="success" />
        <KpiCard label="Not Satisfied" value={unsatisfiedCount} icon={AlertOctagon} tone="red" />
        <KpiCard label="Vehicle Issues" value={vehicleIssues} icon={AlertTriangle} tone="warning" />
      </div>

      {/* Entries Table */}
      {entries.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto mb-6 shadow-sm">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 820 }}>
            <thead>
              <tr className="bg-slate-100 text-slate-600 border-b border-border">
                {([
                  ["Flt No.", true, false],
                  ["Pkg. Date", false, false],
                  ["Dispatch Date & Time", false, false],
                  ["From", false, false],
                  ["To", false, false],
                  ["Status", false, false],
                  ["Actions", false, true],
                ] as [string, boolean, boolean][]).map(([h, sl, sr]) => (
                  <th key={h || "act"}
                    className={`px-3 py-2.5 text-left font-semibold whitespace-nowrap text-[11px] uppercase tracking-wider bg-slate-100 ${sl ? "sticky left-0 z-10" : sr ? "sticky right-0 z-10" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <Fragment key={entry.id}>
                  <tr className={`border-b border-border/40 hover:bg-blue-50/40 transition-colors ${idx % 2 === 1 ? "bg-slate-50/60" : "bg-white"}`}>
                    <td className="px-3 py-2 sticky left-0 z-10 bg-inherit font-semibold whitespace-nowrap text-blue-700">{flightNo(entry.flightId)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{entry.packagingDate}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{entry.packagingDate}{entry.loadStartTime ? ` ${entry.loadStartTime}` : ""}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{doc.originLabel} Point</td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{flightDest(entry.flightId)} Airport</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {(() => { const s = dispatchStatusBadge(entry); return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.cls}`}>{s.label}</span>; })()}
                    </td>
                    <td className="px-3 py-2 sticky right-0 z-10 bg-inherit">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-500 hover:text-slate-700 hover:bg-slate-50" onClick={() => setViewEntryId(entry.id)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>

                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => { setDeleteId(entry.id); setDeleteOpen(true); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        {entry.approvalStage >= 3 && !entry.receivedAt && (
                          <Button
                            size="sm"
                            className="h-6 px-2.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                            onClick={() => openAirportReceive(entry)}
                          >
                            <PlaneLanding className="h-3 w-3 mr-1" /> Airport Receive
                          </Button>
                        )}
                        {entry.receivedAt && (() => {
                          const gr = galleyRecords.find((r) => r.dispatchEntryId === entry.id);
                          // Galley planning now lives in the Galley Planning module.
                          // Until a plan is forwarded from there, the loading actions
                          // below don't apply yet, so render nothing.
                          if (!gr) return null;
                          if (gr.galleyStatus === "forwarded") {
                            return (
                              <Button
                                size="sm"
                                className="h-6 px-2 text-[10px] bg-violet-600 hover:bg-violet-700 text-white border-0"
                                onClick={() => startLoading(entry.id)}
                              >
                                <Play className="h-3 w-3 mr-1" /> Start Loading
                              </Button>
                            );
                          }
                          if (gr.galleyStatus === "loading") {
                            return (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-mono text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded tabular-nums">
                                  <Timer className="h-2.5 w-2.5 inline mr-0.5" />
                                  {tickCount >= 0 && formatElapsed(gr.loadingStartedAt!)}
                                </span>
                                <Button
                                  size="sm"
                                  className="h-6 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                                  onClick={() => completeLoading(entry.id)}
                                >
                                  Loading Completed
                                </Button>
                              </div>
                            );
                          }
                          if (gr.galleyStatus === "awaiting_approval") {
                            return (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                                Awaiting Galley Approval
                              </span>
                            );
                          }
                          if (gr.galleyStatus === "approved") {
                            return (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                                ✓ Ready To Fly
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add Dispatch Entry Button + Empty State ──────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center justify-end mb-4">
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Dispatch Entry
          </Button>
        </div>

        {entries.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 py-20 text-center">
            <Truck className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No dispatch entries for today.</p>
            <p className="text-xs text-muted-foreground mt-1">Click <strong>+ Add Dispatch Entry</strong> above to begin.</p>
          </div>
        )}
      </div>

      {/* ── Dispatch Entry Form Modal ──────────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={(v) => { if (!v) resetForm(); }}>
        <DialogContent className="w-full max-w-5xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b shrink-0">
            <DialogTitle className="text-base font-semibold">
              {editId ? "Edit Dispatch Entry" : "New Dispatch Entry"}
            </DialogTitle>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className={`grid grid-cols-1 ${showAirportPanel ? "xl:grid-cols-2" : ""} gap-5`}>

              {/* ══ LEFT: Catering Point ══════════════════════════════════════ */}
              <div className="rounded-xl border border-blue-300 bg-white shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-700 to-indigo-600 text-white px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <PlaneTakeoff className="h-5 w-5" />
                    <div>
                      <p className="font-bold text-sm">Catering Point Dispatch Entry</p>
                      <p className="text-[11px] text-blue-200 mt-0.5">{doc.originName}</p>
                    </div>
                  </div>
                  <span className="text-xs bg-blue-800/60 px-2.5 py-1 rounded-full">Dispatch No: {formDispatchNo}</span>
                </div>

                <div className={`p-5 space-y-4${isAirportReceiveMode ? " pointer-events-none opacity-60 select-none" : ""}`}>
                  <MaxTempBanner />

                  {/* ─ Flight & Packaging ─ */}
                  <Divider label="Flight & Packaging" color="blue" />

                  {/* Row: dep time | flight | date */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Departure Time</Label>
                      <Select value={depTime} onValueChange={(v) => { setDepTime(v); const first = flights.find((f) => f.dep === v); if (first) handleFlightSelect(first.id); else sf("flightId", ""); }}>
                        <SelectTrigger className="mt-1 h-9 text-sm">
                          <SelectValue placeholder="Select time" />
                        </SelectTrigger>
                        <SelectContent>
                          {DEP_TIMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Flight Number *</Label>
                      <Select value={form.flightId} onValueChange={handleFlightSelect}>
                        <SelectTrigger className={`mt-1 h-9 text-sm ${errors.flightId ? "border-red-400" : ""}`}>
                          <SelectValue placeholder="Select flight" />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredFlights.map((f) => <SelectItem key={f.id} value={f.id}>{f.flight} — {f.sector}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FieldErr msg={errors.flightId} />
                    </div>
                    <div>
                      <Label className="text-xs">Date of Packaging</Label>
                      <Input type="date" value={form.packagingDate} onChange={(e) => sf("packagingDate", e.target.value)} className="mt-1 h-9 text-sm" />
                    </div>
                  </div>

                  {/* Auto-fill chips */}
                  {selectedFlight && (
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: selectedFlight.sector, color: "blue" },
                        { label: selectedFlight.aircraft, color: "blue" },
                        { label: `DEP ${selectedFlight.dep}`, color: "indigo" },
                        { label: `${selectedFlight.pax} PAX`, color: "slate" },
                        { label: selectedFlight.window, color: "amber" },
                        { label: selectedFlight.status, color: selectedFlight.status === "Boarding" ? "emerald" : selectedFlight.status === "Delayed" ? "red" : "slate" },
                      ].map(({ label, color }) => (
                        <span key={label} className={`px-2.5 py-1 rounded-md border text-[11px] font-medium
                          ${color === "blue" ? "bg-blue-50 border-blue-200 text-blue-700" :
                            color === "indigo" ? "bg-indigo-50 border-indigo-200 text-indigo-700" :
                            color === "amber" ? "bg-amber-50 border-amber-200 text-amber-700" :
                            color === "emerald" ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                            color === "red" ? "bg-red-50 border-red-200 text-red-700" :
                            "bg-slate-50 border-slate-200 text-slate-700"}`}>
                          {label}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Meal lines */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs">Meal Types & Quantities</Label>
                      <span className="text-xs text-muted-foreground">Total: <strong className="text-blue-700">{totalQty(form.mealLines)}</strong> pax</span>
                    </div>
                    <div className="space-y-1.5">
                      {form.mealLines.map((line, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <Select value={line.type} onValueChange={(v) => sf("mealLines", form.mealLines.map((l, j) => j === i ? { ...l, type: v } : l))}>
                            <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{MEAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                          </Select>
                          <Input type="number" min={0} placeholder="Qty" value={line.qty}
                            onChange={(e) => sf("mealLines", form.mealLines.map((l, j) => j === i ? { ...l, qty: e.target.value } : l))}
                            className="w-20 h-8 text-xs" />
                          {form.mealLines.length > 1 && (
                            <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-400"
                              onClick={() => sf("mealLines", form.mealLines.filter((_, j) => j !== i))}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    <Button type="button" size="sm" variant="outline" className="mt-2 h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                      onClick={() => sf("mealLines", [...form.mealLines, { type: "Regular", qty: "" }])}>
                      <Plus className="h-3 w-3 mr-1" /> Add Meal Type
                    </Button>
                  </div>

                  {/* ─ Vehicle ─ */}
                  <Divider label="Vehicle Details" color="blue" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Vehicle No. *</Label>
                      <Input
                        placeholder="e.g. HiLoader-02"
                        value={form.vehicleNo}
                        onChange={(e) => sf("vehicleNo", e.target.value)}
                        className={`mt-1 h-9 ${errors.vehicleNo ? "border-red-400" : ""}`}
                      />
                      <FieldErr msg={errors.vehicleNo} />
                    </div>
                    <div>
                      <Label className="text-xs">Vehicle Clean *</Label>
                      <YesNoToggle value={form.vehicleClean} onChange={(v) => sf("vehicleClean", v)} error={errors.vehicleClean} />
                      {form.vehicleClean === "No" && <p className="text-xs text-amber-600 mt-1 font-medium">⚠ Report to supervisor immediately</p>}
                    </div>
                  </div>
                  {!editId && !isAirportReceiveMode && form.vehicleNo && form.vehicleClean && !form.loadStartTime && (
                    <div className="mt-2">
                      <Button
                        type="button"
                        className="h-9 bg-indigo-600 hover:bg-indigo-700 text-white"
                        onClick={() => {
                          const now = new Date();
                          const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
                          sf("loadStartTime", hhmm);
                          setFormLoadStartIso(now.toISOString());
                          toast.info("Loading started — timer running.");
                        }}
                      >
                        <Play className="h-4 w-4 mr-2" /> Start Loading
                      </Button>
                    </div>
                  )}

                  {/* ─ Core Temps ─ */}
                  <Divider label="Product Core Temperature" color="blue" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Chilled Temp (°C)</Label>
                      <Input type="number" step="0.1" placeholder="e.g. 3.0" value={form.chilledTemp}
                        onChange={(e) => { sf("chilledTemp", e.target.value); sf("ackChilled", false); }}
                        className={`mt-1 h-9 ${chilledOOR(form.chilledTemp) ? "border-red-400 bg-red-50" : ""}`} />
                      <TempHint note="Standard: 1°C – 4°C for chilled products" />
                      {chilledOOR(form.chilledTemp) && <p className="text-xs text-red-600 mt-0.5 font-semibold">⚠ Out of range</p>}
                      <OorAck show={chilledOOR(form.chilledTemp)} checked={form.ackChilled} onChange={(v) => sf("ackChilled", v)} label="I acknowledge this reading is outside range" />
                      <FieldErr msg={errors.ackChilled} />
                    </div>
                    <div>
                      <Label className="text-xs">Frozen Temp (°C)</Label>
                      <Input type="number" step="0.1" placeholder="e.g. -10.0" value={form.frozenTemp}
                        onChange={(e) => { sf("frozenTemp", e.target.value); sf("ackFrozen", false); }}
                        className={`mt-1 h-9 ${frozenOOR(form.frozenTemp) ? "border-red-400 bg-red-50" : ""}`} />
                      <TempHint note="Standard: -12°C – -8°C for frozen items" />
                      {frozenOOR(form.frozenTemp) && <p className="text-xs text-red-600 mt-0.5 font-semibold">⚠ Out of range</p>}
                      <OorAck show={frozenOOR(form.frozenTemp)} checked={form.ackFrozen} onChange={(v) => sf("ackFrozen", v)} label="I acknowledge this reading is outside range" />
                      <FieldErr msg={errors.ackFrozen} />
                    </div>
                  </div>

                  {/* ─ Loading Times + Vehicle Temps ─ */}
                  <Divider label="Loading Times & Vehicle Temperature" color="blue" />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {editId ? (
                      <>
                        <div>
                          <Label className="text-xs">Load Start *</Label>
                          <Input type="time" value={form.loadStartTime} onChange={(e) => sf("loadStartTime", e.target.value)}
                            className={`mt-1 h-9 ${errors.loadStartTime ? "border-red-400" : ""}`} />
                          <FieldErr msg={errors.loadStartTime} />
                        </div>
                        <div>
                          <Label className="text-xs">Load End *</Label>
                          <Input type="time" value={form.loadEndTime} onChange={(e) => sf("loadEndTime", e.target.value)}
                            className={`mt-1 h-9 ${errors.loadEndTime ? "border-red-400" : ""}`} />
                          <FieldErr msg={errors.loadEndTime} />
                        </div>
                      </>
                    ) : (
                      <div className="col-span-2">
                        {form.loadStartTime ? (
                          <div className="flex items-center flex-wrap gap-2 mt-1">
                            <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                              <Play className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                              <div>
                                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Loading started</div>
                                <div className="text-xs font-semibold tabular-nums text-indigo-700">{form.loadStartTime}</div>
                              </div>
                            </div>
                            {formLoadStartIso && !form.loadEndTime && (
                              <span className="font-mono text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded px-2 py-1.5 tabular-nums">
                                <Timer className="h-3 w-3 inline mr-0.5" />
                                {formTimerTick >= 0 && formatElapsed(formLoadStartIso)}
                              </span>
                            )}
                            {form.loadEndTime && (
                              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                <div>
                                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Loading completed</div>
                                  <div className="text-xs font-semibold tabular-nums text-emerald-700">{form.loadEndTime}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-[11px] text-muted-foreground italic mt-2">
                            Use <span className="font-semibold not-italic text-indigo-600">▶ Start Loading</span> button (after filling vehicle details) to begin recording loading time
                          </p>
                        )}
                        <FieldErr msg={errors.loadStartTime ?? errors.loadEndTime} />
                      </div>
                    )}
                    <div>
                      <Label className="text-xs">Veh. Temp Begin (°C) *</Label>
                      <Input type="number" step="0.1" placeholder="e.g. 4.5" value={form.vehicleTempBegin}
                        onChange={(e) => { sf("vehicleTempBegin", e.target.value); sf("ackTempBegin", false); }}
                        className={`mt-1 h-9 ${errors.vehicleTempBegin || vehOOR(form.vehicleTempBegin) ? "border-red-400 bg-red-50" : ""}`} />
                      <TempHint note="Max: +8°C" />
                      {vehOOR(form.vehicleTempBegin) && <p className="text-xs text-red-600 font-semibold">⚠ Exceeds limit</p>}
                      <OorAck show={vehOOR(form.vehicleTempBegin)} checked={form.ackTempBegin} onChange={(v) => sf("ackTempBegin", v)} label="Acknowledge" />
                      <FieldErr msg={errors.vehicleTempBegin ?? errors.ackTempBegin} />
                    </div>
                    <div>
                      <Label className="text-xs">Veh. Temp End (°C) *</Label>
                      <Input type="number" step="0.1" placeholder="e.g. 5.0" value={form.vehicleTempEnd}
                        onChange={(e) => { sf("vehicleTempEnd", e.target.value); sf("ackTempEnd", false); }}
                        className={`mt-1 h-9 ${errors.vehicleTempEnd || vehOOR(form.vehicleTempEnd) ? "border-red-400 bg-red-50" : ""}`} />
                      <TempHint note="Max: +8°C" />
                      {vehOOR(form.vehicleTempEnd) && <p className="text-xs text-red-600 font-semibold">⚠ Exceeds limit</p>}
                      <OorAck show={vehOOR(form.vehicleTempEnd)} checked={form.ackTempEnd} onChange={(v) => sf("ackTempEnd", v)} label="Acknowledge" />
                      <FieldErr msg={errors.vehicleTempEnd ?? errors.ackTempEnd} />
                    </div>
                  </div>

                  {/* ─ Result ─ */}
                  <Divider label="Result Check" color="blue" />
                  <div className="max-w-xs">
                    <Label className="text-xs">Result Satisfy *</Label>
                    <YesNoToggle value={form.resultSatisfy} onChange={(v) => sf("resultSatisfy", v)} error={errors.resultSatisfy} />
                    {form.resultSatisfy === "No" && <p className="text-xs text-amber-600 mt-1 font-medium">⚠ Record preventive action below</p>}
                  </div>
                  {!editId && !isAirportReceiveMode && form.loadStartTime && !form.loadEndTime && (
                    <div className="mt-2">
                      <Button
                        type="button"
                        className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => {
                          const now = new Date();
                          const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
                          sf("loadEndTime", hhmm);
                          setFormLoadStartIso("");
                          toast.success("Loading completed!");
                        }}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" /> Loading Completed
                      </Button>
                    </div>
                  )}

                  {/* ─ Dispatch Log & Approval Trail ─ */}
                  <Divider label="Dispatch Log" color="blue" />

                  {/* Horizontal Approval Log Trail */}
                  {(() => {
                    const curEntry = editId ? entries.find((e) => e.id === editId) : null;
                    const curStage = curEntry?.approvalStage ?? 0;
                    return (
                      <div className="grid grid-cols-1 border border-blue-200 rounded-lg overflow-hidden">
                        {/* ① Verified By */}
                        <div className={`p-3 flex flex-col bg-emerald-50/30`}>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-1.5 flex items-center gap-1">
                            <span className="inline-flex items-center justify-center h-4 w-4 rounded-full text-white text-[9px] font-bold bg-emerald-500">1</span>
                            Verified By
                          </p>
                          <p className="text-xs text-slate-500">Food Safety &amp; Hygiene Executive</p>
                          {curStage >= 2 && curEntry?.verifiedBy ? (
                            <>
                              <p className="text-[10px] text-slate-400 italic flex items-center gap-1 mt-0.5">
                                <Clock className="h-2.5 w-2.5" /> {curEntry.verifiedBy.date}, {curEntry.verifiedBy.time}
                              </p>
                              <div className="mt-2 flex-1">
                                <p className="text-[10px] text-muted-foreground mb-0.5">Remarks</p>
                                <p className="text-xs text-slate-600 italic min-h-[56px] bg-slate-50 rounded p-1.5">{curEntry.verifiedBy.remarks || "—"}</p>
                              </div>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold w-fit mt-2">
                                <ShieldCheck className="h-2.5 w-2.5" /> Forwarded to HoC
                              </span>
                            </>
                          ) : curStage === 1 ? (
                            <>
                              <p className="text-[10px] text-slate-400 italic flex items-center gap-1 mt-0.5">
                                <Clock className="h-2.5 w-2.5" /> Time auto-recorded on forward
                              </p>
                              <div className="mt-2 flex-1">
                                <p className="text-[10px] text-muted-foreground mb-0.5">Remarks</p>
                                <Textarea
                                  value={fsRemarksInput}
                                  onChange={(e) => setFsRemarksInput(e.target.value)}
                                  placeholder="Remarks by FS executive..."
                                  className="min-h-[56px] text-xs resize-none"
                                />
                              </div>
                              <div className="mt-2 flex flex-col gap-1.5">
                                <Button type="button" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0" onClick={() => approveInline(1)}>
                                  Verify and Forward to Head Of Catering
                                </Button>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-[10px] text-slate-400 italic flex items-center gap-1 mt-0.5">
                                <Clock className="h-2.5 w-2.5" /> Time auto-recorded on forward
                              </p>
                              <div className="mt-2 flex-1">
                                <p className="text-[10px] text-muted-foreground mb-0.5">Remarks</p>
                                <Textarea
                                  value={fsRemarksInput}
                                  onChange={(e) => setFsRemarksInput(e.target.value)}
                                  placeholder="Remarks by FS executive..."
                                  className="min-h-[56px] text-xs resize-none"
                                />
                              </div>
                              <div className="mt-2 flex flex-col gap-1.5">
                                {editId && (
                                  <Button type="button" size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white border-0" onClick={() => approveInline(0)}>
                                    Forward To Food Safety And Hygiene
                                  </Button>
                                )}
                              </div>
                            </>
                          )}
                        </div>

                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* ══ RIGHT: Airport Point (only shown when Airport Receive is triggered) ══ */}
              {showAirportPanel && <div className="rounded-xl border border-emerald-300 bg-white shadow-sm overflow-hidden self-start">
                <div className="bg-gradient-to-r from-emerald-700 to-emerald-600 text-white px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <PlaneLanding className="h-5 w-5" />
                    <div>
                      <p className="font-bold text-sm">Airport Point Receiving Entry</p>
                      <p className="text-[11px] text-emerald-200 mt-0.5">{doc.destinationName}</p>
                    </div>
                  </div>
                  <span className="text-xs bg-emerald-800/60 px-2.5 py-1 rounded-full">APT Verify</span>
                </div>

                <div className="p-5 space-y-4">
                  <MaxTempBanner />

                  {/* ─ Gate Details — 3-col horizontal ─ */}
                  <Divider label="Airport Gate Details — Gate No. 08" color="emerald" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Gate 08 Temp (°C)</Label>
                      <Input type="number" step="0.1" placeholder="e.g. 6.5" value={form.gateTempGate08}
                        onChange={(e) => { sf("gateTempGate08", e.target.value); sf("ackGate08", false); }}
                        className={`mt-1 h-9 ${vehOOR(form.gateTempGate08) ? "border-red-400 bg-red-50" : ""}`} />
                      <TempHint note="Max: +8°C at gate" />
                      {vehOOR(form.gateTempGate08) && <p className="text-xs text-red-600 mt-0.5 font-semibold">⚠ Exceeds +8°C</p>}
                      <OorAck show={vehOOR(form.gateTempGate08)} checked={form.ackGate08} onChange={(v) => sf("ackGate08", v)} label="Acknowledge" />
                      <FieldErr msg={errors.ackGate08} />
                    </div>
                    <div>
                      <Label className="text-xs">Time of Unloading</Label>
                      <Input type="time" value={form.unloadingTime} onChange={(e) => sf("unloadingTime", e.target.value)} className="mt-1 h-9" />
                      <TempHint note="Time when unloading begins at gate" />
                    </div>
                  </div>

                  {/* Protocol */}
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

                  {/* Cold chain visual */}
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-center">
                    <div className="flex items-center justify-center gap-2 text-xs text-slate-600">
                      <span className="px-2.5 py-1 rounded-md bg-blue-100 text-blue-700 font-semibold">Catering Kitchen</span>
                      <span className="flex-1 border-t-2 border-dashed border-slate-300 relative">
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">≤ +8°C</span>
                      </span>
                      <span className="px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-700 font-semibold">Airport Gate 08</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-3">Cold chain must be unbroken from kitchen to gate</p>
                  </div>

                  {/* ─ Receipt Log ─ */}
                  <Divider label="Receipt Log" color="emerald" />
                  <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-3.5 space-y-3">
                    <p className="text-[11px] text-emerald-700 font-bold flex items-center gap-1.5">
                      <PlaneLanding className="h-3.5 w-3.5" /> Received By ({doc.destinationLabel})
                    </p>
                    <p className="text-[11px] text-slate-400 italic flex items-center gap-1">
                      <User className="h-3 w-3" /> Name &amp; designation auto-filled by system
                    </p>
                    <div>
                      <Label className="text-xs">Remarks</Label>
                      <Textarea
                        value={form.receiverRemarks}
                        onChange={(e) => sf("receiverRemarks", e.target.value)}
                        placeholder="Remarks by receiving officer..."
                        className="mt-1 min-h-[60px] text-xs resize-none"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Date &amp; time auto-recorded on accept
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0 px-4"
                        onClick={acceptReceipt}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Save And Accept
                      </Button>
                    </div>
                  </div>
                </div>
              </div>}
            </div>

            {/* Save / Cancel */}
            <div className="mt-5 flex items-center justify-end gap-3 border-t border-border pt-4">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              {!isAirportReceiveMode && (
                <Button className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 shadow-md" onClick={saveEntry}>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  {editId ? "Save Changes" : "Save"}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Delete Dispatch Entry?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete entry for <span className="font-semibold text-foreground">{deleteTarget ? flightLabel(deleteTarget.flightId) : ""}</span>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Approval Modal ───────────────────────────────────────────────────── */}
      <Dialog open={approvalModalOpen} onOpenChange={setApprovalModalOpen}>
        <DialogContent className="w-full max-w-full sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {approvalCurrentStage === 0
                ? "Forward To Food Safety & Hygiene"
                : approvalCurrentStage === 1
                ? "Forward To Head Of Catering"
                : "Approve and Dispatch"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {approvalCurrentStage === 0 ? (
              <p className="text-sm text-muted-foreground leading-relaxed">
                Confirm forwarding this entry to the Food Safety &amp; Hygiene team for verification.
              </p>
            ) : (
              <>
                <div>
                  <Label className="text-xs">
                    {approvalCurrentStage === 1 ? "Food Safety & Hygiene Executive *" : "Head of Catering *"}
                  </Label>
                  <Select value={approvalName} onValueChange={setApprovalName}>
                    <SelectTrigger className="mt-1 h-9">
                      <SelectValue placeholder="Select name" />
                    </SelectTrigger>
                    <SelectContent>
                      {(approvalCurrentStage === 1 ? FS_HYGIENE_EXECUTIVES : HOC_NAMES).map((n) => (
                        <SelectItem key={n} value={n}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Remarks</Label>
                  <Textarea
                    value={approvalRemarks}
                    onChange={(e) => setApprovalRemarks(e.target.value)}
                    placeholder="Add remarks..."
                    className="mt-1 min-h-[72px] text-xs"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovalModalOpen(false)}>Cancel</Button>
            <Button
              onClick={confirmApproval}
              disabled={approvalCurrentStage !== 0 && !approvalName}
              className={approvalCurrentStage === 2 ? "bg-violet-600 hover:bg-violet-700 text-white border-0" : approvalCurrentStage === 1 ? "bg-emerald-600 hover:bg-emerald-700 text-white border-0" : ""}
            >
              {approvalCurrentStage === 0
                ? "Confirm Forward"
                : approvalCurrentStage === 1
                ? "Forward to HoC"
                : "Approve & Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Entry Modal ─────────────────────────────────────────────────── */}
      {(() => {
        const entry = entries.find((e) => e.id === viewEntryId);
        return (
          <Dialog open={!!viewEntryId} onOpenChange={(v) => !v && setViewEntryId(null)}>
            <DialogContent className="w-full max-w-full sm:max-w-lg max-h-[100vh] sm:max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
              <div className="px-6 pt-5 pb-4 border-b shrink-0">
                <DialogTitle className="text-base font-semibold">
                  Dispatch Entry — {entry ? flightLabel(entry.flightId) : ""}
                </DialogTitle>
                {entry && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {entry.packagingDate} · Vehicle: {entry.vehicleNo} · {totalQty(entry.mealLines)} pax
                  </p>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {entry && (
                  <>
                    {/* Basic info grid */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div><span className="text-xs text-muted-foreground">Flight</span><div className="font-semibold text-blue-700">{flightLabel(entry.flightId)}</div></div>
                      <div><span className="text-xs text-muted-foreground">Vehicle No.</span><div>{entry.vehicleNo}</div></div>
                      <div><span className="text-xs text-muted-foreground">Total Qty</span><div className="font-semibold">{totalQty(entry.mealLines)} pax</div></div>
                      <div><span className="text-xs text-muted-foreground">Pkg. Date</span><div>{entry.packagingDate}</div></div>
                      <div><span className="text-xs text-muted-foreground">Vehicle Clean</span><div><YesNoBadge value={entry.vehicleClean} /></div></div>
                      <div><span className="text-xs text-muted-foreground">Result Satisfy</span><div><YesNoBadge value={entry.resultSatisfy} /></div></div>
                      <div><span className="text-xs text-muted-foreground">Chilled Temp</span><div className={chilledOOR(entry.chilledTemp) ? "font-semibold text-red-600" : ""}>{entry.chilledTemp ? `${entry.chilledTemp}°C` : "—"}</div></div>
                      <div><span className="text-xs text-muted-foreground">Frozen Temp</span><div className={frozenOOR(entry.frozenTemp) ? "font-semibold text-red-600" : ""}>{entry.frozenTemp ? `${entry.frozenTemp}°C` : "—"}</div></div>
                      <div><span className="text-xs text-muted-foreground">Veh. Temp Begin</span><div className={vehOOR(entry.vehicleTempBegin) ? "font-semibold text-red-600" : ""}>{entry.vehicleTempBegin ? `${entry.vehicleTempBegin}°C` : "—"}</div></div>
                      <div><span className="text-xs text-muted-foreground">Veh. Temp End</span><div className={vehOOR(entry.vehicleTempEnd) ? "font-semibold text-red-600" : ""}>{entry.vehicleTempEnd ? `${entry.vehicleTempEnd}°C` : "—"}</div></div>
                      <div><span className="text-xs text-muted-foreground">Load Start</span><div>{entry.loadStartTime || "—"}</div></div>
                      <div><span className="text-xs text-muted-foreground">Load End</span><div>{entry.loadEndTime || "—"}</div></div>
                      <div><span className="text-xs text-muted-foreground">Gate 08 Temp</span><div className={vehOOR(entry.gateTempGate08) ? "font-semibold text-red-600" : ""}>{entry.gateTempGate08 ? `${entry.gateTempGate08}°C` : "—"}</div></div>
                    </div>

                    {/* Approval log trail */}
                    <div className="border-t border-border pt-3">
                      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Approval Log</p>
                      <div className="space-y-2.5">

                        {/* ① Verified By */}
                        <div className={`rounded-lg border p-3 ${entry.verifiedBy ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-slate-50/40 opacity-50"}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${entry.verifiedBy ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                              ① Verified By
                            </span>
                            <span className="text-xs font-semibold">{entry.verifiedBy?.name ?? "Pending"}</span>
                          </div>
                          {entry.verifiedBy ? (
                            <>
                              <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                                <span>Food Safety &amp; Hygiene Executive</span>
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{entry.verifiedBy.date}, {entry.verifiedBy.time}</span>
                              </div>
                              {entry.verifiedBy.remarks && (
                                <p className="text-xs text-slate-600 mt-1.5 italic">"{entry.verifiedBy.remarks}"</p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">Awaiting Food Safety &amp; Hygiene forwarding</p>
                          )}
                        </div>

                        {/* ② Approved By */}
                        <div className={`rounded-lg border p-3 ${entry.approvedBy ? "border-violet-200 bg-violet-50/40" : "border-slate-200 bg-slate-50/40 opacity-50"}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${entry.approvedBy ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"}`}>
                              ② Approved By
                            </span>
                            <span className={`text-xs font-semibold ${entry.approvedBy ? "text-violet-700" : "text-slate-400"}`}>
                              {entry.approvedBy ? "Head of Catering" : "Pending"}
                            </span>
                          </div>
                          {entry.approvedBy ? (
                            <>
                              <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground mt-1">
                                <span className="font-medium text-slate-700">{entry.approvedBy.name}</span>
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{entry.approvedBy.date} {entry.approvedBy.time}</span>
                              </div>
                              {entry.approvedBy.remarks && (
                                <p className="text-xs text-slate-600 mt-1.5 italic">"{entry.approvedBy.remarks}"</p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">Awaiting Head of Catering approval</p>
                          )}
                        </div>

                        {/* ③ Received By */}
                        <div className={`rounded-lg border p-3 ${entry.receivedAt ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-slate-50/40 opacity-50"}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${entry.receivedAt ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                              ③ Received By ({doc.destinationLabel})
                            </span>
                          </div>
                          {entry.receivedAt ? (
                            <>
                              <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground mt-1">
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{entry.receivedAt}</span>
                                {entry.checkedByApt && (
                                  <span className="font-medium text-slate-700">{entry.checkedByApt}</span>
                                )}
                              </div>
                              {(entry.gateTempGate08 || entry.unloadingTime) && (
                                <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground mt-1.5">
                                  {entry.gateTempGate08 && (
                                    <span>Gate 08 Temp: <span className={`font-medium ${vehOOR(entry.gateTempGate08) ? "text-red-600" : "text-slate-700"}`}>{entry.gateTempGate08}°C</span></span>
                                  )}
                                  {entry.unloadingTime && (
                                    <span>Unloading: <span className="font-medium text-slate-700">{entry.unloadingTime}</span></span>
                                  )}
                                </div>
                              )}
                              {entry.receivedRemarks && (
                                <p className="text-xs text-slate-600 mt-1.5 italic">"{entry.receivedRemarks}"</p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">Awaiting airport receipt</p>
                          )}
                        </div>

                        {/* ④–⑧ Galley loading timeline */}
                        {(() => {
                          const gr = galleyRecords.find((r) => r.dispatchEntryId === entry.id);
                          const glSteps: { step: string; color: string; title: string; body: React.ReactNode }[] = [];

                          const stepActive = (active: boolean) => active
                            ? "border-sky-200 bg-sky-50/40"
                            : "border-slate-200 bg-slate-50/40 opacity-50";
                          const labelActive = (active: boolean) => active
                            ? "bg-sky-100 text-sky-700"
                            : "bg-slate-100 text-slate-500";

                          const galleyPlanned = !!gr;
                          glSteps.push({
                            step: "④ Galley Plan",
                            color: galleyPlanned ? "sky" : "slate",
                            title: galleyPlanned ? "Prepared" : "Pending",
                            body: galleyPlanned ? (
                              <div className="text-xs text-slate-600">
                                <div className="flex flex-wrap gap-x-3">
                                  <span>By: <span className="font-medium">{gr.signOff.preparedBy?.name ?? "—"}</span></span>
                                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{gr.signOff.preparedBy?.signedAt ?? ""}</span>
                                </div>
                              </div>
                            ) : <p className="text-xs text-slate-400">Galley plan not yet prepared</p>,
                          });

                          const forwarded = gr && ["forwarded","loading","completed","awaiting_approval","approved"].includes(gr.galleyStatus);
                          glSteps.push({
                            step: "⑤ Forward to Aircraft",
                            color: forwarded ? "sky" : "slate",
                            title: forwarded ? `Forwarded at ${gr!.forwardedAt}` : "Pending",
                            body: forwarded
                              ? <p className="text-xs text-slate-600">Handed over by: <span className="font-medium">{gr!.signOff.handedOverBy?.name ?? "—"}</span></p>
                              : <p className="text-xs text-slate-400">Not yet forwarded</p>,
                          });

                          const loadingStarted = gr && ["loading","completed","awaiting_approval","approved"].includes(gr.galleyStatus);
                          glSteps.push({
                            step: "⑥ Loading Start",
                            color: loadingStarted ? "violet" : "slate",
                            title: loadingStarted
                              ? `Started — ${gr!.loadingStartedAt ? new Date(gr!.loadingStartedAt).toLocaleTimeString() : "—"}`
                              : "Pending",
                            body: loadingStarted
                              ? <p className="text-xs text-slate-600">Aircraft loading in progress</p>
                              : <p className="text-xs text-slate-400">Loading not started</p>,
                          });

                          const loadingDone = gr && ["completed","awaiting_approval","approved"].includes(gr.galleyStatus);
                          glSteps.push({
                            step: "⑦ Loading Complete",
                            color: loadingDone ? "violet" : "slate",
                            title: loadingDone
                              ? `Completed in ${formatDuration(gr!.loadingDurationSec ?? 0)}`
                              : "Pending",
                            body: loadingDone
                              ? <p className="text-xs text-slate-600">Duration: <span className="font-medium">{formatDuration(gr!.loadingDurationSec ?? 0)}</span></p>
                              : <p className="text-xs text-slate-400">Loading not completed</p>,
                          });

                          const galleyApproved = gr?.galleyStatus === "approved";
                          glSteps.push({
                            step: "⑧ Galley Approval",
                            color: galleyApproved ? "emerald" : gr && gr.galleyStatus === "awaiting_approval" ? "amber" : "slate",
                            title: galleyApproved ? `Ready to Fly — ${gr!.approvedAt ?? ""}` : gr?.galleyStatus === "awaiting_approval" ? "Awaiting Approval" : "Pending",
                            body: galleyApproved
                              ? <p className="text-xs text-slate-600">Approved by: <span className="font-medium">{gr!.approvedBy ?? "—"}</span></p>
                              : gr?.galleyStatus === "awaiting_approval"
                                ? <p className="text-xs text-amber-700 font-medium">In Approval Management queue</p>
                                : <p className="text-xs text-slate-400">Awaiting approval process</p>,
                          });

                          const colorMap: Record<string, string> = {
                            sky: "border-sky-200 bg-sky-50/40",
                            violet: "border-violet-200 bg-violet-50/40",
                            emerald: "border-emerald-200 bg-emerald-50/40",
                            amber: "border-amber-200 bg-amber-50/40",
                            slate: "border-slate-200 bg-slate-50/40 opacity-50",
                          };
                          const labelMap: Record<string, string> = {
                            sky: "bg-sky-100 text-sky-700",
                            violet: "bg-violet-100 text-violet-700",
                            emerald: "bg-emerald-100 text-emerald-700",
                            amber: "bg-amber-100 text-amber-700",
                            slate: "bg-slate-100 text-slate-500",
                          };

                          return (
                            <>
                              <div className="border-t border-border pt-3 mt-1">
                                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Galley Loading Timeline</p>
                                <div className="space-y-2">
                                  {glSteps.map(({ step, color, title, body }) => (
                                    <div key={step} className={`rounded-lg border p-3 ${colorMap[color]}`}>
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${labelMap[color]}`}>{step}</span>
                                        <span className="text-xs font-semibold">{title}</span>
                                      </div>
                                      {body}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </>
                          );
                        })()}

                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="px-6 py-4 border-t shrink-0 flex justify-end">
                <Button variant="outline" onClick={() => setViewEntryId(null)}>Close</Button>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Galley planning relocated to the Galley Planning module; this page now
          only executes loading (Start Loading → Completed → approval). */}

      {/* ── Mobile App View Overlay ────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.65)", backdropFilter: "blur(6px)" }}
        >
          <button
            onClick={() => setMobileOpen(false)}
            className="absolute top-5 right-5 text-white/70 hover:text-white transition-colors"
            aria-label="Close"
          >
            <CloseIcon className="h-7 w-7" />
          </button>

          {/* Phone frame */}
          <div
            className="relative flex flex-col overflow-hidden shadow-2xl"
            style={{
              width: 375,
              height: Math.min(720, window.innerHeight - 60),
              borderRadius: 36,
              border: "8px solid #1E293B",
              background: "#F1F5F9",
            }}
          >
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-1.5 rounded-full bg-slate-700 z-10" />

            {/* Status bar */}
            <div className="bg-slate-900 text-white flex justify-between items-center px-5 pt-5 pb-1.5 shrink-0 text-[10px]">
              <span className="font-semibold">9:41</span>
              <span className="opacity-60">●●● WiFi 84%</span>
            </div>

            {/* Tab switcher */}
            {mobileTab !== "log" && (
              <div className="bg-white border-b border-slate-200 flex shrink-0">
                <button
                  onClick={() => setMobileTab("dispatch")}
                  className={`flex-1 py-2.5 text-[11px] font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${mobileTab === "dispatch" ? "border-blue-500 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                >
                  <Truck className="h-3.5 w-3.5" /> Kitchen Dispatch
                </button>
                <button
                  onClick={() => setMobileTab("receive")}
                  className={`flex-1 py-2.5 text-[11px] font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${mobileTab === "receive" ? "border-emerald-500 text-emerald-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                >
                  <PlaneLanding className="h-3.5 w-3.5" /> Airport Receiving
                </button>
              </div>
            )}

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">

              {/* ═══ DISPATCH TAB ═══ */}
              {mobileTab === "dispatch" && (
                <>
                  {/* Screen 1 — Flight Selection */}
                  {mScreen === 1 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">{doc.originName} · {doc.documentCode}</p>
                          <p className="font-bold text-slate-800 text-sm">Dispatch Entry</p>
                        </div>
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">1 of 4</span>
                      </div>
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-700 font-medium">
                        <ThermometerSun className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        Max. Temp. Limit: +8°C — Cold chain integrity must be maintained
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Today's Assigned Flights</span>
                          <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full">Auto-loaded</span>
                        </div>
                        <div className="space-y-2">
                          {flights.slice(0, 5).map(f => {
                            const isSelected = mFlightIds.includes(f.id);
                            return (
                              <Fragment key={f.id}>
                                <button onClick={() => setMFlightIds(prev => prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id])}
                                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${isSelected ? "border-blue-400 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-blue-200"}`}>
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-sm text-slate-800">{f.flight}</span>
                                    {isSelected && <span className="text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded-full">Selected ✓</span>}
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-0.5">Dep. {f.dep} · {f.pax} pax · Gate 08</div>
                                </button>
                                {isSelected && (
                                  <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-3 ml-3">
                                    <div className="flex items-center gap-1.5 mb-2">
                                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Meal Types & Pax</span>
                                      <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-medium">From manifest</span>
                                    </div>
                                    <div className="space-y-1 text-xs text-slate-700">
                                      <div className="flex justify-between"><span>Regular</span><span className="font-semibold">{Math.floor(f.pax * 0.84)} pax</span></div>
                                      <div className="flex justify-between"><span>Vegetarian</span><span className="font-semibold">{Math.floor(f.pax * 0.12)} pax</span></div>
                                      <div className="flex justify-between"><span>Diabetic</span><span className="font-semibold">{f.pax - Math.floor(f.pax * 0.84) - Math.floor(f.pax * 0.12)} pax</span></div>
                                      <div className="flex justify-between font-bold border-t border-slate-100 pt-1 mt-0.5"><span>Total</span><span>{f.pax} pax</span></div>
                                    </div>
                                    <p className="text-[10px] text-slate-400 italic mt-2">Tap flight again to deselect.</p>
                                  </div>
                                )}
                              </Fragment>
                            );
                          })}
                        </div>
                      </div>
                      <button
                        onClick={() => { if (mFlightIds.length > 0) setMScreen(2); else toast.error("Please select at least one flight"); }}
                        className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${mFlightIds.length > 0 ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
                      >
                        Next — vehicle details {mFlightIds.length > 0 ? `(${mFlightIds.length} selected)` : ""} <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {/* Screen 2 — Vehicle & Temperature */}
                  {mScreen === 2 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">{mFlightIds.length === 1 ? `${flights.find(x => x.id === mFlightIds[0])?.flight} · ${flights.find(x => x.id === mFlightIds[0])?.pax} pax` : `${mFlightIds.length} flights selected`}</p>
                          <p className="font-bold text-slate-800 text-sm">Vehicle & Temperature</p>
                        </div>
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">2 of 4</span>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">VAN NUMBER *</p>
                        <input value={mVehicleNo} onChange={e => setMVehicleNo(e.target.value)} placeholder="e.g. HiLoader-02"
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-slate-50" />
                        <p className="text-[10px] text-slate-400 italic">Typed by executive after physical inspection</p>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">VAN CLEANLINESS *</p>
                        <div className="flex gap-2">
                          <button onClick={() => setMVehicleClean("Clean")}
                            className={`flex-1 py-2 rounded-lg border font-semibold text-sm transition-colors ${mVehicleClean === "Clean" ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-300"}`}>
                            ✓ Clean
                          </button>
                          <button onClick={() => setMVehicleClean("Not Clean")}
                            className={`flex-1 py-2 rounded-lg border font-semibold text-sm transition-colors ${mVehicleClean === "Not Clean" ? "bg-red-500 border-red-500 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-red-300"}`}>
                            Not clean
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400 italic">Visually examined by executive on-site</p>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">PRODUCT CORE TEMPERATURE *</p>
                        <p className="text-[10px] text-slate-400 italic">Read from physical probe — enter manually</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[11px] text-slate-600 mb-1 font-medium">CHILLED (°C)</p>
                            <input type="number" step="0.1" value={mChilledTemp} onChange={e => setMChilledTemp(e.target.value)} placeholder="e.g. 3.2"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-slate-50" />
                            <p className="text-[10px] text-slate-400 mt-0.5">Standard: 1–4°C</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-slate-600 mb-1 font-medium">FROZEN (°C)</p>
                            <input type="number" step="0.1" value={mFrozenTemp} onChange={e => setMFrozenTemp(e.target.value)} placeholder="e.g. -13.5"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-slate-50" />
                            <p className="text-[10px] text-slate-400 mt-0.5">Standard: -12 to -8°C</p>
                          </div>
                        </div>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">VAN TEMPERATURE DURING LOADING</p>
                        <p className="text-[10px] text-slate-400 italic">Check van thermometer — enter start and end</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[11px] text-slate-600 mb-1 font-medium">START (°C)</p>
                            <input type="number" step="0.1" value={mVanStart} onChange={e => setMVanStart(e.target.value)} placeholder="e.g. 4.1"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-slate-50" />
                          </div>
                          <div>
                            <p className="text-[11px] text-slate-600 mb-1 font-medium">END (°C)</p>
                            <input type="number" step="0.1" value={mVanEnd} onChange={e => setMVanEnd(e.target.value)} placeholder="e.g. 4.8"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-slate-50" />
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-400">Stays within ±8°C limit</p>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setMScreen(1)} className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-semibold text-sm hover:bg-slate-50">← Back</button>
                        <button onClick={() => { if (!mVehicleNo || !mVehicleClean) { toast.error("Fill vehicle details"); return; } setMScreen(3); }}
                          className="flex-[2] py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-1 hover:bg-blue-700 shadow-md">
                          Next <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Screen 3 — Result Check */}
                  {mScreen === 3 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">{mFlightIds.length === 1 ? flights.find(x => x.id === mFlightIds[0])?.flight : `${mFlightIds.length} flights`} · {mVehicleNo}</p>
                          <p className="font-bold text-slate-800 text-sm">Result Check</p>
                        </div>
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">3 of 4</span>
                      </div>
                      {mResult === "Yes" && (
                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs text-emerald-700 font-semibold">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> All checks passed
                        </div>
                      )}
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        {[
                          ["Van clean", mVehicleClean === "Clean" ? "Yes ✓" : mVehicleClean === "Not Clean" ? "No" : "—"],
                          ["Chilled temp", mChilledTemp ? `${mChilledTemp}°C` : "—"],
                          ["Frozen temp", mFrozenTemp ? `${mFrozenTemp}°C` : "—"],
                          ["Van temp (start)", mVanStart ? `${mVanStart}°C` : "—"],
                          ["Van temp (end)", mVanEnd ? `${mVanEnd}°C` : "—"],
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">{label}</span>
                            <span className={`font-semibold ${value === "No" ? "text-red-600" : "text-slate-800"}`}>{value}</span>
                          </div>
                        ))}
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">RESULT SATISFY</p>
                        <div className="flex gap-2">
                          <button onClick={() => setMResult("Yes")}
                            className={`flex-1 py-2.5 rounded-xl border font-bold text-sm transition-colors ${mResult === "Yes" ? "bg-emerald-500 border-emerald-500 text-white shadow-md" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-300"}`}>
                            ✓ Yes
                          </button>
                          <button onClick={() => setMResult("No")}
                            className={`flex-1 py-2.5 rounded-xl border font-bold text-sm transition-colors ${mResult === "No" ? "bg-red-500 border-red-500 text-white shadow-md" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-red-300"}`}>
                            No
                          </button>
                        </div>
                      </div>
                      {mResult === "Yes" && (
                        <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 flex items-center gap-3">
                          <div className="w-11 h-11 bg-slate-800 rounded-lg flex items-center justify-center shrink-0">
                            <QrCode className="h-6 w-6 text-white" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-sky-800">Dispatch QR ready</p>
                            <p className="text-[10px] text-sky-600">Contains all flight, meal, van & temp data. Airport exec scans this.</p>
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setMScreen(2)} className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-semibold text-sm hover:bg-slate-50">← Back</button>
                        <button onClick={() => { if (!mResult) { toast.error("Select result satisfy"); return; } mobileConfirmDispatch(); }}
                          className={`flex-[2] py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition-colors ${mResult ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
                          <PlaneTakeoff className="h-4 w-4" /> Confirm & dispatch
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Screen 4 — Dispatched */}
                  {mScreen === 4 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-slate-400">{doc.documentCode}</p>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">Done</span>
                      </div>
                      <div className="flex flex-col items-center py-6">
                        <div className="w-20 h-20 rounded-full bg-emerald-100 border-4 border-emerald-400 flex items-center justify-center mb-3">
                          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                        </div>
                        <p className="text-2xl font-bold text-slate-800">Dispatched</p>
                        {mDispatchedIds.length === 1 ? (() => {
                          const entry = entries.find(x => x.id === mDispatchedIds[0]);
                          const f = entry ? flights.find(x => x.id === entry.flightId) : null;
                          return f ? (
                            <>
                              <p className="text-sm text-slate-600 mt-1">{f.flight} · {f.pax} pax</p>
                              <p className="text-xs text-slate-400">{mVehicleNo} · {todayStr}</p>
                            </>
                          ) : null;
                        })() : (
                          <>
                            <p className="text-sm text-slate-600 mt-1">{mDispatchedIds.length} flights dispatched</p>
                            <p className="text-xs text-slate-400">{mVehicleNo} · {todayStr}</p>
                          </>
                        )}
                      </div>
                      <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-sky-700 font-medium">
                          <PlaneLanding className="h-3.5 w-3.5 shrink-0" /> En route to Gate 08
                        </div>
                        <span className="text-sky-500 font-semibold">Awaiting APT scan</span>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Dispatch ID</span>
                          <span className="font-mono font-bold text-slate-700 text-[10px] break-all">{mDispatchedIds[0] ?? ""}{mDispatchedIds.length > 1 ? ` +${mDispatchedIds.length - 1} more` : ""}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Status</span>
                          <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold text-[10px]">Awaiting APT verify</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400 text-center italic">This status updates automatically once the airport executive scans and accepts.</p>
                      <button
                        onClick={() => { setMScreen(1); setMFlightIds([]); setMVehicleNo(""); setMVehicleClean(""); setMChilledTemp(""); setMFrozenTemp(""); setMVanStart(""); setMVanEnd(""); setMResult(""); setMDispatchedIds([]); }}
                        className="w-full py-2.5 rounded-xl border border-blue-300 bg-blue-50 text-blue-600 font-semibold text-sm hover:bg-blue-100">
                        + New Dispatch
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* ═══ RECEIVE TAB ═══ */}
              {mobileTab === "receive" && (
                <>
                  {/* Screen 1 — Select dispatch */}
                  {rScreen === 1 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">{doc.destinationName}</p>
                          <p className="font-bold text-slate-800 text-sm">Airport Receiving</p>
                        </div>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">1 of 3</span>
                      </div>
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-700 font-medium">
                        <ThermometerSun className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        Max +8°C — Verify vehicle temp before unloading begins
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-2">Pending Dispatches</p>
                        {entries.filter(e => !e.receivedAt).length === 0 ? (
                          <div className="text-[11px] text-slate-400 italic text-center py-6 bg-white border border-slate-200 rounded-xl">
                            No pending dispatches yet.<br />Complete a Kitchen Dispatch first.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {entries.filter(e => !e.receivedAt).map(e => {
                              const f = flights.find(x => x.id === e.flightId);
                              return (
                                <button key={e.id} onClick={() => setRSelectedId(e.id)}
                                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${rSelectedId === e.id ? "border-emerald-400 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-emerald-200"}`}>
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-sm text-slate-800">{f?.flight ?? e.flightId}</span>
                                    <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Awaiting</span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-0.5">{e.id} · {totalQty(e.mealLines)} pax · {e.vehicleNo}</div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {rSelectedId && (() => {
                        const e = entries.find(x => x.id === rSelectedId);
                        if (!e) return null;
                        return (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-bold mb-1">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> QR scanned — data loaded
                            </div>
                            {[
                              ["Dispatch ID", e.id],
                              ["Flight", flightLabel(e.flightId)],
                              ["Total pax", totalQty(e.mealLines).toString()],
                              ["Vehicle", e.vehicleNo],
                              ["Van clean", e.vehicleClean],
                              ["Chilled temp (kitchen)", e.chilledTemp ? `${e.chilledTemp}°C` : "—"],
                              ["Frozen temp (kitchen)", e.frozenTemp ? `${e.frozenTemp}°C` : "—"],
                            ].map(([l, v]) => (
                              <div key={l} className="flex justify-between text-[11px]">
                                <span className="text-slate-400">{l}</span>
                                <span className="font-medium text-slate-700">{v}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      <button onClick={() => { if (!rSelectedId) { toast.error("Select a dispatch entry"); return; } setRScreen(2); }}
                        className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${rSelectedId ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
                        Proceed to gate check <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {/* Screen 2 — Gate Verification */}
                  {rScreen === 2 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">Gate 08 · {flightLabel(entries.find(e => e.id === rSelectedId)?.flightId ?? "")}</p>
                          <p className="font-bold text-slate-800 text-sm">Gate Verification</p>
                        </div>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">2 of 3</span>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">GATE 08 TEMPERATURE (°C) *</p>
                        <input type="number" step="0.1" value={rGateTemp} onChange={e => setRGateTemp(e.target.value)} placeholder="e.g. 5.8"
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 bg-slate-50" />
                        <p className="text-[10px] text-slate-400 italic">Read from gate thermometer — typed in by executive</p>
                        {rGateTemp && parseFloat(rGateTemp) <= 8 && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold inline-block">≤ +8°C ✓</span>}
                        {rGateTemp && parseFloat(rGateTemp) > 8 && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold inline-block">⚠ Exceeds +8°C</span>}
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">TIME OF UNLOADING</p>
                        <input type="time" value={rUnloadTime} onChange={e => setRUnloadTime(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 bg-white" />
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">PHYSICAL CHECKS BY EXECUTIVE</p>
                        {([
                          ["Vehicle temp verified at gate before unloading", rCheck1, setRCheck1],
                          ["Seal integrity & packaging condition checked", rCheck2, setRCheck2],
                          ["Unloading time recorded", rCheck3, setRCheck3],
                        ] as [string, boolean, (v: boolean) => void][]).map(([label, checked, setter]) => (
                          <label key={label} className="flex items-start gap-2.5 cursor-pointer">
                            <input type="checkbox" checked={checked} onChange={e => setter(e.target.checked)} className="mt-0.5 accent-emerald-500 w-4 h-4 shrink-0" />
                            <span className="text-xs text-slate-700">{label}</span>
                          </label>
                        ))}
                        <label className="flex items-start gap-2.5 opacity-40">
                          <input type="checkbox" disabled className="mt-0.5 w-4 h-4 shrink-0" />
                          <span className="text-xs text-slate-500">APT countersign pending</span>
                        </label>
                        <p className="text-[10px] text-slate-400 italic">All boxes must be checked before accepting.</p>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">REMARKS (OPTIONAL)</p>
                        <textarea value={rRemarks} onChange={e => setRRemarks(e.target.value)} placeholder="e.g. Seals intact. No breach observed."
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs resize-none h-14 focus:outline-none focus:border-emerald-400 bg-slate-50" />
                      </div>
                      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">APT OFFICER SIGNATURE *</p>
                        <button className="w-full py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 flex items-center justify-center gap-1.5 hover:bg-slate-50">
                          <User className="h-3.5 w-3.5" /> Sign with finger
                        </button>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setRScreen(1)} className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-semibold text-sm hover:bg-slate-50">← Back</button>
                        <button onClick={() => {
                          if (!rGateTemp) { toast.error("Enter gate temperature"); return; }
                          if (!rCheck1 || !rCheck2 || !rCheck3) { toast.error("Complete all physical checks"); return; }
                          mobileAcceptReceipt();
                        }} className="flex-[2] py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-1.5 hover:bg-emerald-700 shadow-md">
                          <CheckCircle2 className="h-4 w-4" /> Save & accept
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Screen 3 — Accepted */}
                  {rScreen === 3 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">Gate 08 — APT Verified</p>
                          <p className="font-bold text-slate-800 text-sm">Airport Receiving</p>
                        </div>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">Done</span>
                      </div>
                      <div className="flex flex-col items-center py-5">
                        <div className="w-20 h-20 rounded-full bg-sky-100 border-4 border-sky-400 flex items-center justify-center mb-3">
                          <CheckCircle2 className="h-10 w-10 text-sky-500" />
                        </div>
                        <p className="text-2xl font-bold text-slate-800">Receipt accepted</p>
                        {(() => {
                          const e = entries.find(x => x.id === rSelectedId);
                          const f = flights.find(x => x.id === e?.flightId);
                          return e && f ? (
                            <>
                              <p className="text-xs text-slate-600 mt-1">{f.flight} · {totalQty(e.mealLines)} pax · Gate 08</p>
                              <p className="text-[10px] text-slate-400">{rAcceptedAt}</p>
                            </>
                          ) : null;
                        })()}
                      </div>
                      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 text-xs">
                        {(() => {
                          const e = entries.find(x => x.id === rSelectedId);
                          return e ? [
                            ["Kitchen temp (chilled)", e.chilledTemp ? `${e.chilledTemp}°C` : "—"],
                            ["Gate 08 temp", rGateTemp ? `${rGateTemp}°C` : "—"],
                            ["Max limit", "+8°C"],
                            ["Cold chain", "✓ No breach"],
                          ].map(([label, value]) => (
                            <div key={label} className="flex justify-between">
                              <span className="text-slate-400">{label}</span>
                              <span className={`font-semibold ${String(value).includes("No breach") ? "text-emerald-600" : "text-slate-800"}`}>{value}</span>
                            </div>
                          )) : null;
                        })()}
                      </div>
                      <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 space-y-1">
                        <div className="flex items-center gap-1.5 text-xs text-sky-700 font-bold">
                          <CheckCircle2 className="h-3.5 w-3.5 text-sky-500" /> Synced to web dashboard
                        </div>
                        <p className="text-[10px] text-sky-600">Kitchen + airport records updated — Date & time auto-recorded</p>
                        <p className="text-[10px] text-sky-500 italic">Kitchen dispatch screen now shows 'APT Verified' status.</p>
                      </div>
                      <button onClick={() => { setRScreen(1); setRSelectedId(""); setRGateTemp(""); setRUnloadTime(""); setRCheck1(false); setRCheck2(false); setRCheck3(false); setRRemarks(""); setRAcceptedAt(""); }}
                        className="w-full py-2.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-600 font-semibold text-sm hover:bg-emerald-100">
                        + Receive Another
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* ═══ LOG TAB ═══ */}
              {mobileTab === "log" && (
                <div className="p-4 space-y-3">
                  {mLogEntryId ? (() => {
                    const entry = entries.find(e => e.id === mLogEntryId);
                    if (!entry) return null;
                    const f = flights.find(x => x.id === entry.flightId);
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setMLogEntryId(null)}
                            className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                            <ChevronRight className="h-4 w-4 rotate-180" />
                          </button>
                          <p className="font-bold text-slate-800 text-sm">Dispatch Details</p>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-sm text-blue-700">{f?.flight ?? entry.flightId}</span>
                            <YesNoBadge value={entry.resultSatisfy} />
                          </div>
                          {([
                            ["Dispatch ID", entry.id],
                            ["Date", entry.packagingDate],
                            ["Vehicle", entry.vehicleNo || "—"],
                            ["Vehicle Clean", entry.vehicleClean],
                            ["Total Pax", totalQty(entry.mealLines).toString()],
                            ["Chilled Temp", entry.chilledTemp ? `${entry.chilledTemp}°C` : "—"],
                            ["Frozen Temp", entry.frozenTemp ? `${entry.frozenTemp}°C` : "—"],
                            ["Veh. Temp Begin", entry.vehicleTempBegin ? `${entry.vehicleTempBegin}°C` : "—"],
                            ["Veh. Temp End", entry.vehicleTempEnd ? `${entry.vehicleTempEnd}°C` : "—"],
                            ["Gate 08 Temp", entry.gateTempGate08 ? `${entry.gateTempGate08}°C` : "—"],
                            ["Monitored At", entry.monitoredAt],
                            ["Received At", entry.receivedAt || "Awaiting receipt"],
                          ] as [string, string][]).map(([label, value]) => (
                            <div key={label} className="flex justify-between text-xs">
                              <span className="text-slate-400">{label}</span>
                              <span className="font-medium text-slate-700 text-right max-w-[55%] break-all">{value}</span>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-2">
                          <div className={`rounded-xl border p-2.5 ${entry.verifiedBy ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50 opacity-50"}`}>
                            <p className="text-[10px] font-bold text-emerald-700 mb-0.5">② Verified By (Food Safety)</p>
                            <p className="text-[11px] text-slate-600">{entry.verifiedBy ? `${entry.verifiedBy.date}, ${entry.verifiedBy.time}` : "Pending"}</p>
                            {entry.verifiedBy?.remarks && <p className="text-[10px] text-slate-400 italic mt-0.5">"{entry.verifiedBy.remarks}"</p>}
                          </div>
                          <div className={`rounded-xl border p-2.5 ${entry.approvedBy ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-slate-50 opacity-50"}`}>
                            <p className="text-[10px] font-bold text-violet-700 mb-0.5">③ Approved By (HoC)</p>
                            <p className="text-[11px] text-slate-600">{entry.approvedBy ? `${entry.approvedBy.date}, ${entry.approvedBy.time}` : "Pending"}</p>
                            {entry.approvedBy?.remarks && <p className="text-[10px] text-slate-400 italic mt-0.5">"{entry.approvedBy.remarks}"</p>}
                          </div>
                          <div className={`rounded-xl border p-2.5 ${entry.receivedAt ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-slate-50 opacity-50"}`}>
                            <p className="text-[10px] font-bold text-sky-700 mb-0.5">④ Airport Receipt</p>
                            <p className="text-[11px] text-slate-600">{entry.receivedAt || "Awaiting airport receipt"}</p>
                            {entry.receivedRemarks && <p className="text-[10px] text-slate-400 italic mt-0.5">"{entry.receivedRemarks}"</p>}
                          </div>
                        </div>
                      </>
                    );
                  })() : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-slate-800 text-sm">Dispatch Log</p>
                        <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-semibold">{entries.length} total</span>
                      </div>
                      {entries.length === 0 ? (
                        <div className="text-[11px] text-slate-400 italic text-center py-10 bg-white border border-slate-200 rounded-xl">
                          No dispatches recorded yet.<br />Complete a Kitchen Dispatch first.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {entries.map(entry => {
                            const f = flights.find(x => x.id === entry.flightId);
                            return (
                              <button key={entry.id} onClick={() => setMLogEntryId(entry.id)}
                                className="w-full text-left px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/30 transition-all">
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="font-bold text-sm text-slate-800">{f?.flight ?? entry.flightId}</span>
                                  <YesNoBadge value={entry.resultSatisfy} />
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-slate-500">
                                  <span className="font-mono">{entry.id.slice(0, 16)}…</span>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${entry.receivedAt ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                    {entry.receivedAt ? "Received" : "Awaiting"}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">{entry.monitoredAt} · {entry.vehicleNo || "—"}</div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Bottom nav */}
            <div className="bg-white border-t border-slate-200 flex shrink-0">
              <button onClick={() => setMobileTab("dispatch")}
                className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-colors ${mobileTab === "dispatch" ? "text-blue-600" : "text-slate-400"}`}>
                <Truck className="h-4 w-4" /> Dispatch
              </button>
              <button onClick={() => setMobileTab("log")}
                className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-colors ${mobileTab === "log" ? "text-blue-600" : "text-slate-400"}`}>
                <Clock className="h-4 w-4" /> Log
              </button>
              <button className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold text-slate-400">
                <User className="h-4 w-4" /> Profile
              </button>
            </div>

            {/* Home indicator */}
            <div className="bg-slate-900 flex justify-center pb-2 pt-1 shrink-0">
              <div className="w-20 h-1 rounded-full bg-white/30" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Galley Planning ──────────────────────────────────────────────────────────

function GalleySecTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-sky-700 whitespace-nowrap">{children}</span>
      <div className="flex-1 border-t border-sky-100" />
    </div>
  );
}

export type GalleyPlan = Record<string, string>;

export function buildInitialGalley(entry: DispatchEntry, flight: FlightOption | undefined): GalleyPlan {
  // Beverage/amenity/equipment quantities auto-fill from the loading standard
  // for THIS flight's aircraft type. Meals come from Dispatch, not the standard.
  const std = loadStandardsForAircraft(flight?.aircraft);
  const pax = flight?.pax ?? totalQty(entry.mealLines);
  const crew = flight?.crew ?? 7;
  const child = flight?.child ?? 0;
  const eyPax = Math.max(0, pax - child);
  // These figures only SEED the computed meal-summary + stowage numbers — the
  // actual meal breakdown is integrated from Dispatch (Order → Meal Planning →
  // Dispatch), so the split is fixed catering-policy defaults, not a standard.
  const cockpit = 2;
  const cabin = Math.max(0, crew - cockpit);
  const chickenShare = 0.40;
  const vegShare = 0.025;
  const arrShare = 0.35;
  const depChicken = Math.round(eyPax * chickenShare);
  const depBeef = eyPax - depChicken;
  const depVeg = Math.max(1, Math.round(eyPax * vegShare));
  const arrEyPax = Math.round(eyPax * arrShare);
  const arrChicken = Math.round(arrEyPax * chickenShare);
  const arrBeef = arrEyPax - arrChicken;

  const base: GalleyPlan = {
    depZenithLoad: String(pax),
    arrZenithLoad: String(Math.round(pax * 0.3)),
    traySetupDep: String(pax + Math.round(pax * 0.04)),
    traySetupArr: String(arrEyPax),
    depMealLoad: String(eyPax),
    arrMealLoad: String(arrEyPax),
    depBCPax: "0", arrBCPax: "0",
    depBCMeal: "0", arrBCMeal: "0",
    depCrewBC: "0", arrCrewBC: "0",
    depCockpit: String(cockpit), depCabin: String(cabin), depObs: "0",
    arrCockpit: String(cockpit), arrCabin: String(cabin), arrObs: "0",
    depChildPax: String(child), arrChildPax: "0",
    depChildMeal: String(child), arrChildMeal: "0",
    extHotMeal: "0",
    totalMealLoad: String(pax + crew),
    depChicken: String(depChicken),
    depBeef: String(depBeef),
    depVeg: String(depVeg),
    depChilled: "0", depDiabetic: "0", depBreakfast: "0",
    totalDepMeal: String(eyPax),
    arrChicken: String(arrChicken),
    arrBeef: String(arrBeef),
    arrVeg: String(Math.max(1, Math.round(arrEyPax * vegShare))),
    arrChilled: "0", arrDiabetic: "0",
    totalArrMeal: String(arrEyPax),
    bcDepPassMeal: "0", bcArrPassMeal: "0",
    bcDepCrewMeal: "0", bcArrCrewMeal: "0",
    bcAppetizer: "0", bcNutPkt: "0", bcDessert: "0",
    crewBreakfast: String(crew), crewLunch: String(crew),
    crewHeavySnacks: "",
    crewAppetizer: String(crew),
    crewLightSnacks: String(crew * 2),
    crewDessert: String(crew * 2),
    crewExtraLunchVeg: "1",
    crewButterJam: String(Math.round(crew * 2.5)),
    traySetupDepEY: String(pax + Math.round(pax * 0.04)),
    traySetupArrEY: String(arrEyPax),
    totalSalad: "2",
    totalFirni: String(pax + crew),
    totalCutlery: String(pax + crew),
    bcSetupDep: "", bcSetupArr: "",
    coke225: "0", pepsi225: "10", sprite225: "0", sevenUp225: "10",
    totalColdBev: "20",
    cokeCanBC: "2", spriteCanBC: "2", dietCanBC: "4", totalCanBC: "8",
    water250Pax: String(pax * 2),
    water500Crew: String(crew * 2),
    appleJuice1L: "1", mangoJuice1L: "2", orangeJuice1L: "1", totalJuice: "4",
    coffee50g: "6", coffeeMate400g: "2",
    teaBag50pcs: String(Math.max(2, Math.round(pax / 50) + 2)),
    greenTea: "10", zeroCal: "10",
    milkPowder: "1.5", sugar: "2",
    paperCup: String(Math.round((pax + crew) * 1.5)),
    saltPkt: "20", pepperPkt: "0", teaPot: "6",
    disposableSpoon: "20", extraCottage: "10", sanitizerBtl: "0",
    soda: "", lemon: "", ginger: "", tonic: "",
    dailyMedeline: "2", emkBox: "1", upkBox: "2", fanBox: "2",
    wetTissue: String(pax + crew),
    blanket: "6", napkinPaper: "8", facialTissue: "3",
    kitchenTowel: "3", handWash: "11", toiletRoll: "1",
    aerosol: "12", celeste: "2", airFreshener: "",
    surgicalGloves: "15", ovenGloves: "20", surgicalMask: "0",
    oneShot: "1",
    babyWipes: String(20 + pax),
    sicknessBag: "0",
    headRestCover: String(50 + pax),
    pillowCoverSmall: "0",
    pillowCoverBig: String(50 + pax),
    safetyCard: String(pax + crew),
    healthDeclForm: "100", baggageDeclForm: "100", bdEdCard: "20", commentsCard: "50",
    fullMealCart: String(Math.max(1, Math.ceil(pax / 45))),
    halfMealCart: String(Math.max(1, Math.round(pax / 50))),
    fullWastageCart: "1", halfWastageCart: "0",
    standardCabinet: "5", ovenCase: "6",
    ceramicMealBowl: "3", ceramicDessertBowl: "0",
    ceramicButterBowl: "0", ceramicNutBowl: "0",
    teaCupSaucer: "0", tumblerGlass: "0", snacksPlate: "2",
    teaSpoon: "3", dinnerFork: "3", dinnerSpoon: "3", dinnerKnife: "0",
    longSpoon: "3", iceTong: "1", iceBucket: "1",
    roundTraySteel: "1", serviceTrayBig: "4",
    banana: String(crew), apple: String(crew),
    preparedBy: "", physicallyHandedBy: "", flightCheckedBy: "", handedOverBy: "",
  };
  // Loading Standards (the editable scales master) override the hardcoded
  // defaults above for every quantity they cover. Meal Mix parameters were
  // already consumed above and are not plan keys.
  for (const s of std) {
    if (!isMealMixKey(s.key)) base[s.key] = String(computeStandard(s, pax, crew));
  }
  return base;
}

export function GalleyPlanningModal({
  entry,
  flight,
  initialPlan,
  onClose,
  onSaveDraft,
}: {
  entry: DispatchEntry;
  flight: FlightOption | undefined;
  /** Existing plan (forwarded record or saved draft) — re-planning starts from
   *  the last issued sheet instead of wiping it back to defaults. */
  initialPlan?: GalleyPlan;
  onClose: () => void;
  /** Save persists a draft with the chosen transfer source; the plan is
   *  forwarded to aircraft loading later from the list page (sign-off is
   *  captured on the Loading QC & Sign-Off page). */
  onSaveDraft?: (
    plan: GalleyPlan,
    source: { officeId: string; warehouseId: string },
  ) => void;
}) {
  type GTab = "overview" | "meals" | "beverages" | "amenities" | "equipment";
  const [tab, setTab] = useState<GTab>("overview");
  const [g, setG] = useState<GalleyPlan>(() => ({ ...buildInitialGalley(entry, flight), ...(initialPlan ?? {}) }));
  const sg = (k: string, v: string) => setG((prev) => ({ ...prev, [k]: v }));

  // Stock source: which office / warehouse the consumables are transferred FROM
  // when the plan is forwarded to the aircraft. Defaults to the central store.
  const [source, setSource] = useState({ officeId: "OFF-001", warehouseId: "WH-001" });
  const warehouseChoices = activeWarehousesByOffice(source.officeId);
  const changeOffice = (officeId: string) => {
    const whs = activeWarehousesByOffice(officeId);
    const keep = whs.some((w) => w.id === source.warehouseId);
    setSource({ officeId, warehouseId: keep ? source.warehouseId : whs[0]?.id ?? "" });
  };

  // Connected records: Load Summary from Order Management, Meals from Dispatch.
  const flightNo = flight?.flight ?? entry.flightId;
  const order = useMemo(() => {
    const list = getFlightOrders().filter((o) => o.orderType !== "crew" && o.flight === flightNo);
    return list.find((o) => o.date === entry.packagingDate) ?? list[0];
  }, [flightNo, entry.packagingDate]);
  const dispatchSection = useMemo(() => dispatchSectionForFlight(flightNo), [flightNo]);
  const specialTotal = (dispatchSection?.vgml ?? 0) + (dispatchSection?.chml ?? 0) + (dispatchSection?.spml ?? 0);
  // Dispatched PAX basis (sum of passenger meal lines) — special meals scale
  // against this when the load count is overridden.
  const origPax = dispatchSection?.paxLines.reduce((s, l) => s + (Number(l.qty) || 0), 0) ?? 0;

  // Load counts default from the connected order but are EDITABLE — an updated
  // record (revised PAX/crew/special meals) can arrive after the flight was
  // scheduled. Editing PAX/Crew re-derives the standard-driven quantities for
  // the new load; Special Meals is an informational override.
  const [planPax, setPlanPax] = useState<number>(order?.pax ?? flight?.pax ?? totalQty(entry.mealLines));
  const [planCrew, setPlanCrew] = useState<number>(order?.crew ?? flight?.crew ?? 7);
  // Default to the dispatched breakdown sum (VGML+CHML+SPML) so the summary
  // matches the Meals-tab total; fall back to the order-level count.
  const [specialMeals, setSpecialMeals] = useState<number>(specialTotal || order?.specialMeals || 0);

  // Aircraft type for this plan — drives which loading standard fills the
  // beverage/amenity/equipment quantities. Editable from the header, and a new
  // aircraft can be registered on the fly (shared with Configuration > Aircraft).
  // Starts UNSELECTED — the beverage/amenity/equipment (loading) tabs only appear
  // once an aircraft type is chosen, so their per-aircraft standard is applied.
  const [aircraftType, setAircraftType] = useState("");
  const [aircraftTypes, setAircraftTypes] = useState(() => {
    const list = galleyAircraftTypes();
    return flight?.aircraft && !list.includes(flight.aircraft)
      ? [...list, flight.aircraft].sort((a, b) => a.localeCompare(b))
      : list;
  });
  const [aircraftRows, setAircraftRows] = usePersistedState<Aircraft[]>("config-aircraft-rows", AIRCRAFT_SEED);
  const [airlineList] = usePersistedState<Airline[]>("config-airline-rows", AIRLINE_SEED);
  const [showAddAircraft, setShowAddAircraft] = useState(false);

  // Re-derive the whole loading sheet from a load + aircraft type — buildInitialGalley
  // pulls THAT aircraft's Loading Standard (loadStandardsForAircraft) for the
  // beverage/amenity/equipment scales and integrates meals from Dispatch. Both
  // the aircraft-type selector and the editable load counts run through this, so
  // the sheet stays connected to the aircraft's standard.
  const rebuildPlan = (pax: number, crew: number, aircraft: string) => {
    const effFlight = {
      ...(flight ?? {}),
      pax, crew,
      child: flight?.child ?? 0,
      adult: Math.max(0, pax - (flight?.child ?? 0)),
      aircraft,
    } as FlightOption;
    setG(buildInitialGalley(entry, effFlight));
  };

  // Switch the plan to another aircraft type: re-derive the sheet from that
  // type's loading standard (meals still flow from Dispatch inside buildInitialGalley).
  const applyAircraft = (type: string) => {
    setAircraftType(type);
    rebuildPlan(planPax, planCrew, type);
  };
  const onAircraftCreated = (a: Aircraft) => {
    setAircraftRows((prev) => [a, ...prev]);
    setAircraftTypes((prev) =>
      prev.includes(a.type) ? prev : [...prev, a.type].sort((x, y) => x.localeCompare(y)),
    );
    applyAircraft(a.type);
    setShowAddAircraft(false);
    toast.success(`Aircraft "${a.registration}" added — plan set to the ${a.type} loading standard.`);
  };

  // Re-derive the whole plan when the load counts are overridden, so the
  // standard-driven quantities scale to the updated PAX/Crew.
  const applyLoad = (pax: number, crew: number) => {
    setPlanPax(pax);
    setPlanCrew(crew);
    // Special meals scale with PAX (subset of passengers), so Total Meals stays
    // in step with the overridden load count.
    if (origPax > 0) setSpecialMeals(Math.round(specialTotal * pax / origPax));
    rebuildPlan(pax, crew, aircraftType);
  };

  // On first open of a FRESH plan, reconcile the seeded quantities to the
  // connected load counts (the seed uses the flight schedule PAX/crew; the order
  // may carry revised numbers). A resumed/forwarded plan keeps its saved plan.
  useEffect(() => {
    if (!initialPlan) applyLoad(planPax, planCrew);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the aircraft is cleared while on a loading tab, fall back to Load Summary.
  useEffect(() => {
    if (!aircraftType && (tab === "beverages" || tab === "amenities" || tab === "equipment")) setTab("overview");
  }, [aircraftType, tab]);

  // Editable tabs render straight from the Galley Item Master — items added on
  // the Galley Items page appear here without code changes.
  const galleyItems = useMemo(() => loadGalleyItems(), []);
  const sheetSections = useMemo(() => getGalleySections(galleyItems), [galleyItems]);
  // Auto-total fields are the sum of the items that roll up to them (never
  // hand-keyed) and merged into the plan on save/forward.
  const derivedTotals = computeAutoTotals(g, galleyItems);
  const finalPlan = (): GalleyPlan => ({ ...g, ...derivedTotals });

  // Meals integrate from Dispatch but are RESCALED to the (possibly overridden)
  // load counts: a percent-based passenger line recomputes off planPax, other
  // lines scale proportionally; crew meals scale off the original crew count.
  const scaledMeals = useMemo(
    () => scaleDispatchMeals(flightNo, planPax, planCrew, flight?.crew ?? 0)?.scaled ?? null,
    [flightNo, planPax, planCrew, flight?.crew],
  );

  // Read-only field (connected value, not editable) for the connected tabs.
  const RO = ({ label, value }: { label: string; value: string | number }) => (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium leading-tight mb-0.5">{label}</p>
      <div className="w-full h-7 px-2 text-xs border border-slate-200 rounded-md bg-slate-50 text-slate-700 tabular-nums flex items-center">
        {value === "" || value == null ? "—" : value}
      </div>
    </div>
  );

  // Sign-off (handing/taking accountability) is captured later, at the physical
  // hand-off, on the Loading QC & Sign-Off page — not here at planning time.

  function GF({ label, k, unit }: { label: string; k: string; unit?: string }) {
    // Load counts are adjustable with −/＋ steppers (clamped at 0) as well as by
    // typing directly. Non-numeric entries fall back to 0 when stepping.
    const step = (delta: number) => sg(k, String(Math.max(0, (Number(g[k]) || 0) + delta)));
    const stepBtn = "h-7 w-7 shrink-0 flex items-center justify-center rounded-md border border-input bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors";
    return (
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium leading-tight mb-0.5">{label}</p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} className={stepBtn} aria-label={`Decrease ${label}`}>
            <Minus className="h-3 w-3" />
          </button>
          <input
            type="text"
            value={g[k] ?? ""}
            onChange={(e) => sg(k, e.target.value)}
            className="w-full h-7 px-2 text-xs text-center border border-input rounded-md bg-background tabular-nums focus:ring-1 focus:ring-ring focus:outline-none"
          />
          <button type="button" onClick={() => step(1)} className={stepBtn} aria-label={`Increase ${label}`}>
            <Plus className="h-3 w-3" />
          </button>
          {unit && <span className="text-[10px] text-muted-foreground shrink-0">{unit}</span>}
        </div>
      </div>
    );
  }

  // Renders every sheet section of an item-master group as an editable grid;
  // auto-total fields render read-only with their computed value.
  const renderItemGroup = (group: "Beverages" | "Amenities" | "Equipment") => (
    <div className="space-y-5">
      {sheetSections.filter((sec) => sec.group === group).map((sec) => (
        <div key={sec.title}>
          <GalleySecTitle>{sec.title}</GalleySecTitle>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {sec.fields.map((f) =>
              f.auto
                ? <RO key={f.k} label={`${f.label} (Auto)`} value={derivedTotals[f.k] ?? "0"} />
                : <GF key={f.k} k={f.k} label={f.label} unit={f.unit} />,
            )}
          </div>
        </div>
      ))}
    </div>
  );

  // Standard galley-loading sequence: load summary → meals → beverages →
  // amenities/consumables → equipment.
  // Load Summary + Meals always show; the loading sections appear only once an
  // aircraft type is selected (their quantities come from that type's standard).
  const TABS: { key: GTab; label: string }[] = [
    { key: "overview", label: "Load Summary" },
    { key: "meals", label: "Meals" },
  ];
  if (aircraftType) {
    TABS.push(
      { key: "beverages", label: "Beverages & Tea" },
      { key: "amenities", label: "Amenities & Consumables" },
      { key: "equipment", label: "Equipment" },
    );
  }

  return (
    <>
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-full max-w-[95vw] lg:max-w-5xl max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">

        {/* Header */}
        <div className="bg-white px-6 pt-5 pb-0 shrink-0">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Galley Planning</h2>
              <div className="flex flex-wrap items-center gap-2.5 mt-1 text-xs">
                <span className="font-bold text-white bg-sky-600 px-2 py-0.5 rounded-full">
                  {flight?.flight ?? entry.flightId}
                </span>
                <span className="text-slate-600">{flight?.sector ?? "—"}</span>
                <span className="text-slate-500">{entry.packagingDate}</span>
                {/* Aircraft type — editable; sets this plan's loading standard. */}
                <span className="flex items-center gap-1">
                  <select
                    value={aircraftType}
                    onChange={(e) => applyAircraft(e.target.value)}
                    title="Aircraft type — sets the loading standard for this plan"
                    className="bg-slate-100 text-slate-700 text-xs rounded-full pl-2 pr-1 py-0.5 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer max-w-[150px]"
                  >
                    <option value="" className="text-slate-800">Select aircraft…</option>
                    {aircraftTypes.map((t) => (
                      <option key={t} value={t} className="text-slate-800">{t}</option>
                    ))}
                  </select>
                </span>
                <span className="text-slate-600">PAX: {planPax}</span>
                <span className="text-slate-600">Crew: {planCrew}</span>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded transition-colors mt-0.5">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3.5 py-2 text-[11px] font-semibold border-b-2 -mb-px transition-colors ${
                  tab === key ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
            {!aircraftType && (
              <span className="ml-2 text-[10px] text-slate-400 italic">Select an aircraft to load beverages, amenities &amp; equipment</span>
            )}
          </div>
        </div>

        {/* Stock source — where the transferred consumables are drawn from */}
        <div className="shrink-0 border-b bg-white px-6 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-sky-700 flex items-center gap-1.5">
            <Warehouse className="h-3.5 w-3.5" /> Transfer From
          </span>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-wider font-semibold">Office</span>
            <select
              value={source.officeId}
              onChange={(e) => changeOffice(e.target.value)}
              className="h-7 px-1.5 text-[11px] border border-input rounded-md bg-background focus:ring-1 focus:ring-ring focus:outline-none"
            >
              {activeOffices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-wider font-semibold">Warehouse</span>
            <select
              value={source.warehouseId}
              onChange={(e) => setSource((s) => ({ ...s, warehouseId: e.target.value }))}
              className="h-7 px-1.5 text-[11px] border border-input rounded-md bg-background focus:ring-1 focus:ring-ring focus:outline-none"
            >
              {warehouseChoices.length === 0 && <option value="">No warehouses</option>}
              {warehouseChoices.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto bg-slate-50/20 px-6 py-5">

          {tab === "overview" && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <GalleySecTitle>Flight Order</GalleySecTitle>
                </div>
                {order ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <RO label="Order #" value={order.orderNo} />
                    <RO label="Flight" value={order.flight} />
                    <RO label="Airline" value={order.airline} />
                    <RO label="Status" value={order.status} />
                    <RO label="Sector" value={order.sector} />
                    <RO label="Direction" value={order.direction} />
                    <RO label="Date" value={order.date} />
                    <RO label="ETD" value={order.etd} />
                  </div>
                ) : (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    No matching flight order found in Order Management for <strong>{flightNo}</strong>{entry.packagingDate ? ` on ${entry.packagingDate}` : ""}. Showing schedule data only.
                  </div>
                )}
              </div>
              <div>
                <GalleySecTitle>
                  Load Counts
                  <span className="ml-2 text-[9px] font-normal normal-case tracking-normal text-muted-foreground">Editable — override if an updated record arrives</span>
                </GalleySecTitle>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {/* Editable, inline (not a nested component) to keep input focus
                      through the plan-recompute re-render. */}
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium leading-tight mb-0.5">Passengers (PAX)</p>
                    <input
                      type="number" min={0} value={planPax}
                      onChange={(e) => { const v = e.target.value === "" ? 0 : Number(e.target.value); if (!Number.isNaN(v)) applyLoad(Math.max(0, v), planCrew); }}
                      className="w-full h-7 px-2 text-xs border border-input rounded-md bg-background tabular-nums focus:ring-1 focus:ring-ring focus:outline-none"
                    />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium leading-tight mb-0.5">Crew</p>
                    <input
                      type="number" min={0} value={planCrew}
                      onChange={(e) => { const v = e.target.value === "" ? 0 : Number(e.target.value); if (!Number.isNaN(v)) applyLoad(planPax, Math.max(0, v)); }}
                      className="w-full h-7 px-2 text-xs border border-input rounded-md bg-background tabular-nums focus:ring-1 focus:ring-ring focus:outline-none"
                    />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium leading-tight mb-0.5">Special Meals</p>
                    <input
                      type="number" min={0} value={specialMeals}
                      onChange={(e) => { const v = e.target.value === "" ? 0 : Number(e.target.value); if (!Number.isNaN(v)) setSpecialMeals(Math.max(0, v)); }}
                      className="w-full h-7 px-2 text-xs border border-input rounded-md bg-background tabular-nums focus:ring-1 focus:ring-ring focus:outline-none"
                    />
                  </div>
                  <RO label="Total Meals (PAX + Crew + Special)" value={planPax + planCrew + specialMeals} />
                </div>
              </div>
            </div>
          )}

          {tab === "meals" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <GalleySecTitle>Meals</GalleySecTitle>
              </div>
              {dispatchSection && scaledMeals ? (
                <>
                  <div>
                    <GalleySecTitle>Passenger Meals</GalleySecTitle>
                    <div className="rounded-lg border border-border overflow-hidden">
                      {scaledMeals.paxLines.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">No passenger meal lines.</div>
                      ) : scaledMeals.paxLines.map((l, i) => (
                        <div key={i} className={`flex items-center justify-between px-3 py-2 text-sm ${i > 0 ? "border-t border-border" : ""}`}>
                          <span className="text-slate-700">{l.itemName}{l.percent != null ? ` · ${l.percent}%` : ""}</span>
                          <span className="font-semibold tabular-nums">{l.qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {scaledMeals.crewMeals.length > 0 && (
                    <div>
                      <GalleySecTitle>Crew Meals</GalleySecTitle>
                      <div className="rounded-lg border border-border overflow-hidden">
                        {scaledMeals.crewMeals.map((c, i) => (
                          <div key={i} className={`flex items-center justify-between px-3 py-2 text-sm ${i > 0 ? "border-t border-border" : ""}`}>
                            <span className="text-slate-700">{c.type}</span>
                            <span className="font-semibold tabular-nums">{c.qty}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <GalleySecTitle>Special Meals</GalleySecTitle>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {/* Scaled to the current PAX; zero-count types hidden. */}
                      {[
                        { label: "VGML — Veg / Vegan", qty: scaledMeals.special.vgml },
                        { label: "CHML — Child", qty: scaledMeals.special.chml },
                        { label: "SPML — Special", qty: scaledMeals.special.spml },
                      ].filter((s) => s.qty > 0).map((s) => (
                        <RO key={s.label} label={s.label} value={s.qty} />
                      ))}
                      <RO label="Total Special" value={scaledMeals.specialTotal} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  No dispatch has been built for <strong>{flightNo}</strong> yet — the meal breakdown will populate here once this flight is dispatched in Packaging &amp; Dispatch.
                </div>
              )}
            </div>
          )}

          {tab === "beverages" && renderItemGroup("Beverages")}

          {tab === "amenities" && renderItemGroup("Amenities")}

          {tab === "equipment" && renderItemGroup("Equipment")}
        </div>

        {/* Footer */}
        <div className="border-t bg-white px-6 py-4 shrink-0">
          <div className="flex items-center justify-end flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button
                className="bg-sky-600 hover:bg-sky-700 text-white"
                onClick={() => {
                  if (!source.warehouseId) {
                    toast.error("Select the office and warehouse to transfer stock from.");
                    return;
                  }
                  if (onSaveDraft) onSaveDraft(finalPlan(), source);
                  else toast.success("Galley plan saved successfully");
                  onClose();
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>

      </DialogContent>
    </Dialog>

    {/* Add Aircraft — reuses the Configuration > Aircraft form. The new aircraft
        is a real fleet entry and its type is applied to this plan. */}
    <Dialog open={showAddAircraft} onOpenChange={setShowAddAircraft}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Aircraft</DialogTitle>
        </DialogHeader>
        <AircraftFields
          mode="create"
          nextId={`ACF-${String(aircraftRows.length + 1).padStart(3, "0")}`}
          airlines={airlineList}
          onSave={onAircraftCreated}
        />
      </DialogContent>
    </Dialog>
    </>
  );
}
