import { useNavigate, useSearchParams } from "react-router-dom";
import { useState, useMemo, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Plus, PackageCheck, Clock, CheckCircle2, Send, Search, Trash2, ChevronDown, Eye, AlertTriangle, Save, ArrowLeft,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { toast } from "sonner";
import { inventory, allocateFefo, type FefoAllocation } from "@/lib/sample-data";
import { getItemAvailableByWarehouse, getItemStock, getItemBlocked } from "@/lib/inventory-stock";
import { roundQty } from "@/lib/num";
import { applyInventoryStock } from "@/lib/stock-adjustments";
import { logAudit } from "@/lib/audit-log";
import { useWorkflow, type WfTransferNote, type WfDemandRequest } from "@/lib/workflow-store";
import { useRole } from "@/lib/roles";
import { getAuthUser } from "@/lib/auth";
import { getActiveStaff } from "@/lib/staff";
import { LocationPicker, LocationFilter, LocationCell, officeName, warehouseName } from "@/components/common/LocationPicker";
import {
  FULFILL_PLAN_KEY, PROCUREMENT_METHODS, allocationTotal, allocationFor,
  stageDirectReceive, stageRequisition, type FulfillmentPlan,
} from "@/lib/fulfillment-plan";

type IssueItem = {
  id: string;
  name: string;
  qty: number;
  uom: string;
  fefoAllocations?: FefoAllocation[];
  fefoCost?: number;
};

export default function ItemIssuePage() {
  const { transferNotes, addTransferNote, acknowledgeTransfer, demands, updateDemandStatus } = useWorkflow();
  const { role } = useRole();
  // "Issued By" should reflect the actual logged-in person, not just their role.
  const issuerName = getAuthUser()?.name ?? role;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const demandParam = searchParams.get("demand") ?? undefined;

  const [selected, setSelected] = useState<WfTransferNote | null>(null);
  // Demand whose stock-vs-required breakdown is being viewed (read-only).
  const [viewDemand, setViewDemand] = useState<WfDemandRequest | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [preselectedDemand, setPreselectedDemand] = useState("");
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  // Saved fulfilment methods (persisted) — assigned when the demand is approved
  // (Approval Management → demand detail), read here to run Direct Receive /
  // Create Requisition from the demand's View dialog.
  const [plan] = usePersistedState<FulfillmentPlan>(FULFILL_PLAN_KEY, {});

  // Auto-open the create dialog when arriving with ?demand=<id>
  const consumedParam = useRef(false);
  useEffect(() => {
    if (demandParam && !consumedParam.current) {
      consumedParam.current = true;
      setPreselectedDemand(demandParam);
      setCreateOpen(true);
      navigate("/item-issue", { replace: true });
    }
  }, [demandParam, navigate]);

  const pendingDemands = useMemo(
    () =>
      demands.filter(
        (d) =>
          d.status === "Pending Store Review" ||
          d.status === "Partially Available" ||
          d.status === "Partially Issued",
      ),
    [demands],
  );

  const openIssueForDemand = (id: string) => {
    setPreselectedDemand(id);
    setCreateOpen(true);
  };

  const openIssueDirect = () => {
    setPreselectedDemand("");
    setCreateOpen(true);
  };

  const totalCount = transferNotes.length;
  const pendingCount = pendingDemands.length;
  const ackCount = transferNotes.filter((t) => t.status === "Issued").length;

  const cols: Column<WfTransferNote>[] = [
    {
      key: "demandRef", header: "Demand Ref",
      render: (t) => {
        const linked = demands.find((d) => d.id === t.demandRef);
        if (!linked) return <span className="text-muted-foreground">{t.demandRef}</span>;
        return (
          <div className="flex flex-col">
            <span className="font-medium">{linked.id}</span>
            <span className="text-[10px] text-muted-foreground">{linked.status}</span>
          </div>
        );
      },
    },
    {
      key: "from", header: "From (Office / Warehouse)",
      render: (t) => <LocationCell officeId={t.officeId} warehouseId={t.warehouseId} />,
    },
    { key: "to",   header: "To" },
    {
      key: "items", header: "Items", className: "text-right",
      render: (t) => <span>{t.items.length}</span>,
    },
    { key: "issuedBy", header: "Issued By" },
    { key: "date",     header: "Date" },
    { key: "status",   header: "Status", render: (t) => <StatusBadge status={t.status} /> },
  ];

  const filteredIssued = transferNotes.filter((t) => {
    if (filterOffice && t.officeId !== filterOffice) return false;
    if (filterWarehouse && t.warehouseId !== filterWarehouse) return false;
    return true;
  });

  const handleAcknowledge = (id: string) => {
    acknowledgeTransfer(id);
    setSelected(prev => prev && prev.id === id ? { ...prev, status: "Issued" } : prev);
    toast.success(`${id} marked as Issued.`);
  };

  const handleIssue = (data: {
    issuedTo: string;
    issuedBy: string;
    demandRef: string;
    officeId: string;
    warehouseId: string;
    items: IssueItem[];
  }) => {
    const tn: WfTransferNote = {
      id: `TN-${Date.now().toString().slice(-5)}`,
      demandRef: data.demandRef.trim() || "Direct Issue",
      grnRef: "Direct from Store",
      items: data.items,
      from: "Store",
      to: data.issuedTo.trim(),
      issuedBy: data.issuedBy.trim(),
      date: new Date().toLocaleString(),
      status: "Issued",
      officeId: data.officeId,
      warehouseId: data.warehouseId,
    };
    addTransferNote(tn);

    // Issuing consumes stock from the store — deduct each line from the Stock
    // Overview on-hand balance (matched by item code).
    for (const it of data.items) applyInventoryStock(it.id, -it.qty);
    logAudit({
      action: "Items issued",
      module: "Inventory",
      entity: tn.id,
      detail: `${data.items.length} item(s) issued to ${data.issuedTo.trim()}${data.demandRef ? ` · demand ${data.demandRef}` : ""}`,
      actor: data.issuedBy.trim(),
    });

    // Connect to the demand: move it forward in its workflow
    let demandUpdate = "";
    const linkedDemand = data.demandRef
      ? demands.find((d) => d.id === data.demandRef)
      : null;
    if (linkedDemand) {
      const fullyCovered = linkedDemand.items.every((reqItem) => {
        const issued = data.items.find((i) => i.id === reqItem.id);
        return !!issued && issued.qty >= reqItem.qty;
      });
      const anyPartial = linkedDemand.items.some((reqItem) => {
        const issued = data.items.find((i) => i.id === reqItem.id);
        return !!issued && issued.qty > 0 && issued.qty < reqItem.qty;
      });
      const someMissing = linkedDemand.items.some(
        (reqItem) => !data.items.find((i) => i.id === reqItem.id && i.qty >= reqItem.qty),
      );

      if (fullyCovered) {
        updateDemandStatus(linkedDemand.id, "Fulfilled");
        demandUpdate = ` · ${linkedDemand.id} marked Fulfilled`;
      } else if (anyPartial) {
        updateDemandStatus(linkedDemand.id, "Partially Issued");
        demandUpdate = ` · ${linkedDemand.id} marked Partially Issued`;
      } else if (someMissing) {
        updateDemandStatus(linkedDemand.id, "Partially Fulfilled");
        demandUpdate = ` · ${linkedDemand.id} marked Partially Fulfilled`;
      }
    }

    setCreateOpen(false);
    toast.success(
      `Item Issue ${tn.id} created — ${data.items.length} item${data.items.length > 1 ? "s" : ""} to ${data.issuedTo.trim()}${demandUpdate}.`,
    );
  };

  return (
    <>
      <PageHeader
        title="Item Issue"
        subtitle="Issue items from store to kitchen sections and track acknowledgment"
        actions={
          <Button onClick={openIssueDirect}>
            <Plus className="h-4 w-4 mr-1" /> New Issue
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Total Issues"    value={totalCount}   icon={PackageCheck} tone="navy"    />
        <KpiCard label="Pending Demands" value={pendingCount} icon={Clock}        tone="warning" />
        <KpiCard label="Issued"          value={ackCount}     icon={CheckCircle2} tone="success" />
      </div>

      <Tabs defaultValue={pendingDemands.length > 0 ? "pending" : "issued"} className="space-y-4">
        <TabsList className="h-auto bg-transparent p-0 border-b border-border w-full justify-start rounded-none">
          <TabsTrigger
            value="pending"
            className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 pb-3 gap-2"
          >
            Pending Demands
            {pendingDemands.length > 0 && (
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-[10px] tabular-nums border-warning/40 bg-warning/10 text-warning"
              >
                {pendingDemands.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="issued"
            className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 pb-3 gap-2"
          >
            Issued Items
            {transferNotes.length > 0 && (
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-[10px] tabular-nums border-border bg-muted/40 text-muted-foreground"
              >
                {transferNotes.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-0">
          {pendingDemands.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <PackageCheck className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                <div className="text-sm font-medium text-foreground">No pending demands</div>
                <div className="text-xs text-muted-foreground mt-1">
                  All demand requests have been fully issued.
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Pending Demands{" "}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({pendingDemands.length} awaiting issuance)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="border border-border rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider">Demand #</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider">Date</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider">Requested By</th>
                        <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider">Items</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider">Status</th>
                        <th className="px-3 py-2 w-32" />
                      </tr>
                    </thead>
                    <tbody>
                      {pendingDemands.map((d) => (
                        <tr key={d.id} className="border-t border-border hover:bg-muted/20">
                          <td className="px-3 py-2 font-medium font-mono text-xs">{d.id}</td>
                          <td className="px-3 py-2">{d.date}</td>
                          <td className="px-3 py-2">{d.requestedBy}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{d.items.length}</td>
                          <td className="px-3 py-2">
                            {/* From the store's view these demands are already approved and
                                awaiting issuance — surface "Approved" rather than the internal
                                "Pending Store Review" workflow state. */}
                            <StatusBadge status={d.status === "Pending Store Review" ? "Approved" : d.status} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                onClick={() => openIssueForDemand(d.id)}
                                className="h-7 px-3 text-xs"
                              >
                                <Send className="h-3 w-3 mr-1" /> Issue Items
                              </Button>
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-7 w-7"
                                onClick={() => setViewDemand(d)}
                                aria-label={`View ${d.id}`}
                                title="View stock vs required"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="issued" className="mt-0">
          <div className="mb-4">
            <LocationFilter
              officeId={filterOffice}
              warehouseId={filterWarehouse}
              onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
            />
          </div>
          <DataTable
            title="item-issue"
            data={filteredIssued}
            columns={cols}
            searchKeys={["id", "demandRef", "to", "issuedBy", "status"]}
            selectable={false}
            actions={(t) => (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs"
                onClick={() => setSelected(t)}
              >
                View
              </Button>
            )}
          />
        </TabsContent>
      </Tabs>

      <IssueDetailsDialog
        note={selected}
        onClose={() => setSelected(null)}
        onAcknowledge={handleAcknowledge}
      />

      <CreateIssueDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultIssuedBy={issuerName}
        defaultDemandId={preselectedDemand}
        lockDemand={!!preselectedDemand}
        demands={demands}
        onCreate={handleIssue}
      />

      <DemandViewDialog demand={viewDemand} onClose={() => setViewDemand(null)} onIssue={openIssueForDemand} plan={plan} />
    </>
  );
}

// Read-only view of a demand: sufficient / shortfall breakdown plus the SAVED
// fulfilment plan, from where Direct Receive / Create Requisition are run. Methods
// themselves are assigned + saved on the Fulfillment Method tab.
function DemandViewDialog({
  demand, onClose, onIssue, plan,
}: {
  demand: WfDemandRequest | null;
  onClose: () => void;
  onIssue: (id: string) => void;
  plan: FulfillmentPlan;
}) {
  const navigate = useNavigate();
  const { role } = useRole();
  // Which shortfall rows are checked for procurement actions (defaults to all planned).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const tagged = useMemo(() => {
    if (!demand) return [];
    return demand.items.map((item) => {
      const currentStock = getItemStock(item.id || item.name);
      const shortfall = roundQty(item.qty - currentStock);
      return { ...item, currentStock, shortfall, insufficient: shortfall > 0 };
    });
  }, [demand]);

  // Planned = shortfall rows that have a saved method + qty (only these are actionable).
  const plannedIds = useMemo(() => {
    if (!demand) return [] as string[];
    const s = plan[demand.id] ?? {};
    return tagged
      .filter((it) => it.insufficient && allocationTotal(s[it.id]?.allocations) > 0)
      .map((it) => it.id);
  }, [demand, tagged, plan]);

  // Start with nothing checked whenever the demand (or its saved plan) changes.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [demand?.id, plannedIds]);

  if (!demand) return null;

  const demandId = demand.id;
  const saved = plan[demandId] ?? {};
  const sufficientItems = tagged.filter((it) => !it.insufficient);
  // Shortfall rows carry their SAVED method allocation, chosen at approval — the
  // procure qty split across procurement methods (Direct Receive / Requisition).
  const shortfallItems = tagged
    .filter((it) => it.insufficient)
    .map((it) => {
      const line = saved[it.id];
      const alloc = line?.allocations ?? {};
      const directQty = allocationFor(line, "direct");
      const reqQty = allocationFor(line, "requisition");
      return { ...it, alloc, planQty: allocationTotal(alloc), directQty, reqQty };
    });
  const canProcure = demand.status !== "Pending Approval" && demand.status !== "Rejected";

  // Actions run only on checked rows that carry a qty for that channel.
  const directPicks = shortfallItems.filter((it) => it.directQty > 0 && selectedIds.has(it.id));
  const reqPicks = shortfallItems.filter((it) => it.reqQty > 0 && selectedIds.has(it.id));
  const drCount = directPicks.length;
  const reqCount = reqPicks.length;
  const plannedCount = shortfallItems.filter((it) => it.method && it.planQty > 0).length;
  const selectedCount = shortfallItems.filter((it) => it.method && it.planQty > 0 && selectedIds.has(it.id)).length;
  const allPlannedSelected = plannedCount > 0 && selectedCount === plannedCount;

  const toggleRow = (id: string, on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  const toggleAll = (on: boolean) => setSelectedIds(on ? new Set(plannedIds) : new Set());

  // Hand the saved lines for each channel to the prefilled screen, using the
  // per-channel qty (the allocated portion for each method).
  const runRequisition = () => {
    const to = stageRequisition(demand, role, reqPicks.map((it) => ({ id: it.id, name: it.name, uom: it.uom, qty: it.reqQty })));
    if (!to) return;
    onClose();
    navigate(to);
  };
  const runDirect = () => {
    const to = stageDirectReceive(demand, directPicks.map((it) => ({ id: it.id, name: it.name, uom: it.uom, qty: it.directQty })));
    if (!to) return;
    onClose();
    navigate(to);
  };

  const sufficientTable = sufficientItems.length > 0 ? (
    <div>
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
              <div className="font-semibold text-sm">{item.name}</div>
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
  ) : null;

  return (
    <Dialog open={!!demand} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>Demand Request — {demand.id}</span>
            <StatusBadge status={demand.status === "Pending Store Review" ? "Approved" : demand.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            Ref: <strong className="text-foreground">{demand.reference}</strong>
            {" · "}By <strong className="text-foreground">{demand.requestedBy}</strong> ({demand.role})
            {" · "}{demand.date}
          </div>

          {tagged.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">No items attached to this request.</p>
          ) : (
            <>
              {sufficientTable}
              {shortfallItems.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3 text-destructive" />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Shortfall Items ({shortfallItems.length}) — Fulfilment Plan
                    </span>
                  </div>

                  {/* Read-only view of the saved plan (methods are set on the Fulfillment Method tab) */}
                  <div className="rounded-lg border border-border overflow-x-auto">
                    <div className="min-w-[652px]">
                      <div className="grid grid-cols-[32px_84px_minmax(120px,1fr)_44px_80px_96px_140px] gap-2 px-3 py-2 bg-muted/50 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground font-medium items-center">
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={allPlannedSelected}
                            disabled={plannedCount === 0}
                            onCheckedChange={(v) => toggleAll(v === true)}
                            aria-label="Select all planned items"
                          />
                        </div>
                        <div>Code</div><div>Item</div><div>UoM</div>
                        <div className="text-right">Shortage</div>
                        <div className="text-right">Planned Qty</div>
                        <div>Method</div>
                      </div>
                      {shortfallItems.map((item) => {
                        const methods = PROCUREMENT_METHODS.filter((m) => (item.alloc[m.key] ?? 0) > 0);
                        const planned = item.planQty > 0;
                        const checked = planned && selectedIds.has(item.id);
                        return (
                          <div key={item.id} className={`grid grid-cols-[32px_84px_minmax(120px,1fr)_44px_80px_96px_140px] gap-2 px-3 py-2 border-b border-border last:border-b-0 items-center ${planned && !checked ? "opacity-60" : ""}`}>
                            <div className="flex items-center justify-center">
                              <Checkbox
                                checked={checked}
                                disabled={!planned}
                                onCheckedChange={(v) => toggleRow(item.id, v === true)}
                                aria-label={`Select ${item.name}`}
                              />
                            </div>
                            <div className="text-xs font-mono text-muted-foreground truncate" title={item.id}>{item.id}</div>
                            <div className="text-sm font-medium truncate" title={item.name}>{item.name}</div>
                            <div className="text-xs text-muted-foreground">{item.uom}</div>
                            <div className="text-right text-sm font-semibold tabular-nums text-red-600">{item.shortfall}</div>
                            <div className="text-right text-sm tabular-nums">{item.planQty > 0 ? item.planQty : <span className="text-muted-foreground">—</span>}</div>
                            <div className="flex flex-wrap gap-1">
                              {methods.length > 0 ? (
                                methods.map((m) => (
                                  <span key={m.key} className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${m.soft} ${m.text}`}>
                                    {m.short} {item.alloc[m.key]}
                                  </span>
                                ))
                              ) : (
                                <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">Pending</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <span className="text-[11px] text-muted-foreground">
                      {!canProcure
                        ? "Available after approval."
                        : plannedCount === 0
                          ? "No methods set yet — assign them on the Fulfillment Method tab."
                          : `${selectedCount} of ${plannedCount} planned item${plannedCount === 1 ? "" : "s"} selected.`}
                    </span>
                    {canProcure && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" className="h-8" onClick={runDirect} disabled={drCount === 0}>
                          <PackageCheck className="h-3.5 w-3.5 mr-1.5" /> Direct Receive ({drCount})
                        </Button>
                        <Button size="sm" className="h-8" onClick={runRequisition} disabled={reqCount === 0}>
                          <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Requisition ({reqCount})
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border bg-muted/20 flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => { onClose(); onIssue(demand.id); }}>
            <Send className="h-3.5 w-3.5 mr-1.5" /> Issue Items
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



function IssueDetailsDialog({
  note, onClose, onAcknowledge,
}: {
  note: WfTransferNote | null;
  onClose: () => void;
  onAcknowledge: (id: string) => void;
}) {
  return (
    <Dialog open={!!note} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Item Issue
            {note && <span className="font-mono text-sm text-muted-foreground ml-2">— {note.id}</span>}
          </DialogTitle>
        </DialogHeader>

        {note && (
          <div className="space-y-4 mt-1">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
              <Field
                label="From"
                value={`${officeName(note.officeId)} · ${warehouseName(note.warehouseId)}`}
              />
              <Field label="To"   value={note.to} bold />
              <Field label="Issued By" value={note.issuedBy} />
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</div>
                <div className="mt-1"><StatusBadge status={note.status} /></div>
              </div>
              <Field label="Demand Ref" value={note.demandRef} />
              <Field label="Date"       value={note.date} />
              <Field label="Items"      value={note.items.length.toString()} />
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                Items to Transfer
              </div>
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider w-12">SL</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider">Item</th>
                      <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider w-32">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {note.items.map((it, i) => (
                      <tr key={it.id} className="border-t border-border">
                        <td className="px-3 py-2">{i + 1}</td>
                        <td className="px-3 py-2 font-medium">{it.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {it.qty} <span className="text-[11px] text-muted-foreground">{it.uom}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="mt-4 flex-wrap gap-2">
          {note?.status === "Pending" && (
            <Button onClick={() => onAcknowledge(note.id)}>
              <CheckCircle2 className="h-4 w-4 mr-1.5" /> Mark as Issued
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateIssueDialog({
  open, onOpenChange, defaultIssuedBy, defaultDemandId, lockDemand = false, demands, onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultIssuedBy: string;
  defaultDemandId: string;
  lockDemand?: boolean;
  demands: WfDemandRequest[];
  onCreate: (data: {
    issuedTo: string;
    issuedBy: string;
    demandRef: string;
    officeId: string;
    warehouseId: string;
    items: IssueItem[];
  }) => void;
}) {
  const [issuedTo, setIssuedTo] = useState<string>("");
  const [issuedBy, setIssuedBy] = useState<string>(defaultIssuedBy);
  const [demandId, setDemandId] = useState(defaultDemandId);
  const [officeId, setOfficeId] = useState("OFF-001");
  const [warehouseId, setWarehouseId] = useState("WH-001");
  const [search, setSearch] = useState("");
  const [issuedMap, setIssuedMap] = useState<Record<string, string>>({});

  // Direct-issue add-line state
  const [addItemId, setAddItemId] = useState("");
  const [addItemQty, setAddItemQty] = useState("");
  const [manualIds, setManualIds] = useState<string[]>([]);

  const isDirect = !demandId;

  // Sync demandId with the pre-selection whenever the dialog opens
  useEffect(() => {
    if (open) setDemandId(defaultDemandId);
  }, [open, defaultDemandId]);

  useEffect(() => {
    if (!open) {
      setIssuedTo("");
      setIssuedBy(defaultIssuedBy);
      setDemandId("");
      setSearch("");
      setIssuedMap({});
      setAddItemId("");
      setAddItemQty("");
      setManualIds([]);
    }
  }, [open, defaultIssuedBy]);

  // Active staff are the candidates a direct issue can be handed to. Read when
  // the dialog opens so users created at runtime show up.
  const staff = useMemo(() => getActiveStaff(), [open]);

  // Reset entered amounts when the mode/demand changes. Also drive the
  // recipient: when issuing against a demand it's the person who raised it
  // (auto-loaded, read-only); for a direct issue the user picks from the list.
  useEffect(() => {
    const d = demands.find((x) => x.id === demandId);
    setIssuedTo(d ? d.requestedBy : "");
    setIssuedMap({});
    setManualIds([]);
    setAddItemId("");
    setAddItemQty("");
    setSearch("");
  }, [demandId, demands]);

  const selectedDemand = useMemo(
    () => demands.find((d) => d.id === demandId) ?? null,
    [demands, demandId],
  );

  const requestedFor = (itemId: string): number =>
    selectedDemand?.items.find((i) => i.id === itemId)?.qty ?? 0;

  // Stock issuable for an item in the currently-selected source warehouse.
  // Issuing draws from this warehouse, so the table reflects its holding only —
  // and AVAILABLE rather than on-hand, so quantity held for QC (produced but not
  // signed off, or QC-failed and awaiting disposal) cannot be issued out.
  const availableIn = (itemName: string): number =>
    getItemAvailableByWarehouse(itemName).find((w) => w.warehouseId === warehouseId)?.stock ?? 0;

  /** Quantity held for QC at the selected warehouse — shown so a short issue is explained. */
  const heldIn = (itemName: string): number => {
    if (warehouseId !== "WH-001") return 0; // holds sit on the primary row
    return getItemBlocked(itemName);
  };

  const setIssued = (id: string, value: string) => {
    setIssuedMap((prev) => ({ ...prev, [id]: value }));
  };

  // Rows shown in the table — depends on mode
  const visibleItems = useMemo(() => {
    let pool;
    if (selectedDemand) {
      pool = selectedDemand.items
        .map((it) => inventory.find((inv) => inv.id === it.id))
        .filter((x): x is (typeof inventory)[number] => !!x);
    } else {
      pool = manualIds
        .map((id) => inventory.find((inv) => inv.id === id))
        .filter((x): x is (typeof inventory)[number] => !!x);
    }
    if (!search.trim()) return pool;
    const q = search.toLowerCase();
    return pool.filter((i) => i.id.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
  }, [selectedDemand, manualIds, search]);

  const addManualLine = () => {
    const inv = inventory.find((i) => i.id === addItemId);
    if (!inv) { toast.error("Select an item."); return; }
    if (manualIds.includes(inv.id)) { toast.error(`${inv.name} is already added.`); return; }
    const qty = Number(addItemQty);
    if (!qty || qty <= 0) { toast.error("Quantity must be greater than zero."); return; }
    setManualIds((prev) => [...prev, inv.id]);
    setIssuedMap((prev) => ({ ...prev, [inv.id]: String(qty) }));
    setAddItemId("");
    setAddItemQty("");
  };

  const removeManualLine = (id: string) => {
    setManualIds((prev) => prev.filter((x) => x !== id));
    setIssuedMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const summary = useMemo(() => {
    let issuedItems = 0;
    let totalIssued = 0;
    let totalRemaining = 0;
    const ids = selectedDemand
      ? selectedDemand.items.map((i) => i.id)
      : manualIds;
    for (const id of ids) {
      const req = requestedFor(id);
      const iss = Number(issuedMap[id]) || 0;
      if (iss > 0) issuedItems += 1;
      totalIssued += iss;
      totalRemaining += Math.max(0, req - iss);
    }
    return { issuedItems, totalIssued, totalRemaining };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issuedMap, selectedDemand, manualIds]);

  // Every line whose entered qty exceeds what the selected warehouse holds.
  // Computed across ALL rows so the UI can flag them together (not one-by-one).
  const stockErrors = useMemo(() => {
    const ids = selectedDemand ? selectedDemand.items.map((i) => i.id) : manualIds;
    const errs: { id: string; name: string; avail: number; held: number; uom: string; issued: number }[] = [];
    for (const id of ids) {
      const iss = Number(issuedMap[id] ?? 0);
      if (iss <= 0) continue;
      const invItem = inventory.find((i) => i.id === id);
      const avail = invItem ? availableIn(invItem.name) : 0;
      const held = invItem ? heldIn(invItem.name) : 0;
      if (iss > avail) errs.push({ id, name: invItem?.name ?? id, avail, held, uom: invItem?.uom ?? "", issued: iss });
    }
    return errs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issuedMap, selectedDemand, manualIds, warehouseId]);

  const handleSubmit = () => {
    if (!issuedBy.trim()) { toast.error("Issued By is required."); return; }
    if (!issuedTo.trim()) { toast.error("Issued To (recipient) is required."); return; }
    if (!officeId) { toast.error("Office is required."); return; }
    if (!warehouseId) { toast.error("Warehouse is required."); return; }
    const idsInScope = selectedDemand
      ? selectedDemand.items.map((i) => i.id)
      : manualIds;
    // Can't issue more than what's on hand in the selected source warehouse.
    // Report ALL offending rows at once so the user fixes them in one pass.
    if (stockErrors.length > 0) {
      const first = stockErrors[0];
      toast.error(
        stockErrors.length === 1
          ? `${first.name}: only ${first.avail} ${first.uom} issuable at the selected warehouse — cannot issue ${first.issued}.`
            + (first.held > 0 ? ` A further ${first.held} ${first.uom} is on hand but held for QC.` : "")
          : `${stockErrors.length} items exceed available stock at the selected warehouse — reduce the highlighted quantities.`,
      );
      return;
    }
    const items: IssueItem[] = idsInScope
      .filter((id) => Number(issuedMap[id] ?? 0) > 0)
      .map((id) => {
        const inv = inventory.find((i) => i.id === id)!;
        const qty = Number(issuedMap[id]);
        const fefo = allocateFefo(inv.id, qty);
        return {
          id: inv.id,
          name: inv.name,
          qty,
          uom: inv.uom,
          fefoAllocations: fefo.allocations,
          fefoCost: fefo.totalCost,
        };
      });
    if (items.length === 0) {
      toast.error(isDirect
        ? "Add at least one item, then enter Issued Qty > 0."
        : "Enter Issued Qty > 0 on at least one item.",
      );
      return;
    }
    onCreate({ issuedTo, issuedBy, demandRef: demandId, officeId, warehouseId, items });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>New Item Issue</DialogTitle>
        </DialogHeader>

        <div className="px-6 pt-5 pb-3 space-y-4 border-b border-border bg-muted/20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Issued By <span className="text-destructive">*</span></Label>
              <Input
                value={issuedBy}
                readOnly
                tabIndex={-1}
                aria-readonly
                title="Auto-filled from the logged-in user"
                className="mt-1 bg-muted/60 cursor-not-allowed text-muted-foreground"
              />
            </div>

            <div>
              <Label>Issued To <span className="text-destructive">*</span></Label>
              {isDirect ? (
                <select
                  value={issuedTo}
                  onChange={(e) => setIssuedTo(e.target.value)}
                  className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Select recipient...</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.fullName}>
                      {s.fullName} — {s.role}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={issuedTo}
                  readOnly
                  tabIndex={-1}
                  aria-readonly
                  title="Auto-loaded from the selected demand's requester"
                  className="mt-1 bg-muted/60 cursor-not-allowed text-muted-foreground"
                />
              )}
            </div>

            <div className="md:col-span-2">
              <Label>Demand Reference</Label>
              <select
                value={demandId}
                onChange={(e) => setDemandId(e.target.value)}
                disabled={lockDemand}
                title={lockDemand ? "Locked to the demand this issue was opened from" : undefined}
                className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
              >
                <option value="">Direct Issue (no demand)</option>
                {demands
                  .filter((d) => d.status !== "Fulfilled" && d.status !== "Escalated to Supply Chain")
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.id} — {d.requestedBy} · {d.status} ({d.items.length} item{d.items.length > 1 ? "s" : ""})
                    </option>
                  ))}
              </select>
            </div>
            <LocationPicker
              officeId={officeId}
              warehouseId={warehouseId}
              onChange={(n) => { setOfficeId(n.officeId); setWarehouseId(n.warehouseId); }}
            />
          </div>
        </div>

        <div className="px-6 pt-4 pb-3 border-b border-border space-y-3">
          {isDirect ? (
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-7">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Add Item
                </Label>
                <select
                  value={addItemId}
                  onChange={(e) => setAddItemId(e.target.value)}
                  className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Select item...</option>
                  {inventory
                    .filter((i) => !manualIds.includes(i.id))
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.id} — {i.name} ({i.uom})
                      </option>
                    ))}
                </select>
              </div>
              <div className="col-span-3">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Qty
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={addItemQty}
                  onChange={(e) => setAddItemQty(e.target.value)}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
              <div className="col-span-2">
                <Button variant="outline" onClick={addManualLine} className="w-full">
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>
          ) : (
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items..."
                className="pl-9 h-9"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {summary.issuedItems} item{summary.issuedItems !== 1 ? "s" : ""} ready · Issued total <span className="font-semibold text-foreground tabular-nums">{summary.totalIssued}</span> · Remaining <span className="font-semibold text-foreground tabular-nums">{summary.totalRemaining}</span>
              {stockErrors.length > 0 && (
                <span className="text-destructive font-medium">
                  {" "}· {stockErrors.length} over stock
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 sticky top-0 z-10">
              <tr>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider w-12">SL</th>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider">Item</th>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider w-16">UoM</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider w-24">Stock</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider w-28">Requested</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider w-28">Issued</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider w-28">Remaining</th>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider">Allocation (FEFO/FIFO)</th>
                {isDirect && <th className="px-3 py-2 w-12" />}
              </tr>
            </thead>
            <tbody>
              {visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={isDirect ? 9 : 8} className="text-center text-xs text-muted-foreground py-8">
                    {isDirect
                      ? "No items added yet — use the Add Item picker above."
                      : selectedDemand
                        ? "No items match the search."
                        : "Select a demand reference to load items."}
                  </td>
                </tr>
              ) : (
                visibleItems.map((inv, i) => {
                  const reqN = requestedFor(inv.id);
                  const issN = Number(issuedMap[inv.id]) || 0;
                  const remaining = roundQty(Math.max(0, reqN - issN));
                  const over = issN > reqN && reqN > 0;
                  const avail = availableIn(inv.name);
                  const held = heldIn(inv.name);
                  const lowStock = issN > 0 && issN > avail;
                  const inDemand = reqN > 0;
                  // Only allocate when the selected warehouse actually holds stock.
                  const fefo = issN > 0 && avail > 0 ? allocateFefo(inv.id, Math.min(issN, avail)) : null;
                  return (
                    <tr key={inv.id} className={"border-t border-border hover:bg-muted/20" + (inDemand ? " bg-primary/[0.03]" : "")}>
                      <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{inv.name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{inv.id}</div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{inv.uom}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={lowStock ? "text-destructive font-semibold" : ""}>
                          {avail}
                        </span>
                        {held > 0 && (
                          <div
                            className="text-[10px] text-warning font-medium"
                            title="On hand but held for QC — not issuable until it passes or is disposed"
                          >
                            +{held} held
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={inDemand ? "font-semibold text-foreground" : "text-muted-foreground"}>
                          {inDemand ? reqN : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        <Input
                          type="number"
                          min={0}
                          max={avail}
                          value={issuedMap[inv.id] ?? ""}
                          onChange={(e) => setIssued(inv.id, e.target.value)}
                          placeholder="0"
                          className={"h-8 text-right tabular-nums" + ((over || lowStock) ? " border-destructive" : "")}
                        />
                        {lowStock && (
                          <div className="text-[10px] text-destructive mt-0.5">
                            Only {avail} {inv.uom} issuable{held > 0 ? ` · ${held} held for QC` : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={over ? "text-destructive font-semibold" : remaining > 0 ? "text-warning" : "text-muted-foreground"}>
                          {over ? `+${issN - reqN}` : remaining}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        {fefo === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors cursor-pointer"
                                title={`View ${fefo.method} allocation breakdown`}
                              >
                                {fefo.method}
                                <ChevronDown className="h-2.5 w-2.5" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-64 p-3 text-[11px]">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] uppercase tracking-wider font-bold text-primary">
                                  {fefo.method} allocation
                                </span>
                                <span className="text-muted-foreground truncate ml-2">{inv.name}</span>
                              </div>
                              {fefo.allocations.length === 0 ? (
                                <div className="text-muted-foreground">No batches allocated.</div>
                              ) : (
                                <div className="space-y-1">
                                  {fefo.allocations.map((a) => (
                                    <div key={a.batchNo} className="font-mono flex items-center justify-between gap-2">
                                      <span className="text-foreground">{a.batchNo}</span>
                                      <span className="text-muted-foreground">{a.expiry}</span>
                                      <span className="font-semibold whitespace-nowrap">{a.qty} {inv.uom}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {fefo.shortfall > 0 && (
                                <div className="text-destructive font-semibold mt-2 pt-2 border-t border-border">
                                  Shortfall: {fefo.shortfall} {inv.uom}
                                </div>
                              )}
                            </PopoverContent>
                          </Popover>
                        )}
                      </td>
                      {isDirect && (
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => removeManualLine(inv.id)}
                            aria-label={`Remove ${inv.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={stockErrors.length > 0}
            title={stockErrors.length > 0 ? "Some quantities exceed available stock" : undefined}
          >
            <Send className="h-4 w-4 mr-1.5" /> Issue Items
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={"mt-1 text-sm text-foreground" + (bold ? " font-semibold" : "")}>
        {value}
      </div>
    </div>
  );
}
