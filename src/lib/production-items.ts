// Curated, hand-tuned per-portion recipes for the core finished goods.
//
// Moved out of `production-entry.tsx` so the meal-plan recipe resolver
// (`meal-recipe.ts`) can import this catalog without creating an import cycle
// (production-entry → meal-recipe → production-items, a clean leaf).
//
// `production-entry.tsx` re-exports these symbols for backwards compatibility.

export type RecipeItem = {
  itemCode: string;
  itemName: string;
  uom: string;
  qtyPerUnit: number;
  rate: number;
};

export type ProductionItem = {
  code: string;
  name: string;
  rawMaterials: RecipeItem[];
  packagingMaterials: RecipeItem[];
  otherConsumption: RecipeItem[];
};

export const PRODUCTION_ITEMS: ProductionItem[] = [
  {
    code: "FG-001",
    name: "Chicken Biryani",
    rawMaterials: [
      { itemCode: "RM-001", itemName: "Basmati Rice",    uom: "Kg",    qtyPerUnit: 0.180, rate: 120 },
      { itemCode: "RM-002", itemName: "Chicken",         uom: "Kg",    qtyPerUnit: 0.120, rate: 280 },
      { itemCode: "RM-003", itemName: "Onion",           uom: "Kg",    qtyPerUnit: 0.040, rate: 60  },
      { itemCode: "RM-004", itemName: "Spice Mix",       uom: "Kg",    qtyPerUnit: 0.010, rate: 850 },
      { itemCode: "RM-005", itemName: "Cooking Oil",     uom: "Litre", qtyPerUnit: 0.020, rate: 175 },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.050, rate: 85 },
      { itemCode: "OC-002", itemName: "Disposable Glove", uom: "Pair", qtyPerUnit: 0.10, rate: 4  },
    ],
  },
  {
    code: "FG-002",
    name: "Veg Pulao",
    rawMaterials: [
      { itemCode: "RM-001", itemName: "Basmati Rice",    uom: "Kg",    qtyPerUnit: 0.180, rate: 120 },
      { itemCode: "RM-006", itemName: "Mixed Vegetable", uom: "Kg",    qtyPerUnit: 0.100, rate: 70  },
      { itemCode: "RM-005", itemName: "Cooking Oil",     uom: "Litre", qtyPerUnit: 0.020, rate: 175 },
      { itemCode: "RM-004", itemName: "Spice Mix",       uom: "Kg",    qtyPerUnit: 0.008, rate: 850 },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.040, rate: 85 },
    ],
  },
  {
    code: "FG-003",
    name: "Continental Breakfast",
    rawMaterials: [
      { itemCode: "RM-007", itemName: "Bread Loaf",      uom: "Pcs", qtyPerUnit: 0.25, rate: 30  },
      { itemCode: "RM-008", itemName: "Egg",             uom: "Pcs", qtyPerUnit: 1.0,  rate: 11  },
      { itemCode: "RM-009", itemName: "Butter",          uom: "Kg",  qtyPerUnit: 0.015, rate: 950 },
      { itemCode: "RM-010", itemName: "Sausage",         uom: "Pcs", qtyPerUnit: 2.0,  rate: 22  },
    ],
    packagingMaterials: [
      { itemCode: "PKG-003", itemName: "Breakfast Box",  uom: "Pcs", qtyPerUnit: 1, rate: 18 },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.025, rate: 85 },
    ],
  },
  {
    code: "FG-004",
    name: "Grilled Salmon",
    rawMaterials: [
      { itemCode: "RM-011", itemName: "Salmon Fillet",   uom: "Kg",    qtyPerUnit: 0.140, rate: 1400 },
      { itemCode: "RM-012", itemName: "Lemon",           uom: "Pcs",   qtyPerUnit: 0.25,  rate: 8    },
      { itemCode: "RM-005", itemName: "Cooking Oil",     uom: "Litre", qtyPerUnit: 0.015, rate: 175  },
      { itemCode: "RM-004", itemName: "Spice Mix",       uom: "Kg",    qtyPerUnit: 0.008, rate: 850  },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.035, rate: 85 },
    ],
  },

  // ── Meal-plan items (Wednesday Breakfast menu) ───────────────────────────
  // Recipes for the menu items raised by the bulk "Create All Orders" flow on
  // the Meal Planning Details dialog, so MRP can compute on-hand vs shortfall
  // and the resulting Demand Request actually carries materials.
  {
    code: "FG-PRT",
    name: "Paratha",
    rawMaterials: [
      { itemCode: "RM-013", itemName: "Wheat Flour",     uom: "Kg",    qtyPerUnit: 0.060, rate: 88  },
      { itemCode: "RM-005", itemName: "Cooking Oil",     uom: "Litre", qtyPerUnit: 0.012, rate: 175 },
      { itemCode: "RM-017", itemName: "Salt",            uom: "Kg",    qtyPerUnit: 0.001, rate: 35  },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.015, rate: 85 },
    ],
  },
  {
    code: "FG-CHM",
    name: "Channa Masala",
    rawMaterials: [
      { itemCode: "RM-014", itemName: "Chickpeas",       uom: "Kg",    qtyPerUnit: 0.060, rate: 110 },
      { itemCode: "RM-003", itemName: "Onion",           uom: "Kg",    qtyPerUnit: 0.025, rate: 60  },
      { itemCode: "RM-015", itemName: "Tomato",          uom: "Kg",    qtyPerUnit: 0.030, rate: 58  },
      { itemCode: "RM-005", itemName: "Cooking Oil",     uom: "Litre", qtyPerUnit: 0.012, rate: 175 },
      { itemCode: "RM-004", itemName: "Spice Mix",       uom: "Kg",    qtyPerUnit: 0.004, rate: 850 },
      { itemCode: "RM-017", itemName: "Salt",            uom: "Kg",    qtyPerUnit: 0.001, rate: 35  },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.020, rate: 85 },
    ],
  },
  {
    code: "FG-BEG",
    name: "Boiled Egg",
    rawMaterials: [
      { itemCode: "RM-008", itemName: "Egg",             uom: "Pcs", qtyPerUnit: 1,     rate: 11 },
      { itemCode: "RM-017", itemName: "Salt",            uom: "Kg",  qtyPerUnit: 0.001, rate: 35 },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.010, rate: 85 },
    ],
  },
  {
    code: "FG-VSW",
    name: "Vegetable Sandwich",
    rawMaterials: [
      { itemCode: "RM-007", itemName: "Bread Loaf",      uom: "Pcs", qtyPerUnit: 0.40,  rate: 30  },
      { itemCode: "RM-006", itemName: "Mixed Vegetable", uom: "Kg",  qtyPerUnit: 0.045, rate: 70  },
      { itemCode: "RM-009", itemName: "Butter",          uom: "Kg",  qtyPerUnit: 0.010, rate: 950 },
      { itemCode: "RM-017", itemName: "Salt",            uom: "Kg",  qtyPerUnit: 0.0005,rate: 35  },
    ],
    packagingMaterials: [
      { itemCode: "PKG-003", itemName: "Breakfast Box",  uom: "Pcs", qtyPerUnit: 1, rate: 18 },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas",     uom: "Kg",  qtyPerUnit: 0.005, rate: 85 },
    ],
  },
  {
    code: "FG-FRS",
    name: "Fruit Salad",
    rawMaterials: [
      { itemCode: "RM-016", itemName: "Mixed Fruits",    uom: "Kg",  qtyPerUnit: 0.080, rate: 120 },
    ],
    packagingMaterials: [
      { itemCode: "PKG-001", itemName: "Aluminum Tray",  uom: "Pcs", qtyPerUnit: 1, rate: 12 },
      { itemCode: "PKG-002", itemName: "Lid Foil",       uom: "Pcs", qtyPerUnit: 1, rate: 3  },
    ],
    otherConsumption: [
      { itemCode: "OC-002", itemName: "Disposable Glove",uom: "Pair", qtyPerUnit: 0.05, rate: 4 },
    ],
  },
];
