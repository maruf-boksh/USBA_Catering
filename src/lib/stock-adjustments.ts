// Single source of truth for Stock Adjustment records. The Stock Adjustment
// screen (routes/stock-adjustment.tsx) seeds + edits this shape; Approval
// Management reads the list via `getStockAdjustments()` and flips status via
// `setStockAdjustmentStatus()` so the two stay in sync.

export type AdjType = "Increase" | "Decrease";
export type AdjReason =
  | "Wastage" | "Expiry Writeoff" | "Damage"
  | "Quantity Correction" | "Production Transfer" | "Other";
export type AdjStatus = "Pending Approval" | "Approved" | "Rejected";

export type Adjustment = {
  id: string;
  date: string;
  itemCode: string;
  item: string;
  category: string;
  uom: string;
  currentStock: number;
  adjustQty: number;
  adjustType: AdjType;
  reason: string;
  reference: string;
  remarks: string;
  adjustedBy: string;
  status: AdjStatus;
};

export const REASONS: AdjReason[] = [
  "Wastage", "Expiry Writeoff", "Damage", "Quantity Correction", "Production Transfer", "Other",
];

export const INITIAL_ADJUSTMENTS: Adjustment[] = [
  {
    id: "ADJ-0001", date: "2026-05-15", itemCode: "INV-1002", item: "Chicken Breast",
    category: "Protein", uom: "Kg", currentStock: 64, adjustQty: 12, adjustType: "Decrease",
    reason: "Wastage", reference: "WO-2026-0012",
    remarks: "Over-portioning during lunch production run", adjustedBy: "M. Karim", status: "Approved",
  },
  {
    id: "ADJ-0002", date: "2026-05-15", itemCode: "INV-1005", item: "Tomato",
    category: "Vegetable", uom: "Kg", currentStock: 22, adjustQty: 8, adjustType: "Decrease",
    reason: "Expiry Writeoff", reference: "EW-2026-0003",
    remarks: "Batch expired before use — batch TM-2511", adjustedBy: "S. Ahmed", status: "Approved",
  },
  {
    id: "ADJ-0003", date: "2026-05-16", itemCode: "INV-1008", item: "Salmon Fillet",
    category: "Protein", uom: "Kg", currentStock: 12, adjustQty: 4, adjustType: "Decrease",
    reason: "Damage", reference: "DMG-2026-0002",
    remarks: "Cold chain break — blast freezer malfunction (AS-105)", adjustedBy: "F. Begum", status: "Pending Approval",
  },
  {
    id: "ADJ-0004", date: "2026-05-17", itemCode: "INV-1006", item: "Wheat Flour",
    category: "Grains", uom: "Kg", currentStock: 320, adjustQty: 50, adjustType: "Increase",
    reason: "Quantity Correction", reference: "GRN-5507",
    remarks: "GRN quantity was under-recorded at receiving point", adjustedBy: "S. Ahmed", status: "Approved",
  },
  {
    id: "ADJ-0005", date: "2026-05-17", itemCode: "INV-1003", item: "Mineral Water 250ml",
    category: "Beverage", uom: "Bottle", currentStock: 4200, adjustQty: 120, adjustType: "Decrease",
    reason: "Production Transfer", reference: "TRF-2026-0005",
    remarks: "Transferred to crew catering section for BS-307", adjustedBy: "M. Karim", status: "Pending Approval",
  },
];

// Mirror of the key used by usePersistedState in stock-adjustment.tsx so reads
// here reflect adjustments created at runtime, not just the seed.
const STORAGE_KEY = "harvest-data-v1:stock-adjustments";

/** All adjustments (persisted if present, else seed). */
export function getStockAdjustments(): Adjustment[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw != null) return JSON.parse(raw) as Adjustment[];
  } catch {
    /* unavailable / corrupt — fall through to seed */
  }
  return INITIAL_ADJUSTMENTS;
}

/**
 * Update an adjustment's status in the persisted list. Used by Approval
 * Management to approve/reject; the Stock Adjustment screen re-reads on mount.
 */
export function setStockAdjustmentStatus(id: string, status: AdjStatus): void {
  try {
    const next = getStockAdjustments().map((a) => (a.id === id ? { ...a, status } : a));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
