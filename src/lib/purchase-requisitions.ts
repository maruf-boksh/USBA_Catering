// Single source of truth for Purchase Requisition records. The Purchase
// Requisition screen (routes/purchase-requisition.tsx) seeds + edits this shape;
// other modules (e.g. the RFQ "PR Reference" picker) read the list via
// `getPurchaseRequisitions()` so they stay in sync with the PR table.

export type PRLineItem = {
  id: string;
  itemName: string;
  description: string;
  qty: number;
  uom: string;
  rate: number;
};

export type Priority = "Normal" | "Urgent";

export type PurchaseRequisition = {
  id: string;
  date: string;
  officeId: string;
  warehouseId: string;
  requestedBy: string;
  requiredBy: string;
  priority: Priority;
  justification: string;
  lines: PRLineItem[];
  status: string;
  totalAmount: number;
};

export const seedRequisitions: PurchaseRequisition[] = [
  {
    id: "PR-2026-005", date: "2026-05-18", officeId: "OFF-001", warehouseId: "WH-003",
    requestedBy: "S. Ahmed",
    requiredBy: "2026-05-22", priority: "Normal", justification: "Weekly stock replenishment for hot kitchen line.",
    lines: [
      { id: "L1", itemName: "Basmati Rice",   description: "Premium long grain", qty: 200, uom: "Kg",    rate: 120 },
      { id: "L2", itemName: "Chicken",        description: "Whole, cleaned",     qty: 150, uom: "Kg",    rate: 280 },
      { id: "L3", itemName: "Cooking Oil",    description: "Soyabean refined",   qty: 60,  uom: "Litre", rate: 175 },
    ],
    status: "Approved", totalAmount: 76500,
  },
  {
    id: "PR-2026-004", date: "2026-05-17", officeId: "OFF-001", warehouseId: "WH-001",
    requestedBy: "M. Hossain",
    requiredBy: "2026-05-21", priority: "Normal", justification: "Production run for the next 4 days.",
    lines: [
      { id: "L1", itemName: "All-Purpose Flour", description: "10kg bag",    qty: 25, uom: "Box",   rate: 1200 },
      { id: "L2", itemName: "Butter",            description: "Unsalted",    qty: 30, uom: "Kg",    rate: 950  },
      { id: "L3", itemName: "Yeast",             description: "Active dry",  qty: 8,  uom: "Pack",  rate: 320  },
    ],
    status: "Pending Approval", totalAmount: 61060,
  },
  {
    id: "PR-2026-003", date: "2026-05-15", officeId: "OFF-001", warehouseId: "WH-004",
    requestedBy: "F. Begum",
    requiredBy: "2026-05-19", priority: "Urgent", justification: "Salmon stock fell below reorder level after weekend rush.",
    lines: [
      { id: "L1", itemName: "Salmon Fillet", description: "Frozen, premium grade", qty: 40, uom: "Kg",  rate: 1400 },
      { id: "L2", itemName: "Lemon",         description: "Fresh",                 qty: 20, uom: "Kg",  rate: 60   },
      { id: "L3", itemName: "Olive Oil",     description: "Extra virgin",          qty: 10, uom: "Litre", rate: 850 },
    ],
    status: "Approved", totalAmount: 65700,
  },
  {
    id: "PR-2026-002", date: "2026-05-12", officeId: "OFF-001", warehouseId: "WH-002",
    requestedBy: "A. Khan",
    requiredBy: "2026-05-18", priority: "Normal", justification: "Replenish beverage stock for international flights.",
    lines: [
      { id: "L1", itemName: "Mineral Water",      description: "500ml",     qty: 50,  uom: "Box",    rate: 480 },
      { id: "L2", itemName: "Orange Juice",       description: "1L tetra",  qty: 30,  uom: "Box",    rate: 720 },
      { id: "L3", itemName: "Disposable Cup",     description: "8oz paper", qty: 100, uom: "Pack",   rate: 95  },
    ],
    status: "Closed", totalAmount: 55100,
  },
  {
    id: "PR-2026-001", date: "2026-05-10", officeId: "OFF-001", warehouseId: "WH-001",
    requestedBy: "N. Hasan",
    requiredBy: "2026-05-25", priority: "Normal", justification: "Quarterly maintenance consumables.",
    lines: [
      { id: "L1", itemName: "Industrial Detergent", description: "5L jar",      qty: 12, uom: "Bottle", rate: 650 },
      { id: "L2", itemName: "Gas Cylinder",         description: "Commercial",  qty: 4,  uom: "Unit",   rate: 2400 },
    ],
    status: "Draft", totalAmount: 17400,
  },
];

// Mirror of the key used by usePersistedState in routes/purchase-requisition.tsx
// so reads here reflect PRs created / edited at runtime, not just the seed.
const STORAGE_KEY = "harvest-data-v1:purchase-requisitions";

/** All purchase requisitions (persisted if present, else seed). */
export function getPurchaseRequisitions(): PurchaseRequisition[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw != null) return JSON.parse(raw) as PurchaseRequisition[];
  } catch {
    /* unavailable / corrupt — fall through to seed */
  }
  return seedRequisitions;
}
