import { useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { rowEditors } from "@/lib/row-editors";
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
import { activeOffices, activeWarehousesByOffice, warehouses as ALL_WAREHOUSES, offices as ALL_OFFICES } from "@/lib/sample-data";
import { getActiveStaff } from "@/lib/staff";
import { toast } from "sonner";


export type TRStatus = "Draft" | "Pending Approval" | "Approved" | "Rejected" | "Completed";

export type TRLine = {
  id: string;
  item: string;
  uom: string;
  qty: number;
  /** How much of this line has been issued so far via Transfer Out. Remaining =
   *  qty − issuedQty; the request completes when every line is fully issued. */
  issuedQty?: number;
};

export type TransferRequest = {
  id: string;
  /** Sending warehouse NAME — the source. Chosen by the APPROVER, so it is blank
   *  until the request is approved. Source of truth for the Transfer page. */
  from: string;
  /** Receiving warehouse NAME — the destination. Chosen by the REQUESTER here. */
  to: string;
  date: string;
  /** Sending office — chosen at approval, alongside `from`. */
  fromOfficeId?: string;
  /** Receiving office — chosen by the requester, alongside `to`. */
  toOfficeId?: string;
  requestedBy: string;
  reason: string;
  lines: TRLine[];
  status: TRStatus;
  /** Set when the request is approved — shown on the Transfer Out issue screen. */
  approvedBy?: string;
};

/** Shared persistence key — Transfer reads approved requests from the same store
 *  so issuing against one flips its status back here. */
export const TR_STORAGE_KEY = "transfer-request-rows";

/** Office id that owns a warehouse NAME (the store is keyed by name). */
export const officeIdForWarehouseName = (name: string): string | undefined =>
  ALL_WAREHOUSES.find((w) => w.name === name)?.officeId;
/** Display name of an office id. */
export const officeNameOf = (officeId?: string): string =>
  ALL_OFFICES.find((o) => o.id === officeId)?.name ?? "—";

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

export const TR_SEED: TransferRequest[] = [
  {
    // Pending — the requester picked the receiving side; sending is chosen at approval.
    id: "TR-7001", date: "2026-05-19 10:25", from: "", to: "Hot Kitchen",
    toOfficeId: "OFF-001",
    requestedBy: "S. Ahmed", reason: "Daily production replenishment", status: "Pending Approval",
    lines: [
      { id: "L1", item: "Basmati Rice",   uom: "Kg",    qty: 120 },
      { id: "L2", item: "Chicken Breast", uom: "Kg",    qty: 80 },
    ],
  },
  {
    id: "TR-7002", date: "2026-05-19 09:10", from: "Cold Storage 1", to: "Cold Kitchen",
    fromOfficeId: "OFF-001", toOfficeId: "OFF-001",
    requestedBy: "F. Begum", reason: "Salad station prep", status: "Approved", approvedBy: "T. Islam",
    lines: [
      { id: "L1", item: "Tomato",                 uom: "Kg",     qty: 45 },
      { id: "L2", item: "Mineral Water 250ml",    uom: "Bottle", qty: 300 },
    ],
  },
  {
    id: "TR-7003", date: "2026-05-18 14:50", from: "Central Warehouse", to: "Cold Kitchen",
    fromOfficeId: "OFF-001", toOfficeId: "OFF-001",
    requestedBy: "M. Hossain", reason: "Bakery oil top-up", status: "Completed",
    lines: [
      { id: "L1", item: "Cooking Oil", uom: "Litre", qty: 25 },
    ],
  },
  {
    // Draft — receiving side captured, sending still to be decided at approval.
    id: "TR-7004", date: "2026-05-18 11:32", from: "", to: "Central Warehouse",
    toOfficeId: "OFF-001",
    requestedBy: "T. Islam", reason: "Stock balancing", status: "Draft",
    lines: [
      { id: "L1", item: "Meal Box", uom: "Piece", qty: 500 },
    ],
  },
  {
    id: "TR-7005", date: "2026-05-17 08:00", from: "", to: "Hot Kitchen",
    toOfficeId: "OFF-001",
    requestedBy: "S. Ahmed", reason: "Emergency stock — chicken curry batch", status: "Rejected",
    lines: [
      { id: "L1", item: "Chicken Breast", uom: "Kg", qty: 200 },
    ],
  },
];

export default function TransferRequestPage() {
  const [rows, setRows] = usePersistedState<TransferRequest[]>(TR_STORAGE_KEY, TR_SEED);
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
          <TRList data={rows} editors={rowEditors(setRows)} />
        </>
      ) : (
        <TRCreate nextId={`TR-${String(7000 + rows.length + 1)}`} onSave={add} />
      )}
    </>
  );
}

function TRList({
  data, editors,
}: {
  data: TransferRequest[];
  editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void };
}) {
  const cols: Column<TransferRequest>[] = [
    { key: "id", header: "TR #" },
    { key: "date", header: "Date", render: (r) => <span className="tabular-nums text-xs">{r.date}</span> },
    {
      key: "from",
      header: "Route",
      render: (r) => (
        <div className="flex items-center gap-1.5 text-xs">
          {r.from
            ? <span className="font-medium">{r.from}</span>
            : <span className="italic text-muted-foreground">Sending set at approval</span>}
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
      actions={(r) => (
        <RowActions
          row={r}
          actions={["view", "edit", "print"]}
          onSave={editors.onSave}
          editDetail={({ save, close }) => <TRFields mode="edit" initial={r} onSubmit={save} onClose={close} />}
        />
      )}
    />
  );
}

function TRCreate({ nextId, onSave }: { nextId: string; onSave: (tr: TransferRequest) => void }) {
  return <TRFields mode="create" nextId={nextId} onSave={onSave} />;
}

/**
 * Shared Transfer Request form. Used by the Create page (mode="create") and the
 * row Edit modal (mode="edit", pre-filled from `initial`) so both share an
 * identical layout including the dynamic line table.
 */
function TRFields({
  mode, nextId, initial, onSave, onSubmit, onClose,
}: {
  mode: "create" | "edit";
  nextId?: string;
  initial?: TransferRequest;
  onSave?: (tr: TransferRequest) => void;
  onSubmit?: (patch: Record<string, unknown>) => void;
  onClose?: () => void;
}) {
  const isEdit = mode === "edit";
  const today = new Date().toISOString().slice(0, 16).replace("T", " ");
  // Only the RECEIVING side is captured here — the sending office/warehouse is
  // chosen by the approver in Approval Management.
  const [toOfficeId, setToOfficeId] = useState(
    initial?.toOfficeId ?? officeIdForWarehouseName(initial?.to ?? "") ?? activeOffices[0]?.id ?? "",
  );
  const toWarehouseOptions = activeWarehousesByOffice(toOfficeId);
  const [to, setTo] = useState(initial?.to ?? toWarehouseOptions[0]?.name ?? "");
  const [requestedBy, setRequestedBy] = useState(initial?.requestedBy ?? "");
  const [reason, setReason] = useState(initial?.reason ?? "");
  const staffNames = getActiveStaff().map((s) => s.fullName);

  // When the office changes, keep the warehouse valid for it.
  const onToOffice = (officeId: string) => {
    setToOfficeId(officeId);
    const first = activeWarehousesByOffice(officeId)[0]?.name ?? "";
    setTo((prev) => (activeWarehousesByOffice(officeId).some((w) => w.name === prev) ? prev : first));
  };

  const [itemIdx, setItemIdx] = useState(0);
  const [qty, setQty] = useState("");
  const [lines, setLines] = useState<TRLine[]>(initial?.lines ?? []);

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

  const buildPayload = () => ({
    date: today,
    // Sending side is set at approval — carry any existing value, else blank.
    from: initial?.from ?? "",
    fromOfficeId: initial?.fromOfficeId,
    to, toOfficeId,
    requestedBy: requestedBy.trim(),
    reason: reason.trim(), lines,
  });

  const validate = () => {
    if (!toOfficeId || !to) { toast.error("Select the To office and warehouse."); return false; }
    if (!requestedBy.trim()) { toast.error("Requested By is required."); return false; }
    if (lines.length === 0) { toast.error("Add at least one item."); return false; }
    return true;
  };

  const save = (status: TRStatus) => {
    if (!validate()) return;
    onSave?.({ id: nextId!, ...buildPayload(), status });
    toast.success(`Transfer Request ${nextId} ${status === "Draft" ? "saved as draft" : "submitted for approval"}.`);
  };

  const saveEdit = () => {
    if (!validate()) return;
    onSubmit?.(buildPayload());
    onClose?.();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          {!isEdit && (
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
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">TR #</Label>
              <Input value={initial?.id ?? nextId ?? ""} disabled className="mt-1 font-mono" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
              <Input value={today} disabled className="mt-1 tabular-nums" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">To Office <span className="text-destructive">*</span></Label>
              <select value={toOfficeId} onChange={(e) => onToOffice(e.target.value)} className={selectCls}>
                {activeOffices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">To Warehouse <span className="text-destructive">*</span></Label>
              <select value={to} onChange={(e) => setTo(e.target.value)} className={selectCls} disabled={toWarehouseOptions.length === 0}>
                {toWarehouseOptions.length === 0
                  ? <option value="">No warehouse for this office</option>
                  : toWarehouseOptions.map((w) => <option key={w.id} value={w.name}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Requested By <span className="text-destructive">*</span></Label>
              <select value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} className={selectCls}>
                <option value="">Select staff…</option>
                {requestedBy && !staffNames.includes(requestedBy) && <option value={requestedBy}>{requestedBy}</option>}
                {staffNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
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

      {isEdit && (
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={saveEdit}><Save className="h-4 w-4 mr-1.5" /> Save Changes</Button>
        </div>
      )}
    </div>
  );
}
