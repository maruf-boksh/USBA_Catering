/**
 * expired-disposal.ts — the queue between Stock Ageing & Alerts and Wastage
 * Management.
 * ─────────────────────────────────────────────────────────────────────────────
 * Escalating expired lots from the ageing tracker does not create the disposal
 * report itself; it puts each lot on this queue. Wastage Management picks the
 * queue up under the "Expired Product Disposal" type, so a storekeeper can
 * dispose every queued lot at once or clear them in batches over several days —
 * the queue records which lots have been disposed and which are still waiting.
 *
 * Nothing here touches stock. A queued lot only affects inventory once its
 * disposal report clears the existing wastage approval chain.
 */

export type ExpiredLotStatus = "Pending Disposal" | "Disposed";

export type ExpiredDisposalLot = {
  /** Ageing row id — also the key back to the alert's review trail. */
  id: string;
  alertNo: string;
  itemCode: string;
  itemName: string;
  category: string;
  uom: string;
  batchNo: string;
  receivedOn: string;
  expiry: string;
  ageDays: number;
  /** Quantity held in this lot — the quantity to dispose. */
  qty: number;
  unitCost: number;
  officeId: string;
  warehouseId: string;
  /** Alert level at the time of escalation (Expired, Critical, …). */
  level: string;
  escalatedBy: string;
  escalatedAt: string;
  status: ExpiredLotStatus;
  /** Disposal report that cleared this lot. */
  wastageRef?: string;
  disposedAt?: string;
};

/** Shared persisted key — both the ageing page and Wastage Management use it. */
export const EXPIRED_QUEUE_KEY = "expired-disposal-queue";
const STORAGE_KEY = `harvest-data-v1:${EXPIRED_QUEUE_KEY}`;

/** Read the queue. Best-effort: a missing or corrupt store reads as empty. */
export function getExpiredQueue(): ExpiredDisposalLot[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw != null) {
      const parsed = JSON.parse(raw) as ExpiredDisposalLot[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* unavailable / corrupt — treat as empty */
  }
  return [];
}

export const pendingLots = (queue: ExpiredDisposalLot[]): ExpiredDisposalLot[] =>
  queue.filter((l) => l.status === "Pending Disposal");

export const disposedLots = (queue: ExpiredDisposalLot[]): ExpiredDisposalLot[] =>
  queue.filter((l) => l.status === "Disposed");

/** Headline counts for the "how many disposed, how many left" tracker. */
export function queueCounts(queue: ExpiredDisposalLot[]): {
  total: number; disposed: number; pending: number;
  totalQty: number; disposedQty: number; pendingQty: number;
  pendingValue: number;
} {
  const disposed = disposedLots(queue);
  const pending = pendingLots(queue);
  const qty = (list: ExpiredDisposalLot[]) => list.reduce((s, l) => s + l.qty, 0);
  return {
    total: queue.length,
    disposed: disposed.length,
    pending: pending.length,
    totalQty: qty(queue),
    disposedQty: qty(disposed),
    pendingQty: qty(pending),
    pendingValue: pending.reduce((s, l) => s + l.qty * l.unitCost, 0),
  };
}

/** The queue entry for an ageing row, if it has been escalated. */
export function lotForAlert(queue: ExpiredDisposalLot[], rowId: string): ExpiredDisposalLot | undefined {
  return queue.find((l) => l.id === rowId);
}

/** Mark lots disposed against the report that cleared them. */
export function markDisposed(
  queue: ExpiredDisposalLot[],
  ids: string[],
  wastageRefById: Record<string, string>,
  at: string,
): ExpiredDisposalLot[] {
  const set = new Set(ids);
  return queue.map((l) =>
    set.has(l.id)
      ? { ...l, status: "Disposed" as const, wastageRef: wastageRefById[l.id] ?? l.wastageRef, disposedAt: at }
      : l,
  );
}
