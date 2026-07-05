import { useMemo } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Truck, PackageCheck, Clock, Send, CheckCircle2, AlertCircle, Package, Warehouse,
} from "lucide-react";
import {
  INITIAL_RECORDS, INITIAL_PACKAGING_ROWS, STATUS_BADGE,
  type DispatchRecord, type DispatchStatus, type PackagingRow,
} from "@/routes/dispatch";
import { warehouses } from "@/lib/sample-data";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

// Dispatch lifecycle order + chart colours — mirrors the DispatchStatus union
// used by the Dispatch module (src/routes/dispatch.tsx).
const STATUS_ORDER: DispatchStatus[] = [
  "Preparing", "Prepared", "Ready For QC", "Ready For Dispatch", "Dispatched",
];
const STATUS_HEX: Record<DispatchStatus, string> = {
  "Preparing":          "#94A3B8",
  "Prepared":           "#3B82F6",
  "Ready For QC":       "#F59E0B",
  "Ready For Dispatch": "#7C3AED",
  "Dispatched":         "#059669",
  "Returned":           "#E11D48",
};

const warehouseName = (id?: string) => warehouses.find((w) => w.id === id)?.name ?? "—";

export default function PackagingDispatchOverviewPage() {
  // Read the same persisted stores the Dispatch module writes, so the dashboard
  // always reflects live dispatch records and packaging rows (no stale seed).
  const [records] = usePersistedState<DispatchRecord[]>("dispatch-records", INITIAL_RECORDS);
  const [packagingRows] = usePersistedState<PackagingRow[]>("dispatch-packaging-rows", INITIAL_PACKAGING_ROWS);

  const stats = useMemo(() => {
    const byStatus = records.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    const count = (s: DispatchStatus) => byStatus[s] ?? 0;
    const total = records.length;
    const dispatched = count("Dispatched");
    const readyForDispatch = count("Ready For Dispatch");
    const readyForQc = count("Ready For QC");
    const preparing = count("Preparing") + count("Prepared");
    const dispatchedPct = total > 0 ? Math.round((dispatched / total) * 100) : 0;

    const totalMeals = records.reduce((s, r) => s + (r.detail?.flightKitchen?.totalMeals ?? 0), 0);
    const flights = new Set(records.flatMap((r) => r.flightNos)).size;
    const routes = new Set(
      records
        .filter((r) => r.fromWarehouseId && r.toWarehouseId)
        .map((r) => `${r.fromWarehouseId}→${r.toWarehouseId}`),
    ).size;

    // Status mix (lifecycle order, only non-empty buckets).
    const pieData = STATUS_ORDER
      .map((name) => ({ name, value: byStatus[name] ?? 0 }))
      .filter((d) => d.value > 0);

    // Meals packaged per flight (from the packaging pipeline rows).
    const byFlight = packagingRows.reduce<Record<string, number>>((acc, r) => {
      acc[r.flight] = (acc[r.flight] ?? 0) + r.qty;
      return acc;
    }, {});
    const flightChart = Object.entries(byFlight)
      .map(([flight, meals]) => ({ flight, meals }))
      .sort((a, b) => b.meals - a.meals)
      .slice(0, 10);

    return {
      total, dispatched, readyForDispatch, readyForQc, preparing, dispatchedPct,
      totalMeals, flights, routes, pieData, flightChart,
    };
  }, [records, packagingRows]);

  return (
    <>
      <PageHeader
        title="Dispatch Dashboard"
        subtitle="Dispatch lifecycle status, meal volumes, warehouse routing and packaging progress"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard label="Total Dispatches"   value={stats.total.toLocaleString()} icon={Truck} tone="navy" />
        <KpiCard label="Preparing"          value={stats.preparing.toLocaleString()} icon={Clock} tone="warning" sub="Preparing + Prepared" />
        <KpiCard label="Ready For QC"       value={stats.readyForQc.toLocaleString()} icon={AlertCircle} tone="warning" />
        <KpiCard label="Ready For Dispatch" value={stats.readyForDispatch.toLocaleString()} icon={PackageCheck} tone="navy" />
        <KpiCard label="Dispatched"         value={stats.dispatched.toLocaleString()} icon={CheckCircle2} tone="success" sub={`${stats.dispatchedPct}% of all`} />
        <KpiCard label="Total Meals"        value={stats.totalMeals.toLocaleString()} icon={Package} tone="navy" />
        <KpiCard label="Flights"            value={stats.flights.toLocaleString()} icon={Send} tone="navy" />
        <KpiCard label="Warehouse Routes"   value={stats.routes.toLocaleString()} icon={Warehouse} tone="navy" sub="From → To" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Dispatch Mix by Status</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {stats.pieData.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">No dispatch records.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                       label={(e) => `${e.name}: ${e.value}`}>
                    {stats.pieData.map((d) => <Cell key={d.name} fill={STATUS_HEX[d.name as DispatchStatus] ?? "#64748b"} />)}
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Meals Packaged by Flight</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {stats.flightChart.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">No packaging rows.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.flightChart} margin={{ top: 8, right: 16, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="flight" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="meals" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider">Active Dispatches</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">Dispatch #</th>
                  <th className="p-3 text-left font-semibold">Date</th>
                  <th className="p-3 text-left font-semibold">Dep</th>
                  <th className="p-3 text-left font-semibold">Flights</th>
                  <th className="p-3 text-left font-semibold">Kitchen</th>
                  <th className="p-3 text-left font-semibold">Route</th>
                  <th className="p-3 text-right font-semibold">Meals</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 && (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No dispatch records.</td></tr>
                )}
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{r.id}</td>
                    <td className="p-3 whitespace-nowrap tabular-nums">{r.date}</td>
                    <td className="p-3 whitespace-nowrap tabular-nums">{r.depTime}</td>
                    <td className="p-3 whitespace-nowrap">{r.flightNos.join(", ")}</td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">{r.kitchenName}</td>
                    <td className="p-3 whitespace-nowrap">
                      {r.fromWarehouseId && r.toWarehouseId ? (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          {warehouseName(r.fromWarehouseId)}
                          <Send className="h-3 w-3 text-muted-foreground" />
                          {warehouseName(r.toWarehouseId)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums">{(r.detail?.flightKitchen?.totalMeals ?? 0).toLocaleString()}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[r.status] ?? "bg-muted text-foreground"}`}>
                        {r.status}
                      </span>
                    </td>
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
