import { useEffect, useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { rowEditors } from "@/lib/row-editors";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, ArrowLeft, Save, Send, Trash2, ClipboardList,
  Clock, BadgeCheck, XCircle, BadgeDollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { activeItems, vendors } from "@/lib/sample-data";
import { getApprovedRfqs } from "@/lib/rfqs";
import {
  SEED_QUOTATIONS, normalizeQuoteStatus,
  type Quotation, type QuoteLine, type QuoteStatus,
} from "@/lib/quotations";

const PAYMENT_TERMS = ["Net 15", "Net 30", "Net 45", "Net 60", "Advance", "Cash on Delivery"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function QuotationEntryPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [rows, setRows] = usePersistedState<Quotation[]>("quotation-entry-rows", SEED_QUOTATIONS);

  // One-time migration: rewrite any legacy statuses (Draft/Submitted/Selected/
  // Expired) onto the current Pending/Approved/Rejected model so older persisted
  // quotations show correct badges + KPI counts.
  useEffect(() => {
    setRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const ns = normalizeQuoteStatus(r.status);
        if (ns !== r.status) { changed = true; return { ...r, status: ns }; }
        return r;
      });
      return changed ? next : prev;
    });
  }, [setRows]);

  const nextId = `QT-${new Date().getFullYear()}-${String(rows.length + 92).padStart(4, "0")}`;

  const addQuotation = (q: Quotation) => {
    setRows((prev) => [q, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Quotation Entry"
        subtitle="Capture supplier responses against open RFQs — line prices and validity"
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
        ? <QuotationList rows={rows} editors={rowEditors(setRows)} />
        : <QuotationCreate nextId={nextId} onSave={addQuotation} />}
    </>
  );
}

function QuotationList({ rows, editors }: {
  rows: Quotation[];
  editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void };
}) {
  const total = rows.length;
  const pending = rows.filter((r) => r.status === "Pending").length;
  const approved = rows.filter((r) => r.status === "Approved").length;
  const rejected = rows.filter((r) => r.status === "Rejected").length;
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
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Total Quotations" value={total} icon={ClipboardList} tone="navy" />
        <KpiCard label="Pending"  value={pending}  icon={Clock} tone="warning" />
        <KpiCard label="Approved" value={approved} icon={BadgeCheck} tone="success" />
        <KpiCard label="Rejected" value={rejected} icon={XCircle} tone="red" />
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
        actions={(r) => (
          <RowActions
            row={r}
            actions={["view", "edit", "print", "delete"]}
            onSave={editors.onSave}
            onDelete={editors.onDelete}
            editDetail={({ save, close }) => <QuotationFields mode="edit" initial={r} onSubmit={save} onClose={close} />}
          />
        )}
      />
    </>
  );
}

function QuotationCreate({ nextId, onSave }: { nextId: string; onSave: (q: Quotation) => void }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <QuotationFields mode="create" nextId={nextId} onSave={onSave} />
      </CardContent>
    </Card>
  );
}

/**
 * Shared Quotation form fields. Used by the Create page (mode="create") and the
 * row Edit modal (mode="edit", pre-filled from `initial`) so both share an
 * identical layout including the dynamic priced-line table + computed total.
 */
function QuotationFields({
  mode, nextId, initial, onSave, onSubmit, onClose,
}: {
  mode: "create" | "edit";
  nextId?: string;
  initial?: Quotation;
  onSave?: (q: Quotation) => void;
  onSubmit?: (patch: Record<string, unknown>) => void;
  onClose?: () => void;
}) {
  const isEdit = mode === "edit";
  const today = new Date().toISOString().slice(0, 10);
  const oneMonthOut = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [date] = useState(initial?.date ?? today);
  const [rfqRef, setRfqRef] = useState(initial?.rfqRef ?? "");
  const [supplier, setSupplier] = useState(initial?.supplier ?? vendors[0]?.name ?? "");
  const [validity, setValidity] = useState(initial?.validity ?? oneMonthOut);
  const [paymentTerms, setPaymentTerms] = useState(initial?.paymentTerms ?? PAYMENT_TERMS[1]);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<QuoteLine[]>(initial?.lines ?? [
    { id: `l-${Date.now()}`, itemName: "", uom: "Kg", qty: 0, unitPrice: 0 },
  ]);

  const itemOptions = useMemo(() => activeItems.slice(0, 80), []);
  // RFQ Reference choices come from the RFQ table — only approved RFQs can be quoted.
  const rfqOptions = useMemo(() => getApprovedRfqs(), []);

  // Selecting an RFQ loads its requested items as priced lines (price starts
  // from the item's cost price, for the supplier to confirm/adjust).
  const handleRfqChange = (id: string) => {
    setRfqRef(id);
    const rfq = rfqOptions.find((r) => r.id === id);
    if (rfq) {
      setLines(
        rfq.lines.map((l, i) => {
          const it = itemOptions.find((x) => x.name === l.itemName);
          return {
            id: `rfq-${i}-${l.id}`,
            itemName: l.itemName,
            uom: l.uom,
            qty: l.qty,
            unitPrice: it?.costPrice ?? 0,
          };
        }),
      );
    }
  };

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
    const payload = {
      date,
      rfqRef: rfqRef.trim(),
      supplier,
      validity,
      paymentTerms,
      lines: cleanLines,
      total,
      status,
      notes: notes.trim() || undefined,
    };
    if (isEdit) {
      onSubmit?.(payload);
      onClose?.();
    } else {
      onSave?.({ id: nextId!, ...payload });
      toast.success(`${nextId} submitted for approval.`);
    }
  };

  return (
    <>
      {!isEdit && (
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">New Quotation</h3>
          <Button onClick={() => save("Pending")}>
            <Send className="h-4 w-4 mr-1.5" /> Submit for Approval
          </Button>
        </div>
      )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 mb-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quotation #</Label>
            <Input value={initial?.id ?? nextId ?? ""} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
            <Input value={date} disabled className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">RFQ Reference *</Label>
            <select
              value={rfqRef}
              onChange={(e) => handleRfqChange(e.target.value)}
              className={`${selectCls} font-mono`}
            >
              <option value="">Select RFQ</option>
              {rfqOptions.map((rfq) => (
                <option key={rfq.id} value={rfq.id}>
                  {rfq.id} · {rfq.lines.length} item{rfq.lines.length === 1 ? "" : "s"} · {rfq.status}
                </option>
              ))}
            </select>
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
                      {/* Loaded-from-RFQ items may not be in the master list — keep them selectable. */}
                      {l.itemName && !itemOptions.some((it) => it.name === l.itemName) && (
                        <option value={l.itemName}>{l.itemName}</option>
                      )}
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

      {isEdit && (
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save(initial?.status ?? "Pending")}>
            <Save className="h-4 w-4 mr-1.5" /> Save Changes
          </Button>
        </div>
      )}
    </>
  );
}
