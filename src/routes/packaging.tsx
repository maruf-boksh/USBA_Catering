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
import {
  Package, PackageCheck, Printer, ScanLine, CheckCircle2, Eye, Boxes, Clock, Truck, Search,
} from "lucide-react";
import { toast } from "sonner";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useWorkflow, type WfProductionEntry } from "@/lib/workflow-store";
import { cn } from "@/lib/utils";
import { INITIAL_PACKAGING_ROWS, type PackagingRow } from "@/routes/dispatch";
import { getFlightOrders } from "@/lib/flight-orders-store";
import { useArrivalFlash, peekArrivalRows } from "@/lib/arrival-flash";
import {
  mergePassedBatches,
  type PackagingBatch,
  type PackagingBatchStatus,
} from "@/lib/packaging-batches";

// Meal-type pill colors (mirrors the Dispatch Order-Details modal).
const MEAL_TYPE_BADGE: Record<string, string> = {
  Breakfast: "bg-amber-100 text-amber-700",
  Lunch: "bg-orange-100 text-orange-700",
  Dinner: "bg-indigo-100 text-indigo-700",
  Snack: "bg-sky-100 text-sky-700",
  Special: "bg-fuchsia-100 text-fuchsia-700",
};

const labelCode = (b: PackagingBatch) => `LBL-${b.batch}`;
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

function StatusBadge({ status }: { status: PackagingBatchStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", STATUS_TONE[status])}>
      {status}
    </span>
  );
}

export default function PackagingPage() {
  const navigate = useNavigate();
  useArrivalFlash();
  const { productionEntries } = useWorkflow();
  const [batches, setBatches] = usePersistedState<PackagingBatch[]>("packaging-batches", []);

  // Produced qty resolver — cooking-temp records don't carry qty, so look it up
  // from the linked production entry (read-only).
  const qtyFor = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of productionEntries) map.set(e.id, e.producedQty);
    return (productionId: string) => map.get(productionId) ?? 0;
  }, [productionEntries]);

  // Pull newly-passed QC batches into the list as "Pending Approval" (idempotent).
  useEffect(() => {
    setBatches((prev) => mergePassedBatches(prev, qtyFor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flight-order manifest (ORD-…) — the whole order a production batch belongs to.
  const [packagingRows] = usePersistedState<PackagingRow[]>("dispatch-packaging-rows", INITIAL_PACKAGING_ROWS);
  // Production-entry lookup (Req/Produced qty, QC times, status) keyed by PRO id.
  const peById = useMemo(() => {
    const m = new Map<string, WfProductionEntry>();
    for (const e of productionEntries) m.set(e.id, e);
    return m;
  }, [productionEntries]);
  // The flight-order row a batch's production id belongs to (carries Order No, flight, dep time…).
  const orderRowForBatch = (productionId: string) => packagingRows.find((r) => r.productionOrderId === productionId);
  // Every meal on that order (same flight + dep time + date) — the full manifest.
  const orderMealsForBatch = (productionId: string): PackagingRow[] => {
    const row = orderRowForBatch(productionId);
    if (!row) return [];
    return packagingRows.filter((r) => r.flight === row.flight && r.depTime === row.depTime && r.date === row.date);
  };
  const sectorForFlight = (flight?: string) => (flight ? getFlightOrders().find((o) => o.flight === flight)?.sector : undefined);
  // Passenger flight orders (Order Management) — the pool we resolve a batch's
  // Order ID + flight from.
  const flightOrderList = useMemo(() => getFlightOrders().filter((o) => (o.orderType ?? "flight") === "flight"), []);
  // Order ID + flight for a production: prefer the real dispatch/order-row link;
  // for a production packaged directly (no dispatch row) associate it with a real
  // flight order — same date when available, otherwise a stable pick keyed off the
  // production id — so both columns show real, consistent values.
  const orderInfoForBatch = (productionId: string, date: string): { orderNo?: string; flight?: string } => {
    const row = orderRowForBatch(productionId);
    if (row?.orderNo || row?.flight) return { orderNo: row?.orderNo, flight: row?.flight };
    if (flightOrderList.length === 0) return {};
    const sameDate = flightOrderList.filter((o) => o.date === date);
    const pool = sameDate.length ? sameDate : flightOrderList;
    const n = parseInt(productionId.replace(/\D/g, "").slice(-6) || "0", 10);
    const o = pool[n % pool.length];
    return { orderNo: o.orderNo, flight: o.flight };
  };

  const [viewBatch, setViewBatch] = useState<PackagingBatch | null>(null);
  const [orderDetailBatch, setOrderDetailBatch] = useState<PackagingBatch | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  // Printing labels completes packaging (no scan step is required here).
  const [printedAll, setPrintedAll] = useState(false);
  // Batches initiated in the CURRENT packaging session — the label modal only
  // shows these (so a single-batch run never shows unrelated in-progress labels).
  const [sessionIds, setSessionIds] = useState<Set<string>>(new Set());
  // Selection (checkbox) — Initiate Packaging runs for the ticked Approved batches.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Filters
  const [searchText, setSearchText] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | PackagingBatchStatus>("all");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Passed batches only (Rejected hidden), narrowed by the filters.
  const rows = batches
    .filter((b) => b.status !== "Rejected")
    .filter((b) => {
      if (searchText.trim() && !`${b.batch} ${b.item}`.toLowerCase().includes(searchText.trim().toLowerCase())) return false;
      if (dateFrom && b.date < dateFrom) return false;
      if (dateTo && b.date > dateTo) return false;
      if (filterStatus !== "all" && b.status !== filterStatus) return false;
      return true;
    });

  // Pagination — same format as Order Management / other list pages.
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageStart = (page - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, rows.length);
  const pagedRows = rows.slice(pageStart, pageEnd);
  useEffect(() => { setPage(1); }, [searchText, dateFrom, dateTo, filterStatus]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  // Deep link from the Dispatch table's Packaging ID → jump to the page holding
  // the target row so useArrivalFlash can find & blink it.
  const flashJumpDone = useRef(false);
  useEffect(() => {
    if (flashJumpDone.current) return;
    const targets = peekArrivalRows();
    if (targets.length === 0) return;
    const idx = rows.findIndex((b) => targets.includes(b.batch));
    if (idx >= 0) {
      flashJumpDone.current = true;
      setPage(Math.floor(idx / pageSize) + 1);
    }
  }, [rows]);
  const approvedRows = rows.filter((b) => b.status === "Approved");
  const allApprovedSelected = approvedRows.length > 0 && approvedRows.every((b) => selectedIds.has(b.id));
  const toggleSelectAll = () => setSelectedIds(allApprovedSelected ? new Set() : new Set(approvedRows.map((b) => b.id)));
  const toggleSelectOne = (id: string) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const approvedCount = batches.filter((b) => b.status === "Approved").length;
  const inProgressCount = batches.filter((b) => b.status === "Packaging In Progress").length;
  const doneCount = batches.filter((b) => b.status === "Packaging Done").length;
  const pendingApprovalCount = batches.filter((b) => b.status === "Pending Approval").length;

  // Batches shown as labels: only the ones in the current session that are still
  // mid-packaging (avoids showing stale/unrelated in-progress batches).
  const packagingLabels = batches.filter((b) => b.status === "Packaging In Progress" && sessionIds.has(b.id));

  // Start packaging: move every Approved batch to "Packaging In Progress" and open
  // the print/scan modal. Already-in-progress batches are included too.
  const initiatePackaging = () => {
    const approved = batches.filter((b) => b.status === "Approved");
    // Ticked batches take priority; otherwise every approved batch is packaged.
    const eligible = selectedIds.size > 0 ? approved.filter((b) => selectedIds.has(b.id)) : approved;
    if (eligible.length === 0) {
      toast.error("Select approved batches to package (or none to package all).");
      return;
    }
    const ids = new Set(eligible.map((b) => b.id));
    setBatches((prev) =>
      prev.map((b) => (ids.has(b.id) ? { ...b, status: "Packaging In Progress" as PackagingBatchStatus } : b)),
    );
    setSessionIds(ids);          // only these batches show in the label modal
    setSelectedIds(new Set());
    setPrintedAll(false);
    setLabelOpen(true);
  };

  // Print all labels → every batch in this session becomes Packaging Done (ready
  // for dispatch). It stays visible in the list and shows on the Dispatch page.
  const printAll = () => {
    if (packagingLabels.length === 0) { toast.error("No labels to print."); return; }
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const ids = new Set(packagingLabels.map((b) => b.id));
    setBatches((prev) =>
      prev.map((b) => (ids.has(b.id) ? { ...b, status: "Packaging Done" as PackagingBatchStatus, packagedAt: now, dispatchId: b.dispatchId ?? `DSP-${b.batch}` } : b)),
    );
    setPrintedAll(true);
    toast.success(`${ids.size} label${ids.size === 1 ? "" : "s"} printed — Packaging Done, ready for dispatch.`);
  };

  // Print a single label → that batch becomes Packaging Done (ready for dispatch)
  // and appears on the Dispatch page. No auto-redirect — the user closes the modal.
  const printOne = (b: PackagingBatch) => {
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    setBatches((prev) =>
      prev.map((x) => (x.id === b.id ? { ...x, status: "Packaging Done" as PackagingBatchStatus, packagedAt: now, dispatchId: x.dispatchId ?? `DSP-${x.batch}` } : x)),
    );
    toast.success(`${b.item} label printed — Packaging Done, ready for dispatch.`);
  };

  // Close the label modal — revert any un-printed session batches back to Approved
  // (so nothing is left stuck "In Progress" if the run is abandoned).
  const closeLabelModal = () => {
    setBatches((prev) =>
      prev.map((b) => (sessionIds.has(b.id) && b.status === "Packaging In Progress" ? { ...b, status: "Approved" as PackagingBatchStatus } : b)),
    );
    setSessionIds(new Set());
    setLabelOpen(false);
  };

  return (
    <>
      <PageHeader
        title="Packaging"
        subtitle="Batches that passed both temperature and taste QC — approve, print & scan labels, then forward to Dispatch"
        actions={
          <Button onClick={initiatePackaging} disabled={approvedCount === 0}>
            <PackageCheck className="h-4 w-4 mr-1.5" /> Initiate Packaging{selectedIds.size > 0 ? ` (${selectedIds.size})` : approvedCount > 0 ? ` (${approvedCount})` : ""}
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Awaiting Approval" value={pendingApprovalCount} icon={Clock} tone="warning" />
        <KpiCard label="Approved" value={approvedCount} icon={Package} tone="navy" />
        <KpiCard label="In Packaging" value={inProgressCount} icon={Boxes} tone="navy" />
        <KpiCard label="Packaging Done" value={doneCount} icon={CheckCircle2} tone="success" />
      </div>

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
            onChange={(e) => setFilterStatus(e.target.value as "all" | PackagingBatchStatus)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="all">All</option>
            <option value="Pending Approval">Pending Approval</option>
            <option value="Approved">Approved</option>
            <option value="Packaging In Progress">Packaging In Progress</option>
            <option value="Packaging Done">Packaging Done</option>
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

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-9">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary cursor-pointer align-middle"
                  checked={allApprovedSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all approved batches"
                  title="Select all approved"
                />
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Packaging ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Production ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Meals</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                  No packaging batches yet. Batches appear here once they pass both temperature and taste QC.
                </TableCell>
              </TableRow>
            ) : (
              pagedRows.map((b) => {
                return (
                  <TableRow key={b.id} data-arrival-row-id={b.batch} className={cn("hover:bg-muted/30", selectedIds.has(b.id) && "bg-primary/5")}>
                    {/* Select — only Approved batches are selectable for packaging */}
                    <TableCell className="text-center">
                      {b.status === "Approved" && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary cursor-pointer align-middle"
                          checked={selectedIds.has(b.id)}
                          onChange={() => toggleSelectOne(b.id)}
                          aria-label={`Select ${b.batch}`}
                        />
                      )}
                    </TableCell>
                    {/* Packaging ID — system-generated per production package */}
                    <TableCell>
                      <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600 whitespace-nowrap">
                        {packagingId(b)}
                      </span>
                    </TableCell>
                    {/* Production ID — clickable → Production Order table, blinks that row */}
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => { navigate(`/production-entry?pro=${encodeURIComponent(b.batch)}`); }}
                        className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary hover:bg-primary/10 focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors"
                        title="Open in Production Order"
                      >
                        {b.batch}
                      </button>
                    </TableCell>
                    {/* Flight — fetched from the linked/associated flight order */}
                    <TableCell>
                      {(() => {
                        const flight = orderInfoForBatch(b.batch, b.date).flight;
                        return flight ? (
                          <span className="inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 whitespace-nowrap">
                            {flight}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        );
                      })()}
                    </TableCell>
                    {/* Meals — clickable → Order Details (full manifest for the order) */}
                    <TableCell>
                      {(() => {
                        const meals = orderMealsForBatch(b.batch);
                        const count = meals.length || 1;
                        const total = meals.length ? meals.reduce((s, r) => s + r.qty, 0) : (b.qty > 0 ? b.qty : 0);
                        return (
                          <button
                            type="button"
                            onClick={() => setOrderDetailBatch(b)}
                            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline focus:outline-none focus:underline"
                            title="View order meal manifest"
                          >
                            <Eye className="h-3.5 w-3.5" /> {count} item{count === 1 ? "" : "s"} · {total > 0 ? total : "—"}
                          </button>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">{b.date}</TableCell>
                    <TableCell>
                      <div className="inline-flex items-center gap-1.5 flex-wrap">
                        <StatusBadge status={b.status} />
                        {b.status === "Packaging Done" && (
                          <span className="inline-flex items-center rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700 whitespace-nowrap">
                            Ready For Dispatch
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" title="View" onClick={() => setViewBatch(b)}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination — same format as the other list pages */}
      {rows.length > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <div className="text-xs text-muted-foreground">
            Showing{" "}
            <strong className="text-foreground tabular-nums">{pageStart + 1}</strong>–
            <strong className="text-foreground tabular-nums">{pageEnd}</strong>{" "}
            of <strong className="text-foreground tabular-nums">{rows.length}</strong>
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
        const row = orderRowForBatch(b.batch);
        const meals = orderMealsForBatch(b.batch);
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

      {/* Order Details — full flight-order meal manifest (opened from the Meals cell) */}
      {orderDetailBatch && (() => {
        const b = orderDetailBatch;
        const row = orderRowForBatch(b.batch);
        const meals = orderMealsForBatch(b.batch);
        const totalQty = meals.reduce((s, r) => s + r.qty, 0);
        const sector = sectorForFlight(row?.flight);
        const allQcDone = meals.length > 0 && meals.every((m) => {
          const mpe = m.productionOrderId ? peById.get(m.productionOrderId) : undefined;
          return mpe ? (!!mpe.qcPassedAt || mpe.status === "Completed") : false;
        });
        return (
          <Dialog open onOpenChange={(o) => { if (!o) setOrderDetailBatch(null); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Order Details — {row?.orderNo ?? b.batch}</DialogTitle>
              </DialogHeader>
              {row ? (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div><span className="text-muted-foreground">Flight:</span><span className="font-semibold ml-1">{row.flight}</span></div>
                    <div><span className="text-muted-foreground">Sector:</span><span className="font-semibold ml-1">{sector ?? "—"}</span></div>
                    <div><span className="text-muted-foreground">Order:</span><span className="font-semibold ml-1">{row.orderNo ?? "—"}</span></div>
                    <div><span className="text-muted-foreground">Dispatch Ref:</span><span className="font-semibold ml-1">{row.dspRef ?? "—"}</span></div>
                    <div><span className="text-muted-foreground">Dep Time:</span><span className="font-semibold ml-1">{row.depTime}</span></div>
                    <div><span className="text-muted-foreground">Date:</span><span className="font-semibold ml-1">{row.date}</span></div>
                  </div>
                  <div className="pt-2 border-t border-border flex gap-3 flex-wrap items-center">
                    <div className="inline-flex items-center gap-1"><span className="text-muted-foreground">Packaging:</span><StatusBadge status={b.status} /></div>
                    <div className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground">QC:</span>
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", allQcDone ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>{allQcDone ? "QC Done" : "Pending"}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Meals ({meals.length})</div>
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
                        {meals.map((r) => (
                          <tr key={r.id} className="border-t border-slate-100">
                            <td className="p-2 font-mono text-primary">{r.productionOrderId ?? "—"}</td>
                            <td className="p-2">{r.mealName}</td>
                            <td className="p-2"><span className={cn("px-2 py-0.5 rounded-full text-[11px] font-semibold", MEAL_TYPE_BADGE[r.mealType] ?? "bg-muted text-foreground")}>{r.mealType}</span></td>
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
              ) : (
                <div className="text-sm text-muted-foreground py-8 text-center">No linked flight order found for this batch (production {b.batch}).</div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setOrderDetailBatch(null)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

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
                {packagingLabels.map((b) => {
                  const code = labelCode(b);
                  return (
                    <div key={b.id} className="rounded-lg border-2 border-dashed border-border bg-card p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          USBA Catering · Meal Label
                        </span>
                        <span className="text-[10px] font-bold text-amber-600">READY TO PRINT</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-sm">{b.item}</span>
                        <span className="text-xs tabular-nums text-muted-foreground shrink-0">Qty {b.qty > 0 ? b.qty : "—"}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>Batch <b className="text-foreground font-mono">{b.batch}</b></span>
                        <span>Std <b className="text-foreground">{b.standardTemp}</b></span>
                        <span>Meas <b className="text-foreground">{b.measuredTemp}°C</b></span>
                        <span>{b.date}</span>
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
                            onClick={() => printOne(b)}
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
