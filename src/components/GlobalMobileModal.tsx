import { useState, useEffect, Fragment } from "react";
import {
  X, Thermometer, ClipboardCheck, Truck, ChevronRight, ChevronLeft,
  CheckCircle2, Home, LogOut, ThermometerSun, QrCode, PlaneTakeoff,
  PlaneLanding, Smartphone,
} from "lucide-react";
import { useWorkflow, type WfProductionEntry } from "@/lib/workflow-store";
import { flights as FLIGHT_BOARD, seedFlightOrders } from "@/lib/sample-data";
import { useDispatchMonitoringSettings } from "@/lib/dispatch-monitoring-settings";
import { toast } from "sonner";

// ── Simplified flight list (same merge logic as dispatch-monitoring) ──────────
type FlightOpt = { id: string; flight: string; dep: string; pax: number };
const FLIGHTS: FlightOpt[] = (() => {
  const merged: FlightOpt[] = FLIGHT_BOARD.map(f => ({
    id: f.id, flight: f.flight, dep: f.dep, pax: f.pax,
  }));
  const seen = new Set(merged.map(f => f.flight));
  for (const o of seedFlightOrders) {
    if (!o.flight || seen.has(o.flight)) continue;
    seen.add(o.flight);
    merged.push({ id: `MFL-${o.flight}`, flight: o.flight, dep: o.etd ?? "—", pax: o.pax ?? 0 });
  }
  return merged.sort((a, b) => a.flight.localeCompare(b.flight)).slice(0, 8);
})();

// ── Hygiene config ─────────────────────────────────────────────────────────────
const HYG_ITEMS = [
  "Hands washed before food handling",
  "Gloves worn during preparation",
  "Surface sanitized before use",
  "Temperature of storage areas checked",
  "Equipment cleaned after previous use",
  "No cross-contamination observed",
  "Waste bins emptied and sanitized",
  "Cold chain integrity verified",
];
const HYG_SLOTS = ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00"];

type MobileScreen = "login" | "home" | "qc" | "hygiene" | "dispatch";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function GlobalMobileModal({ open, onClose }: Props) {
  const { productionEntries, updateProductionEntryStatus, applyStockDeltas } = useWorkflow();
  const doc = useDispatchMonitoringSettings();

  // ── Top-level screen ────────────────────────────────────────────────────────
  const [screen, setScreen] = useState<MobileScreen>("login");

  // ── Login state ─────────────────────────────────────────────────────────────
  const [loginUser, setLoginUser]       = useState("");
  const [loginPass, setLoginPass]       = useState("");
  const [loginError, setLoginError]     = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // ── QC state ────────────────────────────────────────────────────────────────
  const [qcSub, setQcSub]               = useState<1|2|3|4>(1);
  const [qcTarget, setQcTarget]         = useState<WfProductionEntry | null>(null);
  const [qcMeasured, setQcMeasured]     = useState(0);
  const [qcCookedBy, setQcCookedBy]     = useState("");
  const [qcBatchNo, setQcBatchNo]       = useState("");
  const [qcTemp, setQcTemp]             = useState(75);
  const [qcResult, setQcResult]         = useState<"pass"|"fail">("pass");
  const [qcFailReason, setQcFailReason] = useState("");

  // ── Hygiene state ───────────────────────────────────────────────────────────
  const [hygSub, setHygSub]     = useState<1|2>(1);
  const [hygSlot, setHygSlot]   = useState("");
  const [hygSaved, setHygSaved] = useState<Record<string, boolean>>({});
  const [hygVals, setHygVals]   = useState<Record<string, Record<string, "✓"|"✗"|"—">>>({});

  // ── Dispatch state ──────────────────────────────────────────────────────────
  const [dspSub, setDspSub]               = useState<1|2|3|4>(1);
  const [dspFlights, setDspFlights]       = useState<string[]>([]);
  const [dspVehicle, setDspVehicle]       = useState("");
  const [dspClean, setDspClean]           = useState<"Clean"|"Not Clean"|"">("");
  const [dspChilled, setDspChilled]       = useState("");
  const [dspFrozen, setDspFrozen]         = useState("");
  const [dspVanStart, setDspVanStart]     = useState("");
  const [dspVanEnd, setDspVanEnd]         = useState("");
  const [dspResult, setDspResult]         = useState<"Yes"|"No"|"">("");

  // ── Reset all state when modal opens ────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setScreen("login");
    setLoginUser(""); setLoginPass(""); setLoginError(""); setLoginLoading(false);
    setQcSub(1); setQcTarget(null); setQcMeasured(0); setQcCookedBy(""); setQcFailReason("");
    setHygSub(1); setHygSlot(""); setHygSaved({}); setHygVals({});
    setDspSub(1); setDspFlights([]); setDspVehicle(""); setDspClean("");
    setDspChilled(""); setDspFrozen(""); setDspVanStart(""); setDspVanEnd(""); setDspResult("");
  }, [open]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  const pendingQC = productionEntries.filter(e => e.status === "Ready for QC");

  // ── QC helpers ──────────────────────────────────────────────────────────────
  const openQcEntry = (entry: WfProductionEntry) => {
    setQcTarget(entry);
    setQcTemp(75);
    setQcMeasured(0);
    setQcCookedBy("");
    setQcBatchNo(entry.id);
    setQcFailReason("");
    setQcSub(2);
  };

  const signOffQC = (pass: boolean) => {
    if (!qcTarget) return;
    if (!pass && !qcFailReason.trim()) { toast.error("Enter rejection reason"); return; }
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const logId = `CT-${Date.now()}`;
    setQcResult(pass ? "pass" : "fail");
    if (pass) {
      updateProductionEntryStatus(qcTarget.id, "Completed", {
        qcLogId: logId, qcPassedAt: stamp,
        qcCheckedBy: "R. Hossain (Business Analyst)", completedAt: stamp, inventoryAdded: true,
      });
      applyStockDeltas([{
        itemId: qcTarget.outputItemCode ?? qcTarget.outputItemName ?? qcTarget.id,
        delta: qcTarget.producedQty,
        date: qcTarget.date,
        reference: qcTarget.id,
        label: "Production",
      }]);
      toast.success(`${qcTarget.id} passed QC — ${qcTarget.producedQty.toLocaleString()} units added`);
    } else {
      updateProductionEntryStatus(qcTarget.id, "In Preparation");
      toast.error(`${qcTarget.id} rejected — back to In Preparation`);
    }
    setQcSub(4);
  };

  // ── Hygiene helpers ─────────────────────────────────────────────────────────
  const toggleHygVal = (itemIdx: number) => {
    setHygVals(prev => {
      const sv = { ...(prev[hygSlot] ?? {}) };
      const cur = sv[String(itemIdx)] ?? "—";
      sv[String(itemIdx)] = cur === "—" || cur === "✗" ? "✓" : "✗";
      return { ...prev, [hygSlot]: sv };
    });
  };
  const saveHygSlot = () => {
    setHygSaved(prev => ({ ...prev, [hygSlot]: true }));
    setHygSub(1);
    toast.success(`Slot ${hygSlot} saved`);
  };

  // ── Dispatch helpers ────────────────────────────────────────────────────────
  const resetDispatch = () => {
    setDspSub(1); setDspFlights([]); setDspVehicle(""); setDspClean("");
    setDspChilled(""); setDspFrozen(""); setDspVanStart(""); setDspVanEnd(""); setDspResult("");
  };
  const confirmDispatch = () => {
    setDspSub(4);
    toast.success(`${dspFlights.length} flight(s) dispatched`);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(15,23,42,0.80)", backdropFilter: "blur(6px)" }}
    >
      {/* Close button outside phone frame */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors z-10"
      >
        <X className="h-7 w-7" />
      </button>

      <div className="flex flex-col items-center gap-3">
        {/* Label above */}
        <div className="text-white/50 text-[11px] font-medium tracking-widest uppercase flex items-center gap-2">
          <Smartphone className="h-3.5 w-3.5" /> Mobile App Simulator
        </div>

        {/* Phone shell */}
        <div
          className="relative flex flex-col overflow-hidden shadow-2xl"
          style={{
            width: 375,
            height: 720,
            maxHeight: "calc(100vh - 100px)",
            borderRadius: 36,
            border: "8px solid #1E293B",
            background: "#F1F5F9",
          }}
        >
          {/* Notch */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-1.5 rounded-full bg-slate-700 z-10" />

          {/* Status bar */}
          <div className="bg-slate-900 text-white flex justify-between items-center px-5 pt-5 pb-1.5 shrink-0 text-[10px]">
            <span className="font-semibold">9:41</span>
            <span className="opacity-60">●●● WiFi 84%</span>
          </div>

          {/* Screen content */}
          <div className="flex-1 overflow-hidden flex flex-col">

            {/* ══════════════════ LOGIN ══════════════════ */}
            {screen === "login" && (
              <div className="flex-1 flex flex-col overflow-y-auto" style={{ background: "linear-gradient(160deg,#0f172a 0%,#1e293b 55%,#7f1d1d 130%)" }}>
                {/* Hero */}
                <div className="flex flex-col items-center pt-10 pb-6 px-6">
                  <div style={{
                    width: 54, height: 54, borderRadius: 15, background: "linear-gradient(135deg,#ff4444,#E10101)",
                    display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12,
                    boxShadow: "0 0 24px rgba(225,1,1,0.45)",
                  }}>
                    <PlaneTakeoff className="h-7 w-7 text-white" />
                  </div>
                  <p className="text-white font-bold text-lg tracking-tight">AeroGalley Catering</p>
                  <p className="text-slate-400 text-[11px] mt-0.5">Mobile Operations</p>
                </div>

                {/* Form card */}
                <div className="flex-1 bg-white rounded-t-[2rem] px-5 pt-6 pb-4 space-y-4">
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-0.5">Welcome back</p>
                    <p className="text-slate-800 font-bold text-base">Sign in to continue</p>
                  </div>

                  {/* Demo hint */}
                  <div style={{ background: "#FFF0F0", border: "1px solid #FECACA", borderRadius: 10, padding: "8px 10px", fontSize: 11, color: "#E10101" }}>
                    Demo:&nbsp;
                    <code style={{ background: "rgba(225,1,1,0.1)", padding: "1px 5px", borderRadius: 4 }}>admin</code>
                    {" / "}
                    <code style={{ background: "rgba(225,1,1,0.1)", padding: "1px 5px", borderRadius: 4 }}>admin123</code>
                    {" · "}
                    <button type="button"
                      onClick={() => { setLoginUser("admin"); setLoginPass("admin123"); }}
                      style={{ border: "none", background: "none", padding: 0, color: "#E10101", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                    >Fill</button>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">User ID</label>
                      <input type="text" value={loginUser} onChange={e => setLoginUser(e.target.value)} placeholder="Enter user ID"
                        className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-red-400" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Password</label>
                      <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="Enter password"
                        className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-red-400" />
                    </div>
                  </div>

                  {loginError && <p className="text-red-600 text-xs font-medium">{loginError}</p>}

                  <button
                    onClick={() => {
                      if (!loginUser.trim() || !loginPass.trim()) { setLoginError("Enter User ID and password."); return; }
                      if (loginUser !== "admin" || loginPass !== "admin123") { setLoginError("Invalid credentials. Try admin / admin123."); return; }
                      setLoginError(""); setLoginLoading(true);
                      setTimeout(() => { setLoginLoading(false); setScreen("home"); }, 800);
                    }}
                    disabled={loginLoading}
                    className="w-full py-3 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                    style={{ background: "linear-gradient(120deg,#ff2d2d,#E10101)" }}
                  >
                    {loginLoading
                      ? <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                      : "Sign In →"}
                  </button>

                  <p className="text-[10px] text-slate-400 text-center">
                    By signing in you agree to AeroGalley Catering's Terms of Service.
                  </p>
                </div>
              </div>
            )}

            {/* ══════════════════ HOME ══════════════════ */}
            {screen === "home" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header bar */}
                <div className="bg-slate-800 px-4 py-3 shrink-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-bold text-sm">Good morning, R. Hossain 👋</p>
                      <p className="text-slate-400 text-[10px] mt-0.5">Business Analyst · AeroGalley Catering</p>
                    </div>
                    <button onClick={() => setScreen("login")} className="text-slate-400 hover:text-white transition-colors">
                      <LogOut className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Module tiles */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Available Modules</p>

                  {([
                    {
                      label: "QC Record",
                      desc: "Cooking temperature & sensory QC",
                      color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe",
                      icon: <Thermometer className="h-5 w-5" style={{ color: "#2563eb" }} />,
                      badge: pendingQC.length > 0 ? `${pendingQC.length} pending` : "All clear",
                      badgeBg: pendingQC.length > 0 ? "#f59e0b" : "#10b981",
                      onPress: () => { setQcSub(1); setQcTarget(null); setScreen("qc"); },
                    },
                    {
                      label: "Hygiene Monitor",
                      desc: "Daily food safety & hygiene",
                      color: "#059669", bg: "#f0fdf4", border: "#bbf7d0",
                      icon: <ClipboardCheck className="h-5 w-5" style={{ color: "#059669" }} />,
                      badge: `${Object.keys(hygSaved).length}/${HYG_SLOTS.length} slots done`,
                      badgeBg: "#6366f1",
                      onPress: () => { setHygSub(1); setScreen("hygiene"); },
                    },
                    {
                      label: "Dispatch",
                      desc: "Product dispatch — kitchen to airport",
                      color: "#d97706", bg: "#fffbeb", border: "#fde68a",
                      icon: <Truck className="h-5 w-5" style={{ color: "#d97706" }} />,
                      badge: "Kitchen → Airport",
                      badgeBg: "#64748b",
                      onPress: () => { resetDispatch(); setScreen("dispatch"); },
                    },
                  ] as const).map(m => (
                    <button key={m.label} onClick={m.onPress}
                      className="w-full text-left p-4 rounded-2xl border-2 flex items-center gap-4 transition-all active:scale-[0.98]"
                      style={{ background: m.bg, borderColor: m.border }}
                    >
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: `${m.color}18` }}>
                        {m.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800 text-sm">{m.label}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{m.desc}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold text-white"
                          style={{ background: m.badgeBg }}>{m.badge}</span>
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </div>
                    </button>
                  ))}

                  {/* Quick info */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-3 mt-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Quick Info</p>
                    <div className="space-y-1.5 text-[11px]">
                      <div className="flex justify-between text-slate-600">
                        <span>Pending QC batches</span>
                        <span className="font-bold text-amber-600">{pendingQC.length}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Hygiene slots completed</span>
                        <span className="font-bold text-emerald-600">{Object.keys(hygSaved).length}/{HYG_SLOTS.length}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom nav */}
                <div className="bg-white border-t border-slate-200 flex shrink-0">
                  <button className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold text-primary">
                    <Home className="h-4 w-4" /> Home
                  </button>
                  <button onClick={() => { setQcSub(1); setScreen("qc"); }} className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold text-slate-400 hover:text-blue-600 transition-colors">
                    <Thermometer className="h-4 w-4" /> QC
                  </button>
                  <button onClick={() => setScreen("hygiene")} className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold text-slate-400 hover:text-emerald-600 transition-colors">
                    <ClipboardCheck className="h-4 w-4" /> Hygiene
                  </button>
                  <button onClick={() => { resetDispatch(); setScreen("dispatch"); }} className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold text-slate-400 hover:text-amber-600 transition-colors">
                    <Truck className="h-4 w-4" /> Dispatch
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════════ QC MODULE ══════════════════ */}
            {screen === "qc" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="bg-blue-700 px-4 py-3 shrink-0 flex items-center gap-3">
                  <button onClick={() => setScreen("home")} className="text-blue-300 hover:text-white transition-colors">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div>
                    <p className="text-white font-bold text-sm">Cooking Temp & Sensory</p>
                    <p className="text-blue-200 text-[10px]">HACCP Quality Control</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-slate-50">
                  {/* Screen 1 — Pending batches */}
                  {qcSub === 1 && (
                    <div className="p-4 space-y-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Batches Pending QC</p>
                        <span className="text-[10px] text-slate-400">{pendingQC.length} pending</span>
                      </div>
                      {pendingQC.length === 0 ? (
                        <div className="text-center py-10 text-[12px] text-slate-400">
                          <div className="text-3xl mb-2">✅</div>
                          No batches awaiting QC. All caught up.
                        </div>
                      ) : (
                        pendingQC.map(p => (
                          <button key={p.id} onClick={() => openQcEntry(p)}
                            className="w-full text-left px-3 py-2.5 rounded-xl border-2 border-slate-200 bg-white hover:border-blue-300 transition-all">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-xs text-slate-500">{p.id}</span>
                              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Pending QC</span>
                            </div>
                            <p className="font-bold text-sm text-slate-800 mt-0.5">{p.outputItemName ?? p.bom}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">× {p.producedQty.toLocaleString()} · {p.date}</p>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {/* Screen 2 — Record test */}
                  {qcSub === 2 && qcTarget && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-2 mb-1">
                        <button onClick={() => setQcSub(1)} className="h-7 w-7 flex items-center justify-center rounded-full bg-slate-200 hover:bg-slate-300 transition-colors">
                          <ChevronLeft className="h-4 w-4 text-slate-600" />
                        </button>
                        <div>
                          <p className="font-bold text-slate-800 text-sm">Record Test</p>
                          <p className="text-[10px] text-slate-400">{qcTarget.id}</p>
                        </div>
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 space-y-1.5">
                        {[
                          ["Item", qcTarget.outputItemName ?? qcTarget.bom],
                          ["Standard Temp", `≥${qcTemp}°C`],
                          ["Quantity", qcTarget.producedQty.toLocaleString()],
                        ].map(([l, v]) => (
                          <div key={l} className="flex items-center justify-between text-[12px]">
                            <span className="text-slate-500">{l}</span>
                            <span className={`font-semibold text-right max-w-[55%] ${l === "Standard Temp" ? "text-blue-700 font-bold" : "text-slate-800"}`}>{v}</span>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-2.5">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Batch No</label>
                          <input value={qcBatchNo} readOnly className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-slate-100 text-slate-600 cursor-not-allowed focus:outline-none" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Measured Temp (°C) *</label>
                          <input type="number" value={qcMeasured} onChange={e => setQcMeasured(Number(e.target.value))}
                            className={`mt-1 w-full border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 ${
                              qcMeasured > 0 && qcMeasured >= qcTemp ? "border-green-400 focus:ring-green-400"
                                : qcMeasured > 0 ? "border-red-400 focus:ring-red-400"
                                : "border-slate-300 focus:ring-blue-400"}`}
                          />
                          {qcMeasured > 0 && (
                            <p className={`text-[10px] mt-0.5 font-medium ${qcMeasured >= qcTemp ? "text-green-600" : "text-red-600"}`}>
                              {qcMeasured >= qcTemp ? `✓ Above standard (+${qcMeasured - qcTemp}°C)` : `✗ Below standard (${qcTemp - qcMeasured}°C short)`}
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Cooked By *</label>
                          <input value={qcCookedBy} onChange={e => setQcCookedBy(e.target.value)} placeholder="Chef / cook name"
                            className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setQcSub(3)} className="flex-1 py-2.5 rounded-xl border-2 border-red-300 text-red-600 font-bold text-sm hover:bg-red-50 transition-colors">✗ Fail</button>
                        <button onClick={() => signOffQC(true)} className="flex-[2] py-2.5 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 transition-colors">✓ Pass & Complete</button>
                      </div>
                    </div>
                  )}

                  {/* Screen 3 — Rejection */}
                  {qcSub === 3 && qcTarget && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-2 mb-1">
                        <button onClick={() => setQcSub(2)} className="h-7 w-7 flex items-center justify-center rounded-full bg-slate-200 hover:bg-slate-300 transition-colors">
                          <ChevronLeft className="h-4 w-4 text-slate-600" />
                        </button>
                        <p className="font-bold text-red-700 text-sm">Rejection Justification</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Standard</p>
                          <p className="text-xl font-bold text-slate-700">≥{qcTemp}°C</p>
                          <p className="text-[9px] text-slate-400">HACCP min.</p>
                        </div>
                        <div className={`rounded-xl border px-3 py-2.5 text-center ${qcMeasured >= qcTemp ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}>
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Measured</p>
                          <p className={`text-xl font-bold ${qcMeasured >= qcTemp ? "text-green-700" : "text-red-700"}`}>{qcMeasured}°C</p>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Reason for Rejection *</label>
                        <textarea value={qcFailReason} onChange={e => setQcFailReason(e.target.value)} rows={4}
                          placeholder="Describe why this batch is being rejected..."
                          className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
                      </div>
                      <button onClick={() => signOffQC(false)} className="w-full py-3 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition-colors">
                        Confirm & Reject Batch
                      </button>
                    </div>
                  )}

                  {/* Screen 4 — Result */}
                  {qcSub === 4 && qcTarget && (
                    <div className="p-4 flex flex-col items-center text-center space-y-4 pt-8">
                      <div className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl ${qcResult === "pass" ? "bg-green-100" : "bg-red-100"}`}>
                        {qcResult === "pass" ? "✅" : "❌"}
                      </div>
                      <div>
                        <p className={`text-lg font-bold ${qcResult === "pass" ? "text-green-700" : "text-red-700"}`}>
                          {qcResult === "pass" ? "QC Passed!" : "Batch Rejected"}
                        </p>
                        <p className="text-[12px] text-slate-500 mt-1">
                          {qcResult === "pass" ? `${qcTarget.producedQty.toLocaleString()} units added to inventory` : "Sent back to In Preparation"}
                        </p>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 w-full text-left space-y-1.5">
                        {[
                          ["Batch", qcTarget.id],
                          ["Item", qcTarget.outputItemName ?? qcTarget.bom],
                          ["Temp", `${qcMeasured}°C / ≥${qcTemp}°C`],
                          ["Cooked By", qcCookedBy || "Kitchen Staff"],
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-center justify-between text-[12px]">
                            <span className="text-slate-500">{label}</span>
                            <span className={`font-semibold text-right max-w-[55%] ${
                              label === "Temp" ? (qcResult === "pass" ? "text-green-600" : "text-red-600") : "text-slate-800"
                            }`}>{value}</span>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => { setQcSub(1); setQcTarget(null); }} className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors">
                        Back to Pending Batches
                      </button>
                    </div>
                  )}
                </div>

                {/* Bottom nav */}
                <div className="bg-white border-t border-slate-200 flex shrink-0">
                  <button onClick={() => setScreen("home")} className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition-colors">
                    <Home className="h-4 w-4" /> Home
                  </button>
                  <button className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold text-blue-600">
                    <Thermometer className="h-4 w-4" /> QC
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════════ HYGIENE MODULE ══════════════════ */}
            {screen === "hygiene" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="bg-emerald-700 px-4 py-3 shrink-0 flex items-center gap-3">
                  <button onClick={() => setScreen("home")} className="text-emerald-300 hover:text-white transition-colors">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div>
                    <p className="text-white font-bold text-sm">Daily Hygiene Monitoring</p>
                    <p className="text-emerald-200 text-[10px]">USBA-FSH-DFSHM-01</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-slate-50">
                  {/* Screen 1 — Slots */}
                  {hygSub === 1 && (
                    <div className="p-4 space-y-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Time Slots</p>
                        <span className="text-[10px] text-slate-400">{Object.keys(hygSaved).length}/{HYG_SLOTS.length} done</span>
                      </div>
                      {HYG_SLOTS.map(slot => {
                        const saved = !!hygSaved[slot];
                        return (
                          <button key={slot} disabled={saved}
                            onClick={() => { setHygSlot(slot); setHygSub(2); }}
                            className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all ${
                              saved ? "border-green-300 bg-green-50 cursor-default" : "border-slate-200 bg-white hover:border-emerald-300"
                            }`}>
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm text-slate-800">{slot}</span>
                              {saved
                                ? <span className="text-[10px] bg-green-500 text-white px-2 py-0.5 rounded-full">✓ Saved</span>
                                : <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Tap to record →</span>}
                            </div>
                          </button>
                        );
                      })}
                      {Object.keys(hygSaved).length === HYG_SLOTS.length && (
                        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-[12px] text-green-700 font-medium text-center mt-1">
                          ✅ All slots completed for today.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Screen 2 — Record slot */}
                  {hygSub === 2 && (
                    <div className="p-4 space-y-2">
                      <div className="flex items-center gap-2 mb-2">
                        <button onClick={() => setHygSub(1)} className="h-7 w-7 flex items-center justify-center rounded-full bg-slate-200 hover:bg-slate-300 transition-colors">
                          <ChevronLeft className="h-4 w-4 text-slate-600" />
                        </button>
                        <div>
                          <p className="font-bold text-slate-800 text-sm">Record — {hygSlot}</p>
                          <p className="text-[10px] text-slate-400">Tap cell to toggle Pass / Fail</p>
                        </div>
                      </div>
                      {HYG_ITEMS.map((item, i) => {
                        const v = hygVals[hygSlot]?.[String(i)] ?? "—";
                        return (
                          <div key={i} className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="flex items-start gap-2">
                              <button onClick={() => toggleHygVal(i)}
                                className={`shrink-0 mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center font-bold text-base transition-colors border ${
                                  v === "✓" ? "bg-green-100 text-green-700 border-green-300"
                                    : v === "✗" ? "bg-red-100 text-red-700 border-red-300"
                                    : "bg-slate-100 text-slate-400 border-slate-200"
                                }`}>{v}</button>
                              <p className="text-[12px] text-slate-700 leading-snug flex-1 pt-1.5">{item}</p>
                            </div>
                          </div>
                        );
                      })}
                      <button onClick={saveHygSlot} className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm mt-1 hover:bg-emerald-700 transition-colors">
                        Save Slot — {hygSlot}
                      </button>
                    </div>
                  )}
                </div>

                <div className="bg-white border-t border-slate-200 flex shrink-0">
                  <button onClick={() => setScreen("home")} className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition-colors">
                    <Home className="h-4 w-4" /> Home
                  </button>
                  <button className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold text-emerald-600">
                    <ClipboardCheck className="h-4 w-4" /> Hygiene
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════════ DISPATCH MODULE ══════════════════ */}
            {screen === "dispatch" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="bg-amber-700 px-4 py-3 shrink-0 flex items-center gap-3">
                  <button onClick={() => setScreen("home")} className="text-amber-300 hover:text-white transition-colors">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div>
                    <p className="text-white font-bold text-sm">Product Dispatch</p>
                    <p className="text-amber-200 text-[10px]">{doc.originLabel} → {doc.destinationLabel} · {doc.documentCode}</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-slate-50">
                  {/* Screen 1 — Flight selection */}
                  {dspSub === 1 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">{doc.originName}</p>
                          <p className="font-bold text-slate-800 text-sm">Dispatch Entry</p>
                        </div>
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">1 of 4</span>
                      </div>
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-700 font-medium">
                        <ThermometerSun className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        Max. Temp. Limit: +8°C — Cold chain integrity must be maintained
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Today's Assigned Flights</p>
                      <div className="space-y-2">
                        {FLIGHTS.slice(0, 5).map(f => {
                          const sel = dspFlights.includes(f.id);
                          return (
                            <Fragment key={f.id}>
                              <button
                                onClick={() => setDspFlights(prev => sel ? prev.filter(x => x !== f.id) : [...prev, f.id])}
                                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${sel ? "border-amber-400 bg-amber-50 shadow-sm" : "border-slate-200 bg-white hover:border-amber-200"}`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-sm text-slate-800">{f.flight}</span>
                                  {sel && <span className="text-[10px] bg-amber-500 text-white px-2 py-0.5 rounded-full">Selected ✓</span>}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5">Dep. {f.dep} · {f.pax} pax · Gate 08</div>
                              </button>
                            </Fragment>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => { if (dspFlights.length > 0) setDspSub(2); else toast.error("Select at least one flight"); }}
                        className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${dspFlights.length > 0 ? "bg-amber-600 text-white hover:bg-amber-700 shadow-md" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
                      >
                        Next — Vehicle Details {dspFlights.length > 0 ? `(${dspFlights.length} selected)` : ""} <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {/* Screen 2 — Vehicle & Temperature */}
                  {dspSub === 2 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-slate-800 text-sm">Vehicle & Temperature</p>
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">2 of 4</span>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">VAN NUMBER *</p>
                        <input value={dspVehicle} onChange={e => setDspVehicle(e.target.value)} placeholder="e.g. HiLoader-02"
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-slate-50" />
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">VAN CLEANLINESS *</p>
                        <div className="flex gap-2">
                          <button onClick={() => setDspClean("Clean")}
                            className={`flex-1 py-2 rounded-lg border font-semibold text-sm transition-colors ${dspClean === "Clean" ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-200 bg-slate-50 text-slate-600"}`}>✓ Clean</button>
                          <button onClick={() => setDspClean("Not Clean")}
                            className={`flex-1 py-2 rounded-lg border font-semibold text-sm transition-colors ${dspClean === "Not Clean" ? "bg-red-500 border-red-500 text-white" : "border-slate-200 bg-slate-50 text-slate-600"}`}>Not Clean</button>
                        </div>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">PRODUCT CORE TEMPERATURE *</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[11px] text-slate-600 mb-1 font-medium">CHILLED (°C)</p>
                            <input type="number" step="0.1" value={dspChilled} onChange={e => setDspChilled(e.target.value)} placeholder="e.g. 3.2"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-slate-50" />
                            <p className="text-[10px] text-slate-400 mt-0.5">Standard: 1–4°C</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-slate-600 mb-1 font-medium">FROZEN (°C)</p>
                            <input type="number" step="0.1" value={dspFrozen} onChange={e => setDspFrozen(e.target.value)} placeholder="e.g. -13.5"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-slate-50" />
                            <p className="text-[10px] text-slate-400 mt-0.5">Standard: -12 to -8°C</p>
                          </div>
                        </div>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">VAN TEMP DURING LOADING</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[11px] text-slate-600 mb-1 font-medium">START (°C)</p>
                            <input type="number" step="0.1" value={dspVanStart} onChange={e => setDspVanStart(e.target.value)} placeholder="e.g. 4.1"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-slate-50" />
                          </div>
                          <div>
                            <p className="text-[11px] text-slate-600 mb-1 font-medium">END (°C)</p>
                            <input type="number" step="0.1" value={dspVanEnd} onChange={e => setDspVanEnd(e.target.value)} placeholder="e.g. 4.8"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-slate-50" />
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-400">Stays within ±8°C limit</p>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setDspSub(1)} className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-semibold text-sm hover:bg-slate-50">← Back</button>
                        <button onClick={() => { if (!dspVehicle || !dspClean) { toast.error("Fill vehicle details"); return; } setDspSub(3); }}
                          className="flex-[2] py-2.5 rounded-xl bg-amber-600 text-white font-bold text-sm flex items-center justify-center gap-1 hover:bg-amber-700 shadow-md">
                          Next <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Screen 3 — Result check */}
                  {dspSub === 3 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-slate-800 text-sm">Result Check</p>
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">3 of 4</span>
                      </div>
                      {dspResult === "Yes" && (
                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs text-emerald-700 font-semibold">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> All checks passed
                        </div>
                      )}
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        {[
                          ["Van clean", dspClean === "Clean" ? "Yes ✓" : dspClean || "—"],
                          ["Chilled temp", dspChilled ? `${dspChilled}°C` : "—"],
                          ["Frozen temp", dspFrozen ? `${dspFrozen}°C` : "—"],
                          ["Van temp (start)", dspVanStart ? `${dspVanStart}°C` : "—"],
                          ["Van temp (end)", dspVanEnd ? `${dspVanEnd}°C` : "—"],
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">{label}</span>
                            <span className={`font-semibold ${value === "Not Clean" ? "text-red-600" : "text-slate-800"}`}>{value}</span>
                          </div>
                        ))}
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">RESULT SATISFY</p>
                        <div className="flex gap-2">
                          <button onClick={() => setDspResult("Yes")}
                            className={`flex-1 py-2.5 rounded-xl border font-bold text-sm transition-colors ${dspResult === "Yes" ? "bg-emerald-500 border-emerald-500 text-white shadow-md" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-300"}`}>✓ Yes</button>
                          <button onClick={() => setDspResult("No")}
                            className={`flex-1 py-2.5 rounded-xl border font-bold text-sm transition-colors ${dspResult === "No" ? "bg-red-500 border-red-500 text-white shadow-md" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-red-300"}`}>No</button>
                        </div>
                      </div>
                      {dspResult === "Yes" && (
                        <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 flex items-center gap-3">
                          <div className="w-11 h-11 bg-slate-800 rounded-lg flex items-center justify-center shrink-0">
                            <QrCode className="h-6 w-6 text-white" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-sky-800">Dispatch QR ready</p>
                            <p className="text-[10px] text-sky-600">Contains flight, meal, van & temp data. Airport exec scans this.</p>
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setDspSub(2)} className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-semibold text-sm hover:bg-slate-50">← Back</button>
                        <button onClick={() => { if (!dspResult) { toast.error("Select result satisfy"); return; } confirmDispatch(); }}
                          className={`flex-[2] py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition-colors ${dspResult ? "bg-amber-600 text-white hover:bg-amber-700 shadow-md" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
                          <PlaneTakeoff className="h-4 w-4" /> Confirm & Dispatch
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Screen 4 — Dispatched */}
                  {dspSub === 4 && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-slate-400">{doc.documentCode}</p>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">Done</span>
                      </div>
                      <div className="flex flex-col items-center py-6">
                        <div className="w-20 h-20 rounded-full bg-emerald-100 border-4 border-emerald-400 flex items-center justify-center mb-3">
                          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                        </div>
                        <p className="text-2xl font-bold text-slate-800">Dispatched!</p>
                        <p className="text-sm text-slate-600 mt-1">{dspFlights.length} flight(s) dispatched</p>
                        <p className="text-xs text-slate-400">{dspVehicle}</p>
                      </div>
                      <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-sky-700 font-medium">
                          <PlaneLanding className="h-3.5 w-3.5 shrink-0" /> En route to Gate 08
                        </div>
                        <span className="text-sky-500 font-semibold">Awaiting APT scan</span>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Status</span>
                          <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold text-[10px]">Awaiting APT verify</span>
                        </div>
                      </div>
                      <button onClick={resetDispatch} className="w-full py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-600 font-semibold text-sm hover:bg-amber-100">
                        + New Dispatch
                      </button>
                    </div>
                  )}
                </div>

                <div className="bg-white border-t border-slate-200 flex shrink-0">
                  <button onClick={() => setScreen("home")} className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition-colors">
                    <Home className="h-4 w-4" /> Home
                  </button>
                  <button className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold text-amber-600">
                    <Truck className="h-4 w-4" /> Dispatch
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
