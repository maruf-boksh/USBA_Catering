import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LayoutGrid, Plane, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { consumableItems, type ConsumableItem } from "@/lib/sample-data";
// Galley planning was relocated out of Dispatch Monitoring into this module.
// The plan editor (GalleyPlanningModal) and its data plumbing still live in
// dispatch-monitoring.tsx (exported); this page is the new launch surface.
import {
  flights, flightLabel, nowTimeStr,
  loadDispatchEntries, loadGalleyRecords, saveGalleyRecords,
  GalleyPlanningModal,
  type DispatchEntry, type GalleyLoadingRecord, type GalleyPlan, type GalleyStatus,
} from "@/routes/dispatch-monitoring";

// ── Galley Plan ↔ Airline Consumables integration ────────────────────────────
// Forwarding a galley plan creates a consumable Flight Allocation and deducts
// Inventory stock — the same allocation the Flight Allocation / Returns pages
// already work against. This maps the galley sheet's amenity/consumable fields
// onto the consumable item master so the module's pages connect to each other.
const GALLEY_CONSUMABLE_MAP: { key: string; itemId: string; itemName: string; uom: string }[] = [
  { key: "wetTissue",       itemId: "CNS-010", itemName: "Wet Hand Towel (Refresh)",      uom: "Pcs" },
  { key: "napkinPaper",     itemId: "CNS-001", itemName: "Dinner Napkin (Y-class)",       uom: "Pcs" },
  { key: "facialTissue",    itemId: "CNS-011", itemName: "Facial Tissue 100s",            uom: "Box" },
  { key: "paperCup",        itemId: "CNS-005", itemName: "Hot Beverage Cup 220ml (Lid)",  uom: "Pcs" },
  { key: "disposableSpoon", itemId: "CNS-006", itemName: "Plastic Spoon (Heavy Duty)",    uom: "Pcs" },
];

// These pages persist via usePersistedState (prefix "harvest-data-v1:"). We
// read/write the same keys directly so a galley forward flows into them.
const LSK = (k: string) => `harvest-data-v1:${k}`;
function readLS<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(LSK(key)); return raw ? (JSON.parse(raw) as T) : fallback; }
  catch { return fallback; }
}
function writeLS(key: string, val: unknown) {
  try { localStorage.setItem(LSK(key), JSON.stringify(val)); } catch { /* quota — non-fatal */ }
}

type AllocLine = { itemId: string; itemName: string; qty: number; uom: string };
type AllocRecord = { id: string; date: string; scheduledTime: string; flight: string; sector: string; lines: AllocLine[] };

/** Build a consumable allocation from a galley plan + post it to Inventory
 *  (deducting stock). Returns the number of lines allocated, or 0 if none. */
function allocateConsumables(plan: GalleyPlan, flight: string, sector: string, date: string, schedTime: string): number {
  const lines: AllocLine[] = GALLEY_CONSUMABLE_MAP
    .map((m) => ({ itemId: m.itemId, itemName: m.itemName, qty: Number(plan[m.key]) || 0, uom: m.uom }))
    .filter((l) => l.qty > 0);
  if (lines.length === 0) return 0;

  const stamp = Date.now().toString(36).slice(-5).toUpperCase();
  const alloc: AllocRecord = { id: `FA-G${stamp}`, date, scheduledTime: schedTime, flight, sector, lines };
  writeLS("consumable-allocations", [alloc, ...readLS<AllocRecord[]>("consumable-allocations", [])]);

  // Deduct from the consumable item master (seeding from sample data on first use).
  const items = readLS<ConsumableItem[]>("airline-consumables-items", consumableItems);
  const byId = new Map(lines.map((l) => [l.itemId, l.qty]));
  writeLS("airline-consumables-items", items.map((it) =>
    byId.has(it.id) ? { ...it, stock: it.stock - (byId.get(it.id) ?? 0) } : it,
  ));
  return lines.length;
}

const STATUS_LABEL: Record<GalleyStatus, string> = {
  forwarded: "Forwarded",
  loading: "Loading",
  completed: "Loaded",
  awaiting_approval: "Awaiting Approval",
  approved: "Approved",
};
const STATUS_CLASS: Record<GalleyStatus, string> = {
  forwarded: "bg-sky-100 text-sky-700 border-sky-200",
  loading: "bg-amber-100 text-amber-700 border-amber-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  awaiting_approval: "bg-violet-100 text-violet-700 border-violet-200",
  approved: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export default function GalleyPlanningPage() {
  const [entries] = useState<DispatchEntry[]>(() => loadDispatchEntries());
  const [galleyRecords, setGalleyRecords] = useState<GalleyLoadingRecord[]>(() => loadGalleyRecords());
  const [planEntryId, setPlanEntryId] = useState<string | null>(null);

  const recByEntry = useMemo(() => {
    const m = new Map<string, GalleyLoadingRecord>();
    for (const r of galleyRecords) m.set(r.dispatchEntryId, r);
    return m;
  }, [galleyRecords]);

  const plannedCount = galleyRecords.length;
  const pendingCount = entries.filter((e) => !recByEntry.has(e.id)).length;

  // Persist a finalized galley plan as a "forwarded" loading record — the same
  // hand-off Dispatch Monitoring then executes (Start Loading → QC → approve).
  const forward = (entryId: string, plan: GalleyPlan, signOff: GalleyLoadingRecord["signOff"]) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    const rec: GalleyLoadingRecord = {
      id: `GL-${Date.now().toString(36)}`,
      dispatchEntryId: entryId,
      flightId: entry.flightId,
      flightLabel: flightLabel(entry.flightId),
      date: entry.packagingDate,
      galleyPlan: plan,
      signOff,
      galleyStatus: "forwarded",
      forwardedAt: nowTimeStr(),
    };
    // Allocate consumables to Inventory on the FIRST forward only — re-planning
    // an already-forwarded entry must not double-deduct stock.
    const firstForward = !recByEntry.has(entryId);
    setGalleyRecords((prev) => {
      const next = [...prev.filter((r) => r.dispatchEntryId !== entryId), rec];
      saveGalleyRecords(next);
      return next;
    });
    let allocMsg = "";
    if (firstForward) {
      const fl = flights.find((f) => f.id === entry.flightId);
      const n = allocateConsumables(plan, fl?.flight ?? entry.flightId, fl?.sector ?? "", entry.packagingDate, fl?.dep ?? "");
      if (n > 0) allocMsg = ` · ${n} consumable line${n === 1 ? "" : "s"} allocated to Inventory`;
    } else {
      allocMsg = " · consumables already allocated";
    }
    setPlanEntryId(null);
    toast.success(`Galley plan forwarded to aircraft loading${allocMsg}.`);
  };

  const planEntry = planEntryId ? entries.find((e) => e.id === planEntryId) : undefined;
  const planFlight = planEntry ? flights.find((f) => f.id === planEntry.flightId) : undefined;

  return (
    <>
      <PageHeader
        title="Galley Planning"
        subtitle="Plan the per-flight galley load — meals, beverages, amenities, consumables & equipment — then forward to aircraft loading"
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <KpiCard label="Dispatches"   value={entries.length} icon={Plane}        tone="navy" />
        <KpiCard label="Galley Plans" value={plannedCount}   icon={CheckCircle2} tone="green" />
        <KpiCard label="Awaiting Plan" value={pendingCount}  icon={Clock}        tone="amber" />
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader style={{ backgroundColor: "#F6F2EF" }}>
                <TableRow>
                  <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Aircraft</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider">PAX</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider">Crew</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Galley Status</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                      No dispatches to plan.
                    </TableCell>
                  </TableRow>
                ) : entries.map((e) => {
                  const f = flights.find((x) => x.id === e.flightId);
                  const rec = recByEntry.get(e.id);
                  return (
                    <TableRow key={e.id} className="hover:bg-muted/30">
                      <TableCell className="font-semibold">{f?.flight ?? e.flightId}</TableCell>
                      <TableCell>{f?.sector ?? "—"}</TableCell>
                      <TableCell className="tabular-nums text-xs">{e.packagingDate}</TableCell>
                      <TableCell>{f?.aircraft ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{f?.pax ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{f?.crew ?? "—"}</TableCell>
                      <TableCell>
                        {rec ? (
                          <Badge variant="outline" className={`h-5 px-1.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_CLASS[rec.galleyStatus]}`}>
                            {STATUS_LABEL[rec.galleyStatus]}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 border-slate-300">
                            Not Planned
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => setPlanEntryId(e.id)}>
                          <LayoutGrid className="h-3 w-3 mr-1" /> {rec ? "Re-plan" : "Plan Galley"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {planEntry && (
        <GalleyPlanningModal
          entry={planEntry}
          flight={planFlight}
          onClose={() => setPlanEntryId(null)}
          onForward={(plan, signOff) => forward(planEntry.id, plan, signOff)}
        />
      )}
    </>
  );
}
