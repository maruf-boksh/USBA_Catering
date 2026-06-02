import {
  seedFlightOrders, inventory, purchaseOrders, dispatch, productionOrders, qcChecks,
} from "./sample-data";
import { registerElements, columnElementId } from "./access-control";

// ─────────────────────────────────────────────────────────────────────────────
// Report datasets — the data sources the Report Builder can report on. Each
// dataset maps to a page `route` so its columns share the SAME RBAC element ids
// as that page's table (col:<key>). Registering them here means:
//   • the columns appear in User Access Control (manageable per role), and
//   • the Report Builder only offers columns the selected role may view.
// Add a dataset here and it becomes reportable + permissioned automatically.
// ─────────────────────────────────────────────────────────────────────────────

export type ReportColumn = {
  key: string;
  label: string;
  get: (row: Record<string, unknown>) => string | number;
};

export type ReportDataset = {
  key: string;
  label: string;
  route: string;       // owning page → RBAC element scope
  columns: ReportColumn[];
  rows: () => Record<string, unknown>[];
};

const col = (key: string, label: string, get?: (r: Record<string, unknown>) => unknown): ReportColumn => ({
  key,
  label,
  get: (r) => {
    const v = get ? get(r) : r[key];
    return v == null ? "" : (typeof v === "number" ? v : String(v));
  },
});

export const REPORT_DATASETS: ReportDataset[] = [
  {
    key: "flight-orders",
    label: "Flight Orders",
    route: "/order-management",
    columns: [
      col("orderNo", "Order #"),
      col("flight", "Flight"),
      col("airline", "Airline"),
      col("sector", "Sector"),
      col("date", "Date"),
      col("etd", "ETD"),
      col("pax", "PAX"),
      col("crew", "Crew"),
      col("spec-meals", "Special Meals", (r) => r["specialMeals"]),
      col("status", "Status"),
      col("direction", "Direction"),
    ],
    rows: () => seedFlightOrders as unknown as Record<string, unknown>[],
  },
  {
    key: "inventory",
    label: "Inventory / Stock",
    route: "/inventory",
    columns: [
      col("id", "Item ID"),
      col("name", "Item"),
      col("category", "Category"),
      col("uom", "UOM"),
      col("stock", "Stock"),
      col("reorder", "Reorder Level"),
      col("expiry", "Earliest Expiry"),
      col("storage", "Storage"),
      col("status", "Status"),
    ],
    rows: () => inventory as unknown as Record<string, unknown>[],
  },
  {
    key: "purchase-orders",
    label: "Purchase Orders",
    route: "/procurement",
    columns: [
      col("id", "PO #"),
      col("vendor", "Vendor"),
      col("items", "Items"),
      col("amount", "Amount"),
      col("date", "Date"),
      col("status", "Status"),
    ],
    rows: () => purchaseOrders as unknown as Record<string, unknown>[],
  },
  {
    key: "production",
    label: "Production Orders",
    route: "/production-entry",
    columns: [
      col("id", "Order ID"),
      col("flight", "Flight"),
      col("meal", "Meal"),
      col("qty", "Qty"),
      col("section", "Section"),
      col("status", "Status"),
      col("progress", "Progress %"),
    ],
    rows: () => productionOrders as unknown as Record<string, unknown>[],
  },
  {
    key: "dispatch",
    label: "Dispatch",
    route: "/dispatch",
    columns: [
      col("id", "Dispatch #"),
      col("flight", "Flight"),
      col("trays", "Trays"),
      col("carts", "Carts"),
      col("vehicle", "Vehicle"),
      col("driver", "Driver"),
      col("status", "Status"),
    ],
    rows: () => dispatch as unknown as Record<string, unknown>[],
  },
  {
    key: "qc",
    label: "QC Checks",
    route: "/cooking-temp",
    columns: [
      col("id", "Check ID"),
      col("flight", "Flight"),
      col("batch", "Batch"),
      col("parameter", "Parameter"),
      col("value", "Value"),
      col("limit", "Limit"),
      col("result", "Result"),
      col("inspector", "Inspector"),
    ],
    rows: () => qcChecks as unknown as Record<string, unknown>[],
  },
];

// Register every dataset column as an RBAC element on its owning route, so they
// show in User Access Control and the Report Builder respects role permissions.
for (const ds of REPORT_DATASETS) {
  registerElements(
    ds.route,
    ds.columns.map((c) => ({ id: columnElementId(c.key), label: `${c.label} column`, kind: "column" as const })),
  );
}

export function getDataset(key: string): ReportDataset | undefined {
  return REPORT_DATASETS.find((d) => d.key === key);
}
