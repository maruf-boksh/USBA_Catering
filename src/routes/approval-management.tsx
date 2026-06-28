import { useEffect, useMemo, useState, useCallback } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Check, X as XIcon, Clock, ShieldCheck, Search,
  FileText, FileSearch, ShoppingCart, Truck, ArrowLeftRight, ArrowLeft, Layers, UserCog, Users,
  ClipboardCheck, SlidersHorizontal, History, Eye, User as UserIcon, Calendar, Hash,
  PackageCheck, AlertTriangle, CheckCircle2, Share2, Plane, MailQuestion, PlaneLanding, PlaneTakeoff,
  BadgeDollarSign, Wrench, MessageSquare, CornerUpLeft, LayoutGrid, Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useWorkflow,
  type WfDemandRequest, type WfDemandStatus, type WfDispatchApproval,
} from "@/lib/workflow-store";
import { inventory, warehouses, consumableItems, type ConsumableItem } from "@/lib/sample-data";
import { getItemStock } from "@/lib/inventory-stock";
import { useFlightOrders, updateFlightOrdersWhere, type FlightOrder } from "@/lib/flight-orders-store";
import { useApprovalReviews, setReview, reviewKey } from "@/lib/approval-reviews";
import { getRfqs, setRfqStatus } from "@/lib/rfqs";
import { getQuotations, setQuotationStatus } from "@/lib/quotations";
import { getStockAdjustments, setStockAdjustmentStatus } from "@/lib/stock-adjustments";
import { useRole } from "@/lib/roles";

type Category =
  | "Flight Orders"
  | "Crew Orders"
  | "Demand Request"
  | "Request for Quotation"
  | "Quotation"
  | "Purchase Requisition"
  | "Purchase Order"
  | "Goods Receipt"
  | "Transfer Request"
  | "Stock Adjustment"
  | "Production Order"
  | "Bill of Materials"
  | "User Account"
  | "Dispatch"
  | "Maintenance"
  | "Return Items"
  | "Galley Loading";

// Shared type with dispatch-monitoring.tsx via "galley_loading" sessionStorage key
type SignOffLog = { name: string; designation: string; signedAt: string };
type GalleyStatus = "forwarded" | "loading" | "completed" | "awaiting_approval" | "approved";
type GalleyPlan = Record<string, string>;
type GalleyLoadingRecord = {
  id: string;
  dispatchEntryId: string;
  flightId: string;
  flightLabel: string;
  date: string;
  galleyPlan: GalleyPlan;
  signOff: {
    preparedBy: SignOffLog;
    physicallyHandedBy: SignOffLog;
    flightCheckedBy: SignOffLog;
    handedOverBy: SignOffLog;
  };
  galleyStatus: GalleyStatus;
  forwardedAt: string;
  loadingStartedAt?: string;
  loadingCompletedAt?: string;
  loadingDurationSec?: number;
  approvedAt?: string;
  approvedBy?: string;
};

// Shared type with consumable-returns.tsx via "consumable-return-approvals" localStorage key
type ReturnApprovalRecord = {
  id: string;
  returnId: string;
  flight: string;
  sector: string;
  date: string;
  returnedBy: string;
  status: "Pending" | "Approved" | "Declined";
  processedBy?: string;
  processedAt?: string;
  declineReason?: string;
  lines: {
    itemId: string;
    itemName: string;
    lineType: "item" | "meal";
    uom: string;
    returnQty: number;
    reusableQty: number;
    partialReason?: string;
  }[];
};

const CATEGORIES: { key: Category; label: string; icon: typeof FileText }[] = [
  { key: "Flight Orders",        label: "Flight Orders",      icon: Plane           },
  { key: "Crew Orders",          label: "Crew Orders",        icon: Users           },
  { key: "Demand Request",       label: "Demand Req.",        icon: FileSearch      },
  { key: "Request for Quotation", label: "RFQ",               icon: MailQuestion    },
  { key: "Quotation",            label: "Quotations",         icon: BadgeDollarSign },
  { key: "Purchase Requisition", label: "Purchase Req.",      icon: FileText        },
  { key: "Purchase Order",       label: "Purchase Orders",    icon: ShoppingCart    },
  { key: "Goods Receipt",        label: "Goods Receipts",     icon: Truck           },
  { key: "Transfer Request",     label: "Transfer Requests",  icon: ArrowLeftRight  },
  { key: "Stock Adjustment",     label: "Stock Adj.",         icon: SlidersHorizontal },
  { key: "Production Order",     label: "Production",         icon: ClipboardCheck  },
  { key: "Bill of Materials",    label: "BOM",                icon: Layers          },
  { key: "User Account",         label: "Users",              icon: UserCog         },
  { key: "Dispatch",             label: "Dispatch",           icon: Truck           },
  { key: "Maintenance",          label: "Maintenance",        icon: Wrench          },
  { key: "Return Items",         label: "Return Items",       icon: PackageCheck    },
  { key: "Galley Loading",       label: "Galley Loading",     icon: LayoutGrid      },
];

// Overview grid — categories grouped into business sections (mirrors the
// reference layout). Each card drills into that category's pending queue.
const APPROVAL_SECTIONS: { label: string; keys: Category[] }[] = [
  { label: "Operations Approval",     keys: ["Flight Orders", "Crew Orders"] },
  { label: "Dispatch Approval",       keys: ["Dispatch"] },
  { label: "Procurement Approval",    keys: ["Request for Quotation", "Quotation", "Purchase Requisition", "Purchase Order", "Goods Receipt"] },
  { label: "Inventory Approval",      keys: ["Demand Request", "Transfer Request", "Stock Adjustment"] },
  { label: "Production Approval",     keys: ["Production Order", "Bill of Materials"] },
  { label: "Administration Approval", keys: ["User Account"] },
  { label: "Asset Management Approval", keys: ["Maintenance"] },
  { label: "Consumable Returns Approval", keys: ["Return Items"] },
  { label: "Galley Loading Approval",     keys: ["Galley Loading"] },
];
const CATEGORY_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

function formatGalleyDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

const HOC_NAMES = ["Cmd. A. Rahman", "M. Jahangir", "S. Karim", "R. Ahmed"];

type ApprovalStatus = "Pending" | "Approved" | "Rejected" | "Reviewed";

// A line item shown in the detail dialog. `qty`/`uom` are optional so the same
// shape works for materials (Qty + UoM), single-line adjustments, etc. `note`
// carries per-line context (e.g. "On hold for QC").
type ApprovalLine = { name: string; qty?: number; uom?: string; note?: string };

type ApprovalItem = {
  id: string;
  category: Category;
  refId: string;
  title: string;
  requestedBy: string;
  requestedAt: string;
  summary: string;
  amount?: number;
  itemsCount?: number;
  status: ApprovalStatus;
  processedBy?: string;
  processedAt?: string;
  rejectionReason?: string;
  /** Approver's review comment when the request was returned for correction. */
  reviewComment?: string;
  /** Structured line items for the detail view (PR/PO/GRN/Transfer/etc.). */
  lines?: ApprovalLine[];
  /** Single-record field list for categories without line items (e.g. User). */
  fields?: { label: string; value: string }[];
};

const SEED: ApprovalItem[] = [
  // Purchase Requisition
  { id: "AP-1001", category: "Purchase Requisition", refId: "PR-2026-007", title: "Grains & rice for next week",            requestedBy: "S. Ahmed",   requestedAt: "2026-05-19 09:12", summary: "Basmati Rice 800 Kg, Cooking Oil 200 L",                 amount: 245000, itemsCount: 4, status: "Pending",
    lines: [
      { name: "Basmati Rice", qty: 800, uom: "Kg" },
      { name: "Cooking Oil", qty: 200, uom: "L" },
      { name: "Lentils (Masoor)", qty: 150, uom: "Kg" },
      { name: "Sugar", qty: 100, uom: "Kg" },
    ] },
  { id: "AP-1002", category: "Purchase Requisition", refId: "PR-2026-008", title: "Packaging restock",                       requestedBy: "F. Begum",   requestedAt: "2026-05-19 11:30", summary: "Meal Box 5000 pcs, Aluminum Tray 3000 pcs",              amount: 168000, itemsCount: 2, status: "Pending",
    lines: [
      { name: "Meal Box", qty: 5000, uom: "pcs" },
      { name: "Aluminum Tray", qty: 3000, uom: "pcs" },
    ] },
  { id: "AP-1004", category: "Purchase Requisition", refId: "PR-ASSET-001", title: "Catering equipment — trolleys & oven racks", requestedBy: "M. Karim",   requestedAt: "2026-06-10 09:30", summary: "Full Size Meal Trolley 4 Pcs, Half Size Bar Trolley 2 Pcs, Standard Oven Rack 6 Pcs", amount: 662000, itemsCount: 3, status: "Pending",
    lines: [
      { name: "Full Size Meal Trolley", qty: 4, uom: "Pcs", note: "৳ 85,000/Pcs" },
      { name: "Half Size Bar Trolley",  qty: 2, uom: "Pcs", note: "৳ 55,000/Pcs" },
      { name: "Standard Oven Rack",     qty: 6, uom: "Pcs", note: "৳ 32,000/Pcs" },
    ] },
  { id: "AP-1003", category: "Purchase Requisition", refId: "PR-2026-005", title: "Beverage & water",                        requestedBy: "T. Islam",   requestedAt: "2026-05-18 14:45", summary: "Mineral Water 250ml — 12000 bottles",                    amount:  98000, itemsCount: 1, status: "Approved",  processedBy: "R. Hossain", processedAt: "2026-05-18 16:00",
    lines: [
      { name: "Mineral Water 250ml", qty: 12000, uom: "Bottle" },
    ] },

  // Purchase Order
  { id: "AP-1101", category: "Purchase Order",       refId: "PO-2026-0451", title: "Agro Fresh — vegetables",                requestedBy: "Md. Karim",  requestedAt: "2026-05-19 10:50", summary: "Tomato 500 Kg, Onion 300 Kg, Spice Mix 50 Kg",           amount: 132000, itemsCount: 3, status: "Pending",
    lines: [
      { name: "Tomato", qty: 500, uom: "Kg", note: "৳ 60/Kg" },
      { name: "Onion", qty: 300, uom: "Kg", note: "৳ 70/Kg" },
      { name: "Spice Mix", qty: 50, uom: "Kg", note: "৳ 1,620/Kg" },
    ] },
  { id: "AP-1102", category: "Purchase Order",       refId: "PO-2026-0452", title: "Meat & Co. — protein supply",            requestedBy: "Md. Karim",  requestedAt: "2026-05-19 08:20", summary: "Chicken Breast 600 Kg, Mutton 150 Kg",                   amount: 308000, itemsCount: 2, status: "Pending",
    lines: [
      { name: "Chicken Breast", qty: 600, uom: "Kg", note: "৳ 320/Kg" },
      { name: "Mutton", qty: 150, uom: "Kg", note: "৳ 770/Kg" },
    ] },

  // Goods Receipt
  { id: "AP-1201", category: "Goods Receipt",        refId: "GRN-2026-118", title: "Receipt of PO-2026-0445",                 requestedBy: "S. Ahmed",   requestedAt: "2026-05-19 12:05", summary: "9 of 10 lines accepted, 1 on hold for QC",               itemsCount: 10, status: "Pending",
    lines: [
      { name: "Basmati Rice", qty: 800, uom: "Kg", note: "Accepted" },
      { name: "Cooking Oil", qty: 200, uom: "L", note: "Accepted" },
      { name: "Chicken Breast", qty: 600, uom: "Kg", note: "Accepted" },
      { name: "Tomato", qty: 480, uom: "Kg", note: "Accepted (short 20 Kg)" },
      { name: "Salmon Fillet", qty: 60, uom: "Kg", note: "On hold for QC" },
    ] },

  // Transfer Request
  { id: "AP-1301", category: "Transfer Request",     refId: "TR-7001",     title: "Central WH → Hot Kitchen",                requestedBy: "S. Ahmed",   requestedAt: "2026-05-19 10:25", summary: "Daily production replenishment — 2 items",               itemsCount: 2,  status: "Pending",
    lines: [
      { name: "Basmati Rice", qty: 200, uom: "Kg" },
      { name: "Cooking Oil", qty: 50, uom: "L" },
    ] },
  { id: "AP-1302", category: "Transfer Request",     refId: "TR-7004",     title: "Regional CXB → Central WH",               requestedBy: "T. Islam",   requestedAt: "2026-05-18 11:32", summary: "Stock balancing — Meal Box 500 pcs",                     itemsCount: 1,  status: "Pending",
    lines: [
      { name: "Meal Box", qty: 500, uom: "pcs" },
    ] },

  // Production Order approvals are projected live from the workflow store
  // (production orders awaiting release) — see `productionItems` below.

  // Bill of Materials
  { id: "AP-1601", category: "Bill of Materials",    refId: "BOM-007",     title: "New BOM — Vegetable Cutlet",              requestedBy: "S. Ahmed",   requestedAt: "2026-05-18 16:40", summary: "Draft v1.0 with 8 materials, ready to publish",          itemsCount: 8, status: "Pending",
    lines: [
      { name: "Potato", qty: 60, uom: "g/portion" },
      { name: "Mixed Vegetables", qty: 40, uom: "g/portion" },
      { name: "Breadcrumbs", qty: 15, uom: "g/portion" },
      { name: "Spice Mix", qty: 5, uom: "g/portion" },
      { name: "Cooking Oil", qty: 10, uom: "ml/portion" },
      { name: "Corn Flour", qty: 8, uom: "g/portion" },
      { name: "Salt", qty: 2, uom: "g/portion" },
      { name: "Green Chili", qty: 3, uom: "g/portion" },
    ] },
  { id: "AP-1602", category: "Bill of Materials",    refId: "BOM-001",     title: "Chicken Biryani — v3.3 revision",         requestedBy: "S. Ahmed",   requestedAt: "2026-05-17 11:10", summary: "Updated chicken portion 120 → 130 g per portion",        itemsCount: 9, status: "Approved",  processedBy: "R. Hossain", processedAt: "2026-05-17 17:00",
    lines: [
      { name: "Chicken", qty: 130, uom: "g/portion", note: "Revised from 120 g" },
      { name: "Basmati Rice", qty: 110, uom: "g/portion" },
      { name: "Onion", qty: 30, uom: "g/portion" },
      { name: "Biryani Spice", qty: 8, uom: "g/portion" },
      { name: "Ghee", qty: 12, uom: "ml/portion" },
    ] },

  // User Account
  { id: "AP-1701", category: "User Account",         refId: "USR-008",     title: "New user — R. Karim (Store)",             requestedBy: "HR Team",    requestedAt: "2026-05-19 09:00", summary: "Role: Store & Inventory · Location: Central WH",          status: "Pending",
    fields: [
      { label: "Full Name", value: "R. Karim" },
      { label: "Role", value: "Store & Inventory" },
      { label: "Location", value: "Central Warehouse" },
      { label: "Action", value: "Create account" },
    ] },
  { id: "AP-1702", category: "User Account",         refId: "USR-006",     title: "Reactivate user — N. Hossen",             requestedBy: "Md. Karim",  requestedAt: "2026-05-18 14:20", summary: "Account inactive since 2026-04-15",                       status: "Rejected", processedBy: "R. Hossain", processedAt: "2026-05-18 18:00", rejectionReason: "Pending HR confirmation of return date",
    fields: [
      { label: "Full Name", value: "N. Hossen" },
      { label: "Role", value: "Packaging & Dispatch" },
      { label: "Inactive Since", value: "2026-04-15" },
      { label: "Action", value: "Reactivate account" },
    ] },
];

function categoryIcon(cat: Category) {
  return CATEGORIES.find((c) => c.key === cat)?.icon ?? FileText;
}

export default function ApprovalManagementPage() {
  const { role } = useRole();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    demands, updateDemandStatus,
    addTransferNote, addRequisition,
    mrpRuns, updateMrpRun,
    dispatchApprovals, updateDispatchApproval,
    wfPurchaseOrders, updatePurchaseOrder,
    productionEntries, updateProductionEntryStatus,
    maintenanceApprovals, updateMaintenanceApproval,
  } = useWorkflow();
  const flightOrders = useFlightOrders();

  const [items, setItems] = useState<ApprovalItem[]>(SEED);
  const [returnApprovals, setReturnApprovals] = usePersistedState<ReturnApprovalRecord[]>(
    "consumable-return-approvals",
    [],
  );
  const [consumableInventory, setConsumableInventory] = usePersistedState<ConsumableItem[]>(
    "airline-consumables-items",
    consumableItems,
  );
  // Flight orders have no "Rejected" status in their store flow, so approval
  // decisions made here are tracked locally. Approve also advances the order's
  // Pending legs to "Approved" in the shared store (reflected on Order Mgmt &
  // the dashboard); reject is recorded here only.
  const [foDecisions, setFoDecisions] = useState<
    Record<string, { status: ApprovalStatus; by: string; at: string; reason?: string }>
  >({});
  // RFQ approve/reject decisions made here. Approve also flips the RFQ's status
  // to "Approved" in the persisted RFQ table (reflected on the RFQ screen).
  const [rfqDecisions, setRfqDecisions] = useState<
    Record<string, { status: ApprovalStatus; by: string; at: string; reason?: string }>
  >({});
  // Quotation approve/reject decisions made here. Approve also flips the
  // quotation's status to "Approved" in the persisted Quotation table.
  const [quotationDecisions, setQuotationDecisions] = useState<
    Record<string, { status: ApprovalStatus; by: string; at: string; reason?: string }>
  >({});
  // Stock Adjustment approve/reject decisions made here. Approve also flips the
  // adjustment's status to "Approved" in the persisted Stock Adjustment table.
  const [stockAdjDecisions, setStockAdjDecisions] = useState<
    Record<string, { status: ApprovalStatus; by: string; at: string; reason?: string }>
  >({});
  // Production Order approve/reject decisions. Approve releases the order to
  // production (status "Approved") in the workflow store; reject is recorded
  // here (production orders have no Rejected status in their store flow).
  const [productionDecisions, setProductionDecisions] = useState<
    Record<string, { status: ApprovalStatus; by: string; at: string; reason?: string }>
  >({});
  const [activeTab, setActiveTab] = useState<Category | "all">(
    searchParams.get("tab") === "dispatch" ? "Dispatch" : "all"
  );
  const [search, setSearch] = useState("");
  // Date-range filter (on requestedAt) inside each category screen.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Bulk selection (ids of pending items ticked for a batch approve/reject).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkReject, setBulkReject] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<ApprovalItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<ApprovalItem | null>(null);
  const [fulfillStoreDone, setFulfillStoreDone] = useState(false);
  const [escalateDone, setEscalateDone] = useState(false);
  const [shortfallQtys, setShortfallQtys] = useState<Record<string, string>>({});
  const [detailRejectOpen, setDetailRejectOpen] = useState(false);
  const [detailRejectReason, setDetailRejectReason] = useState("");
  const [detailReviewOpen, setDetailReviewOpen] = useState(false);
  const [detailReviewComment, setDetailReviewComment] = useState("");
  // Editable reusable qty per line for Return Items approval
  const [returnLineQtys, setReturnLineQtys] = useState<Record<number, string>>({});
  // Per-line justification when reusable qty < return qty
  const [returnLineReasons, setReturnLineReasons] = useState<Record<number, string>>({});
  // True after Save is clicked — keeps modal open in view-only mode
  const [returnItemsSaved, setReturnItemsSaved] = useState(false);
  // Review decisions — "send back to the requester for correction" instead of a
  // hard reject. Persisted centrally (survives reload) keyed by category::refId,
  // so every module's requester screen can read & clear it. Overlaid onto the
  // projected items below; only applies while the request is still Pending.
  // (Flight/Crew orders persist their review on the order row itself instead.)
  const reviews = useApprovalReviews();

  // ── Galley Loading records (shared via sessionStorage with dispatch-monitoring) ──
  const [galleyLoadingRecords, setGalleyLoadingRecords] = useState<GalleyLoadingRecord[]>(() => {
    try {
      const raw = sessionStorage.getItem("galley_loading");
      if (!raw) return [];
      return JSON.parse(raw) as GalleyLoadingRecord[];
    } catch { return []; }
  });
  const [galleyDetailOpen, setGalleyDetailOpen] = useState(false);
  const [galleyDetailRecord, setGalleyDetailRecord] = useState<GalleyLoadingRecord | null>(null);
  const [galleyEditMode, setGalleyEditMode] = useState(false);
  const [galleyEditPlan, setGalleyEditPlan] = useState<GalleyPlan>({});

  // Poll sessionStorage for galley records from the other page
  useEffect(() => {
    const sync = () => {
      try {
        const raw = sessionStorage.getItem("galley_loading");
        if (!raw) return;
        setGalleyLoadingRecords(JSON.parse(raw) as GalleyLoadingRecord[]);
      } catch { /* ignore */ }
    };
    const id = setInterval(sync, 2000);
    return () => clearInterval(id);
  }, []);

  function approveGalley(record: GalleyLoadingRecord, by: string) {
    const updated = galleyLoadingRecords.map((r) =>
      r.id === record.id
        ? { ...r, galleyStatus: "approved" as GalleyStatus, approvedAt: new Date().toISOString().slice(0, 16).replace("T", " "), approvedBy: by }
        : r,
    );
    setGalleyLoadingRecords(updated);
    sessionStorage.setItem("galley_loading", JSON.stringify(updated));
    setGalleyDetailOpen(false);
    toast.success("Galley approved — Ready To Fly!");
  }

  function saveGalleyEdits(record: GalleyLoadingRecord, plan: GalleyPlan) {
    const updated = galleyLoadingRecords.map((r) =>
      r.id === record.id ? { ...r, galleyPlan: plan } : r,
    );
    setGalleyLoadingRecords(updated);
    sessionStorage.setItem("galley_loading", JSON.stringify(updated));
    setGalleyEditMode(false);
    toast.success("Galley plan updated.");
  }

  // ── Dispatch approval modal ──────────────────────────────────────────────────
  const [dispatchViewOpen, setDispatchViewOpen] = useState(false);
  const [dispatchViewEntry, setDispatchViewEntry] = useState<WfDispatchApproval | null>(null);
  const [dispatchApproveStep, setDispatchApproveStep] = useState<"approve" | "forward">("approve");
  const [dispatchApproveLog, setDispatchApproveLog] = useState<{ by: string; at: string } | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");
  const dispatchPendingCount = dispatchApprovals.filter(d => d.stage === "pending_hoc").length;

  // Project workflow-store demands into ApprovalItem shape so the same list,
  // counts, filtering, and dialogs work uniformly across categories. The id
  // is prefixed with `DR-AP-` to avoid collisions with the local SEED ids;
  // refId stays as the original DR-#### so handlers can look the demand back
  // up via `demands.find(d => d.id === it.refId)`.
  const demandItems: ApprovalItem[] = useMemo(() => {
    const toStatus = (s: WfDemandStatus): ApprovalStatus =>
      s === "Pending Approval" ? "Pending"
      : s === "Rejected"        ? "Rejected"
      : "Approved";
    return demands.map((d) => ({
      id: `DR-AP-${d.id}`,
      category: "Demand Request" as Category,
      refId: d.id,
      title: d.autoFulfill
        ? "Auto-fulfill demand from Meal Plan"
        : `Material demand from ${d.role}`,
      requestedBy: d.requestedBy,
      requestedAt: d.date,
      summary: `${d.items.length} item${d.items.length === 1 ? "" : "s"} · From ${d.role}${d.note ? " — " + d.note : ""}`,
      itemsCount: d.items.length,
      status: toStatus(d.status),
      processedBy: d.approvedBy ?? d.rejectedBy,
      processedAt: d.approvedAt ?? d.rejectedAt,
      rejectionReason: d.rejectionReason,
    }));
  }, [demands]);

  // Project flight orders (grouped by Order #) into ApprovalItem shape. Only
  // orders that still have a Pending leg — or that were decided here — surface,
  // so the queue stays focused. One pass over the (large) order list keeps it
  // cheap even with thousands of legs.
  const flightOrderItems: ApprovalItem[] = useMemo(() => {
    // Group by Order # AND type — a flight order and its crew order can now share
    // a number, but each is its own approval card. Decision key = `${orderNo}__${type}`.
    const byOrder = new Map<string, { orderNo: string; type: "flight" | "crew"; legs: FlightOrder[] }>();
    for (const o of flightOrders) {
      const type = o.orderType === "crew" ? "crew" : "flight";
      const key = `${o.orderNo}__${type}`;
      const g = byOrder.get(key);
      if (g) g.legs.push(o);
      else byOrder.set(key, { orderNo: o.orderNo, type, legs: [o] });
    }
    const result: ApprovalItem[] = [];
    for (const [key, { orderNo, type, legs }] of byOrder) {
      const decision = foDecisions[key];
      const hasPending = legs.some((l) => l.status === "Pending");
      // A returned-for-correction leg (reviewComment set while still Pending).
      const reviewedLeg = legs.find((l) => l.reviewComment && l.status === "Pending");
      if (!hasPending && !decision) continue;
      const isCrew = type === "crew";
      const airlines = Array.from(new Set(legs.map((l) => l.airline)));
      const totalPax = legs.reduce((s, l) => s + (l.pax ?? 0), 0);
      const totalCrew = legs.reduce((s, l) => s + (l.crew ?? 0), 0);
      const flightList = legs.map((l) => l.flight).slice(0, 4).join(", ");
      const more = legs.length > 4 ? ` +${legs.length - 4} more` : "";
      result.push({
        id: `FO-AP-${key}`,
        category: isCrew ? "Crew Orders" : "Flight Orders",
        refId: orderNo,
        title: `${isCrew ? "Crew meal order" : "Flight order"} — ${legs.length} flight${legs.length === 1 ? "" : "s"}`,
        requestedBy: "Operations",
        requestedAt: legs[0].date,
        summary: isCrew
          ? `${airlines.join(", ")} · ${flightList}${more} · ${totalCrew} crew`
          : `${airlines.join(", ")} · ${flightList}${more} · ${totalPax} pax`,
        itemsCount: legs.length,
        status: decision ? decision.status : reviewedLeg ? "Reviewed" : "Pending",
        processedBy: decision?.by ?? reviewedLeg?.reviewedBy,
        processedAt: decision?.at ?? reviewedLeg?.reviewedAt,
        rejectionReason: decision?.reason,
        reviewComment: reviewedLeg?.reviewComment,
      });
    }
    return result;
  }, [flightOrders, foDecisions]);

  // Project RFQs into ApprovalItem shape. Only Pending RFQs — or ones decided
  // here this session — surface, so the queue stays focused. Approving flips the
  // RFQ to "Approved" in the persisted table; the decision drives the projection.
  const rfqItems: ApprovalItem[] = useMemo(() => {
    return getRfqs()
      .filter((r) => r.status === "Pending" || rfqDecisions[r.id])
      .map((r) => {
        const decision = rfqDecisions[r.id];
        return {
          id: `RFQ-AP-${r.id}`,
          category: "Request for Quotation" as Category,
          refId: r.id,
          title: `RFQ — ${r.lines.length} item${r.lines.length === 1 ? "" : "s"}`,
          requestedBy: "Procurement",
          requestedAt: r.date,
          summary: `${r.invitedSuppliers.length} supplier${r.invitedSuppliers.length === 1 ? "" : "s"} invited · deadline ${r.deadline}${r.prRef ? ` · ${r.prRef}` : ""}`,
          itemsCount: r.lines.length,
          status: decision ? decision.status : "Pending",
          processedBy: decision?.by,
          processedAt: decision?.at,
          rejectionReason: decision?.reason,
          lines: r.lines.map((l) => ({ name: l.itemName, qty: l.qty, uom: l.uom, note: l.spec })),
        };
      });
  }, [rfqDecisions]);

  // Project Quotations into ApprovalItem shape. Only Pending quotations — or
  // ones decided here this session — surface. Approving flips the quotation to
  // "Approved" in the persisted table; the decision drives the projection.
  const quotationItems: ApprovalItem[] = useMemo(() => {
    return getQuotations()
      .filter((q) => q.status === "Pending" || quotationDecisions[q.id])
      .map((q) => {
        const decision = quotationDecisions[q.id];
        return {
          id: `QT-AP-${q.id}`,
          category: "Quotation" as Category,
          refId: q.id,
          title: `Quotation — ${q.supplier}`,
          requestedBy: "Procurement",
          requestedAt: q.date,
          summary: `${q.lines.length} item${q.lines.length === 1 ? "" : "s"} · ${q.rfqRef} · valid till ${q.validity}`,
          amount: q.total,
          itemsCount: q.lines.length,
          status: decision ? decision.status : "Pending",
          processedBy: decision?.by,
          processedAt: decision?.at,
          rejectionReason: decision?.reason,
          lines: q.lines.map((l) => ({ name: l.itemName, qty: l.qty, uom: l.uom, note: `৳ ${l.unitPrice.toLocaleString()}/${l.uom}` })),
        };
      });
  }, [quotationDecisions]);

  // Project Stock Adjustments into ApprovalItem shape. Only ones still
  // "Pending Approval" — or decided here this session — surface. Approving
  // flips the adjustment to "Approved" in the persisted table.
  const stockAdjItems: ApprovalItem[] = useMemo(() => {
    return getStockAdjustments()
      .filter((a) => a.status === "Pending Approval" || stockAdjDecisions[a.id])
      .map((a) => {
        const decision = stockAdjDecisions[a.id];
        const sign = a.adjustType === "Increase" ? "+" : "−";
        return {
          id: `SA-AP-${a.id}`,
          category: "Stock Adjustment" as Category,
          refId: a.id,
          title: `${a.reason} — ${a.item}`,
          requestedBy: a.adjustedBy,
          requestedAt: a.date,
          summary: `${sign}${a.adjustQty} ${a.uom} · ${a.item}${a.reference ? ` · ${a.reference}` : ""}${a.remarks ? ` — ${a.remarks}` : ""}`,
          itemsCount: 1,
          status: decision ? decision.status : "Pending",
          processedBy: decision?.by,
          processedAt: decision?.at,
          rejectionReason: decision?.reason,
          lines: [{ name: a.item, qty: a.adjustQty, uom: a.uom, note: `${a.adjustType} · ${a.reason}` }],
        };
      });
  }, [stockAdjDecisions]);

  // Project workflow-store POs with "Pending Approval" status into the approval queue.
  // Approving here sets the PO to "Approved" in the workflow store so Receive Items picks it up.
  const wfPoItems: ApprovalItem[] = useMemo(() => {
    return wfPurchaseOrders
      .filter(po => po.status === "Pending Approval")
      .map(po => ({
        id: `WFPO-AP-${po.id}`,
        category: "Purchase Order" as Category,
        refId: po.id,
        title: `${po.vendor} — ${po.items} item${po.items === 1 ? "" : "s"}`,
        requestedBy: "Procurement",
        requestedAt: po.date,
        summary: po.lineItems?.map(l => `${l.name} ${l.qty} ${l.uom}`).join(", ")
          ?? `${po.items} items · Req: ${po.requisitionRef}`,
        amount: po.amount > 0 ? po.amount : undefined,
        itemsCount: po.items,
        status: "Pending" as ApprovalStatus,
        lines: po.lineItems?.map(l => ({
          name: l.name, qty: l.qty, uom: l.uom,
          note: l.unitPrice > 0 ? `৳ ${l.unitPrice.toLocaleString()}/${l.uom}` : undefined,
        })),
      }));
  }, [wfPurchaseOrders]);

  // Project workflow-store production orders awaiting approval into the queue.
  // A freshly created order sits at "Pending" until released; approving here
  // sets it to "Approved" in the store (reflected on the Production Order list).
  const productionItems: ApprovalItem[] = useMemo(() => {
    return productionEntries
      .filter((e) => e.status === "Pending" || productionDecisions[e.id])
      .map((e) => {
        const decision = productionDecisions[e.id];
        const item = e.outputItemName ?? e.bom;
        const qty = e.orderQty ?? 0;
        return {
          id: `PRO-AP-${e.id}`,
          category: "Production Order" as Category,
          refId: e.id,
          title: `${item} — production order`,
          requestedBy: "Production",
          requestedAt: e.date,
          summary: `${qty.toLocaleString()} portion${qty === 1 ? "" : "s"} · BOM ${e.bom}`,
          itemsCount: 1,
          status: decision ? decision.status : "Pending",
          processedBy: decision?.by,
          processedAt: decision?.at,
          rejectionReason: decision?.reason,
          lines: [{ name: item, qty, uom: "portions", note: `BOM ${e.bom}` }],
        };
      });
  }, [productionEntries, productionDecisions]);

  // Project maintenance approvals that have been submitted (not "Logged") into the queue.
  const maintenanceItems: ApprovalItem[] = useMemo(() => {
    return maintenanceApprovals
      .filter((e) => e.status !== "Logged")
      .map((e) => {
        const approvalStatus: ApprovalStatus =
          e.status === "Pending Approval" ? "Pending"
          : e.status === "Rejected"       ? "Rejected"
          : "Approved";
        return {
          id: `MNT-AP-${e.id}`,
          category: "Maintenance" as Category,
          refId: e.id,
          title: `Maintenance — ${e.assetName}`,
          requestedBy: "Maintenance Dept.",
          requestedAt: e.serviceDate,
          summary: `${e.workType} · Service Date: ${e.serviceDate} · Next Due: ${e.nextDue}${e.notes ? " — " + e.notes : ""}`,
          itemsCount: 1,
          status: approvalStatus,
          processedBy: e.approvedBy ?? e.rejectedBy,
          processedAt: e.approvedAt ?? e.rejectedAt,
          rejectionReason: e.rejectionReason,
        };
      });
  }, [maintenanceApprovals]);

  const returnApprovalItems: ApprovalItem[] = useMemo(() => {
    return returnApprovals
      .filter((ra) => ra.status === "Pending" || ra.status !== "Pending")
      .map((ra) => {
        const approvalStatus: ApprovalStatus =
          ra.status === "Approved" ? "Approved"
          : ra.status === "Declined" ? "Rejected"
          : "Pending";
        return {
          id: `RA-AP-${ra.id}`,
          category: "Return Items" as Category,
          refId: ra.id,
          title: `Return Items — ${ra.flight} (${ra.sector})`,
          requestedBy: ra.returnedBy,
          requestedAt: ra.date,
          summary: `${ra.lines.length} meal item${ra.lines.length === 1 ? "" : "s"} · Return Ref: ${ra.returnId} · ${ra.flight}`,
          itemsCount: ra.lines.length,
          status: approvalStatus,
          processedBy: ra.processedBy,
          processedAt: ra.processedAt,
          rejectionReason: ra.declineReason,
        };
      });
  }, [returnApprovals]);

  const allItems = useMemo(() => {
    const base = [...flightOrderItems, ...demandItems, ...rfqItems, ...quotationItems, ...stockAdjItems, ...wfPoItems, ...productionItems, ...maintenanceItems, ...returnApprovalItems, ...items];
    // Overlay "Reviewed" (returned for correction) onto still-pending requests.
    return base.map((it) => {
      const rv = reviews[reviewKey(it.category, it.refId)];
      if (rv && it.status === "Pending") {
        return { ...it, status: "Reviewed" as ApprovalStatus, processedBy: rv.by, processedAt: rv.at, reviewComment: rv.comment };
      }
      return it;
    });
  }, [flightOrderItems, demandItems, rfqItems, quotationItems, stockAdjItems, wfPoItems, productionItems, maintenanceItems, items, reviews]);

  const counts = useMemo(() => {
    const pendingByCat = new Map<Category, number>();
    for (const c of CATEGORIES) pendingByCat.set(c.key, 0);
    let pending = 0, approvedToday = 0, rejectedToday = 0, reviewedToday = 0, valuePending = 0;
    for (const it of allItems) {
      if (it.status === "Pending") {
        pending++;
        pendingByCat.set(it.category, (pendingByCat.get(it.category) ?? 0) + 1);
        if (it.amount) valuePending += it.amount;
      } else if (it.processedAt?.startsWith(today)) {
        if (it.status === "Approved") approvedToday++;
        if (it.status === "Rejected") rejectedToday++;
        if (it.status === "Reviewed") reviewedToday++;
      }
    }
    return { pending, approvedToday, rejectedToday, reviewedToday, valuePending, pendingByCat };
  }, [allItems, today]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((it) => {
      if (activeTab !== "all" && it.category !== activeTab) return false;
      if (q && ![it.refId, it.title, it.requestedBy, it.summary].some((f) => f.toLowerCase().includes(q))) return false;
      const day = (it.requestedAt || "").slice(0, 10);
      if (dateFrom && day && day < dateFrom) return false;
      if (dateTo && day && day > dateTo) return false;
      return true;
    });
  }, [allItems, activeTab, search, dateFrom, dateTo]);

  const pendingItems = filtered.filter((it) => it.status === "Pending");
  const recentItems  = filtered
    .filter((it) => it.status !== "Pending")
    .sort((a, b) => (b.processedAt ?? "").localeCompare(a.processedAt ?? ""))
    .slice(0, 8);

  // Auto-fulfill side-effects for bulk-meal-plan demands: split items by
  // on-hand stock, raise one Transfer Note (in-stock portion) and one Purchase
  // Requisition (shortfalls), and pick the right next demand status. Mirrors
  // the prior behaviour from demand-orders.tsx which has been retired in
  // favour of this centralised approval queue.
  const approveDemand = (dr: WfDemandRequest, silent = false) => {
    const at = new Date().toLocaleString();

    if (!dr.autoFulfill) {
      updateDemandStatus(dr.id, "Pending Store Review", { approvedBy: role, approvedAt: at });
      if (!silent) toast.success(`${dr.id} approved — ready for Store Review.`);
      return;
    }

    const onHandFor = (name: string) => getItemStock(name);
    const tagged = dr.items.map((it) => {
      const onHand = onHandFor(it.name);
      const toIssue = Math.min(onHand, it.qty);
      return { ...it, onHand, toIssue, shortfall: Math.max(0, it.qty - onHand) };
    });
    const hasInStock = tagged.some((t) => t.toIssue > 0);
    const hasShortfall = tagged.some((t) => t.shortfall > 0);
    const created: string[] = [];
    const createdTnIds: string[] = [];
    const createdReqIds: string[] = [];

    if (hasInStock) {
      const tnId = `TN-${String(Date.now()).slice(-5)}`;
      const fromName = warehouses.find((w) => w.id === "WH-001")?.name ?? "Central Warehouse";
      const toName = warehouses.find((w) => w.id === dr.warehouseId)?.name ?? "Hot Kitchen";
      addTransferNote({
        id: tnId,
        demandRef: dr.id,
        grnRef: `Auto-allocated on approval of ${dr.id}`,
        items: tagged.filter((t) => t.toIssue > 0).map((t) => ({
          id: t.id, name: t.name, qty: Math.round(t.toIssue * 1000) / 1000, uom: t.uom,
        })),
        from: fromName,
        to: toName,
        issuedBy: role,
        date: at,
        status: "Pending",
        officeId: dr.officeId,
        warehouseId: dr.warehouseId,
      });
      created.push(`Issue ${tnId}`);
      createdTnIds.push(tnId);
    }

    if (hasShortfall) {
      const reqId = `REQ-${String(Date.now() + 1).slice(-5)}`;
      const shortItems = tagged.filter((t) => t.shortfall > 0).map((t) => ({
        id: t.id, name: t.name, qty: Math.ceil(t.shortfall), uom: t.uom, type: t.type,
      }));
      addRequisition({
        id: reqId,
        reference: dr.id,
        requestedBy: role,
        source: dr.source,
        date: at,
        status: "Pending Accounts",
        items: shortItems.length,
        note: `Auto-generated on approval of ${dr.id}. Covers shortfall on ${shortItems.length} material${shortItems.length === 1 ? "" : "s"}.`,
        demandRef: dr.id,
        demandItems: shortItems,
        officeId: dr.officeId,
        warehouseId: dr.warehouseId,
      });
      created.push(`PR ${reqId}`);
      createdReqIds.push(reqId);
    }

    // Patch the linked MRP run so its detail dialog stops saying "awaiting
    // approval" and starts listing the freshly created PR/TN ids.
    const linkedRun = mrpRuns.find((r) => r.demandRef === dr.id);
    if (linkedRun && (createdTnIds.length || createdReqIds.length)) {
      updateMrpRun(linkedRun.id, {
        requisitionIds: [...linkedRun.requisitionIds, ...createdReqIds],
        transferIds: [...linkedRun.transferIds, ...createdTnIds],
      });
    }

    const nextStatus: WfDemandStatus =
      !hasShortfall ? "Pending Store Review"
      : !hasInStock ? "Escalated to Supply Chain"
      : "Partially Available";
    updateDemandStatus(dr.id, nextStatus, { approvedBy: role, approvedAt: at });

    if (!silent) {
      toast.success(
        created.length > 0
          ? `${dr.id} approved · ${created.join(" + ")} created.`
          : `${dr.id} approved.`,
        { duration: 6000 },
      );
    }
  };

  const saveReturnItems = () => {
    if (!detailItem) return;
    const ra = returnApprovals.find((r) => r.id === detailItem.refId);
    if (!ra) return;
    for (let i = 0; i < ra.lines.length; i++) {
      const rq = Number(returnLineQtys[i]) || 0;
      if (rq < 0 || rq > ra.lines[i].returnQty) {
        toast.error(`Line ${i + 1}: Reusable QTY cannot exceed Return QTY (${ra.lines[i].returnQty}).`);
        return;
      }
      if (rq < ra.lines[i].returnQty && !returnLineReasons[i]?.trim()) {
        toast.error(`Line ${i + 1}: justification required when Reusable QTY is less than Return QTY.`);
        return;
      }
    }
    setReturnApprovals((prev) =>
      prev.map((r) =>
        r.id === detailItem.refId
          ? {
              ...r,
              status: "Approved",
              processedBy: `${role} (GM/Admin)`,
              processedAt: stamp(),
              lines: r.lines.map((l, i) => ({
                ...l,
                reusableQty: Number(returnLineQtys[i]) || 0,
                partialReason: Number(returnLineQtys[i]) < l.returnQty ? returnLineReasons[i]?.trim() : undefined,
              })),
            }
          : r,
      ),
    );
    // Add reusable qty back to consumable inventory stock
    setConsumableInventory((prev) => {
      const updated = [...prev];
      for (let i = 0; i < ra.lines.length; i++) {
        if (ra.lines[i].lineType !== "item") continue;
        const rq = Number(returnLineQtys[i]) || 0;
        if (rq <= 0) continue;
        const idx = updated.findIndex((it) => it.id === ra.lines[i].itemId);
        if (idx === -1) continue;
        const item = updated[idx];
        const newStock = item.stock + rq;
        updated[idx] = {
          ...item,
          stock: newStock,
          status: newStock < item.reorder * 0.5 ? "Critical" : newStock < item.reorder ? "Low" : "OK",
        };
      }
      return updated;
    });
    toast.success(`${detailItem.refId} — Return items approved. Reusable quantities saved.`);
    setReturnItemsSaved(true);
  };

  const approve = (it: ApprovalItem, opts: { silent?: boolean } = {}) => {
    const { silent = false } = opts;
    if (it.category === "Demand Request") {
      const dr = demands.find((d) => d.id === it.refId);
      if (!dr) {
        if (!silent) toast.error(`Demand ${it.refId} not found.`);
        return;
      }
      approveDemand(dr, silent);
      return;
    }
    if (it.category === "Flight Orders" || it.category === "Crew Orders") {
      const t = it.category === "Crew Orders" ? "crew" : "flight";
      const moved = updateFlightOrdersWhere(
        (o) => o.orderNo === it.refId && (o.orderType === "crew" ? "crew" : "flight") === t && o.status === "Pending",
        { status: "Approved" },
      );
      setFoDecisions((p) => ({
        ...p,
        [`${it.refId}__${t}`]: { status: "Approved", by: `${role} (GM/Admin)`, at: stamp() },
      }));
      if (!silent) toast.success(`${it.refId} approved — ${moved} flight${moved === 1 ? "" : "s"} moved to Approved.`);
      return;
    }
    if (it.category === "Request for Quotation") {
      setRfqStatus(it.refId, "Approved");
      setRfqDecisions((p) => ({
        ...p,
        [it.refId]: { status: "Approved", by: `${role} (GM/Admin)`, at: stamp() },
      }));
      if (!silent) toast.success(`${it.refId} approved.`);
      return;
    }
    if (it.category === "Quotation") {
      setQuotationStatus(it.refId, "Approved");
      setQuotationDecisions((p) => ({
        ...p,
        [it.refId]: { status: "Approved", by: `${role} (GM/Admin)`, at: stamp() },
      }));
      if (!silent) toast.success(`${it.refId} approved.`);
      return;
    }
    if (it.category === "Stock Adjustment") {
      setStockAdjustmentStatus(it.refId, "Approved");
      setStockAdjDecisions((p) => ({
        ...p,
        [it.refId]: { status: "Approved", by: `${role} (GM/Admin)`, at: stamp() },
      }));
      if (!silent) toast.success(`${it.refId} approved.`);
      return;
    }
    if (it.category === "Production Order" && it.id.startsWith("PRO-AP-")) {
      updateProductionEntryStatus(it.refId, "Approved");
      setProductionDecisions((p) => ({
        ...p,
        [it.refId]: { status: "Approved", by: `${role} (GM/Admin)`, at: stamp() },
      }));
      if (!silent) toast.success(`${it.refId} approved — released to production.`);
      return;
    }
    if (it.id.startsWith("WFPO-AP-")) {
      updatePurchaseOrder(it.refId, { status: "Approved" });
      if (!silent) toast.success(`${it.refId} approved — ready for receiving.`);
      return;
    }
    if (it.category === "Maintenance") {
      updateMaintenanceApproval(it.refId, {
        status: "Maintenance Approved",
        approvedBy: `${role} (GM/Admin)`,
        approvedAt: stamp(),
      });
      if (!silent) toast.success(`${it.refId} — Maintenance Approved.`);
      return;
    }
    if (it.category === "Return Items") {
      setReturnApprovals((prev) =>
        prev.map((ra) =>
          ra.id === it.refId
            ? { ...ra, status: "Approved", processedBy: `${role} (GM/Admin)`, processedAt: stamp() }
            : ra,
        ),
      );
      if (!silent) toast.success(`${it.refId} — Return items approved for Airport Store.`);
      return;
    }
    setItems((p) =>
      p.map((x) =>
        x.id === it.id
          ? { ...x, status: "Approved", processedBy: "R. Hossain (GM/Admin)", processedAt: stamp() }
          : x,
      ),
    );
    if (!silent) toast.success(`${it.refId} approved.`);
  };

  const openReject = (it: ApprovalItem) => {
    setBulkReject(false);
    setRejectTarget(it);
    setRejectReason("");
    setRejectOpen(true);
  };

  // Core reject for a single item (category-aware). `silent` suppresses the
  // per-item toast so bulk reject can show one summary instead.
  const rejectItem = (it: ApprovalItem, reason: string, silent = false) => {
    if (it.category === "Demand Request") {
      updateDemandStatus(it.refId, "Rejected", {
        rejectedBy: role,
        rejectedAt: new Date().toLocaleString(),
        rejectionReason: reason,
      });
    } else if (it.category === "Flight Orders" || it.category === "Crew Orders") {
      const t = it.category === "Crew Orders" ? "crew" : "flight";
      setFoDecisions((p) => ({
        ...p,
        [`${it.refId}__${t}`]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
    } else if (it.category === "Request for Quotation") {
      setRfqStatus(it.refId, "Rejected");
      setRfqDecisions((p) => ({
        ...p,
        [it.refId]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
    } else if (it.category === "Quotation") {
      setQuotationStatus(it.refId, "Rejected");
      setQuotationDecisions((p) => ({
        ...p,
        [it.refId]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
    } else if (it.category === "Stock Adjustment") {
      setStockAdjustmentStatus(it.refId, "Rejected");
      setStockAdjDecisions((p) => ({
        ...p,
        [it.refId]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
    } else if (it.category === "Production Order" && it.id.startsWith("PRO-AP-")) {
      setProductionDecisions((p) => ({
        ...p,
        [it.refId]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
    } else if (it.id.startsWith("WFPO-AP-")) {
      updatePurchaseOrder(it.refId, { status: "Rejected", rejectionReason: reason });
    } else if (it.category === "Maintenance") {
      updateMaintenanceApproval(it.refId, {
        status: "Rejected",
        rejectedBy: `${role} (GM/Admin)`,
        rejectedAt: stamp(),
        rejectionReason: reason,
      });
    } else if (it.category === "Return Items") {
      setReturnApprovals((prev) =>
        prev.map((ra) =>
          ra.id === it.refId
            ? { ...ra, status: "Declined", processedBy: `${role} (GM/Admin)`, processedAt: stamp(), declineReason: reason }
            : ra,
        ),
      );
    } else {
      setItems((p) =>
        p.map((x) =>
          x.id === it.id
            ? { ...x, status: "Rejected", processedBy: "R. Hossain (GM/Admin)", processedAt: stamp(), rejectionReason: reason }
            : x,
        ),
      );
    }
    if (!silent) toast.success(`${it.refId} rejected.`);
  };

  const confirmReject = () => {
    if (!rejectReason.trim()) {
      toast.error("Provide a reason for rejection.");
      return;
    }
    const reason = rejectReason.trim();

    if (bulkReject) {
      const targets = pendingItems.filter((it) => selected.has(it.id));
      targets.forEach((it) => rejectItem(it, reason, true));
      toast.success(`${targets.length} request${targets.length === 1 ? "" : "s"} rejected.`);
      setSelected(new Set());
      setBulkReject(false);
      setRejectOpen(false);
      return;
    }

    if (!rejectTarget) return;
    rejectItem(rejectTarget, reason);
    setRejectOpen(false);
    setRejectTarget(null);
  };

  // ── Bulk actions ────────────────────────────────────────────────────────────
  const bulkApprove = () => {
    const targets = pendingItems.filter((it) => selected.has(it.id));
    if (targets.length === 0) return;
    targets.forEach((it) => approve(it, { silent: true }));
    toast.success(`${targets.length} request${targets.length === 1 ? "" : "s"} approved.`);
    setSelected(new Set());
  };

  const openBulkReject = () => {
    if (selected.size === 0) return;
    setRejectTarget(null);
    setBulkReject(true);
    setRejectReason("");
    setRejectOpen(true);
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const allSelected = pendingItems.length > 0 && pendingItems.every((it) => selected.has(it.id));
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(pendingItems.map((it) => it.id)));

  // Clear selection when the visible set changes, so a batch action never hits
  // items hidden by the current tab/search.
  useEffect(() => { setSelected(new Set()); }, [activeTab, search]);
  // Reset the date-range filter when moving between category screens.
  useEffect(() => { setDateFrom(""); setDateTo(""); }, [activeTab]);

  const openDetail = (it: ApprovalItem) => {
    setDetailItem(it);
    setDetailOpen(true);
    setFulfillStoreDone(false);
    setEscalateDone(false);
    setShortfallQtys({});
    setDetailRejectOpen(false);
    setDetailRejectReason("");
    setDetailReviewOpen(false);
    setDetailReviewComment("");
    // Init per-line reusable qty inputs for Return Items
    if (it.category === "Return Items") {
      const ra = returnApprovals.find((r) => r.id === it.refId);
      const qtys: Record<number, string> = {};
      const reasons: Record<number, string> = {};
      ra?.lines.forEach((l, i) => {
        qtys[i] = l.reusableQty > 0 ? String(l.reusableQty) : "";
        reasons[i] = l.partialReason ?? "";
      });
      setReturnLineQtys(qtys);
      setReturnLineReasons(reasons);
    } else {
      setReturnLineQtys({});
      setReturnLineReasons({});
    }
    setReturnItemsSaved(false);
  };

  const handleFulfillFromStore = (dr: WfDemandRequest) => {
    const at = new Date().toLocaleString();
    const tagged = dr.items
      .map((it) => {
        const inv = inventory.find((i) => i.name.toLowerCase() === it.name.toLowerCase());
        const onHand = getItemStock(it.name);
        const toIssue = Math.min(onHand, it.qty);
        return { ...it, toIssue };
      })
      .filter((it) => it.toIssue > 0);
    if (tagged.length === 0) { toast.error("No items available in store."); return; }
    const tnId = `TN-${String(Date.now()).slice(-5)}`;
    const fromName = warehouses.find((w) => w.id === "WH-001")?.name ?? "Central Warehouse";
    const toName = warehouses.find((w) => w.id === dr.warehouseId)?.name ?? "Hot Kitchen";
    addTransferNote({
      id: tnId,
      demandRef: dr.id,
      grnRef: `Fulfilled from store — ${dr.id}`,
      items: tagged.map((t) => ({ id: t.id, name: t.name, qty: Math.round(t.toIssue * 1000) / 1000, uom: t.uom })),
      from: fromName,
      to: toName,
      issuedBy: role,
      date: at,
      status: "Pending",
      officeId: dr.officeId,
      warehouseId: dr.warehouseId,
    });
    setFulfillStoreDone(true);
    toast.success(`Transfer Note ${tnId} created — ${tagged.length} item${tagged.length === 1 ? "" : "s"} queued for issue from store.`);
  };

  const handleEscalateToSupplyChain = (dr: WfDemandRequest) => {
    const at = new Date().toLocaleString();
    const shortItems = dr.items
      .map((it) => {
        const inv = inventory.find((i) => i.name.toLowerCase() === it.name.toLowerCase());
        const onHand = getItemStock(it.name);
        const shortfall = Math.max(0, it.qty - onHand);
        const raw = shortfallQtys[it.id];
        const parsed = raw !== undefined ? parseFloat(raw) : NaN;
        const finalQty = !isNaN(parsed) && parsed > 0 ? parsed : shortfall;
        return { ...it, shortfall, finalQty };
      })
      .filter((it) => it.shortfall > 0);
    if (shortItems.length === 0) { toast.error("No shortfall items to escalate."); return; }
    const reqId = `REQ-${String(Date.now() + 1).slice(-5)}`;
    addRequisition({
      id: reqId,
      reference: dr.id,
      requestedBy: role,
      source: dr.source,
      date: at,
      status: "Pending Accounts",
      items: shortItems.length,
      note: `Escalated to Supply Chain from Approval Management. Demand: ${dr.id}. ${shortItems.length} material${shortItems.length === 1 ? "" : "s"} short.`,
      demandRef: dr.id,
      demandItems: shortItems.map((t) => ({ id: t.id, name: t.name, qty: Math.ceil(t.finalQty), uom: t.uom, type: t.type })),
      officeId: dr.officeId,
      warehouseId: dr.warehouseId,
    });
    setEscalateDone(true);
    toast.success(`PR ${reqId} raised — ${shortItems.length} shortfall item${shortItems.length === 1 ? "" : "s"} escalated to Supply Chain.`);
  };

  const confirmDetailReject = () => {
    if (!detailItem) return;
    if (!detailRejectReason.trim()) { toast.error("Provide a reason for rejection."); return; }
    const reason = detailRejectReason.trim();
    if (detailItem.category === "Demand Request") {
      updateDemandStatus(detailItem.refId, "Rejected", {
        rejectedBy: role,
        rejectedAt: new Date().toLocaleString(),
        rejectionReason: reason,
      });
    } else if (detailItem.category === "Flight Orders" || detailItem.category === "Crew Orders") {
      const t = detailItem.category === "Crew Orders" ? "crew" : "flight";
      setFoDecisions((p) => ({
        ...p,
        [`${detailItem.refId}__${t}`]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
    } else if (detailItem.category === "Request for Quotation") {
      setRfqStatus(detailItem.refId, "Rejected");
      setRfqDecisions((p) => ({
        ...p,
        [detailItem.refId]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
    } else if (detailItem.category === "Quotation") {
      setQuotationStatus(detailItem.refId, "Rejected");
      setQuotationDecisions((p) => ({
        ...p,
        [detailItem.refId]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
    } else if (detailItem.category === "Stock Adjustment") {
      setStockAdjustmentStatus(detailItem.refId, "Rejected");
      setStockAdjDecisions((p) => ({
        ...p,
        [detailItem.refId]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
    } else if (detailItem.category === "Production Order" && detailItem.id.startsWith("PRO-AP-")) {
      setProductionDecisions((p) => ({
        ...p,
        [detailItem.refId]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
    } else if (detailItem.id.startsWith("WFPO-AP-")) {
      updatePurchaseOrder(detailItem.refId, { status: "Rejected", rejectionReason: reason });
    } else if (detailItem.category === "Maintenance") {
      updateMaintenanceApproval(detailItem.refId, {
        status: "Rejected",
        rejectedBy: `${role} (GM/Admin)`,
        rejectedAt: stamp(),
        rejectionReason: reason,
      });
    } else if (detailItem.category === "Return Items") {
      setReturnApprovals((prev) =>
        prev.map((ra) =>
          ra.id === detailItem.refId
            ? { ...ra, status: "Declined", processedBy: `${role} (GM/Admin)`, processedAt: stamp(), declineReason: reason }
            : ra,
        ),
      );
    } else {
      setItems((p) =>
        p.map((x) =>
          x.id === detailItem.id
            ? { ...x, status: "Rejected", processedBy: "R. Hossain (GM/Admin)", processedAt: stamp(), rejectionReason: reason }
            : x,
        ),
      );
    }
    toast.success(`${detailItem.refId} rejected.`);
    setDetailOpen(false);
    setDetailRejectOpen(false);
    setDetailRejectReason("");
    setDetailItem(null);
  };

  // Send the request back to the requester for correction with a comment, rather
  // than rejecting it outright. Recorded in the session-local `reviews` overlay;
  // the requester sees status "Reviewed" with the approver's comment.
  const confirmDetailReview = () => {
    if (!detailItem) return;
    if (!detailReviewComment.trim()) { toast.error("Provide a review comment for the requester."); return; }
    const comment = detailReviewComment.trim();
    const by = `${role} (GM/Admin)`;
    const at = stamp();
    // Flight / Crew orders persist the review onto the order itself (store) so the
    // requester sees the "Reviewed" status + comment on Order Management. Other
    // categories use the session-local overlay (their requester screens don't
    // carry a review surface yet).
    if (detailItem.category === "Flight Orders" || detailItem.category === "Crew Orders") {
      const t = detailItem.category === "Crew Orders" ? "crew" : "flight";
      updateFlightOrdersWhere(
        (o) => o.orderNo === detailItem.refId && (o.orderType === "crew" ? "crew" : "flight") === t && o.status === "Pending",
        { reviewComment: comment, reviewedBy: by, reviewedAt: at },
      );
    } else {
      setReview(detailItem.category, detailItem.refId, { by, at, comment });
    }
    toast.success(`${detailItem.refId} sent back to the requester for correction.`);
    setDetailOpen(false);
    setDetailReviewOpen(false);
    setDetailReviewComment("");
    setDetailItem(null);
  };

  return (
    <>
      <PageHeader
        title="Approval Management"
        subtitle="Centralized approval queue — all module approvals are processed from here only"
      />

      <div className="usb-livery-stripe h-1 rounded-full mb-5" aria-hidden />

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Pending Approvals" value={counts.pending}        sub="awaiting action"      icon={Clock}         tone="warning" />
        <KpiCard label="Approved Today"    value={counts.approvedToday}  sub="processed today"      icon={Check}         tone="success" />
        <KpiCard label="Returned Today"    value={counts.reviewedToday}  sub="sent for correction"  icon={CornerUpLeft}  tone="info" />
        <KpiCard label="Rejected Today"    value={counts.rejectedToday}  sub="processed today"      icon={XIcon}         tone="red"     />
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Category | "all")}>
        {activeTab === "all" ? (
          /* ── Overview — category cards grouped by business section ────────── */
          <div className="space-y-6 mb-2">
            {APPROVAL_SECTIONS.map((section) => (
              <div key={section.label}>
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                  {section.label}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                  {section.keys.map((key) => {
                    const c = CATEGORY_BY_KEY.get(key)!;
                    const Icon = c.icon;
                    const n = key === "Dispatch" ? dispatchPendingCount : (counts.pendingByCat.get(key) ?? 0);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setActiveTab(key)}
                        className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/40"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-medium text-foreground leading-tight">
                          {c.label}
                        </span>
                        <span
                          className={cn(
                            "grid h-6 min-w-[1.5rem] shrink-0 place-items-center rounded-full px-1.5 text-xs font-semibold tabular-nums text-white",
                            n > 0 ? "bg-rose-500" : "bg-emerald-500",
                          )}
                        >
                          {n}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ── Category detail — back + date range + search above the queue ──── */
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setActiveTab("all")}>
              <ArrowLeft className="h-3.5 w-3.5" /> All Approvals
            </Button>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 shadow-sm">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">From</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-7 w-[140px] border-0 shadow-none px-1 focus-visible:ring-0"
                />
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">To</Label>
                <Input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-7 w-[140px] border-0 shadow-none px-1 focus-visible:ring-0"
                />
              </div>
              {(dateFrom || dateTo) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-muted-foreground"
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                  aria-label="Clear date range"
                >
                  <XIcon className="h-3.5 w-3.5 mr-1" /> Date
                </Button>
              )}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search ref, requester, summary..."
                  className="pl-8 h-8 w-72"
                />
              </div>
            </div>
          </div>
        )}

        {/* Pending list — only in category detail; the overview shows the grid. */}
        {activeTab !== "all" && (
        <TabsContent value={activeTab} className="mt-0 space-y-4">

          {/* ── Dispatch subtab ─────────────────────────────────────────────── */}
          {activeTab === "Dispatch" && (
            <Card className="brand-accent-border-left">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
                    <Truck className="h-4 w-4 text-muted-foreground" /> Dispatch — Pending Head of Catering Approval
                  </h3>
                  <span className="text-xs text-muted-foreground">{dispatchPendingCount} item{dispatchPendingCount === 1 ? "" : "s"}</span>
                </div>
                {dispatchApprovals.filter(d => d.stage === "pending_hoc").length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-10">No dispatch entries pending approval.</div>
                ) : (
                  <div className="border border-border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Vehicle</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Total Qty</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Result</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dispatchApprovals.filter(d => d.stage === "pending_hoc").map(da => (
                          <TableRow key={da.id} className="hover:bg-muted/30">
                            <TableCell className="font-semibold text-blue-700 text-xs">{da.flightLabel}</TableCell>
                            <TableCell className="text-xs">{da.packagingDate}</TableCell>
                            <TableCell className="text-xs">{da.vehicleNo}</TableCell>
                            <TableCell className="text-xs font-medium">{da.totalQty} pax</TableCell>
                            <TableCell>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${da.resultSatisfy === "Yes" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                                {da.resultSatisfy}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-7 w-7 text-muted-foreground hover:text-primary hover:border-primary/40"
                                onClick={() => { setDispatchViewEntry(da); setDispatchApproveStep("approve"); setDispatchApproveLog(null); setDispatchViewOpen(true); }}
                                title="View dispatch details"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Galley Loading subtab ──────────────────────────────────────────── */}
          {activeTab === "Galley Loading" && (
            <Card className="brand-accent-border-left">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4 text-muted-foreground" /> Galley Loading — Awaiting Approval
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {galleyLoadingRecords.filter((r) => r.galleyStatus === "awaiting_approval").length} item(s)
                  </span>
                </div>
                {galleyLoadingRecords.filter((r) => r.galleyStatus === "awaiting_approval").length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-10">No galley loading records pending approval.</div>
                ) : (
                  <div className="border border-border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Forwarded At</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Loading Duration</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {galleyLoadingRecords.filter((r) => r.galleyStatus === "awaiting_approval").map((rec) => (
                          <TableRow key={rec.id} className="hover:bg-muted/30">
                            <TableCell className="font-semibold text-sky-700 text-xs">{rec.flightLabel}</TableCell>
                            <TableCell className="text-xs">{rec.date}</TableCell>
                            <TableCell className="text-xs tabular-nums">{rec.forwardedAt}</TableCell>
                            <TableCell className="text-xs tabular-nums">
                              {rec.loadingDurationSec != null ? formatGalleyDuration(rec.loadingDurationSec) : "—"}
                            </TableCell>
                            <TableCell>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                                Awaiting Approval
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-7 w-7 text-muted-foreground hover:text-sky-600 hover:border-sky-400"
                                onClick={() => { setGalleyDetailRecord(rec); setGalleyEditMode(false); setGalleyEditPlan(rec.galleyPlan); setGalleyDetailOpen(true); }}
                                title="View galley details"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Approved records */}
                {galleyLoadingRecords.filter((r) => r.galleyStatus === "approved").length > 0 && (
                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Approved — Ready To Fly</p>
                    <div className="border border-border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader className="bg-muted/40">
                          <TableRow>
                            <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                            <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                            <TableHead className="text-xs uppercase tracking-wider">Approved By</TableHead>
                            <TableHead className="text-xs uppercase tracking-wider">Approved At</TableHead>
                            <TableHead className="text-xs uppercase tracking-wider text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {galleyLoadingRecords.filter((r) => r.galleyStatus === "approved").map((rec) => (
                            <TableRow key={rec.id} className="hover:bg-muted/30">
                              <TableCell className="font-semibold text-emerald-700 text-xs">{rec.flightLabel}</TableCell>
                              <TableCell className="text-xs">{rec.date}</TableCell>
                              <TableCell className="text-xs font-medium">{rec.approvedBy ?? "—"}</TableCell>
                              <TableCell className="text-xs tabular-nums">{rec.approvedAt ?? "—"}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-7 w-7 text-muted-foreground hover:text-emerald-600 hover:border-emerald-400"
                                  onClick={() => { setGalleyDetailRecord(rec); setGalleyEditMode(false); setGalleyEditPlan(rec.galleyPlan); setGalleyDetailOpen(true); }}
                                  title="View galley details"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab !== "Dispatch" && activeTab !== "Galley Loading" && (<><Card className="brand-accent-border-left">
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider">
                  Pending — {activeTab}
                </h3>
                <span className="text-xs text-muted-foreground">{pendingItems.length} item{pendingItems.length === 1 ? "" : "s"}</span>
              </div>

              {/* Bulk action bar — appears once one or more items are ticked */}
              {selected.size > 0 && (
                <div className="flex items-center justify-between gap-3 mb-3 rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-2">
                  <span className="text-xs font-medium text-foreground">
                    {selected.size} selected
                    <button
                      className="ml-2 text-muted-foreground hover:text-foreground underline underline-offset-2"
                      onClick={() => setSelected(new Set())}
                    >
                      Clear
                    </button>
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-[11px] bg-success text-success-foreground hover:bg-success/90"
                      onClick={bulkApprove}
                    >
                      <Check className="h-3 w-3 mr-1" /> Approve {selected.size}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 text-[11px] border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={openBulkReject}
                    >
                      <XIcon className="h-3 w-3 mr-1" /> Reject {selected.size}
                    </Button>
                  </div>
                </div>
              )}

              {pendingItems.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-10">
                  Nothing pending here. All caught up.
                </div>
              ) : (
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="w-9">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary cursor-pointer align-middle"
                            checked={allSelected}
                            onChange={toggleSelectAll}
                            aria-label="Select all pending"
                            title="Select all"
                          />
                        </TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Ref / Title</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Requested By</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Amount / Items</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingItems.map((it) => {
                        return (
                          <TableRow key={it.id} className={cn("hover:bg-muted/30", selected.has(it.id) && "bg-primary/[0.04]")}>
                            <TableCell className="w-9">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-primary cursor-pointer align-middle"
                                checked={selected.has(it.id)}
                                onChange={() => toggleSelect(it.id)}
                                aria-label={`Select ${it.refId}`}
                              />
                            </TableCell>
                            <TableCell>
                              <button
                                className="text-left hover:underline focus:outline-none focus:underline"
                                onClick={() => openDetail(it)}
                              >
                                <div className="font-mono text-xs text-foreground">{it.refId}</div>
                                <div className="text-sm font-medium text-foreground">{it.title}</div>
                                <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{it.summary}</div>
                              </button>
                            </TableCell>
                            <TableCell className="text-xs">{it.requestedBy}</TableCell>
                            <TableCell className="text-xs text-muted-foreground tabular-nums">{it.requestedAt}</TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {it.amount !== undefined ? (
                                <div className="font-semibold text-foreground">৳ {it.amount.toLocaleString()}</div>
                              ) : null}
                              {it.itemsCount !== undefined ? (
                                <div className="text-[11px] text-muted-foreground">{it.itemsCount} item{it.itemsCount > 1 ? "s" : ""}</div>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-7 w-7 text-muted-foreground hover:text-primary hover:border-primary/40"
                                  onClick={() => openDetail(it)}
                                  aria-label={`View ${it.refId}`}
                                  title="View details"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-7 px-2 text-[11px] bg-success text-success-foreground hover:bg-success/90"
                                  onClick={() => approve(it)}
                                >
                                  <Check className="h-3 w-3 mr-1" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-[11px] border-destructive/40 text-destructive hover:bg-destructive/10"
                                  onClick={() => openReject(it)}
                                >
                                  <XIcon className="h-3 w-3 mr-1" /> Reject
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recently processed */}
          <Card className="navy-accent-border-left">
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider inline-flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" /> Recently Processed
                </h3>
                <span className="text-xs text-muted-foreground">{recentItems.length} item{recentItems.length === 1 ? "" : "s"}</span>
              </div>
              {recentItems.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-6">
                  No recent activity in this view.
                </div>
              ) : (
                <div className="space-y-2">
                  {recentItems.map((it) => {
                    const Icon = categoryIcon(it.category);
                    const approved = it.status === "Approved";
                    const reviewed = it.status === "Reviewed";
                    return (
                      <button
                        key={it.id}
                        onClick={() => openDetail(it)}
                        className="w-full text-left rounded-md border border-border p-3 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="font-normal text-[10px]">
                                <Icon className="h-2.5 w-2.5 mr-1" /> {it.category}
                              </Badge>
                              <span className="font-mono text-xs text-foreground">{it.refId}</span>
                            </div>
                            <div className="mt-1 text-sm font-medium">{it.title}</div>
                            <div className="text-[11px] text-muted-foreground">{it.summary}</div>
                            {it.reviewComment && (
                              <div className="mt-1 text-[11px] text-amber-700">
                                <span className="font-medium">Comment:</span> {it.reviewComment}
                              </div>
                            )}
                            {it.rejectionReason && (
                              <div className="mt-1 text-[11px] text-destructive">
                                <span className="font-medium">Reason:</span> {it.rejectionReason}
                              </div>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <Badge
                              variant="outline"
                              className={cn(
                                "font-medium text-[10px]",
                                approved && "bg-success/10 text-success border-success/30",
                                reviewed && "bg-amber-100 text-amber-700 border-amber-300",
                                !approved && !reviewed && "bg-destructive/10 text-destructive border-destructive/30",
                              )}
                            >
                              {approved ? <Check className="h-2.5 w-2.5 mr-1" /> : reviewed ? <CornerUpLeft className="h-2.5 w-2.5 mr-1" /> : <XIcon className="h-2.5 w-2.5 mr-1" />}
                              {it.status}
                            </Badge>
                            <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">{it.processedAt}</div>
                            <div className="text-[11px] text-muted-foreground">by {it.processedBy}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card></>)}
        </TabsContent>
        )}
      </Tabs>

      {/* ── Dispatch detail modal ──────────────────────────────────────────── */}
      <Dialog open={dispatchViewOpen} onOpenChange={(v) => { if (!v) setDispatchViewOpen(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b border-border">
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" />
              <span className="font-mono text-sm text-muted-foreground">{dispatchViewEntry?.id}</span>
              <span>— {dispatchViewEntry?.flightLabel}</span>
            </DialogTitle>
            <DialogDescription>Dispatch approval detail — Head of Catering</DialogDescription>
          </DialogHeader>

          {dispatchViewEntry && (
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Status strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
                <Badge variant="outline" className="font-medium text-[11px] h-6 px-2 bg-warning/15 text-warning-foreground border-warning/40">
                  <Clock className="h-3 w-3 mr-1" />
                  {dispatchApproveStep === "approve" && dispatchApproveLog === null ? "Pending HoC Approval" : dispatchApproveStep === "forward" ? "Approved — Awaiting Forward to Airport" : "Awaiting HoC Approval"}
                </Badge>
                <div className="text-[11px] text-muted-foreground tabular-nums">Date: {dispatchViewEntry.packagingDate}</div>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                <Detail label="Flight" icon={PlaneTakeoff} value={<span className="font-semibold text-blue-700">{dispatchViewEntry.flightLabel}</span>} />
                <Detail label="Vehicle No." value={dispatchViewEntry.vehicleNo} />
                <Detail label="Total Qty" value={`${dispatchViewEntry.totalQty} pax`} />
                <Detail label="Vehicle Clean" value={
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${dispatchViewEntry.vehicleClean === "Yes" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                    {dispatchViewEntry.vehicleClean}
                  </span>
                } />
                <Detail label="Result Satisfy" value={
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${dispatchViewEntry.resultSatisfy === "Yes" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                    {dispatchViewEntry.resultSatisfy}
                  </span>
                } />
                <Detail label="Chilled Temp" value={dispatchViewEntry.chilledTemp ? `${dispatchViewEntry.chilledTemp}°C` : "—"} />
                <Detail label="Frozen Temp" value={dispatchViewEntry.frozenTemp ? `${dispatchViewEntry.frozenTemp}°C` : "—"} />
                <Detail label="Veh. Temp Begin" value={dispatchViewEntry.vehicleTempBegin ? `${dispatchViewEntry.vehicleTempBegin}°C` : "—"} />
                <Detail label="Veh. Temp End" value={dispatchViewEntry.vehicleTempEnd ? `${dispatchViewEntry.vehicleTempEnd}°C` : "—"} />
                <Detail label="Load Start" value={dispatchViewEntry.loadStartTime || "—"} />
                <Detail label="Load End" value={dispatchViewEntry.loadEndTime || "—"} />
                <Detail label="Gate 08 Temp" value={dispatchViewEntry.gateTempGate08 ? `${dispatchViewEntry.gateTempGate08}°C` : "—"} />
              </div>

              {/* FS Verified info */}
              <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-medium mb-1 flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" /> Verified By — Food Safety &amp; Hygiene
                </div>
                <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{dispatchViewEntry.verifiedByDate}, {dispatchViewEntry.verifiedByTime}</span>
                </div>
                {dispatchViewEntry.verifiedByRemarks && (
                  <p className="text-xs text-slate-600 mt-1.5 italic">"{dispatchViewEntry.verifiedByRemarks}"</p>
                )}
              </div>

              {/* HoC approval log — shown after approving */}
              {dispatchApproveLog && (
                <div className="rounded-md border border-violet-200 bg-violet-50/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium mb-1 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Approved By — Head of Catering
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-foreground">
                    <UserIcon className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{dispatchApproveLog.by}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="tabular-nums text-muted-foreground">{dispatchApproveLog.at}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="px-5 py-3 border-t border-border bg-muted/20 flex gap-2 justify-end">
            {dispatchViewEntry && dispatchApproveStep === "approve" && (
              <Button
                className="bg-violet-600 hover:bg-violet-700 text-white"
                onClick={() => {
                  const at = stamp();
                  const log = { by: `${role} (Head of Catering)`, at };
                  setDispatchApproveLog(log);
                  updateDispatchApproval(dispatchViewEntry.id, { stage: "forwarded_to_airport", approvedBy: log.by, approvedAt: at, forwardedAt: at });
                  setDispatchViewOpen(false);
                  navigate("/dispatch");
                }}
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5" /> Approve Dispatch
              </Button>
            )}
            <Button variant="outline" onClick={() => setDispatchViewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={(o) => { setRejectOpen(o); if (!o) setBulkReject(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {bulkReject ? `Reject ${selected.size} request${selected.size === 1 ? "" : "s"}` : `Reject ${rejectTarget?.refId}`}
            </DialogTitle>
            <DialogDescription>
              {bulkReject
                ? "The same reason will be recorded on every selected request, and each requester is notified."
                : "Rejection notifies the requester. Provide a clear reason."}
            </DialogDescription>
          </DialogHeader>
          {bulkReject ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs max-h-40 overflow-y-auto space-y-1">
              {pendingItems.filter((it) => selected.has(it.id)).map((it) => (
                <div key={it.id} className="flex justify-between gap-2">
                  <span className="font-mono text-foreground">{it.refId}</span>
                  <span className="text-muted-foreground truncate">{it.title}</span>
                </div>
              ))}
            </div>
          ) : rejectTarget && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
              <div className="text-foreground font-medium">{rejectTarget.title}</div>
              <div className="text-muted-foreground mt-0.5">{rejectTarget.summary}</div>
            </div>
          )}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why this is being rejected..."
              className="mt-1 min-h-24"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmReject}>
              <XIcon className="h-4 w-4 mr-1.5" /> Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b border-border">
            <DialogTitle className="flex items-center gap-2">
              {detailItem && (() => {
                const Icon = categoryIcon(detailItem.category);
                return <Icon className="h-4 w-4 text-primary" />;
              })()}
              <span className="font-mono text-sm text-muted-foreground">{detailItem?.refId}</span>
              <span className="text-foreground">— {detailItem?.title}</span>
            </DialogTitle>
            <DialogDescription>{detailItem?.category} approval detail</DialogDescription>
          </DialogHeader>

          {detailItem && (
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Status strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "font-medium text-[11px] h-6 px-2",
                    detailItem.status === "Approved" && "bg-success/10 text-success border-success/30",
                    detailItem.status === "Rejected" && "bg-destructive/10 text-destructive border-destructive/30",
                    detailItem.status === "Pending"  && "bg-warning/15 text-warning-foreground border-warning/40",
                    detailItem.status === "Reviewed" && "bg-amber-100 text-amber-700 border-amber-300",
                  )}
                >
                  {detailItem.status === "Approved" && <Check className="h-3 w-3 mr-1" />}
                  {detailItem.status === "Rejected" && <XIcon className="h-3 w-3 mr-1" />}
                  {detailItem.status === "Pending"  && <Clock className="h-3 w-3 mr-1" />}
                  {detailItem.status === "Reviewed" && <CornerUpLeft className="h-3 w-3 mr-1" />}
                  {detailItem.status === "Reviewed" ? "Reviewed — returned for correction" : detailItem.status}
                </Badge>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  Raised <span className="text-foreground">{detailItem.requestedAt}</span>
                </div>
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                <Detail
                  label="Reference"
                  icon={Hash}
                  value={<span className="font-mono">{detailItem.refId}</span>}
                />
                <Detail
                  label="Category"
                  icon={categoryIcon(detailItem.category)}
                  value={detailItem.category}
                />
                <Detail
                  label="Requested By"
                  icon={UserIcon}
                  value={detailItem.requestedBy}
                />
                <Detail
                  label="Date"
                  icon={Calendar}
                  value={<span className="tabular-nums">{detailItem.requestedAt}</span>}
                />
                {detailItem.amount !== undefined && (
                  <Detail
                    label="Amount"
                    value={<span className="font-semibold tabular-nums text-primary">৳ {detailItem.amount.toLocaleString()}</span>}
                  />
                )}
                {detailItem.itemsCount !== undefined && (
                  <Detail
                    label="Items"
                    value={`${detailItem.itemsCount} item${detailItem.itemsCount > 1 ? "s" : ""}`}
                  />
                )}
              </div>

              {/* Summary */}
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                  Summary
                </div>
                <div className="text-sm leading-relaxed">{detailItem.summary}</div>
              </div>

              {/* Flight / Crew orders — flight legs in this order */}
              {(detailItem.category === "Flight Orders" || detailItem.category === "Crew Orders") && (() => {
                const legs = flightOrders.filter((o) => o.orderNo === detailItem.refId);
                if (legs.length === 0) return null;
                return (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                      Flights ({legs.length})
                    </div>
                    <div className="rounded-md border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Flight</th>
                            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Sector</th>
                            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Date / ETD</th>
                            <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Pax</th>
                            <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Crew</th>
                            <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Special</th>
                            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {legs.map((l, idx) => (
                            <tr key={l.id} className={`border-t border-border ${idx % 2 === 0 ? "" : "bg-muted/20"}`}>
                              <td className="px-3 py-2">
                                <div className="font-medium text-foreground">{l.flight}</div>
                                <div className="text-[10px] text-muted-foreground">{l.airline}</div>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{l.sector}</td>
                              <td className="px-3 py-2 tabular-nums">
                                <div>{l.date}</div>
                                <div className="text-[10px] text-muted-foreground">{l.etd}</div>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{l.pax}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{l.crew}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{l.specialMeals > 0 ? l.specialMeals : "—"}</td>
                              <td className="px-3 py-2">
                                <Badge variant="outline" className="font-normal text-[10px]">{l.status}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* Return Items — Return QTY shown + editable Reusable QTY inputs for approver */}
              {detailItem.category === "Return Items" && (() => {
                const ra = returnApprovals.find((r) => r.id === detailItem.refId);
                if (!ra || ra.lines.length === 0) return null;
                const isPending = ra.status === "Pending";
                return (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                      Returned Items — {ra.flight} ({ra.lines.length} line{ra.lines.length === 1 ? "" : "s"})
                      {isPending && <span className="ml-2 normal-case text-indigo-600">Enter Reusable QTY below</span>}
                    </div>
                    <div className="rounded-md border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Item</th>
                            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground w-16">Type</th>
                            <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground w-28">Return QTY</th>
                            <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground w-32">Reusable QTY</th>
                            <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground w-36">Wastage</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ra.lines.map((l, idx) => (
                            <tr key={`${l.itemId}-${idx}`} className={`border-t border-border ${idx % 2 === 0 ? "" : "bg-muted/20"}`}>
                              <td className="px-3 py-2">
                                <div className="font-medium text-foreground">{l.itemName}</div>
                                <div className="text-[10px] text-muted-foreground font-mono">{l.itemId}</div>
                              </td>
                              <td className="px-3 py-2">
                                <Badge variant="outline" className="text-[10px]">
                                  {l.lineType === "meal" ? "Meal" : "Item"}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 text-center tabular-nums">
                                <span className="font-semibold">{l.returnQty}</span>
                                <span className="text-[10px] text-muted-foreground ml-1">{l.uom}</span>
                              </td>
                              {/* Reusable QTY */}
                              <td className="px-3 py-2 text-center">
                                {isPending ? (
                                  <div className="flex items-center justify-center gap-1.5">
                                    <Input
                                      type="number"
                                      min={0}
                                      max={l.returnQty}
                                      placeholder="0"
                                      value={returnLineQtys[idx] ?? ""}
                                      onChange={(e) => setReturnLineQtys((prev) => ({ ...prev, [idx]: e.target.value }))}
                                      className="h-7 w-20 text-center text-xs tabular-nums"
                                    />
                                    <span className="text-[10px] text-muted-foreground">{l.uom}</span>
                                  </div>
                                ) : (
                                  <>
                                    <span className={cn("font-semibold tabular-nums", l.reusableQty > 0 ? "text-success" : "text-muted-foreground")}>
                                      {l.reusableQty}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground ml-1">{l.uom}</span>
                                  </>
                                )}
                              </td>
                              {/* Wastage — auto-computed */}
                              <td className="px-3 py-2 text-center">
                                {isPending ? (() => {
                                  const hasInput = returnLineQtys[idx] !== "" && returnLineQtys[idx] !== undefined;
                                  if (!hasInput) return <span className="text-[10px] text-muted-foreground">—</span>;
                                  const wastage = l.returnQty - (Number(returnLineQtys[idx]) || 0);
                                  return (
                                    <div className="flex flex-col items-center gap-1.5">
                                      <div>
                                        <span className={cn("font-semibold tabular-nums text-xs", wastage > 0 ? "text-destructive" : "text-muted-foreground")}>
                                          {wastage}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground ml-1">{l.uom}</span>
                                      </div>
                                      {wastage > 0 && (
                                        <Input
                                          placeholder="Justification (required)"
                                          value={returnLineReasons[idx] ?? ""}
                                          onChange={(e) => setReturnLineReasons((prev) => ({ ...prev, [idx]: e.target.value }))}
                                          className="h-7 w-44 text-xs"
                                        />
                                      )}
                                    </div>
                                  );
                                })() : (() => {
                                  const wastage = l.returnQty - l.reusableQty;
                                  return (
                                    <>
                                      <span className={cn("font-semibold tabular-nums text-xs", wastage > 0 ? "text-destructive" : "text-muted-foreground")}>
                                        {wastage}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground ml-1">{l.uom}</span>
                                      {l.partialReason && (
                                        <div className="text-[10px] text-muted-foreground mt-0.5 italic">{l.partialReason}</div>
                                      )}
                                    </>
                                  );
                                })()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* Generic line items — PR / PO / GRN / Transfer / Stock Adj / Production / BOM */}
              {detailItem.category !== "Return Items" && detailItem.lines && detailItem.lines.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                    Line Items ({detailItem.lines.length})
                  </div>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Item</th>
                          <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground w-32">Quantity</th>
                          {detailItem.lines.some((l) => l.note) && (
                            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Note</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {detailItem.lines.map((l, idx) => (
                          <tr key={`${l.name}-${idx}`} className={`border-t border-border ${idx % 2 === 0 ? "" : "bg-muted/20"}`}>
                            <td className="px-3 py-2 font-medium text-foreground">{l.name}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {l.qty !== undefined ? (
                                <span className={l.qty < 0 ? "text-destructive font-semibold" : "font-semibold"}>
                                  {l.qty}
                                </span>
                              ) : "—"}
                              {l.uom && <span className="text-[10px] text-muted-foreground ml-1">{l.uom}</span>}
                            </td>
                            {detailItem.lines!.some((x) => x.note) && (
                              <td className="px-3 py-2 text-[11px] text-muted-foreground">{l.note ?? ""}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Single-record fields — e.g. User Account */}
              {detailItem.fields && detailItem.fields.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                    Details
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-border bg-muted/20 p-3">
                    {detailItem.fields.map((f) => (
                      <Detail key={f.label} label={f.label} value={f.value} />
                    ))}
                  </div>
                </div>
              )}

              {/* Item list — Demand Requests only, split by sufficient / shortfall */}
              {detailItem.category === "Demand Request" && (() => {
                const dr = demands.find((d) => d.id === detailItem.refId);
                if (!dr || dr.items.length === 0) return null;
                const taggedItems = dr.items.map((item) => {
                  const inv = inventory.find((i) => i.id === item.id || i.name.toLowerCase() === item.name.toLowerCase());
                  const inStock = getItemStock(item.id || item.name);
                  const shortfall = item.qty - inStock;
                  return { ...item, inStock, shortfall, insufficient: shortfall > 0 };
                });
                const sufficientItems = taggedItems.filter((it) => !it.insufficient);
                const shortfallItems  = taggedItems.filter((it) => it.insufficient);
                return (
                  <>
                    {/* Sufficient Items */}
                    {sufficientItems.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <CheckCircle2 className="h-3 w-3 text-success" />
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                            Sufficient Items ({sufficientItems.length})
                          </span>
                        </div>
                        <div className="rounded-md border border-success/30 overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-success/5">
                              <tr>
                                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Item</th>
                                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground w-24">In Stock</th>
                                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground w-24">Required</th>
                                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground w-20">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sufficientItems.map((item, idx) => (
                                <tr key={item.id} className={`border-t border-border ${idx % 2 === 0 ? "" : "bg-muted/20"}`}>
                                  <td className="px-3 py-2">
                                    <div className="font-medium text-foreground">{item.name}</div>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className="font-semibold tabular-nums text-success">{item.inStock}</span>
                                    <div className="text-[10px] text-muted-foreground">{item.uom}</div>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className="font-semibold tabular-nums">{item.qty}</span>
                                    <div className="text-[10px] text-muted-foreground">{item.uom}</div>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className="font-bold text-success text-xs">OK</span>
                                    <div className="text-[10px] text-success">sufficient</div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {detailItem.status === "Pending" && (
                          <div className="flex justify-end mt-2">
                            {fulfillStoreDone ? (
                              <Button size="sm" variant="outline" disabled className="h-7 px-3 text-[11px] border-success/40 text-success">
                                <CheckCircle2 className="h-3 w-3 mr-1.5" /> Fulfilled from Store ✓
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                className="h-7 px-3 text-[11px] bg-success text-success-foreground hover:bg-success/90"
                                onClick={() => handleFulfillFromStore(dr)}
                              >
                                <PackageCheck className="h-3 w-3 mr-1.5" /> Fulfill From Store
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Shortfall Items */}
                    {shortfallItems.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <AlertTriangle className="h-3 w-3 text-destructive" />
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                            Shortfall Items ({shortfallItems.length})
                          </span>
                        </div>
                        <div className="rounded-md border border-destructive/30 overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-destructive/5">
                              <tr>
                                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Item</th>
                                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground w-20">In Stock</th>
                                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground w-20">Required</th>
                                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground w-20">Shortfall</th>
                                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-muted-foreground w-28">Escalate Qty</th>
                              </tr>
                            </thead>
                            <tbody>
                              {shortfallItems.map((item, idx) => (
                                <tr key={item.id} className={`border-t border-border ${idx % 2 === 0 ? "" : "bg-muted/20"}`}>
                                  <td className="px-3 py-2">
                                    <div className="font-medium text-foreground">{item.name}</div>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className="font-semibold tabular-nums text-destructive">{item.inStock}</span>
                                    <div className="text-[10px] text-muted-foreground">{item.uom}</div>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className="font-semibold tabular-nums">{item.qty}</span>
                                    <div className="text-[10px] text-muted-foreground">{item.uom}</div>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className="font-bold tabular-nums text-destructive">−{item.shortfall}</span>
                                    <div className="text-[10px] text-destructive">{item.uom} short</div>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    {detailItem.status === "Pending" && !escalateDone ? (
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.001"
                                        className="h-7 w-24 text-center text-xs mx-auto"
                                        placeholder={String(Math.ceil(item.shortfall))}
                                        value={shortfallQtys[item.id] ?? ""}
                                        onChange={(e) =>
                                          setShortfallQtys((p) => ({ ...p, [item.id]: e.target.value }))
                                        }
                                      />
                                    ) : (
                                      <span className="text-xs tabular-nums text-muted-foreground">
                                        {shortfallQtys[item.id] !== undefined && shortfallQtys[item.id] !== ""
                                          ? shortfallQtys[item.id]
                                          : Math.ceil(item.shortfall)}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Processing history */}
              {(detailItem.processedBy || detailItem.processedAt) && (
                <div
                  className={cn(
                    "rounded-md border p-3 text-xs",
                    detailItem.status === "Approved" && "border-success/30 bg-success/5",
                    detailItem.status === "Rejected" && "border-destructive/30 bg-destructive/5",
                    detailItem.status === "Reviewed" && "border-amber-300 bg-amber-50/60",
                  )}
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                    {detailItem.status === "Approved" ? "Approved by"
                      : detailItem.status === "Reviewed" ? "Returned for correction by"
                      : "Rejected by"}
                  </div>
                  <div className="flex items-center gap-1.5 text-foreground">
                    <UserIcon className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{detailItem.processedBy}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="tabular-nums text-muted-foreground">{detailItem.processedAt}</span>
                  </div>
                  {detailItem.reviewComment && (
                    <div className="mt-2 pt-2 border-t border-amber-300/50 text-amber-800 flex items-start gap-1.5">
                      <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                      <span><span className="font-medium">Comment:</span> {detailItem.reviewComment}</span>
                    </div>
                  )}
                  {detailItem.rejectionReason && (
                    <div className="mt-2 pt-2 border-t border-destructive/20 text-destructive">
                      <span className="font-medium">Reason:</span> {detailItem.rejectionReason}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter className={cn("px-5 border-t border-border bg-muted/20", detailItem?.status === "Pending" && (detailRejectOpen || detailReviewOpen) ? "py-4" : "py-3")}>
            {detailItem?.status === "Pending" && detailRejectOpen ? (
              <div className="w-full flex flex-col gap-2">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    {detailItem?.category === "Return Items" ? "Decline Justification" : "Rejection Reason"} <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    value={detailRejectReason}
                    onChange={(e) => setDetailRejectReason(e.target.value)}
                    placeholder="Explain why this is being rejected..."
                    className="mt-1 min-h-20"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setDetailRejectOpen(false); setDetailRejectReason(""); }}
                  >
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm" onClick={confirmDetailReject}>
                    <XIcon className="h-3.5 w-3.5 mr-1" /> {detailItem?.category === "Return Items" ? "Confirm Decline" : "Confirm Reject"}
                  </Button>
                </div>
              </div>
            ) : detailItem?.status === "Pending" && detailReviewOpen ? (
              <div className="w-full flex flex-col gap-2">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Review Comment <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Sent back to the requester for correction — not rejected. They can amend and resubmit.
                  </p>
                  <Textarea
                    value={detailReviewComment}
                    onChange={(e) => setDetailReviewComment(e.target.value)}
                    placeholder="Tell the requester what needs to change..."
                    className="mt-1 min-h-20"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setDetailReviewOpen(false); setDetailReviewComment(""); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="bg-amber-500 text-white hover:bg-amber-600"
                    onClick={confirmDetailReview}
                  >
                    <CornerUpLeft className="h-3.5 w-3.5 mr-1" /> Send for Correction
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {detailItem?.status === "Pending" && detailItem.category === "Return Items" && !returnItemsSaved ? (
                  <>
                    <Button
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={() => setDetailRejectOpen(true)}
                    >
                      <XIcon className="h-4 w-4 mr-1.5" /> Decline
                    </Button>
                    <Button
                      className="bg-success text-success-foreground hover:bg-success/90"
                      onClick={saveReturnItems}
                    >
                      <Check className="h-4 w-4 mr-1.5" /> Save
                    </Button>
                  </>
                ) : detailItem?.status === "Pending" ? (
                  <>
                    <Button
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={() => setDetailRejectOpen(true)}
                    >
                      <XIcon className="h-4 w-4 mr-1.5" /> Reject
                    </Button>
                    <Button
                      variant="outline"
                      className="border-amber-400 text-amber-700 hover:bg-amber-50"
                      onClick={() => setDetailReviewOpen(true)}
                    >
                      <CornerUpLeft className="h-4 w-4 mr-1.5" /> Review
                    </Button>
                    <Button
                      className="bg-success text-success-foreground hover:bg-success/90"
                      onClick={() => {
                        if (detailItem) { approve(detailItem); setDetailOpen(false); }
                      }}
                    >
                      <Check className="h-4 w-4 mr-1.5" /> Approve
                    </Button>
                  </>
                ) : null}
                <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Galley Loading detail modal ───────────────────────────────────────── */}
      <Dialog open={galleyDetailOpen} onOpenChange={(v) => { if (!v) { setGalleyDetailOpen(false); setGalleyEditMode(false); } }}>
        <DialogContent className="w-full max-w-4xl max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="bg-gradient-to-r from-sky-700 to-sky-600 text-white px-6 pt-5 pb-4 shrink-0">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] text-sky-200 uppercase tracking-widest font-semibold">US-Bangla Airlines · Galley Loading Record</p>
                <h2 className="text-lg font-bold mt-0.5 flex items-center gap-2">
                  <LayoutGrid className="h-5 w-5" />
                  {galleyDetailRecord?.flightLabel}
                </h2>
                <div className="flex flex-wrap items-center gap-3 mt-1 text-xs">
                  <span className="text-sky-200">{galleyDetailRecord?.date}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${galleyDetailRecord?.galleyStatus === "approved" ? "bg-emerald-500 text-white" : "bg-amber-400 text-amber-900"}`}>
                    {galleyDetailRecord?.galleyStatus === "approved" ? "Ready To Fly" : "Awaiting Approval"}
                  </span>
                  {galleyDetailRecord?.loadingDurationSec != null && (
                    <span className="text-sky-200 flex items-center gap-1">
                      <Timer className="h-3 w-3" /> Loading: {formatGalleyDuration(galleyDetailRecord.loadingDurationSec)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {galleyDetailRecord && (
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Sign-off section */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 mb-2">Sign-Off</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md border border-sky-100 bg-sky-50/40 p-3 text-sm">
                  {[
                    ["Dispatch Sheet Prepared By", galleyDetailRecord.signOff.preparedBy],
                    ["Physically Handed By", galleyDetailRecord.signOff.physicallyHandedBy],
                    ["Flight Checked By", galleyDetailRecord.signOff.flightCheckedBy],
                    ["Handed Over By", galleyDetailRecord.signOff.handedOverBy],
                  ].map(([label, entry]) => {
                    const log = entry as SignOffLog;
                    return (
                      <div key={label as string}>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label as string}</div>
                        <div className="font-semibold mt-0.5 text-sm">{log?.name || "—"}</div>
                        {log?.designation && <div className="text-[10px] text-slate-500">{log.designation}</div>}
                        {log?.signedAt && <div className="text-[10px] text-slate-400 tabular-nums">{log.signedAt}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Loading timeline */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 mb-2">Loading Timeline</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { label: "Forwarded to Aircraft", value: galleyDetailRecord.forwardedAt, color: "sky" },
                    { label: "Loading Started", value: galleyDetailRecord.loadingStartedAt ? new Date(galleyDetailRecord.loadingStartedAt).toLocaleString() : "—", color: "violet" },
                    { label: "Loading Completed", value: galleyDetailRecord.loadingCompletedAt ? new Date(galleyDetailRecord.loadingCompletedAt).toLocaleString() : "—", color: "emerald" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className={`rounded-md border p-3 text-sm ${color === "sky" ? "border-sky-200 bg-sky-50/40" : color === "violet" ? "border-violet-200 bg-violet-50/40" : "border-emerald-200 bg-emerald-50/40"}`}>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
                      <div className="font-semibold mt-0.5 tabular-nums text-xs">{value}</div>
                    </div>
                  ))}
                </div>
                {galleyDetailRecord.loadingDurationSec != null && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Total loading duration: <span className="font-bold text-foreground">{formatGalleyDuration(galleyDetailRecord.loadingDurationSec)}</span>
                  </div>
                )}
              </div>

              {/* Galley plan overview */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700">Galley Plan Details</p>
                  {galleyDetailRecord.galleyStatus === "awaiting_approval" && !galleyEditMode && (
                    <Button size="sm" variant="outline" className="h-7 text-xs border-sky-300 text-sky-700 hover:bg-sky-50"
                      onClick={() => { setGalleyEditMode(true); setGalleyEditPlan({ ...galleyDetailRecord.galleyPlan }); }}>
                      Make Changes
                    </Button>
                  )}
                  {galleyEditMode && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setGalleyEditMode(false)}>Cancel</Button>
                      <Button size="sm" className="h-7 text-xs bg-sky-600 hover:bg-sky-700 text-white"
                        onClick={() => saveGalleyEdits(galleyDetailRecord, galleyEditPlan)}>
                        Save Changes
                      </Button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-60 overflow-y-auto border border-border rounded-md p-3 bg-muted/10">
                  {Object.entries(galleyEditMode ? galleyEditPlan : galleyDetailRecord.galleyPlan)
                    .filter(([, v]) => v !== "" && v !== "0")
                    .slice(0, 40)
                    .map(([k, v]) => (
                      <div key={k}>
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium leading-tight">{k.replace(/([A-Z])/g, " $1").trim()}</div>
                        {galleyEditMode ? (
                          <input
                            type="text"
                            value={galleyEditPlan[k] ?? v}
                            onChange={(e) => setGalleyEditPlan((prev) => ({ ...prev, [k]: e.target.value }))}
                            className="w-full h-6 px-1.5 text-xs border border-input rounded bg-background tabular-nums focus:ring-1 focus:ring-ring focus:outline-none mt-0.5"
                          />
                        ) : (
                          <div className="font-semibold text-xs mt-0.5 tabular-nums">{v}</div>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              {/* Approved info */}
              {galleyDetailRecord.galleyStatus === "approved" && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3 text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold mb-1">Approved — Ready To Fly</div>
                  <div className="flex items-center gap-2 text-xs text-emerald-800">
                    <span className="font-medium">{galleyDetailRecord.approvedBy}</span>
                    <span>·</span>
                    <span className="tabular-nums">{galleyDetailRecord.approvedAt}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="border-t bg-white px-6 py-3 shrink-0 flex items-center justify-end gap-2">
            {galleyDetailRecord && galleyDetailRecord.galleyStatus === "awaiting_approval" && !galleyEditMode && (
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => approveGalley(galleyDetailRecord, role || HOC_NAMES[0])}
              >
                Approve
              </Button>
            )}
            <Button variant="outline" onClick={() => { setGalleyDetailOpen(false); setGalleyEditMode(false); }}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Detail({
  label, value, icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: typeof FileText;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
        {Icon && <Icon className="h-2.5 w-2.5" />}
        {label}
      </div>
      <div className="mt-0.5 text-sm text-foreground">{value}</div>
    </div>
  );
}
