// Galley Handing/Taking sheet — canonical catalog of every line item.
//
// Dependency-free (imported by both sample-data.ts and galley-items.ts, so it
// must not import either — avoids a cycle). This defines the *structure* of the
// sheet: which items exist, their tab group, section, unit, subtotal rollup,
// and whether they are a physical stock line.
//
// Physical stock lines (`stock: true` — Beverages / Amenities / Equipment) are
// seeded into the airline-consumables inventory store and the galley plan reads
// them from there, so those tabs are driven by inventory data, not hardcoded.
// Meal-summary and auto-subtotal lines are computed (not inventory).

export type GalleyItemGroup = "Meals" | "Beverages" | "Amenities" | "Equipment";

export type GalleyCatalogDef = {
  key: string;
  label: string;
  unit?: string;
  group: GalleyItemGroup;
  section: string;
  /** Physical stock line — lives in the consumables inventory. */
  stock?: boolean;
  /** Key of the auto subtotal this line rolls into. */
  rollupTo?: string;
  /** Computed subtotal (read-only, summed from its rollup members). */
  auto?: boolean;
  /** Default unit cost (৳) when seeding the inventory record. */
  unitCost?: number;
};

// Helper: build a section's worth of defs. Meals sections are computed
// (stock:false); the flag is set per-section below.
const S = (
  section: string, group: GalleyItemGroup, stock: boolean,
  fields: [key: string, label: string, unit?: string, unitCost?: number][],
): GalleyCatalogDef[] =>
  fields.map(([key, label, unit, unitCost]) => ({ key, label, unit, group, section, stock, unitCost }));

const ROLLUP_TO: Record<string, string> = {
  coke225: "totalColdBev", pepsi225: "totalColdBev", sprite225: "totalColdBev", sevenUp225: "totalColdBev",
  cokeCanBC: "totalCanBC", spriteCanBC: "totalCanBC", dietCanBC: "totalCanBC",
  appleJuice1L: "totalJuice", mangoJuice1L: "totalJuice", orangeJuice1L: "totalJuice",
};
const AUTO_KEYS = new Set(["totalColdBev", "totalCanBC", "totalJuice"]);

export const GALLEY_CATALOG: GalleyCatalogDef[] = [
  // ── Meals (computed / integrated from Dispatch — not stock) ────────────────
  ...S("Meal Load Summary", "Meals", false, [
    ["depMealLoad", "Departure Meal Load"], ["arrMealLoad", "Arrival Meal Load"],
    ["depCockpit", "Cockpit Crew (Dep)"], ["depCabin", "Cabin Crew (Dep)"],
    ["arrCockpit", "Cockpit Crew (Arr)"], ["arrCabin", "Cabin Crew (Arr)"],
    ["depChildMeal", "Child Meal (Dep)"], ["arrChildMeal", "Child Meal (Arr)"],
    ["extHotMeal", "Extra Hot Meal"], ["totalMealLoad", "Total Meal Load"],
  ]),
  ...S("Departure Meals", "Meals", false, [
    ["depChicken", "Chicken"], ["depBeef", "Beef"], ["depVeg", "Vegetarian"],
    ["depChilled", "Chilled"], ["depDiabetic", "Diabetic"], ["depBreakfast", "Breakfast"],
    ["totalDepMeal", "Total Departure Meal"],
  ]),
  ...S("Arrival Meals", "Meals", false, [
    ["arrChicken", "Chicken"], ["arrBeef", "Beef"], ["arrVeg", "Vegetarian"],
    ["arrChilled", "Chilled"], ["arrDiabetic", "Diabetic"],
    ["totalArrMeal", "Total Arrival Meal"],
  ]),
  ...S("Crew Meals & Snacks", "Meals", false, [
    ["crewBreakfast", "Crew Breakfast"], ["crewLunch", "Crew Lunch"],
    ["crewAppetizer", "Crew Appetizer"], ["crewLightSnacks", "Light Snacks"],
    ["crewDessert", "Crew Dessert"], ["crewExtraLunchVeg", "Extra Lunch (Veg)"],
    ["crewButterJam", "Butter & Jam"],
  ]),
  ...S("Tray Setup & Service", "Meals", false, [
    ["traySetupDepEY", "Tray Setup Dep (EY)"], ["traySetupArrEY", "Tray Setup Arr (EY)"],
    ["totalSalad", "Total Salad"], ["totalFirni", "Total Firni"], ["totalCutlery", "Total Cutlery"],
  ]),
  // ── Beverages (stock) ──────────────────────────────────────────────────────
  ...S("Hot & Cold Beverage", "Beverages", true, [
    ["coke225", "Coke 2.25 Ltr", "btl", 180], ["pepsi225", "Pepsi 2.25 Ltr", "btl", 180],
    ["sprite225", "Sprite 2.25 Ltr", "btl", 180], ["sevenUp225", "7 UP 2.25 Ltr", "btl", 180],
    ["totalColdBev", "Total Cold Beverage"],
    ["cokeCanBC", "Coke Can 250ml (BC & Crew)", "cans", 45], ["spriteCanBC", "Sprite Can 250ml (BC & Crew)", "cans", 45],
    ["dietCanBC", "Diet Can 250ml (BC & Crew)", "cans", 50], ["totalCanBC", "Total Cans"],
    ["water250Pax", "Water 250ml (Passenger 1:2)", "btls", 12], ["water500Crew", "Water 500ml (Crew)", "btls", 18],
    ["appleJuice1L", "Apple Juice 1 Ltr", "btl", 150], ["mangoJuice1L", "Mango Juice 1 Ltr", "btl", 150],
    ["orangeJuice1L", "Orange Juice 1 Ltr", "btl", 150], ["totalJuice", "Total Juice 1 Ltr"],
  ]),
  ...S("Tea, Coffee & Others", "Beverages", true, [
    ["coffee50g", "Coffee (Per Btl 50g)", "btl", 320], ["coffeeMate400g", "Coffee Mate 400g", "btl", 480],
    ["teaBag50pcs", "Tea Bag (Box 50 pcs)", "box", 260], ["greenTea", "Green Tea", "pcs", 6],
    ["zeroCal", "Zero Cal", "pcs", 4], ["milkPowder", "Milk Powder", "kg", 720],
    ["sugar", "Sugar", "kg", 110], ["paperCup", "Paper Cup", "pcs", 1.8],
    ["saltPkt", "Salt PKT", "pcs", 0.5], ["pepperPkt", "Pepper PKT", "pcs", 0.5],
    ["teaPot", "Tea Pot", "pcs", 220], ["disposableSpoon", "Disposable Spoon", "pcs", 0.7],
    ["extraCottage", "Extra Cottage", "pcs", 3], ["sanitizerBtl", "Sanitizer BTL", "btl", 140],
  ]),
  ...S("Beverages — BC / Lounge", "Beverages", true, [
    ["soda", "Soda", "btl", 90], ["lemon", "Lemoned", "pcs", 12],
    ["ginger", "Ginger", "pcs", 15], ["tonic", "Tonic", "btl", 95],
  ]),
  // ── Amenities (stock) ──────────────────────────────────────────────────────
  ...S("Tissues & Napkins", "Amenities", true, [
    ["wetTissue", "Wet Tissue", "pcs", 2.5], ["napkinPaper", "Napkin Paper", "pkts", 35],
    ["facialTissue", "Facial Tissue", "box", 60], ["kitchenTowel", "Kitchen Towel", "pcs", 40],
    ["babyWipes", "Baby Wipes", "pcs", 3],
  ]),
  ...S("Bedding & Covers", "Amenities", true, [
    ["blanket", "Blanket", "pcs", 320], ["headRestCover", "Head Rest Cover", "pcs", 8],
    ["pillowCoverSmall", "Pillow Cover (Small)", "pcs", 12], ["pillowCoverBig", "Pillow Cover (Big)", "pcs", 15],
  ]),
  ...S("Hygiene & Cleaning", "Amenities", true, [
    ["handWash", "Hand Wash", "btl", 90], ["toiletRoll", "Toilet Roll", "pcs", 25],
    ["aerosol", "Aerosol", "pcs", 180], ["celeste", "Celeste", "pcs", 160],
    ["airFreshener", "Air Freshener", "pcs", 150], ["surgicalGloves", "Surgical Gloves", "pairs", 6],
    ["ovenGloves", "Oven Gloves", "pcs", 45], ["surgicalMask", "Surgical Mask", "pcs", 3],
    ["oneShot", "One Shot", "pcs", 55],
  ]),
  ...S("Safety & Sickness", "Amenities", true, [
    ["safetyCard", "Safety Instruction Card", "pcs", 4], ["sicknessBag", "Sickness Bag", "pcs", 2],
  ]),
  ...S("Medical Kits", "Amenities", true, [
    ["dailyMedeline", "Daily Medeline (Set)", "pcs", 350], ["emkBox", "EMK Box", "pc", 1200],
    ["upkBox", "UPK Box", "pcs", 900], ["fanBox", "FAN Box", "pcs", 650],
  ]),
  ...S("Forms & Cards", "Amenities", true, [
    ["healthDeclForm", "RD Health Declaration Form", "pcs", 1], ["baggageDeclForm", "Baggage Declaration Form", "pcs", 1],
    ["bdEdCard", "Bangladeshi ED Card", "pcs", 1.5], ["commentsCard", "Comments Card", "pcs", 1],
  ]),
  // ── Equipment (stock) ──────────────────────────────────────────────────────
  ...S("Meal Cart & Wastage Cart", "Equipment", true, [
    ["fullMealCart", "Full Meal Cart", "unit", 0], ["halfMealCart", "Half Meal Cart", "unit", 0],
    ["fullWastageCart", "Full Wastage Cart", "unit", 0], ["halfWastageCart", "Half Wastage Cart", "unit", 0],
    ["standardCabinet", "Standard Cabinet", "unit", 0], ["ovenCase", "Oven Case", "unit", 0],
  ]),
  ...S("Ceramic & Glassware", "Equipment", true, [
    ["ceramicMealBowl", "Ceramic Meal Bowl", "pcs", 55], ["ceramicDessertBowl", "Ceramic Dessert Bowl", "pcs", 45],
    ["ceramicButterBowl", "Ceramic Butter Bowl", "pcs", 35], ["ceramicNutBowl", "Ceramic Nut Bowl", "pcs", 35],
    ["teaCupSaucer", "Tea Cup & Saucer", "pcs", 90], ["tumblerGlass", "Tumbler Glass", "pcs", 40], ["snacksPlate", "Snacks Plate", "pcs", 50],
  ]),
  ...S("Cutlery & Service Items", "Equipment", true, [
    ["teaSpoon", "Tea Spoon", "pcs", 18], ["dinnerFork", "Dinner Fork", "pcs", 22], ["dinnerSpoon", "Dinner Spoon", "pcs", 22],
    ["dinnerKnife", "Dinner Knife", "pcs", 24], ["longSpoon", "Long Spoon", "pcs", 20], ["iceTong", "Ice Tong", "pcs", 60],
    ["iceBucket", "Ice Bucket", "pcs", 180], ["roundTraySteel", "Round Tray (Steel)", "pcs", 140], ["serviceTrayBig", "Service Tray (Big)", "pcs", 160],
  ]),
  ...S("Fresh Fruits", "Equipment", true, [
    ["banana", "Banana", "pcs", 8], ["apple", "Apple", "pcs", 15],
  ]),
].map((d) => ({
  ...d,
  ...(ROLLUP_TO[d.key] ? { rollupTo: ROLLUP_TO[d.key] } : {}),
  ...(AUTO_KEYS.has(d.key) ? { auto: true, stock: false } : {}),
}));

/** Physical stock lines (Beverages/Amenities/Equipment, excluding auto totals). */
export const GALLEY_STOCK_DEFS = GALLEY_CATALOG.filter((d) => d.stock);

/** Keys of the physical stock lines. */
export const GALLEY_STOCK_KEYS = new Set(GALLEY_STOCK_DEFS.map((d) => d.key));

/** True for groups whose items are physical stock (loadable / issuable). */
export const isStockGroup = (group?: string) =>
  group === "Beverages" || group === "Amenities" || group === "Equipment";
