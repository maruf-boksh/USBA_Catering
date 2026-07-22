import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  TrendingUp, Wallet, Receipt, Search, Eye, CalendarDays, Users,
  ArrowDownLeft, Landmark, Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { offices as ALL_OFFICES, warehouses as ALL_WAREHOUSES } from "@/lib/sample-data";
import type { DamagedSale } from "@/routes/damaged-product-sales";

const tk = (n: number) => `৳ ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const thisMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM

/** A normalized income receipt — today sourced from Damaged Product Sales, but
 *  shaped so other income streams (scrap, asset disposal, etc.) can feed in. */
type IncomeReceipt = {
  id: string;
  date: string;
  source: string;
  sourceCls: string;
  description: string;
  qtyLabel: string;
  party: string;
  method: string;
  account: string;
  amount: number;
  sale: DamagedSale;
};

export default function AccountsIncomePage() {
  const [sales] = usePersistedState<DamagedSale[]>("damaged-product-sales", []);
  const [search, setSearch] = useState("");
  const [viewSale, setViewSale] = useState<DamagedSale | null>(null);

  const receipts: IncomeReceipt[] = useMemo(
    () =>
      sales
        .map((s) => ({
          id: s.id,
          date: s.saleDate,
          source: "Damaged Product Sale",
          sourceCls: "bg-amber-50 text-amber-700 border-amber-200",
          description: s.itemName,
          qtyLabel: `${s.qty} ${s.unit}`,
          party: s.buyer,
          method: s.paymentMode,
          account: s.accountName ?? "—",
          amount: s.totalValue,
          sale: s,
        }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [sales],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return receipts;
    return receipts.filter((r) =>
      [r.id, r.description, r.party, r.method, r.account, r.source].some((v) => v.toLowerCase().includes(q)),
    );
  }, [receipts, search]);

  const kpis = useMemo(() => {
    const total = receipts.reduce((s, r) => s + r.amount, 0);
    const mo = thisMonth();
    const month = receipts.filter((r) => r.date.startsWith(mo)).reduce((s, r) => s + r.amount, 0);
    const buyers = new Set(receipts.map((r) => r.party)).size;
    return { total, month, count: receipts.length, buyers };
  }, [receipts]);

  return (
    <>
      <PageHeader
        title="Income & Receipts"
        subtitle="Money received from sales & salvage — damaged product sales and other income streams"
        icon={<TrendingUp className="h-5 w-5 text-primary" />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard variant="aurora" tone="green"  label="Total Received"   value={tk(kpis.total)}  sub={`${kpis.count} receipts`} icon={Wallet} />
        <KpiCard variant="aurora" tone="teal"   label="This Month"       value={tk(kpis.month)}  sub={thisMonth()} icon={CalendarDays} />
        <KpiCard variant="aurora" tone="blue"   label="Receipts"         value={kpis.count}      sub="all-time" icon={Receipt} />
        <KpiCard variant="aurora" tone="indigo" label="Unique Buyers"    value={kpis.buyers}     sub="paying parties" icon={Users} />
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground">
          Each recorded sale posts a deposit to <span className="font-medium text-foreground">Finance &amp; Banking</span> and appears here as income.
        </p>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search receipt, item, buyer, account..." className="pl-8 h-8 w-72 text-sm" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs uppercase tracking-wider">Receipt #</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Source</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Buyer</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Deposited To</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Method</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Amount</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-14">
                      {receipts.length === 0
                        ? "No income receipts yet — record a sale on the Damaged Product Sales page."
                        : "No receipts match your search."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell>
                        <button className="font-mono text-xs font-semibold text-primary hover:underline" onClick={() => setViewSale(r.sale)}>{r.id}</button>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums whitespace-nowrap">{r.date}</TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border", r.sourceCls)}>
                          <ArrowDownLeft className="h-3 w-3" /> {r.source}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm font-medium max-w-[160px] truncate">{r.description}<span className="text-muted-foreground font-normal"> · {r.qtyLabel}</span></TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate">{r.party}</TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate">{r.account}</TableCell>
                      <TableCell className="text-xs">{r.method}</TableCell>
                      <TableCell className="text-xs tabular-nums text-right font-semibold text-emerald-600">+{tk(r.amount)}</TableCell>
                      <TableCell className="text-right">
                        <button className="inline-grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground hover:text-primary hover:border-primary/40" title="View receipt" onClick={() => setViewSale(r.sale)}>
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Receipt Detail Modal ─────────────────────────────────────────────── */}
      {viewSale && (
        <Dialog open={!!viewSale} onOpenChange={(o) => !o && setViewSale(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
                {viewSale.id} — Income Receipt
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <div className="grid grid-cols-2 gap-2 text-xs p-3 bg-muted/30 rounded-md border border-border">
                <div><span className="text-muted-foreground">Source: </span><strong>Damaged Product Sale</strong></div>
                <div><span className="text-muted-foreground">Date: </span><strong>{viewSale.saleDate}</strong></div>
                <div><span className="text-muted-foreground">Office: </span><strong>{ALL_OFFICES.find((o) => o.id === viewSale.officeId)?.name ?? viewSale.officeId}</strong></div>
                <div><span className="text-muted-foreground">Warehouse: </span><strong>{ALL_WAREHOUSES.find((w) => w.id === viewSale.warehouseId)?.name ?? viewSale.warehouseId}</strong></div>
              </div>

              <div className="flex items-center justify-between gap-3 p-3 rounded-md border border-emerald-200 bg-emerald-50/60">
                <div className="flex items-center gap-2 text-sm">
                  <Landmark className="h-4 w-4 text-emerald-600" />
                  <span className="text-muted-foreground">Deposited to</span>
                  <strong>{viewSale.accountName ?? "—"}</strong>
                  {viewSale.txnId && <span className="font-mono text-[11px] text-muted-foreground">· {viewSale.txnId}</span>}
                </div>
                <div className="text-lg font-bold tabular-nums text-emerald-700">+{tk(viewSale.totalValue)}</div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><Package className="h-3.5 w-3.5" /> Sale &amp; Payment</h4>
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableBody>
                      <ReceiptRow label="Item" value={`${viewSale.itemName}${viewSale.itemCode ? ` (${viewSale.itemCode})` : ""}`} />
                      <ReceiptRow label="Buyer / Party" value={viewSale.buyer} />
                      <ReceiptRow label="Sale Quantity" value={`${viewSale.qty} ${viewSale.unit}`} />
                      <ReceiptRow label="Unit Price" value={tk(viewSale.unitPrice)} />
                      <ReceiptRow label="Total Value" value={tk(viewSale.totalValue)} strong />
                      <ReceiptRow label="Payment Mode" value={viewSale.paymentMode} />
                      {viewSale.bankAccountNo && <ReceiptRow label="Bank A/C No" value={viewSale.bankAccountNo} />}
                      {viewSale.mobileProvider && <ReceiptRow label="Mobile Provider" value={viewSale.mobileProvider} />}
                      {viewSale.mobileNo && <ReceiptRow label="Mobile No" value={viewSale.mobileNo} />}
                      {viewSale.chequeNo && <ReceiptRow label="Cheque No" value={viewSale.chequeNo} />}
                      {viewSale.otherMethod && <ReceiptRow label="Other Method" value={viewSale.otherMethod} />}
                      <ReceiptRow label="Reference" value={viewSale.reference} />
                      <ReceiptRow label="Remarks" value={viewSale.remarks} />
                      <ReceiptRow label="Recorded By" value={`${viewSale.preparedBy} · ${viewSale.preparedAt}`} />
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function ReceiptRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground w-40 bg-muted/20">{label}</TableCell>
      <TableCell className={cn("text-xs", strong && "font-bold text-emerald-700")}>{value}</TableCell>
    </TableRow>
  );
}
