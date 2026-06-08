import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, PackageCheck, ClipboardCheck, AlertOctagon, Truck, X } from "lucide-react";
import { receiveItems } from "@/lib/sample-data";
import { KpiCard } from "@/components/common/KpiCard";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useWorkflow, type WfGRN, type WfGRNLine } from "@/lib/workflow-store";
import { LocationPicker, LocationFilter, LocationCell } from "@/components/common/LocationPicker";

type SeedGRN = (typeof receiveItems)[number];

type GRNRow = {
  id: string;
  po: string;
  vendor: string;
  item: string;
  qty: number;
  uom: string;
  temp: string;
  expiry: string;
  receivedBy: string;
  status: string;
  officeId?: string;
  warehouseId?: string;
};

// GRN form line state
type FormLine = {
  id: string;
  name: string;
  qty: number;
  uom: string;
  temp: string;
  expiry: string;
  qcStatus: "Accepted" | "On Hold" | "Rejected";
};

function seedToRow(s: SeedGRN): GRNRow {
  return {
    id: s.id, po: s.po, vendor: s.vendor, item: s.item,
    qty: s.qty, uom: s.uom, temp: s.temp, expiry: s.expiry,
    receivedBy: s.receivedBy, status: s.status,
    // Backfill seed GRNs to default Office + Warehouse so reports stay consistent
    officeId: "OFF-001", warehouseId: "WH-001",
  };
}

function wfGRNToRows(grn: WfGRN): GRNRow[] {
  return grn.lines.map((l, i) => ({
    id: `${grn.id}-L${i + 1}`,
    po: grn.poRef,
    vendor: grn.vendor,
    item: l.name,
    qty: l.qty,
    uom: l.uom,
    temp: l.temp,
    expiry: l.expiry,
    receivedBy: grn.receivedBy,
    status: l.qcStatus,
    officeId: grn.officeId,
    warehouseId: grn.warehouseId,
  }));
}

export default function ReceiveItem() {
  const wf = useWorkflow();
  const { wfPurchaseOrders, wfRequisitions, demands, addGRN, updateDemandStatus, grns } = wf;

  const [grnOpen, setGrnOpen] = useState(false);
  const [selectedPORef, setSelectedPORef] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [grnOfficeId, setGrnOfficeId] = useState("OFF-001");
  const [grnWarehouseId, setGrnWarehouseId] = useState("WH-001");
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [formLines, setFormLines] = useState<FormLine[]>([{ id: "l0", name: "", qty: 1, uom: "Kg", temp: "", expiry: "", qcStatus: "Accepted" }]);

  // Selectable POs (not closed/delivered)
  const selectablePOs = useMemo(
    () => wfPurchaseOrders.filter(p => !["Closed", "Draft", "Rejected"].includes(p.status)),
    [wfPurchaseOrders]
  );

  const selectedPO = useMemo(
    () => wfPurchaseOrders.find(p => p.id === selectedPORef),
    [wfPurchaseOrders, selectedPORef]
  );

  // When PO is selected, pre-fill lines from its line items.
  const handleSelectPO = (poId: string) => {
    setSelectedPORef(poId);
    if (!poId) {
      setFormLines([{ id: "l0", name: "", qty: 1, uom: "Kg", temp: "", expiry: "", qcStatus: "Accepted" }]);
      return;
    }
    const po = wfPurchaseOrders.find(p => p.id === poId);
    if (po) {
      // Inherit Office + Warehouse from PO if set
      if (po.officeId) setGrnOfficeId(po.officeId);
      if (po.warehouseId) setGrnWarehouseId(po.warehouseId);
    }
    if (po?.lineItems && po.lineItems.length > 0) {
      setFormLines(po.lineItems.map((l, i) => ({
        id: `l${i}`,
        name: l.name,
        qty: l.qty,
        uom: l.uom,
        temp: "",
        expiry: "",
        qcStatus: "Accepted",
      })));
      toast.success(`${po.lineItems.length} item${po.lineItems.length === 1 ? "" : "s"} loaded from ${po.id}.`);
    } else {
      // PO without line items — start a clean single empty row.
      setFormLines([{ id: "l0", name: "", qty: 1, uom: "Kg", temp: "", expiry: "", qcStatus: "Accepted" }]);
      toast.info(`${po?.id ?? poId} has no item details. Add rows manually.`);
    }
  };

  const addLine = () => {
    setFormLines(prev => [...prev, { id: `l${Date.now()}`, name: "", qty: 1, uom: "Kg", temp: "", expiry: "", qcStatus: "Accepted" }]);
  };

  const removeLine = (id: string) => setFormLines(prev => prev.filter(l => l.id !== id));

  const updateLine = <K extends keyof FormLine>(id: string, field: K, value: FormLine[K]) => {
    setFormLines(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const saveGRN = () => {
    if (!selectedPORef) { toast.error("Please select a PO."); return; }
    if (!receivedBy.trim()) { toast.error("Received By is required."); return; }
    if (!grnOfficeId) { toast.error("Office is required."); return; }
    if (!grnWarehouseId) { toast.error("Warehouse is required."); return; }
    if (formLines.some(l => !l.name.trim())) { toast.error("All item rows must have an item name."); return; }

    const grnId = `GRN-${Date.now().toString().slice(-5)}`;
    const lines: WfGRNLine[] = formLines.map(l => ({
      itemId: l.id,
      name: l.name,
      qty: l.qty,
      uom: l.uom,
      temp: l.temp,
      expiry: l.expiry,
      qcStatus: l.qcStatus,
    }));

    // Find linked demand via PO → Requisition → Demand chain
    const req = wfRequisitions.find(r => r.id === selectedPO?.requisitionRef);
    const linkedDemand = req ? demands.find(d => d.id === req.demandRef) : undefined;

    const grn: WfGRN = {
      id: grnId,
      poRef: selectedPORef,
      vendor: selectedPO?.vendor ?? "Unknown",
      receivedBy,
      date: new Date().toLocaleString(),
      lines,
      linkedDemandRef: linkedDemand?.id,
      officeId: grnOfficeId,
      warehouseId: grnWarehouseId,
    };

    addGRN(grn);

    // The GRN itself is the purchase's stock-IN source — the Stock Overview
    // ledger reads accepted GRN lines directly (see lib/stock-ledger.ts), so we
    // no longer push a separate stockDelta here (that would double-count the
    // receipt as both a GRN line and a loose delta).
    const acceptedCount = lines.filter(l => l.qcStatus === "Accepted").length;

    // Fulfill the linked demand
    if (linkedDemand) {
      updateDemandStatus(linkedDemand.id, "Fulfilled", { grnRef: grnId });
      toast.success(`GRN ${grnId} saved. Demand ${linkedDemand.id} fulfilled. Stock updated. Kitchen notified.`);
    } else {
      toast.success(`GRN ${grnId} saved. Stock updated for ${acceptedCount} accepted item(s).`);
    }

    // Reset form
    setGrnOpen(false);
    setSelectedPORef("");
    setReceivedBy("");
    setFormLines([{ id: "l0", name: "", qty: 1, uom: "Kg", temp: "", expiry: "", qcStatus: "Accepted" }]);
  };

  // Build display rows from seed + workflow GRNs
  const allRows: GRNRow[] = useMemo(() => [
    ...grns.flatMap(wfGRNToRows),
    ...receiveItems.map(seedToRow),
  ], [grns]);

  const filteredRows = allRows.filter((r) => {
    if (filterOffice && r.officeId !== filterOffice) return false;
    if (filterWarehouse && r.warehouseId !== filterWarehouse) return false;
    return true;
  });

  const cols: Column<GRNRow>[] = [
    { key: "id", header: "GRN #" },
    { key: "po", header: "PO Ref" },
    { key: "vendor", header: "Vendor" },
    {
      key: "officeId" as keyof GRNRow, header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    { key: "item", header: "Item" },
    { key: "qty", header: "Qty" },
    { key: "uom", header: "UOM" },
    { key: "temp", header: "Temp °C" },
    { key: "expiry", header: "Expiry" },
    { key: "receivedBy", header: "Received By" },
    {
      key: "status", header: "QC Status", render: (r) => {
        const cls =
          r.status === "Accepted" ? "bg-green-600 text-white" :
          r.status === "Rejected" ? "bg-red-600 text-white" :
          r.status === "On Hold" ? "bg-amber-400 text-white" :
          "bg-muted text-foreground";
        return <span className={`px-3 py-1 rounded-full text-xs font-semibold ${cls}`}>{r.status}</span>;
      },
    },
  ];

  const accepted = allRows.filter(r => r.status === "Accepted").length;
  const onHold = allRows.filter(r => r.status === "On Hold").length;
  const rejected = allRows.filter(r => r.status === "Rejected").length;

  return (
    <>
      <PageHeader
        title="Receive Items — Inbound GRN"
        subtitle="Goods Receipt Note — inspect and accept inbound vendor deliveries into the store"
        actions={<Button onClick={() => setGrnOpen(true)}><Plus className="h-4 w-4 mr-1" /> New GRN</Button>}
      />
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Receipts Today" value={allRows.length} icon={Truck} tone="navy" />
        <KpiCard label="Accepted" value={accepted} icon={PackageCheck} tone="success" />
        <KpiCard label="On Hold" value={onHold} icon={ClipboardCheck} tone="warning" />
        <KpiCard label="Rejected" value={rejected} icon={AlertOctagon} tone="red" />
      </div>
      <div className="mb-4">
        <LocationFilter
          officeId={filterOffice}
          warehouseId={filterWarehouse}
          onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
        />
      </div>
      <DataTable
        title="receive-item"
        data={filteredRows}
        columns={cols}
        searchKeys={["id", "po", "vendor", "item", "status"]}
        selectable={false}
        actions={(r) => <RowActions row={r} actions={["view", "print"]} />}
      />

      {/* New GRN Dialog */}
      <Dialog open={grnOpen} onOpenChange={setGrnOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Goods Receipt Note (GRN)</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>PO Reference *</Label>
              <select
                value={selectedPORef}
                onChange={(e) => handleSelectPO(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a PO...</option>
                {selectablePOs.map(po => (
                  <option key={po.id} value={po.id}>
                    {po.id} — {po.vendor} ({po.status})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Vendor (auto-filled)</Label>
              <Input disabled value={selectedPO?.vendor ?? ""} className="mt-1 bg-muted/50" placeholder="Select PO first" />
            </div>
            <div className="col-span-2">
              <Label>Received By *</Label>
              <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className="mt-1" placeholder="Name of person receiving" />
            </div>
            <LocationPicker
              officeId={grnOfficeId}
              warehouseId={grnWarehouseId}
              onChange={(n) => { setGrnOfficeId(n.officeId); setGrnWarehouseId(n.warehouseId); }}
            />
          </div>

          {/* Line items */}
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <Label>Items Received</Label>
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
              </Button>
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-semibold">Item</th>
                    <th className="p-2 text-left font-semibold w-20">Qty</th>
                    <th className="p-2 text-left font-semibold w-16">UOM</th>
                    <th className="p-2 text-left font-semibold w-24">Temp °C</th>
                    <th className="p-2 text-left font-semibold w-28">Expiry</th>
                    <th className="p-2 text-left font-semibold w-28">QC Status</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {formLines.map(line => (
                    <tr key={line.id} className="border-t border-border/50">
                      <td className="p-2">
                        <Input
                          value={line.name}
                          onChange={(e) => updateLine(line.id, "name", e.target.value)}
                          className="h-7 text-xs"
                          placeholder="Item name"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number" min={0}
                          value={line.qty}
                          onChange={(e) => updateLine(line.id, "qty", Number(e.target.value))}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={line.uom}
                          onChange={(e) => updateLine(line.id, "uom", e.target.value)}
                          className="h-7 text-xs w-16"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={line.temp}
                          onChange={(e) => updateLine(line.id, "temp", e.target.value)}
                          className="h-7 text-xs"
                          placeholder="e.g. 4°C"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="date"
                          value={line.expiry}
                          onChange={(e) => updateLine(line.id, "expiry", e.target.value)}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={line.qcStatus}
                          onChange={(e) => updateLine(line.id, "qcStatus", e.target.value as FormLine["qcStatus"])}
                          className="h-7 text-xs rounded border border-input bg-background px-2 w-full"
                        >
                          <option>Accepted</option>
                          <option>On Hold</option>
                          <option>Rejected</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <button type="button" onClick={() => removeLine(line.id)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Accepted items will increment Stock Overview. Demand linked to this PO will be marked Fulfilled and Kitchen notified.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGrnOpen(false)}>Cancel</Button>
            <Button onClick={saveGRN}>Save GRN</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
