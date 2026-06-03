import {
  seedFlightOrders, inventory, purchaseOrders, dispatch, productionOrders, qcChecks,
  mealOrders, billOfMaterials, demandRequests, requisitions, receiveItems, vendors,
  hygieneChecks, cookingTempLogs, consumableItems, consumableUsage,
  equipmentAssets, equipmentReturns, damageReports, assets,
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
  // ── Operations ─────────────────────────────────────────────────────────────
  {
    key: "flight-orders",
    label: "Flight Orders",
    route: "/order-management",
    columns: [
      col("orderNo", "Order"),
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
    key: "meal-orders",
    label: "Meal Orders",
    route: "/meal-planning",
    columns: [
      col("id", "Order"),
      col("date", "Date"),
      col("flight", "Flight"),
      col("serviceGroup", "Service Group"),
      col("menuStandard", "Menu Standard"),
      col("mealType", "Meal Type"),
      col("items", "Items"),
      col("calories", "Calories"),
      col("status", "Status"),
    ],
    rows: () => mealOrders as unknown as Record<string, unknown>[],
  },

  // ── Production ───────────────────────────────────────────────────────────────
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
    key: "bom",
    label: "Bill of Materials",
    route: "/bom",
    columns: [
      col("id", "BOM ID"),
      col("name", "Recipe / Product"),
      col("components", "Components"),
      col("version", "Version"),
      col("yield", "Yield"),
      col("status", "Status"),
      col("lastUpdated", "Last Updated"),
    ],
    rows: () => billOfMaterials as unknown as Record<string, unknown>[],
  },

  // ── Inventory & Store ────────────────────────────────────────────────────────
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
    key: "demand-requests",
    label: "Demand Requests",
    route: "/demand-orders",
    columns: [
      col("id", "Request"),
      col("reference", "Reference"),
      col("requestedBy", "Requested By"),
      col("role", "Role"),
      col("date", "Date"),
      col("items", "Items", (r) => (Array.isArray(r.items) ? r.items.length : r.items)),
      col("status", "Status"),
    ],
    rows: () => demandRequests as unknown as Record<string, unknown>[],
  },

  // ── Supply Chain ─────────────────────────────────────────────────────────────
  {
    key: "requisitions",
    label: "Purchase Requisitions",
    route: "/purchase-requisition",
    columns: [
      col("id", "Requisition"),
      col("source", "Source"),
      col("reference", "Reference"),
      col("items", "Items"),
      col("requestedBy", "Requested By"),
      col("date", "Date"),
      col("status", "Status"),
    ],
    rows: () => requisitions as unknown as Record<string, unknown>[],
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
    key: "receive-items",
    label: "Receive Items (GRN)",
    route: "/receive-item",
    columns: [
      col("id", "GRN #"),
      col("po", "PO #"),
      col("vendor", "Vendor"),
      col("item", "Item"),
      col("qty", "Qty"),
      col("uom", "UOM"),
      col("temp", "Temp"),
      col("expiry", "Expiry"),
      col("receivedBy", "Received By"),
      col("status", "Status"),
    ],
    rows: () => receiveItems as unknown as Record<string, unknown>[],
  },

  // ── Food Safety & QC ─────────────────────────────────────────────────────────
  {
    key: "hygiene",
    label: "Hygiene Checks",
    route: "/hygiene-monitoring",
    columns: [
      col("id", "Check ID"),
      col("time", "Time"),
      col("activity", "Activity"),
      col("status", "Status"),
      col("remarks", "Remarks"),
    ],
    rows: () => hygieneChecks as unknown as Record<string, unknown>[],
  },
  {
    key: "cooking-temp",
    label: "Cooking Temp Logs",
    route: "/cooking-temp",
    columns: [
      col("id", "Log ID"),
      col("batch", "Batch"),
      col("item", "Item"),
      col("cookingTime", "Cooking Time"),
      col("standardTemp", "Standard Temp"),
      col("measuredTemp", "Measured °C"),
      col("cookedBy", "Cooked By"),
      col("sensoryPass", "Sensory", (r) => (r.sensoryPass ? "Pass" : "Fail")),
      col("checkedBy", "Checked By"),
    ],
    rows: () => cookingTempLogs as unknown as Record<string, unknown>[],
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

  // ── Packaging & Dispatch ─────────────────────────────────────────────────────
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

  // ── Airline Consumables ──────────────────────────────────────────────────────
  {
    key: "consumables",
    label: "Consumable Stock",
    route: "/airline-consumables",
    columns: [
      col("id", "Item ID"),
      col("name", "Item"),
      col("category", "Category"),
      col("uom", "UOM"),
      col("stock", "Stock"),
      col("reorder", "Reorder Level"),
      col("unitCost", "Unit Cost"),
      col("binLocation", "Bin"),
      col("status", "Status"),
    ],
    rows: () => consumableItems as unknown as Record<string, unknown>[],
  },
  {
    key: "consumable-usage",
    label: "Consumable Usage",
    route: "/consumable-usage",
    columns: [
      col("id", "Usage ID"),
      col("date", "Date"),
      col("flight", "Flight"),
      col("sector", "Sector"),
      col("cabinClass", "Class"),
      col("itemName", "Item"),
      col("qty", "Qty"),
      col("uom", "UOM"),
    ],
    rows: () => consumableUsage as unknown as Record<string, unknown>[],
  },

  // ── Airline Equipments ───────────────────────────────────────────────────────
  {
    key: "equipment-assets",
    label: "Equipment Assets",
    route: "/airline-equipments",
    columns: [
      col("id", "Asset ID"),
      col("name", "Asset"),
      col("category", "Category"),
      col("serialNo", "Serial No"),
      col("location", "Location"),
      col("lastMaintenance", "Last Maint."),
      col("nextMaintenance", "Next Maint."),
      col("status", "Status"),
    ],
    rows: () => equipmentAssets as unknown as Record<string, unknown>[],
  },
  {
    key: "equipment-returns",
    label: "Equipment Returns",
    route: "/equipment-returns",
    columns: [
      col("id", "Return ID"),
      col("date", "Date"),
      col("flight", "Flight"),
      col("assetName", "Asset"),
      col("returnedBy", "Returned By"),
      col("condition", "Condition"),
      col("remarks", "Remarks"),
    ],
    rows: () => equipmentReturns as unknown as Record<string, unknown>[],
  },
  {
    key: "equipment-damage",
    label: "Damage Reports",
    route: "/equipment-damage",
    columns: [
      col("id", "Report ID"),
      col("date", "Date"),
      col("assetName", "Asset"),
      col("severity", "Severity"),
      col("reportedBy", "Reported By"),
      col("description", "Description"),
      col("status", "Status"),
    ],
    rows: () => damageReports as unknown as Record<string, unknown>[],
  },

  // ── Maintenance & Assets ─────────────────────────────────────────────────────
  {
    key: "maintenance-assets",
    label: "Maintenance Assets",
    route: "/maintenance",
    columns: [
      col("id", "Asset ID"),
      col("name", "Asset"),
      col("type", "Type"),
      col("location", "Location"),
      col("lastSvc", "Last Service"),
      col("nextSvc", "Next Service"),
      col("status", "Status"),
    ],
    rows: () => assets as unknown as Record<string, unknown>[],
  },

  // ── Configuration ────────────────────────────────────────────────────────────
  {
    key: "suppliers",
    label: "Suppliers / Vendors",
    route: "/config-supplier",
    columns: [
      col("id", "Vendor ID"),
      col("name", "Supplier"),
      col("category", "Category"),
      col("rating", "Rating"),
      col("orders", "Orders"),
      col("onTime", "On-Time %"),
    ],
    rows: () => vendors as unknown as Record<string, unknown>[],
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
