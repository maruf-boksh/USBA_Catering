import { useMemo, useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Category =
  | "Demand Request"
  | "Purchase Requisition"
  | "Purchase Order"
  | "Goods Receipt"
  | "Transfer Request"
  | "Stock Adjustment"
  | "Production Order"
  | "Bill of Materials"
  | "User Account";

const CATEGORIES: { key: Category; label: string; icon: typeof FileText }[] = [
  { key: "Demand Request",       label: "Demand Req.",        icon: FileSearch      },
  { key: "Purchase Requisition", label: "Purchase Req.",      icon: FileText        },
  { key: "Purchase Order",       label: "Purchase Orders",    icon: ShoppingCart    },
  { key: "Goods Receipt",        label: "Goods Receipts",     icon: Truck           },
  { key: "Transfer Request",     label: "Transfer Requests",  icon: ArrowLeftRight  },
  { key: "Stock Adjustment",     label: "Stock Adj.",         icon: SlidersHorizontal },
  { key: "Production Order",     label: "Production",         icon: ClipboardCheck  },
  { key: "Bill of Materials",    label: "BOM",                icon: Layers          },
  { key: "User Account",         label: "Users",              icon: UserCog         },
];

type ApprovalStatus = "Pending" | "Approved" | "Rejected";

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
};

const SEED: ApprovalItem[] = [
  // Purchase Requisition
  { id: "AP-1001", category: "Purchase Requisition", refId: "PR-2026-007", title: "Grains & rice for next week",            requestedBy: "S. Ahmed",   requestedAt: "2026-05-19 09:12", summary: "Basmati Rice 800 Kg, Cooking Oil 200 L",                 amount: 245000, itemsCount: 4, status: "Pending" },
  { id: "AP-1002", category: "Purchase Requisition", refId: "PR-2026-008", title: "Packaging restock",                       requestedBy: "F. Begum",   requestedAt: "2026-05-19 11:30", summary: "Meal Box 5000 pcs, Aluminum Tray 3000 pcs",              amount: 168000, itemsCount: 2, status: "Pending" },
  { id: "AP-1003", category: "Purchase Requisition", refId: "PR-2026-005", title: "Beverage & water",                        requestedBy: "T. Islam",   requestedAt: "2026-05-18 14:45", summary: "Mineral Water 250ml — 12000 bottles",                    amount:  98000, itemsCount: 1, status: "Approved",  processedBy: "R. Hossain", processedAt: "2026-05-18 16:00" },

  // Purchase Order
  { id: "AP-1101", category: "Purchase Order",       refId: "PO-2026-0451", title: "Agro Fresh — vegetables",                requestedBy: "Md. Karim",  requestedAt: "2026-05-19 10:50", summary: "Tomato 500 Kg, Onion 300 Kg, Spice Mix 50 Kg",           amount: 132000, itemsCount: 3, status: "Pending" },
  { id: "AP-1102", category: "Purchase Order",       refId: "PO-2026-0452", title: "Meat & Co. — protein supply",            requestedBy: "Md. Karim",  requestedAt: "2026-05-19 08:20", summary: "Chicken Breast 600 Kg, Mutton 150 Kg",                   amount: 308000, itemsCount: 2, status: "Pending" },

  // Goods Receipt
  { id: "AP-1201", category: "Goods Receipt",        refId: "GRN-2026-118", title: "Receipt of PO-2026-0445",                 requestedBy: "S. Ahmed",   requestedAt: "2026-05-19 12:05", summary: "9 of 10 lines accepted, 1 on hold for QC",               itemsCount: 10, status: "Pending" },

  // Transfer Request
  { id: "AP-1301", category: "Transfer Request",     refId: "TR-7001",     title: "Central WH → Hot Kitchen",                requestedBy: "S. Ahmed",   requestedAt: "2026-05-19 10:25", summary: "Daily production replenishment — 2 items",               itemsCount: 2,  status: "Pending" },
  { id: "AP-1302", category: "Transfer Request",     refId: "TR-7004",     title: "Regional CXB → Central WH",               requestedBy: "T. Islam",   requestedAt: "2026-05-18 11:32", summary: "Stock balancing — Meal Box 500 pcs",                     itemsCount: 1,  status: "Pending" },

  // Stock Adjustment
  { id: "AP-1401", category: "Stock Adjustment",     refId: "SA-2026-019", title: "Spice Mix variance",                      requestedBy: "F. Begum",   requestedAt: "2026-05-19 07:55", summary: "Physical count -2.4 Kg vs system — wastage write-off",    status: "Pending" },

  // Production Order
  { id: "AP-1501", category: "Production Order",     refId: "PRO-2026-000031", title: "Chicken Biryani batch",                 requestedBy: "N. Hossen",  requestedAt: "2026-05-19 13:15", summary: "280 portions — ready for QC sign-off",                    itemsCount: 1, status: "Pending" },

  // Bill of Materials
  { id: "AP-1601", category: "Bill of Materials",    refId: "BOM-007",     title: "New BOM — Vegetable Cutlet",              requestedBy: "S. Ahmed",   requestedAt: "2026-05-18 16:40", summary: "Draft v1.0 with 8 materials, ready to publish",          itemsCount: 8, status: "Pending" },
  { id: "AP-1602", category: "Bill of Materials",    refId: "BOM-001",     title: "Chicken Biryani — v3.3 revision",         requestedBy: "S. Ahmed",   requestedAt: "2026-05-17 11:10", summary: "Updated chicken portion 120 → 130 g per portion",        itemsCount: 9, status: "Approved",  processedBy: "R. Hossain", processedAt: "2026-05-17 17:00" },

  // User Account
  { id: "AP-1701", category: "User Account",         refId: "USR-008",     title: "New user — R. Karim (Store)",             requestedBy: "HR Team",    requestedAt: "2026-05-19 09:00", summary: "Role: Store & Inventory · Location: Central WH",          status: "Pending" },
  { id: "AP-1702", category: "User Account",         refId: "USR-006",     title: "Reactivate user — N. Hossen",             requestedBy: "Md. Karim",  requestedAt: "2026-05-18 14:20", summary: "Account inactive since 2026-04-15",                       status: "Rejected", processedBy: "R. Hossain", processedAt: "2026-05-18 18:00", rejectionReason: "Pending HR confirmation of return date" },
];

function categoryIcon(cat: Category) {
  return CATEGORIES.find((c) => c.key === cat)?.icon ?? FileText;
}

export default function ApprovalManagementPage() {
  const [items, setItems] = useState<ApprovalItem[]>(SEED);
  const [activeTab, setActiveTab] = useState<Category | "all">("all");
  const [search, setSearch] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<ApprovalItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<ApprovalItem | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");

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

  const allItems = useMemo(() => [...demandItems, ...items], [demandItems, items]);

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
  const approveDemand = (dr: WfDemandRequest) => {
    const at = new Date().toLocaleString();

    if (!dr.autoFulfill) {
      updateDemandStatus(dr.id, "Pending Store Review", { approvedBy: role, approvedAt: at });
      toast.success(`${dr.id} approved — ready for Store Review.`);
      return;
    }

    const onHandFor = (name: string) =>
      inventory.find((i) => i.name.toLowerCase() === name.toLowerCase())?.stock ?? 0;
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

    toast.success(
      created.length > 0
        ? `${dr.id} approved · ${created.join(" + ")} created.`
        : `${dr.id} approved.`,
      { duration: 6000 },
    );
  };

  const approve = (it: ApprovalItem) => {
    if (it.category === "Demand Request") {
      const dr = demands.find((d) => d.id === it.refId);
      if (!dr) {
        toast.error(`Demand ${it.refId} not found.`);
        return;
      }
      approveDemand(dr);
      return;
    }
    setItems((p) =>
      p.map((x) =>
        x.id === it.id
          ? { ...x, status: "Approved", processedBy: "R. Hossain (GM/Admin)", processedAt: stamp() }
          : x,
      ),
    );
    toast.success(`${it.refId} approved.`);
  };

  const openReject = (it: ApprovalItem) => {
    setRejectTarget(it);
    setRejectReason("");
    setRejectOpen(true);
  };

  const confirmReject = () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      toast.error("Provide a reason for rejection.");
      return;
    }
    const reason = rejectReason.trim();

    if (rejectTarget.category === "Demand Request") {
      updateDemandStatus(rejectTarget.refId, "Rejected", {
        rejectedBy: role,
        rejectedAt: new Date().toLocaleString(),
        rejectionReason: reason,
      });
      toast.success(`${rejectTarget.refId} rejected.`);
      setRejectOpen(false);
      setRejectTarget(null);
      return;
    }

    setItems((p) =>
      p.map((x) =>
        x.id === rejectTarget.id
          ? {
              ...x,
              status: "Rejected",
              processedBy: "R. Hossain (GM/Admin)",
              processedAt: stamp(),
              rejectionReason: reason,
            }
          : x,
      ),
    );
    toast.success(`${rejectTarget.refId} rejected.`);
    setRejectOpen(false);
    setRejectTarget(null);
  };

  const openDetail = (it: ApprovalItem) => {
    setDetailItem(it);
    setDetailOpen(true);
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
              const n = counts.pendingByCat.get(c.key) ?? 0;
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
          <Card className="brand-accent-border-left">
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider">
                  Pending — {activeTab === "all" ? "All Categories" : activeTab}
                </h3>
                <span className="text-xs text-muted-foreground">{pendingItems.length} item{pendingItems.length === 1 ? "" : "s"}</span>
              </div>

              {pendingItems.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-10">
                  Nothing pending here. All caught up.
                </div>
              ) : (
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
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
                          <TableRow key={it.id} className="hover:bg-muted/30">
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
          </Card>
        </TabsContent>
      </Tabs>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject {rejectTarget?.refId}</DialogTitle>
            <DialogDescription>
              Rejection notifies the requester. Provide a clear reason.
            </DialogDescription>
          </DialogHeader>
          {rejectTarget && (
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
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
            <div className="space-y-4">
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

          <DialogFooter>
            {detailItem?.status === "Pending" && (
              <>
                <Button
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    if (detailItem) { setDetailOpen(false); openReject(detailItem); }
                  }}
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
