// Galley Item Group master — the tabs of the Handing/Taking sheet.
//
// A group is not a code-level enum: it is whatever the Item Profile says. Tag an
// item with `galleyGroup: "Duty Free"` in Item Profile and a Duty Free tab shows
// up on the Galley Plan, on the read-only sheet and in the Loading Standards
// list, with no code change.
//
// Two sources are merged, in this order:
//
//   1. The optional presentation master under GROUPS_KEY — label, caption, icon
//      and display order per group id. This is what a "Galley Item Group" config
//      screen writes; it never decides WHICH groups exist, only how they look.
//   2. Every distinct `galleyGroup` in use — from the Item Profiles, the
//      consumables store and the seed catalog. This is the authority on
//      existence, so a tagged item can never be stranded without a tab.
//
// "Meals" is excluded throughout: it is computed from Order → Dispatch and has
// its own fixed tab.

import { GALLEY_CATALOG, MEALS_GROUP } from "@/lib/galley-catalog";
import { getItemProfiles } from "@/lib/item-profiles";
import { consumableItems, type ConsumableItem } from "@/lib/sample-data";

export type GalleyGroupDef = {
  /** Value stored in `ItemMaster.galleyGroup` — the identity of the group. */
  id: string;
  /** Tab caption. Defaults to the id. */
  label: string;
  /** One-line description under the tab's title strip. */
  caption?: string;
  /** Lucide icon NAME (components can't be persisted) — see GROUP_ICONS in the
   *  galley planner. Unknown / unset names fall back to a generic box. */
  icon?: string;
  /** Ascending display order; unset sorts after everything ordered. */
  sortOrder?: number;
  /** Hidden from the sheet without deleting the group or untagging its items. */
  active?: boolean;
};

/** Where a Galley Item Group config screen persists its presentation rows. */
export const GALLEY_GROUPS_KEY = "harvest-data-v1:galley-item-groups";
const CONSUMABLE_KEY = "harvest-data-v1:airline-consumables-items";

/**
 * Presentation defaults for the groups this app ships with. Only labels,
 * captions and order — the groups themselves come from the item data, so
 * removing an entry here does not remove the tab.
 */
const SEED_PRESENTATION: Record<string, Omit<GalleyGroupDef, "id">> = {
  Beverages: {
    label: "Beverages & Tea",
    caption: "Cold drinks, juice, hot beverage & service items",
    icon: "CupSoda",
    sortOrder: 10,
  },
  Amenities: {
    label: "Amenities & Consumables",
    caption: "Tissues, bedding, hygiene, medical kits & forms",
    icon: "Sparkles",
    sortOrder: 20,
  },
  Equipment: {
    label: "Equipment",
    caption: "Carts, ceramic, cutlery & service ware",
    icon: "Boxes",
    sortOrder: 30,
  },
  "Fresh Fruits": {
    label: "Fresh Fruits",
    caption: "Whole fruit loaded loose for the cabin",
    icon: "Apple",
    sortOrder: 40,
  },
  Medicine: {
    label: "Medicine",
    caption: "Sealed medical kits — EMK, UPK, FAN & daily medeline",
    icon: "BriefcaseMedical",
    sortOrder: 50,
  },
  Forms: {
    label: "Forms",
    caption: "Declaration forms, ED cards & comments cards",
    icon: "FileText",
    sortOrder: 60,
  },
};

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Persisted presentation rows, keyed by group id. */
function readPresentation(): Map<string, GalleyGroupDef> {
  const rows = readJson<GalleyGroupDef[]>(GALLEY_GROUPS_KEY);
  const m = new Map<string, GalleyGroupDef>();
  if (Array.isArray(rows)) {
    for (const r of rows) if (r?.id) m.set(r.id, r);
  }
  return m;
}

/** Every group id currently tagged on something, in a stable discovery order. */
function usedGroupIds(): string[] {
  const seen = new Set<string>();
  const push = (g?: string) => {
    const id = (g ?? "").trim();
    if (id && id !== MEALS_GROUP && !seen.has(id)) seen.add(id);
  };
  // Seed catalog first so the shipped tabs keep their familiar order, then the
  // Item Profile (the master), then anything only the consumables store knows.
  for (const d of GALLEY_CATALOG) push(d.group);
  for (const p of getItemProfiles()) push(p.galleyGroup);
  for (const c of readJson<ConsumableItem[]>(CONSUMABLE_KEY) ?? consumableItems) push(c.galleyGroup);
  return [...seen];
}

/**
 * The galley tabs, in display order. Presentation rows may rename, re-order,
 * re-icon or deactivate a group; they cannot invent or remove one, because a tab
 * exists exactly when some item is tagged into it.
 */
export function getGalleyGroups(): GalleyGroupDef[] {
  return getAllGalleyGroups().filter((g) => g.active !== false);
}

/**
 * Every group INCLUDING the switched-off ones, in display order. This is what a
 * Galley Item Group config screen lists: a category that has been switched off
 * still has to be visible there, or it could never be switched back on.
 */
export function getAllGalleyGroups(): GalleyGroupDef[] {
  const pres = readPresentation();
  return usedGroupIds()
    .map((id, i): GalleyGroupDef => {
      const seeded = SEED_PRESENTATION[id];
      const saved = pres.get(id);
      return {
        id,
        label: saved?.label ?? seeded?.label ?? id,
        caption: saved?.caption ?? seeded?.caption,
        icon: saved?.icon ?? seeded?.icon,
        // Unordered groups keep discovery order, after every ordered one.
        sortOrder: saved?.sortOrder ?? seeded?.sortOrder ?? 1000 + i,
        active: saved?.active ?? true,
      };
    })
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/**
 * Switch one category on or off, preserving every other group's presentation.
 * Written through the same rows `getGalleyGroups` reads, so the Galley Plan's
 * tab list reflects it on the next open.
 */
export function setGalleyGroupActive(id: string, active: boolean): GalleyGroupDef[] {
  const rows = getAllGalleyGroups().map((g) => (g.id === id ? { ...g, active } : g));
  saveGalleyGroups(rows);
  return rows;
}

/** One group's presentation, synthesised from the id when it has no row. */
export function getGalleyGroup(id: string): GalleyGroupDef {
  return getGalleyGroups().find((g) => g.id === id) ?? { id, label: id, sortOrder: 0, active: true };
}

/** True when `id` is a live galley tab (never true for the computed Meals group). */
export function isGalleyGroup(id?: string): boolean {
  return !!id && id !== MEALS_GROUP && getGalleyGroups().some((g) => g.id === id);
}

/** Persist the presentation rows (for a Galley Item Group config screen). */
export function saveGalleyGroups(rows: GalleyGroupDef[]): void {
  try {
    window.localStorage.setItem(GALLEY_GROUPS_KEY, JSON.stringify(rows));
  } catch {
    /* quota / unavailable — non-fatal, groups still resolve from item data */
  }
}
