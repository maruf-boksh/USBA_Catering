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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Replace, Search, AlertTriangle, ShieldAlert, Factory, Truck,
  LayoutGrid, CheckCircle2, CornerUpLeft, Eye, X as CloseIcon, Receipt, Plus,
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
const MANUAL_TYPES = [
  "Aircraft Swap",
  "PAX Change",
  "Special Meal Change",
  "Flight Cancellation",
  "Nil Catering / Offload",
  "Schedule / Delay",
  "Extra / Reduced Crew",
  "Other",
] as const;
type ManualType = typeof MANUAL_TYPES[number];

const MANUAL_DEFAULT_SEV: Record<ManualType, LmcSeverity> = {
  "Aircraft Swap": "critical",
  "PAX Change": "critical",
  "Special Meal Change": "critical",
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

export type ManualLmc = {
  id: string;
  at: string;
  by: string;
  role: string;
  flight: string;
  orderNo?: string;
  sector?: string;
  type: ManualType;
  from?: string;
  to?: string;
  reason: string;
  severity: LmcSeverity;
  leadHours: number | null;
};

// ── Cross-module contract (Approval Management + Accounts) ────────────────────
// Critical LMCs are routed through Approval Management (Phase 3) and, once
// approved, are billable last-minute changes surfaced in Accounts. The approval
// decision is a light persisted overlay keyed by LMC id — it never mutates the
// amendment history.
export const LMC_MANUAL_KEY = "lmc-manual";
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

function readManualLmc(): ManualLmc[] {
  try {
    const raw = window.localStorage.getItem(`harvest-data-v1:${LMC_MANUAL_KEY}`);
    return raw ? (JSON.parse(raw) as ManualLmc[]) : [];
  } catch {
    return [];
  }
}

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

  const saveManual = (m: ManualLmc) => {
    setManual((prev) => [m, ...prev]);
    setLogOpen(false);
    toast.success(`LMC logged — ${m.type} on ${m.flight}.`);
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
  onSave: (m: ManualLmc) => void;
}) {
  const [flight, setFlight] = useState("");
  const [type, setType] = useState<ManualType>("Aircraft Swap");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [severity, setSeverity] = useState<LmcSeverity>(MANUAL_DEFAULT_SEV["Aircraft Swap"]);
  const [sevTouched, setSevTouched] = useState(false);
  const [aircraftRows] = usePersistedState<Aircraft[]>("config-aircraft-rows", aircraftFleet);
  const aircraftOptions = useMemo(
    () => aircraftRows.filter((a) => a.status === "Active").map((a) => `${a.type} (${a.registration})`),
    [aircraftRows],
  );

  const match = flightOptions.find((f) => f.flight === flight);
  const ft = MANUAL_FT[type];
  const orderField = MANUAL_ORDER_FIELD[type];

  // For an order-field change the "was" side is the order's real value — read-only
  // ground truth. Mirror the selected flight's current figure into `from` whenever
  // the flight or type changes. Free-entry types (aircraft / other) are left alone
  // so the user's typed value survives a flight switch (onType clears on retype).
  useEffect(() => {
    if (!orderField) return;
    setFrom(match ? String(match[orderField] ?? "") : "");
    // match is derived from `flight`; `flightOptions` refreshes when an order changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight, type, flightOptions]);

  // Order-field changes are classified by the amendment engine (lead time × impact),
  // so the manual Severity control doesn't apply — surface the value it will get.
  const derivedSeverity: LmcSeverity | null =
    orderField && match
      ? (isLmcLead(leadHoursToDeparture({ date: match.date, etd: match.etd })) ? "critical" : "minor")
      : null;

  const onType = (t: ManualType) => {
    setType(t);
    if (!sevTouched) setSeverity(MANUAL_DEFAULT_SEV[t]); // auto-follow type until user overrides
    // Control changes with the type — clear both sides. The effect re-fills the
    // "was" side for order-field types; free-entry types start blank.
    setFrom("");
    setTo("");
  };

  // Render the from/to value control appropriate to the selected type.
  const renderValueField = (which: "from" | "to") => {
    const val = which === "from" ? from : to;
    const setVal = which === "from" ? setFrom : setTo;
    const label = which === "from" ? ft.fromLabel : ft.toLabel;
    // The "was" side of an order-field change is locked to the order's real value.
    if (which === "from" && orderField) {
      return (
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
          <Input value={val} readOnly disabled placeholder={match ? "" : "Select a flight first"} className="h-9 mt-1 text-sm bg-muted/50" />
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
    if (!flight.trim()) { toast.error("Pick or enter a flight."); return; }
    if (!reason.trim()) { toast.error("A reason is required for a last-minute change."); return; }
    const user = getAuthUser();

    // Order-field change → run it through the amendment engine so the order's real
    // figures update and it flows into the same worklist / Approval / Accounts path
    // as any in-window Order Management edit (rather than a disconnected note).
    if (orderField) {
      if (!match) { toast.error("That flight has no order to amend."); return; }
      if (!to.trim()) { toast.error("Enter the new value."); return; }
      let patch: Partial<FlightOrder>;
      if (orderField === "etd") {
        patch = { etd: to.trim() };
      } else {
        const n = Number(to);
        if (!Number.isFinite(n) || n < 0) { toast.error("Enter a valid number."); return; }
        patch = { [orderField]: n } as Partial<FlightOrder>;
      }
      const rev = amendOrder(match.id, patch, {
        by: user?.name ?? "—",
        role: user?.role ?? "Operations",
        reason: reason.trim(),
      });
      if (!rev) { toast.info("No change — that already matches the current order."); return; }
      toast.success(`${type} on ${flight} — order amended${rev.isLmc ? " (last-minute change)" : ""}.`);
      onClose();
      return;
    }

    // Non-order operational event (aircraft swap, cancellation, nil-catering, other)
    // — no order field to touch, so keep it as a standalone manual LMC log entry.
    const leadHours = match ? leadHoursToDeparture({ date: match.date, etd: match.etd }) : null;
    onSave({
      id: `MLMC-${Date.now().toString(36)}`,
      at: new Date().toISOString(),
      by: user?.name ?? "—",
      role: user?.role ?? "Operations",
      flight: flight.trim(),
      orderNo: match?.orderNo,
      sector: match?.sector,
      type,
      from: from.trim() || undefined,
      to: to.trim() || undefined,
      reason: reason.trim(),
      severity,
      leadHours,
    });
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-lg p-0 overflow-hidden">
        <div className="bg-white text-slate-900 border-b px-6 py-4">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Operations</p>
          <h2 className="text-lg font-bold mt-0.5">Log Last-Minute Change</h2>
          <p className="text-xs text-slate-500 mt-0.5">Record an operational LMC that isn't an order edit — aircraft swap, cancellation, nil-catering, delay.</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Flight</label>
            <Select value={flight} onValueChange={setFlight}>
              <SelectTrigger className="h-9 mt-1 text-sm">
                <SelectValue placeholder="Select flight" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {flightOptions.map((f) => (
                  <SelectItem key={f.flight} value={f.flight}>
                    <span className="font-medium">{f.flight}</span>
                    <span className="text-muted-foreground ml-2">{`${f.sector} · ${f.orderNo}`}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1 h-4">
              {match ? `${match.sector} · ${match.orderNo} · STD ${match.etd}` : ""}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Type</label>
              <Select value={type} onValueChange={(v) => onType(v as ManualType)}>
                <SelectTrigger className="h-9 mt-1 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MANUAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Severity</label>
              {orderField ? (
                <div className="h-9 mt-1 flex items-center gap-2 rounded-md border border-input bg-muted/50 px-3">
                  <Badge variant="outline" className={`h-5 px-1.5 text-[10px] font-bold uppercase ${SEVERITY_META[derivedSeverity ?? "minor"].cls}`}>
                    {SEVERITY_META[derivedSeverity ?? "minor"].label}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">auto · from lead time</span>
                </div>
              ) : (
                <Select value={severity} onValueChange={(v) => { setSeverity(v as LmcSeverity); setSevTouched(true); }}>
                  <SelectTrigger className="h-9 mt-1 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["critical", "major", "minor", "info"] as LmcSeverity[]).map((s) => (
                      <SelectItem key={s} value={s}>{SEVERITY_META[s].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {ft.show && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {renderValueField("from")}
              {renderValueField("to")}
            </div>
          )}

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reason <span className="text-rose-500">(required)</span></label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the change — feeds the audit trail" className="h-9 mt-1 text-sm" />
          </div>
        </div>
        <div className="border-t bg-white px-6 py-3 flex items-center justify-end gap-2">
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
