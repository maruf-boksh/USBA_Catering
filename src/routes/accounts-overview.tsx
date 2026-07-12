import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, Banknote, Landmark, HandCoins, Clock } from "lucide-react";
import {
  useWorkflow, grnPayableAmount, accountBalance,
  type WfSupplierPayment,
} from "@/lib/workflow-store";
import { roundQty } from "@/lib/num";

const fmtBdt = (n: number) =>
  `৳ ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AccountsOverviewPage() {
  const wf = useWorkflow();
  const { financialAccounts, cashTxns, supplierPayments, grns } = wf;

  const accountName = (id?: string) =>
    financialAccounts.find((a) => a.id === id)?.name ?? "—";

  // ── Live balances ───────────────────────────────────────────────────────────
  const accounts = useMemo(
    () => financialAccounts.map((a) => ({
      ...a,
      balance: roundQty(accountBalance(a.id, a.openingBalance, cashTxns, supplierPayments), 2),
    })),
    [financialAccounts, cashTxns, supplierPayments],
  );

  const totalCash = accounts.filter((a) => a.type === "Cash").reduce((s, a) => s + a.balance, 0);
  const totalBank = accounts.filter((a) => a.type === "Bank").reduce((s, a) => s + a.balance, 0);
  const totalBalance = totalCash + totalBank;
  const totalPaid = supplierPayments.reduce((s, p) => s + p.amount, 0);

  // Outstanding to suppliers — payable value of GRNs minus what's been paid.
  const outstandingPayable = useMemo(() => {
    const paidByGrn = new Map<string, number>();
    for (const p of supplierPayments)
      for (const a of p.allocations)
        paidByGrn.set(a.grnRef, (paidByGrn.get(a.grnRef) ?? 0) + a.amount);
    let sum = 0;
    for (const g of grns) {
      const bal = grnPayableAmount(g.lines) - (paidByGrn.get(g.id) ?? 0);
      if (bal > 0) sum += bal;
    }
    return roundQty(sum, 2);
  }, [grns, supplierPayments]);

  // Combined recent ledger — cash movements + supplier payments, newest first.
  type LedgerRow = { id: string; date: string; account: string; kind: string; ref: string; delta: number };
  const ledger: LedgerRow[] = useMemo(() => {
    const rows: LedgerRow[] = [
      ...cashTxns.map((t) => ({
        id: t.id, date: t.date, account: accountName(t.accountId),
        kind: t.type, ref: t.reference ?? "—", delta: t.amount,
      })),
      ...supplierPayments.map((p) => ({
        id: p.id, date: p.date, account: accountName(p.accountId),
        kind: `Supplier Payment · ${p.vendor}`, ref: p.reference ?? "—", delta: -p.amount,
      })),
    ];
    return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashTxns, supplierPayments, financialAccounts]);

  return (
    <>
      <PageHeader
        title="Accounts Dashboard"
        subtitle="Cash & bank position, supplier payments and money movements at a glance"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Cash in Hand" value={fmtBdt(totalCash)} icon={Banknote} tone="navy" />
        <KpiCard label="Bank Balance" value={fmtBdt(totalBank)} icon={Landmark} tone="navy" />
        <KpiCard label="Total Balance" value={fmtBdt(totalBalance)} icon={Wallet} tone="success" />
        <KpiCard label="Paid to Suppliers" value={fmtBdt(totalPaid)} icon={HandCoins} tone="navy" />
        <KpiCard label="Outstanding Payable" value={fmtBdt(outstandingPayable)} icon={Clock} tone="red" />
      </div>

      {/* Supplier payment ledger */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-sm uppercase tracking-wider">Supplier Payments</CardTitle></CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">Payment #</th>
                  <th className="p-3 text-left font-semibold">Date</th>
                  <th className="p-3 text-left font-semibold">Supplier</th>
                  <th className="p-3 text-left font-semibold">Method</th>
                  <th className="p-3 text-left font-semibold">From Account</th>
                  <th className="p-3 text-left font-semibold">GRNs</th>
                  <th className="p-3 text-right font-semibold">Amount</th>
                  <th className="p-3 text-left font-semibold">Paid By</th>
                </tr>
              </thead>
              <tbody>
                {supplierPayments.length === 0 ? (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No supplier payments recorded yet.</td></tr>
                ) : supplierPayments.map((p: WfSupplierPayment) => (
                  <tr key={p.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{p.id}</td>
                    <td className="p-3 whitespace-nowrap">{p.date}</td>
                    <td className="p-3">{p.vendor}</td>
                    <td className="p-3 text-muted-foreground">{p.method}</td>
                    <td className="p-3">{accountName(p.accountId)}</td>
                    <td className="p-3 text-xs text-muted-foreground">{p.allocations.map((a) => a.grnRef).join(", ")}</td>
                    <td className="p-3 text-right font-semibold tabular-nums">{fmtBdt(p.amount)}</td>
                    <td className="p-3">{p.paidBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent cash & bank movements */}
      <Card>
        <CardHeader><CardTitle className="text-sm uppercase tracking-wider">Recent Cash & Bank Movements</CardTitle></CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">Ref #</th>
                  <th className="p-3 text-left font-semibold">Date</th>
                  <th className="p-3 text-left font-semibold">Account</th>
                  <th className="p-3 text-left font-semibold">Type</th>
                  <th className="p-3 text-left font-semibold">Reference</th>
                  <th className="p-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledger.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No movements yet.</td></tr>
                ) : ledger.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{r.id}</td>
                    <td className="p-3 whitespace-nowrap">{r.date}</td>
                    <td className="p-3">{r.account}</td>
                    <td className="p-3 text-muted-foreground">{r.kind}</td>
                    <td className="p-3 text-muted-foreground">{r.ref}</td>
                    <td className={`p-3 text-right font-semibold tabular-nums whitespace-nowrap ${r.delta < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {r.delta < 0 ? "−" : "+"}{fmtBdt(Math.abs(r.delta))}
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
