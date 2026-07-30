import { useSyncExternalStore } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Packaging completion mode — single source of truth.
//
// How a packaging run is COMPLETED (flipped to Packaging Done / ready for
// dispatch) is a site-level operating decision, so it lives in Configuration:
//
//   • print/scan ON  (default) — the current process. Labels are printed
//     (repeatable), and SCANNING a printed label is what completes packaging.
//     The physical scan is the proof the package exists and is labelled.
//
//   • print/scan OFF — stations without printers/scanners. Batches are ticked
//     on the packaging list and marked Packaging Done directly — same status
//     transitions, same downstream flow (dispatch manifest, order lifecycle),
//     just without the label session gating it.
//
// Only the GATE changes. Everything downstream of "Packaging Done" is written
// by the same code path in both modes, so flipping the toggle mid-day cannot
// strand a batch: anything already completed stays completed, anything In
// Packaging simply completes via the other gate.
//
// Stored under localStorage["harvest-packaging-completion-v1"]. Managed from
// the Configuration → Packaging Configuration page.
// ─────────────────────────────────────────────────────────────────────────────

export type PackagingCompletionSettings = {
  /** true = label print + scan completes packaging (current process);
   *  false = batches are marked Packaging Done directly from the list. */
  printScan: boolean;
};

export const DEFAULT_PACKAGING_COMPLETION_SETTINGS: PackagingCompletionSettings = {
  printScan: true,
};

const STORAGE_KEY = "harvest-packaging-completion-v1";

function load(): PackagingCompletionSettings {
  if (typeof window === "undefined") return DEFAULT_PACKAGING_COMPLETION_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PACKAGING_COMPLETION_SETTINGS;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return DEFAULT_PACKAGING_COMPLETION_SETTINGS;
    const obj = parsed as Partial<PackagingCompletionSettings>;
    // Anything but an explicit false stays true — the scan gate is the safe
    // default and a corrupt value must not silently drop it.
    return { printScan: obj.printScan !== false };
  } catch {
    return DEFAULT_PACKAGING_COMPLETION_SETTINGS;
  }
}

function persist(settings: PackagingCompletionSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable (Safari private mode etc.) — fail silent.
  }
}

let current: PackagingCompletionSettings = load();
const listeners = new Set<() => void>();

export function getPackagingCompletionSettings(): PackagingCompletionSettings {
  return current;
}

export function setPackagingPrintScan(enabled: boolean) {
  current = { printScan: enabled };
  persist(current);
  for (const l of listeners) l();
}

export function subscribePackagingCompletion(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePackagingCompletionSettings(): PackagingCompletionSettings {
  return useSyncExternalStore(
    (cb) => subscribePackagingCompletion(cb),
    getPackagingCompletionSettings,
    getPackagingCompletionSettings,
  );
}
