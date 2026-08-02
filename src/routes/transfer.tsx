import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
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
  LayoutGrid, Info, ArrowRight, Eye, CalendarDays,
} from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { toast } from "sonner";
import { activeItems, warehouses as ALL_WAREHOUSES, offices as ALL_OFFICES, activeOffices, activeWarehousesByOffice, inventory, allocateFefo } from "@/lib/sample-data";
import { getActiveStaff } from "@/lib/staff";
import { LocationPicker, LocationFilter, LocationCell } from "@/components/common/LocationPicker";
import { useWorkflow, type WfTransferNote, type StockDelta } from "@/lib/workflow-store";
import { applyInventoryStock, availableOf, blockedOf, type StoredLot } from "@/lib/stock-adjustments";
import { useArrivalFlash } from "@/lib/arrival-flash";
import { INITIAL_RECORDS as DISPATCH_RECORDS, type DispatchRecord, type DispatchStatus } from "@/routes/dispatch";
import { loadDispatchEntries, flightLabel, type DispatchEntry } from "@/routes/dispatch-monitoring";
import { TR_STORAGE_KEY, TR_SEED, type TransferRequest } from "@/routes/transfer-request";


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

// One logged action taken on an In-Transit transfer (Receive / Return). The row
// stays on the In Transit tab after the action; this log records what happened
// so the View dialog can show the full history.
type TransferAction = {
  type: "Receive" | "Return";
  qty: number;
  by: string;
  at: string;
  detail: string;
  reason?: string;
  /** Per-line quantity settled by this action (line id → qty). Lets a later
   *  partial receipt/return clamp to what is still on the road per line. */
  lineQty?: Record<string, number>;
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
  /** Destination office, fixed when the transfer is created. The specific To
   *  warehouse within it is chosen at receive time (In Transit), so `to` may be
   *  blank until then. */
  toOfficeId?: string;
  /** DSP-#### id when this transfer originated from a Dispatch (preserved
   *  through Return / Re-dispatch so the link survives). */
  dispatchRef?: string;
  /** Dispatch lifecycle for the badge — set only on dispatch-linked transfers. */
  dispatchStatus?: TransferDispatchStatus;
  /** Receive / Return actions logged against this transfer. The row is kept on
   *  the In Transit tab after an action; View surfaces this history. */
  actionLog?: TransferAction[];
  /** Set on a DISPLAY-ONLY placeholder row projected from an approved transfer
   *  request that has not been issued yet. Such a row lists on the Transfer Out
   *  tab with the Out/Issue action; it is never persisted or counted as a real
   *  transfer. Holds the source request id so Out/Issue can open it. */
  issueRequestId?: string;
};

/** The linked dispatch id for a transfer, if any (from an explicit dispatchRef
 *  or a DSP-prefixed TR ref). */
const dispatchIdOf = (t: Transfer): string | undefined =>
  t.dispatchRef ?? (t.trRef.startsWith("DSP-") ? t.trRef : undefined);

// ── In-transit remaining ─────────────────────────────────────────────────────
// A transfer stays on the In Transit tab while goods are still on the road. Each
// Receive / Return settles part (or all) of what shipped — both take quantity
// OUT of transit. So the quantity still in transit is what shipped minus every
// settled action; when that hits zero the transfer is fully accounted for and
// drops off the tab, and a partial receipt/return keeps it on with the balance.
/** Total quantity that physically shipped (sum of transferred line quantities). */
const shippedQty = (t: Transfer) => t.lines.reduce((s, l) => s + l.transferredQty, 0);
/** Quantity settled so far via logged Receive / Return actions. */
const settledQty = (t: Transfer) =>
  (t.actionLog ?? []).reduce((s, a) => s + (a.type === "Receive" || a.type === "Return" ? a.qty : 0), 0);
/** Quantity settled so far on ONE line, across every logged action. */
const settledForLine = (t: Transfer, lineId: string) =>
  (t.actionLog ?? []).reduce((s, a) => s + (a.lineQty?.[lineId] ?? 0), 0);
/** What is still on the road for ONE line — its shipped qty less what's settled. */
const lineRemainingQty = (t: Transfer, l: TransferLine) =>
  roundQty(l.transferredQty - settledForLine(t, l.id));
/** Quantity still on the road — what shipped, less everything received/returned. */
const remainingInTransitQty = (t: Transfer) => roundQty(shippedQty(t) - settledQty(t));
/** In Transit tab membership: still In Transit AND something is still on the road.
 *  A fully received/returned transfer is settled and leaves the tab; a partial
 *  one stays with its remaining balance. */
const isActiveInTransit = (t: Transfer) =>
  t.status === "In Transit" && remainingInTransitQty(t) > 0;

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

/** Owning office name for a location (warehouse) name — for the issue screen. */
const officeNameForLocation = (name: string): string => {
  const w = locationToWarehouse(name);
  const off = w ? ALL_OFFICES.find((o) => o.id === w.officeId) : undefined;
  return off?.name ?? "—";
};

/** Office display name by id. */
const officeNameById = (officeId?: string): string =>
  ALL_OFFICES.find((o) => o.id === officeId)?.name ?? "—";

/** Destination label for a transfer whose To warehouse may not be chosen yet —
 *  a direct transfer fixes only the To office; the warehouse is set at receive. */
const destLabelOf = (t: Transfer): string =>
  t.to || (t.toOfficeId ? `${officeNameById(t.toOfficeId)} · warehouse at receive` : "—");

// Item picker — pulled from the central Item Profile
const ITEMS: { code: string; name: string; uom: string }[] = activeItems.map((i) => ({
  code: i.code,
  name: i.name,
  uom: i.uom,
}));
// Item code lookup by name — for the Item Code column on the issue screen.
const itemCodeByName = new Map(ITEMS.map((i) => [i.name.toLowerCase(), i.code]));
const itemCodeOf = (name: string) => itemCodeByName.get(name.toLowerCase()) ?? "—";

// ── Approved-request issue ───────────────────────────────────────────────────
/**
 * Minimal live-stock shape read from the persisted inventory store. Carries the
 * hold fields so the issue screen can offer AVAILABLE stock rather than on-hand
 * — a transfer of QC-held goods would move an unusable problem to another store.
 */
type InvLite = {
  id?: string; name: string; stock: number; category?: string;
  blockedQty?: number; batches?: StoredLot[];
};
/** How much of a request line is still to be issued (its qty less what's out). */
const lineRemainingToIssue = (l: { qty: number; issuedQty?: number }) =>
  roundQty(l.qty - (l.issuedQty ?? 0));
/** A request is issuable while Approved and any line still has quantity to send. */
const isIssuable = (r: TransferRequest) =>
  r.status === "Approved" && r.lines.some((l) => lineRemainingToIssue(l) > 0);

/**
 * Project an approved request into a display-only Transfer row so it lists in
 * the same Transfer Out table as real transfers. Nothing is shipped yet, so the
 * lines carry requestedQty (their remaining balance) with transferredQty 0 —
 * Total Qty reads the outstanding amount and In Transit reads 0. `issueRequestId`
 * marks it as a placeholder that renders the Out/Issue action, not Send/Receive.
 */
/** The transfer number an approved request will carry, derived from its own
 *  number so it is stable and shown before issue — TR-7002 → TRF-7002. The
 *  actual issue reuses this same number, so the row never changes id. */
const pendingTransferNo = (r: TransferRequest) => `TRF-${r.id.replace(/^\D+/, "")}`;

const requestToIssuableRow = (r: TransferRequest): Transfer => {
  const tags = tagsForLocation(r.from);
  return {
    id: pendingTransferNo(r),
    date: r.date,
    // TR Ref carries the transfer-request number; the TRF # shows the number this
    // request will be issued as (pendingTransferNo), pending until Out/Issue.
    trRef: r.id,
    from: r.from,
    to: r.to,
    issuedBy: r.approvedBy ?? "—",
    receivedBy: "—",
    lines: r.lines
      .filter((l) => lineRemainingToIssue(l) > 0)
      .map((l) => ({ id: l.id, item: l.item, uom: l.uom, requestedQty: lineRemainingToIssue(l), transferredQty: 0 })),
    status: "Pending",
    kind: "Outbound",
    officeId: tags.officeId,
    warehouseId: tags.warehouseId,
    issueRequestId: r.id,
  };
};

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

// Consumable-return meal lines are physical trays coming back from the flight —
// they belong to the store's Return List (not consumable stock). Project each
// consumable return that has meal lines into a Return-kind Transfer so it lists
// here with a "TRF-" Return ID and can be flashed/deep-linked from the return log.
type ConsumableReturnLite = {
  id: string; date: string; flight: string; sector: string; returnedBy: string;
  lines: { itemId: string; itemName: string; qty: number; uom: string; lineType?: "item" | "meal" }[];
};
function consumableReturnToTransfer(r: ConsumableReturnLite): Transfer | null {
  const mealLines = r.lines.filter((l) => (l.lineType ?? "item") === "meal");
  if (mealLines.length === 0) return null;
  return {
    id: `TRF-${r.id}`,                       // e.g. TRF-CR-7015
    date: r.date,
    trRef: `Meal Return ${r.id}`,
    from: `${r.flight}${r.sector ? ` · ${r.sector}` : ""}`,
    to: "Cold Kitchen",
    issuedBy: r.returnedBy || "—",
    receivedBy: "—",
    lines: mealLines.map((l, i) => ({
      id: `TRF-${r.id}-L${i + 1}`,
      item: l.itemName,
      uom: l.uom || "Pcs",
      requestedQty: Number(l.qty) || 0,
      transferredQty: Number(l.qty) || 0,
    })),
    status: "Completed",
    kind: "Return",
    officeId: "OFF-001",
    warehouseId: "WH-001",
  };
}

export default function TransferPage() {
  useArrivalFlash();
  const { transferNotes, applyStockDeltas } = useWorkflow();
  const [rows, setRows] = usePersistedState<Transfer[]>("transfer-rows", SEED);
  // Approved transfer requests — read from the SAME store the Transfer Request
  // page owns, so issuing against one flips its status back there.
  const [requests, setRequests] = usePersistedState<TransferRequest[]>(TR_STORAGE_KEY, TR_SEED);
  // Live on-hand stock (reflects issues/receipts posted through the single stock
  // mutation point), for the Stock column on the issue screen. Falls back to the
  // static master when the persisted store hasn't been seeded yet.
  const [invStock] = usePersistedState<InvLite[]>(
    "inventory-items",
    () => inventory.map((i) => ({ id: i.id, name: i.name, stock: i.stock, category: i.category })),
  );
  // Meal-type consumable returns — bridged into the Return List (read-only).
  const [consumableReturns] = usePersistedState<ConsumableReturnLite[]>("consumable-returns", []);
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
  const [view, setView] = useState<"list" | "create" | "issue">("list");
  // The approved request being issued on the Transfer Out screen.
  const [issueRequest, setIssueRequest] = useState<TransferRequest | null>(null);
  const [actionTransfer, setActionTransfer] = useState<Transfer | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode>("receive");
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  // Date-range filter (on the transfer date). Empty = no bound.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Guides the user after a receipt / return: the "Transfer In / Received" and
  // "Return List" tab badges blink until that tab is opened. Navigation cue only.
  const [blinkReceived, setBlinkReceived] = useState(false);
  const [blinkReturn, setBlinkReturn] = useState(false);

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
  // Meal-type consumable returns projected as Return-kind transfers for the Return List.
  const mealReturnTransfers: Transfer[] = consumableReturns
    .map(consumableReturnToTransfer)
    .filter((t): t is Transfer => t !== null);
  const localIds = new Set(rows.map((r) => r.id));
  const combined = [
    ...bridged.filter((b) => !localIds.has(b.id)),
    ...mealReturnTransfers.filter((b) => !localIds.has(b.id)),
    ...rows,
  ];

  const filtered = combined.filter((r) => {
    if (filterOffice && r.officeId !== filterOffice) return false;
    if (filterWarehouse && r.warehouseId !== filterWarehouse) return false;
    // Compare on the date portion (rows store "YYYY-MM-DD HH:mm").
    const day = r.date.slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
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

  // ── Issue an approved request (Transfer Out) ────────────────────────────────
  const openIssue = (id: string) => {
    const r = requests.find((x) => x.id === id);
    if (!r) return;
    setIssueRequest(r);
    setView("issue");
  };
  const closeIssue = () => { setIssueRequest(null); setView("list"); };

  /**
   * Issue an approved request: create ONE outbound transfer (In Transit) for the
   * quantities entered, deduct that stock from the source, and draw the issued
   * amounts down on the request. The request completes only when every line is
   * fully issued — a partial issue leaves it Approved with the balance to send.
   */
  const applyIssue = (
    request: TransferRequest,
    outByLine: Record<string, number>,
    opts: { outDate: string; issuedBy: string },
  ) => {
    const now = `${opts.outDate} ${new Date().toISOString().slice(11, 16)}`;
    const issueLines: TransferLine[] = request.lines
      .map((l) => {
        const out = Math.max(0, Math.min(lineRemainingToIssue(l), Number(outByLine[l.id]) || 0));
        return { id: l.id, item: l.item, uom: l.uom, requestedQty: out, transferredQty: out };
      })
      .filter((l) => l.transferredQty > 0);
    if (issueLines.length === 0) { toast.error("Enter an Out Qty on at least one line."); return; }

    const tags = tagsForLocation(request.from);
    // Reuse the number reserved for the request so the row's TRF # is unchanged
    // from the pending placeholder through to the issued transfer.
    const newId = pendingTransferNo(request);
    // Issued transfers ship as In Transit to be received on the In Transit tab.
    const status: TransferStatus = "In Transit";
    const transfer: Transfer = {
      id: newId, date: now, trRef: request.id,
      from: request.from, to: request.to,
      issuedBy: opts.issuedBy || "—",
      receivedBy: "—",
      lines: issueLines, status, kind: "Outbound",
      officeId: tags.officeId, warehouseId: tags.warehouseId,
    };
    for (const l of issueLines) applyInventoryStock(l.item, -l.transferredQty);
    setRows((prev) => [transfer, ...prev]);

    // Draw the issued amounts onto the request; complete it when nothing is left.
    let fullyIssued = false;
    setRequests((prev) => prev.map((r) => {
      if (r.id !== request.id) return r;
      const lines = r.lines.map((l) => {
        const out = issueLines.find((x) => x.id === l.id)?.transferredQty ?? 0;
        return out > 0 ? { ...l, issuedQty: roundQty((l.issuedQty ?? 0) + out) } : l;
      });
      fullyIssued = lines.every((l) => lineRemainingToIssue(l) <= 0);
      return { ...r, lines, status: fullyIssued ? "Completed" : r.status };
    }));

    const totalOut = issueLines.reduce((s, l) => s + l.transferredQty, 0);
    toast.success(
      `${request.id} — ${totalOut} unit${totalOut === 1 ? "" : "s"} issued as ${newId}, now In Transit to ${request.to}.`,
    );
    closeIssue();
  };

  // Ship a still-pending outbound transfer: it advances to "In Transit" so it can
  // be received on the Transfer In Transit tab (otherwise a Pending transfer is a
  // dead-end and the In Transit tab has no way to be repopulated). Deducts the
  // transferred qty from the source store, mirroring `add` for an already-shipped
  // transfer. Dispatch-linked (DSP-) transfers move stock via deltas — not here.
  const applySend = (id: string) => {
    const target = rows.find((r) => r.id === id);
    if (!target || target.status !== "Pending") return;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "In Transit" as TransferStatus } : r)));
    if (target.kind === "Outbound" && !dispatchIdOf(target)) {
      for (const l of target.lines) applyInventoryStock(l.item, -l.transferredQty);
    }
    toast.success(`${id} sent — now In Transit and ready to receive.`);
  };

  const applyReceive = (id: string, qty: Record<string, number>, warehouse?: string) => {
    const target = rows.find((r) => r.id === id);
    if (!target) { closeAction(); return; }
    // Warehouse the goods are received into — chosen in the dialog, defaulting to
    // the transfer's destination.
    const receiveWh = warehouse || target.to;
    const receiveTags = tagsForLocation(receiveWh);

    // Per-line accepted, clamped to what is STILL in transit on that line (its
    // shipped qty less what earlier receipts/returns already settled), so a
    // second partial receipt can never take more than remains.
    const split = target.lines.map((l) => {
      const lineLeft = lineRemainingQty(target, l);
      const received = Math.max(0, Math.min(lineLeft, qty[l.id] ?? lineLeft));
      return { line: l, received, remaining: roundQty(lineLeft - received) };
    });
    const totalReceived = roundQty(split.reduce((s, x) => s + x.received, 0));
    if (totalReceived <= 0) { toast.error("Enter a quantity to receive."); return; }
    const receivedByLine: Record<string, number> = {};
    split.forEach((x) => { if (x.received > 0) receivedByLine[x.line.id] = x.received; });

    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    // The accepted portion becomes a Completed (Received) record — the normal
    // downstream flow. The ORIGINAL transfer is KEPT on the In Transit tab (it is
    // not removed / flipped to Completed) and gains a logged Receive action so the
    // list stays populated and the View dialog can show the full history.
    const receivedLines: TransferLine[] = split
      .filter((x) => x.received > 0)
      .map((x) => ({ ...x.line, requestedQty: x.received, transferredQty: x.received }));
    const receivedBy = target.receivedBy && target.receivedBy !== "—" ? target.receivedBy : "(received)";
    const logEntry: TransferAction = {
      type: "Receive",
      qty: roundQty(totalReceived),
      by: receivedBy,
      at: now,
      detail: receivedLines.map((l) => `${l.item} ${l.transferredQty} ${l.uom}`).join(", "),
      lineQty: receivedByLine,
    };
    const receivedRec: Transfer = {
      ...target,
      id: `${target.id}-RCV-${(target.actionLog?.length ?? 0) + 1}-${now.replace(/[^0-9]/g, "").slice(-6)}`,
      date: now,
      status: "Completed",
      receivedBy,
      // Land the receipt in the chosen warehouse (may differ from the original to).
      to: receiveWh,
      officeId: receiveTags.officeId,
      warehouseId: receiveTags.warehouseId,
      lines: receivedLines,
      actionLog: undefined,
    };
    setRows((prev) => [
      receivedRec,
      ...prev.map((r) => (r.id === id ? { ...r, actionLog: [...(r.actionLog ?? []), logEntry] } : r)),
    ]);

    // Close the inventory loop for dispatch-originated transfers (trRef = the
    // DSP-XXXX id): the accepted meals land in the destination warehouse as an
    // inbound stock movement, netting against the negative delta the dispatch
    // posted at the source. Partial receipts post only what was accepted; the
    // remainder posts when it's received later. Regular transfers are untouched.
    if (target.trRef.startsWith("DSP-")) {
      const deltas: StockDelta[] = split
        .filter((x) => x.received > 0)
        .map((x) => ({
          itemId: x.line.item,
          delta: x.received,
          date: now,
          reference: id,
          officeId: receiveTags.officeId,
          warehouseId: receiveTags.warehouseId,
          label: "Transfer In",
        }));
      if (deltas.length > 0) applyStockDeltas(deltas);
    }

    // What is left on the road after this receipt (across receipts AND returns).
    const leftAfter = roundQty(remainingInTransitQty(target) - totalReceived);
    toast.success(
      leftAfter > 0
        ? `${id} — ${totalReceived} unit${totalReceived === 1 ? "" : "s"} received. ${leftAfter} still in transit — kept on the In Transit list to receive the rest.`
        : `${id} — ${totalReceived} unit${totalReceived === 1 ? "" : "s"} received. Fully received — cleared from the In Transit list.`,
    );
    // Nudge the user toward the received items (now eligible for galley planning).
    setBlinkReceived(true);
    closeAction();
  };

  const applyReturn = (id: string, qty: Record<string, number>, reason: string) => {
    const target = rows.find((r) => r.id === id);
    if (!target) { closeAction(); return; }
    // Clamp each line to what is STILL in transit on it (shipped less already
    // settled), so a return after a partial receipt can't exceed the balance.
    const returnByLine: Record<string, number> = {};
    for (const l of target.lines) {
      const want = Number(qty[l.id]) || 0;
      const take = Math.max(0, Math.min(lineRemainingQty(target, l), want));
      if (take > 0) returnByLine[l.id] = take;
    }
    const total = roundQty(Object.values(returnByLine).reduce((s, n) => s + n, 0));
    if (total <= 0) {
      toast.error("Enter a quantity to return on at least one line.");
      return;
    }
    const dspId = dispatchIdOf(target);
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const returnLines: TransferLine[] = target.lines
      .filter((l) => (returnByLine[l.id] ?? 0) > 0)
      .map((l) => ({
        id: l.id,
        item: l.item,
        uom: l.uom,
        requestedQty: returnByLine[l.id],
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
    // The return record is created as the normal downstream flow. The ORIGINAL
    // transfer is KEPT on the In Transit tab (status stays "In Transit") and gains
    // a logged Return action, so the list stays populated and View shows history.
    const logEntry: TransferAction = {
      type: "Return",
      qty: roundQty(total),
      by: target.receivedBy && target.receivedBy !== "—" ? target.receivedBy : "(destination)",
      at: now,
      detail: returnLines.map((l) => `${l.item} ${l.requestedQty} ${l.uom}`).join(", "),
      reason: reason.trim() || undefined,
      lineQty: returnByLine,
    };
    setRows((prev) => [
      ret,
      ...prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: "In Transit" as TransferStatus,
              receivedBy: r.receivedBy === "—" ? "(received)" : r.receivedBy,
              ...(dspId ? { dispatchStatus: "Returned" as TransferDispatchStatus } : {}),
              actionLog: [...(r.actionLog ?? []), logEntry],
            }
          : r,
      ),
    ]);
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
    // Balance still on the road after this return (counts prior receipts too).
    const leftAfter = roundQty(remainingInTransitQty(target) - total);
    const tail = leftAfter > 0
      ? `${id} kept on the In Transit list — ${leftAfter} still in transit.`
      : `${id} fully settled — cleared from the In Transit list.`;
    toast.success(
      dspId
        ? `${total} unit${total === 1 ? "" : "s"} returned — dispatch ${dspId} flagged Returned. ${tail} Re-dispatch restarts packaging → QC → dispatch.`
        : `${total} unit${total === 1 ? "" : "s"} returned — return ${newId} created. ${tail}`,
    );
    // Nudge the user toward the Return List (blinks until that tab is opened).
    setBlinkReturn(true);
    closeAction();
  };

  const pending = combined.filter((r) => r.status === "Pending").length;
  // Only transfers with quantity still on the road — a fully received/returned
  // one is settled and no longer counted (matches the In Transit tab).
  const inTransit = combined.filter(isActiveInTransit).length;
  const completed = combined.filter((r) => r.status === "Completed").length;
  // Approved requests awaiting Out/Issue — the "To Issue" tab's rows.
  const issuableRequests = requests.filter(isIssuable);

  return (
    <>
      <PageHeader
        title="Transfer"
        subtitle="Execute approved transfers — move items physically between locations and track receipt"
        actions={
          view === "issue" ? (
            <Button variant="outline" onClick={closeIssue}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          ) : (
            <Button
              variant={view === "create" ? "outline" : "default"}
              onClick={() => setView(view === "create" ? "list" : "create")}
            >
              {view === "create" ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back</> : <><Plus className="h-4 w-4 mr-1" /> Direct Transfer</>}
            </Button>
          )
        }
      />

      {view === "issue" && issueRequest ? (
        <TransferOutIssue
          request={issueRequest}
          invStock={invStock}
          onCancel={closeIssue}
          onSave={applyIssue}
        />
      ) : view === "list" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Total Transfers" value={combined.length} icon={MoveRight} tone="navy" />
            <KpiCard label="Pending" value={pending} icon={Clock} tone="warning" />
            <KpiCard label="In Transit" value={inTransit} icon={Truck} tone="navy" />
            <KpiCard label="Completed" value={completed} icon={CheckCircle} tone="success" />
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <LocationFilter
              officeId={filterOffice}
              warehouseId={filterWarehouse}
              onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
            />
            <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1 shadow-sm">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="field-label">Date</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="From date"
                className="h-7 rounded-md border border-input bg-background px-2 text-xs tabular-nums"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="To date"
                className="h-7 rounded-md border border-input bg-background px-2 text-xs tabular-nums"
              />
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  title="Clear date filter"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <TransferTabs
            data={filtered}
            issuable={issuableRequests}
            onIssue={openIssue}
            onReceive={(id) => openAction(id, "receive")}
            onReturn={(id) => openAction(id, "return")}
            onSend={applySend}
            editors={rowEditors(setRows)}
            blinkReceived={blinkReceived}
            onClearBlink={() => setBlinkReceived(false)}
            blinkReturn={blinkReturn}
            onClearReturnBlink={() => setBlinkReturn(false)}
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
  onReceive: (id: string, qty: Record<string, number>, warehouse: string) => void;
  onReturn: (id: string, qty: Record<string, number>, reason: string) => void;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  // The warehouse the goods are received into — chosen at receive time. Returns
  // always go back to the transfer's source, so no picker is shown for them.
  const [destWh, setDestWh] = useState("");
  // Scope the picker to the destination office fixed at creation (direct
  // transfers); older rows with no toOfficeId offer every active warehouse.
  const whOptions = useMemo(() => {
    const active = ALL_WAREHOUSES.filter((w) => w.status === "Active");
    return transfer?.toOfficeId ? active.filter((w) => w.officeId === transfer.toOfficeId) : active;
  }, [transfer?.toOfficeId]);

  // What is still on the road per line — a partial receipt/return earlier means
  // "Shipped"/"In Hand" here is the REMAINING balance, not the original amount.
  const lineMax = (l: TransferLine) => (transfer ? lineRemainingQty(transfer, l) : l.transferredQty);

  useEffect(() => {
    if (!transfer) return;
    const seed: Record<string, number> = {};
    transfer.lines.forEach((l) => {
      // Receive defaults to the full remaining qty (accept-as-shipped).
      // Return defaults to 0 (nothing returned) — user explicitly picks.
      seed[l.id] = mode === "receive" ? lineRemainingQty(transfer, l) : 0;
    });
    setQty(seed);
    setReason("");
    setDestWh(transfer.to);
  }, [transfer, mode]);

  if (!transfer) return null;

  const totalInHand = transfer.lines.reduce((s, l) => s + lineMax(l), 0);
  const totalSelected = transfer.lines.reduce((s, l) => s + (qty[l.id] ?? 0), 0);
  const allSelected = transfer.lines.every((l) => (qty[l.id] ?? 0) === lineMax(l));
  const noneSelected = totalSelected === 0;

  const setAll = (kind: "all" | "none") => {
    const next: Record<string, number> = {};
    transfer.lines.forEach((l) => {
      next[l.id] = kind === "all" ? lineMax(l) : 0;
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
                {isReceive ? transfer.from : destLabelOf(transfer)}
              </span>
              <MoveRight className="h-3 w-3" />
              {isReceive ? (
                <select
                  value={destWh}
                  onChange={(e) => setDestWh(e.target.value)}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  title="Warehouse to receive into"
                >
                  <option value="">Select warehouse…</option>
                  {whOptions.map((w) => <option key={w.id} value={w.name}>{w.name}</option>)}
                  {destWh && !whOptions.some((w) => w.name === destWh) && <option value={destWh}>{destWh}</option>}
                </select>
              ) : (
                <span className="font-medium text-foreground">{transfer.from}</span>
              )}
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
                  const max = lineMax(l);
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
            <Button onClick={() => onReceive(transfer.id, qty, destWh)} disabled={noneSelected || !destWh}>
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
  data, issuable, onIssue, onReceive, onReturn, onSend, editors, blinkReceived, onClearBlink, blinkReturn, onClearReturnBlink,
}: {
  data: Transfer[];
  /** Approved requests awaiting Out/Issue — the first "To Issue" tab. */
  issuable: TransferRequest[];
  onIssue: (id: string) => void;
  onReceive: (id: string) => void;
  onReturn: (id: string) => void;
  /** Ship a Pending outbound transfer → In Transit (Transfer Out tab). */
  onSend: (id: string) => void;
  editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void };
  /** When true, blink the "Transfer In / Received" tab badge until it's opened. */
  blinkReceived: boolean;
  onClearBlink: () => void;
  /** When true, blink the "Return List" tab badge until it's opened. */
  blinkReturn: boolean;
  onClearReturnBlink: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  // A dispatch row's "Receive Items" shortcut lands here asking to open the
  // Transfer In Transit tab and blink the rows waiting to be received.
  const navState = location.state as { receiveInTransit?: boolean; openReturnList?: boolean } | null;
  const wantReceive = navState?.receiveInTransit === true;
  // A meal-return "Restocked QTY" link (Consumable Returns → View) lands here
  // asking to open the Return List so its bridged TRF row can be flashed.
  const wantReturnList = navState?.openReturnList === true;
  const [tab, setTab] = useState(wantReceive ? "transit" : wantReturnList ? "return" : "out");
  // Opening the target tab is what each blink nudges toward — clear it then.
  const changeTab = (v: string) => {
    setTab(v);
    if (v === "received") onClearBlink();
    if (v === "return") onClearReturnBlink();
  };

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
  // In Transit tab: only rows with quantity still on the road. A fully
  // received/returned transfer drops off; a partial one stays with its balance.
  const inTransit      = data.filter(isActiveInTransit);
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
          <TabCount n={transferOut.length + issuable.length} tone="warning" />
        </TabsTrigger>
        <TabsTrigger value="transit"    className={TAB_PILL_CLS}>
          Transfer In Transit
          <TabCount n={inTransit.length} tone="navy" />
        </TabsTrigger>
        <TabsTrigger value="return"     className={TAB_PILL_CLS}>
          Return List
          <TabCount n={returns.length} tone="muted" blink={blinkReturn} />
        </TabsTrigger>
        <TabsTrigger value="received"   className={TAB_PILL_CLS}>
          Transfer In / Received
          <TabCount n={received.length} tone="success" blink={blinkReceived} />
        </TabsTrigger>
      </TabsList>

      <TabsContent value="out"      className="mt-0">
        {/* Approved requests awaiting Out/Issue are projected into the SAME table
            (leading it), carrying the Out/Issue action in the Actions column. */}
        <TransferList
          data={[...issuable.map(requestToIssuableRow), ...transferOut]}
          qtyBreakdown
          onSend={onSend}
          onIssue={onIssue}
          emptyHint="No outgoing transfers."
          editors={editors}
        />
      </TabsContent>
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

// ── Transfer Out: issue an approved request ─────────────────────────────────
// Prefilled from the request. Each line's Out Qty defaults to its remaining
// balance, capped at the live stock on hand. Saving ships the entered amounts.
function TransferOutIssue({
  request, invStock, onCancel, onSave,
}: {
  request: TransferRequest;
  invStock: InvLite[];
  onCancel: () => void;
  onSave: (
    request: TransferRequest,
    outByLine: Record<string, number>,
    opts: { outDate: string; issuedBy: string },
  ) => void;
}) {
  // Issuable, not on-hand: anything held for QC stays put until it passes or is
  // written off.
  const rowOf = (name: string) =>
    invStock.find((iv) => iv.name.toLowerCase() === name.toLowerCase());
  const stockOf = (name: string) => availableOf(rowOf(name));
  const heldOf = (name: string) => blockedOf(rowOf(name));
  const categoryOf = (name: string) =>
    invStock.find((iv) => iv.name.toLowerCase() === name.toLowerCase())?.category ?? "—";
  const remainingOf = (l: TransferRequest["lines"][number]) => lineRemainingToIssue(l);
  // Default Out Qty = remaining balance, capped at what's physically in stock.
  const [out, setOut] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const l of request.lines) seed[l.id] = Math.min(remainingOf(l), stockOf(l.item));
    return seed;
  });
  const [outDate, setOutDate] = useState(new Date().toISOString().slice(0, 10));
  const staff = useMemo(() => getActiveStaff().map((s) => s.fullName), []);
  const [issuedBy, setIssuedBy] = useState(request.approvedBy ?? "");

  const totalReq = request.lines.reduce((s, l) => s + l.qty, 0);
  const totalIssued = request.lines.reduce((s, l) => s + (l.issuedQty ?? 0), 0);
  const totalRemaining = request.lines.reduce((s, l) => s + remainingOf(l), 0);
  const totalOut = request.lines.reduce((s, l) => s + (Number(out[l.id]) || 0), 0);

  const detail = (label: string, value: ReactNode) => (
    <div className="flex gap-2 text-sm">
      <span className="w-44 shrink-0 text-muted-foreground">{label}</span>
      <span className="text-muted-foreground">:</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider">Transfer Out Details</h3>
            <Button onClick={() => onSave(request, out, { outDate, issuedBy })}>
              <Save className="h-4 w-4 mr-1.5" /> Save
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-2.5">
            {detail("Request Date", request.date.slice(0, 10))}
            {detail("Request Code", <span className="font-mono">{request.id}</span>)}
            {detail("Request / Receive Office", officeNameForLocation(request.to))}
            {detail("Sending Office Name", officeNameForLocation(request.from))}
            {detail("Request / Receive Warehouse", request.to)}
            {detail("Sending / Issue Warehouse", request.from)}
            {detail("Approved By", request.approvedBy ?? "—")}
            {detail("Requested By", request.requestedBy)}
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Transfer Out Date</Label>
              <Input type="date" value={outDate} onChange={(e) => setOutDate(e.target.value)} className="mt-1 tabular-nums" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Issued By</Label>
              <select value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} className={selectCls}>
                <option value="">Store keeper / issuer</option>
                {staff.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-10 text-[10px] uppercase tracking-wider">SL</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Item Code</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Item Category</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Item Name</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">UoM</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-right">Request Qty</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-right">Transferred Qty</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-right">Remaining Qty</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-right">Stock</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-right w-28">Out Qty <span className="text-destructive">*</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {request.lines.map((l, i) => {
                  const remaining = remainingOf(l);
                  const stock = stockOf(l.item);
                  const held = heldOf(l.item);
                  const max = Math.min(remaining, stock);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{itemCodeOf(l.item)}</TableCell>
                      <TableCell className="text-xs">{categoryOf(l.item)}</TableCell>
                      <TableCell className="text-xs font-medium">{l.item}</TableCell>
                      <TableCell className="text-xs">{l.uom}</TableCell>
                      <TableCell className="text-right tabular-nums">{roundQty(l.qty)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{roundQty(l.issuedQty ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{roundQty(remaining)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${stock < remaining ? "text-destructive font-medium" : ""}`}>
                        {roundQty(stock)}
                        {held > 0 && (
                          <div
                            className="text-[10px] text-warning font-medium"
                            title="On hand but held for QC — not transferable until it passes or is disposed"
                          >
                            +{roundQty(held)} held
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          max={max}
                          value={out[l.id] ?? 0}
                          onChange={(e) => {
                            const n = Math.max(0, Math.min(max, Number(e.target.value) || 0));
                            setOut((prev) => ({ ...prev, [l.id]: n }));
                          }}
                          className="h-8 w-24 ml-auto text-right tabular-nums"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="border-t-2 border-slate-300 bg-muted/40">
                  <TableCell colSpan={5} className="font-bold text-right">Total</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">{roundQty(totalReq)}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">{roundQty(totalIssued)}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">{roundQty(totalRemaining)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-bold tabular-nums">{roundQty(totalOut)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button onClick={() => onSave(request, out, { outDate, issuedBy })}>
              <Save className="h-4 w-4 mr-1.5" /> Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
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
        {field("Route", <span className="inline-flex items-center gap-1.5">{t.from}<MoveRight className="h-3 w-3 text-muted-foreground" />{destLabelOf(t)}</span>)}
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

      {/* Action log — every Receive / Return taken on this transfer, newest last. */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
          Action Log ({t.actionLog?.length ?? 0})
        </div>
        {(t.actionLog?.length ?? 0) === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
            No actions taken yet. Receiving or returning this transfer will be logged here.
          </div>
        ) : (
          <div className="space-y-2">
            {t.actionLog!.map((a, i) => (
              <div key={i} className="rounded-lg border border-border px-3 py-2 bg-muted/30">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.type === "Receive" ? "bg-success/10 text-success" : "bg-navy/10 text-navy"}`}>
                    {a.type === "Receive" ? <CheckCircle className="h-3 w-3" /> : <Undo2 className="h-3 w-3" />}
                    {a.type} · {a.qty}
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{a.at} · by {a.by}</span>
                </div>
                {a.detail && <div className="mt-1 text-xs text-foreground">{a.detail}</div>}
                {a.reason && <div className="mt-0.5 text-[11px] text-muted-foreground">Reason: {a.reason}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TransferList({
  data, emptyHint, qtyBreakdown, noActions, onReceive, onReturn, onSend, onIssue, editors, onGoToTransit,
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
  /** Ship a Pending outbound transfer → In Transit (Transfer Out tab). */
  onSend?: (id: string) => void;
  /** Open the Transfer Out issue screen for an approved-request placeholder row. */
  onIssue?: (requestId: string) => void;
  editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void };
  /** When set, each row shows a shortcut button to the Transfer In Transit tab
   *  (where transfers are received). Navigation only — no data change. */
  onGoToTransit?: () => void;
}) {
  const sumReq = (r: Transfer) => r.lines.reduce((s, l) => s + l.requestedQty, 0);
  const sumDone = (r: Transfer) => r.lines.reduce((s, l) => s + l.transferredQty, 0);
  // In-Transit row whose detail + action log is being viewed (read-only).
  const [viewT, setViewT] = useState<Transfer | null>(null);
  const num = (n: number) => <span className="text-xs tabular-nums">{n.toFixed(2)}</span>;
  // Received / Returned so far, from the logged actions — so the breakdown adds
  // up (Received + Returned + In Transit = Total) as a transfer is settled,
  // instead of the columns staying 0 until a status flip that never happens.
  const receivedSoFar = (r: Transfer) =>
    (r.actionLog ?? []).reduce((s, a) => s + (a.type === "Receive" ? a.qty : 0), 0);
  const returnedSoFar = (r: Transfer) =>
    (r.actionLog ?? []).reduce((s, a) => s + (a.type === "Return" ? a.qty : 0), 0);
  const qtyCols: Column<Transfer>[] = [
    { key: "totalQty",     header: "Total Qty",     sortable: false, render: (r) => num(sumReq(r)) },
    { key: "receivedQty",  header: "Received Qty",  sortable: false, render: (r) => num(r.status === "Completed" ? sumDone(r) : receivedSoFar(r)) },
    { key: "returnQty",    header: "Return Qty",    sortable: false, render: (r) => num(r.kind === "Return" ? sumReq(r) : returnedSoFar(r)) },
    { key: "inTransitQty", header: "In Transit Qty", sortable: false, render: (r) => num(r.status === "In Transit" ? remainingInTransitQty(r) : 0) },
  ];
  const itemsCol: Column<Transfer> = {
    key: "lines",
    header: "Items",
    className: "text-right",
    render: (r) => {
      const totalReq = r.lines.reduce((s, l) => s + l.requestedQty, 0);
      const totalDone = r.lines.reduce((s, l) => s + l.transferredQty, 0);
      // A partially received/returned transfer that is still on the road shows
      // the BALANCE remaining, not the full shipped amount — that is the load
      // still to be received here.
      if (r.status === "In Transit" && settledQty(r) > 0) {
        return (
          <span className="text-xs tabular-nums">
            <span className="font-semibold text-navy">{remainingInTransitQty(r)}</span>
            <span className="text-muted-foreground"> of {roundQty(shippedQty(r))} in transit · {r.lines.length} item{r.lines.length > 1 ? "s" : ""}</span>
          </span>
        );
      }
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
          {r.issueRequestId ? (
            // The number this request will be issued as — shown now so the row is
            // identifiable before Out/Issue.
            <span className="font-mono text-xs text-muted-foreground whitespace-nowrap" title="Transfer number reserved for this request — issued when you click Out/Issue">{r.id}</span>
          ) : (
            <button
              type="button"
              onClick={() => setViewT(r)}
              className="font-mono text-xs text-primary hover:underline focus:outline-none focus:underline"
              title="View transfer details"
            >
              {r.id}
            </button>
          )}
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
          <span className={r.to ? "font-medium" : "italic text-muted-foreground"}>{destLabelOf(r)}</span>
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
    <>
    <DataTable
      title="transfers"
      data={data}
      columns={cols}
      searchKeys={["id", "trRef", "from", "to", "issuedBy", "receivedBy", "status"]}
      selectable={false}
      actions={noActions ? undefined : (r) => {
        // Approved-request placeholder → Out/Issue (opens the Transfer Out screen).
        if (r.issueRequestId && onIssue) {
          return (
            <Button
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => onIssue(r.issueRequestId!)}
              title="Issue this approved request out"
            >
              <Truck className="h-3 w-3 mr-1" /> Out/Issue
            </Button>
          );
        }
        if (onReceive && onReturn && r.status === "In Transit") {
          // Every row still on this tab has a balance on the road (fully
          // received/returned transfers have already left it), so Receive and
          // Return stay live — a partial receipt returns to receive the rest.
          // Progress made so far shows in the Items column and the View log.
          const partly = settledQty(r) > 0;
          return (
            <div className="flex items-center gap-1.5">
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                title="View details & action log"
                aria-label="View details & action log"
                onClick={() => setViewT(r)}
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs border-success/40 text-success hover:bg-success/10 hover:text-success"
                onClick={() => onReceive(r.id)}
                title={partly ? "Receive the remaining balance" : "Receive this transfer"}
              >
                <CheckCircle className="h-3 w-3 mr-1" /> Receive{partly ? " Rest" : ""}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs border-navy/40 text-navy hover:bg-navy/10 hover:text-navy"
                onClick={() => onReturn(r.id)}
                title={partly ? "Return the remaining balance" : "Return this transfer"}
              >
                <Undo2 className="h-3 w-3 mr-1" /> Return{partly ? " Rest" : ""}
              </Button>
            </div>
          );
        }
        // Ship a still-pending outbound transfer → In Transit so it can be
        // received (keeps the In Transit tab supplied after receipts).
        if (onSend && r.kind === "Outbound" && r.status === "Pending") {
          return (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
                onClick={() => onSend(r.id)}
                title="Ship this transfer — moves it to Transfer In Transit for receiving"
              >
                <Truck className="h-3 w-3 mr-1" /> Send
              </Button>
              <RowActions
                row={r}
                actions={["view", "edit", "print"]}
                detail={<TransferDetail t={r} />}
                onSave={editors.onSave}
                editDetail={({ save, close }) => <TransferFields mode="edit" initial={r} onSubmit={save} onClose={close} />}
              />
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
    <Dialog open={!!viewT} onOpenChange={(o) => !o && setViewT(null)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle className="font-mono text-base">Transfer {viewT?.id}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {viewT && <TransferDetail t={viewT} />}
        </div>
        <DialogFooter className="px-5 py-3 border-t border-border">
          <Button variant="outline" onClick={() => setViewT(null)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
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
  // Transfers created here are always Outbound with no linked request ref —
  // returns are done from the In Transit tab, where they credit stock and link
  // back to the original. Edit mode keeps whatever the existing row carried.
  const kind: TransferKind = initial?.kind ?? "Outbound";
  const trRef = initial?.trRef ?? "Direct Transfer";
  // Source = From Office → From Warehouse. Destination office is fixed here; the
  // To warehouse is OPTIONAL — pick it now, or leave it to be set at receive.
  const [fromOfficeId, setFromOfficeId] = useState(
    initial?.officeId ?? locationToWarehouse(initial?.from ?? "")?.officeId ?? activeOffices[0]?.id ?? "",
  );
  const fromWhOptions = activeWarehousesByOffice(fromOfficeId);
  const [from, setFrom] = useState(initial?.from ?? fromWhOptions[0]?.name ?? "");
  const [toOfficeId, setToOfficeId] = useState(
    initial?.toOfficeId ?? locationToWarehouse(initial?.to ?? "")?.officeId ?? activeOffices[0]?.id ?? "",
  );
  const toWhOptions = activeWarehousesByOffice(toOfficeId);
  const [to, setTo] = useState(initial?.to ?? "");
  const [issuedBy, setIssuedBy] = useState(initial?.issuedBy ?? "");

  // Keep the (optional) To warehouse valid for the chosen To office.
  const onToOffice = (officeId: string) => {
    setToOfficeId(officeId);
    setTo((prev) => (activeWarehousesByOffice(officeId).some((w) => w.name === prev) ? prev : ""));
  };

  // Keep the From warehouse valid for the chosen From office.
  const onFromOffice = (officeId: string) => {
    setFromOfficeId(officeId);
    const opts = activeWarehousesByOffice(officeId);
    setFrom((prev) => (opts.some((w) => w.name === prev) ? prev : opts[0]?.name ?? ""));
  };
  // Received By is NOT captured at creation — it is stamped when the transfer is
  // actually received on the In Transit tab. Preserve any existing value in edit
  // mode; a new transfer has none until received.
  const receivedBy = initial?.receivedBy ?? "";

  // Issued By picks from the active staff roster (the same source the User Access
  // Control screen owns). A value already on the record that isn't in the roster
  // (an inactive user, or a system-stamped name) is kept as an option so editing
  // never silently drops it.
  const staffNames = useMemo(() => {
    const names = getActiveStaff().map((s) => s.fullName);
    if (initial?.issuedBy && initial.issuedBy !== "—" && !names.includes(initial.issuedBy)) {
      names.push(initial.issuedBy);
    }
    return names;
  }, [initial?.issuedBy]);

  const [itemIdx, setItemIdx] = useState(0);
  // One Quantity per line. A transfer moves exactly what is entered, so the
  // requested and transferred amounts are the same — both are set from this.
  const [qtyInput, setQtyInput] = useState("");
  const [lines, setLines] = useState<TransferLine[]>(initial?.lines ?? []);

  const addLine = () => {
    const it = ITEMS[itemIdx];
    const q = Number(qtyInput);
    if (!q || q <= 0) { toast.error("Quantity is required."); return; }
    if (lines.some((l) => l.item === it.name)) { toast.error(`${it.name} is already added.`); return; }
    setLines((prev) => [
      ...prev,
      { id: `L-${Date.now()}`, item: it.name, uom: it.uom, requestedQty: q, transferredQty: q },
    ]);
    setQtyInput("");
  };

  const removeLine = (id: string) => setLines((p) => p.filter((l) => l.id !== id));

  const validate = (status?: TransferStatus) => {
    if (!fromOfficeId || !from) { toast.error("Select the From office and warehouse."); return false; }
    if (!toOfficeId) { toast.error("Select the To office."); return false; }
    if (fromOfficeId === toOfficeId && from === to && to) { toast.error("Source and destination must be different."); return false; }
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
      // To warehouse (`to`) is chosen at receive time — kept blank on creation.
      from, to,
      toOfficeId,
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
            <h3 className="text-sm font-semibold uppercase tracking-wider">Direct Transfer Details</h3>
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
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">From Office <span className="text-destructive">*</span></Label>
              <select value={fromOfficeId} onChange={(e) => onFromOffice(e.target.value)} className={selectCls}>
                {activeOffices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">From Warehouse <span className="text-destructive">*</span></Label>
              <select value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls} disabled={fromWhOptions.length === 0}>
                {fromWhOptions.length === 0
                  ? <option value="">No warehouse for this office</option>
                  : fromWhOptions.map((w) => <option key={w.id} value={w.name}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">To Office <span className="text-destructive">*</span></Label>
              <select value={toOfficeId} onChange={(e) => onToOffice(e.target.value)} className={selectCls}>
                {activeOffices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">To Warehouse</Label>
              <select value={to} onChange={(e) => setTo(e.target.value)} className={selectCls} disabled={toWhOptions.length === 0}>
                <option value="">Select at receive…</option>
                {toWhOptions.map((w) => <option key={w.id} value={w.name}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Issued By <span className="text-destructive">*</span></Label>
              <select value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} className={selectCls}>
                <option value="">Store keeper / issuer</option>
                {staffNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
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
            <div className="md:col-span-4">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quantity <span className="text-destructive">*</span></Label>
              <Input type="number" min={0} value={qtyInput} onChange={(e) => setQtyInput(e.target.value)} className="mt-1 tabular-nums" />
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
                  <TableHead className="text-xs uppercase tracking-wider text-right">Quantity</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Allocation Lots (Source)</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      No items added yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  lines.map((l, i) => {
                    const invMatch = inventory.find((iv) => iv.name === l.item);
                    const fefo = invMatch && l.transferredQty > 0
                      ? allocateFefo(invMatch.id, l.transferredQty)
                      : null;
                    return (
                      <TableRow key={l.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium">{l.item}</TableCell>
                        <TableCell>{l.uom}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.transferredQty}</TableCell>
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
