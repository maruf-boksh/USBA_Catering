// On-hand stock behind each galley sheet line, scoped to the warehouse the plan
// transfers FROM.
//
// A galley line can be stocked in either of two stores, so both are resolved:
//
//   • the airline-consumables store — the seeded Beverages / Amenities /
//     Equipment lines. It has no warehouse dimension, so its stock is attributed
//     to the primary warehouse (the same place Stock Overview projects it).
//   • the main inventory — Item-Profile items tagged onto the sheet. These are
//     per-warehouse, and their AVAILABLE figure is used, not on-hand: quantity
//     held for QC cannot be loaded onto an aircraft.
//
// Everything is read once per call and matched in memory. Resolving each line on
// its own would re-parse the whole stock master per line, ~90 times a render.

import { readInventoryRows, availableOf, type StoredItem } from "@/lib/inventory-store";
import { EXTRA_WAREHOUSE_STOCK } from "@/lib/inventory-stock";
import { consumableItems, inventory, type ConsumableItem } from "@/lib/sample-data";
import type { GalleyItem } from "@/lib/galley-items";

/** Warehouse the single-location stores (consumables) are held in. */
const PRIMARY_WAREHOUSE = "WH-001";
const CONSUMABLE_KEY = "harvest-data-v1:airline-consumables-items";

export type GalleyLineStock = {
  /** Quantity loadable from the selected warehouse. */
  available: number;
  /** False when the item has no stock record at all — the UI then shows nothing
   *  rather than an authoritative-looking zero. */
  tracked: boolean;
};

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

const lower = (s: string) => s.trim().toLowerCase();

const UNTRACKED: GalleyLineStock = { available: 0, tracked: false };

export type GalleyStockLookup = {
  /** Stock for a sheet line — matched on its key, then its label. */
  forItem(key: string, label: string): GalleyLineStock;
  /** Stock for a plain item name — used by the meal lines, which come from
   *  Dispatch as real item names rather than sheet keys. */
  forName(name: string): GalleyLineStock;
};

/**
 * Build one in-memory index of both stock stores and answer any number of
 * lookups against it. Create it once per warehouse selection.
 */
export function createGalleyStockLookup(warehouseId: string): GalleyStockLookup {
  const invRows = readInventoryRows() ?? (inventory as unknown as StoredItem[]);
  const invById = new Map<string, StoredItem>();
  const invByName = new Map<string, StoredItem>();
  for (const r of invRows) {
    if (r.id) invById.set(String(r.id), r);
    if (r.name) invByName.set(lower(r.name), r);
  }

  const cons = readJson<ConsumableItem[]>(CONSUMABLE_KEY) ?? consumableItems;
  const consById = new Map<string, ConsumableItem>();
  const consByName = new Map<string, ConsumableItem>();
  for (const c of cons) {
    consById.set(c.id, c);
    consByName.set(lower(c.name), c);
  }

  // Holdings outside an item's primary warehouse, keyed name::warehouse.
  const extra = new Map<string, number>();
  for (const e of EXTRA_WAREHOUSE_STOCK) {
    extra.set(`${lower(e.itemName)}::${e.warehouseId}`, e.stock);
  }

  const isPrimary = warehouseId === PRIMARY_WAREHOUSE;

  const resolve = (key: string | undefined, label: string): GalleyLineStock => {
    const name = lower(label);
    if (!name && !key) return UNTRACKED;

    const inv = (key ? invById.get(key) : undefined) ?? invByName.get(name);
    if (inv) {
      // The primary warehouse holds the row itself; other warehouses hold only
      // what the extra-holdings table records for them.
      return {
        available: isPrimary ? availableOf(inv) : extra.get(`${name}::${warehouseId}`) ?? 0,
        tracked: true,
      };
    }

    const c = (key ? consById.get(key) : undefined) ?? consByName.get(name);
    if (c) return { available: isPrimary ? Math.max(0, c.stock) : 0, tracked: true };

    return UNTRACKED;
  };

  return {
    forItem: (key, label) => resolve(key, label),
    forName: (name) => resolve(undefined, name),
  };
}

/**
 * How many complete SETS can be assembled from stock.
 *
 * A menu-card meal is a set of dishes (Plain Polao + Beef Rezala + Mug Dal
 * Vuna), so its loadable quantity is not any one dish's stock — it is capped by
 * the scarcest component: 40 polao and 12 rezala make 12 sets, not 40. The
 * capping dish is returned so the UI can say WHICH one is holding the line back.
 *
 * Components with no stock record are ignored rather than counted as zero (a
 * dish that was never stocked as a finished good says nothing about the meal);
 * when none of them is tracked the whole line reports untracked and shows
 * nothing.
 */
export function buildableSets(
  components: { name: string; qtyPerMeal?: number }[],
  lookup: GalleyStockLookup,
): GalleyLineStock & { limiting?: string } {
  let best: { available: number; limiting: string } | null = null;
  for (const c of components) {
    const st = lookup.forName(c.name);
    if (!st.tracked) continue;
    const per = c.qtyPerMeal && c.qtyPerMeal > 0 ? c.qtyPerMeal : 1;
    const sets = Math.floor(st.available / per);
    if (!best || sets < best.available) best = { available: sets, limiting: c.name };
  }
  return best ? { available: best.available, tracked: true, limiting: best.limiting } : UNTRACKED;
}

/**
 * Loadable stock per galley line key, in `warehouseId`. Auto-total lines are
 * skipped (they are sums, not goods).
 */
export function galleyStockByWarehouse(
  items: GalleyItem[],
  warehouseId: string,
): Map<string, GalleyLineStock> {
  const lookup = createGalleyStockLookup(warehouseId);
  const out = new Map<string, GalleyLineStock>();
  for (const it of items) {
    if (it.auto) continue;
    out.set(it.key, lookup.forItem(it.key, it.label));
  }
  return out;
}
