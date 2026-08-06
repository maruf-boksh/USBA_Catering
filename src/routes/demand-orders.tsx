import { useNavigate } from "react-router-dom";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { ReviewStatusCell } from "@/components/common/ReviewStatusCell";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Plus, FileText, Clock, Send, AlertTriangle,
  CheckCircle2, XCircle, ArrowUpRight, PackageCheck, Trash2,
  ShieldCheck, Eye, X, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { inventory } from "@/lib/sample-data";
import { getItemStock } from "@/lib/inventory-stock";
import { roundQty } from "@/lib/num";
import { KpiCard } from "@/components/common/KpiCard";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useWorkflow,
  type WfDemandRequest, type WfDemandItem,
} from "@/lib/workflow-store";
import { useRole } from "@/lib/roles";
import { LocationPicker, LocationFilter, LocationCell } from "@/components/common/LocationPicker";
import { usePersistedState } from "@/lib/use-persisted-state";
import {
  FULFILL_PLAN_KEY, PROCUREMENT_METHODS, allocationFor, allocationTotal,
  stageDirectReceive, stageRequisition, type FulfillmentPlan,
} from "@/lib/fulfillment-plan";

const KITCHEN_SECTIONS = ["Hot Kitchen", "Cold Kitchen", "Veg Section", "Special Meal", "Bakery", "Packaging"];

/**
 * The demand's source reference(s).
 *
 * A demand raised off a bulk production run carries one production-order id per
 * order it covers, comma-joined — a 53-order run printed 53 ids as a paragraph
 * that buried the requester, the date and every item below it. The count is what
 * a reader actually needs ("this covers 53 runs"); the ids matter only when
 * someone is chasing a specific one, so they stay one click away rather than
 * always on screen.
 *
 * A single reference ("DR-9002", "BS-203 Menu Plan") renders exactly as before.
 */
function DemandReference({ reference }: { reference: string }) {
  const [open, setOpen] = useState(false);
  const refs = (reference ?? "").split(",").map((r) => r.trim()).filter(Boolean);

  if (refs.length <= 1) {
    return <strong className="text-foreground">{reference || "—"}</strong>;
  }
  return (
    <>
      <strong className="text-foreground font-mono">{refs[0]}</strong>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="ml-1.5 inline-flex items-center gap-0.5 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors align-middle"
      >
        {open ? "Hide" : `+${refs.length - 1} more`}
        <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-1.5 max-h-32 overflow-y-auto rounded-md border border-border bg-background p-2">
          <div className="flex flex-wrap gap-1">
            {refs.map((r) => (
              <span key={r} className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                {r}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const REQUESTERS = [
  "S. Ahmed",
  "M. Hossain",
  "F. Begum",
  "A. Khan",
  "N. Hasan",
  "M. Karim",
  "R. Islam",
  "T. Rahman",
];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function DemandOrders() {
  const { role } = useRole();
  const wf = useWorkflow();
  const {
    demands, addDemands,
  } = wf;
  const navigate = useNavigate();

  const [selectedRequest, setSelectedRequest] = useState<WfDemandRequest | null>(null);
  const [needsPurchase, setNeedsPurchase] = useState<Record<string, boolean>>({});
  // Fulfilment plan (methods + qty per shortfall item) chosen at approval.
  const [fulfillPlan] = usePersistedState<FulfillmentPlan>(FULFILL_PLAN_KEY, {});
  // Which shortfall rows are ticked for a procurement action.
  const [selectedShortfall, setSelectedShortfall] = useState<Set<string>>(new Set());
  const [newOpen, setNewOpen] = useState(false);
  const [newBy, setNewBy] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newOfficeId, setNewOfficeId] = useState("OFF-001");
  const [newWarehouseId, setNewWarehouseId] = useState("WH-003");
  const [newItems, setNewItems] = useState<WfDemandItem[]>([]);
  const [newItemId, setNewItemId] = useState("");
  const [newItemQty, setNewItemQty] = useState("");
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");

  // Always show the freshest copy of the selected request — workflow-store
  // updates (status / TN linkages / approval audit) reach the dialog via this
  // lookup rather than the snapshot held in `selectedRequest`.
  const activeDemand = useMemo(
    () => (selectedRequest ? demands.find((d) => d.id === selectedRequest.id) ?? selectedRequest : null),
    [demands, selectedRequest],
  );

  // Open a demand in the read-only review dialog.
  const openDemand = (row: WfDemandRequest) => {
    setSelectedRequest(row);
    setNeedsPurchase({});
    setSelectedShortfall(new Set());
  };

  const filteredDemands = demands.filter((d) => {
    if (filterOffice && d.officeId !== filterOffice) return false;
    if (filterWarehouse && d.warehouseId !== filterWarehouse) return false;
    return true;
  });

  // Derived counts
  const pendingApproval = useMemo(() => demands.filter(r => r.status === "Pending Approval").length, [demands]);
  const pending = useMemo(() => demands.filter(r => r.status === "Pending Store Review").length, [demands]);
  const escalated = useMemo(() => demands.filter(r => r.status === "Escalated to Supply Chain").length, [demands]);
  const fulfilled = useMemo(() => demands.filter(r => r.status === "Fulfilled").length, [demands]);

  const requestCols: Column<WfDemandRequest>[] = [
    {
      key: "id", header: "Request #",
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <span>{r.id}</span>
          {r.reCook && (
            <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
              Re-Cook
            </span>
          )}
        </div>
      ),
    },
    { key: "requestedBy", header: "Requested By" },
    {
      key: "officeId" as keyof WfDemandRequest, header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    { key: "role", header: "From" },
    { key: "date", header: "Date" },
    {
      key: "status", header: "Status",
      render: (r) => {
        // Collapse the full lifecycle into the three approval-state labels.
        // Granular post-approval states (Pending Store Review, Partially
        // Available, Escalated to Supply Chain, etc.) all show as "Approved"
        // here; the dialog still surfaces the full status for follow-up.
        const label =
          r.status === "Pending Approval" ? "Pending Approval"
          : r.status === "Rejected"      ? "Rejected"
          : "Approved";
        return (
          <ReviewStatusCell category="Demand Request" refId={r.id}>
            <StatusBadge status={label} />
          </ReviewStatusCell>
        );
      },
    },
    { key: "items", header: "Items", render: (r) => r.items.length },
  ];

  // Approval (and rejection) of Pending-Approval demands is centralised on
  // /approval-management. This page is read-only for the approval step — once
  // a demand has been approved there, the store-review actions below kick in.

  // ── Step 2a: Fulfill from Store → route to Item Issue with this demand ─────
  const fulfillFromStore = () => {
    if (!selectedRequest) return;
    navigate("/item-issue");
  };

  // ── New Demand dialog ────────────────────────────────────────────────────────
  const addItemLine = () => {
    const inv = inventory.find(i => i.id === newItemId);
    if (!inv) { toast.error("Select an item."); return; }
    if (newItems.some(i => i.id === inv.id)) { toast.error(`${inv.name} is already added.`); return; }
    const qty = Number(newItemQty);
    if (!qty || qty <= 0) { toast.error("Quantity must be greater than zero."); return; }
    setNewItems(prev => [
      ...prev,
      { id: inv.id, name: inv.name, qty, uom: inv.uom },
    ]);
    setNewItemId("");
    setNewItemQty("");
  };

  const removeItemLine = (id: string) => {
    setNewItems(prev => prev.filter(i => i.id !== id));
  };

  const resetNewDemand = () => {
    setNewBy(""); setNewNote("");
    setNewItems([]); setNewItemId(""); setNewItemQty("");
  };

  const handleNewDemand = () => {
    if (!newBy.trim()) { toast.error("Requested By is required."); return; }
    if (!newOfficeId) { toast.error("Office is required."); return; }
    if (!newWarehouseId) { toast.error("Warehouse is required."); return; }
    if (newItems.length === 0) { toast.error("Add at least one item line."); return; }
    const ref = `REQ-${String(Date.now()).slice(-5)}`;
    const req: WfDemandRequest = {
      id: `DR-${9000 + demands.length + 1}`,
      reference: ref,
      requestedBy: newBy.trim(),
      role: "Store Executive",
      date: new Date().toLocaleString(),
      status: "Pending Approval",
      items: newItems,
      note: newNote.trim() || "Internal item requisition raised from store.",
      source: "Store",
      officeId: newOfficeId,
      warehouseId: newWarehouseId,
    };
    addDemands([req]);
    setNewOpen(false);
    resetNewDemand();
    toast.success(`Demand request ${req.id} created with ${newItems.length} item${newItems.length > 1 ? "s" : ""}.`);
  };

  return (
    <>
      <PageHeader
        title="Demand Requests"
        subtitle="Review incoming material demands from kitchen and production; fulfill or escalate to Supply Chain"
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Demand
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Total Requests" value={demands.length} icon={FileText} tone="navy" />
        <KpiCard label="Pending Approval" value={pendingApproval} icon={ShieldCheck} tone="warning" />
        <KpiCard label="Pending Review" value={pending} icon={Clock} tone="warning" />
        <KpiCard label="Escalated to Supply Chain" value={escalated} icon={ArrowUpRight} tone="red" />
        <KpiCard label="Fulfilled" value={fulfilled} icon={PackageCheck} tone="success" />
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>Demand Requests — Store Review</CardTitle></CardHeader>
        <CardContent>
          <div className="mb-4">
            <LocationFilter
              officeId={filterOffice}
              warehouseId={filterWarehouse}
              onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
            />
          </div>
          <DataTable
            title="demand-requests"
            data={filteredDemands}
            columns={requestCols}
            searchKeys={["id", "reference", "requestedBy", "role", "status"]}
            selectable={false}
            actions={(row) => (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => openDemand(row)}
                disabled={row.status === "Fulfilled" || row.status === "Rejected"}
                aria-label={`${row.status === "Pending Approval" ? "View" : "Review"} ${row.id}`}
                title={row.status === "Pending Approval" ? "View" : "Review"}
              >
                <Eye className="h-4 w-4" />
              </Button>
            )}
          />

          {/* Review Dialog — opens when a demand is selected */}
          <Dialog
            open={!!activeDemand}
            onOpenChange={(open) => {
              if (!open) { setSelectedRequest(null); setNeedsPurchase({}); setSelectedShortfall(new Set()); }
            }}
          >
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
              <DialogHeader className="px-5 py-4 border-b border-border">
                <DialogTitle className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    Demand Request — {activeDemand?.id}
                    {activeDemand?.reCook && (
                      <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                        Re-Cook
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => { setSelectedRequest(null); setNeedsPurchase({}); setSelectedShortfall(new Set()); }}
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </DialogTitle>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {activeDemand && (
                <>
                  {/* Metadata */}
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs space-y-1">
                    {/* Who and when stay on their own line: they used to trail a
                        reference list long enough to push them out of sight. */}
                    <div className="text-muted-foreground">
                      Ref: <DemandReference reference={activeDemand.reference} />
                    </div>
                    <div className="text-muted-foreground">
                      By <strong className="text-foreground">{activeDemand.requestedBy}</strong> ({activeDemand.role})
                      {" · "}{activeDemand.date}
                    </div>
                    {activeDemand.autoFulfill && (
                      <div className="flex items-center gap-1.5 text-primary font-medium">
                        <ShieldCheck className="h-3 w-3" />
                        Auto-fulfill on approval — Issue (in-stock) + PR (shortfalls) will be created automatically.
                      </div>
                    )}
                    {activeDemand.approvedBy && (
                      <div className="flex items-center gap-1.5 text-success">
                        <CheckCircle2 className="h-3 w-3" />
                        Approved by <strong>{activeDemand.approvedBy}</strong> · {activeDemand.approvedAt}
                      </div>
                    )}
                    {activeDemand.rejectedBy && (
                      <div className="flex items-center gap-1.5 text-destructive">
                        <XCircle className="h-3 w-3" />
                        Rejected by <strong>{activeDemand.rejectedBy}</strong> · {activeDemand.rejectedAt}
                        {activeDemand.rejectionReason && <span> — {activeDemand.rejectionReason}</span>}
                      </div>
                    )}
                  </div>

                  {/* Item analysis — read-only split view */}
                  <div>
                    {activeDemand.items.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-3">No items attached to this request.</p>
                    ) : (() => {
                      const taggedItems = activeDemand.items.map((item) => {
                        // Actual on-hand stock summed across every warehouse the
                        // item is held in (not just its primary warehouse).
                        const currentStock = getItemStock(item.id || item.name);
                        // roundQty clears binary FP artefacts (e.g. 12.0999999…).
                        const shortfall = roundQty(item.qty - currentStock);
                        return { ...item, currentStock, shortfall, insufficient: shortfall > 0 };
                      });
                      const sufficientItems = taggedItems.filter((it) => !it.insufficient);
                      const shortfallItems  = taggedItems.filter((it) => it.insufficient);
                      return (
                        <>
                          {sufficientItems.length > 0 && (
                            <div className="mb-4">
                              <div className="flex items-center gap-1.5 mb-2">
                                <CheckCircle2 className="h-3 w-3 text-green-600" />
                                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                                  Sufficient Items ({sufficientItems.length})
                                </span>
                              </div>
                              <div className="grid grid-cols-[1fr_80px_80px_80px] gap-2 px-3 mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                                <div>Item</div>
                                <div className="text-center">In Stock</div>
                                <div className="text-center">Required</div>
                                <div className="text-center">Status</div>
                              </div>
                              <div className="space-y-2">
                                {sufficientItems.map((item) => (
                                  <div key={item.id} className="rounded-lg border border-green-200 bg-green-50/50 p-3">
                                    <div className="grid grid-cols-[1fr_80px_80px_80px] gap-2 items-center">
                                      <div>
                                        <div className="font-semibold text-sm">{item.name}</div>
                                      </div>
                                      <div className="text-center">
                                        <span className="text-sm font-semibold text-green-700">{item.currentStock}</span>
                                        <div className="text-[10px] text-muted-foreground">{item.uom}</div>
                                      </div>
                                      <div className="text-center">
                                        <span className="text-sm font-semibold">{item.qty}</span>
                                        <div className="text-[10px] text-muted-foreground">{item.uom}</div>
                                      </div>
                                      <div className="text-center">
                                        <span className="text-sm font-bold text-green-600">OK</span>
                                        <div className="text-[10px] text-green-600">sufficient</div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {shortfallItems.length > 0 && (() => {
                            const cols =
                              "grid grid-cols-[28px_84px_minmax(90px,1fr)_40px_64px_64px_60px_minmax(120px,1fr)] gap-2 px-3 items-center";
                            const savedPlan = fulfillPlan[activeDemand.id] ?? {};
                            const canProcure = activeDemand.status !== "Pending Approval" && activeDemand.status !== "Rejected";
                            // Only items with an approved allocation are actionable / selectable.
                            const plannedIds = shortfallItems
                              .filter((it) => allocationTotal(savedPlan[it.id]?.allocations) > 0)
                              .map((it) => it.id);
                            const hasPlan = plannedIds.length > 0;
                            const allSelected = plannedIds.length > 0 && plannedIds.every((id) => selectedShortfall.has(id));
                            const toggleAll = (on: boolean) => setSelectedShortfall(on ? new Set(plannedIds) : new Set());
                            const toggleRow = (id: string, on: boolean) =>
                              setSelectedShortfall((prev) => {
                                const next = new Set(prev);
                                if (on) next.add(id); else next.delete(id);
                                return next;
                              });
                            // Lines per method for the SELECTED rows, from the approved allocation.
                            const linesFor = (key: string) =>
                              shortfallItems
                                .filter((it) => selectedShortfall.has(it.id))
                                .map((it) => ({ id: it.id, name: it.name, uom: it.uom, qty: allocationFor(savedPlan[it.id], key) }))
                                .filter((l) => l.qty > 0);
                            const directLines = linesFor("direct");
                            const reqLines = linesFor("requisition");
                            const selectedCount = plannedIds.filter((id) => selectedShortfall.has(id)).length;
                            const runDirect = () => {
                              const to = stageDirectReceive(activeDemand, directLines);
                              if (to) { setSelectedRequest(null); setSelectedShortfall(new Set()); navigate(to); }
                            };
                            const runReq = () => {
                              const to = stageRequisition(activeDemand, role, reqLines);
                              if (to) { setSelectedRequest(null); setSelectedShortfall(new Set()); navigate(to); }
                            };
                            return (
                              <div>
                                <div className="flex items-center gap-1.5 mb-2">
                                  <AlertTriangle className="h-3 w-3 text-destructive" />
                                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                                    Shortfall Items ({shortfallItems.length})
                                  </span>
                                </div>
                                <div className="rounded-lg border border-red-200 overflow-x-auto">
                                  <div className="min-w-[640px]">
                                    <div className={`${cols} py-2 bg-red-50 border-b border-red-200 text-[10px] uppercase tracking-wider text-red-700/80 font-medium`}>
                                      <div className="flex items-center justify-center">
                                        {canProcure && (
                                          <Checkbox
                                            checked={allSelected}
                                            disabled={!hasPlan}
                                            onCheckedChange={(v) => toggleAll(v === true)}
                                            aria-label="Select all shortfall items"
                                          />
                                        )}
                                      </div>
                                      <div>Code</div>
                                      <div>Item</div>
                                      <div>UoM</div>
                                      <div className="text-right">Required</div>
                                      <div className="text-right">Stock</div>
                                      <div className="text-right">Short</div>
                                      <div>Method</div>
                                    </div>
                                    {shortfallItems.map((item) => {
                                      const alloc = savedPlan[item.id]?.allocations ?? {};
                                      const active = PROCUREMENT_METHODS.filter((m) => (alloc[m.key] ?? 0) > 0);
                                      const planned = active.length > 0;
                                      const checked = planned && selectedShortfall.has(item.id);
                                      return (
                                      <div
                                        key={item.id}
                                        className={`${cols} py-2 border-b border-red-100 last:border-b-0 bg-red-50/30 ${canProcure && planned && !checked ? "opacity-70" : ""}`}
                                      >
                                        <div className="flex items-center justify-center">
                                          {canProcure && (
                                            <Checkbox
                                              checked={checked}
                                              disabled={!planned}
                                              onCheckedChange={(v) => toggleRow(item.id, v === true)}
                                              aria-label={`Select ${item.name}`}
                                            />
                                          )}
                                        </div>
                                        <div className="text-xs font-mono text-muted-foreground truncate" title={item.id}>{item.id}</div>
                                        <div className="text-sm font-medium truncate" title={item.name}>{item.name}</div>
                                        <div className="text-xs text-muted-foreground">{item.uom}</div>
                                        <div className="text-right text-sm font-semibold tabular-nums">{item.qty}</div>
                                        <div className="text-right text-sm tabular-nums text-muted-foreground">{item.currentStock}</div>
                                        <div className="text-right text-sm font-semibold tabular-nums text-red-600">{item.shortfall}</div>
                                        <div className="flex flex-wrap gap-1">
                                          {planned ? (
                                            active.map((m) => (
                                              <span key={m.key} className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${m.soft} ${m.text}`}>
                                                {m.short} {alloc[m.key]}
                                              </span>
                                            ))
                                          ) : (
                                            <span className="text-[11px] text-muted-foreground">
                                              {canProcure ? "Not set" : "Pending approval"}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      );
                                    })}
                                  </div>
                                </div>

                                {canProcure && hasPlan && (
                                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                                    <span className="mr-auto text-[11px] text-muted-foreground">
                                      {selectedCount === 0
                                        ? "Select items, then run their approved method."
                                        : `${selectedCount} of ${plannedIds.length} item${plannedIds.length === 1 ? "" : "s"} selected.`}
                                    </span>
                                    <Button size="sm" variant="outline" className="h-8" onClick={runDirect} disabled={directLines.length === 0}>
                                      <PackageCheck className="h-3.5 w-3.5 mr-1.5" /> Direct Receive ({directLines.length})
                                    </Button>
                                    <Button size="sm" className="h-8" onClick={runReq} disabled={reqLines.length === 0}>
                                      <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Requisition ({reqLines.length})
                                    </Button>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </>
                      );
                    })()}
                  </div>

                </>
              )}
              </div>

              {/* Action footer */}
              {activeDemand && (
                <DialogFooter className="px-5 py-3 border-t border-border bg-muted/20 flex-wrap gap-2">
                  {activeDemand.status === "Pending Approval" ? (
                    <div className="flex items-center gap-2 text-xs text-amber-700 font-medium">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Awaiting approval
                    </div>
                  ) : activeDemand.status === "Pending Store Review" || activeDemand.status === "Partially Available" ? (
                    <div className="flex items-center gap-2 text-xs text-green-700 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approved
                    </div>
                  ) : activeDemand.status === "Partially Issued" ? (
                    <div className="flex items-center gap-2 text-xs text-amber-700 font-medium">
                      <PackageCheck className="h-3.5 w-3.5" />
                      Partially issued — some items still pending
                    </div>
                  ) : activeDemand.status === "Partially Fulfilled" ? (
                    <div className="flex items-center gap-2 text-xs text-blue-700 font-medium">
                      <PackageCheck className="h-3.5 w-3.5" />
                      Items issued; remaining escalated to supply chain
                    </div>
                  ) : activeDemand.status === "Escalated to Supply Chain" ? (
                    <div className="flex items-center gap-2 text-xs text-amber-700 font-medium">
                      <Send className="h-3.5 w-3.5" />
                      Escalated — Requisition awaiting PO and GRN
                    </div>
                  ) : activeDemand.status === "Fulfilled" ? (
                    <div className="flex items-center gap-2 text-xs text-green-700 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Fulfilled — all items issued
                    </div>
                  ) : activeDemand.status === "Rejected" ? (
                    <div className="flex items-center gap-2 text-xs text-destructive font-medium">
                      <XCircle className="h-3.5 w-3.5" /> Rejected — no further action
                    </div>
                  ) : null}
                </DialogFooter>
              )}
            </DialogContent>
          </Dialog>

        </CardContent>
      </Card>

      {/* New Demand Dialog */}
      <Dialog
        open={newOpen}
        onOpenChange={(open) => { setNewOpen(open); if (!open) resetNewDemand(); }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New Demand Request</DialogTitle></DialogHeader>

          <div className="grid gap-5">
            <div>
              <Label>Requested By <span className="text-destructive">*</span></Label>
              <select
                value={newBy}
                onChange={(e) => setNewBy(e.target.value)}
                className={selectCls}
              >
                <option value="">Select requester…</option>
                {REQUESTERS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <LocationPicker
                officeId={newOfficeId}
                warehouseId={newWarehouseId}
                onChange={(n) => { setNewOfficeId(n.officeId); setNewWarehouseId(n.warehouseId); }}
              />
            </div>

            <div>
              <Label>Note</Label>
              <Textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={2}
                placeholder="Why is this needed?"
                className="mt-1"
              />
            </div>

            <div>
              <Label className="mb-1.5 block">Items <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-7">
                  <select
                    value={newItemId}
                    onChange={(e) => setNewItemId(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select item...</option>
                    {inventory.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.id} — {i.name} ({i.uom})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <Input
                    type="number"
                    min={0}
                    value={newItemQty}
                    onChange={(e) => setNewItemQty(e.target.value)}
                    placeholder="Qty"
                  />
                </div>
                <div className="col-span-2">
                  <Button variant="outline" onClick={addItemLine} className="w-full">
                    <Plus className="h-4 w-4 mr-1" /> Add
                  </Button>
                </div>
              </div>

              <div className="mt-3 border border-border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider w-10">SL</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider">Item</th>
                      <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider w-24">Qty</th>
                      <th className="px-3 py-2 w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {newItems.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center text-xs text-muted-foreground py-5">
                          No items added yet.
                        </td>
                      </tr>
                    ) : (
                      newItems.map((it, i) => (
                        <tr key={it.id} className="border-t border-border">
                          <td className="px-3 py-2">{i + 1}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{it.name}</div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {it.qty} <span className="text-[11px] text-muted-foreground">{it.uom}</span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => removeItemLine(it.id)}
                              aria-label={`Remove ${it.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewOpen(false); resetNewDemand(); }}>
              Cancel
            </Button>
            <Button onClick={handleNewDemand}>Create Demand</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
