import { useState, Fragment, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, Truck, Pencil, Trash2, ThermometerSun, ShieldCheck,
  AlertOctagon, AlertTriangle, PlaneTakeoff, PlaneLanding,
  Clock, User, CheckCircle2, Eye, Smartphone, ChevronRight, QrCode, X as CloseIcon,
} from "lucide-react";
import { flights } from "@/lib/sample-data";
import { useRole } from "@/lib/roles";
import { KpiCard } from "@/components/common/KpiCard";

// ── Constants ───────────────────────────────────────────────────────────────
const MEAL_TYPES = ["Regular", "Vegetarian (VGML)", "Child Meal (CHML)", "Diabetic (DBML)", "Kosher (KSML)", "Crew Meal", "Special"];
const APT_EXECUTIVES = ["M. Hossain", "T. Ahmed", "K. Sultana", "A. Chowdhury", "R. Islam"];
const APT_DESIGNATIONS = ["APT Executive", "Sr. APT Executive", "Airport Supervisor", "Ground Operations Officer"];
const FS_HYGIENE_EXECUTIVES = ["F. Begum", "A. Khan", "S. Islam", "R. Akter", "N. Hossain"];
const HOC_NAMES = ["Cmd. A. Rahman", "M. Jahangir", "S. Karim", "R. Ahmed"];
const DEP_TIMES = [...new Set(flights.map((f) => f.dep))].sort();
const todayStr = new Date().toISOString().split("T")[0];

function nowTimeStr() {
  const now = new Date();
  return `${todayStr} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
}

// ── Types ───────────────────────────────────────────────────────────────────
type MealLine = { type: string; qty: string };
type ApprovalLog = { name: string; date: string; time: string; remarks: string };
type DispatchEntry = {
  id: string; flightId: string; packagingDate: string; mealLines: MealLine[];
  vehicleNo: string; vehicleClean: "Yes" | "No"; chilledTemp: string; frozenTemp: string;
  loadStartTime: string; loadEndTime: string; vehicleTempBegin: string; vehicleTempEnd: string;
  resultSatisfy: "Yes" | "No"; gateTempGate08: string;
  unloadingTime: string; checkedByApt: string;
  monitoredByRemarks: string; monitoredAt: string;
  approvalStage: 0 | 1 | 2 | 3 | 4;
  verifiedBy?: ApprovalLog;
  approvedBy?: ApprovalLog;
  forwardedToAirportAt?: string;
  receivedBy: string; receivedDesignation: string; receivedAt: string; receivedRemarks: string;
};
type FormState = {
  flightId: string; packagingDate: string; mealLines: MealLine[];
  vehicleNo: string; vehicleClean: "Yes" | "No" | ""; chilledTemp: string; frozenTemp: string;
  loadStartTime: string; loadEndTime: string; vehicleTempBegin: string; vehicleTempEnd: string;
  resultSatisfy: "Yes" | "No" | ""; gateTempGate08: string;
  unloadingTime: string; checkedByApt: string;
  monitoredByRemarks: string;
  ackChilled: boolean; ackFrozen: boolean; ackTempBegin: boolean; ackTempEnd: boolean; ackGate08: boolean;
  receiverRemarks: string;
};

const EMPTY_FORM: FormState = {
  flightId: "", packagingDate: todayStr, mealLines: [{ type: "Regular", qty: "" }],
  vehicleNo: "", vehicleClean: "", chilledTemp: "", frozenTemp: "",
  loadStartTime: "", loadEndTime: "", vehicleTempBegin: "", vehicleTempEnd: "",
  resultSatisfy: "", gateTempGate08: "",
  unloadingTime: "", checkedByApt: "", monitoredByRemarks: "",
  ackChilled: false, ackFrozen: false, ackTempBegin: false, ackTempEnd: false, ackGate08: false,
  receiverRemarks: "",
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const chilledOOR = (v: string) => { const n = parseFloat(v); return v !== "" && !isNaN(n) && (n < 1 || n > 4); };
const frozenOOR  = (v: string) => { const n = parseFloat(v); return v !== "" && !isNaN(n) && (n < -12 || n > -8); };
const vehOOR     = (v: string) => { const n = parseFloat(v); return v !== "" && !isNaN(n) && n > 8; };
const totalQty   = (lines: MealLine[]) => lines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0);
const flightLabel = (id: string) => { const f = flights.find((x) => x.id === id); return f ? `${f.flight} — ${f.sector}` : id; };

// ── UI Primitives ────────────────────────────────────────────────────────────
function TempHint({ note }: { note: string }) {
  return (
    <p className="text-[11px] text-blue-600/80 mt-0.5 italic flex items-center gap-1">
      <ThermometerSun className="h-3 w-3 shrink-0" />{note}
    </p>
  );
}

function YesNoBadge({ value }: { value: "Yes" | "No" }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${value === "Yes" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
      {value}
    </span>
  );
}

function TempCell({ value, oor }: { value: string; oor?: boolean }) {
  const flag = oor !== undefined ? oor : vehOOR(value);
  return <span className={flag ? "text-red-600 font-semibold" : ""}>{value ? `${value}°C` : "—"}</span>;
}

function OorAck({ show, checked, onChange, label }: { show: boolean; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  if (!show) return null;
  return (
    <label className="flex items-center gap-2 mt-1.5 text-xs cursor-pointer select-none bg-red-50 border border-red-200 rounded p-2">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} className="border-red-400" />
      <span className="text-red-700 font-medium">{label}</span>
    </label>
  );
}

function FieldErr({ msg }: { msg?: string }) {
  return msg ? <p className="text-xs text-red-500 mt-0.5">{msg}</p> : null;
}

function YesNoToggle({ value, onChange, error }: { value: "Yes" | "No" | ""; onChange: (v: "Yes" | "No") => void; error?: string }) {
  return (
    <>
      <div className="flex gap-2 mt-1">
        {(["Yes", "No"] as const).map((opt) => (
          <button key={opt} type="button" onClick={() => onChange(opt)}
            className={`flex-1 py-1.5 rounded-md border text-sm font-semibold transition-colors ${
              value === opt
                ? opt === "Yes" ? "bg-emerald-600 border-emerald-600 text-white" : "bg-red-600 border-red-600 text-white"
                : "border-border hover:bg-muted"}`}>
            {opt}
          </button>
        ))}
      </div>
      <FieldErr msg={error} />
    </>
  );
}

function MaxTempBanner() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-xs font-semibold mb-4">
      <ThermometerSun className="h-4 w-4 text-amber-500 shrink-0" />
      Max. Temp. Limit: +8°C — Cold chain integrity must be maintained throughout dispatch
    </div>
  );
}

function Divider({ label, color = "blue" }: { label: string; color?: "blue" | "emerald" | "slate" }) {
  const t = color === "blue" ? "text-blue-600" : color === "emerald" ? "text-emerald-600" : "text-slate-500";
  const l = color === "blue" ? "border-blue-100" : color === "emerald" ? "border-emerald-100" : "border-slate-200";
  return (
    <div className="flex items-center gap-2 mb-2 mt-1">
      <span className={`text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${t}`}>{label}</span>
      <div className={`flex-1 border-t ${l}`} />
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function DispatchMonitoring() {
  useRole();

  const [entries, setEntries] = useState<DispatchEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [depTime, setDepTime] = useState("");
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [approvalTargetId, setApprovalTargetId] = useState<string | null>(null);
  const [approvalCurrentStage, setApprovalCurrentStage] = useState<0 | 1 | 2 | null>(null);
  const [approvalName, setApprovalName] = useState("");
  const [approvalRemarks, setApprovalRemarks] = useState("");
  const [viewEntryId, setViewEntryId] = useState<string | null>(null);
  const [fsRemarksInput, setFsRemarksInput] = useState("");
  const [hocRemarksInput, setHocRemarksInput] = useState("");

  // ── Mobile App View state ───────────────────────────────────────────────────
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"dispatch" | "receive" | "log">("dispatch");
  // Mobile dispatch flow
  const [mScreen, setMScreen] = useState<1 | 2 | 3 | 4>(1);
  const [mFlightIds, setMFlightIds] = useState<string[]>([]);
  const [mVehicleNo, setMVehicleNo] = useState("");
  const [mVehicleClean, setMVehicleClean] = useState<"Clean" | "Not Clean" | "">("");
  const [mChilledTemp, setMChilledTemp] = useState("");
  const [mFrozenTemp, setMFrozenTemp] = useState("");
  const [mVanStart, setMVanStart] = useState("");
  const [mVanEnd, setMVanEnd] = useState("");
  const [mResult, setMResult] = useState<"Yes" | "No" | "">("");
  const [mDispatchedIds, setMDispatchedIds] = useState<string[]>([]);
  const [mLogEntryId, setMLogEntryId] = useState<string | null>(null);
  // Mobile receive flow
  const [rScreen, setRScreen] = useState<1 | 2 | 3>(1);
  const [rSelectedId, setRSelectedId] = useState("");
  const [rGateTemp, setRGateTemp] = useState("");
  const [rUnloadTime, setRUnloadTime] = useState("");
  const [rCheck1, setRCheck1] = useState(false);
  const [rCheck2, setRCheck2] = useState(false);
  const [rCheck3, setRCheck3] = useState(false);
  const [rRemarks, setRRemarks] = useState("");
  const [rAcceptedAt, setRAcceptedAt] = useState("");

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const sf = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const filteredFlights = depTime ? flights.filter((f) => f.dep === depTime) : flights;
  const selectedFlight = flights.find((f) => f.id === form.flightId);

  const handleFlightSelect = (flightId: string) => {
    const f = flights.find((x) => x.id === flightId);
    setForm((prev) => ({
      ...prev,
      flightId,
      packagingDate: todayStr,
      mealLines: f ? [{ type: "Regular", qty: f.pax.toString() }] : prev.mealLines,
    }));
  };

  const resetForm = () => { setShowForm(false); setEditId(null); setForm({ ...EMPTY_FORM }); setDepTime(""); setErrors({}); };

  const openNew = () => {
    setForm({ ...EMPTY_FORM }); setDepTime(""); setEditId(null); setErrors({});
    setFsRemarksInput(""); setHocRemarksInput(""); setShowForm(true);
    setTimeout(() => document.getElementById("dispatch-entry-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const openEdit = (entry: DispatchEntry) => {
    const fl = flights.find((f) => f.id === entry.flightId);
    setDepTime(fl?.dep ?? "");
    setForm({
      flightId: entry.flightId, packagingDate: entry.packagingDate,
      mealLines: entry.mealLines.length ? entry.mealLines : [{ type: "Regular", qty: "" }],
      vehicleNo: entry.vehicleNo, vehicleClean: entry.vehicleClean,
      chilledTemp: entry.chilledTemp, frozenTemp: entry.frozenTemp,
      loadStartTime: entry.loadStartTime, loadEndTime: entry.loadEndTime,
      vehicleTempBegin: entry.vehicleTempBegin, vehicleTempEnd: entry.vehicleTempEnd,
      resultSatisfy: entry.resultSatisfy,
      gateTempGate08: entry.gateTempGate08, unloadingTime: entry.unloadingTime,
      checkedByApt: entry.checkedByApt, monitoredByRemarks: entry.monitoredByRemarks,
      ackChilled: false, ackFrozen: false, ackTempBegin: false, ackTempEnd: false, ackGate08: false,
      receiverRemarks: entry.receivedRemarks,
    });
    setEditId(entry.id); setErrors({});
    setFsRemarksInput(entry.verifiedBy?.remarks ?? "");
    setHocRemarksInput(entry.approvedBy?.remarks ?? "");
    setShowForm(true);
    setTimeout(() => document.getElementById("dispatch-entry-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const validate = () => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.flightId) e.flightId = "Flight is required.";
    if (!form.vehicleNo) e.vehicleNo = "Vehicle No. is required.";
    if (!form.vehicleClean) e.vehicleClean = "Vehicle cleanliness status is required.";
    if (!form.loadStartTime) e.loadStartTime = "Required.";
    if (!form.loadEndTime) e.loadEndTime = "Required.";
    if (form.loadStartTime && form.loadEndTime && form.loadEndTime <= form.loadStartTime) e.loadEndTime = "Must be after start.";
    if (!form.vehicleTempBegin) e.vehicleTempBegin = "Required.";
    if (!form.vehicleTempEnd) e.vehicleTempEnd = "Required.";
    if (!form.resultSatisfy) e.resultSatisfy = "Required.";
    if (chilledOOR(form.chilledTemp) && !form.ackChilled) e.ackChilled = "Acknowledge out-of-range reading.";
    if (frozenOOR(form.frozenTemp) && !form.ackFrozen) e.ackFrozen = "Acknowledge out-of-range reading.";
    if (vehOOR(form.vehicleTempBegin) && !form.ackTempBegin) e.ackTempBegin = "Acknowledge exceeds +8°C.";
    if (vehOOR(form.vehicleTempEnd) && !form.ackTempEnd) e.ackTempEnd = "Acknowledge exceeds +8°C.";
    if (vehOOR(form.gateTempGate08) && !form.ackGate08) e.ackGate08 = "Acknowledge exceeds +8°C.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const saveEntry = () => {
    if (!validate()) return;
    const label = flightLabel(form.flightId);
    const at = nowTimeStr();
    const existing = editId ? entries.find((e) => e.id === editId) : null;
    const base: Omit<DispatchEntry, "id"> = {
      flightId: form.flightId, packagingDate: form.packagingDate,
      mealLines: form.mealLines.filter((l) => l.qty),
      vehicleNo: form.vehicleNo, vehicleClean: form.vehicleClean as "Yes" | "No",
      chilledTemp: form.chilledTemp, frozenTemp: form.frozenTemp,
      loadStartTime: form.loadStartTime, loadEndTime: form.loadEndTime,
      vehicleTempBegin: form.vehicleTempBegin, vehicleTempEnd: form.vehicleTempEnd,
      resultSatisfy: form.resultSatisfy as "Yes" | "No",
      gateTempGate08: form.gateTempGate08, unloadingTime: form.unloadingTime,
      checkedByApt: form.checkedByApt, monitoredByRemarks: form.monitoredByRemarks,
      monitoredAt: existing?.monitoredAt ?? at,
      approvalStage: existing?.approvalStage ?? 0,
      verifiedBy: existing?.verifiedBy,
      approvedBy: existing?.approvedBy,
      receivedBy: existing?.receivedBy ?? "",
      receivedDesignation: existing?.receivedDesignation ?? "",
      receivedAt: existing?.receivedAt ?? "",
      receivedRemarks: form.receiverRemarks,
      forwardedToAirportAt: existing?.forwardedToAirportAt,
    };
    if (editId) {
      setEntries((prev) => prev.map((e) => e.id === editId ? { ...e, ...base } : e));
      toast.success(`Entry updated — ${label}`);
    } else {
      setEntries((prev) => [{ id: `DSP-${Date.now()}`, ...base }, ...prev]);
      toast.success(`Dispatch entry saved — ${label}`);
    }
    resetForm();
  };

  const saveEntryInPlace = () => {
    if (!validate()) return;
    const label = flightLabel(form.flightId);
    const at = nowTimeStr();
    const existing = editId ? entries.find((e) => e.id === editId) : null;
    const base: Omit<DispatchEntry, "id"> = {
      flightId: form.flightId, packagingDate: form.packagingDate,
      mealLines: form.mealLines.filter((l) => l.qty),
      vehicleNo: form.vehicleNo, vehicleClean: form.vehicleClean as "Yes" | "No",
      chilledTemp: form.chilledTemp, frozenTemp: form.frozenTemp,
      loadStartTime: form.loadStartTime, loadEndTime: form.loadEndTime,
      vehicleTempBegin: form.vehicleTempBegin, vehicleTempEnd: form.vehicleTempEnd,
      resultSatisfy: form.resultSatisfy as "Yes" | "No",
      gateTempGate08: form.gateTempGate08, unloadingTime: form.unloadingTime,
      checkedByApt: form.checkedByApt, monitoredByRemarks: form.monitoredByRemarks,
      monitoredAt: existing?.monitoredAt ?? at,
      approvalStage: existing?.approvalStage ?? 0,
      verifiedBy: existing?.verifiedBy,
      approvedBy: existing?.approvedBy,
      receivedBy: existing?.receivedBy ?? "",
      receivedDesignation: existing?.receivedDesignation ?? "",
      receivedAt: existing?.receivedAt ?? "",
      receivedRemarks: form.receiverRemarks,
      forwardedToAirportAt: existing?.forwardedToAirportAt,
    };
    if (editId) {
      setEntries((prev) => prev.map((e) => e.id === editId ? { ...e, ...base } : e));
      toast.success(`Entry updated — ${label}`);
    } else {
      const newId = `DSP-${Date.now()}`;
      setEntries((prev) => [{ id: newId, ...base }, ...prev]);
      setEditId(newId);
      toast.success(`Dispatch entry saved — ${label}`);
    }
  };

  const acceptReceipt = () => {
    if (!validate()) return;
    const label = flightLabel(form.flightId);
    const at = nowTimeStr();
    const existing = editId ? entries.find((e) => e.id === editId) : null;
    const base: Omit<DispatchEntry, "id"> = {
      flightId: form.flightId, packagingDate: form.packagingDate,
      mealLines: form.mealLines.filter((l) => l.qty),
      vehicleNo: form.vehicleNo, vehicleClean: form.vehicleClean as "Yes" | "No",
      chilledTemp: form.chilledTemp, frozenTemp: form.frozenTemp,
      loadStartTime: form.loadStartTime, loadEndTime: form.loadEndTime,
      vehicleTempBegin: form.vehicleTempBegin, vehicleTempEnd: form.vehicleTempEnd,
      resultSatisfy: form.resultSatisfy as "Yes" | "No",
      gateTempGate08: form.gateTempGate08, unloadingTime: form.unloadingTime,
      checkedByApt: form.checkedByApt, monitoredByRemarks: form.monitoredByRemarks,
      monitoredAt: existing?.monitoredAt ?? at,
      approvalStage: existing?.approvalStage ?? 0,
      verifiedBy: existing?.verifiedBy,
      approvedBy: existing?.approvedBy,
      receivedBy: existing?.receivedBy ?? "",
      receivedDesignation: existing?.receivedDesignation ?? "",
      receivedAt: at,
      receivedRemarks: form.receiverRemarks,
      forwardedToAirportAt: existing?.forwardedToAirportAt,
    };
    if (editId) {
      setEntries((prev) => prev.map((e) => e.id === editId ? { ...e, ...base } : e));
    } else {
      const newId = `DSP-${Date.now()}`;
      setEntries((prev) => [{ id: newId, ...base }, ...prev]);
      setEditId(newId);
    }
    toast.success(`Receipt accepted — ${label}`);
  };

  const forwardToAirport = () => {
    if (!editId) return;
    const at = nowTimeStr();
    setEntries((prev) =>
      prev.map((e) => e.id === editId ? { ...e, approvalStage: 4 as const, forwardedToAirportAt: at } : e)
    );
    toast.success("Forwarded to Airport Catering");
  };

  const approveInline = (stage: 0 | 1 | 2) => {
    if (!editId) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== editId) return e;
        if (stage === 0) return { ...e, approvalStage: 1 as const };
        if (stage === 1) return { ...e, approvalStage: 2 as const, verifiedBy: { name: "", date: dateStr, time: timeStr, remarks: fsRemarksInput } };
        return { ...e, approvalStage: 3 as const, approvedBy: { name: "", date: dateStr, time: timeStr, remarks: hocRemarksInput } };
      })
    );
    const msgs = ["Forwarded to Food Safety & Hygiene", "Forwarded to Head of Catering", "Dispatch Approved!"];
    toast.success(msgs[stage]);
  };

  const confirmDelete = () => {
    setEntries((prev) => prev.filter((e) => e.id !== deleteId));
    setDeleteOpen(false);
    toast.success("Entry deleted");
  };

  const openApprovalModal = (entryId: string, stage: 0 | 1 | 2) => {
    setApprovalTargetId(entryId);
    setApprovalCurrentStage(stage);
    setApprovalName("");
    setApprovalRemarks("");
    setApprovalModalOpen(true);
  };

  const confirmApproval = () => {
    if (!approvalTargetId || approvalCurrentStage === null) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== approvalTargetId) return e;
        if (approvalCurrentStage === 0) {
          return { ...e, approvalStage: 1 as const };
        } else if (approvalCurrentStage === 1) {
          return { ...e, approvalStage: 2 as const, verifiedBy: { name: approvalName, date: dateStr, time: timeStr, remarks: approvalRemarks } };
        } else {
          return { ...e, approvalStage: 3 as const, approvedBy: { name: approvalName, date: dateStr, time: timeStr, remarks: approvalRemarks } };
        }
      })
    );
    setApprovalModalOpen(false);
    const msgs = ["Forwarded to Food Safety & Hygiene", "Forwarded to Head of Catering", "Dispatch Approved!"];
    toast.success(msgs[approvalCurrentStage]);
  };

  const mobileConfirmDispatch = () => {
    const at = nowTimeStr();
    const newEntries = mFlightIds.map((flightId, i) => {
      const f = flights.find(x => x.id === flightId);
      const id = `DSP-${Date.now() + i}`;
      return {
        id, flightId, packagingDate: todayStr,
        mealLines: f ? [{ type: "Regular", qty: f.pax.toString() }] : [],
        vehicleNo: mVehicleNo,
        vehicleClean: (mVehicleClean === "Clean" ? "Yes" : "No") as "Yes" | "No",
        chilledTemp: mChilledTemp, frozenTemp: mFrozenTemp,
        loadStartTime: "", loadEndTime: "",
        vehicleTempBegin: mVanStart, vehicleTempEnd: mVanEnd,
        resultSatisfy: mResult as "Yes" | "No",
        gateTempGate08: "", unloadingTime: "", checkedByApt: "", monitoredByRemarks: "",
        monitoredAt: at, approvalStage: 0 as const,
        receivedBy: "", receivedDesignation: "", receivedAt: "", receivedRemarks: "",
      };
    });
    setEntries(prev => [...newEntries, ...prev]);
    setMDispatchedIds(newEntries.map(e => e.id));
    setMScreen(4);
    toast.success(`${newEntries.length} dispatch${newEntries.length > 1 ? "es" : ""} confirmed via Mobile App`);
  };

  const mobileAcceptReceipt = () => {
    const at = nowTimeStr();
    setRAcceptedAt(at);
    setEntries(prev => prev.map(e => e.id === rSelectedId
      ? { ...e, gateTempGate08: rGateTemp, unloadingTime: rUnloadTime, receivedAt: at, receivedRemarks: rRemarks }
      : e));
    setRScreen(3);
    toast.success("Receipt accepted via Mobile App");
  };

  const deleteTarget = entries.find((e) => e.id === deleteId);
  const satisfiedCount = entries.filter((e) => e.resultSatisfy === "Yes").length;
  const unsatisfiedCount = entries.filter((e) => e.resultSatisfy === "No").length;
  const vehicleIssues = entries.filter((e) => e.vehicleClean === "No").length;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <PageHeader
            title="Daily Product Dispatch Monitoring"
            subtitle="Cold chain integrity & vehicle hygiene verification per flight dispatch · USBA-FSH-PDM-01"
          />
        </div>
        <Button
          className="shrink-0 mt-2"
          onClick={() => setMobileOpen(true)}
        >
          <Smartphone className="h-4 w-4 mr-1.5" /> Mobile App View
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-5 -mt-1">Baunia Catering → Airport Catering</p>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Dispatches" value={entries.length} icon={Truck} tone="navy" />
        <KpiCard label="Result Satisfied" value={satisfiedCount} icon={ShieldCheck} tone="success" />
        <KpiCard label="Not Satisfied" value={unsatisfiedCount} icon={AlertOctagon} tone="red" />
        <KpiCard label="Vehicle Issues" value={vehicleIssues} icon={AlertTriangle} tone="warning" />
      </div>

      {/* Entries Table */}
      {entries.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto mb-6 shadow-sm">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 1640 }}>
            <thead>
              <tr className="bg-slate-800 text-white">
                {([
                  ["Flight", true, false], ["Pkg. Date", false, false], ["Qty", false, false],
                  ["Vehicle", false, false], ["Clean", false, false],
                  ["Chilled (1–4°C)", false, false], ["Frozen (-10±2°C)", false, false],
                  ["Load Start", false, false], ["Load End", false, false],
                  ["Veh. Begin", false, false], ["Veh. End", false, false],
                  ["Result", false, false],
                  ["Gate 08 Temp", false, false], ["Unloading", false, false],
                  ["APT Exec.", false, false], ["Remarks", false, false],
                  ["", false, true],
                ] as [string, boolean, boolean][]).map(([h, sl, sr]) => (
                  <th key={h || "act"}
                    className={`px-3 py-2.5 text-left font-semibold whitespace-nowrap text-[11px] ${sl ? "sticky left-0 z-10 bg-slate-800" : sr ? "sticky right-0 z-10 bg-slate-800" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <Fragment key={entry.id}>
                  <tr className={`border-b border-border/40 hover:bg-blue-50/40 transition-colors ${idx % 2 === 1 ? "bg-slate-50/60" : "bg-white"}`}>
                    <td className="px-3 py-2 sticky left-0 z-10 bg-inherit font-semibold whitespace-nowrap text-blue-700">{flightLabel(entry.flightId)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{entry.packagingDate}</td>
                    <td className="px-3 py-2 font-medium">{totalQty(entry.mealLines)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{entry.vehicleNo}</td>
                    <td className="px-3 py-2"><YesNoBadge value={entry.vehicleClean} /></td>
                    <td className="px-3 py-2"><span className={chilledOOR(entry.chilledTemp) ? "text-red-600 font-semibold" : ""}>{entry.chilledTemp ? `${entry.chilledTemp}°C` : "—"}</span></td>
                    <td className="px-3 py-2"><span className={frozenOOR(entry.frozenTemp) ? "text-red-600 font-semibold" : ""}>{entry.frozenTemp ? `${entry.frozenTemp}°C` : "—"}</span></td>
                    <td className="px-3 py-2">{entry.loadStartTime || "—"}</td>
                    <td className="px-3 py-2">{entry.loadEndTime || "—"}</td>
                    <td className="px-3 py-2"><TempCell value={entry.vehicleTempBegin} /></td>
                    <td className="px-3 py-2"><TempCell value={entry.vehicleTempEnd} /></td>
                    <td className="px-3 py-2"><YesNoBadge value={entry.resultSatisfy} /></td>
                    <td className="px-3 py-2"><TempCell value={entry.gateTempGate08} /></td>
                    <td className="px-3 py-2">{entry.unloadingTime || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{entry.checkedByApt || "—"}</td>
                    <td className="px-3 py-2 max-w-[90px] truncate" title={entry.monitoredByRemarks}>{entry.monitoredByRemarks || "—"}</td>
                    <td className="px-3 py-2 sticky right-0 z-10 bg-inherit">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-500 hover:text-slate-700 hover:bg-slate-50" onClick={() => setViewEntryId(entry.id)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-blue-600 hover:text-blue-800 hover:bg-blue-50" onClick={() => openEdit(entry)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => { setDeleteId(entry.id); setDeleteOpen(true); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {/* Log sub-row */}
                  <tr className={idx % 2 === 1 ? "bg-slate-50/60" : "bg-white"}>
                    <td colSpan={17} className="px-3 pb-3 pt-1 border-b border-border/30">
                      <div className="flex flex-col gap-2">
                        {/* Horizontal approval trail */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                          {/* Monitored */}
                          <span className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold text-[10px]">
                              <PlaneTakeoff className="h-2.5 w-2.5" /> Monitored
                            </span>
                            <Clock className="h-3 w-3 text-slate-400" /> {entry.monitoredAt}
                            {entry.monitoredByRemarks && (
                              <span className="text-slate-400 italic ml-1 max-w-[160px] truncate" title={entry.monitoredByRemarks}>
                                — "{entry.monitoredByRemarks}"
                              </span>
                            )}
                          </span>
                          <span className="text-slate-300 font-bold">›</span>
                          {/* Verified */}
                          <span className={`flex items-center gap-1.5 ${!entry.verifiedBy ? "opacity-40" : ""}`}>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${entry.verifiedBy ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                              <ShieldCheck className="h-2.5 w-2.5" /> Verified
                            </span>
                            {entry.verifiedBy ? (
                              <>
                                <User className="h-3 w-3 text-slate-400" />
                                <strong>{entry.verifiedBy.name}</strong> ·
                                <Clock className="h-3 w-3 text-slate-400 ml-0.5" /> {entry.verifiedBy.date}, {entry.verifiedBy.time}
                                {entry.verifiedBy.remarks && (
                                  <span className="text-slate-400 italic ml-1 max-w-[160px] truncate" title={entry.verifiedBy.remarks}>
                                    — "{entry.verifiedBy.remarks}"
                                  </span>
                                )}
                              </>
                            ) : <span className="text-slate-400">Pending</span>}
                          </span>
                          <span className="text-slate-300 font-bold">›</span>
                          {/* Approved */}
                          <span className={`flex items-center gap-1.5 ${!entry.approvedBy ? "opacity-40" : ""}`}>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${entry.approvedBy ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"}`}>
                              <CheckCircle2 className="h-2.5 w-2.5" /> Approved
                            </span>
                            {entry.approvedBy ? (
                              <>
                                <User className="h-3 w-3 text-slate-400" />
                                <strong>{entry.approvedBy.name}</strong> ·
                                <Clock className="h-3 w-3 text-slate-400 ml-0.5" /> {entry.approvedBy.date}, {entry.approvedBy.time}
                                {entry.approvedBy.remarks && (
                                  <span className="text-slate-400 italic ml-1 max-w-[160px] truncate" title={entry.approvedBy.remarks}>
                                    — "{entry.approvedBy.remarks}"
                                  </span>
                                )}
                              </>
                            ) : <span className="text-slate-400">Pending</span>}
                          </span>
                        </div>

                        {/* Airport receipt info */}
                        {entry.receivedAt ? (
                          <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold text-[10px]">
                              <CheckCircle2 className="h-2.5 w-2.5" /> Received
                            </span>
                            <Clock className="h-3 w-3 text-slate-400" /> {entry.receivedAt}
                            {entry.receivedRemarks && (
                              <span className="text-slate-400 italic ml-1 max-w-[160px] truncate" title={entry.receivedRemarks}>
                                — "{entry.receivedRemarks}"
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] w-fit">
                            <Clock className="h-2.5 w-2.5" /> Awaiting Airport Receipt
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Inline Two-Panel Entry Form ──────────────────────────────────────── */}
      <div id="dispatch-entry-form" className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-slate-700">
            {showForm ? (editId ? "Editing Dispatch Entry" : "New Dispatch Entry") : ""}
          </span>
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Dispatch Entry
          </Button>
        </div>

        {!showForm && entries.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 py-20 text-center">
            <Truck className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No dispatch entries for today.</p>
            <p className="text-xs text-muted-foreground mt-1">Click <strong>+ Add Dispatch Entry</strong> above to begin.</p>
          </div>
        )}

        {showForm && (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

              {/* ══ LEFT: Catering Point ══════════════════════════════════════ */}
              <div className="rounded-xl border border-blue-300 bg-white shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-blue-700 to-blue-600 text-white px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <PlaneTakeoff className="h-5 w-5" />
                    <div>
                      <p className="font-bold text-sm">Catering Point Dispatch Entry</p>
                      <p className="text-[11px] text-blue-200 mt-0.5">Baunia Central Kitchen</p>
                    </div>
                  </div>
                  <span className="text-xs bg-blue-800/60 px-2.5 py-1 rounded-full">USBA-FSH-PDM-01</span>
                </div>

                <div className="p-5 space-y-4">
                  <MaxTempBanner />

                  {/* ─ Flight & Packaging ─ */}
                  <Divider label="Flight & Packaging" color="blue" />

                  {/* Row: dep time | flight | date */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Departure Time</Label>
                      <Select value={depTime} onValueChange={(v) => { setDepTime(v); const first = flights.find((f) => f.dep === v); if (first) handleFlightSelect(first.id); else sf("flightId", ""); }}>
                        <SelectTrigger className="mt-1 h-9 text-sm">
                          <SelectValue placeholder="Select time" />
                        </SelectTrigger>
                        <SelectContent>
                          {DEP_TIMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Flight Number *</Label>
                      <Select value={form.flightId} onValueChange={handleFlightSelect}>
                        <SelectTrigger className={`mt-1 h-9 text-sm ${errors.flightId ? "border-red-400" : ""}`}>
                          <SelectValue placeholder="Select flight" />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredFlights.map((f) => <SelectItem key={f.id} value={f.id}>{f.flight} — {f.sector}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FieldErr msg={errors.flightId} />
                    </div>
                    <div>
                      <Label className="text-xs">Date of Packaging</Label>
                      <Input type="date" value={form.packagingDate} onChange={(e) => sf("packagingDate", e.target.value)} className="mt-1 h-9 text-sm" />
                    </div>
                  </div>

                  {/* Auto-fill chips */}
                  {selectedFlight && (
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: selectedFlight.sector, color: "blue" },
                        { label: selectedFlight.aircraft, color: "blue" },
                        { label: `DEP ${selectedFlight.dep}`, color: "indigo" },
                        { label: `${selectedFlight.pax} PAX`, color: "slate" },
                        { label: selectedFlight.window, color: "amber" },
                        { label: selectedFlight.status, color: selectedFlight.status === "Boarding" ? "emerald" : selectedFlight.status === "Delayed" ? "red" : "slate" },
                      ].map(({ label, color }) => (
                        <span key={label} className={`px-2.5 py-1 rounded-md border text-[11px] font-medium
                          ${color === "blue" ? "bg-blue-50 border-blue-200 text-blue-700" :
                            color === "indigo" ? "bg-indigo-50 border-indigo-200 text-indigo-700" :
                            color === "amber" ? "bg-amber-50 border-amber-200 text-amber-700" :
                            color === "emerald" ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                            color === "red" ? "bg-red-50 border-red-200 text-red-700" :
                            "bg-slate-50 border-slate-200 text-slate-700"}`}>
                          {label}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Meal lines */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs">Meal Types & Quantities</Label>
                      <span className="text-xs text-muted-foreground">Total: <strong className="text-blue-700">{totalQty(form.mealLines)}</strong> pax</span>
                    </div>
                    <div className="space-y-1.5">
                      {form.mealLines.map((line, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <Select value={line.type} onValueChange={(v) => sf("mealLines", form.mealLines.map((l, j) => j === i ? { ...l, type: v } : l))}>
                            <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{MEAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                          </Select>
                          <Input type="number" min={0} placeholder="Qty" value={line.qty}
                            onChange={(e) => sf("mealLines", form.mealLines.map((l, j) => j === i ? { ...l, qty: e.target.value } : l))}
                            className="w-20 h-8 text-xs" />
                          {form.mealLines.length > 1 && (
                            <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-400"
                              onClick={() => sf("mealLines", form.mealLines.filter((_, j) => j !== i))}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    <Button type="button" size="sm" variant="outline" className="mt-2 h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                      onClick={() => sf("mealLines", [...form.mealLines, { type: "Regular", qty: "" }])}>
                      <Plus className="h-3 w-3 mr-1" /> Add Meal Type
                    </Button>
                  </div>

                  {/* ─ Vehicle ─ */}
                  <Divider label="Vehicle Details" color="blue" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Vehicle No. *</Label>
                      <Input
                        placeholder="e.g. HiLoader-02"
                        value={form.vehicleNo}
                        onChange={(e) => sf("vehicleNo", e.target.value)}
                        className={`mt-1 h-9 ${errors.vehicleNo ? "border-red-400" : ""}`}
                      />
                      <FieldErr msg={errors.vehicleNo} />
                    </div>
                    <div>
                      <Label className="text-xs">Vehicle Clean *</Label>
                      <YesNoToggle value={form.vehicleClean} onChange={(v) => sf("vehicleClean", v)} error={errors.vehicleClean} />
                      {form.vehicleClean === "No" && <p className="text-xs text-amber-600 mt-1 font-medium">⚠ Report to supervisor immediately</p>}
                    </div>
                  </div>

                  {/* ─ Core Temps ─ */}
                  <Divider label="Product Core Temperature" color="blue" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Chilled Temp (°C)</Label>
                      <Input type="number" step="0.1" placeholder="e.g. 3.0" value={form.chilledTemp}
                        onChange={(e) => { sf("chilledTemp", e.target.value); sf("ackChilled", false); }}
                        className={`mt-1 h-9 ${chilledOOR(form.chilledTemp) ? "border-red-400 bg-red-50" : ""}`} />
                      <TempHint note="Standard: 1°C – 4°C for chilled products" />
                      {chilledOOR(form.chilledTemp) && <p className="text-xs text-red-600 mt-0.5 font-semibold">⚠ Out of range</p>}
                      <OorAck show={chilledOOR(form.chilledTemp)} checked={form.ackChilled} onChange={(v) => sf("ackChilled", v)} label="I acknowledge this reading is outside range" />
                      <FieldErr msg={errors.ackChilled} />
                    </div>
                    <div>
                      <Label className="text-xs">Frozen Temp (°C)</Label>
                      <Input type="number" step="0.1" placeholder="e.g. -10.0" value={form.frozenTemp}
                        onChange={(e) => { sf("frozenTemp", e.target.value); sf("ackFrozen", false); }}
                        className={`mt-1 h-9 ${frozenOOR(form.frozenTemp) ? "border-red-400 bg-red-50" : ""}`} />
                      <TempHint note="Standard: -12°C – -8°C for frozen items" />
                      {frozenOOR(form.frozenTemp) && <p className="text-xs text-red-600 mt-0.5 font-semibold">⚠ Out of range</p>}
                      <OorAck show={frozenOOR(form.frozenTemp)} checked={form.ackFrozen} onChange={(v) => sf("ackFrozen", v)} label="I acknowledge this reading is outside range" />
                      <FieldErr msg={errors.ackFrozen} />
                    </div>
                  </div>

                  {/* ─ Loading Times + Vehicle Temps — 4-col horizontal ─ */}
                  <Divider label="Loading Times & Vehicle Temperature" color="blue" />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs">Load Start *</Label>
                      <Input type="time" value={form.loadStartTime} onChange={(e) => sf("loadStartTime", e.target.value)}
                        className={`mt-1 h-9 ${errors.loadStartTime ? "border-red-400" : ""}`} />
                      <FieldErr msg={errors.loadStartTime} />
                    </div>
                    <div>
                      <Label className="text-xs">Load End *</Label>
                      <Input type="time" value={form.loadEndTime} onChange={(e) => sf("loadEndTime", e.target.value)}
                        className={`mt-1 h-9 ${errors.loadEndTime ? "border-red-400" : ""}`} />
                      <FieldErr msg={errors.loadEndTime} />
                    </div>
                    <div>
                      <Label className="text-xs">Veh. Temp Begin (°C) *</Label>
                      <Input type="number" step="0.1" placeholder="e.g. 4.5" value={form.vehicleTempBegin}
                        onChange={(e) => { sf("vehicleTempBegin", e.target.value); sf("ackTempBegin", false); }}
                        className={`mt-1 h-9 ${errors.vehicleTempBegin || vehOOR(form.vehicleTempBegin) ? "border-red-400 bg-red-50" : ""}`} />
                      <TempHint note="Max: +8°C" />
                      {vehOOR(form.vehicleTempBegin) && <p className="text-xs text-red-600 font-semibold">⚠ Exceeds limit</p>}
                      <OorAck show={vehOOR(form.vehicleTempBegin)} checked={form.ackTempBegin} onChange={(v) => sf("ackTempBegin", v)} label="Acknowledge" />
                      <FieldErr msg={errors.vehicleTempBegin ?? errors.ackTempBegin} />
                    </div>
                    <div>
                      <Label className="text-xs">Veh. Temp End (°C) *</Label>
                      <Input type="number" step="0.1" placeholder="e.g. 5.0" value={form.vehicleTempEnd}
                        onChange={(e) => { sf("vehicleTempEnd", e.target.value); sf("ackTempEnd", false); }}
                        className={`mt-1 h-9 ${errors.vehicleTempEnd || vehOOR(form.vehicleTempEnd) ? "border-red-400 bg-red-50" : ""}`} />
                      <TempHint note="Max: +8°C" />
                      {vehOOR(form.vehicleTempEnd) && <p className="text-xs text-red-600 font-semibold">⚠ Exceeds limit</p>}
                      <OorAck show={vehOOR(form.vehicleTempEnd)} checked={form.ackTempEnd} onChange={(v) => sf("ackTempEnd", v)} label="Acknowledge" />
                      <FieldErr msg={errors.vehicleTempEnd ?? errors.ackTempEnd} />
                    </div>
                  </div>

                  {/* ─ Result ─ */}
                  <Divider label="Result Check" color="blue" />
                  <div className="max-w-xs">
                    <Label className="text-xs">Result Satisfy *</Label>
                    <YesNoToggle value={form.resultSatisfy} onChange={(v) => sf("resultSatisfy", v)} error={errors.resultSatisfy} />
                    {form.resultSatisfy === "No" && <p className="text-xs text-amber-600 mt-1 font-medium">⚠ Record preventive action below</p>}
                  </div>

                  {/* ─ Dispatch Log & Approval Trail ─ */}
                  <Divider label="Dispatch Log" color="blue" />

                  {/* Horizontal Approval Log Trail */}
                  {(() => {
                    const curEntry = editId ? entries.find((e) => e.id === editId) : null;
                    const curStage = curEntry?.approvalStage ?? 0;
                    return (
                      <div className="grid grid-cols-3 border border-blue-200 rounded-lg overflow-hidden divide-x divide-blue-200">
                        {/* ① Monitored By */}
                        <div className="p-3 bg-blue-50/40 flex flex-col">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600 mb-1.5 flex items-center gap-1">
                            <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-600 text-white text-[9px] font-bold">1</span>
                            Monitored By
                          </p>
                          <p className="text-[10px] text-slate-400 italic flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" /> Time auto-recorded on save
                          </p>
                          <div className="mt-2 flex-1">
                            <p className="text-[10px] text-muted-foreground mb-0.5">Remarks</p>
                            <Textarea
                              value={form.monitoredByRemarks}
                              onChange={(e) => sf("monitoredByRemarks", e.target.value)}
                              placeholder="Remarks by monitored person..."
                              className="min-h-[56px] text-xs resize-none"
                              disabled={curStage > 0}
                            />
                          </div>
                          <div className="mt-2 flex flex-col gap-1.5">
                            {curStage > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold w-fit">
                                <PlaneTakeoff className="h-2.5 w-2.5" /> Forwarded to Food Safety
                              </span>
                            ) : (
                              <>
                                <Button type="button" size="sm" className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white border-0" onClick={saveEntryInPlace}>
                                  Save
                                </Button>
                                {editId && (
                                  <Button type="button" size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white border-0" onClick={() => approveInline(0)}>
                                    Forward To Food Safety And Hygiene
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* ② Verified By */}
                        <div className={`p-3 flex flex-col ${curStage >= 1 ? "bg-emerald-50/30" : "opacity-50 bg-slate-50/30"}`}>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-1.5 flex items-center gap-1">
                            <span className={`inline-flex items-center justify-center h-4 w-4 rounded-full text-white text-[9px] font-bold ${curStage >= 1 ? "bg-emerald-500" : "bg-slate-300"}`}>2</span>
                            Verified By
                          </p>
                          <p className="text-xs text-slate-500">Food Safety &amp; Hygiene Executive</p>
                          {curStage >= 2 && curEntry?.verifiedBy ? (
                            <>
                              <p className="text-[10px] text-slate-400 italic flex items-center gap-1 mt-0.5">
                                <Clock className="h-2.5 w-2.5" /> {curEntry.verifiedBy.date}, {curEntry.verifiedBy.time}
                              </p>
                              <div className="mt-2 flex-1">
                                <p className="text-[10px] text-muted-foreground mb-0.5">Remarks</p>
                                <p className="text-xs text-slate-600 italic min-h-[56px] bg-slate-50 rounded p-1.5">{curEntry.verifiedBy.remarks || "—"}</p>
                              </div>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold w-fit mt-2">
                                <ShieldCheck className="h-2.5 w-2.5" /> Forwarded to HoC
                              </span>
                            </>
                          ) : curStage === 1 ? (
                            <>
                              <p className="text-[10px] text-slate-400 italic flex items-center gap-1 mt-0.5">
                                <Clock className="h-2.5 w-2.5" /> Time auto-recorded on forward
                              </p>
                              <div className="mt-2 flex-1">
                                <p className="text-[10px] text-muted-foreground mb-0.5">Remarks</p>
                                <Textarea
                                  value={fsRemarksInput}
                                  onChange={(e) => setFsRemarksInput(e.target.value)}
                                  placeholder="Remarks by FS executive..."
                                  className="min-h-[56px] text-xs resize-none"
                                />
                              </div>
                              <div className="mt-2 flex flex-col gap-1.5">
                                <Button type="button" size="sm" className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white border-0" onClick={saveEntryInPlace}>
                                  Save
                                </Button>
                                <Button type="button" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0" onClick={() => approveInline(1)}>
                                  Forward To Head Of Catering
                                </Button>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-[10px] text-slate-400 mt-0.5">Pending FS forwarding</p>
                              <div className="mt-2 flex-1">
                                <p className="text-[10px] text-muted-foreground mb-0.5">Remarks</p>
                                <Textarea disabled placeholder="Pending verification..." className="min-h-[56px] text-xs resize-none" />
                              </div>
                            </>
                          )}
                        </div>

                        {/* ③ Approved By */}
                        <div className={`p-3 flex flex-col ${curStage >= 2 ? "bg-violet-50/30" : "opacity-50 bg-slate-50/30"}`}>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-violet-600 mb-1.5 flex items-center gap-1">
                            <span className={`inline-flex items-center justify-center h-4 w-4 rounded-full text-white text-[9px] font-bold ${curStage >= 2 ? "bg-violet-500" : "bg-slate-300"}`}>3</span>
                            Approved By
                          </p>
                          <p className="text-xs text-slate-500">Head of Catering</p>
                          {curStage >= 3 && curEntry?.approvedBy ? (
                            <>
                              <p className="text-[10px] text-slate-400 italic flex items-center gap-1 mt-0.5">
                                <Clock className="h-2.5 w-2.5" /> {curEntry.approvedBy.date}, {curEntry.approvedBy.time}
                              </p>
                              <div className="mt-2 flex-1">
                                <p className="text-[10px] text-muted-foreground mb-0.5">Remarks</p>
                                <p className="text-xs text-slate-600 italic min-h-[56px] bg-slate-50 rounded p-1.5">{curEntry.approvedBy.remarks || "—"}</p>
                              </div>
                              <div className="mt-2 flex flex-col gap-1.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-semibold w-fit">
                                  <CheckCircle2 className="h-2.5 w-2.5" /> Dispatch Done
                                </span>
                                {curStage === 3 ? (
                                  <Button type="button" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0" onClick={forwardToAirport}>
                                    <PlaneLanding className="h-3 w-3 mr-1" /> Forward To Airport Catering
                                  </Button>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold w-fit">
                                    <PlaneLanding className="h-2.5 w-2.5" /> Forwarded To Airport Catering
                                  </span>
                                )}
                              </div>
                            </>
                          ) : curStage === 2 ? (
                            <>
                              <p className="text-[10px] text-slate-400 italic flex items-center gap-1 mt-0.5">
                                <Clock className="h-2.5 w-2.5" /> Time auto-recorded on approval
                              </p>
                              <div className="mt-2 flex-1">
                                <p className="text-[10px] text-muted-foreground mb-0.5">Remarks</p>
                                <Textarea
                                  value={hocRemarksInput}
                                  onChange={(e) => setHocRemarksInput(e.target.value)}
                                  placeholder="Remarks by Head of Catering..."
                                  className="min-h-[56px] text-xs resize-none"
                                />
                              </div>
                              <div className="mt-2 flex flex-col gap-1.5">
                                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => editId && setViewEntryId(editId)}>
                                  <Eye className="h-3 w-3 mr-1" /> View
                                </Button>
                                <Button type="button" size="sm" className="h-7 text-xs bg-violet-600 hover:bg-violet-700 text-white border-0" onClick={() => approveInline(2)}>
                                  Approve Dispatch
                                </Button>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-[10px] text-slate-400 mt-0.5">Pending HoC approval</p>
                              <div className="mt-2 flex-1">
                                <p className="text-[10px] text-muted-foreground mb-0.5">Remarks</p>
                                <Textarea disabled placeholder="Pending approval..." className="min-h-[56px] text-xs resize-none" />
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* ══ RIGHT: Airport Point ══════════════════════════════════════ */}
              <div className="rounded-xl border border-emerald-300 bg-white shadow-sm overflow-hidden self-start">
                <div className="bg-gradient-to-r from-emerald-700 to-emerald-600 text-white px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <PlaneLanding className="h-5 w-5" />
                    <div>
                      <p className="font-bold text-sm">Airport Point Receiving Entry</p>
                      <p className="text-[11px] text-emerald-200 mt-0.5">Airport Catering Unit — Gate No. 08</p>
                    </div>
                  </div>
                  <span className="text-xs bg-emerald-800/60 px-2.5 py-1 rounded-full">APT Verify</span>
                </div>

                <div className="p-5 space-y-4">
                  <MaxTempBanner />

                  {/* ─ Gate Details — 3-col horizontal ─ */}
                  <Divider label="Airport Gate Details — Gate No. 08" color="emerald" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Gate 08 Temp (°C)</Label>
                      <Input type="number" step="0.1" placeholder="e.g. 6.5" value={form.gateTempGate08}
                        onChange={(e) => { sf("gateTempGate08", e.target.value); sf("ackGate08", false); }}
                        className={`mt-1 h-9 ${vehOOR(form.gateTempGate08) ? "border-red-400 bg-red-50" : ""}`} />
                      <TempHint note="Max: +8°C at gate" />
                      {vehOOR(form.gateTempGate08) && <p className="text-xs text-red-600 mt-0.5 font-semibold">⚠ Exceeds +8°C</p>}
                      <OorAck show={vehOOR(form.gateTempGate08)} checked={form.ackGate08} onChange={(v) => sf("ackGate08", v)} label="Acknowledge" />
                      <FieldErr msg={errors.ackGate08} />
                    </div>
                    <div>
                      <Label className="text-xs">Time of Unloading</Label>
                      <Input type="time" value={form.unloadingTime} onChange={(e) => sf("unloadingTime", e.target.value)} className="mt-1 h-9" />
                      <TempHint note="Time when unloading begins at gate" />
                    </div>
                  </div>

                  {/* Protocol */}
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3.5">
                    <p className="text-xs font-bold text-emerald-800 flex items-center gap-1.5 mb-2">
                      <ShieldCheck className="h-3.5 w-3.5" /> Airport Receiving Protocol
                    </p>
                    <ul className="text-xs text-emerald-700 space-y-1">
                      <li className="flex items-start gap-1.5"><span className="text-emerald-500 mt-0.5">✔</span>Verify vehicle temperature at gate before unloading begins</li>
                      <li className="flex items-start gap-1.5"><span className="text-emerald-500 mt-0.5">✔</span>Check product seal integrity and packaging condition upon arrival</li>
                      <li className="flex items-start gap-1.5"><span className="text-emerald-500 mt-0.5">✔</span>Record unloading time accurately in the system</li>
                      <li className="flex items-start gap-1.5"><span className="text-emerald-500 mt-0.5">✔</span>APT executive must physically verify and countersign</li>
                      <li className="flex items-start gap-1.5"><span className="text-emerald-500 mt-0.5">✔</span>Any temperature breach must be escalated immediately</li>
                    </ul>
                  </div>

                  {/* Cold chain visual */}
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-center">
                    <div className="flex items-center justify-center gap-2 text-xs text-slate-600">
                      <span className="px-2.5 py-1 rounded-md bg-blue-100 text-blue-700 font-semibold">Catering Kitchen</span>
                      <span className="flex-1 border-t-2 border-dashed border-slate-300 relative">
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">≤ +8°C</span>
                      </span>
                      <span className="px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-700 font-semibold">Airport Gate 08</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-3">Cold chain must be unbroken from kitchen to gate</p>
                  </div>

                  {/* ─ Receipt Log ─ */}
                  <Divider label="Receipt Log" color="emerald" />
                  <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-3.5 space-y-3">
                    <p className="text-[11px] text-emerald-700 font-bold flex items-center gap-1.5">
                      <PlaneLanding className="h-3.5 w-3.5" /> Received By (Airport Catering)
                    </p>
                    <p className="text-[11px] text-slate-400 italic flex items-center gap-1">
                      <User className="h-3 w-3" /> Name &amp; designation auto-filled by system
                    </p>
                    <div>
                      <Label className="text-xs">Remarks</Label>
                      <Textarea
                        value={form.receiverRemarks}
                        onChange={(e) => sf("receiverRemarks", e.target.value)}
                        placeholder="Remarks by receiving officer..."
                        className="mt-1 min-h-[60px] text-xs resize-none"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Date &amp; time auto-recorded on accept
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0 px-4"
                        onClick={acceptReceipt}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Save And Accept
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Save / Cancel */}
            <div className="mt-5 flex items-center justify-end gap-3 border-t border-border pt-4">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 shadow-md" onClick={saveEntry}>
                <ShieldCheck className="h-4 w-4 mr-2" />
                {editId ? "Save Changes" : "Save Dispatch Entry"}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Delete Dispatch Entry?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete entry for <span className="font-semibold text-foreground">{deleteTarget ? flightLabel(deleteTarget.flightId) : ""}</span>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Approval Modal ───────────────────────────────────────────────────── */}
      <Dialog open={approvalModalOpen} onOpenChange={setApprovalModalOpen}>
        <DialogContent className="w-full max-w-full sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {approvalCurrentStage === 0
                ? "Forward To Food Safety & Hygiene"
                : approvalCurrentStage === 1
                ? "Forward To Head Of Catering"
                : "Approve and Dispatch"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {approvalCurrentStage === 0 ? (
              <p className="text-sm text-muted-foreground leading-relaxed">
                Confirm forwarding this entry to the Food Safety &amp; Hygiene team for verification.
              </p>
            ) : (
              <>
                <div>
                  <Label className="text-xs">
                    {approvalCurrentStage === 1 ? "Food Safety & Hygiene Executive *" : "Head of Catering *"}
                  </Label>
                  <Select value={approvalName} onValueChange={setApprovalName}>
                    <SelectTrigger className="mt-1 h-9">
                      <SelectValue placeholder="Select name" />
                    </SelectTrigger>
                    <SelectContent>
                      {(approvalCurrentStage === 1 ? FS_HYGIENE_EXECUTIVES : HOC_NAMES).map((n) => (
                        <SelectItem key={n} value={n}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Remarks</Label>
                  <Textarea
                    value={approvalRemarks}
                    onChange={(e) => setApprovalRemarks(e.target.value)}
                    placeholder="Add remarks..."
                    className="mt-1 min-h-[72px] text-xs"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovalModalOpen(false)}>Cancel</Button>
            <Button
              onClick={confirmApproval}
              disabled={approvalCurrentStage !== 0 && !approvalName}
              className={approvalCurrentStage === 2 ? "bg-violet-600 hover:bg-violet-700 text-white border-0" : approvalCurrentStage === 1 ? "bg-emerald-600 hover:bg-emerald-700 text-white border-0" : ""}
            >
              {approvalCurrentStage === 0
                ? "Confirm Forward"
                : approvalCurrentStage === 1
                ? "Forward to HoC"
                : "Approve & Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Entry Modal ─────────────────────────────────────────────────── */}
      {(() => {
        const entry = entries.find((e) => e.id === viewEntryId);
        return (
          <Dialog open={!!viewEntryId} onOpenChange={(v) => !v && setViewEntryId(null)}>
            <DialogContent className="w-full max-w-full sm:max-w-lg max-h-[100vh] sm:max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
              <div className="px-6 pt-5 pb-4 border-b shrink-0">
                <DialogTitle className="text-base font-semibold">
                  Dispatch Entry — {entry ? flightLabel(entry.flightId) : ""}
                </DialogTitle>
                {entry && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {entry.packagingDate} · Vehicle: {entry.vehicleNo} · {totalQty(entry.mealLines)} pax
                  </p>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {entry && (
                  <>
                    {/* Basic info grid */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div><span className="text-xs text-muted-foreground">Flight</span><div className="font-semibold text-blue-700">{flightLabel(entry.flightId)}</div></div>
                      <div><span className="text-xs text-muted-foreground">Date</span><div>{entry.packagingDate}</div></div>
                      <div><span className="text-xs text-muted-foreground">Total Qty</span><div className="font-semibold">{totalQty(entry.mealLines)} pax</div></div>
                      <div><span className="text-xs text-muted-foreground">Vehicle No.</span><div>{entry.vehicleNo}</div></div>
                      <div><span className="text-xs text-muted-foreground">Vehicle Clean</span><div><YesNoBadge value={entry.vehicleClean} /></div></div>
                      <div><span className="text-xs text-muted-foreground">Result Satisfy</span><div><YesNoBadge value={entry.resultSatisfy} /></div></div>
                    </div>

                    {/* Approval log trail */}
                    <div className="border-t border-border pt-3">
                      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Approval Log</p>
                      <div className="space-y-2.5">

                        {/* ① Monitored By */}
                        <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">① Monitored By</span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{entry.monitoredAt}</span>
                          </div>
                          {entry.monitoredByRemarks && (
                            <p className="text-xs text-slate-600 mt-1.5 italic">"{entry.monitoredByRemarks}"</p>
                          )}
                        </div>

                        {/* ② Verified By */}
                        <div className={`rounded-lg border p-3 ${entry.verifiedBy ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-slate-50/40 opacity-50"}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${entry.verifiedBy ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                              ② Verified By
                            </span>
                            <span className="text-xs font-semibold">{entry.verifiedBy?.name ?? "Pending"}</span>
                          </div>
                          {entry.verifiedBy ? (
                            <>
                              <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                                <span>Food Safety &amp; Hygiene Executive</span>
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{entry.verifiedBy.date}, {entry.verifiedBy.time}</span>
                              </div>
                              {entry.verifiedBy.remarks && (
                                <p className="text-xs text-slate-600 mt-1.5 italic">"{entry.verifiedBy.remarks}"</p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">Awaiting Food Safety &amp; Hygiene forwarding</p>
                          )}
                        </div>

                        {/* ③ Approved By */}
                        <div className={`rounded-lg border p-3 ${entry.approvedBy ? "border-violet-200 bg-violet-50/40" : "border-slate-200 bg-slate-50/40 opacity-50"}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${entry.approvedBy ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"}`}>
                              ③ Approved By
                            </span>
                            <span className="text-xs font-semibold">{entry.approvedBy?.name ?? "Pending"}</span>
                          </div>
                          {entry.approvedBy ? (
                            <>
                              <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                                <span>Head of Catering</span>
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{entry.approvedBy.date}, {entry.approvedBy.time}</span>
                              </div>
                              {entry.approvedBy.remarks && (
                                <p className="text-xs text-slate-600 mt-1.5 italic">"{entry.approvedBy.remarks}"</p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">Awaiting Head of Catering approval</p>
                          )}
                        </div>

                        {/* ④ Received By */}
                        <div className={`rounded-lg border p-3 ${entry.receivedAt ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-slate-50/40 opacity-50"}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${entry.receivedAt ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                              ④ Received By (Airport Catering)
                            </span>
                          </div>
                          {entry.receivedAt ? (
                            <>
                              <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{entry.receivedAt}</span>
                              </div>
                              {entry.receivedRemarks && (
                                <p className="text-xs text-slate-600 mt-1.5 italic">"{entry.receivedRemarks}"</p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">Awaiting airport receipt</p>
                          )}
                        </div>

                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="px-6 py-4 border-t shrink-0 flex justify-end">
                <Button variant="outline" onClick={() => setViewEntryId(null)}>Close</Button>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ── Mobile App View Overlay ────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.65)", backdropFilter: "blur(6px)" }}
        >
          <button
            onClick={() => setMobileOpen(false)}
            className="absolute top-5 right-5 text-white/70 hover:text-white transition-colors"
            aria-label="Close"
          >
            <CloseIcon className="h-7 w-7" />
          </button>

          {/* Phone frame */}
          <div
            className="relative flex flex-col overflow-hidden shadow-2xl"
            style={{
              width: 375,
              height: Math.min(720, window.innerHeight - 60),
              borderRadius: 36,
              border: "8px solid #1E293B",
              background: "#F1F5F9",
            }}
          >
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-1.5 rounded-full bg-slate-700 z-10" />

            {/* Status bar */}
            <div className="bg-slate-900 text-white flex justify-between items-center px-5 pt-5 pb-1.5 shrink-0 text-[10px]">
              <span className="font-semibold">9:41</span>
              <span className="opacity-60">●●● WiFi 84%</span>
            </div>

            {/* Tab switcher */}
            {mobileTab !== "log" && (
              <div className="bg-white border-b border-slate-200 flex shrink-0">
                <button
                  onClick={() => setMobileTab("dispatch")}
                  className={`flex-1 py-2.5 text-[11px] font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${mobileTab === "dispatch" ? "border-blue-500 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                >
                  <Truck className="h-3.5 w-3.5" /> Kitchen Dispatch
                </button>
                <button
                  onClick={() => setMobileTab("receive")}
                  className={`flex-1 py-2.5 text-[11px] font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${mobileTab === "receive" ? "border-emerald-500 text-emerald-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                >
                  <PlaneLanding className="h-3.5 w-3.5" /> Airport Receiving
                </button>
              </div>
            )}

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">

              {/* ═══ DISPATCH TAB ═══ */}
              {mobileTab === "dispatch" && (
                <>
                  {/* Screen 1 — Flight Selection */}
                  {mScreen === 1 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">Baunia Central Kitchen · USBA-FSH-PDM-01</p>
                          <p className="font-bold text-slate-800 text-sm">Dispatch Entry</p>
                        </div>
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">1 of 4</span>
                      </div>
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-700 font-medium">
                        <ThermometerSun className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        Max. Temp. Limit: +8°C — Cold chain integrity must be maintained
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Today's Assigned Flights</span>
                          <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full">Auto-loaded</span>
                        </div>
                        <div className="space-y-2">
                          {flights.slice(0, 5).map(f => {
                            const isSelected = mFlightIds.includes(f.id);
                            return (
                              <Fragment key={f.id}>
                                <button onClick={() => setMFlightIds(prev => prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id])}
                                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${isSelected ? "border-blue-400 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-blue-200"}`}>
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-sm text-slate-800">{f.flight}</span>
                                    {isSelected && <span className="text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded-full">Selected ✓</span>}
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-0.5">Dep. {f.dep} · {f.pax} pax · Gate 08</div>
                                </button>
                                {isSelected && (
                                  <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-3 ml-3">
                                    <div className="flex items-center gap-1.5 mb-2">
                                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Meal Types & Pax</span>
                                      <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-medium">From manifest</span>
                                    </div>
                                    <div className="space-y-1 text-xs text-slate-700">
                                      <div className="flex justify-between"><span>Regular</span><span className="font-semibold">{Math.floor(f.pax * 0.84)} pax</span></div>
                                      <div className="flex justify-between"><span>Vegetarian</span><span className="font-semibold">{Math.floor(f.pax * 0.12)} pax</span></div>
                                      <div className="flex justify-between"><span>Diabetic</span><span className="font-semibold">{f.pax - Math.floor(f.pax * 0.84) - Math.floor(f.pax * 0.12)} pax</span></div>
                                      <div className="flex justify-between font-bold border-t border-slate-100 pt-1 mt-0.5"><span>Total</span><span>{f.pax} pax</span></div>
                                    </div>
                                    <p className="text-[10px] text-slate-400 italic mt-2">Tap flight again to deselect.</p>
                                  </div>
                                )}
                              </Fragment>
                            );
                          })}
                        </div>
                      </div>
                      <button
                        onClick={() => { if (mFlightIds.length > 0) setMScreen(2); else toast.error("Please select at least one flight"); }}
                        className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${mFlightIds.length > 0 ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
                      >
                        Next — vehicle details {mFlightIds.length > 0 ? `(${mFlightIds.length} selected)` : ""} <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {/* Screen 2 — Vehicle & Temperature */}
                  {mScreen === 2 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">{mFlightIds.length === 1 ? `${flights.find(x => x.id === mFlightIds[0])?.flight} · ${flights.find(x => x.id === mFlightIds[0])?.pax} pax` : `${mFlightIds.length} flights selected`}</p>
                          <p className="font-bold text-slate-800 text-sm">Vehicle & Temperature</p>
                        </div>
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">2 of 4</span>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">VAN NUMBER *</p>
                        <input value={mVehicleNo} onChange={e => setMVehicleNo(e.target.value)} placeholder="e.g. HiLoader-02"
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-slate-50" />
                        <p className="text-[10px] text-slate-400 italic">Typed by executive after physical inspection</p>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">VAN CLEANLINESS *</p>
                        <div className="flex gap-2">
                          <button onClick={() => setMVehicleClean("Clean")}
                            className={`flex-1 py-2 rounded-lg border font-semibold text-sm transition-colors ${mVehicleClean === "Clean" ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-300"}`}>
                            ✓ Clean
                          </button>
                          <button onClick={() => setMVehicleClean("Not Clean")}
                            className={`flex-1 py-2 rounded-lg border font-semibold text-sm transition-colors ${mVehicleClean === "Not Clean" ? "bg-red-500 border-red-500 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-red-300"}`}>
                            Not clean
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400 italic">Visually examined by executive on-site</p>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">PRODUCT CORE TEMPERATURE *</p>
                        <p className="text-[10px] text-slate-400 italic">Read from physical probe — enter manually</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[11px] text-slate-600 mb-1 font-medium">CHILLED (°C)</p>
                            <input type="number" step="0.1" value={mChilledTemp} onChange={e => setMChilledTemp(e.target.value)} placeholder="e.g. 3.2"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-slate-50" />
                            <p className="text-[10px] text-slate-400 mt-0.5">Standard: 1–4°C</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-slate-600 mb-1 font-medium">FROZEN (°C)</p>
                            <input type="number" step="0.1" value={mFrozenTemp} onChange={e => setMFrozenTemp(e.target.value)} placeholder="e.g. -13.5"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-slate-50" />
                            <p className="text-[10px] text-slate-400 mt-0.5">Standard: -12 to -8°C</p>
                          </div>
                        </div>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">VAN TEMPERATURE DURING LOADING</p>
                        <p className="text-[10px] text-slate-400 italic">Check van thermometer — enter start and end</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[11px] text-slate-600 mb-1 font-medium">START (°C)</p>
                            <input type="number" step="0.1" value={mVanStart} onChange={e => setMVanStart(e.target.value)} placeholder="e.g. 4.1"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-slate-50" />
                          </div>
                          <div>
                            <p className="text-[11px] text-slate-600 mb-1 font-medium">END (°C)</p>
                            <input type="number" step="0.1" value={mVanEnd} onChange={e => setMVanEnd(e.target.value)} placeholder="e.g. 4.8"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-slate-50" />
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-400">Stays within ±8°C limit</p>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setMScreen(1)} className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-semibold text-sm hover:bg-slate-50">← Back</button>
                        <button onClick={() => { if (!mVehicleNo || !mVehicleClean) { toast.error("Fill vehicle details"); return; } setMScreen(3); }}
                          className="flex-[2] py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-1 hover:bg-blue-700 shadow-md">
                          Next <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Screen 3 — Result Check */}
                  {mScreen === 3 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">{mFlightIds.length === 1 ? flights.find(x => x.id === mFlightIds[0])?.flight : `${mFlightIds.length} flights`} · {mVehicleNo}</p>
                          <p className="font-bold text-slate-800 text-sm">Result Check</p>
                        </div>
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">3 of 4</span>
                      </div>
                      {mResult === "Yes" && (
                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs text-emerald-700 font-semibold">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> All checks passed
                        </div>
                      )}
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        {[
                          ["Van clean", mVehicleClean === "Clean" ? "Yes ✓" : mVehicleClean === "Not Clean" ? "No" : "—"],
                          ["Chilled temp", mChilledTemp ? `${mChilledTemp}°C` : "—"],
                          ["Frozen temp", mFrozenTemp ? `${mFrozenTemp}°C` : "—"],
                          ["Van temp (start)", mVanStart ? `${mVanStart}°C` : "—"],
                          ["Van temp (end)", mVanEnd ? `${mVanEnd}°C` : "—"],
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">{label}</span>
                            <span className={`font-semibold ${value === "No" ? "text-red-600" : "text-slate-800"}`}>{value}</span>
                          </div>
                        ))}
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">RESULT SATISFY</p>
                        <div className="flex gap-2">
                          <button onClick={() => setMResult("Yes")}
                            className={`flex-1 py-2.5 rounded-xl border font-bold text-sm transition-colors ${mResult === "Yes" ? "bg-emerald-500 border-emerald-500 text-white shadow-md" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-300"}`}>
                            ✓ Yes
                          </button>
                          <button onClick={() => setMResult("No")}
                            className={`flex-1 py-2.5 rounded-xl border font-bold text-sm transition-colors ${mResult === "No" ? "bg-red-500 border-red-500 text-white shadow-md" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-red-300"}`}>
                            No
                          </button>
                        </div>
                      </div>
                      {mResult === "Yes" && (
                        <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 flex items-center gap-3">
                          <div className="w-11 h-11 bg-slate-800 rounded-lg flex items-center justify-center shrink-0">
                            <QrCode className="h-6 w-6 text-white" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-sky-800">Dispatch QR ready</p>
                            <p className="text-[10px] text-sky-600">Contains all flight, meal, van & temp data. Airport exec scans this.</p>
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setMScreen(2)} className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-semibold text-sm hover:bg-slate-50">← Back</button>
                        <button onClick={() => { if (!mResult) { toast.error("Select result satisfy"); return; } mobileConfirmDispatch(); }}
                          className={`flex-[2] py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition-colors ${mResult ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
                          <PlaneTakeoff className="h-4 w-4" /> Confirm & dispatch
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Screen 4 — Dispatched */}
                  {mScreen === 4 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-slate-400">USBA-FSH-PDM-01</p>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">Done</span>
                      </div>
                      <div className="flex flex-col items-center py-6">
                        <div className="w-20 h-20 rounded-full bg-emerald-100 border-4 border-emerald-400 flex items-center justify-center mb-3">
                          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                        </div>
                        <p className="text-2xl font-bold text-slate-800">Dispatched</p>
                        {mDispatchedIds.length === 1 ? (() => {
                          const entry = entries.find(x => x.id === mDispatchedIds[0]);
                          const f = entry ? flights.find(x => x.id === entry.flightId) : null;
                          return f ? (
                            <>
                              <p className="text-sm text-slate-600 mt-1">{f.flight} · {f.pax} pax</p>
                              <p className="text-xs text-slate-400">{mVehicleNo} · {todayStr}</p>
                            </>
                          ) : null;
                        })() : (
                          <>
                            <p className="text-sm text-slate-600 mt-1">{mDispatchedIds.length} flights dispatched</p>
                            <p className="text-xs text-slate-400">{mVehicleNo} · {todayStr}</p>
                          </>
                        )}
                      </div>
                      <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-sky-700 font-medium">
                          <PlaneLanding className="h-3.5 w-3.5 shrink-0" /> En route to Gate 08
                        </div>
                        <span className="text-sky-500 font-semibold">Awaiting APT scan</span>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Dispatch ID</span>
                          <span className="font-mono font-bold text-slate-700 text-[10px] break-all">{mDispatchedIds[0] ?? ""}{mDispatchedIds.length > 1 ? ` +${mDispatchedIds.length - 1} more` : ""}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Status</span>
                          <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold text-[10px]">Awaiting APT verify</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400 text-center italic">This status updates automatically once the airport executive scans and accepts.</p>
                      <button
                        onClick={() => { setMScreen(1); setMFlightIds([]); setMVehicleNo(""); setMVehicleClean(""); setMChilledTemp(""); setMFrozenTemp(""); setMVanStart(""); setMVanEnd(""); setMResult(""); setMDispatchedIds([]); }}
                        className="w-full py-2.5 rounded-xl border border-blue-300 bg-blue-50 text-blue-600 font-semibold text-sm hover:bg-blue-100">
                        + New Dispatch
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* ═══ RECEIVE TAB ═══ */}
              {mobileTab === "receive" && (
                <>
                  {/* Screen 1 — Select dispatch */}
                  {rScreen === 1 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">Airport Catering Unit — Gate No. 08</p>
                          <p className="font-bold text-slate-800 text-sm">Airport Receiving</p>
                        </div>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">1 of 3</span>
                      </div>
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-700 font-medium">
                        <ThermometerSun className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        Max +8°C — Verify vehicle temp before unloading begins
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-2">Pending Dispatches</p>
                        {entries.filter(e => !e.receivedAt).length === 0 ? (
                          <div className="text-[11px] text-slate-400 italic text-center py-6 bg-white border border-slate-200 rounded-xl">
                            No pending dispatches yet.<br />Complete a Kitchen Dispatch first.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {entries.filter(e => !e.receivedAt).map(e => {
                              const f = flights.find(x => x.id === e.flightId);
                              return (
                                <button key={e.id} onClick={() => setRSelectedId(e.id)}
                                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${rSelectedId === e.id ? "border-emerald-400 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-emerald-200"}`}>
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-sm text-slate-800">{f?.flight ?? e.flightId}</span>
                                    <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Awaiting</span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-0.5">{e.id} · {totalQty(e.mealLines)} pax · {e.vehicleNo}</div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {rSelectedId && (() => {
                        const e = entries.find(x => x.id === rSelectedId);
                        if (!e) return null;
                        return (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-bold mb-1">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> QR scanned — data loaded
                            </div>
                            {[
                              ["Dispatch ID", e.id],
                              ["Flight", flightLabel(e.flightId)],
                              ["Total pax", totalQty(e.mealLines).toString()],
                              ["Vehicle", e.vehicleNo],
                              ["Van clean", e.vehicleClean],
                              ["Chilled temp (kitchen)", e.chilledTemp ? `${e.chilledTemp}°C` : "—"],
                              ["Frozen temp (kitchen)", e.frozenTemp ? `${e.frozenTemp}°C` : "—"],
                            ].map(([l, v]) => (
                              <div key={l} className="flex justify-between text-[11px]">
                                <span className="text-slate-400">{l}</span>
                                <span className="font-medium text-slate-700">{v}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      <button onClick={() => { if (!rSelectedId) { toast.error("Select a dispatch entry"); return; } setRScreen(2); }}
                        className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${rSelectedId ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
                        Proceed to gate check <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {/* Screen 2 — Gate Verification */}
                  {rScreen === 2 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">Gate 08 · {flightLabel(entries.find(e => e.id === rSelectedId)?.flightId ?? "")}</p>
                          <p className="font-bold text-slate-800 text-sm">Gate Verification</p>
                        </div>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">2 of 3</span>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">GATE 08 TEMPERATURE (°C) *</p>
                        <input type="number" step="0.1" value={rGateTemp} onChange={e => setRGateTemp(e.target.value)} placeholder="e.g. 5.8"
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 bg-slate-50" />
                        <p className="text-[10px] text-slate-400 italic">Read from gate thermometer — typed in by executive</p>
                        {rGateTemp && parseFloat(rGateTemp) <= 8 && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold inline-block">≤ +8°C ✓</span>}
                        {rGateTemp && parseFloat(rGateTemp) > 8 && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold inline-block">⚠ Exceeds +8°C</span>}
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">TIME OF UNLOADING</p>
                        <input type="time" value={rUnloadTime} onChange={e => setRUnloadTime(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 bg-white" />
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">PHYSICAL CHECKS BY EXECUTIVE</p>
                        {([
                          ["Vehicle temp verified at gate before unloading", rCheck1, setRCheck1],
                          ["Seal integrity & packaging condition checked", rCheck2, setRCheck2],
                          ["Unloading time recorded", rCheck3, setRCheck3],
                        ] as [string, boolean, (v: boolean) => void][]).map(([label, checked, setter]) => (
                          <label key={label} className="flex items-start gap-2.5 cursor-pointer">
                            <input type="checkbox" checked={checked} onChange={e => setter(e.target.checked)} className="mt-0.5 accent-emerald-500 w-4 h-4 shrink-0" />
                            <span className="text-xs text-slate-700">{label}</span>
                          </label>
                        ))}
                        <label className="flex items-start gap-2.5 opacity-40">
                          <input type="checkbox" disabled className="mt-0.5 w-4 h-4 shrink-0" />
                          <span className="text-xs text-slate-500">APT countersign pending</span>
                        </label>
                        <p className="text-[10px] text-slate-400 italic">All boxes must be checked before accepting.</p>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">REMARKS (OPTIONAL)</p>
                        <textarea value={rRemarks} onChange={e => setRRemarks(e.target.value)} placeholder="e.g. Seals intact. No breach observed."
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs resize-none h-14 focus:outline-none focus:border-emerald-400 bg-slate-50" />
                      </div>
                      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">APT OFFICER SIGNATURE *</p>
                        <button className="w-full py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 flex items-center justify-center gap-1.5 hover:bg-slate-50">
                          <User className="h-3.5 w-3.5" /> Sign with finger
                        </button>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setRScreen(1)} className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-semibold text-sm hover:bg-slate-50">← Back</button>
                        <button onClick={() => {
                          if (!rGateTemp) { toast.error("Enter gate temperature"); return; }
                          if (!rCheck1 || !rCheck2 || !rCheck3) { toast.error("Complete all physical checks"); return; }
                          mobileAcceptReceipt();
                        }} className="flex-[2] py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-1.5 hover:bg-emerald-700 shadow-md">
                          <CheckCircle2 className="h-4 w-4" /> Save & accept
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Screen 3 — Accepted */}
                  {rScreen === 3 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">Gate 08 — APT Verified</p>
                          <p className="font-bold text-slate-800 text-sm">Airport Receiving</p>
                        </div>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">Done</span>
                      </div>
                      <div className="flex flex-col items-center py-5">
                        <div className="w-20 h-20 rounded-full bg-sky-100 border-4 border-sky-400 flex items-center justify-center mb-3">
                          <CheckCircle2 className="h-10 w-10 text-sky-500" />
                        </div>
                        <p className="text-2xl font-bold text-slate-800">Receipt accepted</p>
                        {(() => {
                          const e = entries.find(x => x.id === rSelectedId);
                          const f = flights.find(x => x.id === e?.flightId);
                          return e && f ? (
                            <>
                              <p className="text-xs text-slate-600 mt-1">{f.flight} · {totalQty(e.mealLines)} pax · Gate 08</p>
                              <p className="text-[10px] text-slate-400">{rAcceptedAt}</p>
                            </>
                          ) : null;
                        })()}
                      </div>
                      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 text-xs">
                        {(() => {
                          const e = entries.find(x => x.id === rSelectedId);
                          return e ? [
                            ["Kitchen temp (chilled)", e.chilledTemp ? `${e.chilledTemp}°C` : "—"],
                            ["Gate 08 temp", rGateTemp ? `${rGateTemp}°C` : "—"],
                            ["Max limit", "+8°C"],
                            ["Cold chain", "✓ No breach"],
                          ].map(([label, value]) => (
                            <div key={label} className="flex justify-between">
                              <span className="text-slate-400">{label}</span>
                              <span className={`font-semibold ${String(value).includes("No breach") ? "text-emerald-600" : "text-slate-800"}`}>{value}</span>
                            </div>
                          )) : null;
                        })()}
                      </div>
                      <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 space-y-1">
                        <div className="flex items-center gap-1.5 text-xs text-sky-700 font-bold">
                          <CheckCircle2 className="h-3.5 w-3.5 text-sky-500" /> Synced to web dashboard
                        </div>
                        <p className="text-[10px] text-sky-600">Kitchen + airport records updated — Date & time auto-recorded</p>
                        <p className="text-[10px] text-sky-500 italic">Kitchen dispatch screen now shows 'APT Verified' status.</p>
                      </div>
                      <button onClick={() => { setRScreen(1); setRSelectedId(""); setRGateTemp(""); setRUnloadTime(""); setRCheck1(false); setRCheck2(false); setRCheck3(false); setRRemarks(""); setRAcceptedAt(""); }}
                        className="w-full py-2.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-600 font-semibold text-sm hover:bg-emerald-100">
                        + Receive Another
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* ═══ LOG TAB ═══ */}
              {mobileTab === "log" && (
                <div className="p-4 space-y-3">
                  {mLogEntryId ? (() => {
                    const entry = entries.find(e => e.id === mLogEntryId);
                    if (!entry) return null;
                    const f = flights.find(x => x.id === entry.flightId);
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setMLogEntryId(null)}
                            className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                            <ChevronRight className="h-4 w-4 rotate-180" />
                          </button>
                          <p className="font-bold text-slate-800 text-sm">Dispatch Details</p>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-sm text-blue-700">{f?.flight ?? entry.flightId}</span>
                            <YesNoBadge value={entry.resultSatisfy} />
                          </div>
                          {([
                            ["Dispatch ID", entry.id],
                            ["Date", entry.packagingDate],
                            ["Vehicle", entry.vehicleNo || "—"],
                            ["Vehicle Clean", entry.vehicleClean],
                            ["Total Pax", totalQty(entry.mealLines).toString()],
                            ["Chilled Temp", entry.chilledTemp ? `${entry.chilledTemp}°C` : "—"],
                            ["Frozen Temp", entry.frozenTemp ? `${entry.frozenTemp}°C` : "—"],
                            ["Veh. Temp Begin", entry.vehicleTempBegin ? `${entry.vehicleTempBegin}°C` : "—"],
                            ["Veh. Temp End", entry.vehicleTempEnd ? `${entry.vehicleTempEnd}°C` : "—"],
                            ["Gate 08 Temp", entry.gateTempGate08 ? `${entry.gateTempGate08}°C` : "—"],
                            ["Monitored At", entry.monitoredAt],
                            ["Received At", entry.receivedAt || "Awaiting receipt"],
                          ] as [string, string][]).map(([label, value]) => (
                            <div key={label} className="flex justify-between text-xs">
                              <span className="text-slate-400">{label}</span>
                              <span className="font-medium text-slate-700 text-right max-w-[55%] break-all">{value}</span>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-2">
                          <div className={`rounded-xl border p-2.5 ${entry.verifiedBy ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50 opacity-50"}`}>
                            <p className="text-[10px] font-bold text-emerald-700 mb-0.5">② Verified By (Food Safety)</p>
                            <p className="text-[11px] text-slate-600">{entry.verifiedBy ? `${entry.verifiedBy.date}, ${entry.verifiedBy.time}` : "Pending"}</p>
                            {entry.verifiedBy?.remarks && <p className="text-[10px] text-slate-400 italic mt-0.5">"{entry.verifiedBy.remarks}"</p>}
                          </div>
                          <div className={`rounded-xl border p-2.5 ${entry.approvedBy ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-slate-50 opacity-50"}`}>
                            <p className="text-[10px] font-bold text-violet-700 mb-0.5">③ Approved By (HoC)</p>
                            <p className="text-[11px] text-slate-600">{entry.approvedBy ? `${entry.approvedBy.date}, ${entry.approvedBy.time}` : "Pending"}</p>
                            {entry.approvedBy?.remarks && <p className="text-[10px] text-slate-400 italic mt-0.5">"{entry.approvedBy.remarks}"</p>}
                          </div>
                          <div className={`rounded-xl border p-2.5 ${entry.receivedAt ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-slate-50 opacity-50"}`}>
                            <p className="text-[10px] font-bold text-sky-700 mb-0.5">④ Airport Receipt</p>
                            <p className="text-[11px] text-slate-600">{entry.receivedAt || "Awaiting airport receipt"}</p>
                            {entry.receivedRemarks && <p className="text-[10px] text-slate-400 italic mt-0.5">"{entry.receivedRemarks}"</p>}
                          </div>
                        </div>
                      </>
                    );
                  })() : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-slate-800 text-sm">Dispatch Log</p>
                        <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-semibold">{entries.length} total</span>
                      </div>
                      {entries.length === 0 ? (
                        <div className="text-[11px] text-slate-400 italic text-center py-10 bg-white border border-slate-200 rounded-xl">
                          No dispatches recorded yet.<br />Complete a Kitchen Dispatch first.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {entries.map(entry => {
                            const f = flights.find(x => x.id === entry.flightId);
                            return (
                              <button key={entry.id} onClick={() => setMLogEntryId(entry.id)}
                                className="w-full text-left px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/30 transition-all">
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="font-bold text-sm text-slate-800">{f?.flight ?? entry.flightId}</span>
                                  <YesNoBadge value={entry.resultSatisfy} />
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-slate-500">
                                  <span className="font-mono">{entry.id.slice(0, 16)}…</span>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${entry.receivedAt ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                    {entry.receivedAt ? "Received" : "Awaiting"}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">{entry.monitoredAt} · {entry.vehicleNo || "—"}</div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Bottom nav */}
            <div className="bg-white border-t border-slate-200 flex shrink-0">
              <button onClick={() => setMobileTab("dispatch")}
                className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-colors ${mobileTab === "dispatch" ? "text-blue-600" : "text-slate-400"}`}>
                <Truck className="h-4 w-4" /> Dispatch
              </button>
              <button onClick={() => setMobileTab("log")}
                className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-colors ${mobileTab === "log" ? "text-blue-600" : "text-slate-400"}`}>
                <Clock className="h-4 w-4" /> Log
              </button>
              <button className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold text-slate-400">
                <User className="h-4 w-4" /> Profile
              </button>
            </div>

            {/* Home indicator */}
            <div className="bg-slate-900 flex justify-center pb-2 pt-1 shrink-0">
              <div className="w-20 h-1 rounded-full bg-white/30" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

