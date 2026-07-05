import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ScanBarcode, Wrench, CheckCircle2, AlertOctagon, ShieldAlert,
  AlertCircle, Calendar, MapPin, Clock, Eye,
} from "lucide-react";
import { equipmentAssets, damageReports, assets } from "@/lib/sample-data";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

const EQ_STATUS_COLORS: Record<string, string> = {
  "In Service": "#059669",
  "In Maintenance": "#D97706",
  Damaged: "#EF4444",
  Retired: "#94a3b8",
};

const MA_STATUS_COLORS: Record<string, string> = {
  Operational: "#059669",
  "Service Due": "#D97706",
  Maintenance: "#7C3AED",
  Damaged: "#EF4444",
  Retired: "#94a3b8",
};

const MA_STATUS_BADGE: Record<string, string> = {
  Operational: "bg-emerald-100 text-emerald-800",
  "Service Due": "bg-amber-100 text-amber-800",
  Maintenance: "bg-violet-100 text-violet-800",
  Damaged: "bg-red-100 text-red-800",
  Retired: "bg-slate-100 text-slate-700",
};


function daysUntil(dateStr: string, from: Date): number {
  return Math.floor((new Date(dateStr).getTime() - from.getTime()) / 86400000);
}

export default function FleetOverviewPage() {
  const today = new Date();

  const stats = useMemo(() => {
    const todayStr = today.toISOString().slice(0, 10);
    const in30 = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);

    // ── Airline equipment ───────────────────────────────────────────────────
    const eqByStatus = equipmentAssets.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    }, {});
    const eqByCategory = equipmentAssets.reduce<Record<string, number>>((acc, a) => {
      acc[a.category] = (acc[a.category] ?? 0) + 1;
      return acc;
    }, {});

    const eqInService     = eqByStatus["In Service"]    ?? 0;
    const eqInMaintenance = eqByStatus["In Maintenance"] ?? 0;
    const eqDamaged       = eqByStatus.Damaged           ?? 0;

    const eqDueWithin30 = equipmentAssets.filter(
      (a) => a.nextMaintenance && a.nextMaintenance <= in30 && a.status === "In Service"
    ).length;
    const openDamage  = damageReports.filter((d) => /open|under repair/i.test(d.status)).length;
    const severeOpen  = damageReports.filter((d) => d.severity === "Severe" && !/repaired/i.test(d.status)).length;

    // ── Facility & ground assets ────────────────────────────────────────────
    const maOperational   = assets.filter((a) => /operational/i.test(a.status)).length;
    const maInMaintenance = assets.filter((a) => /maintenance/i.test(a.status)).length;
    const maDueSoon       = assets.filter((a) => a.nextSvc >= todayStr && a.nextSvc <= in30).length;
    const maOverdue       = assets.filter((a) => a.nextSvc < todayStr).length;

    const maByType   = assets.reduce<Record<string, number>>((acc, a) => {
      acc[a.type] = (acc[a.type] ?? 0) + 1;
      return acc;
    }, {});
    const maByStatus = assets.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    }, {});

    const schedule = [...assets]
      .map((a) => ({ ...a, daysUntilSvc: daysUntil(a.nextSvc, today) }))
      .sort((a, b) => a.daysUntilSvc - b.daysUntilSvc)
      .slice(0, 8);

    // ── Combined KPIs ───────────────────────────────────────────────────────
    const totalFleet   = equipmentAssets.length + assets.length;
    const totalActive  = eqInService + maOperational;
    const totalInMaint = eqInMaintenance + maInMaintenance;
    const totalDueSoon = eqDueWithin30 + maDueSoon;
    const utilisation  = totalFleet > 0 ? Math.round((totalActive / totalFleet) * 100) : 0;

    return {
      // combined row
      totalFleet,
      totalActive,
      totalInMaint,
      totalDueSoon,
      maOverdue,
      eqDamaged,
      openDamage,
      severeOpen,
      utilisation,
      // charts — equipment
      eqPieData:      Object.entries(eqByStatus).map(([name, value]) => ({ name, value })),
      eqCategoryChart: Object.entries(eqByCategory).map(([category, count]) => ({ category, count })),
      // charts — facility
      maTypeChart:   Object.entries(maByType).map(([type, count]) => ({ type, count })),
      maStatusChart: Object.entries(maByStatus).map(([name, value]) => ({ name, value })),
      // tables
      schedule,
    };
  }, [today]);

  return (
    <>
      <PageHeader
        title="Asset Overview"
        subtitle="Airline equipment and facility assets — availability, maintenance and damage"
      />

      {/* ── Single combined KPI row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard
          label="Total Fleet"
          value={stats.totalFleet.toLocaleString()}
          icon={ScanBarcode}
          tone="navy"
          sub={`${equipmentAssets.length} equip · ${assets.length} facility`}
        />
        <KpiCard
          label="Active"
          value={stats.totalActive.toLocaleString()}
          icon={CheckCircle2}
          tone="success"
          sub={`In service + operational`}
        />
        <KpiCard
          label="In Maintenance"
          value={stats.totalInMaint.toLocaleString()}
          icon={Wrench}
          tone="warning"
          sub={`Both asset pools`}
        />
        <KpiCard
          label="Service Due ≤30d"
          value={stats.totalDueSoon.toLocaleString()}
          icon={Calendar}
          tone="warning"
          sub={`${stats.maOverdue} overdue`}
        />
        <KpiCard
          label="Overdue"
          value={stats.maOverdue.toLocaleString()}
          icon={AlertCircle}
          tone="red"
          sub="Facility assets"
        />
        <KpiCard
          label="Damaged"
          value={stats.eqDamaged.toLocaleString()}
          icon={AlertOctagon}
          tone="red"
          sub="Airline equipment"
        />
        <KpiCard
          label="Open Damage"
          value={stats.openDamage.toLocaleString()}
          icon={ShieldAlert}
          tone="red"
          sub={`${stats.severeOpen} severe`}
        />
        <KpiCard
          label="Fleet Utilisation"
          value={`${stats.utilisation}%`}
          icon={Clock}
          tone={stats.utilisation >= 75 ? "success" : "warning"}
          sub="Active / total fleet"
        />
      </div>

      {/* ── Charts — 2 × 2 grid ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Equipment Mix by Status</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.eqPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={(e) => `${e.name}: ${e.value}`}
                >
                  {stats.eqPieData.map((d) => (
                    <Cell key={d.name} fill={EQ_STATUS_COLORS[d.name] ?? "#64748b"} />
                  ))}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Airline Equipment by Category</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.eqCategoryChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Facility Asset Inventory by Type</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.maTypeChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
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
            <CardTitle className="text-sm uppercase tracking-wider">Facility Asset Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.maStatusChart}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={(e) => `${e.name}: ${e.value}`}
                >
                  {stats.maStatusChart.map((d) => (
                    <Cell key={d.name} fill={MA_STATUS_COLORS[d.name] ?? "#64748b"} />
                  ))}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Tables ───────────────────────────────────────────────────────────── */}
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
                  <th className="p-3 text-right font-semibold">Action</th>
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
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${MA_STATUS_BADGE[a.status] ?? "bg-muted text-foreground"}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                        <Eye className="h-4 w-4" />
                      </button>
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
