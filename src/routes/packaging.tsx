import { useEffect, useMemo, useState } from "react";
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
import { useWorkflow } from "@/lib/workflow-store";
import { cn } from "@/lib/utils";
import {
  mergePassedBatches,
  type PackagingBatch,
  type PackagingBatchStatus,
} from "@/lib/packaging-batches";

const labelCode = (b: PackagingBatch) => `LBL-${b.batch}`;

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

  const [viewBatch, setViewBatch] = useState<PackagingBatch | null>(null);
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
              <TableHead className="text-xs uppercase tracking-wider">Order</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Meals</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">
                  No packaging batches yet. Batches appear here once they pass both temperature and taste QC.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((b) => {
                return (
                  <TableRow key={b.id} className={cn("hover:bg-muted/30", selectedIds.has(b.id) && "bg-primary/5")}>
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
                    {/* Order (production order) — clickable tag → Order Management */}
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => navigate("/order-management")}
                        className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary hover:bg-primary/10 focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors"
                        title="Open in Order Management"
                      >
                        {b.batch}
                      </button>
                    </TableCell>
                    <TableCell className="font-medium text-sm">{b.item}</TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">{b.date}</TableCell>
                    {/* Meals — clickable → View (item breakdown + QC detail) */}
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setViewBatch(b)}
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline focus:outline-none focus:underline"
                        title="View meal & QC detail"
                      >
                        <Eye className="h-3.5 w-3.5" /> 1 item · {b.qty > 0 ? b.qty : "—"}
                      </button>
                    </TableCell>
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
                      <button
                        type="button"
                        title="View"
                        onClick={() => setViewBatch(b)}
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* View — full batch detail */}
      {viewBatch && (
        <Dialog open onOpenChange={(o) => { if (!o) setViewBatch(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Packaging Batch — {viewBatch.batch}</DialogTitle>
              <DialogDescription>Passed temperature &amp; taste QC. Full trace below.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Batch" value={viewBatch.batch} mono />
                <Field label="Item" value={viewBatch.item} />
                <Field label="Qty" value={viewBatch.qty > 0 ? String(viewBatch.qty) : "—"} />
                <Field label="Date" value={viewBatch.date} />
                <Field label="Standard Temp" value={viewBatch.standardTemp} />
                <Field label="Threshold Temp" value={viewBatch.thresholdTemp != null ? `≤${viewBatch.thresholdTemp}°C` : "—"} />
                <div>
                  <FieldLabel>Measured Temp</FieldLabel>
                  <div className="text-green-600 font-semibold">{viewBatch.measuredTemp}°C</div>
                </div>
                <Field label="Taste" value={viewBatch.taste || "—"} />
                <div>
                  <FieldLabel>Status</FieldLabel>
                  <div className="inline-flex items-center gap-1.5 flex-wrap">
                    <StatusBadge status={viewBatch.status} />
                    {viewBatch.status === "Packaging Done" && (
                      <span className="inline-flex items-center rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700">
                        Ready To Dispatch
                      </span>
                    )}
                  </div>
                </div>
                <Field label="Cooked By" value={viewBatch.cookedBy} />
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <FieldLabel>QC Checked By</FieldLabel>
                <div className="text-sm">{viewBatch.checkedBy}</div>
              </div>
              {(viewBatch.approvedBy || viewBatch.approvedAt) && (
                <div className="rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2">
                  <FieldLabel>Packaging Approved By</FieldLabel>
                  <div className="text-sm">{viewBatch.approvedBy}{viewBatch.approvedAt ? ` · ${viewBatch.approvedAt}` : ""}</div>
                </div>
              )}
              {viewBatch.packagedAt && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2">
                  <FieldLabel>Packaged At</FieldLabel>
                  <div className="text-sm">{viewBatch.packagedAt}{viewBatch.dispatchId ? ` · ${viewBatch.dispatchId}` : ""}</div>
                </div>
              )}
              {/* Full trail — QC → Packaging Approval → Packaged → Ready for Dispatch */}
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
                <FieldLabel>Trail</FieldLabel>
                <ol className="mt-1 space-y-1.5">
                  {[
                    { done: true, label: "Passed temperature & taste QC", at: viewBatch.checkedBy },
                    { done: !!viewBatch.approvedBy, label: "Packaging approved", at: viewBatch.approvedBy ? `${viewBatch.approvedBy}${viewBatch.approvedAt ? " · " + viewBatch.approvedAt : ""}` : "Pending approval" },
                    { done: !!viewBatch.packagedAt, label: "Packaged (labels scanned)", at: viewBatch.packagedAt || "—" },
                    { done: viewBatch.status === "Packaging Done" || viewBatch.status === "Dispatched", label: viewBatch.status === "Dispatched" ? "Forwarded to airport" : "Ready to dispatch", at: viewBatch.dispatchedAt || viewBatch.dispatchId || "—" },
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
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewBatch(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

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
                      <div className="flex gap-2 mt-1">
                        <Button
                          variant="outline" size="sm" className="h-7 px-2 text-xs flex-1"
                          onClick={() => printOne(b)}
                        >
                          <Printer className="h-3 w-3 mr-1" /> Print
                        </Button>
                      </div>
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
