import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ScanBarcode, Wrench, CheckCircle2, AlertOctagon, ShieldAlert,
  AlertCircle, Calendar, MapPin, Clock, Send, Trash2, ArrowRight,
} from "lucide-react";
import {
  damageReports as SEED_DAMAGE,
  assets as SEED_FACILITY,
  equipmentAssets as SEED_EQUIPMENT,
  equipmentReturns as SEED_RETURNS,
  type DamageReport,
  type EquipmentAsset,
  type EquipmentReturn,
} from "@/lib/sample-data";
import { EQUIPMENT_ASSETS_KEY } from "@/lib/equipment-assets";
import { usePersistedState } from "@/lib/use-persisted-state";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

// ─────────────────────────────────────────────────────────────────────────────
// Asset Dashboard — every store the Asset Management module writes, on one
// screen.
//
// The module keeps two asset POOLS and four EVENT logs, each owned by its own
// screen, all persisted under harvest-data-v1:
//
//   airline-equipments-assets  ← Asset Registration  (the equipment register;
//                                 Assign / Disposal / Maintenance / Damage /
//                                 Returns all flip status on the same key)
//   maintenance-assets         ← Maintenance          (facility & ground assets)
//   asset-assignments          ← Asset Assign         (issued out; sets "Assigned")
//   asset-disposals            ← Asset Disposal       (sets "Destroyed" + book cost)
//   equipment-damage-reports   ← Damage Reports       (severity + repair state)
//   equipment-returns          ← Equipment Returns    (post-flight condition)
//
// Nothing here is computed from a private copy: the dashboard reads the same
// keys the screens write, so a registration, an assignment or a filed damage
// moves these figures immediately. The previous version read only two of the
// six, and took facility assets from the frozen seed rather than the live
// register — so edits made on the Maintenance page never showed up.
// ─────────────────────────────────────────────────────────────────────────────

const FACILITY_ASSETS_KEY = "maintenance-assets";
const ASSIGNMENTS_KEY = "asset-assignments";
const DISPOSALS_KEY = "asset-disposals";
const DAMAGE_KEY = "equipment-damage-reports";
const RETURNS_KEY = "equipment-returns";

type FacilityAsset = (typeof SEED_FACILITY)[number];
type AssignmentRecord = {
  id: string; assetId: string; assetName: string;
  assignTo: string; date: string; assignedBy: string; note?: string;
};
type DisposalRecord = {
  id: string; assetId: string; assetName: string;
  reason: string; method: string; date: string; cost?: number; note?: string;
};

const EQ_STATUS_COLORS: Record<string, string> = {
  "In Service": "#059669",
  Assigned: "#0EA5E9",
  "In Maintenance": "#D97706",
  Damaged: "#EF4444",
  Retired: "#94a3b8",
  Destroyed: "#475569",
  New: "#22c55e",
  Used: "#a3a3a3",
};

const MA_STATUS_COLORS: Record<string, string> = {
  Operational: "#059669",
  "Service Due": "#D97706",
  Maintenance: "#7C3AED",
  Damaged: "#EF4444",
  Retired: "#94a3b8",
};

const MA_STATUS_BADGE: Record<string, string> = {
  Operational: "bg-emerald-100 text-emerald-800",
  "Service Due": "bg-amber-100 text-amber-800",
  Maintenance: "bg-violet-100 text-violet-800",
  Damaged: "bg-red-100 text-red-800",
  Retired: "bg-slate-100 text-slate-700",
  "In Service": "bg-emerald-100 text-emerald-800",
  Assigned: "bg-sky-100 text-sky-800",
  "In Maintenance": "bg-amber-100 text-amber-800",
  Destroyed: "bg-slate-200 text-slate-700",
};

const SEVERITY_COLORS: Record<string, string> = {
  Minor: "#FBBF24",
  Moderate: "#F97316",
  Severe: "#EF4444",
};

const MOVEMENT_TONE: Record<string, string> = {
  Assigned: "bg-sky-100 text-sky-800",
  Returned: "bg-emerald-100 text-emerald-800",
  Disposed: "bg-slate-200 text-slate-700",
};

/** Statuses that mean the asset is out of the fleet — excluded from utilisation. */
const RETIRED_EQ = new Set(["Retired", "Destroyed"]);

function daysUntil(dateStr: string, from: Date): number {
  return Math.floor((new Date(dateStr).getTime() - from.getTime()) / 86400000);
}

/** The service-window bucket a due date falls into. */
function dueBucket(days: number): "Overdue" | "≤7 days" | "≤30 days" | "≤90 days" | null {
  if (days < 0) return "Overdue";
  if (days <= 7) return "≤7 days";
  if (days <= 30) return "≤30 days";
  if (days <= 90) return "≤90 days";
  return null;
}

/** Movement rows carry mixed date formats ("2026-05-20 18:40" and "2026-05-20"). */
const dayOf = (d: string) => (d ?? "").slice(0, 10);

export default function FleetOverviewPage() {
  const navigate = useNavigate();
  const today = new Date();

  // Both pools and all four event logs — read from the keys their own screens
  // write, so the dashboard can never disagree with the pages behind it.
  const [equipmentAssets] = usePersistedState<EquipmentAsset[]>(EQUIPMENT_ASSETS_KEY, SEED_EQUIPMENT);
  const [facilityAssets] = usePersistedState<FacilityAsset[]>(FACILITY_ASSETS_KEY, SEED_FACILITY);
  const [damageReports] = usePersistedState<DamageReport[]>(DAMAGE_KEY, SEED_DAMAGE);
  const [assignments] = usePersistedState<AssignmentRecord[]>(ASSIGNMENTS_KEY, []);
  const [disposals] = usePersistedState<DisposalRecord[]>(DISPOSALS_KEY, []);
  const [returns] = usePersistedState<EquipmentReturn[]>(RETURNS_KEY, SEED_RETURNS);

  const stats = useMemo(() => {
    const todayStr = today.toISOString().slice(0, 10);
    const in30 = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
    const since90 = new Date(today.getTime() - 90 * 86400000).toISOString().slice(0, 10);

    // ── Airline equipment ───────────────────────────────────────────────────
    const eqByStatus = equipmentAssets.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    }, {});
    const eqByCategory = equipmentAssets.reduce<Record<string, number>>((acc, a) => {
      acc[a.category] = (acc[a.category] ?? 0) + 1;
      return acc;
    }, {});
    // Where the equipment physically is. Assignment writes the destination into
    // `location`, so this doubles as a deployment view: aircraft registrations,
    // kitchens, and the damaged pool all show up as their own bar.
    const eqByLocation = equipmentAssets
      .filter((a) => !RETIRED_EQ.has(a.status))
      .reduce<Record<string, number>>((acc, a) => {
        const key = a.location?.trim() || "Unassigned";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});

    const eqInService     = eqByStatus["In Service"] ?? 0;
    const eqAssigned      = eqByStatus.Assigned ?? 0;
    const eqInMaintenance = eqByStatus["In Maintenance"] ?? 0;
    const eqDamaged       = eqByStatus.Damaged ?? 0;
    const eqDestroyed     = (eqByStatus.Destroyed ?? 0) + (eqByStatus.Retired ?? 0);
    // An assigned trolley is still working — count it as available capacity.
    const eqDueWithin30 = equipmentAssets.filter(
      (a) => a.nextMaintenance && a.nextMaintenance <= in30 && a.nextMaintenance >= todayStr
        && (a.status === "In Service" || a.status === "Assigned"),
    ).length;
    const eqOverdue = equipmentAssets.filter(
      (a) => a.nextMaintenance && a.nextMaintenance < todayStr && !RETIRED_EQ.has(a.status),
    ).length;

    const openDamage = damageReports.filter((d) => /open|under repair/i.test(d.status)).length;
    const severeOpen = damageReports.filter((d) => d.severity === "Severe" && !/repaired|written off/i.test(d.status)).length;

    // ── Facility & ground assets (live register, not the seed) ──────────────
    const maOperational   = facilityAssets.filter((a) => /operational/i.test(a.status)).length;
    const maInMaintenance = facilityAssets.filter((a) => /maintenance/i.test(a.status)).length;
    const maDueSoon       = facilityAssets.filter((a) => a.nextSvc >= todayStr && a.nextSvc <= in30).length;
    const maOverdue       = facilityAssets.filter((a) => a.nextSvc < todayStr).length;

    const maByType = facilityAssets.reduce<Record<string, number>>((acc, a) => {
      acc[a.type] = (acc[a.type] ?? 0) + 1;
      return acc;
    }, {});
    const maByStatus = facilityAssets.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    }, {});

    // ── One service schedule across both pools ──────────────────────────────
    // Servicing is planned by DATE, not by which register an asset happens to
    // sit in, so a single ordered list is what the planner actually needs.
    type Row = {
      id: string; name: string; pool: "Equipment" | "Facility"; type: string;
      location: string; last: string; next: string; days: number; status: string;
    };
    const scheduleRows: Row[] = [
      ...equipmentAssets
        .filter((a) => a.nextMaintenance && !RETIRED_EQ.has(a.status))
        .map((a) => ({
          id: a.id, name: a.name, pool: "Equipment" as const, type: String(a.category),
          location: a.location, last: a.lastMaintenance, next: a.nextMaintenance,
          days: daysUntil(a.nextMaintenance, today), status: a.status,
        })),
      ...facilityAssets.map((a) => ({
        id: a.id, name: a.name, pool: "Facility" as const, type: a.type,
        location: a.location, last: a.lastSvc, next: a.nextSvc,
        days: daysUntil(a.nextSvc, today), status: a.status,
      })),
    ].sort((a, b) => a.days - b.days);

    // Maintenance pipeline — the same rows, bucketed, split by pool so the
    // workload can be read off per team.
    const buckets = ["Overdue", "≤7 days", "≤30 days", "≤90 days"] as const;
    const pipeline = buckets.map((b) => ({
      bucket: b,
      Equipment: scheduleRows.filter((r) => r.pool === "Equipment" && dueBucket(r.days) === b).length,
      Facility: scheduleRows.filter((r) => r.pool === "Facility" && dueBucket(r.days) === b).length,
    }));

    // ── Damage funnel — severity × repair state ─────────────────────────────
    const damageStates = ["Open", "Under Repair", "Repaired", "Written Off"] as const;
    const damageChart = (["Minor", "Moderate", "Severe"] as const).map((sev) => {
      const row: Record<string, string | number> = { severity: sev };
      for (const st of damageStates) {
        row[st] = damageReports.filter((d) => d.severity === sev && d.status === st).length;
      }
      return row;
    });
    const openDamageRows = damageReports
      .filter((d) => /open|under repair/i.test(d.status))
      .sort((a, b) => b.date.localeCompare(a.date));

    // ── Movement log — assign / return / dispose, newest first ──────────────
    type Movement = { id: string; kind: "Assigned" | "Returned" | "Disposed"; date: string; assetName: string; detail: string; by: string };
    const movements: Movement[] = [
      ...assignments.map((a) => ({
        id: a.id, kind: "Assigned" as const, date: dayOf(a.date), assetName: a.assetName,
        detail: `to ${a.assignTo}`, by: a.assignedBy,
      })),
      ...returns.map((r) => ({
        id: r.id, kind: "Returned" as const, date: dayOf(r.date), assetName: r.assetName,
        detail: `${r.flight} · ${r.condition}`, by: r.returnedBy,
      })),
      ...disposals.map((d) => ({
        id: d.id, kind: "Disposed" as const, date: dayOf(d.date), assetName: d.assetName,
        detail: `${d.reason} · ${d.method}`, by: "—",
      })),
    ].sort((a, b) => b.date.localeCompare(a.date));

    const disposed90 = disposals.filter((d) => dayOf(d.date) >= since90);
    const disposedValue90 = disposed90.reduce((s, d) => s + (Number(d.cost) || 0), 0);
    const damagedOnReturn = returns.filter((r) => r.condition === "Damaged").length;

    // ── Combined KPIs ───────────────────────────────────────────────────────
    const totalAssets = equipmentAssets.length + facilityAssets.length;
    // Utilisation is capacity that is actually usable, so disposed and retired
    // units leave the denominator — otherwise writing an asset off would drag
    // the ratio down for good and read as a fleet problem.
    const liveFleet = totalAssets - eqDestroyed;
    const totalActive = eqInService + eqAssigned + maOperational;
    const totalInMaint = eqInMaintenance + maInMaintenance;
    const totalDueSoon = eqDueWithin30 + maDueSoon;
    const totalOverdue = eqOverdue + maOverdue;
    const utilisation = liveFleet > 0 ? Math.round((totalActive / liveFleet) * 100) : 0;

    return {
      totalAssets, liveFleet, totalActive, totalInMaint, totalDueSoon, totalOverdue,
      eqAssigned, eqDamaged, eqDestroyed, openDamage, severeOpen, utilisation,
      disposed90: disposed90.length, disposedValue90, damagedOnReturn,
      eqPieData: Object.entries(eqByStatus).map(([name, value]) => ({ name, value })),
      eqCategoryChart: Object.entries(eqByCategory).map(([category, count]) => ({ category, count })),
      eqLocationChart: Object.entries(eqByLocation)
        .map(([location, count]) => ({ location, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      maTypeChart: Object.entries(maByType).map(([type, count]) => ({ type, count })),
      maStatusChart: Object.entries(maByStatus).map(([name, value]) => ({ name, value })),
      pipeline,
      damageChart,
      damageStates,
      openDamageRows,
      schedule: scheduleRows.slice(0, 10),
      movements: movements.slice(0, 10),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipmentAssets, facilityAssets, damageReports, assignments, disposals, returns]);

  return (
    <>
      <PageHeader
        title="Asset Dashboard"
        subtitle="Airline equipment and facility assets — availability, deployment, servicing, damage and disposal"
      />

      {/* ── KPI row — the whole module in eight figures ──────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard
          label="Total Assets"
          value={stats.totalAssets.toLocaleString()}
          icon={ScanBarcode}
          tone="navy"
          sub={`${equipmentAssets.length} equipment · ${facilityAssets.length} facility`}
        />
        <KpiCard
          label="Active"
          value={stats.totalActive.toLocaleString()}
          icon={CheckCircle2}
          tone="success"
          sub="In service, assigned + operational"
        />
        <KpiCard
          label="On Assignment"
          value={stats.eqAssigned.toLocaleString()}
          icon={Send}
          tone="info"
          sub="Equipment issued out"
        />
        <KpiCard
          label="In Maintenance"
          value={stats.totalInMaint.toLocaleString()}
          icon={Wrench}
          tone="warning"
          sub="Both asset pools"
        />
        <KpiCard
          label="Service Due ≤30d"
          value={stats.totalDueSoon.toLocaleString()}
          icon={Calendar}
          tone="warning"
          sub="Scheduled, not yet due"
        />
        <KpiCard
          label="Service Overdue"
          value={stats.totalOverdue.toLocaleString()}
          icon={AlertCircle}
          tone="red"
          sub="Past next-service date"
        />
        <KpiCard
          label="Open Damage"
          value={stats.openDamage.toLocaleString()}
          icon={ShieldAlert}
          tone="red"
          sub={`${stats.severeOpen} severe · ${stats.eqDamaged} units damaged`}
        />
        <KpiCard
          label="Fleet Utilisation"
          value={`${stats.utilisation}%`}
          icon={Clock}
          tone={stats.utilisation >= 75 ? "success" : "warning"}
          sub={`Active / ${stats.liveFleet} in fleet`}
        />
      </div>

      {/* ── Charts ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Equipment Mix by Status</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.eqPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={(e) => `${e.name}: ${e.value}`}
                >
                  {stats.eqPieData.map((d) => (
                    <Cell key={d.name} fill={EQ_STATUS_COLORS[d.name] ?? "#64748b"} />
                  ))}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Airline Equipment by Category</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.eqCategoryChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Servicing workload — the queue every maintenance plan is built from. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Maintenance Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.pipeline} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip /><Legend />
                <Bar dataKey="Equipment" stackId="p" fill="#0EA5E9" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Facility" stackId="p" fill="#7C3AED" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Damage by Severity &amp; Repair State</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.damageChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="severity" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip /><Legend />
                <Bar dataKey="Open" stackId="d" fill="#EF4444" />
                <Bar dataKey="Under Repair" stackId="d" fill="#F97316" />
                <Bar dataKey="Repaired" stackId="d" fill="#059669" />
                <Bar dataKey="Written Off" stackId="d" fill="#94a3b8" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Facility Asset Inventory by Type</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.maTypeChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="type" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#7C3AED" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Facility Asset Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.maStatusChart}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={(e) => `${e.name}: ${e.value}`}
                >
                  {stats.maStatusChart.map((d) => (
                    <Cell key={d.name} fill={MA_STATUS_COLORS[d.name] ?? "#64748b"} />
                  ))}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Full width — location names are long, and this is the "where is my
            equipment right now" view the register exists to answer. */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Equipment Deployment by Location</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.eqLocationChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="location" tick={{ fontSize: 11 }} interval={0} angle={-12} textAnchor="end" height={48} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#059669" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Service schedule — both pools, soonest first ──────────────────────── */}
      <Card className="mb-6">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm uppercase tracking-wider">Upcoming Maintenance Schedule</CardTitle>
          <button
            type="button"
            onClick={() => navigate("/equipment-maintenance")}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            Maintenance <ArrowRight className="h-3 w-3" />
          </button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-semibold">Asset</th>
                  <th className="p-3 text-left font-semibold">Pool</th>
                  <th className="p-3 text-left font-semibold">Type</th>
                  <th className="p-3 text-left font-semibold">Location</th>
                  <th className="p-3 text-left font-semibold">Last Service</th>
                  <th className="p-3 text-left font-semibold">Next Service</th>
                  <th className="p-3 text-right font-semibold">Days</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.schedule.length === 0 ? (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No assets carry a next-service date.</td></tr>
                ) : stats.schedule.map((a) => (
                  <tr key={`${a.pool}-${a.id}`} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{a.name}<span className="ml-1.5 text-xs text-muted-foreground">{a.id}</span></td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${a.pool === "Equipment" ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800"}`}>
                        {a.pool}
                      </span>
                    </td>
                    <td className="p-3 text-muted-foreground">{a.type}</td>
                    <td className="p-3 text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{a.location}</span>
                    </td>
                    <td className="p-3 whitespace-nowrap">{a.last || "—"}</td>
                    <td className="p-3 whitespace-nowrap">{a.next}</td>
                    <td className={`p-3 text-right font-medium ${a.days < 0 ? "text-red-600" : a.days <= 30 ? "text-amber-600" : "text-emerald-600"}`}>
                      {a.days < 0 ? `${Math.abs(a.days)} overdue` : a.days}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${MA_STATUS_BADGE[a.status] ?? "bg-muted text-foreground"}`}>
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Open damage + movement log ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm uppercase tracking-wider">Open Damage Reports</CardTitle>
            <button
              type="button"
              onClick={() => navigate("/equipment-damage")}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              All reports <ArrowRight className="h-3 w-3" />
            </button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left font-semibold">Report</th>
                    <th className="p-3 text-left font-semibold">Asset</th>
                    <th className="p-3 text-left font-semibold">Severity</th>
                    <th className="p-3 text-left font-semibold">State</th>
                    <th className="p-3 text-left font-semibold">Reported</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.openDamageRows.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No damage reports are open.</td></tr>
                  ) : stats.openDamageRows.slice(0, 8).map((d) => (
                    <tr key={d.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs text-primary">{d.id}</td>
                      <td className="p-3">{d.assetName}<span className="ml-1.5 text-xs text-muted-foreground">{d.assetId}</span></td>
                      <td className="p-3">
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-semibold text-white"
                          style={{ background: SEVERITY_COLORS[d.severity] ?? "#64748b" }}
                        >
                          {d.severity}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground">{d.status}</td>
                      <td className="p-3 whitespace-nowrap text-muted-foreground">{d.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm uppercase tracking-wider">Recent Asset Movement</CardTitle>
            <span className="text-xs text-muted-foreground">
              {stats.disposed90} disposed in 90d
              {stats.disposedValue90 > 0 && ` · ৳${Math.round(stats.disposedValue90).toLocaleString()} written off`}
            </span>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left font-semibold">Date</th>
                    <th className="p-3 text-left font-semibold">Event</th>
                    <th className="p-3 text-left font-semibold">Asset</th>
                    <th className="p-3 text-left font-semibold">Detail</th>
                    <th className="p-3 text-left font-semibold">By</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.movements.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No assignments, returns or disposals recorded yet.</td></tr>
                  ) : stats.movements.map((m) => (
                    <tr key={`${m.kind}-${m.id}`} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                      <td className="p-3 whitespace-nowrap text-muted-foreground">{m.date}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${MOVEMENT_TONE[m.kind]}`}>{m.kind}</span>
                      </td>
                      <td className="p-3">{m.assetName}</td>
                      <td className="p-3 text-muted-foreground">{m.detail}</td>
                      <td className="p-3 text-muted-foreground">{m.by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quality signal off the returns log — equipment coming back broken is the
          leading indicator for next month's damage reports. */}
      {stats.damagedOnReturn > 0 && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-800">
          <AlertOctagon className="h-4 w-4 shrink-0" />
          <span>
            <strong>{stats.damagedOnReturn}</strong> equipment return{stats.damagedOnReturn === 1 ? " was" : "s were"} logged as
            damaged on arrival — each one becomes a damage report and a repair cost if not actioned.
          </span>
          <button
            type="button"
            onClick={() => navigate("/equipment-damage")}
            className="ml-auto inline-flex items-center gap-1 font-semibold hover:underline"
          >
            Review <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-2">
        {[
          { label: "Asset Registration", to: "/airline-equipments", icon: ScanBarcode },
          { label: "Asset Assign", to: "/asset-assignment", icon: Send },
          { label: "Maintenance", to: "/equipment-maintenance", icon: Wrench },
          { label: "Damage Reports", to: "/equipment-damage", icon: ShieldAlert },
          { label: "Asset Disposal", to: "/asset-disposal", icon: Trash2 },
        ].map((a) => (
          <button
            key={a.to}
            type="button"
            onClick={() => navigate(a.to)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <a.icon className="h-3.5 w-3.5" />{a.label}
          </button>
        ))}
      </div>
    </>
  );
}
