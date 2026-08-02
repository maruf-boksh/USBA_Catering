// ─────────────────────────────────────────────────────────────────────────────
// Special meals as SETS.
//
// Menu planning defines a special meal as a SET of dishes, not a single dish:
// `specialMeals: [{ type: "VGML", items: [Kashmiri Polao, Paneer Masala,
// Masoor Dal] }]` is ONE meal made of three components.
//
// Production, though, explodes that meal — every component is raised as its own
// run (production-order-link.flightPortionFor gives each of them the order's
// special-meal count as its audience). So by the time packaging sees them there
// are three unrelated runs and nothing saying they are one VGML.
//
// This module puts the meal back together: for a flight leg it returns the
// special-meal sets that leg needs, each with its component dishes and the
// number of MEALS required. Packaging assembles the components into one package
// per set — one finished good, one label, traceable to every component run.
// ─────────────────────────────────────────────────────────────────────────────

import {
  cardMatchesDate, loadMealPlanningConfig, perMealQty, type MealCard, type MealItem,
} from "@/lib/meal-planning-data";
import { dayFromDate, flightTypeFromSector } from "@/lib/production-order-link";
import { SPECIAL_MEAL_BY_CODE, type FlightOrderRow } from "@/lib/sample-data";

/** One special meal the flight needs, with the dishes that make it up. */
export type SpecialMealSet = {
  /** Stable per leg — `${code}|${mealType}`. Two services can plan the same code. */
  key: string;
  /** IATA special-meal code, e.g. VGML. */
  code: string;
  /** Readable name from the special-meal master, else the code itself. */
  name: string;
  /** The card's service — Breakfast / Lunch / Dinner. */
  mealType: string;
  /** MEALS required for this flight (not portions: a 3-item meal × 8 = 24 portions). */
  qty: number;
  /** The dishes the meal is assembled from. Empty ⇒ the code isn't on the menu plan. */
  components: MealItem[];
  /**
   * Where `qty` came from:
   *   "roster" — counted off the order's per-passenger special-meal roster.
   *   "count"  — no roster, so the order's flat special-meal total was applied.
   */
  source: "roster" | "count";
  /** Roster split by audience, when a roster supplied the quantity. */
  paxQty?: number;
  crewQty?: number;
  /** True when the roster asks for a code no meal card plans — nothing to assemble. */
  unplanned?: boolean;
  /**
   * Set when this is a MENU-CARD meal assembled off a choice line rather than a
   * passenger SSR: "pax" for a passenger meal, "crew" for a crew meal. Both ride
   * the same assembly machinery (a Lunch choice is 2-3 dishes packed as one
   * meal, exactly like a VGML), but they are sized from the order's pax/crew
   * booking and labelled by service, so consumers that treat codes as IATA SSRs
   * must branch on this. Undefined ⇒ a special meal. See @/lib/menu-meal-sets.
   */
  kind?: "pax" | "crew";
  /** The card's serving window ("12:00 – 14:30"), when it states one. For a
   *  menu-card meal this is WHY this service was chosen for the leg, so it
   *  belongs next to the meal wherever the choice needs justifying. */
  servingWindow?: string;
  /** The choice's share of the audience (60 for a 60% choice) — what makes a
   *  quantity of 101 off a 168-pax flight explainable on the row. */
  choicePct?: number;
};

type LegOrder = Pick<FlightOrderRow, "date" | "sector" | "specialMeals" | "specialMealRoster">;

/** Numeric planned portions, when the card states one ("As per demand" ⇒ null). */
function plannedPortions(p: number | string): number | null {
  return typeof p === "number" ? p : null;
}

/**
 * The special-meal sets a leg needs.
 *
 * Cards are matched on the leg's weekday, flight type and effective date range —
 * the same rule production sizes against. Quantities come from the order's
 * special-meal roster when it has one (a roster of 8 VGML + 6 CHML is 8 meals
 * and 6 meals, NOT 14 of each). Without a roster there is no per-code split to
 * read, so the order's whole special-meal count goes to the primary code — the
 * one the card gives a planned portion figure for — and `source` says so, so the
 * UI can ask for a roster instead of quietly guessing.
 */
export function specialMealSetsForLeg(
  order: LegOrder | undefined,
  cards: MealCard[] = loadMealPlanningConfig(),
): SpecialMealSet[] {
  if (!order) return [];
  const day = dayFromDate(order.date);
  const ftype = flightTypeFromSector(order.sector ?? "");
  // Cards for this day + flight type; fall back to the day alone when the flight
  // type matches nothing, which is what menuSpecFor does when it resolves items.
  const dayCards = cards.filter((c) => c.day === day && cardMatchesDate(c, order.date));
  const scoped = dayCards.filter((c) => c.flightType.includes(ftype));
  const applicable = scoped.length > 0 ? scoped : dayCards;

  // Planned meals, keyed by code + service. The same code can be planned by two
  // services (a Breakfast VGML is not a Lunch VGML) — both are kept, and the
  // caller drops whichever has no production behind it.
  const planned = new Map<string, { code: string; mealType: string; components: MealItem[]; portions: number | null }>();
  for (const card of applicable) {
    for (const sp of card.specialMeals) {
      if (!sp.enabled || sp.items.length === 0) continue;
      const code = sp.type.toUpperCase();
      const key = `${code}|${card.mealType}`;
      if (planned.has(key)) continue;
      planned.set(key, { code, mealType: card.mealType, components: sp.items, portions: plannedPortions(sp.portions) });
    }
  }

  // Roster → meals per code, split by audience.
  const roster = order.specialMealRoster ?? [];
  const byCode = new Map<string, { total: number; pax: number; crew: number }>();
  for (const e of roster) {
    const code = (e.mealCode ?? "").toUpperCase();
    if (!code) continue;
    const t = byCode.get(code) ?? { total: 0, pax: 0, crew: 0 };
    t.total += 1;
    if (e.audience === "Crew") t.crew += 1; else t.pax += 1;
    byCode.set(code, t);
  }

  const nameOf = (code: string) => SPECIAL_MEAL_BY_CODE[code]?.name ?? code;
  const out: SpecialMealSet[] = [];

  if (byCode.size > 0) {
    for (const [key, p] of planned) {
      const t = byCode.get(p.code);
      if (!t || t.total === 0) continue;      // planned but nobody ordered it
      out.push({
        key, code: p.code, name: nameOf(p.code), mealType: p.mealType,
        qty: t.total, components: p.components,
        source: "roster", paxQty: t.pax, crewQty: t.crew,
      });
    }
    // Codes the roster asks for that no card plans. They cannot be assembled —
    // surfaced anyway so the gap is visible rather than silently dropped.
    for (const [code, t] of byCode) {
      if ([...planned.values()].some((p) => p.code === code)) continue;
      out.push({
        key: `${code}|`, code, name: nameOf(code), mealType: "",
        qty: t.total, components: [],
        source: "roster", paxQty: t.pax, crewQty: t.crew, unplanned: true,
      });
    }
  } else if ((order.specialMeals ?? 0) > 0 && planned.size > 0) {
    // No roster: one number, no split to apply it by. The code the card gives a
    // planned portion figure for takes it (ties broken alphabetically, so the
    // answer is stable) — every other planned code would be a guess.
    const primary = [...planned.entries()].sort(([ka, a], [kb, b]) => {
      const pa = a.portions ?? -1, pb = b.portions ?? -1;
      return pb - pa || ka.localeCompare(kb);
    })[0];
    if (primary) {
      const [key, p] = primary;
      out.push({
        key, code: p.code, name: nameOf(p.code), mealType: p.mealType,
        qty: order.specialMeals, components: p.components, source: "count",
      });
    }
  }

  return out.sort((a, b) => a.code.localeCompare(b.code) || a.mealType.localeCompare(b.mealType));
}

/**
 * One set per CODE. Two services can plan the same code (a Breakfast VGML and a
 * Lunch VGML), and the resolver returns both because only production can say
 * which one a flight is carrying. Any consumer that COUNTS meals must collapse
 * them first — the order asks for N VGML in total, not N per service.
 */
export function dedupeSetsByCode(sets: SpecialMealSet[]): SpecialMealSet[] {
  const best = new Map<string, SpecialMealSet>();
  for (const s of sets) {
    const cur = best.get(s.code);
    if (!cur || s.qty > cur.qty || (s.qty === cur.qty && s.components.length > cur.components.length)) {
      best.set(s.code, s);
    }
  }
  return [...best.values()];
}

/** The set (if any) a cooked dish belongs to — how a run is recognised as a component. */
export function setForComponent(item: string, sets: SpecialMealSet[]): SpecialMealSet | undefined {
  const key = item.trim().toLowerCase();
  return sets.find((s) => s.components.some((c) => c.name.trim().toLowerCase() === key));
}

/**
 * The assembly bill for a meal code: which dishes go into it and how many
 * portions of each per meal. This is the kit recipe — packaging reserves
 * `meals × qtyPerMeal` out of each dish's pool when it assembles.
 *
 * Prefers the card for `day`; falls back to any card planning the code, so a
 * caller that only knows the code still gets the right contents.
 */
export function specialMealComponents(
  code: string,
  day?: string,
  cards: MealCard[] = loadMealPlanningConfig(),
): { name: string; qtyPerMeal: number; weight: number; calories: number }[] {
  const wanted = code.trim().toUpperCase();
  const carrying = cards.filter((c) =>
    c.specialMeals.some((s) => s.enabled && s.type.toUpperCase() === wanted && s.items.length > 0));
  const card = (day ? carrying.find((c) => c.day === day) : undefined) ?? carrying[0];
  const sp = card?.specialMeals.find((s) => s.type.toUpperCase() === wanted);
  return (sp?.items ?? []).map((it) => ({
    name: it.name,
    qtyPerMeal: perMealQty(it),
    weight: it.weight,
    calories: it.calories,
  }));
}

/** Portions one meal of this set consumes across its component pools. */
export function portionsPerMeal(s: SpecialMealSet): number {
  return s.components.reduce((n, c) => n + perMealQty(c), 0);
}

/** Portions a set consumes in total — meals × portions per meal. */
export function setPortions(s: SpecialMealSet): number {
  return s.qty * portionsPerMeal(s);
}
