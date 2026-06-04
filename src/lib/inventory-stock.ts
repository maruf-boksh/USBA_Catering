import { inventory, warehouses, type InventoryItem } from "@/lib/sample-data";

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

function baseRow(idOrName: string): InventoryItem | undefined {
  const key = idOrName.toLowerCase();
  return inventory.find((i) => i.id === idOrName || i.name.toLowerCase() === key);
}

/** Per-warehouse stock breakdown for an item: primary row + any extra holdings. */
export function getItemStockByWarehouse(idOrName: string): WarehouseStock[] {
  const row = baseRow(idOrName);
  if (!row) return [];
  const out: WarehouseStock[] = [
    { warehouseId: PRIMARY_WAREHOUSE, warehouseName: warehouseName(PRIMARY_WAREHOUSE), stock: row.stock },
  ];
  for (const e of EXTRA_WAREHOUSE_STOCK) {
    if (e.itemName.toLowerCase() === row.name.toLowerCase()) {
      out.push({ warehouseId: e.warehouseId, warehouseName: warehouseName(e.warehouseId), stock: e.stock });
    }
  }
  return out;
}

/** Total on-hand stock for an item across every warehouse it's held in. */
export function getItemStock(idOrName: string): number {
  return getItemStockByWarehouse(idOrName).reduce((s, w) => s + w.stock, 0);
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
  const row = baseRow(idOrName);
  return row?.storage ?? "";
}
