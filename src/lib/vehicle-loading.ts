/**
 * Vehicle loading sessions — recorded on the Dispatch page (Actions column:
 * Start Loading → Complete Loading), read by Dispatch Monitoring to pre-fill
 * the Catering Point Dispatch Entry's Load Start / Load End times.
 *
 * One session per dispatch run (keyed by the run's Dispatch ID, falling back
 * to its first flight number). A vehicle load that combines several dispatches
 * simply has several sessions; the entry sheet takes the earliest start and
 * the latest end across them.
 */

export type VehicleLoadingSession = {
  /** Dispatch ID of the run (DSP-…), or its first flight when it has none. */
  key: string;
  dspRef?: string;
  /** Every flight leg covered by this run. */
  flights: string[];
  startAt: string; // ISO — drives the live elapsed timer
  startHm: string; // "HH:MM" — what the entry sheet stores
  endAt?: string;
  endHm?: string;
};

/** usePersistedState key (namespaced under harvest-data-v1: by the hook). */
export const VEHICLE_LOADING_KEY = "vehicle-loading-sessions";

/** Direct read for pages that only need a one-shot lookup (e.g. form prefill). */
export function readVehicleLoadingSessions(): Record<string, VehicleLoadingSession> {
  try {
    const raw = window.localStorage.getItem(`harvest-data-v1:${VEHICLE_LOADING_KEY}`);
    if (raw != null) return JSON.parse(raw) as Record<string, VehicleLoadingSession>;
  } catch {
    /* corrupt / unavailable — behave as "nothing recorded" */
  }
  return {};
}

/** Synchronous write — needed when the writer navigates away in the same event
 *  (usePersistedState persists via useEffect, which never runs if the page
 *  unmounts first). Mirrors the dm_entries sync-write pattern. */
export function writeVehicleLoadingSessions(sessions: Record<string, VehicleLoadingSession>): void {
  try {
    window.localStorage.setItem(`harvest-data-v1:${VEHICLE_LOADING_KEY}`, JSON.stringify(sessions));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

/**
 * The session covering any of these flights — whatever key it was filed under,
 * newest first.
 *
 * Sessions are keyed `dspRef ?? flight`, but that key is NOT stable: a run's
 * dispatch ref can be absent on one render and present on the next, so looking
 * a session up by key alone missed it and started a SECOND session — which is
 * what made Load Start jump to a new time every time the load was re-opened,
 * and hid the Complete Loading button (it only renders when a session is
 * found). Resolve by flight instead; the key is only where it is stored.
 */
export function findSessionFor(
  sessions: Record<string, VehicleLoadingSession>,
  flights: string[],
): VehicleLoadingSession | undefined {
  return Object.values(sessions)
    .filter((s) => s.flights.some((f) => flights.includes(f)))
    .sort((a, b) => b.startAt.localeCompare(a.startAt))[0];
}

/**
 * A vehicle load with no dispatch-monitoring entry behind it yet — the load was
 * started on the Dispatch page but its entry was never saved.
 */
export type LoadingDraft = {
  key: string;
  flights: string[];
  dspRef?: string;
  /** Date of the load start, yyyy-mm-dd, matching an entry's packagingDate. */
  date: string;
  startAt: string;
  startHm: string;
  endHm?: string;
};

/**
 * The loads still owed an entry, newest first.
 *
 * Pressing Vehicle Load opens the monitoring sheet, but nothing was recorded on
 * the Dispatch Monitoring page until it was SAVED — so closing the sheet
 * part-way left the load invisible there and the operator with no route back to
 * it. These drafts fill that gap.
 *
 * A load stops being a draft as soon as a saved entry covers one of its flights
 * or its dispatch ref: that entry is the record for the load. Matching on both
 * matters — an entry raised from the Dispatch page carries the dispatch refs,
 * while one keyed in by hand only ever has flight numbers.
 */
export function draftLoads(
  sessions: Record<string, VehicleLoadingSession>,
  coveredFlights: Iterable<string>,
  coveredRefs: Iterable<string>,
): LoadingDraft[] {
  const flights = new Set(coveredFlights);
  const refs = new Set(coveredRefs);
  return Object.values(sessions)
    .filter((s) => !s.flights.some((f) => flights.has(f)) && !(s.dspRef && refs.has(s.dspRef)))
    .sort((a, b) => b.startAt.localeCompare(a.startAt))
    .map((s) => ({
      key: s.key,
      flights: s.flights,
      dspRef: s.dspRef,
      date: s.startAt.split("T")[0],
      startAt: s.startAt,
      startHm: s.startHm,
      endHm: s.endHm,
    }));
}

/**
 * Close the sessions covering the given flights (entry sheet saved with a
 * manual Load End, or the load went out) so the Dispatch page timer stops.
 * Reads + writes localStorage directly — callers live on a different page.
 */
export function completeSessionsFor(flights: string[], endHm: string): void {
  const sessions = readVehicleLoadingSessions();
  let changed = false;
  for (const s of Object.values(sessions)) {
    if (!s.endAt && s.flights.some((f) => flights.includes(f))) {
      s.endAt = new Date().toISOString();
      s.endHm = endHm || s.startHm;
      changed = true;
    }
  }
  if (changed) writeVehicleLoadingSessions(sessions);
}

/**
 * Loading window for the given flights: earliest start → latest end.
 *
 * Only the NEWEST session covering each flight counts. A flight number recurs
 * every day, and a run that was started but never completed stays in storage
 * for good — so matching every session by flight number let one abandoned
 * session from an earlier dispatch withhold today's end time indefinitely
 * (the entry sheet showed a Load Start but a blank Load End, with no way to
 * tell why). The Dispatch page already scopes its own timer to the leg's
 * dispatch ref for exactly this reason; this is the same guard for the reader.
 *
 * `end` is still withheld while any of those current sessions is open — a
 * half-loaded combined run genuinely has no end time yet.
 */
export function loadingWindowFor(
  sessions: Record<string, VehicleLoadingSession>,
  flights: string[],
): { start?: string; end?: string } {
  const covering = Object.values(sessions).filter((s) =>
    s.flights.some((f) => flights.includes(f)),
  );
  if (covering.length === 0) return {};
  // Newest session per flight, then dedupe — one session usually covers several
  // flights of the same run and must not be counted once per leg.
  const newestPerFlight = new Map<string, VehicleLoadingSession>();
  for (const f of flights) {
    for (const s of covering) {
      if (!s.flights.includes(f)) continue;
      const cur = newestPerFlight.get(f);
      if (!cur || s.startAt > cur.startAt) newestPerFlight.set(f, s);
    }
  }
  const matched = [...new Set(newestPerFlight.values())];
  if (matched.length === 0) return {};
  const start = matched.reduce((min, s) => (s.startAt < min.startAt ? s : min)).startHm;
  if (matched.some((s) => !s.endAt)) return { start };
  const end = matched.reduce((max, s) => ((s.endAt ?? "") > (max.endAt ?? "") ? s : max)).endHm;
  return { start, end };
}
