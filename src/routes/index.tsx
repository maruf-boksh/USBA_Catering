import { Link } from "react-router-dom";
import { useState, useEffect, type ReactNode } from "react";
import { Button, Input, Popover, DatePicker, Segmented } from "antd";
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
  DownloadOutlined,
} from "@ant-design/icons";
import { getAuthUser } from "@/lib/auth";
import { KpiCard } from "@/components/common/KpiCard";
import { useRole } from "@/lib/roles";
import { useAccess, canElement } from "@/lib/access-control";
import {
  flights, productionOrders, purchaseOrders, qcChecks,
  seedFlightOrders, inventory, inventoryValue, warehouses,
  isDomesticSector,
} from "@/lib/sample-data";
import { useWorkflow } from "@/lib/workflow-store";
import { useFlightOrders, getFlightOrders, getAllAmendments } from "@/lib/flight-orders-store";
import { flagArrival } from "@/lib/arrival-flash";
import { loadDelayEvents, isActiveDelayEvent } from "@/routes/delay-management";
import { usePersistedState } from "@/lib/use-persisted-state";
import {
  INITIAL_PACKAGING_ROWS, buildDispatchList, FLIGHT_STATUS_BADGE,
  type PackagingRow,
} from "@/routes/dispatch";
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
// Donut palette via CSS vars so it flips in dark mode — the light palette's
// maroon (#7e0206) and ink (#3c3a40) are invisible on the dark shell, so the
// dark block (globals.css) remaps them to lighter, legible hues. Fallbacks keep
// SSR/no-var environments on the original light palette.
const CHART_COLORS   = [
  "var(--chart-1, #E10101)",
  "var(--chart-2, #7e0206)",
  "var(--chart-3, #d97316)",
  "var(--chart-4, #3c3a40)",
];

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
  const { wfRequisitions, wfPurchaseOrders, productionEntries, productionEntryRecords, transferNotes, qcClearedFlights, dispatchApprovals } = useWorkflow();
  // Live flight orders — same source as the Order Management table (seed +
  // runtime-created orders), so Active Orders shows real Order Nos from there.
  const liveFlightOrders = useFlightOrders();

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

  // Delayed-flights KPI reads the live Delay Management store (same source the
  // module and its "Active" KPI use) so the dashboard number stays in sync.
  const activeDelays = loadDelayEvents().filter(isActiveDelayEvent);
  const delayed = activeDelays.length;
  const delayedPax = activeDelays.reduce((s, e) => s + e.paxCount, 0);

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

  // Derive the same flight-level dispatch list the Dispatch page renders
  // (packaging rows grouped by flight + computed status) so KPIs and the
  // tracker panel never drift from the module.
  const [packagingRows] = usePersistedState<PackagingRow[]>("dispatch-packaging-rows", INITIAL_PACKAGING_ROWS);
  const dispatchList = buildDispatchList(packagingRows, qcClearedFlights, dispatchApprovals);
  const activeDispatch = dispatchList.filter((d) => d.status !== "Dispatched");
  const dispatchActive = activeDispatch.length;
  const dispatchReady = dispatchList.filter((d) => d.status === "Ready for Dispatch").length;
  const dispatchRowIds = activeDispatch.map((d) => d.dspId ?? d.flight);

  const stockValue = inventoryValue(inventory);

  // Last-Minute Changes recorded today (real wall-clock day), split by severity.
  const todayIso = new Date().toISOString().slice(0, 10);
  const lmcToday = getAllAmendments().filter((a) => a.isLmc && a.at.slice(0, 10) === todayIso);
  const lmc = {
    count: lmcToday.length,
    critical: lmcToday.filter((a) => a.severity === "critical").length,
    major: lmcToday.filter((a) => a.severity === "major").length,
  };

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

  // ── At-a-glance breakdowns shown inside each KPI card ────────────────────────
  const isTodayView = !isCustom && !isWindow && !isWeek;

  // Flights by leg direction × domestic/international (sectors leaving DAC are Outbound).
  const flightsDirSplit = (dir: "Outbound" | "Return") => {
    const rows = todayOrders.filter((o) => o.direction === dir);
    const dom = rows.filter((o) => isDomesticSector(o.sector)).length;
    return { total: rows.length, dom, intl: rows.length - dom };
  };
  const fOut = flightsDirSplit("Outbound");
  const fRet = flightsDirSplit("Return");
  const flightsPax = todayOrders.reduce((s, o) => s + o.pax, 0);
  const mealsPending = Math.max(0, targetTotal - producedTotal);

  // Delayed flights by direction × domestic/international.
  const delayDirSplit = (outbound: boolean) => {
    const rows = activeDelays.filter((e) => e.sector.trim().startsWith("DAC") === outbound);
    const dom = rows.filter((e) => isDomesticSector(e.sector)).length;
    return { total: rows.length, dom, intl: rows.length - dom };
  };
  const dOut = delayDirSplit(true);
  const dRet = delayDirSplit(false);

  // Pending procurement value split — central/airport, each PR vs Direct Purchase.
  const poCentralAmt = Math.round(pendingPOAmount * 0.6);
  const poAirportAmt = pendingPOAmount - poCentralAmt;
  const poCentralPr = Math.round(poCentralAmt * 0.7); const poCentralDp = poCentralAmt - poCentralPr;
  const poAirportPr = Math.round(poAirportAmt * 0.7); const poAirportDp = poAirportAmt - poAirportPr;

  // Stock alerts — items nearing expiry (≤ 30 days).
  const nowMs = Date.now();
  const nearExpiryCount = inventory.filter((i) => {
    const days = (new Date(i.expiry).getTime() - nowMs) / 86_400_000;
    return days >= 0 && days <= 30;
  }).length;

  // Ready for dispatch — flights (outbound/return) + distinct orders.
  const dispatchOut = Math.ceil(dispatchList.length / 2);
  const dispatchRet = dispatchList.length - dispatchOut;
  const dispatchOrders = new Set(dispatchList.map((d) => d.dspId ?? d.flight)).size;

  // Stock value change vs yesterday — deterministic demo delta.
  const stockYesterday = Math.round(stockValue * 0.977);
  const stockDeltaPct = stockYesterday > 0 ? ((stockValue - stockYesterday) / stockYesterday) * 100 : 0;

  return {
    kpis: {
      flights: { value: flightsValue, sub: flightsSub, ids: flightsIds,
        breakdown: isTodayView ? [
          { label: "Outbound", value: fOut.total, icon: "🛫", children: [
            { label: "Domestic", value: fOut.dom, icon: "🏠" },
            { label: "International", value: fOut.intl, icon: "🌍" },
          ] },
          { label: "Return", value: fRet.total, icon: "🛬", children: [
            { label: "Domestic", value: fRet.dom, icon: "🏠" },
            { label: "International", value: fRet.intl, icon: "🌍" },
          ] },
        ] : undefined },
      meals:   { value: producedTotal.toLocaleString(), sub: targetTotal > 0 ? `${targetPct}% of target` : "no targets yet", ids: mealsRowIds,
        breakdown: [
          { label: "Target (24h)", value: targetTotal.toLocaleString(), icon: "🎯" },
          { label: "Prepared", value: producedTotal.toLocaleString(), icon: "🍽️" },
          { label: "Pending", value: mealsPending.toLocaleString(), icon: "⏳" },
        ] },
      delayed: { value: delayed, sub: delayed > 0 ? `${delayedPax.toLocaleString()} pax affected` : "none on time",
        breakdown: [
          { label: "Outbound", value: dOut.total, icon: "🛫", children: [
            { label: "Domestic", value: dOut.dom, icon: "🏠" },
            { label: "International", value: dOut.intl, icon: "🌍" },
          ] },
          { label: "Return", value: dRet.total, icon: "🛬", children: [
            { label: "Domestic", value: dRet.dom, icon: "🏠" },
            { label: "International", value: dRet.intl, icon: "🌍" },
          ] },
        ] },
      qcIssues:{ value: qcOpen, sub: `${qcOpen} open, ${qcResolved} resolved`, ids: qcRowIds,
        breakdown: [
          { label: "Cooking Temp", value: qcOpen, icon: "🌡️" },
          { label: "Re-cook", value: 0, icon: "🔁" },
          { label: "Daily Hygiene", value: 0, icon: "🧹" },
          { label: "Personal Hygiene", value: 0, icon: "🧼" },
        ] },
      pendingPOs:{ value: pendingPOCount, sub: pendingPOAmount > 0 ? `${formatLakh(pendingPOAmount)} pending` : "no value pending", ids: pendingPORowIds,
        breakdown: [
          { label: "Central Warehouse", value: formatLakh(poCentralAmt), icon: "🏭" },
          { label: "Airport Warehouse", value: formatLakh(poAirportAmt), icon: "🛬" },
        ] },
      invAlerts:{ value: invAlerts, sub: `${criticalItems.length} critical`, ids: invAlertRowIds,
        breakdown: [
          { label: "Low", value: lowItems.length, icon: "📉" },
          { label: "Critical", value: criticalItems.length, icon: "🔴" },
          { label: "Near Expiry", value: nearExpiryCount, icon: "⏰" },
        ] },
      dispatch: { value: dispatchActive, sub: `${dispatchReady} ready for dispatch`, ids: dispatchRowIds,
        breakdown: [
          { label: "Flights Today", value: dispatchList.length, icon: "✈️" },
          { label: "Orders", value: dispatchOrders, icon: "📦" },
          { label: "Ready for Dispatch", value: dispatchReady, icon: "✅" },
        ] },
      dailyCost:{ value: formatLakh(stockValue), sub: "on-hand valuation", ids: [] as string[],
        breakdown: [
          { label: "Current Value", value: formatLakh(stockValue), icon: "💰" },
          { label: "vs Yesterday", value: `${stockDeltaPct >= 0 ? "+" : ""}${stockDeltaPct.toFixed(1)}%`, icon: stockDeltaPct >= 0 ? "📈" : "📉", dir: (stockDeltaPct >= 0 ? "up" : "down") as "up" | "down" },
        ] },
    },
    lmc,
    trend: isCustom ? buildCustomTrend(range!, producedTotal, targetTotal) : (isWeek || isWindow) ? trendWeek : trendToday,
    trendTitle: isCustom
      ? `Meal Production Trend (${range!.from || "…"} → ${range!.to || "…"})`
      : (isWeek || isWindow) ? "Meal Production Trend (Last 7 Days)" : "Meal Production Trend (Today)",
    sectionMix: computeWarehouseMix(productionEntryRecords),
    activeFlights: pickActiveFlights(liveFlightOrders),
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

function pickActiveFlights(rows: typeof seedFlightOrders = seedFlightOrders) {
  const priority: Record<string, number> = {
    Production: 0,
    Approved: 1,
    Dispatched: 2,
    Pending: 3,
    Completed: 4,
  };
  // Sort active-first; keep a generous slice so a single large order's legs
  // aren't truncated before grouping (the panel caps to 5 orders, and each
  // card caps its visible legs separately).
  return [...rows]
    .sort((a, b) => {
      const pa = priority[a.status] ?? 99;
      const pb = priority[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.etd.localeCompare(b.etd);
    })
    .slice(0, 500);
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

// Production Mix donut data — splits the day's produced meals across the
// warehouses / kitchens that produced them. Each production-entry record carries
// the warehouse it was produced in, so the slices sum to the same produced total
// shown in the donut center ("Meals Prepared"). CHART_COLORS maps by index.
function computeWarehouseMix(
  records: { warehouseId: string; producedQty: number }[],
): { name: string; v: number }[] {
  const totals = new Map<string, number>();
  for (const r of records) {
    const name = warehouses.find((w) => w.id === r.warehouseId)?.name ?? r.warehouseId ?? "Unassigned";
    totals.set(name, (totals.get(name) ?? 0) + r.producedQty);
  }
  // Largest share first so the legend reads top-down by volume.
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, v]) => ({ name, v }));
}

function buildActivityFeed({
  wfRequisitions, productionEntryRecords, transferNotes,
}: {
  wfRequisitions: ReturnType<typeof useWorkflow>["wfRequisitions"];
  productionEntryRecords: ReturnType<typeof useWorkflow>["productionEntryRecords"];
  transferNotes: ReturnType<typeof useWorkflow>["transferNotes"];
}): ActivityEntry[] {
  const out: ActivityEntry[] = [];

  // Last-Minute Changes first — they're the most time-critical signal.
  getAllAmendments()
    .filter((a) => a.isLmc)
    .slice(0, 2)
    .forEach((a) => {
      const flight = getFlightOrders().find((o) => o.id === a.orderId)?.flight ?? a.orderId;
      out.push({
        t: a.at.slice(11, 16),
        e: `LMC · ${a.severity}`,
        d: `${flight} — ${a.changes.map((c) => c.label).join(", ")}`,
        tone: a.severity === "critical" ? "destructive" : "warning",
        to: "/order-management",
        highlight: "active-orders",
      });
    });

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
  const [linkHover, setLinkHover] = useState(false);
  // Trailing "→" is rendered as an animated icon, so strip it from the label.
  const cleanLabel = (linkLabel ?? 'Open').replace(/\s*→\s*$/, '');
  return (
    <div style={{
      background: 'var(--color-bg-surface, #ffffff)',
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
        borderBottom: '1px solid var(--line, #f5f0ec)',
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
            onMouseEnter={() => setLinkHover(true)}
            onMouseLeave={() => setLinkHover(false)}
            style={{
              fontSize: 12.5, fontWeight: 600,
              color: '#6d28d9',
              background: linkHover ? '#e6e0fb' : '#f3f0fe',
              textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '6px 13px', borderRadius: 999,
              border: '1px solid #e6e0fb',
              transition: 'background 150ms ease, border-color 150ms ease',
              flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            {cleanLabel}
            <span style={{
              display: 'inline-block', lineHeight: 1,
              transition: 'transform 160ms ease',
              transform: linkHover ? 'translateX(3px)' : 'none',
            }}>→</span>
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
          <circle cx={C} cy={C} r={R} fill="none" stroke="var(--chart-track, #f0ebe8)" strokeWidth={SW} />
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
        {/* Only list sections that actually produced something — empty sections
            (0 meals) are omitted rather than shown at 0%. */}
        {segs.filter((s) => s.v > 0).map((s) => (
          <span key={s.name} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--ink, #1a0204)" }}>
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

/** First letters of each name token (drops the "." in "R. Hossain" → "RH"). */
function getInitials(name: string): string {
  const parts = name.replace(/\./g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  return parts.map((p) => p[0]!.toUpperCase()).slice(0, 3).join("");
}

/**
 * Personalised dashboard greeting banner — replaces the static module title.
 * Shows the signed-in user's avatar initials, a live date/time, a time-of-day
 * greeting, and their role. Period/export controls
 * are passed through as `actions` so they keep their place on the right.
 */
function DashboardGreeting({ actions }: { actions?: ReactNode }) {
  const user = getAuthUser();
  const name = user?.name ?? "there";
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const subParts = [user?.role].filter(Boolean) as string[];

  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16, flexWrap: "wrap",
        background: "var(--color-bg-surface, #fff)",
        border: "1px solid var(--line, #e6e2e0)",
        borderRadius: 14,
        padding: "12px 16px",
        boxShadow: "0 1px 2px rgba(26,2,4,.04), 0 12px 30px -22px rgba(26,2,4,.18)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div
          aria-hidden
          style={{
            width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff",
            background: "linear-gradient(135deg, var(--color-primary, #a60303), var(--color-primary-dark, #7a0202))",
            boxShadow: "0 6px 16px -8px rgba(var(--color-primary-dark-rgb, 122, 2, 2), 0.7)",
            fontSize: 15, fontWeight: 700, letterSpacing: 0.5,
          }}
        >
          {getInitials(name)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 500, color: "var(--muted-foreground, #6b6b72)", letterSpacing: 0.2 }}>
            {dateStr} · {timeStr}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2, margin: "1px 0", whiteSpace: "nowrap", color: "var(--ink, #1a0204)" }}>
            {greeting}, {name} <span aria-hidden>👋</span>
          </div>
          {subParts.length > 0 && (
            <div style={{ fontSize: 11.5, color: "var(--muted-foreground, #6b6b72)" }}>{subParts.join(" · ")}</div>
          )}
        </div>
      </div>
      {actions && (
        <div className="module-header__actions" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {actions}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { role } = useRole();
  const access = useAccess();
  // KPI cards are permissioned elements — hidden when the role lacks view.
  const showKpi = (id: string) => canElement(role, "/", id, "view", access);
  const [period, setPeriod] = useState<Period>("today");
  const [range, setRange] = useState<DateRange | null>(null);
  const data = useDashboardKpis(period, range ?? undefined);
  // Same packaging source + status computation as the Dispatch page, so the
  // tracker panel mirrors the real module list (flights, DSP refs, statuses).
  const { qcClearedFlights, dispatchApprovals } = useWorkflow();
  const flightOrders = useFlightOrders();
  const [packagingRows] = usePersistedState<PackagingRow[]>("dispatch-packaging-rows", INITIAL_PACKAGING_ROWS);
  const dispatchList = buildDispatchList(packagingRows, qcClearedFlights, dispatchApprovals);
  const sectorFor = (flight: string) =>
    flightOrders.find((o) => o.flight === flight)?.sector ??
    flights.find((f) => f.flight === flight)?.sector ??
    "—";

  // Show the post-login welcome message once, handed off from the sign-in flow.
  // Deferred via setTimeout so the <Toaster> in the shell has subscribed to sonner's
  // store before we fire — firing during mount races (and loses) the subscription.
  useEffect(() => {
    const id = setTimeout(() => {
      let payload: { name?: string; role?: string } | null = null;
      try {
        const raw = sessionStorage.getItem("welcome-toast");
        if (raw) {
          payload = JSON.parse(raw);
          sessionStorage.removeItem("welcome-toast");
        }
      } catch {
        /* ignore storage errors */
      }
      if (payload?.name) {
        const role = payload.role ?? "";
        toast.success(`Welcome back, ${payload.name}! 👋`, {
          description: role ? `Signed in as ${role}.` : undefined,
          duration: 5000,
        });
      }
    }, 120);
    return () => clearTimeout(id);
  }, []);

  const periodLabel =
    period === "today" ? "Today's"
    : period === "week" ? "Weekly"
    : period === "month" ? "Monthly"
    : period === "quarter" ? "Quarterly"
    : period === "year" ? "Yearly"
    : range ? `${range.from} → ${range.to}` : "Custom";

  // Export Report — build a CSV snapshot of the current KPI tiles for the
  // selected period and trigger a download (no backend; mirrors DataTable's
  // client-side CSV export).
  const exportReport = () => {
    const k = data.kpis;
    const metricRows: (string | number)[][] = [
      ["Flights", k.flights.value, k.flights.sub],
      ["Meals Prepared", k.meals.value, k.meals.sub],
      ["Delayed Flights", k.delayed.value, k.delayed.sub],
      ["QC Issues", k.qcIssues.value, k.qcIssues.sub],
      ["Pending POs", k.pendingPOs.value, k.pendingPOs.sub],
      ["Inventory Alerts", k.invAlerts.value, k.invAlerts.sub],
      ["Dispatch Active", k.dispatch.value, k.dispatch.sub],
      ["Stock Value", k.dailyCost.value, k.dailyCost.sub],
    ];
    const lines: (string | number)[][] = [
      ["AeroGalley Catering — Dashboard Report"],
      ["Period", periodLabel],
      ["Generated", new Date().toLocaleString("en-GB")],
      [],
      ["Metric", "Value", "Detail"],
      ...metricRows,
    ];
    const csv = lines
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-report-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${periodLabel} report exported.`);
  };

  return (
    <>
      <DashboardGreeting
        actions={
          <>
            <div className="dashboard-filter-group" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
              <Segmented<string>
                size="small"
                className="period-segmented"
                value={period === "custom" ? "" : period}
                onChange={(val) => { setPeriod(val as Period); setRange(null); }}
                options={[
                  { label: "Today",        value: "today"   },
                  { label: "This Week",    value: "week"    },
                  { label: "This Month",   value: "month"   },
                  { label: "This Quarter", value: "quarter" },
                  { label: "This Year",    value: "year"    },
                ]}
              />
              <CustomRangePicker
                active={period === "custom"}
                range={range}
                onApply={(r) => { setRange(r); setPeriod("custom"); }}
                onClear={() => { setRange(null); setPeriod("today"); }}
              />
            </div>
            <span aria-hidden className="dashboard-action-divider" />
            <Button
              type="default"
              size="small"
              className="export-report-btn"
              icon={<DownloadOutlined />}
              onClick={exportReport}
            >
              Export Report
            </Button>
          </>
        }
      />

      {/* Spacer — brand stripe removed, spacing preserved */}
      <div style={{ height: 3, margin: '18px 0 22px' }} aria-hidden />

      {data.lmc.count > 0 && (
        <Link
          to="/order-management?lmc=1"
          onClick={() => flagArrival("active-orders")}
          className="mb-4 flex items-center gap-3 rounded-xl border px-4 py-3 no-underline"
          style={{
            borderColor: data.lmc.critical > 0 ? "#fda4af" : "#fcd34d",
            background: data.lmc.critical > 0 ? "#fff1f2" : "#fffbeb",
            color: "inherit",
          }}
        >
          <WarningOutlined style={{ color: data.lmc.critical > 0 ? "#e11d48" : "#b45309", fontSize: 18 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1a0204" }}>
              {data.lmc.count} last-minute change{data.lmc.count === 1 ? "" : "s"} today
            </div>
            <div style={{ fontSize: 12, color: "var(--color-muted-foreground)" }}>
              {data.lmc.critical} critical · {data.lmc.major} major — review affected orders
            </div>
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#6d28d9" }}>Review →</span>
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {showKpi("kpi-flights") && (
        <KpiLink to="/order-management" highlight="active-orders" ids={data.kpis.flights.ids}>
          <KpiCard label="Flights Today"   value={data.kpis.flights.value}   sub={data.kpis.flights.sub}   icon={RocketOutlined}            tone="violet" variant="aurora" breakdown={data.kpis.flights.breakdown} hint="Flight legs to be catered today, versus yesterday's count." />
        </KpiLink>
        )}
        {showKpi("kpi-meals") && (
        <KpiLink to="/production-entry" highlight="production-list" ids={data.kpis.meals.ids}>
          <KpiCard label="Meals Prepared"  value={data.kpis.meals.value}     sub={data.kpis.meals.sub}     icon={CoffeeOutlined}            tone="green" variant="aurora" breakdown={data.kpis.meals.breakdown} hint="Meals produced so far today against the planned target." />
        </KpiLink>
        )}
        {showKpi("kpi-delayed") && (
        <KpiLink to="/delay-management">
          <KpiCard label="Delayed Flights" value={data.kpis.delayed.value}   sub={data.kpis.delayed.sub}   icon={WarningOutlined}           tone="amber" variant="aurora" breakdown={data.kpis.delayed.breakdown} hint="Flights delayed today and the passengers affected." />
        </KpiLink>
        )}
        {showKpi("kpi-qc") && (
        <KpiLink to="/cooking-temp" highlight="qc-issues" ids={data.kpis.qcIssues.ids}>
          <KpiCard label="QC Issues"       value={data.kpis.qcIssues.value}  sub={data.kpis.qcIssues.sub}  icon={SafetyCertificateOutlined} tone="rose" variant="aurora" breakdown={data.kpis.qcIssues.breakdown} hint="Open food-safety checks still to be resolved." />
        </KpiLink>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        {showKpi("kpi-pos") && (
        <KpiLink to="/procurement" highlight="po-list" ids={data.kpis.pendingPOs.ids}>
          <KpiCard label="Pending POs"      value={data.kpis.pendingPOs.value} sub={data.kpis.pendingPOs.sub} icon={ShoppingCartOutlined} tone="blue" variant="aurora" breakdown={data.kpis.pendingPOs.breakdown} hint="Purchase orders awaiting approval, with total value." />
        </KpiLink>
        )}
        {showKpi("kpi-inv") && (
        <KpiLink to="/inventory" highlight="inv-alerts" ids={data.kpis.invAlerts.ids}>
          <KpiCard label="Stock Alert"      value={data.kpis.invAlerts.value}  sub={data.kpis.invAlerts.sub}  icon={InboxOutlined}        tone="teal" variant="aurora" breakdown={data.kpis.invAlerts.breakdown} hint="Stock items running low or near expiry that need attention." />
        </KpiLink>
        )}
        {showKpi("kpi-dispatch") && (
        <KpiLink to="/dispatch" highlight="dispatch-list" ids={data.kpis.dispatch.ids}>
          <KpiCard label="Ready For Dispatch" value={data.kpis.dispatch.value} sub={data.kpis.dispatch.sub}   icon={CarOutlined}          tone="indigo" variant="aurora" breakdown={data.kpis.dispatch.breakdown} hint="Meal batches in dispatch, with how many are ready to load." />
        </KpiLink>
        )}
        {showKpi("kpi-cost") && (
        <KpiLink to="/inventory" highlight="inv-value">
          <KpiCard label="Stock Value"      value={data.kpis.dailyCost.value}  sub={data.kpis.dailyCost.sub}  icon={DollarOutlined}       tone="fuchsia" variant="aurora" breakdown={data.kpis.dailyCost.breakdown} hint="Current on-hand value of all inventory in stock." />
        </KpiLink>
        )}
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
        <PanelCard title="Dispatch Tracker" link="/dispatch" linkLabel="View all →" highlight="dispatch-list">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dispatchList.slice(0, 5).map((d) => (
              <Link
                key={d.dspId ?? d.flight}
                to="/dispatch"
                onClick={() => flagArrival({ target: "dispatch-list", ids: d.rowIds })}
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
                  <div style={{ fontWeight: 500 }}>{d.dspId ? `${d.dspId} — ${d.flight}` : d.flight}</div>
                  <div style={{ fontSize: 12, color: "var(--color-muted-foreground)" }}>
                    {sectorFor(d.flight)} • Dep {d.depTime}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${FLIGHT_STATUS_BADGE[d.status] ?? "bg-muted text-muted-foreground"}`}>
                  {d.status}
                </span>
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
  // Split flight vs crew orders the same way the Order Management table does
  // (orderType "crew" → Crew tab, everything else → Flight tab), so each tab
  // shows the real orders from that table rather than the same list twice.
  const tabRows = rows.filter((r) =>
    tab === "crew" ? r.orderType === "crew" : (r.orderType ?? "flight") !== "crew",
  );
  const groups = groupActiveByOrder(tabRows, 5);

  // Span the panel body edge-to-edge so the tab rule + scroll list align to the
  // card like the mockup, then re-apply the design's own paddings inside.
  return (
    <div style={{ margin: "-18px -22px" }}>
      <div style={{ display: "flex", gap: 22, padding: "0 22px", borderBottom: "1px solid var(--line, #f0ebe8)" }}>
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
  // Big orders (many flights) would otherwise make one card swallow the panel.
  // Cap the visible legs and link the rest into Order Management (?ord=).
  const MAX_LEGS = 4;
  const shownLegs = legs.slice(0, MAX_LEGS);
  const hiddenCount = legs.length - shownLegs.length;

  return (
    <div style={{
      border: "1px solid var(--line, #e9e4e1)", borderRadius: 13, marginTop: 12,
      overflow: "hidden", background: "var(--color-bg-surface, #fff)",
    }}>
      {/* group header */}
      <Link
        to={`/order-management?ord=${encodeURIComponent(orderNo)}`}
        onClick={() => flagArrival({ target: "active-orders", ids: legIds })}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 15px",
          background: "var(--color-bg-subtle, #fbf8f6)", borderBottom: "1px solid var(--line, #f0ebe8)",
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

      {/* legs (capped — the rest open in Order Management) */}
      {shownLegs.map((l, idx) => (
        <Link
          key={l.id}
          to={`/order-management?ord=${encodeURIComponent(orderNo)}`}
          onClick={() => flagArrival({ target: "active-orders", ids: [l.id] })}
          style={{
            display: "flex", alignItems: "center", gap: 12, padding: "11px 15px",
            borderTop: idx > 0 ? "1px solid var(--line, #f0ebe8)" : "none",
            textDecoration: "none", color: "inherit", transition: "background-color 150ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-subtle, #fff5f5)")}
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

      {hiddenCount > 0 && (
        <Link
          to={`/order-management?ord=${encodeURIComponent(orderNo)}`}
          onClick={() => flagArrival({ target: "active-orders", ids: legIds })}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "10px 15px", borderTop: "1px solid var(--line, #f0ebe8)",
            fontSize: 12.5, fontWeight: 600, color: "#E10101",
            textDecoration: "none", background: "var(--color-bg-subtle, #fbf8f6)",
            transition: "background-color 150ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-base, #fff5f5)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-bg-subtle, #fbf8f6)")}
        >
          + {hiddenCount} more flight{hiddenCount === 1 ? "" : "s"} →
        </Link>
      )}
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
    <div style={{ width: "min(280px, calc(100vw - 32px))", maxWidth: "100%" }}>
      <div className="field-label" style={{ marginBottom: 8 }}>Custom Date Range</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 12 }}>
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
    | "/procurement" | "/inventory" | "/dispatch" | "/delay-management";
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
