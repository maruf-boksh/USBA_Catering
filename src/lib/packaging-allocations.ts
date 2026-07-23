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

export type PackagingAllocation = {
  id: string;                 // PKA-…
  /** Display id shown on the list and the label (derived from the run). */
  packagingId: string;
  /** The QC/packaging batch this draws from (PackagingBatch.id). */
  batchId: string;
  /** The production run (PRO-… / PRD-…). */
  productionId: string;
  item: string;
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
 * How much of a run is already committed to flights.
 *
 * A rejected allocation commits nothing — its portions go back to the pool so
 * the run can be packaged for that flight again, or for another one.
 */
export function allocatedQtyOfRun(list: PackagingAllocation[], productionId: string): number {
  return list.reduce(
    (s, a) => (a.productionId === productionId && a.status !== "Rejected" ? s + a.qty : s),
    0,
  );
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
  return [...new Set(list.filter((a) => a.productionId === productionId).map((a) => a.flight))];
}

/** Allocation already recorded for this run on this flight+date, if any. */
export function existingAllocation(
  list: PackagingAllocation[], productionId: string, flight: string, date: string,
): PackagingAllocation | undefined {
  return list.find((a) => a.productionId === productionId && a.flight === flight && a.date === date);
}

let seq = 0;
/** Stable-ish unique id; the counter guards same-millisecond creation. */
export function newAllocationId(): string {
  return `PKA-${Date.now().toString(36).toUpperCase()}-${(seq++).toString(36)}`;
}
