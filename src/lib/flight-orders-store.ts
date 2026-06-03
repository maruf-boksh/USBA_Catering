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
// The seeded data is huge (~3k rows after the procedural generator) so we do
// NOT persist the whole list to localStorage. Instead we persist only the
// delta — orders the user creates this session — and merge them on top of the
// seed on load. This keeps created orders alive across reloads without bloating
// storage. (Status/edit changes to those created orders are persisted too,
// since the delta is recomputed from the live list on every mutation.)
// ─────────────────────────────────────────────────────────────────────────────

export type FlightOrder = FlightOrderRow;

const ADDED_KEY = "harvest-data-v1:flight-orders-added";

function loadAddedOrders(): FlightOrder[] {
  try {
    const raw = window.localStorage.getItem(ADDED_KEY);
    if (raw) return JSON.parse(raw) as FlightOrder[];
  } catch {
    /* unavailable / corrupt — start empty */
  }
  return [];
}

function saveAddedOrders() {
  try {
    const added = current.filter((o) => addedIds.has(o.id));
    window.localStorage.setItem(ADDED_KEY, JSON.stringify(added));
  } catch {
    /* quota / serialization errors are non-fatal */
  }
}

const persistedAdded = loadAddedOrders();
const addedIds = new Set<string>(persistedAdded.map((o) => o.id));
// Persisted creates take precedence over (and sit above) the seed snapshot.
let current: FlightOrder[] = [...persistedAdded, ...seedFlightOrders];
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function getFlightOrders(): FlightOrder[] {
  return current;
}

export function setFlightOrders(next: FlightOrder[]) {
  current = next;
  saveAddedOrders();
  notify();
}

/** Prepends new orders (UI convention: newest first). */
export function addFlightOrders(orders: FlightOrder[]) {
  for (const o of orders) addedIds.add(o.id);
  current = [...orders, ...current];
  saveAddedOrders();
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
    if (addedIds.has(id)) saveAddedOrders();
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
    saveAddedOrders();
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
