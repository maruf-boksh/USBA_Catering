// Packaging pipeline — a stage that sits between Cooking Temp & Sensory QC and
// Dispatch. A batch that passed BOTH temperature and taste (a cooking-temp
// record with `sensoryPass === true`) is pulled in here as "Pending Approval",
// approved in Approval Management, then packaged (print + scan labels) before it
// is handed to Dispatch.
//
// This module is read-only over the existing `cooking-temp-records` store — it
// never mutates QC data, so the Cooking Temp flow is untouched. The packaging
// lifecycle lives in its own persisted store, `packaging-batches`.

const PREFIX = "harvest-data-v1:";

export type PackagingBatchStatus =
  | "Pending Approval"
  | "Approved"
  | "Rejected"
  | "Packaging In Progress"
  | "Packaging Done"
  | "Forwarded To Airport"   // loaded onto vehicle, awaiting Dispatch approval
  | "Airport Approved"       // dispatch approved — ready for airport receive
  | "Received At Airport"    // scanned/received at the airport store
  | "Dispatched";

export type PackagingBatch = {
  id: string;            // QC log id (CT-…) — unique per passed batch
  batch: string;         // production order id (PRO-2026-…)
  item: string;
  qty: number;           // produced qty (looked up from the production entry)
  /** Where the run was produced — copied from the production entry when the
   *  batch is created, so it survives independently of that entry. */
  warehouseId?: string;
  officeId?: string;
  standardTemp: string;  // e.g. "≥75°C"
  measuredTemp: number;
  thresholdTemp?: number;
  taste?: string;
  cookedBy: string;
  checkedBy: string;
  date: string;
  status: PackagingBatchStatus;
  approvedBy?: string;
  approvedAt?: string;
  // ── Per-flight packaging ────────────────────────────────────────────────────
  // A production run serves MANY flights (one day's Grilled Chicken run covers
  // every flight whose menu includes it), so `qty` above is the run's day total,
  // not a flight quantity. These record which flight the run was actually
  // packaged for and how much of it that flight takes — stamped when the run is
  // queued from New Packaging.
  packagedForFlight?: string;
  packagedForOrderNo?: string;
  packagedQty?: number;
  packagedAt?: string;
  dispatchId?: string;     // assigned when packaged — the ready-to-load dispatch ref
  vehicleNo?: string;      // set when loaded at the catering point
  dispatchedAt?: string;   // forwarded to airport
  airportApprovedBy?: string;
  airportApprovedAt?: string;
  receivedAt?: string;     // received at the airport store
};

// Minimal shape of a persisted cooking-temp record we read from.
type CookingRecordLite = {
  id: string;
  batch: string;
  item: string;
  standardTemp: string;
  standardTempMin: number;
  measuredTemp: number;
  thresholdTemp?: number;
  taste?: string;
  cookedBy: string;
  checkedBy: string;
  date: string;
  sensoryPass: boolean;
};

/** QC records where BOTH temperature and taste passed (sensoryPass === true). */
export function readPassedQcRecords(): CookingRecordLite[] {
  try {
    const raw = localStorage.getItem(PREFIX + "cooking-temp-records");
    if (!raw) return [];
    const arr = JSON.parse(raw) as CookingRecordLite[];
    return Array.isArray(arr) ? arr.filter((r) => r && r.sensoryPass) : [];
  } catch {
    return [];
  }
}

// Packaging lifecycle order — used to decide which of two rows for the same
// production order is the one to keep (the furthest along wins).
const STATUS_RANK: Record<PackagingBatchStatus, number> = {
  "Rejected": 0,
  "Pending Approval": 1,
  "Approved": 2,
  "Packaging In Progress": 3,
  "Packaging Done": 4,
  "Forwarded To Airport": 5,
  "Airport Approved": 6,
  "Received At Airport": 7,
  "Dispatched": 8,
};

/**
 * Collapse rows that describe the same production order down to one.
 *
 * A production order can be signed off more than once — the three QC surfaces
 * (single, bulk, mobile) each append a fresh CT-… record, and a re-cook adds
 * another pass on top. Keyed only by QC log id, every one of those became its
 * own packaging row, all carrying the SAME PKG-… id (it is derived from the
 * production order), which is what surfaced as duplicate lines in the list.
 *
 * The survivor is the row furthest through the packaging lifecycle, tie-broken
 * on the later QC date, so progress already made is never thrown away. The QC
 * records themselves are untouched — this store is derived from them.
 * Returns the same array reference when there is nothing to collapse.
 */
export function dedupeByProduction(list: PackagingBatch[]): PackagingBatch[] {
  const winner = new Map<string, PackagingBatch>();
  let duplicated = false;
  for (const b of list) {
    const cur = winner.get(b.batch);
    if (!cur) { winner.set(b.batch, b); continue; }
    duplicated = true;
    const rank = STATUS_RANK[b.status] ?? 0;
    const curRank = STATUS_RANK[cur.status] ?? 0;
    if (rank > curRank || (rank === curRank && b.date > cur.date)) winner.set(b.batch, b);
  }
  if (!duplicated) return list;
  const keep = new Set([...winner.values()].map((b) => b.id));
  return list.filter((b) => keep.has(b.id));   // original ordering preserved
}

/**
 * Idempotently merge newly-passed QC batches into the packaging list as
 * "Pending Approval", one row per production order. Returns the same array
 * reference when nothing is new or duplicated, so callers can guard against
 * redundant state updates.
 */
export function mergePassedBatches(
  existing: PackagingBatch[],
  qtyFor?: (productionId: string) => number,
  /** Production-entry facts to copy onto the batch (warehouse it was produced in). */
  metaFor?: (productionId: string) => { warehouseId?: string; officeId?: string } | undefined,
): PackagingBatch[] {
  const deduped = dedupeByProduction(existing);
  const have = new Set(deduped.map((b) => b.id));
  const haveProduction = new Set(deduped.map((b) => b.batch));
  const passed = readPassedQcRecords();
  const additions: PackagingBatch[] = [];
  for (const r of passed) {
    if (have.has(r.id)) continue;
    // A second passing QC for a production order already in the list (re-cook,
    // or a sign-off repeated from another surface) updates nothing and must not
    // raise a second row — it would be indistinguishable from the first.
    if (haveProduction.has(r.batch)) continue;
    haveProduction.add(r.batch);
    additions.push({
      id: r.id,
      batch: r.batch,
      item: r.item,
      qty: qtyFor?.(r.batch) ?? 0,
      warehouseId: metaFor?.(r.batch)?.warehouseId,
      officeId: metaFor?.(r.batch)?.officeId,
      standardTemp: r.standardTemp,
      measuredTemp: r.measuredTemp,
      thresholdTemp: r.thresholdTemp,
      taste: r.taste,
      cookedBy: r.cookedBy,
      checkedBy: r.checkedBy,
      date: r.date,
      status: "Pending Approval",
    });
  }
  return additions.length ? [...additions, ...deduped] : deduped;
}
