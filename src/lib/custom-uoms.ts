import { useSyncExternalStore } from "react";
import { ITEM_UOMS, ALT_UOM_OPTIONS } from "./sample-data";

// ─────────────────────────────────────────────────────────────────────────────
// Custom UOMs — user-defined units of measure added from the Item Profile form.
//
// The app ships with seed lists (ITEM_UOMS for Primary UOM, ALT_UOM_OPTIONS for
// Alternative UOM). Users can extend both from the UI via the "+ Add new…"
// option; those additions are persisted here and merged with the seed lists so
// every UOM dropdown across the app (Create, Edit, Alt UOM DDL) sees them.
//
// Stored under localStorage and exposed via a useSyncExternalStore singleton so
// all mounted dropdowns stay in sync the moment a new unit is added.
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_KEY = "harvest-custom-primary-uoms-v1";
const ALT_KEY = "harvest-custom-alt-uoms-v1";

function load(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function persist(key: string, rows: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* quota / unavailable — fail silent */
  }
}

let customPrimary: string[] = load(PRIMARY_KEY);
let customAlt: string[] = load(ALT_KEY);
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Merge seed + custom lists, de-duped case-insensitively, seed order first. */
function merge(seed: readonly string[], custom: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...seed, ...custom]) {
    const k = v.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

// Cached merged snapshots so useSyncExternalStore gets a stable reference until
// something actually changes (avoids an infinite re-render loop).
let primarySnapshot: string[] = merge(ITEM_UOMS, customPrimary);
let altSnapshot: string[] = merge(ALT_UOM_OPTIONS, customAlt);

function refreshSnapshots() {
  primarySnapshot = merge(ITEM_UOMS, customPrimary);
  altSnapshot = merge(ALT_UOM_OPTIONS, customAlt);
}

export function getPrimaryUoms(): string[] {
  return primarySnapshot;
}
export function getAltUoms(): string[] {
  return altSnapshot;
}

/** Add a new Primary UOM. Returns the canonical label (existing match or new). */
export function addPrimaryUom(label: string): string | null {
  const val = label.trim();
  if (!val) return null;
  const existing = primarySnapshot.find((u) => u.toLowerCase() === val.toLowerCase());
  if (existing) return existing;
  customPrimary = [...customPrimary, val];
  persist(PRIMARY_KEY, customPrimary);
  refreshSnapshots();
  emit();
  return val;
}

/** Add a new Alternative UOM. Returns the canonical label (existing match or new). */
export function addAltUom(label: string): string | null {
  const val = label.trim();
  if (!val) return null;
  const existing = altSnapshot.find((u) => u.toLowerCase() === val.toLowerCase());
  if (existing) return existing;
  customAlt = [...customAlt, val];
  persist(ALT_KEY, customAlt);
  refreshSnapshots();
  emit();
  return val;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePrimaryUoms(): string[] {
  return useSyncExternalStore(subscribe, getPrimaryUoms, getPrimaryUoms);
}
export function useAltUoms(): string[] {
  return useSyncExternalStore(subscribe, getAltUoms, getAltUoms);
}
