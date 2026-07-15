import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/common/KpiCard";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ClipboardCheck, CheckCircle2, CircleDashed, XCircle, Lock,
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
  qcPassQty?: number;
  qcFailQty?: number;
};

const statusCls = (status: string) =>
  status === "Accepted" ? "bg-green-600 text-white" :
  status === "Partially Accepted" ? "bg-amber-500 text-white" :
  status === "Rejected" ? "bg-red-600 text-white" :
  status === "On Hold" ? "bg-amber-400 text-white" :
  status === "Pending" ? "bg-slate-200 text-slate-700" :
  "bg-muted text-foreground";

// Push a Purchase Return into the same persisted store the Purchase Return page
// reads (usePersistedState "purchase-return-rows"). It picks up the new row on
// its next mount (navigation remounts the page).
const LSK = (k: string) => `harvest-data-v1:${k}`;

type FailedLine = { item: string; uom: string; qty: number; reason: string; notes?: string };

// One Purchase Return per GRN inspection, carrying every failed item as a line.
function initiatePurchaseReturn(grnId: string, po: string, vendor: string, failed: FailedLine[]): string {
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
    grnRef: grnId,
    poRef: po,
    supplier: vendor,
    lines: failed.map((f, i) => ({
      id: `l-${Date.now()}-${i}`,
      itemName: f.item, uom: f.uom, qty: f.qty, unitPrice: 0,
      reason: f.reason, notes: f.notes,
    })),
    totalValue: 0,
    status: "Submitted",
    remarks: `Auto-initiated from QC — GRN ${grnId} (${failed.length} item${failed.length === 1 ? "" : "s"} failed).`,
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

  // GRN-level, item-wise inspection dialog. Every pending line of the GRN is a
  // row; each is split into Pass / Fail with its own Remarks. No temperature.
  const [inspectGrnId, setInspectGrnId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { qcQty: string; passQty: string; remarks: string }>>({});

  const inspectGrn = useMemo(() => grns.find((g) => g.id === inspectGrnId) ?? null, [grns, inspectGrnId]);
  // Pending lines of the GRN being inspected, keeping each line's original index.
  const inspectLines = useMemo(
    () => (inspectGrn ? inspectGrn.lines.map((l, i) => ({ ...l, idx: i })).filter((l) => l.qcStatus === "Pending") : []),
    [inspectGrn],
  );

  const openInspect = (r: QcRow) => {
    const g = grns.find((x) => x.id === r.grnId);
    if (!g) return;
    const d: Record<number, { qcQty: string; passQty: string; remarks: string }> = {};
    g.lines.forEach((l, i) => {
      // Default: inspect the full received qty, all passing — one click accepts all.
      if (l.qcStatus === "Pending") d[i] = { qcQty: String(l.qty), passQty: String(l.qty), remarks: "" };
    });
    setDrafts(d);
    setInspectGrnId(r.grnId);
  };

  const setDraft = (idx: number, patch: Partial<{ qcQty: string; passQty: string; remarks: string }>) =>
    setDrafts((prev) => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));

  // Clamp a line's draft into a resolved split: inspected ≤ received,
  // passed ≤ inspected, failed = inspected − passed.
  const resolveLine = (received: number, d?: { qcQty: string; passQty: string }) => {
    const qcQ = Math.max(0, Math.min(Number(d?.qcQty) || 0, received));
    const pass = Math.max(0, Math.min(Number(d?.passQty) || 0, qcQ));
    return { qcQ, pass, fail: Math.max(0, qcQ - pass) };
  };
  const lineStatus = (received: number, pass: number, fail: number): WfGRNQcStatus =>
    fail === 0 && pass === received ? "Accepted" : pass === 0 ? "Rejected" : "Partially Accepted";

  const confirmInspect = () => {
    const g = inspectGrn; if (!g) return;
    const failed: FailedLine[] = [];
    let inspected = 0, accepted = 0, partial = 0, rejected = 0;

    g.lines.forEach((l, i) => {
      const d = drafts[i];
      if (!d) return;
      const { qcQ, pass, fail } = resolveLine(l.qty, d);
      if (qcQ <= 0) return;
      inspected++;
      const status = lineStatus(l.qty, pass, fail);
      if (status === "Accepted") accepted++; else if (status === "Rejected") rejected++; else partial++;

      updateGRNLineQC(g.id, i, status, {
        qcQty: qcQ, qcPassQty: pass, qcFailQty: fail,
        qcCompliedQty: fail === 0 ? "Yes" : "No",
        qcRemarks: d.remarks.trim() || undefined,
        ...(fail > 0 ? { qcReason: "Quality Issue" } : {}),
      });
      if (pass > 0) applyInventoryStock(l.name, pass);
      if (fail > 0) failed.push({ item: l.name, uom: l.uom, qty: fail, reason: "Quality Issue", notes: d.remarks.trim() || undefined });
    });

    if (inspected === 0) { toast.error("Enter a QC quantity for at least one item."); return; }

    let rtId: string | undefined;
    if (failed.length) rtId = initiatePurchaseReturn(g.id, g.poRef, g.vendor, failed);

    logAudit({
      action: "GRN inspected",
      module: "Quality Control",
      entity: g.id,
      detail: `${inspected} item(s): ${accepted} accepted · ${partial} partial · ${rejected} rejected` + (rtId ? ` — Purchase Return ${rtId} to ${g.vendor}` : ""),
    });
    toast.success(`GRN ${g.id} inspected — ${inspected} item${inspected === 1 ? "" : "s"} processed${rtId ? ` · Return ${rtId} initiated` : ""}.`);
    setInspectGrnId(null);
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
        qcPassQty: l.qcPassQty, qcFailQty: l.qcFailQty,
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
      render: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusCls(r.status)}`}>{r.status}</span>
          {(r.qcPassQty != null || r.qcFailQty != null) && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {r.qcPassQty ?? 0} pass · {r.qcFailQty ?? 0} fail
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Quality Control — Inbound Inspection"
        subtitle="Inspect goods received against each GRN — accept (records the inspection) or reject (initiates a purchase return); only accepted lines post to Stock Overview"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Pending" value={count("Pending")} icon={ClipboardCheck} tone="warning" />
        <KpiCard label="Accepted" value={count("Accepted")} icon={CheckCircle2} tone="success" />
        <KpiCard label="Partially Accepted" value={count("Partially Accepted")} icon={CircleDashed} tone="info" />
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
            <option value="Partially Accepted">Partially Accepted</option>
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
            <Button
              size="sm" variant="outline"
              className="h-7 px-2.5 text-xs text-primary border-primary/30 hover:bg-primary/5 disabled:opacity-40"
              disabled={r.status !== "Pending"}
              onClick={() => openInspect(r)}
            >
              <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Inspect
            </Button>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> Historical
            </span>
          )
        }
      />

      {/* GRN-level, item-wise inspection — every item split into Pass / Fail */}
      <Dialog open={!!inspectGrn} onOpenChange={(v) => { if (!v) setInspectGrnId(null); }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-primary" /> QC Inspection
              {inspectGrn && <span className="text-sm font-normal text-muted-foreground">· {inspectGrn.id} · {inspectGrn.vendor}</span>}
            </DialogTitle>
          </DialogHeader>
          {inspectGrn && (
            <div className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Inspect each item — <span className="text-green-700 font-medium">Pass</span> posts to Stock Overview,
                <span className="text-red-600 font-medium"> Fail</span> initiates a Purchase Return. Fail = QC Qty − Pass.
              </p>

              <div className="max-h-[52vh] overflow-y-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                    <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="text-left font-semibold px-3 py-2">Item</th>
                      <th className="text-center font-semibold px-2 py-2 w-14">UOM</th>
                      <th className="text-right font-semibold px-2 py-2 w-16">Qty</th>
                      <th className="text-right font-semibold px-2 py-2 w-20">QC Qty</th>
                      <th className="text-right font-semibold px-2 py-2 w-20">Pass</th>
                      <th className="text-right font-semibold px-2 py-2 w-16">Fail</th>
                      <th className="text-left font-semibold px-2 py-2 w-48">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspectLines.length === 0 ? (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No pending items on this GRN.</td></tr>
                    ) : inspectLines.map((l) => {
                      const d = drafts[l.idx];
                      const { qcQ, pass, fail } = resolveLine(l.qty, d);
                      const status = lineStatus(l.qty, pass, fail);
                      return (
                        <tr key={l.idx} className="border-t border-border align-middle">
                          <td className="px-3 py-2">
                            <div className="font-medium text-foreground">{l.name}</div>
                            <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusCls(status)}`}>{status}</span>
                          </td>
                          <td className="px-2 py-2 text-center text-muted-foreground">{l.uom}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{l.qty}</td>
                          <td className="px-2 py-2">
                            <Input
                              type="number" min={0} max={l.qty} inputMode="decimal"
                              value={d?.qcQty ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                const q = Math.max(0, Math.min(Number(v) || 0, l.qty));
                                const patch: Partial<{ qcQty: string; passQty: string }> = { qcQty: v };
                                if ((Number(d?.passQty) || 0) > q) patch.passQty = String(q);
                                setDraft(l.idx, patch);
                              }}
                              className="h-8 text-right tabular-nums"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number" min={0} max={qcQ} inputMode="decimal"
                              value={d?.passQty ?? ""}
                              onChange={(e) => setDraft(l.idx, { passQty: e.target.value })}
                              className="h-8 text-right tabular-nums font-semibold text-green-700"
                            />
                          </td>
                          <td className={`px-2 py-2 text-right tabular-nums font-semibold ${fail > 0 ? "text-red-600" : "text-muted-foreground"}`}>{fail}</td>
                          <td className="px-2 py-2">
                            <Input
                              value={d?.remarks ?? ""}
                              onChange={(e) => setDraft(l.idx, { remarks: e.target.value })}
                              placeholder={fail > 0 ? "Reason / note…" : "Optional…"}
                              className="h-8"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInspectGrnId(null)}>Cancel</Button>
            <Button className="bg-primary hover:bg-primary/90" onClick={confirmInspect} disabled={inspectLines.length === 0}>
              <ClipboardCheck className="h-4 w-4 mr-1.5" /> Confirm QC
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
