import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { ReviewStatusCell } from "@/components/common/ReviewStatusCell";
import { RowActions } from "@/components/common/RowActions";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, ShoppingCart, FileText, Truck, X, Banknote, ClipboardList, Download } from "lucide-react";
import { vendors, activeItems } from "@/lib/sample-data";
import { KpiCard } from "@/components/common/KpiCard";
import { exportTableCsv } from "@/lib/list-export";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useWorkflow, type WfPurchaseOrder, type WfRequisition } from "@/lib/workflow-store";
import { LocationPicker, LocationFilter, LocationCell } from "@/components/common/LocationPicker";
import { useArrivalFlash } from "@/lib/arrival-flash";
import { getPurchaseRequisitions, type PurchaseRequisition } from "@/lib/purchase-requisitions";

/** Quantity on a PR still not placed on any Purchase Order (qty − orderedQty). */
function prOutstandingToOrder(pr: PurchaseRequisition): number {
  return pr.lines.reduce((sum, l) => sum + Math.max(l.qty - (l.orderedQty ?? 0), 0), 0);
}

type POLineRow = { id: string; name: string; qty: number; uom: string; unitPrice: number; prefilled?: boolean };

export default function ProcurementPage() {
  useArrivalFlash();
  const wf = useWorkflow();
  const { wfPurchaseOrders, wfRequisitions, addPurchaseOrder, updatePurchaseOrder } = wf;

  // PO creation dialog state
  const [poDialogOpen, setPoDialogOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState<WfRequisition | null>(null);
  const [poVendor, setPoVendor] = useState("");
  const [poDeliveryDate, setPoDeliveryDate] = useState("");
  const [poNotes, setPoNotes] = useState("");
  const [poLines, setPoLines] = useState<POLineRow[]>([]);
  const [poOfficeId, setPoOfficeId] = useState("OFF-001");
  const [poWarehouseId, setPoWarehouseId] = useState("WH-001");
  // "From Purchase Requisition" toggle + picked PR id (Direct PO only).
  const [poFromPr, setPoFromPr] = useState(false);
  const [poPrId, setPoPrId] = useState("");

  // List filter state
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");

  // Purchase Requisitions still open to order against — the pickable set for the
  // "From Purchase Requisition" mode. Refreshed each time the dialog opens.
  const orderablePRs = useMemo(() => {
    if (!poDialogOpen) return [];
    return getPurchaseRequisitions().filter((pr) => {
      const s = pr.status.toLowerCase();
      if (["rejected", "cancelled", "closed", "draft", "pending approval", "pending"].includes(s)) return false;
      return prOutstandingToOrder(pr) > 0;
    });
  }, [poDialogOpen]);

  // Load a PR's un-ordered lines into the PO form (qty defaults to each line's
  // outstanding-to-order balance; unit price seeds from the PR rate).
  const poSelectPr = (prId: string) => {
    setPoPrId(prId);
    if (!prId) return;
    const pr = getPurchaseRequisitions().find((p) => p.id === prId);
    if (!pr) return;
    setPoOfficeId(pr.officeId || "OFF-001");
    setPoWarehouseId(pr.warehouseId || "WH-001");
    setPoNotes(`PO against Purchase Requisition ${pr.id}.`);
    const outstanding = pr.lines
      .map((l) => ({ l, remaining: Math.max(l.qty - (l.orderedQty ?? 0), 0) }))
      .filter((x) => x.remaining > 0);
    setPoLines(
      outstanding.length > 0
        ? outstanding.map(({ l, remaining }, i) => ({
            id: `pr-${i}`, name: l.itemName, qty: remaining, uom: l.uom,
            unitPrice: l.rate || 0, prefilled: true,
          }))
        : [{ id: `line-${Date.now()}`, name: "", qty: 1, uom: "Kg", unitPrice: 0 }],
    );
  };

  // Toggle "From Purchase Requisition"; clears the PR link and lines when off.
  const poToggleFromPr = (on: boolean) => {
    setPoFromPr(on);
    if (!on) {
      setPoPrId("");
      setPoNotes("");
      setPoLines([{ id: `line-${Date.now()}`, name: "", qty: 1, uom: "Kg", unitPrice: 0 }]);
    }
  };

  const openPODialog = (req: WfRequisition) => {
    setSelectedReq(req);
    setPoFromPr(false); setPoPrId("");
    const isAsset = req.source === "Fleet Operations";
    const availVendors = isAsset
      ? vendors.filter(v => v.category === "Equipment/Assets")
      : vendors.filter(v => v.category !== "Equipment/Assets");
    setPoVendor(availVendors[0]?.name ?? vendors[0]?.name ?? "");
    setPoDeliveryDate("");
    setPoNotes("");
    setPoOfficeId(req.officeId ?? "OFF-001");
    setPoWarehouseId(req.warehouseId ?? "WH-001");
    // Pre-populate lines from demand items if available
    setPoLines(
      (req.demandItems ?? []).map((item, i) => ({
        id: `line-${i}`,
        name: item.name,
        qty: item.qty,
        uom: item.uom,
        unitPrice: 0,
        prefilled: true,
      }))
    );
    setPoDialogOpen(true);
  };

  // Open the same dialog without a backing requisition — for ad-hoc POs.
  const openBlankPODialog = () => {
    setSelectedReq(null);
    setPoFromPr(false); setPoPrId("");
    setPoVendor(vendors[0]?.name ?? "");
    setPoDeliveryDate("");
    setPoNotes("");
    setPoOfficeId("OFF-001");
    setPoWarehouseId("WH-001");
    setPoLines([
      { id: `line-${Date.now()}`, name: "", qty: 1, uom: "Kg", unitPrice: 0 },
    ]);
    setPoDialogOpen(true);
  };

  const updateLinePrice = (id: string, price: number) => {
    setPoLines(prev => prev.map(l => l.id === id ? { ...l, unitPrice: price } : l));
  };

  const updateLineQty = (id: string, qty: number) => {
    setPoLines(prev => prev.map(l => l.id === id ? { ...l, qty } : l));
  };

  const addEmptyLine = () => {
    setPoLines(prev => [...prev, { id: `line-${Date.now()}`, name: "", qty: 1, uom: "Kg", unitPrice: 0 }]);
  };

  const removeLine = (id: string) => {
    setPoLines(prev => prev.filter(l => l.id !== id));
  };

  // Pick an item from the Item Profile; prefills name + UoM + cost-price seed.
  const pickItem = (id: string, itemName: string) => {
    const it = activeItems.find(i => i.name === itemName);
    setPoLines(prev => prev.map(l => l.id === id
      ? { ...l, name: itemName, uom: it?.uom ?? l.uom, unitPrice: l.unitPrice || (it?.costPrice ?? 0) }
      : l));
  };

  const totalAmount = useMemo(
    () => poLines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0),
    [poLines]
  );

  const savePO = (submitForApproval: boolean) => {
    if (!poVendor) { toast.error("Please select a vendor."); return; }
    if (!poOfficeId) { toast.error("Office is required."); return; }
    if (!poWarehouseId) { toast.error("Warehouse is required."); return; }
    const validLines = poLines.filter(l => l.name.trim() && l.qty > 0);
    if (validLines.length === 0) { toast.error("Add at least one item line with quantity."); return; }

    const poId = `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    const newPO: WfPurchaseOrder = {
      id: poId,
      vendor: poVendor,
      items: validLines.length,
      amount: totalAmount,
      date: new Date().toISOString().slice(0, 10),
      status: submitForApproval ? "Pending Approval" : "Draft",
      requisitionRef: selectedReq?.id ?? (poPrId || "—"),
      deliveryDate: poDeliveryDate,
      notes: poNotes,
      officeId: poOfficeId,
      warehouseId: poWarehouseId,
      lineItems: validLines.map(l => ({
        itemId: l.id,
        name: l.name,
        qty: l.qty,
        uom: l.uom,
        unitPrice: l.unitPrice,
      })),
    };
    addPurchaseOrder(newPO);
    setPoDialogOpen(false);
    if (submitForApproval) {
      toast.success(`${poId} submitted for Accounts approval.`);
    } else {
      toast.success(`${poId} saved as draft.`);
    }
  };

  const openPOs = useMemo(
    () => wfPurchaseOrders.filter(p => ["Pending Approval", "Approved", "Ordered", "Open"].includes(p.status)).length,
    [wfPurchaseOrders]
  );
  const pendingApproval = useMemo(
    () => wfPurchaseOrders.filter(p => p.status === "Pending Approval").length,
    [wfPurchaseOrders]
  );

  const poCols: Column<WfPurchaseOrder>[] = [
    { key: "id", header: "PO #", render: (r) => <span className="font-mono text-xs font-semibold text-primary">{r.id}</span> },
    { key: "vendor", header: "Vendor", render: (r) => <span className="font-medium">{r.vendor}</span> },
    {
      key: "requisitionRef", header: "Req Ref",
      render: (r) => r.requisitionRef && r.requisitionRef !== "—"
        ? <span className="font-mono text-xs">{r.requisitionRef}</span>
        : <span className="text-xs text-muted-foreground">Direct</span>,
    },
    {
      key: "officeId" as keyof WfPurchaseOrder, header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    {
      key: "items", header: "Items",
      render: (r) => (
        <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-semibold tabular-nums">
          {r.items}
        </span>
      ),
    },
    {
      key: "amount", header: "Amount (৳)", className: "text-right",
      render: (r) => r.amount > 0
        ? <span className="tabular-nums font-semibold">{r.amount.toLocaleString()}</span>
        : <span className="text-muted-foreground">—</span>,
    },
    { key: "date", header: "Date", render: (r) => <span className="tabular-nums whitespace-nowrap">{r.date}</span> },
    { key: "status", header: "Status", render: (r) => (
      <ReviewStatusCell category="Purchase Order" refId={r.id}>
        <StatusBadge status={r.status} />
      </ReviewStatusCell>
    ) },
  ];

  const reqCols: Column<WfRequisition>[] = [
    { key: "id", header: "Req #" },
    { key: "reference", header: "Reference" },
    {
      key: "officeId" as keyof WfRequisition, header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    { key: "requestedBy", header: "Requested By" },
    { key: "source", header: "Source" },
    { key: "date", header: "Date" },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  // Only APPROVED requisitions are ready to raise a PO against.
  const filteredReqs = wfRequisitions.filter((r) => {
    if (r.status !== "Approved") return false;
    if (filterOffice && r.officeId !== filterOffice) return false;
    if (filterWarehouse && r.warehouseId !== filterWarehouse) return false;
    return true;
  });
  const filteredPOs = wfPurchaseOrders.filter((p) => {
    if (filterOffice && p.officeId !== filterOffice) return false;
    if (filterWarehouse && p.warehouseId !== filterWarehouse) return false;
    return true;
  });

  // ── Status chips over the PO list ───────────────────────────────────────────
  const [statusChip, setStatusChip] = useState("all");
  const STATUS_ORDER = ["Draft", "Pending Approval", "Approved", "Ordered", "Received", "Completed", "Rejected"];
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of filteredPOs) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    const known = STATUS_ORDER.filter((s) => m.has(s));
    const rest = [...m.keys()].filter((s) => !STATUS_ORDER.includes(s)).sort();
    return [...known, ...rest].map((s) => ({ status: s, count: m.get(s)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredPOs]);
  const visiblePOs = statusChip === "all" ? filteredPOs : filteredPOs.filter((p) => p.status === statusChip);
  const poTotalValue = useMemo(() => filteredPOs.reduce((s, p) => s + (p.amount || 0), 0), [filteredPOs]);

  // Real CSV export of the PO list as currently filtered.
  const exportPOs = () => {
    exportTableCsv({
      title: "Purchase Orders",
      fileName: "purchase-orders",
      columns: ["PO #", "Vendor", "Req Ref", "Items", "Amount", "Date", "Delivery Date", "Status"],
      rows: visiblePOs.map((p) => [
        p.id, p.vendor, p.requisitionRef ?? "—", p.items,
        p.amount || 0, p.date, p.deliveryDate ?? "", p.status,
      ]),
    });
    toast.success(`Exported ${visiblePOs.length} purchase order${visiblePOs.length === 1 ? "" : "s"}.`);
  };

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        subtitle="Create and manage purchase orders; vendor selection and procurement workflow for supply chain"
        actions={
          <>
            <Button variant="outline" onClick={exportPOs} title="Download the PO list below as CSV">
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
            <Button onClick={openBlankPODialog}>
              <Plus className="h-4 w-4 mr-1" /> New PO
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Open POs" value={openPOs} sub="pending, approved & ordered" icon={ShoppingCart} tone="warning" />
        <KpiCard label="Pending Approval" value={pendingApproval} sub="awaiting Accounts sign-off" icon={FileText} tone="red" />
        <KpiCard label="PO Value" value={`৳ ${poTotalValue.toLocaleString()}`} sub={`across ${filteredPOs.length} listed PO${filteredPOs.length === 1 ? "" : "s"}`} icon={Banknote} tone="navy" />
        <KpiCard label="Active Vendors" value={vendors.length} sub="approved supplier base" icon={Truck} tone="success" />
      </div>

      <div className="mb-5">
        <LocationFilter
          officeId={filterOffice}
          warehouseId={filterWarehouse}
          onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
        />
      </div>

      {/* ── Requisitions from Store — approved, waiting for a PO ── */}
      <Card className="mb-6 overflow-hidden border-border shadow-sm">
        <CardHeader className="border-b border-border bg-gradient-to-r from-emerald-50/80 to-transparent py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-grid h-9 w-9 place-items-center rounded-lg bg-emerald-100 text-emerald-700 shrink-0">
              <ClipboardList className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                Requisitions from Store
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 tabular-nums">
                  {filteredReqs.length}
                </span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Approved requisitions with no purchase order yet — raise one with Create PO.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {filteredReqs.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-border bg-muted/20 py-10 text-center">
              <ClipboardList className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No approved requisitions waiting — all caught up.</p>
            </div>
          ) : (
            <DataTable
              title="requisitions"
              data={filteredReqs}
              columns={reqCols}
              searchKeys={["id", "reference", "requestedBy", "status"]}
              selectable={false}
              actions={(r) => (
                <Button
                  size="sm"
                  disabled={r.status !== "Approved"}
                  onClick={() => openPODialog(r)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Create PO
                </Button>
              )}
            />
          )}
        </CardContent>
      </Card>

      {/* ── Purchase Orders — status chips + list ── */}
      <Card className="overflow-hidden border-border shadow-sm">
        <CardHeader className="border-b border-border bg-gradient-to-r from-primary/5 to-transparent py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
              <ShoppingCart className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                Purchase Orders
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary tabular-nums">
                  {filteredPOs.length}
                </span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                ৳ {poTotalValue.toLocaleString()} total value in the current scope.
              </p>
            </div>
          </div>
          {/* Status chips — click to scope the list */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            <button
              type="button"
              onClick={() => setStatusChip("all")}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                statusChip === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              All ({filteredPOs.length})
            </button>
            {statusCounts.map(({ status, count }) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusChip(statusChip === status ? "all" : status)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  statusChip === status
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {status} ({count})
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div data-arrival-id="po-list">
            <DataTable
              title="purchase-orders"
              data={visiblePOs}
              columns={poCols}
              searchKeys={["id", "vendor", "status", "requisitionRef"]}
              selectable={false}
              actions={(r) => (
                <RowActions
                  row={r}
                  actions={["view", "edit", "print"]}
                  onSave={(u) => updatePurchaseOrder(u.id as string, u as Partial<WfPurchaseOrder>)}
                />
              )}
            />
          </div>
        </CardContent>
      </Card>

      {/* PO Creation Dialog */}
      <Dialog open={poDialogOpen} onOpenChange={setPoDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
                <ShoppingCart className="h-4 w-4" />
              </span>
              {selectedReq ? `Create Purchase Order — Req: ${selectedReq.id}` : "Create Purchase Order — Direct"}
            </DialogTitle>
          </DialogHeader>

          {/* From Purchase Requisition — load a PR's un-ordered lines instead of keying them in */}
          {!selectedReq && (
            <div className="rounded-md border border-border bg-muted/30 p-3 mb-1">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input
                  type="checkbox"
                  checked={poFromPr}
                  onChange={(e) => poToggleFromPr(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                From Purchase Requisition
              </label>
              {poFromPr && (
                <div className="mt-3">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Purchase Requisition</Label>
                  <select
                    value={poPrId}
                    onChange={(e) => poSelectPr(e.target.value)}
                    className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Select a requisition…</option>
                    {orderablePRs.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.id} — {pr.requestedBy} ({prOutstandingToOrder(pr)} to order)
                      </option>
                    ))}
                  </select>
                  {poPrId && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Un-ordered lines loaded from {poPrId} — adjust quantities and set unit prices.
                    </p>
                  )}
                  {orderablePRs.length === 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">No approved requisitions with items left to order.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>PO Number (auto)</Label>
              <Input disabled value={`PO-${new Date().getFullYear()}-XXXX`} className="mt-1 bg-muted/50" />
            </div>
            <div>
              <Label>Requisition Ref</Label>
              <Input
                disabled
                value={selectedReq?.id ?? (poPrId || "— Direct PO —")}
                className="mt-1 bg-muted/50 text-muted-foreground"
              />
            </div>
            <div>
              <Label>Vendor *</Label>
              <select
                value={poVendor}
                onChange={(e) => setPoVendor(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {(selectedReq?.source === "Fleet Operations"
                ? vendors.filter(v => v.category === "Equipment/Assets")
                : vendors.filter(v => v.category !== "Equipment/Assets")
              ).map(v => <option key={v.id} value={v.name}>{v.name} ({v.category})</option>)}
              </select>
            </div>
            <div>
              <Label>Est. Receive Date</Label>
              <Input type="date" value={poDeliveryDate} onChange={(e) => setPoDeliveryDate(e.target.value)} className="mt-1" />
            </div>
            <LocationPicker
              officeId={poOfficeId}
              warehouseId={poWarehouseId}
              onChange={(n) => { setPoOfficeId(n.officeId); setPoWarehouseId(n.warehouseId); }}
            />
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea value={poNotes} onChange={(e) => setPoNotes(e.target.value)} rows={2} className="mt-1" />
            </div>
          </div>

          {/* Line items */}
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <Label>Items</Label>
              <Button size="sm" variant="outline" onClick={addEmptyLine}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
              </Button>
            </div>
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-semibold">Item</th>
                    <th className="p-2 text-left font-semibold w-20">Qty</th>
                    <th className="p-2 text-left font-semibold w-16">UOM</th>
                    <th className="p-2 text-left font-semibold w-28">Unit Price (৳)</th>
                    <th className="p-2 text-left font-semibold w-24">Total (৳)</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {poLines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-muted-foreground text-xs">
                        No items — click "Add Item" or items will be pre-filled from requisition
                      </td>
                    </tr>
                  ) : poLines.map(line => (
                    <tr key={line.id} className="border-t border-border/50">
                      <td className="p-2">
                        {line.prefilled && line.name ? (
                          <div className="px-2 py-1 text-xs font-medium bg-muted/50 rounded-md border border-input truncate">
                            {line.name}
                          </div>
                        ) : (
                          <select
                            value={line.name}
                            onChange={(e) => pickItem(line.id, e.target.value)}
                            className="w-full h-7 rounded-md border border-input bg-background px-2 text-xs"
                          >
                            <option value="">Select item…</option>
                            {activeItems.slice(0, 100).map((it) => (
                              <option key={it.id} value={it.name}>{it.name}</option>
                            ))}
                            {line.name && !activeItems.some(i => i.name === line.name) && (
                              <option value={line.name}>{line.name}</option>
                            )}
                          </select>
                        )}
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          value={line.qty}
                          onChange={(e) => updateLineQty(line.id, Number(e.target.value))}
                          className="h-7 text-xs w-full"
                        />
                      </td>
                      <td className="p-2 text-muted-foreground">{line.uom}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          value={line.unitPrice || ""}
                          placeholder="0"
                          onChange={(e) => updateLinePrice(line.id, Number(e.target.value))}
                          className="h-7 text-xs w-full"
                        />
                      </td>
                      <td className="p-2 font-medium">{(line.qty * line.unitPrice).toLocaleString()}</td>
                      <td className="p-2">
                        <button type="button" onClick={() => removeLine(line.id)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {poLines.length > 0 && (
                    <tr className="border-t border-border bg-muted/30">
                      <td colSpan={4} className="p-2 text-right font-semibold text-sm">Total</td>
                      <td className="p-2 font-bold">৳{totalAmount.toLocaleString()}</td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setPoDialogOpen(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => savePO(false)}>Save Draft</Button>
            <Button onClick={() => savePO(true)}>Submit for Approval</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
