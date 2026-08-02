// Single source of truth for Stock Adjustment records. The Stock Adjustment
// screen (routes/stock-adjustment.tsx) seeds + edits this shape; Approval
// Management reads the list via `getStockAdjustments()` and flips status via
// `setStockAdjustmentStatus()` so the two stay in sync.

import { roundQty } from "@/lib/num";
import { mutateInventoryRow, type LotStatus } from "@/lib/inventory-store";

// Availability helpers live in lib/inventory-store.ts and are re-exported here
// so the many screens that already import from this module get them in one
// place. `applyInventoryStock` moves ON-HAND; `disposeStock` writes off held
// goods and releases the hold with them.
export {
  availableStock, blockedStock, blockStock, releaseStock, disposeStock,
  findInventoryRow, availableOf, blockedOf, lotIsBlocked,
  type StoredItem, type StoredLot, type LotStatus,
} from "@/lib/inventory-store";

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

/** Append a new adjustment record (auto-approved wastage disposals, etc.). */
export function addAdjustment(adj: Adjustment): void {
  try {
    const current = getStockAdjustments();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([adj, ...current]));
  } catch {}
}

/**
 * Apply a signed delta to an inventory item's ON-HAND stock, matched by item
 * code (id) OR name (case-insensitive). Positive increases (receipts), negative
 * decreases (issues / consumption); stock never drops below zero. Safe no-op if
 * the item isn't in the persisted stock master.
 *
 * This is the single mutation point for the Stock Overview "Stock" column, so
 * every operational event that should move stock — GRN/QC acceptance, item
 * issue, warehouse transfer, stock-adjustment approval, wastage disposal —
 * routes through here and stays consistent.
 *
 * On-hand only. A decrease here does NOT release a QC hold, so a write-off of
 * held goods must go through `disposeStock` instead — see lib/inventory-store.
 * Any hold is re-clamped to the new on-hand so it can never exceed it.
 */
export function applyInventoryStock(idOrName: string, delta: number): void {
  // A blank key must never post — it would silently match (and mutate) any
  // row whose name is empty instead of the item the caller meant.
  mutateInventoryRow(idOrName, (row) => {
    const stock = roundQty(Math.max(0, row.stock + delta));
    const held = Math.max(0, row.blockedQty ?? 0);
    return held > stock ? { ...row, stock, blockedQty: stock } : { ...row, stock };
  });
}

/** Reduce an inventory item's stock by name. Safe no-op if item not found. */
export function reduceInventoryStock(itemName: string, qty: number): void {
  applyInventoryStock(itemName, -qty);
}

/** One received/produced lot appended to an inventory row's batch ladder. */
export type InventoryBatchLotInput = {
  batchNo: string;
  qty: number;
  expiry: string;
  costPrice: number;
  receivedOn: string;
  binLocation?: string;
  /** Held on arrival — e.g. produced but not yet QC-signed-off. */
  status?: LotStatus;
  blockedReason?: string;
  blockedAt?: string;
};

/**
 * Append a batch lot to an inventory item's `batches` ladder AND bump its
 * on-hand `stock` by the lot quantity, matched by item code (id) OR name. This
 * is how a produced batch-tracked finished good gets its lot recorded in the
 * Stock Overview batch popup while keeping the Stock column reconciled with the
 * lot ladder.
 *
 * Idempotent by `batchNo`: if a lot with the same batch number already exists on
 * the item, the call is a no-op — so re-firing a completion event never
 * double-posts. Safe no-op if the item isn't in the persisted stock master.
 */
export function addInventoryBatchLot(idOrName: string, lot: InventoryBatchLotInput): void {
  mutateInventoryRow(idOrName, (row) => {
    const batches = Array.isArray(row.batches) ? row.batches : [];
    if (batches.some((b) => b.batchNo === lot.batchNo)) return row; // already posted
    return {
      ...row,
      batches: [...batches, lot],
      stock: roundQty(Math.max(0, row.stock + lot.qty)),
    };
  });
}

// ── Produced-run stock idempotency ──────────────────────────────────────────
// A production run can hit the "post to stock" point more than once (Ready for
// QC, then Completed, and each may re-fire). We record which run ids have already
// posted their produced quantity so the stock/lot is written exactly once,
// keyed by production-order id. Persisted so a reload can't re-post either.
const POSTED_KEY = "harvest-data-v1:production-stock-posted";

export function hasPostedProductionStock(runId: string): boolean {
  try {
    const raw = window.localStorage.getItem(POSTED_KEY);
    if (!raw) return false;
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) && arr.includes(runId);
  } catch {
    return false;
  }
}

export function markPostedProductionStock(runId: string): void {
  try {
    const raw = window.localStorage.getItem(POSTED_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    if (!Array.isArray(arr) || arr.includes(runId)) return;
    window.localStorage.setItem(POSTED_KEY, JSON.stringify([...arr, runId]));
  } catch {}
}

/**
 * Forget that a run posted, so a re-cook of the SAME order can post its new
 * batch. Called only after the original quantity has been withdrawn from stock —
 * clearing the mark without that would let one run post its quantity twice.
 */
export function clearPostedProductionStock(runId: string): void {
  try {
    const raw = window.localStorage.getItem(POSTED_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as string[];
    if (!Array.isArray(arr)) return;
    window.localStorage.setItem(POSTED_KEY, JSON.stringify(arr.filter((r) => r !== runId)));
  } catch {}
}
