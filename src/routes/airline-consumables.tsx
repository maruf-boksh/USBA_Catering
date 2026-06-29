import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, ArrowLeft, Save, Boxes, AlertTriangle, Coffee, Eye, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import {
  consumableItems, items as MASTER_ITEMS,
  type ConsumableCategory, type ConsumableItem,
} from "@/lib/sample-data";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

const CATEGORIES: ConsumableCategory[] = [
  "Napkin", "Cup", "Cutlery", "Tissue", "Amenity Kit", "Plastic Tray", "Packaging",
];
const UOMS = ["Pcs", "Kit", "Box", "Pack", "Roll"];

type AllocLine = { itemId: string; itemName: string; qty: number; uom: string };
type AllocRecord = {
  id: string;
  date: string;
  scheduledTime: string;
  flight: string;
  sector: string;
  lines: AllocLine[];
};

type ApprovalLine = { itemId: string; lineType: "item" | "meal"; reusableQty: number; partialReason?: string };
type ReturnApprovalRecord = {
  id: string;
  status: "Pending" | "Approved" | "Declined";
  processedBy?: string;
  processedAt?: string;
  declineReason?: string;
  lines: ApprovalLine[];
};

type CReturnLine = {
  itemId: string; itemName: string; qty: number; uom: string;
  lineType?: "item" | "meal"; reusable: boolean;
  nonReusableReason?: string; issuedQty?: number;
};
type CReturn = {
  id: string; date: string; scheduledTime: string;
  flight: string; sector: string; returnedBy: string;
  approvalId?: string; forwardToAirportStore?: boolean;
  lines: CReturnLine[];
};

type MovementEntry =
  | { kind: "alloc"; id: string; date: string; flight: string; sector: string; qty: number; uom: string; record: AllocRecord }
  | { kind: "return"; id: string; date: string; flight: string; sector: string; qty: number; uom: string; approvalStatus?: "Pending" | "Approved" | "Declined"; record: CReturn; approval?: ReturnApprovalRecord };

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function computeStatus(stock: number, reorder: number): "OK" | "Low" | "Critical" {
  if (stock < reorder * 0.5) return "Critical";
  if (stock < reorder) return "Low";
  return "OK";
}

export default function ConsumableInventoryPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [items, setItems] = usePersistedState<ConsumableItem[]>("airline-consumables-items", consumableItems);
  const [returnApprovals] = usePersistedState<ReturnApprovalRecord[]>("consumable-return-approvals", []);
  const [creditedIds, setCreditedIds] = usePersistedState<string[]>("consumable-stock-credited", []);
  const [flashItemIds, setFlashItemIds] = useState<Set<string>>(new Set());

  // Ref keeps a session-local authoritative copy so the effect never reads a
  // stale closure of creditedIds (avoids double-apply under React batching).
  const creditedRef = useRef<string[]>(creditedIds);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // One-time sync on mount — ref becomes the source of truth for the session.
  useEffect(() => { creditedRef.current = creditedIds; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect newly-approved return approvals and credit reusable qty to stock.
  useEffect(() => {
    const newlyApproved = returnApprovals.filter(
      (a) => a.status === "Approved" && !creditedRef.current.includes(a.id),
    );
    if (newlyApproved.length === 0) return;

    // Lock via ref immediately — prevents double-apply if effect runs twice.
    creditedRef.current = [...creditedRef.current, ...newlyApproved.map((a) => a.id)];

    const flashIds = new Set<string>();

    setItems((prev) =>
      prev.map((item) => {
        let addQty = 0;
        for (const approval of newlyApproved) {
          const line = approval.lines.find(
            (l) => l.itemId === item.id && l.lineType === "item" && l.reusableQty > 0,
          );
          if (line) addQty += line.reusableQty;
        }
        if (addQty === 0) return item;
        const newStock = item.stock + addQty;
        flashIds.add(item.id);
        return { ...item, stock: newStock, status: computeStatus(newStock, item.reorder) };
      }),
    );

    setCreditedIds(creditedRef.current);

    if (flashIds.size > 0) {
      setFlashItemIds(flashIds);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashItemIds(new Set()), 3500);
    }

    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [returnApprovals]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextId = `CNS-${String(items.length + 1).padStart(3, "0")}`;

  const addItem = (it: ConsumableItem) => {
    setItems((prev) => [it, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Consumables Inventory"
        subtitle="Disposable airline service items — napkins, cups, cutlery, tissues, amenity kits, trays and packaging"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> New Item</>}
          </Button>
        }
      />

      {view === "list"
        ? <ConsumableList items={items} flashItemIds={flashItemIds} />
        : <ConsumableCreate nextId={nextId} onSave={addItem} />}
    </>
  );
}

function ConsumableList({ items, flashItemIds }: { items: ConsumableItem[]; flashItemIds?: Set<string> }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ConsumableCategory | "All">("All");
  const [allocations] = usePersistedState<AllocRecord[]>("consumable-allocations", []);
  const [returns] = usePersistedState<CReturn[]>("consumable-returns", []);
  const [returnApprovals] = usePersistedState<ReturnApprovalRecord[]>("consumable-return-approvals", []);
  const [stockModalItem, setStockModalItem] = useState<ConsumableItem | null>(null);
  const [flightDetailRecord, setFlightDetailRecord] = useState<AllocRecord | null>(null);
  const [returnDetailRecord, setReturnDetailRecord] = useState<{ ret: CReturn; appr?: ReturnApprovalRecord; focusItemId?: string } | null>(null);
  const [adjDateFrom, setAdjDateFrom] = useState("");
  const [adjDateTo, setAdjDateTo] = useState("");

  const itemAdjustments = useMemo((): MovementEntry[] => {
    if (!stockModalItem) return [];
    const entries: MovementEntry[] = [];

    for (const a of allocations) {
      const line = a.lines.find((l) => l.itemId === stockModalItem.id);
      if (!line) continue;
      if (adjDateFrom && a.date < adjDateFrom) continue;
      if (adjDateTo && a.date > adjDateTo) continue;
      entries.push({ kind: "alloc", id: a.id, date: a.date, flight: a.flight, sector: a.sector, qty: line.qty, uom: line.uom, record: a });
    }

    for (const r of returns) {
      const line = r.lines.find((l) => l.itemId === stockModalItem.id && l.lineType !== "meal");
      if (!line) continue;
      if (adjDateFrom && r.date < adjDateFrom) continue;
      if (adjDateTo && r.date > adjDateTo) continue;
      const appr = r.approvalId ? returnApprovals.find((a) => a.id === r.approvalId) : undefined;
      entries.push({ kind: "return", id: r.id, date: r.date, flight: r.flight, sector: r.sector, qty: line.qty, uom: line.uom, approvalStatus: appr?.status, record: r, approval: appr });
    }

    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }, [stockModalItem, allocations, returns, returnApprovals, adjDateFrom, adjDateTo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (category !== "All" && it.category !== category) return false;
      if (q && !it.name.toLowerCase().includes(q) && !it.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, category]);

  const totalItems = items.length;
  const lowStock = items.filter((i) => i.status === "Low").length;
  const critical = items.filter((i) => i.status === "Critical").length;
  const totalValue = items.reduce((s, i) => s + i.stock * i.unitCost, 0);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Items" value={totalItems} icon={Boxes} tone="navy" />
        <KpiCard label="Low Stock" value={lowStock} icon={AlertTriangle} tone="warning" />
        <KpiCard label="Critical" value={critical} icon={AlertTriangle} tone="red" />
        <KpiCard
          label="Stock Value"
          value={`৳ ${Math.round(totalValue).toLocaleString()}`}
          icon={Coffee}
          tone="success"
        />
      </div>

      <Card className="mb-4">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search consumables…"
                className="h-9"
              />
            </div>
            <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 shadow-sm flex-wrap">
              {(["All", ...CATEGORIES] as const).map((c) => {
                const active = category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c as typeof category)}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-medium rounded-sm transition-colors",
                      active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Stock Adjustments Modal ─────────────────────────────────────────── */}
      <Dialog
        open={!!stockModalItem}
        onOpenChange={(open) => {
          if (!open) { setStockModalItem(null); setFlightDetailRecord(null); setReturnDetailRecord(null); setAdjDateFrom(""); setAdjDateTo(""); }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Stock Adjustments — {stockModalItem?.name}</DialogTitle>
          </DialogHeader>
          {stockModalItem && (
            <div className="space-y-4 text-sm">
              {/* Item info chips */}
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center bg-muted/60 rounded px-2 py-1 text-xs font-mono">{stockModalItem.id}</span>
                <span className="inline-flex items-center bg-muted/60 rounded px-2 py-1 text-xs">{stockModalItem.category}</span>
                <span className="inline-flex items-center bg-muted/60 rounded px-2 py-1 text-xs">{stockModalItem.uom}</span>
                <span className="inline-flex items-center bg-primary/10 text-primary border border-primary/20 rounded px-2 py-1 text-xs font-semibold">
                  Current Stock: {stockModalItem.stock.toLocaleString()}
                </span>
              </div>
              {/* Date range filter */}
              <div className="flex items-center gap-2 flex-wrap bg-muted/30 rounded-md px-3 py-2">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground">Date Range:</span>
                <Input
                  type="date"
                  value={adjDateFrom}
                  onChange={(e) => setAdjDateFrom(e.target.value)}
                  className="h-7 w-[8.5rem] text-xs tabular-nums"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={adjDateTo}
                  onChange={(e) => setAdjDateTo(e.target.value)}
                  className="h-7 w-[8.5rem] text-xs tabular-nums"
                />
                {(adjDateFrom || adjDateTo) && (
                  <button
                    type="button"
                    onClick={() => { setAdjDateFrom(""); setAdjDateTo(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              {/* Adjustments table */}
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Return ID</th>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Date</th>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Flight No</th>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Sector</th>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Qty</th>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">UOM</th>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Status</th>
                      <th className="px-3 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemAdjustments.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-muted-foreground">
                          No stock adjustments found{adjDateFrom || adjDateTo ? " for the selected period" : ""}.
                        </td>
                      </tr>
                    ) : (
                      itemAdjustments.map((entry, i) => (
                        <tr key={entry.id + i} className="border-b border-border/50 hover:bg-muted/20">
                          {/* Return ID + type badge */}
                          <td className="px-3 py-2">
                            {entry.kind === "return" ? (
                              <button
                                type="button"
                                onClick={() => {
                                  sessionStorage.setItem("highlight-return-id", entry.id);
                                  setStockModalItem(null);
                                  navigate("/consumable-returns");
                                }}
                                className="font-mono font-semibold text-primary underline decoration-dotted underline-offset-2 hover:opacity-75 transition-opacity"
                                title="Go to Consumable Returns"
                              >
                                {entry.id}
                              </button>
                            ) : (
                              <div className="font-mono font-semibold text-primary">{entry.id}</div>
                            )}
                            <div className={cn(
                              "text-[10px] mt-0.5 font-medium",
                              entry.kind === "return" ? "text-emerald-600" : "text-rose-600",
                            )}>
                              {entry.kind === "return" ? "Return" : "Allocation"}
                            </div>
                          </td>
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap">{entry.date}</td>
                          <td className="px-3 py-2 font-semibold">{entry.flight}</td>
                          <td className="px-3 py-2 text-muted-foreground">{entry.sector}</td>
                          {/* Qty: green +IN for returns, red -OUT for allocations */}
                          <td className={cn(
                            "px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap",
                            entry.kind === "return" ? "text-emerald-700" : "text-rose-700",
                          )}>
                            {entry.kind === "return" ? "+" : "−"}{entry.qty.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{entry.uom}</td>
                          {/* Status */}
                          <td className="px-3 py-2">
                            {entry.kind === "return" && entry.approvalStatus ? (
                              <span className={cn(
                                "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border",
                                entry.approvalStatus === "Approved"  && "bg-success/10 border-success/30 text-success",
                                entry.approvalStatus === "Declined"  && "bg-destructive/10 border-destructive/30 text-destructive",
                                entry.approvalStatus === "Pending"   && "bg-warning/10 border-warning/40 text-warning-foreground",
                              )}>
                                {entry.approvalStatus}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          {/* View icon */}
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                if (entry.kind === "alloc") setFlightDetailRecord(entry.record);
                                else setReturnDetailRecord({ ret: entry.record, appr: entry.approval, focusItemId: stockModalItem?.id });
                              }}
                              className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                              title={entry.kind === "return" ? "View return details" : "View flight allocation"}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {itemAdjustments.length > 0 && (() => {
                const totalIn  = itemAdjustments.filter(e => e.kind === "return").reduce((s, e) => s + e.qty, 0);
                const totalOut = itemAdjustments.filter(e => e.kind === "alloc").reduce((s, e) => s + e.qty, 0);
                return (
                  <div className="flex items-center justify-end gap-4 text-xs text-muted-foreground">
                    <span>{itemAdjustments.length} movement{itemAdjustments.length !== 1 ? "s" : ""}</span>
                    {totalOut > 0 && <span>Issued out: <span className="font-semibold text-rose-700">−{totalOut.toLocaleString()} {stockModalItem.uom}</span></span>}
                    {totalIn  > 0 && <span>Returned in: <span className="font-semibold text-emerald-700">+{totalIn.toLocaleString()} {stockModalItem.uom}</span></span>}
                  </div>
                );
              })()}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setStockModalItem(null); setAdjDateFrom(""); setAdjDateTo(""); }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Flight Allocation Detail Modal ──────────────────────────────────── */}
      <Dialog
        open={!!flightDetailRecord}
        onOpenChange={(open) => { if (!open) setFlightDetailRecord(null); }}
      >
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Flight Allocation — {flightDetailRecord?.flight}</DialogTitle>
          </DialogHeader>
          {flightDetailRecord && (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center bg-muted/60 rounded px-2 py-1 text-xs font-mono">{flightDetailRecord.id}</span>
                <span className="inline-flex items-center bg-muted/60 rounded px-2 py-1 text-xs tabular-nums">{flightDetailRecord.date}</span>
                <span className="inline-flex items-center bg-muted/60 rounded px-2 py-1 text-xs tabular-nums">{flightDetailRecord.scheduledTime}</span>
                <span className="inline-flex items-center bg-primary/10 text-primary border border-primary/20 rounded px-2 py-1 text-xs font-semibold">
                  {flightDetailRecord.sector}
                </span>
              </div>
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Item Code</th>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Item Name</th>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">UOM</th>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Qty Issued</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flightDetailRecord.lines.map((l, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono text-[11px]">{l.itemId}</td>
                        <td className="px-3 py-2 font-medium">{l.itemName}</td>
                        <td className="px-3 py-2 text-muted-foreground">{l.uom}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{l.qty.toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/30 font-semibold">
                      <td colSpan={3} className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                        Total Lines
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{flightDetailRecord.lines.length}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFlightDetailRecord(null)}>Back</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Return Detail Modal ─────────────────────────────────────────────── */}
      <Dialog
        open={!!returnDetailRecord}
        onOpenChange={(open) => { if (!open) setReturnDetailRecord(null); }}
      >
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Consumable Return — {returnDetailRecord?.ret.id}</DialogTitle>
          </DialogHeader>
          {returnDetailRecord && (() => {
            const { ret, appr } = returnDetailRecord;
            return (
              <div className="space-y-4 text-sm">
              <style>{`@keyframes returnRowBlink{0%,100%{background-color:transparent}50%{background-color:#d1fae5}}`}</style>
                {/* Header chips */}
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center bg-muted/60 rounded px-2 py-1 text-xs tabular-nums">{ret.date}</span>
                  <span className="inline-flex items-center bg-muted/60 rounded px-2 py-1 text-xs tabular-nums">{ret.scheduledTime}</span>
                  <span className="inline-flex items-center bg-primary/10 text-primary border border-primary/20 rounded px-2 py-1 text-xs font-semibold">{ret.flight}</span>
                  <span className="inline-flex items-center bg-muted/60 rounded px-2 py-1 text-xs">{ret.sector}</span>
                  <span className="inline-flex items-center bg-muted/60 rounded px-2 py-1 text-xs">By: {ret.returnedBy}</span>
                </div>
                {/* Approval status banner */}
                {appr && (
                  <div className={cn(
                    "rounded-md border px-3 py-2 text-xs",
                    appr.status === "Approved" && "border-success/30 bg-success/5 text-success",
                    appr.status === "Declined" && "border-destructive/30 bg-destructive/5 text-destructive",
                    appr.status === "Pending"  && "border-warning/40 bg-warning/5 text-warning-foreground",
                  )}>
                    <span className="font-semibold uppercase tracking-wider text-[10px]">Airport Store Approval — {appr.status}</span>
                    {appr.processedBy && <span className="ml-2">· Processed by {appr.processedBy}</span>}
                    {appr.processedAt  && <span className="ml-1">on {appr.processedAt}</span>}
                    {appr.declineReason && <div className="mt-1">Reason: {appr.declineReason}</div>}
                  </div>
                )}
                {/* Items table */}
                <div className="border border-border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-b border-border">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Item Code</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Item Name</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">UOM</th>
                        <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Issued</th>
                        <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Returned</th>
                        <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Reusable</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ret.lines
                        .filter((l) => !returnDetailRecord.focusItemId || l.itemId === returnDetailRecord.focusItemId)
                        .map((l, i) => {
                        const apprLine = appr?.lines.find((al) => al.itemId === l.itemId);
                        const isFocused = !!returnDetailRecord.focusItemId && l.itemId === returnDetailRecord.focusItemId;
                        return (
                          <tr
                            key={i}
                            className="border-b border-border/50 hover:bg-muted/20"
                            style={isFocused ? { animation: "returnRowBlink 0.65s ease-in-out 3" } : undefined}
                          >
                            <td className="px-3 py-2 font-mono text-[11px]">{l.itemId}</td>
                            <td className="px-3 py-2 font-medium">{l.itemName}</td>
                            <td className="px-3 py-2 text-muted-foreground">{l.uom}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {l.issuedQty != null ? l.issuedQty : "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold">{l.qty}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {appr?.status === "Approved" && apprLine != null ? (
                                <span className={apprLine.reusableQty > 0 ? "text-emerald-700 font-semibold" : "text-muted-foreground"}>
                                  {apprLine.reusableQty > 0 ? `+${apprLine.reusableQty}` : "0"}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground italic text-[11px] max-w-[160px] truncate">
                              {l.reusable ? "Reusable" : (l.nonReusableReason || "—")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnDetailRecord(null)}>Back</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-14 text-xs uppercase tracking-wider">SL</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Code</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Category</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">UoM</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Stock</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Reorder</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Unit Cost</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Value</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Bin</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">
                  No items match the selected filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((it, i) => {
                const masterBin = MASTER_ITEMS.find(
                  (m) => m.name.toLowerCase() === it.name.toLowerCase(),
                )?.binLocation;
                const bin = masterBin ?? it.binLocation ?? "—";
                return (
                  <TableRow key={it.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{it.id}</TableCell>
                    <TableCell className="font-medium">{it.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{it.category}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{it.uom}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      <button
                        type="button"
                        onClick={() => setStockModalItem(it)}
                        className={cn(
                          "tabular-nums font-semibold underline decoration-dotted underline-offset-2 hover:opacity-75 transition-opacity",
                          flashItemIds?.has(it.id)
                            ? "text-emerald-700 decoration-emerald-400/60 animate-pulse bg-emerald-50 rounded px-1.5 py-0.5 -mx-1.5"
                            : it.status === "Critical" ? "text-destructive decoration-destructive/40" :
                              it.status === "Low" ? "text-warning decoration-amber-400/50" :
                              "decoration-muted-foreground/40",
                        )}
                        title="View stock adjustments by flight"
                      >
                        {it.stock.toLocaleString()}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{it.reorder.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">৳ {it.unitCost.toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      ৳ {Math.round(it.stock * it.unitCost).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {bin}
                        {masterBin && (
                          <Badge variant="outline" className="text-[9px] py-0 px-1 border-primary/30 bg-primary/5 text-primary">
                            profile
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell><StatusBadge status={it.status} /></TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function ConsumableCreate({ nextId, onSave }: { nextId: string; onSave: (it: ConsumableItem) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ConsumableCategory>("Napkin");
  const [uom, setUom] = useState("Pcs");
  const [stock, setStock] = useState("0");
  const [reorder, setReorder] = useState("0");
  const [unitCost, setUnitCost] = useState("");
  const [binLocation, setBinLocation] = useState("");

  const save = () => {
    if (!name.trim()) { toast.error("Item name is required."); return; }
    const s = Number(stock) || 0;
    const r = Number(reorder) || 0;
    const c = Number(unitCost) || 0;
    onSave({
      id: nextId,
      name: name.trim(),
      category,
      uom,
      stock: s,
      reorder: r,
      unitCost: c,
      binLocation: binLocation.trim() || undefined,
      status: computeStatus(s, r),
    });
    toast.success(`${name.trim()} added to consumables catalog.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Register Consumable Item</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Code</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cocktail Napkin" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Category</Label>
            <select value={category} onChange={(e) => setCategory(e.target.value as ConsumableCategory)} className={selectCls}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">UoM</Label>
            <select value={uom} onChange={(e) => setUom(e.target.value)} className={selectCls}>
              {UOMS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Opening Stock</Label>
            <Input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Reorder Level</Label>
            <Input type="number" min={0} value={reorder} onChange={(e) => setReorder(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Unit Cost (৳)</Label>
            <Input type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00" className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Bin Location</Label>
            <Input
              value={binLocation}
              onChange={(e) => setBinLocation(e.target.value)}
              placeholder="e.g. A1-R1-S1"
              className="mt-1 font-mono"
            />
          </div>
        </div>
        <div className="mt-4 text-[11px] text-muted-foreground bg-muted/40 border border-border rounded px-3 py-2">
          Status is auto-computed: <span className="font-semibold text-destructive">Critical</span> when stock &lt; 50% of reorder,
          {" "}<span className="font-semibold text-warning">Low</span> when stock &lt; reorder, else <span className="font-semibold text-success">OK</span>.
        </div>
      </CardContent>
    </Card>
  );
}
