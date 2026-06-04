import { useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  Plus, ArrowLeft, Save, Send, Trash2, Undo2, AlertTriangle,
  CheckCircle2, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { activeItems, vendors } from "@/lib/sample-data";

type ReturnStatus = "Draft" | "Submitted" | "Approved" | "Completed" | "Rejected";

const RETURN_REASONS = [
  "Defective", "Short Shipment", "Wrong Item", "Near Expiry", "Quality Issue", "Other",
] as const;
type ReturnReason = typeof RETURN_REASONS[number];

type ReturnLine = {
  id: string;
  itemName: string;
  uom: string;
  qty: number;
  unitPrice: number;
  reason: ReturnReason;
  notes?: string;
};

type PurchaseReturn = {
  id: string;
  date: string;
  poRef: string;
  supplier: string;
  lines: ReturnLine[];
  totalValue: number;
  status: ReturnStatus;
  remarks?: string;
};

const SEED_RETURNS: PurchaseReturn[] = [
  {
    id: "RT-2026-0014",
    date: "2026-05-19",
    poRef: "PO-2026-0451",
    supplier: "Fresh Farms Ltd",
    lines: [
      { id: "l1", itemName: "Tomato", uom: "Kg", qty: 24, unitPrice: 58, reason: "Quality Issue", notes: "Soft, partially bruised on receipt." },
      { id: "l2", itemName: "Lettuce", uom: "Kg", qty: 6, unitPrice: 95, reason: "Defective" },
    ],
    totalValue: 24 * 58 + 6 * 95,
    status: "Submitted",
  },
  {
    id: "RT-2026-0013",
    date: "2026-05-15",
    poRef: "PO-2026-0448",
    supplier: "Halal Meats Co.",
    lines: [
      { id: "l1", itemName: "Chicken Breast", uom: "Kg", qty: 18, unitPrice: 378, reason: "Near Expiry", notes: "Less than 3 days shelf life on arrival." },
    ],
    totalValue: 18 * 378,
    status: "Approved",
  },
  {
    id: "RT-2026-0012",
    date: "2026-05-12",
    poRef: "PO-2026-0446",
    supplier: "Aqua Pure BD",
    lines: [
      { id: "l1", itemName: "Mineral Water 250ml", uom: "Bottle", qty: 120, unitPrice: 18, reason: "Short Shipment" },
    ],
    totalValue: 120 * 18,
    status: "Completed",
  },
  {
    id: "RT-2026-0011",
    date: "2026-05-10",
    poRef: "PO-2026-0444",
    supplier: "Spice World",
    lines: [
      { id: "l1", itemName: "Cumin Powder",   uom: "Kg", qty: 4, unitPrice: 260, reason: "Wrong Item", notes: "Received Coriander instead." },
      { id: "l2", itemName: "Turmeric Powder", uom: "Kg", qty: 2, unitPrice: 245, reason: "Defective" },
    ],
    totalValue: 4 * 260 + 2 * 245,
    status: "Rejected",
    remarks: "Supplier disputes — return not authorized.",
  },
];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function PurchaseReturnPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [rows, setRows] = usePersistedState<PurchaseReturn[]>("purchase-return-rows", SEED_RETURNS);

  const nextId = `RT-${new Date().getFullYear()}-${String(rows.length + 15).padStart(4, "0")}`;

  const addReturn = (r: PurchaseReturn) => {
    setRows((prev) => [r, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Purchase Return"
        subtitle="Send received stock back to suppliers — defective, short-shipped, wrong items or near-expiry"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> New Return</>}
          </Button>
        }
      />

      {view === "list" ? <ReturnList rows={rows} editors={rowEditors(setRows)} /> : <ReturnCreate nextId={nextId} onSave={addReturn} />}
    </>
  );
}

function ReturnList({ rows, editors }: {
  rows: PurchaseReturn[];
  editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void };
}) {
  const total = rows.length;
  const open = rows.filter((r) => r.status === "Submitted" || r.status === "Approved").length;
  const completed = rows.filter((r) => r.status === "Completed").length;
  const totalValue = rows.reduce((s, r) => s + r.totalValue, 0);

  const cols: Column<PurchaseReturn>[] = [
    { key: "id", header: "Return #", render: (r) => <span className="font-mono text-xs">{r.id}</span> },
    { key: "date", header: "Date" },
    { key: "poRef", header: "PO Ref", render: (r) => <span className="font-mono text-xs">{r.poRef}</span> },
    { key: "supplier", header: "Supplier" },
    { key: "lines", header: "Items", render: (r) => `${r.lines.length}` },
    {
      key: "lines" as keyof PurchaseReturn, header: "Reasons",
      render: (r) => {
        const reasons = Array.from(new Set(r.lines.map((l) => l.reason)));
        return (
          <div className="flex flex-wrap gap-1">
            {reasons.slice(0, 2).map((rn) => (
              <Badge key={rn} variant="outline" className="text-[10px]">{rn}</Badge>
            ))}
            {reasons.length > 2 && <span className="text-[10px] text-muted-foreground">+{reasons.length - 2}</span>}
          </div>
        );
      },
    },
    {
      key: "totalValue", header: "Value (৳)",
      render: (r) => <span className="tabular-nums font-medium">{r.totalValue.toLocaleString()}</span>,
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Returns" value={total} icon={Undo2} tone="navy" />
        <KpiCard label="Open" value={open} icon={AlertTriangle} tone="warning" />
        <KpiCard label="Completed" value={completed} icon={CheckCircle2} tone="success" />
        <KpiCard
          label="Returned Value"
          value={`৳ ${Math.round(totalValue).toLocaleString()}`}
          icon={FileText}
          tone="navy"
        />
      </div>

      <DataTable
        title="purchase-returns"
        data={rows}
        columns={cols}
        searchKeys={["id", "poRef", "supplier", "status"]}
        selectable={false}
        actions={(r) => (
          <RowActions
            row={r}
            actions={["view", "edit", "print", "approve", "reject"]}
            onSave={editors.onSave}
            editDetail={({ save, close }) => <ReturnFields mode="edit" initial={r} onSubmit={save} onClose={close} />}
          />
        )}
      />
    </>
  );
}

function ReturnCreate({ nextId, onSave }: { nextId: string; onSave: (r: PurchaseReturn) => void }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <ReturnFields mode="create" nextId={nextId} onSave={onSave} />
      </CardContent>
    </Card>
  );
}

/**
 * Shared Purchase Return form. Used by the Create page (mode="create") and the
 * row Edit modal (mode="edit", pre-filled from `initial`) so both share an
 * identical layout and line-table logic.
 */
function ReturnFields({
  mode, nextId, initial, onSave, onSubmit, onClose,
}: {
  mode: "create" | "edit";
  nextId?: string;
  initial?: PurchaseReturn;
  onSave?: (r: PurchaseReturn) => void;
  onSubmit?: (patch: Record<string, unknown>) => void;
  onClose?: () => void;
}) {
  const isEdit = mode === "edit";
  const today = new Date().toISOString().slice(0, 10);

  const [date] = useState(initial?.date ?? today);
  const [poRef, setPoRef] = useState(initial?.poRef ?? "");
  const [supplier, setSupplier] = useState(initial?.supplier ?? vendors[0]?.name ?? "");
  const [remarks, setRemarks] = useState(initial?.remarks ?? "");
  const [lines, setLines] = useState<ReturnLine[]>(initial?.lines ?? [
    { id: `l-${Date.now()}`, itemName: "", uom: "Kg", qty: 0, unitPrice: 0, reason: "Defective" },
  ]);

  const itemOptions = useMemo(() => activeItems.slice(0, 80), []);

  const totalValue = useMemo(
    () => lines.reduce((s, l) => s + l.qty * l.unitPrice, 0),
    [lines],
  );

  const addLine = () => {
    setLines((prev) => [...prev, {
      id: `l-${Date.now()}`, itemName: "", uom: "Kg", qty: 0, unitPrice: 0, reason: "Defective",
    }]);
  };
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));
  const updateLine = (id: string, patch: Partial<ReturnLine>) =>
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));

  const pickItem = (id: string, itemName: string) => {
    const it = itemOptions.find((i) => i.name === itemName);
    updateLine(id, { itemName, uom: it?.uom ?? "Kg", unitPrice: it?.costPrice ?? 0 });
  };

  const save = (status: ReturnStatus) => {
    if (!poRef.trim()) { toast.error("PO reference is required."); return; }
    if (!supplier) { toast.error("Select a supplier."); return; }
    const cleanLines = lines.filter((l) => l.itemName.trim() && l.qty > 0);
    if (cleanLines.length === 0) { toast.error("Add at least one return line."); return; }
    const payload = {
      date,
      poRef: poRef.trim(),
      supplier,
      lines: cleanLines,
      totalValue,
      status,
      remarks: remarks.trim() || undefined,
    };
    if (isEdit) {
      onSubmit?.({ ...payload, status: initial?.status ?? status });
      onClose?.();
      return;
    }
    onSave?.({ id: nextId!, ...payload });
    toast.success(status === "Draft"
      ? `${nextId} saved as draft.`
      : `${nextId} submitted to ${supplier}.`);
  };

  return (
    <>
      {!isEdit && (
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">New Purchase Return</h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => save("Draft")}>
              <Save className="h-4 w-4 mr-1.5" /> Save Draft
            </Button>
            <Button onClick={() => save("Submitted")}>
              <Send className="h-4 w-4 mr-1.5" /> Submit
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 mb-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Return #</Label>
            <Input value={initial?.id ?? nextId ?? ""} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
            <Input value={date} disabled className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">PO Reference *</Label>
            <Input
              value={poRef}
              onChange={(e) => setPoRef(e.target.value)}
              placeholder="e.g. PO-2026-0451"
              className="mt-1 font-mono"
            />
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Supplier *</Label>
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={selectCls}>
              {vendors.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Returned Items</Label>
          <Button size="sm" variant="outline" onClick={addLine}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Line
          </Button>
        </div>
        <div className="rounded-md border border-border overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-semibold">Item</th>
                <th className="p-2 text-left font-semibold w-16">UoM</th>
                <th className="p-2 text-left font-semibold w-20">Qty</th>
                <th className="p-2 text-left font-semibold w-28">Unit Price (৳)</th>
                <th className="p-2 text-left font-semibold w-36">Reason</th>
                <th className="p-2 text-left font-semibold">Note</th>
                <th className="p-2 text-right font-semibold w-28">Line Value (৳)</th>
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
                  <td className="p-2">
                    <select
                      value={l.reason}
                      onChange={(e) => updateLine(l.id, { reason: e.target.value as ReturnReason })}
                      className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {RETURN_REASONS.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="p-2">
                    <Input
                      value={l.notes ?? ""}
                      onChange={(e) => updateLine(l.id, { notes: e.target.value })}
                      placeholder="optional"
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
                <td colSpan={6} className="p-2 text-right uppercase text-[10px] tracking-wider">Total Return Value</td>
                <td className="p-2 text-right tabular-nums">৳ {totalValue.toLocaleString()}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Remarks</Label>
          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            className="mt-1"
            placeholder="Pickup arrangement, credit-note expectations, supplier communication notes…"
          />
        </div>

      {isEdit && (
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save("Submitted")}><Save className="h-4 w-4 mr-1.5" /> Save Changes</Button>
        </div>
      )}
    </>
  );
}
