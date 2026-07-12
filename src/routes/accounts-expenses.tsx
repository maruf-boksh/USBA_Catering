import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/common/KpiCard";
import { Wallet, TrendingUp, Clock, ReceiptText } from "lucide-react";
import { useWorkflow } from "@/lib/workflow-store";
import { buildBills, vendorSpend } from "@/lib/payables";

const fmtBdt = (n: number) => `৳${n.toLocaleString()}`;

export default function ExpenseOverview() {
  const { grns, supplierPayments } = useWorkflow();

  const bills = useMemo(() => buildBills(grns, supplierPayments), [grns, supplierPayments]);
  const vendors = useMemo(() => vendorSpend(bills), [bills]);

  const totalBilled = bills.reduce((s, b) => s + b.payable, 0);
  const totalPaid = bills.reduce((s, b) => s + b.paid, 0);
  const totalOutstanding = bills.reduce((s, b) => s + b.balance, 0);
  const payRate = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;

  // Payment method breakdown from actual supplier payments.
  const methodBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const p of supplierPayments) {
      const m = map.get(p.method) ?? { count: 0, total: 0 };
      m.count += 1;
      m.total += p.amount;
      map.set(p.method, m);
    }
    return [...map.entries()]
      .map(([method, d]) => ({ method, ...d }))
      .sort((a, b) => b.total - a.total);
  }, [supplierPayments]);

  const recentPayments = useMemo(
    () => [...supplierPayments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    [supplierPayments],
  );

  return (
    <>
      <PageHeader
        title="Expense Overview"
        subtitle="Procurement spend — vendor-wise billing, settlement status and payment mix"
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Billed" value={fmtBdt(totalBilled)} icon={Wallet} tone="navy" />
        <KpiCard label="Total Paid" value={fmtBdt(totalPaid)} sub={`${payRate}% settlement rate`} icon={TrendingUp} tone="success" />
        <KpiCard label="Outstanding" value={fmtBdt(totalOutstanding)} icon={Clock} tone="warning" />
        <KpiCard label="Vendor Bills" value={bills.length} icon={ReceiptText} tone="navy" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Vendor spend breakdown */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Vendor Spend Breakdown</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {["Vendor", "Bills", "Billed (৳)", "Paid (৳)", "Outstanding (৳)", "Status"].map((h) => (
                        <th key={h} className="p-3 text-left font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vendors.length === 0 ? (
                      <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No vendor spend recorded.</td></tr>
                    ) : vendors.map((row) => {
                      const cleared = row.outstanding <= 0;
                      const statusLabel = cleared ? "Cleared" : row.paid > 0 ? "Partial" : "Outstanding";
                      const sColor = cleared ? "bg-green-100 text-green-800" : row.paid > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700";
                      return (
                        <tr key={row.vendor} className="border-b hover:bg-muted/30">
                          <td className="p-3 font-medium">{row.vendor}</td>
                          <td className="p-3 text-center">{row.bills}</td>
                          <td className="p-3 font-medium tabular-nums">{fmtBdt(row.payable)}</td>
                          <td className="p-3 text-success tabular-nums">{fmtBdt(row.paid)}</td>
                          <td className="p-3 text-amber-600 tabular-nums">{row.outstanding > 0 ? fmtBdt(row.outstanding) : "—"}</td>
                          <td className="p-3"><span className={`px-2 py-1 rounded text-xs font-medium ${sColor}`}>{statusLabel}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {vendors.length > 0 && (
                    <tfoot>
                      <tr className="border-t bg-muted/30 font-semibold">
                        <td className="p-3">Total</td>
                        <td className="p-3 text-center">{bills.length}</td>
                        <td className="p-3 tabular-nums">{fmtBdt(totalBilled)}</td>
                        <td className="p-3 text-success tabular-nums">{fmtBdt(totalPaid)}</td>
                        <td className="p-3 text-amber-600 tabular-nums">{fmtBdt(totalOutstanding)}</td>
                        <td className="p-3"></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Payment method breakdown */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Payment Method Breakdown</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 text-left font-semibold">Method</th>
                    <th className="p-3 text-left font-semibold">Payments</th>
                    <th className="p-3 text-left font-semibold">Amount (৳)</th>
                  </tr>
                </thead>
                <tbody>
                  {methodBreakdown.length === 0 ? (
                    <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">No payments yet.</td></tr>
                  ) : methodBreakdown.map((row) => (
                    <tr key={row.method} className="border-b hover:bg-muted/30">
                      <td className="p-3">{row.method}</td>
                      <td className="p-3 text-center">{row.count}</td>
                      <td className="p-3 font-medium tabular-nums">{fmtBdt(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent payments */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Recent Payments</CardTitle></CardHeader>
        <CardContent className="p-0">
          {recentPayments.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No payments recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["Payment #", "Vendor", "Bills", "Amount (৳)", "Method", "Paid By", "Date"].map((h) => (
                      <th key={h} className="p-3 text-left font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((p) => (
                    <tr key={p.id} className="border-b hover:bg-muted/30">
                      <td className="p-3 font-medium">{p.id}</td>
                      <td className="p-3">{p.vendor}</td>
                      <td className="p-3 text-xs text-muted-foreground">{p.allocations.map((a) => a.grnRef).join(", ")}</td>
                      <td className="p-3 font-medium tabular-nums">{fmtBdt(p.amount)}</td>
                      <td className="p-3 text-muted-foreground">{p.method}</td>
                      <td className="p-3">{p.paidBy}</td>
                      <td className="p-3 text-muted-foreground">{p.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
