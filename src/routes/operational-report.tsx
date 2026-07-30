import { useMemo, useState, type ReactNode } from "react";
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
  FileText, BadgeCheck, Factory, Package, Truck, PlaneTakeoff, Plane,
  Search, Eye, Check, CircleDot, Layers, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useFlightOrders, getOrderAmendments, type FlightOrder, type OrderAmendment } from "@/lib/flight-orders-store";
import { isDomesticSector, type FlightOrderStatus } from "@/lib/sample-data";
import { useWorkflow, type WfProductionEntry } from "@/lib/workflow-store";
import { isPackaged, type PackagingAllocation } from "@/lib/packaging-allocations";
import { INITIAL_RECORDS, type DispatchRecord } from "@/routes/dispatch";
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
  { key: "departure",  label: "Departed",   icon: PlaneTakeoff },
] as const;

/**
 * How many stages the leg's stored status has completed. "Production" maps to 2
 * (not 3): the status means the kitchen is WORKING, so Production is the
 * current stage, not a finished one. Packaged completes both Production and
 * Packaging — nothing packages before its runs exist.
 */
const DONE_COUNT: Record<FlightOrderStatus, number> = {
  Pending: 1, Approved: 2, Production: 2, Packaged: 4, Dispatched: 5, Completed: 6, Departed: 6,
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

/** Everything the report knows about one flight leg's journey. */
type LegLife = {
  leg: FlightOrder;
  doneCount: number;
  /** Production runs serving this leg's order on its date (plus any runs its
   *  packaging actually drew on — the allocations are the stronger link). */
  runs: WfProductionEntry[];
  qcPassed: number;
  producedQty: number;
  /** Packaging allocations raised for this flight + date. */
  allocs: PackagingAllocation[];
  packagedCount: number;
  dispatchRec?: DispatchRecord;
  amendments: OrderAmendment[];
  lmcCount: number;
  /** When the leg was approved, if the amendment trail recorded it. */
  approvedAt?: string;
  approvedBy?: string;
};

const fmtStamp = (iso?: string) => (iso ? iso.slice(0, 16).replace("T", " ") : undefined);

function buildLegLife(
  leg: FlightOrder,
  runsByOrderDate: Map<string, WfProductionEntry[]>,
  runById: Map<string, WfProductionEntry>,
  allocsByLeg: Map<string, PackagingAllocation[]>,
  dispatchByLeg: Map<string, DispatchRecord>,
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

  return {
    leg,
    doneCount: DONE_COUNT[leg.status] ?? 1,
    runs,
    qcPassed: runs.filter((r) => !!r.qcPassedAt).length,
    producedQty: runs.reduce((s, r) => s + (r.producedQty || 0), 0),
    allocs,
    packagedCount: allocs.filter(isPackaged).length,
    dispatchRec: dispatchByLeg.get(`${leg.flight}|${leg.date}`),
    amendments,
    lmcCount: amendments.filter((a) => a.isLmc).length,
    approvedAt: approval?.at,
    approvedBy: approval?.by,
  };
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
    case "dispatch":
      return l.dispatchRec ? `${l.dispatchRec.id} · ${l.dispatchRec.status} · ${l.dispatchRec.kitchenName}` : l.doneCount >= 5 ? "Dispatched" : "Not dispatched yet";
    case "departure":
      return l.doneCount >= 6 ? `Flight ${leg.status.toLowerCase()}` : "Not departed yet";
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
function LegDetailDialog({ life, onClose }: { life: LegLife | null; onClose: () => void }) {
  if (!life) return null;
  const { leg } = life;
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

        <div className="mb-1"><LifecycleStepper life={life} /></div>

        <div className="space-y-3">
          <Section icon={FileText} title="Order">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
              <div><span className="text-muted-foreground">Order #</span><div className="font-mono font-semibold text-primary">{leg.orderNo}</div></div>
              <div><span className="text-muted-foreground">Airline</span><div className="font-medium">{leg.airline}</div></div>
              <div><span className="text-muted-foreground">PAX / Crew</span><div className="tabular-nums">{leg.pax} / {leg.crew}</div></div>
              <div><span className="text-muted-foreground">Special Meals</span><div className="tabular-nums">{leg.specialMeals}</div></div>
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

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [scope, setScope] = useState<"all" | "Domestic" | "International">("all");
  const [airlineF, setAirlineF] = useState("all");
  const [statusF, setStatusF] = useState<"all" | FlightOrderStatus>("all");
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
    return { runsByOrderDate, runById, allocsByLeg, dispatchByLeg };
  }, [productionEntries, allocations, dispatchRecords]);

  // Passenger flight legs only — crew meal orders ride the same flights and
  // would double every row without adding a lifecycle of their own.
  const lives = useMemo(() => {
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
      .map((leg) => buildLegLife(leg, lookups.runsByOrderDate, lookups.runById, lookups.allocsByLeg, lookups.dispatchByLeg));
  }, [flightOrders, search, dateFrom, dateTo, scope, airlineF, statusF, lookups]);

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

  const kpi = useMemo(() => ({
    flights: lives.length,
    pipeline: lives.filter((l) => l.doneCount <= 4).length,
    dispatched: lives.filter((l) => l.doneCount === 5).length,
    departed: lives.filter((l) => l.doneCount >= 6).length,
  }), [lives]);

  const hasFilters = !!(search || dateFrom || dateTo || scope !== "all" || airlineF !== "all" || statusF !== "all");

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
      ["Search", search.trim() || false],
    ]),
    columns: ["Order", "Flight", "Direction", "Sector", "Airline", "Date", "ETD", "PAX", "Crew", "Special", "Status", "Lifecycle", "Production", "Packaging", "Dispatch"],
    numericCols: [7, 8, 9],
    rows: lives.map((l) => [
      l.leg.orderNo, l.leg.flight, l.leg.direction, l.leg.sector, l.leg.airline, l.leg.date, l.leg.etd,
      l.leg.pax, l.leg.crew ?? 0, l.leg.specialMeals, l.leg.status,
      l.doneCount >= 6 ? "Complete (6/6)" : `${l.doneCount}/6 — at ${STAGES[l.doneCount].label}`,
      l.runs.length ? `${l.runs.length} runs · ${l.qcPassed} QC passed · ${l.producedQty} portions` : "—",
      l.allocs.length ? `${l.packagedCount}/${l.allocs.length} done` : "—",
      l.dispatchRec ? `${l.dispatchRec.id} · ${l.dispatchRec.status}` : "—",
    ]),
  });

  return (
    <>
      <PageHeader
        title="Operational Report"
        subtitle="The full order-to-departure lifecycle of every flight — order, approval, production, packaging, dispatch and departure on one line"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Flights" value={kpi.flights} icon={Plane} tone="navy" />
        <KpiCard label="In Pipeline" value={kpi.pipeline} icon={Factory} tone="warning" />
        <KpiCard label="Dispatched" value={kpi.dispatched} icon={Truck} tone="success" />
        <KpiCard label="Departed / Completed" value={kpi.departed} icon={PlaneTakeoff} tone="info" />
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
            onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setScope("all"); setAirlineF("all"); setStatusF("all"); setPage(1); }}
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
            const done = legs.filter((l) => l.doneCount >= 6).length;
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
                  <Table className="min-w-[860px]">
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider">Flight</TableHead>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider">Sector</TableHead>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider">Date · ETD</TableHead>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider text-right">Load</TableHead>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider">Lifecycle</TableHead>
                        <TableHead className="h-9 text-[10px] uppercase tracking-wider">Status</TableHead>
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
                            {(l.leg.pax + (l.leg.crew ?? 0) + l.leg.specialMeals).toLocaleString()}
                          </TableCell>
                          <TableCell className="py-2"><LifecycleStepper life={l} /></TableCell>
                          <TableCell className="py-2">
                            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap", STATUS_BADGE[l.leg.status])}>
                              {l.leg.status}
                            </span>
                          </TableCell>
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

      <LegDetailDialog life={viewLife} onClose={() => setViewLife(null)} />
    </>
  );
}
