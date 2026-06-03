import { useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, ArrowLeft, Save, ArrowLeftRight, Trash2, Clock, CheckCircle, XCircle, FileText,
} from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { toast } from "sonner";


type TRStatus = "Draft" | "Pending Approval" | "Approved" | "Rejected" | "Completed";

type TRLine = { id: string; item: string; uom: string; qty: number };

type TransferRequest = {
  id: string;
  date: string;
  from: string;
  to: string;
  requestedBy: string;
  reason: string;
  lines: TRLine[];
  status: TRStatus;
};

const LOCATIONS = [
  "Central Warehouse",
  "Cold Storage 1",
  "Hot Kitchen",
  "Cold Kitchen",
  "Regional Warehouse CXB",
  "Head Office Dhaka",
];

const ITEMS: { code: string; name: string; uom: string }[] = [
  { code: "RM-RICE-BSMT", name: "Basmati Rice",            uom: "Kg"     },
  { code: "RM-CHK-BRST",  name: "Chicken Breast",          uom: "Kg"     },
  { code: "RM-VEG-TOM",   name: "Tomato",                  uom: "Kg"     },
  { code: "RM-OIL-CKG",   name: "Cooking Oil",             uom: "Litre"  },
  { code: "PK-BOX-MEAL",  name: "Meal Box",                uom: "Piece"  },
  { code: "BV-WTR-250",   name: "Mineral Water 250ml",     uom: "Bottle" },
];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const SEED: TransferRequest[] = [
  {
    id: "TR-7001", date: "2026-05-19 10:25", from: "Central Warehouse", to: "Hot Kitchen",
    requestedBy: "S. Ahmed", reason: "Daily production replenishment", status: "Pending Approval",
    lines: [
      { id: "L1", item: "Basmati Rice",   uom: "Kg",    qty: 120 },
      { id: "L2", item: "Chicken Breast", uom: "Kg",    qty: 80 },
    ],
  },
  {
    id: "TR-7002", date: "2026-05-19 09:10", from: "Cold Storage 1", to: "Cold Kitchen",
    requestedBy: "F. Begum", reason: "Salad station prep", status: "Approved",
    lines: [
      { id: "L1", item: "Tomato",                 uom: "Kg",     qty: 45 },
      { id: "L2", item: "Mineral Water 250ml",    uom: "Bottle", qty: 300 },
    ],
  },
  {
    id: "TR-7003", date: "2026-05-18 14:50", from: "Central Warehouse", to: "Cold Kitchen",
    requestedBy: "M. Hossain", reason: "Bakery oil top-up", status: "Completed",
    lines: [
      { id: "L1", item: "Cooking Oil", uom: "Litre", qty: 25 },
    ],
  },
  {
    id: "TR-7004", date: "2026-05-18 11:32", from: "Regional Warehouse CXB", to: "Central Warehouse",
    requestedBy: "T. Islam", reason: "Stock balancing", status: "Draft",
    lines: [
      { id: "L1", item: "Meal Box", uom: "Piece", qty: 500 },
    ],
  },
  {
    id: "TR-7005", date: "2026-05-17 08:00", from: "Central Warehouse", to: "Hot Kitchen",
    requestedBy: "S. Ahmed", reason: "Emergency stock — chicken curry batch", status: "Rejected",
    lines: [
      { id: "L1", item: "Chicken Breast", uom: "Kg", qty: 200 },
    ],
  },
];

export default function TransferRequestPage() {
  const [rows, setRows] = usePersistedState<TransferRequest[]>("transfer-request-rows", SEED);
  const [view, setView] = useState<"list" | "create">("list");

  const add = (tr: TransferRequest) => { setRows((p) => [tr, ...p]); setView("list"); };

  const pending = rows.filter((r) => r.status === "Pending Approval").length;
  const approved = rows.filter((r) => r.status === "Approved").length;
  const completed = rows.filter((r) => r.status === "Completed").length;

  return (
    <>
      <PageHeader
        title="Transfer Request"
        subtitle="Raise inter-location transfer requests between warehouses, kitchens and cold stores"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create" ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back</> : <><Plus className="h-4 w-4 mr-1" /> New Request</>}
          </Button>
        }
      />

      {view === "list" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Total Requests" value={rows.length} icon={ArrowLeftRight} tone="navy" />
            <KpiCard label="Pending Approval" value={pending} icon={Clock} tone="warning" />
            <KpiCard label="Approved" value={approved} icon={CheckCircle} tone="success" />
            <KpiCard label="Completed" value={completed} icon={FileText} tone="navy" />
          </div>
          <TRList data={rows} />
        </>
      ) : (
        <TRCreate nextId={`TR-${String(7000 + rows.length + 1)}`} onSave={add} />
      )}
    </>
  );
}

function TRList({ data }: { data: TransferRequest[] }) {
  const cols: Column<TransferRequest>[] = [
    { key: "id", header: "TR #" },
    { key: "date", header: "Date", render: (r) => <span className="tabular-nums text-xs">{r.date}</span> },
    {
      key: "from",
      header: "Route",
      render: (r) => (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-medium">{r.from}</span>
          <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">{r.to}</span>
        </div>
      ),
    },
    { key: "requestedBy", header: "Requested By" },
    {
      key: "lines",
      header: "Items",
      className: "text-right",
      render: (r) => <span className="tabular-nums">{r.lines.length}</span>,
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];
  return (
    <DataTable
      title="transfer-requests"
      data={data}
      columns={cols}
      searchKeys={["id", "from", "to", "requestedBy", "reason", "status"]}
      selectable={false}
      actions={(r) => <RowActions row={r} actions={["view", "edit", "print"]} />}
    />
  );
}

function TRCreate({ nextId, onSave }: { nextId: string; onSave: (tr: TransferRequest) => void }) {
  const today = new Date().toISOString().slice(0, 16).replace("T", " ");
  const [from, setFrom] = useState(LOCATIONS[0]);
  const [to, setTo] = useState(LOCATIONS[1]);
  const [requestedBy, setRequestedBy] = useState("");
  const [reason, setReason] = useState("");

  const [itemIdx, setItemIdx] = useState(0);
  const [qty, setQty] = useState("");
  const [lines, setLines] = useState<TRLine[]>([]);

  const addLine = () => {
    const it = ITEMS[itemIdx];
    const q = Number(qty);
    if (!q || q <= 0) { toast.error("Quantity must be greater than zero."); return; }
    if (lines.some((l) => l.item === it.name)) {
      toast.error(`${it.name} is already added.`);
      return;
    }
    setLines((prev) => [...prev, { id: `L-${Date.now()}`, item: it.name, uom: it.uom, qty: q }]);
    setQty("");
  };

  const removeLine = (id: string) => setLines((p) => p.filter((l) => l.id !== id));

  const save = (status: TRStatus) => {
    if (from === to) { toast.error("Source and destination must be different."); return; }
    if (!requestedBy.trim()) { toast.error("Requested By is required."); return; }
    if (lines.length === 0) { toast.error("Add at least one item."); return; }
    onSave({
      id: nextId, date: today, from, to, requestedBy: requestedBy.trim(),
      reason: reason.trim(), lines, status,
    });
    toast.success(`Transfer Request ${nextId} ${status === "Draft" ? "saved as draft" : "submitted for approval"}.`);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider">Request Details</h3>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => save("Draft")}>
                <Save className="h-4 w-4 mr-1.5" /> Save Draft
              </Button>
              <Button onClick={() => save("Pending Approval")}>
                <CheckCircle className="h-4 w-4 mr-1.5" /> Submit
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">TR #</Label>
              <Input value={nextId} disabled className="mt-1 font-mono" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
              <Input value={today} disabled className="mt-1 tabular-nums" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">From Location <span className="text-destructive">*</span></Label>
              <select value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls}>
                {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">To Location <span className="text-destructive">*</span></Label>
              <select value={to} onChange={(e) => setTo(e.target.value)} className={selectCls}>
                {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Requested By <span className="text-destructive">*</span></Label>
              <Input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} className="mt-1" placeholder="Full name" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Reason / Purpose</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1" placeholder="Why is this transfer needed?" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-6">Items</h3>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-7">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item</Label>
              <select value={itemIdx} onChange={(e) => setItemIdx(Number(e.target.value))} className={selectCls}>
                {ITEMS.map((i, idx) => <option key={i.code} value={idx}>{i.code} — {i.name} ({i.uom})</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quantity <span className="text-destructive">*</span></Label>
              <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 tabular-nums" />
            </div>
            <div className="md:col-span-2">
              <Button variant="outline" onClick={addLine} className="w-full">
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
          </div>

          <div className="mt-6 border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-12 text-xs uppercase tracking-wider">SL</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">UoM</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                      No items added yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  lines.map((l, i) => (
                    <TableRow key={l.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="font-medium">{l.item}</TableCell>
                      <TableCell>{l.uom}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => removeLine(l.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
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
    </div>
  );
}
