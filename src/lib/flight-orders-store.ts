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

// One-time migration: align crew orders to share their date's flight Order #.
// Data created before crew/flight shared a number kept separate Order #s; this
// re-points each persisted crew order to the flight order's number for the same
// date — but only when that date has a SINGLE distinct flight Order # (so the
// match is unambiguous). Returns the same array reference when nothing changed.
function migrateCrewOrderNos(added: FlightOrder[]): FlightOrder[] {
  const flightNosByDate = new Map<string, Set<string>>();
  for (const o of added) {
    if ((o.orderType ?? "flight") === "crew") continue;
    let set = flightNosByDate.get(o.date);
    if (!set) { set = new Set(); flightNosByDate.set(o.date, set); }
    set.add(o.orderNo);
  }
  let changed = false;
  const next = added.map((o) => {
    if (o.orderType !== "crew") return o;
    const set = flightNosByDate.get(o.date);
    if (set && set.size === 1) {
      const target = [...set][0];
      if (target !== o.orderNo) { changed = true; return { ...o, orderNo: target }; }
    }
    return o;
  });
  return changed ? next : added;
}

// One-time migration: fold crew orders into their matching flight order. A crew
// order (orderType "crew") that shares a flight + date + direction with a flight
// order is redundant now that flight orders carry their own crew count — so we
// copy its crew onto the flight order (latest crew wins) and drop the crew row.
// Crew orders with NO matching flight order are kept as-is (crew-only flights).
function migrateCrewMerge(added: FlightOrder[]): FlightOrder[] {
  const isFlight = (o: FlightOrder) => (o.orderType ?? "flight") !== "crew";
  const key = (o: FlightOrder) => `${o.flight}|${o.date}|${o.direction}`;

  const flightKeys = new Set<string>();
  for (const o of added) if (isFlight(o)) flightKeys.add(key(o));

  // Latest crew value per flight key, taken from crew orders that have a match.
  const crewByKey = new Map<string, { crew: number; at: number }>();
  for (const o of added) {
    if (isFlight(o)) continue;
    const k = key(o);
    if (!flightKeys.has(k)) continue; // no match → leave it standalone
    const at = o.createdAt ?? 0;
    const prev = crewByKey.get(k);
    if (!prev || at >= prev.at) crewByKey.set(k, { crew: o.crew ?? 0, at });
  }
  if (crewByKey.size === 0) return added;

  const next: FlightOrder[] = [];
  for (const o of added) {
    if (isFlight(o)) {
      const merged = crewByKey.get(key(o));
      next.push(merged ? { ...o, crew: merged.crew } : o);
    } else if (!flightKeys.has(key(o))) {
      next.push(o); // standalone crew order — keep
    }
    // else: crew order merged into its flight order → drop
  }
  return next;
}

const rawAdded = loadAddedOrders();
const persistedAdded = migrateCrewMerge(migrateCrewOrderNos(rawAdded));
const addedIds = new Set<string>(persistedAdded.map((o) => o.id));
// Persisted creates take precedence over (and sit above) the seed snapshot.
let current: FlightOrder[] = [...persistedAdded, ...seedFlightOrders];
const listeners = new Set<() => void>();
// If the migration re-aligned any crew Order #, persist the aligned set so the
// fix sticks across reloads (no-op when nothing changed).
if (persistedAdded !== rawAdded) saveAddedOrders();

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
