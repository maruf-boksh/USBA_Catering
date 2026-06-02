import { useSyncExternalStore } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Meal-slot configuration — single source of truth.
// Stored under localStorage["harvest-meal-slots-v1"]. Seeded with the four
// historical defaults (Breakfast / Heavy Snacks / Lunch / Dinner) on first
// load; everything is editable and deletable from the Configuration → Meal
// Slots page.
// ─────────────────────────────────────────────────────────────────────────────

export type MealSlotConfig = {
  /** Display name shown in headers and dropdowns. Must be unique. */
  name: string;
  /** Hour-of-day window start (0-24, inclusive). */
  from: number;
  /** Hour-of-day window end (0-24, exclusive — except when to=24 meaning midnight). */
  to: number;
};

export const DEFAULT_MEAL_SLOTS: MealSlotConfig[] = [
  { name: "Breakfast",    from: 6,  to: 11 },
  { name: "Heavy Snacks", from: 11, to: 15 },
  { name: "Lunch",        from: 15, to: 19 },
  { name: "Dinner",       from: 19, to: 24 },
];

const STORAGE_KEY = "harvest-meal-slots-v1";

function load(): MealSlotConfig[] {
  if (typeof window === "undefined") return DEFAULT_MEAL_SLOTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MEAL_SLOTS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_MEAL_SLOTS;
    const valid = parsed.filter(
      (s): s is MealSlotConfig =>
        !!s && typeof s === "object" &&
        typeof (s as MealSlotConfig).name === "string" &&
        typeof (s as MealSlotConfig).from === "number" &&
        typeof (s as MealSlotConfig).to === "number",
    );
    return valid.length > 0 ? valid : DEFAULT_MEAL_SLOTS;
  } catch {
    return DEFAULT_MEAL_SLOTS;
  }
}

function persist(slots: MealSlotConfig[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // localStorage may be unavailable (Safari private mode etc.) — fail silent.
  }
}

let current: MealSlotConfig[] = load();
const listeners = new Set<() => void>();

export function getMealSlots(): MealSlotConfig[] {
  return current;
}

export function setMealSlots(next: MealSlotConfig[]) {
  // Sort by start hour so display order matches the day. Slots that share a
  // start hour fall back to alphabetical name order for stability.
  current = [...next].sort((a, b) => a.from - b.from || a.name.localeCompare(b.name));
  persist(current);
  for (const l of listeners) l();
}

export function subscribeMealSlots(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useMealSlots(): MealSlotConfig[] {
  return useSyncExternalStore(
    (cb) => subscribeMealSlots(cb),
    getMealSlots,
    getMealSlots,
  );
}

/**
 * Pure function — resolves a given ETD string ("HH:MM") to the slot whose
 * [from, to) window contains it. Falls back to the first slot if no match
 * (defensive: ensures the UI never crashes on a malformed ETD).
 */
export function resolveMealSlot(etd: string, slots: MealSlotConfig[] = current): MealSlotConfig {
  const m = etd.match(/^(\d{1,2}):/);
  const h = m ? Number(m[1]) : 0;
  return slots.find((s) => h >= s.from && h < s.to) ?? slots[0] ?? DEFAULT_MEAL_SLOTS[0];
}

/**
 * Human-friendly range string: "06:00 - 11:00". Used by the meal-slot
 * section headers on the Crew Meals tab.
 */
export function formatSlotRange(s: MealSlotConfig): string {
  const fmt = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  return `${fmt(s.from)} - ${fmt(s.to)}`;
}
