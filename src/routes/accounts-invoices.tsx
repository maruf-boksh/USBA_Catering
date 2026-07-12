import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/common/KpiCard";
import { Receipt, Clock, CheckCircle2, Banknote, HandCoins } from "lucide-react";
import { useWorkflow } from "@/lib/workflow-store";
import { buildBills, billStatusClass, type SupplierBill } from "@/lib/payables";

const fmtBdt = (n: number) =>
  `৳ ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function InvoicesPayments() {
  const navigate = useNavigate();
  const { grns, supplierPayments } = useWorkflow();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<SupplierBill | null>(null);

  const bills = useMemo(() => buildBills(grns, supplierPayments), [grns, supplierPayments]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return bills.filter((b) =>
      b.id.toLowerCase().includes(q) ||
      b.vendor.toLowerCase().includes(q) ||
      b.poRef.toLowerCase().includes(q) ||
      (b.invoiceNo ?? "").toLowerCase().includes(q) ||
      b.status.toLowerCase().includes(q),
    );
  }, [bills, search]);

  const totalPayable = bills.reduce((s, b) => s + b.payable, 0);
  const totalPaid = bills.reduce((s, b) => s + b.paid, 0);
  const totalOutstanding = bills.reduce((s, b) => s + b.balance, 0);
  const openBills = bills.filter((b) => b.status !== "Paid").length;

  return (
    <>
      <PageHeader
        title="Invoices & Payments"
        subtitle="Vendor bills raised on goods receipt (GRN) and their live settlement status"
        actions={
          <Button onClick={() => navigate("/purchase-payment")}>
            <HandCoins className="h-4 w-4 mr-1" /> Record Payment
          </Button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Billed" value={fmtBdt(totalPayable)} icon={Receipt} tone="navy" />
        <KpiCard label="Open Bills" value={openBills} icon={Clock} tone="warning" />
        <KpiCard label="Paid" value={fmtBdt(totalPaid)} icon={Banknote} tone="success" />
        <KpiCard label="Outstanding" value={fmtBdt(totalOutstanding)} icon={CheckCircle2} tone="red" />
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search bill (GRN #), vendor, PO, invoice no, status..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {/* Vendor bills (GRN-derived) */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-sm uppercase tracking-wider">Vendor Bills</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">Bill (GRN) #</th>
                  <th className="p-3 text-left font-semibold">Vendor</th>
                  <th className="p-3 text-left font-semibold">PO Ref</th>
                  <th className="p-3 text-left font-semibold">Invoice No</th>
                  <th className="p-3 text-left font-semibold">Date</th>
                  <th className="p-3 text-right font-semibold">Payable</th>
                  <th className="p-3 text-right font-semibold">Paid</th>
                  <th className="p-3 text-right font-semibold">Balance</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                  <th className="p-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">No vendor bills found.</td></tr>
                ) : filtered.map((b) => (
                  <tr key={b.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">
                      {b.id}
                      {b.direct && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">Direct</span>}
                    </td>
                    <td className="p-3">{b.vendor}</td>
                    <td className="p-3 text-muted-foreground">{b.poRef}</td>
                    <td className="p-3 text-muted-foreground">{b.invoiceNo ?? "—"}</td>
                    <td className="p-3 whitespace-nowrap text-muted-foreground">{b.date}</td>
                    <td className="p-3 text-right font-medium tabular-nums">{fmtBdt(b.payable)}</td>
                    <td className="p-3 text-right tabular-nums text-emerald-600">{fmtBdt(b.paid)}</td>
                    <td className="p-3 text-right tabular-nums font-medium">{b.balance > 0 ? fmtBdt(b.balance) : "—"}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${billStatusClass(b.status)}`}>{b.status}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setView(b)}>View</Button>
                        {b.status !== "Paid" && (
                          <Button size="sm" className="h-7 px-2 text-xs" onClick={() => navigate("/purchase-payment")}>Pay</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Payment ledger */}
      <Card>
        <CardHeader><CardTitle className="text-sm uppercase tracking-wider">Payments Made</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">Payment #</th>
                  <th className="p-3 text-left font-semibold">Date</th>
                  <th className="p-3 text-left font-semibold">Vendor</th>
                  <th className="p-3 text-left font-semibold">Method</th>
                  <th className="p-3 text-left font-semibold">Bills</th>
                  <th className="p-3 text-right font-semibold">Amount</th>
                  <th className="p-3 text-left font-semibold">Paid By</th>
                </tr>
              </thead>
              <tbody>
                {supplierPayments.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No payments recorded yet.</td></tr>
                ) : supplierPayments.map((p) => (
                  <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{p.id}</td>
                    <td className="p-3 whitespace-nowrap">{p.date}</td>
                    <td className="p-3">{p.vendor}</td>
                    <td className="p-3 text-muted-foreground">{p.method}</td>
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

      {/* View bill dialog */}
      <Dialog open={!!view} onOpenChange={(v) => { if (!v) setView(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bill Details — {view?.id}</DialogTitle></DialogHeader>
          {view && (
            <div className="space-y-2.5 text-sm">
              {([
                ["Vendor", view.vendor],
                ["PO Reference", view.poRef],
                ["Invoice No", view.invoiceNo ?? "—"],
                ["Date", view.date],
                ["Type", view.direct ? "Direct / Spot purchase" : "PO-based"],
                ["Payable", fmtBdt(view.payable)],
                ["Paid", fmtBdt(view.paid)],
                ["Balance", fmtBdt(view.balance)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <span className="font-semibold w-36 shrink-0">{label}:</span>
                  <span className="text-muted-foreground">{value}</span>
                </div>
              ))}
              <div className="flex gap-2 items-center">
                <span className="font-semibold w-36 shrink-0">Status:</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${billStatusClass(view.status)}`}>{view.status}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            {view && view.status !== "Paid" && (
              <Button onClick={() => { setView(null); navigate("/purchase-payment"); }}>
                <HandCoins className="h-4 w-4 mr-1.5" /> Record Payment
              </Button>
            )}
            <Button variant="outline" onClick={() => setView(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
