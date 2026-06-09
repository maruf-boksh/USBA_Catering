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
  Plus, ArrowLeft, Save, ShieldAlert, AlertCircle, Wrench, CheckCircle2, Eye,
} from "lucide-react";
import { toast } from "sonner";
import {
  damageReports as SEED_REPORTS, equipmentAssets,
  type DamageReport,
} from "@/lib/sample-data";
import { cn } from "@/lib/utils";

const SEVERITIES: DamageReport["severity"][] = ["Minor", "Moderate", "Severe"];
const STATUSES: DamageReport["status"][] = ["Open", "Under Repair", "Repaired", "Written Off"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function EquipmentDamagePage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [reports, setReports] = usePersistedState<DamageReport[]>("equipment-damage-reports", SEED_REPORTS);

  const nextId = `DR-${String(2200 + reports.length + 1).padStart(4, "0")}`;

  const addReport = (r: DamageReport) => {
    setReports((prev) => [r, ...prev]);
    setView("list");
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
        ? <DamageList reports={reports} />
        : <DamageCreate nextId={nextId} onSave={addReport} />}
    </>
  );
}

function DamageList({ reports }: { reports: DamageReport[] }) {
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
            {reports.map((d, i) => (
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
                  <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    <Eye className="h-4 w-4" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
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
