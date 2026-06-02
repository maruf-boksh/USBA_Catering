import { createContext, useContext, useState, type ReactNode } from "react";
import { demandRequests as seedDemands, requisitions as seedReqs, purchaseOrders as seedPOs } from "@/lib/sample-data";

// ── Status enums ───────────────────────────────────────────────────────────────
export type WfDemandStatus =
  | "Pending Approval"
  | "Rejected"
  | "Pending Store Review"
  | "Partially Available"
  | "Partially Issued"
  | "Partially Fulfilled"
  | "Escalated to Supply Chain"
  | "Fulfilled";

export type WfReqStatus = "Pending Accounts" | "Approved" | "Rejected";

export type WfPOStatus =
  | "Draft"
  | "Open"
  | "Pending Approval"
  | "Approved"
  | "Rejected"
  | "Ordered"
  | "Delivered"
  | "Closed"
  | "Issued to Vendor";

export type WfTransferStatus = "Pending" | "Issued";

// ── Entity types ───────────────────────────────────────────────────────────────
export type WfDemandItem = { id: string; name: string; qty: number; uom: string; type: string };

export type WfDemandRequest = {
  id: string;
  reference: string;        // PRD-XXXX — the production order that raised this demand
  requestedBy: string;
  role: string;
  date: string;
  status: WfDemandStatus;
  items: WfDemandItem[];
  note: string;
  source: string;           // "Kitchen" | "Store"
  grnRef?: string;          // set when a GRN fulfils this demand
  officeId?: string;
  warehouseId?: string;
  /** When true, approving this demand auto-creates one Transfer Note (in-stock
   *  items) and one Purchase Requisition (shortfalls). Used by the bulk
   *  meal-plan flow that defers fulfillment until the demand is signed off. */
  autoFulfill?: boolean;
  /** Optional approval audit trail set by `updateDemandStatus` callers. */
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
};

export type WfRequisition = {
  id: string;
  reference: string;        // DR-XXXX demand that triggered this
  requestedBy: string;
  source: string;
  date: string;
  status: WfReqStatus;
  items: number;
  note: string;
  demandRef: string;        // WfDemandRequest.id
  demandItems?: WfDemandItem[];
  officeId?: string;
  warehouseId?: string;
};

export type WfPOLineItem = {
  itemId: string;
  name: string;
  qty: number;
  uom: string;
  unitPrice: number;
};

export type WfPurchaseOrder = {
  id: string;
  vendor: string;
  items: number;
  amount: number;
  date: string;
  status: WfPOStatus;
  requisitionRef: string;
  deliveryDate?: string;
  notes?: string;
  issuedToVendor?: boolean;
  lineItems?: WfPOLineItem[];
  rejectionReason?: string;
  officeId?: string;
  warehouseId?: string;
};

export type WfTransferNote = {
  id: string;
  demandRef: string;
  grnRef: string;
  items: { id: string; name: string; qty: number; uom: string }[];
  from: string;
  to: string;
  issuedBy: string;
  date: string;
  status: WfTransferStatus;
  officeId?: string;
  warehouseId?: string;
};

export type WfGRNLine = {
  itemId: string;
  name: string;
  qty: number;
  uom: string;
  temp: string;
  expiry: string;
  qcStatus: "Accepted" | "On Hold" | "Rejected";
};

export type WfGRN = {
  id: string;
  poRef: string;
  vendor: string;
  receivedBy: string;
  date: string;
  lines: WfGRNLine[];
  linkedDemandRef?: string;
  officeId?: string;
  warehouseId?: string;
};

export type StockDelta = { itemId: string; delta: number };

// ── Production Entry workflow ─────────────────────────────────────────────────
export type WfProductionEntryStatus =
  | "Pending"
  | "Approved"
  | "In Preparation"
  | "Ready for QC"
  | "Completed";

export type WfProductionEntry = {
  id: string;
  date: string;
  bom: string;
  outputItemName?: string;
  outputItemCode?: string;
  orderQty?: number;       // planned amount when the production order was created
  producedQty: number;     // actual produced so far — order is complete when this === orderQty
  status: WfProductionEntryStatus;
  qcLogId?: string;
  qcPassedAt?: string;
  qcCheckedBy?: string;
  completedAt?: string;
  inventoryAdded?: boolean;
  officeId?: string;
  warehouseId?: string;
};

// ── Material Requirement Planning (MRP) run ────────────────────────────────
// One run captures: which orders were planned, what materials were needed,
// what was a shortfall, and which downstream artifacts were generated.
export type WfMrpMaterial = {
  itemCode: string;
  itemName: string;
  uom: string;
  bucket: "Raw" | "Packaging" | "Other";
  reqQty: number;
  onHand: number;
  shortfall: number;        // max(0, reqQty − onHand)
  rate: number;
  totalCost: number;        // reqQty × rate
  supplier?: string;         // resolved from Price Setup, if available
};

export type WfMrpRun = {
  id: string;                // MRP-2026-NNN
  date: string;              // ISO timestamp
  runBy: string;
  basis: "remaining" | "full";
  orderIds: string[];
  totalUnits: number;
  totalCost: number;
  materials: WfMrpMaterial[];
  requisitionIds: string[];  // generated PRs (workflow store wfRequisitions)
  transferIds: string[];     // generated transfer notes (workflow store transferNotes)
  /** Demand request that gates the PR/TN creation. When set, the run was
   *  raised by the bulk meal-plan flow and is awaiting approval — the
   *  requisitionIds/transferIds arrays stay empty until that demand is
   *  approved on /approval-management, which patches them in via
   *  `updateMrpRun`. When undefined, the run came from the synchronous
   *  on-demand MRP dialog that creates PR/TN inline. */
  demandRef?: string;
};

// A Production Entry RECORD is the actual production-floor log against a
// Production Order. Multiple entry records can be made against one order
// until the order's producedQty reaches its orderQty.
export type WfProductionEntryRecord = {
  id: string;                  // PE-2026-NNNNNN
  date: string;
  productionOrderId: string;   // WfProductionEntry.id (the order being fulfilled)
  bom: string;                 // snapshot from the order at entry time
  outputItemName?: string;
  outputItemCode?: string;
  producedQty: number;         // amount produced in this single entry
  batchNo?: string;
  shift?: "Morning" | "Evening" | "Night";
  producedBy: string;
  remarks?: string;
  officeId: string;
  warehouseId: string;
};

// ── Context type ───────────────────────────────────────────────────────────────
type WorkflowCtx = {
  demands: WfDemandRequest[];
  addDemands: (items: WfDemandRequest[]) => void;
  updateDemandStatus: (id: string, status: WfDemandStatus, extra?: Partial<WfDemandRequest>) => void;

  wfRequisitions: WfRequisition[];
  addRequisition: (req: WfRequisition) => void;
  updateRequisitionStatus: (id: string, status: WfReqStatus) => void;
  updateRequisition: (id: string, patch: Partial<WfRequisition>) => void;

  wfPurchaseOrders: WfPurchaseOrder[];
  addPurchaseOrder: (po: WfPurchaseOrder) => void;
  updatePOStatus: (id: string, status: WfPOStatus, extra?: Partial<WfPurchaseOrder>) => void;

  grns: WfGRN[];
  addGRN: (grn: WfGRN) => void;

  transferNotes: WfTransferNote[];
  addTransferNote: (tn: WfTransferNote) => void;
  acknowledgeTransfer: (id: string) => void;

  stockDeltas: StockDelta[];
  applyStockDeltas: (deltas: StockDelta[]) => void;

  prdStatuses: Record<string, string>;
  prdProgress: Record<string, number>;
  setPRDStatus: (id: string, status: string, progress: number) => void;

  productionEntries: WfProductionEntry[];
  addProductionEntry: (entry: WfProductionEntry) => void;
  updateProductionEntryStatus: (
    id: string,
    status: WfProductionEntryStatus,
    extra?: Partial<WfProductionEntry>,
  ) => void;

  // ── Production Entry RECORDS — actual production-floor logs ───────────────
  productionEntryRecords: WfProductionEntryRecord[];
  addProductionEntryRecord: (record: WfProductionEntryRecord) => void;

  // ── MRP run history ───────────────────────────────────────────────────────
  mrpRuns: WfMrpRun[];
  addMrpRun: (run: WfMrpRun) => void;
  updateMrpRun: (id: string, patch: Partial<WfMrpRun>) => void;
};

const WorkflowContext = createContext<WorkflowCtx>({
  demands: [], addDemands: () => {}, updateDemandStatus: () => {},
  wfRequisitions: [], addRequisition: () => {}, updateRequisitionStatus: () => {}, updateRequisition: () => {},
  wfPurchaseOrders: [], addPurchaseOrder: () => {}, updatePOStatus: () => {},
  grns: [], addGRN: () => {},
  transferNotes: [], addTransferNote: () => {}, acknowledgeTransfer: () => {},
  stockDeltas: [], applyStockDeltas: () => {},
  prdStatuses: {}, prdProgress: {}, setPRDStatus: () => {},
  productionEntries: [], addProductionEntry: () => {}, updateProductionEntryStatus: () => {},
  productionEntryRecords: [], addProductionEntryRecord: () => {},
  mrpRuns: [], addMrpRun: () => {}, updateMrpRun: () => {},
});

// ── Provider ───────────────────────────────────────────────────────────────────
export function WorkflowProvider({ children }: { children: ReactNode }) {
  const [demands, setDemands] = useState<WfDemandRequest[]>(
    seedDemands.map(d => ({
      id: d.id,
      reference: d.reference,
      requestedBy: d.requestedBy,
      role: d.role,
      date: d.date,
      status: d.status as WfDemandStatus,
      items: d.items.map(i => ({ ...i })),
      note: d.note,
      source: "Kitchen",
      officeId: "OFF-001",
      warehouseId: "WH-003",
    }))
  );

  const [wfRequisitions, setWfRequisitions] = useState<WfRequisition[]>(
    seedReqs.map(r => ({
      id: r.id,
      reference: r.reference,
      requestedBy: r.requestedBy,
      source: r.source,
      date: r.date,
      status: r.status as WfReqStatus,
      items: r.items,
      note: r.note,
      demandRef: r.reference,
      officeId: "OFF-001",
      warehouseId: "WH-001",
    }))
  );

  const [wfPurchaseOrders, setWfPOs] = useState<WfPurchaseOrder[]>(
    seedPOs.map(p => ({
      id: p.id,
      vendor: p.vendor,
      items: p.items,
      amount: p.amount,
      date: p.date,
      status: p.status as WfPOStatus,
      requisitionRef: "",
      officeId: "OFF-001",
      warehouseId: "WH-001",
      lineItems: p.lineItems?.map(l => ({
        itemId: l.itemId,
        name: l.name,
        qty: l.qty,
        uom: l.uom,
        unitPrice: l.unitPrice,
      })),
    }))
  );

  const [grns, setGRNs] = useState<WfGRN[]>([]);
  const [transferNotes, setTransferNotes] = useState<WfTransferNote[]>([
    {
      id: "TN-50001",
      demandRef: "DR-9001",
      grnRef: "Direct from Store",
      items: [
        { id: "INV-1002", name: "Chicken Breast", qty: 50, uom: "Kg" },
        { id: "INV-1008", name: "Salmon Fillet", qty: 10, uom: "Kg" },
      ],
      from: "Store",
      to: "Hot Kitchen",
      issuedBy: "S. Ahmed",
      date: "2025-11-05 11:45",
      status: "Issued",
      officeId: "OFF-001",
      warehouseId: "WH-003",
    },
    {
      id: "TN-50003",
      demandRef: "Direct Issue",
      grnRef: "Direct from Store",
      items: [
        { id: "INV-1003", name: "Cooking Oil", qty: 25, uom: "Litre" },
      ],
      from: "Store",
      to: "Bakery",
      issuedBy: "F. Begum",
      date: "2026-05-19 11:40",
      status: "Issued",
      officeId: "OFF-001",
      warehouseId: "WH-001",
    },
  ]);
  const [stockDeltas, setStockDeltas] = useState<StockDelta[]>([]);
  const [prdStatuses, setPrdStatuses] = useState<Record<string, string>>({});
  const [prdProgress, setPrdProgress] = useState<Record<string, number>>({});
  const [productionEntries, setProductionEntries] = useState<WfProductionEntry[]>([
    { id: "PRO-2026-000031", date: "2026-05-19", bom: "Chicken Biryani",       outputItemName: "Chicken Biryani",      orderQty: 280, producedQty: 140, status: "In Preparation", officeId: "OFF-001", warehouseId: "WH-003" },
    { id: "PRO-2026-000030", date: "2026-05-18", bom: "Continental Breakfast", outputItemName: "Continental Breakfast", orderQty: 150, producedQty: 150, status: "Ready for QC",   officeId: "OFF-001", warehouseId: "WH-003" },
    { id: "PRO-2026-000029", date: "2026-05-17", bom: "Veg Pulao",             outputItemName: "Veg Pulao",            orderQty: 320, producedQty:   0, status: "Approved",        officeId: "OFF-001", warehouseId: "WH-003" },
    { id: "PRO-2026-000028", date: "2026-05-12", bom: "Chicken Biryani",       outputItemName: "Chicken Biryani",      orderQty: 250, producedQty: 250, status: "Completed",      qcCheckedBy: "Hygiene Lead", qcPassedAt: "2026-05-12 16:20", completedAt: "2026-05-12 16:22", inventoryAdded: true, officeId: "OFF-001", warehouseId: "WH-003" },
    { id: "PRO-2026-000025", date: "2026-05-10", bom: "Veg Pulao",             outputItemName: "Veg Pulao",            orderQty: 180, producedQty: 180, status: "Completed",      qcCheckedBy: "F. Begum",     qcPassedAt: "2026-05-10 14:05", completedAt: "2026-05-10 14:07", inventoryAdded: true, officeId: "OFF-001", warehouseId: "WH-004" },
    { id: "PRO-2026-000022", date: "2026-05-08", bom: "Continental Breakfast", outputItemName: "Continental Breakfast", orderQty: 220, producedQty: 220, status: "Completed",      qcCheckedBy: "T. Islam",     qcPassedAt: "2026-05-08 09:40", completedAt: "2026-05-08 09:42", inventoryAdded: true, officeId: "OFF-001", warehouseId: "WH-003" },
    { id: "PRO-2026-000019", date: "2026-05-05", bom: "Grilled Salmon",        outputItemName: "Grilled Salmon",       orderQty: 130, producedQty: 130, status: "Completed",      qcCheckedBy: "Hygiene Lead", qcPassedAt: "2026-05-05 12:30", completedAt: "2026-05-05 12:31", inventoryAdded: true, officeId: "OFF-001", warehouseId: "WH-004" },
    { id: "PRO-2026-000016", date: "2026-05-02", bom: "Hindu Meal Special",    outputItemName: "Hindu Meal Special",   orderQty:  80, producedQty:   0, status: "Pending",         officeId: "OFF-001", warehouseId: "WH-003" },
  ]);

  // Production-floor entry records. The seeds line up with PRO-2026-000031's
  // 280-order which already shows 140 produced — that 140 came from these
  // two entries (80 + 60). Completed orders' producedQty is treated as
  // historical; we don't backfill an entry record for every one.
  const [productionEntryRecords, setProductionEntryRecords] = useState<WfProductionEntryRecord[]>([
    {
      id: "PE-2026-000045",
      date: "2026-05-19 09:30",
      productionOrderId: "PRO-2026-000031",
      bom: "Chicken Biryani",
      outputItemName: "Chicken Biryani",
      producedQty: 80,
      batchNo: "BCB-19A",
      shift: "Morning",
      producedBy: "F. Begum",
      officeId: "OFF-001",
      warehouseId: "WH-003",
      remarks: "Morning batch — yield as expected.",
    },
    {
      id: "PE-2026-000046",
      date: "2026-05-19 14:15",
      productionOrderId: "PRO-2026-000031",
      bom: "Chicken Biryani",
      outputItemName: "Chicken Biryani",
      producedQty: 60,
      batchNo: "BCB-19B",
      shift: "Evening",
      producedBy: "T. Islam",
      officeId: "OFF-001",
      warehouseId: "WH-003",
      remarks: "Second run after material top-up.",
    },
  ]);

  const [mrpRuns, setMrpRuns] = useState<WfMrpRun[]>([]);

  return (
    <WorkflowContext.Provider value={{
      demands,
      addDemands: (items) => setDemands(prev => [...items, ...prev]),
      updateDemandStatus: (id, status, extra) =>
        setDemands(prev => prev.map(d => d.id === id ? { ...d, status, ...extra } : d)),

      wfRequisitions,
      addRequisition: (req) => setWfRequisitions(prev => [req, ...prev]),
      updateRequisitionStatus: (id, status) =>
        setWfRequisitions(prev => prev.map(r => r.id === id ? { ...r, status } : r)),
      updateRequisition: (id, patch) =>
        setWfRequisitions(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r)),

      wfPurchaseOrders,
      addPurchaseOrder: (po) => setWfPOs(prev => [po, ...prev]),
      updatePOStatus: (id, status, extra) =>
        setWfPOs(prev => prev.map(p => p.id === id ? { ...p, status, ...extra } : p)),

      grns,
      addGRN: (grn) => setGRNs(prev => [grn, ...prev]),

      transferNotes,
      addTransferNote: (tn) => setTransferNotes(prev => [tn, ...prev]),
      acknowledgeTransfer: (id) =>
        setTransferNotes(prev => prev.map(t => t.id === id ? { ...t, status: "Issued" } : t)),

      stockDeltas,
      applyStockDeltas: (deltas) => setStockDeltas(prev => [...prev, ...deltas]),

      productionEntries,
      addProductionEntry: (entry) => setProductionEntries(prev => [entry, ...prev]),
      updateProductionEntryStatus: (id, status, extra) =>
        setProductionEntries(prev => prev.map(e => e.id === id ? { ...e, status, ...extra } : e)),

      mrpRuns,
      addMrpRun: (run) => setMrpRuns((prev) => [run, ...prev]),
      updateMrpRun: (id, patch) =>
        setMrpRuns((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r)),

      productionEntryRecords,
      addProductionEntryRecord: (record) => {
        setProductionEntryRecords(prev => [record, ...prev]);
        // Credit the linked production order with the newly produced qty.
        // Auto-advance order status: Approved/Pending → In Preparation when
        // anything gets produced; In Preparation → Ready for QC when the
        // order's full quantity is met.
        setProductionEntries(prev =>
          prev.map(o => {
            if (o.id !== record.productionOrderId) return o;
            const nextProduced = o.producedQty + record.producedQty;
            const orderTarget = o.orderQty ?? nextProduced;
            let nextStatus: WfProductionEntryStatus = o.status;
            if (o.status === "Pending" || o.status === "Approved") {
              nextStatus = nextProduced >= orderTarget ? "Ready for QC" : "In Preparation";
            } else if (o.status === "In Preparation" && nextProduced >= orderTarget) {
              nextStatus = "Ready for QC";
            }
            return { ...o, producedQty: nextProduced, status: nextStatus };
          }),
        );
      },

      prdStatuses, prdProgress,
      setPRDStatus: (id, status, progress) => {
        setPrdStatuses(prev => ({ ...prev, [id]: status }));
        setPrdProgress(prev => ({ ...prev, [id]: progress }));
      },
    }}>
      {children}
    </WorkflowContext.Provider>
  );
}

export const useWorkflow = () => useContext(WorkflowContext);
