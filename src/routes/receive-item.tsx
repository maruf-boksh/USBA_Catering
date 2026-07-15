import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { flagArrival, useArrivalFlash } from "@/lib/arrival-flash";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, PackageCheck, ClipboardCheck, AlertOctagon, Truck, X, Zap, BarChart2, Eye, Ban, ClipboardList } from "lucide-react";
import { receiveItems, vendors, activeItems, inventory } from "@/lib/sample-data";
import { applyReceiptToPR, getPurchaseRequisitions, prReceived } from "@/lib/purchase-requisitions";
import { roundQty } from "@/lib/num";
import { KpiCard } from "@/components/common/KpiCard";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useWorkflow, type WfGRN, type WfGRNLine, type WfPurchaseOrder, type WfPOLineItem, type WfPOStatus } from "@/lib/workflow-store";
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
  rate: number;
  /** Ordered qty carried from the PO line (read-only reference on the GRN). */
  orderedQty?: number;
  /** Supplier batch / lot number for this received line. */
  batchNo?: string;
  /** Set when this line was prefilled from a Purchase Requisition shortfall —
   *  the PR line id to write the received qty back to on save. */
  prLineId?: string;
};

// Store/receiving personnel who can sign for an inbound delivery.
const RECEIVERS = ["M. Karim", "S. Ahmed", "F. Begum", "K. Rahman", "N. Islam"];

// Statuses shown on the Purchase Orders tab: still-receivable POs plus the
// close-approval states so a requested/closed PO stays visible with its status.
const PO_TAB_STATUSES: WfPOStatus[] = ["Approved", "Partially Received", "Close Requested", "Closed"];

// Colour scheme for a PO's status pill on the Receive Items PO tab.
function poStatusClass(status: WfPOStatus): string {
  switch (status) {
    case "Partially Received": return "bg-amber-500 text-white";
    case "Close Requested":    return "bg-orange-500 text-white";
    case "Closed":             return "bg-slate-500 text-white";
    default:                   return "bg-blue-600 text-white";
  }
}

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

/**
 * Resolve a GRN row to the matching inventory item id (INV-####) so the Check
 * Stock deep-link lands on the right Inventory row. Prefers a real INV id already
 * on the row; otherwise matches by item name against the inventory master.
 * (Runtime GRN lines carry a form-line id, and seed GRNs carry none, so a name
 * match is the reliable fallback.)
 */
function resolveInventoryId(r: GRNRow): string {
  if (r.inventoryId && inventory.some((i) => i.id === r.inventoryId)) return r.inventoryId;
  const byName = inventory.find((i) => i.name.toLowerCase() === r.item.trim().toLowerCase());
  return byName?.id ?? r.inventoryId ?? r.item;
}

type PoReceiptLine = WfPOLineItem & { received: number; remaining: number };

/**
 * How much of a PO has been received so far, derived from the GRNs raised against
 * it (matched by item name — GRN lines inherit their name from the PO line).
 * Drives the PO tab's Ordered/Received figures and the Approved → Partially
 * Received → Received status transitions.
 */
function poReceipt(po: WfPurchaseOrder, grns: WfGRN[]): {
  lines: PoReceiptLine[]; ordered: number; received: number; fully: boolean; anyReceived: boolean;
} {
  const recByName = new Map<string, number>();
  for (const g of grns) {
    if (g.poRef !== po.id) continue;
    for (const l of g.lines) {
      const k = l.name.trim().toLowerCase();
      recByName.set(k, (recByName.get(k) ?? 0) + (Number(l.qty) || 0));
    }
  }
  const lines: PoReceiptLine[] = (po.lineItems ?? []).map((li) => {
    const received = roundQty(recByName.get(li.name.trim().toLowerCase()) ?? 0);
    return { ...li, received, remaining: Math.max(roundQty(li.qty - received), 0) };
  });
  const ordered = roundQty(lines.reduce((s, l) => s + l.qty, 0));
  const received = roundQty(lines.reduce((s, l) => s + Math.min(l.received, l.qty), 0));
  const fully = lines.length > 0 && lines.every((l) => l.received >= l.qty);
  const anyReceived = lines.some((l) => l.received > 0);
  return { lines, ordered, received, fully, anyReceived };
}

export default function ReceiveItem() {
  useArrivalFlash();
  const navigate = useNavigate();
  const wf = useWorkflow();
  const { wfPurchaseOrders, wfRequisitions, demands, addGRN, updateDemandStatus, updatePOStatus, grns } = wf;

  // Receive Items has two tabs: approved POs awaiting receipt, and the recorded
  // GRN receipts. Receiving is launched per-PO from the first tab.
  const [activeTab, setActiveTab] = useState<"po" | "received">("po");
  const [viewPO, setViewPO] = useState<WfPurchaseOrder | null>(null);
  const [grnOpen, setGrnOpen] = useState(false);
  const [selectedPORef, setSelectedPORef] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  // Standard GRN header fields.
  const [grnDate, setGrnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [grnChallanNo, setGrnChallanNo] = useState("");
  const [grnInvoiceNo, setGrnInvoiceNo] = useState("");
  const [grnVehicleNo, setGrnVehicleNo] = useState("");
  const [grnRemarks, setGrnRemarks] = useState("");
  const [grnOfficeId, setGrnOfficeId] = useState("OFF-001");
  const [grnWarehouseId, setGrnWarehouseId] = useState("WH-001");
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [formLines, setFormLines] = useState<FormLine[]>([{ id: "l0", name: "", qty: 1, uom: "Kg", expiry: "", rate: 0 }]);

  // ── Direct Purchase (spot buy — no prior PO) ────────────────────────────────
  const [directOpen, setDirectOpen] = useState(false);
  const [dpVendor, setDpVendor] = useState("");
  const [dpReceivedBy, setDpReceivedBy] = useState("");
  const [dpOfficeId, setDpOfficeId] = useState("OFF-001");
  const [dpWarehouseId, setDpWarehouseId] = useState("WH-001");
  const [dpJustification, setDpJustification] = useState("");
  const [dpInvoiceNo, setDpInvoiceNo] = useState("");
  const [dpDate, setDpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dpChallanNo, setDpChallanNo] = useState("");
  const [dpVehicleNo, setDpVehicleNo] = useState("");
  // Set when the Direct Receive is against a Purchase Requisition — used to write
  // received quantities back to that PR on save (its detail page then reflects them).
  const [dpSourcePrId, setDpSourcePrId] = useState<string | undefined>(undefined);
  // "Receive from PR" toggle + the picked PR id.
  const [dpFromPr, setDpFromPr] = useState(false);
  const [dpPrId, setDpPrId] = useState("");
  const [dpLines, setDpLines] = useState<FormLine[]>([{ id: "d0", name: "", qty: 1, uom: "Kg", expiry: "", rate: 0 }]);

  // Purchase Requisitions that still have outstanding (unreceived) lines — the
  // pickable set for "Receive from PR". Refreshed each time the dialog opens.
  const receivablePRs = useMemo(() => {
    if (!directOpen) return [];
    return getPurchaseRequisitions().filter((pr) => {
      const s = pr.status.toLowerCase();
      if (s === "rejected" || s === "cancelled" || s === "closed") return false;
      return prReceived(pr).remaining > 0;
    });
  }, [directOpen]);

  // Load a PR's outstanding lines into the Direct Receive form (qty defaults to
  // each line's remaining balance; prLineId ties the row back to the PR line).
  const dpSelectPr = (prId: string) => {
    setDpPrId(prId);
    if (!prId) { setDpSourcePrId(undefined); return; }
    const pr = getPurchaseRequisitions().find((p) => p.id === prId);
    if (!pr) return;
    setDpSourcePrId(pr.id);
    setDpOfficeId(pr.officeId || "OFF-001");
    setDpWarehouseId(pr.warehouseId || "WH-001");
    setDpJustification(`Direct receive against Purchase Requisition ${pr.id}.`);
    const outstanding = pr.lines
      .map((l) => ({ l, remaining: Math.max(l.qty - (l.receivedQty ?? 0), 0) }))
      .filter((x) => x.remaining > 0);
    setDpLines(
      outstanding.length > 0
        ? outstanding.map(({ l, remaining }, i) => ({
            id: `d${i + 1}`, name: l.itemName, qty: remaining, uom: l.uom,
            expiry: "", rate: l.rate || 0, prLineId: l.id,
          }))
        : [{ id: "d0", name: "", qty: 1, uom: "Kg", expiry: "", rate: 0 }],
    );
  };

  // Toggle the "Receive from PR" mode; clears the PR link and lines when turned off.
  const dpToggleFromPr = (on: boolean) => {
    setDpFromPr(on);
    if (!on) {
      setDpPrId("");
      setDpSourcePrId(undefined);
      setDpJustification("");
      setDpLines([{ id: "d0", name: "", qty: 1, uom: "Kg", expiry: "", rate: 0 }]);
    }
  };

  // Purchase totals for the direct-receive lines.
  const dpLineTotal = (l: FormLine) => roundQty((Number(l.qty) || 0) * (Number(l.rate) || 0), 2);
  const dpGrandTotal = roundQty(dpLines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0), 2);
  const fmtBdt = (n: number) => `৳ ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const dpAddLine = () =>
    setDpLines(prev => [...prev, { id: `d${Date.now()}`, name: "", qty: 1, uom: "Kg", expiry: "", rate: 0 }]);
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
    setDpJustification(""); setDpInvoiceNo(""); setDpSourcePrId(undefined);
    setDpFromPr(false); setDpPrId("");
    setDpDate(new Date().toISOString().slice(0, 10)); setDpChallanNo(""); setDpVehicleNo("");
    setDpLines([{ id: "d0", name: "", qty: 1, uom: "Kg", expiry: "", rate: 0 }]);
  };

  // Auto-open the Direct Receive dialog pre-filled when navigated here from a
  // Demand Request's shortfall table (stashes a payload in sessionStorage).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("direct-receive-prefill");
      if (!raw) return;
      sessionStorage.removeItem("direct-receive-prefill");
      const p = JSON.parse(raw) as {
        source?: string; prId?: string; justification?: string; officeId?: string; warehouseId?: string;
        lines?: { name: string; qty: number; uom?: string; prLineId?: string }[];
      };
      if (p.officeId) setDpOfficeId(p.officeId);
      if (p.warehouseId) setDpWarehouseId(p.warehouseId);
      if (p.justification) setDpJustification(p.justification);
      if (p.prId) setDpSourcePrId(p.prId);
      if (p.lines?.length) {
        setDpLines(p.lines.map((l, i) => ({
          id: `d${i + 1}`, name: l.name, qty: l.qty, uom: l.uom ?? "Kg", expiry: "", rate: 0,
          prLineId: l.prLineId,
        })));
      }
      setDirectOpen(true);
      toast.info(
        p.source
          ? `Direct Receive pre-filled from ${p.source} — ${p.lines?.length ?? 0} item(s). Add vendor & receiver to record.`
          : `Direct Receive pre-filled — add vendor & receiver to record.`,
      );
    } catch {
      /* malformed payload — ignore */
    }
  }, []);

  // Record a direct purchase as a GRN (no PO). Like any receipt, its lines start
  // "Pending" and flow through Quality Control → Stock Overview — the standard
  // process — but the PO Ref is a generated DP reference marking it as direct.
  const saveDirect = () => {
    if (!dpVendor) { toast.error("Select a vendor."); return; }
    if (!dpDate) { toast.error("Receipt date is required."); return; }
    if (!dpReceivedBy) { toast.error("Received By is required."); return; }
    if (!dpWarehouseId) { toast.error("Warehouse is required."); return; }
    if (!dpJustification.trim()) { toast.error("A justification is required for a direct receive."); return; }
    if (dpLines.some(l => !l.name.trim())) { toast.error("All item rows must have an item name."); return; }
    if (dpLines.some(l => (Number(l.qty) || 0) <= 0)) { toast.error("Every item needs a quantity greater than zero."); return; }
    if (dpLines.some(l => (Number(l.rate) || 0) <= 0)) { toast.error("Every item needs a purchase rate greater than zero."); return; }

    const stamp = Date.now().toString().slice(-5);
    const grnId = `GRN-${stamp}`;
    const dpRef = `DP-${new Date().getFullYear()}-${stamp}`;
    const lines: WfGRNLine[] = dpLines.map(l => ({
      itemId: l.id, name: l.name, qty: l.qty, uom: l.uom, temp: "", expiry: l.expiry, qcStatus: "Pending",
      batchNo: l.batchNo?.trim() || undefined,
      rate: Number(l.rate) || 0,
    }));
    addGRN({
      id: grnId,
      poRef: dpRef,
      vendor: dpVendor,
      receivedBy: dpReceivedBy,
      date: new Date().toLocaleString(),
      grnDate: dpDate,
      challanNo: dpChallanNo.trim() || undefined,
      vehicleNo: dpVehicleNo.trim() || undefined,
      lines,
      officeId: dpOfficeId,
      warehouseId: dpWarehouseId,
      direct: true,
      note: dpJustification.trim(),
      invoiceNo: dpInvoiceNo.trim() || undefined,
      amount: dpGrandTotal,
    });
    // If this direct receive answers a Purchase Requisition shortfall, write the
    // received quantities back to the PR so its procurement stage updates live.
    if (dpSourcePrId) {
      const receipts = dpLines
        .filter((l) => l.prLineId)
        .map((l) => ({ lineId: l.prLineId as string, qty: Number(l.qty) || 0 }));
      if (receipts.length) applyReceiptToPR(dpSourcePrId, receipts);
    }

    toast.success(
      dpSourcePrId
        ? `Direct receive ${dpRef} recorded — ${lines.length} line(s), ${fmtBdt(dpGrandTotal)} — sent to Quality Control. ${dpSourcePrId} updated.`
        : `Direct receive ${dpRef} recorded — ${lines.length} line(s), ${fmtBdt(dpGrandTotal)} — sent to Quality Control.`,
    );
    setDirectOpen(false);
    resetDirect();
  };

  // Approved POs — plus partially-received ones still awaiting their balance —
  // are the receivable set.
  const selectablePOs = useMemo(
    () => wfPurchaseOrders.filter(p => p.status === "Approved" || p.status === "Partially Received"),
    [wfPurchaseOrders]
  );

  const selectedPO = useMemo(
    () => wfPurchaseOrders.find(p => p.id === selectedPORef),
    [wfPurchaseOrders, selectedPORef]
  );

  // When a PO is selected, pre-fill lines from its items. Received qty defaults to
  // the OUTSTANDING balance (ordered − already received) so a fresh PO fills to its
  // full order and a partial one fills to just its remainder.
  const handleSelectPO = (poId: string) => {
    setSelectedPORef(poId);
    if (!poId) {
      setFormLines([{ id: "l0", name: "", qty: 1, uom: "Kg", expiry: "", rate: 0 }]);
      return;
    }
    const po = wfPurchaseOrders.find(p => p.id === poId);
    if (!po) return;
    // Inherit Office + Warehouse from PO if set
    if (po.officeId) setGrnOfficeId(po.officeId);
    if (po.warehouseId) setGrnWarehouseId(po.warehouseId);
    const r = poReceipt(po, grns);
    if (r.lines.length > 0) {
      setFormLines(r.lines.map((l, i) => ({
        id: `l${i}`,
        name: l.name,
        qty: l.remaining,
        orderedQty: l.qty,
        uom: l.uom,
        expiry: "",
        rate: l.unitPrice ?? 0,
        batchNo: "",
      })));
      toast.success(`${r.lines.length} item${r.lines.length === 1 ? "" : "s"} loaded from ${po.id}.`);
    } else {
      // PO without line items — start a clean single empty row.
      setFormLines([{ id: "l0", name: "", qty: 1, uom: "Kg", expiry: "", rate: 0 }]);
      toast.info(`${po.id} has no item details. Add rows manually.`);
    }
  };

  // Launch the GRN form for a PO row (Receive action on the PO tab).
  const handleReceivePO = (po: WfPurchaseOrder) => {
    setReceivedBy("");
    setGrnDate(new Date().toISOString().slice(0, 10));
    setGrnChallanNo(""); setGrnInvoiceNo(""); setGrnVehicleNo(""); setGrnRemarks("");
    handleSelectPO(po.id);
    setGrnOpen(true);
  };

  // Request to close a PO without receiving the balance (e.g. vendor can't supply
  // the rest). This does NOT close it immediately — it goes to the approval layer;
  // an approver in Approval Management finalises it to Closed.
  const handleRequestClose = (po: WfPurchaseOrder) => {
    if (po.status !== "Approved" && po.status !== "Partially Received") return;
    updatePOStatus(po.id, "Close Requested", { closeRequestedFrom: po.status });
    setViewPO(null);
    toast.success(`${po.id} close requested — sent to Approval Management for sign-off.`);
  };

  const removeLine = (id: string) => setFormLines(prev => prev.filter(l => l.id !== id));

  const updateLine = <K extends keyof FormLine>(id: string, field: K, value: FormLine[K]) => {
    setFormLines(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const saveGRN = () => {
    if (!selectedPORef) { toast.error("Please select a PO."); return; }
    if (!grnDate) { toast.error("GRN date is required."); return; }
    if (!receivedBy.trim()) { toast.error("Received By is required."); return; }
    if (!grnOfficeId) { toast.error("Office is required."); return; }
    if (!grnWarehouseId) { toast.error("Warehouse is required."); return; }
    if (formLines.some(l => !l.name.trim())) { toast.error("All item rows must have an item name."); return; }
    // Only lines with a received qty are recorded (a partial receipt leaves some at 0).
    const receivedLines = formLines.filter(l => (Number(l.qty) || 0) > 0);
    if (receivedLines.length === 0) { toast.error("Enter a received quantity for at least one item."); return; }

    const grnId = `GRN-${Date.now().toString().slice(-5)}`;
    // Received lines start "Pending" — the Quality Control module inspects and
    // accepts/holds/rejects them; only accepted lines post to Stock Overview.
    const lines: WfGRNLine[] = receivedLines.map(l => ({
      itemId: l.id,
      name: l.name,
      qty: l.qty,
      orderedQty: l.orderedQty,
      uom: l.uom,
      temp: "",
      expiry: l.expiry,
      batchNo: l.batchNo?.trim() || undefined,
      qcStatus: "Pending",
      rate: l.rate || undefined,
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
      grnDate,
      challanNo: grnChallanNo.trim() || undefined,
      invoiceNo: grnInvoiceNo.trim() || undefined,
      vehicleNo: grnVehicleNo.trim() || undefined,
      note: grnRemarks.trim() || undefined,
      lines,
      linkedDemandRef: linkedDemand?.id,
      officeId: grnOfficeId,
      warehouseId: grnWarehouseId,
    };

    addGRN(grn);

    // Advance the PO's receipt status: fully covered → Received, otherwise
    // Partially Received (stays on the PO tab so its balance can be received
    // later). Received qtys already booked (grns) plus this GRN's lines.
    if (selectedPO && (selectedPO.status === "Approved" || selectedPO.status === "Partially Received")) {
      const recByName = new Map<string, number>();
      poReceipt(selectedPO, grns).lines.forEach(l => recByName.set(l.name.trim().toLowerCase(), l.received));
      lines.forEach(l => {
        const k = l.name.trim().toLowerCase();
        recByName.set(k, (recByName.get(k) ?? 0) + (Number(l.qty) || 0));
      });
      const poLines = selectedPO.lineItems ?? [];
      const fully = poLines.length > 0 && poLines.every(li => (recByName.get(li.name.trim().toLowerCase()) ?? 0) >= li.qty);
      updatePOStatus(selectedPO.id, fully ? "Received" : "Partially Received");
    }

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
    setGrnDate(new Date().toISOString().slice(0, 10));
    setGrnChallanNo(""); setGrnInvoiceNo(""); setGrnVehicleNo(""); setGrnRemarks("");
    setFormLines([{ id: "l0", name: "", qty: 1, uom: "Kg", expiry: "", rate: 0 }]);
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

  // ── Purchase Orders tab — approved / partially-received POs awaiting receipt ──
  type PORow = {
    id: string; vendor: string; officeId?: string; warehouseId?: string;
    items: number; ordered: number; received: number; status: WfPOStatus; _po: WfPurchaseOrder;
  };
  const poRows: PORow[] = useMemo(() =>
    wfPurchaseOrders
      .filter(p => PO_TAB_STATUSES.includes(p.status))
      .filter(p => (!filterOffice || p.officeId === filterOffice) && (!filterWarehouse || p.warehouseId === filterWarehouse))
      .map(p => {
        const r = poReceipt(p, grns);
        return {
          id: p.id, vendor: p.vendor, officeId: p.officeId, warehouseId: p.warehouseId,
          items: p.lineItems?.length ?? p.items, ordered: r.ordered, received: r.received,
          status: p.status, _po: p,
        };
      }),
    [wfPurchaseOrders, grns, filterOffice, filterWarehouse]);

  const poCols: Column<PORow>[] = [
    { key: "id", header: "PO #" },
    { key: "vendor", header: "Vendor" },
    {
      key: "officeId" as keyof PORow, header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    { key: "items", header: "Items" },
    { key: "ordered", header: "Ordered", render: (r) => <span className="tabular-nums">{r.ordered}</span> },
    { key: "received", header: "Received", render: (r) => <span className="tabular-nums text-green-700">{r.received || 0}</span> },
    {
      key: "status", header: "Status", render: (r) => (
        <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${poStatusClass(r.status)}`}>
          {r.status === "Close Requested" ? "Close Pending" : r.status}
        </span>
      ),
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
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "po" | "received")}>
        <TabsList className="mb-4">
          <TabsTrigger value="po" className="gap-1.5">
            <ClipboardList className="h-4 w-4" /> Purchase Orders ({poRows.length})
          </TabsTrigger>
          <TabsTrigger value="received" className="gap-1.5">
            <PackageCheck className="h-4 w-4" /> Received GRNs ({filteredRows.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1 — Approved / partially-received POs, loaded straight from PO data */}
        <TabsContent value="po">
          <DataTable
            title="receive-po"
            data={poRows}
            columns={poCols}
            searchKeys={["id", "vendor", "status"]}
            selectable={false}
            actions={(r) => {
              const receivable = r.status === "Approved" || r.status === "Partially Received";
              return (
                <div className="flex items-center gap-1">
                  {receivable && (
                    <Button
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => handleReceivePO(r._po)}
                      title="Receive against this PO"
                    >
                      <PackageCheck className="h-3.5 w-3.5" /> Receive
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                    onClick={() => setViewPO(r._po)}
                    title="View PO"
                  >
                    <Eye className="h-3.5 w-3.5" /> View
                  </Button>
                  {receivable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive gap-1"
                      onClick={() => handleRequestClose(r._po)}
                      title="Request to close this PO — needs approval"
                    >
                      <Ban className="h-3.5 w-3.5" /> Close
                    </Button>
                  )}
                  {r.status === "Close Requested" && (
                    <span className="text-xs text-orange-600 font-medium px-2">Awaiting close approval</span>
                  )}
                </div>
              );
            }}
          />
        </TabsContent>

        {/* Tab 2 — recorded GRN receipts */}
        <TabsContent value="received">
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
                    flagArrival({ target: "inv-alerts", ids: [resolveInventoryId(r)] });
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
        </TabsContent>
      </Tabs>

      {/* New GRN Dialog */}
      <Dialog open={grnOpen} onOpenChange={setGrnOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Goods Receipt Note (GRN)</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>GRN No</Label>
              <Input disabled value="Auto-generated on save" className="mt-1 bg-muted/50 text-muted-foreground" />
            </div>
            <div>
              <Label>GRN Date *</Label>
              <Input
                type="date"
                value={grnDate}
                onChange={(e) => setGrnDate(e.target.value)}
                className="mt-1"
              />
            </div>
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
            <div>
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
            <div>
              <Label>Delivery Challan / DO No</Label>
              <Input
                value={grnChallanNo}
                onChange={(e) => setGrnChallanNo(e.target.value)}
                className="mt-1"
                placeholder="Supplier delivery note no"
              />
            </div>
            <LocationPicker
              officeId={grnOfficeId}
              warehouseId={grnWarehouseId}
              onChange={(n) => { setGrnOfficeId(n.officeId); setGrnWarehouseId(n.warehouseId); }}
            />
            <div>
              <Label>Supplier Invoice No</Label>
              <Input
                value={grnInvoiceNo}
                onChange={(e) => setGrnInvoiceNo(e.target.value)}
                className="mt-1"
                placeholder="Invoice / bill reference"
              />
            </div>
            <div>
              <Label>Vehicle / Transport No</Label>
              <Input
                value={grnVehicleNo}
                onChange={(e) => setGrnVehicleNo(e.target.value)}
                className="mt-1"
                placeholder="e.g. Dhaka Metro-Ga-11-2233"
              />
            </div>
            <div className="col-span-2">
              <Label>Remarks</Label>
              <Textarea
                value={grnRemarks}
                onChange={(e) => setGrnRemarks(e.target.value)}
                rows={2}
                className="mt-1"
                placeholder="Condition on receipt, discrepancies, short/damaged items, etc."
              />
            </div>
          </div>

          {/* Line items */}
          <div className="mt-2 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <Label>Items Received</Label>
            </div>
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-sm min-w-[620px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-semibold">Item</th>
                    <th className="p-2 text-left font-semibold w-20">Ordered</th>
                    <th className="p-2 text-left font-semibold w-20">Received</th>
                    <th className="p-2 text-left font-semibold w-16">UOM</th>
                    <th className="p-2 text-left font-semibold w-32">Batch / Lot</th>
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
                          value={line.orderedQty ?? "—"}
                          readOnly
                          tabIndex={-1}
                          className="h-7 text-xs w-16 bg-muted/50 text-muted-foreground cursor-default text-right tabular-nums"
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
                          value={line.batchNo ?? ""}
                          onChange={(e) => updateLine(line.id, "batchNo", e.target.value)}
                          className="h-7 text-xs"
                          placeholder="Batch / lot"
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" /> Direct Receive — Spot Buy
            </DialogTitle>
          </DialogHeader>

          {/* Receive from PR — load a requisition's outstanding lines instead of keying them in */}
          <div className="rounded-md border border-border bg-muted/30 p-3 mb-1">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
              <input
                type="checkbox"
                checked={dpFromPr}
                onChange={(e) => dpToggleFromPr(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Receive from PR
            </label>
            {dpFromPr && (
              <div className="mt-2">
                <Label>Purchase Requisition</Label>
                <select
                  value={dpPrId}
                  onChange={(e) => dpSelectPr(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select a PR…</option>
                  {receivablePRs.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.id} — {pr.requestedBy} ({prReceived(pr).remaining} pending)
                    </option>
                  ))}
                </select>
                {dpPrId && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Items loaded from {dpPrId} — adjust quantities below. Received amounts post back to the PR's detail page.
                  </p>
                )}
                {receivablePRs.length === 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">No requisitions with outstanding items.</p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Receipt Date *</Label>
              <Input
                type="date"
                value={dpDate}
                onChange={(e) => setDpDate(e.target.value)}
                className="mt-1"
              />
            </div>
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
            <div>
              <Label>Delivery Challan / DO No</Label>
              <Input
                value={dpChallanNo}
                onChange={(e) => setDpChallanNo(e.target.value)}
                className="mt-1"
                placeholder="Supplier delivery note no"
              />
            </div>
            <LocationPicker
              officeId={dpOfficeId}
              warehouseId={dpWarehouseId}
              onChange={(n) => { setDpOfficeId(n.officeId); setDpWarehouseId(n.warehouseId); }}
            />
            <div>
              <Label>Invoice / Bill No</Label>
              <Input
                value={dpInvoiceNo}
                onChange={(e) => setDpInvoiceNo(e.target.value)}
                className="mt-1"
                placeholder="Supplier invoice / bill reference"
              />
            </div>
            <div>
              <Label>Vehicle / Transport No</Label>
              <Input
                value={dpVehicleNo}
                onChange={(e) => setDpVehicleNo(e.target.value)}
                className="mt-1"
                placeholder="e.g. Dhaka Metro-Ga-11-2233"
              />
            </div>
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
          <div className="mt-2 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <Label>Items Received</Label>
              <Button size="sm" variant="outline" onClick={dpAddLine}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
              </Button>
            </div>
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-sm min-w-[740px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-semibold">Item</th>
                    <th className="p-2 text-left font-semibold w-20">Qty</th>
                    <th className="p-2 text-left font-semibold w-16">UOM</th>
                    <th className="p-2 text-right font-semibold w-24">Rate</th>
                    <th className="p-2 text-right font-semibold w-28">Total</th>
                    <th className="p-2 text-left font-semibold w-32">Batch / Lot</th>
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
                          {line.name && !dpItemOptions.some((it) => it.name === line.name) && (
                            <option value={line.name}>{line.name}</option>
                          )}
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
                          className="h-7 text-xs w-14 bg-muted/50 text-muted-foreground cursor-default"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number" min={0} step="any"
                          value={line.rate || ""}
                          placeholder="0.00"
                          onChange={(e) => dpUpdateLine(line.id, "rate", Number(e.target.value))}
                          className="h-7 text-xs text-right tabular-nums"
                        />
                      </td>
                      <td className="p-2 text-right text-xs font-medium tabular-nums whitespace-nowrap">
                        {fmtBdt(dpLineTotal(line))}
                      </td>
                      <td className="p-2">
                        <Input
                          value={line.batchNo ?? ""}
                          onChange={(e) => dpUpdateLine(line.id, "batchNo", e.target.value)}
                          className="h-7 text-xs"
                          placeholder="Batch / lot"
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
                <tfoot className="border-t border-border bg-muted/30">
                  <tr>
                    <td className="p-2 text-xs font-semibold text-muted-foreground" colSpan={4}>
                      Grand Total ({dpLines.length} item{dpLines.length === 1 ? "" : "s"})
                    </td>
                    <td className="p-2 text-right text-sm font-bold tabular-nums whitespace-nowrap">
                      {fmtBdt(dpGrandTotal)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
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

      {/* View PO — read-only, with receipt progress per line */}
      <Dialog open={!!viewPO} onOpenChange={(v) => !v && setViewPO(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Purchase Order
              {viewPO && <span className="font-mono text-sm text-muted-foreground ml-2">— {viewPO.id}</span>}
            </DialogTitle>
          </DialogHeader>
          {viewPO && (() => {
            const r = poReceipt(viewPO, grns);
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Vendor</div>
                    <div className="mt-1 font-medium">{viewPO.vendor}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Date</div>
                    <div className="mt-1">{viewPO.date}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Office / Warehouse</div>
                    <div className="mt-1"><LocationCell officeId={viewPO.officeId} warehouseId={viewPO.warehouseId} /></div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</div>
                    <div className="mt-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${poStatusClass(viewPO.status)}`}>
                        {viewPO.status === "Close Requested" ? "Close Pending" : viewPO.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border overflow-x-auto">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="p-2 font-semibold">Item</th>
                        <th className="p-2 font-semibold w-16">UOM</th>
                        <th className="p-2 font-semibold w-24 text-right">Ordered</th>
                        <th className="p-2 font-semibold w-24 text-right">Received</th>
                        <th className="p-2 font-semibold w-24 text-right">Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.lines.length === 0 ? (
                        <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">No line items on this PO.</td></tr>
                      ) : r.lines.map((l) => (
                        <tr key={l.itemId + l.name} className="border-t border-border/50">
                          <td className="p-2 font-medium">{l.name}</td>
                          <td className="p-2 text-muted-foreground">{l.uom}</td>
                          <td className="p-2 text-right tabular-nums">{l.qty}</td>
                          <td className="p-2 text-right tabular-nums text-green-700">{l.received}</td>
                          <td className={`p-2 text-right tabular-nums ${l.remaining > 0 ? "text-amber-700 font-medium" : "text-muted-foreground"}`}>{l.remaining}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            {viewPO && (viewPO.status === "Approved" || viewPO.status === "Partially Received") && (
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => handleRequestClose(viewPO)}>
                <Ban className="h-4 w-4 mr-1.5" /> Close
              </Button>
            )}
            {viewPO?.status === "Close Requested" && (
              <span className="mr-auto self-center text-xs text-orange-600 font-medium">Awaiting close approval</span>
            )}
            {viewPO && (viewPO.status === "Approved" || viewPO.status === "Partially Received") && (
              <Button onClick={() => { const po = viewPO; setViewPO(null); handleReceivePO(po); }}>
                <PackageCheck className="h-4 w-4 mr-1.5" /> Receive
              </Button>
            )}
            <Button variant="outline" onClick={() => setViewPO(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
