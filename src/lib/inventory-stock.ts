import { inventory, warehouses, type InventoryItem } from "@/lib/sample-data";
import { availableOf, blockedOf, findInventoryRow, type StoredItem } from "@/lib/inventory-store";

// ─────────────────────────────────────────────────────────────────────────────
// Multi-warehouse stock aggregation (Option A).
//
// The canonical `inventory` list holds ONE row per item — that row carries the
// item's stock in its PRIMARY warehouse (Central Warehouse, WH-001). When the
// same item is also held in other warehouses, those extra holdings live in
// EXTRA_WAREHOUSE_STOCK below. The helpers here combine the two so the rest of
// the app can ask for an item's *actual* on-hand stock (summed across every
// warehouse) or its per-warehouse breakdown — without every screen having to
// know the layout.
//
// Reads prefer the PERSISTED stock master and fall back to the seed only before
// the Inventory page has ever written it. Reading the seed at runtime is what
// made issuing screens show stale availability: every receipt, issue, transfer
// and adjustment posts to the persisted store, so the frozen array stopped
// being the truth the moment anything moved.
//
// Each helper comes in two forms — on-hand and AVAILABLE. Anything deciding
// whether stock may be consumed must use the available form, which excludes
// quantity held for QC. See lib/inventory-store.ts.
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_WAREHOUSE = "WH-001";

export type WarehouseStock = {
  warehouseId: string;
  warehouseName: string;
  stock: number;
};

/**
 * Additional warehouse holdings beyond an item's primary (base) warehouse.
 * Matched to inventory rows by item name (case-insensitive) — the same key the
 * fulfillment screens use to look items up.
 */
export const EXTRA_WAREHOUSE_STOCK: { itemName: string; warehouseId: string; stock: number }[] = [
  { itemName: "Chicken Breast", warehouseId: "WH-002", stock: 40 },
  { itemName: "Chicken Breast", warehouseId: "WH-003", stock: 20 },
  { itemName: "Tomato",         warehouseId: "WH-002", stock: 95 },
  { itemName: "Salmon Fillet",  warehouseId: "WH-002", stock: 18 },
];

const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id;

function seedRow(idOrName: string): InventoryItem | undefined {
  const key = idOrName.toLowerCase();
  return inventory.find((i) => i.id === idOrName || i.name.toLowerCase() === key);
}

/**
 * The live row for an item: persisted if the store has been written, else seed.
 * Returned as the persisted shape so callers can read blocked quantity off it.
 */
function baseRow(idOrName: string): StoredItem | undefined {
  return findInventoryRow(idOrName) ?? (seedRow(idOrName) as StoredItem | undefined);
}

function byWarehouse(idOrName: string, qtyOfPrimary: (row: StoredItem) => number): WarehouseStock[] {
  const row = baseRow(idOrName);
  if (!row) return [];
  const out: WarehouseStock[] = [
    { warehouseId: PRIMARY_WAREHOUSE, warehouseName: warehouseName(PRIMARY_WAREHOUSE), stock: qtyOfPrimary(row) },
  ];
  for (const e of EXTRA_WAREHOUSE_STOCK) {
    if (e.itemName.toLowerCase() === row.name.toLowerCase()) {
      out.push({ warehouseId: e.warehouseId, warehouseName: warehouseName(e.warehouseId), stock: e.stock });
    }
  }
  return out;
}

/** Per-warehouse ON-HAND breakdown for an item: primary row + any extra holdings. */
export function getItemStockByWarehouse(idOrName: string): WarehouseStock[] {
  return byWarehouse(idOrName, (row) => row.stock);
}

/**
 * Per-warehouse AVAILABLE breakdown — on-hand less anything held for QC.
 *
 * The hold is attributed to the primary warehouse because that is where receipts
 * and production output post; the extra-warehouse holdings carry no lots of
 * their own and so cannot be held independently.
 */
export function getItemAvailableByWarehouse(idOrName: string): WarehouseStock[] {
  return byWarehouse(idOrName, (row) => availableOf(row));
}

/** Total on-hand stock for an item across every warehouse it's held in. */
export function getItemStock(idOrName: string): number {
  return getItemStockByWarehouse(idOrName).reduce((s, w) => s + w.stock, 0);
}

/** Total consumable stock for an item across every warehouse. */
export function getItemAvailable(idOrName: string): number {
  return getItemAvailableByWarehouse(idOrName).reduce((s, w) => s + w.stock, 0);
}

/** Quantity of an item currently held for QC (0 when none). */
export function getItemBlocked(idOrName: string): number {
  return blockedOf(baseRow(idOrName));
}

/** True when an item is stocked in more than one warehouse. */
export function isMultiWarehouse(idOrName: string): boolean {
  return getItemStockByWarehouse(idOrName).length > 1;
}

/**
 * Storage class (e.g. Dry / Cold / Frozen) for an item, read from the stock
 * master rather than hardcoded on each consuming record.
 */
export function getItemStorage(idOrName: string): string {
  const storage = baseRow(idOrName)?.storage;
  return typeof storage === "string" ? storage : "";
}
