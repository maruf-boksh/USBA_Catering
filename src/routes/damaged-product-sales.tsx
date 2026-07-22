import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ShoppingCart, Search, Eye, Wallet, Package, CheckCircle2, HandCoins,
  Plus, ArrowLeft, Save, Building2, Warehouse as WarehouseIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRole } from "@/lib/roles";
import { useWorkflow, type WfCashTxn } from "@/lib/workflow-store";
import { logAudit } from "@/lib/audit-log";
import {
  items as ITEM_SEED, itemCanSell, type ItemMaster,
  activeOffices, activeWarehousesByOffice,
  offices as ALL_OFFICES, warehouses as ALL_WAREHOUSES,
  inventory as INVENTORY_SEED, consumableItems as CONSUMABLE_SEED,
} from "@/lib/sample-data";
import { AddCustomerDialog, CUSTOMER_STORE_KEY, CUSTOMER_SEED, type Customer } from "@/routes/config-customer";

const PAYMENT_MODES = ["Cash", "Bank Transfer", "Mobile Banking", "Cheque", "Other"];
const MOBILE_PROVIDERS = ["Bkash", "Nagad", "Other"];

const tk = (n: number) => `Tk. ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayDate = () => new Date().toISOString().slice(0, 10);
const nowStamp = () => {
  const d = new Date();
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
};

/** A standalone damaged-product salvage sale (recorded on this page). */
export type DamagedSale = {
  id: string;
  saleDate: string;
  officeId: string;
  warehouseId: string;
  itemName: string;
  itemCode: string;
  qty: number;
  unit: string;
  unitPrice: number;
  totalValue: number;
  buyer: string;
  paymentMode: string;
  reference: string;
  remarks: string;
  bankAccountNo?: string;
  mobileProvider?: string;
  mobileNo?: string;
  chequeNo?: string;
  otherMethod?: string;
  /** Accounts posting: the Cash/Bank account credited and the cash-txn id. */
  accountId?: string;
  accountName?: string;
  txnId?: string;
  preparedBy: string;
  preparedAt: string;
};

type SaleForm = {
  officeId: string;
  warehouseId: string;
  itemName: string;
  itemCode: string;
  unit: string;
  qty: string;
  unitPrice: string;
  saleDate: string;
  buyer: string;
  paymentMode: string;
  reference: string;
  remarks: string;
  bankAccountNo: string;
  mobileProvider: string;
  mobileProviderOther: string;
  mobileNo: string;
  chequeNo: string;
  otherMethod: string;
};

const emptyForm = (): SaleForm => ({
  officeId: "", warehouseId: "", itemName: "", itemCode: "", unit: "",
  qty: "", unitPrice: "", saleDate: todayDate(), buyer: "", paymentMode: "",
  reference: "", remarks: "", bankAccountNo: "", mobileProvider: "",
  mobileProviderOther: "", mobileNo: "", chequeNo: "", otherMethod: "",
});

const STATUS_STYLE = "bg-emerald-100 text-emerald-700";

const genId = (rows: DamagedSale[]) => {
  const year = todayDate().slice(0, 4);
  return `DPS-${year}-${String(rows.length + 1).padStart(4, "0")}`;
};

export default function DamagedProductSalesPage() {
  const { role } = useRole();
  const { financialAccounts, addCashTxn } = useWorkflow();
  const [sales, setSales] = usePersistedState<DamagedSale[]>("damaged-product-sales", []);
  const [view, setView] = useState<"list" | "form">("list");
  const [form, setForm] = useState<SaleForm>(emptyForm());
  const [viewSale, setViewSale] = useState<DamagedSale | null>(null);
  const [search, setSearch] = useState("");

  // Customer master (shared with the Customer Profile config page).
  const [customers, setCustomers] = usePersistedState<Customer[]>(CUSTOMER_STORE_KEY, CUSTOMER_SEED);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const activeCustomers = useMemo(() => customers.filter((c) => c.status === "Active"), [customers]);

  // Item master (shared with Item Profile). Only active, sellable items ("Can be
  // Sold" ticked in Item Profile) are offered in the sale's Item picker.
  const [itemRows] = usePersistedState<ItemMaster[]>("config-item-rows", ITEM_SEED);
  const sellableItems = useMemo(() => itemRows.filter((i) => i.status === "Active" && itemCanSell(i)), [itemRows]);

  // Live on-hand stock — shared with the Inventory & galley stores (fall back to
  // the sample-data seed so stock shows even before those pages mount).
  const [persistedInventory] = usePersistedState<{ name: string; stock: number; uom?: string }[]>("inventory-items", []);
  const [persistedAirport] = usePersistedState<{ name: string; stock: number; uom?: string }[]>("airline-consumables-items", []);
  const stockPool = useMemo(() => {
    const kitchen = persistedInventory.length > 0 ? persistedInventory : INVENTORY_SEED.map((i) => ({ name: i.name, stock: i.stock, uom: i.uom }));
    const airport = persistedAirport.length > 0 ? persistedAirport : CONSUMABLE_SEED.map((c) => ({ name: c.name, stock: c.stock, uom: c.uom }));
    return [...kitchen, ...airport];
  }, [persistedInventory, persistedAirport]);
  const stockForItem = (name: string): number => {
    const q = name.trim().toLowerCase();
    if (!q) return 0;
    return stockPool.find((i) => i.name.toLowerCase() === q)?.stock ?? 0;
  };

  // Item cascade filters (Item Type → Category → Sub-category → Item).
  const [itemTypeFilter, setItemTypeFilter] = useState("");
  const [itemCatFilter, setItemCatFilter] = useState("");
  const [itemSubFilter, setItemSubFilter] = useState("");
  const itemTypeChoices = useMemo(() => Array.from(new Set(sellableItems.map((i) => i.itemType))), []);
  const itemCatChoices = useMemo(
    () => Array.from(new Set(sellableItems.filter((i) => !itemTypeFilter || i.itemType === itemTypeFilter).map((i) => i.category))).sort(),
    [itemTypeFilter],
  );
  const itemSubChoices = useMemo(
    () => Array.from(new Set(sellableItems
      .filter((i) => (!itemTypeFilter || i.itemType === itemTypeFilter) && (!itemCatFilter || i.category === itemCatFilter))
      .map((i) => i.subCategory).filter(Boolean))).sort(),
    [itemTypeFilter, itemCatFilter],
  );
  const itemChoices = useMemo(
    () => sellableItems.filter((i) =>
      (!itemTypeFilter || i.itemType === itemTypeFilter) &&
      (!itemCatFilter || i.category === itemCatFilter) &&
      (!itemSubFilter || i.subCategory === itemSubFilter)),
    [itemTypeFilter, itemCatFilter, itemSubFilter],
  );

  const totalValue = (Number(form.qty) || 0) * (Number(form.unitPrice) || 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter((e) =>
      e.id.toLowerCase().includes(q) ||
      e.itemName.toLowerCase().includes(q) ||
      e.buyer.toLowerCase().includes(q) ||
      e.paymentMode.toLowerCase().includes(q),
    );
  }, [sales, search]);

  const kpis = useMemo(() => ({
    total: sales.length,
    qty: sales.reduce((s, e) => s + e.qty, 0),
    value: sales.reduce((s, e) => s + e.totalValue, 0),
  }), [sales]);

  const openNew = () => { setForm(emptyForm()); setView("form"); };

  const handleSave = () => {
    if (!form.officeId) { toast.error("Office is required."); return; }
    if (!form.warehouseId) { toast.error("Warehouse is required."); return; }
    if (!form.itemName) { toast.error("Select an item."); return; }
    if (!form.qty || Number(form.qty) <= 0) { toast.error("Valid sale quantity is required."); return; }
    if (!form.unitPrice || Number(form.unitPrice) < 0) { toast.error("Valid unit price is required."); return; }
    if (!form.buyer.trim()) { toast.error("Buyer / party is required."); return; }
    if (!form.paymentMode) { toast.error("Select a payment mode."); return; }
    if (form.paymentMode === "Bank Transfer" && !form.bankAccountNo.trim()) { toast.error("Provide the bank A/C no."); return; }
    if (form.paymentMode === "Mobile Banking") {
      if (!form.mobileProvider) { toast.error("Select a mobile banking provider."); return; }
      if (form.mobileProvider === "Other" && !form.mobileProviderOther.trim()) { toast.error("Specify the mobile banking provider."); return; }
      if (!form.mobileNo.trim()) { toast.error("Provide the mobile banking no."); return; }
    }
    if (form.paymentMode === "Cheque" && !form.chequeNo.trim()) { toast.error("Provide the cheque no."); return; }
    if (form.paymentMode === "Other" && !form.otherMethod.trim()) { toast.error("Provide the other payment method."); return; }

    const qtyNum = Number(form.qty);
    const priceNum = Number(form.unitPrice);
    const total = Math.round(qtyNum * priceNum * 100) / 100;
    const saleId = genId(sales);

    // ── Post the salvage income to the Accounts (Finance & Banking) module ──
    // Route the receipt to a Cash account for cash/mobile/other, or a Bank
    // account for bank transfer / cheque; fall back to any active account.
    const wantBank = form.paymentMode === "Bank Transfer" || form.paymentMode === "Cheque";
    const active = financialAccounts.filter((a) => a.active);
    const target =
      active.find((a) => a.type === (wantBank ? "Bank" : "Cash")) ??
      active[0] ??
      financialAccounts[0];
    let txnId: string | undefined;
    if (target && total > 0) {
      txnId = `TXN-${Date.now().toString().slice(-6)}`;
      const txn: WfCashTxn = {
        id: txnId,
        accountId: target.id,
        type: "Deposit",
        amount: total,
        date: form.saleDate || todayDate(),
        reference: saleId,
        note: `Damaged product salvage sale — ${form.itemName} × ${qtyNum} ${form.unit} to ${form.buyer.trim()}`,
        by: role,
        recordedAt: nowStamp(),
      };
      addCashTxn(txn);
      logAudit({
        action: "Deposit",
        module: "Accounts",
        entity: txnId,
        detail: `Salvage sale ${saleId}: deposited ${tk(total)} to ${target.name} (${form.paymentMode}).`,
      });
    }

    const sale: DamagedSale = {
      id: saleId,
      saleDate: form.saleDate || todayDate(),
      officeId: form.officeId,
      warehouseId: form.warehouseId,
      itemName: form.itemName,
      itemCode: form.itemCode,
      qty: qtyNum,
      unit: form.unit,
      unitPrice: priceNum,
      totalValue: total,
      buyer: form.buyer.trim(),
      paymentMode: form.paymentMode,
      reference: form.reference.trim() || "N/A",
      remarks: form.remarks.trim() || "N/A",
      ...(form.paymentMode === "Bank Transfer" ? { bankAccountNo: form.bankAccountNo.trim() } : {}),
      ...(form.paymentMode === "Mobile Banking"
        ? {
            mobileProvider: form.mobileProvider === "Other" ? (form.mobileProviderOther.trim() || "Other") : form.mobileProvider,
            mobileNo: form.mobileNo.trim(),
          }
        : {}),
      ...(form.paymentMode === "Cheque" ? { chequeNo: form.chequeNo.trim() } : {}),
      ...(form.paymentMode === "Other" ? { otherMethod: form.otherMethod.trim() } : {}),
      ...(target ? { accountId: target.id, accountName: target.name } : {}),
      ...(txnId ? { txnId } : {}),
      preparedBy: role,
      preparedAt: nowStamp(),
    };
    setSales((prev) => [sale, ...prev]);
    toast.success(
      target
        ? `${sale.id} recorded — ${tk(total)} deposited to ${target.name}.`
        : `${sale.id} recorded — ${tk(total)} from ${sale.buyer}.`,
    );
    setForm(emptyForm());
    setView("list");
  };

  // ── Create form (full page) ────────────────────────────────────────────────
  if (view === "form") {
    return (
      <>
        <PageHeader
          title="New Damaged Product Sale"
          subtitle="Record a salvage sale of damaged / disposed stock"
          icon={<HandCoins className="h-5 w-5 text-primary" />}
          actions={
            <Button variant="outline" size="sm" onClick={() => { setView("list"); setForm(emptyForm()); }}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to list
            </Button>
          }
        />
        <div className="space-y-5 pb-4">
          <Card>
            <CardContent className="pt-6 space-y-6">
              {/* Location */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs flex items-center gap-1"><Building2 className="h-3 w-3" /> Office <span className="text-red-500">*</span></Label>
                  <Select value={form.officeId || undefined} onValueChange={(v) => setForm({ ...form, officeId: v, warehouseId: "" })}>
                    <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Select office" /></SelectTrigger>
                    <SelectContent>{activeOffices.map((o) => <SelectItem key={o.id} value={o.id} className="text-sm">{o.code} — {o.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs flex items-center gap-1"><WarehouseIcon className="h-3 w-3" /> Warehouse <span className="text-red-500">*</span></Label>
                  <Select value={form.warehouseId || undefined} onValueChange={(v) => setForm({ ...form, warehouseId: v })} disabled={!form.officeId}>
                    <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder={form.officeId ? "Select warehouse" : "Select office first"} /></SelectTrigger>
                    <SelectContent>{(form.officeId ? activeWarehousesByOffice(form.officeId) : []).map((w) => <SelectItem key={w.id} value={w.id} className="text-sm">{w.code} — {w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Sale Date</Label>
                  <Input type="date" className="mt-1 h-9 text-sm" value={form.saleDate} onChange={(e) => setForm({ ...form, saleDate: e.target.value })} />
                </div>
              </div>

              {/* Item cascade */}
              <div>
                <Label className="text-xs">Item <span className="text-red-500">*</span></Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-1">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Item Type</Label>
                    <Select value={itemTypeFilter || "all"} onValueChange={(v) => { setItemTypeFilter(v === "all" ? "" : v); setItemCatFilter(""); setItemSubFilter(""); }}>
                      <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        {itemTypeChoices.map((t) => <SelectItem key={t} value={t} className="text-sm">{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Category</Label>
                    <Select value={itemCatFilter || "all"} onValueChange={(v) => { setItemCatFilter(v === "all" ? "" : v); setItemSubFilter(""); }}>
                      <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All categories</SelectItem>
                        {itemCatChoices.map((c) => <SelectItem key={c} value={c} className="text-sm">{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Sub Category</Label>
                    <Select value={itemSubFilter || "all"} onValueChange={(v) => setItemSubFilter(v === "all" ? "" : v)}>
                      <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All sub-categories</SelectItem>
                        {itemSubChoices.map((s) => <SelectItem key={s} value={s} className="text-sm">{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Item <span className="text-red-500">*</span></Label>
                    <Select
                      value={sellableItems.find((i) => i.name === form.itemName)?.id || undefined}
                      onValueChange={(v) => {
                        const it = sellableItems.find((i) => i.id === v);
                        if (!it) return;
                        setForm({ ...form, itemName: it.name, itemCode: it.code, unit: it.uom || form.unit });
                      }}
                    >
                      <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>
                        {itemChoices.length === 0
                          ? <div className="px-2 py-3 text-xs text-muted-foreground text-center">No items match.</div>
                          : itemChoices.map((i) => <SelectItem key={i.id} value={i.id} className="text-sm">{i.code} — {i.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {form.itemName && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    <p className="text-[11px] text-muted-foreground">Selected: <strong className="text-foreground">{form.itemName}</strong> · Unit: <strong className="text-foreground">{form.unit || "—"}</strong></p>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
                      <Package className="h-3 w-3" /> Current stock: {stockForItem(form.itemName).toLocaleString()} {form.unit || ""}
                    </span>
                  </div>
                )}
              </div>

              {/* Sale amounts */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-xs">Sale Quantity <span className="text-red-500">*</span></Label>
                  <div className="flex gap-2 mt-1">
                    <Input type="number" min="0" className="h-9 text-sm flex-1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder="0" />
                    <Input readOnly disabled className="h-9 w-20 text-sm bg-muted/40 cursor-not-allowed text-center font-medium" value={form.unit || "—"} title="Unit is set by the selected item." />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Unit Price (Tk) <span className="text-red-500">*</span></Label>
                  <Input type="number" min="0" className="mt-1 h-9 text-sm" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} placeholder="0.00" />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs">Total Value</Label>
                  <Input readOnly disabled className="mt-1 h-9 text-sm bg-emerald-50 border-emerald-200 text-emerald-700 font-bold cursor-not-allowed" value={tk(totalValue)} />
                </div>
              </div>

              {/* Buyer & payment */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Sold To (Buyer / Party) <span className="text-red-500">*</span></Label>
                  <div className="flex gap-2 mt-1">
                    <Select value={form.buyer || undefined} onValueChange={(v) => setForm({ ...form, buyer: v })}>
                      <SelectTrigger className="h-9 text-sm flex-1"><SelectValue placeholder="Select customer" /></SelectTrigger>
                      <SelectContent>
                        {activeCustomers.length === 0
                          ? <div className="px-2 py-3 text-xs text-muted-foreground text-center">No customers yet — add one →</div>
                          : activeCustomers.map((c) => <SelectItem key={c.id} value={c.name} className="text-sm">{c.name}{c.category ? ` · ${c.category}` : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={() => setAddCustomerOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" /> New
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Payment Mode <span className="text-red-500">*</span></Label>
                  <Select value={form.paymentMode || undefined} onValueChange={(v) => setForm({ ...form, paymentMode: v, bankAccountNo: "", mobileProvider: "", mobileProviderOther: "", mobileNo: "", chequeNo: "", otherMethod: "" })}>
                    <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Select payment mode" /></SelectTrigger>
                    <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>

                {form.paymentMode === "Bank Transfer" && (
                  <div>
                    <Label className="text-xs">Bank A/C No <span className="text-red-500">*</span></Label>
                    <Input className="mt-1 h-9 text-sm" value={form.bankAccountNo} onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })} placeholder="Account number" />
                  </div>
                )}
                {form.paymentMode === "Mobile Banking" && (
                  <>
                    <div>
                      <Label className="text-xs">Provider <span className="text-red-500">*</span></Label>
                      <Select value={form.mobileProvider || undefined} onValueChange={(v) => setForm({ ...form, mobileProvider: v, mobileProviderOther: "" })}>
                        <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Select provider" /></SelectTrigger>
                        <SelectContent>{MOBILE_PROVIDERS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                      </Select>
                      {form.mobileProvider === "Other" && (
                        <Input className="mt-2 h-9 text-sm" value={form.mobileProviderOther} onChange={(e) => setForm({ ...form, mobileProviderOther: e.target.value })} placeholder="Provider name" />
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">Mobile No <span className="text-red-500">*</span></Label>
                      <Input className="mt-1 h-9 text-sm" value={form.mobileNo} onChange={(e) => setForm({ ...form, mobileNo: e.target.value })} placeholder="01XXXXXXXXX" />
                    </div>
                  </>
                )}
                {form.paymentMode === "Cheque" && (
                  <div>
                    <Label className="text-xs">Cheque No <span className="text-red-500">*</span></Label>
                    <Input className="mt-1 h-9 text-sm" value={form.chequeNo} onChange={(e) => setForm({ ...form, chequeNo: e.target.value })} placeholder="Cheque number" />
                  </div>
                )}
                {form.paymentMode === "Other" && (
                  <div>
                    <Label className="text-xs">Payment Method <span className="text-red-500">*</span></Label>
                    <Input className="mt-1 h-9 text-sm" value={form.otherMethod} onChange={(e) => setForm({ ...form, otherMethod: e.target.value })} placeholder="Describe the method" />
                  </div>
                )}

                <div>
                  <Label className="text-xs">Reference</Label>
                  <Input className="mt-1 h-9 text-sm" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Txn / receipt ref" />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs">Remarks</Label>
                  <Textarea className="mt-1 text-sm" rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} placeholder="Optional notes..." />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setView("list"); setForm(emptyForm()); }}>Cancel</Button>
            <Button onClick={handleSave} className="gap-1.5"><Save className="h-4 w-4" /> Save Sale</Button>
          </div>
        </div>

        <AddCustomerDialog
          open={addCustomerOpen}
          onOpenChange={setAddCustomerOpen}
          nextId={`CUS-${String(customers.length + 1).padStart(3, "0")}`}
          onCreate={(c) => { setCustomers((prev) => [c, ...prev]); setForm((f) => ({ ...f, buyer: c.name })); }}
        />
      </>
    );
  }

  // ── List ────────────────────────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title="Damaged Product Sales"
        subtitle="Salvage sales of damaged / disposed products — buyers, value recovered & payment tracking"
        actions={<Button size="sm" className="gap-1.5" onClick={openNew}><Plus className="h-4 w-4" /> New Sale</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Total Sales"     value={kpis.total}                sub="sale records"     icon={ShoppingCart} tone="info" />
        <KpiCard label="Qty Sold"        value={kpis.qty.toLocaleString()} sub="cumulative units" icon={Package}      tone="navy" />
        <KpiCard label="Value Recovered" value={tk(kpis.value)}            sub="total sale value"  icon={Wallet}      tone="success" />
      </div>

      <div className="flex items-center justify-end mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ID, item, buyer, payment..." className="pl-8 h-8 w-72 text-sm" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs uppercase tracking-wider">Ref</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Sale Date</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Unit Price</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Total Value</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Buyer</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Payment</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-14">
                      No damaged-product sales yet.{" "}
                      <button className="text-primary underline" onClick={openNew}>Record the first sale</button>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((e) => (
                    <TableRow key={e.id} className="hover:bg-muted/30">
                      <TableCell>
                        <button className="font-mono text-xs font-semibold text-primary hover:underline" onClick={() => setViewSale(e)}>{e.id}</button>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{e.saleDate}</TableCell>
                      <TableCell className="text-sm font-medium max-w-[160px] truncate">{e.itemName}</TableCell>
                      <TableCell className="text-xs tabular-nums text-right">{e.qty} {e.unit}</TableCell>
                      <TableCell className="text-xs tabular-nums text-right">{tk(e.unitPrice)}</TableCell>
                      <TableCell className="text-xs tabular-nums text-right font-semibold text-emerald-700">{tk(e.totalValue)}</TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate">{e.buyer}</TableCell>
                      <TableCell className="text-xs">{e.paymentMode}</TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="outline" className="h-7 w-7 text-muted-foreground hover:text-primary hover:border-primary/40" title="View sale details" onClick={() => setViewSale(e)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Sale Detail Modal ─────────────────────────────────────────────────── */}
      {viewSale && (
        <Dialog open={!!viewSale} onOpenChange={(o) => !o && setViewSale(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <HandCoins className="h-5 w-5 text-emerald-600" />
                {viewSale.id} — Damaged Product Sale
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <div className="grid grid-cols-2 gap-2 text-xs p-3 bg-muted/30 rounded-md border border-border">
                <div><span className="text-muted-foreground">Item: </span><strong>{viewSale.itemName}</strong></div>
                <div><span className="text-muted-foreground">Sale Date: </span><strong>{viewSale.saleDate}</strong></div>
                <div><span className="text-muted-foreground">Office: </span><strong>{ALL_OFFICES.find((o) => o.id === viewSale.officeId)?.name ?? viewSale.officeId}</strong></div>
                <div><span className="text-muted-foreground">Warehouse: </span><strong>{ALL_WAREHOUSES.find((w) => w.id === viewSale.warehouseId)?.name ?? viewSale.warehouseId}</strong></div>
                <div className="flex items-center gap-1"><span className="text-muted-foreground">Status: </span>
                  <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", STATUS_STYLE)}>Recorded</span>
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Sale &amp; Payment</h4>
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableBody>
                      <SaleRow label="Buyer / Party" value={viewSale.buyer} />
                      <SaleRow label="Sale Quantity" value={`${viewSale.qty} ${viewSale.unit}`} />
                      <SaleRow label="Unit Price" value={tk(viewSale.unitPrice)} />
                      <SaleRow label="Total Value" value={tk(viewSale.totalValue)} strong />
                      <SaleRow label="Payment Mode" value={viewSale.paymentMode} />
                      {viewSale.bankAccountNo && <SaleRow label="Bank A/C No" value={viewSale.bankAccountNo} />}
                      {viewSale.mobileProvider && <SaleRow label="Mobile Provider" value={viewSale.mobileProvider} />}
                      {viewSale.mobileNo && <SaleRow label="Mobile No" value={viewSale.mobileNo} />}
                      {viewSale.chequeNo && <SaleRow label="Cheque No" value={viewSale.chequeNo} />}
                      {viewSale.otherMethod && <SaleRow label="Other Method" value={viewSale.otherMethod} />}
                      <SaleRow label="Reference" value={viewSale.reference} />
                      {viewSale.accountName && (
                        <SaleRow
                          label="Deposited To"
                          value={`${viewSale.accountName}${viewSale.txnId ? ` · ${viewSale.txnId}` : ""}`}
                        />
                      )}
                      <SaleRow label="Remarks" value={viewSale.remarks} />
                      <SaleRow label="Recorded By" value={`${viewSale.preparedBy} · ${viewSale.preparedAt}`} />
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

function SaleRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground w-40 bg-muted/20">{label}</TableCell>
      <TableCell className={cn("text-xs", strong && "font-bold text-emerald-700")}>{value}</TableCell>
    </TableRow>
  );
}
