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
import { ListExportActions } from "@/components/common/ListExportActions";
import { filterMeta as listExportFilterMeta } from "@/lib/list-export";
import {
  Plus, Minus, Truck, Pencil, Trash2, ThermometerSun, ShieldCheck,
  AlertOctagon, AlertTriangle, PlaneTakeoff, PlaneLanding, Warehouse,
  Clock, User, CheckCircle2, Eye, Smartphone, ChevronRight, QrCode, X as CloseIcon, Timer, Play,
  Search, Package, CupSoda, Sparkles, Boxes, Save, Utensils, Coffee, ShoppingBag, UtensilsCrossed, Replace, Apple,
  BriefcaseMedical, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  flights as FLIGHT_BOARD, activeOffices, activeWarehouses, activeWarehousesByOffice,
  aircraftFleet as AIRCRAFT_SEED, airlines as AIRLINE_SEED,
  type Aircraft, type Airline,
} from "@/lib/sample-data";
import { getFlightOrders, useFlightOrders, type FlightOrder } from "@/lib/flight-orders-store";
import { INITIAL_RECORDS as DISPATCH_SEED_RECORDS, INITIAL_PACKAGING_ROWS, type PackagingRow } from "@/routes/dispatch";
import { useRole } from "@/lib/roles";
import { useWorkflow } from "@/lib/workflow-store";
import { useDispatchMonitoringSettings } from "@/lib/dispatch-monitoring-settings";
import { KpiCard } from "@/components/common/KpiCard";
import { loadStandardsForAircraft, computeStandard, isMealMixKey, galleyAircraftTypes } from "@/lib/galley-standards";
import { usePersistedState } from "@/lib/use-persisted-state";
import {
  readVehicleLoadingSessions, loadingWindowFor, completeSessionsFor, draftLoads,
  type VehicleLoadingSession, type LoadingDraft,
} from "@/lib/vehicle-loading";
import { AircraftFields, modelsForAircraftType } from "@/routes/config-aircraft";
import { getGalleySections, computeAutoTotals, loadGalleyItems } from "@/lib/galley-items";
import { getGalleyGroups } from "@/lib/galley-groups";
import { filterEnabledGalleyItems } from "@/lib/galley-item-scope";
import { createGalleyStockLookup, buildableSets } from "@/lib/galley-stock";
import { fmtQty } from "@/lib/num";
import { serviceForLeg, mealSetsForLeg, dessertSetKey, type MealService } from "@/lib/menu-meal-sets";
import { specialMealSetsForLeg, dedupeSetsByCode } from "@/lib/special-meal-sets";
import { dayFromDate, parseMealQty, loadMealPlanningConfig, type MealItem } from "@/lib/meal-planning-data";
import {
  readMealSwaps, writeMealSwaps, upsertMealSwap, removeMealSwap, applyMealSwaps,
  menuDishMaster, type MealSwap, type SwappedItem,
} from "@/lib/galley-meal-swaps";
import { addManualLmc } from "@/lib/lmc-manual";
import { getAuthUser } from "@/lib/auth";
import { leadHoursToDeparture, isLmcLead } from "@/lib/flight-orders-store";
import { flightTypeFromSector } from "@/lib/production-order-link";

/**
 * Icons a galley group may name (`GalleyGroupDef.icon`). Persisted data can only
 * carry the NAME, so this is the one place that maps a name to a component —
 * anything unknown falls back to the generic box.
 */
const GROUP_ICONS: Record<string, typeof Boxes> = {
  CupSoda, Sparkles, Boxes, Package, Utensils, Coffee, ShoppingBag, Apple,
  BriefcaseMedical, FileText,
};

// Flight options for the dispatch-monitoring form. The operational flight board
// (`FLIGHT_BOARD`) only carries a handful of flights, so every distinct flight
// number from the order book is merged in, deduped by flight code.
export type FlightOption = {
  id: string; flight: string; sector: string; aircraft: string; dep: string; arr: string;
  pax: number; adult: number; child: number; infant: number; crew: number;
  type: string; window: string; duration: string; status: string;
};

/**
 * Build the option list from an order book.
 *
 * Reads the LIVE store, not `seedFlightOrders`. The seed is only part of the
 * store's contents — orders created in-app and the demo orders generated into
 * the current window sit alongside it — so a seed-only list left real flights
 * invisible here: the `?flight=` deep link from Packaging couldn't match them
 * and fell back to opening a bare entry with no departure time, pax or crew,
 * and the Flight Number dropdown didn't offer them either.
 */
export function buildFlightOptions(orders: FlightOrder[]): FlightOption[] {
  const merged: FlightOption[] = FLIGHT_BOARD.map((f) => ({ ...f }));
  const seen = new Set(merged.map((f) => f.flight));
  for (const o of orders) {
    // A crew-meal order is a SECOND booking against the same flight number and
    // carries pax 0 — it must never become that flight's option.
    if (!o.flight || (o.orderType ?? "flight") === "crew" || seen.has(o.flight)) continue;
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
}

// Cached so the module-level resolvers below stay live without rebuilding a few
// thousand orders on every lookup — `flightNo` is called inside render loops.
// The store swaps `current` for a NEW array on every mutation, so comparing the
// array identity is a sound version check.
let optionsCache: FlightOption[] | null = null;
let optionsBuiltFrom: FlightOrder[] | null = null;
/** The live flight options. Use this over `flights` outside React. */
export function currentFlightOptions(): FlightOption[] {
  const orders = getFlightOrders();
  if (!optionsCache || optionsBuiltFrom !== orders) {
    optionsBuiltFrom = orders;
    optionsCache = buildFlightOptions(orders);
  }
  return optionsCache;
}
/** Snapshot taken at import. Kept for existing importers; inside this file the
 *  component shadows it with a reactive list, and the resolvers below re-read
 *  the live one, so neither goes stale as orders change. */
export const flights: FlightOption[] = currentFlightOptions();

// ── Constants ───────────────────────────────────────────────────────────────
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
  /** Label-scan summary captured on airport receipt. */
  containersScanned?: number;
  containersTotal?: number;
  /** Every flight loaded onto this vehicle — a load can cover several dispatches,
   *  and all of them must clear QC together, not just `flightId`. */
  loadFlights?: string[];
  /** The Dispatch-page dispatch IDs (DSP-…) this entry was raised from. */
  sourceDispatchIds?: string[];
  /** Unloading timer — starts automatically when Airport Receive opens; the
   *  ISO start drives the live elapsed display, the end stamps completion
   *  (set from the receive sheet or the row's Complete Unloading action). */
  unloadingStartedAtIso?: string;
  unloadingEndTime?: string;
};

// A dispatched meal item (one Production line) scanned on airport receipt.
// Sourced from the Dispatch table's packaging rows so the round-trip legs,
// order, and per-meal warehouse/production data all show through.
type ScanMealRow = {
  id: string;
  productionOrderId: string;
  flight: string;         // flight this batch is loaded for
  mealName: string;
  mealType: string;
  qty: number;
  warehouse: string;
  label: string;          // scannable label revealed on demand
};
type AirportLeg = {
  flight: string;
  direction: string;      // Outbound / Return
  sector: string;
  depTime: string;
  date: string;
  rows: ScanMealRow[];
  totalQty: number;
  /** Dispatch ID this leg belongs to — shown per leg card so a 20-30-dispatch
      vehicle load stays traceable without listing every ref in the header. */
  dspRef?: string;
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
type DispRecord = {
  id: string; date: string; flightNos: string[]; sections: DispSection[];
  fromWarehouseId?: string; toWarehouseId?: string;
};

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
// These resolve against the LIVE options (currentFlightOptions), not the
// import-time snapshot: they are called from other modules and from render
// paths long after orders have been created or amended.
export const flightLabel = (id: string) => { const f = currentFlightOptions().find((x) => x.id === id); return f ? `${f.flight} — ${f.sector}` : id; };
const flightNo    = (id: string) => { const f = currentFlightOptions().find((x) => x.id === id); return f ? f.flight : id; };
/** Destination airport for an entry's flight. Matches the flight board by id OR
 *  by flight number (an entry raised from a dispatch carries the number), then
 *  falls back to the order book — otherwise a real flight read "— Airport".
 *  Sectors come in both "DAC-CGP" and "DAC → DXB" forms, so split on either. */
const flightDest = (id: string) => {
  const opts = currentFlightOptions();
  const f = opts.find((x) => x.id === id) ?? opts.find((x) => x.flight === id);
  const sector = f?.sector ?? getFlightOrders().find((o) => o.flight === id)?.sector;
  if (!sector) return "—";
  const parts = sector.split(/→|->|-/).map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? "—";
};
// Meal-type badge tones for the Order Details table (Dispatch's own map is not exported).
const MEAL_TYPE_TONE: Record<string, string> = {
  Breakfast: "bg-amber-100 text-amber-700",
  Lunch: "bg-orange-100 text-orange-700",
  Dinner: "bg-indigo-100 text-indigo-700",
  Snack: "bg-sky-100 text-sky-700",
  Special: "bg-fuchsia-100 text-fuchsia-700",
};
/**
 * The other legs on this entry's vehicle, beyond its primary flight.
 *
 * One entry records the WHOLE load, so a round trip loaded as one run is a
 * single row — which showed the outbound leg only and left the return with no
 * trace on this sheet at all. Every leg the entry covers is named on the row.
 */
function otherLegs(entry: DispatchEntry): string[] {
  const primary = flightNo(entry.flightId);
  return [...new Set(entry.loadFlights ?? [])].filter((f) => f && f !== primary);
}

/** Status shown on a draft row — a vehicle load whose entry isn't saved yet. */
function draftStatusBadge(d: LoadingDraft) {
  return d.endHm
    ? { label: "Draft · Loaded", cls: "bg-amber-100 text-amber-800" }
    : { label: "Draft · Loading", cls: "bg-amber-100 text-amber-800" };
}

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

  // Deliberately SHADOWS the module-level `flights` snapshot for the whole
  // component, so every lookup, dropdown and deep-link match below reads the
  // live order book and re-renders when it changes. Shadowing rather than
  // renaming keeps the ~30 existing call sites honest: there is one definition
  // of "the flights this page knows about", and it cannot silently go stale.
  const liveFlightOrders = useFlightOrders();
  const flights = useMemo(() => buildFlightOptions(liveFlightOrders), [liveFlightOrders]);
  const DEP_TIMES = useMemo(() => [...new Set(flights.map((f) => f.dep))].sort(), [flights]);

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
  // Flights loaded onto this one vehicle beyond form.flightId — a vehicle load
  // selected across several dispatches on the Dispatch page.
  const [extraFlights, setExtraFlights] = useState<string[]>([]);
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
  // Airport Receive — "Time of Unloading" Start/End timer (self-contained; the
  // start time is written into form.unloadingTime, the end time is UI-only).
  const [unloadStartIso, setUnloadStartIso] = useState("");
  const [unloadEndTime, setUnloadEndTime] = useState("");
  const [unloadTimerTick, setUnloadTimerTick] = useState(0);
  const [fsRemarksInput, setFsRemarksInput] = useState("");
  const [hocRemarksInput, setHocRemarksInput] = useState("");
  // Vehicle-loading sessions recorded on the Dispatch page. Polled rather than
  // read once: the writer lives on another page, and localStorage's `storage`
  // event only fires for OTHER tabs — never the one that navigated here — so a
  // load started (or completed) while this page stays mounted in the tab bar
  // would otherwise never show up. The state only changes when the stored JSON
  // does, so a quiet page re-renders no more than it does today.
  const [loadingSessions, setLoadingSessions] = useState<Record<string, VehicleLoadingSession>>(
    () => readVehicleLoadingSessions(),
  );
  useEffect(() => {
    const pull = () => setLoadingSessions((prev) => {
      const next = readVehicleLoadingSessions();
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
    pull();
    const id = setInterval(pull, 2000);
    return () => clearInterval(id);
  }, []);
  // Daily Product Dispatch Monitoring — table search + date-range filter.
  const [dmSearch, setDmSearch] = useState("");
  const [dmStatus, setDmStatus] = useState("all");
  const [dmFrom, setDmFrom] = useState("");
  const [dmTo, setDmTo] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkHandled = useRef(false);
  const { markFlightQcCleared, addDispatchApproval, dispatchApprovals } = useWorkflow();
  const navigate = useNavigate();
  const qcOnlyMode = searchParams.get("mode") === "qc-only";

  // ── Airport receive panel state ──────────────────────────────────────────────
  const [showAirportPanel, setShowAirportPanel] = useState(false);
  const [isAirportReceiveMode, setIsAirportReceiveMode] = useState(false);
  // Dispatched batch lines — sourced from the Dispatch table's packaging rows.
  const [dispatchPackagingRows] = usePersistedState<PackagingRow[]>("dispatch-packaging-rows", INITIAL_PACKAGING_ROWS);
  const [orderDetailFlight, setOrderDetailFlight] = useState<string | null>(null);
  // Gate temperature locks once entered (recorded value can't be changed).
  const [gateTempLocked, setGateTempLocked] = useState(false);
  // Dispatched-batch table filters.
  const [batchFrom, setBatchFrom] = useState("");
  const [batchTo, setBatchTo] = useState("");
  // Other pending dispatches checked for co-receiving in this one entry —
  // several vehicle loads can arrive together and be received as a single
  // Airport Point Receiving Entry.
  const [coReceiveIds, setCoReceiveIds] = useState<Set<string>>(new Set());
  // Row selection on the monitoring table itself — batch Airport Receive /
  // Complete Unloading across several dispatches at a time (the per-flight
  // row actions stay available alongside).
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());

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

  // Fetch the dispatch being received from the Dispatch table (persisted
  // packaging rows), matched by the entry's flight. This surfaces the whole
  // round trip — both legs, the order #, and every meal's production/warehouse
  // — instead of the monitoring entry's own thin meal lines.
  const airportDispatch = useMemo<{ dispatchId: string; orderNo: string; legs: AirportLeg[]; sourceRefs: string[] }>(() => {
    const fno = flightNo(form.flightId);
    // Every flight on this vehicle: the form's own flight plus any others loaded
    // with it. Each contributes its whole dispatch (dspRef) so a round trip still
    // pulls both of its legs.
    const loadFlights = [fno, ...extraFlights.filter((f) => f && f !== fno)];
    const myRows = dispatchPackagingRows.filter((r) => r.flight === fno);
    const dspRef = myRows[0]?.dspRef;
    const orderNo = myRows[0]?.orderNo;
    const dspRefs = new Set(
      loadFlights
        .flatMap((f) => dispatchPackagingRows.filter((r) => r.flight === f).map((r) => r.dspRef))
        .filter(Boolean) as string[],
    );
    const allRows = dspRefs.size > 0
      ? dispatchPackagingRows.filter((r) => (r.dspRef && dspRefs.has(r.dspRef)) || loadFlights.includes(r.flight))
      : dispatchPackagingRows.filter((r) => loadFlights.includes(r.flight));
    const orders = getFlightOrders();
    const toRow = (r: PackagingRow): ScanMealRow => ({
      id: r.id,
      productionOrderId: r.productionOrderId ?? "—",
      flight: r.flight,
      mealName: r.mealName,
      mealType: r.mealType,
      qty: r.qty,
      warehouse: r.section,
      // Exact label printed at the catering point (matches Dispatch's labelCode).
      label: `LBL-${r.id}`,
    });

    if (allRows.length > 0) {
      const legFlights: string[] = [];
      for (const r of allRows) if (!legFlights.includes(r.flight)) legFlights.push(r.flight);
      const legs: AirportLeg[] = legFlights.map((lf) => {
        const rows = allRows.filter((r) => r.flight === lf);
        const fo = orders.find((o) => o.flight === lf && (!orderNo || o.orderNo === orderNo)) ?? orders.find((o) => o.flight === lf);
        const meta = flights.find((f) => f.flight === lf);
        return {
          flight: lf,
          direction: fo?.direction ?? "Outbound",
          sector: fo?.sector ?? meta?.sector ?? "—",
          depTime: rows[0]?.depTime ?? meta?.dep ?? "—",
          date: rows[0]?.date ?? "—",
          rows: rows.map(toRow),
          totalQty: rows.reduce((s, r) => s + r.qty, 0),
          dspRef: rows.find((r) => r.dspRef)?.dspRef,
        };
      });
      return { dispatchId: dspRef ?? formDispatchNo, orderNo: orderNo ?? "—", legs, sourceRefs: [...dspRefs] };
    }

    // Fallback — no Dispatch-table match: show the entry's own meal lines as one leg.
    const rows: ScanMealRow[] = form.mealLines.filter((l) => l.qty).map((l, i) => ({
      id: `ml-${i}`, productionOrderId: "—", flight: fno, mealName: l.type, mealType: "Regular",
      qty: Number(l.qty) || 0, warehouse: "—", label: `LBL-${formDispatchNo}-${i + 1}`,
    }));
    return {
      dispatchId: formDispatchNo,
      orderNo: "—",
      legs: rows.length ? [{
        flight: fno, direction: "Outbound", sector: selectedFlight?.sector ?? "—",
        depTime: selectedFlight?.dep ?? "—", date: form.packagingDate, rows,
        totalQty: rows.reduce((s, r) => s + r.qty, 0),
      }] : [],
      sourceRefs: [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.flightId, extraFlights, form.mealLines, form.packagingDate, dispatchPackagingRows, formDispatchNo]);

  const airportScanRows = airportDispatch.legs.flatMap((l) => l.rows);
  // From/To warehouse of the dispatch being received — these are the real
  // cold-chain endpoints (configured on the dispatch record), shown on the
  // kitchen → gate visual instead of hardcoded labels.
  const dispatchWarehouses = useMemo(() => {
    const ids = new Set([airportDispatch.dispatchId, ...airportDispatch.sourceRefs]);
    const rec = loadDispatchRecords().find((r) => ids.has(r.id));
    if (!rec) return { from: undefined, to: undefined };
    // Same defaults dispatch.tsx applies when it raises the Transfer Note, so a
    // record configured before the warehouse pickers still reads consistently.
    return {
      from: activeWarehouses.find((w) => w.id === (rec.fromWarehouseId ?? "WH-003"))?.name,
      to: activeWarehouses.find((w) => w.id === (rec.toWarehouseId ?? "WH-001"))?.name,
    };
  }, [airportDispatch]);
  // Catering-point loading is no longer scanned batch-by-batch inside this
  // sheet — the Dispatch page's Actions column records Start/Complete Loading
  // per dispatch run, and the Load Start/End fields below pre-fill from it.
  // Batch table rows after the date-range filter.
  const visibleLegs = airportDispatch.legs.filter((leg) => {
    if (batchFrom && leg.date < batchFrom) return false;
    if (batchTo && leg.date > batchTo) return false;
    return true;
  });

  // Other dispatches waiting at the airport — several vehicle loads can arrive
  // together, so the receive sheet lists them with checkboxes and one Save
  // receives every ticked dispatch alongside the opened one.
  const coReceivable = entries.filter((e) => e.approvalStage >= 3 && !e.receivedAt && e.id !== editId);

  // Full batch records for the TICKED co-dispatches: an unticked dispatch stays
  // a one-line summary, a ticked one expands into its real legs (same detail as
  // the opened dispatch — per-leg meals, order, production rows).
  const coReceiveLegs = useMemo(() => {
    const primary = new Set(airportDispatch.legs.map((l) => l.flight));
    const orders = getFlightOrders();
    const map = new Map<string, AirportLeg[]>();
    for (const e of entries) {
      if (!coReceiveIds.has(e.id)) continue;
      const flightsOfE = [...new Set([flightNo(e.flightId), ...(e.loadFlights ?? [])])]
        .filter((f) => f && !primary.has(f));
      const legs: AirportLeg[] = [];
      for (const lf of flightsOfE) {
        const rows = dispatchPackagingRows.filter((r) => r.flight === lf);
        if (rows.length === 0) {
          // No Dispatch-table match — fall back to the entry's own meal lines.
          legs.push({
            flight: lf,
            direction: "Outbound",
            sector: flights.find((f) => f.flight === lf)?.sector ?? "—",
            depTime: flights.find((f) => f.flight === lf)?.dep ?? "—",
            date: e.packagingDate,
            rows: e.mealLines.filter((l) => l.qty).map((l, i) => ({
              id: `${e.id}-ml-${i}`, productionOrderId: "—", flight: lf, mealName: l.type,
              mealType: "Regular", qty: Number(l.qty) || 0, warehouse: "—", label: `LBL-${e.id}-${i + 1}`,
            })),
            totalQty: totalQty(e.mealLines),
            dspRef: e.sourceDispatchIds?.[0] ?? e.dispatchNo,
          });
          continue;
        }
        const fo = orders.find((o) => o.flight === lf);
        legs.push({
          flight: lf,
          direction: fo?.direction ?? "Outbound",
          sector: fo?.sector ?? flights.find((f) => f.flight === lf)?.sector ?? "—",
          depTime: rows[0]?.depTime ?? flights.find((f) => f.flight === lf)?.dep ?? "—",
          date: rows[0]?.date ?? e.packagingDate,
          rows: rows.map((r) => ({
            id: r.id, productionOrderId: r.productionOrderId ?? "—", flight: r.flight,
            mealName: r.mealName, mealType: r.mealType, qty: r.qty, warehouse: r.section, label: `LBL-${r.id}`,
          })),
          totalQty: rows.reduce((s, r) => s + r.qty, 0),
          dspRef: rows.find((r) => r.dspRef)?.dspRef ?? e.sourceDispatchIds?.[0] ?? e.dispatchNo,
        });
      }
      map.set(e.id, legs);
    }
    return map;
  }, [coReceiveIds, entries, dispatchPackagingRows, airportDispatch]);

  const openOrderDetails = (flight: string) => { setOrderDetailFlight(flight); };

  const handleFlightSelect = (flightId: string) => {
    const f = flights.find((x) => x.id === flightId);
    // Loading recorded for this flight on the Dispatch page pre-fills the
    // Load Start/End times (unless something already filled them).
    const win = loadingWindowFor(readVehicleLoadingSessions(), f ? [f.flight] : []);
    setForm((prev) => ({
      ...prev,
      flightId,
      packagingDate: todayStr,
      mealLines: f ? [{ type: "Regular", qty: f.pax.toString() }] : prev.mealLines,
      loadStartTime: prev.loadStartTime || win.start || prev.loadStartTime,
      loadEndTime: prev.loadEndTime || win.end || prev.loadEndTime,
    }));
  };

  const resetForm = () => {
    setShowForm(false); setEditId(null); setForm({ ...EMPTY_FORM }); setDepTime(""); setErrors({});
    setShowAirportPanel(false); setIsAirportReceiveMode(false);
    setUnloadStartIso(""); setUnloadEndTime(""); setUnloadTimerTick(0);
    setOrderDetailFlight(null); setGateTempLocked(false);
    setCoReceiveIds(new Set());
  };

  const openNew = () => {
    setForm({ ...EMPTY_FORM }); setDepTime(""); setEditId(null); setErrors({});
    setFsRemarksInput(""); setHocRemarksInput(""); setShowForm(true);
    setExtraFlights([]);
  };

  /**
   * Open a NEW monitoring entry for one vehicle load: its primary flight plus
   * every other leg on the same vehicle, with the Load Start/End already
   * recorded on the Dispatch page pulled in. Shared by the ?flight= deep link
   * and by the draft rows, so a load picked up later opens exactly as it would
   * have when it was started.
   */
  const openEntryForFlights = (primary: string, others: string[]) => {
    const f = flights.find((x) => x.flight === primary);
    openNew();
    setExtraFlights(others.filter((x) => x !== primary));
    // Earliest start / latest end across the runs on this vehicle.
    const win = loadingWindowFor(readVehicleLoadingSessions(), [...new Set([primary, ...others])]);
    if (win.start) sf("loadStartTime", win.start);
    if (win.end) sf("loadEndTime", win.end);
    if (f) {
      setDepTime(f.dep);
      handleFlightSelect(f.id);
      toast.info(`Dispatch monitoring opened for flight ${primary}.`);
    } else if (dispatchPackagingRows.some((r) => r.flight === primary)) {
      // Directly-packaged production associated to a flight order not in the
      // schedule list. flightNo(id) falls back to the id, so airportDispatch
      // still resolves its batch for scanning.
      setForm((prev) => ({ ...prev, flightId: primary, packagingDate: todayStr }));
      toast.info(`Dispatch entry opened for ${primary}.`);
    } else {
      toast.info(`New dispatch entry — flight ${primary} isn't in the flight list, please select it manually.`);
    }
  };

  /** Resume an unsaved vehicle load from its draft row. */
  const openDraft = (d: LoadingDraft) => {
    const primary = d.flights[0];
    if (!primary) { toast.error("This vehicle load has no flight on it."); return; }
    openEntryForFlights(primary, d.flights.slice(1));
  };

  // Deep link from Packaging & Dispatch → "Initiate QC": open a new monitoring
  // entry pre-scoped to the flight number passed via ?flight=BS-225.
  useEffect(() => {
    if (deepLinkHandled.current) return;
    const flightNo = searchParams.get("flight");
    if (!flightNo) return;
    deepLinkHandled.current = true;
    // A vehicle load selected across several dispatches arrives as ?flights=a,b,c.
    const others = (searchParams.get("flights") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    openEntryForFlights(flightNo, others);
    // Clear the param so a refresh / re-render doesn't reopen the form.
    searchParams.delete("flight");
    searchParams.delete("flights");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /**
   * Pick up the loading times while the form is OPEN.
   *
   * Load End is recorded on a different page (Dispatch → Complete Loading), and
   * both existing prefills are one-shot: the deep-link effect above runs once on
   * arrival — when the load has only just started, so there is no end time yet —
   * and handleFlightSelect only fires when a flight is picked. So completing the
   * load left this form sitting on a filled Load Start and a blank Load End with
   * no way to pull it in short of retyping it.
   *
   * Polling is the honest mechanism here: the sessions live in localStorage, and
   * the `storage` event only fires for OTHER tabs, never the one that navigated.
   * It stops as soon as an end time lands (the effect re-runs and bails).
   */
  useEffect(() => {
    if (!showForm || form.loadEndTime) return;
    const flight = flights.find((f) => f.id === form.flightId)?.flight ?? form.flightId;
    if (!flight) return;
    const legs = [...new Set([flight, ...extraFlights])];
    const pull = () => {
      const win = loadingWindowFor(readVehicleLoadingSessions(), legs);
      if (!win.start && !win.end) return;
      setForm((prev) => {
        // Never overwrite what the user typed — only fill what is still blank.
        const start = prev.loadStartTime || win.start || "";
        const end = prev.loadEndTime || win.end || "";
        if (start === prev.loadStartTime && end === prev.loadEndTime) return prev;
        return { ...prev, loadStartTime: start, loadEndTime: end };
      });
    };
    pull();
    const id = setInterval(pull, 2000);
    return () => clearInterval(id);
  }, [showForm, form.loadEndTime, form.loadStartTime, form.flightId, extraFlights, flights]);

  // Sync galley records to sessionStorage whenever they change
  useEffect(() => { saveGalleyRecords(galleyRecords); }, [galleyRecords]);

  // Live timer tick — re-renders every second while a galley-loading session or
  // an airport unloading timer is active.
  useEffect(() => {
    const hasActive =
      galleyRecords.some((r) => r.galleyStatus === "loading") ||
      entries.some((e) => e.approvalStage >= 3 && !e.receivedAt && e.unloadingStartedAtIso && !e.unloadingEndTime);
    if (!hasActive) return;
    const id = setInterval(() => setTickCount((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [galleyRecords, entries]);

  // Unloading timer tick — re-renders every second while the Airport Receive
  // unloading timer is running.
  useEffect(() => {
    if (!unloadStartIso) return;
    const id = setInterval(() => setUnloadTimerTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [unloadStartIso]);



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
    setUnloadTimerTick(0);
    // Unloading is NOT started by hand: opening the receiving entry IS the
    // start. Persisted on the entry so the timer survives closing the sheet
    // and can be completed from the row's Complete Unloading action too.
    if (entry.unloadingEndTime) {
      setUnloadStartIso("");
      setUnloadEndTime(entry.unloadingEndTime);
    } else if (entry.unloadingTime) {
      // Already running from an earlier open — resume the elapsed display.
      setUnloadStartIso(entry.unloadingStartedAtIso ?? "");
      setUnloadEndTime("");
    } else {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      sf("unloadingTime", hhmm);
      setUnloadStartIso(now.toISOString());
      setUnloadEndTime("");
      setEntries((prev) => prev.map((e) =>
        e.id === entry.id ? { ...e, unloadingTime: hhmm, unloadingStartedAtIso: now.toISOString() } : e));
      toast.info(`Unloading timer started automatically at ${hhmm}.`);
    }
    // The dispatched items are fetched live from the Dispatch table via the
    // airportDispatch memo.
    setOrderDetailFlight(null);
    setGateTempLocked(!!entry.gateTempGate08);
    setBatchFrom(""); setBatchTo("");
    setCoReceiveIds(new Set());
  };

  /** Stop the unloading timer for an entry — from the receive sheet's button
   *  or the monitoring row's Complete Unloading action ("outside"). */
  const completeUnloading = (entryId: string) => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setEntries((prev) => prev.map((e) =>
      e.id === entryId && !e.unloadingEndTime ? { ...e, unloadingEndTime: hhmm } : e));
    if (editId === entryId) { setUnloadEndTime(hhmm); setUnloadStartIso(""); }
    toast.success(`Unloading completed at ${hhmm}.`);
  };

  // ── Batch actions from the monitoring table selection ────────────────────────
  const isReceivable = (e: DispatchEntry) => e.approvalStage >= 3 && !e.receivedAt;

  /** Open ONE Airport Receive entry for every selected dispatch: the first
   *  selected opens the sheet, the rest arrive pre-ticked for co-receiving. */
  const receiveSelected = () => {
    const sel = entries.filter((e) => selectedEntryIds.has(e.id) && isReceivable(e));
    if (sel.length === 0) { toast.error("Select at least one dispatch awaiting airport receive."); return; }
    const [first, ...rest] = sel;
    openAirportReceive(first);
    // After openAirportReceive's reset, pre-tick the other selected dispatches.
    setCoReceiveIds(new Set(rest.map((e) => e.id)));
    setSelectedEntryIds(new Set());
    if (rest.length > 0) {
      toast.info(`${rest.length} more dispatch${rest.length > 1 ? "es" : ""} pre-ticked to receive in this same entry.`);
    }
  };

  /** Complete unloading for every selected dispatch with a running timer. */
  const completeUnloadingSelected = () => {
    const ids = entries
      .filter((e) => selectedEntryIds.has(e.id) && isReceivable(e) && e.unloadingTime && !e.unloadingEndTime)
      .map((e) => e.id);
    if (ids.length === 0) { toast.error("None of the selected dispatches has a running unloading timer."); return; }
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setEntries((prev) => prev.map((e) => (ids.includes(e.id) ? { ...e, unloadingEndTime: hhmm } : e)));
    if (editId && ids.includes(editId)) { setUnloadEndTime(hhmm); setUnloadStartIso(""); }
    setSelectedEntryIds(new Set());
    toast.success(`Unloading completed for ${ids.length} dispatch${ids.length > 1 ? "es" : ""} at ${hhmm}.`);
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
    // Real flights resolve to their flight number; a directly-packaged production
    // uses its own id as the flight key so its QC still clears (unlocks dispatch).
    const flightNo = flights.find((f) => f.id === form.flightId)?.flight ?? form.flightId;
    // Clear EVERY flight this entry covers, not just the form's own. One vehicle
    // load can carry several dispatches; clearing only the first left the others
    // stuck short of "Initiate Dispatch" even though they were loaded and checked.
    const clearedFlights = [...new Set([flightNo, ...airportDispatch.legs.map((l) => l.flight)].filter(Boolean))];
    for (const f of clearedFlights) markFlightQcCleared(f, at);
    // A Load End typed here (instead of Complete Loading on the Dispatch page)
    // must still stop that page's running timer — close the covered sessions.
    completeSessionsFor(clearedFlights, form.loadEndTime);
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
      // Every flight on this vehicle, so a later approval clears them all rather
      // than only the entry's primary flight.
      loadFlights: clearedFlights,
      sourceDispatchIds: airportDispatch.sourceRefs,
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

  /**
   * Receipt-side validation. The full validate() checks the CATERING-POINT
   * fields (vehicle no, load times, vehicle temps) — which this screen hides,
   * because they were captured upstream when the load left. Running it here
   * failed on entries raised from a dispatch (those fields are blank) and set
   * errors onto inputs the receiver cannot see, so the button did nothing.
   */
  const validateReceipt = () => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.flightId) e.flightId = "Flight is required.";
    if (vehOOR(form.gateTempGate08) && !form.ackGate08) e.ackGate08 = "Acknowledge exceeds +8°C.";
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error(Object.values(e)[0] ?? "Complete the receipt before accepting.");
      return false;
    }
    return true;
  };

  const acceptReceipt = () => {
    if (!validateReceipt()) return;
    const label = flightLabel(form.flightId);
    const at = nowTimeStr();
    // Accepting closes the receipt — any unloading timer still running (on this
    // entry or a co-received one) stops at the accept time.
    const acceptHm = at.split(" ")[1] ?? "";
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
      // Item-level scanning was removed from Airport Receive — accepting the
      // receipt covers the whole dispatched load.
      containersScanned: airportScanRows.length,
      containersTotal: airportScanRows.length,
      unloadingStartedAtIso: existing?.unloadingStartedAtIso,
      unloadingEndTime: existing?.unloadingEndTime || unloadEndTime || acceptHm,
    };
    if (editId) {
      setEntries((prev) => prev.map((e) => e.id === editId ? { ...e, ...base } : e));
    } else {
      const newId = `DSP-${Date.now()}`;
      setEntries((prev) => [{ id: newId, ...base }, ...prev]);
      setEditId(newId);
    }
    // Co-receive every ticked pending dispatch in this same entry — one arrival,
    // one receipt, several dispatch records closed.
    if (coReceiveIds.size > 0) {
      setEntries((prev) => prev.map((e) =>
        coReceiveIds.has(e.id) && !e.receivedAt
          ? {
              ...e,
              receivedAt: at,
              receivedRemarks: form.receiverRemarks,
              gateTempGate08: e.gateTempGate08 || form.gateTempGate08,
              unloadingTime: e.unloadingTime || form.unloadingTime,
              unloadingEndTime: e.unloadingEndTime || acceptHm,
            }
          : e));
    }
    toast.success(
      coReceiveIds.size > 0
        ? `Receipt accepted — ${label} + ${coReceiveIds.size} more dispatch${coReceiveIds.size > 1 ? "es" : ""}.`
        : `Receipt accepted — ${label}`,
    );
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
        // Clear every flight the load covered, not only the primary one.
        const flightNo = flights.find((f) => f.id === entry.flightId)?.flight ?? entry.flightId;
        const covered = entry.loadFlights?.length ? entry.loadFlights : [flightNo];
        for (const f of covered) if (f) markFlightQcCleared(f, nowTimeStr());
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

  /** Vehicle loads with no monitoring entry behind them yet — listed as draft
   *  rows that reopen the entry with everything already known filled in. */
  const loadingDrafts: LoadingDraft[] = useMemo(() => {
    const coveredFlights: string[] = [];
    const coveredRefs: string[] = [];
    for (const e of entries) {
      coveredFlights.push(flightNo(e.flightId), ...(e.loadFlights ?? []));
      coveredRefs.push(...(e.sourceDispatchIds ?? []));
    }
    return draftLoads(loadingSessions, coveredFlights, coveredRefs);
  }, [entries, loadingSessions]);

  // Rows shown in the table after applying the search box + date-range filter.
  // KPI totals above stay based on the full `entries` set.
  const dmQuery = dmSearch.trim().toLowerCase();
  const visibleEntries = entries.filter((e) => {
    if (dmStatus !== "all" && dispatchStatusBadge(e).label !== dmStatus) return false;
    if (dmFrom && e.packagingDate < dmFrom) return false;
    if (dmTo && e.packagingDate > dmTo) return false;
    if (dmQuery) {
      const hay = `${flightNo(e.flightId)} ${otherLegs(e).join(" ")} ${doc.originLabel} ${flightDest(e.flightId)} ${dispatchStatusBadge(e).label}`.toLowerCase();
      if (!hay.includes(dmQuery)) return false;
    }
    return true;
  });

  // Drafts obey the same toolbar filters. No saved entry ever carries a "Draft"
  // status, so picking it in the dropdown shows the outstanding loads alone.
  const visibleDrafts = loadingDrafts.filter((d) => {
    if (dmStatus !== "all" && dmStatus !== "Draft") return false;
    if (dmFrom && d.date < dmFrom) return false;
    if (dmTo && d.date > dmTo) return false;
    if (dmQuery) {
      const hay = `${d.flights.join(" ")} ${d.dspRef ?? ""} ${doc.originLabel} ${draftStatusBadge(d).label}`.toLowerCase();
      if (!hay.includes(dmQuery)) return false;
    }
    return true;
  });

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

      {/* Toolbar — search, date-range filter, and shortcut to Transfer In Transit */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={dmSearch}
            onChange={(e) => setDmSearch(e.target.value)}
            placeholder="Search flight, sector, status…"
            className="h-9 pl-9"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Status</span>
          <Select value={dmStatus} onValueChange={setDmStatus}>
            <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="Draft">Draft (not saved)</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Verified">Verified</SelectItem>
              <SelectItem value="Forwarded to Airport">Forwarded to Airport</SelectItem>
              <SelectItem value="Received by Airport">Received by Airport</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">From</span>
          <Input type="date" value={dmFrom} onChange={(e) => setDmFrom(e.target.value)}
            className="h-9 w-36 tabular-nums" />
          <span className="text-xs text-muted-foreground whitespace-nowrap">To</span>
          <Input type="date" value={dmTo} onChange={(e) => setDmTo(e.target.value)}
            className="h-9 w-36 tabular-nums" />
          {(dmFrom || dmTo || dmSearch || dmStatus !== "all") && (
            <Button size="sm" variant="ghost" className="h-9 text-xs text-muted-foreground"
              onClick={() => { setDmFrom(""); setDmTo(""); setDmSearch(""); setDmStatus("all"); }}>
              Clear
            </Button>
          )}
        </div>
        <div className="ml-auto">
          <ListExportActions
            table={() => ({
              title: `${doc.title} — Dispatch Monitoring`,
              fileName: `dispatch-monitoring-${dmFrom || "all"}${dmTo && dmTo !== dmFrom ? `_to_${dmTo}` : ""}`,
              meta: listExportFilterMeta([
                ["Dates", (dmFrom || dmTo) && `${dmFrom || "…"} → ${dmTo || "…"}`],
                ["Status", dmStatus !== "all" && dmStatus],
                ["Search", dmSearch.trim() || false],
              ]),
              columns: ["Flight", "Destination", "Date", "Vehicle", "Vehicle Clean", "Chilled Temp", "Frozen Temp", "Result", "Status"],
              rows: [
                // Unsaved vehicle loads print as they appear on screen — the
                // columns they have no answer for yet stay blank.
                ...visibleDrafts.map((d) => [
                  d.flights.join(" / "), flightDest(d.flights[0] ?? ""), d.date,
                  "", "", "", "", "", draftStatusBadge(d).label,
                ]),
                ...visibleEntries.map((e) => [
                  [flightNo(e.flightId), ...otherLegs(e)].join(" / "), flightDest(e.flightId), e.packagingDate,
                  e.vehicleNo ?? "", e.vehicleClean ?? "", e.chilledTemp ?? "", e.frozenTemp ?? "",
                  e.resultSatisfy ?? "", dispatchStatusBadge(e).label,
                ]),
              ],
            })}
          />
        </div>
      </div>

      {/* Entries Table */}
      {(entries.length > 0 || loadingDrafts.length > 0) && (() => {
        const receivableVisible = visibleEntries.filter(isReceivable);
        const allReceivableSelected = receivableVisible.length > 0 && receivableVisible.every((e) => selectedEntryIds.has(e.id));
        return (
        <>
        {selectedEntryIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2">
            <span className="text-xs font-semibold text-indigo-700">
              {selectedEntryIds.size} dispatch{selectedEntryIds.size > 1 ? "es" : ""} selected
            </span>
            <Button size="sm" className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0" onClick={receiveSelected}>
              <PlaneLanding className="h-3 w-3 mr-1" /> Airport Receive Together
            </Button>
            <Button size="sm" className="h-7 px-3 text-xs bg-teal-600 hover:bg-teal-700 text-white border-0" onClick={completeUnloadingSelected}>
              <CheckCircle2 className="h-3 w-3 mr-1" /> Complete Unloading
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setSelectedEntryIds(new Set())}>
              Clear
            </Button>
          </div>
        )}
        <div className="rounded-xl border border-border bg-card overflow-x-auto mb-6 shadow-sm">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 850 }}>
            <thead>
              <tr className="bg-slate-100 text-slate-600 border-b border-border">
                <th className="px-3 py-2.5 w-8 sticky left-0 z-10 bg-slate-100 text-center">
                  <Checkbox
                    checked={allReceivableSelected}
                    onCheckedChange={() => setSelectedEntryIds(() =>
                      allReceivableSelected ? new Set<string>() : new Set(receivableVisible.map((e) => e.id)))}
                    className="h-3.5 w-3.5"
                    title="Select every dispatch awaiting airport receive"
                    disabled={receivableVisible.length === 0}
                  />
                </th>
                {([
                  ["Flt No.", false, false],
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
              {visibleEntries.length === 0 && visibleDrafts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                    No dispatches match the current search / date filter.
                  </td>
                </tr>
              )}
              {/* Vehicle loads started but not saved yet — first, so the work
                  still owed sits above the completed records. */}
              {visibleDrafts.map((d) => (
                <tr key={`draft-${d.key}`} className="border-b border-amber-200 bg-amber-50/70 hover:bg-amber-50 transition-colors">
                  <td className="px-3 py-2 sticky left-0 z-10 bg-inherit text-center" />
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="font-semibold text-amber-900">{d.flights[0] ?? "—"}</span>
                    {d.flights.length > 1 && (
                      <div className="text-[10px] text-amber-700">+ {d.flights.slice(1).join(", ")}</div>
                    )}
                    {d.dspRef && <div className="text-[10px] text-amber-700/80">{d.dspRef}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{d.date}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {d.date} {d.startHm}{d.endHm ? ` → ${d.endHm}` : ""}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{doc.originLabel} Point</td>
                  <td className="px-3 py-2 whitespace-nowrap font-medium">{flightDest(d.flights[0] ?? "")} Airport</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {(() => { const s = draftStatusBadge(d); return (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.cls}`}>
                        {!d.endHm && <Timer className="h-2.5 w-2.5 inline mr-0.5 -mt-px" />}{s.label}
                      </span>
                    ); })()}
                  </td>
                  <td className="px-3 py-2 sticky right-0 z-10 bg-inherit">
                    <Button
                      size="sm"
                      className="h-6 px-2.5 text-[10px] bg-amber-600 hover:bg-amber-700 text-white border-0"
                      onClick={() => openDraft(d)}
                      title="Open the dispatch entry for this vehicle load and finish it"
                    >
                      <Pencil className="h-3 w-3 mr-1" /> Continue Entry
                    </Button>
                  </td>
                </tr>
              ))}
              {visibleEntries.map((entry, idx) => (
                <Fragment key={entry.id}>
                  <tr className={`border-b border-border/40 hover:bg-blue-50/40 transition-colors ${idx % 2 === 1 ? "bg-slate-50/60" : "bg-white"}`}>
                    <td className="px-3 py-2 sticky left-0 z-10 bg-inherit text-center">
                      {isReceivable(entry) && (
                        <Checkbox
                          checked={selectedEntryIds.has(entry.id)}
                          onCheckedChange={() => setSelectedEntryIds((prev) => {
                            const n = new Set(prev);
                            if (n.has(entry.id)) n.delete(entry.id); else n.add(entry.id);
                            return n;
                          })}
                          className="h-3.5 w-3.5"
                          title="Select for combined receive / unloading actions"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="font-semibold text-blue-700">{flightNo(entry.flightId)}</span>
                      {otherLegs(entry).length > 0 && (
                        <div className="text-[10px] text-slate-500">+ {otherLegs(entry).join(", ")}</div>
                      )}
                    </td>
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

                        {entry.receivedAt && (
                          <Button
                            size="sm"
                            className="no-brand h-6 px-2.5 text-[10px] bg-[#CD7F32] hover:bg-[#b06e2b] text-white border-0 shadow-sm"
                            onClick={() => navigate("/transfer", { state: { receiveInTransit: true } })}
                            title="Receive these items into store on the Transfer In Transit tab"
                          >
                            <Truck className="h-3 w-3 mr-1" /> Receive In Store
                          </Button>
                        )}
                        {entry.approvalStage >= 3 && !entry.receivedAt && (
                          <Button
                            size="sm"
                            className="h-6 px-2.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                            onClick={() => openAirportReceive(entry)}
                          >
                            <PlaneLanding className="h-3 w-3 mr-1" /> Airport Receive
                          </Button>
                        )}
                        {/* Unloading runs on the entry, so it can be completed from
                            here too — not only inside the receive sheet. */}
                        {entry.approvalStage >= 3 && !entry.receivedAt && entry.unloadingTime && !entry.unloadingEndTime && (
                          <div className="flex items-center gap-1">
                            {entry.unloadingStartedAtIso && (
                              <span className="text-[10px] font-mono text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded tabular-nums">
                                <Timer className="h-2.5 w-2.5 inline mr-0.5" />
                                {tickCount >= 0 && formatElapsed(entry.unloadingStartedAtIso)}
                              </span>
                            )}
                            <Button
                              size="sm"
                              className="h-6 px-2 text-[10px] bg-teal-600 hover:bg-teal-700 text-white border-0"
                              onClick={() => completeUnloading(entry.id)}
                              title="Stop the unloading timer for this dispatch"
                            >
                              Complete Unloading
                            </Button>
                          </div>
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
        </>
        );
      })()}

      {/* ── Empty State ──────────────────────────────────────────────────────── */}
      <div className="mb-6">
        {entries.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 py-20 text-center">
            <Truck className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No dispatch entries for today.</p>
          </div>
        )}
      </div>

      {/* ── Dispatch Entry Form Modal ──────────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={(v) => { if (!v) resetForm(); }}>
        <DialogContent className="w-full max-w-5xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b shrink-0">
            <DialogTitle className="text-base font-semibold">
              {isAirportReceiveMode ? "Airport Receive" : editId ? "Edit Dispatch Entry" : "New Dispatch Entry"}
            </DialogTitle>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className={`grid grid-cols-1 ${showAirportPanel && !isAirportReceiveMode ? "xl:grid-cols-2" : ""} gap-5`}>

              {/* ══ LEFT: Catering Point — hidden in Airport Receive mode (shown via the row's View action) ══ */}
              {!isAirportReceiveMode && (
              <div className="rounded-xl border border-blue-300 bg-white shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-700 to-indigo-600 text-white px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <PlaneTakeoff className="h-5 w-5" />
                    <div>
                      <p className="font-bold text-sm">Catering Point Dispatch Entry</p>
                      <p className="text-[11px] text-blue-200 mt-0.5">{doc.originName}</p>
                    </div>
                  </div>
                  {/* The entry's own number identifies the monitoring record; the
                      dispatch IDs it covers are what the user selected, and those
                      are what they came here to see. Both, rather than only the
                      sequence number. */}
                  <div className="flex flex-col items-end gap-1 min-w-0">
                    {airportDispatch.sourceRefs.length > 0 ? (
                      <>
                        {/* A vehicle load can combine 20-30 dispatches — the pill
                            summarises the count, the full list lives on hover and
                            per leg card below (each leg shows its own DSP ref). */}
                        <span
                          className="text-xs bg-blue-800/60 px-2.5 py-1 rounded-full font-semibold max-w-[min(360px,60vw)] truncate"
                          title={airportDispatch.sourceRefs.join(", ")}
                        >
                          {airportDispatch.sourceRefs.length === 1
                            ? `Dispatch ID: ${airportDispatch.sourceRefs[0]}`
                            : airportDispatch.sourceRefs.length <= 3
                              ? `${airportDispatch.sourceRefs.length} Dispatches: ${airportDispatch.sourceRefs.join(" + ")}`
                              : `${airportDispatch.sourceRefs.length} Dispatches: ${airportDispatch.sourceRefs.slice(0, 2).join(" + ")} +${airportDispatch.sourceRefs.length - 2} more`}
                        </span>
                        <span className="text-[11px] text-blue-200">
                          Entry No: {formDispatchNo}
                          {airportDispatch.legs.length > 1 && ` · ${airportDispatch.legs.length} flights`}
                          {airportDispatch.orderNo !== "—" && ` · ${airportDispatch.orderNo}`}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs bg-blue-800/60 px-2.5 py-1 rounded-full">Dispatch No: {formDispatchNo}</span>
                    )}
                  </div>
                </div>

                <div className={`p-5 space-y-4${isAirportReceiveMode ? " pointer-events-none opacity-60 select-none" : ""}`}>
                  <MaxTempBanner />

                  {/* Flights in this dispatch — one vehicle can carry several legs
                      (a round trip, or a combined load), and the batch list below
                      mixes their batches together. Without this the entry only
                      identified itself by a dispatch number. */}
                  {airportDispatch.legs.length > 0 && (
                    <div>
                      <Divider label={airportDispatch.legs.length > 1 ? `Flights In This Dispatch (${airportDispatch.legs.length})` : "Flight"} color="blue" />
                      {/* Many-dispatch loads (20-30 legs) scroll inside the card
                          instead of stretching the sheet open. */}
                      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${airportDispatch.legs.length > 6 ? "max-h-64 overflow-y-auto pr-1" : ""}`}>
                        {airportDispatch.legs.map((leg) => (
                          <div key={leg.flight} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700">
                                {leg.flight}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${leg.direction === "Return" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                                {leg.direction}
                              </span>
                              <span className="text-[11px] text-muted-foreground">{leg.sector}</span>
                              {leg.dspRef && (
                                <span className="ml-auto font-mono text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
                                  {leg.dspRef}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                              <span>Dep <b className="text-foreground">{leg.depTime}</b></span>
                              <span>{leg.date}</span>
                              <span>{leg.rows.length} batch{leg.rows.length === 1 ? "" : "es"}</span>
                              <span>Qty <b className="text-foreground">{leg.totalQty.toLocaleString()}</b></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

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
                  {!editId && (
                    <p className="text-[11px] text-muted-foreground -mt-1">
                      {form.loadStartTime
                        ? <><span className="font-semibold text-indigo-600">Load Start recorded automatically</span> when Vehicle Load was clicked on the Dispatch page. Enter Load End here, or use Complete Loading on that page.</>
                        : <>Load Start records automatically on <span className="font-semibold text-indigo-600">Vehicle Load</span> (Dispatch page); Load End comes from Complete Loading there or is entered here.</>}
                    </p>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              )}

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

                  {/* ─ Airport Receiving Protocol (moved to top) ─ */}
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

                  {/* ─ Gate Details — temp entry (locks once recorded) + timer ─ */}
                  <Divider label="Airport Gate Details — Gate No. 08" color="emerald" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Gate 08 Temp (°C)</Label>
                      <Input type="number" step="0.1" placeholder="e.g. 6.5" value={form.gateTempGate08}
                        disabled={gateTempLocked}
                        onChange={(e) => { sf("gateTempGate08", e.target.value); sf("ackGate08", false); }}
                        onBlur={() => { if (form.gateTempGate08 !== "") setGateTempLocked(true); }}
                        className={`mt-1 h-9 ${vehOOR(form.gateTempGate08) ? "border-red-400 bg-red-50" : ""} ${gateTempLocked ? "bg-slate-100 text-slate-600" : ""}`} />
                      {gateTempLocked
                        ? <p className="text-[11px] text-slate-500 mt-0.5 italic flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Recorded — cannot be changed</p>
                        : <TempHint note="Max: +8°C at gate" />}
                      {vehOOR(form.gateTempGate08) && <p className="text-xs text-red-600 mt-0.5 font-semibold">⚠ Exceeds +8°C</p>}
                      <OorAck show={vehOOR(form.gateTempGate08)} checked={form.ackGate08} onChange={(v) => sf("ackGate08", v)} label="Acknowledge" />
                      <FieldErr msg={errors.ackGate08} />
                    </div>
                    <div>
                      <Label className="text-xs">Time of Unloading</Label>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {!form.unloadingTime ? (
                          <span className="text-xs text-muted-foreground italic">Starts automatically when the receiving entry opens.</span>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                              <Play className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                              <div>
                                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Started</div>
                                <div className="text-xs font-semibold tabular-nums text-indigo-700">{form.unloadingTime}</div>
                              </div>
                            </div>
                            {unloadStartIso && !unloadEndTime && (
                              <span className="font-mono text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded px-2 py-1.5 tabular-nums">
                                <Timer className="h-3 w-3 inline mr-0.5" />
                                {unloadTimerTick >= 0 && formatElapsed(unloadStartIso)}
                              </span>
                            )}
                            {unloadEndTime ? (
                              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                <div>
                                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Ended</div>
                                  <div className="text-xs font-semibold tabular-nums text-emerald-700">{unloadEndTime}</div>
                                </div>
                              </div>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                                onClick={() => editId && completeUnloading(editId)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Complete Unloading
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                      <TempHint note="Starts automatically when the receiving entry opens — press Complete Unloading (here or on the dispatch row) when the last product is off the vehicle" />
                    </div>
                  </div>

                  {/* Cold chain visual — dispatch From-warehouse temp (left) → To-warehouse / gate temp (right) */}
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-center">
                    <div className="flex items-start justify-center gap-2 text-xs text-slate-600">
                      <div className="flex flex-col items-center gap-1">
                        <span className="px-2.5 py-1 rounded-md bg-blue-100 text-blue-700 font-semibold">{dispatchWarehouses.from ?? "Catering Kitchen"}</span>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">From Warehouse</span>
                        <span className="text-[11px] font-bold tabular-nums text-blue-700">{form.vehicleTempBegin !== "" ? `${form.vehicleTempBegin}°C` : "—"}</span>
                      </div>
                      <span className="flex-1 border-t-2 border-dashed border-slate-300 relative mt-4">
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">≤ +8°C</span>
                      </span>
                      <div className="flex flex-col items-center gap-1">
                        <span className="px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-700 font-semibold">{dispatchWarehouses.to ?? "Airport Gate 08"}</span>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">To Warehouse</span>
                        <span className={`text-[11px] font-bold tabular-nums ${vehOOR(form.gateTempGate08) ? "text-red-600" : "text-emerald-700"}`}>{form.gateTempGate08 !== "" ? `${form.gateTempGate08}°C` : "—"}</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-3">Cold chain must be unbroken from the dispatching warehouse to the receiving point</p>
                  </div>

                  {/* ─ Batch filters — date range + status ─ */}
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <Label className="text-xs">From</Label>
                      <Input type="date" value={batchFrom} onChange={(e) => setBatchFrom(e.target.value)} className="mt-1 h-8 w-36 text-xs tabular-nums" />
                    </div>
                    <div>
                      <Label className="text-xs">To</Label>
                      <Input type="date" value={batchTo} min={batchFrom || undefined} onChange={(e) => setBatchTo(e.target.value)} className="mt-1 h-8 w-36 text-xs tabular-nums" />
                    </div>
                    {(batchFrom || batchTo) && (
                      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => { setBatchFrom(""); setBatchTo(""); }}>
                        Clear
                      </Button>
                    )}
                  </div>

                  {/* ─ Dispatched batch — fetched from the Dispatch table (round trip = one row per leg) ─ */}
                  <Divider label="Dispatched Batch" color="emerald" />
                  {coReceivable.length > 0 && (
                    <p className="text-[11px] text-muted-foreground -mt-1">
                      Several dispatches can be received as a single entry — tick the other pending dispatches below and one Save receives them all.
                    </p>
                  )}
                  <div className="rounded-lg border border-slate-200 overflow-x-auto">
                    <table className="w-full text-[11px] border-collapse" style={{ minWidth: 800 }}>
                      <thead>
                        <tr className="bg-slate-100 text-slate-600 uppercase tracking-wider">
                          <th className="px-2.5 py-2 w-8"><span className="sr-only">Receive in this entry</span></th>
                          <th className="px-2.5 py-2 text-left font-semibold">SL</th>
                          <th className="px-2.5 py-2 text-left font-semibold">Dispatch ID</th>
                          <th className="px-2.5 py-2 text-left font-semibold">Flight</th>
                          <th className="px-2.5 py-2 text-left font-semibold">Order</th>
                          <th className="px-2.5 py-2 text-left font-semibold">Date</th>
                          <th className="px-2.5 py-2 text-left font-semibold">Dep Time</th>
                          <th className="px-2.5 py-2 text-left font-semibold">Meals</th>
                          <th className="px-2.5 py-2 text-left font-semibold">Status</th>
                          <th className="px-2.5 py-2 text-left font-semibold">Food Safety &amp; QC</th>
                          <th className="px-2.5 py-2 text-right font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleLegs.length === 0 && coReceivable.length === 0 ? (
                          <tr><td colSpan={11} className="px-2.5 py-6 text-center text-muted-foreground">{airportDispatch.legs.length === 0 ? "No dispatched items found." : "No legs match the current filters."}</td></tr>
                        ) : visibleLegs.map((leg, li) => {
                          return (
                            <tr key={leg.flight} className="border-t border-slate-100 bg-white align-top">
                              {li === 0 && (
                                <>
                                  <td className="px-2.5 py-2 text-center" rowSpan={visibleLegs.length}>
                                    <Checkbox checked disabled className="h-3.5 w-3.5" title="This dispatch is being received in this entry" />
                                  </td>
                                  <td className="px-2.5 py-2 text-slate-500" rowSpan={visibleLegs.length}>1</td>
                                  <td className="px-2.5 py-2 font-semibold text-slate-800 whitespace-nowrap" rowSpan={visibleLegs.length}>
                                    {airportDispatch.dispatchId}
                                    {airportDispatch.legs.length > 1 && <div className="text-[9px] font-medium text-amber-600 mt-0.5">Round trip · {airportDispatch.legs.length} legs</div>}
                                  </td>
                                </>
                              )}
                              <td className="px-2.5 py-2 whitespace-nowrap">
                                <span className="font-semibold text-blue-700">{leg.flight}</span>
                                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${leg.direction === "Return" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{leg.direction}</span>
                              </td>
                              {li === 0 && <td className="px-2.5 py-2 font-mono text-slate-700 whitespace-nowrap" rowSpan={visibleLegs.length}>{airportDispatch.orderNo}</td>}
                              {li === 0 && <td className="px-2.5 py-2 whitespace-nowrap text-slate-600" rowSpan={visibleLegs.length}>{leg.date}</td>}
                              {li === 0 && <td className="px-2.5 py-2 whitespace-nowrap text-slate-600" rowSpan={visibleLegs.length}>{leg.depTime}</td>}
                              <td className="px-2.5 py-2 whitespace-nowrap">
                                <button type="button" className="inline-flex items-center gap-1 text-slate-700 hover:text-indigo-700" onClick={() => openOrderDetails(leg.flight)} title="View items">
                                  <Eye className="h-3.5 w-3.5 text-slate-400" />
                                  {leg.rows.length} items · {leg.totalQty}
                                </button>
                              </td>
                              <td className="px-2.5 py-2 whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">Awaiting Receipt</span>
                              </td>
                              <td className="px-2.5 py-2 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700"><ShieldCheck className="h-3 w-3" /> QC Done</span>
                              </td>
                              <td className="px-2.5 py-2">
                                <div className="flex items-center justify-end gap-1">
                                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-indigo-700" title="View catering dispatch point entry" onClick={() => { if (editId) setViewEntryId(editId); }}>
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {/* Other dispatches pending at the airport — tick to receive
                            them together with this entry (one combined receipt).
                            Unticked = one summary line; ticked = the dispatch's
                            full batch record, leg by leg. */}
                        {coReceivable.map((e, i) => {
                          const fno = flightNo(e.flightId);
                          const pkgRow = dispatchPackagingRows.find((r) => r.flight === fno);
                          const dspIds = e.sourceDispatchIds?.length ? e.sourceDispatchIds : [e.dispatchNo ?? e.id];
                          const checked = coReceiveIds.has(e.id);
                          const slNo = (visibleLegs.length > 0 ? 2 : 1) + i;
                          const toggle = () => setCoReceiveIds((prev) => {
                            const n = new Set(prev);
                            if (n.has(e.id)) n.delete(e.id); else n.add(e.id);
                            return n;
                          });
                          const legs = checked ? (coReceiveLegs.get(e.id) ?? []) : [];
                          if (checked && legs.length > 0) {
                            return (
                              <Fragment key={e.id}>
                                {legs.map((leg, li) => (
                                  <tr key={`${e.id}-${leg.flight}`} className="border-t border-slate-100 bg-emerald-50/40 align-top">
                                    {li === 0 && (
                                      <>
                                        <td className="px-2.5 py-2 text-center" rowSpan={legs.length}>
                                          <Checkbox checked onCheckedChange={toggle} className="h-3.5 w-3.5" title="Untick to drop this dispatch from the combined receipt" />
                                        </td>
                                        <td className="px-2.5 py-2 text-slate-500" rowSpan={legs.length}>{slNo}</td>
                                        <td className="px-2.5 py-2 font-semibold text-slate-800 whitespace-nowrap" rowSpan={legs.length} title={dspIds.join(", ")}>
                                          {leg.dspRef ?? dspIds[0]}
                                          {legs.length > 1 && <div className="text-[9px] font-medium text-amber-600 mt-0.5">Round trip · {legs.length} legs</div>}
                                        </td>
                                      </>
                                    )}
                                    <td className="px-2.5 py-2 whitespace-nowrap">
                                      <span className="font-semibold text-blue-700">{leg.flight}</span>
                                      <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${leg.direction === "Return" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{leg.direction}</span>
                                    </td>
                                    <td className="px-2.5 py-2 font-mono text-slate-700 whitespace-nowrap">{dispatchPackagingRows.find((r) => r.flight === leg.flight)?.orderNo ?? "—"}</td>
                                    <td className="px-2.5 py-2 whitespace-nowrap text-slate-600">{leg.date}</td>
                                    <td className="px-2.5 py-2 whitespace-nowrap text-slate-600">{leg.depTime}</td>
                                    <td className="px-2.5 py-2 whitespace-nowrap">
                                      <button type="button" className="inline-flex items-center gap-1 text-slate-700 hover:text-indigo-700" onClick={() => openOrderDetails(leg.flight)} title="View items">
                                        <Eye className="h-3.5 w-3.5 text-slate-400" />
                                        {leg.rows.length} items · {leg.totalQty}
                                      </button>
                                    </td>
                                    <td className="px-2.5 py-2 whitespace-nowrap">
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">Awaiting Receipt</span>
                                    </td>
                                    <td className="px-2.5 py-2 whitespace-nowrap">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700"><ShieldCheck className="h-3 w-3" /> QC Done</span>
                                    </td>
                                    {li === 0 && (
                                      <td className="px-2.5 py-2" rowSpan={legs.length}>
                                        <div className="flex items-center justify-end gap-1">
                                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-indigo-700" title="View dispatch entry" onClick={() => setViewEntryId(e.id)}>
                                            <Eye className="h-3.5 w-3.5" />
                                          </Button>
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </Fragment>
                            );
                          }
                          return (
                            <tr key={e.id} className={`border-t border-slate-100 align-top ${checked ? "bg-emerald-50/40" : "bg-white"}`}>
                              <td className="px-2.5 py-2 text-center">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={toggle}
                                  className="h-3.5 w-3.5"
                                  title="Receive this dispatch in the same entry"
                                />
                              </td>
                              <td className="px-2.5 py-2 text-slate-500">{slNo}</td>
                              <td className="px-2.5 py-2 font-semibold text-slate-800 whitespace-nowrap" title={dspIds.join(", ")}>
                                {dspIds[0]}{dspIds.length > 1 && <span className="text-[9px] font-medium text-slate-500"> +{dspIds.length - 1}</span>}
                              </td>
                              <td className="px-2.5 py-2 whitespace-nowrap">
                                <span className="font-semibold text-blue-700">{fno}</span>
                              </td>
                              <td className="px-2.5 py-2 font-mono text-slate-700 whitespace-nowrap">{pkgRow?.orderNo ?? "—"}</td>
                              <td className="px-2.5 py-2 whitespace-nowrap text-slate-600">{e.packagingDate}</td>
                              <td className="px-2.5 py-2 whitespace-nowrap text-slate-600">{pkgRow?.depTime ?? flights.find((f) => f.id === e.flightId)?.dep ?? "—"}</td>
                              <td className="px-2.5 py-2 whitespace-nowrap text-slate-700">
                                {e.mealLines.length} items · {totalQty(e.mealLines)}
                              </td>
                              <td className="px-2.5 py-2 whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">Awaiting Receipt</span>
                              </td>
                              <td className="px-2.5 py-2 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700"><ShieldCheck className="h-3 w-3" /> QC Done</span>
                              </td>
                              <td className="px-2.5 py-2">
                                <div className="flex items-center justify-end gap-1">
                                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-indigo-700" title="View dispatch entry" onClick={() => setViewEntryId(e.id)}>
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
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
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Date &amp; time auto-recorded on accept
                    </p>
                  </div>
                </div>
              </div>}
            </div>

            {/* Save / Cancel — the primary action sits in the footer, right of Cancel */}
            <div className="mt-5 flex items-center justify-end gap-3 border-t border-border pt-4">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              {!isAirportReceiveMode && (
                <Button className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 shadow-md" onClick={saveEntry}>
                  <Save className="h-4 w-4 mr-2" />
                  {editId ? "Save Changes" : "Save"}
                </Button>
              )}
              {isAirportReceiveMode && (
                <Button className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 shadow-md" onClick={acceptReceipt}>
                  <CheckCircle2 className="h-4 w-4 mr-2" /> Save
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Order Details — read-only meal breakdown per leg ─────────────────── */}
      <Dialog open={!!orderDetailFlight} onOpenChange={(v) => { if (!v) setOrderDetailFlight(null); }}>
        <DialogContent className="w-full max-w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {(() => {
            // A ticked co-dispatch's legs live outside airportDispatch — search both.
            const leg = airportDispatch.legs.find((l) => l.flight === orderDetailFlight)
              ?? [...coReceiveLegs.values()].flat().find((l) => l.flight === orderDetailFlight);
            if (!leg) return null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Order Details — {airportDispatch.orderNo}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div><span className="text-muted-foreground">Flight:</span><span className="font-semibold ml-1">{leg.flight} <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${leg.direction === "Return" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{leg.direction}</span></span></div>
                    <div><span className="text-muted-foreground">Sector:</span><span className="font-semibold ml-1">{leg.sector}</span></div>
                    <div><span className="text-muted-foreground">Order:</span><span className="font-semibold ml-1">{airportDispatch.orderNo}</span></div>
                    <div><span className="text-muted-foreground">Dispatch Ref:</span><span className="font-semibold ml-1">{airportDispatch.dispatchId}</span></div>
                    <div><span className="text-muted-foreground">Dep Time:</span><span className="font-semibold ml-1">{leg.depTime}</span></div>
                    <div><span className="text-muted-foreground">Date:</span><span className="font-semibold ml-1">{leg.date}</span></div>
                  </div>

                  <div className="pt-2 border-t border-border flex gap-3 flex-wrap items-center">
                    <div><span className="text-muted-foreground">Status:</span>
                      <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Awaiting Receipt</span>
                    </div>
                    <div><span className="text-muted-foreground">QC:</span><span className="ml-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">QC Done</span></div>
                  </div>

                  <div>
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">
                      Meals ({leg.rows.length})
                    </div>
                    <div className="overflow-x-auto">
                    <table className="w-full text-xs border border-slate-200 rounded-md overflow-hidden" style={{ minWidth: 440 }}>
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
                        {leg.rows.map((r) => (
                          <tr key={r.id} className="border-t border-slate-100 align-middle">
                            <td className="p-2 font-mono text-primary">{r.productionOrderId}</td>
                            <td className="p-2">{r.mealName}</td>
                            <td className="p-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${MEAL_TYPE_TONE[r.mealType] ?? "bg-slate-100 text-slate-600"}`}>{r.mealType}</span></td>
                            <td className="p-2 text-right tabular-nums font-medium">{r.qty}</td>
                            <td className="p-2 text-muted-foreground">{r.warehouse}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-slate-300 bg-slate-50/80">
                          <td className="p-2 font-bold" colSpan={3}>Total</td>
                          <td className="p-2 text-right font-bold tabular-nums">{leg.totalQty}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOrderDetailFlight(null)}>Close</Button>
                </DialogFooter>
              </>
            );
          })()}
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

// "CXB → DAC" / "CXB-DAC" → "DAC → CXB". Same normalisation Packaging &
// Dispatch uses to spot the reverse-sector leg of a round trip.
function galleyReverseSector(sector: string): string {
  const parts = (sector ?? "").split(/→|—|–|-/).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return sector ?? "";
  return `${parts[1]} → ${parts[0]}`;
}
/** Sector compared separator- and case-insensitively ("DAC-CXB" ≡ "DAC → CXB"). */
const normSector = (s: string) =>
  (s ?? "").split(/→|—|–|-/).map((p) => p.trim()).filter(Boolean).join("→").toUpperCase();

export function buildInitialGalley(
  entry: DispatchEntry,
  flight: FlightOption | undefined,
  /** Load counts of the RETURN leg of this rotation, when one is selected.
   *  Drives every arr* figure on the sheet; omitted, the arrival leg falls back
   *  to a share of the outbound load exactly as before. */
  ret?: { pax: number; crew: number },
): GalleyPlan {
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
  // Return (arrival) leg: its own order load when a return leg is selected,
  // otherwise a share of the outbound load.
  const retCrew = ret ? Math.max(0, ret.crew) : crew;
  const arrCockpit = Math.min(cockpit, retCrew);
  const arrCabin = Math.max(0, retCrew - arrCockpit);
  const depChicken = Math.round(eyPax * chickenShare);
  const depBeef = eyPax - depChicken;
  const depVeg = Math.max(1, Math.round(eyPax * vegShare));
  const arrEyPax = ret ? Math.max(0, ret.pax) : Math.round(eyPax * arrShare);
  const arrChicken = Math.round(arrEyPax * chickenShare);
  const arrBeef = arrEyPax - arrChicken;

  const base: GalleyPlan = {
    depZenithLoad: String(pax),
    arrZenithLoad: String(ret ? Math.max(0, ret.pax) : Math.round(pax * 0.3)),
    traySetupDep: String(pax + Math.round(pax * 0.04)),
    traySetupArr: String(arrEyPax),
    depMealLoad: String(eyPax),
    arrMealLoad: String(arrEyPax),
    depBCPax: "0", arrBCPax: "0",
    depBCMeal: "0", arrBCMeal: "0",
    depCrewBC: "0", arrCrewBC: "0",
    depCockpit: String(cockpit), depCabin: String(cabin), depObs: "0",
    arrCockpit: String(arrCockpit), arrCabin: String(arrCabin), arrObs: "0",
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
  fullPage = false,
}: {
  entry: DispatchEntry;
  flight: FlightOption | undefined;
  /** Existing plan (forwarded record or saved draft) — re-planning starts from
   *  the last issued sheet instead of wiping it back to defaults. */
  initialPlan?: GalleyPlan;
  onClose: () => void;
  /** Render the planner inline as a full page section instead of a dialog. */
  fullPage?: boolean;
  /** Save persists a draft with the chosen transfer source; the plan is
   *  forwarded to aircraft loading later from the list page (sign-off is
   *  captured on the Loading QC & Sign-Off page). */
  onSaveDraft?: (
    plan: GalleyPlan,
    source: { officeId: string; warehouseId: string },
  ) => void;
}) {
  // "overview" and "meals" are the two fixed tabs; every other tab is a galley
  // group id straight from the Item Profile data (see lib/galley-groups.ts).
  type GTab = "overview" | "meals" | (string & {});
  const [tab, setTab] = useState<GTab>("overview");
  const galleyGroups = useMemo(() => getGalleyGroups(), []);
  const isGroupTab = (t: GTab) => galleyGroups.some((gr) => gr.id === t);
  const [g, setG] = useState<GalleyPlan>(() => ({ ...buildInitialGalley(entry, flight), ...(initialPlan ?? {}) }));
  const sg = (k: string, v: string) => setG((prev) => ({ ...prev, [k]: v }));

  // Stock source: which office / warehouse the consumables are transferred FROM
  // when the plan is forwarded to the aircraft. Defaults to the central store.
  const [source, setSource] = useState({ officeId: "OFF-001", warehouseId: "WH-001" });
  const warehouseChoices = activeWarehousesByOffice(source.officeId);
  const sourceWarehouseName =
    activeWarehouses.find((w) => w.id === source.warehouseId)?.name ?? source.warehouseId;
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

  // ── Return leg ──────────────────────────────────────────────────────────────
  // A rotation is planned ONCE: the dep* half of the sheet is the outbound leg,
  // the arr* half is the return leg. The return leg is matched on DESTINATION —
  // it is the flight that flies this sector back (DAC-CXB out → CXB-DAC back) on
  // the same day in the opposite direction. Of several such flights the first
  // departing after the outbound is the rotation's return.
  const returnOrder = useMemo(() => {
    if (!order) return undefined;
    const opp = order.direction === "Return" ? "Outbound" : "Return";
    const sameDay = getFlightOrders().filter((o) =>
      (o.orderType ?? "flight") !== "crew" &&
      o.date === order.date && o.direction === opp && o.flight !== order.flight);
    if (sameDay.length === 0) return undefined;
    const matchReverseOf = (sector: string) => {
      const rev = normSector(galleyReverseSector(sector ?? ""));
      if (!rev) return undefined;
      const legs = [...sameDay.filter((o) => normSector(o.sector) === rev)]
        .sort((a, b) => (a.etd ?? "").localeCompare(b.etd ?? ""));
      if (legs.length === 0) return undefined;
      return legs.find((o) => (o.etd ?? "") > (order.etd ?? "")) ?? legs[0];
    };
    // The flight board carries the operating sector shown in the header; the
    // order's own sector is the fallback when the board has no match.
    return matchReverseOf(flight?.sector ?? "") ?? matchReverseOf(order.sector);
  }, [order, flight?.sector]);

  // The outbound leg's ROUTE is the operating sector off the flight board — the
  // same sector the return leg was matched against — so both legs of the
  // rotation read as one round trip (DAC-CXB out, CXB-DAC back).
  const outboundSector = flight?.sector || order?.sector || "—";

  // The outbound leg as the Menu resolver needs it — the order when there is
  // one, else the schedule the plan was opened against.
  const outboundLeg = order ?? (entry.packagingDate
    ? { date: entry.packagingDate, sector: outboundSector, etd: flight?.dep ?? "" }
    : undefined);

  const retSection = useMemo(() => dispatchSectionForFlight(returnOrder?.flight), [returnOrder?.flight]);
  const retSpecialTotal = (retSection?.vgml ?? 0) + (retSection?.chml ?? 0) + (retSection?.spml ?? 0);
  const retOrigPax = retSection?.paxLines.reduce((s, l) => s + (Number(l.qty) || 0), 0) ?? 0;

  // Load counts default from the connected order but are EDITABLE — an updated
  // record (revised PAX/crew/special meals) can arrive after the flight was
  // scheduled. Editing PAX/Crew re-derives the standard-driven quantities for
  // the new load; Special Meals is an informational override.
  const [planPax, setPlanPax] = useState<number>(order?.pax ?? flight?.pax ?? totalQty(entry.mealLines));
  const [planCrew, setPlanCrew] = useState<number>(order?.crew ?? flight?.crew ?? 7);
  // Default to the dispatched breakdown sum (VGML+CHML+SPML) so the summary
  // matches the Meals-tab total; fall back to the order-level count.
  const [specialMeals, setSpecialMeals] = useState<number>(specialTotal || order?.specialMeals || 0);
  // The return leg carries its own load — the arrival half of the sheet is
  // planned against it instead of a flat share of the outbound load.
  const [retPax, setRetPax] = useState<number>(returnOrder?.pax ?? 0);
  const [retCrew, setRetCrew] = useState<number>(returnOrder?.crew ?? 0);
  const [retSpecialMeals, setRetSpecialMeals] = useState<number>(retSpecialTotal || returnOrder?.specialMeals || 0);

  // ── Plan the outbound only ──────────────────────────────────────────────────
  // A rotation is normally planned once, covering both legs. But the return is
  // not always ours to load: it can be catered down-route, cancelled, or simply
  // planned separately. Unticking this drops the arrival half from the sheet —
  // its load counts, meals, standards-driven quantities and the forwarded plan —
  // without touching the pairing itself, so it can be brought back at any point.
  const [includeReturn, setIncludeReturn] = useState(true);
  /** The return leg AS PLANNED — undefined when the planner excluded it. */
  const planReturn = includeReturn ? returnOrder : undefined;

  // Aircraft type for this plan — drives which loading standard fills the
  // beverage/amenity/equipment quantities. Editable from the header, and a new
  // aircraft can be registered on the fly (shared with Configuration > Aircraft).
  // Starts UNSELECTED — the beverage/amenity/equipment (loading) tabs only appear
  // once an aircraft type is chosen, so their per-aircraft standard is applied.
  const [aircraftType, setAircraftType] = useState("");
  // The model (variant) of the chosen type — a second, cascading dropdown that
  // only appears once a type is selected. Its options are maintained in
  // Configuration → Aircraft (AIRCRAFT_MODELS + any model on the fleet register).
  const [aircraftModel, setAircraftModel] = useState("");
  const [aircraftTypes, setAircraftTypes] = useState(() => {
    const list = galleyAircraftTypes();
    return flight?.aircraft && !list.includes(flight.aircraft)
      ? [...list, flight.aircraft].sort((a, b) => a.localeCompare(b))
      : list;
  });
  const [aircraftRows, setAircraftRows] = usePersistedState<Aircraft[]>("config-aircraft-rows", AIRCRAFT_SEED);
  const [airlineList] = usePersistedState<Airline[]>("config-airline-rows", AIRLINE_SEED);
  const [showAddAircraft, setShowAddAircraft] = useState(false);
  // Models configured for the selected type — these populate the dependent
  // "model" dropdown once a type is chosen. Sourced from Configuration →
  // Aircraft, so maintaining a model there makes it selectable here.
  const modelsForType = useMemo(
    () => modelsForAircraftType(aircraftType, aircraftRows.filter((a) => a.status === "Active")),
    [aircraftRows, aircraftType],
  );

  // Re-derive the whole loading sheet from a load + aircraft type — buildInitialGalley
  // pulls THAT aircraft's Loading Standard (loadStandardsForAircraft) for the
  // beverage/amenity/equipment scales and integrates meals from Dispatch. Both
  // the aircraft-type selector and the editable load counts run through this, so
  // the sheet stays connected to the aircraft's standard.
  const rebuildPlan = (
    pax: number, crew: number, aircraft: string,
    // Defaults to the currently selected return leg, so every existing caller
    // keeps re-deriving the arrival half against it.
    ret: { pax: number; crew: number } | undefined = planReturn ? { pax: retPax, crew: retCrew } : undefined,
  ) => {
    const effFlight = {
      ...(flight ?? {}),
      pax, crew,
      child: flight?.child ?? 0,
      adult: Math.max(0, pax - (flight?.child ?? 0)),
      aircraft,
    } as FlightOption;
    setG(buildInitialGalley(entry, effFlight, ret));
  };

  // Switch the plan to another aircraft type: re-derive the sheet from that
  // type's loading standard (meals still flow from Dispatch inside buildInitialGalley).
  const applyAircraft = (type: string) => {
    setAircraftType(type);
    // Reset the dependent model; auto-pick when the type has exactly one model.
    const models = modelsForAircraftType(type, aircraftRows.filter((a) => a.status === "Active"));
    setAircraftModel(models.length === 1 ? models[0] : "");
    rebuildPlan(planPax, planCrew, type);
  };
  const onAircraftCreated = (a: Aircraft) => {
    setAircraftRows((prev) => [a, ...prev]);
    setAircraftTypes((prev) =>
      prev.includes(a.type) ? prev : [...prev, a.type].sort((x, y) => x.localeCompare(y)),
    );
    applyAircraft(a.type);
    if (a.model) setAircraftModel(a.model);
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

  // The same override for the return leg — re-derives the arr* half of the sheet.
  const applyReturnLoad = (pax: number, crew: number) => {
    setRetPax(pax);
    setRetCrew(crew);
    if (retOrigPax > 0) setRetSpecialMeals(Math.round(retSpecialTotal * pax / retOrigPax));
    rebuildPlan(planPax, planCrew, aircraftType, { pax, crew });
  };


  // On first open of a FRESH plan, reconcile the seeded quantities to the
  // connected load counts (the seed uses the flight schedule PAX/crew; the order
  // may carry revised numbers). A resumed/forwarded plan keeps its saved plan.
  useEffect(() => {
    if (!initialPlan) applyLoad(planPax, planCrew);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the aircraft is cleared while on a loading tab — or the tab's group has
  // been switched off in Galley Items Group since the plan was opened — fall
  // back to Load Summary rather than leaving a tab that renders nothing.
  useEffect(() => {
    if (isGroupTab(tab) && (!aircraftType || !TABS.some((t) => t.key === tab))) setTab("overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraftType, tab]);

  // Editable tabs render straight from the Galley Item Master — items added on
  // the Galley Items page appear here without code changes.
  // Only the lines the Galley Items Group config leaves switched on — a sheet
  // that offers a line the station has taken out of scope invites it to be
  // loaded anyway.
  const galleyItems = useMemo(() => filterEnabledGalleyItems(loadGalleyItems()), []);
  const sheetSections = useMemo(() => getGalleySections(galleyItems), [galleyItems]);
  // Loadable stock in the warehouse the plan transfers FROM — so counts are set
  // against what the store can actually give. One index serves both the sheet
  // lines (by key) and the meal lines (by item name, as Dispatch supplies them).
  // Menu Planning config, read once — every resolver below takes it, otherwise
  // each of them re-parses the whole card store on every render.
  const menuCards = useMemo(() => loadMealPlanningConfig(), []);
  const stockLookup = useMemo(() => createGalleyStockLookup(source.warehouseId), [source.warehouseId]);
  // Per-leg dish substitutions. They live ON the plan (reserved key), so they
  // travel with the sheet through draft → forward → sign-off, and they never
  // touch the menu card, which is the standing plan for every other flight.
  const mealSwaps = useMemo(() => readMealSwaps(g), [g]);
  const dishMaster = useMemo(() => menuDishMaster(menuCards), [menuCards]);
  /** Row the swap dialog is open for. */
  const [swapTarget, setSwapTarget] = useState<{
    flight: string; setKey: string; mealName: string; components: SwappedItem[];
    leg?: { date: string; sector?: string; etd?: string; orderNo?: string };
  } | null>(null);

  /**
   * Record a substitution and raise the LMC entry for it.
   *
   * The LMC is not optional politeness: by the time a galley plan exists,
   * production has runs open against the dish being swapped out, so the change
   * has to reach the same worklist an aircraft swap or a PAX change would.
   * Severity follows the lead time — inside the LMC window it is critical (and
   * therefore routed to Approval Management), outside it is still major, because
   * a cooked dish is being replaced either way.
   */
  const applySwap = (
    target: NonNullable<typeof swapTarget>,
    from: string,
    to: string,
    reason: string,
  ) => {
    const user = getAuthUser();
    const leadHours = target.leg?.date
      ? leadHoursToDeparture({ date: target.leg.date, etd: target.leg.etd ?? "" })
      : null;
    const lmc = addManualLmc({
      id: `MLMC-${Date.now().toString(36)}`,
      at: new Date().toISOString(),
      by: user?.name ?? "—",
      role: user?.role ?? "Galley Planning",
      flight: target.flight,
      orderNo: target.leg?.orderNo,
      sector: target.leg?.sector,
      type: "Meal Change",
      from: `${from} (${target.mealName})`,
      to,
      reason: reason.trim() || `Dish substituted on the galley plan for ${target.flight}.`,
      severity: isLmcLead(leadHours) ? "critical" : "major",
      leadHours,
      source: "Galley Plan",
    });
    const swap: MealSwap = {
      flight: target.flight, setKey: target.setKey, from, to,
      reason: reason.trim(), at: lmc.at, by: lmc.by, lmcId: lmc.id,
    };
    setG((prev) => ({ ...prev, ...writeMealSwaps(upsertMealSwap(readMealSwaps(prev), swap)) }));
    setSwapTarget(null);
    toast.success(`${from} → ${to} on ${target.flight}. Logged as LMC ${lmc.id}.`);
  };

  /** Undo a substitution — the LMC entry stays, because it happened. */
  const undoSwap = (flight: string, setKey: string, from: string) => {
    setG((prev) => ({ ...prev, ...writeMealSwaps(removeMealSwap(readMealSwaps(prev), flight, setKey, from)) }));
    toast.success(`Reverted to ${from}. The LMC entry remains on the log.`);
  };
  const lineStock = useMemo(() => {
    const m = new Map<string, ReturnType<typeof stockLookup.forItem>>();
    for (const it of galleyItems) if (!it.auto) m.set(it.key, stockLookup.forItem(it.key, it.label));
    return m;
  }, [galleyItems, stockLookup]);
  // Auto-total fields are the sum of the items that roll up to them (never
  // hand-keyed) and merged into the plan on save/forward.
  const derivedTotals = computeAutoTotals(g, galleyItems);
  // The chosen aircraft type/model isn't a catalog line, so stash it on the plan
  // under reserved keys — it doesn't render as a field, but the read-only Handing
  // sheet and its printout can then show which aircraft this plan was built for.
  const finalPlan = (): GalleyPlan => ({
    ...g,
    ...derivedTotals,
    ...(aircraftType ? { aircraftType } : {}),
    ...(aircraftModel ? { aircraftModel } : {}),
  });

  // Meals integrate from Dispatch but are RESCALED to the (possibly overridden)
  // load counts: a percent-based passenger line recomputes off planPax, other
  // lines scale proportionally; crew meals scale off the original crew count.
  const scaledMeals = useMemo(
    () => scaleDispatchMeals(flightNo, planPax, planCrew, flight?.crew ?? 0)?.scaled ?? null,
    [flightNo, planPax, planCrew, flight?.crew],
  );
  // …and the same for the return leg, scaled to ITS load counts.
  const retScaledMeals = useMemo(
    () => planReturn
      ? scaleDispatchMeals(planReturn.flight, retPax, retCrew, planReturn.crew || retCrew)?.scaled ?? null
      : null,
    [planReturn, retPax, retCrew],
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

  // Outbound / Return chip — the same colours the airport receive legs use.
  const dirBadge = (dir?: string) => (
    <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
      dir === "Return" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
    }`}>
      {dir || "Outbound"}
    </span>
  );

  // The meal breakdown of ONE leg. A plain function (not a component) so the
  // outbound and return legs render identically without remounting.
  /**
   * The menu configuration behind a leg's meals — read from Menu Planning
   * (Operations → Menu Planning), not restated here.
   *
   * The galley sheet says how many meals go on the aircraft; this says WHAT they
   * are: the service the leg carries, its serving window, each choice with its
   * share and dishes, the dessert served alongside, and the special meals the
   * card plans. It renders whether or not a dispatch exists, so the planner can
   * see the menu before the flight is dispatched.
   *
   * `match` is shown rather than hidden: a service picked because its window is
   * merely NEAREST the departure is a near-miss, not a planned answer, and the
   * planner should be able to tell the two apart.
   */
  const MATCH_NOTE: Record<MealService["match"], string> = {
    window: "serving window covers ETD",
    nearest: "nearest service to ETD",
    slot: "named by the Meal Slots master",
    only: "only menu planned that day",
  };

  const MenuServiceCard = ({ service, audience }: { service: MealService; audience: string }) => {
    const { card } = service;
    const choices = card.choices.filter((ch) => ch.items.length > 0);
    const specials = card.specialMeals.filter((s) => s.enabled);
    return (
      <div className="rounded-lg border border-violet-200 bg-violet-50/40 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-100 bg-violet-50 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <UtensilsCrossed className="h-3.5 w-3.5 text-violet-600 shrink-0" />
            <span className="text-xs font-bold text-violet-900">{card.mealType || "Meal"}</span>
            <span className="text-[11px] text-violet-700">· {audience}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {service.window && (
              <span className="rounded-full bg-white/70 border border-violet-200 px-2 py-0.5 text-[10px] font-semibold text-violet-700 tabular-nums">
                {service.window}
              </span>
            )}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                service.match === "nearest"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-violet-100 text-violet-700",
              )}
              title={MATCH_NOTE[service.match]}
            >
              {MATCH_NOTE[service.match]}
            </span>
          </div>
        </div>

        <div className="divide-y divide-violet-100">
          {choices.map((ch, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2">
              <span className="mt-[1px] shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 tabular-nums">
                {(ch.label || `Choice ${i + 1}`).replace(/^CHOICE\s*/i, "C")} · {ch.percentage}%
              </span>
              <span className="text-[11px] text-slate-700 leading-relaxed">
                {ch.items.map((it) => `${it.name} (${it.weight}g)`).join(" · ")}
              </span>
            </div>
          ))}
          {card.dessert?.name && (
            <div className="flex items-start gap-2 px-3 py-2">
              <span className="mt-[1px] shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                Dessert
              </span>
              {/* Served alongside the meal rather than packed into a choice — it
                  carries its own line on the sheet, so it is listed separately. */}
              <span className="text-[11px] text-slate-700 leading-relaxed">
                {card.dessert.name} ({card.dessert.weight}g · {card.dessert.calories} kcal)
              </span>
            </div>
          )}
          {specials.length > 0 && (
            <div className="flex items-start gap-2 px-3 py-2">
              <span className="mt-[1px] shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                Special
              </span>
              <span className="text-[11px] text-slate-700 leading-relaxed">
                {specials.map((s) => `${s.type} × ${s.portions}`).join(" · ")}
              </span>
            </div>
          )}
        </div>

        {card.totalKcal > 0 && (
          <div className="border-t border-violet-100 bg-white/60 px-3 py-1.5 text-right">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Total </span>
            <span className="text-[11px] font-bold text-violet-800 tabular-nums">{card.totalKcal} kcal</span>
          </div>
        )}
      </div>
    );
  };

  /**
   * A leg as the Menu / meal-set resolvers need it. Deliberately looser than a
   * FlightOrder: a flight can reach the galley without an order record (planned
   * straight off the dispatch board), and the menu is resolvable from the
   * schedule alone — which day, which sector, what time it departs.
   */
  type MenuLeg = {
    date: string;
    sector?: string;
    etd?: string;
    orderNo?: string;
    specialMeals?: number;
    specialMealRoster?: FlightOrder["specialMealRoster"];
  };
  const menuBlock = (legOrder: MenuLeg | undefined, legFlight: string) => {
    if (!legOrder?.date) return null;
    const leg = { date: legOrder.date, sector: legOrder.sector ?? "", etd: legOrder.etd ?? "" };
    const pax = serviceForLeg(leg, "Passengers", menuCards);
    const crew = serviceForLeg(leg, "Crew", menuCards);
    const day = dayFromDate(legOrder.date);
    const ftype = flightTypeFromSector(legOrder.sector ?? "");
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <GalleySecTitle>Menu Configuration</GalleySecTitle>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {day && <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-medium">{day}</span>}
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-medium">{ftype}</span>
            {legOrder.etd && <span className="tabular-nums">ETD {legOrder.etd}</span>}
          </div>
        </div>
        {!pax && !crew ? (
          <div className="rounded-md border border-dashed border-violet-300 bg-violet-50/50 px-3 py-2 text-[11px] text-violet-800">
            No menu is planned for <strong>{legFlight}</strong> on {day || "this day"} ({ftype}) — set one up in
            Operations → Menu Planning and it will appear here.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {pax && <MenuServiceCard service={pax} audience="Passengers" />}
            {crew && <MenuServiceCard service={crew} audience="Crew" />}
          </div>
        )}
      </div>
    );
  };

  /**
   * One meal row: what it is, the dishes it is assembled from, how many complete
   * SETS the source warehouse can assemble, and the count going on board.
   *
   * The stock figure counts sets, not dish quantities — a meal is a set of
   * dishes and its scarcest component caps it, so the tooltip names the dish
   * holding the line back.
   */
  const MealRow = ({
    name, note, components, qty, first, onSwap, onUndo,
  }: {
    name: string;
    note?: string;
    /** Only what a row needs to render: a dish name, its per-meal count for the
     *  stock maths, and whether it stands in for another dish. */
    components: { name: string; qtyPerMeal?: number; swappedFrom?: string }[];
    qty: number;
    first: boolean;
    /** Present ⇒ the row's dishes may be substituted for this leg. */
    onSwap?: () => void;
    onUndo?: (from: string) => void;
  }) => {
    const stock = components.length > 0 ? buildableSets(components, stockLookup) : undefined;
    const swapped = components.filter((c) => c.swappedFrom);
    return (
      <div className={cn(
        "flex items-start justify-between gap-3 px-3 py-2 text-sm",
        !first && "border-t border-border",
        swapped.length > 0 && "bg-amber-50/40",
      )}>
        <div className="min-w-0">
          <span className="text-slate-700">{name}</span>
          {note && <span className="text-muted-foreground"> · {note}</span>}
          {swapped.length > 0 && (
            <span
              className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-800 align-middle"
              title="Substituted on this leg only — the menu card is unchanged and an LMC entry was raised."
            >
              <Replace className="h-2.5 w-2.5" /> LMC
            </span>
          )}
          {components.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {components.map((c, i) => (
                <span key={`${c.name}-${i}`}>
                  {i > 0 && " · "}
                  {c.swappedFrom ? (
                    <span>
                      <span className="line-through opacity-60">{c.swappedFrom}</span>
                      {" → "}
                      <span className="font-semibold text-amber-800">{c.name}</span>
                      {onUndo && (
                        <>
                          {" "}
                          <button
                            type="button"
                            onClick={() => onUndo(c.swappedFrom!)}
                            className="underline decoration-dotted hover:text-amber-900"
                          >
                            undo
                          </button>
                        </>
                      )}
                    </span>
                  ) : c.name}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {stock && (stock.tracked ? (
            <span
              className={cn(
                "flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[10px] font-medium leading-none",
                qty > stock.available
                  ? "bg-amber-100/70 text-amber-800"
                  : stock.available <= 0 ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-500",
              )}
              title={`${fmtQty(stock.available)} complete set${stock.available === 1 ? "" : "s"} assemblable from stock in ${sourceWarehouseName}${stock.limiting ? ` — limited by ${stock.limiting}` : ""}`}
            >
              {qty > stock.available
                ? <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stock.available <= 0 ? "bg-rose-400" : "bg-emerald-500")} />}
              <span className="tabular-nums whitespace-nowrap">
                {qty > stock.available
                  ? `${fmtQty(stock.available)} sets · short ${fmtQty(qty - stock.available)}`
                  : `${fmtQty(stock.available)} sets in stock`}
              </span>
            </span>
          ) : (
            // Said plainly rather than left blank: none of this meal's dishes is
            // set up as a stock item, so there is nothing to read — which is a
            // different fact from "none in stock".
            <span
              className="rounded-md bg-slate-50 px-1.5 py-[3px] text-[10px] font-medium leading-none text-slate-400 whitespace-nowrap"
              title={`No stock record for ${components.map((c) => c.name).join(", ")} — add them on the Item Profile to track galley stock for this meal.`}
            >
              no stock record
            </span>
          ))}
          {onSwap && (
            <button
              type="button"
              onClick={onSwap}
              title="Substitute a dish on this leg only"
              aria-label={`Substitute a dish in ${name}`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-input text-muted-foreground hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition-colors"
            >
              <Replace className="h-3 w-3" />
            </button>
          )}
          <span className="font-semibold tabular-nums">{qty}</span>
        </div>
      </div>
    );
  };

  /**
   * A leg's meal breakdown, built from the MENU the leg carries rather than
   * restated from the dispatch snapshot — so the counts here are of the dishes
   * shown in Menu Configuration directly above, not of whatever an unrelated
   * dispatch happened to record.
   *
   * Dispatch stays the fallback: a leg whose menu is not planned still shows the
   * dispatched breakdown, so nothing goes blank.
   */
  const mealsBlock = (
    scaled: ScaledMeals | null,
    legFlight: string,
    leg: MenuLeg | undefined,
    pax: number,
    crew: number,
  ) => {
    // The resolvers read a leg as an order; a leg planned off the dispatch board
    // has no order record, so the schedule fields are normalised to that shape.
    const legOrder = leg
      ? {
          date: leg.date,
          sector: leg.sector ?? "",
          etd: leg.etd ?? "",
          specialMeals: leg.specialMeals ?? 0,
          specialMealRoster: leg.specialMealRoster,
        }
      : undefined;
    const paxSets = legOrder ? mealSetsForLeg(legOrder, "Passengers", pax, menuCards) : [];
    const crewSets = legOrder ? mealSetsForLeg(legOrder, "Crew", crew, menuCards) : [];
    const specialSets = legOrder ? dedupeSetsByCode(specialMealSetsForLeg(legOrder, menuCards)) : [];

    // The dessert is planned on the card but excluded from the meal sets — it is
    // served alongside the choice rather than packed into it, so it carries its
    // own line (and its own production run). Each audience's card states its
    // own, so both sections get one, served one per person on that service.
    //
    // It is still a cooked dish on a menu card, so it is substitutable for a leg
    // exactly like a choice dish — it just needs a set key of its own to be
    // addressed by, since it belongs to no set.
    const dessertOf = (forType: "Passengers" | "Crew") => {
      if (!legOrder) return null;
      const service = serviceForLeg(legOrder, forType, menuCards);
      const d = service?.card.dessert;
      if (!d?.name) return null;
      const serviceName = service!.card.mealType || "Meal";
      return {
        dish: d,
        key: dessertSetKey(forType, serviceName),
        // Names the service, not the dish — an LMC reading "Dessert · Yoghurt →
        // Firni" says nothing about which meal it belongs to.
        label: `${forType === "Passengers" ? "Pax" : "Crew"} ${serviceName} · Dessert`,
      };
    };
    const paxDessert = paxSets.length > 0 ? dessertOf("Passengers") : null;
    const crewDessert = crewSets.length > 0 ? dessertOf("Crew") : null;

    // A meal's dishes as served ON THIS LEG — the card's components with any
    // substitution applied — plus the wiring to change or revert one.
    const dishesOf = (setKey: string, components: MealItem[]): SwappedItem[] =>
      applyMealSwaps(components, legFlight, setKey, mealSwaps, dishMaster);
    const swapProps = (setKey: string, mealName: string, components: MealItem[]) => ({
      onSwap: () => setSwapTarget({
        flight: legFlight, setKey, mealName,
        components: dishesOf(setKey, components),
        leg: leg && { date: leg.date, sector: leg.sector, etd: leg.etd, orderNo: leg.orderNo },
      }),
      onUndo: (from: string) => undoSwap(legFlight, setKey, from),
    });

    /** The card's dessert as served on this leg — substitution and all. The row
     *  title follows the dish actually going on board, not the card's. */
    const DessertRow = ({
      d, per, qty,
    }: { d: { dish: MealItem; key: string; label: string }; per: string; qty: number }) => {
      const served = dishesOf(d.key, [d.dish])[0] ?? d.dish;
      return (
        <MealRow
          first={false}
          name={`Dessert · ${served.name}`}
          note={`${served.weight}g · ${served.calories} kcal · 1 per ${per}`}
          components={[served]}
          qty={qty}
          {...swapProps(d.key, d.label, [d.dish])}
        />
      );
    };

    if (!scaled && paxSets.length === 0 && crewSets.length === 0 && specialSets.length === 0) {
      return (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          No dispatch has been built for <strong>{legFlight}</strong> yet — the meal breakdown will populate here once this flight is dispatched in Packaging &amp; Dispatch.
        </div>
      );
    }

    // Special meals split by who eats them. The roster carries an audience per
    // passenger, so the split is counted, not apportioned; a leg with only a
    // flat special-meal count has no split to show and says so.
    const specialPax = specialSets.reduce((s, x) => s + (x.paxQty ?? 0), 0);
    const specialCrew = specialSets.reduce((s, x) => s + (x.crewQty ?? 0), 0);
    const specialTotalQty = specialSets.reduce((s, x) => s + x.qty, 0);
    const rostered = specialSets.some((x) => x.source === "roster");

    return (
      <div className="space-y-5">
        <div>
          <GalleySecTitle>Passenger Meals</GalleySecTitle>
          <div className="rounded-lg border border-border overflow-hidden">
            {paxSets.length > 0
              ? paxSets.map((s, i) => (
                  <MealRow
                    key={s.key} first={i === 0} name={s.name}
                    note={s.choicePct != null ? `${s.choicePct}% of ${pax} PAX` : undefined}
                    components={dishesOf(s.key, s.components)} qty={s.qty}
                    {...swapProps(s.key, s.name, s.components)}
                  />
                ))
              : (scaled?.paxLines ?? []).length === 0
                ? <div className="px-3 py-2 text-xs text-muted-foreground">No passenger meal lines.</div>
                : scaled!.paxLines.map((l, i) => (
                    <MealRow
                      key={i} first={i === 0} name={l.itemName}
                      note={l.percent != null ? `${l.percent}%` : undefined}
                      components={[{ name: l.itemName }]} qty={Number(l.qty) || 0}
                    />
                  ))}
            {paxDessert && <DessertRow d={paxDessert} per="PAX" qty={pax} />}
          </div>
        </div>

        {(crewSets.length > 0 || (scaled?.crewMeals.length ?? 0) > 0) && (
          <div>
            <GalleySecTitle>Crew Meals</GalleySecTitle>
            <div className="rounded-lg border border-border overflow-hidden">
              {crewSets.length > 0
                ? crewSets.map((s, i) => (
                    <MealRow
                      key={s.key} first={i === 0} name={s.name}
                      note={s.choicePct != null ? `${s.choicePct}% of ${crew} crew` : undefined}
                      components={dishesOf(s.key, s.components)} qty={s.qty}
                      {...swapProps(s.key, s.name, s.components)}
                    />
                  ))
                : scaled!.crewMeals.map((c, i) => (
                    <MealRow key={i} first={i === 0} name={c.type} components={[]} qty={parseMealQty(c.qty)} />
                  ))}
              {crewDessert && <DessertRow d={crewDessert} per="crew" qty={crew} />}
            </div>
          </div>
        )}

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <GalleySecTitle>Special Meals</GalleySecTitle>
            {specialTotalQty > 0 && (
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700 tabular-nums">
                  {specialPax} PAX
                </span>
                <span className="rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700 tabular-nums">
                  {specialCrew} Crew
                </span>
                {!rostered && (
                  <span className="text-amber-700" title="No per-passenger special-meal roster on the order — the flat count cannot be split by audience.">
                    (no roster — split unknown)
                  </span>
                )}
              </div>
            )}
          </div>
          {specialSets.length > 0 ? (
            <div className="rounded-lg border border-border overflow-hidden">
              {specialSets.map((s, i) => (
                <MealRow
                  key={s.key} first={i === 0}
                  name={`${s.code} — ${s.name}`}
                  note={[
                    s.paxQty ? `${s.paxQty} pax` : null,
                    s.crewQty ? `${s.crewQty} crew` : null,
                    s.unplanned ? "not on the menu plan" : null,
                  ].filter(Boolean).join(" · ") || undefined}
                  components={dishesOf(s.key, s.components)} qty={s.qty}
                  {...(s.components.length > 0 ? swapProps(s.key, `${s.code} — ${s.name}`, s.components) : {})}
                />
              ))}
              <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-2 text-sm font-semibold">
                <span className="uppercase text-[11px] tracking-wider text-muted-foreground">Total Special</span>
                <span className="tabular-nums">{specialTotalQty}</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* No menu-planned specials — fall back to the dispatched counts. */}
              {[
                { label: "VGML — Veg / Vegan", qty: scaled?.special.vgml ?? 0 },
                { label: "CHML — Child", qty: scaled?.special.chml ?? 0 },
                { label: "SPML — Special", qty: scaled?.special.spml ?? 0 },
              ].filter((s) => s.qty > 0).map((s) => (
                <RO key={s.label} label={s.label} value={s.qty} />
              ))}
              <RO label="Total Special" value={scaled?.specialTotal ?? 0} />
            </div>
          )}
        </div>
      </div>
    );
  };

  // Sign-off (handing/taking accountability) is captured later, at the physical
  // hand-off, on the Loading QC & Sign-Off page — not here at planning time.

  /**
   * Live stock read-out under a load field: what the selected Transfer From
   * warehouse holds for this line, and whether the planned count exceeds it.
   *
   * Three states, so the sheet can be scanned rather than read:
   *   • in stock   — quiet slate, an emerald dot
   *   • short      — amber, with how many units are missing
   *   • none here  — rose; the item isn't held in this warehouse at all
   * Lines with no stock record (meal-derived rows) show nothing — a zero there
   * would look authoritative and mean nothing.
   */
  const StockChip = ({
    stock, planned, unit, inline,
  }: {
    stock?: { available: number; tracked: boolean };
    planned: number;
    unit?: string;
    /** Sits beside a value (meal rows) rather than under a field. */
    inline?: boolean;
  }) => {
    if (!stock?.tracked) return null;
    const { available } = stock;
    const short = planned > available;
    const empty = available <= 0;
    return (
      <div
        className={cn(
          "flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[10px] font-medium leading-none",
          inline ? "shrink-0" : "mt-1.5",
          short ? "bg-amber-100/70 text-amber-800"
            : empty ? "bg-rose-50 text-rose-600"
            : "bg-slate-50 text-slate-500",
        )}
        title={
          short
            ? `Only ${fmtQty(available)}${unit ? ` ${unit}` : ""} available in ${sourceWarehouseName} — short by ${fmtQty(planned - available)}`
            : `${fmtQty(available)}${unit ? ` ${unit}` : ""} available in ${sourceWarehouseName}`
        }
      >
        {short ? (
          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
        ) : (
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", empty ? "bg-rose-400" : "bg-emerald-500")} />
        )}
        <span className="tabular-nums truncate">
          {empty && !short
            ? "none here"
            : short
              ? `${fmtQty(available)} left · short ${fmtQty(planned - available)}`
              : `${fmtQty(available)} in stock`}
        </span>
      </div>
    );
  };

  function GF({ label, k, unit }: { label: string; k: string; unit?: string }) {
    // Load counts are adjustable with −/＋ steppers (clamped at 0) as well as by
    // typing directly. Non-numeric entries fall back to 0 when stepping.
    // A line with a value gets a subtle sky highlight so a filled sheet reads at
    // a glance which items are actually being loaded.
    const active = (Number(g[k]) || 0) > 0;
    const step = (delta: number) => sg(k, String(Math.max(0, (Number(g[k]) || 0) + delta)));
    const stepBtn = "h-6 w-6 shrink-0 flex items-center justify-center rounded-md border border-input bg-muted/40 text-muted-foreground hover:bg-sky-100 hover:text-sky-700 hover:border-sky-200 active:scale-95 transition-all";
    // What the selected warehouse can actually give for this line. Asking for
    // more is flagged here, not at forward-to-loading time when the plan is
    // already committed.
    const st = lineStock.get(k);
    const short = !!st?.tracked && (Number(g[k]) || 0) > st.available;
    return (
      <div className={cn(
        "rounded-lg border px-2.5 py-2 transition-colors",
        short ? "border-amber-300 bg-amber-50/40"
          : active ? "border-sky-200 bg-sky-50/50"
          : "border-slate-200 bg-white hover:border-slate-300",
      )}>
        <div className="flex items-center justify-between gap-1.5 mb-1.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium leading-tight truncate" title={label}>{label}</p>
          {unit && (
            <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide shrink-0">{unit}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} className={stepBtn} aria-label={`Decrease ${label}`}>
            <Minus className="h-3 w-3" />
          </button>
          <input
            type="text"
            value={g[k] ?? ""}
            onChange={(e) => sg(k, e.target.value)}
            className={cn(
              "w-full h-7 px-2 text-sm text-center rounded-md bg-background tabular-nums focus:ring-1 focus:ring-sky-400 focus:outline-none transition-colors",
              active ? "border border-sky-300 text-sky-700 font-bold" : "border border-input text-slate-600",
            )}
          />
          <button type="button" onClick={() => step(1)} className={stepBtn} aria-label={`Increase ${label}`}>
            <Plus className="h-3 w-3" />
          </button>
        </div>
        <StockChip stock={st} planned={Number(g[k]) || 0} unit={unit} />
      </div>
    );
  }

  // A computed auto-total cell (distinct from a hand-keyed line) — shown for the
  // rollup fields inside the item-group tabs so a total reads as "derived", not
  // something the planner should type into.
  const AutoTotal = ({ label, value }: { label: string; value: string | number }) => (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-2">
      <div className="flex items-center justify-between gap-1.5 mb-1.5">
        <p className="text-[10px] text-emerald-700 uppercase tracking-wider font-semibold leading-tight truncate" title={label}>{label}</p>
        <span className="text-[8px] font-bold text-emerald-600 bg-emerald-100 px-1 py-0.5 rounded uppercase tracking-wide shrink-0">Auto</span>
      </div>
      <div className="w-full h-7 px-2 text-sm font-bold border border-emerald-200 rounded-md bg-white text-emerald-700 tabular-nums flex items-center justify-center">
        {value === "" || value == null ? "—" : value}
      </div>
    </div>
  );

  // Renders every sheet section of an item-master group as an editable grid,
  // each section boxed as a card with a filled-lines count. A top summary strip
  // rolls up how many lines across the whole group are loaded.
  const renderItemGroup = (group: string) => {
    const secs = sheetSections.filter((sec) => sec.group === group);
    const editableOf = (sec: (typeof secs)[number]) => sec.fields.filter((f) => !f.auto);
    const setCountOf = (sec: (typeof secs)[number]) => editableOf(sec).filter((f) => (Number(g[f.k]) || 0) > 0).length;
    // Lines asking for more than the selected warehouse holds.
    const isShort = (key: string) => {
      const st = lineStock.get(key);
      return !!st?.tracked && (Number(g[key]) || 0) > st.available;
    };
    const shortCountOf = (sec: (typeof secs)[number]) => editableOf(sec).filter((f) => isShort(f.k)).length;
    const groupLines = secs.reduce((n, sec) => n + editableOf(sec).length, 0);
    const groupSet = secs.reduce((n, sec) => n + setCountOf(sec), 0);
    const groupShort = secs.reduce((n, sec) => n + shortCountOf(sec), 0);
    const meta = galleyGroups.find((gr) => gr.id === group) ?? { id: group, label: group, caption: undefined, icon: undefined };
    const GroupIcon = GROUP_ICONS[meta.icon ?? ""] ?? Boxes;
    return (
      <div className="space-y-4">
        {/* Group summary strip */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-100 bg-gradient-to-r from-sky-50 to-transparent px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg bg-sky-100 text-sky-700">
              <GroupIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 leading-tight">{meta.label}</p>
              {meta.caption && <p className="text-[11px] text-muted-foreground truncate">{meta.caption}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* Where the counts are being drawn from — the stock figures on every
                line below are this warehouse's, so it is named up front. */}
            <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-2.5 py-1.5">
              <Warehouse className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <div className="leading-tight">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Stock from</p>
                <p className="text-[11px] font-semibold text-slate-700">{sourceWarehouseName}</p>
              </div>
            </div>
            {groupShort > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <div className="leading-tight">
                  <p className="text-sm font-bold tabular-nums">{groupShort}</p>
                  <p className="text-[9px] uppercase tracking-wider">over stock</p>
                </div>
              </div>
            )}
            <div className="text-right">
              <p className="text-lg font-bold text-sky-700 tabular-nums leading-none">
                {groupSet}<span className="text-xs font-medium text-slate-400">/{groupLines}</span>
              </p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">lines loaded</p>
            </div>
          </div>
        </div>

        {/* One card per section */}
        {secs.map((sec) => {
          const editable = editableOf(sec);
          const setCount = editable.filter((f) => (Number(g[f.k]) || 0) > 0).length;
          const shortCount = shortCountOf(sec);
          return (
            <div key={sec.title} className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                <span className="text-[11px] font-bold uppercase tracking-widest text-sky-700">{sec.title}</span>
                <div className="flex items-center gap-1.5">
                  {shortCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 tabular-nums">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {shortCount} over stock
                    </span>
                  )}
                  <span className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full tabular-nums",
                    setCount > 0 ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-400",
                  )}>
                    {setCount}/{editable.length} set
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 p-4">
                {sec.fields.map((f) =>
                  f.auto
                    ? <AutoTotal key={f.k} label={f.label} value={derivedTotals[f.k] ?? "0"} />
                    : <GF key={f.k} k={f.k} label={f.label} unit={f.unit} />,
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Load Summary + Meals always show; one loading tab per galley group follows,
  // in the group master's order — the groups themselves come from the Item
  // Profile, so a new group needs no change here. The loading tabs appear only
  // once an aircraft type is selected (quantities come from its standard).
  //
  // A group whose every line is switched off in Galley Items Group drops out
  // too: an empty tab reads as "nothing configured" when the truth is "nothing
  // in scope", and there is nothing to do on it either way.
  const TABS: { key: GTab; label: string }[] = [
    { key: "overview", label: "Load Summary" },
    { key: "meals", label: "Meals" },
    ...(aircraftType
      ? galleyGroups
          .filter((gr) => sheetSections.some((sec) => sec.group === gr.id))
          .map((gr) => ({ key: gr.id as GTab, label: gr.label }))
      : []),
  ];

  /**
   * Substitute one dish of one meal, on one leg.
   *
   * The replacement list is Menu Planning's dish master, not free text: a dish
   * the kitchen already has a recipe and a cost for is something production can
   * actually make, and anything else would be a note that nobody can cook. Each
   * option shows what the source warehouse holds, so a substitution isn't made
   * into a second shortage.
   */
  const SwapDishDialog = () => {
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [reason, setReason] = useState("");
    const [query, setQuery] = useState("");

    useEffect(() => {
      setFrom(swapTarget?.components[0]?.name ?? "");
      setTo(""); setReason(""); setQuery("");
    }, [swapTarget]);

    if (!swapTarget) return null;
    const options = dishMaster.filter(
      (d) => d.name !== from && d.name.toLowerCase().includes(query.trim().toLowerCase()),
    );

    return (
      <Dialog open onOpenChange={(open) => !open && setSwapTarget(null)}>
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          <DialogHeader className="border-b border-border px-5 py-4 space-y-0">
            <DialogTitle className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Replace className="h-4 w-4 text-amber-600" /> Substitute a dish
            </DialogTitle>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {swapTarget.mealName} · {swapTarget.flight} — this leg only. The menu card is
              unchanged, and the change is logged as an LMC so Production and Packaging see it.
            </p>
          </DialogHeader>

          <div className="px-5 py-4 space-y-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Dish to replace</p>
              <select value={from} onChange={(e) => { setFrom(e.target.value); setTo(""); }} className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                {swapTarget.components.map((c) => (
                  <option key={c.name} value={c.swappedFrom ?? c.name}>
                    {c.swappedFrom ? `${c.swappedFrom} (currently ${c.name})` : c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Replace with</p>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the menu's dishes…"
                className="h-8 text-xs mb-1.5"
              />
              <div className="max-h-52 overflow-y-auto rounded-md border border-input divide-y divide-border">
                {options.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No dish matches.</p>
                ) : options.map((d) => {
                  const st = stockLookup.forName(d.name);
                  return (
                    <button
                      key={d.name}
                      type="button"
                      onClick={() => setTo(d.name)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors",
                        to === d.name ? "bg-amber-50 text-amber-900" : "hover:bg-muted/60",
                      )}
                    >
                      <span className="min-w-0 truncate">
                        {d.name}
                        <span className="text-muted-foreground"> · {d.weight}g · {d.calories} kcal</span>
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                        {st.tracked ? `${fmtQty(st.available)} in stock` : "no stock record"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Reason <span className="normal-case tracking-normal">— goes on the LMC entry</span>
              </p>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Beef unavailable — supplier short"
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button variant="outline" size="sm" onClick={() => setSwapTarget(null)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!from || !to}
              onClick={() => applySwap(swapTarget, from, to, reason)}
            >
              Substitute &amp; log LMC
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  // A rotation leg rendered as a compact stat card — direction, flight, sector,
  // date and its own PAX/Crew load. Both the outbound and return legs use it.
  const legCard = (
    direction: Parameters<typeof dirBadge>[0], code: string,
    sector?: string, date?: string, pax = 0, crew = 0,
  ) => (
    <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
      {dirBadge(direction)}
      <span className="font-bold text-white bg-sky-600 px-2 py-0.5 rounded-full text-[11px]">{code}</span>
      <span className="text-xs text-slate-600">{sector ?? "—"}</span>
      {date && <span className="text-[11px] text-slate-400">{date}</span>}
      <span className="h-3.5 w-px bg-slate-200" />
      <span className="text-[11px] text-slate-500">PAX <b className="text-slate-800 tabular-nums">{pax}</b></span>
      <span className="text-[11px] text-slate-500">Crew <b className="text-slate-800 tabular-nums">{crew}</b></span>
    </div>
  );

  // The sheet itself is identical in both presentations — only the shell around
  // it differs (full page section vs. dialog).
  const sheet = (
      <>

        {/* Header */}
        <div className="bg-gradient-to-r from-sky-50 via-white to-white border-b border-slate-200 px-6 pt-5 pb-0 shrink-0">
          <div className="flex items-start justify-between mb-3 gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 mb-2.5">
                <div className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg bg-sky-600 text-white shadow-sm">
                  <PlaneTakeoff className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-slate-800 leading-tight">Galley Planning</h2>
                  <p className="text-[11px] text-muted-foreground leading-tight">Per-flight galley load — set counts, then forward to loading</p>
                </div>
              </div>
              {/* One card per leg of the rotation. The plan covers both by
                  default; the return can be dropped when it is not ours to
                  load (catered down-route, cancelled, or planned separately). */}
              <div className="flex flex-wrap items-center gap-2">
                {legCard(order?.direction, flight?.flight ?? entry.flightId, flight?.sector, entry.packagingDate, planPax, planCrew)}
                {returnOrder && (
                  <div className={cn("flex items-center gap-2", !includeReturn && "opacity-50")}>
                    {legCard(returnOrder.direction, returnOrder.flight, returnOrder.sector, returnOrder.date, retPax, retCrew)}
                  </div>
                )}
              </div>
              {returnOrder && (
                <label
                  className="mt-2 inline-flex cursor-pointer items-center gap-2 text-[11px] text-slate-600"
                  title={includeReturn
                    ? `${returnOrder.flight} (${returnOrder.sector}) is planned with this rotation. Untick to plan ${flight?.flight ?? entry.flightId} on its own — the return's load, meals and standards drop out of the sheet.`
                    : `Only ${flight?.flight ?? entry.flightId} is being planned. Tick to bring ${returnOrder.flight} back into this plan.`}
                >
                  <input
                    type="checkbox"
                    checked={includeReturn}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setIncludeReturn(on);
                      // Re-derive the sheet immediately: the arrival half's
                      // quantities come from the return's load, so the standards
                      // must be re-applied with (or without) it.
                      rebuildPlan(planPax, planCrew, aircraftType, on ? { pax: retPax, crew: retCrew } : undefined);
                    }}
                    className="h-3.5 w-3.5 cursor-pointer accent-sky-600"
                  />
                  <span>
                    Plan the return leg <b className="text-slate-800">{returnOrder.flight}</b> with this rotation
                    {!includeReturn && (
                      <span className="ml-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        outbound only
                      </span>
                    )}
                  </span>
                </label>
              )}
              {/* Loading standard — aircraft type sets which standard applies;
                  model is an informational variant configured under Aircraft. */}
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Aircraft</span>
                <select
                  value={aircraftType}
                  onChange={(e) => applyAircraft(e.target.value)}
                  title="Aircraft type — sets the loading standard for this plan"
                  className="h-7 px-2 text-[11px] rounded-md bg-white text-slate-700 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-400 cursor-pointer"
                >
                  <option value="">Select aircraft…</option>
                  {aircraftTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {aircraftType && modelsForType.length > 0 && (
                  <select
                    value={aircraftModel}
                    onChange={(e) => setAircraftModel(e.target.value)}
                    title="Aircraft model — configured in Configuration → Aircraft"
                    className="h-7 px-2 text-[11px] rounded-md bg-white text-slate-700 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-400 cursor-pointer"
                  >
                    <option value="">Select model…</option>
                    {modelsForType.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                )}
                {!aircraftType && (
                  <span className="text-[10px] text-amber-600 font-medium">← pick one to unlock beverages, amenities &amp; equipment</span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded transition-colors shrink-0">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3.5 py-2 text-[11px] font-semibold border-b-2 -mb-px rounded-t-md transition-colors ${
                  tab === key ? "border-sky-600 text-sky-700 bg-sky-50/70" : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Stock source — where the transferred consumables are drawn from */}
        <div className="shrink-0 border-b bg-slate-50/70 px-6 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-sky-700 flex items-center gap-1.5">
            <Warehouse className="h-3.5 w-3.5" /> Transfer From
          </span>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-wider font-semibold">Office</span>
            <select
              value={source.officeId}
              onChange={(e) => changeOffice(e.target.value)}
              className="h-8 px-2 text-[11px] min-w-[150px] border border-slate-300 rounded-md bg-white focus:ring-1 focus:ring-sky-400 focus:outline-none"
            >
              {activeOffices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-wider font-semibold">Warehouse</span>
            <select
              value={source.warehouseId}
              onChange={(e) => setSource((s) => ({ ...s, warehouseId: e.target.value }))}
              className="h-8 px-2 text-[11px] min-w-[170px] border border-slate-300 rounded-md bg-white focus:ring-1 focus:ring-sky-400 focus:outline-none"
            >
              {warehouseChoices.length === 0 && <option value="">No warehouses</option>}
              {warehouseChoices.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>

        {/* Tab content — scrolls inside the dialog; flows with the page when full page. */}
        <div className={`bg-slate-50/20 px-6 py-5 ${fullPage ? "" : "flex-1 overflow-y-auto"}`}>

          {tab === "overview" && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <GalleySecTitle>Flight Order</GalleySecTitle>
                </div>
                {order ? (
                  <>
                    <div className="flex items-center gap-2 mb-1.5">
                      {dirBadge(order.direction)}
                      <span className="text-xs font-semibold text-slate-700">{order.flight}</span>
                      <span className="text-[11px] text-muted-foreground">{outboundSector}</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <RO label="Order #" value={order.orderNo} />
                      <RO label="Flight" value={order.flight} />
                      <RO label="Airline" value={order.airline} />
                      <RO label="Status" value={order.status} />
                      <RO label="Sector" value={outboundSector} />
                      <RO label="Direction" value={order.direction} />
                      <RO label="Date" value={order.date} />
                      <RO label="ETD" value={order.etd} />
                    </div>

                    {/* This leg's load counts sit with the leg they belong to. */}
                    <div className="mt-4">
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

                    {/* The return leg of this rotation — planned on the same
                        sheet, unless the planner excluded it in the header. */}
                    {planReturn && (
                      <div className="mt-5">
                        <div className="flex items-center gap-2 mb-1.5">
                          {dirBadge(planReturn.direction)}
                          <span className="text-xs font-semibold text-slate-700">{planReturn.flight}</span>
                          <span className="text-[11px] text-muted-foreground">{planReturn.sector}</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <RO label="Order #" value={planReturn.orderNo} />
                          <RO label="Flight" value={planReturn.flight} />
                          <RO label="Airline" value={planReturn.airline} />
                          <RO label="Status" value={planReturn.status} />
                          <RO label="Sector" value={planReturn.sector} />
                          <RO label="Direction" value={planReturn.direction} />
                          <RO label="Date" value={planReturn.date} />
                          <RO label="ETD" value={planReturn.etd} />
                        </div>

                        <div className="mt-4">
                        <GalleySecTitle>
                          Load Counts
                          <span className="ml-2 text-[9px] font-normal normal-case tracking-normal text-muted-foreground">Editable — override if an updated record arrives</span>
                        </GalleySecTitle>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium leading-tight mb-0.5">Passengers (PAX)</p>
                            <input
                              type="number" min={0} value={retPax}
                              onChange={(e) => { const v = e.target.value === "" ? 0 : Number(e.target.value); if (!Number.isNaN(v)) applyReturnLoad(Math.max(0, v), retCrew); }}
                              className="w-full h-7 px-2 text-xs border border-input rounded-md bg-background tabular-nums focus:ring-1 focus:ring-ring focus:outline-none"
                            />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium leading-tight mb-0.5">Crew</p>
                            <input
                              type="number" min={0} value={retCrew}
                              onChange={(e) => { const v = e.target.value === "" ? 0 : Number(e.target.value); if (!Number.isNaN(v)) applyReturnLoad(retPax, Math.max(0, v)); }}
                              className="w-full h-7 px-2 text-xs border border-input rounded-md bg-background tabular-nums focus:ring-1 focus:ring-ring focus:outline-none"
                            />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium leading-tight mb-0.5">Special Meals</p>
                            <input
                              type="number" min={0} value={retSpecialMeals}
                              onChange={(e) => { const v = e.target.value === "" ? 0 : Number(e.target.value); if (!Number.isNaN(v)) setRetSpecialMeals(Math.max(0, v)); }}
                              className="w-full h-7 px-2 text-xs border border-input rounded-md bg-background tabular-nums focus:ring-1 focus:ring-ring focus:outline-none"
                            />
                          </div>
                          <RO label="Total Meals (PAX + Crew + Special)" value={retPax + retCrew + retSpecialMeals} />
                        </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    No matching flight order found in Order Management for <strong>{flightNo}</strong>{entry.packagingDate ? ` on ${entry.packagingDate}` : ""}. Showing schedule data only.
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "meals" && (
            <div className="space-y-6">
              {/* One breakdown per leg of the rotation — the outbound leg, then
                  the return leg scaled to its own load counts. */}
              <div>
                <GalleySecTitle>Meals</GalleySecTitle>
                <div className="flex items-center gap-2 mb-2">
                  {dirBadge(order?.direction)}
                  <span className="text-xs font-semibold text-slate-700">{order?.flight ?? flightNo}</span>
                </div>
                {/* What the meals ARE (Menu Planning) before how many go on
                    board (Dispatch) — the counts below are of these dishes. */}
                <div className="mb-4">{menuBlock(outboundLeg, order?.flight ?? flightNo)}</div>
                {mealsBlock(
                  dispatchSection ? scaledMeals : null,
                  order?.flight ?? flightNo,
                  // The EDITED special-meal count, not the order's original — the
                  // Load Counts field exists to override an outdated record, so
                  // the special rows have to follow it.
                  outboundLeg && { ...outboundLeg, specialMeals },
                  planPax,
                  planCrew,
                )}
              </div>
              {planReturn && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    {dirBadge(planReturn.direction)}
                    <span className="text-xs font-semibold text-slate-700">{planReturn.flight}</span>
                    <span className="text-[11px] text-muted-foreground">{planReturn.sector}</span>
                  </div>
                  <div className="mb-4">{menuBlock(planReturn, planReturn.flight)}</div>
                  {mealsBlock(
                    retScaledMeals, planReturn.flight,
                    { ...planReturn, specialMeals: retSpecialMeals },
                    retPax, retCrew,
                  )}
                </div>
              )}
              {returnOrder && !includeReturn && (
                <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800">
                  <b>{returnOrder.flight}</b> ({returnOrder.sector}) is paired with this rotation but excluded from
                  this plan — its meals are not loaded here. Tick <b>Plan the return leg</b> in the header to include it.
                </div>
              )}
            </div>
          )}

          {isGroupTab(tab) && renderItemGroup(tab)}
        </div>

        <SwapDishDialog />

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

      </>
  );

  return (
    <>
    {fullPage ? (
      <div className="rounded-lg border border-border bg-white shadow-sm overflow-hidden">
        {sheet}
      </div>
    ) : (
      <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="w-full max-w-[95vw] lg:max-w-5xl max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
          {sheet}
        </DialogContent>
      </Dialog>
    )}

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
