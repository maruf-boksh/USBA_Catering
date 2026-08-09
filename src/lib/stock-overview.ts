// ─────────────────────────────────────────────────────────────────────────────
// The Stock Overview report as DATA.
//
// routes/inventory.tsx renders the web report, but it builds its rows inside the
// component out of four persisted stores, so nothing outside React could ask
// "what does Stock Overview currently say?". The mobile Stock screen needs
// exactly that, and was showing a hardcoded mock list instead — it never moved
// when stock moved.
//
// This module is the headless version of that page: same stores, same merge,
// same status rule. Read-only — every mutation still goes through
// `applyInventoryStock` (lib/stock-adjustments.ts).
//
// The report is the union of three stores, mirroring the web table:
//   • kitchen stock      — `inventory-items` (the stock master)
//   • airline consumables— `airline-consumables-items` (galley store)
//   • equipment assets   — `airline-equipments-assets`, GRN-received units only
// ─────────────────────────────────────────────────────────────────────────────

import {
  inventory,
  consumableItems as CONSUMABLE_SEED,
  equipmentAssets as EQUIPMENT_SEED,
  nearExpiryCount,
  type ConsumableItem,
  type EquipmentAsset,
  type InventoryItem,
} from "@/lib/sample-data";
import { readInventoryRows, blockedOf, type StoredItem } from "@/lib/inventory-store";
import { EXTRA_WAREHOUSE_STOCK } from "@/lib/inventory-stock";
import { getItemProfiles } from "@/lib/item-profiles";
import { roundQty } from "@/lib/num";

/** Item type the consumables store is projected under in the unified report. */
export const CONSUMABLE_ITEM_TYPE = "Airline Consumable";
export const EQUIPMENT_ITEM_TYPE = "Equipment";

const CONSUMABLE_KEY = "harvest-data-v1:airline-consumables-items";
const EQUIPMENT_KEY = "harvest-data-v1:airline-equipments-assets";

export type StockStatus = "OK" | "Low" | "Critical";

/**
 * Kitchen-stock status rule. Below the reorder level is Critical; within the
 * threshold buffer above it is Low. Mirrors `computeStatus` in the web report.
 */
export function computeStockStatus(
  stock: number,
  reorder: number,
  thresholdPct = 20,
): StockStatus {
  if (stock < reorder) return "Critical";
  if (stock < reorder * (1 + thresholdPct / 100)) return "Low";
  return "OK";
}

/** Consumables use their own (galley-page) rule: Critical below half reorder. */
export function computeConsumableStatus(stock: number, reorder: number): StockStatus {
  if (stock < reorder * 0.5) return "Critical";
  if (stock < reorder) return "Low";
  return "OK";
}

export type StockOverviewRow = {
  id: string;
  name: string;
  category: string;
  uom: string;
  itemType: string;
  storage: string;
  /** On-hand across every warehouse — the report's Closing Qty. */
  stock: number;
  /** Slice of on-hand held for QC and not issuable. */
  held: number;
  /** stock − held. What may actually be consumed. */
  available: number;
  reorder: number;
  status: StockStatus;
  /** Valuation of the on-hand balance, BDT. 0 when no cost basis is known. */
  value: number;
  batchCount: number;
};

export type StockOverviewSummary = {
  totalItems: number;
  ok: number;
  low: number;
  critical: number;
  /** Items with any quantity held for QC, and the total held quantity. */
  heldItems: number;
  heldQty: number;
  nearExpiry30: number;
  totalValue: number;
};

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

const lower = (s: string) => (s ?? "").trim().toLowerCase();
const num = (v: unknown) => (Number(v) || 0);

/**
 * Extra-warehouse holdings summed per item name. The stock master carries only
 * the primary warehouse on the row, so the report adds these on to reach the
 * item's true on-hand — the same sum the web's `totalStockFor` makes.
 */
function extraWarehouseByName(): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of EXTRA_WAREHOUSE_STOCK) {
    const k = lower(e.itemName);
    m.set(k, (m.get(k) ?? 0) + e.stock);
  }
  return m;
}

/**
 * The live consumables master: persisted rows, backfilled with any seed item a
 * store written before that item existed would otherwise be missing.
 */
function readConsumables(): ConsumableItem[] {
  const persisted = readJson<ConsumableItem[]>(CONSUMABLE_KEY);
  if (!persisted || persisted.length === 0) return CONSUMABLE_SEED;
  const have = new Set(persisted.map((c) => c.id));
  const missing = CONSUMABLE_SEED.filter((c) => !have.has(c.id));
  return missing.length ? [...persisted, ...missing] : persisted;
}

/**
 * Every row the Stock Overview report shows, with live quantities.
 *
 * Taxonomy (type / category / UoM / storage) is resolved against the Item
 * Profile master so an edit there flows through here, exactly as it does on the
 * web page.
 */
export function loadStockOverviewRows(): StockOverviewRow[] {
  const profiles = new Map<string, ReturnType<typeof getItemProfiles>[number]>();
  for (const p of getItemProfiles()) profiles.set(lower(p.name), p);
  const extras = extraWarehouseByName();

  const invRows = readInventoryRows() ?? (inventory as unknown as StoredItem[]);
  const kitchen: StockOverviewRow[] = invRows
    // A nameless row is the residue of an old registry bug; the web page drops
    // these on mount, so the report must not count them either.
    .filter((r) => lower(r.name) !== "")
    .map((r) => {
      const profile = profiles.get(lower(r.name));
      const stock = roundQty(num(r.stock) + (extras.get(lower(r.name)) ?? 0));
      const held = roundQty(Math.min(blockedOf(r), Math.max(0, stock)));
      const available = roundQty(Math.max(0, stock - held));
      const reorder = num(r.reorder);
      const threshold = typeof r.threshold === "number" ? r.threshold : 20;
      const batches = Array.isArray(r.batches) ? r.batches : [];
      return {
        id: String(r.id ?? r.name),
        name: r.name,
        category: profile?.category ?? String(r.category ?? ""),
        uom: profile?.uom ?? String(r.uom ?? ""),
        itemType: profile?.itemType ?? String(r.itemType ?? ""),
        storage: profile?.storage ?? String(r.storage ?? ""),
        stock,
        held,
        available,
        reorder,
        // Held stock is not "OK" stock — once anything is held the status is
        // re-derived from what is left usable, matching the web report.
        status: held > 0
          ? computeStockStatus(available, reorder, threshold)
          : ((r.status as StockStatus) ?? "OK"),
        value: roundQty(batches.reduce((s, b) => s + num(b.qty) * num(b.costPrice), 0)),
        batchCount: batches.length,
      };
    });

  const consumables: StockOverviewRow[] = readConsumables().map((c) => ({
    id: c.id,
    name: c.name,
    category: String(c.category ?? ""),
    uom: c.uom,
    itemType: CONSUMABLE_ITEM_TYPE,
    storage: "Dry",
    stock: roundQty(num(c.stock)),
    held: 0,
    available: roundQty(num(c.stock)),
    reorder: num(c.reorder),
    status: computeConsumableStatus(num(c.stock), num(c.reorder)),
    value: roundQty(num(c.stock) * num(c.unitCost)),
    batchCount: 0,
  }));

  // Only assets that completed the procurement→GRN flow are stock; the rest of
  // the register is not yet received.
  const assetRows = readJson<EquipmentAsset[]>(EQUIPMENT_KEY) ?? EQUIPMENT_SEED;
  const assets: StockOverviewRow[] = assetRows
    .filter((a) => !!a.grnNumber)
    .map((a) => ({
      id: `ASSET-${a.id}`,
      name: a.name,
      category: String(a.category ?? ""),
      uom: "Unit",
      itemType: EQUIPMENT_ITEM_TYPE,
      storage: "Dry",
      stock: 1,
      held: 0,
      available: 1,
      reorder: 0,
      status: "OK" as const,
      value: 0,
      batchCount: 0,
    }));

  return [...kitchen, ...consumables, ...assets];
}

/**
 * Report-level KPIs over the rows. Status counts span kitchen stock and
 * consumables the same way the web KPI cards do; valuation adds both stores.
 */
export function stockOverviewSummary(
  rows: StockOverviewRow[] = loadStockOverviewRows(),
): StockOverviewSummary {
  const counted = rows.filter((r) => r.itemType !== EQUIPMENT_ITEM_TYPE);
  let heldItems = 0;
  let heldQty = 0;
  for (const r of rows) {
    if (r.held > 0) {
      heldItems += 1;
      heldQty = roundQty(heldQty + r.held);
    }
  }
  return {
    totalItems: rows.length,
    ok: counted.filter((r) => r.status === "OK").length,
    low: counted.filter((r) => r.status === "Low").length,
    critical: counted.filter((r) => r.status === "Critical").length,
    heldItems,
    heldQty,
    nearExpiry30: nearExpiryCount(
      (readInventoryRows() as unknown as InventoryItem[]) ?? inventory,
      30,
    ),
    totalValue: roundQty(rows.reduce((s, r) => s + r.value, 0)),
  };
}
