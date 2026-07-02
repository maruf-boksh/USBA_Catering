import { useState, Fragment } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useRole } from "@/lib/roles";
import { usePersistedState } from "@/lib/use-persisted-state";
import { Plus, Eye, ClipboardCheck, Clock, ShieldCheck, CheckCircle2 } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────
export const PH_AREAS = [
  "Flight Kitchen",
  "Packaging-01",
  "Packaging-02",
  "Packaging-03",
  "Butcher Room",
  "Bakery",
] as const;

export type PHArea = typeof PH_AREAS[number];
export type PHParamValue = "ok" | "notok" | null;

const PH_PARAMS = [
  "Dress code",
  "Uniform cleanliness",
  "Hair control",
  "Hand Sanitizing",
  "Jewelery & watches control",
  "Nails are trimmed properly",
  "Clean Shave/Beard Cover",
  "Wound/Infection",
  "Hand gloves",
  "Masks",
  "Overall cleaness",
];

const PH_SHIFTS = ["Morning", "Afternoon", "Night"];

// ── Types ─────────────────────────────────────────────────────────────────────
export type PHParamRow = {
  param: string;
  areas: Record<string, PHParamValue>;
  remarks: string;
};

export type PersonalHygieneRecord = {
  id: string;
  date: string;
  shift: string;
  rows: PHParamRow[];
  comments: string;
  correction: string;
  correctiveAction: string;
  checkedBy: string;
  checkedAt: string;
  status: "submitted" | "verified" | "approved";
  verifiedBy?: string;
  verifiedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeEmptyRows(): PHParamRow[] {
  return PH_PARAMS.map(param => ({
    param,
    areas: Object.fromEntries(PH_AREAS.map(a => [a, null as PHParamValue])),
    remarks: "",
  }));
}

export function phNotOkCount(rec: PersonalHygieneRecord): number {
  return rec.rows.reduce(
    (c, r) => c + Object.values(r.areas).filter(v => v === "notok").length,
    0,
  );
}

// ── Seed data (pre-approved record for demonstration) ─────────────────────────
const SEED_RECORD: PersonalHygieneRecord = {
  id: "PH-2026-001",
  date: "2026-07-01",
  shift: "Morning",
  rows: [
    { param: "Dress code",                    areas: { "Flight Kitchen": "ok", "Packaging-01": "ok", "Packaging-02": "ok", "Packaging-03": "ok",    "Butcher Room": "ok",    "Bakery": "ok" }, remarks: "" },
    { param: "Uniform cleanliness",           areas: { "Flight Kitchen": "ok", "Packaging-01": "ok", "Packaging-02": "ok", "Packaging-03": "ok",    "Butcher Room": "notok", "Bakery": "ok" }, remarks: "Stained uniform — replaced on spot." },
    { param: "Hair control",                  areas: { "Flight Kitchen": "ok", "Packaging-01": "ok", "Packaging-02": "ok", "Packaging-03": "ok",    "Butcher Room": "ok",    "Bakery": "ok" }, remarks: "" },
    { param: "Hand Sanitizing",               areas: { "Flight Kitchen": "ok", "Packaging-01": "ok", "Packaging-02": "ok", "Packaging-03": "ok",    "Butcher Room": "ok",    "Bakery": "ok" }, remarks: "" },
    { param: "Jewelery & watches control",    areas: { "Flight Kitchen": "ok", "Packaging-01": "ok", "Packaging-02": "ok", "Packaging-03": "ok",    "Butcher Room": "ok",    "Bakery": "ok" }, remarks: "" },
    { param: "Nails are trimmed properly",    areas: { "Flight Kitchen": "ok", "Packaging-01": "ok", "Packaging-02": "ok", "Packaging-03": "ok",    "Butcher Room": "ok",    "Bakery": "ok" }, remarks: "" },
    { param: "Clean Shave/Beard Cover",       areas: { "Flight Kitchen": "ok", "Packaging-01": "ok", "Packaging-02": "ok", "Packaging-03": "ok",    "Butcher Room": "ok",    "Bakery": "ok" }, remarks: "" },
    { param: "Wound/Infection",               areas: { "Flight Kitchen": "ok", "Packaging-01": "ok", "Packaging-02": "ok", "Packaging-03": "notok", "Butcher Room": "ok",    "Bakery": "ok" }, remarks: "Minor cut — food-safe plaster applied." },
    { param: "Hand gloves",                   areas: { "Flight Kitchen": "ok", "Packaging-01": "ok", "Packaging-02": "ok", "Packaging-03": "ok",    "Butcher Room": "ok",    "Bakery": "ok" }, remarks: "" },
    { param: "Masks",                         areas: { "Flight Kitchen": "ok", "Packaging-01": "ok", "Packaging-02": "ok", "Packaging-03": "ok",    "Butcher Room": "ok",    "Bakery": "ok" }, remarks: "" },
    { param: "Overall cleaness",              areas: { "Flight Kitchen": "ok", "Packaging-01": "ok", "Packaging-02": "ok", "Packaging-03": "ok",    "Butcher Room": "ok",    "Bakery": "ok" }, remarks: "" },
  ],
  comments: "Minor issues in Butcher Room (uniform) and Packaging-03 (wound). Both corrected on spot during inspection.",
  correction: "Stained uniform replaced. Food-safe plaster verified for compliance on Packaging-03 employee.",
  correctiveAction: "Brief reminder issued to Butcher Room team on uniform standards and wound reporting protocol.",
  checkedBy: "Supervisor (Food Safety & Hygiene)",
  checkedAt: "2026-07-01 06:45",
  status: "approved",
  verifiedBy: "Senior Executive (Food Safety & Hygiene)",
  verifiedAt: "2026-07-01 08:30",
  approvedBy: "General Manager-Catering (GM/Admin)",
  approvedAt: "2026-07-01 09:15",
};

// ── PHFormGrid (reused in Add + View dialogs) ─────────────────────────────────
export function PHFormGrid({
  rows,
  readOnly = false,
  onCellChange,
  onRemarkChange,
}: {
  rows: PHParamRow[];
  readOnly?: boolean;
  onCellChange?: (rowIdx: number, area: string, value: PHParamValue) => void;
  onRemarkChange?: (rowIdx: number, value: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs border-collapse" style={{ minWidth: 960 }}>
        <thead>
          <tr className="bg-muted/60 border-b border-border">
            <th className="text-center px-2 py-2 font-semibold w-8">SL</th>
            <th className="text-left px-3 py-2 font-semibold" style={{ minWidth: 170 }}>Parameters</th>
            {PH_AREAS.map(area => (
              <th key={area} colSpan={2} className="text-center px-2 py-2 font-semibold text-xs border-l border-border">
                {area}
              </th>
            ))}
            <th className="text-left px-3 py-2 font-semibold border-l border-border" style={{ minWidth: 130 }}>Remarks</th>
          </tr>
          <tr className="bg-muted/30 border-b border-border">
            <th /><th />
            {PH_AREAS.map(area => (
              <Fragment key={area}>
                <th className="text-center px-1 py-1 text-[10px] text-muted-foreground border-l border-border w-14">Ok</th>
                <th className="text-center px-1 py-1 text-[10px] text-muted-foreground w-14">Not Ok</th>
              </Fragment>
            ))}
            <th className="border-l border-border" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const hasNotOk = Object.values(row.areas).some(v => v === "notok");
            return (
              <tr
                key={row.param}
                className={`border-b border-border ${hasNotOk ? "bg-red-50/50" : i % 2 === 0 ? "" : "bg-muted/10"}`}
              >
                <td className="px-2 py-1.5 text-center text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-1.5 font-medium text-[12px]">{row.param}</td>
                {PH_AREAS.map(area => (
                  <Fragment key={area}>
                    {/* Ok */}
                    <td className="px-1 py-1.5 text-center border-l border-border">
                      {readOnly ? (
                        row.areas[area] === "ok"
                          ? <span className="text-green-600 font-bold text-sm">✓</span>
                          : <span className="text-muted-foreground">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onCellChange?.(i, area, row.areas[area] === "ok" ? null : "ok")}
                          className={`w-7 h-7 rounded border-2 flex items-center justify-center mx-auto transition-colors ${
                            row.areas[area] === "ok"
                              ? "bg-green-100 border-green-500 text-green-700"
                              : "border-border hover:border-green-400 hover:bg-green-50"
                          }`}
                          title="Mark Ok"
                        >
                          {row.areas[area] === "ok" && <CheckCircle2 className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </td>
                    {/* Not Ok */}
                    <td className="px-1 py-1.5 text-center">
                      {readOnly ? (
                        row.areas[area] === "notok"
                          ? <span className="text-red-600 font-bold text-sm">✗</span>
                          : <span className="text-muted-foreground">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onCellChange?.(i, area, row.areas[area] === "notok" ? null : "notok")}
                          className={`w-7 h-7 rounded border-2 flex items-center justify-center mx-auto transition-colors ${
                            row.areas[area] === "notok"
                              ? "bg-red-100 border-red-500 text-red-700"
                              : "border-border hover:border-red-400 hover:bg-red-50"
                          }`}
                          title="Mark Not Ok"
                        >
                          {row.areas[area] === "notok" && <span className="text-xs font-bold">✗</span>}
                        </button>
                      )}
                    </td>
                  </Fragment>
                ))}
                {/* Remarks */}
                <td className="px-2 py-1.5 border-l border-border">
                  {readOnly ? (
                    <span className={row.remarks ? "text-foreground" : "text-muted-foreground"}>
                      {row.remarks || "—"}
                    </span>
                  ) : (
                    <input
                      type="text"
                      value={row.remarks}
                      onChange={e => onRemarkChange?.(i, e.target.value)}
                      className={`w-full border rounded px-2 py-1 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring ${
                        hasNotOk ? "border-red-300 bg-red-50 placeholder:text-red-400" : "border-border"
                      }`}
                      placeholder={hasNotOk ? "Required for Not Ok" : "—"}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── PHSignOffPanel (reused in view dialogs) ────────────────────────────────────
export function PHSignOffPanel({ rec }: { rec: PersonalHygieneRecord }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Checked By</p>
        <p className="font-semibold text-foreground">{rec.checkedBy}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">{rec.checkedAt}</p>
      </div>
      <div className={`rounded-md border p-3 ${rec.verifiedBy ? "border-blue-200 bg-blue-50/40" : "border-border bg-muted/20"}`}>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Verified By</p>
        {rec.verifiedBy ? (
          <>
            <p className="font-semibold text-blue-800">{rec.verifiedBy}</p>
            <p className="text-[11px] text-blue-600 tabular-nums mt-0.5">{rec.verifiedAt}</p>
          </>
        ) : (
          <p className="text-muted-foreground text-[11px] italic">Pending verification</p>
        )}
      </div>
      <div className={`rounded-md border p-3 ${rec.approvedBy ? "border-emerald-200 bg-emerald-50/40" : "border-border bg-muted/20"}`}>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Authorised By (GM-Catering)</p>
        {rec.approvedBy ? (
          <>
            <p className="font-semibold text-emerald-800">{rec.approvedBy}</p>
            <p className="text-[11px] text-emerald-600 tabular-nums mt-0.5">{rec.approvedAt}</p>
          </>
        ) : (
          <p className="text-muted-foreground text-[11px] italic">Pending authorization</p>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function PersonalHygieneMonitoring() {
  const { role } = useRole();
  const today = new Date().toISOString().split("T")[0];

  const [records, setRecords] = usePersistedState<PersonalHygieneRecord[]>(
    "personal-hygiene-records",
    [SEED_RECORD],
  );

  // Dialog state
  const [addOpen, setAddOpen]     = useState(false);
  const [viewOpen, setViewOpen]   = useState(false);
  const [viewRecord, setViewRecord] = useState<PersonalHygieneRecord | null>(null);

  // Form state
  const [formDate, setFormDate]   = useState(today);
  const [formShift, setFormShift] = useState("Morning");
  const [formRows, setFormRows]   = useState<PHParamRow[]>(makeEmptyRows);
  const [formComments, setFormComments]             = useState("");
  const [formCorrection, setFormCorrection]         = useState("");
  const [formCorrectiveAction, setFormCorrectiveAction] = useState("");

  const openAdd = () => {
    setFormDate(today);
    setFormShift("Morning");
    setFormRows(makeEmptyRows());
    setFormComments("");
    setFormCorrection("");
    setFormCorrectiveAction("");
    setAddOpen(true);
  };

  const setCellValue = (rowIdx: number, area: string, value: PHParamValue) => {
    setFormRows(prev =>
      prev.map((r, i) => i === rowIdx ? { ...r, areas: { ...r.areas, [area]: value } } : r),
    );
  };

  const setRemarks = (rowIdx: number, value: string) => {
    setFormRows(prev =>
      prev.map((r, i) => i === rowIdx ? { ...r, remarks: value } : r),
    );
  };

  const handleSubmit = () => {
    if (!formDate)  { toast.error("Date is required.");  return; }
    if (!formShift) { toast.error("Shift is required."); return; }
    const now   = new Date();
    const hh    = now.getHours().toString().padStart(2, "0");
    const mm    = now.getMinutes().toString().padStart(2, "0");
    const stamp = `${formDate} ${hh}:${mm}`;
    const rec: PersonalHygieneRecord = {
      id:               `PH-${Date.now()}`,
      date:             formDate,
      shift:            formShift,
      rows:             formRows.map(r => ({ ...r, areas: { ...r.areas } })),
      comments:         formComments,
      correction:       formCorrection,
      correctiveAction: formCorrectiveAction,
      checkedBy:        role || "Supervisor (Food Safety & Hygiene)",
      checkedAt:        stamp,
      status:           "submitted",
    };
    setRecords(prev => [rec, ...prev]);
    setAddOpen(false);
    toast.success("Health & Personal Hygiene check submitted — pending verification in Approval Management.");
  };

  const approved = records.filter(r => r.status === "approved").sort((a, b) => b.date.localeCompare(a.date));
  const pending  = records.filter(r => r.status === "submitted" || r.status === "verified").sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <PageHeader
        title="Health & Personal Hygiene Monitoring"
        subtitle="USBA-FSH-PH-01 — Frequency: Once/Shift"
        actions={
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1" /> Add New
          </Button>
        }
      />

      {/* ── Instructions ────────────────────────────────────────────────────── */}
      <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
        <p className="text-[13px] font-semibold text-blue-800 mb-2">How to use this module:</p>
        <ol className="text-[12.5px] text-blue-700 space-y-1 list-decimal list-inside">
          <li>
            Click <span className="font-semibold">+ Add New</span> to open the inspection form.
            Select the date and shift, then mark each parameter as <span className="font-semibold">Ok</span> or <span className="font-semibold">Not Ok</span> for every work area.
          </li>
          <li>
            Add <span className="font-semibold">Remarks</span> for any "Not Ok" items.
            Fill in <span className="font-semibold">Comments</span>, <span className="font-semibold">Correction</span>, and <span className="font-semibold">Corrective Action</span> fields at the bottom.
          </li>
          <li>
            Click <span className="font-semibold">Submit</span> — <span className="font-semibold">Checked By</span> with date &amp; time is auto-captured using your logged-in profile.
          </li>
          <li>
            The record goes to <span className="font-semibold">Approval Management</span> → Senior Executive (Food Safety &amp; Hygiene) views and clicks <span className="font-semibold">Verify</span>.
          </li>
          <li>
            After verification, the record awaits <span className="font-semibold">GM-Catering</span> authorization in Approval Management → view and click <span className="font-semibold">Approve</span>.
          </li>
          <li>
            Once fully approved, the record appears in the <span className="font-semibold">Approved Records</span> list below with all sign-off logs.
          </li>
        </ol>
      </div>

      {/* ── Pending notice ───────────────────────────────────────────────────── */}
      {pending.length > 0 && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[13px] font-semibold text-amber-800 mb-2 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Pending Approval ({pending.length})
          </p>
          <div className="space-y-2">
            {pending.map(rec => (
              <div key={rec.id} className="flex items-center justify-between rounded-md border border-amber-200 bg-white px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">{rec.id}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-sm font-medium">{rec.date}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-sm text-muted-foreground">{rec.shift} Shift</span>
                  <Badge
                    variant="outline"
                    className={rec.status === "verified"
                      ? "text-[10px] bg-blue-50 text-blue-700 border-blue-300"
                      : "text-[10px] bg-amber-50 text-amber-700 border-amber-300"}
                  >
                    {rec.status === "verified" ? "Verified — Awaiting GM Authorization" : "Pending Verification"}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs shrink-0"
                  onClick={() => { setViewRecord(rec); setViewOpen(true); }}
                >
                  <Eye className="h-3.5 w-3.5 mr-1" /> View
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Approved Records list ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            Approved Records
          </h3>
          <span className="text-xs text-muted-foreground">
            {approved.length} record{approved.length !== 1 ? "s" : ""}
          </span>
        </div>
        {approved.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">
            No approved records yet. Submit a check above and complete the approval flow.
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="text-xs uppercase tracking-wider">Ref</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Shift</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Checked By</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Verified By</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Authorised By</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Result</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approved.map(rec => {
                const nok = phNotOkCount(rec);
                return (
                  <TableRow key={rec.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs">{rec.id}</TableCell>
                    <TableCell className="text-sm">{rec.date}</TableCell>
                    <TableCell className="text-sm">{rec.shift}</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{rec.checkedBy}</div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">{rec.checkedAt}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{rec.verifiedBy || "—"}</div>
                      {rec.verifiedAt && <div className="text-[10px] text-muted-foreground tabular-nums">{rec.verifiedAt}</div>}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{rec.approvedBy || "—"}</div>
                      {rec.approvedAt && <div className="text-[10px] text-muted-foreground tabular-nums">{rec.approvedAt}</div>}
                    </TableCell>
                    <TableCell>
                      {nok > 0 ? (
                        <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">
                          {nok} Not Ok
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">
                          All Ok
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => { setViewRecord(rec); setViewOpen(true); }}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ── Add New Dialog ───────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              New Health &amp; Personal Hygiene Inspection
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

            {/* Header fields */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date *</Label>
                <Input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Shift *</Label>
                <Select value={formShift} onValueChange={setFormShift}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PH_SHIFTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Frequency</Label>
                <Input value="Once/Shift" disabled className="mt-1 bg-muted/40 text-muted-foreground" />
              </div>
            </div>

            {/* Inspection grid */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Inspection Parameters
              </p>
              <PHFormGrid
                rows={formRows}
                onCellChange={setCellValue}
                onRemarkChange={setRemarks}
              />
            </div>

            {/* Comments / Correction / Corrective Action */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Comments</Label>
                <Textarea
                  value={formComments}
                  onChange={e => setFormComments(e.target.value)}
                  className="mt-1 min-h-20 text-sm"
                  placeholder="General comments..."
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Correction</Label>
                <Textarea
                  value={formCorrection}
                  onChange={e => setFormCorrection(e.target.value)}
                  className="mt-1 min-h-20 text-sm"
                  placeholder="Corrections made on spot..."
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Corrective Action</Label>
                <Textarea
                  value={formCorrectiveAction}
                  onChange={e => setFormCorrectiveAction(e.target.value)}
                  className="mt-1 min-h-20 text-sm"
                  placeholder="Actions to prevent recurrence..."
                />
              </div>
            </div>

            {/* Checked By preview */}
            <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                Checked By — auto-captured on Submit
              </p>
              <p className="text-sm font-medium text-foreground">{role || "Supervisor (Food Safety & Hygiene)"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Date &amp; time will be recorded at the moment of submission.</p>
            </div>
          </div>
          <DialogFooter className="px-5 py-3 border-t border-border bg-muted/20 shrink-0">
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleSubmit}>
              <ClipboardCheck className="h-4 w-4 mr-1.5" /> Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
          {/* Colored header */}
          <div className="bg-gradient-to-r from-indigo-700 to-indigo-600 text-white px-6 pt-5 pb-4 shrink-0">
            <p className="text-[10px] text-indigo-200 uppercase tracking-widest font-semibold">
              US-Bangla Airlines Ltd. · Catering Department
            </p>
            <h2 className="text-lg font-bold mt-0.5">Health &amp; Personal Hygiene Monitoring</h2>
            <p className="text-indigo-200 text-xs mt-0.5">USBA-FSH-PH-01</p>
            {viewRecord && (
              <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-indigo-100">
                <span>Date: <span className="font-medium text-white">{viewRecord.date}</span></span>
                <span>Shift: <span className="font-medium text-white">{viewRecord.shift}</span></span>
                <span>Frequency: <span className="font-medium text-white">Once/Shift</span></span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  viewRecord.status === "approved" ? "bg-emerald-500 text-white" :
                  viewRecord.status === "verified" ? "bg-blue-400 text-white" :
                  "bg-amber-400 text-amber-900"
                }`}>
                  {viewRecord.status === "approved"
                    ? "Approved"
                    : viewRecord.status === "verified"
                    ? "Verified — Awaiting GM"
                    : "Pending Verification"}
                </span>
              </div>
            )}
          </div>

          {viewRecord && (
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Grid */}
              <PHFormGrid rows={viewRecord.rows} readOnly />

              {/* Comments / Correction / Corrective Action */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                {[
                  { label: "Comments",         value: viewRecord.comments },
                  { label: "Correction",       value: viewRecord.correction },
                  { label: "Corrective Action", value: viewRecord.correctiveAction },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-md border border-border bg-muted/20 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{label}</p>
                    <p className={value ? "text-foreground" : "text-muted-foreground italic"}>{value || "—"}</p>
                  </div>
                ))}
              </div>

              {/* Sign-off panel */}
              <PHSignOffPanel rec={viewRecord} />
            </div>
          )}
          <DialogFooter className="px-5 py-3 border-t border-border bg-muted/20 shrink-0">
            <Button variant="outline" onClick={() => setViewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
