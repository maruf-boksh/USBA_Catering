// ─────────────────────────────────────────────────────────────────────────────
// Packaging allocations — a production run's share of ONE flight.
//
// A production run is many-to-many with flights: one day's Grilled Chicken run
// feeds every flight whose menu includes it, and one flight needs many runs. The
// packaging batch (a QC record) therefore cannot carry "the flight it is being
// packaged for" — it has one status field, so stamping a flight on it allowed a
// run to be packaged for exactly one flight, and the second flight silently
// could not have it.
//
// An allocation is the missing record: run × flight × quantity, with its own
// packaging lifecycle. Packaging BS-105 draws 86 portions from the run; BS-141
// later draws its own share from what remains. The run itself stays available
// until fully allocated.
// ─────────────────────────────────────────────────────────────────────────────

export type PackagingAllocationStatus =
  | "Pending Approval"      // run created from New Packaging, awaiting sign-off
  | "Rejected"              // sign-off declined — nothing packages against it
  | "In Packaging"          // approved and queued; labels not printed yet
  | "Packaged"              // labels printed — ready for dispatch
  | "Forwarded To Airport"
  | "Airport Approved"
  | "Received At Airport"
  | "Dispatched";

/** One production run's contribution to an assembled package. */
export type PackagingComponent = {
  /** The production run (PRO-… / PRD-…). */
  productionId: string;
  /** The QC/packaging batch it was picked from (PackagingBatch.id). */
  batchId: string;
  /** The cooked dish. */
  item: string;
  /** Portions of it consumed by this package — one per meal, per dish. */
  qty: number;
};

export type PackagingAllocation = {
  id: string;                 // PKA-…
  /** Display id shown on the list and the label (derived from the run). */
  packagingId: string;
  /** The QC/packaging batch this draws from (PackagingBatch.id). For an
   *  assembled set this is the PRIMARY component's batch — the full picture is
   *  in `components`. */
  batchId: string;
  /** The production run (PRO-… / PRD-…); the primary component's, for a set. */
  productionId: string;
  item: string;
  /**
   * Special-meal code (VGML / CHML / …) when this package is an assembled MEAL
   * rather than a single run's output. Menu planning defines such a meal as 2-3
   * component dishes, each cooked as its own run; packaging combines them into
   * one finished good with one label. `qty` is then meals, not portions.
   */
  setCode?: string;
  /** Every run this package draws on. Present only for assembled sets — a plain
   *  package draws on `productionId` alone. */
  components?: PackagingComponent[];
  /** The flight this share is packaged for, and its order. */
  flight: string;
  orderNo?: string;
  date: string;               // the flight order's departure date
  depTime?: string;
  /** This flight's share of the run — NOT the run's day total. */
  qty: number;
  status: PackagingAllocationStatus;
  createdAt: string;
  createdBy?: string;
  /** Packaging-run sign-off, granted in Approval Management (not on this page). */
  approvedBy?: string;
  approvedAt?: string;
  rejectedReason?: string;
  packagedAt?: string;
  dispatchId?: string;
};

/** Statuses at or beyond "labels printed". */
const PACKAGED_ONWARD: PackagingAllocationStatus[] = [
  "Packaged", "Forwarded To Airport", "Airport Approved", "Received At Airport", "Dispatched",
];

export function isPackaged(a: PackagingAllocation): boolean {
  return PACKAGED_ONWARD.includes(a.status);
}

/** Created but not yet signed off — no labels, no dispatch, until it is. */
export function isAwaitingApproval(a: PackagingAllocation): boolean {
  return a.status === "Pending Approval";
}

/**
 * The runs a package draws on, uniformly: its components when it is an assembled
 * set, otherwise the single run it was created from. Everything that accounts
 * for run consumption goes through this, so a set draws its components down the
 * same way a plain package draws down its own run.
 */
export function allocationRuns(a: PackagingAllocation): PackagingComponent[] {
  return a.components && a.components.length > 0
    ? a.components
    : [{ productionId: a.productionId, batchId: a.batchId, item: a.item, qty: a.qty }];
}

/** Does this package draw on the given run (directly, or as a set component)? */
export function usesRun(a: PackagingAllocation, productionId: string): boolean {
  return allocationRuns(a).some((r) => r.productionId === productionId);
}

/**
 * How much of a run is already committed to flights.
 *
 * A rejected allocation commits nothing — its portions go back to the pool so
 * the run can be packaged for that flight again, or for another one.
 */
export function allocatedQtyOfRun(list: PackagingAllocation[], productionId: string): number {
  return list.reduce((s, a) => {
    if (a.status === "Rejected") return s;
    return s + allocationRuns(a)
      .filter((r) => r.productionId === productionId)
      .reduce((n, r) => n + r.qty, 0);
  }, 0);
}

/**
 * What is left of a run to allocate. `produced` is the run's day total; a run
 * with nothing left no longer appears in the New Packaging pool.
 */
export function remainingQtyOfRun(
  list: PackagingAllocation[], productionId: string, produced: number,
): number {
  return Math.max(0, produced - allocatedQtyOfRun(list, productionId));
}

/** The flights a run has already been allocated to (for "also serving" notes). */
export function flightsOfRun(list: PackagingAllocation[], productionId: string): string[] {
  return [...new Set(list.filter((a) => usesRun(a, productionId)).map((a) => a.flight))];
}

/**
 * Allocation already recorded for this run on this flight+date, if any — set
 * packages included, since a run committed through a meal is just as committed
 * as one packaged on its own.
 */
export function existingAllocation(
  list: PackagingAllocation[], productionId: string, flight: string, date: string,
): PackagingAllocation | undefined {
  return list.find((a) => usesRun(a, productionId) && a.flight === flight && a.date === date);
}

/**
 * The LOOSE package already recorded for this run on this flight+date — special
 * meals excluded. A dish is a pool with several consumers: its own menu line and
 * whatever special meals contain it. Packaging the VGML must not lock the dish's
 * own line, because the portions the kit reserved are not the portions the PAX
 * line needs. Use this wherever the question is "is this dish's own line already
 * packaged?"; use `existingAllocation` where the question is "is any of this run
 * spoken for?".
 */
export function existingRunAllocation(
  list: PackagingAllocation[], productionId: string, flight: string, date: string,
): PackagingAllocation | undefined {
  return list.find((a) => !a.setCode && a.productionId === productionId
    && a.flight === flight && a.date === date);
}

/** The meal package already recorded for this code on this flight+date, if any. */
export function existingSetAllocation(
  list: PackagingAllocation[], setCode: string, flight: string, date: string,
): PackagingAllocation | undefined {
  return list.find((a) => a.setCode === setCode && a.flight === flight && a.date === date);
}

/** Every dish a package puts on the trolley — its components, or its own item. */
export function allocationItems(a: PackagingAllocation): string[] {
  return a.components && a.components.length > 0 ? a.components.map((c) => c.item) : [a.item];
}

let seq = 0;
/** Stable-ish unique id; the counter guards same-millisecond creation. */
export function newAllocationId(): string {
  return `PKA-${Date.now().toString(36).toUpperCase()}-${(seq++).toString(36)}`;
}
