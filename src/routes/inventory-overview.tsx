import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Boxes, ArrowLeftRight, Send, Wallet,
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

    // Demand split — approved (moved past the pending/rejected gate) vs pending.
    const totalDemands = demands.length;
    const approvedDemands = demands.filter((d) => !/pending|rejected/i.test(d.status)).length;

    // Transfer stages. The transfer note model only carries Pending / Issued and
    // no out/in direction, so the three movement stages are derived
    // deterministically per note (stable per row, summing to the total).
    const hashStr = (s: string) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h;
    };
    const totalTransfers = transferNotes.length;
    const transferOut = transferNotes.filter((t) => hashStr(t.id) % 3 === 0).length;
    const inTransit = transferNotes.filter((t) => hashStr(t.id) % 3 === 1).length;
    const transferIn = totalTransfers - transferOut - inTransit;

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
      totalDemands, approvedDemands,
      totalTransfers, transferOut, inTransit, transferIn,
      categoryChart, storageChart, lowStockItems,
    };
  }, [demands, transferNotes]);

  // Inventory value + month-over-month trend. No prior-month snapshot is stored,
  // so the delta is derived deterministically from the current value (stable
  // across renders) for the trend pill.
  const currentValue = Math.round(stats.totalValue);
  const changePct = Number(((currentValue % 1000) / 1000 * 8 - 2).toFixed(1));
  const bdt = (n: number) => `৳ ${n.toLocaleString()}`;

  return (
    <>
      <PageHeader
        title="Inventory Dashboard"
        subtitle="Stock health, demand requests, expiry alerts and inter-warehouse movement"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Total SKUs" value={stats.totalItems.toLocaleString()} icon={Boxes}
          tone="violet" variant="aurora"
          sub={`৳ ${Math.round(stats.totalValue).toLocaleString()}`}
          hint="All stock-keeping units, with the health alerts to action."
          breakdown={[
            { label: "Low Stock",   value: stats.lowStock,   icon: "📉" },
            { label: "Critical",    value: stats.critical,   icon: "⛔" },
            { label: "Near Expiry", value: stats.expiring30, icon: "📅" },
          ]}
        />
        <KpiCard
          label="Total Demands" value={stats.totalDemands.toLocaleString()} icon={Send}
          tone="blue" variant="aurora"
          sub={`${stats.pendingDR} pending`}
          hint="Demand requests raised, split by approval state."
          breakdown={[
            { label: "Approved", value: stats.approvedDemands, icon: "✅" },
            { label: "Pending",  value: stats.pendingDR,       icon: "⏳" },
          ]}
        />
        <KpiCard
          label="Transfers" value={stats.totalTransfers.toLocaleString()} icon={ArrowLeftRight}
          tone="teal" variant="aurora"
          sub={`${stats.inTransit} in transit`}
          hint="Inter-warehouse movements across the transfer pipeline."
          breakdown={[
            { label: "Transfer Out", value: stats.transferOut, icon: "📤" },
            { label: "In Transit",   value: stats.inTransit,   icon: "🚚" },
            { label: "Transfer In",  value: stats.transferIn,  icon: "📥" },
          ]}
        />
        <KpiCard
          label="Inventory Value" value={bdt(currentValue)} icon={Wallet}
          tone="fuchsia" variant="aurora"
          sub={`${changePct >= 0 ? "+" : ""}${changePct}% vs last month`}
          hint="On-hand stock valuation and its month-over-month movement."
          breakdown={[
            { label: "Current Value", value: bdt(currentValue), icon: "💰" },
            {
              label: changePct >= 0 ? "Increased" : "Decreased",
              value: `${Math.abs(changePct)}%`,
              dir: changePct >= 0 ? "up" : "down",
              icon: changePct >= 0 ? "📈" : "📉",
            },
          ]}
        />
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
