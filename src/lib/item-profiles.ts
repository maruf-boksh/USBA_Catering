// Live reader for the Item Profile master (the "Item Profile" config screen,
// routes/config-item.tsx). That screen persists its rows under the key below;
// other modules — notably Stock Overview — read the profiles through here so an
// item's configuration (type, category, sub-category, UoM, storage, cost) stays
// in sync with whatever is configured in the Item Profile, rather than a stale
// seed snapshot.

import { items as SEED_PROFILES, type ItemMaster } from "@/lib/sample-data";

// Mirror of the key used by usePersistedState in routes/config-item.tsx.
const STORAGE_KEY = "harvest-data-v1:config-item-rows";

/** All item profiles (persisted if present, else the seed master). */
export function getItemProfiles(): ItemMaster[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw != null) return JSON.parse(raw) as ItemMaster[];
  } catch {
    /* unavailable / corrupt — fall through to seed */
  }
  return SEED_PROFILES;
}

/**
 * Resolve the Item Profile for an inventory row by code (`INV-{code}`) or, more
 * commonly, by an exact name match — the same dual match the legacy
 * `findItemProfileFor` used, but against the live persisted profiles.
 */
export function resolveItemProfile(
  idOrName: string,
  profiles: ItemMaster[] = getItemProfiles(),
): ItemMaster | undefined {
  const name = idOrName.toLowerCase();
  return (
    profiles.find((m) => `INV-${m.code}` === idOrName) ??
    profiles.find((m) => m.name.toLowerCase() === name)
  );
}
