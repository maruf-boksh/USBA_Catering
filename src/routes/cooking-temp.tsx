import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, ThermometerSun, ShieldCheck, AlertOctagon, ClipboardCheck, Factory, Check, X as XIcon, PackageCheck, Eye, ChevronLeft, Trash2, Settings2, Smartphone, Clock } from "lucide-react";
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

type ItemConfig = { standardTemp: number };

type CookingRecord = (typeof cookingTempLogs)[number] & {
  date: string;
  failReason?: string;
  checkedAt?: string;
};
type T = CookingRecord;

export default function CookingTemp() {
  useArrivalFlash();
  const { role } = useRole();
  const { productionEntries, updateProductionEntryStatus, applyStockDeltas } = useWorkflow();
  const [records, setRecords] = useState<T[]>(
    cookingTempLogs.map(r => ({ ...r, date: "2026-05-22" }))
  );

  // Item configuration: item name → standard temp only
  const [itemConfigs, setItemConfigs] = useState<Record<string, ItemConfig>>({
    "Chicken Biryani": { standardTemp: 75 },
    "Veg Pulao": { standardTemp: 70 },
    "Grilled Salmon": { standardTemp: 63 },
    "Continental Breakfast": { standardTemp: 65 },
    "Hindu Meal Special": { standardTemp: 75 },
    "Heavy Snack Box": { standardTemp: 70 },
  });

  // HACCP config modal state
  const [newRecordOpen, setNewRecordOpen] = useState(false);
  const [newRecordItem, setNewRecordItem] = useState("");
  const [newRecordStandardTemp, setNewRecordStandardTemp] = useState<number | "">("");

  // Filters
  const [filterDate, setFilterDate] = useState("");
  const [filterSensory, setFilterSensory] = useState<"" | "Pass" | "Fail">("");
  const [filterItem, setFilterItem] = useState("");

  // View record dialog
  const [viewRecord, setViewRecord] = useState<T | null>(null);

  // QC sign-off dialog
  const [qcOpen, setQcOpen] = useState(false);
  const [qcTarget, setQcTarget] = useState<WfProductionEntry | null>(null);
  const [qcTemp, setQcTemp] = useState(75);
  const [qcMeasured, setQcMeasured] = useState(0);
  const [qcCookedBy, setQcCookedBy] = useState("");
  const [qcBatchNo, setQcBatchNo] = useState("");

  // Fail justification panel
  const [failJustOpen, setFailJustOpen] = useState(false);
  const [failReason, setFailReason] = useState("");

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
    setQcMeasured(0);
    setQcCookedBy("");
    setQcBatchNo(entry.id);
    setFailJustOpen(false);
    setFailReason("");
    setQcOpen(true);
  };

  const signOff = (passed: boolean) => {
    if (!qcTarget) return;
    if (!passed && !failReason.trim()) { toast.error("Please enter a reason for rejection."); return; }
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
        failReason: passed ? undefined : failReason.trim(),
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
      }]);
      toast.success(`${qcTarget.id} passed QC — ${qcTarget.producedQty.toLocaleString()} units added to inventory.`);
    } else {
      updateProductionEntryStatus(qcTarget.id, "In Preparation");
      toast.error(`${qcTarget.id} failed sensory check — sent back to In Preparation.`);
    }
    setQcOpen(false);
    setFailJustOpen(false);
    setFailReason("");
  };

  const saveItemConfig = () => {
    if (!newRecordItem) { toast.error("Please select a food item."); return; }
    if (newRecordStandardTemp === "" || isNaN(Number(newRecordStandardTemp))) { toast.error("Please enter a standard temperature."); return; }
    setItemConfigs(prev => ({
      ...prev,
      [newRecordItem]: { standardTemp: Number(newRecordStandardTemp) },
    }));
    setNewRecordOpen(false);
    setNewRecordItem("");
    setNewRecordStandardTemp("");
    toast.success(`Configuration saved for ${newRecordItem}.`);
  };

  const openMobileQc = (entry: WfProductionEntry) => {
    const itemName = entry.outputItemName ?? entry.bom;
    const config = itemConfigs[itemName];
    setQcTarget(entry);
    setQcTemp(config?.standardTemp ?? 75);
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
      applyStockDeltas([{ itemId: qcTarget.outputItemCode ?? qcTarget.outputItemName ?? qcTarget.id, delta: qcTarget.producedQty }]);
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
    { key: "cookedBy", header: "Cooked By" },
    { key: "sensoryPass", header: "Sensory", render: (r) => (
      <StatusBadge status={r.sensoryPass ? "Pass" : "Fail"} />
    ) },
    { key: "checkedBy", header: "Checked By (Sup-Hygiene)" },
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
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add / Update Item</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Item</Label>
                    <select
                      value={newRecordItem}
                      onChange={(e) => {
                        const item = e.target.value;
                        setNewRecordItem(item);
                        if (itemConfigs[item]) {
                          setNewRecordStandardTemp(itemConfigs[item].standardTemp);
                        } else {
                          setNewRecordStandardTemp("");
                        }
                      }}
                      className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">— Select item —</option>
                      {FOOD_ITEMS.map(item => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Standard Temp (°C)</Label>
                    <Input
                      type="number"
                      value={newRecordStandardTemp}
                      onChange={(e) => setNewRecordStandardTemp(Number(e.target.value))}
                      placeholder="e.g. 75"
                      className="mt-1"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
                  Ref: HACCP minimum internal temperatures — 75°C poultry, 63°C beef/pork, 70°C fish, 82°C reheated foods.
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
                          <th className="text-center px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(itemConfigs).map(([item, cfg], idx) => (
                          <tr key={item} className={idx % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                            <td className="px-3 py-2 font-medium">{item}</td>
                            <td className="px-3 py-2 text-center tabular-nums">≥{cfg.standardTemp}°C</td>
                            <td className="px-3 py-2 text-center">
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
              <Button onClick={() => { setMMobileTab("qc"); setMScreen(1); setMobileOpen(true); }}>
                <Smartphone className="h-4 w-4 mr-1.5" /> Mobile App View
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
              {pendingQC.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-md border border-border p-3 hover:bg-muted/30 transition-colors flex-wrap gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-foreground">{p.id}</span>
                      <Badge variant="outline" className="text-[10px] font-normal">{p.bom}</Badge>
                    </div>
                    <div className="mt-1 text-sm font-medium">
                      {p.outputItemName ?? p.bom}
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                        × {p.producedQty.toLocaleString()}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">Produced on {p.date}</div>
                  </div>
                  <Button size="sm" onClick={() => openQc(p)}>
                    <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" /> Record Test
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Measured Temp</div>
                  <div className={viewRecord.measuredTemp >= viewRecord.standardTempMin ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                    {viewRecord.measuredTemp}°C
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Sensory Result</div>
                  <StatusBadge status={viewRecord.sensoryPass ? "Pass" : "Fail"} />
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
          if (!open) { setQcOpen(false); setFailJustOpen(false); setFailReason(""); }
        }}
      >
        <DialogContent className="max-w-lg">
          {!failJustOpen ? (
            <>
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
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Item</div>
                    <div className="text-sm font-medium truncate">{qcTarget?.outputItemName ?? qcTarget?.bom ?? "—"}</div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Standard °C</div>
                    <div className="text-sm font-medium tabular-nums">≥{qcTemp}°C</div>
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
                      onChange={(e) => setQcBatchNo(e.target.value)}
                      className="mt-1 tabular-nums"
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
                      className="mt-1 tabular-nums"
                    />
                  </div>
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
                  onClick={() => setFailJustOpen(true)}
                >
                  <XIcon className="h-4 w-4 mr-1.5" /> Fail (Send Back)
                </Button>
                <Button
                  className="bg-success text-success-foreground hover:bg-success/90"
                  onClick={() => signOff(true)}
                >
                  <Check className="h-4 w-4 mr-1.5" /> Pass and Complete
                  <PackageCheck className="h-4 w-4 ml-1.5" />
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-destructive">Rejection Justification</DialogTitle>
                <DialogDescription>
                  Review the temperature comparison and provide a reason before sending this batch back.
                </DialogDescription>
              </DialogHeader>

              {/* Temperature comparison */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Standard Temp</div>
                  <div className="text-2xl font-bold text-foreground tabular-nums">≥{qcTemp}°C</div>
                  <div className="text-[10px] text-muted-foreground mt-1">HACCP minimum</div>
                </div>
                <div className={`rounded-md border px-4 py-3 text-center ${qcMeasured >= qcTemp ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/10"}`}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Measured Temp</div>
                  <div className={`text-2xl font-bold tabular-nums ${qcMeasured >= qcTemp ? "text-success" : "text-destructive"}`}>
                    {qcMeasured}°C
                  </div>
                  <div className={`text-[10px] mt-1 font-medium ${qcMeasured >= qcTemp ? "text-success" : "text-destructive"}`}>
                    {qcMeasured >= qcTemp
                      ? `+${qcMeasured - qcTemp}°C above standard`
                      : `${qcTemp - qcMeasured}°C below standard`}
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Reason for Rejection <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={failReason}
                  onChange={(e) => setFailReason(e.target.value)}
                  placeholder="Describe why this batch is being sent back (e.g. temperature insufficient, texture unacceptable, contamination risk)..."
                  className="mt-1 resize-none"
                  rows={4}
                />
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setFailJustOpen(false)}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => signOff(false)}
                >
                  <XIcon className="h-4 w-4 mr-1.5" /> Confirm & Reject Batch
                </Button>
              </DialogFooter>
            </>
          )}
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
                            onChange={e => setQcBatchNo(e.target.value)}
                            className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
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
