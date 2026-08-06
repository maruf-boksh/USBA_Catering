// Per-leg dish swaps on a galley plan.
//
// The meals on a galley sheet are DERIVED — Menu Planning says a leg's service
// is Breakfast Choice 1 = Paratha + Channa Masala + Boiled Egg, and production
// cooked against that same resolution. Editing the menu card to change one
// flight's dish would change it for every flight on that weekday, so a one-off
// substitution has nowhere to live.
//
// A swap is that one-off: "on BG-403 only, Beef Rezala is served as Chicken
// Masala". It is stored ON THE PLAN rather than in the menu, so:
//   • the menu stays the standing plan for every other flight,
//   • the swap travels with the sheet it applies to (draft → forward → sign-off),
//   • and the sheet can SHOW that it deviates, instead of quietly disagreeing
//     with the production runs the kitchen already has open.
//
// The last point is the whole reason a swap also raises an LMC entry (see
// lib/lmc-manual.ts): downstream is already committed, so somebody has to be
// told. A swap that only changed a screen would be worse than no swap at all.

import { loadMealPlanningConfig, type MealCard, type MealItem } from "@/lib/meal-planning-data";

/** Reserved plan key holding the swap list as JSON. Not a sheet line. */
export const MEAL_SWAPS_KEY = "__mealSwaps";

export type MealSwap = {
  /** Leg this applies to — a rotation is one sheet but two legs. */
  flight: string;
  /** The meal the dish belongs to: SpecialMealSet.key ("PAX|Breakfast|0"). */
  setKey: string;
  /** Dish being replaced, as the menu card names it. */
  from: string;
  /** Replacement dish. */
  to: string;
  reason: string;
  at: string;
  by: string;
  /** The LMC entry raised for this swap, so the sheet can point at it. */
  lmcId?: string;
};

/** A component with its swap history attached, for rendering. */
export type SwappedItem = MealItem & { swappedFrom?: string };

// ── Plan encoding ────────────────────────────────────────────────────────────
// The plan is a flat Record<string,string> of sheet quantities, so the swap list
// rides as JSON under a reserved key — the same trick aircraftType already uses.

export function readMealSwaps(plan: Record<string, string>): MealSwap[] {
  try {
    const raw = plan[MEAL_SWAPS_KEY];
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MealSwap[]) : [];
  } catch {
    return [];
  }
}

/** The plan patch that stores `swaps` (drop the key entirely when empty). */
export function writeMealSwaps(swaps: MealSwap[]): Record<string, string> {
  return { [MEAL_SWAPS_KEY]: swaps.length > 0 ? JSON.stringify(swaps) : "" };
}

/**
 * Add a swap, replacing any earlier swap of the same dish on the same meal —
 * swapping A→B then B→C must read as one substitution A→C, not two rows that
 * both claim to replace something.
 */
export function upsertMealSwap(swaps: MealSwap[], next: MealSwap): MealSwap[] {
  const sameLine = (s: MealSwap) => s.flight === next.flight && s.setKey === next.setKey;
  const prior = swaps.find((s) => sameLine(s) && s.to === next.from);
  const merged: MealSwap = prior ? { ...next, from: prior.from } : next;
  // Swapping back to the original dish cancels the substitution outright.
  const rest = swaps.filter((s) => !(sameLine(s) && (s.from === merged.from || s.to === next.from)));
  return merged.from === merged.to ? rest : [...rest, merged];
}

export function removeMealSwap(swaps: MealSwap[], flight: string, setKey: string, from: string): MealSwap[] {
  return swaps.filter((s) => !(s.flight === flight && s.setKey === setKey && s.from === from));
}

// ── Applying ─────────────────────────────────────────────────────────────────

/**
 * The dishes a meal is actually made of on this leg — the card's components with
 * any swap applied. The replacement keeps the swapped-out dish's per-meal
 * quantity (one dish stands in for one dish) but takes the replacement's own
 * weight and calories from the dish master.
 */
export function applyMealSwaps(
  components: MealItem[],
  flight: string,
  setKey: string,
  swaps: MealSwap[],
  dishes: MealItem[] = menuDishMaster(),
): SwappedItem[] {
  const forLine = swaps.filter((s) => s.flight === flight && s.setKey === setKey);
  if (forLine.length === 0) return components;
  const byName = new Map(dishes.map((d) => [d.name.trim().toLowerCase(), d]));
  return components.map((c) => {
    const swap = forLine.find((s) => s.from.trim().toLowerCase() === c.name.trim().toLowerCase());
    if (!swap) return c;
    const replacement = byName.get(swap.to.trim().toLowerCase());
    return {
      ...c,
      name: swap.to,
      weight: replacement?.weight ?? c.weight,
      calories: replacement?.calories ?? c.calories,
      swappedFrom: swap.from,
    };
  });
}

/** Swaps recorded against one leg, for a "what changed on this sheet" summary. */
export function swapsForFlight(swaps: MealSwap[], flight: string): MealSwap[] {
  return swaps.filter((s) => s.flight === flight);
}

// ── Dish master ──────────────────────────────────────────────────────────────

/**
 * Every distinct dish Menu Planning knows about — choices, special meals and
 * desserts across all cards. This is the pool a swap may pick from: a dish the
 * kitchen already has a recipe and a cost for, rather than free text nobody
 * downstream can produce.
 */
export function menuDishMaster(cards: MealCard[] = loadMealPlanningConfig()): MealItem[] {
  const byName = new Map<string, MealItem>();
  const add = (item: MealItem | undefined) => {
    if (!item) return;
    const name = item.name?.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { ...item, name });
  };
  for (const card of cards) {
    for (const ch of card.choices) for (const it of ch.items) add(it);
    for (const sp of card.specialMeals) for (const it of sp.items) add(it);
    add(card.dessert);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
