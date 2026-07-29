/**
 * Delay Management — fulfilment from existing production.
 *
 * When a flight is delayed, the meals it needs may already be sitting in the
 * kitchen: they were cooked for the scheduled flights of the day. In that case
 * there is no reason to raise a fresh production order or to spot-buy — the
 * finished meals simply move from the production warehouse to the airport-side
 * store on a normal Transfer Request.
 *
 * This module works out what is available, tracks what has already been
 * committed to earlier delay fulfilments (so the same batch is never promised
 * twice), and keeps an audit log. It owns no UI and mutates nothing itself —
 * the caller persists what it returns.
 */

import type { WfProductionEntry } from "@/lib/workflow-store";
import type { TransferRequest } from "@/routes/transfer-request";

// ── Storage keys (usePersistedState — "harvest-data-v1:" prefixed) ───────────

export const DPF_KEY = "delay-production-fulfillments";
export const DPF_LOG_KEY = "delay-production-fulfillment-log";

// ── Records ─────────────────────────────────────────────────────────────────

/** One meal line drawn from one completed production run. */
export type DpfLine = {
  itemName: string;
  uom: string;
  /** Quantity being pulled — the editable "Req Qty" on the modal. */
  requiredQty: number;
  productionId: string;
  bom: string;
  /** Snapshot of the run's output at the time of the pull. Never editable. */
  producedQty: number;
  productionDate: string;
  completedAt?: string;
};

/** A raised "fulfil from production" request, linked to its Transfer Request. */
export type DelayProductionFulfillment = {
  id: string;
  eventId: string;
  flightNumber: string;
  flightDate: string;
  /** The Transfer Request this raised — the approval + movement happen there. */
  transferRequestId: string;
  fromOfficeId: string;
  /** Sending (production) warehouse NAME — the Transfer store is keyed by name. */
  fromWarehouse: string;
  toOfficeId: string;
  /** Receiving (airport-side) warehouse NAME. */
  toWarehouse: string;
  lines: DpfLine[];
  totalQty: number;
  raisedBy: string;
  raisedAt: string;
};

/** Audit trail — batch look-ups and raised fulfilments both land here. */
export type DpfLogEntry = {
  at: string;
  by: string;
  action:
    | "Production Batch Viewed"
    | "Fulfilment Raised"
    | "Transfer Request Approved";
  detail: string;
  productionId?: string;
  eventId?: string;
  ref?: string;
};

// ── Availability ────────────────────────────────────────────────────────────

/** One completed production run offered as a source for a delayed flight. */
export type ProductionBatchOption = {
  productionId: string;
  bom: string;
  outputItemName: string;
  /** Good quantity the run produced. */
  producedQty: number;
  /** Already promised to earlier delay fulfilments. */
  committedQty: number;
  /** producedQty − committedQty, floored at 0. */
  availableQty: number;
  productionDate: string;
  completedAt?: string;
  qcPassedAt?: string;
  qcCheckedBy?: string;
  officeId?: string;
  warehouseId?: string;
  /** Scheduled flight orders this run was cooked for. */
  servesOrderNos?: string[];
};

/** A required meal item, resolved against completed production. */
export type ItemAvailability = {
  itemName: string;
  uom: string;
  requiredQty: number;
  batches: ProductionBatchOption[];
  /** Total still available across every batch of this item. */
  availableQty: number;
  /** True when production can cover the full required quantity. */
  covered: boolean;
  /** True when at least some of the requirement can be met from production. */
  partial: boolean;
};

/**
 * How much of each completed run has already been promised to delay
 * fulfilments raised earlier. Keyed by production order id.
 */
export function committedByProduction(
  records: DelayProductionFulfillment[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const rec of records) {
    for (const line of rec.lines) {
      map.set(line.productionId, (map.get(line.productionId) ?? 0) + line.requiredQty);
    }
  }
  return map;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * A production run counts as a usable source only once it is finished, has good
 * output AND has passed QC. Runs still cooking, awaiting QC, or failed are not
 * offered — a delayed flight may only be fed meals that have cleared quality.
 */
export const isUsableRun = (e: WfProductionEntry): boolean =>
  e.status === "Completed" && (e.producedQty ?? 0) > 0 && !!e.qcPassedAt;

/**
 * Resolve each required meal item against completed production, oldest batch
 * first so the earliest cooked meals are consumed before fresher ones.
 *
 * `onDate` scopes the search to meals cooked for that day's flights — a delayed
 * flight is fed from the same day's kitchen output, not from an older run.
 */
export function buildProductionAvailability(
  items: { name: string; requiredQty: number; uom: string }[],
  entries: WfProductionEntry[],
  committed: Map<string, number>,
  onDate?: string,
): ItemAvailability[] {
  return items.map((mi) => {
    const batches: ProductionBatchOption[] = entries
      .filter((e) => isUsableRun(e)
        && (!onDate || e.date === onDate)
        && norm(e.outputItemName ?? e.bom ?? "") === norm(mi.name))
      .map((e) => {
        const producedQty = e.producedQty ?? 0;
        const committedQty = committed.get(e.id) ?? 0;
        return {
          productionId: e.id,
          bom: e.bom,
          outputItemName: e.outputItemName ?? e.bom,
          producedQty,
          committedQty,
          availableQty: Math.max(0, producedQty - committedQty),
          productionDate: e.date,
          completedAt: e.completedAt,
          qcPassedAt: e.qcPassedAt,
          qcCheckedBy: e.qcCheckedBy,
          officeId: e.officeId,
          warehouseId: e.warehouseId,
          servesOrderNos: e.servesOrderNos,
        };
      })
      // Oldest completed run first (FIFO); undated runs sort last.
      .sort((a, b) => (a.completedAt ?? a.productionDate ?? "~").localeCompare(b.completedAt ?? b.productionDate ?? "~"))
      .filter((b) => b.availableQty > 0);

    const availableQty = batches.reduce((s, b) => s + b.availableQty, 0);
    return {
      itemName: mi.name,
      uom: mi.uom,
      requiredQty: mi.requiredQty,
      batches,
      availableQty,
      covered: availableQty >= mi.requiredQty && mi.requiredQty > 0,
      partial: availableQty > 0,
    };
  });
}

/** True when at least one required item can be drawn from production. */
export const hasProductionCover = (avail: ItemAvailability[]): boolean =>
  avail.some((a) => a.partial);

// ── Sourcing plan ───────────────────────────────────────────────────────────

/**
 * Where a required quantity comes from. Meals the kitchen makes are pulled from
 * finished production; bought-in consumables (water, juice, meal boxes) come off
 * the shelf when there is stock, and are spot-bought when there is not.
 */
export type FulfilSource = "Production" | "Stock" | "Instant Purchase";

/** One required item on one delayed flight, split across its sources. */
export type PlanLine = {
  key: string;
  eventId: string;
  flightNumber: string;
  itemName: string;
  uom: string;
  requiredQty: number;
  /** Whether this is a kitchen output or a bought-in consumable. */
  produced: boolean;
  /** QC-passed quantity cooked for the day, before this plan draws on it. */
  availableProduction: number;
  /** On-hand stock — only consulted for bought-in consumables. */
  availableStock: number;
  /** Editable: how much to pull from production. Capped at availableProduction. */
  productionQty: number;
  /** Auto: consumables covered from existing stock. */
  stockQty: number;
  /** Batches the production draw maps onto, oldest first. */
  batches: ProductionBatchOption[];
};

/** Quantity still unaccounted for once production and stock are applied. */
export const shortfallOf = (l: PlanLine): number =>
  Math.max(0, l.requiredQty - l.productionQty - l.stockQty);

/** The source a line predominantly draws on — for the modal's Source column. */
export function sourceOf(l: PlanLine): FulfilSource {
  if (l.productionQty > 0) return "Production";
  if (l.stockQty > 0) return "Stock";
  return "Instant Purchase";
}

/** How much of a batch this plan has already spoken for, across all lines. */
export function batchDraw(lines: PlanLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const l of lines) {
    let left = l.productionQty;
    for (const b of l.batches) {
      if (left <= 0) break;
      const take = Math.min(left, b.availableQty);
      map.set(b.productionId, (map.get(b.productionId) ?? 0) + take);
      left -= take;
    }
  }
  return map;
}

/** Split a line's production draw into per-batch allocations, oldest first. */
export function allocateToBatches(l: PlanLine): { batch: ProductionBatchOption; qty: number }[] {
  const out: { batch: ProductionBatchOption; qty: number }[] = [];
  let left = l.productionQty;
  for (const b of l.batches) {
    if (left <= 0) break;
    const take = Math.min(left, b.availableQty);
    if (take > 0) out.push({ batch: b, qty: take });
    left -= take;
  }
  return out;
}

/**
 * Read the Transfer Request store directly. Deliberately NOT `usePersistedState`
 * for read-only callers: a second writable copy of the same key would hold a
 * stale array in memory and could write it back over a newly-raised request.
 */
export function readTransferRequests(seed: TransferRequest[]): TransferRequest[] {
  try {
    const raw = window.localStorage.getItem(`harvest-data-v1:${TR_KEY}`);
    if (!raw) return seed;
    const parsed = JSON.parse(raw) as TransferRequest[];
    return Array.isArray(parsed) ? parsed : seed;
  } catch {
    return seed;
  }
}

/** Matches TR_STORAGE_KEY in routes/transfer-request. */
const TR_KEY = "transfer-request-rows";

// ── Id generation ───────────────────────────────────────────────────────────

const nextSeq = (ids: string[], prefix: string): number =>
  ids.reduce((max, id) => {
    if (!id.startsWith(prefix)) return max;
    const n = parseInt(id.slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0) + 1;

export function nextDpfId(records: DelayProductionFulfillment[]): string {
  return `DPF-${String(nextSeq(records.map((r) => r.id), "DPF-")).padStart(4, "0")}`;
}

/**
 * Next Transfer Request id. Mirrors the Transfer Request page's `TR-7xxx`
 * series and takes the highest existing number so the two never collide.
 */
export function nextTransferRequestId(rows: TransferRequest[]): string {
  const highest = rows.reduce((max, r) => {
    const n = parseInt(r.id.replace(/^TR-/, ""), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 7000);
  return `TR-${highest + 1}`;
}
