import { useSyncExternalStore } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Order Summary quantity adjustments — a request to increase/decrease the Total
// Meals for one Order-Summary line (a Date × Flight-Type bucket) on the Order
// Management screen. Each request is routed to Approval Management; only once
// Approved does its delta apply to the effective total shown in the summary.
//
// Stored under localStorage["harvest-order-summary-adjustments-v1"] as an array
// and exposed via a useSyncExternalStore singleton so the Order Management tab
// and the Approval Management queue always agree.
// ─────────────────────────────────────────────────────────────────────────────

export type AdjustStatus = "Pending" | "Approved" | "Rejected";
export type FlightTypeScope = "Domestic" | "International";

export type OrderSummaryAdjustment = {
  id: string;
  date: string;                 // the summary line's date (YYYY-MM-DD)
  flightType: FlightTypeScope;  // the summary line's flight type
  baseTotal: number;            // computed Total Meals at request time
  newTotal: number;             // requested Total Meals
  delta: number;                // newTotal − baseTotal (may be negative)
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: AdjustStatus;
  processedBy?: string;
  processedAt?: string;
  rejectionReason?: string;
};

const STORAGE_KEY = "harvest-order-summary-adjustments-v1";

/** Stable key for a summary line — a Date × Flight-Type bucket. */
export function adjustmentKey(date: string, flightType: FlightTypeScope): string {
  return `${date}__${flightType}`;
}

function load(): OrderSummaryAdjustment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as OrderSummaryAdjustment[]) : [];
  } catch {
    return [];
  }
}

function persist(rows: OrderSummaryAdjustment[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    /* quota / unavailable — fail silent */
  }
}

let current: OrderSummaryAdjustment[] = load();
const listeners = new Set<() => void>();

function emit() {
  persist(current);
  for (const l of listeners) l();
}

export function getOrderSummaryAdjustments(): OrderSummaryAdjustment[] {
  return current;
}

/** Raise a new adjustment request (Pending). Returns the created record. */
export function addOrderSummaryAdjustment(input: {
  date: string;
  flightType: FlightTypeScope;
  baseTotal: number;
  newTotal: number;
  reason: string;
  requestedBy: string;
  requestedAt: string;
}): OrderSummaryAdjustment {
  const rec: OrderSummaryAdjustment = {
    id: `MQA-${Date.now().toString(36).toUpperCase()}`,
    date: input.date,
    flightType: input.flightType,
    baseTotal: input.baseTotal,
    newTotal: input.newTotal,
    delta: input.newTotal - input.baseTotal,
    reason: input.reason,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    status: "Pending",
  };
  current = [rec, ...current];
  emit();
  return rec;
}

/** Flip a request's status (Approve / Reject) and stamp the processor. */
export function setOrderSummaryAdjustmentStatus(
  id: string,
  status: AdjustStatus,
  by: string,
  extra?: { at?: string; rejectionReason?: string },
) {
  current = current.map((r) =>
    r.id === id
      ? {
          ...r,
          status,
          processedBy: by,
          processedAt: extra?.at ?? r.processedAt,
          rejectionReason: status === "Rejected" ? extra?.rejectionReason : undefined,
        }
      : r,
  );
  emit();
}

/** Net approved delta applied to a summary line (sum of Approved deltas). */
export function approvedDeltaFor(date: string, flightType: FlightTypeScope): number {
  return current
    .filter((r) => r.status === "Approved" && r.date === date && r.flightType === flightType)
    .reduce((s, r) => s + r.delta, 0);
}

/** The most recent still-Pending request for a summary line, if any. */
export function pendingAdjustmentFor(
  date: string,
  flightType: FlightTypeScope,
): OrderSummaryAdjustment | undefined {
  return current.find((r) => r.status === "Pending" && r.date === date && r.flightType === flightType);
}

export function subscribeOrderSummaryAdjustments(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useOrderSummaryAdjustments(): OrderSummaryAdjustment[] {
  return useSyncExternalStore(
    subscribeOrderSummaryAdjustments,
    getOrderSummaryAdjustments,
    getOrderSummaryAdjustments,
  );
}
