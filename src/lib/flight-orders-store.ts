import { useSyncExternalStore } from "react";
import {
  seedFlightOrders,
  isDomesticSector,
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

// ─────────────────────────────────────────────────────────────────────────────
// Amendment overlay — Last-Minute Changes (LMC) foundation.
//
// Every substantive edit to an order is recorded as an append-only *amendment*
// (a field-level diff + who/when/why), instead of being silently overwritten.
// The overlay also persists each order's accumulated head edits keyed by id —
// which is what makes edits to SEED orders survive a reload (the added-orders
// delta above only covers orders created in-app).
// ─────────────────────────────────────────────────────────────────────────────

const AMEND_KEY = "harvest-data-v1:flight-order-amendments";

/** Lead time (hours before ETD) at or under which an edit counts as a
 *  Last-Minute Change. Single knob — tune to the operation's cut-off. */
export const LMC_WINDOW_HOURS = 4;

export type LmcSeverity = "info" | "minor" | "major" | "critical";

/** One changed field within an amendment. */
export type FieldChange = { field: string; label: string; from: unknown; to: unknown };

/** A single recorded edit to an order — the unit of the revision history. */
export type OrderAmendment = {
  id: string;          // AMD-<base36>-<seq>
  orderId: string;
  at: string;          // ISO timestamp
  by: string;
  role: string;
  reason: string;
  changes: FieldChange[];
  /** Hours from edit time to scheduled departure (negative ⇒ already departed);
   *  null when date/ETD couldn't be parsed. */
  leadHours: number | null;
  /** True when edited at/under the LMC window — a Last-Minute Change. */
  isLmc: boolean;
  severity: LmcSeverity;
};

// Fields whose change materially affects production / loading (vs. a label fix).
const HIGH_IMPACT_FIELDS = new Set(["etd", "date", "pax", "crew", "specialMeals"]);

/** Hours from now until an order's scheduled departure; null if unparseable. */
export function leadHoursToDeparture(o: Pick<FlightOrder, "date" | "etd">): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o.date);
  const t = /^(\d{1,2}):(\d{2})/.exec(o.etd);
  if (!d || !t) return null;
  const dep = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(dep.getTime())) return null;
  return (dep.getTime() - Date.now()) / 3_600_000;
}

/** True when a lead time falls inside the LMC window: at or under the cutoff
 *  AND not already departed. A negative lead time means the flight has already
 *  left — that's a post-departure correction, not a *last-minute* change, so it
 *  must not be flagged LMC (otherwise editing any historical flight today would
 *  pollute the dashboard's "changes today" count and the LMC filter). */
export function isLmcLead(leadHours: number | null): boolean {
  return leadHours != null && leadHours >= 0 && leadHours <= LMC_WINDOW_HOURS;
}

function classifyAmendment(
  changes: FieldChange[],
  leadHours: number | null,
): { isLmc: boolean; severity: LmcSeverity } {
  const isLmc = isLmcLead(leadHours);
  const highImpact = changes.some((c) => HIGH_IMPACT_FIELDS.has(c.field));
  const severity: LmcSeverity = isLmc
    ? (highImpact ? "critical" : "major")
    : (highImpact ? "minor" : "info");
  return { isLmc, severity };
}

type OrderOverlay = { head: Partial<FlightOrder>; revisions: OrderAmendment[] };

// Only these fields are tracked in the diff / labelled in the history timeline.
const TRACKED_FIELDS: Record<string, string> = {
  flight: "Flight",
  airline: "Airline",
  sector: "Sector",
  date: "Date",
  etd: "ETD",
  direction: "Direction",
  pax: "PAX",
  crew: "Crew",
  specialMeals: "Special Meals",
  status: "Status",
};

function loadOverlay(): Map<string, OrderOverlay> {
  try {
    const raw = window.localStorage.getItem(AMEND_KEY);
    if (raw) return new Map(Object.entries(JSON.parse(raw) as Record<string, OrderOverlay>));
  } catch {
    /* unavailable / corrupt — start empty */
  }
  return new Map();
}

function saveOverlay() {
  try {
    window.localStorage.setItem(AMEND_KEY, JSON.stringify(Object.fromEntries(overlay)));
  } catch {
    /* quota / serialization errors are non-fatal */
  }
}

function ensureOverlay(id: string): OrderOverlay {
  let o = overlay.get(id);
  if (!o) { o = { head: {}, revisions: [] }; overlay.set(id, o); }
  return o;
}

/** Persist a seed order's head edit so it survives reload (added orders persist
 *  via the added-delta instead, so their overlay head stays empty). */
function recordHeadOverlay(id: string, patch: Partial<FlightOrder>) {
  const o = ensureOverlay(id);
  o.head = { ...o.head, ...patch };
  saveOverlay();
}

function pushRevision(rev: OrderAmendment) {
  const o = ensureOverlay(rev.orderId);
  o.revisions = [rev, ...o.revisions];
  saveOverlay();
}

function diffFields(before: FlightOrder, patch: Partial<FlightOrder>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const key of Object.keys(patch)) {
    const label = TRACKED_FIELDS[key];
    if (!label) continue;
    const from = (before as Record<string, unknown>)[key];
    const to = (patch as Record<string, unknown>)[key];
    if (from === to) continue;
    out.push({ field: key, label, from, to });
  }
  return out;
}

let amendSeq = 0;

/** The revision history for an order, newest first. */
export function getOrderAmendments(id: string): OrderAmendment[] {
  return overlay.get(id)?.revisions ?? [];
}

/** Every recorded amendment across all orders, newest first. */
export function getAllAmendments(): OrderAmendment[] {
  const out: OrderAmendment[] = [];
  for (const ov of overlay.values()) out.push(...ov.revisions);
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
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

const overlay = loadOverlay();
const rawAdded = loadAddedOrders();
const persistedAdded = migrateCrewMerge(migrateCrewOrderNos(rawAdded));
const addedIds = new Set<string>(persistedAdded.map((o) => o.id));
// Persisted creates take precedence over (and sit above) the seed snapshot.
// Then re-apply each order's persisted head edits (LMC amendments) so edits to
// SEED orders survive a reload — the added-delta only covers created orders.
let current: FlightOrder[] = [...persistedAdded, ...seedFlightOrders].map((o) => {
  const ov = overlay.get(o.id);
  return ov && Object.keys(ov.head).length ? { ...o, ...ov.head } : o;
});
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
    // Added orders persist via the added-delta; seed orders persist their head
    // edit through the amendment overlay so the change survives a reload.
    if (addedIds.has(id)) saveAddedOrders();
    else recordHeadOverlay(id, patch);
    notify();
  }
}

/**
 * Amend an order, recording the change as a versioned revision (field diff +
 * who/when/why) before applying it — the LMC-aware path that replaces silent
 * overwrites. Untracked-only patches still apply but log no revision. Returns
 * the recorded amendment, or null when nothing tracked changed.
 */
export function amendOrder(
  id: string,
  patch: Partial<FlightOrder>,
  meta: { by?: string; role?: string; reason?: string } = {},
): OrderAmendment | null {
  const before = current.find((o) => o.id === id);
  if (!before) return null;
  const changes = diffFields(before, patch);
  let rev: OrderAmendment | null = null;
  if (changes.length > 0) {
    const leadHours = leadHoursToDeparture(before);
    const { isLmc, severity } = classifyAmendment(changes, leadHours);
    rev = {
      id: `AMD-${Date.now().toString(36)}-${amendSeq++}`,
      orderId: id,
      at: new Date().toISOString(),
      by: meta.by ?? "System",
      role: meta.role ?? "",
      reason: meta.reason?.trim() || "Order edited",
      changes,
      leadHours,
      isLmc,
      severity,
    };
    pushRevision(rev);
  }
  updateFlightOrder(id, patch);
  return rev;
}

/**
 * Whether an amendment can be safely reverted. Reverting restores a revision's
 * `from` values; if a *newer* revision changed any of the same fields, doing so
 * would silently clobber that later change. Block it and name the conflict so
 * the user reverts in order (newest first). Revisions are stored newest-first.
 */
export function canRevertAmendment(
  orderId: string,
  amendmentId: string,
): { ok: boolean; reason?: string } {
  const revs = overlay.get(orderId)?.revisions ?? [];
  const idx = revs.findIndex((r) => r.id === amendmentId);
  if (idx < 0) return { ok: false, reason: "Amendment not found." };
  const targetFields = new Set(revs[idx].changes.map((c) => c.field));
  // Indices before idx are newer (newest-first ordering).
  for (let i = 0; i < idx; i++) {
    const overlap = revs[i].changes.filter((c) => targetFields.has(c.field));
    if (overlap.length) {
      const labels = Array.from(new Set(overlap.map((c) => c.label))).join(", ");
      return { ok: false, reason: `A newer change to ${labels} exists — revert that first.` };
    }
  }
  return { ok: true };
}

/**
 * Undo a recorded amendment by restoring each of its fields to the value it had
 * *before* that change — itself logged as a new amendment (so the revert is
 * auditable and re-revertable). Blocked when a newer amendment touched the same
 * field (see canRevertAmendment). Returns the new revision, or null if not found
 * / blocked.
 */
export function revertAmendment(
  orderId: string,
  amendmentId: string,
  meta: { by?: string; role?: string } = {},
): OrderAmendment | null {
  const rev = overlay.get(orderId)?.revisions.find((r) => r.id === amendmentId);
  if (!rev) return null;
  if (!canRevertAmendment(orderId, amendmentId).ok) return null;
  const patch: Record<string, unknown> = {};
  for (const c of rev.changes) patch[c.field] = c.from;
  return amendOrder(orderId, patch as Partial<FlightOrder>, {
    by: meta.by ?? "System",
    role: meta.role ?? "",
    reason: `Reverted ${rev.id} (${rev.changes.map((c) => c.label).join(", ")})`,
  });
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
  const seedChanged: string[] = [];
  const next = current.map((o) => {
    if (!predicate(o)) return o;
    changedCount += 1;
    // Seed orders don't persist via the added-delta — without a head overlay
    // their change is lost on reload (the seed-edit-loss bug, on the bulk path).
    if (!addedIds.has(o.id)) seedChanged.push(o.id);
    return { ...o, ...patch };
  });
  if (changedCount > 0) {
    current = next;
    saveAddedOrders();
    for (const id of seedChanged) recordHeadOverlay(id, patch);
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

// ── Mobile bridge: map the web flight-orders store into the mobile Home screen's
// flight-row shape ────────────────────────────────────────────────────────────
// The mobile "Next Departures" list + flight KPIs read the SAME live order store
// the web Order Management page uses, instead of a hardcoded MOCK_FLIGHTS list.
// The mobile UI is unchanged; only its data source is swapped.

export type MobileFlight = {
  id: string;
  airline: string;
  route: string;
  departure: string;
  status: string;
  pax: number;
  meals: number;
  sector: string;
};

// Web order-lifecycle status → the mobile flight-status vocabulary its pill/colors
// expect. (The web tracks order progress, not operational flight state, so this is
// the closest faithful mapping; the substantive data — flights, times, pax, meals —
// is all real.)
const MOBILE_FLIGHT_STATUS: Record<FlightOrderStatus, string> = {
  Pending: "scheduled",
  Approved: "scheduled",
  Production: "boarding",
  Dispatched: "departed",
  Completed: "departed",
};

/**
 * Live flight orders rendered in the mobile Home shape, scoped to a single day's
 * departures sorted by ETD. Picks the reference date's flights (default today);
 * if that date has none (e.g. the seed sits in a different period), falls back to
 * the earliest upcoming date, then to the earliest date present — so the mobile
 * list is never empty while real data exists. Crew-meal orders are excluded (they
 * aren't departures); each row's meals = pax + crew + special meals.
 */
export function loadMobileFlights(
  refDate: string = new Date().toISOString().split("T")[0],
): MobileFlight[] {
  const flights = getFlightOrders().filter((o) => (o.orderType ?? "flight") !== "crew");
  if (flights.length === 0) return [];

  // Choose the day to show: today if it has departures, else the soonest future
  // day, else the earliest day in the data.
  const onRef = flights.filter((o) => o.date === refDate);
  const pool = onRef.length
    ? onRef
    : (() => {
        const future = flights.filter((o) => o.date >= refDate);
        const base = future.length ? future : flights;
        const minDate = base.reduce((m, o) => (o.date < m ? o.date : m), base[0].date);
        return base.filter((o) => o.date === minDate);
      })();

  return pool
    .slice()
    .sort((a, b) => a.etd.localeCompare(b.etd))
    .map((o) => ({
      id: o.flight,
      airline: o.airline,
      route: o.sector,
      departure: o.etd,
      status: MOBILE_FLIGHT_STATUS[o.status] ?? "scheduled",
      pax: o.pax,
      meals: o.pax + (o.crew ?? 0) + (o.specialMeals ?? 0),
      sector: isDomesticSector(o.sector) ? "Domestic" : "International",
    }));
}
