// ─────────────────────────────────────────────────────────────────────────────
// Demo production for special-meal components.
//
// A special meal is a SET of 2-3 dishes (see special-meal-sets.ts), and the
// kitchen cooks each dish as its own run. The demo data set has flight orders
// carrying special meals but no production behind their component dishes, so
// Packaging correctly reported "0 of 1 set assemblable" and there was nothing
// to demonstrate the assembly with.
//
// This module tops the demo data up: for the flights of a given date it works
// out which component dishes are short, and returns the production runs, entry
// records and QC (cooking-temp) passes that would exist had the kitchen cooked
// them. Everything is derived from the live order book and menu plan, and keyed
// by deterministic ids, so it is idempotent and adapts to whatever date the demo
// orders land on.
//
// It only ever ADDS what is missing — a dish already produced in sufficient
// quantity is left alone, so real production entered through the app is never
// duplicated or overwritten.
// ─────────────────────────────────────────────────────────────────────────────

import { perMealQty, type MealCard } from "@/lib/meal-planning-data";
import type { FlightOrder } from "@/lib/flight-orders-store";
import type { WfProductionEntry, WfProductionEntryRecord } from "@/lib/workflow-store";
import { specialMealSetsForLeg, dedupeSetsByCode } from "@/lib/special-meal-sets";

/** The cooking-temp QC log shape the packaging pipeline reads. */
export type DemoQcRecord = {
  id: string;
  batch: string;              // production order id
  item: string;
  cookingTime: string;
  standardTemp: string;
  standardTempMin: number;
  thresholdTemp: number;
  measuredTemp: number;
  cookedBy: string;
  checkedBy: string;
  taste: string;
  sensoryPass: boolean;
  date: string;
  checkedAt?: string;
};

export type DemoSpecialMealProduction = {
  entries: WfProductionEntry[];
  records: WfProductionEntryRecord[];
  qc: DemoQcRecord[];
};

const KITCHEN = { warehouseId: "WH-003", officeId: "OFF-001" };   // Hot Kitchen
const CHEFS = ["Chef R. Karim", "Chef N. Hasan", "Chef S. Mahmud", "Chef A. Rahim"];
const CHECKERS = ["F. Begum", "A. Khan"];

/** Deterministic small hash — picks a stable chef/temperature per dish. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** ABBR from a dish name — the lot suffix, e.g. "Buttered Veg" → "BTV". */
function initials(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter(Boolean);
  const abbr = letters.length >= 3 ? letters.slice(0, 3).map((w) => w[0]).join("")
    : letters.length === 2 ? letters[0].slice(0, 2) + letters[1][0]
    : (letters[0] ?? "XXX").slice(0, 3);
  return abbr.padEnd(3, "X");
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The production a date's special meals need but do not have.
 *
 * `producedFor` reports how much of a dish is already produced on that date
 * (across every run), so an existing partial run is topped up rather than
 * duplicated — the day's requirement is met exactly between them.
 */
export function planSpecialMealDemoProduction(opts: {
  date: string;
  orders: FlightOrder[];
  cards: MealCard[];
  producedFor: (item: string, date: string) => number;
  /** Production order ids already present — never re-issued. */
  existingIds: Set<string>;
}): DemoSpecialMealProduction {
  const { date, orders, cards, producedFor, existingIds } = opts;

  // Dish → meals needed that date, and the orders asking for them. A dish that
  // several flights' meals share is cooked once, as one run, exactly as the
  // kitchen would (its produced quantity is a day total).
  const need = new Map<string, number>();
  const serves = new Map<string, Set<string>>();
  for (const o of orders) {
    if (o.date !== date || (o.orderType ?? "flight") === "crew") continue;
    // One set per code — a code planned by two services is still one order of
    // meals, so counting both would cook the components twice over.
    for (const set of dedupeSetsByCode(specialMealSetsForLeg(o, cards))) {
      if (set.components.length === 0 || set.qty <= 0) continue;
      for (const c of set.components) {
        need.set(c.name, (need.get(c.name) ?? 0) + set.qty * perMealQty(c));
        const s = serves.get(c.name) ?? new Set<string>();
        s.add(o.orderNo);
        serves.set(c.name, s);
      }
    }
  }

  const out: DemoSpecialMealProduction = { entries: [], records: [], qc: [] };
  const stamp = date.replace(/-/g, "");
  // Sorted so the sequence number a dish gets is stable across runs.
  for (const [item, meals] of [...need.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const shortfall = meals - producedFor(item, date);
    if (shortfall <= 0) continue;

    const h = hash(`${item}|${date}`);
    const id = `PRO-${date.slice(0, 4)}-SM${stamp.slice(4)}${initials(item)}`;
    if (existingIds.has(id)) continue;
    const minTemp = 70;
    const measured = minTemp + 4 + (h % 7);            // 74-80°C — a comfortable pass
    const cookedBy = CHEFS[h % CHEFS.length];
    const checkedBy = CHECKERS[h % CHECKERS.length];
    const batchNo = `LOT-${stamp}-${initials(item)}`;
    const qcId = `CT-SM-${stamp}-${initials(item)}`;

    out.entries.push({
      id,
      date,
      bom: item,
      outputItemName: item,
      orderQty: shortfall,
      producedQty: shortfall,
      status: "Completed",
      servesOrderNos: [...(serves.get(item) ?? [])].sort(),
      qcLogId: qcId,
      qcPassedAt: `${date} 06:${String(10 + (h % 40)).padStart(2, "0")}`,
      qcCheckedBy: checkedBy,
      completedAt: `${date} 06:${String(10 + (h % 40)).padStart(2, "0")}`,
      inventoryAdded: true,
      batchNo,
      batchExpiry: addDays(date, 2),
      ...KITCHEN,
    });

    out.records.push({
      id: `PE-SM-${stamp}-${initials(item)}`,
      date: `${date} 05:${String(10 + (h % 40)).padStart(2, "0")}`,
      productionOrderId: id,
      bom: item,
      outputItemName: item,
      producedQty: shortfall,
      batchNo,
      batchExpiry: addDays(date, 2),
      shift: "Morning",
      producedBy: cookedBy,
      remarks: "Special-meal component",
      ...KITCHEN,
    });

    out.qc.push({
      id: qcId,
      batch: id,
      item,
      cookingTime: `${15 + (h % 30)} min`,
      standardTemp: `≥${minTemp}°C`,
      standardTempMin: minTemp,
      thresholdTemp: 95,
      measuredTemp: measured,
      cookedBy,
      checkedBy,
      taste: "Good",
      sensoryPass: true,
      date,
      checkedAt: `${date} 06:${String(10 + (h % 40)).padStart(2, "0")}`,
    });
  }
  return out;
}
