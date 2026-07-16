// ─────────────────────────────────────────────────────────────────────────────
// Item Price Setup — the single source of truth for supplier-wise item rates
// (Configuration → Price Setup). Prices are keyed by item (code + name) with an
// effective date range and a supplier, and are consumed anywhere a purchase rate
// would otherwise be typed by hand (e.g. Direct Receive line items).
//
// Stored under localStorage["harvest-data-v1:config-price-rows"] via
// usePersistedState — this module owns the type, storage key, and seed so the
// Price Setup page and its consumers can't drift apart.
// ─────────────────────────────────────────────────────────────────────────────

export type ItemPrice = {
  id: string;
  itemCode: string;
  item: string;
  uom: string;
  supplier: string;
  unitPrice: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: "Active" | "Expired" | "Scheduled";
};

export const PRICE_STORE_KEY = "config-price-rows";

export const PRICE_SEED: ItemPrice[] = [
  { id: "PRC-001", itemCode: "RM-RICE-BSMT", item: "Basmati Rice",        uom: "Kg",     supplier: "Agro Fresh Ltd.", unitPrice: 145.00, currency: "BDT", effectiveFrom: "2026-04-01", effectiveTo: "2026-06-30", status: "Active"    },
  { id: "PRC-002", itemCode: "RM-CHK-BRST",  item: "Chicken Breast",      uom: "Kg",     supplier: "Meat & Co.",      unitPrice: 380.00, currency: "BDT", effectiveFrom: "2026-04-15", effectiveTo: "2026-07-15", status: "Active"    },
  { id: "PRC-003", itemCode: "RM-VEG-TOM",   item: "Tomato",              uom: "Kg",     supplier: "Agro Fresh Ltd.", unitPrice: 65.00,  currency: "BDT", effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31", status: "Active"    },
  { id: "PRC-004", itemCode: "RM-OIL-CKG",   item: "Cooking Oil",         uom: "Litre",  supplier: "Agro Fresh Ltd.", unitPrice: 195.50, currency: "BDT", effectiveFrom: "2026-04-01", effectiveTo: "2026-06-30", status: "Active"    },
  { id: "PRC-005", itemCode: "PK-BOX-MEAL",  item: "Meal Box",            uom: "Piece",  supplier: "Packaging BD",    unitPrice: 18.00,  currency: "BDT", effectiveFrom: "2026-06-01", effectiveTo: "2026-12-31", status: "Scheduled" },
  { id: "PRC-006", itemCode: "BV-WTR-250",   item: "Mineral Water 250ml", uom: "Bottle", supplier: "Pure Water Co.",  unitPrice: 12.00,  currency: "BDT", effectiveFrom: "2026-01-01", effectiveTo: "2026-03-31", status: "Expired"   },
];

/** Non-React read of the persisted price table (falls back to the seed). */
export function readItemPrices(): ItemPrice[] {
  if (typeof window === "undefined") return PRICE_SEED;
  try {
    const raw = window.localStorage.getItem("harvest-data-v1:" + PRICE_STORE_KEY);
    if (raw != null) return JSON.parse(raw) as ItemPrice[];
  } catch {
    /* unavailable / corrupt — fall back to seed */
  }
  return PRICE_SEED;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Resolve the best Price Setup entry for an item. Matches by item code OR name
 * (case-insensitive), prefers a price that is effective on `on` (default today)
 * and, among those, the one matching `supplier`, then Active status, then the
 * most recent effectiveFrom. Returns undefined when the item has no price set.
 */
export function resolveItemPrice(
  rows: ItemPrice[],
  q: { code?: string; name?: string; supplier?: string; on?: string },
): ItemPrice | undefined {
  const code = q.code?.trim().toLowerCase();
  const name = q.name?.trim().toLowerCase();
  if (!code && !name) return undefined;

  const matches = rows.filter(
    (r) =>
      (code && r.itemCode.trim().toLowerCase() === code) ||
      (name && r.item.trim().toLowerCase() === name),
  );
  if (matches.length === 0) return undefined;

  const on = q.on ?? todayISO();
  const effective = matches.filter((r) => r.effectiveFrom <= on && on <= r.effectiveTo);
  const pool = effective.length ? effective : matches;

  const supplier = q.supplier?.trim().toLowerCase();
  const score = (r: ItemPrice) =>
    (supplier && r.supplier.trim().toLowerCase() === supplier ? 100 : 0) +
    (r.status === "Active" ? 10 : r.status === "Scheduled" ? 5 : 0);

  return [...pool].sort(
    (a, b) => score(b) - score(a) || b.effectiveFrom.localeCompare(a.effectiveFrom),
  )[0];
}

/** Convenience: just the unit price for an item, or undefined if none set. */
export function resolveUnitPrice(
  rows: ItemPrice[],
  q: { code?: string; name?: string; supplier?: string; on?: string },
): number | undefined {
  return resolveItemPrice(rows, q)?.unitPrice;
}
