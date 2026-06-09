import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, ArrowLeft, Save, Wrench, Clock, AlertTriangle, CheckCircle2, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { equipmentAssets as SEED_ASSETS, type EquipmentAsset } from "@/lib/sample-data";
import { cn } from "@/lib/utils";

type MaintenanceLog = {
  id: string;
  assetId: string;
  assetName: string;
  serviceDate: string;
  nextDue: string;
  performedBy: string;
  workType: "Routine" | "Repair" | "Calibration" | "Inspection";
  notes?: string;
};

const WORK_TYPES: MaintenanceLog["workType"][] = ["Routine", "Repair", "Calibration", "Inspection"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function EquipmentMaintenancePage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [assets, setAssets] = usePersistedState<EquipmentAsset[]>("equipment-maintenance-assets", SEED_ASSETS);
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);

  const nextLogId = useMemo(
    () => `MNT-${String(7000 + logs.length + 1).padStart(4, "0")}`,
    [logs.length],
  );

  // Recording maintenance refreshes the asset's lastMaintenance + nextMaintenance.
  const logMaintenance = (log: MaintenanceLog) => {
    setLogs((prev) => [log, ...prev]);
    setAssets((prev) =>
      prev.map((a) =>
        a.id === log.assetId
          ? { ...a, lastMaintenance: log.serviceDate, nextMaintenance: log.nextDue, status: a.status === "In Maintenance" ? "In Service" : a.status }
          : a,
      ),
    );
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Equipment Maintenance"
        subtitle="Service-due watchlist + maintenance log book for trolleys, racks, containers and galley equipment"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> Log Maintenance</>}
          </Button>
        }
      />

      {view === "list"
        ? <MaintenanceList assets={assets} logs={logs} />
        : <MaintenanceCreate nextLogId={nextLogId} assets={assets} onSave={logMaintenance} />}
    </>
  );
}

function MaintenanceList({
  assets, logs,
}: { assets: EquipmentAsset[]; logs: MaintenanceLog[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const eligible = assets.filter(
    (a) => a.status !== "Damaged" && a.status !== "Retired" && a.status !== "New" && a.status !== "Used",
  );
  const overdue = eligible.filter((a) => a.nextMaintenance <= today);
  const dueSoon = eligible.filter((a) => a.nextMaintenance > today && a.nextMaintenance <= cutoff30);
  const allDue = [...overdue, ...dueSoon].sort((a, b) => a.nextMaintenance.localeCompare(b.nextMaintenance));

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Overdue" value={overdue.length} icon={AlertTriangle} tone="red" />
        <KpiCard label="Due in 30d" value={dueSoon.length} icon={Clock} tone="warning" />
        <KpiCard label="All Caught Up" value={eligible.length - allDue.length} icon={CheckCircle2} tone="success" />
      </div>

      {allDue.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Wrench className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <div className="text-sm font-medium text-foreground">All caught up</div>
            <div className="text-xs text-muted-foreground mt-1">
              No assets due for maintenance in the next 30 days.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="border border-border rounded-md overflow-hidden mb-6">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="text-xs uppercase tracking-wider">Asset</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Category</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Location</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Last Maint.</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Next Maint.</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-right">Days</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allDue.map((a) => {
                const isOverdue = a.nextMaintenance <= today;
                const days = Math.round(
                  (new Date(a.nextMaintenance).getTime() - new Date(today).getTime()) / 86400000,
                );
                return (
                  <TableRow key={a.id} className={cn("hover:bg-muted/30", isOverdue && "bg-destructive/5")}>
                    <TableCell>
                      <div className="font-medium">{a.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{a.id}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{a.category}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{a.location}</TableCell>
                    <TableCell className="tabular-nums text-xs">{a.lastMaintenance}</TableCell>
                    <TableCell className="tabular-nums text-xs">{a.nextMaintenance}</TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          "tabular-nums text-xs font-semibold",
                          isOverdue ? "text-destructive" : days <= 7 ? "text-warning" : "text-muted-foreground",
                        )}
                      >
                        {isOverdue ? `${Math.abs(days)}d overdue` : `${days}d`}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                        <Eye className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Recent Maintenance Logs
      </div>
      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wider">Log ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Service Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Asset</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Work Type</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Performed By</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Next Due</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Notes</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-6">
                  No maintenance logged yet. Click "Log Maintenance" to record a service event.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((l) => (
                <TableRow key={l.id} className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">{l.id}</TableCell>
                  <TableCell className="tabular-nums text-xs">{l.serviceDate}</TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{l.assetName}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{l.assetId}</div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        l.workType === "Routine"     && "bg-[#f0fdfa] text-[#0f766e] border-[#99f6e4]",
                        l.workType === "Repair"      && "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
                        l.workType === "Calibration" && "bg-[#EFF6FF] text-[#1d4ed8] border-[#BFDBFE]",
                        l.workType === "Inspection"  && "bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]",
                      )}
                    >
                      {l.workType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{l.performedBy}</TableCell>
                  <TableCell className="tabular-nums text-xs">{l.nextDue}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[260px]">{l.notes ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                      <Eye className="h-4 w-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function MaintenanceCreate({
  nextLogId, assets, onSave,
}: {
  nextLogId: string;
  assets: EquipmentAsset[];
  onSave: (l: MaintenanceLog) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const sixMonthsOut = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);

  const [assetId, setAssetId] = useState("");
  const [serviceDate, setServiceDate] = useState(today);
  const [nextDue, setNextDue] = useState(sixMonthsOut);
  const [workType, setWorkType] = useState<MaintenanceLog["workType"]>("Routine");
  const [performedBy, setPerformedBy] = useState("");
  const [notes, setNotes] = useState("");

  const selectedAsset = assets.find((a) => a.id === assetId);

  const save = () => {
    if (!selectedAsset) { toast.error("Select an asset."); return; }
    if (!performedBy.trim()) { toast.error("Performed By is required."); return; }
    onSave({
      id: nextLogId,
      assetId: selectedAsset.id,
      assetName: selectedAsset.name,
      serviceDate,
      nextDue,
      performedBy: performedBy.trim(),
      workType,
      notes: notes.trim() || undefined,
    });
    toast.success(`Service logged for ${selectedAsset.name}. Next due ${nextDue}.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Log Maintenance Event</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save Log</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Log ID</Label>
            <Input value={nextLogId} disabled className="mt-1 font-mono" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Asset *</Label>
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={selectCls}>
              <option value="">Select asset…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.id}) · {a.location}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Service Date</Label>
            <Input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Next Maintenance</Label>
            <Input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Work Type</Label>
            <select value={workType} onChange={(e) => setWorkType(e.target.value as MaintenanceLog["workType"])} className={selectCls}>
              {WORK_TYPES.map((w) => <option key={w}>{w}</option>)}
            </select>
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Performed By *</Label>
            <Input
              value={performedBy}
              onChange={(e) => setPerformedBy(e.target.value)}
              placeholder="Technician / vendor name"
              className="mt-1"
            />
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1"
              placeholder="Parts replaced, observations, follow-up items…"
            />
          </div>
        </div>
        <div className="mt-4 text-[11px] text-muted-foreground bg-muted/40 border border-border rounded px-3 py-2">
          Saving updates the asset's Last and Next maintenance dates. If the asset was "In Maintenance", it moves back to "In Service".
        </div>
      </CardContent>
    </Card>
  );
}
