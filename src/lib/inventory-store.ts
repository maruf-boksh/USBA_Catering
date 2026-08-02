// ─────────────────────────────────────────────────────────────────────────────
// The persisted stock master — one module that knows where on-hand stock lives
// and how much of it is actually usable.
//
// Two facts about a stock row are deliberately kept apart:
//
//   • `stock`   — ON HAND. Everything physically in the store, including food
//                 that failed QC or has not been inspected yet.
//   • blocked   — the slice of that on-hand which must not be consumed.
//
// AVAILABLE (= stock − blocked) is what every issue / transfer / allocation gate
// reads. Keeping `stock` as pure on-hand is what lets valuation, ageing and the
// movement ledger stay correct without changes: blocked goods are still an asset
// until they are written off, and a recall still has to be able to find them.
// This is the standard model (SAP quality-inspection stock, Oracle/D365
// quarantine): quantity stays visible, availability is controlled by status.
//
// How "blocked" is expressed depends on how the item is tracked:
//
//   • Batch-tracked → per LOT (`status: "Blocked"`). You can name the batch,
//     cost it from its own lot and dispose exactly it.
//   • Single/non-batch → a scalar `blockedQty`. It holds a QUANTITY, not an
//     identity: nothing records which units are bad, so the store must
//     physically segregate them. That is the inherent ceiling of non-batch
//     tracking, not a gap here.
//
// This module owns the localStorage key and never imports sample-data, so the
// seed can depend on it (getOrderedBatches) without an import cycle.
// ─────────────────────────────────────────────────────────────────────────────

import { roundQty } from "@/lib/num";

/** Same key `usePersistedState("inventory-items")` writes from Stock Overview. */
export const INVENTORY_KEY = "harvest-data-v1:inventory-items";

export type LotStatus = "Unrestricted" | "Blocked";

/** A lot as persisted. `status` absent means Unrestricted — every legacy lot. */
export type StoredLot = {
  batchNo: string;
  qty: number;
  expiry: string;
  costPrice: number;
  receivedOn: string;
  binLocation?: string;
  status?: LotStatus;
  /** Why it is held, e.g. "Awaiting QC — PRD-2041" / "QC Failed — PRD-2041". */
  blockedReason?: string;
  blockedAt?: string;
};

export type StoredItem = {
  id?: string;
  name: string;
  stock: number;
  /** Non-batch items only. Batch rows derive their blocked qty from the lots. */
  blockedQty?: number;
  blockedReason?: string;
  batches?: StoredLot[];
  [k: string]: unknown;
};

// ── Raw store access ────────────────────────────────────────────────────────

/**
 * The persisted stock rows, or null when the store has never been written (the
 * Inventory page seeds it on first mount). Callers fall back to the seed.
 */
export function readInventoryRows(): StoredItem[] | null {
  try {
    const raw = window.localStorage.getItem(INVENTORY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredItem[]) : null;
  } catch {
    return null;
  }
}

function writeInventoryRows(rows: StoredItem[]): void {
  try {
    window.localStorage.setItem(INVENTORY_KEY, JSON.stringify(rows));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Match a row by item code (id) OR name, case-insensitive — the app uses both. */
export function matchesItem(row: StoredItem, idOrName: string): boolean {
  if (!idOrName) return false;
  return row.id === idOrName || row.name.toLowerCase() === idOrName.toLowerCase();
}

/** The persisted row for an item, if the store exists and holds it. */
export function findInventoryRow(idOrName: string): StoredItem | undefined {
  if (!idOrName || !idOrName.trim()) return undefined;
  return readInventoryRows()?.find((r) => matchesItem(r, idOrName));
}

/**
 * Apply `fn` to the one row matching `idOrName` and persist. Returns false when
 * the store is missing or holds no such row, so callers can no-op safely.
 */
export function mutateInventoryRow(
  idOrName: string,
  fn: (row: StoredItem) => StoredItem,
): boolean {
  if (!idOrName || !idOrName.trim()) return false;
  const rows = readInventoryRows();
  if (!rows) return false;
  let matched = false;
  const next = rows.map((r) => {
    if (matched || !matchesItem(r, idOrName)) return r;
    matched = true;
    return fn(r);
  });
  if (matched) writeInventoryRows(next);
  return matched;
}

// ── Blocked / available derivation ──────────────────────────────────────────

export function lotIsBlocked(lot: StoredLot): boolean {
  return lot.status != null && lot.status !== "Unrestricted";
}

/** Lots free to be consumed — what allocation and issuing may draw from. */
export function unrestrictedLots(row: StoredItem | undefined): StoredLot[] {
  if (!row?.batches) return [];
  return row.batches.filter((b) => b.qty > 0 && !lotIsBlocked(b));
}

/**
 * Held quantity on a row: blocked lots plus the non-batch scalar. Summing both
 * rather than branching keeps a row correct if it ever carries each.
 *
 * Clamped to on-hand — a blocked figure larger than the stock it describes would
 * drive `available` negative and silently freeze the whole item.
 */
export function blockedOf(row: StoredItem | undefined): number {
  if (!row) return 0;
  const fromLots = (row.batches ?? []).reduce(
    (s, b) => (lotIsBlocked(b) ? s + Math.max(0, b.qty) : s),
    0,
  );
  const scalar = Math.max(0, row.blockedQty ?? 0);
  return roundQty(Math.min(row.stock, fromLots + scalar));
}

/** On-hand minus held. Never negative. */
export function availableOf(row: StoredItem | undefined): number {
  if (!row) return 0;
  return roundQty(Math.max(0, row.stock - blockedOf(row)));
}

/** Held quantity for an item, by code or name. 0 when unknown. */
export function blockedStock(idOrName: string): number {
  return blockedOf(findInventoryRow(idOrName));
}

/** Consumable quantity for an item, by code or name. 0 when unknown. */
export function availableStock(idOrName: string): number {
  return availableOf(findInventoryRow(idOrName));
}

// ── Holding and releasing ───────────────────────────────────────────────────

export type BlockOptions = {
  /** Lot to hold. When it exists on the row, the LOT is flagged and the scalar
   *  is left alone — that is the traceable path. */
  batchNo?: string;
  reason?: string;
};

/**
 * Hold `qty` of an item so it cannot be issued, transferred or allocated.
 *
 * Whole-lot granularity by design: a lot is held or it is not. Production QC
 * passes or fails a run as a whole, and inbound QC never posts its failed
 * quantity to stock at all, so no path needs to split a lot mid-inspection.
 */
export function blockStock(idOrName: string, qty: number, opts: BlockOptions = {}): void {
  if (qty <= 0) return;
  const at = new Date().toISOString().slice(0, 16).replace("T", " ");
  mutateInventoryRow(idOrName, (row) => {
    const lots = row.batches ?? [];
    const hit = opts.batchNo ? lots.find((b) => b.batchNo === opts.batchNo) : undefined;
    if (hit) {
      return {
        ...row,
        batches: lots.map((b) =>
          b.batchNo === opts.batchNo
            ? { ...b, status: "Blocked" as const, blockedReason: opts.reason, blockedAt: at }
            : b,
        ),
      };
    }
    // No lot to flag — hold the quantity instead (non-batch item, or a lot the
    // producer never wrote). Capped at on-hand so available cannot go negative.
    const next = roundQty(Math.min(row.stock, Math.max(0, row.blockedQty ?? 0) + qty));
    return { ...row, blockedQty: next, blockedReason: opts.reason ?? row.blockedReason };
  });
}

/**
 * Release a hold — QC passed, so the goods become consumable.
 *
 * Clears BOTH the named lot and `qty` off the scalar, rather than stopping at
 * whichever it finds first. `blockStock` falls back to the scalar when the lot
 * it was given does not exist yet, so a run can end up holding stock one way and
 * being released the other; releasing only one side would strand the remainder
 * with no screen able to clear it, freezing good stock permanently. The scalar
 * is an anonymous number that cannot be attributed to a particular run anyway,
 * so releasing the quantity it was told to release is the honest reading.
 */
export function releaseStock(idOrName: string, qty: number, opts: BlockOptions = {}): void {
  mutateInventoryRow(idOrName, (row) => {
    const lots = row.batches ?? [];
    const batches = opts.batchNo
      ? lots.map((b) =>
          b.batchNo === opts.batchNo
            ? { ...b, status: "Unrestricted" as const, blockedReason: undefined, blockedAt: undefined }
            : b,
        )
      : lots;
    const scalar = qty > 0
      ? roundQty(Math.max(0, Math.max(0, row.blockedQty ?? 0) - qty))
      : Math.max(0, row.blockedQty ?? 0);
    return {
      ...row,
      batches,
      blockedQty: scalar,
      blockedReason: scalar > 0 ? row.blockedReason : undefined,
    };
  });
}

/**
 * Remove `qty` from on-hand as a write-off (wastage disposal, re-cook
 * withdrawal), taking it out of the HELD portion first.
 *
 * Blocked-first is the right default because a disposal is what a hold exists
 * to lead to. Reducing `stock` without also releasing the hold would leave the
 * item permanently short — 70/10 held, dispose 10, and a naive decrement gives
 * 60 on hand with 10 still held, so 50 usable when all 60 are good.
 */
export function disposeStock(idOrName: string, qty: number, batchNo?: string): void {
  if (qty <= 0) return;
  mutateInventoryRow(idOrName, (row) => {
    const stock = roundQty(Math.max(0, row.stock - qty));
    let left = qty;
    let lots = row.batches ?? [];

    // Named lot first, then any other held lot, oldest hold first.
    const order = [...lots]
      .filter(lotIsBlocked)
      .sort((a, b) => {
        if (batchNo && a.batchNo === batchNo) return -1;
        if (batchNo && b.batchNo === batchNo) return 1;
        return (a.blockedAt ?? "").localeCompare(b.blockedAt ?? "");
      });

    for (const lot of order) {
      if (left <= 0) break;
      const draw = Math.min(lot.qty, left);
      left = roundQty(left - draw);
      const remaining = roundQty(lot.qty - draw);
      lots = remaining > 0
        ? lots.map((b) => (b.batchNo === lot.batchNo ? { ...b, qty: remaining } : b))
        : lots.filter((b) => b.batchNo !== lot.batchNo);
    }

    const scalar = roundQty(Math.max(0, Math.max(0, row.blockedQty ?? 0) - left));
    return {
      ...row,
      stock,
      batches: lots,
      blockedQty: scalar,
      blockedReason: scalar > 0 ? row.blockedReason : undefined,
    };
  });
}
