import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Truck, PackageCheck, Clock, Send, CheckCircle2, AlertCircle, Package, User,
} from "lucide-react";
import { dispatch, qcChecks } from "@/lib/sample-data";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  Scheduled: "#94a3b8",
  Preparing: "#F59E0B",
  Loading: "#D97706",
  Loaded: "#0EA5E9",
  "En Route": "#7C3AED",
  "In Transit": "#0EA5E9",
  Delivered: "#059669",
  Delayed: "#EF4444",
};

const STATUS_BADGE: Record<string, string> = {
  Scheduled: "bg-slate-100 text-slate-700",
  Preparing: "bg-amber-100 text-amber-800",
  Loading: "bg-amber-100 text-amber-800",
  Loaded: "bg-sky-100 text-sky-800",
  "En Route": "bg-violet-100 text-violet-800",
  Delivered: "bg-emerald-100 text-emerald-800",
  Delayed: "bg-red-100 text-red-800",
};

export default function PackagingDispatchOverviewPage() {
  const stats = useMemo(() => {
    const byStatus = dispatch.reduce<Record<string, number>>((acc, d) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1;
      return acc;
    }, {});
    const delivered = byStatus.Delivered ?? 0;
    const inTransit = (byStatus["En Route"] ?? 0) + (byStatus["In Transit"] ?? 0);
    const preparing = (byStatus.Preparing ?? 0) + (byStatus.Loading ?? 0);
    const total = dispatch.length;
    const onTime = total > 0 ? Math.round((delivered / total) * 100) : 0;
    const totalTrays = dispatch.reduce((s, d) => s + d.trays, 0);
    const totalCarts = dispatch.reduce((s, d) => s + d.carts, 0);
    const distinctVehicles = new Set(dispatch.map((d) => d.vehicle)).size;

    const pieData = Object.entries(byStatus).map(([name, value]) => ({ name, value }));

    // Load per vehicle (trays)
    const byVehicle = dispatch.reduce<Record<string, number>>((acc, d) => {
      acc[d.vehicle] = (acc[d.vehicle] ?? 0) + d.trays;
      return acc;
    }, {});
    const vehicleChart = Object.entries(byVehicle).map(([vehicle, trays]) => ({ vehicle, trays }));

    // QC results
    const qcPass = qcChecks.filter((q) => q.result === "Pass").length;
    const qcFail = qcChecks.filter((q) => q.result === "Fail").length;

    return {
      total, byStatus, delivered, inTransit, preparing, onTime,
      totalTrays, totalCarts, distinctVehicles, qcPass, qcFail,
      pieData, vehicleChart,
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Dispatch Dashboard"
        subtitle="Outbound load status, transit visibility, vehicle utilisation and QC"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard label="Total Loads"   value={stats.total.toLocaleString()} icon={Truck} tone="navy" />
        <KpiCard label="Preparing"     value={stats.preparing.toLocaleString()} icon={Clock} tone="warning" />
        <KpiCard label="In Transit"    value={stats.inTransit.toLocaleString()} icon={Send} tone="warning" />
        <KpiCard label="Delivered"     value={stats.delivered.toLocaleString()} icon={CheckCircle2} tone="success" sub={`${stats.onTime}% complete`} />
        <KpiCard label="Trays Out"     value={stats.totalTrays.toLocaleString()} icon={Package} tone="navy" sub={`${stats.totalCarts} carts`} />
        <KpiCard label="Vehicles"      value={stats.distinctVehicles.toLocaleString()} icon={Truck} tone="navy" sub="On trip" />
        <KpiCard label="QC Pass"       value={stats.qcPass.toLocaleString()} icon={PackageCheck} tone="success" sub={`${qcChecks.length} checks`} />
        <KpiCard label="QC Fail"       value={stats.qcFail.toLocaleString()} icon={AlertCircle} tone="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Dispatch Mix by Status</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats.pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                     label={(e) => `${e.name}: ${e.value}`}>
                  {stats.pieData.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name] ?? "#64748b"} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Vehicle Load (Trays)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.vehicleChart} margin={{ top: 8, right: 16, left: 0, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="vehicle" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="trays" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
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
                  <th className="p-3 text-left font-semibold">Flight</th>
                  <th className="p-3 text-right font-semibold">Trays</th>
                  <th className="p-3 text-right font-semibold">Carts</th>
                  <th className="p-3 text-left font-semibold">Vehicle</th>
                  <th className="p-3 text-left font-semibold">Driver</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {dispatch.map((d) => (
                  <tr key={d.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{d.id}</td>
                    <td className="p-3 whitespace-nowrap">{d.flight}</td>
                    <td className="p-3 text-right">{d.trays}</td>
                    <td className="p-3 text-right">{d.carts}</td>
                    <td className="p-3 text-muted-foreground">{d.vehicle}</td>
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        {d.driver}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[d.status] ?? "bg-muted text-foreground"}`}>
                        {d.status}
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
