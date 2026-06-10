import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, ArrowLeft, Save, Boxes, Wrench, ShieldAlert, ScanBarcode, Truck, Eye,
  Paperclip, X, FileText, Check, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  equipmentAssets as SEED_ASSETS,
  equipmentGrns,
  type EquipmentCategory, type EquipmentAsset, type EquipmentAttachment,
} from "@/lib/sample-data";
import { useWorkflow } from "@/lib/workflow-store";
import { cn } from "@/lib/utils";

const CATEGORIES: EquipmentCategory[] = [
  "Trolley", "Oven Rack", "Container", "Tray", "Galley Insert", "Hot Box",
];
const REGISTER_STATUSES = ["New", "Used"] as const;
type RegisterStatus = (typeof REGISTER_STATUSES)[number];

const ATTACHMENT_LABELS = ["Purchase Invoice", "Warranty Document", "Other"] as const;
type AttachmentLabel = (typeof ATTACHMENT_LABELS)[number];

type AttachmentEntry = {
  uid: string;
  label: AttachmentLabel;
  fileName: string;
  fileRef: File | null;
};

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const ASSET_WORKFLOW_STAGES = [
  "Asset Configuration",
  "Purchase Requisition",
  "Purchase Order",
  "Purchased",
  "Received (GRN)",
  "Register as Asset",
] as const;

function WorkflowStepper() {
  const activeIdx = ASSET_WORKFLOW_STAGES.length - 1;
  return (
    <div className="flex items-center flex-wrap gap-y-2 mb-6 p-3 bg-muted/30 rounded-lg border border-border">
      {ASSET_WORKFLOW_STAGES.map((stage, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={stage} className="flex items-center">
            <div className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors",
              done && "bg-primary/10 text-primary",
              active && "bg-primary text-primary-foreground shadow-sm",
              !done && !active && "text-muted-foreground",
            )}>
              <span className={cn(
                "w-4 h-4 rounded-full flex items-center justify-center shrink-0",
                done && "bg-primary text-primary-foreground",
                active && "bg-white/25 text-primary-foreground",
                !done && !active && "bg-muted text-muted-foreground",
              )}>
                {done
                  ? <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  : <span className="text-[9px] font-bold">{i + 1}</span>}
              </span>
              {stage}
            </div>
            {i < ASSET_WORKFLOW_STAGES.length - 1 && (
              <ChevronRight className={cn("h-3.5 w-3.5 mx-0.5 shrink-0", i < activeIdx ? "text-primary/50" : "text-muted-foreground/30")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EquipmentAssetsPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [assets, setAssets] = usePersistedState<EquipmentAsset[]>("airline-equipments-assets", SEED_ASSETS);

  const nextId = useMemo(() => `EQP-NEW-${String(assets.length + 1).padStart(3, "0")}`, [assets]);

  const addAsset = (a: EquipmentAsset) => {
    setAssets((prev) => [a, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Equipment Assets"
        subtitle="Reusable airline equipment register — trolleys, oven racks, containers, trays, galley inserts and hot boxes"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> Register Asset</>}
          </Button>
        }
      />

      {view === "list"
        ? <AssetList assets={assets} />
        : <AssetCreate nextId={nextId} onSave={addAsset} />}
    </>
  );
}

// ── View Modal ────────────────────────────────────────────────────────────────

function Field({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
      <div className={cn("text-sm", mono && "font-mono text-xs")}>{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

function AssetViewModal({ asset, onClose }: { asset: EquipmentAsset; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <div className="font-semibold text-base">{asset.name}</div>
            <div className="font-mono text-xs text-muted-foreground mt-0.5">{asset.id}</div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={asset.status} />
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {/* Core registration fields */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Asset Details
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <Field label="Asset ID" value={asset.id} mono />
              <Field label="Asset Name" value={asset.name} />
              <Field label="Category" value={asset.category} />
              <Field label="Serial No." value={asset.serialNo} mono />
              <Field label="Status" value={asset.status} />
              <Field label="GRN Number" value={asset.grnNumber} mono />
              <Field label="Purchase Date" value={asset.purchaseDate} />
              <Field label="Supplier" value={asset.supplierName} />
            </div>
          </div>

          {/* Legacy fields — shown only if present (existing seed assets) */}
          {(asset.location || asset.rfidTag || asset.nextMaintenance) && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Operations Info
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                {asset.location && <Field label="Location" value={asset.location} />}
                {asset.rfidTag && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">RFID Tag</div>
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-primary">
                      <ScanBarcode className="h-3 w-3" />{asset.rfidTag}
                    </span>
                  </div>
                )}
                {asset.lastMaintenance && <Field label="Last Maintenance" value={asset.lastMaintenance} />}
                {asset.nextMaintenance && <Field label="Next Maintenance" value={asset.nextMaintenance} />}
              </div>
            </div>
          )}

          {/* Attachments */}
          {asset.attachments && asset.attachments.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Attachments
              </div>
              <div className="space-y-2">
                {asset.attachments.map((att, i) => (
                  <div key={i} className="flex items-center gap-2.5 rounded-md border border-border bg-muted/20 px-3 py-2">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-[11px] font-medium text-muted-foreground min-w-[120px]">{att.label}</span>
                    <span className="text-xs truncate">{att.fileName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-muted/30 flex justify-end shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// ── Asset List ────────────────────────────────────────────────────────────────

function AssetList({ assets }: { assets: EquipmentAsset[] }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<EquipmentCategory | "All">("All");
  const [viewAsset, setViewAsset] = useState<EquipmentAsset | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (category !== "All" && a.category !== category) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.id.toLowerCase().includes(q)
        && !(a.rfidTag ?? "").toLowerCase().includes(q)
        && !a.serialNo.toLowerCase().includes(q)
        && !(a.grnNumber ?? "").toLowerCase().includes(q)
        && !(a.supplierName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assets, search, category]);

  const today = new Date().toISOString().slice(0, 10);
  const cutoff30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const totalAssets = assets.length;
  const inService = assets.filter((a) => a.status === "In Service").length;
  const maintenanceDue = assets.filter(
    (a) => a.status !== "Damaged" && a.status !== "Retired" && !!a.nextMaintenance && a.nextMaintenance <= cutoff30,
  ).length;
  const damaged = assets.filter((a) => a.status === "Damaged").length;

  return (
    <>
      {viewAsset && <AssetViewModal asset={viewAsset} onClose={() => setViewAsset(null)} />}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Assets" value={totalAssets} icon={Boxes} tone="navy" />
        <KpiCard label="In Service" value={inService} icon={Truck} tone="success" />
        <KpiCard label="Maintenance Due (30d)" value={maintenanceDue} icon={Wrench} tone="warning" />
        <KpiCard label="Damaged" value={damaged} icon={ShieldAlert} tone="red" />
      </div>

      <Card className="mb-4">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by asset id, name, serial, GRN or supplier…"
                className="h-9"
              />
            </div>
            <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 shadow-sm flex-wrap">
              {(["All", ...CATEGORIES] as const).map((c) => {
                const active = category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c as typeof category)}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-medium rounded-sm transition-colors",
                      active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-10 text-xs uppercase tracking-wider">SL</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Asset ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Asset Name</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Category</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Serial No.</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">GRN #</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Purchase Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Supplier</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                  No assets match the selected filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((a, i) => (
                <TableRow key={a.id} className="hover:bg-muted/30">
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{a.id}</TableCell>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">{a.category}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{a.serialNo}</TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {a.grnNumber
                      ? <span className="text-primary">{a.grnNumber}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {a.purchaseDate || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {a.supplierName || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell className="text-right">
                    <button
                      onClick={() => setViewAsset(a)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ── Asset Create ──────────────────────────────────────────────────────────────

function AssetCreate({ nextId, onSave }: { nextId: string; onSave: (a: EquipmentAsset) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const { grns: wfGrns } = useWorkflow();

  const [name, setName] = useState("");
  const [category, setCategory] = useState<EquipmentCategory | "Other">("Trolley");
  const [customCategory, setCustomCategory] = useState("");
  const [status, setStatus] = useState<RegisterStatus>("New");
  const [serialNo, setSerialNo] = useState("");
  const [grnNumber, setGrnNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [supplierName, setSupplierName] = useState("");
  const [attachments, setAttachments] = useState<AttachmentEntry[]>([
    { uid: "att-1", label: "Purchase Invoice", fileName: "", fileRef: null },
  ]);

  const handleGrnSelect = (grnId: string) => {
    setGrnNumber(grnId);
    const staticGrn = equipmentGrns.find((g) => g.id === grnId);
    if (staticGrn) {
      setSupplierName(staticGrn.vendor);
      setPurchaseDate(staticGrn.date);
      return;
    }
    const wfGrn = wfGrns.find((g) => g.id === grnId);
    if (wfGrn) {
      setSupplierName(wfGrn.vendor);
      setPurchaseDate(wfGrn.date.slice(0, 10));
    } else {
      setSupplierName("");
    }
  };

  const addAttachment = () => {
    setAttachments((prev) => [
      ...prev,
      { uid: `att-${Date.now()}`, label: "Other", fileName: "", fileRef: null },
    ]);
  };

  const removeAttachment = (uid: string) => {
    setAttachments((prev) => prev.filter((a) => a.uid !== uid));
  };

  const updateAttachment = (uid: string, updates: Partial<AttachmentEntry>) => {
    setAttachments((prev) => prev.map((a) => (a.uid === uid ? { ...a, ...updates } : a)));
  };

  const save = () => {
    if (!name.trim()) { toast.error("Asset name is required."); return; }
    if (!serialNo.trim()) { toast.error("Serial number is required."); return; }
    if (!purchaseDate) { toast.error("Purchase date is required."); return; }
    if (category === "Other" && !customCategory.trim()) {
      toast.error("Please enter the custom category name."); return;
    }
    const finalCategory = (category === "Other" ? customCategory.trim() : category) as EquipmentCategory;
    const savedAttachments: EquipmentAttachment[] = attachments
      .filter((a) => a.fileName)
      .map((a) => ({ label: a.label, fileName: a.fileName }));

    onSave({
      id: nextId,
      name: name.trim(),
      category: finalCategory,
      serialNo: serialNo.trim().toUpperCase(),
      location: "",
      lastMaintenance: "",
      nextMaintenance: "",
      status: status as EquipmentAsset["status"],
      grnNumber: grnNumber.trim() || undefined,
      purchaseDate,
      supplierName: supplierName.trim() || undefined,
      attachments: savedAttachments.length ? savedAttachments : undefined,
    });
    toast.success(`${name.trim()} registered as ${nextId}.`);
  };

  return (
    <Card>
      <CardContent className="pt-6 pb-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-6">Register Equipment Asset</h3>

        {/* ── Core fields ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mb-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Asset ID</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Asset Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Full Size Meal Trolley" className="mt-1" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Category</Label>
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value as EquipmentCategory | "Other"); setCustomCategory(""); }}
              className={selectCls}
            >
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              <option value="Other">Other…</option>
            </select>
            {category === "Other" && (
              <Input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="Enter category name"
                className="mt-2"
              />
            )}
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Status</Label>
            <select value={status} onChange={(e) => setStatus(e.target.value as RegisterStatus)} className={selectCls}>
              {REGISTER_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Serial No. *</Label>
            <Input value={serialNo} onChange={(e) => setSerialNo(e.target.value)} placeholder="e.g. TR-004" className="mt-1 font-mono" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Purchase Date *</Label>
            <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="mt-1 tabular-nums" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">GRN Number</Label>
            <select
              value={grnNumber}
              onChange={(e) => handleGrnSelect(e.target.value)}
              className={selectCls}
            >
              <option value="">Select GRN…</option>
              {equipmentGrns.map((grn) => (
                <option key={grn.id} value={grn.id}>
                  {grn.id} — {grn.description} ({grn.vendor})
                </option>
              ))}
              {wfGrns.map((grn) => (
                <option key={grn.id} value={grn.id}>
                  {grn.id} — {grn.lines[0]?.name ?? grn.poRef} ({grn.vendor})
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Supplier Name</Label>
            <Input
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="Auto-filled on GRN selection"
              className="mt-1"
            />
          </div>
        </div>

        {/* ── Attachments ── */}
        <div className="border border-border rounded-md p-4 bg-muted/20 mb-6">
          <div className="flex items-center justify-between mb-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Attachments</Label>
            <Button type="button" size="sm" onClick={addAttachment}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          <div className="space-y-2">
            {attachments.map((att) => (
              <div key={att.uid} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                <select
                  value={att.label}
                  onChange={(e) => updateAttachment(att.uid, { label: e.target.value as AttachmentLabel })}
                  className="h-8 rounded border border-input bg-muted/40 px-2 text-xs min-w-[160px] shrink-0"
                >
                  {ATTACHMENT_LABELS.map((l) => <option key={l}>{l}</option>)}
                </select>
                <div className="flex-1 flex items-center gap-1.5 min-w-0">
                  {att.fileName
                    ? <><FileText className="h-3.5 w-3.5 text-primary shrink-0" /><span className="text-xs truncate font-medium">{att.fileName}</span></>
                    : <span className="text-xs text-muted-foreground italic">No file selected</span>
                  }
                </div>
                <label className="inline-flex items-center gap-1 cursor-pointer px-2.5 py-1 text-xs border border-input rounded-md bg-muted/40 hover:bg-muted transition-colors whitespace-nowrap shrink-0">
                  <Paperclip className="h-3 w-3" /> Browse
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) updateAttachment(att.uid, { fileName: f.name, fileRef: f });
                    }}
                  />
                </label>
                {attachments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.uid)}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Save — bottom right ── */}
        <div className="flex justify-end">
          <Button onClick={save}>
            <Save className="h-4 w-4 mr-1.5" /> Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
