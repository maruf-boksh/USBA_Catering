import { useSyncExternalStore } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Batch-code numbering policy — global setting for batch-tracked items.
//
//   • "manual" — the receiver types the batch / LOT number (historical default).
//   • "auto"   — the system generates the batch / LOT number on receipt; the
//                receiver only supplies the expiry date.
//
// Applies to every batch-tracked item (batch tracking itself stays per-item in
// the Item Profile). Managed from Configuration → Item Profile. Stored under
// localStorage["harvest-batch-numbering-v1"].
// ─────────────────────────────────────────────────────────────────────────────

export type BatchNumberingMode = "manual" | "auto";

export const BATCH_NUMBERING_LABEL: Record<BatchNumberingMode, string> = {
  manual: "Manual entry",
  auto: "Auto-generate",
};

const STORAGE_KEY = "harvest-batch-numbering-v1";
const DEFAULT_MODE: BatchNumberingMode = "manual";

function isMode(v: unknown): v is BatchNumberingMode {
  return v === "manual" || v === "auto";
}

function load(): BatchNumberingMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isMode(raw) ? raw : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

let current: BatchNumberingMode = load();
const listeners = new Set<() => void>();

export function getBatchNumberingMode(): BatchNumberingMode {
  return current;
}

export function setBatchNumberingMode(mode: BatchNumberingMode) {
  current = isMode(mode) ? mode : DEFAULT_MODE;
  try {
    window.localStorage.setItem(STORAGE_KEY, current);
  } catch {
    // localStorage may be unavailable (private mode etc.) — fail silent.
  }
  for (const l of listeners) l();
}

export function subscribeBatchNumbering(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useBatchNumberingMode(): BatchNumberingMode {
  return useSyncExternalStore(
    (cb) => subscribeBatchNumbering(cb),
    getBatchNumberingMode,
    getBatchNumberingMode,
  );
}

/**
 * A system-generated batch / LOT code: `LOT-YYYYMMDD-XXX`. Date-stamped so the
 * code reads meaningfully, with a short random suffix for same-day uniqueness.
 * Uniqueness (not secrecy) is the goal, so a light random tail is enough.
 */
export function generateBatchCode(prefix = "LOT"): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const rand = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, "0");
  return `${prefix}-${date}-${rand}`;
}
