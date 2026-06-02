import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ShieldCheck, ThermometerSun, CheckCircle2, AlertOctagon, ClipboardCheck,
  Activity, AlertTriangle, Sparkles,
} from "lucide-react";
import { cookingTempLogs, hygieneChecks } from "@/lib/sample-data";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend,
} from "recharts";

const STATUS_BADGE: Record<string, string> = {
  Completed: "bg-emerald-100 text-emerald-800",
  Pending: "bg-amber-100 text-amber-800",
  Failed: "bg-red-100 text-red-800",
};

const HYGIENE_COLORS: Record<string, string> = {
  Completed: "#059669",
  Pending: "#F59E0B",
  Failed: "#EF4444",
};

export default function FoodSafetyOverviewPage() {
  const stats = useMemo(() => {
    const total = cookingTempLogs.length;
    const passed = cookingTempLogs.filter((l) => l.sensoryPass).length;
    const failed = total - passed;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const avgTemp = total > 0
      ? Math.round(cookingTempLogs.reduce((s, l) => s + l.measuredTemp, 0) / total)
      : 0;
    const tempDeviations = cookingTempLogs.filter((l) => l.measuredTemp < l.standardTempMin).length;

    const hygieneTotal = hygieneChecks.length;
    const hygieneFail = hygieneChecks.filter((h) => /fail|critical/i.test(h.status)).length;
    const hygienePending = hygieneChecks.filter((h) => /pending/i.test(h.status)).length;
    const hygieneCompletion = hygieneTotal > 0
      ? Math.round(((hygieneTotal - hygienePending - hygieneFail) / hygieneTotal) * 100) : 0;

    // Per-item pass/fail for the chart
    const byItem = cookingTempLogs.reduce<Record<string, { pass: number; fail: number }>>((acc, l) => {
      if (!acc[l.item]) acc[l.item] = { pass: 0, fail: 0 };
      if (l.sensoryPass) acc[l.item].pass += 1; else acc[l.item].fail += 1;
      return acc;
    }, {});
    const itemChart = Object.entries(byItem).map(([item, c]) => ({ item, ...c }));

    // Hygiene status distribution
    const hygieneStatus = hygieneChecks.reduce<Record<string, number>>((acc, h) => {
      acc[h.status] = (acc[h.status] ?? 0) + 1;
      return acc;
    }, {});
    const hygiePie = Object.entries(hygieneStatus).map(([name, value]) => ({ name, value }));

    // Recent hygiene checks
    const recentChecks = [...hygieneChecks].slice(0, 10);

    return {
      total, passed, failed, passRate, avgTemp, tempDeviations,
      hygieneTotal, hygieneFail, hygienePending, hygieneCompletion,
      itemChart, hygiePie, recentChecks,
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Food Safety Dashboard"
        subtitle="Cooking-temp HACCP tests, sensory checks, and hygiene monitoring"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard label="Cooking-Temp Tests" value={stats.total.toLocaleString()} icon={ClipboardCheck} tone="navy" />
        <KpiCard label="Pass Rate"          value={`${stats.passRate}%`} icon={ShieldCheck} tone={stats.passRate >= 90 ? "success" : "warning"} sub={`${stats.passed}/${stats.total}`} />
        <KpiCard label="Failed Tests"       value={stats.failed.toLocaleString()} icon={AlertOctagon} tone="red" />
        <KpiCard label="Temp Deviations"    value={stats.tempDeviations.toLocaleString()} icon={AlertTriangle} tone="red" sub="Below standard" />
        <KpiCard label="Avg Core Temp"      value={`${stats.avgTemp}°C`} icon={ThermometerSun} tone="warning" />
        <KpiCard label="Hygiene Checks"     value={stats.hygieneTotal.toLocaleString()} icon={CheckCircle2} tone="navy" />
        <KpiCard label="Hygiene Pending"    value={stats.hygienePending.toLocaleString()} icon={Activity} tone="warning" />
        <KpiCard label="Hygiene Completion" value={`${stats.hygieneCompletion}%`} icon={Sparkles} tone={stats.hygieneCompletion >= 90 ? "success" : "warning"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Cooking-Temp Test Outcome by Item</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.itemChart} margin={{ top: 8, right: 16, left: 0, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="item" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="pass" stackId="a" fill="#059669" name="Passed" />
                <Bar dataKey="fail" stackId="a" fill="#EF4444" name="Failed" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Hygiene Check Status</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats.hygiePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                     label={(e) => `${e.name}: ${e.value}`}>
                  {stats.hygiePie.map((d) => <Cell key={d.name} fill={HYGIENE_COLORS[d.name] ?? "#64748b"} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider">Recent Hygiene Checks</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">ID</th>
                  <th className="p-3 text-left font-semibold">Time</th>
                  <th className="p-3 text-left font-semibold">Activity</th>
                  <th className="p-3 text-left font-semibold">Remarks</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentChecks.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{c.id}</td>
                    <td className="p-3 whitespace-nowrap">{c.time}</td>
                    <td className="p-3">{c.activity}</td>
                    <td className="p-3 text-muted-foreground">{c.remarks}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[c.status] ?? "bg-muted text-foreground"}`}>
                        {c.status}
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
