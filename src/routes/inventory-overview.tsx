import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Boxes, AlertTriangle, Wallet, ArrowLeftRight, Send, Warehouse, TrendingDown, Calendar,
} from "lucide-react";
import { inventory, inventoryValue, nearExpiryCount } from "@/lib/sample-data";
import { useWorkflow } from "@/lib/workflow-store";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const STORAGE_COLORS: Record<string, string> = {
  Dry: "#0EA5E9",
  Cold: "#0F766E",
  Frozen: "#7C3AED",
  Ambient: "#F59E0B",
};

const STATUS_BADGE: Record<string, string> = {
  OK: "bg-emerald-100 text-emerald-800",
  Low: "bg-amber-100 text-amber-800",
  Critical: "bg-red-100 text-red-800",
};

export default function InventoryOverviewPage() {
  const { demands, transferNotes } = useWorkflow();

  const stats = useMemo(() => {
    const itemValue = (i: typeof inventory[number]) =>
      i.batches.reduce((s, b) => s + b.qty * b.costPrice, 0);

    const lowStock = inventory.filter((i) => i.reorder > 0 && i.stock <= i.reorder).length;
    const critical = inventory.filter((i) => i.status === "Critical").length;
    const pendingDR = demands.filter((d) => /Pending/i.test(d.status)).length;
    const openTransfers = transferNotes.filter((t) => /pending|in.?transit/i.test(t.status)).length;
    const expiring30 = nearExpiryCount(inventory, 30);
    const expiring7 = nearExpiryCount(inventory, 7);

    // By Category (value)
    const byCategory = inventory.reduce<Record<string, number>>((acc, i) => {
      acc[i.category] = (acc[i.category] ?? 0) + itemValue(i);
      return acc;
    }, {});
    const categoryChart = Object.entries(byCategory)
      .map(([category, value]) => ({ category, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value).slice(0, 6);

    // By Storage type (count)
    const byStorage = inventory.reduce<Record<string, number>>((acc, i) => {
      acc[i.storage] = (acc[i.storage] ?? 0) + 1;
      return acc;
    }, {});
    const storageChart = Object.entries(byStorage).map(([name, value]) => ({ name, value }));

    // Low-stock items (top 8 by deficit)
    const lowStockItems = inventory
      .filter((i) => i.reorder > 0 && i.stock <= i.reorder)
      .map((i) => ({ ...i, deficit: i.reorder - i.stock }))
      .sort((a, b) => b.deficit - a.deficit).slice(0, 8);

    return {
      totalItems: inventory.length,
      totalValue: inventoryValue(inventory),
      lowStock, critical,
      pendingDR, openTransfers,
      expiring30, expiring7,
      categoryChart, storageChart, lowStockItems,
    };
  }, [demands, transferNotes]);

  return (
    <>
      <PageHeader
        title="Inventory Dashboard"
        subtitle="Stock health, demand requests, expiry alerts and inter-warehouse movement"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard label="Total SKUs"        value={stats.totalItems.toLocaleString()} icon={Boxes} tone="navy" />
        <KpiCard label="Inventory Value"   value={`৳ ${Math.round(stats.totalValue).toLocaleString()}`} icon={Wallet} tone="navy" />
        <KpiCard label="Low Stock"         value={stats.lowStock.toLocaleString()} icon={TrendingDown} tone="warning" sub="Below reorder" />
        <KpiCard label="Critical"          value={stats.critical.toLocaleString()} icon={AlertTriangle} tone="red" sub="Out / depleted" />
        <KpiCard label="Expiring ≤ 7d"     value={stats.expiring7.toLocaleString()} icon={Calendar} tone="red" />
        <KpiCard label="Expiring ≤ 30d"    value={stats.expiring30.toLocaleString()} icon={Calendar} tone="warning" />
        <KpiCard label="Pending Demand"    value={stats.pendingDR.toLocaleString()} icon={Send} tone="warning" />
        <KpiCard label="Open Transfers"    value={stats.openTransfers.toLocaleString()} icon={ArrowLeftRight} tone="navy" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Inventory Value by Category (Top 6)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.categoryChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `৳${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => `৳ ${v.toLocaleString()}`} />
                <Bar dataKey="value" fill="#0f766e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">SKUs by Storage Type</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats.storageChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                     label={(e) => `${e.name}: ${e.value}`}>
                  {stats.storageChart.map((d) => <Cell key={d.name} fill={STORAGE_COLORS[d.name] ?? "#64748b"} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider">Low Stock — Replenishment Needed</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">Item</th>
                  <th className="p-3 text-left font-semibold">Category</th>
                  <th className="p-3 text-left font-semibold">Storage</th>
                  <th className="p-3 text-right font-semibold">Stock</th>
                  <th className="p-3 text-right font-semibold">Reorder</th>
                  <th className="p-3 text-right font-semibold">Deficit</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.lowStockItems.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">All items above reorder level.</td></tr>
                ) : stats.lowStockItems.map((i) => (
                  <tr key={i.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{i.name}</td>
                    <td className="p-3 text-muted-foreground">{i.category}</td>
                    <td className="p-3 text-muted-foreground">{i.storage}</td>
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
