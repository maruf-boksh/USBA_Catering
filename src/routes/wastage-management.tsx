import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePersistedState } from "@/lib/use-persisted-state";
import { flagArrival } from "@/lib/arrival-flash";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trash2, Plus, Eye, Clock, CheckCircle2, X as XIcon,
  AlertTriangle, Search, History, FileText, Package, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRole } from "@/lib/roles";
import { useWorkflow, type WfProductionEntry } from "@/lib/workflow-store";
import { resolveProductionItem } from "@/lib/meal-recipe";

// ── Shared types (exported so approval-management can consume them) ────────────

export type WastageType = "Production" | "Airport Store" | "Return Item";

export type WastageStatus =
  | "Pending In-Charge"
  | "Pending GM"
  | "Pending Final"
  | "Final Approved"
  | "Rejected";

export type ResponsiblePerson = {
  empId: string;
  name: string;
  designation: string;
  section: string;
  penaltyAmount: number;
};

export type WastageApprovalStep = {
  step: string;
  by: string;
  designation: string;
  action: "Submitted" | "Approved" | "Rejected" | "Returned";
  at: string;
  comment?: string;
};

export type WastageEntry = {
  id: string;
  reportingDate: string;
  wastageType: WastageType;
  itemName: string;
  packageBatchSize: string;
  batchCode: string;
  productionDate: string;
  disposalQty: number;
  disposalQtyUnit: string;
  disposalReason: string;
  reprocessingPossibility: "Yes" | "No" | "N/A";
  disposalMethod: string;
  disposalDate: string;
  disposalTime: string;
  rootCause: string;
  correction: string;
  correctiveActionPlan: string[];
  responsiblePersons: ResponsiblePerson[];
  eligibleForCompensation: boolean;
  compensationJustification: string;
  preparedBy: string;
  preparedByDesignation: string;
  preparedAt: string;
  status: WastageStatus;
  approvalSteps: WastageApprovalStep[];
  returnRef?: string;
  stockItemName?: string;
  previousStock?: number;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const DISPOSAL_REASONS = [
  "Expired / Past Expiry Date",
  "Physical Damage",
  "Contamination",
  "Over-production",
  "Quality Rejection",
  "Temperature Abuse",
  "Pest / Rodent Damage",
  "Spillage / Breakage",
  "Customer Complaint",
  "Other",
];

const DISPOSAL_METHODS = [
  "Incineration",
  "Composting",
  "Landfill Disposal",
  "Sewage / Drain",
  "Animal Feed",
  "Third-party Disposal",
  "N/A",
  "Other (Specify)",
];

const SECTIONS = [
  "Baunia Catering",
  "Hot Kitchen",
  "Cold Kitchen",
  "Bakery",
  "Store",
  "Dispatch",
  "QC Department",
];

const UNITS = ["Kg", "g", "L", "ml", "Pcs", "Units", "Box", "Tray", "Bag"];

const emptyPerson = (): ResponsiblePerson => ({
  empId: "", name: "", designation: "", section: "", penaltyAmount: 0,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowStamp(): string {
  const n = new Date();
  const date = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
  const time = `${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`;
  return `${date} ${time}`;
}

function todayDate(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}

function genId(entries: WastageEntry[]): string {
  const year = new Date().getFullYear();
  const max = entries.reduce((m, e) => {
    const parts = e.id.split("-");
    const n = parseInt(parts[parts.length - 1] ?? "0", 10);
    return n > m ? n : m;
  }, 0);
  return `WDD-${year}-${String(max + 1).padStart(4, "0")}`;
}

function StatusBadge({ status }: { status: WastageStatus }) {
  const cfg: Record<WastageStatus, { label: string; cls: string }> = {
    "Pending In-Charge": { label: "Pending In-Charge", cls: "bg-amber-100 text-amber-700 border-amber-200" },
    "Pending GM":        { label: "Pending GM",         cls: "bg-blue-100 text-blue-700 border-blue-200" },
    "Pending Final":     { label: "Pending Final Auth",  cls: "bg-violet-100 text-violet-700 border-violet-200" },
    "Final Approved":    { label: "Final Approved",      cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    "Rejected":          { label: "Rejected",            cls: "bg-red-100 text-red-700 border-red-200" },
  };
  const { label, cls } = cfg[status] ?? { label: status, cls: "" };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border", cls)}>
      {label}
    </span>
  );
}

// ── Empty form factory ────────────────────────────────────────────────────────

type FormState = {
  wastageType: WastageType;
  itemName: string;
  packageBatchSize: string;
  batchCode: string;
  productionDate: string;
  disposalQty: string;
  disposalQtyUnit: string;
  disposalReason: string;
  disposalReasonCustom: string;
  reprocessingPossibility: "Yes" | "No" | "N/A";
  disposalMethod: string;
  disposalMethodCustom: string;
  disposalDate: string;
  disposalTime: string;
  rootCause: string;
  correction: string;
  correctiveActionPlan: string[];
  responsiblePersons: ResponsiblePerson[];
  eligibleForCompensation: boolean;
  compensationJustification: string;
  stockItemName: string;
  previousStock: string;
  returnRef: string;
  selectedReturnIds: string[];
  selectedReturnLineIdx: number;
  selectedRecookBatchIds: string[];
  recookBatchQtys: Record<string, string>;
};

const emptyForm = (): FormState => ({
  wastageType: "Production",
  itemName: "",
  packageBatchSize: "",
  batchCode: "",
  productionDate: "",
  disposalQty: "",
  disposalQtyUnit: "Kg",
  disposalReason: "",
  disposalReasonCustom: "",
  reprocessingPossibility: "N/A",
  disposalMethod: "",
  disposalMethodCustom: "",
  disposalDate: "",
  disposalTime: "",
  rootCause: "",
  correction: "",
  correctiveActionPlan: [""],
  responsiblePersons: [emptyPerson()],
  eligibleForCompensation: false,
  compensationJustification: "",
  stockItemName: "",
  previousStock: "",
  returnRef: "",
  selectedReturnIds: [],
  selectedReturnLineIdx: -1,
  selectedRecookBatchIds: [],
  recookBatchQtys: {},
});

// ── Main Component ────────────────────────────────────────────────────────────

export default function WastageManagementPage() {
  const { role } = useRole();
  const navigate = useNavigate();
  const [entries, setEntries] = usePersistedState<WastageEntry[]>("wastage-entries", []);

  const [activeTab, setActiveTab] = useState<"all" | WastageType>("all");
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const [viewOpen, setViewOpen] = useState(false);
  const [viewEntry, setViewEntry] = useState<WastageEntry | null>(null);

  const [stockLogOpen, setStockLogOpen] = useState(false);
  const [stockLogEntry, setStockLogEntry] = useState<WastageEntry | null>(null);

  const [prodDetailOpen, setProdDetailOpen] = useState(false);
  const [prodDetailEntry, setProdDetailEntry] = useState<WfProductionEntry | null>(null);

  // ── Inventory + Returns reads for form autocomplete ────────────────────────

  const [inventoryItems] = usePersistedState<{ id?: string; name: string; stock: number; uom?: string; }[]>("inventory-items", []);
  const [consumableReturns] = usePersistedState<{ id: string; date: string; flight?: string; sector?: string; lines: { itemId?: string; itemName: string; qty: number; uom: string; }[] }[]>("consumable-returns", []);

  const [stockDropOpen, setStockDropOpen] = useState(false);

  const { productionEntries } = useWorkflow();
  const recookBatches = useMemo(
    () => productionEntries.filter((e) => e.status === "Re-Cook"),
    [productionEntries]
  );

  const todayReturns = useMemo(() => {
    const today = todayDate();
    return consumableReturns.filter((r) => r.date === today);
  }, [consumableReturns]);

  const stockSuggestions = useMemo(() => {
    if (form.wastageType !== "Production" && form.wastageType !== "Airport Store") return [];
    if (!form.itemName.trim()) return [];
    const q = form.itemName.toLowerCase();
    return inventoryItems.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8);
  }, [inventoryItems, form.itemName, form.wastageType]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (activeTab !== "all" && e.wastageType !== activeTab) return false;
      if (q && ![e.id, e.itemName, e.disposalReason, e.preparedBy].some((f) => f.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [entries, activeTab, search]);

  const kpis = useMemo(() => {
    const pending = entries.filter((e) =>
      ["Pending In-Charge", "Pending GM", "Pending Final"].includes(e.status)
    ).length;
    const approved = entries.filter((e) => e.status === "Final Approved").length;
    const totalQty = entries.reduce((s, e) => s + e.disposalQty, 0);
    return { total: entries.length, pending, approved, totalQty };
  }, [entries]);

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = () => {
    if (!form.itemName.trim()) { toast.error("Item name is required."); return; }
    if (!form.disposalQty || isNaN(Number(form.disposalQty)) || Number(form.disposalQty) <= 0) {
      toast.error("Valid disposal quantity is required."); return;
    }
    if (!form.disposalReason) { toast.error("Disposal reason is required."); return; }
    if (form.disposalReason === "Other" && !form.disposalReasonCustom.trim()) {
      toast.error("Please specify the disposal reason."); return;
    }
    if (form.wastageType === "Return Item" && !form.selectedReturnIds.length) {
      toast.error("Please select a return record."); return;
    }
    if (!form.rootCause.trim()) { toast.error("Root cause is required."); return; }
    if (!form.compensationJustification.trim()) {
      toast.error("Compensation justification is required (Yes or No)."); return;
    }

    const at = nowStamp();
    const newEntry: WastageEntry = {
      id: genId(entries),
      reportingDate: todayDate(),
      wastageType: form.wastageType,
      itemName: form.itemName.trim(),
      packageBatchSize: form.packageBatchSize.trim() || "N/A",
      batchCode: form.batchCode.trim() || "N/A",
      productionDate: form.productionDate || "N/A",
      disposalQty: Number(form.disposalQty),
      disposalQtyUnit: form.disposalQtyUnit,
      disposalReason: form.disposalReason === "Other"
        ? (form.disposalReasonCustom.trim() || "Other")
        : form.disposalReason,
      reprocessingPossibility: form.reprocessingPossibility,
      disposalMethod: form.disposalMethod === "Other (Specify)"
        ? (form.disposalMethodCustom.trim() || "N/A")
        : (form.disposalMethod || "N/A"),
      disposalDate: form.disposalDate || "N/A",
      disposalTime: form.disposalTime || "N/A",
      rootCause: form.rootCause.trim(),
      correction: form.correction.trim() || "N/A",
      correctiveActionPlan: form.correctiveActionPlan.filter((a) => a.trim()),
      responsiblePersons: form.responsiblePersons.filter((p) => p.name.trim()),
      eligibleForCompensation: form.eligibleForCompensation,
      compensationJustification: form.compensationJustification.trim(),
      preparedBy: role,
      preparedByDesignation: "Senior Executive-Food Safety & Hygiene",
      preparedAt: at,
      status: "Pending In-Charge",
      approvalSteps: [
        {
          step: "Prepared By",
          by: role,
          designation: "Senior Executive-Food Safety & Hygiene",
          action: "Submitted",
          at,
        },
      ],
      ...((form.wastageType === "Production" || form.wastageType === "Airport Store") && form.stockItemName.trim()
        ? { stockItemName: form.stockItemName.trim(), previousStock: Number(form.previousStock) || 0 }
        : {}),
      ...(form.wastageType === "Return Item" && form.selectedReturnIds.length
        ? { returnRef: form.selectedReturnIds.join(", ") }
        : {}),
    };

    setEntries((prev) => [newEntry, ...prev]);
    setCreateOpen(false);
    setForm(emptyForm());
    toast.success(`${newEntry.id} submitted — pending Production In-Charge review.`);
  };

  // ── Update person helper ───────────────────────────────────────────────────

  const setPerson = (i: number, patch: Partial<ResponsiblePerson>) => {
    const next = [...form.responsiblePersons];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, responsiblePersons: next });
  };

  const setAction = (i: number, val: string) => {
    const next = [...form.correctiveActionPlan];
    next[i] = val;
    setForm({ ...form, correctiveActionPlan: next });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader
        title="Wastage Management"
        subtitle="Production, Airport Store & Return Item Wastage — Disposal Reports & Approval Tracking"
      />

      <div className="usb-livery-stripe h-1 rounded-full mb-5" aria-hidden />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Reports"    value={kpis.total}                           sub="all records"        icon={FileText}      tone="info"    />
        <KpiCard label="Pending Approval" value={kpis.pending}                         sub="awaiting action"    icon={Clock}         tone="warning" />
        <KpiCard label="Final Approved"   value={kpis.approved}                        sub="fully processed"    icon={CheckCircle2}  tone="success" />
        <KpiCard label="Total Disposal"   value={`${kpis.totalQty.toFixed(1)} units`} sub="cumulative qty"     icon={Trash2}        tone="red"     />
      </div>

      {/* Tabs + Search + New Button */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="h-8">
            <TabsTrigger value="all"           className="text-xs px-3 h-7">All</TabsTrigger>
            <TabsTrigger value="Production"    className="text-xs px-3 h-7">Production</TabsTrigger>
            <TabsTrigger value="Airport Store" className="text-xs px-3 h-7">Airport Store</TabsTrigger>
            <TabsTrigger value="Return Item"   className="text-xs px-3 h-7">Return Items</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID, item, reason..."
              className="pl-8 h-8 w-64 text-sm"
            />
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => { setForm(emptyForm()); setCreateOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" /> New Wastage Report
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs uppercase tracking-wider">ID</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Type</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Item Name</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Qty Disposed</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Reason</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Prepared By</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-14">
                      No wastage reports found.{" "}
                      <button
                        className="text-primary underline"
                        onClick={() => { setForm(emptyForm()); setCreateOpen(true); }}
                      >
                        Create the first report
                      </button>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((entry) => (
                    <TableRow key={entry.id} className="hover:bg-muted/30">
                      <TableCell>
                        <button
                          className="font-mono text-xs font-semibold text-primary hover:underline"
                          onClick={() => { setViewEntry(entry); setViewOpen(true); }}
                        >
                          {entry.id}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{entry.reportingDate}</TableCell>
                      <TableCell>
                        <span className={cn(
                          "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                          entry.wastageType === "Production"    ? "bg-orange-100 text-orange-700" :
                          entry.wastageType === "Airport Store" ? "bg-sky-100 text-sky-700" :
                                                                  "bg-violet-100 text-violet-700",
                        )}>
                          {entry.wastageType}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm font-medium max-w-[150px] truncate">{entry.itemName}</TableCell>
                      <TableCell>
                        <button
                          className="text-xs font-semibold text-primary hover:underline tabular-nums"
                          title="View disposal quantity log"
                          onClick={() => { setStockLogEntry(entry); setStockLogOpen(true); }}
                        >
                          {entry.disposalQty} {entry.disposalQtyUnit}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs max-w-[130px] truncate">{entry.disposalReason}</TableCell>
                      <TableCell className="text-xs">
                        <div>{entry.preparedBy}</div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">{entry.preparedAt}</div>
                      </TableCell>
                      <TableCell><StatusBadge status={entry.status} /></TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 text-muted-foreground hover:text-primary hover:border-primary/40"
                          title="View details"
                          onClick={() => { setViewEntry(entry); setViewOpen(true); }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Create Modal ──────────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Trash2 className="h-5 w-5 text-red-500" />
              New Wastage / Damaged Product Disposal Report
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-2">

            {/* Form header strip */}
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-md border border-border text-xs text-muted-foreground">
              <span><strong>Form No:</strong> USBA-FSH-WDD &nbsp;|&nbsp; <strong>Issue Date:</strong> 28.05.2023 &nbsp;|&nbsp; <strong>Rev. No:</strong> 00</span>
              <span><strong>Reporting Date:</strong> {todayDate().split("-").reverse().join(".")}</span>
            </div>

            {/* Type selector */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">Wastage Type <span className="text-red-500">*</span></Label>
                <Select
                  value={form.wastageType}
                  onValueChange={(v) => setForm({
                    ...form,
                    wastageType: v as WastageType,
                    stockItemName: "",
                    previousStock: "",
                    returnRef: "",
                    selectedReturnIds: [],
                    selectedReturnLineIdx: -1,
                    selectedRecookBatchIds: [],
                    recookBatchQtys: {},
                  })}
                >
                  <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Production">Production Point</SelectItem>
                    <SelectItem value="Airport Store">Airport Store</SelectItem>
                    <SelectItem value="Return Item">Return Item</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Re-Cook Batches — Production Point */}
            {form.wastageType === "Production" && recookBatches.length > 0 && (
              <div className="p-3 bg-orange-50 border border-orange-200 rounded-md space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-orange-700">Re-Cook Batches</h4>
                <div>
                  <Label className="text-xs">Failed QC Batches — Select to populate <span className="text-red-500">*</span></Label>
                  <div className="mt-1 border border-border rounded-md overflow-hidden bg-background">
                    {recookBatches.map((entry) => {
                      const isChecked = form.selectedRecookBatchIds.includes(entry.id);
                      return (
                        <div key={entry.id} className="border-b border-border last:border-0">
                          <label className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-muted/40">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-primary"
                              checked={isChecked}
                              onChange={(e) => {
                                const newIds = e.target.checked
                                  ? [...form.selectedRecookBatchIds, entry.id]
                                  : form.selectedRecookBatchIds.filter((id) => id !== entry.id);
                                const remaining = recookBatches.filter((b) => newIds.includes(b.id));
                                const primary = remaining[0];
                                const newQtys = { ...form.recookBatchQtys };
                                if (e.target.checked) {
                                  if (newQtys[entry.id] === undefined) newQtys[entry.id] = "";
                                } else {
                                  delete newQtys[entry.id];
                                }
                                setForm({
                                  ...form,
                                  selectedRecookBatchIds: newIds,
                                  recookBatchQtys: newQtys,
                                  itemName: primary ? (primary.outputItemName ?? primary.bom) : "",
                                  stockItemName: primary ? (primary.outputItemName ?? primary.bom) : "",
                                  previousStock: String(remaining.reduce((s, b) => s + b.producedQty, 0)),
                                  batchCode: newIds.length > 0 ? newIds[0] : "",
                                  productionDate: primary ? primary.date : "",
                                  disposalQtyUnit: "Units",
                                  disposalDate: newIds.length > 0 ? todayDate() : "",
                                  ...(newIds.length === 0 ? { disposalQty: "" } : {}),
                                });
                                setStockDropOpen(false);
                              }}
                            />
                            <span className="font-medium">{entry.id}</span>
                            {entry.outputItemName && <span className="text-muted-foreground">· {entry.outputItemName}</span>}
                            {entry.qcFailReason && <span className="text-muted-foreground">({entry.qcFailReason})</span>}
                            <span className="ml-auto text-muted-foreground tabular-nums shrink-0">{entry.producedQty.toLocaleString()} units</span>
                          </label>
                          {/* Per-batch disposal qty + inline Material QTY — visible only when this batch is checked */}
                          {isChecked && (() => {
                            const recipe = resolveProductionItem({ name: entry.outputItemName ?? entry.bom, code: entry.outputItemCode });
                            const batchQty = Number(form.recookBatchQtys[entry.id]) || 0;
                            const isMulti = form.selectedRecookBatchIds.length > 1;
                            const hasMat = recipe.rawMaterials.length > 0 || recipe.packagingMaterials.length > 0 || recipe.otherConsumption.length > 0;
                            const matSections = [
                              { label: "Raw Materials",       rows: recipe.rawMaterials       },
                              { label: "Packaging Materials", rows: recipe.packagingMaterials },
                              { label: "Other Consumption",   rows: recipe.otherConsumption   },
                            ];
                            return (
                              <>
                                <div className="flex items-center gap-2 px-4 pb-2 pt-0.5 bg-orange-50/70">
                                  <span className="text-[11px] text-orange-700 font-medium shrink-0">Disposal QTY for this FG:</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    className="h-7 text-xs w-28"
                                    value={form.recookBatchQtys[entry.id] ?? ""}
                                    onChange={(e) => setForm({
                                      ...form,
                                      recookBatchQtys: { ...form.recookBatchQtys, [entry.id]: e.target.value },
                                    })}
                                    placeholder="0"
                                  />
                                  <span className="text-[11px] text-muted-foreground">Units</span>
                                </div>
                                {hasMat && (
                                  <div className="mx-3 mb-3 border border-orange-200 rounded-md overflow-hidden">
                                    {/* Name / Batch Code / Size header — only for multiple FGs */}
                                    {isMulti && (
                                      <div className="grid grid-cols-3 gap-x-3 px-3 py-2 bg-orange-100 border-b border-orange-200 text-xs">
                                        <div><span className="text-[10px] text-muted-foreground">Name: </span><strong>{entry.outputItemName ?? entry.bom}</strong></div>
                                        <div><span className="text-[10px] text-muted-foreground">Batch Code: </span><span className="font-mono">{entry.id}</span></div>
                                        <div><span className="text-[10px] text-muted-foreground">Batch Size: </span><strong>{entry.producedQty.toLocaleString()} Units</strong></div>
                                      </div>
                                    )}
                                    {/* QTY Before / Disposal / Current strip */}
                                    <div className="grid grid-cols-3 border-b border-orange-200 text-center">
                                      <div className="px-2 py-2 border-r border-orange-200">
                                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">QTY Before</p>
                                        <p className="text-xs font-bold mt-0.5">{entry.producedQty.toLocaleString()} Units</p>
                                      </div>
                                      <div className="px-2 py-2 border-r border-orange-200">
                                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Disposal</p>
                                        <p className="text-xs font-bold mt-0.5 text-red-600">{batchQty > 0 ? `−${batchQty}` : "0"} Units</p>
                                      </div>
                                      <div className="px-2 py-2">
                                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Current QTY</p>
                                        <p className="text-xs font-bold mt-0.5 text-primary">{entry.producedQty - batchQty} Units</p>
                                      </div>
                                    </div>
                                    {batchQty === 0 ? (
                                      <div className="px-3 py-2.5 text-xs text-muted-foreground text-center italic">
                                        Enter Disposal QTY above to see material calculations.
                                      </div>
                                    ) : (
                                      matSections.map(({ label, rows }) => rows.length === 0 ? null : (
                                        <div key={label}>
                                          <div className="px-3 py-1 bg-orange-50 border-b border-orange-100">
                                            <p className="text-[9px] font-bold uppercase tracking-wider text-orange-500">{label}</p>
                                          </div>
                                          {rows.map((m) => (
                                            <div key={m.itemCode} className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-orange-100 last:border-0">
                                              <span className="font-medium">{m.itemName}</span>
                                              <span className="tabular-nums text-muted-foreground">{(m.qtyPerUnit * batchQty).toFixed(3)} {m.uom}</span>
                                            </div>
                                          ))}
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                  {form.selectedRecookBatchIds.length > 1 && (
                    <p className="text-[11px] text-orange-600 mt-1.5 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {form.selectedRecookBatchIds.length} FGs selected — primary item: <strong>{form.itemName}</strong>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Return Item — today's returns checkboxes (multi-select) */}
            {form.wastageType === "Return Item" && (
              <div className="p-3 bg-violet-50 border border-violet-200 rounded-md space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-violet-700">Select Return Record(s)</h4>
                <div>
                  <Label className="text-xs">Today's Return Records <span className="text-red-500">*</span></Label>
                  {todayReturns.length === 0 ? (
                    <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      No returns recorded today. Log consumable returns first.
                    </p>
                  ) : (
                    <div className="mt-1 border border-border rounded-md overflow-hidden bg-background">
                      {todayReturns.map((r) => (
                        <label
                          key={r.id}
                          className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-muted/40 border-b border-border last:border-0"
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-primary"
                            checked={form.selectedReturnIds.includes(r.id)}
                            onChange={(e) => {
                              const ids = e.target.checked
                                ? [...form.selectedReturnIds, r.id]
                                : form.selectedReturnIds.filter((id) => id !== r.id);
                              const allLines = ids.flatMap((id) => {
                                const ret = todayReturns.find((x) => x.id === id);
                                return ret?.lines ?? [];
                              });
                              const single = allLines.length === 1;
                              setForm({
                                ...form,
                                selectedReturnIds: ids,
                                selectedReturnLineIdx: single ? 0 : -1,
                                itemName: single ? allLines[0].itemName : "",
                                disposalQty: single ? String(allLines[0].qty) : "",
                                disposalQtyUnit: single ? allLines[0].uom : form.disposalQtyUnit,
                              });
                            }}
                          />
                          <span className="font-medium">{r.id}</span>
                          {r.flight && <span className="text-muted-foreground">· {r.flight}</span>}
                          {r.sector && <span className="text-muted-foreground">({r.sector})</span>}
                          <span className="ml-auto text-muted-foreground tabular-nums">{r.lines.length} line{r.lines.length !== 1 ? "s" : ""}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Combined line picker from all selected returns */}
                {form.selectedReturnIds.length > 0 && (() => {
                  const allLines = form.selectedReturnIds.flatMap((id) => {
                    const ret = todayReturns.find((r) => r.id === id);
                    return (ret?.lines ?? []).map((line) => ({ ...line, fromId: id }));
                  });
                  if (allLines.length <= 1) return null;
                  return (
                    <div>
                      <Label className="text-xs">Select Return Item <span className="text-red-500">*</span></Label>
                      <div className="mt-1 border border-border rounded-md overflow-hidden">
                        {allLines.map((line, idx) => (
                          <div
                            key={idx}
                            onMouseDown={() => setForm({
                              ...form,
                              selectedReturnLineIdx: idx,
                              itemName: line.itemName,
                              disposalQty: String(line.qty),
                              disposalQtyUnit: line.uom,
                            })}
                            className={cn(
                              "px-3 py-2 text-xs cursor-pointer border-b border-border last:border-0 flex justify-between items-center",
                              form.selectedReturnLineIdx === idx
                                ? "bg-primary/10 text-primary font-semibold"
                                : "hover:bg-muted/40",
                            )}
                          >
                            <div className="flex flex-col">
                              <span>{line.itemName}</span>
                              <span className="text-[10px] text-muted-foreground font-normal">from {line.fromId}</span>
                            </div>
                            <span className="tabular-nums text-muted-foreground">{line.qty} {line.uom}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Auto-filled preview */}
                {form.selectedReturnLineIdx >= 0 && form.itemName && (
                  <div className="grid grid-cols-2 gap-2 text-xs p-2 bg-white/70 rounded border border-violet-200">
                    <div><span className="text-muted-foreground">Item: </span><strong>{form.itemName}</strong></div>
                    <div><span className="text-muted-foreground">Return Qty: </span><strong className="text-red-600">{form.disposalQty} {form.disposalQtyUnit}</strong></div>
                  </div>
                )}
              </div>
            )}

            {/* Disposal Details Table */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Disposal Details</h4>
              <div className="grid grid-cols-2 gap-4">
                {!(form.wastageType === "Production" && form.selectedRecookBatchIds.length > 1) && (
                <div>
                  <Label className="text-xs">01. Name of RM / PM / FG <span className="text-red-500">*</span></Label>
                  {(form.wastageType === "Production" || form.wastageType === "Airport Store") ? (
                    <div className="relative">
                      <Input
                        className="mt-1 h-9 text-sm"
                        value={form.itemName}
                        onChange={(e) => {
                          setForm({ ...form, itemName: e.target.value, stockItemName: e.target.value, previousStock: "" });
                          setStockDropOpen(true);
                        }}
                        onFocus={() => setStockDropOpen(true)}
                        onBlur={() => setTimeout(() => setStockDropOpen(false), 150)}
                        placeholder="Type to search inventory items..."
                      />
                      {stockDropOpen && stockSuggestions.length > 0 && (
                        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border border-border rounded-md shadow-lg max-h-44 overflow-y-auto">
                          {stockSuggestions.map((item, idx) => (
                            <div
                              key={idx}
                              className="px-3 py-2 text-xs cursor-pointer hover:bg-muted/60 flex justify-between items-center"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setForm({ ...form, itemName: item.name, stockItemName: item.name, previousStock: String(item.stock ?? 0), disposalQtyUnit: item.uom ?? form.disposalQtyUnit });
                                setStockDropOpen(false);
                              }}
                            >
                              <span className="font-medium">{item.name}</span>
                              <span className="text-muted-foreground tabular-nums">{item.stock ?? 0} {item.uom ?? ""}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {form.itemName.trim() && !stockDropOpen && !form.previousStock && (
                        <p className="text-[11px] text-amber-600 mt-0.5">Not found in inventory — manual entry applied.</p>
                      )}
                    </div>
                  ) : (
                    <Input
                      className="mt-1 h-9 text-sm"
                      value={form.itemName}
                      onChange={(e) => setForm({ ...form, itemName: e.target.value })}
                      placeholder="e.g. Chinigura Rice"
                    />
                  )}
                </div>
                )}
                {!(form.wastageType === "Production" && form.selectedRecookBatchIds.length > 1) && (
                <div>
                  <Label className="text-xs">02. Package / Batch Size</Label>
                  <div className="relative mt-1">
                    <Input
                      className={cn("h-9 text-sm", (form.wastageType === "Production" || form.wastageType === "Airport Store") && form.previousStock ? "pl-28" : "")}
                      value={form.packageBatchSize}
                      onChange={(e) => setForm({ ...form, packageBatchSize: e.target.value })}
                      placeholder="e.g. 25 Kg"
                    />
                    {(form.wastageType === "Production" || form.wastageType === "Airport Store") && form.previousStock && (
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-emerald-600 font-semibold tabular-nums bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 pointer-events-none">
                        Stock: {form.previousStock} {form.disposalQtyUnit}
                      </span>
                    )}
                  </div>
                </div>
                )}
                {!(form.wastageType === "Production" && form.selectedRecookBatchIds.length > 1) && (
                <div>
                  <Label className="text-xs">03. Batch Code</Label>
                  <Input
                    className="mt-1 h-9 text-sm"
                    value={form.batchCode}
                    onChange={(e) => setForm({ ...form, batchCode: e.target.value })}
                    placeholder="N/A"
                  />
                </div>
                )}
                <div>
                  <Label className="text-xs">04. Production Date</Label>
                  <Input
                    type="date"
                    className="mt-1 h-9 text-sm"
                    value={form.productionDate}
                    onChange={(e) => setForm({ ...form, productionDate: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">05. Disposal Quantity <span className="text-red-500">*</span></Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      type="number"
                      min="0"
                      className="h-9 text-sm flex-1"
                      value={form.disposalQty}
                      onChange={(e) => setForm({ ...form, disposalQty: e.target.value })}
                      placeholder="0"
                    />
                    <Select value={form.disposalQtyUnit} onValueChange={(v) => setForm({ ...form, disposalQtyUnit: v })}>
                      <SelectTrigger className="h-9 w-24 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">06. Disposal Reason <span className="text-red-500">*</span></Label>
                  <Select value={form.disposalReason} onValueChange={(v) => setForm({ ...form, disposalReason: v, disposalReasonCustom: "" })}>
                    <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Select reason" /></SelectTrigger>
                    <SelectContent>{DISPOSAL_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                  {form.disposalReason === "Other" && (
                    <Input
                      className="mt-2 h-9 text-sm"
                      value={form.disposalReasonCustom}
                      onChange={(e) => setForm({ ...form, disposalReasonCustom: e.target.value })}
                      placeholder="Describe the disposal reason..."
                    />
                  )}
                </div>
                <div>
                  <Label className="text-xs">07. Reprocessing Possibility</Label>
                  <Select value={form.reprocessingPossibility} onValueChange={(v) => setForm({ ...form, reprocessingPossibility: v as "Yes" | "No" | "N/A" })}>
                    <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Yes">Yes</SelectItem>
                      <SelectItem value="No">No</SelectItem>
                      <SelectItem value="N/A">N/A</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">08. Disposal Method</Label>
                  <Select value={form.disposalMethod} onValueChange={(v) => setForm({ ...form, disposalMethod: v, disposalMethodCustom: "" })}>
                    <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Select method" /></SelectTrigger>
                    <SelectContent>{DISPOSAL_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                  {form.disposalMethod === "Other (Specify)" && (
                    <Input
                      className="mt-2 h-9 text-sm"
                      value={form.disposalMethodCustom}
                      onChange={(e) => setForm({ ...form, disposalMethodCustom: e.target.value })}
                      placeholder="Describe the disposal method..."
                    />
                  )}
                </div>
                <div>
                  <Label className="text-xs">09. Disposal Date</Label>
                  <Input
                    type="date"
                    className="mt-1 h-9 text-sm"
                    value={form.disposalDate}
                    onChange={(e) => setForm({ ...form, disposalDate: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">10. Disposal Time</Label>
                  <Input
                    type="time"
                    className="mt-1 h-9 text-sm"
                    value={form.disposalTime}
                    onChange={(e) => setForm({ ...form, disposalTime: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Stock QTY Summary — Production, Airport Store & Return Item */}
            {(form.wastageType === "Production" || form.wastageType === "Airport Store" || form.wastageType === "Return Item") && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 p-2 bg-orange-50 border border-orange-200 rounded-md">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">QTY Before Wastage</p>
                    <p className="text-sm font-bold mt-0.5">{Number(form.previousStock) || 0} {form.disposalQtyUnit}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Disposal QTY</p>
                    <p className="text-sm font-bold mt-0.5 text-red-600">
                      {Number(form.disposalQty) > 0 ? `−${Number(form.disposalQty)}` : "0"} {form.disposalQtyUnit}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Current QTY</p>
                    <p className="text-sm font-bold mt-0.5 text-primary">
                      {(Number(form.previousStock) || 0) - (Number(form.disposalQty) || 0)} {form.disposalQtyUnit}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-orange-700 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Stock will be reduced by {form.disposalQty || "0"} {form.disposalQtyUnit} upon Final Approval.
                </p>
              </div>
            )}


            {/* Root Cause */}
            <div>
              <Label className="text-xs">Root Cause of Rejection <span className="text-red-500">*</span></Label>
              <Textarea
                className="mt-1 text-sm min-h-[80px]"
                value={form.rootCause}
                onChange={(e) => setForm({ ...form, rootCause: e.target.value })}
                placeholder="Describe the root cause in detail..."
              />
            </div>

            {/* Responsible Persons */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Responsible Person of Flight Kitchen</h4>
              <div className="border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-xs w-8">#</TableHead>
                      <TableHead className="text-xs">Employee ID</TableHead>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Designation</TableHead>
                      <TableHead className="text-xs">Section</TableHead>
                      <TableHead className="text-xs">Penalty (Tk.)</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {form.responsiblePersons.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-muted-foreground font-mono">{String(i+1).padStart(2,"0")}</TableCell>
                        <TableCell>
                          <Input
                            className="h-7 text-xs w-28"
                            value={p.empId}
                            onChange={(e) => setPerson(i, { empId: e.target.value })}
                            placeholder="USBA-XXXXX"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-7 text-xs w-32"
                            value={p.name}
                            onChange={(e) => setPerson(i, { name: e.target.value })}
                            placeholder="Full name"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-7 text-xs w-28"
                            value={p.designation}
                            onChange={(e) => setPerson(i, { designation: e.target.value })}
                            placeholder="Designation"
                          />
                        </TableCell>
                        <TableCell>
                          <Select value={p.section} onValueChange={(v) => setPerson(i, { section: v })}>
                            <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="Section" /></SelectTrigger>
                            <SelectContent>
                              {SECTIONS.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            className="h-7 text-xs w-24"
                            value={p.penaltyAmount || ""}
                            onChange={(e) => setPerson(i, { penaltyAmount: Number(e.target.value) })}
                            placeholder="0"
                          />
                        </TableCell>
                        <TableCell>
                          {form.responsiblePersons.length > 1 && (
                            <button
                              className="text-red-400 hover:text-red-600"
                              onClick={() => setForm({
                                ...form,
                                responsiblePersons: form.responsiblePersons.filter((_, idx) => idx !== i),
                              })}
                            >
                              <XIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-xs gap-1"
                onClick={() => setForm({ ...form, responsiblePersons: [...form.responsiblePersons, emptyPerson()] })}
              >
                <Plus className="h-3 w-3" /> Add Person
              </Button>
            </div>

            {/* Correction */}
            <div>
              <Label className="text-xs">Correction</Label>
              <Textarea
                className="mt-1 text-sm"
                value={form.correction}
                onChange={(e) => setForm({ ...form, correction: e.target.value })}
                placeholder="What immediate correction was taken?"
              />
            </div>

            {/* Corrective Action Plan */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Corrective Action Plan</h4>
              <div className="space-y-2">
                {form.correctiveActionPlan.map((action, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}.</span>
                    <Input
                      className="h-8 text-sm flex-1"
                      value={action}
                      onChange={(e) => setAction(i, e.target.value)}
                      placeholder="Action item..."
                    />
                    {form.correctiveActionPlan.length > 1 && (
                      <button
                        className="text-red-400 hover:text-red-600 shrink-0"
                        onClick={() => setForm({
                          ...form,
                          correctiveActionPlan: form.correctiveActionPlan.filter((_, idx) => idx !== i),
                        })}
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-xs gap-1"
                onClick={() => setForm({ ...form, correctiveActionPlan: [...form.correctiveActionPlan, ""] })}
              >
                <Plus className="h-3 w-3" /> Add Action
              </Button>
            </div>

            {/* Compensation */}
            <div className="p-4 border border-border rounded-md bg-muted/20 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Eligible for Compensation?</h4>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, eligibleForCompensation: true })}
                  className={cn(
                    "px-4 py-1.5 rounded-md text-xs font-semibold border transition-colors",
                    form.eligibleForCompensation
                      ? "bg-emerald-500 text-white border-emerald-500"
                      : "bg-background text-foreground border-border hover:bg-muted",
                  )}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, eligibleForCompensation: false })}
                  className={cn(
                    "px-4 py-1.5 rounded-md text-xs font-semibold border transition-colors",
                    !form.eligibleForCompensation
                      ? "bg-red-500 text-white border-red-500"
                      : "bg-background text-foreground border-border hover:bg-muted",
                  )}
                >
                  No
                </button>
              </div>
              <div>
                <Label className="text-xs">
                  Justification <span className="text-red-500">*</span>
                  <span className="text-muted-foreground font-normal ml-1">
                    ({form.eligibleForCompensation ? "explain why compensation applies" : "explain why compensation does not apply"})
                  </span>
                </Label>
                <Textarea
                  className="mt-1 text-sm"
                  value={form.compensationJustification}
                  onChange={(e) => setForm({ ...form, compensationJustification: e.target.value })}
                  placeholder="Provide justification..."
                />
              </div>
            </div>

            {/* Prepared By — auto-saved display */}
            <div className="p-3 bg-primary/5 border border-primary/20 rounded-md">
              <p className="text-xs font-semibold text-primary mb-1.5">Prepared By (auto-saved on submit)</p>
              <div className="grid grid-cols-3 gap-2 text-xs text-foreground">
                <div><span className="text-muted-foreground">Name: </span>{role}</div>
                <div><span className="text-muted-foreground">Designation: </span>Senior Executive-Food Safety & Hygiene</div>
                <div><span className="text-muted-foreground">Date & Time: </span>{nowStamp()}</div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} className="gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> Submit for Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Detail Modal ─────────────────────────────────────────────────── */}
      {viewEntry && (
        <Dialog open={viewOpen} onOpenChange={setViewOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                {viewEntry.id} — Wastage / Damaged Product Disposal Report
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-5 py-1">
              {/* Report meta */}
              <div className="grid grid-cols-3 gap-2 text-xs p-3 bg-muted/30 rounded-md border border-border">
                <div><span className="text-muted-foreground">Reporting Date: </span><strong>{viewEntry.reportingDate}</strong></div>
                <div><span className="text-muted-foreground">Type: </span><strong>{viewEntry.wastageType}</strong></div>
                <div className="flex items-center gap-1"><span className="text-muted-foreground">Status: </span><StatusBadge status={viewEntry.status} /></div>
                {viewEntry.returnRef && (
                  <div className="col-span-3"><span className="text-muted-foreground">Return Ref: </span><strong className="font-mono">{viewEntry.returnRef}</strong></div>
                )}
              </div>

              {/* Parameters table */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Wastage / Damaged Product Disposal</h4>
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs w-10">SL.</TableHead>
                        <TableHead className="text-xs">Name of Parameters</TableHead>
                        <TableHead className="text-xs text-center">Specifications</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        ["01", "Name of RM/PM/FG",       viewEntry.itemName],
                        ["02", "Package/Batch Size",      viewEntry.packageBatchSize],
                        ["03", "Batch Code",              viewEntry.batchCode],
                        ["04", "Production Date",         viewEntry.productionDate],
                        ["05", "Disposal Quantity",       `${viewEntry.disposalQty} ${viewEntry.disposalQtyUnit}`],
                        ["06", "Disposal Reason",         viewEntry.disposalReason],
                        ["07", "Reprocessing Possibility",viewEntry.reprocessingPossibility],
                        ["08", "Disposal Method",         viewEntry.disposalMethod],
                        ["09", "Disposal Date",           viewEntry.disposalDate],
                        ["10", "Disposal Time",           viewEntry.disposalTime],
                      ].map(([sl, name, value]) => {
                        const linkedProd = sl === "03"
                          ? productionEntries.find((e) => e.id === value)
                          : null;
                        return (
                          <TableRow key={sl}>
                            <TableCell className="text-xs text-muted-foreground font-mono">{sl}</TableCell>
                            <TableCell className="text-xs font-medium">{name}</TableCell>
                            <TableCell className="text-xs text-center">
                              {linkedProd ? (
                                <button
                                  className="font-mono font-semibold text-primary hover:underline"
                                  onClick={() => { setProdDetailEntry(linkedProd); setProdDetailOpen(true); }}
                                >
                                  {value}
                                </button>
                              ) : value}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Root Cause */}
              <div>
                <p className="text-xs font-bold mb-1">Root Cause of Rejection:</p>
                <p className="text-sm bg-muted/30 p-3 rounded-md leading-relaxed">{viewEntry.rootCause}</p>
              </div>

              {/* Responsible Persons */}
              {viewEntry.responsiblePersons.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Responsible Person of Flight Kitchen</h4>
                  <div className="border border-border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead className="text-xs">#SL</TableHead>
                          <TableHead className="text-xs">ID</TableHead>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Designation</TableHead>
                          <TableHead className="text-xs">Section</TableHead>
                          <TableHead className="text-xs">Penalty Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewEntry.responsiblePersons.map((p, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs font-mono">{String(i+1).padStart(2,"0")}</TableCell>
                            <TableCell className="text-xs font-mono">{p.empId || "—"}</TableCell>
                            <TableCell className="text-xs font-medium">{p.name}</TableCell>
                            <TableCell className="text-xs">{p.designation}</TableCell>
                            <TableCell className="text-xs">{p.section}</TableCell>
                            <TableCell className="text-xs font-semibold">
                              {p.penaltyAmount > 0 ? `Tk. ${p.penaltyAmount.toLocaleString()}/-` : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Correction */}
              <div>
                <p className="text-xs font-bold mb-1">Correction:</p>
                <p className="text-sm bg-muted/30 p-3 rounded-md">{viewEntry.correction}</p>
              </div>

              {/* Corrective Action Plan */}
              {viewEntry.correctiveActionPlan.length > 0 && (
                <div>
                  <p className="text-xs font-bold mb-2">Corrective Action Plan:</p>
                  <ol className="list-decimal list-inside space-y-1.5 pl-1">
                    {viewEntry.correctiveActionPlan.map((a, i) => (
                      <li key={i} className="text-sm text-foreground">{a}</li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Compensation */}
              <div className={cn(
                "p-3 rounded-md border",
                viewEntry.eligibleForCompensation ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200",
              )}>
                <p className="text-xs font-bold mb-1">
                  Eligible for Compensation:{" "}
                  <span className={viewEntry.eligibleForCompensation ? "text-emerald-700" : "text-red-700"}>
                    {viewEntry.eligibleForCompensation ? "Yes" : "No"}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">{viewEntry.compensationJustification}</p>
              </div>

              {/* Stock Impact */}
              {viewEntry.stockItemName && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-md">
                  <p className="text-xs font-bold text-orange-700 mb-2 flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" /> Stock Impact — {viewEntry.stockItemName}
                  </p>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div><span className="text-muted-foreground">QTY Before Wastage: </span><strong>{viewEntry.previousStock ?? "—"}</strong></div>
                    <div><span className="text-muted-foreground">Disposal QTY: </span><strong className="text-red-600">−{viewEntry.disposalQty} {viewEntry.disposalQtyUnit}</strong></div>
                    <div>
                      <span className="text-muted-foreground">Current QTY: </span>
                      <strong>{(viewEntry.previousStock ?? 0) - viewEntry.disposalQty}</strong>
                    </div>
                  </div>
                  {viewEntry.status !== "Final Approved" ? (
                    <p className="text-[11px] text-orange-600 mt-1.5 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Stock will be updated upon Final Approval.
                    </p>
                  ) : (
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <p className="text-[11px] text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Stock has been updated.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px] gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                        onClick={() => {
                          const targetIds: string[] = [];
                          try {
                            const raw = window.localStorage.getItem("harvest-data-v1:inventory-items");
                            const invItems: Array<{ id: string; name: string }> = raw ? JSON.parse(raw) : [];
                            if (viewEntry.wastageType === "Production") {
                              const recipe = resolveProductionItem({ name: viewEntry.itemName });
                              const matNames = new Set([
                                ...recipe.rawMaterials,
                                ...recipe.packagingMaterials,
                                ...recipe.otherConsumption,
                              ].map((m) => m.itemName.toLowerCase()));
                              invItems.forEach((i) => { if (matNames.has(i.name.toLowerCase())) targetIds.push(i.id); });
                            }
                            const main = invItems.find((i) => i.name.toLowerCase() === viewEntry.stockItemName!.toLowerCase());
                            if (main) targetIds.push(main.id);
                          } catch { /* ok */ }
                          try {
                            sessionStorage.setItem("wastage-stock-ref", JSON.stringify({ wastageId: viewEntry.id, itemIds: targetIds }));
                          } catch { /* ok */ }
                          flagArrival({ target: "inv-alerts", ids: targetIds });
                          setViewOpen(false);
                          navigate("/inventory");
                        }}
                      >
                        <Search className="h-3 w-3" /> Check Stock
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Approval Log Timeline */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <History className="h-3.5 w-3.5" /> Approval Log
                </h4>
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs">Step</TableHead>
                        <TableHead className="text-xs">By</TableHead>
                        <TableHead className="text-xs">Designation</TableHead>
                        <TableHead className="text-xs">Action</TableHead>
                        <TableHead className="text-xs">Date & Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewEntry.approvalSteps.map((step, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs font-medium">{step.step}</TableCell>
                          <TableCell className="text-xs">{step.by}</TableCell>
                          <TableCell className="text-xs">{step.designation}</TableCell>
                          <TableCell>
                            <span className={cn(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                              step.action === "Submitted" ? "bg-blue-100 text-blue-700" :
                              step.action === "Approved"  ? "bg-emerald-100 text-emerald-700" :
                              step.action === "Rejected"  ? "bg-red-100 text-red-700" :
                                                            "bg-amber-100 text-amber-700",
                            )}>
                              {step.action}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">{step.at}</TableCell>
                        </TableRow>
                      ))}
                      {/* Pending placeholder rows */}
                      {viewEntry.status === "Pending In-Charge" && (
                        <TableRow className="bg-amber-50/50">
                          <TableCell className="text-xs text-muted-foreground">Production In-Charge</TableCell>
                          <TableCell colSpan={4} className="text-xs text-amber-600 italic">Awaiting review in Approval Management...</TableCell>
                        </TableRow>
                      )}
                      {["Pending GM", "Pending In-Charge"].includes(viewEntry.status) && (
                        <TableRow className="bg-muted/20">
                          <TableCell className="text-xs text-muted-foreground">GM Catering</TableCell>
                          <TableCell colSpan={4} className="text-xs text-muted-foreground italic">Pending...</TableCell>
                        </TableRow>
                      )}
                      {["Pending Final", "Pending GM", "Pending In-Charge"].includes(viewEntry.status) && (
                        <TableRow className="bg-muted/20">
                          <TableCell className="text-xs text-muted-foreground">Final Authorization</TableCell>
                          <TableCell colSpan={4} className="text-xs text-muted-foreground italic">Pending...</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setViewOpen(false)}>Close</Button>
              {viewEntry.status === "Final Approved" && (
                <Button
                  variant="outline"
                  className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  onClick={() => {
                    const lines: string[] = [
                      `WASTAGE / DAMAGED PRODUCT DISPOSAL REPORT`,
                      `Form No: USBA-FSH-WDD  |  Rev. No: 00`,
                      `─────────────────────────────────────────`,
                      `Report ID    : ${viewEntry.id}`,
                      `Reporting Date: ${viewEntry.reportingDate}`,
                      `Wastage Type : ${viewEntry.wastageType}`,
                      `Status       : ${viewEntry.status}`,
                      ``,
                      `DISPOSAL DETAILS`,
                      `Item Name    : ${viewEntry.itemName}`,
                      `Batch Code   : ${viewEntry.batchCode}`,
                      `Prod. Date   : ${viewEntry.productionDate}`,
                      `Disposal Qty : ${viewEntry.disposalQty} ${viewEntry.disposalQtyUnit}`,
                      `Reason       : ${viewEntry.disposalReason}`,
                      `Method       : ${viewEntry.disposalMethod}`,
                      `Disposal Date: ${viewEntry.disposalDate}`,
                      `Disposal Time: ${viewEntry.disposalTime}`,
                      `Reprocessing : ${viewEntry.reprocessingPossibility}`,
                      ``,
                      `ROOT CAUSE`,
                      viewEntry.rootCause,
                      ``,
                      `CORRECTIVE ACTION PLAN`,
                      ...viewEntry.correctiveActionPlan.map((a, i) => `  ${i + 1}. ${a}`),
                      ``,
                      `COMPENSATION`,
                      `Eligible     : ${viewEntry.eligibleForCompensation ? "Yes" : "No"}`,
                      viewEntry.compensationJustification,
                      ``,
                      `RESPONSIBLE PERSONS`,
                      ...viewEntry.responsiblePersons.map((p) =>
                        `  ${p.name} (${p.designation}) — ${p.section}${p.penaltyAmount > 0 ? ` — Penalty: Tk. ${p.penaltyAmount}` : ""}`
                      ),
                      ``,
                      `APPROVAL LOG`,
                      ...viewEntry.approvalSteps.map((s) => `  [${s.action}] ${s.step} — ${s.by} (${s.designation}) — ${s.at}`),
                      ``,
                      `Prepared By  : ${viewEntry.preparedBy}`,
                      `Prepared At  : ${viewEntry.preparedAt}`,
                    ];
                    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${viewEntry.id}-Disposal-Report.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="h-4 w-4" /> Export
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Stock / Quantity Log Modal ─────────────────────────────────────────── */}
      {stockLogEntry && (
        <Dialog open={stockLogOpen} onOpenChange={setStockLogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                Disposal Quantity Log — {stockLogEntry.id}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <div className="grid grid-cols-2 gap-3 text-xs p-3 bg-muted/30 rounded-md">
                <div><span className="text-muted-foreground">Item: </span><strong>{stockLogEntry.itemName}</strong></div>
                <div><span className="text-muted-foreground">Type: </span><strong>{stockLogEntry.wastageType}</strong></div>
                <div><span className="text-muted-foreground">Qty Disposed: </span><strong className="text-red-600">{stockLogEntry.disposalQty} {stockLogEntry.disposalQtyUnit}</strong></div>
                <div className="flex items-center gap-1"><span className="text-muted-foreground">Status: </span><StatusBadge status={stockLogEntry.status} /></div>
              </div>

              {stockLogEntry.wastageType === "Production" && stockLogEntry.stockItemName ? (
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs">Movement</TableHead>
                        <TableHead className="text-xs">Quantity</TableHead>
                        <TableHead className="text-xs">Reference</TableHead>
                        <TableHead className="text-xs">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="text-xs font-medium">Opening Stock</TableCell>
                        <TableCell className="text-xs tabular-nums">{stockLogEntry.previousStock ?? 0} {stockLogEntry.disposalQtyUnit}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">—</TableCell>
                        <TableCell className="text-xs">{stockLogEntry.reportingDate}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-xs text-red-600 font-medium">Wastage Disposal</TableCell>
                        <TableCell className="text-xs tabular-nums text-red-600 font-semibold">−{stockLogEntry.disposalQty} {stockLogEntry.disposalQtyUnit}</TableCell>
                        <TableCell className="text-xs font-mono">{stockLogEntry.id}</TableCell>
                        <TableCell className="text-xs">{stockLogEntry.reportingDate}</TableCell>
                      </TableRow>
                      <TableRow className="bg-muted/30">
                        <TableCell className="text-xs font-bold">Closing Balance</TableCell>
                        <TableCell className="text-xs tabular-nums font-bold text-primary">
                          {(stockLogEntry.previousStock ?? 0) - stockLogEntry.disposalQty} {stockLogEntry.disposalQtyUnit}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {stockLogEntry.status === "Final Approved" ? "Updated ✓" : "Pending Final Approval"}
                        </TableCell>
                        <TableCell className="text-xs">{stockLogEntry.reportingDate}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground p-3 bg-muted/20 rounded-md">
                  {stockLogEntry.wastageType === "Airport Store"
                    ? "Airport store stock adjustment will be reflected upon Final Approval."
                    : "Disposal quantity logged. Stock impact not applicable for this type."}
                </div>
              )}

              <div className="text-xs text-muted-foreground border-t border-border pt-3">
                <strong>Reason:</strong> {stockLogEntry.disposalReason}
                {stockLogEntry.returnRef && (
                  <span className="ml-3"><strong>Return Ref:</strong> {stockLogEntry.returnRef}</span>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setStockLogOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Production Order Detail Modal ─────────────────────────────────────── */}
      {prodDetailEntry && (
        <Dialog open={prodDetailOpen} onOpenChange={(o) => { setProdDetailOpen(o); if (!o) setProdDetailEntry(null); }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4 text-primary" />
                Production Order — {prodDetailEntry.id}
              </DialogTitle>
            </DialogHeader>

            {(() => {
              const recipe = resolveProductionItem({
                name: prodDetailEntry.outputItemName ?? prodDetailEntry.bom,
                code: prodDetailEntry.outputItemCode,
              });
              const qty = prodDetailEntry.producedQty;
              const money = (n: number) =>
                n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const sections = [
                { label: "Raw Materials",       rows: recipe.rawMaterials       },
                { label: "Packaging Materials", rows: recipe.packagingMaterials },
                { label: "Other Consumption",   rows: recipe.otherConsumption   },
              ];
              const totalCogs = [...recipe.rawMaterials, ...recipe.packagingMaterials, ...recipe.otherConsumption]
                .reduce((s, m) => s + m.qtyPerUnit * qty * m.rate, 0);
              return (
                <div className="space-y-4 py-1">
                  {/* Summary strip */}
                  <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 border border-border rounded-md text-xs">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Item</p>
                      <p className="font-semibold">{recipe.name}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">BOM / Code</p>
                      <p>{prodDetailEntry.bom}{prodDetailEntry.outputItemCode ? ` · ${prodDetailEntry.outputItemCode}` : ""}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Production Date</p>
                      <p>{prodDetailEntry.date}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Produced Qty</p>
                      <p className="font-semibold tabular-nums">{qty.toLocaleString()}</p>
                    </div>
                    {prodDetailEntry.orderQty != null && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Order Qty (Planned)</p>
                        <p className="tabular-nums">{prodDetailEntry.orderQty.toLocaleString()}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Status</p>
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                        prodDetailEntry.status === "Completed"      ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
                        prodDetailEntry.status === "Re-Cook"        ? "bg-red-100 text-red-700 border-red-200" :
                        prodDetailEntry.status === "Ready for QC"   ? "bg-blue-100 text-blue-700 border-blue-200" :
                        prodDetailEntry.status === "In Preparation" ? "bg-amber-100 text-amber-700 border-amber-200" :
                                                                      "bg-muted text-muted-foreground border-border",
                      )}>
                        {prodDetailEntry.status}
                      </span>
                    </div>
                  </div>

                  {/* QC result */}
                  {(prodDetailEntry.qcFailedAt || prodDetailEntry.qcPassedAt) && (
                    <div className={cn(
                      "p-3 rounded-md border text-xs space-y-1.5",
                      prodDetailEntry.status === "Re-Cook" ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200",
                    )}>
                      <p className={cn(
                        "text-[10px] font-bold uppercase tracking-wider",
                        prodDetailEntry.status === "Re-Cook" ? "text-red-700" : "text-emerald-700",
                      )}>QC Result</p>
                      {prodDetailEntry.qcFailedAt && (
                        <div className="grid grid-cols-2 gap-2">
                          <div><span className="text-muted-foreground">Failed At: </span><span className="tabular-nums">{prodDetailEntry.qcFailedAt}</span></div>
                          {prodDetailEntry.qcFailedBy && <div><span className="text-muted-foreground">By: </span>{prodDetailEntry.qcFailedBy}</div>}
                        </div>
                      )}
                      {prodDetailEntry.qcFailReason && (
                        <div className="mt-1 p-2 bg-red-100 border border-red-200 rounded text-red-700">
                          <span className="font-semibold">Fail Reason: </span>{prodDetailEntry.qcFailReason}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Material Requirements */}
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Material Requirements</p>
                    {sections.map(({ label, rows }) =>
                      rows.length === 0 ? null : (
                        <div key={label} className="mb-4">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}</p>
                          <div className="border border-border rounded-md overflow-hidden">
                            <Table>
                              <TableHeader className="bg-muted/40">
                                <TableRow>
                                  <TableHead className="text-xs uppercase tracking-wider">Item Code</TableHead>
                                  <TableHead className="text-xs uppercase tracking-wider">Item Name</TableHead>
                                  <TableHead className="text-xs uppercase tracking-wider">UOM</TableHead>
                                  <TableHead className="text-xs uppercase tracking-wider text-right">Req. Qty</TableHead>
                                  <TableHead className="text-xs uppercase tracking-wider text-right">Rate (৳)</TableHead>
                                  <TableHead className="text-xs uppercase tracking-wider text-right">Line Cost (৳)</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {rows.map((m) => {
                                  const reqQty = m.qtyPerUnit * qty;
                                  return (
                                    <TableRow key={m.itemCode}>
                                      <TableCell className="font-mono text-xs">{m.itemCode}</TableCell>
                                      <TableCell className="font-medium text-xs">{m.itemName}</TableCell>
                                      <TableCell className="text-xs">{m.uom}</TableCell>
                                      <TableCell className="text-xs text-right tabular-nums">{reqQty.toFixed(3)}</TableCell>
                                      <TableCell className="text-xs text-right tabular-nums text-muted-foreground">{money(m.rate)}</TableCell>
                                      <TableCell className="text-xs text-right tabular-nums font-medium">{money(reqQty * m.rate)}</TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )
                    )}
                  </div>

                  {/* Total COGS */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-xs">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total COGS — {qty.toLocaleString()} units</p>
                      <p className="mt-1 text-base font-semibold tabular-nums text-primary">৳ {money(totalCogs)}</p>
                    </div>
                    <div className="rounded-md border border-border bg-muted/20 px-4 py-3 text-xs">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cost per Unit</p>
                      <p className="mt-1 text-base font-semibold tabular-nums">৳ {qty > 0 ? money(totalCogs / qty) : "0.00"}</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => { setProdDetailOpen(false); setProdDetailEntry(null); }}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
