// Galley item catalog accessor.
//
// The sheet's structure comes from GALLEY_CATALOG (src/lib/galley-catalog.ts).
// The Beverages/Amenities/Equipment lines are *stock* items that live in the
// airline-consumables inventory store, so the galley plan reads which of those
// items exist (and their names/units) from inventory data — nothing hardcoded.
// Meal-summary and auto-subtotal lines are computed, taken from the catalog.

import { GALLEY_CATALOG, type GalleyItemGroup } from "@/lib/galley-catalog";
import { consumableItems, type ConsumableItem } from "@/lib/sample-data";

export type GalleyPlan = Record<string, string>;
export type { GalleyItemGroup } from "@/lib/galley-catalog";

export type GalleyItem = {
  key: string;
  label: string;
  unit?: string;
  section: string;
  group: GalleyItemGroup;
  rollupTo?: string;
  auto?: boolean;
};

export type GalleySheetField = { k: string; label: string; unit?: string; auto?: boolean };
export type GalleySheetSection = { title: string; group: GalleyItemGroup; fields: GalleySheetField[] };

const CONSUMABLE_KEY = "harvest-data-v1:airline-consumables-items";

/** Live consumables inventory store (galley stock lines live here).
 *  A store persisted before the galley items were added to the seed would be
 *  missing them, which would empty the galley plan / loading standards — so we
 *  backfill any seed item the saved store lacks (keeps the catalog complete
 *  while preserving saved stock levels for items that do exist). */
function readConsumableStore(): ConsumableItem[] {
  let saved: ConsumableItem[] | null = null;
  try {
    const raw = localStorage.getItem(CONSUMABLE_KEY);
    saved = raw ? (JSON.parse(raw) as ConsumableItem[]) : null;
  } catch {
    saved = null;
  }
  if (!Array.isArray(saved) || saved.length === 0) return consumableItems;
  const have = new Set(saved.map((c) => c.id));
  const missing = consumableItems.filter((c) => !have.has(c.id));
  return missing.length ? [...saved, ...missing] : saved;
}

/** Structural catalog (all lines) — drives Loading Standards defaults, the
 *  auto-subtotal set, and protected keys. Independent of live stock. */
export const DEFAULT_GALLEY_ITEMS: GalleyItem[] = GALLEY_CATALOG.map((d) => ({
  key: d.key, label: d.label, unit: d.unit, section: d.section, group: d.group,
  rollupTo: d.rollupTo, auto: d.auto,
}));

/** Auto-subtotal keys (computed, never hand-keyed / never stock). */
export const AUTO_TOTAL_KEYS = new Set(GALLEY_CATALOG.filter((d) => d.auto).map((d) => d.key));

/**
 * Effective galley line-items: catalog structure, but each *stock* line is
 * included only if it exists in the consumables inventory (and takes its live
 * name/unit from there). Meal + auto lines always come from the catalog.
 */
export function loadGalleyItems(): GalleyItem[] {
  const store = readConsumableStore();
  const byId = new Map(store.map((c) => [c.id, c]));
  const catalogKeys = new Set(GALLEY_CATALOG.map((d) => d.key));
  const out: GalleyItem[] = [];
  for (const d of GALLEY_CATALOG) {
    if (d.stock && !byId.has(d.key)) continue; // removed from inventory → off the sheet
    const inv = byId.get(d.key);
    out.push({
      key: d.key,
      label: inv?.name ?? d.label,
      unit: inv?.galleyUnit ?? inv?.uom ?? d.unit,
      section: inv?.galleySection ?? d.section,
      group: (inv?.galleyGroup as GalleyItemGroup) ?? d.group,
      rollupTo: d.rollupTo,
      auto: d.auto,
    });
  }
  // Galley-tagged inventory items that aren't in the catalog (added directly to
  // the store) — so the sheet & standards are driven fully by inventory data.
  for (const c of store) {
    if (!c.galleyGroup || catalogKeys.has(c.id)) continue;
    out.push({
      key: c.id,
      label: c.name,
      unit: c.galleyUnit ?? c.uom,
      section: c.galleySection ?? c.galleyGroup,
      group: c.galleyGroup as GalleyItemGroup,
      rollupTo: c.rollupTo,
      auto: c.auto,
    });
  }
  return out;
}

/** Recompute every `auto` subtotal from the items that roll up to it. */
export function computeAutoTotals(plan: GalleyPlan, items: GalleyItem[] = loadGalleyItems()): GalleyPlan {
  const out: GalleyPlan = {};
  for (const total of items) {
    if (!total.auto) continue;
    out[total.key] = String(
      items
        .filter((i) => i.rollupTo === total.key)
        .reduce((sum, i) => sum + (Number(plan[i.key]) || 0), 0),
    );
  }
  return out;
}

/** Sheet sections derived from the item list (section order = first appearance). */
export function getGalleySections(items: GalleyItem[] = loadGalleyItems()): GalleySheetSection[] {
  const sections: GalleySheetSection[] = [];
  const byTitle = new Map<string, GalleySheetSection>();
  for (const it of items) {
    let sec = byTitle.get(it.section);
    if (!sec) {
      sec = { title: it.section, group: it.group, fields: [] };
      byTitle.set(it.section, sec);
      sections.push(sec);
    }
    sec.fields.push({ k: it.key, label: it.label, unit: it.unit, auto: it.auto });
  }
  return sections;
}
