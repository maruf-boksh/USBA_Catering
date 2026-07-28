/**
 * Wastage Analytics — Wastage Management
 *
 * A read-only dashboard over the disposal reports that Damaged Product Disposal
 * creates. It answers the three questions a wastage desk actually asks: how much
 * are we wasting, what is still stuck in the approval queue, and how long has it
 * been stuck. Nothing here mutates a report, an approval step or stock — every
 * row links back to the source report, which stays the single place work happens.
 *
 * The disposal deadline that drives the overdue / ageing figures is configurable
 * from this page (with a change log), and is the only state this module owns.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Trash2, Clock, AlertTriangle, Hourglass, Search, CalendarDays, Eye,
  SlidersHorizontal, History, ExternalLink, Layers, ClipboardCheck, Settings2,
} from "lucide-react";
import { Select as AntSelect, Button as AntButton } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRole } from "@/lib/roles";
import { flagArrival } from "@/lib/arrival-flash";
import { LocationCell } from "@/components/common/LocationPicker";
import {
  DEADLINE_STATUSES, TYPE_LABELS, WASTAGE_STATUSES, WASTAGE_TYPES,
  STATUS_LABELS, CONFIG_FIELD_LABELS,
  ageBuckets, buildAnalyticsRows, buildUnitCostMap, computeKpis, isDate,
  readWastageEntries, setWastageConfig, todayIso, useWastageConfig,
  useWastageConfigLog, validateConfig,
  type DeadlineStatus, type WastageAnalyticsRow, type WastageConfig,
} from "@/lib/wastage-analytics";
import type { WastageStatus, WastageType } from "@/routes/wastage-management";

// ── Presentation helpers ────────────────────────────────────────────────────

const bdt = (n: number) => `৳ ${Math.round(n).toLocaleString()}`;

/** Compact number for KPI breakdown rows (1.2k rather than 1,240). */
const compact = (n: number) =>
  n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString();

function Pill({ text, cls }: { text: string; cls: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
      cls,
    )}>
      {text}
    </span>
  );
}

const TYPE_STYLE: Record<WastageType, string> = {
  "Production":      "bg-orange-100 text-orange-700 border-orange-200",
  "Airport Store":   "bg-sky-100 text-sky-700 border-sky-200",
  "Transfer":        "bg-teal-100 text-teal-700 border-teal-200",
  "Return Item":     "bg-violet-100 text-violet-700 border-violet-200",
  "Expired Product": "bg-rose-100 text-rose-700 border-rose-200",
};

const STATUS_STYLE: Record<WastageStatus, string> = {
  "Pending In-Charge": "bg-amber-100 text-amber-700 border-amber-200",
  "Pending GM":        "bg-blue-100 text-blue-700 border-blue-200",
  "Pending Final":     "bg-violet-100 text-violet-700 border-violet-200",
  "Final Approved":    "bg-emerald-100 text-emerald-700 border-emerald-200",
  "Rejected":          "bg-red-100 text-red-700 border-red-200",
};

const DEADLINE_STYLE: Record<DeadlineStatus, string> = {
  "Within Deadline": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Due Today":       "bg-amber-100 text-amber-700 border-amber-200",
  "Overdue":         "bg-rose-100 text-rose-700 border-rose-200",
  "Closed":          "bg-slate-100 text-slate-600 border-slate-200",
};

/** One line of plain-language context under the deadline pill. */
function deadlineCaption(r: WastageAnalyticsRow): string {
  if (r.deadline === "Closed") return `Closed · ${r.statusLabel}`;
  if (r.deadline === "Overdue") return `${r.overdueBy} d past due (${r.dueDate})`;
  if (r.deadline === "Due Today") return `Due today (${r.dueDate})`;
  return `Due ${r.dueDate}`;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function WastageAnalytics() {
  const navigate = useNavigate();
  const { role } = useRole();
  const config = useWastageConfig();
  const configLog = useWastageConfigLog();

  const today = useMemo(() => todayIso(), []);
  // Reports and costs are read once per mount — this page never writes them.
  const entries = useMemo(() => readWastageEntries(), []);
  const costs = useMemo(() => buildUnitCostMap(), []);

  const rows = useMemo(
    () => buildAnalyticsRows(entries, config, costs, today),
    [entries, config, costs, today],
  );
  const kpi = useMemo(() => computeKpis(rows, config), [rows, config]);
  const buckets = useMemo(() => ageBuckets(config.ageingBucketDays), [config.ageingBucketDays]);

  // ── Filters ───────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState<WastageType | "">("");
  const [statusFilter, setStatusFilter] = useState<WastageStatus | "">("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [bucketFilter, setBucketFilter] = useState("");
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineStatus | "">("");

  const filtersActive =
    !!search || !!fromDate || !!toDate || !!typeFilter || !!statusFilter ||
    !!reasonFilter || !!bucketFilter || !!deadlineFilter;

  const clearFilters = () => {
    setSearch(""); setFromDate(""); setToDate(""); setTypeFilter("");
    setStatusFilter(""); setReasonFilter(""); setBucketFilter(""); setDeadlineFilter("");
  };

  /** Disposal reasons actually present in the data — no dead filter options. */
  const reasons = useMemo(
    () => Array.from(new Set(rows.map((r) => r.reason).filter((x) => x && x !== "—"))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && ![r.id, r.itemName, r.reason, r.preparedBy, r.section, r.batchCode, r.typeLabel]
        .some((v) => String(v).toLowerCase().includes(q))) return false;
      if (fromDate && isDate(r.reportingDate) && r.reportingDate < fromDate) return false;
      if (toDate && isDate(r.reportingDate) && r.reportingDate > toDate) return false;
      if (typeFilter && r.wastageType !== typeFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (reasonFilter && r.reason !== reasonFilter) return false;
      if (bucketFilter && r.bucket !== bucketFilter) return false;
      if (deadlineFilter && r.deadline !== deadlineFilter) return false;
      return true;
    });
  }, [rows, search, fromDate, toDate, typeFilter, statusFilter, reasonFilter, bucketFilter, deadlineFilter]);

  /** Totals for the filtered slice — so a filtered view still adds up. */
  const slice = useMemo(() => ({
    qty: filtered.reduce((s, r) => s + r.qty, 0),
    value: filtered.reduce((s, r) => s + r.value, 0),
    overdue: filtered.filter((r) => r.deadline === "Overdue").length,
  }), [filtered]);

  // ── Deep link back to the source report ───────────────────────────────────
  const openReport = (id: string) => {
    flagArrival({ target: "wastage-list", ids: [id] });
    navigate("/wastage-management");
  };

  // ── Dialogs ───────────────────────────────────────────────────────────────
  const [viewRow, setViewRow] = useState<WastageAnalyticsRow | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [draft, setDraft] = useState<WastageConfig>(config);
  const [cfgReason, setCfgReason] = useState("");

  const openConfig = () => {
    setDraft(config);
    setCfgReason("");
    setCfgOpen(true);
  };

  const cfgErrors = validateConfig(draft);
  const cfgDirty = (Object.keys(CONFIG_FIELD_LABELS) as (keyof WastageConfig)[])
    .some((k) => draft[k] !== config[k]);

  const saveConfig = () => {
    if (cfgErrors.length > 0) { toast.error(cfgErrors[0]); return; }
    if (!cfgDirty) { setCfgOpen(false); return; }
    if (!cfgReason.trim()) { toast.error("Add a reason for the change — it is recorded in the log."); return; }
    setWastageConfig(draft, role, cfgReason);
    setCfgOpen(false);
    toast.success("Wastage configuration updated — the log has been recorded.");
  };

  // ── Table ─────────────────────────────────────────────────────────────────
  const cols: Column<WastageAnalyticsRow>[] = [
    {
      key: "id", header: "Report #",
      render: (r) => (
        <button
          type="button"
          onClick={() => openReport(r.id)}
          className="group text-left leading-tight"
          title={`Open ${r.id} in Damaged Product Disposal`}
        >
          <div className="font-mono text-xs font-semibold text-primary underline decoration-dotted decoration-primary/40 underline-offset-2 group-hover:decoration-primary">
            {r.id}
          </div>
          <div className="text-[10px] text-muted-foreground">{r.preparedBy}</div>
        </button>
      ),
    },
    {
      key: "reportingDate", header: "Reported On",
      render: (r) => <span className="tabular-nums text-xs">{r.reportingDate || "—"}</span>,
    },
    {
      key: "typeLabel", header: "Wastage Type",
      render: (r) => <Pill text={r.typeLabel} cls={TYPE_STYLE[r.wastageType] ?? "bg-slate-100 text-slate-600 border-slate-200"} />,
    },
    {
      key: "itemName", header: "Item",
      render: (r) => (
        <div className="leading-tight">
          <div className="font-medium">{r.itemName}</div>
          <div className="font-mono text-[10px] text-muted-foreground">{r.batchCode}</div>
        </div>
      ),
    },
    {
      key: "warehouseId", header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    {
      key: "qty", header: "Qty Disposed",
      render: (r) => (
        <div className="leading-tight">
          <div className="tabular-nums font-semibold">{r.qty.toLocaleString()} {r.uom}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {r.unitCost > 0 ? bdt(r.value) : "not costed"}
          </div>
        </div>
      ),
    },
    {
      key: "reason", header: "Reason",
      render: (r) => (
        <div className="leading-tight">
          <div className="text-xs">{r.reason}</div>
          <div className="text-[10px] text-muted-foreground">{r.section}</div>
        </div>
      ),
    },
    {
      key: "ageDays", header: "Age (Days)",
      render: (r) => (
        <div className="leading-tight">
          <div className="tabular-nums font-semibold">{r.ageDays}</div>
          <div className="text-[10px] text-muted-foreground">
            {r.bucket ? buckets.find((b) => b.key === r.bucket)?.label : "closed"}
          </div>
        </div>
      ),
    },
    {
      key: "deadline", header: "Deadline Status",
      render: (r) => (
        <div className="leading-tight">
          <Pill text={r.deadline} cls={DEADLINE_STYLE[r.deadline]} />
          <div className="mt-0.5 text-[10px] text-muted-foreground">{deadlineCaption(r)}</div>
        </div>
      ),
    },
    {
      key: "statusLabel", header: "Status",
      render: (r) => <Pill text={r.statusLabel} cls={STATUS_STYLE[r.status] ?? ""} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Wastage Analytics"
        subtitle="Wastage volume, value, approval-queue ageing and disposal-deadline performance across every wastage report"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Current (Wastage Disposal Deadline):{" "}
              <strong className="tabular-nums text-foreground">{config.disposalDeadlineDays}</strong> (In Days)
            </span>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-amber-600 text-xs hover:bg-amber-700"
              onClick={openConfig}
            >
              <Settings2 className="h-3.5 w-3.5" /> Deadline Configuration
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setLogOpen(true)}
            >
              <History className="h-3.5 w-3.5" /> Configuration Log
              {configLog.length > 0 && (
                <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums">
                  {configLog.length}
                </span>
              )}
            </Button>
          </div>
        }
      />

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Total Wastage" value={kpi.total.toLocaleString()} icon={Trash2}
          tone="violet" variant="aurora"
          sub={bdt(kpi.totalValue)}
          breakdown={[
            { label: "Items Wasted", value: kpi.items, icon: "📦" },
            { label: "Sections Involved", value: kpi.sections, icon: "🏭" },
            { label: "Total Qty", value: compact(kpi.totalQty), icon: "⚖️" },
            { label: "Disposed (Handover)", value: kpi.disposed, icon: "✅" },
          ]}
        />
        <KpiCard
          label="Pending Disposal" value={kpi.pending.toLocaleString()} icon={Clock}
          tone="amber" variant="aurora"
          sub={`${compact(kpi.pendingQty)} units held`}
          breakdown={[
            { label: "Pending In-Charge", value: kpi.byStage[0].count, icon: "👤" },
            { label: "Pending GM", value: kpi.byStage[1].count, icon: "👔" },
            { label: "Admin Handover", value: kpi.adminHandover, icon: "🏛️" },
            { label: "Rejected", value: kpi.rejected, icon: "⛔" },
          ]}
        />
        <KpiCard
          label="Overdue Wastage" value={kpi.overdue.toLocaleString()} icon={AlertTriangle}
          tone="rose" variant="aurora"
          sub={`past ${config.disposalDeadlineDays} d deadline`}
          breakdown={[
            { label: "Items Overdue", value: kpi.overdueItems, icon: "📦" },
            { label: "Overdue Qty", value: compact(kpi.overdueQty), icon: "⚖️" },
            { label: "Value at Risk", value: bdt(kpi.overdueValue), icon: "💰" },
            { label: "High-Value Reports", value: kpi.highValue, icon: "🚨" },
          ]}
        />
        <KpiCard
          label="Wastage Ageing" value={`${kpi.oldestAge} d`} icon={Hourglass}
          tone="blue" variant="aurora"
          sub={`${kpi.pending} in queue`}
          breakdown={kpi.buckets.map((b, i) => ({
            label: b.label,
            value: `${b.reports}/${b.items}`,
            icon: ["🟢", "🔵", "🟠", "🔴", "⏳"][i] ?? "•",
          }))}
        />
      </div>

      <p className="mb-4 text-[11px] text-muted-foreground">
        Ageing bands count pending reports only, shown as{" "}
        <strong className="text-foreground">reports / items</strong>. Values are the disposal
        quantity costed at the item&apos;s store cost; items with no cost basis show as
        &ldquo;not costed&rdquo;.
      </p>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search report, item, reason, section…"
            className="h-7 w-full min-w-0 sm:w-60 border-0 px-1 text-xs shadow-none focus-visible:ring-0"
            aria-label="Search wastage reports"
          />
        </div>

        <div className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
          <CalendarDays className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="field-label">Reported</span>
          <Input
            type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            className="h-7 w-[8.5rem] border-0 px-1 text-xs tabular-nums shadow-none focus-visible:ring-0"
            aria-label="Reported from date"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            className="h-7 w-[8.5rem] border-0 px-1 text-xs tabular-nums shadow-none focus-visible:ring-0"
            aria-label="Reported to date"
          />
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
          <Layers className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="field-label">Wastage Type</span>
          <AntSelect
            value={typeFilter} onChange={(v: WastageType | "") => setTypeFilter(v)}
            size="small" variant="borderless" style={{ minWidth: 175 }}
            options={[
              { value: "", label: "All" },
              ...WASTAGE_TYPES.map((t) => ({
                value: t,
                label: `${TYPE_LABELS[t]} (${rows.filter((r) => r.wastageType === t).length})`,
              })),
            ]}
          />
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
          <ClipboardCheck className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="field-label">Status</span>
          <AntSelect
            value={statusFilter} onChange={(v: WastageStatus | "") => setStatusFilter(v)}
            size="small" variant="borderless" style={{ minWidth: 175 }}
            options={[
              { value: "", label: "All" },
              ...WASTAGE_STATUSES.map((s) => ({
                value: s,
                label: `${STATUS_LABELS[s]} (${rows.filter((r) => r.status === s).length})`,
              })),
            ]}
          />
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
          <Trash2 className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="field-label">Reason</span>
          <AntSelect
            value={reasonFilter} onChange={(v: string) => setReasonFilter(v)}
            size="small" variant="borderless" style={{ minWidth: 165 }}
            options={[
              { value: "", label: "All" },
              ...reasons.map((r) => ({
                value: r,
                label: `${r} (${rows.filter((x) => x.reason === r).length})`,
              })),
            ]}
          />
        </div>

        {/* Ageing — how long a pending report has waited since it was raised. */}
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
          <Hourglass className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="field-label">Ageing</span>
          <AntSelect
            value={bucketFilter} onChange={(v: string) => setBucketFilter(v)}
            size="small" variant="borderless" style={{ minWidth: 150 }}
            options={[
              { value: "", label: "All" },
              ...buckets.map((b) => ({
                value: b.key,
                label: `${b.label} (${rows.filter((r) => r.bucket === b.key).length})`,
              })),
            ]}
          />
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
          <AlertTriangle className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="field-label">Deadline</span>
          <AntSelect
            value={deadlineFilter} onChange={(v: DeadlineStatus | "") => setDeadlineFilter(v)}
            size="small" variant="borderless" style={{ minWidth: 160 }}
            options={[
              { value: "", label: "All" },
              ...DEADLINE_STATUSES.map((d) => ({
                value: d,
                label: `${d} (${rows.filter((r) => r.deadline === d).length})`,
              })),
            ]}
          />
        </div>

        {filtersActive && (
          <AntButton
            size="small" type="text" icon={<CloseOutlined />}
            onClick={clearFilters}
            style={{ color: "var(--color-muted-foreground)" }}
          >
            Clear
          </AntButton>
        )}
      </div>

      {/* Filtered totals — keeps the numbers honest once a filter is on. */}
      {filtered.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {filtered.length.toLocaleString()} report{filtered.length === 1 ? "" : "s"}
          </span>
          <span><strong className="tabular-nums text-foreground">{slice.qty.toLocaleString()}</strong> units disposed</span>
          <span><strong className="tabular-nums text-foreground">{bdt(slice.value)}</strong> wastage value</span>
          {slice.overdue > 0 && (
            <span className="text-rose-700">
              <strong className="tabular-nums">{slice.overdue}</strong> past the{" "}
              {config.disposalDeadlineDays}-day disposal deadline
            </span>
          )}
        </div>
      )}

      {/* Wide tracker — scrolls inside its own container on narrow screens. */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="min-w-[1150px]">
          <DataTable
            title="wastage-analytics"
            data={filtered}
            columns={cols}
            searchKeys={["id", "itemName", "reason", "preparedBy", "typeLabel", "statusLabel"]}
            selectable={false}
            pageSize={10}
            actions={(row) => (
              <div className="flex items-center gap-1">
                <Button
                  size="icon" variant="outline" className="h-7 w-7"
                  onClick={() => setViewRow(row)}
                  title="View analytics detail"
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          />
        </div>
      </div>

      {/* ── View detail ───────────────────────────────────────────────────── */}
      <Dialog open={!!viewRow} onOpenChange={(o) => !o && setViewRow(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {viewRow && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{viewRow.id}</span>
                  <Pill text={viewRow.typeLabel} cls={TYPE_STYLE[viewRow.wastageType] ?? ""} />
                  <Pill text={viewRow.statusLabel} cls={STATUS_STYLE[viewRow.status] ?? ""} />
                </DialogTitle>
                <DialogDescription>
                  Read-only analytics view. Reviews and approvals stay in Damaged Product Disposal.
                </DialogDescription>
              </DialogHeader>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <tbody>
                    {([
                      ["Item", viewRow.itemName],
                      ["Batch / Lot", viewRow.batchCode],
                      ["Reported On", viewRow.reportingDate || "—"],
                      ["Disposal Qty", `${viewRow.qty.toLocaleString()} ${viewRow.uom}`],
                      ["Unit Cost", viewRow.unitCost > 0 ? bdt(viewRow.unitCost) : "No cost basis"],
                      ["Wastage Value", viewRow.unitCost > 0 ? bdt(viewRow.value) : "Not costed"],
                      ["Recovered (Salvage Sale)", viewRow.recovered > 0 ? bdt(viewRow.recovered) : "—"],
                      ["Compensation Charged", viewRow.penalty > 0 ? bdt(viewRow.penalty) : "—"],
                      ["Disposal Reason", viewRow.reason],
                      ["Disposal Method", viewRow.method],
                      ["Section", viewRow.section],
                      ["Prepared By", viewRow.preparedBy],
                      ["Age", `${viewRow.ageDays} day${viewRow.ageDays === 1 ? "" : "s"} since reporting`],
                      ["Disposal Due By", viewRow.dueDate || "—"],
                      ["Deadline Status", deadlineCaption(viewRow)],
                    ] as [string, string][]).map(([k, v]) => (
                      <tr key={k} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">{k}</td>
                        <td className="py-1.5 text-xs font-medium">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {viewRow.highValue && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  <strong>High-value wastage.</strong> This report is worth{" "}
                  {bdt(viewRow.value)}, at or above the {bdt(config.highValueThreshold)} threshold
                  set in the wastage configuration.
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setViewRow(null)}>Close</Button>
                <Button onClick={() => { const id = viewRow.id; setViewRow(null); openReport(id); }}>
                  <ExternalLink className="mr-1 h-4 w-4" /> Open Disposal Report
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Deadline configuration ────────────────────────────────────────── */}
      <Dialog open={cfgOpen} onOpenChange={setCfgOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" /> Wastage Configuration
            </DialogTitle>
            <DialogDescription>
              These settings drive the overdue and ageing figures on this dashboard only.
              They never change how a wastage report is raised, approved or disposed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{CONFIG_FIELD_LABELS.disposalDeadlineDays}</Label>
              <Input
                type="number" min={1} max={90}
                value={draft.disposalDeadlineDays}
                onChange={(e) => setDraft({ ...draft, disposalDeadlineDays: Number(e.target.value) })}
                className="h-8 text-sm tabular-nums"
              />
              <p className="text-[11px] text-muted-foreground">
                How many days a wastage report may stay in the approval queue before it is
                counted as overdue. Currently{" "}
                <strong className="text-foreground">{config.disposalDeadlineDays}</strong> day
                {config.disposalDeadlineDays === 1 ? "" : "s"}.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{CONFIG_FIELD_LABELS.ageingBucketDays}</Label>
              <Input
                type="number" min={1} max={30}
                value={draft.ageingBucketDays}
                onChange={(e) => setDraft({ ...draft, ageingBucketDays: Number(e.target.value) })}
                className="h-8 text-sm tabular-nums"
              />
              <p className="text-[11px] text-muted-foreground">
                Width of each ageing band. At{" "}
                <strong className="text-foreground">{draft.ageingBucketDays || 1}</strong> the bands read{" "}
                {ageBuckets(draft.ageingBucketDays || 1).map((b) => b.label.replace(" Days", "")).join(" · ")} Days.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{CONFIG_FIELD_LABELS.highValueThreshold}</Label>
              <Input
                type="number" min={0}
                value={draft.highValueThreshold}
                onChange={(e) => setDraft({ ...draft, highValueThreshold: Number(e.target.value) })}
                className="h-8 text-sm tabular-nums"
              />
              <p className="text-[11px] text-muted-foreground">
                A report worth this much or more is flagged as high-value wastage so it gets
                a closer look.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Reason for Change {cfgDirty && <span className="text-destructive">*</span>}
              </Label>
              <Textarea
                value={cfgReason}
                onChange={(e) => setCfgReason(e.target.value)}
                placeholder="Why is this being changed? Recorded in the configuration log."
                className="min-h-[64px] text-sm"
              />
            </div>

            {cfgErrors.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <ul className="list-disc pl-4 space-y-0.5">
                  {cfgErrors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCfgOpen(false)}>Cancel</Button>
            <Button onClick={saveConfig} disabled={cfgErrors.length > 0 || !cfgDirty}>
              Save Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Configuration log ─────────────────────────────────────────────── */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" /> Configuration Log
            </DialogTitle>
            <DialogDescription>
              Every change to the wastage configuration — most recent first.
            </DialogDescription>
          </DialogHeader>

          {configLog.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No changes recorded yet. The current settings are the system defaults.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    {["When", "Changed By", "Setting", "From", "To", "Reason"].map((h) => (
                      <th key={h} className="px-2 py-2 text-left font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {configLog.map((l, i) => (
                    <tr key={`${l.at}-${l.field}-${i}`} className="border-b border-border last:border-0">
                      <td className="px-2 py-2 tabular-nums whitespace-nowrap">{l.at}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{l.by}</td>
                      <td className="px-2 py-2">{l.field}</td>
                      <td className="px-2 py-2 tabular-nums text-muted-foreground">{l.from}</td>
                      <td className="px-2 py-2 tabular-nums font-semibold">{l.to}</td>
                      <td className="px-2 py-2 text-muted-foreground">{l.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setLogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
