// ─────────────────────────────────────────────────────────────────────────────
// Production → Order tagging.
//
// A production order is tagged with the Order #s it serves (`servesOrderNos`),
// and every order carries a flight — so a production run should always be
// reachable to a flight. In practice the tag goes missing:
//
//   • it is a SNAPSHOT taken at creation. A run created before that day's flight
//     orders existed is tagged with nothing, permanently.
//   • two creation paths never write it at all — the delay-management re-cook
//     order and the LMC top-up order (production-entry raiseTopUp).
//
// So downstream modules cannot treat an empty tag as "serves no order". This
// module exposes the SAME rule the Production Order page uses to compute the
// tag, so a consumer can resolve the link live instead of depending on whatever
// was frozen at creation time.
// ─────────────────────────────────────────────────────────────────────────────

import { DAYS, loadMealPlanningConfig, type FlightType, type MealCard } from "@/lib/meal-planning-data";
import type { FlightOrder } from "@/lib/flight-orders-store";

/** Bangladesh domestic stations. ZYL and SYL are both in use for Sylhet. */
const DOMESTIC_AIRPORTS = new Set([
  "DAC", "CGP", "CXB", "ZYL", "SYL", "JSR", "RJH", "BZL", "SPD",
]);

/**
 * A sector's flight type.
 *
 * DOMESTIC ONLY WHEN EVERY STOP IS DOMESTIC. Reading the destination alone made
 * a rotation contradict itself — DAC → DXB was International while its own
 * return DXB → DAC was Domestic — and put the wrong menu card on the leg coming
 * home, since flight type is what selects it.
 *
 * Stops are split on anything that is not a code character, because sectors are
 * written three ways in this app ("DAC → DXB", "DAC→DXB", "DAC-DXB"); splitting
 * on the arrow alone left "DAC-CGP" as one token that matched no airport, so
 * every hyphen-written domestic flight read as International.
 */
export function flightTypeFromSector(sector: string): FlightType {
  const stops = sector.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (stops.length === 0) return "International";
  return stops.every((s) => DOMESTIC_AIRPORTS.has(s)) ? "Domestic" : "International";
}

/** Weekday name for a yyyy-mm-dd date, Monday-first to match the menu cards. */
export function dayFromDate(dateStr: string): (typeof DAYS)[number] {
  const d = new Date(dateStr);
  const idx = d.getDay() === 0 ? 6 : d.getDay() - 1;
  return DAYS[idx];
}

export type MenuSpec = {
  flightTypes: string[];
  forType: string;
  kind: "Choice" | "Special";
  percentage?: number;
  /** The card's service, e.g. Breakfast / Lunch / Dinner — the item's meal type. */
  mealType?: string;
};

/**
 * Where an item sits in the menu plan: which flight types serve it, and whether
 * it is a choice line, a special meal or the dessert. Prefers the card for the
 * given weekday, then any card carrying the item.
 */
export function menuSpecFor(name: string, dayOfWeek: string, cards: MealCard[]): MenuSpec | null {
  const scan = (cs: MealCard[]): MenuSpec | null => {
    for (const card of cs) {
      for (const ch of card.choices) {
        if (ch.items.some((it) => it.name === name))
          return { flightTypes: card.flightType, forType: card.forType, kind: "Choice", percentage: ch.percentage, mealType: card.mealType };
      }
      for (const sp of card.specialMeals) {
        if (sp.enabled && sp.items.some((it) => it.name === name))
          return { flightTypes: card.flightType, forType: card.forType, kind: "Special", mealType: card.mealType };
      }
      if (card.dessert.name === name)
        return { flightTypes: card.flightType, forType: card.forType, kind: "Choice", percentage: 100, mealType: card.mealType };
    }
    return null;
  };
  return scan(cards.filter((c) => c.day === dayOfWeek)) ?? scan(cards);
}

/**
 * How much of a production run belongs to ONE flight.
 *
 * A run is many-to-many with flights: one day's Grilled Chicken run feeds every
 * flight whose menu includes it, so its produced quantity is a day total, not a
 * flight quantity. The flight's share is its own audience × the menu line's
 * percentage — the same arithmetic the Production Order page uses to size the
 * run in the first place, applied to a single order instead of the day.
 *
 * Returns null when the item isn't on the menu plan at all (no rule to apply).
 */
export function flightPortionFor(
  item: string | undefined,
  order: Pick<FlightOrder, "date" | "pax" | "crew" | "specialMeals">,
  cards: MealCard[] = loadMealPlanningConfig(),
): number | null {
  if (!item) return null;
  const spec = menuSpecFor(item, dayFromDate(order.date), cards);
  if (!spec) return null;
  const audience =
    spec.kind === "Special" ? (order.specialMeals ?? 0)
    : spec.forType === "Crew" ? (order.crew ?? 0)
    : order.pax;
  const pct = spec.percentage ?? 100;
  return Math.round((audience * pct) / 100);
}

/**
 * The Order #s a production of `item` on `date` serves — orders flying that date
 * whose flight type the item's menu card covers. This is exactly the rule the
 * Production Order page applies when it stamps `servesOrderNos`; computing it
 * here lets a consumer recover the link when the stamp is missing or stale.
 * Sorted, so a caller picking "the first" gets a stable answer.
 */
export function servedOrderNosFor(
  item: string | undefined,
  date: string | undefined,
  orders: FlightOrder[],
  cards: MealCard[] = loadMealPlanningConfig(),
): string[] {
  if (!item || !date) return [];
  const spec = menuSpecFor(item, dayFromDate(date), cards);
  if (!spec) return [];
  return Array.from(new Set(
    orders
      .filter((o) => o.date === date
        && (o.orderType ?? "flight") !== "crew"
        && spec.flightTypes.includes(flightTypeFromSector(o.sector)))
      .map((o) => o.orderNo),
  )).sort();
}
