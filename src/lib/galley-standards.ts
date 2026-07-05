// Galley Loading Standards (loading scales) — master data.
//
// Each standard is a rule that auto-fills one Handing/Taking-sheet quantity
// when a new galley plan is created: fixed qty, per-PAX / per-crew ratio, or
// "1 per N PAX" (trolleys). Rules are generated for every item in the Galley
// Item Master (src/lib/galley-items.ts) except meal-derived and auto-total
// fields, plus a "Meal Mix" group of percentages that drive the meal split in
// buildInitialGalley. The catering manager maintains all of it on the Loading
// Standards page — no quantity default lives in code anymore.

import { AUTO_TOTAL_KEYS, DEFAULT_GALLEY_ITEMS } from "@/lib/galley-items";
import { GALLEY_STOCK_DEFS } from "@/lib/galley-catalog";
import { aircraftFleet, flights, type Aircraft } from "@/lib/sample-data";

export type StandardBasis = "fixed" | "pax" | "crew" | "paxCrew" | "onePerNPax";

export type LoadingStandard = {
  /** GalleyPlan key this rule fills — or a "mix.*" meal-mix parameter. */
  key: string;
  label: string;
  /** Display group — the sheet section for item rules, "Meal Mix" for parameters. */
  group: string;
  basis: StandardBasis;
  /** Ratio per basis unit — or the fixed qty, or N for "1 per N PAX". */
  factor: number;
  /** Added after the ratio is applied (e.g. headrest covers = PAX + 50). */
  offset?: number;
  round?: "round" | "ceil";
  min?: number;
  unit?: string;
};

export const BASIS_LABEL: Record<StandardBasis, string> = {
  fixed: "Fixed qty",
  pax: "Per PAX",
  crew: "Per Crew",
  paxCrew: "Per PAX + Crew",
  onePerNPax: "1 per N PAX",
};

// ── Meal Mix parameters ──────────────────────────────────────────────────────
// Not sheet quantities — percentages/counts buildInitialGalley uses to derive
// the meal split from PAX & crew.
export const MEAL_MIX_GROUP = "Meal Mix";
export const MEAL_MIX_DEFAULTS: LoadingStandard[] = [
  { key: "mix.depChickenPct", label: "Departure Chicken Share", group: MEAL_MIX_GROUP, basis: "fixed", factor: 40, unit: "%" },
  { key: "mix.depVegPct",     label: "Departure Veg Share",     group: MEAL_MIX_GROUP, basis: "fixed", factor: 2.5, unit: "%" },
  { key: "mix.arrLoadPct",    label: "Arrival Load (of Dep EY)",group: MEAL_MIX_GROUP, basis: "fixed", factor: 35, unit: "%" },
  { key: "mix.cockpitCrew",   label: "Cockpit Crew",            group: MEAL_MIX_GROUP, basis: "fixed", factor: 2 },
];
export const isMealMixKey = (key: string) => key.startsWith("mix.");

// ── Default rules per item ───────────────────────────────────────────────────
// Ratio-based scales; every other covered item defaults to a fixed quantity.
const RATIO_RULES: Record<string, Pick<LoadingStandard, "basis" | "factor" | "offset" | "round" | "min">> = {
  water250Pax:    { basis: "pax", factor: 2 },
  water500Crew:   { basis: "crew", factor: 2 },
  teaBag50pcs:    { basis: "onePerNPax", factor: 50, offset: 2, min: 2 },
  paperCup:       { basis: "paxCrew", factor: 1.5 },
  crewBreakfast:  { basis: "crew", factor: 1 },
  crewLunch:      { basis: "crew", factor: 1 },
  crewAppetizer:  { basis: "crew", factor: 1 },
  crewLightSnacks:{ basis: "crew", factor: 2 },
  crewDessert:    { basis: "crew", factor: 2 },
  crewButterJam:  { basis: "crew", factor: 2.5 },
  wetTissue:      { basis: "paxCrew", factor: 1 },
  babyWipes:      { basis: "pax", factor: 1, offset: 20 },
  headRestCover:  { basis: "pax", factor: 1, offset: 50 },
  pillowCoverBig: { basis: "pax", factor: 1, offset: 50 },
  safetyCard:     { basis: "paxCrew", factor: 1 },
  totalFirni:     { basis: "paxCrew", factor: 1 },
  totalCutlery:   { basis: "paxCrew", factor: 1 },
  traySetupDepEY: { basis: "pax", factor: 1.04 },
  fullMealCart:   { basis: "onePerNPax", factor: 45, round: "ceil", min: 1 },
  halfMealCart:   { basis: "onePerNPax", factor: 50, round: "round", min: 1 },
  banana:         { basis: "crew", factor: 1 },
  apple:          { basis: "crew", factor: 1 },
};

const FIXED_DEFAULTS: Record<string, number> = {
  // Hot & cold beverage
  coke225: 0, pepsi225: 10, sprite225: 0, sevenUp225: 10,
  cokeCanBC: 2, spriteCanBC: 2, dietCanBC: 4,
  appleJuice1L: 1, mangoJuice1L: 2, orangeJuice1L: 1,
  // Tea, coffee & others
  coffee50g: 6, coffeeMate400g: 2, greenTea: 10, zeroCal: 10,
  milkPowder: 1.5, sugar: 2, saltPkt: 20, pepperPkt: 0, teaPot: 6,
  disposableSpoon: 20, extraCottage: 10, sanitizerBtl: 0,
  // BC / lounge
  soda: 0, lemon: 0, ginger: 0, tonic: 0,
  // Crew service extras
  crewExtraLunchVeg: 1,
  // Tray setup & service
  totalSalad: 2,
  // Amenities
  napkinPaper: 8, facialTissue: 3, kitchenTowel: 3,
  blanket: 6, pillowCoverSmall: 0,
  handWash: 11, toiletRoll: 1, aerosol: 12, celeste: 2, airFreshener: 0,
  surgicalGloves: 15, ovenGloves: 20, surgicalMask: 0, oneShot: 1,
  sicknessBag: 0,
  dailyMedeline: 2, emkBox: 1, upkBox: 2, fanBox: 2,
  healthDeclForm: 100, baggageDeclForm: 100, bdEdCard: 20, commentsCard: 50,
  // Equipment
  fullWastageCart: 1, halfWastageCart: 0, standardCabinet: 5, ovenCase: 6,
  ceramicMealBowl: 3, ceramicDessertBowl: 0, ceramicButterBowl: 0, ceramicNutBowl: 0,
  teaCupSaucer: 0, tumblerGlass: 0, snacksPlate: 2,
  teaSpoon: 3, dinnerFork: 3, dinnerSpoon: 3, dinnerKnife: 0,
  longSpoon: 3, iceTong: 1, iceBucket: 1, roundTraySteel: 1, serviceTrayBig: 4,
};

export const DEFAULT_STANDARDS: LoadingStandard[] = [
  ...MEAL_MIX_DEFAULTS,
  ...DEFAULT_GALLEY_ITEMS
    .filter((i) => !AUTO_TOTAL_KEYS.has(i.key) && (RATIO_RULES[i.key] || FIXED_DEFAULTS[i.key] !== undefined))
    .map((i): LoadingStandard => {
      const ratio = RATIO_RULES[i.key];
      return {
        key: i.key,
        label: i.label,
        group: i.section,
        unit: i.unit,
        basis: ratio?.basis ?? "fixed",
        factor: ratio?.factor ?? FIXED_DEFAULTS[i.key] ?? 0,
        offset: ratio?.offset,
        round: ratio?.round,
        min: ratio?.min,
      };
    }),
];

export function computeStandard(s: LoadingStandard, pax: number, crew: number): number {
  // Fixed quantities pass through unrounded (e.g. 1.5 kg milk powder).
  if (s.basis === "fixed") return Math.max(s.min ?? 0, s.factor + (s.offset ?? 0));
  const base =
    s.basis === "pax" ? pax :
    s.basis === "crew" ? crew :
    s.basis === "paxCrew" ? pax + crew :
    /* onePerNPax */ pax / Math.max(1, s.factor);
  const raw = (s.basis === "onePerNPax" ? base : base * s.factor) + (s.offset ?? 0);
  const rounded = s.round === "ceil" ? Math.ceil(raw) : Math.round(raw);
  return Math.max(s.min ?? 0, rounded);
}

// ── Per-aircraft-type loading standards ──────────────────────────────────────
// Beverage/amenity/equipment scales are defined SEPARATELY for each aircraft
// type (a wide-body A330 loads differently from an ATR turboprop). Meals are
// NOT here — they flow Order → Dispatch → Galley. So the per-aircraft standard
// covers only the physical stock lines.
export const STOCK_DEFAULT_STANDARDS: LoadingStandard[] = GALLEY_STOCK_DEFS.map((d) => {
  const ratio = RATIO_RULES[d.key];
  return {
    key: d.key,
    label: d.label,
    group: d.section,
    unit: d.unit,
    basis: ratio?.basis ?? "fixed",
    factor: ratio?.factor ?? FIXED_DEFAULTS[d.key] ?? 0,
    offset: ratio?.offset,
    round: ratio?.round,
    min: ratio?.min,
  };
});

/** Live Aircraft fleet — the persisted Configuration > Aircraft list (which the
 *  Loading Standards "Add Aircraft" action also writes to), falling back to the
 *  seed fleet. Lets aircraft added anywhere show up as loadable types. */
function readAircraftFleet(): Aircraft[] {
  try {
    const raw = localStorage.getItem("harvest-data-v1:config-aircraft-rows");
    if (raw) {
      const parsed = JSON.parse(raw) as Aircraft[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch { /* unavailable / corrupt — fall back to seed */ }
  return aircraftFleet;
}

/** Distinct aircraft types that can carry their own loading standard — drawn
 *  from the Aircraft fleet (persisted config) and the flight board. */
export function galleyAircraftTypes(): string[] {
  const set = new Set<string>();
  for (const a of readAircraftFleet()) if (a.type) set.add(a.type);
  for (const f of flights) if (f.aircraft) set.add(f.aircraft);
  return [...set].sort((a, b) => a.localeCompare(b));
}

const BY_AIRCRAFT_KEY = "harvest-data-v1:galley-loading-standards-by-aircraft";
type StandardsByAircraft = Record<string, LoadingStandard[]>;

function readByAircraft(): StandardsByAircraft {
  try {
    const raw = localStorage.getItem(BY_AIRCRAFT_KEY);
    return raw ? (JSON.parse(raw) as StandardsByAircraft) : {};
  } catch {
    return {};
  }
}

/** The loading standard for one aircraft type — saved scales merged over the
 *  stock defaults by key (new default items appear even for saved types). */
export function loadStandardsForAircraft(aircraft?: string): LoadingStandard[] {
  const saved = aircraft ? readByAircraft()[aircraft] : undefined;
  if (!saved || saved.length === 0) return STOCK_DEFAULT_STANDARDS;
  const savedBy = new Map(saved.map((s) => [s.key, s]));
  const defaultKeys = new Set(STOCK_DEFAULT_STANDARDS.map((d) => d.key));
  return [
    ...STOCK_DEFAULT_STANDARDS.map((d) => savedBy.get(d.key) ?? d),
    ...saved.filter((s) => !defaultKeys.has(s.key)),
  ];
}

export function saveStandardsForAircraft(aircraft: string, list: LoadingStandard[]) {
  try {
    const all = readByAircraft();
    all[aircraft] = list;
    localStorage.setItem(BY_AIRCRAFT_KEY, JSON.stringify(all));
  } catch { /* quota — non-fatal */ }
}

export function resetStandardsForAircraft(aircraft: string) {
  try {
    const all = readByAircraft();
    delete all[aircraft];
    localStorage.setItem(BY_AIRCRAFT_KEY, JSON.stringify(all));
  } catch { /* non-fatal */ }
}

/** Factor of a fixed-basis parameter (used for the Meal Mix group). */
export function standardFactor(standards: LoadingStandard[], key: string, fallback: number): number {
  const rule = standards.find((s) => s.key === key);
  return rule ? rule.factor : fallback;
}
