import { useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Upload, Download, Save, FileSpreadsheet, FileText, FileType,
  History, CheckCircle2, AlertCircle, Eye, CalendarRange, X, Plane, ArrowLeft, Pencil, CircleDot,
  Users, Utensils, CornerUpLeft, MessageSquare, Trash2, Search, ChevronDown, Check, RotateCcw,
  HelpCircle, Wand2,
} from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  recentUploads,
  FLIGHT_ORDER_STATUS_FLOW, nextFlightStatus,
  isDomesticSector,
  SPECIAL_MEAL_CODES, SPECIAL_MEAL_BY_CODE,
  type FlightDirection, type FlightOrderStatus, type MealSlot,
  type SpecialMealEntry, type SpecialMealCategory,
} from "@/lib/sample-data";
import { useMealSlots, resolveMealSlot, formatSlotRange } from "@/lib/meal-slot-settings";
import {
  useFlightOrders, addFlightOrders, updateFlightOrder,
  amendOrder, getOrderAmendments, revertAmendment, canRevertAmendment,
  leadHoursToDeparture, isLmcLead, hasDeparted, getLmcWindowHours,
  type OrderAmendment,
} from "@/lib/flight-orders-store";
import { getAuthUser } from "@/lib/auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useArrivalFlash } from "@/lib/arrival-flash";
import { useRole } from "@/lib/roles";
import { useAccess, canElement, useElementPermission } from "@/lib/access-control";

// Coloured 3px left edge on an order-group band, keyed to its status — green
// family for done/approved, amber for production, gold for pending. (Design:
// `.g-done/.g-appr/.g-prod/.g-pend` accents in order-management.css.)
function orderBarColor(status: FlightOrderStatus): string {
  switch (status) {
    case "Production": return "#b45309"; // --warn
    case "Pending":    return "#b88a12"; // --gold-bright
    case "Completed":  return "#0f7a40"; // --ok
    default:           return "#1f9d57"; // --ok-bright (Approved / Dispatched)
  }
}

// Status pill on the group band — matches the design's `.om-stat` palette, which
// deliberately keeps Pending a distinct *gold* so it reads apart from Production's
// amber (the shared StatusBadge collapses both to amber, so this stays page-local).
const OM_STAT_CLS: Record<FlightOrderStatus, string> = {
  Completed:  "text-[#0f7a40] bg-[#ecf5ef] border-[#c4e3cf]",
  Approved:   "text-[#1f9d57] bg-[#ecf5ef] border-[#c4e3cf]",
  Dispatched: "text-[#1f9d57] bg-[#ecf5ef] border-[#c4e3cf]",
  Production: "text-[#b45309] bg-[#fbf1e6] border-[#f0d9bf]",
  Pending:    "text-[#8a6400] bg-[#fbf4e2] border-[#ecdcae]",
};

function OmStatusPill({ status }: { status: FlightOrderStatus }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.04em] " +
        OM_STAT_CLS[status]
      }
    >
      {status}
    </span>
  );
}

function OrderStatusBadges({ legs }: { legs: { status: FlightOrderStatus; reviewComment?: string }[] }) {
  if (legs.length === 0) return null;
  // A leg returned for correction (reviewComment while still Pending) shows a
  // distinct amber "Reviewed" pill so the requester notices it in the list.
  const reviewed = legs.some((l) => l.reviewComment && l.status === "Pending");
  if (reviewed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.04em] text-amber-700 bg-amber-100 border-amber-300">
        <CornerUpLeft className="h-3 w-3" /> Reviewed
      </span>
    );
  }
  return <OmStatusPill status={legs[0].status} />;
}

type FlightOrder = {
  id: string;        // unique row id (one row = one flight)
  orderNo: string;   // the displayed Order # — repeats across legs of the same order
  flight: string;
  airline: string;
  sector: string;
  date: string;
  etd: string;
  pax: number;
  crew: number;
  specialMeals: number;
  status: FlightOrderStatus;
  direction: FlightDirection;
  specialMealRoster?: SpecialMealEntry[];
  orderType?: "flight" | "crew";
  /** Explicit round-trip link from the bulk-upload "Trip Ref" column — both legs
   *  share it so dispatch pairs them even with identical sectors / shared Order #. */
  pairId?: string;
  /** Epoch ms when created in-app — created orders sort above seed rows (newest first). */
  createdAt?: number;
  /** Approver's review note when returned for correction (status stays Pending). */
  reviewComment?: string;
  reviewedBy?: string;
  reviewedAt?: string;
};

const AIRLINES = ["US-Bangla", "Air Astra"];
const AIRPORTS: { code: string; name: string }[] = [
  { code: "DAC", name: "Dhaka" },
  { code: "CXB", name: "Cox's Bazar" },
  { code: "CGP", name: "Chattogram" },
  { code: "ZYL", name: "Sylhet" },
  { code: "JSR", name: "Jashore" },
  { code: "DXB", name: "Dubai" },
  { code: "DOH", name: "Doha" },
  { code: "LHR", name: "London Heathrow" },
  { code: "KUL", name: "Kuala Lumpur" },
  { code: "BKK", name: "Bangkok" },
  { code: "SIN", name: "Singapore" },
  { code: "CCU", name: "Kolkata" },
  { code: "DEL", name: "Delhi" },
  { code: "KTM", name: "Kathmandu" },
];

// ── Flight schedule (master) ────────────────────────────────────────────────
// A scheduled flight is the operational timetable a flight order is created
// against: pick a date, and the flights that operate on that weekday become
// selectable. Selecting one auto-fills the order's Scope / Airline / sector /
// ETD / crew (all still editable). `days` uses JS weekday numbers (0 = Sunday
// … 6 = Saturday); a flight operates only on the days it lists.
type ScheduledFlight = {
  flight: string;
  airline: string;
  scope: "Domestic" | "International";
  from: string; // airport code
  to: string;   // airport code
  etd: string;  // HH:mm (24h)
  crew: number; // rostered cockpit + cabin crew
  direction: FlightDirection;
  days: number[];
  /** The paired leg of this rotation (the return of an outbound, or vice
   *  versa) — flight number of the counterpart in this same list. Absent when
   *  the flight has no scheduled return, so the round-trip option is hidden. */
  pair?: string;
};

const EVERYDAY = [0, 1, 2, 3, 4, 5, 6];

const FLIGHT_SCHEDULE: ScheduledFlight[] = [
  // Domestic — US-Bangla
  { flight: "BS-101", airline: "US-Bangla", scope: "Domestic", from: "DAC", to: "CGP", etd: "08:30", crew: 4, direction: "Outbound", days: EVERYDAY, pair: "BS-102" },
  { flight: "BS-102", airline: "US-Bangla", scope: "Domestic", from: "CGP", to: "DAC", etd: "10:30", crew: 4, direction: "Return", days: EVERYDAY, pair: "BS-101" },
  { flight: "BS-117", airline: "US-Bangla", scope: "Domestic", from: "DAC", to: "ZYL", etd: "07:00", crew: 4, direction: "Outbound", days: EVERYDAY, pair: "BS-118" },
  { flight: "BS-118", airline: "US-Bangla", scope: "Domestic", from: "ZYL", to: "DAC", etd: "09:00", crew: 4, direction: "Return", days: EVERYDAY, pair: "BS-117" },
  { flight: "BS-141", airline: "US-Bangla", scope: "Domestic", from: "DAC", to: "CXB", etd: "10:00", crew: 4, direction: "Outbound", days: EVERYDAY, pair: "BS-142" },
  { flight: "BS-142", airline: "US-Bangla", scope: "Domestic", from: "CXB", to: "DAC", etd: "12:00", crew: 4, direction: "Return", days: EVERYDAY, pair: "BS-141" },
  // Domestic — Air Astra
  { flight: "2A-231", airline: "Air Astra", scope: "Domestic", from: "DAC", to: "JSR", etd: "11:15", crew: 3, direction: "Outbound", days: [1, 3, 5, 0], pair: "2A-232" },
  { flight: "2A-232", airline: "Air Astra", scope: "Domestic", from: "JSR", to: "DAC", etd: "13:00", crew: 3, direction: "Return", days: [1, 3, 5, 0], pair: "2A-231" },
  // International — US-Bangla
  { flight: "BS-203", airline: "US-Bangla", scope: "International", from: "DAC", to: "DXB", etd: "12:15", crew: 8, direction: "Outbound", days: EVERYDAY, pair: "BS-204" },
  { flight: "BS-204", airline: "US-Bangla", scope: "International", from: "DXB", to: "DAC", etd: "20:00", crew: 8, direction: "Return", days: EVERYDAY, pair: "BS-203" },
  { flight: "BS-225", airline: "US-Bangla", scope: "International", from: "DAC", to: "DOH", etd: "15:40", crew: 8, direction: "Outbound", days: EVERYDAY },
  { flight: "BS-307", airline: "US-Bangla", scope: "International", from: "DAC", to: "KUL", etd: "23:50", crew: 12, direction: "Outbound", days: [1, 3, 5, 0] },
  { flight: "BS-411", airline: "US-Bangla", scope: "International", from: "CGP", to: "DXB", etd: "18:25", crew: 8, direction: "Outbound", days: [2, 4, 6] },
  { flight: "BS-501", airline: "US-Bangla", scope: "International", from: "DAC", to: "BKK", etd: "09:20", crew: 8, direction: "Outbound", days: EVERYDAY },
  { flight: "BS-601", airline: "US-Bangla", scope: "International", from: "DAC", to: "SIN", etd: "14:10", crew: 10, direction: "Outbound", days: [1, 4, 6] },
  // International — Air Astra
  { flight: "2A-701", airline: "Air Astra", scope: "International", from: "DAC", to: "CCU", etd: "16:30", crew: 6, direction: "Outbound", days: EVERYDAY },
];

/** The scheduled counterpart (return↔outbound) of a flight number, if any. */
function pairScheduledFlight(flightNo: string): ScheduledFlight | undefined {
  const sf = FLIGHT_SCHEDULE.find((f) => f.flight === flightNo);
  return sf?.pair ? FLIGHT_SCHEDULE.find((f) => f.flight === sf.pair) : undefined;
}

/** Weekday (0–6) for an ISO `YYYY-MM-DD` date, or null when unparseable. */
function weekdayOfISO(dateISO: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.getDay();
}

/** Flights that operate on the given date, sorted by departure time. */
function scheduledFlightsForDate(dateISO: string): ScheduledFlight[] {
  const wd = weekdayOfISO(dateISO);
  if (wd == null) return [];
  return FLIGHT_SCHEDULE
    .filter((f) => f.days.includes(wd))
    .sort((a, b) => a.etd.localeCompare(b.etd));
}

/** Local `YYYY-MM-DD` for a Date (no UTC shift). */
function toISODate(d: Date): string {
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mo}-${da}`;
}

/**
 * The return leg's own departure date, given the outbound's date and time. A
 * return departs the same day when it operates that weekday AND leaves later
 * than the outbound (a turnaround); otherwise it rolls forward to the next date
 * the return flight actually operates (an overnight / next-available return).
 */
function returnFlightDate(outboundDateISO: string, outboundEtd: string, rf: ScheduledFlight): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(outboundDateISO);
  if (!m) return outboundDateISO;
  const base = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (rf.days.includes(base.getDay()) && rf.etd > outboundEtd) return outboundDateISO;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (rf.days.includes(d.getDay())) return toISODate(d);
  }
  return outboundDateISO;
}

type ParsedRow = {
  row: number;
  id: string;
  flight: string;
  airline: string;
  sector: string;
  etd: string;
  pax: number;
  specialMeals: number;
  valid: boolean;
  type: "Domestic" | "International";
  zenLoad?: number;
  totalMeal?: number;
  specMeal?: number;
  crewMeal?: number;
  bcLoad?: number;
  ecLoad?: number;
  bcMeal?: number;
  ecMeal?: number;
  chml?: number;
  vgml?: number;
  returnFlight?: string;
  returnSector?: string;
  date?: string;
  direction?: FlightDirection;
  /** "Trip Ref" column — a user token shared by an outbound + its return so the
   *  two legs are linked into one round trip on dispatch. Blank ⇒ unpaired. */
  tripRef?: string;
  /** Crew-meal upload only: number of crew + the meal slot. */
  crew?: number;
  mealSlot?: string;
  /** Special-meal manifest rows matched to this flight (Flight No + Date). */
  roster?: SpecialMealEntry[];
};

/** One row of an uploaded Special-Meals manifest, before it's matched to a flight. */
type SpecialMealUpload = {
  flight: string;
  date: string;
  pnr: string;
  passengerName: string;
  seat: string;
  mealCode: string;
  audience: "Passenger" | "Crew";
};

// ── CSV parsing for the bulk-upload templates ───────────────────────────────
// Splits one CSV line honouring double-quoted fields (so a quoted comma or an
// escaped "" inside a value doesn't break the column count).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Parse CSV text into objects keyed by lower-cased header. Strips a UTF-8 BOM. */
function parseCsvRecords(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { rec[h] = cells[i] ?? ""; });
    return rec;
  });
}

/** Normalise a date cell to yyyy-mm-dd (accepts "2026-05-24" or Excel "5/24/2026"). */
function normalizeDate(s: string): string {
  const t = (s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // M/D/YYYY (Excel default)
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return t;
}

const pick = (rec: Record<string, string>, ...keys: string[]): string => {
  for (const k of keys) if (rec[k]) return rec[k];
  return "";
};

/** Parse an uploaded flight-orders CSV into ParsedRow[]. Returns [] when the
 *  text isn't our CSV (e.g. a binary .xlsx read as text) so callers can fall
 *  back to the sample preview. */
function parseFlightCsv(text: string): ParsedRow[] {
  if (!/flight/i.test(text.split(/\r?\n/)[0] || "")) return [];
  return parseCsvRecords(text).map((rec, i) => {
    const flight = pick(rec, "flight no", "flight").toUpperCase();
    const from = pick(rec, "from");
    const to = pick(rec, "to");
    const sector = pick(rec, "sector") || (from && to ? `${from} → ${to}` : "");
    const pax = Number(pick(rec, "pax")) || 0;
    const crew = Number(pick(rec, "no of crew", "crew")) || 0;
    const specialMeals = Number(pick(rec, "special meals", "special meal")) || 0;
    const scopeRaw = pick(rec, "scope").toLowerCase();
    const type: "Domestic" | "International" = scopeRaw.startsWith("int")
      ? "International"
      : scopeRaw.startsWith("dom")
        ? "Domestic"
        : isDomesticSector(sector) ? "Domestic" : "International";
    const dirRaw = pick(rec, "direction").toLowerCase();
    const direction: FlightDirection = dirRaw.startsWith("ret") ? "Return" : "Outbound";
    return {
      row: i + 1,
      id: "",
      flight,
      airline: pick(rec, "airline"),
      sector,
      etd: pick(rec, "etd"),
      pax,
      crew,
      specialMeals,
      valid: !!flight && !!sector && pax > 0,
      type,
      direction,
      tripRef: pick(rec, "trip ref", "trip", "rotation", "pair"),
      date: normalizeDate(pick(rec, "date")),
    };
  });
}

/** Parse an uploaded Special-Meals manifest CSV. */
function parseSpecialCsv(text: string): SpecialMealUpload[] {
  if (!/pnr|meal code/i.test(text.split(/\r?\n/)[0] || "")) return [];
  return parseCsvRecords(text)
    .map((rec) => ({
      flight: pick(rec, "flight no", "flight").toUpperCase(),
      date: normalizeDate(pick(rec, "date")),
      pnr: pick(rec, "pnr"),
      passengerName: pick(rec, "passenger name", "name"),
      seat: pick(rec, "seat"),
      mealCode: pick(rec, "meal code", "code").toUpperCase(),
      // Optional "Audience"/"For" column — "crew" → Crew, anything else Passenger.
      audience: /crew/i.test(pick(rec, "audience", "for", "type")) ? "Crew" as const : "Passenger" as const,
    }))
    .filter((r) => r.flight && r.mealCode);
}

/** Parse an uploaded Crew-Meals CSV into ParsedRow[] (one row per flight, with a
 *  crew count + meal slot). Mirrors parseFlightCsv so crew meals follow the same
 *  preview → import flow as flight orders. Returns [] for non-CSV (xlsx) text. */
function parseCrewCsv(text: string): ParsedRow[] {
  if (!/flight/i.test(text.split(/\r?\n/)[0] || "")) return [];
  return parseCsvRecords(text).map((rec, i) => {
    const flight = pick(rec, "flight no", "flight").toUpperCase();
    const from = pick(rec, "from");
    const to = pick(rec, "to");
    const sector = pick(rec, "sector") || (from && to ? `${from} → ${to}` : "");
    const crew = Number(pick(rec, "no of crew", "crew")) || 0;
    const scopeRaw = pick(rec, "scope").toLowerCase();
    const type: "Domestic" | "International" = scopeRaw.startsWith("int")
      ? "International"
      : scopeRaw.startsWith("dom")
        ? "Domestic"
        : isDomesticSector(sector) ? "Domestic" : "International";
    const dirRaw = pick(rec, "direction").toLowerCase();
    const direction: FlightDirection = dirRaw.startsWith("ret") ? "Return" : "Outbound";
    const etd = pick(rec, "etd");
    // Business rule: the meal slot is derived from the ETD (configured slot
    // windows). Falls back to the uploaded column only when no ETD is given.
    const mealSlot = etd ? resolveMealSlot(etd).name : pick(rec, "meal slot", "slot");
    return {
      row: i + 1,
      id: "",
      flight,
      airline: pick(rec, "airline"),
      sector,
      etd,
      pax: 0,
      specialMeals: 0,
      valid: !!flight && !!sector && crew > 0,
      type,
      direction,
      crew,
      mealSlot,
      date: normalizeDate(pick(rec, "date")),
    };
  });
}

/** Key a flight by Flight No + Date — the join key between manifests and flights. */
const flightKey = (flight: string, date?: string) => `${flight.toUpperCase()}__${date ?? ""}`;

const SAMPLE_PARSED_DOM: ParsedRow[] = [
  { row: 1, id: "ORD-3501", flight: "BS-141", airline: "US-Bangla", sector: "DAC → CXB", etd: "08:15", pax: 72, specialMeals: 4, valid: true,  type: "Domestic", zenLoad: 72, totalMeal: 72, specMeal: 4, crewMeal: 4, returnFlight: "BS-142", returnSector: "CXB → DAC", date: "2026-05-24" },
  { row: 2, id: "ORD-3502", flight: "BS-203", airline: "US-Bangla", sector: "DAC → CGP", etd: "10:30", pax: 88, specialMeals: 2, valid: true,  type: "Domestic", zenLoad: 88, totalMeal: 88, specMeal: 2, crewMeal: 4, returnFlight: "BS-204", returnSector: "CGP → DAC", date: "2026-05-24" },
  { row: 3, id: "ORD-3503", flight: "AA-101", airline: "Air Astra", sector: "DAC → ZYL", etd: "13:00", pax: 0,  specialMeals: 0, valid: false, type: "Domestic", date: "2026-05-24" },
  { row: 4, id: "ORD-3504", flight: "AA-202", airline: "Air Astra", sector: "DAC → CXB", etd: "15:45", pax: 66, specialMeals: 3, valid: true,  type: "Domestic", zenLoad: 66, totalMeal: 66, specMeal: 3, crewMeal: 4, returnFlight: "AA-203", returnSector: "CXB → DAC", date: "2026-05-24" },
  { row: 5, id: "ORD-3511", flight: "BS-143", airline: "US-Bangla", sector: "DAC → CXB", etd: "07:30", pax: 80, specialMeals: 3, valid: true,  type: "Domestic", zenLoad: 80, totalMeal: 80, specMeal: 3, crewMeal: 4, returnFlight: "BS-144", returnSector: "CXB → DAC", date: "2026-05-25" },
  { row: 6, id: "ORD-3512", flight: "BS-205", airline: "US-Bangla", sector: "DAC → CGP", etd: "11:00", pax: 76, specialMeals: 2, valid: true,  type: "Domestic", zenLoad: 76, totalMeal: 76, specMeal: 2, crewMeal: 4, returnFlight: "BS-206", returnSector: "CGP → DAC", date: "2026-05-25" },
  { row: 7, id: "ORD-3513", flight: "AA-103", airline: "Air Astra", sector: "DAC → ZYL", etd: "14:00", pax: 55, specialMeals: 1, valid: true,  type: "Domestic", zenLoad: 55, totalMeal: 55, specMeal: 1, crewMeal: 2, returnFlight: "AA-104", returnSector: "ZYL → DAC", date: "2026-05-25" },
  { row: 8, id: "ORD-3514", flight: "AA-204", airline: "Air Astra", sector: "DAC → CXB", etd: "16:30", pax: 70, specialMeals: 2, valid: true,  type: "Domestic", zenLoad: 70, totalMeal: 70, specMeal: 2, crewMeal: 4, returnFlight: "AA-205", returnSector: "CXB → DAC", date: "2026-05-25" },
  { row: 9, id: "ORD-3515", flight: "BS-167", airline: "US-Bangla", sector: "DAC → JSR", etd: "09:45", pax: 0,  specialMeals: 0, valid: false, type: "Domestic", date: "2026-05-25" },
];

const SAMPLE_PARSED_INTL: ParsedRow[] = [
  { row: 1, id: "ORD-3601", flight: "BS-225", airline: "US-Bangla", sector: "DAC → DXB", etd: "12:30", pax: 174, specialMeals: 14, valid: true,  type: "International", bcLoad: 12, ecLoad: 162, bcMeal: 12, ecMeal: 162, chml: 8,  vgml: 6, date: "2026-05-24" },
  { row: 2, id: "ORD-3602", flight: "BS-307", airline: "US-Bangla", sector: "DAC → KUL", etd: "23:50", pax: 282, specialMeals: 18, valid: true,  type: "International", bcLoad: 24, ecLoad: 258, bcMeal: 24, ecMeal: 258, chml: 10, vgml: 8, date: "2026-05-24" },
  { row: 3, id: "ORD-3603", flight: "BS-411", airline: "US-Bangla", sector: "CGP → DXB", etd: "18:25", pax: 162, specialMeals: 10, valid: true,  type: "International", bcLoad: 10, ecLoad: 152, bcMeal: 10, ecMeal: 152, chml: 6,  vgml: 4, date: "2026-05-24" },
  { row: 4, id: "ORD-3604", flight: "BS-???", airline: "US-Bangla", sector: "DAC → DOH", etd: "15:00", pax: 0,   specialMeals: 0,  valid: false, type: "International", date: "2026-05-24" },
  { row: 5, id: "ORD-3611", flight: "BS-227", airline: "US-Bangla", sector: "DAC → DXB", etd: "10:30", pax: 188, specialMeals: 12, valid: true,  type: "International", bcLoad: 16, ecLoad: 172, bcMeal: 16, ecMeal: 172, chml: 9,  vgml: 5, date: "2026-05-25" },
  { row: 6, id: "ORD-3612", flight: "BS-309", airline: "US-Bangla", sector: "DAC → KUL", etd: "22:00", pax: 270, specialMeals: 16, valid: true,  type: "International", bcLoad: 20, ecLoad: 250, bcMeal: 20, ecMeal: 250, chml: 8,  vgml: 6, date: "2026-05-25" },
  { row: 7, id: "ORD-3613", flight: "BS-413", airline: "US-Bangla", sector: "CGP → DXB", etd: "17:50", pax: 150, specialMeals: 8,  valid: true,  type: "International", bcLoad: 8,  ecLoad: 142, bcMeal: 8,  ecMeal: 142, chml: 5,  vgml: 3, date: "2026-05-25" },
  { row: 8, id: "ORD-3614", flight: "BS-501", airline: "US-Bangla", sector: "DAC → SIN", etd: "20:15", pax: 0,   specialMeals: 0,  valid: false, type: "International", date: "2026-05-25" },
];

type MealPlan = Record<string, number>;
type ActivityEntry = { message: string; user: string; role: string; at: string };
type MealOrderConfirmation = {
  timestamp: string;
  totalFlights: number;
  totalMeals: number;
  tomorrowDayName: string;
  dayAfterDayName: string;
  dayAfterDateStr: string;
  validIntl: ParsedRow[];
  validDom: ParsedRow[];
  dayAfterMenu: {
    intl: { depMealName: string; depChmlName: string; retMealName: string; retVgmlName: string };
    dom: { usbaBreakfastName: string; usbaLunchName: string; aaaBreakfastName: string; aaaLunchName: string; crewSnackName: string; crewLunchName: string; crewDinnerName: string };
  } | undefined;
};

// ISO "YYYY-MM-DD" ↔ local Date (parse/format as *local* to avoid the UTC
// off-by-one), plus a compact "05 Jul 2026" label for the range-picker trigger.
const isoToDate = (s: string): Date | undefined => {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const dateToIso = (d?: Date): string =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";
const fmtRangeDate = (s: string): string => {
  const d = isoToDate(s);
  return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
};

export default function OrderManagementPage() {
  useArrivalFlash();
  const navigate = useNavigate();
  const orders = useFlightOrders();
  // Action buttons are permissioned elements — shown only with "create".
  const canCreate = useElementPermission("/order-management", "action-create").create;
  const canBulk = useElementPermission("/order-management", "action-bulk").create;
  const [omParams, setOmParams] = useSearchParams();
  const [view, setView] = useState<"list" | "create" | "bulk" | "crew-create">(() => {
    const v = omParams.get("view");
    return (v === "bulk" || v === "create" || v === "crew-create") ? v : "list";
  });
  // Detail dialog — a single flight leg (row View) or a whole order (order-level
  // View, which shows every leg at once).
  const [detailView, setDetailView] = useState<{ order: FlightOrder; legs: FlightOrder[] } | null>(null);
  const viewLeg = (o: FlightOrder) => setDetailView({ order: o, legs: [o] });
  const viewOrder = (legs: FlightOrder[]) => { if (legs.length) setDetailView({ order: legs[0], legs }); };
  const [activeTab, setActiveTab] = useState<"flights" | "crew">("flights");
  const [confirmedOrder, setConfirmedOrder] = useState<MealOrderConfirmation | null>(null);
  const [nextDayDraftSaved, setNextDayDraftSaved] = useState(false);
  const [showNextDaySummary, setShowNextDaySummary] = useState(false);

  // ── Shared filter — drives the merged metric tiles and BOTH tabs. Draft
  // binds to the inputs; changes take effect only on "Apply" (Reset clears). ──
  const todayStr = new Date().toISOString().slice(0, 10);
  const EMPTY_FILTER = {
    search: "",
    scope: "All" as "All" | "Domestic" | "International",
    airline: "All",
    status: "All" as "All" | FlightOrderStatus,
    from: "",
    to: "",
  };
  const [draft, setDraft] = useState(EMPTY_FILTER);
  const [applied, setApplied] = useState(EMPTY_FILTER);
  const [lmcOnly, setLmcOnly] = useState<boolean>(
    () => new URLSearchParams(window.location.search).get("lmc") === "1",
  );
  // Controlled so the in-calendar "Apply" can close the popover.
  const [dateOpen, setDateOpen] = useState(false);
  const patchDraft = (p: Partial<typeof EMPTY_FILTER>) => setDraft((d) => ({ ...d, ...p }));
  const applyFilters = () => setApplied(draft);
  const resetFilters = () => { setDraft(EMPTY_FILTER); setApplied(EMPTY_FILTER); setLmcOnly(false); };
  const filterDirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const filtersActive =
    applied.search !== "" || applied.scope !== "All" || applied.airline !== "All" ||
    applied.status !== "All" || applied.from !== "" || applied.to !== "" || lmcOnly;
  const airlineOptions = useMemo(() => Array.from(new Set(orders.map((o) => o.airline))).sort(), [orders]);

  // Trigger label for the merged date-range control.
  const rangeLabel =
    draft.from && draft.to
      ? draft.from === draft.to
        ? draft.from === todayStr ? "Today" : fmtRangeDate(draft.from)
        : `${fmtRangeDate(draft.from)} → ${fmtRangeDate(draft.to)}`
      : draft.from ? `From ${fmtRangeDate(draft.from)}` : draft.to ? `Until ${fmtRangeDate(draft.to)}` : "All dates";

  // Deep-link ?lmc=1 has been read into `lmcOnly`; strip it so a refresh / shared
  // URL doesn't keep re-pinning it (Reset also clears it).
  useEffect(() => {
    if (!omParams.has("lmc")) return;
    const next = new URLSearchParams(omParams);
    next.delete("lmc");
    setOmParams(next, { replace: true });
  }, [omParams]);

  // One pass: apply the committed filter, split flight vs crew legs.
  const { flightOrders, crewOrders } = useMemo(() => {
    const q = applied.search.trim().toLowerCase();
    const match = (o: FlightOrder) => {
      if (applied.from && o.date < applied.from) return false;
      if (applied.to && o.date > applied.to) return false;
      if (applied.airline !== "All" && o.airline !== applied.airline) return false;
      if (applied.scope === "Domestic" && !isDomesticSector(o.sector)) return false;
      if (applied.scope === "International" && isDomesticSector(o.sector)) return false;
      if (applied.status !== "All" && o.status !== applied.status) return false;
      if (q && !(
        o.flight.toLowerCase().includes(q) ||
        o.orderNo.toLowerCase().includes(q) ||
        o.sector.toLowerCase().includes(q) ||
        o.airline.toLowerCase().includes(q)
      )) return false;
      if (lmcOnly && !getOrderAmendments(o.id).some((r) => r.isLmc && r.at.slice(0, 10) === todayStr)) return false;
      return true;
    };
    const fl: FlightOrder[] = [], cr: FlightOrder[] = [];
    for (const o of orders) {
      if (!match(o)) continue;
      if (o.orderType === "crew") cr.push(o); else fl.push(o);
    }
    return { flightOrders: fl, crewOrders: cr };
  }, [orders, applied, lmcOnly, todayStr]);

  // Merged metrics across both tabs (reflect the applied filter). Tab badges
  // count distinct Order #s (not individual flight legs).
  const flightOrderCount = new Set(flightOrders.map((o) => o.orderNo)).size;
  const crewOrderCount = new Set(crewOrders.map((o) => o.orderNo)).size;
  const metricOrders = new Set([...flightOrders, ...crewOrders].map((o) => o.orderNo)).size;
  const metricPaxMeals = flightOrders.reduce((s, o) => s + o.pax, 0);
  const metricCrewMeals = crewOrders.reduce((s, o) => s + (o.crew ?? 0), 0);
  const metricPending =
    flightOrders.filter((o) => o.status === "Pending").length +
    crewOrders.filter((o) => o.status === "Pending").length;

  // After creating an order, jump straight to it in the list. The list is
  // sorted by date (desc) and the seed data runs months into the future, so a
  // freshly created order (dated today) otherwise lands several pages down and
  // looks "missing". Deep-linking via ?ord=<orderNo> makes the list paginate to
  // and scroll the new order into view.
  const revealOrder = (orderNo?: string) => {
    setActiveTab("flights");
    setView("list");
    if (orderNo) navigate(`/order-management?ord=${encodeURIComponent(orderNo)}`);
  };

  const addOrder = (legs: FlightOrder[]) => {
    addFlightOrders(legs);
    revealOrder(legs[0]?.orderNo);
  };

  const addOrdersBulk = (newOrders: FlightOrder[]) => {
    addFlightOrders(newOrders);
    revealOrder(newOrders[0]?.orderNo);
  };

  // Resolve the Order # for a manually-created crew order: reuse the flight
  // order's number for the same date + flights so a flight and its crew order
  // share one Order #. Falls back to a fresh sequential number when there's no
  // unambiguous matching flight order.
  const resolveCrewOrderNo = (date: string, legFlights: string[]): string => {
    const flightSet = new Set(legFlights);
    const flightOf = (o: FlightOrder) => (o.orderType ?? "flight") !== "crew";
    const byFlight = new Set(
      orders.filter((o) => flightOf(o) && o.date === date && flightSet.has(o.flight)).map((o) => o.orderNo),
    );
    if (byFlight.size === 1) return [...byFlight][0];
    const byDate = new Set(
      orders.filter((o) => flightOf(o) && o.date === date).map((o) => o.orderNo),
    );
    if (byDate.size === 1) return [...byDate][0];
    return `ORD-${Math.max(3410, ...orders.map((o) => Number(o.orderNo.split("-").pop()) || 0)) + 1}`;
  };

  const dayAfterComputed = useMemo(() => {
    if (!confirmedOrder) return null;
    const validIntl = confirmedOrder.validIntl;
    const validDom = confirmedOrder.validDom;
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
  }, [confirmedOrder]);

  const headerMeta =
    view === "create"
      ? { title: "Create Flight Order", subtitle: "Pick a date and one or more flights — each flight's details auto-fill and are edited individually. Add them, then save." }
      : view === "crew-create"
        ? { title: "Create Crew Meal Order", subtitle: "Order crew meals by flight and meal slot." }
        : view === "bulk"
          ? { title: "Bulk Upload", subtitle: "Import multiple flight orders from a spreadsheet." }
          : { title: "Order Management", subtitle: "Create, import and track flight orders" };

  return (
    <>
      <PageHeader
        title={headerMeta.title}
        subtitle={headerMeta.subtitle}
        hideIcon
        actions={
          view === "list" ? (
            <>
              {canBulk && (
                <Button variant="outline" className="no-brand" onClick={() => setView("bulk")}>
                  <Upload className="h-4 w-4 mr-1 text-primary" /> Bulk Upload
                </Button>
              )}
              {canCreate && (
                <Button
                  onClick={() => {
                    setView(activeTab === "crew" ? "crew-create" : "create");
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" /> Create Order
                </Button>
              )}
            </>
          ) : (
            <Button variant="outline" onClick={() => setView("list")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )
        }
      />

      {view === "list" && (
        <>
          {/* Banner 1 — Meal order confirmed */}
          {confirmedOrder && (
            <div className="mt-4 rounded-lg border border-success/40 bg-success/5 px-4 py-3 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  Meal Order for Next 24 Hours ({confirmedOrder.tomorrowDayName}) has been generated
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  GM/Admin · {confirmedOrder.timestamp} · {confirmedOrder.totalFlights} flight{confirmedOrder.totalFlights !== 1 ? "s" : ""} · {confirmedOrder.totalMeals.toLocaleString()} meals
                </p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0 text-xs" onClick={() => setShowNextDaySummary(true)}>
                View Details
              </Button>
            </div>
          )}

          {/* Banner 2 — Day-after-tomorrow queued draft */}
          {confirmedOrder && (
            <div
              className="mt-3 rounded-lg border border-amber-300 p-4"
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
                      Meal Order — Day After Tomorrow ({confirmedOrder.dayAfterDayName}, {confirmedOrder.dayAfterDateStr})
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
              <div className="mt-4 text-[11px] text-amber-700 bg-amber-100/60 rounded px-3 py-2">
                Tag &amp; Forward to Production for {confirmedOrder.dayAfterDayName} will become available once the current 24-hour window closes.
              </div>
            </div>
          )}

          {/* Merged metric tiles — flights + crew, reflecting the applied filter. */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MetricTile icon={<FileText className="h-4 w-4" />} label="Orders" value={metricOrders} accent="neutral" />
            <MetricTile icon={<Plane className="h-4 w-4" />} label="Flights" value={flightOrders.length} accent="primary" />
            <MetricTile icon={<Utensils className="h-4 w-4" />} label="Passenger Meals" value={metricPaxMeals} accent="brand" />
            <MetricTile icon={<Users className="h-4 w-4" />} label="Crew Meals" value={metricCrewMeals} accent="neutral" />
            <MetricTile icon={<AlertCircle className="h-4 w-4" />} label="Pending" value={metricPending} accent="amber" />
          </div>

          {/* Shared search & filter bar — drives both tabs, committed on Apply. */}
          <div className="mt-4 rounded-lg border border-border bg-muted/20 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {/* Free-text search */}
              <div className="relative min-w-[220px] flex-1 lg:max-w-sm">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={draft.search}
                  onChange={(e) => patchDraft({ search: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
                  placeholder="Search flight, order #, sector, airline…"
                  className="h-9 pl-8 pr-8 bg-background"
                  aria-label="Search orders"
                />
                {draft.search && (
                  <button
                    type="button"
                    onClick={() => patchDraft({ search: "" })}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <span className="hidden lg:block h-6 w-px bg-border" aria-hidden />

              {/* Merged date-range control */}
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="no-brand h-9 gap-1.5 bg-background px-3 text-sm font-normal">
                    <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="tabular-nums">{rangeLabel}</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    mode="range"
                    numberOfMonths={2}
                    captionLayout="dropdown"
                    showOutsideDays={false}
                    startMonth={new Date(2020, 0)}
                    endMonth={new Date(2035, 11)}
                    defaultMonth={isoToDate(draft.from) ?? new Date()}
                    selected={draft.from || draft.to ? { from: isoToDate(draft.from), to: isoToDate(draft.to) } : undefined}
                    onSelect={(range: DateRange | undefined) => patchDraft({ from: dateToIso(range?.from), to: dateToIso(range?.to) })}
                  />
                  <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => patchDraft({ from: todayStr, to: todayStr })}>Today</Button>
                    <div className="flex items-center gap-1.5">
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => patchDraft({ from: "", to: "" })}>Clear</Button>
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 px-3 text-xs"
                        disabled={!draft.from || !draft.to}
                        onClick={() => { applyFilters(); setDateOpen(false); }}
                      >
                        <Check className="h-3.5 w-3.5" /> Apply
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Scope */}
              <Select value={draft.scope} onValueChange={(v) => patchDraft({ scope: v as "All" | "Domestic" | "International" })}>
                <SelectTrigger className="h-9 w-[140px] gap-1.5 bg-background" aria-label="Filter by sector">
                  <Plane className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Sectors</SelectItem>
                  <SelectItem value="Domestic">Domestic</SelectItem>
                  <SelectItem value="International">International</SelectItem>
                </SelectContent>
              </Select>

              {/* Airline */}
              <Select value={draft.airline} onValueChange={(v) => patchDraft({ airline: v })}>
                <SelectTrigger className="h-9 w-[150px] gap-1.5 bg-background" aria-label="Filter by airline">
                  <Plane className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Airlines</SelectItem>
                  {airlineOptions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>

              {/* Status */}
              <Select value={draft.status} onValueChange={(v) => patchDraft({ status: v as "All" | FlightOrderStatus })}>
                <SelectTrigger className="h-9 w-[140px] gap-1.5 bg-background" aria-label="Filter by status">
                  <CircleDot className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Statuses</SelectItem>
                  {FLIGHT_ORDER_STATUS_FLOW.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>

              {lmcOnly && (
                <Badge
                  className="gap-1 border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-50"
                  role="button"
                  tabIndex={0}
                  onClick={() => setLmcOnly(false)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLmcOnly(false); } }}
                  title="Showing only orders with a last-minute change today — click to clear"
                >
                  <AlertCircle className="h-3 w-3" /> LMC only <X className="h-3 w-3" />
                </Badge>
              )}

              {/* Apply / Reset */}
              <div className="ml-auto flex items-center gap-2 pl-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="no-brand h-9 gap-1.5 px-3 text-xs"
                  onClick={resetFilters}
                  disabled={!filtersActive && !filterDirty}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </Button>
                <Button
                  size="sm"
                  className="h-9 gap-1.5 px-4 text-xs shadow-sm"
                  onClick={applyFilters}
                  disabled={!filterDirty}
                >
                  <Check className="h-3.5 w-3.5" /> Apply
                </Button>
              </div>
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "flights" | "crew")}
            className="space-y-4 mt-4"
          >
            <TabsList className="h-auto bg-transparent p-0 border-b border-border w-full justify-start rounded-none">
              <TabsTrigger
                value="flights"
                className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 pb-3"
              >
                Flight Orders
                <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{flightOrderCount}</span>
              </TabsTrigger>
              <TabsTrigger
                value="crew"
                className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 pb-3"
              >
                Crew Meals
                <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{crewOrderCount}</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="flights" className="mt-0">
              <OrdersList orders={flightOrders} onView={viewLeg} onViewOrder={viewOrder} hasFilters={filtersActive} />
            </TabsContent>

            <TabsContent value="crew" className="mt-0">
              <CrewMealsView orders={crewOrders} hasFilters={filtersActive} />
            </TabsContent>
          </Tabs>

          {/* Day-after-tomorrow summary dialog (lives in parent so it persists after BulkUpload unmounts) */}
          {confirmedOrder && (
            <Dialog open={showNextDaySummary} onOpenChange={setShowNextDaySummary}>
              <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    Meal Order Summary — {confirmedOrder.dayAfterDayName}, {confirmedOrder.dayAfterDateStr}
                    <span className="ml-2 text-xs font-normal text-muted-foreground normal-case tracking-normal">Day After Tomorrow · Draft</span>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-5 py-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-navy mb-2">International Flights</div>
                    <div className="rounded-md border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Flight</th>
                            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Sector</th>
                            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">ETD</th>
                            <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Pax</th>
                            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {confirmedOrder.validIntl.map((r, i) => (
                            <tr key={i} className="hover:bg-muted/20">
                              <td className="px-3 py-2 font-mono text-xs">{r.flight}</td>
                              <td className="px-3 py-2 text-xs">{r.sector}</td>
                              <td className="px-3 py-2 text-xs tabular-nums">{r.etd}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-xs">{r.pax}</td>
                              <td className="px-3 py-2 text-xs">{confirmedOrder.dayAfterMenu?.intl.depMealName}</td>
                            </tr>
                          ))}
                          {confirmedOrder.validIntl.length === 0 && (
                            <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-muted-foreground">No international flights</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded border border-border px-2 py-1.5 bg-muted/20">
                        <span className="text-muted-foreground">Dep Meal: </span><span className="font-medium">{confirmedOrder.dayAfterMenu?.intl.depMealName}</span>
                      </div>
                      <div className="rounded border border-border px-2 py-1.5 bg-muted/20">
                        <span className="text-muted-foreground">CHML: </span><span className="font-medium">{confirmedOrder.dayAfterMenu?.intl.depChmlName}</span>
                      </div>
                      <div className="rounded border border-border px-2 py-1.5 bg-muted/20">
                        <span className="text-muted-foreground">Ret VGML: </span><span className="font-medium">{confirmedOrder.dayAfterMenu?.intl.retVgmlName}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Domestic Flights</div>
                    <div className="rounded-md border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Flight</th>
                            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Airline</th>
                            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Sector</th>
                            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">ETD</th>
                            <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Pax</th>
                            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {confirmedOrder.validDom.map((r, i) => (
                            <tr key={i} className="hover:bg-muted/20">
                              <td className="px-3 py-2 font-mono text-xs">{r.flight}</td>
                              <td className="px-3 py-2 text-xs">{r.airline}</td>
                              <td className="px-3 py-2 text-xs">{r.sector}</td>
                              <td className="px-3 py-2 text-xs tabular-nums">{r.etd}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-xs">{r.pax}</td>
                              <td className="px-3 py-2 text-xs">
                                {r.etd <= "10:30" ? confirmedOrder.dayAfterMenu?.dom.usbaBreakfastName : confirmedOrder.dayAfterMenu?.dom.usbaLunchName}
                              </td>
                            </tr>
                          ))}
                          {confirmedOrder.validDom.length === 0 && (
                            <tr><td colSpan={6} className="px-3 py-4 text-center text-xs text-muted-foreground">No domestic flights</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded border border-border px-2 py-1.5 bg-muted/20">
                        <span className="text-muted-foreground">Breakfast: </span><span className="font-medium">{confirmedOrder.dayAfterMenu?.dom.usbaBreakfastName}</span>
                      </div>
                      <div className="rounded border border-border px-2 py-1.5 bg-muted/20">
                        <span className="text-muted-foreground">Lunch: </span><span className="font-medium">{confirmedOrder.dayAfterMenu?.dom.usbaLunchName}</span>
                      </div>
                      <div className="rounded border border-border px-2 py-1.5 bg-muted/20">
                        <span className="text-muted-foreground">Crew Snack: </span><span className="font-medium">{confirmedOrder.dayAfterMenu?.dom.crewSnackName}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowNextDaySummary(false)}>
                    <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </>
      )}
      {view === "create" && (
        <OrderCreate
          onSave={addOrder}
          nextOrderNo={`ORD-${(Math.max(
            3410,
            ...orders.map((o) => Number(o.orderNo.split("-").pop()) || 0),
          )) + 1}`}
          nextRowSeq={orders.length + 1}
        />
      )}
      {view === "crew-create" && (
        <CrewMealCreate
          onSave={addOrder}
          resolveOrderNo={resolveCrewOrderNo}
          nextRowSeq={orders.length + 1}
        />
      )}
      {view === "bulk" && (
        <BulkUpload
          onPersistOrders={addOrdersBulk}
          orderNoSeed={Math.max(3410, ...orders.map((o) => Number(o.orderNo.split("-").pop()) || 0))}
          existingOrders={orders}
          onUpdateCrew={(legId, crew) => updateFlightOrder(legId, { crew })}
          onAttachRoster={(legId, roster) => updateFlightOrder(legId, { specialMealRoster: roster })}
          onOrderConfirmed={(data) => setConfirmedOrder(data)}
        />
      )}

      <FlightOrderDetailsDialog
        order={detailView?.order ?? null}
        legs={detailView?.legs ?? []}
        allOrders={orders}
        onClose={() => setDetailView(null)}
      />
    </>
  );
}

function CrewMealsView({ orders, hasFilters }: { orders: FlightOrder[]; hasFilters: boolean }) {
  // Crew leg being edited — only Pending legs can open this.
  const [editLeg, setEditLeg] = useState<FlightOrder | null>(null);
  // Crew leg whose change history (LMC) is open — available regardless of status.
  const [historyLeg, setHistoryLeg] = useState<FlightOrder | null>(null);
  // Crew leg whose special-meal count was clicked — drives the roster dialog.
  const [mealDetailLeg, setMealDetailLeg] = useState<FlightOrder | null>(null);
  const slots = useMealSlots();

  // Already filtered by the shared page-level filter; sort/paginate here only.
  const filtered = orders;
  const grandCrew = filtered.reduce((s, o) => s + (o.crew ?? 0), 0);

  // Pagination — paginate the flat flight-row list, then re-group the current
  // page by meal slot for display.
  const pageSize = 12;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { setPage(1); }, [orders]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const pageStart = (page - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, filtered.length);
  const pageRows = filtered.slice(pageStart, pageEnd);

  // Group the current page by meal slot (using the user's slot configuration).
  const groups = new Map<MealSlot, FlightOrder[]>();
  slots.forEach((s) => groups.set(s.name, []));
  pageRows.forEach((o) => {
    const slotName = resolveMealSlot(o.etd, slots).name;
    groups.get(slotName)!.push(o);
  });
  slots.forEach((s) => {
    groups.get(s.name)!.sort((a, b) => a.etd.localeCompare(b.etd));
  });

  return (
    <Card>
      <CardContent className="pt-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">Crew Meals</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cabin-crew meal orders grouped by meal slot — derived from each flight's ETD.
            </p>
          </div>
          <div className="flex items-center gap-5 text-sm">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Flights</div>
              <div className="font-semibold tabular-nums">{filtered.length}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Crew Meals</div>
              <div className="font-semibold tabular-nums text-primary">{grandCrew}</div>
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {hasFilters ? "No crew meal orders match the selected filters." : "No crew meal orders."}
          </div>
        ) : (
          <>
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wider w-44">Flight No</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Airline</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-20">ETD</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right w-28">No of Crew</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-20">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slots.map((slot) => {
                    const slotRows = groups.get(slot.name)!;
                    if (slotRows.length === 0) return null;
                    const slotCrew = slotRows.reduce((s, o) => s + o.crew, 0);

                    // Group rows in this slot by Order #
                    const slotOrderGroups = new Map<string, FlightOrder[]>();
                    slotRows.forEach((o) => {
                      const list = slotOrderGroups.get(o.orderNo);
                      if (list) list.push(o);
                      else slotOrderGroups.set(o.orderNo, [o]);
                    });

                    return (
                      <Fragment key={slot.name}>
                        <TableRow className="bg-primary/5 border-t-2 border-t-primary/40 hover:bg-primary/10">
                          <TableCell colSpan={6} className="py-2">
                            <span className="font-semibold text-primary uppercase tracking-wider text-xs">
                              {slot.name}
                            </span>
                            <span className="ml-2 text-[10px] text-muted-foreground tabular-nums">
                              {formatSlotRange(slot)}
                            </span>
                          </TableCell>
                        </TableRow>
                        {Array.from(slotOrderGroups.entries()).map(([orderNo, legs]) => (
                          <Fragment key={`${slot.name}-${orderNo}`}>
                            <TableRow className="bg-muted/40 hover:bg-muted/50">
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
                            {legs.map((o) => (
                              <TableRow key={o.id} data-arrival-row-id={o.id} className="hover:bg-muted/30">
                                <TableCell className="font-mono text-xs pl-8 whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="whitespace-nowrap">{o.flight}</span>
                                    <DirectionBadge direction={o.direction} />
                                    <LmcBadge orderId={o.id} />
                                  </span>
                                </TableCell>
                                <TableCell>{o.sector}</TableCell>
                                <TableCell>{o.airline}</TableCell>
                                <TableCell className="tabular-nums">{o.etd}</TableCell>
                                <TableCell className="text-right tabular-nums font-semibold">{o.crew}</TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1.5">
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-7 w-7"
                                      onClick={() => setEditLeg(o)}
                                      disabled={isAmendLocked(o)}
                                      aria-label={`${o.status === "Pending" ? "Edit" : "Amend"} ${o.flight}`}
                                      title={amendLockTitle(o)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-7 w-7"
                                      onClick={() => setHistoryLeg(o)}
                                      aria-label={`Change history for ${o.flight}`}
                                      title="Change history"
                                    >
                                      <History className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </Fragment>
                        ))}
                        <TableRow className="bg-muted/30 font-semibold">
                          <TableCell colSpan={4} className="text-right uppercase text-[10px] tracking-wider">
                            {slot.name} Total
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-primary">{slotCrew}</TableCell>
                          <TableCell />
                        </TableRow>
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {filtered.length > pageSize && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  Showing flights{" "}
                  <strong className="text-foreground tabular-nums">{pageStart + 1}</strong>–
                  <strong className="text-foreground tabular-nums">{pageEnd}</strong>{" "}
                  of <strong className="text-foreground tabular-nums">{filtered.length}</strong>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    aria-label="First page"
                    title="First page"
                  >
                    «
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    aria-label="Previous page"
                    title="Previous page"
                  >
                    ‹
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums min-w-[80px] text-center">
                    Page {page} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    aria-label="Next page"
                    title="Next page"
                  >
                    ›
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2"
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    aria-label="Last page"
                    title="Last page"
                  >
                    »
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        <EditOrderLegDialog leg={editLeg} onClose={() => setEditLeg(null)} />
        <OrderHistoryDialog leg={historyLeg} onClose={() => setHistoryLeg(null)} />

        {/* Focused special-meal handler — count + per-code breakdown + roster for one flight. */}
        <Dialog open={!!mealDetailLeg} onOpenChange={(open) => !open && setMealDetailLeg(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                Special Meals
                {mealDetailLeg && (
                  <>
                    <span className="font-mono text-sm text-muted-foreground">— {mealDetailLeg.flight}</span>
                    <DirectionBadge direction={mealDetailLeg.direction} />
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                      {mealDetailLeg.specialMeals} ordered
                    </Badge>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums bg-emerald-50 text-emerald-700 border-emerald-300">
                      {mealDetailLeg.specialMealRoster?.length ?? 0} attached
                    </Badge>
                  </>
                )}
              </DialogTitle>
            </DialogHeader>
            {mealDetailLeg && (
              <div className="mt-2 space-y-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <DetailRow label="Order" value={mealDetailLeg.orderNo} mono />
                  <DetailRow label="Sector" value={mealDetailLeg.sector} />
                  <DetailRow label="Date" value={mealDetailLeg.date} />
                  <DetailRow label="ETD" value={mealDetailLeg.etd} />
                  <DetailRow label="Special Meals (from order)" value={String(mealDetailLeg.specialMeals)} />
                  <DetailRow label="Attached (manifest)" value={String(mealDetailLeg.specialMealRoster?.length ?? 0)} />
                </div>
                <SpecialMealRosterPanel legs={[mealDetailLeg]} level="crew" />
              </div>
            )}
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setMealDetailLeg(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>

    </Card>
  );
}

function WorkflowStrip({
  statuses, counts,
}: {
  statuses: FlightOrderStatus[];
  counts: Record<FlightOrderStatus, number>;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
        Status Workflow
      </div>
      <div className="flex items-center gap-1 overflow-x-auto">
        {statuses.map((s, i) => {
          const count = counts[s] ?? 0;
          const active = count > 0;
          return (
            <div key={s} className="flex items-center gap-1 flex-shrink-0">
              <div
                className={
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs border " +
                  (active
                    ? "bg-primary/5 border-primary/30 text-foreground font-medium"
                    : "bg-muted/40 border-border text-muted-foreground")
                }
              >
                <span
                  className={
                    "inline-flex items-center justify-center h-4 w-4 rounded-full text-[9px] font-semibold " +
                    (active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
                  }
                >
                  {i + 1}
                </span>
                {s}
                {count > 0 && (
                  <span className="text-[10px] tabular-nums text-muted-foreground ml-0.5">
                    ({count})
                  </span>
                )}
              </div>
              {i < statuses.length - 1 && (
                <span className="text-muted-foreground text-xs">→</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: FlightDirection }) {
  const isReturn = direction === "Return";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border " +
        (isReturn
          ? "text-[#2b5f8a] bg-[#eef4f9] border-[#cfe0ec]"
          : "text-[#0f7a40] bg-[#ecf5ef] border-[#cbe6d5]")
      }
      title={isReturn ? "Return flight" : "Outbound flight"}
    >
      <span aria-hidden>{isReturn ? "↺" : "↗"}</span>
      <span>{direction}</span>
    </span>
  );
}

// Headline metric tile — icon chip + label + big number. Accent tints the chip
// only, so the tiles read as one calm row rather than a rainbow.
function MetricTile({
  icon, label, value, accent = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  accent?: "neutral" | "primary" | "brand" | "amber";
}) {
  const accentCls =
    accent === "primary" ? "bg-primary/10 text-primary" :
    accent === "brand"   ? "bg-[#E10101]/10 text-[#E10101]" :
    accent === "amber"   ? "bg-amber-100 text-amber-700" :
    "bg-muted text-muted-foreground";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-colors hover:border-border/80">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", accentCls)}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-xl font-bold leading-tight tabular-nums text-foreground">{value}</div>
      </div>
    </div>
  );
}

function OrdersList({
  orders, onView, onViewOrder, hasFilters,
}: {
  orders: FlightOrder[];
  onView: (o: FlightOrder) => void;
  onViewOrder: (legs: FlightOrder[]) => void;
  hasFilters: boolean;
}) {
  const { role } = useRole();
  const access = useAccess();
  // The Special Meals column is a permissioned element (view).
  const showSpecMeals = canElement(role, "/order-management", "col:spec-meals", "view", access);
  const colCount = showSpecMeals ? 8 : 7;
  // Flight whose special-meal count was clicked — drives the focused roster dialog.
  const [mealDetailLeg, setMealDetailLeg] = useState<FlightOrder | null>(null);
  // Leg being edited — only Pending legs can open this (button disabled otherwise).
  const [editLeg, setEditLeg] = useState<FlightOrder | null>(null);
  // Leg whose change history (LMC) is open — available regardless of status.
  const [historyLeg, setHistoryLeg] = useState<FlightOrder | null>(null);

  // Orders arrive pre-filtered by the shared page-level filter; sort here —
  // freshly created/imported orders first, then by flight date / ETD desc.
  const sortedOrders = useMemo(
    () =>
      [...orders].sort((a, b) =>
        (b.createdAt ?? 0) - (a.createdAt ?? 0)
        || b.date.localeCompare(a.date)
        || b.etd.localeCompare(a.etd)),
    [orders],
  );

  // Group rows by Order # — memoised so we don't redo this work each render
  // (with 3k+ rows the grouping cost was visible during page switches).
  const groupedOrders = useMemo(() => {
    const map = new Map<string, FlightOrder[]>();
    for (const o of sortedOrders) {
      const list = map.get(o.orderNo);
      if (list) list.push(o);
      else map.set(o.orderNo, [o]);
    }
    return Array.from(map.entries());
  }, [sortedOrders]);

  // Pagination — paginate by order group, not by flight row, so an order's
  // legs stay together on one page. Capped at 3 orders per page on user
  // request (each order can fan out to 30-40 legs, so 3 already produces a
  // ~100-row table).
  const [page, setPage] = useState(1);
  const pageSize = 3;
  const totalPages = Math.max(1, Math.ceil(groupedOrders.length / pageSize));

  // Large orders (30–40 legs) are capped to keep the table scannable; the rest
  // expand in place per order. `LEG_CAP` is the collapsed leg count.
  const LEG_CAP = 8;
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const toggleExpand = (orderNo: string) =>
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      next.has(orderNo) ? next.delete(orderNo) : next.add(orderNo);
      return next;
    });

  // Whenever the (filtered) order set changes, jump back to page 1.
  useEffect(() => { setPage(1); }, [orders]);
  // Defensive: if `page` is now past the last page (e.g. after a filter
  // narrowed the list), clamp it.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  // Deep-link: when arriving with ?ord=ORD-XXXX (e.g. from the dashboard's
  // Active Orders panel or the "Delayed Flights" KPI), find that order in the
  // grouped list, jump to its page so the row exists in the DOM, scroll it into
  // view, then strip the param so a manual refresh doesn't keep re-triggering.
  const [searchParams, setSearchParams] = useSearchParams();
  const ordParam = searchParams.get("ord");
  // Row id to scroll to after a deep-link page jump. Set here, consumed by the
  // scroll effect below — kept separate so stripping ?ord doesn't tear down the
  // pending scroll before the target page has rendered.
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  // All leg ids of the deep-linked order — flashed amber so the order the user
  // was just sent back to is clearly highlighted.
  const [pendingFlashIds, setPendingFlashIds] = useState<string[]>([]);
  useEffect(() => {
    if (!ordParam) return;
    const idx = groupedOrders.findIndex(([no]) => no === ordParam);
    if (idx < 0) return;
    const targetPage = Math.floor(idx / pageSize) + 1;
    if (targetPage !== page) setPage(targetPage);
    const legs = groupedOrders[idx]?.[1] ?? [];
    setPendingScrollId(legs[0]?.id ?? null);
    setPendingFlashIds(legs.map((l) => l.id));
    const next = new URLSearchParams(searchParams);
    next.delete("ord");
    setSearchParams(next, { replace: true });
  }, [ordParam, groupedOrders, page, searchParams, setSearchParams]);

  // Flash every leg row of the deep-linked order with the amber arrival tint.
  // Retries because the target page renders asynchronously after the jump.
  useEffect(() => {
    if (pendingFlashIds.length === 0) return;
    let done = false;
    const apply = () => {
      let any = false;
      for (const id of pendingFlashIds) {
        const el = document.querySelector<HTMLElement>(`[data-arrival-row-id="${CSS.escape(id)}"]`);
        if (!el) continue;
        el.classList.remove("arrival-row-flash");
        void el.offsetWidth;
        el.classList.add("arrival-row-flash");
        any = true;
      }
      return any;
    };
    const timers = [0, 150, 350, 700, 1100].map((d) =>
      setTimeout(() => { if (!done && apply()) done = true; }, d),
    );
    const clear = setTimeout(() => setPendingFlashIds([]), 5000);
    return () => { timers.forEach((t) => clearTimeout(t)); clearTimeout(clear); };
  }, [pendingFlashIds, page]);

  // Scroll the deep-linked order's first row into view once it renders on the
  // freshly selected page. Retries because the page switch re-renders the table
  // asynchronously; re-runs when `page` settles on the target.
  useEffect(() => {
    if (!pendingScrollId) return;
    const sel = `[data-arrival-row-id="${CSS.escape(pendingScrollId)}"]`;
    let done = false;
    const timers = [0, 120, 300, 600, 1000].map((delay) =>
      setTimeout(() => {
        if (done) return;
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          done = true;
          setPendingScrollId(null);
        }
      }, delay),
    );
    return () => timers.forEach((t) => clearTimeout(t));
  }, [pendingScrollId, page]);

  const pageStart = (page - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, groupedOrders.length);
  const pageGroups = groupedOrders.slice(pageStart, pageEnd);

  // Collapsible order sections. Each order group is a collapsible panel; the
  // first order on the current page is open by default, the rest collapsed.
  // Changing page or filters re-seeds so the top order is always visible.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const pageGroupKey = pageGroups.map(([no]) => no).join("|");
  // Seed before paint (no collapsed-then-open flash on load / page change).
  useLayoutEffect(() => {
    const first = pageGroups[0]?.[0];
    setOpenSections(first ? new Set([first]) : new Set());
    // Re-seed only when the set of visible orders changes (page / filter shift).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageGroupKey]);
  const toggleSection = (orderNo: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(orderNo) ? next.delete(orderNo) : next.add(orderNo);
      return next;
    });
  const expandAllSections = () => setOpenSections(new Set(pageGroups.map(([no]) => no)));
  const collapseAllSections = () => setOpenSections(new Set());

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            <strong className="text-foreground tabular-nums">{groupedOrders.length}</strong> order{groupedOrders.length === 1 ? "" : "s"} ·{" "}
            <strong className="text-foreground tabular-nums">{sortedOrders.length}</strong> flight{sortedOrders.length === 1 ? "" : "s"}
            {groupedOrders.length > 0 && (
              <> · Page <strong className="text-foreground tabular-nums">{page}</strong> of <strong className="text-foreground tabular-nums">{totalPages}</strong></>
            )}
          </div>
          {pageGroups.length > 1 && (
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={expandAllSections}
                className="font-medium text-muted-foreground hover:text-primary"
              >
                Expand all
              </button>
              <span className="text-border">·</span>
              <button
                type="button"
                onClick={collapseAllSections}
                className="font-medium text-muted-foreground hover:text-primary"
              >
                Collapse all
              </button>
            </div>
          )}
        </div>

        {groupedOrders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
            {hasFilters ? "No flight orders match the selected filters." : "No flight orders yet."}
          </div>
        ) : (
          <div data-arrival-id="active-orders" className="space-y-3">
            {pageGroups.map(([orderNo, legs]) => {
              // A collapsed card shows only its header band; a deep-linked order
              // is force-opened so its row exists in the DOM to scroll to.
              const isDeepLinkTarget = pendingScrollId != null && legs.some((l) => l.id === pendingScrollId);
              const open = openSections.has(orderNo) || isDeepLinkTarget;

              // Header summary — keeps the band informative while collapsed.
              const groupPax = legs.reduce((s, l) => s + l.pax, 0);
              const groupSpec = legs.reduce((s, l) => s + l.specialMeals, 0);
              const dates = legs.map((l) => l.date);
              const minDate = dates.reduce((a, b) => (a < b ? a : b), dates[0]);
              const maxDate = dates.reduce((a, b) => (a > b ? a : b), dates[0]);
              const groupDateLabel = minDate === maxDate ? minDate : `${minDate} → ${maxDate}`;

              // Cap legs per order; "show all" expands in place.
              const isExpanded = expandedOrders.has(orderNo) || isDeepLinkTarget;
              const shownLegs = isExpanded ? legs : legs.slice(0, LEG_CAP);

              return (
                <div
                  key={orderNo}
                  className={cn(
                    "overflow-hidden rounded-xl border bg-card transition-shadow",
                    open ? "border-border shadow-sm" : "border-border/70 hover:border-border hover:shadow-sm",
                  )}
                >
                  {/* Header band — collapse toggle + order-level actions. */}
                  <div className="flex items-stretch gap-2 py-2.5 pl-4 pr-3" style={{ background: "#f6f2ef" }}>
                    <button
                      type="button"
                      onClick={() => toggleSection(orderNo)}
                      aria-expanded={open}
                      className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[11px] gap-y-1.5 text-left"
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-[#6b6b72] transition-transform duration-200",
                          !open && "-rotate-90",
                        )}
                      />
                      <span className="text-sm font-bold tracking-[0.01em] text-[#E10101]">{orderNo}</span>
                      {legs.length > 1 && (
                        <span className="rounded-md border border-[#e9e4e1] bg-white px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.05em] text-[#6b6b72]">
                          {legs.length} flights
                        </span>
                      )}
                      <OrderStatusBadges legs={legs} />
                      <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 pr-1 text-[11px] text-[#6b6b72]">
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <CalendarRange className="h-3.5 w-3.5 opacity-70" />
                          {groupDateLabel}
                        </span>
                        <span className="tabular-nums">
                          <strong className="font-bold text-[#2a2528]">{groupPax}</strong> pax
                        </span>
                        {showSpecMeals && groupSpec > 0 && (
                          <span className="tabular-nums">
                            <strong className="font-bold text-[#2a2528]">{groupSpec}</strong> spec
                          </span>
                        )}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5 self-center border-l border-[#e4ddd8] pl-2.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => onViewOrder(legs)}
                        title="View full order"
                        aria-label={`View order ${orderNo}`}
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </Button>
                    </div>
                  </div>

                  {/* Collapsible body — this order's flights. */}
                  {open && (
                    <div className="border-t border-border">
                      <Table>
                        <TableHeader className="bg-muted/40">
                          <TableRow>
                            <TableHead className="h-9 text-[10px] uppercase tracking-wider">Flight</TableHead>
                            <TableHead className="h-9 text-[10px] uppercase tracking-wider">Airline</TableHead>
                            <TableHead className="h-9 text-[10px] uppercase tracking-wider">Sector</TableHead>
                            <TableHead className="h-9 text-[10px] uppercase tracking-wider">Date</TableHead>
                            <TableHead className="h-9 text-[10px] uppercase tracking-wider">ETD</TableHead>
                            <TableHead className="h-9 text-[10px] uppercase tracking-wider text-right">PAX</TableHead>
                            {showSpecMeals && <TableHead className="h-9 text-[10px] uppercase tracking-wider text-right">Spec. Meals</TableHead>}
                            <TableHead className="h-9 text-[10px] uppercase tracking-wider text-right">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {shownLegs.map((o) => {
                            const isReturn = o.direction === "Return";
                            return (
                              <TableRow key={o.id} data-arrival-row-id={o.id} className="hover:bg-muted/30">
                                <TableCell className="font-medium pl-4">
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center rounded-[7px] bg-[#2a2528] px-[9px] py-1 text-xs font-bold tabular-nums text-white">
                                      {o.flight}
                                    </span>
                                    <DirectionBadge direction={o.direction} />
                                    <LmcBadge orderId={o.id} />
                                  </div>
                                </TableCell>
                                <TableCell>{o.airline}</TableCell>
                                <TableCell>
                                  <span className={isReturn ? "text-muted-foreground" : undefined}>{o.sector}</span>
                                </TableCell>
                                <TableCell className="tabular-nums text-xs">{o.date}</TableCell>
                                <TableCell>{o.etd}</TableCell>
                                <TableCell className="text-right tabular-nums">{o.pax}</TableCell>
                                {showSpecMeals && (
                                  <TableCell className="text-right tabular-nums">
                                    {o.specialMeals > 0 ? (
                                      <button
                                        type="button"
                                        onClick={() => setMealDetailLeg(o)}
                                        className="font-medium text-sky-700 underline decoration-dotted underline-offset-2 hover:text-sky-800 tabular-nums"
                                        title="View special meal count & roster"
                                      >
                                        {o.specialMeals}
                                      </button>
                                    ) : (
                                      <span className="text-muted-foreground/60">0</span>
                                    )}
                                  </TableCell>
                                )}
                                <TableCell>
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => onView(o)} aria-label={`View ${o.flight}`} title="View flight">
                                      <Eye className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setEditLeg(o)} disabled={isAmendLocked(o)} aria-label={`${o.status === "Pending" ? "Edit" : "Amend"} ${o.flight}`} title={amendLockTitle(o)}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setHistoryLeg(o)} aria-label={`Change history for ${o.flight}`} title="Change history">
                                      <History className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {legs.length > LEG_CAP && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={colCount} className="py-2 pl-4">
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(orderNo)}
                                  className="text-xs font-semibold text-primary hover:underline"
                                >
                                  {isExpanded
                                    ? "Show less"
                                    : `+ ${legs.length - LEG_CAP} more flight${legs.length - LEG_CAP === 1 ? "" : "s"} — show all ${legs.length}`}
                                </button>
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {groupedOrders.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              Showing orders{" "}
              <strong className="text-foreground tabular-nums">{pageStart + 1}</strong>–
              <strong className="text-foreground tabular-nums">{pageEnd}</strong>{" "}
              of <strong className="text-foreground tabular-nums">{groupedOrders.length}</strong>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => setPage(1)}
                disabled={page === 1}
                aria-label="First page"
                title="First page"
              >
                «
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Previous page"
                title="Previous page"
              >
                ‹
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums min-w-[80px] text-center">
                Page {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label="Next page"
                title="Next page"
              >
                ›
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                aria-label="Last page"
                title="Last page"
              >
                »
              </Button>
            </div>
          </div>
        )}

        {/* Focused special-meal handler — count + per-code breakdown + roster for one flight. */}
        <Dialog open={!!mealDetailLeg} onOpenChange={(open) => !open && setMealDetailLeg(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                Special Meals
                {mealDetailLeg && (
                  <>
                    <span className="font-mono text-sm text-muted-foreground">— {mealDetailLeg.flight}</span>
                    <DirectionBadge direction={mealDetailLeg.direction} />
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                      {mealDetailLeg.specialMeals} ordered
                    </Badge>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums bg-emerald-50 text-emerald-700 border-emerald-300">
                      {mealDetailLeg.specialMealRoster?.length ?? 0} attached
                    </Badge>
                  </>
                )}
              </DialogTitle>
            </DialogHeader>
            {mealDetailLeg && (
              <div className="mt-2 space-y-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <DetailRow label="Order" value={mealDetailLeg.orderNo} mono />
                  <DetailRow label="Sector" value={mealDetailLeg.sector} />
                  <DetailRow label="Date" value={mealDetailLeg.date} />
                  <DetailRow label="ETD" value={mealDetailLeg.etd} />
                  <DetailRow label="Special Meals (from order)" value={String(mealDetailLeg.specialMeals)} />
                  <DetailRow label="Attached (manifest)" value={String(mealDetailLeg.specialMealRoster?.length ?? 0)} />
                </div>
                <SpecialMealRosterPanel legs={[mealDetailLeg]} />
              </div>
            )}
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setMealDetailLeg(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <EditOrderLegDialog leg={editLeg} onClose={() => setEditLeg(null)} />
        <OrderHistoryDialog leg={historyLeg} onClose={() => setHistoryLeg(null)} />
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit a single flight/crew order leg in place. Only reachable while the leg is
// Pending (the row's Edit button is disabled otherwise). Persists via the
// flight-orders store. Crew legs edit "No of Crew"; flight legs edit PAX +
// Special Meals.
// ─────────────────────────────────────────────────────────────────────────────
function EditOrderLegDialog({
  leg, onClose,
}: {
  leg: FlightOrder | null;
  onClose: () => void;
}) {
  const isCrew = leg?.orderType === "crew";
  // Pending = a normal correction (everything editable). Any other (non-terminal)
  // status = a last-minute amendment: lock the identity fields and only allow the
  // operational ones (date, ETD, PAX, crew, special meals) to change.
  const isPending = (leg?.status ?? "Pending") === "Pending";
  const lockIdentity = !isPending;
  const [draft, setDraft] = useState<FlightOrder | null>(leg);
  const [reason, setReason] = useState("");
  // Reset the working copy + reason whenever a new leg is opened.
  useEffect(() => { setDraft(leg); setReason(""); }, [leg]);

  if (!leg || !draft) return null;

  const set = <K extends keyof FlightOrder>(key: K, value: FlightOrder[K]) =>
    setDraft((p) => (p ? { ...p, [key]: value } : p));

  const lead = leadHoursToDeparture(leg);
  const inLmcWindow = isLmcLead(lead);

  const save = () => {
    // Departure-based lock: once the flight has left, the order is "Flown" and
    // its as-flown figures are frozen. The amend button is already disabled for
    // these, but guard the save too in case the dialog was opened via stale state.
    if (hasDeparted(leg)) {
      toast.error("Flight has already departed — this order is locked from editing.");
      return;
    }
    if (!draft.flight.trim()) { toast.error("Flight number is required."); return; }
    if (!draft.sector.trim()) { toast.error("Sector is required."); return; }
    // A Last-Minute Change must carry a reason — that's the ops audit trail.
    if (inLmcWindow && !reason.trim()) {
      toast.error("This is a last-minute change — a reason is required.");
      return;
    }
    const user = getAuthUser();
    // amendOrder records the edit as a versioned revision (field diff + who/when/
    // why) before applying it, so the change is auditable rather than overwritten.
    const rev = amendOrder(
      leg.id,
      {
        flight: draft.flight.trim(),
        airline: draft.airline.trim(),
        sector: draft.sector.trim(),
        date: draft.date,
        etd: draft.etd,
        direction: draft.direction,
        pax: isCrew ? 0 : Math.max(0, draft.pax),
        crew: isCrew ? Math.max(0, draft.crew) : draft.crew,
        specialMeals: Math.max(0, draft.specialMeals),
        // Editing a returned order is the "correction" — clear the review so it
        // re-enters the approval queue as a clean Pending request.
        ...(leg.reviewComment ? { reviewComment: undefined, reviewedBy: undefined, reviewedAt: undefined } : {}),
      },
      { by: user?.name ?? "System", role: user?.role ?? "", reason },
    );
    toast.success(
      leg.reviewComment
        ? `${draft.flight} corrected and resubmitted.`
        : rev
          ? `${draft.flight} updated — ${rev.changes.length} change${rev.changes.length === 1 ? "" : "s"} logged.`
          : `${draft.flight} — no changes.`,
    );
    onClose();
  };

  return (
    <Dialog open={!!leg} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {isPending ? "Edit" : "Amend"} {isCrew ? "Crew Order" : "Flight Order"}
            <span className="font-mono text-sm text-muted-foreground">— {leg.flight}</span>
            <DirectionBadge direction={leg.direction} />
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase tracking-wider">
              {leg.orderNo}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        {leg.reviewComment && leg.status === "Pending" && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-amber-700 font-medium mb-1 flex items-center gap-1">
              <MessageSquare className="h-3 w-3" /> Reviewer's Comment — correct &amp; resubmit
            </div>
            <p className="text-sm text-amber-900">{leg.reviewComment}</p>
            {(leg.reviewedBy || leg.reviewedAt) && (
              <div className="mt-1 text-[11px] text-amber-700">
                — {leg.reviewedBy}{leg.reviewedAt ? ` · ${leg.reviewedAt}` : ""}
              </div>
            )}
          </div>
        )}
        {inLmcWindow && (
          <div className="mt-2 rounded-md border border-rose-300 bg-rose-50/70 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-rose-700 font-medium mb-0.5 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> Last-Minute Change
            </div>
            <p className="text-xs text-rose-900">
              {lead != null && lead >= 0
                ? `Departure in ${lead < 1 ? `${Math.round(lead * 60)} min` : `${lead.toFixed(1)} h`} — within the ${getLmcWindowHours()}h cut-off.`
                : "Flight has already departed."}{" "}
              A reason is required and the change is flagged for the team.
            </p>
          </div>
        )}
        {!isPending && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Amending an <span className="font-medium text-foreground">{leg.status}</span> order — flight, airline, sector &amp; direction are locked; the change is recorded in the order's history.
          </p>
        )}
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Flight No</Label>
            <Input value={draft.flight} onChange={(e) => set("flight", e.target.value)} disabled={lockIdentity} className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Airline</Label>
            <Input value={draft.airline} onChange={(e) => set("airline", e.target.value)} disabled={lockIdentity} className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Sector</Label>
            <Input value={draft.sector} onChange={(e) => set("sector", e.target.value)} disabled={lockIdentity} className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Direction</Label>
            <select
              value={draft.direction}
              onChange={(e) => set("direction", e.target.value as FlightDirection)}
              disabled={lockIdentity}
              className={selectCls}
            >
              <option value="Outbound">Outbound</option>
              <option value="Return">Return</option>
            </select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Date</Label>
            <Input type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">ETD</Label>
            <Input value={draft.etd} onChange={(e) => set("etd", e.target.value)} placeholder="HH:MM" className="mt-1 h-9" />
          </div>
          {isCrew ? (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">No of Crew</Label>
                <Input type="number" min={0} value={draft.crew} onChange={(e) => set("crew", Number(e.target.value))} className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Special Meals</Label>
                <Input type="number" min={0} value={draft.specialMeals} onChange={(e) => set("specialMeals", Number(e.target.value))} className="mt-1 h-9" />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">PAX</Label>
                <Input type="number" min={0} value={draft.pax} onChange={(e) => set("pax", Number(e.target.value))} className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">No of Crew</Label>
                <Input type="number" min={0} value={draft.crew} onChange={(e) => set("crew", Number(e.target.value))} className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Special Meals</Label>
                <Input type="number" min={0} value={draft.specialMeals} onChange={(e) => set("specialMeals", Number(e.target.value))} className="mt-1 h-9" />
              </div>
            </>
          )}
        </div>
        <div className="mt-3">
          <Label className="text-xs text-muted-foreground">
            Reason for change{" "}
            {inLmcWindow
              ? <span className="text-rose-600 font-medium">(required — last-minute)</span>
              : <span className="text-muted-foreground/60">(optional)</span>}
          </Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. ATC delay, pax re-book, equipment swap"
            className={`mt-1 h-9 ${inLmcWindow && !reason.trim() ? "border-rose-300" : ""}`}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Saved to this order's change history.</p>
        </div>
        <DialogFooter className="mt-5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-only change-history (LMC) timeline for one order leg — every recorded
// amendment with its field diffs, author and reason, newest first.
// ─────────────────────────────────────────────────────────────────────────────
function fmtAmendVal(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v);
}
function fmtAmendTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function OrderHistoryDialog({ leg, onClose }: { leg: FlightOrder | null; onClose: () => void }) {
  if (!leg) return null;
  const revisions: OrderAmendment[] = getOrderAmendments(leg.id);
  return (
    <Dialog open={!!leg} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <History className="h-4 w-4" /> Change History
            <span className="font-mono text-sm text-muted-foreground">— {leg.flight}</span>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase tracking-wider">{leg.orderNo}</Badge>
          </DialogTitle>
        </DialogHeader>
        {revisions.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No changes recorded yet.</div>
        ) : (
          <div className="mt-1 space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {revisions.map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground">{r.by}{r.role ? ` · ${r.role}` : ""}</span>
                    {r.isLmc && (
                      <Badge variant="outline" className={`h-4 px-1.5 text-[9px] font-bold uppercase tracking-wider ${LMC_SEVERITY_BADGE[r.severity] ?? LMC_SEVERITY_BADGE.info}`}>
                        LMC · {r.severity}
                      </Badge>
                    )}
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{fmtAmendTime(r.at)}</span>
                </div>
                {r.reason && <div className="text-[11px] text-muted-foreground mt-0.5">{r.reason}</div>}
                <div className="mt-2 space-y-1">
                  {r.changes.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="w-28 shrink-0 font-medium text-muted-foreground">{c.label}</span>
                      <span className="line-through text-muted-foreground">{fmtAmendVal(c.from)}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-semibold text-foreground">{fmtAmendVal(c.to)}</span>
                    </div>
                  ))}
                </div>
                {(() => {
                  const guard = canRevertAmendment(leg.id, r.id);
                  return (
                    <div className="mt-2 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!guard.ok}
                        className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                        onClick={() => {
                          const u = getAuthUser();
                          const done = revertAmendment(leg.id, r.id, { by: u?.name, role: u?.role });
                          if (done) toast.success(`Reverted — ${r.changes.map((c) => c.label).join(", ")} restored.`);
                          else toast.error(canRevertAmendment(leg.id, r.id).reason ?? "Could not revert this change.");
                        }}
                        title={guard.ok ? "Undo this change (logged as a new amendment)" : guard.reason}
                      >
                        <CornerUpLeft className="h-3 w-3 mr-1" /> Revert
                      </Button>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LMC_SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-rose-100 text-rose-700 border-rose-200",
  major:    "bg-amber-100 text-amber-700 border-amber-200",
  minor:    "bg-slate-100 text-slate-600 border-slate-200",
  info:     "bg-slate-100 text-slate-600 border-slate-200",
};

/** Departure-based lock: once a flight has departed, its order is "Flown" and
 *  its figures are locked from editing (the as-flown record must stay fixed).
 *  Completed is the existing terminal lock; both block the amend path. */
function isAmendLocked(o: FlightOrder): boolean {
  return o.status === "Completed" || hasDeparted(o);
}
function amendLockTitle(o: FlightOrder): string {
  if (o.status === "Completed") return "Locked — Completed";
  if (hasDeparted(o)) return "Locked — flight departed";
  return o.status === "Pending" ? "Edit" : "Amend — last-minute change";
}

/** Compact "LMC" chip on a leg that has a last-minute amendment (most recent
 *  LMC wins for the severity colour). Renders nothing otherwise. */
function LmcBadge({ orderId }: { orderId: string }) {
  const lmc = getOrderAmendments(orderId).find((r) => r.isLmc);
  if (!lmc) return null;
  return (
    <Badge
      variant="outline"
      className={`h-5 px-1.5 text-[10px] font-bold uppercase tracking-wider ${LMC_SEVERITY_BADGE[lmc.severity] ?? LMC_SEVERITY_BADGE.info}`}
      title={`Last-minute change · ${lmc.severity} · ${lmc.reason}`}
    >
      LMC
    </Badge>
  );
}

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type SearchOption = { value: string; label: string; keywords?: string };

/**
 * A searchable single-select dropdown (Popover + cmdk) styled to match the
 * form's inputs. Drop-in replacement for a native <select>: pass `value`,
 * `onChange`, and `options`. Filtering matches the option value, label, and any
 * extra `keywords` (e.g. city name behind an airport code).
 */
function SearchSelect({
  value, onChange, options, placeholder = "Select…", searchPlaceholder = "Search…",
  emptyText = "No results.", disabled, className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "mt-1 flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-left">{selected ? selected.label : placeholder}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.value} ${o.label} ${o.keywords ?? ""}`}
                  onSelect={() => { onChange(o.value); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Multi-select variant of {@link SearchSelect}: pick any number of options from a
 * searchable list. The popover stays open across picks so several can be toggled
 * in one go; the trigger summarises the current selection. Used for the Flight
 * Number picker so a whole batch of flights can be chosen for one order.
 */
function MultiSearchSelect({
  values, onToggle, options, placeholder = "Select…", searchPlaceholder = "Search…",
  emptyText = "No results.", disabled, className,
}: {
  values: string[];
  onToggle: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedSet = new Set(values);
  const summary = values.length === 0
    ? placeholder
    : values.length === 1
      ? (options.find((o) => o.value === values[0])?.label ?? values[0])
      : `${values.length} flights selected`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "mt-1 flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
            values.length === 0 && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-left">{summary}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const checked = selectedSet.has(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    value={`${o.value} ${o.label} ${o.keywords ?? ""}`}
                    onSelect={() => onToggle(o.value)}
                  >
                    <Check className={cn("mr-2 h-4 w-4 shrink-0", checked ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{o.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Numbered step marker used in the create-form section headers. */
function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shadow-sm">
      {n}
    </span>
  );
}

/**
 * Field label with an inline help tooltip. `hint` explains what the field is
 * for; `auto` renders a small "Auto" chip signalling the value was pre-filled
 * from the selected flight (and can still be edited).
 */
function FieldLabel({
  children, hint, required, auto,
}: {
  children: React.ReactNode;
  hint: string;
  required?: boolean;
  auto?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {children}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {auto && (
        <span className="inline-flex items-center gap-0.5 rounded-sm bg-primary/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-primary">
          <Wand2 className="h-2.5 w-2.5" /> Auto
        </span>
      )}
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Field help"
              className="text-muted-foreground/50 transition-colors hover:text-foreground"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[240px] text-left leading-snug">
            {hint}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

type LegDraft = {
  flight: string;
  airline: string;
  sector: string;
  date: string;
  etd: string;
  pax: number;
  crew: number;
  specialMeals: number;
  status: FlightOrderStatus;
  direction: FlightDirection;
  roster: SpecialMealEntry[];
};

type RosterDraft = Omit<SpecialMealEntry, "id">;

const EMPTY_ROSTER_ROW: RosterDraft = { pnr: "", passengerName: "", seat: "", mealCode: "AVML" };

// A per-row id that stays unique even across a dev HMR reload (which resets the
// counter while React keeps the existing rows). Without the time component a
// reset counter can re-mint an existing id, and then editing one row would
// patch every row sharing that id.
let rosterIdSeq = 0;
const nextRosterId = () => `SM-${Date.now().toString(36)}-${(++rosterIdSeq).toString(36)}`;

// ── One flight's editable detail (the fields auto-filled from the schedule) ──
// Shared by the primary flight and, when the round-trip option is on, the paired
// return flight — each is an independent draft with its own PAX and roster.
type LegDetail = {
  date: string;  // this leg's own departure date (ISO) — a return may differ
  scope: "Domestic" | "International";
  airline: string;
  from: string;
  to: string;
  etd: string;
  pax: string;   // kept as string for the number input
  crew: string;
  direction: FlightDirection;
  roster: SpecialMealEntry[];
};

const emptyLegDetail = (): LegDetail => ({
  date: "", scope: "Domestic", airline: AIRLINES[0], from: "", to: "", etd: "",
  pax: "", crew: "", direction: "Outbound", roster: [],
});

const legDetailFromSchedule = (sf: ScheduledFlight, dateISO: string): LegDetail => ({
  date: dateISO, scope: sf.scope, airline: sf.airline, from: sf.from, to: sf.to,
  etd: sf.etd, pax: "", crew: String(sf.crew), direction: sf.direction, roster: [],
});

const DOMESTIC_CODES = ["DAC", "CGP", "CXB", "ZYL", "JSR"];

/**
 * The editable detail block for a single flight leg: the auto-filled fields grid
 * (Scope / Airline / ETD / sector / Direction / PAX / Crew / Special Meals) plus
 * that leg's Special Meal Roster. Fully controlled via `value` / `onChange` so it
 * can be reused for both the outbound and the return flight. `autoFocusPax`
 * lands the cursor on PAX (the one field that isn't auto-filled).
 */
function FlightLegFields({
  value, onChange, autoFocusPax, showAuto = true,
}: {
  value: LegDetail;
  onChange: (patch: Partial<LegDetail>) => void;
  autoFocusPax?: boolean;
  /** Show the "Auto" chips — true when values came from the schedule (auto mode),
   *  false for manual entry where nothing is pre-filled. */
  showAuto?: boolean;
}) {
  const [bulkPaste, setBulkPaste] = useState("");
  const [showBulk, setShowBulk] = useState(false);

  const airportChoices = value.scope === "Domestic"
    ? AIRPORTS.filter((a) => DOMESTIC_CODES.includes(a.code))
    : AIRPORTS;

  const onScopeChange = (next: "Domestic" | "International") => {
    // Dropping to Domestic can invalidate an international airport pick — clear it.
    if (next === "Domestic") {
      const patch: Partial<LegDetail> = { scope: next };
      if (value.from && !DOMESTIC_CODES.includes(value.from)) patch.from = "";
      if (value.to && !DOMESTIC_CODES.includes(value.to)) patch.to = "";
      onChange(patch);
    } else {
      onChange({ scope: next });
    }
  };

  const addRosterRow = () =>
    onChange({ roster: [...value.roster, { id: nextRosterId(), ...EMPTY_ROSTER_ROW }] });

  const updateRosterRow = (id: string, patch: Partial<RosterDraft>) =>
    onChange({ roster: value.roster.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  const removeRosterRow = (id: string) =>
    onChange({ roster: value.roster.filter((r) => r.id !== id) });

  // Bulk paste: TSV/CSV in column order PNR, Name, Seat, Code, [Audience]
  const applyBulkPaste = () => {
    const lines = bulkPaste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast.error("Paste at least one row.");
      return;
    }
    const validCodes = new Set(SPECIAL_MEAL_CODES.map((m) => m.code));
    const parsed: SpecialMealEntry[] = [];
    let skipped = 0;
    lines.forEach((line) => {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      if (parts.length < 4) { skipped += 1; return; }
      const [pnr, passengerName, seat, mealCode, audienceRaw] = parts;
      const code = mealCode.toUpperCase();
      if (!validCodes.has(code)) { skipped += 1; return; }
      const audience = /crew/i.test(audienceRaw ?? "") ? "Crew" as const : "Passenger" as const;
      parsed.push({ id: nextRosterId(), pnr, passengerName, seat, mealCode: code, audience });
    });
    if (parsed.length === 0) {
      toast.error("No valid rows. Format: PNR, Name, Seat, Code (one per line).");
      return;
    }
    onChange({ roster: [...value.roster, ...parsed] });
    setBulkPaste("");
    setShowBulk(false);
    toast.success(`Imported ${parsed.length} passenger${parsed.length === 1 ? "" : "s"}.${skipped ? ` ${skipped} skipped.` : ""}`);
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
        <div>
          <FieldLabel auto={showAuto} hint="Domestic or international routing — sets the applicable meal specification and dispatch handling. Auto-set from the flight in auto mode; editable.">
            Scope
          </FieldLabel>
          <div className="mt-1 flex w-fit rounded-md border border-input bg-background p-0.5 shadow-sm">
            {(["Domestic", "International"] as const).map((s) => {
              const active = value.scope === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onScopeChange(s)}
                  className={
                    "px-3 py-1.5 text-xs font-medium rounded-sm transition-colors " +
                    (active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel auto={showAuto} hint="Operating carrier for this flight. Auto-set from the schedule in auto mode; editable.">
            Airline
          </FieldLabel>
          <SearchSelect
            value={value.airline}
            onChange={(airline) => onChange({ airline })}
            options={AIRLINES.map((a) => ({ value: a, label: a }))}
            placeholder="Select airline"
            searchPlaceholder="Search airline…"
            emptyText="No airline found."
          />
        </div>

        <div>
          <FieldLabel auto={showAuto} required hint="Estimated Time of Departure (local, 24-hour). Auto-set from the schedule in auto mode; adjust for a known delay or re-time.">
            ETD
          </FieldLabel>
          <Input
            type="time"
            value={value.etd}
            onChange={(e) => onChange({ etd: e.target.value })}
            className="mt-1"
          />
        </div>

        <div>
          <FieldLabel auto={showAuto} required hint="Origin (departure) airport. Auto-set from the flight's sector in auto mode; editable.">
            From
          </FieldLabel>
          <SearchSelect
            value={value.from}
            onChange={(from) => onChange({ from })}
            options={airportChoices.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}`, keywords: a.name }))}
            placeholder="Select origin"
            searchPlaceholder="Search airport or city…"
            emptyText="No airport found."
          />
        </div>

        <div>
          <FieldLabel auto={showAuto} required hint="Destination (arrival) airport. Auto-set from the flight's sector in auto mode; editable.">
            To
          </FieldLabel>
          <SearchSelect
            value={value.to}
            onChange={(to) => onChange({ to })}
            options={airportChoices.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}`, keywords: a.name }))}
            placeholder="Select destination"
            searchPlaceholder="Search airport or city…"
            emptyText="No airport found."
          />
        </div>

        <div>
          <FieldLabel auto={showAuto} hint="Outbound (departing base) or the Return leg of the rotation. Auto-set from the flight in auto mode; editable.">
            Direction
          </FieldLabel>
          <div className="mt-1 flex w-fit rounded-md border border-input bg-background p-0.5 shadow-sm">
            {(["Outbound", "Return"] as FlightDirection[]).map((d) => {
              const active = value.direction === d;
              const isReturn = d === "Return";
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => onChange({ direction: d })}
                  className={
                    "px-3 py-1.5 text-xs font-medium rounded-sm transition-colors " +
                    (active
                      ? isReturn
                        ? "bg-navy/10 text-navy"
                        : "bg-success/10 text-success"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {isReturn ? "↺" : "↗"} {d}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel required hint="Number of passengers booked on this flight — enter this manually. It drives passenger meal production.">
            PAX
          </FieldLabel>
          <Input
            type="number"
            min={0}
            value={value.pax}
            onChange={(e) => onChange({ pax: e.target.value })}
            placeholder="0"
            autoFocus={autoFocusPax}
            className="mt-1"
          />
        </div>

        <div>
          <FieldLabel auto={showAuto} hint="Rostered cockpit + cabin crew — drives crew-meal counts. Auto-set from the flight in auto mode; edit to match the actual crew roster.">
            No of Crew
          </FieldLabel>
          <Input
            type="number"
            min={0}
            value={value.crew}
            onChange={(e) => onChange({ crew: e.target.value })}
            placeholder="0"
            className="mt-1"
          />
        </div>

        <div>
          <FieldLabel hint="Total special meals on this flight — counted automatically from the Special Meal Roster below. Add rows there to change it.">
            Special Meals
          </FieldLabel>
          <div className="mt-1 h-9 rounded-md border border-input bg-muted/40 px-3 flex items-center justify-between text-sm">
            <span className="tabular-nums font-semibold text-foreground">{value.roster.length}</span>
            <span className="text-[11px] text-muted-foreground">auto from roster below</span>
          </div>
        </div>
      </div>

      {/* ── Special Meal Roster (per leg) ──────────────────────────────── */}
      <div className="mt-6 border-t border-border pt-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Special Meal Roster
            </h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Optional — one row per passenger requiring a special meal on this flight.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setShowBulk((v) => !v)}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
              {showBulk ? "Hide Paste" : "Bulk Paste"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={addRosterRow}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Passenger
            </Button>
          </div>
        </div>

        {showBulk && (
          <div className="mb-3 rounded-md border border-dashed border-border bg-muted/30 p-3">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Paste from spreadsheet — one passenger per line
            </Label>
            <p className="text-[10px] text-muted-foreground mt-0.5 mb-1.5 font-mono">
              PNR, Passenger Name, Seat, Meal Code, [Audience]   (comma/tab separated · Audience optional: "Crew" for crew specials)
            </p>
            <textarea
              value={bulkPaste}
              onChange={(e) => setBulkPaste(e.target.value)}
              rows={4}
              className="w-full text-xs font-mono rounded-md border border-input bg-background px-3 py-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder={"09QIBQ, NILAVRO SARKAR DIP, 21A, AVML\n09QI6J1, MD SHOJIB, 22A, FPML"}
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setBulkPaste(""); setShowBulk(false); }}>
                Cancel
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={applyBulkPaste}>
                Import {bulkPaste.split(/\r?\n/).filter((l) => l.trim()).length || 0} Rows
              </Button>
            </div>
          </div>
        )}

        <div className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="w-10 text-[10px] uppercase tracking-wider">SL</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider w-36">For</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider w-32">PNR</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Passenger Name</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider w-20">Seat</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider w-40">Meal Type</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {value.roster.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-6">
                    No special meals on this flight. Click <strong className="text-foreground">+ Add Passenger</strong> or <strong className="text-foreground">Bulk Paste</strong> to attach a manifest.
                  </TableCell>
                </TableRow>
              ) : (
                value.roster.map((r, i) => {
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <div className="flex w-full rounded-md border border-input bg-background p-0.5 shadow-sm">
                          {(["Passenger", "Crew"] as const).map((a) => {
                            const active = (r.audience ?? "Passenger") === a;
                            return (
                              <button
                                key={a}
                                type="button"
                                onClick={() => updateRosterRow(r.id, { audience: a })}
                                className={
                                  "flex-1 rounded-sm px-1.5 py-1 text-[11px] font-medium transition-colors " +
                                  (active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")
                                }
                              >
                                {a}
                              </button>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.pnr}
                          onChange={(e) => updateRosterRow(r.id, { pnr: e.target.value.toUpperCase() })}
                          placeholder={r.audience === "Crew" ? "—" : "09QIBQ"}
                          disabled={r.audience === "Crew"}
                          className="h-8 font-mono text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.passengerName}
                          onChange={(e) => updateRosterRow(r.id, { passengerName: e.target.value })}
                          placeholder={r.audience === "Crew" ? "Any crew member" : "PASSENGER NAME"}
                          disabled={r.audience === "Crew"}
                          className="h-8 text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.seat}
                          onChange={(e) => updateRosterRow(r.id, { seat: e.target.value.toUpperCase() })}
                          placeholder={r.audience === "Crew" ? "—" : "21A"}
                          disabled={r.audience === "Crew"}
                          className="h-8 font-mono text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <SearchSelect
                          value={r.mealCode}
                          onChange={(mealCode) => updateRosterRow(r.id, { mealCode })}
                          options={SPECIAL_MEAL_CODES.map((m) => ({
                            value: m.code,
                            label: `${m.code} — ${m.name}`,
                            keywords: `${m.name} ${m.category}`,
                          }))}
                          searchPlaceholder="Search meal…"
                          emptyText="No meal code."
                          className="mt-0 h-8 text-xs"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => removeRosterRow(r.id)}
                          aria-label="Remove passenger"
                        >
                          <X className="h-3.5 w-3.5 text-destructive" />
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
    </>
  );
}

// One selected flight in the create form: its own editable detail block plus an
// optional paired return leg. Auto mode holds an array of these — one per flight
// number picked from the multi-select — so several flights are filled at once.
type FlightEntry = {
  flight: string;
  detail: LegDetail;
  withReturn: boolean;
  ret: LegDetail;
};

function OrderCreate({
  onSave, nextOrderNo, nextRowSeq,
}: {
  onSave: (legs: FlightOrder[]) => void;
  nextOrderNo: string;
  nextRowSeq: number;
}) {
  // Auto: pick one or more scheduled flights and fill each flight's details
  // individually. Manual: type a single flight number and enter every field by
  // hand (no schedule lookup).
  const [flightMode, setFlightMode] = useState<"auto" | "manual">("auto");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  // Auto mode — one entry per selected flight, each with its own editable detail
  // (and an optional paired return leg).
  const [entries, setEntries] = useState<FlightEntry[]>([]);

  // Manual mode — a single hand-typed flight.
  const [manualFlight, setManualFlight] = useState("");
  const [manualDetail, setManualDetail] = useState<LegDetail>(emptyLegDetail());

  const [legs, setLegs] = useState<LegDraft[]>([]);

  // Flights that operate on the chosen date — the Flight Number dropdown source.
  // Flights already added to this order are hidden to avoid duplicates.
  const availableFlights = useMemo(() => {
    const used = new Set(legs.map((l) => l.flight));
    return scheduledFlightsForDate(date).filter((f) => !used.has(f.flight));
  }, [date, legs]);

  const selectedFlights = entries.map((e) => e.flight);

  const patchManual = (patch: Partial<LegDetail>) => setManualDetail((p) => ({ ...p, ...patch }));

  // Changing the date invalidates every flight pick (a flight may not operate
  // that day), so clear the whole in-progress selection.
  const onDateChange = (next: string) => {
    setDate(next);
    setEntries([]);
    setManualFlight("");
    setManualDetail(emptyLegDetail());
  };

  // Toggle a scheduled flight in/out of the selection. Adding one seeds its
  // detail block from the schedule; removing drops that entry.
  const toggleFlight = (flightNo: string) => {
    setEntries((prev) => {
      if (prev.some((e) => e.flight === flightNo)) {
        return prev.filter((e) => e.flight !== flightNo);
      }
      const sf = scheduledFlightsForDate(date).find((f) => f.flight === flightNo);
      return [
        ...prev,
        {
          flight: flightNo,
          detail: sf ? legDetailFromSchedule(sf, date) : emptyLegDetail(),
          withReturn: false,
          ret: emptyLegDetail(),
        },
      ];
    });
  };

  const removeEntry = (flightNo: string) =>
    setEntries((prev) => prev.filter((e) => e.flight !== flightNo));

  const patchEntryDetail = (flightNo: string, patch: Partial<LegDetail>) =>
    setEntries((prev) => prev.map((e) =>
      e.flight === flightNo ? { ...e, detail: { ...e.detail, ...patch } } : e));

  const patchEntryReturn = (flightNo: string, patch: Partial<LegDetail>) =>
    setEntries((prev) => prev.map((e) =>
      e.flight === flightNo ? { ...e, ret: { ...e.ret, ...patch } } : e));

  // Toggle "also order the return flight" for one entry → seed its return block
  // from the scheduled pair, dated to the return's own schedule (same-day
  // turnaround or a later day).
  const toggleEntryReturn = (flightNo: string, checked: boolean) =>
    setEntries((prev) => prev.map((e) => {
      if (e.flight !== flightNo) return e;
      const pair = pairScheduledFlight(flightNo);
      if (checked && pair) {
        const rDate = returnFlightDate(date, e.detail.etd || pair.etd, pair);
        return { ...e, withReturn: true, ret: legDetailFromSchedule(pair, rDate) };
      }
      return { ...e, withReturn: false, ret: emptyLegDetail() };
    }));

  // Switch entry mode → clear the in-progress selection (already-added legs stay).
  const onModeChange = (next: "auto" | "manual") => {
    setFlightMode(next);
    setEntries([]);
    setManualFlight("");
    setManualDetail(emptyLegDetail());
  };

  const resetForm = () => {
    setEntries([]);
    setManualFlight("");
    setManualDetail(emptyLegDetail());
  };

  // Build one leg (flight # + its detail), validating and cleaning the roster.
  // Returns null after a toast when the detail is invalid.
  const buildLeg = (flightNo: string, d: LegDetail, label: string): LegDraft | null => {
    if (!d.date) { toast.error(`${label}: departure date is required.`); return null; }
    if (!d.from || !d.to) { toast.error(`${label}: sector (From → To) is required.`); return null; }
    if (d.from === d.to) { toast.error(`${label}: From and To must be different airports.`); return null; }
    const paxNum = Number(d.pax);
    if (!paxNum || paxNum <= 0) { toast.error(`${label}: PAX must be greater than zero.`); return null; }
    // Drop blank rows. Crew specials need only a meal code (no PNR/seat);
    // passenger rows still need the full identity.
    const cleanRoster = d.roster.filter((r) =>
      r.mealCode && (r.audience === "Crew" || (r.pnr.trim() && r.passengerName.trim() && r.seat.trim())),
    );
    return {
      flight: flightNo.trim().toUpperCase(),
      airline: d.airline,
      sector: `${d.from} → ${d.to}`,
      date: d.date,
      etd: d.etd || "—",
      pax: paxNum,
      crew: Math.max(0, Number(d.crew) || 0),
      specialMeals: cleanRoster.length,
      status: "Pending",
      direction: d.direction,
      roster: cleanRoster,
    };
  };

  const addLegs = () => {
    const newLegs: LegDraft[] = [];
    if (flightMode === "manual") {
      if (!manualFlight.trim()) { toast.error("Flight number is required."); return; }
      // The leg always departs on the Step-1 date.
      const leg = buildLeg(manualFlight, { ...manualDetail, date }, "Flight");
      if (!leg) return;
      newLegs.push(leg);
    } else {
      if (entries.length === 0) { toast.error("Select at least one flight."); return; }
      // Validate every selected flight (and its return) before committing any —
      // an all-or-nothing add across the whole batch.
      for (const e of entries) {
        const primaryLeg = buildLeg(e.flight, { ...e.detail, date }, `Flight ${e.flight}`);
        if (!primaryLeg) return;
        newLegs.push(primaryLeg);
        if (e.withReturn) {
          const pair = pairScheduledFlight(e.flight);
          if (pair) {
            const returnLeg = buildLeg(pair.flight, e.ret, `Return flight ${pair.flight}`);
            if (!returnLeg) return;
            newLegs.push(returnLeg);
          }
        }
      }
    }
    setLegs((prev) => [...prev, ...newLegs]);
    resetForm();
  };

  const removeLeg = (i: number) =>
    setLegs((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = () => {
    if (legs.length === 0) {
      toast.error("Add at least one flight.");
      return;
    }
    const rows: FlightOrder[] = legs.map((l, i) => ({
      id: `FO-${String(nextRowSeq + i).padStart(3, "0")}`,
      orderNo: nextOrderNo,
      flight: l.flight,
      airline: l.airline,
      sector: l.sector,
      date: l.date,
      etd: l.etd,
      pax: l.pax,
      crew: l.crew,
      specialMeals: l.specialMeals,
      status: l.status,
      direction: l.direction,
      orderType: "flight",
      createdAt: Date.now(),
      specialMealRoster: l.roster.length > 0 ? l.roster : undefined,
    }));
    onSave(rows);
    toast.success(`${nextOrderNo} created with ${legs.length} ${legs.length === 1 ? "flight" : "flights"}.`);
  };

  const totalPax = legs.reduce((s, l) => s + l.pax, 0);
  const totalMeals = legs.reduce((s, l) => s + l.specialMeals, 0);

  // How many legs the current Add will produce (each selected flight, plus any
  // opted-in returns) — drives the Add button's label and disabled state.
  const pendingCount = flightMode === "manual"
    ? (manualFlight.trim() ? 1 : 0)
    : entries.reduce((n, e) => n + 1 + (e.withReturn && pairScheduledFlight(e.flight) ? 1 : 0), 0);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      {/* ── Step 1 · Date → Flight ───────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-muted/30 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <StepBadge n={1} />
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Select Date &amp; Flight</h3>
          </div>
          {/* Entry mode — Auto (pick from schedule) vs Manual (type everything) */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Entry</span>
            <div className="flex rounded-md border border-input bg-background p-0.5 shadow-sm">
              {(["auto", "manual"] as const).map((m) => {
                const active = flightMode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onModeChange(m)}
                    className={
                      "rounded-sm px-3 py-1 text-[11px] font-medium capitalize transition-colors " +
                      (active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
        </header>
        <div className="p-5">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <div>
              <FieldLabel
                required
                hint="Scheduled departure date. Pick this first — the Flight Number list below shows only the flights that operate on this day."
              >
                Date
              </FieldLabel>
              <Input
                type="date"
                value={date}
                onChange={(e) => onDateChange(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <FieldLabel
                required
                hint={
                  flightMode === "auto"
                    ? "Flights scheduled on the selected date. Pick as many as you need — each one gets its own details block below to fill in individually."
                    : "Type the flight number, then enter every field below by hand. No schedule is used."
                }
              >
                Flight Number
              </FieldLabel>
              {flightMode === "auto" ? (
                <>
                  <MultiSearchSelect
                    values={selectedFlights}
                    onToggle={toggleFlight}
                    disabled={availableFlights.length === 0}
                    options={availableFlights.map((f) => ({
                      value: f.flight,
                      label: `${f.flight} · ${f.from}→${f.to} · ${f.etd} · ${f.airline}`,
                      keywords: `${f.from} ${f.to} ${f.airline}`,
                    }))}
                    placeholder={availableFlights.length ? "Select one or more flights…" : "No flights scheduled for this date"}
                    searchPlaceholder="Search flight, sector, airline…"
                    emptyText="No matching flight."
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {availableFlights.length
                      ? selectedFlights.length
                        ? `${selectedFlights.length} selected · ${availableFlights.length} operating on this date`
                        : `${availableFlights.length} flight${availableFlights.length === 1 ? "" : "s"} operating on this date`
                      : "No scheduled flights left for this date — try another date."}
                  </p>
                </>
              ) : (
                <>
                  <Input
                    value={manualFlight}
                    onChange={(e) => setManualFlight(e.target.value.toUpperCase())}
                    placeholder="e.g. BS-203"
                    className="mt-1"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Manual entry — fill in every field below yourself.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Step 2 · Flight details (auto-filled, editable) ──────────────── */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <header className="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/30 px-5 py-3">
          <StepBadge n={2} />
          <Plane className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Flight Details</h3>
          <span className="text-[11px] text-muted-foreground">
            {flightMode === "auto" ? "auto-filled per flight — edit anything that differs" : "enter each field for this flight"}
          </span>
        </header>
        <div className="p-5">
          {flightMode === "manual" ? (
            <FlightLegFields value={manualDetail} onChange={patchManual} autoFocusPax showAuto={false} />
          ) : entries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-12 text-center">
              <Plane className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Select one or more flights above to fill their details individually.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {entries.map((e, idx) => {
                const pair = pairScheduledFlight(e.flight);
                // Whole-day gap between the outbound date and the return's own
                // date (0 = same day). Drives the "next day" badge.
                const returnDayGap = e.withReturn && e.ret.date && e.ret.date !== date
                  ? Math.round((Date.parse(e.ret.date) - Date.parse(date)) / 86_400_000)
                  : 0;
                return (
                  <div key={e.flight} className="rounded-lg border border-border bg-muted/10 p-4">
                    {/* Flight header + remove-from-selection */}
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Plane className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-semibold text-foreground">{e.flight}</span>
                      <DirectionBadge direction={e.detail.direction} />
                      <span className="text-xs text-muted-foreground">
                        {e.detail.from}→{e.detail.to} · {date} · {e.detail.etd}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-auto h-7 w-7"
                        onClick={() => removeEntry(e.flight)}
                        aria-label={`Remove flight ${e.flight}`}
                      >
                        <X className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                    <FlightLegFields
                      value={e.detail}
                      onChange={(patch) => patchEntryDetail(e.flight, patch)}
                      autoFocusPax={idx === 0}
                      showAuto
                    />

                    {/* Round-trip toggle for this flight (relies on the schedule). */}
                    {pair ? (
                      <label
                        className={cn(
                          "mt-4 flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors",
                          e.withReturn
                            ? "border-primary/40 bg-primary/[0.04]"
                            : "border-border bg-muted/20 hover:bg-muted/40",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={e.withReturn}
                          onChange={(ev) => toggleEntryReturn(e.flight, ev.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                        />
                        <CornerUpLeft
                          className={cn(
                            "mt-0.5 h-4 w-4 shrink-0",
                            e.withReturn ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        <span className="text-xs leading-snug">
                          <span className="font-semibold text-foreground">
                            Also order the {e.detail.direction === "Return" ? "outbound" : "return"} flight — {pair.flight}
                          </span>
                          <span className="mt-0.5 block text-muted-foreground">
                            {pair.from}→{pair.to} · {pair.etd}. Adds a second leg with its own PAX and special-meal roster.
                          </span>
                        </span>
                      </label>
                    ) : (
                      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <CornerUpLeft className="h-3 w-3" />
                        No scheduled return for {e.flight} — this sector is one-way in the timetable.
                      </p>
                    )}

                    {/* Paired return flight — its own schedule date (below) and time */}
                    {e.withReturn && pair && (
                      <div className="mt-4 rounded-lg border border-primary/30 bg-primary/[0.03] p-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <CornerUpLeft className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                            {e.ret.direction === "Return" ? "Return Flight" : "Outbound Flight"}
                          </span>
                          <span className="text-xs font-semibold text-foreground">{pair.flight}</span>
                          <DirectionBadge direction={e.ret.direction} />
                          <span className="text-xs text-muted-foreground">
                            {e.ret.from}→{e.ret.to} · {e.ret.date} · {e.ret.etd}
                          </span>
                          {returnDayGap > 0 && (
                            <span className="rounded-sm bg-navy/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-navy">
                              {returnDayGap === 1 ? "Next day" : `+${returnDayGap} days`}
                            </span>
                          )}
                        </div>
                        <div className="mb-4 max-w-[240px]">
                          <FieldLabel auto required hint="The return flight's own departure date, from its schedule — the same day for a turnaround, or a later day for an overnight return. Editable if it differs.">
                            Return Date
                          </FieldLabel>
                          <Input
                            type="date"
                            value={e.ret.date}
                            min={date}
                            onChange={(ev) => patchEntryReturn(e.flight, { date: ev.target.value })}
                            className="mt-1"
                          />
                        </div>
                        <FlightLegFields value={e.ret} onChange={(patch) => patchEntryReturn(e.flight, patch)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Flights on this order ────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <header className="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/30 px-5 py-3">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Flights on this order</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {legs.length}
          </span>
        </header>
        <div className="p-5">
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-12 text-[10px] uppercase tracking-wider">#</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Flight</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Sector</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">ETD</TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-wider">PAX</TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-wider">Spec. Meals</TableHead>
                  <TableHead className="w-14" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {legs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center">
                      <Plane className="mx-auto mb-2 h-5 w-5 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">
                        No flights yet. Fill the details above and click{" "}
                        <strong className="text-foreground">{pendingCount > 1 ? `Add ${pendingCount} Flights` : "Add Flight"}</strong>.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {legs.map((l, i) => (
                      <TableRow key={i} className="hover:bg-muted/20">
                        <TableCell className="text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1.5">
                            {l.flight}
                            <DirectionBadge direction={l.direction} />
                          </div>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">{l.date}</TableCell>
                        <TableCell>{l.sector}</TableCell>
                        <TableCell className="tabular-nums">{l.etd}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.pax}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.specialMeals}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => removeLeg(i)}
                            aria-label={`Remove flight ${i + 1}`}
                          >
                            <X className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell colSpan={5} className="text-right text-xs uppercase tracking-wider">
                        Total
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{totalPax}</TableCell>
                      <TableCell className="text-right tabular-nums">{totalMeals}</TableCell>
                      <TableCell />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      {/* ── Sticky summary + actions ─────────────────────────────────────── */}
      <div className="sticky bottom-4 z-10">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 px-5 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Plane className="h-3.5 w-3.5" />
              <span className="font-semibold tabular-nums text-foreground">{legs.length}</span> flight{legs.length === 1 ? "" : "s"}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span className="font-semibold tabular-nums text-foreground">{totalPax}</span> PAX
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Utensils className="h-3.5 w-3.5" />
              <span className="font-semibold tabular-nums text-foreground">{totalMeals}</span> special meal{totalMeals === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={addLegs} disabled={pendingCount === 0}>
              <Plus className="mr-1.5 h-4 w-4" /> {pendingCount > 1 ? `Add ${pendingCount} Flights` : "Add Flight"}
            </Button>
            <Button onClick={handleSave} disabled={legs.length === 0}>
              <Save className="mr-1.5 h-4 w-4" /> Save Order
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CrewMealCreate({
  onSave, resolveOrderNo, nextRowSeq,
}: {
  onSave: (legs: FlightOrder[]) => void;
  /** Resolve the Order # for the crew order from its date + flights — reuses the
   *  matching flight order's number so a flight and its crew order share one #. */
  resolveOrderNo: (date: string, flights: string[]) => string;
  nextRowSeq: number;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const slots = useMealSlots();
  const [scope, setScope] = useState<"Domestic" | "International">("Domestic");
  const [airline, setAirline] = useState(AIRLINES[0]);
  const [date, setDate] = useState(today);

  const [mealSlot, setMealSlot] = useState<MealSlot>(slots[0]?.name ?? "Breakfast");
  const [flight, setFlight] = useState("");
  const [from, setFrom] = useState("DAC");
  const [to, setTo] = useState("CGP");
  const [etd, setEtd] = useState("");
  const [pax, setPax] = useState("");
  const [crew, setCrew] = useState("4");
  const [specialMeals, setSpecialMeals] = useState("0");
  const [direction, setDirection] = useState<FlightDirection>("Outbound");

  const [legs, setLegs] = useState<LegDraft[]>([]);

  const domesticCodes = ["DAC", "CGP", "CXB", "ZYL", "JSR"];
  const airports = scope === "Domestic"
    ? AIRPORTS.filter((a) => domesticCodes.includes(a.code))
    : AIRPORTS;

  // Slot derived from ETD wins for display once the user has typed a time;
  // before that the explicit Meal Slot picker drives the badge.
  const derivedSlot = etd ? resolveMealSlot(etd, slots).name : null;
  const slotForBadge = derivedSlot ?? mealSlot;
  const slotMismatch = derivedSlot && derivedSlot !== mealSlot;

  const slotStartTime = (slot: MealSlot): string => {
    const def = slots.find((s) => s.name === slot);
    if (!def) return "";
    return `${String(def.from).padStart(2, "0")}:00`;
  };

  const onPickSlot = (slot: MealSlot) => {
    setMealSlot(slot);
    // Auto-seed ETD to that slot's start time (user can fine-tune)
    setEtd(slotStartTime(slot));
  };

  const resetForm = () => {
    setFlight(""); setEtd(""); setPax(""); setSpecialMeals("0");
    setCrew(scope === "Domestic" ? "4" : "14");
    setDirection("Outbound");
    // Keep the same mealSlot so the user can add several flights to one slot
    // in a row without re-picking it each time.
  };

  const onScopeChange = (next: "Domestic" | "International") => {
    setScope(next);
    setFrom(next === "Domestic" ? "DAC" : "DAC");
    setTo(next === "Domestic" ? "CGP" : "DXB");
    setCrew(next === "Domestic" ? "4" : "14");
  };

  const addLeg = () => {
    if (!flight.trim()) { toast.error("Flight number is required."); return; }
    if (!from || !to) { toast.error("Sector (From → To) is required."); return; }
    if (from === to) { toast.error("From and To must be different airports."); return; }
    if (!etd) { toast.error("ETD is required."); return; }
    const crewNum = Number(crew);
    if (!crewNum || crewNum <= 0) { toast.error("No of Crew must be greater than zero."); return; }
    setLegs((prev) => [
      ...prev,
      {
        flight: flight.trim().toUpperCase(),
        airline,
        sector: `${from} → ${to}`,
        date,
        etd,
        pax: Number(pax) || 0,
        crew: crewNum,
        specialMeals: Number(specialMeals) || 0,
        status: "Pending" as FlightOrderStatus,
        direction,
        roster: [],
      },
    ]);
    // Carry the crew count forward (usually constant across legs of the same order)
    resetForm();
  };

  const removeLeg = (i: number) =>
    setLegs((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = () => {
    if (legs.length === 0) {
      toast.error("Add at least one flight.");
      return;
    }
    // crew count needs to be captured per leg — read from each LegDraft entry.
    // Since LegDraft already covers status/etd/etc, append crew via a parallel
    // map by using the current `crew` input as a fallback when needed.
    const orderNo = resolveOrderNo(date, legs.map((l) => l.flight));
    const rows: FlightOrder[] = legs.map((l, i) => ({
      id: `FO-${String(nextRowSeq + i).padStart(3, "0")}`,
      orderNo,
      flight: l.flight,
      airline,
      sector: l.sector,
      date,
      etd: l.etd,
      pax: l.pax,
      crew: Number(crew) || (scope === "Domestic" ? 4 : 14),
      specialMeals: l.specialMeals,
      status: l.status,
      direction: l.direction,
      orderType: "crew",
      createdAt: Date.now(),
    }));
    onSave(rows);
    toast.success(`${orderNo} created with ${legs.length} ${legs.length === 1 ? "flight" : "flights"} (shared with the flight order).`);
  };

  // Build groups for the in-form preview table (uses the user's current slots)
  const groups = new Map<MealSlot, LegDraft[]>();
  slots.forEach((s) => groups.set(s.name, []));
  legs.forEach((l) => {
    groups.get(resolveMealSlot(l.etd, slots).name)!.push(l);
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Create Crew Meal Order
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add flights under this Order. The meal slot (Breakfast / Heavy Snacks / Lunch / Dinner) is derived from each flight's ETD.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={addLeg}>
              <Plus className="h-4 w-4 mr-1.5" /> Add Flight
            </Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-1.5" /> Save
            </Button>
          </div>
        </div>

        {/* Order-level fields */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 mb-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Scope</Label>
            <div className="mt-1 flex w-fit rounded-md border border-input bg-background p-0.5 shadow-sm">
              {(["Domestic", "International"] as const).map((s) => {
                const active = scope === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onScopeChange(s)}
                    className={
                      "px-3 py-1.5 text-xs font-medium rounded-sm transition-colors " +
                      (active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Airline</Label>
            <select value={airline} onChange={(e) => setAirline(e.target.value)} className={selectCls}>
              {AIRLINES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div className="border-t border-border pt-4 mb-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              New Flight
              <Badge
                variant="outline"
                className="ml-2 h-5 px-1.5 text-[10px] border-primary/30 bg-primary/5 text-primary"
              >
                {slotForBadge}
              </Badge>
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Pick a meal slot — ETD will auto-seed to that slot's start time. You can still fine-tune the time below.
            </p>
          </div>

          <div className="inline-flex flex-wrap rounded-md border border-input bg-background p-0.5 shadow-sm">
            {slots.map((s) => {
              const active = mealSlot === s.name;
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => onPickSlot(s.name)}
                  className={
                    "px-3 py-1.5 text-xs font-medium rounded-sm transition-colors " +
                    (active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground")
                  }
                  title={`${s.name} (${formatSlotRange(s)})`}
                >
                  {s.name}
                  <span className="ml-1.5 text-[10px] opacity-70 tabular-nums">
                    {formatSlotRange(s)}
                  </span>
                </button>
              );
            })}
          </div>

          {slotMismatch && (
            <div className="mt-2 text-[11px] text-warning flex items-center gap-1.5">
              <AlertCircle className="h-3 w-3" />
              ETD {etd} falls in <strong>{derivedSlot}</strong>, not the selected <strong>{mealSlot}</strong> slot. The entry will be grouped under {derivedSlot}.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Flight Number <span className="text-destructive">*</span>
            </Label>
            <Input value={flight} onChange={(e) => setFlight(e.target.value)} placeholder="e.g. BS-141" className="mt-1" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              ETD <span className="text-destructive">*</span>
            </Label>
            <Input type="time" value={etd} onChange={(e) => setEtd(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              From <span className="text-destructive">*</span>
            </Label>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls}>
              {airports.map((a) => (
                <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              To <span className="text-destructive">*</span>
            </Label>
            <select value={to} onChange={(e) => setTo(e.target.value)} className={selectCls}>
              {airports.map((a) => (
                <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              No of Crew <span className="text-destructive">*</span>
            </Label>
            <Input type="number" min={0} value={crew} onChange={(e) => setCrew(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Special Meals</Label>
            <Input type="number" min={0} value={specialMeals} onChange={(e) => setSpecialMeals(e.target.value)} placeholder="0" className="mt-1" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Direction</Label>
            <div className="mt-1 flex w-fit rounded-md border border-input bg-background p-0.5 shadow-sm">
              {(["Outbound", "Return"] as FlightDirection[]).map((d) => {
                const active = direction === d;
                const isReturn = d === "Return";
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={
                      "px-3 py-1.5 text-xs font-medium rounded-sm transition-colors " +
                      (active
                        ? isReturn
                          ? "bg-navy/10 text-navy"
                          : "bg-success/10 text-success"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {isReturn ? "↺" : "↗"} {d}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Legs grouped by meal slot */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Flights by Meal Slot
            </h4>
            <span className="text-xs text-muted-foreground">
              {legs.length === 0 ? "No flights added yet" : `${legs.length} ${legs.length === 1 ? "flight" : "flights"} on this order`}
            </span>
          </div>

          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-12 text-xs uppercase tracking-wider">SL</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider w-28">Order</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider w-20">ETD</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right w-24">Crew</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {legs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                      Add flights above and they'll appear here grouped by meal slot.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {slots.map((slot) => {
                      const rows = groups.get(slot.name)!;
                      if (rows.length === 0) return null;
                      const slotCrew = rows.reduce((s, l) => s + (Number(crew) || 0), 0);
                      return (
                        <Fragment key={slot.name}>
                          <TableRow className="bg-primary/5 border-t-2 border-t-primary/40 hover:bg-primary/10">
                            <TableCell colSpan={7} className="py-2">
                              <span className="font-semibold text-primary uppercase tracking-wider text-xs">
                                {slot.name}
                              </span>
                              <span className="ml-2 text-[10px] text-muted-foreground tabular-nums">
                                {formatSlotRange(slot)}
                              </span>
                            </TableCell>
                          </TableRow>
                          {rows.map((l) => {
                            const originalIndex = legs.indexOf(l);
                            return (
                              <TableRow key={originalIndex}>
                                <TableCell className="tabular-nums text-xs">{originalIndex + 1}</TableCell>
                                <TableCell className="font-mono text-xs text-primary">{resolveOrderNo(date, legs.map((l) => l.flight))}</TableCell>
                                <TableCell className="font-medium">
                                  <div className="flex items-center gap-1.5">
                                    {l.flight}
                                    <DirectionBadge direction={l.direction} />
                                  </div>
                                </TableCell>
                                <TableCell>{l.sector}</TableCell>
                                <TableCell className="tabular-nums">{l.etd}</TableCell>
                                <TableCell className="text-right tabular-nums font-semibold">{Number(crew) || 0}</TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => removeLeg(originalIndex)}
                                    aria-label={`Remove flight${originalIndex + 1}`}
                                  >
                                    <X className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          <TableRow className="bg-muted/30 font-semibold">
                            <TableCell colSpan={5} className="text-right uppercase text-[10px] tracking-wider">
                              {slot.name} Total
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-primary">{slotCrew}</TableCell>
                            <TableCell />
                          </TableRow>
                        </Fragment>
                      );
                    })}
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function groupByDate(rows: ParsedRow[]): { date: string; rows: ParsedRow[] }[] {
  const map = new Map<string, ParsedRow[]>();
  for (const r of rows) {
    const d = r.date ?? "Unknown";
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(r);
  }
  return Array.from(map.entries()).map(([date, rows]) => ({ date, rows }));
}

function formatDayLabel(dateStr: string) {
  if (dateStr === "Unknown") return "Unknown Date";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Weekly meal config keyed by day-of-week (0=Sun…6=Sat), sourced from Menu Planning module
const WEEK_MEAL_CONFIG: Record<number, {
  intl: { depMealName: string; depChmlName: string; retMealName: string; retVgmlName: string };
  dom: {
    usbaBreakfastName: string; usbaLunchName: string;
    aaaBreakfastName: string; aaaLunchName: string;
    crewSnackName: string; crewLunchName: string; crewDinnerName: string;
  };
}> = {
  0: { intl: { depMealName: "Chicken Biryani + Salad", depChmlName: "Child Meal Box", retMealName: "Fish Rice + Veg", retVgmlName: "Veg Platter" }, dom: { usbaBreakfastName: "JBR + CKN Buggati", usbaLunchName: "Rice + Hilsa Curry", aaaBreakfastName: "Paratha + Omelette", aaaLunchName: "Rice + Dal", crewSnackName: "Biscuits + Tea", crewLunchName: "Chef's Rice + Fish", crewDinnerName: "Rice + Chicken" } },
  1: { intl: { depMealName: "Beef Kacchi Biryani", depChmlName: "Junior Snack Box", retMealName: "Chicken Rice + Soup", retVgmlName: "Veg Curry Plate" }, dom: { usbaBreakfastName: "Paratha + Omelette + Juice", usbaLunchName: "Rice + Chicken Roast", aaaBreakfastName: "JBR + CKN Buggati", aaaLunchName: "Rice + Beef Curry", crewSnackName: "Samosa + Tea", crewLunchName: "Rice + Chicken Curry", crewDinnerName: "Rice + Fish Fry" } },
  2: { intl: { depMealName: "Chicken Tikka Masala + Rice", depChmlName: "Kids' Snack Tray", retMealName: "Lamb Pilaf", retVgmlName: "Paneer Tikka + Rice" }, dom: { usbaBreakfastName: "JBR + Egg Bhurji", usbaLunchName: "Rice + Mutton Curry", aaaBreakfastName: "Paratha + Halwa", aaaLunchName: "Rice + Fish Curry", crewSnackName: "Biscuits + Coffee", crewLunchName: "Rice + Beef Curry", crewDinnerName: "Fried Rice + Chicken" } },
  3: { intl: { depMealName: "Hilsa Fish Rice + Dal", depChmlName: "Child Snack Box", retMealName: "Chicken Biryani", retVgmlName: "Mixed Veg Platter" }, dom: { usbaBreakfastName: "JBR + CKN Buggati", usbaLunchName: "Rice + Hilsa Curry", aaaBreakfastName: "Paratha + Omelette", aaaLunchName: "Rice + Chicken Curry", crewSnackName: "Biscuits + Tea", crewLunchName: "Chef's Special Rice + Fish", crewDinnerName: "Rice + Beef Bhuna" } },
  4: { intl: { depMealName: "Mutton Kacchi + Salad", depChmlName: "Junior Meal Box", retMealName: "Fish Curry Rice", retVgmlName: "Veg Biryani" }, dom: { usbaBreakfastName: "Semolina Halwa + Paratha", usbaLunchName: "Rice + Mutton Curry", aaaBreakfastName: "JBR + CKN Buggati", aaaLunchName: "Rice + Fish Fry", crewSnackName: "Cake + Tea", crewLunchName: "Rice + Mutton Curry", crewDinnerName: "Fried Rice + Fish" } },
  5: { intl: { depMealName: "Chicken Biryani + Raita", depChmlName: "Child Meal Box", retMealName: "Beef Kacchi Rice", retVgmlName: "Veg Pulao" }, dom: { usbaBreakfastName: "JBR + Egg Bhurji", usbaLunchName: "Khichuri + Beef Bhuna", aaaBreakfastName: "Paratha + Chicken Fry", aaaLunchName: "Rice + Hilsa Curry", crewSnackName: "Pitha + Tea", crewLunchName: "Khichuri + Beef", crewDinnerName: "Rice + Chicken Roast" } },
  6: { intl: { depMealName: "Lamb Curry Rice + Salad", depChmlName: "Child Snack Set", retMealName: "Chicken Tikka Rice", retVgmlName: "Veg Fried Rice" }, dom: { usbaBreakfastName: "Paratha + Halwa + Juice", usbaLunchName: "Rice + Chicken Curry", aaaBreakfastName: "JBR + CKN Buggati", aaaLunchName: "Rice + Beef Curry", crewSnackName: "Biscuits + Coffee", crewLunchName: "Rice + Fish Curry", crewDinnerName: "Rice + Lamb Curry" } },
};

const BU_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const BU_MEAL_TYPES = ["Breakfast", "Lunch", "Snacks", "Heavy Snacks", "Dinner"];
const BU_MEAL_TYPE_TIME: Record<string, string> = {
  Breakfast: "07:00 AM – 10:00 AM", Lunch: "11:00 AM – 02:00 PM",
  Snacks: "02:00 PM – 04:00 PM", "Heavy Snacks": "04:00 PM – 07:00 PM",
  Dinner: "07:00 PM – 10:00 PM",
};

function BulkUpload({ onPersistOrders, orderNoSeed, existingOrders, onUpdateCrew, onAttachRoster, onOrderConfirmed }: {
  /** Persists imported orders into the Order Management table without navigating away. */
  onPersistOrders: (orders: FlightOrder[]) => void;
  /** Highest existing order number — new bulk orders get sequential numbers above it. */
  orderNoSeed: number;
  /** Flight orders already in the system — so a special-meal manifest can attach
   *  to flights that were imported/created earlier, not just this session's upload. */
  existingOrders: FlightOrder[];
  /** Update an existing flight order's crew count (used when a crew upload merges
   *  into a flight that already exists, instead of creating a separate crew row). */
  onUpdateCrew: (legId: string, crew: number) => void;
  /** Attach a parsed roster to an existing order leg (by leg id). */
  onAttachRoster: (legId: string, roster: SpecialMealEntry[]) => void;
  onOrderConfirmed?: (data: MealOrderConfirmation) => void;
}) {
  const navigate = useNavigate();
  const [draftSaved, setDraftSaved] = useState(false);
  const domFileRef = useRef<HTMLInputElement>(null);
  const [domFile, setDomFile] = useState<File | null>(null);
  const [domProgress, setDomProgress] = useState(0);
  const [domDone, setDomDone] = useState(false);
  const [domParsed, setDomParsed] = useState<ParsedRow[]>(SAMPLE_PARSED_DOM);

  const intlFileRef = useRef<HTMLInputElement>(null);
  const [intlFile, setIntlFile] = useState<File | null>(null);
  const [intlProgress, setIntlProgress] = useState(0);
  const [intlDone, setIntlDone] = useState(false);
  const [intlParsed, setIntlParsed] = useState<ParsedRow[]>(SAMPLE_PARSED_INTL);

  // Crew-meal and special-meal manifests upload separately from the flight
  // orders — each attaches to existing flights by Flight No + Date.
  const crewFileRef = useRef<HTMLInputElement>(null);
  const [crewFile, setCrewFile] = useState<File | null>(null);
  const [crewProgress, setCrewProgress] = useState(0);
  const [crewDone, setCrewDone] = useState(false);
  const [crewParsed, setCrewParsed] = useState<ParsedRow[]>([]);
  const specialFileRef = useRef<HTMLInputElement>(null);
  const [specialFile, setSpecialFile] = useState<File | null>(null);
  const [specialDone, setSpecialDone] = useState(false);
  // Parsed special-meal manifest rows (Flight No + Date keyed), used to attach
  // rosters on import and to validate counts against each flight's declared total.
  const [specialRows, setSpecialRows] = useState<SpecialMealUpload[]>([]);

  const [importConfirmed, setImportConfirmed] = useState(false);
  const [showFinalReview, setShowFinalReview] = useState(false);
  // Configured meal slots — the meal slot for a crew row is derived from its ETD
  // (business rule), so editing the ETD re-resolves the slot automatically.
  const slots = useMealSlots();
  const [mealEditMode, setMealEditMode] = useState(false);
  const [summaryEdit, setSummaryEdit] = useState<{
    intlDepMeal: number; intlDepChml: number; intlRetMeal: number; intlRetChml: number; intlRetVgml: number;
    usbaZenith: number; usbaPax: number; usbaBreakfast: number; usbaLunch: number;
    aaaZenith: number; aaaPax: number;
    crewHSnacks: number; crewLunch: number; crewDinner: number;
  } | null>(null);
  const [savedEdit, setSavedEdit] = useState<{
    intlDepMeal: number; intlDepChml: number; intlRetMeal: number; intlRetChml: number; intlRetVgml: number;
    usbaZenith: number; usbaPax: number; usbaBreakfast: number; usbaLunch: number;
    aaaZenith: number; aaaPax: number;
    crewHSnacks: number; crewLunch: number; crewDinner: number;
  } | null>(null);
  const [showCrewMenuModal, setShowCrewMenuModal] = useState(false);
  const [crewMenuContext, setCrewMenuContext] = useState<"intl" | "dom">("dom");
  const [showViewMenuModal, setShowViewMenuModal] = useState<"intl" | "dom" | null>(null);
  const [crewMenuQty, setCrewMenuQty] = useState({
    hSnacks: 8, lunch: 0, dinner: 4,
    bcBreakfast: 12, bcLunch: 12, ecSnack: 270, ecMeal: 0,
  });
  const [importedOrders, setImportedOrders] = useState<FlightOrder[]>([]);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderSent, setOrderSent] = useState(false);
  const [tagForwardOpen, setTagForwardOpen] = useState(false);
  const [daySelectionOpen, setDaySelectionOpen] = useState(false);
  const [pendingDay, setPendingDay] = useState("");

  // Day-of-week meal config (stable for session)
  const _d0 = new Date();
  const _d1 = new Date(_d0.getTime()); _d1.setDate(_d0.getDate() + 1);
  const _d2 = new Date(_d0.getTime()); _d2.setDate(_d0.getDate() + 2);
  const tomorrowDayName = _d1.toLocaleDateString("en-GB", { weekday: "long" });
  const tomorrowDateStr = _d1.toISOString().slice(0, 10);
  const dayAfterDayName = _d2.toLocaleDateString("en-GB", { weekday: "long" });
  const dayAfterDateStr = _d2.toISOString().slice(0, 10);
  const tomorrowMenu = WEEK_MEAL_CONFIG[_d1.getDay()];
  const dayAfterMenu = WEEK_MEAL_CONFIG[_d2.getDay()];

  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([
    { message: "Bulk upload ready for validation", user: "ops.user", role: "Flight Ops", at: "2026-05-19 06:12" },
  ]);

  const [editRow, setEditRow] = useState<{ source: "dom" | "intl" | "crew"; data: ParsedRow } | null>(null);
  // Special-meal manifest row editor — keyed by the original upload object so we
  // can patch it back into the flat specialRows list after editing.
  const [editSpecial, setEditSpecial] = useState<{ original: SpecialMealUpload; data: SpecialMealUpload } | null>(null);

  const addLog = (message: string) => {
    const now = new Date();
    setActivityLog((current) => [
      { message, user: "GM/Admin", role: "General Manager", at: `${now.toLocaleDateString()} ${now.toLocaleTimeString()}` },
      ...current,
    ]);
  };

  const anyDone = domDone || intlDone || crewDone;

  // Read the uploaded CSV; use the real parsed rows when it's our template,
  // otherwise fall back to the sample preview (e.g. a binary .xlsx).
  const runFlightUpload = (
    f: File,
    fallback: ParsedRow[],
    setFile: (v: File) => void,
    setDone: (v: boolean) => void,
    setProgress: (fn: (p: number) => number) => void,
    setParsed: (rows: ParsedRow[]) => void,
    label: string,
  ) => {
    setFile(f);
    setDone(false);
    setProgress(() => 0);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseFlightCsv(String(reader.result ?? ""));
      const rows = parsed.length > 0 ? parsed : fallback;
      setParsed(rows);
      const t = setInterval(() => {
        setProgress((p) => {
          if (p >= 100) {
            clearInterval(t);
            setDone(true);
            toast.success(`${label} file parsed — ${rows.filter((r) => r.valid).length}/${rows.length} rows valid.`);
            addLog(`${label} orders file parsed and validated`);
            return 100;
          }
          return p + 10;
        });
      }, 80);
    };
    reader.onerror = () => toast.error(`Could not read ${f.name}.`);
    reader.readAsText(f);
  };

  const startDomUpload = (f: File) =>
    runFlightUpload(f, SAMPLE_PARSED_DOM, setDomFile, setDomDone, setDomProgress, setDomParsed, "Domestic");

  const startIntlUpload = (f: File) =>
    runFlightUpload(f, SAMPLE_PARSED_INTL, setIntlFile, setIntlDone, setIntlProgress, setIntlParsed, "International");

  // Crew-meal and special-meal manifests attach to flights already created (via
  // the flight orders upload / single screen) — keyed by Flight No + Date — so
  // they parse-and-acknowledge rather than creating standalone flight rows.
  const startCrewUpload = (f: File) => {
    setCrewFile(f);
    setCrewDone(false);
    setCrewProgress(0);
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCrewCsv(String(reader.result ?? ""));
      setCrewParsed(rows);
      const t = setInterval(() => {
        setCrewProgress((p) => {
          if (p >= 100) {
            clearInterval(t);
            setCrewDone(true);
            if (rows.length === 0) {
              toast.error("No crew-meal rows found — check the file matches the Crew Meals template.");
            } else {
              toast.success(`Crew meal file parsed — ${rows.filter((r) => r.valid).length}/${rows.length} rows valid.`);
            }
            addLog(`Crew meal file parsed — ${rows.length} rows`);
            return 100;
          }
          return p + 10;
        });
      }, 80);
    };
    reader.onerror = () => toast.error(`Could not read ${f.name}.`);
    reader.readAsText(f);
  };

  const startSpecialUpload = (f: File) => {
    setSpecialFile(f);
    setSpecialDone(false);
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseSpecialCsv(String(reader.result ?? ""));
      setSpecialRows(rows);
      setSpecialDone(true);
      if (rows.length === 0) {
        toast.error("No special-meal rows found — check the file matches the Special Meals template.");
      } else {
        toast.success(`Special meal manifest parsed — ${rows.length} meal${rows.length === 1 ? "" : "s"}.`);
      }
      addLog(`Special meal manifest uploaded — ${rows.length} rows`);
    };
    reader.onerror = () => toast.error(`Could not read ${f.name}.`);
    reader.readAsText(f);
  };

  const downloadTemplate = (kind: "dom" | "intl" | "crew" | "special") => {
    // CSV columns mirror the exact ParsedRow fields the bulk-upload parser reads
    // for each flight type, with two example rows lifted from the seed dataset so
    // the file is immediately fillable against the current architecture.
    const csvCell = (v: string | number | undefined) => {
      const s = v === undefined || v === null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // Three templates, each mirroring the matching single-order screen:
    //  • Flights (Domestic / International) — flight-level only, with a Special
    //    Meals COUNT column (no per-passenger detail). Order No is system-
    //    generated, never on the sheet.
    //  • Special Meals — the per-passenger roster (PNR / Name / Seat / Code),
    //    attaching to a flight by Flight No + Date. Same shape the single
    //    screen's roster bulk-paste accepts.
    //  • Crew Meals — crew-meal order fields from the Create Crew Meal screen
    //    (Scope, Flight, Airline, sector, Date, ETD, Meal Slot, No of Crew).
    // "Trip Ref" links a round trip: put the SAME value on an outbound and its
    // return so dispatch pairs them (even when sectors are identical). Blank for
    // one-way flights.
    const FLIGHT_HEADERS = ["Scope", "Flight No", "Airline", "From", "To", "Date", "ETD", "Direction", "PAX", "No of Crew", "Special Meals", "Trip Ref"];
    const TEMPLATES: Record<typeof kind, { fileName: string; label: string; headers: string[]; rows: (string | number)[][] }> = {
      dom: {
        fileName: "domestic-flights-template.csv",
        label: "Domestic flights",
        headers: FLIGHT_HEADERS,
        rows: [
          // A round trip — same Trip Ref (T1) on the outbound and its return.
          ["Domestic", "BS-141", "US-Bangla", "DAC", "CXB", "2026-05-24", "08:15", "Outbound", 72, 4, 4, "T1"],
          ["Domestic", "BS-142", "US-Bangla", "CXB", "DAC", "2026-05-24", "14:00", "Return", 70, 4, 4, "T1"],
          ["Domestic", "BS-203", "US-Bangla", "DAC", "CGP", "2026-05-24", "10:30", "Outbound", 88, 4, 2, "T2"],
          ["Domestic", "BS-204", "US-Bangla", "CGP", "DAC", "2026-05-24", "17:30", "Return", 84, 4, 2, "T2"],
        ],
      },
      intl: {
        fileName: "international-flights-template.csv",
        label: "International flights",
        headers: FLIGHT_HEADERS,
        rows: [
          // Cross-midnight round trip — out 23:50, return 02:30 next day, same Trip Ref.
          ["International", "BS-307", "US-Bangla", "DAC", "KUL", "2026-05-24", "23:50", "Outbound", 282, 16, 18, "R1"],
          ["International", "BS-308", "US-Bangla", "KUL", "DAC", "2026-05-25", "02:30", "Return", 274, 16, 16, "R1"],
        ],
      },
      special: {
        fileName: "special-meals-template.csv",
        label: "Special meals",
        // "Audience" is optional — blank/"Passenger" = passenger special; "Crew" =
        // crew special (no PNR/Name/Seat needed, just the Meal Code).
        headers: ["Flight No", "Date", "PNR", "Passenger Name", "Seat", "Meal Code", "Audience"],
        rows: [
          ["BS-225", "2026-05-24", "RT3M9P", "Karim Chowdhury", "3A", "CHML", "Passenger"],
          ["BS-225", "2026-05-24", "LW6N2Q", "Sadia Islam", "22F", "VGML", "Passenger"],
          ["BS-225", "2026-05-24", "HB5J7D", "Imran Hossain", "30C", "MOML", "Passenger"],
          ["BS-141", "2026-05-24", "BS3X9K", "Rahim Uddin", "12C", "MOML", "Passenger"],
          ["BS-225", "2026-05-24", "", "", "", "VGML", "Crew"],
          ["BS-225", "2026-05-24", "", "", "", "MOML", "Crew"],
        ],
      },
      crew: {
        fileName: "crew-meals-template.csv",
        label: "Crew meals",
        headers: ["Scope", "Flight No", "Airline", "From", "To", "Date", "ETD", "Meal Slot", "Direction", "No of Crew"],
        // Meal Slot derived from ETD (business rule) so the sample stays consistent.
        rows: [
          ["Domestic", "BS-141", "US-Bangla", "DAC", "CXB", "2026-05-24", "08:15", resolveMealSlot("08:15", slots).name, "Outbound", 4],
          ["International", "BS-225", "US-Bangla", "DAC", "DXB", "2026-05-24", "12:30", resolveMealSlot("12:30", slots).name, "Outbound", 14],
        ],
      },
    };
    const config = TEMPLATES[kind];
    const csv = [config.headers, ...config.rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = config.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`${config.label} template downloaded.`);
  };

  const updateDomField = (rowNum: number, field: keyof ParsedRow, value: string) => {
    setDomParsed((prev) => prev.map((r) => (r.row === rowNum ? { ...r, [field]: value } : r)));
  };

  const updateIntlField = (rowNum: number, field: keyof ParsedRow, value: string) => {
    setIntlParsed((prev) => prev.map((r) => (r.row === rowNum ? { ...r, [field]: value } : r)));
  };

  // ── Special-meal manifest validation ──────────────────────────────────────
  // The uploaded roster for a flight must contain EXACTLY the number of special
  // meals that flight declares (Special Meals column) — no more, no fewer.
  const allFlightRows = useMemo(
    () => [...(domDone ? domParsed : []), ...(intlDone ? intlParsed : [])].filter((r) => r.valid),
    [domDone, domParsed, intlDone, intlParsed],
  );
  // Existing flight orders (already imported/created) grouped by Flight No + Date,
  // so a manifest can attach to flights that aren't in this upload session.
  const existingByKey = useMemo(() => {
    const m = new Map<string, FlightOrder[]>();
    for (const o of existingOrders) {
      const k = flightKey(o.flight, o.date);
      (m.get(k) ?? m.set(k, []).get(k)!).push(o);
    }
    return m;
  }, [existingOrders]);
  // Declared special-meal count per flight — from THIS session's flight upload
  // only. These are the flights subject to the strict count check on import.
  const declaredByFlight = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allFlightRows) m.set(flightKey(r.flight, r.date), r.specialMeals);
    return m;
  }, [allFlightRows]);
  // Flight details (airline / sector / etd / direction) keyed by Flight No + Date,
  // for showing each uploaded special meal alongside the flight it attaches to.
  const flightRowByKey = useMemo(() => {
    const m = new Map<string, { airline: string; sector: string; etd: string; direction?: FlightDirection; source: "upload" | "existing" }>();
    for (const [k, legs] of existingByKey) {
      const l = legs[0];
      m.set(k, { airline: l.airline, sector: l.sector, etd: l.etd, direction: l.direction, source: "existing" });
    }
    for (const r of allFlightRows) {
      m.set(flightKey(r.flight, r.date), { airline: r.airline, sector: r.sector, etd: r.etd, direction: r.direction, source: "upload" });
    }
    return m;
  }, [allFlightRows, existingByKey]);
  const uploadedByFlight = useMemo(() => {
    const m = new Map<string, SpecialMealUpload[]>();
    for (const r of specialRows) {
      const k = flightKey(r.flight, r.date);
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return m;
  }, [specialRows]);
  // Classify each manifest flight against what we know:
  //  • upload-match / upload-mismatch — flight is in THIS session's flight file
  //    (strict: roster count must equal the declared count).
  //  • existing — flight is an order already in the system (no file this session);
  //    the manifest will be attached to it, setting its special meals.
  //  • none — flight matches nothing → can't be placed.
  type ManifestStatus = { kind: "upload-match" | "upload-mismatch" | "existing" | "none"; declared: number | null; uploaded: number; legIds: string[] };
  const manifestStatus = useMemo(() => {
    const m = new Map<string, ManifestStatus>();
    for (const [k, entries] of uploadedByFlight) {
      const uploaded = entries.length;
      if (declaredByFlight.has(k)) {
        const declared = declaredByFlight.get(k)!;
        m.set(k, { kind: declared === uploaded ? "upload-match" : "upload-mismatch", declared, uploaded, legIds: [] });
      } else if (existingByKey.has(k)) {
        const legs = existingByKey.get(k)!;
        const orderQty = legs.reduce((s, l) => s + l.specialMeals, 0);
        m.set(k, { kind: "existing", declared: orderQty, uploaded, legIds: legs.map((l) => l.id) });
      } else {
        m.set(k, { kind: "none", declared: null, uploaded, legIds: [] });
      }
    }
    return m;
  }, [uploadedByFlight, declaredByFlight, existingByKey]);
  // Strict blocker for the flight-file import flow only — count must match.
  const specialMealIssues = useMemo(() => {
    if (!specialDone) return [] as { flight: string; date: string; declared: number | null; uploaded: number }[];
    const issues: { flight: string; date: string; declared: number | null; uploaded: number }[] = [];
    for (const [k, entries] of uploadedByFlight) {
      if (manifestStatus.get(k)?.kind === "upload-mismatch") {
        issues.push({ flight: entries[0].flight, date: entries[0].date, declared: declaredByFlight.get(k)!, uploaded: entries.length });
      }
    }
    return issues;
  }, [specialDone, uploadedByFlight, manifestStatus, declaredByFlight]);
  // Flights whose manifest attaches to an order already in the system.
  const attachableKeys = useMemo(
    () => Array.from(manifestStatus.entries()).filter(([, s]) => s.kind === "existing").map(([k]) => k),
    [manifestStatus],
  );

  // Attach the uploaded manifest to existing orders (the "attach to existing
  // flights" flow) — sets each matched order leg's roster + special-meal count.
  const attachToExistingOrders = () => {
    const stamp = String(Date.now()).slice(-5);
    let attached = 0;
    let pax = 0;
    for (const k of attachableKeys) {
      const entries = uploadedByFlight.get(k) ?? [];
      const legIds = manifestStatus.get(k)?.legIds ?? [];
      const roster: SpecialMealEntry[] = entries.map((m, j) => ({
        id: `SM-ATT-${stamp}-${attached}-${j}`,
        pnr: m.pnr, passengerName: m.passengerName, seat: m.seat, mealCode: m.mealCode, audience: m.audience,
      }));
      for (const legId of legIds) onAttachRoster(legId, roster);
      attached += 1;
      pax += entries.length;
    }
    if (attached === 0) {
      toast.error("No manifest flights match an existing order.");
      return;
    }
    toast.success(`Attached ${pax} special meal${pax === 1 ? "" : "s"} to ${attached} existing flight${attached === 1 ? "" : "s"}.`);
    addLog(`Special meals attached to ${attached} existing flight(s)`);
    setSpecialRows([]); setSpecialFile(null); setSpecialDone(false);
  };

  const confirmImport = () => {
    // Block import while any special-meal manifest count disagrees with the
    // declared count — the user must fix the file (or the flight) first.
    if (specialMealIssues.length > 0) {
      toast.error(
        `Import blocked — ${specialMealIssues.length} flight${specialMealIssues.length === 1 ? "" : "s"} have a special-meal count that doesn't match the uploaded manifest.`,
      );
      return;
    }
    const allParsed = [
      ...(domDone ? domParsed : []),
      ...(intlDone ? intlParsed : []),
    ];
    const valid = allParsed.filter((r) => r.valid);
    const today = new Date().toISOString().slice(0, 10);
    const stamp = String(Date.now()).slice(-5);
    // Group flights by date — each date becomes ONE order (with a system Order
    // No) carrying all that day's flights as legs, mirroring the Order
    // Management table (e.g. ORD-3514 · 34 flights).
    const byDate = new Map<string, ParsedRow[]>();
    for (const r of valid) {
      const d = r.date || today;
      (byDate.get(d) ?? byDate.set(d, []).get(d)!).push(r);
    }
    const orders: FlightOrder[] = [];
    // One Order # per date — and that date's crew order reuses the same number,
    // so a flight and its crew order share one Order #.
    const dateToOrderNo = new Map<string, string>();
    let orderIdx = 0;
    let legSeq = 0;
    for (const [date, rows] of byDate) {
      const orderNo = `ORD-${orderNoSeed + 1 + orderIdx}`;
      orderIdx += 1;
      dateToOrderNo.set(date, orderNo);
      for (const r of rows) {
        const manifest = uploadedByFlight.get(flightKey(r.flight, r.date)) ?? [];
        const roster: SpecialMealEntry[] = manifest.map((m, j) => ({
          id: `SM-IMP-${stamp}-${legSeq}-${j}`,
          pnr: m.pnr,
          passengerName: m.passengerName,
          seat: m.seat,
          mealCode: m.mealCode,
          audience: m.audience,
        }));
        orders.push({
          id: `FO-IMP-${stamp}-${legSeq++}`,
          orderNo,
          flight: r.flight,
          airline: r.airline,
          sector: r.sector,
          date: r.date || today,
          etd: r.etd,
          pax: r.pax,
          // Use the uploaded No of Crew when given; otherwise fall back to a
          // type-based default (intl flights carry a larger cabin crew).
          crew: r.crew && r.crew > 0 ? r.crew : (r.type === "International" ? 14 : 4),
          specialMeals: r.specialMeals,
          status: "Pending",
          direction: r.direction ?? "Outbound",
          orderType: "flight",
          createdAt: Date.now(),
          // Trip Ref → explicit round-trip link (scoped to this upload batch,
          // case-insensitive) so the two legs pair on dispatch regardless of
          // sector / shared Order #. Batch-scoped (not date) so a cross-midnight
          // round trip — out 23:50, return 02:30 next day — still links.
          pairId: r.tripRef?.trim() ? `TRIP-${stamp}-${r.tripRef.trim().toLowerCase()}` : undefined,
          specialMealRoster: roster.length > 0 ? roster : undefined,
        });
      }
    }
    // Crew meals — merge into the matching flight order (same flight + date +
    // direction) when one exists, so crew is a single number on the flight rather
    // than a separate row. Only crew rows with NO matching flight become their own
    // standalone crew order (orderType "crew"), grouped by date as before.
    const crewValid = crewDone ? crewParsed.filter((r) => r.valid) : [];
    const crewKey = (flight: string, date: string | undefined, dir: FlightDirection | undefined) =>
      `${flight}|${date || today}|${dir ?? "Outbound"}`;
    // Flight orders to merge into: this batch's new flight orders + existing ones.
    const batchFlightByKey = new Map<string, FlightOrder>();
    for (const o of orders) {
      if ((o.orderType ?? "flight") !== "crew") batchFlightByKey.set(crewKey(o.flight, o.date, o.direction), o);
    }
    const existingFlightByKey = new Map<string, FlightOrder>();
    for (const o of existingOrders) {
      if ((o.orderType ?? "flight") !== "crew") existingFlightByKey.set(crewKey(o.flight, o.date, o.direction), o);
    }

    const crewUpdatesExisting = new Map<string, number>(); // existing flight id → crew (latest wins)
    const standaloneCrew: ParsedRow[] = [];
    let mergedCount = 0;
    for (const r of crewValid) {
      const k = crewKey(r.flight, r.date, r.direction);
      const batchHit = batchFlightByKey.get(k);
      if (batchHit) { batchHit.crew = r.crew ?? 0; mergedCount += 1; continue; }
      const existHit = existingFlightByKey.get(k);
      if (existHit) { crewUpdatesExisting.set(existHit.id, r.crew ?? 0); mergedCount += 1; continue; }
      standaloneCrew.push(r);
    }

    // Standalone crew rows (no matching flight) → their own crew orders by date.
    const standaloneByDate = new Map<string, ParsedRow[]>();
    for (const r of standaloneCrew) {
      const d = r.date || today;
      (standaloneByDate.get(d) ?? standaloneByDate.set(d, []).get(d)!).push(r);
    }
    let crewOrderCount = 0;
    for (const [date, rows] of standaloneByDate) {
      // Reuse the flight order's number for the same date so the crew order
      // shares the Order #. Mint a new one only if that date has no flight order.
      let orderNo = dateToOrderNo.get(date);
      if (!orderNo) {
        orderNo = `ORD-${orderNoSeed + 1 + orderIdx}`;
        orderIdx += 1;
        dateToOrderNo.set(date, orderNo);
      }
      crewOrderCount += 1;
      for (const r of rows) {
        orders.push({
          id: `FO-IMP-${stamp}-${legSeq++}`,
          orderNo,
          flight: r.flight,
          airline: r.airline,
          sector: r.sector,
          date: r.date || today,
          etd: r.etd,
          pax: 0,
          crew: r.crew ?? 0,
          specialMeals: 0,
          status: "Pending",
          direction: r.direction ?? "Outbound",
          orderType: "crew",
          createdAt: Date.now(),
        });
      }
    }
    // Trip Ref sanity check — each ref should tag exactly one outbound + one
    // return. Surface typos (a ref on 3+ legs, or two same-direction legs) so
    // they're caught before they mispair on dispatch. Import still proceeds.
    const tripGroups = new Map<string, ParsedRow[]>();
    for (const r of valid) {
      const t = r.tripRef?.trim().toLowerCase();
      if (t) (tripGroups.get(t) ?? tripGroups.set(t, []).get(t)!).push(r);
    }
    const tripIssues: string[] = [];
    for (const rows of tripGroups.values()) {
      const outs = rows.filter((r) => (r.direction ?? "Outbound") === "Outbound").length;
      const rets = rows.length - outs;
      if (rows.length !== 2 || outs !== 1 || rets !== 1) {
        tripIssues.push(`"${rows[0].tripRef}" (${rows.length} legs: ${outs} out / ${rets} return)`);
      }
    }
    if (tripIssues.length > 0) {
      toast.warning(`Check Trip Ref pairing — ${tripIssues.join(", ")}. Each Trip Ref should tag one outbound + one return.`);
    }

    setImportedOrders(orders);
    setImportConfirmed(true);
    // Persist into the Order Management table immediately, with system Order Nos.
    onPersistOrders(orders);
    // Apply crew merges onto flight orders that already existed in the store.
    crewUpdatesExisting.forEach((crew, id) => onUpdateCrew(id, crew));
    const orderCount = orderIdx;
    const crewBits = [
      mergedCount > 0 ? `${mergedCount} crew merged` : "",
      crewOrderCount > 0 ? `${crewOrderCount} crew order${crewOrderCount === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(", ");
    const crewNote = crewBits ? ` (incl. ${crewBits})` : "";
    addLog(`Imported ${orderCount} order${orderCount === 1 ? "" : "s"} (${orders.length} flights) into Order Management${crewNote}`);
    toast.success(`${orderCount} order${orderCount === 1 ? "" : "s"} (${orders.length} flights) added to Order Management${crewNote}.`);
  };

  // Summary values derived from parsed data
  const validDom = domDone ? domParsed.filter((r) => r.valid) : [];
  const validIntl = intlDone ? intlParsed.filter((r) => r.valid) : [];
  const usbaDom = validDom.filter((r) => r.airline === "US-Bangla");
  const aaaDom = validDom.filter((r) => r.airline === "Air Astra");
  const usbaZenith = usbaDom.reduce((s, r) => s + (r.zenLoad ?? 0), 0);
  const usbaPax = usbaDom.reduce((s, r) => s + r.pax, 0);
  const usbaBreakfast = usbaDom.filter((r) => r.etd <= "10:30").reduce((s, r) => s + (r.totalMeal ?? 0), 0);
  const usbaLunch = usbaDom.filter((r) => r.etd > "10:30" && r.etd <= "14:30").reduce((s, r) => s + (r.totalMeal ?? 0), 0);
  const aaaZenith = aaaDom.reduce((s, r) => s + r.pax, 0);
  const aaaPax = aaaDom.reduce((s, r) => s + r.pax, 0);
  const totalZenith = usbaZenith + aaaZenith;
  const crewHSnacks = validDom.filter((r) => r.etd <= "10:30").reduce((s, r) => s + (r.crewMeal ?? 0), 0);
  const crewLunch = validDom.filter((r) => r.etd > "10:30" && r.etd <= "14:30").reduce((s, r) => s + (r.crewMeal ?? 0), 0);
  const crewDinner = validDom.filter((r) => r.etd > "14:30").reduce((s, r) => s + (r.crewMeal ?? 0), 0);
  const intlDepMeal = validIntl.reduce((s, r) => s + (r.bcMeal ?? 0) + (r.ecMeal ?? 0), 0);
  const intlDepChml = validIntl.reduce((s, r) => s + (r.chml ?? 0), 0);
  const intlDepTotal = intlDepMeal + intlDepChml;
  const intlRetVgml = validIntl.reduce((s, r) => s + (r.vgml ?? 0), 0);
  const intlRetTotal = intlRetVgml;
  const intlGrandTotal = intlDepTotal + intlRetTotal;
  const totalFlights = importedOrders.length;
  const totalMeals = importedOrders.reduce((s, o) => s + o.pax + o.specialMeals, 0);
  const importDate = new Date().toISOString().slice(0, 10);

  const handleOrderMeal = (onComplete?: () => void) => {
    setOrderLoading(true);
    setTimeout(() => {
      setOrderLoading(false);
      setOrderSent(true);
      const _ts = new Date();
      const ts = _ts.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const refId = `OMR-${Date.now().toString().slice(-6)}`;
      addLog(
        `Meal order for next 24 hours has been created and forwarded to Menu Planner — Ref: ${refId} · ${totalFlights} flights · ${totalMeals} meals · Confirmed by system`,
      );
      const confirmationData = { timestamp: ts, totalFlights, totalMeals, tomorrowDayName, dayAfterDayName, dayAfterDateStr, validIntl, validDom, dayAfterMenu };
      onOrderConfirmed?.(confirmationData);
      // Orders were already persisted to the table in confirmImport; here we
      // only forward the meal plan to Production.
      toast.success("Menu plan tagged and forwarded to Production.");
      onComplete?.();
      navigate("/production-entry", { state: { mealOrderConfirmation: confirmationData } });
    }, 1500);
  };

  const domValidCount = domParsed.filter((r) => r.valid).length;
  const domInvalidCount = domParsed.length - domValidCount;
  const intlValidCount = intlParsed.filter((r) => r.valid).length;
  const intlInvalidCount = intlParsed.length - intlValidCount;
  const crewValidCount = crewParsed.filter((r) => r.valid).length;
  const crewInvalidCount = crewParsed.length - crewValidCount;
  const allInvalidCount = (domDone ? domInvalidCount : 0) + (intlDone ? intlInvalidCount : 0) + (crewDone ? crewInvalidCount : 0);

  return (
    <div className="space-y-6">
      {/* Upload section */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Bulk Upload
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download className="h-3.5 w-3.5 mr-1.5" /> Sample Template
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Flight Orders</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => downloadTemplate("dom")}>
                    Domestic Flights (.csv)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => downloadTemplate("intl")}>
                    International Flights (.csv)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Meal Manifests</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => downloadTemplate("special")}>
                    Special Meals (.csv)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => downloadTemplate("crew")}>
                    Crew Meals (.csv)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <History className="h-3.5 w-3.5 mr-1.5" /> Upload History
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {recentUploads.map((u) => (
                    <DropdownMenuItem key={u.id} className="flex justify-between">
                      <span className="truncate">{u.file}</span>
                      <span className="text-xs text-muted-foreground ml-2">{u.at.split(" ")[0]}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <input
            ref={domFileRef}
            type="file"
            accept=".xlsx,.xls,.csv,.doc,.docx"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) startDomUpload(f); }}
          />
          <input
            ref={intlFileRef}
            type="file"
            accept=".xlsx,.xls,.csv,.doc,.docx"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) startIntlUpload(f); }}
          />
          <input
            ref={crewFileRef}
            type="file"
            accept=".xlsx,.xls,.csv,.doc,.docx"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) startCrewUpload(f); }}
          />
          <input
            ref={specialFileRef}
            type="file"
            accept=".xlsx,.xls,.csv,.doc,.docx"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) startSpecialUpload(f); }}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Domestic upload slot */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) startDomUpload(f); }}
              className="rounded-lg border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 to-transparent py-8 text-center"
            >
              <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 grid place-items-center mb-3">
                <FileSpreadsheet className="h-6 w-6 text-primary" />
              </div>
              <h4 className="text-sm font-semibold">Domestic Flights</h4>
              <Button size="sm" className="mt-3" onClick={() => domFileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Select File
              </Button>
              {domFile && (
                <div className="mt-4 max-w-xs mx-auto text-left px-4">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium truncate">{domFile.name}</span>
                    <span className="text-muted-foreground">{domProgress}%</span>
                  </div>
                  <Progress value={domProgress} />
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                    {domDone ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        <span className={domInvalidCount > 0 ? "text-warning" : "text-success"}>
                          {domValidCount}/{domParsed.length} rows valid
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Parsing…</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* International upload slot */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) startIntlUpload(f); }}
              className="rounded-lg border-2 border-dashed border-navy/30 bg-gradient-to-br from-navy/5 to-transparent py-8 text-center"
            >
              <div className="mx-auto h-12 w-12 rounded-full bg-navy/10 grid place-items-center mb-3">
                <FileSpreadsheet className="h-6 w-6 text-navy" />
              </div>
              <h4 className="text-sm font-semibold">International Flights</h4>
              <Button size="sm" variant="outline" className="mt-3 border-navy/30 text-navy hover:bg-navy/5" onClick={() => intlFileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Select File
              </Button>
              {intlFile && (
                <div className="mt-4 max-w-xs mx-auto text-left px-4">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium truncate">{intlFile.name}</span>
                    <span className="text-muted-foreground">{intlProgress}%</span>
                  </div>
                  <Progress value={intlProgress} />
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                    {intlDone ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        <span className={intlInvalidCount > 0 ? "text-warning" : "text-success"}>
                          {intlValidCount}/{intlParsed.length} rows valid
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Parsing…</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Meal manifests — attach to flights already in the system by Flight No + Date. */}
          <div className="mt-6 pt-5 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Meal Manifests</h4>
              <span className="text-[11px] text-muted-foreground">— crew meals import as crew orders; special meals attach to existing flights (matched by Flight No + Date)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Crew Meals upload slot */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) startCrewUpload(f); }}
                className="rounded-lg border-2 border-dashed border-amber-400/40 bg-gradient-to-br from-amber-50 to-transparent py-8 text-center"
              >
                <div className="mx-auto h-12 w-12 rounded-full bg-amber-100 grid place-items-center mb-3">
                  <Users className="h-6 w-6 text-amber-600" />
                </div>
                <h4 className="text-sm font-semibold">Crew Meals</h4>
                <Button size="sm" variant="outline" className="mt-3 border-amber-400/40 text-amber-700 hover:bg-amber-50" onClick={() => crewFileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5 mr-1" /> Select File
                </Button>
                {crewFile && (
                  <div className="mt-4 max-w-xs mx-auto text-left px-4">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium truncate">{crewFile.name}</span>
                      <span className="text-muted-foreground">{crewProgress}%</span>
                    </div>
                    <Progress value={crewProgress} />
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                      {crewDone ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          <span className={crewInvalidCount > 0 ? "text-warning" : "text-success"}>
                            {crewValidCount}/{crewParsed.length} rows valid
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Parsing…</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Special Meals upload slot */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) startSpecialUpload(f); }}
                className="rounded-lg border-2 border-dashed border-emerald-400/40 bg-gradient-to-br from-emerald-50 to-transparent py-8 text-center"
              >
                <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 grid place-items-center mb-3">
                  <Utensils className="h-6 w-6 text-emerald-600" />
                </div>
                <h4 className="text-sm font-semibold">Special Meals</h4>
                <Button size="sm" variant="outline" className="mt-3 border-emerald-400/40 text-emerald-700 hover:bg-emerald-50" onClick={() => specialFileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5 mr-1" /> Select File
                </Button>
                {specialFile && (
                  <div className="mt-4 max-w-xs mx-auto text-left px-4">
                    <div className="flex items-center gap-1.5 text-xs">
                      {specialDone ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          <span className="font-medium truncate">{specialFile.name}</span>
                          <span className="text-success ml-auto">received</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Uploading…</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {domDone && !intlDone && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              International file not uploaded — only Domestic flights will be included. You can upload it above to include International flights.
            </p>
          )}
          {intlDone && !domDone && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Domestic file not uploaded — only International flights will be included. You can upload it above to include Domestic flights.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Per-file preview — Domestic */}
      {domDone && !importConfirmed && !showFinalReview && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary uppercase tracking-wider">
                  Domestic Flights
                </span>
              </div>
              {domInvalidCount > 0 && (
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5 text-warning mr-1" />
                  {domInvalidCount} invalid row{domInvalidCount > 1 ? "s" : ""} highlighted
                </span>
              )}
            </div>
            <div className="space-y-3">
              {groupByDate(domParsed).map(({ date, rows: dayRows }) => (
                <div key={date} className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow className="bg-primary/5 border-b border-primary/20 hover:bg-primary/5">
                        <TableHead colSpan={8} className="py-2">
                          <span className="text-sm font-bold text-primary">{formatDayLabel(date)}</span>
                          <span className="ml-2 inline-flex items-center rounded-md border border-border bg-white px-2 py-[2px] text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            {dayRows.length} flight{dayRows.length === 1 ? "" : "s"}
                          </span>
                          <span className="ml-1.5 text-[10px] text-muted-foreground">→ imports as one order</span>
                        </TableHead>
                      </TableRow>
                      <TableRow>
                        <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Airline</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">ETD</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Pax</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Spec. Meals</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dayRows.map((r) => (
                        <TableRow key={`dom-${r.row}`} className={!r.valid ? "bg-destructive/10" : ""}>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center rounded-[7px] bg-[#2a2528] px-[9px] py-1 text-xs font-bold tabular-nums text-white">{r.flight || "—"}</span>
                              {r.direction && <DirectionBadge direction={r.direction} />}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{r.airline}</TableCell>
                          <TableCell className="text-xs">{r.sector}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.date}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.etd}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.pax}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.specialMeals > 0 ? r.specialMeals : "—"}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <StatusBadge status={r.valid ? "OK" : "Failed"} />
                              <Button size="sm" variant="outline" className="h-6 px-2 text-xs"
                                onClick={() => setEditRow({ source: "dom", data: { ...r } })}>
                                <Pencil className="h-3 w-3 mr-1" />Edit
                              </Button>
                              <Button size="sm" variant="outline" title="Delete row"
                                className="h-6 px-2 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                                onClick={() => setDomParsed((prev) => prev.filter((x) => x.row !== r.row))}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-file preview — International */}
      {intlDone && !importConfirmed && !showFinalReview && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center rounded-md bg-navy/10 px-2.5 py-1 text-xs font-semibold text-navy uppercase tracking-wider">
                  International Flights
                </span>
              </div>
              {intlInvalidCount > 0 && (
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5 text-warning mr-1" />
                  {intlInvalidCount} invalid row{intlInvalidCount > 1 ? "s" : ""} highlighted
                </span>
              )}
            </div>
            <div className="space-y-3">
              {groupByDate(intlParsed).map(({ date, rows: dayRows }) => (
                <div key={date} className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow className="bg-navy/5 border-b border-navy/20 hover:bg-navy/5">
                        <TableHead colSpan={8} className="py-2">
                          <span className="text-sm font-bold text-navy">{formatDayLabel(date)}</span>
                          <span className="ml-2 inline-flex items-center rounded-md border border-border bg-white px-2 py-[2px] text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            {dayRows.length} flight{dayRows.length === 1 ? "" : "s"}
                          </span>
                          <span className="ml-1.5 text-[10px] text-muted-foreground">→ imports as one order</span>
                        </TableHead>
                      </TableRow>
                      <TableRow>
                        <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Airline</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">ETD</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Pax</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Spec. Meals</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dayRows.map((r) => (
                        <TableRow key={`intl-${r.row}`} className={!r.valid ? "bg-destructive/10" : ""}>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center rounded-[7px] bg-[#2a2528] px-[9px] py-1 text-xs font-bold tabular-nums text-white">{r.flight || "—"}</span>
                              {r.direction && <DirectionBadge direction={r.direction} />}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{r.airline}</TableCell>
                          <TableCell className="text-xs">{r.sector}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.date}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.etd}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.pax}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.specialMeals > 0 ? r.specialMeals : "—"}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <StatusBadge status={r.valid ? "OK" : "Failed"} />
                              <Button size="sm" variant="outline" className="h-6 px-2 text-xs"
                                onClick={() => setEditRow({ source: "intl", data: { ...r } })}>
                                <Pencil className="h-3 w-3 mr-1" />Edit
                              </Button>
                              <Button size="sm" variant="outline" title="Delete row"
                                className="h-6 px-2 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                                onClick={() => setIntlParsed((prev) => prev.filter((x) => x.row !== r.row))}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-file preview — Crew Meals (one crew order per date, like flights) */}
      {crewDone && !importConfirmed && !showFinalReview && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <span className="inline-flex items-center rounded-md bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 uppercase tracking-wider">
                Crew Meals
              </span>
              {crewInvalidCount > 0 && (
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5 text-warning mr-1" />
                  {crewInvalidCount} invalid row{crewInvalidCount > 1 ? "s" : ""} highlighted
                </span>
              )}
            </div>
            <div className="space-y-3">
              {groupByDate(crewParsed).map(({ date, rows: dayRows }) => (
                <div key={date} className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow className="bg-amber-50/60 border-b border-amber-200/60 hover:bg-amber-50/60">
                        <TableHead colSpan={8} className="py-2">
                          <span className="text-sm font-bold text-amber-700">{formatDayLabel(date)}</span>
                          <span className="ml-2 inline-flex items-center rounded-md border border-border bg-white px-2 py-[2px] text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            {dayRows.length} flight{dayRows.length === 1 ? "" : "s"}
                          </span>
                          <span className="ml-1.5 text-[10px] text-muted-foreground">→ imports as one crew order</span>
                        </TableHead>
                      </TableRow>
                      <TableRow>
                        <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Airline</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">ETD</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Meal Slot</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Crew</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dayRows.map((r) => (
                        <TableRow key={`crew-${r.row}`} className={!r.valid ? "bg-destructive/10" : ""}>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center rounded-[7px] bg-[#2a2528] px-[9px] py-1 text-xs font-bold tabular-nums text-white">{r.flight || "—"}</span>
                              {r.direction && <DirectionBadge direction={r.direction} />}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{r.airline}</TableCell>
                          <TableCell className="text-xs">{r.sector}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.date}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.etd}</TableCell>
                          <TableCell className="text-xs">{r.mealSlot || "—"}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.crew ?? 0}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <StatusBadge status={r.valid ? "OK" : "Failed"} />
                              <Button size="sm" variant="outline" className="h-6 px-2 text-xs"
                                onClick={() => setEditRow({ source: "crew", data: { ...r } })}>
                                <Pencil className="h-3 w-3 mr-1" />Edit
                              </Button>
                              <Button size="sm" variant="outline" title="Delete row"
                                className="h-6 px-2 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                                onClick={() => setCrewParsed((prev) => prev.filter((x) => x.row !== r.row))}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Special-meal manifest preview — each uploaded passenger grouped under
          the flight it attaches to (Flight No + Date), with that flight's
          details and a declared-vs-uploaded count check. */}
      {specialDone && specialRows.length > 0 && !importConfirmed && !showFinalReview && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 uppercase tracking-wider">
                  Special Meals
                </span>
                <span className="text-xs text-muted-foreground">
                  {specialRows.length} special meal{specialRows.length === 1 ? "" : "s"}
                  {specialRows.some((r) => r.audience === "Crew") && ` (incl. ${specialRows.filter((r) => r.audience === "Crew").length} crew)`}
                  {" "}· {uploadedByFlight.size} flight{uploadedByFlight.size === 1 ? "" : "s"} — attach to flights by Flight No + Date
                </span>
              </div>
              {attachableKeys.length > 0 && (
                <Button size="sm" onClick={attachToExistingOrders}>
                  <Utensils className="h-3.5 w-3.5 mr-1.5" />
                  Attach to {attachableKeys.length} existing flight{attachableKeys.length === 1 ? "" : "s"}
                </Button>
              )}
            </div>
            <div className="space-y-3">
              {Array.from(uploadedByFlight.entries()).map(([key, entries]) => {
                const fr = flightRowByKey.get(key);
                const st = manifestStatus.get(key);
                const codeCounts = new Map<string, number>();
                entries.forEach((e) => codeCounts.set(e.mealCode, (codeCounts.get(e.mealCode) ?? 0) + 1));
                const badge =
                  st?.kind === "upload-match" ? { cls: "bg-success/15 text-success border-success/40", text: `Order ${st.declared} · attached ${entries.length}` }
                  : st?.kind === "upload-mismatch" ? { cls: "bg-destructive/15 text-destructive border-destructive/40", text: `Order ${st.declared} · attached ${entries.length} — mismatch` }
                  : st?.kind === "existing" ? { cls: "bg-sky-100 text-sky-700 border-sky-300", text: `Order ${st.declared} · attaching ${entries.length}` }
                  : { cls: "bg-muted text-muted-foreground", text: `${entries.length} uploaded · no matching flight` };
                return (
                  <div key={key} className="border border-border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow className="bg-emerald-50/60 border-b border-emerald-200/60 hover:bg-emerald-50/60">
                          <TableHead colSpan={7} className="py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center rounded-[7px] bg-[#2a2528] px-[9px] py-1 text-xs font-bold tabular-nums text-white">{entries[0].flight}</span>
                              {fr?.direction && <DirectionBadge direction={fr.direction} />}
                              <span className="text-xs font-medium text-foreground">
                                {fr ? `${fr.airline} · ${fr.sector} · ${fr.etd}` : "no matching flight — upload its flight order, or it must already exist"}
                              </span>
                              <span className="text-[11px] text-muted-foreground tabular-nums">{entries[0].date}</span>
                              <Badge variant="outline" className={cn("ml-auto h-5 px-1.5 text-[10px] tabular-nums", badge.cls)}>
                                {badge.text}
                              </Badge>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {Array.from(codeCounts.entries()).map(([code, n]) => (
                                <Badge key={code} variant="outline" className="h-5 px-1.5 text-[10px] font-mono" title={SPECIAL_MEAL_BY_CODE[code]?.name ?? code}>
                                  {code} · {n}
                                </Badge>
                              ))}
                            </div>
                          </TableHead>
                        </TableRow>
                        <TableRow>
                          <TableHead className="text-xs uppercase tracking-wider w-10">#</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider w-24">For</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">PNR</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Passenger</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Seat</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Meal</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entries.map((e, i) => {
                          const crew = e.audience === "Crew";
                          return (
                          <TableRow key={`${key}-${i}`}>
                            <TableCell className="text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", crew ? "bg-purple-100 text-purple-700 border-purple-300" : "bg-slate-100 text-slate-600 border-slate-300")}>
                                {crew ? "Crew" : "Passenger"}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{e.pnr || "—"}</TableCell>
                            <TableCell className="text-xs">{crew ? "Any crew member" : (e.passengerName || "—")}</TableCell>
                            <TableCell className="font-mono text-xs tabular-nums">{e.seat || "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono" title={SPECIAL_MEAL_BY_CODE[e.mealCode]?.name ?? e.mealCode}>
                                {e.mealCode}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <Button size="sm" variant="outline" className="h-6 px-2 text-xs"
                                  onClick={() => setEditSpecial({ original: e, data: { ...e } })}>
                                  <Pencil className="h-3 w-3 mr-1" />Edit
                                </Button>
                                <Button size="sm" variant="outline" title="Delete row"
                                  className="h-6 px-2 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                                  onClick={() => setSpecialRows((prev) => prev.filter((x) => x !== e))}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Special-meal manifest validation — the uploaded roster count for each
          flight must equal that flight's declared Special Meals count. */}
      {specialDone && anyDone && !importConfirmed && !showFinalReview && (
        <div className={"rounded-lg border px-4 py-3 " + (specialMealIssues.length > 0 ? "border-destructive/40 bg-destructive/5" : "border-success/40 bg-success/5")}>
          <div className="flex items-center gap-2 mb-1">
            {specialMealIssues.length > 0 ? (
              <AlertCircle className="h-4 w-4 text-destructive" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-success" />
            )}
            <span className="text-sm font-semibold">
              Special Meals — {specialRows.length} meal{specialRows.length === 1 ? "" : "s"} across {uploadedByFlight.size} flight{uploadedByFlight.size === 1 ? "" : "s"}
            </span>
          </div>
          {specialMealIssues.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-xs text-destructive">
              {specialMealIssues.map((iss) => (
                <li key={`${iss.flight}-${iss.date}`}>
                  <span className="font-mono font-medium">{iss.flight}</span> ({iss.date}) —{" "}
                  {iss.declared === null
                    ? `no matching flight in the uploaded orders (${iss.uploaded} meal${iss.uploaded === 1 ? "" : "s"} in manifest)`
                    : `declares ${iss.declared} special meal${iss.declared === 1 ? "" : "s"} but manifest has ${iss.uploaded} — counts must match exactly.`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-success">All manifest counts match each flight's declared Special Meals total. Ready to import.</p>
          )}
        </div>
      )}

      {/* Confirm Import — available when at least one file is done */}
      {anyDone && !importConfirmed && !showFinalReview && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => toast.success("Error report downloaded.")}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Error Report
          </Button>
          <Button
            disabled={specialMealIssues.length > 0}
            onClick={() => {
              const invalidCount = allInvalidCount;
              if (invalidCount > 0) {
                toast.error(
                  `Import blocked — ${invalidCount} invalid row${invalidCount !== 1 ? "s" : ""} must be fixed before proceeding. Use the Edit button on highlighted rows.`,
                );
                return;
              }
              if (specialMealIssues.length > 0) {
                toast.error("Import blocked — special-meal manifest counts don't match the declared totals.");
                return;
              }
              setShowFinalReview(true);
            }}
          >Confirm Import</Button>
        </div>
      )}

      {/* Final review — combined read-only table + Save and Continue */}
      {showFinalReview && !importConfirmed && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
                Final Review
              </h3>
              {allInvalidCount > 0 && (
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5 text-warning mr-1" />
                  {allInvalidCount} invalid row{allInvalidCount > 1 ? "s" : ""} highlighted
                </span>
              )}
            </div>
            <div className="border border-border rounded-md overflow-hidden overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Airline</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">ETD</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">Pax</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">Spec. Meals</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domDone && (
                    <>
                      <TableRow className="bg-primary/5 border-t-2 border-t-primary/40 hover:bg-primary/10">
                        <TableCell colSpan={8} className="py-2">
                          <span className="font-semibold text-primary uppercase tracking-wider text-xs">Domestic</span>
                        </TableCell>
                      </TableRow>
                      {domParsed.map((r) => (
                        <TableRow key={`final-dom-${r.row}`} className={!r.valid ? "bg-destructive/10" : ""}>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center rounded-[7px] bg-[#2a2528] px-[9px] py-1 text-xs font-bold tabular-nums text-white">{r.flight || "—"}</span>
                              {r.direction && <DirectionBadge direction={r.direction} />}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{r.airline}</TableCell>
                          <TableCell className="text-xs">{r.sector}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.date}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.etd}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.pax}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.specialMeals > 0 ? r.specialMeals : "—"}</TableCell>
                          <TableCell><StatusBadge status={r.valid ? "OK" : "Failed"} /></TableCell>
                        </TableRow>
                      ))}
                    </>
                  )}
                  {intlDone && (
                    <>
                      <TableRow className="bg-navy/5 border-t-2 border-t-navy/40 hover:bg-navy/10">
                        <TableCell colSpan={8} className="py-2">
                          <span className="font-semibold text-navy uppercase tracking-wider text-xs">International</span>
                        </TableCell>
                      </TableRow>
                      {intlParsed.map((r) => (
                        <TableRow key={`final-intl-${r.row}`} className={!r.valid ? "bg-destructive/10" : ""}>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center rounded-[7px] bg-[#2a2528] px-[9px] py-1 text-xs font-bold tabular-nums text-white">{r.flight || "—"}</span>
                              {r.direction && <DirectionBadge direction={r.direction} />}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{r.airline}</TableCell>
                          <TableCell className="text-xs">{r.sector}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.date}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.etd}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.pax}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.specialMeals > 0 ? r.specialMeals : "—"}</TableCell>
                          <TableCell><StatusBadge status={r.valid ? "OK" : "Failed"} /></TableCell>
                        </TableRow>
                      ))}
                    </>
                  )}
                  {crewDone && crewParsed.length > 0 && (
                    <>
                      <TableRow className="bg-amber-50 border-t-2 border-t-amber-300 hover:bg-amber-50">
                        <TableCell colSpan={8} className="py-2">
                          <span className="font-semibold text-amber-700 uppercase tracking-wider text-xs">Crew Meals</span>
                        </TableCell>
                      </TableRow>
                      {crewParsed.map((r) => (
                        <TableRow key={`final-crew-${r.row}`} className={!r.valid ? "bg-destructive/10" : ""}>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center rounded-[7px] bg-[#2a2528] px-[9px] py-1 text-xs font-bold tabular-nums text-white">{r.flight || "—"}</span>
                              {r.direction && <DirectionBadge direction={r.direction} />}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{r.airline}</TableCell>
                          <TableCell className="text-xs">{r.sector}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.date}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.etd}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.crew ?? 0} crew</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                          <TableCell><StatusBadge status={r.valid ? "OK" : "Failed"} /></TableCell>
                        </TableRow>
                      ))}
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end mt-4">
              <Button onClick={confirmImport}>Save and Continue</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit failed row dialog */}
      <Dialog open={editRow !== null} onOpenChange={(open) => { if (!open) setEditRow(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Row — {editRow?.data.flight}</DialogTitle>
          </DialogHeader>
          {editRow && (
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="col-span-2">
                <Label className="text-xs">Flight No</Label>
                <Input className="mt-1 h-8 text-sm" value={editRow.data.flight}
                  onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, flight: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-xs">Sector</Label>
                <Input className="mt-1 h-8 text-sm" value={editRow.data.sector}
                  onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, sector: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-xs">DEP Time</Label>
                <Input className="mt-1 h-8 text-sm" value={editRow.data.etd}
                  onChange={(e) => {
                    const etd = e.target.value;
                    setEditRow((prev) => prev && ({
                      ...prev,
                      data: {
                        ...prev.data,
                        etd,
                        // Crew meal slot follows the ETD (business rule).
                        ...(prev.source === "crew" && etd ? { mealSlot: resolveMealSlot(etd, slots).name } : {}),
                      },
                    }));
                  }} />
              </div>
              {editRow.source === "crew" ? (
                <>
                  <div>
                    <Label className="text-xs">Airline</Label>
                    <Input className="mt-1 h-8 text-sm" value={editRow.data.airline}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, airline: e.target.value } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Meal Slot <span className="text-muted-foreground normal-case">(auto from ETD)</span></Label>
                    <Input className="mt-1 h-8 text-sm bg-muted/40" value={editRow.data.mealSlot ?? ""} readOnly tabIndex={-1} />
                  </div>
                  <div>
                    <Label className="text-xs">Crew</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.crew ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, crew: Number(e.target.value) } }))} />
                  </div>
                </>
              ) : editRow.source === "dom" ? (
                <>
                  <div>
                    <Label className="text-xs">ZEN Load</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.zenLoad ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, zenLoad: Number(e.target.value), totalMeal: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">SPEC MEAL</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.specMeal ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, specMeal: Number(e.target.value), specialMeals: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">CREW MEAL</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.crewMeal ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, crewMeal: Number(e.target.value) } }))} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label className="text-xs">PAX</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.pax ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, pax: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">CHML</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.chml ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, chml: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">VGML</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.vgml ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, vgml: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">SPEC MEAL</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.specMeal ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, specMeal: Number(e.target.value), specialMeals: Number(e.target.value) } }))} />
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={() => {
              if (!editRow) return;
              const updated = { ...editRow.data, valid: true,
                pax: editRow.source === "dom"
                  ? (editRow.data.zenLoad ?? editRow.data.pax)
                  : editRow.source === "crew"
                  ? 0
                  // International: PAX is edited directly (cabin B/C + E/C loads
                  // keep it in sync). Don't recompute from cabin loads — uploaded
                  // rows have no bcLoad/ecLoad and that would wipe PAX to 0.
                  : editRow.data.pax,
              };
              if (editRow.source === "dom") {
                setDomParsed((prev) => prev.map((r) => r.row === updated.row ? updated : r));
              } else if (editRow.source === "crew") {
                setCrewParsed((prev) => prev.map((r) => r.row === updated.row ? updated : r));
              } else {
                setIntlParsed((prev) => prev.map((r) => r.row === updated.row ? updated : r));
              }
              setEditRow(null);
              toast.success(`Row ${updated.row} updated and marked valid.`);
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Special-Meal Manifest Row */}
      <Dialog open={editSpecial !== null} onOpenChange={(open) => { if (!open) setEditSpecial(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Special Meal — {editSpecial?.data.flight}</DialogTitle>
          </DialogHeader>
          {editSpecial && (
            <div className="grid grid-cols-2 gap-3 py-2">
              <div>
                <Label className="text-xs">Flight No</Label>
                <Input className="mt-1 h-8 text-sm" value={editSpecial.data.flight}
                  onChange={(e) => setEditSpecial((p) => p && ({ ...p, data: { ...p.data, flight: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-xs">Date</Label>
                <Input className="mt-1 h-8 text-sm" value={editSpecial.data.date}
                  onChange={(e) => setEditSpecial((p) => p && ({ ...p, data: { ...p.data, date: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-xs">For</Label>
                <select
                  className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={editSpecial.data.audience}
                  onChange={(e) => setEditSpecial((p) => p && ({ ...p, data: { ...p.data, audience: e.target.value as "Passenger" | "Crew" } }))}
                >
                  <option value="Passenger">Passenger</option>
                  <option value="Crew">Crew</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Meal Code</Label>
                <select
                  className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={editSpecial.data.mealCode}
                  onChange={(e) => setEditSpecial((p) => p && ({ ...p, data: { ...p.data, mealCode: e.target.value } }))}
                >
                  {SPECIAL_MEAL_CODES.map((m) => (
                    <option key={m.code} value={m.code}>{m.code} — {m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">PNR</Label>
                <Input className="mt-1 h-8 text-sm" value={editSpecial.data.pnr}
                  disabled={editSpecial.data.audience === "Crew"}
                  onChange={(e) => setEditSpecial((p) => p && ({ ...p, data: { ...p.data, pnr: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-xs">Seat</Label>
                <Input className="mt-1 h-8 text-sm" value={editSpecial.data.seat}
                  disabled={editSpecial.data.audience === "Crew"}
                  onChange={(e) => setEditSpecial((p) => p && ({ ...p, data: { ...p.data, seat: e.target.value } }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Passenger Name</Label>
                <Input className="mt-1 h-8 text-sm" value={editSpecial.data.passengerName}
                  disabled={editSpecial.data.audience === "Crew"}
                  onChange={(e) => setEditSpecial((p) => p && ({ ...p, data: { ...p.data, passengerName: e.target.value } }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSpecial(null)}>Cancel</Button>
            <Button onClick={() => {
              if (!editSpecial) return;
              const { original, data } = editSpecial;
              setSpecialRows((prev) => prev.map((r) => (r === original ? { ...data } : r)));
              setEditSpecial(null);
              toast.success(`Special meal for ${data.flight} updated.`);
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Menu Modal */}
      <Dialog open={showViewMenuModal !== null} onOpenChange={(open) => { if (!open) setShowViewMenuModal(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {showViewMenuModal === "intl" ? "International" : "Domestic"} Menu — {tomorrowDayName}, {tomorrowDateStr}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {showViewMenuModal === "intl" ? (
              <>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-navy mb-2">Departure Meals</div>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Meal Type</th>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                          <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Departure Meal</td>
                          <td className="px-3 py-2">{tomorrowMenu?.intl.depMealName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.intlDepMeal ?? intlDepMeal}</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Departure CHML</td>
                          <td className="px-3 py-2">{tomorrowMenu?.intl.depChmlName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.intlDepChml ?? intlDepChml}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-navy mb-2">Return Meals</div>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Meal Type</th>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                          <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Return Meal</td>
                          <td className="px-3 py-2">{tomorrowMenu?.intl.retMealName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">0</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Return VGML</td>
                          <td className="px-3 py-2">{tomorrowMenu?.intl.retVgmlName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.intlRetVgml ?? intlRetVgml}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">US-Bangla</div>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Meal Type</th>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                          <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Breakfast</td>
                          <td className="px-3 py-2">{tomorrowMenu?.dom.usbaBreakfastName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.usbaBreakfast ?? usbaBreakfast}</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Lunch</td>
                          <td className="px-3 py-2">{tomorrowMenu?.dom.usbaLunchName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.usbaLunch ?? usbaLunch}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Air Astra</div>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Meal Type</th>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                          <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Breakfast</td>
                          <td className="px-3 py-2">{tomorrowMenu?.dom.aaaBreakfastName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.aaaZenith ?? aaaZenith}</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Lunch</td>
                          <td className="px-3 py-2">{tomorrowMenu?.dom.aaaLunchName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.aaaPax ?? aaaPax}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setCrewMenuContext(showViewMenuModal === "intl" ? "intl" : "dom");
                setShowViewMenuModal(null);
                setShowCrewMenuModal(true);
              }}
            >
              + Add Crew Meal
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowViewMenuModal(null)}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back
            </Button>
            <Button variant="secondary" onClick={() => { setShowViewMenuModal(null); navigate("/meal-planning"); }}>
              Edit in Menu Planning
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Crew Menu Modal */}
      <Dialog open={showCrewMenuModal} onOpenChange={setShowCrewMenuModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Crew Meal Configuration — {formatDayLabel(importDate)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {crewMenuContext === "dom" && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Domestic Crew Meals</div>
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Meal Type</th>
                        <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                        <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">H. Snacks</td>
                        <td className="px-3 py-2">Sandwich + Orange Juice</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.hSnacks}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, hSnacks: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">Lunch</td>
                        <td className="px-3 py-2">Rice + Mutton Curry</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.lunch}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, lunch: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">Dinner</td>
                        <td className="px-3 py-2">Noodles + Soup + Juice</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.dinner}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, dinner: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {crewMenuContext === "intl" && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-navy mb-2">International Crew Meals</div>
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Meal Type</th>
                        <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                        <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">B/C Breakfast</td>
                        <td className="px-3 py-2">Continental Breakfast Platter</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.bcBreakfast}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, bcBreakfast: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">B/C Lunch</td>
                        <td className="px-3 py-2">Chef's Special — Rice + Fish</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.bcLunch}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, bcLunch: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">E/C Snack</td>
                        <td className="px-3 py-2">Biscuit + Coffee / Tea</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.ecSnack}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, ecSnack: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">E/C Meal</td>
                        <td className="px-3 py-2">Standard Box Meal</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.ecMeal}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, ecMeal: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCrewMenuModal(false)}>Close</Button>
            <Button variant="secondary" onClick={() => {
              if (summaryEdit) {
                setSummaryEdit((p) => p && { ...p,
                  crewHSnacks: crewMenuQty.hSnacks,
                  crewLunch: crewMenuQty.lunch,
                  crewDinner: crewMenuQty.dinner,
                });
              }
              toast.success("Crew meal quantities saved.");
            }}>
              Save
            </Button>
            <Button onClick={() => {
              if (summaryEdit) {
                setSummaryEdit((p) => p && { ...p,
                  crewHSnacks: crewMenuQty.hSnacks,
                  crewLunch: crewMenuQty.lunch,
                  crewDinner: crewMenuQty.dinner,
                });
              }
              setShowCrewMenuModal(false);
              toast.success("Crew meal quantities updated.");
            }}>
              Order Meal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post-import: success banner, meal summary, order meal action bar */}
      {importConfirmed && (
        <>
          <div className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Import confirmed — {importedOrders.length} orders
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {importDate}{domDone ? ` · ${validDom.length} domestic` : ""}{intlDone ? ` · ${validIntl.length} international` : ""}
              </p>
            </div>
          </div>

          <Card>
            <CardContent className="pt-6">
              <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground mb-4">
                Meal Order Summary — Next 24 Hours ({tomorrowDayName})
                <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground">{importDate} · From Zenith PAX Load</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* International column */}
                <div className="rounded-lg border border-navy/20 bg-navy/5 p-4 space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-navy">International</h4>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Departure</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Departure Meal</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlDepMeal}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlDepMeal: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.intlDepMeal : intlDepMeal}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Departure CHML</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlDepChml}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlDepChml: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.intlDepChml : intlDepChml}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm font-semibold border-t border-navy/20 pt-1">
                      <span>Departure Total</span>
                      <span className="tabular-nums">
                        {mealEditMode && summaryEdit ? summaryEdit.intlDepMeal + summaryEdit.intlDepChml : savedEdit ? savedEdit.intlDepMeal + savedEdit.intlDepChml : intlDepTotal}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Return</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Return Meal</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlRetMeal}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlRetMeal: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.intlRetMeal : 0}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Return CHML</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlRetChml}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlRetChml: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.intlRetChml : 0}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Return VGML</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlRetVgml}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlRetVgml: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.intlRetVgml : intlRetVgml}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm font-semibold border-t border-navy/20 pt-1">
                      <span>Return Total</span>
                      <span className="tabular-nums">
                        {mealEditMode && summaryEdit ? summaryEdit.intlRetMeal + summaryEdit.intlRetChml + summaryEdit.intlRetVgml : savedEdit ? savedEdit.intlRetMeal + savedEdit.intlRetChml + savedEdit.intlRetVgml : intlRetTotal}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t-2 border-navy/30 pt-2 mt-1">
                    <span>Total Meal (Departure+Return)</span>
                    <span className="tabular-nums">
                      {mealEditMode && summaryEdit
                        ? summaryEdit.intlDepMeal + summaryEdit.intlDepChml + summaryEdit.intlRetMeal + summaryEdit.intlRetChml + summaryEdit.intlRetVgml
                        : savedEdit
                          ? savedEdit.intlDepMeal + savedEdit.intlDepChml + savedEdit.intlRetMeal + savedEdit.intlRetChml + savedEdit.intlRetVgml
                          : intlGrandTotal}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t border-navy/10 mt-1">
                    <span className="text-muted-foreground">Total Passenger Meal</span>
                    <span className="font-medium tabular-nums">
                      {mealEditMode && summaryEdit
                        ? summaryEdit.intlDepMeal + summaryEdit.intlDepChml + summaryEdit.intlRetMeal + summaryEdit.intlRetChml + summaryEdit.intlRetVgml + summaryEdit.usbaBreakfast + summaryEdit.usbaLunch + summaryEdit.aaaPax
                        : savedEdit
                          ? savedEdit.intlDepMeal + savedEdit.intlDepChml + savedEdit.intlRetMeal + savedEdit.intlRetChml + savedEdit.intlRetVgml + savedEdit.usbaBreakfast + savedEdit.usbaLunch + savedEdit.aaaPax
                          : intlGrandTotal + usbaBreakfast + usbaLunch + aaaPax}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Crew Meal</span>
                    <span className="font-medium tabular-nums">
                      {mealEditMode && summaryEdit
                        ? summaryEdit.crewHSnacks + summaryEdit.crewLunch + summaryEdit.crewDinner
                        : savedEdit
                          ? savedEdit.crewHSnacks + savedEdit.crewLunch + savedEdit.crewDinner
                          : crewHSnacks + crewLunch + crewDinner}
                    </span>
                  </div>
                </div>

                {/* Domestic column */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">Domestic</h4>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">US-Bangla</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Zenith Load</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.usbaZenith}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, usbaZenith: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.usbaZenith : usbaZenith}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Pax Load</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.usbaPax}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, usbaPax: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.usbaPax : usbaPax}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Breakfast</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.usbaBreakfast}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, usbaBreakfast: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.usbaBreakfast : usbaBreakfast}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Lunch</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.usbaLunch}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, usbaLunch: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.usbaLunch : usbaLunch}</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Air Astra</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Zenith Load</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.aaaZenith}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, aaaZenith: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.aaaZenith : aaaZenith}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Pax Load</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.aaaPax}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, aaaPax: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.aaaPax : aaaPax}</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Crew Meals</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">H. Snacks</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.crewHSnacks}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, crewHSnacks: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.crewHSnacks : crewHSnacks}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Lunch</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.crewLunch}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, crewLunch: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.crewLunch : crewLunch}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Dinner</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.crewDinner}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, crewDinner: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{savedEdit ? savedEdit.crewDinner : crewDinner}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between text-sm font-semibold border-t border-primary/20 pt-2">
                    <span>Total Zenith (USBA + Air Astra)</span>
                    <span className="tabular-nums">
                      {mealEditMode && summaryEdit ? summaryEdit.usbaZenith + summaryEdit.aaaZenith : savedEdit ? savedEdit.usbaZenith + savedEdit.aaaZenith : totalZenith}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t border-primary/10 mt-1">
                    <span className="text-muted-foreground">Total Passenger Meal</span>
                    <span className="font-medium tabular-nums">
                      {mealEditMode && summaryEdit
                        ? summaryEdit.intlDepMeal + summaryEdit.intlDepChml + summaryEdit.intlRetMeal + summaryEdit.intlRetChml + summaryEdit.intlRetVgml + summaryEdit.usbaBreakfast + summaryEdit.usbaLunch + summaryEdit.aaaPax
                        : savedEdit
                          ? savedEdit.intlDepMeal + savedEdit.intlDepChml + savedEdit.intlRetMeal + savedEdit.intlRetChml + savedEdit.intlRetVgml + savedEdit.usbaBreakfast + savedEdit.usbaLunch + savedEdit.aaaPax
                          : intlGrandTotal + usbaBreakfast + usbaLunch + aaaPax}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Crew Meal</span>
                    <span className="font-medium tabular-nums">
                      {mealEditMode && summaryEdit
                        ? summaryEdit.crewHSnacks + summaryEdit.crewLunch + summaryEdit.crewDinner
                        : savedEdit
                          ? savedEdit.crewHSnacks + savedEdit.crewLunch + savedEdit.crewDinner
                          : crewHSnacks + crewLunch + crewDinner}
                    </span>
                  </div>
                </div>
              </div>

              {/* Order Meal action bar */}
              <div className={cn(
                "mt-6 rounded-lg border p-4 flex items-center justify-between gap-4",
                orderSent ? "border-success/40 bg-success/5" : "border-border bg-muted/30",
              )}>
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{importDate}</span>
                  <span className="mx-2">·</span>
                  <span>{totalFlights} flight{totalFlights !== 1 ? "s" : ""}</span>
                  <span className="mx-2">·</span>
                  <span>{(mealEditMode && summaryEdit
                    ? summaryEdit.intlDepMeal + summaryEdit.intlDepChml + summaryEdit.intlRetMeal + summaryEdit.intlRetChml + summaryEdit.intlRetVgml + summaryEdit.usbaZenith + summaryEdit.aaaZenith + summaryEdit.crewHSnacks + summaryEdit.crewLunch + summaryEdit.crewDinner
                    : savedEdit
                      ? savedEdit.intlDepMeal + savedEdit.intlDepChml + savedEdit.intlRetMeal + savedEdit.intlRetChml + savedEdit.intlRetVgml + savedEdit.usbaZenith + savedEdit.aaaZenith + savedEdit.crewHSnacks + savedEdit.crewLunch + savedEdit.crewDinner
                      : totalMeals
                  ).toLocaleString()} meals</span>
                </div>
                <div className="flex items-center gap-2">
                  {!orderSent && mealEditMode && summaryEdit && (
                    <Button
                      onClick={() => {
                        setSavedEdit(summaryEdit);
                        setSummaryEdit(null);
                        setMealEditMode(false);
                        toast.success("Meal numbers saved.");
                      }}
                    >
                      <Save className="h-4 w-4 mr-1.5" /> Save
                    </Button>
                  )}
                  {!orderSent && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (mealEditMode) {
                          setMealEditMode(false);
                          setSummaryEdit(null);
                        } else {
                          setSummaryEdit(savedEdit ?? {
                            intlDepMeal, intlDepChml, intlRetMeal: 0, intlRetChml: 0, intlRetVgml,
                            usbaZenith, usbaPax, usbaBreakfast, usbaLunch,
                            aaaZenith, aaaPax,
                            crewHSnacks, crewLunch, crewDinner,
                          });
                          setMealEditMode(true);
                        }
                      }}
                    >
                      {mealEditMode ? "Cancel Editing" : "Set Meal Numbers"}
                    </Button>
                  )}
                  <Button
                    onClick={orderSent ? undefined : () => { setPendingDay(tomorrowDayName); setDaySelectionOpen(true); }}
                    disabled={orderLoading || orderSent}
                    className={cn(orderSent && "bg-success hover:bg-success text-white")}
                  >
                    {orderLoading ? "Sending…" : orderSent ? (
                      <><CheckCircle2 className="h-4 w-4 mr-1.5" />Sent</>
                    ) : "Tag & Forward to Production"}
                  </Button>
                </div>
              </div>

            </CardContent>
          </Card>

          {/* Tag & Forward to Production — confirmation dialog */}
          <Dialog open={tagForwardOpen} onOpenChange={(open) => { if (!open) { setTagForwardOpen(false); if (mealEditMode) { setMealEditMode(false); setSummaryEdit(null); } } }}>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  Tag &amp; Forward to Production — {tomorrowDayName}
                  <span className="ml-2 text-xs font-normal text-muted-foreground normal-case tracking-normal">{tomorrowDateStr} · Next 24 Hours</span>
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-2">
                {/* International */}
                <div className="rounded-lg border border-navy/20 bg-navy/5 p-4 space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-navy">International</h4>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Departure</div>
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">Total Departure Meal</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlDepMeal}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlDepMeal: Number(e.target.value) })}
                          className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : <span className="font-medium tabular-nums">{intlDepMeal}</span>}
                    </div>
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">Departure CHML</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlDepChml}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlDepChml: Number(e.target.value) })}
                          className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : <span className="font-medium tabular-nums">{intlDepChml}</span>}
                    </div>
                    <div className="flex justify-between text-sm font-semibold border-t border-navy/20 pt-1">
                      <span>Departure Total</span>
                      <span className="tabular-nums">{mealEditMode && summaryEdit ? summaryEdit.intlDepMeal + summaryEdit.intlDepChml : intlDepTotal}</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Return</div>
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">Total Return Meal</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlRetMeal}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlRetMeal: Number(e.target.value) })}
                          className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : <span className="font-medium tabular-nums">0</span>}
                    </div>
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">Return CHML</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlRetChml}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlRetChml: Number(e.target.value) })}
                          className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : <span className="font-medium tabular-nums">0</span>}
                    </div>
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">Return VGML</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlRetVgml}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlRetVgml: Number(e.target.value) })}
                          className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : <span className="font-medium tabular-nums">{intlRetVgml}</span>}
                    </div>
                    <div className="flex justify-between text-sm font-semibold border-t border-navy/20 pt-1">
                      <span>Return Total</span>
                      <span className="tabular-nums">{mealEditMode && summaryEdit ? summaryEdit.intlRetMeal + summaryEdit.intlRetChml + summaryEdit.intlRetVgml : intlRetTotal}</span>
                    </div>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t-2 border-navy/30 pt-2 mt-1">
                    <span>Total Meal (Departure+Return)</span>
                    <span className="tabular-nums">{mealEditMode && summaryEdit ? summaryEdit.intlDepMeal + summaryEdit.intlDepChml + summaryEdit.intlRetMeal + summaryEdit.intlRetChml + summaryEdit.intlRetVgml : intlGrandTotal}</span>
                  </div>
                </div>
                {/* Domestic */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">Domestic</h4>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">US-Bangla</div>
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">Zenith Load</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.usbaZenith}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, usbaZenith: Number(e.target.value) })}
                          className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : <span className="font-medium tabular-nums">{usbaZenith}</span>}
                    </div>
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">Pax Load</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.usbaPax}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, usbaPax: Number(e.target.value) })}
                          className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : <span className="font-medium tabular-nums">{usbaPax}</span>}
                    </div>
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">Breakfast</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.usbaBreakfast}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, usbaBreakfast: Number(e.target.value) })}
                          className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : <span className="font-medium tabular-nums">{usbaBreakfast}</span>}
                    </div>
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">Lunch</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.usbaLunch}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, usbaLunch: Number(e.target.value) })}
                          className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : <span className="font-medium tabular-nums">{usbaLunch}</span>}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Air Astra</div>
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">Zenith Load</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.aaaZenith}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, aaaZenith: Number(e.target.value) })}
                          className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : <span className="font-medium tabular-nums">{aaaZenith}</span>}
                    </div>
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">Pax Load</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.aaaPax}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, aaaPax: Number(e.target.value) })}
                          className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : <span className="font-medium tabular-nums">{aaaPax}</span>}
                    </div>
                  </div>
                  <div className="flex justify-between text-sm font-semibold border-t border-primary/20 pt-2">
                    <span>Total Zenith (USBA + Air Astra)</span>
                    <span className="tabular-nums">{mealEditMode && summaryEdit ? summaryEdit.usbaZenith + summaryEdit.aaaZenith : totalZenith}</span>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setTagForwardOpen(false); if (mealEditMode) { setMealEditMode(false); setSummaryEdit(null); } }}>Close</Button>
                <Button
                  onClick={() => {
                    setTagForwardOpen(false);
                    if (mealEditMode) { setMealEditMode(false); setSummaryEdit(null); }
                    setPendingDay(tomorrowDayName);
                    setDaySelectionOpen(true);
                  }}
                >
                  Tag Meal
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Tag Meal — Day Selection Dialog */}
          <Dialog open={daySelectionOpen} onOpenChange={setDaySelectionOpen}>
            <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b bg-white">
                <DialogTitle className="text-lg font-semibold mb-4">Tag Meal — Select Day & Configure</DialogTitle>
                <div className="flex gap-1.5">
                  {BU_DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        pendingDay === d
                          ? "bg-slate-800 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                      onClick={() => setPendingDay(d)}
                    >
                      {d.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-slate-50">
                {BU_MEAL_TYPES.map((mealType, typeIdx) => {
                  const tagPalette = [
                    { border: "border-amber-200",   header: "bg-amber-50",   headerText: "text-amber-800",   body: "bg-white",  cardAccent: "border-l-amber-400"   },
                    { border: "border-sky-200",     header: "bg-sky-50",     headerText: "text-sky-800",     body: "bg-white",  cardAccent: "border-l-sky-400"     },
                    { border: "border-violet-200",  header: "bg-violet-50",  headerText: "text-violet-800",  body: "bg-white",  cardAccent: "border-l-violet-400"  },
                    { border: "border-orange-200",  header: "bg-orange-50",  headerText: "text-orange-800",  body: "bg-white",  cardAccent: "border-l-orange-400"  },
                    { border: "border-emerald-200", header: "bg-emerald-50", headerText: "text-emerald-800", body: "bg-white",  cardAccent: "border-l-emerald-400" },
                  ];
                  const pal = tagPalette[typeIdx % tagPalette.length];
                  return (
                    <div key={mealType} className={`rounded-xl border ${pal.border} overflow-hidden shadow-sm`}>
                      <div className={`${pal.header} px-4 py-2.5 flex items-center gap-3 border-b ${pal.border}`}>
                        <span className={`font-semibold text-sm w-28 shrink-0 ${pal.headerText}`}>{mealType}</span>
                        <span className="text-xs text-slate-400">{BU_MEAL_TYPE_TIME[mealType]}</span>
                      </div>
                      <div className={`${pal.body} px-4 py-3`}>
                        <div className="flex items-center gap-4 py-1">
                          <span className="text-sm text-slate-400 italic">No meals configured for this day</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => { setDaySelectionOpen(false); navigate("/meal-planning", { state: { backUrl: "/order-management" } }); }}
                          >
                            + Add New
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="px-6 py-4 border-t bg-white flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDaySelectionOpen(false)}>Cancel</Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={orderLoading}
                  onClick={() => {
                    setDaySelectionOpen(false);
                    handleOrderMeal();
                  }}
                >
                  {orderLoading ? "Sending…" : "Forward to Production"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Recent Activity */}
      {(anyDone || importConfirmed) && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground mb-4">
              Recent Activity
            </h3>
            <div className="space-y-3">
              {activityLog.map((entry, index) => (
                <div key={index} className="rounded-lg border border-border p-3 bg-muted/40">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{entry.user} — {entry.role}</span>
                    <span>{entry.at}</span>
                  </div>
                  <div className="mt-1 text-sm text-foreground">{entry.message}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}

const SPECIAL_MEAL_CATEGORY_COLOR: Record<SpecialMealCategory, string> = {
  Religious:  "border-navy/30 bg-navy/5 text-navy",
  Medical:    "border-destructive/30 bg-destructive/5 text-destructive",
  Vegetarian: "border-success/30 bg-success/5 text-success",
  Other:      "border-border bg-muted text-muted-foreground",
};

function SpecialMealRosterPanel({ legs, level = "passenger" }: { legs: FlightOrder[]; level?: "crew" | "passenger" }) {
  const allEntries = legs.flatMap((l) =>
    (l.specialMealRoster ?? []).map((e) => ({ ...e, flight: l.flight, sector: l.sector })),
  );
  // Crew specials aren't tied to a person (no PNR/seat) — split them out so the
  // passenger manifest stays a PNR table and crew shows as per-code counts.
  const passengerEntries = allEntries.filter((e) => (e.audience ?? "Passenger") !== "Crew");
  const crewEntries = allEntries.filter((e) => e.audience === "Crew");
  const plannedCount = legs.reduce((s, l) => s + l.specialMeals, 0);
  // Crew Meals tab passes "crew"; flight order surfaces use the default.
  const manifestLevel = level;

  if (allEntries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        {plannedCount > 0 ? (
          <>
            <span className="font-medium text-foreground">{plannedCount}</span> special meal{plannedCount === 1 ? "" : "s"} planned on this flight — {manifestLevel}-level manifest (PNR / Seat / Meal) not yet imported.
          </>
        ) : (
          <>No special meals on this flight.</>
        )}
      </div>
    );
  }

  // Count per meal code — passenger and crew tallied separately.
  const tally = (entries: typeof allEntries) => {
    const counts = new Map<string, number>();
    entries.forEach((e) => counts.set(e.mealCode, (counts.get(e.mealCode) ?? 0) + 1));
    return Array.from(counts.entries())
      .map(([code, count]) => ({ code, count, meta: SPECIAL_MEAL_BY_CODE[code] }))
      .filter((s) => s.meta)
      .sort((a, b) => b.count - a.count);
  };
  const summary = tally(passengerEntries);
  const crewSummary = tally(crewEntries);

  const codeBadge = (s: { code: string; count: number; meta: typeof SPECIAL_MEAL_BY_CODE[string] }) => (
    <Badge
      key={s.code}
      variant="outline"
      className={cn("h-6 px-2 text-[11px] font-medium tabular-nums", SPECIAL_MEAL_CATEGORY_COLOR[s.meta.category])}
      title={s.meta.name}
    >
      <span className="font-mono mr-1">{s.code}</span>
      <span className="opacity-70">·</span>
      <span className="ml-1">{s.count}</span>
    </Badge>
  );

  return (
    <div className="space-y-3">
      {summary.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{summary.map(codeBadge)}</div>
      )}
      {crewEntries.length > 0 && (
        <div className="rounded-md border border-purple-200 bg-purple-50/50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-purple-700 mb-1.5">
            Crew special meals · {crewEntries.length}
          </div>
          <div className="flex flex-wrap gap-1.5">{crewSummary.map(codeBadge)}</div>
        </div>
      )}
      {passengerEntries.length > 0 && (
      <div className="border border-border rounded-md overflow-hidden max-h-[260px] overflow-y-auto">
        <Table>
          <TableHeader className="bg-muted/40 sticky top-0">
            <TableRow>
              <TableHead className="w-10 text-[10px] uppercase tracking-wider">SL</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider w-24">PNR</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Passenger</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider w-14">Seat</TableHead>
              {legs.length > 1 && (
                <TableHead className="text-[10px] uppercase tracking-wider">Flight</TableHead>
              )}
              <TableHead className="text-[10px] uppercase tracking-wider w-24">Meal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {passengerEntries.map((e, i) => {
              const meta = SPECIAL_MEAL_BY_CODE[e.mealCode];
              return (
                <TableRow key={e.id} className="hover:bg-muted/30">
                  <TableCell className="text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{e.pnr}</TableCell>
                  <TableCell className="text-xs">{e.passengerName}</TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{e.seat}</TableCell>
                  {legs.length > 1 && (
                    <TableCell className="font-mono text-xs">{e.flight}</TableCell>
                  )}
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-5 px-1.5 text-[10px] font-mono",
                        meta ? SPECIAL_MEAL_CATEGORY_COLOR[meta.category] : "",
                      )}
                      title={meta?.name ?? e.mealCode}
                    >
                      {e.mealCode}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      )}
    </div>
  );
}

function FlightOrderDetailsDialog({
  order, legs, allOrders = [], onClose,
}: {
  order: FlightOrder | null;
  legs: FlightOrder[];
  allOrders?: FlightOrder[];
  onClose: () => void;
}) {
  const isMulti = legs.length > 1;
  const hasRoster = legs.some((l) => (l.specialMealRoster ?? []).length > 0);
  const totalPax = legs.reduce((s, l) => s + l.pax, 0);
  const totalSpec = legs.reduce((s, l) => s + l.specialMeals, 0);

  // ── Individual flight detail (clicking View on a single row) ──────────────
  if (order && !isMulti) {
    const leg = legs[0] ?? order;
    const rosterCount = leg.specialMealRoster?.length ?? 0;
    return (
      <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className={cn(rosterCount > 0 ? "max-w-2xl" : "max-w-lg", "max-h-[85vh] overflow-y-auto")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              Flight Details
              <span className="font-mono text-sm text-muted-foreground">— {leg.flight}</span>
              <DirectionBadge direction={leg.direction} />
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <DetailRow label="Order" value={leg.orderNo} mono />
              <DetailRow label="Flight" value={leg.flight} bold />
              <DetailRow label="Airline" value={leg.airline} />
              <DetailRow label="Sector" value={leg.sector} />
              <DetailRow label="Date" value={leg.date} />
              <DetailRow label="ETD" value={leg.etd} />
              <DetailRow label="Passengers" value={leg.pax.toLocaleString()} />
              <DetailRow label="Special Meals" value={leg.specialMeals.toString()} />
              <DetailRow label="Crew" value={(leg.crew ?? 0).toString()} />
            </div>

            <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</span>
              {leg.reviewComment && leg.status === "Pending" ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-300">
                  <CornerUpLeft className="h-3 w-3" /> Reviewed
                </span>
              ) : (
                <StatusBadge status={leg.status} />
              )}
            </div>

            {leg.reviewComment && leg.status === "Pending" && (
              <div className="rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-amber-700 font-medium mb-1 flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" /> Reviewer's Comment — returned for correction
                </div>
                <p className="text-sm text-amber-900">{leg.reviewComment}</p>
                {(leg.reviewedBy || leg.reviewedAt) && (
                  <div className="mt-1 text-[11px] text-amber-700">
                    — {leg.reviewedBy}{leg.reviewedAt ? ` · ${leg.reviewedAt}` : ""}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  Special Meal Roster
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                    {rosterCount > 0 ? `${rosterCount} pax` : `${leg.specialMeals} planned`}
                  </Badge>
                </div>
                {!isDomesticSector(leg.sector) && (
                  <span className="text-[10px] uppercase tracking-wider text-navy">International</span>
                )}
              </div>
              <SpecialMealRosterPanel legs={[leg]} />
            </div>

            <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Total Meals (PAX + Crew + Special)</span>
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {(leg.pax + (leg.crew ?? 0) + leg.specialMeals).toLocaleString()}
              </span>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn(isMulti || hasRoster ? "max-w-3xl" : "max-w-2xl", "max-h-[85vh] overflow-y-auto")}>
        <DialogHeader>
          <DialogTitle>
            Order Details
            {order && (
              <span className="font-mono text-sm text-muted-foreground ml-1">
                — {order.orderNo}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        {order && (
          <div className="mt-2 space-y-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <DetailRow label="Order" value={order.orderNo} mono />
              <DetailRow label="Airline" value={order.airline} />
              <DetailRow label="Date" value={order.date} />
              <DetailRow label="Flights" value={legs.length.toString()} />
              <DetailRow label="Total Passengers" value={totalPax.toLocaleString()} />
              <DetailRow label="Total Special Meals" value={totalSpec.toString()} />
            </div>

            <WorkflowStrip
              statuses={FLIGHT_ORDER_STATUS_FLOW}
              counts={
                FLIGHT_ORDER_STATUS_FLOW.reduce<Record<FlightOrderStatus, number>>(
                  (acc, s) => {
                    acc[s] = legs.filter((l) => l.status === s).length;
                    return acc;
                  },
                  { Pending: 0, Approved: 0, Production: 0, Dispatched: 0, Completed: 0 },
                )
              }
            />

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  Flights
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                    {legs.length} {legs.length === 1 ? "flight" : "flights"}
                  </Badge>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  Status advances automatically as flights move through the workflow
                </span>
              </div>
              <div className="border border-border rounded-md overflow-hidden max-h-[42vh] overflow-y-auto">
                <Table>
                  <TableHeader className="bg-muted/40 sticky top-0 z-10">
                    <TableRow>
                      <TableHead className="w-12 text-[10px] uppercase tracking-wider">#</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Flight</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Sector</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">ETD</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-right">PAX</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-right">Spec. Meals</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider w-28">Workflow</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {legs.map((leg, i) => {
                      const next = nextFlightStatus(leg.status);
                      return (
                        <TableRow key={leg.id}>
                          <TableCell className="tabular-nums text-xs">{i + 1}</TableCell>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1.5">
                              {leg.flight}
                              <DirectionBadge direction={leg.direction} />
                            </div>
                          </TableCell>
                          <TableCell>{leg.sector}</TableCell>
                          <TableCell>{leg.etd}</TableCell>
                          <TableCell className="text-right tabular-nums">{leg.pax}</TableCell>
                          <TableCell className="text-right tabular-nums">{leg.specialMeals}</TableCell>
                          <TableCell><StatusBadge status={leg.status} /></TableCell>
                          <TableCell>
                            {next ? (
                              <span
                                className="text-[11px] text-muted-foreground"
                                title={`Next stage: ${next}`}
                              >
                                → {next}
                              </span>
                            ) : (
                              <span className="text-[10px] text-success">Done</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  Special Meal Roster
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                    {legs.reduce((s, l) => s + (l.specialMealRoster?.length ?? 0), 0)} pax
                  </Badge>
                </div>
                {!isDomesticSector(order.sector) && (
                  <span className="text-[10px] uppercase tracking-wider text-navy">International</span>
                )}
              </div>
              <SpecialMealRosterPanel legs={legs} />
            </div>

            <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Total Meals (PAX + Special)</span>
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {(totalPax + totalSpec).toLocaleString()}
              </span>
            </div>
          </div>
        )}
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label, value, mono, bold,
}: { label: string; value: string; mono?: boolean; bold?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1 text-sm text-foreground" +
          (mono ? " font-mono text-xs" : "") +
          (bold ? " font-semibold" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
