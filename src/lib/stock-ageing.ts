/**
 * stock-ageing.ts — Stock Ageing & Alerts logic (Inventory & Store)
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure, read-only derivation on top of the existing stock master. Every ageing
 * row is one *batch lot* held in the store, which is exactly the granularity the
 * rest of the system already works at:
 *
 *   • Stock Overview  — `batches[]` per inventory item (batch ladder, FIFO/FEFO)
 *   • Receive Items   — a GRN line creates a lot with `receivedOn` + `expiry`
 *   • Item Issue      — lots drain oldest-first (FIFO) or earliest-expiry (FEFO)
 *   • Stock Adjustment— an aged/expired lot is written off with reason
 *                       "Expiry Writeoff" / "Wastage"
 *
 * So ageing is measured from `receivedOn` (how long the lot has sat in store)
 * and shelf life from `expiry` (how long it may still be used). Nothing here
 * mutates stock — the module raises the alert; the write-off itself still runs
 * through Stock Adjustment as it does today.
 */

import { inventory, type InventoryItem } from "@/lib/sample-data";

// ── Thresholds (the "standard" ageing policy) ───────────────────────────────
export const AGEING_POLICY = {
  /** Ageing buckets, measured in days since the lot was received. */
  bucket1: 30,
  bucket2: 60,
  bucket3: 90,
  /** Shelf-life gates, measured in days until the lot expires. */
  expiryCritical: 7,
  expiryWarning: 30,
  /** Non-movement gates — a lot sitting longer than this is capital at risk. */
  slowMoving: 60,
  obsolete: 90,
} as const;

export type AgeBucket = "0-30 Days" | "31-60 Days" | "61-90 Days" | "90+ Days";

export const AGE_BUCKETS: AgeBucket[] = ["0-30 Days", "31-60 Days", "61-90 Days", "90+ Days"];

/**
 * Age-day filter bands. Finer than the report buckets above so long-held stock
 * can be split beyond the 90+ tail (`max: null` = open-ended).
 */
export const AGE_DAY_RANGES: { key: string; label: string; min: number; max: number | null }[] = [
  { key: "0-30",    label: "0-30 Days",    min: 0,   max: 30 },
  { key: "31-60",   label: "31-60 Days",   min: 31,  max: 60 },
  { key: "61-90",   label: "61-90 Days",   min: 61,  max: 90 },
  { key: "91-180",  label: "91-180 Days",  min: 91,  max: 180 },
  { key: "181-365", label: "181-365 Days", min: 181, max: 365 },
  { key: "365+",    label: "365+ Days",    min: 366, max: null },
];

export function inAgeRange(ageDays: number, key: string): boolean {
  const range = AGE_DAY_RANGES.find((r) => r.key === key);
  if (!range) return true;
  return ageDays >= range.min && (range.max === null || ageDays <= range.max);
}

export type AlertLevel =
  | "Expired"
  | "Critical"
  | "Near Expiry"
  | "Obsolete Risk"
  | "Slow Moving"
  | "Healthy";

/**
 * Alert workflow states. An alerting lot opens as "Open" and is cleared by
 * escalating it — expired stock for disposal, stock about to expire to supply
 * chain as a purchase requisition. Healthy lots carry "No Alert".
 */
export type AlertStatus = "Open" | "Escalated To Wastage" | "Escalated To PR" | "No Alert";

export const ALERT_STATUSES: AlertStatus[] = ["Open", "Escalated To Wastage", "Escalated To PR"];

/**
 * SLA breach state — is the alert being cleared inside its response window?
 *   Within SLA / Due Today — still open, still on time
 *   Breached               — open past its due date, or resolved after it
 *   Met                    — resolved (Action Taken / Closed) on or before due
 *   Not Applicable         — Healthy lot, no alert clock running
 */
export type SlaStatus = "Not Applicable" | "Within SLA" | "Due Today" | "Breached" | "Met";

/** Response window per alert level, in days from when the lot crossed into it. */
export const SLA_TARGET_DAYS: Record<AlertLevel, number | null> = {
  "Expired": 1,
  "Critical": 2,
  "Near Expiry": 7,
  "Obsolete Risk": 7,
  "Slow Moving": 14,
  "Healthy": null,
};

/** Statuses that stop the SLA clock — the alert has been acted on. */
const RESOLVED_STATUSES: AlertStatus[] = ["Escalated To Wastage", "Escalated To PR"];

// ── Per-item alert configuration ────────────────────────────────────────────
/** How the store is told about an alert. */
export type NotifyMethod = "In-App" | "Email" | "SMS" | "Daily Digest";

export const NOTIFY_METHODS: NotifyMethod[] = ["In-App", "Email", "SMS", "Daily Digest"];

export type ReminderFrequency = "Once" | "Daily" | "Every 2 Days" | "Weekly";

export const REMINDER_FREQUENCIES: ReminderFrequency[] = ["Once", "Daily", "Every 2 Days", "Weekly"];

/** Levels that can raise an alert (Healthy never does), in escalation order. */
export const ALERTABLE_LEVELS: Exclude<AlertLevel, "Healthy">[] = [
  "Expired", "Critical", "Near Expiry", "Obsolete Risk", "Slow Moving",
];

/**
 * Per-item override of the default policy. An item with no configuration falls
 * back to AGEING_POLICY + SLA_TARGET_DAYS, so behaviour is unchanged until a
 * storekeeper deliberately configures the item.
 */
export type ItemAlertConfig = {
  itemCode: string;
  itemName: string;
  /** When off, the item's lots still age but raise no alert and no SLA clock. */
  enabled: boolean;
  /** Shelf-life gates (days before expiry). */
  expiryCritical: number;
  expiryWarning: number;
  /** Non-movement gates (days since receipt). */
  slowMoving: number;
  obsolete: number;
  /** Response window in days per alert level. */
  sla: Record<Exclude<AlertLevel, "Healthy">, number>;
  methods: NotifyMethod[];
  reminder: ReminderFrequency;
  /** Staff member who owns the alert. */
  responsible: string;
  /** Who it escalates to when the SLA is breached. */
  escalateTo: string;
  /** Days past the due date before escalation fires. */
  escalateAfter: number;
  updatedBy: string;
  updatedAt: string;
};

export type AgeingThresholds = {
  expiryCritical: number;
  expiryWarning: number;
  slowMoving: number;
  obsolete: number;
};

export function defaultAlertConfig(itemCode: string, itemName: string): ItemAlertConfig {
  return {
    itemCode,
    itemName,
    enabled: true,
    expiryCritical: AGEING_POLICY.expiryCritical,
    expiryWarning: AGEING_POLICY.expiryWarning,
    slowMoving: AGEING_POLICY.slowMoving,
    obsolete: AGEING_POLICY.obsolete,
    sla: {
      "Expired": SLA_TARGET_DAYS.Expired ?? 1,
      "Critical": SLA_TARGET_DAYS.Critical ?? 2,
      "Near Expiry": SLA_TARGET_DAYS["Near Expiry"] ?? 7,
      "Obsolete Risk": SLA_TARGET_DAYS["Obsolete Risk"] ?? 7,
      "Slow Moving": SLA_TARGET_DAYS["Slow Moving"] ?? 14,
    },
    methods: ["In-App", "Email"],
    reminder: "Daily",
    responsible: "",
    escalateTo: "",
    escalateAfter: 2,
    updatedBy: "",
    updatedAt: "",
  };
}

/** The thresholds in force for an item — its own config, or the house policy. */
export function thresholdsFor(config?: ItemAlertConfig): AgeingThresholds {
  return {
    expiryCritical: config?.expiryCritical ?? AGEING_POLICY.expiryCritical,
    expiryWarning: config?.expiryWarning ?? AGEING_POLICY.expiryWarning,
    slowMoving: config?.slowMoving ?? AGEING_POLICY.slowMoving,
    obsolete: config?.obsolete ?? AGEING_POLICY.obsolete,
  };
}

/** The response window in force for a level on an item. */
export function slaTargetFor(level: AlertLevel, config?: ItemAlertConfig): number | null {
  if (level === "Healthy") return null;
  return config?.sla?.[level] ?? SLA_TARGET_DAYS[level];
}

/**
 * Validate a configuration before it is saved. Returns the list of problems in
 * plain language; an empty list means the configuration is sound.
 */
export function validateAlertConfig(c: ItemAlertConfig): string[] {
  const errors: string[] = [];
  const positive = (n: number) => Number.isFinite(n) && n >= 1;

  if (!c.itemCode) errors.push("Choose an item to configure.");
  if (!positive(c.expiryCritical)) errors.push("Critical shelf-life days must be at least 1.");
  if (!positive(c.expiryWarning)) errors.push("Near-expiry warning days must be at least 1.");
  if (positive(c.expiryCritical) && positive(c.expiryWarning) && c.expiryCritical >= c.expiryWarning) {
    errors.push("Critical days must be fewer than near-expiry warning days.");
  }
  if (!positive(c.slowMoving)) errors.push("Slow-moving days must be at least 1.");
  if (!positive(c.obsolete)) errors.push("Obsolete-risk days must be at least 1.");
  if (positive(c.slowMoving) && positive(c.obsolete) && c.slowMoving >= c.obsolete) {
    errors.push("Slow-moving days must be fewer than obsolete-risk days.");
  }
  for (const level of ALERTABLE_LEVELS) {
    const days = c.sla[level];
    if (!Number.isFinite(days) || days < 1 || days > 180) {
      errors.push(`SLA for "${level}" must be between 1 and 180 days.`);
    }
  }
  if (c.enabled && c.methods.length === 0) errors.push("Select at least one notification method.");
  if (c.enabled && !c.responsible) errors.push("Assign a responsible person.");
  if (c.escalateTo && c.escalateTo === c.responsible) {
    errors.push("Escalation contact must be different from the responsible person.");
  }
  if (!Number.isFinite(c.escalateAfter) || c.escalateAfter < 0 || c.escalateAfter > 60) {
    errors.push("Escalate-after days must be between 0 and 60.");
  }
  return errors;
}

export type AgeingRow = {
  /** Stable internal key (system rows are item+lot derived, manual rows stored). */
  id: string;
  /** Sequential display code AGE-0001… assigned over the full deterministic set. */
  alertNo: string;
  source: "System" | "Manual";
  itemCode: string;
  item: string;
  category: string;
  uom: string;
  batchNo: string;
  binLocation: string;
  officeId: string;
  warehouseId: string;
  storage: string;
  /** ISO date the lot entered the store — the ageing base date. */
  receivedOn: string;
  /** ISO expiry date, or "" for lots with no shelf life recorded. */
  expiry: string;
  qty: number;
  unitCost: number;
  stockValue: number;
  ageDays: number;
  bucket: AgeBucket;
  /** Days until expiry (negative = already expired); null when no expiry. */
  daysToExpiry: number | null;
  level: AlertLevel;
  action: string;
  /** ISO date the lot crossed into its alert level — the SLA clock start. */
  alertSince: string;
  /** Response window in days for this level; null when no alert is running. */
  slaTargetDays: number | null;
  /** ISO date the response is due by; "" when no alert is running. */
  slaDueDate: string;
  sla: SlaStatus;
  /** Days past due (positive) or days still remaining (negative). 0 = due today. */
  slaDelta: number;
  /** False when the item's alert configuration is switched off. */
  alertsEnabled: boolean;
  /** Notification channels configured for this item. */
  notifyMethods: NotifyMethod[];
  /** Staff member who owns alerts for this item (from its configuration). */
  responsible: string;
  /** Who a breach escalates to (from its configuration). */
  escalateTo: string;
  status: AlertStatus;
  assignedTo: string;
  remarks: string;
  updatedBy: string;
  updatedAt: string;
};

/** A lot logged by hand (non batch-tracked item, off-system holding, etc.). */
export type ManualAgeingEntry = {
  id: string;
  itemCode: string;
  item: string;
  category: string;
  uom: string;
  batchNo: string;
  binLocation: string;
  officeId: string;
  warehouseId: string;
  storage: string;
  receivedOn: string;
  expiry: string;
  qty: number;
  unitCost: number;
  assignedTo: string;
  remarks: string;
  status: AlertStatus;
  raisedBy: string;
  raisedOn: string;
};

/**
 * One entry in an alert's activity log — what was done to the lot, by whom and
 * when, with the document it produced. Shown in the alert's View dialog.
 */
export type AgeingLogEntry = {
  /** "YYYY-MM-DD HH:MM". */
  at: string;
  by: string;
  /** "Escalated To Wastage" | "Demand Raised" | "Disposal Report Raised" … */
  action: string;
  detail: string;
  /** Document raised by the action (WDD / DR id). */
  ref?: string;
};

/** Review action recorded against a row (system rows can't be edited in place). */
export type AgeingReview = {
  status: AlertStatus;
  assignedTo: string;
  remarks: string;
  updatedBy: string;
  updatedAt: string;
  /** WDD id when the lot has been escalated as an Expired Product Disposal. */
  wastageRef?: string;
  /** PR id when a replenishment purchase requisition has been raised for the lot. */
  prRef?: string;
};

// ── Date helpers ────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when the string is a usable ISO date (the store writes "—" for none). */
export function isDate(value: string | undefined | null): value is string {
  return !!value && ISO_DATE.test(value);
}

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `from` to `to` (both ISO). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** ISO date `days` after (or before, when negative) `iso`. */
export function addDays(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

// ── Ageing classification ───────────────────────────────────────────────────
export function bucketOf(ageDays: number): AgeBucket {
  if (ageDays <= AGEING_POLICY.bucket1) return "0-30 Days";
  if (ageDays <= AGEING_POLICY.bucket2) return "31-60 Days";
  if (ageDays <= AGEING_POLICY.bucket3) return "61-90 Days";
  return "90+ Days";
}

/**
 * Alert level = worst of the two risk dimensions. Shelf life always outranks
 * non-movement, because an expired lot is a food-safety event while a slow
 * moving lot is only a working-capital one.
 */
export function levelOf(
  ageDays: number,
  daysToExpiry: number | null,
  t: AgeingThresholds = AGEING_POLICY,
): AlertLevel {
  if (daysToExpiry !== null) {
    if (daysToExpiry < 0) return "Expired";
    if (daysToExpiry <= t.expiryCritical) return "Critical";
    if (daysToExpiry <= t.expiryWarning) return "Near Expiry";
  }
  if (ageDays > t.obsolete) return "Obsolete Risk";
  if (ageDays > t.slowMoving) return "Slow Moving";
  return "Healthy";
}

/**
 * The standing instruction for each level, written for the store floor — plain
 * language, no jargon, saying what to do and where to do it.
 */
export const ACTION_BY_LEVEL: Record<AlertLevel, string> = {
  "Expired":
    "This stock is past its expiry date and must not be used. Remove it from stock now — open Stock Adjustment, reduce the quantity and choose the reason \"Expiry Writeoff\".",
  "Critical":
    "Only a few days of shelf life are left. Use this batch before any newer batch of the same item, or it will be thrown away.",
  "Near Expiry":
    "This batch expires soon. Plan it into the next few days' menus so it gets used up in time.",
  "Obsolete Risk":
    "This batch has been sitting in store for a very long time. Check whether it is still needed — use it, move it to another store, or dispose of it.",
  "Slow Moving":
    "This batch is being used very slowly. Order less of this item next time so stock does not build up.",
  "Healthy":
    "Nothing to do. This batch is fresh and moving normally.",
};

/** Sort weight — worst risk first. */
export const LEVEL_RANK: Record<AlertLevel, number> = {
  "Expired": 0,
  "Critical": 1,
  "Near Expiry": 2,
  "Obsolete Risk": 3,
  "Slow Moving": 4,
  "Healthy": 5,
};

export function isAlert(level: AlertLevel): boolean {
  return level !== "Healthy";
}

// ── Stock master access (read-only) ─────────────────────────────────────────
/** Same key `usePersistedState("inventory-items")` writes from Stock Overview. */
const INVENTORY_KEY = "harvest-data-v1:inventory-items";

type StoredItem = InventoryItem & {
  officeId?: string;
  warehouseId?: string;
};

/**
 * The live stock master — persisted rows when Stock Overview has been opened,
 * otherwise the seed. Read-only: this module never writes the inventory store.
 */
export function readInventoryMaster(): StoredItem[] {
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

// ── SLA ─────────────────────────────────────────────────────────────────────
/**
 * The date this lot crossed into its alert level — where the SLA clock starts.
 * Shelf-life levels count back from expiry (Near Expiry began 30 days before
 * it, Critical 7 days before, Expired on the day itself); non-movement levels
 * count forward from receipt. Never earlier than the lot arrived in store.
 */
export function alertSinceOf(
  level: AlertLevel,
  receivedOn: string,
  expiry: string,
  t: AgeingThresholds = AGEING_POLICY,
): string {
  if (level === "Healthy" || !isDate(receivedOn)) return "";
  let since: string;
  if (level === "Expired" && isDate(expiry)) since = expiry;
  else if (level === "Critical" && isDate(expiry)) since = addDays(expiry, -t.expiryCritical);
  else if (level === "Near Expiry" && isDate(expiry)) since = addDays(expiry, -t.expiryWarning);
  else if (level === "Obsolete Risk") since = addDays(receivedOn, t.obsolete);
  else since = addDays(receivedOn, t.slowMoving);
  return since < receivedOn ? receivedOn : since;
}

/**
 * Breach state for one row. An alert that has been actioned or closed is judged
 * on when it was resolved; one still open is judged against today.
 */
export function slaStateOf(
  slaDueDate: string,
  status: AlertStatus,
  resolvedOn: string,
  today: string,
): { sla: SlaStatus; slaDelta: number } {
  if (!isDate(slaDueDate)) return { sla: "Not Applicable", slaDelta: 0 };
  if (RESOLVED_STATUSES.includes(status)) {
    const on = isDate(resolvedOn) ? resolvedOn : today;
    const delta = daysBetween(slaDueDate, on);
    return { sla: delta > 0 ? "Breached" : "Met", slaDelta: delta };
  }
  const delta = daysBetween(slaDueDate, today);
  if (delta > 0) return { sla: "Breached", slaDelta: delta };
  if (delta === 0) return { sla: "Due Today", slaDelta: 0 };
  return { sla: "Within SLA", slaDelta: delta };
}

// ── Row builders ────────────────────────────────────────────────────────────
function finish(
  base: Omit<
    AgeingRow,
    "alertNo" | "ageDays" | "bucket" | "daysToExpiry" | "level" | "action" | "stockValue"
      | "alertSince" | "slaTargetDays" | "slaDueDate" | "sla" | "slaDelta"
      | "alertsEnabled" | "notifyMethods" | "responsible" | "escalateTo"
  >,
  today: string,
  config?: ItemAlertConfig,
): Omit<AgeingRow, "alertNo"> {
  const t = thresholdsFor(config);
  const ageDays = isDate(base.receivedOn) ? Math.max(0, daysBetween(base.receivedOn, today)) : 0;
  const daysToExpiry = isDate(base.expiry) ? daysBetween(today, base.expiry) : null;
  const level = levelOf(ageDays, daysToExpiry, t);
  const alertSince = alertSinceOf(level, base.receivedOn, base.expiry, t);
  const slaTargetDays = slaTargetFor(level, config);
  const slaDueDate = isDate(alertSince) && slaTargetDays !== null ? addDays(alertSince, slaTargetDays) : "";
  return {
    ...base,
    alertsEnabled: config?.enabled ?? true,
    notifyMethods: config?.methods ?? [],
    responsible: config?.responsible ?? "",
    escalateTo: config?.escalateTo ?? "",
    alertSince,
    slaTargetDays,
    slaDueDate,
    // Placeholders — resolved in assembleAgeingRows once the workflow status
    // (and any recorded review date) is known.
    sla: "Not Applicable",
    slaDelta: 0,
    ageDays,
    bucket: bucketOf(ageDays),
    daysToExpiry,
    level,
    action: ACTION_BY_LEVEL[level],
    stockValue: base.qty * base.unitCost,
  };
}

/** One row per live batch lot across the stock master. */
export function buildSystemRows(
  items: StoredItem[],
  today: string,
  configs: Record<string, ItemAlertConfig> = {},
): Omit<AgeingRow, "alertNo">[] {
  const rows: Omit<AgeingRow, "alertNo">[] = [];
  for (const item of items) {
    for (const lot of item.batches ?? []) {
      if (!(lot.qty > 0)) continue;
      rows.push(
        finish(
          {
            id: `AGE-SYS-${item.id}-${lot.batchNo}`,
            source: "System",
            itemCode: item.id,
            item: item.name,
            category: item.category,
            uom: item.uom,
            batchNo: lot.batchNo,
            binLocation: lot.binLocation ?? "—",
            officeId: item.officeId ?? "OFF-001",
            warehouseId: item.warehouseId ?? "WH-001",
            storage: item.storage,
            receivedOn: lot.receivedOn,
            expiry: isDate(lot.expiry) ? lot.expiry : "",
            qty: lot.qty,
            unitCost: lot.costPrice,
            status: "No Alert",
            assignedTo: "",
            remarks: "",
            updatedBy: "",
            updatedAt: "",
          },
          today,
          configs[item.id],
        ),
      );
    }
  }
  return rows;
}

/** Manually logged lots, classified with the same policy as system rows. */
export function buildManualRows(
  entries: ManualAgeingEntry[],
  today: string,
  configs: Record<string, ItemAlertConfig> = {},
): Omit<AgeingRow, "alertNo">[] {
  return entries.map((e) =>
    finish(
      {
        id: e.id,
        source: "Manual",
        itemCode: e.itemCode,
        item: e.item,
        category: e.category,
        uom: e.uom,
        batchNo: e.batchNo,
        binLocation: e.binLocation || "—",
        officeId: e.officeId,
        warehouseId: e.warehouseId,
        storage: e.storage,
        receivedOn: e.receivedOn,
        expiry: isDate(e.expiry) ? e.expiry : "",
        qty: e.qty,
        unitCost: e.unitCost,
        status: e.status,
        assignedTo: e.assignedTo,
        remarks: e.remarks,
        updatedBy: e.raisedBy,
        updatedAt: e.raisedOn,
      },
      today,
      configs[e.itemCode],
    ),
  );
}

/**
 * Map a stored status onto the current workflow. A review carrying a wastage
 * reference is always "Escalated To Wastage"; anything else unrecognised (a
 * value persisted by an earlier revision of this module) falls back to the
 * row's natural state.
 */
function normalizeStatus(
  status: string,
  escalated: boolean,
  alerting: boolean,
  requisitioned = false,
): AlertStatus {
  // Disposal is terminal, so it outranks a replacement purchase.
  if (escalated) return "Escalated To Wastage";
  if (requisitioned) return "Escalated To PR";
  if (status === "Open" || status === "Escalated To Wastage" || status === "Escalated To PR" || status === "No Alert") {
    return status;
  }
  return alerting ? "Open" : "No Alert";
}

/**
 * Merge system + manual rows, apply recorded reviews, then sort worst-risk
 * first and stamp a stable sequential alert number.
 *
 * Default status: an alerting lot starts "Open"; a healthy lot carries
 * "No Alert" until it ages into one.
 */
export function assembleAgeingRows(
  systemRows: Omit<AgeingRow, "alertNo">[],
  manualRows: Omit<AgeingRow, "alertNo">[],
  reviews: Record<string, AgeingReview>,
  today: string = todayIso(),
): AgeingRow[] {
  const merged = [...systemRows, ...manualRows].map((r) => {
    const review = reviews[r.id];
    // Alerts switched off for the item: the lot still ages and reports, but it
    // raises nothing and no SLA clock runs against it.
    const fallback: AlertStatus = isAlert(r.level) && r.alertsEnabled ? "Open" : "No Alert";
    const status = normalizeStatus(
      review?.status ?? (r.source === "Manual" ? r.status : fallback),
      !!review?.wastageRef,
      isAlert(r.level) && r.alertsEnabled,
      !!review?.prRef,
    );
    // The review date is when the row was actioned/closed, so it stops the clock.
    const resolvedOn = review?.updatedAt ?? r.updatedAt;
    const slaState = r.alertsEnabled
      ? slaStateOf(r.slaDueDate, status, resolvedOn, today)
      : { sla: "Not Applicable" as SlaStatus, slaDelta: 0 };
    return {
      ...r,
      status,
      ...slaState,
      // Unreviewed alerts sit with the person configured to own the item.
      assignedTo: review?.assignedTo || r.assignedTo || r.responsible,
      remarks: review?.remarks || r.remarks,
      updatedBy: review?.updatedBy ?? r.updatedBy,
      updatedAt: review?.updatedAt ?? r.updatedAt,
    };
  });

  merged.sort((a, b) => {
    const rank = LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
    if (rank !== 0) return rank;
    if (a.ageDays !== b.ageDays) return b.ageDays - a.ageDays;
    return a.id.localeCompare(b.id);
  });

  return merged.map((r, i) => ({ ...r, alertNo: `AGE-${String(i + 1).padStart(4, "0")}` }));
}
