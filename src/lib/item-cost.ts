// Cost-of-goods helpers shared by the Stock Overview ledger and elsewhere.
//
// Two costing models, picked per item by `isBatchTrackedForInventory`:
//   • Batch-tracked items → FIFO/FEFO drawdown via `allocate()` — each
//     consumption is costed from the actual lots it draws (e.g. 140 / 150 / 148).
//   • Single (non-batch) items → moving Weighted Average Cost (WAC): one running
//     average that re-blends on every purchase and is charged out on every issue.

import { allocate } from "@/lib/sample-data";
import type { WfPurchaseOrder } from "@/lib/workflow-store";

export type CostLot = { qty: number; costPrice: number };

/** Weighted-average unit cost of a set of lots (Σ qty·cost ÷ Σ qty). */
export function weightedAvg(lots: CostLot[]): number {
  const q = lots.reduce((s, b) => s + b.qty, 0);
  if (q <= 0) return lots[0]?.costPrice ?? 0;
  return lots.reduce((s, b) => s + b.qty * b.costPrice, 0) / q;
}

/**
 * Purchase rate for an item on a given GRN — resolved from the linked PO's line
 * price (`grn.poRef` → PO → lineItem.unitPrice). Returns undefined when the PO
 * or line can't be found so the caller can fall back to the item's cost basis.
 */
export function poUnitPrice(
  poRef: string,
  itemId: string,
  itemName: string,
  pos: WfPurchaseOrder[],
): number | undefined {
  const po = pos.find((p) => p.id === poRef);
  const name = itemName.toLowerCase();
  const li = po?.lineItems?.find((l) => l.itemId === itemId || l.name.toLowerCase() === name);
  return li?.unitPrice;
}

/**
 * FIFO/FEFO blended unit cost for drawing `qty` of a batch-tracked item — the
 * total cost of the lots it would consume, per unit. Falls back to `fallback`
 * (typically the item's average cost) when nothing can be allocated.
 */
export function blendedOutCost(itemId: string, qty: number, fallback: number): number {
  if (qty <= 0) return fallback;
  const r = allocate(itemId, qty);
  return r.allocated > 0 ? r.totalCost / r.allocated : fallback;
}

/**
 * Moving Weighted Average Cost for a single (non-batch) item: start from the
 * opening stock at its cost basis, then re-blend in each purchase. The result
 * is the average that every issue is charged out at.
 */
export function movingAverage(
  openingQty: number,
  openingCost: number,
  purchases: { qty: number; rate: number }[],
): number {
  let q = Math.max(0, openingQty);
  let v = q * openingCost;
  for (const p of purchases) {
    q += p.qty;
    v += p.qty * p.rate;
  }
  return q > 0 ? v / q : openingCost;
}
