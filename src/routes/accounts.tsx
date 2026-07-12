import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/common/StatusBadge";
import { KpiCard } from "@/components/common/KpiCard";
import { ShoppingCart, Receipt, CreditCard, Landmark, Clock, Wallet } from "lucide-react";
import { useWorkflow, accountBalance } from "@/lib/workflow-store";
import { buildBills, billStatusClass } from "@/lib/payables";
import { roundQty } from "@/lib/num";

const fmtBdt = (n: number) =>
  `৳ ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Purchase Orders tab ────────────────────────────────────────────────────────
function PurchaseOrdersTab() {
  const { wfPurchaseOrders } = useWorkflow();
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                {["PO #", "Vendor", "Items", "Amount", "Req Ref", "Date", "Status"].map((h) => (
                  <th key={h} className="p-3 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wfPurchaseOrders.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No purchase orders.</td></tr>
              ) : wfPurchaseOrders.map((po) => (
                <tr key={po.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="p-3 font-medium">{po.id}</td>
                  <td className="p-3">{po.vendor}</td>
                  <td className="p-3 text-center">{po.items}</td>
                  <td className="p-3 tabular-nums font-medium">{po.amount > 0 ? fmtBdt(po.amount) : "—"}</td>
                  <td className="p-3 text-muted-foreground">{po.requisitionRef || "—"}</td>
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{po.date}</td>
                  <td className="p-3"><StatusBadge status={po.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Vendor bills tab (GRN-derived) ─────────────────────────────────────────────
function BillsTab() {
  const { grns, supplierPayments } = useWorkflow();
  const bills = useMemo(() => buildBills(grns, supplierPayments), [grns, supplierPayments]);
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                {["Bill (GRN) #", "Vendor", "PO Ref", "Date", "Payable", "Paid", "Balance", "Status"].map((h) => (
                  <th key={h} className="p-3 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bills.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No vendor bills.</td></tr>
              ) : bills.map((b) => (
                <tr key={b.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="p-3 font-medium">{b.id}</td>
                  <td className="p-3">{b.vendor}</td>
                  <td className="p-3 text-muted-foreground">{b.poRef}</td>
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{b.date}</td>
                  <td className="p-3 tabular-nums font-medium">{fmtBdt(b.payable)}</td>
                  <td className="p-3 tabular-nums text-emerald-600">{fmtBdt(b.paid)}</td>
                  <td className="p-3 tabular-nums">{b.balance > 0 ? fmtBdt(b.balance) : "—"}</td>
                  <td className="p-3"><span className={`px-2 py-1 rounded text-xs font-medium ${billStatusClass(b.status)}`}>{b.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Payments tab ───────────────────────────────────────────────────────────────
function PaymentsTab() {
  const { supplierPayments, financialAccounts } = useWorkflow();
  const accountName = (id?: string) => financialAccounts.find((a) => a.id === id)?.name ?? "—";
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                {["Payment #", "Date", "Vendor", "Method", "From Account", "Bills", "Amount", "Paid By"].map((h) => (
                  <th key={h} className="p-3 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {supplierPayments.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No payments recorded.</td></tr>
              ) : supplierPayments.map((p) => (
                <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="p-3 font-medium">{p.id}</td>
                  <td className="p-3 whitespace-nowrap">{p.date}</td>
                  <td className="p-3">{p.vendor}</td>
                  <td className="p-3 text-muted-foreground">{p.method}</td>
                  <td className="p-3">{accountName(p.accountId)}</td>
                  <td className="p-3 text-xs text-muted-foreground">{p.allocations.map((a) => a.grnRef).join(", ")}</td>
                  <td className="p-3 tabular-nums font-semibold">{fmtBdt(p.amount)}</td>
                  <td className="p-3">{p.paidBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Cash & Bank tab ────────────────────────────────────────────────────────────
function CashBankTab() {
  const { financialAccounts, cashTxns, supplierPayments } = useWorkflow();
  const accounts = financialAccounts.map((a) => ({
    ...a,
    balance: roundQty(accountBalance(a.id, a.openingBalance, cashTxns, supplierPayments), 2),
  }));
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                {["Account", "Type", "Bank / No", "Opening", "Balance"].map((h) => (
                  <th key={h} className="p-3 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No accounts.</td></tr>
              ) : accounts.map((a) => (
                <tr key={a.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="p-3 font-medium">{a.name}</td>
                  <td className="p-3">{a.type}</td>
                  <td className="p-3 text-muted-foreground">{a.type === "Bank" ? `${a.bankName ?? "—"}${a.accountNo ? ` · ${a.accountNo}` : ""}` : "—"}</td>
                  <td className="p-3 tabular-nums text-muted-foreground">{fmtBdt(a.openingBalance)}</td>
                  <td className={`p-3 tabular-nums font-semibold ${a.balance < 0 ? "text-red-600" : ""}`}>{fmtBdt(a.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Accounts() {
  const { wfPurchaseOrders, grns, supplierPayments, financialAccounts, cashTxns } = useWorkflow();

  const bills = useMemo(() => buildBills(grns, supplierPayments), [grns, supplierPayments]);
  const outstanding = bills.reduce((s, b) => s + b.balance, 0);
  const paid = supplierPayments.reduce((s, p) => s + p.amount, 0);
  const cashBankTotal = financialAccounts.reduce(
    (s, a) => s + accountBalance(a.id, a.openingBalance, cashTxns, supplierPayments), 0,
  );

  return (
    <>
      <PageHeader
        title="Accounts Summary"
        subtitle="Consolidated view — purchase orders, vendor bills, payments and finance & banking"
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Purchase Orders" value={wfPurchaseOrders.length} icon={ShoppingCart} tone="navy" />
        <KpiCard label="Outstanding Payable" value={fmtBdt(outstanding)} icon={Clock} tone="red" />
        <KpiCard label="Paid to Suppliers" value={fmtBdt(paid)} icon={CreditCard} tone="success" />
        <KpiCard label="Finance & Banking" value={fmtBdt(cashBankTotal)} icon={Wallet} tone="navy" />
      </div>

      <Tabs defaultValue="po">
        <TabsList>
          <TabsTrigger value="po"><ShoppingCart className="h-4 w-4 mr-1" /> Purchase Orders</TabsTrigger>
          <TabsTrigger value="bills"><Receipt className="h-4 w-4 mr-1" /> Vendor Bills</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="h-4 w-4 mr-1" /> Payments</TabsTrigger>
          <TabsTrigger value="cashbank"><Landmark className="h-4 w-4 mr-1" /> Finance & Banking</TabsTrigger>
        </TabsList>

        <TabsContent value="po" className="mt-4"><PurchaseOrdersTab /></TabsContent>
        <TabsContent value="bills" className="mt-4"><BillsTab /></TabsContent>
        <TabsContent value="payments" className="mt-4"><PaymentsTab /></TabsContent>
        <TabsContent value="cashbank" className="mt-4"><CashBankTab /></TabsContent>
      </Tabs>
    </>
  );
}
