import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  Package, PackageCheck, Printer, CheckCircle2, Eye, Boxes, Clock, Truck, Search, Plane, Plus,
  ChevronDown, Check, Layers, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useWorkflow, type WfProductionEntry } from "@/lib/workflow-store";
import { cn } from "@/lib/utils";
import { INITIAL_PACKAGING_ROWS, type PackagingRow } from "@/routes/dispatch";
import { useFlightOrders, updateFlightOrdersWhere, type FlightOrder } from "@/lib/flight-orders-store";
import {
  UNASSIGNED_FLIGHT, resolveManifestRow, manifestLinesFor, resolveFlightOrder, resolveCrewOrder,
  resolveBatchChain, resolveReturnLeg,
} from "@/lib/order-chain";
import { useArrivalFlash, peekArrivalRows } from "@/lib/arrival-flash";
import { logAudit } from "@/lib/audit-log";
import { getAuthUser } from "@/lib/auth";
import { servedOrderNosFor, flightPortionFor, menuSpecFor, dayFromDate, flightTypeFromSector } from "@/lib/production-order-link";
import { loadMealPlanningConfig } from "@/lib/meal-planning-data";
import { meals, warehouses } from "@/lib/sample-data";
import {
  mergePassedBatches,
  type PackagingBatch,
  type PackagingBatchStatus,
} from "@/lib/packaging-batches";
import {
  allocatedQtyOfRun, flightsOfRun, existingAllocation, newAllocationId, isPackaged, isAwaitingApproval,
  type PackagingAllocation, type PackagingAllocationStatus,
} from "@/lib/packaging-allocations";

// Meal-type pill colors (mirrors the Dispatch Order-Details modal).
const MEAL_TYPE_BADGE: Record<string, string> = {
  Breakfast: "bg-amber-100 text-amber-700",
  Lunch: "bg-orange-100 text-orange-700",
  Dinner: "bg-indigo-100 text-indigo-700",
  Snack: "bg-sky-100 text-sky-700",
  Special: "bg-fuchsia-100 text-fuchsia-700",
};

// System-generated packaging id — one per production package, derived from the
// production order so it is stable across reloads (PRO-2026-1234 → PKG-2026-1234).
const packagingId = (b: PackagingBatch) => `PKG-${b.batch.replace(/^PRO-?/i, "")}`;

const STATUS_TONE: Record<PackagingBatchStatus, string> = {
  "Pending Approval": "border-amber-300 bg-amber-50 text-amber-700",
  "Approved": "border-sky-300 bg-sky-50 text-sky-700",
  "Rejected": "border-rose-300 bg-rose-50 text-rose-700",
  "Packaging In Progress": "border-violet-300 bg-violet-50 text-violet-700",
  "Packaging Done": "border-emerald-300 bg-emerald-50 text-emerald-700",
  "Forwarded To Airport": "border-sky-300 bg-sky-50 text-sky-700",
  "Airport Approved": "border-indigo-300 bg-indigo-50 text-indigo-700",
  "Received At Airport": "border-teal-300 bg-teal-50 text-teal-700",
  "Dispatched": "border-slate-300 bg-slate-100 text-slate-700",
};

/** A selectable flight leg in the New Packaging picker — one flight + date, taken
 *  from the Order Management order book and enriched with the packaging batches
 *  and meal manifest that resolve to it. */
type FlightOption = {
  key: string;            // `${flight}|${date}` — same key the list groups on
  flight: string;
  date: string;
  orderNo?: string;
  sector?: string;
  etd?: string;
  airline?: string;
  batchCount: number;
  approvedCount: number;
  // What this leg would ACTUALLY package — runs sized against its own menu plan
  // and pax/crew. The pool counts above are not a per-flight figure: bulk upload
  // gives one Order # to a whole date, so every leg of that order is offered the
  // same runs and every row read an identical "4/4 ready".
  planLines: number;      // runs contributing >0 portions to this leg
  planQty: number;        // portions this leg would take
  fromOrderBook: boolean; // listed in Order Management (vs. batch-only)
};

/** One flight (per departure date) with the allocations packaged for it. */
type PkgFlightGroup = {
  key: string;          // `${flight}|${date}` — stable across the list & the dialog
  flight: string;
  date: string;
  orderNo?: string;
  depTime?: string;
  sector?: string;
  allocations: PackagingAllocation[];
  /** Newest `createdAt` among the leg's allocations — the list is ordered by
   *  this so the run you just created lands at the top, whatever its flight
   *  date. Empty when a legacy/migrated allocation carries no timestamp. */
  latestAt: string;
};

// Batch status → allocation status, for runs that were already queued/packaged
// before packaging moved to per-flight allocations. Statuses not listed here
// (Pending Approval / Approved / Rejected) belong to the run, not to a flight.
const LEGACY_BATCH_STATUS: Partial<Record<PackagingBatchStatus, PackagingAllocationStatus>> = {
  "Packaging In Progress": "In Packaging",
  "Packaging Done": "Packaged",
  "Forwarded To Airport": "Forwarded To Airport",
  "Airport Approved": "Airport Approved",
  "Received At Airport": "Received At Airport",
  "Dispatched": "Dispatched",
};

/** One production line sized against one flight. */
type PlanLine = {
  /** Portions of this run to package for the flight. 0 means it can't contribute. */
  qty: number;
  /** Why it can't: another run covers the item / the run is spent / no menu rule. */
  reason?: "covered" | "exhausted" | "unsized";
  /** The run that supplied the requirement instead, when reason is "covered". */
  coveredBy?: string;
  /** The flight's total requirement for this item, for context. */
  required?: number;
};

const ALLOC_TONE: Record<PackagingAllocationStatus, string> = {
  "Pending Approval": "border-amber-300 bg-amber-50 text-amber-700",
  "Rejected": "border-rose-300 bg-rose-50 text-rose-700",
  "In Packaging": "border-violet-300 bg-violet-50 text-violet-700",
  "Packaged": "border-emerald-300 bg-emerald-50 text-emerald-700",
  "Forwarded To Airport": "border-sky-300 bg-sky-50 text-sky-700",
  "Airport Approved": "border-indigo-300 bg-indigo-50 text-indigo-700",
  "Received At Airport": "border-teal-300 bg-teal-50 text-teal-700",
  "Dispatched": "border-slate-300 bg-slate-100 text-slate-700",
};

function StatusBadge({ status }: { status: PackagingBatchStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", STATUS_TONE[status])}>
      {status}
    </span>
  );
}

function AllocationBadge({ status }: { status: PackagingAllocationStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", ALLOC_TONE[status])}>
      {status}
    </span>
  );
}

export default function PackagingPage() {
  const navigate = useNavigate();
  useArrivalFlash();
  const { productionEntries, productionEntryRecords } = useWorkflow();
  const [batches, setBatches] = usePersistedState<PackagingBatch[]>("packaging-batches", []);
  // Run × flight × quantity — what is actually being packaged, and the list's rows.
  const [allocations, setAllocations] = usePersistedState<PackagingAllocation[]>("packaging-allocations", []);

  // Produced qty resolver — cooking-temp records don't carry qty, so look it up
  // from the linked production entry (read-only).
  const qtyFor = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of productionEntries) map.set(e.id, e.producedQty);
    return (productionId: string) => map.get(productionId) ?? 0;
  }, [productionEntries]);
  // Warehouse the run was produced in — copied onto the batch so it does not
  // depend on the production entry still being around later.
  const metaFor = useMemo(() => {
    const map = new Map<string, { warehouseId?: string; officeId?: string }>();
    for (const e of productionEntries) map.set(e.id, { warehouseId: e.warehouseId, officeId: e.officeId });
    return (productionId: string) => map.get(productionId);
  }, [productionEntries]);

  // Pull newly-passed QC batches into the list as "Pending Approval" (idempotent),
  // and backfill the warehouse on batches created before it was captured.
  useEffect(() => {
    setBatches((prev) => {
      const merged = mergePassedBatches(prev, qtyFor, metaFor);
      let changed = merged !== prev;
      const next = merged.map((b) => {
        if (b.warehouseId) return b;
        const meta = metaFor(b.batch);
        if (!meta?.warehouseId) return b;
        changed = true;
        return { ...b, warehouseId: meta.warehouseId, officeId: meta.officeId };
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionEntries]);

  // Flight-order manifest (ORD-…) — the whole order a production batch belongs to.
  const [packagingRows] = usePersistedState<PackagingRow[]>("dispatch-packaging-rows", INITIAL_PACKAGING_ROWS);
  // Production-entry lookup (Req/Produced qty, QC times, status) keyed by PRO id.
  const peById = useMemo(() => {
    const m = new Map<string, WfProductionEntry>();
    for (const e of productionEntries) m.set(e.id, e);
    return m;
  }, [productionEntries]);
  // Batch lots logged per production order. A single order can be produced in
  // several Production Entries, each stamped with its own batch / lot number — so
  // the packaging modal can show which lot(s) an item is packaged from.
  const lotsByOrder = useMemo(() => {
    const m = new Map<string, { batchNo: string; qty: number; expiry?: string }[]>();
    for (const r of productionEntryRecords) {
      if (!r.batchNo) continue;
      const arr = m.get(r.productionOrderId) ?? [];
      arr.push({ batchNo: r.batchNo, qty: r.producedQty, expiry: r.batchExpiry });
      m.set(r.productionOrderId, arr);
    }
    return m;
  }, [productionEntryRecords]);
  // Live Order Management order book — the source of flight numbers, sectors and
  // ETDs for the picker, and of the order a production run is tagged to.
  const flightOrders = useFlightOrders();
  // ── Batch → flight-order resolution ────────────────────────────────────────
  // All of this lives in @/lib/order-chain now, so Packaging, Dispatch and the
  // galley surfaces resolve a batch to a flight the same way instead of each
  // page inventing its own matching.
  // Order #s a batch's production run serves. The run's own `servesOrderNos` tag
  // comes first — but it is a snapshot taken at creation (empty forever if the
  // day's flight orders didn't exist yet) and two creation paths never write it
  // at all, so the same rule is recomputed live and merged in. Memoised per
  // item+date because the order book runs to thousands of legs.
  const menuCards = useMemo(() => loadMealPlanningConfig(), []);
  // Cache is intentionally rebuilt when the order book or menu plan changes —
  // its entries are derived from both.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const servedCache = useMemo(() => new Map<string, string[]>(), [flightOrders, menuCards]);
  const servedOrdersFor = (b: PackagingBatch): string[] => {
    const pe = peById.get(b.batch);
    const date = pe?.date ?? b.date;
    const key = `${b.item}|${date}`;
    let live = servedCache.get(key);
    if (!live) {
      live = servedOrderNosFor(b.item, date, flightOrders, menuCards);
      servedCache.set(key, live);
    }
    return [...new Set([...(pe?.servesOrderNos ?? []), ...live])];
  };

  // How much of a run belongs to one flight. A run's produced qty is a DAY total
  // across every flight its menu line covers, so packaging the whole figure
  // against one flight would be wrong by an order of magnitude (a 6,128-portion
  // chicken run against a 78-pax flight). Falls back to the manifest line, then
  // the run total, when the item has no menu rule to size it by.
  const portionFor = (b: PackagingBatch, opt: { flight: string; date: string; orderNo?: string }): number => {
    const fo = findFlightOrder(opt);
    const crew = findCrewOrder(opt);
    const share = fo
      ? flightPortionFor(b.item, { ...fo, crew: crew?.crew ?? fo.crew }, menuCards)
      : null;
    if (share != null) return share;
    const meal = packagingRows.find(
      (r) => r.flight === opt.flight && r.date === opt.date && (r.productionOrderId === b.batch || r.mealName === b.item),
    );
    // Never fall back to the run's produced quantity for a flight-specific row —
    // that is a day total across every flight the run feeds, and using it loaded
    // 700 Seasonal Fruit onto a 197-pax leg.
    return meal?.qty ?? 0;
  };

  /**
   * How many portions of ITEM this flight needs — its menu-plan requirement.
   * Null when the item is not on the menu plan at all: there is then no rule to
   * size it by, and falling back to the run's produced quantity would load a
   * whole day's output onto one flight (700 Seasonal Fruit for a 197-pax leg).
   */
  // Memoised: flightPortionFor scans the day's menu cards, and this is asked
  // once per (item × leg) — thousands of times while the picker sizes the order
  // book. The answer only moves when the order book or the cards do.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const requirementCache = useMemo(() => new Map<string, number | null>(), [flightOrders, menuCards]);
  const requirementFor = (item: string, leg: { flight: string; date: string; orderNo?: string }): number | null => {
    const k = `${item}|${leg.flight}|${leg.date}|${leg.orderNo ?? ""}`;
    const hit = requirementCache.get(k);
    if (hit !== undefined) return hit;
    const fo = findFlightOrder(leg);
    const crew = fo ? findCrewOrder(leg) : undefined;
    const v = fo ? flightPortionFor(item, { ...fo, crew: crew?.crew ?? fo.crew }, menuCards) : null;
    requirementCache.set(k, v);
    return v;
  };

  /**
   * Size a whole run of lines against ONE flight.
   *
   * The requirement belongs to the item, not to the production run: when three
   * runs each produced Fruit Custard today, the flight still needs 197 of it
   * between them. So the requirement is drawn down run by run — the first run
   * covers what it can, later runs of the same item get whatever is left, which
   * is usually nothing. Summing a per-run share instead gave 197 × 3.
   *
   * `reserved` (production id → portions) is what an EARLIER leg in the same
   * dialog has already claimed but not yet written as an allocation. Without it
   * a round trip sizes both legs against the same untouched remainder and can
   * promise more of a run than exists.
   */
  const planForLeg = (
    pool: PackagingBatch[],
    leg: { flight: string; date: string; orderNo?: string },
    reserved?: Map<string, number>,
  ): Map<string, PlanLine> => {
    const need = new Map<string, number>();
    const filledBy = new Map<string, string>();   // item → the run that supplied it
    const plan = new Map<string, PlanLine>();
    // Deterministic order so the same run always takes the same share.
    const ordered = [...pool].sort((a, b) => a.batch.localeCompare(b.batch));
    for (const b of ordered) {
      const req = requirementFor(b.item, leg);
      if (req == null) { plan.set(b.id, { qty: 0, reason: "unsized" }); continue; }
      if (!need.has(b.item)) need.set(b.item, req);
      const left = need.get(b.item) ?? 0;
      const available = remainingOf(b) - (reserved?.get(b.batch) ?? 0);
      const take = Math.max(0, Math.min(left, available));
      need.set(b.item, left - take);
      if (take > 0 && !filledBy.has(b.item)) filledBy.set(b.item, b.batch);
      plan.set(b.id, {
        qty: take,
        reason: take > 0 ? undefined : (left <= 0 ? "covered" : "exhausted"),
        coveredBy: take > 0 ? undefined : filledBy.get(b.item),
        required: req,
      });
    }
    return plan;
  };


  // Type and Warehouse used to be read only off the manifest line, so a flight
  // with no manifest (everything produced today) showed "—" for every row. Both
  // facts exist elsewhere: the meal type on the day's menu card (or the meal
  // master), and the warehouse on the production run itself.
  const typeForItem = (item: string, date: string): string | undefined => {
    const spec = menuSpecFor(item, dayFromDate(date), menuCards);
    if (spec) return spec.kind === "Special" ? "Special" : spec.mealType;
    return meals.find((m) => m.name === item)?.type;
  };
  const warehouseNameOf = (id?: string) => (id ? warehouses.find((w) => w.id === id)?.name : undefined);
  /**
   * The warehouse a run was produced in — from the PRODUCTION ENTRY, live if it
   * is still loaded, otherwise the copy taken onto the batch when it was created.
   * No item-level guess: the warehouse is a fact about the run, not the recipe.
   */
  const warehouseForBatch = (b: PackagingBatch): string | undefined =>
    warehouseNameOf(peById.get(b.batch)?.warehouseId ?? b.warehouseId);

  /** How many flights that day's run feeds — >1 means its qty is a day total. */
  const servedFlightCount = (b: PackagingBatch): number => {
    const nos = new Set(servedOrdersFor(b));
    if (nos.size === 0) return 0;
    return new Set(
      flightOrders.filter((o) => nos.has(o.orderNo) && (o.orderType ?? "flight") !== "crew").map((o) => o.flight),
    ).size;
  };

  // The full chain walk for a batch: manifest line → order, or straight to the
  // order book on the run's served orders when no manifest line exists yet
  // (which is the case for anything produced today — the manifest is raised by
  // the dispatch flow, downstream of production).
  const chainForBatch = (b: PackagingBatch) =>
    resolveBatchChain(
      { batch: b.batch, item: b.item, date: b.date, servesOrderNos: servedOrdersFor(b) },
      packagingRows,
      flightOrders,
    );
  const orderLinkForBatch = (b: PackagingBatch) =>
    resolveManifestRow(
      { batch: b.batch, item: b.item, date: b.date, servesOrderNos: servedOrdersFor(b) },
      packagingRows,
    );
  const orderRowForBatch = (b: PackagingBatch) => orderLinkForBatch(b).row;
  /** Every meal on that order (same flight + dep time + date) — the full manifest. */
  const orderMealsForBatch = (b: PackagingBatch): PackagingRow[] => {
    const row = orderRowForBatch(b);
    return row ? manifestLinesFor(row, packagingRows) : [];
  };
  // Order-book lookups are memoised per flightOrders identity. Both resolvers do
  // a linear scan, and the New Packaging picker now sizes EVERY order-book leg
  // against the pool — that is (legs × runs) scans of the whole order book on
  // every keystroke and every checkbox tick, which is what made the dialog drag.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const orderCache = useMemo(() => new Map<string, FlightOrder | undefined>(), [flightOrders]);
  const findFlightOrder = (ref: { flight?: string; date?: string; orderNo?: string }): FlightOrder | undefined => {
    const k = `f|${ref.orderNo ?? ""}|${ref.flight ?? ""}|${ref.date ?? ""}`;
    if (orderCache.has(k)) return orderCache.get(k);
    const v = resolveFlightOrder(ref, flightOrders);
    orderCache.set(k, v);
    return v;
  };
  /** Crew-meal order for the same Order # (crew meals are booked separately). */
  const findCrewOrder = (ref: { flight?: string; orderNo?: string }): FlightOrder | undefined => {
    const k = `c|${ref.orderNo ?? ""}|${ref.flight ?? ""}`;
    if (orderCache.has(k)) return orderCache.get(k);
    const v = resolveCrewOrder(ref, flightOrders);
    orderCache.set(k, v);
    return v;
  };
  // Order ID + flight for a batch — ONLY from the order row it genuinely links to.
  // There used to be a fallback here that invented an association by hashing the
  // batch id onto an arbitrary flight order. Once the page was arranged by flight
  // that produced nonsense: a batch parked on a flight whose meal manifest does
  // not contain it (Plain Rice sitting under BS-150's biryani order). A batch
  // that links to nothing is Unassigned — stated, not faked.
  const orderInfoForBatch = (b: PackagingBatch): { orderNo?: string; flight?: string } => {
    const row = orderRowForBatch(b);
    return { orderNo: row?.orderNo, flight: row?.flight };
  };

  const [viewBatch, setViewBatch] = useState<PackagingBatch | null>(null);
  // Order Details is opened from a LIST ROW, so it is keyed on the allocation,
  // not the batch. Keying it on the batch meant re-resolving the run to a
  // manifest line, which falls back to matching on item name — a 106-portion
  // VQ-903 package opened BG-651's 502-portion manifest because both cook
  // Grilled Chicken. The allocation already knows its flight, order and qty.
  const [orderDetailAlloc, setOrderDetailAlloc] = useState<PackagingAllocation | null>(null);
  // Flight whose menu-plan status popup is open (what's produced / packaged / left).
  const [menuInfoGroup, setMenuInfoGroup] = useState<PkgFlightGroup | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  // Printing labels completes packaging (no scan step is required here).
  const [printedAll, setPrintedAll] = useState(false);
  // Batches initiated in the CURRENT packaging session — the label modal only
  // shows these (so a single-batch run never shows unrelated in-progress labels).
  const [sessionIds, setSessionIds] = useState<Set<string>>(new Set());
  // Selection (checkbox) — Initiate Packaging runs for the ticked Approved batches.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // "+ New Packaging" — pick a flight number, review everything production sent
  // for it (batches + meal manifest), then run the usual label/scan session.
  const [newOpen, setNewOpen] = useState(false);
  const [newFlightKey, setNewFlightKey] = useState("");                  // PkgFlightGroup.key
  // Ticked lines, keyed `${legKey}::${batchId}` — NOT batch id alone. A round
  // trip packages two legs in one dialog and one run usually feeds both, so a
  // batch-only key would tie the outbound's tick to the return's.
  const [newSelected, setNewSelected] = useState<Set<string>>(new Set());
  // Round trips are packaged as one job by default — the return leg's load is
  // built on the same shift. Untick to package the outbound alone.
  const [includeReturn, setIncludeReturn] = useState(true);
  // Runs that can't contribute to the chosen flight are hidden by default —
  // they are not choices, just noise. Kept behind a toggle rather than dropped
  // silently, so "where did my run go?" always has an answer.
  const [showExcluded, setShowExcluded] = useState(false);
  // Filters
  const [searchText, setSearchText] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | PackagingAllocationStatus>("all");
  const [page, setPage] = useState(1);
  const pageSize = 6;   // flights per page (the list is grouped by flight)

  // ── The list is ALLOCATIONS, not batches ───────────────────────────────────
  // A row here is "this run, this flight, this quantity". A batch passing
  // production QC is not a row — it is production output waiting to be picked,
  // and it stays in the pool the New Packaging dialog draws from (and in
  // Approval Management, where it is approved).
  const rows = allocations.filter((a) => {
    if (searchText.trim()) {
      const haystack = `${a.productionId} ${a.packagingId} ${a.item} ${a.flight} ${a.orderNo ?? ""}`.toLowerCase();
      if (!haystack.includes(searchText.trim().toLowerCase())) return false;
    }
    if (dateFrom && a.date < dateFrom) return false;
    if (dateTo && a.date > dateTo) return false;
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    return true;
  });

  // ── Flight-wise arrangement ─────────────────────────────────────────────────
  // Allocations already carry their flight, so grouping is a plain roll-up — no
  // resolution guesswork, which is the point of the allocation record.
  const groupByFlight = (list: PackagingAllocation[]): PkgFlightGroup[] => {
    const map = new Map<string, PkgFlightGroup>();
    for (const a of list) {
      const key = `${a.flight}|${a.date}`;
      let g = map.get(key);
      if (!g) {
        const fo = findFlightOrder({ flight: a.flight, date: a.date, orderNo: a.orderNo });
        g = {
          key, flight: a.flight, date: a.date,
          orderNo: a.orderNo ?? fo?.orderNo,
          depTime: a.depTime ?? fo?.etd,
          sector: fo?.sector,
          allocations: [],
          latestAt: "",
        };
        map.set(key, g);
      }
      g.allocations.push(a);
      if ((a.createdAt ?? "") > g.latestAt) g.latestAt = a.createdAt ?? "";
    }
    // Most recently created run first — a leg packaged just now sits at the top
    // even when it departs before one already in the list, which is what you
    // want right after pressing Start Packaging. Adding to an existing run
    // restamps it, so it floats back up too. Migrated rows only carry a date,
    // which still orders them correctly against each other and sinks them below
    // any run created that same day. Departure date then flight name break the
    // remaining ties; the unassigned bucket always sits below the rest.
    return [...map.values()].sort((a, b) => {
      if (a.latestAt !== b.latestAt) return b.latestAt.localeCompare(a.latestAt);
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      if ((a.flight === UNASSIGNED_FLIGHT) !== (b.flight === UNASSIGNED_FLIGHT)) return a.flight === UNASSIGNED_FLIGHT ? 1 : -1;
      return a.flight.localeCompare(b.flight);
    });
  };

  const flightGroups = groupByFlight(rows);

  // ── Flight-wise dispatch readiness ──────────────────────────────────────────
  // A flight is Ready for Dispatch only when EVERY meal on its menu plan is
  // produced AND packaged — not per line. We enumerate the flight's menu meals
  // (inferring the meal service from what's already being packaged), then mark
  // each produced / packaged and roll them up to one flight-level status.
  const flightReadiness = (g: PkgFlightGroup) => {
    const day = dayFromDate(g.date);
    const order = findFlightOrder({ flight: g.flight, date: g.date, orderNo: g.orderNo });
    const sector = g.sector ?? order?.sector ?? "";
    const ftype = flightTypeFromSector(sector);
    // Meal service(s) this flight actually carries — inferred from its packaged
    // lines so we don't pull in every service on the day's menu.
    const services = new Set(
      g.allocations
        .map((a) => menuSpecFor(a.item, day, menuCards)?.mealType)
        .filter((s): s is string => !!s),
    );
    // Candidate menu meals for this flight type + day (+ inferred service).
    const names = new Set<string>();
    for (const card of menuCards) {
      if (card.day !== day || !card.flightType.includes(ftype)) continue;
      if (services.size > 0 && card.mealType && !services.has(card.mealType)) continue;
      for (const ch of card.choices) for (const it of ch.items) names.add(it.name);
      for (const sp of card.specialMeals) if (sp.enabled) for (const it of sp.items) names.add(it.name);
      if (card.dessert?.name) names.add(card.dessert.name);
    }
    // Keep only meals this order actually needs a portion of; always include what
    // is already in the run so nothing packaged is dropped.
    let required = order
      ? [...names].filter((n) => (flightPortionFor(n, { ...order, crew: order.crew }, menuCards) ?? 0) > 0)
      : [...names];
    for (const a of g.allocations) if (!required.some((r) => r.toLowerCase() === a.item.toLowerCase())) required.push(a.item);
    if (required.length === 0) required = [...new Set(g.allocations.map((a) => a.item))];

    const packagedItems = new Set(g.allocations.filter(isPackaged).map((a) => a.item.toLowerCase()));
    const allocItems = new Set(g.allocations.map((a) => a.item.toLowerCase()));
    const meals = required.map((n) => {
      const key = n.toLowerCase();
      const packaged = packagedItems.has(key);
      const produced = allocItems.has(key)
        || productionEntries.some((e) => (e.outputItemName ?? e.bom).toLowerCase() === key && e.producedQty > 0);
      return { name: n, produced, packaged };
    });
    const notPackaged = meals.filter((m) => !m.packaged);
    const notProduced = meals.filter((m) => !m.produced);
    const allPackaged = meals.length > 0 && notPackaged.length === 0;
    return { meals, allPackaged, notPackaged, notProduced };
  };

  const batchById = useMemo(() => {
    const m = new Map<string, PackagingBatch>();
    for (const b of batches) m.set(b.id, b);
    return m;
  }, [batches]);

  // Portions already committed, per run. remainingQtyOfRun() walks the whole
  // allocation list per call, and remainingOf() is called once per run per leg
  // while the picker sizes the order book — one pass up front instead.
  const allocatedByRun = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allocations) m.set(a.productionId, (m.get(a.productionId) ?? 0) + a.qty);
    return m;
  }, [allocations]);
  // How much of a run is still unallocated — a run drops out of the New
  // Packaging pool only when every portion of it has been given to a flight.
  const remainingOf = (b: PackagingBatch): number => {
    const produced = peById.get(b.batch)?.producedQty ?? b.qty;
    return Math.max(0, produced - (allocatedByRun.get(b.batch) ?? 0));
  };

  // The pool the dialog draws from: QC-passed runs with something left to give.
  const poolBatches = batches.filter(
    (b) => b.status !== "Rejected" && (b.status === "Pending Approval" || remainingOf(b) > 0),
  );

  // ── Migration: batches queued before allocations existed ────────────────────
  // Packaging used to record "this run is being packaged" on the batch itself.
  // Those runs carry no allocation, so without this they would simply vanish
  // from the list when the page switched to per-flight allocations. One
  // allocation is created per already-queued batch, using the flight and
  // quantity it was packaged for when known, and the chain's answer when not.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current || batches.length === 0) return;
    migratedRef.current = true;
    setAllocations((prev) => {
      const have = new Set(prev.map((a) => a.batchId));
      const additions: PackagingAllocation[] = [];
      for (const b of batches) {
        const status = LEGACY_BATCH_STATUS[b.status];
        if (!status || have.has(b.id)) continue;
        const chain = chainForBatch(b);
        const flight = b.packagedForFlight ?? chain.flight ?? UNASSIGNED_FLIGHT;
        const orderNo = b.packagedForOrderNo ?? chain.orderNo;
        const fo = findFlightOrder({ flight, orderNo, date: chain.date });
        const date = fo?.date ?? chain.date ?? b.date;
        // Prefer the quantity it was packaged for; else this flight's share; else
        // the run's own output (an unassigned run has no flight to size it by).
        const runQty = peById.get(b.batch)?.producedQty ?? (b.qty > 0 ? b.qty : 0);
        const qty = b.packagedQty
          ?? (flight !== UNASSIGNED_FLIGHT ? portionFor(b, { flight, date, orderNo }) : runQty);
        additions.push({
          id: newAllocationId(),
          packagingId: packagingId(b),
          batchId: b.id,
          productionId: b.batch,
          item: b.item,
          flight,
          orderNo: orderNo ?? fo?.orderNo,
          date,
          depTime: fo?.etd ?? chain.depTime,
          qty,
          status,
          createdAt: b.packagedAt ?? b.approvedAt ?? b.date,
          packagedAt: b.packagedAt,
          dispatchId: b.dispatchId,
        });
      }
      return additions.length ? [...additions, ...prev] : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches]);

  // Meal manifest for a flight (used by the dialog for the order's meal lines).
  const mealsForGroup = (g: PkgFlightGroup): PackagingRow[] => {
    for (const a of g.allocations) {
      const b = batchById.get(a.batchId);
      const meals = b ? orderMealsForBatch(b) : [];
      if (meals.length) return meals;
    }
    return [];
  };
  // Which batch of a run covers a given manifest line (production link, the row's
  // own batch code, or the same cooked item) — this is what lets the manifest and
  // the QC batches be shown as ONE production list rather than two.
  const batchCovering = (r: PackagingRow, list: PackagingBatch[]) =>
    list.find((b) => b.batch === r.productionOrderId || b.batch === r.id || b.item === r.mealName);

  // ── New Packaging picker: Order Management → flight → production ───────────
  // Flight numbers come from the live order book (flight + date = one leg). A
  // flight that has packaging batches but no order (legacy/ad-hoc production)
  // is appended so it stays reachable, flagged so the dialog can say so.
  // Index of "which runs can serve which leg", built ONCE per open dialog. Asking
  // the question per leg instead would run the chain resolver thousands of times
  // (one per order-book leg × per pool batch) every render.
  //
  // Declared BEFORE flightOptions: that one is an IIFE evaluated during render,
  // so referencing this from below its declaration is a temporal-dead-zone crash
  // the moment the dialog opens — and TypeScript cannot see it through the
  // closure, so nothing catches it before runtime.
  const poolIndex = useMemo(() => {
    const byOrderNo = new Map<string, PackagingBatch[]>();
    const byFlight = new Map<string, PackagingBatch[]>();
    const untaggedByDate = new Map<string, PackagingBatch[]>();
    if (!newOpen) return { byOrderNo, byFlight, untaggedByDate };
    const push = (m: Map<string, PackagingBatch[]>, k: string, b: PackagingBatch) => {
      const list = m.get(k);
      if (list) { if (!list.includes(b)) list.push(b); } else m.set(k, [b]);
    };
    for (const b of poolBatches) {
      if (b.status !== "Approved" && b.status !== "Pending Approval") continue;
      const chain = chainForBatch(b);
      // Keyed by flight AND date. A flight number recurs every day it flies, so
      // keying on the number alone offered one day's production to every future
      // leg of that flight — BS-105 on the 29th showed the same "15/15 ready" as
      // BS-105 on the 23rd.
      if (chain.flight) push(byFlight, `${chain.flight}|${chain.date ?? b.date}`, b);
      const served = servedOrdersFor(b);
      for (const no of served) push(byOrderNo, no, b);
      // A run tagged to nothing is offered on its own production date.
      if (served.length === 0 && !chain.flight) push(untaggedByDate, b.date, b);
    }
    return { byOrderNo, byFlight, untaggedByDate };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newOpen, batches, allocations, packagingRows, flightOrders]);

  /** Every QC-passed run that can serve this leg and still has quantity left. */
  const poolForLeg = (leg: { flight: string; date: string; orderNo?: string } | undefined) => {
    if (!leg) return [];
    const out = new Set<PackagingBatch>([
      ...(poolIndex.byFlight.get(`${leg.flight}|${leg.date}`) ?? []),
      ...(leg.orderNo ? poolIndex.byOrderNo.get(leg.orderNo) ?? [] : []),
      ...(poolIndex.untaggedByDate.get(leg.date) ?? []),
    ]);
    return [...out];
  };

  const orderBookLegs = useMemo(() => {
    const map = new Map<string, FlightOption>();
    for (const o of flightOrders) {
      if ((o.orderType ?? "flight") === "crew") continue;
      const key = `${o.flight}|${o.date}`;
      if (map.has(key)) continue;
      map.set(key, {
        key, flight: o.flight, date: o.date, orderNo: o.orderNo, sector: o.sector,
        etd: o.etd, airline: o.airline,
        batchCount: 0, approvedCount: 0, planLines: 0, planQty: 0, fromOrderBook: true,
      });
    }
    return map;
  }, [flightOrders]);

  // Merged option list, only while the dialog is open (the order book is large).
  //
  // The badge is each leg's OWN load, not its pool size. The pool is "runs that
  // can serve this leg", and because bulk upload puts a whole date's flights on
  // one Order #, that set is identical for every leg of the order — which is why
  // every row used to read the same "4/4 ready" and told you nothing about the
  // flight you were about to pick. Sizing the pool against the leg's menu plan
  // and pax/crew gives the number that actually differs per flight.
  //
  // MEMOISED on the things the answer depends on. Sizing the whole order book is
  // the most expensive thing this page does, and as a bare render expression it
  // re-ran on every keystroke in the search box and every checkbox tick — none
  // of which change any of these inputs.
  const flightOptions: FlightOption[] = useMemo(() => {
    if (!newOpen) return [];
    const map = new Map(orderBookLegs);
    // Legs that have allocations but no order-book entry stay reachable.
    for (const g of flightGroups) {
      if (map.has(g.key)) continue;
      const fo = findFlightOrder({ flight: g.flight, date: g.date, orderNo: g.orderNo });
      map.set(g.key, {
        key: g.key, flight: g.flight, date: g.date, orderNo: g.orderNo ?? fo?.orderNo,
        sector: fo?.sector ?? g.sector, etd: fo?.etd ?? g.depTime, airline: fo?.airline,
        batchCount: 0, approvedCount: 0, planLines: 0, planQty: 0, fromOrderBook: !!fo,
      });
    }
    const out = [...map.values()].map((o) => {
      // Skip the Set-building walk for the (many) legs nothing can serve.
      const hasAny = poolIndex.byFlight.has(`${o.flight}|${o.date}`)
        || (!!o.orderNo && poolIndex.byOrderNo.has(o.orderNo))
        || poolIndex.untaggedByDate.has(o.date);
      if (!hasAny) return { ...o, batchCount: 0, approvedCount: 0, planLines: 0, planQty: 0 };
      const pool = poolForLeg(o);
      const plan = planForLeg(pool, o);
      let planLines = 0, planQty = 0;
      for (const b of pool) {
        const qty = plan.get(b.id)?.qty ?? 0;
        if (qty > 0) { planLines++; planQty += qty; }
      }
      return {
        ...o,
        batchCount: pool.length,
        approvedCount: pool.filter((b) => b.status === "Approved").length,
        planLines, planQty,
      };
    });
    // Flights with something to package lead; the rest of the order book follows
    // newest-first so a search always has the current schedule near the top.
    return out.sort((a, b) => {
      if ((a.planQty > 0) !== (b.planQty > 0)) return a.planQty > 0 ? -1 : 1;
      if ((a.batchCount > 0) !== (b.batchCount > 0)) return a.batchCount > 0 ? -1 : 1;
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return a.flight.localeCompare(b.flight);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newOpen, orderBookLegs, poolIndex, allocations, flightOrders, menuCards, packagingRows]);

  // Pagination — same format as the other list pages, but a "page" is a set of
  // flights now, so a flight's batches never split across two pages.
  const totalPages = Math.max(1, Math.ceil(flightGroups.length / pageSize));
  const pageStart = (page - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, flightGroups.length);
  const pagedGroups = flightGroups.slice(pageStart, pageEnd);
  useEffect(() => { setPage(1); }, [searchText, dateFrom, dateTo, filterStatus]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  // Deep link from the Dispatch table's Packaging ID → jump to the page holding
  // the target row so useArrivalFlash can find & blink it.
  const flashJumpDone = useRef(false);
  useEffect(() => {
    if (flashJumpDone.current) return;
    const targets = peekArrivalRows();
    if (targets.length === 0) return;
    const idx = flightGroups.findIndex((g) => g.allocations.some((a) => targets.includes(a.productionId)));
    if (idx >= 0) {
      flashJumpDone.current = true;
      setPage(Math.floor(idx / pageSize) + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  // Selection on this list drives label printing — the only bulk action here now
  // that queueing happens in the New Packaging dialog.
  const isLabelable = (a: PackagingAllocation) => a.status === "In Packaging";
  const labelableRows = rows.filter(isLabelable);
  const allApprovedSelected = labelableRows.length > 0 && labelableRows.every((a) => selectedIds.has(a.id));
  const toggleSelectAll = () => setSelectedIds(allApprovedSelected ? new Set() : new Set(labelableRows.map((a) => a.id)));
  const toggleSelectOne = (id: string) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Flight-row checkbox — ticks/unticks every in-packaging allocation of that flight.
  const toggleSelectGroup = (g: PkgFlightGroup) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      const labelable = g.allocations.filter(isLabelable);
      const allOn = labelable.length > 0 && labelable.every((a) => n.has(a.id));
      labelable.forEach((a) => (allOn ? n.delete(a.id) : n.add(a.id)));
      return n;
    });
  const approvedCount = batches.filter((b) => b.status === "Approved" && remainingOf(b) > 0).length;
  const inProgressCount = allocations.filter((a) => a.status === "In Packaging").length;
  const doneCount = allocations.filter(isPackaged).length;
  // Two different gates, both real: a QC batch awaiting packaging approval (it
  // cannot be picked into a run yet), and a created RUN awaiting sign-off (it
  // cannot print labels yet). The KPI shows the second — that is the queue this
  // page's own work sits in.
  const pendingApprovalCount = batches.filter((b) => b.status === "Pending Approval").length;
  const pendingRuns = allocations.filter(isAwaitingApproval);

  // Allocations shown as labels — the ones in the current print session.
  const packagingLabels = allocations.filter((a) => a.status === "In Packaging" && sessionIds.has(a.id));

  /**
   * Create one allocation per ticked line: run × that flight × that flight's
   * share. The run itself is NOT consumed — it keeps whatever quantity is left
   * for the other flights it serves, which is the whole point of the record.
   * Re-packaging the same run for the same flight tops up the existing
   * allocation instead of duplicating it.
   *
   * Takes a LIST of legs so a round trip is written in one state update: both
   * halves land together, and the toast/audit line reports the trip rather than
   * two unrelated runs.
   */
  const allocateToFlights = (
    jobs: {
      leg: { flight: string; orderNo?: string; date: string; depTime?: string };
      lines: { batch: PackagingBatch; qty: number }[];
    }[],
  ) => {
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const by = getAuthUser()?.name;
    setAllocations((prev) => {
      const next = [...prev];
      for (const { leg, lines } of jobs) {
        for (const { batch, qty } of lines) {
          const already = existingAllocation(next, batch.batch, leg.flight, leg.date);
          if (already) {
            const i = next.indexOf(already);
            // Topping up an already-approved run re-opens the approval: the
            // quantity signed off is no longer the quantity being packaged.
            // Stamp the time too, so Add to Run floats the leg back to the top
            // of the list the same way a brand-new run does.
            next[i] = {
              ...already,
              qty: already.qty + qty,
              status: "Pending Approval",
              approvedBy: undefined, approvedAt: undefined, rejectedReason: undefined,
              createdAt: now,
            };
            continue;
          }
          next.unshift({
            id: newAllocationId(),
            packagingId: packagingId(batch),
            batchId: batch.id,
            productionId: batch.batch,
            item: batch.item,
            flight: leg.flight,
            orderNo: leg.orderNo,
            date: leg.date,
            depTime: leg.depTime,
            qty,
            // A new run is NOT live yet. Labels, dispatch and everything after
            // it wait on packaging sign-off, which is granted in Approval
            // Management — never on this page.
            status: "Pending Approval",
            createdAt: now,
            createdBy: by,
          });
        }
      }
      return next;
    });
    setSelectedIds(new Set());
    const lineCount = jobs.reduce((s, j) => s + j.lines.length, 0);
    const total = jobs.reduce((s, j) => s + j.lines.reduce((t, l) => t + l.qty, 0), 0);
    const where = jobs.map((j) => j.leg.flight).join(" + ");
    toast.success(
      `${where} — ${total.toLocaleString()} portions from ${lineCount} production run${lineCount === 1 ? "" : "s"} queued as Pending Approval. Labels unlock once packaging is approved.`,
      {
        action: { label: "Open Approval Management", onClick: () => navigate("/approval-management") },
        duration: 8000,
      },
    );
    logAudit({
      action: "Packaging run raised for approval",
      module: "Packaging",
      entity: where,
      detail: jobs
        .map((j) => `${j.leg.flight}: ${j.lines.map((l) => `${l.batch.batch} × ${l.qty}`).join(", ")}`)
        .join(" | "),
    });
  };

  // Open the label print modal for a set of in-packaging allocations.
  const openLabels = (list: PackagingAllocation[]) => {
    const pending = list.filter((a) => a.status === "In Packaging");
    if (pending.length === 0) { toast.error("Nothing is awaiting labels here."); return; }
    setSessionIds(new Set(pending.map((a) => a.id)));
    setPrintedAll(false);
    setLabelOpen(true);
  };

  // Print labels for everything ticked on the list.
  const printSelectedLabels = () => openLabels(rows.filter((a) => selectedIds.has(a.id)));

  // ── New Packaging (flight-first) ────────────────────────────────────────────
  /** Selection key. Per LEG, so the outbound and return can be ticked apart. */
  const selKey = (legKey: string, batchId: string) => `${legKey}::${batchId}`;
  const openNewPackaging = (key?: string) => {
    setNewFlightKey(key ?? "");
    setNewSelected(new Set());
    setIncludeReturn(true);
    setShowExcluded(false);
    setNewOpen(true);
  };
  const chooseNewFlight = (key: string) => {
    setNewFlightKey(key);
    setIncludeReturn(true);
    setShowExcluded(false);
    setNewSelected(new Set());   // refilled by the preselect effect below
  };
  // The chosen leg: order-book data (flight, sector, ETD, order no) + whatever
  // production and manifest lines resolve to it.
  const newOption = flightOptions.find((o) => o.key === newFlightKey);

  // ── The paired return leg ───────────────────────────────────────────────────
  // A round trip is one catering job: the return's load is built, packaged and
  // loaded on the same shift as the outbound, off the same production runs.
  // Dispatch already bundles the pair onto one sheet; pairing here too is what
  // stops the return from being packaged as an unrelated run days later.
  const newReturn = newOption ? resolveReturnLeg(findFlightOrder(newOption), flightOrders) : null;
  const newReturnOption: FlightOption | undefined = (() => {
    if (!newReturn) return undefined;
    const o = newReturn.order;
    const key = `${o.flight}|${o.date}`;
    const known = flightOptions.find((f) => f.key === key);
    if (known) return known;
    // Paired to a leg the picker didn't list (no production can serve it yet) —
    // synthesise the option so its details still show.
    return {
      key, flight: o.flight, date: o.date, orderNo: o.orderNo, sector: o.sector,
      etd: o.etd, airline: o.airline,
      batchCount: 0, approvedCount: 0, planLines: 0, planQty: 0, fromOrderBook: true,
    };
  })();
  // Both halves of the trip are always SIZED, even when the return is unticked —
  // that is what lets the banner state exactly what unticking it leaves behind.
  const newPlanLegs: FlightOption[] = [
    ...(newOption ? [newOption] : []),
    ...(newReturnOption ? [newReturnOption] : []),
  ];
  /** The legs this dialog will render and package — the return only if bundled. */
  const newLegs: FlightOption[] = newPlanLegs.filter(
    (l) => includeReturn || l.key !== newReturnOption?.key,
  );

  // Pool + plan per leg. The legs are sized IN ORDER with a running reservation,
  // so the outbound takes its share first and the return is sized against what
  // is genuinely left of each run rather than against the same full remainder.
  const newLegPlans = (() => {
    const reserved = new Map<string, number>();
    const out = new Map<string, { pool: PackagingBatch[]; plan: Map<string, PlanLine> }>();
    for (const leg of newPlanLegs) {
      const pool = poolForLeg(leg);
      const plan = planForLeg(pool, leg, reserved);
      for (const b of pool) {
        const take = plan.get(b.id)?.qty ?? 0;
        if (take > 0) reserved.set(b.batch, (reserved.get(b.batch) ?? 0) + take);
      }
      out.set(leg.key, { pool, plan });
    }
    return out;
  })();
  const legPool = (leg: FlightOption) => newLegPlans.get(leg.key)?.pool ?? [];
  const legPlan = (leg: FlightOption) => newLegPlans.get(leg.key)?.plan ?? new Map<string, PlanLine>();
  /** What a leg's plan comes to: contributing runs and the portions they give. */
  const legLoad = (leg: FlightOption | undefined) => {
    if (!leg) return { lines: 0, qty: 0 };
    const plan = legPlan(leg);
    let lines = 0, qty = 0;
    for (const b of legPool(leg)) {
      const q = plan.get(b.id)?.qty ?? 0;
      if (q > 0) { lines++; qty += q; }
    }
    return { lines, qty };
  };

  // Preselect every contributing line of each leg once the dialog is open. A run
  // does NOT need to be approved to be packaged: packaging is started here first,
  // and approval is granted afterward on the resulting run (Approval Management).
  // Preselect can NOT happen in the click handler: poolIndex is empty until
  // `newOpen` flips, so preselecting there ticked nothing at all.
  useEffect(() => {
    if (!newOpen || !newFlightKey) return;
    const next = new Set<string>();
    for (const leg of newLegs) {
      const plan = legPlan(leg);
      for (const b of legPool(leg)) {
        // Skip runs already created for this leg — Add to Run leaves them locked
        // and only preselects the runs not yet packaged for the flight.
        const existing = existingAllocation(allocations, b.batch, leg.flight, leg.date);
        if (existing && existing.status !== "Rejected") continue;
        if (b.status !== "Rejected" && (plan.get(b.id)?.qty ?? 0) > 0) {
          next.add(selKey(leg.key, b.id));
        }
      }
    }
    setNewSelected(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newOpen, newFlightKey, includeReturn]);

  // Ticked AND able to contribute, per leg. A line whose requirement another run
  // covers, or that has no menu rule, must not be counted on the Start button —
  // it would promise 18 lines and package 12. Runs already created for the leg are
  // excluded too, so Add to Run only ever queues the runs not yet packaged.
  const newJobs = newLegs.map((leg) => ({
    leg,
    lines: legPool(leg)
      .filter((b) => {
        if (!newSelected.has(selKey(leg.key, b.id)) || (legPlan(leg).get(b.id)?.qty ?? 0) <= 0) return false;
        const existing = existingAllocation(allocations, b.batch, leg.flight, leg.date);
        return !(existing && existing.status !== "Rejected");
      })
      .map((b) => ({ batch: b, qty: legPlan(leg).get(b.id)?.qty ?? 0 })),
  }));
  const newEligibleCount = newJobs.reduce((s, j) => s + j.lines.length, 0);
  // Start packaging → queue every ticked line as a run. Approval is NOT required
  // first: the run is created here as "Pending Approval" and signed off afterward
  // in Approval Management (which unlocks its labels). Both legs of a round trip
  // are queued in one action so the pair never splits across two runs.
  const startNewPackaging = () => {
    if (!newOption) { toast.error("Choose a flight number first."); return; }
    if (newEligibleCount === 0) {
      toast.error("Select at least one production line for this flight.");
      return;
    }
    const jobs = newJobs.filter((j) => j.lines.length > 0);
    if (jobs.length === 0) {
      toast.error("Nothing to package: this flight's requirement is already covered, or these items aren't on its menu plan.");
      return;
    }
    allocateToFlights(jobs.map((j) => ({
      lines: j.lines,
      leg: { flight: j.leg.flight, orderNo: j.leg.orderNo, date: j.leg.date, depTime: j.leg.etd },
    })));
    setNewOpen(false);
    setNewFlightKey("");
    setNewSelected(new Set());
  };

  // Print all labels → every batch in this session becomes Packaging Done (ready
  // for dispatch). It stays visible in the list and shows on the Dispatch page.
  /**
   * Mark allocations packaged. The underlying batch is flipped to "Packaging
   * Done" too, stamped with THIS flight and quantity, because that is what the
   * Dispatch page reads to raise its manifest rows. A run packaged for several
   * flights therefore reports its most recent flight on the batch; the per-flight
   * truth lives in the allocations, which Dispatch also reads.
   */
  const markPackaged = (list: PackagingAllocation[]) => {
    if (list.length === 0) { toast.error("No labels to print."); return; }
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const ids = new Set(list.map((a) => a.id));
    const nextAllocations = allocations.map((a) => (ids.has(a.id)
      ? { ...a, status: "Packaged" as PackagingAllocationStatus, packagedAt: now, dispatchId: a.dispatchId ?? `DSP-${a.flight}` }
      : a));
    setAllocations(nextAllocations);
    const byBatchId = new Map(list.map((a) => [a.batchId, a]));
    setBatches((prev) =>
      prev.map((b) => {
        const a = byBatchId.get(b.id);
        if (!a) return b;
        return {
          ...b,
          status: "Packaging Done" as PackagingBatchStatus,
          packagedAt: now,
          packagedForFlight: a.flight,
          packagedForOrderNo: a.orderNo,
          packagedQty: a.qty,
          dispatchId: b.dispatchId ?? `DSP-${b.batch}`,
        };
      }),
    );
    // Advance the flight-order lifecycle: once every non-rejected allocation of a
    // flight (matched by Order # + flight) is packaged, its order moves
    // Approved/Production → Packaged. Uses the just-computed allocation set so the
    // check reflects this action, not the pre-update state.
    const affected = new Map<string, { orderNo: string; flight: string }>();
    for (const a of list) if (a.orderNo) affected.set(`${a.orderNo}__${a.flight}`, { orderNo: a.orderNo, flight: a.flight });
    for (const { orderNo, flight } of affected.values()) {
      const flightAllocs = nextAllocations.filter(
        (a) => a.orderNo === orderNo && a.flight === flight && a.status !== "Rejected",
      );
      if (flightAllocs.length > 0 && flightAllocs.every(isPackaged)) {
        updateFlightOrdersWhere(
          (o) => o.orderNo === orderNo && o.flight === flight
            && (o.status === "Approved" || o.status === "Production"),
          { status: "Packaged" },
        );
      }
    }
    toast.success(`${ids.size} label${ids.size === 1 ? "" : "s"} printed — packaged, ready for dispatch.`);
  };

  const printAll = () => { markPackaged(packagingLabels); setPrintedAll(true); };
  const printOne = (a: PackagingAllocation) => markPackaged([a]);

  // Close the label modal. Un-printed allocations stay "In Packaging" — the run
  // lives on the list page now, so closing this is pausing, not cancelling.
  const closeLabelModal = () => {
    setSessionIds(new Set());
    setLabelOpen(false);
  };

  return (
    <>
      <PageHeader
        title="Packaging"
        subtitle="Packaging runs you have created — start one with New Packaging from a flight number, then print & scan its labels here"
        actions={
          <Button onClick={() => openNewPackaging()}>
            <Plus className="h-4 w-4 mr-1.5" /> New Packaging
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        {/* "Ready to Package" is the POOL New Packaging draws from — QC-passed
            production not yet put into a run, deliberately not a row below.
            The other three are runs on this list, in lifecycle order. */}
        <KpiCard label="Ready to Package" value={approvedCount} icon={Package} tone="navy" />
        <KpiCard label="Pending Approval" value={pendingRuns.length} icon={Clock} tone="warning" />
        <KpiCard label="In Packaging" value={inProgressCount} icon={Boxes} tone="navy" />
        <KpiCard label="Packaged" value={doneCount} icon={CheckCircle2} tone="success" />
      </div>

      {/* Runs are created here but signed off in Approval Management — say so
          once, with the way there, rather than leaving them looking stuck. */}
      {/* Filters — Search · Date range · Status */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Search</span>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Order or item…" className="h-8 text-xs pl-7" />
          </div>
        </div>
        <div className="flex flex-col gap-1 min-w-[130px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">From</span>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs tabular-nums" />
        </div>
        <div className="flex flex-col gap-1 min-w-[130px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">To</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs tabular-nums" />
        </div>
        <div className="flex flex-col gap-1 min-w-[160px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Status</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as "all" | PackagingAllocationStatus)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="all">All</option>
            <option value="Pending Approval">Pending Approval</option>
            <option value="In Packaging">In Packaging</option>
            <option value="Packaged">Packaged</option>
            <option value="Forwarded To Airport">Forwarded To Airport</option>
            <option value="Airport Approved">Airport Approved</option>
            <option value="Received At Airport">Received At Airport</option>
          </select>
        </div>
        {(searchText || dateFrom || dateTo || filterStatus !== "all") && (
          <button
            type="button"
            onClick={() => { setSearchText(""); setDateFrom(""); setDateTo(""); setFilterStatus("all"); }}
            className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors self-end"
          >
            Clear
          </button>
        )}
      </div>

      {/* Selection bar — what the checkbox column is for, with its actions in
          reach instead of only in the page header. */}
      {selectedIds.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-xs font-medium text-foreground">
            {selectedIds.size} batch{selectedIds.size === 1 ? "" : "es"} selected
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={printSelectedLabels}>
              <Printer className="h-3.5 w-3.5 mr-1" /> Print Labels ({selectedIds.size})
            </Button>
          </div>
        </div>
      )}

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-10 px-2 text-center">
                <RowCheckbox
                  checked={allApprovedSelected}
                  indeterminate={selectedIds.size > 0}
                  disabled={labelableRows.length === 0}
                  onChange={toggleSelectAll}
                  label="Select all batches awaiting labels"
                  title={labelableRows.length === 0 ? "No batches awaiting labels" : "Select all batches awaiting labels"}
                />
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Packaging ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Production ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Qty For Flight</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flightGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">Nothing is in packaging yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Start with <b>New Packaging</b> — pick a flight, review what production sent for it, and queue it here.
                    {approvedCount + pendingApprovalCount > 0 && (
                      <> {approvedCount + pendingApprovalCount} QC-passed batch{approvedCount + pendingApprovalCount === 1 ? " is" : "es are"} waiting to be picked.</>
                    )}
                  </p>
                  <Button size="sm" className="mt-3" onClick={() => openNewPackaging()}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> New Packaging
                  </Button>
                </TableCell>
              </TableRow>
            ) : (
              pagedGroups.flatMap((g) => {
                const inProgressInGroup = g.allocations.filter(isLabelable);
                const pendingInGroup = g.allocations.filter(isAwaitingApproval);
                const groupAllSelected = inProgressInGroup.length > 0 && inProgressInGroup.every((a) => selectedIds.has(a.id));
                // The flight's load = the sum of its allocations, by definition.
                const groupQty = g.allocations.reduce((s, a) => s + a.qty, 0);
                const isUnassigned = g.flight === UNASSIGNED_FLIGHT;
                // Flight-level dispatch readiness across the whole menu plan.
                const rd = isUnassigned ? null : flightReadiness(g);
                return [
                  /* ── Flight header — the list is arranged flight by flight ── */
                  <TableRow key={`${g.key}-head`} className="border-t-2 border-sky-100 bg-sky-50/50 hover:bg-sky-50/70">
                    <TableCell className="w-10 px-2 text-center align-middle">
                      <RowCheckbox
                        tone="group"
                        checked={groupAllSelected}
                        indeterminate={inProgressInGroup.some((a) => selectedIds.has(a.id))}
                        disabled={inProgressInGroup.length === 0}
                        onChange={() => toggleSelectGroup(g)}
                        label={`Select ${g.flight}'s lines awaiting labels`}
                        title={inProgressInGroup.length === 0
                          ? pendingInGroup.length > 0
                            ? `${g.flight}'s runs are awaiting packaging approval — nothing can be labelled yet`
                            : `${g.flight} has no lines awaiting labels`
                          : `Select all ${inProgressInGroup.length} line${inProgressInGroup.length === 1 ? "" : "s"} awaiting labels for ${g.flight}`}
                      />
                    </TableCell>
                    <TableCell colSpan={7} className="py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold whitespace-nowrap",
                          isUnassigned ? "border-slate-300 bg-slate-100 text-slate-600" : "border-sky-300 bg-sky-100 text-sky-800",
                        )}>
                          <Plane className="h-3.5 w-3.5" /> {g.flight}
                        </span>
                        {g.sector && <span className="text-xs text-muted-foreground whitespace-nowrap">{g.sector}</span>}
                        {g.orderNo && (
                          <button
                            type="button"
                            onClick={() => navigate(`/order-management?ord=${g.orderNo}`)}
                            className="font-mono text-[11px] font-semibold text-primary hover:underline whitespace-nowrap"
                            title="Open in Order Management"
                          >
                            {g.orderNo}
                          </button>
                        )}
                        {g.depTime && <span className="text-xs text-muted-foreground whitespace-nowrap">Dep {g.depTime}</span>}
                        <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">{g.date}</span>
                        <span className="text-[11px] font-medium text-slate-600 tabular-nums whitespace-nowrap">
                          {g.allocations.length} line{g.allocations.length === 1 ? "" : "s"} · {groupQty.toLocaleString()} portions
                        </span>
                        {rd && rd.meals.length > 0 && (
                          rd.allPackaged ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 whitespace-nowrap"
                              title={`All ${rd.meals.length} menu meal${rd.meals.length === 1 ? "" : "s"} produced & packaged`}
                            >
                              <CheckCircle2 className="h-3 w-3" /> Ready for Dispatch
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 whitespace-nowrap"
                              title={
                                `${rd.meals.length - rd.notPackaged.length}/${rd.meals.length} meals packaged. Pending: ` +
                                rd.notPackaged.map((m) => `${m.name}${m.produced ? " (produced, not packaged)" : " (not produced)"}`).join(", ")
                              }
                            >
                              <Clock className="h-3 w-3" />
                              Packaging {rd.meals.length - rd.notPackaged.length}/{rd.meals.length} — not ready
                            </span>
                          )
                        )}
                        {pendingInGroup.length > 0 && (
                          <button
                            type="button"
                            onClick={() => navigate("/approval-management")}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 whitespace-nowrap hover:bg-amber-100"
                            title={`${pendingInGroup.length} of ${g.flight}'s runs need packaging approval before labels can be printed`}
                          >
                            <Clock className="h-3 w-3" />
                            {pendingInGroup.length} awaiting approval
                          </button>
                        )}
                        <span className="ml-auto flex items-center gap-2">
                          {!isUnassigned && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => setMenuInfoGroup(g)}
                              title={`See ${g.flight}'s full menu — what's produced, packaged and still pending`}
                            >
                              <ClipboardList className="h-3.5 w-3.5 mr-1" /> Menu
                            </Button>
                          )}
                          {rd?.allPackaged && (
                            <Button
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => navigate(`/dispatch?config=${encodeURIComponent(g.flight)}&date=${encodeURIComponent(g.date)}`)}
                              title={`All meals packaged — configure ${g.flight}'s dispatch`}
                            >
                              <Truck className="h-3.5 w-3.5 mr-1" /> Dispatch
                            </Button>
                          )}
                          {inProgressInGroup.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => openLabels(inProgressInGroup)}
                              title="Print & scan this flight's labels"
                            >
                              <Printer className="h-3.5 w-3.5 mr-1" /> Print Labels ({inProgressInGroup.length})
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => openNewPackaging(g.key)}
                            title={`Add more of ${g.flight}'s production to packaging`}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" /> Add to Run
                          </Button>
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>,
                  /* ── That flight's allocations: run × this flight × qty ── */
                  ...g.allocations.map((a) => {
                  const batch = batchById.get(a.batchId);
                  const runProduced = peById.get(a.productionId)?.producedQty;
                  const otherFlights = flightsOfRun(allocations, a.productionId).filter((f) => f !== a.flight);
                  return (
                  <TableRow key={a.id} data-arrival-row-id={a.productionId} className={cn("hover:bg-muted/30", selectedIds.has(a.id) && "bg-primary/5")}>
                    {/* Select — lines awaiting labels. Printed lines keep a disabled
                        box so the column stays one continuous rail. */}
                    <TableCell className="w-10 px-2 text-center align-middle">
                      <RowCheckbox
                        checked={selectedIds.has(a.id)}
                        disabled={!isLabelable(a)}
                        onChange={() => toggleSelectOne(a.id)}
                        label={`Select ${a.productionId}`}
                        title={isLabelable(a)
                          ? `Select ${a.productionId} to print its label`
                          : isAwaitingApproval(a)
                            ? `${a.productionId} is awaiting packaging approval — approve it in Approval Management before printing labels`
                            : a.status === "Rejected"
                              ? `${a.productionId} was rejected at packaging approval${a.rejectedReason ? ` — ${a.rejectedReason}` : ""}`
                              : `${a.productionId} is ${a.status} — its labels are already printed`}
                      />
                    </TableCell>
                    {/* Packaging ID — system-generated per production package */}
                    <TableCell>
                      <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600 whitespace-nowrap">
                        {a.packagingId}
                      </span>
                    </TableCell>
                    {/* Production ID — clickable → Production Order table, blinks that row */}
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => { navigate(`/production-entry?pro=${encodeURIComponent(a.productionId)}`); }}
                        className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary hover:bg-primary/10 focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors"
                        title="Open in Production Order"
                      >
                        {a.productionId}
                      </button>
                    </TableCell>
                    <TableCell className="text-xs font-medium">{a.item}</TableCell>
                    {/* Qty — THIS flight's share, with the run's day total behind it */}
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setOrderDetailAlloc(a)}
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline focus:outline-none focus:underline"
                        title={`View ${a.flight}'s packaging load`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span className="tabular-nums font-medium">{a.qty.toLocaleString()}</span>
                      </button>
                      {runProduced != null && runProduced > a.qty && (
                        <span
                          className="ml-1 text-[10px] text-muted-foreground tabular-nums"
                          title={otherFlights.length
                            ? `Run produced ${runProduced.toLocaleString()} — also allocated to ${otherFlights.join(", ")}`
                            : `Run produced ${runProduced.toLocaleString()} in total`}
                        >
                          of {runProduced.toLocaleString()}
                          {otherFlights.length > 0 && ` · +${otherFlights.length} flight${otherFlights.length === 1 ? "" : "s"}`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">{a.date}</TableCell>
                    <TableCell>
                      <div className="inline-flex items-center gap-1.5 flex-wrap">
                        <AllocationBadge status={a.status} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {a.status === "In Packaging" && (
                          <Button
                            size="icon"
                            className="h-7 w-7"
                            title="Print & scan this label"
                            aria-label={`Print label for ${a.productionId}`}
                            onClick={() => openLabels([a])}
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          title="View production & QC detail"
                          aria-label={`View ${a.productionId}`}
                          onClick={() => batch && setViewBatch(batch)}
                          disabled={!batch}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                  }),
                ];
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination — a page is a set of flights, so a flight never splits */}
      {flightGroups.length > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <div className="text-xs text-muted-foreground">
            Showing flights{" "}
            <strong className="text-foreground tabular-nums">{pageStart + 1}</strong>–
            <strong className="text-foreground tabular-nums">{pageEnd}</strong>{" "}
            of <strong className="text-foreground tabular-nums">{flightGroups.length}</strong>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => setPage(1)} disabled={page === 1} aria-label="First page" title="First page">«</Button>
            <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page" title="Previous page">‹</Button>
            <span className="text-xs text-muted-foreground tabular-nums min-w-[80px] text-center">
              Page {page} / {totalPages}
            </span>
            <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} aria-label="Next page" title="Next page">›</Button>
            <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => setPage(totalPages)} disabled={page === totalPages} aria-label="Last page" title="Last page">»</Button>
          </div>
        </div>
      )}

      {/* View — production, QC, meal & approval detail */}
      {viewBatch && (() => {
        const b = viewBatch;
        const pe = peById.get(b.batch);
        const row = orderRowForBatch(b);
        const meals = orderMealsForBatch(b);
        const tempDelta = b.thresholdTemp != null ? b.measuredTemp - b.thresholdTemp : null;
        const prodTime = pe?.completedAt ?? pe?.qcPassedAt ?? b.packagedAt ?? b.date;
        return (
          <Dialog open onOpenChange={(o) => { if (!o) setViewBatch(null); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Production &amp; QC — {packagingId(b)}</DialogTitle>
                <DialogDescription>Production, quality-control and meal detail for this packaged batch.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-1 text-sm">
                {/* Production details */}
                <section>
                  <SectionTitle>Production Details</SectionTitle>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Packaging ID" value={packagingId(b)} mono />
                    <Field label="Production ID" value={b.batch} mono />
                    <Field label="Order ID" value={row?.orderNo ?? "—"} mono />
                    <Field label="Item" value={b.item} />
                    <Field label="BOM" value={pe?.bom ?? b.item} />
                    <Field label="Production Date" value={pe?.date ?? b.date} />
                    <Field label="Time of Production" value={prodTime} />
                    <Field label="Req QTY" value={pe?.orderQty != null ? String(pe.orderQty) : (b.qty > 0 ? String(b.qty) : "—")} />
                    <Field label="Produced QTY" value={pe?.producedQty != null ? String(pe.producedQty) : (b.qty > 0 ? String(b.qty) : "—")} />
                    <div>
                      <FieldLabel>Production Status</FieldLabel>
                      <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">{pe?.status ?? "Completed"}</span>
                    </div>
                  </div>
                </section>

                {/* QC details */}
                <section>
                  <SectionTitle>QC Details</SectionTitle>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Standard Temp" value={b.standardTemp} />
                    <Field label="Threshold Temp" value={b.thresholdTemp != null ? `≤${b.thresholdTemp}°C` : "—"} />
                    <div>
                      <FieldLabel>Measured Temp</FieldLabel>
                      <div className="text-green-600 font-semibold">
                        {b.measuredTemp}°C
                        {tempDelta != null && <span className="text-muted-foreground font-normal"> ({tempDelta >= 0 ? "+" : ""}{tempDelta}° vs threshold)</span>}
                      </div>
                    </div>
                    <Field label="Taste" value={b.taste || "—"} />
                    <Field label="Cooked By" value={b.cookedBy} />
                    <Field label="QC Checked By" value={b.checkedBy} />
                    <Field label="QC Passed At" value={pe?.qcPassedAt ?? "—"} />
                    <div>
                      <FieldLabel>Packaging Status</FieldLabel>
                      <div className="inline-flex items-center gap-1.5 flex-wrap">
                        <StatusBadge status={b.status} />
                        {b.status === "Packaging Done" && (
                          <span className="inline-flex items-center rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700">Ready To Dispatch</span>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Meal items — QTY, Req QTY, Produced QTY */}
                <section>
                  <SectionTitle>Meal Items</SectionTitle>
                  {meals.length ? (
                    <table className="w-full text-xs border border-slate-200 rounded-md overflow-hidden">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="p-2 text-left font-semibold">Production</th>
                          <th className="p-2 text-left font-semibold">Meal</th>
                          <th className="p-2 text-left font-semibold">Type</th>
                          <th className="p-2 text-right font-semibold">QTY</th>
                          <th className="p-2 text-right font-semibold">Req QTY</th>
                          <th className="p-2 text-right font-semibold">Produced QTY</th>
                          <th className="p-2 text-left font-semibold">Warehouse</th>
                        </tr>
                      </thead>
                      <tbody>
                        {meals.map((r) => {
                          const mpe = r.productionOrderId ? peById.get(r.productionOrderId) : undefined;
                          return (
                            <tr key={r.id} className="border-t border-slate-100">
                              <td className="p-2 font-mono text-primary">{r.productionOrderId ?? "—"}</td>
                              <td className="p-2">{r.mealName}</td>
                              <td className="p-2"><span className={cn("px-2 py-0.5 rounded-full text-[11px] font-semibold", MEAL_TYPE_BADGE[r.mealType] ?? "bg-muted text-foreground")}>{r.mealType}</span></td>
                              <td className="p-2 text-right tabular-nums font-medium">{r.qty}</td>
                              <td className="p-2 text-right tabular-nums text-muted-foreground">{mpe?.orderQty != null ? mpe.orderQty : r.qty}</td>
                              <td className="p-2 text-right tabular-nums text-muted-foreground">{mpe?.producedQty != null ? mpe.producedQty : r.qty}</td>
                              <td className="p-2 text-muted-foreground">{r.section}</td>
                            </tr>
                          );
                        })}
                        <tr className="border-t-2 border-slate-300 bg-slate-50/80">
                          <td className="p-2 font-bold" colSpan={3}>Total</td>
                          <td className="p-2 text-right font-bold tabular-nums">{meals.reduce((s, r) => s + r.qty, 0)}</td>
                          <td colSpan={3}></td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-xs text-muted-foreground">No linked order manifest. This batch — {b.item} · QTY {b.qty > 0 ? b.qty : "—"}.</div>
                  )}
                </section>

                {/* Approval log */}
                <section>
                  <SectionTitle>Approval Log</SectionTitle>
                  <ol className="space-y-1.5">
                    {[
                      { done: true, label: "Passed temperature & taste QC", at: `${b.checkedBy}${pe?.qcPassedAt ? " · " + pe.qcPassedAt : ""}` },
                      { done: !!b.approvedBy, label: "Packaging approved", at: b.approvedBy ? `${b.approvedBy}${b.approvedAt ? " · " + b.approvedAt : ""}` : "Pending approval" },
                      { done: !!b.packagedAt, label: "Packaged (labels printed)", at: b.packagedAt || "—" },
                    ].map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <span className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border flex items-center justify-center", s.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40")}>
                          {s.done && <CheckCircle2 className="h-2.5 w-2.5" />}
                        </span>
                        <span>
                          <span className={s.done ? "font-medium text-foreground" : "text-muted-foreground"}>{s.label}</span>
                          {s.at && s.at !== "—" && <span className="text-muted-foreground"> — {s.at}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setViewBatch(null)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Order Details — the packaging load of THIS allocation's flight, opened
          from the Qty cell. Every figure below comes off the allocations for
          that exact flight + date, so the total always reconciles with the
          flight header above it. */}
      {orderDetailAlloc && (() => {
        const a = orderDetailAlloc;
        const fo = findFlightOrder({ flight: a.flight, date: a.date, orderNo: a.orderNo });
        const crewOrder = findCrewOrder({ flight: a.flight, orderNo: a.orderNo });
        // The flight's whole packaging load — the rows grouped under it on the
        // list, not "some order that happens to cook the same dish".
        const legAllocs = allocations
          .filter((x) => x.flight === a.flight && x.date === a.date)
          .sort((x, y) => x.item.localeCompare(y.item));
        const legQty = legAllocs.reduce((s, x) => s + x.qty, 0);
        const batch = batchById.get(a.batchId);
        return (
          <Dialog open onOpenChange={(o) => { if (!o) setOrderDetailAlloc(null); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{a.flight} — Packaging Load{a.orderNo ? ` · ${a.orderNo}` : ""}</DialogTitle>
                <DialogDescription>
                  Everything packaged for this flight on {a.date}. <b className="font-mono">{a.packagingId}</b> is highlighted.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                  <div><span className="text-muted-foreground">Flight:</span><span className="font-semibold ml-1">{a.flight}</span></div>
                  <div><span className="text-muted-foreground">Sector:</span><span className="font-semibold ml-1">{fo?.sector ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Order:</span><span className="font-semibold ml-1 font-mono">{a.orderNo ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Dep Time:</span><span className="font-semibold ml-1">{a.depTime ?? fo?.etd ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Date:</span><span className="font-semibold ml-1">{a.date}</span></div>
                  <div><span className="text-muted-foreground">PAX / Crew:</span><span className="font-semibold ml-1">{fo ? `${fo.pax} / ${crewOrder?.crew ?? fo.crew}` : "—"}</span></div>
                </div>

                {/* This package — the row that was clicked, stated on its own so
                    its quantity is never confused with the flight total. */}
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">This Package</div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="font-mono font-semibold">{a.packagingId}</span>
                    <span className="font-mono text-muted-foreground">{a.productionId}</span>
                    <span className="font-medium">{a.item}</span>
                    <span className="tabular-nums font-semibold">{a.qty.toLocaleString()} portions</span>
                    <AllocationBadge status={a.status} />
                    {batch && <span className="text-muted-foreground">QC {batch.measuredTemp}°C · {batch.date}</span>}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">
                    All Packages For {a.flight} ({legAllocs.length})
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border border-slate-200 rounded-md overflow-hidden">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="p-2 text-left font-semibold">Packaging ID</th>
                          <th className="p-2 text-left font-semibold">Production</th>
                          <th className="p-2 text-left font-semibold">Meal</th>
                          <th className="p-2 text-left font-semibold">Type</th>
                          <th className="p-2 text-right font-semibold">Qty</th>
                          <th className="p-2 text-left font-semibold">Warehouse</th>
                          <th className="p-2 text-left font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {legAllocs.map((x) => {
                          const xb = batchById.get(x.batchId);
                          const type = typeForItem(x.item, x.date);
                          return (
                            <tr key={x.id} className={cn("border-t border-slate-100", x.id === a.id && "bg-primary/5 font-medium")}>
                              <td className="p-2 font-mono">{x.packagingId}</td>
                              <td className="p-2 font-mono text-primary">{x.productionId}</td>
                              <td className="p-2">{x.item}</td>
                              <td className="p-2">
                                {type
                                  ? <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-semibold", MEAL_TYPE_BADGE[type] ?? "bg-muted text-foreground")}>{type}</span>
                                  : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="p-2 text-right tabular-nums font-medium">{x.qty.toLocaleString()}</td>
                              <td className="p-2 text-muted-foreground">{(xb ? warehouseForBatch(xb) : undefined) ?? "—"}</td>
                              <td className="p-2"><AllocationBadge status={x.status} /></td>
                            </tr>
                          );
                        })}
                        <tr className="border-t-2 border-slate-300 bg-slate-50/80">
                          <td className="p-2 font-bold" colSpan={4}>Total packaged for {a.flight}</td>
                          <td className="p-2 text-right font-bold tabular-nums">{legQty.toLocaleString()}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {!fo && (
                    <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                      No order in Order Management covers {a.flight} on {a.date} — sector, ETD and pax/crew are unavailable.
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOrderDetailAlloc(null)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Menu Plan status — the flight's full menu, each meal's produce/package
          state, so the user sees what still needs producing or packaging. */}
      <Dialog open={!!menuInfoGroup} onOpenChange={(o) => { if (!o) setMenuInfoGroup(null); }}>
        <DialogContent className="w-full max-w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {menuInfoGroup && (() => {
            const rd = flightReadiness(menuInfoGroup);
            const packagedCount = rd.meals.length - rd.notPackaged.length;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4" /> Menu Plan — {menuInfoGroup.flight}
                  </DialogTitle>
                  <DialogDescription>
                    {[menuInfoGroup.sector, menuInfoGroup.orderNo, menuInfoGroup.date].filter(Boolean).join(" · ")}
                    {" — "}
                    <span className={cn("font-semibold", rd.allPackaged ? "text-emerald-700" : "text-amber-700")}>
                      {packagedCount}/{rd.meals.length} meals packaged
                    </span>
                    {rd.allPackaged ? " — ready for dispatch." : " — not ready."}
                  </DialogDescription>
                </DialogHeader>

                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-2 text-left text-[11px] uppercase tracking-wider font-semibold">Meal</th>
                        <th className="p-2 text-left text-[11px] uppercase tracking-wider font-semibold w-40">Production</th>
                        <th className="p-2 text-left text-[11px] uppercase tracking-wider font-semibold w-40">Packaging</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rd.meals.map((m) => (
                        <tr key={m.name} className="border-t border-border">
                          <td className="p-2 font-medium">{m.name}</td>
                          <td className="p-2">
                            {m.produced ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" /> Produced
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                                <Clock className="h-3 w-3" /> Not produced
                              </span>
                            )}
                          </td>
                          <td className="p-2">
                            {m.packaged ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" /> Packaged
                              </span>
                            ) : m.produced ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                <Clock className="h-3 w-3" /> Awaiting packaging
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">— produce first</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {rd.notPackaged.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Still to package: <span className="font-medium text-foreground">{rd.notPackaged.map((m) => m.name).join(", ")}</span>.
                    {rd.notProduced.length > 0 && <> Produce first: <span className="font-medium text-foreground">{rd.notProduced.map((m) => m.name).join(", ")}</span>.</>}
                  </p>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => setMenuInfoGroup(null)}>Close</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* New Packaging — flight first. Pick a flight number and everything
          production sent for it (batches + the order's meal manifest) loads
          below; starting hands the ticked batches to the usual scan/print flow. */}
      <Dialog open={newOpen} onOpenChange={(o) => { if (!o) setNewOpen(false); }}>
        <DialogContent className="w-full max-w-full sm:max-w-5xl lg:max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plane className="h-4 w-4" /> New Packaging</DialogTitle>
            <DialogDescription>
              Choose a flight from Order Management — its order details and everything produced for it load below. Starting queues the ticked lines onto the packaging list, where the labels are printed &amp; scanned.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1 text-sm">
            {/* Flight picker — searchable, sourced from Order Management */}
            <div className="flex flex-col gap-1 sm:max-w-lg">
              <FieldLabel>Flight Number</FieldLabel>
              <FlightSearchSelect
                value={newFlightKey}
                onChange={chooseNewFlight}
                options={flightOptions}
              />
              <p className="text-[11px] text-muted-foreground">
                Search by flight no, order no, sector or date — every flight in Order Management is listed; the ones with QC-passed production come first.
              </p>
            </div>

            {/* Round trip — the paired leg from Order Management, packaged with
                the outbound unless the user unticks it. */}
            {newOption && newReturnOption && (() => {
              // Spell out what each half of the trip actually takes. "Package
              // both legs together" on its own doesn't say whether the return
              // adds 282 portions or nothing at all, which is the one thing the
              // decision to bundle it turns on.
              const outLoad = legLoad(newOption);
              const retLoad = legLoad(newReturnOption);
              const retOrder = findFlightOrder(newReturnOption);
              return (
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-900">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                    checked={includeReturn}
                    onChange={(e) => setIncludeReturn(e.target.checked)}
                  />
                  <span className="space-y-1">
                    <span className="block">
                      <b>Round trip</b> — {newOption.flight} ({newOption.sector ?? "—"}) returns as{" "}
                      <b className="font-mono">{newReturnOption.flight}</b> {newReturnOption.sector ?? ""}
                      {newReturnOption.etd ? `, dep ${newReturnOption.etd}` : ""} on {newReturnOption.date}
                      {retOrder ? ` · ${retOrder.pax} pax / ${retOrder.crew} crew` : ""}.
                      <span className="ml-1 text-sky-700">
                        Paired {newReturn?.via === "pairId"
                          ? "by Trip Ref from the flight upload"
                          : `by order ${newOption.orderNo ?? "#"} + reverse sector`}.
                      </span>
                    </span>
                    {/* Per-leg load, sized in order: the outbound claims its
                        share first, so the return's figure is what is left. */}
                    <span className="block font-semibold tabular-nums">
                      {newOption.flight} {outLoad.qty.toLocaleString()} portions
                      <span className="font-normal"> (from {outLoad.lines} production run{outLoad.lines === 1 ? "" : "s"})</span>
                      {" + "}
                      {newReturnOption.flight} {retLoad.qty.toLocaleString()} portions
                      <span className="font-normal"> (from {retLoad.lines} run{retLoad.lines === 1 ? "" : "s"})</span>
                      {includeReturn && (
                        <> {" = "}{(outLoad.qty + retLoad.qty).toLocaleString()} portions to package</>
                      )}
                    </span>
                    {retLoad.qty === 0 ? (
                      <span className="block text-sky-700">
                        Nothing sizes against {newReturnOption.flight} right now — the outbound takes what the day's runs have left, or the return's items aren't on its menu plan. Bundling it changes nothing.
                      </span>
                    ) : !includeReturn ? (
                      <span className="block text-sky-700">
                        Only {newOption.flight} will be packaged — {newReturnOption.flight}'s {retLoad.qty.toLocaleString()} portions stay unpackaged.
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })()}

            {newLegs.map((opt) => {
              const isReturnLeg = newLegs.length > 1 && opt.key === newReturnOption?.key;
              const pool = legPool(opt);
              const legMeals: PackagingRow[] = packagingRows.filter(
                (r) => r.flight === opt.flight && r.date === opt.date,
              );
              const mealQty = legMeals.reduce((s, r) => s + r.qty, 0);
              const fo = findFlightOrder(opt);
              const crewOrder = findCrewOrder(opt);
              // What the ORDER asks for vs. what the manifest actually raised as
              // production. Crew and special meals are ordered separately from the
              // passenger count, and a flight can easily have no production line
              // for them — say so instead of leaving the numbers unexplained.
              const isCrewLine = (r: PackagingRow) =>
                r.section.toLowerCase().includes("crew") || r.mealName.toLowerCase().includes("crew");
              const isSpecialLine = (r: PackagingRow) =>
                r.mealType === "Special" || r.section.toLowerCase().includes("special");
              const crewOnManifest = legMeals.filter(isCrewLine).reduce((s, r) => s + r.qty, 0);
              const specialOnManifest = legMeals.filter(isSpecialLine).reduce((s, r) => s + r.qty, 0);
              const crewOrdered = crewOrder?.crew ?? fo?.crew ?? 0;
              const specialOrdered = fo?.specialMeals ?? 0;
              const gaps = [
                crewOrdered > crewOnManifest ? `${crewOrdered - crewOnManifest} crew` : null,
                specialOrdered > specialOnManifest ? `${specialOrdered - specialOnManifest} special` : null,
              ].filter(Boolean) as string[];
              // ONE production list: every meal line of the flight order joined to
              // the QC batch that covers it, plus any batch with no manifest line.
              const covered = new Set(
                legMeals.map((r) => batchCovering(r, pool)?.id).filter(Boolean) as string[],
              );
              const runLines: { key: string; meal?: PackagingRow; batch?: PackagingBatch }[] = [
                ...legMeals.map((r) => ({ key: `m-${r.id}`, meal: r, batch: batchCovering(r, pool) })),
                ...pool.filter((b) => !covered.has(b.id)).map((b) => ({ key: `b-${b.id}`, batch: b })),
              ];
              const plan = legPlan(opt);
              // Total is this FLIGHT's load, not the sum of the runs' day totals.
              const lineQty = runLines.reduce(
                (s, l) => s + (l.batch ? (plan.get(l.batch.id)?.qty ?? 0) : (l.meal?.qty ?? 0)),
                0,
              );
              // A run that contributes nothing to this flight isn't a choice —
              // hide it, and say how many were hidden and why.
              const contributes = (l: { batch?: PackagingBatch }) =>
                !l.batch || (plan.get(l.batch.id)?.qty ?? 0) > 0;
              const excluded = runLines.filter((l) => !contributes(l));
              const shownLines = showExcluded ? runLines : runLines.filter(contributes);
              const excludedCovered = excluded.filter((l) => l.batch && plan.get(l.batch.id)?.reason !== "unsized").length;
              const excludedUnsized = excluded.length - excludedCovered;
              const sharedRuns = shownLines.filter((l) => l.batch && servedFlightCount(l.batch) > 1).length;
              return (
                <div key={opt.key} className="space-y-4">
                  {/* Flight / order summary — straight from the order book */}
                  <section>
                    <SectionTitle>
                      {newLegs.length > 1
                        ? `${isReturnLeg ? "Return Leg" : "Outbound Leg"} — ${opt.flight} · ${legLoad(opt).qty.toLocaleString()} portions`
                        : "Flight Details"}
                    </SectionTitle>
                    {!opt.fromOrderBook && (
                      <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                        {opt.flight === UNASSIGNED_FLIGHT ? (() => {
                          // Say WHY it is unassigned — the two causes need
                          // different fixes, and "no flight order" alone tells
                          // the user nothing about which one they are looking at.
                          const b = pool[0];
                          const tagged = b ? servedOrdersFor(b) : [];
                          return tagged.length > 0
                            ? `Tagged to order${tagged.length === 1 ? "" : "s"} ${tagged.join(", ")}, but no matching flight order exists in Order Management — check the order still exists for that date.`
                            : `No order covers this production: on ${b?.date ?? "its production date"} no flight order was flying whose menu plan includes ${b?.item ?? "this item"}. Add the item to that day's menu card, or raise the order, and it will link automatically — it can still be packaged on its own.`;
                        })() : `${opt.flight} has packaging batches but no order in Order Management for ${opt.date} — sector and ETD are unavailable.`}
                      </p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                      <Field label="Flight" value={opt.flight} />
                      <Field label="Airline" value={fo?.airline ?? opt.airline ?? "—"} />
                      <Field label="Sector" value={fo?.sector ?? opt.sector ?? "—"} />
                      <Field label="Order" value={opt.orderNo ?? "—"} mono />
                      <Field label="ETD" value={fo?.etd ?? opt.etd ?? "—"} />
                      <Field label="Order Date" value={fo?.date ?? opt.date} />
                      <Field label="PAX / Crew" value={fo ? `${fo.pax} / ${crewOrdered}` : "—"} />
                      <Field label="Special Meals" value={fo ? String(specialOrdered) : "—"} />
                      <Field label="On Manifest" value={mealQty > 0 ? `${mealQty.toLocaleString()} meals` : "—"} />
                    </div>
                    {fo && (crewOrdered > 0 || specialOrdered > 0) && (
                      <p className={cn(
                        "mt-2 rounded-md border px-2.5 py-1.5 text-[11px]",
                        gaps.length ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800",
                      )}>
                        Crew {crewOnManifest}/{crewOrdered} · Special {specialOnManifest}/{specialOrdered} raised as production.
                        {gaps.length
                          ? ` No production line covers ${gaps.join(" and ")} meal${gaps.length === 1 && !gaps[0].startsWith("1 ") ? "s" : ""} — nothing to package for them here.`
                          : " Fully covered by the lines below."}
                      </p>
                    )}
                  </section>

                  {/* One production list: manifest line + the batch covering it */}
                  <section>
                    {/* Header names what the rows ARE — production runs — and
                        their total, so the picker's summary reconciles here. */}
                    <SectionTitle>
                      Production Details — {shownLines.length} run{shownLines.length === 1 ? "" : "s"} · {lineQty.toLocaleString()} portions for {opt.flight}
                    </SectionTitle>
                    {shownLines.length === 0 && excluded.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                        Nothing has been produced for this flight yet — no meal manifest and no QC-passed batch.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border border-slate-200 rounded-md overflow-hidden">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="w-10 p-2 text-center">
                                {(() => {
                                  // Select-all is per LEG — it must not clear the
                                  // other half of a round trip.
                                  const approved = pool.filter((b) => b.status === "Approved");
                                  const ticked = approved.filter((b) => newSelected.has(selKey(opt.key, b.id)));
                                  return (
                                    <RowCheckbox
                                      checked={approved.length > 0 && ticked.length === approved.length}
                                      indeterminate={ticked.length > 0 && ticked.length < approved.length}
                                      disabled={approved.length === 0}
                                      onChange={() => setNewSelected((prev) => {
                                        const n = new Set(prev);
                                        const allOn = approved.length > 0 && ticked.length === approved.length;
                                        approved.forEach((b) => (allOn ? n.delete(selKey(opt.key, b.id)) : n.add(selKey(opt.key, b.id))));
                                        return n;
                                      })}
                                      label={`Select every approved line for ${opt.flight}`}
                                    />
                                  );
                                })()}
                              </th>
                              <th className="p-2 text-left font-semibold">Production ID</th>
                              <th className="p-2 text-left font-semibold">Meal / Item</th>
                              <th className="p-2 text-left font-semibold">Batch / Lot</th>
                              <th className="p-2 text-left font-semibold">Type</th>
                              <th className="p-2 text-right font-semibold">For This Flight</th>
                              <th className="p-2 text-right font-semibold">Run Produced</th>
                              <th className="p-2 text-left font-semibold">Warehouse</th>
                              <th className="p-2 text-right font-semibold">Temp</th>
                              <th className="p-2 text-left font-semibold">QC Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shownLines.map(({ key, meal, batch }) => {
                              const pe = batch ? peById.get(batch.batch) : undefined;
                              // This flight's share, from the shared plan.
                              const left = batch ? remainingOf(batch) : undefined;
                              const planned = batch ? plan.get(batch.id) : undefined;
                              const reqQty = batch ? planned?.qty : meal?.qty;
                              // A run already packaged for THIS flight can't be added
                              // again — Add to Run only offers the runs not yet created
                              // for it, so an existing allocation locks the row.
                              const existingAlloc = batch ? existingAllocation(allocations, batch.batch, opt.flight, opt.date) : undefined;
                              const alreadyCreated = !!existingAlloc && existingAlloc.status !== "Rejected";
                              // A line with no quantity to contribute can't join
                              // the run — its requirement is already covered by
                              // another run, or the item has no menu rule to size it.
                              const selectable = !!batch && (planned?.qty ?? 0) > 0 && !alreadyCreated;
                              const ticked = !alreadyCreated && !!batch && newSelected.has(selKey(opt.key, batch.id));
                              const producedQty = pe?.producedQty ?? (batch && batch.qty > 0 ? batch.qty : undefined);
                              const servesCount = batch ? servedFlightCount(batch) : 0;
                              const takenBy = batch ? flightsOfRun(allocations, batch.batch).filter((f) => f !== opt.flight) : [];
                              // Manifest first; then the menu card / meal master,
                              // and the run's own warehouse.
                              const type = meal?.mealType ?? (batch ? typeForItem(batch.item, batch.date) : undefined);
                              const warehouse = (batch ? warehouseForBatch(batch) : undefined) ?? meal?.section;
                              return (
                                <tr key={key} className={cn("border-t border-slate-100", ticked && "bg-primary/5")}>
                                  <td className="w-10 p-2 text-center align-middle">
                                    <RowCheckbox
                                      checked={ticked}
                                      disabled={!selectable}
                                      onChange={() => batch && setNewSelected((prev) => {
                                        const n = new Set(prev);
                                        const k = selKey(opt.key, batch.id);
                                        if (n.has(k)) n.delete(k); else n.add(k);
                                        return n;
                                      })}
                                      label={`Select ${batch?.batch ?? meal?.mealName ?? key} for ${opt.flight}`}
                                      title={
                                        selectable ? `Package ${batch!.batch} for ${opt.flight}`
                                          : alreadyCreated ? `${batch!.batch} is already in a run for ${opt.flight} (${existingAlloc!.status}) — nothing to add.`
                                          : !batch ? "No QC-passed batch for this meal yet"
                                          : planned?.reason === "covered" ? `${opt.flight} needs ${planned.required?.toLocaleString()} ${batch.item}, and ${planned.coveredBy ?? "another run"} already supplies all of it. This run stays available for other flights.`
                                          : planned?.reason === "unsized" ? `${batch.item} isn't on any meal card for this day, so there is no rule to size it against ${opt.flight}. Add it to the menu plan and it will size automatically.`
                                          : `${batch.batch} is fully allocated to other flights`
                                      }
                                    />
                                  </td>
                                  <td className="p-2 whitespace-nowrap">
                                    {batch
                                      ? <span className="inline-flex items-center gap-1.5">
                                          <span className={cn("font-mono", alreadyCreated ? "text-muted-foreground line-through" : "text-primary")}>{batch.batch}</span>
                                          {alreadyCreated && (
                                            <span className="rounded-full border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Already in run</span>
                                          )}
                                        </span>
                                      : meal?.productionOrderId
                                        // Manifest line with no QC-passed batch — it can't join the
                                        // run, and with the Status column gone this is what says so.
                                        ? <span className="font-mono text-muted-foreground">{meal.productionOrderId} · no QC batch</span>
                                        : <span className="text-muted-foreground">no QC batch</span>}
                                  </td>
                                  <td className="p-2">{meal?.mealName ?? batch?.item}</td>
                                  <td className="p-2">
                                    {(() => {
                                      const lots = batch ? (lotsByOrder.get(batch.batch) ?? []) : [];
                                      if (lots.length === 0) {
                                        return <span className="text-muted-foreground" title="No batch/lot recorded for this run">—</span>;
                                      }
                                      return (
                                        <div className="flex flex-wrap gap-1">
                                          {lots.map((l) => (
                                            <span
                                              key={l.batchNo}
                                              title={`Lot ${l.batchNo} · ${l.qty.toLocaleString()} produced${l.expiry ? ` · exp ${l.expiry}` : ""}`}
                                              className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-mono text-primary"
                                            >
                                              <Layers className="h-3 w-3 shrink-0" />
                                              {l.batchNo}
                                              {lots.length > 1 && <span className="text-muted-foreground">×{l.qty.toLocaleString()}</span>}
                                            </span>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  <td className="p-2">
                                    {type
                                      ? <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-semibold", MEAL_TYPE_BADGE[type] ?? "bg-muted text-foreground")}>{type}</span>
                                      : <span className="text-muted-foreground">—</span>}
                                  </td>
                                  <td className="p-2 text-right tabular-nums font-semibold">
                                    {reqQty ? reqQty.toLocaleString() : <span className="text-muted-foreground font-normal">—</span>}
                                    {planned?.reason && (
                                      <span className="block text-[10px] font-normal text-amber-700">
                                        {planned.reason === "covered"
                                          ? <>all {planned.required?.toLocaleString()} covered by{planned.coveredBy ? <> <span className="font-mono">{planned.coveredBy}</span></> : " another run"}</>
                                          : planned.reason === "exhausted" ? "run fully allocated to other flights"
                                          : "not on this day's menu plan"}
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                                    {producedQty?.toLocaleString() ?? "—"}
                                    {servesCount > 1 && (
                                      <span className="ml-1 text-[10px]" title={`This run serves ${servesCount} flights that day`}>
                                        ÷{servesCount}
                                      </span>
                                    )}
                                    {takenBy.length > 0 && (
                                      <span
                                        className="ml-1 block text-[10px] text-amber-700"
                                        title={`Already allocated to ${takenBy.join(", ")} — ${left?.toLocaleString()} left`}
                                      >
                                        {left?.toLocaleString()} left
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-2 text-muted-foreground">{warehouse ?? "—"}</td>
                                  <td className="p-2 text-right tabular-nums whitespace-nowrap">
                                    {batch ? <span className="font-medium text-emerald-600">{batch.measuredTemp}°C</span> : <span className="text-muted-foreground">—</span>}
                                  </td>
                                  <td className="p-2 tabular-nums text-muted-foreground whitespace-nowrap">{batch?.date ?? "—"}</td>
                                </tr>
                              );
                            })}
                            <tr className="border-t-2 border-slate-300 bg-slate-50/80">
                              <td className="p-2 font-bold" colSpan={5}>Total</td>
                              <td className="p-2 text-right font-bold tabular-nums">{lineQty}</td>
                              <td colSpan={4}></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                    {excluded.length > 0 && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                        {excluded.length} run{excluded.length === 1 ? "" : "s"} not shown
                        {excludedCovered > 0 && ` — ${excludedCovered} already covered by another run of the same item`}
                        {excludedCovered > 0 && excludedUnsized > 0 && ","}
                        {excludedUnsized > 0 && ` ${excludedUnsized} not on this day's menu plan`}.
                        <button
                          type="button"
                          className="font-semibold underline underline-offset-2 hover:text-foreground"
                          onClick={() => setShowExcluded((v) => !v)}
                        >
                          {showExcluded ? "Hide them" : "Show them"}
                        </button>
                      </p>
                    )}
                    {sharedRuns > 0 && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {sharedRuns} of these run{sharedRuns === 1 ? " is" : "s are"} shared across several of the day's flights — <b>Run Produced</b> is the day total, and only <b>For This Flight</b> ({lineQty.toLocaleString()} portions, sized from {opt.flight}'s {fo?.pax ?? "—"} pax / {crewOrdered} crew) is packaged here.
                      </p>
                    )}
                  </section>
                </div>
              );
            })}
          </div>

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            <p className="mr-auto text-[11px] text-muted-foreground">
              {newLegs.length > 1
                ? `Starting queues ${newJobs
                    .map((j) => `${j.leg.flight} ${j.lines.reduce((s, l) => s + l.qty, 0).toLocaleString()} portions (${j.lines.length} run${j.lines.length === 1 ? "" : "s"})`)
                    .join(" and ")} — print & scan the labels from the list.`
                : "Starting adds the ticked lines to the packaging list — print & scan the labels from there."}
            </p>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={startNewPackaging} disabled={!newOption || newEligibleCount === 0}>
              <PackageCheck className="h-4 w-4 mr-1.5" /> Start Packaging{newEligibleCount > 0 ? ` (${newEligibleCount})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-batch Scan — the label for one batch; scanning marks it Packaging Done */}
      {/* Print Labels — one card per batch; printing completes packaging (no scan) */}
      <Dialog open={labelOpen} onOpenChange={(v) => !v && closeLabelModal()}>
        <DialogContent className="w-full max-w-full sm:max-w-3xl max-h-[100vh] sm:max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b shrink-0">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Printer className="h-4 w-4" /> Print Labels — Packaging
            </DialogTitle>
          </div>

          {/* Print all — completes packaging */}
          <div className="px-6 py-3 border-b bg-muted/30 shrink-0 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {packagingLabels.length} label{packagingLabels.length === 1 ? "" : "s"} · printing marks them <b>Packaging Done</b> (ready for dispatch).
            </span>
            <Button size="sm" onClick={printAll} disabled={printedAll || packagingLabels.length <= 1}>
              <Printer className="h-3.5 w-3.5 mr-1" /> {printedAll ? "Printed" : "Print All Labels"}
            </Button>
          </div>

          {/* Label cards */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {packagingLabels.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-10">
                No labels in progress. Approve batches, then Initiate Packaging.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {packagingLabels.map((a) => {
                  const b = batchById.get(a.batchId);
                  const code = `LBL-${a.productionId}-${a.flight}`;
                  return (
                    <div key={a.id} className="rounded-lg border-2 border-dashed border-border bg-card p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          USBA Catering · Meal Label
                        </span>
                        <span className="text-[10px] font-bold text-amber-600">READY TO PRINT</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-sm">{a.item}</span>
                        {/* The label carries THIS flight's quantity, not the run's. */}
                        <span className="text-xs tabular-nums text-muted-foreground shrink-0">Qty {a.qty.toLocaleString()}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>Flight <b className="text-foreground">{a.flight}</b></span>
                        {a.orderNo && <span>Order <b className="text-foreground font-mono">{a.orderNo}</b></span>}
                        <span>Batch <b className="text-foreground font-mono">{a.productionId}</b></span>
                        {b && <span>Meas <b className="text-foreground">{b.measuredTemp}°C</b></span>}
                        <span>{a.date}</span>
                      </div>
                      {/* Decorative barcode (matches Dispatch label format) */}
                      <div className="mt-1">
                        <div className="flex items-end gap-[1px] h-8 w-full overflow-hidden" aria-hidden>
                          {code.split("").flatMap((ch, i) =>
                            [0, 1, 2, 3].map((k) => (
                              <span
                                key={`${i}-${k}`}
                                className="bg-slate-900"
                                style={{ width: ((ch.charCodeAt(0) >> k) & 1) ? 3 : 1, height: "100%" }}
                              />
                            )),
                          )}
                        </div>
                        <div className="text-center font-mono text-[11px] tracking-widest mt-1">{code}</div>
                      </div>
                      {/* Per-card Print only for a single-batch run — multi-batch
                          runs use one "Print All Labels" click (no batch-by-batch). */}
                      {packagingLabels.length === 1 && (
                        <div className="flex gap-2 mt-1">
                          <Button
                            variant="outline" size="sm" className="h-7 px-2 text-xs flex-1"
                            onClick={() => printOne(a)}
                          >
                            <Printer className="h-3 w-3 mr-1" /> Print
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Truck className="h-3.5 w-3.5" />
              {packagingLabels.length > 0
                ? "Print the labels to complete packaging — batches become Ready for Dispatch."
                : "All batches packaged — forwarded to Dispatch."}
            </p>
            <Button variant="outline" onClick={closeLabelModal}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The one selection control used everywhere on this page — list header, flight
 * rows, batch rows and the New Packaging table. Keeping it in one place is what
 * makes the checkbox column read as a single rail: same size, same alignment,
 * and a disabled (rather than missing) box wherever a row can't be selected, so
 * the column never has holes in it.
 */
function RowCheckbox({
  checked, indeterminate, disabled, onChange, label, title, tone = "row",
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
  title?: string;
  tone?: "row" | "group";
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={label}
      title={title ?? label}
      className={cn(
        "h-4 w-4 shrink-0 align-middle accent-primary",
        disabled ? "cursor-not-allowed opacity-25" : "cursor-pointer",
        tone === "group" && !disabled && "ring-1 ring-sky-300 ring-offset-1 rounded-[3px]",
      )}
    />
  );
}

/**
 * Searchable flight picker (Popover + cmdk), matching the Order Management
 * form's SearchSelect. Filtering is done here rather than by cmdk because the
 * order book runs to thousands of legs — we match the whole list and render only
 * the top slice, so a search still reaches every flight without mounting them all.
 */
function FlightSearchSelect({
  value, onChange, options, max = 60,
}: {
  value: string;
  onChange: (key: string) => void;
  options: FlightOption[];
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.key === value);
  const q = query.trim().toLowerCase();
  const matches = (q
    ? options.filter((o) =>
        `${o.flight} ${o.orderNo ?? ""} ${o.sector ?? ""} ${o.date} ${o.airline ?? ""} ${o.etd ?? ""}`
          .toLowerCase()
          .includes(q))
    : options
  ).slice(0, max);
  const label = (o: FlightOption) =>
    `${o.flight} · ${o.date}${o.etd ? ` · ${o.etd}` : ""}${o.orderNo ? ` · ${o.orderNo}` : ""}`;
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            !selected && "text-muted-foreground",
          )}
        >
          <span className="truncate text-left">
            {selected
              ? `${label(selected)} — ${selected.planQty > 0
                  ? `${selected.planQty.toLocaleString()} portions from ${selected.planLines} production run${selected.planLines === 1 ? "" : "s"}`
                  : "nothing to package"}`
              : "Search or select a flight…"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Flight no, order no, sector or date…"
            className="h-9"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No flight matches that search.</CommandEmpty>
            <CommandGroup>
              {matches.map((o) => (
                <CommandItem key={o.key} value={o.key} onSelect={() => { onChange(o.key); setOpen(false); setQuery(""); }}>
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === o.key ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">
                    <span className="font-medium">{o.flight}</span>
                    <span className="text-muted-foreground"> · {o.date}{o.etd ? ` · ${o.etd}` : ""}</span>
                    {o.sector && <span className="text-muted-foreground"> · {o.sector}</span>}
                    {o.orderNo && <span className="font-mono text-[11px] text-muted-foreground"> · {o.orderNo}</span>}
                  </span>
                  {/* This leg's own load. `planQty` differs per flight; the pool
                      counts do not — see the flightOptions comment. */}
                  {o.planQty > 0 ? (
                    <span
                      className="ml-2 shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-700"
                      title={`${o.planLines} of the ${o.batchCount} run${o.batchCount === 1 ? "" : "s"} that can serve this date contribute to ${o.flight} — ${o.planQty.toLocaleString()} portions`}
                    >
                      {o.planQty.toLocaleString()}
                    </span>
                  ) : o.batchCount > 0 ? (
                    <span
                      className="ml-2 shrink-0 text-[10px] text-muted-foreground"
                      title={`${o.batchCount} QC-passed run${o.batchCount === 1 ? " serves" : "s serve"} this date, but none of them size against ${o.flight} — already covered by another run, or not on its menu plan.`}
                    >
                      nothing to package
                    </span>
                  ) : (
                    <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">no production</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 pb-1 border-b border-border">{children}</div>;
}
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{children}</div>;
}
function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className={mono ? "font-mono text-sm" : "font-medium"}>{value}</div>
    </div>
  );
}
