import { useMemo, useState } from "react";
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LayoutGrid, Plane, CheckCircle2, Clock, Eye, Search, Send, Printer, X as CloseIcon,
} from "lucide-react";
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
  const [entries] = useState<DispatchEntry[]>(() => loadDispatchEntries());
  const [galleyRecords, setGalleyRecords] = useState<GalleyLoadingRecord[]>(() => loadGalleyRecords());
  const [drafts, setDrafts] = useState<Record<string, GalleyDraft>>(() => loadDrafts());
  const [planEntryId, setPlanEntryId] = useState<string | null>(null);
  const [viewEntryId, setViewEntryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RowStatus>("all");

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

  const rowStatus = (entryId: string): RowStatus =>
    recByEntry.get(entryId)?.galleyStatus ?? (drafts[entryId] ? "draft" : "not_planned");

  const pendingCount = entries.filter((e) => !recByEntry.has(e.id)).length;
  const approvedCount = galleyRecords.filter((r) => r.galleyStatus === "approved").length;
  const inFlowCount = galleyRecords.length - approvedCount;

  const visibleEntries = entries.filter((e) => {
    if (statusFilter !== "all" && rowStatus(e.id) !== statusFilter) return false;
    if (!query.trim()) return true;
    const f = flights.find((x) => x.id === e.flightId);
    const hay = `${f?.flight ?? e.flightId} ${f?.sector ?? ""} ${airlineOf(f?.flight)} ${f?.aircraft ?? ""} ${e.packagingDate}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
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
    setPlanEntryId(null);
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

  const planEntry = planEntryId ? entries.find((e) => e.id === planEntryId) : undefined;
  const planFlight = planEntry ? flights.find((f) => f.id === planEntry.flightId) : undefined;
  const viewRec = viewEntryId ? recByEntry.get(viewEntryId) : undefined;
  const viewFlight = viewRec ? flights.find((f) => f.id === viewRec.flightId) : undefined;

  return (
    <>
      <PageHeader
        title="Galley Planning"
        subtitle="Plan the per-flight galley load — meals, beverages, amenities, consumables & equipment — then forward to aircraft loading"
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
            <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
              {visibleEntries.length} of {entries.length} dispatches
            </span>
          </div>

          <div className="border border-border rounded-md overflow-hidden">
            <Table className="min-w-[960px]">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Airline</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Aircraft</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider">PAX</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider">Crew</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Galley Status</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-10">
                      {entries.length === 0 ? "No dispatches to plan." : "No dispatches match the current filters."}
                    </TableCell>
                  </TableRow>
                ) : visibleEntries.map((e) => {
                  const f = flights.find((x) => x.id === e.flightId);
                  const rec = recByEntry.get(e.id);
                  const status = rowStatus(e.id);
                  return (
                    <TableRow key={e.id} className="hover:bg-muted/30">
                      <TableCell className="font-semibold">{f?.flight ?? e.flightId}</TableCell>
                      <TableCell>{f?.sector ?? "—"}</TableCell>
                      <TableCell>{airlineOf(f?.flight)}</TableCell>
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
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {planEntry && (
        <GalleyPlanningModal
          entry={planEntry}
          flight={planFlight}
          initialPlan={recByEntry.get(planEntry.id)?.galleyPlan ?? drafts[planEntry.id]?.plan}
          onClose={() => setPlanEntryId(null)}
          onSaveDraft={(plan, source) => saveDraft(planEntry.id, plan, source)}
        />
      )}

      {viewRec && (
        <GalleySheetViewModal rec={viewRec} flight={viewFlight} onClose={() => setViewEntryId(null)} />
      )}
    </>
  );
}
