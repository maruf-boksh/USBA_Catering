import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/StatusBadge";
import {
  Plane, UtensilsCrossed,
} from "lucide-react";
import { useFlightOrders } from "@/lib/flight-orders-store";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  AreaChart, Area,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  Pending: "#D97706",
  Approved: "#0EA5E9",
  Production: "#7C3AED",
  Dispatched: "#0F766E",
  Completed: "#059669",
};

export default function OperationsOverviewPage() {
  const today = new Date().toISOString().slice(0, 10);
  const flightOrders = useFlightOrders();

  const stats = useMemo(() => {
    const distinctOrders = new Set(flightOrders.map((o) => o.orderNo));
    const byStatus = flightOrders.reduce<Record<string, number>>((acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    }, {});
    const todays = flightOrders.filter((o) => o.date === today);
    const todaysPax = todays.reduce((s, o) => s + o.pax, 0);
    const todaysCrew = todays.reduce((s, o) => s + o.crew, 0);
    const specialMeals = flightOrders.reduce((s, o) => s + o.specialMeals, 0);

    // Next-24h window (today + tomorrow) for the flight & meal load cards.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    const next24 = flightOrders.filter((o) => o.date >= today && o.date <= tomorrowStr);
    const flights24 = next24.length;
    const outbound24 = next24.filter((o) => o.direction === "Outbound").length;
    const return24 = next24.filter((o) => o.direction === "Return").length;
    // Domestic when every airport in the sector is a home airport, else international.
    const DOMESTIC_AIRPORTS = new Set(["DAC", "CXB", "CGP", "ZYL", "JSR"]);
    const isDomestic = (sector: string) =>
      sector.split("→").map((s) => s.trim()).every((a) => DOMESTIC_AIRPORTS.has(a));
    const domestic24 = next24.filter((o) => isDomestic(o.sector)).length;
    const international24 = next24.length - domestic24;
    // Domestic / international split within each direction (for the nested rows).
    const obDom = next24.filter((o) => o.direction === "Outbound" && isDomestic(o.sector)).length;
    const obIntl = outbound24 - obDom;
    const rtDom = next24.filter((o) => o.direction === "Return" && isDomestic(o.sector)).length;
    const rtIntl = return24 - rtDom;
    const pax24 = next24.reduce((s, o) => s + o.pax, 0);
    const crew24 = next24.reduce((s, o) => s + o.crew, 0);
    const special24 = next24.reduce((s, o) => s + o.specialMeals, 0);
    const meals24 = pax24 + crew24 + special24;

    // Yesterday comparison for the "more/less than yesterday" delta pills.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const mealsForDate = (d: string) =>
      flightOrders.filter((o) => o.date === d).reduce((s, o) => s + o.pax + o.crew + o.specialMeals, 0);
    const flightsDelta = todays.length - flightOrders.filter((o) => o.date === yesterdayStr).length;
    const mealsDelta = mealsForDate(today) - mealsForDate(yesterdayStr);

    // Distinct orders by status (an order's first leg represents it) so the
    // Total Orders breakdown sums to the order count, not the leg count.
    const orderStatus = new Map<string, string>();
    for (const o of flightOrders) if (!orderStatus.has(o.orderNo)) orderStatus.set(o.orderNo, o.status);
    const orderStatusCount = (st: string) => [...orderStatus.values()].filter((s) => s === st).length;

    // 14-day flight-volume trend, starting today
    const trend: { date: string; flights: number; pax: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const rows = flightOrders.filter((o) => o.date === key);
      trend.push({
        date: key.slice(5),
        flights: rows.length,
        pax: rows.reduce((s, o) => s + o.pax, 0),
      });
    }

    // Top sectors by leg count
    const sectorCount = flightOrders.reduce<Record<string, number>>((acc, o) => {
      acc[o.sector] = (acc[o.sector] ?? 0) + 1;
      return acc;
    }, {});
    const topSectors = Object.entries(sectorCount)
      .sort(([, a], [, b]) => b - a).slice(0, 6)
      .map(([sector, count]) => ({ sector, count }));

    // Today's active flights (sorted by ETD)
    const todaysActive = [...todays]
      .filter((o) => o.status !== "Completed")
      .sort((a, b) => a.etd.localeCompare(b.etd)).slice(0, 8);

    return {
      totalOrders: distinctOrders.size,
      totalLegs: flightOrders.length,
      byStatus,
      todaysFlights: todays.length,
      todaysPax, todaysCrew, specialMeals,
      flights24, outbound24, return24, domestic24, international24,
      obDom, obIntl, rtDom, rtIntl,
      pax24, crew24, special24, meals24,
      flightsDelta, mealsDelta,
      approvedOrders: orderStatusCount("Approved"),
      pendingOrders: orderStatusCount("Pending"),
      inPrepOrders: orderStatusCount("Production"),
      trend, topSectors, todaysActive,
    };
  }, [today, flightOrders]);

  const statusChart = Object.entries(stats.byStatus).map(([status, count]) => ({ status, count }));

  return (
    <>
      <PageHeader
        title="Operations Dashboard"
        subtitle="Snapshot of flight orders, meal planning load, and today's operating picture"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard
          label="Total Orders" value={stats.totalOrders.toLocaleString()} icon={Plane}
          tone="violet" variant="aurora"
          sub={`${stats.totalLegs.toLocaleString()} flights`}
          hint="Distinct flight orders, by current pipeline stage."
          breakdown={[
            { label: "Approved",       value: stats.approvedOrders, icon: "✅" },
            { label: "Pending",        value: stats.pendingOrders,  icon: "⏳" },
            { label: "In Preparation", value: stats.inPrepOrders,   icon: "👨‍🍳" },
          ]}
        />
        <KpiCard
          label="Flights next 24 hours" value={stats.flights24.toLocaleString()} icon={Plane}
          tone="violet" variant="aurora"
          sub={`${stats.flightsDelta >= 0 ? "+" : "-"}${Math.abs(stats.flightsDelta)} ${stats.flightsDelta >= 0 ? "more" : "less"} than yesterday`}
          hint="Flight legs departing in the next 24 hours, by direction and sector."
          breakdown={[
            {
              label: "Outbound", value: stats.outbound24, icon: "🛫",
              children: [
                { label: "Domestic",      value: stats.obDom,  icon: "🏠" },
                { label: "International", value: stats.obIntl, icon: "🌐" },
              ],
            },
            {
              label: "Return", value: stats.return24, icon: "🛬",
              children: [
                { label: "Domestic",      value: stats.rtDom,  icon: "🏠" },
                { label: "International", value: stats.rtIntl, icon: "🌐" },
              ],
            },
          ]}
        />
        <KpiCard
          label="Total Meals next 24 hours" value={stats.meals24.toLocaleString()} icon={UtensilsCrossed}
          tone="green" variant="aurora"
          sub={`${stats.mealsDelta >= 0 ? "+" : "-"}${Math.abs(stats.mealsDelta).toLocaleString()} ${stats.mealsDelta >= 0 ? "more" : "less"} than yesterday`}
          hint="Total meal load for the next 24 hours, by audience."
          breakdown={[
            { label: "Total PAX",           value: stats.pax24.toLocaleString(),     icon: "👥" },
            { label: "Total Crew",          value: stats.crew24.toLocaleString(),    icon: "🧑‍✈️" },
            { label: "Total Special Meals", value: stats.special24.toLocaleString(), icon: "🍱" },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">14-Day Flight Volume Trend</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trend} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="flightFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="#0EA5E9" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#0EA5E9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="flights" stroke="#0EA5E9" strokeWidth={2} fill="url(#flightFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Flights by Status</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {statusChart.map((d) => (
                    <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? "#64748b"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Top Sectors (by Legs)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.topSectors} layout="vertical" margin={{ top: 8, right: 16, left: 60, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="sector" tick={{ fontSize: 11 }} width={70} />
                <Tooltip />
                <Bar dataKey="count" fill="#7C3AED" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Today's Active Flights</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left font-semibold">Order</th>
                    <th className="p-3 text-left font-semibold">Flight</th>
                    <th className="p-3 text-left font-semibold">Sector</th>
                    <th className="p-3 text-left font-semibold">ETD</th>
                    <th className="p-3 text-right font-semibold">Pax</th>
                    <th className="p-3 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.todaysActive.length === 0 ? (
                    <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No active flights today.</td></tr>
                  ) : stats.todaysActive.map((o) => (
                    <tr key={o.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                      <td className="p-3 font-medium">{o.orderNo}</td>
                      <td className="p-3 whitespace-nowrap">{o.flight}</td>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{o.sector}</td>
                      <td className="p-3 whitespace-nowrap">{o.etd}</td>
                      <td className="p-3 text-right">{o.pax}</td>
                      <td className="p-3"><StatusBadge status={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
