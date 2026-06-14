import { useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { StatusBadge } from "@/components/common/StatusBadge";
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
  Plus, ArrowLeft, Save, ShieldAlert, AlertCircle, Wrench, CheckCircle2, Eye, X, RotateCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  damageReports as SEED_REPORTS, equipmentAssets,
  type DamageReport,
} from "@/lib/sample-data";
import { cn } from "@/lib/utils";

type StatusChangeLog = {
  id: string;
  reportId: string;
  changedAt: string;
  changedBy: string;
  fromStatus: DamageReport["status"];
  toStatus: DamageReport["status"];
  justification: string;
};

const SEVERITIES: DamageReport["severity"][] = ["Minor", "Moderate", "Severe"];
const STATUSES: DamageReport["status"][] = ["Open", "Under Repair", "Repaired", "Written Off"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function EquipmentDamagePage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [selectedReport, setSelectedReport] = useState<DamageReport | null>(null);
  const [changeTarget, setChangeTarget] = useState<DamageReport | null>(null);
  const [reports, setReports] = usePersistedState<DamageReport[]>("equipment-damage-reports", SEED_REPORTS);
  const [statusLogs, setStatusLogs] = usePersistedState<StatusChangeLog[]>("damage-status-logs", []);

  const nextId = `DR-${String(2200 + reports.length + 1).padStart(4, "0")}`;

  const addReport = (r: DamageReport) => {
    setReports((prev) => [r, ...prev]);
    setView("list");
  };

  const applyStatusChange = (toStatus: DamageReport["status"], justification: string, changedBy: string) => {
    if (!changeTarget) return;
    const log: StatusChangeLog = {
      id: `SCL-${String(statusLogs.length + 1).padStart(4, "0")}`,
      reportId: changeTarget.id,
      changedAt: new Date().toISOString().slice(0, 10),
      changedBy,
      fromStatus: changeTarget.status,
      toStatus,
      justification,
    };
    setReports((prev) => prev.map((r) => r.id === changeTarget.id ? { ...r, status: toStatus } : r));
    setStatusLogs((prev) => [log, ...prev]);
    setChangeTarget(null);
    toast.success(`${changeTarget.id} → ${toStatus}`);
  };

  return (
    <>
      <PageHeader
        title="Damage Reports"
        subtitle="Equipment damage incidents — severity, repair status and history"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> File Report</>}
          </Button>
        }
      />

      {view === "list"
        ? <DamageList reports={reports} onView={setSelectedReport} onStatusChange={setChangeTarget} />
        : <DamageCreate nextId={nextId} onSave={addReport} />}

      {selectedReport && (
        <DamageViewModal
          report={selectedReport}
          statusLogs={statusLogs.filter((l) => l.reportId === selectedReport.id)}
          onClose={() => setSelectedReport(null)}
        />
      )}
      {changeTarget && (
        <StatusChangeModal
          report={changeTarget}
          onClose={() => setChangeTarget(null)}
          onSave={applyStatusChange}
        />
      )}
    </>
  );
}

function DamageList({ reports, onView, onStatusChange }: {
  reports: DamageReport[];
  onView: (r: DamageReport) => void;
  onStatusChange: (r: DamageReport) => void;
}) {
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAsset, setFilterAsset] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const uniqueAssets = Array.from(new Map(reports.map(r => [r.assetId, r.assetName])).entries());

  const filtered = reports.filter(r => {
    if (filterDateFrom && r.date < filterDateFrom) return false;
    if (filterDateTo && r.date > filterDateTo) return false;
    if (filterAsset && r.assetId !== filterAsset) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    return true;
  });

  const total = reports.length;
  const open = reports.filter((d) => d.status === "Open").length;
  const underRepair = reports.filter((d) => d.status === "Under Repair").length;
  const repaired = reports.filter((d) => d.status === "Repaired").length;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Reports" value={total} icon={ShieldAlert} tone="navy" />
        <KpiCard label="Open" value={open} icon={AlertCircle} tone="red" />
        <KpiCard label="Under Repair" value={underRepair} icon={Wrench} tone="warning" />
        <KpiCard label="Repaired" value={repaired} icon={CheckCircle2} tone="success" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-1.5 flex-1 min-w-[260px]">
          <span className="text-xs text-muted-foreground shrink-0">From</span>
          <Input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="h-8 text-xs flex-1"
          />
          <span className="text-xs text-muted-foreground shrink-0">To</span>
          <Input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="h-8 text-xs flex-1"
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <select
            value={filterAsset}
            onChange={(e) => setFilterAsset(e.target.value)}
            className={cn(selectCls, "h-8 text-xs mt-0")}
          >
            <option value="">All Assets</option>
            {uniqueAssets.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[140px]">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={cn(selectCls, "h-8 text-xs mt-0")}
          >
            <option value="">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {(filterDateFrom || filterDateTo || filterAsset || filterStatus) && (
          <button
            onClick={() => { setFilterDateFrom(""); setFilterDateTo(""); setFilterAsset(""); setFilterStatus(""); }}
            className="text-xs text-muted-foreground hover:text-foreground px-2 underline underline-offset-2"
          >
            Clear
          </button>
        )}
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-14 text-xs uppercase tracking-wider">SL</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Report ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Asset</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Severity</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Reported By</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Description</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((d, i) => (
              <TableRow key={d.id} className="hover:bg-muted/30">
                <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                <TableCell className="font-mono text-xs">{d.id}</TableCell>
                <TableCell className="tabular-nums text-xs">{d.date}</TableCell>
                <TableCell>
                  <div className="font-medium">{d.assetName}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{d.assetId}</div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      d.severity === "Minor" && "border-success/40 bg-success/10 text-success",
                      d.severity === "Moderate" && "border-warning/40 bg-warning/10 text-warning",
                      d.severity === "Severe" && "border-destructive/40 bg-destructive/10 text-destructive",
                    )}
                  >
                    {d.severity}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">{d.reportedBy}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[300px]">{d.description}</TableCell>
                <TableCell><StatusBadge status={d.status} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onView(d)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="View details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => onStatusChange(d)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Change status"
                    >
                      <RotateCw className="h-4 w-4" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function DamageViewModal({ report, statusLogs, onClose }: {
  report: DamageReport;
  statusLogs: StatusChangeLog[];
  onClose: () => void;
}) {
  // Build journey visits: each status the item has been in, in chronological order
  type Visit = { status: string; from: string; to: string | null; by?: string };
  const visits: Visit[] = [];
  let journeyNote: string | undefined;

  if (statusLogs.length > 0) {
    const chrono = [...statusLogs].reverse(); // oldest first
    // Initial state: the fromStatus of the first log, held from report.date until first change
    visits.push({ status: chrono[0].fromStatus, from: report.date, to: chrono[0].changedAt });
    for (let i = 0; i < chrono.length; i++) {
      visits.push({
        status: chrono[i].toStatus,
        from: chrono[i].changedAt,
        to: i < chrono.length - 1 ? chrono[i + 1].changedAt : null,
        by: chrono[i].changedBy,
      });
    }
    journeyNote = chrono[chrono.length - 1].justification;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <div className="text-sm font-semibold">{report.id}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{report.date}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Asset</p>
            <p className="text-sm font-medium">{report.assetName}</p>
            <p className="font-mono text-[10px] text-muted-foreground mt-0.5">{report.assetId}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Reported By</p>
            <p className="text-sm">{report.reportedBy}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Severity</p>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                report.severity === "Minor"    && "border-success/40 bg-success/10 text-success",
                report.severity === "Moderate" && "border-warning/40 bg-warning/10 text-warning",
                report.severity === "Severe"   && "border-destructive/40 bg-destructive/10 text-destructive",
              )}
            >
              {report.severity}
            </Badge>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Status</p>
            <StatusBadge status={report.status} />
          </div>
          <div className="col-span-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Damage Description</p>
            <p className="text-sm text-muted-foreground leading-relaxed bg-muted/40 rounded-md px-4 py-3 border border-border">
              {report.description}
            </p>
          </div>
          {visits.length > 0 && (
            <div className="col-span-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Status Journey</p>
              <div className="flex flex-wrap items-start gap-1.5">
                {/* Report Date anchor */}
                <div className="flex items-start gap-1.5">
                  <div className="flex flex-col items-center bg-muted/50 border border-border rounded-md px-3 py-2 text-center" style={{ minWidth: 86 }}>
                    <span className="text-[10px] font-semibold text-foreground leading-tight">Report Date</span>
                    <span className="text-[10px] font-mono text-muted-foreground mt-0.5 leading-tight">{report.date}</span>
                  </div>
                  <div className="pt-2.5 text-muted-foreground text-xs">→</div>
                </div>
                {visits.map((v, i) => {
                  const isLast = v.to === null;
                  const days = !isLast && v.to
                    ? Math.round((new Date(v.to).getTime() - new Date(v.from).getTime()) / 86400000)
                    : null;
                  return (
                    <div key={i} className="flex items-start gap-1.5">
                      <div className="flex flex-col items-center bg-muted/50 border border-border rounded-md px-3 py-2 text-center" style={{ minWidth: 86 }}>
                        <span className="text-[10px] font-semibold text-foreground leading-tight">{v.status}</span>
                        {isLast
                          ? <span className="text-[10px] font-mono text-muted-foreground mt-0.5 leading-tight">{v.from}</span>
                          : <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{days != null && days > 0 ? `${days} day${days !== 1 ? "s" : ""}` : "< 1 day"}</span>
                        }
                        {v.by && (
                          <span className="text-[9px] text-muted-foreground mt-0.5 leading-tight">by {v.by}</span>
                        )}
                      </div>
                      {i < visits.length - 1 && (
                        <div className="pt-2.5 text-muted-foreground text-xs">→</div>
                      )}
                    </div>
                  );
                })}
                {journeyNote && (
                  <div className="flex items-start gap-1.5">
                    <div className="pt-2.5 text-muted-foreground text-xs">→</div>
                    <div className="bg-muted/50 border border-border rounded-md px-3 py-2 text-[10px] text-muted-foreground italic" style={{ maxWidth: 150 }}>
                      {journeyNote}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusChangeModal({ report, onClose, onSave }: {
  report: DamageReport;
  onClose: () => void;
  onSave: (toStatus: DamageReport["status"], justification: string, changedBy: string) => void;
}) {
  const [toStatus, setToStatus] = useState<DamageReport["status"]>(report.status);
  const [justification, setJustification] = useState("");
  const [changedBy, setChangedBy] = useState("");

  const handleSave = () => {
    if (toStatus === report.status) { toast.error("Select a different status."); return; }
    if (!changedBy.trim()) { toast.error("Changed By is required."); return; }
    if (!justification.trim()) { toast.error("Justification is required."); return; }
    onSave(toStatus, justification.trim(), changedBy.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <div className="text-sm font-semibold">Change Status</div>
            <div className="text-xs text-muted-foreground mt-0.5">{report.id} · {report.assetName}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Current Status</p>
            <StatusBadge status={report.status} />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">New Status *</Label>
            <select
              value={toStatus}
              onChange={(e) => setToStatus(e.target.value as DamageReport["status"])}
              className={selectCls}
            >
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Changed By *</Label>
            <Input
              value={changedBy}
              onChange={(e) => setChangedBy(e.target.value)}
              placeholder="Name of person making this change"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Justification *</Label>
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={3}
              className="mt-1"
              placeholder="Reason for this status change…"
            />
          </div>
          <Button onClick={handleSave} className="w-full">
            <Save className="h-4 w-4 mr-1.5" /> Update Status
          </Button>
        </div>
      </div>
    </div>
  );
}

function DamageCreate({ nextId, onSave }: { nextId: string; onSave: (r: DamageReport) => void }) {
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [assetId, setAssetId] = useState("");
  const [severity, setSeverity] = useState<DamageReport["severity"]>("Minor");
  const [reportedBy, setReportedBy] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<DamageReport["status"]>("Open");

  const selectedAsset = equipmentAssets.find((a) => a.id === assetId);

  const save = () => {
    if (!selectedAsset) { toast.error("Select the damaged asset."); return; }
    if (!reportedBy.trim()) { toast.error("Reported By is required."); return; }
    if (!description.trim()) { toast.error("Description is required."); return; }
    onSave({
      id: nextId,
      date,
      assetId: selectedAsset.id,
      assetName: selectedAsset.name,
      severity,
      reportedBy: reportedBy.trim(),
      description: description.trim(),
      status,
    });
    toast.success(`${nextId} filed · ${selectedAsset.name} — ${severity}.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">File Damage Report</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save Report</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Report ID</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Severity</Label>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as DamageReport["severity"])} className={selectCls}>
              {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Asset *</Label>
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={selectCls}>
              <option value="">Select damaged asset…</option>
              {equipmentAssets.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.id}) · {a.location}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Status</Label>
            <select value={status} onChange={(e) => setStatus(e.target.value as DamageReport["status"])} className={selectCls}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Reported By *</Label>
            <Input
              value={reportedBy}
              onChange={(e) => setReportedBy(e.target.value)}
              placeholder="Inspector / dispatch handler name"
              className="mt-1"
            />
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Damage Description *</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="mt-1"
              placeholder="What is damaged, how it happened, and the operational impact…"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
