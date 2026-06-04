// Single source of truth for Request-for-Quotation records. The RFQ screen
// (routes/request-for-quotation.tsx) seeds + edits this shape; other modules
// (e.g. the Quotation Entry "RFQ Reference" picker) read the list via
// `getRfqs()` so they stay in sync with the RFQ table.

// RFQs follow a simple flow: created as "Pending", then "Approved" or
// "Rejected" from the centralized Approval Management queue.
export type RfqStatus = "Pending" | "Approved" | "Rejected";

export type RfqLine = {
  id: string;
  itemName: string;
  uom: string;
  qty: number;
  spec?: string;
};

export type Rfq = {
  id: string;
  date: string;
  prRef?: string;
  deadline: string;
  status: RfqStatus;
  invitedSuppliers: string[];
  lines: RfqLine[];
  notes?: string;
};

export const SEED_RFQS: Rfq[] = [
  {
    id: "RFQ-2026-0042",
    date: "2026-05-18",
    prRef: "PR-2026-0118",
    deadline: "2026-05-25",
    status: "Approved",
    invitedSuppliers: ["Fresh Farms Ltd", "Halal Meats Co.", "Spice World"],
    lines: [
      { id: "l1", itemName: "Chicken Breast", uom: "Kg",  qty: 220 },
      { id: "l2", itemName: "Basmati Rice",   uom: "Kg",  qty: 600 },
      { id: "l3", itemName: "Tomato",         uom: "Kg",  qty: 180 },
    ],
    notes: "Required for next week's wide-body rotation.",
  },
  {
    id: "RFQ-2026-0041",
    date: "2026-05-16",
    prRef: "PR-2026-0115",
    deadline: "2026-05-23",
    status: "Pending",
    invitedSuppliers: ["Aqua Pure BD", "Royal Bakery Supplies"],
    lines: [
      { id: "l1", itemName: "Mineral Water 250ml", uom: "Bottle", qty: 4800 },
      { id: "l2", itemName: "Croissant",           uom: "Piece",  qty: 1200 },
    ],
  },
  {
    id: "RFQ-2026-0040",
    date: "2026-05-12",
    prRef: "PR-2026-0112",
    deadline: "2026-05-19",
    status: "Approved",
    invitedSuppliers: ["Fresh Farms Ltd", "Halal Meats Co."],
    lines: [
      { id: "l1", itemName: "Onion",  uom: "Kg", qty: 320 },
      { id: "l2", itemName: "Potato", uom: "Kg", qty: 280 },
    ],
    notes: "Awarded to Fresh Farms Ltd on 2026-05-19.",
  },
  {
    id: "RFQ-2026-0039",
    date: "2026-05-10",
    deadline: "2026-05-17",
    status: "Pending",
    invitedSuppliers: [],
    lines: [
      { id: "l1", itemName: "Olive Oil", uom: "Litre", qty: 60 },
    ],
  },
];

// Mirror of the key used by usePersistedState in request-for-quotation.tsx so
// reads here reflect RFQs created / edited at runtime, not just the seed.
const STORAGE_KEY = "harvest-data-v1:request-for-quotation-rows";

/**
 * Map any status (including legacy values from before the flow was simplified —
 * Draft/Sent/Responses In/Closed/Cancelled) onto the current Pending/Approved/
 * Rejected model, so older persisted data renders correctly.
 */
export function normalizeRfqStatus(status: string): RfqStatus {
  switch (status) {
    case "Approved":
    case "Responses In":
    case "Closed":
      return "Approved";
    case "Rejected":
    case "Cancelled":
      return "Rejected";
    case "Pending":
    case "Draft":
    case "Sent":
    default:
      return "Pending";
  }
}

/** All RFQs (persisted if present, else seed), with statuses normalized. */
export function getRfqs(): Rfq[] {
  let list: Rfq[] = SEED_RFQS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw != null) list = JSON.parse(raw) as Rfq[];
  } catch {
    /* unavailable / corrupt — fall through to seed */
  }
  return list.map((r) => ({ ...r, status: normalizeRfqStatus(r.status) }));
}

/** RFQs open for quoting — only approved RFQs can collect supplier quotations. */
export function getApprovedRfqs(): Rfq[] {
  return getRfqs().filter((r) => r.status === "Approved");
}

/**
 * Update an RFQ's status in the persisted list. Used by Approval Management to
 * approve a pending RFQ; the RFQ screen re-reads the persisted list on mount.
 */
export function setRfqStatus(id: string, status: RfqStatus): void {
  try {
    const next = getRfqs().map((r) => (r.id === id ? { ...r, status } : r));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
