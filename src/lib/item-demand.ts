// ─────────────────────────────────────────────────────────────────────────────
// What one flight needs of ONE cooked dish — across every consumer of it.
//
// A dish is a POOL, not a meal. Plain Polao is cooked once and drawn down by
// everything that contains it:
//
//     Plain Polao for a flight
//       = PAX choice lines using it        (audience × choice %)
//       + Σ special meals containing it    (meals of that code × qty per meal)
//       + crew lines using it
//
// Nothing "cooks a VGML". A special meal is a KIT over these pools — an assembly
// step, not a cook step — so its components must be added to the pool demand
// rather than raised as separate production.
//
// menuSpecFor() answers with the FIRST menu line that mentions a dish, which is
// why a dish used both as a choice and inside a VGML lost one of its two
// consumers: whichever matched first won and the other share vanished. This
// module adds the shares up instead of picking one.
// ─────────────────────────────────────────────────────────────────────────────

import { loadMealPlanningConfig, perMealQty, type MealCard } from "@/lib/meal-planning-data";
import { dayFromDate, flightTypeFromSector } from "@/lib/production-order-link";
import { specialMealSetsForLeg, type SpecialMealSet } from "@/lib/special-meal-sets";
import type { FlightOrderRow } from "@/lib/sample-data";

type LegOrder = Pick<FlightOrderRow, "date" | "sector" | "pax" | "crew" | "specialMeals" | "specialMealRoster">;

/** One special meal's claim on a dish's pool. */
export type SpecialClaim = {
  code: string;
  /** Meals of this code the flight needs. */
  meals: number;
  /** Portions of the dish in one such meal. */
  perMeal: number;
  /** meals × perMeal — what the assembly reserves out of the pool. */
  qty: number;
};

export type ItemDemand = {
  /** Portions for the PAX / crew menu lines that serve the dish on its own. */
  direct: number;
  /** Portions the special-meal assemblies reserve out of the pool. */
  special: number;
  /** The pool this flight needs cooked — direct + special. */
  total: number;
  /** Which special meals claim it, and how much each takes. */
  claims: SpecialClaim[];
  /** True when the dish is on the day's menu in some form (else nothing sizes it). */
  onMenu: boolean;
};

const EMPTY: ItemDemand = { direct: 0, special: 0, total: 0, claims: [], onMenu: false };

/**
 * The dish's own menu lines for this leg — choice lines and the dessert, NOT
 * special-meal components. Percentage-weighted against the audience the card
 * serves, summed over every line that carries it (a dish in two choices is
 * needed for both).
 */
function directDemand(
  item: string,
  order: LegOrder,
  cards: MealCard[],
): { qty: number; found: boolean } {
  const day = dayFromDate(order.date);
  const ftype = flightTypeFromSector(order.sector ?? "");
  const key = item.trim().toLowerCase();
  const scoped = cards.filter((c) => c.day === day && c.flightType.includes(ftype));
  const applicable = scoped.length > 0 ? scoped : cards.filter((c) => c.day === day);
  let qty = 0;
  let found = false;
  for (const card of applicable) {
    const audience = card.forType === "Crew" ? (order.crew ?? 0) : (order.pax ?? 0);
    for (const ch of card.choices) {
      const line = ch.items.find((it) => it.name.trim().toLowerCase() === key);
      if (!line) continue;
      found = true;
      qty += Math.round((audience * (ch.percentage ?? 100)) / 100) * perMealQty(line);
    }
    if (card.dessert?.name?.trim().toLowerCase() === key) {
      found = true;
      qty += audience;
    }
  }
  return { qty, found };
}

/** What the leg's special meals reserve of this dish, per code. */
export function specialClaimsFor(
  item: string,
  sets: SpecialMealSet[],
): SpecialClaim[] {
  const key = item.trim().toLowerCase();
  // ONE claim per code. Two services can plan the same code (a Breakfast VGML
  // and a Lunch VGML), but the order asks for N VGML in total — counting both
  // cards would reserve the dish twice for meals that will only be made once.
  // The larger claim wins, so a service with a heavier recipe is not undercut.
  const byCode = new Map<string, SpecialClaim>();
  for (const s of sets) {
    const comp = s.components.find((c) => c.name.trim().toLowerCase() === key);
    if (!comp || s.qty <= 0) continue;
    const perMeal = perMealQty(comp);
    const claim: SpecialClaim = { code: s.code, meals: s.qty, perMeal, qty: s.qty * perMeal };
    const hit = byCode.get(s.code);
    if (!hit || claim.qty > hit.qty) byCode.set(s.code, claim);
  }
  return [...byCode.values()];
}

/**
 * Everything this flight needs of one dish: its own menu lines plus every
 * special meal that contains it. This is the number production must cover, and
 * the number packaging divides between the loose line and the assemblies.
 */
export function itemDemandForOrder(
  item: string | undefined,
  order: LegOrder | undefined,
  cards: MealCard[] = loadMealPlanningConfig(),
  sets?: SpecialMealSet[],
): ItemDemand {
  if (!item || !order) return EMPTY;
  const direct = directDemand(item, order, cards);
  const claims = specialClaimsFor(item, sets ?? specialMealSetsForLeg(order, cards));
  const special = claims.reduce((s, c) => s + c.qty, 0);
  return {
    direct: direct.qty,
    special,
    total: direct.qty + special,
    claims,
    onMenu: direct.found || claims.length > 0,
  };
}

/** Human-readable sizing, e.g. "168 pax × 60% = 101 + 5 VGML × 1 = 106". */
export function explainItemDemand(d: ItemDemand): string {
  if (!d.onMenu) return "not on this day's menu plan";
  const parts: string[] = [];
  if (d.direct > 0) parts.push(`${d.direct.toLocaleString()} menu line`);
  for (const c of d.claims) parts.push(`${c.qty.toLocaleString()} for ${c.code} (${c.meals} × ${c.perMeal})`);
  return parts.length > 0 ? `${parts.join(" + ")} = ${d.total.toLocaleString()}` : "0";
}
