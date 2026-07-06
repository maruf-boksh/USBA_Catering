import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, ArrowLeft, Save, Undo2, PackageCheck, Recycle, Trash2, X, Clock, Eye, Search,
} from "lucide-react";
import { toast } from "sonner";
import {
  consumableItems,
  consumableUsage as SEED_USAGE,
  mealOrders,
  type ConsumableItem,
  type ConsumableUsage,
} from "@/lib/sample-data";
import { cn } from "@/lib/utils";

// Sourced from active session in production
const CURRENT_USER = "Md. Hossain";

// ── Types ──────────────────────────────────────────────────────────────────

type ReturnLine = {
  itemId: string;
  itemName: string;
  qty: number;           // Return QTY
  reusableQty?: number;  // Reusable QTY (subset of qty in good condition)
  issuedQty?: number;
  uom: string;
  reusable: boolean;
  nonReusableReason?: string;
  lineType?: "item" | "meal";
};

type ConsumableReturn = {
  id: string;
  date: string;
  scheduledTime: string;
  flight: string;
  sector: string;
  returnedBy: string;
  savedAt?: string;
  forwardToAirportStore?: boolean;
  approvalId?: string;
  lines: ReturnLine[];
};

// Shared with approval-management via "consumable-return-approvals" localStorage key
type ReturnApprovalRecord = {
  id: string;
  returnId: string;
  flight: string;
  sector: string;
  date: string;
  returnedBy: string;
  status: "Pending" | "Approved" | "Declined";
  processedBy?: string;
  processedAt?: string;
  declineReason?: string;
  lines: {
    itemId: string;
    itemName: string;
    lineType: "item" | "meal";
    uom: string;
    returnQty: number;
    reusableQty: number;
    partialReason?: string;
  }[];
};

type FlightSchedule = {
  time: string;
  flight: string;
  sector: string;
};

// ── Flight schedule seed ────────────────────────────────────────────────────

const FLIGHT_SCHEDULES: FlightSchedule[] = [
  { time: "06:30", flight: "BG-401", sector: "DAC→DXB" },
  { time: "06:30", flight: "BS-141", sector: "DAC→CGP" },
  { time: "08:45", flight: "BS-105", sector: "DAC→CXB" },
  { time: "10:15", flight: "BG-522", sector: "DAC→LHR" },
  { time: "14:00", flight: "VQ-901", sector: "DAC→KUL" },
];

const SCHEDULE_TIMES = [...new Set(FLIGHT_SCHEDULES.map((f) => f.time))].sort();

// ── Shared select style ─────────────────────────────────────────────────────

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed";

// ── Page ───────────────────────────────────────────────────────────────────

export default function ConsumableReturnsPage() {
  const [view, setView] = useState<"list" | "create">("list");

  const [returns, setReturns] = usePersistedState<ConsumableReturn[]>("consumable-returns", []);
  const [inventoryItems, setInventoryItems] = usePersistedState<ConsumableItem[]>(
    "airline-consumables-items",
    consumableItems,
  );
  const [usage] = usePersistedState<ConsumableUsage[]>("consumable-usage", SEED_USAGE);
  const [returnApprovals, setReturnApprovals] = usePersistedState<ReturnApprovalRecord[]>(
    "consumable-return-approvals",
    [],
  );

  const nextId = `CR-${String(7000 + returns.length + 1).padStart(4, "0")}`;
  const nextApprovalId = `RA-${String(8000 + returnApprovals.length + 1).padStart(4, "0")}`;

  // Add the reusable portion of a return straight back into the consumable
  // inventory, so it shows in Inventory & Store → Stock Overview immediately
  // (non-reusable / meal lines are wastage and are not restocked).
  const creditReusableToStock = (lines: ReturnLine[]) => {
    setInventoryItems((prev) => {
      const updated = [...prev];
      for (const l of lines) {
        if (l.lineType === "meal" || !l.reusable) continue;
        const rq = Number(l.qty) || 0;
        if (rq <= 0) continue;
        const idx = updated.findIndex((it) => it.id === l.itemId);
        if (idx === -1) continue;
        const item = updated[idx];
        const newStock = item.stock + rq;
        updated[idx] = {
          ...item,
          stock: newStock,
          status: newStock < item.reorder * 0.5 ? "Critical" : newStock < item.reorder ? "Low" : "OK",
        };
      }
      return updated;
    });
  };

  const addReturn = (r: ConsumableReturn) => {
    creditReusableToStock(r.lines);
    const approvalId = nextApprovalId;
    const approvalRecord: ReturnApprovalRecord = {
      id: approvalId,
      returnId: r.id,
      flight: r.flight,
      sector: r.sector,
      date: r.date,
      returnedBy: r.returnedBy,
      status: "Pending",
      lines: r.lines.map((l) => ({
        itemId: l.itemId,
        itemName: l.itemName,
        lineType: l.lineType ?? "item",
        uom: l.uom,
        returnQty: l.qty,
        reusableQty: 0,
      })),
    };
    setReturnApprovals((prev) => [approvalRecord, ...prev]);
    setReturns((prev) => [{ ...r, approvalId, forwardToAirportStore: true }, ...prev]);
    setView("list");
  };

  const handleBack = () => setView("list");

  return (
    <>
      <PageHeader
        title="Consumable Returns"
        subtitle="Post-flight consumable returns log — items returned by the dispatch handler on arrival"
        actions={
          <Button
            variant={view !== "list" ? "outline" : "default"}
            onClick={() => (view !== "list" ? handleBack() : setView("create"))}
          >
            {view !== "list"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> Log Return</>}
          </Button>
        }
      />

      {view === "list" && <ReturnList returns={returns} />}
      {view === "create" && (
        <ReturnCreate
          nextId={nextId}
          inventoryItems={inventoryItems}
          usageLog={usage}
          onSave={addReturn}
        />
      )}

    </>
  );
}

// ── List ───────────────────────────────────────────────────────────────────

function ReturnList({
  returns,
}: {
  returns: ConsumableReturn[];
}) {
  const [viewRecord, setViewRecord] = useState<ConsumableReturn | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = sessionStorage.getItem("highlight-return-id");
    if (id) {
      sessionStorage.removeItem("highlight-return-id");
      setHighlightId(id);
      highlightTimerRef.current = setTimeout(() => setHighlightId(null), 3500);
    }
    return () => { if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current); };
  }, []);
  const [searchItem, setSearchItem] = useState("");
  const [filterReusable, setFilterReusable] = useState<"all" | "yes" | "no">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filteredReturns = returns
    .map((r) => {
      const matchedLines = r.lines.filter((l) => {
        if (filterReusable !== "all") {
          const want = filterReusable === "yes";
          if (l.reusable !== want) return false;
        }
        if (searchItem.trim()) {
          const q = searchItem.trim().toLowerCase();
          if (!l.itemName.toLowerCase().includes(q)) return false;
        }
        return true;
      });
      return { ...r, lines: matchedLines };
    })
    .filter((r) => {
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo && r.date > dateTo) return false;
      if (r.lines.length === 0) return false;
      return true;
    });

  const total = returns.length;
  const totalItems = returns.reduce((s, r) => s + r.lines.length, 0);
  const reusableCount = returns.reduce((s, r) => s + r.lines.filter((l) => l.reusable).length, 0);
  const nonReusableCount = returns.reduce((s, r) => s + r.lines.filter((l) => !l.reusable).length, 0);

  return (
    <>
      <style>{`@keyframes returnRowBlink{0%,100%{background-color:transparent}50%{background-color:#d1fae5}}`}</style>
      {/* View modal */}
      <Dialog open={!!viewRecord} onOpenChange={(o) => !o && setViewRecord(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Return Details — {viewRecord?.id}</DialogTitle>
          </DialogHeader>
          {viewRecord && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm mb-4">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Returned By</div>
                  <div className="font-medium">{viewRecord.returnedBy}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Date</div>
                  <div className="tabular-nums">{viewRecord.date}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Saved At</div>
                  <div className="tabular-nums text-xs">
                    {viewRecord.savedAt
                      ? new Date(viewRecord.savedAt).toLocaleString("en-GB", {
                          day: "2-digit", month: "short", year: "numeric",
                          hour: "2-digit", minute: "2-digit", second: "2-digit",
                        })
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Time</div>
                  <div className="tabular-nums font-mono">{viewRecord.scheduledTime}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Flight</div>
                  <div className="font-semibold">{viewRecord.flight}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Sector</div>
                  <div>{viewRecord.sector}</div>
                </div>
              </div>
              <div className="border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Type</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Return QTY</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Restocked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewRecord.lines.map((l, i) => {
                      const restocked = l.lineType !== "meal" && l.reusable;
                      return (
                        <TableRow key={i} className="hover:bg-muted/30">
                          <TableCell>
                            <div className="font-medium text-sm">{l.itemName}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">{l.itemId}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">
                              {l.lineType === "meal" ? "Meal" : "Item"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold text-xs whitespace-nowrap">
                            {l.qty} {l.uom}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">
                            {restocked ? (
                              <span className="text-success font-semibold">{l.qty} {l.uom}</span>
                            ) : (
                              <span className="text-muted-foreground text-[10px]">{l.lineType === "meal" ? "—" : "Wastage"}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end mt-2">
                <Button variant="outline" onClick={() => setViewRecord(null)}>Close</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Returns" value={total} icon={Undo2} tone="navy" />
        <KpiCard label="Total Items" value={totalItems} icon={PackageCheck} tone="success" />
        <KpiCard label="Reusable" value={reusableCount} icon={Recycle} tone="warning" />
        <KpiCard label="Non-Reusable" value={nonReusableCount} icon={Trash2} tone="red" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex flex-col gap-1 min-w-[130px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">From</span>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs tabular-nums" />
        </div>
        <div className="flex flex-col gap-1 min-w-[130px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">To</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs tabular-nums" />
        </div>
        <div className="flex flex-col gap-1 min-w-[120px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Reusable</span>
          <select
            value={filterReusable}
            onChange={(e) => setFilterReusable(e.target.value as "all" | "yes" | "no")}
            className={cn(selectCls, "h-8 text-xs")}
          >
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Search Item</span>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={searchItem}
              onChange={(e) => setSearchItem(e.target.value)}
              placeholder="Item name…"
              className="h-8 text-xs pl-7"
            />
          </div>
        </div>
        {(dateFrom || dateTo || filterReusable !== "all" || searchItem) && (
          <button
            type="button"
            onClick={() => { setDateFrom(""); setDateTo(""); setFilterReusable("all"); setSearchItem(""); }}
            className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors self-end"
          >
            Clear
          </button>
        )}
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wider">Return ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Issued QTY</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Return QTY</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredReturns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                  {returns.length === 0 ? "No consumable returns logged yet." : "No records match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              filteredReturns.map((r) => (
                <Fragment key={r.id}>
                  {r.lines.map((l, li) => (
                    <TableRow
                      key={`${r.id}-L${li}`}
                      className={cn(
                        "hover:bg-muted/30 transition-colors",
                        li === 0 ? "border-t-2 border-t-primary/20" : "border-t border-t-border/40",
                      )}
                      style={r.id === highlightId ? { animation: "returnRowBlink 0.65s ease-in-out 3" } : undefined}
                    >
                      {/* Return ID — only first line */}
                      <TableCell>
                        {li === 0 && (
                          <span className="font-mono text-xs font-semibold text-primary">{r.id}</span>
                        )}
                      </TableCell>

                      {/* Date — only first line */}
                      <TableCell className="tabular-nums text-xs text-muted-foreground">
                        {li === 0 ? r.date : ""}
                      </TableCell>

                      {/* Flight — only first line */}
                      <TableCell>
                        {li === 0 && <span className="font-semibold text-sm">{r.flight}</span>}
                      </TableCell>

                      {/* Sector — only first line */}
                      <TableCell className="text-xs text-muted-foreground">
                        {li === 0 ? r.sector : ""}
                      </TableCell>

                      {/* Item — always shown */}
                      <TableCell>
                        <div className="font-medium text-sm">{l.itemName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{l.itemId}</div>
                      </TableCell>

                      {/* Issued QTY */}
                      <TableCell className="tabular-nums text-xs text-muted-foreground">
                        {l.issuedQty != null ? `${l.issuedQty} ${l.uom}` : "—"}
                      </TableCell>

                      {/* Return QTY — always shown */}
                      <TableCell className="tabular-nums text-xs font-semibold whitespace-nowrap">
                        {l.qty} {l.uom}
                      </TableCell>

                      {/* Actions — only first line */}
                      <TableCell className="text-right">
                        {li === 0 && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              title="View"
                              onClick={() => setViewRecord(r)}
                              className="text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ── Create / Edit form ─────────────────────────────────────────────────────

type DraftLine = {
  itemId: string;
  qty: string;
  issuedQty?: number;
  lineType: "item" | "meal";
  mealName?: string;
  reusable: boolean;
  nonReusableReason?: string;
};

const emptyLine = (): DraftLine => ({
  itemId: "",
  qty: "",
  lineType: "item",
  reusable: false,
});

function ReturnCreate({
  nextId,
  inventoryItems,
  usageLog,
  onSave,
  editRecord,
}: {
  nextId: string;
  inventoryItems: ConsumableItem[];
  usageLog: ConsumableUsage[];
  onSave: (r: ConsumableReturn) => void;
  editRecord?: ConsumableReturn;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!editRecord;

  const [scheduledTime, setScheduledTime] = useState(editRecord?.scheduledTime ?? "");
  const [flight, setFlight] = useState(editRecord?.flight ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    editRecord
      ? editRecord.lines.map((l) => ({
          itemId: l.itemId,
          qty: String(l.qty),
          issuedQty: l.issuedQty,
          lineType: l.lineType ?? "item",
          mealName: l.lineType === "meal" ? l.itemName : undefined,
          reusable: l.reusable ?? false,
          nonReusableReason: l.nonReusableReason,
        }))
      : [emptyLine()],
  );
  const flightsAtTime = FLIGHT_SCHEDULES.filter((f) => f.time === scheduledTime);
  const selectedSchedule = FLIGHT_SCHEDULES.find((f) => f.flight === flight);

  // Items/meals ISSUED to the selected flight — the options the return-line
  // dropdown offers (you return against what was issued). Not pre-listed; the
  // handler picks each from the DDL.
  type IssuedOption = {
    value: string; itemId: string; lineType: "item" | "meal"; name: string; issuedQty: number; uom: string;
  };
  const issuedOptions = useMemo<IssuedOption[]>(() => {
    if (!flight) return [];
    const items = usageLog
      .filter((u) => u.flight === flight)
      .map((u) => {
        const inv = inventoryItems.find((it) => it.id === u.itemId);
        return {
          value: `item:${u.itemId}`, itemId: u.itemId, lineType: "item" as const,
          name: inv?.name ?? u.itemId, issuedQty: u.qty, uom: inv?.uom ?? "Pcs",
        };
      });
    const meals = mealOrders
      .filter((m) => m.flight === flight)
      .map((m) => ({
        value: `meal:${m.id}`, itemId: m.id, lineType: "meal" as const,
        name: `${m.mealType} — ${m.menuStandard} (${m.serviceGroup})`, issuedQty: m.items, uom: "Pcs",
      }));
    return [...items, ...meals];
  }, [flight, usageLog, inventoryItems]);

  const handleTimeChange = (time: string) => {
    setScheduledTime(time);
    setFlight("");
  };

  // Selecting a flight auto-populates lines from issued consumable usage + meal
  // orders for that flight; falls back to a single empty line if none found.
  const handleFlightChange = (flightNo: string) => {
    setFlight(flightNo);
    if (flightNo) {
      const itemLines: DraftLine[] = usageLog
        .filter((u) => u.flight === flightNo)
        .map((u) => ({
          itemId: u.itemId, qty: "", issuedQty: u.qty,
          lineType: "item" as const, reusable: false, nonReusableReason: "",
        }));
      const mealLines: DraftLine[] = mealOrders
        .filter((m) => m.flight === flightNo)
        .map((m) => ({
          itemId: m.id, qty: "", issuedQty: m.items,
          lineType: "meal" as const,
          mealName: `${m.mealType} — ${m.menuStandard} (${m.serviceGroup})`,
          reusable: false, nonReusableReason: "",
        }));
      const all = [...itemLines, ...mealLines];
      setLines(all.length > 0 ? all : [emptyLine()]);
    } else {
      setLines([emptyLine()]);
    }
  };

  const pickIssued = (idx: number, value: string) => {
    const opt = issuedOptions.find((o) => o.value === value);
    if (!opt) { updateLine(idx, { itemId: "", issuedQty: undefined, mealName: undefined }); return; }
    updateLine(idx, {
      itemId: opt.itemId,
      lineType: opt.lineType,
      mealName: opt.lineType === "meal" ? opt.name : undefined,
      issuedQty: opt.issuedQty,
    });
  };

  const updateLine = (idx: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const save = () => {
    if (!scheduledTime) { toast.error("Select a scheduled time."); return; }
    if (!flight) { toast.error("Select a flight."); return; }
    if (lines.length === 0) { toast.error("Add at least one item."); return; }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.lineType === "item") {
        const inv = inventoryItems.find((it) => it.id === l.itemId);
        if (!inv) { toast.error(`Line ${i + 1}: select an item.`); return; }
      } else {
        if (!l.itemId) { toast.error(`Line ${i + 1}: meal item missing.`); return; }
      }
      const q = Number(l.qty);
      if (isNaN(q) || q < 0) { toast.error(`Line ${i + 1}: invalid return quantity.`); return; }
      if (!l.reusable && !l.nonReusableReason?.trim()) { toast.error(`Line ${i + 1}: justification required when not reusable.`); return; }
    }

    const returnLines: ReturnLine[] = lines.map((l) => {
      if (l.lineType === "meal") {
        return {
          itemId: l.itemId,
          itemName: l.mealName ?? l.itemId,
          qty: Number(l.qty),
          issuedQty: l.issuedQty,
          uom: "Pcs",
          reusable: l.reusable,
          nonReusableReason: l.reusable ? undefined : l.nonReusableReason,
          lineType: "meal" as const,
        };
      }
      const inv = inventoryItems.find((it) => it.id === l.itemId)!;
      return {
        itemId: inv.id,
        itemName: inv.name,
        qty: Number(l.qty),
        issuedQty: l.issuedQty,
        uom: inv.uom,
        reusable: l.reusable,
        nonReusableReason: l.reusable ? undefined : l.nonReusableReason,
        lineType: "item" as const,
      };
    });

    const recordId = isEdit ? editRecord!.id : nextId;

    onSave({
      id: recordId,
      date: isEdit ? editRecord!.date : today,
      scheduledTime,
      flight,
      sector: selectedSchedule?.sector ?? "",
      returnedBy: isEdit ? editRecord!.returnedBy : CURRENT_USER,
      savedAt: isEdit ? editRecord!.savedAt : new Date().toISOString(),
      lines: returnLines,
    });

    const reusableCount = returnLines.filter((l) => l.lineType !== "meal" && l.reusable).length;
    toast.success(
      `${recordId} saved — ${returnLines.length} line${returnLines.length !== 1 ? "s" : ""} for ${flight}` +
      (reusableCount > 0 ? ` · ${reusableCount} reusable item${reusableCount !== 1 ? "s" : ""} added to Stock Overview.` : "."),
    );
  };

  return (
    <>
      {/* Form */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider">
              {isEdit ? "Edit Consumable Return" : "Log Consumable Return"}
            </h3>
          </div>

          {/* Header fields */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-4 mb-6">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Return ID</Label>
              <Input value={isEdit ? editRecord!.id : nextId} disabled className="mt-1 font-mono" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
              <Input value={isEdit ? editRecord!.date : today} disabled className="mt-1 tabular-nums" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> Scheduled Time *
              </Label>
              <select
                value={scheduledTime}
                onChange={(e) => handleTimeChange(e.target.value)}
                className={selectCls}
              >
                <option value="">Select time…</option>
                {SCHEDULE_TIMES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Flight *</Label>
              <select
                value={flight}
                onChange={(e) => handleFlightChange(e.target.value)}
                className={selectCls}
                disabled={!scheduledTime}
              >
                <option value="">Select flight…</option>
                {flightsAtTime.map((f) => (
                  <option key={f.flight} value={f.flight}>
                    {f.flight} — {f.sector}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Item lines */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Items Returned</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add new
              </Button>
            </div>

            <div className="space-y-3">
              {lines.map((line, idx) => {
                const inv = line.lineType === "item" ? inventoryItems.find((it) => it.id === line.itemId) : undefined;
                const uomLabel = line.lineType === "meal" ? "Pcs" : (inv?.uom ?? "—");
                return (
                  <div
                    key={idx}
                    className={cn(
                      "border rounded-md p-4 bg-muted/20 relative",
                      line.lineType === "meal" ? "border-indigo-200 bg-indigo-50/30" : "border-border",
                    )}
                  >
                    {/* Line type badge */}
                    <span className={cn(
                      "absolute top-3 left-3 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded",
                      line.lineType === "meal" ? "bg-indigo-100 text-indigo-700" : "bg-muted text-muted-foreground",
                    )}>
                      {line.lineType === "meal" ? "Meal" : "Item"}
                    </span>
                    {lines.length > 1 && (
                      <button
                        className="absolute top-3 right-3 text-muted-foreground hover:text-destructive transition-colors"
                        onClick={() => removeLine(idx)}
                        type="button"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-x-6 gap-y-3 mt-5">
                      {/* Issued-item selector (DDL of what was issued to the flight) */}
                      <div className="md:col-span-2">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item *</Label>
                        <select
                          value={line.itemId ? `${line.lineType}:${line.itemId}` : ""}
                          onChange={(e) => pickIssued(idx, e.target.value)}
                          className={selectCls}
                          disabled={!flight}
                        >
                          <option value="">
                            {!flight ? "Select a flight first…" : issuedOptions.length === 0 ? "No issued items for this flight" : "Select issued item…"}
                          </option>
                          {/* Keep the current selection visible even if not in the list (edit) */}
                          {line.itemId && !issuedOptions.some((o) => o.value === `${line.lineType}:${line.itemId}`) && (
                            <option value={`${line.lineType}:${line.itemId}`}>
                              {line.mealName ?? inv?.name ?? line.itemId}
                            </option>
                          )}
                          {issuedOptions.map((o) => {
                            const takenByOther = lines.some((l, i) => i !== idx && l.itemId && `${l.lineType}:${l.itemId}` === o.value);
                            return (
                              <option key={o.value} value={o.value} disabled={takenByOther}>
                                {o.name} · issued {o.issuedQty} {o.uom}{o.lineType === "meal" ? " (Meal)" : ""}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      {/* Issued QTY */}
                      <div>
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Issued QTY</Label>
                        <div className="mt-1 h-9 flex items-center px-3 rounded-md border border-input bg-muted/40 text-sm tabular-nums text-muted-foreground">
                          {line.issuedQty != null ? `${line.issuedQty} ${uomLabel}` : "—"}
                        </div>
                      </div>
                      {/* Return QTY */}
                      <div>
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Return QTY *</Label>
                        <div className="mt-1 flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            value={line.qty}
                            onChange={(e) => updateLine(idx, { qty: e.target.value })}
                            className="tabular-nums"
                            placeholder="0"
                          />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{uomLabel}</span>
                        </div>
                      </div>
                      {/* Reusable */}
                      <div className={cn(line.reusable === false ? "md:col-span-2" : "")}>
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Reusable</Label>
                        <div className="mt-2 flex items-center gap-4">
                          <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                            <input
                              type="radio"
                              name={`reusable-${idx}`}
                              checked={line.reusable === true}
                              onChange={() => updateLine(idx, { reusable: true, nonReusableReason: "" })}
                            />
                            Yes
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                            <input
                              type="radio"
                              name={`reusable-${idx}`}
                              checked={line.reusable === false}
                              onChange={() => updateLine(idx, { reusable: false })}
                            />
                            No
                          </label>
                        </div>
                        {line.reusable === false && (
                          <Input
                            className="mt-2 text-xs"
                            placeholder="Justification (required)"
                            value={line.nonReusableReason ?? ""}
                            onChange={(e) => updateLine(idx, { nonReusableReason: e.target.value })}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom button */}
          <div className="flex justify-end mt-6 pt-4 border-t border-border">
            <Button onClick={save}>
              <Save className="h-4 w-4 mr-1.5" /> Save Return
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
