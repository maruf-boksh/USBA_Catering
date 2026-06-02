import { useSyncExternalStore } from "react";
import {
  seedFlightOrders,
  type FlightOrderRow,
  type FlightOrderStatus,
} from "@/lib/sample-data";

// ─────────────────────────────────────────────────────────────────────────────
// Flight-orders store — single source of truth for the Order Management page
// AND the dashboard's "Active Orders" panel (and any other surface that needs
// to react to order create / edit / status-advance events).
//
// In-memory only (session-scoped). The seeded data is huge (~3k rows after
// the procedural generator) and we don't want to bloat localStorage; users
// who add orders in this session will see them everywhere, and a refresh
// restarts from the seed snapshot.
// ─────────────────────────────────────────────────────────────────────────────

export type FlightOrder = FlightOrderRow;

let current: FlightOrder[] = [...seedFlightOrders];
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function getFlightOrders(): FlightOrder[] {
  return current;
}

export function setFlightOrders(next: FlightOrder[]) {
  current = next;
  notify();
}

/** Prepends new orders (UI convention: newest first). */
export function addFlightOrders(orders: FlightOrder[]) {
  current = [...orders, ...current];
  notify();
}

/** Replaces a single order by id; no-op if not found. */
export function updateFlightOrder(id: string, patch: Partial<FlightOrder>) {
  let changed = false;
  const next = current.map((o) => {
    if (o.id !== id) return o;
    changed = true;
    return { ...o, ...patch };
  });
  if (changed) {
    current = next;
    notify();
  }
}

/** Status-only mutation (the common case). */
export function updateFlightOrderStatus(id: string, status: FlightOrderStatus) {
  updateFlightOrder(id, { status });
}

/** Bulk replace by id-matching predicate. Used by "advance order" flows that
 *  move every leg of an order forward together. Returns the number of rows
 *  that matched and were patched (callers use it to surface a toast). */
export function updateFlightOrdersWhere(
  predicate: (o: FlightOrder) => boolean,
  patch: Partial<FlightOrder>,
): number {
  let changedCount = 0;
  const next = current.map((o) => {
    if (!predicate(o)) return o;
    changedCount += 1;
    return { ...o, ...patch };
  });
  if (changedCount > 0) {
    current = next;
    notify();
  }
  return changedCount;
}

export function subscribeFlightOrders(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useFlightOrders(): FlightOrder[] {
  return useSyncExternalStore(
    (cb) => subscribeFlightOrders(cb),
    getFlightOrders,
    getFlightOrders,
  );
}
