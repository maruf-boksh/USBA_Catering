import { useSyncExternalStore } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch-monitoring document identity — single source of truth.
// Stored under localStorage["harvest-dispatch-monitoring-v1"]. These are the
// org-specific labels printed on the Daily Product Dispatch Monitoring form
// (catering points, the controlled-document code, the dispatch route). They were
// previously hardcoded across the page; centralising them here keeps the form
// reusable for any catering point / station and makes them editable (via
// localStorage now, a config screen later) instead of baked into the JSX.
// ─────────────────────────────────────────────────────────────────────────────

export type DispatchMonitoringSettings = {
  /** Controlled-document / form code shown in the header and on each card. */
  documentCode: string;
  /** Page title (the form name). */
  title: string;
  /** Origin catering point full name (e.g. the central kitchen). */
  originName: string;
  /** Short origin label used in the route line and tables. */
  originLabel: string;
  /** Destination catering point full name (e.g. the airport unit + gate). */
  destinationName: string;
  /** Short destination label used in the route line and "received by" copy. */
  destinationLabel: string;
};

export const DEFAULT_DISPATCH_MONITORING: DispatchMonitoringSettings = {
  documentCode: "USBA-FSH-PDM-01",
  title: "Daily Product Dispatch Monitoring",
  originName: "Baunia Central Kitchen",
  originLabel: "Baunia Catering",
  destinationName: "Airport Catering Unit — Gate No. 08",
  destinationLabel: "Airport Catering",
};

const STORAGE_KEY = "harvest-dispatch-monitoring-v1";

function load(): DispatchMonitoringSettings {
  if (typeof window === "undefined") return DEFAULT_DISPATCH_MONITORING;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DISPATCH_MONITORING;
    const parsed = JSON.parse(raw) as Partial<DispatchMonitoringSettings>;
    if (!parsed || typeof parsed !== "object") return DEFAULT_DISPATCH_MONITORING;
    // Merge over defaults so a partial / older saved object never loses fields.
    return { ...DEFAULT_DISPATCH_MONITORING, ...parsed };
  } catch {
    return DEFAULT_DISPATCH_MONITORING;
  }
}

function persist(settings: DispatchMonitoringSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable (Safari private mode etc.) — fail silent.
  }
}

let current: DispatchMonitoringSettings = load();
const listeners = new Set<() => void>();

export function getDispatchMonitoringSettings(): DispatchMonitoringSettings {
  return current;
}

export function setDispatchMonitoringSettings(next: Partial<DispatchMonitoringSettings>) {
  current = { ...current, ...next };
  persist(current);
  for (const l of listeners) l();
}

export function useDispatchMonitoringSettings(): DispatchMonitoringSettings {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getDispatchMonitoringSettings,
    getDispatchMonitoringSettings,
  );
}
