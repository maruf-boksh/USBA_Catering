import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  FileText, ClipboardList, CheckCircle, Plus, Save, Send, Trash2, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { activeItems } from "@/lib/sample-data";
import { LocationPicker, LocationFilter, LocationCell } from "@/components/common/LocationPicker";
import { useWorkflow, type WfRequisition, type WfDemandItem } from "@/lib/workflow-store";
import { useArrivalFlash } from "@/lib/arrival-flash";

type PRLineItem = {
  id: string;
  itemName: string;
  description: string;
  qty: number;
  uom: string;
  rate: number;
};

type Priority = "Normal" | "Urgent";

type PurchaseRequisition = {
  id: string;
  date: string;
  officeId: string;
  warehouseId: string;
  requestedBy: string;
  requiredBy: string;
  priority: Priority;
  justification: string;
  lines: PRLineItem[];
  status: string;
  totalAmount: number;
};

const PRIORITIES: Priority[] = ["Normal", "Urgent"];
const UOMS = ["Kg", "Litre", "Pcs", "Box", "Pack", "Unit", "Bottle"];

const REQUESTERS = [
  "S. Ahmed",
  "M. Hossain",
  "F. Begum",
  "A. Khan",
  "N. Hasan",
  "M. Karim",
  "R. Islam",
  "T. Rahman",
];


const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// Item picker — pulled from the central Item Profile
const ITEM_MASTER = activeItems.map((i) => ({
  name: i.name,
  uom: i.uom,
  description: `${i.code} · ${i.category}${i.subCategory ? ` · ${i.subCategory}` : ""}`,
}));

const seedRequisitions: PurchaseRequisition[] = [
  {
    id: "PR-2026-005", date: "2026-05-18", officeId: "OFF-001", warehouseId: "WH-003",
    requestedBy: "S. Ahmed",
    requiredBy: "2026-05-22", priority: "Normal", justification: "Weekly stock replenishment for hot kitchen line.",
    lines: [
      { id: "L1", itemName: "Basmati Rice",   description: "Premium long grain", qty: 200, uom: "Kg",    rate: 120 },
      { id: "L2", itemName: "Chicken",        description: "Whole, cleaned",     qty: 150, uom: "Kg",    rate: 280 },
      { id: "L3", itemName: "Cooking Oil",    description: "Soyabean refined",   qty: 60,  uom: "Litre", rate: 175 },
    ],
    status: "Approved", totalAmount: 76500,
  },
  {
    id: "PR-2026-004", date: "2026-05-17", officeId: "OFF-001", warehouseId: "WH-001",
    requestedBy: "M. Hossain",
    requiredBy: "2026-05-21", priority: "Normal", justification: "Production run for the next 4 days.",
    lines: [
      { id: "L1", itemName: "All-Purpose Flour", description: "10kg bag",    qty: 25, uom: "Box",   rate: 1200 },
      { id: "L2", itemName: "Butter",            description: "Unsalted",    qty: 30, uom: "Kg",    rate: 950  },
      { id: "L3", itemName: "Yeast",             description: "Active dry",  qty: 8,  uom: "Pack",  rate: 320  },
    ],
    status: "Pending Approval", totalAmount: 61060,
  },
  {
    id: "PR-2026-003", date: "2026-05-15", officeId: "OFF-001", warehouseId: "WH-004",
    requestedBy: "F. Begum",
    requiredBy: "2026-05-19", priority: "Urgent", justification: "Salmon stock fell below reorder level after weekend rush.",
    lines: [
      { id: "L1", itemName: "Salmon Fillet", description: "Frozen, premium grade", qty: 40, uom: "Kg",  rate: 1400 },
      { id: "L2", itemName: "Lemon",         description: "Fresh",                 qty: 20, uom: "Kg",  rate: 60   },
      { id: "L3", itemName: "Olive Oil",     description: "Extra virgin",          qty: 10, uom: "Litre", rate: 850 },
    ],
    status: "Approved", totalAmount: 65700,
  },
  {
    id: "PR-2026-002", date: "2026-05-12", officeId: "OFF-001", warehouseId: "WH-002",
    requestedBy: "A. Khan",
    requiredBy: "2026-05-18", priority: "Normal", justification: "Replenish beverage stock for international flights.",
    lines: [
      { id: "L1", itemName: "Mineral Water",      description: "500ml",     qty: 50,  uom: "Box",    rate: 480 },
      { id: "L2", itemName: "Orange Juice",       description: "1L tetra",  qty: 30,  uom: "Box",    rate: 720 },
      { id: "L3", itemName: "Disposable Cup",     description: "8oz paper", qty: 100, uom: "Pack",   rate: 95  },
    ],
    status: "Closed", totalAmount: 55100,
  },
  {
    id: "PR-2026-001", date: "2026-05-10", officeId: "OFF-001", warehouseId: "WH-001",
    requestedBy: "N. Hasan",
    requiredBy: "2026-05-25", priority: "Normal", justification: "Quarterly maintenance consumables.",
    lines: [
      { id: "L1", itemName: "Industrial Detergent", description: "5L jar",      qty: 12, uom: "Bottle", rate: 650 },
      { id: "L2", itemName: "Gas Cylinder",         description: "Commercial",  qty: 4,  uom: "Unit",   rate: 2400 },
    ],
    status: "Draft", totalAmount: 17400,
  },
];

// ── Bridge: convert workflow-store WfRequisition (e.g. MRP-generated) into the
// local PurchaseRequisition shape so they show up in this module's list. The
// item rate is looked up from the central inventory if available; otherwise 0.
function wfReqToPurchaseRequisition(wf: WfRequisition): PurchaseRequisition {
  const lines: PRLineItem[] = (wf.demandItems ?? []).map((d, i) => ({
    id: `${wf.id}-L${i + 1}`,
    itemName: d.name,
    description: d.type ? `${d.type}` : "",
    qty: d.qty,
    uom: d.uom,
    rate: 0,    // unit rate isn't carried on demand items
  }));
  const totalAmount = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  // Map workflow statuses → local statuses for the list display
  const statusMap: Record<string, string> = {
    "Pending Accounts": "Pending Approval",
    "Approved": "Approved",
    "Rejected": "Rejected",
  };
  const status = statusMap[wf.status] ?? "Pending Approval";
  return {
    id: wf.id,
    date: wf.date.slice(0, 10),
    officeId: wf.officeId ?? "OFF-001",
    warehouseId: wf.warehouseId ?? "WH-001",
    requestedBy: wf.requestedBy,
    requiredBy: "—",
    priority: "Normal",
    justification: wf.note,
    lines,
    status,
    totalAmount,
  };
}

type PRPrefill = {
  itemName: string;
  uom: string;
  qty: number;
  rate: number;
  priority?: Priority;
  justification?: string;
  source?: string;
};

export default function PurchaseRequisitionPage() {
  useArrivalFlash();
  const { wfRequisitions, updateRequisition } = useWorkflow();
  const [requisitions, setRequisitions] = useState<PurchaseRequisition[]>(seedRequisitions);
  const [view, setView] = useState<"list" | "create">("list");
  const [selected, setSelected] = useState<PurchaseRequisition | null>(null);
  const [editing, setEditing] = useState<PurchaseRequisition | null>(null);
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [prefill, setPrefill] = useState<PRPrefill | null>(null);

  // Status values where a requisition is still mutable. Once approved /
  // rejected / closed the form is read-only.
  const isEditable = (r: PurchaseRequisition) =>
    r.status === "Pending Approval" || r.status === "Draft";

  /**
   * Persist an edited requisition. If it lives in our local seed array we
   * update there; if it was bridged in from the workflow store (MRP, demand
   * auto-flow) we push the edit back via `updateRequisition` so other modules
   * see the same line-item changes.
   */
  const saveEditedRequisition = (next: PurchaseRequisition) => {
    const isLocal = requisitions.some((r) => r.id === next.id);
    if (isLocal) {
      setRequisitions((prev) => prev.map((r) => (r.id === next.id ? next : r)));
    } else {
      // Bridged from workflow-store. Translate the local lines back into the
      // WfDemandItem shape and patch the workflow record.
      const demandItems: WfDemandItem[] = next.lines.map((l) => ({
        id: l.id,
        name: l.itemName,
        qty: l.qty,
        uom: l.uom,
        type: l.description || "Material",
      }));
      updateRequisition(next.id, {
        items: next.lines.length,
        demandItems,
        note: next.justification,
      });
    }
    toast.success(`${next.id} updated.`);
    setEditing(null);
  };

  // Auto-open Create view when navigated to from Stock Overview (or any other
  // page that stashes a "pr-prefill-from-inventory" payload in sessionStorage).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("pr-prefill-from-inventory");
      if (!raw) return;
      sessionStorage.removeItem("pr-prefill-from-inventory");
      const parsed = JSON.parse(raw) as PRPrefill;
      setPrefill(parsed);
      setView("create");
      toast.success(
        parsed.source
          ? `New PR pre-filled from ${parsed.source} — ${parsed.itemName}.`
          : `New PR pre-filled with ${parsed.itemName}.`,
      );
    } catch {
      /* malformed payload — ignore */
    }
  }, []);

  const addRequisition = (pr: PurchaseRequisition) => {
    setRequisitions((prev) => [pr, ...prev]);
    setView("list");
    setPrefill(null);
  };

  // Workflow-store requisitions (MRP, kitchen demand, etc.) bridged in for display.
  // De-dupe in case any local PR happens to share an id with a workflow record.
  const bridged: PurchaseRequisition[] = wfRequisitions.map(wfReqToPurchaseRequisition);
  const localIds = new Set(requisitions.map((r) => r.id));
  const combined = [
    ...bridged.filter((b) => !localIds.has(b.id)),
    ...requisitions,
  ];

  const filtered = combined.filter((r) => {
    if (filterOffice && r.officeId !== filterOffice) return false;
    if (filterWarehouse && r.warehouseId !== filterWarehouse) return false;
    return true;
  });

  const totalCount = filtered.length;
  const draftCount = filtered.filter((r) => r.status === "Draft").length;
  const pendingCount = filtered.filter((r) => r.status === "Pending Approval").length;
  const approvedCount = filtered.filter((r) => r.status === "Approved").length;

  const cols: Column<PurchaseRequisition>[] = [
    { key: "id",          header: "PR No" },
    { key: "date",        header: "Date" },
    {
      key: "officeId", header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    { key: "requestedBy", header: "Requested By" },
    {
      key: "lines", header: "Items", className: "text-right",
      render: (r) => <span>{r.lines.length}</span>,
    },
    {
      key: "totalAmount", header: "Est. Amount", className: "text-right",
      render: (r) => <span className="tabular-nums">৳ {r.totalAmount.toLocaleString()}</span>,
    },
    {
      key: "priority", header: "Priority",
      render: (r) => (
        <Badge
          variant={r.priority === "Urgent" ? "destructive" : "outline"}
          className="text-[10px]"
        >
          {r.priority}
        </Badge>
      ),
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Purchase Requisition"
        subtitle="Create and track requisitions before issuing purchase orders"
        actions={
          <Button onClick={() => setView(view === "create" ? "list" : "create")}>
            <Plus className="h-4 w-4 mr-1" />
            {view === "create" ? "View List" : "Create Requisition"}
          </Button>
        }
      />

      {view === "list" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Total PRs"          value={totalCount}    icon={FileText}      tone="navy"    />
            <KpiCard label="Draft"              value={draftCount}    icon={ClipboardList} tone="warning" />
            <KpiCard label="Pending Approval"   value={pendingCount}  icon={ClipboardList} tone="warning" />
            <KpiCard label="Approved"           value={approvedCount} icon={CheckCircle}   tone="success" />
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <LocationFilter
              officeId={filterOffice}
              warehouseId={filterWarehouse}
              onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
            />
            <span className="text-xs text-muted-foreground">
              Showing <strong className="text-foreground tabular-nums">{filtered.length}</strong> of {combined.length}
            </span>
          </div>

          <div data-arrival-id="pr-list">
            <DataTable
              title="purchase-requisitions"
              data={filtered}
              columns={cols}
              searchKeys={["id", "requestedBy", "status"]}
              selectable={false}
              actions={(r) => (
                <div className="flex items-center gap-1.5">
                  {isEditable(r) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 text-xs border-primary/40 text-primary hover:bg-primary/5"
                      onClick={() => setEditing(r)}
                      title={`Edit ${r.id}`}
                    >
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setSelected(r)}
                  >
                    View
                  </Button>
                </div>
              )}
            />
          </div>
        </>
      ) : (
        <PurchaseRequisitionCreate
          nextNumber={Math.max(...requisitions.map((r) => Number(r.id.split("-").pop()))) + 1}
          onSave={addRequisition}
          prefill={prefill}
        />
      )}

      <RequisitionDetailsDialog
        requisition={selected}
        onClose={() => setSelected(null)}
      />

      <RequisitionEditDialog
        requisition={editing}
        onClose={() => setEditing(null)}
        onSave={saveEditedRequisition}
      />
    </>
  );
}

function PurchaseRequisitionCreate({
  nextNumber, onSave, prefill,
}: {
  nextNumber: number;
  onSave: (pr: PurchaseRequisition) => void;
  prefill?: PRPrefill | null;
}) {
  const today = new Date().toISOString().slice(0, 10);

  // Header state
  const [prDate, setPrDate] = useState(today);
  const [officeId, setOfficeId] = useState("OFF-001");
  const [warehouseId, setWarehouseId] = useState("WH-001");
  const [requestedBy, setRequestedBy] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [priority, setPriority] = useState<Priority>(prefill?.priority ?? "Normal");
  const [justification, setJustification] = useState(prefill?.justification ?? "");

  // Line state
  const [itemName, setItemName] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");
  const [uom, setUom] = useState(UOMS[0]);
  const [rate, setRate] = useState("");
  const [lines, setLines] = useState<PRLineItem[]>(
    prefill
      ? [{
          id: `LN-PREFILL-${Date.now()}`,
          itemName: prefill.itemName,
          description: "",
          qty: prefill.qty,
          uom: prefill.uom,
          rate: prefill.rate,
        }]
      : [],
  );

  const totalAmount = lines.reduce((s, l) => s + l.qty * l.rate, 0);

  const addLine = () => {
    if (!itemName.trim()) { toast.error("Item name is required."); return; }
    const qtyN = Number(qty);
    if (!qtyN || qtyN <= 0) { toast.error("Quantity must be greater than zero."); return; }
    const rateN = Number(rate);
    if (rateN < 0) { toast.error("Rate cannot be negative."); return; }
    setLines((prev) => [
      ...prev,
      {
        id: `LN-${Date.now()}`,
        itemName: itemName.trim(),
        description: description.trim(),
        qty: qtyN,
        uom,
        rate: rateN,
      },
    ]);
    setItemName("");
    setDescription("");
    setQty("");
    setRate("");
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleSave = (submit: boolean) => {
    if (!officeId) { toast.error("Office is required."); return; }
    if (!warehouseId) { toast.error("Warehouse is required."); return; }
    if (!requestedBy.trim()) { toast.error("Requested By is required."); return; }
    if (lines.length === 0) { toast.error("Add at least one line item."); return; }

    const newPR: PurchaseRequisition = {
      id: `PR-2026-${String(nextNumber).padStart(3, "0")}`,
      date: prDate,
      officeId, warehouseId,
      requestedBy: requestedBy.trim(),
      requiredBy: requiredBy || "—",
      priority,
      justification: justification.trim(),
      lines,
      status: submit ? "Pending Approval" : "Draft",
      totalAmount,
    };
    onSave(newPR);
    toast.success(`${newPR.id} ${submit ? "submitted for approval" : "saved as draft"}.`);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Requisition Information
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => handleSave(false)}>
                <Save className="h-4 w-4 mr-1.5" /> Save Draft
              </Button>
              <Button onClick={() => handleSave(true)}>
                <Send className="h-4 w-4 mr-1.5" /> Submit for Approval
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                PR Date <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={prDate}
                onChange={(e) => setPrDate(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Required By
              </Label>
              <Input
                type="date"
                value={requiredBy}
                onChange={(e) => setRequiredBy(e.target.value)}
                className="mt-1"
              />
            </div>

            <LocationPicker
              officeId={officeId}
              warehouseId={warehouseId}
              onChange={(n) => { setOfficeId(n.officeId); setWarehouseId(n.warehouseId); }}
            />

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Requested By <span className="text-destructive">*</span>
              </Label>
              <select
                value={requestedBy}
                onChange={(e) => setRequestedBy(e.target.value)}
                className={selectCls}
              >
                <option value="">Select requester…</option>
                {REQUESTERS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Priority
              </Label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className={selectCls}
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Justification / Remarks
              </Label>
              <Textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Why is this requisition needed?"
                className="mt-1 min-h-[72px]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Line Items
            </h3>
            <div className="text-sm text-muted-foreground">
              Estimated Total:{" "}
              <span className="font-bold text-foreground tabular-nums">
                ৳ {totalAmount.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Item <span className="text-destructive">*</span>
              </Label>
              <select
                value={itemName}
                onChange={(e) => {
                  const name = e.target.value;
                  setItemName(name);
                  const m = ITEM_MASTER.find((i) => i.name === name);
                  if (m) {
                    setUom(m.uom);
                    if (!description.trim()) setDescription(m.description);
                  }
                }}
                className={selectCls}
              >
                <option value="">Select item…</option>
                {ITEM_MASTER.map((i) => <option key={i.name} value={i.name}>{i.name}</option>)}
              </select>
            </div>

            <div className="md:col-span-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Description
              </Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Spec / brand"
                className="mt-1"
              />
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Qty <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={0}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="mt-1"
              />
            </div>

            <div className="md:col-span-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                UoM
              </Label>
              <select
                value={uom}
                onChange={(e) => setUom(e.target.value)}
                className={selectCls}
              >
                {UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Est. Rate
              </Label>
              <Input
                type="number"
                min={0}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="mt-1"
              />
            </div>

            <div className="md:col-span-1">
              <Button variant="outline" onClick={addLine} className="w-full">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="mt-6 border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-14 text-xs uppercase tracking-wider">SL</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Description</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">UoM</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Rate</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Amount</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                      No line items added yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {lines.map((l, i) => (
                      <TableRow key={l.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium">{l.itemName}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {l.description || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                        <TableCell>{l.uom}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.rate.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(l.qty * l.rate).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => removeLine(l.id)}
                            aria-label={`Remove ${l.itemName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell colSpan={6} className="text-right uppercase text-xs tracking-wider">
                        Total
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        ৳ {totalAmount.toLocaleString()}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RequisitionDetailsDialog({
  requisition, onClose,
}: { requisition: PurchaseRequisition | null; onClose: () => void }) {
  return (
    <Dialog open={!!requisition} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>
            Requisition Details
            {requisition && (
              <span className="font-mono text-sm text-muted-foreground ml-2">
                — {requisition.id}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {requisition && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
              <Field label="Date" value={requisition.date} />
              <Field label="Required By" value={requisition.requiredBy} />
              <Field label="Requested By" value={requisition.requestedBy} />
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Priority</div>
                <div className="mt-1">
                  <Badge
                    variant={requisition.priority === "Urgent" ? "destructive" : "outline"}
                    className="text-[10px]"
                  >
                    {requisition.priority}
                  </Badge>
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</div>
                <div className="mt-1"><StatusBadge status={requisition.status} /></div>
              </div>
              <Field label="Items" value={requisition.lines.length.toString()} />
              <Field label="Total Est." value={`৳ ${requisition.totalAmount.toLocaleString()}`} bold />
            </div>

            {requisition.justification && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                  Justification
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground">
                  {requisition.justification}
                </div>
              </div>
            )}

            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                Line Items
              </div>
              <div className="border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="w-14 text-xs uppercase tracking-wider">SL</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Description</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">UoM</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Rate</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requisition.lines.map((l, i) => (
                      <TableRow key={l.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium">{l.itemName}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {l.description || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                        <TableCell>{l.uom}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.rate.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(l.qty * l.rate).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell colSpan={6} className="text-right uppercase text-xs tracking-wider">
                        Total
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        ৳ {requisition.totalAmount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={"mt-1 text-sm text-foreground" + (bold ? " font-semibold" : "")}>
        {value}
      </div>
    </div>
  );
}

/**
 * Edit dialog for in-flight requisitions (Draft / Pending Approval). Users
 * can adjust the priority + justification and add / remove / mutate line
 * items. Save persists either to local state or back to the workflow store
 * via the parent's onSave handler.
 */
function RequisitionEditDialog({
  requisition, onClose, onSave,
}: {
  requisition: PurchaseRequisition | null;
  onClose: () => void;
  onSave: (r: PurchaseRequisition) => void;
}) {
  const [priority, setPriority] = useState<Priority>("Normal");
  const [justification, setJustification] = useState("");
  const [lines, setLines] = useState<PRLineItem[]>([]);

  // Draft-line state (the "add new" row at the bottom of the table)
  const [itemName, setItemName] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");
  const [uom, setUom] = useState(UOMS[0]);
  const [rate, setRate] = useState("");

  // Reseed local state every time the dialog opens with a new requisition.
  useEffect(() => {
    if (!requisition) return;
    setPriority(requisition.priority);
    setJustification(requisition.justification);
    setLines(requisition.lines.map((l) => ({ ...l })));
    setItemName(""); setDescription(""); setQty(""); setRate("");
    setUom(UOMS[0]);
  }, [requisition]);

  if (!requisition) return null;

  const totalAmount = lines.reduce((s, l) => s + l.qty * l.rate, 0);

  const addLine = () => {
    if (!itemName.trim()) { toast.error("Pick an item to add."); return; }
    const qtyN = Number(qty);
    if (!qtyN || qtyN <= 0) { toast.error("Quantity must be greater than zero."); return; }
    const rateN = Number(rate);
    if (rateN < 0) { toast.error("Rate cannot be negative."); return; }
    if (lines.some((l) => l.itemName.toLowerCase() === itemName.trim().toLowerCase())) {
      toast.error(`${itemName} is already in this requisition.`); return;
    }
    setLines((prev) => [
      ...prev,
      {
        id: `LN-${Date.now()}`,
        itemName: itemName.trim(),
        description: description.trim(),
        qty: qtyN,
        uom,
        rate: rateN,
      },
    ]);
    setItemName(""); setDescription(""); setQty(""); setRate("");
  };

  const updateLine = (id: string, patch: Partial<PRLineItem>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const removeLine = (id: string) =>
    setLines((prev) => prev.filter((l) => l.id !== id));

  const handleSave = () => {
    if (lines.length === 0) { toast.error("At least one line item is required."); return; }
    onSave({ ...requisition, priority, justification, lines, totalAmount });
  };

  return (
    <Dialog open={!!requisition} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            Edit Requisition
            <span className="font-mono text-sm text-muted-foreground ml-1">— {requisition.id}</span>
            <StatusBadge status={requisition.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Header fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Priority</Label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className={selectCls}
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Requested By</Label>
              <Input value={requisition.requestedBy} disabled className="mt-1" />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Justification / Remarks</Label>
              <Textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Why is this requisition needed?"
                className="mt-1 min-h-[60px]"
              />
            </div>
          </div>

          {/* Add line row */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Add Item
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
              <div className="md:col-span-4">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Item</Label>
                <select
                  value={itemName}
                  onChange={(e) => {
                    const name = e.target.value;
                    setItemName(name);
                    const m = ITEM_MASTER.find((i) => i.name === name);
                    if (m) {
                      setUom(m.uom);
                      if (!description.trim()) setDescription(m.description);
                    }
                  }}
                  className={selectCls}
                >
                  <option value="">Select item…</option>
                  {ITEM_MASTER.map((i) => <option key={i.name} value={i.name}>{i.name}</option>)}
                </select>
              </div>
              <div className="md:col-span-3">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Description</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Spec / brand" className="mt-1" />
              </div>
              <div className="md:col-span-2">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Qty</Label>
                <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1" />
              </div>
              <div className="md:col-span-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">UoM</Label>
                <select value={uom} onChange={(e) => setUom(e.target.value)} className={selectCls}>
                  {UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="md:col-span-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Rate</Label>
                <Input type="number" min={0} value={rate} onChange={(e) => setRate(e.target.value)} className="mt-1" />
              </div>
              <div className="md:col-span-1">
                <Button variant="outline" onClick={addLine} className="w-full h-9">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Existing lines — qty/rate inline editable */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between">
              <span>Line Items ({lines.length})</span>
              <span className="text-foreground">
                Total: <span className="font-bold tabular-nums">৳ {totalAmount.toLocaleString()}</span>
              </span>
            </div>
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-12 text-xs uppercase tracking-wider">SL</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Description</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-24">Qty</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-20">UoM</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-28">Rate</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-28">Amount</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                        No line items yet — add one above.
                      </TableCell>
                    </TableRow>
                  ) : (
                    lines.map((l, i) => (
                      <TableRow key={l.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium">{l.itemName}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{l.description || "—"}</TableCell>
                        <TableCell>
                          <Input
                            type="number" min={0}
                            value={l.qty}
                            onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) || 0 })}
                            className="h-8 tabular-nums"
                          />
                        </TableCell>
                        <TableCell>{l.uom}</TableCell>
                        <TableCell>
                          <Input
                            type="number" min={0}
                            value={l.rate}
                            onChange={(e) => updateLine(l.id, { rate: Number(e.target.value) || 0 })}
                            className="h-8 tabular-nums"
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(l.qty * l.rate).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => removeLine(l.id)}
                            aria-label={`Remove ${l.itemName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-1.5" /> Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
