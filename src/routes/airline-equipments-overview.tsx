import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ScanBarcode, Wrench, CheckCircle2, AlertOctagon, Undo2, ShieldAlert, Activity, Plane,
} from "lucide-react";
import { equipmentAssets, equipmentReturns, damageReports } from "@/lib/sample-data";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  "In Service": "#059669",
  "In Maintenance": "#D97706",
  Damaged: "#EF4444",
  Retired: "#94a3b8",
};

const STATUS_BADGE: Record<string, string> = {
  "In Service": "bg-emerald-100 text-emerald-800",
  "In Maintenance": "bg-amber-100 text-amber-800",
  Damaged: "bg-red-100 text-red-800",
  Retired: "bg-slate-100 text-slate-700",
};

const SEVERITY_BADGE: Record<string, string> = {
  Minor: "bg-amber-100 text-amber-800",
  Moderate: "bg-orange-100 text-orange-800",
  Severe: "bg-red-100 text-red-800",
};

const CONDITION_BADGE: Record<string, string> = {
  Good: "bg-emerald-100 text-emerald-800",
  "Minor Issue": "bg-amber-100 text-amber-800",
  Damaged: "bg-red-100 text-red-800",
};

export default function AirlineEquipmentsOverviewPage() {
  const today = new Date();

  const stats = useMemo(() => {
    const byStatus = equipmentAssets.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    }, {});
    const byCategory = equipmentAssets.reduce<Record<string, number>>((acc, a) => {
      acc[a.category] = (acc[a.category] ?? 0) + 1;
      return acc;
    }, {});

    // Maintenance due ≤ 30 days
    const cutoff = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
    const dueWithin30 = equipmentAssets.filter((a) => a.nextMaintenance && a.nextMaintenance <= cutoff && a.status === "In Service").length;

    // Open damage reports
    const openDamage = damageReports.filter((d) => /open|under repair/i.test(d.status)).length;
    const severeOpen = damageReports.filter((d) => d.severity === "Severe" && !/repaired/i.test(d.status)).length;

    // Equipment with minor issues / damage on return
    const damagedReturns = equipmentReturns.filter((r) => r.condition !== "Good").length;

    const pieData = Object.entries(byStatus).map(([name, value]) => ({ name, value }));
    const categoryChart = Object.entries(byCategory).map(([category, count]) => ({ category, count }));

    return {
      total: equipmentAssets.length,
      byStatus,
      inService: byStatus["In Service"] ?? 0,
      inMaintenance: byStatus["In Maintenance"] ?? 0,
      damaged: byStatus.Damaged ?? 0,
      retired: byStatus.Retired ?? 0,
      dueWithin30, openDamage, severeOpen, damagedReturns,
      pieData, categoryChart,
      types: Object.keys(byCategory).length,
      recentReturns: equipmentReturns.slice(0, 8),
    };
  }, [today]);

  return (
    <>
      <PageHeader
        title="Equipments Dashboard"
        subtitle="Trolleys, ovens, racks and containers — availability, maintenance and damage"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard label="Total Equipment" value={stats.total.toLocaleString()} icon={ScanBarcode} tone="navy" sub={`${stats.types} categories`} />
        <KpiCard label="In Service"      value={stats.inService.toLocaleString()} icon={CheckCircle2} tone="success" />
        <KpiCard label="In Maintenance"  value={stats.inMaintenance.toLocaleString()} icon={Wrench} tone="warning" />
        <KpiCard label="Damaged"         value={stats.damaged.toLocaleString()} icon={AlertOctagon} tone="red" />
        <KpiCard label="Service Due ≤30d" value={stats.dueWithin30.toLocaleString()} icon={ShieldAlert} tone="warning" />
        <KpiCard label="Open Damage"     value={stats.openDamage.toLocaleString()} icon={AlertOctagon} tone="red" sub={`${stats.severeOpen} severe`} />
        <KpiCard label="Damaged Returns" value={stats.damagedReturns.toLocaleString()} icon={Undo2} tone="warning" sub={`${equipmentReturns.length} returns`} />
        <KpiCard label="Retired"         value={stats.retired.toLocaleString()} icon={Activity} tone="navy" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Equipment Mix by Status</CardTitle>
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
            <CardTitle className="text-sm uppercase tracking-wider">Assets by Category</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.categoryChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider">Recent Equipment Returns</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">Return #</th>
                  <th className="p-3 text-left font-semibold">Flight</th>
                  <th className="p-3 text-left font-semibold">Asset</th>
                  <th className="p-3 text-left font-semibold">Returned By</th>
                  <th className="p-3 text-left font-semibold">Date / Time</th>
                  <th className="p-3 text-left font-semibold">Condition</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentReturns.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{r.id}</td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <Plane className="h-3.5 w-3.5 text-muted-foreground" />
                        {r.flight}
                      </span>
                    </td>
                    <td className="p-3">{r.assetName}</td>
                    <td className="p-3">{r.returnedBy}</td>
                    <td className="p-3 whitespace-nowrap text-muted-foreground">{r.date}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${CONDITION_BADGE[r.condition] ?? "bg-muted text-foreground"}`}>
                        {r.condition}
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
