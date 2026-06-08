// Unified stock transaction ledger for the Stock Overview report. Stitches
// together every movement that touches an item — purchases (GRN receipts),
// transfers / issues, approved stock adjustments, and production / dispatch —
// into one chronological ledger with a running balance, mirroring the
// "Item Details" drill-down (Opening Balance → movements → Closing Balance).
//
// The workflow-store data (grns, transferNotes, stockDeltas) is in-memory React
// state, so the caller passes it in; stock adjustments are read from their
// persisted store. This keeps the ledger a pure, testable transform.
//
// Each row is costed via a caller-supplied `unitCostFor` resolver (see
// lib/item-cost.ts) so purchases price at their PO rate, batch issues at their
// FIFO/FEFO drawdown, and single-item issues at weighted-average cost.

import type { WfGRN, WfTransferNote, StockDelta } from "@/lib/workflow-store";
import type { Adjustment } from "@/lib/stock-adjustments";

export type LedgerEntry = {
  date: string;
  ts: number; // parsed timestamp for sorting (0 when the source has no date)
  reference: string;
  officeId?: string;
  warehouseId?: string;
  type: string;
  inQty: number;
  outQty: number;
  unitCost: number;
  value: number; // moved quantity × unit cost
};

export type ItemLedger = {
  opening: number;
  closing: number;
  totalIn: number;
  totalOut: number;
  /** Opening Balance row followed by each movement, each with a running balance. */
  rows: (LedgerEntry & { balance: number })[];
};

const ts = (date: string): number => {
  const t = Date.parse(date);
  return Number.isNaN(t) ? 0 : t;
};

export type LedgerSources = {
  grns: WfGRN[];
  transferNotes: WfTransferNote[];
  stockDeltas: StockDelta[];
  adjustments: Adjustment[];
};

/** A movement before costing — the shape passed to a `unitCostFor` resolver. */
export type RawMovement = Omit<LedgerEntry, "unitCost" | "value">;
export type UnitCostFor = (m: RawMovement) => number;

/**
 * Collect the raw movement entries (no opening row, unsorted) for one item.
 * An entry matches the item when its key equals the item code (id) or, case-
 * insensitively, the item name — the same dual-key match the report uses
 * elsewhere so deltas keyed by either form are caught. Each entry is costed
 * via `unitCostFor` (defaults to 0 for the qty-only totals path).
 */
export function collectItemMovements(
  itemId: string,
  itemName: string,
  src: LedgerSources,
  unitCostFor: UnitCostFor = () => 0,
): LedgerEntry[] {
  const name = itemName.toLowerCase();
  const matches = (key: string) => key === itemId || key.toLowerCase() === name;
  const raw: RawMovement[] = [];

  // Purchases — accepted GRN lines increase stock.
  for (const grn of src.grns) {
    for (const line of grn.lines) {
      if (line.qcStatus !== "Accepted") continue;
      if (!matches(line.itemId) && !matches(line.name)) continue;
      raw.push({
        date: grn.date, ts: ts(grn.date),
        reference: grn.poRef || grn.id,
        officeId: grn.officeId, warehouseId: grn.warehouseId,
        type: "Purchase (GRN)",
        inQty: line.qty, outQty: 0,
      });
    }
  }

  // Transfers / issues — goods leaving the store.
  for (const tn of src.transferNotes) {
    for (const it of tn.items) {
      if (!matches(it.id) && !matches(it.name)) continue;
      raw.push({
        date: tn.date, ts: ts(tn.date),
        reference: tn.id,
        officeId: tn.officeId, warehouseId: tn.warehouseId,
        type: "Transfer / Issue",
        inQty: 0, outQty: it.qty,
      });
    }
  }

  // Approved stock adjustments — increase or decrease.
  for (const a of src.adjustments) {
    if (a.status !== "Approved") continue;
    if (!matches(a.itemCode) && !matches(a.item)) continue;
    const inc = a.adjustType === "Increase";
    raw.push({
      date: a.date, ts: ts(a.date),
      reference: a.reference || a.id,
      type: `Stock Adjustment (${a.adjustType})`,
      inQty: inc ? a.adjustQty : 0,
      outQty: inc ? 0 : a.adjustQty,
    });
  }

  // Production (positive) / dispatch (negative) — finished-goods movements.
  for (const d of src.stockDeltas) {
    if (!matches(d.itemId)) continue;
    raw.push({
      date: "—", ts: 0,
      reference: "—",
      type: d.delta >= 0 ? "Production" : "Dispatch",
      inQty: d.delta >= 0 ? d.delta : 0,
      outQty: d.delta < 0 ? -d.delta : 0,
    });
  }

  return raw.map((m) => {
    const unitCost = unitCostFor(m);
    return { ...m, unitCost, value: (m.inQty + m.outQty) * unitCost };
  });
}

/**
 * Build the full ledger for an item. `closingStock` is the item's known current
 * quantity; the Opening Balance is back-computed so the running balance lands
 * exactly on it (closing = opening + totalIn − totalOut). `openingCost` prices
 * the opening row; `unitCostFor` prices each movement.
 */
export function buildItemLedger(
  itemId: string,
  itemName: string,
  closingStock: number,
  openingCost: number,
  unitCostFor: UnitCostFor,
  src: LedgerSources,
): ItemLedger {
  const moves = collectItemMovements(itemId, itemName, src, unitCostFor)
    .sort((a, b) => a.ts - b.ts);

  const totalIn = moves.reduce((s, m) => s + m.inQty, 0);
  const totalOut = moves.reduce((s, m) => s + m.outQty, 0);
  const opening = closingStock - totalIn + totalOut;

  const openingDate = moves.find((m) => m.ts > 0)?.date ?? "—";
  const rows: (LedgerEntry & { balance: number })[] = [
    {
      date: openingDate, ts: 0, reference: "Opening Balance",
      type: "Opening Balance",
      inQty: opening > 0 ? opening : 0,
      outQty: opening < 0 ? -opening : 0,
      unitCost: openingCost,
      value: opening * openingCost,
      balance: opening,
    },
  ];

  let balance = opening;
  for (const m of moves) {
    balance += m.inQty - m.outQty;
    rows.push({ ...m, balance });
  }

  return { opening, closing: closingStock, totalIn, totalOut, rows };
}

/** Lightweight In/Out totals for an item — used by the report's summary columns. */
export function itemMovementTotals(
  itemId: string,
  itemName: string,
  src: LedgerSources,
): { inQty: number; outQty: number } {
  const moves = collectItemMovements(itemId, itemName, src);
  return {
    inQty: moves.reduce((s, m) => s + m.inQty, 0),
    outQty: moves.reduce((s, m) => s + m.outQty, 0),
  };
}
