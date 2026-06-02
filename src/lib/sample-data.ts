export const flights = [
  { id: "BS-101", flight: "BS-101", sector: "DAC-CGP", aircraft: "ATR 72-600", dep: "08:30", arr: "09:30", pax: 68, adult: 60, child: 6, infant: 2, crew: 4, type: "Domestic", window: "Breakfast", duration: "1h 0m", status: "Scheduled" },
  { id: "BS-203", flight: "BS-203", sector: "DAC-DXB", aircraft: "B737-800", dep: "12:15", arr: "16:45", pax: 168, adult: 150, child: 14, infant: 4, crew: 8, type: "International", window: "Lunch", duration: "4h 30m", status: "Boarding" },
  { id: "BS-307", flight: "BS-307", sector: "DAC-KUL", aircraft: "A330-300", dep: "23:50", arr: "06:20", pax: 282, adult: 260, child: 18, infant: 4, crew: 12, type: "International", window: "Dinner", duration: "5h 30m", status: "Scheduled" },
  { id: "BS-141", flight: "BS-141", sector: "DAC-CXB", aircraft: "DASH 8", dep: "10:00", arr: "11:05", pax: 72, adult: 65, child: 5, infant: 2, crew: 4, type: "Domestic", window: "Snack", duration: "1h 5m", status: "Departed" },
  { id: "BS-225", flight: "BS-225", sector: "DAC-DOH", aircraft: "B737 MAX 8", dep: "15:40", arr: "19:10", pax: 174, adult: 158, child: 12, infant: 4, crew: 8, type: "International", window: "Snack", duration: "4h 30m", status: "Delayed" },
  { id: "BS-117", flight: "BS-117", sector: "DAC-SYL", aircraft: "ATR 72-600", dep: "07:00", arr: "07:50", pax: 64, adult: 58, child: 5, infant: 1, crew: 4, type: "Domestic", window: "Breakfast", duration: "0h 50m", status: "Scheduled" },
  { id: "BS-411", flight: "BS-411", sector: "CGP-DXB", aircraft: "B737-800", dep: "18:25", arr: "22:10", pax: 162, adult: 144, child: 14, infant: 4, crew: 8, type: "International", window: "Dinner", duration: "5h 15m", status: "Scheduled" },
];

// ── FEFO (First-Expiry-First-Out) inventory model ──────────────────────────
// Each inventory item carries one or more batch lots. Consumption draws from
// the batch with the earliest expiry first (see allocateFefo below). The
// legacy `batch` / `expiry` / `stock` fields are kept and derived from the
// batches[] array for backwards-compat with screens that read them directly.

export type BatchLot = {
  batchNo: string;
  /** ISO date YYYY-MM-DD */
  expiry: string;
  qty: number;
  /** Cost price per UoM in BDT, used for valuation. */
  costPrice: number;
  /** ISO date YYYY-MM-DD — when this lot was received. */
  receivedOn: string;
  /** Bin / rack / shelf location inside the warehouse. */
  binLocation?: string;
};

/** Allocation method: FEFO uses expiry, FIFO uses receipt date. */
export type AllocationMethod = "FEFO" | "FIFO";

export type InventoryItem = {
  id: string;
  name: string;
  category: string;
  uom: string;
  stock: number;
  reorder: number;
  batch: string;
  expiry: string;
  storage: string;
  status: "OK" | "Low" | "Critical";
  batches: BatchLot[];
};

/** Build an inventory row from a list of batches; derives stock + earliest-expiry fields. */
function makeInventoryItem(
  base: Omit<InventoryItem, "stock" | "batch" | "expiry" | "status"> & { status?: InventoryItem["status"] },
): InventoryItem {
  const sorted = [...base.batches].sort((a, b) => a.expiry.localeCompare(b.expiry));
  const stock = sorted.reduce((s, b) => s + b.qty, 0);
  const earliest = sorted[0];
  const status: InventoryItem["status"] =
    base.status ??
    (stock <= 0 ? "Critical" : stock < base.reorder ? "Low" : "OK");
  return {
    ...base,
    batches: sorted,
    stock,
    batch: earliest?.batchNo ?? "—",
    expiry: earliest?.expiry ?? "—",
    status,
  };
}

// Hand-curated batches for items that appear in seeded demand requests. These
// keep the existing INV-100x references stable. Everything else is auto-derived
// from the Item Profile master (see `inventory` further down).
const SEED_INVENTORY: InventoryItem[] = [
  makeInventoryItem({
    id: "INV-1001", name: "Basmati Rice", category: "Grains", uom: "Kg",
    reorder: 200, storage: "Dry",
    batches: [
      { batchNo: "BR-2406", expiry: "2026-09-30", qty: 280, costPrice: 142, receivedOn: "2026-03-10", binLocation: "A1-R3-S2" },
      { batchNo: "BR-2408", expiry: "2026-12-15", qty: 200, costPrice: 148, receivedOn: "2026-05-02", binLocation: "A1-R3-S3" },
    ],
  }),
  makeInventoryItem({
    id: "INV-1002", name: "Chicken Breast", category: "Protein", uom: "Kg",
    reorder: 100, storage: "Cold",
    batches: [
      { batchNo: "CB-2511", expiry: "2025-11-12", qty: 24, costPrice: 375, receivedOn: "2025-11-01", binLocation: "C2-R1-S1" },
      { batchNo: "CB-2606", expiry: "2026-06-30", qty: 40, costPrice: 385, receivedOn: "2026-04-18", binLocation: "C2-R1-S2" },
    ],
  }),
  makeInventoryItem({
    id: "INV-1003", name: "Mineral Water 250ml", category: "Beverage", uom: "Bottle",
    reorder: 1500, storage: "Dry",
    batches: [
      { batchNo: "MW-2606", expiry: "2027-06-01", qty: 2400, costPrice: 11, receivedOn: "2026-02-20", binLocation: "B3-R2-S1" },
      { batchNo: "MW-2611", expiry: "2027-11-15", qty: 1800, costPrice: 12, receivedOn: "2026-05-05", binLocation: "B3-R2-S2" },
    ],
  }),
  makeInventoryItem({
    id: "INV-1004", name: "Butter Salted", category: "Dairy", uom: "Kg",
    reorder: 30, storage: "Cold",
    batches: [
      { batchNo: "BT-2510", expiry: "2025-12-20", qty: 14, costPrice: 720, receivedOn: "2025-10-12", binLocation: "C1-R4-S1" },
      { batchNo: "BT-2603", expiry: "2026-03-15", qty: 24, costPrice: 740, receivedOn: "2026-01-08", binLocation: "C1-R4-S2" },
    ],
  }),
  makeInventoryItem({
    id: "INV-1005", name: "Tomato", category: "Vegetable", uom: "Kg",
    reorder: 80, storage: "Cold",
    batches: [
      { batchNo: "TM-2511", expiry: "2025-11-15", qty: 8,  costPrice: 62, receivedOn: "2025-11-04", binLocation: "C3-R1-S1" },
      { batchNo: "TM-2602", expiry: "2026-02-10", qty: 14, costPrice: 68, receivedOn: "2026-01-22", binLocation: "C3-R1-S2" },
    ],
  }),
  makeInventoryItem({
    id: "INV-1006", name: "Wheat Flour", category: "Grains", uom: "Kg",
    reorder: 150, storage: "Dry",
    batches: [
      { batchNo: "WF-2509", expiry: "2026-08-10", qty: 180, costPrice: 78, receivedOn: "2026-03-01", binLocation: "A2-R1-S1" },
      { batchNo: "WF-2604", expiry: "2026-11-20", qty: 140, costPrice: 82, receivedOn: "2026-05-12", binLocation: "A2-R1-S2" },
    ],
  }),
  makeInventoryItem({
    id: "INV-1007", name: "Olive Oil", category: "Oil", uom: "Litre",
    reorder: 40, storage: "Dry",
    batches: [
      { batchNo: "OO-2507", expiry: "2026-07-22", qty: 24, costPrice: 880, receivedOn: "2026-01-15", binLocation: "A4-R2-S1" },
      { batchNo: "OO-2602", expiry: "2027-02-10", qty: 34, costPrice: 920, receivedOn: "2026-04-10", binLocation: "A4-R2-S2" },
    ],
  }),
  makeInventoryItem({
    id: "INV-1008", name: "Salmon Fillet", category: "Protein", uom: "Kg",
    reorder: 30, storage: "Frozen",
    batches: [
      { batchNo: "SL-2511", expiry: "2025-11-09", qty: 4, costPrice: 1380, receivedOn: "2025-10-22", binLocation: "F1-R1-S1" },
      { batchNo: "SL-2604", expiry: "2026-08-15", qty: 8, costPrice: 1420, receivedOn: "2026-04-04", binLocation: "F1-R1-S2" },
    ],
  }),
];

// ── Mutable per-item overrides ──────────────────────────────────────────────
// Item Profile holds the canonical allocationMethod + batchTracked flag, but
// the UI lets users flip them per item at runtime. Overrides are keyed by
// master id (ITM-xxx). A shared pub/sub lets components subscribe via
// useSyncExternalStore and re-render on either flag changing.

const allocationOverrides = new Map<string, AllocationMethod>();
const batchTrackedOverrides = new Map<string, boolean>();
const allocationListeners = new Set<() => void>();
let allocationVersion = 0;

function notify(): void {
  allocationVersion++;
  allocationListeners.forEach((l) => l());
}

export function setAllocationMethod(masterId: string, method: AllocationMethod): void {
  if (allocationOverrides.get(masterId) === method) return;
  allocationOverrides.set(masterId, method);
  notify();
}

export function setBatchTracked(masterId: string, value: boolean): void {
  if (batchTrackedOverrides.get(masterId) === value) return;
  batchTrackedOverrides.set(masterId, value);
  notify();
}

export function subscribeAllocationMethod(listener: () => void): () => void {
  allocationListeners.add(listener);
  return () => { allocationListeners.delete(listener); };
}

export function getAllocationVersion(): number {
  return allocationVersion;
}

/** Resolve the Item Profile master that backs an inventory row, if any. */
export function resolveMasterForInventory(inventoryId: string): ItemMaster | undefined {
  const inv = inventory.find((i) => i.id === inventoryId);
  if (!inv) return undefined;
  return (
    items.find((m) => `INV-${m.code}` === inventoryId) ??
    items.find((m) => m.name === inv.name)
  );
}

/** Resolve the allocation method for an inventory item by looking up its master. */
export function getAllocationMethod(itemId: string): AllocationMethod {
  const master = resolveMasterForInventory(itemId);
  if (master && allocationOverrides.has(master.id)) {
    return allocationOverrides.get(master.id)!;
  }
  return master?.allocationMethod ?? "FEFO";
}

/** Resolve the effective allocation method for an Item Profile master by id. */
export function getAllocationMethodForMaster(masterId: string): AllocationMethod {
  if (allocationOverrides.has(masterId)) return allocationOverrides.get(masterId)!;
  const master = items.find((m) => m.id === masterId);
  return master?.allocationMethod ?? "FEFO";
}

/** Whether an Item Profile master is tracked by batch/lot. Defaults true. */
export function isBatchTrackedForMaster(masterId: string): boolean {
  if (batchTrackedOverrides.has(masterId)) return batchTrackedOverrides.get(masterId)!;
  const master = items.find((m) => m.id === masterId);
  return master?.batchTracked ?? true;
}

/** Whether an inventory row's underlying master is tracked by batch. */
export function isBatchTrackedForInventory(inventoryId: string): boolean {
  const master = resolveMasterForInventory(inventoryId);
  if (!master) return true; // orphan rows default to batch-tracked
  if (batchTrackedOverrides.has(master.id)) return batchTrackedOverrides.get(master.id)!;
  return master.batchTracked ?? true;
}

// ── ALT UOM helpers ─────────────────────────────────────────────────────────

export type UomOption = {
  uom: string;
  /** Number of Primary UOM units this option converts to. Primary = 1. */
  conversion: number;
  isPrimary: boolean;
};

/** All UOM options usable on a transaction for this item: Primary + any Alt UOMs. */
export function getUomOptionsForMaster(masterId: string): UomOption[] {
  const master = items.find((m) => m.id === masterId);
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
 * Convert a transaction quantity entered in any UOM (Primary or Alt) to the
 * item's Primary UOM. Returns the original qty if no matching alt is found.
 */
export function toPrimaryQty(masterId: string, qty: number, uom: string): number {
  const opts = getUomOptionsForMaster(masterId);
  const opt = opts.find((o) => o.uom === uom);
  if (!opt) return qty;
  return qty * opt.conversion;
}

/** Same as toPrimaryQty but resolves the master from an item NAME (free-text lookup). */
export function toPrimaryQtyByName(itemName: string, qty: number, uom: string): number {
  const master = items.find((m) => m.name === itemName);
  if (!master) return qty;
  return toPrimaryQty(master.id, qty, uom);
}

/** Batches sorted by the item's allocation method (FEFO = expiry asc, FIFO = receivedOn asc). */
export function getOrderedBatches(itemId: string, method?: AllocationMethod): BatchLot[] {
  const item = inventory.find((i) => i.id === itemId);
  if (!item) return [];
  const m = method ?? getAllocationMethod(itemId);
  const sorted = item.batches.filter((b) => b.qty > 0).slice();
  if (m === "FIFO") {
    sorted.sort((a, b) => a.receivedOn.localeCompare(b.receivedOn));
  } else {
    sorted.sort((a, b) => a.expiry.localeCompare(b.expiry));
  }
  return sorted;
}

/** Backwards-compat: explicitly FEFO ordering (used by Stock Overview ladder). */
export function getFefoBatches(itemId: string): BatchLot[] {
  return getOrderedBatches(itemId, "FEFO");
}

export type FefoAllocation = {
  batchNo: string;
  expiry: string;
  qty: number;
  costPrice: number;
  lineCost: number;
};

export type AllocationResult = {
  allocations: FefoAllocation[];
  allocated: number;
  shortfall: number;
  totalCost: number;
  method: AllocationMethod;
};

/**
 * Allocate `qty` of an item across batches using the item's configured method.
 * Returns per-batch draws + shortfall + chosen method.
 */
export function allocate(itemId: string, qty: number): AllocationResult {
  const method = getAllocationMethod(itemId);
  const allocations: FefoAllocation[] = [];
  let remaining = qty;
  let totalCost = 0;
  for (const b of getOrderedBatches(itemId, method)) {
    if (remaining <= 0) break;
    const draw = Math.min(b.qty, remaining);
    const lineCost = draw * b.costPrice;
    allocations.push({
      batchNo: b.batchNo,
      expiry: b.expiry,
      qty: draw,
      costPrice: b.costPrice,
      lineCost,
    });
    remaining -= draw;
    totalCost += lineCost;
  }
  const allocated = qty - remaining;
  return { allocations, allocated, shortfall: Math.max(0, remaining), totalCost, method };
}

/** Backwards-compat alias — prefer `allocate()`. */
export function allocateFefo(itemId: string, qty: number): AllocationResult {
  return allocate(itemId, qty);
}

/** Total inventory valuation = Σ (batch.qty × batch.costPrice). */
export function inventoryValue(items: InventoryItem[] = inventory): number {
  return items.reduce(
    (sum, i) => sum + i.batches.reduce((s, b) => s + b.qty * b.costPrice, 0),
    0,
  );
}

/** Count of items with at least one batch expiring within `days` from `from` (default: today). */
export function nearExpiryCount(
  items: InventoryItem[] = inventory,
  days = 30,
  from: Date = new Date(),
): number {
  const cutoff = new Date(from.getTime() + days * 86400000).toISOString().slice(0, 10);
  return items.filter((i) =>
    i.batches.some((b) => b.qty > 0 && b.expiry <= cutoff),
  ).length;
}

export type SeedPOLineItem = {
  itemId: string;
  name: string;
  qty: number;
  uom: string;
  unitPrice: number;
};

export const purchaseOrders: Array<{
  id: string;
  vendor: string;
  items: number;
  amount: number;
  date: string;
  status: string;
  lineItems: SeedPOLineItem[];
}> = [
  {
    id: "PO-2025-0451", vendor: "Fresh Farms Ltd", items: 5, amount: 248500, date: "2025-11-04", status: "Pending Approval",
    lineItems: [
      { itemId: "RM-VEG-TOM", name: "Tomato",      qty: 180, uom: "Kg", unitPrice: 58 },
      { itemId: "RM-VEG-ONN", name: "Onion",       qty: 240, uom: "Kg", unitPrice: 48 },
      { itemId: "RM-VEG-POT", name: "Potato",      qty: 320, uom: "Kg", unitPrice: 38 },
      { itemId: "RM-VEG-CAR", name: "Carrot",      qty: 90,  uom: "Kg", unitPrice: 52 },
      { itemId: "RM-VEG-CUC", name: "Cucumber",    qty: 80,  uom: "Kg", unitPrice: 45 },
    ],
  },
  {
    id: "PO-2025-0450", vendor: "Halal Meats Co.", items: 3, amount: 184000, date: "2025-11-03", status: "Approved",
    lineItems: [
      { itemId: "RM-CHK-BRST", name: "Chicken Breast",   qty: 220, uom: "Kg", unitPrice: 378 },
      { itemId: "RM-CHK-THGH", name: "Chicken Thigh",    qty: 140, uom: "Kg", unitPrice: 340 },
      { itemId: "RM-BEEF-TLN", name: "Beef Tenderloin",  qty: 60,  uom: "Kg", unitPrice: 850 },
    ],
  },
  {
    id: "PO-2025-0449", vendor: "Aqua Pure BD", items: 2, amount: 92000, date: "2025-11-03", status: "Delivered",
    lineItems: [
      { itemId: "RM-BV-WTR250", name: "Mineral Water 250ml", qty: 2400, uom: "Bottle", unitPrice: 18 },
      { itemId: "RM-BV-WTR500", name: "Mineral Water 500ml", qty: 1200, uom: "Bottle", unitPrice: 28 },
    ],
  },
  {
    id: "PO-2025-0448", vendor: "Spice World", items: 5, amount: 64200, date: "2025-11-02", status: "Ordered",
    lineItems: [
      { itemId: "RM-SPC-CMN", name: "Cumin Powder",    qty: 22, uom: "Kg", unitPrice: 260 },
      { itemId: "RM-SPC-TRM", name: "Turmeric Powder", qty: 18, uom: "Kg", unitPrice: 245 },
      { itemId: "RM-SPC-CHL", name: "Chili Powder",    qty: 25, uom: "Kg", unitPrice: 280 },
      { itemId: "RM-SPC-GMS", name: "Garam Masala",    qty: 12, uom: "Kg", unitPrice: 320 },
      { itemId: "RM-SPC-BPP", name: "Black Pepper",    qty: 8,  uom: "Kg", unitPrice: 380 },
    ],
  },
  {
    id: "PO-2025-0447", vendor: "Dhaka Dairy", items: 3, amount: 38500, date: "2025-11-02", status: "Closed",
    lineItems: [
      { itemId: "RM-DRY-BTRS", name: "Butter (Salted)",     qty: 30,  uom: "Kg",    unitPrice: 480 },
      { itemId: "RM-DRY-MLK",  name: "Milk (Full Cream)",   qty: 120, uom: "Litre", unitPrice: 145 },
      { itemId: "RM-DRY-YGT",  name: "Yogurt",              qty: 40,  uom: "Kg",    unitPrice: 180 },
    ],
  },
  {
    id: "PO-2025-0446", vendor: "Royal Bakery Supplies", items: 4, amount: 122700, date: "2025-11-01", status: "Draft",
    lineItems: [
      { itemId: "RM-FLR-WHT",  name: "Wheat Flour",        qty: 200, uom: "Kg",   unitPrice: 88  },
      { itemId: "RM-OTH-YST",  name: "Yeast (Active Dry)", qty: 30,  uom: "Pack", unitPrice: 110 },
      { itemId: "RM-OTH-BKP",  name: "Baking Powder",      qty: 15,  uom: "Pack", unitPrice: 90  },
      { itemId: "RM-OTH-CHOC", name: "Chocolate (Dark)",   qty: 18,  uom: "Kg",   unitPrice: 540 },
    ],
  },
];

export const demandRequests = [
  {
    id: "DR-9001",
    reference: "BS-203 Meal Plan",
    requestedBy: "A. Khan",
    role: "Flight Kitchen Executive",
    date: "2025-11-05 09:45",
    status: "Partially Fulfilled",
    items: [
      { id: "INV-1002", name: "Chicken Breast", qty: 50, uom: "Kg", type: "Perishable" },
      { id: "INV-1005", name: "Tomato", qty: 110, uom: "Kg", type: "Perishable" },
      { id: "INV-1008", name: "Salmon Fillet", qty: 10, uom: "Kg", type: "Frozen" },
    ],
    note: "Advance kitchen request for 96-hour meal block, day-wise order planning.",
  },
  {
    id: "DR-9002",
    reference: "BS-307 Special Meals",
    requestedBy: "N. Hasan",
    role: "Flight Kitchen Executive",
    date: "2025-11-05 10:15",
    status: "Pending Store Review",
    items: [
      { id: "INV-1001", name: "Basmati Rice", qty: 620, uom: "Kg", type: "Dry" },
      { id: "INV-1005", name: "Tomato", qty: 65, uom: "Kg", type: "Perishable" },
      { id: "INV-1003", name: "Mineral Water 250ml", qty: 5000, uom: "Bottle", type: "Dry" },
    ],
    note: "Store will review and send purchase requisition for low stock items.",
  },
];

export const requisitions = [
  {
    id: "REQ-1101",
    source: "Store",
    reference: "DR-9001",
    items: 3,
    status: "Pending Accounts",
    requestedBy: "S. Ahmed",
    date: "2025-11-05 11:20",
    note: "Need vendor selection and PO creation for kitchen replenishment.",
  },
  {
    id: "REQ-1102",
    source: "Store",
    reference: "DR-9002",
    items: 3,
    status: "Approved",
    requestedBy: "M. Karim",
    date: "2025-11-05 12:05",
    note: "Fresh produce requisition for immediate kitchen stock restock.",
  },
];

export const hygieneChecks = [
  { id: "HM-001", time: "06:00", activity: "All plastic curtains are in good position", status: "Completed", remarks: "Curtains checked at loading bay." },
  { id: "HM-002", time: "08:00", activity: "All aircutters are working properly", status: "Completed", remarks: "Aircutters operating as required." },
  { id: "HM-003", time: "10:00", activity: "Wastage has been disposed properly", status: "Completed", remarks: "Waste bins cleared." },
  { id: "HM-004", time: "12:00", activity: "All cooking utensils are clean & good condition", status: "Completed", remarks: "Utensils washed and stored." },
  { id: "HM-005", time: "14:00", activity: "Any food item kept in danger zone", status: "Pending", remarks: "Monitor temperature in hot hold." },
  { id: "HM-006", time: "16:00", activity: "All chiller/freezer/AC working properly", status: "Completed", remarks: "Chiller stable at 4°C." },
  { id: "HM-007", time: "18:00", activity: "Raw & cooked food kept seperatly in Kitchen/Chiller/freezer", status: "Completed", remarks: "Segregation maintained." },
  { id: "HM-008", time: "20:00", activity: "Maintaining FIFO properly in Kitchen/Chiller/Freezer/Pack/Bakery", status: "Completed", remarks: "FIFO labels verified." },
  { id: "HM-009", time: "22:00", activity: "All open food are covered properly with Date code in Kitchen/Chiller/Freezer/Pack/Bakery", status: "Completed", remarks: "Dated and covered." },
  { id: "HM-010", time: "06:00", activity: "Any expired/spoiled product found Kitchen/Chiller/Freezer/Pack/Bakery", status: "Completed", remarks: "No spoiled items found." },
  { id: "HM-011", time: "08:00", activity: "Any Cooked food, RM/PM are kept directly on the floor", status: "Pending", remarks: "Floor placement inspected." },
  { id: "HM-012", time: "10:00", activity: "Packaging room temp. is below 15°C", status: "Completed", remarks: "Room at 13.8°C." },
  { id: "HM-013", time: "12:00", activity: "Date code check in packaging room", status: "Completed", remarks: "Date codes are correct." },
  { id: "HM-014", time: "14:00", activity: "Meal PKT Holding inside packaging room (Max. 10 Baskets)", status: "Completed", remarks: "5 baskets in use." },
  { id: "HM-015", time: "16:00", activity: "Presence of any pest/insects", status: "Completed", remarks: "Inspection clear." },
];

export const meals = [
  { id: "ML-001", name: "Chicken Biryani", type: "Lunch", calories: 720, portion: "350g", category: "Hot", status: "Approved", serviceGroup: "Passenger", menuStandard: "KML" },
  { id: "ML-002", name: "Veg Pulao", type: "Lunch", calories: 540, portion: "320g", category: "Hot", status: "Approved", serviceGroup: "Passenger", menuStandard: "VGML" },
  { id: "ML-003", name: "Continental Breakfast", type: "Breakfast", calories: 480, portion: "Set", category: "Cold", status: "Approved", serviceGroup: "Passenger", menuStandard: "KML" },
  { id: "ML-004", name: "Grilled Salmon", type: "Dinner", calories: 610, portion: "300g", category: "Hot", status: "Draft", serviceGroup: "Passenger", menuStandard: "CHML" },
  { id: "ML-005", name: "Hindu Meal Special", type: "Lunch", calories: 590, portion: "330g", category: "Special", status: "Approved", serviceGroup: "Passenger", menuStandard: "VGML" },
  { id: "ML-006", name: "Diabetic Meal", type: "Dinner", calories: 420, portion: "300g", category: "Special", status: "Approved", serviceGroup: "Passenger", menuStandard: "KML" },
  { id: "ML-007", name: "Kids Pasta", type: "Snacks", calories: 380, portion: "220g", category: "Child", status: "Approved", serviceGroup: "Passenger", menuStandard: "KML" },
  { id: "ML-008", name: "Crew Combo Meal", type: "H.Snacks", calories: 680, portion: "Set", category: "Crew", status: "Approved", serviceGroup: "Crew", menuStandard: "KML" },
  { id: "ML-009", name: "Vegetable Sandwich", type: "Breakfast", calories: 320, portion: "1 pcs", category: "Cold", status: "Approved", serviceGroup: "Crew", menuStandard: "KML" },
  { id: "ML-010", name: "Chicken Wrap", type: "Snacks", calories: 450, portion: "1 pcs", category: "Hot", status: "Approved", serviceGroup: "Crew", menuStandard: "CHML" },
  { id: "ML-011", name: "Fruit Platter", type: "Snacks", calories: 260, portion: "150g", category: "Cold", status: "Approved", serviceGroup: "Passenger", menuStandard: "VGML" },
  { id: "ML-012", name: "Tea & Biscuit", type: "H.Snacks", calories: 180, portion: "Set", category: "Beverage", status: "Approved", serviceGroup: "Crew", menuStandard: "KML" },
];

export const mealOrders = [
  { id: "MO-1001", date: "2025-11-05", flight: "BS-203", serviceGroup: "Passenger", menuStandard: "KML", mealType: "Lunch", items: 168, calories: 720, status: "Confirmed", note: "BS-203 lunch order" },
  { id: "MO-1002", date: "2025-11-05", flight: "BS-307", serviceGroup: "Passenger", menuStandard: "CHML", mealType: "Dinner", items: 282, calories: 610, status: "Confirmed", note: "BS-307 dinner order" },
  { id: "MO-1003", date: "2025-11-06", flight: "BS-101", serviceGroup: "Passenger", menuStandard: "KML", mealType: "Breakfast", items: 68, calories: 480, status: "Confirmed", note: "BS-101 breakfast order" },
  { id: "MO-1004", date: "2025-11-06", flight: "BS-203", serviceGroup: "Crew", menuStandard: "KML", mealType: "H.Snacks", items: 8, calories: 680, status: "Confirmed", note: "Crew snack order" },
];

export const productionOrders = [
  { id: "PRD-9001", flight: "BS-203", meal: "Chicken Biryani", qty: 168, section: "Hot Kitchen", status: "Cooking", progress: 65 },
  { id: "PRD-9002", flight: "BS-203", meal: "Veg Pulao", qty: 24, section: "Veg Section", status: "Ready for QC", progress: 100 },
  { id: "PRD-9003", flight: "BS-307", meal: "Grilled Salmon", qty: 282, section: "Hot Kitchen", status: "In Preparation", progress: 30 },
  { id: "PRD-9004", flight: "BS-307", meal: "Continental Breakfast", qty: 282, section: "Cold Kitchen", status: "Pending", progress: 0 },
  { id: "PRD-9005", flight: "BS-101", meal: "Hindu Meal Special", qty: 8, section: "Special Meal", status: "Approved", progress: 100 },
  { id: "PRD-9006", flight: "BS-225", meal: "Heavy Snack Box", qty: 174, section: "Cold Kitchen", status: "Sent to Packaging", progress: 100 },
];

export const bakeryOrders = [
  { id: "BK-501", item: "Sourdough Bread", qty: 220, oven: "Oven-1", batch: "B-22", yield: "98%", status: "Baking" },
  { id: "BK-502", item: "Butter Croissant", qty: 480, oven: "Oven-3", batch: "B-23", yield: "96%", status: "Cooling" },
  { id: "BK-503", item: "Chocolate Muffin", qty: 320, oven: "Oven-2", batch: "B-24", yield: "99%", status: "Ready" },
  { id: "BK-504", item: "Vanilla Cake Slice", qty: 180, oven: "Oven-4", batch: "B-25", yield: "97%", status: "Pending" },
  { id: "BK-505", item: "Cheese Pastry", qty: 260, oven: "Oven-1", batch: "B-26", yield: "95%", status: "Baking" },
];

export const dispatch = [
  { id: "DSP-7701", flight: "BS-101", trays: 72, carts: 4, vehicle: "HiLoader-02", driver: "M. Karim", status: "Loaded" },
  { id: "DSP-7702", flight: "BS-203", trays: 176, carts: 9, vehicle: "HiLoader-05", driver: "R. Hossain", status: "En Route" },
  { id: "DSP-7703", flight: "BS-141", trays: 76, carts: 4, vehicle: "Van-11", driver: "S. Ahmed", status: "Delivered" },
  { id: "DSP-7704", flight: "BS-225", trays: 182, carts: 9, vehicle: "HiLoader-03", driver: "T. Rahman", status: "Preparing" },
];

export const qcChecks = [
  { id: "QC-3301", flight: "BS-203", batch: "PRD-9001", parameter: "Core Temperature", value: "74°C", limit: ">70°C", result: "Pass", inspector: "F. Begum" },
  { id: "QC-3302", flight: "BS-307", batch: "PRD-9003", parameter: "pH Level", value: "5.8", limit: "5.5-6.5", result: "Pass", inspector: "F. Begum" },
  { id: "QC-3303", flight: "BS-225", batch: "PRD-9006", parameter: "Visual Inspection", value: "Discoloration", limit: "Clean", result: "Fail", inspector: "A. Khan" },
  { id: "QC-3304", flight: "BS-101", batch: "PRD-9005", parameter: "Hygiene Audit", value: "98/100", limit: ">90", result: "Pass", inspector: "A. Khan" },
];

export const vendors = [
  { id: "V-001", name: "Fresh Farms Ltd", category: "Vegetables", rating: 4.7, orders: 142, onTime: "96%" },
  { id: "V-002", name: "Halal Meats Co.", category: "Protein", rating: 4.8, orders: 96, onTime: "98%" },
  { id: "V-003", name: "Aqua Pure BD", category: "Beverage", rating: 4.5, orders: 64, onTime: "94%" },
  { id: "V-004", name: "Spice World", category: "Spices", rating: 4.3, orders: 38, onTime: "89%" },
  { id: "V-005", name: "Royal Bakery Supplies", category: "Bakery", rating: 4.6, orders: 72, onTime: "92%" },
];

export const assets = [
  { id: "AS-101", name: "Convection Oven #1", type: "Oven", location: "Hot Kitchen", lastSvc: "2025-09-15", nextSvc: "2025-12-15", status: "Operational" },
  { id: "AS-102", name: "Walk-in Chiller A", type: "Chiller", location: "Cold Storage", lastSvc: "2025-10-01", nextSvc: "2026-01-01", status: "Operational" },
  { id: "AS-103", name: "Generator 250KVA", type: "Generator", location: "Utility", lastSvc: "2025-08-20", nextSvc: "2025-11-20", status: "Service Due" },
  { id: "AS-104", name: "HiLoader Truck #5", type: "Vehicle", location: "Dispatch", lastSvc: "2025-10-10", nextSvc: "2026-01-10", status: "Operational" },
  { id: "AS-105", name: "Blast Freezer", type: "Freezer", location: "Cold Storage", lastSvc: "2025-07-12", nextSvc: "2025-10-12", status: "Maintenance" },
];

export const visitors = [
  { id: "VIS-441", name: "Imran Hossain", company: "FDA Bangladesh", purpose: "Audit", entry: "09:14", exit: "12:30", badge: "V-09", status: "Exited" },
  { id: "VIS-442", name: "Shahin Akhter", company: "Fresh Farms Ltd", purpose: "Delivery", entry: "10:02", exit: "-", badge: "V-12", status: "Inside" },
  { id: "VIS-443", name: "Capt. R. Islam", company: "US-Bangla Ops", purpose: "Inspection", entry: "11:20", exit: "-", badge: "V-15", status: "Inside" },
];

export const recentUploads = [
  { id: "UP-2210", file: "manifest_2025-11-05.xlsx", rows: 124, valid: 122, errors: 2, by: "ops.user", at: "2025-11-05 06:12", status: "Imported" },
  { id: "UP-2209", file: "BS-307_passengers.csv", rows: 282, valid: 282, errors: 0, by: "ops.user", at: "2025-11-04 22:45", status: "Imported" },
  { id: "UP-2208", file: "weekly_manifest.xlsx", rows: 1840, valid: 1818, errors: 22, by: "ops.admin", at: "2025-11-04 09:30", status: "Partial" },
  { id: "UP-2207", file: "BS-141_special_meals.docx", rows: 18, valid: 0, errors: 18, by: "ops.user", at: "2025-11-03 14:10", status: "Failed" },
];

export const amenitiesMedicine = [
  { id: "AM-MED-01", item: "Paracetamol 500mg", brand: "Square", uom: "Strip", stock: 220, reorder: 100, status: "OK" },
  { id: "AM-MED-02", item: "Antacid Tablet", brand: "Beximco", uom: "Strip", stock: 180, reorder: 80, status: "OK" },
  { id: "AM-MED-03", item: "Motion Sickness Tab", brand: "ACI", uom: "Strip", stock: 64, reorder: 80, status: "Low" },
  { id: "AM-MED-04", item: "Adhesive Bandage", brand: "Hansaplast", uom: "Box", stock: 42, reorder: 30, status: "OK" },
  { id: "AM-MED-05", item: "Antiseptic Wipe", brand: "Savlon", uom: "Pack", stock: 18, reorder: 50, status: "Critical" },
  { id: "AM-MED-06", item: "ORS Sachet", brand: "SMC", uom: "Sachet", stock: 320, reorder: 200, status: "OK" },
];

export const amenitiesTissue = [
  { id: "AM-TIS-01", item: "Wet Hand Towel (Refresh)", uom: "Pcs", stock: 4800, reorder: 2000, status: "OK" },
  { id: "AM-TIS-02", item: "Facial Tissue 100s", uom: "Box", stock: 240, reorder: 150, status: "OK" },
  { id: "AM-TIS-03", item: "Dinner Napkin (B-class)", uom: "Pcs", stock: 1200, reorder: 1500, status: "Low" },
  { id: "AM-TIS-04", item: "Dinner Napkin (Y-class)", uom: "Pcs", stock: 6400, reorder: 3000, status: "OK" },
  { id: "AM-TIS-05", item: "Cocktail Napkin", uom: "Pcs", stock: 980, reorder: 1200, status: "Low" },
];

export const amenitiesCutlery = [
  { id: "AM-CUT-01", item: "Plastic Spoon (Heavy Duty)", uom: "Pcs", stock: 8400, reorder: 4000, status: "OK" },
  { id: "AM-CUT-02", item: "Plastic Fork", uom: "Pcs", stock: 7800, reorder: 4000, status: "OK" },
  { id: "AM-CUT-03", item: "Plastic Knife", uom: "Pcs", stock: 3600, reorder: 4000, status: "Low" },
  { id: "AM-CUT-04", item: "Wooden Stirrer", uom: "Pcs", stock: 12400, reorder: 5000, status: "OK" },
  { id: "AM-CUT-05", item: "Stainless Spoon (Business)", uom: "Pcs", stock: 480, reorder: 200, status: "OK" },
  { id: "AM-CUT-06", item: "Disposable Cup 180ml", uom: "Pcs", stock: 2100, reorder: 3000, status: "Critical" },
];

// ── Airline Consumables ────────────────────────────────────────────────────

export type ConsumableCategory =
  | "Napkin" | "Cup" | "Cutlery" | "Tissue" | "Amenity Kit"
  | "Plastic Tray" | "Packaging";

export type ConsumableItem = {
  id: string;
  name: string;
  category: ConsumableCategory;
  uom: string;
  stock: number;
  reorder: number;
  unitCost: number;
  binLocation?: string;
  status: "OK" | "Low" | "Critical";
};

export const consumableItems: ConsumableItem[] = [
  { id: "CNS-001", name: "Dinner Napkin (Y-class)",          category: "Napkin",      uom: "Pcs",  stock: 6400, reorder: 3000, unitCost: 0.6,  binLocation: "A1-R1-S1", status: "OK" },
  { id: "CNS-002", name: "Dinner Napkin (B-class)",          category: "Napkin",      uom: "Pcs",  stock: 1200, reorder: 1500, unitCost: 0.9,  binLocation: "A1-R1-S2", status: "Low" },
  { id: "CNS-003", name: "Cocktail Napkin",                  category: "Napkin",      uom: "Pcs",  stock: 980,  reorder: 1200, unitCost: 0.4,  binLocation: "A1-R1-S3", status: "Low" },
  { id: "CNS-004", name: "Disposable Cup 180ml",             category: "Cup",         uom: "Pcs",  stock: 2100, reorder: 3000, unitCost: 1.2,  binLocation: "A2-R1-S1", status: "Critical" },
  { id: "CNS-005", name: "Hot Beverage Cup 220ml (Lid)",     category: "Cup",         uom: "Pcs",  stock: 5400, reorder: 2500, unitCost: 1.8,  binLocation: "A2-R1-S2", status: "OK" },
  { id: "CNS-006", name: "Plastic Spoon (Heavy Duty)",       category: "Cutlery",     uom: "Pcs",  stock: 8400, reorder: 4000, unitCost: 0.7,  binLocation: "A3-R1-S1", status: "OK" },
  { id: "CNS-007", name: "Plastic Fork",                     category: "Cutlery",     uom: "Pcs",  stock: 7800, reorder: 4000, unitCost: 0.7,  binLocation: "A3-R1-S2", status: "OK" },
  { id: "CNS-008", name: "Plastic Knife",                    category: "Cutlery",     uom: "Pcs",  stock: 3600, reorder: 4000, unitCost: 0.7,  binLocation: "A3-R1-S3", status: "Low" },
  { id: "CNS-009", name: "Wooden Stirrer",                   category: "Cutlery",     uom: "Pcs",  stock: 12400,reorder: 5000, unitCost: 0.2,  binLocation: "A3-R1-S4", status: "OK" },
  { id: "CNS-010", name: "Wet Hand Towel (Refresh)",         category: "Tissue",      uom: "Pcs",  stock: 4800, reorder: 2000, unitCost: 1.5,  binLocation: "A4-R1-S1", status: "OK" },
  { id: "CNS-011", name: "Facial Tissue 100s",               category: "Tissue",      uom: "Box",  stock: 240,  reorder: 150,  unitCost: 22,   binLocation: "A4-R1-S2", status: "OK" },
  { id: "CNS-012", name: "Y-Class Amenity Kit (Short Haul)", category: "Amenity Kit", uom: "Kit",  stock: 320,  reorder: 250,  unitCost: 28,   binLocation: "A5-R1-S1", status: "OK" },
  { id: "CNS-013", name: "B-Class Amenity Kit (Long Haul)",  category: "Amenity Kit", uom: "Kit",  stock: 84,   reorder: 100,  unitCost: 145,  binLocation: "A5-R1-S2", status: "Low" },
  { id: "CNS-014", name: "Casserole Plastic Tray (Hot)",     category: "Plastic Tray",uom: "Pcs",  stock: 1600, reorder: 1000, unitCost: 4.5,  binLocation: "A6-R1-S1", status: "OK" },
  { id: "CNS-015", name: "Cold Meal Tray (PET)",             category: "Plastic Tray",uom: "Pcs",  stock: 920,  reorder: 800,  unitCost: 3.8,  binLocation: "A6-R1-S2", status: "OK" },
  { id: "CNS-016", name: "Meal Box (Foil Lid)",              category: "Packaging",   uom: "Pcs",  stock: 2600, reorder: 2000, unitCost: 6.5,  binLocation: "A7-R1-S1", status: "OK" },
  { id: "CNS-017", name: "Aluminum Foil Sheet",              category: "Packaging",   uom: "Pcs",  stock: 1800, reorder: 1500, unitCost: 0.9,  binLocation: "A7-R1-S2", status: "OK" },
];

export type ConsumableUsage = {
  id: string;
  date: string;
  flight: string;
  sector: string;
  cabinClass: "Y" | "B" | "F";
  itemId: string;
  itemName: string;
  qty: number;
  uom: string;
};

export const consumableUsage: ConsumableUsage[] = [
  { id: "CU-9001", date: "2026-05-20", flight: "BG-401", sector: "DAC→DXB", cabinClass: "Y", itemId: "CNS-001", itemName: "Dinner Napkin (Y-class)", qty: 186, uom: "Pcs" },
  { id: "CU-9002", date: "2026-05-20", flight: "BG-401", sector: "DAC→DXB", cabinClass: "Y", itemId: "CNS-006", itemName: "Plastic Spoon (Heavy Duty)", qty: 186, uom: "Pcs" },
  { id: "CU-9003", date: "2026-05-20", flight: "BG-401", sector: "DAC→DXB", cabinClass: "B", itemId: "CNS-013", itemName: "B-Class Amenity Kit (Long Haul)", qty: 28, uom: "Kit" },
  { id: "CU-9004", date: "2026-05-20", flight: "BG-522", sector: "DAC→LHR", cabinClass: "Y", itemId: "CNS-016", itemName: "Meal Box (Foil Lid)", qty: 214, uom: "Pcs" },
  { id: "CU-9005", date: "2026-05-20", flight: "BG-522", sector: "DAC→LHR", cabinClass: "B", itemId: "CNS-005", itemName: "Hot Beverage Cup 220ml (Lid)", qty: 64, uom: "Pcs" },
  { id: "CU-9006", date: "2026-05-19", flight: "VQ-901", sector: "DAC→KUL", cabinClass: "Y", itemId: "CNS-010", itemName: "Wet Hand Towel (Refresh)", qty: 162, uom: "Pcs" },
  { id: "CU-9007", date: "2026-05-19", flight: "BS-141", sector: "DAC→CGP", cabinClass: "Y", itemId: "CNS-009", itemName: "Wooden Stirrer", qty: 68, uom: "Pcs" },
  { id: "CU-9008", date: "2026-05-19", flight: "BS-105", sector: "DAC→CXB", cabinClass: "Y", itemId: "CNS-014", itemName: "Casserole Plastic Tray (Hot)", qty: 72, uom: "Pcs" },
];

// ── Airline Equipments ─────────────────────────────────────────────────────

export type EquipmentCategory =
  | "Trolley" | "Oven Rack" | "Container" | "Tray" | "Galley Insert" | "Hot Box";

export type EquipmentAsset = {
  id: string;
  name: string;
  category: EquipmentCategory;
  serialNo: string;
  rfidTag?: string;
  location: string;
  lastMaintenance: string;
  nextMaintenance: string;
  status: "In Service" | "In Maintenance" | "Damaged" | "Retired";
};

export const equipmentAssets: EquipmentAsset[] = [
  { id: "EQP-T-001", name: "Full Size Meal Trolley",  category: "Trolley",       serialNo: "TR-001",  rfidTag: "RF-TR0001", location: "BG-401",        lastMaintenance: "2026-03-10", nextMaintenance: "2026-09-10", status: "In Service" },
  { id: "EQP-T-002", name: "Half Size Bar Trolley",   category: "Trolley",       serialNo: "TR-002",  rfidTag: "RF-TR0002", location: "BG-522",        lastMaintenance: "2026-02-22", nextMaintenance: "2026-08-22", status: "In Service" },
  { id: "EQP-T-003", name: "Full Size Meal Trolley",  category: "Trolley",       serialNo: "TR-003",  rfidTag: "RF-TR0003", location: "Hot Kitchen",   lastMaintenance: "2026-01-15", nextMaintenance: "2026-07-15", status: "In Maintenance" },
  { id: "EQP-O-001", name: "Standard Oven Rack",      category: "Oven Rack",     serialNo: "OR-101",  rfidTag: "RF-OR0101", location: "Hot Kitchen",   lastMaintenance: "2026-04-05", nextMaintenance: "2026-10-05", status: "In Service" },
  { id: "EQP-O-002", name: "Standard Oven Rack",      category: "Oven Rack",     serialNo: "OR-102",  rfidTag: "RF-OR0102", location: "BG-401",        lastMaintenance: "2026-04-05", nextMaintenance: "2026-10-05", status: "In Service" },
  { id: "EQP-O-003", name: "Wide Oven Rack",          category: "Oven Rack",     serialNo: "OR-201",  rfidTag: "RF-OR0201", location: "Damaged Pool",  lastMaintenance: "2025-12-01", nextMaintenance: "2026-06-01", status: "Damaged" },
  { id: "EQP-C-001", name: "Meal Tray Container",     category: "Container",     serialNo: "CN-301",  rfidTag: "RF-CN0301", location: "BG-522",        lastMaintenance: "2026-03-18", nextMaintenance: "2026-09-18", status: "In Service" },
  { id: "EQP-C-002", name: "Insulated Beverage Box",  category: "Hot Box",       serialNo: "HB-401",  rfidTag: "RF-HB0401", location: "BG-401",        lastMaintenance: "2026-02-28", nextMaintenance: "2026-08-28", status: "In Service" },
  { id: "EQP-G-001", name: "Galley Insert (Half)",    category: "Galley Insert", serialNo: "GI-501",  rfidTag: "RF-GI0501", location: "Hot Kitchen",   lastMaintenance: "2026-04-12", nextMaintenance: "2026-10-12", status: "In Service" },
  { id: "EQP-TR-01", name: "Cabin Service Tray",      category: "Tray",          serialNo: "CT-601",  rfidTag: "RF-CT0601", location: "Cold Kitchen",  lastMaintenance: "2026-04-20", nextMaintenance: "2026-10-20", status: "In Service" },
];

export type EquipmentReturn = {
  id: string;
  date: string;
  flight: string;
  assetId: string;
  assetName: string;
  returnedBy: string;
  condition: "Good" | "Minor Issue" | "Damaged";
  remarks?: string;
};

export const equipmentReturns: EquipmentReturn[] = [
  { id: "ER-7001", date: "2026-05-20 18:40", flight: "BG-402", assetId: "EQP-T-001", assetName: "Full Size Meal Trolley", returnedBy: "T. Rahman", condition: "Good" },
  { id: "ER-7002", date: "2026-05-20 18:42", flight: "BG-402", assetId: "EQP-O-002", assetName: "Standard Oven Rack",     returnedBy: "T. Rahman", condition: "Good" },
  { id: "ER-7003", date: "2026-05-20 22:10", flight: "VQ-903", assetId: "EQP-C-001", assetName: "Meal Tray Container",    returnedBy: "S. Ahmed",  condition: "Minor Issue", remarks: "Latch loose" },
  { id: "ER-7004", date: "2026-05-19 09:30", flight: "BS-142", assetId: "EQP-TR-01", assetName: "Cabin Service Tray",     returnedBy: "M. Karim",  condition: "Good" },
  { id: "ER-7005", date: "2026-05-18 23:55", flight: "BG-522", assetId: "EQP-O-003", assetName: "Wide Oven Rack",         returnedBy: "T. Rahman", condition: "Damaged",     remarks: "Bent shelf — sent to repair" },
];

export type DamageReport = {
  id: string;
  date: string;
  assetId: string;
  assetName: string;
  severity: "Minor" | "Moderate" | "Severe";
  reportedBy: string;
  description: string;
  status: "Open" | "Under Repair" | "Repaired" | "Written Off";
};

export const damageReports: DamageReport[] = [
  { id: "DR-2201", date: "2026-05-18", assetId: "EQP-O-003", assetName: "Wide Oven Rack",         severity: "Severe",   reportedBy: "T. Rahman", description: "Shelf bent during turbulence; cannot hold trays.", status: "Under Repair" },
  { id: "DR-2202", date: "2026-05-17", assetId: "EQP-C-001", assetName: "Meal Tray Container",    severity: "Minor",    reportedBy: "S. Ahmed",  description: "Latch loose, needs adjustment.",                  status: "Open" },
  { id: "DR-2203", date: "2026-05-12", assetId: "EQP-T-003", assetName: "Full Size Meal Trolley", severity: "Moderate", reportedBy: "M. Karim",  description: "Wheel wobble; brake mechanism stiff.",            status: "Under Repair" },
  { id: "DR-2204", date: "2026-05-05", assetId: "EQP-G-001", assetName: "Galley Insert (Half)",   severity: "Minor",    reportedBy: "F. Begum",  description: "Surface scratched — cosmetic only.",              status: "Repaired" },
];

export const receiveItems = [
  { id: "GRN-5501", po: "PO-2025-0450", vendor: "Halal Meats Co.", item: "Chicken Breast", qty: 120, uom: "Kg", temp: "3°C", expiry: "2025-11-18", receivedBy: "M. Karim", status: "Accepted" },
  { id: "GRN-5502", po: "PO-2025-0449", vendor: "Aqua Pure BD", item: "Mineral Water 250ml", qty: 2400, uom: "Bottle", temp: "Ambient", expiry: "2027-06-01", receivedBy: "M. Karim", status: "Accepted" },
  { id: "GRN-5503", po: "PO-2025-0451", vendor: "Fresh Farms Ltd", item: "Tomato", qty: 80, uom: "Kg", temp: "8°C", expiry: "2025-11-12", receivedBy: "S. Ahmed", status: "On Hold" },
  { id: "GRN-5504", po: "PO-2025-0448", vendor: "Spice World", item: "Cumin Powder", qty: 22, uom: "Kg", temp: "Ambient", expiry: "2026-08-30", receivedBy: "S. Ahmed", status: "Accepted" },
  { id: "GRN-5505", po: "PO-2025-0451", vendor: "Fresh Farms Ltd", item: "Lettuce", qty: 35, uom: "Kg", temp: "12°C", expiry: "2025-11-08", receivedBy: "F. Begum", status: "Rejected" },
  { id: "GRN-5506", po: "PO-2025-0447", vendor: "Dhaka Dairy", item: "Butter Salted", qty: 30, uom: "Kg", temp: "4°C", expiry: "2025-12-20", receivedBy: "F. Begum", status: "Accepted" },
];

export const cookingTempLogs = [
  { id: "CT-8801", batch: "PRD-9001", item: "Chicken Biryani", cookingTime: "45 min", standardTemp: "≥75°C", standardTempMin: 75, measuredTemp: 78, cookedBy: "Chef R. Karim", sensoryPass: true, checkedBy: "F. Begum" },
  { id: "CT-8802", batch: "PRD-9002", item: "Veg Pulao", cookingTime: "30 min", standardTemp: "≥70°C", standardTempMin: 70, measuredTemp: 73, cookedBy: "Chef N. Hasan", sensoryPass: true, checkedBy: "F. Begum" },
  { id: "CT-8803", batch: "PRD-9003", item: "Grilled Salmon", cookingTime: "18 min", standardTemp: "≥63°C", standardTempMin: 63, measuredTemp: 68, cookedBy: "Chef A. Rahim", sensoryPass: true, checkedBy: "A. Khan" },
  { id: "CT-8804", batch: "PRD-9004", item: "Continental Breakfast", cookingTime: "12 min", standardTemp: "≥65°C", standardTempMin: 65, measuredTemp: 60, cookedBy: "Chef T. Hossain", sensoryPass: false, checkedBy: "A. Khan" },
  { id: "CT-8805", batch: "PRD-9005", item: "Hindu Meal Special", cookingTime: "40 min", standardTemp: "≥75°C", standardTempMin: 75, measuredTemp: 76, cookedBy: "Chef S. Mahmud", sensoryPass: true, checkedBy: "F. Begum" },
  { id: "CT-8806", batch: "PRD-9006", item: "Heavy Snack Box", cookingTime: "20 min", standardTemp: "≥70°C", standardTempMin: 70, measuredTemp: 72, cookedBy: "Chef N. Hasan", sensoryPass: true, checkedBy: "A. Khan" },
];

export type BomProductionItem = {
  item: string;
  itemType: string;
  netWeight: number;
  quantity: number;
  costPct: number;
};

export type BomInputMaterial = {
  material: string;
  type: string;
  excludeScrap: "Yes" | "No";
  altQty: number;
  altUom?: string;
  quantity: number;
  uom: string;
  wastagePct: number;
  totalQty: number;
  avgRate: number;
  total: number;
};

export type BillOfMaterial = {
  id: string;
  name: string;
  components: number;
  version: string;
  yield: string;
  lastUpdated: string;
  status: string;
  date: string;
  itemCode: string;
  itemName: string;
  category: string;
  section: string;
  uom: string;
  altUom?: string;
  lotSize: number;
  bomValue: number;
  createdBy: string;
  bomType: "Single Output" | "Multi Output";
  productionItems: BomProductionItem[];
  inputMaterials: BomInputMaterial[];
  officeId?: string;
  warehouseId?: string;
};

const _billOfMaterialsRaw: BillOfMaterial[] = [
  {
    id: "BOM-001", name: "Chicken Biryani", components: 9, version: "v3.2",
    yield: "100 portions", lastUpdated: "2025-10-22", status: "Active",
    date: "2026-05-20", itemCode: "FG-27041", itemName: "Chicken Biryani",
    category: "Hot Kitchen", section: "Main Course", uom: "PCS", altUom: "",
    lotSize: 1, bomValue: 40.00, createdBy: "JT Jahid Hossain",
    bomType: "Single Output",
    productionItems: [
      { item: "FG-27041 - Chicken Biryani (PCS)", itemType: "Finished/Trading Goods", netWeight: 0, quantity: 1, costPct: 100 },
    ],
    inputMaterials: [
      { material: "RM-27042 - Basmati Rice (KG)", type: "Raw Material", excludeScrap: "No", altQty: 0, quantity: 2, uom: "KG", wastagePct: 0, totalQty: 2, avgRate: 10, total: 20 },
      { material: "RM-27043 - Chicken (KG)",      type: "Raw Material", excludeScrap: "No", altQty: 0, quantity: 1, uom: "KG", wastagePct: 0, totalQty: 1, avgRate: 20, total: 20 },
    ],
  },
  {
    id: "BOM-002", name: "Veg Pulao", components: 7, version: "v2.1",
    yield: "100 portions", lastUpdated: "2025-09-15", status: "Active",
    date: "2026-05-10", itemCode: "FG-27036", itemName: "Veg Pulao",
    category: "Hot Kitchen", section: "Main Course", uom: "pieces", altUom: "",
    lotSize: 1, bomValue: 21.50, createdBy: "Omor Siam",
    bomType: "Single Output",
    productionItems: [
      { item: "FG-27036 - Veg Pulao (pieces)", itemType: "Finished/Trading Goods", netWeight: 0, quantity: 1, costPct: 100 },
    ],
    inputMaterials: [
      { material: "RM-27044 - Rice (KG)",  type: "Raw Material", excludeScrap: "No", altQty: 0, quantity: 1.5, uom: "KG", wastagePct: 0,  totalQty: 1.5, avgRate: 9,  total: 13.50 },
      { material: "RM-27045 - Mixed Veg (KG)", type: "Raw Material", excludeScrap: "No", altQty: 0, quantity: 0.8, uom: "KG", wastagePct: 0, totalQty: 0.8, avgRate: 10, total: 8.00 },
    ],
  },
  {
    id: "BOM-003", name: "Continental Breakfast", components: 11, version: "v1.4",
    yield: "Set", lastUpdated: "2025-10-30", status: "Active",
    date: "2026-05-10", itemCode: "FG-27037", itemName: "Continental Breakfast",
    category: "Cold Kitchen", section: "Breakfast", uom: "pieces", altUom: "",
    lotSize: 1, bomValue: 82.18, createdBy: "Munna Idris",
    bomType: "Single Output",
    productionItems: [
      { item: "FG-27037 - Continental Breakfast (pieces)", itemType: "Finished/Trading Goods", netWeight: 0, quantity: 1, costPct: 100 },
    ],
    inputMaterials: [
      { material: "RM-27050 - Bread (PCS)",   type: "Raw Material", excludeScrap: "No",  altQty: 0, quantity: 2, uom: "PCS", wastagePct: 0, totalQty: 2, avgRate: 5,  total: 10.00 },
      { material: "RM-27051 - Butter (KG)",   type: "Raw Material", excludeScrap: "No",  altQty: 0, quantity: 0.05, uom: "KG", wastagePct: 0, totalQty: 0.05, avgRate: 950, total: 47.50 },
      { material: "RM-27052 - Jam (KG)",      type: "Raw Material", excludeScrap: "Yes", altQty: 0, quantity: 0.03, uom: "KG", wastagePct: 0, totalQty: 0.03, avgRate: 820, total: 24.68 },
    ],
  },
  {
    id: "BOM-004", name: "Grilled Salmon", components: 8, version: "v1.0",
    yield: "100 portions", lastUpdated: "2025-11-01", status: "Draft",
    date: "2026-04-30", itemCode: "FG-27021", itemName: "Grilled Salmon",
    category: "Hot Kitchen", section: "Main Course", uom: "pieces", altUom: "",
    lotSize: 1, bomValue: 246.80, createdBy: "Abul Hossain Raju",
    bomType: "Single Output",
    productionItems: [
      { item: "FG-27021 - Grilled Salmon (pieces)", itemType: "Finished/Trading Goods", netWeight: 0, quantity: 1, costPct: 100 },
    ],
    inputMaterials: [
      { material: "RM-27060 - Salmon Fillet (KG)", type: "Raw Material", excludeScrap: "No", altQty: 0, quantity: 0.15, uom: "KG", wastagePct: 5, totalQty: 0.1575, avgRate: 1400, total: 220.50 },
      { material: "RM-27061 - Olive Oil (Litre)",   type: "Raw Material", excludeScrap: "No", altQty: 0, quantity: 0.02, uom: "Litre", wastagePct: 0, totalQty: 0.02, avgRate: 850, total: 17.00 },
      { material: "RM-27062 - Lemon (KG)",          type: "Raw Material", excludeScrap: "Yes", altQty: 0, quantity: 0.05, uom: "KG", wastagePct: 0, totalQty: 0.05, avgRate: 186, total: 9.30 },
    ],
  },
  {
    id: "BOM-005", name: "Hindu Meal Special", components: 10, version: "v2.0",
    yield: "50 portions", lastUpdated: "2025-10-12", status: "Active",
    date: "2026-04-23", itemCode: "FG-1010", itemName: "Hindu Meal Special",
    category: "Special Meal", section: "Religious", uom: "Packet", altUom: "",
    lotSize: 10, bomValue: 285.00, createdBy: "Sujon Khan",
    bomType: "Single Output",
    productionItems: [
      { item: "FG-1010 - Hindu Meal Special (Packet)", itemType: "Finished/Trading Goods", netWeight: 0, quantity: 10, costPct: 100 },
    ],
    inputMaterials: [
      { material: "RM-27070 - Paneer (KG)",     type: "Raw Material", excludeScrap: "No",  altQty: 0, quantity: 1,   uom: "KG", wastagePct: 0, totalQty: 1,   avgRate: 180, total: 180.00 },
      { material: "RM-27071 - Mixed Veg (KG)",  type: "Raw Material", excludeScrap: "No",  altQty: 0, quantity: 0.8, uom: "KG", wastagePct: 0, totalQty: 0.8, avgRate: 90,  total: 72.00 },
      { material: "RM-27072 - Spice Mix (KG)",  type: "Raw Material", excludeScrap: "Yes", altQty: 0, quantity: 0.1, uom: "KG", wastagePct: 0, totalQty: 0.1, avgRate: 330, total: 33.00 },
    ],
  },
  {
    id: "BOM-006", name: "Crew Combo Meal", components: 6, version: "v1.2",
    yield: "Set", lastUpdated: "2025-08-28", status: "Active",
    date: "2026-04-21", itemCode: "FG-27013", itemName: "Crew Combo Meal",
    category: "Hot Kitchen", section: "Crew", uom: "PCS", altUom: "",
    lotSize: 1, bomValue: 28.37, createdBy: "Tamim Ehsan",
    bomType: "Single Output",
    productionItems: [
      { item: "FG-27013 - Crew Combo Meal (PCS)", itemType: "Finished/Trading Goods", netWeight: 0, quantity: 1, costPct: 100 },
    ],
    inputMaterials: [
      { material: "RM-27080 - Rice (KG)",      type: "Raw Material", excludeScrap: "No", altQty: 0, quantity: 0.4, uom: "KG", wastagePct: 0, totalQty: 0.4, avgRate: 12, total: 4.80 },
      { material: "RM-27081 - Chicken (KG)",   type: "Raw Material", excludeScrap: "No", altQty: 0, quantity: 0.15, uom: "KG", wastagePct: 0, totalQty: 0.15, avgRate: 90, total: 13.50 },
      { material: "RM-27082 - Vegetables (KG)",type: "Raw Material", excludeScrap: "No", altQty: 0, quantity: 0.2, uom: "KG", wastagePct: 0, totalQty: 0.2, avgRate: 50, total: 10.07 },
    ],
  },
  {
    id: "BOM-007", name: "Mum 250 ml water", components: 1, version: "v1.0",
    yield: "1 PCS", lastUpdated: "2026-04-21", status: "Active",
    date: "2026-04-21", itemCode: "FG-27013", itemName: "Mum 250 ml water",
    category: "Beverage", section: "Water", uom: "PCS", altUom: "",
    lotSize: 1, bomValue: 28.37, createdBy: "Fahim Shahriar Rifat",
    bomType: "Single Output",
    productionItems: [
      { item: "FG-27013 - Mum 250 ml water (PCS)", itemType: "Finished/Trading Goods", netWeight: 0, quantity: 1, costPct: 100 },
    ],
    inputMaterials: [
      { material: "RM-27090 - Bottle 250ml (PCS)", type: "Packaging", excludeScrap: "No", altQty: 0, quantity: 1, uom: "PCS", wastagePct: 0, totalQty: 1, avgRate: 18, total: 18.00 },
      { material: "RM-27091 - Cap (PCS)",          type: "Packaging", excludeScrap: "No", altQty: 0, quantity: 1, uom: "PCS", wastagePct: 0, totalQty: 1, avgRate: 4,  total: 4.00 },
      { material: "RM-27092 - Label (PCS)",        type: "Packaging", excludeScrap: "No", altQty: 0, quantity: 1, uom: "PCS", wastagePct: 0, totalQty: 1, avgRate: 6.37, total: 6.37 },
    ],
  },
  {
    id: "BOM-008", name: "10w40 Lubricant", components: 1, version: "v1.0",
    yield: "1 Litre", lastUpdated: "2026-04-21", status: "Active",
    date: "2026-04-21", itemCode: "343", itemName: "Lubricant",
    category: "Maintenance", section: "Workshop", uom: "Liter", altUom: "",
    lotSize: 1, bomValue: 2311.30, createdBy: "AL Mamun",
    bomType: "Single Output",
    productionItems: [
      { item: "343 - Lubricant (Liter)", itemType: "Finished/Trading Goods", netWeight: 0, quantity: 1, costPct: 100 },
    ],
    inputMaterials: [
      { material: "RM-2701 - Base Oil (Litre)",  type: "Raw Material", excludeScrap: "No", altQty: 0, quantity: 0.95, uom: "Litre", wastagePct: 0, totalQty: 0.95, avgRate: 2400, total: 2280.00 },
      { material: "RM-2702 - Additives (Litre)", type: "Raw Material", excludeScrap: "No", altQty: 0, quantity: 0.05, uom: "Litre", wastagePct: 0, totalQty: 0.05, avgRate: 626, total: 31.30 },
    ],
  },
  ...buildMealPlanBoms(),
];

// ── Meal-plan BOMs ──────────────────────────────────────────────────────────
// Helper-generated recipes for every meal-plan item that appears in
// `meal-planning-data.ts`. Without these, "Create All Orders" from the
// Production Order page would create empty production orders with no
// materials computed and no Demand Request raised. Each recipe lists
// realistic raw + packaging components in catering-realistic quantities so
// MRP, demand requests, and FEFO allocation flows can all light up.

type MealBomSpec = {
  name: string;
  category: string;
  section: string;
  unitCost: number;
  yieldPortions: number;
  materials: Array<{
    code: string;
    name: string;
    qty: number;
    uom: string;
    rate: number;
    type?: "Raw Material" | "Packaging" | "Other";
  }>;
};

function buildMealPlanBoms(): BillOfMaterial[] {
  // Shared packaging stub — every catered meal item gets a meal-box tray so
  // the Demand Request includes packaging shortfalls as well as raw inputs.
  const PKG = {
    code: "PKG-2710", name: "Meal Box (Foil/Paper)",
    qty: 1, uom: "PCS", rate: 12, type: "Packaging" as const,
  };

  const specs: MealBomSpec[] = [
    // ── Rice / grain main courses ──
    { name: "Plain Polao", category: "Hot Kitchen", section: "Main Course", unitCost: 38, yieldPortions: 1, materials: [
      { code: "RM-2701-RICE",  name: "Polao Rice",     qty: 0.18, uom: "KG", rate: 95 },
      { code: "RM-2710-GHEE",  name: "Ghee",           qty: 0.01, uom: "KG", rate: 1100 },
      PKG,
    ]},
    { name: "Saffron Rice", category: "Hot Kitchen", section: "Main Course", unitCost: 42, yieldPortions: 1, materials: [
      { code: "RM-2701-RICE",  name: "Polao Rice",     qty: 0.17, uom: "KG", rate: 95 },
      { code: "RM-2720-SAFF",  name: "Saffron",        qty: 0.0002, uom: "KG", rate: 12000 },
      PKG,
    ]},
    { name: "Jeera Polao", category: "Hot Kitchen", section: "Main Course", unitCost: 39, yieldPortions: 1, materials: [
      { code: "RM-2701-RICE",  name: "Polao Rice",     qty: 0.18, uom: "KG", rate: 95 },
      { code: "RM-2721-JEERA", name: "Cumin Seed",     qty: 0.003, uom: "KG", rate: 800 },
      PKG,
    ]},
    { name: "Steamed Rice", category: "Hot Kitchen", section: "Main Course", unitCost: 26, yieldPortions: 1, materials: [
      { code: "RM-2702-PRICE", name: "Plain Rice",     qty: 0.18, uom: "KG", rate: 75 },
      PKG,
    ]},
    { name: "Boiled Rice", category: "Hot Kitchen", section: "Main Course", unitCost: 24, yieldPortions: 1, materials: [
      { code: "RM-2702-PRICE", name: "Plain Rice",     qty: 0.18, uom: "KG", rate: 70 },
      PKG,
    ]},
    { name: "Plain Rice", category: "Hot Kitchen", section: "Main Course", unitCost: 24, yieldPortions: 1, materials: [
      { code: "RM-2702-PRICE", name: "Plain Rice",     qty: 0.18, uom: "KG", rate: 70 },
      PKG,
    ]},
    { name: "Vegetable Biryani", category: "Hot Kitchen", section: "Main Course", unitCost: 64, yieldPortions: 1, materials: [
      { code: "RM-2701-RICE",  name: "Polao Rice",     qty: 0.20, uom: "KG", rate: 95 },
      { code: "RM-2730-MIXV",  name: "Mixed Vegetables", qty: 0.10, uom: "KG", rate: 65 },
      { code: "RM-2731-SPICE", name: "Biryani Spice Mix", qty: 0.008, uom: "KG", rate: 380 },
      PKG,
    ]},
    { name: "Chicken Khichuri", category: "Hot Kitchen", section: "Main Course", unitCost: 72, yieldPortions: 1, materials: [
      { code: "RM-2702-PRICE", name: "Plain Rice",     qty: 0.15, uom: "KG", rate: 70 },
      { code: "RM-2740-MOOG",  name: "Moog Dal",       qty: 0.05, uom: "KG", rate: 140 },
      { code: "RM-2750-CHKN",  name: "Chicken",        qty: 0.08, uom: "KG", rate: 280 },
      PKG,
    ]},

    // ── Bread / wraps ──
    { name: "Roti", category: "Hot Kitchen", section: "Bread", unitCost: 14, yieldPortions: 1, materials: [
      { code: "RM-2760-FLOUR", name: "Wheat Flour",    qty: 0.06, uom: "KG", rate: 65 },
      { code: "RM-2761-OIL",   name: "Cooking Oil",    qty: 0.003, uom: "Litre", rate: 180 },
      PKG,
    ]},
    { name: "Garlic Naan", category: "Hot Kitchen", section: "Bread", unitCost: 22, yieldPortions: 1, materials: [
      { code: "RM-2762-NAAN",  name: "Naan Flour",     qty: 0.07, uom: "KG", rate: 90 },
      { code: "RM-2763-GARLC", name: "Garlic Paste",   qty: 0.005, uom: "KG", rate: 180 },
      PKG,
    ]},
    { name: "Kulcha", category: "Hot Kitchen", section: "Bread", unitCost: 20, yieldPortions: 1, materials: [
      { code: "RM-2762-NAAN",  name: "Naan Flour",     qty: 0.07, uom: "KG", rate: 90 },
      { code: "RM-2764-DAIRY", name: "Yoghurt",        qty: 0.02, uom: "KG", rate: 110 },
      PKG,
    ]},
    { name: "Paratha", category: "Hot Kitchen", section: "Bread", unitCost: 18, yieldPortions: 1, materials: [
      { code: "RM-2760-FLOUR", name: "Wheat Flour",    qty: 0.07, uom: "KG", rate: 65 },
      { code: "RM-2761-OIL",   name: "Cooking Oil",    qty: 0.008, uom: "Litre", rate: 180 },
      PKG,
    ]},
    { name: "Roll Sandwich with Chicken & Cheese", category: "Cold Kitchen", section: "Sandwich", unitCost: 95, yieldPortions: 1, materials: [
      { code: "RM-2770-WRAP",  name: "Wrap Bread",     qty: 1, uom: "PCS", rate: 24 },
      { code: "RM-2750-CHKN",  name: "Chicken",        qty: 0.07, uom: "KG", rate: 280 },
      { code: "RM-2771-CHEES", name: "Cheese Slice",   qty: 1, uom: "PCS", rate: 18 },
      PKG,
    ]},
    { name: "Vegetable Sandwich", category: "Cold Kitchen", section: "Sandwich", unitCost: 52, yieldPortions: 1, materials: [
      { code: "RM-2772-BREAD", name: "Sandwich Bread", qty: 2, uom: "PCS", rate: 8 },
      { code: "RM-2773-VEGFL", name: "Veg Filling",    qty: 0.08, uom: "KG", rate: 220 },
      { code: "RM-2774-BUTTR", name: "Butter",         qty: 0.005, uom: "KG", rate: 950 },
      PKG,
    ]},
    { name: "Veg Frankie", category: "Cold Kitchen", section: "Sandwich", unitCost: 48, yieldPortions: 1, materials: [
      { code: "RM-2770-WRAP",  name: "Wrap Bread",     qty: 1, uom: "PCS", rate: 24 },
      { code: "RM-2773-VEGFL", name: "Veg Filling",    qty: 0.06, uom: "KG", rate: 220 },
      PKG,
    ]},

    // ── Meat dishes ──
    { name: "Beef Rezala", category: "Hot Kitchen", section: "Main Course", unitCost: 165, yieldPortions: 1, materials: [
      { code: "RM-2780-BEEF",  name: "Beef",           qty: 0.10, uom: "KG", rate: 680 },
      { code: "RM-2731-SPICE", name: "Biryani Spice Mix", qty: 0.005, uom: "KG", rate: 380 },
      { code: "RM-2764-DAIRY", name: "Yoghurt",        qty: 0.02, uom: "KG", rate: 110 },
      PKG,
    ]},
    { name: "Mutton Rezala", category: "Hot Kitchen", section: "Main Course", unitCost: 215, yieldPortions: 1, materials: [
      { code: "RM-2781-MUTTN", name: "Mutton",         qty: 0.11, uom: "KG", rate: 820 },
      { code: "RM-2731-SPICE", name: "Biryani Spice Mix", qty: 0.005, uom: "KG", rate: 380 },
      { code: "RM-2764-DAIRY", name: "Yoghurt",        qty: 0.02, uom: "KG", rate: 110 },
      PKG,
    ]},
    { name: "Chicken Masala", category: "Hot Kitchen", section: "Main Course", unitCost: 95, yieldPortions: 1, materials: [
      { code: "RM-2750-CHKN",  name: "Chicken",        qty: 0.10, uom: "KG", rate: 280 },
      { code: "RM-2790-MASLA", name: "Masala Mix",     qty: 0.008, uom: "KG", rate: 350 },
      PKG,
    ]},
    { name: "Chicken Dopiaza", category: "Hot Kitchen", section: "Main Course", unitCost: 92, yieldPortions: 1, materials: [
      { code: "RM-2750-CHKN",  name: "Chicken",        qty: 0.10, uom: "KG", rate: 280 },
      { code: "RM-2791-ONION", name: "Onion",          qty: 0.06, uom: "KG", rate: 80 },
      PKG,
    ]},
    { name: "Chicken Korma", category: "Hot Kitchen", section: "Main Course", unitCost: 105, yieldPortions: 1, materials: [
      { code: "RM-2750-CHKN",  name: "Chicken",        qty: 0.10, uom: "KG", rate: 280 },
      { code: "RM-2792-CASHW", name: "Cashew Paste",   qty: 0.01, uom: "KG", rate: 1400 },
      { code: "RM-2764-DAIRY", name: "Yoghurt",        qty: 0.02, uom: "KG", rate: 110 },
      PKG,
    ]},
    { name: "Tandoori Chicken", category: "Hot Kitchen", section: "Main Course", unitCost: 110, yieldPortions: 1, materials: [
      { code: "RM-2750-CHKN",  name: "Chicken",        qty: 0.10, uom: "KG", rate: 280 },
      { code: "RM-2793-TANDR", name: "Tandoori Marinade", qty: 0.02, uom: "KG", rate: 480 },
      PKG,
    ]},
    { name: "Korean Fried Chicken", category: "Hot Kitchen", section: "Main Course", unitCost: 135, yieldPortions: 1, materials: [
      { code: "RM-2750-CHKN",  name: "Chicken",        qty: 0.10, uom: "KG", rate: 280 },
      { code: "RM-2794-KSAUC", name: "Korean Glaze",   qty: 0.025, uom: "KG", rate: 720 },
      { code: "RM-2795-PFLR",  name: "Coating Flour",  qty: 0.02, uom: "KG", rate: 110 },
      PKG,
    ]},
    { name: "Fish Curry", category: "Hot Kitchen", section: "Main Course", unitCost: 120, yieldPortions: 1, materials: [
      { code: "RM-2796-FISH",  name: "Fish Fillet",    qty: 0.10, uom: "KG", rate: 720 },
      { code: "RM-2790-MASLA", name: "Masala Mix",     qty: 0.008, uom: "KG", rate: 350 },
      PKG,
    ]},

    // ── Veg / dal ──
    { name: "Mug Dal", category: "Hot Kitchen", section: "Dal", unitCost: 32, yieldPortions: 1, materials: [
      { code: "RM-2740-MOOG",  name: "Moog Dal",       qty: 0.06, uom: "KG", rate: 140 },
      { code: "RM-2761-OIL",   name: "Cooking Oil",    qty: 0.005, uom: "Litre", rate: 180 },
      PKG,
    ]},
    { name: "Mug Dal Vuna", category: "Hot Kitchen", section: "Dal", unitCost: 36, yieldPortions: 1, materials: [
      { code: "RM-2740-MOOG",  name: "Moog Dal",       qty: 0.06, uom: "KG", rate: 140 },
      { code: "RM-2791-ONION", name: "Onion",          qty: 0.03, uom: "KG", rate: 80 },
      { code: "RM-2710-GHEE",  name: "Ghee",           qty: 0.005, uom: "KG", rate: 1100 },
      PKG,
    ]},
    { name: "Dal Butter Fry", category: "Hot Kitchen", section: "Dal", unitCost: 38, yieldPortions: 1, materials: [
      { code: "RM-2741-DAL",   name: "Yellow Dal",     qty: 0.06, uom: "KG", rate: 130 },
      { code: "RM-2774-BUTTR", name: "Butter",         qty: 0.01, uom: "KG", rate: 950 },
      PKG,
    ]},
    { name: "Dal Tadka", category: "Hot Kitchen", section: "Dal", unitCost: 30, yieldPortions: 1, materials: [
      { code: "RM-2741-DAL",   name: "Yellow Dal",     qty: 0.06, uom: "KG", rate: 130 },
      { code: "RM-2721-JEERA", name: "Cumin Seed",     qty: 0.002, uom: "KG", rate: 800 },
      PKG,
    ]},
    { name: "Chana Dal", category: "Hot Kitchen", section: "Dal", unitCost: 34, yieldPortions: 1, materials: [
      { code: "RM-2742-CHANA", name: "Chana Dal",      qty: 0.06, uom: "KG", rate: 160 },
      { code: "RM-2761-OIL",   name: "Cooking Oil",    qty: 0.005, uom: "Litre", rate: 180 },
      PKG,
    ]},
    { name: "Mixed Veg", category: "Hot Kitchen", section: "Vegetable", unitCost: 28, yieldPortions: 1, materials: [
      { code: "RM-2730-MIXV",  name: "Mixed Vegetables", qty: 0.08, uom: "KG", rate: 65 },
      { code: "RM-2761-OIL",   name: "Cooking Oil",    qty: 0.005, uom: "Litre", rate: 180 },
      PKG,
    ]},
    { name: "Mixed Veg Curry", category: "Hot Kitchen", section: "Vegetable", unitCost: 32, yieldPortions: 1, materials: [
      { code: "RM-2730-MIXV",  name: "Mixed Vegetables", qty: 0.08, uom: "KG", rate: 65 },
      { code: "RM-2790-MASLA", name: "Masala Mix",     qty: 0.005, uom: "KG", rate: 350 },
      PKG,
    ]},
    { name: "Sauteed Veg", category: "Hot Kitchen", section: "Vegetable", unitCost: 26, yieldPortions: 1, materials: [
      { code: "RM-2730-MIXV",  name: "Mixed Vegetables", qty: 0.08, uom: "KG", rate: 65 },
      { code: "RM-2774-BUTTR", name: "Butter",         qty: 0.005, uom: "KG", rate: 950 },
      PKG,
    ]},
    { name: "Sauteed Vegetables", category: "Hot Kitchen", section: "Vegetable", unitCost: 26, yieldPortions: 1, materials: [
      { code: "RM-2730-MIXV",  name: "Mixed Vegetables", qty: 0.08, uom: "KG", rate: 65 },
      { code: "RM-2774-BUTTR", name: "Butter",         qty: 0.005, uom: "KG", rate: 950 },
      PKG,
    ]},
    { name: "Buttered Veg", category: "Hot Kitchen", section: "Vegetable", unitCost: 24, yieldPortions: 1, materials: [
      { code: "RM-2730-MIXV",  name: "Mixed Vegetables", qty: 0.06, uom: "KG", rate: 65 },
      { code: "RM-2774-BUTTR", name: "Butter",         qty: 0.008, uom: "KG", rate: 950 },
      PKG,
    ]},
    { name: "Paneer Tikka Masala", category: "Hot Kitchen", section: "Main Course", unitCost: 88, yieldPortions: 1, materials: [
      { code: "RM-2800-PANER", name: "Paneer",         qty: 0.08, uom: "KG", rate: 540 },
      { code: "RM-2790-MASLA", name: "Masala Mix",     qty: 0.008, uom: "KG", rate: 350 },
      { code: "RM-2764-DAIRY", name: "Yoghurt",        qty: 0.02, uom: "KG", rate: 110 },
      PKG,
    ]},
    { name: "Channa Masala", category: "Hot Kitchen", section: "Vegetable", unitCost: 42, yieldPortions: 1, materials: [
      { code: "RM-2742-CHANA", name: "Chana Dal",      qty: 0.06, uom: "KG", rate: 160 },
      { code: "RM-2790-MASLA", name: "Masala Mix",     qty: 0.006, uom: "KG", rate: 350 },
      PKG,
    ]},
    { name: "Raita", category: "Cold Kitchen", section: "Side", unitCost: 18, yieldPortions: 1, materials: [
      { code: "RM-2764-DAIRY", name: "Yoghurt",        qty: 0.05, uom: "KG", rate: 110 },
      { code: "RM-2810-CUCMB", name: "Cucumber",       qty: 0.02, uom: "KG", rate: 55 },
      PKG,
    ]},

    // ── Egg ──
    { name: "Fried Egg", category: "Cold Kitchen", section: "Breakfast", unitCost: 22, yieldPortions: 1, materials: [
      { code: "RM-2820-EGG",   name: "Egg",            qty: 1, uom: "PCS", rate: 12 },
      { code: "RM-2761-OIL",   name: "Cooking Oil",    qty: 0.005, uom: "Litre", rate: 180 },
      PKG,
    ]},
    { name: "Scrambled Egg", category: "Cold Kitchen", section: "Breakfast", unitCost: 28, yieldPortions: 1, materials: [
      { code: "RM-2820-EGG",   name: "Egg",            qty: 2, uom: "PCS", rate: 12 },
      { code: "RM-2774-BUTTR", name: "Butter",         qty: 0.003, uom: "KG", rate: 950 },
      PKG,
    ]},
    { name: "Boiled Egg", category: "Cold Kitchen", section: "Breakfast", unitCost: 14, yieldPortions: 1, materials: [
      { code: "RM-2820-EGG",   name: "Egg",            qty: 1, uom: "PCS", rate: 12 },
      PKG,
    ]},

    // ── Sides ──
    { name: "Potato Wedges", category: "Hot Kitchen", section: "Side", unitCost: 22, yieldPortions: 1, materials: [
      { code: "RM-2830-POTAT", name: "Potato",         qty: 0.08, uom: "KG", rate: 45 },
      { code: "RM-2761-OIL",   name: "Cooking Oil",    qty: 0.01, uom: "Litre", rate: 180 },
      PKG,
    ]},
    { name: "Fruit Salad", category: "Cold Kitchen", section: "Side", unitCost: 38, yieldPortions: 1, materials: [
      { code: "RM-2840-FRUIT", name: "Mixed Fruit",    qty: 0.08, uom: "KG", rate: 280 },
      PKG,
    ]},

    // ── Desserts ──
    { name: "Vanilla Pastry", category: "Bakery", section: "Dessert", unitCost: 48, yieldPortions: 1, materials: [
      { code: "RM-2850-CAKE",  name: "Vanilla Sponge", qty: 0.05, uom: "KG", rate: 480 },
      { code: "RM-2851-CREAM", name: "Cream",          qty: 0.02, uom: "KG", rate: 320 },
      PKG,
    ]},
    { name: "Mango Mousse", category: "Bakery", section: "Dessert", unitCost: 52, yieldPortions: 1, materials: [
      { code: "RM-2860-MANGO", name: "Mango Pulp",     qty: 0.05, uom: "KG", rate: 420 },
      { code: "RM-2851-CREAM", name: "Cream",          qty: 0.03, uom: "KG", rate: 320 },
      PKG,
    ]},
    { name: "Yoghurt", category: "Cold Kitchen", section: "Dessert", unitCost: 22, yieldPortions: 1, materials: [
      { code: "RM-2764-DAIRY", name: "Yoghurt",        qty: 0.08, uom: "KG", rate: 110 },
      PKG,
    ]},
    { name: "Yoghurt & Semolina", category: "Cold Kitchen", section: "Dessert", unitCost: 34, yieldPortions: 1, materials: [
      { code: "RM-2764-DAIRY", name: "Yoghurt",        qty: 0.06, uom: "KG", rate: 110 },
      { code: "RM-2870-SEMOL", name: "Semolina",       qty: 0.03, uom: "KG", rate: 95 },
      PKG,
    ]},
    { name: "Firni & Semolina", category: "Cold Kitchen", section: "Dessert", unitCost: 38, yieldPortions: 1, materials: [
      { code: "RM-2880-MILK",  name: "Milk",           qty: 0.05, uom: "Litre", rate: 95 },
      { code: "RM-2870-SEMOL", name: "Semolina",       qty: 0.025, uom: "KG", rate: 95 },
      { code: "RM-2890-SUGAR", name: "Sugar",          qty: 0.015, uom: "KG", rate: 130 },
      PKG,
    ]},
    { name: "Firni & Vanilla Pastry", category: "Bakery", section: "Dessert", unitCost: 56, yieldPortions: 1, materials: [
      { code: "RM-2880-MILK",  name: "Milk",           qty: 0.04, uom: "Litre", rate: 95 },
      { code: "RM-2850-CAKE",  name: "Vanilla Sponge", qty: 0.03, uom: "KG", rate: 480 },
      { code: "RM-2890-SUGAR", name: "Sugar",          qty: 0.015, uom: "KG", rate: 130 },
      PKG,
    ]},
    { name: "Gulab Jamun", category: "Bakery", section: "Dessert", unitCost: 32, yieldPortions: 1, materials: [
      { code: "RM-2900-KHOYA", name: "Khoya",          qty: 0.03, uom: "KG", rate: 380 },
      { code: "RM-2890-SUGAR", name: "Sugar",          qty: 0.025, uom: "KG", rate: 130 },
      PKG,
    ]},

    // ── Combo / multi-output ──
    { name: "Plain Polao, Saffron Rice, Chicken Korma, Kitkat Chocolate", category: "Hot Kitchen", section: "Combo", unitCost: 220, yieldPortions: 1, materials: [
      { code: "RM-2701-RICE",  name: "Polao Rice",     qty: 0.20, uom: "KG", rate: 95 },
      { code: "RM-2750-CHKN",  name: "Chicken",        qty: 0.10, uom: "KG", rate: 280 },
      { code: "RM-2792-CASHW", name: "Cashew Paste",   qty: 0.01, uom: "KG", rate: 1400 },
      { code: "RM-2910-KKAT",  name: "Kitkat Bar",     qty: 1, uom: "PCS", rate: 35 },
      PKG,
    ]},
  ];

  return specs.map((s, idx) => {
    const seq = String(100 + idx).padStart(3, "0");
    const id = `BOM-MP-${seq}`;
    const itemCode = `MP-${s.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    const bomValue = s.materials.reduce((sum, m) => sum + m.qty * m.rate, 0);
    return {
      id, name: s.name, components: s.materials.length, version: "v1.0",
      yield: `${s.yieldPortions} portion${s.yieldPortions === 1 ? "" : "s"}`,
      lastUpdated: "2026-06-01", status: "Active", date: "2026-06-01",
      itemCode, itemName: s.name,
      category: s.category, section: s.section, uom: "PCS", altUom: "",
      lotSize: 1, bomValue: Math.round(bomValue * 100) / 100,
      createdBy: "Chef Auto", bomType: "Single Output",
      productionItems: [
        { item: `${itemCode} - ${s.name} (PCS)`, itemType: "Finished/Trading Goods", netWeight: 0, quantity: 1, costPct: 100 },
      ],
      inputMaterials: s.materials.map((m) => ({
        material: `${m.code} - ${m.name} (${m.uom})`,
        type: m.type ?? "Raw Material",
        excludeScrap: "No" as const,
        altQty: 0,
        quantity: m.qty,
        uom: m.uom,
        wastagePct: 0,
        totalQty: m.qty,
        avgRate: m.rate,
        total: Math.round(m.qty * m.rate * 100) / 100,
      })),
    };
  });
}

// Backfill defaults so existing BOMs report under Head Office Dhaka · Hot Kitchen
export const billOfMaterials: BillOfMaterial[] = _billOfMaterialsRaw.map((b) => ({
  ...b,
  officeId: b.officeId ?? "OFF-001",
  warehouseId: b.warehouseId ?? "WH-003",
}));

const bomAt = (i: number) => billOfMaterials[i % billOfMaterials.length].name;

export const seedProductionEntries = [
  { id: "PRO-2026-000031", date: "2026-05-19", bom: bomAt(0), producedQty: 280, status: "In Preparation" },
  { id: "PRO-2026-000030", date: "2026-05-18", bom: bomAt(2), producedQty: 150, status: "Ready for QC"   },
  { id: "PRO-2026-000029", date: "2026-05-17", bom: bomAt(1), producedQty: 320, status: "Approved"       },
  { id: "PRO-2026-000028", date: "2026-05-12", bom: bomAt(0), producedQty: 250, status: "Closed"         },
  { id: "PRO-2026-000025", date: "2026-05-10", bom: bomAt(1), producedQty: 180, status: "Closed"         },
  { id: "PRO-2026-000022", date: "2026-05-08", bom: bomAt(2), producedQty: 220, status: "Closed"         },
  { id: "PRO-2026-000019", date: "2026-05-05", bom: bomAt(3), producedQty: 130, status: "Closed"         },
  { id: "PRO-2026-000016", date: "2026-05-02", bom: bomAt(4), producedQty: 80,  status: "Closed"         },
  { id: "PRO-2026-000013", date: "2026-04-28", bom: bomAt(5), producedQty: 95,  status: "Closed"         },
  { id: "PRO-2026-000010", date: "2026-04-25", bom: bomAt(0), producedQty: 310, status: "Closed"         },
  { id: "PRO-2026-000007", date: "2026-04-22", bom: bomAt(1), producedQty: 160, status: "Closed"         },
  { id: "PRO-2026-000004", date: "2026-04-18", bom: bomAt(2), producedQty: 200, status: "Closed"         },
  { id: "PRO-2026-000001", date: "2026-04-15", bom: bomAt(3), producedQty: 140, status: "Closed"         },
];

export type ProductionEntryRow = (typeof seedProductionEntries)[number];

export type FlightDirection = "Outbound" | "Return";

export type FlightOrderStatus =
  | "Pending"
  | "Approved"
  | "Production"
  | "Dispatched"
  | "Completed";

/**
 * Status workflow for flight orders, in order. Use `nextFlightStatus` to
 * advance a row through the pipeline.
 */
export const FLIGHT_ORDER_STATUS_FLOW: FlightOrderStatus[] = [
  "Pending",
  "Approved",
  "Production",
  "Dispatched",
  "Completed",
];

export function nextFlightStatus(s: FlightOrderStatus): FlightOrderStatus | null {
  const i = FLIGHT_ORDER_STATUS_FLOW.indexOf(s);
  if (i < 0 || i >= FLIGHT_ORDER_STATUS_FLOW.length - 1) return null;
  return FLIGHT_ORDER_STATUS_FLOW[i + 1];
}

// ── Crew-meal slot helpers ──────────────────────────────────────────────────

// `MealSlot` is a string because slots are user-configurable from the
// Configuration → Meal Slots page (see `src/lib/meal-slot-settings.ts`).
// Consumers should fetch the current slot list via `useMealSlots()` rather
// than the legacy `MEAL_SLOTS` constant below — kept only for any pure (non-
// React) caller that just needs a sensible default.
export type MealSlot = string;

export const MEAL_SLOTS: { name: MealSlot; range: string; from: number; to: number }[] = [
  { name: "Breakfast",    range: "06:00 - 11:00", from: 6,  to: 11 },
  { name: "Heavy Snacks", range: "11:00 - 15:00", from: 11, to: 15 },
  { name: "Lunch",        range: "15:00 - 19:00", from: 15, to: 19 },
  { name: "Dinner",       range: "19:00 - 00:00", from: 19, to: 24 },
];

/**
 * Legacy resolver — uses the seeded defaults. Components that need to react
 * to user-edited slot windows should call `resolveMealSlot` from
 * `meal-slot-settings.ts` instead.
 */
export function getMealSlot(etd: string): MealSlot {
  const m = etd.match(/^(\d{1,2}):/);
  const h = m ? Number(m[1]) : 0;
  if (h >= 6 && h < 11) return "Breakfast";
  if (h >= 11 && h < 15) return "Heavy Snacks";
  if (h >= 15 && h < 19) return "Lunch";
  return "Dinner";
}

const DOMESTIC_AIRPORTS = new Set(["DAC", "CGP", "CXB", "ZYL", "JSR", "RJH", "BZL"]);

export function isDomesticSector(sector: string): boolean {
  const [from, to] = sector.split(" → ").map((s) => s.trim());
  return DOMESTIC_AIRPORTS.has(from) && DOMESTIC_AIRPORTS.has(to);
}

// ── Special meals (IATA codes) ──────────────────────────────────────────────
// Master list of special meal codes used by airlines worldwide. Same data is
// surfaced on the Create form (DDL) and the Details dialog (per-type chips).

export type SpecialMealCategory = "Religious" | "Medical" | "Vegetarian" | "Other";

export const SPECIAL_MEAL_CODES: { code: string; name: string; category: SpecialMealCategory }[] = [
  { code: "AVML", name: "Asian Vegetarian Meal",      category: "Vegetarian" },
  { code: "BBML", name: "Baby Meal",                   category: "Other"      },
  { code: "BLML", name: "Bland Meal",                  category: "Medical"    },
  { code: "CHML", name: "Child Meal",                  category: "Other"      },
  { code: "DBML", name: "Diabetes Meal",               category: "Medical"    },
  { code: "FPML", name: "Fruit Platter Meal",          category: "Vegetarian" },
  { code: "GFML", name: "Gluten Free Meal",            category: "Medical"    },
  { code: "VGML", name: "Vegetarian Meal",             category: "Vegetarian" },
  { code: "LCML", name: "Low Calorie Meal",            category: "Medical"    },
  { code: "HNML", name: "Hindu Meal",                  category: "Religious"  },
  { code: "KSML", name: "Kosher Meal",                 category: "Religious"  },
  { code: "LSML", name: "Low Salt Meal",               category: "Medical"    },
  { code: "MOML", name: "Muslim Meal",                 category: "Religious"  },
  { code: "LFML", name: "Low Fat Meal",                category: "Medical"    },
  { code: "VLML", name: "Vegetarian Lacto Ovo Meal",   category: "Vegetarian" },
  { code: "VJML", name: "Vegetarian Jain Meal",        category: "Religious"  },
  { code: "NLML", name: "No Lactose Meal",             category: "Medical"    },
  { code: "SFML", name: "Seafood Meal",                category: "Other"      },
  { code: "RVML", name: "Raw Vegetarian Meal",         category: "Vegetarian" },
  { code: "VOML", name: "Vegan Meal",                  category: "Vegetarian" },
];

export const SPECIAL_MEAL_BY_CODE: Record<string, { name: string; category: SpecialMealCategory }> =
  Object.fromEntries(SPECIAL_MEAL_CODES.map((m) => [m.code, { name: m.name, category: m.category }]));

export type SpecialMealEntry = {
  id: string;
  pnr: string;
  passengerName: string;
  seat: string;
  mealCode: string; // matches SPECIAL_MEAL_CODES.code
};

// Each row is ONE flight. Multiple rows can share an `orderNo` — that's how
// a single Order # becomes a multi-leg order. `id` stays unique per row for
// stable React keys / cross-references. `direction` marks each leg as the
// outbound or the return flight of the rotation.
// `specialMealRoster` is the per-passenger manifest of special meals — when
// present it's the source of truth and `specialMeals` should equal its length.
export type FlightOrderRow = {
  id: string;
  orderNo: string;
  flight: string;
  airline: string;
  sector: string;
  date: string;
  etd: string;
  pax: number;
  crew: number;
  specialMeals: number;
  status: FlightOrderStatus;
  direction: FlightDirection;
  specialMealRoster?: SpecialMealEntry[];
};

const ROSTER_FO_001: SpecialMealEntry[] = [
  { id: "SM-001", pnr: "09QIBQ", passengerName: "NILAVRO SARKAR DIP",     seat: "21A", mealCode: "AVML" },
  { id: "SM-002", pnr: "09QIBQ", passengerName: "DIPAK SARKAR",            seat: "21B", mealCode: "AVML" },
  { id: "SM-003", pnr: "09QI6J1",passengerName: "MD SHOJIB",               seat: "22A", mealCode: "FPML" },
  { id: "SM-004", pnr: "09MC89", passengerName: "MONIR AHAMMAD",           seat: "21A", mealCode: "FPML" },
  { id: "SM-005", pnr: "09A88B", passengerName: "RAMIN HAQUE",             seat: "22A", mealCode: "BBML" },
  { id: "SM-006", pnr: "09ORUB", passengerName: "RATAN KUMAR AGARWALA",    seat: "22C", mealCode: "VJML" },
  { id: "SM-007", pnr: "09PVR6", passengerName: "DIPAK KANTI BARUA",       seat: "49A", mealCode: "VGML" },
  { id: "SM-008", pnr: "091SWT", passengerName: "RUBEL HOSEN",             seat: "19C", mealCode: "AVML" },
  { id: "SM-009", pnr: "09IA4Q", passengerName: "TAFAJJALL HOSSAIN",       seat: "49A", mealCode: "AVML" },
  { id: "SM-010", pnr: "09DH35", passengerName: "MD MIZANUR RAHMAN",       seat: "49A", mealCode: "MOML" },
  { id: "SM-011", pnr: "09QWDB", passengerName: "MD ANWAR HOSSAIN",        seat: "49B", mealCode: "BLML" },
  { id: "SM-012", pnr: "09QL8W", passengerName: "ROMANA TASNIM",           seat: "49J", mealCode: "MOML" },
];

const ROSTER_FO_003: SpecialMealEntry[] = [
  { id: "SM-101", pnr: "09KDA8", passengerName: "MOHAMMAD SAIFUL ISLAM",   seat: "21A", mealCode: "MOML" },
  { id: "SM-102", pnr: "09LPQ2", passengerName: "REBECCA AHMED",           seat: "12C", mealCode: "GFML" },
  { id: "SM-103", pnr: "09LPQ2", passengerName: "DAVID AHMED",             seat: "12D", mealCode: "GFML" },
  { id: "SM-104", pnr: "09FT3K", passengerName: "PRIYA SINGH",             seat: "8B",  mealCode: "VLML" },
  { id: "SM-105", pnr: "09FT3K", passengerName: "ROHAN SINGH",             seat: "8C",  mealCode: "VLML" },
  { id: "SM-106", pnr: "09WX1V", passengerName: "SARA KHAN",               seat: "33F", mealCode: "DBML" },
  { id: "SM-107", pnr: "09BLM9", passengerName: "JAMES O'CONNOR",          seat: "5A",  mealCode: "LFML" },
  { id: "SM-108", pnr: "09BLM9", passengerName: "EMILY O'CONNOR",          seat: "5B",  mealCode: "CHML" },
  { id: "SM-109", pnr: "09GH7T", passengerName: "FARIDA BEGUM",            seat: "27D", mealCode: "DBML" },
  { id: "SM-110", pnr: "09NM4P", passengerName: "RAJESH PATEL",            seat: "14A", mealCode: "VGML" },
  { id: "SM-111", pnr: "09NM4P", passengerName: "MEERA PATEL",             seat: "14B", mealCode: "VGML" },
  { id: "SM-112", pnr: "09NM4P", passengerName: "ARJUN PATEL",             seat: "14C", mealCode: "CHML" },
  { id: "SM-113", pnr: "09TR8Q", passengerName: "HASNA MOLLAH",            seat: "41F", mealCode: "MOML" },
  { id: "SM-114", pnr: "09XB2W", passengerName: "DEBORAH GOLDSTEIN",       seat: "3A",  mealCode: "KSML" },
  { id: "SM-115", pnr: "09XB2W", passengerName: "AARON GOLDSTEIN",         seat: "3B",  mealCode: "KSML" },
  { id: "SM-116", pnr: "09CP5N", passengerName: "ALICE NGUYEN",            seat: "29A", mealCode: "LSML" },
  { id: "SM-117", pnr: "09VK0L", passengerName: "ZAREEN HUSSAIN",          seat: "16C", mealCode: "MOML" },
  { id: "SM-118", pnr: "09ZN3H", passengerName: "ANIKA RAHMAN",            seat: "22F", mealCode: "BBML" },
];

const ROSTER_FO_007: SpecialMealEntry[] = [
  { id: "SM-201", pnr: "09DOH1", passengerName: "ABDUR RAHMAN",            seat: "15A", mealCode: "MOML" },
  { id: "SM-202", pnr: "09DOH2", passengerName: "FATIMA AKHTAR",           seat: "15B", mealCode: "MOML" },
  { id: "SM-203", pnr: "09DOH3", passengerName: "KARIM AHMED",             seat: "23C", mealCode: "MOML" },
  { id: "SM-204", pnr: "09DOH4", passengerName: "NUSRAT JAHAN",            seat: "23D", mealCode: "VGML" },
  { id: "SM-205", pnr: "09DOH5", passengerName: "IMRAN HOSSAIN",           seat: "31A", mealCode: "DBML" },
  { id: "SM-206", pnr: "09DOH6", passengerName: "LEILA AHMED",             seat: "8E",  mealCode: "BBML" },
  { id: "SM-207", pnr: "09DOH7", passengerName: "TANVIR MAHMUD",           seat: "12A", mealCode: "BLML" },
  { id: "SM-208", pnr: "09DOH8", passengerName: "SADIA RAHMAN",            seat: "12B", mealCode: "CHML" },
  { id: "SM-209", pnr: "09DOH9", passengerName: "JAHID KHAN",              seat: "19F", mealCode: "GFML" },
  { id: "SM-210", pnr: "09DOHA", passengerName: "RUMANA AKTER",            seat: "26D", mealCode: "AVML" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Flight-order generator templates and helpers (declared above seedFlightOrders
// because `const` bindings can't be referenced from the spread-call below before
// they're initialised, even though the function declaration itself is hoisted).
// ─────────────────────────────────────────────────────────────────────────────

const INTL_TEMPLATES: { sector: string; etd: string; flightCode: string; airline: string; pax: number }[] = [
  { sector: "DAC → DXB", etd: "10:30", flightCode: "BG-401",  airline: "Air Astra",  pax: 186 },
  { sector: "DXB → DAC", etd: "23:45", flightCode: "BG-402",  airline: "Air Astra",  pax: 174 },
  { sector: "DAC → LHR", etd: "14:45", flightCode: "BG-522",  airline: "Air Astra",  pax: 214 },
  { sector: "DAC → KUL", etd: "16:20", flightCode: "VQ-901",  airline: "US-Bangla",  pax: 162 },
  { sector: "KUL → SIN", etd: "20:40", flightCode: "VQ-902",  airline: "US-Bangla",  pax: 158 },
  { sector: "SIN → DAC", etd: "23:55", flightCode: "VQ-903",  airline: "US-Bangla",  pax: 144 },
  { sector: "DAC → DOH", etd: "18:10", flightCode: "BS-203",  airline: "US-Bangla",  pax: 168 },
  { sector: "DAC → BKK", etd: "20:00", flightCode: "BS-307",  airline: "US-Bangla",  pax: 282 },
  { sector: "DAC → DXB", etd: "02:15", flightCode: "BG-403",  airline: "Air Astra",  pax: 192 },
  { sector: "DAC → JED", etd: "05:30", flightCode: "BG-651",  airline: "Air Astra",  pax: 220 },
  { sector: "DAC → KUL", etd: "03:45", flightCode: "VQ-905",  airline: "US-Bangla",  pax: 168 },
];

const DOMESTIC_TEMPLATES: { sector: string; etd: string; flightCode: string; airline: string; pax: number }[] = [
  { sector: "DAC → CGP", etd: "06:30", flightCode: "BS-141",  airline: "US-Bangla",  pax: 68 },
  { sector: "CGP → DAC", etd: "08:30", flightCode: "BS-142",  airline: "US-Bangla",  pax: 64 },
  { sector: "DAC → CXB", etd: "07:15", flightCode: "BS-105",  airline: "US-Bangla",  pax: 72 },
  { sector: "DAC → ZYL", etd: "09:45", flightCode: "BS-151",  airline: "US-Bangla",  pax: 65 },
  { sector: "DAC → JSR", etd: "11:30", flightCode: "BS-195",  airline: "US-Bangla",  pax: 60 },
  { sector: "DAC → CXB", etd: "13:20", flightCode: "BS-165",  airline: "US-Bangla",  pax: 72 },
  { sector: "DAC → CGP", etd: "15:40", flightCode: "BS-147",  airline: "US-Bangla",  pax: 68 },
  { sector: "DAC → ZYL", etd: "17:20", flightCode: "BS-149",  airline: "US-Bangla",  pax: 64 },
  { sector: "DAC → CXB", etd: "19:30", flightCode: "BS-115",  airline: "US-Bangla",  pax: 72 },
  { sector: "DAC → JSR", etd: "21:00", flightCode: "BS-159",  airline: "US-Bangla",  pax: 60 },
  { sector: "DAC → CGP", etd: "22:30", flightCode: "BS-143",  airline: "US-Bangla",  pax: 65 },
  { sector: "CXB → DAC", etd: "09:45", flightCode: "BS-106",  airline: "US-Bangla",  pax: 70 },
  { sector: "ZYL → DAC", etd: "11:00", flightCode: "BS-152",  airline: "US-Bangla",  pax: 62 },
  { sector: "JSR → DAC", etd: "13:00", flightCode: "BS-196",  airline: "US-Bangla",  pax: 58 },
  { sector: "CXB → DAC", etd: "15:00", flightCode: "BS-166",  airline: "US-Bangla",  pax: 70 },
  { sector: "CGP → DAC", etd: "17:00", flightCode: "BS-148",  airline: "US-Bangla",  pax: 68 },
  { sector: "ZYL → DAC", etd: "18:45", flightCode: "BS-150",  airline: "US-Bangla",  pax: 62 },
  { sector: "CXB → DAC", etd: "21:00", flightCode: "BS-116",  airline: "US-Bangla",  pax: 70 },
  { sector: "JSR → DAC", etd: "23:00", flightCode: "BS-160",  airline: "US-Bangla",  pax: 58 },
];

export const seedFlightOrders: FlightOrderRow[] = [
  // ORD-3411 — completed rotation
  { id: "FO-001", orderNo: "ORD-3411", flight: "BG-401", airline: "Air Astra", sector: "DAC → DXB", date: "2026-05-20", etd: "10:30", pax: 186, crew: 14, specialMeals: 12, status: "Completed",  direction: "Outbound", specialMealRoster: ROSTER_FO_001 },
  { id: "FO-002", orderNo: "ORD-3411", flight: "BG-402", airline: "Air Astra", sector: "DXB → DAC", date: "2026-05-20", etd: "23:45", pax: 174, crew: 14, specialMeals: 8,  status: "Dispatched", direction: "Return"   },

  // ORD-3412 — currently in production
  { id: "FO-003", orderNo: "ORD-3412", flight: "BG-522", airline: "Air Astra", sector: "DAC → LHR", date: "2026-05-20", etd: "14:45", pax: 214, crew: 18, specialMeals: 18, status: "Production", direction: "Outbound", specialMealRoster: ROSTER_FO_003 },

  // ORD-3413 — full rotation, all legs in production
  { id: "FO-004", orderNo: "ORD-3413", flight: "VQ-901", airline: "US-Bangla", sector: "DAC → KUL", date: "2026-05-20", etd: "16:20", pax: 162, crew: 12, specialMeals: 8,  status: "Production", direction: "Outbound" },
  { id: "FO-005", orderNo: "ORD-3413", flight: "VQ-902", airline: "US-Bangla", sector: "KUL → SIN", date: "2026-05-20", etd: "20:40", pax: 158, crew: 12, specialMeals: 10, status: "Production", direction: "Outbound" },
  { id: "FO-006", orderNo: "ORD-3413", flight: "VQ-903", airline: "US-Bangla", sector: "SIN → DAC", date: "2026-05-20", etd: "23:55", pax: 144, crew: 12, specialMeals: 6,  status: "Approved",   direction: "Return"   },

  // ORD-3414 / ORD-3415 — pending approval / approved
  { id: "FO-007", orderNo: "ORD-3414", flight: "BS-203", airline: "US-Bangla", sector: "DAC → DOH", date: "2026-05-21", etd: "18:10", pax: 168, crew: 14, specialMeals: 10, status: "Approved",   direction: "Outbound", specialMealRoster: ROSTER_FO_007 },
  { id: "FO-008", orderNo: "ORD-3415", flight: "BS-307", airline: "US-Bangla", sector: "DAC → BKK", date: "2026-05-21", etd: "20:00", pax: 282, crew: 16, specialMeals: 22, status: "Pending",    direction: "Outbound" },

  // ── Domestic short-haul (Breakfast slot 06:00-11:00)
  { id: "FO-009", orderNo: "ORD-3416", flight: "BS-141", airline: "US-Bangla", sector: "DAC → CGP", date: "2026-05-20", etd: "06:30", pax: 68,  crew: 4,  specialMeals: 2, status: "Production", direction: "Outbound" },
  { id: "FO-010", orderNo: "ORD-3416", flight: "BS-142", airline: "US-Bangla", sector: "CGP → DAC", date: "2026-05-20", etd: "08:30", pax: 64,  crew: 4,  specialMeals: 1, status: "Production", direction: "Return"   },
  { id: "FO-011", orderNo: "ORD-3417", flight: "BS-105", airline: "US-Bangla", sector: "DAC → CXB", date: "2026-05-20", etd: "07:15", pax: 72,  crew: 4,  specialMeals: 2, status: "Approved",   direction: "Outbound" },
  { id: "FO-012", orderNo: "ORD-3418", flight: "BS-151", airline: "US-Bangla", sector: "DAC → ZYL", date: "2026-05-20", etd: "09:45", pax: 65,  crew: 4,  specialMeals: 1, status: "Pending",    direction: "Outbound" },

  // ── Domestic (Heavy Snacks 11:00-15:00)
  { id: "FO-013", orderNo: "ORD-3419", flight: "BS-195", airline: "US-Bangla", sector: "DAC → JSR", date: "2026-05-20", etd: "11:30", pax: 60,  crew: 4,  specialMeals: 2, status: "Production", direction: "Outbound" },
  { id: "FO-014", orderNo: "ORD-3420", flight: "BS-165", airline: "US-Bangla", sector: "DAC → CXB", date: "2026-05-20", etd: "13:20", pax: 72,  crew: 4,  specialMeals: 3, status: "Approved",   direction: "Outbound" },

  // ── Domestic (Lunch 15:00-19:00)
  { id: "FO-015", orderNo: "ORD-3421", flight: "BS-147", airline: "US-Bangla", sector: "DAC → CGP", date: "2026-05-20", etd: "15:40", pax: 68,  crew: 4,  specialMeals: 2, status: "Production", direction: "Outbound" },
  { id: "FO-016", orderNo: "ORD-3422", flight: "BS-149", airline: "US-Bangla", sector: "DAC → ZYL", date: "2026-05-20", etd: "17:20", pax: 64,  crew: 4,  specialMeals: 1, status: "Approved",   direction: "Outbound" },

  // ── Domestic (Dinner 19:00-24:00)
  { id: "FO-017", orderNo: "ORD-3423", flight: "BS-115", airline: "US-Bangla", sector: "DAC → CXB", date: "2026-05-20", etd: "19:30", pax: 72,  crew: 4,  specialMeals: 2, status: "Pending",    direction: "Outbound" },
  { id: "FO-018", orderNo: "ORD-3424", flight: "BS-159", airline: "US-Bangla", sector: "DAC → JSR", date: "2026-05-20", etd: "21:00", pax: 60,  crew: 4,  specialMeals: 1, status: "Pending",    direction: "Outbound" },

  // ── Procedurally-generated future demand ─────────────────────────────────
  // One ORD per future date for the next 90 days, each containing 30-40
  // flights. Deterministic so reloads produce identical data.
  ...generateFutureFlightOrders(),
];

// ─────────────────────────────────────────────────────────────────────────────
// Flight-order generator
// ─────────────────────────────────────────────────────────────────────────────
// Builds one "ORD-NNNN" per day for 90 days starting 2026-06-01 (the system
// "today" for this demo), each with 30-40 flight legs. Status is "Approved"
// for the first 7 days (already in-pipeline) and "Pending" thereafter.
// LCG-seeded by day index so the same set of rows is generated on every page
// load — no data churn between reloads.
// (INTL_TEMPLATES and DOMESTIC_TEMPLATES are declared above seedFlightOrders.)

function makeLcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function addDaysToDate(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(base.getDate() + days);
  return d;
}

function generateFutureFlightOrders(): FlightOrderRow[] {
  const out: FlightOrderRow[] = [];
  const startDate = new Date(2026, 5, 1); // 2026-06-01 (month is 0-indexed)
  const DAYS = 90;
  const APPROVED_HORIZON_DAYS = 7;
  let foCounter = 19; // continue after FO-018; padded to 4 digits below

  for (let d = 0; d < DAYS; d++) {
    const dt = addDaysToDate(startDate, d);
    const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const orderNo = `ORD-${3425 + d}`;
    const rand = makeLcg(d * 31 + 7);
    const flightCount = 30 + Math.floor(rand() * 11); // 30-40 inclusive
    const status: FlightOrderStatus = d < APPROVED_HORIZON_DAYS ? "Approved" : "Pending";

    for (let i = 0; i < flightCount; i++) {
      const isIntl = rand() < 0.35;
      const pool = isIntl ? INTL_TEMPLATES : DOMESTIC_TEMPLATES;
      const tmpl = pool[Math.floor(rand() * pool.length)];
      const paxJitter = Math.floor((rand() - 0.5) * 30);
      const pax = Math.max(40, tmpl.pax + paxJitter);
      const crew = isIntl ? 12 + Math.floor(rand() * 7) : 4;
      const specialMeals = 1 + Math.floor(rand() * (isIntl ? 25 : 4));
      const direction: FlightDirection = tmpl.sector.startsWith("DAC") ? "Outbound" : "Return";
      const foId = `FO-${String(foCounter++).padStart(4, "0")}`;
      out.push({
        id: foId,
        orderNo,
        flight: tmpl.flightCode,
        airline: tmpl.airline,
        sector: tmpl.sector,
        date: dateStr,
        etd: tmpl.etd,
        pax,
        crew,
        specialMeals,
        status,
        direction,
      });
    }
  }
  return out;
}

// ── Master Item Profile ──────────────────────────────────────────────────────
// Single source of truth for items used by all modules (BOM, PR, Transfer,
// Demand, Item Issue, Inventory, etc). Categories/UoMs etc are intentionally
// exported alongside the data so any UI dropdown can stay in sync.

export type ItemMaster = {
  id: string;
  code: string;
  name: string;
  itemType: "Raw Material" | "Packaging" | "Consumable" | "Finished Good" | "Semi-Finished Good";
  category: string;
  subCategory: string;
  uom: string;
  status: "Active" | "Inactive";
  currentStock?: number;
  reorderLevel?: number;
  thresholdPct?: number;
  batchNo?: string;
  expiryDate?: string;
  storage?: "Dry" | "Cold" | "Frozen";
  /** Cost price per UoM in BDT. Used to prefill rate fields across modules. */
  costPrice?: number;
  /** Per-item allocation method. Perishables → FEFO, shelf-stable → FIFO. */
  allocationMethod?: AllocationMethod;
  /** Office that owns the default warehouse (id from `offices`). */
  officeId?: string;
  /** Default warehouse this item is stored in (id from `warehouses`). */
  warehouseId?: string;
  /** Default bin/rack/shelf location for this item. */
  binLocation?: string;
  /**
   * Whether the item is tracked as discrete batches/lots (each with their own
   * expiry, cost, receipt date) or as a single non-batched stock. When false,
   * the item ignores FIFO/FEFO allocation and shows as a single line on Stock
   * Overview. Defaults to true.
   */
  batchTracked?: boolean;
  /**
   * Alternative units of measure. Stock is always kept in the Primary `uom`,
   * but transactions (Purchase / Production / Transfer / Issue / GRN) may be
   * entered in any of these alt units; the system converts to primary at save
   * time. Example for Egg (Primary = Piece):
   *   altUoms: [
   *     { uom: "Dozen",  conversion: 12  },
   *     { uom: "Tray",   conversion: 30  },
   *     { uom: "Carton", conversion: 360 },
   *   ]
   * `conversion` = number of Primary units contained in 1 of this Alt unit.
   */
  altUoms?: AltUom[];
};

export type AltUom = {
  /** Free-text label, e.g. "Dozen", "Tray", "Carton", "Bag". */
  uom: string;
  /** Number of Primary UOM units per 1 of this Alt UOM. Must be > 0. */
  conversion: number;
};

export const ITEM_TYPES = [
  "Raw Material", "Packaging", "Consumable", "Finished Good", "Semi-Finished Good",
] as const;

export const ITEM_CATEGORIES = [
  "Grains", "Protein", "Vegetable", "Spices", "Oil", "Dairy", "Beverage",
  "Bakery", "Meal", "Packaging", "Other",
] as const;

export const ITEM_SUB_CATEGORIES = ["Fresh", "Frozen", "Dry", "Liquid"] as const;
export const ITEM_UOMS = ["Kg", "Gm", "Litre", "ML", "Piece", "Pack", "Bottle"] as const;
export const ITEM_STORAGE_OPTIONS = ["Dry", "Cold", "Frozen"] as const;

/** Curated list of common Alt UOM labels — picked from the Item Profile DDL. */
export const ALT_UOM_OPTIONS = [
  // Container units
  "Dozen", "Tray", "Carton", "Box", "Case", "Crate", "Pallet",
  // Bulk packaging (with common sizes)
  "Bag (25kg)", "Bag (50kg)", "Sack", "Drum", "Bundle",
  // Pre-packed liquid / dairy
  "Pack (200ml)", "Pack (500ml)", "Pack (1L)",
  // Base units (useful when alt unit is finer/coarser than primary)
  "Piece", "Pack", "Bottle", "Kg", "Gm", "Litre", "ML",
] as const;

const RAW_ITEMS: Array<Omit<ItemMaster, "id">> = [
  // ── Raw Material · Grains
  { code: "RM-RICE-BSMT", name: "Basmati Rice",          itemType: "Raw Material", category: "Grains",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-RICE-BRWN", name: "Brown Rice",            itemType: "Raw Material", category: "Grains",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-RICE-PARB", name: "Parboiled Rice",        itemType: "Raw Material", category: "Grains",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-FLR-WHT",   name: "Wheat Flour",           itemType: "Raw Material", category: "Grains",   subCategory: "Dry",    uom: "Kg",    status: "Active",
    altUoms: [
      { uom: "Bag (25kg)", conversion: 25 },
      { uom: "Bag (50kg)", conversion: 50 },
    ],
  },
  { code: "RM-FLR-APRP",  name: "All-Purpose Flour",     itemType: "Raw Material", category: "Grains",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-FLR-CORN",  name: "Cornflour",             itemType: "Raw Material", category: "Grains",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-FLR-RICE",  name: "Rice Flour",            itemType: "Raw Material", category: "Grains",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-FLR-SMLA",  name: "Semolina",              itemType: "Raw Material", category: "Grains",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-GRN-OATS",  name: "Rolled Oats",           itemType: "Raw Material", category: "Grains",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-PST-SPAG",  name: "Spaghetti Pasta",       itemType: "Raw Material", category: "Grains",   subCategory: "Dry",    uom: "Kg",    status: "Active" },

  // ── Raw Material · Protein
  { code: "RM-CHK-BRST",  name: "Chicken Breast",        itemType: "Raw Material", category: "Protein",  subCategory: "Frozen", uom: "Kg",    status: "Active" },
  { code: "RM-CHK-THGH",  name: "Chicken Thigh",         itemType: "Raw Material", category: "Protein",  subCategory: "Frozen", uom: "Kg",    status: "Active" },
  { code: "RM-CHK-WHLE",  name: "Whole Chicken",         itemType: "Raw Material", category: "Protein",  subCategory: "Frozen", uom: "Kg",    status: "Active" },
  { code: "RM-BEEF-TLN",  name: "Beef Tenderloin",       itemType: "Raw Material", category: "Protein",  subCategory: "Frozen", uom: "Kg",    status: "Active" },
  { code: "RM-BEEF-MNC",  name: "Beef Mince",            itemType: "Raw Material", category: "Protein",  subCategory: "Frozen", uom: "Kg",    status: "Active" },
  { code: "RM-MUT-LEG",   name: "Mutton Leg",            itemType: "Raw Material", category: "Protein",  subCategory: "Frozen", uom: "Kg",    status: "Active" },
  { code: "RM-FSH-SLMN",  name: "Salmon Fillet",         itemType: "Raw Material", category: "Protein",  subCategory: "Frozen", uom: "Kg",    status: "Active" },
  { code: "RM-FSH-TUNA",  name: "Tuna Steak",            itemType: "Raw Material", category: "Protein",  subCategory: "Frozen", uom: "Kg",    status: "Active" },
  { code: "RM-PRWN-LRG",  name: "Prawn (Large)",         itemType: "Raw Material", category: "Protein",  subCategory: "Frozen", uom: "Kg",    status: "Active" },
  { code: "RM-EGG-CHK",   name: "Chicken Egg",           itemType: "Raw Material", category: "Protein",  subCategory: "Fresh",  uom: "Piece", status: "Active",
    altUoms: [
      { uom: "Dozen",  conversion: 12  },
      { uom: "Tray",   conversion: 30  },
      { uom: "Carton", conversion: 360 },
    ],
  },

  // ── Raw Material · Vegetable
  { code: "RM-VEG-TOM",   name: "Tomato",                itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-ONN",   name: "Onion",                 itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-POT",   name: "Potato",                itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-CAR",   name: "Carrot",                itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-CUC",   name: "Cucumber",              itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-LMN",   name: "Lemon",                 itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-LET",   name: "Lettuce",               itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-BPR",   name: "Bell Pepper",           itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-GRL",   name: "Garlic",                itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-GNG",   name: "Ginger",                itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-MSH",   name: "Mushroom",              itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-SPN",   name: "Spinach",               itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-CBG",   name: "Cabbage",               itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-VEG-CFL",   name: "Cauliflower",           itemType: "Raw Material", category: "Vegetable",subCategory: "Fresh",  uom: "Kg",    status: "Active" },

  // ── Raw Material · Spices
  { code: "RM-SPC-CMN",   name: "Cumin Powder",          itemType: "Raw Material", category: "Spices",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-SPC-TRM",   name: "Turmeric Powder",       itemType: "Raw Material", category: "Spices",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-SPC-CHL",   name: "Chili Powder",          itemType: "Raw Material", category: "Spices",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-SPC-GMS",   name: "Garam Masala",          itemType: "Raw Material", category: "Spices",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-SPC-BPP",   name: "Black Pepper",          itemType: "Raw Material", category: "Spices",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-SPC-CRD",   name: "Cardamom",              itemType: "Raw Material", category: "Spices",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-SPC-CIN",   name: "Cinnamon Stick",        itemType: "Raw Material", category: "Spices",   subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-SPC-BYL",   name: "Bay Leaf",              itemType: "Raw Material", category: "Spices",   subCategory: "Dry",    uom: "Kg",    status: "Active" },

  // ── Raw Material · Oil & Fats
  { code: "RM-OIL-SOY",   name: "Soyabean Cooking Oil",  itemType: "Raw Material", category: "Oil",      subCategory: "Liquid", uom: "Litre", status: "Active" },
  { code: "RM-OIL-OLV",   name: "Olive Oil",             itemType: "Raw Material", category: "Oil",      subCategory: "Liquid", uom: "Litre", status: "Active" },
  { code: "RM-OIL-SUN",   name: "Sunflower Oil",         itemType: "Raw Material", category: "Oil",      subCategory: "Liquid", uom: "Litre", status: "Active" },
  { code: "RM-OIL-MST",   name: "Mustard Oil",           itemType: "Raw Material", category: "Oil",      subCategory: "Liquid", uom: "Litre", status: "Active" },
  { code: "RM-OIL-GHE",   name: "Ghee",                  itemType: "Raw Material", category: "Oil",      subCategory: "Dry",    uom: "Kg",    status: "Active" },

  // ── Raw Material · Dairy
  { code: "RM-DRY-BTRS",  name: "Butter (Salted)",       itemType: "Raw Material", category: "Dairy",    subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-DRY-BTRU",  name: "Butter (Unsalted)",     itemType: "Raw Material", category: "Dairy",    subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-DRY-CHED",  name: "Cheese (Cheddar)",      itemType: "Raw Material", category: "Dairy",    subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-DRY-MOZZ",  name: "Cheese (Mozzarella)",   itemType: "Raw Material", category: "Dairy",    subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-DRY-MLK",   name: "Milk (Full Cream)",     itemType: "Raw Material", category: "Dairy",    subCategory: "Liquid", uom: "Litre", status: "Active",
    altUoms: [
      { uom: "ML",   conversion: 0.001 },
      { uom: "Pack (200ml)", conversion: 0.2 },
      { uom: "Pack (1L)",    conversion: 1   },
    ],
  },
  { code: "RM-DRY-YGT",   name: "Yogurt",                itemType: "Raw Material", category: "Dairy",    subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "RM-DRY-CRM",   name: "Heavy Cream",           itemType: "Raw Material", category: "Dairy",    subCategory: "Liquid", uom: "Litre", status: "Active" },

  // ── Raw Material · Beverage / Sundry
  { code: "RM-BV-WTR250", name: "Mineral Water 250ml",   itemType: "Raw Material", category: "Beverage", subCategory: "Liquid", uom: "Bottle",status: "Active" },
  { code: "RM-BV-WTR500", name: "Mineral Water 500ml",   itemType: "Raw Material", category: "Beverage", subCategory: "Liquid", uom: "Bottle",status: "Active" },
  { code: "RM-BV-TEA",    name: "Tea Leaves",            itemType: "Raw Material", category: "Beverage", subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-BV-COF",    name: "Coffee Beans",          itemType: "Raw Material", category: "Beverage", subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-OTH-SUG",   name: "Sugar (White)",         itemType: "Raw Material", category: "Other",    subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-OTH-SLT",   name: "Salt (Iodized)",        itemType: "Raw Material", category: "Other",    subCategory: "Dry",    uom: "Kg",    status: "Active" },
  { code: "RM-OTH-HNY",   name: "Honey",                 itemType: "Raw Material", category: "Other",    subCategory: "Liquid", uom: "Kg",    status: "Active" },
  { code: "RM-OTH-YST",   name: "Yeast (Active Dry)",    itemType: "Raw Material", category: "Bakery",   subCategory: "Dry",    uom: "Pack",  status: "Active" },
  { code: "RM-OTH-BKP",   name: "Baking Powder",         itemType: "Raw Material", category: "Bakery",   subCategory: "Dry",    uom: "Pack",  status: "Active" },
  { code: "RM-OTH-CHOC",  name: "Chocolate (Dark)",      itemType: "Raw Material", category: "Bakery",   subCategory: "Dry",    uom: "Kg",    status: "Active" },

  // ── Packaging
  { code: "PK-BOX-MEAL",  name: "Meal Box (Paper)",      itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Piece", status: "Active" },
  { code: "PK-TRY-ALU",   name: "Aluminum Foil Tray",    itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Piece", status: "Active" },
  { code: "PK-FIL-ALU",   name: "Aluminum Foil Roll",    itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Pack",  status: "Active" },
  { code: "PK-FIL-CLG",   name: "Cling Film",            itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Pack",  status: "Active" },
  { code: "PK-CNT-PLA",   name: "Plastic Container 250g",itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Piece", status: "Active" },
  { code: "PK-CUP-8OZ",   name: "Disposable Cup 8oz",    itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Pack",  status: "Active" },
  { code: "PK-CUP-12OZ",  name: "Disposable Cup 12oz",   itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Pack",  status: "Active" },
  { code: "PK-STR-PLA",   name: "Plastic Straw",         itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Pack",  status: "Active" },
  { code: "PK-NPK-PPR",   name: "Paper Napkin",          itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Pack",  status: "Active" },
  { code: "PK-CTL-SET",   name: "Cutlery Set (Plastic)", itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Pack",  status: "Active" },
  { code: "PK-BTL-250",   name: "Bottle 250ml (Empty)",  itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Piece", status: "Active" },
  { code: "PK-BTL-500",   name: "Bottle 500ml (Empty)",  itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Piece", status: "Active" },
  { code: "PK-CAP-PET",   name: "Bottle Cap (PET)",      itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Piece", status: "Active" },
  { code: "PK-LBL-USB",   name: "Label (US-Bangla)",     itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Piece", status: "Active" },
  { code: "PK-LBL-MUM",   name: "Label (Mum Water)",     itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Piece", status: "Active" },
  { code: "PK-BAG-VAC",   name: "Vacuum Seal Bag",       itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Piece", status: "Active" },
  { code: "PK-WRP-SHR",   name: "Shrink Wrap",           itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Pack",  status: "Active" },
  { code: "PK-BOX-CTN",   name: "Carton Box (Medium)",   itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Piece", status: "Active" },
  { code: "PK-TPE-SCH",   name: "Sealing Tape",          itemType: "Packaging",    category: "Packaging",subCategory: "Dry",    uom: "Piece", status: "Active" },

  // ── Semi-Finished Goods
  { code: "SF-CHK-MRN",   name: "Marinated Chicken",     itemType: "Semi-Finished Good", category: "Protein",   subCategory: "Frozen", uom: "Kg",    status: "Active" },
  { code: "SF-RCE-BLD",   name: "Boiled Rice (Plain)",   itemType: "Semi-Finished Good", category: "Grains",    subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "SF-VEG-CHP",   name: "Chopped Vegetable Mix", itemType: "Semi-Finished Good", category: "Vegetable", subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "SF-TOM-PUR",   name: "Tomato Puree",          itemType: "Semi-Finished Good", category: "Vegetable", subCategory: "Liquid", uom: "Kg",    status: "Active" },
  { code: "SF-PST-ONN",   name: "Onion Paste",           itemType: "Semi-Finished Good", category: "Vegetable", subCategory: "Liquid", uom: "Kg",    status: "Active" },
  { code: "SF-PST-GG",    name: "Garlic-Ginger Paste",   itemType: "Semi-Finished Good", category: "Spices",    subCategory: "Liquid", uom: "Kg",    status: "Active" },
  { code: "SF-DGH-BRD",   name: "Bread Dough",           itemType: "Semi-Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "SF-PTY-CRM",   name: "Pastry Cream",          itemType: "Semi-Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Kg",    status: "Active" },
  { code: "SF-BSE-PZA",   name: "Pizza Base",            itemType: "Semi-Finished Good", category: "Bakery",    subCategory: "Frozen", uom: "Piece",status: "Active" },
  { code: "SF-BSE-CAK",   name: "Sponge Cake Base",      itemType: "Semi-Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Piece",status: "Active" },
  { code: "SF-STK-CHK",   name: "Chicken Stock",         itemType: "Semi-Finished Good", category: "Protein",   subCategory: "Liquid", uom: "Litre",status: "Active" },

  // ── Finished Goods · Meals
  { code: "FG-MEAL-CBR",  name: "Chicken Biryani",       itemType: "Finished Good", category: "Meal",      subCategory: "Frozen", uom: "Piece", status: "Active" },
  { code: "FG-MEAL-BCR",  name: "Beef Curry",            itemType: "Finished Good", category: "Meal",      subCategory: "Frozen", uom: "Piece", status: "Active" },
  { code: "FG-MEAL-VPL",  name: "Veg Pulao",             itemType: "Finished Good", category: "Meal",      subCategory: "Frozen", uom: "Piece", status: "Active" },
  { code: "FG-MEAL-MCR",  name: "Mutton Curry",          itemType: "Finished Good", category: "Meal",      subCategory: "Frozen", uom: "Piece", status: "Active" },
  { code: "FG-MEAL-GSL",  name: "Grilled Salmon",        itemType: "Finished Good", category: "Meal",      subCategory: "Frozen", uom: "Piece", status: "Active" },
  { code: "FG-MEAL-FCR",  name: "Fish Curry",            itemType: "Finished Good", category: "Meal",      subCategory: "Frozen", uom: "Piece", status: "Active" },
  { code: "FG-MEAL-CBF",  name: "Continental Breakfast", itemType: "Finished Good", category: "Meal",      subCategory: "Fresh",  uom: "Piece", status: "Active" },
  { code: "FG-MEAL-HMS",  name: "Hindu Meal Special",    itemType: "Finished Good", category: "Meal",      subCategory: "Frozen", uom: "Piece", status: "Active" },
  { code: "FG-MEAL-CCM",  name: "Crew Combo Meal",       itemType: "Finished Good", category: "Meal",      subCategory: "Frozen", uom: "Piece", status: "Active" },
  { code: "FG-MEAL-VML",  name: "Vegetarian Meal",       itemType: "Finished Good", category: "Meal",      subCategory: "Frozen", uom: "Piece", status: "Active" },
  { code: "FG-MEAL-KSH",  name: "Kosher Meal",           itemType: "Finished Good", category: "Meal",      subCategory: "Frozen", uom: "Piece", status: "Active" },

  // ── Finished Goods · Bakery & Snacks
  { code: "FG-BK-CROIS",  name: "Croissant",             itemType: "Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Piece", status: "Active" },
  { code: "FG-BK-DANSH",  name: "Danish Pastry",         itemType: "Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Piece", status: "Active" },
  { code: "FG-BK-MUFF",   name: "Muffin",                itemType: "Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Piece", status: "Active" },
  { code: "FG-BK-DONUT",  name: "Donut",                 itemType: "Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Piece", status: "Active" },
  { code: "FG-BK-CAKE",   name: "Cake Slice",            itemType: "Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Piece", status: "Active" },
  { code: "FG-BK-BANC",   name: "Banana Cake",           itemType: "Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Piece", status: "Active" },
  { code: "FG-BK-COOK",   name: "Cookies Pack",          itemType: "Finished Good", category: "Bakery",    subCategory: "Dry",    uom: "Pack",  status: "Active" },
  { code: "FG-SD-CHK",    name: "Sandwich (Chicken)",    itemType: "Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Piece", status: "Active" },
  { code: "FG-SD-VEG",    name: "Sandwich (Veg)",        itemType: "Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Piece", status: "Active" },
  { code: "FG-BR-CHK",    name: "Chicken Burger",        itemType: "Finished Good", category: "Meal",      subCategory: "Fresh",  uom: "Piece", status: "Active" },
  { code: "FG-BR-BEEF",   name: "Beef Burger",           itemType: "Finished Good", category: "Meal",      subCategory: "Fresh",  uom: "Piece", status: "Active" },
  { code: "FG-SN-ENB",    name: "Energy Bar",            itemType: "Finished Good", category: "Bakery",    subCategory: "Dry",    uom: "Piece", status: "Active" },
  { code: "FG-DS-MMS",    name: "Mango Mousse",          itemType: "Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Piece", status: "Active" },
  { code: "FG-DS-FRS",    name: "Fruit Salad Cup",       itemType: "Finished Good", category: "Bakery",    subCategory: "Fresh",  uom: "Piece", status: "Active" },

  // ── Finished Goods · Beverages
  { code: "FG-BV-MUM250", name: "Mum Water 250ml",       itemType: "Finished Good", category: "Beverage",  subCategory: "Liquid", uom: "Bottle",status: "Active" },
  { code: "FG-BV-MUM500", name: "Mum Water 500ml",       itemType: "Finished Good", category: "Beverage",  subCategory: "Liquid", uom: "Bottle",status: "Active" },
  { code: "FG-BV-ORJ",    name: "Orange Juice (1L)",     itemType: "Finished Good", category: "Beverage",  subCategory: "Liquid", uom: "Bottle",status: "Active" },
  { code: "FG-BV-APJ",    name: "Apple Juice (1L)",      itemType: "Finished Good", category: "Beverage",  subCategory: "Liquid", uom: "Bottle",status: "Active" },
  { code: "FG-BV-COLA",   name: "Soft Drink (Cola)",     itemType: "Finished Good", category: "Beverage",  subCategory: "Liquid", uom: "Bottle",status: "Active" },
  { code: "FG-BV-COFB",   name: "Coffee (Black)",        itemType: "Finished Good", category: "Beverage",  subCategory: "Liquid", uom: "Piece", status: "Active" },
  { code: "FG-BV-TEAM",   name: "Tea (Milk)",            itemType: "Finished Good", category: "Beverage",  subCategory: "Liquid", uom: "Piece", status: "Active" },
];

// Fallback cost-price tiers used to backfill items that lack an explicit price.
// Deterministic by category + UoM so every product has a usable rate.
const COST_PRICE_BY_CATEGORY: Record<string, number> = {
  Grains: 90,
  Protein: 380,
  Vegetable: 60,
  Spices: 250,
  Oil: 195,
  Dairy: 140,
  Beverage: 35,
  Bakery: 45,
  Meal: 220,
  Packaging: 8,
  Other: 50,
};

function defaultCostPrice(item: Omit<ItemMaster, "id">): number {
  const base = COST_PRICE_BY_CATEGORY[item.category] ?? 50;
  // UoM-aware adjustments so liquids/bottles aren't priced as Kg.
  if (item.uom === "Bottle") return Math.max(12, Math.round(base / 5));
  if (item.uom === "Piece") return Math.max(5, Math.round(base / 4));
  if (item.uom === "Pack")  return Math.max(20, Math.round(base / 2));
  if (item.uom === "Gm")    return Math.max(1, Math.round(base / 1000));
  if (item.uom === "ML")    return Math.max(1, Math.round(base / 1000));
  return base;
}

/** Default allocation method by item type/category — perishables FEFO, shelf-stable FIFO. */
function defaultAllocationMethod(item: Omit<ItemMaster, "id">): AllocationMethod {
  if (item.itemType === "Packaging" || item.itemType === "Consumable") return "FIFO";
  // Raw Materials, Finished Goods, Semi-Finished — perishability driven by category
  const fefoCats = new Set(["Protein", "Dairy", "Vegetable", "Bakery", "Meal", "Beverage"]);
  if (fefoCats.has(item.category)) return "FEFO";
  if (item.subCategory === "Fresh" || item.subCategory === "Frozen") return "FEFO";
  return "FIFO";
}

/**
 * Default batch-tracked flag. Perishables and items with meaningful expiry
 * default to batch-tracked. Shelf-stable hardware-like packaging (tape, caps,
 * straws, labels) defaults to single-item (no batch / no FIFO-FEFO).
 */
function defaultBatchTracked(item: Omit<ItemMaster, "id">): boolean {
  if (item.itemType === "Packaging") {
    // Hardware-like packaging that doesn't carry expiry → single item
    const singleCodes = new Set(["PK-TPE-SCH", "PK-CAP-PET", "PK-LBL-USB", "PK-LBL-MUM", "PK-STR-PLA"]);
    if (singleCodes.has(item.code)) return false;
  }
  return true;
}

export const items: ItemMaster[] = RAW_ITEMS.map((row, i) => ({
  id: `ITM-${String(i + 1).padStart(3, "0")}`,
  ...row,
  costPrice: row.costPrice ?? defaultCostPrice(row),
  allocationMethod: row.allocationMethod ?? defaultAllocationMethod(row),
  batchTracked: row.batchTracked ?? defaultBatchTracked(row),
}));

/** Active master items only (use this in pickers/DDLs by default) */
export const activeItems: ItemMaster[] = items.filter((i) => i.status === "Active");

/** Filter items by item type (e.g. "Raw Material", "Finished Good") */
export const itemsByType = (...types: ItemMaster["itemType"][]): ItemMaster[] =>
  activeItems.filter((i) => types.includes(i.itemType));

/** Item types that REQUIRE a BOM linkage to be considered valid. */
export const BOM_REQUIRED_ITEM_TYPES: ItemMaster["itemType"][] = ["Finished Good"];

/**
 * Resolve the active BOM (if any) for an item code. BOMs link to items by
 * `itemCode` (string match, case-insensitive). Used to surface "Missing BOM"
 * state for Finished Goods on the Item Profile.
 */
export function bomForItemCode(itemCode: string | undefined): BillOfMaterial | undefined {
  if (!itemCode) return undefined;
  const needle = itemCode.toLowerCase();
  return billOfMaterials.find((b) => b.itemCode.toLowerCase() === needle);
}

// ── Stock Overview: derive inventory rows from the Item Profile ─────────────
// Every active Item Profile entry shows in Stock Overview. Curated batches
// (SEED_INVENTORY above) override the auto-generated batches for items by name.

/** Decide storage tier for an auto-generated inventory row. */
function storageForItem(it: ItemMaster): "Dry" | "Cold" | "Frozen" {
  if (it.subCategory === "Frozen") return "Frozen";
  if (it.subCategory === "Fresh" || it.subCategory === "Liquid") return "Cold";
  if (it.category === "Dairy" || it.category === "Beverage" || it.category === "Vegetable") return "Cold";
  if (it.category === "Protein") return "Frozen";
  return "Dry";
}

/** Days of shelf-life used to project a synthetic batch expiry. */
function shelfLifeDays(it: ItemMaster): number {
  if (it.itemType === "Packaging") return 730;
  if (it.itemType === "Consumable") return 540;
  // Raw Material varies by category / subCategory
  if (it.subCategory === "Fresh") return 14;
  if (it.subCategory === "Frozen") return 180;
  if (it.category === "Dairy") return 60;
  if (it.category === "Vegetable") return 21;
  if (it.category === "Protein") return 90;
  if (it.category === "Spices") return 365;
  return 365;
}

/** Stable pseudo-random number in [min, max], seeded by `code` for determinism. */
function seededRand(code: string, min: number, max: number): number {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const t = h / 0xffffffff;
  return Math.round(min + t * (max - min));
}

/** Base on-hand quantity for an auto-generated row, scaled by UoM. */
function defaultStockQty(it: ItemMaster): number {
  const seed = seededRand(it.code, 1, 100);
  if (it.uom === "Kg" || it.uom === "Litre") return 30 + seed;
  if (it.uom === "Gm" || it.uom === "ML") return 500 + seed * 10;
  if (it.uom === "Bottle") return 200 + seed * 5;
  if (it.uom === "Pack") return 40 + seed;
  return 60 + seed;
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86400000).toISOString().slice(0, 10);
}

/** Bin-location aisle prefix derived from storage tier. */
function binPrefix(it: ItemMaster): string {
  const s = storageForItem(it);
  if (s === "Frozen") return "F";
  if (s === "Cold") return "C";
  return "A";
}

function generateInventoryItem(it: ItemMaster): InventoryItem {
  const today = new Date();
  const life = shelfLifeDays(it);
  const stock = defaultStockQty(it);
  const cost = it.costPrice ?? 0;
  const split = Math.floor(stock * 0.55);
  const lotCode = it.code.replace(/[^A-Z0-9]/gi, "").slice(-4).toUpperCase();
  const prefix = binPrefix(it);
  const aisleNum = (seededRand(it.code, 1, 6));
  const rackNum  = (seededRand(it.code + "R", 1, 5));
  return makeInventoryItem({
    id: `INV-${it.code}`,
    name: it.name,
    category: it.category,
    uom: it.uom,
    reorder: Math.max(5, Math.floor(stock / 3)),
    storage: storageForItem(it),
    batches: [
      {
        batchNo: `${lotCode}-A`,
        expiry: addDays(today, Math.floor(life * 0.4)),
        qty: split,
        costPrice: cost,
        receivedOn: addDays(today, -30),
        binLocation: `${prefix}${aisleNum}-R${rackNum}-S1`,
      },
      {
        batchNo: `${lotCode}-B`,
        expiry: addDays(today, life),
        qty: stock - split,
        costPrice: Math.round(cost * 1.04),
        receivedOn: addDays(today, -5),
        binLocation: `${prefix}${aisleNum}-R${rackNum}-S2`,
      },
    ],
  });
}

/**
 * Final Stock Overview list: every active Item Profile entry, with curated
 * SEED_INVENTORY taking precedence (by name) over auto-generated rows.
 */
export const inventory: InventoryItem[] = (() => {
  const seededNames = new Set(SEED_INVENTORY.map((s) => s.name.toLowerCase()));
  const generated = activeItems
    .filter((it) => !seededNames.has(it.name.toLowerCase()))
    .map(generateInventoryItem);
  return [...SEED_INVENTORY, ...generated];
})();

/** Item Profile lookup by inventory row (matches by name first, then `INV-{code}` id). */
export function findItemProfileFor(inv: InventoryItem): ItemMaster | undefined {
  return (
    items.find((m) => `INV-${m.code}` === inv.id) ??
    items.find((m) => m.name === inv.name)
  );
}

/** Sub-selectors used by the inventory sub-modules. */
export const rawMaterialInventory = (): InventoryItem[] =>
  inventory.filter((inv) => {
    const m = findItemProfileFor(inv);
    return m ? m.itemType === "Raw Material" : true;
  });

export const finishedGoodsInventory = (): InventoryItem[] =>
  inventory.filter((inv) => {
    const m = findItemProfileFor(inv);
    return m ? (m.itemType === "Finished Good" || m.itemType === "Semi-Finished Good") : false;
  });

/** All batches across all items, flattened (for Batch/Lot Tracking & Expiry). */
export type FlatBatch = BatchLot & {
  itemId: string;
  itemCode: string;
  itemName: string;
  category: string;
  uom: string;
  storage: string;
};
export function allBatches(): FlatBatch[] {
  const rows: FlatBatch[] = [];
  for (const inv of inventory) {
    const profile = findItemProfileFor(inv);
    for (const b of inv.batches) {
      rows.push({
        ...b,
        itemId: inv.id,
        itemCode: profile?.code ?? inv.id,
        itemName: inv.name,
        category: inv.category,
        uom: inv.uom,
        storage: inv.storage,
      });
    }
  }
  return rows;
}

// ── Org hierarchy: Company → Office → Warehouse ─────────────────────────────

export type Company = {
  id: string;
  code: string;
  name: string;
  status: "Active" | "Inactive";
};

export type Office = {
  id: string;
  code: string;
  name: string;
  companyId: string;
  address: string;
  city: string;
  manager: string;
  phone: string;
  status: "Active" | "Inactive";
};

export type WarehouseType = "Warehouse" | "Cold Store" | "Kitchen";

export type Warehouse = {
  id: string;
  code: string;
  name: string;
  officeId: string;
  type: WarehouseType;
  address: string;
  city: string;
  manager: string;
  phone: string;
  status: "Active" | "Inactive";
};

export const companies: Company[] = [
  { id: "CMP-001", code: "USB-CAT", name: "US-Bangla Catering",   status: "Active" },
  { id: "CMP-002", code: "USB-AIR", name: "US-Bangla Airlines Ltd.", status: "Active" },
];

export const offices: Office[] = [
  { id: "OFF-001", code: "HQ-DAC",  name: "Head Office Dhaka",         companyId: "CMP-001", address: "Madina Bhaban, Turag",   city: "Dhaka",       manager: "R. Hossain", phone: "+880 1700-000001", status: "Active" },
  { id: "OFF-002", code: "REG-CGP", name: "Chittagong Regional Office", companyId: "CMP-001", address: "GEC Circle, Chattogram", city: "Chittagong",  manager: "A. Khan",    phone: "+880 1700-000010", status: "Active" },
  { id: "OFF-003", code: "REG-CXB", name: "Cox's Bazar Station Office", companyId: "CMP-001", address: "Cox's Bazar Airport",    city: "Cox's Bazar", manager: "—",         phone: "—",                status: "Inactive" },
];

export const warehouses: Warehouse[] = [
  { id: "WH-001", code: "WH-DAC-01", name: "Central Warehouse",         officeId: "OFF-001", type: "Warehouse",  address: "Hazrat Shahjalal Cargo",  city: "Dhaka",       manager: "S. Ahmed",  phone: "+880 1700-000002", status: "Active" },
  { id: "WH-002", code: "CS-DAC-01", name: "Cold Storage 1",            officeId: "OFF-001", type: "Cold Store", address: "Catering Block B Annex",  city: "Dhaka",       manager: "M. Karim",  phone: "+880 1700-000005", status: "Active" },
  { id: "WH-003", code: "KIT-HOT",   name: "Hot Kitchen",                officeId: "OFF-001", type: "Kitchen",    address: "Catering Block A",        city: "Dhaka",       manager: "F. Begum",  phone: "+880 1700-000003", status: "Active" },
  { id: "WH-004", code: "KIT-COLD",  name: "Cold Kitchen",               officeId: "OFF-001", type: "Kitchen",    address: "Catering Block B",        city: "Dhaka",       manager: "T. Islam",  phone: "+880 1700-000004", status: "Active" },
  { id: "WH-005", code: "WH-CXB-01", name: "Regional Warehouse CXB",     officeId: "OFF-003", type: "Warehouse",  address: "Cox's Bazar Airport",     city: "Cox's Bazar", manager: "—",         phone: "—",                status: "Inactive" },
];

// ── Airlines (customers we cater for) ────────────────────────────────────────
// Separate from Office — Office is OUR location, Airline is who we serve.
export type Airline = {
  id: string;
  code: string;        // short code (e.g. USB, ASTRA)
  iata: string;        // 2-char IATA flight prefix (e.g. BS, 2A)
  name: string;
  country: string;
  status: "Active" | "Inactive";
};

export const airlines: Airline[] = [
  { id: "AIR-001", code: "USB",   iata: "BS", name: "US-Bangla Airlines", country: "Bangladesh", status: "Active" },
  { id: "AIR-002", code: "ASTRA", iata: "2A", name: "Air Astra",          country: "Bangladesh", status: "Active" },
];

export const activeAirlines = airlines.filter((a) => a.status === "Active");
export const activeOffices   = offices.filter((o) => o.status === "Active");
export const activeWarehouses = warehouses.filter((w) => w.status === "Active");

export const warehousesByOffice = (officeId: string) =>
  warehouses.filter((w) => w.officeId === officeId);
export const activeWarehousesByOffice = (officeId: string) =>
  activeWarehouses.filter((w) => w.officeId === officeId);
