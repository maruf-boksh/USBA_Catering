import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  BadgeCheck, Check, X as XIcon, Clock, ShieldCheck, Search,
  FileText, FileSearch, ShoppingCart, Truck, ArrowLeftRight, Layers, UserCog,
  ClipboardCheck, SlidersHorizontal, History, Eye, User as UserIcon, Calendar, Hash,
  PackageCheck, AlertTriangle, CheckCircle2, Share2, Plane, MailQuestion, PlaneLanding, PlaneTakeoff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useWorkflow,
  type WfDemandRequest, type WfDemandStatus, type WfDispatchApproval,
} from "@/lib/workflow-store";
import { inventory, warehouses } from "@/lib/sample-data";
import { getItemStock } from "@/lib/inventory-stock";
import { useFlightOrders, updateFlightOrdersWhere, type FlightOrder } from "@/lib/flight-orders-store";
import { getRfqs, setRfqStatus } from "@/lib/rfqs";
import { useRole } from "@/lib/roles";

type Category =
  | "Order Management"
  | "Demand Request"
  | "Request for Quotation"
  | "Purchase Requisition"
  | "Purchase Order"
  | "Goods Receipt"
  | "Transfer Request"
  | "Stock Adjustment"
  | "Production Order"
  | "Bill of Materials"
  | "User Account"
  | "Dispatch";

const CATEGORIES: { key: Category; label: string; icon: typeof FileText }[] = [
  { key: "Order Management",         label: "Order Management",   icon: Plane           },
  { key: "Demand Request",       label: "Demand Req.",        icon: FileSearch      },
  { key: "Request for Quotation", label: "RFQ",               icon: MailQuestion    },
  { key: "Purchase Requisition", label: "Purchase Req.",      icon: FileText        },
  { key: "Purchase Order",       label: "Purchase Orders",    icon: ShoppingCart    },
  { key: "Goods Receipt",        label: "Goods Receipts",     icon: Truck           },
  { key: "Transfer Request",     label: "Transfer Requests",  icon: ArrowLeftRight  },
  { key: "Stock Adjustment",     label: "Stock Adj.",         icon: SlidersHorizontal },
  { key: "Production Order",     label: "Production",         icon: ClipboardCheck  },
  { key: "Bill of Materials",    label: "BOM",                icon: Layers          },
  { key: "User Account",         label: "Users",              icon: UserCog         },
  { key: "Dispatch",             label: "Dispatch",           icon: Truck           },
];

type ApprovalStatus = "Pending" | "Approved" | "Rejected";

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

  // Stock Adjustment
  { id: "AP-1401", category: "Stock Adjustment",     refId: "SA-2026-019", title: "Spice Mix variance",                      requestedBy: "F. Begum",   requestedAt: "2026-05-19 07:55", summary: "Physical count -2.4 Kg vs system — wastage write-off",    status: "Pending",
    lines: [
      { name: "Spice Mix", qty: -2.4, uom: "Kg", note: "Counted 47.6 vs system 50.0 — wastage write-off" },
    ] },

  // Production Order
  { id: "AP-1501", category: "Production Order",     refId: "PRO-2026-000031", title: "Chicken Biryani batch",                 requestedBy: "N. Hossen",  requestedAt: "2026-05-19 13:15", summary: "280 portions — ready for QC sign-off",                    itemsCount: 1, status: "Pending",
    lines: [
      { name: "Chicken Biryani", qty: 280, uom: "portions", note: "BOM-001 · ready for QC sign-off" },
    ] },

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
  } = useWorkflow();
  const flightOrders = useFlightOrders();

  const [items, setItems] = useState<ApprovalItem[]>(SEED);
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
  const [activeTab, setActiveTab] = useState<Category | "all">(
    searchParams.get("tab") === "dispatch" ? "Dispatch" : "all"
  );
  const [search, setSearch] = useState("");
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
    const byOrder = new Map<string, FlightOrder[]>();
    for (const o of flightOrders) {
      const list = byOrder.get(o.orderNo);
      if (list) list.push(o);
      else byOrder.set(o.orderNo, [o]);
    }
    const result: ApprovalItem[] = [];
    for (const [orderNo, legs] of byOrder) {
      const decision = foDecisions[orderNo];
      const hasPending = legs.some((l) => l.status === "Pending");
      if (!hasPending && !decision) continue;
      const airlines = Array.from(new Set(legs.map((l) => l.airline)));
      const totalPax = legs.reduce((s, l) => s + (l.pax ?? 0), 0);
      const flightList = legs.map((l) => l.flight).slice(0, 4).join(", ");
      result.push({
        id: `FO-AP-${orderNo}`,
        category: "Order Management",
        refId: orderNo,
        title: `Flight order — ${legs.length} flight${legs.length === 1 ? "" : "s"}`,
        requestedBy: "Operations",
        requestedAt: legs[0].date,
        summary: `${airlines.join(", ")} · ${flightList}${legs.length > 4 ? ` +${legs.length - 4} more` : ""} · ${totalPax} pax`,
        itemsCount: legs.length,
        status: decision ? decision.status : "Pending",
        processedBy: decision?.by,
        processedAt: decision?.at,
        rejectionReason: decision?.reason,
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

  const allItems = useMemo(
    () => [...flightOrderItems, ...demandItems, ...rfqItems, ...items],
    [flightOrderItems, demandItems, rfqItems, items],
  );

  const counts = useMemo(() => {
    const pendingByCat = new Map<Category, number>();
    for (const c of CATEGORIES) pendingByCat.set(c.key, 0);
    let pending = 0, approvedToday = 0, rejectedToday = 0, valuePending = 0;
    for (const it of allItems) {
      if (it.status === "Pending") {
        pending++;
        pendingByCat.set(it.category, (pendingByCat.get(it.category) ?? 0) + 1);
        if (it.amount) valuePending += it.amount;
      } else if (it.processedAt?.startsWith(today)) {
        if (it.status === "Approved") approvedToday++;
        if (it.status === "Rejected") rejectedToday++;
      }
    }
    return { pending, approvedToday, rejectedToday, valuePending, pendingByCat };
  }, [allItems, today]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((it) => {
      if (activeTab !== "all" && it.category !== activeTab) return false;
      if (q && ![it.refId, it.title, it.requestedBy, it.summary].some((f) => f.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [allItems, activeTab, search]);

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
    if (it.category === "Order Management") {
      const moved = updateFlightOrdersWhere(
        (o) => o.orderNo === it.refId && o.status === "Pending",
        { status: "Approved" },
      );
      setFoDecisions((p) => ({
        ...p,
        [it.refId]: { status: "Approved", by: `${role} (GM/Admin)`, at: stamp() },
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
    } else if (it.category === "Order Management") {
      setFoDecisions((p) => ({
        ...p,
        [it.refId]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
    } else if (it.category === "Request for Quotation") {
      setRfqStatus(it.refId, "Rejected");
      setRfqDecisions((p) => ({
        ...p,
        [it.refId]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
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

  const openDetail = (it: ApprovalItem) => {
    setDetailItem(it);
    setDetailOpen(true);
    setFulfillStoreDone(false);
    setEscalateDone(false);
    setShortfallQtys({});
    setDetailRejectOpen(false);
    setDetailRejectReason("");
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
    } else if (detailItem.category === "Order Management") {
      setFoDecisions((p) => ({
        ...p,
        [detailItem.refId]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
    } else if (detailItem.category === "Request for Quotation") {
      setRfqStatus(detailItem.refId, "Rejected");
      setRfqDecisions((p) => ({
        ...p,
        [detailItem.refId]: { status: "Rejected", by: `${role} (GM/Admin)`, at: stamp(), reason },
      }));
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

  return (
    <>
      <PageHeader
        title="Approval Management"
        subtitle="Centralized approval queue — all module approvals are processed from here only"
      />

      <div className="usb-livery-stripe h-1 rounded-full mb-5" aria-hidden />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Pending Approvals" value={counts.pending}        sub="awaiting action"   icon={Clock}       tone="warning" />
        <KpiCard label="Approved Today"    value={counts.approvedToday}  sub="processed today"   icon={Check}       tone="success" />
        <KpiCard label="Rejected Today"    value={counts.rejectedToday}  sub="processed today"   icon={XIcon}       tone="red"     />
        <KpiCard
          label="Value Pending"
          value={`৳ ${counts.valuePending.toLocaleString()}`}
          sub="across PRs & POs"
          icon={ShieldCheck}
          tone="navy"
        />
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Category | "all")}>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <TabsList className="h-auto bg-muted p-1 flex flex-wrap gap-1">
            <TabsTrigger value="all" className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5 text-xs h-7">
              <BadgeCheck className="h-3.5 w-3.5" />
              All
              <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px] tabular-nums">
                {counts.pending}
              </Badge>
            </TabsTrigger>
            {CATEGORIES.map((c) => {
              const Icon = c.icon;
              const n = c.key === "Dispatch" ? dispatchPendingCount : (counts.pendingByCat.get(c.key) ?? 0);
              return (
                <TabsTrigger
                  key={c.key}
                  value={c.key}
                  className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5 text-xs h-7"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {c.label}
                  {n > 0 && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "ml-1 h-4 px-1 text-[10px] tabular-nums",
                        "bg-warning/15 text-warning-foreground border-warning/40",
                      )}
                    >
                      {n}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

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

        {/* Pending list */}
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

          {activeTab !== "Dispatch" && (<><Card className="brand-accent-border-left">
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider">
                  Pending — {activeTab === "all" ? "All Categories" : activeTab}
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
                        {activeTab === "all" && <TableHead className="text-xs uppercase tracking-wider">Category</TableHead>}
                        <TableHead className="text-xs uppercase tracking-wider">Requested By</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Amount / Items</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingItems.map((it) => {
                        const Icon = categoryIcon(it.category);
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
                            {activeTab === "all" && (
                              <TableCell>
                                <Badge variant="outline" className="font-normal text-[10px]">
                                  <Icon className="h-2.5 w-2.5 mr-1" /> {it.category}
                                </Badge>
                              </TableCell>
                            )}
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
                                approved
                                  ? "bg-success/10 text-success border-success/30"
                                  : "bg-destructive/10 text-destructive border-destructive/30",
                              )}
                            >
                              {approved ? <Check className="h-2.5 w-2.5 mr-1" /> : <XIcon className="h-2.5 w-2.5 mr-1" />}
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
                  )}
                >
                  {detailItem.status === "Approved" && <Check className="h-3 w-3 mr-1" />}
                  {detailItem.status === "Rejected" && <XIcon className="h-3 w-3 mr-1" />}
                  {detailItem.status === "Pending"  && <Clock className="h-3 w-3 mr-1" />}
                  {detailItem.status}
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

              {/* Order Management — flight legs in this order */}
              {detailItem.category === "Order Management" && (() => {
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

              {/* Generic line items — PR / PO / GRN / Transfer / Stock Adj / Production / BOM */}
              {detailItem.lines && detailItem.lines.length > 0 && (
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
                        {detailItem.status === "Pending" && (
                          <div className="flex justify-end mt-2">
                            {escalateDone ? (
                              <Button size="sm" variant="outline" disabled className="h-7 px-3 text-[11px] border-warning/40 text-warning-foreground">
                                <CheckCircle2 className="h-3 w-3 mr-1.5" /> Escalated to Supply Chain ✓
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-3 text-[11px] border-warning/40 text-warning-foreground hover:bg-warning/10"
                                onClick={() => handleEscalateToSupplyChain(dr)}
                              >
                                <Share2 className="h-3 w-3 mr-1.5" /> Escalate To Supply Chain
                              </Button>
                            )}
                          </div>
                        )}
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
                    detailItem.status === "Approved"
                      ? "border-success/30 bg-success/5"
                      : "border-destructive/30 bg-destructive/5",
                  )}
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                    {detailItem.status === "Approved" ? "Approved by" : "Rejected by"}
                  </div>
                  <div className="flex items-center gap-1.5 text-foreground">
                    <UserIcon className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{detailItem.processedBy}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="tabular-nums text-muted-foreground">{detailItem.processedAt}</span>
                  </div>
                  {detailItem.rejectionReason && (
                    <div className="mt-2 pt-2 border-t border-destructive/20 text-destructive">
                      <span className="font-medium">Reason:</span> {detailItem.rejectionReason}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter className={cn("px-5 border-t border-border bg-muted/20", detailItem?.status === "Pending" && detailRejectOpen ? "py-4" : "py-3")}>
            {detailItem?.status === "Pending" && detailRejectOpen ? (
              <div className="w-full flex flex-col gap-2">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Rejection Reason <span className="text-destructive">*</span>
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
                    <XIcon className="h-3.5 w-3.5 mr-1" /> Confirm Reject
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {detailItem?.status === "Pending" && (
                  <>
                    <Button
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={() => setDetailRejectOpen(true)}
                    >
                      <XIcon className="h-4 w-4 mr-1.5" /> Reject
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
                )}
                <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
              </>
            )}
          </DialogFooter>
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
