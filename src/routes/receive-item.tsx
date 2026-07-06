import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { flagArrival, useArrivalFlash } from "@/lib/arrival-flash";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, PackageCheck, ClipboardCheck, AlertOctagon, Truck, X, Zap, BarChart2 } from "lucide-react";
import { receiveItems, vendors, activeItems } from "@/lib/sample-data";
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
  inventoryId?: string;
};

// GRN form line state. QC outcome is NOT set here — received lines start
// "Pending" and are inspected in the Quality Control module.
type FormLine = {
  id: string;
  name: string;
  qty: number;
  uom: string;
  expiry: string;
};

// Store/receiving personnel who can sign for an inbound delivery.
const RECEIVERS = ["M. Karim", "S. Ahmed", "F. Begum", "K. Rahman", "N. Islam"];

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
    inventoryId: l.itemId,
  }));
}

export default function ReceiveItem() {
  useArrivalFlash();
  const navigate = useNavigate();
  const wf = useWorkflow();
  const { wfPurchaseOrders, wfRequisitions, demands, addGRN, updateDemandStatus, grns } = wf;

  const [grnOpen, setGrnOpen] = useState(false);
  const [selectedPORef, setSelectedPORef] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [grnOfficeId, setGrnOfficeId] = useState("OFF-001");
  const [grnWarehouseId, setGrnWarehouseId] = useState("WH-001");
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [formLines, setFormLines] = useState<FormLine[]>([{ id: "l0", name: "", qty: 1, uom: "Kg", expiry: "" }]);

  // ── Direct Purchase (spot buy — no prior PO) ────────────────────────────────
  const [directOpen, setDirectOpen] = useState(false);
  const [dpVendor, setDpVendor] = useState("");
  const [dpReceivedBy, setDpReceivedBy] = useState("");
  const [dpOfficeId, setDpOfficeId] = useState("OFF-001");
  const [dpWarehouseId, setDpWarehouseId] = useState("WH-001");
  const [dpJustification, setDpJustification] = useState("");
  const [dpLines, setDpLines] = useState<FormLine[]>([{ id: "d0", name: "", qty: 1, uom: "Kg", expiry: "" }]);

  const dpAddLine = () =>
    setDpLines(prev => [...prev, { id: `d${Date.now()}`, name: "", qty: 1, uom: "Kg", expiry: "" }]);
  const dpRemoveLine = (id: string) => setDpLines(prev => prev.filter(l => l.id !== id));
  const dpUpdateLine = <K extends keyof FormLine>(id: string, field: K, value: FormLine[K]) =>
    setDpLines(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  // Item comes from the item master; UOM auto-fills from it (read-only).
  const dpItemOptions = useMemo(() => activeItems.slice(0, 120), []);
  const dpPickItem = (id: string, itemName: string) => {
    const it = dpItemOptions.find(i => i.name === itemName);
    setDpLines(prev => prev.map(l => l.id === id ? { ...l, name: itemName, uom: it?.uom ?? l.uom } : l));
  };

  const resetDirect = () => {
    setDpVendor(""); setDpReceivedBy(""); setDpOfficeId("OFF-001"); setDpWarehouseId("WH-001");
    setDpJustification(""); setDpLines([{ id: "d0", name: "", qty: 1, uom: "Kg", expiry: "" }]);
  };

  // Record a direct purchase as a GRN (no PO). Like any receipt, its lines start
  // "Pending" and flow through Quality Control → Stock Overview — the standard
  // process — but the PO Ref is a generated DP reference marking it as direct.
  const saveDirect = () => {
    if (!dpVendor) { toast.error("Select a vendor."); return; }
    if (!dpReceivedBy) { toast.error("Received By is required."); return; }
    if (!dpWarehouseId) { toast.error("Warehouse is required."); return; }
    if (!dpJustification.trim()) { toast.error("A justification is required for a direct receive."); return; }
    if (dpLines.some(l => !l.name.trim())) { toast.error("All item rows must have an item name."); return; }

    const stamp = Date.now().toString().slice(-5);
    const grnId = `GRN-${stamp}`;
    const dpRef = `DP-${new Date().getFullYear()}-${stamp}`;
    const lines: WfGRNLine[] = dpLines.map(l => ({
      itemId: l.id, name: l.name, qty: l.qty, uom: l.uom, temp: "", expiry: l.expiry, qcStatus: "Pending",
    }));
    addGRN({
      id: grnId,
      poRef: dpRef,
      vendor: dpVendor,
      receivedBy: dpReceivedBy,
      date: new Date().toLocaleString(),
      lines,
      officeId: dpOfficeId,
      warehouseId: dpWarehouseId,
      direct: true,
      note: dpJustification.trim(),
    });
    toast.success(`Direct receive ${dpRef} recorded — ${lines.length} line(s) sent to Quality Control.`);
    setDirectOpen(false);
    resetDirect();
  };

  // Only APPROVED POs can be received against.
  const selectablePOs = useMemo(
    () => wfPurchaseOrders.filter(p => p.status === "Approved"),
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
      setFormLines([{ id: "l0", name: "", qty: 1, uom: "Kg", expiry: "" }]);
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
        expiry: "",
      })));
      toast.success(`${po.lineItems.length} item${po.lineItems.length === 1 ? "" : "s"} loaded from ${po.id}.`);
    } else {
      // PO without line items — start a clean single empty row.
      setFormLines([{ id: "l0", name: "", qty: 1, uom: "Kg", expiry: "" }]);
      toast.info(`${po?.id ?? poId} has no item details. Add rows manually.`);
    }
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
    // Received lines start "Pending" — the Quality Control module inspects and
    // accepts/holds/rejects them; only accepted lines post to Stock Overview.
    const lines: WfGRNLine[] = formLines.map(l => ({
      itemId: l.id,
      name: l.name,
      qty: l.qty,
      uom: l.uom,
      temp: "",
      expiry: l.expiry,
      qcStatus: "Pending",
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

    // Stock is NOT posted here — the Stock Overview ledger reads only ACCEPTED
    // GRN lines (see lib/stock-ledger.ts), and acceptance now happens in the
    // Quality Control module. Received lines leave here as "Pending".

    // Fulfill the linked demand — the goods have physically arrived.
    if (linkedDemand) {
      updateDemandStatus(linkedDemand.id, "Fulfilled", { grnRef: grnId });
      toast.success(`GRN ${grnId} saved — ${lines.length} line(s) sent to Quality Control. Demand ${linkedDemand.id} fulfilled.`);
    } else {
      toast.success(`GRN ${grnId} saved — ${lines.length} line(s) sent to Quality Control for inspection.`);
    }

    // Reset form
    setGrnOpen(false);
    setSelectedPORef("");
    setReceivedBy("");
    setFormLines([{ id: "l0", name: "", qty: 1, uom: "Kg", expiry: "" }]);
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
    { key: "expiry", header: "Expiry" },
    { key: "receivedBy", header: "Received By" },
    {
      key: "status", header: "QC Status", render: (r) => {
        const cls =
          r.status === "Accepted" ? "bg-green-600 text-white" :
          r.status === "Rejected" ? "bg-red-600 text-white" :
          r.status === "On Hold" ? "bg-amber-400 text-white" :
          r.status === "Pending" ? "bg-slate-200 text-slate-700" :
          "bg-muted text-foreground";
        return <span className={`px-3 py-1 rounded-full text-xs font-semibold ${cls}`}>{r.status}</span>;
      },
    },
  ];

  const pendingQc = allRows.filter(r => r.status === "Pending").length;
  const accepted = allRows.filter(r => r.status === "Accepted").length;
  const rejected = allRows.filter(r => r.status === "Rejected").length;

  return (
    <>
      <PageHeader
        title="Receive Items — Inbound GRN"
        subtitle="Goods Receipt Note — inspect and accept inbound vendor deliveries into the store"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setDirectOpen(true)}>
              <Zap className="h-4 w-4 mr-1" /> Direct Receive
            </Button>
            <Button onClick={() => setGrnOpen(true)}><Plus className="h-4 w-4 mr-1" /> New GRN</Button>
          </div>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Receipts Today" value={allRows.length} icon={Truck} tone="navy" />
        <KpiCard label="Pending QC" value={pendingQc} icon={ClipboardCheck} tone="warning" />
        <KpiCard label="Accepted" value={accepted} icon={PackageCheck} tone="success" />
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
        actions={(r) => (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
              onClick={() => {
                flagArrival({ target: "inv-alerts", ids: [r.inventoryId ?? r.item] });
                navigate("/inventory");
              }}
              title="Check Stock"
            >
              <BarChart2 className="h-3.5 w-3.5" /> Check Stock
            </Button>
            <RowActions row={r} actions={["view", "print"]} />
          </div>
        )}
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
              <select
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select receiver...</option>
                {RECEIVERS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
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
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-semibold">Item</th>
                    <th className="p-2 text-left font-semibold w-20">Qty</th>
                    <th className="p-2 text-left font-semibold w-16">UOM</th>
                    <th className="p-2 text-left font-semibold w-28">Expiry</th>
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
                          readOnly
                          tabIndex={-1}
                          className="h-7 text-xs w-16 bg-muted/50 text-muted-foreground cursor-default"
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
              Received lines go to <span className="font-medium">Quality Control</span> for inspection — accepted items there increment Stock Overview. Demand linked to this PO will be marked Fulfilled.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGrnOpen(false)}>Cancel</Button>
            <Button onClick={saveGRN}>Save GRN</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Direct Purchase Dialog — spot buy with no prior PO */}
      <Dialog open={directOpen} onOpenChange={(v) => { if (!v) { setDirectOpen(false); resetDirect(); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" /> Direct Receive — Spot Buy
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Vendor *</Label>
              <select
                value={dpVendor}
                onChange={(e) => setDpVendor(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a vendor...</option>
                {vendors.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Received By *</Label>
              <select
                value={dpReceivedBy}
                onChange={(e) => setDpReceivedBy(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select receiver...</option>
                {RECEIVERS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <LocationPicker
              officeId={dpOfficeId}
              warehouseId={dpWarehouseId}
              onChange={(n) => { setDpOfficeId(n.officeId); setDpWarehouseId(n.warehouseId); }}
            />
            <div className="col-span-2">
              <Label>Justification *</Label>
              <Textarea
                value={dpJustification}
                onChange={(e) => setDpJustification(e.target.value)}
                rows={2}
                className="mt-1"
                placeholder="Why this was received directly (urgency, no vendor contract, one-off, etc.)"
              />
            </div>
          </div>

          {/* Line items — entered manually for a direct buy */}
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <Label>Items Received</Label>
              <Button size="sm" variant="outline" onClick={dpAddLine}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
              </Button>
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-semibold">Item</th>
                    <th className="p-2 text-left font-semibold w-20">Qty</th>
                    <th className="p-2 text-left font-semibold w-20">UOM</th>
                    <th className="p-2 text-left font-semibold w-28">Expiry</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {dpLines.map(line => (
                    <tr key={line.id} className="border-t border-border/50">
                      <td className="p-2">
                        <select
                          value={line.name}
                          onChange={(e) => dpPickItem(line.id, e.target.value)}
                          className="w-full h-7 text-xs rounded-md border border-input bg-background px-2"
                        >
                          <option value="">Select item…</option>
                          {dpItemOptions.map((it) => (
                            <option key={it.id} value={it.name}>{it.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <Input
                          type="number" min={0}
                          value={line.qty}
                          onChange={(e) => dpUpdateLine(line.id, "qty", Number(e.target.value))}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={line.uom}
                          readOnly
                          tabIndex={-1}
                          className="h-7 text-xs w-16 bg-muted/50 text-muted-foreground cursor-default"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="date"
                          value={line.expiry}
                          onChange={(e) => dpUpdateLine(line.id, "expiry", e.target.value)}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <button type="button" onClick={() => dpRemoveLine(line.id)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Recorded as a GRN with a <span className="font-medium">DP</span> reference and routed through <span className="font-medium">Quality Control</span> — accepted items increment Stock Overview, same as any receipt.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDirectOpen(false); resetDirect(); }}>Cancel</Button>
            <Button onClick={saveDirect}><Zap className="h-4 w-4 mr-1.5" /> Record Direct Receive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
