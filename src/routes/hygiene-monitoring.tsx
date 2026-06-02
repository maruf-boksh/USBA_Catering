import { useState, useMemo, useRef, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, Plus, Pencil, Trash2, Lock, Smartphone, ChevronRight, X as XIcon, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useRole } from "@/lib/roles";

// ── Dataset (unchanged) ────────────────────────────────────────────────────────
const CHECKLIST_ITEMS = [
  "All plastic curtains are in good position",
  "All aircutters are working properly",
  "Wastage has been disposed properly",
  "All cooking utensils are clean & good condition",
  "Any food item kept in danger zone",
  "All chiller/freezer/AC working properly",
  "Raw & cooked food kept separately in Kitchen/Chiller/freezer",
  "Maintaining FIFO properly in Kitchen/Chiller/Freezer/Pack/Bakery",
  "All open food are covered properly with Date code in Kitchen/Chiller/Freezer/Pack/Bakery",
  "Any expired/spoiled product found Kitchen/Chiller/Freezer/Pack/Bakery",
  "Any Cooked food, RM/PM are kept directly on the floor",
  "Packaging room temp. is below 15°C",
  "Date code check in packaging room",
  "Meal PKT Holding inside packaging room (Max. 10 Baskets)",
  "Presence of any pest/insects",
];

const TIME_SLOTS = ["6:00AM", "8:00AM", "10:00AM", "12:00PM", "2:00PM", "4:00PM", "6:00PM", "8:00PM", "10:00PM"];

const AUTHORIZED_PERSONNEL = [
  "Manager — Catering Operations",
  "Consultant — Food Safety",
  "QC Manager",
  "Head of Operations",
];

// ── Types ─────────────────────────────────────────────────────────────────────
type CellValue = "—" | "✓" | "✗";

type ChecklistRow = {
  id: string;
  item: string;
  values: Record<string, CellValue>;
  remarks: string;
};

type SlotSave = { savedAt: string; savedBy: string };

type LogEntry = {
  id: string;
  date: string;
  submittedBy: string;
  submittedAt: string;
  failCount: number;
  failItems: string[];
  rows: ChecklistRow[];
  slots: string[];
  authorizedBy?: string;
  authorizedAt?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRows(items: string[], slots: string[]): ChecklistRow[] {
  return items.map((item) => ({
    id: `r-${Math.random().toString(36).slice(2)}`,
    item,
    values: Object.fromEntries(slots.map((t) => [t, "—" as CellValue])),
    remarks: "",
  }));
}

function parseSlotMinutes(slot: string): number {
  const isPM = slot.endsWith("PM");
  const clean = slot.replace(/[AP]M$/, "");
  const parts = clean.split(":");
  const h = parseInt(parts[0]);
  const m = parts[1] ? parseInt(parts[1]) : 0;
  let hour = h;
  if (isPM && h !== 12) hour = h + 12;
  if (!isPM && h === 12) hour = 0;
  return hour * 60 + m;
}

function insertSlotSorted(slots: string[], newSlot: string): string[] {
  const newMin = parseSlotMinutes(newSlot);
  const idx = slots.findIndex((s) => parseSlotMinutes(s) > newMin);
  return idx === -1 ? [...slots, newSlot] : [...slots.slice(0, idx), newSlot, ...slots.slice(idx)];
}

function cycleCell(v: CellValue): CellValue {
  return v === "—" ? "✓" : v === "✓" ? "✗" : "—";
}

function cellCls(v: CellValue, locked: boolean, missed: boolean): string {
  if (missed) return "bg-amber-50 cursor-not-allowed";
  if (locked) {
    if (v === "✓") return "bg-green-100 cursor-default";
    if (v === "✗") return "bg-red-100 cursor-default";
    return "bg-muted/40 cursor-default";
  }
  if (v === "✓") return "bg-green-50 hover:bg-green-100 cursor-pointer";
  if (v === "✗") return "bg-red-50 hover:bg-red-100 cursor-pointer";
  return "hover:bg-muted cursor-pointer";
}

function cellContent(v: CellValue, missed: boolean) {
  if (missed) return <Lock className="h-3.5 w-3.5 text-amber-400" />;
  if (v === "✓") return <span className="text-green-700 font-bold text-base select-none">✓</span>;
  if (v === "✗") return <span className="text-red-700 font-bold text-base select-none">✗</span>;
  return <span className="text-muted-foreground select-none">—</span>;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function HygieneMonitoring() {
  const { role } = useRole();
  const todayStr = new Date().toISOString().split("T")[0];

  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [allSlots, setAllSlots] = useState<string[]>([...TIME_SLOTS]);
  const [editRows, setEditRows] = useState<ChecklistRow[]>(() => makeRows([...CHECKLIST_ITEMS], [...TIME_SLOTS]));
  const [savedSlots, setSavedSlots] = useState<Record<string, SlotSave>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [authPanelVisible, setAuthPanelVisible] = useState(false);
  const [currentLogId, setCurrentLogId] = useState<string | null>(null);

  // Modal open state
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [editRowOpen, setEditRowOpen] = useState(false);
  const [deleteRowOpen, setDeleteRowOpen] = useState(false);
  const [saveDraftOpen, setSaveDraftOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [viewLogOpen, setViewLogOpen] = useState(false);

  // Form fields
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemSlot, setNewItemSlot] = useState("");
  const [editRowIdx, setEditRowIdx] = useState<number | null>(null);
  const [editRowDesc, setEditRowDesc] = useState("");
  const [editRowSlot, setEditRowSlot] = useState("");
  const [deleteRowIdx, setDeleteRowIdx] = useState<number | null>(null);
  const [draftSlotPick, setDraftSlotPick] = useState("");
  const [authName, setAuthName] = useState("");
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [remarkErrors, setRemarkErrors] = useState<Set<number>>(new Set());

  // ── Mobile App View state ─────────────────────────────────────────────────
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mMobileTab, setMMobileTab] = useState<"checklist" | "log">("checklist");
  const [mScreen, setMScreen] = useState<1 | 2>(1);
  const [mSlot, setMSlot] = useState("");
  const [mLogEntryId, setMLogEntryId] = useState<string | null>(null);

  useEffect(() => {
    if (mobileOpen) { document.body.style.overflow = "hidden"; }
    else { document.body.style.overflow = ""; }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  // ── Computed ─────────────────────────────────────────────────────────────
  const missedSlots = useMemo<Set<string>>(() => {
    if (selectedDate !== todayStr) return new Set();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return new Set(
      allSlots.filter((slot) => {
        if (savedSlots[slot]) return false;
        return nowMin > parseSlotMinutes(slot) + 60;
      })
    );
  }, [selectedDate, todayStr, allSlots, savedSlots]);

  const availableToSave = useMemo(
    () => allSlots.filter((slot) => !savedSlots[slot] && !missedSlots.has(slot)),
    [allSlots, savedSlots, missedSlots]
  );

  const allSlotsFinalized = useMemo(
    () => allSlots.length > 0 && allSlots.every((slot) => savedSlots[slot] || missedSlots.has(slot)),
    [allSlots, savedSlots, missedSlots]
  );

  const failureSummary = useMemo(() => {
    const items: string[] = [];
    let count = 0;
    editRows.forEach((row) => {
      const fails = allSlots.filter((s) => row.values[s] === "✗").length;
      if (fails > 0) { items.push(row.item); count += fails; }
    });
    return { items, count };
  }, [editRows, allSlots]);

  const currentDateLog = useMemo(
    () => logs.find((l) => l.date === selectedDate && l.id === currentLogId) ?? null,
    [logs, selectedDate, currentLogId]
  );

  const rangedLogs = useMemo(
    () => logs.filter((l) => l.date >= selectedDate && l.date <= endDate).sort((a, b) => a.date.localeCompare(b.date)),
    [logs, selectedDate, endDate]
  );

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleCellClick = (rowIdx: number, slot: string) => {
    if (savedSlots[slot] || missedSlots.has(slot) || isSubmitted) return;
    setEditRows((prev) =>
      prev.map((row, i) =>
        i === rowIdx ? { ...row, values: { ...row.values, [slot]: cycleCell(row.values[slot]) } } : row
      )
    );
    setRemarkErrors(new Set());
  };

  const updateRemarks = (rowIdx: number, val: string) => {
    if (isSubmitted) return;
    setEditRows((prev) => prev.map((row, i) => (i === rowIdx ? { ...row, remarks: val } : row)));
  };

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    setAllSlots([...TIME_SLOTS]);
    setEditRows(makeRows([...CHECKLIST_ITEMS], [...TIME_SLOTS]));
    setSavedSlots({});
    setIsSubmitted(false);
    setAuthPanelVisible(false);
    setCurrentLogId(null);
    setRemarkErrors(new Set());
  };

  // Add item (optionally with a new time slot)
  const saveNewItem = () => {
    const desc = newItemDesc.trim();
    if (!desc) { toast.error("Description is required."); return; }

    let slots = allSlots;
    if (newItemSlot) {
      const [hStr, mStr] = newItemSlot.split(":");
      const h = parseInt(hStr);
      const m = (mStr || "00").padStart(2, "0");
      const period = h >= 12 ? "PM" : "AM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const slotLabel = `${h12}:${m}${period}`;
      if (!allSlots.includes(slotLabel)) {
        slots = insertSlotSorted(allSlots, slotLabel);
        setAllSlots(slots);
        setEditRows((prev) =>
          prev.map((row) => ({ ...row, values: { ...row.values, [slotLabel]: "—" as CellValue } }))
        );
      }
    }

    const newRow: ChecklistRow = {
      id: `r-${Date.now()}`,
      item: desc,
      values: Object.fromEntries(slots.map((t) => [t, "—" as CellValue])),
      remarks: "",
    };
    setEditRows((prev) => [...prev, newRow]);
    setNewItemDesc("");
    setNewItemSlot("");
    setAddItemOpen(false);
    toast.success("Checklist item added.");
  };

  // Edit row
  const openEditRow = (idx: number) => {
    setEditRowIdx(idx);
    setEditRowDesc(editRows[idx].item);
    setEditRowSlot("");
    setEditRowOpen(true);
  };
  const saveEditRow = () => {
    const desc = editRowDesc.trim();
    if (!desc) { toast.error("Description is required."); return; }

    let slots = allSlots;
    if (editRowSlot) {
      const [hStr, mStr] = editRowSlot.split(":");
      const h = parseInt(hStr);
      const m = (mStr || "00").padStart(2, "0");
      const period = h >= 12 ? "PM" : "AM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const slotLabel = `${h12}:${m}${period}`;
      if (!allSlots.includes(slotLabel)) {
        slots = insertSlotSorted(allSlots, slotLabel);
        setAllSlots(slots);
        setEditRows((prev) =>
          prev.map((row) => ({ ...row, values: { ...row.values, [slotLabel]: "—" as CellValue } }))
        );
      }
    }

    setEditRows((prev) => prev.map((row, i) => (i === editRowIdx ? { ...row, item: desc } : row)));
    setEditRowOpen(false);
    toast.success("Checklist item updated.");
  };

  // Delete row
  const openDeleteRow = (idx: number) => { setDeleteRowIdx(idx); setDeleteRowOpen(true); };
  const confirmDeleteRow = () => {
    setEditRows((prev) => prev.filter((_, i) => i !== deleteRowIdx));
    setDeleteRowOpen(false);
    toast.success("Checklist item removed.");
  };

  // Save Draft
  const openSaveDraft = () => {
    if (availableToSave.length === 0) { toast.info("No unsaved slots available."); return; }
    setDraftSlotPick(availableToSave[0]);
    setSaveDraftOpen(true);
  };
  const confirmSaveDraft = () => {
    const slot = draftSlotPick;
    const errors = new Set<number>();
    editRows.forEach((row, i) => {
      if (row.values[slot] === "✗" && !row.remarks.trim()) errors.add(i);
    });
    if (errors.size > 0) {
      setRemarkErrors(errors);
      setSaveDraftOpen(false);
      toast.error("Remark required for all failed items before saving.");
      return;
    }
    const now = new Date();
    const savedAt = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    setSavedSlots((prev) => ({ ...prev, [slot]: { savedAt, savedBy: role } }));
    setSaveDraftOpen(false);
    toast.success(`✅ Draft saved — ${slot} slot recorded at ${savedAt}`);
  };

  // Confirm & Submit
  const confirmSubmit = () => {
    const now = new Date();
    const submittedAt = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    const logId = `LOG-${Date.now()}`;
    const logEntry: LogEntry = {
      id: logId,
      date: selectedDate,
      submittedBy: role,
      submittedAt,
      failCount: failureSummary.count,
      failItems: failureSummary.items,
      rows: editRows.map((r) => ({ ...r, values: { ...r.values } })),
      slots: [...allSlots],
    };
    setLogs((prev) => [logEntry, ...prev]);
    setCurrentLogId(logId);
    setIsSubmitted(true);
    setSubmitOpen(false);
    setAuthPanelVisible(true);
    toast.success("Checklist submitted successfully.");
  };

  const handleAuthorize = () => {
    if (!authName) { toast.error("Please select an authorized person."); return; }
    const now = new Date();
    const at = `${selectedDate} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    setLogs((prev) =>
      prev.map((log) =>
        log.id === currentLogId ? { ...log, authorizedBy: authName, authorizedAt: at } : log
      )
    );
    setAuthPanelVisible(false);
    toast.success(`Authorized by ${authName}.`);
  };

  // ── Mobile helpers ────────────────────────────────────────────────────────
  const mobileConfirmSlot = () => {
    const slot = mSlot;
    const errors = new Set<number>();
    editRows.forEach((row, i) => {
      if (row.values[slot] === "✗" && !row.remarks.trim()) errors.add(i);
    });
    if (errors.size > 0) {
      setRemarkErrors(errors);
      toast.error("Remark required for all failed items.");
      return;
    }
    const now = new Date();
    const savedAt = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    setSavedSlots(prev => ({ ...prev, [slot]: { savedAt, savedBy: role } }));
    setMScreen(1);
    toast.success(`✅ ${slot} slot saved`);
  };

  const mobileSubmit = () => {
    const now = new Date();
    const submittedAt = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    const logId = `LOG-${Date.now()}`;
    const logEntry: LogEntry = {
      id: logId,
      date: selectedDate,
      submittedBy: role,
      submittedAt,
      failCount: failureSummary.count,
      failItems: failureSummary.items,
      rows: editRows.map(r => ({ ...r, values: { ...r.values } })),
      slots: [...allSlots],
    };
    setLogs(prev => [logEntry, ...prev]);
    setCurrentLogId(logId);
    setIsSubmitted(true);
    toast.success("Checklist submitted successfully.");
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title="Daily Food Safety & Hygiene Monitoring"
        subtitle="USBA-FSH-DFSHM-01 — Record checklist status for each time slot per day"
        actions={
          <div className="flex gap-2 flex-wrap items-center">
            <Button onClick={() => { setMMobileTab("checklist"); setMScreen(1); setMobileOpen(true); }}>
              <Smartphone className="h-4 w-4 mr-1.5" /> Mobile App View
            </Button>
            {!isSubmitted && (
              <Button
                size="sm"
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => { setNewItemDesc(""); setNewItemSlot(""); setAddItemOpen(true); }}
              >
                <Plus className="h-4 w-4 mr-1" /> Add New
              </Button>
            )}
            {!isSubmitted && !allSlotsFinalized && (
              <Button
                className="bg-amber-500 hover:bg-amber-600 text-white"
                onClick={openSaveDraft}
              >
                <ClipboardCheck className="h-4 w-4 mr-1" /> Save Draft
              </Button>
            )}
            {!isSubmitted && allSlotsFinalized && (
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setSubmitOpen(true)}>
                <ClipboardCheck className="h-4 w-4 mr-1" /> Confirm & Submit
              </Button>
            )}
          </div>
        }
      />

      {/* Instruction + Legend */}
      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
        <div className="mb-2 space-y-1">
          <p className="text-[13px] font-medium text-blue-800">
            How to fill this checklist:
          </p>
          <p className="text-[12.5px] text-blue-700">
            <span className="font-semibold">Step 1 —</span> At each scheduled time, mark every item as Pass (✓) or Fail (✗), then click <span className="font-semibold">Save Draft</span> to lock that time slot.
          </p>
          <p className="text-[12.5px] text-blue-700">
            <span className="font-semibold">Step 2 —</span> After the last time slot of the day is saved, click <span className="font-semibold">Confirm & Submit</span> to record the final checklist for the day.
          </p>
        </div>
        <div className="flex items-center gap-5 text-xs flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="inline-flex w-6 h-6 items-center justify-center rounded bg-green-100 text-green-700 font-bold text-base">✓</span>
            <span><span className="font-semibold">1st click</span> — Pass</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex w-6 h-6 items-center justify-center rounded bg-red-100 text-red-700 font-bold text-base">✗</span>
            <span><span className="font-semibold">2nd click</span> — Fail</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex w-6 h-6 items-center justify-center rounded bg-muted text-muted-foreground">—</span>
            Not Checked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex w-6 h-6 items-center justify-center rounded bg-amber-50">
              <Lock className="h-3.5 w-3.5 text-amber-400" />
            </span>
            Missed
          </span>
        </div>
      </div>

      {/* Date range picker */}
      <div className="mb-4 flex items-end gap-4 flex-wrap">
        <div>
          <Label className="text-xs mb-1 block">From</Label>
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => {
              handleDateChange(e.target.value);
              if (e.target.value > endDate) setEndDate(e.target.value);
            }}
            className="w-44"
          />
        </div>
        <div>
          <Label className="text-xs mb-1 block">To</Label>
          <Input
            type="date"
            value={endDate}
            min={selectedDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-44"
          />
        </div>
        <span className="text-xs pb-2">
          {isSubmitted ? (
            <span className="text-green-600 font-medium">✅ Checklist submitted</span>
          ) : Object.keys(savedSlots).length > 0 ? (
            <span className="text-muted-foreground">{Object.keys(savedSlots).length}/{allSlots.length} slots draft-saved</span>
          ) : null}
        </span>
      </div>

      {/* Checklist Table */}
      <div className="rounded-xl border border-border bg-card overflow-x-auto mb-6">
        <table className="w-full text-sm border-collapse" style={{ minWidth: 1100 }}>
          <thead>
            <tr className="bg-muted/60 border-b border-border">
              <th className="text-center px-3 py-2.5 font-semibold w-10 text-xs">SL</th>
              <th className="text-left px-3 py-2.5 font-semibold" style={{ minWidth: 280 }}>Checklist</th>
              {allSlots.map((t) => {
                const saved = savedSlots[t];
                const missed = missedSlots.has(t);
                return (
                  <th key={t} className="text-center px-1 py-2 font-semibold whitespace-nowrap text-xs" style={{ minWidth: 76 }}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span>{t}</span>
                      {saved && <span className="text-green-600 text-[9px] font-normal">✅ {saved.savedAt}</span>}
                    </div>
                  </th>
                );
              })}
              <th className="text-left px-3 py-2.5 font-semibold text-xs" style={{ minWidth: 140 }}>Remarks</th>
              <th className="text-center px-3 py-2.5 font-semibold text-xs" style={{ minWidth: 90 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {editRows.map((row, i) => {
              const hasFailure = allSlots.some((s) => row.values[s] === "✗");
              const hasRemarkError = remarkErrors.has(i);
              return (
                <tr key={row.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-1.5 text-center text-muted-foreground text-xs">{i + 1}</td>
                  <td className="px-3 py-1.5 text-[13px] leading-snug">{row.item}</td>
                  {allSlots.map((t) => {
                    const locked = !!savedSlots[t] || isSubmitted;
                    const missed = missedSlots.has(t);
                    const v = row.values[t];
                    return (
                      <td key={t} className="text-center px-1 py-1">
                        <button
                          type="button"
                          disabled={locked || missed || isSubmitted}
                          onClick={() => handleCellClick(i, t)}
                          className={`w-8 h-8 rounded flex items-center justify-center mx-auto transition-colors ${cellCls(v, locked || isSubmitted, missed)}`}
                          title={locked ? "Slot saved — locked" : missed ? "Slot missed" : "Click: Pass → Fail → Reset"}
                        >
                          {cellContent(v, missed)}
                        </button>
                      </td>
                    );
                  })}
                  <td className={`px-2 py-1.5 ${hasFailure ? "bg-amber-50/60" : ""}`}>
                    <div>
                      <input
                        type="text"
                        value={row.remarks}
                        onChange={(e) => updateRemarks(i, e.target.value)}
                        disabled={isSubmitted}
                        className={`w-full border rounded px-2 py-1 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring ${
                          hasRemarkError
                            ? "border-red-400 bg-red-50"
                            : hasFailure
                            ? "border-amber-300 bg-amber-50 placeholder:text-amber-600"
                            : "border-border"
                        }`}
                        placeholder={hasFailure ? "Required for failures" : "—"}
                      />
                      {hasRemarkError && (
                        <p className="text-[10px] text-red-600 mt-0.5">Remark required</p>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {!isSubmitted && (
                      <div className="flex items-center gap-1 justify-center">
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => openEditRow(i)}
                          title="Edit item"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                          onClick={() => openDeleteRow(i)}
                          title="Delete item"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex justify-between items-center px-4 py-2.5 border-t border-border bg-muted/20 text-xs text-muted-foreground">
          <span>Verified By — Executive (Food Safety &amp; Hygiene)</span>
          <span>Authorized By — Manager/Consultant (Catering)</span>
        </div>
      </div>

      {/* Logs List — date range */}
      {rangedLogs.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Submitted Reports ({rangedLogs.length})
          </div>
          {rangedLogs.map((log) => (
            <div key={log.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-sm">📋 {log.date}</span>
                <Button
                  size="sm" variant="outline"
                  onClick={() => { setSelectedLog(log); setViewLogOpen(true); }}
                >
                  View Full Record
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Submitted by:{" "}
                <span className="font-medium text-foreground">{log.submittedBy}</span>
                {" "}— {log.submittedAt}
              </div>
              <div className="text-xs mt-1">
                Status:{" "}
                {log.failCount === 0 ? (
                  <span className="text-green-600 font-medium">All items passed ✅</span>
                ) : (
                  <span className="text-red-600 font-medium">
                    {log.failCount} failure{log.failCount !== 1 ? "s" : ""} recorded
                    {log.failItems.length > 0 && (
                      <span className="text-muted-foreground font-normal">
                        {" "}(Items: {log.failItems.slice(0, 2).join(", ")}
                        {log.failItems.length > 2 ? ` +${log.failItems.length - 2} more` : ""})
                      </span>
                    )}
                  </span>
                )}
              </div>
              {log.authorizedBy && (
                <div className="text-xs text-muted-foreground mt-1">
                  Authorized by:{" "}
                  <span className="font-medium text-foreground">{log.authorizedBy}</span>
                  {" "}— {log.authorizedAt}
                </div>
              )}
            </div>
          ))}
        </div>
      )}


      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Add New Item */}
      <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add New Checklist Item</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Checklist Item Description *</Label>
              <Input
                value={newItemDesc}
                onChange={(e) => setNewItemDesc(e.target.value)}
                placeholder="Enter description"
                className="mt-1"
                onKeyDown={(e) => e.key === "Enter" && saveNewItem()}
              />
            </div>
            <div>
              <Label>Time Schedule <span className="text-muted-foreground font-normal">(Optional)</span></Label>
              <p className="text-xs text-muted-foreground mb-1">Select a time to also add a new inspection time slot for this item.</p>
              <Input
                type="time"
                value={newItemSlot}
                onChange={(e) => setNewItemSlot(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddItemOpen(false)}>Cancel</Button>
            <Button onClick={saveNewItem}>Save Item</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Item */}
      <Dialog open={editRowOpen} onOpenChange={setEditRowOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Checklist Item</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Item Description *</Label>
              <Input
                value={editRowDesc}
                onChange={(e) => setEditRowDesc(e.target.value)}
                className="mt-1"
                onKeyDown={(e) => e.key === "Enter" && saveEditRow()}
              />
            </div>
            <div>
              <Label>Add Time Schedule <span className="text-muted-foreground font-normal">(Optional)</span></Label>
              <p className="text-xs text-muted-foreground mb-1">Select a time to also add a new inspection time slot.</p>
              <Input
                type="time"
                value={editRowSlot}
                onChange={(e) => setEditRowSlot(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRowOpen(false)}>Cancel</Button>
            <Button onClick={saveEditRow}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={deleteRowOpen} onOpenChange={setDeleteRowOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Delete Checklist Item?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this checklist item?
            This will also remove all recorded data for this item.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRowOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDeleteRow}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save Draft — Slot Picker */}
      <Dialog open={saveDraftOpen} onOpenChange={setSaveDraftOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Save Draft — Select Time Slot</DialogTitle></DialogHeader>
          <div>
            <Label>Time slot to lock</Label>
            <Select value={draftSlotPick} onValueChange={setDraftSlotPick}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select slot" />
              </SelectTrigger>
              <SelectContent>
                {availableToSave.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">
              This will lock the selected slot. All cells for that time column will become read-only.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDraftOpen(false)}>Cancel</Button>
            <Button onClick={confirmSaveDraft}>Save Draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm & Submit */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Submit Today's Checklist?</DialogTitle></DialogHeader>
          <div className="text-sm space-y-3">
            <p className="text-muted-foreground">All {allSlots.length} time slots completed.</p>
            {failureSummary.count === 0 ? (
              <p className="text-green-600 font-medium">All items passed ✅</p>
            ) : (
              <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2">
                <p className="text-red-700 font-medium">
                  {failureSummary.count} failure{failureSummary.count !== 1 ? "s" : ""} recorded
                </p>
                <p className="text-red-600 text-xs mt-1">
                  Items: {failureSummary.items.slice(0, 3).join(", ")}
                  {failureSummary.items.length > 3 && ` +${failureSummary.items.length - 3} more`}
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground border-t pt-2">
              Once submitted, the checklist will be locked and cannot be edited.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>Cancel</Button>
            <Button onClick={confirmSubmit}>Confirm & Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Full Record */}
      <Dialog open={viewLogOpen} onOpenChange={setViewLogOpen}>
        <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Full Record — {selectedLog?.date}</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <>
            <div className="overflow-x-auto">
              <div className="text-xs text-muted-foreground mb-3">
                Submitted by {selectedLog.submittedBy} at {selectedLog.submittedAt}
                {selectedLog.authorizedBy && (
                  <span> · Authorized by {selectedLog.authorizedBy} — {selectedLog.authorizedAt}</span>
                )}
              </div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="p-2 text-left font-semibold border">SL</th>
                    <th className="p-2 text-left font-semibold border" style={{ minWidth: 220 }}>Checklist Item</th>
                    {selectedLog.slots.map((s) => (
                      <th key={s} className="p-2 text-center font-semibold border whitespace-nowrap">{s}</th>
                    ))}
                    <th className="p-2 text-left font-semibold border">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedLog.rows.map((row, i) => (
                    <tr key={row.id} className="border-b hover:bg-muted/20">
                      <td className="p-2 text-center text-muted-foreground border">{i + 1}</td>
                      <td className="p-2 border">{row.item}</td>
                      {selectedLog.slots.map((s) => (
                        <td
                          key={s}
                          className={`p-2 text-center font-bold border ${
                            row.values[s] === "✓" ? "text-green-700 bg-green-50" :
                            row.values[s] === "✗" ? "text-red-700 bg-red-50" :
                            "text-muted-foreground"
                          }`}
                        >
                          {row.values[s]}
                        </td>
                      ))}
                      <td className="p-2 text-muted-foreground border">{row.remarks || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-6 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs space-y-1">
              <div className="font-semibold text-muted-foreground uppercase tracking-wide mb-2 text-[10px]">Verified By</div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-24">Name:</span>
                <span className="font-medium text-foreground">{selectedLog.submittedBy}</span>
                <span className="text-muted-foreground ml-1">— Executive (Food Safety &amp; Hygiene)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-24">Date:</span>
                <span className="font-medium text-foreground">{selectedLog.date}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-24">Timestamp:</span>
                <span className="font-medium text-foreground">{selectedLog.submittedAt}</span>
              </div>
            </div>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewLogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Mobile App View Overlay ────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div
            className="relative flex flex-col rounded-[2.5rem] shadow-2xl overflow-hidden border-4 border-slate-700"
            style={{ width: 375, height: 720, maxHeight: "95vh", background: "#f8fafc" }}
          >
            {/* Status bar */}
            <div className="bg-slate-800 px-5 pt-3 pb-2 flex items-center justify-between shrink-0">
              <span className="text-white text-xs font-medium">Hygiene Monitor</span>
              <button onClick={() => setMobileOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            {/* App header */}
            <div className="bg-emerald-700 px-4 py-3 shrink-0">
              <p className="text-white font-bold text-sm">Daily Hygiene Monitoring</p>
              <p className="text-emerald-200 text-[10px] mt-0.5">USBA-FSH-DFSHM-01 · {selectedDate}</p>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto bg-slate-50">

              {/* CHECKLIST TAB */}
              {mMobileTab === "checklist" && (
                <>
                  {/* Screen 1 — Slots Dashboard */}
                  {mScreen === 1 && (
                    <div className="p-4 space-y-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Time Slots</p>
                        {isSubmitted && (
                          <span className="text-[10px] bg-green-500 text-white px-2 py-0.5 rounded-full font-semibold">Submitted ✓</span>
                        )}
                      </div>

                      {isSubmitted && (
                        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-[12px] text-green-700 font-medium">
                          ✅ Today's checklist submitted successfully.
                        </div>
                      )}

                      {allSlots.map(slot => {
                        const saved = savedSlots[slot];
                        const missed = missedSlots.has(slot);
                        const isActive = !saved && !missed && !isSubmitted;
                        return (
                          <button
                            key={slot}
                            disabled={!isActive}
                            onClick={() => { setMSlot(slot); setMScreen(2); }}
                            className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all ${
                              saved
                                ? "border-green-300 bg-green-50"
                                : missed
                                ? "border-amber-200 bg-amber-50"
                                : isActive
                                ? "border-slate-200 bg-white hover:border-emerald-300"
                                : "border-slate-100 bg-slate-50 opacity-50"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm text-slate-800">{slot}</span>
                              {saved ? (
                                <span className="text-[10px] bg-green-500 text-white px-2 py-0.5 rounded-full">✓ {saved.savedAt}</span>
                              ) : missed ? (
                                <span className="text-[10px] bg-amber-400 text-white px-2 py-0.5 rounded-full">🔒 Missed</span>
                              ) : isActive ? (
                                <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Tap to record →</span>
                              ) : null}
                            </div>
                            {saved && (
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {editRows.filter(r => r.values[slot] === "✗").length} fail · {editRows.filter(r => r.values[slot] === "✓").length} pass
                              </p>
                            )}
                          </button>
                        );
                      })}

                      {allSlotsFinalized && !isSubmitted && (
                        <button
                          onClick={mobileSubmit}
                          className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm mt-1 hover:bg-emerald-700 transition-colors"
                        >
                          Submit Day's Checklist ✓
                        </button>
                      )}
                    </div>
                  )}

                  {/* Screen 2 — Record slot */}
                  {mScreen === 2 && (
                    <div className="p-4 space-y-2">
                      <div className="flex items-center gap-2 mb-2">
                        <button
                          onClick={() => setMScreen(1)}
                          className="h-7 w-7 flex items-center justify-center rounded-full bg-slate-200 hover:bg-slate-300 transition-colors"
                        >
                          <ChevronRight className="h-4 w-4 rotate-180 text-slate-600" />
                        </button>
                        <div>
                          <p className="font-bold text-slate-800 text-sm">Record — {mSlot}</p>
                          <p className="text-[10px] text-slate-400">Tap cell to toggle Pass / Fail</p>
                        </div>
                      </div>

                      {editRows.map((row, i) => {
                        const v = (row.values[mSlot] ?? "—") as "—" | "✓" | "✗";
                        return (
                          <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="flex items-start gap-2">
                              <button
                                onClick={() => handleCellClick(i, mSlot)}
                                className={`shrink-0 mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center font-bold text-base transition-colors border ${
                                  v === "✓"
                                    ? "bg-green-100 text-green-700 border-green-300"
                                    : v === "✗"
                                    ? "bg-red-100 text-red-700 border-red-300"
                                    : "bg-slate-100 text-slate-400 border-slate-200"
                                }`}
                              >
                                {v}
                              </button>
                              <p className="text-[12px] text-slate-700 leading-snug flex-1 pt-1.5">{row.item}</p>
                            </div>
                            {v === "✗" && (
                              <input
                                type="text"
                                value={row.remarks}
                                onChange={(e) => updateRemarks(i, e.target.value)}
                                placeholder="Remark required *"
                                className={`mt-2 w-full border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-red-400 ${
                                  remarkErrors.has(i)
                                    ? "border-red-400 bg-red-50 placeholder:text-red-400"
                                    : "border-red-300 bg-red-50"
                                }`}
                              />
                            )}
                          </div>
                        );
                      })}

                      <button
                        onClick={mobileConfirmSlot}
                        className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm mt-1 hover:bg-emerald-700 transition-colors"
                      >
                        Save Slot — {mSlot}
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* LOG TAB */}
              {mMobileTab === "log" && (
                <div className="p-4 space-y-3">
                  {mLogEntryId ? (() => {
                    const log = logs.find(l => l.id === mLogEntryId);
                    if (!log) return null;
                    return (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          <button
                            onClick={() => setMLogEntryId(null)}
                            className="h-7 w-7 flex items-center justify-center rounded-full bg-slate-200 hover:bg-slate-300 transition-colors"
                          >
                            <ChevronRight className="h-4 w-4 rotate-180 text-slate-600" />
                          </button>
                          <p className="font-bold text-slate-800 text-sm">Log Details</p>
                        </div>

                        <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-1.5 text-[12px]">
                          {[
                            ["Date", log.date],
                            ["Submitted by", log.submittedBy],
                            ["Submitted at", log.submittedAt],
                            ...(log.authorizedBy ? [["Authorized by", log.authorizedBy]] : []),
                          ].map(([label, value]) => (
                            <div key={label} className="flex items-center justify-between">
                              <span className="text-slate-500">{label}</span>
                              <span className="font-semibold text-slate-800 text-right max-w-[60%]">{value}</span>
                            </div>
                          ))}
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">Result</span>
                            {log.failCount === 0 ? (
                              <span className="text-[10px] bg-green-500 text-white px-2 py-0.5 rounded-full font-semibold">All Pass ✓</span>
                            ) : (
                              <span className="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-full font-semibold">{log.failCount} Fail</span>
                            )}
                          </div>
                        </div>

                        {log.failItems.length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-1.5">Failed Items</p>
                            {log.failItems.map(item => (
                              <div key={item} className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-1.5">
                                ✗ {item}
                              </div>
                            ))}
                          </div>
                        )}

                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Checklist Summary</p>
                          {log.rows.map((row, i) => {
                            const hasAnyFail = log.slots.some(s => row.values[s] === "✗");
                            return (
                              <div key={row.id} className={`rounded-lg border px-3 py-2 mb-1.5 text-[11px] ${hasAnyFail ? "border-red-200 bg-red-50" : "border-green-100 bg-green-50"}`}>
                                <p className={`font-medium ${hasAnyFail ? "text-red-700" : "text-green-700"}`}>{i + 1}. {row.item}</p>
                                {row.remarks && <p className="text-slate-500 mt-0.5 italic">"{row.remarks}"</p>}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })() : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-slate-800 text-sm">Submitted Logs</p>
                        <span className="text-[10px] text-slate-400">{logs.length} total</span>
                      </div>
                      {logs.length === 0 ? (
                        <div className="text-center py-10 text-[12px] text-slate-400">No logs submitted yet.</div>
                      ) : (
                        logs.map(log => (
                          <button
                            key={log.id}
                            onClick={() => setMLogEntryId(log.id)}
                            className="w-full text-left px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-emerald-300 transition-all"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm text-slate-800">📋 {log.date}</span>
                              {log.failCount === 0 ? (
                                <span className="text-[10px] bg-green-500 text-white px-2 py-0.5 rounded-full">All Pass</span>
                              ) : (
                                <span className="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-full">{log.failCount} Fail</span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {log.submittedBy} · {log.submittedAt}
                              {log.authorizedBy ? ` · Auth: ${log.authorizedBy.split("—")[0].trim()}` : " · Pending auth"}
                            </p>
                          </button>
                        ))
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Bottom nav */}
            <div className="bg-white border-t border-slate-200 flex shrink-0">
              <button
                onClick={() => { setMMobileTab("checklist"); setMScreen(1); }}
                className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-colors ${
                  mMobileTab === "checklist" ? "text-emerald-600" : "text-slate-400"
                }`}
              >
                <ClipboardCheck className="h-4 w-4" /> Checklist
              </button>
              <button
                onClick={() => setMMobileTab("log")}
                className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-colors ${
                  mMobileTab === "log" ? "text-emerald-600" : "text-slate-400"
                }`}
              >
                <Clock className="h-4 w-4" /> Log
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
