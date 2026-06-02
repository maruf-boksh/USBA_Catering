import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ShoppingCart, FileText, Truck, PackageCheck, Wallet, Undo2, Clock, Star,
} from "lucide-react";
import { purchaseOrders, vendors } from "@/lib/sample-data";
import { useWorkflow } from "@/lib/workflow-store";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  Draft: "#94a3b8",
  Pending: "#D97706",
  "Pending Approval": "#D97706",
  Approved: "#0EA5E9",
  Ordered: "#7C3AED",
  Delivered: "#0F766E",
  Closed: "#059669",
  Rejected: "#EF4444",
};

const STATUS_BADGE: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-700",
  Pending: "bg-amber-100 text-amber-800",
  "Pending Approval": "bg-amber-100 text-amber-800",
  Approved: "bg-sky-100 text-sky-800",
  Ordered: "bg-violet-100 text-violet-800",
  Delivered: "bg-teal-100 text-teal-800",
  Closed: "bg-emerald-100 text-emerald-800",
  Rejected: "bg-red-100 text-red-800",
};

export default function SupplyChainOverviewPage() {
  const { wfRequisitions, wfPurchaseOrders, grns } = useWorkflow();

  const stats = useMemo(() => {
    const allPOs = [...purchaseOrders, ...wfPurchaseOrders] as Array<{
      id: string; vendor: string; items?: number; amount?: number;
      date: string; status: string;
    }>;
    const byStatus = allPOs.reduce<Record<string, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    }, {});
    const poValue = allPOs.reduce((s, p) => s + (p.amount ?? 0), 0);
    const openPRs = wfRequisitions.filter((r) => /pending|approved/i.test(r.status)).length;

    // By vendor (top 6 by total amount)
    const byVendor = allPOs.reduce<Record<string, number>>((acc, p) => {
      acc[p.vendor] = (acc[p.vendor] ?? 0) + (p.amount ?? 0);
      return acc;
    }, {});
    const vendorChart = Object.entries(byVendor)
      .map(([vendor, value]) => ({ vendor, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value).slice(0, 6);

    // Recent POs
    const recentPOs = [...allPOs]
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

    // Top vendors by rating
    const topVendors = [...vendors].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 3);
    const avgRating = vendors.length > 0
      ? (vendors.reduce((s, v) => s + (v.rating ?? 0), 0) / vendors.length).toFixed(1)
      : "0";

    return {
      totalPOs: allPOs.length,
      byStatus, poValue,
      grnCount: grns.length,
      openPRs,
      pendingApproval: byStatus["Pending Approval"] ?? 0,
      ordered: byStatus.Ordered ?? 0,
      delivered: (byStatus.Delivered ?? 0) + (byStatus.Closed ?? 0),
      vendorChart, recentPOs, topVendors, avgRating,
    };
  }, [wfRequisitions, wfPurchaseOrders, grns]);

  const statusChart = Object.entries(stats.byStatus).map(([status, count]) => ({ status, count }));

  return (
    <>
      <PageHeader
        title="Supply Chain Dashboard"
        subtitle="Purchase orders, requisitions, vendor performance and goods-receipt"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard label="Total POs"         value={stats.totalPOs.toLocaleString()} icon={ShoppingCart} tone="navy" />
        <KpiCard label="PO Value"          value={`৳ ${(stats.poValue / 1000).toFixed(0)}k`} icon={Wallet} tone="navy" sub={`৳ ${stats.poValue.toLocaleString()}`} />
        <KpiCard label="Pending Approval"  value={stats.pendingApproval.toLocaleString()} icon={FileText} tone="warning" />
        <KpiCard label="Ordered"           value={stats.ordered.toLocaleString()} icon={Truck} tone="warning" sub="Awaiting receipt" />
        <KpiCard label="Delivered"         value={stats.delivered.toLocaleString()} icon={PackageCheck} tone="success" />
        <KpiCard label="Open PRs"          value={stats.openPRs.toLocaleString()} icon={Undo2} tone="warning" />
        <KpiCard label="GRNs"              value={stats.grnCount.toLocaleString()} icon={Clock} tone="navy" />
        <KpiCard label="Avg Vendor Rating" value={stats.avgRating} icon={Star} tone={Number(stats.avgRating) >= 4 ? "success" : "warning"} sub={`${vendors.length} vendors`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">POs by Status</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="status" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {statusChart.map((d) => <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? "#64748b"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Spend by Vendor (Top 6)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.vendorChart} layout="vertical" margin={{ top: 8, right: 16, left: 100, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `৳${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="vendor" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v: number) => `৳ ${v.toLocaleString()}`} />
                <Bar dataKey="value" fill="#0EA5E9" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider">Recent Purchase Orders</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">PO #</th>
                  <th className="p-3 text-left font-semibold">Vendor</th>
                  <th className="p-3 text-left font-semibold">Date</th>
                  <th className="p-3 text-right font-semibold">Items</th>
                  <th className="p-3 text-right font-semibold">Amount</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentPOs.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No purchase orders.</td></tr>
                ) : stats.recentPOs.map((p) => (
                  <tr key={p.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{p.id}</td>
                    <td className="p-3">{p.vendor}</td>
                    <td className="p-3 whitespace-nowrap">{p.date}</td>
                    <td className="p-3 text-right">{p.items ?? "—"}</td>
                    <td className="p-3 text-right font-medium">৳ {(p.amount ?? 0).toLocaleString()}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[p.status] ?? "bg-muted text-foreground"}`}>
                        {p.status}
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
