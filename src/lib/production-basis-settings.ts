import { useSyncExternalStore } from "react";
import { roundQty } from "@/lib/num";

// ─────────────────────────────────────────────────────────────────────────────
// Production-quantity basis — single source of truth.
//
// When meal-plan items become Production Orders, the quantity ordered can be
// sized two ways:
//   • "required"  — produce the full required quantity (the demand), ignoring
//                   any finished-good stock already on hand. (Historical default.)
//   • "shortfall" — produce only what's missing: max(0, required − currentStock).
//
// There is ONE app-wide default, plus optional PER-ITEM overrides keyed by item
// name (case-insensitive). The Create Production Orders review dialog resolves
// the effective basis per item and can also tweak it per run.
//
// Stored under localStorage["harvest-production-basis-v1"]. Managed from the
// Configuration → Production Basis page.
// ─────────────────────────────────────────────────────────────────────────────

export type ProductionBasis = "required" | "shortfall";

export const PRODUCTION_BASIS_LABEL: Record<ProductionBasis, string> = {
  required: "Required Qty",
  shortfall: "Shortfall Qty",
};

export type ProductionBasisSettings = {
  /** App-wide default applied to any item without an explicit override. */
  default: ProductionBasis;
  /** Per-item overrides, keyed by LOWERCASED item name. */
  overrides: Record<string, ProductionBasis>;
};

export const DEFAULT_PRODUCTION_BASIS_SETTINGS: ProductionBasisSettings = {
  default: "required",
  overrides: {},
};

const STORAGE_KEY = "harvest-production-basis-v1";

function isBasis(v: unknown): v is ProductionBasis {
  return v === "required" || v === "shortfall";
}

function load(): ProductionBasisSettings {
  if (typeof window === "undefined") return DEFAULT_PRODUCTION_BASIS_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRODUCTION_BASIS_SETTINGS;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return DEFAULT_PRODUCTION_BASIS_SETTINGS;
    const obj = parsed as Partial<ProductionBasisSettings>;
    const def = isBasis(obj.default) ? obj.default : "required";
    const overrides: Record<string, ProductionBasis> = {};
    if (obj.overrides && typeof obj.overrides === "object") {
      for (const [k, v] of Object.entries(obj.overrides)) {
        if (isBasis(v)) overrides[k.toLowerCase()] = v;
      }
    }
    return { default: def, overrides };
  } catch {
    return DEFAULT_PRODUCTION_BASIS_SETTINGS;
  }
}

function persist(settings: ProductionBasisSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable (Safari private mode etc.) — fail silent.
  }
}

let current: ProductionBasisSettings = load();
const listeners = new Set<() => void>();

export function getProductionBasisSettings(): ProductionBasisSettings {
  return current;
}

export function setProductionBasisSettings(next: ProductionBasisSettings) {
  current = {
    default: isBasis(next.default) ? next.default : "required",
    overrides: { ...next.overrides },
  };
  persist(current);
  for (const l of listeners) l();
}

/** Set the app-wide default basis. */
export function setDefaultProductionBasis(basis: ProductionBasis) {
  setProductionBasisSettings({ ...current, default: basis });
}

/**
 * Set (or clear) a per-item override. Passing `null` removes the override so the
 * item falls back to the app-wide default.
 */
export function setProductionItemOverride(itemName: string, basis: ProductionBasis | null) {
  const key = itemName.trim().toLowerCase();
  if (!key) return;
  const overrides = { ...current.overrides };
  if (basis === null) delete overrides[key];
  else overrides[key] = basis;
  setProductionBasisSettings({ ...current, overrides });
}

export function subscribeProductionBasis(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useProductionBasisSettings(): ProductionBasisSettings {
  return useSyncExternalStore(
    (cb) => subscribeProductionBasis(cb),
    getProductionBasisSettings,
    getProductionBasisSettings,
  );
}

/** The effective basis for an item: its override if any, else the default. */
export function effectiveBasis(
  settings: ProductionBasisSettings,
  itemName: string,
): ProductionBasis {
  return settings.overrides[itemName.trim().toLowerCase()] ?? settings.default;
}

/** True when the item carries an explicit per-item override. */
export function hasItemOverride(settings: ProductionBasisSettings, itemName: string): boolean {
  return itemName.trim().toLowerCase() in settings.overrides;
}

/**
 * The quantity to actually produce, given the required qty and current stock.
 * Pure — used by both the review dialog and the bulk-create flow.
 */
export function productionQtyForBasis(
  basis: ProductionBasis,
  requiredQty: number,
  currentStock: number,
): number {
  return basis === "shortfall" ? roundQty(Math.max(0, requiredQty - currentStock)) : requiredQty;
}
