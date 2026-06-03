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
  Plus, ArrowLeft, Save, Send, Trash2, MailQuestion, FileText,
  CheckCircle2, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { activeItems, vendors } from "@/lib/sample-data";
import { cn } from "@/lib/utils";

type RfqStatus = "Draft" | "Sent" | "Responses In" | "Closed" | "Cancelled";

type RfqLine = {
  id: string;
  itemName: string;
  uom: string;
  qty: number;
  spec?: string;
};

type Rfq = {
  id: string;
  date: string;
  prRef?: string;
  deadline: string;
  status: RfqStatus;
  invitedSuppliers: string[];
  lines: RfqLine[];
  notes?: string;
};

const SEED_RFQS: Rfq[] = [
  {
    id: "RFQ-2026-0042",
    date: "2026-05-18",
    prRef: "PR-2026-0118",
    deadline: "2026-05-25",
    status: "Responses In",
    invitedSuppliers: ["Fresh Farms Ltd", "Halal Meats Co.", "Spice World"],
    lines: [
      { id: "l1", itemName: "Chicken Breast", uom: "Kg",  qty: 220 },
      { id: "l2", itemName: "Basmati Rice",   uom: "Kg",  qty: 600 },
      { id: "l3", itemName: "Tomato",         uom: "Kg",  qty: 180 },
    ],
    notes: "Required for next week's wide-body rotation.",
  },
  {
    id: "RFQ-2026-0041",
    date: "2026-05-16",
    prRef: "PR-2026-0115",
    deadline: "2026-05-23",
    status: "Sent",
    invitedSuppliers: ["Aqua Pure BD", "Royal Bakery Supplies"],
    lines: [
      { id: "l1", itemName: "Mineral Water 250ml", uom: "Bottle", qty: 4800 },
      { id: "l2", itemName: "Croissant",           uom: "Piece",  qty: 1200 },
    ],
  },
  {
    id: "RFQ-2026-0040",
    date: "2026-05-12",
    prRef: "PR-2026-0112",
    deadline: "2026-05-19",
    status: "Closed",
    invitedSuppliers: ["Fresh Farms Ltd", "Halal Meats Co."],
    lines: [
      { id: "l1", itemName: "Onion",  uom: "Kg", qty: 320 },
      { id: "l2", itemName: "Potato", uom: "Kg", qty: 280 },
    ],
    notes: "Awarded to Fresh Farms Ltd on 2026-05-19.",
  },
  {
    id: "RFQ-2026-0039",
    date: "2026-05-10",
    deadline: "2026-05-17",
    status: "Draft",
    invitedSuppliers: [],
    lines: [
      { id: "l1", itemName: "Olive Oil", uom: "Litre", qty: 60 },
    ],
  },
];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function RfqPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [rows, setRows] = usePersistedState<Rfq[]>("request-for-quotation-rows", SEED_RFQS);

  const nextId = `RFQ-${new Date().getFullYear()}-${String(rows.length + 43).padStart(4, "0")}`;

  const addRfq = (r: Rfq) => {
    setRows((prev) => [r, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Request for Quotation"
        subtitle="Issue RFQs to suppliers, set response deadlines and track replies"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> New RFQ</>}
          </Button>
        }
      />

      {view === "list" ? <RfqList rows={rows} /> : <RfqCreate nextId={nextId} onSave={addRfq} />}
    </>
  );
}

function RfqList({ rows }: { rows: Rfq[] }) {
  const total = rows.length;
  const open = rows.filter((r) => r.status === "Sent" || r.status === "Responses In").length;
  const drafts = rows.filter((r) => r.status === "Draft").length;
  const closed = rows.filter((r) => r.status === "Closed").length;

  const cols: Column<Rfq>[] = [
    { key: "id", header: "RFQ #", render: (r) => <span className="font-mono text-xs">{r.id}</span> },
    { key: "date", header: "Date" },
    { key: "prRef", header: "PR Ref", render: (r) => r.prRef ?? <span className="text-muted-foreground">—</span> },
    { key: "lines", header: "Items", render: (r) => `${r.lines.length} item${r.lines.length === 1 ? "" : "s"}` },
    {
      key: "invitedSuppliers", header: "Suppliers",
      render: (r) =>
        r.invitedSuppliers.length === 0
          ? <span className="text-muted-foreground">—</span>
          : <span>{r.invitedSuppliers.length}</span>,
    },
    { key: "deadline", header: "Deadline" },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total RFQs"     value={total}  icon={MailQuestion} tone="navy" />
        <KpiCard label="Open"           value={open}   icon={Clock}        tone="warning" />
        <KpiCard label="Drafts"         value={drafts} icon={FileText}     tone="navy" />
        <KpiCard label="Closed"         value={closed} icon={CheckCircle2} tone="success" />
      </div>

      <DataTable
        title="rfqs"
        data={rows}
        columns={cols}
        searchKeys={["id", "prRef", "status"]}
        selectable={false}
        actions={(r) => <RowActions row={r} actions={["view", "edit", "print", "delete"]} />}
      />
    </>
  );
}

function RfqCreate({ nextId, onSave }: { nextId: string; onSave: (r: Rfq) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const oneWeekOut = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [date] = useState(today);
  const [prRef, setPrRef] = useState("");
  const [deadline, setDeadline] = useState(oneWeekOut);
  const [invited, setInvited] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<RfqLine[]>([
    { id: `l-${Date.now()}`, itemName: "", uom: "Kg", qty: 0 },
  ]);

  const itemOptions = useMemo(() => activeItems.slice(0, 80), []);

  const toggleSupplier = (name: string) => {
    setInvited((prev) => prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]);
  };

  const addLine = () => {
    setLines((prev) => [...prev, { id: `l-${Date.now()}`, itemName: "", uom: "Kg", qty: 0 }]);
  };
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));
  const updateLine = (id: string, patch: Partial<RfqLine>) =>
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));

  const pickItem = (id: string, itemName: string) => {
    const it = itemOptions.find((i) => i.name === itemName);
    updateLine(id, { itemName, uom: it?.uom ?? "Kg" });
  };

  const save = (status: RfqStatus) => {
    if (lines.length === 0 || lines.every((l) => !l.itemName.trim())) {
      toast.error("Add at least one item line.");
      return;
    }
    if (status === "Sent" && invited.length === 0) {
      toast.error("Select at least one supplier before sending.");
      return;
    }
    if (status === "Sent" && !deadline) {
      toast.error("Set a response deadline before sending.");
      return;
    }
    const cleanLines = lines.filter((l) => l.itemName.trim());
    onSave({
      id: nextId,
      date,
      prRef: prRef.trim() || undefined,
      deadline,
      status,
      invitedSuppliers: invited,
      lines: cleanLines,
      notes: notes.trim() || undefined,
    });
    toast.success(status === "Draft"
      ? `${nextId} saved as draft.`
      : `${nextId} sent to ${invited.length} supplier${invited.length === 1 ? "" : "s"}.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">New Request for Quotation</h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => save("Draft")}>
              <Save className="h-4 w-4 mr-1.5" /> Save Draft
            </Button>
            <Button onClick={() => save("Sent")}>
              <Send className="h-4 w-4 mr-1.5" /> Send to Suppliers
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 mb-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">RFQ #</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
            <Input value={date} disabled className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">PR Reference</Label>
            <Input
              value={prRef}
              onChange={(e) => setPrRef(e.target.value)}
              placeholder="e.g. PR-2026-0118"
              className="mt-1 font-mono"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Response Deadline *</Label>
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div className="mb-6">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
            Invite Suppliers {invited.length > 0 && <span className="text-foreground">({invited.length} selected)</span>}
          </Label>
          <div className="flex flex-wrap gap-2">
            {vendors.map((v) => {
              const active = invited.includes(v.name);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => toggleSupplier(v.name)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="font-medium">{v.name}</span>
                  <Badge variant="outline" className="text-[10px]">{v.category}</Badge>
                  {active && <CheckCircle2 className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Items Requested</Label>
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
                <th className="p-2 text-left font-semibold">Specification / Note</th>
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
                      value={l.spec ?? ""}
                      onChange={(e) => updateLine(l.id, { spec: e.target.value })}
                      placeholder="optional"
                      className="h-8 text-xs"
                    />
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
            placeholder="Special delivery instructions, packaging requirements, etc."
          />
        </div>
      </CardContent>
    </Card>
  );
}
