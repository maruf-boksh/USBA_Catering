import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KpiCard } from "@/components/common/KpiCard";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ClipboardCheck, CheckCircle2, XCircle, Lock,
} from "lucide-react";
import { toast } from "sonner";
import { receiveItems } from "@/lib/sample-data";
import { useWorkflow, type WfGRNQcStatus } from "@/lib/workflow-store";
import { applyInventoryStock } from "@/lib/stock-adjustments";
import { logAudit } from "@/lib/audit-log";
import { LocationFilter, LocationCell } from "@/components/common/LocationPicker";
import { SEED_RETURNS } from "@/routes/purchase-return";

// Quality Control — inspect inbound GRN lines received via Receive Items and
// decide their outcome. Accept captures the inspection (complied qty / temp /
// remarks) and posts the line to Stock Overview; Reject captures a reason and
// auto-initiates a Purchase Return to the vendor. Only ACCEPTED lines post to
// the Stock Overview ledger (lib/stock-ledger.ts reads accepted GRN lines).

type QcRow = {
  id: string;
  grnId: string;
  /** Index into the GRN's lines; -1 for read-only historical (seed) rows. */
  lineIdx: number;
  editable: boolean;
  po: string;
  vendor: string;
  item: string;
  qty: number;
  uom: string;
  temp: string;
  expiry: string;
  receivedBy: string;
  status: WfGRNQcStatus | string;
  officeId?: string;
  warehouseId?: string;
};

// Rejection reasons — mirror the Purchase Return reasons so a rejected line maps
// straight onto an initiated return.
const REJECT_REASONS = [
  "Defective", "Short Shipment", "Wrong Item", "Near Expiry", "Quality Issue", "Other",
] as const;

const statusCls = (status: string) =>
  status === "Accepted" ? "bg-green-600 text-white" :
  status === "Rejected" ? "bg-red-600 text-white" :
  status === "On Hold" ? "bg-amber-400 text-white" :
  status === "Pending" ? "bg-slate-200 text-slate-700" :
  "bg-muted text-foreground";

// Push a Purchase Return into the same persisted store the Purchase Return page
// reads (usePersistedState "purchase-return-rows"). It picks up the new row on
// its next mount (navigation remounts the page).
const LSK = (k: string) => `harvest-data-v1:${k}`;
function initiatePurchaseReturn(r: QcRow, reason: string, remarks: string): string {
  // Seed from the same defaults the Purchase Return page uses when the store is
  // still empty, so initiating a return doesn't wipe the seeded history.
  let existing: { id: string }[] = SEED_RETURNS;
  try {
    const raw = localStorage.getItem(LSK("purchase-return-rows"));
    if (raw) existing = JSON.parse(raw);
  } catch { /* fall back to seed */ }
  const id = `RT-${new Date().getFullYear()}-${String(existing.length + 15).padStart(4, "0")}`;
  const ret = {
    id,
    date: new Date().toISOString().slice(0, 10),
    grnRef: r.grnId,
    poRef: r.po,
    supplier: r.vendor,
    lines: [{
      id: `l-${Date.now()}`,
      itemName: r.item, uom: r.uom, qty: r.qty, unitPrice: 0,
      reason, notes: remarks || undefined,
    }],
    totalValue: 0,
    status: "Submitted",
    remarks: `Auto-initiated from QC rejection — GRN ${r.grnId}, ${r.item}.`,
  };
  try {
    localStorage.setItem(LSK("purchase-return-rows"), JSON.stringify([ret, ...existing]));
  } catch { /* quota — non-fatal */ }
  return id;
}

export default function QualityControl() {
  const { grns, updateGRNLineQC } = useWorkflow();
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | WfGRNQcStatus>("All");

  // Accept inspection dialog
  const [acceptRow, setAcceptRow] = useState<QcRow | null>(null);
  const [complied, setComplied] = useState<"Yes" | "No">("Yes");
  const [accTemp, setAccTemp] = useState("");
  const [accRemarks, setAccRemarks] = useState("");

  // Reject dialog
  const [rejectRow, setRejectRow] = useState<QcRow | null>(null);
  const [rejReason, setRejReason] = useState<string>(REJECT_REASONS[0]);
  const [rejRemarks, setRejRemarks] = useState("");

  const openAccept = (r: QcRow) => {
    setAcceptRow(r); setComplied("Yes"); setAccTemp(r.temp ?? ""); setAccRemarks("");
  };
  const openReject = (r: QcRow) => {
    setRejectRow(r); setRejReason(REJECT_REASONS[0]); setRejRemarks("");
  };

  const confirmAccept = () => {
    const r = acceptRow; if (!r) return;
    updateGRNLineQC(r.grnId, r.lineIdx, "Accepted", {
      temp: accTemp.trim(),
      qcCompliedQty: complied,
      qcRemarks: accRemarks.trim() || undefined,
    });
    // Post the accepted quantity into the Stock Overview on-hand balance.
    applyInventoryStock(r.item, r.qty);
    logAudit({
      action: "GRN line accepted",
      module: "Quality Control",
      entity: `${r.grnId} · ${r.item}`,
      detail: `${r.qty} ${r.uom} accepted from ${r.vendor} — posted to stock`,
    });
    toast.success(`${r.item} accepted — ${r.qty} ${r.uom} posted to Stock Overview.`);
    setAcceptRow(null);
  };

  const confirmReject = () => {
    const r = rejectRow; if (!r) return;
    updateGRNLineQC(r.grnId, r.lineIdx, "Rejected", {
      qcReason: rejReason,
      qcRemarks: rejRemarks.trim() || undefined,
    });
    const rtId = initiatePurchaseReturn(r, rejReason, rejRemarks.trim());
    logAudit({
      action: "GRN line rejected",
      module: "Quality Control",
      entity: `${r.grnId} · ${r.item}`,
      detail: `${rejReason} — Purchase Return ${rtId} initiated to ${r.vendor}`,
    });
    toast.error(`${r.item} rejected — Purchase Return ${rtId} initiated to ${r.vendor}.`);
    setRejectRow(null);
  };

  // Live GRN lines (editable) first, then historical seed receipts (read-only).
  const allRows: QcRow[] = useMemo(() => [
    ...grns.flatMap((g) =>
      g.lines.map((l, i) => ({
        id: `${g.id}-L${i + 1}`,
        grnId: g.id, lineIdx: i, editable: true,
        po: g.poRef, vendor: g.vendor, item: l.name, qty: l.qty, uom: l.uom,
        temp: l.temp, expiry: l.expiry, receivedBy: g.receivedBy, status: l.qcStatus,
        officeId: g.officeId, warehouseId: g.warehouseId,
      })),
    ),
    ...receiveItems.map((s) => ({
      id: s.id,
      grnId: s.id, lineIdx: -1, editable: false,
      po: s.po, vendor: s.vendor, item: s.item, qty: s.qty, uom: s.uom,
      temp: s.temp, expiry: s.expiry, receivedBy: s.receivedBy, status: s.status,
      officeId: "OFF-001", warehouseId: "WH-001",
    })),
  ], [grns]);

  const rows = allRows.filter((r) => {
    if (filterOffice && r.officeId !== filterOffice) return false;
    if (filterWarehouse && r.warehouseId !== filterWarehouse) return false;
    if (statusFilter !== "All" && r.status !== statusFilter) return false;
    return true;
  });

  const count = (s: WfGRNQcStatus) => allRows.filter((r) => r.status === s).length;

  const cols: Column<QcRow>[] = [
    { key: "grnId", header: "GRN #" },
    { key: "po", header: "PO Ref" },
    { key: "vendor", header: "Vendor" },
    {
      key: "officeId" as keyof QcRow, header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    { key: "item", header: "Item" },
    { key: "qty", header: "Qty" },
    { key: "uom", header: "UOM" },
    { key: "temp", header: "Temp °C" },
    { key: "expiry", header: "Expiry" },
    { key: "receivedBy", header: "Received By" },
    {
      key: "status", header: "QC Status",
      render: (r) => <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusCls(r.status)}`}>{r.status}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Quality Control — Inbound Inspection"
        subtitle="Inspect goods received against each GRN — accept (records the inspection) or reject (initiates a purchase return); only accepted lines post to Stock Overview"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Pending" value={count("Pending")} icon={ClipboardCheck} tone="warning" />
        <KpiCard label="Accepted" value={count("Accepted")} icon={CheckCircle2} tone="success" />
        <KpiCard label="Rejected" value={count("Rejected")} icon={XCircle} tone="red" />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <LocationFilter
          officeId={filterOffice}
          warehouseId={filterWarehouse}
          onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
        />
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">QC Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="All">All statuses</option>
            <option value="Pending">Pending</option>
            <option value="Accepted">Accepted</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>
      </div>

      <DataTable
        title="quality-control"
        data={rows}
        columns={cols}
        searchKeys={["grnId", "po", "vendor", "item", "status"]}
        selectable={false}
        actions={(r) =>
          r.editable ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm" variant="outline"
                className="h-7 px-2 text-xs text-green-700 border-green-200 hover:bg-green-50 disabled:opacity-40"
                disabled={r.status !== "Pending"}
                onClick={() => openAccept(r)}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Accept
              </Button>
              <Button
                size="sm" variant="outline"
                className="h-7 px-2 text-xs text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-40"
                disabled={r.status !== "Pending"}
                onClick={() => openReject(r)}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
              </Button>
            </div>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> Historical
            </span>
          )
        }
      />

      {/* Accept — inspection details */}
      <Dialog open={!!acceptRow} onOpenChange={(v) => { if (!v) setAcceptRow(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Accept — Inspection
            </DialogTitle>
          </DialogHeader>
          {acceptRow && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                <span className="font-semibold">{acceptRow.item}</span>
                <span className="text-muted-foreground"> · {acceptRow.qty} {acceptRow.uom} · {acceptRow.grnId} · {acceptRow.vendor}</span>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Complied Quantity *</Label>
                <div className="mt-1 flex gap-2">
                  {(["Yes", "No"] as const).map((v) => (
                    <Button
                      key={v}
                      type="button"
                      variant={complied === v ? "default" : "outline"}
                      className={`flex-1 h-9 ${complied === v && v === "Yes" ? "bg-green-600 hover:bg-green-700" : complied === v && v === "No" ? "bg-red-600 hover:bg-red-700" : ""}`}
                      onClick={() => setComplied(v)}
                    >
                      {v}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Temperature (°C)</Label>
                <Input
                  value={accTemp}
                  onChange={(e) => setAccTemp(e.target.value)}
                  placeholder="e.g. 4°C / Ambient"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Remarks</Label>
                <Textarea
                  value={accRemarks}
                  onChange={(e) => setAccRemarks(e.target.value)}
                  rows={3}
                  className="mt-1"
                  placeholder="Condition, packaging, batch notes…"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcceptRow(null)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={confirmAccept}>
              <CheckCircle2 className="h-4 w-4 mr-1.5" /> Confirm Accept
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject — reason + initiate purchase return */}
      <Dialog open={!!rejectRow} onOpenChange={(v) => { if (!v) setRejectRow(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" /> Reject &amp; Initiate Return
            </DialogTitle>
          </DialogHeader>
          {rejectRow && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                <span className="font-semibold">{rejectRow.item}</span>
                <span className="text-muted-foreground"> · {rejectRow.qty} {rejectRow.uom} · {rejectRow.grnId} · {rejectRow.vendor}</span>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Rejection Reason *</Label>
                <select
                  value={rejReason}
                  onChange={(e) => setRejReason(e.target.value)}
                  className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Remarks</Label>
                <Textarea
                  value={rejRemarks}
                  onChange={(e) => setRejRemarks(e.target.value)}
                  rows={3}
                  className="mt-1"
                  placeholder="Details for the supplier / return note…"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                A Purchase Return to <span className="font-medium">{rejectRow.vendor}</span> will be initiated for this line and appear on the Purchase Return page (status Submitted).
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectRow(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={confirmReject}>
              <XCircle className="h-4 w-4 mr-1.5" /> Reject &amp; Return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
