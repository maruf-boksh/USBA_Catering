import { Fragment, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Play, Check, BadgeCheck, Eye, Search, Clock, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  flights, loadGalleyRecords, saveGalleyRecords,
  type GalleyLoadingRecord, type GalleyStatus,
} from "@/routes/dispatch-monitoring";
import {
  GalleySheetViewModal, rowStatusBadge, STATUS_LABEL,
} from "@/routes/galley-planning";
import { getFlightOrders } from "@/lib/flight-orders-store";
import { resolveFlightOrder, resolveReturnLeg } from "@/lib/order-chain";

// Loading QC — the actionable galley loading workflow: a forwarded sheet is
// loaded (Start → Complete, timed), then sent to Approval Management where the
// sign-off signatories are captured and the sheet is approved for flight.
// Reads/writes the same galley loading records Dispatch Monitoring and the
// Archive share, so a step taken here reflects everywhere.
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

  // Order book — pairs each outbound with its return leg (same rotation), so a
  // forwarded sheet shows the return flight alongside it, mirroring Galley Plan.
  const flightOrders = useMemo(() => getFlightOrders(), []);
  const returnLegFor = (flightNo?: string, date?: string) =>
    resolveReturnLeg(
      flightNo ? resolveFlightOrder({ flight: flightNo, date }, flightOrders) : undefined,
      flightOrders,
    )?.order;

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

  // Completing the load sends the sheet straight to Approval Management, where
  // the sign-off signatories are captured and the sheet is approved for flight.
  const completeLoading = (rec: GalleyLoadingRecord) => {
    const durationSec = rec.loadingStartedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(rec.loadingStartedAt).getTime()) / 1000))
      : undefined;
    persist(records.map((r) => r.id === rec.id
      ? {
          ...r,
          galleyStatus: "awaiting_approval" as GalleyStatus,
          loadingCompletedAt: new Date().toISOString(),
          loadingDurationSec: durationSec,
        }
      : r));
    toast.success(`Loading complete for ${rec.flightLabel} — sent to Approval Management for sign-off & approval.`);
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
  const forApproval = records.filter((r) => r.galleyStatus === "awaiting_approval").length;
  const approved = records.filter((r) => r.galleyStatus === "approved").length;

  const viewRec = viewId ? records.find((r) => r.id === viewId) : undefined;
  const viewFlight = viewRec ? flights.find((f) => f.id === viewRec.flightId) : undefined;

  return (
    <>
      <PageHeader
        title="Loading QC"
        subtitle="Execute galley loading against each forwarded sheet — Start → Complete (timed). Sign-off and final approval for flight are done in Approval Management (Galley Loading queue)."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Awaiting Loading"  value={awaiting}    icon={Send}       tone="warning" />
        <KpiCard label="Loading Now"       value={loadingNow}  icon={Loader2}    tone="info" />
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
                  // The paired return leg of this rotation, if the order is tagged
                  // with one — loaded together with the outbound sheet.
                  const ret = returnLegFor(f?.flight, r.date);
                  return (
                    <Fragment key={r.id}>
                    <TableRow className="hover:bg-muted/30">
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
                          {r.galleyStatus === "approved" && (
                            <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                              <BadgeCheck className="h-3.5 w-3.5" /> {r.approvedBy ?? "Approved"} · {r.approvedAt}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {ret && (
                      <TableRow className="bg-muted/20 hover:bg-muted/30">
                        <TableCell className="font-medium text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-muted-foreground/70">↳</span>
                            {ret.flight}
                            <Badge variant="outline" className="h-4 px-1.5 text-[10px] border-amber-300 bg-amber-50 text-amber-700">Return</Badge>
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{ret.sector ?? "—"}</TableCell>
                        <TableCell className="tabular-nums text-xs text-muted-foreground">{ret.date ?? r.date}</TableCell>
                        <TableCell className="text-xs text-muted-foreground italic" colSpan={3}>
                          Loaded with {f?.flight ?? r.flightLabel}
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
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
    </>
  );
}
