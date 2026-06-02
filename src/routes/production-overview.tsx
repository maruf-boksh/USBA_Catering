import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Factory, ClipboardCheck, CheckCircle2, AlertCircle, Layers, BarChart3,
  Activity, Gauge,
} from "lucide-react";
import { useWorkflow } from "@/lib/workflow-store";
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
      topItems, recentRuns,
    };
  }, [productionEntries, productionEntryRecords]);

  const pieData = Object.entries(stats.byStatus).map(([status, count]) => ({ name: status, value: count }));

  return (
    <>
      <PageHeader
        title="Production Dashboard"
        subtitle="Production-order pipeline, fulfilment progress, and recorded runs"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard label="Production Orders" value={stats.totalOrders.toLocaleString()} icon={Factory} tone="navy" />
        <KpiCard label="Pending"           value={(stats.byStatus.Pending ?? 0).toLocaleString()} icon={AlertCircle} tone="warning" />
        <KpiCard label="In Preparation"    value={(stats.byStatus["In Preparation"] ?? 0).toLocaleString()} icon={Layers} tone="warning" />
        <KpiCard label="Ready for QC"      value={(stats.byStatus["Ready for QC"] ?? 0).toLocaleString()} icon={ClipboardCheck} tone="warning" />
        <KpiCard label="Completed"         value={(stats.byStatus.Completed ?? 0).toLocaleString()} icon={CheckCircle2} tone="success" />
        <KpiCard label="Units Produced"    value={stats.totalProducedQty.toLocaleString()} icon={BarChart3} tone="success" sub={`${stats.totalOrderQty.toLocaleString()} ordered`} />
        <KpiCard label="Fulfilment"        value={`${stats.fulfillment}%`} icon={Gauge} tone={stats.fulfillment >= 80 ? "success" : "warning"} sub="produced / ordered" />
        <KpiCard label="QC Pass Rate"      value={`${stats.qcRate}%`} icon={Activity} tone={stats.qcRate >= 90 ? "success" : "warning"} sub={`${stats.recordedRuns} runs logged`} />
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
