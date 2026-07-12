import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/common/StatusBadge";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  LineChart as LineChartIcon, ShoppingCart, BadgeDollarSign,
  Truck, TrendingUp, Download,
} from "lucide-react";
import { toast } from "sonner";
import { purchaseOrders, vendors } from "@/lib/sample-data";
import { useWorkflow } from "@/lib/workflow-store";
import { cn } from "@/lib/utils";

type Period = "month" | "quarter" | "year" | "all";
const PERIOD_OPTS: { value: Period; label: string }[] = [
  { value: "month",   label: "This Month"  },
  { value: "quarter", label: "Last 90 Days" },
  { value: "year",    label: "This Year"   },
  { value: "all",     label: "All Time"    },
];

const TODAY = new Date();

function inPeriod(dateStr: string, p: Period): boolean {
  if (p === "all") return true;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  if (p === "year")    return d.getFullYear() === TODAY.getFullYear();
  if (p === "month")   return d.getFullYear() === TODAY.getFullYear() && d.getMonth() === TODAY.getMonth();
  if (p === "quarter") return TODAY.getTime() - d.getTime() <= 90 * 86400000;
  return true;
}

const STATUS_COLORS: Record<string, string> = {
  Draft:              "#cbd5e1",
  "Pending Approval": "#F59E0B",
  Approved:           "#0EA5A4",
  Ordered:            "#3B82F6",
  Received:           "#10b981",
  Closed:             "#94a3b8",
  Open:               "#6366F1",
};

const BAR_COLOR = "#1E3A8A";
const ACCENT = "#22C55E";

export default function PurchaseReportsPage() {
  const [period, setPeriod] = useState<Period>("year");
  const { wfPurchaseOrders } = useWorkflow();

  // Combine workflow POs with sample POs for a richer dataset.
  const allPOs = useMemo(
    () => [
      ...wfPurchaseOrders.map((p) => ({
        id: p.id, vendor: p.vendor, items: p.items, amount: p.amount, date: p.date, status: p.status,
      })),
      ...purchaseOrders,
    ],
    [wfPurchaseOrders],
  );

  const filtered = useMemo(() => allPOs.filter((p) => inPeriod(p.date, period)), [allPOs, period]);

  // ── KPIs
  const totalSpend = filtered.reduce((s, p) => s + (p.amount ?? 0), 0);
  const totalPOs = filtered.length;
  const avgOrderValue = totalPOs > 0 ? Math.round(totalSpend / totalPOs) : 0;
  const activeVendors = new Set(filtered.map((p) => p.vendor)).size;

  // ── Monthly spend trend
  const monthly = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of filtered) {
      const d = new Date(p.date);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(key, (map.get(key) ?? 0) + (p.amount ?? 0));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount }));
  }, [filtered]);

  // ── Vendor-wise spend (top 10)
  const vendorCatLookup = useMemo(() => {
    const m = new Map<string, string>();
    vendors.forEach((v) => m.set(v.name, v.category));
    return m;
  }, []);

  const vendorRows = useMemo(() => {
    const m = new Map<string, { vendor: string; category: string; poCount: number; spend: number }>();
    for (const p of filtered) {
      const cur = m.get(p.vendor) ?? {
        vendor: p.vendor,
        category: vendorCatLookup.get(p.vendor) ?? "—",
        poCount: 0,
        spend: 0,
      };
      cur.poCount += 1;
      cur.spend += p.amount ?? 0;
      m.set(p.vendor, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.spend - a.spend);
  }, [filtered, vendorCatLookup]);

  // ── Category-wise spend
  const categoryRows = useMemo(() => {
    const m = new Map<string, { category: string; poCount: number; spend: number }>();
    for (const p of filtered) {
      const cat = vendorCatLookup.get(p.vendor) ?? "Uncategorized";
      const cur = m.get(cat) ?? { category: cat, poCount: 0, spend: 0 };
      cur.poCount += 1;
      cur.spend += p.amount ?? 0;
      m.set(cat, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.spend - a.spend);
  }, [filtered, vendorCatLookup]);

  // ── PO status mix
  const statusRows = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of filtered) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    return Array.from(m.entries()).map(([status, count]) => ({ status, count }));
  }, [filtered]);

  return (
    <>
      <PageHeader
        title="Purchase Reports"
        subtitle="Procurement analytics — spend trends, supplier rankings, category mix and cycle performance"
        actions={
          <Button variant="outline" onClick={() => toast.success("Report export queued.")}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        }
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Period</span>
            <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 shadow-sm">
              {PERIOD_OPTS.map((p) => {
                const active = period === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPeriod(p.value)}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-medium rounded-sm transition-colors",
                      active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Total Spend"
          value={`৳ ${Math.round(totalSpend).toLocaleString()}`}
          icon={BadgeDollarSign}
          tone="navy"
        />
        <KpiCard label="Purchase Orders" value={totalPOs} icon={ShoppingCart} tone="success" />
        <KpiCard
          label="Avg Order Value"
          value={`৳ ${avgOrderValue.toLocaleString()}`}
          icon={TrendingUp}
          tone="warning"
        />
        <KpiCard label="Active Vendors" value={activeVendors} icon={Truck} tone="navy" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <LineChartIcon className="h-4 w-4 text-primary" />
              Monthly Spend Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {monthly.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">
                No PO data for the selected period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthly} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="month" stroke="#94a3b8" fontSize={11} />
                  <YAxis
                    stroke="#94a3b8"
                    fontSize={11}
                    tickFormatter={(v) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => [`৳ ${v.toLocaleString()}`, "Spend"]}
                    contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  />
                  <Bar dataKey="amount" fill={BAR_COLOR} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">PO Status Mix</CardTitle>
          </CardHeader>
          <CardContent>
            {statusRows.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">No data.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={statusRows}
                    dataKey="count"
                    nameKey="status"
                    innerRadius={50}
                    outerRadius={86}
                    paddingAngle={2}
                  >
                    {statusRows.map((r) => (
                      <Cell key={r.status} fill={STATUS_COLORS[r.status] ?? ACCENT} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number, _name, p) => [`${v} POs`, p.payload.status]}
                    contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Supplier-wise Spend (Top 10)</CardTitle>
          </CardHeader>
          <CardContent>
            {vendorRows.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No supplier activity.</div>
            ) : (
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">Supplier</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">Category</th>
                      <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">POs</th>
                      <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">Spend (৳)</th>
                      <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorRows.slice(0, 10).map((r) => {
                      const share = totalSpend > 0 ? (r.spend / totalSpend) * 100 : 0;
                      return (
                        <tr key={r.vendor} className="border-t border-border hover:bg-muted/10">
                          <td className="px-3 py-2 font-medium">{r.vendor}</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className="text-[10px]">{r.category}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.poCount}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.spend.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{share.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Category-wise Spend</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryRows.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No category data.</div>
            ) : (
              <div className="space-y-2">
                {categoryRows.map((r) => {
                  const share = totalSpend > 0 ? (r.spend / totalSpend) * 100 : 0;
                  return (
                    <div key={r.category} className="border border-border rounded-md p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{r.category}</span>
                          <span className="text-[10px] text-muted-foreground">{r.poCount} POs</span>
                        </div>
                        <span className="tabular-nums text-sm font-semibold">৳ {r.spend.toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(share, 100)}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                        {share.toFixed(1)}% of total
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Recent Purchase Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">PO #</th>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">Date</th>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">Vendor</th>
                  <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">Items</th>
                  <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">Amount (৳)</th>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 12).map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-muted/10">
                    <td className="px-3 py-2 font-mono text-xs">{p.id}</td>
                    <td className="px-3 py-2 tabular-nums text-xs">{p.date}</td>
                    <td className="px-3 py-2">{p.vendor}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{p.items}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{(p.amount ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No purchase orders in the selected period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
