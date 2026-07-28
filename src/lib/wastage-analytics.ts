/**
 * Wastage Analytics — derivation + configuration for the Wastage Management
 * analytics dashboard.
 *
 * This module is strictly READ-ONLY against the wastage store: it reads the
 * `wastage-entries` records that Damaged Product Disposal owns and turns each
 * one into an analytics row (age since reporting, disposal-deadline state,
 * costed value). It never writes that store, so the disposal / approval flow is
 * completely untouched by anything on the analytics page.
 *
 * The only thing this module owns is the *analytics configuration* — the
 * wastage disposal deadline and the ageing-bucket size — plus the change log
 * behind it. Those live under their own localStorage keys.
 *
 * Naming note: everywhere the industry term is "scrap", this system says
 * "wastage". The labels here follow the system, not the industry.
 */

import { useSyncExternalStore } from "react";
import { inventory, type InventoryItem } from "@/lib/sample-data";
import type { WastageEntry, WastageStatus, WastageType } from "@/routes/wastage-management";

// ── Configuration ───────────────────────────────────────────────────────────

export type WastageConfig = {
  /** Days a wastage report may sit un-disposed before it counts as overdue. */
  disposalDeadlineDays: number;
  /** Width (in days) of each ageing bucket on the dashboard — 7 ⇒ 1-7, 8-14, … */
  ageingBucketDays: number;
  /** Reports valued at or above this (৳) are flagged as high-value wastage. */
  highValueThreshold: number;
};

export const DEFAULT_WASTAGE_CONFIG: WastageConfig = {
  disposalDeadlineDays: 3,
  ageingBucketDays: 7,
  highValueThreshold: 5000,
};

/** Field labels used by the configuration form and its change log. */
export const CONFIG_FIELD_LABELS: Record<keyof WastageConfig, string> = {
  disposalDeadlineDays: "Wastage Disposal Deadline (In Days)",
  ageingBucketDays: "Ageing Bucket Size (In Days)",
  highValueThreshold: "High-Value Wastage Threshold (৳)",
};

/** Allowed range per field — enforced by the form and by `validateConfig`. */
const CONFIG_BOUNDS: Record<keyof WastageConfig, { min: number; max: number }> = {
  disposalDeadlineDays: { min: 1, max: 90 },
  ageingBucketDays: { min: 1, max: 30 },
  highValueThreshold: { min: 0, max: 10_000_000 },
};

/** Plain-language validation errors — empty array means the config is good. */
export function validateConfig(c: WastageConfig): string[] {
  const errs: string[] = [];
  (Object.keys(CONFIG_BOUNDS) as (keyof WastageConfig)[]).forEach((k) => {
    const v = c[k];
    const { min, max } = CONFIG_BOUNDS[k];
    if (!Number.isFinite(v)) errs.push(`${CONFIG_FIELD_LABELS[k]} must be a number.`);
    else if (v < min || v > max) {
      errs.push(`${CONFIG_FIELD_LABELS[k]} must be between ${min} and ${max}.`);
    }
  });
  return errs;
}

export type WastageConfigLogEntry = {
  at: string;
  by: string;
  field: string;
  from: string;
  to: string;
  reason: string;
};

const CONFIG_KEY = "harvest-wastage-config-v1";
const CONFIG_LOG_KEY = "harvest-wastage-config-log-v1";

function loadConfig(): WastageConfig {
  if (typeof window === "undefined") return DEFAULT_WASTAGE_CONFIG;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_WASTAGE_CONFIG;
    const parsed = JSON.parse(raw) as Partial<WastageConfig>;
    if (!parsed || typeof parsed !== "object") return DEFAULT_WASTAGE_CONFIG;
    // Merge over defaults so a partial / older saved object never loses fields.
    return { ...DEFAULT_WASTAGE_CONFIG, ...parsed };
  } catch {
    return DEFAULT_WASTAGE_CONFIG;
  }
}

function loadLog(): WastageConfigLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CONFIG_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WastageConfigLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable (private mode / quota) — fail silent.
  }
}

let currentConfig: WastageConfig = loadConfig();
let currentLog: WastageConfigLogEntry[] = loadLog();
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export function getWastageConfig(): WastageConfig { return currentConfig; }
export function getWastageConfigLog(): WastageConfigLogEntry[] { return currentLog; }

/**
 * Apply a configuration change and record one log row per field that actually
 * moved. Fields whose value is unchanged are not logged, so the log stays a
 * true history of edits rather than a list of saves.
 */
export function setWastageConfig(next: WastageConfig, by: string, reason: string): void {
  const prev = currentConfig;
  const at = stamp();
  const changes: WastageConfigLogEntry[] = [];
  (Object.keys(CONFIG_FIELD_LABELS) as (keyof WastageConfig)[]).forEach((k) => {
    if (prev[k] === next[k]) return;
    changes.push({
      at, by,
      field: CONFIG_FIELD_LABELS[k],
      from: String(prev[k]),
      to: String(next[k]),
      reason: reason.trim() || "—",
    });
  });
  currentConfig = { ...next };
  persist(CONFIG_KEY, currentConfig);
  if (changes.length > 0) {
    currentLog = [...changes, ...currentLog];
    persist(CONFIG_LOG_KEY, currentLog);
  }
  notify();
}

export function useWastageConfig(): WastageConfig {
  return useSyncExternalStore(subscribe, getWastageConfig, getWastageConfig);
}

export function useWastageConfigLog(): WastageConfigLogEntry[] {
  return useSyncExternalStore(subscribe, getWastageConfigLog, getWastageConfigLog);
}

// ── Date helpers ────────────────────────────────────────────────────────────

export function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function stamp(): string {
  const n = new Date();
  return `${todayIso()} ${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
}

const DAY_MS = 86_400_000;

export const isDate = (s: string | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Whole days between two yyyy-mm-dd dates (b − a). Zero when either is unusable. */
function daysBetween(a: string, b: string): number {
  if (!isDate(a) || !isDate(b)) return 0;
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

function addDays(date: string, n: number): string {
  if (!isDate(date)) return "";
  const d = new Date(Date.parse(date) + n * DAY_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Ageing buckets ──────────────────────────────────────────────────────────

export type AgeBucketDef = { key: string; label: string; min: number; max: number | null };

/**
 * Four fixed-width buckets plus an overflow bucket, e.g. at size 7:
 * 1-7 / 8-14 / 15-21 / 22-28 / 28+ Days. The overflow bucket exists so a report
 * that ages past the last band is still counted somewhere.
 */
export function ageBuckets(size: number): AgeBucketDef[] {
  const w = Math.max(1, Math.round(size));
  const out: AgeBucketDef[] = [];
  for (let i = 0; i < 4; i++) {
    const min = i * w + 1;
    const max = (i + 1) * w;
    out.push({ key: `${min}-${max}`, label: `${min} to ${max} Days`, min, max });
  }
  const last = 4 * w;
  out.push({ key: `${last}+`, label: `${last}+ Days`, min: last + 1, max: null });
  return out;
}

function bucketFor(ageDays: number, buckets: AgeBucketDef[]): string {
  const b = buckets.find((x) => ageDays >= x.min && (x.max === null || ageDays <= x.max));
  return b?.key ?? "";
}

// ── Status / type labels ────────────────────────────────────────────────────

/**
 * Display labels, mirroring Damaged Product Disposal. Kept local (rather than
 * imported) so the analytics page needs no change to the disposal module.
 */
export const TYPE_LABELS: Record<WastageType, string> = {
  "Production": "Production Wastage",
  "Airport Store": "Galley Return Wastage",
  "Return Item": "Return Item",
  "Transfer": "Transfer Wastage",
  "Expired Product": "Expired Product Disposal",
};

export const STATUS_LABELS: Record<WastageStatus, string> = {
  "Pending In-Charge": "Pending In-Charge",
  "Pending GM": "Pending GM",
  "Pending Final": "Pending Final Authority",
  "Final Approved": "Final Approved",
  "Rejected": "Rejected",
};

export const WASTAGE_TYPES: WastageType[] = [
  "Production", "Airport Store", "Transfer", "Return Item", "Expired Product",
];

export const WASTAGE_STATUSES: WastageStatus[] = [
  "Pending In-Charge", "Pending GM", "Pending Final", "Final Approved", "Rejected",
];

/** A report is "in the disposal queue" until it is finally approved or rejected. */
export const isPendingStatus = (s: WastageStatus): boolean =>
  s === "Pending In-Charge" || s === "Pending GM" || s === "Pending Final";

// ── Deadline state ──────────────────────────────────────────────────────────

export type DeadlineStatus = "Within Deadline" | "Due Today" | "Overdue" | "Closed";

export const DEADLINE_STATUSES: DeadlineStatus[] = [
  "Within Deadline", "Due Today", "Overdue", "Closed",
];

// ── Costing ─────────────────────────────────────────────────────────────────

const INVENTORY_KEY = "harvest-data-v1:inventory-items";

type StoredItem = InventoryItem & { officeId?: string; warehouseId?: string };

/** The live stock master — persisted rows if present, otherwise the seed. */
function readInventoryMaster(): StoredItem[] {
  try {
    const raw = window.localStorage.getItem(INVENTORY_KEY);
    if (raw != null) {
      const parsed = JSON.parse(raw) as StoredItem[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* unavailable / corrupt — fall through to the seed */
  }
  return inventory as StoredItem[];
}

/**
 * Weighted-average unit cost per item, keyed by both item code and lower-cased
 * item name so a wastage report matches whichever identifier it carries.
 * Items with no batch cost resolve to 0 — the row then shows an un-costed value
 * rather than a wrong one.
 */
export function buildUnitCostMap(): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of readInventoryMaster()) {
    const lots = item.batches ?? [];
    const qty = lots.reduce((s, b) => s + b.qty, 0);
    const cost = qty > 0
      ? lots.reduce((s, b) => s + b.qty * b.costPrice, 0) / qty
      : (lots[0]?.costPrice ?? 0);
    if (!(cost > 0)) continue;
    map.set(item.id, cost);
    map.set(item.name.toLowerCase(), cost);
  }
  return map;
}

// ── Wastage entries (read-only) ─────────────────────────────────────────────

const WASTAGE_KEY = "harvest-data-v1:wastage-entries";

/**
 * Read the disposal reports written by Damaged Product Disposal. Deliberately a
 * direct localStorage read rather than `usePersistedState` so the analytics page
 * can never write back to the store it is reporting on.
 */
export function readWastageEntries(): WastageEntry[] {
  try {
    const raw = window.localStorage.getItem(WASTAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WastageEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Rows ────────────────────────────────────────────────────────────────────

export type WastageAnalyticsRow = {
  id: string;
  reportingDate: string;
  wastageType: WastageType;
  typeLabel: string;
  itemName: string;
  batchCode: string;
  qty: number;
  uom: string;
  unitCost: number;
  /** Disposal quantity valued at store cost. 0 when the item has no cost basis. */
  value: number;
  /** Value recovered by selling the damaged stock, when the method was "Sell". */
  recovered: number;
  /** Compensation charged to the responsible person(s), if any. */
  penalty: number;
  reason: string;
  method: string;
  section: string;
  preparedBy: string;
  officeId?: string;
  warehouseId?: string;
  status: WastageStatus;
  statusLabel: string;
  pending: boolean;
  /** Days since the report was raised. */
  ageDays: number;
  /** Ageing bucket key — pending reports only; "" once the report is closed. */
  bucket: string;
  /** Date the disposal was due by (reporting date + configured deadline). */
  dueDate: string;
  deadline: DeadlineStatus;
  /** Days past the deadline; 0 unless `deadline` is "Overdue". */
  overdueBy: number;
  highValue: boolean;
};

/**
 * Turn every stored disposal report into an analytics row. Age counts from the
 * reporting date; the deadline clock stops once the report reaches a terminal
 * status (Final Approved / Rejected), which is what "Closed" means here.
 */
export function buildAnalyticsRows(
  entries: WastageEntry[],
  config: WastageConfig,
  costs: Map<string, number>,
  today: string = todayIso(),
): WastageAnalyticsRow[] {
  const buckets = ageBuckets(config.ageingBucketDays);

  return entries.map((e) => {
    const pending = isPendingStatus(e.status);
    const ageDays = Math.max(0, daysBetween(e.reportingDate, today));
    const dueDate = addDays(e.reportingDate, config.disposalDeadlineDays);
    const pastDue = isDate(dueDate) ? daysBetween(dueDate, today) : 0;

    const deadline: DeadlineStatus = !pending
      ? "Closed"
      : pastDue > 0 ? "Overdue"
      : pastDue === 0 ? "Due Today"
      : "Within Deadline";

    const key = (e.stockItemName ?? e.itemName ?? "").toLowerCase();
    const unitCost = costs.get(key) ?? 0;
    const qty = Number(e.disposalQty) || 0;
    const value = qty * unitCost;

    return {
      id: e.id,
      reportingDate: e.reportingDate,
      wastageType: e.wastageType,
      typeLabel: TYPE_LABELS[e.wastageType] ?? e.wastageType,
      itemName: e.itemName,
      batchCode: e.batchCode || "—",
      qty,
      uom: e.disposalQtyUnit || "Units",
      unitCost,
      value,
      recovered: e.saleDetails?.totalValue ?? 0,
      penalty: (e.responsiblePersons ?? []).reduce((s, p) => s + (Number(p.penaltyAmount) || 0), 0),
      reason: e.disposalReason || "—",
      method: e.disposalMethod || "—",
      section: (e.responsiblePersons ?? []).find((p) => p.section)?.section || "—",
      preparedBy: e.preparedBy,
      officeId: e.officeId,
      warehouseId: e.warehouseId,
      status: e.status,
      statusLabel: STATUS_LABELS[e.status] ?? e.status,
      pending,
      ageDays,
      bucket: pending ? bucketFor(ageDays, buckets) : "",
      dueDate,
      deadline,
      overdueBy: deadline === "Overdue" ? pastDue : 0,
      highValue: value >= config.highValueThreshold && config.highValueThreshold > 0,
    };
  });
}

// ── KPIs ────────────────────────────────────────────────────────────────────

export type WastageKpis = {
  /** Every report on record. */
  total: number;
  totalQty: number;
  totalValue: number;
  /** Distinct items and sections the wastage came from. */
  items: number;
  sections: number;
  /** Reports finally approved — i.e. handed over and disposed. */
  disposed: number;
  disposedQty: number;
  /** Still in the approval queue. */
  pending: number;
  pendingQty: number;
  pendingValue: number;
  byStage: { label: string; count: number }[];
  /** Awaiting the final authority — the "admin handover" stage. */
  adminHandover: number;
  rejected: number;
  /** Pending reports past their disposal deadline. */
  overdue: number;
  overdueItems: number;
  overdueQty: number;
  overdueValue: number;
  /** Age of the oldest report still pending. */
  oldestAge: number;
  /** Pending-report ageing bands: reports and distinct items per band. */
  buckets: { key: string; label: string; reports: number; items: number }[];
  recovered: number;
  penalty: number;
  highValue: number;
};

export function computeKpis(
  rows: WastageAnalyticsRow[],
  config: WastageConfig,
): WastageKpis {
  const pendingRows = rows.filter((r) => r.pending);
  const overdueRows = pendingRows.filter((r) => r.deadline === "Overdue");
  const distinct = (rs: WastageAnalyticsRow[], pick: (r: WastageAnalyticsRow) => string) =>
    new Set(rs.map(pick).filter((v) => v && v !== "—")).size;

  const stage = (s: WastageStatus) => rows.filter((r) => r.status === s).length;

  return {
    total: rows.length,
    totalQty: rows.reduce((s, r) => s + r.qty, 0),
    totalValue: rows.reduce((s, r) => s + r.value, 0),
    items: distinct(rows, (r) => r.itemName),
    sections: distinct(rows, (r) => r.section),
    disposed: stage("Final Approved"),
    disposedQty: rows.filter((r) => r.status === "Final Approved").reduce((s, r) => s + r.qty, 0),
    pending: pendingRows.length,
    pendingQty: pendingRows.reduce((s, r) => s + r.qty, 0),
    pendingValue: pendingRows.reduce((s, r) => s + r.value, 0),
    byStage: [
      { label: "Pending In-Charge", count: stage("Pending In-Charge") },
      { label: "Pending GM", count: stage("Pending GM") },
      { label: "Pending Final Authority", count: stage("Pending Final") },
    ],
    adminHandover: stage("Pending Final"),
    rejected: stage("Rejected"),
    overdue: overdueRows.length,
    overdueItems: distinct(overdueRows, (r) => r.itemName),
    overdueQty: overdueRows.reduce((s, r) => s + r.qty, 0),
    overdueValue: overdueRows.reduce((s, r) => s + r.value, 0),
    oldestAge: pendingRows.reduce((m, r) => (r.ageDays > m ? r.ageDays : m), 0),
    buckets: ageBuckets(config.ageingBucketDays).map((b) => {
      const inBand = pendingRows.filter((r) => r.bucket === b.key);
      return {
        key: b.key,
        label: b.label,
        reports: inBand.length,
        items: distinct(inBand, (r) => r.itemName),
      };
    }),
    recovered: rows.reduce((s, r) => s + r.recovered, 0),
    penalty: rows.reduce((s, r) => s + r.penalty, 0),
    highValue: rows.filter((r) => r.highValue).length,
  };
}
