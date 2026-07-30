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
 * Loading window across every session that covers any of the given flights:
 * earliest start → latest end. `end` is only set once ALL matched sessions
 * are completed — a half-loaded combined run has no end time yet.
 */
export function loadingWindowFor(
  sessions: Record<string, VehicleLoadingSession>,
  flights: string[],
): { start?: string; end?: string } {
  const matched = Object.values(sessions).filter((s) =>
    s.flights.some((f) => flights.includes(f)),
  );
  if (matched.length === 0) return {};
  const start = matched.reduce((min, s) => (s.startAt < min.startAt ? s : min)).startHm;
  if (matched.some((s) => !s.endAt)) return { start };
  const end = matched.reduce((max, s) => ((s.endAt ?? "") > (max.endAt ?? "") ? s : max)).endHm;
  return { start, end };
}
