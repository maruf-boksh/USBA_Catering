import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Banknote, Landmark, Building2, Plus, SlidersHorizontal,
  ArrowDownCircle, ArrowUpCircle, Wallet, HandCoins, Search,
  ArrowDownLeft, ArrowUpRight, TrendingUp, TrendingDown, Coins,
} from "lucide-react";
import { toast } from "sonner";
import {
  useWorkflow, accountBalance,
  type WfAccountType, type WfCashTxnType, type WfFinancialAccount, type WfCashTxn,
} from "@/lib/workflow-store";
import { roundQty } from "@/lib/num";
import { logAudit } from "@/lib/audit-log";
import { cn } from "@/lib/utils";

const TXN_ACTORS = ["A. Rahman", "M. Karim", "S. Ahmed", "F. Begum", "N. Islam"];

const fmtBdt = (n: number) =>
  `৳ ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Ledger movement categories → badge styling + icon. Inflows are emerald,
// outflows red, corrections amber.
type LedgerCat = "deposit" | "withdrawal" | "adjustment" | "payment";
const CAT_STYLE: Record<LedgerCat, { label: string; cls: string }> = {
  deposit:    { label: "Deposit",         cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  withdrawal: { label: "Withdrawal",      cls: "bg-red-50 text-red-700 border-red-200" },
  adjustment: { label: "Adjustment",      cls: "bg-amber-50 text-amber-700 border-amber-200" },
  payment:    { label: "Supplier Payment", cls: "bg-orange-50 text-orange-700 border-orange-200" },
};

/**
 * Cash & Bank — a single Accounts module managing both cash and bank accounts.
 * Cash and Bank are shown as separate sections within the one module, with
 * shared account creation, transactions and a combined movement ledger.
 */
export default function AccountsCashBank() {
  const wf = useWorkflow();
  const {
    financialAccounts, cashTxns, supplierPayments, addFinancialAccount, addCashTxn,
  } = wf;

  const accounts = useMemo(
    () => financialAccounts.map((a) => ({
      ...a,
      balance: roundQty(accountBalance(a.id, a.openingBalance, cashTxns, supplierPayments), 2),
    })),
    [financialAccounts, cashTxns, supplierPayments],
  );
  const accountName = (id?: string) =>
    financialAccounts.find((a) => a.id === id)?.name ?? "—";

  type AccountWithBalance = WfFinancialAccount & { balance: number };
  const cashAccounts = accounts.filter((a) => a.type === "Cash");
  const bankAccounts = accounts.filter((a) => a.type === "Bank");

  const totalCash = cashAccounts.reduce((s, a) => s + a.balance, 0);
  const totalBank = bankAccounts.reduce((s, a) => s + a.balance, 0);
  const totalPaid = supplierPayments.reduce((s, p) => s + p.amount, 0);

  // ── Add Account dialog ──────────────────────────────────────────────────────
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctName, setAcctName] = useState("");
  const [acctType, setAcctType] = useState<WfAccountType>("Bank");
  const [acctBank, setAcctBank] = useState("");
  const [acctNo, setAcctNo] = useState("");
  const [acctOpening, setAcctOpening] = useState("");

  const resetAcct = () => {
    setAcctName(""); setAcctType("Bank"); setAcctBank(""); setAcctNo(""); setAcctOpening("");
  };
  const openAcct = (type: WfAccountType) => { resetAcct(); setAcctType(type); setAcctOpen(true); };

  const saveAccount = () => {
    if (!acctName.trim()) { toast.error("Account name is required."); return; }
    if (acctType === "Bank" && !acctBank.trim()) { toast.error("Bank name is required."); return; }
    const opening = Number(acctOpening) || 0;
    const id = `ACC-${String(financialAccounts.length + 1).padStart(3, "0")}`;
    const account: WfFinancialAccount = {
      id,
      name: acctName.trim(),
      type: acctType,
      bankName: acctType === "Bank" ? acctBank.trim() : undefined,
      accountNo: acctType === "Bank" ? acctNo.trim() || undefined : undefined,
      openingBalance: roundQty(opening, 2),
      active: true,
    };
    addFinancialAccount(account);
    logAudit({
      action: "Create",
      module: "Accounts",
      entity: id,
      detail: `Added ${acctType} account "${account.name}" with opening balance ${fmtBdt(account.openingBalance)}.`,
    });
    toast.success(`${account.name} added — opening ${fmtBdt(account.openingBalance)}.`);
    setAcctOpen(false);
    resetAcct();
  };

  // ── New Transaction dialog ──────────────────────────────────────────────────
  const [txnOpen, setTxnOpen] = useState(false);
  const [txnAccountId, setTxnAccountId] = useState("");
  const [txnType, setTxnType] = useState<WfCashTxnType>("Deposit");
  const [txnDirection, setTxnDirection] = useState<"Increase" | "Decrease">("Increase");
  const [txnAmount, setTxnAmount] = useState("");
  const [txnDate, setTxnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [txnReference, setTxnReference] = useState("");
  const [txnBy, setTxnBy] = useState("");
  const [txnNote, setTxnNote] = useState("");

  const openTxn = (accountId?: string) => {
    setTxnAccountId(accountId ?? financialAccounts.find((a) => a.active)?.id ?? "");
    setTxnType("Deposit");
    setTxnDirection("Increase");
    setTxnAmount("");
    setTxnDate(new Date().toISOString().slice(0, 10));
    setTxnReference("");
    setTxnBy("");
    setTxnNote("");
    setTxnOpen(true);
  };

  const saveTxn = () => {
    if (!txnAccountId) { toast.error("Select an account."); return; }
    const magnitude = Number(txnAmount) || 0;
    if (magnitude <= 0) { toast.error("Enter an amount greater than zero."); return; }
    if (!txnDate) { toast.error("Date is required."); return; }
    if (!txnBy) { toast.error("Recorded By is required."); return; }

    const signed =
      txnType === "Deposit" ? magnitude
      : txnType === "Withdrawal" ? -magnitude
      : txnDirection === "Increase" ? magnitude : -magnitude;

    const id = `TXN-${Date.now().toString().slice(-6)}`;
    const txn: WfCashTxn = {
      id,
      accountId: txnAccountId,
      type: txnType,
      amount: roundQty(signed, 2),
      date: txnDate,
      reference: txnReference.trim() || undefined,
      note: txnNote.trim() || undefined,
      by: txnBy,
      recordedAt: new Date().toLocaleString(),
    };
    addCashTxn(txn);
    logAudit({
      action: txnType,
      module: "Accounts",
      entity: id,
      detail: `${txnType} ${fmtBdt(Math.abs(signed))} on ${accountName(txnAccountId)}.`,
    });
    toast.success(`${txnType} of ${fmtBdt(Math.abs(signed))} recorded on ${accountName(txnAccountId)}.`);
    setTxnOpen(false);
  };

  // Combined movement ledger — cash txns + supplier payments, newest first.
  type LedgerRow = { id: string; date: string; account: string; kind: string; cat: LedgerCat; ref: string; delta: number };
  const ledger: LedgerRow[] = useMemo(() => {
    const rows: LedgerRow[] = [
      ...cashTxns.map((t) => ({
        id: t.id, date: t.date, account: accountName(t.accountId),
        kind: t.type, ref: t.reference ?? "—", delta: t.amount,
        cat: (t.type === "Deposit" ? "deposit" : t.type === "Withdrawal" ? "withdrawal" : "adjustment") as LedgerCat,
      })),
      ...supplierPayments.map((p) => ({
        id: p.id, date: p.date, account: accountName(p.accountId),
        kind: `Supplier Payment · ${p.vendor}`, ref: p.reference ?? "—", delta: -p.amount,
        cat: "payment" as LedgerCat,
      })),
    ];
    return rows.sort((a, b) => b.date.localeCompare(a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashTxns, supplierPayments, financialAccounts]);

  // Ledger filter + search.
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerFilter, setLedgerFilter] = useState<"all" | "in" | "out">("all");
  const filteredLedger = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    return ledger.filter((r) => {
      if (ledgerFilter === "in" && r.delta < 0) return false;
      if (ledgerFilter === "out" && r.delta >= 0) return false;
      if (!q) return true;
      return [r.id, r.account, r.kind, r.ref].some((v) => v.toLowerCase().includes(q));
    });
  }, [ledger, ledgerSearch, ledgerFilter]);

  const flow = useMemo(() => {
    const inflow = ledger.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);
    const outflow = ledger.filter((r) => r.delta < 0).reduce((s, r) => s + Math.abs(r.delta), 0);
    return { inflow, outflow, net: inflow - outflow };
  }, [ledger]);

  // ── Account card ────────────────────────────────────────────────────────────
  const renderAccountCard = (a: AccountWithBalance) => {
    const change = roundQty(a.balance - a.openingBalance, 2);
    const up = change >= 0;
    const isBank = a.type === "Bank";
    const lastMove = [...ledger].find((r) => r.account === a.name);
    return (
      <div
        key={a.id}
        className={cn(
          "group relative overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5",
          !a.active && "opacity-60",
        )}
      >
        {/* type accent bar */}
        <span className={cn("absolute inset-x-0 top-0 h-1", isBank ? "bg-sky-500" : "bg-teal-500")} />
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={cn(
                "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                isBank ? "bg-sky-50 text-sky-600" : "bg-teal-50 text-teal-600",
              )}>
                {isBank ? <Building2 className="h-5 w-5" /> : <Banknote className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold truncate">{a.name}</span>
                  <span className={cn(
                    "text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0",
                    isBank ? "bg-sky-50 text-sky-700 border-sky-200" : "bg-teal-50 text-teal-700 border-teal-200",
                  )}>{a.type}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
                  {isBank ? <>{a.bankName}{a.accountNo ? ` · ${a.accountNo}` : ""}</> : "Cash account"}
                </div>
              </div>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" title="New transaction" onClick={() => openTxn(a.id)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="mt-3.5">
            <div className={cn("text-[26px] font-bold tabular-nums leading-none", a.balance < 0 ? "text-red-600" : "text-foreground")}>
              {fmtBdt(a.balance)}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <span className="text-muted-foreground">Opening {fmtBdt(a.openingBalance)}</span>
              {change !== 0 && (
                <span className={cn(
                  "inline-flex items-center gap-0.5 font-semibold px-1.5 py-0.5 rounded-full",
                  up ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
                )}>
                  {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {up ? "+" : "−"}{fmtBdt(Math.abs(change)).replace("৳ ", "৳")}
                </span>
              )}
            </div>
          </div>

          {lastMove && (
            <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Coins className="h-3 w-3 shrink-0" />
              <span className="truncate">Last: {lastMove.kind}</span>
              <span className="ml-auto whitespace-nowrap tabular-nums">{lastMove.date}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSection = (
    type: WfAccountType, list: AccountWithBalance[], subtotal: number, Icon: typeof Banknote,
  ) => (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn("grid h-7 w-7 place-items-center rounded-lg", type === "Bank" ? "bg-sky-50 text-sky-600" : "bg-teal-50 text-teal-600")}>
            <Icon className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold">{type}</h3>
          <span className="text-sm font-semibold tabular-nums text-muted-foreground">· {fmtBdt(subtotal)}</span>
          <span className="text-[11px] text-muted-foreground">({list.length})</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openAcct(type)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add {type}
        </Button>
      </div>
      {list.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          No {type.toLowerCase()} accounts yet.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {list.map(renderAccountCard)}
        </div>
      )}
    </div>
  );

  const txnAccounts = financialAccounts.filter((a) => a.active);

  const FILTERS: { key: "all" | "in" | "out"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "in", label: "Money In" },
    { key: "out", label: "Money Out" },
  ];

  return (
    <>
      <PageHeader
        title="Finance & Banking"
        subtitle="Manage cash and bank accounts, record deposits/withdrawals and view the movement ledger"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => openTxn()} disabled={txnAccounts.length === 0}>
              <SlidersHorizontal className="h-4 w-4 mr-1" /> New Transaction
            </Button>
            <Button onClick={() => openAcct("Bank")}>
              <Plus className="h-4 w-4 mr-1" /> Add Account
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard variant="aurora" tone="indigo" label="Total Balance" value={fmtBdt(totalCash + totalBank)} sub={`${accounts.length} accounts`} icon={Wallet} />
        <KpiCard variant="aurora" tone="teal"   label="Cash in Hand"  value={fmtBdt(totalCash)}            sub={`${cashAccounts.length} cash`} icon={Banknote} />
        <KpiCard variant="aurora" tone="blue"   label="Bank Balance"  value={fmtBdt(totalBank)}            sub={`${bankAccounts.length} bank`} icon={Landmark} />
        <KpiCard variant="aurora" tone="rose"   label="Paid to Suppliers" value={fmtBdt(totalPaid)}        sub={`${supplierPayments.length} payments`} icon={HandCoins} />
      </div>

      {/* Money-flow strip */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <FlowStat label="Total In" value={fmtBdt(flow.inflow)} tone="in" Icon={ArrowDownLeft} />
        <FlowStat label="Total Out" value={fmtBdt(flow.outflow)} tone="out" Icon={ArrowUpRight} />
        <FlowStat label="Net Movement" value={`${flow.net >= 0 ? "+" : "−"}${fmtBdt(Math.abs(flow.net))}`} tone={flow.net >= 0 ? "in" : "out"} Icon={flow.net >= 0 ? TrendingUp : TrendingDown} />
      </div>

      {/* Cash & Bank as separate sections within the one module */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {renderSection("Cash", cashAccounts, totalCash, Banknote)}
        {renderSection("Bank", bankAccounts, totalBank, Landmark)}
      </div>

      {/* Movement ledger */}
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider">Cash &amp; Bank Movements</h3>
              <span className="text-[11px] text-muted-foreground">({filteredLedger.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setLedgerFilter(f.key)}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                      ledgerFilter === f.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={ledgerSearch} onChange={(e) => setLedgerSearch(e.target.value)} placeholder="Search movements..." className="pl-8 h-8 w-56 text-sm" />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
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
                {filteredLedger.length === 0 ? (
                  <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">
                    {ledger.length === 0 ? "No movements yet." : "No movements match your filter."}
                  </td></tr>
                ) : filteredLedger.map((r) => {
                  const inflow = r.delta >= 0;
                  return (
                    <tr key={r.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs font-medium">{r.id}</td>
                      <td className="p-3 whitespace-nowrap text-xs tabular-nums">{r.date}</td>
                      <td className="p-3">{r.account}</td>
                      <td className="p-3">
                        <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border", CAT_STYLE[r.cat].cls)}>
                          {inflow ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                          {r.cat === "payment" ? r.kind.replace("Supplier Payment · ", "") : CAT_STYLE[r.cat].label}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">{r.ref}</td>
                      <td className={cn("p-3 text-right font-semibold tabular-nums whitespace-nowrap", inflow ? "text-emerald-600" : "text-red-600")}>
                        {inflow ? "+" : "−"}{fmtBdt(Math.abs(r.delta))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filteredLedger.length > 0 && (
                <tfoot className="border-t-2 border-border bg-muted/30">
                  <tr>
                    <td colSpan={5} className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Net (all movements)</td>
                    <td className={cn("p-3 text-right font-bold tabular-nums", flow.net >= 0 ? "text-emerald-600" : "text-red-600")}>
                      {flow.net >= 0 ? "+" : "−"}{fmtBdt(Math.abs(flow.net))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add Account Dialog */}
      <Dialog open={acctOpen} onOpenChange={(v) => { if (!v) { setAcctOpen(false); resetAcct(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Add Cash / Bank Account</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Account Name *</Label>
              <Input value={acctName} onChange={(e) => setAcctName(e.target.value)} className="mt-1"
                placeholder={acctType === "Bank" ? "e.g. City Bank — Current A/C" : "e.g. Cash in Hand"} />
            </div>
            <div>
              <Label>Type *</Label>
              <select
                value={acctType}
                onChange={(e) => setAcctType(e.target.value as WfAccountType)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="Bank">Bank</option>
                <option value="Cash">Cash</option>
              </select>
            </div>
            <div>
              <Label>Opening Balance</Label>
              <Input type="number" min={0} step="any" value={acctOpening} onChange={(e) => setAcctOpening(e.target.value)} className="mt-1 text-right tabular-nums" placeholder="0.00" />
            </div>
            {acctType === "Bank" && (
              <>
                <div>
                  <Label>Bank Name *</Label>
                  <Input value={acctBank} onChange={(e) => setAcctBank(e.target.value)} className="mt-1" placeholder="e.g. City Bank PLC" />
                </div>
                <div>
                  <Label>Account No</Label>
                  <Input value={acctNo} onChange={(e) => setAcctNo(e.target.value)} className="mt-1" placeholder="Account number" />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAcctOpen(false); resetAcct(); }}>Cancel</Button>
            <Button onClick={saveAccount}>Add Account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Transaction Dialog */}
      <Dialog open={txnOpen} onOpenChange={setTxnOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> New Cash / Bank Transaction</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Account *</Label>
              <select
                value={txnAccountId}
                onChange={(e) => setTxnAccountId(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select account...</option>
                {txnAccounts.map((a) => {
                  const bal = accountBalance(a.id, a.openingBalance, cashTxns, supplierPayments);
                  return <option key={a.id} value={a.id}>{a.name} — {fmtBdt(bal)}</option>;
                })}
              </select>
            </div>
            <div>
              <Label>Type *</Label>
              <select
                value={txnType}
                onChange={(e) => setTxnType(e.target.value as WfCashTxnType)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="Deposit">Deposit (+)</option>
                <option value="Withdrawal">Withdrawal (−)</option>
                <option value="Adjustment">Adjustment (±)</option>
              </select>
            </div>
            {txnType === "Adjustment" ? (
              <div>
                <Label>Direction *</Label>
                <select
                  value={txnDirection}
                  onChange={(e) => setTxnDirection(e.target.value as "Increase" | "Decrease")}
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="Increase">Increase (+)</option>
                  <option value="Decrease">Decrease (−)</option>
                </select>
              </div>
            ) : (
              <div>
                <Label>Date *</Label>
                <Input type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} className="mt-1" />
              </div>
            )}
            {txnType === "Adjustment" && (
              <div>
                <Label>Date *</Label>
                <Input type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} className="mt-1" />
              </div>
            )}
            <div>
              <Label>Amount *</Label>
              <Input type="number" min={0} step="any" value={txnAmount} onChange={(e) => setTxnAmount(e.target.value)} className="mt-1 text-right tabular-nums" placeholder="0.00" />
            </div>
            <div>
              <Label>Recorded By *</Label>
              <select
                value={txnBy}
                onChange={(e) => setTxnBy(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select...</option>
                {TXN_ACTORS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <Label>Reference</Label>
              <Input value={txnReference} onChange={(e) => setTxnReference(e.target.value)} className="mt-1" placeholder="Deposit slip / cheque / voucher no" />
            </div>
            <div className="col-span-2">
              <Label>Note</Label>
              <Textarea value={txnNote} onChange={(e) => setTxnNote(e.target.value)} rows={2} className="mt-1" placeholder="Purpose / details" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTxnOpen(false)}>Cancel</Button>
            <Button onClick={saveTxn}>
              {txnType === "Deposit"
                ? <ArrowUpCircle className="h-4 w-4 mr-1.5" />
                : txnType === "Withdrawal"
                  ? <ArrowDownCircle className="h-4 w-4 mr-1.5" />
                  : <SlidersHorizontal className="h-4 w-4 mr-1.5" />}
              Record {txnType}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Compact money-flow tile for the Total In / Out / Net strip. */
function FlowStat({ label, value, tone, Icon }: { label: string; value: string; tone: "in" | "out"; Icon: typeof ArrowDownLeft }) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-xl border p-3.5",
      tone === "in" ? "bg-emerald-50/50 border-emerald-100" : "bg-red-50/50 border-red-100",
    )}>
      <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone === "in" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={cn("text-lg font-bold tabular-nums truncate", tone === "in" ? "text-emerald-700" : "text-red-700")}>{value}</div>
      </div>
    </div>
  );
}
