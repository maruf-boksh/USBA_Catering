import { useState, useEffect, useRef, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { usePersistedState } from "@/lib/use-persisted-state";
import { roundQty } from "@/lib/num";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { rowEditors } from "@/lib/row-editors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, ArrowLeft, Save, MoveRight, Trash2, CheckCircle, Clock, Truck, Undo2,
  LayoutGrid, Info, ArrowRight,
} from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { toast } from "sonner";
import { activeItems, warehouses as ALL_WAREHOUSES, inventory, allocateFefo } from "@/lib/sample-data";
import { LocationPicker, LocationFilter, LocationCell } from "@/components/common/LocationPicker";
import { useWorkflow, type WfTransferNote, type StockDelta } from "@/lib/workflow-store";
import { applyInventoryStock } from "@/lib/stock-adjustments";
import { useArrivalFlash } from "@/lib/arrival-flash";
import { INITIAL_RECORDS as DISPATCH_RECORDS, type DispatchRecord, type DispatchStatus } from "@/routes/dispatch";
import { loadDispatchEntries, flightLabel, type DispatchEntry } from "@/routes/dispatch-monitoring";


type TransferStatus = "Pending" | "In Transit" | "Completed" | "Rejected";
type TransferKind = "Outbound" | "Return";
// Dispatch-linked lifecycle shown as a "Dispatch Status" badge on the row.
type TransferDispatchStatus = "Dispatched" | "Returned" | "Re-dispatched";

type TransferLine = {
  id: string;
  item: string;
  uom: string;
  requestedQty: number;
  transferredQty: number;
};

type Transfer = {
  id: string;
  date: string;
  trRef: string;
  from: string;
  to: string;
  issuedBy: string;
  receivedBy: string;
  lines: TransferLine[];
  status: TransferStatus;
  kind: TransferKind;
  // Reporting tags — source warehouse + owning office. Backfilled on seed rows
  // from the existing `from` location string.
  officeId: string;
  warehouseId: string;
  /** DSP-#### id when this transfer originated from a Dispatch (preserved
   *  through Return / Re-dispatch so the link survives). */
  dispatchRef?: string;
  /** Dispatch lifecycle for the badge — set only on dispatch-linked transfers. */
  dispatchStatus?: TransferDispatchStatus;
};

/** The linked dispatch id for a transfer, if any (from an explicit dispatchRef
 *  or a DSP-prefixed TR ref). */
const dispatchIdOf = (t: Transfer): string | undefined =>
  t.dispatchRef ?? (t.trRef.startsWith("DSP-") ? t.trRef : undefined);

const dispatchStatusCls = (s: TransferDispatchStatus) =>
  s === "Returned" ? "border-rose-300 bg-rose-50 text-rose-700" :
  s === "Re-dispatched" ? "border-violet-300 bg-violet-50 text-violet-700" :
  "border-emerald-300 bg-emerald-50 text-emerald-700";

// Map location name → warehouse record, used to backfill officeId/warehouseId
// from the existing `from` strings on seed rows.
const locationToWarehouse = (name: string) =>
  ALL_WAREHOUSES.find((w) => w.name === name);

function tagsForLocation(name: string): { officeId: string; warehouseId: string } {
  const w = locationToWarehouse(name);
  return { officeId: w?.officeId ?? "OFF-001", warehouseId: w?.id ?? "WH-001" };
}

const LOCATIONS = [
  "Central Warehouse",
  "Cold Storage 1",
  "Hot Kitchen",
  "Cold Kitchen",
  "Regional Warehouse CXB",
];

const APPROVED_TR_REFS = ["TR-7002", "TR-7003", "TR-7006", "Direct Transfer"];

// Item picker — pulled from the central Item Profile
const ITEMS: { code: string; name: string; uom: string }[] = activeItems.map((i) => ({
  code: i.code,
  name: i.name,
  uom: i.uom,
}));

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const SEED_BASE: Omit<Transfer, "officeId" | "warehouseId">[] = [
  {
    id: "TRF-8001", date: "2026-05-19 11:40", trRef: "TR-7002",
    from: "Cold Storage 1", to: "Cold Kitchen",
    issuedBy: "F. Begum", receivedBy: "T. Islam", status: "Completed", kind: "Outbound",
    lines: [
      { id: "L1", item: "Tomato",              uom: "Kg",     requestedQty: 45,  transferredQty: 45  },
      { id: "L2", item: "Mineral Water 250ml", uom: "Bottle", requestedQty: 300, transferredQty: 300 },
    ],
  },
  {
    id: "TRF-8002", date: "2026-05-19 10:05", trRef: "TR-7003",
    from: "Central Warehouse", to: "Cold Kitchen",
    issuedBy: "S. Ahmed", receivedBy: "M. Hossain", status: "In Transit", kind: "Outbound",
    lines: [
      { id: "L1", item: "Cooking Oil", uom: "Litre", requestedQty: 25, transferredQty: 20 },
    ],
  },
  {
    // Dispatch-originated in-transit transfer (linked to dispatch DSP-7701) —
    // eligible for Return → "Returned" dispatch status → Re-dispatch.
    id: "TRF-DSP-7701", date: "2026-07-05 08:10", trRef: "DSP-7701",
    from: "Hot Kitchen", to: "Central Warehouse",
    issuedBy: "M. Karim", receivedBy: "S. Ahmed", status: "In Transit", kind: "Outbound",
    dispatchRef: "DSP-7701", dispatchStatus: "Dispatched",
    lines: [
      { id: "L1", item: "Chicken Biryani", uom: "Portion", requestedQty: 100, transferredQty: 100 },
    ],
  },
  {
    id: "TRF-8003", date: "2026-05-19 09:25", trRef: "Direct Transfer",
    from: "Central Warehouse", to: "Hot Kitchen",
    issuedBy: "S. Ahmed", receivedBy: "—", status: "Pending", kind: "Outbound",
    lines: [
      { id: "L1", item: "Basmati Rice",   uom: "Kg", requestedQty: 50, transferredQty: 0 },
      { id: "L2", item: "Chicken Breast", uom: "Kg", requestedQty: 30, transferredQty: 0 },
    ],
  },
  // ── Returns (unused items coming back from kitchens to central) ──────────
  {
    id: "TRF-8004", date: "2026-05-19 14:20", trRef: "Return",
    from: "Hot Kitchen", to: "Central Warehouse",
    issuedBy: "R. Karim", receivedBy: "S. Ahmed", status: "Completed", kind: "Return",
    lines: [
      { id: "L1", item: "Basmati Rice", uom: "Kg", requestedQty: 8, transferredQty: 8 },
    ],
  },
  {
    id: "TRF-8005", date: "2026-05-19 15:50", trRef: "Return",
    from: "Cold Kitchen", to: "Cold Storage 1",
    issuedBy: "T. Islam", receivedBy: "—", status: "Pending", kind: "Return",
    lines: [
      { id: "L1", item: "Tomato",              uom: "Kg",     requestedQty: 6,  transferredQty: 0 },
      { id: "L2", item: "Mineral Water 250ml", uom: "Bottle", requestedQty: 24, transferredQty: 0 },
    ],
  },
];

const SEED: Transfer[] = SEED_BASE.map((r) => ({ ...r, ...tagsForLocation(r.from) }));

type ActionMode = "receive" | "return";

// ── Bridge: convert workflow-store WfTransferNote (e.g. MRP-generated) into
// the local Transfer shape so they show up in this module's tabs.
function wfTransferNoteToTransfer(wf: WfTransferNote): Transfer {
  const isMrp = wf.demandRef?.startsWith("MRP-");
  const lines: TransferLine[] = wf.items.map((it, i) => ({
    id: `${wf.id}-L${i + 1}`,
    item: it.name,
    uom: it.uom,
    requestedQty: it.qty,
    transferredQty: wf.status === "Issued" ? it.qty : 0,
  }));
  const statusMap: Record<string, TransferStatus> = {
    "Pending": "Pending",
    "Issued": "Completed",
  };
  return {
    id: wf.id,
    date: wf.date,
    trRef: isMrp ? wf.demandRef : "Direct Transfer",
    from: wf.from,
    to: wf.to,
    issuedBy: wf.issuedBy,
    receivedBy: wf.status === "Issued" ? "(acknowledged)" : "—",
    lines,
    status: statusMap[wf.status] ?? "Pending",
    kind: "Outbound",
    officeId: wf.officeId ?? "OFF-001",
    warehouseId: wf.warehouseId ?? "WH-001",
  };
}

// Dispatch-originated transfer notes (grnRef "Dispatch") are materialized into
// the local, mutable rows instead of bridged read-only. A dispatched sheet has
// physically left, so it enters as outbound "In Transit" (fully shipped): it is
// listed as data on the Transfer Out tab and received on the In Transit tab.
function wfDispatchNoteToTransfer(wf: WfTransferNote): Transfer {
  return {
    id: wf.id,
    date: wf.date,
    trRef: wf.demandRef,            // originating dispatch id (DSP-XXXX)
    from: wf.from,
    to: wf.to,
    issuedBy: wf.issuedBy,
    receivedBy: "—",
    lines: wf.items.map((it, i) => ({
      id: `${wf.id}-L${i + 1}`,
      item: it.name,
      uom: it.uom,
      requestedQty: it.qty,
      transferredQty: it.qty,
    })),
    status: "In Transit",
    kind: "Outbound",
    officeId: wf.officeId ?? "OFF-001",
    warehouseId: wf.warehouseId ?? "WH-001",
    dispatchRef: wf.demandRef,
    dispatchStatus: "Dispatched",
  };
}

// A dispatch that has been "Received by Airport" (receivedAt set) becomes an
// In-Transit transfer awaiting receipt into store — so it lists on the Transfer
// In Transit tab and can be received / returned with the existing flow.
function dispatchEntryToTransfer(e: DispatchEntry): Transfer {
  const route = flightLabel(e.flightId);           // "BS-141 — DAC-CXB"
  const origin = route.includes("—") ? route.split("—")[1].trim().split("-")[0] : "Catering Point";
  return {
    id: `TRF-DM-${e.id}`,
    date: e.receivedAt || e.packagingDate,
    trRef: e.dispatchNo || "Dispatch",
    from: `${route.split("—")[0].trim()} · ${origin} Airport`,
    to: "Cold Kitchen",
    issuedBy: e.checkedByApt || "—",
    receivedBy: "—",
    lines: e.mealLines.map((l, i) => ({
      id: `TRF-DM-${e.id}-L${i + 1}`,
      item: `${l.type} Meal`,
      uom: "Tray",
      requestedQty: Number(l.qty) || 0,
      transferredQty: Number(l.qty) || 0,
    })),
    status: "In Transit",
    kind: "Outbound",
    officeId: "OFF-001",
    warehouseId: "WH-001",
  };
}

export default function TransferPage() {
  useArrivalFlash();
  const { transferNotes, applyStockDeltas } = useWorkflow();
  const [rows, setRows] = usePersistedState<Transfer[]>("transfer-rows", SEED);
  // Same persisted store the Dispatch page uses — so writing "Returned" back onto
  // a dispatch record is reflected there too (read on its next mount).
  const [, setDispatchRecords] = usePersistedState<DispatchRecord[]>("dispatch-records", DISPATCH_RECORDS);
  const setDispatchStatus = (
    dspId: string,
    status: DispatchStatus,
    returnedLines?: { meal: string; qty: number; uom?: string; flight?: string }[],
  ) =>
    setDispatchRecords((prev) =>
      prev.map((d) => (d.id === dspId ? { ...d, status, ...(returnedLines ? { returnedLines } : {}) } : d)),
    );
  const [view, setView] = useState<"list" | "create">("list");
  const [actionTransfer, setActionTransfer] = useState<Transfer | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode>("receive");
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  // Guides the user after a receipt: the "Transfer In / Received" tab badge
  // blinks until that tab is opened. Purely a navigation cue — no logic change.
  const [blinkReceived, setBlinkReceived] = useState(false);

  // Dispatch-originated notes are materialized into the local mutable rows once
  // (so they can be sent/received), rather than shown as read-only bridged rows.
  useEffect(() => {
    const dispatchNotes = transferNotes.filter((n) => n.grnRef === "Dispatch");
    if (dispatchNotes.length === 0) return;
    setRows((prev) => {
      const have = new Set(prev.map((r) => r.id));
      const toAdd = dispatchNotes.filter((n) => !have.has(n.id)).map(wfDispatchNoteToTransfer);
      return toAdd.length ? [...toAdd, ...prev] : prev;
    });
  }, [transferNotes, setRows]);

  // Dispatches already "Received by Airport" are materialized once as In-Transit
  // transfers so they list on the Transfer In Transit tab for receipt into store.
  useEffect(() => {
    const receivedAtAirport = loadDispatchEntries().filter((e) => e.receivedAt);
    if (receivedAtAirport.length === 0) return;
    setRows((prev) => {
      const have = new Set(prev.map((r) => r.id));
      const toAdd = receivedAtAirport.map(dispatchEntryToTransfer).filter((t) => !have.has(t.id));
      return toAdd.length ? [...toAdd, ...prev] : prev;
    });
  }, [setRows]);

  // Workflow-store transfer notes (MRP, item-issue allocations, etc.) bridged
  // in for display. Dispatch notes are excluded — they're materialized above.
  // De-dupe against local Transfer ids.
  const bridged: Transfer[] = transferNotes
    .filter((n) => n.grnRef !== "Dispatch")
    .map(wfTransferNoteToTransfer);
  const localIds = new Set(rows.map((r) => r.id));
  const combined = [
    ...bridged.filter((b) => !localIds.has(b.id)),
    ...rows,
  ];

  const filtered = combined.filter((r) => {
    if (filterOffice && r.officeId !== filterOffice) return false;
    if (filterWarehouse && r.warehouseId !== filterWarehouse) return false;
    return true;
  });

  const add = (t: Transfer) => {
    // A regular outbound transfer that has physically shipped (In Transit) or
    // been received (Completed) removes stock from the source store. Dispatch-
    // linked (DSP-) transfers are finished meals handled via stock deltas, and a
    // still-Pending transfer hasn't left yet — neither deducts here.
    if (t.kind === "Outbound" && !dispatchIdOf(t) && (t.status === "In Transit" || t.status === "Completed")) {
      for (const l of t.lines) applyInventoryStock(l.item, -l.transferredQty);
    }
    setRows((p) => [t, ...p]);
    setView("list");
  };

  const openAction = (id: string, mode: ActionMode) => {
    const t = rows.find((r) => r.id === id);
    if (!t) return;
    setActionMode(mode);
    setActionTransfer(t);
  };

  const closeAction = () => setActionTransfer(null);

  const applyReceive = (id: string, qty: Record<string, number>) => {
    const target = rows.find((r) => r.id === id);
    if (!target) { closeAction(); return; }

    // Per-line accepted (clamped to what's in transit) and what remains in transit.
    const split = target.lines.map((l) => {
      const received = Math.max(0, Math.min(l.transferredQty, qty[l.id] ?? l.transferredQty));
      return { line: l, received, remaining: roundQty(l.transferredQty - received) };
    });
    const totalReceived = split.reduce((s, x) => s + x.received, 0);
    const totalRemaining = split.reduce((s, x) => s + x.remaining, 0);
    if (totalReceived <= 0) { toast.error("Enter a quantity to receive."); return; }

    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    // The accepted portion becomes a Completed (Received) record.
    const receivedLines: TransferLine[] = split
      .filter((x) => x.received > 0)
      .map((x) => ({ ...x.line, requestedQty: x.received, transferredQty: x.received }));

    setRows((prev) => {
      if (totalRemaining <= 0) {
        // Fully received — the original record itself becomes Completed.
        return prev.map((r) =>
          r.id === id
            ? { ...r, status: "Completed", date: now, lines: receivedLines,
                receivedBy: r.receivedBy === "—" ? "(received)" : r.receivedBy }
            : r);
      }
      // Partial — the original keeps its id and stays In Transit holding only the
      // remaining (un-received) quantity, so it isn't lost; the accepted portion
      // is split out as a separate Completed record.
      const remainingRec: Transfer = {
        ...target,
        status: "In Transit",
        lines: split
          .filter((x) => x.remaining > 0)
          .map((x) => ({ ...x.line, requestedQty: x.remaining, transferredQty: x.remaining })),
      };
      const receivedRec: Transfer = {
        ...target,
        id: `${target.id}-RCV-${now.replace(/[^0-9]/g, "").slice(-6)}`,
        date: now,
        status: "Completed",
        receivedBy: target.receivedBy === "—" ? "(received)" : target.receivedBy,
        lines: receivedLines,
      };
      return prev.flatMap((r) => (r.id === id ? [remainingRec, receivedRec] : [r]));
    });

    // Close the inventory loop for dispatch-originated transfers (trRef = the
    // DSP-XXXX id): the accepted meals land in the destination warehouse as an
    // inbound stock movement, netting against the negative delta the dispatch
    // posted at the source. Partial receipts post only what was accepted; the
    // remainder posts when it's received later. Regular transfers are untouched.
    if (target.trRef.startsWith("DSP-")) {
      const dest = tagsForLocation(target.to);
      const deltas: StockDelta[] = split
        .filter((x) => x.received > 0)
        .map((x) => ({
          itemId: x.line.item,
          delta: x.received,
          date: now,
          reference: id,
          officeId: dest.officeId,
          warehouseId: dest.warehouseId,
          label: "Transfer In",
        }));
      if (deltas.length > 0) applyStockDeltas(deltas);
    }

    toast.success(
      totalRemaining > 0
        ? `${id} — ${totalReceived} received; ${totalRemaining} still in transit.`
        : `${id} received — ${totalReceived} unit${totalReceived === 1 ? "" : "s"} accepted.`,
    );
    // Nudge the user toward the received items (now eligible for galley planning).
    setBlinkReceived(true);
    closeAction();
  };

  const applyReturn = (id: string, qty: Record<string, number>, reason: string) => {
    const target = rows.find((r) => r.id === id);
    if (!target) { closeAction(); return; }
    const total = Object.values(qty).reduce((s, n) => s + (Number(n) || 0), 0);
    if (total <= 0) {
      toast.error("Enter a quantity to return on at least one line.");
      return;
    }
    const dspId = dispatchIdOf(target);
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const returnLines: TransferLine[] = target.lines
      .filter((l) => (qty[l.id] ?? 0) > 0)
      .map((l) => ({
        id: l.id,
        item: l.item,
        uom: l.uom,
        requestedQty: Math.min(l.transferredQty, qty[l.id]),
        transferredQty: 0,
      }));
    const newId = `TRF-${String(8000 + rows.length + 1)}`;
    const returnTags = tagsForLocation(target.to);
    const ret: Transfer = {
      id: newId,
      date: now,
      trRef: `Return of ${target.id}${reason.trim() ? ` — ${reason.trim()}` : ""}`,
      from: target.to,
      to: target.from,
      issuedBy: target.receivedBy === "—" ? "(destination)" : target.receivedBy,
      receivedBy: "—",
      lines: returnLines,
      status: "Pending",
      kind: "Return",
      officeId: returnTags.officeId,
      warehouseId: returnTags.warehouseId,
      // Preserve the dispatch link so the return can be re-dispatched, and stamp
      // the "Returned" dispatch status onto the return entry itself.
      dispatchRef: dspId,
      dispatchStatus: dspId ? "Returned" : undefined,
    };
    const totalInHand = target.lines.reduce((s, l) => s + l.transferredQty, 0);
    const fullyReturned = total >= totalInHand;
    setRows((prev) => {
      const updated = prev.map((r) => {
        if (r.id !== id) return r;
        // Dispatch-linked transfer: it STAYS "In Transit" — only the returned
        // quantity peels off (that portion comes back for re-dispatch through the
        // usual packaging → QC → dispatch flow). The remaining load keeps moving.
        if (dspId) {
          return {
            ...r,
            status: "In Transit" as TransferStatus,
            lines: r.lines.map((l) => ({ ...l, transferredQty: Math.max(0, l.transferredQty - (qty[l.id] ?? 0)) })),
            receivedBy: r.receivedBy === "—" ? "(received)" : r.receivedBy,
            dispatchStatus: "Returned" as TransferDispatchStatus,
          };
        }
        // Regular transfer: full return → Rejected, partial → Completed.
        return {
          ...r,
          status: (fullyReturned ? "Rejected" : "Completed") as TransferStatus,
          lines: fullyReturned
            ? r.lines
            : r.lines.map((l) => ({ ...l, transferredQty: l.transferredQty - (qty[l.id] ?? 0) })),
          receivedBy: r.receivedBy === "—" ? "(received)" : r.receivedBy,
        };
      });
      return [ret, ...updated];
    });
    // Reflect the return on the linked dispatch record (Dispatch page shows
    // "Returned") and carry the returned lines/quantities so the Dispatch page
    // re-dispatches ONLY this returned load, not the whole original dispatch.
    if (dspId) {
      const returnedLines = returnLines.map((l) => ({ meal: l.item, qty: l.requestedQty, uom: l.uom }));
      setDispatchStatus(dspId, "Returned", returnedLines);
    } else {
      // Regular transfer: the returned goods land back in the source store, so
      // credit the returned quantity to its on-hand balance (mirrors the deduct
      // that happened when the transfer shipped).
      for (const l of returnLines) applyInventoryStock(l.item, l.requestedQty);
    }
    toast.success(
      dspId
        ? `${total} unit${total === 1 ? "" : "s"} returned — ${id} stays In Transit; dispatch ${dspId} flagged Returned. Re-dispatch restarts packaging → QC → dispatch.`
        : fullyReturned
        ? `${id} rejected — return ${newId} created.`
        : `Partial return ${newId} created. ${id} kept ${totalInHand - total} unit${(totalInHand - total) === 1 ? "" : "s"}.`,
    );
    closeAction();
  };

  const pending = combined.filter((r) => r.status === "Pending").length;
  const inTransit = combined.filter((r) => r.status === "In Transit").length;
  const completed = combined.filter((r) => r.status === "Completed").length;

  return (
    <>
      <PageHeader
        title="Transfer"
        subtitle="Execute approved transfers — move items physically between locations and track receipt"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create" ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back</> : <><Plus className="h-4 w-4 mr-1" /> New Transfer</>}
          </Button>
        }
      />

      {view === "list" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Total Transfers" value={combined.length} icon={MoveRight} tone="navy" />
            <KpiCard label="Pending" value={pending} icon={Clock} tone="warning" />
            <KpiCard label="In Transit" value={inTransit} icon={Truck} tone="navy" />
            <KpiCard label="Completed" value={completed} icon={CheckCircle} tone="success" />
          </div>
          <div className="mb-4">
            <LocationFilter
              officeId={filterOffice}
              warehouseId={filterWarehouse}
              onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
            />
          </div>
          <TransferTabs
            data={filtered}
            onReceive={(id) => openAction(id, "receive")}
            onReturn={(id) => openAction(id, "return")}
            editors={rowEditors(setRows)}
            blinkReceived={blinkReceived}
            onClearBlink={() => setBlinkReceived(false)}
          />
        </>
      ) : (
        <TransferCreate nextId={`TRF-${String(8000 + rows.length + 1)}`} onSave={add} />
      )}

      <TransferActionDialog
        key={actionTransfer?.id ?? "none"}
        transfer={actionTransfer}
        mode={actionMode}
        onClose={closeAction}
        onReceive={applyReceive}
        onReturn={applyReturn}
      />
    </>
  );
}

function TransferActionDialog({
  transfer, mode, onClose, onReceive, onReturn,
}: {
  transfer: Transfer | null;
  mode: ActionMode;
  onClose: () => void;
  onReceive: (id: string, qty: Record<string, number>) => void;
  onReturn: (id: string, qty: Record<string, number>, reason: string) => void;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!transfer) return;
    const seed: Record<string, number> = {};
    transfer.lines.forEach((l) => {
      // Receive defaults to full transferred qty (accept-as-shipped).
      // Return defaults to 0 (nothing returned) — user explicitly picks.
      seed[l.id] = mode === "receive" ? l.transferredQty : 0;
    });
    setQty(seed);
    setReason("");
  }, [transfer, mode]);

  if (!transfer) return null;

  const totalInHand = transfer.lines.reduce((s, l) => s + l.transferredQty, 0);
  const totalSelected = transfer.lines.reduce((s, l) => s + (qty[l.id] ?? 0), 0);
  const allSelected = transfer.lines.every((l) => (qty[l.id] ?? 0) === l.transferredQty);
  const noneSelected = totalSelected === 0;

  const setAll = (kind: "all" | "none") => {
    const next: Record<string, number> = {};
    transfer.lines.forEach((l) => {
      next[l.id] = kind === "all" ? l.transferredQty : 0;
    });
    setQty(next);
  };

  const isReceive = mode === "receive";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isReceive ? (
              <><CheckCircle className="h-4 w-4 text-success" /> Receive Transfer</>
            ) : (
              <><Undo2 className="h-4 w-4 text-navy" /> Return Items</>
            )}
            <span className="font-mono text-sm text-muted-foreground">— {transfer.id}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="font-medium text-foreground">
                {isReceive ? transfer.from : transfer.to}
              </span>
              <MoveRight className="h-3 w-3" />
              <span className="font-medium text-foreground">
                {isReceive ? transfer.to : transfer.from}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAll("all")}>
                Select All
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAll("none")}>
                Clear
              </Button>
            </div>
          </div>

          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-10 text-[10px] uppercase tracking-wider">SL</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Item</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider w-16">UoM</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-right w-24">
                    {isReceive ? "Shipped" : "In Hand"}
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-right w-32">
                    {isReceive ? "Receive Qty" : "Return Qty"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfer.lines.map((l, i) => {
                  const max = l.transferredQty;
                  const value = qty[l.id] ?? 0;
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{l.item}</TableCell>
                      <TableCell>{l.uom}</TableCell>
                      <TableCell className="text-right tabular-nums">{max}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          max={max}
                          value={value}
                          onChange={(e) => {
                            const n = Math.max(0, Math.min(max, Number(e.target.value) || 0));
                            setQty((prev) => ({ ...prev, [l.id]: n }));
                          }}
                          className="h-8 w-24 ml-auto text-right tabular-nums"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {!isReceive && (
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Reason (optional)
              </Label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="e.g. Damaged in transit, expired, wrong item"
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          )}

          <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Total {isReceive ? "received" : "to return"}
            </span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {totalSelected}
              <span className="text-muted-foreground font-normal ml-1">/ {totalInHand}</span>
            </span>
          </div>

          {!isReceive && totalSelected > 0 && totalSelected < totalInHand && (
            <div className="text-[11px] text-warning">
              Partial return — {totalInHand - totalSelected} unit{(totalInHand - totalSelected) === 1 ? "" : "s"} will stay at {transfer.to} and the original transfer closes as Completed.
            </div>
          )}
          {!isReceive && totalSelected >= totalInHand && totalSelected > 0 && (
            <div className="text-[11px] text-destructive">
              Full return — the original transfer will be marked Rejected.
            </div>
          )}
          {isReceive && !allSelected && totalSelected > 0 && (
            <div className="text-[11px] text-warning">
              Short receipt — {totalInHand - totalSelected} unit{(totalInHand - totalSelected) === 1 ? "" : "s"} will be recorded as not received. Create a Return separately for any damaged stock.
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {isReceive ? (
            <Button onClick={() => onReceive(transfer.id, qty)} disabled={noneSelected}>
              <CheckCircle className="h-4 w-4 mr-1.5" /> Confirm Receive
            </Button>
          ) : (
            <Button onClick={() => onReturn(transfer.id, qty, reason)} disabled={noneSelected}>
              <Undo2 className="h-4 w-4 mr-1.5" /> Create Return
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TAB_PILL_CLS =
  "text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 pb-3 gap-2";

function TabCount({ n, tone, blink }: { n: number; tone: "warning" | "navy" | "success" | "muted"; blink?: boolean }) {
  if (n === 0) return null;
  const cls =
    tone === "warning" ? "border-warning/40 bg-warning/10 text-warning" :
    tone === "navy"    ? "border-navy/40 bg-navy/10 text-navy" :
    tone === "success" ? "border-success/40 bg-success/10 text-success" :
    "border-border bg-muted/40 text-muted-foreground";
  return (
    <Badge
      variant="outline"
      className={`h-5 px-1.5 text-[10px] tabular-nums ${cls} ${blink ? "ring-2 ring-success/50 border-success/70 font-bold" : ""}`}
      style={blink ? { animation: "transfer-received-blink 0.9s ease-in-out infinite" } : undefined}
    >
      {n}
    </Badge>
  );
}

function TransferTabs({
  data, onReceive, onReturn, editors, blinkReceived, onClearBlink,
}: {
  data: Transfer[];
  onReceive: (id: string) => void;
  onReturn: (id: string) => void;
  editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void };
  /** When true, blink the "Transfer In / Received" tab badge until it's opened. */
  blinkReceived: boolean;
  onClearBlink: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  // A dispatch row's "Receive Items" shortcut lands here asking to open the
  // Transfer In Transit tab and blink the rows waiting to be received.
  const wantReceive = (location.state as { receiveInTransit?: boolean } | null)?.receiveInTransit === true;
  const [tab, setTab] = useState(wantReceive ? "transit" : "out");
  // Opening the received tab is what the blink is nudging toward — clear it then.
  const changeTab = (v: string) => { setTab(v); if (v === "received") onClearBlink(); };

  // Blink the In Transit rows once when arrived via "Receive Items". The Ant
  // rows mount a tick after the tab activates, so retry briefly until found.
  const blinkedRef = useRef(false);
  useEffect(() => {
    if (!wantReceive || blinkedRef.current || tab !== "transit") return;
    let done = false;
    const paint = () => {
      if (done) return;
      const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-arrival-row-id]"));
      if (rows.length === 0) return;
      done = true;
      blinkedRef.current = true;
      rows.forEach((el) => { el.classList.remove("arrival-row-flash"); void el.offsetWidth; el.classList.add("arrival-row-flash"); });
      rows[0].scrollIntoView({ behavior: "smooth", block: "center" });
    };
    const timers = [60, 200, 500, 900].map((d) => setTimeout(paint, d));
    const clear = setTimeout(() => {
      document.querySelectorAll(".arrival-row-flash").forEach((el) => el.classList.remove("arrival-row-flash"));
    }, 4600);
    return () => { timers.forEach(clearTimeout); clearTimeout(clear); };
  }, [wantReceive, tab]);

  // Transfer Out lists every active outbound transfer (pending or shipped) as a
  // data log with the quantity breakdown — receipt happens on the In Transit tab.
  const transferOut    = data.filter((r) => r.kind === "Outbound" && (r.status === "Pending" || r.status === "In Transit"));
  const inTransit      = data.filter((r) => r.status === "In Transit");
  const returns        = data.filter((r) => r.kind === "Return");
  const received       = data.filter((r) => r.kind === "Outbound" && r.status === "Completed");

  return (
    <Tabs value={tab} onValueChange={changeTab} className="space-y-4" data-arrival-id="transfer-list">
      {/* Blink keyframes for the received-tab badge cue. */}
      <style>{`@keyframes transfer-received-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.15; } }`}</style>

      {/* Instructional flow guide — how a transfer reaches galley loading. */}
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <Info className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="font-semibold text-foreground">How receiving works:</span>
        <span className="inline-flex items-center gap-1">Open <span className="font-medium text-navy">Transfer In Transit</span></span>
        <ArrowRight className="h-3 w-3 shrink-0" />
        <span className="inline-flex items-center gap-1">click <span className="font-medium text-success">Receive</span></span>
        <ArrowRight className="h-3 w-3 shrink-0" />
        <span className="inline-flex items-center gap-1">it moves to <span className="font-medium text-success">Transfer In / Received</span></span>
        <ArrowRight className="h-3 w-3 shrink-0" />
        <span className="inline-flex items-center gap-1">then <span className="font-medium text-primary">Galley Plan</span> for loading</span>
      </div>

      <TabsList className="h-auto bg-transparent p-0 border-b border-border w-full justify-start rounded-none">
        <TabsTrigger value="out"        className={TAB_PILL_CLS}>
          Transfer Out
          <TabCount n={transferOut.length} tone="warning" />
        </TabsTrigger>
        <TabsTrigger value="transit"    className={TAB_PILL_CLS}>
          Transfer In Transit
          <TabCount n={inTransit.length} tone="navy" />
        </TabsTrigger>
        <TabsTrigger value="return"     className={TAB_PILL_CLS}>
          Return List
          <TabCount n={returns.length} tone="muted" />
        </TabsTrigger>
        <TabsTrigger value="received"   className={TAB_PILL_CLS}>
          Transfer In / Received
          <TabCount n={received.length} tone="success" blink={blinkReceived} />
        </TabsTrigger>
      </TabsList>

      <TabsContent value="out"      className="mt-0"><TransferList data={transferOut} qtyBreakdown noActions emptyHint="No outgoing transfers." editors={editors} /></TabsContent>
      <TabsContent value="transit"  className="mt-0">
        <TransferList
          data={inTransit}
          emptyHint="No transfers currently in transit."
          onReceive={onReceive}
          onReturn={onReturn}
          editors={editors}
        />
      </TabsContent>
      <TabsContent value="return"   className="mt-0"><TransferList data={returns}     emptyHint="No return transfers recorded." editors={editors} /></TabsContent>
      <TabsContent value="received" className="mt-0 space-y-3">
        {/* Note in the marked place — received items are galley-planning eligible. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/[0.04] px-4 py-2.5">
          <div className="flex items-start gap-2 min-w-0">
            <LayoutGrid className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-xs">
              <span className="font-semibold text-foreground">Go to Galley Plan for galley loading.</span>{" "}
              <span className="text-muted-foreground">Only <span className="font-medium text-foreground">Transfer In / Received</span> items are eligible for galley planning.</span>
            </div>
          </div>
          <Button
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={() => navigate("/galley-planning")}
          >
            <LayoutGrid className="h-3.5 w-3.5 mr-1.5" /> Go to Galley Plan
          </Button>
        </div>
        <TransferList
          data={received}
          emptyHint="No received transfers yet."
          editors={editors}
        />
      </TabsContent>
    </Tabs>
  );
}

// Rich read-only detail for the row View modal — replaces the generic field
// dump so the line items (with quantities) are shown rather than "N items".
function TransferDetail({ t }: { t: Transfer }) {
  const field = (label: string, value: ReactNode) => (
    <div className="rounded-lg border border-border px-3 py-2 bg-muted/30">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5 break-words">{value || "—"}</div>
    </div>
  );
  const totalReq = t.lines.reduce((s, l) => s + l.requestedQty, 0);
  const totalTrf = t.lines.reduce((s, l) => s + l.transferredQty, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field("Transfer #", t.id)}
        {field("Date", t.date)}
        {field("TR Ref", t.trRef)}
        {field("Kind", t.kind)}
        {field("Route", <span className="inline-flex items-center gap-1.5">{t.from}<MoveRight className="h-3 w-3 text-muted-foreground" />{t.to}</span>)}
        {field("Status", t.status)}
        {field("Issued By", t.issuedBy)}
        {field("Received By", t.receivedBy)}
        {field("Office / Warehouse", <LocationCell officeId={t.officeId} warehouseId={t.warehouseId} />)}
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Items ({t.lines.length})</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>UoM</TableHead>
              <TableHead className="text-right">Requested</TableHead>
              <TableHead className="text-right">Transferred</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.item}</TableCell>
                <TableCell>{l.uom}</TableCell>
                <TableCell className="text-right tabular-nums">{l.requestedQty}</TableCell>
                <TableCell className="text-right tabular-nums">{l.transferredQty}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums font-semibold">{totalReq}</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{totalTrf}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function TransferList({
  data, emptyHint, qtyBreakdown, noActions, onReceive, onReturn, editors, onGoToTransit,
}: {
  data: Transfer[];
  emptyHint?: string;
  /** Transfer Out: show Total / Received / Return / In Transit quantity columns
   *  instead of the compact Items column. */
  qtyBreakdown?: boolean;
  /** Render the list as a read-only data log (no Actions column). */
  noActions?: boolean;
  onReceive?: (id: string) => void;
  onReturn?: (id: string) => void;
  editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void };
  /** When set, each row shows a shortcut button to the Transfer In Transit tab
   *  (where transfers are received). Navigation only — no data change. */
  onGoToTransit?: () => void;
}) {
  const sumReq = (r: Transfer) => r.lines.reduce((s, l) => s + l.requestedQty, 0);
  const sumDone = (r: Transfer) => r.lines.reduce((s, l) => s + l.transferredQty, 0);
  const num = (n: number) => <span className="text-xs tabular-nums">{n.toFixed(2)}</span>;
  const qtyCols: Column<Transfer>[] = [
    { key: "totalQty",     header: "Total Qty",     sortable: false, render: (r) => num(sumReq(r)) },
    { key: "receivedQty",  header: "Received Qty",  sortable: false, render: (r) => num(r.status === "Completed" ? sumDone(r) : 0) },
    { key: "returnQty",    header: "Return Qty",    sortable: false, render: (r) => num(r.kind === "Return" ? sumReq(r) : 0) },
    { key: "inTransitQty", header: "In Transit Qty", sortable: false, render: (r) => num(r.status === "In Transit" ? sumDone(r) : 0) },
  ];
  const itemsCol: Column<Transfer> = {
    key: "lines",
    header: "Items",
    className: "text-right",
    render: (r) => {
      const totalReq = r.lines.reduce((s, l) => s + l.requestedQty, 0);
      const totalDone = r.lines.reduce((s, l) => s + l.transferredQty, 0);
      return (
        <span className="text-xs tabular-nums">
          {totalDone}/{totalReq}{" "}
          <span className="text-muted-foreground">({r.lines.length} item{r.lines.length > 1 ? "s" : ""})</span>
        </span>
      );
    },
  };
  const cols: Column<Transfer>[] = [
    {
      key: "id",
      header: "TRF #",
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <span>{r.id}</span>
          {r.kind === "Return" && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-navy/30 bg-navy/5 text-navy gap-1">
              <Undo2 className="h-3 w-3" /> Return
            </Badge>
          )}
        </div>
      ),
    },
    { key: "date", header: "Date", render: (r) => <span className="tabular-nums text-xs">{r.date}</span> },
    {
      key: "officeId", header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    {
      key: "trRef",
      header: "TR Ref",
      render: (r) =>
        r.trRef === "Direct Transfer" || r.trRef === "Return" ? (
          <span className="text-xs text-muted-foreground italic">{r.trRef}</span>
        ) : (
          <span className="font-mono text-xs">{r.trRef}</span>
        ),
    },
    {
      key: "from",
      header: "Route",
      render: (r) => (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-medium">{r.from}</span>
          <MoveRight className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">{r.to}</span>
        </div>
      ),
    },
    { key: "issuedBy", header: "Issued By" },
    { key: "receivedBy", header: "Received By" },
    {
      key: "dispatchStatus", header: "Dispatch Status", sortable: false,
      render: (r) => r.dispatchStatus
        ? <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${dispatchStatusCls(r.dispatchStatus)}`}>{r.dispatchStatus}</Badge>
        : <span className="text-muted-foreground text-xs">—</span>,
    },
    ...(qtyBreakdown ? qtyCols : [itemsCol]),
  ];
  if (data.length === 0 && emptyHint) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {emptyHint}
        </CardContent>
      </Card>
    );
  }
  return (
    <DataTable
      title="transfers"
      data={data}
      columns={cols}
      searchKeys={["id", "trRef", "from", "to", "issuedBy", "receivedBy", "status"]}
      selectable={false}
      actions={noActions ? undefined : (r) => {
        if (onReceive && onReturn && r.status === "In Transit") {
          return (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs border-success/40 text-success hover:bg-success/10 hover:text-success"
                onClick={() => onReceive(r.id)}
              >
                <CheckCircle className="h-3 w-3 mr-1" /> Receive
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs border-navy/40 text-navy hover:bg-navy/10 hover:text-navy"
                onClick={() => onReturn(r.id)}
              >
                <Undo2 className="h-3 w-3 mr-1" /> Return
              </Button>
            </div>
          );
        }
        // Re-dispatch of a returned load is initiated on the Dispatch page (the
        // returned dispatch record), where it re-runs the full packaging → QC →
        // dispatch process — so it's intentionally not offered here.
        return (
          <div className="flex items-center gap-1.5">
            {onGoToTransit && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs border-navy/40 text-navy hover:bg-navy/10 hover:text-navy"
                onClick={onGoToTransit}
                title="Receive transfers on the Transfer In Transit tab"
              >
                <Truck className="h-3 w-3 mr-1" /> In Transit
              </Button>
            )}
            <RowActions
              row={r}
              actions={["view", "edit", "print"]}
              detail={<TransferDetail t={r} />}
              onSave={editors.onSave}
              editDetail={({ save, close }) => <TransferFields mode="edit" initial={r} onSubmit={save} onClose={close} />}
            />
          </div>
        );
      }}
    />
  );
}

function TransferCreate({ nextId, onSave }: { nextId: string; onSave: (t: Transfer) => void }) {
  return <TransferFields mode="create" nextId={nextId} onSave={onSave} />;
}

/**
 * Shared Transfer form. Used by the Create page (mode="create") and the row
 * Edit modal (mode="edit", pre-filled from `initial`) so both share an
 * identical layout including the dynamic line table.
 */
function TransferFields({
  mode, nextId, initial, onSave, onSubmit, onClose,
}: {
  mode: "create" | "edit";
  nextId?: string;
  initial?: Transfer;
  onSave?: (t: Transfer) => void;
  onSubmit?: (patch: Record<string, unknown>) => void;
  onClose?: () => void;
}) {
  const isEdit = mode === "edit";
  const today = new Date().toISOString().slice(0, 16).replace("T", " ");
  const [kind, setKind] = useState<TransferKind>(initial?.kind ?? "Outbound");
  const [trRef, setTrRef] = useState(initial?.trRef ?? APPROVED_TR_REFS[0]);
  const [from, setFrom] = useState(initial?.from ?? LOCATIONS[0]);
  const [to, setTo] = useState(initial?.to ?? LOCATIONS[1]);
  const [issuedBy, setIssuedBy] = useState(initial?.issuedBy ?? "");
  const [receivedBy, setReceivedBy] = useState(initial?.receivedBy ?? "");

  const [itemIdx, setItemIdx] = useState(0);
  const [reqQty, setReqQty] = useState("");
  const [trfQty, setTrfQty] = useState("");
  const [lines, setLines] = useState<TransferLine[]>(initial?.lines ?? []);

  const addLine = () => {
    const it = ITEMS[itemIdx];
    const rq = Number(reqQty);
    const tq = Number(trfQty);
    if (!rq || rq <= 0) { toast.error("Requested quantity is required."); return; }
    if (tq < 0) { toast.error("Transferred quantity cannot be negative."); return; }
    if (tq > rq) { toast.error("Transferred quantity cannot exceed requested."); return; }
    if (lines.some((l) => l.item === it.name)) { toast.error(`${it.name} is already added.`); return; }
    setLines((prev) => [
      ...prev,
      { id: `L-${Date.now()}`, item: it.name, uom: it.uom, requestedQty: rq, transferredQty: tq },
    ]);
    setReqQty(""); setTrfQty("");
  };

  const removeLine = (id: string) => setLines((p) => p.filter((l) => l.id !== id));

  const validate = (status?: TransferStatus) => {
    if (from === to) { toast.error("Source and destination must be different."); return false; }
    if (!issuedBy.trim()) { toast.error("Issued By is required."); return false; }
    if (lines.length === 0) { toast.error("Add at least one item."); return false; }

    const fullyTransferred = lines.every((l) => l.transferredQty === l.requestedQty);
    if (status === "Completed" && !fullyTransferred) {
      toast.error("Cannot mark Completed — some lines are short-transferred.");
      return false;
    }
    return true;
  };

  const buildPayload = () => {
    const tags = tagsForLocation(from);
    return {
      date: today, trRef: kind === "Return" ? "Return" : trRef,
      from, to,
      issuedBy: issuedBy.trim(), receivedBy: receivedBy.trim() || "—",
      lines, kind,
      ...tags,
    };
  };

  const save = (status: TransferStatus) => {
    if (!validate(status)) return;
    onSave?.({ id: nextId!, ...buildPayload(), status });
    toast.success(`Transfer ${nextId} saved as "${status}".`);
  };

  const saveEdit = () => {
    if (!validate(initial?.status)) return;
    onSubmit?.(buildPayload());
    onClose?.();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          {!isEdit && (
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider">Transfer Details</h3>
            <div className="flex items-center gap-2">
              <Button onClick={() => save("Pending")}>
                <Save className="h-4 w-4 mr-1.5" /> Save
              </Button>
            </div>
          </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">TRF #</Label>
              <Input value={initial?.id ?? nextId ?? ""} disabled className="mt-1 font-mono" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
              <Input value={today} disabled className="mt-1 tabular-nums" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Transfer Kind</Label>
              <div className="mt-1 inline-flex rounded-md border border-input bg-background p-0.5 shadow-sm h-9 w-full">
                {(["Outbound", "Return"] as TransferKind[]).map((k) => {
                  const active = kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={
                        "flex-1 px-3 text-xs font-medium rounded-sm transition-colors " +
                        (active
                          ? k === "Return"
                            ? "bg-navy/10 text-navy"
                            : "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground")
                      }
                    >
                      {k === "Return" ? <Undo2 className="h-3.5 w-3.5 inline-block mr-1.5" /> : <MoveRight className="h-3.5 w-3.5 inline-block mr-1.5" />}
                      {k}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                {kind === "Return" ? "Returning Against" : "Transfer Request Ref"}
              </Label>
              <select
                value={trRef}
                onChange={(e) => setTrRef(e.target.value)}
                className={selectCls}
                disabled={kind === "Return"}
              >
                {kind === "Return"
                  ? <option>Return</option>
                  : APPROVED_TR_REFS.map((r) => <option key={r}>{r}</option>)}
              </select>
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
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Issued By <span className="text-destructive">*</span></Label>
              <Input value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} className="mt-1" placeholder="Store keeper / issuer" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Received By</Label>
              <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className="mt-1" placeholder="Acknowledged by destination" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-6">Items</h3>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item</Label>
              <select value={itemIdx} onChange={(e) => setItemIdx(Number(e.target.value))} className={selectCls}>
                {ITEMS.map((i, idx) => <option key={i.code} value={idx}>{i.code} — {i.name} ({i.uom})</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Requested <span className="text-destructive">*</span></Label>
              <Input type="number" min={0} value={reqQty} onChange={(e) => setReqQty(e.target.value)} className="mt-1 tabular-nums" />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Transferred</Label>
              <Input type="number" min={0} value={trfQty} onChange={(e) => setTrfQty(e.target.value)} className="mt-1 tabular-nums" />
            </div>
            <div className="md:col-span-3">
              <Button variant="outline" onClick={addLine} className="w-full">
                <Plus className="h-4 w-4 mr-1" /> Add Item
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
                  <TableHead className="text-xs uppercase tracking-wider text-right">Requested</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Transferred</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Short</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Allocation Lots (Source)</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                      No items added yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  lines.map((l, i) => {
                    const short = l.requestedQty - l.transferredQty;
                    const invMatch = inventory.find((iv) => iv.name === l.item);
                    const fefo = invMatch && l.transferredQty > 0
                      ? allocateFefo(invMatch.id, l.transferredQty)
                      : null;
                    return (
                      <TableRow key={l.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium">{l.item}</TableCell>
                        <TableCell>{l.uom}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.requestedQty}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.transferredQty}</TableCell>
                        <TableCell className={`text-right tabular-nums ${short > 0 ? "text-warning-foreground font-medium" : ""}`}>
                          {short > 0 ? short : "—"}
                        </TableCell>
                        <TableCell className="text-[11px]">
                          {fefo === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="space-y-0.5">
                              <div className="text-[9px] uppercase tracking-wider font-bold mb-0.5">
                                <span className="px-1.5 py-0.5 rounded bg-primary/10 border border-primary/30 text-primary">{fefo.method}</span>
                              </div>
                              {fefo.allocations.map((a) => (
                                <div key={a.batchNo} className="font-mono">
                                  <span className="text-foreground">{a.batchNo}</span>
                                  <span className="text-muted-foreground"> · {a.expiry} · </span>
                                  <span className="font-semibold">{a.qty} {l.uom}</span>
                                </div>
                              ))}
                              {fefo.shortfall > 0 && (
                                <div className="text-destructive font-semibold">
                                  Shortfall: {fefo.shortfall} {l.uom}
                                </div>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => removeLine(l.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
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
