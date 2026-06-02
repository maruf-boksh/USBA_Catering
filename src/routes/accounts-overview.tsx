import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Receipt, Wallet, BadgeCheck, FileText, CheckCircle2, Clock, TrendingUp, AlertCircle,
} from "lucide-react";
import { purchaseOrders } from "@/lib/sample-data";
import { useWorkflow } from "@/lib/workflow-store";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

const TONE_COLORS = ["#0f766e", "#0EA5E9", "#D97706", "#7C3AED", "#EF4444", "#059669"];

const AGING_BUCKETS = ["0-30", "31-60", "61-90", "90+"];
const AGING_COLORS = ["#10b981", "#0EA5E9", "#F59E0B", "#EF4444"];

function daysBetween(a: string, b: Date): number {
  return Math.floor((b.getTime() - new Date(a).getTime()) / 86400000);
}

export default function AccountsOverviewPage() {
  const { wfPurchaseOrders, grns } = useWorkflow();
  const today = new Date();

  const stats = useMemo(() => {
    const allPOs = [...purchaseOrders, ...wfPurchaseOrders] as Array<{
      id: string; vendor: string; items?: number; amount?: number;
      date: string; status: string;
    }>;
    const invoiced = allPOs.filter((p) => /delivered|closed|ordered/i.test(p.status));
    const totalInvoiced = invoiced.reduce((s, p) => s + (p.amount ?? 0), 0);
    const paid = allPOs.filter((p) => /closed/i.test(p.status));
    const totalPaid = paid.reduce((s, p) => s + (p.amount ?? 0), 0);
    const outstanding = totalInvoiced - totalPaid;
    const pendingApprovals = allPOs.filter((p) => /pending/i.test(p.status)).length;

    // Aging buckets for outstanding (Delivered or Ordered, not yet closed)
    const outstandingPOs = allPOs.filter((p) => /delivered|ordered/i.test(p.status));
    const aging = AGING_BUCKETS.map((b) => ({ bucket: b, count: 0, amount: 0 }));
    for (const p of outstandingPOs) {
      const d = daysBetween(p.date, today);
      const idx = d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3;
      aging[idx].count += 1;
      aging[idx].amount += p.amount ?? 0;
    }

    // Spend by vendor
    const byVendor = allPOs.reduce<Record<string, number>>((acc, p) => {
      acc[p.vendor] = (acc[p.vendor] ?? 0) + (p.amount ?? 0);
      return acc;
    }, {});
    const pieData = Object.entries(byVendor)
      .map(([vendor, value]) => ({ name: vendor, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value).slice(0, 6);

    // Outstanding PO table
    const outstandingTable = [...outstandingPOs]
      .map((p) => ({ ...p, ageDays: daysBetween(p.date, today) }))
      .sort((a, b) => b.ageDays - a.ageDays).slice(0, 8);

    const collectionRate = totalInvoiced > 0
      ? Math.round((totalPaid / totalInvoiced) * 100) : 0;

    return {
      invoiced: invoiced.length,
      totalInvoiced, paid: paid.length, totalPaid,
      outstanding, pendingApprovals,
      grnCount: grns.length,
      pieData, aging, outstandingTable, collectionRate,
    };
  }, [wfPurchaseOrders, grns, today]);

  return (
    <>
      <PageHeader
        title="Accounts Dashboard"
        subtitle="Invoicing, payables, payment aging and approval queue"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard label="Invoiced POs"      value={stats.invoiced.toLocaleString()} icon={Receipt} tone="navy" />
        <KpiCard label="Total Invoiced"    value={`৳ ${(stats.totalInvoiced / 1000).toFixed(0)}k`} icon={Wallet} tone="navy" sub={`৳ ${stats.totalInvoiced.toLocaleString()}`} />
        <KpiCard label="Paid"              value={`৳ ${(stats.totalPaid / 1000).toFixed(0)}k`} icon={CheckCircle2} tone="success" sub={`${stats.paid} closed`} />
        <KpiCard label="Outstanding"       value={`৳ ${(stats.outstanding / 1000).toFixed(0)}k`} icon={Clock} tone="warning" sub={`৳ ${stats.outstanding.toLocaleString()}`} />
        <KpiCard label="Collection Rate"   value={`${stats.collectionRate}%`} icon={TrendingUp} tone={stats.collectionRate >= 75 ? "success" : "warning"} />
        <KpiCard label="Pending Approvals" value={stats.pendingApprovals.toLocaleString()} icon={FileText} tone="warning" />
        <KpiCard label="GRNs"              value={stats.grnCount.toLocaleString()} icon={BadgeCheck} tone="navy" />
        <KpiCard label="Past Due 60d+"     value={(stats.aging[2].count + stats.aging[3].count).toLocaleString()} icon={AlertCircle} tone="red" sub={`৳ ${(stats.aging[2].amount + stats.aging[3].amount).toLocaleString()}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Payment Aging (Outstanding)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.aging} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => `৳${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number, name) => name === "amount" ? `৳ ${v.toLocaleString()}` : v} />
                <Bar yAxisId="left" dataKey="amount" radius={[6, 6, 0, 0]}>
                  {stats.aging.map((d, i) => <Cell key={d.bucket} fill={AGING_COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Spend by Vendor (Top 6)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats.pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                     label={(e) => `${e.name?.slice(0, 15) ?? ""}`}>
                  {stats.pieData.map((d, i) => <Cell key={d.name} fill={TONE_COLORS[i % TONE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => `৳ ${v.toLocaleString()}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider">Outstanding Invoices</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">PO #</th>
                  <th className="p-3 text-left font-semibold">Vendor</th>
                  <th className="p-3 text-left font-semibold">Invoice Date</th>
                  <th className="p-3 text-right font-semibold">Amount</th>
                  <th className="p-3 text-right font-semibold">Age (days)</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.outstandingTable.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No outstanding invoices.</td></tr>
                ) : stats.outstandingTable.map((p) => (
                  <tr key={p.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{p.id}</td>
                    <td className="p-3">{p.vendor}</td>
                    <td className="p-3 whitespace-nowrap">{p.date}</td>
                    <td className="p-3 text-right font-medium">৳ {(p.amount ?? 0).toLocaleString()}</td>
                    <td className={`p-3 text-right font-medium ${p.ageDays > 60 ? "text-red-600" : p.ageDays > 30 ? "text-amber-600" : "text-emerald-600"}`}>
                      {p.ageDays}
                    </td>
                    <td className="p-3 text-muted-foreground">{p.status}</td>
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
