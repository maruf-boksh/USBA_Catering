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
import { Badge } from "@/components/ui/badge";
import {
  Plus, ArrowLeft, Save, Send, Scale, Award, TrendingDown,
  CheckCircle2, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type CsStatus = "Draft" | "Pending Approval" | "Approved" | "Rejected";

type Quote = { supplier: string; unitPrice: number };
type CsLine = {
  id: string;
  itemName: string;
  uom: string;
  qty: number;
  quotes: Quote[];
  awardedSupplier?: string;
};

type ComparativeStatement = {
  id: string;
  date: string;
  rfqRef: string;
  preparedBy: string;
  lines: CsLine[];
  awardedTotal: number;
  lowestTotal: number;
  status: CsStatus;
  remarks?: string;
};

// Each line has the same set of suppliers in `quotes` for clean table rendering.
const SEED_CS: ComparativeStatement[] = [
  {
    id: "CS-2026-0021",
    date: "2026-05-21",
    rfqRef: "RFQ-2026-0042",
    preparedBy: "S. Ahmed",
    lines: [
      {
        id: "c1", itemName: "Chicken Breast", uom: "Kg", qty: 220,
        quotes: [
          { supplier: "Fresh Farms Ltd",  unitPrice: 372 },
          { supplier: "Halal Meats Co.",  unitPrice: 380 },
          { supplier: "Spice World",      unitPrice: 0 },
        ],
        awardedSupplier: "Fresh Farms Ltd",
      },
      {
        id: "c2", itemName: "Basmati Rice", uom: "Kg", qty: 600,
        quotes: [
          { supplier: "Fresh Farms Ltd",  unitPrice: 88 },
          { supplier: "Halal Meats Co.",  unitPrice: 0 },
          { supplier: "Spice World",      unitPrice: 92 },
        ],
        awardedSupplier: "Fresh Farms Ltd",
      },
      {
        id: "c3", itemName: "Tomato", uom: "Kg", qty: 180,
        quotes: [
          { supplier: "Fresh Farms Ltd",  unitPrice: 58 },
          { supplier: "Halal Meats Co.",  unitPrice: 0 },
          { supplier: "Spice World",      unitPrice: 55 },
        ],
        awardedSupplier: "Spice World",
      },
    ],
    awardedTotal: 220 * 372 + 600 * 88 + 180 * 55,
    lowestTotal: 220 * 372 + 600 * 88 + 180 * 55,
    status: "Pending Approval",
  },
  {
    id: "CS-2026-0020",
    date: "2026-05-15",
    rfqRef: "RFQ-2026-0040",
    preparedBy: "M. Karim",
    lines: [
      {
        id: "c1", itemName: "Onion", uom: "Kg", qty: 320,
        quotes: [
          { supplier: "Fresh Farms Ltd", unitPrice: 48 },
          { supplier: "Halal Meats Co.", unitPrice: 52 },
        ],
        awardedSupplier: "Fresh Farms Ltd",
      },
      {
        id: "c2", itemName: "Potato", uom: "Kg", qty: 280,
        quotes: [
          { supplier: "Fresh Farms Ltd", unitPrice: 38 },
          { supplier: "Halal Meats Co.", unitPrice: 42 },
        ],
        awardedSupplier: "Fresh Farms Ltd",
      },
    ],
    awardedTotal: 320 * 48 + 280 * 38,
    lowestTotal: 320 * 48 + 280 * 38,
    status: "Approved",
  },
];

export default function ComparativeStatementPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [rows, setRows] = usePersistedState<ComparativeStatement[]>("comparative-statement-rows", SEED_CS);

  const nextId = `CS-${new Date().getFullYear()}-${String(rows.length + 22).padStart(4, "0")}`;

  const addCs = (cs: ComparativeStatement) => {
    setRows((prev) => [cs, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Comparative Statement"
        subtitle="Compare supplier quotations side-by-side and award lines to the best offer"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> New CS</>}
          </Button>
        }
      />

      {view === "list" ? <CsList rows={rows} /> : <CsCreate nextId={nextId} onSave={addCs} />}
    </>
  );
}

function CsList({ rows }: { rows: ComparativeStatement[] }) {
  const total = rows.length;
  const pending = rows.filter((r) => r.status === "Pending Approval").length;
  const approved = rows.filter((r) => r.status === "Approved").length;
  const totalAwarded = rows.reduce((s, r) => s + r.awardedTotal, 0);

  const cols: Column<ComparativeStatement>[] = [
    { key: "id", header: "CS #", render: (r) => <span className="font-mono text-xs">{r.id}</span> },
    { key: "date", header: "Date" },
    { key: "rfqRef", header: "RFQ Ref", render: (r) => <span className="font-mono text-xs">{r.rfqRef}</span> },
    { key: "preparedBy", header: "Prepared By" },
    { key: "lines", header: "Lines", render: (r) => `${r.lines.length}` },
    {
      key: "awardedTotal", header: "Awarded (৳)",
      render: (r) => <span className="tabular-nums font-medium">{r.awardedTotal.toLocaleString()}</span>,
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Statements" value={total} icon={Scale} tone="navy" />
        <KpiCard label="Pending Approval" value={pending} icon={FileText} tone="warning" />
        <KpiCard label="Approved" value={approved} icon={CheckCircle2} tone="success" />
        <KpiCard
          label="Awarded Value"
          value={`৳ ${Math.round(totalAwarded).toLocaleString()}`}
          icon={Award}
          tone="navy"
        />
      </div>

      <DataTable
        title="comparative-statements"
        data={rows}
        columns={cols}
        searchKeys={["id", "rfqRef", "preparedBy", "status"]}
        selectable={false}
        actions={(r) => <RowActions row={r} actions={["view", "edit", "print", "approve"]} />}
      />
    </>
  );
}

function CsCreate({ nextId, onSave }: { nextId: string; onSave: (cs: ComparativeStatement) => void }) {
  const today = new Date().toISOString().slice(0, 10);

  const [date] = useState(today);
  const [rfqRef, setRfqRef] = useState("");
  const [preparedBy, setPreparedBy] = useState("");
  const [remarks, setRemarks] = useState("");

  // Suppliers being compared (columns in the matrix).
  const [suppliers, setSuppliers] = useState<string[]>(["Fresh Farms Ltd", "Halal Meats Co.", "Spice World"]);
  const [newSupplier, setNewSupplier] = useState("");

  // Lines (rows). Each line has one quote per supplier; quotes stay in sync as suppliers add/remove.
  const [lines, setLines] = useState<CsLine[]>([
    {
      id: `c-${Date.now()}`,
      itemName: "",
      uom: "Kg",
      qty: 0,
      quotes: ["Fresh Farms Ltd", "Halal Meats Co.", "Spice World"].map((s) => ({ supplier: s, unitPrice: 0 })),
    },
  ]);

  const addSupplier = () => {
    const name = newSupplier.trim();
    if (!name) return;
    if (suppliers.includes(name)) { toast.error("Supplier already added."); return; }
    setSuppliers((prev) => [...prev, name]);
    setLines((prev) => prev.map((l) => ({ ...l, quotes: [...l.quotes, { supplier: name, unitPrice: 0 }] })));
    setNewSupplier("");
  };
  const removeSupplier = (name: string) => {
    setSuppliers((prev) => prev.filter((s) => s !== name));
    setLines((prev) => prev.map((l) => ({
      ...l,
      quotes: l.quotes.filter((q) => q.supplier !== name),
      awardedSupplier: l.awardedSupplier === name ? undefined : l.awardedSupplier,
    })));
  };

  const addLine = () => {
    setLines((prev) => [...prev, {
      id: `c-${Date.now()}`,
      itemName: "",
      uom: "Kg",
      qty: 0,
      quotes: suppliers.map((s) => ({ supplier: s, unitPrice: 0 })),
    }]);
  };
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));
  const updateLine = (id: string, patch: Partial<CsLine>) =>
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));
  const updateQuote = (lineId: string, supplier: string, unitPrice: number) =>
    setLines((prev) => prev.map((l) =>
      l.id === lineId
        ? { ...l, quotes: l.quotes.map((q) => q.supplier === supplier ? { ...q, unitPrice } : q) }
        : l,
    ));
  const award = (lineId: string, supplier: string | undefined) =>
    updateLine(lineId, { awardedSupplier: supplier });

  const supplierTotals = useMemo(() => {
    const map: Record<string, number> = {};
    suppliers.forEach((s) => { map[s] = 0; });
    lines.forEach((l) => {
      l.quotes.forEach((q) => {
        if (q.unitPrice > 0) map[q.supplier] = (map[q.supplier] ?? 0) + q.unitPrice * l.qty;
      });
    });
    return map;
  }, [suppliers, lines]);

  const awardedTotal = useMemo(
    () => lines.reduce((s, l) => {
      const q = l.quotes.find((x) => x.supplier === l.awardedSupplier);
      return s + (q ? q.unitPrice * l.qty : 0);
    }, 0),
    [lines],
  );

  const lowestTotal = useMemo(
    () => lines.reduce((s, l) => {
      const positive = l.quotes.map((q) => q.unitPrice).filter((p) => p > 0);
      if (positive.length === 0) return s;
      return s + Math.min(...positive) * l.qty;
    }, 0),
    [lines],
  );

  const save = (status: CsStatus) => {
    if (!rfqRef.trim()) { toast.error("RFQ reference is required."); return; }
    if (!preparedBy.trim()) { toast.error("Prepared by is required."); return; }
    if (suppliers.length < 2) { toast.error("Compare at least two suppliers."); return; }
    const cleanLines = lines.filter((l) => l.itemName.trim() && l.qty > 0);
    if (cleanLines.length === 0) { toast.error("Add at least one item line."); return; }
    if (status === "Pending Approval" && cleanLines.some((l) => !l.awardedSupplier)) {
      toast.error("Award every line to a supplier before submitting.");
      return;
    }
    onSave({
      id: nextId,
      date,
      rfqRef: rfqRef.trim(),
      preparedBy: preparedBy.trim(),
      lines: cleanLines,
      awardedTotal,
      lowestTotal,
      status,
      remarks: remarks.trim() || undefined,
    });
    toast.success(status === "Draft"
      ? `${nextId} saved as draft.`
      : `${nextId} submitted for approval.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">New Comparative Statement</h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => save("Draft")}>
              <Save className="h-4 w-4 mr-1.5" /> Save Draft
            </Button>
            <Button onClick={() => save("Pending Approval")}>
              <Send className="h-4 w-4 mr-1.5" /> Submit for Approval
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 mb-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">CS #</Label>
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
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Prepared By *</Label>
            <Input
              value={preparedBy}
              onChange={(e) => setPreparedBy(e.target.value)}
              placeholder="Procurement officer name"
              className="mt-1"
            />
          </div>
        </div>

        <div className="mb-4">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
            Suppliers Compared
          </Label>
          <div className="flex flex-wrap gap-2 items-center">
            {suppliers.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1 text-xs"
              >
                {s}
                <button
                  type="button"
                  onClick={() => removeSupplier(s)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${s}`}
                >
                  ×
                </button>
              </span>
            ))}
            <div className="flex items-center gap-1">
              <Input
                value={newSupplier}
                onChange={(e) => setNewSupplier(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSupplier(); } }}
                placeholder="Add supplier"
                className="h-8 w-44 text-xs"
              />
              <Button size="sm" variant="outline" onClick={addSupplier}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Comparison Matrix</Label>
          <Button size="sm" variant="outline" onClick={addLine}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
          </Button>
        </div>
        <div className="rounded-md border border-border overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-semibold">Item</th>
                <th className="p-2 text-left font-semibold w-16">UoM</th>
                <th className="p-2 text-left font-semibold w-20">Qty</th>
                {suppliers.map((s) => (
                  <th key={s} className="p-2 text-left font-semibold min-w-[140px]">{s}</th>
                ))}
                <th className="p-2 text-left font-semibold w-44">Award To</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const positivePrices = l.quotes.map((q) => q.unitPrice).filter((p) => p > 0);
                const lowestPrice = positivePrices.length > 0 ? Math.min(...positivePrices) : 0;
                return (
                  <tr key={l.id} className="border-t border-border/50">
                    <td className="p-2">
                      <Input
                        value={l.itemName}
                        onChange={(e) => updateLine(l.id, { itemName: e.target.value })}
                        placeholder="Item name"
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        value={l.uom}
                        onChange={(e) => updateLine(l.id, { uom: e.target.value })}
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        min={0}
                        value={l.qty || ""}
                        onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) })}
                        className="h-8 text-xs"
                      />
                    </td>
                    {suppliers.map((s) => {
                      const q = l.quotes.find((x) => x.supplier === s);
                      const isLowest = q && q.unitPrice > 0 && q.unitPrice === lowestPrice;
                      return (
                        <td key={s} className="p-2">
                          <Input
                            type="number"
                            min={0}
                            value={q?.unitPrice || ""}
                            onChange={(e) => updateQuote(l.id, s, Number(e.target.value))}
                            placeholder="—"
                            className={cn(
                              "h-8 text-xs tabular-nums",
                              isLowest && "border-success/50 bg-success/5 font-semibold text-success",
                            )}
                          />
                        </td>
                      );
                    })}
                    <td className="p-2">
                      <select
                        value={l.awardedSupplier ?? ""}
                        onChange={(e) => award(l.id, e.target.value || undefined)}
                        className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                      >
                        <option value="">— not awarded —</option>
                        {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="p-2">
                      <button
                        type="button"
                        onClick={() => removeLine(l.id)}
                        className="text-muted-foreground hover:text-destructive text-xs"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-border bg-muted/40 font-semibold text-xs">
                <td colSpan={3} className="p-2 text-right uppercase text-[10px] tracking-wider">Supplier Totals</td>
                {suppliers.map((s) => (
                  <td key={s} className="p-2 tabular-nums">
                    ৳ {Math.round(supplierTotals[s] ?? 0).toLocaleString()}
                  </td>
                ))}
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Awarded Total</div>
            <div className="mt-1 text-lg font-bold text-primary tabular-nums">
              ৳ {Math.round(awardedTotal).toLocaleString()}
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Lowest-Quote Total</div>
            <div className="mt-1 text-lg font-bold text-foreground tabular-nums">
              ৳ {Math.round(lowestTotal).toLocaleString()}
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <TrendingDown className="h-3 w-3" /> Variance vs Lowest
            </div>
            <div className={cn(
              "mt-1 text-lg font-bold tabular-nums",
              awardedTotal > lowestTotal ? "text-warning" : "text-success",
            )}>
              {awardedTotal === 0 ? "—" : `৳ ${Math.round(awardedTotal - lowestTotal).toLocaleString()}`}
            </div>
          </div>
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Remarks</Label>
          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            className="mt-1"
            placeholder="Justification for awarding non-lowest quotes, delivery considerations, etc."
          />
        </div>

        <div className="mt-3">
          <Badge variant="outline" className="text-[10px]">
            Lowest price per line is highlighted in green for quick scanning.
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
