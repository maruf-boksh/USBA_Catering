import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Coffee, Boxes, AlertTriangle, CheckCircle2, Send, Wallet, TrendingDown,
  Plane, LayoutGrid, Clock, Scale, Recycle, PackageCheck,
} from "lucide-react";
import { consumableItems, type ConsumableItem } from "@/lib/sample-data";
import {
  flights, loadDispatchEntries, loadGalleyRecords,
  type GalleyStatus,
} from "@/routes/dispatch-monitoring";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend,
} from "recharts";

const STATUS_BADGE: Record<string, string> = {
  OK: "bg-emerald-100 text-emerald-800",
  Low: "bg-amber-100 text-amber-800",
  Critical: "bg-red-100 text-red-800",
};

// Galley plan lifecycle → label + colour (matches the Galley Plan / Dispatch chips).
const GSTATUS: Record<GalleyStatus, { label: string; color: string }> = {
  forwarded:         { label: "Forwarded",         color: "#0EA5E9" },
  loading:           { label: "Loading",           color: "#D97706" },
  completed:         { label: "Loaded",            color: "#16A34A" },
  awaiting_approval: { label: "Awaiting Approval", color: "#7C3AED" },
  approved:          { label: "Approved",          color: "#0F7A40" },
};
const GSTATUS_ORDER: GalleyStatus[] = ["forwarded", "loading", "completed", "awaiting_approval", "approved"];

// Galley forwards write consumable allocations under usePersistedState's prefix.
function readAllocCount(): number {
  try {
    const raw = localStorage.getItem("harvest-data-v1:consumable-allocations");
    return raw ? (JSON.parse(raw) as unknown[]).length : 0;
  } catch { return 0; }
}
// Inventory stock is deducted on allocation; read the live override if present.
function readItems(): ConsumableItem[] {
  try {
    const raw = localStorage.getItem("harvest-data-v1:airline-consumables-items");
    return raw ? (JSON.parse(raw) as ConsumableItem[]) : consumableItems;
  } catch { return consumableItems; }
}

// ── Flight reconciliation stores ─────────────────────────────────────────────
// Planned = galley plan consumable qty (loadGalleyRecords). Loaded = what was
// transferred to the flight (consumable-allocations, incl. ad-hoc). Returned =
// consumable-returns for that flight. Consumed = Loaded − Returned.
type AllocLine = { itemId: string; qty: number };
type AllocRecord = { flight: string; date: string; lines: AllocLine[] };
type ReturnLine = { itemId: string; qty: number; reusableQty?: number; lineType?: "item" | "meal" };
type ReturnRecord = { flight: string; date: string; lines: ReturnLine[] };

function readLS<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(`harvest-data-v1:${key}`);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch { return []; }
}

type ReconRow = {
  key: string; flight: string; date: string;
  planned: number; loaded: number; returned: number; reusable: number; consumed: number;
  rate: number | null; // consumed / loaded
};

export default function AirlineConsumablesOverviewPage() {
  const stats = useMemo(() => {
    // ── Galley planning (live module data) ─────────────────────────────────
    const entries = loadDispatchEntries();
    const galleyRecords = loadGalleyRecords();
    const plannedEntryIds = new Set(galleyRecords.map((r) => r.dispatchEntryId));
    const dispatches = entries.length;
    const galleyPlans = galleyRecords.length;
    const awaitingPlan = entries.filter((e) => !plannedEntryIds.has(e.id)).length;
    const allocations = readAllocCount();

    const statusCounts = galleyRecords.reduce<Record<string, number>>((acc, r) => {
      acc[r.galleyStatus] = (acc[r.galleyStatus] ?? 0) + 1;
      return acc;
    }, {});
    const statusChart = GSTATUS_ORDER
      .filter((s) => (statusCounts[s] ?? 0) > 0)
      .map((s) => ({ name: GSTATUS[s].label, value: statusCounts[s], color: GSTATUS[s].color }));

    // ── Consumables stock health ───────────────────────────────────────────
    const items = readItems();
    const totalSKUs = items.length;
    const totalStock = items.reduce((s, r) => s + r.stock, 0);
    const stockValue = items.reduce((s, r) => s + r.stock * r.unitCost, 0);
    const lowStock = items.filter((r) => r.reorder > 0 && r.stock <= r.reorder).length;
    const ok = items.filter((r) => r.status === "OK").length;

    const byCategory = items.reduce<Record<string, number>>((acc, r) => {
      acc[r.category] = (acc[r.category] ?? 0) + r.stock;
      return acc;
    }, {});
    const categoryChart = Object.entries(byCategory).map(([category, stock]) => ({ category, stock }));

    const reorderItems = items
      .filter((r) => r.reorder > 0 && r.stock <= r.reorder)
      .map((r) => ({ ...r, deficit: r.reorder - r.stock }))
      .sort((a, b) => b.deficit - a.deficit).slice(0, 8);

    // ── Per-flight reconciliation: planned → loaded → returned → consumed ────
    const consumableIds = new Set(items.map((i) => i.id));
    const flightNo = (flightId: string) => flights.find((f) => f.id === flightId)?.flight ?? flightId;
    const rowKey = (flight: string, date: string) => `${flight}__${date}`;
    const recon = new Map<string, ReconRow>();
    const ensure = (flight: string, date: string): ReconRow => {
      const k = rowKey(flight, date);
      let row = recon.get(k);
      if (!row) {
        row = { key: k, flight, date, planned: 0, loaded: 0, returned: 0, reusable: 0, consumed: 0, rate: null };
        recon.set(k, row);
      }
      return row;
    };

    // Planned — sum the galley plan's consumable (stock) line quantities.
    for (const rec of galleyRecords) {
      const row = ensure(flightNo(rec.flightId), rec.date);
      let planned = 0;
      for (const [k, v] of Object.entries(rec.galleyPlan)) {
        if (consumableIds.has(k)) planned += Number(v) || 0;
      }
      row.planned += planned;
    }
    // Loaded — allocations transferred to the flight (galley-forwarded + ad-hoc).
    for (const a of readLS<AllocRecord>("consumable-allocations")) {
      if (!a.flight) continue;
      const row = ensure(a.flight, a.date);
      row.loaded += (a.lines ?? []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
    }
    // Returned — consumable return lines (meal lines excluded).
    for (const r of readLS<ReturnRecord>("consumable-returns")) {
      if (!r.flight) continue;
      const row = ensure(r.flight, r.date);
      for (const l of r.lines ?? []) {
        if (l.lineType === "meal") continue;
        row.returned += Number(l.qty) || 0;
        row.reusable += Number(l.reusableQty) || 0;
      }
    }
    const reconciliation = [...recon.values()]
      .map((row) => {
        const consumed = Math.max(0, row.loaded - row.returned);
        return { ...row, consumed, rate: row.loaded > 0 ? consumed / row.loaded : null };
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.flight.localeCompare(b.flight)));

    const reconTotals = reconciliation.reduce(
      (t, r) => ({
        planned: t.planned + r.planned,
        loaded: t.loaded + r.loaded,
        returned: t.returned + r.returned,
        consumed: t.consumed + r.consumed,
      }),
      { planned: 0, loaded: 0, returned: 0, consumed: 0 },
    );
    const avgRate = reconTotals.loaded > 0 ? reconTotals.consumed / reconTotals.loaded : null;

    return {
      dispatches, galleyPlans, awaitingPlan, allocations, statusChart,
      totalSKUs, totalStock, stockValue, lowStock, ok,
      categoryChart, reorderItems,
      reconciliation, reconTotals, avgRate,
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Galley Planning Dashboard"
        subtitle="Per-flight galley plans, aircraft loading and consumable stock health — one view across the module"
      />

      {/* ── Galley planning band ─────────────────────────────────────────── */}
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-2">Galley Planning</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Dispatches"        value={stats.dispatches.toLocaleString()}   icon={Plane}        tone="navy" sub="Flights to plan" />
        <KpiCard label="Galley Plans"      value={stats.galleyPlans.toLocaleString()}  icon={LayoutGrid}   tone="success" sub="Forwarded to loading" />
        <KpiCard label="Awaiting Plan"     value={stats.awaitingPlan.toLocaleString()} icon={Clock}        tone="warning" sub="Not yet planned" />
        <KpiCard label="Flight Allocations" value={stats.allocations.toLocaleString()} icon={Send}         tone="navy" sub="Consumables issued" />
      </div>

      {/* ── Consumables band ─────────────────────────────────────────────── */}
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-2">Consumables Stock</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total SKUs"   value={stats.totalSKUs.toLocaleString()}  icon={Coffee} tone="navy" />
        <KpiCard label="Total Stock"  value={stats.totalStock.toLocaleString()} icon={Boxes} tone="navy" />
        <KpiCard label="Stock Value"  value={`৳ ${(stats.stockValue / 1000).toFixed(0)}k`} icon={Wallet} tone="navy" sub={`৳ ${stats.stockValue.toLocaleString()}`} />
        <KpiCard label="In Reorder"   value={stats.lowStock.toLocaleString()} icon={TrendingDown} tone="warning" sub="Below threshold" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Stock On Hand by Category</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.categoryChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="stock" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Galley Plan Status</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {stats.statusChart.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground text-center px-4">
                No galley plans forwarded yet.<br />Plan a flight from <span className="font-medium text-foreground">Galley Plan</span> to populate this.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.statusChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                       label={(e) => `${e.name}: ${e.value}`}>
                    {stats.statusChart.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Flight reconciliation band ───────────────────────────────────── */}
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-2">Flight Reconciliation</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Planned Units"  value={stats.reconTotals.planned.toLocaleString()}  icon={LayoutGrid}   tone="navy" sub="From galley plans" />
        <KpiCard label="Loaded Units"   value={stats.reconTotals.loaded.toLocaleString()}   icon={Send}         tone="navy" sub="Allocated to flights" />
        <KpiCard label="Returned Units" value={stats.reconTotals.returned.toLocaleString()} icon={Recycle}      tone="success" sub="Credited back" />
        <KpiCard
          label="Consumed Units"
          value={stats.reconTotals.consumed.toLocaleString()}
          icon={PackageCheck}
          tone="navy"
          sub={stats.avgRate != null ? `${Math.round(stats.avgRate * 100)}% of loaded` : "—"}
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Scale className="h-4 w-4 text-sky-700" /> Per-Flight Reconciliation
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Planned (galley plan) → Loaded (allocations, incl. ad-hoc) → Returned → Consumed (Loaded − Returned). Totals are consumable units across all lines.
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">Flight</th>
                  <th className="p-3 text-left font-semibold">Date</th>
                  <th className="p-3 text-right font-semibold">Planned</th>
                  <th className="p-3 text-right font-semibold">Loaded</th>
                  <th className="p-3 text-right font-semibold">Variance</th>
                  <th className="p-3 text-right font-semibold">Returned</th>
                  <th className="p-3 text-right font-semibold">Consumed</th>
                  <th className="p-3 text-right font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody>
                {stats.reconciliation.length === 0 ? (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No flights allocated, returned or planned yet.</td></tr>
                ) : stats.reconciliation.map((r) => {
                  // Variance = Loaded − Planned (over-allocation / ad-hoc without a plan).
                  const variance = r.loaded - r.planned;
                  const rate = r.rate;
                  const rateCls =
                    rate == null ? "bg-muted text-muted-foreground"
                    : rate >= 0.9 ? "bg-emerald-100 text-emerald-800"
                    : rate >= 0.6 ? "bg-amber-100 text-amber-800"
                    : "bg-red-100 text-red-800";
                  return (
                    <tr key={r.key} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                      <td className="p-3 font-medium">{r.flight}</td>
                      <td className="p-3 text-muted-foreground tabular-nums">{r.date}</td>
                      <td className="p-3 text-right tabular-nums">{r.planned ? r.planned.toLocaleString() : "—"}</td>
                      <td className="p-3 text-right tabular-nums">{r.loaded ? r.loaded.toLocaleString() : "—"}</td>
                      <td className={`p-3 text-right tabular-nums font-medium ${variance === 0 ? "text-muted-foreground" : variance > 0 ? "text-amber-600" : "text-red-600"}`}>
                        {variance === 0 ? "0" : variance > 0 ? `+${variance.toLocaleString()}` : variance.toLocaleString()}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {r.returned ? r.returned.toLocaleString() : "—"}
                        {r.reusable > 0 && <span className="text-[10px] text-emerald-600 ml-1">({r.reusable} reusable)</span>}
                      </td>
                      <td className="p-3 text-right tabular-nums font-semibold">{r.consumed ? r.consumed.toLocaleString() : "—"}</td>
                      <td className="p-3 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${rateCls}`}>
                          {rate == null ? "—" : `${Math.round(rate * 100)}%`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider">Reorder Required</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">SKU</th>
                  <th className="p-3 text-left font-semibold">Item</th>
                  <th className="p-3 text-left font-semibold">Category</th>
                  <th className="p-3 text-right font-semibold">Stock</th>
                  <th className="p-3 text-right font-semibold">Reorder</th>
                  <th className="p-3 text-right font-semibold">Deficit</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.reorderItems.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">All consumables above reorder level.</td></tr>
                ) : stats.reorderItems.map((i) => (
                  <tr key={i.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{i.id}</td>
                    <td className="p-3">{i.name}</td>
                    <td className="p-3 text-muted-foreground">{i.category}</td>
                    <td className="p-3 text-right">{i.stock.toLocaleString()} {i.uom}</td>
                    <td className="p-3 text-right text-muted-foreground">{i.reorder.toLocaleString()}</td>
                    <td className="p-3 text-right font-semibold text-red-600">{i.deficit.toLocaleString()}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[i.status] ?? "bg-muted text-foreground"}`}>
                        {i.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
