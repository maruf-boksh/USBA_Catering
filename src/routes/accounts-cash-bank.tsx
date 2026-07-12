import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Banknote, Landmark, Building2, Plus, SlidersHorizontal,
  ArrowDownCircle, ArrowUpCircle, Wallet, HandCoins,
} from "lucide-react";
import { toast } from "sonner";
import {
  useWorkflow, accountBalance,
  type WfAccountType, type WfCashTxnType, type WfFinancialAccount, type WfCashTxn,
} from "@/lib/workflow-store";
import { roundQty } from "@/lib/num";
import { logAudit } from "@/lib/audit-log";

const TXN_ACTORS = ["A. Rahman", "M. Karim", "S. Ahmed", "F. Begum", "N. Islam"];

const fmtBdt = (n: number) =>
  `৳ ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
    return rows.sort((a, b) => b.date.localeCompare(a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashTxns, supplierPayments, financialAccounts]);

  const renderAccountCard = (a: AccountWithBalance) => (
    <Card key={a.id} className={a.active ? "" : "opacity-60"}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {a.type === "Bank"
                ? <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                : <Banknote className="h-4 w-4 text-muted-foreground shrink-0" />}
              <span className="font-semibold truncate">{a.name}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {a.type === "Bank"
                ? <>{a.bankName}{a.accountNo ? ` · ${a.accountNo}` : ""}</>
                : <>Cash account</>}
            </div>
          </div>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openTxn(a.id)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-3">
          <div className={`text-2xl font-bold tabular-nums ${a.balance < 0 ? "text-red-600" : ""}`}>
            {fmtBdt(a.balance)}
          </div>
          <div className="text-[11px] text-muted-foreground">Opening {fmtBdt(a.openingBalance)}</div>
        </div>
      </CardContent>
    </Card>
  );

  const renderSection = (
    type: WfAccountType, list: AccountWithBalance[], subtotal: number, Icon: typeof Banknote,
  ) => (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{type}</h3>
          <span className="text-sm font-semibold tabular-nums text-muted-foreground">· {fmtBdt(subtotal)}</span>
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
        <KpiCard label="Cash in Hand" value={fmtBdt(totalCash)} icon={Banknote} tone="navy" />
        <KpiCard label="Bank Balance" value={fmtBdt(totalBank)} icon={Landmark} tone="navy" />
        <KpiCard label="Total Balance" value={fmtBdt(totalCash + totalBank)} icon={Wallet} tone="success" />
        <KpiCard label="Paid to Suppliers" value={fmtBdt(totalPaid)} icon={HandCoins} tone="navy" />
      </div>

      {/* Cash & Bank as separate sections within the one module */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {renderSection("Cash", cashAccounts, totalCash, Banknote)}
        {renderSection("Bank", bankAccounts, totalBank, Landmark)}
      </div>

      {/* Movement ledger */}
      <Card>
        <CardHeader><CardTitle className="text-sm uppercase tracking-wider">Cash & Bank Movements</CardTitle></CardHeader>
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
