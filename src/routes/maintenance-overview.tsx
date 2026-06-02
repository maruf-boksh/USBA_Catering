import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Wrench, CheckCircle2, AlertCircle, ShieldAlert, Calendar, Factory, MapPin, Clock,
} from "lucide-react";
import { assets } from "@/lib/sample-data";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  Operational: "#059669",
  "Service Due": "#D97706",
  Maintenance: "#7C3AED",
  Damaged: "#EF4444",
  Retired: "#94a3b8",
};

const STATUS_BADGE: Record<string, string> = {
  Operational: "bg-emerald-100 text-emerald-800",
  "Service Due": "bg-amber-100 text-amber-800",
  Maintenance: "bg-violet-100 text-violet-800",
  Damaged: "bg-red-100 text-red-800",
  Retired: "bg-slate-100 text-slate-700",
};

function daysUntil(dateStr: string, from: Date): number {
  return Math.floor((new Date(dateStr).getTime() - from.getTime()) / 86400000);
}

export default function MaintenanceOverviewPage() {
  const today = new Date();

  const stats = useMemo(() => {
    const in30 = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
    const todayStr = today.toISOString().slice(0, 10);

    const dueSoon = assets.filter((a) => a.nextSvc >= todayStr && a.nextSvc <= in30).length;
    const overdue = assets.filter((a) => a.nextSvc < todayStr).length;
    const inMaintenance = assets.filter((a) => /maintenance/i.test(a.status)).length;
    const operational = assets.filter((a) => /operational/i.test(a.status)).length;
    const serviceDue = assets.filter((a) => /service.?due/i.test(a.status)).length;

    const byType = assets.reduce<Record<string, number>>((acc, a) => {
      acc[a.type] = (acc[a.type] ?? 0) + 1;
      return acc;
    }, {});
    const byStatus = assets.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    }, {});

    const typeChart = Object.entries(byType).map(([type, count]) => ({ type, count }));
    const statusChart = Object.entries(byStatus).map(([name, value]) => ({ name, value }));

    // Upcoming maintenance schedule (sorted by nextSvc)
    const schedule = [...assets]
      .map((a) => ({ ...a, daysUntilSvc: daysUntil(a.nextSvc, today) }))
      .sort((a, b) => a.daysUntilSvc - b.daysUntilSvc).slice(0, 8);

    const utilisation = assets.length > 0
      ? Math.round((operational / assets.length) * 100) : 0;

    return {
      total: assets.length,
      operational, serviceDue, inMaintenance,
      dueSoon, overdue, utilisation,
      types: Object.keys(byType).length,
      typeChart, statusChart, schedule,
    };
  }, [today]);

  return (
    <>
      <PageHeader
        title="Maintenance Dashboard"
        subtitle="Facility assets, scheduled servicing, and overdue maintenance"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard label="Total Assets"    value={stats.total.toLocaleString()} icon={Factory} tone="navy" sub={`${stats.types} types`} />
        <KpiCard label="Operational"     value={stats.operational.toLocaleString()} icon={CheckCircle2} tone="success" />
        <KpiCard label="Service Due"     value={stats.serviceDue.toLocaleString()} icon={ShieldAlert} tone="warning" />
        <KpiCard label="In Maintenance"  value={stats.inMaintenance.toLocaleString()} icon={Wrench} tone="warning" />
        <KpiCard label="Due in 30 days"  value={stats.dueSoon.toLocaleString()} icon={Calendar} tone="warning" />
        <KpiCard label="Overdue"         value={stats.overdue.toLocaleString()} icon={AlertCircle} tone="red" />
        <KpiCard label="Utilisation"     value={`${stats.utilisation}%`} icon={Clock} tone={stats.utilisation >= 75 ? "success" : "warning"} sub="Operational rate" />
        <KpiCard label="Asset Types"     value={stats.types.toLocaleString()} icon={MapPin} tone="navy" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Asset Inventory by Type</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.typeChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="type" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#7C3AED" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats.statusChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                     label={(e) => `${e.name}: ${e.value}`}>
                  {stats.statusChart.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name] ?? "#64748b"} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider">Upcoming Maintenance Schedule</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">Asset</th>
                  <th className="p-3 text-left font-semibold">Type</th>
                  <th className="p-3 text-left font-semibold">Location</th>
                  <th className="p-3 text-left font-semibold">Last Service</th>
                  <th className="p-3 text-left font-semibold">Next Service</th>
                  <th className="p-3 text-right font-semibold">Days</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.schedule.map((a) => (
                  <tr key={a.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{a.name}</td>
                    <td className="p-3 text-muted-foreground">{a.type}</td>
                    <td className="p-3 text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" />
                        {a.location}
                      </span>
                    </td>
                    <td className="p-3 whitespace-nowrap">{a.lastSvc}</td>
                    <td className="p-3 whitespace-nowrap">{a.nextSvc}</td>
                    <td className={`p-3 text-right font-medium ${a.daysUntilSvc < 0 ? "text-red-600" : a.daysUntilSvc <= 30 ? "text-amber-600" : "text-emerald-600"}`}>
                      {a.daysUntilSvc < 0 ? `${Math.abs(a.daysUntilSvc)} overdue` : a.daysUntilSvc}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[a.status] ?? "bg-muted text-foreground"}`}>
                        {a.status}
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
