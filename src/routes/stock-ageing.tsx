/**
 * Stock Ageing & Alerts — Inventory & Store
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads the live stock master (the same `inventory-items` store Stock Overview
 * writes) and turns every batch lot into an ageing record: how long it has sat
 * in store since `receivedOn`, how much shelf life is left before `expiry`, and
 * what the store is expected to do about it.
 *
 * The page is read-only against stock. Raising an alert never moves quantity —
 * an expiry write-off still goes through Stock Adjustment exactly as today. Only
 * the alert review trail and manually logged lots are persisted here.
 */

import { useMemo, useState, type ReactNode } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Plus, Hourglass, TimerReset, CalendarClock, BellRing, Eye, Trash2,
  Search, CalendarDays, AlertTriangle, SlidersHorizontal, Send, History,
} from "lucide-react";
import { Select as AntSelect, Button as AntButton } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { toast } from "sonner";
import { LocationPicker, LocationCell, officeName, warehouseName } from "@/components/common/LocationPicker";
import { getActiveStaff } from "@/lib/staff";
import { useRole } from "@/lib/roles";
import { useNavigate } from "react-router-dom";
import { flagArrival } from "@/lib/arrival-flash";
import {
  EXPIRED_QUEUE_KEY, lotForAlert, queueCounts,
  type ExpiredDisposalLot,
} from "@/lib/expired-disposal";
import {
  AGEING_POLICY, AGE_BUCKETS, AGE_DAY_RANGES, ALERTABLE_LEVELS, ACTION_BY_LEVEL,
  NOTIFY_METHODS, REMINDER_FREQUENCIES,
  addDays, alertSinceOf, assembleAgeingRows, buildManualRows, buildSystemRows, bucketOf, daysBetween,
  defaultAlertConfig, inAgeRange, isAlert, isDate, levelOf, readInventoryMaster, slaStateOf,
  slaTargetFor, thresholdsFor, todayIso, validateAlertConfig,
  type AgeingLogEntry, type AgeingReview, type AgeingRow, type AlertLevel, type AlertStatus,
  type ItemAlertConfig, type ManualAgeingEntry, type NotifyMethod, type ReminderFrequency,
  type SlaStatus,
} from "@/lib/stock-ageing";
import { addPurchaseRequisition, type PRLineItem } from "@/lib/purchase-requisitions";

// ── Badges ──────────────────────────────────────────────────────────────────
const LEVEL_STYLE: Record<AlertLevel, string> = {
  "Expired":       "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
  "Critical":      "bg-[#FFF1F2] text-[#E11D48] border-[#FECDD3]",
  "Near Expiry":   "bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]",
  "Obsolete Risk": "bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]",
  "Slow Moving":   "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
  "Healthy":       "bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]",
};

const STATUS_STYLE: Record<AlertStatus, string> = {
  "Open":                 "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
  "Escalated To Wastage": "bg-[#F0FDFA] text-[#0F766E] border-[#99F6E4]",
  "Escalated To PR":      "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
  "No Alert":             "bg-[#F8FAFC] text-[#64748B] border-[#E2E8F0]",
};

/** Alert Level filter — the shelf-life severities that need acting on. */
const LEVEL_FILTERS: AlertLevel[] = ["Expired", "Critical", "Near Expiry", "Obsolete Risk", "Healthy"];

/**
 * Bulk action per Alert Level. Row ticking is only offered once one of these
 * levels is filtered, so the action on the selection is never ambiguous:
 * expired stock is disposed of, stock about to expire is re-ordered.
 */
const BULK_ACTION_BY_LEVEL: Record<string, { label: string; kind: "wastage" | "pr" }> = {
  "Expired":     { label: "Escalate To Wastage",              kind: "wastage" },
  "Critical":    { label: "Escalate To Purchase Requisition", kind: "pr"      },
  "Near Expiry": { label: "Escalate To Purchase Requisition", kind: "pr"      },
};

/** Status filter — where the alert sits in its workflow. */
const STATUS_FILTERS: { value: AlertStatus; label: string }[] = [
  { value: "Open",                 label: "Open" },
  { value: "Escalated To Wastage", label: "Escalated To Wastage" },
  { value: "Escalated To PR",      label: "Escalated To Purchase Req" },
];

const SLA_STYLE: Record<SlaStatus, string> = {
  "Breached":       "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
  "Due Today":      "bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]",
  "Within SLA":     "bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]",
  "Met":            "bg-[#F0FDFA] text-[#0F766E] border-[#99F6E4]",
  "Not Applicable": "bg-[#F8FAFC] text-[#64748B] border-[#E2E8F0]",
};

/** Small caption under the SLA pill — how far inside or past the due date. */
function slaCaption(sla: SlaStatus, delta: number, dueDate: string): string {
  switch (sla) {
    case "Breached":   return `${delta} d overdue`;
    case "Due Today":  return `due ${dueDate}`;
    case "Within SLA": return `${Math.abs(delta)} d left`;
    case "Met":        return delta === 0 ? "closed on due date" : `closed ${Math.abs(delta)} d early`;
    default:           return "no alert clock";
  }
}

const BUCKET_STYLE: Record<string, string> = {
  "0-30 Days":  "text-emerald-600",
  "31-60 Days": "text-sky-600",
  "61-90 Days": "text-amber-600",
  "90+ Days":   "text-rose-600",
};

function Pill({ text, cls }: { text: string; cls: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {text}
    </span>
  );
}

const bdt = (n: number) => `৳ ${Math.round(n).toLocaleString()}`;

// ── Alert-configuration form pieces ─────────────────────────────────────────
function CfgSection({
  title, hint, children,
}: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border px-3 py-3">
      <p className="text-xs font-semibold">{title}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function CfgNumber({
  label, hint, value, onChange, min = 1,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: string) => void;
  min?: number;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        value={Number.isFinite(value) ? String(value) : ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1"
      />
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── New-lot form ────────────────────────────────────────────────────────────
type FormState = {
  itemCode: string;
  batchNo: string;
  binLocation: string;
  officeId: string;
  warehouseId: string;
  receivedOn: string;
  expiry: string;
  qty: string;
  unitCost: string;
  assignedTo: string;
  raisedBy: string;
  remarks: string;
};

const emptyForm = (today: string): FormState => ({
  itemCode: "",
  batchNo: "",
  binLocation: "",
  officeId: "OFF-001",
  warehouseId: "WH-001",
  receivedOn: today,
  expiry: "",
  qty: "",
  unitCost: "",
  assignedTo: "",
  raisedBy: "",
  remarks: "",
});

const SELECT_CLS = "w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm";

export default function StockAgeingAlerts() {
  const { role } = useRole();
  const navigate = useNavigate();
  const today = useMemo(() => todayIso(), []);
  const staff = useMemo(() => getActiveStaff(), []);
  const master = useMemo(() => readInventoryMaster(), []);

  /**
   * Replenishment test for a Critical / Near Expiry lot. Losing the lot to
   * expiry drops the item's on-hand stock; a demand is only worth raising when
   * what is left would fall below the item's configured reorder level. Items
   * with no reorder level set have no benchmark to judge against, so they stay
   * open to a demand.
   */
  const stockCheck = (r: AgeingRow) => {
    const inv = master.find((i) => i.id === r.itemCode);
    const available = inv?.stock ?? 0;
    const reorder = inv?.reorder ?? 0;
    const afterExpiry = available - r.qty;
    return {
      available,
      reorder,
      afterExpiry,
      short: reorder > 0 ? afterExpiry < reorder : true,
    };
  };
  /**
   * Requisitions are for stock about to expire — never for already-expired lots
   * — and only once per lot; a lot already escalated to supply chain is closed
   * to further requisitions.
   */
  const canRaisePR = (r: AgeingRow) =>
    (r.level === "Critical" || r.level === "Near Expiry")
    && !reviews[r.id]?.prRef
    && stockCheck(r).short;

  // Manually logged lots + the review trail against every row (system rows are
  // derived, so their workflow state lives here keyed by row id).
  const [manual, setManual] = usePersistedState<ManualAgeingEntry[]>("stock-ageing-manual", []);
  const [reviews, setReviews] = usePersistedState<Record<string, AgeingReview>>("stock-ageing-reviews", {});
  // Per-item alert configuration. Items without an entry follow the house policy.
  const [configs, setConfigs] = usePersistedState<Record<string, ItemAlertConfig>>("stock-ageing-alert-config", {});
  // Escalated lots waiting to be turned into disposal reports in Wastage
  // Management (shared queue — that page reads and clears it).
  const [queue, setQueue] = usePersistedState<ExpiredDisposalLot[]>(EXPIRED_QUEUE_KEY, []);
  // Per-alert activity log, shown in the View dialog.
  const [logs, setLogs] = usePersistedState<Record<string, AgeingLogEntry[]>>("stock-ageing-logs", {});

  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [ageFilter, setAgeFilter] = useState("");

  const [newOpen, setNewOpen] = useState(false);
  const [addTab, setAddTab] = useState<"record" | "config">("record");
  const [form, setForm] = useState<FormState>(() => emptyForm(today));
  const [cfgItem, setCfgItem] = useState("");
  const [cfg, setCfg] = useState<ItemAlertConfig | null>(null);
  const [viewRow, setViewRow] = useState<AgeingRow | null>(null);
  const [reviewRemarks, setReviewRemarks] = useState("");
  /** Queue entry for the open row, plus the legacy direct-report reference. */
  const viewLot = viewRow ? queue.find((l) => l.id === viewRow.id) : undefined;
  const legacyRef = viewRow ? reviews[viewRow.id]?.wastageRef : undefined;
  /** The disposal report id, once one exists for this lot. */
  const escalatedRef = viewLot?.wastageRef ?? legacyRef;
  /** True as soon as the lot is queued — blocks a second escalation. */
  const isEscalated = !!viewLot || !!legacyRef;
  /** Which action the open row supports, and the stock figures behind it. */
  const viewIsExpired = viewRow?.level === "Expired";
  const viewCanRaisePR = viewRow ? canRaisePR(viewRow) : false;
  const viewStock = viewRow
    ? stockCheck(viewRow)
    : { available: 0, reorder: 0, afterExpiry: 0, short: false };

  const rows = useMemo(
    () => assembleAgeingRows(
      buildSystemRows(master, today, configs),
      buildManualRows(manual, today, configs),
      reviews,
      today,
    ),
    [master, manual, reviews, configs, today],
  );

  // ── KPI aggregation ───────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const byBucket = (b: string) => rows.filter((r) => r.bucket === b);
    const value = (list: AgeingRow[]) => list.reduce((s, r) => s + r.stockValue, 0);

    const slow = rows.filter((r) => r.ageDays > AGEING_POLICY.slowMoving);
    const expired = rows.filter((r) => r.level === "Expired");
    const critical = rows.filter((r) => r.level === "Critical");
    const near = rows.filter((r) => r.level === "Near Expiry");
    const alerts = rows.filter((r) => isAlert(r.level));

    return {
      totalLots: rows.length,
      totalValue: value(rows),
      buckets: AGE_BUCKETS.map((b) => ({ bucket: b, count: byBucket(b).length })),
      slowCount: slow.length,
      slowValue: value(slow),
      bucket3: byBucket("61-90 Days").length,
      bucket4: byBucket("90+ Days").length,
      expiryAlerts: expired.length + critical.length + near.length,
      expiredCount: expired.length,
      criticalCount: critical.length,
      nearCount: near.length,
      expiryValue: value([...expired, ...critical, ...near]),
      openCount: alerts.filter((r) => r.status === "Open").length,
      escalatedCount: alerts.filter((r) => r.status === "Escalated To Wastage").length,
      prCount: alerts.filter((r) => r.status === "Escalated To PR").length,
    };
  }, [rows]);

  // Replacement purchase requisitions raised from this page, for the banner.
  const prStats = useMemo(() => {
    const byRef = new Map<string, { lots: number; qty: number; value: number }>();
    for (const r of rows) {
      const ref = reviews[r.id]?.prRef;
      if (!ref) continue;
      const cur = byRef.get(ref) ?? { lots: 0, qty: 0, value: 0 };
      cur.lots += 1;
      cur.qty += r.qty;
      cur.value += r.stockValue;
      byRef.set(ref, cur);
    }
    const totals = Array.from(byRef.values());
    // Highest PR number = most recently raised.
    const latest = Array.from(byRef.keys()).sort().at(-1) ?? "";
    return {
      prs: byRef.size,
      lots: totals.reduce((s, v) => s + v.lots, 0),
      qty: totals.reduce((s, v) => s + v.qty, 0),
      value: totals.reduce((s, v) => s + v.value, 0),
      latest,
    };
  }, [rows, reviews]);

  // ── Filters: Search + Received-date range + Status ────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const haystack = [
          r.alertNo, r.itemCode, r.item, r.category, r.batchNo, r.binLocation,
          r.level, r.status, r.sla, r.action, officeName(r.officeId), warehouseName(r.warehouseId),
        ].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (fromDate && (!isDate(r.receivedOn) || r.receivedOn < fromDate)) return false;
      if (toDate && (!isDate(r.receivedOn) || r.receivedOn > toDate)) return false;
      if (levelFilter && r.level !== levelFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (ageFilter && !inAgeRange(r.ageDays, ageFilter)) return false;
      return true;
    });
  }, [rows, search, fromDate, toDate, levelFilter, statusFilter, ageFilter]);

  const filtersActive = !!(search || fromDate || toDate || levelFilter || statusFilter || ageFilter);
  /** Bulk action offered for the filtered level (none = no row ticking). */
  const bulkAction = levelFilter ? BULK_ACTION_BY_LEVEL[levelFilter] : undefined;

  // ── New-lot form helpers ──────────────────────────────────────────────────
  const f = (field: keyof FormState, value: string) => setForm((p) => ({ ...p, [field]: value }));
  const selectedItem = useMemo(() => master.find((i) => i.id === form.itemCode), [master, form.itemCode]);

  // Live classification preview so the storekeeper sees the alert the entry will
  // raise before saving — same policy the tracker applies to system rows.
  const preview = useMemo(() => {
    if (!isDate(form.receivedOn)) return null;
    // Use the item's own alert configuration when it has one.
    const config = configs[form.itemCode];
    const t = thresholdsFor(config);
    const ageDays = Math.max(0, daysBetween(form.receivedOn, today));
    const dte = isDate(form.expiry) ? daysBetween(today, form.expiry) : null;
    const level = levelOf(ageDays, dte, t);
    const expiry = isDate(form.expiry) ? form.expiry : "";
    const alertSince = alertSinceOf(level, form.receivedOn, expiry, t);
    const slaTargetDays = slaTargetFor(level, config);
    const slaDueDate = isDate(alertSince) && slaTargetDays !== null ? addDays(alertSince, slaTargetDays) : "";
    const status: AlertStatus = isAlert(level) ? "Open" : "No Alert";
    const { sla, slaDelta } = slaStateOf(slaDueDate, status, "", today);
    return {
      ageDays, bucket: bucketOf(ageDays), dte, level, action: ACTION_BY_LEVEL[level],
      alertSince, slaTargetDays, slaDueDate, sla, slaDelta,
      responsible: config?.responsible ?? "",
      configured: !!config,
    };
  }, [form.receivedOn, form.expiry, form.itemCode, configs, today]);

  const openNew = () => {
    setForm(emptyForm(today));
    setAddTab("record");
    setNewOpen(true);
  };

  // ── Alert configuration tab ───────────────────────────────────────────────
  /** Load an item's saved configuration, or start from the house defaults. */
  const pickConfigItem = (itemCode: string) => {
    setCfgItem(itemCode);
    if (!itemCode) { setCfg(null); return; }
    const inv = master.find((i) => i.id === itemCode);
    setCfg(configs[itemCode] ?? defaultAlertConfig(itemCode, inv?.name ?? itemCode));
  };

  const setCfgField = <K extends keyof ItemAlertConfig>(field: K, value: ItemAlertConfig[K]) =>
    setCfg((p) => (p ? { ...p, [field]: value } : p));

  const setCfgNumber = (field: "expiryCritical" | "expiryWarning" | "slowMoving" | "obsolete" | "escalateAfter", value: string) =>
    setCfg((p) => (p ? { ...p, [field]: value === "" ? NaN : Number(value) } : p));

  const setCfgSla = (level: Exclude<AlertLevel, "Healthy">, value: string) =>
    setCfg((p) => (p ? { ...p, sla: { ...p.sla, [level]: value === "" ? NaN : Number(value) } } : p));

  const toggleMethod = (method: NotifyMethod, on: boolean) =>
    setCfg((p) => {
      if (!p) return p;
      const methods = on ? [...p.methods, method] : p.methods.filter((m) => m !== method);
      return { ...p, methods: NOTIFY_METHODS.filter((m) => methods.includes(m)) };
    });

  const cfgErrors = useMemo(() => (cfg ? validateAlertConfig(cfg) : []), [cfg]);

  const saveConfig = () => {
    if (!cfg) { toast.error("Choose an item to configure."); return; }
    const errors = validateAlertConfig(cfg);
    if (errors.length > 0) { toast.error(errors[0]); return; }
    const saved: ItemAlertConfig = { ...cfg, updatedBy: cfg.responsible || "Store", updatedAt: today };
    setConfigs((prev) => ({ ...prev, [cfg.itemCode]: saved }));
    setCfg(saved);
    toast.success(`Alert configuration saved for ${cfg.itemName}.`);
  };

  const resetConfig = () => {
    if (!cfg) return;
    setCfg(defaultAlertConfig(cfg.itemCode, cfg.itemName));
    toast.info("Reset to the standard settings — not saved yet.");
  };

  const removeConfig = (itemCode: string) => {
    setConfigs((prev) => {
      const next = { ...prev };
      delete next[itemCode];
      return next;
    });
    if (cfgItem === itemCode) pickConfigItem("");
    toast.success("Configuration removed — this item is back on the standard settings.");
  };

  const saveNew = () => {
    if (!form.itemCode) { toast.error("Item is required."); return; }
    if (!form.batchNo.trim()) { toast.error("Batch / Lot No. is required."); return; }
    if (!isDate(form.receivedOn)) { toast.error("Received Date is required."); return; }
    const qty = Number(form.qty);
    if (!(qty > 0)) { toast.error("Quantity must be greater than zero."); return; }
    if (isDate(form.expiry) && form.expiry < form.receivedOn) {
      toast.error("Expiry Date cannot be earlier than the Received Date.");
      return;
    }
    if (!form.raisedBy) { toast.error("Raised By is required."); return; }

    const inv = selectedItem;
    const entry: ManualAgeingEntry = {
      id: `AGE-MAN-${Date.now()}`,
      itemCode: form.itemCode,
      item: inv?.name ?? form.itemCode,
      category: inv?.category ?? "—",
      uom: inv?.uom ?? "—",
      batchNo: form.batchNo.trim(),
      binLocation: form.binLocation.trim(),
      officeId: form.officeId,
      warehouseId: form.warehouseId,
      storage: inv?.storage ?? "Dry",
      receivedOn: form.receivedOn,
      expiry: isDate(form.expiry) ? form.expiry : "",
      qty,
      unitCost: Number(form.unitCost) || 0,
      assignedTo: form.assignedTo,
      remarks: form.remarks.trim(),
      status: preview && isAlert(preview.level) ? "Open" : "No Alert",
      raisedBy: form.raisedBy,
      raisedOn: today,
    };
    setManual((prev) => [entry, ...prev]);
    setNewOpen(false);
    toast.success(`Ageing record logged for ${entry.item} — lot ${entry.batchNo}.`);
  };

  // ── Review trail ──────────────────────────────────────────────────────────
  const openView = (row: AgeingRow) => {
    setViewRow(row);
    setReviewRemarks(row.remarks);
  };

  /**
   * Jump to Stock Overview and blink this item's row there — same arrival-flash
   * highlight the other modules use ("inv-alerts" container + row id).
   */
  const goToStockOverview = (itemCode: string, itemName: string) => {
    flagArrival({ target: "inv-alerts", ids: [itemCode] });
    setViewRow(null);
    navigate("/inventory");
    toast.success(`Opening ${itemName} in Stock Overview.`);
  };

  /** Open the raised requisition in Purchase Requisition, blinking its row. */
  const goToPurchaseRequisition = (prId: string) => {
    if (prId) flagArrival({ target: "pr-list", ids: [prId] });
    setViewRow(null);
    navigate("/purchase-requisition");
    toast.success(`Opening ${prId} in Purchase Requisition.`);
  };

  /** Open Wastage Management — where escalated lots are disposed. With a report
   *  reference, its row blinks on arrival (arrival-flash "wastage-list"). */
  const goToWastage = (ref?: string) => {
    if (ref) flagArrival({ target: "wastage-list", ids: [ref] });
    setViewRow(null);
    navigate("/wastage-management");
    toast.success(
      ref
        ? `Opening ${ref} in Wastage Management.`
        : "Opening Wastage Management — choose “Expired Product Disposal” to dispose queued lots.",
    );
  };

  /** Queue entry for an ageing row, if it has already been escalated. */
  const queuedLot = (rowId: string) => lotForAlert(queue, rowId);


  const stampNow = () => `${today} ${new Date().toTimeString().slice(0, 5)}`;

  /** Append one activity-log entry to each of `rowIds`. */
  const appendLog = (rowIds: string[], entry: Omit<AgeingLogEntry, "by">) => {
    setLogs((prev) => {
      const next = { ...prev };
      for (const id of rowIds) {
        next[id] = [...(next[id] ?? []), { ...entry, by: role }];
      }
      return next;
    });
  };

  /**
   * Put lots on the expired-disposal queue. The disposal report itself is raised
   * in Wastage Management (type "Expired Product Disposal"), which is what sends
   * it to Approval Management; stock only moves once that is finally approved.
   * Queuing here never touches stock.
   */
  const escalateLots = (rows: AgeingRow[], onDone?: () => void) => {
    const alreadyQueued = new Set(queue.map((l) => l.id));
    const fresh = rows.filter((r) => !alreadyQueued.has(r.id) && !reviews[r.id]?.wastageRef);
    if (fresh.length === 0) {
      toast.info("Those lots are already escalated.");
      onDone?.();
      return;
    }
    const at = stampNow();
    const lots: ExpiredDisposalLot[] = fresh.map((r) => ({
      id: r.id,
      alertNo: r.alertNo,
      itemCode: r.itemCode,
      itemName: r.item,
      category: r.category,
      uom: r.uom,
      batchNo: r.batchNo,
      receivedOn: r.receivedOn,
      expiry: r.expiry,
      ageDays: r.ageDays,
      qty: r.qty,
      unitCost: r.unitCost,
      officeId: r.officeId,
      warehouseId: r.warehouseId,
      level: r.level,
      escalatedBy: role,
      escalatedAt: at,
      status: "Pending Disposal",
    }));

    setQueue((prev) => [...lots, ...prev]);
    setReviews((prev) => {
      const next = { ...prev };
      for (const r of fresh) {
        next[r.id] = {
          status: "Escalated To Wastage",
          assignedTo: r.assignedTo || r.responsible,
          remarks: (viewRow?.id === r.id ? reviewRemarks.trim() : r.remarks) || "Escalated for expired-product disposal.",
          updatedBy: role,
          updatedAt: today,
        };
      }
      return next;
    });
    appendLog(fresh.map((r) => r.id), {
      at,
      action: "Escalated To Wastage",
      detail: "Queued for Expired Product Disposal — awaiting a disposal report in Wastage Management.",
    });
    setViewRow(null);
    onDone?.();
    const skipped = rows.length - fresh.length;
    toast.success(
      `${fresh.length} lot${fresh.length === 1 ? "" : "s"} escalated${skipped ? ` (${skipped} already queued)` : ""} — ` +
      `dispose from Wastage Management → Expired Product Disposal.`,
    );
  };

  const escalateToWastage = () => {
    if (viewRow) escalateLots([viewRow]);
  };

  /**
   * Raise ONE Purchase Requisition covering the selected lots. The store does
   * not buy the replacement itself — it tells supply chain that this stock is
   * about to expire, and supply chain purchases before it does. The requisition
   * is filed at "Pending Approval", so it appears in Approval Management under
   * Purchase Req. and then follows the standard purchase flow untouched.
   *
   * Critical lots (a week or less of shelf life) are flagged Urgent.
   */
  const escalateToPR = (rows: AgeingRow[], onDone?: () => void) => {
    const fresh = rows;
    if (fresh.length === 0) {
      toast.info("Select at least one lot to raise a purchase requisition for.");
      onDone?.();
      return;
    }
    const at = stampNow();
    // One requisition line per item — lots of the same item are summed and
    // priced at the lot's last known cost.
    const byItem = new Map<string, PRLineItem>();
    for (const r of fresh) {
      const line = byItem.get(r.itemCode);
      if (line) line.qty += r.qty;
      else byItem.set(r.itemCode, {
        id: `L${byItem.size + 1}`,
        itemName: r.item,
        description: `${r.itemCode} · ${r.category} — replaces near-expiry lot ${r.batchNo}`,
        qty: r.qty,
        uom: r.uom,
        rate: r.unitCost,
      });
    }
    const alertNos = fresh.map((r) => r.alertNo);
    const shown = alertNos.slice(0, 4).join(", ") + (alertNos.length > 4 ? ` +${alertNos.length - 4} more` : "");
    const urgent = fresh.some((r) => r.level === "Critical");
    // Needed by the day the earliest lot expires — that is when the cover runs out.
    const expiries = fresh.map((r) => r.expiry).filter(isDate).sort();
    const requiredBy = expiries[0] ?? today;

    const pr = addPurchaseRequisition({
      date: today,
      officeId: fresh[0].officeId,
      warehouseId: fresh[0].warehouseId,
      requestedBy: role,
      requiredBy,
      priority: urgent ? "Urgent" : "Normal",
      justification:
        `Near-expiry stock flagged by Stock Ageing & Alerts (${shown}). ` +
        `${fresh.length} lot${fresh.length === 1 ? "" : "s"} expiring from ${requiredBy} — ` +
        `purchase replacement stock before the current cover runs out.`,
      lines: Array.from(byItem.values()),
      status: "Pending Approval",
    });

    setReviews((prev) => {
      const next = { ...prev };
      for (const r of fresh) {
        next[r.id] = {
          ...(next[r.id] ?? {
            assignedTo: r.assignedTo || r.responsible,
            remarks: r.remarks,
          }),
          status: "Escalated To PR",
          prRef: pr.id,
          updatedBy: role,
          updatedAt: today,
        };
      }
      return next;
    });
    appendLog(fresh.map((r) => r.id), {
      at,
      action: "Purchase Requisition Raised",
      detail:
        `${urgent ? "Urgent — " : ""}replacement purchase for ${byItem.size} item${byItem.size === 1 ? "" : "s"}, ` +
        `required by ${requiredBy} — pending approval.`,
      ref: pr.id,
    });
    setViewRow(null);
    onDone?.();
    toast.success(
      `${pr.id} raised for ${fresh.length} lot${fresh.length === 1 ? "" : "s"} ` +
      `(${byItem.size} item${byItem.size === 1 ? "" : "s"})${urgent ? " · Urgent" : ""} — pending approval.`,
    );
  };

  const removeManual = (row: AgeingRow) => {
    setManual((prev) => prev.filter((m) => m.id !== row.id));
    setReviews((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    toast.success(`${row.alertNo} removed.`);
  };

  // ── Table ─────────────────────────────────────────────────────────────────
  const cols: Column<AgeingRow>[] = [
    {
      key: "alertNo", header: "Alert #",
      render: (r) => (
        <div className="leading-tight">
          <div className="font-mono text-xs font-semibold">{r.alertNo}</div>
          <div className="text-[10px] text-muted-foreground">{r.source}</div>
        </div>
      ),
    },
    { key: "itemCode", header: "Item Code", render: (r) => <span className="font-mono text-xs">{r.itemCode}</span> },
    {
      key: "item", header: "Item",
      render: (r) => (
        <div className="leading-tight">
          <div className="font-medium">{r.item}</div>
          <div className="text-[10px] text-muted-foreground">{r.category}</div>
        </div>
      ),
    },
    {
      key: "batchNo", header: "Batch / Lot",
      render: (r) => (
        <div className="leading-tight">
          <div className="font-mono text-xs">{r.batchNo}</div>
          <div className="text-[10px] text-muted-foreground">{r.binLocation}</div>
        </div>
      ),
    },
    {
      key: "warehouseId", header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    { key: "receivedOn", header: "Received On", render: (r) => <span className="tabular-nums text-xs">{r.receivedOn || "—"}</span> },
    {
      key: "ageDays", header: "Age (Days)",
      render: (r) => (
        <div className="leading-tight">
          <div className="tabular-nums font-semibold">{r.ageDays}</div>
          <div className={`text-[10px] font-medium ${BUCKET_STYLE[r.bucket]}`}>{r.bucket}</div>
        </div>
      ),
    },
    {
      key: "expiry", header: "Expiry / Shelf Life",
      render: (r) => {
        if (r.daysToExpiry === null) {
          return <span className="text-xs text-muted-foreground">No shelf life</span>;
        }
        const expired = r.daysToExpiry < 0;
        return (
          <div className="leading-tight">
            <div className="tabular-nums text-xs">{r.expiry}</div>
            <div className={`text-[10px] font-medium ${
              expired ? "text-rose-600" : r.daysToExpiry <= AGEING_POLICY.expiryCritical ? "text-rose-500"
              : r.daysToExpiry <= AGEING_POLICY.expiryWarning ? "text-amber-600" : "text-muted-foreground"
            }`}>
              {expired ? `${Math.abs(r.daysToExpiry)} d overdue` : `${r.daysToExpiry} d left`}
            </div>
          </div>
        );
      },
    },
    {
      key: "qty", header: "Qty on Hand",
      render: (r) => (
        <button
          type="button"
          onClick={() => goToStockOverview(r.itemCode, r.item)}
          className="group -mx-1 rounded-sm px-1 py-0.5 text-left leading-tight transition-colors hover:bg-sky-50"
          title={`Open ${r.item} in Stock Overview`}
        >
          <div className="tabular-nums font-medium text-sky-700 underline decoration-dotted decoration-sky-300 underline-offset-2 group-hover:decoration-sky-500">
            {r.qty.toLocaleString()} {r.uom}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">{bdt(r.stockValue)}</div>
        </button>
      ),
    },
    { key: "level", header: "Alert Level", render: (r) => <Pill text={r.level} cls={LEVEL_STYLE[r.level]} /> },
    {
      key: "sla", header: "SLA Breach Status",
      render: (r) => (
        <div className="leading-tight">
          <Pill text={r.sla} cls={SLA_STYLE[r.sla]} />
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {slaCaption(r.sla, r.slaDelta, r.slaDueDate)}
          </div>
        </div>
      ),
    },
    {
      key: "status", header: "Status",
      render: (r) => (
        <div className="leading-tight">
          <Pill text={r.status} cls={STATUS_STYLE[r.status]} />
          {reviews[r.id]?.prRef && (
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {reviews[r.id]?.prRef}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Stock Ageing & Alerts"
        subtitle="Batch-lot ageing, shelf-life alerts and slow-moving stock — measured from receipt date and expiry, with the action each lot needs"
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Add New
          </Button>
        }
      />

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Ageing Lots" value={kpi.totalLots.toLocaleString()} icon={Hourglass}
          tone="violet" variant="aurora"
          sub={bdt(kpi.totalValue)}
          breakdown={kpi.buckets.map((b, i) => ({
            label: b.bucket, value: b.count, icon: ["🟢", "🔵", "🟠", "🔴"][i],
          }))}
        />
        <KpiCard
          label="Slow Moving (60+ Days)" value={kpi.slowCount.toLocaleString()} icon={TimerReset}
          tone="blue" variant="aurora"
          sub={`${bdt(kpi.slowValue)} held`}
          breakdown={[
            { label: "61-90 Days", value: kpi.bucket3, icon: "🕐" },
            { label: "90+ Days", value: kpi.bucket4, icon: "⏳" },
            { label: "Capital Held", value: bdt(kpi.slowValue), icon: "💰" },
          ]}
        />
        <KpiCard
          label="Expiry Alerts" value={kpi.expiryAlerts.toLocaleString()} icon={CalendarClock}
          tone="rose" variant="aurora"
          sub={`${bdt(kpi.expiryValue)} at risk`}
          breakdown={[
            { label: "Expired", value: kpi.expiredCount, icon: "⛔" },
            { label: `Critical (≤${AGEING_POLICY.expiryCritical}d)`, value: kpi.criticalCount, icon: "🚨" },
            { label: `Near (≤${AGEING_POLICY.expiryWarning}d)`, value: kpi.nearCount, icon: "📅" },
          ]}
        />
        <KpiCard
          label="Open Alerts" value={kpi.openCount.toLocaleString()} icon={BellRing}
          tone="amber" variant="aurora"
          sub={`${kpi.escalatedCount} escalated`}
          breakdown={[
            { label: "Open", value: kpi.openCount, icon: "🔔" },
            { label: "Escalated To Wastage", value: kpi.escalatedCount, icon: "🗑️" },
            { label: "Escalated To PR", value: kpi.prCount, icon: "🛒" },
          ]}
        />
      </div>

      {/* Escalation tracker — only while lots are still waiting to be disposed. */}
      {queueCounts(queue).pending > 0 && (() => {
        const c = queueCounts(queue);
        return (
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <span className="font-semibold">Expired Disposal Queue</span>
            <span><strong className="tabular-nums">{c.pending}</strong> pending disposal</span>
            <span><strong className="tabular-nums">{c.disposed}</strong> disposed</span>
            <span className="text-rose-700">of {c.total} escalated · {c.pendingQty.toLocaleString()} units / {bdt(c.pendingValue)} still to clear</span>
            <button
              type="button"
              onClick={() => goToWastage()}
              className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-semibold underline underline-offset-2 hover:text-rose-600"
            >
              Dispose in Wastage Management →
            </button>
          </div>
        );
      })()}

      {/* Replenishment tracker — requisitions raised for Critical / Near Expiry stock. */}
      {prStats.prs > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Near-Expiry Replenishment</span>
          <span><strong className="tabular-nums">{prStats.prs}</strong> purchase requisition{prStats.prs === 1 ? "" : "s"} raised</span>
          <span><strong className="tabular-nums">{prStats.lots}</strong> lot{prStats.lots === 1 ? "" : "s"} covered</span>
          <span className="text-amber-700">
            {prStats.qty.toLocaleString()} units / {bdt(prStats.value)} at risk · latest {prStats.latest}
          </span>
          <button
            type="button"
            onClick={() => goToPurchaseRequisition(prStats.latest)}
            className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-semibold underline underline-offset-2 hover:text-amber-600"
          >
            View Purchase Requisitions →
          </button>
        </div>
      )}

      {/* ── Filters: Search · Date Range · Status ─────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item, code, lot, level…"
            className="h-7 w-full min-w-0 sm:w-64 border-0 px-1 text-xs shadow-none focus-visible:ring-0"
            aria-label="Search ageing records"
          />
        </div>

        <div className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
          <CalendarDays className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="field-label">Received</span>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-7 w-[8.5rem] border-0 px-1 text-xs tabular-nums shadow-none focus-visible:ring-0"
            aria-label="Received from date"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-7 w-[8.5rem] border-0 px-1 text-xs tabular-nums shadow-none focus-visible:ring-0"
            aria-label="Received to date"
          />
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
          <AlertTriangle className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="field-label">Alert Level</span>
          <AntSelect
            value={levelFilter || ""}
            onChange={(next: string) => setLevelFilter(next)}
            size="small"
            variant="borderless"
            style={{ minWidth: 150 }}
            options={[
              { value: "", label: "All" },
              ...LEVEL_FILTERS.map((l) => ({
                value: l,
                label: `${l} (${rows.filter((r) => r.level === l).length})`,
              })),
            ]}
          />
        </div>

        {/* Status — where the alert sits in its workflow. */}
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
          <BellRing className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="field-label">Status</span>
          <AntSelect
            value={statusFilter || ""}
            onChange={(next: string) => setStatusFilter(next)}
            size="small"
            variant="borderless"
            style={{ minWidth: 190 }}
            options={[
              { value: "", label: "All" },
              ...STATUS_FILTERS.map((s) => ({
                value: s.value,
                label: `${s.label} (${rows.filter((r) => r.status === s.value).length})`,
              })),
            ]}
          />
        </div>

        {/* Age Day — days the lot has been held in store since receipt. */}
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
          <Hourglass className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="field-label">Age Day</span>
          <AntSelect
            value={ageFilter || ""}
            onChange={(next: string) => setAgeFilter(next)}
            size="small"
            variant="borderless"
            style={{ minWidth: 140 }}
            options={[
              { value: "", label: "All" },
              ...AGE_DAY_RANGES.map((r) => ({
                value: r.key,
                label: `${r.label} (${rows.filter((row) => inAgeRange(row.ageDays, r.key)).length})`,
              })),
            ]}
          />
        </div>

        {filtersActive && (
          <AntButton
            size="small"
            type="text"
            icon={<CloseOutlined />}
            onClick={() => { setSearch(""); setFromDate(""); setToDate(""); setLevelFilter(""); setStatusFilter(""); setAgeFilter(""); }}
            style={{ color: "var(--color-muted-foreground)" }}
          >
            Clear
          </AntButton>
        )}

        {!bulkAction && (
          <span className="text-[11px] text-muted-foreground">
            Filter by Alert Level (Expired / Critical / Near Expiry) to select and act on multiple lots.
          </span>
        )}
      </div>

      {/* Wide tracker — scrolls inside its own container on narrow screens. */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="min-w-[1180px]">
          <DataTable
            title="stock-ageing-alerts"
            data={filtered}
            columns={cols}
            searchKeys={["alertNo", "itemCode", "item", "batchNo", "level", "sla", "status"]}
            // Row ticking only appears once an actionable Alert Level is
            // filtered, so the bulk action on the selection is unambiguous.
            selectable={!!bulkAction}
            pageSize={10}
            // A lot may only be escalated for disposal once, so already-queued
            // rows can't be ticked. Replenishment demands carry no such limit —
            // stock can be re-ordered again later — so those rows stay open to
            // single, multi and select-all picking.
            isRowSelectable={(r) => (
              bulkAction?.kind === "wastage"
                ? !queuedLot(r.id) && !reviews[r.id]?.wastageRef
                : canRaisePR(r)
            )}
            bulkActions={(ids, clear, selectAll, total) => {
              const picked = filtered.filter((r) => ids.includes(r.id));
              const fresh = bulkAction?.kind === "wastage"
                ? picked.filter((r) => !queuedLot(r.id) && !reviews[r.id]?.wastageRef)
                : picked.filter(canRaisePR);
              const isWastage = bulkAction?.kind === "wastage";
              return (
                <>
                  {ids.length < total && (
                    <Button size="sm" variant="outline" className="h-7" onClick={selectAll}>
                      Select all ({total})
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="h-7"
                    disabled={fresh.length === 0}
                    onClick={() => (isWastage ? escalateLots(picked, clear) : escalateToPR(picked, clear))}
                    title={
                      fresh.length === 0
                        ? isWastage
                          ? "Every selected lot is already escalated"
                          : "Selected lots are already escalated, or stay above their reorder level"
                        : isWastage
                          ? "Queue these lots for Expired Product Disposal"
                          : `Raise one purchase requisition covering these lots${levelFilter === "Critical" ? " (flagged Urgent)" : ""}`
                    }
                  >
                    {isWastage
                      ? <Trash2 className="mr-1 h-3.5 w-3.5" />
                      : <Send className="mr-1 h-3.5 w-3.5" />}
                    {bulkAction?.label} ({fresh.length})
                    {!isWastage && levelFilter === "Critical" && (
                      <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">Urgent</span>
                    )}
                  </Button>
                </>
              );
            }}
            actions={(row) => (
              <div className="flex items-center gap-1">
                <Button
                  size="icon" variant="outline" className="h-7 w-7"
                  onClick={() => openView(row)}
                  title="View & review"
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                {row.source === "Manual" && (
                  <Button
                    size="icon" variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeManual(row)}
                    title="Remove manual record"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          />
        </div>
      </div>

      {/* ── Add New ───────────────────────────────────────────────────────── */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            {/* The headline itself is the tab strip — record entry on the left,
                the item's alert configuration beside it. */}
            <DialogTitle asChild>
              <Tabs value={addTab} onValueChange={(v) => setAddTab(v as "record" | "config")}>
                <TabsList className="h-9">
                  <TabsTrigger value="record">New Ageing Record</TabsTrigger>
                  <TabsTrigger value="config">Alert Configuration</TabsTrigger>
                </TabsList>
              </Tabs>
            </DialogTitle>
          </DialogHeader>

          {addTab === "record" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label>Item *</Label>
              <select value={form.itemCode} onChange={(e) => f("itemCode", e.target.value)} className={SELECT_CLS}>
                <option value="">Select inventory item</option>
                {master.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id} — {i.name} (Stock: {i.stock} {i.uom})
                  </option>
                ))}
              </select>
              {selectedItem && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Category: {selectedItem.category} · UOM: {selectedItem.uom} · Storage: {selectedItem.storage}
                </p>
              )}
            </div>

            <div>
              <Label>Batch / Lot No. *</Label>
              <Input
                value={form.batchNo}
                onChange={(e) => f("batchNo", e.target.value)}
                placeholder="e.g. BR-2406"
                list="ageing-known-lots"
                className="mt-1"
              />
              <datalist id="ageing-known-lots">
                {(selectedItem?.batches ?? []).map((b) => <option key={b.batchNo} value={b.batchNo} />)}
              </datalist>
            </div>
            <div>
              <Label>Bin / Rack Location</Label>
              <Input
                value={form.binLocation}
                onChange={(e) => f("binLocation", e.target.value)}
                placeholder="e.g. A1-R3-S2"
                className="mt-1"
              />
            </div>

            <div>
              <Label>Received Date *</Label>
              <Input type="date" max={today} value={form.receivedOn} onChange={(e) => f("receivedOn", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Expiry Date</Label>
              <Input type="date" value={form.expiry} onChange={(e) => f("expiry", e.target.value)} className="mt-1" />
              <p className="mt-1 text-[11px] text-muted-foreground">Leave blank for items with no shelf life.</p>
            </div>

            <div>
              <Label>Quantity ({selectedItem?.uom ?? "UOM"}) *</Label>
              <Input type="number" min={0} value={form.qty} onChange={(e) => f("qty", e.target.value)} placeholder="0" className="mt-1" />
            </div>
            <div>
              <Label>Unit Cost (৳)</Label>
              <Input type="number" min={0} value={form.unitCost} onChange={(e) => f("unitCost", e.target.value)} placeholder="0" className="mt-1" />
            </div>

            <LocationPicker
              officeId={form.officeId}
              warehouseId={form.warehouseId}
              onChange={(n) => setForm((p) => ({ ...p, officeId: n.officeId, warehouseId: n.warehouseId }))}
            />

            <div>
              <Label>Assign To</Label>
              <select value={form.assignedTo} onChange={(e) => f("assignedTo", e.target.value)} className={SELECT_CLS}>
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s.id} value={s.fullName}>{s.fullName} — {s.role}</option>)}
              </select>
            </div>
            <div>
              <Label>Raised By *</Label>
              <select value={form.raisedBy} onChange={(e) => f("raisedBy", e.target.value)} className={SELECT_CLS}>
                <option value="">Select staff</option>
                {staff.map((s) => <option key={s.id} value={s.fullName}>{s.fullName} — {s.role}</option>)}
              </select>
            </div>

            <div className="sm:col-span-2">
              <Label>Remarks</Label>
              <Textarea
                value={form.remarks}
                onChange={(e) => f("remarks", e.target.value)}
                rows={2}
                placeholder="Why this lot is being tracked — storage issue, held stock, off-system holding…"
                className="mt-1"
              />
            </div>

            {/* Live classification — the alert this entry will raise. */}
            {preview && (
              <div className="sm:col-span-2 rounded-md border border-border bg-muted/30 px-3 py-2.5">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Alert Preview
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  <span>Age: <strong className="tabular-nums">{preview.ageDays} d</strong></span>
                  <span>Bucket: <strong className={BUCKET_STYLE[preview.bucket]}>{preview.bucket}</strong></span>
                  <span>
                    Shelf life:{" "}
                    <strong className="tabular-nums">
                      {preview.dte === null ? "—" : preview.dte < 0 ? `${Math.abs(preview.dte)} d overdue` : `${preview.dte} d left`}
                    </strong>
                  </span>
                  <Pill text={preview.level} cls={LEVEL_STYLE[preview.level]} />
                  <Pill text={`SLA: ${preview.sla}`} cls={SLA_STYLE[preview.sla]} />
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{preview.action}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {preview.slaTargetDays === null
                    ? "No SLA clock — healthy lot."
                    : `SLA ${preview.slaTargetDays} day(s) from ${preview.alertSince} → due ${preview.slaDueDate} (${slaCaption(preview.sla, preview.slaDelta, preview.slaDueDate)}).`}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {preview.configured
                    ? `Using this item's own alert settings${preview.responsible ? ` · owner: ${preview.responsible}` : ""}.`
                    : "Using the standard alert settings — open the Alert Configuration tab to set this item's own rules."}
                </p>
              </div>
            )}
          </div>
          )}

          {/* ── Alert Configuration tab ──────────────────────────────────── */}
          {addTab === "config" && (
            <div className="space-y-4">
              <div>
                <Label>Set Up Alerts For *</Label>
                <select value={cfgItem} onChange={(e) => pickConfigItem(e.target.value)} className={SELECT_CLS}>
                  <option value="">Select inventory item</option>
                  {master.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.id} — {i.name}{configs[i.id] ? "  ✓ already set up" : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Items you do not set up here follow the standard rules: warn {AGEING_POLICY.expiryWarning} days
                  before expiry, urgent {AGEING_POLICY.expiryCritical} days before, slow moving after{" "}
                  {AGEING_POLICY.slowMoving} days in store, very old after {AGEING_POLICY.obsolete} days.
                </p>
              </div>

              {!cfg ? (
                <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
                  Choose an item above to set up its alert rules.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Alerts for {cfg.itemName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Turn this off and the item still appears in the ageing list, but it raises no alert and no SLA clock runs.
                      </p>
                    </div>
                    <Switch checked={cfg.enabled} onCheckedChange={(v) => setCfgField("enabled", v)} />
                  </div>

                  <CfgSection
                    title="When should an alert be raised?"
                    hint="Counted in days. Expiry rules look ahead to the expiry date; store-age rules count from the day the stock arrived."
                  >
                    <CfgNumber
                      label="Warn before expiry (days)"
                      hint="Raises a “Near Expiry” alert this many days before the expiry date."
                      value={cfg.expiryWarning}
                      onChange={(v) => setCfgNumber("expiryWarning", v)}
                    />
                    <CfgNumber
                      label="Urgent before expiry (days)"
                      hint="Raises a “Critical” alert this many days before the expiry date."
                      value={cfg.expiryCritical}
                      onChange={(v) => setCfgNumber("expiryCritical", v)}
                    />
                    <CfgNumber
                      label="Slow moving after (days in store)"
                      hint="Stock sitting unused for longer than this is flagged as slow moving."
                      value={cfg.slowMoving}
                      onChange={(v) => setCfgNumber("slowMoving", v)}
                    />
                    <CfgNumber
                      label="Very old after (days in store)"
                      hint="Stock sitting unused for longer than this is flagged as obsolete risk."
                      value={cfg.obsolete}
                      onChange={(v) => setCfgNumber("obsolete", v)}
                    />
                  </CfgSection>

                  <CfgSection
                    title="How quickly must it be dealt with? (SLA)"
                    hint="Working days allowed to act once the alert is raised. Miss it and the row shows as an SLA breach."
                  >
                    {ALERTABLE_LEVELS.map((level) => (
                      <CfgNumber
                        key={level}
                        label={`${level} — days to act`}
                        value={cfg.sla[level]}
                        onChange={(v) => setCfgSla(level, v)}
                      />
                    ))}
                  </CfgSection>

                  <CfgSection title="How should people be told?" hint="Pick at least one way to send the alert.">
                    <div className="sm:col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2">
                      {NOTIFY_METHODS.map((m) => (
                        <label key={m} className="flex cursor-pointer items-center gap-2 text-xs">
                          <Checkbox
                            checked={cfg.methods.includes(m)}
                            onCheckedChange={(v) => toggleMethod(m, v === true)}
                          />
                          {m}
                        </label>
                      ))}
                    </div>
                    <div className="sm:col-span-2">
                      <Label>Repeat the reminder</Label>
                      <select
                        value={cfg.reminder}
                        onChange={(e) => setCfgField("reminder", e.target.value as ReminderFrequency)}
                        className={SELECT_CLS}
                      >
                        {REMINDER_FREQUENCIES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        How often the reminder is sent again while the alert is still open.
                      </p>
                    </div>
                  </CfgSection>

                  <CfgSection title="Who is responsible?" hint="The owner sees the alert first; the escalation contact is told if the SLA is missed.">
                    <div>
                      <Label>Responsible person *</Label>
                      <select
                        value={cfg.responsible}
                        onChange={(e) => setCfgField("responsible", e.target.value)}
                        className={SELECT_CLS}
                      >
                        <option value="">Select staff</option>
                        {staff.map((s) => <option key={s.id} value={s.fullName}>{s.fullName} — {s.role}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Escalate to</Label>
                      <select
                        value={cfg.escalateTo}
                        onChange={(e) => setCfgField("escalateTo", e.target.value)}
                        className={SELECT_CLS}
                      >
                        <option value="">Nobody</option>
                        {staff.map((s) => <option key={s.id} value={s.fullName}>{s.fullName} — {s.role}</option>)}
                      </select>
                    </div>
                    <CfgNumber
                      label="Escalate after (days past due)"
                      hint="0 means escalate on the day the SLA is missed."
                      value={cfg.escalateAfter}
                      min={0}
                      onChange={(v) => setCfgNumber("escalateAfter", v)}
                    />
                  </CfgSection>

                  {cfgErrors.length > 0 && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-700">
                        Please fix before saving
                      </p>
                      <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-red-700">
                        {cfgErrors.map((e) => <li key={e}>{e}</li>)}
                      </ul>
                    </div>
                  )}

                  {cfg.updatedAt && (
                    <p className="text-[11px] text-muted-foreground">
                      Last saved by <span className="font-medium text-foreground">{cfg.updatedBy || "—"}</span> on {cfg.updatedAt}
                    </p>
                  )}
                </>
              )}

              {/* Items already carrying their own rules. */}
              {Object.keys(configs).length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Items already set up ({Object.keys(configs).length})
                  </p>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[560px] text-xs">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold">Item</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Expiry warn / urgent</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Slow / very old</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Responsible</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Notify</th>
                          <th className="px-2 py-1.5 text-left font-semibold">On</th>
                          <th className="px-2 py-1.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {Object.values(configs).map((c) => (
                          <tr key={c.itemCode} className="border-t border-border/60 hover:bg-muted/20">
                            <td className="px-2 py-1.5">
                              <div className="font-medium">{c.itemName}</div>
                              <div className="font-mono text-[10px] text-muted-foreground">{c.itemCode}</div>
                            </td>
                            <td className="px-2 py-1.5 tabular-nums">{c.expiryWarning} / {c.expiryCritical} d</td>
                            <td className="px-2 py-1.5 tabular-nums">{c.slowMoving} / {c.obsolete} d</td>
                            <td className="px-2 py-1.5">{c.responsible || "—"}</td>
                            <td className="px-2 py-1.5">{c.methods.join(", ") || "—"}</td>
                            <td className="px-2 py-1.5">{c.enabled ? "Yes" : "No"}</td>
                            <td className="px-2 py-1.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon" variant="outline" className="h-6 w-6"
                                  onClick={() => pickConfigItem(c.itemCode)}
                                  title="Edit these settings"
                                >
                                  <SlidersHorizontal className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="icon" variant="ghost"
                                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                  onClick={() => removeConfig(c.itemCode)}
                                  title="Remove — go back to the standard rules"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-2">
            {addTab === "record" ? (
              <>
                <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
                <Button onClick={saveNew}>Save Record</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setNewOpen(false)}>Close</Button>
                {cfg && <Button variant="outline" onClick={resetConfig}>Reset to Standard</Button>}
                <Button onClick={saveConfig} disabled={!cfg}>Save Configuration</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View & review ─────────────────────────────────────────────────── */}
      {viewRow && (
        <Dialog open onOpenChange={(o) => { if (!o) setViewRow(null); }}>
          <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Hourglass className="h-4 w-4 text-primary" />
                Ageing Alert — {viewRow.alertNo}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-1">
              <div className="flex flex-wrap items-center gap-2">
                <Pill text={viewRow.level} cls={LEVEL_STYLE[viewRow.level]} />
                <Pill text={viewRow.status} cls={STATUS_STYLE[viewRow.status]} />
                <Pill text={`SLA: ${viewRow.sla}`} cls={SLA_STYLE[viewRow.sla]} />
                <span className="text-[11px] text-muted-foreground">{viewRow.source} record</span>
              </div>

              <div className="rounded-md border border-border overflow-hidden">
                {([
                  ["Item Code", viewRow.itemCode],
                  ["Item", viewRow.item],
                  ["Category", viewRow.category],
                  ["Batch / Lot", viewRow.batchNo],
                  ["Bin Location", viewRow.binLocation],
                  ["Office", officeName(viewRow.officeId)],
                  ["Warehouse", warehouseName(viewRow.warehouseId)],
                  ["Storage", viewRow.storage],
                  ["Received On", viewRow.receivedOn || "—"],
                  ["Age in Store", `${viewRow.ageDays} days (${viewRow.bucket})`],
                  ["Expiry Date", viewRow.expiry || "—"],
                  ["Shelf Life Left", viewRow.daysToExpiry === null ? "—"
                    : viewRow.daysToExpiry < 0 ? `${Math.abs(viewRow.daysToExpiry)} days overdue`
                    : `${viewRow.daysToExpiry} days`],
                  ["Qty on Hand", `${viewRow.qty.toLocaleString()} ${viewRow.uom}`],
                  ["Unit Cost", bdt(viewRow.unitCost)],
                  ["Stock Value", bdt(viewRow.stockValue)],
                  // Replenishment context — what the item holds now and what is
                  // left once this lot is written off against its reorder level.
                  ["Available Stock", `${viewStock.available.toLocaleString()} ${viewRow.uom}`],
                  ["Reorder Level", viewStock.reorder > 0 ? `${viewStock.reorder.toLocaleString()} ${viewRow.uom}` : "Not set"],
                  ["Stock After Expiry", `${viewStock.afterExpiry.toLocaleString()} ${viewRow.uom}${
                    viewStock.reorder > 0 ? (viewStock.short ? " — below reorder level" : " — above reorder level") : ""
                  }`],
                  ["Alert Raised On", viewRow.alertSince || "—"],
                  ["SLA Target", viewRow.slaTargetDays === null ? "—" : `${viewRow.slaTargetDays} day(s) from alert`],
                  ["SLA Due Date", viewRow.slaDueDate || "—"],
                  ["SLA Breach Status", `${viewRow.sla} — ${slaCaption(viewRow.sla, viewRow.slaDelta, viewRow.slaDueDate)}`],
                  ["Alerts Enabled", viewRow.alertsEnabled ? "Yes" : "No — switched off for this item"],
                  ["Responsible Person", viewRow.responsible || "Not configured"],
                  // Once escalated, this points at the disposal report the alert
                  // went to; until then, the configured escalation contact.
                  ["Escalates To",
                    escalatedRef
                      ? `${escalatedRef} — Expired Product Disposal`
                      : isEscalated
                        ? "Queued for Expired Product Disposal"
                        : viewRow.escalateTo || "Wastage Management (on escalation)",
                    isEscalated ? () => goToWastage(escalatedRef) : null],
                  ["Notified By", viewRow.notifyMethods.length ? viewRow.notifyMethods.join(", ") : "Standard (In-App)"],
                ] as [string, string, (() => void) | null | undefined][]).map(([label, value, onClick], i) => (
                  <div
                    key={label}
                    className={`flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs last:border-0 ${
                      i % 2 === 0 ? "bg-muted/20" : "bg-background"
                    }`}
                  >
                    <span className="text-muted-foreground">{label}</span>
                    {onClick ? (
                      <button
                        type="button"
                        onClick={onClick}
                        className="max-w-[55%] cursor-pointer border-0 bg-transparent p-0 text-right font-medium text-primary hover:underline"
                        title="Open in Wastage Management"
                      >
                        {value}
                      </button>
                    ) : (
                      <span className="max-w-[55%] text-right font-medium">{value}</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider">Recommended Action</p>
                {viewRow.action}
              </div>

              {/* Activity log — everything done to this lot, newest last. The
                  disposal entry is derived from the queue so the trail stays
                  complete without the wastage page writing back here. */}
              {(() => {
                const stored = logs[viewRow.id] ?? [];
                const derived: AgeingLogEntry[] = viewLot?.wastageRef
                  ? [{
                      at: viewLot.disposedAt ?? "",
                      by: viewLot.escalatedBy,
                      action: "Disposal Report Raised",
                      detail: "Expired Product Disposal submitted for approval — stock reduces on Final Approval.",
                      ref: viewLot.wastageRef,
                    }]
                  : [];
                const entries = [...stored, ...derived];
                if (entries.length === 0) return null;
                return (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <History className="h-3 w-3" /> Activity Log
                    </p>
                    <div className="overflow-hidden rounded-md border border-border">
                      {entries.map((e, i) => (
                        <div
                          key={`${e.at}-${e.action}-${i}`}
                          className={`border-b border-border px-3 py-2 text-xs last:border-0 ${
                            i % 2 === 0 ? "bg-muted/20" : "bg-background"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium">{e.action}</span>
                            {e.ref && (
                              <button
                                type="button"
                                onClick={() => (e.ref!.startsWith("PR-") ? goToPurchaseRequisition(e.ref!) : goToWastage(e.ref))}
                                className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[11px] font-semibold text-primary hover:underline"
                                title="Open the linked document"
                              >
                                {e.ref}
                              </button>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{e.detail}</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                            {e.by || "—"}{e.at ? ` · ${e.at}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-3 border-t border-border pt-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Review</p>
                <div>
                  <Label>Remarks</Label>
                  <Textarea
                    value={reviewRemarks}
                    onChange={(e) => setReviewRemarks(e.target.value)}
                    rows={2}
                    placeholder="Why this lot is being sent for disposal…"
                    className="mt-1 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:opacity-100"
                    // Locked once escalated — the remarks travel with the lot to
                    // the disposal report and its approval trail.
                    disabled={isEscalated}
                  />
                  {isEscalated && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Locked — these remarks were submitted with the escalation and can no longer be changed.
                    </p>
                  )}
                </div>
                {isEscalated ? (
                  <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                    {escalatedRef ? (
                      <>
                        Disposed under Expired Product Disposal{" "}
                        <button
                          type="button"
                          onClick={() => goToWastage(escalatedRef)}
                          className="cursor-pointer border-0 bg-transparent p-0 font-mono font-semibold text-emerald-900 underline underline-offset-2 hover:text-emerald-700"
                          title="Open in Wastage Management"
                        >
                          {escalatedRef}
                        </button>{" "}
                        — track it in Wastage Management and Approval Management.
                      </>
                    ) : (
                      <>
                        Queued for disposal. Raise the report in{" "}
                        <button
                          type="button"
                          onClick={() => goToWastage()}
                          className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-emerald-900 underline underline-offset-2 hover:text-emerald-700"
                          title="Open Wastage Management"
                        >
                          Wastage Management → Expired Product Disposal
                        </button>
                        , where it can be disposed on its own or together with the other queued lots.
                      </>
                    )}
                  </p>
                ) : viewIsExpired ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Escalating queues this lot for <strong>Expired Product Disposal</strong>. The disposal report is
                    raised in Wastage Management and goes to Approval Management for sign-off; stock is only reduced
                    once it is finally approved.
                  </p>
                ) : viewCanRaisePR ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    This lot has not expired, so it is not disposed of. Losing it would leave{" "}
                    <strong className="tabular-nums">{viewStock.afterExpiry.toLocaleString()} {viewRow.uom}</strong>
                    {viewStock.reorder > 0 && <> against a reorder level of <strong className="tabular-nums">{viewStock.reorder.toLocaleString()}</strong></>}
                    , so supply chain is told to buy replacement stock before it expires. A{" "}
                    <strong>Purchase Requisition</strong>
                    {viewRow.level === "Critical" && <> flagged <strong>Urgent</strong></>} is raised — it goes to
                    Approval Management under Purchase Req. and then follows the standard purchase flow.
                  </p>
                ) : reviews[viewRow.id]?.prRef ? (
                  <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
                    Already escalated to supply chain as{" "}
                    <button
                      type="button"
                      onClick={() => goToPurchaseRequisition(reviews[viewRow.id]!.prRef!)}
                      className="cursor-pointer border-0 bg-transparent p-0 font-mono font-semibold text-blue-900 underline underline-offset-2 hover:text-blue-700"
                      title="Open in Purchase Requisition"
                    >
                      {reviews[viewRow.id]?.prRef}
                    </button>{" "}
                    — track it in Purchase Requisition and Approval Management.
                  </p>
                ) : (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {viewRow.level === "Critical" || viewRow.level === "Near Expiry"
                      ? <>Stock stays above the reorder level after this lot expires ({viewStock.afterExpiry.toLocaleString()} {viewRow.uom} vs {viewStock.reorder.toLocaleString()}), so no replacement purchase is needed.</>
                      : <>No escalation applies at this alert level. Disposal is for expired lots; purchase requisitions are for Critical and Near Expiry lots.</>}
                  </p>
                )}
                {viewRow.updatedAt && (
                  <p className="text-[11px] text-muted-foreground">
                    Last updated by <span className="font-medium text-foreground">{viewRow.updatedBy || "—"}</span> on {viewRow.updatedAt}
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setViewRow(null)}>Close</Button>
              {/* Disposal is only ever offered for expired stock; stock that is
                  merely close to expiry is replenished instead. */}
              {viewIsExpired ? (
                <Button onClick={escalateToWastage} disabled={isEscalated}>
                  <Trash2 className="mr-1 h-4 w-4" /> Escalate To Wastage
                </Button>
              ) : (
                <Button
                  onClick={() => viewRow && escalateToPR([viewRow])}
                  disabled={!viewCanRaisePR}
                  title={viewCanRaisePR
                    ? `Raise a purchase requisition to replace this lot${viewRow.level === "Critical" ? " (flagged Urgent)" : ""}`
                    : reviews[viewRow.id]?.prRef
                      ? `Already escalated as ${reviews[viewRow.id]?.prRef}`
                      : "Available for Critical / Near Expiry lots that leave stock below the reorder level"}
                >
                  <Send className="mr-1 h-4 w-4" /> Escalate To Purchase Requisition
                  {viewRow.level === "Critical" && viewCanRaisePR && (
                    <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">Urgent</span>
                  )}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
