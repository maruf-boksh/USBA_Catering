import { useSyncExternalStore } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Special-meal count configuration — single source of truth.
// Stored under localStorage["harvest-special-meal-count-v1"].
//
// Special meals are ALTERNATIVE meals. On meal-order upload the total order
// number is calculated automatically using these rules, set independently for
// passengers and crew. In both cases regular = base − special:
//   • "additional" — the special meals are added back to the regular count, so
//                    the total is unchanged (172 regular + 8 special = 180).
//   • "deducted"   — the special meals are deducted from the base count; the
//                    order excludes them (total = base − special = 172).
// ─────────────────────────────────────────────────────────────────────────────

export type SpecialMealMode = "deducted" | "additional";

export type SpecialMealCountConfig = {
  /** How passenger special meals affect the passenger meal total. */
  passenger: SpecialMealMode;
  /** How crew special meals affect the crew meal total. */
  crew: SpecialMealMode;
};

export const DEFAULT_SPECIAL_MEAL_COUNT_CONFIG: SpecialMealCountConfig = {
  passenger: "additional",
  crew: "additional",
};

const STORAGE_KEY = "harvest-special-meal-count-v1";

function isMode(v: unknown): v is SpecialMealMode {
  return v === "deducted" || v === "additional";
}

function load(): SpecialMealCountConfig {
  if (typeof window === "undefined") return DEFAULT_SPECIAL_MEAL_COUNT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SPECIAL_MEAL_COUNT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<SpecialMealCountConfig>;
    return {
      passenger: isMode(parsed?.passenger) ? parsed.passenger : DEFAULT_SPECIAL_MEAL_COUNT_CONFIG.passenger,
      crew: isMode(parsed?.crew) ? parsed.crew : DEFAULT_SPECIAL_MEAL_COUNT_CONFIG.crew,
    };
  } catch {
    return DEFAULT_SPECIAL_MEAL_COUNT_CONFIG;
  }
}

function persist(config: SpecialMealCountConfig) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage may be unavailable (Safari private mode etc.) — fail silent.
  }
}

let current: SpecialMealCountConfig = load();
const listeners = new Set<() => void>();

export function getSpecialMealCountConfig(): SpecialMealCountConfig {
  return current;
}

export function setSpecialMealCountConfig(next: SpecialMealCountConfig) {
  current = { passenger: next.passenger, crew: next.crew };
  persist(current);
  for (const l of listeners) l();
}

export function subscribeSpecialMealCountConfig(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSpecialMealCountConfig(): SpecialMealCountConfig {
  return useSyncExternalStore(
    (cb) => subscribeSpecialMealCountConfig(cb),
    getSpecialMealCountConfig,
    getSpecialMealCountConfig,
  );
}

/**
 * Pure helper — the effective meal total for a group given its base head-count,
 * special-meal count, and the configured mode. Used by meal-order upload to
 * auto-calculate the total order number.
 *   • "additional" → total === base (specials added back to the regular count)
 *   • "deducted"   → total === base − special (specials deducted from the order)
 */
export function applySpecialMealMode(base: number, special: number, mode: SpecialMealMode): number {
  return mode === "deducted" ? Math.max(0, base - special) : base;
}
