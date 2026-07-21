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

/**
 * Idempotently merge newly-passed QC batches into the packaging list as
 * "Pending Approval". Returns the same array reference when nothing is new, so
 * callers can guard against redundant state updates.
 */
export function mergePassedBatches(
  existing: PackagingBatch[],
  qtyFor?: (productionId: string) => number,
): PackagingBatch[] {
  const have = new Set(existing.map((b) => b.id));
  const passed = readPassedQcRecords();
  const additions: PackagingBatch[] = [];
  for (const r of passed) {
    if (have.has(r.id)) continue;
    additions.push({
      id: r.id,
      batch: r.batch,
      item: r.item,
      qty: qtyFor?.(r.batch) ?? 0,
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
  return additions.length ? [...additions, ...existing] : existing;
}
