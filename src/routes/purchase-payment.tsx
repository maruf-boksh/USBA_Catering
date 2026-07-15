import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Wallet, HandCoins, ReceiptText, Users } from "lucide-react";
import { toast } from "sonner";
import {
  useWorkflow, grnPayableAmount, accountBalance,
  type WfGRN, type WfPaymentMethod, type WfPaymentAllocation, type WfSupplierPayment,
} from "@/lib/workflow-store";
import { roundQty } from "@/lib/num";
import { logAudit } from "@/lib/audit-log";

const PAYMENT_METHODS: WfPaymentMethod[] = ["Bank Transfer", "Cheque", "Cash", "Mobile Banking"];
// Accounts/finance officers who can authorise a supplier payment.
const PAID_BY = ["A. Rahman", "M. Karim", "S. Ahmed", "F. Begum", "N. Islam"];

const fmtBdt = (n: number) =>
  `৳ ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A GRN owed to a supplier, with its payable / paid / balance figures. */
type PayableGRN = {
  grn: WfGRN;
  payable: number;   // Σ(qty × rate) over non-rejected lines
  paid: number;      // settled so far across prior payments
  balance: number;   // payable − paid (> 0 while outstanding)
};

/** One supplier's outstanding position. */
type SupplierDue = {
  /** DataTable requires a string id — the vendor name is unique per row. */
  id: string;
  vendor: string;
  unpaid: PayableGRN[];
  outstanding: number;
};

export default function PurchasePayment() {
  const wf = useWorkflow();
  const { grns, supplierPayments, addSupplierPayment, financialAccounts, cashTxns } = wf;

  const activeAccounts = useMemo(
    () => financialAccounts.filter((a) => a.active),
    [financialAccounts],
  );

  const [payOpen, setPayOpen] = useState(false);
  const [payVendor, setPayVendor] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState<WfPaymentMethod>("Bank Transfer");
  const [payReference, setPayReference] = useState("");
  const [payPaidBy, setPayPaidBy] = useState("");
  const [payAccountId, setPayAccountId] = useState("");
  const [payNote, setPayNote] = useState("");
  // grnId → amount to pay in this transaction. A key present means the GRN is
  // ticked; the value is the (possibly partial) amount being settled.
  const [payAlloc, setPayAlloc] = useState<Record<string, number>>({});

  // How much has already been paid against each GRN, summed across all payments.
  const paidByGrn = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of supplierPayments)
      for (const a of p.allocations)
        m.set(a.grnRef, (m.get(a.grnRef) ?? 0) + a.amount);
    return m;
  }, [supplierPayments]);

  // Every received GRN carries a payable value (Σ qty × rate over non-rejected
  // lines). Group the ones with an outstanding balance by supplier.
  const dues: SupplierDue[] = useMemo(() => {
    const byVendor = new Map<string, PayableGRN[]>();
    for (const grn of grns) {
      const payable = roundQty(grnPayableAmount(grn.lines), 2);
      if (payable <= 0) continue;
      const paid = roundQty(paidByGrn.get(grn.id) ?? 0, 2);
      const balance = roundQty(payable - paid, 2);
      if (balance <= 0) continue;
      const list = byVendor.get(grn.vendor) ?? [];
      list.push({ grn, payable, paid, balance });
      byVendor.set(grn.vendor, list);
    }
    return [...byVendor.entries()]
      .map(([vendor, unpaid]) => ({
        id: vendor,
        vendor,
        unpaid,
        outstanding: roundQty(unpaid.reduce((s, p) => s + p.balance, 0), 2),
      }))
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [grns, paidByGrn]);

  const totalOutstanding = dues.reduce((s, d) => s + d.outstanding, 0);
  const totalPaid = supplierPayments.reduce((s, p) => s + p.amount, 0);
  const payableGrnCount = dues.reduce((s, d) => s + d.unpaid.length, 0);

  // Unpaid GRNs for the vendor selected in the payment dialog.
  const vendorUnpaid = useMemo(
    () => dues.find((d) => d.vendor === payVendor)?.unpaid ?? [],
    [dues, payVendor],
  );
  const selectedIds = Object.keys(payAlloc);
  const selectedAmount = roundQty(
    vendorUnpaid
      .filter((p) => p.grn.id in payAlloc)
      .reduce((s, p) => s + (payAlloc[p.grn.id] || 0), 0),
    2,
  );

  // Default allocation = pay every unpaid GRN's full balance ("settle in full").
  const fullAlloc = (unpaid: PayableGRN[]): Record<string, number> =>
    Object.fromEntries(unpaid.map((p) => [p.grn.id, p.balance]));

  const resetPayForm = () => {
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayMethod("Bank Transfer");
    setPayReference("");
    setPayPaidBy("");
    setPayAccountId(activeAccounts[0]?.id ?? "");
    setPayNote("");
  };

  const openBlank = () => {
    setPayVendor("");
    setPayAlloc({});
    resetPayForm();
    setPayOpen(true);
  };

  const openPayFor = (vendor: string) => {
    setPayVendor(vendor);
    setPayAlloc(fullAlloc(dues.find((d) => d.vendor === vendor)?.unpaid ?? []));
    resetPayForm();
    setPayOpen(true);
  };

  const handleVendorChange = (vendor: string) => {
    setPayVendor(vendor);
    setPayAlloc(fullAlloc(dues.find((d) => d.vendor === vendor)?.unpaid ?? []));
  };

  const toggleGrn = (p: PayableGRN) =>
    setPayAlloc((prev) => {
      const next = { ...prev };
      if (p.grn.id in next) delete next[p.grn.id];
      else next[p.grn.id] = p.balance;
      return next;
    });

  // Editing the "Paying" cell — clamp to [0, balance] so a payment can never
  // exceed what's owed on the GRN.
  const setAllocAmount = (p: PayableGRN, value: number) =>
    setPayAlloc((prev) => ({
      ...prev,
      [p.grn.id]: Math.max(0, Math.min(roundQty(value, 2), p.balance)),
    }));

  const savePayment = () => {
    if (!payVendor) { toast.error("Select a supplier."); return; }
    if (selectedIds.length === 0) { toast.error("Select at least one GRN to pay."); return; }
    if (selectedAmount <= 0) { toast.error("Enter an amount to pay."); return; }
    if (!payDate) { toast.error("Payment date is required."); return; }
    if (!payPaidBy) { toast.error("Paid By is required."); return; }
    if (!payAccountId) { toast.error("Select the account to pay from."); return; }
    if (payMethod !== "Cash" && !payReference.trim()) {
      toast.error(`A ${payMethod.toLowerCase()} reference is required.`);
      return;
    }

    // Keep only ticked GRNs with a positive amount as allocations.
    const allocations: WfPaymentAllocation[] = vendorUnpaid
      .filter((p) => p.grn.id in payAlloc && (payAlloc[p.grn.id] || 0) > 0)
      .map((p) => ({ grnRef: p.grn.id, amount: roundQty(payAlloc[p.grn.id], 2) }));
    if (allocations.length === 0) { toast.error("Enter an amount for at least one GRN."); return; }

    const partial = vendorUnpaid.some(
      (p) => p.grn.id in payAlloc && (payAlloc[p.grn.id] || 0) > 0 && payAlloc[p.grn.id] < p.balance,
    );

    const stamp = Date.now().toString().slice(-5);
    const payment: WfSupplierPayment = {
      id: `PAY-${new Date().getFullYear()}-${stamp}`,
      vendor: payVendor,
      date: payDate,
      method: payMethod,
      reference: payReference.trim() || undefined,
      amount: roundQty(allocations.reduce((s, a) => s + a.amount, 0), 2),
      allocations,
      note: payNote.trim() || undefined,
      paidBy: payPaidBy,
      recordedAt: new Date().toLocaleString(),
      accountId: payAccountId,
    };
    addSupplierPayment(payment);
    const acctName = activeAccounts.find((a) => a.id === payAccountId)?.name ?? payAccountId;
    logAudit({
      action: "Payment",
      module: "Procurement",
      entity: payment.id,
      detail: `${partial ? "Partial payment" : "Paid"} ${fmtBdt(payment.amount)} to ${payVendor} from ${acctName} — ${allocations.length} GRN(s) via ${payMethod}.`,
    });
    toast.success(
      `${payment.id} recorded — ${fmtBdt(payment.amount)} to ${payVendor} across ${allocations.length} GRN(s)${partial ? " (partial)" : ""}.`,
    );
    setPayOpen(false);
  };

  // ── Supplier dues table ─────────────────────────────────────────────────────
  const dueCols: Column<SupplierDue>[] = [
    { key: "vendor", header: "Supplier" },
    {
      key: "unpaidCount", header: "Open GRNs",
      render: (d) => <span className="tabular-nums">{d.unpaid.length}</span>,
    },
    {
      key: "grnRefs", header: "GRN References",
      render: (d) => (
        <span className="text-xs text-muted-foreground">
          {d.unpaid.map((p) => p.grn.id).join(", ")}
        </span>
      ),
    },
    {
      key: "outstanding", header: "Outstanding",
      render: (d) => (
        <span className="font-semibold tabular-nums text-red-600">{fmtBdt(d.outstanding)}</span>
      ),
    },
  ];

  // ── Payment history table ───────────────────────────────────────────────────
  const payCols: Column<WfSupplierPayment>[] = [
    { key: "id", header: "Payment #" },
    { key: "vendor", header: "Supplier" },
    { key: "date", header: "Date" },
    { key: "method", header: "Method" },
    {
      key: "reference", header: "Reference",
      render: (p) => p.reference ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "allocations", header: "GRNs",
      render: (p) => (
        <span className="text-xs text-muted-foreground">
          {p.allocations.map((a) => a.grnRef).join(", ")}
        </span>
      ),
    },
    {
      key: "amount", header: "Amount",
      render: (p) => <span className="font-semibold tabular-nums">{fmtBdt(p.amount)}</span>,
    },
    { key: "paidBy", header: "Paid By" },
  ];

  return (
    <>
      <PageHeader
        title="Purchase Payment"
        subtitle="Settle supplier dues against received GRNs — supplier-wise, full or partial payment for the Local Purchase cycle"
        actions={
          <Button onClick={openBlank}>
            <HandCoins className="h-4 w-4 mr-1" /> Record Payment
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Outstanding" value={fmtBdt(totalOutstanding)} icon={Wallet} tone="red" />
        <KpiCard label="Paid to Date" value={fmtBdt(totalPaid)} icon={HandCoins} tone="success" />
        <KpiCard label="Open GRNs" value={payableGrnCount} icon={ReceiptText} tone="warning" />
        <KpiCard label="Suppliers with Dues" value={dues.length} icon={Users} tone="navy" />
      </div>

      <div className="mb-8">
        <h3 className="text-sm font-semibold mb-2">Supplier Dues</h3>
        <DataTable
          title="supplier-dues"
          data={dues}
          columns={dueCols}
          searchKeys={["vendor"]}
          selectable={false}
          actions={(d) => (
            <div className="flex items-center gap-1">
              <Button size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => openPayFor(d.vendor)}>
                <HandCoins className="h-3.5 w-3.5" /> Pay
              </Button>
            </div>
          )}
        />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Payment History</h3>
        <DataTable
          title="payment-history"
          data={supplierPayments}
          columns={payCols}
          searchKeys={["id", "vendor", "method", "reference"]}
          selectable={false}
          actions={(p) => <RowActions row={p} actions={["view", "print"]} />}
        />
      </div>

      {/* Record Payment Dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="h-4 w-4 text-primary" /> Record Supplier Payment
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Supplier *</Label>
              <select
                value={payVendor}
                onChange={(e) => handleVendorChange(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a supplier...</option>
                {dues.map((d) => (
                  <option key={d.vendor} value={d.vendor}>
                    {d.vendor} — {fmtBdt(d.outstanding)} due
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Payment Date *</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Payment Method *</Label>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as WfPaymentMethod)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label>{payMethod === "Cheque" ? "Cheque No" : payMethod === "Cash" ? "Voucher No" : "Transaction Ref"}{payMethod !== "Cash" ? " *" : ""}</Label>
              <Input
                value={payReference}
                onChange={(e) => setPayReference(e.target.value)}
                className="mt-1"
                placeholder={payMethod === "Cheque" ? "Cheque number" : "Bank / mobile txn id"}
              />
            </div>
            <div>
              <Label>Paid By *</Label>
              <select
                value={payPaidBy}
                onChange={(e) => setPayPaidBy(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select...</option>
                {PAID_BY.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <Label>Paid From (Account) *</Label>
              <select
                value={payAccountId}
                onChange={(e) => setPayAccountId(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select account...</option>
                {activeAccounts.map((a) => {
                  const bal = accountBalance(a.id, a.openingBalance, cashTxns, supplierPayments);
                  return (
                    <option key={a.id} value={a.id}>
                      {a.name} — {fmtBdt(bal)} available
                    </option>
                  );
                })}
              </select>
              {payAccountId && selectedAmount > 0 && (() => {
                const acct = activeAccounts.find((a) => a.id === payAccountId);
                if (!acct) return null;
                const bal = accountBalance(acct.id, acct.openingBalance, cashTxns, supplierPayments);
                return selectedAmount > bal ? (
                  <p className="mt-1 text-[11px] text-red-600">
                    Payment exceeds {acct.name} balance ({fmtBdt(bal)}) — account will go negative.
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Balance after payment: {fmtBdt(bal - selectedAmount)}
                  </p>
                );
              })()}
            </div>
            <div className="col-span-2">
              <Label>Remarks</Label>
              <Textarea
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                rows={2}
                className="mt-1"
                placeholder="Payment note, adjustment details, etc."
              />
            </div>
          </div>

          {/* GRNs to settle — tick a GRN and edit "Paying" for a partial amount. */}
          <div className="mt-2 min-w-0">
            <Label>GRNs to Settle</Label>
            <div className="mt-2 rounded-md border border-border overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 w-8" />
                    <th className="p-2 text-left font-semibold">GRN #</th>
                    <th className="p-2 text-left font-semibold">PO Ref</th>
                    <th className="p-2 text-right font-semibold">Payable</th>
                    <th className="p-2 text-right font-semibold">Balance</th>
                    <th className="p-2 text-right font-semibold w-32">Paying</th>
                  </tr>
                </thead>
                <tbody>
                  {!payVendor && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-xs text-muted-foreground">
                        Select a supplier to see open GRNs.
                      </td>
                    </tr>
                  )}
                  {payVendor && vendorUnpaid.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-xs text-muted-foreground">
                        No outstanding GRNs for this supplier.
                      </td>
                    </tr>
                  )}
                  {vendorUnpaid.map((p) => {
                    const checked = p.grn.id in payAlloc;
                    return (
                      <tr key={p.grn.id} className="border-t border-border/50">
                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleGrn(p)}
                            className="h-4 w-4 accent-primary"
                          />
                        </td>
                        <td className="p-2 font-medium">{p.grn.id}</td>
                        <td className="p-2 text-xs text-muted-foreground">{p.grn.poRef}</td>
                        <td className="p-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                          {fmtBdt(p.payable)}
                          {p.paid > 0 && (
                            <span className="block text-[10px]">paid {fmtBdt(p.paid)}</span>
                          )}
                        </td>
                        <td className="p-2 text-right tabular-nums whitespace-nowrap">{fmtBdt(p.balance)}</td>
                        <td className="p-2">
                          <Input
                            type="number" min={0} max={p.balance} step="any"
                            value={checked ? payAlloc[p.grn.id] : ""}
                            disabled={!checked}
                            onChange={(e) => setAllocAmount(p, Number(e.target.value))}
                            className="h-7 text-xs text-right tabular-nums"
                            placeholder="0.00"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {vendorUnpaid.length > 0 && (
                  <tfoot className="border-t border-border bg-muted/30">
                    <tr>
                      <td colSpan={5} className="p-2 text-xs font-semibold text-muted-foreground">
                        Paying ({selectedIds.length} GRN{selectedIds.length === 1 ? "" : "s"})
                      </td>
                      <td className="p-2 text-right text-sm font-bold tabular-nums whitespace-nowrap">
                        {fmtBdt(selectedAmount)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Payable value is Σ(qty × rate) over received lines not rejected in Quality Control. Edit
              <span className="font-medium"> Paying</span> to settle part of a GRN — the remaining balance stays in Outstanding.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={savePayment} disabled={selectedAmount <= 0}>
              <HandCoins className="h-4 w-4 mr-1.5" /> Pay {selectedAmount > 0 ? fmtBdt(selectedAmount) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
