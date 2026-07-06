// Single source of truth for the airline equipment asset register. The
// Registration screen (routes/airline-equipments.tsx) seeds + edits this list;
// Assignment, Disposal, Maintenance, Damage, Returns and the Fleet Overview all
// read it through here so a newly registered / status-changed asset is visible
// everywhere instead of each screen keeping its own private copy or the static
// seed.

import { equipmentAssets, type EquipmentAsset } from "@/lib/sample-data";

/** localStorage key (unprefixed) shared by every asset screen via usePersistedState. */
export const EQUIPMENT_ASSETS_KEY = "airline-equipments-assets";
const FULL_KEY = `harvest-data-v1:${EQUIPMENT_ASSETS_KEY}`;

/** The live asset register (persisted if present, else the seed). */
export function getEquipmentAssets(): EquipmentAsset[] {
  try {
    const raw = window.localStorage.getItem(FULL_KEY);
    if (raw != null) return JSON.parse(raw) as EquipmentAsset[];
  } catch {
    /* unavailable / corrupt — fall through to seed */
  }
  return equipmentAssets;
}

/**
 * Flip an asset's status in the shared register (e.g. Damage → "Damaged",
 * Return → "In Service"), optionally patching other fields (location, dates).
 * Screens bound to the same key re-read on their next mount.
 */
export function setEquipmentAssetStatus(
  id: string,
  status: EquipmentAsset["status"],
  patch: Partial<EquipmentAsset> = {},
): void {
  try {
    const next = getEquipmentAssets().map((a) => (a.id === id ? { ...a, ...patch, status } : a));
    window.localStorage.setItem(FULL_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
