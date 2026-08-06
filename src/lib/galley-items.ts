// Galley item catalog accessor — what lines the Handing/Taking sheet carries.
//
// Three sources, merged by key (first one wins, later ones only add):
//
//   1. GALLEY_CATALOG — the SEED. Its keys are permanent: saved galley plans and
//      loading standards are keyed by them, so a seeded line is never renamed or
//      regenerated. A seed line drops off the sheet if its stock record is gone.
//   2. The airline-consumables store — live name / unit / section / group for
//      the seeded stock lines, plus any galley-tagged consumable of its own.
//   3. The ITEM PROFILE master — any item tagged with a `galleyGroup` becomes a
//      line, keyed by its item code. This is the path to add galley items (and
//      whole galley groups) as data: see ItemMaster.galleyGroup.
//
// Meal-summary and auto-subtotal lines stay computed, taken from the catalog.

import { GALLEY_CATALOG, type GalleyItemGroup } from "@/lib/galley-catalog";
import { getItemProfiles } from "@/lib/item-profiles";
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
  /** Ascending position within the section; unset sorts last. */
  sortOrder?: number;
};

export type GalleySheetField = { k: string; label: string; unit?: string; auto?: boolean; sortOrder?: number };
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
    // Name / unit are LIVE (the store is where they are maintained), but the
    // PLACEMENT — group and section — stays the catalog's. A seeded consumable
    // only ever received its galleyGroup as a copy of the catalog's at first
    // write and nothing edits it afterwards, so deferring to the stored copy
    // would freeze every sheet that had been opened once: re-filing a line in
    // the catalog (Fresh Fruits leaving Equipment, say) would reach new
    // installs and nobody else.
    out.push({
      key: d.key,
      label: inv?.name ?? d.label,
      unit: inv?.galleyUnit ?? inv?.uom ?? d.unit,
      section: d.section,
      group: d.group,
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

  // Item Profile — the master. Any profile tagged with a galleyGroup joins the
  // sheet, keyed by its item code. Matched out by key AND by name so an item
  // that also exists as a consumable (the seeded stock lines do) is not listed
  // twice under two keys, which would double it on the sheet and in the plan.
  const takenKeys = new Set(out.map((i) => i.key));
  const takenNames = new Set(out.map((i) => i.label.trim().toLowerCase()));
  for (const p of getItemProfiles()) {
    const group = (p.galleyGroup ?? "").trim();
    if (!group) continue;
    const name = p.name.trim();
    if (takenKeys.has(p.code) || takenNames.has(name.toLowerCase())) continue;
    takenKeys.add(p.code);
    takenNames.add(name.toLowerCase());
    out.push({
      key: p.code,
      label: name,
      unit: p.galleyUnit ?? p.uom,
      section: (p.galleySection ?? "").trim() || group,
      group,
      sortOrder: p.gallerySortOrder,
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

/**
 * Sheet sections derived from the item list. Section order is first appearance;
 * within a section, items with a `gallerySortOrder` lead (ascending) and the
 * rest keep catalog order behind them — so setting the order on one Item Profile
 * cannot shuffle every other line on the sheet.
 */
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
    sec.fields.push({ k: it.key, label: it.label, unit: it.unit, auto: it.auto, sortOrder: it.sortOrder });
  }
  for (const sec of sections) {
    sec.fields = sec.fields
      .map((f, i) => ({ f, i }))
      .sort((a, b) =>
        (a.f.sortOrder ?? Number.POSITIVE_INFINITY) - (b.f.sortOrder ?? Number.POSITIVE_INFINITY) ||
        a.i - b.i)
      .map(({ f }) => f);
  }
  return sections;
}
