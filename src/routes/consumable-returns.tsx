import { Fragment, useState } from "react";
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
  Plus, ArrowLeft, Save, Undo2, PackageCheck, Recycle, Trash2, X, Clock, Eye, Pencil, Search,
} from "lucide-react";
import { toast } from "sonner";
import {
  consumableItems,
  consumableUsage as SEED_USAGE,
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
  qty: number;
  issuedQty?: number;
  uom: string;
  reusable: boolean;
  nonReusableReason?: string;
};

type ConsumableReturn = {
  id: string;
  date: string;
  scheduledTime: string;
  flight: string;
  sector: string;
  returnedBy: string;
  savedAt?: string;
  lines: ReturnLine[];
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
  const [view, setView] = useState<"list" | "create" | "edit">("list");
  const [editTarget, setEditTarget] = useState<ConsumableReturn | null>(null);

  const [returns, setReturns] = usePersistedState<ConsumableReturn[]>("consumable-returns", []);
  const [inventoryItems, setInventoryItems] = usePersistedState<ConsumableItem[]>(
    "airline-consumables-items",
    consumableItems,
  );
  const [usage] = usePersistedState<ConsumableUsage[]>("consumable-usage", SEED_USAGE);

  const nextId = `CR-${String(7000 + returns.length + 1).padStart(4, "0")}`;

  const addReturn = (r: ConsumableReturn) => {
    setInventoryItems((prev) =>
      prev.map((item) => {
        const returnedQty = r.lines
          .filter((l) => l.itemId === item.id && l.reusable)
          .reduce((s, l) => s + l.qty, 0);
        return returnedQty > 0 ? { ...item, stock: item.stock + returnedQty } : item;
      }),
    );
    setReturns((prev) => [r, ...prev]);
    setView("list");
  };

  const updateReturn = (updated: ConsumableReturn) => {
    const old = editTarget!;
    setInventoryItems((prev) =>
      prev.map((item) => {
        const oldQty = old.lines
          .filter((l) => l.itemId === item.id && l.reusable)
          .reduce((s, l) => s + l.qty, 0);
        const newQty = updated.lines
          .filter((l) => l.itemId === item.id && l.reusable)
          .reduce((s, l) => s + l.qty, 0);
        const delta = newQty - oldQty;
        return delta !== 0 ? { ...item, stock: item.stock + delta } : item;
      }),
    );
    setReturns((prev) => prev.map((r) => (r.id === old.id ? updated : r)));
    setEditTarget(null);
    setView("list");
  };

  const handleEdit = (r: ConsumableReturn) => {
    setEditTarget(r);
    setView("edit");
  };

  const handleBack = () => {
    setEditTarget(null);
    setView("list");
  };

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

      {view === "list" && <ReturnList returns={returns} onEdit={handleEdit} />}
      {(view === "create" || view === "edit") && (
        <ReturnCreate
          key={editTarget?.id ?? "create"}
          nextId={nextId}
          inventoryItems={inventoryItems}
          usageLog={usage}
          onSave={view === "edit" ? updateReturn : addReturn}
          editRecord={editTarget ?? undefined}
        />
      )}
    </>
  );
}

// ── List ───────────────────────────────────────────────────────────────────

function ReturnList({
  returns,
  onEdit,
}: {
  returns: ConsumableReturn[];
  onEdit: (r: ConsumableReturn) => void;
}) {
  const [viewRecord, setViewRecord] = useState<ConsumableReturn | null>(null);
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
                      <TableHead className="text-xs uppercase tracking-wider text-right">QTY</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Reusable</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewRecord.lines.map((l, i) => (
                      <TableRow key={i} className="hover:bg-muted/30">
                        <TableCell>
                          <div className="font-medium text-sm">{l.itemName}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{l.itemId}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-xs whitespace-nowrap">
                          {l.qty} {l.uom}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              l.reusable
                                ? "border-success/40 bg-success/10 text-success"
                                : "border-destructive/40 bg-destructive/10 text-destructive",
                            )}
                          >
                            {l.reusable ? "Yes" : "No"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {!l.reusable ? l.nonReusableReason : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
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
              <TableHead className="text-xs uppercase tracking-wider">Returned QTY</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Reusable</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredReturns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
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

                      {/* Returned QTY — always shown */}
                      <TableCell className="tabular-nums text-xs font-semibold whitespace-nowrap">
                        {l.qty} {l.uom}
                      </TableCell>

                      {/* Reusable — always shown */}
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            l.reusable
                              ? "border-success/40 bg-success/10 text-success"
                              : "border-destructive/40 bg-destructive/10 text-destructive",
                          )}
                        >
                          {l.reusable ? "Yes" : "No"}
                        </Badge>
                        {!l.reusable && l.nonReusableReason && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 max-w-[160px] truncate">
                            {l.nonReusableReason}
                          </div>
                        )}
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
                            <button
                              type="button"
                              title="Edit"
                              onClick={() => onEdit(r)}
                              className="text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Pencil className="h-4 w-4" />
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
  reusable: boolean;
  nonReusableReason: string;
};

const emptyLine = (): DraftLine => ({
  itemId: "",
  qty: "",
  reusable: true,
  nonReusableReason: "",
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
          reusable: l.reusable,
          nonReusableReason: l.nonReusableReason ?? "",
        }))
      : [emptyLine()],
  );
  const flightsAtTime = FLIGHT_SCHEDULES.filter((f) => f.time === scheduledTime);
  const selectedSchedule = FLIGHT_SCHEDULES.find((f) => f.flight === flight);

  const handleTimeChange = (time: string) => {
    setScheduledTime(time);
    setFlight("");
  };

  const handleFlightChange = (flightNo: string) => {
    setFlight(flightNo);
    if (flightNo) {
      const issued = usageLog.filter((u) => u.flight === flightNo);
      setLines(
        issued.length > 0
          ? issued.map((u) => ({ itemId: u.itemId, qty: "", issuedQty: u.qty, reusable: true, nonReusableReason: "" }))
          : [emptyLine()],
      );
    } else {
      setLines([emptyLine()]);
    }
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
      const inv = inventoryItems.find((it) => it.id === l.itemId);
      if (!inv) { toast.error(`Line ${i + 1}: select an item.`); return; }
      const q = Number(l.qty);
      if (q < 0) { toast.error(`Line ${i + 1}: quantity cannot be negative.`); return; }
      if (!l.reusable && !l.nonReusableReason.trim()) {
        toast.error(`Line ${i + 1}: reason is required when item is non-reusable.`); return;
      }
    }

    const returnLines: ReturnLine[] = lines.map((l) => {
      const inv = inventoryItems.find((it) => it.id === l.itemId)!;
      return {
        itemId: inv.id,
        itemName: inv.name,
        qty: Number(l.qty),
        issuedQty: l.issuedQty,
        uom: inv.uom,
        reusable: l.reusable,
        nonReusableReason: l.reusable ? undefined : l.nonReusableReason.trim(),
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

    toast.success(
      `${recordId} ${isEdit ? "updated" : "saved"} — ${returnLines.length} item${returnLines.length !== 1 ? "s" : ""} for ${flight}.`,
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
                const inv = inventoryItems.find((it) => it.id === line.itemId);
                return (
                  <div key={idx} className="border border-border rounded-md p-4 bg-muted/20 relative">
                    {lines.length > 1 && (
                      <button
                        className="absolute top-3 right-3 text-muted-foreground hover:text-destructive transition-colors"
                        onClick={() => removeLine(idx)}
                        type="button"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-3">
                      <div className="md:col-span-2">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item *</Label>
                        <select
                          value={line.itemId}
                          onChange={(e) => updateLine(idx, { itemId: e.target.value })}
                          className={selectCls}
                        >
                          <option value="">Select item…</option>
                          {inventoryItems.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name} ({it.id})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Issued QTY</Label>
                        <div className="mt-1 h-9 flex items-center px-3 rounded-md border border-input bg-muted/40 text-sm tabular-nums text-muted-foreground">
                          {line.issuedQty != null ? `${line.issuedQty} ${inv?.uom ?? ""}` : "—"}
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Returned QTY *</Label>
                        <div className="mt-1 flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            value={line.qty}
                            onChange={(e) => updateLine(idx, { qty: e.target.value })}
                            className="tabular-nums"
                            placeholder="0"
                          />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {inv?.uom ?? "—"}
                          </span>
                        </div>
                      </div>
                      <div className="md:col-span-4">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Reusable?</Label>
                        <div className="mt-2 flex items-center gap-6 flex-wrap">
                          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <input
                              type="radio"
                              name={`reusable-${idx}`}
                              checked={line.reusable}
                              onChange={() => updateLine(idx, { reusable: true, nonReusableReason: "" })}
                            />
                            Yes
                          </label>
                          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <input
                              type="radio"
                              name={`reusable-${idx}`}
                              checked={!line.reusable}
                              onChange={() => updateLine(idx, { reusable: false })}
                            />
                            No
                          </label>
                          {!line.reusable && (
                            <Input
                              className="flex-1 min-w-[200px]"
                              placeholder="Brief reason (required)"
                              value={line.nonReusableReason}
                              onChange={(e) => updateLine(idx, { nonReusableReason: e.target.value })}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom save button */}
          <div className="flex justify-end mt-6 pt-4 border-t border-border">
            <Button onClick={save}>
              <Save className="h-4 w-4 mr-1.5" /> {isEdit ? "Update Return" : "Save Return"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
