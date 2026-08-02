// ─────────────────────────────────────────────────────────────────────────────
// Menu meals as SETS — the passenger/crew counterpart of special-meal-sets.
//
// A menu card plans ONE meal service (Breakfast / Lunch / Heavy Snacks /
// Dinner) as choices of 2-3 dishes: CHOICE 1 = Plain Polao + Beef Rezala + Mug
// Dal Vuna at 60%. Production explodes those into per-dish runs — each sized
// audience × choice % — so by the time packaging sees them they are loose runs
// with nothing saying they are one meal.
//
// This module puts the meal back together: for a flight leg it returns one set
// per choice of the ONE service that leg actually serves, whose components are
// the choice's dishes and whose qty is that choice's share of the headcount.
// Packaging assembles them exactly like special meals: one package per meal,
// one label, traceable to every component run.
//
// WHICH service is the whole point. An order books a headcount and an ETD —
// never a meal period — so the service has to be resolved from the departure
// time against each card's own serving window. Taking every card on the day
// instead put Breakfast AND Lunch AND Dinner AND Heavy Snacks on a single
// short-haul leg: four meals per person, none of them asked for.
//
// The sets reuse the SpecialMealSet shape (marked `kind: "pax" | "crew"`) so the
// whole assembly pipeline — reservation ledger, SetLine sizing, set allocations
// — serves all three without a parallel code path.
//
// NOT included in a set: the card's DESSERT. It is served alongside the meal
// rather than packed inside the choice, so it keeps its own loose line and its
// own production run.
// ─────────────────────────────────────────────────────────────────────────────

import {
  cardMatchesDate, loadMealPlanningConfig, type ForType, type MealCard,
} from "@/lib/meal-planning-data";
import { dayFromDate, flightTypeFromSector } from "@/lib/production-order-link";
import { resolveMealSlot } from "@/lib/meal-slot-settings";
import type { SpecialMealSet } from "@/lib/special-meal-sets";
import type { FlightOrderRow } from "@/lib/sample-data";

type LegOrder = Pick<FlightOrderRow, "date" | "sector" | "etd">;

/** `SpecialMealSet.kind` values — the two assembled-from-a-menu-card audiences. */
export type SetKind = "pax" | "crew";

const KIND_OF: Record<ForType, SetKind> = { Passengers: "pax", Crew: "crew" };
const AUDIENCE_OF: Record<SetKind, ForType> = { pax: "Passengers", crew: "Crew" };
/** Short prefix that goes into the set code and the meal name. */
const PREFIX_OF: Record<SetKind, string> = { pax: "PAX", crew: "CREW" };

/** The audience a menu-card set feeds; null for a special meal (an SSR). */
export function setAudience(s: Pick<SpecialMealSet, "kind">): ForType | null {
  return s.kind ? AUDIENCE_OF[s.kind] : null;
}

/** Is this set an assembled crew meal (vs a pax meal or a passenger SSR)? */
export function isCrewSet(s: Pick<SpecialMealSet, "kind">): boolean {
  return s.kind === "crew";
}

/** Is this set an assembled passenger meal (vs a crew meal or an SSR)? */
export function isPaxSet(s: Pick<SpecialMealSet, "kind">): boolean {
  return s.kind === "pax";
}

/** Is this an assembled menu-card meal at all — pax or crew, but not an SSR? */
export function isMenuSet(s: Pick<SpecialMealSet, "kind">): boolean {
  return s.kind === "pax" || s.kind === "crew";
}

/**
 * Does a stored set code denote a crew / passenger meal package? Allocation
 * records only carry the code (no `kind`), so downstream surfaces recognise
 * them by the prefix `setCodeFor` always writes.
 */
export function isCrewSetCode(code: string | undefined): boolean {
  return !!code && code.toUpperCase().startsWith("CREW-");
}
export function isPaxSetCode(code: string | undefined): boolean {
  return !!code && code.toUpperCase().startsWith("PAX-");
}
/** Any assembled menu-card meal code (pax or crew), vs an SSR code like VGML. */
export function isMenuSetCode(code: string | undefined): boolean {
  return isCrewSetCode(code) || isPaxSetCode(code);
}

/** Stable set code — "PAX-LUNCH", "CREW-HEAVY-SNACKS-C2". The choice suffix
 *  appears only when the card offers more than one choice, so a single-choice
 *  service keeps the short, obvious code. */
function setCodeFor(kind: SetKind, service: string, choiceIdx: number, choiceCount: number): string {
  const slug = service.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  const base = `${PREFIX_OF[kind]}-${slug}`;
  return choiceCount > 1 ? `${base}-C${choiceIdx + 1}` : base;
}

/** "CHOICE 1" → "Choice 1" for display next to the service name. */
function choiceLabel(raw: string | undefined, idx: number): string {
  const s = (raw ?? "").trim();
  if (!s) return `Choice ${idx + 1}`;
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Serving-time arithmetic ──────────────────────────────────────────────────

/** Minutes past midnight for "HH:MM" / "H.MM" / "1430"; -1 when unreadable. */
function minutesOf(raw: string | undefined): number {
  const t = (raw ?? "").trim();
  if (!t) return -1;
  const hm = t.match(/^(\d{1,2})\s*[:.]\s*(\d{2})/);
  if (hm) {
    const h = Number(hm[1]), m = Number(hm[2]);
    return h < 24 && m < 60 ? h * 60 + m : -1;
  }
  const digits = t.replace(/\D/g, "");
  if (!digits) return -1;
  if (digits.length <= 2) {
    const h = Number(digits);
    return h < 24 ? h * 60 : -1;
  }
  const h = Number(digits.slice(0, digits.length - 2));
  const m = Number(digits.slice(-2));
  return h < 24 && m < 60 ? h * 60 + m : -1;
}

/** Shortest distance between two times on a 24h clock, in minutes. */
function clockGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
}

type Window = { start: number; end: number };

function windowOf(card: MealCard): Window | null {
  const start = minutesOf(card.servingTime?.start);
  const end = minutesOf(card.servingTime?.end);
  return start < 0 || end < 0 ? null : { start, end };
}

/** Does the window cover this departure time? Windows that run past midnight
 *  (22:00–02:00) are normal for a late service, so they wrap rather than being
 *  read as an empty range. Bounds are inclusive. */
function covers(w: Window, mins: number): boolean {
  return w.end >= w.start
    ? mins >= w.start && mins <= w.end
    : mins >= w.start || mins <= w.end;
}

/** How far a departure sits outside a window — 0 when inside it. */
function distanceTo(w: Window, mins: number): number {
  if (covers(w, mins)) return 0;
  return Math.min(clockGap(mins, w.start), clockGap(mins, w.end));
}

/** Width of a window in minutes (wrapping ones included). */
function widthOf(w: Window): number {
  return w.end >= w.start ? w.end - w.start : 1440 - w.start + w.end;
}

/** "12:00 – 14:30" for the UI, when the card states a window. */
export function servingWindowLabel(card: MealCard): string | undefined {
  const s = card.servingTime?.start?.trim();
  const e = card.servingTime?.end?.trim();
  return s && e ? `${s} – ${e}` : undefined;
}

/** How a leg's service was decided — surfaced so the UI can say WHY this
 *  service and not another, rather than presenting a guess as a fact. */
export type ServiceMatch =
  /** The card's serving window covers the departure time. */
  | "window"
  /** No window covered it — the service whose window sits closest to departure. */
  | "nearest"
  /** No card for this audience states a window at all, so the Meal Slots master
   *  named the service for that hour. */
  | "slot"
  /** The day plans exactly one menu for this audience — nothing to choose. */
  | "only";

export type MealService = {
  card: MealCard;
  match: ServiceMatch;
  /** "12:00 – 14:30", when the card states a serving window. */
  window?: string;
};

/** The audience's menu cards that apply to this leg (day + flight type + dates). */
function applicableCards(order: LegOrder, forType: ForType, cards: MealCard[]): MealCard[] {
  const day = dayFromDate(order.date);
  const ftype = flightTypeFromSector(order.sector ?? "");
  const dayCards = cards.filter(
    (c) => c.forType === forType && c.day === day && cardMatchesDate(c, order.date),
  );
  const scoped = dayCards.filter((c) => c.flightType.includes(ftype));
  return scoped.length > 0 ? scoped : dayCards;
}

/**
 * The ONE service a leg carries for an audience.
 *
 * People eat the service that is being served when they fly, so the departure
 * time picks it: the card whose serving window covers the ETD, and failing that
 * the card whose window sits CLOSEST to it (a 11:30 departure gets the Lunch
 * that starts at 12:00). `match` records which of the two it was, so a
 * near-miss is never mistaken for a planned answer.
 *
 * The card's own window is the only authority here. The Meal Slots master
 * (Configuration → Meal Slots) is consulted ONLY when no card states a window
 * at all — the two masters can genuinely disagree (slots put 11:30 in Heavy
 * Snacks while the card serves Lunch 12:00–14:30), and letting them arbitrate
 * the same question produces an answer that contradicts the serving time
 * printed right next to it.
 *
 * Returns null when the day plans no menu for this audience and flight type, or
 * when the ETD is unreadable and there is more than one menu to choose between
 * (guessing would put the wrong meal on the aircraft).
 */
export function serviceForLeg(
  order: LegOrder | undefined,
  forType: ForType,
  cards: MealCard[] = loadMealPlanningConfig(),
): MealService | null {
  if (!order) return null;
  const applicable = applicableCards(order, forType, cards);
  if (applicable.length === 0) return null;

  const pick = (card: MealCard, match: ServiceMatch): MealService =>
    ({ card, match, window: servingWindowLabel(card) });

  // One menu for the day is not a choice — serve it whatever the ETD says.
  if (applicable.length === 1) return pick(applicable[0], "only");

  const dep = minutesOf(order.etd);
  if (dep < 0) return null;   // several services, no departure time to choose by

  const windowed = applicable
    .map((c) => ({ c, w: windowOf(c) }))
    .filter((x): x is { c: MealCard; w: Window } => !!x.w);

  // 1. A window that covers departure. Overlapping windows are possible once a
  //    planner edits them, so the NARROWEST wins — the more specific service.
  const covering = windowed
    .filter((x) => covers(x.w, dep))
    .sort((a, b) => widthOf(a.w) - widthOf(b.w) || a.w.start - b.w.start);
  if (covering.length > 0) return pick(covering[0].c, "window");

  // 2. Closest window — the service either side of the gap the ETD falls in.
  if (windowed.length > 0) {
    const nearest = [...windowed].sort(
      (a, b) => distanceTo(a.w, dep) - distanceTo(b.w, dep) || a.w.start - b.w.start,
    );
    return pick(nearest[0].c, "nearest");
  }

  // 3. No card states a window at all — only now does the Meal Slots master get
  //    to name the service for that hour.
  const slot = resolveMealSlot(order.etd ?? "");
  const named = applicable.find(
    (c) => c.mealType.trim().toLowerCase() === slot?.name.trim().toLowerCase(),
  );
  return named ? pick(named, "slot") : pick(applicable[0], "nearest");
}

/**
 * The meal sets a leg needs for one audience — one per choice of its service.
 *
 * Each choice's quantity is `round(headcount × choice %)`, the exact arithmetic
 * production sized the component runs with, so the kits always match what the
 * kitchen cooked. `headcount` is the order's pax or crew booking — pass the
 * crew-meal order's count when crew is booked separately. Zero headcount, or no
 * resolvable service, means no sets.
 */
export function mealSetsForLeg(
  order: LegOrder | undefined,
  forType: ForType,
  headcount: number,
  cards: MealCard[] = loadMealPlanningConfig(),
): SpecialMealSet[] {
  if (!order || headcount <= 0) return [];
  const service = serviceForLeg(order, forType, cards);
  if (!service) return [];

  const kind = KIND_OF[forType];
  const { card } = service;
  const serviceName = card.mealType || "Meal";
  const choices = card.choices.filter((ch) => ch.items.length > 0);
  const label = PREFIX_OF[kind] === "PAX" ? "Pax" : "Crew";
  const out: SpecialMealSet[] = [];
  for (let i = 0; i < choices.length; i++) {
    const ch = choices[i];
    const qty = Math.round((headcount * (ch.percentage ?? 100)) / 100);
    if (qty <= 0) continue;
    out.push({
      key: `${PREFIX_OF[kind]}|${serviceName}|${i}`,
      code: setCodeFor(kind, serviceName, i, choices.length),
      name: choices.length > 1
        ? `${label} ${serviceName} · ${choiceLabel(ch.label, i)}`
        : `${label} ${serviceName}`,
      mealType: serviceName,
      qty,
      components: ch.items,
      source: "count",
      paxQty: kind === "pax" ? qty : 0,
      crewQty: kind === "crew" ? qty : 0,
      kind,
      servingWindow: service.window,
      /** The choice's share of the audience — shown so 101 of 168 is explainable. */
      choicePct: ch.percentage ?? 100,
    });
  }
  return out;
}

/** Crew meals for a leg — thin alias, kept because "crew meal" is the domain term. */
export function crewMealSetsForLeg(
  order: LegOrder | undefined,
  crewCount: number,
  cards: MealCard[] = loadMealPlanningConfig(),
): SpecialMealSet[] {
  return mealSetsForLeg(order, "Crew", crewCount, cards);
}

/** Passenger meals for a leg — thin alias, mirroring crewMealSetsForLeg. */
export function paxMealSetsForLeg(
  order: LegOrder | undefined,
  paxCount: number,
  cards: MealCard[] = loadMealPlanningConfig(),
): SpecialMealSet[] {
  return mealSetsForLeg(order, "Passengers", paxCount, cards);
}

/**
 * The services on this day+flight type that carry a dish — as a choice line OR
 * as the dessert — regardless of which one the leg serves, and labelled with
 * their audience ("Crew Breakfast", "Pax Dinner").
 *
 * This is what tells a dish cooked for a service the flight doesn't serve apart
 * from a dish nobody planned at all: both size to nothing, but "cooked for the
 * Breakfast crew service, and this flight serves Dinner" and "not on this day's
 * menu plan" need completely different fixes from whoever reads the row.
 *
 * The dessert is included precisely because it is NOT part of a kit: it is the
 * one line that stays loose, so an off-service dessert reaches this code path
 * with no claim behind it and would otherwise read as unplanned.
 */
export function servicesCarrying(
  item: string | undefined,
  order: LegOrder | undefined,
  cards: MealCard[] = loadMealPlanningConfig(),
): string[] {
  if (!item || !order) return [];
  const key = item.trim().toLowerCase();
  const out = new Set<string>();
  for (const forType of ["Passengers", "Crew"] as ForType[]) {
    const label = forType === "Crew" ? "Crew" : "Pax";
    for (const c of applicableCards(order, forType, cards)) {
      const carries =
        c.choices.some((ch) => ch.items.some((it) => it.name.trim().toLowerCase() === key)) ||
        c.dessert?.name?.trim().toLowerCase() === key;
      if (carries) out.add(`${label} ${c.mealType || "Meal"}`);
    }
  }
  return [...out];
}
