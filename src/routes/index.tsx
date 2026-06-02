import { Link } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { Button, Input, Popover, DatePicker } from "antd";
import {
  RocketOutlined,
  CoffeeOutlined,
  WarningOutlined,
  ShoppingCartOutlined,
  SafetyCertificateOutlined,
  CarOutlined,
  DollarOutlined,
  InboxOutlined,
  TeamOutlined,
  CalendarOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useRole } from "@/lib/roles";
import {
  flights, productionOrders, purchaseOrders, dispatch, qcChecks,
  seedFlightOrders, inventory, inventoryValue,
} from "@/lib/sample-data";
import { useWorkflow } from "@/lib/workflow-store";
import { flagArrival } from "@/lib/arrival-flash";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { toast } from "sonner";

type Period = "today" | "week" | "month" | "quarter" | "year" | "custom";

// Days back from "today" each rolling window covers. seedFlightOrders' date
// column is ISO yyyy-mm-dd, so a string threshold compares without parsing.
const PERIOD_WINDOW_DAYS: Record<"month" | "quarter" | "year", number> = {
  month: 30,
  quarter: 90,
  year: 365,
};

type DateRange = { from: string; to: string };

// Harvest Catering chart palette — brand red/amber/status colors.
const CHART_PRIMARY  = "#E10101"; // brand red
const CHART_AMBER    = "#d97316"; // warm amber target line
const CHART_SUCCESS  = "#0f7a40"; // green status
const CHART_INFO     = "#3c3a40"; // ink info
const CHART_COLORS   = [CHART_PRIMARY, "#7e0206", CHART_AMBER, CHART_INFO];

// ── Live KPI helpers ────────────────────────────────────────────────────────
function formatLakh(n: number): string {
  if (n >= 100000) return `৳ ${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `৳ ${(n / 1000).toFixed(1)}K`;
  return `৳ ${n.toLocaleString()}`;
}

type ActivityTone = "navy" | "success" | "destructive" | "leaf" | "warning";
type ActivityEntry = {
  t: string;
  e: string;
  d: string;
  tone: ActivityTone;
  to: "/order-management" | "/procurement" | "/inventory" | "/dispatch"
    | "/cooking-temp" | "/production-entry" | "/purchase-requisition" | "/transfer";
  highlight?: string;
};

function useDashboardKpis(period: Period, range?: DateRange) {
  const { wfRequisitions, wfPurchaseOrders, productionEntries, productionEntryRecords, transferNotes } = useWorkflow();

  const allDates = Array.from(new Set(seedFlightOrders.map((o) => o.date))).sort();
  const today = allDates[allDates.length - 1] ?? "";
  const yesterday = allDates[allDates.length - 2] ?? "";
  const todayOrders = seedFlightOrders.filter((o) => o.date === today);
  const flightsToday = todayOrders.length;
  const flightsYesterday = seedFlightOrders.filter((o) => o.date === yesterday).length;
  const flightsWeek = seedFlightOrders.length;
  const flightsDelta = flightsToday - flightsYesterday;
  const flightsTodayIds = todayOrders.map((o) => o.id);
  const flightsAllIds = seedFlightOrders.map((o) => o.id);

  const customOrders = range
    ? seedFlightOrders.filter((o) =>
        (!range.from || o.date >= range.from) &&
        (!range.to || o.date <= range.to),
      )
    : [];
  const flightsCustom = customOrders.length;
  const flightsCustomIds = customOrders.map((o) => o.id);
  const customDayCount = range
    ? new Set(customOrders.map((o) => o.date)).size
    : 0;

  // Rolling windows for This Month / Quarter / Year (relative to seed "today").
  const windowDays =
    period === "month" || period === "quarter" || period === "year"
      ? PERIOD_WINDOW_DAYS[period]
      : null;
  const windowStart = (() => {
    if (windowDays == null || !today) return null;
    const t = new Date(today);
    if (Number.isNaN(t.getTime())) return null;
    t.setDate(t.getDate() - (windowDays - 1));
    return t.toISOString().slice(0, 10);
  })();
  const windowOrders = windowStart
    ? seedFlightOrders.filter((o) => o.date >= windowStart && o.date <= today)
    : [];
  const flightsWindow = windowOrders.length;
  const flightsWindowIds = windowOrders.map((o) => o.id);
  const windowDayCount = windowStart
    ? new Set(windowOrders.map((o) => o.date)).size
    : 0;

  const producedTotal = productionEntryRecords.reduce((s, r) => s + r.producedQty, 0);
  const targetTotal = productionEntries.reduce(
    (s, p) => s + (p.orderQty ?? p.producedQty),
    0,
  );
  const targetPct = targetTotal > 0 ? Math.round((producedTotal / targetTotal) * 100) : 0;
  const mealsRowIds = productionEntries.map((p) => p.id);

  const delayedFlights = flights.filter((f) => f.status === "Delayed");
  const delayed = delayedFlights.length;
  const delayedPax = delayedFlights.reduce((s, f) => s + f.pax, 0);
  const delayedFlightCodes = new Set(delayedFlights.map((f) => f.flight));
  const delayedOrders = seedFlightOrders.filter((o) => delayedFlightCodes.has(o.flight));
  const delayedRowIds = delayedOrders.map((o) => o.id);
  // Deep-link target: the first delayed flight's catering order. Order Management
  // jumps to that order's page (?ord=) so the arrival-flash can tint the row.
  const delayedOrderNo = delayedOrders[0]?.orderNo;

  const qcFailed = qcChecks.filter((q) => q.result === "Fail");
  const qcOpen = qcFailed.length;
  const qcResolved = qcChecks.filter((q) => q.result === "Pass").length;
  const qcRowIds = qcFailed.map((q) => q.id);

  const pendingSeedPOs = purchaseOrders.filter((p) => p.status === "Pending Approval");
  const pendingWfPOs = wfPurchaseOrders.filter((p) => p.status === "Pending Approval");
  const pendingReqs = wfRequisitions.filter((r) => r.status === "Pending Accounts");
  const pendingPOCount = pendingSeedPOs.length + pendingReqs.length;
  const pendingPOAmount = pendingSeedPOs.reduce((s, p) => s + p.amount, 0);
  const pendingPORowIds = [
    ...pendingSeedPOs.map((p) => p.id),
    ...pendingWfPOs.map((p) => p.id),
    ...pendingReqs.map((r) => r.id),
  ];

  const lowItems = inventory.filter((i) => i.status === "Low");
  const criticalItems = inventory.filter((i) => i.status === "Critical");
  const invAlerts = lowItems.length + criticalItems.length;
  const invAlertRowIds = [...criticalItems.map((i) => i.id), ...lowItems.map((i) => i.id)];

  const activeDispatch = dispatch.filter((d) => d.status !== "Delivered");
  const dispatchActive = activeDispatch.length;
  const dispatchEnRoute = dispatch.filter((d) => d.status === "En Route").length;
  const dispatchRowIds = activeDispatch.map((d) => d.id);

  const stockValue = inventoryValue(inventory);

  const trendToday = [
    { d: "06:00", meals: Math.round(producedTotal * 0.07), target: Math.round(targetTotal * 0.10) },
    { d: "09:00", meals: Math.round(producedTotal * 0.18), target: Math.round(targetTotal * 0.22) },
    { d: "12:00", meals: Math.round(producedTotal * 0.32), target: Math.round(targetTotal * 0.32) },
    { d: "15:00", meals: Math.round(producedTotal * 0.50), target: Math.round(targetTotal * 0.55) },
    { d: "18:00", meals: Math.round(producedTotal * 0.72), target: Math.round(targetTotal * 0.78) },
    { d: "21:00", meals: Math.round(producedTotal * 0.92), target: Math.round(targetTotal * 0.95) },
    { d: "Now",   meals: producedTotal,                     target: targetTotal },
  ];

  const trendWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => {
    const factor = 0.78 + ((i * 137) % 50) / 100;
    return {
      d,
      meals: Math.round(producedTotal * factor),
      target: Math.round(targetTotal * factor),
    };
  });

  const isWeek = period === "week";
  const isCustom = period === "custom" && !!range;
  const isWindow = period === "month" || period === "quarter" || period === "year";

  const flightsValue = isCustom ? flightsCustom : isWindow ? flightsWindow : isWeek ? flightsWeek : flightsToday;
  const flightsSub = isCustom
    ? `${customDayCount} day${customDayCount === 1 ? "" : "s"} in range`
    : isWindow
      ? `${windowDayCount} day${windowDayCount === 1 ? "" : "s"} covered`
      : isWeek
        ? `${allDates.length} days covered`
        : `${flightsDelta >= 0 ? "+" : ""}${flightsDelta} vs yesterday`;
  const flightsIds = isCustom ? flightsCustomIds : isWindow ? flightsWindowIds : isWeek ? flightsAllIds : flightsTodayIds;

  return {
    kpis: {
      flights: { value: flightsValue, sub: flightsSub, ids: flightsIds },
      meals:   { value: producedTotal.toLocaleString(), sub: targetTotal > 0 ? `${targetPct}% of target` : "no targets yet", ids: mealsRowIds },
      delayed: { value: delayed, sub: delayed > 0 ? `${delayedPax.toLocaleString()} pax affected` : "none on time", ids: delayedRowIds, ord: delayedOrderNo },
      qcIssues:{ value: qcOpen, sub: `${qcOpen} open, ${qcResolved} resolved`, ids: qcRowIds },
      pendingPOs:{ value: pendingPOCount, sub: pendingPOAmount > 0 ? `${formatLakh(pendingPOAmount)} pending` : "no value pending", ids: pendingPORowIds },
      invAlerts:{ value: invAlerts, sub: `${criticalItems.length} critical`, ids: invAlertRowIds },
      dispatch: { value: dispatchActive, sub: `${dispatchEnRoute} en route`, ids: dispatchRowIds },
      dailyCost:{ value: formatLakh(stockValue), sub: "FEFO stock value", ids: [] as string[] },
    },
    trend: isCustom ? buildCustomTrend(range!, producedTotal, targetTotal) : (isWeek || isWindow) ? trendWeek : trendToday,
    trendTitle: isCustom
      ? `Meal Production Trend (${range!.from || "…"} → ${range!.to || "…"})`
      : (isWeek || isWindow) ? "Meal Production Trend (Last 7 Days)" : "Meal Production Trend (Today)",
    sectionMix: computeSectionMix(producedTotal),
    activeFlights: pickActiveFlights(),
    activityFeed: buildActivityFeed({
      wfRequisitions, productionEntryRecords, transferNotes,
    }),
  };
}

function buildCustomTrend(range: DateRange, producedTotal: number, targetTotal: number) {
  const from = range.from ? new Date(range.from) : new Date();
  const to = range.to ? new Date(range.to) : new Date();
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
    return [{ d: "—", meals: producedTotal, target: targetTotal }];
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const dayCount = Math.min(31, Math.floor((to.getTime() - from.getTime()) / dayMs) + 1);
  const dailyMeals = producedTotal / dayCount;
  const dailyTarget = targetTotal / dayCount;
  return Array.from({ length: dayCount }, (_, i) => {
    const cursor = new Date(from.getTime() + i * dayMs);
    const factor = 0.65 + ((i * 173) % 55) / 100;
    return {
      d: cursor.toISOString().slice(5, 10),
      meals: Math.round(dailyMeals * factor),
      target: Math.round(dailyTarget * factor),
    };
  });
}

function pickActiveFlights() {
  const priority: Record<string, number> = {
    Production: 0,
    Approved: 1,
    Dispatched: 2,
    Pending: 3,
    Completed: 4,
  };
  return [...seedFlightOrders]
    .sort((a, b) => {
      const pa = priority[a.status] ?? 99;
      const pb = priority[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.etd.localeCompare(b.etd);
    })
    .slice(0, 24);
}

function groupActiveByOrder(rows: ReturnType<typeof pickActiveFlights>, maxOrders = 5) {
  const map = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = map.get(r.orderNo);
    if (list) list.push(r);
    else map.set(r.orderNo, [r]);
  }
  return Array.from(map.entries()).slice(0, maxOrders);
}

// Production Mix donut data — splits the day's produced meals across the four
// kitchen sections so the donut center stays equal to the "Meals Prepared" KPI
// and the slices match the GM dashboard design:
//   Hot Kitchen 41% · Cold Kitchen 34% · Veg Section 16% · Special Meal 9%.
// CHART_COLORS maps by index → red · dark-red · amber · ink.
function computeSectionMix(total: number): { name: string; v: number }[] {
  const sections = [
    { name: "Hot Kitchen",  w: 0.41 },
    { name: "Cold Kitchen", w: 0.34 },
    { name: "Veg Section",  w: 0.16 },
    { name: "Special Meal", w: 0.09 },
  ];
  let allocated = 0;
  return sections.map((s, i) => {
    // Last slice takes the remainder so the parts always sum to `total` exactly.
    const v = i === sections.length - 1 ? Math.max(0, total - allocated) : Math.round(total * s.w);
    allocated += v;
    return { name: s.name, v };
  });
}

function buildActivityFeed({
  wfRequisitions, productionEntryRecords, transferNotes,
}: {
  wfRequisitions: ReturnType<typeof useWorkflow>["wfRequisitions"];
  productionEntryRecords: ReturnType<typeof useWorkflow>["productionEntryRecords"];
  transferNotes: ReturnType<typeof useWorkflow>["transferNotes"];
}): ActivityEntry[] {
  const out: ActivityEntry[] = [];

  inventory
    .filter((i) => i.status === "Critical" || i.status === "Low")
    .slice(0, 2)
    .forEach((i) => {
      out.push({
        t: i.expiry === "—" ? "—" : i.expiry.slice(5),
        e: i.status === "Critical" ? "Critical stock" : "Low stock alert",
        d: `${i.name} — ${i.stock} ${i.uom}`,
        tone: i.status === "Critical" ? "destructive" : "warning",
        to: "/inventory",
        highlight: "inv-alerts",
      });
    });

  qcChecks
    .filter((q) => q.result === "Fail")
    .slice(0, 1)
    .forEach((q) => {
      out.push({
        t: q.flight.slice(-3),
        e: "QC Failed",
        d: `${q.batch} — ${q.parameter}`,
        tone: "destructive",
        to: "/cooking-temp",
        highlight: "qc-issues",
      });
    });

  productionEntryRecords.slice(0, 1).forEach((r) => {
    out.push({
      t: r.date.slice(11, 16) || r.date.slice(5, 10),
      e: "Production logged",
      d: `${r.productionOrderId} — ${r.producedQty} units${r.shift ? ` (${r.shift})` : ""}`,
      tone: "leaf",
      to: "/production-entry",
      highlight: "production-list",
    });
  });

  wfRequisitions
    .filter((r) => r.status === "Pending Accounts")
    .slice(0, 1)
    .forEach((r) => {
      out.push({
        t: r.date.slice(5, 10),
        e: "PR pending approval",
        d: `${r.id} — ${r.requestedBy}`,
        tone: "navy",
        to: "/purchase-requisition",
        highlight: "pr-list",
      });
    });

  purchaseOrders
    .filter((p) => p.status === "Approved")
    .slice(0, 1)
    .forEach((p) => {
      out.push({
        t: p.date.slice(5),
        e: "PO Approved",
        d: `${p.id} — ${p.vendor}`,
        tone: "success",
        to: "/procurement",
        highlight: "po-list",
      });
    });

  transferNotes.slice(0, 1).forEach((tn) => {
    out.push({
      t: tn.date.slice(11, 16) || tn.date.slice(5, 10),
      e: tn.status === "Issued" ? "Transfer issued" : "Transfer pending",
      d: `${tn.id} — ${tn.from} → ${tn.to}`,
      tone: tn.status === "Issued" ? "success" : "warning",
      to: "/transfer",
      highlight: "transfer-list",
    });
  });

  return out.slice(0, 6);
}

// Harvest card surface — used as the consistent wrapper for every dashboard panel.
function PanelCard({
  title,
  link,
  linkLabel,
  highlight,
  children,
}: {
  title: string;
  link?: Parameters<typeof Link>[0]["to"];
  linkLabel?: string;
  highlight?: string;
  children: ReactNode;
}) {
  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid var(--line, #e6e2e0)',
      borderRadius: 16,
      boxShadow: '0 1px 2px rgba(26,2,4,.04), 0 12px 30px -22px rgba(26,2,4,.18)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '18px 22px',
        borderBottom: '1px solid #f5f0ec',
      }}>
        <h2 style={{
          fontFamily: "var(--serif, 'Newsreader', Georgia, serif)",
          fontWeight: 600, fontSize: 19, letterSpacing: '-0.01em',
          margin: 0, color: 'var(--ink, #1a0204)', whiteSpace: 'nowrap',
        }}>
          {title}
        </h2>
        {link && (
          <Link
            to={link}
            onClick={() => highlight && flagArrival(highlight)}
            style={{ fontSize: 12.5, fontWeight: 600, color: '#E10101', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
          >
            {linkLabel ?? 'Open →'}
          </Link>
        )}
      </div>
      <div style={{ padding: '18px 22px', flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

// Production Mix donut — hand-rolled SVG ring with rounded segment caps over a
// faint track, a serif center total, and a percentage legend, matching the GM
// dashboard mockup's custom donut (not a recharts pie).
function ProductionMixDonut({ data }: { data: { name: string; v: number }[] }) {
  const total = data.reduce((s, d) => s + d.v, 0);
  const SIZE = 230, C = SIZE / 2, R = 84, SW = 20, GAP = 18;

  // Point on the ring centerline at `ang` degrees, measured clockwise from top.
  const pt = (ang: number) => {
    const rad = (ang * Math.PI) / 180;
    return { x: C + R * Math.sin(rad), y: C - R * Math.cos(rad) };
  };

  let cursor = 0;
  const segs = data.map((d, i) => {
    const frac = total > 0 ? d.v / total : 0;
    const sweep = frac * 360;
    // Shrink the gap on tiny slices so no section silently vanishes from the ring.
    const g = data.length > 1 ? Math.min(GAP / 2, sweep / 3) : 0;
    const a1 = cursor + g;
    const a2 = cursor + sweep - g;
    cursor += sweep;
    return { name: d.name, v: d.v, frac, a1, a2, color: CHART_COLORS[i % CHART_COLORS.length] };
  });

  const single = segs.length === 1 && total > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 0 6px" }}>
      <div style={{ position: "relative", width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {/* faint track shows through the gaps between segments */}
          <circle cx={C} cy={C} r={R} fill="none" stroke="#f0ebe8" strokeWidth={SW} />
          {single ? (
            <circle cx={C} cy={C} r={R} fill="none" stroke={segs[0].color} strokeWidth={SW} />
          ) : (
            segs.map((s, i) => {
              if (s.a2 <= s.a1) return null;
              const p1 = pt(s.a1), p2 = pt(s.a2);
              const large = s.a2 - s.a1 > 180 ? 1 : 0;
              return (
                <path
                  key={i}
                  d={`M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={SW}
                  strokeLinecap="round"
                >
                  <title>{`${s.name}: ${s.v.toLocaleString()} (${Math.round(s.frac * 100)}%)`}</title>
                </path>
              );
            })
          )}
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", pointerEvents: "none",
        }}>
          <span style={{
            fontFamily: "var(--serif, 'Newsreader', Georgia, serif)",
            fontWeight: 600, fontSize: 34, lineHeight: 1, color: "var(--ink, #1a0204)",
          }}>
            {total.toLocaleString()}
          </span>
          <span style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em",
            textTransform: "uppercase", color: "var(--muted-foreground, #6b6b72)", marginTop: 4,
          }}>
            Meals
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 18px", marginTop: 18 }}>
        {segs.map((s, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--ink, #1a0204)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0, background: s.color }} />
            {s.name}
            <span style={{ color: "var(--muted-foreground, #6b6b72)", fontVariantNumeric: "tabular-nums" }}>
              {total > 0 ? Math.round((s.v / total) * 100) : 0}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { role } = useRole();
  const [period, setPeriod] = useState<Period>("today");
  const [range, setRange] = useState<DateRange | null>(null);
  const data = useDashboardKpis(period, range ?? undefined);

  const periodLabel =
    period === "today" ? "Today's"
    : period === "week" ? "Weekly"
    : period === "month" ? "Monthly"
    : period === "quarter" ? "Quarterly"
    : period === "year" ? "Yearly"
    : range ? `${range.from} → ${range.to}` : "Custom";

  return (
    <>
      <PageHeader
        title={`${role} Dashboard`}
        subtitle="Live operational overview — US-Bangla Airlines Flight Catering"
        actions={
          <>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              {([
                { value: "today",   label: "Today"        },
                { value: "week",    label: "This Week"    },
                { value: "month",   label: "This Month"   },
                { value: "quarter", label: "This Quarter" },
                { value: "year",    label: "This Year"    },
              ] as { value: Period; label: string }[]).map((opt) => {
                const selected = period === opt.value;
                return (
                  <Button
                    key={opt.value}
                    size="small"
                    type={selected ? "primary" : "default"}
                    className={selected ? undefined : "period-toggle-idle"}
                    onClick={() => { setPeriod(opt.value); setRange(null); }}
                  >
                    {opt.label}
                  </Button>
                );
              })}
              <CustomRangePicker
                active={period === "custom"}
                range={range}
                onApply={(r) => { setRange(r); setPeriod("custom"); }}
                onClear={() => { setRange(null); setPeriod("today"); }}
              />
            </div>
            <Button
              type="primary"
              size="small"
              onClick={() => toast.success(`${periodLabel} report exported.`)}
            >
              Export Report
            </Button>
          </>
        }
      />

      {/* Harvest decorative brand stripe */}
      <div style={{
        height: 3, borderRadius: 99, margin: '18px 0 22px',
        background: 'linear-gradient(90deg, #E10101 0%, #a60303 46%, #1a0204 100%)',
        opacity: 0.9,
      }} aria-hidden />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiLink to="/order-management" highlight="active-orders" ids={data.kpis.flights.ids}>
          <KpiCard label="Flights Today"   value={data.kpis.flights.value}   sub={data.kpis.flights.sub}   icon={RocketOutlined}            tone="navy"    />
        </KpiLink>
        <KpiLink to="/production-entry" highlight="production-list" ids={data.kpis.meals.ids}>
          <KpiCard label="Meals Prepared"  value={data.kpis.meals.value}     sub={data.kpis.meals.sub}     icon={CoffeeOutlined}            tone="success" />
        </KpiLink>
        <KpiLink to="/order-management" ord={data.kpis.delayed.ord} highlight="active-orders" ids={data.kpis.delayed.ids}>
          <KpiCard label="Delayed Flights" value={data.kpis.delayed.value}   sub={data.kpis.delayed.sub}   icon={WarningOutlined}           tone="warning" />
        </KpiLink>
        <KpiLink to="/cooking-temp" highlight="qc-issues" ids={data.kpis.qcIssues.ids}>
          <KpiCard label="QC Issues"       value={data.kpis.qcIssues.value}  sub={data.kpis.qcIssues.sub}  icon={SafetyCertificateOutlined} tone="red"     />
        </KpiLink>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <KpiLink to="/procurement" highlight="po-list" ids={data.kpis.pendingPOs.ids}>
          <KpiCard label="Pending POs"      value={data.kpis.pendingPOs.value} sub={data.kpis.pendingPOs.sub} icon={ShoppingCartOutlined} tone="info"    />
        </KpiLink>
        <KpiLink to="/inventory" highlight="inv-alerts" ids={data.kpis.invAlerts.ids}>
          <KpiCard label="Inventory Alerts" value={data.kpis.invAlerts.value}  sub={data.kpis.invAlerts.sub}  icon={InboxOutlined}        tone="warning" />
        </KpiLink>
        <KpiLink to="/dispatch" highlight="dispatch-list" ids={data.kpis.dispatch.ids}>
          <KpiCard label="Dispatch Active"  value={data.kpis.dispatch.value}   sub={data.kpis.dispatch.sub}   icon={CarOutlined}          tone="success" />
        </KpiLink>
        <KpiLink to="/inventory" highlight="inv-value">
          <KpiCard label="Daily Cost"       value={data.kpis.dailyCost.value}  sub={data.kpis.dailyCost.sub}  icon={DollarOutlined}       tone="ink"     />
        </KpiLink>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        <div className="lg:col-span-2">
          <PanelCard title="Active Orders" link="/order-management" linkLabel="View all →" highlight="active-orders">
            <ActiveOrdersTabs rows={data.activeFlights} />
          </PanelCard>
        </div>
        <PanelCard title="Production Mix" link="/production-entry" linkLabel="Open →" highlight="production-list">
          <ProductionMixDonut data={data.sectionMix} />
        </PanelCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="lg:col-span-2">
          <PanelCard title={data.trendTitle} link="/production-entry" linkLabel="Open Production →" highlight="production-list">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.trend}>
                <defs>
                  <linearGradient id="grad-meals" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_PRIMARY} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={CHART_PRIMARY} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="grad-target" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_AMBER} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={CHART_AMBER} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="d" stroke="currentColor" className="text-muted-foreground" fontSize={11} />
                <YAxis stroke="currentColor" className="text-muted-foreground" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area type="monotone" dataKey="meals"  stroke={CHART_PRIMARY} fill="url(#grad-meals)"  strokeWidth={2} />
                <Area type="monotone" dataKey="target" stroke={CHART_AMBER}   fill="url(#grad-target)" strokeWidth={1.5} strokeDasharray="5 3" />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              </AreaChart>
            </ResponsiveContainer>
          </PanelCard>
        </div>
        <PanelCard title="Activity Feed">
          {data.activityFeed.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--color-muted-foreground)", fontSize: 12, padding: "16px 0" }}>
              No recent activity.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.activityFeed.map((a, i) => {
                const accent = {
                  navy:        "#3c3a40",
                  success:     "#0f7a40",
                  destructive: "#E10101",
                  leaf:        "#0f7a40",
                  warning:     "#b45309",
                }[a.tone];
                return (
                  <Link
                    key={i}
                    to={a.to}
                    onClick={() => a.highlight && flagArrival(a.highlight)}
                    style={{ display: "flex", gap: 12, textDecoration: "none", color: "inherit" }}
                  >
                    <div style={{ fontSize: 11, color: "var(--color-muted-foreground)", width: 48, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                      {a.t}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        borderLeft: `2px solid ${accent}`,
                        paddingLeft: 12,
                        transition: "background-color 150ms ease",
                        borderRadius: "0 6px 6px 0",
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-foreground)" }}>{a.e}</div>
                      <div style={{ fontSize: 12, color: "var(--color-muted-foreground)" }}>{a.d}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </PanelCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <PanelCard title="Production Progress" link="/production-entry" linkLabel="View orders →" highlight="production-list">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={productionOrders.map(p => ({ name: p.id, progress: p.progress }))}>
              <defs>
                <linearGradient id="grad-bar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor={CHART_PRIMARY} stopOpacity={1} />
                  <stop offset="100%" stopColor={CHART_PRIMARY} stopOpacity={0.65} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="name" stroke="currentColor" className="text-muted-foreground" fontSize={11} />
              <YAxis stroke="currentColor" className="text-muted-foreground" fontSize={11} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="progress" fill="url(#grad-bar)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </PanelCard>
        <PanelCard title="Procurement Pipeline" link="/procurement" linkLabel="View all →" highlight="po-list">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {purchaseOrders.slice(0, 5).map((p) => (
              <Link
                key={p.id}
                to="/procurement"
                onClick={() => flagArrival("po-list")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  padding: 8,
                  fontSize: 13,
                  textDecoration: "none",
                  color: "inherit",
                  transition: "background-color 150ms ease, border-color 150ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#fff5f5";
                  e.currentTarget.style.borderColor = "rgba(225,1,1,0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "var(--color-border)";
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{p.id} — {p.vendor}</div>
                  <div style={{ fontSize: 12, color: "var(--color-muted-foreground)" }}>
                    {p.items} items • ৳ {p.amount.toLocaleString()}
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </Link>
            ))}
          </div>
        </PanelCard>
      </div>
    </>
  );
}

// Active Orders status pill — brand status family from the dashboard mockup.
// Production → amber wash (st-prod), Pending → neutral, everything else → green (st-ready).
function aoStatusPill(status: string): { color: string; bg: string; border: string } {
  const s = status.toLowerCase();
  if (s === "production") return { color: "#b45309", bg: "#fbf1e6", border: "#f0d9bf" };
  if (s === "pending")    return { color: "#6b6b72", bg: "#f4f1ef", border: "#e9e4e1" };
  return { color: "#0f7a40", bg: "#ecf5ef", border: "#c9e6d4" };
}

function ActiveOrdersTabs({ rows }: { rows: ReturnType<typeof pickActiveFlights> }) {
  const [tab, setTab] = useState<"flight" | "crew">("flight");
  const groups = groupActiveByOrder(rows, 5);

  // Span the panel body edge-to-edge so the tab rule + scroll list align to the
  // card like the mockup, then re-apply the design's own paddings inside.
  return (
    <div style={{ margin: "-18px -22px" }}>
      <div style={{ display: "flex", gap: 22, padding: "0 22px", borderBottom: "1px solid #f0ebe8" }}>
        {([["flight", "Flight Orders"], ["crew", "Crew Orders"]] as const).map(([key, label]) => {
          const on = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                position: "relative", padding: "13px 0", fontSize: 13.5, fontWeight: 600,
                color: on ? "var(--ink, #1a0204)" : "var(--muted-foreground, #6b6b72)",
                cursor: "pointer", background: "none", border: "none",
                fontFamily: "inherit", whiteSpace: "nowrap",
              }}
            >
              {label}
              {on && (
                <span style={{
                  position: "absolute", left: 0, right: 0, bottom: -1, height: 2.5,
                  borderRadius: 99, background: "#E10101",
                }} />
              )}
            </button>
          );
        })}
      </div>

      <div style={{ maxHeight: 362, overflowY: "auto", padding: "8px 22px 18px" }}>
        {groups.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 12, color: "var(--muted-foreground, #6b6b72)" }}>
            No active orders.
          </div>
        ) : (
          groups.map(([orderNo, legs]) => (
            <OrderGroupCard key={`${tab}-${orderNo}`} orderNo={orderNo} legs={legs} mode={tab} />
          ))
        )}
      </div>
    </div>
  );
}

function OrderGroupCard({
  orderNo, legs, mode,
}: {
  orderNo: string;
  legs: ReturnType<typeof pickActiveFlights>;
  mode: "flight" | "crew";
}) {
  const status = legs[0]?.status;
  const legIds = legs.map((l) => l.id);
  const totalPax = legs.reduce((s, l) => s + l.pax, 0);
  const totalCrew = legs.reduce((s, l) => s + l.crew, 0);
  const pill = status ? aoStatusPill(status) : null;

  return (
    <div style={{
      border: "1px solid #e9e4e1", borderRadius: 13, marginTop: 12,
      overflow: "hidden", background: "#fff",
    }}>
      {/* group header */}
      <Link
        to="/order-management"
        onClick={() => flagArrival({ target: "active-orders", ids: legIds })}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 15px",
          background: "#fbf8f6", borderBottom: "1px solid #f0ebe8",
          textDecoration: "none", color: "inherit",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13.5, color: "#E10101", letterSpacing: ".01em" }}>
          {orderNo}
        </span>
        {legs.length > 1 && (
          <span style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: "#b45309",
            background: "#fbf1e6", padding: "2px 7px", borderRadius: 6, textTransform: "uppercase",
          }}>
            {legs.length} flights
          </span>
        )}
        <span style={{ fontSize: 12.5, color: "var(--muted-foreground, #6b6b72)" }}>
          ·&nbsp;<span style={{ color: "var(--ink, #1a0204)", fontWeight: 600 }}>
            {mode === "flight" ? totalPax : totalCrew}
          </span> {mode === "flight" ? "pax" : "crew"}
        </span>
        {status && pill && (
          <span style={{
            marginLeft: "auto", fontSize: 11, fontWeight: 600, letterSpacing: ".02em",
            padding: "4px 11px", borderRadius: 999,
            color: pill.color, background: pill.bg, border: `1px solid ${pill.border}`,
          }}>
            {status}
          </span>
        )}
      </Link>

      {/* legs */}
      {legs.map((l, idx) => (
        <Link
          key={l.id}
          to="/order-management"
          onClick={() => flagArrival({ target: "active-orders", ids: [l.id] })}
          style={{
            display: "flex", alignItems: "center", gap: 12, padding: "11px 15px",
            borderTop: idx > 0 ? "1px solid #f0ebe8" : "none",
            textDecoration: "none", color: "inherit", transition: "background-color 150ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#fff5f5")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{
            fontSize: 12, fontWeight: 700, color: "#fff", background: "#2a2528",
            borderRadius: 7, padding: "4px 8px", fontVariantNumeric: "tabular-nums", flex: "none",
          }}>
            {l.flight.slice(-3)}
          </span>
          <span style={{
            flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, color: "var(--ink, #1a0204)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {l.flight} <span style={{ color: "var(--muted-foreground, #6b6b72)", fontWeight: 400 }}>· {l.sector}</span>
          </span>
          <span style={{ fontSize: 13, color: "var(--ink, #1a0204)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {l.etd}
          </span>
          <span style={{
            fontSize: 12, color: "var(--muted-foreground, #6b6b72)", fontVariantNumeric: "tabular-nums",
            width: 42, textAlign: "right", flex: "none",
            display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 3,
          }}>
            {mode === "flight" ? `${l.pax}p` : <><TeamOutlined style={{ fontSize: 11 }} />{l.crew}</>}
          </span>
        </Link>
      ))}
    </div>
  );
}

function CustomRangePicker({
  active, range, onApply, onClear,
}: {
  active: boolean;
  range: DateRange | null;
  onApply: (r: DateRange) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(range?.from ?? "");
  const [draftTo, setDraftTo] = useState(range?.to ?? "");

  const handleApply = () => {
    if (!draftFrom || !draftTo) {
      toast.error("Pick both From and To dates.");
      return;
    }
    if (draftFrom > draftTo) {
      toast.error("From date must be on or before To date.");
      return;
    }
    onApply({ from: draftFrom, to: draftTo });
    setOpen(false);
    toast.success(`Filtered to ${draftFrom} → ${draftTo}.`);
  };

  const showLabel = active && range ? `${range.from.slice(5)} → ${range.to.slice(5)}` : "Custom";

  const content = (
    <div style={{ width: 280 }}>
      <div className="field-label" style={{ marginBottom: 8 }}>Custom Date Range</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div>
          <div className="field-label" style={{ marginBottom: 4 }}>From</div>
          <Input
            type="date"
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            max={draftTo || undefined}
            size="small"
          />
        </div>
        <div>
          <div className="field-label" style={{ marginBottom: 4 }}>To</div>
          <Input
            type="date"
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            min={draftFrom || undefined}
            size="small"
          />
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
        {([
          { label: "Last 7d",    days: 7 },
          { label: "Last 14d",   days: 14 },
          { label: "Last 30d",   days: 30 },
          { label: "This Month", days: -1 },
        ] as const).map((preset) => (
          <Button
            key={preset.label}
            size="small"
            type="default"
            shape="round"
            style={{ fontSize: 10 }}
            onClick={() => {
              const today = new Date();
              let from: Date;
              if (preset.days === -1) {
                from = new Date(today.getFullYear(), today.getMonth(), 1);
              } else {
                from = new Date(today.getTime() - (preset.days - 1) * 86400000);
              }
              setDraftFrom(from.toISOString().slice(0, 10));
              setDraftTo(today.toISOString().slice(0, 10));
            }}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 8, borderTop: "1px solid var(--color-border)" }}>
        <Button size="small" type="text" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="small" type="primary" onClick={handleApply}>Apply</Button>
      </div>
    </div>
  );

  // Avoid unused-import warning while still keeping DatePicker accessible to
  // any future inline calendar variant.
  void DatePicker;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { setDraftFrom(range?.from ?? ""); setDraftTo(range?.to ?? ""); }
      }}
      content={content}
      trigger="click"
      placement="bottomRight"
    >
      <Button
        type={active ? "primary" : "default"}
        size="small"
        className={active ? undefined : "period-toggle-idle"}
        icon={<CalendarOutlined />}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {showLabel}
        {active && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClear();
              }
            }}
            style={{
              marginLeft: 4,
              marginRight: -4,
              padding: 2,
              borderRadius: 4,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
            }}
            aria-label="Clear custom range"
            title="Clear"
          >
            <CloseOutlined style={{ fontSize: 10 }} />
          </span>
        )}
      </Button>
    </Popover>
  );
}

function KpiLink({
  to, ord, highlight, ids, children,
}: {
  to: "/order-management" | "/production-entry" | "/cooking-temp"
    | "/procurement" | "/inventory" | "/dispatch";
  ord?: string;
  highlight?: string;
  ids?: string[];
  children: ReactNode;
}) {
  // When an order number is supplied, deep-link via ?ord= so the destination
  // page scrolls to (and paginates to) the matching row before flashing it.
  const target = ord ? `${to}?ord=${encodeURIComponent(ord)}` : to;
  return (
    <Link
      to={target}
      onClick={() => {
        if (highlight) flagArrival({ target: highlight, ids });
      }}
      style={{ display: "block", textDecoration: "none", color: "inherit", borderRadius: 12 }}
    >
      {children}
    </Link>
  );
}
