import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Replace, Search, AlertTriangle, ShieldAlert, Factory, Truck,
  LayoutGrid, CheckCircle2, CornerUpLeft, Eye, X as CloseIcon, Receipt, Plus,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { ListExportActions } from "@/components/common/ListExportActions";
import { filterMeta as listExportFilterMeta } from "@/lib/list-export";
import { usePersistedState } from "@/lib/use-persisted-state";
import {
  getAllAmendments, getFlightOrders, useFlightOrders, amendOrder,
  leadHoursToDeparture, isLmcLead, getLmcWindowHours, setLmcWindowHours,
  type OrderAmendment, type LmcSeverity, type FlightOrder,
} from "@/lib/flight-orders-store";
import { productionOrders, aircraftFleet, type Aircraft } from "@/lib/sample-data";
import { getAuthUser } from "@/lib/auth";
import {
  MANUAL_TYPES, readManualLmc, LMC_MANUAL_KEY,
  type ManualLmc, type ManualType,
} from "@/lib/lmc-manual";
import { INITIAL_RECORDS, type DispatchRecord } from "@/routes/dispatch";
import { flights, loadGalleyRecords } from "@/routes/dispatch-monitoring";

// ─────────────────────────────────────────────────────────────────────────────
// Last Minute Change (LMC) — Control Tower.
//
// Two feeds converge into one worklist:
//  1. AUTO — every in-window order edit recorded by the amendment engine
//     (flight-orders-store.ts) as an OrderAmendment (isLmc + severity).
//  2. MANUAL — operational LMC events that aren't order-field edits (aircraft
//     swap, flight cancellation, nil-catering / offload, delay, crew change),
//     logged here and persisted to "lmc-manual".
//
// For each change the duty officer sees HOW FAR DOWNSTREAM it caught the
// operation (Production / Dispatch / Galley) and works it to closure
// (Open → Assessing → Actioned → Closed). Work-status is a light local overlay
// keyed by change id — it never mutates the amendment history.
// ─────────────────────────────────────────────────────────────────────────────

type WorkStatus = "actioned" | "closed"; // absent ⇒ "open"

const SEVERITY_META: Record<LmcSeverity, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "bg-rose-100 text-rose-700 border-rose-200" },
  major:    { label: "Major",    cls: "bg-orange-100 text-orange-700 border-orange-200" },
  minor:    { label: "Minor",    cls: "bg-sky-100 text-sky-700 border-sky-200" },
  info:     { label: "Info",     cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

const WORK_META: Record<"open" | WorkStatus, { label: string; cls: string }> = {
  open:      { label: "Open",      cls: "bg-rose-50 text-rose-700 border-rose-300" },
  actioned:  { label: "Actioned",  cls: "bg-sky-50 text-sky-700 border-sky-300" },
  closed:    { label: "Closed",    cls: "bg-emerald-50 text-emerald-700 border-emerald-300" },
};

const APPROVAL_BADGE: Record<"awaiting" | "rejected", { label: string; cls: string }> = {
  awaiting: { label: "Awaiting Approval", cls: "bg-amber-50 text-amber-700 border-amber-300" },
  rejected: { label: "Rejected",          cls: "bg-rose-100 text-rose-700 border-rose-300" },
};

// ── Manual LMC events (non-edit) ──────────────────────────────────────────────
// The type list, record shape and storage live in lib/lmc-manual.ts so other
// modules can RAISE an entry (Galley Planning raises one for a dish swap)
// without importing this page — which imports Galley Planning in turn.
const MANUAL_DEFAULT_SEV: Record<ManualType, LmcSeverity> = {
  "Aircraft Swap": "critical",
  "PAX Change": "critical",
  "Special Meal Change": "critical",
  "Meal Change": "critical",
  "Flight Cancellation": "critical",
  "Nil Catering / Offload": "critical",
  "Schedule / Delay": "major",
  "Extra / Reduced Crew": "major",
  "Other": "minor",
};
// Type-aware from → to capture. `kind` picks the control (dropdown / time /
// number / text); `show:false` hides the pair entirely for types whose Type +
// Reason already say everything (cancellation, nil-catering).
type FtKind = "aircraft" | "time" | "number" | "text";
const MANUAL_FT: Record<ManualType, { show: boolean; kind: FtKind; fromLabel: string; toLabel: string }> = {
  "Aircraft Swap":          { show: true,  kind: "aircraft", fromLabel: "From aircraft", toLabel: "To aircraft" },
  "PAX Change":             { show: true,  kind: "number",   fromLabel: "PAX was", toLabel: "PAX now" },
  "Special Meal Change":    { show: true,  kind: "number",   fromLabel: "Special meals was", toLabel: "Special meals now" },
  "Meal Change":            { show: true,  kind: "text",     fromLabel: "Dish was", toLabel: "Dish now" },
  "Flight Cancellation":    { show: false, kind: "text",     fromLabel: "", toLabel: "" },
  "Nil Catering / Offload": { show: false, kind: "text",     fromLabel: "", toLabel: "" },
  "Schedule / Delay":       { show: true,  kind: "time",     fromLabel: "Scheduled STD", toLabel: "Revised STD" },
  "Extra / Reduced Crew":   { show: true,  kind: "number",   fromLabel: "Crew was", toLabel: "Crew now" },
  "Other":                  { show: true,  kind: "text",     fromLabel: "From (was)", toLabel: "To (now)" },
};

// Manual types that ARE order-field edits. These are routed through the amendment
// engine (amendOrder) — updating the order's real figures and flowing into the
// unified LMC worklist + Approval Management + Accounts exactly like an in-window
// Order Management edit — instead of being stored as a standalone note. The rest
// (Aircraft Swap, Cancellation, Nil Catering, Other) have no order field and stay
// as manual log entries.
const MANUAL_ORDER_FIELD: Partial<Record<ManualType, "pax" | "crew" | "specialMeals" | "etd">> = {
  "PAX Change": "pax",
  "Special Meal Change": "specialMeals",
  "Extra / Reduced Crew": "crew",
  "Schedule / Delay": "etd",
};

// One flight in the Log LMC picker — the order id + current figures ride along so
// the form can read real values and amend the exact order behind the flight.
type FlightOption = {
  id: string; flight: string; sector: string; orderNo: string; date: string; etd: string;
  pax: number; crew: number; specialMeals: number;
};

export type { ManualLmc, ManualType } from "@/lib/lmc-manual";

// ── Cross-module contract (Approval Management + Accounts) ────────────────────
// Critical LMCs are routed through Approval Management (Phase 3) and, once
// approved, are billable last-minute changes surfaced in Accounts. The approval
// decision is a light persisted overlay keyed by LMC id — it never mutates the
// amendment history.
export { LMC_MANUAL_KEY } from "@/lib/lmc-manual";
export const LMC_APPROVALS_KEY = "lmc-approvals";
/** Flat charge applied to a billable (critical) last-minute change. */
export const LMC_CHARGE = 5000;

export type LmcDecision = { status: "Approved" | "Rejected"; by: string; at: string; reason?: string };

/** Flattened critical-LMC record shared with Approval Management / Accounts. */
export type LmcApprovalRow = {
  id: string;
  flight: string;
  sector: string;
  orderNo: string;
  typeLabel: string;
  changeText: string;
  severity: LmcSeverity;
  at: string;
  by: string;
  role: string;
  reason: string;
  leadHours: number | null;
};


// ── Downstream commitment ─────────────────────────────────────────────────────
// "How committed is this leg already?" — the core LMC question. The further a
// change catches the operation, the more it costs to absorb.
type CommitTone = "none" | "planned" | "progress" | "done" | "alert";
type Commit = { state: string; tone: CommitTone; note: string };

const COMMIT_CLS: Record<CommitTone, string> = {
  none:     "bg-slate-50 text-slate-400 border-slate-200",
  planned:  "bg-sky-50 text-sky-700 border-sky-200",
  progress: "bg-amber-50 text-amber-700 border-amber-200",
  done:     "bg-orange-50 text-orange-700 border-orange-200",
  alert:    "bg-rose-50 text-rose-700 border-rose-200",
};

const PROD_DONE = new Set(["Ready for QC", "Approved", "Sent to Packaging", "Completed"]);
const PROD_PROGRESS = new Set(["In Preparation", "Cooking"]);

function prodCommit(flight: string): Commit {
  const orders = productionOrders.filter((p) => p.flight === flight);
  if (orders.length === 0) return { state: "—", tone: "none", note: "No production order raised — safe to re-plan." };
  if (orders.some((p) => PROD_DONE.has(p.status)))
    return { state: "Produced", tone: "done", note: "Meals already produced — coordinate top-up or record wastage." };
  if (orders.some((p) => PROD_PROGRESS.has(p.status)))
    return { state: "In production", tone: "progress", note: "Production in progress — flag the kitchen to adjust the batch." };
  return { state: "Planned", tone: "planned", note: "Production queued (not started) — recompute the order." };
}

function dispCommit(flight: string, records: DispatchRecord[]): Commit {
  const rec = records.find((r) => r.flightNos.includes(flight));
  if (!rec) return { state: "—", tone: "none", note: "Not dispatched — the dispatch snapshot will pick up the new figures." };
  switch (rec.status) {
    case "Dispatched": return { state: "Dispatched", tone: "alert", note: "Already dispatched — arrange a recall / uplift correction at the airport." };
    case "Returned":   return { state: "Returned", tone: "alert", note: "Dispatch returned — re-dispatch the corrected load from the Dispatch page." };
    case "Ready For Dispatch": return { state: "Ready", tone: "done", note: "Packed & ready — re-sync the dispatch before it leaves." };
    default:           return { state: rec.status, tone: "progress", note: "Dispatch being built — re-sync it to the amended order." };
  }
}

function galleyCommit(flight: string, records: ReturnType<typeof loadGalleyRecords>): Commit {
  const flightId = flights.find((f) => f.flight === flight)?.id;
  const rec = flightId ? records.find((r) => r.flightId === flightId) : undefined;
  if (!rec) return { state: "—", tone: "none", note: "No galley plan yet — it will scale to the new figures." };
  if (rec.galleyStatus === "approved" || rec.galleyStatus === "completed" || rec.galleyStatus === "awaiting_approval")
    return { state: "Loaded", tone: "done", note: "Galley loaded — issue a loading-sheet delta for the change." };
  return { state: "In loading", tone: "progress", note: "Galley in loading flow — re-scale and re-QC the load." };
}

// ── Unified queue item (amendment OR manual) ──────────────────────────────────
type QueueItem = {
  id: string;
  kind: "amendment" | "manual";
  at: string; by: string; role: string; reason: string;
  flight: string; sector: string; orderNo: string;
  typeLabel: string;
  changes: { field: string; label: string; from: unknown; to: unknown }[];
  severity: LmcSeverity;
  leadHours: number | null;
  isLmc: boolean;
};

// Primary human label for an order amendment ("PAX", "Special Meals", "Schedule").
const TYPE_RANK: { field: string; label: string }[] = [
  { field: "status", label: "Status / Cancellation" },
  { field: "pax", label: "PAX" },
  { field: "specialMeals", label: "Special Meals" },
  { field: "crew", label: "Crew" },
  { field: "etd", label: "Schedule" },
  { field: "date", label: "Schedule" },
];
function amendmentTypeLabel(a: OrderAmendment): string {
  const fields = new Set(a.changes.map((c) => c.field));
  for (const t of TYPE_RANK) if (fields.has(t.field)) return t.label;
  return a.changes[0]?.label ?? "Amendment";
}

const fmtLead = (h: number | null) => (h == null ? "—" : `${h.toFixed(1)}h to STD`);
const fmtVal = (v: unknown) => (v === "" || v == null ? "—" : String(v));

const changeText = (changes: { label: string; from: unknown; to: unknown }[]): string => {
  const c = changes[0];
  if (!c) return "—";
  const extra = changes.length - 1;
  return `${c.label}: ${fmtVal(c.from)} → ${fmtVal(c.to)}${extra > 0 ? ` +${extra}` : ""}`;
};

/** Critical last-minute changes (auto + manual) that require sign-off. Consumed
 *  by Approval Management (the approval gate) and Accounts (chargeable). Shared
 *  here so the classification lives in one place. */
export function getCriticalLmcsForApproval(): LmcApprovalRow[] {
  const orderById = new Map(getFlightOrders().map((o) => [o.id, o]));
  const fromAmendments: LmcApprovalRow[] = getAllAmendments()
    .filter((a) => a.isLmc && a.severity === "critical")
    .map((a) => {
      const order = orderById.get(a.orderId);
      return {
        id: a.id, flight: order?.flight ?? a.orderId, sector: order?.sector ?? "—",
        orderNo: order?.orderNo ?? "—", typeLabel: amendmentTypeLabel(a),
        changeText: changeText(a.changes), severity: a.severity,
        at: a.at, by: a.by, role: a.role, reason: a.reason, leadHours: a.leadHours,
      };
    });
  const fromManual: LmcApprovalRow[] = readManualLmc()
    .filter((m) => m.severity === "critical")
    .map((m) => ({
      id: m.id, flight: m.flight, sector: m.sector ?? "—", orderNo: m.orderNo ?? "—",
      typeLabel: m.type,
      changeText: (m.from || m.to) ? `${m.type}: ${m.from ?? "—"} → ${m.to ?? "—"}` : m.type,
      severity: m.severity, at: m.at, by: m.by, role: m.role, reason: m.reason, leadHours: m.leadHours,
    }));
  return [...fromAmendments, ...fromManual].sort((x, y) => (x.at < y.at ? 1 : -1));
}

export default function LmcPage() {
  const navigate = useNavigate();
  // Deep-link a change back to its source order in Order Management.
  const openOrder = (orderNo: string) => {
    if (orderNo && orderNo !== "—") navigate(`/order-management?ord=${encodeURIComponent(orderNo)}`);
  };
  const [workStatus, setWorkStatus] = usePersistedState<Record<string, WorkStatus>>("lmc-work-status", {});
  const [manual, setManual] = usePersistedState<ManualLmc[]>(LMC_MANUAL_KEY, []);
  // Approval decisions (read-only here) — critical LMCs are gated on GM sign-off
  // in Approval Management before they can be closed.
  const [lmcDecisions] = usePersistedState<Record<string, LmcDecision>>(LMC_APPROVALS_KEY, {});
  const [dispatchRecords] = usePersistedState<DispatchRecord[]>("dispatch-records", INITIAL_RECORDS);
  const galleyRecords = useMemo(() => loadGalleyRecords(), []);

  const [scope, setScope] = useState<"lmc" | "all">("lmc");
  const [severityFilter, setSeverityFilter] = useState<"all" | LmcSeverity>("all");
  const [query, setQuery] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  // Configurable LMC cut-off (hours) — persisted in the store, read live so new
  // amendments classify against it. Existing records keep the classification
  // they were stamped with (audit integrity).
  const [windowHours, setWindowHours] = useState<number>(() => getLmcWindowHours());
  const applyWindow = (h: number) => {
    const n = Math.min(48, Math.max(0.25, h || getLmcWindowHours()));
    setLmcWindowHours(n);
    setWindowHours(n);
    toast.success(`LMC cut-off set to ${n}h — applies to changes from now on.`);
  };

  // Subscribe to the live order store so a manual LMC that amends an order (see
  // LogLmcDialog) re-renders this worklist immediately with the new amendment.
  const orders = useFlightOrders();
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  // Distinct flights (latest order per flight) — powers the Log LMC picker. Each
  // option carries the order's id + current figures so the picker can prefill the
  // "was" value from real data and route order-field changes through amendOrder.
  const flightOptions = useMemo(() => {
    const m = new Map<string, FlightOption>();
    for (const o of orders) if (!m.has(o.flight)) m.set(o.flight, {
      id: o.id, flight: o.flight, sector: o.sector, orderNo: o.orderNo, date: o.date, etd: o.etd,
      pax: o.pax, crew: o.crew ?? 0, specialMeals: o.specialMeals ?? 0,
    });
    return [...m.values()].sort((a, b) => a.flight.localeCompare(b.flight));
  }, [orders]);

  // Merge both feeds into one worklist, newest first.
  const rows = useMemo(() => {
    const amendmentItems: QueueItem[] = getAllAmendments().map((a) => {
      const order = orderById.get(a.orderId);
      return {
        id: a.id, kind: "amendment", at: a.at, by: a.by, role: a.role, reason: a.reason,
        flight: order?.flight ?? a.orderId, sector: order?.sector ?? "—", orderNo: order?.orderNo ?? "—",
        typeLabel: amendmentTypeLabel(a), changes: a.changes,
        severity: a.severity, leadHours: a.leadHours, isLmc: a.isLmc,
      };
    });
    const manualItems: QueueItem[] = manual.map((m) => ({
      id: m.id, kind: "manual", at: m.at, by: m.by, role: m.role, reason: m.reason,
      flight: m.flight, sector: m.sector ?? "—", orderNo: m.orderNo ?? "—",
      typeLabel: m.type,
      changes: (m.from || m.to) ? [{ field: "manual", label: m.type, from: m.from ?? "—", to: m.to ?? "—" }] : [],
      severity: m.severity, leadHours: m.leadHours, isLmc: true,
    }));

    return [...amendmentItems, ...manualItems]
      .map((it) => {
        // Critical LMCs require GM sign-off (Approval Management) before closure.
        const needsApproval = it.severity === "critical";
        const decision = lmcDecisions[it.id];
        const approval: "n/a" | "awaiting" | "approved" | "rejected" =
          !needsApproval ? "n/a"
          : decision?.status === "Approved" ? "approved"
          : decision?.status === "Rejected" ? "rejected"
          : "awaiting";
        return {
          it,
          // Coerce anything that isn't a live work-state to "open" — this also
          // maps the now-removed legacy "assessing" value from persisted storage.
          status: ((s) => (s === "actioned" || s === "closed" ? s : "open"))(workStatus[it.id]) as "open" | WorkStatus,
          approval,
          decision,
          production: prodCommit(it.flight),
          dispatch: dispCommit(it.flight, dispatchRecords),
          galley: galleyCommit(it.flight, galleyRecords),
        };
      })
      .sort((x, y) => (x.it.at < y.it.at ? 1 : -1));
  }, [orderById, manual, workStatus, lmcDecisions, dispatchRecords, galleyRecords]);

  const scoped = rows.filter((r) => {
    if (scope === "lmc" && !r.it.isLmc) return false;
    if (severityFilter !== "all" && r.it.severity !== severityFilter) return false;
    if (!showClosed && r.status === "closed") return false;
    if (query.trim()) {
      const hay = `${r.it.flight} ${r.it.sector} ${r.it.orderNo} ${r.it.typeLabel} ${r.it.by}`.toLowerCase();
      if (!hay.includes(query.trim().toLowerCase())) return false;
    }
    return true;
  });

  // KPIs are computed over the LMC set (the real worklist), not the filter.
  const lmc = rows.filter((r) => r.it.isLmc);
  const openCount = lmc.filter((r) => r.status === "open").length;
  const criticalCount = lmc.filter((r) => r.it.severity === "critical" && r.status !== "closed").length;
  const majorCount = lmc.filter((r) => r.it.severity === "major" && r.status !== "closed").length;
  const closedCount = lmc.filter((r) => r.status === "closed").length;

  // ── At-a-glance breakdowns for the KPI cards ────────────────────────────────
  // Sub-stage counts so each card reads like the dashboard KPIs: a headline
  // number, a stat pill for the most actionable context, and a small two-column
  // breakdown of what makes up the total (severity mix / work stage / approval).
  const cnt = (pred: (r: (typeof lmc)[number]) => boolean) => lmc.filter(pred).length;
  const openCritical     = cnt((r) => r.status === "open" && r.it.severity === "critical");
  const openMajor        = cnt((r) => r.status === "open" && r.it.severity === "major");
  const openMinor        = cnt((r) => r.status === "open" && r.it.severity === "minor");
  const openInfo         = cnt((r) => r.status === "open" && r.it.severity === "info");
  const criticalOpen     = cnt((r) => r.it.severity === "critical" && r.status === "open");
  const criticalActioned = cnt((r) => r.it.severity === "critical" && r.status === "actioned");
  const criticalAwaiting = cnt((r) => r.it.severity === "critical" && r.approval === "awaiting");
  const criticalApproved = cnt((r) => r.it.severity === "critical" && r.approval === "approved");
  const majorOpen        = cnt((r) => r.it.severity === "major" && r.status === "open");
  const majorActioned    = cnt((r) => r.it.severity === "major" && r.status === "actioned");
  const closedCritical   = cnt((r) => r.status === "closed" && r.it.severity === "critical");
  const closedMajor      = cnt((r) => r.status === "closed" && r.it.severity === "major");
  const closedMinor      = cnt((r) => r.status === "closed" && r.it.severity === "minor");
  const awaitingApproval = cnt((r) => r.approval === "awaiting");

  const setStatus = (id: string, next: WorkStatus | "open") => {
    setWorkStatus((prev) => {
      const copy = { ...prev };
      if (next === "open") delete copy[id];
      else copy[id] = next;
      return copy;
    });
  };

  // One LMC can cover several flights at once (an aircraft swap or a station
  // stoppage hits every leg on the ground), so this takes a batch and logs each
  // as its own entry — the worklist rows stay per-flight exactly as before.
  const saveManual = (list: ManualLmc[]) => {
    if (list.length === 0) return;
    setManual((prev) => [...list, ...prev]);
    setLogOpen(false);
    toast.success(list.length === 1
      ? `LMC logged — ${list[0].type} on ${list[0].flight}.`
      : `LMC logged — ${list[0].type} on ${list.length} flights.`);
  };

  const viewRow = viewId ? rows.find((r) => r.it.id === viewId) : undefined;

  return (
    <>
      <PageHeader
        title="Last Minute Change (LMC)"
        subtitle="Control tower for in-window order changes — triage impact across production, dispatch & galley, then work each change to closure"
        actions={
          <Button onClick={() => setLogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Log LMC
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard
          label="Open LMCs" value={openCount} icon={AlertTriangle}
          tone="amber" variant="aurora"
          sub={`${awaitingApproval} awaiting approval`}
          hint="Last-minute changes still to be worked to closure, by severity."
          breakdown={[
            { label: "Critical", value: openCritical, icon: "🔴" },
            { label: "Major",    value: openMajor,    icon: "🟠" },
            { label: "Minor",    value: openMinor,    icon: "🔵" },
            { label: "Info",     value: openInfo,     icon: "ℹ️" },
          ]}
        />
        <KpiCard
          label="Critical" value={criticalCount} icon={ShieldAlert}
          tone="rose" variant="aurora"
          sub={`${criticalAwaiting} awaiting approval`}
          hint="Critical changes needing GM sign-off before they can close."
          breakdown={[
            { label: "Open",     value: criticalOpen,     icon: "⏳" },
            { label: "Actioned", value: criticalActioned, icon: "⚙️" },
            { label: "Awaiting", value: criticalAwaiting, icon: "📩" },
            { label: "Approved", value: criticalApproved, icon: "✓" },
          ]}
        />
        <KpiCard
          label="Major" value={majorCount} icon={Replace}
          tone="indigo" variant="aurora"
          sub={`${majorOpen} open`}
          hint="Major changes in the window and how far each has been worked."
          breakdown={[
            { label: "Open",     value: majorOpen,     icon: "⏳" },
            { label: "Actioned", value: majorActioned, icon: "⚙️" },
          ]}
        />
        <KpiCard
          label="Closed" value={closedCount} icon={CheckCircle2}
          tone="green" variant="aurora"
          sub={`${lmc.length} total LMCs`}
          hint="Changes fully worked to closure, by original severity."
          breakdown={[
            { label: "Critical", value: closedCritical, icon: "🔴" },
            { label: "Major",    value: closedMajor,    icon: "🟠" },
            { label: "Minor",    value: closedMinor,    icon: "🔵" },
          ]}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative w-full sm:w-64">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search flight, order, change, by…"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
              <SelectTrigger className="h-8 w-full sm:w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lmc">Last-minute only</SelectItem>
                <SelectItem value="all">All amendments</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as typeof severityFilter)}>
              <SelectTrigger className="h-8 w-full sm:w-36 text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                {(["critical", "major", "minor", "info"] as LmcSeverity[]).map((s) => (
                  <SelectItem key={s} value={s}>{SEVERITY_META[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={showClosed ? "default" : "outline"}
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => setShowClosed((v) => !v)}
            >
              {showClosed ? "Showing closed" : "Show closed"}
            </Button>
            <div className="flex items-center gap-1.5 ml-auto">
              <label htmlFor="lmc-cutoff" className="text-[11px] text-muted-foreground whitespace-nowrap">LMC cut-off</label>
              <Input
                id="lmc-cutoff"
                type="number"
                min={0.25}
                max={48}
                step={0.5}
                defaultValue={windowHours}
                onBlur={(e) => applyWindow(Number(e.target.value))}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="h-8 w-16 text-xs tabular-nums"
                title="Hours before departure at or under which an edit counts as a last-minute change"
              />
              <span className="text-[11px] text-muted-foreground">h</span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {scoped.length} change{scoped.length === 1 ? "" : "s"}
            </span>
            <ListExportActions
              table={() => ({
                title: "Last Minute Changes",
                fileName: `lmc-${new Date().toISOString().slice(0, 10)}`,
                meta: listExportFilterMeta([
                  ["Scope", scope === "lmc" ? "Last-minute only" : "All amendments"],
                  ["Severity", severityFilter !== "all" && SEVERITY_META[severityFilter].label],
                  ["Search", query.trim() || false],
                ]),
                columns: ["Flight", "Sector", "Order", "Change", "Severity", "By", "At", "Status", "Approval"],
                rows: scoped.map((r) => [
                  r.it.flight, r.it.sector, r.it.orderNo, r.it.typeLabel,
                  SEVERITY_META[r.it.severity].label, r.it.by, r.it.at.slice(0, 16).replace("T", " "),
                  r.status, r.approval,
                ]),
              })}
            />
          </div>

          <div className="border border-border rounded-md overflow-x-auto">
            <Table className="min-w-[1040px]">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs uppercase tracking-wider">Flight / Leg</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Change</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">From → To</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Severity</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Lead</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Downstream</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scoped.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-12">
                      No {scope === "lmc" ? "last-minute changes" : "amendments"} match the current filters.
                      <span className="block text-xs mt-1">
                        LMCs appear automatically when an order is amended within the cut-off
                        window (≤ {windowHours}h to departure), or use <strong>Log LMC</strong> for aircraft
                        swaps, cancellations &amp; nil-catering.
                      </span>
                    </TableCell>
                  </TableRow>
                ) : scoped.map((r) => {
                  const primary = r.it.changes[0];
                  const extra = r.it.changes.length - 1;
                  return (
                    <TableRow key={r.it.id} className="hover:bg-muted/30">
                      <TableCell>
                        {r.it.orderNo !== "—" ? (
                          <button
                            type="button"
                            className="font-semibold text-sm text-primary hover:underline text-left"
                            title={`Open ${r.it.orderNo} in Order Management`}
                            onClick={() => openOrder(r.it.orderNo)}
                          >
                            {r.it.flight}
                          </button>
                        ) : (
                          <div className="font-semibold text-sm">{r.it.flight}</div>
                        )}
                        <div className="text-[11px] text-muted-foreground">
                          {r.it.sector} ·{" "}
                          {r.it.orderNo !== "—" ? (
                            <button type="button" className="text-primary hover:underline" onClick={() => openOrder(r.it.orderNo)}>
                              {r.it.orderNo}
                            </button>
                          ) : r.it.orderNo}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-medium">{r.it.typeLabel}</span>
                        {r.it.kind === "manual"
                          ? <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-violet-600">Manual</span>
                          : r.it.isLmc && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-rose-600">LMC</span>}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums whitespace-nowrap">
                        {primary ? (
                          <>
                            <span className="text-muted-foreground">{primary.label}:</span>{" "}
                            <span className="line-through text-muted-foreground/70">{fmtVal(primary.from)}</span>
                            {" → "}
                            <span className="font-semibold">{fmtVal(primary.to)}</span>
                            {extra > 0 && <span className="text-muted-foreground"> +{extra}</span>}
                          </>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`h-5 px-1.5 text-[10px] font-bold uppercase ${SEVERITY_META[r.it.severity].cls}`}>
                          {SEVERITY_META[r.it.severity].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums whitespace-nowrap">{fmtLead(r.it.leadHours)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <CommitChip icon={Factory}    commit={r.production} />
                          <CommitChip icon={Truck}      commit={r.dispatch} />
                          <CommitChip icon={LayoutGrid} commit={r.galley} />
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.approval === "awaiting" || r.approval === "rejected" ? (
                          <Badge variant="outline" className={`h-5 px-1.5 text-[10px] font-bold uppercase ${APPROVAL_BADGE[r.approval].cls}`}>
                            {APPROVAL_BADGE[r.approval].label}
                          </Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Badge variant="outline" className={`h-5 px-1.5 text-[10px] font-bold uppercase ${WORK_META[r.status].cls}`}>
                              {WORK_META[r.status].label}
                            </Badge>
                            {r.approval === "approved" && (
                              <span title={`Approved by ${r.decision?.by ?? ""}`} className="text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /></span>
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setViewId(r.it.id)}>
                          <Eye className="h-3 w-3 mr-1" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {viewRow && (
        <Dialog open onOpenChange={(v) => { if (!v) setViewId(null); }}>
          <DialogContent className="w-full max-w-[95vw] lg:max-w-2xl max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
            <div className="bg-white text-slate-900 border-b px-6 py-4 shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
                    Last Minute Change · {viewRow.it.kind === "manual" ? "Manual Log" : "Impact Assessment"}
                  </p>
                  <h2 className="text-lg font-bold mt-0.5">{viewRow.it.flight} <span className="text-slate-500 font-normal text-sm">· {viewRow.it.sector}</span></h2>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                    <Badge variant="outline" className={`h-5 px-1.5 text-[10px] font-bold uppercase ${SEVERITY_META[viewRow.it.severity].cls}`}>{SEVERITY_META[viewRow.it.severity].label}</Badge>
                    <span className="text-slate-500">{viewRow.it.typeLabel}</span>
                    {viewRow.it.orderNo !== "—" ? (
                      <button type="button" className="text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900" onClick={() => openOrder(viewRow.it.orderNo)}>
                        {viewRow.it.orderNo}
                      </button>
                    ) : (
                      <span className="text-slate-500">{viewRow.it.orderNo}</span>
                    )}
                    <span className="text-slate-500 tabular-nums">{fmtLead(viewRow.it.leadHours)}</span>
                    {viewRow.it.severity === "critical" && (
                      <span className="inline-flex items-center gap-1 bg-rose-500/80 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white">
                        <Receipt className="h-3 w-3" /> Chargeable
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setViewId(null)} className="text-slate-400 hover:text-slate-700 p-1 rounded shrink-0"><CloseIcon className="h-5 w-5" /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 mb-2">What Changed</p>
                {viewRow.it.changes.length > 0 ? (
                  <div className="rounded-lg border border-border bg-white divide-y divide-border/60">
                    {viewRow.it.changes.map((c) => (
                      <div key={c.field} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">{c.label}</span>
                        <span className="tabular-nums">
                          <span className="line-through text-muted-foreground/70">{fmtVal(c.from)}</span>
                          <span className="mx-1.5">→</span>
                          <span className="font-semibold">{fmtVal(c.to)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-muted-foreground">
                    {viewRow.it.typeLabel} — see reason below.
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  By <span className="font-medium text-foreground">{viewRow.it.by}</span> ({viewRow.it.role}) · {new Date(viewRow.it.at).toLocaleString()}
                  {viewRow.it.reason && <> · Reason: <span className="italic">{viewRow.it.reason}</span></>}
                </p>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 mb-2">Downstream Impact</p>
                <div className="space-y-2">
                  <ImpactRow icon={Factory}    label="Production" commit={viewRow.production} />
                  <ImpactRow icon={Truck}      label="Dispatch"   commit={viewRow.dispatch} />
                  <ImpactRow icon={LayoutGrid} label="Galley"     commit={viewRow.galley} />
                </div>
              </div>

              {/* Approval gate — critical LMCs need GM sign-off before closure. */}
              {viewRow.approval !== "n/a" && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 mb-2">Approval</p>
                  {viewRow.approval === "awaiting" ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                      <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>Critical last-minute change — <strong>pending GM sign-off</strong> in Approval Management. It can't be closed until approved.</span>
                    </div>
                  ) : viewRow.approval === "rejected" ? (
                    <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                      <div className="font-semibold">Rejected by {viewRow.decision?.by}</div>
                      {viewRow.decision?.reason && <div className="mt-0.5">Reason: <span className="italic">{viewRow.decision.reason}</span></div>}
                      <div className="text-[10px] mt-0.5 opacity-80">{viewRow.decision?.at}</div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>Approved by <strong>{viewRow.decision?.by}</strong> · {viewRow.decision?.at} · <Receipt className="h-3 w-3 inline" /> chargeable ({LMC_CHARGE.toLocaleString()})</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="border-t bg-white px-6 py-3 shrink-0 flex flex-wrap items-center justify-end gap-2">
              <span className="text-[11px] text-muted-foreground mr-auto">
                Status: <span className="font-semibold">
                  {viewRow.approval === "awaiting" ? "Awaiting Approval" : viewRow.approval === "rejected" ? "Rejected" : WORK_META[viewRow.status].label}
                </span>
              </span>
              {viewRow.status === "open" && viewRow.approval !== "awaiting" && viewRow.approval !== "rejected" && (
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setStatus(viewRow.it.id, "actioned"); toast.success("Marked actioned — downstream coordinated."); }}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Actioned
                </Button>
              )}
              {viewRow.status !== "closed" ? (
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                  disabled={viewRow.approval === "awaiting"}
                  title={viewRow.approval === "awaiting" ? "Requires GM approval in Approval Management" : undefined}
                  onClick={() => { setStatus(viewRow.it.id, "closed"); toast.success("LMC closed."); setViewId(null); }}
                >
                  Close LMC
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setStatus(viewRow.it.id, "open"); toast.info("Re-opened."); }}>
                  <CornerUpLeft className="h-3.5 w-3.5 mr-1" /> Re-open
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {logOpen && (
        <LogLmcDialog
          flightOptions={flightOptions}
          onClose={() => setLogOpen(false)}
          onSave={saveManual}
        />
      )}
    </>
  );
}

function LogLmcDialog({
  flightOptions, onClose, onSave,
}: {
  flightOptions: FlightOption[];
  onClose: () => void;
  onSave: (list: ManualLmc[]) => void;
}) {
  /** Every flight this change applies to — one LMC can hit several legs. */
  const [selectedFlights, setSelectedFlights] = useState<string[]>([]);
  /** Change types per flight — a leg can take several at once (an aircraft swap
   *  AND the pax change that came with it), and they differ leg to leg. */
  const [typesByFlight, setTypesByFlight] = useState<Record<string, ManualType[]>>({});
  // Values are captured PER FLIGHT AND TYPE — an aircraft swap, a pax count or a
  // special meal figure is its own change on its own leg.
  const [fromBy, setFromBy] = useState<Record<string, string>>({});
  const [toBy, setToBy] = useState<Record<string, string>>({});
  /** Manual severity per flight+type. Order-field types derive theirs instead. */
  const [sevBy, setSevBy] = useState<Record<string, LmcSeverity>>({});
  const [reason, setReason] = useState("");
  const [aircraftRows] = usePersistedState<Aircraft[]>("config-aircraft-rows", aircraftFleet);
  const aircraftOptions = useMemo(
    () => aircraftRows.filter((a) => a.status === "Active").map((a) => `${a.type} (${a.registration})`),
    [aircraftRows],
  );

  // The picker offers the flights scheduled for TODAY — an LMC is by definition
  // same-day. If nothing is on today's schedule the full list is offered rather
  // than an empty picker, and the caption says which it is showing.
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const todaysFlights = useMemo(
    () => flightOptions.filter((f) => f.date === today),
    [flightOptions, today],
  );
  const dayFlights = todaysFlights.length > 0 ? todaysFlights : flightOptions;

  /** Key for one change: this type, on this leg. */
  const pk = (flight: string, t: ManualType) => `${flight}::${t}`;

  const toggleFlight = (f: string) =>
    setSelectedFlights((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]);
  const selectedMatches = selectedFlights
    .map((f) => flightOptions.find((o) => o.flight === f))
    .filter((o): o is FlightOption => !!o);
  const match = selectedMatches[0];
  const typesOf = (flight: string) => typesByFlight[flight] ?? [];
  const toggleType = (flight: string, t: ManualType) =>
    setTypesByFlight((prev) => {
      const cur = prev[flight] ?? [];
      return { ...prev, [flight]: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] };
    });
  /** Every change being logged: one entry per flight × type. */
  const pairs = selectedMatches.flatMap((m) => typesOf(m.flight).map((t) => ({ m, type: t })));

  // For an order-field change the "was" side is the order's real value — read-only
  // ground truth. Mirror each leg's current figure into its own "was" slot whenever
  // the selection or its types change. Free-entry types (aircraft / other) are left
  // alone so a typed value survives.
  const pairKey = pairs.map((p) => pk(p.m.flight, p.type)).join("|");
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const p of pairs) {
      const field = MANUAL_ORDER_FIELD[p.type];
      if (field) next[pk(p.m.flight, p.type)] = String(p.m[field] ?? "");
    }
    setFromBy((prev) => ({ ...prev, ...next }));
    // pairs is derived from the selection; `flightOptions` refreshes on an order change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey, flightOptions]);

  // Order-field changes are classified by the amendment engine (lead time × impact),
  // so the manual Severity control doesn't apply — surface the value each leg will
  // get. Lead time is per flight, so two legs can land on different severities.
  const severityOf = (m: FlightOption): LmcSeverity =>
    isLmcLead(leadHoursToDeparture({ date: m.date, etd: m.etd })) ? "critical" : "minor";
  /** The severity a given change will be logged with. */
  const sevFor = (m: FlightOption, t: ManualType): LmcSeverity =>
    MANUAL_ORDER_FIELD[t] ? severityOf(m) : (sevBy[pk(m.flight, t)] ?? MANUAL_DEFAULT_SEV[t]);

  // Render the from/to value control appropriate to ONE change — this type on
  // this leg.
  const renderValueField = (which: "from" | "to", f: FlightOption, t: ManualType) => {
    const ft = MANUAL_FT[t];
    const orderField = MANUAL_ORDER_FIELD[t];
    const key = pk(f.flight, t);
    const val = (which === "from" ? fromBy : toBy)[key] ?? "";
    const setVal = (v: string) =>
      (which === "from" ? setFromBy : setToBy)((prev) => ({ ...prev, [key]: v }));
    const label = which === "from" ? ft.fromLabel : ft.toLabel;
    // The "was" side of an order-field change is locked to the order's real value.
    if (which === "from" && orderField) {
      return (
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
          <Input value={val} readOnly disabled className="h-9 mt-1 text-sm bg-muted/50" />
        </div>
      );
    }
    return (
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
        {ft.kind === "aircraft" ? (
          <Select value={val} onValueChange={setVal}>
            <SelectTrigger className="h-9 mt-1 text-sm"><SelectValue placeholder="Select aircraft" /></SelectTrigger>
            <SelectContent>
              {aircraftOptions.length === 0
                ? <SelectItem value="none" disabled>No aircraft configured</SelectItem>
                : aircraftOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : ft.kind === "time" ? (
          <Input type="time" value={val} onChange={(e) => setVal(e.target.value)} className="h-9 mt-1 text-sm" />
        ) : ft.kind === "number" ? (
          <Input type="number" min={0} value={val} onChange={(e) => setVal(e.target.value)} placeholder="0" className="h-9 mt-1 text-sm" />
        ) : (
          <Input value={val} onChange={(e) => setVal(e.target.value)} className="h-9 mt-1 text-sm" />
        )}
      </div>
    );
  };

  const save = () => {
    if (selectedFlights.length === 0) { toast.error("Pick at least one flight."); return; }
    if (!reason.trim()) { toast.error("A reason is required for a last-minute change."); return; }
    const user = getAuthUser();

    const missingType = selectedMatches.filter((m) => typesOf(m.flight).length === 0);
    if (missingType.length > 0) {
      toast.error(`Pick a change type for ${missingType.map((m) => m.flight).join(", ")}.`);
      return;
    }

    // Split the changes by how they are recorded. Order-field changes run through
    // the amendment engine so the order's real figures update and they flow into
    // the same worklist / Approval / Accounts path as any in-window Order
    // Management edit; the rest are standalone operational log entries. A single
    // submission can carry both — one leg swapping aircraft while another drops
    // pax — so each pair is handled on its own terms.
    const orderPairs = pairs.filter((p) => MANUAL_ORDER_FIELD[p.type]);
    const manualPairs = pairs.filter((p) => !MANUAL_ORDER_FIELD[p.type]);

    // Validate every order-field change before touching a single order.
    const patches: Array<{ m: FlightOption; type: ManualType; patch: Partial<FlightOrder> }> = [];
    for (const p of orderPairs) {
      const field = MANUAL_ORDER_FIELD[p.type]!;
      const raw = (toBy[pk(p.m.flight, p.type)] ?? "").trim();
      if (!raw) { toast.error(`Enter the new value for ${p.type} on ${p.m.flight}.`); return; }
      if (field === "etd") {
        patches.push({ m: p.m, type: p.type, patch: { etd: raw } });
      } else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          toast.error(`Enter a valid number for ${p.type} on ${p.m.flight}.`);
          return;
        }
        patches.push({ m: p.m, type: p.type, patch: { [field]: n } as Partial<FlightOrder> });
      }
    }

    // Each change is amended on its own — same engine, same audit trail, one
    // amendment per order field. One already holding the new value is a no-op.
    const amended: string[] = [];
    let anyLmc = false;
    for (const { m, type: t, patch } of patches) {
      const rev = amendOrder(m.id, patch, {
        by: user?.name ?? "—",
        role: user?.role ?? "Operations",
        reason: reason.trim(),
      });
      if (!rev) continue;
      amended.push(`${t} on ${m.flight}`);
      if (rev.isLmc) anyLmc = true;
    }

    const stamp = Date.now().toString(36);
    const entries: ManualLmc[] = manualPairs.map((p, i) => ({
      id: `MLMC-${stamp}-${i}`,
      at: new Date().toISOString(),
      by: user?.name ?? "—",
      role: user?.role ?? "Operations",
      flight: p.m.flight,
      orderNo: p.m.orderNo,
      sector: p.m.sector,
      type: p.type,
      from: (fromBy[pk(p.m.flight, p.type)] ?? "").trim() || undefined,
      to: (toBy[pk(p.m.flight, p.type)] ?? "").trim() || undefined,
      reason: reason.trim(),
      severity: sevFor(p.m, p.type),
      leadHours: leadHoursToDeparture({ date: p.m.date, etd: p.m.etd }),
    }));

    if (amended.length > 0) {
      toast.success(
        `${amended.join(", ")} — order${amended.length === 1 ? "" : "s"} amended` +
        `${anyLmc ? " (last-minute change)" : ""}.`,
      );
    } else if (orderPairs.length > 0 && entries.length === 0) {
      toast.info(orderPairs.length === 1
        ? "No change — that already matches the current order."
        : "No change — those already match the current orders.");
      return;
    }

    // onSave logs the operational entries and closes; with none, close here.
    if (entries.length > 0) onSave(entries);
    else onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      {/* Wide enough for the per-flight cards' two-column value grids, and capped
          at the viewport so a submission covering several legs scrolls in the
          body while the header and the actions stay put. */}
      <DialogContent className="w-full max-w-[95vw] sm:max-w-3xl p-0 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="bg-white text-slate-900 border-b px-6 py-4 shrink-0">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Operations</p>
          <h2 className="text-lg font-bold mt-0.5">Log Last-Minute Change</h2>
          <p className="text-xs text-slate-500 mt-0.5">Record an operational LMC that isn't an order edit — aircraft swap, cancellation, nil-catering, delay.</p>
        </div>
        <div className="px-6 py-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Flight(s)
                {selectedFlights.length > 0 && (
                  <span className="ml-1 font-normal normal-case text-primary">
                    · {selectedFlights.length} selected
                  </span>
                )}
              </label>
              {selectedFlights.length > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedFlights([])}
                >
                  Clear
                </button>
              )}
            </div>
            {/* Multi-select: one operational change often hits several legs at
                once, and each still logs as its own LMC entry. */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="mt-1 h-9 w-full flex items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
                >
                  <span className={selectedFlights.length === 0 ? "text-muted-foreground truncate" : "truncate"}>
                    {selectedFlights.length === 0 ? "Select flight(s)…" : selectedFlights.join(", ")}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-1 max-h-72 overflow-y-auto overscroll-contain"
                onWheel={(e) => e.stopPropagation()}
              >
                {dayFlights.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground">No scheduled flights found.</div>
                ) : dayFlights.map((f) => (
                  <label
                    key={f.flight}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedFlights.includes(f.flight)}
                      onCheckedChange={() => toggleFlight(f.flight)}
                    />
                    <span className="font-medium">{f.flight}</span>
                    <span className="text-muted-foreground text-xs truncate">
                      {`${f.sector} · ${f.orderNo} · STD ${f.etd}`}
                    </span>
                  </label>
                ))}
              </PopoverContent>
            </Popover>
            <p className="text-[11px] text-muted-foreground mt-1 h-4">
              {selectedMatches.length > 1
                ? `${selectedMatches.length} legs — ${selectedMatches.map((m) => m.orderNo).join(", ")}`
                : match
                  ? `${match.sector} · ${match.orderNo} · STD ${match.etd}`
                  : todaysFlights.length > 0
                    ? `Scheduled today · ${today}`
                    : `No flights scheduled today — showing all scheduled flights`}
            </p>
          </div>

          {/* One card per selected leg, prefilled with that flight's own figures.
              Type lives on the card too: a leg can take several changes at once,
              and they differ leg to leg — each is captured, and logged, on its own. */}
          {(
            selectedMatches.length === 0 ? (
              <div className="rounded-md border border-dashed border-input px-3 py-4 text-center text-xs text-muted-foreground">
                Select one or more flights to record their changes.
              </div>
            ) : (
              <div className="space-y-3">
                {selectedMatches.map((f) => {
                  const picked = typesOf(f.flight);
                  return (
                  <div key={f.flight} className="rounded-md border border-input bg-muted/20 overflow-hidden">
                    {/* Tinted leg banner — with several cards stacked, this is
                        what tells you whose change you are editing. */}
                    <div className="flex items-baseline gap-2 flex-wrap bg-sky-50 border-b border-sky-100 px-3 py-2">
                      <span className="text-sm font-semibold text-sky-900">{f.flight}</span>
                      <span className="text-[11px] text-sky-800/80">
                        {f.sector} · {f.orderNo} · STD {f.etd}
                      </span>
                    </div>

                    <div className="p-3 space-y-3">
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Type(s)
                        {picked.length > 0 && (
                          <span className="ml-1 font-normal normal-case text-primary">· {picked.length} selected</span>
                        )}
                      </label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="mt-1 h-9 w-full flex items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
                          >
                            <span className={picked.length === 0 ? "text-muted-foreground truncate" : "truncate"}>
                              {picked.length === 0 ? "Select Change Type" : picked.join(", ")}
                            </span>
                            <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="w-[var(--radix-popover-trigger-width)] p-1 max-h-72 overflow-y-auto overscroll-contain"
                          onWheel={(e) => e.stopPropagation()}
                        >
                          {MANUAL_TYPES.map((t) => (
                            <label
                              key={t}
                              className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded hover:bg-muted/50"
                            >
                              <Checkbox
                                checked={picked.includes(t)}
                                onCheckedChange={() => toggleType(f.flight, t)}
                              />
                              <span>{t}</span>
                            </label>
                          ))}
                        </PopoverContent>
                      </Popover>
                    </div>

                    {/* One block per change on this leg — its own severity and
                        its own before/after values. */}
                    {picked.map((t) => {
                      const tft = MANUAL_FT[t];
                      const tOrderField = MANUAL_ORDER_FIELD[t];
                      const key = pk(f.flight, t);
                      return (
                        <div key={t} className="rounded-md border border-input bg-background p-3 space-y-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs font-semibold">{t}</span>
                            {tOrderField ? (
                              <div className="flex items-center gap-1.5">
                                <Badge variant="outline" className={`h-5 px-1.5 text-[10px] font-bold uppercase ${SEVERITY_META[severityOf(f)].cls}`}>
                                  {SEVERITY_META[severityOf(f)].label}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">auto · from lead time</span>
                              </div>
                            ) : (
                              <Select
                                value={sevBy[key] ?? MANUAL_DEFAULT_SEV[t]}
                                onValueChange={(v) => setSevBy((prev) => ({ ...prev, [key]: v as LmcSeverity }))}
                              >
                                <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {(["critical", "major", "minor", "info"] as LmcSeverity[]).map((s) => (
                                    <SelectItem key={s} value={s}>{SEVERITY_META[s].label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                          {tft.show && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {renderValueField("from", f, t)}
                              {renderValueField("to", f, t)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  </div>
                  );
                })}
              </div>
            )
          )}

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reason <span className="text-rose-500">(required)</span></label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the change — feeds the audit trail" className="h-9 mt-1 text-sm" />
          </div>
        </div>
        <div className="border-t bg-white px-6 py-3 flex items-center justify-end gap-2 shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}><Plus className="h-4 w-4 mr-1" /> Log LMC</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CommitChip({ icon: Icon, commit }: { icon: React.ElementType; commit: Commit }) {
  return (
    <span
      title={`${commit.state} — ${commit.note}`}
      className={`inline-flex items-center gap-1 h-5 px-1.5 rounded border text-[10px] font-medium whitespace-nowrap ${COMMIT_CLS[commit.tone]}`}
    >
      <Icon className="h-2.5 w-2.5" /> {commit.state}
    </span>
  );
}

function ImpactRow({ icon: Icon, label, commit }: { icon: React.ElementType; label: string; commit: Commit }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${COMMIT_CLS[commit.tone]}`}>
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-xs font-semibold">{label} · {commit.state}</div>
        <div className="text-[11px] opacity-90">{commit.note}</div>
      </div>
    </div>
  );
}
