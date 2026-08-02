import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Banknote, Landmark, Building2, Plus, SlidersHorizontal,
  ArrowDownCircle, ArrowUpCircle, Wallet, Search,
  ArrowDownLeft, ArrowUpRight, TrendingUp, TrendingDown,
  ArrowLeftRight, CheckCheck, CircleDashed, Layers,
} from "lucide-react";
import { toast } from "sonner";
import {
  useWorkflow,
  type WfAccountType, type WfCashTxnType, type WfFinancialAccount, type WfCashTxn,
} from "@/lib/workflow-store";
import { roundQty } from "@/lib/num";
import { logAudit } from "@/lib/audit-log";
import { cn } from "@/lib/utils";

const TXN_ACTORS = ["A. Rahman", "M. Karim", "S. Ahmed", "F. Begum", "N. Islam"];

const fmtBdt = (n: number) =>
  `৳ ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Compact form for rails and chips, where two decimals are just noise. */
const fmtShort = (n: number) => `৳${Math.round(n).toLocaleString()}`;

// Ledger movement categories → badge styling. Inflows emerald, outflows red,
// corrections amber, transfers violet (they are neither in nor out overall).
type LedgerCat = "deposit" | "withdrawal" | "adjustment" | "payment" | "transfer";
const CAT_STYLE: Record<LedgerCat, { label: string; cls: string }> = {
  deposit:    { label: "Deposit",          cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  withdrawal: { label: "Withdrawal",       cls: "bg-red-50 text-red-700 border-red-200" },
  adjustment: { label: "Adjustment",       cls: "bg-amber-50 text-amber-700 border-amber-200" },
  payment:    { label: "Supplier Payment", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  transfer:   { label: "Transfer",         cls: "bg-violet-50 text-violet-700 border-violet-200" },
};

const ROWS_PER_PAGE = 25;

/**
 * Local calendar date, NOT `toISOString().slice(0,10)`.
 *
 * toISOString converts to UTC first, so at UTC+06:00 the 1st of a month at
 * 00:00 local comes back as the last day of the previous month — "Last month"
 * resolved to 30 Jun → 30 Jul instead of 1–31 Jul, and a transaction recorded
 * before 06:00 was dated yesterday.
 */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/**
 * Reporting windows. A flow figure without a period is unreadable — "Total In
 * ৳500,000" over all time answers no question anyone asks of a cash book — so
 * every in/out figure on this page is scoped to one of these.
 */
type PresetKey = "this-month" | "last-month" | "last-90" | "ytd" | "all" | "custom";
function presetRange(key: PresetKey, today: Date): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (key) {
    case "this-month": return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "last-month": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "last-90":    return { from: iso(addDays(today, -89)), to: iso(today) };
    case "ytd":        return { from: iso(new Date(y, 0, 1)), to: iso(today) };
    default:           return { from: "", to: "" };
  }
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "last-90", label: "Last 90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "all", label: "All time" },
];

/**
 * Finance & Banking — cash and bank accounts, their movements, and the state of
 * the books for a chosen period.
 *
 * The page is built around the question a cash book exists to answer: what is
 * the balance, what moved in the period, and what has not been checked against
 * a statement yet. Accounts are a filter rail rather than a wall of cards, and
 * the ledger — the actual work — carries a running balance, a date range and
 * pagination so it stays usable past the third row.
 */
export default function AccountsCashBank() {
  const {
    financialAccounts, cashTxns, supplierPayments,
    addFinancialAccount, addCashTxn, addCashTxns, reconcileCashTxns,
  } = useWorkflow();

  const today = useMemo(() => new Date(), []);
  const accountName = (id?: string) => financialAccounts.find((a) => a.id === id)?.name ?? "—";

  // ── Period ────────────────────────────────────────────────────────────────
  const [preset, setPreset] = useState<PresetKey>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    return presetRange(preset, today);
  }, [preset, customFrom, customTo, today]);
  const inRange = (date: string) =>
    (!range.from || date >= range.from) && (!range.to || date <= range.to);
  /** The window of the same length immediately before this one. */
  const priorRange = useMemo(() => {
    if (!range.from || !range.to) return null;
    const from = new Date(range.from);
    const to = new Date(range.to);
    const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    return { from: iso(addDays(from, -days)), to: iso(addDays(from, -1)) };
  }, [range]);

  // ── Movements ─────────────────────────────────────────────────────────────
  type LedgerRow = {
    id: string; date: string; accountId: string; account: string;
    kind: string; cat: LedgerCat; ref: string; delta: number;
    /** Only cash transactions can be reconciled — a supplier payment is
     *  evidenced by its own voucher, not by this ledger. */
    reconcilable: boolean;
    reconciledAt?: string;
    transferId?: string;
    counterAccount?: string;
  };
  const ledger: LedgerRow[] = useMemo(() => {
    const rows: LedgerRow[] = [
      ...cashTxns.map((t) => ({
        id: t.id, date: t.date, accountId: t.accountId, account: accountName(t.accountId),
        kind: t.type, ref: t.reference ?? "—", delta: t.amount,
        cat: (t.type === "Deposit" ? "deposit"
          : t.type === "Withdrawal" ? "withdrawal"
          : t.type === "Transfer" ? "transfer" : "adjustment") as LedgerCat,
        reconcilable: true,
        reconciledAt: t.reconciledAt,
        transferId: t.transferId,
        counterAccount: t.counterAccountId ? accountName(t.counterAccountId) : undefined,
      })),
      ...supplierPayments.map((p) => ({
        id: p.id, date: p.date, accountId: p.accountId ?? "", account: accountName(p.accountId),
        kind: `Supplier Payment · ${p.vendor}`, ref: p.reference ?? "—", delta: -p.amount,
        cat: "payment" as LedgerCat,
        reconcilable: false,
      })),
    ];
    // Newest first, but stable within a day so a transfer's two legs stay together.
    return rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashTxns, supplierPayments, financialAccounts]);

  /**
   * Balance of an account as at a date — opening plus everything up to and
   * including it. Used for both the rail and the running-balance column, so a
   * row's balance and the account's headline figure can never disagree.
   */
  const balanceAsOf = (accountId: string, opening: number, upTo?: string) =>
    roundQty(
      ledger
        .filter((r) => r.accountId === accountId && (!upTo || r.date <= upTo))
        .reduce((s, r) => s + r.delta, opening),
      2,
    );

  const accounts = useMemo(
    () => financialAccounts.map((a) => ({
      ...a,
      balance: balanceAsOf(a.id, a.openingBalance, range.to || undefined),
      liveBalance: balanceAsOf(a.id, a.openingBalance),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [financialAccounts, ledger, range.to],
  );
  type AccountWithBalance = WfFinancialAccount & { balance: number; liveBalance: number };

  const totalCash = accounts.filter((a) => a.type === "Cash").reduce((s, a) => s + a.balance, 0);
  const totalBank = accounts.filter((a) => a.type === "Bank").reduce((s, a) => s + a.balance, 0);

  // ── Flow for the period, and the one before it ────────────────────────────
  const flowFor = (from: string, to: string) => {
    const rows = ledger.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
    // A transfer moves money between our own accounts — counting both legs
    // would inflate money-in and money-out by the same amount and make the
    // business look busier than it was. Excluded from both, shown separately.
    const external = rows.filter((r) => r.cat !== "transfer");
    const inflow = external.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);
    const outflow = external.filter((r) => r.delta < 0).reduce((s, r) => s + Math.abs(r.delta), 0);
    const transferred = rows.filter((r) => r.cat === "transfer" && r.delta > 0).reduce((s, r) => s + r.delta, 0);
    return { inflow, outflow, net: inflow - outflow, transferred };
  };
  const flow = useMemo(() => flowFor(range.from, range.to), [ledger, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const priorFlow = useMemo(
    () => (priorRange ? flowFor(priorRange.from, priorRange.to) : null),
    [ledger, priorRange], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const delta = (now: number, before?: number) => {
    if (before == null || before === 0) return null;
    return Math.round(((now - before) / before) * 100);
  };

  /** Where the money went in this period — the breakdown "Total Out" hid. */
  const outByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of ledger) {
      if (!inRange(r.date) || r.delta >= 0 || r.cat === "transfer") continue;
      const key = r.cat === "payment" ? "Supplier Payments" : CAT_STYLE[r.cat].label;
      map.set(key, (map.get(key) ?? 0) + Math.abs(r.delta));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, range]);

  // ── Ledger filters ────────────────────────────────────────────────────────
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<"all" | "in" | "out" | "transfer" | "unreconciled">("all");
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filteredLedger = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    return ledger.filter((r) => {
      if (!inRange(r.date)) return false;
      if (accountFilter !== "all" && r.accountId !== accountFilter) return false;
      if (kindFilter === "in" && r.delta <= 0) return false;
      if (kindFilter === "out" && r.delta >= 0) return false;
      if (kindFilter === "transfer" && r.cat !== "transfer") return false;
      if (kindFilter === "unreconciled" && (!r.reconcilable || r.reconciledAt)) return false;
      if (!q) return true;
      return [r.id, r.account, r.kind, r.ref].some((v) => v.toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, ledgerSearch, kindFilter, accountFilter, range]);

  /**
   * Running balance, but ONLY when a single account is in view.
   *
   * A running total down a list of mixed accounts is a number that belongs to
   * nothing — each account has its own balance. Showing one would invite people
   * to reconcile against a figure that never existed on any statement.
   */
  const runningBalances = useMemo(() => {
    if (accountFilter === "all") return null;
    const acct = financialAccounts.find((a) => a.id === accountFilter);
    if (!acct) return null;
    const map = new Map<string, number>();
    const ascending = ledger
      .filter((r) => r.accountId === accountFilter)
      .slice()
      .reverse();
    let bal = acct.openingBalance;
    for (const r of ascending) {
      bal = roundQty(bal + r.delta, 2);
      map.set(r.id, bal);
    }
    return map;
  }, [accountFilter, financialAccounts, ledger]);

  const totalPages = Math.max(1, Math.ceil(filteredLedger.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredLedger.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);
  const unreconciledCount = ledger.filter((r) => r.reconcilable && !r.reconciledAt && inRange(r.date)).length;

  const resetPage = () => setPage(1);

  const toggleSelected = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const markReconciled = (reconciled: boolean) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    reconcileCashTxns(ids, "F. Begum", reconciled);
    logAudit({
      action: reconciled ? "Reconcile" : "Unreconcile",
      module: "Accounts",
      entity: ids.join(", "),
      detail: `${ids.length} movement${ids.length === 1 ? "" : "s"} marked ${reconciled ? "reconciled" : "unreconciled"}.`,
    });
    toast.success(`${ids.length} movement${ids.length === 1 ? "" : "s"} marked ${reconciled ? "reconciled" : "unreconciled"}.`);
    setSelected(new Set());
  };

  // ── Add Account dialog ────────────────────────────────────────────────────
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

  // ── New Transaction dialog ────────────────────────────────────────────────
  const [txnOpen, setTxnOpen] = useState(false);
  const [txnAccountId, setTxnAccountId] = useState("");
  const [txnType, setTxnType] = useState<WfCashTxnType>("Deposit");
  const [txnDirection, setTxnDirection] = useState<"Increase" | "Decrease">("Increase");
  const [txnAmount, setTxnAmount] = useState("");
  const [txnDate, setTxnDate] = useState(() => iso(new Date()));
  const [txnReference, setTxnReference] = useState("");
  const [txnBy, setTxnBy] = useState("");
  const [txnNote, setTxnNote] = useState("");

  const openTxn = (accountId?: string) => {
    setTxnAccountId(accountId ?? financialAccounts.find((a) => a.active)?.id ?? "");
    setTxnType("Deposit");
    setTxnDirection("Increase");
    setTxnAmount("");
    setTxnDate(iso(new Date()));
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

  // ── Transfer dialog ───────────────────────────────────────────────────────
  const [trfOpen, setTrfOpen] = useState(false);
  const [trfFrom, setTrfFrom] = useState("");
  const [trfTo, setTrfTo] = useState("");
  const [trfAmount, setTrfAmount] = useState("");
  const [trfDate, setTrfDate] = useState(() => iso(new Date()));
  const [trfRef, setTrfRef] = useState("");
  const [trfBy, setTrfBy] = useState("");
  const [trfNote, setTrfNote] = useState("");

  const openTransfer = () => {
    const active = financialAccounts.filter((a) => a.active);
    setTrfFrom(active.find((a) => a.type === "Cash")?.id ?? active[0]?.id ?? "");
    setTrfTo(active.find((a) => a.type === "Bank")?.id ?? active[1]?.id ?? "");
    setTrfAmount(""); setTrfDate(iso(new Date())); setTrfRef(""); setTrfBy(""); setTrfNote("");
    setTrfOpen(true);
  };

  const trfFromBalance = trfFrom
    ? accounts.find((a) => a.id === trfFrom)?.liveBalance ?? 0
    : 0;

  const saveTransfer = () => {
    if (!trfFrom || !trfTo) { toast.error("Choose both accounts."); return; }
    if (trfFrom === trfTo) { toast.error("Transfer needs two different accounts."); return; }
    const amount = Number(trfAmount) || 0;
    if (amount <= 0) { toast.error("Enter an amount greater than zero."); return; }
    if (!trfDate) { toast.error("Date is required."); return; }
    if (!trfBy) { toast.error("Recorded By is required."); return; }
    if (amount > trfFromBalance) {
      toast.error(`${accountName(trfFrom)} holds ${fmtBdt(trfFromBalance)} — not enough to transfer ${fmtBdt(amount)}.`);
      return;
    }

    const stamp = Date.now().toString().slice(-6);
    const transferId = `TRF-${stamp}`;
    const recordedAt = new Date().toLocaleString();
    const reference = trfRef.trim() || `${accountName(trfFrom)} → ${accountName(trfTo)}`;
    // Both legs in one write. Half a transfer is money that left the business
    // books without arriving anywhere.
    addCashTxns([
      {
        id: `TXN-${stamp}O`, accountId: trfFrom, type: "Transfer", amount: roundQty(-amount, 2),
        date: trfDate, reference, note: trfNote.trim() || undefined, by: trfBy, recordedAt,
        transferId, counterAccountId: trfTo,
      },
      {
        id: `TXN-${stamp}I`, accountId: trfTo, type: "Transfer", amount: roundQty(amount, 2),
        date: trfDate, reference, note: trfNote.trim() || undefined, by: trfBy, recordedAt,
        transferId, counterAccountId: trfFrom,
      },
    ]);
    logAudit({
      action: "Transfer",
      module: "Accounts",
      entity: transferId,
      detail: `Transferred ${fmtBdt(amount)} from ${accountName(trfFrom)} to ${accountName(trfTo)}.`,
    });
    toast.success(`${fmtBdt(amount)} transferred — ${accountName(trfFrom)} → ${accountName(trfTo)}.`);
    setTrfOpen(false);
  };

  const txnAccounts = financialAccounts.filter((a) => a.active);
  const periodLabel = range.from || range.to
    ? `${range.from || "…"} → ${range.to || "…"}`
    : "all time";

  const KIND_FILTERS = [
    { key: "all", label: "All" },
    { key: "in", label: "Money In" },
    { key: "out", label: "Money Out" },
    { key: "transfer", label: "Transfers" },
    { key: "unreconciled", label: `Unreconciled${unreconciledCount ? ` (${unreconciledCount})` : ""}` },
  ] as const;

  return (
    <>
      <PageHeader
        title="Finance & Banking"
        subtitle="Cash and bank accounts, their movements and what still needs checking against a statement"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={openTransfer} disabled={txnAccounts.length < 2}>
              <ArrowLeftRight className="h-4 w-4 mr-1" /> Transfer
            </Button>
            <Button variant="outline" onClick={() => openTxn()} disabled={txnAccounts.length === 0}>
              <SlidersHorizontal className="h-4 w-4 mr-1" /> New Transaction
            </Button>
            <Button onClick={() => openAcct("Bank")}>
              <Plus className="h-4 w-4 mr-1" /> Add Account
            </Button>
          </div>
        }
      />

      {/* ── Period — every flow figure below is scoped to this ─────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">Period</span>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => { setPreset(p.key); resetPage(); }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              preset === p.key
                ? "border-primary bg-primary/10 text-primary font-semibold"
                : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 ml-1">
          <Input
            type="date" value={preset === "custom" ? customFrom : range.from}
            onChange={(e) => { setCustomFrom(e.target.value); setCustomTo(customTo || e.target.value); setPreset("custom"); resetPage(); }}
            className="h-8 w-36 text-xs tabular-nums"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date" value={preset === "custom" ? customTo : range.to}
            onChange={(e) => { setCustomTo(e.target.value); setPreset("custom"); resetPage(); }}
            className="h-8 w-36 text-xs tabular-nums"
          />
        </div>
      </div>

      {/* ── Four figures: position, then the flow that produced it ─────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          variant="aurora" tone="indigo" icon={Wallet}
          label="Closing Balance"
          value={fmtBdt(totalCash + totalBank)}
          sub={range.to ? `as at ${range.to} · ${fmtShort(totalCash)} cash · ${fmtShort(totalBank)} bank` : `${fmtShort(totalCash)} cash · ${fmtShort(totalBank)} bank`}
        />
        <KpiCard
          variant="aurora" tone="teal" icon={ArrowDownLeft}
          label="Money In"
          value={fmtBdt(flow.inflow)}
          sub={(() => {
            const d = delta(flow.inflow, priorFlow?.inflow);
            return d == null ? `in ${periodLabel}` : `${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}% vs previous period`;
          })()}
        />
        <KpiCard
          variant="aurora" tone="rose" icon={ArrowUpRight}
          label="Money Out"
          value={fmtBdt(flow.outflow)}
          sub={(() => {
            const d = delta(flow.outflow, priorFlow?.outflow);
            return d == null ? `in ${periodLabel}` : `${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}% vs previous period`;
          })()}
        />
        <KpiCard
          variant="aurora" tone="blue" icon={flow.net >= 0 ? TrendingUp : TrendingDown}
          label="Net Movement"
          value={`${flow.net >= 0 ? "+" : "−"}${fmtBdt(Math.abs(flow.net))}`}
          sub={flow.transferred > 0 ? `excludes ${fmtShort(flow.transferred)} moved between own accounts` : `in ${periodLabel}`}
        />
      </div>

      {/* ── Account rail + ledger ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 items-start">
        {/* Accounts are a FILTER, not a wall of cards — every account stays
            visible at once, and picking one scopes the ledger beside it. */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Accounts</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => openAcct("Cash")}>+ Cash</Button>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => openAcct("Bank")}>+ Bank</Button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => { setAccountFilter("all"); resetPage(); }}
                className={cn(
                  "w-full flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 mb-1.5 text-left transition-colors",
                  accountFilter === "all" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                )}
              >
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <Layers className="h-3.5 w-3.5 text-muted-foreground" /> All accounts
                </span>
                <span className="text-xs font-bold tabular-nums">{fmtShort(totalCash + totalBank)}</span>
              </button>

              {(["Cash", "Bank"] as WfAccountType[]).map((type) => {
                const list = accounts.filter((a) => a.type === type) as AccountWithBalance[];
                if (list.length === 0) return null;
                return (
                  <div key={type} className="mt-2">
                    <div className="px-1 mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {type} · {fmtShort(list.reduce((s, a) => s + a.balance, 0))}
                    </div>
                    {list.map((a) => {
                      const active = accountFilter === a.id;
                      const isBank = a.type === "Bank";
                      const open = roundQty(a.balance - a.openingBalance, 2);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => { setAccountFilter(a.id); resetPage(); }}
                          className={cn(
                            "w-full flex items-start gap-2 rounded-lg border px-2.5 py-2 mb-1.5 text-left transition-colors",
                            active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                          )}
                        >
                          <span className={cn(
                            "grid h-7 w-7 shrink-0 place-items-center rounded-lg mt-0.5",
                            isBank ? "bg-sky-50 text-sky-600" : "bg-teal-50 text-teal-600",
                          )}>
                            {isBank ? <Building2 className="h-3.5 w-3.5" /> : <Banknote className="h-3.5 w-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold">{a.name}</span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {isBank ? `${a.bankName ?? "Bank"}${a.accountNo ? ` · ${a.accountNo}` : ""}` : "Cash account"}
                            </span>
                          </span>
                          <span className="text-right shrink-0">
                            <span className={cn("block text-xs font-bold tabular-nums", a.balance < 0 && "text-red-600")}>
                              {fmtShort(a.balance)}
                            </span>
                            {open !== 0 && (
                              <span className={cn("block text-[10px] tabular-nums", open > 0 ? "text-emerald-600" : "text-red-600")}>
                                {open > 0 ? "+" : "−"}{fmtShort(Math.abs(open))}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Where the money went — the breakdown a single "Total Out" hid. */}
          <Card>
            <CardContent className="p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Money Out · {periodLabel}
              </div>
              {outByCategory.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">Nothing went out in this period.</p>
              ) : outByCategory.map(([label, amount]) => {
                const pct = flow.outflow > 0 ? Math.round((amount / flow.outflow) * 100) : 0;
                return (
                  <div key={label} className="mb-2 last:mb-0">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-semibold tabular-nums">{fmtShort(amount)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-red-400" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* ── Ledger ──────────────────────────────────────────────────────── */}
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-sm font-bold uppercase tracking-wider truncate">
                  {accountFilter === "all" ? "All Movements" : accountName(accountFilter)}
                </h3>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                  {filteredLedger.length} in {periodLabel}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30">
                  {KIND_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => { setKindFilter(f.key); resetPage(); }}
                      className={cn(
                        "px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                        kindFilter === f.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={ledgerSearch}
                    onChange={(e) => { setLedgerSearch(e.target.value); resetPage(); }}
                    placeholder="Search movements..."
                    className="pl-8 h-8 w-48 text-sm"
                  />
                </div>
              </div>
            </div>

            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-4 py-2">
                <span className="text-xs font-semibold text-primary">{selected.size} selected</span>
                <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => markReconciled(true)}>
                  <CheckCheck className="h-3 w-3 mr-1" /> Mark reconciled
                </Button>
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => markReconciled(false)}>
                  Clear reconciliation
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setSelected(new Set())}>
                  Cancel
                </Button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-3 w-8"></th>
                    <th className="p-3 text-left font-semibold">Ref #</th>
                    <th className="p-3 text-left font-semibold">Date</th>
                    {accountFilter === "all" && <th className="p-3 text-left font-semibold">Account</th>}
                    <th className="p-3 text-left font-semibold">Type</th>
                    <th className="p-3 text-left font-semibold">Reference</th>
                    <th className="p-3 text-right font-semibold">Amount</th>
                    {runningBalances && <th className="p-3 text-right font-semibold">Balance</th>}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={8} className="p-10 text-center text-muted-foreground">
                      {ledger.length === 0 ? "No movements yet." : "No movements match this period and filter."}
                    </td></tr>
                  ) : pageRows.map((r) => {
                    const inflow = r.delta >= 0;
                    return (
                      <tr key={r.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                        <td className="p-3">
                          {r.reconcilable && (
                            <Checkbox
                              checked={selected.has(r.id)}
                              onCheckedChange={() => toggleSelected(r.id)}
                              className="h-3.5 w-3.5"
                              title="Select for reconciliation"
                            />
                          )}
                        </td>
                        <td className="p-3 font-mono text-xs font-medium whitespace-nowrap">
                          {r.id}
                          {r.reconcilable && (
                            r.reconciledAt
                              ? <CheckCheck className="inline h-3 w-3 ml-1 text-emerald-600" aria-label="Reconciled" />
                              : <CircleDashed className="inline h-3 w-3 ml-1 text-muted-foreground/60" aria-label="Not reconciled" />
                          )}
                        </td>
                        <td className="p-3 whitespace-nowrap text-xs tabular-nums">{r.date}</td>
                        {accountFilter === "all" && <td className="p-3 text-xs">{r.account}</td>}
                        <td className="p-3">
                          <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap", CAT_STYLE[r.cat].cls)}>
                            {r.cat === "transfer"
                              ? <ArrowLeftRight className="h-3 w-3" />
                              : inflow ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                            {r.cat === "payment"
                              ? r.kind.replace("Supplier Payment · ", "")
                              : r.cat === "transfer"
                                ? `${inflow ? "From" : "To"} ${r.counterAccount ?? "—"}`
                                : CAT_STYLE[r.cat].label}
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground text-xs max-w-[220px] truncate" title={r.ref}>{r.ref}</td>
                        <td className={cn("p-3 text-right font-semibold tabular-nums whitespace-nowrap", inflow ? "text-emerald-600" : "text-red-600")}>
                          {inflow ? "+" : "−"}{fmtBdt(Math.abs(r.delta))}
                        </td>
                        {runningBalances && (
                          <td className="p-3 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                            {runningBalances.has(r.id) ? fmtBdt(runningBalances.get(r.id)!) : "—"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                {filteredLedger.length > 0 && (
                  <tfoot className="border-t-2 border-border bg-muted/30">
                    <tr>
                      <td colSpan={accountFilter === "all" ? 6 : 5} className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Net · {periodLabel}
                      </td>
                      <td className={cn("p-3 text-right font-bold tabular-nums", flow.net >= 0 ? "text-emerald-600" : "text-red-600")}>
                        {flow.net >= 0 ? "+" : "−"}{fmtBdt(Math.abs(flow.net))}
                      </td>
                      {runningBalances && <td className="p-3" />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {(safePage - 1) * ROWS_PER_PAGE + 1}–{Math.min(safePage * ROWS_PER_PAGE, filteredLedger.length)} of {filteredLedger.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Prev</Button>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{safePage} / {totalPages}</span>
                  <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
                  const bal = accounts.find((x) => x.id === a.id)?.liveBalance ?? a.openingBalance;
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

      {/* Transfer Dialog — writes BOTH legs, so the pair can never half-save */}
      <Dialog open={trfOpen} onOpenChange={setTrfOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" /> Transfer Between Accounts</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">
            Records one movement out of the source and one into the destination, linked as a pair.
            The business total is unchanged, so a transfer is excluded from money in and money out.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>From *</Label>
              <select
                value={trfFrom}
                onChange={(e) => setTrfFrom(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select account...</option>
                {txnAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {fmtBdt(accounts.find((x) => x.id === a.id)?.liveBalance ?? a.openingBalance)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>To *</Label>
              <select
                value={trfTo}
                onChange={(e) => setTrfTo(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select account...</option>
                {txnAccounts.filter((a) => a.id !== trfFrom).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {fmtBdt(accounts.find((x) => x.id === a.id)?.liveBalance ?? a.openingBalance)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Amount *</Label>
              <Input type="number" min={0} step="any" value={trfAmount} onChange={(e) => setTrfAmount(e.target.value)} className="mt-1 text-right tabular-nums" placeholder="0.00" />
              {trfFrom && (
                <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                  Available: {fmtBdt(trfFromBalance)}
                </p>
              )}
            </div>
            <div>
              <Label>Date *</Label>
              <Input type="date" value={trfDate} onChange={(e) => setTrfDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Recorded By *</Label>
              <select
                value={trfBy}
                onChange={(e) => setTrfBy(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select...</option>
                {TXN_ACTORS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <Label>Reference</Label>
              <Input value={trfRef} onChange={(e) => setTrfRef(e.target.value)} className="mt-1" placeholder="Deposit slip / voucher no" />
            </div>
            <div className="col-span-2">
              <Label>Note</Label>
              <Textarea value={trfNote} onChange={(e) => setTrfNote(e.target.value)} rows={2} className="mt-1" placeholder="Purpose / details" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrfOpen(false)}>Cancel</Button>
            <Button onClick={saveTransfer}>
              <ArrowLeftRight className="h-4 w-4 mr-1.5" /> Record Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
