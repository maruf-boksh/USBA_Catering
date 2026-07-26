import { Fragment, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { roundQty } from "@/lib/num";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plane, Layers, Coins, Plus, ArrowLeft, Save, Clock, X, Search, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  consumableUsage as SEED_USAGE,
  consumableItems,
  type ConsumableItem,
} from "@/lib/sample-data";

// ── Types ──────────────────────────────────────────────────────────────────

type AllocLine = {
  itemId: string;
  itemName: string;
  qty: number;
  uom: string;
};

type LegDirection = "Outbound" | "Return";

type AllocRecord = {
  id: string;
  date: string;
  scheduledTime: string;
  flight: string;
  sector: string;
  /** The return leg of the same rotation. One allocation covers BOTH legs, so
   *  the outbound is `flight`/`sector` and the return is recorded here. Absent
   *  on galley-forwarded and seed records, which are single-leg. */
  returnFlight?: string;
  returnSector?: string;
  lines: AllocLine[];
  // Source location the stock was transferred from (galley-forwarded allocs).
  officeId?: string;
  warehouseId?: string;
  officeName?: string;
  warehouseName?: string;
};

type DraftAllocLine = {
  itemId: string;
  qty: string;
};

/** A single-leg record's direction, derived from its sector the way the order
 *  book does (DAC→X out, X→DAC back). Rotation records name both legs outright. */
const directionOf = (sector: string): LegDirection =>
  (sector ?? "").trim().toUpperCase().startsWith("DAC") ? "Outbound" : "Return";

/** Outbound / Return chip — the same colours the galley plan legs use. */
function DirBadge({ direction }: { direction: LegDirection }) {
  return (
    <Badge
      variant="outline"
      className={`h-4 px-1.5 text-[9px] font-bold uppercase tracking-wider ${
        direction === "Return"
          ? "bg-amber-100 text-amber-700 border-amber-200"
          : "bg-emerald-100 text-emerald-700 border-emerald-200"
      }`}
    >
      {direction}
    </Badge>
  );
}

// ── Flight schedule seed ────────────────────────────────────────────────────
// Every outbound flight returns, and the rotation is allocated ONCE — picking
// the flight covers both its legs, so each row carries the return leg with it.

const FLIGHT_SCHEDULES = [
  { time: "06:30", flight: "BG-401", sector: "DAC→DXB", returnFlight: "BG-402", returnSector: "DXB→DAC" },
  { time: "06:30", flight: "BS-141", sector: "DAC→CGP", returnFlight: "BS-142", returnSector: "CGP→DAC" },
  { time: "08:45", flight: "BS-105", sector: "DAC→CXB", returnFlight: "BS-106", returnSector: "CXB→DAC" },
  { time: "10:15", flight: "BG-522", sector: "DAC→LHR", returnFlight: "BG-523", returnSector: "LHR→DAC" },
  { time: "14:00", flight: "VQ-901", sector: "DAC→KUL", returnFlight: "VQ-904", returnSector: "KUL→DAC" },
];

// ── Shared select style ─────────────────────────────────────────────────────

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed";

// ── Page ───────────────────────────────────────────────────────────────────

export default function FlightAllocationPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [allocations, setAllocations] = usePersistedState<AllocRecord[]>("consumable-allocations", []);
  const [inventoryItems, setInventoryItems] = usePersistedState<ConsumableItem[]>(
    "airline-consumables-items",
    consumableItems,
  );

  const nextId = `FA-${String(1000 + allocations.length + 1).padStart(4, "0")}`;

  const addAllocation = (r: AllocRecord) => {
    setInventoryItems((prev) =>
      prev.map((item) => {
        const issuedQty = r.lines
          .filter((l) => l.itemId === item.id)
          .reduce((s, l) => s + l.qty, 0);
        return issuedQty > 0 ? { ...item, stock: roundQty(item.stock - issuedQty) } : item;
      }),
    );
    setAllocations((prev) => [r, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Flight Allocation"
        subtitle="Consumables loaded per flight. Most allocations flow from a forwarded Galley Plan; use Ad-hoc Allocation only for off-plan loads (unplanned flights, top-ups, corrections)."
        actions={
          <Button
            variant={view !== "list" ? "outline" : "default"}
            onClick={() => (view !== "list" ? setView("list") : setView("create"))}
          >
            {view !== "list"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> Ad-hoc Allocation</>}
          </Button>
        }
      />

      {view === "list" && (
        <AllocationList allocations={allocations} inventoryItems={inventoryItems} />
      )}
      {view === "create" && (
        <AllocationCreate
          nextId={nextId}
          inventoryItems={inventoryItems}
          allocations={allocations}
          onSave={addAllocation}
        />
      )}
    </>
  );
}

// ── List ───────────────────────────────────────────────────────────────────

function AllocationList({
  allocations,
  inventoryItems,
}: {
  allocations: AllocRecord[];
  inventoryItems: ConsumableItem[];
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Convert new AllocRecord[] to the same row shape as SEED_USAGE and merge.
  // A rotation record carries both its legs so the ledger shows the round trip.
  const allocRows = allocations.flatMap((a) =>
    a.lines.map((l) => ({
      id: `${a.id}-${l.itemId}`,
      date: a.date,
      flight: a.flight,
      sector: a.sector,
      returnFlight: a.returnFlight,
      returnSector: a.returnSector,
      cabinClass: "Economy",
      itemId: l.itemId,
      itemName: l.itemName,
      qty: l.qty,
      uom: l.uom,
    })),
  );

  // Source warehouse per flight (galley-forwarded allocs carry it) — shown on
  // the flight group header so the transfer origin is visible in the ledger.
  const sourceByFlight = new Map<string, string>();
  for (const a of allocations) {
    if (a.warehouseName && !sourceByFlight.has(a.flight)) sourceByFlight.set(a.flight, a.warehouseName);
  }

  // Seed rows are single-leg — they carry no return leg of their own.
  const seedRows = SEED_USAGE.map((r) => ({
    ...r,
    returnFlight: undefined as string | undefined,
    returnSector: undefined as string | undefined,
  }));
  const allRows = [...allocRows, ...seedRows];

  // KPIs always reflect full dataset
  const kpiFlight = new Set(allRows.map((r) => r.flight)).size;
  const kpiLines = allRows.length;
  const kpiValue = allRows.reduce((s, u) => {
    const item = inventoryItems.find((i) => i.id === u.itemId);
    return s + u.qty * (item?.unitCost ?? 0);
  }, 0);

  // Apply filters
  const filteredRows = allRows.filter((r) => {
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      if (!r.flight.toLowerCase().includes(q) && !r.itemName.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Group filtered rows by flight
  const byFlight = new Map<string, typeof allRows>();
  for (const u of filteredRows) {
    if (!byFlight.has(u.flight)) byFlight.set(u.flight, []);
    byFlight.get(u.flight)!.push(u);
  }
  const entries = Array.from(byFlight.entries());

  const hasFilters = !!(dateFrom || dateTo || searchQuery.trim());

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Flights" value={kpiFlight} icon={Plane} tone="navy" />
        <KpiCard label="Item Lines" value={kpiLines} icon={Layers} tone="warning" />
        <KpiCard
          label="Total Value"
          value={`৳ ${Math.round(kpiValue).toLocaleString()}`}
          icon={Coins}
          tone="success"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex flex-col gap-1 min-w-[130px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">From</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 text-xs tabular-nums"
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[130px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">To</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 text-xs tabular-nums"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Search Flight / Item</span>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Flight number or item name…"
              className="h-8 text-xs pl-7"
            />
          </div>
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={() => { setDateFrom(""); setDateTo(""); setSearchQuery(""); }}
            className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors self-end"
          >
            Clear
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {allRows.length === 0
              ? "No flight allocations recorded yet."
              : "No records match the current filters."}
          </CardContent>
        </Card>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="text-xs uppercase tracking-wider">Flight / Item</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-right">Unit Cost</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(([flight, rows]) => {
                const sector = rows[0]?.sector ?? "—";
                const retFlight = rows[0]?.returnFlight;
                const retSector = rows[0]?.returnSector;
                // A rotation names both its legs; a single-leg record derives its
                // own direction from its sector.
                const legs = retFlight
                  ? [
                      { dir: "Outbound" as LegDirection, flight, sector },
                      { dir: "Return" as LegDirection, flight: retFlight, sector: retSector ?? "—" },
                    ]
                  : [{ dir: directionOf(sector), flight, sector }];
                const flightValue = rows.reduce((s, r) => {
                  const item = inventoryItems.find((i) => i.id === r.itemId);
                  return s + r.qty * (item?.unitCost ?? 0);
                }, 0);
                return (
                  <Fragment key={flight}>
                    <TableRow className="bg-primary/5 hover:bg-primary/10 border-t-2 border-t-primary/40">
                      <TableCell colSpan={4} className="py-2">
                        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 align-middle">
                          {legs.map((leg, i) => (
                            <Fragment key={leg.dir}>
                              {i > 0 && <span className="text-muted-foreground">⇄</span>}
                              <DirBadge direction={leg.dir} />
                              <span className="font-mono text-sm font-semibold text-primary">{leg.flight}</span>
                              <span className="text-[11px] text-muted-foreground">{leg.sector}</span>
                            </Fragment>
                          ))}
                        </span>
                        <span className="ml-3 text-[11px] text-muted-foreground tabular-nums">
                          {rows.length} item{rows.length === 1 ? "" : "s"}
                        </span>
                        {sourceByFlight.get(flight) && (
                          <span className="ml-3 text-[11px] text-muted-foreground">
                            · From <span className="font-medium text-foreground">{sourceByFlight.get(flight)}</span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-primary">
                        ৳ {Math.round(flightValue).toLocaleString()}
                      </TableCell>
                    </TableRow>
                    {rows.map((r) => {
                      const item = inventoryItems.find((i) => i.id === r.itemId);
                      const unitCost = item?.unitCost ?? 0;
                      return (
                        <TableRow key={r.id} className="hover:bg-muted/30">
                          <TableCell className="pl-8">
                            <div className="font-medium text-sm">{r.itemName}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">{r.itemId}</div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.sector}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.qty.toLocaleString()} {r.uom}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">৳ {unitCost.toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            ৳ {Math.round(r.qty * unitCost).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

// ── Create form ─────────────────────────────────────────────────────────────

const emptyDraftLine = (): DraftAllocLine => ({ itemId: "", qty: "" });

function AllocationCreate({
  nextId,
  inventoryItems,
  allocations,
  onSave,
}: {
  nextId: string;
  inventoryItems: ConsumableItem[];
  allocations: AllocRecord[];
  onSave: (r: AllocRecord) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const [flight, setFlight] = useState("");
  // Which leg(s) of the rotation this allocation loads. Default both; the return
  // toggle is only meaningful when the picked flight actually has a return leg.
  const [legs, setLegs] = useState<{ outbound: boolean; return: boolean }>({ outbound: true, return: true });
  const [lines, setLines] = useState<DraftAllocLine[]>([emptyDraftLine()]);
  const [ack, setAck] = useState(false);

  const selectedSchedule = FLIGHT_SCHEDULES.find((f) => f.flight === flight);
  // Flight Time is the picked flight's scheduled ETD — no longer chosen directly.
  const scheduledTime = selectedSchedule?.time ?? "";
  const hasReturn = !!selectedSchedule?.returnFlight;
  const wantOutbound = legs.outbound;
  const wantReturn = legs.return && hasReturn;
  // Return-only loads are recorded against the return flight itself.
  const primaryFlight = !wantOutbound && wantReturn ? (selectedSchedule?.returnFlight ?? flight) : flight;

  // Duplicate guard: an allocation for this flight may already exist — a
  // galley-forwarded one (id "FA-G…") especially, since that already deducted
  // stock. Recording another here is an *additional* load, so we surface it.
  const existingForFlight = primaryFlight ? allocations.filter((a) => a.flight === primaryFlight) : [];
  const galleyForwarded = existingForFlight.some((a) => a.id.startsWith("FA-G"));

  const handleFlightChange = (f: string) => {
    setFlight(f);
    setLegs({ outbound: true, return: true });
    setAck(false);
  };

  const updateLine = (idx: number, patch: Partial<DraftAllocLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const save = () => {
    if (!flight) { toast.error("Select a flight number."); return; }
    if (!wantOutbound && !wantReturn) { toast.error("Select at least one leg — Outbound or Return."); return; }
    if (galleyForwarded && !ack) {
      toast.error(`${primaryFlight} already has a galley-forwarded allocation. Tick the acknowledgement to record an additional ad-hoc load.`);
      return;
    }
    if (lines.length === 0) { toast.error("Add at least one item."); return; }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.itemId) { toast.error(`Line ${i + 1}: select an item.`); return; }
      const q = Number(l.qty);
      if (!q || q <= 0) { toast.error(`Line ${i + 1}: quantity must be positive.`); return; }
    }

    const allocLines: AllocLine[] = lines.map((l) => {
      const inv = inventoryItems.find((it) => it.id === l.itemId)!;
      return {
        itemId: inv.id,
        itemName: inv.name,
        qty: Number(l.qty),
        uom: inv.uom,
      };
    });

    // Shape the record to the chosen legs: both → outbound + its return; outbound
    // only → single outbound leg; return only → recorded against the return flight.
    let recFlight = flight;
    let recSector = selectedSchedule?.sector ?? "";
    let recReturnFlight: string | undefined;
    let recReturnSector: string | undefined;
    if (wantOutbound && wantReturn) {
      recReturnFlight = selectedSchedule?.returnFlight;
      recReturnSector = selectedSchedule?.returnSector;
    } else if (!wantOutbound && wantReturn) {
      recFlight = selectedSchedule?.returnFlight ?? flight;
      recSector = selectedSchedule?.returnSector ?? "";
    }

    onSave({
      id: nextId,
      date: today,
      scheduledTime,
      flight: recFlight,
      sector: recSector,
      returnFlight: recReturnFlight,
      returnSector: recReturnSector,
      lines: allocLines,
    });

    toast.success(
      `${nextId} issued — ${allocLines.length} item${allocLines.length !== 1 ? "s" : ""} allocated to ${recFlight}${recReturnFlight ? ` / ${recReturnFlight}` : ""}.`,
    );
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">New Ad-hoc Allocation</h3>
        </div>

        {/* Header fields */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-4 mb-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Allocation ID</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
            <Input value={today} disabled className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Flight Number *</Label>
            <select
              value={flight}
              onChange={(e) => handleFlightChange(e.target.value)}
              className={selectCls}
            >
              <option value="">Select flight…</option>
              {FLIGHT_SCHEDULES.map((f) => (
                <option key={f.flight} value={f.flight}>
                  {f.flight}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Flight Time (ETD)
            </Label>
            <Input
              value={scheduledTime || "—"}
              disabled
              className="mt-1 tabular-nums"
              title="Auto-filled from the selected flight's scheduled departure"
            />
          </div>
        </div>

        {/* Leg selection — pick which leg(s) of the rotation to load. Return is
            offered only when the picked flight actually has a return leg. */}
        <div className="mb-6">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Legs to Load *</Label>
          {selectedSchedule ? (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <label className={`flex items-center gap-2 rounded-md border px-3 h-9 cursor-pointer select-none text-sm ${legs.outbound ? "border-primary bg-primary/5" : "border-input"}`}>
                <input
                  type="checkbox"
                  checked={legs.outbound}
                  onChange={(e) => setLegs((p) => ({ ...p, outbound: e.target.checked }))}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <DirBadge direction="Outbound" />
                <span className="text-muted-foreground">{selectedSchedule.sector}</span>
              </label>
              <label
                className={`flex items-center gap-2 rounded-md border px-3 h-9 select-none text-sm ${
                  !hasReturn ? "border-input opacity-50 cursor-not-allowed" : legs.return ? "border-primary bg-primary/5 cursor-pointer" : "border-input cursor-pointer"
                }`}
                title={hasReturn ? undefined : "This flight has no return leg"}
              >
                <input
                  type="checkbox"
                  checked={wantReturn}
                  disabled={!hasReturn}
                  onChange={(e) => setLegs((p) => ({ ...p, return: e.target.checked }))}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <DirBadge direction="Return" />
                <span className="text-muted-foreground">{hasReturn ? `${selectedSchedule.returnFlight} · ${selectedSchedule.returnSector}` : "—"}</span>
              </label>
            </div>
          ) : (
            <div className="mt-1 h-9 w-fit min-w-[8rem] flex items-center px-3 rounded-md border border-input bg-muted/40 text-sm text-muted-foreground">
              Select a flight first
            </div>
          )}
        </div>

        {/* Duplicate-load warning */}
        {existingForFlight.length > 0 && (
          <div className={`mb-6 rounded-md border px-4 py-3 ${galleyForwarded ? "border-amber-300 bg-amber-50" : "border-sky-200 bg-sky-50"}`}>
            <div className="flex items-start gap-2">
              <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${galleyForwarded ? "text-amber-600" : "text-sky-600"}`} />
              <div className="text-xs">
                <p className={`font-semibold ${galleyForwarded ? "text-amber-800" : "text-sky-800"}`}>
                  {flight} already has {existingForFlight.length} allocation{existingForFlight.length === 1 ? "" : "s"} on record
                  {galleyForwarded ? " — including one forwarded from a Galley Plan." : "."}
                </p>
                <p className="text-muted-foreground mt-0.5">
                  {galleyForwarded
                    ? "That plan already issued its consumables from stock. Anything you add here is an additional ad-hoc load and will deduct stock again."
                    : "Recording another allocation here will deduct stock again for this flight."}
                </p>
                {galleyForwarded && (
                  <label className="mt-2 flex items-center gap-2 text-amber-800 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                      className="h-3.5 w-3.5 accent-amber-600"
                    />
                    I understand — this is an additional ad-hoc load, not the planned one.
                  </label>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Item lines */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Items</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLines((prev) => [...prev, emptyDraftLine()])}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add New
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                    <div>
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
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item QTY *</Label>
                      <div className="mt-1 flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
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
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Save and Issue button */}
        <div className="flex justify-end mt-6 pt-4 border-t border-border">
          <Button onClick={save} disabled={galleyForwarded && !ack}>
            <Save className="h-4 w-4 mr-1.5" /> Save and Issue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
