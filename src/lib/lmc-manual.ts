// Manual LMC log — the write side of the Last Minute Change worklist.
//
// The LMC Control Tower (routes/lmc.tsx) merges two feeds: order amendments
// recorded by the amendment engine, and MANUAL events that aren't order-field
// edits. This module owns the manual feed's key, shape and append operation so
// other modules can raise one without importing the LMC page — the page already
// imports from Galley Planning, and a route↔route cycle would bite at module
// init.
//
// Raising an entry is deliberately cheap and non-blocking: a change that reaches
// production or the galley must be *recorded* even if nothing downstream reacts
// yet, because the operational cost of an unlogged late change is that nobody
// finds out until the aircraft is short.

import type { LmcSeverity } from "@/lib/flight-orders-store";

export const MANUAL_TYPES = [
  "Aircraft Swap",
  "PAX Change",
  "Special Meal Change",
  "Meal Change",
  "Flight Cancellation",
  "Nil Catering / Offload",
  "Schedule / Delay",
  "Extra / Reduced Crew",
  "Other",
] as const;
export type ManualType = typeof MANUAL_TYPES[number];

export type ManualLmc = {
  id: string;
  at: string;
  by: string;
  role: string;
  flight: string;
  orderNo?: string;
  sector?: string;
  type: ManualType;
  from?: string;
  to?: string;
  reason: string;
  severity: LmcSeverity;
  leadHours: number | null;
  /** Where the change was raised, when it wasn't the LMC page itself. */
  source?: string;
};

export const LMC_MANUAL_KEY = "lmc-manual";
const STORAGE_KEY = `harvest-data-v1:${LMC_MANUAL_KEY}`;

export function readManualLmc(): ManualLmc[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ManualLmc[]) : [];
  } catch {
    return [];
  }
}

/**
 * Append a manual LMC entry, newest first. Best-effort: a full quota must not
 * block the operational action that raised it.
 */
export function addManualLmc(entry: ManualLmc): ManualLmc {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...readManualLmc()]));
  } catch {
    /* storage unavailable — non-fatal */
  }
  return entry;
}
