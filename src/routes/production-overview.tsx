import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Factory, ClipboardCheck, BarChart3, Activity, Gauge,
} from "lucide-react";
import { useWorkflow } from "@/lib/workflow-store";
import { usePersistedState } from "@/lib/use-persisted-state";
import { cookingTempLogs } from "@/lib/sample-data";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  Pending: "#D97706",
  Approved: "#0EA5E9",
  "In Preparation": "#7C3AED",
  "Ready for QC": "#F59E0B",
  Completed: "#059669",
};

const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-amber-100 text-amber-800",
  Approved: "bg-sky-100 text-sky-800",
  "In Preparation": "bg-violet-100 text-violet-800",
  "Ready for QC": "bg-orange-100 text-orange-800",
  Completed: "bg-emerald-100 text-emerald-800",
};

export default function ProductionOverviewPage() {
  const { productionEntries, productionEntryRecords } = useWorkflow();
  // Cooking Temp & Sensory records — read the same persisted store the QC page
  // owns (seeded identically so this read never changes that page's data) to
  // split the QC pass rate into Temp vs Taste dimensions.
  type CtRecord = { measuredTemp: number; standardTempMin: number; sensoryPass: boolean };
  const [ctRecords] = usePersistedState<CtRecord[]>(
    "cooking-temp-records",
    () => cookingTempLogs.map((r) => ({ ...r, date: "2026-05-22" })),
  );

  const stats = useMemo(() => {
    const byStatus = productionEntries.reduce<Record<string, number>>((acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    }, {});
    const totalOrderQty = productionEntries.reduce((s, o) => s + (o.orderQty ?? 0), 0);
    const totalProducedQty = productionEntries.reduce((s, o) => s + o.producedQty, 0);
    const fulfillment = totalOrderQty > 0 ? Math.round((totalProducedQty / totalOrderQty) * 100) : 0;
    const completed = productionEntries.filter((o) => o.status === "Completed");
    const qcPass = completed.filter((o) => o.qcPassedAt).length;
    const qcRate = completed.length > 0 ? Math.round((qcPass / completed.length) * 100) : 0;

    // Date windows for "next 24 hours" (Total Order) and "last 7 days"
    // (Repeated Produced Items).
    const pad = (n: number) => String(n).padStart(2, "0");
    const toStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date();
    const todayStr = toStr(now);
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = toStr(tomorrow);
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
    const weekAgoStr = toStr(weekAgo);

    // Total orders due to be produced in the next 24 hours.
    const next24Count = productionEntries.filter(
      (o) => o.date && o.date >= todayStr && o.date <= tomorrowStr,
    ).length;

    // Sourcing mix — of all production orders, the share already moving through
    // in-house production vs. the remainder still to be sourced (instant
    // purchase). A demo proxy: the codebase has no explicit purchase-source flag
    // on production orders, so this is derived from the pipeline stage.
    const inHouseStages = ["Production Initiation", "In Preparation", "Ready for QC", "Completed"];
    const producedInHouse = productionEntries.filter((o) => inHouseStages.includes(o.status)).length;
    const productionPct = productionEntries.length ? Math.round((producedInHouse / productionEntries.length) * 100) : 0;
    const instantPurchasePct = productionEntries.length ? 100 - productionPct : 0;

    // Wastage — disposed quantity (from approved wastage reports) as a share of
    // everything produced (remaining produced + disposed).
    const disposedTotal = productionEntries.reduce((s, o) => s + (o.disposedQty ?? 0), 0);
    const wastagePct = (totalProducedQty + disposedTotal) > 0
      ? Math.round((disposedTotal / (totalProducedQty + disposedTotal)) * 100)
      : 0;

    // Repeated Produced Items — items appearing on more than one production order
    // in the last 7 days, most-repeated first.
    const itemCounts = new Map<string, number>();
    for (const o of productionEntries) {
      if (o.date && o.date >= weekAgoStr) {
        const key = o.outputItemName ?? o.bom ?? "(unknown)";
        itemCounts.set(key, (itemCounts.get(key) ?? 0) + 1);
      }
    }
    const repeatedItems = Array.from(itemCounts.entries())
      .filter(([, c]) => c > 1)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([item, count]) => ({ item, count }));

    // Top items produced (by total producedQty across all records)
    const itemTotals = new Map<string, number>();
    for (const r of productionEntryRecords) {
      const key = r.outputItemName ?? r.bom ?? "(unknown)";
      itemTotals.set(key, (itemTotals.get(key) ?? 0) + r.producedQty);
    }
    const topItems = Array.from(itemTotals.entries())
      .sort(([, a], [, b]) => b - a).slice(0, 6)
      .map(([item, qty]) => ({ item, qty }));

    // Recent recorded runs (newest first by id desc)
    const recentRuns = [...productionEntryRecords]
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id))
      .slice(0, 8);

    return {
      totalOrders: productionEntries.length,
      byStatus, totalOrderQty, totalProducedQty, fulfillment, qcRate,
      recordedRuns: productionEntryRecords.length,
      next24Count, productionPct, instantPurchasePct, wastagePct, repeatedItems,
      topItems, recentRuns,
    };
  }, [productionEntries, productionEntryRecords]);

  // QC failure rates from the Cooking Temp & Sensory records — overall QC fail,
  // plus its temperature vs taste split.
  const qcRates = useMemo(() => {
    if (ctRecords.length === 0) return { qcFailRate: 0, tempFailRate: 0, tasteFailRate: 0 };
    // Overall fail = batch didn't pass (temperature OR taste).
    const qcFail = ctRecords.filter((r) => !r.sensoryPass).length;
    const tempFail = ctRecords.filter((r) => r.measuredTemp < r.standardTempMin).length;
    // A batch that met temperature but still failed overall failed on taste.
    const tasteFail = ctRecords.filter((r) => !r.sensoryPass && r.measuredTemp >= r.standardTempMin).length;
    return {
      qcFailRate: Math.round((qcFail / ctRecords.length) * 100),
      tempFailRate: Math.round((tempFail / ctRecords.length) * 100),
      tasteFailRate: Math.round((tasteFail / ctRecords.length) * 100),
    };
  }, [ctRecords]);

  const pieData = Object.entries(stats.byStatus).map(([status, count]) => ({ name: status, value: count }));

  return (
    <>
      <PageHeader
        title="Production Dashboard"
        subtitle="Production-order pipeline, fulfilment progress, and recorded runs"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <KpiCard
          label="Production Orders" value={stats.totalOrders.toLocaleString()} icon={Factory}
          tone="violet" variant="aurora"
          sub={`${(stats.byStatus.Completed ?? 0).toLocaleString()} completed`}
          hint="All production orders in the pipeline, by current stage."
          breakdown={[
            { label: "Approved",       value: (stats.byStatus.Approved ?? 0).toLocaleString(),         icon: "🔵" },
            { label: "In Preparation", value: (stats.byStatus["In Preparation"] ?? 0).toLocaleString(), icon: "👨‍🍳" },
            { label: "Pending",        value: (stats.byStatus.Pending ?? 0).toLocaleString(),          icon: "⏳" },
            { label: "Ready for QC",   value: (stats.byStatus["Ready for QC"] ?? 0).toLocaleString(),  icon: "🧪" },
          ]}
        />
        <KpiCard
          label="Total Order" value={stats.next24Count.toLocaleString()} icon={ClipboardCheck}
          tone="blue" variant="aurora"
          sub="For next 24 hours"
          hint="Orders due to produce in the next 24 hours."
          breakdown={[
            { label: "Unit Produced", value: stats.totalProducedQty.toLocaleString(),                icon: "📦" },
            { label: "Ready For QC",  value: (stats.byStatus["Ready for QC"] ?? 0).toLocaleString(), icon: "🧪" },
          ]}
        />
        <KpiCard
          label="Fulfilment" value={`${stats.fulfillment}%`} icon={Gauge}
          tone="teal" variant="aurora"
          sub="produced / ordered"
          hint="Fulfilment progress and how demand is being sourced."
          breakdown={[
            { label: "Produced",         value: `${stats.fulfillment}%`,        icon: "✅" },
            { label: "Ordered",          value: "100%",                        icon: "📋" },
            { label: "Production",       value: `${stats.productionPct}%`,      icon: "🍳" },
            { label: "Instant Purchase", value: `${stats.instantPurchasePct}%`, icon: "🛒" },
          ]}
        />
        <KpiCard
          label="QC Pass Rate" value={`${stats.qcRate}%`} icon={Activity}
          tone="green" variant="aurora"
          sub={`${stats.recordedRuns} runs logged`}
          hint="Pass rate with the failure split: temperature, taste, and wastage."
          breakdown={[
            { label: "QC Failed",    value: `${qcRates.qcFailRate}%`,    icon: "❌" },
            { label: "Temp Failed",  value: `${qcRates.tempFailRate}%`,  icon: "🌡️" },
            { label: "Taste Failed", value: `${qcRates.tasteFailRate}%`, icon: "👅" },
            { label: "Wastage",      value: `${stats.wastagePct}%`,      icon: "🗑️" },
          ]}
        />
        <KpiCard
          label="Repeated Produced Items (Last 7 days)" value={stats.repeatedItems.length} icon={BarChart3}
          tone="amber" variant="aurora"
          sub="last 7 days"
          hint="Items produced on more than one order in the last 7 days."
          breakdown={
            stats.repeatedItems.length > 0
              ? stats.repeatedItems.map((r) => ({ label: r.item, value: r.count, icon: "🍽️" }))
              : [{ label: "No repeats", value: 0, icon: "—" }]
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Orders by Status</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                     label={(e) => `${e.name}: ${e.value}`}>
                  {pieData.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name] ?? "#64748b"} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Top Produced Items</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.topItems} layout="vertical" margin={{ top: 8, right: 16, left: 100, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="item" tick={{ fontSize: 11 }} width={110} />
                <Tooltip />
                <Bar dataKey="qty" fill="#0EA5E9" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider">Recent Production Runs</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">Run #</th>
                  <th className="p-3 text-left font-semibold">Production Order</th>
                  <th className="p-3 text-left font-semibold">Item</th>
                  <th className="p-3 text-left font-semibold">Shift</th>
                  <th className="p-3 text-left font-semibold">Produced By</th>
                  <th className="p-3 text-left font-semibold">Date</th>
                  <th className="p-3 text-right font-semibold">Qty</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentRuns.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No production runs recorded yet.</td></tr>
                ) : stats.recentRuns.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{r.id}</td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">{r.productionOrderId}</td>
                    <td className="p-3">{r.outputItemName ?? "—"}</td>
                    <td className="p-3">{r.shift ?? "—"}</td>
                    <td className="p-3">{r.producedBy}</td>
                    <td className="p-3 whitespace-nowrap">{r.date}</td>
                    <td className="p-3 text-right font-medium">{r.producedQty.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
