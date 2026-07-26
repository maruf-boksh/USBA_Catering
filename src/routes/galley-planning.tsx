import { Fragment, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LayoutGrid, Plane, CheckCircle2, Clock, Eye, Search, Send, Printer, ArrowLeft, X as CloseIcon, CalendarDays, Download, Plus, Check, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { consumableItems, type ConsumableItem } from "@/lib/sample-data";
import { officeName, warehouseName } from "@/components/common/LocationPicker";
import { printGalleySheet } from "@/lib/galley-sheet";
import { getGalleySections, loadGalleyItems } from "@/lib/galley-items";
import {
  loadDrafts, persistDrafts, type GalleyDraft,
} from "@/lib/galley-drafts";
import { getAuthUser } from "@/lib/auth";
import { getFlightOrders } from "@/lib/flight-orders-store";
import { resolveFlightOrder, resolveReturnLeg } from "@/lib/order-chain";
// Galley planning was relocated out of Dispatch Monitoring into this module.
// The plan editor (GalleyPlanningModal) and its data plumbing still live in
// dispatch-monitoring.tsx (exported); this page is the new launch surface.
import {
  flights, flightLabel, nowTimeStr,
  loadDispatchEntries, loadGalleyRecords, saveGalleyRecords, scaleDispatchMeals,
  GalleyPlanningModal,
  type DispatchEntry, type FlightOption, type GalleyLoadingRecord, type GalleyPlan, type GalleyStatus,
} from "@/routes/dispatch-monitoring";

// ── Galley Plan ↔ Airline Consumables integration ────────────────────────────
// Forwarding a galley plan creates a consumable Flight Allocation and deducts
// Inventory stock — the same allocation the Flight Allocation / Returns pages
// already work against. Which sheet fields map to which consumable is defined
// on the Galley Item Master (an item's "Linked Consumable"), so linking a new
// item on the Galley Items page automatically joins it to this flow.

// These pages persist via usePersistedState (prefix "harvest-data-v1:"). We
// read/write the same keys directly so a galley forward flows into them.
const LSK = (k: string) => `harvest-data-v1:${k}`;
function readLS<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(LSK(key)); return raw ? (JSON.parse(raw) as T) : fallback; }
  catch { return fallback; }
}
function writeLS(key: string, val: unknown) {
  try { localStorage.setItem(LSK(key), JSON.stringify(val)); } catch { /* quota — non-fatal */ }
}

type AllocLine = { itemId: string; itemName: string; qty: number; uom: string };
type AllocRecord = {
  id: string; date: string; scheduledTime: string; flight: string; sector: string; lines: AllocLine[];
  officeId?: string; warehouseId?: string; officeName?: string; warehouseName?: string;
};

/** Build a consumable allocation from a galley plan + post it to Inventory
 *  (deducting stock from the chosen source location). Returns the number of
 *  lines allocated, or 0 if none. */
function allocateConsumables(
  plan: GalleyPlan, flight: string, sector: string, date: string, schedTime: string,
  source: { officeId: string; warehouseId: string },
): number {
  // Backfill any seed consumables the saved store lacks: a store persisted
  // before the galley stock items were seeded only has CNS-001..017, whose ids
  // match no galley plan key — so without this, a forward would allocate 0
  // lines and nothing would reach Flight Allocation.
  const saved = readLS<ConsumableItem[]>("airline-consumables-items", consumableItems);
  const have = new Set(saved.map((c) => c.id));
  const missing = consumableItems.filter((c) => !have.has(c.id));
  const master = missing.length ? [...saved, ...missing] : saved;
  // Every galley stock line's plan key IS its inventory id, so allocate any
  // inventory item that has a positive quantity on this plan and deduct it.
  const qtyById = new Map<string, number>();
  const lines: AllocLine[] = [];
  for (const m of master) {
    const qty = Number(plan[m.id]) || 0;
    if (qty <= 0) continue;
    qtyById.set(m.id, qty);
    lines.push({ itemId: m.id, itemName: m.name, qty, uom: m.uom });
  }
  if (lines.length === 0) return 0;

  const stamp = Date.now().toString(36).slice(-5).toUpperCase();
  const alloc: AllocRecord = {
    id: `FA-G${stamp}`, date, scheduledTime: schedTime, flight, sector, lines,
    officeId: source.officeId, warehouseId: source.warehouseId,
    officeName: officeName(source.officeId), warehouseName: warehouseName(source.warehouseId),
  };
  writeLS("consumable-allocations", [alloc, ...readLS<AllocRecord[]>("consumable-allocations", [])]);

  // Deduct the allocated quantities from inventory stock.
  writeLS("airline-consumables-items", master.map((it) =>
    qtyById.has(it.id) ? { ...it, stock: it.stock - (qtyById.get(it.id) ?? 0) } : it,
  ));
  return lines.length;
}

export const STATUS_LABEL: Record<GalleyStatus, string> = {
  forwarded: "Forwarded",
  loading: "Loading",
  completed: "Loaded",
  awaiting_approval: "Awaiting Approval",
  approved: "Approved",
};
const STATUS_CLASS: Record<GalleyStatus, string> = {
  forwarded: "bg-sky-100 text-sky-700 border-sky-200",
  loading: "bg-amber-100 text-amber-700 border-amber-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  awaiting_approval: "bg-violet-100 text-violet-700 border-violet-200",
  approved: "bg-emerald-100 text-emerald-700 border-emerald-200",
};
const badgeCls = "h-5 px-1.5 text-[10px] font-bold uppercase tracking-wider";

/** Row status incl. the two pre-forward states. */
export type RowStatus = GalleyStatus | "draft" | "not_planned";
export const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  ...STATUS_LABEL, draft: "Draft", not_planned: "Not Planned",
};

export function rowStatusBadge(status: RowStatus) {
  if (status === "not_planned") {
    return <Badge variant="outline" className={`${badgeCls} bg-slate-100 text-slate-600 border-slate-300`}>Not Planned</Badge>;
  }
  if (status === "draft") {
    return <Badge variant="outline" className={`${badgeCls} bg-sky-50 text-sky-700 border-sky-300 border-dashed`}>Draft</Badge>;
  }
  return <Badge variant="outline" className={`${badgeCls} ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</Badge>;
}

// ── Read-only sheet view of a forwarded plan ─────────────────────────────────

function ViewRow({ label, value, unit }: { label: string; value: string; unit?: string }) {
  const v = (value ?? "").trim();
  return (
    <div className="flex items-baseline justify-between gap-2 px-2 py-1 border-b border-border/60 last:border-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold tabular-nums whitespace-nowrap">
        {v === "" ? "—" : v}
        {unit && v !== "" && <span className="text-[9px] text-muted-foreground font-normal ml-1">{unit}</span>}
      </span>
    </div>
  );
}

export function GalleySheetViewModal({
  rec, flight, onClose,
}: {
  rec: GalleyLoadingRecord;
  flight: FlightOption | undefined;
  onClose: () => void;
}) {
  const allSections = getGalleySections();
  // Meals are integrated live from Dispatch (Order → Meal Planning → Dispatch),
  // not the fixed catalog fields — so the sheet always reflects the real meal
  // plan. Load counts are recovered from the plan (buildInitialGalley stores
  // depZenithLoad = PAX and totalMealLoad = PAX + Crew), falling back to the
  // flight schedule. Beverages/Amenities/Equipment stay from the saved snapshot.
  const planPax = Number(rec.galleyPlan.depZenithLoad) || flight?.pax || 0;
  const planCrew = Math.max(0, (Number(rec.galleyPlan.totalMealLoad) || 0) - planPax) || flight?.crew || 0;
  const meals = scaleDispatchMeals(flight?.flight, planPax, planCrew, flight?.crew ?? planCrew)?.scaled ?? null;
  const groups = (["Beverages", "Amenities", "Equipment"] as const).map((group) => ({
    group,
    sections: allSections.filter((s) => s.group === group),
  }));
  const signRows = [
    { label: "Dispatch Sheet Prepared By", ...rec.signOff.preparedBy },
    { label: "Physically Handed Over By", ...rec.signOff.physicallyHandedBy },
    { label: "Flight Checked Over By", ...rec.signOff.flightCheckedBy },
    { label: "Flight Handed Over By", ...rec.signOff.handedOverBy },
  ];
  const timeline = [
    { label: "Forwarded", at: rec.forwardedAt },
    { label: "Loading Started", at: rec.loadingStartedAt ? new Date(rec.loadingStartedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : undefined },
    { label: "Loaded", at: rec.loadingCompletedAt ? new Date(rec.loadingCompletedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : undefined },
    { label: "Approved", at: rec.approvedAt },
  ].filter((t) => t.at);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-full max-w-[95vw] lg:max-w-4xl max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-6 py-4 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] text-slate-300 uppercase tracking-widest font-semibold">Handing / Taking Sheet · Read Only</p>
              <h2 className="text-lg font-bold mt-0.5">{rec.flightLabel}</h2>
              <div className="flex flex-wrap items-center gap-2.5 mt-1 text-xs">
                <span className="text-slate-300">{rec.date}</span>
                {flight?.aircraft && <span className="bg-slate-600/60 px-2 py-0.5 rounded-full text-slate-100">{flight.aircraft}</span>}
                {flight && <span className="text-slate-300">PAX {flight.pax} · Crew {flight.crew}</span>}
                {rowStatusBadge(rec.galleyStatus)}
              </div>
              {timeline.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-slate-300">
                  {timeline.map((t) => (
                    <span key={t.label}><span className="uppercase tracking-wider">{t.label}</span> <span className="tabular-nums text-slate-100">{t.at}</span></span>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onClose} className="text-slate-300 hover:text-white p-1 rounded transition-colors shrink-0">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-slate-50/20 px-6 py-5 space-y-6">
          {/* Meals — integrated live from Dispatch, scaled to this plan's load. */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 mb-2">Meals</p>
            {meals ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-white">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1.5 border-b border-border bg-muted/40 rounded-t-lg">
                    Passenger Meals
                  </p>
                  {meals.paxLines.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">No passenger meal lines.</p>
                  ) : meals.paxLines.map((l, i) => (
                    <ViewRow key={i} label={`${l.itemName}${l.percent != null ? ` · ${l.percent}%` : ""}`} value={String(l.qty)} />
                  ))}
                </div>
                {meals.crewMeals.length > 0 && (
                  <div className="rounded-lg border border-border bg-white">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1.5 border-b border-border bg-muted/40 rounded-t-lg">
                      Crew Meals
                    </p>
                    {meals.crewMeals.map((c, i) => (
                      <ViewRow key={i} label={c.type} value={String(c.qty)} />
                    ))}
                  </div>
                )}
                {meals.specialTotal > 0 && (
                  <div className="rounded-lg border border-border bg-white">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1.5 border-b border-border bg-muted/40 rounded-t-lg">
                      Special Meals
                    </p>
                    {[
                      { label: "VGML — Veg / Vegan", qty: meals.special.vgml },
                      { label: "CHML — Child", qty: meals.special.chml },
                      { label: "SPML — Special", qty: meals.special.spml },
                    ].filter((s) => s.qty > 0).map((s) => (
                      <ViewRow key={s.label} label={s.label} value={String(s.qty)} />
                    ))}
                    <ViewRow label="Total Special" value={String(meals.specialTotal)} />
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                No dispatch has been built for <strong>{flight?.flight ?? rec.flightId}</strong> — the meal breakdown integrates here once the flight is dispatched in Packaging &amp; Dispatch.
              </div>
            )}
          </div>

          {groups.map(({ group, sections }) => (
            <div key={group}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 mb-2">{group}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {sections.map((sec) => (
                  <div key={sec.title} className="rounded-lg border border-border bg-white">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1.5 border-b border-border bg-muted/40 rounded-t-lg">
                      {sec.title}
                    </p>
                    {sec.fields.map((f) => (
                      <ViewRow key={f.k} label={f.label} value={rec.galleyPlan[f.k] ?? ""} unit={f.unit} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 mb-2">Sign-Off</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {signRows.map((s) => (
                <div key={s.label} className="rounded-lg border border-sky-100 bg-sky-50 px-2.5 py-2">
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
                  <p className="text-xs font-semibold text-sky-800 mt-0.5">{s.name}</p>
                  <p className="text-[10px] text-slate-500">{s.designation} · <span className="tabular-nums">{s.signedAt}</span></p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t bg-white px-6 py-3 shrink-0 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            className="bg-sky-600 hover:bg-sky-700 text-white"
            onClick={() =>
              printGalleySheet(rec.galleyPlan, {
                flightNo: flight?.flight ?? rec.flightId,
                sector: flight?.sector ?? "—",
                date: rec.date,
                aircraft: flight?.aircraft,
                pax: flight?.pax,
                crew: flight?.crew,
                status: STATUS_LABEL[rec.galleyStatus],
                signOff: signRows.map((s) => ({ label: s.label, name: s.name, designation: s.designation, signedAt: s.signedAt })),
                meals: meals && {
                  paxLines: meals.paxLines,
                  crewMeals: meals.crewMeals,
                  special: meals.special,
                  specialTotal: meals.specialTotal,
                },
              })
            }
          >
            <Printer className="h-3.5 w-3.5 mr-1.5" /> Print Sheet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function GalleyPlanningPage() {
  const [dispatchEntries] = useState<DispatchEntry[]>(() => loadDispatchEntries());
  // Flight-wise plans started from the order book (before/without a dispatch
  // record) — persisted so they survive a reload, merged with the dispatched
  // worklist below.
  const [manualEntries, setManualEntries] = useState<DispatchEntry[]>(
    () => readLS<DispatchEntry[]>("galley-manual-entries", []),
  );
  const [galleyRecords, setGalleyRecords] = useState<GalleyLoadingRecord[]>(() => loadGalleyRecords());
  const [drafts, setDrafts] = useState<Record<string, GalleyDraft>>(() => loadDrafts());
  const [planEntryId, setPlanEntryId] = useState<string | null>(null);
  const [viewEntryId, setViewEntryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RowStatus>("all");
  const [airlineFilter, setAirlineFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Bulk selection (entry ids) and the remaining queue for sequential "Plan".
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [planQueue, setPlanQueue] = useState<string[]>([]);
  // "+ New Galley Plan" dialog — pick a flight from the order book (its return
  // leg is pulled in automatically when the rotation is tagged with one).
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [newPlanFlight, setNewPlanFlight] = useState("");
  const [newPlanDate, setNewPlanDate] = useState("");
  const [flightPickerOpen, setFlightPickerOpen] = useState(false);

  // Dispatched worklist + manual flight-wise plans, deduped by flight+date. A
  // real dispatch entry supersedes a manual plan for the same flight & date.
  const entries = useMemo(() => {
    const byKey = new Set(dispatchEntries.map((e) => `${e.flightId}|${e.packagingDate}`));
    const out = [...dispatchEntries];
    for (const e of manualEntries) {
      const key = `${e.flightId}|${e.packagingDate}`;
      if (byKey.has(key)) continue;
      byKey.add(key);
      out.unshift(e); // newest manual plans sit on top
    }
    return out;
  }, [dispatchEntries, manualEntries]);

  const recByEntry = useMemo(() => {
    const m = new Map<string, GalleyLoadingRecord>();
    for (const r of galleyRecords) m.set(r.dispatchEntryId, r);
    return m;
  }, [galleyRecords]);

  // Airline is captured on the catering order, not the dispatch/flight board —
  // so resolve it from the Order table by flight number (latest order wins).
  const airlineByFlight = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of getFlightOrders()) {
      if (o.flight && o.airline) m.set(o.flight, o.airline);
    }
    return m;
  }, []);
  const airlineOf = (flightNo?: string) =>
    (flightNo && airlineByFlight.get(flightNo)) || "—";

  // Order book — used to pair each outbound with its return leg (same rotation),
  // so the list can show the return flight alongside the one being planned.
  const flightOrders = useMemo(() => getFlightOrders(), []);
  const orderFor = (flightNo?: string, date?: string) =>
    flightNo ? resolveFlightOrder({ flight: flightNo, date }, flightOrders) : undefined;
  const returnLegFor = (flightNo?: string, date?: string) =>
    resolveReturnLeg(orderFor(flightNo, date), flightOrders);
  // Departure time (ETD) of an entry's flight — used for the column and sort.
  const etdOf = (e: DispatchEntry) => {
    const f = flights.find((x) => x.id === e.flightId);
    return f?.dep && f.dep !== "—" ? f.dep : "";
  };

  // ── "+ New Galley Plan" — flight-wise plan creation ──────────────────────────
  // The pickable flights: distinct outbound orders that resolve to a renderable
  // flight on the board. The FIRST order per flight wins (named seeds sort ahead
  // of generated ones), so its date + return leg are the sensible defaults.
  const newPlanFlightOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: {
      flight: string; flightId: string; sector: string; etd: string;
      date: string; airline: string; hasReturn: boolean;
    }[] = [];
    for (const o of flightOrders) {
      if ((o.orderType ?? "flight") === "crew" || o.direction !== "Outbound") continue;
      if (seen.has(o.flight)) continue;
      const fo = flights.find((f) => f.flight === o.flight);
      if (!fo) continue; // must map to a board flight so the row renders fully
      seen.add(o.flight);
      opts.push({
        flight: o.flight, flightId: fo.id, sector: o.sector, etd: o.etd,
        date: o.date, airline: o.airline,
        hasReturn: !!resolveReturnLeg(o, flightOrders),
      });
    }
    return opts.sort((a, b) => a.flight.localeCompare(b.flight));
  }, [flightOrders]);

  const newPlanOpt = newPlanFlightOptions.find((o) => o.flight === newPlanFlight);
  // Live preview of the return leg the chosen flight+date resolves to.
  const newPlanReturn = newPlanOpt
    ? returnLegFor(newPlanOpt.flight, newPlanDate || newPlanOpt.date)?.order
    : undefined;

  const openNewPlan = () => {
    setNewPlanFlight("");
    setNewPlanDate("");
    setShowNewPlan(true);
  };

  // Build a blank dispatch entry for a flight-wise plan. Only the fields the
  // planner reads carry data; the dispatch/QC fields stay empty (this row was
  // never dispatched — it's a plan started ahead of one).
  const blankPlanEntry = (flightId: string, date: string, pax: number): DispatchEntry => ({
    id: `GALLEY-${Date.now().toString(36)}`,
    flightId, packagingDate: date,
    mealLines: [{ type: "Regular", qty: pax > 0 ? String(pax) : "" }],
    vehicleNo: "", vehicleClean: "Yes", chilledTemp: "", frozenTemp: "",
    loadStartTime: "", loadEndTime: "", vehicleTempBegin: "", vehicleTempEnd: "",
    resultSatisfy: "Yes", gateTempGate08: "", unloadingTime: "", checkedByApt: "",
    monitoredByRemarks: "", monitoredAt: "", approvalStage: 0,
    receivedBy: "", receivedDesignation: "", receivedAt: "", receivedRemarks: "",
  });

  const createNewPlan = () => {
    if (!newPlanOpt) { toast.error("Pick a flight first."); return; }
    const date = newPlanDate || newPlanOpt.date;
    // Don't duplicate a flight+date already in the worklist — open it instead.
    const existing = entries.find(
      (e) => e.flightId === newPlanOpt.flightId && e.packagingDate === date,
    );
    if (existing) {
      setShowNewPlan(false);
      setPlanEntryId(existing.id);
      toast.info(`${newPlanOpt.flight} on ${date} is already in the list — opening it.`);
      return;
    }
    const ord = orderFor(newPlanOpt.flight, date);
    const entry = blankPlanEntry(newPlanOpt.flightId, date, ord?.pax ?? 0);
    const next = [entry, ...manualEntries];
    setManualEntries(next);
    writeLS("galley-manual-entries", next);
    setShowNewPlan(false);
    setPlanEntryId(entry.id); // drop straight into the planner
    const retMsg = newPlanReturn ? ` · return leg ${newPlanReturn.flight} included` : "";
    toast.success(`Galley plan started for ${newPlanOpt.flight}${retMsg}.`);
  };

  const rowStatus = (entryId: string): RowStatus =>
    recByEntry.get(entryId)?.galleyStatus ?? (drafts[entryId] ? "draft" : "not_planned");

  const pendingCount = entries.filter((e) => !recByEntry.has(e.id)).length;
  const approvedCount = galleyRecords.filter((r) => r.galleyStatus === "approved").length;
  const inFlowCount = galleyRecords.length - approvedCount;

  // Airlines present across the dispatches — the Airline filter's options.
  const airlineOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      const f = flights.find((x) => x.id === e.flightId);
      const a = airlineOf(f?.flight);
      if (a && a !== "—") set.add(a);
    }
    return [...set].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const visibleEntries = entries.filter((e) => {
    if (statusFilter !== "all" && rowStatus(e.id) !== statusFilter) return false;
    const f = flights.find((x) => x.id === e.flightId);
    if (airlineFilter !== "all" && airlineOf(f?.flight) !== airlineFilter) return false;
    if (dateFrom && e.packagingDate < dateFrom) return false;
    if (dateTo && e.packagingDate > dateTo) return false;
    if (!query.trim()) return true;
    const hay = `${f?.flight ?? e.flightId} ${f?.sector ?? ""} ${airlineOf(f?.flight)} ${f?.aircraft ?? ""} ${e.packagingDate}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  // Ordered for display: by date, then by ETD (blank ETDs sort last).
  const sortedEntries = [...visibleEntries].sort((a, b) => {
    const ka = `${a.packagingDate} ${etdOf(a) || "99:99"}`;
    const kb = `${b.packagingDate} ${etdOf(b) || "99:99"}`;
    return ka.localeCompare(kb);
  });

  const setToday = () => {
    const t = new Date().toISOString().slice(0, 10);
    setDateFrom(t);
    setDateTo(t);
  };

  // Close the planner; if a bulk "Plan" queue is running, advance to the next
  // flight instead of returning to the list.
  const closePlanner = () => {
    setPlanQueue((q) => {
      if (q.length > 0) {
        const [next, ...rest] = q;
        setPlanEntryId(next);
        return rest;
      }
      setPlanEntryId(null);
      return q;
    });
  };

  // ── Bulk selection ──────────────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const saveDraft = (
    entryId: string, plan: GalleyPlan,
    source: { officeId: string; warehouseId: string },
  ) => {
    setDrafts((prev) => {
      const next = { ...prev, [entryId]: { plan, savedAt: nowTimeStr(), source } };
      persistDrafts(next);
      return next;
    });
    toast.success("Galley plan saved — forward it to aircraft from this page.");
  };

  // The forwarded record starts with only the preparer stamped (the forwarding
  // user). The physical hand-off signatories are captured later on the Loading
  // QC & Sign-Off page.
  const initialSignOff = (): GalleyLoadingRecord["signOff"] => {
    const authUser = getAuthUser();
    const blank = { name: "", designation: "", signedAt: "" };
    return {
      preparedBy: { name: authUser?.name ?? "—", designation: authUser?.role ?? "APT Executive", signedAt: nowTimeStr() },
      physicallyHandedBy: { ...blank },
      flightCheckedBy: { ...blank },
      handedOverBy: { ...blank },
    };
  };

  // Persist a finalized galley plan as a "forwarded" loading record — the same
  // hand-off Dispatch Monitoring then executes (Start Loading → QC → approve).
  const forward = (
    entryId: string, plan: GalleyPlan,
    source: { officeId: string; warehouseId: string },
  ) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    const rec: GalleyLoadingRecord = {
      id: `GL-${Date.now().toString(36)}`,
      dispatchEntryId: entryId,
      flightId: entry.flightId,
      flightLabel: flightLabel(entry.flightId),
      date: entry.packagingDate,
      galleyPlan: plan,
      signOff: initialSignOff(),
      galleyStatus: "forwarded",
      forwardedAt: nowTimeStr(),
      sourceOfficeId: source.officeId,
      sourceWarehouseId: source.warehouseId,
    };
    // Allocate consumables to Inventory on the FIRST forward only — re-planning
    // an already-forwarded entry must not double-deduct stock.
    const firstForward = !recByEntry.has(entryId);
    setGalleyRecords((prev) => {
      const next = [...prev.filter((r) => r.dispatchEntryId !== entryId), rec];
      saveGalleyRecords(next);
      return next;
    });
    // The forwarded record supersedes any working draft.
    setDrafts((prev) => {
      if (!prev[entryId]) return prev;
      const next = { ...prev };
      delete next[entryId];
      persistDrafts(next);
      return next;
    });
    let allocMsg = "";
    if (firstForward) {
      const fl = flights.find((f) => f.id === entry.flightId);
      const n = allocateConsumables(plan, fl?.flight ?? entry.flightId, fl?.sector ?? "", entry.packagingDate, fl?.dep ?? "", source);
      if (n > 0) allocMsg = ` · ${n} consumable line${n === 1 ? "" : "s"} transferred from ${warehouseName(source.warehouseId)}`;
    } else {
      allocMsg = " · consumables already allocated";
    }
    closePlanner();
    toast.success(`Galley plan forwarded to aircraft loading${allocMsg}.`);
  };

  // Forward a saved draft straight from the list, using the sign-off + transfer
  // source captured when it was saved (falling back to sensible defaults for a
  // draft saved before those were stored).
  const forwardDraft = (entryId: string) => {
    const draft = drafts[entryId];
    if (!draft) return;
    const source = draft.source ?? { officeId: "OFF-001", warehouseId: "WH-001" };
    if (!source.warehouseId) {
      toast.error("No transfer warehouse on this draft — re-open, pick one, and save.");
      return;
    }
    forward(entryId, draft.plan, source);
  };

  // Bulk forward: forward every selected draft; report what could/couldn't go.
  const bulkForward = () => {
    const ids = [...selected];
    const drafted = ids.filter((id) => rowStatus(id) === "draft");
    if (drafted.length === 0) {
      toast.error("None of the selected rows is a saved draft ready to forward.");
      return;
    }
    drafted.forEach((id) => forwardDraft(id));
    const skipped = ids.length - drafted.length;
    setSelected(new Set());
    toast.success(`${drafted.length} plan${drafted.length === 1 ? "" : "s"} forwarded${skipped > 0 ? ` · ${skipped} skipped (not a draft)` : ""}.`);
  };

  // Bulk plan: open the planner for each selected not-yet-forwarded flight in
  // turn (guided sequence) — planning needs per-flight quantities, so it can't be
  // a single silent batch.
  const bulkPlan = () => {
    const queue = [...selected].filter((id) => !recByEntry.has(id));
    if (queue.length === 0) {
      toast.error("The selected rows are already forwarded — nothing to plan.");
      return;
    }
    setPlanQueue(queue.slice(1));
    setPlanEntryId(queue[0]);
    setSelected(new Set());
    if (queue.length > 1) toast.info(`Planning ${queue.length} flights in sequence — the next opens when you forward or go back.`);
  };

  // ── Export / Print ──────────────────────────────────────────────────────────
  // Flat display rows (outbound + any return leg) for the current filtered list.
  const exportRows = () =>
    sortedEntries.flatMap((e, i) => {
      const f = flights.find((x) => x.id === e.flightId);
      const out = {
        sl: String(i + 1),
        flight: f?.flight ?? e.flightId,
        sector: f?.sector ?? "—",
        airline: airlineOf(f?.flight),
        etd: etdOf(e) || "—",
        date: e.packagingDate,
        pax: String(f?.pax ?? "—"),
        crew: String(f?.crew ?? "—"),
        special: String(orderFor(f?.flight, e.packagingDate)?.specialMeals ?? "—"),
        status: ROW_STATUS_LABEL[rowStatus(e.id)],
      };
      const retLeg = returnLegFor(f?.flight, e.packagingDate)?.order;
      const rows = [out];
      if (retLeg) {
        rows.push({
          sl: "", flight: `↳ ${retLeg.flight} (Return)`, sector: retLeg.sector ?? "—",
          airline: airlineOf(retLeg.flight), etd: retLeg.etd || "—", date: retLeg.date ?? e.packagingDate,
          pax: String(retLeg.pax ?? "—"), crew: String(retLeg.crew ?? "—"),
          special: String(retLeg.specialMeals ?? "—"), status: `Planned with ${out.flight}`,
        });
      }
      return rows;
    });

  const EXPORT_COLS = ["SL", "Flight", "Sector", "Airline", "ETD", "Date", "PAX", "Crew", "Special", "Galley Status"];
  const rowValues = (r: ReturnType<typeof exportRows>[number]) =>
    [r.sl, r.flight, r.sector, r.airline, r.etd, r.date, r.pax, r.crew, r.special, r.status];

  const downloadCsv = () => {
    const rows = exportRows();
    if (rows.length === 0) { toast.error("Nothing to export."); return; }
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [EXPORT_COLS, ...rows.map(rowValues)].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `galley-plan-${dateFrom || "all"}${dateTo && dateTo !== dateFrom ? `_to_${dateTo}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} line${rows.length === 1 ? "" : "s"} to CSV.`);
  };

  const printList = () => {
    const rows = exportRows();
    if (rows.length === 0) { toast.error("Nothing to print."); return; }
    const win = window.open("", "_blank", "width=1024,height=720");
    if (!win) { toast.error("Pop-up blocked — allow pop-ups to print."); return; }
    const range = dateFrom || dateTo ? `${dateFrom || "…"} → ${dateTo || "…"}` : "All dates";
    const body = rows
      .map((r) => `<tr>${rowValues(r).map((v, i) => `<td class="${i === 0 ? "sl" : ""} ${i >= 6 && i <= 8 ? "num" : ""}">${v}</td>`).join("")}</tr>`)
      .join("");
    win.document.write(`<!doctype html><html><head><title>Galley Plan</title><style>
      body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#0f172a}
      h1{font-size:18px;margin:0 0 2px} .meta{color:#64748b;font-size:12px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
      th{background:#f1f5f9;text-transform:uppercase;font-size:10px;letter-spacing:.05em}
      td.num{text-align:right;font-variant-numeric:tabular-nums} td.sl{color:#64748b}
      @media print{@page{margin:14mm}}
    </style></head><body>
      <h1>Galley Plan — Loading List</h1>
      <div class="meta">${range} · ${rows.length} line(s) · printed ${new Date().toLocaleString()}</div>
      <table><thead><tr>${EXPORT_COLS.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
      <script>window.onload=function(){window.print()}</script>
    </body></html>`);
    win.document.close();
  };

  const planEntry = planEntryId ? entries.find((e) => e.id === planEntryId) : undefined;
  const planFlight = planEntry ? flights.find((f) => f.id === planEntry.flightId) : undefined;
  const viewRec = viewEntryId ? recByEntry.get(viewEntryId) : undefined;
  const viewFlight = viewRec ? flights.find((f) => f.id === viewRec.flightId) : undefined;

  // Planning opens as a full page (not a dialog): the list is replaced by the
  // planner until it is closed via Back / the sheet's close control.
  if (planEntry) {
    return (
      <>
        <PageHeader
          title="Galley Plan"
          subtitle="Plan the per-flight galley load — meals, beverages, amenities, consumables & equipment — then forward to aircraft loading"
          actions={
            <Button variant="outline" onClick={closePlanner}>
              <ArrowLeft className="h-4 w-4 mr-1" /> {planQueue.length > 0 ? `Next (${planQueue.length} left)` : "Back to List"}
            </Button>
          }
        />
        <GalleyPlanningModal
          fullPage
          entry={planEntry}
          flight={planFlight}
          initialPlan={recByEntry.get(planEntry.id)?.galleyPlan ?? drafts[planEntry.id]?.plan}
          onClose={closePlanner}
          onSaveDraft={(plan, source) => saveDraft(planEntry.id, plan, source)}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Galley Plan"
        subtitle="Plan the per-flight galley load — meals, beverages, amenities, consumables & equipment — then forward to aircraft loading"
        actions={
          <Button size="sm" className="h-9 text-xs" onClick={openNewPlan} title="Start a galley plan flight-wise from the order book">
            <Plus className="h-4 w-4 mr-1" /> New Galley Plan
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Dispatches"    value={entries.length} icon={Plane}        tone="navy" />
        <KpiCard label="Awaiting Plan" value={pendingCount}   icon={Clock}        tone="warning" />
        <KpiCard label="In Loading Flow" value={inFlowCount}  icon={Send}         tone="info" />
        <KpiCard label="Approved"      value={approvedCount}  icon={CheckCircle2} tone="success" />
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative w-full sm:w-64">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search flight, sector, aircraft…"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-8 w-full sm:w-44 text-xs">
                <SelectValue placeholder="Galley status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(Object.keys(ROW_STATUS_LABEL) as RowStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{ROW_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={airlineFilter} onValueChange={setAirlineFilter}>
              <SelectTrigger className="h-8 w-full sm:w-44 text-xs">
                <SelectValue placeholder="Airline" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All airlines</SelectItem>
                {airlineOptions.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Date range — one field holding both From and To (app-standard pill). */}
            <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1 shadow-sm">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="field-label">Date</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="From date"
                className="h-7 rounded-md border border-input bg-background px-2 text-xs tabular-nums"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="To date"
                className="h-7 rounded-md border border-input bg-background px-2 text-xs tabular-nums"
              />
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  title="Clear date filter"
                >
                  Clear
                </button>
              )}
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={setToday}>Today</Button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {visibleEntries.length} of {entries.length} dispatches
              </span>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={downloadCsv} title="Export the list to CSV (Excel)">
                <Download className="h-3.5 w-3.5 mr-1" /> Export
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={printList} title="Print the list (PDF)">
                <Printer className="h-3.5 w-3.5 mr-1" /> Print
              </Button>
            </div>
          </div>

          {/* Bulk action bar. Plan acts on unplanned / draft rows; Forward can only
              act on rows already planned (saved as a draft) — you cannot forward a
              flight that has not been planned. */}
          {selected.size > 0 && (() => {
            const sel = [...selected];
            const planCount = sel.filter((id) => !recByEntry.has(id)).length;         // not yet forwarded
            const forwardCount = sel.filter((id) => rowStatus(id) === "draft").length; // planned, ready to send
            return (
              <div className="flex flex-wrap items-center gap-2 mb-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                <span className="text-xs font-medium">{selected.size} selected</span>
                <Button size="sm" className="h-7 px-2.5 text-xs" onClick={bulkPlan} disabled={planCount === 0}
                  title={planCount === 0 ? "All selected flights are already forwarded" : undefined}>
                  <LayoutGrid className="h-3 w-3 mr-1" /> Plan{planCount > 0 ? ` (${planCount})` : ""}
                </Button>
                <Button size="sm" className="h-7 px-2.5 text-xs bg-violet-600 hover:bg-violet-700 text-white" onClick={bulkForward} disabled={forwardCount === 0}
                  title={forwardCount === 0 ? "Only planned flights (saved drafts) can be forwarded — plan them first" : undefined}>
                  <Send className="h-3 w-3 mr-1" /> Forward{forwardCount > 0 ? ` (${forwardCount})` : ""}
                </Button>
                {forwardCount === 0 && (
                  <span className="text-[11px] text-muted-foreground">Plan a flight before forwarding.</span>
                )}
                <button type="button" onClick={() => setSelected(new Set())} className="ml-1 text-xs text-muted-foreground hover:text-foreground">
                  Clear
                </button>
              </div>
            );
          })()}

          <div className="border border-border rounded-md overflow-hidden">
            <Table className="min-w-[1120px]">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-primary align-middle"
                      aria-label="Select all"
                      checked={sortedEntries.length > 0 && sortedEntries.every((e) => selected.has(e.id))}
                      onChange={(ev) => {
                        setSelected(ev.target.checked ? new Set(sortedEntries.map((e) => e.id)) : new Set());
                      }}
                    />
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider w-12">SL</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Airline</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">ETD</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Aircraft</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider">PAX</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider">Crew</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider">Special</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Galley Status</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-sm text-muted-foreground py-10">
                      {entries.length === 0 ? "No dispatches to plan." : "No dispatches match the current filters."}
                    </TableCell>
                  </TableRow>
                ) : sortedEntries.map((e, idx) => {
                  const f = flights.find((x) => x.id === e.flightId);
                  const rec = recByEntry.get(e.id);
                  const status = rowStatus(e.id);
                  // The paired return leg of this rotation, if the order is tagged
                  // with one — shown as a sub-row (planned together with the outbound).
                  const ret = returnLegFor(f?.flight, e.packagingDate)?.order;
                  return (
                    <Fragment key={e.id}>
                    <TableRow className="hover:bg-muted/30">
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-primary align-middle"
                          aria-label={`Select ${f?.flight ?? e.flightId}`}
                          checked={selected.has(e.id)}
                          onChange={() => toggleSelect(e.id)}
                        />
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-semibold">{f?.flight ?? e.flightId}</TableCell>
                      <TableCell>{f?.sector ?? "—"}</TableCell>
                      <TableCell>{airlineOf(f?.flight)}</TableCell>
                      <TableCell className="tabular-nums text-xs">{etdOf(e) || "—"}</TableCell>
                      <TableCell className="tabular-nums text-xs">{e.packagingDate}</TableCell>
                      {/* Aircraft is assigned during galley planning — it can't be
                          pre-loaded, so it only appears once a plan is saved. */}
                      <TableCell>
                        {status === "not_planned"
                          ? <span className="text-muted-foreground">—</span>
                          : (f?.aircraft ?? "—")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{f?.pax ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{f?.crew ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{orderFor(f?.flight, e.packagingDate)?.specialMeals ?? "—"}</TableCell>
                      <TableCell>{rowStatusBadge(status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {rec ? (
                            // Once forwarded (a galley record exists) the plan is
                            // locked — only viewable, not re-plannable.
                            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setViewEntryId(e.id)}>
                              <Eye className="h-3 w-3 mr-1" /> View
                            </Button>
                          ) : status === "draft" ? (
                            // A saved plan can be re-opened or forwarded to aircraft.
                            <>
                              <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setPlanEntryId(e.id)}>
                                <LayoutGrid className="h-3 w-3 mr-1" /> Resume Draft
                              </Button>
                              <Button size="sm" className="h-7 px-2.5 text-xs bg-violet-600 hover:bg-violet-700 text-white" onClick={() => forwardDraft(e.id)}>
                                <Send className="h-3 w-3 mr-1" /> Forward
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => setPlanEntryId(e.id)}>
                              <LayoutGrid className="h-3 w-3 mr-1" /> Plan Galley
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {ret && (
                      <TableRow className="bg-muted/20 hover:bg-muted/30">
                        <TableCell />
                        <TableCell />
                        <TableCell className="font-medium text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-muted-foreground/70">↳</span>
                            {ret.flight}
                            <Badge variant="outline" className="h-4 px-1.5 text-[10px] border-amber-300 bg-amber-50 text-amber-700">Return</Badge>
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{ret.sector ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{airlineOf(ret.flight)}</TableCell>
                        <TableCell className="tabular-nums text-xs text-muted-foreground">{ret.etd || "—"}</TableCell>
                        <TableCell className="tabular-nums text-xs text-muted-foreground">{ret.date ?? e.packagingDate}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {status === "not_planned" ? <span className="text-muted-foreground">—</span> : (f?.aircraft ?? "—")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{ret.pax ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{ret.crew ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{ret.specialMeals ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground italic" colSpan={2}>
                          Planned with {f?.flight ?? e.flightId}
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {viewRec && (
        <GalleySheetViewModal rec={viewRec} flight={viewFlight} onClose={() => setViewEntryId(null)} />
      )}

      {/* + New Galley Plan — start a plan flight-wise from the order book. The
          return leg is pulled in automatically when the rotation is tagged. */}
      <Dialog open={showNewPlan} onOpenChange={setShowNewPlan}>
        <DialogContent className="max-w-md">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-bold">New Galley Plan</h2>
            <button type="button" onClick={() => setShowNewPlan(false)} className="text-muted-foreground hover:text-foreground">
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Pick a flight — its return leg is added automatically when the rotation is tagged with one.
          </p>

          <div className="space-y-3">
            <div>
              <label className="field-label">Flight</label>
              <Popover open={flightPickerOpen} onOpenChange={setFlightPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    role="combobox"
                    aria-expanded={flightPickerOpen}
                    className={cn(
                      "mt-1 flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-xs shadow-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      !newPlanOpt && "text-muted-foreground",
                    )}
                  >
                    <span className="truncate text-left">
                      {newPlanOpt
                        ? `${newPlanOpt.flight} · ${newPlanOpt.sector} · ${newPlanOpt.etd}`
                        : "Select or search a flight…"}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[300px] p-0">
                  <Command>
                    <CommandInput placeholder="Search flight, sector, airline…" className="h-9 text-xs" />
                    <CommandList>
                      <CommandEmpty>No flight found.</CommandEmpty>
                      <CommandGroup>
                        {newPlanFlightOptions.map((o) => (
                          <CommandItem
                            key={o.flight}
                            value={`${o.flight} ${o.sector} ${o.airline}`}
                            onSelect={() => {
                              setNewPlanFlight(o.flight);
                              setNewPlanDate(o.date);
                              setFlightPickerOpen(false);
                            }}
                            className="text-xs"
                          >
                            <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", newPlanFlight === o.flight ? "opacity-100" : "opacity-0")} />
                            <span className="truncate">
                              <span className="font-medium">{o.flight}</span>
                              <span className="text-muted-foreground"> · {o.sector} · {o.etd} · {o.airline}</span>
                            </span>
                            {o.hasReturn && (
                              <Badge variant="outline" className="ml-auto h-4 px-1.5 text-[10px] border-amber-300 bg-amber-50 text-amber-700">↔ return</Badge>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <label className="field-label">Plan date</label>
              <input
                type="date"
                value={newPlanDate}
                onChange={(e) => setNewPlanDate(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs tabular-nums mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Defaults to the order date so the return leg &amp; special meals resolve.
              </p>
            </div>

            {newPlanOpt && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{newPlanOpt.flight}</span>
                  <span className="text-muted-foreground">{newPlanOpt.sector} · {newPlanOpt.etd}</span>
                </div>
                {newPlanReturn ? (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="text-muted-foreground/70">↳</span>
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] border-amber-300 bg-amber-50 text-amber-700">Return</Badge>
                    <span>{newPlanReturn.flight} · {newPlanReturn.sector} · {newPlanReturn.etd || "—"}</span>
                  </div>
                ) : (
                  <p className="text-muted-foreground italic">
                    No return leg tagged for this rotation{newPlanDate && newPlanDate !== newPlanOpt.date ? " on this date" : ""}.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowNewPlan(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={createNewPlan} disabled={!newPlanOpt}>
              <LayoutGrid className="h-3.5 w-3.5 mr-1" /> Create &amp; Plan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
