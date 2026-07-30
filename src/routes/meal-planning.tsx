import { useNavigate, useLocation } from "react-router-dom";
import { useState, useMemo, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Info, ChevronRight, ArrowLeft, ChevronDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMealSlots } from "@/lib/meal-slot-settings";
import { resolveItemProfile } from "@/lib/item-profiles";
import { usePersistedState } from "@/lib/use-persisted-state";
import { MEAL_PLAN_CONFIG_KEY, mealCards as seedMealCards, cardMatchesDate } from "@/lib/meal-planning-data";

// Resolve a meal item's serving weight/kcal. The Item Profile (config-item) is
// the source of truth when configured; the static FOOD_ITEMS/DESSERT_ITEMS entry
// is the fallback for dishes not yet in the profile master.
function withProfile(
  found?: { name: string; weight: number; calories: number },
  /** Portions per meal to carry over — swapping the dish must not reset it. */
  qtyPerMeal?: number,
) {
  const qty = qtyPerMeal && qtyPerMeal > 0 ? { qtyPerMeal } : {};
  if (!found) return { name: "", weight: 0, calories: 0, ...qty };
  const p = resolveItemProfile(found.name);
  return {
    name: found.name,
    weight: p?.weightG ?? found.weight,
    calories: p?.kcal ?? found.calories,
    ...qty,
  };
}

interface MealItem {
  name: string;
  weight: number;
  calories: number;
  /**
   * Portions of this dish in ONE meal of the line it belongs to. A special meal
   * is assembled from its items, so this is the assembly quantity: 2 rotis in a
   * meal means 2 portions are reserved out of the Roti pool per meal ordered.
   * Absent ⇒ 1.
   */
  qtyPerMeal?: number;
}

interface MealChoice {
  label: string;
  percentage: number;
  items: MealItem[];
}

/** "×N" marker shown wherever an item line renders, when its per-meal quantity
 *  is above 1 — the quantity is part of the plan, so every read-out carries it. */
const qtyMark = (it: MealItem, cls = "text-indigo-700") =>
  (it.qtyPerMeal ?? 1) > 1
    ? (
      <span className={`ml-1 font-semibold ${cls}`} title={`${it.qtyPerMeal} portion(s) of ${it.name || "this item"} per meal`}>
        ×{it.qtyPerMeal}
      </span>
    )
    : null;

/** Calories one MEAL takes from this line — kcal × per-meal quantity. */
const kcalOf = (it: MealItem) => (it.calories || 0) * (it.qtyPerMeal ?? 1);

interface SpecialMeal {
  type: string;
  portions: number | string;
  items: MealItem[];
  enabled: boolean;
}

interface MealCard {
  id: string;
  day: string;
  // Optional inclusive effective date range (ISO "YYYY-MM-DD"); omitting both
  // means the card applies on every date.
  effectiveFrom?: string;
  effectiveTo?: string;
  mealType: string;
  flightType: string[];
  route?: string;
  forType: string;
  choices: MealChoice[];
  specialMeals: SpecialMeal[];
  dessert: MealItem;
  salads?: MealItem[];
  freshFruits?: MealItem[];
  customAddons?: Record<string, MealItem[]>;
  servingTime: { start: string; end: string };
  totalKcal: number;
  createdDate: string;
}

interface GMOrder {
  flightNumber: string;
  route: string;
  date: string;
  departureTime: string;
  paxCount: number;
  crewCount: number;
  totalMealsToday: number;
  totalMeals96h: number;
  approvedBy: string;
  approvedTimestamp: string;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MEAL_TYPES = ["Breakfast", "Lunch", "Snacks", "Heavy Snacks", "Dinner"];

// A meal type can carry any number of choices (CHOICE 01, 02, 03 …). These
// helpers keep the per-choice label + colour scheme consistent everywhere and
// cycle the palette once the fixed colours run out.
const CHOICE_PALETTE = [
  { badge: "bg-blue-100 text-blue-800", border: "border-blue-200", chip: "border-blue-200 bg-blue-50/40", text: "text-blue-700" },
  { badge: "bg-teal-100 text-teal-800", border: "border-teal-200", chip: "border-teal-200 bg-teal-50/40", text: "text-teal-700" },
  { badge: "bg-amber-100 text-amber-800", border: "border-amber-200", chip: "border-amber-200 bg-amber-50/40", text: "text-amber-700" },
  { badge: "bg-purple-100 text-purple-800", border: "border-purple-200", chip: "border-purple-200 bg-purple-50/40", text: "text-purple-700" },
  { badge: "bg-rose-100 text-rose-800", border: "border-rose-200", chip: "border-rose-200 bg-rose-50/40", text: "text-rose-700" },
];
const choiceStyle = (i: number) => CHOICE_PALETTE[i % CHOICE_PALETTE.length];
const choiceLabel = (i: number) => `CHOICE ${String(i + 1).padStart(2, "0")}`;
// Sensible default split for n choices: 60/40 for the classic two, otherwise
// an even spread with any remainder landing on the last choice.
const defaultChoicePercs = (n: number): number[] => {
  if (n <= 1) return [100];
  if (n === 2) return [60, 40];
  const base = Math.floor(100 / n);
  const arr = Array.from({ length: n }, () => base);
  arr[n - 1] = 100 - base * (n - 1);
  return arr;
};
// Compact "DD MMM" for effective-range chips/labels (ISO "YYYY-MM-DD" in).
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};
// Human label for a card's effective range; "" when the card has no range.
const rangeLabel = (from?: string, to?: string) => {
  if (!from && !to) return "";
  if (from && to) return `${shortDate(from)} – ${shortDate(to)}`;
  if (from) return `From ${shortDate(from)}`;
  return `Until ${shortDate(to!)}`;
};
// "HH:MM" 24h → "HH:MM AM/PM" for serving-time display.
const to12h = (hhmm: string): string => {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
};

const FOOD_ITEMS: Record<string, Array<{ name: string; weight: number; calories: number }>> = {
  Breakfast: [
    { name: "Portuguese Omelet", weight: 80, calories: 150 },
    { name: "Potato Hasbrown", weight: 80, calories: 120 },
    { name: "Chicken Croquette", weight: 80, calories: 160 },
    { name: "Croissant", weight: 40, calories: 180 },
    { name: "Soft Roll", weight: 40, calories: 100 },
    { name: "Chicken Khichuri", weight: 250, calories: 280 },
    { name: "Fried Egg", weight: 50, calories: 85 },
    { name: "Scrambled Egg", weight: 100, calories: 145 },
    { name: "Boiled Egg", weight: 50, calories: 78 },
    { name: "Paratha", weight: 60, calories: 180 },
    { name: "Laccha Paratha", weight: 60, calories: 190 },
    { name: "Chana Dal", weight: 80, calories: 120 },
    { name: "Mug Dal", weight: 40, calories: 65 },
    { name: "Jam", weight: 10, calories: 30 },
    { name: "Butter", weight: 10, calories: 72 },
    { name: "Mixed Veg", weight: 30, calories: 45 },
    { name: "Semolina Halwa", weight: 80, calories: 170 },
    { name: "Chicken Omelet", weight: 80, calories: 160 },
  ],
  Lunch: [
    { name: "Boiled Rice", weight: 180, calories: 210 },
    { name: "Plain Polao", weight: 180, calories: 240 },
    { name: "Jeera Polao", weight: 180, calories: 245 },
    { name: "Beef Biryani", weight: 250, calories: 380 },
    { name: "Chicken Biryani", weight: 250, calories: 360 },
    { name: "Chicken Shaslik", weight: 100, calories: 160 },
    { name: "Prawn with Veg Curry", weight: 100, calories: 140 },
    { name: "Akbari Vendi", weight: 50, calories: 70 },
    { name: "Chicken Masala", weight: 100, calories: 155 },
    { name: "Buttered Veg", weight: 100, calories: 90 },
    { name: "Kulcha", weight: 60, calories: 180 },
    { name: "Mixed Veg Curry", weight: 50, calories: 75 },
    { name: "Dal Butter Fry", weight: 50, calories: 120 },
    { name: "Mug Dal Vuna", weight: 50, calories: 80 },
    { name: "Naan", weight: 60, calories: 170 },
    { name: "Mughlai Chicken", weight: 100, calories: 160 },
  ],
  Dinner: [
    { name: "Plain Polao", weight: 180, calories: 240 },
    { name: "Boiled Rice", weight: 180, calories: 210 },
    { name: "Chicken Rezala", weight: 100, calories: 145 },
    { name: "Chicken Vuna", weight: 100, calories: 150 },
    { name: "Chicken Dopiaza", weight: 100, calories: 140 },
    { name: "Mug Dal", weight: 100, calories: 130 },
    { name: "Mixed Veg. Vajee", weight: 50, calories: 65 },
    { name: "Laccha Paratha", weight: 60, calories: 190 },
    { name: "Sauteed Veg", weight: 100, calories: 110 },
    { name: "Dal Butter Fry", weight: 50, calories: 120 },
    { name: "Tandoori Chicken", weight: 100, calories: 160 },
    { name: "Kulcha", weight: 60, calories: 180 },
    { name: "Beef Rezala", weight: 100, calories: 150 },
    { name: "Chicken Kabab", weight: 50, calories: 120 },
    { name: "Mixed Veg Curry", weight: 50, calories: 75 },
  ],
  Snacks: [
    { name: "Chicken Roll", weight: 60, calories: 180 },
    { name: "Plain Cake", weight: 40, calories: 120 },
    { name: "Salted Biscuit", weight: 50, calories: 140 },
    { name: "Lemon Danish", weight: 40, calories: 160 },
    { name: "Sandwich", weight: 100, calories: 200 },
    { name: "Fruit Salad", weight: 80, calories: 70 },
    { name: "Cookies", weight: 30, calories: 130 },
    { name: "Banana Cake", weight: 50, calories: 150 },
    { name: "Cheese Cracker", weight: 30, calories: 110 },
  ],
  "Heavy Snacks": [
    { name: "Chicken Buggati", weight: 90, calories: 200 },
    { name: "Potato Wedges", weight: 50, calories: 120 },
    { name: "Chicken & Veg Frankie", weight: 100, calories: 240 },
    { name: "Fried Potato", weight: 50, calories: 115 },
    { name: "Korean Fried Chicken", weight: 100, calories: 280 },
    { name: "Roll Sandwich with Chicken & Cheese", weight: 150, calories: 320 },
    { name: "Veg Frankie", weight: 80, calories: 200 },
    { name: "Veg Buggati", weight: 90, calories: 170 },
    { name: "Veg Cutlet", weight: 60, calories: 140 },
    { name: "Spring Roll", weight: 80, calories: 160 },
    { name: "Samosa", weight: 60, calories: 140 },
  ],
};

const DESSERT_ITEMS = [
  { name: "Yoghurt", weight: 80, calories: 70 },
  { name: "Firni", weight: 80, calories: 160 },
  { name: "Semolina", weight: 50, calories: 130 },
  { name: "Vanilla Pastry", weight: 60, calories: 180 },
  { name: "Chocolate Brownie", weight: 50, calories: 210 },
  { name: "Fruit Custard", weight: 80, calories: 140 },
  { name: "Lemon Danish", weight: 40, calories: 160 },
  { name: "Kitkat Chocolate", weight: 30, calories: 155 },
  { name: "Gulab Jamun", weight: 60, calories: 200 },
  { name: "Panna Cotta", weight: 80, calories: 180 },
  { name: "Ice Cream", weight: 60, calories: 130 },
];

const SALAD_ITEMS = [
  { name: "Garden Salad", weight: 80, calories: 40 },
  { name: "Caesar Salad", weight: 100, calories: 120 },
  { name: "Greek Salad", weight: 80, calories: 90 },
  { name: "Coleslaw", weight: 60, calories: 110 },
  { name: "Pasta Salad", weight: 100, calories: 180 },
  { name: "Waldorf Salad", weight: 80, calories: 140 },
  { name: "Russian Salad", weight: 80, calories: 130 },
  { name: "Mixed Green Salad", weight: 60, calories: 30 },
  { name: "Chickpea Salad", weight: 100, calories: 160 },
];

const FRESH_FRUIT_ITEMS = [
  { name: "Apple Slices", weight: 80, calories: 42 },
  { name: "Banana", weight: 100, calories: 89 },
  { name: "Orange Wedges", weight: 80, calories: 37 },
  { name: "Watermelon Cubes", weight: 120, calories: 36 },
  { name: "Grapes", weight: 80, calories: 54 },
  { name: "Mango Slices", weight: 100, calories: 60 },
  { name: "Pineapple Chunks", weight: 80, calories: 42 },
  { name: "Mixed Fruit Platter", weight: 120, calories: 70 },
  { name: "Papaya Slices", weight: 100, calories: 39 },
  { name: "Strawberries", weight: 80, calories: 26 },
];

const DOMESTIC_ROUTES = [
  "DAC-CGP-DAC",
  "DAC-ZYL-DAC",
  "DAC-CXB-DAC",
  "DAC-JSR-DAC",
  "DAC-BZL-DAC",
  "DAC-SPD-DAC",
  "DAC-RJH-DAC",
];

const INTERNATIONAL_ROUTES = [
  "DAC-DXB-DAC",
  "DAC-KUL-DAC",
  "DAC-DOH-DAC",
  "DAC-SIN-DAC",
  "DAC-MCT-DAC",
  "DAC-CMB-DAC",
  "CGP-DXB-CGP",
];

// Day-level special meals draw from EVERY service's item pool — a special meal
// is its own plan (own quantity), not part of Breakfast/Lunch/any service, so
// its item picker must not be limited to one meal type's list.
const SPECIAL_FOOD_POOL: Array<{ name: string; weight: number; calories: number }> = (() => {
  const seen = new Set<string>();
  return Object.values(FOOD_ITEMS).flat().filter((i) => {
    if (seen.has(i.name)) return false;
    seen.add(i.name);
    return true;
  });
})();

const SPECIAL_MEAL_INFO: Record<string, { code: string; label: string; allowed: string[]; notAllowed: string[]; note: string }> = {
  AVML: { code: "AVML", label: "Asian Vegetarian Meal", allowed: ["Vegetables", "Dairy products", "Eggs", "Legumes", "Rice", "Lentils", "Spices"], notAllowed: ["Meat", "Poultry", "Seafood", "Fish", "Beef", "Pork"], note: "Lacto-vegetarian, spiced. Suitable for South Asian vegetarians." },
  KSML: { code: "KSML", label: "Kosher Meal", allowed: ["Certified Kosher meat/poultry", "Kosher fish (fins & scales)", "Fruits", "Vegetables"], notAllowed: ["Pork", "Shellfish", "Mixing meat and dairy", "Non-certified Kosher items"], note: "Must be certified Kosher. Meat and dairy cannot be served together." },
  MOML: { code: "MOML", label: "Muslim / Halal Meal", allowed: ["Halal-certified meat", "Poultry", "Fish", "Vegetables", "Rice", "Bread"], notAllowed: ["Pork", "Pork by-products", "Alcohol", "Non-Halal slaughtered meat"], note: "All meat must be Halal-certified." },
  DBML: { code: "DBML", label: "Diabetic Meal", allowed: ["Lean protein", "Non-starchy vegetables", "Whole grains (small portion)", "Low-GI foods"], notAllowed: ["Refined sugar", "White bread", "Fried foods", "High-GI desserts"], note: "Low sugar, low fat. No concentrated sweets." },
  GFML: { code: "GFML", label: "Gluten-Free Meal", allowed: ["Rice", "Potatoes", "Corn", "Meat", "Fish", "Vegetables", "GF-certified grains"], notAllowed: ["Wheat", "Barley", "Rye", "Regular bread/pasta/cakes", "Standard soy sauce"], note: "No gluten-containing ingredients. Avoid cross-contamination." },
  LCML: { code: "LCML", label: "Low-Calorie Meal", allowed: ["Lean protein", "Steamed vegetables", "Salads", "Low-fat dairy", "Grilled items"], notAllowed: ["Fried foods", "High-fat sauces", "Full-fat dairy", "Pastries"], note: "Generally under 400 kcal. Low fat and sugar." },
  BLML: { code: "BLML", label: "Bland Meal", allowed: ["Plain rice", "Boiled chicken", "Steamed vegetables", "White bread", "Low-acid fruits"], notAllowed: ["Spicy foods", "Fried foods", "Acidic foods", "Onion", "Garlic"], note: "For sensitive stomachs. No spices or strong flavors." },
  HNML: { code: "HNML", label: "Hindu Meal", allowed: ["Vegetables", "Chicken (sometimes)", "Fish (sometimes)", "Dairy", "Eggs", "Rice", "Bread"], notAllowed: ["Beef", "Veal", "Pork"], note: "No beef. May include poultry/fish depending on preference." },
  VLML: { code: "VLML", label: "Lacto-Ovo Vegetarian Meal", allowed: ["Vegetables", "Dairy products", "Eggs", "Legumes", "Grains", "Fruits"], notAllowed: ["Meat", "Poultry", "Fish", "Seafood"], note: "Vegetarian including dairy and eggs." },
  CHML: { code: "CHML", label: "Child Meal", allowed: ["Mild foods", "Small portions", "Kid-friendly items", "Plain rice/pasta", "Mild chicken"], notAllowed: ["Spicy foods", "Whole nuts", "Alcohol-based sauces"], note: "Suitable for children aged 2–12. Mild, easy to eat." },
  VGML: { code: "VGML", label: "Vegan Meal", allowed: ["Vegetables", "Fruits", "Legumes", "Grains", "Nuts", "Seeds", "Plant-based items"], notAllowed: ["Meat", "Poultry", "Fish", "Dairy", "Eggs", "Honey", "Any animal-derived ingredient"], note: "Strictly plant-based. No animal products whatsoever." },
  JML:  { code: "JML",  label: "Jain Meal", allowed: ["Above-ground vegetables only", "Grains", "Legumes", "Fruits"], notAllowed: ["Root vegetables (onion, garlic, potato, carrot, beet)", "Meat", "Fish", "Eggs"], note: "No root vegetables. Strictly vegetarian." },
};

const gmOrderData: GMOrder = {
  flightNumber: "BS-315",
  route: "DAC → KUL",
  date: "2025-11-09",
  departureTime: "14:30",
  paxCount: 300,
  crewCount: 16,
  totalMealsToday: 9600,
  totalMeals96h: 38400,
  approvedBy: "S. Ahmed",
  approvedTimestamp: "2025-11-08 10:45 AM",
};

const gmMealSummary = {
  importDate: "2026-05-21",
  intl: { depMeal: 618, depChml: 24, depTotal: 642, retMeal: 0, retChml: 0, retVgml: 18, retTotal: 18, grandTotal: 660 },
  dom: {
    usba: { zenith: 160, pax: 160, breakfast: 160, lunch: 0 },
    aaa: { zenith: 66, pax: 66 },
    crew: { hSnacks: 8, lunch: 0, dinner: 4 },
    totalZenith: 226,
  },
};

const DUMMY_TAG_MEALS: Record<string, { forType: string; servingTime: { start: string; end: string }; flightType: string[] }[]> = {
  Breakfast: [
    { forType: "Passengers", servingTime: { start: "07:00", end: "10:00" }, flightType: ["Domestic", "International"] },
  ],
  Lunch: [
    { forType: "Passengers", servingTime: { start: "11:00", end: "14:00" }, flightType: ["Domestic", "International"] },
  ],
  Snacks: [
    { forType: "Passengers", servingTime: { start: "14:00", end: "16:00" }, flightType: ["Domestic"] },
  ],
  "Heavy Snacks": [
    { forType: "Crew", servingTime: { start: "16:00", end: "19:00" }, flightType: ["Domestic", "International"] },
  ],
  Dinner: [
    { forType: "Passengers", servingTime: { start: "19:00", end: "22:00" }, flightType: ["International"] },
  ],
};

// Full-week sample data. The page persists its own copy (MEAL_PLAN_CONFIG_KEY),
// so the default seed must cover every weekday — otherwise days the user hasn't
// configured render empty. We reuse the shared meal-planning seed (all days,
// passengers + crew) and map it into this page's MealCard shape (adds the
// createdDate the page tracks but the shared seed omits).
function getSampleMeals(): MealCard[] {
  const created = new Date().toISOString().split('T')[0];
  return seedMealCards.map((m) => ({ ...m, createdDate: created }));
}

// ── Menu-type name change (approval-gated) ──────────────────────────────────
// A request to rename a displayed menu-type label (e.g. "Breakfast" → "Morning
// Meal"). It only changes the LABEL after approval — every configured menu under
// the type keeps its full configuration (choices, special meals, dessert, etc.).
interface MenuTypeChange {
  id: string;
  origType: string;   // the base MEAL_TYPES key this row maps from
  oldName: string;    // label shown when the request was raised
  newName: string;
  requestedBy: string;
  requestedAt: string;
  status: "Pending" | "Approved" | "Rejected";
  processedBy?: string;
  processedAt?: string;
}

// Demo per-route Breakfast menus so the "same menu vs different menu per route"
// scenario is visible inside the Breakfast card — passenger/crew, domestic/
// international, a specific route, and an "All Routes" (shared) menu.
function buildRouteDemoBreakfast(day: string, created: string): MealCard[] {
  const mk = (
    id: string, forType: string, flightType: string[], route: string | undefined,
    items: MealItem[], dessert: MealItem,
  ): MealCard => ({
    id, day, mealType: "Breakfast", flightType, forType, route,
    choices: [{ label: "CHOICE 1", percentage: 100, items }],
    specialMeals: [], dessert,
    servingTime: { start: "07:00", end: "10:00" },
    totalKcal: items.reduce((s, i) => s + i.calories, 0) + dessert.calories,
    createdDate: created,
  });
  return [
    mk("route-demo-1", "Passengers", ["International"], "DAC-DXB-DAC",
      [{ name: "Aloo Paratha", weight: 120, calories: 300 }, { name: "Masala Omelette", weight: 80, calories: 150 }],
      { name: "Fresh Fruit Cup", weight: 80, calories: 70 }),
    mk("route-demo-2", "Passengers", ["International"], "DAC-KUL-DAC",
      [{ name: "Nasi Lemak", weight: 200, calories: 420 }, { name: "Boiled Egg", weight: 50, calories: 80 }],
      { name: "Kaya Toast", weight: 60, calories: 180 }),
    mk("route-demo-3", "Passengers", ["Domestic"], "DAC-CGP-DAC",
      [{ name: "Bhuna Khichuri", weight: 220, calories: 280 }, { name: "Begun Bhaji", weight: 60, calories: 90 }],
      { name: "Sweet Yoghurt", weight: 60, calories: 90 }),
    mk("route-demo-4", "Crew", ["Domestic", "International"], undefined,
      [{ name: "Paratha", weight: 100, calories: 250 }, { name: "Channa Masala", weight: 100, calories: 150 }],
      { name: "Banana", weight: 100, calories: 90 }),
  ];
}

export default function MealPlanning() {
  const navigate = useNavigate();
  // Meal types are driven by the configurable Meal Config (Configuration → Meal
  // Config). Adding/editing/removing a meal there flows straight into the chips
  // and serving-time defaults below — no hardcoded meal list.
  const mealSlots = useMealSlots();
  const mealTypeOptions = useMemo(() => mealSlots.map((s) => s.name), [mealSlots]);
  const defaultServingFor = (name: string): { start: string; end: string } => {
    const s = mealSlots.find((m) => m.name === name);
    const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
    return s ? { start: hh(s.from), end: hh(s.to) } : { start: "07:00", end: "10:00" };
  };
  const location = useLocation();
  const backUrl = (location.state as { backUrl?: string } | null)?.backUrl ?? null;
  // Persisted so the configured menus survive a reload and feed the Production
  // Order "Menu Plan" tab (read via loadMealPlanningConfig). Drop-in for useState.
  const [meals, setMeals] = usePersistedState<MealCard[]>(MEAL_PLAN_CONFIG_KEY, getSampleMeals());
  // Backfill: older persisted state only held the day the app was first opened
  // on (the previous single-day seed), leaving every other day empty. Add the
  // seed cards for any day with no configured meals so the planner is complete.
  // Idempotent — only fills days that are entirely empty, never touches the rest.
  useEffect(() => {
    const configuredDays = new Set(meals.map((m) => m.day));
    const missing = getSampleMeals().filter((c) => !configuredDays.has(c.day));
    if (missing.length) setMeals((prev) => [...prev, ...missing]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selectedDay, setSelectedDay] = useState(DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1]);
  const today = DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];

  // ── Per-route menu demo + menu-type rename approval ──────────────────────────
  // Approved label overrides for menu types (base MEAL_TYPES key → new label).
  // Only the label changes; each card's `mealType` and full config stay intact.
  const [mealTypeRenames, setMealTypeRenames] = usePersistedState<Record<string, string>>("menu-type-renames", {});
  const [menuTypeApprovals, setMenuTypeApprovals] = usePersistedState<MenuTypeChange[]>("menu-type-change-approvals", []);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ origType: string; currentName: string } | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [renameBy, setRenameBy] = useState("");

  // Seed the demo per-route Breakfast menus once (idempotent by id) so the
  // "different / shared menu per route" scenario is visible in the Breakfast card.
  useEffect(() => {
    if (meals.some((m) => m.id.startsWith("route-demo-"))) return;
    const created = new Date().toISOString().split("T")[0];
    setMeals((prev) => [...prev, ...buildRouteDemoBreakfast(today, created)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stampNow = () => new Date().toISOString().slice(0, 16).replace("T", " ");

  const openRename = (origType: string, currentName: string) => {
    setRenameTarget({ origType, currentName });
    setRenameInput(currentName);
    setRenameBy("");
    setRenameOpen(true);
  };
  const submitRename = () => {
    if (!renameTarget) return;
    const newName = renameInput.trim();
    if (!newName) { toast.error("Enter a new menu type name."); return; }
    if (newName === renameTarget.currentName) { toast.error("Enter a name different from the current one."); return; }
    if (!renameBy.trim()) { toast.error("Requested By is required."); return; }
    if (menuTypeApprovals.some((r) => r.origType === renameTarget.origType && r.status === "Pending")) {
      toast.error("A rename for this menu type is already pending approval."); return;
    }
    const rec: MenuTypeChange = {
      id: `MTC-${Date.now().toString(36).slice(-6).toUpperCase()}`,
      origType: renameTarget.origType,
      oldName: renameTarget.currentName,
      newName,
      requestedBy: renameBy.trim(),
      requestedAt: stampNow(),
      status: "Pending",
    };
    setMenuTypeApprovals((prev) => [rec, ...prev]);
    setRenameOpen(false);
    toast.success(`Rename "${rec.oldName}" → "${rec.newName}" submitted for approval.`);
  };
  const approveRename = (rec: MenuTypeChange) => {
    // Apply the label override — the underlying menus keep their configuration.
    setMealTypeRenames((prev) => ({ ...prev, [rec.origType]: rec.newName }));
    setMenuTypeApprovals((prev) => prev.map((r) =>
      r.id === rec.id ? { ...r, status: "Approved" as const, processedBy: "GM Catering", processedAt: stampNow() } : r));
    toast.success(`Approved — "${rec.oldName}" renamed to "${rec.newName}". All menus kept intact.`);
  };
  const rejectRename = (rec: MenuTypeChange) => {
    setMenuTypeApprovals((prev) => prev.map((r) =>
      r.id === rec.id ? { ...r, status: "Rejected" as const, processedBy: "GM Catering", processedAt: stampNow() } : r));
    toast.success(`Rejected rename of "${rec.oldName}".`);
  };
  // Date the planner is viewed "as of": only configs whose effective range covers
  // this date (plus range-less configs) are shown. Empty string = show all dates.
  // Defaults to today so the planner opens on the currently-effective menus.
  const [viewDate, setViewDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [orderDetailsOpen, setOrderDetailsOpen] = useState(false);
  const [forwardConfirmOpen, setForwardConfirmOpen] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<MealCard | null>(null);
  const [isForwarded, setIsForwarded] = useState(false);
  const [forwardedTime, setForwardedTime] = useState("");
  const [activeFilters, setActiveFilters] = useState({ domestic: true, international: true, passenger: true, crew: true });
  const [forwardCycle, setForwardCycle] = useState<"pending" | "forwarded" | "ready">("pending");
  const [lastForwardedQuantity, setLastForwardedQuantity] = useState(0);
  const [orderHistory, setOrderHistory] = useState<Array<{ mealsOrdered: number; orderedBy: string; designation: string; date: string; time: string; period: string }>>([
    { mealsOrdered: 9600, orderedBy: "S. Ahmed", designation: "Menu Planner", date: "08 Nov 2025", time: "10:45 AM", period: "24-hour cycle" },
  ]);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderModalQuantity, setOrderModalQuantity] = useState("");
  const [orderModalError, setOrderModalError] = useState("");
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [forwardedAt, setForwardedAt] = useState<Date | null>(null);
  const [choiceEditOpen, setChoiceEditOpen] = useState(false);
  const [editingChoice, setEditingChoice] = useState<{ mealId: string; kind: "choice" | "specialMeal" | "dessert"; choiceIdx?: number; smType?: string; items: MealItem[]; label: string } | null>(null);
  const [choiceEditNotes, setChoiceEditNotes] = useState<Record<string, string[]>>({});
  const [removeModeType, setRemoveModeType] = useState<string | null>(null);
  const [removeConfirmCard, setRemoveConfirmCard] = useState<{ mealId: string; kind: "choice" | "specialMeal" | "dessert"; choiceIdx?: number; smType?: string } | null>(null);

  const getInitialCreateData = (day: string) => ({
    // Days this config applies to — multi-select (one config can be saved to
    // several weekdays at once, creating a copy per day).
    days: [day] as string[],
    // New configs default to no effective range (apply on every date).
    effectiveFrom: "",
    effectiveTo: "",
    flightType: [] as string[],
    routes: [] as string[],
    forType: "",
    mealTypes: [] as string[],
    choices: [
      { label: "CHOICE 1", percentage: 60, items: [] as MealItem[] },
      { label: "CHOICE 2", percentage: 40, items: [] as MealItem[] },
    ] as MealChoice[],
    // DAY-LEVEL special-meal plan — one list with its own quantities, NOT keyed
    // by meal type: a special meal is not part of Breakfast/Lunch/any service.
    specialMealsPlan: [] as Array<{ code: string; portions: number | string; items: MealItem[] }>,
    // One entry per choice (CHOICE 01, 02, …). Starts with two; users can add more.
    choiceItems: [
      MEAL_TYPES.reduce((acc, t) => { acc[t] = [] as MealItem[]; return acc; }, {} as Record<string, MealItem[]>),
      MEAL_TYPES.reduce((acc, t) => { acc[t] = [] as MealItem[]; return acc; }, {} as Record<string, MealItem[]>),
    ] as Record<string, MealItem[]>[],
    dessertByType: {} as Record<string, MealItem[]>,
    dessertAllocationByType: {} as Record<string, number[]>,
    saladsByType: {} as Record<string, MealItem[]>,
    saladAllocationByType: {} as Record<string, number[]>,
    freshFruitsByType: {} as Record<string, MealItem[]>,
    freshFruitAllocationByType: {} as Record<string, number[]>,
    customMealTypeNames: [] as string[],
    customAddonNames: [] as string[],
    customAddonsByType: {} as Record<string, Record<string, MealItem[]>>,
    // Per meal type: the % split across choices, indexed the same as choiceItems.
    choicePercentagesByType: {} as Record<string, number[]>,
    servingTimes: {} as Record<string, { start: string; end: string }>,
  });

  const [createData, setCreateData] = useState(getInitialCreateData(selectedDay));
  const [createErrors, setCreateErrors] = useState<string[]>([]);
  const [daySelectionOpen, setDaySelectionOpen] = useState(false);
  const [pendingDay, setPendingDay] = useState(selectedDay);
  const [tagLog, setTagLog] = useState<{ name: string; date: string; time: string } | null>(null);
  const [orderEditMode, setOrderEditMode] = useState(false);
  const [orderEditLog, setOrderEditLog] = useState<{ name: string; date: string; time: string } | null>(null);
  const [editableSummary, setEditableSummary] = useState({
    importDate: gmMealSummary.importDate,
    intl: { depMeal: gmMealSummary.intl.depMeal, depChml: gmMealSummary.intl.depChml, retMeal: gmMealSummary.intl.retMeal, retChml: gmMealSummary.intl.retChml, retVgml: gmMealSummary.intl.retVgml },
    dom: {
      usba: { ...gmMealSummary.dom.usba },
      aaa: { ...gmMealSummary.dom.aaa },
      crew: { ...gmMealSummary.dom.crew },
    },
  });

  const [pendingSpecialMeal, setPendingSpecialMeal] = useState<{ code: string; portions: number | string; items: MealItem[] } | null>(null);
  const [activeChoiceForItems, setActiveChoiceForItems] = useState<number>(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeChoicePercentType, setActiveChoicePercentType] = useState<string>("");
  const [activeItemsTab, setActiveItemsTab] = useState<string>("");
  const [createStep, setCreateStep] = useState(1);
  const [activeMealTab, setActiveMealTab] = useState<string>("Breakfast");
  // Ad-hoc meal-type/add-on creation was removed — meal configuration is
  // MASTER data, managed on Configuration → Meal Config only. The remove-mode
  // flag stays (always false) because chip renders still branch on it.
  const [removeMealTypeMode] = useState(false);
  const [hiddenBuiltinTypes, setHiddenBuiltinTypes] = useState<string[]>([]);
  const [hiddenAddonTypes, setHiddenAddonTypes] = useState<string[]>([]);

  const currentDayMeals = useMemo(() => meals.filter((m) => m.day === selectedDay && cardMatchesDate(m, viewDate)), [meals, selectedDay, viewDate]);
  const effectiveItemsTab = (activeItemsTab && (createData.mealTypes.includes(activeItemsTab) || activeItemsTab === "special-meals" || activeItemsTab === "dessert"))
    ? activeItemsTab
    : (createData.mealTypes[0] ?? "");
  const effectiveChoicePercentType = (activeChoicePercentType && createData.mealTypes.includes(activeChoicePercentType))
    ? activeChoicePercentType
    : (createData.mealTypes[0] ?? "");
  const totalChoicePercent = effectiveChoicePercentType
    ? (createData.choicePercentagesByType[effectiveChoicePercentType] ?? defaultChoicePercs(createData.choiceItems.length)).reduce((a, b) => a + b, 0)
    : 100;
  const stepValid: Record<number, boolean> = {
    1: createData.flightType.length > 0 && createData.forType !== "",
    2: createData.mealTypes.length > 0 && createData.mealTypes.every((t) =>
      createData.choiceItems.every((rec) => (rec[t] || []).some((it) => it.name.trim() !== ""))
    ),
    3: createData.mealTypes.length > 0 && createData.mealTypes.every((t) => {
      const p = createData.choicePercentagesByType[t];
      return !!p && p.reduce((a, b) => a + b, 0) === 100;
    }),
    4: createData.mealTypes.every((t) => Boolean(createData.servingTimes[t]?.start) && Boolean(createData.servingTimes[t]?.end)),
    5: true,
  };

  const resetCreateData = (day: string) => setCreateData(getInitialCreateData(day));
  const handleCreateOpenChange = (open: boolean) => {
    setCreateModalOpen(open);
    if (open) {
      resetCreateData(selectedDay);
      setActiveChoiceForItems(0);
      setPendingSpecialMeal(null);
      setActiveChoicePercentType("");
      setActiveItemsTab("");
      setActiveMealTab("Breakfast");
      setCreateErrors([]);
      setHiddenBuiltinTypes([]);
      setHiddenAddonTypes([]);
    }
  };

  const handleCreateSave = () => {
    const errors: string[] = [];
    if (createData.days.length === 0) errors.push("Select at least one Day.");
    if (createData.flightType.length === 0) errors.push("Flight Type is required.");
    if (!createData.forType) errors.push("'For' (Passengers/Crew) is required.");
    if (createData.mealTypes.length === 0) errors.push("At least one Meal Type must be selected.");
    createData.mealTypes.forEach((t) => {
      const percs = createData.choicePercentagesByType[t] ?? defaultChoicePercs(createData.choiceItems.length);
      if (percs.reduce((a, b) => a + b, 0) !== 100) errors.push(`${t}: Choice percentages must total 100%.`);
      createData.choiceItems.forEach((rec, idx) => {
        const items = (rec[t] || []).filter((it) => it.name.trim() !== "");
        if (items.length === 0) errors.push(`${choiceLabel(idx)}: At least one item required for ${t}.`);
      });
      if (!createData.servingTimes[t]?.start || !createData.servingTimes[t]?.end) errors.push(`Serving time required for ${t}.`);
    });

    if (errors.length > 0) {
      setCreateErrors(errors);
      return;
    }

    // One config copy per selected day × route × meal type.
    // No routes picked → a single shared "All routes" copy (route: undefined).
    const routeList: (string | undefined)[] = createData.routes.length > 0 ? createData.routes : [undefined];
    const newMeals: MealCard[] = createData.days.flatMap((day) => routeList.flatMap((route) => createData.mealTypes.map((mealType) => {
      const servingTime = createData.servingTimes[mealType] ?? { start: "11:00", end: "14:00" };
      const typePercs = createData.choicePercentagesByType[mealType] ?? defaultChoicePercs(createData.choiceItems.length);
      const choices = createData.choiceItems.map((rec, choiceIdx) => ({
        label: choiceLabel(choiceIdx),
        percentage: typePercs[choiceIdx] ?? 0,
        items: (rec[mealType] || []).filter((it) => it.name.trim() !== ""),
      }));
      // Special meals are a DAY-LEVEL plan with their own quantities — not part
      // of any service. They ride on the FIRST meal-type card only, so each
      // day×route carries exactly one copy (specialMealSetsForLeg dedupes per
      // code anyway, but one carrier keeps the data honest).
      const specialMeals: SpecialMeal[] = mealType === createData.mealTypes[0]
        ? createData.specialMealsPlan.map((sel) => ({
            type: sel.code,
            portions: sel.portions,
            items: sel.items || [],
            enabled: true,
          }))
        : [];
      const dessertItems = (createData.dessertByType[mealType] || []).filter((it) => it.name.trim() !== "");
      const firstDessert = dessertItems[0] ?? { name: "", weight: 0, calories: 0 };
      const saladItems = (createData.saladsByType[mealType] || []).filter((it) => it.name.trim() !== "");
      const freshFruitItems = (createData.freshFruitsByType[mealType] || []).filter((it) => it.name.trim() !== "");
      const customAddonData: Record<string, MealItem[]> = {};
      for (const addonName of createData.customAddonNames) {
        const items = (createData.customAddonsByType[addonName]?.[mealType] || []).filter((it) => it.name.trim() !== "");
        if (items.length > 0) customAddonData[addonName] = items;
      }

      const totalKcal = choices.reduce((sum, c) => sum + c.items.reduce((inner, it) => inner + (it.calories || 0), 0), 0) || 500;

      return {
        id: `meal-${Date.now()}-${day}-${route ?? "all"}-${mealType}`,
        day,
        // Empty bound → undefined (unbounded / applies on every date).
        effectiveFrom: createData.effectiveFrom || undefined,
        effectiveTo: createData.effectiveTo || undefined,
        mealType,
        flightType: createData.flightType,
        route: route || undefined,
        forType: createData.forType || "Passengers",
        choices,
        specialMeals,
        dessert: firstDessert,
        salads: saladItems.length > 0 ? saladItems : undefined,
        freshFruits: freshFruitItems.length > 0 ? freshFruitItems : undefined,
        customAddons: Object.keys(customAddonData).length > 0 ? customAddonData : undefined,
        servingTime,
        totalKcal,
        createdDate: new Date().toISOString().split('T')[0],
      };
    })));

    setMeals((prev) => [...prev, ...newMeals]);
    toast.success(
      createData.days.length > 1
        ? `Meal configured for ${createData.days.length} days`
        : "Meal configured successfully",
    );
    setCreateModalOpen(false);
    setCreateErrors([]);
    resetCreateData(selectedDay);
  };

  const getMealsByTypeForDay = (day: string) => {
    const dayMeals = meals.filter((m) => m.day === day && cardMatchesDate(m, viewDate));
    const filtered = dayMeals.filter(mealMatchesFilters);
    const grouped: Record<string, MealCard[]> = {};
    MEAL_TYPES.forEach((type) => {
      grouped[type] = filtered.filter((m) => m.mealType === type);
    });
    return grouped;
  };

  const configuredCount = currentDayMeals.length;

  const openEditModal = (meal: MealCard) => {
    setSelectedMeal(meal);
    setCreateData({
      days: [meal.day],
      effectiveFrom: meal.effectiveFrom ?? "",
      effectiveTo: meal.effectiveTo ?? "",
      flightType: meal.flightType,
      routes: meal.route ? [meal.route] : [],
      forType: meal.forType,
      mealTypes: [meal.mealType],
      choices: meal.choices,
      specialMealsPlan: meal.specialMeals.filter((sm) => sm.enabled).map((sm) => ({ code: sm.type, portions: sm.portions, items: sm.items || [] })),
      choiceItems: (meal.choices.length ? meal.choices : [{ items: [] }, { items: [] }]).map((ch) => ({
        ...MEAL_TYPES.reduce((acc, t) => { acc[t] = [] as MealItem[]; return acc; }, {} as Record<string, MealItem[]>),
        [meal.mealType]: ch.items ?? [],
      })),
      dessertByType: { [meal.mealType]: meal.dessert.name ? [meal.dessert] : [] },
      dessertAllocationByType: { [meal.mealType]: meal.dessert.name ? [100] : [] },
      saladsByType: { [meal.mealType]: meal.salads ?? [] },
      saladAllocationByType: { [meal.mealType]: (meal.salads ?? []).map(() => 100) },
      freshFruitsByType: { [meal.mealType]: meal.freshFruits ?? [] },
      freshFruitAllocationByType: { [meal.mealType]: (meal.freshFruits ?? []).map(() => 100) },
      customMealTypeNames: mealSlots.some(s => s.name === meal.mealType) ? [] : [meal.mealType],
      customAddonNames: Object.keys(meal.customAddons ?? {}),
      customAddonsByType: Object.fromEntries(Object.entries(meal.customAddons ?? {}).map(([k, v]) => [k, { [meal.mealType]: v }])),
      choicePercentagesByType: { [meal.mealType]: (meal.choices.length ? meal.choices.map((ch) => ch.percentage) : [60, 40]) },
      servingTimes: { [meal.mealType]: meal.servingTime },
    });
    setEditModalOpen(true);
  };

  // ── Choice helpers (support any number of CHOICE 01, 02, 03 …) ──
  const percsForType = (type: string): number[] =>
    createData.choicePercentagesByType[type] ?? defaultChoicePercs(createData.choiceItems.length);

  // Immutably update one choice's item list for a given meal type.
  const updateChoiceItems = (choiceIdx: number, type: string, updater: (items: MealItem[]) => MealItem[]) =>
    setCreateData((prev) => ({
      ...prev,
      choiceItems: prev.choiceItems.map((rec, i) => (i === choiceIdx ? { ...rec, [type]: updater(rec[type] || []) } : rec)),
    }));

  // Edit a choice's %; the last choice auto-balances so the split always totals 100.
  const setChoicePercent = (type: string, idx: number, value: number) =>
    setCreateData((prev) => {
      const arr = [...(prev.choicePercentagesByType[type] ?? defaultChoicePercs(prev.choiceItems.length))];
      arr[idx] = Math.max(0, Math.min(100, value));
      const last = arr.length - 1;
      if (idx !== last) arr[last] = Math.max(0, 100 - arr.slice(0, last).reduce((a, b) => a + b, 0));
      return { ...prev, choicePercentagesByType: { ...prev.choicePercentagesByType, [type]: arr } };
    });

  const addChoice = () =>
    setCreateData((prev) => {
      // Seed the new choice with a blank row for every active meal type.
      const rec: Record<string, MealItem[]> = MEAL_TYPES.reduce((acc, t) => { acc[t] = [] as MealItem[]; return acc; }, {} as Record<string, MealItem[]>);
      prev.mealTypes.forEach((t) => { rec[t] = [{ name: "", weight: 0, calories: 0 }]; });
      const percs = { ...prev.choicePercentagesByType };
      new Set<string>([...Object.keys(percs), ...prev.mealTypes]).forEach((t) => {
        const grown = [...(percs[t] ?? defaultChoicePercs(prev.choiceItems.length)), 0];
        grown[grown.length - 1] = Math.max(0, 100 - grown.slice(0, -1).reduce((a, b) => a + b, 0));
        percs[t] = grown;
      });
      return { ...prev, choiceItems: [...prev.choiceItems, rec], choicePercentagesByType: percs };
    });

  const removeChoice = (idx: number) => {
    setCreateData((prev) => {
      if (prev.choiceItems.length <= 2) return prev; // keep at least two choices
      const percs = { ...prev.choicePercentagesByType };
      Object.keys(percs).forEach((t) => {
        const arr = (percs[t] ?? []).filter((_, i) => i !== idx);
        if (arr.length) arr[arr.length - 1] = Math.max(0, 100 - arr.slice(0, -1).reduce((a, b) => a + b, 0));
        percs[t] = arr;
      });
      return { ...prev, choiceItems: prev.choiceItems.filter((_, i) => i !== idx), choicePercentagesByType: percs };
    });
    setActiveChoiceForItems((a) => Math.max(0, Math.min(a, createData.choiceItems.length - 2)));
  };

  const openViewMenu = (meal: MealCard) => {
    setSelectedMeal(meal);
    setViewMenuOpen(true);
  };

  const buildProductionNavState = (now: Date) => {
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(now);  dayAfter.setDate(dayAfter.getDate() + 2);
    const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const pad = (n: number) => String(n).padStart(2, "0");
    const dayAfterDateStr = `${dayAfter.getFullYear()}-${pad(dayAfter.getMonth()+1)}-${pad(dayAfter.getDate())}`;
    return {
      mealOrderConfirmation: {
        timestamp: now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + ", " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true }),
        totalFlights: 8,
        totalMeals: gmOrderData.totalMealsToday,
        tomorrowDayName: dayNames[tomorrow.getDay()],
        dayAfterDayName: dayNames[dayAfter.getDay()],
        dayAfterDateStr,
        validIntl: [],
        validDom: [],
      },
      forwardedMeals: meals.filter((m) => m.day === selectedDay && cardMatchesDate(m, viewDate)),
      forwardedDay: selectedDay,
    };
  };

  const handleForward = () => {
    const now = new Date();
    const timestamp = now.toLocaleString();
    setForwardedTime(timestamp);
    setIsForwarded(true);
    setForwardConfirmOpen(false);
    toast.success("Meal plan forwarded to Production — opening Production Order");
    navigate("/production-entry", { state: buildProductionNavState(now) });
  };

  const formatDateDDMMMYYYY = (dateStr: string) => {
    const date = new Date(dateStr);
    const day = date.getDate();
    const month = date.toLocaleDateString("en-GB", { month: "short" });
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  };

  const getNextDate = () => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    return next.toISOString().split('T')[0];
  };

  const mealMatchesFilters = (meal: MealCard) => {
    const flightTypeMatch = meal.flightType.some((ft) => (ft === "Domestic" && activeFilters.domestic) || (ft === "International" && activeFilters.international));
    const audienceMatch = (meal.forType === "Passengers" && activeFilters.passenger) || (meal.forType === "Crew" && activeFilters.crew);
    return flightTypeMatch && audienceMatch;
  };

  const hasAnyFilterActive = Object.values(activeFilters).some((v) => v);

  return (
    <>
      <PageHeader
        title="Menu Planning"
        subtitle="Configure daily meal service for passengers and crew"
        actions={
          <>
            {backUrl && (
              <Button variant="outline" onClick={() => navigate(backUrl)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back to Order Summary
              </Button>
            )}
          <Dialog open={createModalOpen} onOpenChange={handleCreateOpenChange}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-1" /> New Menu
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Menu Configuration</DialogTitle>
              </DialogHeader>

              <div className="space-y-5">
                {/* ── Basic Info ── */}
                <div className="grid grid-cols-5 gap-4">
                  <div>
                    <Label>Day</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="mt-1 flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        >
                          <span className={createData.days.length === 0 ? "text-muted-foreground" : "truncate"}>
                            {createData.days.length === 0
                              ? "Select days"
                              : createData.days.length === DAYS.length
                                ? "All days"
                                : DAYS.filter((d) => createData.days.includes(d)).map((d) => d.slice(0, 3)).join(", ")}
                          </span>
                          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-56 p-1">
                        <button
                          type="button"
                          onClick={() => setCreateData({
                            ...createData,
                            days: createData.days.length === DAYS.length ? [] : [...DAYS],
                          })}
                          className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-xs font-semibold text-primary hover:bg-accent"
                        >
                          {createData.days.length === DAYS.length ? "Clear all" : "Select all"}
                        </button>
                        <div className="my-1 h-px bg-border" />
                        {DAYS.map((day) => {
                          const active = createData.days.includes(day);
                          return (
                            <button
                              key={day}
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={active}
                              onClick={() => setCreateData({
                                ...createData,
                                days: active ? createData.days.filter((d) => d !== day) : [...createData.days, day],
                              })}
                              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                            >
                              <span className={`grid h-4 w-4 shrink-0 place-content-center rounded-sm border ${active ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>
                                {active && <Check className="h-3 w-3" />}
                              </span>
                              {day}
                            </button>
                          );
                        })}
                      </PopoverContent>
                    </Popover>
                    <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
                      {createData.days.length > 0
                        ? `Applies to ${createData.days.length} day${createData.days.length === 1 ? "" : "s"}.`
                        : "Select one or more days."}
                    </p>
                  </div>
                  <div>
                    <Label>Effective Dates</Label>
                    <div className="mt-1 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground w-9 shrink-0">From</span>
                        <Input
                          type="date"
                          value={createData.effectiveFrom}
                          max={createData.effectiveTo || undefined}
                          onChange={(e) => setCreateData({ ...createData, effectiveFrom: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground w-9 shrink-0">To</span>
                        <Input
                          type="date"
                          value={createData.effectiveTo}
                          min={createData.effectiveFrom || undefined}
                          onChange={(e) => setCreateData({ ...createData, effectiveTo: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
                      Leave both empty to apply on every date.
                    </p>
                  </div>
                  <div>
                    <Label>Flight Type</Label>
                    <div className="flex flex-col gap-1 mt-2">
                      {["Domestic", "International", "Both"].map((type) => (
                        <label key={type} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="flightType"
                            value={type}
                            checked={createData.flightType.join(",") === (type === "Both" ? "Domestic,International" : type)}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCreateData({ ...createData, flightType: val === "Both" ? ["Domestic", "International"] : [val], routes: [] });
                            }}
                            className="h-4 w-4"
                          />
                          <span className="text-sm">{type}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Route</Label>
                    {createData.flightType.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground italic">Select flight type first</p>
                    ) : (() => {
                      const availableRoutes = createData.flightType.includes("Domestic") && createData.flightType.includes("International")
                        ? [...DOMESTIC_ROUTES, ...INTERNATIONAL_ROUTES]
                        : createData.flightType.includes("Domestic")
                        ? DOMESTIC_ROUTES
                        : INTERNATIONAL_ROUTES;
                      return (
                        <>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="mt-1 flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                              >
                                <span className={createData.routes.length === 0 ? "text-muted-foreground" : "truncate"}>
                                  {createData.routes.length === 0
                                    ? "All routes"
                                    : createData.routes.length === 1
                                      ? createData.routes[0]
                                      : `${createData.routes.length} routes`}
                                </span>
                                <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-64 p-1">
                              <button
                                type="button"
                                onClick={() => setCreateData({ ...createData, routes: [] })}
                                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                              >
                                <span className={`grid h-4 w-4 shrink-0 place-content-center rounded-sm border ${createData.routes.length === 0 ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>
                                  {createData.routes.length === 0 && <Check className="h-3 w-3" />}
                                </span>
                                All routes <span className="text-[10px] text-muted-foreground">(shared)</span>
                              </button>
                              <div className="my-1 h-px bg-border" />
                              <div className="max-h-60 overflow-y-auto">
                                {availableRoutes.map((r) => {
                                  const active = createData.routes.includes(r);
                                  return (
                                    <button
                                      key={r}
                                      type="button"
                                      role="menuitemcheckbox"
                                      aria-checked={active}
                                      onClick={() => setCreateData({
                                        ...createData,
                                        routes: active ? createData.routes.filter((x) => x !== r) : [...createData.routes, r],
                                      })}
                                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                                    >
                                      <span className={`grid h-4 w-4 shrink-0 place-content-center rounded-sm border ${active ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>
                                        {active && <Check className="h-3 w-3" />}
                                      </span>
                                      {r}
                                    </button>
                                  );
                                })}
                              </div>
                            </PopoverContent>
                          </Popover>
                          <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
                            {createData.routes.length > 0
                              ? `Applies to ${createData.routes.length} route${createData.routes.length === 1 ? "" : "s"}.`
                              : "Shared menu — applies to every route."}
                          </p>
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <Label>For</Label>
                    <div className="flex flex-col gap-1 mt-2">
                      {["Passengers", "Crew", "Both"].map((type) => (
                        <label key={type} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="forType"
                            value={type}
                            checked={createData.forType === type}
                            onChange={(e) => setCreateData({ ...createData, forType: e.target.value })}
                            className="h-4 w-4"
                          />
                          <span className="text-sm">{type}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="border-t" />

                {/* ── Meal Configuration ── */}
                <div>
                  <div className="text-sm font-semibold mb-3">Meal Configuration</div>
                  {/* ── Meal type toggle buttons ── */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {mealTypeOptions.length === 0 && createData.customMealTypeNames.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        No meals configured. Add them in <strong>Configuration → Meal Config</strong>.
                      </span>
                    )}
                    {[...mealTypeOptions.filter(t => !hiddenBuiltinTypes.includes(t)), ...createData.customMealTypeNames].map((t) => {
                      const isSelected = createData.mealTypes.includes(t);
                      const isActive = activeMealTab === t;
                      const isBuiltin = mealTypeOptions.includes(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            if (removeMealTypeMode) return;
                            if (!isSelected) {
                              const copy = { ...createData };
                              copy.choiceItems = copy.choiceItems.map((rec) => ({
                                ...rec,
                                [t]: rec[t]?.length ? rec[t] : [{ name: "", weight: 0, calories: 0 }],
                              }));
                              copy.dessertByType = { ...copy.dessertByType, [t]: copy.dessertByType[t] ?? [] };
                              copy.dessertAllocationByType = { ...copy.dessertAllocationByType, [t]: copy.dessertAllocationByType[t] ?? [] };
                              copy.saladsByType = { ...copy.saladsByType, [t]: copy.saladsByType[t] ?? [] };
                              copy.saladAllocationByType = { ...copy.saladAllocationByType, [t]: copy.saladAllocationByType[t] ?? [] };
                              copy.freshFruitsByType = { ...copy.freshFruitsByType, [t]: copy.freshFruitsByType[t] ?? [] };
                              copy.freshFruitAllocationByType = { ...copy.freshFruitAllocationByType, [t]: copy.freshFruitAllocationByType[t] ?? [] };
                              copy.choicePercentagesByType = { ...copy.choicePercentagesByType, [t]: copy.choicePercentagesByType[t] ?? defaultChoicePercs(copy.choiceItems.length) };
                              copy.servingTimes = { ...copy.servingTimes, [t]: copy.servingTimes[t] ?? defaultServingFor(t) };
                              copy.mealTypes = [...copy.mealTypes, t];
                              setCreateData(copy);
                              setActiveMealTab(t);
                            } else {
                              setActiveMealTab(t);
                            }
                          }}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                            removeMealTypeMode
                              ? "bg-background text-muted-foreground border-border cursor-default"
                              : isSelected && isActive
                              ? "bg-primary text-primary-foreground border-primary"
                              : isSelected
                              ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
                              : isActive
                              ? "bg-muted border-border text-foreground"
                              : "bg-background text-muted-foreground border-border hover:bg-muted"
                          }`}
                        >
                          {t}
                          {removeMealTypeMode ? (
                            <span
                              className="ml-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center leading-none hover:bg-red-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                const newMealTypes = createData.mealTypes.filter((mt) => mt !== t);
                                if (isBuiltin) {
                                  setHiddenBuiltinTypes(prev => [...prev, t]);
                                } else {
                                  setCreateData({ ...createData, mealTypes: newMealTypes, customMealTypeNames: createData.customMealTypeNames.filter(n => n !== t) });
                                  if (isActive) setActiveMealTab(newMealTypes[0] ?? "");
                                  return;
                                }
                                setCreateData({ ...createData, mealTypes: newMealTypes });
                                if (isActive) setActiveMealTab(newMealTypes[0] ?? "");
                              }}
                            >×</span>
                          ) : (
                            isSelected && (
                              <span
                                className="ml-0.5 text-base leading-none opacity-60 hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newMealTypes = createData.mealTypes.filter((mt) => mt !== t);
                                  setCreateData({ ...createData, mealTypes: newMealTypes });
                                  setActiveMealTab(isActive ? (newMealTypes[0] ?? "Breakfast") : activeMealTab);
                                }}
                              >×</span>
                            )
                          )}
                        </button>
                      );
                    })}
                    {/* Meal types are MASTER data — managed on Configuration →
                        Meal Config, never invented ad-hoc inside a menu plan
                        (the "+ Add New" this row used to carry was removed on
                        that decision; no link back either, per user). */}
                    <div className="w-px bg-border mx-1 self-stretch" />
                    {(["special-meals", "dessert", "salads", "fresh-fruits"] as const)
                      .filter(t => !hiddenAddonTypes.includes(t))
                      .map((t) => {
                        const label = t === "special-meals" ? "Special Meals" : t === "dessert" ? "Dessert" : t === "salads" ? "Salads" : "Fresh Fruits";
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => { if (!removeMealTypeMode) setActiveMealTab(t); }}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                              removeMealTypeMode
                                ? "bg-background text-muted-foreground border-border cursor-default"
                                : activeMealTab === t
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-muted-foreground border-border hover:bg-muted"
                            }`}
                          >
                            {label}
                            {removeMealTypeMode && (
                              <span
                                className="ml-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center leading-none hover:bg-red-600"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setHiddenAddonTypes(prev => [...prev, t]);
                                  if (activeMealTab === t) setActiveMealTab("special-meals");
                                }}
                              >×</span>
                            )}
                          </button>
                        );
                      })}
                    {createData.customAddonNames.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => { if (!removeMealTypeMode) setActiveMealTab(`addon-${name}`); }}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                          removeMealTypeMode
                            ? "bg-background text-muted-foreground border-border cursor-default"
                            : activeMealTab === `addon-${name}`
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:bg-muted"
                        }`}
                      >
                        {name}
                        {removeMealTypeMode ? (
                          <span
                            className="ml-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center leading-none hover:bg-red-600"
                            onClick={(e) => {
                              e.stopPropagation();
                              const newNames = createData.customAddonNames.filter((n) => n !== name);
                              const newByType = { ...createData.customAddonsByType };
                              delete newByType[name];
                              setCreateData({ ...createData, customAddonNames: newNames, customAddonsByType: newByType });
                              if (activeMealTab === `addon-${name}`) setActiveMealTab("dessert");
                            }}
                          >×</span>
                        ) : (
                          <span
                            className="ml-0.5 text-base leading-none opacity-60 hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              const newNames = createData.customAddonNames.filter((n) => n !== name);
                              const newByType = { ...createData.customAddonsByType };
                              delete newByType[name];
                              setCreateData({ ...createData, customAddonNames: newNames, customAddonsByType: newByType });
                              if (activeMealTab === `addon-${name}`) setActiveMealTab("dessert");
                            }}
                          >×</span>
                        )}
                      </button>
                    ))}
                    {/* Add-on sections are fixed structure (Special Meals /
                        Dessert / Salads / Fresh Fruits) — the ad-hoc "+ Add
                        New" and per-dialog "Remove" were dropped with the
                        move to master-driven meal configuration. */}
                  </div>

                  {/* ── Content panel for regular meal types ── */}
                  {[...mealTypeOptions.filter(t => !hiddenBuiltinTypes.includes(t)), ...createData.customMealTypeNames].map((type) => {
                    if (activeMealTab !== type) return null;
                    const isIncluded = createData.mealTypes.includes(type);
                    if (!isIncluded) {
                      return (
                        <div key={type} className="text-center py-12 border rounded-lg bg-muted/20 text-sm text-muted-foreground">
                          Click <strong className="text-foreground">{type}</strong> above to include it in this meal plan
                        </div>
                      );
                    }
                    const activeIdx = Math.min(activeChoiceForItems, createData.choiceItems.length - 1);
                    const activeItems = createData.choiceItems[activeIdx]?.[type] || [];
                    const percs = percsForType(type);
                    const totalPct = percs.reduce((a, b) => a + b, 0);
                    return (
                      <div key={type} className="space-y-4">
                        {/* Choice selector — one radio per choice, add/remove supported */}
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                          {createData.choiceItems.map((_, cIdx) => (
                            <div key={cIdx} className="flex items-center gap-1.5">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`activeChoice-${type}`}
                                  checked={activeIdx === cIdx}
                                  onChange={() => setActiveChoiceForItems(cIdx)}
                                  className="h-4 w-4"
                                />
                                <span className="text-sm font-semibold">{choiceLabel(cIdx)}</span>
                              </label>
                              {createData.choiceItems.length > 2 && (
                                <button
                                  type="button"
                                  title={`Remove ${choiceLabel(cIdx)}`}
                                  onClick={() => removeChoice(cIdx)}
                                  className="text-muted-foreground hover:text-red-600 text-sm leading-none"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => { addChoice(); setActiveChoiceForItems(createData.choiceItems.length); }}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            + Add Choice
                          </button>
                        </div>

                        {/* Items for active choice */}
                        <div className="rounded-lg border p-3">
                          <div className="font-semibold text-sm mb-2">
                            {type} — {choiceLabel(activeIdx)}
                          </div>
                          <div className="flex gap-2 items-center text-xs font-semibold text-muted-foreground border-b pb-1 mb-2">
                            <div className="flex-1">Item</div>
                            <div className="w-20 text-center">Weight (g)</div>
                            <div className="w-16 text-center">Kcal</div>
                            <div className="w-16 text-center" title="Portions of this item in ONE meal">Qty</div>
                            <div className="w-16" />
                          </div>
                          {activeItems.map((item, itemIdx) => (
                            <div key={itemIdx} className="flex gap-2 items-center mb-2">
                              {(FOOD_ITEMS[type] || []).length > 0 ? (
                                <select
                                  value={item.name}
                                  onChange={(e) => {
                                    const found = (FOOD_ITEMS[type] || []).find((fi) => fi.name === e.target.value);
                                    updateChoiceItems(activeIdx, type, (items) => items.map((it, i) => (i === itemIdx ? withProfile(found, it.qtyPerMeal) : it)));
                                  }}
                                  className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                                >
                                  <option value="">Select item…</option>
                                  {(FOOD_ITEMS[type] || []).map((fi) => (
                                    <option key={fi.name} value={fi.name}>{fi.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  value={item.name}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    updateChoiceItems(activeIdx, type, (items) => items.map((it, i) => (i === itemIdx ? { ...it, name: value } : it)));
                                  }}
                                  placeholder="Item name…"
                                  className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                                />
                              )}
                              {(FOOD_ITEMS[type] || []).length > 0 ? (
                                <>
                                  <div className="w-20 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums text-muted-foreground">
                                    {item.weight > 0 ? `${item.weight}g` : "—"}
                                  </div>
                                  <div className="w-16 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums text-muted-foreground">
                                    {item.calories > 0 ? item.calories : "—"}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <input
                                    type="number"
                                    value={item.weight || ""}
                                    onChange={(e) => {
                                      const value = Number(e.target.value);
                                      updateChoiceItems(activeIdx, type, (items) => items.map((it, i) => (i === itemIdx ? { ...it, weight: value } : it)));
                                    }}
                                    placeholder="g"
                                    className="w-20 rounded border border-border bg-background px-2 py-1.5 text-sm text-center"
                                  />
                                  <input
                                    type="number"
                                    value={item.calories || ""}
                                    onChange={(e) => {
                                      const value = Number(e.target.value);
                                      updateChoiceItems(activeIdx, type, (items) => items.map((it, i) => (i === itemIdx ? { ...it, calories: value } : it)));
                                    }}
                                    placeholder="kcal"
                                    className="w-16 rounded border border-border bg-background px-2 py-1.5 text-sm text-center"
                                  />
                                </>
                              )}
                              <input
                                type="number"
                                min={1}
                                step={1}
                                value={item.qtyPerMeal ?? 1}
                                onChange={(e) => {
                                  const value = Math.max(1, Math.round(Number(e.target.value) || 1));
                                  updateChoiceItems(activeIdx, type, (items) => items.map((it, i) => (i === itemIdx ? { ...it, qtyPerMeal: value } : it)));
                                }}
                                title={`${item.qtyPerMeal ?? 1} portion(s) of ${item.name || "this item"} per meal`}
                                className="w-16 rounded border border-border bg-background px-2 py-1.5 text-sm text-center tabular-nums"
                              />
                              <button
                                type="button"
                                className="w-16 text-right text-red-600 text-sm shrink-0"
                                onClick={() => updateChoiceItems(activeIdx, type, (items) => items.filter((_, i) => i !== itemIdx))}
                              >
                                × Remove
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="text-blue-600 text-sm mt-1"
                            onClick={() => updateChoiceItems(activeIdx, type, (items) => [...items, { name: "", weight: 0, calories: 0, qtyPerMeal: 1 }])}
                          >
                            + Add Item
                          </button>
                        </div>

                        {/* All choices summary */}
                        <div className="grid grid-cols-2 gap-3">
                          {createData.choiceItems.map((rec, cIdx) => {
                            const summaryItems = (rec[type] || []).filter((it) => it.name.trim());
                            const st = choiceStyle(cIdx);
                            return (
                              <div key={cIdx} className={`rounded-md border p-2.5 text-xs ${st.chip}`}>
                                <div className={`font-semibold mb-1.5 ${st.text}`}>
                                  {choiceLabel(cIdx)}
                                </div>
                                {summaryItems.length === 0 ? (
                                  <div className="text-muted-foreground italic">No items yet</div>
                                ) : summaryItems.map((it, i) => (
                                  <div key={i} className="py-0.5">
                                    <span className="font-medium">{it.name}</span>
                                    {qtyMark(it)}
                                    <span className="text-muted-foreground"> — {it.weight}g · {it.calories} kcal</span>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>

                        {/* Meal Percentage */}
                        <div className="rounded-lg border p-3 space-y-2">
                          <div className="font-semibold text-sm">Meal Percentage</div>
                          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                            {createData.choiceItems.map((_, cIdx) => {
                              const isLast = cIdx === createData.choiceItems.length - 1;
                              return (
                                <div key={cIdx}>
                                  <Label className="text-xs">{choiceLabel(cIdx)} %{isLast ? " (auto)" : ""}</Label>
                                  <Input
                                    type="number" min={0} max={100}
                                    value={percs[cIdx] ?? 0}
                                    readOnly={isLast}
                                    onChange={isLast ? undefined : (e) => setChoicePercent(type, cIdx, Number(e.target.value) || 0)}
                                    className={`mt-1 h-8${isLast ? " bg-muted/40" : ""}`}
                                  />
                                </div>
                              );
                            })}
                          </div>
                          {totalPct !== 100 && (
                            <div className="text-xs text-destructive">Must total 100%. Currently: {totalPct}%</div>
                          )}
                        </div>

                        {/* Serving Time */}
                        <div className="rounded-lg border p-3 space-y-2">
                          <div className="font-semibold text-sm">Serving Time</div>
                          <div className="flex gap-3 items-center">
                            <Label className="text-xs shrink-0">Start</Label>
                            <Input
                              type="time"
                              value={createData.servingTimes[type]?.start ?? defaultServingFor(type).start}
                              onChange={(e) => setCreateData({ ...createData, servingTimes: { ...createData.servingTimes, [type]: { ...(createData.servingTimes[type] || {}), start: e.target.value } } })}
                              className="h-8 w-32"
                            />
                            <Label className="text-xs shrink-0">End</Label>
                            <Input
                              type="time"
                              value={createData.servingTimes[type]?.end ?? defaultServingFor(type).end}
                              onChange={(e) => setCreateData({ ...createData, servingTimes: { ...createData.servingTimes, [type]: { ...(createData.servingTimes[type] || {}), end: e.target.value } } })}
                              className="h-8 w-32"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* ── Special Meals Panel ──
                      DAY-LEVEL: a special meal is its own plan with its own
                      quantity. It is NOT part of Breakfast / Lunch / any
                      service, so there is exactly ONE list here — not one
                      section per meal type. */}
                  {activeMealTab === "special-meals" && !hiddenAddonTypes.includes("special-meals") && (
                    <div className="space-y-3">
                      <div className="rounded-lg border p-3 space-y-2">
                            <div className="font-semibold text-sm border-b pb-2">
                              Special Meals
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                own quantities — independent of the meal services above
                              </span>
                            </div>

                            {createData.specialMealsPlan.map((sel, smIdx) => (
                              <div key={sel.code} className="rounded-lg border border-purple-200 p-3 space-y-2 bg-purple-50/40">
                                <div className="flex items-start justify-between">
                                  <div className="space-y-1">
                                    <div>
                                      <span className="text-sm font-semibold text-purple-800">{sel.code}</span>
                                      <span className="text-xs text-muted-foreground ml-2">— {SPECIAL_MEAL_INFO[sel.code]?.label}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className="text-muted-foreground">Portions:</span>
                                      {sel.portions === "As per demand" ? (
                                        <span className="font-medium">As Per Demand</span>
                                      ) : (
                                        <Input
                                          type="number"
                                          min={1}
                                          value={sel.portions as number}
                                          onChange={(e) => {
                                            const updatedSMs = createData.specialMealsPlan.map((sm, si) =>
                                              si === smIdx ? { ...sm, portions: Number(e.target.value) } : sm
                                            );
                                            setCreateData({ ...createData, specialMealsPlan: updatedSMs });
                                          }}
                                          className="h-6 w-16 text-xs"
                                        />
                                      )}
                                      <label className="flex items-center gap-1 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={sel.portions === "As per demand"}
                                          onChange={(e) => {
                                            const updatedSMs = createData.specialMealsPlan.map((sm, si) =>
                                              si === smIdx ? { ...sm, portions: e.target.checked ? "As per demand" : 1 } : sm
                                            );
                                            setCreateData({ ...createData, specialMealsPlan: updatedSMs });
                                          }}
                                          className="h-3 w-3"
                                        />
                                        <span>As Per Demand</span>
                                      </label>
                                    </div>
                                  </div>
                                  <button type="button" className="text-red-500 text-xs hover:text-red-700"
                                    onClick={() => setCreateData({ ...createData, specialMealsPlan: createData.specialMealsPlan.filter((_, i) => i !== smIdx) })}>
                                    × Remove
                                  </button>
                                </div>
                                <div className="flex gap-2 items-center text-xs font-semibold text-muted-foreground border-b pb-1">
                                  <div className="flex-1">Item</div>
                                  <div className="w-16 text-center" title="Portions of this item in ONE meal">Qty / meal</div>
                                  <div className="w-20 text-center">Weight (g)</div>
                                  <div className="w-16 text-center">Kcal</div>
                                  <div className="w-16" />
                                </div>
                                {(sel.items || []).map((item, itemIdx) => (
                                  <div key={itemIdx} className="flex gap-2 items-center">
                                    <select
                                      value={item.name}
                                      onChange={(e) => {
                                        const found = SPECIAL_FOOD_POOL.find((fi) => fi.name === e.target.value);
                                        const copy = { ...createData };
                                        const updatedSMs = copy.specialMealsPlan.map((sm, si) =>
                                          si === smIdx ? { ...sm, items: (sm.items || []).map((it, ii) => ii === itemIdx ? (withProfile(found, it.qtyPerMeal)) : it) } : sm
                                        );
                                        copy.specialMealsPlan = updatedSMs;
                                        setCreateData(copy);
                                      }}
                                      className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                                    >
                                      <option value="">Select item…</option>
                                      {SPECIAL_FOOD_POOL.map((fi) => (
                                        <option key={fi.name} value={fi.name}>{fi.name}</option>
                                      ))}
                                    </select>
                                    {/* Assembly quantity — how many portions of this
                                        dish go into one such meal. Production sizes
                                        the dish's pool by it, and packaging reserves
                                        that many per meal it assembles. */}
                                    <input
                                      type="number"
                                      min={1}
                                      step={1}
                                      value={item.qtyPerMeal ?? 1}
                                      onChange={(e) => {
                                        const value = Math.max(1, Math.round(Number(e.target.value) || 1));
                                        const copy = { ...createData };
                                        const updatedSMs = copy.specialMealsPlan.map((sm, si) =>
                                          si === smIdx ? { ...sm, items: (sm.items || []).map((it, ii) => ii === itemIdx ? { ...it, qtyPerMeal: value } : it) } : sm
                                        );
                                        copy.specialMealsPlan = updatedSMs;
                                        setCreateData(copy);
                                      }}
                                      title={`${item.qtyPerMeal ?? 1} portion(s) of ${item.name || "this item"} per ${sel.code || "meal"}`}
                                      className="w-16 rounded border border-border bg-background px-2 py-1.5 text-sm text-center tabular-nums"
                                    />
                                    <div className="w-20 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums text-muted-foreground">
                                      {item.weight > 0 ? `${item.weight}g` : "—"}
                                    </div>
                                    <div className="w-16 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums text-muted-foreground">
                                      {item.calories > 0 ? item.calories : "—"}
                                    </div>
                                    <button
                                      type="button"
                                      className="w-16 text-right text-red-600 text-sm shrink-0"
                                      onClick={() => {
                                        const copy = { ...createData };
                                        const updatedSMs = copy.specialMealsPlan.map((sm, si) =>
                                          si === smIdx ? { ...sm, items: (sm.items || []).filter((_, ii) => ii !== itemIdx) } : sm
                                        );
                                        copy.specialMealsPlan = updatedSMs;
                                        setCreateData(copy);
                                      }}
                                    >
                                      × Remove
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  className="text-blue-600 text-sm"
                                  onClick={() => {
                                    const copy = { ...createData };
                                    const updatedSMs = copy.specialMealsPlan.map((sm, si) =>
                                      si === smIdx ? { ...sm, items: [...(sm.items || []), { name: "", weight: 0, calories: 0, qtyPerMeal: 1 }] } : sm
                                    );
                                    copy.specialMealsPlan = updatedSMs;
                                    setCreateData(copy);
                                  }}
                                >
                                  + Add Item
                                </button>
                              </div>
                            ))}

                            {pendingSpecialMeal !== null ? (
                              <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
                                <div>
                                  <Label className="text-xs">Select Special Meal</Label>
                                  <select
                                    value={pendingSpecialMeal.code}
                                    onChange={(e) => setPendingSpecialMeal({ ...pendingSpecialMeal, code: e.target.value })}
                                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                                  >
                                    <option value="">Choose special meal type…</option>
                                    {Object.values(SPECIAL_MEAL_INFO)
                                      .filter((info) => !createData.specialMealsPlan.some((s) => s.code === info.code))
                                      .map((info) => (
                                        <option key={info.code} value={info.code}>{info.code} — {info.label}</option>
                                      ))}
                                  </select>
                                </div>
                                {pendingSpecialMeal.code && SPECIAL_MEAL_INFO[pendingSpecialMeal.code] && (
                                  <>
                                    <div className="text-xs italic px-2 py-1.5 bg-blue-50 rounded border border-blue-100 text-blue-800">
                                      {SPECIAL_MEAL_INFO[pendingSpecialMeal.code].note}
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                      <div>
                                        <div className="font-semibold text-green-700 mb-1">✓ Allowed</div>
                                        <ul className="space-y-0.5">
                                          {SPECIAL_MEAL_INFO[pendingSpecialMeal.code].allowed.map((itm) => (
                                            <li key={itm} className="text-green-700">• {itm}</li>
                                          ))}
                                        </ul>
                                      </div>
                                      <div>
                                        <div className="font-semibold text-red-700 mb-1">✗ Not Allowed</div>
                                        <ul className="space-y-0.5">
                                          {SPECIAL_MEAL_INFO[pendingSpecialMeal.code].notAllowed.map((itm) => (
                                            <li key={itm} className="text-red-600">• {itm}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    </div>
                                    <div>
                                      <Label className="text-xs mb-2 block">Items</Label>
                                      <div className="flex gap-2 items-center text-xs font-semibold text-muted-foreground border-b pb-1 mb-2">
                                        <div className="flex-1">Item</div>
                                        <div className="w-16 text-center" title="Portions of this item in ONE meal">Qty / meal</div>
                                        <div className="w-20 text-center">Weight (g)</div>
                                        <div className="w-16 text-center">Kcal</div>
                                        <div className="w-16" />
                                      </div>
                                      {(pendingSpecialMeal.items || []).map((item, itemIdx) => (
                                        <div key={itemIdx} className="flex gap-2 items-center mb-2">
                                          <select
                                            value={item.name}
                                            onChange={(e) => {
                                              const found = SPECIAL_FOOD_POOL.find((fi) => fi.name === e.target.value);
                                              setPendingSpecialMeal({
                                                ...pendingSpecialMeal,
                                                items: (pendingSpecialMeal.items || []).map((it, ii) =>
                                                  ii === itemIdx ? (withProfile(found, it.qtyPerMeal)) : it
                                                ),
                                              });
                                            }}
                                            className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                                          >
                                            <option value="">Select item…</option>
                                            {SPECIAL_FOOD_POOL.map((fi) => (
                                              <option key={fi.name} value={fi.name}>{fi.name}</option>
                                            ))}
                                          </select>
                                          {/* Assembly quantity — portions of this dish
                                              per one meal of this code. */}
                                          <input
                                            type="number"
                                            min={1}
                                            step={1}
                                            value={item.qtyPerMeal ?? 1}
                                            onChange={(e) => {
                                              const value = Math.max(1, Math.round(Number(e.target.value) || 1));
                                              setPendingSpecialMeal({
                                                ...pendingSpecialMeal,
                                                items: (pendingSpecialMeal.items || []).map((it, ii) =>
                                                  ii === itemIdx ? { ...it, qtyPerMeal: value } : it
                                                ),
                                              });
                                            }}
                                            title={`${item.qtyPerMeal ?? 1} portion(s) of ${item.name || "this item"} per ${pendingSpecialMeal.code || "meal"}`}
                                            className="w-16 rounded border border-border bg-background px-2 py-1.5 text-sm text-center tabular-nums"
                                          />
                                          <div className="w-20 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums text-muted-foreground">
                                            {item.weight > 0 ? `${item.weight}g` : "—"}
                                          </div>
                                          <div className="w-16 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums text-muted-foreground">
                                            {item.calories > 0 ? item.calories : "—"}
                                          </div>
                                          <button
                                            type="button"
                                            className="w-16 text-right text-red-600 text-sm shrink-0"
                                            onClick={() => setPendingSpecialMeal({ ...pendingSpecialMeal, items: (pendingSpecialMeal.items || []).filter((_, ii) => ii !== itemIdx) })}
                                          >
                                            × Remove
                                          </button>
                                        </div>
                                      ))}
                                      <button
                                        type="button"
                                        className="text-blue-600 text-sm"
                                        onClick={() => setPendingSpecialMeal({ ...pendingSpecialMeal, items: [...(pendingSpecialMeal.items || []), { name: "", weight: 0, calories: 0, qtyPerMeal: 1 }] })}
                                      >
                                        + Add Item
                                      </button>
                                    </div>
                                    <div className="flex gap-2 justify-end pt-2">
                                      <Button type="button" size="sm" className="h-8"
                                        onClick={() => {
                                          if (!pendingSpecialMeal.code) return;
                                          setCreateData({ ...createData, specialMealsPlan: [...createData.specialMealsPlan, { code: pendingSpecialMeal.code, portions: pendingSpecialMeal.portions, items: pendingSpecialMeal.items || [] }] });
                                          setPendingSpecialMeal(null);
                                        }}>
                                        Done
                                      </Button>
                                      <Button type="button" variant="outline" size="sm" className="h-8"
                                        onClick={() => setPendingSpecialMeal(null)}>
                                        Cancel
                                      </Button>
                                    </div>
                                  </>
                                )}
                              </div>
                            ) : (
                              <button type="button" className="text-blue-600 text-sm"
                                onClick={() => setPendingSpecialMeal({ code: "", portions: 1, items: [] })}>
                                + Add Special Meal
                              </button>
                            )}
                      </div>
                    </div>
                  )}

                  {/* ── Dessert Panel ── */}
                  {activeMealTab === "dessert" && !hiddenAddonTypes.includes("dessert") && (
                    <div className="space-y-3">
                      {createData.mealTypes.length === 0 ? (
                        <div className="text-sm text-muted-foreground text-center py-4 border rounded-lg bg-muted/20">
                          Enable meal types to configure dessert
                        </div>
                      ) : (
                        createData.mealTypes.map((type) => {
                          const dessertItems = createData.dessertByType[type] || [];
                          return (
                            <div key={type} className="rounded-lg border p-3 space-y-2">
                              <div className="font-semibold text-sm">{type}</div>
                              {dessertItems.map((dItem, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                  <select
                                    value={dItem.name}
                                    onChange={(e) => {
                                      const found = DESSERT_ITEMS.find((d) => d.name === e.target.value);
                                      const copy = { ...createData };
                                      copy.dessertByType = {
                                        ...copy.dessertByType,
                                        [type]: copy.dessertByType[type].map((it, i) =>
                                          i === idx ? (withProfile(found, it.qtyPerMeal)) : it
                                        ),
                                      };
                                      setCreateData(copy);
                                    }}
                                    className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                                  >
                                    <option value="">Select dessert…</option>
                                    {DESSERT_ITEMS.map((d) => (
                                      <option key={d.name} value={d.name}>{d.name}</option>
                                    ))}
                                  </select>
                                  {dItem.name && (
                                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                                      {dItem.weight}g · {dItem.calories} kcal
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1 shrink-0" title={`${dItem.qtyPerMeal ?? 1} portion(s) per meal`}>
                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Qty</span>
                                    <Input
                                      type="number"
                                      min={1}
                                      step={1}
                                      value={dItem.qtyPerMeal ?? 1}
                                      onChange={(e) => {
                                        const value = Math.max(1, Math.round(Number(e.target.value) || 1));
                                        const copy = { ...createData };
                                        copy.dessertByType = { ...copy.dessertByType, [type]: copy.dessertByType[type].map((it, i) => i === idx ? { ...it, qtyPerMeal: value } : it) };
                                        setCreateData(copy);
                                      }}
                                      className="w-14 h-7 text-xs text-center tabular-nums"
                                    />
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Input
                                      type="number"
                                      min={1}
                                      max={100}
                                      value={(createData.dessertAllocationByType[type] || [])[idx] ?? 100}
                                      onChange={(e) => {
                                        const copy = { ...createData };
                                        const arr = [...(copy.dessertAllocationByType[type] || [])];
                                        arr[idx] = Number(e.target.value);
                                        copy.dessertAllocationByType = { ...copy.dessertAllocationByType, [type]: arr };
                                        setCreateData(copy);
                                      }}
                                      className="w-16 h-7 text-xs"
                                    />
                                    <span className="text-xs text-muted-foreground">%</span>
                                  </div>
                                  <button
                                    type="button"
                                    className="text-red-500 text-sm shrink-0"
                                    onClick={() => {
                                      const copy = { ...createData };
                                      copy.dessertByType = { ...copy.dessertByType, [type]: copy.dessertByType[type].filter((_, i) => i !== idx) };
                                      copy.dessertAllocationByType = { ...copy.dessertAllocationByType, [type]: (copy.dessertAllocationByType[type] || []).filter((_, i) => i !== idx) };
                                      setCreateData(copy);
                                    }}
                                  >
                                    × Remove
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                className="text-blue-600 text-sm"
                                onClick={() => {
                                  const copy = { ...createData };
                                  copy.dessertByType = { ...copy.dessertByType, [type]: [...(copy.dessertByType[type] || []), { name: "", weight: 0, calories: 0, qtyPerMeal: 1 }] };
                                  copy.dessertAllocationByType = { ...copy.dessertAllocationByType, [type]: [...(copy.dessertAllocationByType[type] || []), 100] };
                                  setCreateData(copy);
                                }}
                              >
                                + Add Item
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {/* ── Salads Panel ── */}
                  {activeMealTab === "salads" && !hiddenAddonTypes.includes("salads") && (
                    <div className="space-y-3">
                      {createData.mealTypes.length === 0 ? (
                        <div className="text-sm text-muted-foreground text-center py-4 border rounded-lg bg-muted/20">
                          Enable meal types to configure salads
                        </div>
                      ) : (
                        createData.mealTypes.map((type) => {
                          const saladItems = createData.saladsByType[type] || [];
                          return (
                            <div key={type} className="rounded-lg border p-3 space-y-2">
                              <div className="font-semibold text-sm">{type}</div>
                              {saladItems.map((sItem, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                  <select
                                    value={sItem.name}
                                    onChange={(e) => {
                                      const found = SALAD_ITEMS.find((s) => s.name === e.target.value);
                                      const copy = { ...createData };
                                      copy.saladsByType = {
                                        ...copy.saladsByType,
                                        [type]: copy.saladsByType[type].map((it, i) =>
                                          i === idx ? (withProfile(found, it.qtyPerMeal)) : it
                                        ),
                                      };
                                      setCreateData(copy);
                                    }}
                                    className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                                  >
                                    <option value="">Select salad…</option>
                                    {SALAD_ITEMS.map((s) => (
                                      <option key={s.name} value={s.name}>{s.name}</option>
                                    ))}
                                  </select>
                                  {sItem.name && (
                                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                                      {sItem.weight}g · {sItem.calories} kcal
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1 shrink-0" title={`${sItem.qtyPerMeal ?? 1} portion(s) per meal`}>
                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Qty</span>
                                    <Input
                                      type="number"
                                      min={1}
                                      step={1}
                                      value={sItem.qtyPerMeal ?? 1}
                                      onChange={(e) => {
                                        const value = Math.max(1, Math.round(Number(e.target.value) || 1));
                                        const copy = { ...createData };
                                        copy.saladsByType = { ...copy.saladsByType, [type]: copy.saladsByType[type].map((it, i) => i === idx ? { ...it, qtyPerMeal: value } : it) };
                                        setCreateData(copy);
                                      }}
                                      className="w-14 h-7 text-xs text-center tabular-nums"
                                    />
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Input
                                      type="number"
                                      min={1}
                                      max={100}
                                      value={(createData.saladAllocationByType[type] || [])[idx] ?? 100}
                                      onChange={(e) => {
                                        const copy = { ...createData };
                                        const arr = [...(copy.saladAllocationByType[type] || [])];
                                        arr[idx] = Number(e.target.value);
                                        copy.saladAllocationByType = { ...copy.saladAllocationByType, [type]: arr };
                                        setCreateData(copy);
                                      }}
                                      className="w-16 h-7 text-xs"
                                    />
                                    <span className="text-xs text-muted-foreground">%</span>
                                  </div>
                                  <button
                                    type="button"
                                    className="text-red-500 text-sm shrink-0"
                                    onClick={() => {
                                      const copy = { ...createData };
                                      copy.saladsByType = { ...copy.saladsByType, [type]: copy.saladsByType[type].filter((_, i) => i !== idx) };
                                      copy.saladAllocationByType = { ...copy.saladAllocationByType, [type]: (copy.saladAllocationByType[type] || []).filter((_, i) => i !== idx) };
                                      setCreateData(copy);
                                    }}
                                  >
                                    × Remove
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                className="text-blue-600 text-sm"
                                onClick={() => {
                                  const copy = { ...createData };
                                  copy.saladsByType = { ...copy.saladsByType, [type]: [...(copy.saladsByType[type] || []), { name: "", weight: 0, calories: 0, qtyPerMeal: 1 }] };
                                  copy.saladAllocationByType = { ...copy.saladAllocationByType, [type]: [...(copy.saladAllocationByType[type] || []), 100] };
                                  setCreateData(copy);
                                }}
                              >
                                + Add Item
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {/* ── Custom Add-on Panels ── */}
                  {createData.customAddonNames.map((addonName) => activeMealTab === `addon-${addonName}` && (
                    <div key={addonName} className="space-y-3">
                      {createData.mealTypes.length === 0 ? (
                        <div className="text-sm text-muted-foreground text-center py-4 border rounded-lg bg-muted/20">
                          Enable meal types to configure {addonName}
                        </div>
                      ) : (
                        createData.mealTypes.map((type) => {
                          const addonItems = createData.customAddonsByType[addonName]?.[type] || [];
                          return (
                            <div key={type} className="rounded-lg border p-3 space-y-2">
                              <div className="font-semibold text-sm">{type}</div>
                              {addonItems.map((aItem, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                  <input
                                    type="text"
                                    value={aItem.name}
                                    onChange={(e) => {
                                      const copy = { ...createData };
                                      const updated = (copy.customAddonsByType[addonName]?.[type] || []).map((it, i) => i === idx ? { ...it, name: e.target.value } : it);
                                      copy.customAddonsByType = { ...copy.customAddonsByType, [addonName]: { ...(copy.customAddonsByType[addonName] || {}), [type]: updated } };
                                      setCreateData(copy);
                                    }}
                                    placeholder="Item name…"
                                    className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                                  />
                                  <input
                                    type="number"
                                    value={aItem.weight || ""}
                                    onChange={(e) => {
                                      const copy = { ...createData };
                                      const updated = (copy.customAddonsByType[addonName]?.[type] || []).map((it, i) => i === idx ? { ...it, weight: Number(e.target.value) } : it);
                                      copy.customAddonsByType = { ...copy.customAddonsByType, [addonName]: { ...(copy.customAddonsByType[addonName] || {}), [type]: updated } };
                                      setCreateData(copy);
                                    }}
                                    placeholder="g"
                                    className="w-20 rounded border border-border bg-background px-2 py-1.5 text-sm text-center"
                                  />
                                  <input
                                    type="number"
                                    value={aItem.calories || ""}
                                    onChange={(e) => {
                                      const copy = { ...createData };
                                      const updated = (copy.customAddonsByType[addonName]?.[type] || []).map((it, i) => i === idx ? { ...it, calories: Number(e.target.value) } : it);
                                      copy.customAddonsByType = { ...copy.customAddonsByType, [addonName]: { ...(copy.customAddonsByType[addonName] || {}), [type]: updated } };
                                      setCreateData(copy);
                                    }}
                                    placeholder="kcal"
                                    className="w-16 rounded border border-border bg-background px-2 py-1.5 text-sm text-center"
                                  />
                                  <div className="flex items-center gap-1 shrink-0" title={`${aItem.qtyPerMeal ?? 1} portion(s) per meal`}>
                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Qty</span>
                                    <input
                                      type="number"
                                      min={1}
                                      step={1}
                                      value={aItem.qtyPerMeal ?? 1}
                                      onChange={(e) => {
                                        const value = Math.max(1, Math.round(Number(e.target.value) || 1));
                                        const copy = { ...createData };
                                        const updated = (copy.customAddonsByType[addonName]?.[type] || []).map((it, i) => i === idx ? { ...it, qtyPerMeal: value } : it);
                                        copy.customAddonsByType = { ...copy.customAddonsByType, [addonName]: { ...(copy.customAddonsByType[addonName] || {}), [type]: updated } };
                                        setCreateData(copy);
                                      }}
                                      className="w-14 rounded border border-border bg-background px-2 py-1.5 text-sm text-center tabular-nums"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    className="text-red-500 text-sm shrink-0"
                                    onClick={() => {
                                      const copy = { ...createData };
                                      const updated = (copy.customAddonsByType[addonName]?.[type] || []).filter((_, i) => i !== idx);
                                      copy.customAddonsByType = { ...copy.customAddonsByType, [addonName]: { ...(copy.customAddonsByType[addonName] || {}), [type]: updated } };
                                      setCreateData(copy);
                                    }}
                                  >× Remove</button>
                                </div>
                              ))}
                              <button
                                type="button"
                                className="text-blue-600 text-sm"
                                onClick={() => {
                                  const copy = { ...createData };
                                  const existing = copy.customAddonsByType[addonName]?.[type] || [];
                                  copy.customAddonsByType = { ...copy.customAddonsByType, [addonName]: { ...(copy.customAddonsByType[addonName] || {}), [type]: [...existing, { name: "", weight: 0, calories: 0, qtyPerMeal: 1 }] } };
                                  setCreateData(copy);
                                }}
                              >+ Add Item</button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  ))}

                  {/* ── Fresh Fruits Panel ── */}
                  {activeMealTab === "fresh-fruits" && !hiddenAddonTypes.includes("fresh-fruits") && (
                    <div className="space-y-3">
                      {createData.mealTypes.length === 0 ? (
                        <div className="text-sm text-muted-foreground text-center py-4 border rounded-lg bg-muted/20">
                          Enable meal types to configure fresh fruits
                        </div>
                      ) : (
                        createData.mealTypes.map((type) => {
                          const fruitItems = createData.freshFruitsByType[type] || [];
                          return (
                            <div key={type} className="rounded-lg border p-3 space-y-2">
                              <div className="font-semibold text-sm">{type}</div>
                              {fruitItems.map((fItem, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                  <select
                                    value={fItem.name}
                                    onChange={(e) => {
                                      const found = FRESH_FRUIT_ITEMS.find((f) => f.name === e.target.value);
                                      const copy = { ...createData };
                                      copy.freshFruitsByType = {
                                        ...copy.freshFruitsByType,
                                        [type]: copy.freshFruitsByType[type].map((it, i) =>
                                          i === idx ? (withProfile(found, it.qtyPerMeal)) : it
                                        ),
                                      };
                                      setCreateData(copy);
                                    }}
                                    className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                                  >
                                    <option value="">Select fruit…</option>
                                    {FRESH_FRUIT_ITEMS.map((f) => (
                                      <option key={f.name} value={f.name}>{f.name}</option>
                                    ))}
                                  </select>
                                  {fItem.name && (
                                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                                      {fItem.weight}g · {fItem.calories} kcal
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1 shrink-0" title={`${fItem.qtyPerMeal ?? 1} portion(s) per meal`}>
                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Qty</span>
                                    <Input
                                      type="number"
                                      min={1}
                                      step={1}
                                      value={fItem.qtyPerMeal ?? 1}
                                      onChange={(e) => {
                                        const value = Math.max(1, Math.round(Number(e.target.value) || 1));
                                        const copy = { ...createData };
                                        copy.freshFruitsByType = { ...copy.freshFruitsByType, [type]: copy.freshFruitsByType[type].map((it, i) => i === idx ? { ...it, qtyPerMeal: value } : it) };
                                        setCreateData(copy);
                                      }}
                                      className="w-14 h-7 text-xs text-center tabular-nums"
                                    />
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Input
                                      type="number"
                                      min={1}
                                      max={100}
                                      value={(createData.freshFruitAllocationByType[type] || [])[idx] ?? 100}
                                      onChange={(e) => {
                                        const copy = { ...createData };
                                        const arr = [...(copy.freshFruitAllocationByType[type] || [])];
                                        arr[idx] = Number(e.target.value);
                                        copy.freshFruitAllocationByType = { ...copy.freshFruitAllocationByType, [type]: arr };
                                        setCreateData(copy);
                                      }}
                                      className="w-16 h-7 text-xs"
                                    />
                                    <span className="text-xs text-muted-foreground">%</span>
                                  </div>
                                  <button
                                    type="button"
                                    className="text-red-500 text-sm shrink-0"
                                    onClick={() => {
                                      const copy = { ...createData };
                                      copy.freshFruitsByType = { ...copy.freshFruitsByType, [type]: copy.freshFruitsByType[type].filter((_, i) => i !== idx) };
                                      copy.freshFruitAllocationByType = { ...copy.freshFruitAllocationByType, [type]: (copy.freshFruitAllocationByType[type] || []).filter((_, i) => i !== idx) };
                                      setCreateData(copy);
                                    }}
                                  >
                                    × Remove
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                className="text-blue-600 text-sm"
                                onClick={() => {
                                  const copy = { ...createData };
                                  copy.freshFruitsByType = { ...copy.freshFruitsByType, [type]: [...(copy.freshFruitsByType[type] || []), { name: "", weight: 0, calories: 0, qtyPerMeal: 1 }] };
                                  copy.freshFruitAllocationByType = { ...copy.freshFruitAllocationByType, [type]: [...(copy.freshFruitAllocationByType[type] || []), 100] };
                                  setCreateData(copy);
                                }}
                              >
                                + Add Item
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>

              {createErrors.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive space-y-0.5 mt-2">
                  {createErrors.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setPreviewOpen(true)}>Preview</Button>
                <Button onClick={handleCreateSave}>Save Meal Configuration</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      {/* Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Meal Configuration Preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {createData.mealTypes.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No meal types selected yet.</div>
            ) : (
              createData.mealTypes.map((mealType) => (
                <div key={mealType} className="space-y-3">
                  <div className="text-base font-semibold border-b pb-2">{mealType}</div>
                  <div className="flex gap-3 flex-wrap">
                    {/* One card per choice */}
                    {createData.choiceItems.map((rec, cIdx) => {
                      const items = (rec[mealType] || []).filter((it) => it.name.trim());
                      const pct = (createData.choicePercentagesByType[mealType] ?? defaultChoicePercs(createData.choiceItems.length))[cIdx] ?? 0;
                      const st = choiceStyle(cIdx);
                      return (
                        <div key={cIdx} className={`rounded-lg border ${st.border} w-52 shrink-0`}>
                          <div className={`px-3 py-2 rounded-t-lg font-semibold text-xs ${st.badge}`}>
                            {choiceLabel(cIdx)} — {pct}%
                          </div>
                          <div className="p-3 space-y-1">
                            {items.length === 0 ? (
                              <div className="text-xs text-muted-foreground italic">No items configured</div>
                            ) : items.map((it, i) => (
                              <div key={i} className="text-xs">
                                <span className="font-medium">{it.name}</span>
                                {qtyMark(it)}
                                {it.weight > 0 && <span className="text-muted-foreground"> – {it.weight}g</span>}
                                {it.calories > 0 && <span className="text-muted-foreground"> · {it.calories} kcal</span>}
                              </div>
                            ))}
                            {items.length > 0 && (
                              <div className="text-xs font-semibold border-t pt-1 mt-1">
                                Total: {items.reduce((s, it) => s + kcalOf(it), 0)} kcal
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Special meal cards — DAY-LEVEL plan, not part of any
                        service; shown once under the first section only. */}
                    {(mealType === createData.mealTypes[0] ? createData.specialMealsPlan : []).map((sel) => (
                      <div key={sel.code} className="rounded-lg border border-purple-200 w-52 shrink-0">
                        <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-purple-100 text-purple-800">
                          {sel.code} — {sel.portions} portion{sel.portions !== 1 ? "s" : ""}
                          <span className="block text-[9px] font-medium text-purple-600">day plan · all services</span>
                        </div>
                        <div className="p-3 space-y-1">
                          <div className="text-xs font-medium">{SPECIAL_MEAL_INFO[sel.code]?.label}</div>
                          <div className="text-xs text-muted-foreground italic">{SPECIAL_MEAL_INFO[sel.code]?.note}</div>
                        </div>
                      </div>
                    ))}

                    {/* Dessert card */}
                    {(() => {
                      const allDItems = createData.dessertByType[mealType] || [];
                      const dItems = allDItems.map((it, i) => ({ ...it, allocation: (createData.dessertAllocationByType[mealType] || [])[i] ?? 100 })).filter((it) => it.name.trim());
                      if (dItems.length === 0) return null;
                      return (
                        <div className="rounded-lg border border-pink-200 w-52 shrink-0">
                          <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-pink-100 text-pink-800">
                            Dessert
                          </div>
                          <div className="p-3 space-y-1">
                            {dItems.map((it, i) => (
                              <div key={i} className="text-xs">
                                <span className="font-medium">{it.name}</span>
                                {qtyMark(it, "text-pink-700")}
                                {it.weight > 0 && <span className="text-muted-foreground"> – {it.weight}g</span>}
                                {it.calories > 0 && <span className="text-muted-foreground"> · {it.calories} kcal</span>}
                                <span className="text-muted-foreground"> [{it.allocation}%]</span>
                              </div>
                            ))}
                            <div className="text-xs font-semibold border-t pt-1 mt-1">
                              Total: {dItems.reduce((s, it) => s + kcalOf(it), 0)} kcal
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Salads card */}
                    {(() => {
                      const sItems = (createData.saladsByType[mealType] || []).filter((it) => it.name.trim());
                      if (sItems.length === 0) return null;
                      return (
                        <div className="rounded-lg border border-green-200 w-52 shrink-0">
                          <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-green-100 text-green-800">
                            Salads
                          </div>
                          <div className="p-3 space-y-1">
                            {sItems.map((it, i) => (
                              <div key={i} className="text-xs">
                                <span className="font-medium">{it.name}</span>
                                {qtyMark(it, "text-green-700")}
                                {it.weight > 0 && <span className="text-muted-foreground"> – {it.weight}g</span>}
                                {it.calories > 0 && <span className="text-muted-foreground"> · {it.calories} kcal</span>}
                              </div>
                            ))}
                            <div className="text-xs font-semibold border-t pt-1 mt-1">
                              Total: {sItems.reduce((s, it) => s + kcalOf(it), 0)} kcal
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Fresh Fruits card */}
                    {(() => {
                      const fItems = (createData.freshFruitsByType[mealType] || []).filter((it) => it.name.trim());
                      if (fItems.length === 0) return null;
                      return (
                        <div className="rounded-lg border border-orange-200 w-52 shrink-0">
                          <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-orange-100 text-orange-800">
                            Fresh Fruits
                          </div>
                          <div className="p-3 space-y-1">
                            {fItems.map((it, i) => (
                              <div key={i} className="text-xs">
                                <span className="font-medium">{it.name}</span>
                                {qtyMark(it, "text-orange-700")}
                                {it.weight > 0 && <span className="text-muted-foreground"> – {it.weight}g</span>}
                                {it.calories > 0 && <span className="text-muted-foreground"> · {it.calories} kcal</span>}
                              </div>
                            ))}
                            <div className="text-xs font-semibold border-t pt-1 mt-1">
                              Total: {fItems.reduce((s, it) => s + kcalOf(it), 0)} kcal
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* GM Order Banner - State A: Pending — button moved to Order Management */}
      {false && forwardCycle === "pending" && (
        <Alert className="bg-blue-50 border-blue-200 mb-6">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-sm text-blue-900 flex items-center justify-between">
            <span>
              📋 GM Order Received — Total meals required today: {gmOrderData.totalMealsToday.toLocaleString()} | 96-hour window meals: {gmOrderData.totalMeals96h.toLocaleString()} | Flight: {gmOrderData.flightNumber} {gmOrderData.route}
            </span>
            <Button
              size="sm"
              onClick={() => setOrderDetailsOpen(true)}
            >
              Tag & Forward to Production
            </Button>

            <Dialog open={orderDetailsOpen} onOpenChange={(o) => { setOrderDetailsOpen(o); if (!o) setOrderEditMode(false); }}>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>GM Order Details — {selectedDay}</DialogTitle>
                </DialogHeader>
                <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
                  Meal Order Summary — Next 24 Hours
                  <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground">{editableSummary.importDate}</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* International column */}
                  <div className="rounded-lg border border-navy/20 bg-navy/5 p-4 space-y-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-navy">International</h4>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Departure</div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Total Departure Meal</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.intl.depMeal}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, intl: { ...p.intl, depMeal: Number(e.target.value) } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.intl.depMeal}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Departure CHML</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.intl.depChml}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, intl: { ...p.intl, depChml: Number(e.target.value) } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.intl.depChml}</span>}
                      </div>
                      <div className="flex justify-between text-sm font-semibold border-t border-navy/20 pt-1">
                        <span>Departure Total</span>
                        <span className="tabular-nums">{editableSummary.intl.depMeal + editableSummary.intl.depChml}</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Return</div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Total Return Meal</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.intl.retMeal}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, intl: { ...p.intl, retMeal: Number(e.target.value) } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.intl.retMeal}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Return CHML</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.intl.retChml}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, intl: { ...p.intl, retChml: Number(e.target.value) } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.intl.retChml}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Return VGML</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.intl.retVgml}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, intl: { ...p.intl, retVgml: Number(e.target.value) } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.intl.retVgml}</span>}
                      </div>
                      <div className="flex justify-between text-sm font-semibold border-t border-navy/20 pt-1">
                        <span>Return Total</span>
                        <span className="tabular-nums">{editableSummary.intl.retMeal + editableSummary.intl.retChml + editableSummary.intl.retVgml}</span>
                      </div>
                    </div>
                    <div className="flex justify-between text-sm font-bold border-t-2 border-navy/30 pt-2 mt-1">
                      <span>Total Meal (Departure+Return)</span>
                      <span className="tabular-nums">{editableSummary.intl.depMeal + editableSummary.intl.depChml + editableSummary.intl.retMeal + editableSummary.intl.retChml + editableSummary.intl.retVgml}</span>
                    </div>
                  </div>
                  {/* Domestic column */}
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">Domestic</h4>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">US-Bangla</div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Zenith Load</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.usba.zenith}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, usba: { ...p.dom.usba, zenith: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.usba.zenith}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Pax Load</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.usba.pax}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, usba: { ...p.dom.usba, pax: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.usba.pax}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Breakfast (JBR + CKN Buggati)</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.usba.breakfast}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, usba: { ...p.dom.usba, breakfast: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.usba.breakfast}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Lunch</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.usba.lunch}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, usba: { ...p.dom.usba, lunch: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.usba.lunch}</span>}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Air Astra</div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Zenith Load</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.aaa.zenith}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, aaa: { ...p.dom.aaa, zenith: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.aaa.zenith}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Pax Load</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.aaa.pax}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, aaa: { ...p.dom.aaa, pax: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.aaa.pax}</span>}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Crew Meals</div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">H. Snacks</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.crew.hSnacks}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, crew: { ...p.dom.crew, hSnacks: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.crew.hSnacks}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Lunch</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.crew.lunch}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, crew: { ...p.dom.crew, lunch: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.crew.lunch}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Dinner</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.crew.dinner}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, crew: { ...p.dom.crew, dinner: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.crew.dinner}</span>}
                      </div>
                    </div>
                    <div className="flex justify-between text-sm font-semibold border-t border-primary/20 pt-2">
                      <span>Total Zenith (USBA + Air Astra)</span>
                      <span className="tabular-nums">{editableSummary.dom.usba.zenith + editableSummary.dom.aaa.zenith}</span>
                    </div>
                  </div>
                </div>
                {orderEditLog && (
                  <div className="mt-1 text-xs text-muted-foreground border-t pt-2">
                    Meal Order edited by {orderEditLog.name}, {orderEditLog.date}, {orderEditLog.time}
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setOrderDetailsOpen(false); setOrderEditMode(false); }}>Close</Button>
                  {orderEditMode ? (
                    <>
                      <Button variant="outline" onClick={() => setOrderEditMode(false)}>Cancel</Button>
                      <Button onClick={() => {
                        const now = new Date();
                        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                        const dateStr = `${String(now.getDate()).padStart(2,"0")} ${months[now.getMonth()]} ${now.getFullYear()}`;
                        const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
                        setOrderEditLog({ name: "Current User", date: dateStr, time: timeStr });
                        setOrderEditMode(false);
                        toast.success("Meal order updated.");
                      }}>Save Changes</Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" onClick={() => setOrderEditMode(true)}>Edit</Button>
                      <Button onClick={() => { setOrderDetailsOpen(false); setDaySelectionOpen(true); setPendingDay(selectedDay); }}>Tag Meal</Button>
                    </>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </AlertDescription>
        </Alert>
      )}

      {/* GM Order Banner - State B: Forwarded */}
      {forwardCycle === "forwarded" && (
        <Alert className="bg-green-50 border-green-200 mb-6">
          <Info className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-sm text-green-900">
            <div className="flex items-center justify-between">
              <div>
                <div>Total: {lastForwardedQuantity.toLocaleString()} meal orders forwarded to Production for next 24 hours schedule</div>
                {tagLog && (
                  <div className="text-xs text-green-800 mt-1">
                    Meal order has been generated for next 24 hours by {tagLog.name}, {tagLog.date}, {tagLog.time}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled className="bg-green-600 hover:bg-green-600">
                  Forwarded ✓
                </Button>
                <Button size="sm" variant="outline" onClick={() => setHistoryModalOpen(true)}>
                  View History
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* GM Order Banner - State C: Ready for next order */}
      {forwardCycle === "ready" && (
        <Alert className="bg-amber-50 border-amber-200 mb-6">
          <Info className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-sm text-amber-900 flex items-center justify-between">
            <div>
              <div>📋 Place meal order for next 24-hour cycle</div>
              <div className="text-amber-700 text-xs mt-1">Order meal for {formatDateDDMMMYYYY(getNextDate())}</div>
            </div>
            <Button size="sm" onClick={() => setOrderModalOpen(true)}>
              Order Meal
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Order Meal Modal - State C */}
      <Dialog open={orderModalOpen} onOpenChange={setOrderModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Place Meal Order — {formatDateDDMMMYYYY(getNextDate())}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted/50 rounded border">
              <div className="text-xs text-muted-foreground">
                <div>Last 24 hours — meals ordered: {lastForwardedQuantity.toLocaleString()}</div>
                {forwardedAt && (
                  <div>
                    Forwarded by: Current User | Menu Planner | {forwardedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })} {forwardedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true })}
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label>Enter order quantity for next 24 hours:</Label>
              <Input
                type="number"
                min="1"
                value={orderModalQuantity}
                onChange={(e) => {
                  setOrderModalQuantity(e.target.value);
                  setOrderModalError("");
                }}
                className={orderModalError ? "border-red-600" : ""}
              />
              {orderModalError && <div className="text-red-600 text-xs mt-1">{orderModalError}</div>}
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Textarea placeholder="Any special instructions..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setOrderModalOpen(false);
              setOrderModalQuantity("");
              setOrderModalError("");
            }}>
              Cancel
            </Button>
            <Button onClick={() => {
              if (!orderModalQuantity || Number(orderModalQuantity) <= 0) {
                setOrderModalError("Please enter quantity");
                return;
              }
              const qty = Number(orderModalQuantity);
              setLastForwardedQuantity(qty);
              setForwardCycle("forwarded");
              setForwardedAt(new Date());
              const now = new Date();
              const todayFormatted = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
              const timeFormatted = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
              setOrderHistory([...orderHistory, { mealsOrdered: qty, orderedBy: "Current User", designation: "Menu Planner", date: todayFormatted, time: timeFormatted, period: "24-hour cycle" }]);
              setOrderModalOpen(false);
              setOrderModalQuantity("");
              toast.success("Meal order forwarded to Menu Planner successfully");
            }}>
              Forward to Menu Planner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Meal Order History Modal */}
      <Dialog open={historyModalOpen} onOpenChange={setHistoryModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Meal Order History</DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">#</th>
                  <th className="text-left py-2">Meals Ordered</th>
                  <th className="text-left py-2">Ordered By</th>
                  <th className="text-left py-2">Designation</th>
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Time</th>
                  <th className="text-left py-2">Order Period</th>
                </tr>
              </thead>
              <tbody>
                {orderHistory.map((entry, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="py-2">{idx + 1}</td>
                    <td className="py-2">{entry.mealsOrdered.toLocaleString()}</td>
                    <td className="py-2">{entry.orderedBy}</td>
                    <td className="py-2">{entry.designation}</td>
                    <td className="py-2">{entry.date}</td>
                    <td className="py-2">{entry.time}</td>
                    <td className="py-2">{entry.period}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-muted-foreground mt-4">
            Total orders placed: {orderHistory.length} | Total meals ordered: {orderHistory.reduce((sum, e) => sum + e.mealsOrdered, 0).toLocaleString()}
          </div>
          <DialogFooter>
            <Button onClick={() => setHistoryModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Demo button - Simulate 24h */}
      {forwardCycle === "forwarded" && (
        <div className="text-xs text-muted-foreground mb-4 flex items-center gap-2">
          <button
            type="button"
            className="text-gray-500 hover:text-gray-700 underline"
            onClick={() => setForwardCycle("ready")}
          >
            [ Simulate next 24h — demo only ]
          </button>
        </div>
      )}


      {/* Day Selection Modal */}
      <Dialog open={daySelectionOpen} onOpenChange={setDaySelectionOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b bg-white">
            <DialogTitle className="text-lg font-semibold mb-4">Tag Meal — Select Day & Configure</DialogTitle>
            <div className="flex gap-1.5">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    pendingDay === d || today === d
                      ? "bg-slate-800 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                  onClick={() => setPendingDay(d)}
                >
                  {d.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>

          {/* Domestic / International summary */}
          <div className="px-6 py-3 bg-white border-b">
            <div className="grid grid-cols-2 gap-3">
              {(() => {
                const domMeals = meals.filter((m) => m.day === pendingDay && cardMatchesDate(m, viewDate) && m.flightType.includes("Domestic"));
                const domTypes = [...new Set(domMeals.map((m) => m.mealType))];
                return (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Domestic</div>
                    <div className="text-2xl font-bold text-slate-800">{domMeals.length}</div>
                    <div className="text-xs text-slate-500">meals configured</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {domTypes.length > 0 ? domTypes.map((t) => (
                        <span key={t} className="px-1.5 py-0.5 text-xs rounded bg-slate-200 text-slate-600">{t}</span>
                      )) : <span className="text-xs text-slate-400 italic">None configured</span>}
                    </div>
                  </div>
                );
              })()}
              {(() => {
                const intlMeals = meals.filter((m) => m.day === pendingDay && cardMatchesDate(m, viewDate) && m.flightType.includes("International"));
                const intlTypes = [...new Set(intlMeals.map((m) => m.mealType))];
                return (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">International</div>
                    <div className="text-2xl font-bold text-slate-800">{intlMeals.length}</div>
                    <div className="text-xs text-slate-500">meals configured</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {intlTypes.length > 0 ? intlTypes.map((t) => (
                        <span key={t} className="px-1.5 py-0.5 text-xs rounded bg-slate-200 text-slate-600">{t}</span>
                      )) : <span className="text-xs text-slate-400 italic">None configured</span>}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Scrollable meal rows */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-slate-50">
            {(() => {
              const tagPalette = [
                { border: "border-amber-200",   header: "bg-amber-50",   headerText: "text-amber-800",   body: "bg-white",  cardAccent: "border-l-amber-400"   },
                { border: "border-sky-200",     header: "bg-sky-50",     headerText: "text-sky-800",     body: "bg-white",  cardAccent: "border-l-sky-400"     },
                { border: "border-violet-200",  header: "bg-violet-50",  headerText: "text-violet-800",  body: "bg-white",  cardAccent: "border-l-violet-400"  },
                { border: "border-orange-200",  header: "bg-orange-50",  headerText: "text-orange-800",  body: "bg-white",  cardAccent: "border-l-orange-400"  },
                { border: "border-emerald-200", header: "bg-emerald-50", headerText: "text-emerald-800", body: "bg-white",  cardAccent: "border-l-emerald-400" },
              ];
              const mealTypeTime: Record<string, string> = {
                Breakfast: "07:00 AM – 10:00 AM",
                Lunch: "11:00 AM – 02:00 PM",
                Snacks: "02:00 PM – 04:00 PM",
                "Heavy Snacks": "04:00 PM – 07:00 PM",
                Dinner: "07:00 PM – 10:00 PM",
              };
              return MEAL_TYPES.map((mealType, typeIdx) => {
                const pal = tagPalette[typeIdx % tagPalette.length];
                const mealsForType = meals.filter((m) => m.day === pendingDay && cardMatchesDate(m, viewDate) && m.mealType === mealType);
                return (
                  <div key={mealType} className={`rounded-xl border ${pal.border} overflow-hidden shadow-sm`}>
                    {/* Row header */}
                    <div className={`${pal.header} px-4 py-2.5 flex items-center gap-3 border-b ${pal.border}`}>
                      <span className={`font-semibold text-sm w-28 shrink-0 ${pal.headerText}`}>{mealType}</span>
                      <span className="text-xs text-slate-400">{mealTypeTime[mealType]}</span>
                    </div>
                    {/* Row body */}
                    <div className={`${pal.body} px-4 py-3`}>
                      {mealsForType.length === 0 ? (
                        <div className="flex gap-3 flex-wrap items-start">
                          {(DUMMY_TAG_MEALS[mealType] ?? []).map((dummy, idx) => (
                            <div key={idx} className={`border-l-4 ${pal.cardAccent} bg-slate-50 rounded-lg px-4 py-3 min-w-[180px] shadow-sm`}>
                              <div className="font-semibold text-sm text-slate-700">{mealType} — {dummy.forType}</div>
                              <div className="text-xs text-slate-500 mt-1">Serving: {dummy.servingTime.start} – {dummy.servingTime.end}</div>
                              <div className="flex gap-1 mt-1.5 flex-wrap">
                                {dummy.flightType.map((ft) => (
                                  <span key={ft} className="px-1.5 py-0.5 text-xs rounded bg-slate-200 text-slate-600">{ft}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs self-center"
                            onClick={() => { setSelectedDay(pendingDay); setDaySelectionOpen(false); setCreateModalOpen(true); }}
                          >
                            + Add New
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-3 flex-wrap items-start">
                          {mealsForType.map((meal) => (
                            <div
                              key={meal.id}
                              className={`border-l-4 ${pal.cardAccent} bg-slate-50 rounded-lg px-4 py-3 min-w-[180px] shadow-sm`}
                            >
                              <div className="font-semibold text-sm text-slate-700">{mealType} — {meal.forType}</div>
                              <div className="text-xs text-slate-500 mt-1">Serving: {meal.servingTime.start} – {meal.servingTime.end}</div>
                              <div className="flex gap-1 mt-1.5 flex-wrap">
                                {meal.flightType.map((ft) => (
                                  <span key={ft} className="px-1.5 py-0.5 text-xs rounded bg-slate-200 text-slate-600">{ft}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs self-center"
                            onClick={() => { setSelectedDay(pendingDay); setDaySelectionOpen(false); setCreateModalOpen(true); }}
                          >
                            + Add New
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-white flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDaySelectionOpen(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                const now = new Date();
                const todayFormatted = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                const timeFormatted = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
                setForwardCycle("forwarded");
                setLastForwardedQuantity(gmOrderData.totalMealsToday);
                setForwardedAt(now);
                setTagLog({ name: "Current User", date: todayFormatted, time: timeFormatted });
                setOrderHistory((prev) => [...prev, { mealsOrdered: gmOrderData.totalMealsToday, orderedBy: "Current User", designation: "Menu Planner", date: todayFormatted, time: timeFormatted, period: "24-hour cycle" }]);
                setDaySelectionOpen(false);
                toast.success("Menu plan tagged and forwarded to Production — opening Production Order");
                navigate("/production-entry", { state: buildProductionNavState(now) });
              }}
            >
              Forward to Production
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Effective-date filter */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-sm font-medium text-muted-foreground mr-1">Menus effective on:</span>
        <Input
          type="date"
          value={viewDate}
          onChange={(e) => setViewDate(e.target.value)}
          className="h-8 w-40 text-sm"
        />
        {viewDate && (
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setViewDate("")}>
            Show all dates
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-1">
          {viewDate
            ? `Showing menus effective on ${formatDateDDMMMYYYY(viewDate)} (plus menus with no date range).`
            : "Showing all configured menus regardless of date."}
        </span>
      </div>

      {/* Menu-type rename — pending approvals */}
      {menuTypeApprovals.some((r) => r.status === "Pending") && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-amber-800 mb-2">
            Menu Type Name Changes — Pending Approval
          </div>
          <div className="space-y-2">
            {menuTypeApprovals.filter((r) => r.status === "Pending").map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm bg-white rounded-md border border-amber-200 px-3 py-2">
                <span className="font-mono text-[11px] text-muted-foreground">{r.id}</span>
                <span className="font-medium">{r.oldName}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-semibold text-amber-800">{r.newName}</span>
                <span className="text-xs text-muted-foreground">· by {r.requestedBy} · {r.requestedAt}</span>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => approveRename(r)}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => rejectRename(r)}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-amber-700 mt-2">
            The label changes only after approval — every configured menu for the type keeps its full configuration.
          </p>
        </div>
      )}

      {/* Rename Menu Type dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Menu Type</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Current Name</Label>
              <div className="mt-1 text-sm font-medium">{renameTarget?.currentName}</div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">New Name <span className="text-destructive">*</span></Label>
              <Input value={renameInput} onChange={(e) => setRenameInput(e.target.value)} className="mt-1" placeholder="e.g. Morning Meal" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Requested By <span className="text-destructive">*</span></Label>
              <Input value={renameBy} onChange={(e) => setRenameBy(e.target.value)} className="mt-1" placeholder="Name / designation" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              This goes to approval. All menus configured under this type keep their configuration — only the label changes once approved.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button onClick={submitRename}>Submit for Approval</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Day Tabs */}
      <Tabs value={selectedDay} onValueChange={setSelectedDay} className="mb-6">
        <TabsList>
          {DAYS.map((day) => (
            <TabsTrigger
              key={day}
              value={day}
              className="data-[state=active]:!bg-primary data-[state=active]:!text-primary-foreground"
            >
              {day}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Filter Bar */}
        <div className="flex gap-2 mt-4 mb-4">
          {[
            { key: "domestic", label: "Domestic" },
            { key: "international", label: "International" },
            { key: "passenger", label: "Passenger" },
            { key: "crew", label: "Crew" },
          ].map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                activeFilters[filter.key as keyof typeof activeFilters]
                  ? "bg-primary text-primary-foreground"
                  : "bg-white border border-gray-300 text-gray-600"
              }`}
              onClick={() =>
                setActiveFilters({
                  ...activeFilters,
                  [filter.key]: !activeFilters[filter.key as keyof typeof activeFilters],
                })
              }
            >
              {filter.label}
            </button>
          ))}
        </div>

        {!hasAnyFilterActive && (
          <div className="text-center py-12 text-muted-foreground">
            No filters selected — select at least one filter to view meals
          </div>
        )}

        {hasAnyFilterActive && DAYS.map((day) => {
          const mealsByType = getMealsByTypeForDay(day);
          const rowPalette = [
            { border: "border-amber-200",  header: "bg-amber-100",  headerText: "text-amber-800",  body: "bg-amber-50/60",  cardBorder: "border-l-amber-400"  },
            { border: "border-sky-200",    header: "bg-sky-100",    headerText: "text-sky-800",    body: "bg-sky-50/60",    cardBorder: "border-l-sky-400"    },
            { border: "border-violet-200", header: "bg-violet-100", headerText: "text-violet-800", body: "bg-violet-50/60", cardBorder: "border-l-violet-400" },
            { border: "border-orange-200", header: "bg-orange-100", headerText: "text-orange-800", body: "bg-orange-50/60", cardBorder: "border-l-orange-400" },
            { border: "border-emerald-200",header: "bg-emerald-100",headerText: "text-emerald-800",body: "bg-emerald-50/60",cardBorder: "border-l-emerald-400"},
          ];
          const mealTypeTime: Record<string, string> = {
            Breakfast: "07:00 AM – 10:00 AM",
            Lunch: "11:00 AM – 02:00 PM",
            Snacks: "02:00 PM – 04:00 PM",
            "Heavy Snacks": "04:00 PM – 07:00 PM",
            Dinner: "07:00 PM – 10:00 PM",
          };
          return (
          <TabsContent key={day} value={day} className="mt-4">
            <div className="space-y-3">
              {MEAL_TYPES.map((mealType, typeIdx) => {
                const palette = rowPalette[typeIdx % rowPalette.length];
                const mealsForType = mealsByType[mealType];
                const displayName = mealTypeRenames[mealType] ?? mealType;
                const pendingRename = menuTypeApprovals.find((r) => r.origType === mealType && r.status === "Pending");
                return (
                  <div key={mealType} className={`rounded-lg border ${palette.border} overflow-hidden`}>
                    <div className={`${palette.header} px-4 py-2.5 flex items-center gap-3 flex-wrap`}>
                      <span className={`font-semibold text-sm uppercase tracking-wide ${palette.headerText}`}>{displayName}</span>
                      <button
                        type="button"
                        title="Rename this menu type (requires approval)"
                        className={`text-xs ${palette.headerText} opacity-70 hover:opacity-100 underline decoration-dotted underline-offset-2`}
                        onClick={() => openRename(mealType, displayName)}
                      >
                        ✎ Rename
                      </button>
                      {pendingRename && (
                        <span className="px-2 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-medium">
                          Pending → {pendingRename.newName}
                        </span>
                      )}
                      <div className="ml-auto flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setCreateData({ ...getInitialCreateData(day), mealTypes: [mealType] });
                            setActiveChoiceForItems(0);
                            setPendingSpecialMeal(null);
                            setActiveChoicePercentType("");
                            setActiveItemsTab("");
                            setActiveMealTab(mealType);
                            setCreateErrors([]);
                            setCreateStep(1);
                            setCreateModalOpen(true);
                          }}
                        >
                          + Add New
                        </Button>
                        {mealsForType.length > 0 && (
                          <Button
                            size="sm"
                            variant={removeModeType === mealType ? "destructive" : "outline"}
                            className="h-7 text-xs"
                            onClick={() => setRemoveModeType(removeModeType === mealType ? null : mealType)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className={`${palette.body} p-3`}>
                      {mealsForType.length === 0 ? (
                        <div className="py-4 text-center text-muted-foreground text-sm">
                          No menus configured — click + New Menu to add
                        </div>
                      ) : (
                        <div className="space-y-5">
                          {mealsForType.map((meal) => {
                            const choiceCardColors = [
                              { header: "bg-blue-100 text-blue-800", border: "border-blue-200" },
                              { header: "bg-teal-100 text-teal-800", border: "border-teal-200" },
                              { header: "bg-indigo-100 text-indigo-800", border: "border-indigo-200" },
                            ];
                            return (
                              <div key={meal.id}>
                                {/* Meal meta-header */}
                                <div className="flex items-center gap-3 mb-2 flex-wrap">
                                  <span className="text-sm font-semibold">{meal.forType}</span>
                                  {meal.flightType.map((ft) => (
                                    <span key={ft} className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary">{ft}</span>
                                  ))}
                                  <span
                                    className={`px-2 py-0.5 text-xs rounded-full font-medium ${meal.route ? "bg-slate-200 text-slate-800" : "bg-slate-100 text-slate-500"}`}
                                    title={meal.route ? "Menu specific to this route" : "Shared menu — applies to every route"}
                                  >
                                    {meal.route ? `Route: ${meal.route}` : "All Routes"}
                                  </span>
                                  <span className={`px-2 py-0.5 text-xs rounded-full ${(meal.effectiveFrom || meal.effectiveTo) ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                                    {rangeLabel(meal.effectiveFrom, meal.effectiveTo) || "All Dates"}
                                  </span>
                                  <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900">Serving: {to12h(meal.servingTime.start)} – {to12h(meal.servingTime.end)}</span>
                                  <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-sky-100 text-sky-900">Effective: {formatDateDDMMMYYYY(meal.createdDate)}</span>
                                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs ml-auto" onClick={() => openViewMenu(meal)}>📋 View Menu</Button>
                                </div>

                                {/* Choice cards + special meal cards + dessert — horizontal */}
                                <div className="flex gap-3 flex-wrap">
                                  {meal.choices.map((choice, choiceIdx) => {
                                    const cc = choiceCardColors[choiceIdx % choiceCardColors.length];
                                    const choiceTotal = choice.items.reduce((s, it) => s + kcalOf(it), 0);
                                    const noteKey = `${meal.id}-${choiceIdx}`;
                                    return (
                                      <Card key={choiceIdx} className={`border ${cc.border} w-56 shrink-0 bg-card relative`}>
                                        {removeModeType === mealType && (
                                          <button className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 text-white text-xs flex items-center justify-center leading-none" onClick={() => setRemoveConfirmCard({ mealId: meal.id, kind: "choice", choiceIdx })}>×</button>
                                        )}
                                        <div className={`px-3 py-2 rounded-t-lg font-semibold text-xs ${cc.header}`}>
                                          CHOICE {String(choiceIdx + 1).padStart(2, "0")} — {choice.percentage}%
                                        </div>
                                        <CardContent className="p-3 space-y-2">
                                          <ol className="text-xs space-y-1 list-decimal list-inside">
                                            {choice.items.map((item, itemIdx) => (
                                              <li key={itemIdx} className="leading-relaxed">
                                                <span className="font-medium">{item.name}</span>
                                                {qtyMark(item)}
                                                {item.weight > 0 && <span className="text-muted-foreground"> – {item.weight}g</span>}
                                              </li>
                                            ))}
                                          </ol>
                                          <div className="text-xs font-semibold border-t pt-1.5">Total: {choiceTotal} kcal</div>
                                          <Button
                                            size="sm"
                                            className="w-full h-7 text-xs bg-slate-700 hover:bg-slate-600 text-white"
                                            onClick={() => {
                                              setEditingChoice({ mealId: meal.id, kind: "choice", choiceIdx, items: choice.items.map((i) => ({ ...i })), label: `Choice ${String(choiceIdx + 1).padStart(2, "0")} — ${choice.percentage}%` });
                                              setChoiceEditOpen(true);
                                            }}
                                          >
                                            ✏ Edit
                                          </Button>
                                        </CardContent>
                                      </Card>
                                    );
                                  })}

                                  {/* Special meal cards */}
                                  {meal.specialMeals.filter((sm) => sm.enabled).map((sm) => {
                                    const smTotal = sm.items.reduce((s, it) => s + kcalOf(it), 0);
                                    return (
                                      <Card key={sm.type} className="border border-purple-200 w-56 shrink-0 bg-card relative">
                                        {removeModeType === mealType && (
                                          <button className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 text-white text-xs flex items-center justify-center leading-none" onClick={() => setRemoveConfirmCard({ mealId: meal.id, kind: "specialMeal", smType: sm.type })}>×</button>
                                        )}
                                        <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-purple-100 text-purple-800">
                                          {sm.type} {typeof sm.portions === "number" ? `(${sm.portions} portion${sm.portions !== 1 ? "s" : ""})` : `(${sm.portions})`}
                                        </div>
                                        <CardContent className="p-3 space-y-2">
                                          <ol className="text-xs space-y-1 list-decimal list-inside">
                                            {sm.items.map((item, idx) => (
                                              <li key={idx} className="leading-relaxed">
                                                <span className="font-medium">{item.name}</span>
                                                {(item.qtyPerMeal ?? 1) > 1 && (
                                                  <span
                                                    className="ml-1 font-semibold text-purple-700"
                                                    title={`${item.qtyPerMeal} portions of ${item.name} per ${sm.type}`}
                                                  >
                                                    ×{item.qtyPerMeal}
                                                  </span>
                                                )}
                                                {item.weight > 0 && <span className="text-muted-foreground"> – {item.weight}g</span>}
                                              </li>
                                            ))}
                                          </ol>
                                          <div className="text-xs font-semibold border-t pt-1.5">Total: {smTotal} kcal</div>
                                          <Button
                                            size="sm"
                                            className="w-full h-7 text-xs bg-slate-700 hover:bg-slate-600 text-white"
                                            onClick={() => {
                                              setEditingChoice({ mealId: meal.id, kind: "specialMeal", smType: sm.type, items: sm.items.map((i) => ({ ...i })), label: `${sm.type} ${typeof sm.portions === "number" ? `(${sm.portions} portions)` : `(${sm.portions})`}` });
                                              setChoiceEditOpen(true);
                                            }}
                                          >
                                            ✏ Edit
                                          </Button>
                                        </CardContent>
                                      </Card>
                                    );
                                  })}

                                  {/* Dessert card */}
                                  {meal.dessert.name && (
                                    <Card className="border border-pink-200 w-56 shrink-0 bg-card relative">
                                      {removeModeType === mealType && (
                                        <button className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 text-white text-xs flex items-center justify-center leading-none" onClick={() => setRemoveConfirmCard({ mealId: meal.id, kind: "dessert" })}>×</button>
                                      )}
                                      <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-pink-100 text-pink-800">Dessert</div>
                                      <CardContent className="p-3 space-y-2">
                                        <div className="text-xs font-medium">
                                          {meal.dessert.name}
                                          {qtyMark(meal.dessert, "text-pink-700")}
                                          {meal.dessert.weight > 0 && <span className="font-normal"> – {meal.dessert.weight}g</span>}
                                        </div>
                                        <div className="text-xs font-semibold border-t pt-1.5">Total: {kcalOf(meal.dessert)} kcal</div>
                                        <Button
                                          size="sm"
                                          className="w-full h-7 text-xs bg-slate-700 hover:bg-slate-600 text-white"
                                          onClick={() => {
                                            setEditingChoice({ mealId: meal.id, kind: "dessert", items: [{ ...meal.dessert }], label: "Dessert" });
                                            setChoiceEditOpen(true);
                                          }}
                                        >
                                          ✏ Edit
                                        </Button>
                                      </CardContent>
                                    </Card>
                                  )}

                                  {/* Salads card */}
                                  {meal.salads && meal.salads.length > 0 && (
                                    <Card className="border border-green-200 w-56 shrink-0 bg-card">
                                      <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-green-100 text-green-800">Salads</div>
                                      <CardContent className="p-3 space-y-2">
                                        <ol className="text-xs space-y-1 list-decimal list-inside">
                                          {meal.salads.map((item, idx) => (
                                            <li key={idx} className="leading-relaxed">
                                              <span className="font-medium">{item.name}</span>
                                              {qtyMark(item, "text-green-700")}
                                              {item.weight > 0 && <span className="text-muted-foreground"> – {item.weight}g</span>}
                                            </li>
                                          ))}
                                        </ol>
                                        <div className="text-xs font-semibold border-t pt-1.5">Total: {meal.salads.reduce((s, it) => s + kcalOf(it), 0)} kcal</div>
                                      </CardContent>
                                    </Card>
                                  )}

                                  {/* Fresh Fruits card */}
                                  {meal.freshFruits && meal.freshFruits.length > 0 && (
                                    <Card className="border border-orange-200 w-56 shrink-0 bg-card">
                                      <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-orange-100 text-orange-800">Fresh Fruits</div>
                                      <CardContent className="p-3 space-y-2">
                                        <ol className="text-xs space-y-1 list-decimal list-inside">
                                          {meal.freshFruits.map((item, idx) => (
                                            <li key={idx} className="leading-relaxed">
                                              <span className="font-medium">{item.name}</span>
                                              {qtyMark(item, "text-orange-700")}
                                              {item.weight > 0 && <span className="text-muted-foreground"> – {item.weight}g</span>}
                                            </li>
                                          ))}
                                        </ol>
                                        <div className="text-xs font-semibold border-t pt-1.5">Total: {meal.freshFruits.reduce((s, it) => s + kcalOf(it), 0)} kcal</div>
                                      </CardContent>
                                    </Card>
                                  )}

                                  {/* Custom add-on cards */}
                                  {meal.customAddons && Object.entries(meal.customAddons).map(([addonName, items]) => (
                                    items.length > 0 && (
                                      <Card key={addonName} className="border border-slate-200 w-56 shrink-0 bg-card">
                                        <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-slate-100 text-slate-800">{addonName}</div>
                                        <CardContent className="p-3 space-y-2">
                                          <ol className="text-xs space-y-1 list-decimal list-inside">
                                            {items.map((item, idx) => (
                                              <li key={idx} className="leading-relaxed">
                                                <span className="font-medium">{item.name}</span>
                                                {qtyMark(item, "text-slate-700")}
                                                {item.weight > 0 && <span className="text-muted-foreground"> – {item.weight}g</span>}
                                              </li>
                                            ))}
                                          </ol>
                                          <div className="text-xs font-semibold border-t pt-1.5">Total: {items.reduce((s, it) => s + kcalOf(it), 0)} kcal</div>
                                        </CardContent>
                                      </Card>
                                    )
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        );
        })}
      </Tabs>

      {/* View Menu Modal */}
      <Dialog open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Meal Menu</DialogTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
              >
                🖨 Print
              </Button>
            </div>
          </DialogHeader>
          {selectedMeal && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
              <div>
                <h4 className="font-semibold">{mealTypeRenames[selectedMeal.mealType] ?? selectedMeal.mealType}</h4>
                <p className="text-sm text-muted-foreground">
                  {selectedMeal.forType} • {selectedMeal.flightType.join(", ")}
                  {" • "}{selectedMeal.route ? `Route: ${selectedMeal.route}` : "All Routes"}
                </p>
              </div>

              {selectedMeal.choices.map((choice, idx) => (
                <div key={idx} className="border-b pb-3">
                  <h5 className="font-semibold text-sm mb-2">
                    {choice.label} ({choice.percentage}%)
                  </h5>
                  <ul className="ml-4 space-y-1 text-sm">
                    {choice.items.map((item) => (
                      <li key={item.name}>
                        {item.name}{qtyMark(item)} — {item.weight}g
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {selectedMeal.specialMeals
                .filter((sm) => sm.enabled)
                .map((sm) => (
                  <div key={sm.type} className="border-b pb-3">
                    <h5 className="font-semibold text-sm mb-2">
                      {sm.type}
                      {typeof sm.portions === "number"
                        ? ` (${sm.portions} portion${sm.portions > 1 ? "s" : ""})`
                        : ` (${sm.portions})`}
                    </h5>
                    <ul className="ml-4 space-y-1 text-sm">
                      {sm.items.map((item) => (
                        <li key={item.name}>
                          {item.name}{qtyMark(item, "text-purple-700")} — {item.weight}g
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

              <div className="border-b pb-3">
                <h5 className="font-semibold text-sm mb-2">Dessert</h5>
                <p className="ml-4 text-sm">
                  {selectedMeal.dessert.name} — {selectedMeal.dessert.weight}g
                </p>
              </div>

              {selectedMeal.salads && selectedMeal.salads.length > 0 && (
                <div className="border-b pb-3">
                  <h5 className="font-semibold text-sm mb-2">Salads</h5>
                  <ul className="ml-4 space-y-1 text-sm">
                    {selectedMeal.salads.map((item) => (
                      <li key={item.name}>{item.name}{qtyMark(item, "text-green-700")} — {item.weight}g</li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedMeal.freshFruits && selectedMeal.freshFruits.length > 0 && (
                <div className="border-b pb-3">
                  <h5 className="font-semibold text-sm mb-2">Fresh Fruits</h5>
                  <ul className="ml-4 space-y-1 text-sm">
                    {selectedMeal.freshFruits.map((item) => (
                      <li key={item.name}>{item.name}{qtyMark(item, "text-orange-700")} — {item.weight}g</li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedMeal.customAddons && Object.entries(selectedMeal.customAddons).map(([addonName, items]) => (
                items.length > 0 && (
                  <div key={addonName} className="border-b pb-3">
                    <h5 className="font-semibold text-sm mb-2">{addonName}</h5>
                    <ul className="ml-4 space-y-1 text-sm">
                      {items.map((item) => (
                        <li key={item.name}>{item.name}{qtyMark(item, "text-slate-700")}{item.weight > 0 ? ` — ${item.weight}g` : ""}</li>
                      ))}
                    </ul>
                  </div>
                )
              ))}

              <div className="flex justify-between items-end pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  Serving: {selectedMeal.servingTime.start} – {selectedMeal.servingTime.end}
                </p>
                <p className="font-semibold text-lg">Total: {selectedMeal.totalKcal} kcal</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setViewMenuOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Item Edit Modal — shared for Choice, Special Meal, and Dessert cards */}
      <Dialog open={choiceEditOpen} onOpenChange={setChoiceEditOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {editingChoice?.label ?? ""}</DialogTitle>
          </DialogHeader>
          {editingChoice && (() => {
            const noteKey = editingChoice.kind === "choice"
              ? `${editingChoice.mealId}-choice-${editingChoice.choiceIdx}`
              : editingChoice.kind === "specialMeal"
              ? `${editingChoice.mealId}-sm-${editingChoice.smType}`
              : `${editingChoice.mealId}-dessert`;
            const existingNotes = choiceEditNotes[noteKey] ?? [];
            return (
              <div className="space-y-3">
                <div className="flex gap-2 items-center text-xs font-semibold text-muted-foreground border-b pb-1">
                  <div className="flex-1">Name</div>
                  <div className="w-16 text-center" title="Portions of this item in ONE meal">Qty / meal</div>
                  <div className="w-20">Weight (g)</div>
                  <div className="w-16">Kcal</div>
                  <div className="w-16" />
                </div>

                {editingChoice.items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Item name"
                      value={item.name}
                      onChange={(e) => {
                        const updated = editingChoice.items.map((it, i) => i === idx ? { ...it, name: e.target.value } : it);
                        setEditingChoice({ ...editingChoice, items: updated });
                      }}
                      className="flex-1 rounded border px-2 py-1 text-sm"
                    />
                    {/* Per-meal quantity — every line type carries one (a special
                        meal assembles by it; other lines size production by it). */}
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={item.qtyPerMeal ?? 1}
                      onChange={(e) => {
                        const value = Math.max(1, Math.round(Number(e.target.value) || 1));
                        const updated = editingChoice.items.map((it, i) => i === idx ? { ...it, qtyPerMeal: value } : it);
                        setEditingChoice({ ...editingChoice, items: updated });
                      }}
                      title={`${item.qtyPerMeal ?? 1} portion(s) of ${item.name || "this item"} per meal`}
                      className="w-16 rounded border px-2 py-1 text-sm text-center tabular-nums"
                    />
                    <input
                      type="number"
                      placeholder="g"
                      value={item.weight}
                      onChange={(e) => {
                        const updated = editingChoice.items.map((it, i) => i === idx ? { ...it, weight: Number(e.target.value) } : it);
                        setEditingChoice({ ...editingChoice, items: updated });
                      }}
                      className="w-20 rounded border px-2 py-1 text-sm"
                    />
                    <input
                      type="number"
                      placeholder="kcal"
                      value={item.calories}
                      onChange={(e) => {
                        const updated = editingChoice.items.map((it, i) => i === idx ? { ...it, calories: Number(e.target.value) } : it);
                        setEditingChoice({ ...editingChoice, items: updated });
                      }}
                      className="w-16 rounded border px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      className="text-red-600 text-sm shrink-0 w-16 text-right"
                      onClick={() => setEditingChoice({ ...editingChoice, items: editingChoice.items.filter((_, i) => i !== idx) })}
                    >
                      × Remove
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  className="text-blue-600 text-sm"
                  onClick={() => setEditingChoice({ ...editingChoice, items: [...editingChoice.items, { name: "", weight: 0, calories: 0, qtyPerMeal: 1 }] })}
                >
                  + Add Item
                </button>

                {/* Change notes — shown only inside edit modal */}
                {existingNotes.length > 0 && (
                  <div className="border-t pt-3 space-y-1">
                    {existingNotes.map((note, i) => (
                      <div key={i} className="text-xs text-muted-foreground italic bg-muted/40 px-2 py-1 rounded">{note}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setChoiceEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editingChoice) return;
                const { mealId, kind, choiceIdx, smType, items } = editingChoice;
                const noteKey = kind === "choice"
                  ? `${mealId}-choice-${choiceIdx}`
                  : kind === "specialMeal"
                  ? `${mealId}-sm-${smType}`
                  : `${mealId}-dessert`;

                const oldMeal = meals.find((m) => m.id === mealId);
                let oldItems: MealItem[] = [];
                if (kind === "choice" && choiceIdx !== undefined) oldItems = oldMeal?.choices[choiceIdx]?.items ?? [];
                else if (kind === "specialMeal") oldItems = oldMeal?.specialMeals.find((sm) => sm.type === smType)?.items ?? [];
                else if (kind === "dessert" && oldMeal) oldItems = [oldMeal.dessert];

                const oldNames = new Set(oldItems.map((it) => it.name.trim()).filter(Boolean));
                const newlyAdded = items.filter((it) => it.name.trim() && !oldNames.has(it.name.trim()));

                setMeals((prev) =>
                  prev.map((m) => {
                    if (m.id !== mealId) return m;
                    if (kind === "choice" && choiceIdx !== undefined)
                      return { ...m, choices: m.choices.map((c, ci) => ci === choiceIdx ? { ...c, items } : c) };
                    if (kind === "specialMeal")
                      return { ...m, specialMeals: m.specialMeals.map((sm) => sm.type === smType ? { ...sm, items } : sm) };
                    if (kind === "dessert" && items.length > 0)
                      return { ...m, dessert: items[0] };
                    return m;
                  })
                );

                if (newlyAdded.length > 0) {
                  const now = new Date();
                  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
                  const newNotes = newlyAdded.map((it) => `"${it.name}" has been added by Current User on ${dateStr}, ${timeStr}`);
                  setChoiceEditNotes((prev) => ({ ...prev, [noteKey]: [...(prev[noteKey] ?? []), ...newNotes] }));
                }

                setChoiceEditOpen(false);
                toast.success("Updated successfully");
              }}
            >
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Card Confirmation */}
      <Dialog open={!!removeConfirmCard} onOpenChange={(open) => { if (!open) setRemoveConfirmCard(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Meal?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Do you want to remove this meal?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveConfirmCard(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (removeConfirmCard) {
                  const { mealId, kind, choiceIdx, smType } = removeConfirmCard;
                  setMeals((prev) => prev.map((m) => {
                    if (m.id !== mealId) return m;
                    if (kind === "choice" && choiceIdx !== undefined)
                      return { ...m, choices: m.choices.filter((_, ci) => ci !== choiceIdx) };
                    if (kind === "specialMeal")
                      return { ...m, specialMeals: m.specialMeals.map((sm) => sm.type === smType ? { ...sm, enabled: false } : sm) };
                    if (kind === "dessert")
                      return { ...m, dessert: { ...m.dessert, name: "" } };
                    return m;
                  }));
                }
                setRemoveConfirmCard(null);
              }}
            >
              Yes, Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Forward Modal */}
      <Dialog open={forwardConfirmOpen} onOpenChange={setForwardConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forward Menu Plan to Production?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <span className="font-semibold">Day:</span> {selectedDay}
            </div>
            <div>
              <span className="font-semibold">Meal Types Configured:</span> {configuredCount}
            </div>
            <div>
              <span className="font-semibold">Total Estimated kcal:</span>{" "}
              {currentDayMeals.reduce((sum, m) => sum + m.totalKcal, 0)}
            </div>
            <div className="border-t pt-3">
              <span className="font-semibold">Forwarded by:</span> Current User — {new Date().toLocaleString()}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setForwardConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleForward}>Confirm & Forward</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
