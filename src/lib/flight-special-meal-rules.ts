import { useSyncExternalStore } from "react";
import type { SpecialMealMode } from "@/lib/special-meal-count-settings";

// ─────────────────────────────────────────────────────────────────────────────
// Per-flight-number Special-Meal count rules — an override of the GLOBAL
// special-meal config (Configuration → Meal Config), keyed by flight number.
//
// A rule set for "BS-901" applies to EVERY BS-901 flight order, across all
// dates. An audience left unset falls back to the global config, so the
// effective rule is:  flightRule[flight]?.<audience>  ??  globalConfig.<audience>
//
// Stored under localStorage["harvest-flight-special-meal-rules-v1"] as
//   Record<flightNumber, { passenger?: Mode; crew?: Mode }>
// ─────────────────────────────────────────────────────────────────────────────

export type FlightSpecialMealRule = {
  passenger?: SpecialMealMode;
  crew?: SpecialMealMode;
};

export type FlightSpecialMealRules = Record<string, FlightSpecialMealRule>;

const STORAGE_KEY = "harvest-flight-special-meal-rules-v1";

function isMode(v: unknown): v is SpecialMealMode {
  return v === "deducted" || v === "additional";
}

function sanitize(raw: unknown): FlightSpecialMealRules {
  const out: FlightSpecialMealRules = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [flight, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    const rule: FlightSpecialMealRule = {};
    if (isMode(v.passenger)) rule.passenger = v.passenger;
    if (isMode(v.crew)) rule.crew = v.crew;
    if (rule.passenger || rule.crew) out[flight] = rule;
  }
  return out;
}

function load(): FlightSpecialMealRules {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function persist(rules: FlightSpecialMealRules) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // localStorage unavailable — fail silent.
  }
}

let current: FlightSpecialMealRules = load();
const listeners = new Set<() => void>();

export function getFlightSpecialMealRules(): FlightSpecialMealRules {
  return current;
}

/** The rule for one flight number (undefined ⇒ fully inheriting the global). */
export function getFlightSpecialMealRule(flight: string): FlightSpecialMealRule | undefined {
  return current[flight];
}

/**
 * Set (or clear) one audience's mode for a flight number. Passing `undefined`
 * clears that audience back to global; a flight with neither audience set is
 * removed entirely so it reads as "inheriting global".
 */
export function setFlightSpecialMealMode(
  flight: string,
  audience: "passenger" | "crew",
  mode: SpecialMealMode | undefined,
) {
  const next: FlightSpecialMealRules = { ...current };
  const rule: FlightSpecialMealRule = { ...(next[flight] ?? {}) };
  if (mode === undefined) delete rule[audience];
  else rule[audience] = mode;
  if (!rule.passenger && !rule.crew) delete next[flight];
  else next[flight] = rule;
  current = next;
  persist(current);
  for (const l of listeners) l();
}

export function subscribeFlightSpecialMealRules(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useFlightSpecialMealRules(): FlightSpecialMealRules {
  return useSyncExternalStore(
    (cb) => subscribeFlightSpecialMealRules(cb),
    getFlightSpecialMealRules,
    getFlightSpecialMealRules,
  );
}
