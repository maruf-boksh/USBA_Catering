// Derived accounts-payable model. A GRN (goods received) is the vendor bill in
// this architecture — its payable value is Σ(qty × rate) over non-rejected lines
// (see grnPayableAmount). Supplier payments settle those bills via per-GRN
// allocations. Every Accounts page reads its numbers through these helpers so
// the payables register, approvals, expense analytics and summary all agree.

import { grnPayableAmount, type WfGRN, type WfSupplierPayment } from "@/lib/workflow-store";
import { roundQty } from "@/lib/num";

const r2 = (n: number) => roundQty(n, 2);

export type BillStatus = "Unpaid" | "Partial" | "Paid";

export type SupplierBill = {
  /** GRN id — the bill reference. */
  id: string;
  vendor: string;
  poRef: string;
  invoiceNo?: string;
  /** Official receipt date (grnDate) or the system timestamp. */
  date: string;
  /** True for a spot/direct purchase received without a prior PO. */
  direct: boolean;
  payable: number;
  paid: number;
  balance: number;
  status: BillStatus;
};

/** Total settled per GRN, summed across every payment's allocations. */
export function paidByGrn(payments: WfSupplierPayment[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of payments)
    for (const a of p.allocations)
      m.set(a.grnRef, (m.get(a.grnRef) ?? 0) + a.amount);
  return m;
}

/** Vendor bills derived from received GRNs, with live payment status. */
export function buildBills(grns: WfGRN[], payments: WfSupplierPayment[]): SupplierBill[] {
  const paid = paidByGrn(payments);
  return grns
    .map((g) => {
      const payable = r2(grnPayableAmount(g.lines));
      const p = r2(paid.get(g.id) ?? 0);
      const balance = r2(payable - p);
      const status: BillStatus = p <= 0 ? "Unpaid" : balance <= 0 ? "Paid" : "Partial";
      return {
        id: g.id, vendor: g.vendor, poRef: g.poRef, invoiceNo: g.invoiceNo,
        date: g.grnDate ?? g.date, direct: !!g.direct,
        payable, paid: p, balance, status,
      };
    })
    .filter((b) => b.payable > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export type VendorSpend = {
  vendor: string; bills: number; payable: number; paid: number; outstanding: number;
};

/** Vendor-wise spend rollup from the derived bills. */
export function vendorSpend(bills: SupplierBill[]): VendorSpend[] {
  const map = new Map<string, VendorSpend>();
  for (const b of bills) {
    const v = map.get(b.vendor) ?? { vendor: b.vendor, bills: 0, payable: 0, paid: 0, outstanding: 0 };
    v.bills += 1;
    v.payable = r2(v.payable + b.payable);
    v.paid = r2(v.paid + b.paid);
    v.outstanding = r2(v.outstanding + b.balance);
    map.set(b.vendor, v);
  }
  return [...map.values()].sort((a, b) => b.payable - a.payable);
}

export function billStatusClass(status: BillStatus): string {
  return status === "Paid" ? "bg-green-100 text-green-800"
    : status === "Partial" ? "bg-amber-100 text-amber-800"
    : "bg-slate-200 text-slate-700";
}
