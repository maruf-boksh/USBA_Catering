// Item registry helpers — resolve and auto-register item masters across the
// static seed and the persisted Item Profile / Stock Overview stores.
//
// Production orders are often raised for an output item (from a meal plan or a
// free-typed name) that isn't yet in the Item Profile. When such a run is logged
// in Production Entry we register the item on the fly so it becomes first-class:
// it shows in Item Profile, gets a Stock Overview row, and its produced quantity
// can post as stock / a batch lot — letting the run proceed to the next stage.

import {
  items as STATIC_ITEMS, inventory as STATIC_INVENTORY, isBatchTrackedForMaster,
  type ItemMaster, type InventoryItem,
} from "@/lib/sample-data";

const PREFIX = "harvest-data-v1:";
const ITEMS_KEY = PREFIX + "config-item-rows";
const INV_KEY = PREFIX + "inventory-items";

/** Stock Overview row shape as persisted (base InventoryItem + the location /
 *  classification fields the Stock Overview page augments rows with). */
type InvRow = InventoryItem & {
  officeId?: string;
  warehouseId?: string;
  itemType?: string;
  subCategory?: string;
  threshold?: number;
};

function readItems(): ItemMaster[] {
  try {
    const raw = window.localStorage.getItem(ITEMS_KEY);
    if (raw != null) {
      const arr = JSON.parse(raw) as ItemMaster[];
      if (Array.isArray(arr)) return arr;
    }
  } catch { /* fall through to seed */ }
  return STATIC_ITEMS;
}

/**
 * Resolve an item master by code (preferred) then name, across the persisted
 * Item Profile list and the static seed. Returns undefined when unknown.
 */
export function resolveItemMaster(name?: string, code?: string): ItemMaster | undefined {
  const list = readItems();
  if (code) {
    const c = code.toLowerCase();
    const byCode = list.find((m) => m.code.toLowerCase() === c);
    if (byCode) return byCode;
  }
  if (name) {
    const n = name.toLowerCase();
    return list.find((m) => m.name.toLowerCase() === n);
  }
  return undefined;
}

/**
 * Whether an item master is batch-tracked. An explicit `batchTracked` flag on the
 * master wins (this is what auto-registered items carry); otherwise defer to the
 * static-seed + runtime-override resolver. Defaults to batch-tracked.
 */
export function isItemBatchTracked(master: ItemMaster): boolean {
  if (typeof master.batchTracked === "boolean") return master.batchTracked;
  return isBatchTrackedForMaster(master.id);
}

export type RegisterItemInput = {
  name: string;
  code?: string;
  uom?: string;
  officeId?: string;
  warehouseId?: string;
  /** Whether the new item is batch-tracked (lots + expiry) or a single pooled
   *  stock. Defaults to batch-tracked. */
  batchTracked?: boolean;
};

/**
 * Ensure a production output item exists in the Item Profile (and Stock
 * Overview). Returns the existing master when already registered; otherwise
 * creates an active, batch-tracked Finished Good plus a matching zero-stock
 * Stock Overview row and returns the new master.
 */
export function ensureProductionItemRegistered(input: RegisterItemInput): ItemMaster {
  const existing = resolveItemMaster(input.name, input.code);
  if (existing) return existing;

  const name = input.name.trim();
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 16) || "ITEM";
  const code = (input.code && input.code.trim()) || `FG-${slug}`;
  const uom = input.uom || "Piece";

  const items = readItems();
  const batchTracked = input.batchTracked ?? true;
  const master: ItemMaster = {
    id: `ITM-${code}`,
    code,
    name,
    itemType: "Finished Good",
    category: "Meal",
    subCategory: "Fresh",
    uom,
    status: "Active",
    batchTracked,
    canProduce: true,
    canPurchase: false,
    canSell: true,
    officeId: input.officeId,
    warehouseId: input.warehouseId,
    officeIds: input.officeId ? [input.officeId] : undefined,
    warehouseIds: input.warehouseId ? [input.warehouseId] : undefined,
  };
  try {
    window.localStorage.setItem(ITEMS_KEY, JSON.stringify([master, ...items]));
  } catch { /* non-fatal */ }

  // Matching Stock Overview row — zero stock; the produced quantity posts
  // separately (as a lot for batch items) via the production hook.
  try {
    const raw = window.localStorage.getItem(INV_KEY);
    const invList = (raw != null ? JSON.parse(raw) : STATIC_INVENTORY) as InvRow[];
    if (Array.isArray(invList) && !invList.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
      const invRow: InvRow = {
        id: `INV-${code}`,
        name,
        category: master.category,
        uom,
        stock: 0,
        reorder: 0,
        batch: "—",
        expiry: "—",
        storage: "Cold",
        status: "OK",
        batches: [],
        officeId: input.officeId,
        warehouseId: input.warehouseId,
        itemType: "Finished Good",
        subCategory: "Fresh",
        threshold: 0,
      };
      window.localStorage.setItem(INV_KEY, JSON.stringify([invRow, ...invList]));
    }
  } catch { /* non-fatal */ }

  return master;
}
