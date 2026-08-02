import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { getDemandRequests, saveDemandRequests } from "@/lib/demand-requests";
import {
  requisitions as seedReqs, purchaseOrders as seedPOs, cookingTempLogs,
} from "@/lib/sample-data";
import { loadMealPlanningConfig } from "@/lib/meal-planning-data";
import { planSpecialMealDemoProduction } from "@/lib/demo-special-meal-production";
import { updateFlightOrdersWhere, getFlightOrders } from "@/lib/flight-orders-store";
import { servedOrderNosFor } from "@/lib/production-order-link";
import { resolveItemMaster, isItemBatchTracked } from "@/lib/item-registry";
import {
  addInventoryBatchLot, applyInventoryStock, blockStock, releaseStock,
  hasPostedProductionStock, markPostedProductionStock,
} from "@/lib/stock-adjustments";

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
  | "Partially Received"
  | "Received"
  | "Close Requested"
  | "Closed"
  | "Issued to Vendor";

export type WfTransferStatus = "Pending" | "Issued";

// ── Entity types ───────────────────────────────────────────────────────────────
export type WfDemandItem = { id: string; name: string; qty: number; uom: string; type?: string };

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
  /** True when the demand was auto-raised from a Re-Cook production entry whose
   *  BOM materials were short of stock. Drives a "Re-Cook" tag on the Demand
   *  Requests page and in the Approval Management queue. */
  reCook?: boolean;
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
  /** While a close is pending approval, the status it should revert to if the
   *  close request is rejected (Approved or Partially Received). */
  closeRequestedFrom?: WfPOStatus;
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

export type WfGRNQcStatus = "Pending" | "Accepted" | "On Hold" | "Rejected" | "Partially Accepted";

export type WfGRNLine = {
  itemId: string;
  name: string;
  qty: number;
  uom: string;
  temp: string;
  expiry: string;
  /** Unit purchase rate — captured on a direct/spot buy (line total = qty × rate). */
  rate?: number;
  /** Ordered quantity carried from the PO line — lets receiving compare received
   *  vs ordered on the GRN (a short/over delivery is visible immediately). */
  orderedQty?: number;
  /** Supplier batch / lot number for the received goods — food-traceability
   *  standard; also feeds batch-tracked inventory. */
  batchNo?: string;
  /** Set on receipt to "Pending"; the Quality Control module inspects the line
   *  and moves it to Accepted / On Hold / Rejected. Only "Accepted" lines post
   *  to the Stock Overview ledger. */
  qcStatus: WfGRNQcStatus;
  /** Inspection details captured in Quality Control. */
  qcCompliedQty?: "Yes" | "No";
  qcRemarks?: string;
  /** Rejection reason (on Rejected / on the failed qty of a partial). */
  qcReason?: string;
  /** Item-wise inspection split captured in Quality Control. qcQty is how many
   *  units were inspected (defaults to the received qty); qcPassQty posts to
   *  Stock Overview; qcFailQty initiates a Purchase Return for the vendor. */
  qcQty?: number;
  qcPassQty?: number;
  qcFailQty?: number;
};

/** Inspection fields recorded alongside a QC decision. */
export type WfGRNQcDetails = Partial<Pick<WfGRNLine, "temp" | "qcCompliedQty" | "qcRemarks" | "qcReason" | "qcQty" | "qcPassQty" | "qcFailQty">>;

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
  /** Official goods-receipt (document) date, distinct from the system `date`
   *  timestamp — the date the goods were actually received/recorded on the GRN. */
  grnDate?: string;
  /** Supplier delivery challan / delivery-note number accompanying the goods. */
  challanNo?: string;
  /** Delivery vehicle / transport reference (logistics traceability). */
  vehicleNo?: string;
  /** True for a spot/direct purchase received without a prior PO. */
  direct?: boolean;
  /** Justification / receiving remarks (audit trail) — direct buy or GRN. */
  note?: string;
  /** Supplier invoice / bill reference (direct buy or GRN). */
  invoiceNo?: string;
  /** Purchase value of a direct receive — Σ(line qty × rate). */
  amount?: number;
};

// ── Supplier payment (Purchase Payment module) ────────────────────────────────
export type WfPaymentMethod = "Cash" | "Bank Transfer" | "Cheque" | "Mobile Banking";

/** How much of a single GRN's payable value this payment settles. Partial
 *  payments are allowed, so `amount` may be less than the GRN's balance. */
export type WfPaymentAllocation = { grnRef: string; amount: number };

/** A payment made to a supplier settling (part of) one or more received GRNs. */
export type WfSupplierPayment = {
  id: string;                 // PAY-YYYY-NNNNN
  vendor: string;
  /** Payment date (yyyy-mm-dd). */
  date: string;
  method: WfPaymentMethod;
  /** Cheque no / bank txn id / mobile-banking ref. */
  reference?: string;
  /** Total paid — Σ of the per-GRN allocations. */
  amount: number;
  /** Per-GRN amounts settled by this payment (supports partial settlement). */
  allocations: WfPaymentAllocation[];
  note?: string;
  paidBy: string;
  /** System timestamp the payment was recorded. */
  recordedAt: string;
  officeId?: string;
  /** Cash/Bank account the money was drawn from (WfFinancialAccount.id). */
  accountId?: string;
};

// ── Cash & Bank accounts (Accounts module) ────────────────────────────────────
export type WfAccountType = "Cash" | "Bank";

/** A cash-in-hand or bank account the business pays suppliers from. */
export type WfFinancialAccount = {
  id: string;                 // ACC-###
  name: string;
  type: WfAccountType;
  bankName?: string;          // Bank accounts only
  accountNo?: string;         // Bank accounts only
  /** Balance carried when the account was first added to the system. */
  openingBalance: number;
  active: boolean;
};

export type WfCashTxnType = "Deposit" | "Withdrawal" | "Adjustment" | "Transfer";

/** A manual movement on a Cash/Bank account (top-up, cash-out, correction). */
export type WfCashTxn = {
  id: string;                 // TXN-###
  accountId: string;
  type: WfCashTxnType;
  /** Signed delta on the balance — Deposit +, Withdrawal −, Adjustment ±. */
  amount: number;
  date: string;
  reference?: string;
  note?: string;
  by: string;
  recordedAt: string;
  /**
   * Transfers are written as a LINKED PAIR — one negative leg on the source
   * account, one positive leg on the destination — sharing a transfer id.
   *
   * Banking cash-in-hand used to mean recording a withdrawal and a deposit as
   * two unrelated rows: nothing tied them, and if only one side was entered the
   * books drifted with nothing to show it. The pair id makes the other leg
   * findable, so the ledger can show a transfer as one movement and a missing
   * leg is a detectable state rather than a silent hole.
   */
  transferId?: string;
  /** The account on the other side of the transfer (for display). */
  counterAccountId?: string;
  /**
   * Matched against a bank/cash statement. Undefined = never reviewed, which is
   * what the Unreconciled filter looks for.
   */
  reconciledAt?: string;
  reconciledBy?: string;
};

/** Live balance = opening + cash movements − supplier payments drawn from it. */
export function accountBalance(
  accountId: string,
  openingBalance: number,
  cashTxns: WfCashTxn[],
  payments: WfSupplierPayment[],
): number {
  const moves = cashTxns
    .filter((t) => t.accountId === accountId)
    .reduce((s, t) => s + t.amount, 0);
  const paid = payments
    .filter((p) => p.accountId === accountId)
    .reduce((s, p) => s + p.amount, 0);
  return openingBalance + moves - paid;
}

/** Payable value of a GRN — Σ(qty × rate) over lines not QC-rejected.
 *  Rejected lines are returned to the vendor, so they are never payable. */
export function grnPayableAmount(lines: { qty: number; rate?: number; qcStatus?: WfGRNQcStatus; qcPassQty?: number }[]): number {
  return lines
    .filter((l) => l.qcStatus !== "Rejected")
    .reduce((sum, l) => {
      // A partially-accepted line is payable only for the passed qty — the
      // failed qty is returned to the vendor. Everything else pays full qty.
      const payableQty =
        l.qcStatus === "Partially Accepted" && l.qcPassQty != null
          ? l.qcPassQty
          : (Number(l.qty) || 0);
      return sum + payableQty * (Number(l.rate) || 0);
    }, 0);
}

export type StockDelta = {
  itemId: string;
  delta: number;
  /** Movement metadata surfaced in the Stock Overview ledger drill-down. */
  date?: string;
  reference?: string;
  officeId?: string;
  warehouseId?: string;
  /** Transaction-type label (defaults to Production / Dispatch by sign). */
  label?: string;
};

export type WfDispatchApproval = {
  id: string;
  flightId: string;
  flightLabel: string;
  packagingDate: string;
  vehicleNo: string;
  vehicleClean: "Yes" | "No";
  totalQty: number;
  resultSatisfy: "Yes" | "No";
  chilledTemp: string;
  frozenTemp: string;
  vehicleTempBegin: string;
  vehicleTempEnd: string;
  loadStartTime: string;
  loadEndTime: string;
  gateTempGate08: string;
  unloadingTime: string;
  verifiedByRemarks: string;
  verifiedByDate: string;
  verifiedByTime: string;
  stage: "pending_hoc" | "hoc_approved" | "forwarded_to_airport";
  approvedBy?: string;
  approvedDesignation?: string;
  approvedAt?: string;
  forwardedAt?: string;
};

// ── Maintenance approval workflow ─────────────────────────────────────────────
export type WfMaintenanceApprovalStatus =
  | "Logged"
  | "Pending Approval"
  | "Maintenance Approved"
  | "Rejected"
  | "Sent to Accounts"
  | "Payment Approved"
  | "Payment Rejected";

export type WfMaintenanceApproval = {
  id: string;
  assetId: string;
  assetName: string;
  serviceDate: string;
  nextDue: string;
  workType: "Routine" | "Repair" | "Calibration" | "Inspection";
  notes?: string;
  submittedAt: string;
  status: WfMaintenanceApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  accountsHeadId?: string;
  vendor?: string;
  expenseCost?: number;
  sentToAccountsAt?: string;
  paymentApprovedBy?: string;
  paymentApprovedAt?: string;
  paymentRejectedBy?: string;
  paymentRejectedAt?: string;
  paymentRejectionReason?: string;
};

// ── Production Entry workflow ─────────────────────────────────────────────────
export type WfProductionEntryStatus =
  | "Pending"
  | "Approved"
  | "Production Initiation"
  | "In Preparation"
  | "Ready for QC"
  | "Completed"
  | "Re-Cook";

export type WfProductionEntry = {
  id: string;
  date: string;
  bom: string;
  outputItemName?: string;
  outputItemCode?: string;
  orderQty?: number;       // planned amount when the production order was created
  producedQty: number;     // actual produced so far — order is complete when this === orderQty
  status: WfProductionEntryStatus;
  // Flight orders this run serves — snapshot at creation. A production run feeds
  // many orders and an order pulls from many runs (many-to-many), so we store the
  // set of Order #s whose menu for this date actually includes the output item
  // (see resolveServedOrderNos). Empty when the item isn't on that day's menu.
  servesOrderNos?: string[];
  qcLogId?: string;
  qcPassedAt?: string;
  qcCheckedBy?: string;
  completedAt?: string;
  inventoryAdded?: boolean;
  /** Batch/lot number + expiry for this run's output, captured at Production
   *  Entry (auto-generated or typed) and used when the produced lot is posted to
   *  Stock Overview. Only meaningful for batch-tracked output items. */
  batchNo?: string;
  batchExpiry?: string;
  qcFailedAt?: string;
  qcFailedBy?: string;
  qcFailReason?: string;
  officeId?: string;
  warehouseId?: string;
  // Wastage log: set when a failed-QC (Re-Cook) batch is disposed via Wastage
  // Management and the report is Final Approved. `failedQcQty` is the batch that
  // failed QC, `disposedQty` is the quantity written off, and `producedQty` is
  // updated to the remaining good (Current) quantity. `wastageRef` links to the
  // approved wastage report so the production order View can show the breakdown.
  failedQcQty?: number;
  disposedQty?: number;
  wastageRef?: string;
  // Re-Cook re-initiation: set when a failed-QC (Re-Cook) batch is re-initiated
  // from the Production Order list. The order re-enters the approval queue
  // (status back to "Pending") tagged as a Re-Cook; on approval it becomes
  // "Approved" and available for a fresh Production Entry run. reCookFailedQty
  // snapshots the batch quantity that failed QC before producedQty was reset.
  reCook?: boolean;
  reCookFailedQty?: number;
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

/** One recorded Input Material line captured with a Production Entry: the BOM
 *  requirement scaled to the produced qty, the actual consumed, the variance,
 *  and (when the actual differs from BOM) the reason for the change. */
export type WfProductionInputMaterial = {
  itemCode: string;
  itemName: string;
  uom: string;
  category: "Raw Material" | "Packaging" | "Other Consumption";
  bomQty: number;
  actualQty: number;
  variance: number;            // actualQty − bomQty (+ = more, − = less)
  available: number;           // live stock snapshot at entry time
  remaining: number;           // available − actualQty at entry time
  reason?: string;             // why actual differs from BOM
};

export type WfProductionEntryRecord = {
  id: string;                  // PE-2026-NNNNNN
  date: string;
  productionOrderId: string;   // WfProductionEntry.id (the order being fulfilled)
  bom: string;                 // snapshot from the order at entry time
  outputItemName?: string;
  outputItemCode?: string;
  producedQty: number;         // amount produced in this single entry
  batchNo?: string;
  batchExpiry?: string;        // ISO date — lot expiry captured at entry (batch items)
  shift?: "Morning" | "Evening" | "Night";
  producedBy: string;
  remarks?: string;
  officeId: string;
  warehouseId: string;
  inputMaterials?: WfProductionInputMaterial[]; // recorded BOM vs actual per line
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
  updatePurchaseOrder: (id: string, patch: Partial<WfPurchaseOrder>) => void;
  deletePurchaseOrder: (id: string) => void;

  grns: WfGRN[];
  addGRN: (grn: WfGRN) => void;
  /** QC inspection outcome for a single received line (by GRN id + line index),
   *  with optional captured inspection details (temp / complied qty / remarks / reason). */
  updateGRNLineQC: (grnId: string, lineIdx: number, status: WfGRNQcStatus, details?: WfGRNQcDetails) => void;

  /** Supplier payments settling received GRNs (Purchase Payment module). */
  supplierPayments: WfSupplierPayment[];
  addSupplierPayment: (payment: WfSupplierPayment) => void;

  /** Cash & Bank accounts and their manual movements (Accounts module). */
  financialAccounts: WfFinancialAccount[];
  addFinancialAccount: (account: WfFinancialAccount) => void;
  updateFinancialAccount: (id: string, patch: Partial<WfFinancialAccount>) => void;
  cashTxns: WfCashTxn[];
  addCashTxn: (txn: WfCashTxn) => void;
  /** Both legs of a transfer, written together so a pair can never be half-saved. */
  addCashTxns: (txns: WfCashTxn[]) => void;
  /** Mark movements as matched against a statement (or clear the mark). */
  reconcileCashTxns: (ids: string[], by: string, reconciled: boolean) => void;

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

  // ── Dispatch QC clearance ──────────────────────────────────────────────────
  // Flight numbers whose Dispatch Monitoring entry has been completed. Set on the
  // Dispatch Monitoring sheet; read by Packaging & Dispatch to unlock "Initiate
  // Dispatch" for the flight. Keyed by flight number → completion timestamp.
  qcClearedFlights: Record<string, string>;
  markFlightQcCleared: (flight: string, at: string) => void;

  dispatchApprovals: WfDispatchApproval[];
  addDispatchApproval: (entry: WfDispatchApproval) => void;
  updateDispatchApproval: (id: string, patch: Partial<WfDispatchApproval>) => void;

  maintenanceApprovals: WfMaintenanceApproval[];
  addMaintenanceApproval: (entry: WfMaintenanceApproval) => void;
  updateMaintenanceApproval: (id: string, patch: Partial<WfMaintenanceApproval>) => void;
};

const WorkflowContext = createContext<WorkflowCtx>({
  demands: [], addDemands: () => {}, updateDemandStatus: () => {},
  wfRequisitions: [], addRequisition: () => {}, updateRequisitionStatus: () => {}, updateRequisition: () => {},
  wfPurchaseOrders: [], addPurchaseOrder: () => {}, updatePOStatus: () => {}, updatePurchaseOrder: () => {}, deletePurchaseOrder: () => {},
  grns: [], addGRN: () => {}, updateGRNLineQC: () => {},
  supplierPayments: [], addSupplierPayment: () => {},
  financialAccounts: [], addFinancialAccount: () => {}, updateFinancialAccount: () => {},
  cashTxns: [], addCashTxn: () => {}, addCashTxns: () => {}, reconcileCashTxns: () => {},
  transferNotes: [], addTransferNote: () => {}, acknowledgeTransfer: () => {},
  stockDeltas: [], applyStockDeltas: () => {},
  prdStatuses: {}, prdProgress: {}, setPRDStatus: () => {},
  productionEntries: [], addProductionEntry: () => {}, updateProductionEntryStatus: () => {},
  productionEntryRecords: [], addProductionEntryRecord: () => {},
  mrpRuns: [], addMrpRun: () => {}, updateMrpRun: () => {},
  qcClearedFlights: {}, markFlightQcCleared: () => {},
  dispatchApprovals: [], addDispatchApproval: () => {}, updateDispatchApproval: () => {},
  maintenanceApprovals: [], addMaintenanceApproval: () => {}, updateMaintenanceApproval: () => {},
});

type ProducedEntry = {
  id: string;
  bom: string;
  outputItemName?: string;
  outputItemCode?: string;
  producedQty: number;
  completedAt?: string;
  date?: string;
  batchNo?: string;
  batchExpiry?: string;
};

/** The lot number a run posts under — typed batch no, else the run id. */
const producedBatchNo = (entry: ProducedEntry) => entry.batchNo?.trim() || entry.id;

/**
 * Post a produced item's quantity to Stock Overview, once per production run.
 *
 *   • Batch-tracked output → append a lot (batch no + expiry) to the item's batch
 *     ladder and bump its stock. The batch no / expiry come from the Production
 *     Entry (auto-generated or typed); they fall back to the run id + shelf-life
 *     projection when not supplied.
 *   • Non-batch output → bump the pooled stock only (no lot).
 *
 * The quantity is posted HELD, because this fires at Ready for QC — before the
 * sensory check has said anything. The food exists and must be on the books
 * (yield, cost, recall), but nothing may consume it until QC signs off, which
 * is what `releaseProducedStock` below does. Posting it as plain available
 * stock is what previously let a batch be issued while its QC was still open,
 * and let a FAILED batch stay issuable afterwards.
 *
 * Idempotent by production-order id so firing at both Ready for QC and Completed
 * (and any re-fire) posts exactly once. No-op for unknown masters or zero qty.
 */
function postProducedBatchLot(entry: ProducedEntry): void {
  const name = (entry.outputItemName ?? entry.bom) || "";
  const master = resolveItemMaster(name, entry.outputItemCode);
  const qty = entry.producedQty;
  if (!master || qty <= 0) return;
  if (hasPostedProductionStock(entry.id)) return;

  const reason = `Awaiting QC — ${entry.id}`;

  if (!isItemBatchTracked(master)) {
    // Single-bucket item — no lot to flag, so the hold is a quantity only.
    applyInventoryStock(master.name, qty);
    blockStock(master.name, qty, { reason });
    markPostedProductionStock(entry.id);
    return;
  }

  const baseDate = (entry.completedAt ?? entry.date ?? "").slice(0, 10);
  const base = baseDate ? new Date(baseDate) : new Date();
  const shelf = master.shelfLifeDays && master.shelfLifeDays > 0
    ? master.shelfLifeDays
    : master.subCategory === "Fresh" ? 3 : master.subCategory === "Frozen" ? 90 : 30;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  addInventoryBatchLot(master.name, {
    batchNo: producedBatchNo(entry),
    qty,
    expiry: entry.batchExpiry || iso(new Date(base.getTime() + shelf * 86400000)),
    costPrice: master.costPrice ?? 0,
    receivedOn: baseDate || iso(base),
    status: "Blocked",
    blockedReason: reason,
  });
  markPostedProductionStock(entry.id);
}

/**
 * QC signed the run off — release its hold so the goods become issuable. This is
 * the moment stock genuinely becomes available; everything before it is on the
 * books but unusable.
 */
function releaseProducedStock(entry: ProducedEntry): void {
  const master = resolveItemMaster((entry.outputItemName ?? entry.bom) || "", entry.outputItemCode);
  if (!master || entry.producedQty <= 0) return;
  releaseStock(master.name, entry.producedQty, {
    batchNo: isItemBatchTracked(master) ? producedBatchNo(entry) : undefined,
  });
}

/**
 * QC failed the run. The stock stays held — it was already posted that way at
 * Ready for QC — but the reason is restated so Stock Overview shows why, and so
 * a hold awaiting inspection is never confused with one that has been rejected.
 */
function markProducedStockFailed(entry: ProducedEntry): void {
  const master = resolveItemMaster((entry.outputItemName ?? entry.bom) || "", entry.outputItemCode);
  if (!master || entry.producedQty <= 0) return;
  blockStock(master.name, entry.producedQty, {
    batchNo: isItemBatchTracked(master) ? producedBatchNo(entry) : undefined,
    reason: `QC Failed — ${entry.id}`,
  });
}

// ── Provider ───────────────────────────────────────────────────────────────────
export function WorkflowProvider({ children }: { children: ReactNode }) {
  // Hydrate from the shared localStorage-backed store (lib/demand-requests) so
  // demands raised on the mobile app appear here — and vice-versa. Falls back to
  // the seed when nothing is persisted yet. Persisted on every change below.
  const [demands, setDemands] = useState<WfDemandRequest[]>(() => getDemandRequests());
  useEffect(() => {
    saveDemandRequests(demands);
  }, [demands]);

  const [wfRequisitions, setWfRequisitions] = useState<WfRequisition[]>(
    seedReqs.map(r => {
      const extra = r as { demandItems?: WfDemandItem[] };
      return {
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
        ...(extra.demandItems ? { demandItems: extra.demandItems } : {}),
      };
    })
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

  const [grns, setGRNs] = useState<WfGRN[]>([
    // Recently received deliveries awaiting Quality Control inspection.
    {
      id: "GRN-6001", poRef: "PO-2025-0452", vendor: "Green Valley Foods",
      receivedBy: "M. Karim", date: "2026-07-05 09:10",
      officeId: "OFF-001", warehouseId: "WH-001",
      lines: [
        { itemId: "l0", name: "Basmati Rice", qty: 200, uom: "Kg", temp: "Ambient", expiry: "2026-12-31", qcStatus: "Pending", rate: 120 },
        { itemId: "l1", name: "Sunflower Oil 5L", qty: 40, uom: "Can", temp: "Ambient", expiry: "2027-03-15", qcStatus: "Pending", rate: 850 },
      ],
    },
    {
      id: "GRN-6002", poRef: "PO-2025-0453", vendor: "Halal Meats Co.",
      receivedBy: "S. Ahmed", date: "2026-07-05 10:25",
      officeId: "OFF-001", warehouseId: "WH-001",
      lines: [
        { itemId: "l0", name: "Mutton Leg", qty: 60, uom: "Kg", temp: "-2°C", expiry: "2026-07-12", qcStatus: "Pending", rate: 950 },
      ],
    },
  ]);
  // One part-payment already made against GRN-6001 (rice & oil, ৳58,000 payable)
  // — leaves a ৳28,000 balance outstanding to Green Valley Foods.
  // Persisted: money is the one thing a demo must not forget. Accounts,
  // movements and supplier payments together ARE the balance — holding them in
  // memory meant every recorded transaction vanished on reload and each
  // account silently snapped back to its opening figure.
  const [supplierPayments, setSupplierPayments] = usePersistedState<WfSupplierPayment[]>(
    "wf-supplier-payments", [
    {
      id: "PAY-2026-30001",
      vendor: "Green Valley Foods",
      date: "2026-07-08",
      method: "Bank Transfer",
      reference: "CB-TXN-88231",
      amount: 30000,
      allocations: [{ grnRef: "GRN-6001", amount: 30000 }],
      note: "Part payment against rice & oil delivery.",
      paidBy: "A. Rahman",
      recordedAt: "2026-07-08 11:20",
      accountId: "ACC-002",
    },
  ]);

  // Cash & Bank accounts the business settles suppliers from.
  const [financialAccounts, setFinancialAccounts] = usePersistedState<WfFinancialAccount[]>(
    "wf-financial-accounts", [
    { id: "ACC-001", name: "Cash in Hand", type: "Cash", openingBalance: 250000, active: true },
    { id: "ACC-002", name: "City Bank — Current A/C", type: "Bank", bankName: "City Bank PLC", accountNo: "1102-3345-90021", openingBalance: 4500000, active: true },
    { id: "ACC-003", name: "Petty Cash", type: "Cash", openingBalance: 60000, active: true },
  ]);
  const [cashTxns, setCashTxns] = usePersistedState<WfCashTxn[]>(
    "wf-cash-txns", [
    { id: "TXN-1001", accountId: "ACC-002", type: "Deposit", amount: 500000, date: "2026-07-01", reference: "Owner capital top-up", by: "A. Rahman", recordedAt: "2026-07-01 09:30", reconciledAt: "2026-07-02 10:00", reconciledBy: "F. Begum" },
    { id: "TXN-1002", accountId: "ACC-001", type: "Withdrawal", amount: -75000, date: "2026-07-04", reference: "Cash drawn for market purchase", by: "M. Karim", recordedAt: "2026-07-04 10:15" },
  ]);

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
      to: "A. Khan",
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
      to: "N. Hossen",
      issuedBy: "F. Begum",
      date: "2026-05-19 11:40",
      status: "Issued",
      officeId: "OFF-001",
      warehouseId: "WH-001",
    },
  ]);
  const initialProductionEntries: WfProductionEntry[] = [
    // Dated 2026-05-21 (a Thursday) with menu-plan items (meal-8 · Choice 1, 60%
    // · Passengers) so the row-level LMC / Variance flag recomputes from the
    // Order→Menu link. That date's international pax = BS-203 (168) + BS-307 (282)
    // = 450 → 450×60% = 270 produced. The demo LMC drops BS-203 to 130 → required
    // 412×60% = 247, so the Completed row shows "Log surplus wastage (23)" and the
    // in-progress row shows "Recompute → 247".
    { id: "PRO-2026-000045", date: "2026-05-21", bom: "Grilled Chicken",       outputItemName: "Grilled Chicken",      orderQty: 270, producedQty: 270, status: "Completed",      qcCheckedBy: "Hygiene Lead", qcPassedAt: "2026-05-21 15:00", completedAt: "2026-05-21 15:02", inventoryAdded: true, officeId: "OFF-001", warehouseId: "WH-003" },
    { id: "PRO-2026-000046", date: "2026-05-21", bom: "Steamed Rice",          outputItemName: "Steamed Rice",         orderQty: 270, producedQty: 100, status: "In Preparation", officeId: "OFF-001", warehouseId: "WH-004" },
    { id: "PRO-2026-000031", date: "2026-05-19", bom: "Chicken Biryani",       outputItemName: "Chicken Biryani",      orderQty: 280, producedQty: 140, status: "In Preparation", officeId: "OFF-001", warehouseId: "WH-003" },
    { id: "PRO-2026-000030", date: "2026-05-18", bom: "Continental Breakfast", outputItemName: "Continental Breakfast", orderQty: 150, producedQty: 150, status: "Ready for QC",   officeId: "OFF-001", warehouseId: "WH-003" },
    { id: "PRO-2026-000029", date: "2026-05-17", bom: "Veg Pulao",             outputItemName: "Veg Pulao",            orderQty: 320, producedQty:   0, status: "Approved",        officeId: "OFF-001", warehouseId: "WH-003" },
    { id: "PRO-2026-000028", date: "2026-05-12", bom: "Chicken Biryani",       outputItemName: "Chicken Biryani",      orderQty: 250, producedQty: 250, status: "Completed",      qcCheckedBy: "Hygiene Lead", qcPassedAt: "2026-05-12 16:20", completedAt: "2026-05-12 16:22", inventoryAdded: true, officeId: "OFF-001", warehouseId: "WH-003" },
    { id: "PRO-2026-000025", date: "2026-05-10", bom: "Veg Pulao",             outputItemName: "Veg Pulao",            orderQty: 180, producedQty: 180, status: "Completed",      qcCheckedBy: "F. Begum",     qcPassedAt: "2026-05-10 14:05", completedAt: "2026-05-10 14:07", inventoryAdded: true, officeId: "OFF-001", warehouseId: "WH-004" },
    { id: "PRO-2026-000022", date: "2026-05-08", bom: "Continental Breakfast", outputItemName: "Continental Breakfast", orderQty: 220, producedQty: 220, status: "Completed",      qcCheckedBy: "T. Islam",     qcPassedAt: "2026-05-08 09:40", completedAt: "2026-05-08 09:42", inventoryAdded: true, officeId: "OFF-001", warehouseId: "WH-003" },
    { id: "PRO-2026-000019", date: "2026-05-05", bom: "Grilled Salmon",        outputItemName: "Grilled Salmon",       orderQty: 130, producedQty: 130, status: "Completed",      qcCheckedBy: "Hygiene Lead", qcPassedAt: "2026-05-05 12:30", completedAt: "2026-05-05 12:31", inventoryAdded: true, officeId: "OFF-001", warehouseId: "WH-004" },
    { id: "PRO-2026-000016", date: "2026-05-02", bom: "Hindu Meal Special",    outputItemName: "Hindu Meal Special",   orderQty:  80, producedQty:   0, status: "Pending",         officeId: "OFF-001", warehouseId: "WH-003" },
    // Crew & special-meal production orders — these are the separate, audience-
    // tagged orders that a dispatch bundles alongside the PAX meals (the dispatch
    // auto-maps crew "Lunch" → "Plain Rice" and special "VGML" → "Vegetable Biryani").
    { id: "PRO-2026-000027", date: "2026-05-11", bom: "Plain Rice",            outputItemName: "Plain Rice",           orderQty: 180, producedQty: 180, status: "Completed",      qcCheckedBy: "F. Begum",     qcPassedAt: "2026-05-11 11:10", completedAt: "2026-05-11 11:12", inventoryAdded: true, officeId: "OFF-001", warehouseId: "WH-003" },
    { id: "PRO-2026-000026", date: "2026-05-11", bom: "Vegetable Biryani",     outputItemName: "Vegetable Biryani",    orderQty: 120, producedQty: 120, status: "Completed",      qcCheckedBy: "T. Islam",     qcPassedAt: "2026-05-11 11:25", completedAt: "2026-05-11 11:27", inventoryAdded: true, officeId: "OFF-001", warehouseId: "WH-003" },
  ];
  // Seed the movements ledger with the IN side already implied by the completed
  // (inventory-added) production entries, so the Inventory report's In Qty
  // column reflects finished goods already in stock. The OUT side accrues as
  // flights are dispatched. Keyed by output item name (same key cooking-temp
  // and dispatch use), so production-in and dispatch-out net per meal.
  const [stockDeltas, setStockDeltas] = useState<StockDelta[]>(
    initialProductionEntries
      .filter((e) => e.inventoryAdded && e.producedQty > 0)
      .map((e) => ({
        itemId: e.outputItemName ?? e.id,
        delta: e.producedQty,
        date: e.date,
        reference: e.id,
        officeId: e.officeId,
        warehouseId: e.warehouseId,
        label: "Production",
      })),
  );
  const [prdStatuses, setPrdStatuses] = useState<Record<string, string>>({});
  const [prdProgress, setPrdProgress] = useState<Record<string, number>>({});
  // Persisted: a production order created in-app used to live only in memory, so
  // every reload dropped it back to the seed. Everything downstream that looks a
  // run up by id — packaging (produced qty, warehouse, order tagging), QC, the
  // Production Order page — then found nothing and rendered blanks.
  const [productionEntries, setProductionEntries] = usePersistedState<WfProductionEntry[]>(
    "wf-production-entries", initialProductionEntries,
  );

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

  // ── Demo top-up: production behind the day's special meals ──────────────────
  // The demo order book carries special meals, but nothing cooks their component
  // dishes — so Packaging had trays it could never assemble. This fills that gap
  // once per load: it works out the day's shortfall from the live order book and
  // menu plan, adds the runs + entry records, and writes their QC passes into
  // the cooking-temp store (which is what promotes them into Packaging).
  //
  // Purely additive and keyed by deterministic ids: a dish already produced in
  // sufficient quantity is skipped, so production entered through the app is
  // never duplicated or overwritten.
  const demoTopUpDone = useRef(false);
  useEffect(() => {
    if (demoTopUpDone.current) return;
    demoTopUpDone.current = true;
    const date = new Date().toISOString().slice(0, 10);
    const producedFor = (item: string, on: string) =>
      productionEntries
        .filter((e) => e.date === on && (e.outputItemName ?? e.bom) === item)
        .reduce((s, e) => s + (e.producedQty ?? 0), 0);
    const plan = planSpecialMealDemoProduction({
      date,
      orders: getFlightOrders(),
      cards: loadMealPlanningConfig(),
      producedFor,
      existingIds: new Set(productionEntries.map((e) => e.id)),
    });
    if (plan.entries.length === 0) return;
    setProductionEntries((prev) => {
      const have = new Set(prev.map((e) => e.id));
      const add = plan.entries.filter((e) => !have.has(e.id));
      return add.length ? [...add, ...prev] : prev;
    });
    setProductionEntryRecords((prev) => {
      const have = new Set(prev.map((r) => r.id));
      const add = plan.records.filter((r) => !have.has(r.id));
      return add.length ? [...add, ...prev] : prev;
    });
    // QC lives in its own persisted store, read straight from localStorage by the
    // packaging pipeline. Seed it the way Cooking Temp would if it has never been
    // opened, so the demo passes land alongside the existing log rather than
    // replacing it.
    try {
      const KEY = "harvest-data-v1:cooking-temp-records";
      const raw = window.localStorage.getItem(KEY);
      const existing: { id: string }[] = raw
        ? JSON.parse(raw)
        : cookingTempLogs.map((r) => ({ ...r, date: "2026-05-22" }));
      const have = new Set((Array.isArray(existing) ? existing : []).map((r) => r.id));
      const add = plan.qc.filter((r) => !have.has(r.id));
      if (add.length > 0 || !raw) {
        window.localStorage.setItem(KEY, JSON.stringify([...add, ...(Array.isArray(existing) ? existing : [])]));
      }
    } catch {
      // localStorage unavailable — the demo top-up is best-effort.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [mrpRuns, setMrpRuns] = useState<WfMrpRun[]>([]);
  // Persisted: saving a Dispatch Monitoring entry clears its flights for
  // dispatch, and that clearance is what stops the Dispatch page offering
  // Vehicle Load for a run it has already recorded. Held in memory it was lost
  // on reload, so a load that had been monitored, verified and forwarded looked
  // untouched again and could be loaded — and re-monitored — a second time.
  const [qcClearedFlights, setQcClearedFlights] = usePersistedState<Record<string, string>>(
    "wf-qc-cleared-flights", {},
  );
  const [maintenanceApprovals, setMaintenanceApprovals] = useState<WfMaintenanceApproval[]>([
    {
      id: "MNT-7001",
      assetId: "EQP-T-003",
      assetName: "Full Size Meal Trolley",
      serviceDate: "2026-06-01",
      nextDue: "2026-12-01",
      workType: "Routine",
      notes: "Routine bi-annual maintenance check.",
      submittedAt: "2026-06-01",
      status: "Pending Approval",
    },
  ]);
  // Persisted for the same reason: a dispatch forwarded to the Head of Catering
  // is an outstanding approval, and losing it on reload dropped the entry out of
  // Approval Management entirely — the monitoring record survived (sessionStorage)
  // while the approval it was waiting on did not.
  const [dispatchApprovals, setDispatchApprovals] = usePersistedState<WfDispatchApproval[]>(
    "wf-dispatch-approvals", [
    {
      id: "DSP-SEED-001",
      flightId: "FLT-SEED-01",
      flightLabel: "BS-211 — DAC-CGP",
      packagingDate: "2026-06-04",
      vehicleNo: "HiLoader-01",
      vehicleClean: "Yes",
      totalQty: 145,
      resultSatisfy: "Yes",
      chilledTemp: "3.2",
      frozenTemp: "-10.5",
      vehicleTempBegin: "4.5",
      vehicleTempEnd: "5.0",
      loadStartTime: "08:00",
      loadEndTime: "08:45",
      gateTempGate08: "5.5",
      unloadingTime: "09:30",
      verifiedByRemarks: "All parameters within acceptable limits.",
      verifiedByDate: "04 Jun 2026",
      verifiedByTime: "08:45 AM",
      stage: "pending_hoc",
    },
  ]);

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
      updatePurchaseOrder: (id, patch) =>
        setWfPOs(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p)),
      deletePurchaseOrder: (id) =>
        setWfPOs(prev => prev.filter(p => p.id !== id)),

      grns,
      addGRN: (grn) => setGRNs(prev => [grn, ...prev]),
      updateGRNLineQC: (grnId, lineIdx, status, details) =>
        setGRNs(prev => prev.map(g =>
          g.id === grnId
            ? { ...g, lines: g.lines.map((l, i) => i === lineIdx ? { ...l, qcStatus: status, ...(details ?? {}) } : l) }
            : g,
        )),

      supplierPayments,
      addSupplierPayment: (payment) => setSupplierPayments(prev => [payment, ...prev]),

      financialAccounts,
      addFinancialAccount: (account) => setFinancialAccounts(prev => [...prev, account]),
      updateFinancialAccount: (id, patch) =>
        setFinancialAccounts(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a)),
      cashTxns,
      addCashTxn: (txn) => setCashTxns(prev => [txn, ...prev]),
      // One setState for both legs — a transfer that saved only its outgoing
      // side would take money out of the business books entirely.
      addCashTxns: (txns) => setCashTxns(prev => [...txns, ...prev]),
      reconcileCashTxns: (ids, by, reconciled) => setCashTxns(prev => prev.map((t) => {
        if (!ids.includes(t.id)) return t;
        if (!reconciled) return { ...t, reconciledAt: undefined, reconciledBy: undefined };
        return { ...t, reconciledAt: new Date().toISOString().slice(0, 16).replace("T", " "), reconciledBy: by };
      })),

      transferNotes,
      addTransferNote: (tn) => setTransferNotes(prev => [tn, ...prev]),
      acknowledgeTransfer: (id) =>
        setTransferNotes(prev => prev.map(t => t.id === id ? { ...t, status: "Issued" } : t)),

      stockDeltas,
      applyStockDeltas: (deltas) => setStockDeltas(prev => [...prev, ...deltas]),

      productionEntries,
      addProductionEntry: (entry) => setProductionEntries(prev => [entry, ...prev]),
      updateProductionEntryStatus: (id, status, extra) => {
        setProductionEntries(prev => prev.map(e => e.id === id ? { ...e, status, ...extra } : e));
        // A flight order enters Production when a run that ACTUALLY SERVES it
        // begins execution (Production Initiation onward) — not when the order was
        // raised (still Pending/Approved), and NOT for every same-date run. A
        // flight is fed by many runs and a run feeds many flights, so we advance
        // only the flights this run serves — its servesOrderNos (recomputed via
        // servedOrderNosFor when the stamp is missing). The first serving run to
        // start is enough (the flight has entered production); "all runs done" is
        // captured later by Packaged. Only Approved legs move, so a leg already
        // Packaged/Dispatched never regresses.
        const started = status !== "Pending" && status !== "Approved";
        const entry = productionEntries.find((e) => e.id === id);
        if (started && entry) {
          const served = entry.servesOrderNos?.length
            ? entry.servesOrderNos
            : servedOrderNosFor(entry.outputItemName ?? entry.bom, entry.date, getFlightOrders());
          const servedSet = new Set(served);
          if (servedSet.size > 0) {
            updateFlightOrdersWhere(
              (o) => servedSet.has(o.orderNo) && o.status === "Approved",
              { status: "Production" },
            );
          }
        }

        // Once a batch-tracked item is fully produced (Ready for QC) or signed off
        // (Completed), record its produced quantity as a batch lot on the Stock
        // Overview so its batch records are maintained there. Idempotent by
        // production-order id, so firing at both points never double-posts.
        //
        // The QC gate is applied on top of that posting: the quantity goes on the
        // books HELD and only a pass releases it. So the three outcomes are
        //   Ready for QC → on the books, not issuable
        //   Completed    → released, issuable
        //   Re-Cook      → still held, now labelled as failed
        if ((status === "Ready for QC" || status === "Completed" || status === "Re-Cook") && entry) {
          const produced = {
            ...entry,
            outputItemName: extra?.outputItemName ?? entry.outputItemName,
            outputItemCode: extra?.outputItemCode ?? entry.outputItemCode,
            producedQty: extra?.producedQty ?? entry.producedQty,
            completedAt: extra?.completedAt ?? entry.completedAt,
            batchNo: extra?.batchNo ?? entry.batchNo,
            batchExpiry: extra?.batchExpiry ?? entry.batchExpiry,
          };
          // Re-Cook can only follow a posting, so it never needs to post itself —
          // posting there would re-add stock that QC has just rejected.
          if (status !== "Re-Cook") postProducedBatchLot(produced);
          if (status === "Completed") releaseProducedStock(produced);
          if (status === "Re-Cook") markProducedStockFailed(produced);
        }
      },

      mrpRuns,
      addMrpRun: (run) => setMrpRuns((prev) => [run, ...prev]),
      updateMrpRun: (id, patch) =>
        setMrpRuns((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r)),

      qcClearedFlights,
      markFlightQcCleared: (flight, at) =>
        setQcClearedFlights((prev) => ({ ...prev, [flight]: at })),

      dispatchApprovals,
      addDispatchApproval: (entry) => setDispatchApprovals(prev => [entry, ...prev]),
      updateDispatchApproval: (id, patch) =>
        setDispatchApprovals(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e)),

      maintenanceApprovals,
      addMaintenanceApproval: (entry) => setMaintenanceApprovals(prev => [...prev, entry]),
      updateMaintenanceApproval: (id, patch) =>
        setMaintenanceApprovals(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e)),

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
            if (o.status === "Pending" || o.status === "Approved" || o.status === "Production Initiation") {
              nextStatus = nextProduced >= orderTarget ? "Ready for QC" : "In Preparation";
            } else if (o.status === "In Preparation" && nextProduced >= orderTarget) {
              nextStatus = "Ready for QC";
            }
            // Stamp the run's batch no / expiry from the first entry that carries
            // one, so the Completed path posts the same lot (idempotent).
            return {
              ...o,
              producedQty: nextProduced,
              status: nextStatus,
              batchNo: o.batchNo ?? record.batchNo,
              batchExpiry: o.batchExpiry ?? record.batchExpiry,
            };
          }),
        );
        // If this record pushes the order to Ready for QC (full quantity made),
        // post the produced quantity to Stock Overview now — before QC sign-off.
        // Runs off the pre-update snapshot (same pattern the status advance uses).
        const o = productionEntries.find((e) => e.id === record.productionOrderId);
        if (o) {
          const nextProduced = o.producedQty + record.producedQty;
          const orderTarget = o.orderQty ?? nextProduced;
          const wasBeforeQc =
            o.status === "Pending" || o.status === "Approved" ||
            o.status === "Production Initiation" || o.status === "In Preparation";
          if (wasBeforeQc && nextProduced >= orderTarget) {
            postProducedBatchLot({
              ...o,
              producedQty: nextProduced,
              batchNo: record.batchNo ?? o.batchNo,
              batchExpiry: record.batchExpiry ?? o.batchExpiry,
            });
          }
        }
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
