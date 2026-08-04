// Live reader for the Item Profile master (the "Item Profile" config screen,
// routes/config-item.tsx). That screen persists its rows under the key below;
// other modules — notably Stock Overview — read the profiles through here so an
// item's configuration (type, category, sub-category, UoM, storage, cost) stays
// in sync with whatever is configured in the Item Profile, rather than a stale
// seed snapshot.

import {
  items as SEED_PROFILES,
  ITEM_TYPES,
  ITEM_MINOR_CATEGORIES,
  type ItemMaster,
  type UomOption,
} from "@/lib/sample-data";
import { roundQty } from "@/lib/num";

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

/** Active profiles only — the default source for item pickers / DDLs. */
export function getActiveItemProfiles(): ItemMaster[] {
  return getItemProfiles().filter((i) => i.status === "Active");
}

/**
 * The Item Type DDL exactly as the Item Profile offers it: the standard
 * `ITEM_TYPES` in their configured order, followed by any custom type a user
 * added inline on a profile ("+ Add new item type…" in Create Item). Consumers
 * that filter by type should use this rather than a hard-coded list, so a new
 * type configured in the Item Profile shows up everywhere it is selectable.
 */
export function getItemTypeOptions(
  profiles: ItemMaster[] = getItemProfiles(),
): string[] {
  const out: string[] = [...ITEM_TYPES];
  for (const p of profiles) {
    const t = (p.itemType ?? "").trim();
    if (t && !out.some((known) => known.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/**
 * The Minor Category DDL: the presets followed by any value already in use on a
 * profile. Minor categories are free-form (there is no fixed master for the
 * third level), so the list has to grow from the data — otherwise a value added
 * on one item is unpickable on the next.
 *
 * `scope` narrows the used values to a category / sub-category, so the DDL under
 * a chosen Sub Category offers what siblings actually use before anything else.
 */
export function getMinorCategoryOptions(
  scope?: { category?: string; subCategory?: string },
  profiles: ItemMaster[] = getItemProfiles(),
): string[] {
  const out: string[] = [...ITEM_MINOR_CATEGORIES];
  for (const p of profiles) {
    const m = (p.minorCategory ?? "").trim();
    if (!m) continue;
    if (scope?.category && p.category !== scope.category) continue;
    if (scope?.subCategory && p.subCategory !== scope.subCategory) continue;
    if (!out.some((known) => known.toLowerCase() === m.toLowerCase())) out.push(m);
  }
  return out;
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

// ── Alt UOM (live) ──────────────────────────────────────────────────────────
// Stock is always kept in an item's Primary UOM, but a transaction may be
// entered in any Alt UOM configured on its Item Profile (Item Profile → Create
// Item → Alt UOM). These read the live profiles, unlike the seed-bound
// `getUomOptionsForMaster` / `toPrimaryQty` in sample-data.

/** Primary UOM plus every Alt UOM configured for an item, primary first. */
export function getUomOptionsForItem(
  idOrName: string,
  profiles: ItemMaster[] = getItemProfiles(),
): UomOption[] {
  const master = resolveItemProfile(idOrName, profiles);
  if (!master) return [];
  const opts: UomOption[] = [{ uom: master.uom, conversion: 1, isPrimary: true }];
  for (const alt of master.altUoms ?? []) {
    if (alt.conversion > 0 && alt.uom !== master.uom) {
      opts.push({ uom: alt.uom, conversion: alt.conversion, isPrimary: false });
    }
  }
  return opts;
}

/**
 * The Alt UOM a report should display beside the primary — the first configured
 * alt that PACKS the primary (conversion > 1: Dozen, Bag (25kg), Carton).
 *
 * Alts with a conversion of 1 or less are sub-units (ML inside a Litre), and
 * "how many whole units plus what's left over" says nothing useful about those,
 * so a row with only sub-unit alts reports none.
 */
export function displayAltUom(
  idOrName: string,
  profiles: ItemMaster[] = getItemProfiles(),
): UomOption | null {
  return getUomOptionsForItem(idOrName, profiles)
    .find((o) => !o.isPrimary && o.conversion > 1) ?? null;
}

/**
 * Split a primary-UOM quantity into whole Alt UOM units plus the primary-UOM
 * remainder — 124 Piece against a 10-Piece SET reads as 12 SET and 4 loose.
 * Pure: pass the alt from `displayAltUom` so a table can resolve it once.
 */
export function splitQtyByAlt(
  qty: number,
  alt: UomOption,
): { altQty: number; remainder: number } {
  const sign = qty < 0 ? -1 : 1;
  const altQty = Math.floor(Math.abs(qty) / alt.conversion) * sign;
  return { altQty, remainder: roundQty(qty - altQty * alt.conversion) };
}

/**
 * The Primary-UOM equivalent of a quantity entered in an Alt UOM — e.g.
 * (Chicken Egg, 2, "Carton") → { qty: 720, uom: "Piece" }. Returns null when the
 * item is unknown, the UOM isn't a configured alt, or it already IS the primary,
 * so callers can simply skip the "= x primary" hint in those cases.
 */
export function primaryUomEquivalent(
  idOrName: string,
  qty: number,
  uom: string,
  profiles: ItemMaster[] = getItemProfiles(),
): { qty: number; uom: string } | null {
  const opts = getUomOptionsForItem(idOrName, profiles);
  const opt = opts.find((o) => o.uom === uom);
  if (!opt || opt.isPrimary) return null;
  const primary = opts.find((o) => o.isPrimary)!;
  return { qty: roundQty(qty * opt.conversion), uom: primary.uom };
}
