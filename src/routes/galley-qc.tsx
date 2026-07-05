import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Play, Check, BadgeCheck, Eye, Search, Clock, Send, Loader2, PenLine } from "lucide-react";
import { toast } from "sonner";
import { getAuthUser } from "@/lib/auth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  flights, nowTimeStr, loadGalleyRecords, saveGalleyRecords,
  APT_EXECUTIVES, HOC_NAMES, APT_EXEC_DESIG, HOC_DESIG,
  type GalleyLoadingRecord, type GalleyStatus,
} from "@/routes/dispatch-monitoring";
import {
  GalleySheetViewModal, rowStatusBadge, STATUS_LABEL,
} from "@/routes/galley-planning";

const aptDesig = (name: string) => APT_EXEC_DESIG[name] ?? "APT Executive";
const hocDesig = (name: string) => HOC_DESIG[name] ?? "Head of Catering";

// Roster-backed signatory dropdown (module-level so the Select isn't remounted
// on every keystroke of the dialog).
function SignSelect({ label, value, options, desig, onChange }: {
  label: string; value: string; options: readonly string[]; desig: (n: string) => string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">{label}</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground mt-0.5">{desig(value)}</p>
    </div>
  );
}

// Loading QC & Sign-Off — the actionable galley loading workflow: a forwarded
// sheet is loaded (Start → Complete, timed), then quality-checked and approved
// for flight. Reads/writes the same galley loading records Dispatch Monitoring
// and the Archive share, so a step taken here reflects everywhere.
function fmtElapsed(fromIso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtDuration(sec?: number): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export default function GalleyQcPage() {
  const [records, setRecords] = useState<GalleyLoadingRecord[]>(() => loadGalleyRecords());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | GalleyStatus>("all");
  const [viewId, setViewId] = useState<string | null>(null);
  const [signOffRec, setSignOffRec] = useState<GalleyLoadingRecord | null>(null);
  const [picks, setPicks] = useState({ physicallyBy: APT_EXECUTIVES[1], checkedBy: APT_EXECUTIVES[2], handedBy: HOC_NAMES[0] });
  const authUser = getAuthUser();

  // Live tick so an in-progress loading timer updates on screen.
  const [, setTick] = useState(0);
  const hasLoading = records.some((r) => r.galleyStatus === "loading");
  useEffect(() => {
    if (!hasLoading) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasLoading]);

  // Re-read the shared store so approvals made in Approval Management (the
  // approval owner for galley loading) reflect here without a manual reload.
  useEffect(() => {
    const id = setInterval(() => {
      const fresh = loadGalleyRecords();
      setRecords((prev) => (JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh));
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const persist = (next: GalleyLoadingRecord[]) => {
    saveGalleyRecords(next);
    setRecords(next);
  };

  const startLoading = (rec: GalleyLoadingRecord) => {
    if (records.some((r) => r.galleyStatus === "loading")) {
      toast.error("Another sheet is already loading — complete it first.");
      return;
    }
    persist(records.map((r) => r.id === rec.id
      ? { ...r, galleyStatus: "loading" as GalleyStatus, loadingStartedAt: new Date().toISOString() }
      : r));
    toast.success(`Loading started for ${rec.flightLabel}.`);
  };

  const completeLoading = (rec: GalleyLoadingRecord) => {
    const durationSec = rec.loadingStartedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(rec.loadingStartedAt).getTime()) / 1000))
      : undefined;
    persist(records.map((r) => r.id === rec.id
      ? {
          ...r,
          galleyStatus: "completed" as GalleyStatus,
          loadingCompletedAt: new Date().toISOString(),
          loadingDurationSec: durationSec,
        }
      : r));
    toast.success(`Loading complete for ${rec.flightLabel} — ready for sign-off.`);
  };

  // Sign-off (handing/taking accountability) is captured here at approval, then
  // stamped onto the record — the planner no longer collects it.
  const openSignOff = (rec: GalleyLoadingRecord) => {
    setPicks({
      physicallyBy: rec.signOff?.physicallyHandedBy?.name || APT_EXECUTIVES[1],
      checkedBy: rec.signOff?.flightCheckedBy?.name || APT_EXECUTIVES[2],
      handedBy: rec.signOff?.handedOverBy?.name || HOC_NAMES[0],
    });
    setSignOffRec(rec);
  };

  const confirmSignOff = () => {
    const rec = signOffRec;
    if (!rec) return;
    const at = nowTimeStr();
    const prepared = rec.signOff?.preparedBy?.name
      ? rec.signOff.preparedBy
      : { name: authUser?.name ?? "—", designation: authUser?.role ?? "APT Executive", signedAt: at };
    const signOff: GalleyLoadingRecord["signOff"] = {
      preparedBy: prepared,
      physicallyHandedBy: { name: picks.physicallyBy, designation: aptDesig(picks.physicallyBy), signedAt: at },
      flightCheckedBy: { name: picks.checkedBy, designation: aptDesig(picks.checkedBy), signedAt: at },
      handedOverBy: { name: picks.handedBy, designation: hocDesig(picks.handedBy), signedAt: at },
    };
    // Sign-off moves the record to "awaiting_approval" (signed, ready for the
    // approver). Final approval for flight is done in Approval Management.
    persist(records.map((r) => r.id === rec.id
      ? { ...r, signOff, galleyStatus: "awaiting_approval" as GalleyStatus }
      : r));
    setSignOffRec(null);
    toast.success(`${rec.flightLabel} signed off — sent to Approval Management for approval.`);
  };

  const visible = useMemo(() => records.filter((r) => {
    if (statusFilter !== "all" && r.galleyStatus !== statusFilter) return false;
    if (!query.trim()) return true;
    const f = flights.find((x) => x.id === r.flightId);
    const hay = `${r.flightLabel} ${f?.sector ?? ""} ${f?.aircraft ?? ""} ${r.date}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  }), [records, statusFilter, query]);

  const awaiting = records.filter((r) => r.galleyStatus === "forwarded").length;
  const loadingNow = records.filter((r) => r.galleyStatus === "loading").length;
  const toSignOff = records.filter((r) => r.galleyStatus === "completed").length;
  const forApproval = records.filter((r) => r.galleyStatus === "awaiting_approval").length;
  const approved = records.filter((r) => r.galleyStatus === "approved").length;

  const viewRec = viewId ? records.find((r) => r.id === viewId) : undefined;
  const viewFlight = viewRec ? flights.find((f) => f.id === viewRec.flightId) : undefined;

  return (
    <>
      <PageHeader
        title="Loading QC & Sign-Off"
        subtitle="Execute galley loading against each forwarded sheet — Start → Complete (timed) → Sign Off. Final approval for flight is done in Approval Management (Galley Loading queue)."
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <KpiCard label="Awaiting Loading"  value={awaiting}    icon={Send}       tone="warning" />
        <KpiCard label="Loading Now"       value={loadingNow}  icon={Loader2}    tone="info" />
        <KpiCard label="Awaiting Sign-Off" value={toSignOff}   icon={PenLine}    tone="navy" />
        <KpiCard label="Awaiting Approval" value={forApproval} icon={Clock}      tone="navy" />
        <KpiCard label="Approved"          value={approved}    icon={BadgeCheck} tone="success" />
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative w-full sm:w-64">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search flight, sector, aircraft…"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-8 w-full sm:w-44 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(Object.keys(STATUS_LABEL) as GalleyStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
              {visible.length} of {records.length} sheets
            </span>
          </div>

          <div className="border border-border rounded-md overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Load Time</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">
                      {records.length === 0 ? "No forwarded sheets to load." : "No sheets match the current filters."}
                    </TableCell>
                  </TableRow>
                ) : visible.map((r) => {
                  const f = flights.find((x) => x.id === r.flightId);
                  return (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell className="font-semibold">{r.flightLabel}</TableCell>
                      <TableCell>{f?.sector ?? "—"}</TableCell>
                      <TableCell className="tabular-nums text-xs">{r.date}</TableCell>
                      <TableCell>{rowStatusBadge(r.galleyStatus)}</TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {r.galleyStatus === "loading" && r.loadingStartedAt
                          ? <span className="text-amber-600 font-semibold flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> {fmtElapsed(r.loadingStartedAt)}</span>
                          : r.loadingDurationSec != null
                          ? <span className="text-muted-foreground">{fmtDuration(r.loadingDurationSec)}</span>
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setViewId(r.id)}>
                            <Eye className="h-3 w-3 mr-1" /> View
                          </Button>
                          {r.galleyStatus === "forwarded" && (
                            <Button size="sm" className="h-7 px-2.5 text-xs bg-indigo-600 hover:bg-indigo-700" onClick={() => startLoading(r)}>
                              <Play className="h-3 w-3 mr-1" /> Start Loading
                            </Button>
                          )}
                          {r.galleyStatus === "loading" && (
                            <Button size="sm" className="h-7 px-2.5 text-xs bg-amber-600 hover:bg-amber-700" onClick={() => completeLoading(r)}>
                              <Check className="h-3 w-3 mr-1" /> Complete
                            </Button>
                          )}
                          {r.galleyStatus === "completed" && (
                            <Button size="sm" className="h-7 px-2.5 text-xs bg-sky-600 hover:bg-sky-700" onClick={() => openSignOff(r)}>
                              <PenLine className="h-3 w-3 mr-1" /> Sign Off
                            </Button>
                          )}
                          {r.galleyStatus === "approved" && (
                            <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                              <BadgeCheck className="h-3.5 w-3.5" /> {r.approvedBy ?? "Approved"} · {r.approvedAt}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {viewRec && (
        <GalleySheetViewModal rec={viewRec} flight={viewFlight} onClose={() => setViewId(null)} />
      )}

      {signOffRec && (
        <Dialog open onOpenChange={(v) => { if (!v) setSignOffRec(null); }}>
          <DialogContent className="w-full max-w-[95vw] sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Sign-Off — {signOffRec.flightLabel}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Confirm the handing / taking signatories. The sheet then goes to Approval Management for final approval.
              </p>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Dispatch Sheet Prepared By</p>
                <div className="text-xs bg-sky-50 border border-sky-100 text-sky-800 rounded px-2 py-1.5">
                  <span className="font-semibold">{signOffRec.signOff?.preparedBy?.name || authUser?.name || "—"}</span>
                  <span className="text-slate-400 mx-1">·</span>
                  <span>{signOffRec.signOff?.preparedBy?.designation || authUser?.role || "—"}</span>
                </div>
              </div>
              <SignSelect label="Physically Handed Over By" value={picks.physicallyBy} options={APT_EXECUTIVES} desig={aptDesig} onChange={(v) => setPicks((p) => ({ ...p, physicallyBy: v }))} />
              <SignSelect label="Flight Checked Over By" value={picks.checkedBy} options={APT_EXECUTIVES} desig={aptDesig} onChange={(v) => setPicks((p) => ({ ...p, checkedBy: v }))} />
              <SignSelect label="Flight Handed Over By" value={picks.handedBy} options={HOC_NAMES} desig={hocDesig} onChange={(v) => setPicks((p) => ({ ...p, handedBy: v }))} />
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="outline" onClick={() => setSignOffRec(null)}>Cancel</Button>
              <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={confirmSignOff}>
                <PenLine className="h-3.5 w-3.5 mr-1.5" /> Confirm Sign-Off
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
