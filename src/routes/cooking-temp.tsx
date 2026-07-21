import { useState, useEffect } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, ThermometerSun, ShieldCheck, AlertOctagon, ClipboardCheck, Factory, Check, X as XIcon, PackageCheck, Eye, ChevronLeft, Trash2, Settings2, Clock } from "lucide-react";
import { cookingTempLogs } from "@/lib/sample-data";
import { KpiCard } from "@/components/common/KpiCard";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useWorkflow, type WfProductionEntry } from "@/lib/workflow-store";
import { useArrivalFlash } from "@/lib/arrival-flash";
import { useRole } from "@/lib/roles";

const CURRENT_USER = "R. Hossain";

const CHEFS = [
  "Chef R. Karim",
  "Chef N. Hasan",
  "Chef A. Rahim",
  "Chef T. Hossain",
  "Chef S. Mahmud",
  "Chef F. Begum",
  "Chef M. Karim",
];

const FOOD_ITEMS = [
  "Chicken Biryani",
  "Veg Pulao",
  "Grilled Salmon",
  "Continental Breakfast",
  "Hindu Meal Special",
  "Heavy Snack Box",
  "Grilled Chicken",
  "Fish Fillet",
  "Beef Stew",
  "Pasta Al Dente",
  "Reheated Rice",
  "Egg Benedict",
  "Lamb Chop",
  "Mixed Salad",
  "Vegetable Stir Fry",
];

// standardTemp = minimum safe temperature; thresholdTemp = maximum sensible
// reading. A measured temp is only logical within [standardTemp, thresholdTemp].
type ItemConfig = { standardTemp: number; thresholdTemp: number };

type CookingRecord = (typeof cookingTempLogs)[number] & {
  date: string;
  failReason?: string;
  checkedAt?: string;
  /** Sensory taste result recorded at sign-off (e.g. Good / Average / free-text). */
  taste?: string;
  /** Max sensible reading for the item (from HACCP config) at sign-off time. */
  thresholdTemp?: number;
};
type T = CookingRecord;

export default function CookingTemp() {
  useArrivalFlash();
  const { role } = useRole();
  const { productionEntries, updateProductionEntryStatus, applyStockDeltas } = useWorkflow();
  const [records, setRecords] = usePersistedState<T[]>("cooking-temp-records", () =>
    cookingTempLogs.map(r => ({ ...r, date: "2026-05-22" }))
  );

  // Item configuration: item name → standard temp only
  const [itemConfigs, setItemConfigs] = useState<Record<string, ItemConfig>>({
    "Chicken Biryani": { standardTemp: 75, thresholdTemp: 95 },
    "Veg Pulao": { standardTemp: 70, thresholdTemp: 90 },
    "Grilled Salmon": { standardTemp: 63, thresholdTemp: 85 },
    "Continental Breakfast": { standardTemp: 65, thresholdTemp: 85 },
    "Hindu Meal Special": { standardTemp: 75, thresholdTemp: 95 },
    "Heavy Snack Box": { standardTemp: 70, thresholdTemp: 90 },
  });

  // HACCP config modal state
  const [newRecordOpen, setNewRecordOpen] = useState(false);
  const [newRecordItem, setNewRecordItem] = useState("");
  const [newRecordStandardTemp, setNewRecordStandardTemp] = useState<number | "">("");
  const [newRecordThresholdTemp, setNewRecordThresholdTemp] = useState<number | "">("");
  // When true, the Item field is a free-text input for adding a brand-new item
  // (not in the predefined list) rather than the dropdown.
  const [customItemMode, setCustomItemMode] = useState(false);
  // Item whose full HACCP standard is being viewed in the config dialog.
  const [viewConfigItem, setViewConfigItem] = useState<string | null>(null);

  // Filters
  const [filterDate, setFilterDate] = useState("");
  const [filterSensory, setFilterSensory] = useState<"" | "Pass" | "Fail">("");
  const [filterItem, setFilterItem] = useState("");

  // View record dialog
  const [viewRecord, setViewRecord] = useState<T | null>(null);

  // QC sign-off dialog
  const [qcOpen, setQcOpen] = useState(false);
  const [qcAllOpen, setQcAllOpen] = useState(false); // bulk "record test for all pending QC"
  const [qcTarget, setQcTarget] = useState<WfProductionEntry | null>(null);
  const [qcTemp, setQcTemp] = useState(75);
  const [qcThreshold, setQcThreshold] = useState(95); // max sensible reading for the item
  const [qcMeasured, setQcMeasured] = useState(0);
  const [qcCookedBy, setQcCookedBy] = useState("");
  const [qcBatchNo, setQcBatchNo] = useState("");
  // Sensory taste parameter — a QC dimension independent of temperature (a batch
  // can be at temp yet off-taste, or tasty yet fail another check).
  const [qcTaste, setQcTaste] = useState<"" | "Good" | "Average" | "Not Good" | "Other">("");
  const [qcTasteOther, setQcTasteOther] = useState(""); // free-text when Taste = "Other"
  // Per-batch inputs for the combined "Record Test — All" form (keyed by entry id).
  const [qcAllRows, setQcAllRows] = useState<Record<string, { measured: number | ""; cookedBy: string }>>({});

  // Fail state
  const [failReason, setFailReason] = useState("");
  const [recookConfirmOpen, setRecookConfirmOpen] = useState(false);

  // ── Mobile App View state ─────────────────────────────────────────────────
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mMobileTab, setMMobileTab] = useState<"qc" | "log">("qc");
  const [mScreen, setMScreen] = useState<1 | 2 | 3 | 4>(1);
  const [mFailReason, setMFailReason] = useState("");
  const [mResult, setMResult] = useState<"pass" | "fail">("pass");
  const [mLogRecordId, setMLogRecordId] = useState<string | null>(null);

  useEffect(() => {
    if (mobileOpen) { document.body.style.overflow = "hidden"; }
    else { document.body.style.overflow = ""; }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const pendingQC = productionEntries.filter((e) => e.status === "Ready for QC");

  const openQc = (entry: WfProductionEntry) => {
    const itemName = entry.outputItemName ?? entry.bom;
    const config = itemConfigs[itemName];
    setQcTarget(entry);
    setQcTemp(config?.standardTemp ?? 75);
    setQcThreshold(config?.thresholdTemp ?? (config?.standardTemp ?? 75) + 20);
    setQcMeasured(0);
    setQcCookedBy("");
    setQcBatchNo(entry.id);
    setQcTaste("");
    setQcTasteOther("");
    setFailReason("");
    setRecookConfirmOpen(false);
    setQcOpen(true);
  };

  const signOff = (passed: boolean) => {
    if (!qcTarget) return;
    // Temperature-accepted re-cooks are driven by the sensory/taste result, which
    // has no separate justification field — fall back to the taste as the reason.
    const tasteNote = qcTaste === "Other" ? qcTasteOther.trim() : qcTaste;
    const effectiveFailReason =
      failReason.trim() || (tasteNote ? `Sensory/taste not acceptable — ${tasteNote}` : "");
    if (!passed && !effectiveFailReason) { toast.error("Please enter a reason for rejection."); return; }
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB");
    const timeStr = now.toLocaleTimeString("en-GB");
    const stamp = now.toISOString().slice(0, 16).replace("T", " ");
    const logId = `CT-${Date.now()}`;
    const checkedByFull = `${CURRENT_USER} (${role}), ${dateStr}, ${timeStr}`;

    setRecords((curr) => [
      {
        id: logId,
        batch: qcBatchNo || qcTarget.id,
        item: qcTarget.outputItemName ?? qcTarget.bom,
        cookingTime: "—",
        standardTemp: `≥${qcTemp}°C`,
        standardTempMin: qcTemp,
        measuredTemp: qcMeasured,
        cookedBy: qcCookedBy || "Kitchen Staff",
        sensoryPass: passed,
        checkedBy: checkedByFull,
        date: now.toISOString().slice(0, 10),
        failReason: passed ? undefined : effectiveFailReason,
        taste: tasteNote || undefined,
        thresholdTemp: qcThreshold,
        checkedAt: stamp,
      } as T,
      ...curr,
    ]);

    if (passed) {
      updateProductionEntryStatus(qcTarget.id, "Completed", {
        qcLogId: logId,
        qcPassedAt: stamp,
        qcCheckedBy: `${CURRENT_USER} (${role})`,
        completedAt: stamp,
        inventoryAdded: true,
      });
      applyStockDeltas([{
        itemId: qcTarget.outputItemCode ?? qcTarget.outputItemName ?? qcTarget.id,
        delta: qcTarget.producedQty,
        date: qcTarget.date,
        reference: qcTarget.id,
        officeId: qcTarget.officeId,
        warehouseId: qcTarget.warehouseId,
        label: "Production",
      }]);
      toast.success(`${qcTarget.id} passed QC — ${qcTarget.producedQty.toLocaleString()} units added to inventory.`);
    } else {
      updateProductionEntryStatus(qcTarget.id, "Re-Cook", {
        qcFailedAt: stamp,
        qcFailedBy: `${CURRENT_USER} (${role})`,
        qcFailReason: failReason.trim(),
      });
      toast.error(`${qcTarget.id} failed sensory check — sent to Re-Cook.`);
    }
    setQcOpen(false);
    setRecookConfirmOpen(false);
    setFailReason("");
  };

  // Open the combined "Record Test — All" form, seeding one empty input row per
  // pending batch (measured °C + chef), mirroring the single Record Test inputs.
  const openQcAll = () => {
    const seed: Record<string, { measured: number | ""; cookedBy: string }> = {};
    pendingQC.forEach((e) => { seed[e.id] = { measured: "", cookedBy: "" }; });
    setQcAllRows(seed);
    setQcAllOpen(true);
  };

  // Standard temp resolved for an entry (saved config, else HACCP default 75°C).
  const stdTempFor = (entry: WfProductionEntry) =>
    itemConfigs[entry.outputItemName ?? entry.bom]?.standardTemp ?? 75;

  // Bulk: record a QC test for EVERY pending-QC batch from the per-row inputs.
  // Each batch is judged against its standard like the single test — passing
  // batches are Completed and their qty added to inventory; batches measuring
  // below standard are sent back to In Preparation with a HACCP reason.
  const recordAllQc = () => {
    if (pendingQC.length === 0) return;
    // Validate every row has a measured temp and a chef (same rules as single).
    for (const entry of pendingQC) {
      const row = qcAllRows[entry.id];
      if (!row || row.measured === "" || isNaN(Number(row.measured))) {
        toast.error(`Enter measured °C for ${entry.id}.`); return;
      }
      if (!row.cookedBy) { toast.error(`Select who cooked ${entry.id}.`); return; }
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB");
    const timeStr = now.toLocaleTimeString("en-GB");
    const stamp = now.toISOString().slice(0, 16).replace("T", " ");
    const checkedByFull = `${CURRENT_USER} (${role}), ${dateStr}, ${timeStr}`;
    const base = Date.now();
    const newRecords: T[] = [];
    const deltas: Parameters<typeof applyStockDeltas>[0] = [];
    let passCount = 0, failCount = 0, units = 0;

    pendingQC.forEach((entry, i) => {
      const itemName = entry.outputItemName ?? entry.bom;
      const stdTemp = stdTempFor(entry);
      const row = qcAllRows[entry.id];
      const measured = Number(row.measured);
      const passed = measured >= stdTemp;
      const logId = `CT-${base + i}`;
      newRecords.push({
        id: logId,
        batch: entry.id,
        item: itemName,
        cookingTime: "—",
        standardTemp: `≥${stdTemp}°C`,
        standardTempMin: stdTemp,
        measuredTemp: measured,
        cookedBy: row.cookedBy,
        sensoryPass: passed,
        checkedBy: checkedByFull,
        date: now.toISOString().slice(0, 10),
        failReason: passed ? undefined : `Measured ${measured}°C below HACCP standard of ≥${stdTemp}°C.`,
        checkedAt: stamp,
      } as T);
      if (passed) {
        updateProductionEntryStatus(entry.id, "Completed", {
          qcLogId: logId,
          qcPassedAt: stamp,
          qcCheckedBy: `${CURRENT_USER} (${role})`,
          completedAt: stamp,
          inventoryAdded: true,
        });
        deltas.push({
          itemId: entry.outputItemCode ?? entry.outputItemName ?? entry.id,
          delta: entry.producedQty,
          date: entry.date,
          reference: entry.id,
          officeId: entry.officeId,
          warehouseId: entry.warehouseId,
          label: "Production",
        });
        passCount += 1;
        units += entry.producedQty;
      } else {
        updateProductionEntryStatus(entry.id, "In Preparation");
        failCount += 1;
      }
    });

    setRecords((curr) => [...newRecords, ...curr]);
    if (deltas.length) applyStockDeltas(deltas);
    setQcAllOpen(false);
    if (passCount && failCount) {
      toast.success(`${passCount} passed (${units.toLocaleString()} units to inventory) · ${failCount} sent back.`);
    } else if (failCount) {
      toast.error(`${failCount} batch${failCount === 1 ? "" : "es"} below standard — sent back to In Preparation.`);
    } else {
      toast.success(`${passCount} batch${passCount === 1 ? "" : "es"} passed QC — ${units.toLocaleString()} units added to inventory.`);
    }
  };

  const saveItemConfig = () => {
    if (!newRecordItem) { toast.error("Please select a food item."); return; }
    if (newRecordStandardTemp === "" || isNaN(Number(newRecordStandardTemp))) { toast.error("Please enter a standard temperature."); return; }
    if (newRecordThresholdTemp === "" || isNaN(Number(newRecordThresholdTemp))) { toast.error("Please enter a threshold temperature."); return; }
    if (Number(newRecordThresholdTemp) <= Number(newRecordStandardTemp)) {
      toast.error("Threshold temperature must be higher than the standard temperature."); return;
    }
    setItemConfigs(prev => ({
      ...prev,
      [newRecordItem]: { standardTemp: Number(newRecordStandardTemp), thresholdTemp: Number(newRecordThresholdTemp) },
    }));
    setNewRecordOpen(false);
    setNewRecordItem("");
    setNewRecordStandardTemp("");
    setNewRecordThresholdTemp("");
    setCustomItemMode(false);
    toast.success(`Configuration saved for ${newRecordItem}.`);
  };

  const openMobileQc = (entry: WfProductionEntry) => {
    const itemName = entry.outputItemName ?? entry.bom;
    const config = itemConfigs[itemName];
    setQcTarget(entry);
    setQcTemp(config?.standardTemp ?? 75);
    setQcThreshold(config?.thresholdTemp ?? (config?.standardTemp ?? 75) + 20);
    setQcMeasured(0);
    setQcCookedBy("");
    setQcBatchNo(entry.id);
    setMFailReason("");
    setMScreen(2);
  };

  const mobileSignOff = (passed: boolean) => {
    if (!qcTarget) return;
    const reason = mFailReason.trim();
    if (!passed && !reason) { toast.error("Please enter a rejection reason."); return; }
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB");
    const timeStr = now.toLocaleTimeString("en-GB");
    const stamp = now.toISOString().slice(0, 16).replace("T", " ");
    const logId = `CT-${Date.now()}`;
    const checkedByFull = `${CURRENT_USER} (${role}), ${dateStr}, ${timeStr}`;
    setRecords(curr => [{
      id: logId,
      batch: qcBatchNo || qcTarget.id,
      item: qcTarget.outputItemName ?? qcTarget.bom,
      cookingTime: "—",
      standardTemp: `≥${qcTemp}°C`,
      standardTempMin: qcTemp,
      measuredTemp: qcMeasured,
      cookedBy: qcCookedBy || "Kitchen Staff",
      sensoryPass: passed,
      checkedBy: checkedByFull,
      date: now.toISOString().slice(0, 10),
      failReason: passed ? undefined : reason,
      checkedAt: stamp,
    } as T, ...curr]);
    if (passed) {
      updateProductionEntryStatus(qcTarget.id, "Completed", {
        qcLogId: logId, qcPassedAt: stamp,
        qcCheckedBy: `${CURRENT_USER} (${role})`,
        completedAt: stamp, inventoryAdded: true,
      });
      applyStockDeltas([{
        itemId: qcTarget.outputItemCode ?? qcTarget.outputItemName ?? qcTarget.id,
        delta: qcTarget.producedQty,
        date: qcTarget.date,
        reference: qcTarget.id,
        officeId: qcTarget.officeId,
        warehouseId: qcTarget.warehouseId,
        label: "Production",
      }]);
      toast.success(`${qcTarget.id} passed QC — added to inventory.`);
    } else {
      updateProductionEntryStatus(qcTarget.id, "In Preparation");
      toast.error(`${qcTarget.id} failed — sent back to In Preparation.`);
    }
    setMResult(passed ? "pass" : "fail");
    setMScreen(4);
  };

  const cols: Column<T>[] = [
    { key: "id", header: "Log #" },
    { key: "batch", header: "Batch No." },
    { key: "item", header: "Item" },
    { key: "cookingTime", header: "Cooking Time" },
    { key: "standardTemp", header: "Standard °C" },
    { key: "measuredTemp", header: "Measured °C", render: (r) => (
      <span className={r.measuredTemp >= r.standardTempMin ? "text-success font-medium" : "text-destructive font-medium"}>
        {r.measuredTemp}°C
      </span>
    ) },
    { key: "sensoryPass", header: "Sensory", render: (r) => (
      // Sensory reflects the temperature / HACCP result (Pass when at/above standard).
      <StatusBadge status={r.measuredTemp >= r.standardTempMin ? "Pass" : "Fail"} />
    ) },
    { key: "taste", header: "Taste", render: (r) => {
      // A batch that met temperature but was still sent back failed on taste.
      const tasteFailed = !r.sensoryPass && r.measuredTemp >= r.standardTempMin;
      if (tasteFailed) {
        return <StatusBadge status="Fail" />;
      }
      return r.taste
        ? <span className="text-xs">{r.taste}</span>
        : <span className="text-muted-foreground text-xs">—</span>;
    } },
    { key: "cookedBy", header: "Cooked By" },
    { key: "checkedBy", header: "Checked By (Sup-Hygiene)" },
    { key: "status", header: "Status", render: (r) => (
      // Overall result — Passed only when both temperature and taste passed.
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${r.sensoryPass ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}>
        {r.sensoryPass ? "Passed" : "Failed"}
      </span>
    ) },
  ];

  const uniqueItems = Array.from(new Set(records.map(r => r.item))).sort();
  const uniqueDates = Array.from(new Set(records.map(r => r.date))).sort().reverse();

  const filteredRecords = records.filter(r => {
    if (filterDate && r.date !== filterDate) return false;
    if (filterSensory === "Pass" && !r.sensoryPass) return false;
    if (filterSensory === "Fail" && r.sensoryPass) return false;
    if (filterItem && r.item !== filterItem) return false;
    return true;
  });

  const passCount = records.filter((l) => l.sensoryPass).length;
  const passRate = records.length > 0 ? Math.round((passCount / records.length) * 100) : 0;
  const avgTemp = records.length > 0 ? Math.round(records.reduce((a, b) => a + b.measuredTemp, 0) / records.length) : 0;
  const failCount = records.filter((l) => !l.sensoryPass).length;

  return (
    <>
      <PageHeader
        title="Cooking Temperature & Sensory Test Record"
        subtitle="HACCP — verify cooking temperature, doneness & sensory acceptance per batch"
        actions={
          <Dialog open={newRecordOpen} onOpenChange={setNewRecordOpen}>
            <DialogTrigger asChild>
              <Button><Settings2 className="h-4 w-4 mr-1.5" /> HACCP Standard Configuration</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>HACCP Standard Configuration</DialogTitle>
                <DialogDescription>
                  Set the minimum safe cooking temperature and chef assignment per food item. These auto-fill when recording QC tests from pending batches.
                </DialogDescription>
              </DialogHeader>

              {/* Add item form */}
              <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add / Update Item</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      setCustomItemMode((m) => !m);
                      setNewRecordItem("");
                      setNewRecordStandardTemp("");
                      setNewRecordThresholdTemp("");
                    }}
                  >
                    <Plus className="h-3 w-3 mr-1" /> {customItemMode ? "From List" : "Add New"}
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Item</Label>
                    {customItemMode ? (
                      <Input
                        value={newRecordItem}
                        onChange={(e) => setNewRecordItem(e.target.value)}
                        placeholder="New item name"
                        className="mt-1"
                      />
                    ) : (
                      <select
                        value={newRecordItem}
                        onChange={(e) => {
                          const item = e.target.value;
                          setNewRecordItem(item);
                          if (itemConfigs[item]) {
                            setNewRecordStandardTemp(itemConfigs[item].standardTemp);
                            setNewRecordThresholdTemp(itemConfigs[item].thresholdTemp);
                          } else {
                            setNewRecordStandardTemp("");
                            setNewRecordThresholdTemp("");
                          }
                        }}
                        className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="">— Select item —</option>
                        {FOOD_ITEMS.map(item => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs">Standard Temp (°C)</Label>
                    <Input
                      type="number"
                      value={newRecordStandardTemp}
                      onChange={(e) => setNewRecordStandardTemp(Number(e.target.value))}
                      placeholder="min e.g. 75"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Threshold Temp (°C)</Label>
                    <Input
                      type="number"
                      value={newRecordThresholdTemp}
                      onChange={(e) => setNewRecordThresholdTemp(Number(e.target.value))}
                      placeholder="max e.g. 95"
                      className={`mt-1 ${newRecordThresholdTemp !== "" && newRecordStandardTemp !== "" && Number(newRecordThresholdTemp) <= Number(newRecordStandardTemp) ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
                  Ref: HACCP minimum internal temperatures — 75°C poultry, 63°C beef/pork, 70°C fish, 82°C reheated foods. The <span className="font-semibold">threshold</span> is the maximum sensible reading — a measured temp must fall within <span className="font-semibold">standard → threshold</span>.
                </p>
                <div className="flex justify-end">
                  <Button size="sm" onClick={saveItemConfig}><Plus className="h-3.5 w-3.5 mr-1" /> Add to List</Button>
                </div>
              </div>

              {/* Saved configs table */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Saved Standards</p>
                {Object.keys(itemConfigs).length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-md">
                    No items configured yet. Add one above.
                  </div>
                ) : (
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40 border-b border-border">
                          <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Item</th>
                          <th className="text-center px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Standard Temp</th>
                          <th className="text-center px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Threshold Temp</th>
                          <th className="text-center px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(itemConfigs).map(([item, cfg], idx) => (
                          <tr key={item} className={idx % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                            <td className="px-3 py-2 font-medium">{item}</td>
                            <td className="px-3 py-2 text-center tabular-nums">≥{cfg.standardTemp}°C</td>
                            <td className="px-3 py-2 text-center tabular-nums">≤{cfg.thresholdTemp}°C</td>
                            <td className="px-3 py-2 text-center">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setViewConfigItem(item)}
                                  className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                                  title={`View ${item}`}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = { ...itemConfigs };
                                    delete updated[item];
                                    setItemConfigs(updated);
                                    toast.success(`Removed configuration for ${item}.`);
                                  }}
                                  className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                  title={`Remove ${item}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setNewRecordOpen(false)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* HACCP Standard — per-item detail view */}
      {viewConfigItem && itemConfigs[viewConfigItem] && (
        <Dialog open onOpenChange={(o) => { if (!o) setViewConfigItem(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>HACCP Standard — {viewConfigItem}</DialogTitle>
              <DialogDescription>Configured cooking-temperature range for this food item.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1 text-sm">
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Item</div>
                <div className="font-medium">{viewConfigItem}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Standard (min)</div>
                  <div className="text-xl font-bold tabular-nums text-emerald-700">≥{itemConfigs[viewConfigItem].standardTemp}°C</div>
                  <div className="text-[10px] text-muted-foreground">HACCP minimum safe</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Threshold (max)</div>
                  <div className="text-xl font-bold tabular-nums text-amber-700">≤{itemConfigs[viewConfigItem].thresholdTemp}°C</div>
                  <div className="text-[10px] text-muted-foreground">Maximum sensible</div>
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Acceptable Range</div>
                <div className="text-sm font-medium tabular-nums">{itemConfigs[viewConfigItem].standardTemp}°C – {itemConfigs[viewConfigItem].thresholdTemp}°C</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">A measured reading outside this range is flagged as illogical.</div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewConfigItem(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Tests Today" value={records.length} icon={ClipboardCheck} tone="navy" />
        <KpiCard label="Pass Rate" value={`${passRate}%`} icon={ShieldCheck} tone="success" />
        <KpiCard label="Avg Core Temp" value={`${avgTemp}°C`} icon={ThermometerSun} tone="warning" />
        <KpiCard label="Failed" value={failCount} icon={AlertOctagon} tone="red" />
      </div>

      <Card className="brand-accent-border-left mb-6">
        <CardContent className="pt-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider inline-flex items-center gap-2">
                <Factory className="h-4 w-4 text-primary" /> Batches Pending QC
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Production entries at <span className="font-medium">Ready for QC</span> — record the test and sign off.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={openQcAll}
                disabled={pendingQC.length === 0}
                title="Record a QC test for every pending batch in one combined form"
              >
                <ClipboardCheck className="h-4 w-4 mr-1.5" /> Record Test — All ({pendingQC.length})
              </Button>
              <Badge variant="outline" className="bg-warning/15 text-warning-foreground border-warning/40">
                {pendingQC.length} pending
              </Badge>
            </div>
          </div>

          {pendingQC.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-6">
              No batches awaiting QC sign-off. All caught up.
            </div>
          ) : (
            <div className="space-y-2">
              {pendingQC.map((p) => {
                const std = stdTempFor(p);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-3 hover:bg-muted/30 transition-colors flex-wrap"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Factory className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold truncate">{p.outputItemName ?? p.bom}</span>
                          <Badge variant="outline" className="text-[10px] font-normal tabular-nums">
                            × {p.producedQty.toLocaleString()}
                          </Badge>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
                          <span className="font-mono">{p.id}</span>
                          <span className="text-border">·</span>
                          <span>{p.bom}</span>
                          <span className="text-border">·</span>
                          <span>Produced {p.date}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="hidden sm:flex flex-col items-end leading-tight">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Standard</span>
                        <span className="text-sm font-semibold tabular-nums">≥{std}°C</span>
                      </div>
                      <Button size="sm" onClick={() => openQc(p)}>
                        <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" /> Record Test
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk record-test — combined per-batch input form */}
      <Dialog open={qcAllOpen} onOpenChange={setQcAllOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" /> Record Test — All Pending QC
            </DialogTitle>
            <DialogDescription>
              Enter measured temperature and the chef for each batch, same as a single Record Test.
              Batches meeting their standard are completed and added to inventory; any measuring below
              standard are sent back to In Preparation.
            </DialogDescription>
          </DialogHeader>

          {/* Apply chef to all — convenience for one cook covering the batch run */}
          <div className="flex items-center gap-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground shrink-0">Cooked by — apply to all</Label>
            <select
              value=""
              onChange={(e) => {
                const chef = e.target.value;
                if (!chef) return;
                setQcAllRows((prev) => {
                  const next = { ...prev };
                  pendingQC.forEach((p) => { next[p.id] = { ...next[p.id], cookedBy: chef }; });
                  return next;
                });
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">— Select chef —</option>
              {CHEFS.map((chef) => (<option key={chef} value={chef}>{chef}</option>))}
            </select>
          </div>

          {/* Per-batch input table */}
          <div className="rounded-md border border-border overflow-hidden">
            <div className="grid grid-cols-[1.6fr_0.7fr_0.7fr_0.9fr_1.1fr_0.6fr] gap-2 bg-muted/40 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <div>Batch / Item</div>
              <div className="text-right">Qty</div>
              <div className="text-center">Std °C</div>
              <div className="text-center">Measured °C</div>
              <div>Cooked By</div>
              <div className="text-center">Result</div>
            </div>
            <div className="divide-y divide-border max-h-[44vh] overflow-y-auto">
              {pendingQC.map((entry) => {
                const std = stdTempFor(entry);
                const row = qcAllRows[entry.id] ?? { measured: "", cookedBy: "" };
                const hasMeasured = row.measured !== "" && !isNaN(Number(row.measured));
                const passed = hasMeasured && Number(row.measured) >= std;
                return (
                  <div key={entry.id} className="grid grid-cols-[1.6fr_0.7fr_0.7fr_0.9fr_1.1fr_0.6fr] gap-2 px-3 py-2 items-center text-sm">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-primary truncate">{entry.id}</div>
                      <div className="text-xs text-muted-foreground truncate">{entry.outputItemName ?? entry.bom}</div>
                    </div>
                    <div className="text-right tabular-nums">{entry.producedQty.toLocaleString()}</div>
                    <div className="text-center tabular-nums text-muted-foreground">≥{std}</div>
                    <div>
                      <Input
                        type="number"
                        value={row.measured}
                        onChange={(e) => {
                          const v = e.target.value;
                          setQcAllRows((prev) => ({ ...prev, [entry.id]: { ...row, measured: v === "" ? "" : Number(v) } }));
                        }}
                        className="h-8 tabular-nums text-center"
                        placeholder="°C"
                      />
                    </div>
                    <div>
                      <select
                        value={row.cookedBy}
                        onChange={(e) => setQcAllRows((prev) => ({ ...prev, [entry.id]: { ...row, cookedBy: e.target.value } }))}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="">— Chef —</option>
                        {CHEFS.map((chef) => (<option key={chef} value={chef}>{chef}</option>))}
                      </select>
                    </div>
                    <div className="text-center">
                      {!hasMeasured ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Badge variant="outline" className={passed
                          ? "bg-success/15 text-success border-success/40"
                          : "bg-destructive/15 text-destructive border-destructive/40"}>
                          {passed ? "Pass" : "Fail"}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live summary of what the current inputs will do */}
          {(() => {
            let willPass = 0, willFail = 0, unitsIn = 0;
            pendingQC.forEach((entry) => {
              const row = qcAllRows[entry.id];
              if (!row || row.measured === "" || isNaN(Number(row.measured))) return;
              if (Number(row.measured) >= stdTempFor(entry)) { willPass += 1; unitsIn += entry.producedQty; }
              else willFail += 1;
            });
            return (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs flex flex-wrap gap-x-6 gap-y-1">
                <span className="text-muted-foreground">Batches: <span className="font-semibold text-foreground tabular-nums">{pendingQC.length}</span></span>
                <span className="text-success">Will pass: <span className="font-semibold tabular-nums">{willPass}</span></span>
                <span className="text-destructive">Will fail: <span className="font-semibold tabular-nums">{willFail}</span></span>
                <span className="text-muted-foreground">Units to inventory: <span className="font-semibold text-foreground tabular-nums">{unitsIn.toLocaleString()}</span></span>
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => setQcAllOpen(false)}>Cancel</Button>
            <Button onClick={recordAllQc} disabled={pendingQC.length === 0}>
              <ClipboardCheck className="h-4 w-4 mr-1.5" /> Record {pendingQC.length} {pendingQC.length === 1 ? "Batch" : "Batches"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</label>
          <select
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">All</option>
            {uniqueDates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sensory Filter</label>
          <select
            value={filterSensory}
            onChange={e => setFilterSensory(e.target.value as "" | "Pass" | "Fail")}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">All</option>
            <option value="Pass">Pass</option>
            <option value="Fail">Fail</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item</label>
          <select
            value={filterItem}
            onChange={e => setFilterItem(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">All</option>
            {uniqueItems.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
      </div>

      <div data-arrival-id="qc-issues">
        <DataTable
          title="cooking-temp"
          data={filteredRecords}
          columns={cols}
          selectable={false}
          searchKeys={["id", "batch", "item", "cookedBy", "checkedBy"]}
          actions={(row) => (
            <Button size="sm" variant="outline" onClick={() => setViewRecord(row)}>
              <Eye className="h-3.5 w-3.5 mr-1" /> View
            </Button>
          )}
        />
      </div>

      {/* View Record Dialog */}
      {viewRecord && (
        <Dialog open onOpenChange={(open) => { if (!open) setViewRecord(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Test Record — {viewRecord.id}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Batch No.</div>
                  <div className="font-medium">{viewRecord.batch}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Item</div>
                  <div className="font-medium">{viewRecord.item}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Cooking Time</div>
                  <div>{viewRecord.cookingTime}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Standard Temp</div>
                  <div>{viewRecord.standardTemp}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Threshold Temp</div>
                  <div className="tabular-nums">{viewRecord.thresholdTemp != null ? `≤${viewRecord.thresholdTemp}°C` : "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Measured Temp</div>
                  <div className={viewRecord.measuredTemp >= viewRecord.standardTempMin ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                    {viewRecord.measuredTemp}°C
                  </div>
                  {viewRecord.thresholdTemp != null && (
                    <div className={`text-[10px] mt-0.5 font-medium ${viewRecord.measuredTemp > viewRecord.thresholdTemp ? "text-red-600" : "text-muted-foreground"}`}>
                      {viewRecord.measuredTemp > viewRecord.thresholdTemp
                        ? `${viewRecord.measuredTemp - viewRecord.thresholdTemp}°C above threshold`
                        : `${viewRecord.thresholdTemp - viewRecord.measuredTemp}°C below threshold`}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Sensory Result</div>
                  <StatusBadge status={viewRecord.measuredTemp >= viewRecord.standardTempMin ? "Pass" : "Fail"} />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Taste</div>
                  {!viewRecord.sensoryPass && viewRecord.measuredTemp >= viewRecord.standardTempMin ? (
                    <StatusBadge status="Fail" />
                  ) : (
                    <div className={viewRecord.taste ? "font-medium" : "text-muted-foreground"}>{viewRecord.taste || "—"}</div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Status</div>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${viewRecord.sensoryPass ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}>
                    {viewRecord.sensoryPass ? "Passed" : "Failed"}
                  </span>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Cooked By</div>
                  <div>{viewRecord.cookedBy}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Date</div>
                  <div>{viewRecord.date}</div>
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Checked By — Name · Date · Time</div>
                <div className="text-sm">{viewRecord.checkedBy}</div>
              </div>
              {viewRecord.failReason && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-destructive mb-0.5">Rejection Reason</div>
                  <div className="text-sm text-destructive/90">{viewRecord.failReason}</div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewRecord(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* QC Record Test Dialog */}
      <Dialog
        open={qcOpen}
        onOpenChange={(open) => {
          if (!open) { setQcOpen(false); setRecookConfirmOpen(false); setFailReason(""); }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Test — {qcTarget?.id}</DialogTitle>
            <DialogDescription>
              Item and standard temperature are auto-filled from saved configuration. Enter batch number, measured temperature, and the chef who cooked this batch.
            </DialogDescription>
          </DialogHeader>

          {qcTarget && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="font-semibold">{qcTarget.outputItemName ?? qcTarget.bom}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                BOM: {qcTarget.bom} · Qty: <span className="font-medium tabular-nums">{qcTarget.producedQty.toLocaleString()}</span>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {/* Auto-filled fields */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Item</div>
                <div className="text-sm font-medium truncate">{qcTarget?.outputItemName ?? qcTarget?.bom ?? "—"}</div>
              </div>
              <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Standard °C</div>
                <div className="text-sm font-medium tabular-nums">≥{qcTemp}°C</div>
              </div>
              <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Threshold °C</div>
                <div className="text-sm font-medium tabular-nums">≤{qcThreshold}°C</div>
              </div>
            </div>

            {/* User inputs */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Batch No <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={qcBatchNo}
                  readOnly
                  tabIndex={-1}
                  className="mt-1 tabular-nums bg-muted/50 cursor-not-allowed"
                  placeholder="Batch number"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Measured °C <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  value={qcMeasured}
                  onChange={(e) => setQcMeasured(Number(e.target.value))}
                  className={`mt-1 tabular-nums ${qcMeasured > 0 && qcMeasured < qcTemp ? "border-destructive focus-visible:ring-destructive" : ""}`}
                />
                {qcMeasured > 0 && (
                  <p className={`text-[10px] mt-0.5 font-medium ${qcMeasured >= qcTemp ? "text-green-600" : "text-destructive"}`}>
                    {qcMeasured >= qcTemp
                      ? `✓ ${qcMeasured - qcTemp}°C above standard`
                      : `✗ ${qcTemp - qcMeasured}°C below standard`}
                  </p>
                )}
                {qcMeasured > 0 && (
                  <p className={`text-[10px] mt-0.5 font-medium ${qcMeasured > qcThreshold ? "text-destructive" : "text-muted-foreground"}`}>
                    {qcMeasured > qcThreshold
                      ? `⚠ ${qcMeasured - qcThreshold}°C above threshold (≤${qcThreshold}°C)`
                      : `${qcThreshold - qcMeasured}°C below threshold (≤${qcThreshold}°C)`}
                  </p>
                )}
              </div>
              {/* Temperature justification — appears right below Measured °C when
                  the reading is below the HACCP standard. */}
              {qcMeasured > 0 && qcMeasured < qcTemp && (
                <div className="col-span-2">
                  <Label className="text-xs uppercase tracking-wider text-destructive">
                    Justification — temp below HACCP standard <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    value={failReason}
                    onChange={(e) => setFailReason(e.target.value)}
                    placeholder="Explain why the temperature is below standard (e.g. sensor issue, re-heat required)..."
                    className="mt-1 resize-none border-destructive/40 focus-visible:ring-destructive/40"
                    rows={3}
                  />
                </div>
              )}
              {/* Taste — optional sensory QC parameter, independent of temperature.
                  Disabled when the temperature test fails (batch is sent back anyway). */}
              <div className="col-span-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Taste
                </Label>
                <select
                  value={qcTaste}
                  onChange={(e) => setQcTaste(e.target.value as typeof qcTaste)}
                  disabled={qcMeasured > 0 && qcMeasured < qcTemp}
                  className={`mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed ${qcTaste === "Not Good" ? "border-destructive focus-visible:ring-destructive" : "border-input"}`}
                >
                  <option value="">— Select taste result —</option>
                  <option value="Good">Good</option>
                  <option value="Average">Average</option>
                  <option value="Not Good">Not Good (off-taste)</option>
                  <option value="Other">Other</option>
                </select>
                {qcTaste === "Other" && !(qcMeasured > 0 && qcMeasured < qcTemp) ? (
                  <Input
                    value={qcTasteOther}
                    onChange={(e) => setQcTasteOther(e.target.value)}
                    placeholder="Specify the taste / sensory observation…"
                    className="mt-2"
                  />
                ) : qcTaste && !(qcMeasured > 0 && qcMeasured < qcTemp) ? (
                  <p className={`text-[10px] mt-0.5 font-medium ${qcTaste === "Not Good" ? "text-destructive" : "text-green-600"}`}>
                    {qcTaste === "Not Good" ? "✗ Off-taste — send back if required" : `✓ Taste acceptable (${qcTaste})`}
                  </p>
                ) : null}
              </div>
              {/* Cooked By */}
              <div className="col-span-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Cooked By <span className="text-destructive">*</span>
                </Label>
                <select
                  value={qcCookedBy}
                  onChange={(e) => setQcCookedBy(e.target.value)}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">— Select chef —</option>
                  {CHEFS.map((chef) => (
                    <option key={chef} value={chef}>{chef}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setQcOpen(false)}>Cancel</Button>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => {
                if (!qcCookedBy) { toast.error("Please select who cooked this batch."); return; }
                if (qcMeasured > 0 && qcMeasured < qcTemp && !failReason.trim()) {
                  toast.error("Justification is required when temperature is below standard."); return;
                }
                if (qcTaste === "Other" && !qcTasteOther.trim()) { toast.error("Please specify the taste observation."); return; }
                setRecookConfirmOpen(true);
              }}
            >
              <XIcon className="h-4 w-4 mr-1.5" /> Fail (Send Back)
            </Button>
            <Button
              className="bg-success text-success-foreground hover:bg-success/90"
              onClick={() => {
                if (qcTaste === "Other" && !qcTasteOther.trim()) { toast.error("Please specify the taste observation."); return; }
                signOff(true);
              }}
              disabled={qcMeasured > 0 && qcMeasured < qcTemp}
            >
              <Check className="h-4 w-4 mr-1.5" /> Pass and Complete
              <PackageCheck className="h-4 w-4 ml-1.5" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Re-Cook Confirmation Dialog */}
      <Dialog open={recookConfirmOpen} onOpenChange={setRecookConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Confirm — Send to Re-Cook</DialogTitle>
            <DialogDescription>
              This batch will be returned for re-cooking. The sensory test log will be saved with your sign-off.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {qcTarget && (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Batch</div>
                <div className="font-semibold">{qcTarget.outputItemName ?? qcTarget.bom}</div>
                <div className="text-xs text-muted-foreground font-mono">{qcTarget.id}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-center">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Standard</div>
                <div className="text-xl font-bold tabular-nums">≥{qcTemp}°C</div>
                <div className="text-[10px] text-muted-foreground">HACCP minimum</div>
              </div>
              {/* Temp card reflects the actual reading — red only when it truly failed. */}
              <div className={`rounded-md border px-3 py-2.5 text-center ${qcMeasured > 0 && qcMeasured < qcTemp ? "border-destructive/40 bg-destructive/10" : "border-emerald-300 bg-emerald-50"}`}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Measured</div>
                <div className={`text-xl font-bold tabular-nums ${qcMeasured > 0 && qcMeasured < qcTemp ? "text-destructive" : "text-emerald-700"}`}>{qcMeasured}°C</div>
                <div className={`text-[10px] font-medium ${qcMeasured > 0 && qcMeasured < qcTemp ? "text-destructive" : "text-emerald-600"}`}>
                  {qcMeasured > 0 && qcMeasured < qcTemp
                    ? `${qcTemp - qcMeasured}°C below standard`
                    : qcMeasured >= qcTemp ? `Meets standard (+${qcMeasured - qcTemp}°C)` : "Temperature accepted"}
                </div>
              </div>
            </div>
            {/* Temperature is acceptable — this re-cook is driven by the sensory/taste result. */}
            {!(qcMeasured > 0 && qcMeasured < qcTemp) && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Sensory / Taste — reason for re-cook</div>
                <div className="text-sm font-semibold text-destructive">
                  {qcTaste === "Other" ? (qcTasteOther.trim() || "Other") : (qcTaste || "Not acceptable")}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Temperature met the HACCP standard; the batch is being returned for taste / sensory quality.
                </div>
              </div>
            )}
            {failReason && (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Justification</div>
                <div className="text-sm">{failReason}</div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRecookConfirmOpen(false)}>Cancel</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => signOff(false)}
            >
              <XIcon className="h-4 w-4 mr-1.5" /> Send to Re-Cook
            </Button>
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
              <span className="text-white text-xs font-medium">QC Record</span>
              <button onClick={() => setMobileOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            {/* App header */}
            <div className="bg-blue-700 px-4 py-3 shrink-0">
              <p className="text-white font-bold text-sm">Cooking Temp & Sensory</p>
              <p className="text-blue-200 text-[10px] mt-0.5">HACCP Quality Control</p>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto bg-slate-50">

              {/* QC TAB */}
              {mMobileTab === "qc" && (
                <>
                  {/* Screen 1 — Pending Batches */}
                  {mScreen === 1 && (
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
                          <button
                            key={p.id}
                            onClick={() => openMobileQc(p)}
                            className="w-full text-left px-3 py-2.5 rounded-xl border-2 border-slate-200 bg-white hover:border-blue-300 transition-all"
                          >
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

                  {/* Screen 2 — Record Test */}
                  {mScreen === 2 && qcTarget && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-2 mb-1">
                        <button
                          onClick={() => setMScreen(1)}
                          className="h-7 w-7 flex items-center justify-center rounded-full bg-slate-200 hover:bg-slate-300 transition-colors"
                        >
                          <ChevronLeft className="h-4 w-4 text-slate-600" />
                        </button>
                        <div>
                          <p className="font-bold text-slate-800 text-sm">Record Test</p>
                          <p className="text-[10px] text-slate-400">{qcTarget.id}</p>
                        </div>
                      </div>

                      <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 space-y-1.5">
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="text-slate-500">Item</span>
                          <span className="font-semibold text-slate-800 text-right max-w-[55%]">{qcTarget.outputItemName ?? qcTarget.bom}</span>
                        </div>
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="text-slate-500">Standard Temp</span>
                          <span className="font-bold text-blue-700">≥{qcTemp}°C</span>
                        </div>
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="text-slate-500">Quantity</span>
                          <span className="font-semibold text-slate-800">{qcTarget.producedQty.toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Batch No *</label>
                          <input
                            value={qcBatchNo}
                            readOnly
                            className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-slate-100 text-slate-600 cursor-not-allowed focus:outline-none"
                            placeholder="Batch number"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Measured Temp (°C) *</label>
                          <input
                            type="number"
                            value={qcMeasured}
                            onChange={e => setQcMeasured(Number(e.target.value))}
                            className={`mt-1 w-full border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 ${
                              qcMeasured > 0 && qcMeasured >= qcTemp
                                ? "border-green-400 focus:ring-green-400"
                                : qcMeasured > 0
                                ? "border-red-400 focus:ring-red-400"
                                : "border-slate-300 focus:ring-blue-400"
                            }`}
                          />
                          {qcMeasured > 0 && (
                            <p className={`text-[10px] mt-0.5 font-medium ${qcMeasured >= qcTemp ? "text-green-600" : "text-red-600"}`}>
                              {qcMeasured >= qcTemp
                                ? `✓ Above standard (+${qcMeasured - qcTemp}°C)`
                                : `✗ Below standard (${qcTemp - qcMeasured}°C short)`}
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Cooked By *</label>
                          <input
                            value={qcCookedBy}
                            onChange={e => setQcCookedBy(e.target.value)}
                            className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            placeholder="Chef / cook name"
                          />
                        </div>
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => setMScreen(3)}
                          className="flex-1 py-2.5 rounded-xl border-2 border-red-300 text-red-600 font-bold text-sm hover:bg-red-50 transition-colors"
                        >
                          ✗ Fail
                        </button>
                        <button
                          onClick={() => mobileSignOff(true)}
                          className="flex-[2] py-2.5 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 transition-colors"
                        >
                          ✓ Pass & Complete
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Screen 3 — Rejection Reason */}
                  {mScreen === 3 && qcTarget && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-2 mb-1">
                        <button
                          onClick={() => setMScreen(2)}
                          className="h-7 w-7 flex items-center justify-center rounded-full bg-slate-200 hover:bg-slate-300 transition-colors"
                        >
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
                        <div className={`rounded-xl border px-3 py-2.5 text-center ${
                          qcMeasured >= qcTemp ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"
                        }`}>
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Measured</p>
                          <p className={`text-xl font-bold ${qcMeasured >= qcTemp ? "text-green-700" : "text-red-700"}`}>{qcMeasured}°C</p>
                          <p className={`text-[9px] font-medium ${qcMeasured >= qcTemp ? "text-green-600" : "text-red-600"}`}>
                            {qcMeasured >= qcTemp ? `+${qcMeasured - qcTemp}°C` : `${qcTemp - qcMeasured}°C short`}
                          </p>
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Reason for Rejection *</label>
                        <textarea
                          value={mFailReason}
                          onChange={e => setMFailReason(e.target.value)}
                          rows={4}
                          placeholder="Describe why this batch is being sent back..."
                          className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                        />
                      </div>

                      <button
                        onClick={() => mobileSignOff(false)}
                        className="w-full py-3 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition-colors"
                      >
                        Confirm & Reject Batch
                      </button>
                    </div>
                  )}

                  {/* Screen 4 — Result */}
                  {mScreen === 4 && qcTarget && (
                    <div className="p-4 flex flex-col items-center text-center space-y-4 pt-8">
                      <div className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl ${
                        mResult === "pass" ? "bg-green-100" : "bg-red-100"
                      }`}>
                        {mResult === "pass" ? "✅" : "❌"}
                      </div>
                      <div>
                        <p className={`text-lg font-bold ${mResult === "pass" ? "text-green-700" : "text-red-700"}`}>
                          {mResult === "pass" ? "QC Passed!" : "Batch Rejected"}
                        </p>
                        <p className="text-[12px] text-slate-500 mt-1">
                          {mResult === "pass"
                            ? `${qcTarget.producedQty.toLocaleString()} units added to inventory`
                            : "Sent back to In Preparation"}
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
                              label === "Temp"
                                ? (mResult === "pass" ? "text-green-600" : "text-red-600")
                                : "text-slate-800"
                            }`}>{value}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => { setMScreen(1); setQcTarget(null); }}
                        className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors"
                      >
                        Back to Pending Batches
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* LOG TAB */}
              {mMobileTab === "log" && (
                <div className="p-4 space-y-3">
                  {mLogRecordId ? (() => {
                    const rec = records.find(r => r.id === mLogRecordId);
                    if (!rec) return null;
                    return (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          <button
                            onClick={() => setMLogRecordId(null)}
                            className="h-7 w-7 flex items-center justify-center rounded-full bg-slate-200 hover:bg-slate-300 transition-colors"
                          >
                            <ChevronLeft className="h-4 w-4 text-slate-600" />
                          </button>
                          <p className="font-bold text-slate-800 text-sm">Test Details</p>
                        </div>
                        <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                          {([
                            ["Log #", rec.id],
                            ["Batch No.", rec.batch],
                            ["Item", rec.item],
                            ["Standard Temp", rec.standardTemp],
                            ["Measured Temp", `${rec.measuredTemp}°C`],
                            ["Cooked By", rec.cookedBy],
                            ["Date", rec.date],
                          ] as [string, string][]).map(([label, value]) => (
                            <div key={label} className="flex items-center justify-between text-[12px]">
                              <span className="text-slate-500">{label}</span>
                              <span className={`font-semibold text-right max-w-[55%] ${
                                label === "Measured Temp"
                                  ? (rec.measuredTemp >= rec.standardTempMin ? "text-green-600" : "text-red-600")
                                  : "text-slate-800"
                              }`}>{value}</span>
                            </div>
                          ))}
                          <div className="flex items-center justify-between text-[12px]">
                            <span className="text-slate-500">Sensory</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                              rec.sensoryPass ? "bg-green-500 text-white" : "bg-red-500 text-white"
                            }`}>{rec.sensoryPass ? "Pass" : "Fail"}</span>
                          </div>
                        </div>
                        {rec.failReason && (
                          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                            <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-1">Rejection Reason</p>
                            <p className="text-[12px] text-red-700">{rec.failReason}</p>
                          </div>
                        )}
                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Checked By</p>
                          <p className="text-[12px] text-slate-700">{rec.checkedBy}</p>
                        </div>
                      </>
                    );
                  })() : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-slate-800 text-sm">QC Records</p>
                        <span className="text-[10px] text-slate-400">{records.length} total</span>
                      </div>
                      {records.length === 0 ? (
                        <div className="text-center py-8 text-[12px] text-slate-400">No QC records yet.</div>
                      ) : (
                        records.slice(0, 20).map(rec => (
                          <button
                            key={rec.id}
                            onClick={() => setMLogRecordId(rec.id)}
                            className="w-full text-left px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-blue-300 transition-all"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm text-slate-800">{rec.item}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                rec.sensoryPass ? "bg-green-500 text-white" : "bg-red-500 text-white"
                              }`}>{rec.sensoryPass ? "Pass" : "Fail"}</span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {rec.batch} · {rec.measuredTemp}°C / {rec.standardTemp} · {rec.date}
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
                onClick={() => { setMMobileTab("qc"); setMScreen(1); }}
                className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-colors ${
                  mMobileTab === "qc" ? "text-blue-600" : "text-slate-400"
                }`}
              >
                <ClipboardCheck className="h-4 w-4" /> QC
              </button>
              <button
                onClick={() => setMMobileTab("log")}
                className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-colors ${
                  mMobileTab === "log" ? "text-blue-600" : "text-slate-400"
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
