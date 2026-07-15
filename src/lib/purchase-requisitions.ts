// Single source of truth for Purchase Requisition records. The Purchase
// Requisition screen (routes/purchase-requisition.tsx) seeds + edits this shape;
// other modules (e.g. the RFQ "PR Reference" picker) read the list via
// `getPurchaseRequisitions()` so they stay in sync with the PR table.

export type PRLineItem = {
  id: string;
  itemName: string;
  description: string;
  qty: number;
  uom: string;
  rate: number;
  /** Quantity placed on a Purchase Order against this requisition line. Absent /
   *  0 until a PO is raised — this is procurement (PO), separate from the
   *  requisitioned (requested) qty above. */
  orderedQty?: number;
  /** Quantity physically received against this line (via GRN / Direct Receive).
   *  Absent / 0 means nothing received yet. Drives the procurement stage. */
  receivedQty?: number;
};

export type Priority = "Normal" | "Urgent";

export type PurchaseRequisition = {
  id: string;
  date: string;
  officeId: string;
  warehouseId: string;
  requestedBy: string;
  requiredBy: string;
  priority: Priority;
  justification: string;
  lines: PRLineItem[];
  status: string;
  totalAmount: number;
};

// ── Approval SLA ─────────────────────────────────────────────────────────────
// A requisition must be approved within this many hours of its PR date. Past
// that window the approver and requester are notified, and the requester may
// re-send the requisition for approval.
export const PR_APPROVAL_SLA_HOURS = 72;

/** True when a still-pending requisition has passed its 72-hour approval window. */
export function isPrApprovalOverdue(pr: PurchaseRequisition, now: Date = new Date()): boolean {
  const s = pr.status.toLowerCase();
  if (s !== "pending approval" && s !== "pending") return false;
  const created = new Date(`${pr.date}T00:00:00`);
  if (Number.isNaN(created.getTime())) return false;
  const deadline = created.getTime() + PR_APPROVAL_SLA_HOURS * 3600 * 1000;
  return now.getTime() > deadline;
}

export const seedRequisitions: PurchaseRequisition[] = [
  {
    id: "PR-2026-005", date: "2026-05-18", officeId: "OFF-001", warehouseId: "WH-003",
    requestedBy: "S. Ahmed",
    requiredBy: "2026-05-22", priority: "Normal", justification: "Weekly stock replenishment for hot kitchen line.",
    lines: [
      { id: "L1", itemName: "Basmati Rice",   description: "Premium long grain", qty: 200, uom: "Kg",    rate: 120 },
      { id: "L2", itemName: "Chicken",        description: "Whole, cleaned",     qty: 150, uom: "Kg",    rate: 280 },
      { id: "L3", itemName: "Cooking Oil",    description: "Soyabean refined",   qty: 60,  uom: "Litre", rate: 175 },
    ],
    status: "Approved", totalAmount: 76500,
  },
  {
    id: "PR-2026-004", date: "2026-05-17", officeId: "OFF-001", warehouseId: "WH-001",
    requestedBy: "M. Hossain",
    requiredBy: "2026-05-21", priority: "Normal", justification: "Production run for the next 4 days.",
    lines: [
      { id: "L1", itemName: "All-Purpose Flour", description: "10kg bag",    qty: 25, uom: "Box",   rate: 1200 },
      { id: "L2", itemName: "Butter",            description: "Unsalted",    qty: 30, uom: "Kg",    rate: 950  },
      { id: "L3", itemName: "Yeast",             description: "Active dry",  qty: 8,  uom: "Pack",  rate: 320  },
    ],
    status: "Pending Approval", totalAmount: 61060,
  },
  {
    id: "PR-2026-003", date: "2026-05-15", officeId: "OFF-001", warehouseId: "WH-004",
    requestedBy: "F. Begum",
    requiredBy: "2026-05-19", priority: "Urgent", justification: "Salmon stock fell below reorder level after weekend rush.",
    lines: [
      { id: "L1", itemName: "Salmon Fillet", description: "Frozen, premium grade", qty: 40, uom: "Kg",  rate: 1400, orderedQty: 40, receivedQty: 40 },
      { id: "L2", itemName: "Lemon",         description: "Fresh",                 qty: 20, uom: "Kg",  rate: 60,   orderedQty: 20, receivedQty: 10 },
      { id: "L3", itemName: "Olive Oil",     description: "Extra virgin",          qty: 10, uom: "Litre", rate: 850, orderedQty: 10, receivedQty: 0 },
    ],
    status: "Approved", totalAmount: 65700,
  },
  {
    id: "PR-2026-002", date: "2026-05-12", officeId: "OFF-001", warehouseId: "WH-002",
    requestedBy: "A. Khan",
    requiredBy: "2026-05-18", priority: "Normal", justification: "Replenish beverage stock for international flights.",
    lines: [
      { id: "L1", itemName: "Mineral Water",      description: "500ml",     qty: 50,  uom: "Box",    rate: 480, orderedQty: 50,  receivedQty: 50 },
      { id: "L2", itemName: "Orange Juice",       description: "1L tetra",  qty: 30,  uom: "Box",    rate: 720, orderedQty: 30,  receivedQty: 30 },
      { id: "L3", itemName: "Disposable Cup",     description: "8oz paper", qty: 100, uom: "Pack",   rate: 95,  orderedQty: 100, receivedQty: 100 },
    ],
    status: "Closed", totalAmount: 55100,
  },
  {
    id: "PR-2026-001", date: "2026-05-10", officeId: "OFF-001", warehouseId: "WH-001",
    requestedBy: "N. Hasan",
    requiredBy: "2026-05-25", priority: "Normal", justification: "Quarterly maintenance consumables.",
    lines: [
      { id: "L1", itemName: "Industrial Detergent", description: "5L jar",      qty: 12, uom: "Bottle", rate: 650 },
      { id: "L2", itemName: "Gas Cylinder",         description: "Commercial",  qty: 4,  uom: "Unit",   rate: 2400 },
    ],
    status: "Draft", totalAmount: 17400,
  },
];

// Mirror of the key used by usePersistedState in routes/purchase-requisition.tsx
// so reads here reflect PRs created / edited at runtime, not just the seed.
const STORAGE_KEY = "harvest-data-v1:purchase-requisitions";

/** All purchase requisitions (persisted if present, else seed). */
export function getPurchaseRequisitions(): PurchaseRequisition[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw != null) return JSON.parse(raw) as PurchaseRequisition[];
  } catch {
    /* unavailable / corrupt — fall through to seed */
  }
  return seedRequisitions;
}

/**
 * Create and persist a new Purchase Requisition into the same localStorage-backed
 * list the web PR screen reads on mount. Used by the mobile app to raise a PR
 * that then shows up on the web (the web screen re-reads on its next mount, same
 * as `applyReceiptToPR`). Assigns the next `PR-2026-###` id (max suffix + 1),
 * derives `totalAmount` from the lines if not supplied, prepends it, and returns
 * the created record. Best-effort — never throws.
 */
export function addPurchaseRequisition(
  input: Omit<PurchaseRequisition, "id" | "totalAmount"> & { totalAmount?: number },
): PurchaseRequisition {
  const list = getPurchaseRequisitions();
  const maxNum = list.reduce((m, r) => {
    const n = Number(r.id.split("-").pop());
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  const totalAmount =
    input.totalAmount ?? input.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const pr: PurchaseRequisition = {
    ...input,
    id: `PR-2026-${String(maxNum + 1).padStart(3, "0")}`,
    totalAmount,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([pr, ...list]));
  } catch {
    /* best-effort — localStorage may be unavailable */
  }
  return pr;
}

/**
 * Set a requisition's approval status in the persisted list. Called from Approval
 * Management (which runs while the PR route is unmounted), so it writes to
 * localStorage directly; the PR screen re-reads the fresh value on its next mount.
 */
export function setPurchaseRequisitionStatus(id: string, status: string): void {
  try {
    const next = getPurchaseRequisitions().map((pr) => (pr.id === id ? { ...pr, status } : pr));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

// ── Procurement stage ────────────────────────────────────────────────────────
// A PR moves through: draft/pending (pre-approval) → approved → goods start
// arriving. Once approved, the stage is DERIVED from how much has been received:
//   Processing     — approved, nothing received yet
//   Partial Order  — some (but not all) ordered qty received
//   Full Order     — every line fully received (== Complete)
// Terminal manual states (Closed / Cancelled / Rejected) short-circuit the above.

export type ProcurementStage =
  | "Draft" | "Pending" | "Rejected" | "Cancelled" | "Closed"
  | "Approved" | "Processing" | "Partial Order" | "Full Order";

/** All filter labels shown in the PR Status dropdown (in display order). */
export const PR_STATUS_FILTERS = [
  "All", "Pending", "Processing", "Partial Order", "Full Order",
  "Complete", "Approved", "Closed", "Cancelled",
] as const;

/** Ordered / received / remaining totals across a requisition's lines. */
export function prReceived(pr: PurchaseRequisition): {
  ordered: number; received: number; remaining: number; pct: number;
} {
  const ordered = pr.lines.reduce((s, l) => s + l.qty, 0);
  const received = pr.lines.reduce((s, l) => s + Math.min(l.receivedQty ?? 0, l.qty), 0);
  const remaining = Math.max(ordered - received, 0);
  const pct = ordered > 0 ? Math.round((received / ordered) * 100) : 0;
  return { ordered, received, remaining, pct };
}

/** The single canonical procurement stage for a requisition. */
export function procurementStage(pr: PurchaseRequisition): ProcurementStage {
  const s = pr.status.toLowerCase();
  if (s === "draft") return "Draft";
  if (s === "pending approval" || s === "pending") return "Pending";
  if (s === "rejected") return "Rejected";
  if (s === "cancelled") return "Cancelled";
  if (s === "closed") return "Closed";
  // Post-approval — derive from procurement activity. A freshly approved PR with
  // nothing yet ordered on a PO or received stays at "Approved"; it only advances
  // to "Processing" once a next action is taken (PO raised / goods start arriving).
  const { ordered, received } = prReceived(pr);
  const placedOnPO = pr.lines.reduce((sum, l) => sum + (l.orderedQty ?? 0), 0);
  if (received <= 0 && placedOnPO <= 0) return "Approved";
  if (received <= 0) return "Processing";
  if (received < ordered) return "Partial Order";
  return "Full Order";
}

/** Whether a requisition matches the selected Status-dropdown filter. Note the
 *  filters intentionally overlap: "Approved" is broad (any approved PR), while
 *  Processing / Partial Order / Full Order are the finer receipt-driven stages. */
export function matchesStatusFilter(pr: PurchaseRequisition, filter: string): boolean {
  if (!filter || filter === "All") return true;
  const stage = procurementStage(pr);
  const s = pr.status.toLowerCase();
  const { ordered, received } = prReceived(pr);
  switch (filter) {
    case "Pending":       return stage === "Pending" || stage === "Draft";
    case "Approved":      return s === "approved";
    case "Processing":    return stage === "Processing";
    case "Partial Order": return stage === "Partial Order";
    case "Full Order":    return stage === "Full Order";
    case "Complete":      return ordered > 0 && received >= ordered;
    case "Closed":        return stage === "Closed";
    case "Cancelled":     return stage === "Cancelled" || stage === "Rejected";
    default:              return true;
  }
}

/**
 * Live write-back: record received quantities against a PR's lines. Called from
 * the Receive Items → Direct Receive flow (which runs while the PR route is
 * unmounted), so it mutates the persisted list in localStorage directly; the PR
 * screen re-reads the fresh value on its next mount. Received qty is capped at
 * the ordered qty per line so the stage math never goes negative.
 */
export function applyReceiptToPR(
  prId: string,
  receipts: { lineId: string; qty: number }[],
): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const list: PurchaseRequisition[] = raw != null ? JSON.parse(raw) : seedRequisitions;
    const next = list.map((pr) => {
      if (pr.id !== prId) return pr;
      const lines = pr.lines.map((l) => {
        const r = receipts.find((x) => x.lineId === l.id);
        if (!r || !(r.qty > 0)) return l;
        return { ...l, receivedQty: Math.min((l.receivedQty ?? 0) + r.qty, l.qty) };
      });
      return { ...pr, lines };
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* best-effort — localStorage may be unavailable */
  }
}
