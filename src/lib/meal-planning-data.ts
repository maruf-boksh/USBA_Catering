export type MealItem = { name: string; weight: number; calories: number };
export type MealChoice = { label: string; percentage: number; items: MealItem[] };
export type SpecialMeal = {
  type: string;
  portions: number | string;
  items: MealItem[];
  enabled: boolean;
};

export type FlightType = "International" | "Domestic";
export type ForType = "Passengers" | "Crew";

export type MealCard = {
  id: string;
  day: string;
  /**
   * Optional effective date range (inclusive, ISO "YYYY-MM-DD"). The card's menu
   * applies on its weekday only when the date is within [effectiveFrom,
   * effectiveTo]. An open or omitted bound is unbounded on that side; omitting
   * both means the card applies on EVERY date — the original, range-agnostic
   * behavior, so all pre-existing seed and persisted cards remain valid.
   */
  effectiveFrom?: string;
  effectiveTo?: string;
  mealType: string;
  flightType: FlightType[];
  forType: ForType;
  choices: MealChoice[];
  specialMeals: SpecialMeal[];
  dessert: MealItem;
  servingTime: { start: string; end: string };
  totalKcal: number;
};

export type GMOrderSummary = {
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
};

export const DAYS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
] as const;

export const gmOrderSummary: GMOrderSummary = {
  flightNumber: "BS-315",
  route: "DAC → KUL",
  date: "20 May 2026",
  departureTime: "14:30",
  paxCount: 300,
  crewCount: 16,
  totalMealsToday: 9600,
  totalMeals96h: 38400,
  approvedBy: "S. Ahmed",
  approvedTimestamp: "19 May 2026 10:45 AM",
};

export const mealCards: MealCard[] = [
  {
    id: "meal-1",
    day: "Monday",
    mealType: "Lunch",
    flightType: ["International"],
    forType: "Passengers",
    choices: [
      { label: "CHOICE 1", percentage: 60, items: [
        { name: "Plain Polao", weight: 180, calories: 240 },
        { name: "Beef Rezala", weight: 100, calories: 150 },
        { name: "Mug Dal Vuna", weight: 50, calories: 80 },
      ]},
      { label: "CHOICE 2", percentage: 40, items: [
        { name: "Jeera Polao", weight: 180, calories: 245 },
        { name: "Chicken Masala", weight: 100, calories: 155 },
        { name: "Mixed Veg Curry", weight: 50, calories: 75 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 5, enabled: true, items: [
        { name: "Plain Polao", weight: 170, calories: 230 },
        { name: "Mixed Veg Curry", weight: 70, calories: 90 },
        { name: "Mug Dal Vuna", weight: 50, calories: 80 },
      ]},
      { type: "CHML", portions: "As per demand", enabled: true, items: [
        { name: "Plain Polao, Saffron Rice, Chicken Korma, Kitkat Chocolate", weight: 250, calories: 450 },
      ]},
    ],
    dessert: { name: "Vanilla Pastry", weight: 60, calories: 180 },
    servingTime: { start: "11:00", end: "14:00" },
    totalKcal: 720,
  },
  {
    id: "meal-2",
    day: "Monday",
    mealType: "Breakfast",
    flightType: ["International", "Domestic"],
    forType: "Crew",
    choices: [
      { label: "CHOICE 1", percentage: 50, items: [
        { name: "Chicken Khichuri", weight: 250, calories: 280 },
        { name: "Fried Egg", weight: 50, calories: 85 },
      ]},
      { label: "CHOICE 2", percentage: 50, items: [
        { name: "Roti", weight: 80, calories: 120 },
        { name: "Scrambled Egg", weight: 100, calories: 145 },
        { name: "Mixed Veg Curry", weight: 50, calories: 75 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 1, enabled: true, items: [
        { name: "Roti", weight: 80, calories: 120 },
        { name: "Mixed Veg", weight: 40, calories: 60 },
        { name: "Mug Dal", weight: 30, calories: 50 },
      ]},
    ],
    dessert: { name: "Yoghurt & Semolina", weight: 80, calories: 120 },
    servingTime: { start: "07:00", end: "10:00" },
    totalKcal: 480,
  },
  {
    id: "meal-3",
    day: "Tuesday",
    mealType: "Lunch",
    flightType: ["International"],
    forType: "Passengers",
    choices: [
      { label: "CHOICE 1", percentage: 55, items: [
        { name: "Saffron Rice", weight: 180, calories: 250 },
        { name: "Mutton Rezala", weight: 110, calories: 180 },
        { name: "Garlic Naan", weight: 60, calories: 170 },
      ]},
      { label: "CHOICE 2", percentage: 45, items: [
        { name: "Steamed Rice", weight: 180, calories: 220 },
        { name: "Fish Curry", weight: 100, calories: 140 },
        { name: "Sauteed Vegetables", weight: 80, calories: 90 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 4, enabled: true, items: [
        { name: "Saffron Rice", weight: 170, calories: 240 },
        { name: "Paneer Tikka Masala", weight: 100, calories: 200 },
        { name: "Garlic Naan", weight: 60, calories: 170 },
      ]},
    ],
    dessert: { name: "Mango Mousse", weight: 70, calories: 200 },
    servingTime: { start: "11:30", end: "14:30" },
    totalKcal: 760,
  },
  {
    id: "meal-4",
    day: "Tuesday",
    mealType: "Dinner",
    flightType: ["International", "Domestic"],
    forType: "Crew",
    choices: [
      { label: "CHOICE 1", percentage: 50, items: [
        { name: "Boiled Rice", weight: 180, calories: 210 },
        { name: "Chicken Dopiaza", weight: 100, calories: 140 },
        { name: "Dal Butter Fry", weight: 50, calories: 120 },
      ]},
      { label: "CHOICE 2", percentage: 50, items: [
        { name: "Tandoori Chicken", weight: 100, calories: 160 },
        { name: "Sauteed Veg", weight: 100, calories: 110 },
        { name: "Kulcha", weight: 60, calories: 180 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 1, enabled: true, items: [
        { name: "Boiled Rice", weight: 150, calories: 170 },
        { name: "Mixed Veg", weight: 100, calories: 130 },
        { name: "Chana Dal", weight: 40, calories: 100 },
      ]},
    ],
    dessert: { name: "Firni & Semolina", weight: 100, calories: 210 },
    servingTime: { start: "19:00", end: "22:00" },
    totalKcal: 590,
  },
  {
    id: "meal-5",
    day: "Wednesday",
    mealType: "Breakfast",
    flightType: ["Domestic"],
    forType: "Passengers",
    choices: [
      { label: "CHOICE 1", percentage: 70, items: [
        { name: "Paratha", weight: 80, calories: 220 },
        { name: "Channa Masala", weight: 100, calories: 150 },
        { name: "Boiled Egg", weight: 50, calories: 80 },
      ]},
      { label: "CHOICE 2", percentage: 30, items: [
        { name: "Vegetable Sandwich", weight: 120, calories: 240 },
        { name: "Fruit Salad", weight: 80, calories: 70 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 3, enabled: true, items: [
        { name: "Paratha", weight: 80, calories: 220 },
        { name: "Channa Masala", weight: 100, calories: 150 },
      ]},
    ],
    dessert: { name: "Yoghurt", weight: 60, calories: 90 },
    servingTime: { start: "07:00", end: "10:00" },
    totalKcal: 450,
  },
  {
    id: "meal-6",
    day: "Wednesday",
    mealType: "Heavy Snacks",
    flightType: ["International", "Domestic"],
    forType: "Crew",
    choices: [
      { label: "CHOICE 1", percentage: 50, items: [
        { name: "Roll Sandwich with Chicken & Cheese", weight: 150, calories: 320 },
      ]},
      { label: "CHOICE 2", percentage: 50, items: [
        { name: "Korean Fried Chicken", weight: 100, calories: 280 },
        { name: "Potato Wedges", weight: 50, calories: 180 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 1, enabled: true, items: [
        { name: "Veg Frankie", weight: 80, calories: 200 },
        { name: "Buttered Veg", weight: 30, calories: 60 },
      ]},
    ],
    dessert: { name: "Firni & Vanilla Pastry", weight: 80, calories: 160 },
    servingTime: { start: "16:00", end: "19:00" },
    totalKcal: 410,
  },
  {
    id: "meal-7",
    day: "Thursday",
    mealType: "Lunch",
    flightType: ["International", "Domestic"],
    forType: "Crew",
    choices: [
      { label: "CHOICE 1", percentage: 60, items: [
        { name: "Plain Rice", weight: 180, calories: 210 },
        { name: "Chicken Korma", weight: 100, calories: 170 },
        { name: "Dal Tadka", weight: 50, calories: 100 },
      ]},
      { label: "CHOICE 2", percentage: 40, items: [
        { name: "Vegetable Biryani", weight: 200, calories: 320 },
        { name: "Raita", weight: 50, calories: 50 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 1, enabled: true, items: [
        { name: "Vegetable Biryani", weight: 200, calories: 320 },
        { name: "Raita", weight: 50, calories: 50 },
      ]},
    ],
    dessert: { name: "Gulab Jamun", weight: 60, calories: 220 },
    servingTime: { start: "12:00", end: "14:30" },
    totalKcal: 580,
  },
  {
    id: "meal-8",
    day: "Thursday",
    mealType: "Lunch",
    flightType: ["International", "Domestic"],
    forType: "Passengers",
    choices: [
      { label: "CHOICE 1", percentage: 60, items: [
        { name: "Steamed Rice", weight: 180, calories: 220 },
        { name: "Grilled Chicken", weight: 120, calories: 200 },
        { name: "Mixed Veg Curry", weight: 50, calories: 80 },
      ]},
      { label: "CHOICE 2", percentage: 40, items: [
        { name: "Vegetable Biryani", weight: 200, calories: 320 },
        { name: "Fish Curry", weight: 100, calories: 160 },
        { name: "Raita", weight: 50, calories: 50 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 5, enabled: true, items: [
        { name: "Vegetable Biryani", weight: 200, calories: 320 },
        { name: "Mixed Veg Curry", weight: 60, calories: 90 },
        { name: "Raita", weight: 50, calories: 50 },
      ]},
      { type: "CHML", portions: "As per demand", enabled: true, items: [
        { name: "Steamed Rice, Grilled Chicken, Seasonal Fruit", weight: 250, calories: 430 },
      ]},
    ],
    dessert: { name: "Fruit Custard", weight: 70, calories: 190 },
    servingTime: { start: "12:00", end: "14:30" },
    totalKcal: 620,
  },
  {
    id: "meal-9",
    day: "Friday",
    mealType: "Lunch",
    flightType: ["International", "Domestic"],
    forType: "Passengers",
    choices: [
      { label: "CHOICE 1", percentage: 60, items: [
        { name: "Kashmiri Polao", weight: 180, calories: 250 },
        { name: "Beef Kala Bhuna", weight: 110, calories: 190 },
        { name: "Masoor Dal", weight: 50, calories: 90 },
      ]},
      { label: "CHOICE 2", percentage: 40, items: [
        { name: "Steamed Rice", weight: 180, calories: 220 },
        { name: "Lemon Grilled Fish", weight: 100, calories: 150 },
        { name: "Sauteed Vegetables", weight: 80, calories: 90 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 5, enabled: true, items: [
        { name: "Kashmiri Polao", weight: 170, calories: 240 },
        { name: "Paneer Butter Masala", weight: 100, calories: 200 },
        { name: "Masoor Dal", weight: 50, calories: 90 },
      ]},
      { type: "CHML", portions: "As per demand", enabled: true, items: [
        { name: "Kashmiri Polao, Chicken Roast, Seasonal Fruit", weight: 250, calories: 440 },
      ]},
    ],
    dessert: { name: "Shahi Tukra", weight: 70, calories: 210 },
    servingTime: { start: "12:00", end: "14:30" },
    totalKcal: 740,
  },
  {
    id: "meal-10",
    day: "Friday",
    mealType: "Lunch",
    flightType: ["International", "Domestic"],
    forType: "Crew",
    choices: [
      { label: "CHOICE 1", percentage: 60, items: [
        { name: "Plain Rice", weight: 180, calories: 210 },
        { name: "Chicken Bhuna", weight: 100, calories: 165 },
        { name: "Dal Tadka", weight: 50, calories: 100 },
      ]},
      { label: "CHOICE 2", percentage: 40, items: [
        { name: "Vegetable Khichuri", weight: 200, calories: 300 },
        { name: "Egg Curry", weight: 60, calories: 110 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 1, enabled: true, items: [
        { name: "Vegetable Khichuri", weight: 200, calories: 300 },
        { name: "Mixed Veg", weight: 60, calories: 90 },
      ]},
    ],
    dessert: { name: "Firni", weight: 80, calories: 160 },
    servingTime: { start: "12:00", end: "14:30" },
    totalKcal: 560,
  },
  {
    id: "meal-11",
    day: "Saturday",
    mealType: "Lunch",
    flightType: ["International", "Domestic"],
    forType: "Passengers",
    choices: [
      { label: "CHOICE 1", percentage: 55, items: [
        { name: "Jeera Polao", weight: 180, calories: 245 },
        { name: "Mutton Rogan Josh", weight: 110, calories: 185 },
        { name: "Mug Dal Vuna", weight: 50, calories: 80 },
      ]},
      { label: "CHOICE 2", percentage: 45, items: [
        { name: "Steamed Rice", weight: 180, calories: 220 },
        { name: "Chicken Masala", weight: 100, calories: 155 },
        { name: "Mixed Veg Curry", weight: 50, calories: 80 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 4, enabled: true, items: [
        { name: "Jeera Polao", weight: 170, calories: 240 },
        { name: "Mixed Veg Curry", weight: 70, calories: 90 },
        { name: "Mug Dal Vuna", weight: 50, calories: 80 },
      ]},
      { type: "CHML", portions: "As per demand", enabled: true, items: [
        { name: "Jeera Polao, Chicken Korma, Kitkat Chocolate", weight: 250, calories: 450 },
      ]},
    ],
    dessert: { name: "Mango Mousse", weight: 70, calories: 200 },
    servingTime: { start: "11:30", end: "14:30" },
    totalKcal: 750,
  },
  {
    id: "meal-12",
    day: "Saturday",
    mealType: "Dinner",
    flightType: ["International", "Domestic"],
    forType: "Crew",
    choices: [
      { label: "CHOICE 1", percentage: 50, items: [
        { name: "Boiled Rice", weight: 180, calories: 210 },
        { name: "Chicken Dopiaza", weight: 100, calories: 140 },
        { name: "Dal Butter Fry", weight: 50, calories: 120 },
      ]},
      { label: "CHOICE 2", percentage: 50, items: [
        { name: "Steamed Rice", weight: 180, calories: 220 },
        { name: "Fish Curry", weight: 100, calories: 140 },
        { name: "Sauteed Veg", weight: 80, calories: 90 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 1, enabled: true, items: [
        { name: "Boiled Rice", weight: 150, calories: 170 },
        { name: "Mixed Veg", weight: 100, calories: 130 },
        { name: "Chana Dal", weight: 40, calories: 100 },
      ]},
    ],
    dessert: { name: "Gulab Jamun", weight: 60, calories: 220 },
    servingTime: { start: "19:00", end: "22:00" },
    totalKcal: 590,
  },
  {
    id: "meal-13",
    day: "Sunday",
    mealType: "Lunch",
    flightType: ["International", "Domestic"],
    forType: "Passengers",
    choices: [
      { label: "CHOICE 1", percentage: 60, items: [
        { name: "Plain Polao", weight: 180, calories: 240 },
        { name: "Beef Rezala", weight: 100, calories: 150 },
        { name: "Mug Dal Vuna", weight: 50, calories: 80 },
      ]},
      { label: "CHOICE 2", percentage: 40, items: [
        { name: "Steamed Rice", weight: 180, calories: 220 },
        { name: "Grilled Chicken", weight: 120, calories: 200 },
        { name: "Mixed Veg Curry", weight: 50, calories: 80 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 5, enabled: true, items: [
        { name: "Plain Polao", weight: 170, calories: 230 },
        { name: "Mixed Veg Curry", weight: 70, calories: 90 },
        { name: "Mug Dal Vuna", weight: 50, calories: 80 },
      ]},
      { type: "CHML", portions: "As per demand", enabled: true, items: [
        { name: "Plain Polao, Saffron Rice, Chicken Korma, Kitkat Chocolate", weight: 250, calories: 450 },
      ]},
    ],
    dessert: { name: "Vanilla Pastry", weight: 60, calories: 180 },
    servingTime: { start: "11:00", end: "14:00" },
    totalKcal: 720,
  },
  {
    id: "meal-14",
    day: "Sunday",
    mealType: "Lunch",
    flightType: ["International", "Domestic"],
    forType: "Crew",
    choices: [
      { label: "CHOICE 1", percentage: 60, items: [
        { name: "Plain Rice", weight: 180, calories: 210 },
        { name: "Chicken Korma", weight: 100, calories: 170 },
        { name: "Dal Tadka", weight: 50, calories: 100 },
      ]},
      { label: "CHOICE 2", percentage: 40, items: [
        { name: "Vegetable Biryani", weight: 200, calories: 320 },
        { name: "Raita", weight: 50, calories: 50 },
      ]},
    ],
    specialMeals: [
      { type: "VGML", portions: 1, enabled: true, items: [
        { name: "Vegetable Biryani", weight: 200, calories: 320 },
        { name: "Raita", weight: 50, calories: 50 },
      ]},
    ],
    dessert: { name: "Firni & Semolina", weight: 100, calories: 210 },
    servingTime: { start: "12:00", end: "14:30" },
    totalKcal: 580,
  },
];

// ─── Live Meal-Planning config bridge ────────────────────────────────────────
// The Menu Planning page persists its configured menus under this key (via
// usePersistedState, so the on-disk key is "harvest-data-v1:" + KEY). Downstream
// consumers (e.g. the Production Order "Menu Plan" tab) read the latest config
// through loadMealPlanningConfig() so menu edits flow through without a reload.
export const MEAL_PLAN_CONFIG_KEY = "meal-planning-config";

/**
 * Latest meal-planning configuration, merged over the static seed: any day the
 * planner has configured fully overrides the seed for that day; days not yet
 * configured fall back to the seed templates. Returns the seed verbatim when
 * nothing has been persisted yet (or storage is unavailable).
 */
export function loadMealPlanningConfig(): MealCard[] {
  let persisted: MealCard[] | null = null;
  try {
    const raw = window.localStorage.getItem("harvest-data-v1:" + MEAL_PLAN_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MealCard[];
      if (Array.isArray(parsed) && parsed.length > 0) persisted = parsed;
    }
  } catch {
    /* storage unavailable / corrupt — fall back to seed */
  }
  if (!persisted) return mealCards;
  const configuredDays = new Set(persisted.map((m) => m.day));
  const seedForOtherDays = mealCards.filter((m) => !configuredDays.has(m.day));
  return [...persisted, ...seedForOtherDays];
}

// ── Dispatch helpers: resolve crew / special meals to producible dishes ───────
// Dispatch captures crew meals as a meal-period + headcount and special meals as
// a code + qty — neither names a dish. To tag each with its own production order,
// we map them to a representative dish from the Menu Planning config.

/**
 * Does a card apply on the given date? A card with no effective range applies on
 * every date (the range-agnostic default); a dated card applies only when the
 * date falls within its inclusive [effectiveFrom, effectiveTo] bounds (each bound
 * optional). Passing an empty/undefined date disables the filter (matches all).
 * Compares ISO "YYYY-MM-DD" strings lexicographically, which is chronological.
 */
export function cardMatchesDate(
  card: { effectiveFrom?: string; effectiveTo?: string },
  date?: string,
): boolean {
  if (!date) return true;
  if (card.effectiveFrom && date < card.effectiveFrom) return false;
  if (card.effectiveTo && date > card.effectiveTo) return false;
  return true;
}

/** Weekday name ("Monday"…"Sunday") for an ISO date string; "" when unparseable. */
export function dayFromDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const idx = d.getDay() === 0 ? 6 : d.getDay() - 1; // Mon=0 … Sun=6
  return DAYS[idx];
}

/** Sum a meal-qty string like "12+1" or "16" (crew rosters use "pax+extra"). */
export function parseMealQty(raw: string | number): number {
  if (typeof raw === "number") return raw;
  if (!raw) return 0;
  return String(raw).split("+").reduce((s, p) => s + (Number(p.trim()) || 0), 0);
}

/**
 * Representative crew dish for a meal-period: the lead choice's main item of the
 * Crew (forType "Crew") card whose mealType matches — preferring the given day,
 * else any day. Returns null when no crew card serves that period.
 */
export function resolveCrewDish(
  period: string,
  day: string,
  cards: MealCard[] = loadMealPlanningConfig(),
): string | null {
  const crew = cards.filter(
    (c) => c.forType === "Crew" && c.mealType.toLowerCase() === period.toLowerCase(),
  );
  if (crew.length === 0) return null;
  const card = crew.find((c) => c.day === day) ?? crew[0];
  return card.choices[0]?.items[0]?.name ?? null;
}

/**
 * Representative special-meal dish for a special code: the first item of the
 * matching specialMeals entry across all cards — preferring the given day, else
 * the first card carrying that code. Returns null when the code isn't planned.
 */
export function resolveSpecialDish(
  code: string,
  day: string,
  cards: MealCard[] = loadMealPlanningConfig(),
): string | null {
  const matches = cards
    .map((c) => ({ day: c.day, sp: c.specialMeals.find((s) => s.type.toLowerCase() === code.toLowerCase()) }))
    .filter((x) => x.sp);
  if (matches.length === 0) return null;
  const pick = matches.find((x) => x.day === day) ?? matches[0];
  return pick.sp?.items[0]?.name ?? null;
}

/**
 * The dessert / pastry planned for a day — the `dessert` item on the matching
 * meal card. Prefers the card for this day, flight type and meal period, then
 * falls back to any card for the day, then any card at all. Returns null when
 * no card carries a dessert, which is a real answer: not every service does.
 */
export function resolveDessert(
  day: string,
  opts: { flightType?: FlightType; mealType?: string; date?: string } = {},
  cards: MealCard[] = loadMealPlanningConfig(),
): MealItem | null {
  const pool = cards.filter(
    (c) => c.forType === "Passengers" && !!c.dessert?.name && cardMatchesDate(c, opts.date),
  );
  if (pool.length === 0) return null;
  const byDay = pool.filter((c) => c.day === day);
  const scope = byDay.length ? byDay : pool;
  // A card lists the flight types it applies to, so this is membership, not
  // equality — an "International + Domestic" card serves both.
  const exact = scope.find(
    (c) =>
      (!opts.flightType || c.flightType.includes(opts.flightType)) &&
      (!opts.mealType || c.mealType.toLowerCase() === opts.mealType.toLowerCase()),
  );
  return (exact ?? scope[0]).dessert ?? null;
}

// ── Mobile bridge: map the web Meal-Planning config into the mobile screen's
// plan shape ─────────────────────────────────────────────────────────────────
// The mobile MealPlanningScreen renders a flat plan shape. This adapter lets the
// mobile app read the SAME live, persisted web config (via loadMealPlanningConfig)
// instead of its mock list — so menus configured on the web flow straight to
// mobile, honouring the effective-date range. The mobile UI is unchanged; only
// its data source is swapped.

export type MobileMealPlan = {
  id: string;
  slot: string;
  type: string;
  items: string[];
  calories: number;
  allergens: string[];
};

// Web meal periods → mobile slot keys (mobile only styles these four; Snacks and
// Heavy Snacks both collapse to "Snack").
const MOBILE_SLOT: Record<string, string> = {
  Breakfast: "Breakfast",
  Lunch: "Lunch",
  Dinner: "Dinner",
  Snacks: "Snack",
  "Heavy Snacks": "Snack",
};

/**
 * The web meal-planning config rendered in the mobile screen's plan shape,
 * filtered to the menus effective on `date` (defaults to today) so the mobile
 * "active plans" list matches what the web shows as effective. Each plan's items
 * are the primary choice (CHOICE 1) plus the dessert — the representative menu.
 */
export function loadMobileMealPlans(
  date: string = new Date().toISOString().split("T")[0],
  cards: MealCard[] = loadMealPlanningConfig(),
): MobileMealPlan[] {
  return cards
    .filter((c) => cardMatchesDate(c, date))
    .map((c) => {
      const primary = c.choices[0]?.items ?? [];
      const items = [
        ...primary.map((it) => it.name).filter(Boolean),
        ...(c.dessert?.name ? [c.dessert.name] : []),
      ];
      return {
        id: c.id,
        slot: MOBILE_SLOT[c.mealType] ?? c.mealType,
        type: c.forType,
        items,
        calories: c.totalKcal,
        allergens: [],
      };
    });
}
