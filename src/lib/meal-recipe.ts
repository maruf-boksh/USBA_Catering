// Meal-plan recipe resolver.
//
// Every menu the user can plan must resolve to a usable per-portion recipe so a
// Production Order can be raised and a Demand Request auto-generated with real
// materials. This is the single source the production/demand engine reads.
//
// Resolution priority:
//   1. PRODUCTION_ITEMS  — curated, hand-tuned per-portion recipes (authoritative
//      for the core finished goods, incl. names that also exist as lot-scaled
//      hardcoded BOMs).
//   2. billOfMaterials   — the meal-plan BOM master (~70 menus + hardcoded BOMs),
//      normalized to per-portion. Covers everything else.
//   3. Synthesized deterministic fallback — for any meal in neither master, so a
//      Demand Request is never empty.
//
// Pure & deterministic: no Math.random / Date, so the same meal always yields the
// same item codes (Demand Request items are keyed by id downstream).

import {
  PRODUCTION_ITEMS,
  type RecipeItem,
  type ProductionItem,
} from "@/lib/production-items";
import {
  billOfMaterials,
  type BillOfMaterial,
  type BomInputMaterial,
} from "@/lib/sample-data";

/** "Plain Polao" -> "MP-PLAIN-POLAO" (matches the meal-plan picker codes). */
function slugCode(name: string): string {
  return "MP-" + name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Parse a BOM material token `"CODE - Name (UOM)"` into its parts.
 * The separator is a spaced " - " (codes themselves contain hyphens, e.g.
 * "RM-2701-RICE"), and the UOM is the LAST parenthesized group (names may also
 * contain parens, e.g. "Meal Box (Foil/Paper)").
 */
function parseBomMaterial(material: string, fallbackUom: string): { code: string; name: string; uom: string } {
  const m = material.match(/^(.+?)\s+-\s+(.+?)\s*\(([^()]*)\)\s*$/);
  if (!m) return { code: material.trim(), name: material.trim(), uom: fallbackUom };
  return { code: m[1].trim(), name: m[2].trim(), uom: m[3].trim() || fallbackUom };
}

/** Portions a BOM's input quantities are expressed against (yield is the truth). */
function portionsPerLot(bom: BillOfMaterial): number {
  const n = parseInt(bom.yield, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function toRecipeItem(mat: BomInputMaterial, portions: number): RecipeItem {
  const { code, name, uom } = parseBomMaterial(mat.material, mat.uom);
  const lotQty = mat.totalQty || mat.quantity || 0;
  return {
    itemCode: code,
    itemName: name,
    uom,
    qtyPerUnit: lotQty / portions,
    rate: mat.avgRate,
  };
}

/** Convert a meal-plan BOM into the per-portion ProductionItem shape. */
function convertBom(bom: BillOfMaterial): ProductionItem {
  const portions = portionsPerLot(bom);
  const rawMaterials: RecipeItem[] = [];
  const packagingMaterials: RecipeItem[] = [];
  const otherConsumption: RecipeItem[] = [];
  for (const mat of bom.inputMaterials) {
    const item = toRecipeItem(mat, portions);
    if (mat.type === "Packaging") packagingMaterials.push(item);
    else if (mat.type === "Raw Material") rawMaterials.push(item);
    else otherConsumption.push(item);
  }
  return { code: bom.itemCode, name: bom.itemName, rawMaterials, packagingMaterials, otherConsumption };
}

// ── Deterministic synthesized fallback ──────────────────────────────────────

const BASE_INGREDIENTS: Array<{ itemCode: string; itemName: string; uom: string; rate: number }> = [
  { itemCode: "RM-GEN-RICE", itemName: "Cooked Base (Rice)", uom: "Kg", rate: 95 },
  { itemCode: "RM-GEN-VEG",  itemName: "Mixed Vegetable",     uom: "Kg", rate: 70 },
  { itemCode: "RM-GEN-PROT", itemName: "Protein Mix",         uom: "Kg", rate: 240 },
  { itemCode: "RM-GEN-WHEAT",itemName: "Wheat Base (Flour)",  uom: "Kg", rate: 88 },
];

/** Stable string hash (no randomness) for deterministic ingredient choice. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function synthesizeFallback(meal: { name: string; code?: string; weight?: number }): ProductionItem {
  const base = BASE_INGREDIENTS[hashString(meal.name) % BASE_INGREDIENTS.length];
  const grams = meal.weight && meal.weight > 0 ? meal.weight : 200;
  return {
    code: meal.code ?? slugCode(meal.name),
    name: meal.name,
    rawMaterials: [
      { itemCode: base.itemCode, itemName: base.itemName, uom: base.uom, qtyPerUnit: round3((grams / 1000) * 0.8), rate: base.rate },
    ],
    packagingMaterials: [
      { itemCode: "PKG-2710", itemName: "Meal Box (Foil/Paper)", uom: "PCS", qtyPerUnit: 1, rate: 12 },
    ],
    otherConsumption: [
      { itemCode: "OC-001", itemName: "Cooking Gas", uom: "Kg", qtyPerUnit: 0.03, rate: 85 },
    ],
  };
}

// ── Public resolver ─────────────────────────────────────────────────────────

/**
 * Resolve a meal (by name and/or code) to a per-portion ProductionItem recipe.
 * Always returns a recipe — never null — so downstream material aggregation and
 * Demand Request generation light up for every meal-plan menu.
 */
export function resolveProductionItem(meal: { name: string; code?: string; weight?: number }): ProductionItem {
  // 1) Curated per-portion catalog (by code or name).
  const curated = PRODUCTION_ITEMS.find(
    (p) => (meal.code && p.code === meal.code) || p.name === meal.name,
  );
  if (curated) return curated;

  // 2) Meal-plan BOM master (by itemCode then name), normalized to per-portion.
  const bom = billOfMaterials.find(
    (b) => (meal.code && b.itemCode === meal.code) || b.name === meal.name || b.itemName === meal.name,
  );
  if (bom) return convertBom(bom);

  // 3) Deterministic synthesized fallback.
  return synthesizeFallback(meal);
}

/**
 * True when a meal resolves to a real recipe in a master (curated PRODUCTION_ITEMS
 * or the BOM master) rather than the synthesized generic fallback. Used by the UI
 * to flag orders whose requirement plan rests on a generic recipe.
 */
export function hasMasterRecipe(meal: { name?: string; code?: string; bom?: string }): boolean {
  const name = meal.name ?? meal.bom;
  const inCurated = PRODUCTION_ITEMS.some(
    (p) => (meal.code && p.code === meal.code) || p.name === name || p.name === meal.bom,
  );
  if (inCurated) return true;
  return billOfMaterials.some(
    (b) => (meal.code && b.itemCode === meal.code) || b.name === name || b.itemName === name || b.name === meal.bom,
  );
}
