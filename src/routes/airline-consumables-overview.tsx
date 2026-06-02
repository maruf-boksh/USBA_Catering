import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Coffee, Boxes, AlertTriangle, CheckCircle2, Send, Package, Wallet, TrendingDown,
} from "lucide-react";
import { consumableItems, consumableUsage } from "@/lib/sample-data";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend,
} from "recharts";

const CABIN_COLORS: Record<string, string> = {
  Y: "#0EA5E9",
  B: "#7C3AED",
  F: "#D97706",
};

const STATUS_BADGE: Record<string, string> = {
  OK: "bg-emerald-100 text-emerald-800",
  Low: "bg-amber-100 text-amber-800",
  Critical: "bg-red-100 text-red-800",
};

export default function AirlineConsumablesOverviewPage() {
  const stats = useMemo(() => {
    const totalSKUs = consumableItems.length;
    const totalStock = consumableItems.reduce((s, r) => s + r.stock, 0);
    const stockValue = consumableItems.reduce((s, r) => s + r.stock * r.unitCost, 0);
    const lowStock = consumableItems.filter((r) => r.reorder > 0 && r.stock <= r.reorder).length;
    const ok = consumableItems.filter((r) => r.status === "OK").length;

    // By category
    const byCategory = consumableItems.reduce<Record<string, number>>((acc, r) => {
      acc[r.category] = (acc[r.category] ?? 0) + r.stock;
      return acc;
    }, {});
    const categoryChart = Object.entries(byCategory).map(([category, stock]) => ({ category, stock }));

    // By cabin class (usage)
    const byCabin = consumableUsage.reduce<Record<string, number>>((acc, u) => {
      acc[u.cabinClass] = (acc[u.cabinClass] ?? 0) + u.qty;
      return acc;
    }, {});
    const cabinChart = Object.entries(byCabin).map(([name, value]) => ({ name, value }));

    // Reorder items (top 8 by deficit)
    const reorderItems = consumableItems
      .filter((r) => r.reorder > 0 && r.stock <= r.reorder)
      .map((r) => ({ ...r, deficit: r.reorder - r.stock }))
      .sort((a, b) => b.deficit - a.deficit).slice(0, 8);

    const totalUsage = consumableUsage.reduce((s, u) => s + u.qty, 0);

    return {
      totalSKUs, totalStock, stockValue, lowStock, ok,
      totalUsage, distinctFlights: new Set(consumableUsage.map((u) => u.flight)).size,
      categoryChart, cabinChart, reorderItems,
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Consumables Dashboard"
        subtitle="Napkins, cutlery, amenity kits — stock health, usage and reorder load"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard label="Total SKUs"     value={stats.totalSKUs.toLocaleString()} icon={Coffee} tone="navy" />
        <KpiCard label="Total Stock"    value={stats.totalStock.toLocaleString()} icon={Boxes} tone="navy" />
        <KpiCard label="Stock Value"    value={`৳ ${(stats.stockValue / 1000).toFixed(0)}k`} icon={Wallet} tone="navy" sub={`৳ ${stats.stockValue.toLocaleString()}`} />
        <KpiCard label="In Reorder"     value={stats.lowStock.toLocaleString()} icon={TrendingDown} tone="warning" sub="Below threshold" />
        <KpiCard label="Healthy SKUs"   value={stats.ok.toLocaleString()} icon={CheckCircle2} tone="success" />
        <KpiCard label="Total Usage"    value={stats.totalUsage.toLocaleString()} icon={Send} tone="navy" sub="Units consumed" />
        <KpiCard label="Flights Served" value={stats.distinctFlights.toLocaleString()} icon={Package} tone="navy" />
        <KpiCard label="Categories"     value={stats.categoryChart.length.toLocaleString()} icon={AlertTriangle} tone="navy" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Stock On Hand by Category</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.categoryChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="stock" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Usage by Cabin Class</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats.cabinChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                     label={(e) => `Class ${e.name}: ${e.value}`}>
                  {stats.cabinChart.map((d) => <Cell key={d.name} fill={CABIN_COLORS[d.name] ?? "#64748b"} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider">Reorder Required</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">SKU</th>
                  <th className="p-3 text-left font-semibold">Item</th>
                  <th className="p-3 text-left font-semibold">Category</th>
                  <th className="p-3 text-right font-semibold">Stock</th>
                  <th className="p-3 text-right font-semibold">Reorder</th>
                  <th className="p-3 text-right font-semibold">Deficit</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.reorderItems.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">All consumables above reorder level.</td></tr>
                ) : stats.reorderItems.map((i) => (
                  <tr key={i.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{i.id}</td>
                    <td className="p-3">{i.name}</td>
                    <td className="p-3 text-muted-foreground">{i.category}</td>
                    <td className="p-3 text-right">{i.stock.toLocaleString()} {i.uom}</td>
                    <td className="p-3 text-right text-muted-foreground">{i.reorder.toLocaleString()}</td>
                    <td className="p-3 text-right font-semibold text-red-600">{i.deficit.toLocaleString()}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[i.status] ?? "bg-muted text-foreground"}`}>
                        {i.status}
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
