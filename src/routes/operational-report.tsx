import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  FileText, BadgeCheck, Factory, Package, Truck, PlaneTakeoff, PlaneLanding, Plane,
  Search, Eye, Check, CircleDot, Layers, History, Boxes, AlertTriangle, Clock,
  Thermometer, Timer, Wallet, Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useFlightOrders, getOrderAmendments, type FlightOrder, type OrderAmendment } from "@/lib/flight-orders-store";
import { isDomesticSector, flights as FLIGHT_BOARD, type FlightOrderStatus } from "@/lib/sample-data";
import { useWorkflow, type WfProductionEntry } from "@/lib/workflow-store";
import { isPackaged, allocationRuns, type PackagingAllocation } from "@/lib/packaging-allocations";
import { INITIAL_RECORDS, type DispatchRecord } from "@/routes/dispatch";
import { loadDispatchEntries, loadGalleyRecords, type DispatchEntry, type GalleyLoadingRecord } from "@/routes/dispatch-monitoring";
import { loadDelayEvents, isActiveDelayEvent, type DelayEvent } from "@/routes/delay-management";
import { readItemPrices, resolveUnitPrice, type ItemPrice } from "@/lib/item-prices";
import { ListExportActions } from "@/components/common/ListExportActions";
import { filterMeta } from "@/lib/list-export";

// ─────────────────────────────────────────────────────────────────────────────
// Operational Report — the order-to-departure lifecycle of every flight, on one
// screen, for management review.
//
// The report does not invent state. The FLIGHT LEG's stored status is the state
// machine (an order has no status of its own — see Order Management), so the
// stepper position is derived from `leg.status` alone. What the other modules
// contribute is EVIDENCE per stage — production runs and their QC, packaging
// allocations, the dispatch record — matched on the same keys those modules
// use themselves (orderNo + date for production, flight + date for packaging
// and dispatch). Where no evidence exists the stage still renders from the
// status; it just has nothing extra to show.
// ─────────────────────────────────────────────────────────────────────────────

const STAGES = [
  { key: "order",      label: "Order",      icon: FileText },
  { key: "approval",   label: "Approved",   icon: BadgeCheck },
  { key: "production", label: "Production", icon: Factory },
  { key: "packaging",  label: "Packaging",  icon: Package },
  { key: "dispatch",   label: "Dispatch",   icon: Truck },
  { key: "received",   label: "Received",   icon: PlaneLanding },
  { key: "galley",     label: "Galley",     icon: Boxes },
  { key: "departure",  label: "Departed",   icon: PlaneTakeoff },
] as const;

/**
 * How many stages the leg's stored status has completed. "Production" maps to 2
 * (not 3): the status means the kitchen is WORKING, so Production is the
 * current stage, not a finished one. Packaged completes both Production and
 * Packaging — nothing packages before its runs exist.
 *
 * Received and Galley have no counterpart in the leg's status vocabulary — the
 * airport signs for a load, and the galley is loaded, without Order Management
 * hearing about it. Those two dots therefore advance on EVIDENCE (see
 * `evidenceDone`), never below what the status already claims.
 */
const DONE_COUNT: Record<FlightOrderStatus, number> = {
  Pending: 1, Approved: 2, Production: 2, Packaged: 4, Dispatched: 5, Completed: 8, Departed: 8,
};

/**
 * Minimum hours between a load leaving the kitchen and its flight's ETD.
 *
 * Not invented here: the Dispatch page states the rule to the operator before
 * every dispatch — "each meal must be dispatched at least 4–5 hours prior to
 * the flight time". At or above the comfortable end is on time, inside the
 * band is tight, below the minimum is late.
 */
const DISPATCH_LEAD_MIN_HOURS = 4;
const DISPATCH_LEAD_TARGET_HOURS = 5;

type Tone = "amber" | "red" | "violet" | "slate";
type Flag = { key: string; label: string; tone: Tone; title: string };

const FLAG_TONE: Record<Tone, string> = {
  amber:  "border-amber-300 bg-amber-50 text-amber-700",
  red:    "border-red-300 bg-red-50 text-red-700",
  violet: "border-violet-300 bg-violet-50 text-violet-700",
  slate:  "border-slate-300 bg-slate-50 text-slate-600",
};

const STATUS_BADGE: Record<FlightOrderStatus, string> = {
  Pending:    "text-[#8a6400] bg-[#fbf4e2] border-[#ecdcae]",
  Approved:   "text-[#1f9d57] bg-[#ecf5ef] border-[#c4e3cf]",
  Production: "text-[#b45309] bg-[#fbf1e6] border-[#f0d9bf]",
  Packaged:   "text-[#2563eb] bg-[#eff4ff] border-[#c7d7fe]",
  Dispatched: "text-[#1f9d57] bg-[#ecf5ef] border-[#c4e3cf]",
  Completed:  "text-[#0f7a40] bg-[#ecf5ef] border-[#c4e3cf]",
  Departed:   "text-[#475569] bg-[#f1f5f9] border-[#cbd5e1]",
};

/** The moment each stage actually happened, where a module recorded one. */
type StageStamps = Partial<Record<typeof STAGES[number]["key"], string>>;

/** Ordered → produced → packaged → dispatched → received, for variance. */
type QtyChain = {
  ordered: number;
  /** Portions from the runs serving this ORDER — day totals, not the leg's
   *  share, so it is context rather than a figure to difference against. */
  produced: number;
  /** This flight's own share, summed off its packaging allocations. */
  packaged: number;
  /** Meals on the dispatch monitoring entry that carried this leg. */
  dispatched: number;
  /** Non-null once the airport has signed for the load. */
  received?: number;
};

/** Everything the report knows about one flight leg's journey. */
type LegLife = {
  leg: FlightOrder;
  doneCount: number;
  /** Production runs serving this leg's order on its date (plus any runs its
   *  packaging actually drew on — the allocations are the stronger link). */
  runs: WfProductionEntry[];
  qcPassed: number;
  qcFailed: number;
  producedQty: number;
  /** Packaging allocations raised for this flight + date. */
  allocs: PackagingAllocation[];
  packagedCount: number;
  dispatchRec?: DispatchRecord;
  /** Cold-chain / vehicle sheet and airport receipt for the load. */
  dmEntry?: DispatchEntry;
  /** Galley loading record, once a plan was forwarded to the airport. */
  galleyRec?: GalleyLoadingRecord;
  delay?: DelayEvent;
  amendments: OrderAmendment[];
  lmcCount: number;
  /** When the leg was approved, if the amendment trail recorded it. */
  approvedAt?: string;
  approvedBy?: string;
  aircraft?: string;
  stamps: StageStamps;
  qty: QtyChain;
  flags: Flag[];
  /** Hours between the load leaving the kitchen and ETD; null when unknown. */
  leadHours: number | null;
  /** Estimated food cost of what was packaged for this leg. */
  cost: number | null;
};

const fmtStamp = (iso?: string) => (iso ? iso.slice(0, 16).replace("T", " ") : undefined);

/** "13:40", "5:30 AM" and "2026-08-02 13:40" all appear across the modules. */
function parseHm(t?: string): { h: number; m: number } | null {
  if (!t) return null;
  const s = t.trim();
  const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return { h, m: min };
}

/** A date-only string + a clock time, as a real Date (local). */
function atDate(date?: string, time?: string): Date | null {
  if (!date) return null;
  const hm = parseHm(time);
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (hm) d.setHours(hm.h, hm.m, 0, 0);
  return d;
}

/** Any of the stamp shapes the modules write, as a Date. */
function toDate(stamp?: string): Date | null {
  if (!stamp) return null;
  const d = new Date(stamp.includes("T") ? stamp : stamp.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2h 15m" between two stamps — the report's cycle-time unit. */
function elapsed(from?: string, to?: string): string | null {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return null;
  const mins = Math.round((b.getTime() - a.getTime()) / 60000);
  if (mins < 0) return null;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : m ? `${h}h ${m}m` : `${h}h`;
}

/** Where a lead time sits against the dispatch rule. */
function leadVerdict(hours: number | null): { label: string; cls: string } | null {
  if (hours == null) return null;
  if (hours >= DISPATCH_LEAD_TARGET_HOURS) return { label: "On time", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" };
  if (hours >= DISPATCH_LEAD_MIN_HOURS) return { label: "Tight", cls: "border-amber-300 bg-amber-50 text-amber-700" };
  return { label: "Late", cls: "border-red-300 bg-red-50 text-red-700" };
}

/**
 * Estimated food cost of what was packaged for this leg.
 *
 * Priced off the packaging allocations, not the production runs: an allocation
 * is this FLIGHT's share, while a run's produced quantity is the day's total
 * across every order it serves. An assembled set is priced by its components,
 * each of which is a real dish with a price of its own. Items with no price
 * configured contribute nothing rather than a guess — hence `priced`, so the
 * dialog can say how much of the load the figure actually covers.
 */
function legCost(allocs: PackagingAllocation[], prices: ItemPrice[], on: string) {
  let cost = 0;
  let priced = 0;
  let total = 0;
  for (const a of allocs) {
    const parts = allocationRuns(a);
    const lines = parts.length > 0
      ? parts.map((c) => ({ item: c.item, qty: c.qty }))
      : [{ item: a.item, qty: a.qty }];
    for (const l of lines) {
      total += l.qty;
      const unit = resolveUnitPrice(prices, { name: l.item, on });
      if (unit != null) { cost += unit * l.qty; priced += l.qty; }
    }
  }
  return { cost, priced, total };
}

/**
 * A record indexed by flight number AND the day it belongs to.
 *
 * Flight numbers repeat daily, so anything looked up by flight alone will
 * eventually be attributed to the wrong day's leg. Matching allows one day of
 * slack in either direction — a load is genuinely prepared the evening before
 * an early departure, and the airport signs for it after midnight — but no more.
 */
type DatedRec<T> = { date: string; rec: T };
const NEAREST_DAY_TOLERANCE = 1;

function pushDated<T>(map: Map<string, DatedRec<T>[]>, key: string, date: string, rec: T) {
  const list = map.get(key) ?? map.set(key, []).get(key)!;
  list.push({ date: (date ?? "").slice(0, 10), rec });
}

/** The record closest to `date`, or undefined if the nearest is too far away. */
function nearestDated<T>(list: DatedRec<T>[] | undefined, date: string): T | undefined {
  if (!list || list.length === 0) return undefined;
  const target = new Date(`${date}T00:00:00`).getTime();
  if (Number.isNaN(target)) return undefined;
  let best: DatedRec<T> | undefined;
  let bestGap = Infinity;
  for (const d of list) {
    const t = new Date(`${d.date}T00:00:00`).getTime();
    if (Number.isNaN(t)) continue;
    const gap = Math.abs(t - target) / 86_400_000;
    if (gap < bestGap) { bestGap = gap; best = d; }
  }
  return best && bestGap <= NEAREST_DAY_TOLERANCE ? best.rec : undefined;
}

/** Everything worth flagging on one line, worst first. */
function flagsFor(l: Omit<LegLife, "flags">): Flag[] {
  const out: Flag[] = [];
  const { leg } = l;
  if (l.qcFailed > 0) {
    out.push({ key: "qc", label: "QC FAIL", tone: "red", title: `${l.qcFailed} production run${l.qcFailed === 1 ? "" : "s"} failed QC` });
  }
  if (l.dmEntry && (l.dmEntry.resultSatisfy === "No" || l.dmEntry.vehicleClean === "No")) {
    out.push({
      key: "cold", label: "COLD CHAIN", tone: "red",
      title: l.dmEntry.vehicleClean === "No" ? "Vehicle failed the cleanliness check" : "Cold-chain result not satisfied",
    });
  }
  const lead = leadVerdict(l.leadHours);
  if (lead?.label === "Late") {
    out.push({ key: "late", label: "LATE", tone: "red", title: `Dispatched ${l.leadHours!.toFixed(1)}h before ETD — under the ${DISPATCH_LEAD_MIN_HOURS}h minimum` });
  }
  if (l.delay) {
    out.push({ key: "delay", label: "DELAY", tone: "violet", title: `${l.delay.delayDurationHours}h delay — ${l.delay.reason} (${l.delay.status})` });
  }
  if (l.lmcCount > 0) {
    out.push({ key: "lmc", label: "LMC", tone: "amber", title: `${l.lmcCount} last-minute change${l.lmcCount === 1 ? "" : "s"}` });
  }
  const short = l.qty.ordered - l.qty.packaged;
  if (l.qty.packaged > 0 && short > 0) {
    out.push({ key: "short", label: "SHORT", tone: "amber", title: `Packaged ${l.qty.packaged} against ${l.qty.ordered} ordered — ${short} short` });
  }
  if (leg.reviewComment) {
    out.push({ key: "returned", label: "RETURNED", tone: "slate", title: `Returned for correction — ${leg.reviewComment}` });
  }
  return out;
}

function buildLegLife(
  leg: FlightOrder,
  runsByOrderDate: Map<string, WfProductionEntry[]>,
  runById: Map<string, WfProductionEntry>,
  allocsByLeg: Map<string, PackagingAllocation[]>,
  dispatchByLeg: Map<string, DispatchRecord>,
  dmByFlight: Map<string, DatedRec<DispatchEntry>[]>,
  galleyByFlight: Map<string, DatedRec<GalleyLoadingRecord>[]>,
  delayByLeg: Map<string, DelayEvent>,
  aircraftByFlight: Map<string, string>,
  prices: ItemPrice[],
): LegLife {
  const allocs = allocsByLeg.get(`${leg.flight}|${leg.date}`) ?? [];

  // Runs: what packaging actually drew on (exact, per-flight), unioned with the
  // day's runs serving this Order # (covers legs not yet packaged).
  const runIds = new Set<string>();
  for (const a of allocs) {
    runIds.add(a.productionId);
    for (const c of a.components ?? []) runIds.add(c.productionId);
  }
  const runs: WfProductionEntry[] = [];
  const seen = new Set<string>();
  for (const id of runIds) {
    const e = runById.get(id);
    if (e && !seen.has(e.id)) { seen.add(e.id); runs.push(e); }
  }
  for (const e of runsByOrderDate.get(`${leg.orderNo}|${leg.date}`) ?? []) {
    if (!seen.has(e.id)) { seen.add(e.id); runs.push(e); }
  }

  const amendments = getOrderAmendments(leg.id);
  const approval = amendments.find((a) => a.changes.some((c) => c.field === "status" && c.to === "Approved"));

  const dispatchRec = dispatchByLeg.get(`${leg.flight}|${leg.date}`);
  const dmEntry = nearestDated(dmByFlight.get(leg.flight), leg.date);
  const galleyRec = nearestDated(galleyByFlight.get(leg.flight), leg.date);
  const delay = delayByLeg.get(`${leg.flight}|${leg.date}`);

  // ── When each stage happened ───────────────────────────────────────────────
  // Each module stamps its own work; the report only reads those stamps. A
  // stage with no stamp shows as "—" rather than borrowing a neighbour's time.
  const packagedStamps = allocs.map((a) => a.packagedAt).filter(Boolean).sort() as string[];
  const productionStamps = runs
    .map((r) => r.completedAt ?? r.qcPassedAt)
    .filter(Boolean)
    .sort() as string[];
  // The load leaving the kitchen: the monitoring sheet's Load End is the real
  // "wheels rolling" moment; the dispatch record's own trail is the fallback.
  const dispatchTrail = dispatchRec?.trail?.find((t) => t.status === "Dispatched");
  const dispatchedAt =
    (dmEntry?.loadEndTime && dmEntry.packagingDate ? `${dmEntry.packagingDate} ${dmEntry.loadEndTime}` : undefined)
    ?? (dispatchTrail ? `${dispatchTrail.date} ${dispatchTrail.time}` : undefined);

  // Built once and reused for both the departure stamp and the lead time —
  // this runs for every leg in the order book, and parsing the same ETD twice
  // was the single most expensive thing on the page.
  const etdAt = atDate(leg.date, leg.etd);

  const stamps: StageStamps = {
    order: leg.createdAt ? new Date(leg.createdAt).toISOString() : undefined,
    approval: approval?.at,
    production: productionStamps[productionStamps.length - 1],
    packaging: packagedStamps[packagedStamps.length - 1],
    dispatch: dispatchedAt,
    received: dmEntry?.receivedAt || undefined,
    galley: galleyRec?.loadingCompletedAt,
    // No module records an ACTUAL departure, so the scheduled ETD stands in —
    // labelled as scheduled wherever it is shown.
    departure: etdAt?.toISOString(),
  };

  // ── Lead time against the dispatch rule ────────────────────────────────────
  const leftAt = toDate(dispatchedAt);
  const leadHours = etdAt && leftAt ? (etdAt.getTime() - leftAt.getTime()) / 3_600_000 : null;

  // ── Quantity chain ─────────────────────────────────────────────────────────
  const packaged = allocs.filter(isPackaged).reduce((s, a) => s + (a.qty || 0), 0);
  const qty: QtyChain = {
    ordered: (leg.pax || 0) + (leg.crew || 0) + (leg.specialMeals || 0),
    produced: runs.reduce((s, r) => s + (r.producedQty || 0), 0),
    packaged,
    dispatched: (dmEntry?.mealLines ?? []).reduce((s, m) => s + (Number(m.qty) || 0), 0),
    received: dmEntry?.receivedAt ? (dmEntry.containersScanned ?? undefined) : undefined,
  };

  // ── Stage completion ───────────────────────────────────────────────────────
  // The stored status is the state machine, but the airport receipt and the
  // galley load happen outside it — so evidence may carry the stepper further
  // than the status can, never less far.
  const statusDone = DONE_COUNT[leg.status] ?? 1;
  const evidenceDone =
    galleyRec && (galleyRec.galleyStatus === "completed" || galleyRec.galleyStatus === "awaiting_approval" || galleyRec.galleyStatus === "approved") ? 7
    : dmEntry?.receivedAt ? 6
    : dispatchedAt ? 5
    : 0;

  const base = {
    leg,
    doneCount: Math.max(statusDone, evidenceDone),
    runs,
    qcPassed: runs.filter((r) => !!r.qcPassedAt).length,
    qcFailed: runs.filter((r) => !!r.qcFailedAt).length,
    producedQty: qty.produced,
    allocs,
    packagedCount: allocs.filter(isPackaged).length,
    dispatchRec,
    dmEntry,
    galleyRec,
    delay,
    amendments,
    lmcCount: amendments.filter((a) => a.isLmc).length,
    approvedAt: approval?.at,
    approvedBy: approval?.by,
    aircraft: aircraftByFlight.get(leg.flight),
    stamps,
    qty,
    leadHours,
    cost: allocs.length ? legCost(allocs, prices, leg.date).cost || null : null,
  };
  return { ...base, flags: flagsFor(base) };
}

/** Per-stage hover text — the evidence behind each dot. */
function stageTitle(l: LegLife, idx: number): string {
  const { leg } = l;
  switch (STAGES[idx].key) {
    case "order":
      return `Order placed · ${leg.orderNo}${leg.createdAt ? ` · ${new Date(leg.createdAt).toISOString().slice(0, 10)}` : ""}${l.lmcCount ? ` · ${l.lmcCount} LMC amendment${l.lmcCount === 1 ? "" : "s"}` : ""}`;
    case "approval":
      if (l.doneCount < 2) return leg.reviewComment ? `Returned for correction — ${leg.reviewComment}` : "Awaiting approval";
      return l.approvedAt ? `Approved ${fmtStamp(l.approvedAt)}${l.approvedBy ? ` by ${l.approvedBy}` : ""}` : "Approved";
    case "production":
      if (l.runs.length === 0) return l.doneCount >= 4 ? "Production complete" : "No production runs recorded yet";
      return `${l.runs.length} run${l.runs.length === 1 ? "" : "s"} · ${l.qcPassed} QC passed · ${l.producedQty.toLocaleString()} portions`;
    case "packaging":
      if (l.allocs.length === 0) return l.doneCount >= 4 ? "Packaging complete" : "No packaging runs raised yet";
      return `${l.packagedCount}/${l.allocs.length} package${l.allocs.length === 1 ? "" : "s"} done`;
    case "dispatch": {
      const when = l.stamps.dispatch ? ` · left ${l.stamps.dispatch}` : "";
      const lead = l.leadHours != null ? ` · ${l.leadHours.toFixed(1)}h before ETD (${leadVerdict(l.leadHours)!.label})` : "";
      if (l.dispatchRec) return `${l.dispatchRec.id} · ${l.dispatchRec.status}${when}${lead}`;
      return l.doneCount >= 5 ? `Dispatched${when}${lead}` : "Not dispatched yet";
    }
    case "received": {
      const e = l.dmEntry;
      if (!e) return "No dispatch monitoring sheet raised for this load";
      if (!e.receivedAt) return `Cold-chain sheet ${e.dispatchNo ?? ""} raised — not signed for at the airport yet`.trim();
      const scan = e.containersTotal ? ` · ${e.containersScanned ?? 0}/${e.containersTotal} containers` : "";
      return `Received ${e.receivedAt}${e.receivedBy ? ` by ${e.receivedBy}` : ""}${scan}`;
    }
    case "galley": {
      const g = l.galleyRec;
      if (!g) return "No galley plan forwarded for this flight";
      const dur = g.loadingDurationSec != null ? ` · ${Math.round(g.loadingDurationSec / 60)}m` : "";
      return `Galley ${g.galleyStatus.replace(/_/g, " ")}${g.loadingCompletedAt ? ` · loaded ${fmtStamp(g.loadingCompletedAt)}` : ""}${dur}`;
    }
    case "departure":
      return l.doneCount >= 8 ? `Flight ${leg.status.toLowerCase()}` : `Not departed yet · scheduled ETD ${leg.date} ${leg.etd}`;
    default:
      return "";
  }
}

/** The horizontal 6-dot lifecycle — done / current / pending. */
function LifecycleStepper({ life }: { life: LegLife }) {
  const current = life.doneCount < STAGES.length ? life.doneCount : -1;
  return (
    <div className="flex items-center min-w-[330px]" aria-label="Lifecycle progress">
      {STAGES.map((s, i) => {
        const done = i < life.doneCount;
        const isCurrent = i === current;
        const Icon = s.icon;
        return (
          <div key={s.key} className="flex items-center">
            {i > 0 && (
              <span className={cn("h-px w-4 sm:w-6", i <= current || done ? "bg-success/60" : "bg-border")} />
            )}
            <span className="flex flex-col items-center gap-0.5" title={stageTitle(life, i)}>
              <span
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full border",
                  done && "border-success/50 bg-success/10 text-success",
                  isCurrent && "border-amber-400 bg-amber-50 text-amber-600 ring-2 ring-amber-200/60",
                  !done && !isCurrent && "border-border bg-muted/30 text-muted-foreground/50",
                )}
              >
                {done ? <Check className="h-3 w-3" /> : isCurrent ? <CircleDot className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
              </span>
              <span className={cn(
                "text-[8.5px] font-semibold uppercase tracking-wide leading-none",
                done ? "text-success" : isCurrent ? "text-amber-600" : "text-muted-foreground/50",
              )}>
                {s.label}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Full journey of one flight — the row's View dialog. */
function LegDetailDialog({ life, prices, onClose }: { life: LegLife | null; prices: ItemPrice[]; onClose: () => void }) {
  if (!life) return null;
  const { leg } = life;
  const money = (n: number) => `৳${Math.round(n).toLocaleString()}`;
  const costing = life.allocs.length ? legCost(life.allocs, prices, leg.date) : null;
  const lead = leadVerdict(life.leadHours);
  const Section = ({ icon: Icon, title, children }: { icon: typeof FileText; title: string; children: ReactNode }) => (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      {children}
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Plane className="h-4 w-4" /> {leg.flight}
            <span className="text-sm font-normal text-muted-foreground">{leg.sector} · {leg.date} · ETD {leg.etd}</span>
            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", STATUS_BADGE[leg.status])}>
              {leg.status}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="mb-1 overflow-x-auto"><LifecycleStepper life={life} /></div>

        {life.flags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {life.flags.map((f) => (
              <span key={f.key} title={f.title}
                className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide", FLAG_TONE[f.tone])}>
                <AlertTriangle className="h-2.5 w-2.5" />{f.label}
              </span>
            ))}
          </div>
        )}

        <div className="space-y-3">
          <Section icon={FileText} title="Order">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
              <div><span className="text-muted-foreground">Order #</span><div className="font-mono font-semibold text-primary">{leg.orderNo}</div></div>
              <div><span className="text-muted-foreground">Airline</span><div className="font-medium">{leg.airline}</div></div>
              <div><span className="text-muted-foreground">PAX / Crew</span><div className="tabular-nums">{leg.pax} / {leg.crew}</div></div>
              <div><span className="text-muted-foreground">Special Meals</span><div className="tabular-nums">{leg.specialMeals}</div></div>
              <div><span className="text-muted-foreground">Aircraft</span><div className="font-medium">{life.aircraft ?? "—"}</div></div>
              <div><span className="text-muted-foreground">Direction</span><div className="font-medium">{leg.direction}</div></div>
              <div>
                <span className="text-muted-foreground">Trip Ref</span>
                <div className="font-mono">{leg.pairId ?? <span className="text-muted-foreground">—</span>}</div>
              </div>
              <div><span className="text-muted-foreground">Flight Type</span><div className="font-medium">{isDomesticSector(leg.sector) ? "Domestic" : "International"}</div></div>
            </div>

            {/* Ordered → produced → packaged → dispatched → received. Only the
                packaged figure is this leg's own share, so it is the one the
                variance is taken against. */}
            <div className="mt-2 pt-2 border-t border-border/60 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              <span className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mr-1">Quantities</span>
              <span className="rounded border border-border px-1.5 py-0.5 tabular-nums">Ordered <b>{life.qty.ordered.toLocaleString()}</b></span>
              <span className="text-muted-foreground">→</span>
              <span className="rounded border border-border px-1.5 py-0.5 tabular-nums" title="Portions produced by the runs serving this order — a day total across every order they feed, not this leg's share">
                Produced <b>{life.qty.produced.toLocaleString()}</b>
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="rounded border border-border px-1.5 py-0.5 tabular-nums">Packaged <b>{life.qty.packaged.toLocaleString()}</b></span>
              {life.qty.dispatched > 0 && (
                <>
                  <span className="text-muted-foreground">→</span>
                  <span className="rounded border border-border px-1.5 py-0.5 tabular-nums" title="Meals on the dispatch monitoring sheet for the vehicle that carried this leg">
                    Dispatched <b>{life.qty.dispatched.toLocaleString()}</b>
                  </span>
                </>
              )}
              {life.qty.packaged > 0 && life.qty.packaged !== life.qty.ordered && (
                <span className={cn(
                  "rounded border px-1.5 py-0.5 font-semibold tabular-nums",
                  life.qty.packaged < life.qty.ordered ? "border-amber-300 bg-amber-50 text-amber-700" : "border-sky-300 bg-sky-50 text-sky-700",
                )}>
                  {life.qty.packaged > life.qty.ordered ? "+" : ""}{(life.qty.packaged - life.qty.ordered).toLocaleString()} vs ordered
                </span>
              )}
            </div>
            {life.amendments.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/60 text-[11px] text-muted-foreground">
                <History className="inline h-3 w-3 mr-1" />
                {life.amendments.length} amendment{life.amendments.length === 1 ? "" : "s"}
                {life.lmcCount > 0 && <span className="ml-1 font-semibold text-amber-600">({life.lmcCount} last-minute)</span>}
                {" — latest: "}{fmtStamp(life.amendments[0].at)} by {life.amendments[0].by}
              </div>
            )}
          </Section>

          <Section icon={Factory} title={`Production — ${life.runs.length} run${life.runs.length === 1 ? "" : "s"}`}>
            {life.runs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No production runs recorded for this order yet.</p>
            ) : (
              <div className="overflow-x-auto -mx-1 px-1">
                <Table className="min-w-[480px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 text-[10px] uppercase tracking-wider">Run</TableHead>
                      <TableHead className="h-8 text-[10px] uppercase tracking-wider">Item</TableHead>
                      <TableHead className="h-8 text-[10px] uppercase tracking-wider text-right">Produced</TableHead>
                      <TableHead className="h-8 text-[10px] uppercase tracking-wider">QC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {life.runs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="py-1.5 font-mono text-[11px] text-primary">{r.id}</TableCell>
                        <TableCell className="py-1.5 text-xs">{r.outputItemName ?? r.bom}</TableCell>
                        <TableCell className="py-1.5 text-xs text-right tabular-nums">{r.producedQty.toLocaleString()}</TableCell>
                        <TableCell className="py-1.5">
                          {r.qcPassedAt ? (
                            <Badge variant="outline" className="text-[9px] border-success/40 text-success">Passed {fmtStamp(r.qcPassedAt)}</Badge>
                          ) : r.qcFailedAt ? (
                            <Badge variant="outline" className="text-[9px] border-destructive/40 text-destructive">Failed</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] text-muted-foreground">Pending</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          <Section icon={Package} title={`Packaging — ${life.packagedCount}/${life.allocs.length} done`}>
            {life.allocs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No packaging runs raised for this flight yet.</p>
            ) : (
              <div className="overflow-x-auto -mx-1 px-1">
                <Table className="min-w-[480px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 text-[10px] uppercase tracking-wider">Packaging ID</TableHead>
                      <TableHead className="h-8 text-[10px] uppercase tracking-wider">Item</TableHead>
                      <TableHead className="h-8 text-[10px] uppercase tracking-wider text-right">Qty</TableHead>
                      <TableHead className="h-8 text-[10px] uppercase tracking-wider">Status</TableHead>
                      <TableHead className="h-8 text-[10px] uppercase tracking-wider">Packaged At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {life.allocs.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="py-1.5 font-mono text-[11px]">{a.packagingId}</TableCell>
                        <TableCell className="py-1.5 text-xs">
                          {a.setCode && (
                            <span className="mr-1 inline-flex items-center rounded-full bg-fuchsia-100 px-1.5 py-0.5 text-[9px] font-bold text-fuchsia-700">
                              <Layers className="h-2.5 w-2.5 mr-0.5" />{a.setCode}
                            </span>
                          )}
                          {a.item}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs text-right tabular-nums">{a.qty.toLocaleString()}</TableCell>
                        <TableCell className="py-1.5 text-xs">{a.status}</TableCell>
                        <TableCell className="py-1.5 text-xs tabular-nums text-muted-foreground">{a.packagedAt ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          <Section icon={Truck} title="Dispatch">
            {life.dispatchRec ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="font-mono text-[11px] text-primary">{life.dispatchRec.id}</span>
                <span>{life.dispatchRec.status}</span>
                <span className="text-muted-foreground">{life.dispatchRec.kitchenName}</span>
                {life.dispatchRec.dispatchedBy && <span className="text-muted-foreground">by {life.dispatchRec.dispatchedBy}</span>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {life.doneCount >= 5 ? "Dispatched (order status) — no dispatch record matched this flight + date." : "Not configured for dispatch yet."}
              </p>
            )}
            {lead && (
              <div className="mt-2 pt-2 border-t border-border/60 flex flex-wrap items-center gap-2 text-[11px]">
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold", lead.cls)}>
                  <Clock className="h-2.5 w-2.5" />{lead.label}
                </span>
                <span className="tabular-nums">{life.leadHours!.toFixed(1)}h before ETD</span>
                <span className="text-muted-foreground">
                  · rule: dispatch at least {DISPATCH_LEAD_MIN_HOURS}–{DISPATCH_LEAD_TARGET_HOURS}h prior to flight time
                </span>
              </div>
            )}
          </Section>

          {/* Cold chain — the vehicle sheet and the airport's signature. */}
          <Section icon={Thermometer} title="Cold Chain & Airport Receipt">
            {!life.dmEntry ? (
              <p className="text-xs text-muted-foreground">No dispatch monitoring sheet raised for this load yet.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
                  <div><span className="text-muted-foreground">Sheet</span><div className="font-mono text-[11px] text-primary">{life.dmEntry.dispatchNo ?? life.dmEntry.id}</div></div>
                  <div><span className="text-muted-foreground">Vehicle</span><div className="font-medium">{life.dmEntry.vehicleNo || "—"}</div></div>
                  <div>
                    <span className="text-muted-foreground">Vehicle Clean</span>
                    <div className={cn("font-semibold", life.dmEntry.vehicleClean === "No" && "text-destructive")}>{life.dmEntry.vehicleClean || "—"}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Result</span>
                    <div className={cn("font-semibold", life.dmEntry.resultSatisfy === "No" && "text-destructive")}>
                      {life.dmEntry.resultSatisfy === "Yes" ? "Satisfied" : life.dmEntry.resultSatisfy === "No" ? "Not satisfied" : "—"}
                    </div>
                  </div>
                  <div><span className="text-muted-foreground">Chilled / Frozen</span><div className="tabular-nums">{life.dmEntry.chilledTemp || "—"} / {life.dmEntry.frozenTemp || "—"} °C</div></div>
                  <div><span className="text-muted-foreground">Vehicle temp in / out</span><div className="tabular-nums">{life.dmEntry.vehicleTempBegin || "—"} / {life.dmEntry.vehicleTempEnd || "—"} °C</div></div>
                  <div><span className="text-muted-foreground">Load start / end</span><div className="tabular-nums">{life.dmEntry.loadStartTime || "—"} → {life.dmEntry.loadEndTime || "—"}</div></div>
                  <div><span className="text-muted-foreground">Gate temp</span><div className="tabular-nums">{life.dmEntry.gateTempGate08 || "—"}</div></div>
                </div>
                <div className="mt-2 pt-2 border-t border-border/60 text-[11px]">
                  {life.dmEntry.receivedAt ? (
                    <span className="text-emerald-700">
                      <PlaneLanding className="inline h-3 w-3 mr-1" />
                      Received {life.dmEntry.receivedAt}
                      {life.dmEntry.receivedBy && ` by ${life.dmEntry.receivedBy}`}
                      {life.dmEntry.receivedDesignation && ` (${life.dmEntry.receivedDesignation})`}
                      {life.dmEntry.containersTotal ? ` · ${life.dmEntry.containersScanned ?? 0}/${life.dmEntry.containersTotal} containers scanned` : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not signed for at the airport yet.</span>
                  )}
                </div>
              </>
            )}
          </Section>

          <Section icon={Boxes} title="Galley Loading">
            {!life.galleyRec ? (
              <p className="text-xs text-muted-foreground">No galley plan forwarded for this flight.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
                <div><span className="text-muted-foreground">Status</span><div className="font-medium capitalize">{life.galleyRec.galleyStatus.replace(/_/g, " ")}</div></div>
                <div><span className="text-muted-foreground">Started</span><div className="tabular-nums">{fmtStamp(life.galleyRec.loadingStartedAt) ?? "—"}</div></div>
                <div><span className="text-muted-foreground">Completed</span><div className="tabular-nums">{fmtStamp(life.galleyRec.loadingCompletedAt) ?? "—"}</div></div>
                <div>
                  <span className="text-muted-foreground">Duration</span>
                  <div className="tabular-nums">{life.galleyRec.loadingDurationSec != null ? `${Math.round(life.galleyRec.loadingDurationSec / 60)}m` : "—"}</div>
                </div>
                <div className="col-span-2 sm:col-span-4 text-[11px] text-muted-foreground">
                  Handed over by {life.galleyRec.signOff.handedOverBy.name || "—"} · checked by {life.galleyRec.signOff.flightCheckedBy.name || "—"}
                </div>
              </div>
            )}
          </Section>

          {life.delay && (
            <Section icon={Ban} title="Delay">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
                <div><span className="text-muted-foreground">Event</span><div className="font-mono text-[11px] text-primary">{life.delay.id}</div></div>
                <div><span className="text-muted-foreground">Delay</span><div className="font-semibold tabular-nums">{life.delay.delayDurationHours}h</div></div>
                <div><span className="text-muted-foreground">Status</span><div className="font-medium">{life.delay.status}</div></div>
                <div><span className="text-muted-foreground">Reported by</span><div>{life.delay.reportedBy}</div></div>
                <div className="col-span-2 sm:col-span-4"><span className="text-muted-foreground">Reason</span><div>{life.delay.reason}</div></div>
              </div>
            </Section>
          )}

          {/* Cycle times — where the leg actually spent its hours. */}
          <Section icon={Timer} title="Timeline & Cycle Times">
            <div className="overflow-x-auto -mx-1 px-1">
              <Table className="min-w-[420px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider">Stage</TableHead>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider">Recorded</TableHead>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider text-right">Since previous</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    let prev: string | undefined;
                    return STAGES.map((s) => {
                      const at = life.stamps[s.key];
                      const gap = at && prev ? elapsed(prev, at) : null;
                      if (at) prev = at;
                      return (
                        <TableRow key={s.key}>
                          <TableCell className="py-1.5 text-xs font-medium">
                            {s.label}
                            {s.key === "departure" && <span className="ml-1 text-[10px] text-muted-foreground">(scheduled ETD)</span>}
                          </TableCell>
                          <TableCell className="py-1.5 text-xs tabular-nums text-muted-foreground">{fmtStamp(at) ?? "—"}</TableCell>
                          <TableCell className="py-1.5 text-xs tabular-nums text-right">{gap ?? "—"}</TableCell>
                        </TableRow>
                      );
                    });
                  })()}
                </TableBody>
              </Table>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Only stages a module actually stamped show a time — a blank row means nothing recorded it, not that it took no time.
            </p>
          </Section>

          <Section icon={Wallet} title="Estimated Food Cost">
            {!costing || costing.total === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing packaged for this leg yet.</p>
            ) : costing.priced === 0 ? (
              <p className="text-xs text-muted-foreground">
                None of the {costing.total.toLocaleString()} packaged portions has a configured price — set item prices under Configuration to cost this leg.
              </p>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                <span className="text-lg font-bold tabular-nums text-primary">{money(costing.cost)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {money(costing.cost / costing.priced)} per portion · {costing.priced.toLocaleString()} of {costing.total.toLocaleString()} portions priced
                </span>
                {costing.priced < costing.total && (
                  <span className="text-amber-600">Partial — {(costing.total - costing.priced).toLocaleString()} portions have no price configured.</span>
                )}
              </div>
            )}
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function OperationalReportPage() {
  const flightOrders = useFlightOrders();
  const { productionEntries } = useWorkflow();
  const [allocations] = usePersistedState<PackagingAllocation[]>("packaging-allocations", []);
  const [dispatchRecords] = usePersistedState<DispatchRecord[]>("dispatch-records", INITIAL_RECORDS);

  // Cold chain, galley, delays and prices live outside the reactive stores this
  // page already subscribes to (sessionStorage and one-shot readers). Re-read
  // them when the tab is focused: the report is a review surface, so "fresh as
  // of when you looked at it" is the honest contract, and polling 3,000 legs
  // every few seconds to catch a receipt would cost far more than it's worth.
  const [external, setExternal] = useState(() => ({
    dm: loadDispatchEntries(),
    galley: loadGalleyRecords(),
    delays: loadDelayEvents(),
    prices: readItemPrices(),
  }));
  useEffect(() => {
    const refresh = () => setExternal({
      dm: loadDispatchEntries(),
      galley: loadGalleyRecords(),
      delays: loadDelayEvents(),
      prices: readItemPrices(),
    });
    const onVisible = () => { if (!document.hidden) refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [scope, setScope] = useState<"all" | "Domestic" | "International">("all");
  const [airlineF, setAirlineF] = useState("all");
  const [statusF, setStatusF] = useState<"all" | FlightOrderStatus>("all");
  /** Stage chip filter — the index of the stage a leg is currently AT. */
  const [stageF, setStageF] = useState<number | "all">("all");
  /** Show only legs carrying at least one exception flag. */
  const [flagged, setFlagged] = useState(false);
  const [viewLife, setViewLife] = useState<LegLife | null>(null);

  // Airline options from the order book itself, so the list stays correct as
  // carriers are added — not a hard-coded pair.
  const airlines = useMemo(
    () => Array.from(new Set(flightOrders.map((o) => o.airline).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [flightOrders],
  );

  // Cross-module lookup maps, built once per data change.
  const lookups = useMemo(() => {
    const runsByOrderDate = new Map<string, WfProductionEntry[]>();
    const runById = new Map<string, WfProductionEntry>();
    for (const e of productionEntries) {
      runById.set(e.id, e);
      for (const ono of e.servesOrderNos ?? []) {
        const k = `${ono}|${e.date}`;
        (runsByOrderDate.get(k) ?? runsByOrderDate.set(k, []).get(k)!).push(e);
      }
    }
    const allocsByLeg = new Map<string, PackagingAllocation[]>();
    for (const a of allocations) {
      const k = `${a.flight}|${a.date}`;
      (allocsByLeg.get(k) ?? allocsByLeg.set(k, []).get(k)!).push(a);
    }
    const dispatchByLeg = new Map<string, DispatchRecord>();
    for (const r of dispatchRecords) {
      for (const f of r.flightNos) dispatchByLeg.set(`${f}|${r.date}`, r);
    }
    // One monitoring sheet covers every flight on its vehicle, so index it by
    // each of them. Dated, NOT flight-only: a flight number recurs every day, so
    // a bare flight key handed June's receipt to August's leg and reported
    // ninety-odd flights as galley-loaded off two seeded sheets.
    const dmByFlight = new Map<string, DatedRec<DispatchEntry>[]>();
    for (const e of external.dm) {
      const legs = new Set([...(e.loadFlights ?? []), e.flightId].filter(Boolean));
      for (const f of legs) pushDated(dmByFlight, f, e.packagingDate, e);
    }
    // Galley records name their flight in the label ("BS-105 — DAC→CXB").
    const galleyByFlight = new Map<string, DatedRec<GalleyLoadingRecord>[]>();
    for (const g of external.galley) {
      const code = (g.flightLabel ?? "").split("—")[0].trim() || g.flightId;
      if (code) pushDated(galleyByFlight, code, g.date, g);
    }
    const delayByLeg = new Map<string, DelayEvent>();
    for (const d of external.delays) {
      if (!isActiveDelayEvent(d) && d.status !== "Closed") continue;
      delayByLeg.set(`${d.flightNumber}|${d.flightDate}`, d);
    }
    const aircraftByFlight = new Map<string, string>();
    for (const f of FLIGHT_BOARD) if (f.aircraft) aircraftByFlight.set(f.flight, f.aircraft);
    return { runsByOrderDate, runById, allocsByLeg, dispatchByLeg, dmByFlight, galleyByFlight, delayByLeg, aircraftByFlight };
  }, [productionEntries, allocations, dispatchRecords, external]);

  // Passenger flight legs only — crew meal orders ride the same flights and
  // would double every row without adding a lifecycle of their own.
  const livesBase = useMemo(() => {
    const q = search.trim().toLowerCase();
    return flightOrders
      .filter((o) => (o.orderType ?? "flight") !== "crew")
      .filter((o) => !dateFrom || o.date >= dateFrom)
      .filter((o) => !dateTo || o.date <= dateTo)
      .filter((o) => scope === "all" || (isDomesticSector(o.sector) ? "Domestic" : "International") === scope)
      .filter((o) => airlineF === "all" || o.airline === airlineF)
      .filter((o) => statusF === "all" || o.status === statusF)
      .filter((o) => !q || `${o.orderNo} ${o.flight} ${o.airline} ${o.sector}`.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || b.etd.localeCompare(a.etd))
      .map((leg) => buildLegLife(
        leg, lookups.runsByOrderDate, lookups.runById, lookups.allocsByLeg, lookups.dispatchByLeg,
        lookups.dmByFlight, lookups.galleyByFlight, lookups.delayByLeg, lookups.aircraftByFlight,
        external.prices,
      ));
  }, [flightOrders, search, dateFrom, dateTo, scope, airlineF, statusF, lookups, external.prices]);

  /** The stage a leg is currently AT (its last dot, once every stage is done). */
  const currentStage = (l: LegLife) => Math.min(l.doneCount, STAGES.length - 1);

  // Stage / exception filters are applied AFTER the KPI + chip counts are taken,
  // so drilling into one stage doesn't zero out the picture you drilled from.
  const lives = useMemo(
    () => livesBase
      .filter((l) => stageF === "all" || currentStage(l) === stageF)
      .filter((l) => !flagged || l.flags.length > 0),
    [livesBase, stageF, flagged],
  );

  // Group by Order # (the document), preserving the date-desc leg order.
  const groups = useMemo(() => {
    const map = new Map<string, LegLife[]>();
    for (const l of lives) {
      (map.get(l.leg.orderNo) ?? map.set(l.leg.orderNo, []).get(l.leg.orderNo)!).push(l);
    }
    return Array.from(map.entries());
  }, [lives]);

  const [page, setPage] = useState(1);
  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageGroups = groups.slice((safePage - 1) * pageSize, safePage * pageSize);

  const kpi = useMemo(() => {
    const measured = livesBase.filter((l) => l.leadHours != null);
    const onTime = measured.filter((l) => l.leadHours! >= DISPATCH_LEAD_MIN_HOURS).length;
    return {
      flights: livesBase.length,
      exceptions: livesBase.filter((l) => l.flags.length > 0).length,
      // Share of measurable dispatches that met the lead-time rule. Legs with no
      // recorded departure from the kitchen are excluded rather than counted as
      // failures — an unmeasured dispatch is not a late one.
      onTimePct: measured.length ? Math.round((onTime / measured.length) * 100) : null,
      onTimeMeasured: measured.length,
      departed: livesBase.filter((l) => l.doneCount >= STAGES.length).length,
    };
  }, [livesBase]);

  /** How many legs sit at each stage — the breakdown the single "in pipeline"
   *  number used to hide. */
  const stageCounts = useMemo(() => {
    const counts = new Array(STAGES.length).fill(0) as number[];
    for (const l of livesBase) counts[currentStage(l)]++;
    return counts;
  }, [livesBase]);

  const hasFilters = !!(search || dateFrom || dateTo || scope !== "all" || airlineF !== "all" || statusF !== "all" || stageF !== "all" || flagged);

  // Export / Print — the filtered flight list, one row per leg, with the
  // lifecycle expressed as "done/6 · current stage" so it survives on paper.
  const exportTable = () => ({
    title: "Operational Report — Order Lifecycle",
    fileName: `operational-report-${dateFrom || "all"}${dateTo && dateTo !== dateFrom ? `_to_${dateTo}` : ""}`,
    meta: filterMeta([
      ["Dates", (dateFrom || dateTo) && `${dateFrom || "…"} → ${dateTo || "…"}`],
      ["Type", scope !== "all" && scope],
      ["Airline", airlineF !== "all" && airlineF],
      ["Status", statusF !== "all" && statusF],
      ["Stage", stageF !== "all" && STAGES[stageF].label],
      ["Exceptions only", flagged && "Yes"],
      ["Search", search.trim() || false],
    ]),
    columns: [
      "Order", "Flight", "Direction", "Sector", "Aircraft", "Airline", "Date", "ETD",
      "Ordered", "Packaged", "Variance", "Status", "Lifecycle", "Production", "Packaging",
      "Dispatch", "Left Kitchen", "Lead (h)", "On Time", "Airport Receipt", "Galley", "Delay",
      "Est. Cost", "Flags",
    ],
    numericCols: [8, 9, 10, 17, 22],
    rows: lives.map((l) => [
      l.leg.orderNo, l.leg.flight, l.leg.direction, l.leg.sector, l.aircraft ?? "—", l.leg.airline, l.leg.date, l.leg.etd,
      l.qty.ordered, l.qty.packaged, l.qty.packaged > 0 ? l.qty.packaged - l.qty.ordered : "—",
      l.leg.status,
      l.doneCount >= STAGES.length
        ? `Complete (${STAGES.length}/${STAGES.length})`
        : `${l.doneCount}/${STAGES.length} — at ${STAGES[l.doneCount].label}`,
      l.runs.length ? `${l.runs.length} runs · ${l.qcPassed} QC passed${l.qcFailed ? ` · ${l.qcFailed} failed` : ""} · ${l.producedQty} portions` : "—",
      l.allocs.length ? `${l.packagedCount}/${l.allocs.length} done` : "—",
      l.dispatchRec ? `${l.dispatchRec.id} · ${l.dispatchRec.status}` : "—",
      fmtStamp(l.stamps.dispatch) ?? "—",
      l.leadHours != null ? Number(l.leadHours.toFixed(1)) : "—",
      leadVerdict(l.leadHours)?.label ?? "—",
      l.dmEntry?.receivedAt ? `${l.dmEntry.receivedAt}${l.dmEntry.receivedBy ? ` · ${l.dmEntry.receivedBy}` : ""}` : "—",
      l.galleyRec ? l.galleyRec.galleyStatus.replace(/_/g, " ") : "—",
      l.delay ? `${l.delay.delayDurationHours}h · ${l.delay.status}` : "—",
      l.cost != null ? Math.round(l.cost) : "—",
      l.flags.length ? l.flags.map((f) => f.label).join(", ") : "—",
    ]),
  });

  return (
    <>
      <PageHeader
        title="Operational Report"
        subtitle="The full order-to-departure lifecycle of every flight — order, approval, production, packaging, dispatch and departure on one line"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Flights" value={kpi.flights} icon={Plane} tone="navy" />
        <KpiCard label="Flights With Exceptions" value={kpi.exceptions} icon={AlertTriangle} tone="red" />
        <KpiCard
          label={`On-Time Dispatch${kpi.onTimeMeasured ? ` (${kpi.onTimeMeasured} measured)` : ""}`}
          value={kpi.onTimePct == null ? "—" : `${kpi.onTimePct}%`}
          icon={Clock}
          tone={kpi.onTimePct != null && kpi.onTimePct < 90 ? "warning" : "success"}
        />
        <KpiCard label="Departed / Completed" value={kpi.departed} icon={PlaneTakeoff} tone="info" />
      </div>

      {/* Stage breakdown — one chip per stage, each a filter. Replaces the single
          "in pipeline" figure, which said 3,183 and meant nothing actionable. */}
      <div className="flex flex-wrap items-center gap-1.5 mb-5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">Currently at</span>
        {STAGES.map((s, i) => {
          const active = stageF === i;
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => { setStageF(active ? "all" : i); setPage(1); }}
              title={`${stageCounts[i]} flight${stageCounts[i] === 1 ? "" : "s"} at ${s.label}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary font-semibold"
                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              <Icon className="h-3 w-3" />
              {s.label}
              <span className="tabular-nums font-semibold">{stageCounts[i].toLocaleString()}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => { setFlagged(!flagged); setPage(1); }}
          title="Show only flights carrying an exception"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ml-1",
            flagged
              ? "border-red-400 bg-red-50 text-red-700 font-semibold"
              : "border-border bg-background text-muted-foreground hover:border-red-300 hover:text-red-700",
          )}
        >
          <AlertTriangle className="h-3 w-3" />
          Exceptions
          <span className="tabular-nums font-semibold">{kpi.exceptions.toLocaleString()}</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Search</span>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Order, flight, airline or sector…" className="h-8 text-xs pl-7" />
          </div>
        </div>
        <div className="flex flex-col gap-1 min-w-[130px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">From</span>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-8 text-xs tabular-nums" />
        </div>
        <div className="flex flex-col gap-1 min-w-[130px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">To</span>
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-8 text-xs tabular-nums" />
        </div>
        <div className="flex flex-col gap-1 min-w-[140px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Flight Type</span>
          <select
            value={scope}
            onChange={(e) => { setScope(e.target.value as typeof scope); setPage(1); }}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="all">All</option>
            <option value="Domestic">Domestic</option>
            <option value="International">International</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-[150px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Airline</span>
          <select
            value={airlineF}
            onChange={(e) => { setAirlineF(e.target.value); setPage(1); }}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="all">All</option>
            {airlines.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-[140px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Status</span>
          <select
            value={statusF}
            onChange={(e) => { setStatusF(e.target.value as typeof statusF); setPage(1); }}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="all">All</option>
            {(Object.keys(DONE_COUNT) as FlightOrderStatus[]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setScope("all"); setAirlineF("all"); setStatusF("all"); setStageF("all"); setFlagged(false); setPage(1); }}
            className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors self-end"
          >
            Clear
          </button>
        )}
        <div className="ml-auto self-end"><ListExportActions table={exportTable} /></div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          {hasFilters ? "No flights match the selected filters." : "No flight orders yet."}
        </div>
      ) : (
        <div className="space-y-3">
          {pageGroups.map(([orderNo, legs]) => {
            // Departed means EVERY stage complete — not "past the sixth dot",
            // which quietly counted galley-loaded flights as departed once the
            // stepper grew to eight.
            const done = legs.filter((l) => l.doneCount >= STAGES.length).length;
            return (
              <div key={orderNo} className="overflow-hidden rounded-xl border border-border bg-card">
                {/* Order band — the document these flights arrived on. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2" style={{ background: "var(--color-bg-subtle, #f6f2ef)" }}>
                  <span className="text-sm font-bold tracking-[0.01em] text-[#E10101]">{orderNo}</span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground rounded-md border border-border bg-background px-2 py-[3px]">
                    {legs.length} flight{legs.length === 1 ? "" : "s"}
                  </span>
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                    {done} of {legs.length} departed
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <Table className="min-w-[1120px]">
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider">Flight</TableHead>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider">Sector</TableHead>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider">Date · ETD</TableHead>
                        {/* Two columns, not one "Ordered · Packaged" — right-aligning a
                            combined pair left a wide gap under the first heading, which
                            read as an empty column. */}
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider text-right">Ordered</TableHead>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider text-right">Packaged</TableHead>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider">Lifecycle</TableHead>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider">Lead</TableHead>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider">Flags</TableHead>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider text-right">View</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {legs.map((l) => (
                        <TableRow key={l.leg.id} className="hover:bg-muted/20">
                          <TableCell className="py-2 font-medium text-xs whitespace-nowrap">
                            {l.leg.flight}
                            {l.leg.direction === "Return" && (
                              <span className="ml-1.5 text-[9px] font-semibold uppercase text-muted-foreground">Return</span>
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-xs whitespace-nowrap">{l.leg.sector}</TableCell>
                          <TableCell className="py-2 text-xs tabular-nums whitespace-nowrap">{l.leg.date} · {l.leg.etd}</TableCell>
                          <TableCell className="py-2 text-xs text-right tabular-nums whitespace-nowrap"
                            title={`${l.leg.pax} PAX · ${l.leg.crew} crew · ${l.leg.specialMeals} special`}>
                            {l.qty.ordered.toLocaleString()}
                          </TableCell>
                          <TableCell className="py-2 text-xs text-right tabular-nums whitespace-nowrap"
                            title={l.qty.packaged
                              ? `${l.qty.packaged} packaged for this leg against ${l.qty.ordered} ordered`
                              : "Nothing packaged for this leg yet"}>
                            {l.qty.packaged > 0 ? (
                              <span className={cn(
                                l.qty.packaged < l.qty.ordered && "text-amber-600 font-semibold",
                                l.qty.packaged > l.qty.ordered && "text-sky-600 font-semibold",
                              )}>
                                {l.qty.packaged.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="py-2"><LifecycleStepper life={l} /></TableCell>
                          <TableCell className="py-2 whitespace-nowrap">
                            {(() => {
                              const v = leadVerdict(l.leadHours);
                              if (!v) return <span className="text-[11px] text-muted-foreground">—</span>;
                              return (
                                <span
                                  title={`Left the kitchen ${l.leadHours!.toFixed(1)}h before ETD · rule is at least ${DISPATCH_LEAD_MIN_HOURS}–${DISPATCH_LEAD_TARGET_HOURS}h`}
                                  className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums", v.cls)}
                                >
                                  {l.leadHours!.toFixed(1)}h
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="py-2">
                            {l.flags.length === 0 ? (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1 max-w-[190px]">
                                {l.flags.map((f) => (
                                  <span key={f.key} title={f.title}
                                    className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wide whitespace-nowrap", FLAG_TONE[f.tone])}>
                                    {f.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          {/* No Status column: the lifecycle stepper already names the
                              stage, and the badge disagreed with it on sight — a leg
                              whose status is "Approved" is AT Production, so the two
                              read as a contradiction. The stored status still drives
                              the stepper, the Status filter and the row's detail. */}
                          <TableCell className="py-2 text-right">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              title={`Full lifecycle of ${l.leg.flight}`}
                              aria-label={`View lifecycle of ${l.leg.flight}`}
                              onClick={() => setViewLife(l)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })}

          {/* Pagination — by order group so an order's flights stay together. */}
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {groups.length} order{groups.length === 1 ? "" : "s"} · {lives.length} flight{lives.length === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                  Prev
                </Button>
                <span className="text-[11px] text-muted-foreground tabular-nums">{safePage} / {totalPages}</span>
                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <LegDetailDialog life={viewLife} prices={external.prices} onClose={() => setViewLife(null)} />
    </>
  );
}
