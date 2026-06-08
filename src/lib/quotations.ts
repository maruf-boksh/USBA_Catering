// Single source of truth for supplier Quotation records. The Quotation Entry
// screen (routes/quotation-entry.tsx) seeds + edits this shape; Approval
// Management reads the list via `getQuotations()` and flips status via
// `setQuotationStatus()` so the two stay in sync.

// Quotations follow the same simple flow as RFQs: captured as "Pending", then
// "Approved" or "Rejected" from the centralized Approval Management queue.
export type QuoteStatus = "Pending" | "Approved" | "Rejected";

export type QuoteLine = {
  id: string;
  itemName: string;
  uom: string;
  qty: number;
  unitPrice: number;
};

export type Quotation = {
  id: string;
  date: string;
  rfqRef: string;
  supplier: string;
  validity: string;
  leadTimeDays?: number;
  paymentTerms: string;
  lines: QuoteLine[];
  total: number;
  status: QuoteStatus;
  notes?: string;
};

export const SEED_QUOTATIONS: Quotation[] = [
  {
    id: "QT-2026-0091",
    date: "2026-05-20",
    rfqRef: "RFQ-2026-0042",
    supplier: "Fresh Farms Ltd",
    validity: "2026-06-20",
    paymentTerms: "Net 30",
    lines: [
      { id: "l1", itemName: "Chicken Breast", uom: "Kg", qty: 220, unitPrice: 372 },
      { id: "l2", itemName: "Basmati Rice",   uom: "Kg", qty: 600, unitPrice: 88 },
      { id: "l3", itemName: "Tomato",         uom: "Kg", qty: 180, unitPrice: 58 },
    ],
    total: 220 * 372 + 600 * 88 + 180 * 58,
    status: "Pending",
  },
  {
    id: "QT-2026-0090",
    date: "2026-05-20",
    rfqRef: "RFQ-2026-0042",
    supplier: "Halal Meats Co.",
    validity: "2026-06-15",
    paymentTerms: "Net 30",
    lines: [
      { id: "l1", itemName: "Chicken Breast", uom: "Kg", qty: 220, unitPrice: 380 },
    ],
    total: 220 * 380,
    status: "Pending",
    notes: "Quote for protein items only.",
  },
  {
    id: "QT-2026-0089",
    date: "2026-05-19",
    rfqRef: "RFQ-2026-0042",
    supplier: "Spice World",
    validity: "2026-06-10",
    paymentTerms: "Net 45",
    lines: [
      { id: "l1", itemName: "Basmati Rice", uom: "Kg", qty: 600, unitPrice: 92 },
      { id: "l2", itemName: "Tomato",       uom: "Kg", qty: 180, unitPrice: 55 },
    ],
    total: 600 * 92 + 180 * 55,
    status: "Pending",
  },
  {
    id: "QT-2026-0088",
    date: "2026-05-15",
    rfqRef: "RFQ-2026-0040",
    supplier: "Fresh Farms Ltd",
    validity: "2026-05-30",
    paymentTerms: "Net 30",
    lines: [
      { id: "l1", itemName: "Onion",  uom: "Kg", qty: 320, unitPrice: 48 },
      { id: "l2", itemName: "Potato", uom: "Kg", qty: 280, unitPrice: 38 },
    ],
    total: 320 * 48 + 280 * 38,
    status: "Approved",
  },
];

// Mirror of the key used by usePersistedState in quotation-entry.tsx so reads
// here reflect quotations created / edited at runtime, not just the seed.
const STORAGE_KEY = "harvest-data-v1:quotation-entry-rows";

/**
 * Map any status (including legacy values from before the flow was simplified —
 * Draft/Submitted/Selected/Expired) onto the current Pending/Approved/Rejected
 * model, so older persisted data renders correctly.
 */
export function normalizeQuoteStatus(status: string): QuoteStatus {
  switch (status) {
    case "Approved":
    case "Selected":
      return "Approved";
    case "Rejected":
    case "Expired":
      return "Rejected";
    case "Pending":
    case "Draft":
    case "Submitted":
    default:
      return "Pending";
  }
}

/** All quotations (persisted if present, else seed), with statuses normalized. */
export function getQuotations(): Quotation[] {
  let list: Quotation[] = SEED_QUOTATIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw != null) list = JSON.parse(raw) as Quotation[];
  } catch {
    /* unavailable / corrupt — fall through to seed */
  }
  return list.map((q) => ({ ...q, status: normalizeQuoteStatus(q.status) }));
}

/** Quotations cleared for purchasing — only approved quotations can be awarded. */
export function getApprovedQuotations(): Quotation[] {
  return getQuotations().filter((q) => q.status === "Approved");
}

/**
 * Update a quotation's status in the persisted list. Used by Approval Management
 * to approve a pending quotation; the Quotation screen re-reads on mount.
 */
export function setQuotationStatus(id: string, status: QuoteStatus): void {
  try {
    const next = getQuotations().map((q) => (q.id === id ? { ...q, status } : q));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
