import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, ArrowLeft, Save, Send, Trash2, ClipboardList,
  Clock, Award, BadgeDollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { activeItems, vendors } from "@/lib/sample-data";

type QuoteStatus = "Draft" | "Submitted" | "Selected" | "Rejected" | "Expired";

type QuoteLine = {
  id: string;
  itemName: string;
  uom: string;
  qty: number;
  unitPrice: number;
};

type Quotation = {
  id: string;
  date: string;
  rfqRef: string;
  supplier: string;
  validity: string;
  leadTimeDays: number;
  paymentTerms: string;
  lines: QuoteLine[];
  total: number;
  status: QuoteStatus;
  notes?: string;
};

const PAYMENT_TERMS = ["Net 15", "Net 30", "Net 45", "Net 60", "Advance", "Cash on Delivery"];

const SEED_QUOTATIONS: Quotation[] = [
  {
    id: "QT-2026-0091",
    date: "2026-05-20",
    rfqRef: "RFQ-2026-0042",
    supplier: "Fresh Farms Ltd",
    validity: "2026-06-20",
    leadTimeDays: 3,
    paymentTerms: "Net 30",
    lines: [
      { id: "l1", itemName: "Chicken Breast", uom: "Kg", qty: 220, unitPrice: 372 },
      { id: "l2", itemName: "Basmati Rice",   uom: "Kg", qty: 600, unitPrice: 88 },
      { id: "l3", itemName: "Tomato",         uom: "Kg", qty: 180, unitPrice: 58 },
    ],
    total: 220 * 372 + 600 * 88 + 180 * 58,
    status: "Submitted",
  },
  {
    id: "QT-2026-0090",
    date: "2026-05-20",
    rfqRef: "RFQ-2026-0042",
    supplier: "Halal Meats Co.",
    validity: "2026-06-15",
    leadTimeDays: 2,
    paymentTerms: "Net 30",
    lines: [
      { id: "l1", itemName: "Chicken Breast", uom: "Kg", qty: 220, unitPrice: 380 },
    ],
    total: 220 * 380,
    status: "Submitted",
    notes: "Quote for protein items only.",
  },
  {
    id: "QT-2026-0089",
    date: "2026-05-19",
    rfqRef: "RFQ-2026-0042",
    supplier: "Spice World",
    validity: "2026-06-10",
    leadTimeDays: 4,
    paymentTerms: "Net 45",
    lines: [
      { id: "l1", itemName: "Basmati Rice", uom: "Kg", qty: 600, unitPrice: 92 },
      { id: "l2", itemName: "Tomato",       uom: "Kg", qty: 180, unitPrice: 55 },
    ],
    total: 600 * 92 + 180 * 55,
    status: "Submitted",
  },
  {
    id: "QT-2026-0088",
    date: "2026-05-15",
    rfqRef: "RFQ-2026-0040",
    supplier: "Fresh Farms Ltd",
    validity: "2026-05-30",
    leadTimeDays: 3,
    paymentTerms: "Net 30",
    lines: [
      { id: "l1", itemName: "Onion",  uom: "Kg", qty: 320, unitPrice: 48 },
      { id: "l2", itemName: "Potato", uom: "Kg", qty: 280, unitPrice: 38 },
    ],
    total: 320 * 48 + 280 * 38,
    status: "Selected",
  },
];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function QuotationEntryPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [rows, setRows] = usePersistedState<Quotation[]>("quotation-entry-rows", SEED_QUOTATIONS);

  const nextId = `QT-${new Date().getFullYear()}-${String(rows.length + 92).padStart(4, "0")}`;

  const addQuotation = (q: Quotation) => {
    setRows((prev) => [q, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Quotation Entry"
        subtitle="Capture supplier responses against open RFQs — line prices, validity, lead time"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> New Quotation</>}
          </Button>
        }
      />

      {view === "list"
        ? <QuotationList rows={rows} />
        : <QuotationCreate nextId={nextId} onSave={addQuotation} />}
    </>
  );
}

function QuotationList({ rows }: { rows: Quotation[] }) {
  const total = rows.length;
  const submitted = rows.filter((r) => r.status === "Submitted").length;
  const selected = rows.filter((r) => r.status === "Selected").length;
  const totalValue = rows.reduce((s, r) => s + r.total, 0);

  const cols: Column<Quotation>[] = [
    { key: "id", header: "Quotation #", render: (r) => <span className="font-mono text-xs">{r.id}</span> },
    { key: "date", header: "Date" },
    { key: "rfqRef", header: "RFQ Ref", render: (r) => <span className="font-mono text-xs">{r.rfqRef}</span> },
    { key: "supplier", header: "Supplier" },
    { key: "lines", header: "Items", render: (r) => `${r.lines.length}` },
    {
      key: "total", header: "Total (৳)",
      render: (r) => <span className="tabular-nums font-medium">{r.total.toLocaleString()}</span>,
    },
    { key: "validity", header: "Valid Till" },
    {
      key: "leadTimeDays", header: "Lead Time",
      render: (r) => <span className="text-xs">{r.leadTimeDays}d</span>,
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Quotations" value={total} icon={ClipboardList} tone="navy" />
        <KpiCard label="Submitted" value={submitted} icon={Clock} tone="warning" />
        <KpiCard label="Selected"  value={selected}  icon={Award} tone="success" />
        <KpiCard
          label="Aggregate Value"
          value={`৳ ${Math.round(totalValue).toLocaleString()}`}
          icon={BadgeDollarSign}
          tone="navy"
        />
      </div>

      <DataTable
        title="quotations"
        data={rows}
        columns={cols}
        searchKeys={["id", "rfqRef", "supplier", "status"]}
        selectable={false}
        actions={(r) => <RowActions row={r} actions={["view", "edit", "print", "delete"]} />}
      />
    </>
  );
}

function QuotationCreate({ nextId, onSave }: { nextId: string; onSave: (q: Quotation) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const oneMonthOut = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [date] = useState(today);
  const [rfqRef, setRfqRef] = useState("");
  const [supplier, setSupplier] = useState(vendors[0]?.name ?? "");
  const [validity, setValidity] = useState(oneMonthOut);
  const [leadTimeDays, setLeadTimeDays] = useState("3");
  const [paymentTerms, setPaymentTerms] = useState(PAYMENT_TERMS[1]);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<QuoteLine[]>([
    { id: `l-${Date.now()}`, itemName: "", uom: "Kg", qty: 0, unitPrice: 0 },
  ]);

  const itemOptions = useMemo(() => activeItems.slice(0, 80), []);

  const total = useMemo(
    () => lines.reduce((s, l) => s + l.qty * l.unitPrice, 0),
    [lines],
  );

  const addLine = () => {
    setLines((prev) => [...prev, { id: `l-${Date.now()}`, itemName: "", uom: "Kg", qty: 0, unitPrice: 0 }]);
  };
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));
  const updateLine = (id: string, patch: Partial<QuoteLine>) =>
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));

  const pickItem = (id: string, itemName: string) => {
    const it = itemOptions.find((i) => i.name === itemName);
    updateLine(id, { itemName, uom: it?.uom ?? "Kg", unitPrice: it?.costPrice ?? 0 });
  };

  const save = (status: QuoteStatus) => {
    if (!rfqRef.trim()) { toast.error("RFQ reference is required."); return; }
    if (!supplier) { toast.error("Select a supplier."); return; }
    const cleanLines = lines.filter((l) => l.itemName.trim() && l.qty > 0);
    if (cleanLines.length === 0) { toast.error("Add at least one priced item line."); return; }
    onSave({
      id: nextId,
      date,
      rfqRef: rfqRef.trim(),
      supplier,
      validity,
      leadTimeDays: Number(leadTimeDays) || 0,
      paymentTerms,
      lines: cleanLines,
      total,
      status,
      notes: notes.trim() || undefined,
    });
    toast.success(status === "Draft"
      ? `${nextId} saved as draft.`
      : `${nextId} submitted from ${supplier}.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">New Quotation</h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => save("Draft")}>
              <Save className="h-4 w-4 mr-1.5" /> Save Draft
            </Button>
            <Button onClick={() => save("Submitted")}>
              <Send className="h-4 w-4 mr-1.5" /> Submit
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 mb-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quotation #</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
            <Input value={date} disabled className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">RFQ Reference *</Label>
            <Input
              value={rfqRef}
              onChange={(e) => setRfqRef(e.target.value)}
              placeholder="e.g. RFQ-2026-0042"
              className="mt-1 font-mono"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Supplier *</Label>
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={selectCls}>
              {vendors.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Valid Till</Label>
            <Input type="date" value={validity} onChange={(e) => setValidity(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Lead Time (days)</Label>
            <Input
              type="number"
              min={0}
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(e.target.value)}
              className="mt-1 tabular-nums"
            />
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Payment Terms</Label>
            <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className={selectCls}>
              {PAYMENT_TERMS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quoted Items</Label>
          <Button size="sm" variant="outline" onClick={addLine}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Line
          </Button>
        </div>
        <div className="rounded-md border border-border overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-semibold">Item</th>
                <th className="p-2 text-left font-semibold w-20">UoM</th>
                <th className="p-2 text-left font-semibold w-24">Qty</th>
                <th className="p-2 text-left font-semibold w-32">Unit Price (৳)</th>
                <th className="p-2 text-right font-semibold w-32">Line Total (৳)</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-border/50">
                  <td className="p-2">
                    <select
                      value={l.itemName}
                      onChange={(e) => pickItem(l.id, e.target.value)}
                      className={selectCls}
                    >
                      <option value="">Select item</option>
                      {itemOptions.map((it) => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 text-muted-foreground text-xs">{l.uom}</td>
                  <td className="p-2">
                    <Input
                      type="number"
                      min={0}
                      value={l.qty || ""}
                      onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) })}
                      className="h-8 text-xs"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      min={0}
                      value={l.unitPrice || ""}
                      onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) })}
                      className="h-8 text-xs"
                    />
                  </td>
                  <td className="p-2 text-right tabular-nums font-medium">
                    {(l.qty * l.unitPrice).toLocaleString()}
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => removeLine(l.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border bg-muted/30 font-semibold">
                <td colSpan={4} className="p-2 text-right uppercase text-[10px] tracking-wider">Quotation Total</td>
                <td className="p-2 text-right tabular-nums">৳ {total.toLocaleString()}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1"
            placeholder="Supplier remarks, delivery conditions, discount terms…"
          />
        </div>
      </CardContent>
    </Card>
  );
}
