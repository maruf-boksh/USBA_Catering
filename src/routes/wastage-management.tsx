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
  Pencil, HandCoins, ArrowLeft, Building2, Warehouse as WarehouseIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRole } from "@/lib/roles";
import { useWorkflow, type WfProductionEntry } from "@/lib/workflow-store";
import { resolveProductionItem } from "@/lib/meal-recipe";
import { inventory, consumableItems, activeItems, activeOffices, activeWarehousesByOffice, offices as ALL_OFFICES, warehouses as ALL_WAREHOUSES } from "@/lib/sample-data";

// ── Shared types (exported so approval-management can consume them) ────────────

export type WastageType = "Production" | "Airport Store" | "Return Item" | "Transfer";

// Wastage types whose disposal is backed by an inventory stock item (item-name
// autocomplete + stock summary + stock reduction on Final Approval).
export const STOCK_BACKED_TYPES: WastageType[] = ["Production", "Airport Store", "Transfer"];
export const isStockBackedType = (t: WastageType | ""): boolean =>
  t === "Production" || t === "Airport Store" || t === "Transfer";

// Accountability fields (Responsible Person, Correction, Corrective Action Plan,
// Eligible for Compensation) apply to Production wastage only — they are NOT
// captured for Galley Returns ("Airport Store") or Transfer wastage.
export const isAccountabilityType = (t: WastageType | ""): boolean =>
  t !== "Airport Store" && t !== "Transfer";

// Salvage-sale details captured when the Disposal Method is "Sell".
export type WastageSaleDetails = {
  buyer: string;
  saleQty: number;
  unit: string;
  unitPrice: number;
  totalValue: number;
  paymentMode: string;
  reference: string;
  remarks: string;
  saleDate: string;
  // Payment-mode specific details
  bankAccountNo?: string;   // Bank Transfer
  mobileProvider?: string;  // Mobile Banking — Bkash / Nagad / <custom>
  mobileNo?: string;        // Mobile Banking number
  chequeNo?: string;        // Cheque
  chequeImage?: string;     // Cheque image file name
  otherMethod?: string;     // Other — payment method name
  otherDocument?: string;   // Other — uploaded document file name
};

// Display labels for wastage types. The stored VALUES stay stable ("Production",
// "Airport Store", "Return Item") so all branching / persisted data is untouched;
// only what the user sees is renamed here.
const WASTAGE_TYPE_LABELS: Record<WastageType, string> = {
  "Production": "Production Wastage",
  "Airport Store": "Galley Return Wastage",
  "Return Item": "Return Item",
  "Transfer": "Transfer Wastage",
};
function wastageTypeLabel(t: WastageType | ""): string {
  return t ? WASTAGE_TYPE_LABELS[t] : "Unspecified";
}

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
  officeId?: string;
  warehouseId?: string;
  returnRef?: string;
  stockItemName?: string;
  previousStock?: number;
  saleDetails?: WastageSaleDetails;
};

// Minimal shape of a Transfer-module row (kind "Return") read from the shared
// "transfer-rows" store — just what the returned-transfer picker needs.
type TransferReturnLite = {
  id: string;
  date: string;
  trRef: string;
  from: string;
  to: string;
  kind: string;
  status: string;
  lines: { id: string; item: string; uom: string; requestedQty: number; transferredQty: number }[];
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
  "Destroy",
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

function nowTime(): string {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`;
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
  wastageType: WastageType | "";
  officeId: string;
  warehouseId: string;
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
  // Returned-transfer picker (Transfer type)
  selectedTransferReturnIds: string[];
  selectedTransferLineIdx: number;
};

const emptyForm = (): FormState => ({
  wastageType: "",
  officeId: "",
  warehouseId: "",
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
  selectedTransferReturnIds: [],
  selectedTransferLineIdx: -1,
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
  const [editId, setEditId] = useState<string | null>(null);

  // Item-picker cascade filters (Item Type → Category → Sub-category → Item).
  const [itemTypeFilter, setItemTypeFilter] = useState("");
  const [itemCatFilter, setItemCatFilter] = useState("");
  const [itemSubFilter, setItemSubFilter] = useState("");
  const itemTypeChoices = useMemo(() => Array.from(new Set(activeItems.map((i) => i.itemType))), []);
  const itemCatChoices = useMemo(
    () => Array.from(new Set(activeItems.filter((i) => !itemTypeFilter || i.itemType === itemTypeFilter).map((i) => i.category))).sort(),
    [itemTypeFilter],
  );
  const itemSubChoices = useMemo(
    () => Array.from(new Set(activeItems
      .filter((i) => (!itemTypeFilter || i.itemType === itemTypeFilter) && (!itemCatFilter || i.category === itemCatFilter))
      .map((i) => i.subCategory).filter(Boolean))).sort(),
    [itemTypeFilter, itemCatFilter],
  );
  const itemChoices = useMemo(
    () => activeItems.filter((i) =>
      (!itemTypeFilter || i.itemType === itemTypeFilter) &&
      (!itemCatFilter || i.category === itemCatFilter) &&
      (!itemSubFilter || i.subCategory === itemSubFilter)),
    [itemTypeFilter, itemCatFilter, itemSubFilter],
  );

  // Production Date (field 02) only shows for Production wastage, so fields after
  // it shift down by one when it's hidden — keeps the numbering gap-free.
  const fieldNo = (n: number) => String(form.wastageType === "Production" ? n : n - 1).padStart(2, "0");

  const [viewOpen, setViewOpen] = useState(false);
  const [viewEntry, setViewEntry] = useState<WastageEntry | null>(null);

  const [stockLogOpen, setStockLogOpen] = useState(false);
  const [stockLogEntry, setStockLogEntry] = useState<WastageEntry | null>(null);

  const [prodDetailOpen, setProdDetailOpen] = useState(false);
  const [prodDetailEntry, setProdDetailEntry] = useState<WfProductionEntry | null>(null);

  // ── Inventory + Returns reads for form autocomplete ────────────────────────

  // Production / kitchen inventory. The persisted "inventory-items" store is
  // only populated once the Inventory page has mounted; fall back to the full
  // sample-data catalog so the item name → stock autocomplete always works.
  const [persistedInventory] = usePersistedState<{ id?: string; name: string; stock: number; uom?: string; }[]>("inventory-items", []);
  const kitchenItems = useMemo(
    () =>
      persistedInventory.length > 0
        ? persistedInventory
        : inventory.map((i) => ({ id: i.id, name: i.name, stock: i.stock, uom: i.uom })),
    [persistedInventory],
  );
  // Airport store (airline consumables / galley) inventory — same key & seed as
  // the Inventory page uses, so live stock is shared without clobbering.
  const [persistedAirport] = usePersistedState<typeof consumableItems>("airline-consumables-items", consumableItems);
  const airportItems = useMemo(
    () => persistedAirport.map((c) => ({ id: c.id, name: c.name, stock: c.stock, uom: c.uom })),
    [persistedAirport],
  );
  const [consumableReturns] = usePersistedState<{ id: string; date: string; flight?: string; sector?: string; lines: { itemId?: string; itemName: string; qty: number; uom: string; }[] }[]>("consumable-returns", []);

  const [stockDropOpen, setStockDropOpen] = useState(false);

  const { productionEntries } = useWorkflow();
  const recookBatches = useMemo(
    () => productionEntries.filter((e) => e.status === "Re-Cook"),
    [productionEntries]
  );

  // Resolve the current on-hand quantity for an item from the correct source per
  // wastage type: Airport Store → airport (galley) stock, Transfer → kitchen or
  // airport inventory stock, Production → inventory stock if the FG is stocked,
  // else the total produced quantity from production entries.
  const stockForItem = (name: string, type: WastageType | ""): number => {
    const q = name.trim().toLowerCase();
    if (!q) return 0;
    const kitchen = kitchenItems.find((i) => i.name.toLowerCase() === q);
    const airport = airportItems.find((i) => i.name.toLowerCase() === q);
    if (type === "Airport Store") return airport?.stock ?? 0;
    if (type === "Transfer") return (kitchen ?? airport)?.stock ?? 0;
    // Production (default): prefer stocked inventory, else total produced FG qty.
    if (kitchen) return kitchen.stock;
    return productionEntries
      .filter((e) => (e.outputItemName ?? e.bom).trim().toLowerCase() === q)
      .reduce((s, e) => s + (e.producedQty || 0), 0);
  };

  const todayReturns = useMemo(() => {
    const today = todayDate();
    return consumableReturns.filter((r) => r.date === today);
  }, [consumableReturns]);

  // Returned transfers (Transfer module rows with kind "Return"). Read-only from
  // localStorage so we never clobber the Transfer page's own persisted store;
  // re-read whenever the Create/Edit modal opens.
  const returnedTransfers = useMemo<TransferReturnLite[]>(() => {
    try {
      const raw = window.localStorage.getItem("harvest-data-v1:transfer-rows");
      const rows = raw ? (JSON.parse(raw) as TransferReturnLite[]) : [];
      return rows.filter((t) => t.kind === "Return");
    } catch {
      return [];
    }
  }, [createOpen]);

  const stockSuggestions = useMemo(() => {
    if (!isStockBackedType(form.wastageType)) return [];
    const q = form.itemName.trim().toLowerCase();
    if (!q) return [];
    // Production → kitchen items · Airport Store → airport items ·
    // Transfer → both (items may be damaged while receiving either).
    const source =
      form.wastageType === "Airport Store" ? airportItems :
      form.wastageType === "Transfer"      ? [...kitchenItems, ...airportItems] :
                                             kitchenItems;
    const seen = new Set<string>();
    return source
      .filter((i) => i.name.toLowerCase().includes(q))
      .filter((i) => { const k = i.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 8);
  }, [kitchenItems, airportItems, form.itemName, form.wastageType]);

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
    if (!form.rootCause.trim()) { toast.error("Root cause is required."); return; }
    if (!form.officeId) { toast.error("Office is required."); return; }
    if (!form.warehouseId) { toast.error("Warehouse is required."); return; }

    const at = nowStamp();
    const sysDate = todayDate();   // 09. Disposal Date — system generated
    const sysTime = nowTime();     // 10. Disposal Time — system generated
    const newEntry: WastageEntry = {
      id: genId(entries),
      reportingDate: todayDate(),
      wastageType: form.wastageType as WastageType, // optional — may be "" (Unspecified); type-specific features just don't trigger
      officeId: form.officeId,
      warehouseId: form.warehouseId,
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
      disposalDate: sysDate,
      disposalTime: sysTime,
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
      ...(isStockBackedType(form.wastageType) && form.stockItemName.trim()
        ? { stockItemName: form.stockItemName.trim(), previousStock: Number(form.previousStock) || 0 }
        : {}),
      ...(form.wastageType === "Airport Store" && form.selectedReturnIds.length
        ? { returnRef: form.selectedReturnIds.join(", ") }
        : {}),
      ...(form.wastageType === "Transfer" && form.selectedTransferReturnIds.length
        ? { returnRef: form.selectedTransferReturnIds.join(", ") }
        : {}),
    };

    if (editId) {
      // Edit mode — keep identity, ownership, approval trail & original
      // system-generated disposal date/time; patch the rest.
      setEntries((prev) =>
        prev.map((e) =>
          e.id === editId
            ? {
                ...newEntry,
                id: e.id,
                reportingDate: e.reportingDate,
                preparedBy: e.preparedBy,
                preparedByDesignation: e.preparedByDesignation,
                preparedAt: e.preparedAt,
                status: e.status,
                approvalSteps: e.approvalSteps,
                disposalDate: e.disposalDate,
                disposalTime: e.disposalTime,
              }
            : e
        )
      );
      toast.success(`${editId} updated.`);
    } else {
      setEntries((prev) => [newEntry, ...prev]);
      toast.success(`${newEntry.id} submitted — pending Production In-Charge review.`);
    }
    setCreateOpen(false);
    setEditId(null);
    setForm(emptyForm());
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
      {!createOpen && (<>
      <PageHeader
        title="Damaged Product Disposal"
        subtitle="Production & Galley Returns Wastage — Disposal Reports & Approval Tracking"
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
            <TabsTrigger value="Production"    className="text-xs px-3 h-7">Production Wastage</TabsTrigger>
            <TabsTrigger value="Airport Store" className="text-xs px-3 h-7">Galley Return Wastage</TabsTrigger>
            <TabsTrigger value="Transfer"      className="text-xs px-3 h-7">Transfer Wastage</TabsTrigger>
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
            onClick={() => { setEditId(null); setForm(emptyForm()); setCreateOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" /> New Wastage/Disposal
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
                        onClick={() => { setEditId(null); setForm(emptyForm()); setCreateOpen(true); }}
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
                          entry.wastageType === "Transfer"      ? "bg-teal-100 text-teal-700" :
                          entry.wastageType === "Return Item"   ? "bg-violet-100 text-violet-700" :
                                                                  "bg-slate-100 text-slate-600",
                        )}>
                          {wastageTypeLabel(entry.wastageType)}
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
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7 text-muted-foreground hover:text-primary hover:border-primary/40"
                            title="View details"
                            onClick={() => { setViewEntry(entry); setViewOpen(true); }}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      </>)}

      {/* ── Create / Edit Form — full page (formerly a modal) ──────────────────── */}
      {createOpen && (
      <>
        <PageHeader
          title={editId ? `Edit Wastage Report — ${editId}` : "New Wastage / Damaged Product Disposal"}
          subtitle="Production, Galley Return & Transfer Wastage — Disposal Report"
          icon={editId ? <Pencil className="h-5 w-5 text-primary" /> : <Trash2 className="h-5 w-5 text-primary" />}
          actions={
            <Button variant="outline" size="sm" onClick={() => { setCreateOpen(false); setEditId(null); }}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to list
            </Button>
          }
        />
        <div className="space-y-5 pb-4">

          <Card>
            <CardContent className="pt-6 space-y-6">

            {/* Type selector */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">Wastage Type <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Select
                  value={form.wastageType || "none"}
                  onValueChange={(v) => setForm({
                    ...form,
                    wastageType: v === "none" ? "" : (v as WastageType),
                    stockItemName: "",
                    previousStock: "",
                    returnRef: "",
                    selectedReturnIds: [],
                    selectedReturnLineIdx: -1,
                    selectedRecookBatchIds: [],
                    recookBatchQtys: {},
                    selectedTransferReturnIds: [],
                    selectedTransferLineIdx: -1,
                    itemName: "",
                    disposalQty: "",
                  })}
                >
                  <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None — general disposal (no type link)</SelectItem>
                    <SelectItem value="Production">Production Wastage</SelectItem>
                    <SelectItem value="Airport Store">Galley Return Wastage</SelectItem>
                    <SelectItem value="Transfer">Transfer Wastage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1"><Building2 className="h-3 w-3" /> Office <span className="text-red-500">*</span></Label>
                <Select value={form.officeId || undefined} onValueChange={(v) => setForm({ ...form, officeId: v, warehouseId: "" })}>
                  <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Select office" /></SelectTrigger>
                  <SelectContent>
                    {activeOffices.map((o) => <SelectItem key={o.id} value={o.id} className="text-sm">{o.code} — {o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1"><WarehouseIcon className="h-3 w-3" /> Warehouse <span className="text-red-500">*</span></Label>
                <Select value={form.warehouseId || undefined} onValueChange={(v) => setForm({ ...form, warehouseId: v })} disabled={!form.officeId}>
                  <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder={form.officeId ? "Select warehouse" : "Select office first"} /></SelectTrigger>
                  <SelectContent>
                    {(form.officeId ? activeWarehousesByOffice(form.officeId) : []).map((w) => (
                      <SelectItem key={w.id} value={w.id} className="text-sm">{w.code} — {w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Transfer — items damaged while receiving */}
            {form.wastageType === "Transfer" && (
              <div className="p-3 bg-teal-50 border border-teal-200 rounded-md flex items-start gap-2">
                <Package className="h-4 w-4 text-teal-700 shrink-0 mt-0.5" />
                <p className="text-[11px] text-teal-700 leading-relaxed">
                  <strong>Transfer wastage</strong> records items found damaged while receiving a stock
                  transfer. Select the returned transfer(s) below to populate the disposal — or search the
                  received item manually. The damaged quantity is deducted from stock on Final Approval.
                </p>
              </div>
            )}

            {/* Returned Transfers — checkbox multi-select, shown under Transfer */}
            {form.wastageType === "Transfer" && (
              <div className="p-3 bg-teal-50 border border-teal-200 rounded-md space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-teal-700">Select Returned Transfer(s)</h4>
                <div>
                  <Label className="text-xs">Returned Transfers <span className="text-red-500">*</span></Label>
                  {returnedTransfers.length === 0 ? (
                    <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      No returned transfers found. Return items from the Transfer module first.
                    </p>
                  ) : (
                    <div className="mt-1 border border-border rounded-md overflow-hidden bg-background">
                      {returnedTransfers.map((t) => (
                        <label
                          key={t.id}
                          className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-muted/40 border-b border-border last:border-0"
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-primary"
                            checked={form.selectedTransferReturnIds.includes(t.id)}
                            onChange={(e) => {
                              const ids = e.target.checked
                                ? [...form.selectedTransferReturnIds, t.id]
                                : form.selectedTransferReturnIds.filter((id) => id !== t.id);
                              const allLines = ids.flatMap((id) => {
                                const tr = returnedTransfers.find((x) => x.id === id);
                                return tr?.lines ?? [];
                              });
                              const single = allLines.length === 1;
                              const qty = single ? (allLines[0].transferredQty || allLines[0].requestedQty) : 0;
                              setForm({
                                ...form,
                                selectedTransferReturnIds: ids,
                                selectedTransferLineIdx: single ? 0 : -1,
                                itemName: single ? allLines[0].item : "",
                                stockItemName: single ? allLines[0].item : "",
                                previousStock: single ? String(stockForItem(allLines[0].item, "Transfer")) : "",
                                disposalQty: single ? String(qty) : "",
                                disposalQtyUnit: single ? allLines[0].uom : form.disposalQtyUnit,
                              });
                            }}
                          />
                          <span className="font-medium">{t.id}</span>
                          <span className="text-muted-foreground">· {t.from} → {t.to}</span>
                          {t.trRef && <span className="text-muted-foreground">({t.trRef})</span>}
                          <span className="ml-auto text-muted-foreground tabular-nums">{t.lines.length} item{t.lines.length !== 1 ? "s" : ""}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Combined line picker across all selected returned transfers */}
                {form.selectedTransferReturnIds.length > 0 && (() => {
                  const allLines = form.selectedTransferReturnIds.flatMap((id) => {
                    const tr = returnedTransfers.find((x) => x.id === id);
                    return (tr?.lines ?? []).map((line) => ({ ...line, fromId: id }));
                  });
                  if (allLines.length <= 1) return null;
                  return (
                    <div>
                      <Label className="text-xs">Select Return Item <span className="text-red-500">*</span></Label>
                      <div className="mt-1 border border-border rounded-md overflow-hidden">
                        {allLines.map((line, idx) => {
                          const qty = line.transferredQty || line.requestedQty;
                          return (
                            <div
                              key={idx}
                              onMouseDown={() => setForm({
                                ...form,
                                selectedTransferLineIdx: idx,
                                itemName: line.item,
                                stockItemName: line.item,
                                previousStock: String(stockForItem(line.item, "Transfer")),
                                disposalQty: String(qty),
                                disposalQtyUnit: line.uom,
                              })}
                              className={cn(
                                "px-3 py-2 text-xs cursor-pointer border-b border-border last:border-0 flex justify-between items-center",
                                form.selectedTransferLineIdx === idx
                                  ? "bg-primary/10 text-primary font-semibold"
                                  : "hover:bg-muted/40",
                              )}
                            >
                              <div className="flex flex-col">
                                <span>{line.item}</span>
                                <span className="text-[10px] text-muted-foreground font-normal">from {line.fromId}</span>
                              </div>
                              <span className="tabular-nums text-muted-foreground">{qty} {line.uom}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Auto-filled preview */}
                {form.selectedTransferLineIdx >= 0 && form.itemName && (
                  <div className="grid grid-cols-2 gap-2 text-xs p-2 bg-white/70 rounded border border-teal-200">
                    <div><span className="text-muted-foreground">Item: </span><strong>{form.itemName}</strong></div>
                    <div><span className="text-muted-foreground">Return Qty: </span><strong className="text-red-600">{form.disposalQty} {form.disposalQtyUnit}</strong></div>
                  </div>
                )}
              </div>
            )}

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
                                  previousStock: String(
                                    [...new Set(remaining.map((b) => b.outputItemName ?? b.bom))]
                                      .reduce((s, nm) => s + stockForItem(nm, "Production"), 0)
                                  ),
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
                            const itemStock = stockForItem(entry.outputItemName ?? entry.bom, "Production");
                            const isMulti = form.selectedRecookBatchIds.length > 1;
                            const hasMat = recipe.rawMaterials.length > 0 || recipe.packagingMaterials.length > 0 || recipe.otherConsumption.length > 0;
                            const matSections = [
                              { label: "Raw Materials",       rows: recipe.rawMaterials       },
                              { label: "Packaging Materials", rows: recipe.packagingMaterials },
                              { label: "Other Consumption",   rows: recipe.otherConsumption   },
                            ];
                            // Disposal can never exceed the Production Order QTY — no QTY can ever
                            // be negative. Production Order QTY stays constant; Current QTY updates
                            // as the disposal is entered.
                            const disposedQty = Math.max(0, Math.min(batchQty, itemStock));
                            const currentQty = Math.max(0, itemStock - disposedQty);
                            const unitCost = (m: { qtyPerUnit: number; rate: number }) => m.qtyPerUnit * m.rate;    // BOM money per FG unit
                            const lineCost = (m: { qtyPerUnit: number; rate: number }) => unitCost(m) * disposedQty; // per-item wastage value
                            const matCost = matSections.reduce(
                              (s, sec) => s + sec.rows.reduce((t, m) => t + lineCost(m), 0), 0,
                            );
                            // % loss is measured against the TOTAL production-order cost value
                            // (BOM cost per unit × produced qty) — a fixed base, independent of
                            // Current QTY.
                            const fullUnitCost = matSections.reduce(
                              (s, sec) => s + sec.rows.reduce((t, m) => t + unitCost(m), 0), 0,
                            );
                            const producedForCost = entry.producedQty || 0;
                            const totalProductionCost = fullUnitCost * producedForCost;
                            const lossPct = totalProductionCost > 0 ? (matCost / totalProductionCost) * 100 : 0;
                            return (
                              <>
                                <div className="flex items-center gap-2 px-4 pb-2 pt-0.5 bg-orange-50/70">
                                  <span className="text-[11px] text-orange-700 font-medium shrink-0">Disposal QTY for this FG:</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    max={itemStock}
                                    className="h-7 text-xs w-28"
                                    value={form.recookBatchQtys[entry.id] ?? ""}
                                    onChange={(e) => {
                                      // Disposal can never exceed available stock (Current QTY
                                      // can never be negative) — clamp to [0, QTY Before].
                                      const raw = Number(e.target.value);
                                      const clamped = e.target.value === ""
                                        ? ""
                                        : String(Math.max(0, Math.min(isNaN(raw) ? 0 : raw, itemStock)));
                                      const nextQtys = { ...form.recookBatchQtys, [entry.id]: clamped };
                                      // Keep field 05 (Disposal Quantity) in sync with the total
                                      // disposal entered across all selected re-cook FGs.
                                      const total = form.selectedRecookBatchIds
                                        .reduce((s, id) => s + (Number(nextQtys[id]) || 0), 0);
                                      setForm({
                                        ...form,
                                        recookBatchQtys: nextQtys,
                                        disposalQty: total > 0 ? String(total) : "",
                                      });
                                    }}
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
                                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Production Order QTY</p>
                                        <p className="text-xs font-bold mt-0.5">{itemStock.toLocaleString()} Units</p>
                                      </div>
                                      <div className="px-2 py-2 border-r border-orange-200">
                                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Disposal</p>
                                        <p className="text-xs font-bold mt-0.5 text-red-600">{disposedQty > 0 ? `−${disposedQty.toLocaleString()}` : "0"} Units</p>
                                      </div>
                                      <div className="px-2 py-2">
                                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Current QTY</p>
                                        <p className="text-xs font-bold mt-0.5 text-primary">{currentQty.toLocaleString()} Units</p>
                                      </div>
                                    </div>
                                    {batchQty === 0 ? (
                                      <div className="px-3 py-2.5 text-xs text-muted-foreground text-center italic">
                                        Enter Disposal QTY above to see material calculations.
                                      </div>
                                    ) : (
                                      <>
                                      {matSections.map(({ label, rows }) => rows.length === 0 ? null : (
                                        <div key={label}>
                                          <div className="flex items-center justify-between px-3 py-1 bg-orange-50 border-b border-orange-100">
                                            <p className="text-[9px] font-bold uppercase tracking-wider text-orange-500">{label}</p>
                                            <p className="text-[9px] font-bold tabular-nums text-orange-500">
                                              Tk. {rows.reduce((t, m) => t + lineCost(m), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </p>
                                          </div>
                                          {rows.map((m) => (
                                            <div key={m.itemCode} className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-orange-100 last:border-0">
                                              <span className="font-medium">{m.itemName}</span>
                                              <span className="flex items-center gap-3 tabular-nums">
                                                <span className="text-muted-foreground">{(m.qtyPerUnit * disposedQty).toFixed(3)} {m.uom}</span>
                                                {/* Calculation: disposal QTY × BOM value per unit = line value */}
                                                <span className="text-[11px] text-muted-foreground">{disposedQty.toLocaleString()} × {unitCost(m).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                <span className="w-24 text-right font-semibold text-foreground">= Tk. {lineCost(m).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      ))}
                                      {/* BOM money value of the disposed quantity + % loss vs total production cost */}
                                      <div className="px-3 py-2 bg-orange-100 border-t border-orange-200 space-y-1">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[11px] font-bold uppercase tracking-wider text-orange-700">
                                            Est. Wastage Value (BOM) · {disposedQty.toLocaleString()} Units
                                          </span>
                                          <span className="text-sm font-bold tabular-nums text-orange-700">
                                            Tk. {matCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] text-orange-600">
                                            Loss vs total production cost ({producedForCost.toLocaleString()} Units · Tk. {totalProductionCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                          </span>
                                          <span className="text-xs font-bold tabular-nums text-red-600">
                                            {lossPct.toFixed(1)}% loss · Tk. {matCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                          </span>
                                        </div>
                                      </div>
                                      </>
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

            {/* Return Records — today's returns checkboxes (multi-select), shown under Airport Store */}
            {form.wastageType === "Airport Store" && (
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
                                stockItemName: single ? allLines[0].itemName : "",
                                previousStock: single ? String(stockForItem(allLines[0].itemName, "Airport Store")) : "",
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
                              stockItemName: line.itemName,
                              previousStock: String(stockForItem(line.itemName, "Airport Store")),
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
                <div className="col-span-2">
                  <Label className="text-xs">01. Item <span className="text-red-500">*</span></Label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-1">
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Item Type</Label>
                      <Select value={itemTypeFilter || "all"} onValueChange={(v) => { setItemTypeFilter(v === "all" ? "" : v); setItemCatFilter(""); setItemSubFilter(""); }}>
                        <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All types</SelectItem>
                          {itemTypeChoices.map((t) => <SelectItem key={t} value={t} className="text-sm">{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Category</Label>
                      <Select value={itemCatFilter || "all"} onValueChange={(v) => { setItemCatFilter(v === "all" ? "" : v); setItemSubFilter(""); }}>
                        <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All categories</SelectItem>
                          {itemCatChoices.map((c) => <SelectItem key={c} value={c} className="text-sm">{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Sub Category</Label>
                      <Select value={itemSubFilter || "all"} onValueChange={(v) => setItemSubFilter(v === "all" ? "" : v)}>
                        <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All sub-categories</SelectItem>
                          {itemSubChoices.map((s) => <SelectItem key={s} value={s} className="text-sm">{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Item <span className="text-red-500">*</span></Label>
                      <Select
                        value={activeItems.find((i) => i.name === form.itemName)?.id || undefined}
                        onValueChange={(v) => {
                          const it = activeItems.find((i) => i.id === v);
                          if (!it) return;
                          setForm({
                            ...form,
                            itemName: it.name,
                            stockItemName: it.name,
                            disposalQtyUnit: it.uom || form.disposalQtyUnit,
                            previousStock: String(stockForItem(it.name, form.wastageType)),
                          });
                        }}
                      >
                        <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Select item" /></SelectTrigger>
                        <SelectContent>
                          {itemChoices.length === 0
                            ? <div className="px-2 py-3 text-xs text-muted-foreground text-center">No items match.</div>
                            : itemChoices.map((i) => <SelectItem key={i.id} value={i.id} className="text-sm">{i.code} — {i.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {form.itemName && (
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[11px]">
                      <span className="text-muted-foreground">Selected: <strong className="text-foreground">{form.itemName}</strong></span>
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold tabular-nums bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        Current stock: {stockForItem(form.itemName, form.wastageType)} {form.disposalQtyUnit}
                      </span>
                    </div>
                  )}
                </div>
                )}
                {form.wastageType === "Production" && (
                <div>
                  <Label className="text-xs">02. Production Date</Label>
                  <Input
                    type="date"
                    className="mt-1 h-9 text-sm"
                    value={form.productionDate}
                    onChange={(e) => setForm({ ...form, productionDate: e.target.value })}
                  />
                </div>
                )}
                <div>
                  <Label className="text-xs">{fieldNo(3)}. Disposal Quantity <span className="text-red-500">*</span></Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      type="number"
                      min="0"
                      className="h-9 text-sm flex-1"
                      value={form.disposalQty}
                      onChange={(e) => setForm({ ...form, disposalQty: e.target.value })}
                      placeholder="0"
                    />
                    <Input
                      readOnly
                      disabled
                      className="h-9 w-24 text-sm bg-muted/40 cursor-not-allowed text-center font-medium"
                      value={form.disposalQtyUnit || "—"}
                      title="Unit is set by the selected item (Item Profile) and can't be changed."
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">{fieldNo(4)}. Disposal Reason <span className="text-red-500">*</span></Label>
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
                  <Label className="text-xs">{fieldNo(5)}. Reprocessing Possibility</Label>
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
                  <Label className="text-xs">{fieldNo(6)}. Disposal Method</Label>
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
                  <Label className="text-xs">{fieldNo(7)}. Disposal Date <span className="text-muted-foreground font-normal">(auto)</span></Label>
                  <Input
                    type="date"
                    readOnly
                    disabled
                    className="mt-1 h-9 text-sm bg-muted/40 cursor-not-allowed"
                    value={editId ? (form.disposalDate || todayDate()) : todayDate()}
                    title="System-generated on submit"
                  />
                </div>
                <div>
                  <Label className="text-xs">{fieldNo(8)}. Disposal Time <span className="text-muted-foreground font-normal">(auto)</span></Label>
                  <Input
                    type="time"
                    readOnly
                    disabled
                    className="mt-1 h-9 text-sm bg-muted/40 cursor-not-allowed"
                    value={editId ? (form.disposalTime || nowTime()) : nowTime()}
                    title="System-generated on submit"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
                <Clock className="h-3 w-3 shrink-0" /> Disposal date &amp; time are recorded automatically by the system.
              </p>
            </div>

            {/* Stock QTY Summary — Galley Returns & Transfer only (Production shows
                its per-batch QTY strip inside the Re-Cook Batches card above). */}
            {isStockBackedType(form.wastageType) && form.wastageType !== "Production" && (() => {
              // Issued QTY is resolved live from the relevant source (inventory /
              // galley stock / production) for the selected item; falls back to
              // the captured previous stock for multi-select / manual entries.
              const resolvedStock = stockForItem(form.stockItemName || form.itemName, form.wastageType);
              const issuedQty = resolvedStock > 0 ? resolvedStock : (Number(form.previousStock) || 0);
              const disposalQty = Number(form.disposalQty) || 0;
              return (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 p-2 bg-orange-50 border border-orange-200 rounded-md">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Issued QTY</p>
                    <p className="text-sm font-bold mt-0.5">{issuedQty.toLocaleString()} {form.disposalQtyUnit}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Disposal QTY</p>
                    <p className="text-sm font-bold mt-0.5 text-red-600">
                      {disposalQty > 0 ? `−${disposalQty}` : "0"} {form.disposalQtyUnit}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Current QTY</p>
                    <p className="text-sm font-bold mt-0.5 text-primary">
                      {(issuedQty - disposalQty).toLocaleString()} {form.disposalQtyUnit}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-orange-700 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Stock will be reduced by {form.disposalQty || "0"} {form.disposalQtyUnit} upon Final Approval.
                </p>
              </div>
              );
            })()}


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

            </CardContent>
          </Card>

          {/* Action bar */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditId(null); }}>Cancel</Button>
            <Button onClick={handleSubmit} className="gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> {editId ? "Save Changes" : "Save"}
            </Button>
          </div>
        </div>
      </>
      )}

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
                <div><span className="text-muted-foreground">Type: </span><strong>{wastageTypeLabel(viewEntry.wastageType)}</strong></div>
                <div className="flex items-center gap-1"><span className="text-muted-foreground">Status: </span><StatusBadge status={viewEntry.status} /></div>
                {viewEntry.officeId && (
                  <div><span className="text-muted-foreground">Office: </span><strong>{ALL_OFFICES.find((o) => o.id === viewEntry.officeId)?.name ?? viewEntry.officeId}</strong></div>
                )}
                {viewEntry.warehouseId && (
                  <div><span className="text-muted-foreground">Warehouse: </span><strong>{ALL_WAREHOUSES.find((w) => w.id === viewEntry.warehouseId)?.name ?? viewEntry.warehouseId}</strong></div>
                )}
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
                      {(() => {
                        // Parameter list mirrors the (redesigned) disposal form: Item,
                        // then Production-only rows, then the common disposal fields.
                        const isProd = viewEntry.wastageType === "Production";
                        const rows: { label: string; value: string; prodOrder?: boolean }[] = [
                          { label: "Item", value: viewEntry.itemName },
                          ...(isProd ? [{ label: "Production Order", value: viewEntry.batchCode, prodOrder: true }] : []),
                          ...(isProd ? [{ label: "Production Date", value: viewEntry.productionDate }] : []),
                          { label: "Disposal Quantity", value: `${viewEntry.disposalQty} ${viewEntry.disposalQtyUnit}` },
                          { label: "Disposal Reason", value: viewEntry.disposalReason },
                          { label: "Reprocessing Possibility", value: viewEntry.reprocessingPossibility },
                          { label: "Disposal Method", value: viewEntry.disposalMethod },
                          { label: "Disposal Date", value: viewEntry.disposalDate },
                          { label: "Disposal Time", value: viewEntry.disposalTime },
                        ];
                        return rows.map((row, i) => {
                          const sl = String(i + 1).padStart(2, "0");
                          const value = row.value;
                          const linkedProd = row.prodOrder
                            ? productionEntries.find((e) => e.id === value)
                            : null;
                          return (
                            <TableRow key={sl}>
                              <TableCell className="text-xs text-muted-foreground font-mono">{sl}</TableCell>
                              <TableCell className="text-xs font-medium">{row.label}</TableCell>
                              <TableCell className="text-xs text-center">
                                {row.prodOrder && value && value !== "N/A" ? (
                                  <button
                                    className="font-mono font-semibold text-primary hover:underline"
                                    title={linkedProd ? `View production order ${value}` : `Open ${value} in the Production Order table`}
                                    onClick={() => {
                                      if (linkedProd) { setProdDetailEntry(linkedProd); setProdDetailOpen(true); return; }
                                      // Not in the current list → jump to the Production Order
                                      // table and flash (blink) that order's row.
                                      flagArrival({ target: "production-list", ids: [value] });
                                      setViewOpen(false);
                                      navigate(`/production-entry?pro=${encodeURIComponent(value)}`);
                                    }}
                                  >
                                    {value}
                                  </button>
                                ) : (value || "N/A")}
                              </TableCell>
                            </TableRow>
                          );
                        });
                      })()}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Wastage Cost — full BOM amount calculation + % loss (Production) */}
              {viewEntry.wastageType === "Production" && (() => {
                const recipe = resolveProductionItem({ name: viewEntry.itemName });
                const disposedQty = viewEntry.disposalQty || 0;
                const matSections = [
                  { label: "Raw Materials",       rows: recipe.rawMaterials       },
                  { label: "Packaging Materials", rows: recipe.packagingMaterials },
                  { label: "Other Consumption",   rows: recipe.otherConsumption   },
                ];
                const hasMat = recipe.rawMaterials.length + recipe.packagingMaterials.length + recipe.otherConsumption.length > 0;
                if (!hasMat) return null;
                const unitCost = (m: { qtyPerUnit: number; rate: number }) => m.qtyPerUnit * m.rate;    // BOM money per FG unit
                const lineCost = (m: { qtyPerUnit: number; rate: number }) => unitCost(m) * disposedQty; // per-item wastage value
                const matCost = matSections.reduce((s, sec) => s + sec.rows.reduce((t, m) => t + lineCost(m), 0), 0);
                // % loss vs the TOTAL production-order cost value (BOM cost/unit × order qty).
                const fullUnitCost = matSections.reduce((s, sec) => s + sec.rows.reduce((t, m) => t + unitCost(m), 0), 0);
                const productionOrderQty = (viewEntry.previousStock && viewEntry.previousStock > 0) ? viewEntry.previousStock : disposedQty;
                const totalProductionCost = fullUnitCost * productionOrderQty;
                const lossPct = totalProductionCost > 0 ? (matCost / totalProductionCost) * 100 : 0;
                return (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Wastage Cost — BOM Calculation</h4>
                    <div className="border border-orange-200 rounded-md overflow-hidden">
                      {matSections.map(({ label, rows }) => rows.length === 0 ? null : (
                        <div key={label}>
                          <div className="flex items-center justify-between px-3 py-1 bg-orange-50 border-b border-orange-100">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-orange-500">{label}</p>
                            <p className="text-[9px] font-bold tabular-nums text-orange-500">Tk. {rows.reduce((t, m) => t + lineCost(m), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                          </div>
                          {rows.map((m) => (
                            <div key={m.itemCode} className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-orange-100 last:border-0">
                              <span className="font-medium">{m.itemName}</span>
                              <span className="flex items-center gap-3 tabular-nums">
                                <span className="text-muted-foreground">{(m.qtyPerUnit * disposedQty).toFixed(3)} {m.uom}</span>
                                <span className="text-[11px] text-muted-foreground">{disposedQty.toLocaleString()} × {unitCost(m).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                <span className="w-24 text-right font-semibold text-foreground">= Tk. {lineCost(m).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                      <div className="px-3 py-2 bg-orange-100 border-t border-orange-200 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-orange-700">Est. Wastage Value (BOM) · {disposedQty.toLocaleString()} Units</span>
                          <span className="text-sm font-bold tabular-nums text-orange-700">Tk. {matCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-orange-600">Loss vs total production cost ({productionOrderQty.toLocaleString()} Units · Tk. {totalProductionCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                          <span className="text-xs font-bold tabular-nums text-red-600">{lossPct.toFixed(1)}% loss · Tk. {matCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

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

              {/* Correction — Production wastage only */}
              {isAccountabilityType(viewEntry.wastageType) && (
                <div>
                  <p className="text-xs font-bold mb-1">Correction:</p>
                  <p className="text-sm bg-muted/30 p-3 rounded-md">{viewEntry.correction}</p>
                </div>
              )}

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

              {/* Compensation — Production wastage only */}
              {isAccountabilityType(viewEntry.wastageType) && (
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
              )}

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
                          // Production wastage linked to a production order → jump to the
                          // Production Order table and flash (blink) that order's row.
                          if (
                            viewEntry.wastageType === "Production" &&
                            viewEntry.batchCode &&
                            productionEntries.some((e) => e.id === viewEntry.batchCode)
                          ) {
                            flagArrival({ target: "production-list", ids: [viewEntry.batchCode] });
                            setViewOpen(false);
                            navigate(`/production-entry?pro=${encodeURIComponent(viewEntry.batchCode)}`);
                            return;
                          }
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

              {/* Selling / Salvage Details */}
              {viewEntry.saleDetails && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md">
                  <p className="text-xs font-bold text-emerald-700 mb-2 flex items-center gap-1.5">
                    <HandCoins className="h-3.5 w-3.5" /> Selling / Salvage Details
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <div><span className="text-muted-foreground">Sold To: </span><strong>{viewEntry.saleDetails.buyer}</strong></div>
                    <div><span className="text-muted-foreground">Sale Qty: </span><strong>{viewEntry.saleDetails.saleQty} {viewEntry.saleDetails.unit}</strong></div>
                    <div><span className="text-muted-foreground">Unit Price: </span><strong>Tk. {viewEntry.saleDetails.unitPrice.toLocaleString()}</strong></div>
                    <div><span className="text-muted-foreground">Total Value: </span><strong className="text-emerald-700">Tk. {viewEntry.saleDetails.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                    <div><span className="text-muted-foreground">Payment: </span><strong>{viewEntry.saleDetails.paymentMode}</strong></div>
                    {viewEntry.saleDetails.bankAccountNo && (
                      <div><span className="text-muted-foreground">A/C No: </span><strong className="font-mono">{viewEntry.saleDetails.bankAccountNo}</strong></div>
                    )}
                    {viewEntry.saleDetails.mobileProvider && (
                      <div><span className="text-muted-foreground">Provider: </span><strong>{viewEntry.saleDetails.mobileProvider}</strong></div>
                    )}
                    {viewEntry.saleDetails.mobileNo && (
                      <div><span className="text-muted-foreground">Mobile No: </span><strong className="font-mono">{viewEntry.saleDetails.mobileNo}</strong></div>
                    )}
                    {viewEntry.saleDetails.chequeNo && (
                      <div><span className="text-muted-foreground">Cheque No: </span><strong className="font-mono">{viewEntry.saleDetails.chequeNo}</strong></div>
                    )}
                    {viewEntry.saleDetails.chequeImage && (
                      <div><span className="text-muted-foreground">Cheque Image: </span><strong>{viewEntry.saleDetails.chequeImage}</strong></div>
                    )}
                    {viewEntry.saleDetails.otherMethod && (
                      <div><span className="text-muted-foreground">Method: </span><strong>{viewEntry.saleDetails.otherMethod}</strong></div>
                    )}
                    {viewEntry.saleDetails.otherDocument && (
                      <div><span className="text-muted-foreground">Document: </span><strong>{viewEntry.saleDetails.otherDocument}</strong></div>
                    )}
                    <div><span className="text-muted-foreground">Reference: </span><strong className="font-mono">{viewEntry.saleDetails.reference}</strong></div>
                    <div><span className="text-muted-foreground">Sale Date: </span><strong>{viewEntry.saleDetails.saleDate}</strong></div>
                    <div className="col-span-2"><span className="text-muted-foreground">Remarks: </span>{viewEntry.saleDetails.remarks}</div>
                  </div>
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
                      `Wastage Type : ${wastageTypeLabel(viewEntry.wastageType)}`,
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
                <div><span className="text-muted-foreground">Type: </span><strong>{wastageTypeLabel(stockLogEntry.wastageType)}</strong></div>
                <div><span className="text-muted-foreground">Qty Disposed: </span><strong className="text-red-600">{stockLogEntry.disposalQty} {stockLogEntry.disposalQtyUnit}</strong></div>
                <div className="flex items-center gap-1"><span className="text-muted-foreground">Status: </span><StatusBadge status={stockLogEntry.status} /></div>
              </div>

              {(stockLogEntry.wastageType === "Production" || stockLogEntry.wastageType === "Transfer") && stockLogEntry.stockItemName ? (
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
