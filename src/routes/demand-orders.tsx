import { useNavigate } from "react-router-dom";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Plus, FileText, Clock, Send, AlertTriangle,
  CheckCircle2, XCircle, ArrowUpRight, PackageCheck, Trash2,
  ShieldCheck, Eye,
} from "lucide-react";
import { inventory } from "@/lib/sample-data";
import { KpiCard } from "@/components/common/KpiCard";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useWorkflow,
  type WfDemandRequest, type WfDemandItem,
} from "@/lib/workflow-store";
import { useRole } from "@/lib/roles";
import { LocationPicker, LocationFilter, LocationCell } from "@/components/common/LocationPicker";

const KITCHEN_SECTIONS = ["Hot Kitchen", "Cold Kitchen", "Veg Section", "Special Meal", "Bakery", "Packaging"];

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
    { key: "id", header: "Request #" },
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
        return <StatusBadge status={label} />;
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
      { id: inv.id, name: inv.name, type: inv.category, qty, uom: inv.uom },
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
                onClick={() => { setSelectedRequest(row); setNeedsPurchase({}); }}
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
              if (!open) { setSelectedRequest(null); setNeedsPurchase({}); }
            }}
          >
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
              <DialogHeader className="px-5 py-4 border-b border-border">
                <DialogTitle className="flex items-center justify-between gap-3">
                  <span>Demand Request — {activeDemand?.id}</span>
                  {activeDemand && <StatusBadge status={activeDemand.status} />}
                </DialogTitle>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {activeDemand && (
                <>
                  {/* Metadata */}
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs space-y-1">
                    <div className="text-muted-foreground">
                      Ref: <strong className="text-foreground">{activeDemand.reference}</strong>
                      {" · "}By <strong className="text-foreground">{activeDemand.requestedBy}</strong> ({activeDemand.role})
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
                    {activeDemand.note && (
                      <div className="text-muted-foreground italic pt-1 border-t border-border/60 mt-1.5">
                        {activeDemand.note}
                      </div>
                    )}
                  </div>

                  {/* Item analysis */}
                  <div>
                    {(() => {
                      // Only items with stock available are issuable. Shortfall items
                      // can't be checked — they automatically flow to a Purchase
                      // Requisition; the user only ticks what they want to issue from
                      // the store.
                      const issuableItems = activeDemand.items.filter((i) => {
                        const inv = inventory.find((x) => x.id === i.id || x.name.toLowerCase() === i.name.toLowerCase());
                        return (inv?.stock ?? 0) >= i.qty;
                      });
                      const canSelect =
                        activeDemand.status === "Pending Store Review" ||
                        activeDemand.status === "Partially Available" ||
                        activeDemand.status === "Partially Fulfilled";
                      const allIssuableSelected =
                        canSelect &&
                        issuableItems.length > 0 &&
                        issuableItems.every((i) => needsPurchase[i.id]);
                      return (
                        <div className="grid grid-cols-[1fr_80px_80px_80px_32px] gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                          <span>Item</span>
                          <span className="text-center">In Stock</span>
                          <span className="text-center">Required</span>
                          <span className="text-center">Shortfall</span>
                          <div className="flex justify-center items-center">
                            {canSelect && issuableItems.length > 0 ? (
                              <input
                                type="checkbox"
                                title="Select all in-stock items for issue"
                                checked={allIssuableSelected}
                                onChange={() => {
                                  if (allIssuableSelected) {
                                    setNeedsPurchase({});
                                  } else {
                                    setNeedsPurchase(Object.fromEntries(issuableItems.map((i) => [i.id, true])));
                                  }
                                }}
                                className="h-4 w-4 accent-green-600 cursor-pointer"
                              />
                            ) : null}
                          </div>
                        </div>
                      );
                    })()}

                    {activeDemand.items.length > 0 ? (
                      <div className="space-y-2">
                        {activeDemand.items.map(item => {
                          const inv = inventory.find(i => i.id === item.id || i.name.toLowerCase() === item.name.toLowerCase());
                          const currentStock = inv?.stock ?? 0;
                          const shortfall = item.qty - currentStock;
                          const insufficient = shortfall > 0;
                          const flagged = needsPurchase[item.id] ?? false;
                          const canSelect = (activeDemand.status === "Pending Store Review" ||
                                             activeDemand.status === "Partially Available" ||
                                             activeDemand.status === "Partially Fulfilled") &&
                                            !insufficient;
                          return (
                            <div
                              key={item.id}
                              className={`rounded-lg border p-3 ${flagged ? "border-green-400 bg-green-50" : insufficient ? "border-red-200 bg-red-50/50" : "border-border bg-muted/40"}`}
                            >
                              <div className="grid grid-cols-[1fr_80px_80px_80px_32px] gap-2 items-center">
                                <div>
                                  <div className="font-semibold text-sm">{item.name}</div>
                                  <div className="text-[11px] text-muted-foreground">{item.type}</div>
                                </div>
                                <div className="text-center">
                                  <span className={`text-sm font-semibold ${insufficient ? "text-red-600" : "text-green-700"}`}>{currentStock}</span>
                                  <div className="text-[10px] text-muted-foreground">{item.uom}</div>
                                </div>
                                <div className="text-center">
                                  <span className="text-sm font-semibold">{item.qty}</span>
                                  <div className="text-[10px] text-muted-foreground">{item.uom}</div>
                                </div>
                                <div className="text-center">
                                  {insufficient ? (
                                    <>
                                      <span className="text-sm font-bold text-red-600">−{shortfall}</span>
                                      <div className="text-[10px] text-red-500">{item.uom} short</div>
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-sm font-bold text-green-600">OK</span>
                                      <div className="text-[10px] text-green-600">sufficient</div>
                                    </>
                                  )}
                                </div>
                                <div className="flex justify-center">
                                  {canSelect && (
                                    <input
                                      type="checkbox"
                                      title="Mark for issue from store"
                                      checked={flagged}
                                      onChange={(e) => setNeedsPurchase(prev => ({ ...prev, [item.id]: e.target.checked }))}
                                      className="h-4 w-4 accent-green-600 cursor-pointer"
                                    />
                                  )}
                                </div>
                              </div>
                              {insufficient && (
                                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-600">
                                  <AlertTriangle className="h-3 w-3 shrink-0" />
                                  Stock insufficient — {shortfall} {item.uom} must be procured
                                </div>
                              )}
                              {flagged && (
                                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-green-700 font-medium">
                                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                                  Selected for issue from store
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground py-3">No items attached to this request.</p>
                    )}
                  </div>

                </>
              )}
              </div>

              {/* Action footer */}
              {activeDemand && (
                <DialogFooter className="px-5 py-3 border-t border-border bg-muted/20 flex-wrap gap-2">
                  {activeDemand.status === "Pending Approval" ? (
                    <>
                      <div className="flex items-center gap-2 text-xs text-amber-700 font-medium mr-auto">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Awaiting approval — handled on Approval Management
                      </div>
                      <Button asChild size="sm">
                        <Link to="/approval-management">
                          Go to Approval Management <ArrowUpRight className="h-3.5 w-3.5 ml-1.5" />
                        </Link>
                      </Button>
                    </>
                  ) : activeDemand.status === "Pending Store Review" || activeDemand.status === "Partially Available" ? (
                    <>
                      {Object.values(needsPurchase).some(Boolean) && (
                        <div className="flex items-center gap-2 text-xs text-green-700 font-medium mr-auto">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {Object.values(needsPurchase).filter(Boolean).length} item{Object.values(needsPurchase).filter(Boolean).length === 1 ? "" : "s"} selected for issue
                        </div>
                      )}
                      <Button
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={fulfillFromStore}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1.5" /> Fulfill from Store
                      </Button>
                    </>
                  ) : activeDemand.status === "Partially Issued" ? (
                    <>
                      <div className="flex items-center gap-2 text-xs text-amber-700 font-medium mr-auto">
                        <PackageCheck className="h-3.5 w-3.5" />
                        Partially issued — some items still pending
                      </div>
                      <Button
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={fulfillFromStore}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1.5" /> Continue Issuing
                      </Button>
                    </>
                  ) : activeDemand.status === "Partially Fulfilled" ? (
                    <>
                      <div className="flex items-center gap-2 text-xs text-blue-700 font-medium mr-auto">
                        <PackageCheck className="h-3.5 w-3.5" />
                        Items issued; remaining escalated to supply chain
                      </div>
                      {Object.values(needsPurchase).some(Boolean) && (
                        <div className="flex items-center gap-2 text-xs text-green-700 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {Object.values(needsPurchase).filter(Boolean).length} selected for issue
                        </div>
                      )}
                      <Button
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={fulfillFromStore}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1.5" /> Fulfill from Store
                      </Button>
                    </>
                  ) : activeDemand.status === "Escalated to Supply Chain" ? (
                    <>
                      <div className="flex items-center gap-2 text-xs text-amber-700 font-medium mr-auto">
                        <Send className="h-3.5 w-3.5" />
                        Escalated — Requisition awaiting PO and GRN
                      </div>
                      <Button
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={fulfillFromStore}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1.5" /> Fulfill from Store
                      </Button>
                    </>
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
                            <div className="text-[11px] text-muted-foreground">{it.type}</div>
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
