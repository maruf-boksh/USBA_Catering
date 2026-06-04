import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, ShoppingCart, FileText, Truck, X } from "lucide-react";
import { vendors, activeItems } from "@/lib/sample-data";
import { KpiCard } from "@/components/common/KpiCard";
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

type POLineRow = { id: string; name: string; qty: number; uom: string; unitPrice: number };

export default function ProcurementPage() {
  useArrivalFlash();
  const wf = useWorkflow();
  const { wfPurchaseOrders, wfRequisitions, addPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder } = wf;

  // PO creation dialog state
  const [poDialogOpen, setPoDialogOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState<WfRequisition | null>(null);
  const [poVendor, setPoVendor] = useState("");
  const [poDeliveryDate, setPoDeliveryDate] = useState("");
  const [poNotes, setPoNotes] = useState("");
  const [poLines, setPoLines] = useState<POLineRow[]>([]);
  const [poOfficeId, setPoOfficeId] = useState("OFF-001");
  const [poWarehouseId, setPoWarehouseId] = useState("WH-001");

  // List filter state
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");

  const openPODialog = (req: WfRequisition) => {
    setSelectedReq(req);
    setPoVendor(vendors[0]?.name ?? "");
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
      }))
    );
    setPoDialogOpen(true);
  };

  // Open the same dialog without a backing requisition — for ad-hoc POs.
  const openBlankPODialog = () => {
    setSelectedReq(null);
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
      requisitionRef: selectedReq?.id ?? "—",
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
    { key: "id", header: "PO #" },
    { key: "vendor", header: "Vendor" },
    { key: "requisitionRef", header: "Req Ref" },
    {
      key: "officeId" as keyof WfPurchaseOrder, header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    { key: "items", header: "Items" },
    { key: "amount", header: "Amount (৳)", render: (r) => r.amount > 0 ? r.amount.toLocaleString() : "—" },
    { key: "date", header: "Date" },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
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

  const filteredReqs = wfRequisitions.filter((r) => {
    if (filterOffice && r.officeId !== filterOffice) return false;
    if (filterWarehouse && r.warehouseId !== filterWarehouse) return false;
    return true;
  });
  const filteredPOs = wfPurchaseOrders.filter((p) => {
    if (filterOffice && p.officeId !== filterOffice) return false;
    if (filterWarehouse && p.warehouseId !== filterWarehouse) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        subtitle="Create and manage purchase orders; vendor selection and procurement workflow for supply chain"
        actions={
          <>
            <Button variant="outline" onClick={() => toast.success("Export started.")}>
              <FileText className="h-4 w-4 mr-1" /> Export
            </Button>
            <Button onClick={openBlankPODialog}>
              <Plus className="h-4 w-4 mr-1" /> New PO
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Open POs" value={openPOs} icon={ShoppingCart} tone="warning" />
        <KpiCard label="Pending Approval" value={pendingApproval} icon={FileText} tone="red" />
        <KpiCard label="Active Vendors" value={vendors.length} icon={Truck} tone="success" />
      </div>

      <div className="mb-4">
        <LocationFilter
          officeId={filterOffice}
          warehouseId={filterWarehouse}
          onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
        />
      </div>

      {/* Requisitions from Store */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Requisitions from Store</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            title="requisitions"
            data={filteredReqs}
            columns={reqCols}
            searchKeys={["id", "reference", "requestedBy", "status"]}
            selectable={false}
            actions={(r) => (
              <Button
                size="sm"
                variant="outline"
                disabled={r.status === "Approved"}
                onClick={() => openPODialog(r)}
              >
                Create PO
              </Button>
            )}
          />
        </CardContent>
      </Card>

      {/* Purchase Orders list */}
      <div className="mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Purchase Orders
      </div>
      <div data-arrival-id="po-list">
        <DataTable
          title="purchase-orders"
          data={filteredPOs}
          columns={poCols}
          searchKeys={["id", "vendor", "status", "requisitionRef"]}
          selectable={false}
          actions={(r) => (
            <RowActions
              row={r}
              actions={["view", "edit", "print", "delete"]}
              onSave={(u) => updatePurchaseOrder(u.id as string, u as Partial<WfPurchaseOrder>)}
              onDelete={(u) => deletePurchaseOrder(u.id as string)}
            />
          )}
        />
      </div>

      {/* PO Creation Dialog */}
      <Dialog open={poDialogOpen} onOpenChange={setPoDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedReq ? `Create Purchase Order — Req: ${selectedReq.id}` : "Create Purchase Order — Direct"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>PO Number (auto)</Label>
              <Input disabled value={`PO-${new Date().getFullYear()}-XXXX`} className="mt-1 bg-muted/50" />
            </div>
            <div>
              <Label>Requisition Ref</Label>
              <Input
                disabled
                value={selectedReq?.id ?? "— Direct PO —"}
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
                {vendors.map(v => <option key={v.id} value={v.name}>{v.name} ({v.category})</option>)}
              </select>
            </div>
            <div>
              <Label>Delivery Date</Label>
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
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
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
